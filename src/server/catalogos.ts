/**
 * Planos, categorias e etiquetas — etapa F2.4.
 *
 * OS TRÊS CATÁLOGOS QUE ALIMENTAM O RESTO
 *   O selo colorido do plano no cartão, as abas de unidade de negócio do
 *   cockpit e os filtros por etiqueta saem daqui. Até esta etapa eles só se
 *   editavam por SQL.
 *
 * O QUE O LEGADO PRECISA DE AÇÃO PARA MANTER, E AQUI NÃO PODE QUEBRAR
 *   Lá `clients.plano` é texto **sem chave estrangeira**, e `clients.categoria`
 *   é texto com cascata no nome. Renomear um plano exige a ação
 *   `plans__rename_safe`; apagar, a `plans__delete_safe`; renomear categoria
 *   reescreve 91 linhas de cliente.
 *
 *   Aqui a referência é por `uuid` desde a F2.1: renomear é trocar uma palavra
 *   numa linha, e órfão não é possível. As duas ações de reparo perdem a razão
 *   de existir.
 *
 * O QUE EXIGE ADMINISTRADOR, E O QUE NÃO
 *   Mexer no CATÁLOGO é de administrador — é ele que define o que a agência
 *   vende e como se organiza. Já ETIQUETAR um cliente é trabalho de quem cuida
 *   da carteira, e passa por função com dono. Mesma separação da F4.5.
 */

import { type Sql, arrayOuNulo, withActor } from '@/server/db';
import { estaOmitida } from '@/server/omitidas';
import { emPortugues } from '@/server/recusas';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

export class CatalogoRefused extends Error {
  readonly status: 400 | 403 | 404 | 409;

  constructor(message: string, status: 400 | 403 | 404 | 409) {
    super(message);
    this.name = 'CatalogoRefused';
    this.status = status;
  }
}

export type Plano = {
  id: string;
  name: string;
  colorBg: string;
  colorText: string;
  colorBorder: string;
  sortOrder: number;
  isActive: boolean;
  /** Quantos clientes usam. A tela avisa antes de desativar o que está em uso. */
  clientCount: number;
};

export type Categoria = {
  id: string;
  name: string;
  isDefault: boolean;
  sortOrder: number;
  clientCount: number;
  /**
   * A unidade está em `IDEWORKS_EMPRESAS_OMITIDAS` — F31, Fase 3a.
   *
   * Só chega `true` para o SUPER ADMIN, e só para ele a unidade omitida vem na
   * lista: ela existe, tem clientes e contas da Meta, e quem cuida do sistema
   * não pode esquecer disso. Para os outros ela simplesmente não vem.
   * Ausente = não omitida (o formato de antes da F31).
   */
  omitida?: boolean;
};

export type Etiqueta = {
  id: string;
  name: string;
  color: string;
  clientCount: number;
};

export type Catalogos = { plans: Plano[]; categories: Categoria[]; tags: Etiqueta[] };

/** Cor em `#rrggbb`. Valor torto vira retângulo invisível na tela. */
const COR = /^#[0-9a-f]{6}$/i;

function conferirCor(valor: unknown, campo: string): string {
  if (typeof valor === 'string' && COR.test(valor)) return valor.toLowerCase();
  throw new CatalogoRefused(`${campo} inválida: use o formato #rrggbb.`, 400);
}

function conferirNome(valor: unknown, campo = 'nome'): string {
  const t = typeof valor === 'string' ? valor.trim() : '';
  if (t === '') throw new CatalogoRefused(`Informe o ${campo}.`, 400);
  return t;
}

function traduzir(erro: unknown): never {
  const e = erro as { code?: string; message?: string; constraint_name?: string };
  // A frase do banco passa pelo tradutor da F17.19: nome de função e de tabela
  // não são para o olho de quem trabalha.
  if (e.code === '42501') throw new CatalogoRefused(emPortugues(e.message), 403);
  if (e.code === '22023') throw new CatalogoRefused(emPortugues(e.message), 409);

  if (e.code === '23505') {
    throw new CatalogoRefused('Já existe um com esse nome.', 409);
  }
  // `on delete restrict` em `clients.plan_id` e `clients.category_id`.
  if (e.code === '23503') {
    throw new CatalogoRefused(
      'Há clientes usando este item. Desative-o, ou mova os clientes antes de apagar.',
      409,
    );
  }
  throw erro;
}

/* ─────────────────────────── leitura ─────────────────────────── */

export async function readCatalogos(
  sql: Sql,
  actor: AuthenticatedActor,
): Promise<Catalogos> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    // A contagem sai por subconsulta e não por junção com `group by`: junção
    // esconderia o catálogo que ninguém usa ainda, e é justamente esse que a
    // tela precisa mostrar para poder ser apagado.
    const consultaDosPlanos = tx`
      select p.id, p.name, p.color_bg, p.color_text, p.color_border,
             p.sort_order, p.is_active,
             (select count(*) from ideworks.clients c where c.plan_id = p.id)::int as client_count
        from ideworks.plans p
       order by p.sort_order, p.name`;

    const consultaDasCategorias = tx`
      select c.id, c.name, c.is_default, c.sort_order,
             (select count(*) from ideworks.clients x where x.category_id = c.id)::int as client_count
        from ideworks.client_categories c
       order by c.sort_order, c.name`;

    const consultaDasEtiquetas = tx`
      select t.id, t.name, t.color,
             (select count(*) from ideworks.client_tag_assignments a where a.tag_id = t.id)::int
               as client_count
        from ideworks.client_tags t
       order by t.name`;

    // As três não levam parâmetro, então saem na MESMA ida (perf do servidor,
    // 08/10/2026): eram três idas em fila. Mesmo texto, mesma ordem de execução.
    const [planos, categorias, etiquetas] = await Promise.all([
      consultaDosPlanos,
      consultaDasCategorias,
      consultaDasEtiquetas,
    ]);

    return {
      plans: planos.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        colorBg: r.color_bg as string,
        colorText: r.color_text as string,
        colorBorder: r.color_border as string,
        sortOrder: Number(r.sort_order),
        isActive: r.is_active as boolean,
        clientCount: Number(r.client_count),
      })),
      // F31, Fase 3a — a unidade omitida some de Catálogos, menos para o super
      // admin, que a vê com o selo "omitida". Filtrada aqui, depois da
      // consulta, e não no SQL: a consulta fica a de sempre, ligada ou não.
      categories: categorias
        .filter((r) => actor.isSuper || !estaOmitida(actor, r.id as string))
        .map((r) => ({
          id: r.id as string,
          name: r.name as string,
          isDefault: r.is_default as boolean,
          sortOrder: Number(r.sort_order),
          clientCount: Number(r.client_count),
          ...(estaOmitida(actor, r.id as string) ? { omitida: true } : {}),
        })),
      tags: etiquetas.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        color: r.color as string,
        clientCount: Number(r.client_count),
      })),
    };
  });
}

/* ─────────────────────────── planos ─────────────────────────── */

export type EntradaDePlano = {
  name: string;
  colorBg: string;
  colorText: string;
  colorBorder: string;
  sortOrder: number;
  isActive: boolean;
};

function conferirPlano(e: Partial<EntradaDePlano>) {
  return {
    name: conferirNome(e.name),
    colorBg: conferirCor(e.colorBg ?? '#1f2937', 'Cor de fundo'),
    colorText: conferirCor(e.colorText ?? '#f9fafb', 'Cor do texto'),
    colorBorder: conferirCor(e.colorBorder ?? '#374151', 'Cor da borda'),
    sortOrder: Number.isInteger(Number(e.sortOrder)) ? Number(e.sortOrder) : 0,
    isActive: e.isActive !== false,
  };
}

export async function savePlano(
  sql: Sql,
  actor: AuthenticatedActor,
  id: string | null,
  entrada: Partial<EntradaDePlano>,
): Promise<string> {
  const e = conferirPlano(entrada);

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const linhas = id
        ? await tx`
            update ideworks.plans
               set name = ${e.name}, color_bg = ${e.colorBg}, color_text = ${e.colorText},
                   color_border = ${e.colorBorder}, sort_order = ${e.sortOrder},
                   is_active = ${e.isActive}, updated_at = now()
             where id = ${id} returning id`
        : await tx`
            insert into ideworks.plans
              (name, color_bg, color_text, color_border, sort_order, is_active)
            values (${e.name}, ${e.colorBg}, ${e.colorText}, ${e.colorBorder},
                    ${e.sortOrder}, ${e.isActive})
            returning id`;

      if (linhas.length === 0) {
        throw new CatalogoRefused('Só administrador mexe no catálogo de planos.', 403);
      }
      return linhas[0].id as string;
    } catch (erro) {
      if (erro instanceof CatalogoRefused) throw erro;
      traduzir(erro);
    }
  });
}

export async function deletePlano(
  sql: Sql,
  actor: AuthenticatedActor,
  id: string,
): Promise<void> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const apagados = await tx`delete from ideworks.plans where id = ${id} returning id`;
      if (apagados.length === 0) {
        throw new CatalogoRefused('Plano não encontrado, ou você não pode apagá-lo.', 403);
      }
    } catch (erro) {
      if (erro instanceof CatalogoRefused) throw erro;
      traduzir(erro);
    }
  });
}

/* ─────────────────────────── categorias ─────────────────────────── */

/**
 * A unidade OMITIDA não se mexe por aqui — F31, Fase 3b.
 *
 * As três mudanças desligariam a omissão EM SILÊNCIO:
 *   · tornar padrão: o resolvedor ignora a padrão (`resolverOmitidas`), e a
 *     unidade inteira voltaria a todas as telas;
 *   · renomear: `IDEWORKS_EMPRESAS_OMITIDAS` guarda o NOME, e o nome novo
 *     deixaria de casar com a variável;
 *   · apagar: os clientes dela iriam para a padrão, que nunca é omitida.
 * A tela de Catálogos já não oferece os botões (só o selo "omitida"); esta
 * recusa é a segunda parede, para quem chamar a rota direto. O caminho é tirar
 * o nome da variável e publicar, e aí mexer.
 */
const UNIDADE_OMITIDA =
  'Esta unidade está omitida (IDEWORKS_EMPRESAS_OMITIDAS). Tire-a da variável antes de ' +
  'torná-la padrão, renomeá-la ou apagá-la — cada uma dessas mudanças traria a unidade de ' +
  'volta às telas sem ninguém perceber.';

function recusarSeOmitida(actor: AuthenticatedActor, id: string | null): void {
  if (id !== null && estaOmitida(actor, id)) throw new CatalogoRefused(UNIDADE_OMITIDA, 409);
}

export async function saveCategoria(
  sql: Sql,
  actor: AuthenticatedActor,
  id: string | null,
  entrada: { name?: string; sortOrder?: number },
): Promise<string> {
  const name = conferirNome(entrada.name);
  const sortOrder = Number.isInteger(Number(entrada.sortOrder)) ? Number(entrada.sortOrder) : 0;
  recusarSeOmitida(actor, id);

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const linhas = id
        ? await tx`
            update ideworks.client_categories
               set name = ${name}, sort_order = ${sortOrder}, updated_at = now()
             where id = ${id} returning id`
        : await tx`
            insert into ideworks.client_categories (name, sort_order)
            values (${name}, ${sortOrder}) returning id`;

      if (linhas.length === 0) {
        throw new CatalogoRefused('Só administrador mexe nas categorias.', 403);
      }
      return linhas[0].id as string;
    } catch (erro) {
      if (erro instanceof CatalogoRefused) throw erro;
      traduzir(erro);
    }
  });
}

/** Devolve quantos clientes foram realocados para a categoria padrão. */
export async function deleteCategoria(
  sql: Sql,
  actor: AuthenticatedActor,
  id: string,
): Promise<number> {
  recusarSeOmitida(actor, id);
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const [r] = await tx`select ideworks.delete_category(${id}) as realocados`;
      return Number(r.realocados);
    } catch (erro) {
      traduzir(erro);
    }
  });
}

export async function setCategoriaPadrao(
  sql: Sql,
  actor: AuthenticatedActor,
  id: string,
): Promise<void> {
  recusarSeOmitida(actor, id);
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      await tx`select ideworks.set_default_category(${id})`;
    } catch (erro) {
      traduzir(erro);
    }
  });
}

/* ─────────────────────────── etiquetas ─────────────────────────── */

export async function saveEtiqueta(
  sql: Sql,
  actor: AuthenticatedActor,
  id: string | null,
  entrada: { name?: string; color?: string },
): Promise<string> {
  const name = conferirNome(entrada.name);
  const color = conferirCor(entrada.color ?? '#6b7280', 'Cor');

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const linhas = id
        ? await tx`
            update ideworks.client_tags set name = ${name}, color = ${color}
             where id = ${id} returning id`
        : await tx`
            insert into ideworks.client_tags (name, color)
            values (${name}, ${color}) returning id`;

      if (linhas.length === 0) {
        throw new CatalogoRefused('Só administrador mexe nas etiquetas.', 403);
      }
      return linhas[0].id as string;
    } catch (erro) {
      if (erro instanceof CatalogoRefused) throw erro;
      traduzir(erro);
    }
  });
}

export async function deleteEtiqueta(
  sql: Sql,
  actor: AuthenticatedActor,
  id: string,
): Promise<void> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      // Diferente de plano e categoria: a etiqueta some junto com as
      // atribuições, por cascata. Não há cliente "sem etiqueta" a realocar.
      const apagadas = await tx`delete from ideworks.client_tags where id = ${id} returning id`;
      if (apagadas.length === 0) {
        throw new CatalogoRefused('Etiqueta não encontrada, ou você não pode apagá-la.', 403);
      }
    } catch (erro) {
      if (erro instanceof CatalogoRefused) throw erro;
      traduzir(erro);
    }
  });
}

/** Devolve quantos vínculos foram movidos para a etiqueta de destino. */
export async function mergeEtiquetas(
  sql: Sql,
  actor: AuthenticatedActor,
  de: string,
  para: string,
): Promise<number> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const [r] = await tx`select ideworks.merge_tags(${de}, ${para}) as movidos`;
      return Number(r.movidos);
    } catch (erro) {
      traduzir(erro);
    }
  });
}

/** Troca a lista de etiquetas de um cliente. Exige enxergar, não administrar. */
export async function setEtiquetasDoCliente(
  sql: Sql,
  actor: AuthenticatedActor,
  clientId: string,
  tagIds: string[],
): Promise<void> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      await tx`select ideworks.set_client_tags(${clientId}, ${arrayOuNulo(tagIds)}::uuid[])`;
    } catch (erro) {
      traduzir(erro);
    }
  });
}
