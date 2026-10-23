/**
 * PLANEJAMENTO POR SEMANA, CONTRA UM POSTGRES DE VERDADE — F35, Fase 2.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   A MESMA leitura de `server/planning-weeks.ts`, com o `tx` trocado por um
 *   adaptador fino sobre o PGlite (Postgres em WebAssembly, no processo —
 *   nenhuma rede), rodando sob um papel sem privilégio (`set local role`):
 *     · a forma da linha (plano, cota, responsáveis, peças);
 *     · cliente inativo fora; cliente de empresa omitida fora;
 *     · contrato do mês tem prioridade sobre o cadastro — inclusive o contrato
 *       ABERTO e vazio (F17.57), que não cai no cadastro;
 *     · só peças do mês de REFERÊNCIA (não as de outro mês agendadas dentro);
 *     · quem não administra só enxerga a PRÓPRIA linha da carteira.
 *
 * O QUE ELE NÃO PROVA
 *   As políticas REAIS do banco. A de `user_clients` daqui é um modelo mínimo
 *   do `can_see_person` da F17.34 (si mesma, ou quem administra).
 */

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Sql, Tx } from '@/server/db';
import { criarAdaptadorPglite } from '@/server/pglite-adaptador';
import { readPlanningWeeks } from '@/server/planning-weeks';
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

const IDE = id(1);
const ALMA = id(2);
const PLANO = id(5);
const C_CONTRATO = id(10); // mês aberto com itens + cadastro diferente → vale o contrato
const C_CADASTRO = id(11); // mês não aberto, cadastro com cota → vale o cadastro
const C_VAZIO = id(12); // mês aberto SEM item, cadastro com cota → contrato, cota zero
const C_NADA = id(13); // nem mês, nem cadastro → nenhuma
const C_INATIVO = id(14);
const C_ALMA = id(15);
const C_PASTA = id(16);
const ADMIN = id(90);
const HELENA = id(91);
const CARLA = id(92);
const TIME_CAROL = id(95);

const ator = (userId: string, admin: boolean, omitidas: string[] = []): AuthenticatedActor => ({
  userId,
  email: 'pessoa@example.invalid',
  papel: admin ? 'admin' : 'funcionario',
  isSuperadmin: admin,
  isSuper: false,
  areas: [],
  hasAllClientsAccess: admin,
  categoriasOmitidas: omitidas,
});

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema ideworks;
    create table ideworks.client_categories(id uuid primary key, name text);
    create table ideworks.plans(id uuid primary key, name text, color_bg text, color_text text, color_border text);
    create table ideworks.clients(id uuid primary key, name text, category_id uuid, plan_id uuid, is_active boolean);
    create table ideworks.month_contracts(id uuid primary key, client_id uuid, reference_month date);
    create table ideworks.month_contract_items(contract_id uuid, content_type text, quantity int);
    create table ideworks.client_quotas(client_id uuid, content_type text, quantity int);
    create table ideworks.user_clients(user_id uuid, client_id uuid);
    create table ideworks.folders(id uuid primary key, name text, archived_at timestamptz);
    create table ideworks.lists(id uuid primary key, client_id uuid, folder_id uuid, archived_at timestamptz);
    create table ideworks.content_items(id uuid primary key, client_id uuid, content_type text,
      reference_month date, scheduled_at timestamptz, completed_at timestamptz, is_extra boolean,
      title text, created_at timestamptz default now());
    create function ideworks.display_name(u uuid) returns text language sql as $$
      select case u when '${HELENA}'::uuid then 'Helena' when '${CARLA}'::uuid then 'Carla' else 'Outra' end $$;

    -- Modelo mínimo de 'user_clients_select' (F17.34): a própria linha, ou quem administra.
    alter table ideworks.user_clients enable row level security;
    create policy uc_select on ideworks.user_clients for select using (
      current_setting('app.is_superadmin', true) = 'true'
      or user_id::text = current_setting('app.user_id', true));

    create role leitor;
    grant usage on schema ideworks to leitor;
    grant select on all tables in schema ideworks to leitor;
    grant execute on all functions in schema ideworks to leitor;

    insert into ideworks.client_categories values ('${IDE}', 'Ide'), ('${ALMA}', 'Alma9');
    insert into ideworks.plans values ('${PLANO}', 'Full', '#000', '#fff', '#111');
    insert into ideworks.clients values
      ('${C_CONTRATO}', 'Bluesky', '${IDE}', '${PLANO}', true),
      ('${C_CADASTRO}', 'Cadastro SA', '${IDE}', null, true),
      ('${C_VAZIO}', 'Congelou Vazio', '${IDE}', null, true),
      ('${C_NADA}', 'Nada Ltda', '${IDE}', null, true),
      ('${C_INATIVO}', 'Saiu', '${IDE}', null, false),
      ('${C_ALMA}', 'Da Alma', '${ALMA}', null, true),
      ('${C_PASTA}', 'Time Carla SA', '${IDE}', null, true);

    insert into ideworks.month_contracts values
      ('${id(30)}', '${C_CONTRATO}', '2026-10-01'),
      ('${id(31)}', '${C_VAZIO}', '2026-10-01'),
      ('${id(32)}', '${C_CADASTRO}', '2026-09-01'); -- setembro aberto não abre outubro
    insert into ideworks.month_contract_items values
      ('${id(30)}', 'video', 4), ('${id(30)}', 'arte', 8), ('${id(30)}', 'foto', 0),
      ('${id(32)}', 'video', 99);
    insert into ideworks.client_quotas values
      ('${C_CONTRATO}', 'video', 2), ('${C_CONTRATO}', 'arte', 2),
      ('${C_CADASTRO}', 'arte', 6), ('${C_CADASTRO}', 'ads', 0),
      ('${C_VAZIO}', 'video', 3),
      ('${C_INATIVO}', 'video', 1), ('${C_ALMA}', 'video', 1);

    insert into ideworks.user_clients values
      ('${HELENA}', '${C_CONTRATO}'), ('${CARLA}', '${C_CONTRATO}'), ('${CARLA}', '${C_CADASTRO}');

    insert into ideworks.folders values
      ('${TIME_CAROL}', 'TIME CARLA', null);
    insert into ideworks.lists values
      ('${id(80)}', '${C_PASTA}', '${TIME_CAROL}', null);

    insert into ideworks.content_items (id, client_id, content_type, reference_month, scheduled_at, completed_at, is_extra, title) values
      ('${id(50)}', '${C_CONTRATO}', 'video', '2026-10-01', '2026-10-06T12:00:00Z', '2026-10-06T15:00:00Z', false, 'Reels 1'),
      ('${id(51)}', '${C_CONTRATO}', 'arte', '2026-10-01', null, null, true, null),
      ('${id(52)}', '${C_CONTRATO}', 'arte', '2026-09-01', '2026-10-02T12:00:00Z', null, false, 'De setembro'),
      ('${id(53)}', '${C_INATIVO}', 'video', '2026-10-01', '2026-10-07T12:00:00Z', null, false, 'Inativo'),
      ('${id(54)}', '${C_ALMA}', 'video', '2026-10-01', '2026-10-07T12:00:00Z', null, false, 'Alma');
  `);
});

afterAll(async () => {
  await db?.close();
});

describe('F35 — readPlanningWeeks', () => {
  it('devolve só clientes ativos, fora as empresas omitidas, em ordem de nome', async () => {
    const linhas = await readPlanningWeeks(sql, ator(ADMIN, true, [ALMA]), '2026-10-15');
    expect(linhas.map((l) => l.name)).toEqual(['Bluesky', 'Cadastro SA', 'Congelou Vazio', 'Nada Ltda', 'Time Carla SA']);
  });

  it('sem omitida, a empresa volta — o recorte é o da F31, não um filtro fixo', async () => {
    const linhas = await readPlanningWeeks(sql, ator(ADMIN, true), '2026-10-01');
    expect(linhas.map((l) => l.name)).toContain('Da Alma');
    expect(linhas.map((l) => l.name)).not.toContain('Saiu');
  });

  it('forma da linha: plano, cota do contrato, responsáveis e peças só do mês de referência', async () => {
    const [blue] = await readPlanningWeeks(sql, ator(ADMIN, true, [ALMA]), '2026-10-01');
    expect(blue).toEqual({
      id: C_CONTRATO,
      name: 'Bluesky',
      categoryId: IDE,
      categoryName: 'Ide',
      plan: { id: PLANO, name: 'Full', colorBg: '#000', colorText: '#fff', colorBorder: '#111' },
      owners: [
        { id: CARLA, name: 'Carla' },
        { id: HELENA, name: 'Helena' },
      ],
      quotaSource: 'contrato',
      // O contrato (4 vídeos, 8 artes) vence o cadastro (2 e 2); foto 0 não entra.
      quota: { video: 4, arte: 8 },
      hasContentContract: true,
      items: [
        {
          id: id(50),
          contentType: 'video',
          scheduledAt: '2026-10-06T12:00:00.000Z',
          completedAt: '2026-10-06T15:00:00.000Z',
          isExtra: false,
          title: 'Reels 1',
        },
        { id: id(51), contentType: 'arte', scheduledAt: null, completedAt: null, isExtra: true, title: null },
      ],
    });
  });

  it('mês não aberto usa o cadastro; aberto e vazio é contrato com cota zero; sem nada é nenhuma', async () => {
    const linhas = await readPlanningWeeks(sql, ator(ADMIN, true, [ALMA]), '2026-10-01');
    const por = Object.fromEntries(linhas.map((l) => [l.name, l]));

    expect(por['Cadastro SA']).toMatchObject({ quotaSource: 'cadastro', quota: { arte: 6 }, hasContentContract: true });
    expect(por['Congelou Vazio']).toMatchObject({ quotaSource: 'contrato', quota: {}, hasContentContract: true });
    expect(por['Nada Ltda']).toMatchObject({
      quotaSource: 'nenhuma',
      quota: {},
      hasContentContract: false,
      owners: [],
      items: [],
    });
  });

  it('quem não administra só enxerga a própria linha da carteira', async () => {
    const linhas = await readPlanningWeeks(sql, ator(HELENA, false, [ALMA]), '2026-10-01');
    const blue = linhas.find((l) => l.id === C_CONTRATO);
    expect(blue?.owners).toEqual([{ id: HELENA, name: 'Helena' }]);
    expect(linhas.find((l) => l.id === C_CADASTRO)?.owners).toEqual([]);
  });

  it('agrupa por pasta/time quando o cliente tem lista em pasta ativa', async () => {
    const linhas = await readPlanningWeeks(sql, ator(ADMIN, true, [ALMA]), '2026-10-01');
    const pasta = linhas.find((l) => l.id === C_PASTA);
    expect(pasta?.owners).toEqual([{ id: TIME_CAROL, name: 'TIME CARLA' }]);
  });

  it('mês inválido recusa com a frase de "inválido" que a rota transforma em 400', async () => {
    await expect(readPlanningWeeks(sql, ator(ADMIN, true), 'lixo')).rejects.toThrow(/inválido/);
  });
});

/**
 * PERF DO SERVIDOR, 08/10/2026 — as cinco leituras que dependem dos clientes saem
 * juntas, com os ids e o mês no TEXTO da consulta. A resposta tem de ser a mesma
 * do caminho por parâmetro, INCLUSIVE o recorte de linha: a declaração do ator
 * agora também vai no texto, e é ela que alimenta a política de `user_clients`.
 */
describe('F35 — readPlanningWeeks com os ids no texto da consulta', () => {
  const rodar = (textoDireto: boolean, a: AuthenticatedActor, mes: string) => {
    const adaptador = criarAdaptadorPglite(db, { papel: 'leitor', textoDireto });
    return { adaptador, resultado: readPlanningWeeks(adaptador.sql, a, mes) };
  };

  for (const [nome, a] of [
    ['administrador, Alma9 omitida', ator(ADMIN, true, [ALMA])],
    ['administrador, nada omitido', ator(ADMIN, true)],
    ['Helena (só a própria linha da carteira)', ator(HELENA, false, [ALMA])],
    ['Carla (outra carteira)', ator(CARLA, false)],
  ] as const) {
    for (const mes of ['2026-10-15', '2026-09-01']) {
      it(`${nome}, ${mes}: a mesma resposta por parâmetro e por texto direto`, async () => {
        const porParametro = rodar(false, a, mes);
        const esperado = await porParametro.resultado;
        const porTexto = rodar(true, a, mes);
        const obtido = await porTexto.resultado;
        expect(obtido).toEqual(esperado);

        // Seis consultas, nenhuma com parâmetro; a política enxergou o ator declarado no texto.
        const doBanco = porTexto.adaptador.consultas.filter((c) => c.includes('ideworks.') && !c.includes('set_config'));
        expect(doBanco).toHaveLength(6);
        expect(doBanco.some((c) => /\$\d/.test(c))).toBe(false);
        expect(porParametro.adaptador.consultas.some((c) => /\$\d/.test(c))).toBe(true);
        expect(porTexto.adaptador.transacoes()).toBe(1);
      });
    }
  }

  it('quem não administra continua vendo só a própria linha (a política lê a declaração do texto)', async () => {
    const linhas = await rodar(true, ator(HELENA, false, [ALMA]), '2026-10-01').resultado;
    expect(linhas.find((l) => l.id === C_CONTRATO)?.owners).toEqual([{ id: HELENA, name: 'Helena' }]);
  });

  it('mês inválido: a mesma recusa, sem tocar no banco', async () => {
    const { adaptador, resultado } = rodar(true, ator(ADMIN, true), 'lixo');
    await expect(resultado).rejects.toThrow(/inválido/);
    expect(adaptador.transacoes()).toBe(0);
  });
});
