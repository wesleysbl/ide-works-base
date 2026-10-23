/**
 * Administração de pessoas — etapa F12.
 *
 * TODA A REGRA ESTÁ NO BANCO, E ESTE ARQUIVO NÃO A REPETE
 *   Quem pode ver a lista, quem pode mudar papel, quem não pode se rebaixar —
 *   tudo isso é conferido dentro das funções com dono. Aqui não há um único
 *   `if (actor.isSuperadmin)`.
 *
 *   Repetir a regra criaria uma segunda verdade para manter em dia, e a que
 *   estivesse errada seria justamente a que ninguém olhou. Além disso, uma
 *   conferência de aplicação protege só o caminho que passa por ela; a do banco
 *   protege todos.
 *
 * O QUE ESTE ARQUIVO FAZ
 *   Traduz recusa do banco em resposta de HTTP, e nada mais.
 */

import { expiresAt, generateCode, hashCode } from '@/auth/activation-code';
import { type Papel } from '@/auth/papeis';
import { decidePasswordReset } from '@/auth/password-reset';
import { type Sql, type Tx, arrayOuNulo, withActor } from '@/server/db';
import { idsOmitidos, recorteAtivo, recorteDasOmitidas } from '@/server/omitidas';
import { resetPorts } from '@/server/ports';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

export class PessoaRefused extends Error {
  readonly status: 400 | 403 | 404;

  constructor(message: string, status: 400 | 403 | 404) {
    super(message);
    this.name = 'PessoaRefused';
    this.status = status;
  }
}

function traduzir(erro: unknown): never {
  const e = erro as { code?: string; message?: string };
  if (e.code === '42501') throw new PessoaRefused(e.message ?? 'Sem permissão.', 403);
  throw erro;
}

export type Pessoa = {
  id: string;
  email: string;
  nome: string | null;
  papel: Papel;
  isSuperadmin: boolean;
  isActive: boolean;
  todosOsClientes: boolean;
  /** Quantos clientes na carteira. Zero com `todosOsClientes` não é limitação. */
  clientes: number;
  criadaEm: string | null;
  /** As partes do sistema que a pessoa alcanca — F13. */
  areas: string[];
  /** De quantas EMPRESAS ela participa — F14. */
  empresas: number;
};

export async function readPessoas(
  sql: Sql,
  actor: AuthenticatedActor,
): Promise<{ pessoas: Pessoa[]; eu: string }> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const linhas = await tx`select * from ideworks.admin_directory()`;
      const omitidos = await contarOmitidosPorPessoa(tx, actor);
      return {
        pessoas: linhas.map(
          (r): Pessoa => ({
            id: r.id as string,
            email: r.email as string,
            nome: (r.full_name as string | null) ?? null,
            papel: (r.role as Papel | null) ?? 'funcionario',
            isSuperadmin: Boolean(r.is_superadmin),
            isActive: Boolean(r.is_active),
            todosOsClientes: Boolean(r.has_all_clients_access),
            areas: (r.areas as string[] | null) ?? [],
            // F31, Fase 3a — as contagens do cartão batem com a janela, que
            // não mostra unidade nem cliente de empresa omitida.
            clientes: Number(r.clientes) - (omitidos.get(`cliente:${r.id as string}`) ?? 0),
            empresas: Number(r.empresas) - (omitidos.get(`empresa:${r.id as string}`) ?? 0),
            criadaEm:
              r.created_at === null ? null : new Date(r.created_at as string).toISOString(),
          }),
        ),
        // Quem está olhando. A tela usa para marcar "você" e para não oferecer
        // os botões que o banco vai recusar de qualquer jeito.
        eu: actor.userId,
      };
    } catch (erro) {
      traduzir(erro);
    }
  });
}

/**
 * Quantas unidades e clientes de empresa OMITIDA cada pessoa tem — F31, Fase 3a.
 *
 * O cartão de Pessoas mostra "Unidades 2" e "Clientes 5" a partir de
 * `admin_directory`, que conta tudo; a janela que abre dali não mostra o que é
 * omitido. Sem descontar, o cartão diria 2 e a janela "1 marcado(s)". Os
 * conjuntos são os MESMOS das janelas (`readEmpresas`, `readCarteira` via
 * `clientesOmitidosDaCarteira`), sob a política de quem administra.
 *
 * Uma consulta, na transação da leitura; desligada, nenhuma.
 */
async function contarOmitidosPorPessoa(
  tx: Tx,
  actor: AuthenticatedActor,
): Promise<Map<string, number>> {
  const contagem = new Map<string, number>();
  if (!recorteAtivo(actor)) return contagem;
  const ids = idsOmitidos(actor);
  const linhas = await tx`
    select 'empresa' as tipo, uc.user_id, count(*)::int as n
      from ideworks.user_categories uc
     where uc.category_id = any(${ids}::uuid[])
     group by uc.user_id
    union all
    select 'cliente' as tipo, uc.user_id, count(*)::int as n
      from ideworks.user_clients uc
      join ideworks.clients c on c.id = uc.client_id
     where c.category_id = any(${ids}::uuid[])
     group by uc.user_id`;
  for (const l of linhas) contagem.set(`${l.tipo as string}:${l.user_id as string}`, Number(l.n));
  return contagem;
}

export async function readCarteira(
  sql: Sql,
  actor: AuthenticatedActor,
  userId: string,
): Promise<{ clientes: { id: string; nome: string }[] }> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      // F31, Fase 3a — a carteira mostrada não tem cliente de empresa omitida.
      // Ele não some da carteira de verdade: `setCarteira` o devolve no
      // salvamento. O recorte é o MESMO conjunto que lá é preservado
      // (`clientesOmitidosDaCarteira`), para o que sai da vista ser exatamente
      // o que volta — nem um a mais, nem um a menos.
      // Desligada, a consulta sai idêntica à de antes (o recorte é vazio);
      // ligada, a ordem da função é repetida porque o filtro vem depois dela.
      const linhas = await tx`
        select * from ideworks.admin_user_clients(${userId})
         ${recorteDasOmitidas(
           tx,
           actor,
           (ids) => tx`where client_id <> all(${clientesOmitidosDaCarteira(tx, userId, ids)})
                       order by lower(name)`,
         )}`;
      return {
        clientes: linhas.map((r) => ({ id: r.client_id as string, nome: r.name as string })),
      };
    } catch (erro) {
      traduzir(erro);
    }
  });
}

/**
 * Os clientes de empresa OMITIDA na carteira da pessoa, como `uuid[]` — F31,
 * Fase 3a.
 *
 * Um conjunto só para as duas pontas: `readCarteira` tira estes da vista e
 * `setCarteira` os devolve no salvamento. Sob a política de quem administra:
 * cliente que ele não enxerga não entra aqui — e por isso também não sai da
 * vista (a função da carteira é `security definer` e o mostra como sempre),
 * volta marcado da tela e fica. Nenhum dos dois caminhos perde cliente.
 *
 * ⚠️ FRAGMENTO NÃO SE ESPERA — síncrona de propósito, como `recorteDasOmitidas`.
 */
function clientesOmitidosDaCarteira(tx: Tx, userId: string, ids: readonly string[]) {
  return tx`array(
    select uc.client_id
      from ideworks.user_clients uc
      join ideworks.clients c on c.id = uc.client_id
     where uc.user_id = ${userId}
       and c.category_id = any(${[...ids]}::uuid[]))`;
}

/**
 * Os clientes que dá para colocar numa carteira.
 *
 * Lista leve de propósito: o cockpit devolve cada cliente com medidor, cota e
 * entrega do período — dezenas de campos para uma tela que só precisa de nome
 * e identificador. Reaproveitá-lo aqui faria a escolha de carteira pagar o
 * preço do painel inteiro.
 *
 * Sem conferência de papel: a política de `clients` já decide quem vê o quê, e
 * quem administra vê todos.
 */
export async function readClientesParaCarteira(
  sql: Sql,
  actor: AuthenticatedActor,
): Promise<{ clientes: { id: string; nome: string }[] }> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    // F31 — esta lista também é o seletor de cliente do "Marcar no dia" do
    // Calendário: cliente de empresa omitida não é oferecido. Na carteira de
    // Pessoas, quem já o tem continua com ele — a janela guarda os marcados
    // que não aparecem e os devolve no salvamento.
    const linhas = await tx`
      select c.id, c.name from ideworks.clients c
       where c.is_active
         ${recorteDasOmitidas(tx, actor, (ids) => tx`and c.category_id <> all(${ids}::uuid[])`)}
       order by lower(c.name)`;
    return { clientes: linhas.map((r) => ({ id: r.id as string, nome: r.name as string })) };
  });
}

export async function setPapel(
  sql: Sql,
  actor: AuthenticatedActor,
  userId: string,
  papel: Papel,
  todosOsClientes: boolean,
): Promise<void> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      await tx`select ideworks.set_user_role(
        ${userId}, ${papel}::ideworks.papel, ${todosOsClientes})`;
    } catch (erro) {
      traduzir(erro);
    }
  });
}

/**
 * Apaga a pessoa do IDE Works — so super admin.
 *
 * O QUE ISTO APAGA, E O QUE NAO APAGA
 *   Apaga o PERFIL, e com ele a carteira e as empresas por cascata. A pessoa
 *   deixa de entrar aqui.
 *
 *   NAO apaga de `auth.users`, e nao pode: aquele cadastro e COMPARTILHADO com
 *   o Sistema IDE em producao. Apagar de la tiraria a pessoa do sistema antigo
 *   tambem — que ninguem pediu, e que nao teria volta.
 */
export async function apagarPessoa(
  sql: Sql,
  actor: AuthenticatedActor,
  userId: string,
): Promise<void> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      await tx`select ideworks.delete_user(${userId})`;
    } catch (erro) {
      traduzir(erro);
    }
  });
}

/** De quais empresas a pessoa participa. */
export async function readEmpresas(
  sql: Sql,
  actor: AuthenticatedActor,
  userId: string,
): Promise<{ empresas: { id: string; nome: string }[] }> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      // F31, Fase 3a — a unidade omitida não aparece na ficha da pessoa; se
      // ela a tiver, `setEmpresas` a devolve no salvamento.
      const linhas = await tx`
        select * from ideworks.admin_user_categories(${userId})
         ${recorteDasOmitidas(
           tx,
           actor,
           (ids) => tx`where category_id <> all(${ids}::uuid[]) order by lower(name)`,
         )}`;
      return {
        empresas: linhas.map((r) => ({ id: r.category_id as string, nome: r.name as string })),
      };
    } catch (erro) {
      traduzir(erro);
    }
  });
}

export async function setEmpresas(
  sql: Sql,
  actor: AuthenticatedActor,
  userId: string,
  ids: readonly string[],
): Promise<{ total: number }> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      // F31, Fase 3a — O VÍNCULO COM A UNIDADE OMITIDA NÃO SE APAGA SEM QUERER.
      //
      // A tela não mostra a unidade omitida (nem na lista oferecida, nem entre
      // as marcadas), então a lista que chega aqui nunca a traz. Sem isto,
      // salvar as unidades de quem a tem apagaria o vínculo — e "omitir não é
      // apagar". Ela entra de volta antes de a lista valer.
      //
      // SÓ A QUE QUEM SALVA PODERIA DAR (`can_grant_categories`). A que ele
      // não pode dar o banco já preserva sozinho (F17.36c, "o que ela tem fora
      // do meu alcance fica") — e mandá-la seria pedir o que o banco recusa.
      //
      // Na MESMA transação do salvamento: nenhuma ida a mais ao pool.
      let pedidas = [...ids];
      if (recorteAtivo(actor)) {
        const mantidas = await tx`
          select uc.category_id
            from ideworks.user_categories uc
           where uc.user_id = ${userId}
             and uc.category_id = any(${idsOmitidos(actor)}::uuid[])
             and ideworks.can_grant_categories(array[uc.category_id])`;
        pedidas = [...new Set([...pedidas, ...mantidas.map((m) => m.category_id as string)])];
      }
      const [r] = await tx`
        select ideworks.set_user_categories(${userId}, ${arrayOuNulo(pedidas)}::uuid[]) as total`;
      return { total: Number(r.total) };
    } catch (erro) {
      traduzir(erro);
    }
  });
}

/**
 * A fila: os codigos que existem e ainda nao foram usados.
 *
 * No legado havia fila de APROVACAO, porque qualquer um se cadastrava e alguem
 * auditava depois. Aqui nao ha autocadastro (decisao D3), entao a fila e outra
 * coisa. O que se faz nela e cobrar quem nao entrou, ou cancelar o codigo.
 *
 * DESDE A F17.31 ELA MOSTRA OS DOIS TIPOS, e a intencao diz qual e qual. Um
 * codigo de senha pendente nao e "alguem esperando para entrar" — mas e
 * CREDENCIAL VIVA, com 72 horas de validade. Escondido, ninguem o cancelaria.
 *
 * ⚠️ SAO DOIS TIPOS, E NAO TRES — F17.39. A terceira intencao existe no banco
 * (`invite_with_password`, o convite de quem ja tem conta), e a fila NAO a
 * enxerga: `ideworks.admin_pending_invitations` devolve o TIPO do codigo, e nao
 * a intencao crua. Distinguir os dois convites aqui contaria a quem administra
 * quais convidados ja tinham conta de login — o oraculo que a F17.34 fechou.
 * A guarda mora na funcao do banco, e nao nesta linha.
 */
export async function readFila(
  sql: Sql,
  actor: AuthenticatedActor,
): Promise<{
  convites: {
    id: string;
    email: string;
    expiraEm: string;
    tentativasFalhas: number;
    criadoEm: string;
    vencido: boolean;
    /** `invite` da acesso; `reset` deixa escolher senha nova — F17.31. */
    intencao: 'invite' | 'reset';
  }[];
}> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const linhas = await tx`select * from ideworks.admin_pending_invitations()`;
      return {
        convites: linhas.map((r) => ({
          id: r.id as string,
          email: r.email as string,
          expiraEm: new Date(r.expires_at as string).toISOString(),
          tentativasFalhas: Number(r.failed_attempts),
          criadoEm: new Date(r.created_at as string).toISOString(),
          vencido: Boolean(r.vencido),
          // O codigo de senha entra na fila desde a F17.31: pendente, ele e
          // credencial viva, e escondido ninguem o cancelaria. Desde a F17.39
          // a funcao ja devolve so `invite` ou `reset` — ver o cabecalho.
          intencao: r.purpose as 'invite' | 'reset',
        })),
      };
    } catch (erro) {
      traduzir(erro);
    }
  });
}

export async function cancelarConvite(
  sql: Sql,
  actor: AuthenticatedActor,
  id: string,
): Promise<void> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      await tx`select ideworks.revoke_invitation(${id})`;
    } catch (erro) {
      traduzir(erro);
    }
  });
}

export async function setAtivo(
  sql: Sql,
  actor: AuthenticatedActor,
  userId: string,
  ativo: boolean,
): Promise<void> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      await tx`select ideworks.set_user_active(${userId}, ${ativo})`;
    } catch (erro) {
      traduzir(erro);
    }
  });
}

export async function setAreas(
  sql: Sql,
  actor: AuthenticatedActor,
  userId: string,
  areas: readonly string[],
): Promise<void> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      // `arrayOuNulo` pelo mesmo motivo de sempre: lista vazia chega ao
      // Postgres como string vazia e ele recusa. E vazia e o caso real —
      // tirar todas as areas de alguem.
      await tx`select ideworks.set_user_areas(
        ${userId}, ${arrayOuNulo(areas)}::ideworks.area[])`;
    } catch (erro) {
      traduzir(erro);
    }
  });
}

/**
 * As empresas que quem esta perguntando pode REPARTIR — F14, recortada na
 * F17.36c.
 *
 * Ela alimenta dois lugares: o bloco de empresas do convite e o editor de
 * empresas da ficha da pessoa. Os dois oferecem uma escolha, e oferecer o que
 * o banco vai recusar e porta pintada na parede.
 *
 * ⚠️ ISTO NAO E A TRAVA, E A REGRA NAO ESTA ESCRITA AQUI. Quem responde e
 * `ideworks.can_grant_categories`, a MESMA funcao que a ficha da pessoa e a
 * politica de escrita do convite consultam. Reescrever a condicao neste arquivo
 * criaria uma segunda verdade, e a errada seria a que ninguem olhou.
 */
export async function readTodasEmpresas(
  sql: Sql,
  actor: AuthenticatedActor,
): Promise<{ empresas: { id: string; nome: string }[] }> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    // F31, Fase 3a — Pessoas e Convite não oferecem a unidade omitida. Não é
    // trava (um pedido montado à mão ainda passa pelo banco como antes); é o
    // "só Ide na tela". O vínculo de quem já a tem é preservado em `setEmpresas`.
    const linhas = await tx`
      select c.id, c.name
        from ideworks.client_categories c
       where ideworks.can_grant_categories(array[c.id])
         ${recorteDasOmitidas(tx, actor, (ids) => tx`and c.id <> all(${ids}::uuid[])`)}
       order by c.sort_order, lower(c.name)`;
    return { empresas: linhas.map((r) => ({ id: r.id as string, nome: r.name as string })) };
  });
}

export async function setCarteira(
  sql: Sql,
  actor: AuthenticatedActor,
  userId: string,
  clientIds: readonly string[],
): Promise<{ total: number }> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      // `arrayOuNulo` e não a lista direta: uma lista VAZIA chega ao Postgres
      // como string vazia e ele recusa com "malformed array literal". E lista
      // vazia é justamente o caso comum aqui — esvaziar a carteira de alguém.
      // A função do banco faz `coalesce(..., '{}')`, então nulo e vazio
      // significam a mesma coisa lá dentro.
      //
      // F31, Fase 3a — O CLIENTE OMITIDO DA CARTEIRA VOLTA NO SALVAMENTO.
      // `set_user_clients` apaga a carteira inteira e grava a lista recebida;
      // a tela não mostra o cliente de empresa omitida (`readCarteira`), então
      // sem isto salvar a carteira o apagaria. Mesma transação: nenhuma ida a
      // mais ao pool.
      let pedidos = [...clientIds];
      if (recorteAtivo(actor)) {
        const mantidos = await tx`
          select unnest(${clientesOmitidosDaCarteira(tx, userId, idsOmitidos(actor))}) as id`;
        pedidos = [...new Set([...pedidos, ...mantidos.map((m) => m.id as string)])];
      }
      const [r] = await tx`
        select ideworks.set_user_clients(${userId}, ${arrayOuNulo(pedidos)}::uuid[]) as total`;
      return { total: Number(r.total) };
    } catch (erro) {
      traduzir(erro);
    }
  });
}

/**
 * Gera o codigo que deixa a pessoa escolher uma senha nova — F17.31.
 *
 * ⚠️ O CODIGO VOLTA UMA VEZ SO, e nao fica guardado em lugar nenhum: o banco
 * guarda a impressao digital dele. Quem chamou entrega a mao, pela mesma via do
 * convite. Nao ha envio automatico — decisao da F1.6, e um caminho de
 * recuperacao a mais e um caminho de invasao a mais.
 *
 * ⚠️ ESTA FUNCAO NAO ESCREVE SENHA NENHUMA, e nao tem como. Ela emite o codigo;
 * a senha e escrita depois, por quem tem o codigo, e o administrador nunca a
 * sabe. Foi essa a decisao do usuario nesta etapa, e a alternativa —
 * administrador digita a senha e entrega — desmentiria a frase impressa no
 * proprio convite.
 *
 * AS DUAS VERDADES, E POR QUE NAO SAO REPETICAO
 *   `decidePasswordReset` decide e escreve a FRASE que a pessoa le; a funcao do
 *   banco tem o PODER e recusa por conta propria, com as mesmas regras. Se a
 *   decisao daqui sumisse, a de la continuaria de pe — o contrario nao vale, e
 *   e por isso que a guarda mora la.
 */
export async function gerarRedefinicao(
  sql: Sql,
  actor: AuthenticatedActor,
  userId: string,
): Promise<{ code: string; expiresAt: string; email: string; revogados: number }> {
  const decisao = await decidePasswordReset(
    {
      targetUserId: userId,
      targetEmail: '',
      actorUserId: actor.userId,
      actorEmail: actor.email,
    },
    // O crachá INTEIRO, não só o id: `profiles_select` passou a olhar empresa
    // na F17.34, e um crachá remontado aqui perderia o `isSuper` do dono.
    resetPorts(sql, actor),
  );

  if (!decisao.ok) {
    // 403 para o autoatendimento (a regra funcionando), 404 para quem nao tem
    // perfil (o alvo nao existe). Nenhum dos dois e defeito do servidor.
    throw new PessoaRefused(
      decisao.message,
      decisao.reason === 'self_service_not_allowed' ? 403 : 404,
    );
  }

  const code = generateCode();
  const hash = await hashCode(code);
  const prazo = expiresAt();

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const [linha] = await tx`
        select * from ideworks.issue_password_reset(${userId}, ${hash}, ${prazo})`;
      return {
        code,
        expiresAt: prazo.toISOString(),
        email: linha.target_email as string,
        revogados: Number(linha.revoked_count),
      };
    } catch (erro) {
      traduzir(erro);
    }
  });
}
