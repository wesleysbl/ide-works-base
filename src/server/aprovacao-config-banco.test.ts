/**
 * A CONFIGURAÇÃO DA APROVAÇÃO, CONTRA UM POSTGRES DE VERDADE — F42, Fase 3.
 *
 * As MESMAS funções de `server/aprovacao-config.ts` que as rotas chamam, com o
 * `tx` trocado por um adaptador fino sobre o PGlite (nenhuma rede), sobre o
 * mínimo de esquema que elas tocam e as migrations 1 e 2 da Fase 1 aplicadas de
 * verdade. Cada transação roda sob o papel `ideworks_app` — o do Worker —, com
 * as variáveis que `withActor` declara: as políticas de linha e os privilégios
 * por coluna VALEM aqui (dono de tabela não é quem consulta).
 *
 * O QUE PROVA
 *   · o SQL das funções roda no Postgres (trava `for update`, `revoked_by`
 *     pelo privilégio de coluna, `on conflict` dos destinos, `approval_targets_for`);
 *   · gerar de novo revoga o anterior NA MESMA transação: um vivo só, e o hash
 *     antigo deixa de resolver; desligar derruba o link e religar o devolve;
 *   · quem não alcança o cliente recebe 404, e quem não administra 403;
 *   · destino de outra esteira volta com a frase do gatilho (IW042) e nada grava;
 *   · etapa usada como destino apagada: a leitura diz incompleta.
 *
 * O QUE NÃO PROVA: as funções de alcance reais (dublês aqui, como no
 * `aprovacao-do-cliente-banco.test.ts`).
 */

import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AprovacaoRecusada,
  gerarLinkDoCliente,
  gravarDestinosDaLista,
  lerAprovacaoDoCliente,
  lerCifraDoLink,
  lerDestinosDaLista,
  ligarAprovacao,
  resolverLinkPublico,
  revogarLinkDoCliente,
} from '@/server/aprovacao-config';
import type { Sql, Tx } from '@/server/db';
import { gerarToken, hashDoToken } from '@/server/link-de-aprovacao';
import type { AuthenticatedActor } from '@/server/session';

const MIGRATIONS = [
  'supabase/migrations/20261007150000_ideworks_f42_1_cliente_e_link.sql',
  'supabase/migrations/20261007150100_ideworks_f42_2_destinos_da_esteira.sql',
];
const ESTEIRAS = 'supabase/migrations/20260824170000_ideworks_f17_2_esteiras.sql';

/* ─────────────────── o adaptador (o mesmo de controle-da-semana) ─────────────────── */

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

const db = new PGlite();

const tx = ((strings: TemplateStringsArray, ...args: unknown[]) => {
  const f: Fragmento & PromiseLike<unknown[]> = {
    dublê: true,
    strings,
    args,
    then(ok, falha) {
      const params: unknown[] = [];
      const texto = montar(f, params);
      return db.query(texto, params).then((r) => r.rows).then(ok, falha);
    },
  };
  return f;
}) as unknown as Tx;

/** `withActor` abre a transação e declara quem age; aqui ela grava de verdade (commit). */
const sql = {
  begin: async (trabalho: (t: Tx) => Promise<unknown>) => {
    await db.exec('begin; set local role ideworks_app;');
    try {
      const r = await trabalho(tx);
      await db.exec('commit;');
      return r;
    } catch (e) {
      await db.exec('rollback;');
      throw e;
    }
  },
} as unknown as Sql;

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const ADMIN = id(1); // administra e alcança C1
const EQUIPE = id(2); // alcança C1, não administra
const C1 = id(10);
const C2 = id(11); // ninguém daqui alcança
const ESPACO = id(20);
const L1 = id(30);
const L2 = id(31);
const SET1 = id(40);
const SET2 = id(41);
const A_FAZER = id(50);
const AGUARDANDO = id(51);
const APROVADO = id(52);
const REFACAO = id(53);
const DE_OUTRA = id(55);

const ator = (userId: string, admin: boolean): AuthenticatedActor => ({
  userId,
  email: 'x@example.invalid',
  papel: admin ? 'admin' : 'funcionario',
  isSuperadmin: admin,
  isSuper: false,
  areas: [],
  hasAllClientsAccess: false,
});
const admin = ator(ADMIN, true);
const equipe = ator(EQUIPE, false);

/** O que o Worker faz antes de gravar: token, hash e um "cifrado" (a cifra real está nos testes do módulo). */
const preparo = (guardar: string[]) => async () => {
  const token = gerarToken();
  guardar.push(token);
  return { token, hash: await hashDoToken(token), cifrado: `v1.teste.${token.slice(0, 8)}` };
};

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role ideworks_app;
    create schema auth;
    create table auth.users(id uuid primary key);
    create schema ideworks;
    grant usage on schema ideworks to ideworks_app;
    grant usage on schema auth to ideworks_app;

    create type ideworks.status_type as enum ('open', 'unstarted', 'custom', 'done', 'closed');

    create function ideworks.acting_user_id() returns uuid language sql stable as
      $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
    create function ideworks.acting_is_superadmin() returns boolean language sql stable as
      $$ select coalesce(current_setting('app.is_superadmin', true), 'false') = 'true' $$;

    create table ideworks.clients(id uuid primary key, name text not null,
      is_active boolean not null default true);
    create table ideworks.user_clients(user_id uuid, client_id uuid);
    create table ideworks.lists(id uuid primary key, space_id uuid, folder_id uuid, name text);
    create table ideworks.status_sets(id uuid primary key default gen_random_uuid(),
      space_id uuid, folder_id uuid, list_id uuid, name text not null);
    create table ideworks.statuses(id uuid primary key default gen_random_uuid(),
      status_set_id uuid not null references ideworks.status_sets on delete cascade,
      name text not null, type ideworks.status_type not null, color text,
      sort_order int not null default 0);

    -- O alcance: dublê por tabela. A esteira se vê e se escreve por quem tem pessoa.
    create function ideworks.can_see_client(target uuid) returns boolean
      language sql stable security definer set search_path = ideworks, pg_temp as
      $$ select exists (select 1 from ideworks.user_clients uc
           where uc.client_id = target and uc.user_id = ideworks.acting_user_id()) $$;
    create function ideworks.can_see_status_set(target uuid) returns boolean
      language sql stable as $$ select ideworks.acting_user_id() is not null $$;
    create function ideworks.can_write_status_set(target uuid) returns boolean
      language sql stable as $$ select ideworks.acting_user_id() is not null $$;

    -- As políticas de \`clients\` como estão no ar (F17.32b).
    alter table ideworks.clients enable row level security;
    create policy clients_select on ideworks.clients for select using (ideworks.can_see_client(id));
    create policy clients_update on ideworks.clients for update
      using (ideworks.acting_is_superadmin()) with check (ideworks.acting_is_superadmin());
    grant select, update on ideworks.clients to ideworks_app;
    grant select on ideworks.lists, ideworks.status_sets, ideworks.statuses, ideworks.user_clients to ideworks_app;

    insert into auth.users values ('${ADMIN}'), ('${EQUIPE}');
    insert into ideworks.clients(id, name) values ('${C1}', 'Cliente Um'), ('${C2}', 'Cliente Dois');
    insert into ideworks.user_clients values ('${ADMIN}', '${C1}'), ('${EQUIPE}', '${C1}');
    insert into ideworks.lists(id, space_id, name) values ('${L1}', '${ESPACO}', 'Lista Um'), ('${L2}', '${ESPACO}', 'Outra');
    insert into ideworks.status_sets(id, space_id, name) values ('${SET1}', '${ESPACO}', 'Produção');
    insert into ideworks.status_sets(id, list_id, name) values ('${SET2}', '${L2}', 'Outra');
    insert into ideworks.statuses(id, status_set_id, name, type, sort_order) values
      ('${A_FAZER}', '${SET1}', 'a fazer', 'open', 0),
      ('${AGUARDANDO}', '${SET1}', 'aguardando cliente', 'custom', 1),
      ('${APROVADO}', '${SET1}', 'aprovado', 'custom', 2),
      ('${REFACAO}', '${SET1}', 'refação', 'custom', 3),
      ('${DE_OUTRA}', '${SET2}', 'na fila', 'open', 0);
  `);

  const esteiras = readFileSync(ESTEIRAS, 'utf8');
  const de = esteiras.indexOf('create or replace function ideworks.resolve_status_set(');
  await db.exec(esteiras.slice(de, esteiras.indexOf('$fn$;', de) + 5));

  for (const m of MIGRATIONS) await db.exec(readFileSync(m, 'utf8'));
  await db.exec('grant execute on all functions in schema ideworks to ideworks_app;');
});

afterAll(() => db.close());

describe('o cliente e o link', () => {
  it('liga, gera, regenera: um vivo só, e o hash antigo deixa de resolver', async () => {
    expect(await lerAprovacaoDoCliente(sql, admin, C1)).toEqual({ clientId: C1, enabled: false, active: true, link: null });

    const ligado = await ligarAprovacao(sql, admin, C1, true);
    expect(ligado.enabled).toBe(true);

    const tokens: string[] = [];
    const g1 = await gerarLinkDoCliente(sql, admin, C1, preparo(tokens));
    expect(g1.revoked).toBe(0);
    expect(await resolverLinkPublico(sql, await hashDoToken(tokens[0]))).toBe(C1);
    expect((await lerAprovacaoDoCliente(sql, admin, C1)).link).not.toBeNull();
    expect((await lerCifraDoLink(sql, admin, C1)).cifrado).toBe(`v1.teste.${tokens[0].slice(0, 8)}`);

    const g2 = await gerarLinkDoCliente(sql, admin, C1, preparo(tokens));
    expect(g2.revoked).toBe(1);
    expect(await resolverLinkPublico(sql, await hashDoToken(tokens[0]))).toBeNull();
    expect(await resolverLinkPublico(sql, await hashDoToken(tokens[1]))).toBe(C1);

    const linhas = await db.query<{ vivos: number; revogados: number; por: string }>(
      `select count(*) filter (where revoked_at is null)::int as vivos,
              count(*) filter (where revoked_at is not null)::int as revogados,
              max(revoked_by::text) as por
         from ideworks.client_approval_links where client_id = $1`,
      [C1],
    );
    expect(linhas.rows[0]).toEqual({ vivos: 1, revogados: 1, por: ADMIN });
  });

  it('desligar derruba o link sem revogá-lo; religar o devolve; revogar derruba de vez', async () => {
    const tokens: string[] = [];
    await gerarLinkDoCliente(sql, admin, C1, preparo(tokens));
    const hash = await hashDoToken(tokens[0]);
    await ligarAprovacao(sql, admin, C1, false);
    expect(await resolverLinkPublico(sql, hash)).toBeNull();
    await ligarAprovacao(sql, admin, C1, true);
    expect(await resolverLinkPublico(sql, hash)).toBe(C1);

    expect(await revogarLinkDoCliente(sql, admin, C1)).toEqual({ revoked: 1 });
    expect(await resolverLinkPublico(sql, hash)).toBeNull();
    await expect(lerCifraDoLink(sql, admin, C1)).rejects.toMatchObject({ status: 404 });
  });

  it('cliente fora do alcance: 404 em ler, ligar e gerar — e nada grava', async () => {
    await expect(lerAprovacaoDoCliente(sql, admin, C2)).rejects.toMatchObject({ status: 404 });
    await expect(ligarAprovacao(sql, admin, C2, true)).rejects.toMatchObject({ status: 404 });
    await expect(gerarLinkDoCliente(sql, admin, C2, preparo([]))).rejects.toMatchObject({ status: 404 });
    const r = await db.query<{ n: number }>('select count(*)::int as n from ideworks.client_approval_links where client_id = $1', [C2]);
    expect(r.rows[0].n).toBe(0);
  });

  it('quem não administra: 403 antes do banco', async () => {
    for (const fn of [
      () => lerAprovacaoDoCliente(sql, equipe, C1),
      () => ligarAprovacao(sql, equipe, C1, false),
      () => gerarLinkDoCliente(sql, equipe, C1, preparo([])),
      () => revogarLinkDoCliente(sql, equipe, C1),
      () => lerCifraDoLink(sql, equipe, C1),
      () => lerDestinosDaLista(sql, equipe, L1),
      () => gravarDestinosDaLista(sql, equipe, L1, { awaitingStatusId: AGUARDANDO, approvedStatusId: null, rejectedStatusId: null }),
    ]) {
      await expect(fn()).rejects.toBeInstanceOf(AprovacaoRecusada);
      await expect(fn()).rejects.toMatchObject({ status: 403 });
    }
  });
});

describe('os destinos da esteira', () => {
  it('lê a esteira resolvida (do espaço) e começa vazia', async () => {
    const d = await lerDestinosDaLista(sql, admin, L1);
    expect(d.statusSetId).toBe(SET1);
    expect(d.inheritedFrom).toBe('space');
    expect(d.statuses.map((s) => s.name)).toEqual(['a fazer', 'aguardando cliente', 'aprovado', 'refação']);
    expect(d.complete).toBe(false);
  });

  it('grava os três e relê completa; regravar atualiza a mesma linha', async () => {
    const d = await gravarDestinosDaLista(sql, admin, L1, {
      awaitingStatusId: AGUARDANDO,
      approvedStatusId: APROVADO,
      rejectedStatusId: A_FAZER,
    });
    expect(d.complete).toBe(true);
    const d2 = await gravarDestinosDaLista(sql, admin, L1, {
      awaitingStatusId: AGUARDANDO,
      approvedStatusId: APROVADO,
      rejectedStatusId: REFACAO,
    });
    expect(d2.targets).toEqual({ awaitingStatusId: AGUARDANDO, approvedStatusId: APROVADO, rejectedStatusId: REFACAO });
    const r = await db.query<{ n: number; por: string }>(
      'select count(*)::int as n, max(updated_by::text) as por from ideworks.status_set_approval_targets',
    );
    expect(r.rows[0]).toEqual({ n: 1, por: ADMIN });
  });

  it('etapa de outra esteira: recusa com a frase do gatilho, e o que estava fica', async () => {
    await expect(
      gravarDestinosDaLista(sql, admin, L1, { awaitingStatusId: AGUARDANDO, approvedStatusId: DE_OUTRA, rejectedStatusId: REFACAO }),
    ).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/etapa desta mesma esteira/) });
    expect((await lerDestinosDaLista(sql, admin, L1)).targets.approvedStatusId).toBe(APROVADO);
  });

  it('etapa usada como destino apagada: a leitura diz incompleta', async () => {
    await db.exec(`delete from ideworks.statuses where id = '${REFACAO}'`);
    const d = await lerDestinosDaLista(sql, admin, L1);
    expect(d.complete).toBe(false);
    expect(d.targets.rejectedStatusId).toBeNull();
  });

  it('lista que não existe: 404', async () => {
    await expect(lerDestinosDaLista(sql, admin, id(999))).rejects.toMatchObject({ status: 404 });
  });
});
