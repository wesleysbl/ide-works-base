/**
 * TAREFAS DE UM ESCOPO, CONTRA UM POSTGRES DE VERDADE — F18A.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   A MESMA leitura de `server/tarefas-do-escopo.ts`, com o `tx` trocado por
 *   um adaptador fino sobre o PGlite (Postgres em WebAssembly, no processo —
 *   nenhuma rede). E, ao contrário de `omitidas-banco.test.ts`, COM POLÍTICA
 *   DE LINHA: as consultas rodam sob um papel sem privilégio (`set local
 *   role`), e `lists` tem uma parede por pessoa — o mesmo formato da F17.23.
 *   Então o que se confere é o que a pessoa de acesso PARCIAL lê: linhas,
 *   contagens, menus e fluxos.
 *
 * O QUE ELE NÃO PROVA
 *   As políticas REAIS do banco. A parede daqui é um modelo mínimo; a
 *   conferência sob `ideworks_app`, com as políticas de produção, é
 *   `scripts/provar-tarefas-do-escopo.mjs` (somente leitura).
 */

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SEM_FILTRO_DO_ESCOPO, type FiltroDoEscopo, type TarefasDoEscopo } from '@/board/tarefas-do-escopo';
import { BoardRefused } from '@/server/board';
import type { Sql, Tx } from '@/server/db';
import { criarAdaptadorPglite } from '@/server/pglite-adaptador';
import { type PedidoInternoDoEscopo, lerPedidoDoEscopo, readScopeTasks } from '@/server/tarefas-do-escopo';
import type { AuthenticatedActor } from '@/server/session';

/* ───────────────────────────── o adaptador ───────────────────────────── */

type Fragmento = { readonly dublê: true; readonly strings: readonly string[]; readonly args: readonly unknown[] };
const ehFragmento = (v: unknown): v is Fragmento =>
  typeof v === 'object' && v !== null && (v as Fragmento).dublê === true;

function montar(f: Fragmento, params: unknown[]): string {
  let texto = f.strings[0] ?? '';
  f.args.forEach((a, i) => {
    if (ehFragmento(a)) texto += montar(a, params);
    else {
      params.push(a);
      texto += `$${params.length}`;
    }
    texto += f.strings[i + 1] ?? '';
  });
  return texto;
}

let db: PGlite;
let consultas = 0;

const tx = ((strings: TemplateStringsArray, ...args: unknown[]) => {
  const f: Fragmento & PromiseLike<unknown[]> = {
    dublê: true,
    strings,
    args,
    then(ok, falha) {
      const params: unknown[] = [];
      const texto = montar(f, params);
      consultas += 1;
      return db.query(texto, params).then((r) => r.rows).then(ok, falha);
    },
  };
  return f;
}) as unknown as Tx;

/** `withActor` faz `sql.begin`: aqui, transação desfeita, sob o papel SEM privilégio. */
const sql = {
  begin: async (trabalho: (t: Tx) => Promise<unknown>) => {
    await db.exec('begin; set local role leitor;');
    try {
      return await trabalho(tx);
    } finally {
      await db.exec('rollback;');
    }
  },
} as unknown as Sql;

/* ───────────────────────────── o terreno ───────────────────────────── */

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const S = id(1);
const S_OUTRO = id(2);
const P1 = id(10);
const P_ARQ = id(11);
const L1 = id(20); // P1, visível para Joana — a lista grande
const L_PAREDE = id(21); // P1, FECHADA para Joana
const L_SOLTA = id(22); // sem pasta
const L_PASTA_ARQ = id(23); // em pasta arquivada
const L_ARQ = id(24); // lista arquivada em P1
const L_OUTRO = id(25); // outro espaço
const W1 = id(30); // esteira do espaço
const W2 = id(31); // esteira própria da lista solta
const W1_AFAZER = id(40);
const W1_FAZENDO = id(41);
const W1_FEITO = id(42);
const W2_AFAZER = id(43);
const W2_REVISAO = id(44);
const C_SECRETO = id(50);
const ADMIN = id(90);
const JOANA = id(91);
const SO_NA_PAREDE = id(92);
const DOC = id(9999);

const ator = (userId: string, admin: boolean): AuthenticatedActor => ({
  userId,
  email: 'pessoa@example.invalid',
  papel: admin ? 'super_admin' : 'funcionario',
  isSuperadmin: admin,
  isSuper: admin,
  areas: [],
  hasAllClientsAccess: admin,
});
const admin = ator(ADMIN, true);
const joana = ator(JOANA, false);

/** Id da tarefa n da lista grande (1..120). */
const tL1 = (n: number) => id(1000 + n);
const TOTAL_L1 = 120;

beforeAll(async () => {
  db = new PGlite();
  const insercoes: string[] = [];
  const prazos = ['2026-09-01', '2026-09-15', null, '2026-10-01'];
  const prioridades = ['urgent', 'normal', null];
  for (let n = 1; n <= TOTAL_L1; n += 1) {
    const prazo = prazos[n % prazos.length];
    const prio = prioridades[n % prioridades.length];
    // Muitos EMPATES de prazo, prioridade e título: o `id` desempata.
    const titulo = `Arte ${n % 7}`;
    const etapa = n % 2 === 0 ? W1_AFAZER : W1_FAZENDO;
    insercoes.push(
      `('${tL1(n)}', '${L1}', null, '${titulo}', null, '${etapa}', ${prio ? `'${prio}'` : 'null'}, ` +
        `${prazo ? `'${prazo}'` : 'null'}, null, null, '${ADMIN}')`,
    );
  }

  await db.exec(`
    create schema ideworks;
    create type ideworks.task_priority as enum ('urgent', 'high', 'normal', 'low');
    create type ideworks.status_type as enum ('open', 'unstarted', 'custom', 'done', 'closed');
    create table ideworks.client_categories(id uuid primary key, name text);
    create table ideworks.clients(id uuid primary key, name text, category_id uuid);
    create table ideworks.spaces(id uuid primary key, name text, category_id uuid, archived_at timestamptz, sort_order int default 0);
    create table ideworks.folders(id uuid primary key, space_id uuid, name text, sort_order int default 0, archived_at timestamptz);
    create table ideworks.lists(id uuid primary key, space_id uuid, folder_id uuid, name text, sort_order int default 0,
      archived_at timestamptz, client_id uuid);
    create table ideworks.status_sets(id uuid primary key, name text, space_id uuid, folder_id uuid, list_id uuid);
    create table ideworks.statuses(id uuid primary key, status_set_id uuid, name text, type ideworks.status_type,
      color text, sort_order int default 0);
    create table ideworks.tasks(id uuid primary key, list_id uuid, client_id uuid, title text, description text,
      status_id uuid, priority ideworks.task_priority, due_on date, start_on date, completed_at timestamptz,
      archived_at timestamptz, created_by uuid, parent_id uuid, demand_type text);
    create table ideworks.task_assignees(task_id uuid, user_id uuid);
    create table ideworks.task_attachments(id uuid primary key, task_id uuid, content_type text,
      expires_at timestamptz, created_at timestamptz default now());
    create view ideworks.task_labels as select null::uuid as task_id, null::text as task_type_name, null::jsonb as tags where false;
    create view ideworks.task_progress as select null::uuid as task_id, 0 as subtask_count, 0 as checklist_done,
      0 as checklist_total, 0 as attachment_count, 0 as comment_count where false;
    create function ideworks.display_name(u uuid) returns text language sql as $$ select 'Pessoa ' || right(u::text, 2) $$;
    create function ideworks.assignee_filter_people() returns table(id uuid, name text) language sql as
      $$ select current_setting('app.user_id', true)::uuid, 'Eu'::text $$;
    -- A MESMA herança da migração F17.2: lista -> pasta -> espaço.
    create function ideworks.resolve_status_set(p_list_id uuid) returns uuid language sql stable as $fn$
      select coalesce(
        (select ss.id from ideworks.status_sets ss where ss.list_id = p_list_id),
        (select ss.id from ideworks.status_sets ss join ideworks.lists l on l.folder_id = ss.folder_id where l.id = p_list_id),
        (select ss.id from ideworks.status_sets ss join ideworks.lists l on l.space_id = ss.space_id where l.id = p_list_id))
    $fn$;

    -- A PAREDE (modelo da F17.23): quem não administra vê só as listas liberadas.
    create table ideworks.acessos(user_id uuid, list_id uuid);
    alter table ideworks.lists enable row level security;
    create policy lists_select on ideworks.lists for select using (
      current_setting('app.is_superadmin', true) = 'true'
      or exists (select 1 from ideworks.acessos a
                  where a.list_id = lists.id and a.user_id::text = current_setting('app.user_id', true)));
    -- Tarefa segue a lista (a junção sob a política de lists recorta).
    alter table ideworks.tasks enable row level security;
    create policy tasks_select on ideworks.tasks for select using (
      exists (select 1 from ideworks.lists l where l.id = tasks.list_id));
    alter table ideworks.task_assignees enable row level security;
    create policy ta_select on ideworks.task_assignees for select using (
      exists (select 1 from ideworks.tasks t where t.id = task_assignees.task_id));
    -- Cliente secreto: só quem administra.
    alter table ideworks.clients enable row level security;
    create policy clients_select on ideworks.clients for select using (
      current_setting('app.is_superadmin', true) = 'true' or name not like 'Secreto%');

    create role leitor;
    grant usage on schema ideworks to leitor;
    grant select on all tables in schema ideworks to leitor;
    grant execute on all functions in schema ideworks to leitor;

    insert into ideworks.spaces values ('${S}', 'AGÊNCIA IDE', null, null), ('${S_OUTRO}', 'Outro', null, null);
    insert into ideworks.folders values ('${P1}', '${S}', 'TIME JUCA', 0, null),
                                        ('${P_ARQ}', '${S}', 'Antiga', 1, now());
    insert into ideworks.clients values ('${C_SECRETO}', 'Secreto SA', null);
    insert into ideworks.lists values
      ('${L1}', '${S}', '${P1}', 'Cliente A', 0, null, null),
      ('${L_PAREDE}', '${S}', '${P1}', 'Cliente fechado', 1, null, null),
      ('${L_SOLTA}', '${S}', null, 'Avulsa', 0, null, '${C_SECRETO}'),
      ('${L_PASTA_ARQ}', '${S}', '${P_ARQ}', 'Na pasta velha', 0, null, null),
      ('${L_ARQ}', '${S}', '${P1}', 'Arquivada', 2, now(), null),
      ('${L_OUTRO}', '${S_OUTRO}', null, 'De outro espaço', 0, null, null);
    insert into ideworks.acessos select '${JOANA}', id from ideworks.lists where id <> '${L_PAREDE}';
    insert into ideworks.status_sets values ('${W1}', 'Esteira da agência', '${S}', null, null),
                                            ('${W2}', 'Esteira da avulsa', null, null, '${L_SOLTA}');
    insert into ideworks.statuses values
      ('${W1_AFAZER}', '${W1}', 'A fazer', 'open', null, 0),
      ('${W1_FAZENDO}', '${W1}', 'Fazendo', 'custom', null, 1),
      ('${W1_FEITO}', '${W1}', 'Feito', 'done', null, 2),
      ('${W2_AFAZER}', '${W2}', 'A fazer', 'open', null, 0),
      ('${W2_REVISAO}', '${W2}', 'Revisão', 'custom', null, 1);

    insert into ideworks.tasks (id, list_id, client_id, title, description, status_id, priority, due_on,
                                completed_at, archived_at, created_by) values
      ${insercoes.join(',\n      ')},
      -- a que a busca tem de achar FORA do primeiro lote: sem prazo, sem prioridade, título no fim
      ('${DOC}', '${L1}', null, 'Vídeo DOCUMENTÁRIO especial', null, '${W1_AFAZER}', null, null, null, null, '${ADMIN}'),
      ('${id(2001)}', '${L1}', null, 'Arquivada', null, '${W1_AFAZER}', null, null, null, now(), '${ADMIN}'),
      ('${id(2101)}', '${L_PAREDE}', null, 'Segredo 1', null, '${W1_AFAZER}', null, null, null, null, '${ADMIN}'),
      ('${id(2102)}', '${L_PAREDE}', null, 'Segredo 2', null, '${W1_FAZENDO}', null, null, null, null, '${ADMIN}'),
      ('${id(2201)}', '${L_SOLTA}', null, 'Avulsa aberta', null, '${W2_AFAZER}', 'high', '2026-09-20', null, null, '${ADMIN}'),
      ('${id(2202)}', '${L_SOLTA}', null, 'Avulsa em revisão', null, '${W2_REVISAO}', null, null, null, null, '${ADMIN}'),
      ('${id(2203)}', '${L_SOLTA}', null, 'Avulsa concluída', null, '${W2_REVISAO}', null, null, now(), null, '${ADMIN}'),
      ('${id(2301)}', '${L_PASTA_ARQ}', null, 'Na pasta velha', null, '${W1_AFAZER}', null, null, null, null, '${ADMIN}'),
      ('${id(2401)}', '${L_ARQ}', null, 'Na lista arquivada', null, '${W1_AFAZER}', null, null, null, null, '${ADMIN}'),
      ('${id(2501)}', '${L_OUTRO}', null, 'De outro espaço', null, null, null, null, null, null, '${ADMIN}');
    insert into ideworks.task_assignees values ('${id(2101)}', '${SO_NA_PAREDE}'), ('${tL1(1)}', '${JOANA}');
  `);
});

afterAll(async () => {
  await db?.close();
});

/* ───────────────────────────── ajudantes ───────────────────────────── */

const pedido = (
  escopo: PedidoInternoDoEscopo['escopo'],
  alvo: string,
  filtro: Partial<FiltroDoEscopo> = {},
  limite = 50,
): PedidoInternoDoEscopo => ({ escopo, id: alvo, filtro: { ...SEM_FILTRO_DO_ESCOPO, ...filtro }, cursor: null, limite });

/** Percorre todos os cursores, pelo MESMO caminho da rota (endereço → pedido). */
async function tudo(quem: AuthenticatedActor, p: PedidoInternoDoEscopo) {
  const paginas: TarefasDoEscopo[] = [];
  let cursor: string | null = null;
  for (let volta = 0; volta < 50; volta += 1) {
    const endereco = new URLSearchParams({ escopo: p.escopo, id: p.id, limite: String(p.limite) });
    if (p.filtro.concluidas) endereco.set('concluidas', '1');
    if (p.filtro.texto) endereco.set('busca', p.filtro.texto);
    if (p.filtro.pasta) endereco.set('pasta', p.filtro.pasta);
    if (p.filtro.etapa) endereco.set('etapa', p.filtro.etapa);
    if (cursor) endereco.set('cursor', cursor);
    const lido = lerPedidoDoEscopo(endereco);
    if (!lido.ok) throw new Error(lido.message);
    const pagina = await readScopeTasks(sql, quem, lido.pedido);
    paginas.push(pagina);
    if (!pagina.hasMore) break;
    cursor = pagina.nextCursor;
  }
  return { paginas, ids: paginas.flatMap((x) => x.rows.map((r) => r.id)) };
}

/* ───────────────────────────── as provas ───────────────────────────── */

describe('o espaço inteiro — "AGÊNCIA IDE, tudo junto"', () => {
  it('admin: listas vivas + lista sem pasta; fora arquivada, pasta arquivada, lista arquivada e outro espaço', async () => {
    const r = await readScopeTasks(sql, admin, pedido('espaco', S, { concluidas: true }));
    // 120 + DOC na grande, 2 na parede, 3 na solta.
    expect(r.counts).toMatchObject({ total: 126, abertas: 125, matched: 126 });
    expect(r.header).toMatchObject({ spaceId: S, spaceName: 'AGÊNCIA IDE', folderId: null });
  });

  it('acesso PARCIAL: nem linha, nem contagem, nem menu, nem responsável da lista fechada', async () => {
    const { paginas, ids } = await tudo(joana, pedido('espaco', S, { concluidas: true }));
    const primeira = paginas[0]!;
    expect(primeira.counts).toMatchObject({ total: 124, matched: 124 });
    expect(ids).not.toContain(id(2101));
    expect(ids).not.toContain(id(2102));
    expect(primeira.catalog?.listas.map((l) => l.id)).not.toContain(L_PAREDE);
    expect(primeira.catalog?.assigneeOptions.map((o) => o.id)).not.toContain(SO_NA_PAREDE);
    // A soma por etapa é a mesma conta, sem a parede.
    const soma = Object.values(primeira.statusCounts).reduce((s, x) => s + x.total, 0);
    expect(soma).toBe(124);

    const doAdmin = await readScopeTasks(sql, admin, pedido('espaco', S));
    expect(doAdmin.catalog?.assigneeOptions.map((o) => o.id)).toContain(SO_NA_PAREDE);
  });

  it('cursor: cada tarefa exatamente uma vez, na ordem, com empates; contagens iguais em toda página', async () => {
    const { paginas, ids } = await tudo(joana, pedido('espaco', S, { concluidas: true }, 50));
    expect(paginas.length).toBe(3);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(paginas[0]!.counts.matched);
    for (const p of paginas) {
      expect(p.counts).toEqual(paginas[0]!.counts);
      expect(p.returned).toBe(p.rows.length);
      expect(p.returned).toBeLessThanOrEqual(50);
      expect(p.nextCursor === null).toBe(!p.hasMore);
    }
    // Só a primeira página relê os menus.
    expect(paginas[0]!.catalog).toBeDefined();
    expect(paginas[1]!.catalog).toBeUndefined();
    // A ordem atravessa as páginas: prazo crescente, sem prazo no fim.
    const prazos = paginas.flatMap((p) => p.rows.map((r) => r.dueOn ?? '9999-99-99'));
    expect([...prazos].sort()).toEqual(prazos);
  });

  it('a busca alcança o que estava fora do primeiro lote (sem acento, sem caixa)', async () => {
    const semBusca = await readScopeTasks(sql, joana, pedido('espaco', S, {}, 50));
    expect(semBusca.rows.map((r) => r.id)).not.toContain(DOC);
    const r = await readScopeTasks(sql, joana, pedido('espaco', S, { texto: 'documentario' }));
    expect(r.rows.map((x) => x.id)).toEqual([DOC]);
    expect(r.counts.matched).toBe(1);
    expect(r.counts.total).toBe(124);
  });

  it('concluídas ficam fora por padrão, e o recorte diz as duas coisas', async () => {
    const r = await readScopeTasks(sql, joana, pedido('espaco', S));
    expect(r.counts).toMatchObject({ total: 124, abertas: 123, matched: 123 });
  });

  it('lista sem pasta: entra no espaço, e o filtro "sem pasta" a isola', async () => {
    const { ids } = await tudo(joana, pedido('espaco', S, { pasta: 'sem', concluidas: true }));
    expect(ids.sort()).toEqual([id(2201), id(2202), id(2203)].sort());
  });

  it('origem e etapa REAL: lista, pasta, espaço, fluxo; cliente fora do alcance vem nulo', async () => {
    const r = await readScopeTasks(sql, joana, pedido('espaco', S, { pasta: 'sem' }));
    const avulsa = r.rows.find((x) => x.id === id(2201))!;
    expect(avulsa).toMatchObject({
      listId: L_SOLTA,
      listName: 'Avulsa',
      folderId: null,
      spaceId: S,
      statusId: W2_AFAZER,
      statusName: 'A fazer',
      workflowId: W2,
      clientId: null,
      clientName: null,
    });
    const peloAdmin = await readScopeTasks(sql, admin, pedido('espaco', S, { pasta: 'sem' }));
    expect(peloAdmin.rows.find((x) => x.id === id(2201))).toMatchObject({ clientName: 'Secreto SA' });
  });

  it('Kanban: dois "A fazer" de fluxos diferentes são duas colunas; etapa filtrada bate com a contagem', async () => {
    const r = await readScopeTasks(sql, joana, pedido('espaco', S, { concluidas: true }));
    const fluxos = r.catalog!.fluxos;
    expect(fluxos.map((f) => f.id)).toEqual([W1, W2]);
    expect(fluxos[0]!.etapas.map((e) => e.id)).toEqual([W1_AFAZER, W1_FAZENDO, W1_FEITO]);
    expect(fluxos[1]!.etapas.map((e) => e.id)).toEqual([W2_AFAZER, W2_REVISAO]);
    const somaMatched = fluxos.flatMap((f) => f.etapas).reduce((s, e) => s + e.matched, 0);
    expect(somaMatched + r.counts.semEtapa).toBe(r.counts.matched);

    const coluna = await tudo(joana, pedido('espaco', S, { etapa: W2_REVISAO, concluidas: true }));
    expect(coluna.ids.length).toBe(r.statusCounts[W2_REVISAO]!.matched);
  });
});

describe('pasta e lista', () => {
  it('pasta: só as listas vivas dela (fora a arquivada e a solta)', async () => {
    const adm = await readScopeTasks(sql, admin, pedido('pasta', P1, { concluidas: true }));
    expect(adm.counts.total).toBe(TOTAL_L1 + 1 + 2);
    const jo = await readScopeTasks(sql, joana, pedido('pasta', P1, { concluidas: true }));
    expect(jo.counts.total).toBe(TOTAL_L1 + 1);
    expect(jo.header).toMatchObject({ folderId: P1, folderName: 'TIME JUCA' });
  });

  it('lista fechada responde 404, igual à inexistente — nem o nome vaza', async () => {
    await expect(readScopeTasks(sql, joana, pedido('lista', L_PAREDE))).rejects.toBeInstanceOf(BoardRefused);
    await expect(readScopeTasks(sql, joana, pedido('lista', id(7777)))).rejects.toMatchObject({ status: 404 });
  });

  it('empresa omitida (F31): espaço, pasta e lista dela respondem 404; o resto não muda', async () => {
    const ALMA = id(60);
    await db.exec(`insert into ideworks.client_categories values ('${ALMA}', 'Alma9');
                   update ideworks.spaces set category_id = '${ALMA}' where id = '${S_OUTRO}';`);
    try {
      const semAlma: AuthenticatedActor = { ...admin, categoriasOmitidas: [ALMA] };
      await expect(readScopeTasks(sql, semAlma, pedido('espaco', S_OUTRO))).rejects.toMatchObject({ status: 404 });
      await expect(readScopeTasks(sql, semAlma, pedido('lista', L_OUTRO))).rejects.toMatchObject({ status: 404 });
      // Sem a omissão, o mesmo espaço abre (a recusa acima é a F31, não outra coisa).
      const comAlma = await readScopeTasks(sql, admin, pedido('espaco', S_OUTRO));
      expect(comAlma.counts.total).toBe(1);
      // O espaço da Ide segue idêntico para quem omite.
      const ide = await readScopeTasks(sql, semAlma, pedido('espaco', S, { concluidas: true }));
      expect(ide.counts).toMatchObject({ total: 126, matched: 126 });
    } finally {
      await db.exec(`update ideworks.spaces set category_id = null where id = '${S_OUTRO}';
                     delete from ideworks.client_categories where id = '${ALMA}';`);
    }
  });

  it('lista pedida pelo nome abre mesmo arquivada', async () => {
    const r = await readScopeTasks(sql, joana, pedido('lista', L_ARQ));
    expect(r.header.archived).toBe(true);
    expect(r.rows.map((x) => x.id)).toEqual([id(2401)]);
  });

  it('o número de idas ao banco não depende do número de clientes/listas', async () => {
    consultas = 0;
    await readScopeTasks(sql, joana, pedido('espaco', S));
    const primeira = consultas;
    consultas = 0;
    await readScopeTasks(sql, joana, pedido('lista', L1));
    // ator + cabeçalho + varredura + listas + pastas + etapas + responsáveis:
    // SETE no espaço (seis listas, três com tarefa), SEIS na lista (sem menu
    // de pastas). Nenhuma consulta por lista ou por cliente.
    expect(primeira).toBe(7);
    expect(consultas).toBe(6);
    // E o lote seguinte não relê os menus: ator + cabeçalho + varredura.
    const p1 = await readScopeTasks(sql, joana, pedido('espaco', S, { concluidas: true }));
    consultas = 0;
    const lido = lerPedidoDoEscopo(new URLSearchParams({ escopo: 'espaco', id: S, cursor: p1.nextCursor! }));
    if (!lido.ok) throw new Error(lido.message);
    await readScopeTasks(sql, joana, lido.pedido);
    expect(consultas).toBe(3);
  });
});

/**
 * PERF DO SERVIDOR, 08/10/2026 — o cabeçalho, as listas e os responsáveis saem na
 * mesma ida, com o id do escopo no TEXTO, e a política de linha continua a mesma:
 * a declaração do ator (`app.user_id`, `app.is_superadmin`) agora também vai no
 * texto, e é ela que a parede de `lists` lê. A resposta, página por página, tem de
 * ser IDÊNTICA à do caminho por parâmetro.
 */
describe('com o id e a declaração do ator no texto da consulta', () => {
  const rodar = (textoDireto: boolean, quem: AuthenticatedActor, p: PedidoInternoDoEscopo) => {
    const adaptador = criarAdaptadorPglite(db, { papel: 'leitor', textoDireto });
    return { adaptador, resultado: readScopeTasks(adaptador.sql, quem, p) };
  };

  const casos: Array<[string, AuthenticatedActor, PedidoInternoDoEscopo]> = [
    ['espaço, administrador', admin, pedido('espaco', S, { concluidas: true })],
    ['espaço, acesso parcial (a parede recorta)', joana, pedido('espaco', S, { concluidas: true })],
    ['pasta, acesso parcial', joana, pedido('pasta', P1)],
    ['lista fechada para Joana', joana, pedido('lista', L_PAREDE)],
    ['lista avulsa com cliente secreto', joana, pedido('lista', L_SOLTA, { concluidas: true })],
    ['busca sem acento', joana, pedido('espaco', S, { texto: 'documentario' })],
  ];

  for (const [descricao, quem, p] of casos) {
    it(`${descricao}: a mesma resposta`, async () => {
      const esperado = await rodar(false, quem, p).resultado.catch((e: unknown) => e);
      const porTexto = rodar(true, quem, p);
      const obtido = await porTexto.resultado.catch((e: unknown) => e);
      if (esperado instanceof Error) {
        // Recusa (404 da lista fechada): a mesma classe e a mesma frase.
        expect(obtido).toBeInstanceOf(BoardRefused);
        expect((obtido as Error).message).toBe(esperado.message);
        return;
      }
      expect(obtido).toEqual(esperado);
      const doBanco = porTexto.adaptador.consultas.filter((c) => c.includes('ideworks.') && !c.includes('set_config'));
      // Cabeçalho, listas, responsáveis, a página, (pastas só no espaço) e as etapas.
      expect(doBanco.length).toBeGreaterThanOrEqual(5);
      // Só a consulta da página leva parâmetro (os filtros).
      expect(doBanco.filter((c) => /\$\d/.test(c)).length).toBe(1);
    });
  }

  it('a página seguinte (com cursor) não relê o catálogo, e continua igual', async () => {
    const primeira = await readScopeTasks(sql, joana, pedido('espaco', S, { concluidas: true }, 50));
    const cursor = primeira.nextCursor;
    expect(cursor).not.toBeNull();
    const lido = lerPedidoDoEscopo(new URLSearchParams({ escopo: 'espaco', id: S, limite: '50', concluidas: '1', cursor: cursor! }));
    if (!lido.ok) throw new Error(lido.message);
    const a = await rodar(false, joana, lido.pedido).resultado;
    const b = rodar(true, joana, lido.pedido);
    expect(await b.resultado).toEqual(a);
    expect(a.catalog).toBeUndefined();
    // Sem catálogo: cabeçalho + página = 2 consultas.
    expect(b.adaptador.consultas.filter((c) => c.includes('ideworks.') && !c.includes('set_config'))).toHaveLength(2);
  });
});

