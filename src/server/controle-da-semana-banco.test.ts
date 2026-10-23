/**
 * O PAINEL DE CONTROLE DA SEMANA, CONTRA UM POSTGRES DE VERDADE — F40, Fase 5.
 *
 * A MESMA leitura de `server/controle-da-semana.ts`, com o `tx` trocado por um
 * adaptador fino sobre o PGlite (nenhuma rede), sobre o mínimo de esquema que
 * ela toca, a `resolve_status_set` da F17.2 e a migration da Fase 1
 * (`list_is_production`, `demand_type`), aplicadas de verdade.
 *
 * O QUE PROVA
 *   · Faltando: meta 2 e 0 cards → falta 2; meta 2 e 3 cards → 0; card em
 *     "atribuir demanda" conta; sem tipo não conta; cliente cancelado fora;
 *     card de outra semana não conta; contrato vence o cadastro; card em lista
 *     compartilhada conta para o cliente da TAREFA (regra F38);
 *   · semana que cruza setembro e outubro (meta 5 = 3 + 2);
 *   · Andamento pelo TIPO da etapa (open/unstarted, custom, done/closed) e
 *     "atribuir demanda" separada;
 *   · Para atribuir: "Sem tipo" e "Sem data" (só na semana atual);
 *   · atrasados, com responsável; empresa omitida fora; funcionário recebe 403.
 *
 * O QUE NÃO PROVA: as políticas de linha reais (só em produção, pelo script
 * `scripts/provar-controle-da-semana.mjs`).
 */

import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BoardRefused } from '@/server/board';
import { type RecorteDaConexao, readControleDaSemana } from '@/server/controle-da-semana';
import type { Sql, Tx } from '@/server/db';
import { criarAdaptadorPglite } from '@/server/pglite-adaptador';
import type { AuthenticatedActor } from '@/server/session';

const MIGRATION = 'supabase/migrations/20261007130000_ideworks_f40_tipo_da_tarefa.sql';
const ESTEIRAS = 'supabase/migrations/20260824170000_ideworks_f17_2_esteiras.sql';

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

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const IDE = id(1);
const ALMA = id(2);
const ESPACO = id(3); // esteira de produção
const ESPACO_INTERNO = id(4); // esteira sem "atribuir demanda"
const C_ALFA = id(10); // contrato out: vídeo 8, arte 0; cadastro vídeo 99 (perde)
const C_BETA = id(11); // sem contrato; cadastro vídeo 8, arte 8
const C_CANCELADA = id(12);
const C_DELTA = id(13); // sem cota
const C_GAMA = id(14); // contrato set e out: vídeo 22
const C_ALMA = id(15);
const L_ALFA = id(20);
const L_BETA = id(21);
const L_CANCELADA = id(22);
const L_DELTA = id(23);
const L_GAMA = id(24);
const L_ALMA = id(25);
const L_INTERNA = id(26);
const L_COMPARTILHADA = id(27); // sem cliente, espaço interno
const S_ATRIBUIR = id(40);
const S_AFAZER = id(41);
const S_FAZENDO = id(42);
const S_FEITO = id(43);
const S_INTERNA_AFAZER = id(44);
const HELENA = id(91);
const ADMIN = id(90);
const CAPTADOR = id(92);

const ator = (admin: boolean, omitidas: string[] = []): AuthenticatedActor => ({
  userId: ADMIN,
  email: 'pessoa@example.invalid',
  papel: admin ? 'admin' : 'funcionario',
  isSuperadmin: admin,
  isSuper: false,
  areas: [],
  hasAllClientsAccess: admin,
  categoriasOmitidas: omitidas,
});

// Quarta-feira, 07/10/2026, meio-dia em São Paulo.
const HOJE = new Date('2026-10-07T15:00:00Z');

let seq = 100;
const card = (
  lista: string,
  titulo: string,
  tipo: string | null,
  prazo: string | null,
  etapa: string,
  extra: { cliente?: string; arquivado?: boolean; pai?: string } = {},
) => {
  const tid = id(++seq);
  return {
    tid,
    sql: `insert into ideworks.tasks(id, list_id, client_id, title, demand_type, due_on, status_id, archived_at, created_by, parent_id)
          values ('${tid}', '${lista}', ${extra.cliente ? `'${extra.cliente}'` : 'null'}, '${titulo}',
                  ${tipo ? `'${tipo}'` : 'null'}, ${prazo ? `'${prazo}'` : 'null'}, '${etapa}',
                  ${extra.arquivado ? 'now()' : 'null'}, '${CAPTADOR}', ${extra.pai ? `'${extra.pai}'` : 'null'});`,
  };
};

const c: Record<string, { tid: string; sql: string }> = {};
const novo = (chave: string, ...a: Parameters<typeof card>) => {
  c[chave] = card(...a);
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema ideworks;
    create type ideworks.status_type as enum ('open', 'unstarted', 'custom', 'done', 'closed');
    create table ideworks.client_categories(id uuid primary key, name text);
    create table ideworks.clients(id uuid primary key, name text, category_id uuid, is_active boolean);
    create table ideworks.spaces(id uuid primary key, category_id uuid);
    create table ideworks.folders(id uuid primary key, space_id uuid);
    create table ideworks.lists(id uuid primary key, space_id uuid, folder_id uuid, name text, client_id uuid);
    create table ideworks.status_sets(id uuid primary key default gen_random_uuid(),
      space_id uuid, folder_id uuid, list_id uuid, name text);
    create table ideworks.statuses(id uuid primary key default gen_random_uuid(),
      status_set_id uuid not null, name text not null, type ideworks.status_type);
    create table ideworks.tasks(id uuid primary key, list_id uuid, client_id uuid, parent_id uuid,
      title text not null, description text, status_id uuid, due_on date, archived_at timestamptz, created_by uuid);
    create table ideworks.task_assignees(task_id uuid, user_id uuid);
    create table ideworks.month_contracts(id uuid primary key, client_id uuid, reference_month date);
    create table ideworks.month_contract_items(contract_id uuid, content_type text, quantity int);
    create table ideworks.client_quotas(client_id uuid, content_type text, quantity int);
    create function ideworks.display_name(u uuid) returns text language sql as $$
      select case u when '${HELENA}'::uuid then 'Helena' when '${CAPTADOR}'::uuid then 'Captador' else 'Outra' end $$;

    create role leitor;
    grant usage on schema ideworks to leitor;
    grant select on all tables in schema ideworks to leitor;

    insert into ideworks.client_categories values ('${IDE}', 'Ide'), ('${ALMA}', 'Alma9');
    insert into ideworks.clients values
      ('${C_ALFA}', 'Alfa', '${IDE}', true), ('${C_BETA}', 'Beta', '${IDE}', true),
      ('${C_CANCELADA}', 'Cancelada', '${IDE}', false), ('${C_DELTA}', 'Delta', '${IDE}', true),
      ('${C_GAMA}', 'Gama', '${IDE}', true), ('${C_ALMA}', 'Da Alma', '${ALMA}', true);
    insert into ideworks.spaces values ('${ESPACO}', '${IDE}'), ('${ESPACO_INTERNO}', '${IDE}');
    insert into ideworks.lists values
      ('${L_ALFA}', '${ESPACO}', null, 'Alfa', '${C_ALFA}'), ('${L_BETA}', '${ESPACO}', null, 'Beta', '${C_BETA}'),
      ('${L_CANCELADA}', '${ESPACO}', null, 'Cancelada', '${C_CANCELADA}'),
      ('${L_DELTA}', '${ESPACO}', null, 'Delta', '${C_DELTA}'), ('${L_GAMA}', '${ESPACO}', null, 'Gama', '${C_GAMA}'),
      ('${L_ALMA}', '${ESPACO}', null, 'Alma', '${C_ALMA}'),
      ('${L_INTERNA}', '${ESPACO_INTERNO}', null, 'Interna', null),
      ('${L_COMPARTILHADA}', '${ESPACO_INTERNO}', null, 'Atendimento', null);

    insert into ideworks.status_sets(id, space_id, name) values
      ('${id(50)}', '${ESPACO}', 'Produção'), ('${id(51)}', '${ESPACO_INTERNO}', 'Interna');
    insert into ideworks.statuses(id, status_set_id, name, type) values
      ('${S_ATRIBUIR}', '${id(50)}', 'Atribuir Demanda', 'open'),
      ('${S_AFAZER}', '${id(50)}', 'a fazer video', 'unstarted'),
      ('${S_FAZENDO}', '${id(50)}', 'fazendo', 'custom'),
      ('${S_FEITO}', '${id(50)}', 'feito', 'done'),
      ('${S_INTERNA_AFAZER}', '${id(51)}', 'a fazer', 'open');

    insert into ideworks.month_contracts values
      ('${id(60)}', '${C_ALFA}', '2026-10-01'),
      ('${id(61)}', '${C_GAMA}', '2026-09-01'), ('${id(62)}', '${C_GAMA}', '2026-10-01');
    insert into ideworks.month_contract_items values
      ('${id(60)}', 'video', 8), ('${id(60)}', 'arte', 0),
      ('${id(61)}', 'video', 22), ('${id(62)}', 'video', 22);
    insert into ideworks.client_quotas values
      ('${C_ALFA}', 'video', 99), ('${C_BETA}', 'video', 8), ('${C_BETA}', 'arte', 8),
      ('${C_CANCELADA}', 'video', 8), ('${C_ALMA}', 'video', 8);
  `);

  const esteiras = readFileSync(ESTEIRAS, 'utf8');
  const de = esteiras.indexOf('create or replace function ideworks.resolve_status_set(');
  await db.exec(esteiras.slice(de, esteiras.indexOf('$fn$;', de) + 5));
  await db.exec(readFileSync(MIGRATION, 'utf8'));
  await db.exec('grant execute on all functions in schema ideworks to leitor;');

  // Alfa: vídeo parado em atribuir demanda (conta), e uma arte numa lista COMPARTILHADA.
  novo('alfaVideo', L_ALFA, 'Reels Alfa', 'video', '2026-10-06', S_ATRIBUIR);
  novo('alfaArteCompartilhada', L_COMPARTILHADA, 'Arte Alfa', 'arte', '2026-10-08', S_INTERNA_AFAZER, { cliente: C_ALFA });
  // Beta: três vídeos na semana (meta 2), um de outra semana, um arquivado, um sem tipo em atribuir demanda.
  novo('betaFazendo', L_BETA, 'Beta 1', 'video', '2026-10-05', S_FAZENDO);
  novo('betaFeito', L_BETA, 'Beta 2', 'video', '2026-10-08', S_FEITO);
  novo('betaAfazer', L_BETA, 'Beta 3', 'video', '2026-10-11', S_AFAZER); // domingo: é desta semana
  novo('betaOutraSemana', L_BETA, 'Beta 4', 'video', '2026-10-12', S_AFAZER);
  novo('betaArquivado', L_BETA, 'Beta 5', 'video', '2026-10-06', S_AFAZER, { arquivado: true });
  novo('betaSemTipo', L_BETA, 'Beta sem tipo', null, '2026-10-07', S_ATRIBUIR);
  // Cancelada: fora.
  novo('canceladaVideo', L_CANCELADA, 'Cancelada', 'video', '2026-10-06', S_AFAZER);
  // Delta: sem cota; foto em andamento; vídeo sem data em atribuir demanda.
  novo('deltaFoto', L_DELTA, 'Foto Delta', 'foto', '2026-10-06', S_FAZENDO);
  novo('deltaSemData', L_DELTA, 'Sem data Delta', 'video', null, S_ATRIBUIR);
  // Gama (virada de mês): um vídeo em 01/10 e um vencido de setembro com responsável.
  novo('gamaVideo', L_GAMA, 'Gama 1', 'video', '2026-10-01', S_AFAZER);
  novo('gamaVencido', L_GAMA, 'Gama vencido', 'video', '2026-09-30', S_AFAZER);
  novo('gamaVelhoFeito', L_GAMA, 'Gama feito', 'video', '2026-09-20', S_FEITO);
  novo('gamaVelhoSemTipo', L_GAMA, 'Gama velho sem tipo', null, '2026-09-01', S_AFAZER);
  // Lista interna: sem tipo, fora de tudo. Alma: omitida.
  novo('interna', L_INTERNA, 'Interna', null, '2026-10-06', S_INTERNA_AFAZER);
  novo('alma', L_ALMA, 'Alma', 'video', '2026-10-06', S_AFAZER);
  novo('subtarefa', L_ALFA, 'Sub', 'video', '2026-10-06', S_AFAZER, { pai: id(101) });

  for (const x of Object.values(c)) await db.exec(x.sql);
  await db.exec(`insert into ideworks.task_assignees values ('${c.gamaVencido.tid}', '${HELENA}');`);
});

afterAll(async () => {
  await db?.close();
});

const semana = (admin = true, omitidas: string[] = [ALMA], qual = '2026-10-05') =>
  readControleDaSemana(sql, ator(admin, omitidas), qual, HOJE);

describe('F40 — leitura da semana: acesso', () => {
  it('funcionário recebe 403, antes de qualquer consulta', async () => {
    await expect(semana(false)).rejects.toMatchObject({ name: 'BoardRefused', status: 403 });
    await expect(semana(false)).rejects.toBeInstanceOf(BoardRefused);
  });

  it('parâmetro que não é data é 400; um dia qualquer vira a segunda dele', async () => {
    await expect(semana(true, [ALMA], 'lixo')).rejects.toMatchObject({ status: 400 });
    await expect(semana(true, [ALMA], '2026-02-30')).rejects.toMatchObject({ status: 400 });
    expect((await semana(true, [ALMA], '2026-10-09')).week.start).toBe('2026-10-05');
  });

  it('sem parâmetro, a semana atual', async () => {
    const r = await readControleDaSemana(sql, ator(true), undefined, HOJE);
    expect(r.week).toEqual({
      start: '2026-10-05', end: '2026-10-11', today: '2026-10-07', isCurrent: true,
      previous: '2026-09-28', next: '2026-10-12',
    });
  });
});

describe('F40 — Faltando', () => {
  it('meta 2 e 0 cards dá falta 2; contrato vence o cadastro; atribuir demanda e lista compartilhada contam', async () => {
    const { items } = (await semana()).missing;
    const por = Object.fromEntries(items.map((i) => [`${i.clientName}|${i.type}`, i]));

    // Beta: arte 8 pelo cadastro → meta 2, nenhum card de arte → falta 2.
    expect(por['Beta|arte']).toMatchObject({ target: 2, cards: 0, missing: 2 });
    // Beta: vídeo meta 2, 3 cards na semana (o do domingo entra) → falta 0, e a conta não fica negativa.
    expect(por['Beta|video']).toMatchObject({ target: 2, cards: 3, missing: 0 });
    // Alfa: contrato 8 (e não o cadastro 99) → meta 2; 1 card parado em "atribuir demanda" conta → falta 1.
    expect(por['Alfa|video']).toMatchObject({ target: 2, cards: 1, missing: 1 });
    // Alfa: arte tem contrato com 0 → sem meta, sem linha; o card da lista compartilhada não cria falta.
    expect(por['Alfa|arte']).toBeUndefined();
  });

  it('cliente cancelado, empresa omitida, sem cota e sem tipo ficam fora; sem omitida a empresa volta', async () => {
    const { items } = (await semana()).missing;
    const nomes = items.map((i) => i.clientName);
    expect(nomes).not.toContain('Cancelada');
    expect(nomes).not.toContain('Da Alma');
    expect(nomes).not.toContain('Delta');
    const sem = (await semana(true, [])).missing.items.map((i) => i.clientName);
    expect(sem).toContain('Da Alma');
  });

  it('o card sem tipo não conta na falta', async () => {
    const beta = (await semana()).missing.items.find((i) => i.clientName === 'Beta' && i.type === 'video');
    expect(beta?.cards).toBe(3); // não 4: "Beta sem tipo" não entra
  });

  it('a semana que cruza setembro e outubro soma a parte de cada mês (3 + 2 = 5)', async () => {
    const r = await semana(true, [ALMA], '2026-09-28');
    expect(r.missing.items.find((i) => i.clientName === 'Gama')).toMatchObject({
      type: 'video', target: 5, cards: 2, missing: 3, // 01/10 e o vencido de 30/09
    });
  });

  it('os atrasados: prazo antes de hoje, etapa aberta, com tipo ou em atribuir demanda, com o responsável', async () => {
    const { overdue, overdueTotal } = (await semana()).missing;
    // Ordem: prazo mais antigo primeiro; empate pelo id.
    expect(overdue.map((o) => o.id)).toEqual([
      c.gamaVencido.tid, // 30/09
      c.gamaVideo.tid, // 01/10
      c.betaFazendo.tid, // 05/10
      c.alfaVideo.tid, // 06/10
      c.deltaFoto.tid, // 06/10
    ]);
    expect(overdueTotal).toBe(5);
    expect(overdue[0]).toMatchObject({
      title: 'Gama vencido', dueOn: '2026-09-30', clientName: 'Gama', type: 'video',
      assignees: [{ id: HELENA, name: 'Helena' }],
    });
    // Feito, sem tipo fora de "atribuir demanda" e prazo de hoje em diante não são atrasados.
    const ids = overdue.map((o) => o.id);
    expect(ids).not.toContain(c.gamaVelhoFeito.tid);
    expect(ids).not.toContain(c.gamaVelhoSemTipo.tid);
    expect(ids).not.toContain(c.betaSemTipo.tid);
    expect(ids).not.toContain(c.alma.tid); // empresa omitida
  });
});

describe('F40 — Andamento', () => {
  it('conta pelo TIPO da etapa, com "atribuir demanda" separada', async () => {
    const { progress } = await semana();
    const beta = progress.find((p) => p.clientName === 'Beta' && p.type === 'video');
    expect(beta).toMatchObject({ awaiting: 0, todo: 1, doing: 1, done: 1 });
    const semTipo = progress.find((p) => p.clientName === 'Beta' && p.type === null);
    expect(semTipo).toMatchObject({ awaiting: 1, todo: 0, doing: 0, done: 0 });
    expect(progress.find((p) => p.clientName === 'Alfa' && p.type === 'video')).toMatchObject({ awaiting: 1 });
    // Sem cota, o card aparece mesmo assim.
    expect(progress.find((p) => p.clientName === 'Delta' && p.type === 'foto')).toMatchObject({ doing: 1 });
  });

  it('card de outra semana, arquivado, subtarefa, lista interna e cliente cancelado não entram', async () => {
    const { progress } = await semana();
    expect(progress.some((p) => p.clientName === 'Cancelada')).toBe(false);
    const total = progress.filter((p) => p.clientName === 'Beta').reduce((s, p) => s + p.awaiting + p.todo + p.doing + p.done, 0);
    expect(total).toBe(4); // 3 vídeos + 1 sem tipo; sem o de 12/10 e sem o arquivado
    const alfa = progress.filter((p) => p.clientName === 'Alfa').reduce((s, p) => s + p.awaiting + p.todo + p.doing + p.done, 0);
    expect(alfa).toBe(2); // o vídeo e a arte da lista compartilhada; a subtarefa não
  });
});

describe('F40 — Para atribuir', () => {
  it('agrupa por cliente e tipo, com "Sem tipo", captador, prazo sugerido e lista', async () => {
    const { toAssign } = await semana();
    const semTipo = toAssign.find((g) => g.clientName === 'Beta');
    expect(semTipo).toMatchObject({ type: null });
    expect(semTipo?.cards).toEqual([
      {
        id: c.betaSemTipo.tid,
        title: 'Beta sem tipo',
        createdBy: { id: CAPTADOR, name: 'Captador' },
        suggestedDueOn: '2026-10-07',
        list: { id: L_BETA, name: 'Beta' },
      },
    ]);
    // Só cards em "atribuir demanda": o vídeo "a fazer" do Beta não aparece.
    expect(toAssign.flatMap((g) => g.cards.map((x) => x.id))).not.toContain(c.betaAfazer.tid);
  });

  it('"Sem data" só aparece na semana atual', async () => {
    const atual = (await semana()).toAssign.find((g) => g.clientName === 'Delta');
    expect(atual?.cards[0]).toMatchObject({ title: 'Sem data Delta', suggestedDueOn: null });
    const outra = await semana(true, [ALMA], '2026-10-12');
    expect(outra.toAssign.some((g) => g.clientName === 'Delta')).toBe(false);
  });

  it('os grupos saem em ordem de cliente e de tipo', async () => {
    const { toAssign } = await semana();
    expect(toAssign.map((g) => `${g.clientName}|${g.type}`)).toEqual(['Alfa|video', 'Beta|null', 'Delta|video']);
  });
});

/**
 * PERF DO SERVIDOR, 09/10/2026 — os dias, os ids dos clientes, os recortes e a
 * tabela de acentos passaram a ir no TEXTO da consulta, e as quatro consultas
 * saem em duas rajadas sem parâmetro. O resultado tem de ser IDÊNTICO ao do
 * caminho por parâmetro, semana a semana e recorte a recorte.
 */
describe('F40 — os valores no texto devolvem o que o parâmetro devolve', () => {
  const rodar = (
    textoDireto: boolean,
    omitidas: string[],
    qual: string | undefined,
    recorte?: RecorteDaConexao,
  ) => {
    const adaptador = criarAdaptadorPglite(db, { papel: 'leitor', textoDireto });
    return { adaptador, resultado: readControleDaSemana(adaptador.sql, ator(true, omitidas), qual, HOJE, undefined, recorte) };
  };

  const casos: Array<[string, string[], string | undefined, RecorteDaConexao | undefined]> = [
    ['semana atual, com a Alma9 omitida', [ALMA], undefined, undefined],
    ['semana atual, nada omitido', [], undefined, undefined],
    ['semana que cruza setembro e outubro', [ALMA], '2026-09-28', undefined],
    ['semana passada, sem virada de mês (não é a atual: o sem data não aparece)', [ALMA], '2026-09-14', undefined],
    ['semana futura', [ALMA], '2026-10-12', undefined],
    ['recorte por empresa', [], undefined, { companyIds: [IDE], clientIds: null }],
    ['recorte por cliente', [], undefined, { companyIds: null, clientIds: [C_ALFA, C_BETA] }],
    ['recorte por empresa e cliente', [], undefined, { companyIds: [IDE], clientIds: [C_GAMA] }],
    ['recorte vazio: nada', [], undefined, { companyIds: [], clientIds: null }],
  ];

  for (const [descricao, omitidas, qual, recorte] of casos) {
    it(`${descricao}: a mesma resposta`, async () => {
      const esperado = await rodar(false, omitidas, qual, recorte).resultado;
      const porTexto = rodar(true, omitidas, qual, recorte);
      const obtido = await porTexto.resultado;
      expect(obtido).toEqual(esperado);
      // As quatro consultas do banco saíram sem parâmetro.
      const doBanco = porTexto.adaptador.consultas.filter((c) => c.includes('ideworks.') && !c.includes('set_config'));
      expect(doBanco).toHaveLength(4);
      // (Recorte de lista vazia vira `null` — `arrayOuNulo` —, que segue como parâmetro.)
      if (recorte?.companyIds?.length !== 0) expect(doBanco.filter((c) => /\$\d/.test(c))).toEqual([]);
    });
  }

  it('a resposta tem conteúdo (não é o vazio comparado com o vazio)', async () => {
    const r = await rodar(true, [ALMA], undefined).resultado;
    expect(r.missing.items.length).toBeGreaterThan(0);
    expect(r.progress.length).toBeGreaterThan(0);
    expect(r.toAssign.length).toBeGreaterThan(0);
    expect(r.missing.overdue.length).toBeGreaterThan(0);
  });

  it('o recorte vazio não devolve cliente nenhum (lista vazia = nada, como antes)', async () => {
    const r = await rodar(true, [], undefined, { companyIds: [], clientIds: null }).resultado;
    expect(r.missing.items).toEqual([]);
    expect(r.progress).toEqual([]);
  });
});
