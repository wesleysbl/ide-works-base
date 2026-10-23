/**
 * EMPRESAS OMITIDAS, CONTRA UM POSTGRES DE VERDADE — F31, Fase 2.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   As consultas do servidor rodam aqui como rodam no Worker: o MESMO código de
 *   `server/*.ts`, com o `tx` trocado por um adaptador fino sobre o PGlite (o
 *   Postgres em WebAssembly que os scripts `testar-*-banco.mjs` já usam). Então
 *   o que se confere é o RESULTADO — a linha da Alma9 some com a variável
 *   ligada e volta com ela desligada —, e não só a forma do SQL.
 *
 * O QUE ELE NÃO PROVA
 *   As políticas de linha (RLS). O esquema aqui é o mínimo de colunas que as
 *   leituras tocam, sem política nenhuma: a F31 não muda regra de acesso, e o
 *   recorte dela é uma cláusula a MAIS, que só pode tirar linha. Alcance e
 *   omissão juntos, sob o papel `ideworks_app`, só no banco de verdade.
 *
 * NENHUMA REDE
 *   O PGlite roda no próprio processo. A trava da F0.4 continua valendo.
 */

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Sql, Tx } from '@/server/db';
import { BoardRefused, moveTaskOnBoard, readTree } from '@/server/board';
import { readAllWork, readMyWork, readMyWorkPage } from '@/server/board-trabalho';
import { readCalendar } from '@/server/calendar';
import { clienteContaNoMes, clienteNoMesSql } from '@/server/cliente-no-periodo';
import { WriteRefused, createClient, readCatalogs } from '@/server/client-write';
import { readCatalogos } from '@/server/catalogos';
import {
  FRASE_DE_NAO_ENCONTRADO,
  LIMITE_DE_ALVOS_GUARDADOS,
  type TipoDeAlvo,
  conferirOmitidas,
  esquecerResolucoes,
  resolverOmitidas,
  tarefaForaDasOmitidas,
} from '@/server/omitidas';
import { readPanel } from '@/server/panel';
import {
  readCarteira,
  readClientesParaCarteira,
  readEmpresas,
  readPessoas,
  readTodasEmpresas,
  setCarteira,
  setEmpresas,
} from '@/server/pessoas';
import { readTasks } from '@/server/tasks';
import { readPlanning } from '@/server/planning';
import { type AuthenticatedActor, resolveActor } from '@/server/session';
import {
  bringClients,
  createSpace,
  patchList,
  readClientsForSpace,
  readFullTree,
} from '@/server/tree';
import type { ClienteValidado } from '@/clients/formulario';

/* ───────────────────────────── o adaptador ───────────────────────────── */

type Fragmento = {
  readonly dublê: true;
  readonly strings: readonly string[];
  readonly args: readonly unknown[];
};

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
/** Quantas consultas passaram pelo adaptador — para provar "zero ida ao banco". */
let consultas = 0;

/**
 * O `tx` do driver, no que as leituras usam: etiqueta de template, fragmento
 * aninhado e `await`. Fragmento não roda sozinho — só quando alguém espera.
 */
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

const sql = { begin: (trabalho: (t: Tx) => Promise<unknown>) => trabalho(tx) } as unknown as Sql;

/* ───────────────────────────── o terreno ───────────────────────────── */

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const IDE = id(1);
const HUB = id(2);
const ALMA = id(3);
const PADRAO = id(4);

const C_IDE = id(10);
const C_ALMA = id(11);
const S_IDE = id(20);
const S_ALMA = id(21);
const F_IDE = id(30);
const F_ALMA = id(31);
const L_IDE = id(40);
const L_ALMA = id(41);
const T_IDE = id(50);
const T_ALMA = id(51);
/** Tarefa numa lista da Ide com cliente da Alma9: é trabalho da Ide, e fica. */
const T_IDE_CLIENTE_ALMA = id(52);
/** Demanda antiga, sem lista, de cliente da Alma9: herda a empresa do cliente. */
const D_ALMA = id(53);
const D_IDE = id(54);
const EU = id(99);

const base: AuthenticatedActor = {
  userId: EU,
  email: 'wesley@example.invalid',
  papel: 'super_admin',
  isSuperadmin: true,
  isSuper: true,
  areas: [],
  hasAllClientsAccess: true,
};
const ligado: AuthenticatedActor = { ...base, categoriasOmitidas: [ALMA] };
const desligado = base;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema ideworks;
    create table ideworks.client_categories(id uuid primary key, name text, is_default boolean default false, sort_order int default 0);
    create table ideworks.plans(id uuid primary key, name text, color_bg text, color_text text, color_border text, is_active boolean default true, sort_order int default 0);
    create table ideworks.clients(id uuid primary key, name text, category_id uuid, plan_id uuid,
      urgency text default 'normal', is_active boolean default true, inactive_at timestamptz,
      finance_ok boolean default true, started_on date default '2026-01-01', renews_on date);
    create table ideworks.client_tags(id uuid primary key, name text, color text);
    create table ideworks.client_tag_assignments(client_id uuid, tag_id uuid);
    create table ideworks.month_contracts(id uuid primary key default gen_random_uuid(), client_id uuid, reference_month date,
      planning_done_at timestamptz, client_approved_at timestamptz);
    create table ideworks.month_contract_items(contract_id uuid, content_type text, quantity int);
    create table ideworks.client_quotas(client_id uuid, quantity int);
    create table ideworks.content_items(id uuid primary key default gen_random_uuid(), client_id uuid, reference_month date,
      content_type text, platform text, title text, is_extra boolean default false,
      scheduled_at timestamptz, completed_at timestamptz);
    create table ideworks.appointments(id uuid primary key default gen_random_uuid(), client_id uuid, day date,
      start_time time, title text, notes text);
    create table ideworks.mural_notes(id uuid primary key, client_id uuid);
    create table ideworks.video_captures(id uuid primary key, client_id uuid);
    create table ideworks.client_history(id uuid primary key, client_id uuid);
    create table ideworks.history_documents(id uuid primary key, history_id uuid);
    create table ideworks.spaces(id uuid primary key, category_id uuid, name text, color text,
      sort_order int default 0, archived_at timestamptz);
    create table ideworks.folders(id uuid primary key, space_id uuid, name text, sort_order int default 0, archived_at timestamptz);
    create table ideworks.lists(id uuid primary key, space_id uuid, folder_id uuid, name text, content text,
      sort_order int default 0, archived_at timestamptz, client_id uuid, updated_at timestamptz,
      requires_client boolean not null default false);
    create table ideworks.tasks(id uuid primary key, list_id uuid, client_id uuid, title text, description text,
      status_id uuid, priority text, due_on date, start_on date, completed_at timestamptz,
      archived_at timestamptz, parent_id uuid, created_by uuid,
      created_at timestamptz default now(), completed_by uuid, demand_type text);
    create table ideworks.task_assignees(task_id uuid, user_id uuid);
    create table ideworks.task_checklists(id uuid primary key, task_id uuid);
    create table ideworks.checklist_items(id uuid primary key, checklist_id uuid);
    create table ideworks.task_comments(id uuid primary key, task_id uuid);
    create table ideworks.task_links(id uuid primary key, task_id uuid);
    create table ideworks.task_attachments(id uuid primary key, task_id uuid, content_type text,
      expires_at timestamptz, created_at timestamptz default now());
    create table ideworks.task_automations(id uuid primary key, source_list_id uuid);
    create table ideworks.statuses(id uuid primary key, name text, type text, color text, sort_order int);
    create view ideworks.task_labels as select null::uuid as task_id, null::text as task_type_name, null::jsonb as tags where false;
    create view ideworks.task_progress as select null::uuid as task_id, 0 as subtask_count, 0 as checklist_done,
      0 as checklist_total, 0 as attachment_count, 0 as comment_count where false;
    create view ideworks.list_workflow as select null::uuid as list_id, null::text as status_set_name,
      null::text as inherited_from where false;
    create function ideworks.display_name(u uuid) returns text language sql as $$ select 'Pessoa' $$;
    create function ideworks.assignee_filter_people() returns table(id uuid, name text) language sql as
      $$ select '${EU}'::uuid, 'Wesley'::text $$;
    create table ideworks.profiles(id uuid primary key, email text, full_name text, role text,
      is_superadmin boolean, is_active boolean, has_all_clients_access boolean, areas text[]);

    create view ideworks.tree as
    select l.id as list_id, l.name as list_name, l.content as list_content, l.sort_order as list_sort_order,
           l.archived_at as list_archived_at, f.id as folder_id, f.name as folder_name,
           f.sort_order as folder_sort_order, f.archived_at as folder_archived_at,
           s.id as space_id, s.name as space_name, s.color as space_color, s.sort_order as space_sort_order,
           s.archived_at as space_archived_at, s.category_id,
           (s.archived_at is null and (f.id is null or f.archived_at is null) and l.archived_at is null) as is_live
      from ideworks.lists l
      join ideworks.spaces s on s.id = l.space_id
      left join ideworks.folders f on f.id = l.folder_id;

    insert into ideworks.client_categories values
      ('${IDE}', 'Ide', false, 1), ('${HUB}', 'Ide Hub', false, 2),
      ('${ALMA}', 'Alma9', false, 3), ('${PADRAO}', 'Sem categoria', true, 4);
    insert into ideworks.clients(id, name, category_id, renews_on) values
      ('${C_IDE}', 'Cliente Ide', '${IDE}', '2026-10-01'),
      ('${C_ALMA}', 'Cliente Alma', '${ALMA}', '2026-10-01');
    insert into ideworks.spaces(id, category_id, name) values
      ('${S_IDE}', '${IDE}', 'CLIENTES'), ('${S_ALMA}', '${ALMA}', 'CLIENTES');
    insert into ideworks.folders(id, space_id, name) values
      ('${F_IDE}', '${S_IDE}', 'Pasta Ide'), ('${F_ALMA}', '${S_ALMA}', 'Pasta Alma');
    insert into ideworks.lists(id, space_id, folder_id, name, client_id) values
      ('${L_IDE}', '${S_IDE}', '${F_IDE}', 'Lista Ide', '${C_IDE}'),
      ('${L_ALMA}', '${S_ALMA}', '${F_ALMA}', 'Lista Alma', '${C_ALMA}');
    insert into ideworks.tasks(id, list_id, client_id, title, created_by) values
      ('${T_IDE}', '${L_IDE}', '${C_IDE}', 'Tarefa Ide', '${EU}'),
      ('${T_ALMA}', '${L_ALMA}', '${C_ALMA}', 'Tarefa Alma', '${EU}'),
      ('${T_IDE_CLIENTE_ALMA}', '${L_IDE}', '${C_ALMA}', 'Tarefa Ide de cliente Alma', '${EU}'),
      ('${D_ALMA}', null, '${C_ALMA}', 'Demanda Alma', '${EU}'),
      ('${D_IDE}', null, '${C_IDE}', 'Demanda Ide', '${EU}');
    insert into ideworks.task_assignees
      select t.id, '${EU}'::uuid from ideworks.tasks t;
    insert into ideworks.content_items(client_id, reference_month, content_type, title, scheduled_at) values
      ('${C_IDE}', '2026-09-01', 'video', 'Post Ide', '2026-09-10 15:00+00'),
      ('${C_ALMA}', '2026-09-01', 'video', 'Post Alma', '2026-09-10 15:00+00');
    insert into ideworks.appointments(client_id, day, title) values
      ('${C_IDE}', '2026-09-11', 'Reunião Ide'), ('${C_ALMA}', '2026-09-11', 'Reunião Alma');
    insert into ideworks.profiles values
      ('${EU}', 'wesley@example.invalid', 'Wesley', 'super_admin', true, true, true, '{}');
  `);
});

afterAll(async () => {
  await db.close();
});

beforeEach(() => {
  esquecerResolucoes();
  consultas = 0;
});

/* ───────────────────────────── a resolução ───────────────────────────── */

describe('F31 — de nome para id, numa consulta', () => {
  it('acha a empresa pelo nome sem diferenciar maiúsculas', async () => {
    // `lerNomesOmitidos` já baixa a caixa; o banco tem "Alma9".
    expect(await resolverOmitidas(tx, ['alma9'])).toEqual([ALMA]);
  });

  it('nome que não existe é ignorado, com aviso no log', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await resolverOmitidas(tx, ['nao-existe', 'alma9'])).toEqual([ALMA]);
    expect(aviso.mock.calls.join(' ')).toContain('nao-existe');
    aviso.mockRestore();
  });

  it('a categoria padrão nunca é omitida, mesmo escrita na variável', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await resolverOmitidas(tx, ['sem categoria'])).toEqual([]);
    expect(aviso.mock.calls.join(' ')).toContain('categoria padrão');
    aviso.mockRestore();
  });

  it('guarda a resposta por um minuto: a segunda pergunta não vai ao banco', async () => {
    await resolverOmitidas(tx, ['alma9'], 1_000);
    const antes = consultas;
    expect(await resolverOmitidas(tx, ['alma9'], 30_000)).toEqual([ALMA]);
    expect(consultas).toBe(antes);
    // Vencido o minuto, pergunta de novo.
    await resolverOmitidas(tx, ['alma9'], 70_000);
    expect(consultas).toBe(antes + 1);
  });
});

/* ───────────────────────────── o endereço direto ───────────────────────────── */

describe('F31 — endereço direto para algo da empresa omitida', () => {
  const ator = { kind: 'user' as const, userId: EU, isSuperadmin: true, isSuper: true };

  beforeAll(async () => {
    await db.exec(`
      insert into ideworks.task_checklists values ('${id(60)}', '${T_ALMA}'), ('${id(61)}', '${T_IDE}');
      insert into ideworks.checklist_items values ('${id(62)}', '${id(60)}'), ('${id(63)}', '${id(61)}');
      insert into ideworks.task_comments values ('${id(64)}', '${T_ALMA}'), ('${id(65)}', '${T_IDE}');
      insert into ideworks.task_links values ('${id(66)}', '${T_ALMA}'), ('${id(67)}', '${T_IDE}');
      insert into ideworks.task_attachments(id, task_id) values ('${id(68)}', '${T_ALMA}'), ('${id(69)}', '${T_IDE}');
      insert into ideworks.task_automations values ('${id(70)}', '${L_ALMA}'), ('${id(71)}', '${L_IDE}');
      insert into ideworks.content_items(id, client_id) values ('${id(72)}', '${C_ALMA}'), ('${id(73)}', '${C_IDE}');
      insert into ideworks.appointments(id, client_id, day) values ('${id(74)}', '${C_ALMA}', '2026-01-01'), ('${id(75)}', '${C_IDE}', '2026-01-01');
      insert into ideworks.mural_notes values ('${id(76)}', '${C_ALMA}'), ('${id(77)}', '${C_IDE}');
      insert into ideworks.video_captures values ('${id(78)}', '${C_ALMA}'), ('${id(79)}', '${C_IDE}');
      insert into ideworks.client_history values ('${id(80)}', '${C_ALMA}'), ('${id(81)}', '${C_IDE}');
      insert into ideworks.history_documents values ('${id(82)}', '${id(80)}'), ('${id(83)}', '${id(81)}');
    `);
  });

  // [caminho da Alma9, caminho da Ide, tipo]
  const casos: Array<[string, string, TipoDeAlvo]> = [
    [`/clients/${C_ALMA}`, `/clients/${C_IDE}`, 'cliente'],
    [`/clients/${C_ALMA}/history`, `/clients/${C_IDE}/history`, 'cliente'],
    [`/clients/${C_ALMA}/form`, `/clients/${C_IDE}/form`, 'cliente'],
    [`/clients/${C_ALMA}/mural`, `/clients/${C_IDE}/mural`, 'cliente'],
    [`/board/lists/${L_ALMA}`, `/board/lists/${L_IDE}`, 'lista'],
    [`/board/lists/${L_ALMA}/tasks`, `/board/lists/${L_IDE}/tasks`, 'lista'],
    [`/board/folders/${F_ALMA}`, `/board/folders/${F_IDE}`, 'pasta'],
    [`/board/spaces/${S_ALMA}/lists`, `/board/spaces/${S_IDE}/lists`, 'espaco'],
    [`/board/access/space/${S_ALMA}`, `/board/access/space/${S_IDE}`, 'espaco'],
    [`/board/tasks/${T_ALMA}`, `/board/tasks/${T_IDE}`, 'tarefa'],
    [`/board/tasks/${T_ALMA}/move`, `/board/tasks/${T_IDE_CLIENTE_ALMA}/move`, 'tarefa'],
    [`/tasks/${D_ALMA}`, `/tasks/${D_IDE}`, 'demanda'],
    [`/board/checklists/${id(60)}`, `/board/checklists/${id(61)}`, 'checklist'],
    [`/board/checklist-items/${id(62)}`, `/board/checklist-items/${id(63)}`, 'item-de-checklist'],
    [`/board/comments/${id(64)}`, `/board/comments/${id(65)}`, 'comentario'],
    [`/board/links/${id(66)}`, `/board/links/${id(67)}`, 'link'],
    [`/board/attachments/${id(68)}/url`, `/board/attachments/${id(69)}/url`, 'anexo'],
    [`/board/automations/${id(70)}`, `/board/automations/${id(71)}`, 'automacao'],
    [`/items/${id(72)}/schedule`, `/items/${id(73)}/schedule`, 'item'],
    [`/appointments/${id(74)}`, `/appointments/${id(75)}`, 'compromisso'],
    [`/mural/${id(76)}`, `/mural/${id(77)}`, 'nota'],
    [`/captures/${id(78)}`, `/captures/${id(79)}`, 'gravacao'],
    [`/history/${id(80)}`, `/history/${id(81)}`, 'evento'],
    [`/history/documents/${id(82)}/url`, `/history/documents/${id(83)}/url`, 'documento'],
  ];

  it.each(casos)('%s → "não encontrado"; o da Ide passa', async (daAlma, daIde, tipo) => {
    const recusado = await conferirOmitidas(sql, ator, ['alma9'], daAlma);
    expect(recusado).toEqual({ ids: [ALMA], recusa: FRASE_DE_NAO_ENCONTRADO[tipo] });
    // A frase não diz de quem é nem que existe.
    expect(recusado.recusa).not.toMatch(/alma|omitid/i);

    expect(await conferirOmitidas(sql, ator, ['alma9'], daIde)).toEqual({ ids: [ALMA], recusa: null });
  });

  it('id que não existe segue para a rota, que dá a recusa dela', async () => {
    expect(await conferirOmitidas(sql, ator, ['alma9'], `/board/lists/${id(12345)}`)).toEqual({
      ids: [ALMA],
      recusa: null,
    });
  });

  it('sem nome na variável, nenhuma ida ao banco e nada recusado', async () => {
    expect(await conferirOmitidas(sql, ator, [], `/clients/${C_ALMA}`)).toEqual({ ids: [], recusa: null });
    expect(consultas).toBe(0);
  });

  it('com a resolução guardada e endereço sem alvo, nenhuma ida ao banco', async () => {
    await conferirOmitidas(sql, ator, ['alma9'], '/board/tree');
    const antes = consultas;
    expect(await conferirOmitidas(sql, ator, ['alma9'], '/clients')).toEqual({ ids: [ALMA], recusa: null });
    expect(consultas).toBe(antes);
  });
});

/* ───────────────────────────── o crachá ───────────────────────────── */

describe('F31 — resolveActor leva as omitidas no ator e barra o endereço direto', () => {
  const request = () =>
    new Request('https://works.example.invalid/api/x', { headers: { Authorization: 'Bearer abc' } });
  const provedor = (omitidas?: string) => ({
    url: 'https://provedor.example.invalid',
    anonKey: 'anon',
    ...(omitidas === undefined ? {} : { empresasOmitidas: omitidas }),
  });

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: EU, email: 'wesley@example.invalid' }))),
    );
  });

  it('ligada: o ator carrega os ids, e o cliente da Alma9 é "não encontrado"', async () => {
    const aberta = await resolveActor(request(), sql, provedor('Alma9'), `/clients/${C_IDE}`);
    expect(aberta.ok && aberta.actor.categoriasOmitidas).toEqual([ALMA]);

    const barrada = await resolveActor(request(), sql, provedor(' ALMA9 , '), `/clients/${C_ALMA}`);
    expect(barrada).toEqual({
      ok: false,
      status: 404,
      reason: 'not_found',
      message: 'Cliente não encontrado.',
    });
    vi.unstubAllGlobals();
  });

  it('conferência que falha (SQL, permissão, conexão) não derruba o pedido: segue sem omitir, com aviso', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // O perfil (preauth) lê normal; toda consulta que toca a F31 estoura —
    // na resolução dos nomes e, com ela guardada, na conferência do endereço.
    const falhas = [
      'permission denied for table client_categories',
      'column "is_default" does not exist',
      'Connection terminated unexpectedly',
    ];
    for (const falha of falhas) {
      esquecerResolucoes();
      const quebrado = ((strings: TemplateStringsArray, ...args: unknown[]) => {
        const f = (tx as unknown as (s: TemplateStringsArray, ...a: unknown[]) => PromiseLike<unknown[]>)(
          strings,
          ...args,
        );
        if (strings.join(' ').includes('client_categories')) {
          return { ...f, then: (_ok: unknown, erro: (e: unknown) => unknown) => Promise.reject(new Error(falha)).then(undefined, erro) };
        }
        return f;
      }) as unknown as Tx;
      const sqlQuebrado = { begin: (trabalho: (t: Tx) => Promise<unknown>) => trabalho(quebrado) } as unknown as Sql;

      for (const caminho of [`/clients/${C_ALMA}`, '/board/tree', undefined]) {
        const r = await resolveActor(request(), sqlQuebrado, provedor('Alma9'), caminho);
        expect(r.ok).toBe(true);
        expect(r.ok && 'categoriasOmitidas' in r.actor).toBe(false);
      }
      expect(aviso.mock.calls.flat().join(' ')).toContain(falha);
    }

    // Resolução guardada, mas a conferência do ENDEREÇO estoura: também segue.
    esquecerResolucoes();
    await resolverOmitidas(tx, ['alma9']);
    const enderecoQuebrado = ((strings: TemplateStringsArray, ...args: unknown[]) => {
      const f = (tx as unknown as (s: TemplateStringsArray, ...a: unknown[]) => PromiseLike<unknown[]>)(
        strings,
        ...args,
      );
      if (strings.join(' ').includes('ideworks.clients c')) {
        return { ...f, then: (_ok: unknown, erro: (e: unknown) => unknown) => Promise.reject(new Error('invalid input syntax for type uuid')).then(undefined, erro) };
      }
      return f;
    }) as unknown as Tx;
    const sqlEndereco = { begin: (trabalho: (t: Tx) => Promise<unknown>) => trabalho(enderecoQuebrado) } as unknown as Sql;
    const r = await resolveActor(request(), sqlEndereco, provedor('Alma9'), `/clients/${C_ALMA}`);
    expect(r.ok).toBe(true);
    expect(aviso.mock.calls.flat().join(' ')).toContain('invalid input syntax for type uuid');

    aviso.mockRestore();
    vi.unstubAllGlobals();
  });

  it('desligada (ausente ou vazia): o ator é o de antes e o endereço passa', async () => {
    for (const valor of [undefined, '', ' , ']) {
      consultas = 0;
      const r = await resolveActor(request(), sql, provedor(valor), `/clients/${C_ALMA}`);
      expect(r.ok).toBe(true);
      expect(r.ok && 'categoriasOmitidas' in r.actor).toBe(false);
      // Só as duas de sempre (a declaração `preauth` e o perfil) — nenhuma da F31.
      expect(consultas).toBe(2);
    }
    vi.unstubAllGlobals();
  });
});

/* ───────────────────────────── o recorte de tarefa ───────────────────────────── */

describe('F31 — o recorte de tarefa (tarefaForaDasOmitidas)', () => {
  const ler = async (ator: AuthenticatedActor) =>
    ((await tx`
      select t.title from ideworks.tasks t
       where true ${tarefaForaDasOmitidas(tx, ator)}
       order by t.title`) as unknown as Array<{ title: string }>).map((r) => r.title);

  it('ligada: some a tarefa da lista da Alma9 e a demanda sem lista de cliente da Alma9', async () => {
    expect(await ler(ligado)).toEqual(['Demanda Ide', 'Tarefa Ide', 'Tarefa Ide de cliente Alma']);
  });

  it('desligada: todas, como hoje', async () => {
    expect(await ler(desligado)).toHaveLength(5);
  });
});

/* ───────────────────────────── as leituras ───────────────────────────── */

describe('F31 — as leituras, ligada e desligada', () => {
  it('Painel: o cliente da Alma9 some, e com ele a renovação; a conferência não o acusa', async () => {
    const lig = await readPanel(sql, ligado, '2026-09-01', '2026-09-30');
    expect(lig.clients.map((c) => c.name)).toEqual(['Cliente Ide']);
    const listas = JSON.stringify(lig.conferencia);
    expect(listas).not.toContain(L_ALMA);
    expect(listas).not.toContain(C_ALMA);

    const des = await readPanel(sql, desligado, '2026-09-01', '2026-09-30');
    expect(des.clients.map((c) => c.name)).toEqual(['Cliente Alma', 'Cliente Ide']);
  });

  it('Planejamento', async () => {
    expect((await readPlanning(sql, ligado, '2026-09-01')).map((c) => c.name)).toEqual(['Cliente Ide']);
    expect((await readPlanning(sql, desligado, '2026-09-01')).map((c) => c.name)).toEqual([
      'Cliente Alma',
      'Cliente Ide',
    ]);
  });

  it('Calendário: entrega e compromisso', async () => {
    const periodo = { from: '2026-09-01', to: '2026-10-01' };
    const lig = await readCalendar(sql, ligado, periodo);
    expect(lig.map((e) => e.clientName)).toEqual(['Cliente Ide', 'Cliente Ide']);
    const des = await readCalendar(sql, desligado, periodo);
    expect(des.map((e) => e.clientName).sort()).toEqual([
      'Cliente Alma',
      'Cliente Alma',
      'Cliente Ide',
      'Cliente Ide',
    ]);
  });

  it('F38, Fases 4 e 5 (D6) — cliente cancelado: no calendário geral e nas peças do Painel só até o mês do cancelamento; a ficha dele guarda o passado', async () => {
    const periodo = { from: '2026-09-01', to: '2026-10-01' };
    const cancelar = (instante: string) =>
      db.exec(`update ideworks.clients set is_active = false, inactive_at = '${instante}' where id = '${C_ALMA}'`);
    try {
      // Cancelado em agosto: setembro já não é dele.
      await cancelar('2026-08-20 12:00+00');
      const geral = await readCalendar(sql, desligado, periodo);
      expect(geral.map((e) => e.clientName)).toEqual(['Cliente Ide', 'Cliente Ide']);
      const daFicha = await readCalendar(sql, desligado, periodo, C_ALMA);
      expect(daFicha.map((e) => e.kind).sort()).toEqual(['appointment', 'delivery']);

      const painel = await readPanel(sql, desligado, '2026-09-01', '2026-09-30');
      const alma = painel.clients.find((c) => c.id === C_ALMA);
      const ide = painel.clients.find((c) => c.id === C_IDE);
      expect(alma?.inPeriod).toEqual({ scheduled: 0, completed: 0 });
      expect(alma?.delivery).toMatchObject({ measurable: false });
      expect(ide?.inPeriod).toEqual({ scheduled: 1, completed: 0 });

      // Cancelado em setembro: setembro ainda é dele (o mês do cancelamento conta).
      await cancelar('2026-09-20 12:00+00');
      const noMes = await readCalendar(sql, desligado, periodo);
      expect(noMes.map((e) => e.clientName).sort()).toEqual(['Cliente Alma', 'Cliente Alma', 'Cliente Ide', 'Cliente Ide']);
      const painelNoMes = await readPanel(sql, desligado, '2026-09-01', '2026-09-30');
      expect(painelNoMes.clients.find((c) => c.id === C_ALMA)?.inPeriod).toEqual({ scheduled: 1, completed: 0 });
      // O presente continua só com ativos: cancelado não tem situação de entrega.
      expect(painelNoMes.clients.find((c) => c.id === C_ALMA)?.deliveryStatus).toBeNull();

      // 01/10 às 01h UTC é 30/09 às 22h em São Paulo: cancelou em SETEMBRO.
      await cancelar('2026-10-01 01:00+00');
      expect((await readCalendar(sql, desligado, periodo)).filter((e) => e.clientId === C_ALMA)).toHaveLength(2);
    } finally {
      await db.exec(`update ideworks.clients set is_active = true, inactive_at = null where id = '${C_ALMA}'`);
    }
  });

  it('F38, Fase 5 — Painel: contrato de cliente cancelado num mês depois do cancelamento não vira medidor', async () => {
    const CONTRATO = id(80);
    await db.exec(`
      insert into ideworks.month_contracts(id, client_id, reference_month) values ('${CONTRATO}', '${C_ALMA}', '2026-09-01');
      insert into ideworks.month_contract_items(contract_id, content_type, quantity) values ('${CONTRATO}', 'video', 2);
    `);
    const cancelar = (instante: string) =>
      db.exec(`update ideworks.clients set is_active = false, inactive_at = '${instante}' where id = '${C_ALMA}'`);
    try {
      // Cancelado em agosto, contrato de setembro: o mês não é dele — nada de 0%.
      await cancelar('2026-08-20 12:00+00');
      const depois = await readPanel(sql, desligado, '2026-09-01', '2026-09-30');
      expect(depois.clients.find((c) => c.id === C_ALMA)?.delivery).toMatchObject({
        measurable: false,
        reason: 'no_contract',
      });
      // Cancelado em setembro: o contrato de setembro conta (o mês do cancelamento é dele).
      await cancelar('2026-09-20 12:00+00');
      const noMes = await readPanel(sql, desligado, '2026-09-01', '2026-09-30');
      expect(noMes.clients.find((c) => c.id === C_ALMA)?.delivery).toMatchObject({ measurable: true, level: 0 });
    } finally {
      await db.exec(`
        update ideworks.clients set is_active = true, inactive_at = null where id = '${C_ALMA}';
        delete from ideworks.month_contract_items where contract_id = '${CONTRATO}';
        delete from ideworks.month_contracts where id = '${CONTRATO}';
      `);
    }
  });

  it('F38, Fase 5 — a regra de período em SQL (`clienteNoMesSql`) e em TypeScript (`clienteContaNoMes`) concordam, inclusive na virada do mês em São Paulo', async () => {
    const instantes: Array<string | null> = [
      null,
      '2026-08-31 12:00+00',
      '2026-09-01 02:59+00', // 31/08 23h59 em São Paulo → agosto
      '2026-09-01 03:00+00', // 01/09 00h00 em São Paulo → setembro
      '2026-09-30 23:00+00',
      '2026-10-01 02:00+00', // 30/09 23h em São Paulo → setembro
    ];
    const meses = ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'];
    try {
      for (const instante of instantes) {
        for (const ativo of [true, false]) {
          await db.exec(
            `update ideworks.clients set is_active = ${ativo}, inactive_at = ${instante === null ? 'null' : `'${instante}'`} where id = '${C_ALMA}'`,
          );
          const [linha] = (await tx`
            select to_char(inactive_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as dia
              from ideworks.clients where id = ${C_ALMA}::uuid`) as unknown as Array<{ dia: string | null }>;
          if (instante === '2026-09-01 02:59+00') expect(linha?.dia).toBe('2026-08-31');
          if (instante === '2026-10-01 02:00+00') expect(linha?.dia).toBe('2026-09-30');
          for (const mes of meses) {
            const [r] = (await tx`select ${clienteNoMesSql(tx, tx`${C_ALMA}::uuid`, tx`${mes}::date`)} as conta`) as unknown as Array<{ conta: boolean }>;
            const ts = clienteContaNoMes({ isActive: ativo, cancelledOn: linha?.dia ?? null }, mes);
            expect({ instante, ativo, mes, conta: r?.conta }).toEqual({ instante, ativo, mes, conta: ts });
          }
        }
      }
      // A virada medida: 02h59 UTC de 01/09 ainda é agosto; 03h00 já é setembro.
      expect(clienteContaNoMes({ isActive: false, cancelledOn: '2026-08-31' }, '2026-09-01')).toBe(false);
      expect(clienteContaNoMes({ isActive: false, cancelledOn: '2026-09-01' }, '2026-09-01')).toBe(true);
    } finally {
      await db.exec(`update ideworks.clients set is_active = true, inactive_at = null where id = '${C_ALMA}'`);
    }
  });

  it('Barra lateral (árvore viva)', async () => {
    expect((await readTree(sql, ligado)).map((r) => r.listId)).toEqual([L_IDE]);
    expect((await readTree(sql, desligado)).map((r) => r.listId).sort()).toEqual([L_IDE, L_ALMA].sort());
  });

  it('Árvore completa e as empresas do "Espaço novo"', async () => {
    const lig = await readFullTree(sql, ligado);
    expect(lig.spaces.map((r) => r.spaceId)).toEqual([S_IDE]);
    expect(lig.companies.map((c) => c.name)).toEqual(['Ide', 'Ide Hub', 'Sem categoria']);

    const des = await readFullTree(sql, desligado);
    expect(des.spaces.map((r) => r.spaceId).sort()).toEqual([S_IDE, S_ALMA].sort());
    expect(des.companies.map((c) => c.name)).toContain('Alma9');
  });

  it('Clientes para trazer ao espaço', async () => {
    const lig = await readClientsForSpace(sql, ligado, S_IDE);
    expect(lig.clients.map((c) => c.name)).toEqual(['Cliente Ide']);
    const des = await readClientsForSpace(sql, desligado, S_IDE);
    expect(des.clients.map((c) => c.name).sort()).toEqual(['Cliente Alma', 'Cliente Ide']);
  });

  it('Seletor de cliente do "Marcar no dia" (Calendário) e da carteira: o cliente omitido não é oferecido', async () => {
    expect((await readClientesParaCarteira(sql, ligado)).clientes.map((c) => c.nome)).toEqual(['Cliente Ide']);
    expect((await readClientesParaCarteira(sql, desligado)).clientes.map((c) => c.nome)).toEqual([
      'Cliente Alma',
      'Cliente Ide',
    ]);
  });

  it('Checklist da ficha (demandas do cliente): tarefa em lista da Alma9 some, mesmo de cliente da Ide', async () => {
    await tx`insert into ideworks.tasks(id, list_id, client_id, title, created_by)
             values (${id(55)}, ${L_ALMA}, ${C_IDE}, 'Tarefa Alma de cliente Ide', ${EU})`;
    try {
      const lig = (await readTasks(sql, ligado, C_IDE)).map((t) => t.title).sort();
      expect(lig).toEqual(['Demanda Ide', 'Tarefa Ide']);
      const des = (await readTasks(sql, desligado, C_IDE)).map((t) => t.title).sort();
      expect(des).toEqual(['Demanda Ide', 'Tarefa Alma de cliente Ide', 'Tarefa Ide']);
      // Cliente da Alma9 numa lista da Ide: a tarefa é da Ide e fica.
      expect((await readTasks(sql, ligado, C_ALMA)).map((t) => t.title)).toEqual([
        'Tarefa Ide de cliente Alma',
      ]);
    } finally {
      await tx`delete from ideworks.tasks where id = ${id(55)}`;
    }
  });

  it('Catálogos da ficha do cliente: a categoria omitida não é oferecida', async () => {
    expect((await readCatalogs(sql, ligado)).categories.map((c) => c.name)).toEqual([
      'Ide',
      'Ide Hub',
      'Sem categoria',
    ]);
    expect((await readCatalogs(sql, desligado)).categories.map((c) => c.name)).toContain('Alma9');
  });

  it('Minhas tarefas (com e sem página) e Todas as tarefas', async () => {
    const minhas = await readMyWork(sql, ligado);
    expect(minhas.rows.map((r) => r.title).sort()).toEqual([
      'Demanda Ide',
      'Tarefa Ide',
      'Tarefa Ide de cliente Alma',
    ]);
    expect((await readMyWork(sql, desligado)).rows).toHaveLength(5);

    const pagina = await readMyWorkPage(sql, ligado, { aba: 'pendente', cursor: null, limite: 100 });
    expect(pagina.counts.pendente).toBe(3);
    expect(pagina.rows).toHaveLength(3);
    const paginaDes = await readMyWorkPage(sql, desligado, { aba: 'pendente', cursor: null, limite: 100 });
    expect(paginaDes.counts.pendente).toBe(5);

    const todas = await readAllWork(sql, ligado);
    expect(todas.total).toBe(3);
    expect(todas.rows).toHaveLength(3);
    // O menu de responsáveis conta com o mesmo recorte.
    expect(todas.assigneeOptions.find((o) => o.id === EU)?.tasks).toBe(3);
    const todasDes = await readAllWork(sql, desligado);
    expect(todasDes.total).toBe(5);
    expect(todasDes.assigneeOptions.find((o) => o.id === EU)?.tasks).toBe(5);
  });
});

/* ───────────────────────────── as escritas ───────────────────────────── */

describe('F31 — nada nasce nem vai para empresa omitida', () => {
  it('espaço novo na Alma9: "Empresa não encontrada.", sem ir ao banco', async () => {
    const erro = await createSpace(sql, ligado, { categoryId: ALMA, name: 'Novo', statuses: [] }).catch(
      (e: unknown) => e,
    );
    expect(erro).toBeInstanceOf(BoardRefused);
    expect(erro).toMatchObject({ message: 'Empresa não encontrada.', status: 404 });
    expect(consultas).toBe(0);
  });

  it('mover lista para espaço da Alma9: recusado, e a lista fica onde estava', async () => {
    const erro = await patchList(sql, ligado, L_IDE, { mover: { spaceId: S_ALMA, folderId: null } }).catch(
      (e: unknown) => e,
    );
    expect(erro).toMatchObject({ message: 'Espaço não encontrado, ou fora do seu alcance.', status: 404 });
    const [lista] = (await tx`select space_id from ideworks.lists where id = ${L_IDE}`) as unknown as Array<{
      space_id: string;
    }>;
    expect(lista.space_id).toBe(S_IDE);
  });

  it('mover lista desligada: a escrita acontece como hoje', async () => {
    await patchList(sql, desligado, L_IDE, { mover: { spaceId: S_ALMA, folderId: null } });
    const [lista] = (await tx`select space_id from ideworks.lists where id = ${L_IDE}`) as unknown as Array<{
      space_id: string;
    }>;
    expect(lista.space_id).toBe(S_ALMA);
    await tx`update ideworks.lists set space_id = ${S_IDE}, folder_id = ${F_IDE} where id = ${L_IDE}`;
  });

  it('mover tarefa para lista da Alma9: a recusa de destino indisponível, sem escrita', async () => {
    const erro = await moveTaskOnBoard(sql, ligado, T_IDE, L_ALMA, null).catch((e: unknown) => e);
    expect(erro).toMatchObject({
      message: 'A lista de destino está indisponível ou não tem etapas.',
      status: 400,
    });
  });

  it('trazer cliente da Alma9 para o espaço: o lote inteiro é recusado', async () => {
    const erro = await bringClients(sql, ligado, S_IDE, { folderId: null, clientIds: [C_ALMA] }).catch(
      (e: unknown) => e,
    );
    expect(erro).toMatchObject({ status: 403 });
  });

  it('cliente novo na categoria omitida: a recusa de categoria que não existe', async () => {
    const v = { categoryId: ALMA } as unknown as ClienteValidado;
    const erro = await createClient(sql, ligado, v).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(WriteRefused);
    expect(erro).toMatchObject({ message: 'O plano ou a categoria escolhida não existe mais.', status: 409 });
    expect(consultas).toBe(0);
  });
});

/* ───────────────────────────── o custo da conferência — Fase 3a ───────────────────────────── */

describe('F31, Fase 3a — a conferência do endereço direto não custa transação com o guardado quente', () => {
  const request = () =>
    new Request('https://works.example.invalid/api/x', { headers: { Authorization: 'Bearer abc' } });
  const provedor = { url: 'https://provedor.example.invalid', anonKey: 'anon', empresasOmitidas: 'Alma9' };

  /** Transações abertas — cada `withActor` é uma, e cada uma prende uma conexão do pool. */
  let transacoes = 0;
  const sqlContado = {
    begin: (trabalho: (t: Tx) => Promise<unknown>) => {
      transacoes += 1;
      return trabalho(tx);
    },
  } as unknown as Sql;

  /** Um pedido, medido: quantas transações `resolveActor` abriu para ele. */
  const pedir = async (caminho: string, comSql: Sql = sqlContado) => {
    const antes = transacoes;
    const r = await resolveActor(request(), comSql, provedor, caminho);
    return { r, transacoes: transacoes - antes };
  };

  beforeEach(() => {
    transacoes = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: EU, email: 'wesley@example.invalid' }))),
    );
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('abrir /board/tasks/:id duas vezes: 2 transações na primeira (perfil + conferência), 1 na segunda (só o perfil)', async () => {
    const frio = await pedir(`/board/tasks/${T_IDE}`);
    expect(frio.r.ok).toBe(true);
    expect(frio.transacoes).toBe(2);

    const quente = await pedir(`/board/tasks/${T_IDE}`);
    expect(quente.r.ok && quente.r.actor.categoriasOmitidas).toEqual([ALMA]);
    // A mesma de quem não tem a variável: nenhuma transação da F31.
    expect(quente.transacoes).toBe(1);

    // E o que mora dentro da tarefa (subrota) pega o mesmo guardado.
    expect((await pedir(`/board/tasks/${T_IDE}/move`)).transacoes).toBe(1);
  });

  it('o omitido guardado continua "não encontrado", sem transação a mais', async () => {
    const recusa = { ok: false, status: 404, reason: 'not_found', message: FRASE_DE_NAO_ENCONTRADO.tarefa };
    const frio = await pedir(`/board/tasks/${T_ALMA}`);
    expect(frio.r).toEqual(recusa);
    expect(frio.transacoes).toBe(2);
    const quente = await pedir(`/board/tasks/${T_ALMA}`);
    expect(quente.r).toEqual(recusa);
    expect(quente.transacoes).toBe(1);
  });

  it('lista, pasta, espaço e cliente: a segunda abertura também custa só o perfil', async () => {
    for (const caminho of [
      `/board/lists/${L_IDE}/tasks`,
      `/board/folders/${F_IDE}`,
      `/board/spaces/${S_IDE}/lists`,
      `/clients/${C_IDE}`,
    ]) {
      expect((await pedir(caminho)).transacoes).toBe(2);
      expect((await pedir(caminho)).transacoes).toBe(1);
    }
  });

  it('"não achei" nunca é guardado: id que não existe (ou fora do alcance) pergunta de novo a cada pedido', async () => {
    const caminho = `/board/lists/${id(54321)}`;
    expect((await pedir(caminho)).transacoes).toBe(2);
    expect((await pedir(caminho)).transacoes).toBe(2);
  });

  it('empresa NULA por falta de alcance não vira fato: quem enxerga depois ainda recebe o "não encontrado"', async () => {
    // Alguém que não enxerga o ESPAÇO da tarefa da Alma9: a junção à esquerda
    // devolve empresa nula, e o pedido segue para a rota (que recusa como sempre).
    const semEspaco = ((strings: TemplateStringsArray, ...args: unknown[]) => {
      const f = (tx as unknown as (s: TemplateStringsArray, ...a: unknown[]) => PromiseLike<unknown[]>)(
        strings,
        ...args,
      );
      if (strings.join(' ').includes('from ideworks.tasks t')) {
        return { ...f, then: (ok: (v: unknown) => unknown) => Promise.resolve([{ category_id: null }]).then(ok) };
      }
      return f;
    }) as unknown as Tx;
    const sqlSemEspaco = {
      begin: (trabalho: (t: Tx) => Promise<unknown>) => {
        transacoes += 1;
        return trabalho(semEspaco);
      },
    } as unknown as Sql;
    expect((await pedir(`/board/tasks/${T_ALMA}`, sqlSemEspaco)).r.ok).toBe(true);

    // O super admin, logo depois: vai ao banco (nada foi guardado) e é barrado.
    const depois = await pedir(`/board/tasks/${T_ALMA}`);
    expect(depois.transacoes).toBe(2);
    expect(depois.r.ok).toBe(false);
  });

  it('o guardado é a EMPRESA, não a decisão: mudar a variável vale na hora', async () => {
    await conferirOmitidas(sqlContado, { kind: 'user', userId: EU, isSuperadmin: true, isSuper: true }, ['alma9'], `/board/tasks/${T_ALMA}`);
    // Outra omitida: a tarefa da Alma9 (empresa guardada) deixa de ser recusada.
    const r = await conferirOmitidas(
      sqlContado,
      { kind: 'user', userId: EU, isSuperadmin: true, isSuper: true },
      ['ide hub'],
      `/board/tasks/${T_ALMA}`,
    );
    expect(r).toEqual({ ids: [HUB], recusa: null });
  });

  it('vence em um minuto: depois dele, pergunta ao banco de novo', async () => {
    const agora = vi.spyOn(Date, 'now');
    agora.mockReturnValue(1_000_000);
    await pedir(`/board/tasks/${T_IDE}`);
    agora.mockReturnValue(1_000_000 + 59_000);
    expect((await pedir(`/board/tasks/${T_IDE}`)).transacoes).toBe(1);
    agora.mockReturnValue(1_000_000 + 61_000);
    expect((await pedir(`/board/tasks/${T_IDE}`)).transacoes).toBe(2);
    agora.mockRestore();
  });

  it('conferência que falha não guarda nada e não derruba o pedido; o seguinte confere de verdade', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await resolverOmitidas(tx, ['alma9']);
    const quebrado = ((strings: TemplateStringsArray, ...args: unknown[]) => {
      const f = (tx as unknown as (s: TemplateStringsArray, ...a: unknown[]) => PromiseLike<unknown[]>)(
        strings,
        ...args,
      );
      if (strings.join(' ').includes('from ideworks.tasks t')) {
        return { ...f, then: (_ok: unknown, erro: (e: unknown) => unknown) => Promise.reject(new Error('Connection terminated unexpectedly')).then(undefined, erro) };
      }
      return f;
    }) as unknown as Tx;
    const sqlQuebrado = { begin: (trabalho: (t: Tx) => Promise<unknown>) => trabalho(quebrado) } as unknown as Sql;
    const r = await resolveActor(request(), sqlQuebrado, provedor, `/board/tasks/${T_ALMA}`);
    expect(r.ok).toBe(true);
    expect(aviso.mock.calls.flat().join(' ')).toContain('Connection terminated unexpectedly');

    const seguinte = await pedir(`/board/tasks/${T_ALMA}`);
    expect(seguinte.transacoes).toBe(2);
    expect(seguinte.r.ok).toBe(false);
    aviso.mockRestore();
  });

  it('o guardado tem teto: passou de LIMITE_DE_ALVOS_GUARDADOS, sai o mais antigo', async () => {
    const ator = { kind: 'user' as const, userId: EU, isSuperadmin: true, isSuper: true };
    await conferirOmitidas(sqlContado, ator, ['alma9'], `/board/tasks/${T_IDE}`);
    // Enche com ids que existem de verdade (listas), para serem guardados.
    const extras = Array.from({ length: LIMITE_DE_ALVOS_GUARDADOS }, (_, i) => id(100_000 + i));
    await db.query(
      `insert into ideworks.lists(id, space_id, name) select unnest($1::uuid[]), '${S_IDE}', 'extra'`,
      [extras],
    );
    for (const l of extras) await conferirOmitidas(sqlContado, ator, ['alma9'], `/board/lists/${l}`);
    const antes = transacoes;
    await conferirOmitidas(sqlContado, ator, ['alma9'], `/board/tasks/${T_IDE}`);
    expect(transacoes - antes).toBe(1); // a tarefa, a mais antiga, saiu
    await db.query(`delete from ideworks.lists where name = 'extra'`);
  }, 60_000);
});

/* ───────────────────────────── a administração — Fase 3a ───────────────────────────── */

describe('F31, Fase 3a — Pessoas, Convite e Catálogos com o recorte', () => {
  const OUTRA = id(98);
  const C_IDE_2 = id(12);
  const admin: AuthenticatedActor = { ...base, papel: 'admin', isSuper: false };
  const adminLigado: AuthenticatedActor = { ...admin, categoriasOmitidas: [ALMA] };

  beforeAll(async () => {
    // O mínimo das funções de administração: a mesma FORMA das do banco
    // (security definer, `set_user_*` apaga e regrava), sem as guardas de papel
    // — elas não mudam na F31 e são provadas em `scripts/provar-*.mjs`.
    // Quem age é lido de `_ator` (o PGlite fora de transação não guarda o
    // `set_config` local).
    await db.exec(`
      create table ideworks._ator(is_super boolean);
      insert into ideworks._ator values (true);
      create table ideworks.user_categories(user_id uuid, category_id uuid);
      create table ideworks.user_clients(user_id uuid, client_id uuid);
      insert into ideworks.clients(id, name, category_id) values ('${C_IDE_2}', 'Outro Ide', '${IDE}');
      insert into ideworks.user_categories values ('${OUTRA}', '${IDE}'), ('${OUTRA}', '${ALMA}'), ('${EU}', '${IDE}');
      insert into ideworks.user_clients values ('${OUTRA}', '${C_IDE}'), ('${OUTRA}', '${C_ALMA}');

      create function ideworks.can_grant_categories(p uuid[]) returns boolean language sql as $$
        select (select is_super from ideworks._ator)
            or not exists (select 1 from unnest(p) x(id)
                            where not exists (select 1 from ideworks.user_categories uc
                                               where uc.user_id = '${EU}' and uc.category_id = x.id)) $$;
      create function ideworks.admin_user_categories(p uuid) returns table(category_id uuid, name text)
        language sql as $$ select c.id, c.name from ideworks.user_categories uc
          join ideworks.client_categories c on c.id = uc.category_id where uc.user_id = p order by lower(c.name) $$;
      create function ideworks.admin_user_clients(p uuid) returns table(client_id uuid, name text)
        language sql as $$ select c.id, c.name from ideworks.user_clients uc
          join ideworks.clients c on c.id = uc.client_id where uc.user_id = p order by lower(c.name) $$;
      create function ideworks.admin_directory() returns table(id uuid, email text, full_name text, role text,
          is_superadmin boolean, is_active boolean, has_all_clients_access boolean, areas text[],
          clientes int, empresas int, created_at timestamptz)
        language sql as $$ select p.id, p.email, p.full_name, p.role, p.is_superadmin, p.is_active,
          p.has_all_clients_access, p.areas,
          (select count(*)::int from ideworks.user_clients uc where uc.user_id = p.id),
          (select count(*)::int from ideworks.user_categories x where x.user_id = p.id), null::timestamptz
          from ideworks.profiles p order by p.email $$;
      create function ideworks.set_user_clients(p uuid, ids uuid[]) returns int language plpgsql as $$
        begin
          delete from ideworks.user_clients where user_id = p;
          insert into ideworks.user_clients select p, c.id from ideworks.clients c where c.id = any(coalesce(ids, '{}'));
          return (select count(*) from ideworks.user_clients where user_id = p);
        end $$;
      -- Como a F17.36c: quem não é o topo só dá o que tem, e o que a pessoa tem
      -- fora do alcance dele volta sozinho.
      create function ideworks.set_user_categories(p uuid, ids uuid[]) returns int language plpgsql as $$
        declare v uuid[] := coalesce(ids, '{}');
        begin
          if not (select is_super from ideworks._ator) then
            if not ideworks.can_grant_categories(v) then
              raise exception 'voce so pode dar acesso as empresas de que participa' using errcode = '42501';
            end if;
            v := v || coalesce((select array_agg(uc.category_id) from ideworks.user_categories uc
                                 where uc.user_id = p and not exists (
                                   select 1 from ideworks.user_categories m
                                    where m.user_id = '${EU}' and m.category_id = uc.category_id)), '{}');
          end if;
          delete from ideworks.user_categories where user_id = p;
          insert into ideworks.user_categories select p, c.id from ideworks.client_categories c where c.id = any(v);
          return (select count(*) from ideworks.user_categories where user_id = p);
        end $$;
    `);
  });

  beforeEach(async () => {
    await db.exec(`update ideworks._ator set is_super = true`);
    await db.exec(`
      delete from ideworks.user_categories where user_id = '${OUTRA}';
      insert into ideworks.user_categories values ('${OUTRA}', '${IDE}'), ('${OUTRA}', '${ALMA}');
      delete from ideworks.user_clients where user_id = '${OUTRA}';
      insert into ideworks.user_clients values ('${OUTRA}', '${C_IDE}'), ('${OUTRA}', '${C_ALMA}');
    `);
  });

  const unidadesDela = async () =>
    ((await db.query(`select category_id from ideworks.user_categories where user_id = '${OUTRA}' order by category_id`))
      .rows as Array<{ category_id: string }>).map((r) => r.category_id);
  const carteiraDela = async () =>
    ((await db.query(`select client_id from ideworks.user_clients where user_id = '${OUTRA}' order by client_id`))
      .rows as Array<{ client_id: string }>).map((r) => r.client_id);

  it('Pessoas e Convite (/admin/companies): a unidade omitida não é oferecida; desligada, é', async () => {
    const nomes = (r: { empresas: { nome: string }[] }) => r.empresas.map((e) => e.nome);
    expect(nomes(await readTodasEmpresas(sql, ligado))).toEqual(['Ide', 'Ide Hub', 'Sem categoria']);
    expect(nomes(await readTodasEmpresas(sql, desligado))).toEqual(['Ide', 'Ide Hub', 'Alma9', 'Sem categoria']);
  });

  it('as unidades da pessoa: a omitida não aparece; desligada, aparece', async () => {
    expect((await readEmpresas(sql, ligado, OUTRA)).empresas.map((e) => e.nome)).toEqual(['Ide']);
    expect((await readEmpresas(sql, desligado, OUTRA)).empresas.map((e) => e.nome)).toEqual(['Alma9', 'Ide']);
  });

  it('salvar as unidades pela tela (sem a omitida, que ela não mostra) NÃO apaga o vínculo com a omitida', async () => {
    await setEmpresas(sql, ligado, OUTRA, [IDE, HUB]);
    expect(await unidadesDela()).toEqual([IDE, HUB, ALMA].sort());
    // Tirar tudo o que se vê também não leva a omitida junto.
    await setEmpresas(sql, ligado, OUTRA, []);
    expect(await unidadesDela()).toEqual([ALMA]);
  });

  it('desligada, salvar é como sempre foi: o que não vem na lista sai', async () => {
    await setEmpresas(sql, desligado, OUTRA, [IDE]);
    expect(await unidadesDela()).toEqual([IDE]);
  });

  it('quem administra sem a omitida: não a manda (o banco recusaria) — o banco a preserva sozinho', async () => {
    await db.exec(`update ideworks._ator set is_super = false`);
    await setEmpresas(sql, adminLigado, OUTRA, [IDE]);
    expect(await unidadesDela()).toEqual([IDE, ALMA].sort());
  });

  it('a carteira da pessoa: o cliente omitido não aparece; salvar não o apaga', async () => {
    expect((await readCarteira(sql, ligado, OUTRA)).clientes.map((c) => c.nome)).toEqual(['Cliente Ide']);
    expect((await readCarteira(sql, desligado, OUTRA)).clientes.map((c) => c.nome)).toEqual([
      'Cliente Alma',
      'Cliente Ide',
    ]);
    await setCarteira(sql, ligado, OUTRA, [C_IDE_2]);
    expect(await carteiraDela()).toEqual([C_ALMA, C_IDE_2].sort());
    await setCarteira(sql, ligado, OUTRA, []);
    expect(await carteiraDela()).toEqual([C_ALMA]);
  });

  it('a carteira desligada: salvar sem o cliente o tira, como sempre', async () => {
    await setCarteira(sql, desligado, OUTRA, [C_IDE]);
    expect(await carteiraDela()).toEqual([C_IDE]);
  });

  it('o cartão de Pessoas conta como a janela: sem a unidade e o cliente omitidos; desligada, tudo', async () => {
    await db.exec(`insert into ideworks.profiles values
      ('${OUTRA}', 'outra@example.invalid', 'Outra', 'funcionario', false, true, false, '{}')`);
    try {
      const dela = async (ator: AuthenticatedActor) =>
        (await readPessoas(sql, ator)).pessoas.find((p) => p.id === OUTRA);
      expect(await dela(ligado)).toMatchObject({ empresas: 1, clientes: 1 });
      expect(await dela(desligado)).toMatchObject({ empresas: 2, clientes: 2 });
      // Quem não tem nada omitido não é descontado.
      expect((await readPessoas(sql, ligado)).pessoas.find((p) => p.id === EU)).toMatchObject({ empresas: 1 });
    } finally {
      await db.exec(`delete from ideworks.profiles where id = '${OUTRA}'`);
    }
  });

  it('salvar unidades e carteira não abre transação a mais: tudo na do salvamento', async () => {
    let transacoes = 0;
    const sqlContado = {
      begin: (t: (x: Tx) => Promise<unknown>) => {
        transacoes += 1;
        return t(tx);
      },
    } as unknown as Sql;
    await setEmpresas(sqlContado, ligado, OUTRA, [IDE]);
    await setCarteira(sqlContado, ligado, OUTRA, [C_IDE]);
    expect(transacoes).toBe(2);
  });

  it('Catálogos: o super admin vê a omitida com o selo; o administrador não a vê; desligada, ninguém tem selo', async () => {
    const doSuper = (await readCatalogos(sql, ligado)).categories;
    expect(doSuper.map((c) => c.name)).toContain('Alma9');
    expect(doSuper.find((c) => c.name === 'Alma9')).toMatchObject({ omitida: true });
    expect(doSuper.filter((c) => c.omitida).map((c) => c.name)).toEqual(['Alma9']);

    const doAdmin = (await readCatalogos(sql, adminLigado)).categories;
    expect(doAdmin.map((c) => c.name)).not.toContain('Alma9');
    expect(doAdmin.some((c) => 'omitida' in c)).toBe(false);

    const desligada = (await readCatalogos(sql, { ...admin })).categories;
    expect(desligada.map((c) => c.name)).toContain('Alma9');
    expect(desligada.some((c) => 'omitida' in c)).toBe(false);
  });
});
