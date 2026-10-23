/**
 * A SEGUNDA TRANCA DAS CONEXÕES DE IA, CONTRA UM POSTGRES DE VERDADE — F44, Fase 5.
 *
 * O QUE ESTE ARQUIVO MONTA
 *   As 25 tabelas que a migration tranca, com as políticas PERMISSIVAS de
 *   produção copiadas LITERALMENTE do retrato (`supabase/schema-esperado.json`)
 *   — o texto que roda hoje, não uma imitação. As funções de alcance da pessoa
 *   (`can_reach_task`, `can_see_client`, `can_act_on_chain`…) são dublês com a
 *   regra da EMPRESA (a pessoa alcança as empresas de `user_categories`; o topo,
 *   todas): o assunto aqui não é o alcance da pessoa, é o que a conexão soma a
 *   ele. A F16a (`integration_allows_company`/`_client`, a concessão) entra
 *   inteira, pelo arquivo dela. Depois, a F44_2, pelo arquivo dela.
 *
 * O QUE SE PROVA
 *   · sem conexão declarada, a tela não muda: o que cada pessoa vê nas 25
 *     tabelas é o mesmo antes e depois, as políticas permissivas ficam byte a
 *     byte, a escrita humana segue igual, e o EXPLAIN mostra os conjuntos da
 *     conexão "never executed";
 *   · com conexão, cada tabela mostra só a linha da empresa/cliente concedido,
 *     e nada além do que a pessoa já via;
 *   · nada que a IA lia dentro da concessão some: a regra de leitura do MCP
 *     (`companySql` + `clientSql`/`boardClientSql`, calculada pelas funções da
 *     F16a ANTES da migration) cabe inteira no que a tranca deixa passar —
 *     inclusive a tarefa MOVIDA (cliente próprio numa lista de outro cliente),
 *     cuja lista continua visível no `tree`;
 *   · escrita fora do recorte: update e delete não acham a linha; insert e
 *     mudança para fora são recusados (42501). Dentro, tudo passa;
 *   · concessão vazia, revogada ou de outro dono não vê nada;
 *   · a memória por comando de `integration_company_ids` responde o novo depois
 *     de a concessão mudar, e muda de dono quando muda a concessão declarada;
 *   · as 25 são RESTRITIVAS (uma permissiva com esse texto abriria tudo);
 *   · o rollback devolve o comportamento de antes, e a migration reaplica.
 *
 * NENHUMA REDE: o PGlite roda no próprio processo.
 */

import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MIGRATION = 'supabase/migrations/20261009100000_ideworks_f44_2_tranca_da_conexao.sql';
const ROLLBACK = 'supabase/rollback/20261009100000_ideworks_f44_2_tranca_da_conexao.sql';
const F16A = 'supabase/migrations/20260920235400_ideworks_f16a_concessoes.sql';
const RETRATO = 'supabase/schema-esperado.json';

const TABELAS = [
  'spaces',
  'folders',
  'lists',
  'tasks',
  'task_comments',
  'task_events',
  'task_assignees',
  'task_watchers',
  'task_tag_assignments',
  'task_checklists',
  'checklist_items',
  'task_links',
  'task_attachments',
  'approval_rounds',
  'approval_round_items',
  'clients',
  'mural_notes',
  'client_history',
  'history_documents',
  'content_items',
  'month_contracts',
  'month_contract_items',
  'client_quotas',
  'client_tag_assignments',
  'appointments',
] as const;
type Tabela = (typeof TABELAS)[number];

/* ───────────────────────────── o terreno ───────────────────────────── */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const A = id(1);
const B = id(2);
const C = id(3);
const EMPRESAS = [A, B, C];

const EU = id(901); // administra, alcança A e B
const TOPO = id(902); // o topo: alcança tudo
const OUTRA = id(903); // alcança só A

const A1 = id(11);
const A2 = id(12);
const B1 = id(21);
const C1 = id(31);
const EMPRESA_DO_CLIENTE: Record<string, string> = { [A1]: A, [A2]: A, [B1]: B, [C1]: C };

const SA = id(101);
const SB = id(102);
const SC = id(103);
const EMPRESA_DO_ESPACO: Record<string, string> = { [SA]: A, [SB]: B, [SC]: C };
const FA = id(111);
const FB = id(112);
const FC = id(113);
const ESPACO_DA_PASTA: Record<string, string> = { [FA]: SA, [FB]: SB, [FC]: SC };

type Lista = { space: string; folder: string | null; client: string | null };
const LA = id(121);
const LA_INT = id(122);
const LA2 = id(123);
const LB = id(124);
const LC = id(125);
const LISTAS: Record<string, Lista> = {
  [LA]: { space: SA, folder: FA, client: A1 },
  [LA_INT]: { space: SA, folder: null, client: null },
  [LA2]: { space: SA, folder: FA, client: A2 },
  [LB]: { space: SB, folder: FB, client: B1 },
  [LC]: { space: SC, folder: FC, client: C1 },
};

type Tarefa = { list: string | null; client: string | null; parent?: string };
const T_A = id(201);
const T_A_INT = id(202); // lista interna, sem cliente
const T_A_INT_A1 = id(203); // lista interna, cliente escolhido
const T_A2 = id(204);
const T_MOVIDA = id(205); // cliente A1 numa lista do cliente A2 (mover não troca cliente)
const T_CRUZADA = id(206); // lista da empresa A, cliente da empresa B
const T_B = id(207);
const T_B_SEM = id(208); // sem cliente próprio, numa lista do cliente B1
const T_SEM_LISTA_A = id(209); // demanda antiga, sem lista
const T_SEM_LISTA_B = id(210);
const T_C = id(211);
const SUB_A = id(212);
const TAREFAS: Record<string, Tarefa> = {
  [T_A]: { list: LA, client: A1 },
  [T_A_INT]: { list: LA_INT, client: null },
  [T_A_INT_A1]: { list: LA_INT, client: A1 },
  [T_A2]: { list: LA2, client: A2 },
  [T_MOVIDA]: { list: LA2, client: A1 },
  [T_CRUZADA]: { list: LA, client: B1 },
  [T_B]: { list: LB, client: B1 },
  [T_B_SEM]: { list: LB, client: null },
  [T_SEM_LISTA_A]: { list: null, client: A1 },
  [T_SEM_LISTA_B]: { list: null, client: B1 },
  [T_C]: { list: LC, client: C1 },
  [SUB_A]: { list: LA, client: A1, parent: T_A },
};
const clienteEfetivo = (t: Tarefa) => t.client ?? (t.list ? LISTAS[t.list].client : null);

/** Toda linha do terreno, e de quem ela depende — é daqui que o esperado sai. */
type Linha = { tabela: Tabela; id: string; dono: { tarefa?: string; cliente?: string; espaco?: string; empresa?: string; mae?: string } };
const linhas: Linha[] = [];
let sequencia = 5000;
const novo = () => id(sequencia++);

const SATELITES_DA_TAREFA = [
  'task_comments',
  'task_events',
  'task_assignees',
  'task_watchers',
  'task_tag_assignments',
  'task_checklists',
  'task_links',
  'task_attachments',
] as const;
const DO_CLIENTE = [
  'mural_notes',
  'client_history',
  'content_items',
  'month_contracts',
  'client_quotas',
  'client_tag_assignments',
  'appointments',
] as const;

for (const espaco of [SA, SB, SC]) linhas.push({ tabela: 'spaces', id: espaco, dono: { empresa: EMPRESA_DO_ESPACO[espaco] } });
for (const pasta of [FA, FB, FC]) linhas.push({ tabela: 'folders', id: pasta, dono: { espaco: ESPACO_DA_PASTA[pasta] } });
for (const [lista, l] of Object.entries(LISTAS)) linhas.push({ tabela: 'lists', id: lista, dono: { espaco: l.space } });
for (const tarefa of Object.keys(TAREFAS)) linhas.push({ tabela: 'tasks', id: tarefa, dono: { tarefa } });
for (const cliente of Object.keys(EMPRESA_DO_CLIENTE)) linhas.push({ tabela: 'clients', id: cliente, dono: { cliente } });

const CHECKLIST_DA_TAREFA: Record<string, string> = {};
const RODADA_DA_TAREFA: Record<string, string> = {};
for (const tarefa of Object.keys(TAREFAS)) {
  for (const tabela of SATELITES_DA_TAREFA) {
    const linha = { tabela, id: novo(), dono: { tarefa } };
    linhas.push(linha);
    if (tabela === 'task_checklists') CHECKLIST_DA_TAREFA[tarefa] = linha.id;
  }
  linhas.push({ tabela: 'checklist_items', id: novo(), dono: { tarefa, mae: CHECKLIST_DA_TAREFA[tarefa] } });
  if (clienteEfetivo(TAREFAS[tarefa])) {
    const rodada = novo();
    RODADA_DA_TAREFA[tarefa] = rodada;
    linhas.push({ tabela: 'approval_rounds', id: rodada, dono: { tarefa } });
    linhas.push({ tabela: 'approval_round_items', id: novo(), dono: { tarefa, mae: rodada } });
  }
}
const HISTORICO_DO_CLIENTE: Record<string, string> = {};
const CONTRATO_DO_CLIENTE: Record<string, string> = {};
for (const cliente of Object.keys(EMPRESA_DO_CLIENTE)) {
  for (const tabela of DO_CLIENTE) {
    const linha = { tabela, id: novo(), dono: { cliente } };
    linhas.push(linha);
    if (tabela === 'client_history') HISTORICO_DO_CLIENTE[cliente] = linha.id;
    if (tabela === 'month_contracts') CONTRATO_DO_CLIENTE[cliente] = linha.id;
  }
  linhas.push({ tabela: 'history_documents', id: novo(), dono: { cliente, mae: HISTORICO_DO_CLIENTE[cliente] } });
  linhas.push({ tabela: 'month_contract_items', id: novo(), dono: { cliente, mae: CONTRATO_DO_CLIENTE[cliente] } });
}

/* ───────────────────────────── as concessões ───────────────────────────── */

type Concessao = {
  id: string;
  owner: string;
  companies: string[] | null;
  clients: string[] | null;
  revoked?: boolean;
};
const G_A: Concessao = { id: id(301), owner: EU, companies: [A], clients: null };
const G_TUDO: Concessao = { id: id(302), owner: EU, companies: null, clients: null };
const G_CLI: Concessao = { id: id(303), owner: EU, companies: null, clients: [A1] };
const G_NADA: Concessao = { id: id(304), owner: EU, companies: [], clients: null };
const G_REVOGADA: Concessao = { id: id(305), owner: EU, companies: null, clients: null, revoked: true };
const G_ALHEIA: Concessao = { id: id(306), owner: OUTRA, companies: null, clients: null };
const G_TOPO_A: Concessao = { id: id(307), owner: TOPO, companies: [A], clients: null };
const G_TOPO_TUDO: Concessao = { id: id(308), owner: TOPO, companies: null, clients: null };
const CONCESSOES = [G_A, G_TUDO, G_CLI, G_NADA, G_REVOGADA, G_ALHEIA, G_TOPO_A, G_TOPO_TUDO];

type Ator = { nome: string; user: string; admin: boolean; top: boolean; grant: Concessao | null };
const humano = (nome: string, user: string, top = false): Ator => ({ nome, user, admin: true, top, grant: null });
/** A sessão declara o usuário `user`; a concessão pode ser de outro dono (G_ALHEIA). */
const agente = (nome: string, user: string, grant: Concessao, top = false): Ator => ({ nome, user, admin: true, top, grant });

const H_EU = humano('EU pela tela', EU);
const H_TOPO = humano('TOPO pela tela', TOPO, true);
const H_OUTRA = humano('OUTRA pela tela', OUTRA);
const HUMANOS = [H_EU, H_TOPO, H_OUTRA];
const AGENTES = [
  agente('EU com [A]', EU, G_A),
  agente('EU com tudo', EU, G_TUDO),
  agente('EU com cliente A1', EU, G_CLI),
  agente('EU com nenhuma empresa', EU, G_NADA),
  agente('EU com concessão revogada', EU, G_REVOGADA),
  agente('EU com concessão de OUTRA', EU, G_ALHEIA),
  agente('TOPO com [A]', TOPO, G_TOPO_A, true),
  agente('TOPO com tudo', TOPO, G_TOPO_TUDO, true),
];

/* ───────────────────────────── a regra, em TypeScript ───────────────────────────── */

const EMPRESAS_DA_PESSOA: Record<string, string[]> = { [EU]: [A, B], [TOPO]: [], [OUTRA]: [A] };
const alcanca = (ator: Ator, empresa: string | null) =>
  empresa !== null && (ator.top || EMPRESAS_DA_PESSOA[ator.user].includes(empresa));
const empresaDaLista = (lista: string) => EMPRESA_DO_ESPACO[LISTAS[lista].space];

/** O dublê de `can_reach_task`: pela lista OU pelo cliente. */
const pessoaVeTarefa = (ator: Ator, tarefa: string) => {
  const t = TAREFAS[tarefa];
  return (
    (t.list !== null && alcanca(ator, empresaDaLista(t.list))) ||
    (t.client !== null && alcanca(ator, EMPRESA_DO_CLIENTE[t.client]))
  );
};

function pessoaVe(ator: Ator, l: Linha): boolean {
  const d = l.dono;
  if (d.empresa) return alcanca(ator, d.empresa);
  if (d.espaco) return alcanca(ator, EMPRESA_DO_ESPACO[d.espaco]);
  if (d.tarefa) {
    if (l.tabela === 'approval_rounds' || l.tabela === 'approval_round_items') {
      const cliente = clienteEfetivo(TAREFAS[d.tarefa]) as string;
      return pessoaVeTarefa(ator, d.tarefa) && alcanca(ator, EMPRESA_DO_CLIENTE[cliente]);
    }
    return pessoaVeTarefa(ator, d.tarefa);
  }
  return alcanca(ator, EMPRESA_DO_CLIENTE[d.cliente as string]);
}

function recorte(ator: Ator) {
  const g = ator.grant as Concessao;
  const viva = !g.revoked && g.owner === ator.user;
  const empresas = new Set(
    viva ? EMPRESAS.filter((e) => (g.companies === null || g.companies.includes(e)) && alcanca(ator, e)) : [],
  );
  const clientes = new Set(
    Object.keys(EMPRESA_DO_CLIENTE).filter(
      (c) => empresas.has(EMPRESA_DO_CLIENTE[c]) && (g.clients === null || g.clients.includes(c)),
    ),
  );
  return { empresas, clientes };
}

function conexaoVeTarefa(ator: Ator, tarefa: string): boolean {
  const { empresas, clientes } = recorte(ator);
  const t = TAREFAS[tarefa];
  if (t.list === null) return t.client !== null && clientes.has(t.client);
  if (t.client === null) {
    const daLista = LISTAS[t.list].client;
    return empresas.has(empresaDaLista(t.list)) && (daLista === null || clientes.has(daLista));
  }
  return empresas.has(empresaDaLista(t.list)) && clientes.has(t.client);
}

function conexaoVe(ator: Ator, l: Linha): boolean {
  if (!ator.grant) return true;
  const { empresas, clientes } = recorte(ator);
  const d = l.dono;
  if (d.empresa) return empresas.has(d.empresa);
  if (d.espaco) return empresas.has(EMPRESA_DO_ESPACO[d.espaco]);
  if (d.tarefa) return conexaoVeTarefa(ator, d.tarefa);
  return clientes.has(d.cliente as string);
}

const esperado = (ator: Ator, tabela: Tabela) =>
  linhas
    .filter((l) => l.tabela === tabela && pessoaVe(ator, l) && conexaoVe(ator, l))
    .map((l) => l.id)
    .sort();

/* ───────────────────────────── o banco ───────────────────────────── */

const db = new PGlite();

type Erro = { code?: string; message?: string };

/** Corre `trabalho` como `ator`, numa transação que termina SEMPRE em rollback. */
async function comoAtor<T>(ator: Ator, trabalho: () => Promise<T>): Promise<T> {
  await db.exec('begin');
  try {
    await db.query('set local role ideworks_app');
    await db.query(
      `select set_config('app.user_id', $1, true),
              set_config('app.is_superadmin', $2, true),
              set_config('app.is_super', $3, true),
              set_config('app.integration_id', $4, true),
              set_config('app.grant_id', $4, true),
              set_config('app.integration_owner_id', $5, true),
              set_config('app.execution_origin', $6, true)`,
      [
        ator.user,
        ator.admin ? 'true' : 'false',
        ator.top ? 'true' : 'false',
        ator.grant?.id ?? '',
        ator.grant ? ator.user : '',
        ator.grant ? 'mcp' : '',
      ],
    );
    return await trabalho();
  } finally {
    await db.exec('rollback');
  }
}

const ids = async (sql: string, params: unknown[] = []) =>
  (await db.query<{ id: string }>(sql, params)).rows.map((r) => r.id).sort();

async function retrato(ator: Ator): Promise<Record<Tabela, string[]>> {
  return comoAtor(ator, async () => {
    const out = {} as Record<Tabela, string[]>;
    for (const tabela of TABELAS) out[tabela] = await ids(`select id::text as id from ideworks.${tabela}`);
    return out;
  });
}

/** Espera recusa com o SQLSTATE certo — recusa por outro motivo não conta. */
async function recusa(sql: string, params: unknown[] = [], codigo = '42501'): Promise<void> {
  await db.exec('savepoint tentativa');
  let erro: Erro | null = null;
  try {
    await db.query(sql, params);
  } catch (e) {
    erro = e as Erro;
  }
  await db.exec('rollback to savepoint tentativa');
  expect(erro, `devia recusar: ${sql}`).not.toBeNull();
  expect(erro?.code, `${sql} — ${erro?.message}`).toBe(codigo);
}

async function afetadas(sql: string, params: unknown[] = []): Promise<number> {
  await db.exec('savepoint tentativa');
  try {
    const r = await db.query(sql, params);
    return r.affectedRows ?? 0;
  } finally {
    await db.exec('rollback to savepoint tentativa');
  }
}

async function passa(sql: string, params: unknown[] = []): Promise<void> {
  await db.exec('savepoint tentativa');
  try {
    await db.query(sql, params);
  } finally {
    await db.exec('rollback to savepoint tentativa');
  }
}

/** As permissivas de produção, como o retrato as guarda: `tabela|nome|cmd|papeis|using|check`. */
function permissivasDoRetrato(): string[] {
  const retratoJson = JSON.parse(readFileSync(RETRATO, 'utf8')) as {
    politicas_expressao: string[];
    politicas_restritivas?: string[];
  };
  // O retrato de produção passou a ter as 25 trancas restritivas depois que a F44_2 foi aplicada.
  // O terreno "antes" da migration é só as permissivas; as trancas quem cria é a própria migration.
  const restritivas = new Set((retratoJson.politicas_restritivas ?? []).map((l) => l.split('|')[1]));
  const comandos: string[] = [];
  for (const linha of retratoJson.politicas_expressao) {
    const partes = linha.split('|');
    if (!(TABELAS as readonly string[]).includes(partes[0])) continue;
    if (restritivas.has(partes[1]) || partes[1].endsWith('_tranca_da_conexao')) continue;
    if (partes.length !== 6) throw new Error(`política com "|" na expressão: ${linha}`);
    const [tabela, nome, cmd, papeis, usando, conferindo] = partes;
    comandos.push(
      `create policy ${nome} on ideworks.${tabela} for ${cmd.toLowerCase()} to ${papeis}` +
        (usando ? ` using (${usando})` : '') +
        (conferindo ? ` with check (${conferindo})` : '') +
        ';',
    );
  }
  return comandos;
}

const permissivasNoBanco = async () =>
  (
    await db.query<{ linha: string }>(
      `select tablename || '|' || policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' ||
              coalesce(with_check, '') as linha
         from pg_policies
        where schemaname = 'ideworks' and permissive = 'PERMISSIVE'
        order by 1`,
    )
  ).rows.map((r) => r.linha);

/** A tabela tem política permissiva para o comando? Sem ela nem a pessoa escreve. */
const pode = (tabela: Tabela, cmd: 'INSERT' | 'UPDATE' | 'DELETE') =>
  permissivasAntes.some((l) => {
    const [t, , c] = l.split('|');
    return t === tabela && (c === cmd || c === 'ALL');
  });

/** O texto do EXPLAIN ANALYZE, uma linha por nó. */
const plano = async (sql: string) =>
  (await db.query<{ 'QUERY PLAN': string }>(`explain (analyze, costs off, timing off, summary off) ${sql}`)).rows
    .map((r) => r['QUERY PLAN'])
    .join('\n');

/** Quantas linhas o planejador ESPERA de cada tabela, para o ator. */
async function estimativas(ator: Ator): Promise<Record<string, number>> {
  return comoAtor(ator, async () => {
    const out: Record<string, number> = {};
    for (const tabela of TABELAS) {
      const r = await db.query<{ 'QUERY PLAN': string }>(`explain select * from ideworks.${tabela}`);
      out[tabela] = Number(/rows=(\d+)/.exec(r.rows[0]['QUERY PLAN'])?.[1] ?? -1);
    }
    return out;
  });
}

/** As InitPlans do plano e o `loops` de cada uma (0 = nunca rodou). */
function initPlans(texto: string): number[] {
  const linhasDoPlano = texto.split('\n');
  const voltas: number[] = [];
  linhasDoPlano.forEach((l, i) => {
    if (!/InitPlan \d+/.test(l)) return;
    const filho = linhasDoPlano[i + 1] ?? '';
    if (filho.includes('never executed')) voltas.push(0);
    else voltas.push(Number(/loops=(\d+)/.exec(filho)?.[1] ?? -1));
  });
  return voltas;
}

/* ───────────────────────────── o preparo ───────────────────────────── */

const ESQUEMA = `
  create role anon; create role authenticated; create role ideworks_app;
  create schema ideworks;
  grant usage on schema ideworks to ideworks_app;

  create type ideworks.access_level as enum ('view', 'execute', 'create', 'manage');

  create function ideworks.acting_user_id() returns uuid language sql stable as
    $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
  create function ideworks.acting_is_superadmin() returns boolean language sql stable as
    $$ select coalesce(current_setting('app.is_superadmin', true), 'false') = 'true' $$;
  create function ideworks.acting_is_super() returns boolean language sql stable as
    $$ select coalesce(current_setting('app.is_super', true), 'false') = 'true' $$;

  create table ideworks.profiles (id uuid primary key, full_name text, email text not null,
    is_active boolean not null default true);
  create table ideworks.user_categories (user_id uuid not null, category_id uuid not null);
  create table ideworks.client_categories (id uuid primary key, name text not null);
  create table ideworks.clients (id uuid primary key, name text not null,
    category_id uuid not null references ideworks.client_categories (id),
    is_active boolean not null default true);
  create table ideworks.spaces (id uuid primary key, name text not null,
    category_id uuid not null references ideworks.client_categories (id));
  create table ideworks.folders (id uuid primary key, name text not null,
    space_id uuid not null references ideworks.spaces (id));
  create table ideworks.lists (id uuid primary key, name text not null,
    space_id uuid not null references ideworks.spaces (id),
    folder_id uuid references ideworks.folders (id),
    client_id uuid references ideworks.clients (id));
  create table ideworks.tasks (id uuid primary key, title text not null,
    list_id uuid references ideworks.lists (id),
    client_id uuid references ideworks.clients (id),
    parent_id uuid references ideworks.tasks (id));
  create table ideworks.task_comments (id uuid primary key, task_id uuid not null references ideworks.tasks (id),
    author_id uuid, body text not null default 'texto');
  create table ideworks.task_events (id uuid primary key, task_id uuid not null references ideworks.tasks (id));
  create table ideworks.task_assignees (id uuid primary key, task_id uuid not null references ideworks.tasks (id),
    user_id uuid);
  create table ideworks.task_watchers (id uuid primary key, task_id uuid not null references ideworks.tasks (id),
    user_id uuid);
  create table ideworks.task_tag_assignments (id uuid primary key,
    task_id uuid not null references ideworks.tasks (id), tag_id uuid);
  create table ideworks.task_checklists (id uuid primary key,
    task_id uuid not null references ideworks.tasks (id), name text not null default 'passos');
  create table ideworks.checklist_items (id uuid primary key,
    checklist_id uuid not null references ideworks.task_checklists (id), name text not null default 'passo');
  create table ideworks.task_links (id uuid primary key, task_id uuid not null references ideworks.tasks (id),
    url text not null default 'https://exemplo.test');
  create table ideworks.task_attachments (id uuid primary key,
    task_id uuid not null references ideworks.tasks (id), file_name text not null default 'arte.png');
  create table ideworks.approval_rounds (id uuid primary key,
    task_id uuid not null references ideworks.tasks (id),
    client_id uuid not null references ideworks.clients (id));
  create table ideworks.approval_round_items (id uuid primary key,
    round_id uuid not null references ideworks.approval_rounds (id));
  create table ideworks.mural_notes (id uuid primary key,
    client_id uuid not null references ideworks.clients (id), content text not null default 'nota');
  create table ideworks.client_history (id uuid primary key,
    client_id uuid not null references ideworks.clients (id), title text not null default 'fato');
  create table ideworks.history_documents (id uuid primary key,
    history_id uuid not null references ideworks.client_history (id));
  create table ideworks.content_items (id uuid primary key,
    client_id uuid not null references ideworks.clients (id));
  create table ideworks.month_contracts (id uuid primary key,
    client_id uuid not null references ideworks.clients (id));
  create table ideworks.month_contract_items (id uuid primary key,
    contract_id uuid not null references ideworks.month_contracts (id));
  create table ideworks.client_quotas (id uuid primary key,
    client_id uuid not null references ideworks.clients (id));
  create table ideworks.client_tag_assignments (id uuid primary key,
    client_id uuid not null references ideworks.clients (id), tag_id uuid);
  create table ideworks.appointments (id uuid primary key,
    client_id uuid not null references ideworks.clients (id), title text not null default 'gravação');

  -- O "tree" de produção é security_invoker: a política de cada tabela vale nele.
  create view ideworks.tree with (security_invoker = true) as
    select l.id as list_id, l.client_id as list_client_id, s.id as space_id, s.category_id,
           f.id as folder_id
      from ideworks.lists l
      join ideworks.spaces s on s.id = l.space_id
      left join ideworks.folders f on f.id = l.folder_id;

  -- ── dublês do alcance da PESSOA: a regra da empresa ──────────────────────
  create function ideworks.reaches_category(p uuid) returns boolean
    language sql stable security definer set search_path = ideworks, pg_temp as $$
      select ideworks.acting_is_super()
          or exists (select 1 from ideworks.user_categories uc
                      where uc.user_id = ideworks.acting_user_id() and uc.category_id = p) $$;
  create function ideworks.can_see_space(p uuid) returns boolean
    language sql stable security definer set search_path = ideworks, pg_temp as $$
      select ideworks.reaches_category((select s.category_id from ideworks.spaces s where s.id = p)) $$;
  create function ideworks.can_see_folder(p uuid) returns boolean
    language sql stable security definer set search_path = ideworks, pg_temp as $$
      select ideworks.can_see_space((select f.space_id from ideworks.folders f where f.id = p)) $$;
  create function ideworks.can_act_on_chain(p_space uuid, p_folder uuid, p_list uuid,
                                            p_min ideworks.access_level) returns boolean
    language sql stable security definer set search_path = ideworks, pg_temp as $$
      select ideworks.can_see_space(coalesce(
        p_space,
        (select f.space_id from ideworks.folders f where f.id = p_folder),
        (select l.space_id from ideworks.lists l where l.id = p_list))) $$;
  create function ideworks.can_see_client(p uuid) returns boolean
    language sql stable security definer set search_path = ideworks, pg_temp as $$
      select ideworks.reaches_category((select c.category_id from ideworks.clients c where c.id = p)) $$;
  create function ideworks.can_reach_task(p_list uuid, p_client uuid) returns boolean
    language sql stable security definer set search_path = ideworks, pg_temp as $$
      select coalesce(p_list is not null and ideworks.can_act_on_chain(null, null, p_list, 'view'), false)
          or coalesce(p_client is not null and ideworks.can_see_client(p_client), false) $$;
  create function ideworks.can_act_on_task(p_list uuid, p_client uuid, p_min ideworks.access_level)
    returns boolean
    language sql stable security definer set search_path = ideworks, pg_temp as $$
      select ideworks.can_reach_task(p_list, p_client) $$;
  create function ideworks.can_reach_task_id(p uuid) returns boolean
    language sql stable security definer set search_path = ideworks, pg_temp as $$
      select ideworks.can_reach_task(t.list_id, t.client_id) from ideworks.tasks t where t.id = p $$;
  create function ideworks.can_act_on_task_id(p uuid, p_min ideworks.access_level) returns boolean
    language sql stable security definer set search_path = ideworks, pg_temp as $$
      select ideworks.can_reach_task_id(p) $$;
  create function ideworks.can_reach_checklist(p uuid) returns boolean
    language sql stable security definer set search_path = ideworks, pg_temp as $$
      select ideworks.can_reach_task_id(k.task_id) from ideworks.task_checklists k where k.id = p $$;
  create function ideworks.can_act_on_checklist(p uuid, p_min ideworks.access_level) returns boolean
    language sql stable security definer set search_path = ideworks, pg_temp as $$
      select ideworks.can_reach_checklist(p) $$;
`;

let estimativasAntes: Record<string, number> = {};
const antesHumanos: Record<string, Record<Tabela, string[]>> = {};
const antesAgentes: Record<string, Record<Tabela, string[]>> = {};
let permissivasAntes: string[] = [];
/** A regra de leitura do MCP, calculada ANTES da migration com as funções da F16a. */
const leituraDoMcp: Record<string, Record<string, string[]>> = {};

async function semear(): Promise<void> {
  const v = (lista: (string | null)[]) => lista.map((x) => (x === null ? 'null' : `'${x}'`)).join(', ');
  const sql: string[] = [];
  sql.push(`insert into ideworks.client_categories values ('${A}', 'A'), ('${B}', 'B'), ('${C}', 'C');`);
  sql.push(`insert into ideworks.profiles (id, email) values
    ('${EU}', 'eu@exemplo.test'), ('${TOPO}', 'topo@exemplo.test'), ('${OUTRA}', 'outra@exemplo.test');`);
  sql.push(`insert into ideworks.user_categories values ('${EU}', '${A}'), ('${EU}', '${B}'), ('${OUTRA}', '${A}');`);
  for (const [c, e] of Object.entries(EMPRESA_DO_CLIENTE)) sql.push(`insert into ideworks.clients values ('${c}', 'cliente', '${e}');`);
  for (const [s, e] of Object.entries(EMPRESA_DO_ESPACO)) sql.push(`insert into ideworks.spaces values ('${s}', 'espaço', '${e}');`);
  for (const [f, s] of Object.entries(ESPACO_DA_PASTA)) sql.push(`insert into ideworks.folders values ('${f}', 'pasta', '${s}');`);
  for (const [l, d] of Object.entries(LISTAS)) {
    sql.push(`insert into ideworks.lists values ('${l}', 'lista', ${v([d.space, d.folder, d.client])});`);
  }
  // A mãe antes da filha.
  for (const [t, d] of Object.entries(TAREFAS).sort(([, x], [, y]) => (x.parent ? 1 : 0) - (y.parent ? 1 : 0))) {
    sql.push(`insert into ideworks.tasks values ('${t}', 'tarefa', ${v([d.list, d.client, d.parent ?? null])});`);
  }
  for (const l of linhas) {
    const d = l.dono;
    switch (l.tabela) {
      case 'task_comments':
        sql.push(`insert into ideworks.task_comments (id, task_id, author_id) values ('${l.id}', '${d.tarefa}', '${EU}');`);
        break;
      case 'task_events':
      case 'task_tag_assignments':
      case 'task_checklists':
      case 'task_links':
      case 'task_attachments':
        sql.push(`insert into ideworks.${l.tabela} (id, task_id) values ('${l.id}', '${d.tarefa}');`);
        break;
      case 'task_assignees':
      case 'task_watchers':
        sql.push(`insert into ideworks.${l.tabela} (id, task_id, user_id) values ('${l.id}', '${d.tarefa}', '${EU}');`);
        break;
      case 'checklist_items':
        sql.push(`insert into ideworks.checklist_items (id, checklist_id) values ('${l.id}', '${d.mae}');`);
        break;
      case 'approval_rounds':
        sql.push(
          `insert into ideworks.approval_rounds values ('${l.id}', '${d.tarefa}', '${clienteEfetivo(TAREFAS[d.tarefa as string])}');`,
        );
        break;
      case 'approval_round_items':
        sql.push(`insert into ideworks.approval_round_items values ('${l.id}', '${d.mae}');`);
        break;
      case 'history_documents':
        sql.push(`insert into ideworks.history_documents values ('${l.id}', '${d.mae}');`);
        break;
      case 'month_contract_items':
        sql.push(`insert into ideworks.month_contract_items values ('${l.id}', '${d.mae}');`);
        break;
      default:
        if ((DO_CLIENTE as readonly string[]).includes(l.tabela)) {
          sql.push(`insert into ideworks.${l.tabela} (id, client_id) values ('${l.id}', '${d.cliente}');`);
        }
    }
  }
  for (const g of CONCESSOES) {
    sql.push(`insert into ideworks.integration_grants
      (id, owner_id, oauth_client_id, name, capabilities, allowed_company_ids, allowed_client_ids, revoked_at)
      values ('${g.id}', '${g.owner}', 'cliente-${g.id}', 'IA de teste',
        '{boards:read,tasks:read,clients:read,comments:read,comments:write}',
        ${g.companies === null ? 'null' : `'{${g.companies.join(',')}}'`},
        ${g.clients === null ? 'null' : `'{${g.clients.join(',')}}'`},
        ${g.revoked ? 'now()' : 'null'});`);
  }
  await db.exec(sql.join('\n'));
}

/** A leitura de produção do MCP sobre tarefas, listas, clientes e o que é do cliente. */
async function leituraDoMcpPara(ator: Ator): Promise<Record<string, string[]>> {
  return comoAtor(ator, async () => {
    const lidas: Record<string, string[]> = {};
    // `get_task`/`list_tasks`/`search`: companySql(tr.category_id) + clientSql.
    lidas.tasks = await ids(`
      select t.id::text as id
        from ideworks.tasks t
        left join ideworks.lists l on l.id = t.list_id
        left join ideworks.spaces s on s.id = l.space_id
       where s.category_id is not null
         and ideworks.integration_allows_company(s.category_id)
         and (coalesce(t.client_id, l.client_id) is null
              or ideworks.integration_allows_client(coalesce(t.client_id, l.client_id)))`);
    // `list_boards`/`get_board`: companySql + boardClientSql.
    lidas.lists = await ids(`
      select l.id::text as id
        from ideworks.lists l join ideworks.spaces s on s.id = l.space_id
       where ideworks.integration_allows_company(s.category_id)
         and (l.client_id is null or ideworks.integration_allows_client(l.client_id))`);
    lidas.spaces = await ids(`
      select s.id::text as id from ideworks.spaces s where ideworks.integration_allows_company(s.category_id)`);
    // `list_clients`/`get_client`/`search`: companySql(c.category_id) + integration_allows_client.
    lidas.clients = await ids(`
      select c.id::text as id from ideworks.clients c
       where ideworks.integration_allows_company(c.category_id) and ideworks.integration_allows_client(c.id)`);
    // Relatórios, mural, histórico, contrato: o cliente concedido.
    for (const tabela of DO_CLIENTE) {
      lidas[tabela] = await ids(
        `select x.id::text as id from ideworks.${tabela} x where ideworks.integration_allows_client(x.client_id)`,
      );
    }
    return lidas;
  });
}

beforeAll(async () => {
  await db.exec(ESQUEMA);
  await db.exec(readFileSync(F16A, 'utf8'));
  await db.exec(`set search_path = ideworks, public;\n${permissivasDoRetrato().join('\n')}\nreset search_path;`);
  for (const tabela of TABELAS) await db.exec(`alter table ideworks.${tabela} enable row level security;`);
  await db.exec(`
    grant select, insert, update, delete on all tables in schema ideworks to ideworks_app;
    grant execute on all functions in schema ideworks to ideworks_app;`);
  await semear();

  await db.exec('analyze');

  permissivasAntes = await permissivasNoBanco();
  estimativasAntes = await estimativas(H_EU);
  for (const ator of HUMANOS) antesHumanos[ator.nome] = await retrato(ator);
  for (const ator of AGENTES) {
    antesAgentes[ator.nome] = await retrato(ator);
    leituraDoMcp[ator.nome] = await leituraDoMcpPara(ator);
  }

  await db.exec(readFileSync(MIGRATION, 'utf8'));
}, 180_000);

afterAll(async () => {
  await db.close();
});

/* ───────────────────────────── as provas ───────────────────────────── */

describe('o terreno é o que o teste diz que é', () => {
  it('as permissivas de produção das 25 tabelas entraram (do retrato, sem tirar nem pôr)', () => {
    expect(permissivasAntes.length).toBeGreaterThanOrEqual(TABELAS.length);
    for (const tabela of TABELAS) {
      expect(permissivasAntes.some((l) => l.startsWith(`${tabela}|`)), tabela).toBe(true);
    }
  });

  it('antes da tranca, o agente via tudo o que a pessoa vê — era só o código que recortava', () => {
    expect(antesAgentes['EU com [A]']).toEqual(antesHumanos['EU pela tela']);
    expect(antesAgentes['TOPO com [A]']).toEqual(antesHumanos['TOPO pela tela']);
  });

  it('a regra da pessoa (dublê) bate com o esperado, linha a linha', () => {
    for (const ator of HUMANOS) {
      for (const tabela of TABELAS) expect(antesHumanos[ator.nome][tabela], `${ator.nome} · ${tabela}`).toEqual(esperado(ator, tabela));
    }
  });
});

describe('sem conexão declarada, a tela não muda', () => {
  it('cada pessoa vê nas 25 tabelas exatamente o que via antes', async () => {
    for (const ator of HUMANOS) expect(await retrato(ator), ator.nome).toEqual(antesHumanos[ator.nome]);
  }, 60_000);

  it('nenhuma política permissiva mudou uma vírgula', async () => {
    expect(await permissivasNoBanco()).toEqual(permissivasAntes);
  });

  it('a pessoa continua escrevendo onde escrevia (empresa B, que o agente com [A] não alcança)', async () => {
    await comoAtor(H_EU, async () => {
      await passa(`insert into ideworks.task_comments (id, task_id, author_id) values ($1, $2, $3)`, [novo(), T_B, EU]);
      await passa(`insert into ideworks.mural_notes (id, client_id) values ($1, $2)`, [novo(), B1]);
      await passa(`insert into ideworks.tasks (id, title, list_id, client_id) values ($1, 'x', $2, $3)`, [novo(), LB, B1]);
      expect(await afetadas(`update ideworks.tasks set list_id = $2 where id = $1`, [T_A, LB])).toBe(1);
      expect(await afetadas(`update ideworks.clients set name = name where id = $1`, [B1])).toBe(1);
      expect(await afetadas(`delete from ideworks.content_items where client_id = $1`, [B1])).toBe(1);
    });
  });

  it('o planejador estima para a tela as mesmas linhas de antes (o plano não muda)', async () => {
    // `(select …) is not null` é estimado em 99,5%: a estimativa não pode cair
    // mais que isso. Com `acting_grant_id() is null` ela caía ~10×.
    const depois = await estimativas(H_EU);
    for (const tabela of TABELAS) {
      const antes = estimativasAntes[tabela];
      expect(antes, tabela).toBeGreaterThan(0);
      // Tabela pequena arredonda: uma linha de folga além dos 2%.
      expect(antes - depois[tabela], `${tabela}: ${antes} → ${depois[tabela]}`).toBeLessThanOrEqual(
        Math.max(1, antes * 0.02),
      );
      expect(depois[tabela], tabela).toBeLessThanOrEqual(antes);
    }
  });

  it('na tela os conjuntos da conexão nem rodam: EXPLAIN mostra "never executed"', async () => {
    const texto = await comoAtor(H_EU, () => plano('select * from ideworks.tasks'));
    const voltas = initPlans(texto);
    // A primeira pergunta é "há conexão?" — roda uma vez. Os quatro conjuntos
    // da tarefa (clientes, quadros, listas, clientes) ficam de fora.
    expect(voltas.filter((n) => n === 1).length, texto).toBe(1);
    expect(voltas.filter((n) => n === 0).length, texto).toBe(4);
  });
});

/**
 * A mesma leitura de EXPLAIN que `scripts/provar-tranca-da-conexao.mjs` faz em
 * produção: InitPlan de conjunto da conexão, ou SubPlan da linha-mãe da tranca
 * (apelidos só dela), que tenha rodado.
 */
function partesDaTrancaQueRodaram(linhasDoPlano: string[]): string[] {
  const rodou: string[] = [];
  linhasDoPlano.forEach((linha, i) => {
    if (!/InitPlan|SubPlan/.test(linha)) return;
    const bloco = linhasDoPlano.slice(i + 1, i + 4).join(' ');
    const daConexao =
      /integration_(company|space|list|client|board)_ids|tasks tarefa|task_checklists checklist|approval_rounds rodada|client_history fato|month_contracts contrato/.test(
        bloco,
      );
    if (daConexao && !bloco.includes('never executed')) rodou.push(linha.trim());
  });
  return rodou;
}

const planoVerboso = async (tabela: Tabela) =>
  (
    await db.query<{ 'QUERY PLAN': string }>(
      `explain (analyze, verbose, costs off, timing off, summary off) select count(*) from ideworks.${tabela}`,
    )
  ).rows.map((r) => r['QUERY PLAN']);

describe('a leitura de EXPLAIN da prova de produção', () => {
  it('na tela, nenhuma das 25 tabelas roda parte da tranca', async () => {
    await comoAtor(H_EU, async () => {
      for (const tabela of TABELAS) {
        const linhasDoPlano = await planoVerboso(tabela);
        expect(partesDaTrancaQueRodaram(linhasDoPlano), `${tabela}\n${linhasDoPlano.join('\n')}`).toEqual([]);
      }
    });
  }, 60_000);

  it('com conexão, ela acha o que rodou — a leitura enxerga a tranca de verdade', async () => {
    await comoAtor(AGENTES[0], async () => {
      for (const tabela of TABELAS) {
        const linhasDoPlano = await planoVerboso(tabela);
        expect(partesDaTrancaQueRodaram(linhasDoPlano).length, `${tabela}\n${linhasDoPlano.join('\n')}`).toBeGreaterThan(0);
      }
    });
  }, 60_000);
});

describe('com conexão declarada, o banco recusa o que está fora', () => {
  it.each(AGENTES.map((a) => [a.nome, a] as const))('%s: cada tabela mostra só o recorte', async (_nome, ator) => {
    const depois = await retrato(ator);
    for (const tabela of TABELAS) {
      expect(depois[tabela], `${ator.nome} · ${tabela}`).toEqual(esperado(ator, tabela));
      // Nunca além do que a pessoa já via.
      const pessoa = antesHumanos[ator.user === TOPO ? 'TOPO pela tela' : 'EU pela tela'][tabela];
      expect(depois[tabela].every((x) => pessoa.includes(x)), `${ator.nome} · ${tabela} ⊆ pessoa`).toBe(true);
    }
  }, 60_000);

  it('os casos que a regra precisa acertar, um a um', async () => {
    // Um de cada vez: cada retrato é uma transação na MESMA conexão.
    const comA = await retrato(AGENTES[0]);
    const comA1 = await retrato(AGENTES[2]);
    const comTudo = await retrato(AGENTES[1]);
    // [A]: a lista é de A, mas o cliente é de B → fora.
    expect(comA.tasks).not.toContain(T_CRUZADA);
    // [A]: sem lista, pelo cliente.
    expect(comA.tasks).toContain(T_SEM_LISTA_A);
    expect(comA.tasks).not.toContain(T_SEM_LISTA_B);
    // [A]: tudo de B some — tarefa, comentário dela, cliente, mural, contrato.
    expect(comA.tasks).not.toContain(T_B);
    expect(comA.clients).not.toContain(B1);
    expect(comA.spaces).toEqual([SA]);
    // Cliente A1: a tarefa MOVIDA (cliente A1 na lista do cliente A2) fica, e a
    // lista dela continua legível — senão ela sumiria do `tree`.
    expect(comA1.tasks).toContain(T_MOVIDA);
    expect(comA1.lists).toContain(LA2);
    expect(comA1.tasks).not.toContain(T_A2);
    // Cliente A1: tarefa sem cliente próprio vale o da lista (B1) → fora.
    expect(comA1.tasks).not.toContain(T_B_SEM);
    // Cliente A1: lista interna sem cliente → dentro.
    expect(comA1.tasks).toContain(T_A_INT);
    // Tudo: a cruzada entra (os dois lados concedidos), C nunca (a pessoa não alcança).
    expect(comTudo.tasks).toContain(T_CRUZADA);
    expect(comTudo.tasks).not.toContain(T_C);
  }, 60_000);

  it('concessão vazia, revogada ou de outro dono não vê nada em tabela nenhuma', async () => {
    for (const nome of ['EU com nenhuma empresa', 'EU com concessão revogada', 'EU com concessão de OUTRA']) {
      const ator = AGENTES.find((a) => a.nome === nome) as Ator;
      const depois = await retrato(ator);
      for (const tabela of TABELAS) expect(depois[tabela], `${nome} · ${tabela}`).toEqual([]);
    }
  }, 60_000);

  it('para o agente, cada conjunto sai UMA vez por comando (InitPlan com loops=1)', async () => {
    const texto = await comoAtor(AGENTES[1], () => plano('select * from ideworks.tasks'));
    const voltas = initPlans(texto);
    expect(voltas.length, texto).toBeGreaterThan(1);
    expect(voltas.every((n) => n <= 1), texto).toBe(true);
  });
});

describe('nada que a IA lia dentro da concessão some', () => {
  it.each(AGENTES.map((a) => [a.nome, a] as const))('%s: a leitura do MCP cabe na tranca', async (_nome, ator) => {
    const depois = await retrato(ator);
    const mcp = leituraDoMcp[ator.nome];
    for (const [tabela, lidas] of Object.entries(mcp)) {
      const faltando = lidas.filter((x) => !depois[tabela as Tabela].includes(x));
      expect(faltando, `${ator.nome} · ${tabela}: a IA lia e deixou de ver`).toEqual([]);
    }
  }, 60_000);

  it('toda tarefa que o agente vê com lista acha a lista no tree (a junção do MCP não a perde)', async () => {
    for (const ator of AGENTES) {
      const perdidas = await comoAtor(ator, () =>
        ids(`select t.id::text as id from ideworks.tasks t
               left join ideworks.tree tr on tr.list_id = t.list_id
              where t.list_id is not null and tr.list_id is null`),
      );
      expect(perdidas, ator.nome).toEqual([]);
    }
  }, 60_000);
});

const TEM_FILHAS = new Set<Tabela>([
  'spaces',
  'folders',
  'lists',
  'tasks',
  'task_checklists',
  'approval_rounds',
  'clients',
  'client_history',
  'month_contracts',
]);

describe('escrita da conexão fora do recorte', () => {
  const comA = AGENTES[0];
  const B_DE = (tabela: Tabela) => linhas.find((l) => l.tabela === tabela && !conexaoVe(comA, l) && pessoaVe(comA, l))?.id;
  const A_DE = (tabela: Tabela) => linhas.find((l) => l.tabela === tabela && conexaoVe(comA, l) && pessoaVe(comA, l))?.id;

  it('update e delete não acham a linha de fora; a de dentro, sim', async () => {
    await comoAtor(comA, async () => {
      for (const tabela of TABELAS) {
        const fora = B_DE(tabela);
        const dentro = A_DE(tabela);
        expect(fora, `${tabela}: o terreno tem linha de fora`).toBeDefined();
        expect(dentro, `${tabela}: o terreno tem linha de dentro`).toBeDefined();
        expect(await afetadas(`update ideworks.${tabela} set id = id where id = $1`, [fora]), `update ${tabela} fora`).toBe(0);
        expect(await afetadas(`delete from ideworks.${tabela} where id = $1`, [fora]), `delete ${tabela} fora`).toBe(0);
        if (pode(tabela, 'UPDATE')) {
          expect(await afetadas(`update ideworks.${tabela} set id = id where id = $1`, [dentro]), `update ${tabela} dentro`).toBe(1);
        }
        // Apagar a de dentro só nas folhas: as outras têm filhas presas pela chave.
        if (pode(tabela, 'DELETE') && !TEM_FILHAS.has(tabela)) {
          expect(await afetadas(`delete from ideworks.${tabela} where id = $1`, [dentro]), `delete ${tabela} dentro`).toBe(1);
        }
      }
    });
  }, 60_000);

  it('insert apontando para fora é recusado (42501); para dentro, passa', async () => {
    const tarefa = (t: string) => [novo(), t];
    await comoAtor(comA, async () => {
      for (const tabela of SATELITES_DA_TAREFA) {
        const colunas = tabela === 'task_comments' ? '(id, task_id, author_id)' : '(id, task_id)';
        const valores = tabela === 'task_comments' ? `($1, $2, '${EU}')` : '($1, $2)';
        await recusa(`insert into ideworks.${tabela} ${colunas} values ${valores}`, tarefa(T_B));
        await passa(`insert into ideworks.${tabela} ${colunas} values ${valores}`, tarefa(T_A));
      }
      await recusa(`insert into ideworks.checklist_items (id, checklist_id) values ($1, $2)`, [novo(), CHECKLIST_DA_TAREFA[T_B]]);
      await passa(`insert into ideworks.checklist_items (id, checklist_id) values ($1, $2)`, [novo(), CHECKLIST_DA_TAREFA[T_A]]);
      // Rodada e item de rodada não têm política de escrita (só as funções da
      // F42 gravam): a recusa vale para todo mundo, e não há "dentro" a provar.
      expect(pode('approval_rounds', 'INSERT')).toBe(false);
      expect(pode('approval_round_items', 'INSERT')).toBe(false);

      for (const tabela of DO_CLIENTE) {
        await recusa(`insert into ideworks.${tabela} (id, client_id) values ($1, $2)`, [novo(), B1]);
        await passa(`insert into ideworks.${tabela} (id, client_id) values ($1, $2)`, [novo(), A1]);
      }
      await recusa(`insert into ideworks.history_documents values ($1, $2)`, [novo(), HISTORICO_DO_CLIENTE[B1]]);
      await passa(`insert into ideworks.history_documents values ($1, $2)`, [novo(), HISTORICO_DO_CLIENTE[A1]]);
      await recusa(`insert into ideworks.month_contract_items values ($1, $2)`, [novo(), CONTRATO_DO_CLIENTE[B1]]);
      await passa(`insert into ideworks.month_contract_items values ($1, $2)`, [novo(), CONTRATO_DO_CLIENTE[A1]]);

      await recusa(`insert into ideworks.tasks (id, title, list_id, client_id) values ($1, 'x', $2, $3)`, [novo(), LB, B1]);
      await passa(`insert into ideworks.tasks (id, title, list_id, client_id) values ($1, 'x', $2, $3)`, [novo(), LA, A1]);
      // Sem cliente próprio numa lista de B: o cliente é o da lista → fora.
      await recusa(`insert into ideworks.tasks (id, title, list_id) values ($1, 'x', $2)`, [novo(), LB]);
      await passa(`insert into ideworks.tasks (id, title, list_id) values ($1, 'x', $2)`, [novo(), LA_INT]);
      await recusa(`insert into ideworks.lists (id, name, space_id) values ($1, 'x', $2)`, [novo(), SB]);
      await passa(`insert into ideworks.lists (id, name, space_id) values ($1, 'x', $2)`, [novo(), SA]);
      await recusa(`insert into ideworks.folders (id, name, space_id) values ($1, 'x', $2)`, [novo(), SB]);
      await passa(`insert into ideworks.folders (id, name, space_id) values ($1, 'x', $2)`, [novo(), SA]);
      await recusa(`insert into ideworks.spaces (id, name, category_id) values ($1, 'x', $2)`, [novo(), B]);
      await passa(`insert into ideworks.spaces (id, name, category_id) values ($1, 'x', $2)`, [novo(), A]);
      // Cliente novo: nenhuma ferramenta da IA cria — a tranca recusa até em A.
      await recusa(`insert into ideworks.clients (id, name, category_id) values ($1, 'x', $2)`, [novo(), A]);
    });
  }, 60_000);

  it('mudar a linha de dentro para fora é recusado (a linha NOVA também passa pela tranca)', async () => {
    await comoAtor(AGENTES[0], async () => {
      await recusa(`update ideworks.tasks set list_id = $2, client_id = $3 where id = $1`, [T_A, LB, B1]);
      await recusa(`update ideworks.tasks set client_id = $2 where id = $1`, [T_A, B1]);
      await recusa(`update ideworks.lists set space_id = $2 where id = $1`, [LA_INT, SB]);
      await recusa(`update ideworks.clients set category_id = $2 where id = $1`, [A1, B]);
      await recusa(`update ideworks.task_comments set task_id = $2 where task_id = $1`, [T_A, T_B]);
      await recusa(`update ideworks.mural_notes set client_id = $2 where client_id = $1`, [A1, B1]);
      // E dentro dela, mexer pode: a tarefa vai para a lista interna de A.
      expect(await afetadas(`update ideworks.tasks set list_id = $2, client_id = null where id = $1`, [T_A2, LA_INT])).toBe(1);
    });
  }, 60_000);
});

describe('a memória por comando de integration_company_ids', () => {
  it('muda de resposta quando a concessão declarada muda — mesma transação, sem esperar o relógio', async () => {
    await comoAtor(AGENTES[0], async () => {
      const comA = (await db.query<{ v: string[] }>(`select ideworks.integration_company_ids()::text[] as v`)).rows[0].v;
      expect(comA).toEqual([A]);
      await db.query(`select set_config('app.grant_id', $1, true), set_config('app.integration_id', $1, true)`, [G_TUDO.id]);
      const comTudo = (await db.query<{ v: string[] }>(`select ideworks.integration_company_ids()::text[] as v`)).rows[0].v;
      expect(comTudo).toEqual([A, B]);
    });
  });

  it('comando novo pergunta de novo: a concessão estreitada na transação vale no comando seguinte', async () => {
    await comoAtor(AGENTES[1], async () => {
      expect((await ids('select id::text as id from ideworks.spaces')).length).toBe(2);
      await db.query('reset role');
      await db.query(`update ideworks.integration_grants set allowed_company_ids = $2 where id = $1`, [G_TUDO.id, [B]]);
      await db.query('set local role ideworks_app');
      // O relógio do PGlite anda de milissegundo em milissegundo (ver o
      // cabeçalho da migration); em produção é microssegundo.
      await db.query('select pg_sleep(0.005)');
      expect(await ids('select id::text as id from ideworks.spaces')).toEqual([SB]);
    });
  });

  it('dentro de um comando, a memória devolve o mesmo que a pergunta direta', async () => {
    await comoAtor(AGENTES[2], async () => {
      const r = await db.query<{ memoria: string[]; direto: string[] }>(`
        select (select ideworks.integration_company_ids()::text[]) as memoria,
               (select coalesce(array_agg(cc.id::text order by cc.id), '{}')
                  from ideworks.client_categories cc
                 where ideworks.integration_allows_company(cc.id)) as direto`);
      expect(r.rows[0].memoria).toEqual(r.rows[0].direto);
    });
  });
});

describe('o tipo da política e o caminho de volta', () => {
  const restritivas = async () =>
    (
      await db.query<{ t: string; n: string; p: string; c: string }>(
        `select tablename as t, policyname as n, permissive as p, cmd as c
           from pg_policies where schemaname = 'ideworks' and policyname like '%\\_tranca\\_da\\_conexao'
          order by 1`,
      )
    ).rows;

  it('as 25 são RESTRITIVAS e valem para todo comando — permissiva com esse texto abriria tudo', async () => {
    const r = await restritivas();
    expect(r.map((x) => x.t).sort()).toEqual([...TABELAS].sort());
    for (const x of r) {
      expect(x.n).toBe(`${x.t}_tranca_da_conexao`);
      expect(x.p, x.n).toBe('RESTRICTIVE');
      expect(x.c, x.n).toBe('ALL');
    }
  });

  it('as 25 restritivas daqui batem em nome e comando com a seção politicas_restritivas do retrato', async () => {
    const retratoJson = JSON.parse(readFileSync(RETRATO, 'utf8')) as { politicas_restritivas: string[] };
    const doBanco = (await restritivas()).map((x) => `${x.t}|${x.n}|${x.c}`).sort();
    expect(doBanco).toEqual([...retratoJson.politicas_restritivas].sort());
  });

  it('aplicar de novo não muda nada (idempotente)', async () => {
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    expect((await restritivas()).length).toBe(TABELAS.length);
    expect(await retrato(AGENTES[0])).toEqual(
      Object.fromEntries(TABELAS.map((t) => [t, esperado(AGENTES[0], t)])),
    );
  }, 60_000);

  it('o rollback devolve o comportamento de antes, e a migration volta a aplicar', async () => {
    await db.exec(readFileSync(ROLLBACK, 'utf8'));
    expect(await restritivas()).toEqual([]);
    const sobrou = await db.query(
      `select proname from pg_proc
        where proname in ('no_integration_declared', 'integration_company_ids', 'integration_space_ids',
                          'integration_list_ids', 'integration_client_ids', 'integration_board_ids')`,
    );
    expect(sobrou.rows).toEqual([]);
    expect(await permissivasNoBanco()).toEqual(permissivasAntes);
    expect(await retrato(AGENTES[0])).toEqual(antesAgentes['EU com [A]']);
    expect(await retrato(H_EU)).toEqual(antesHumanos['EU pela tela']);

    await db.exec(readFileSync(MIGRATION, 'utf8'));
    expect((await restritivas()).length).toBe(TABELAS.length);
    expect(await retrato(H_EU)).toEqual(antesHumanos['EU pela tela']);
  }, 60_000);
});
