/**
 * O TERRENO DOS TESTES DE QUADRO SOBRE O PGLITE — perf do servidor, 08/10/2026.
 *
 * Um esquema mínimo (as tabelas e visões que `readBoard` e `readFolderBoard`
 * leem) com doze tarefas numa lista e uma pasta com duas listas. Compartilhado
 * por `quadro-idas.test.ts` e `quadro-pasta-idas.test.ts`, que rodam a MESMA
 * leitura com o id no texto e com parâmetro e comparam.
 */
import type { PGlite } from '@electric-sql/pglite';

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const EU = id(99);
export const OUTRA = id(98);
export const LISTA = id(40);
export const LISTA_VAZIA = id(41);
export const ESPACO = id(20);
export const S_ABRE = id(60);
export const S_FAZ = id(61);
export const S_FIM = id(62);
/** A pasta com duas listas, `LISTA_A` e `LISTA_B`. */
export const PASTA = id(30);
export const PASTA_VAZIA = id(31);
export const LISTA_A = id(42);
export const LISTA_B = id(43);

export async function montarBancoDeQuadros(db: PGlite): Promise<void> {
  await db.exec(`
    create schema ideworks;
    create table ideworks.client_categories (id uuid primary key, name text);
    create table ideworks.spaces (id uuid primary key, category_id uuid, name text, color text,
      sort_order int default 0, archived_at timestamptz);
    create table ideworks.folders (id uuid primary key, space_id uuid, name text, sort_order int default 0, archived_at timestamptz);
    create table ideworks.clients (id uuid primary key, name text);
    create table ideworks.lists (id uuid primary key, space_id uuid, folder_id uuid, name text, content text,
      sort_order int default 0, archived_at timestamptz, client_id uuid, requires_client boolean not null default false);
    create table ideworks.statuses (id uuid primary key, name text, type text, color text, sort_order int);
    create table ideworks.tasks (id uuid primary key, list_id uuid, client_id uuid, title text, description text,
      status_id uuid, priority text, due_on date, start_on date, completed_at timestamptz,
      archived_at timestamptz, parent_id uuid, demand_type text);
    create table ideworks.task_assignees (task_id uuid, user_id uuid);
    create table ideworks.task_attachments (id uuid primary key default gen_random_uuid(), task_id uuid,
      content_type text, expires_at timestamptz, created_at timestamptz default now());
    create table ideworks.task_tags (id uuid primary key, space_id uuid, name text, bg_color text, fg_color text);
    create view ideworks.tree as
      select l.id as list_id, l.name as list_name, l.content as list_content, l.sort_order as list_sort_order,
             f.id as folder_id, f.name as folder_name, f.sort_order as folder_sort_order,
             s.id as space_id, s.name as space_name, s.color as space_color, s.sort_order as space_sort_order,
             s.category_id, true as is_live
        from ideworks.lists l join ideworks.spaces s on s.id = l.space_id
        left join ideworks.folders f on f.id = l.folder_id;
    create view ideworks.list_workflow as
      select l.id as list_id, 'Entrega'::text as status_set_name, 'space'::text as inherited_from,
             st.id as status_id, st.name as status_name, st.type as status_type,
             st.color as status_color, st.sort_order as status_sort_order
        from ideworks.lists l cross join ideworks.statuses st where l.id <> '${LISTA_VAZIA}';
    create view ideworks.task_labels as
      select id as task_id, null::text as task_type_name, '[]'::jsonb as tags from ideworks.tasks;
    create view ideworks.task_progress as
      select id as task_id, 0 as subtask_count, 0 as subtask_done, 0 as checklist_count,
             0 as checklist_done, 0 as checklist_total, 0 as attachment_count, 0 as link_count,
             0 as comment_count from ideworks.tasks;
    create function ideworks.display_name(u uuid) returns text language sql as $$ select 'Pessoa ' || left(u::text, 4) $$;
    create function ideworks.assignee_filter_people() returns table(id uuid, name text) language sql as
      $$ select '${EU}'::uuid, 'Eu'::text union all select '${OUTRA}'::uuid, 'Outra'::text $$;
    create function ideworks.list_is_production(l uuid) returns boolean language sql as $$ select l = '${LISTA}'::uuid $$;

    insert into ideworks.client_categories values ('${id(1)}', 'Ide');
    insert into ideworks.spaces values ('${ESPACO}', '${id(1)}', 'Entrega', '#123', 1, null);
    insert into ideworks.clients values ('${id(10)}', 'Jatobá');
    insert into ideworks.lists (id, space_id, name, client_id) values
      ('${LISTA}', '${ESPACO}', 'Atendimento', '${id(10)}'), ('${LISTA_VAZIA}', '${ESPACO}', 'Sem esteira', null);
    insert into ideworks.statuses values
      ('${S_ABRE}', 'A fazer', 'open', '#aaa', 1), ('${S_FAZ}', 'Fazendo', 'active', '#bbb', 2),
      ('${S_FIM}', 'Feito', 'closed', '#ccc', 3);
    insert into ideworks.task_tags values
      ('${id(80)}', '${ESPACO}', 'Urgente', '#f00', '#fff'), ('${id(81)}', '${ESPACO}', 'agência', '#0f0', '#000');
  `);
  // Doze tarefas distribuídas nas três colunas, com e sem responsável, com e sem prioridade.
  const linhas: string[] = [];
  const donos: string[] = [];
  for (let n = 1; n <= 12; n += 1) {
    const status = [S_ABRE, S_FAZ, S_FIM][n % 3];
    const prioridade = n % 4 === 0 ? 'null' : `'${['urgent', 'high', 'normal'][n % 3]}'`;
    const titulo = ['Peça do Sabor Doce', 'Vídeo da campanha', 'Legenda — ação', 'Relatório'][n % 4] + ` ${n}`;
    linhas.push(`('${id(100 + n)}', '${LISTA}', ${n % 2 === 0 ? `'${id(10)}'` : 'null'}, '${titulo}', ${n % 5 === 0 ? "'briefing'" : 'null'}, '${status}', ${prioridade}, ${n % 3 === 0 ? `'2026-10-${10 + n}'` : 'null'})`);
    if (n % 3 !== 0) donos.push(`('${id(100 + n)}', '${n % 2 === 0 ? EU : OUTRA}')`);
  }
  await db.exec(`
    insert into ideworks.tasks (id, list_id, client_id, title, description, status_id, priority, due_on) values ${linhas.join(',')};
    insert into ideworks.task_assignees values ${donos.join(',')};
  `);

  // A pasta: duas listas, seis tarefas, com e sem responsável.
  await db.exec(`
    insert into ideworks.folders values ('${PASTA}', '${ESPACO}', 'TIME CARLA', 1, null), ('${PASTA_VAZIA}', '${ESPACO}', 'Pasta vazia', 2, null);
    insert into ideworks.lists (id, space_id, folder_id, name, client_id) values
      ('${LISTA_A}', '${ESPACO}', '${PASTA}', 'Lista A', '${id(10)}'),
      ('${LISTA_B}', '${ESPACO}', '${PASTA}', 'Lista B', null);
    insert into ideworks.tasks (id, list_id, client_id, title, status_id, priority, due_on) values
      ('${id(201)}', '${LISTA_A}', null, 'Arte do feed', '${S_ABRE}', 'high', null),
      ('${id(202)}', '${LISTA_A}', '${id(10)}', 'Vídeo institucional', '${S_FAZ}', null, '2026-10-30'),
      ('${id(203)}', '${LISTA_A}', null, 'Legenda — ação', '${S_FIM}', 'normal', null),
      ('${id(204)}', '${LISTA_B}', null, 'Relatório mensal', '${S_ABRE}', null, null),
      ('${id(205)}', '${LISTA_B}', null, 'Peça do Sabor Doce', '${S_FAZ}', 'urgent', '2026-10-12'),
      ('${id(206)}', '${LISTA_B}', null, 'Arte do stories', '${S_ABRE}', 'normal', null);
    insert into ideworks.task_assignees values ('${id(201)}', '${EU}'), ('${id(202)}', '${OUTRA}'), ('${id(205)}', '${EU}');
  `);
}
