/**
 * O BANCO DA RECLASSIFICAÇÃO DE EXTRAS — F44, Fase 4. Leitura (`lerOsExtras`),
 * a escrita (`aplicarReclassificacao`) e a volta (`desfazerReclassificacao`).
 * Quem decide é `extras.ts`.
 *
 * Todas recebem o `tx` de quem chama, já com o ator declarado: o script
 * (`scripts/reclassificar-extras.mjs`) e o teste em PGlite usam as mesmas.
 *
 * O INSTANTE VIAJA COMO TEXTO, COM MICROSSEGUNDO
 *   `created_at` e `updated_at` saem como ISO em UTC com seis casas. O `Date`
 *   do JS só guarda milissegundo — a lição da F25 — e o desfazer compara o
 *   `updated_at` gravado com o que a aplicação deixou: com três casas, nunca
 *   seria igual.
 */

import type { Tx } from '@/server/db';

import {
  type GrupoComExtra,
  type LinhaDoCadastro,
  type LinhaDoContrato,
  type PecaLida,
  planejarReclassificacao,
} from './extras';

type Linha = Record<string, unknown>;

/**
 * O instante por extenso: ISO com microssegundo e "Z". O "Z" só é verdade com
 * o relógio da transação em UTC — por isso toda função daqui que escreve
 * instante começa por `relogioEmUtc`.
 */
const ISO = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

/**
 * Fixa o fuso DA TRANSAÇÃO em UTC (`set_config(…, true)` morre no fim dela —
 * no agrupador do Supabase, em modo transação, é o único jeito que serve).
 *
 * Por que não a coluna `at time zone` UTC: aqui não se corta DIA nenhum, só se
 * escreve o instante por extenso; mas a guarda de
 * `test/o-dia-da-peca-e-o-de-sao-paulo.test.ts` proíbe a expressão em `src/`
 * inteiro, de propósito, para o dia da peça nunca voltar a sair do UTC. Com o
 * fuso fixado o texto é o mesmo, e a guarda fica sem exceção.
 */
async function relogioEmUtc(tx: Tx): Promise<void> {
  await tx`select set_config('TimeZone', 'UTC', true)`;
}

/** Cliente ativo, com a empresa — só para o relatório dizer de quem é. */
export type ClienteDoRelatorio = { id: string; name: string; company: string | null };

export type DadosLidos = {
  clientes: ClienteDoRelatorio[];
  pecas: PecaLida[];
  contratos: LinhaDoContrato[];
  cadastro: LinhaDoCadastro[];
};

/**
 * Lê o necessário para decidir, só de clientes ATIVOS — cliente inativo é
 * cancelado, e cancelado fica fora de tudo (regra da casa desde a F38).
 *
 * @param aPartirDe `AAAA-MM-01`: peças e contratos de meses antes dele não vêm.
 *                  `null` = todos os meses.
 */
export async function lerOsExtras(tx: Tx, aPartirDe: string | null): Promise<DadosLidos> {
  await relogioEmUtc(tx);
  const clientes = (await tx`
    select c.id::text as id, c.name, cat.name as company
      from ideworks.clients c
      left join ideworks.client_categories cat on cat.id = c.category_id
     where c.is_active
     order by c.name
  `) as unknown as Linha[];

  const pecas = (await tx`
    select i.id::text                                   as id,
           i.client_id::text                            as client_id,
           to_char(i.reference_month, 'YYYY-MM-DD')     as reference_month,
           i.content_type::text                         as content_type,
           i.is_extra,
           i.title,
           to_char(i.created_at, ${ISO})                as created_at,
           to_char(i.updated_at, ${ISO})                as updated_at
      from ideworks.content_items i
      join ideworks.clients c on c.id = i.client_id and c.is_active
     where (${aPartirDe}::date is null or i.reference_month >= ${aPartirDe}::date)
  `) as unknown as Linha[];

  // Junção à esquerda: o mês aberto SEM item ainda é "aberto, cota zero" (F17.57).
  const contratos = (await tx`
    select mc.client_id::text                           as client_id,
           to_char(mc.reference_month, 'YYYY-MM-DD')    as reference_month,
           to_char(mc.opened_at, ${ISO})                as opened_at,
           i.content_type::text                         as content_type,
           i.quantity
      from ideworks.month_contracts mc
      join ideworks.clients c on c.id = mc.client_id and c.is_active
      left join ideworks.month_contract_items i on i.contract_id = mc.id
     where (${aPartirDe}::date is null or mc.reference_month >= ${aPartirDe}::date)
  `) as unknown as Linha[];

  const cadastro = (await tx`
    select q.client_id::text as client_id, q.content_type::text as content_type, q.quantity
      from ideworks.client_quotas q
      join ideworks.clients c on c.id = q.client_id and c.is_active
     where q.quantity > 0
  `) as unknown as Linha[];

  return {
    clientes: clientes.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      company: (r.company as string | null) ?? null,
    })),
    pecas: pecas.map((r) => ({
      id: r.id as string,
      clientId: r.client_id as string,
      referenceMonth: r.reference_month as string,
      contentType: r.content_type as string,
      isExtra: r.is_extra === true,
      title: (r.title as string | null) ?? null,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    })),
    contratos: contratos.map((r) => ({
      clientId: r.client_id as string,
      referenceMonth: r.reference_month as string,
      openedAt: r.opened_at as string,
      contentType: (r.content_type as string | null) ?? null,
      quantity: Number(r.quantity ?? 0),
    })),
    cadastro: cadastro.map((r) => ({
      clientId: r.client_id as string,
      contentType: r.content_type as string,
      quantity: Number(r.quantity),
    })),
  };
}

/* ───────────────────────────── o arquivo de desfazer ───────────────────────────── */

/** Uma peça que a aplicação mudou: o antes e o depois, para voltar. */
export type PecaReclassificada = {
  id: string;
  clientId: string;
  referenceMonth: string;
  contentType: string;
  antes: { isExtra: true; updatedAt: string };
  depois: { isExtra: false; updatedAt: string };
};

/** O que `--aplicar` grava em disco e `--desfazer` lê. */
export type RegistroDeDesfazer = {
  tipo: 'reclassificar-extras';
  versao: 1;
  aplicadoEm: string;
  /** O recorte de meses da aplicação; `null` = com `--incluir-passados`. */
  aPartirDe: string | null;
  pecas: PecaReclassificada[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

/**
 * Confere o arquivo antes de desfazer: o que não tem a forma de um registro
 * desta aplicação é recusado com o motivo, e nada vai ao banco.
 */
export function validarRegistro(conteudo: unknown): RegistroDeDesfazer {
  const r = conteudo as Partial<RegistroDeDesfazer> | null;
  if (!r || typeof r !== 'object' || r.tipo !== 'reclassificar-extras' || r.versao !== 1) {
    throw new Error('O arquivo não é um registro de reclassificar-extras (versão 1).');
  }
  if (!Array.isArray(r.pecas) || r.pecas.length === 0) {
    throw new Error('O registro não tem peças: não há o que desfazer.');
  }
  const vistos = new Set<string>();
  r.pecas.forEach((p, i) => {
    const ok =
      p &&
      typeof p.id === 'string' &&
      UUID.test(p.id) &&
      p.antes?.isExtra === true &&
      p.depois?.isExtra === false &&
      typeof p.antes.updatedAt === 'string' &&
      INSTANTE.test(p.antes.updatedAt) &&
      typeof p.depois.updatedAt === 'string' &&
      INSTANTE.test(p.depois.updatedAt);
    if (!ok) throw new Error(`A peça ${i + 1} do registro não tem a forma esperada (id, antes, depois).`);
    if (vistos.has(p.id)) throw new Error(`A peça ${p.id} aparece duas vezes no registro.`);
    vistos.add(p.id);
  });
  return r as RegistroDeDesfazer;
}

/* ───────────────────────────── aplicar ───────────────────────────── */

/**
 * Grava `is_extra = false` nas peças que o plano manda para a base, dentro da
 * transação de quem chama, e devolve o registro para desfazer. Nada a mudar →
 * `null` (e nenhum arquivo a gravar).
 *
 * Só muda quem AINDA é extra. Se o banco mudar menos peças do que o plano —
 * alguém apagou ou mexeu numa delas entre a leitura e a gravação —, lança: a
 * transação de quem chama é desfeita inteira, e nada fica pela metade.
 */
export async function aplicarReclassificacao(
  tx: Tx,
  grupos: readonly GrupoComExtra[],
  aPartirDe: string | null,
  agora: Date = new Date(),
): Promise<RegistroDeDesfazer | null> {
  const alvo = grupos.flatMap((g) => g.viramBase);
  if (alvo.length === 0) return null;
  const ids = alvo.map((p) => p.id);

  await relogioEmUtc(tx);
  const linhas = (await tx`
    update ideworks.content_items
       set is_extra = false, updated_at = now()
     where id = any(${ids}::uuid[]) and is_extra
    returning id::text as id,
              to_char(updated_at, ${ISO}) as updated_at
  `) as unknown as Linha[];

  if (linhas.length !== ids.length) {
    throw new Error(
      `O plano mandava ${ids.length} peça(s) para a base e o banco mudou ${linhas.length}: ` +
        'alguma foi apagada ou mudou entre a leitura e a gravação. Nada foi gravado; rode de novo.',
    );
  }
  const depoisDe = new Map(linhas.map((l) => [l.id as string, l.updated_at as string]));

  return {
    tipo: 'reclassificar-extras',
    versao: 1,
    aplicadoEm: agora.toISOString(),
    aPartirDe,
    pecas: alvo.map((p) => ({
      id: p.id,
      clientId: p.clientId,
      referenceMonth: p.referenceMonth,
      contentType: p.contentType,
      antes: { isExtra: true, updatedAt: p.updatedAt },
      depois: { isExtra: false, updatedAt: depoisDe.get(p.id) as string },
    })),
  };
}

/**
 * Ler, decidir e gravar na MESMA transação — o caminho de `--aplicar`. Decidir
 * sobre uma leitura de outra transação deixaria passar uma peça criada no meio.
 */
export async function reclassificarExtras(
  tx: Tx,
  aPartirDe: string | null,
  agora: Date = new Date(),
): Promise<{ dados: DadosLidos; grupos: GrupoComExtra[]; registro: RegistroDeDesfazer | null }> {
  const dados = await lerOsExtras(tx, aPartirDe);
  const grupos = planejarReclassificacao({ ...dados, aPartirDe });
  const registro = await aplicarReclassificacao(tx, grupos, aPartirDe, agora);
  return { dados, grupos, registro };
}

/* ───────────────────────────── desfazer ───────────────────────────── */

export type ResultadoDoDesfazer = {
  /** Voltaram a ser extra. */
  desfeitas: number;
  /** Já eram extra de novo (desfeitas antes): nada a fazer. */
  jaEramExtra: string[];
  /** Não existem mais (apagadas depois da aplicação). */
  sumiram: string[];
};

/**
 * Volta as peças do registro a `is_extra = true`, dentro da transação de quem
 * chama. Idempotente: a que já é extra de novo fica como está.
 *
 * O `updated_at` volta ao de antes SÓ se ninguém mexeu na peça depois da
 * aplicação (o carimbo ainda é o que ela deixou). Se mexeram — deu ✓, ganhou
 * dia —, o carimbo vira `now()`: apagá-lo esconderia a mudança de quem mexeu.
 */
export async function desfazerReclassificacao(tx: Tx, registro: RegistroDeDesfazer): Promise<ResultadoDoDesfazer> {
  const ids = registro.pecas.map((p) => p.id);
  const antes = registro.pecas.map((p) => p.antes.updatedAt);
  const depois = registro.pecas.map((p) => p.depois.updatedAt);

  const voltaram = (await tx`
    update ideworks.content_items c
       set is_extra = true,
           updated_at = case when c.updated_at = d.depois then d.antes else now() end
      from unnest(${ids}::uuid[], ${antes}::timestamptz[], ${depois}::timestamptz[]) as d(id, antes, depois)
     where c.id = d.id and not c.is_extra
    returning c.id::text as id
  `) as unknown as Linha[];

  const desfeitas = new Set(voltaram.map((l) => l.id as string));
  const resto = ids.filter((id) => !desfeitas.has(id));
  const existem =
    resto.length === 0
      ? new Set<string>()
      : new Set(
          ((await tx`select id::text as id from ideworks.content_items where id = any(${resto}::uuid[])`) as unknown as Linha[]).map(
            (l) => l.id as string,
          ),
        );

  return {
    desfeitas: desfeitas.size,
    jaEramExtra: resto.filter((id) => existem.has(id)),
    sumiram: resto.filter((id) => !existem.has(id)),
  };
}
