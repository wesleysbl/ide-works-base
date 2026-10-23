/**
 * A leitura da situação de entrega e o campo novo do Painel — F38, Fase 1.
 *
 * O QUE ESTE ARQUIVO PROVA, E O QUE ELE NÃO PROVA
 *   A suíte não fala com banco. Aqui o `tx` é um dublê que renderiza o SQL e
 *   responde linhas escolhidas pelo teste: dá para provar QUAIS consultas saem
 *   (só ids de ativos, o "hoje" de São Paulo como parâmetro, nada da tabela
 *   inteira) e que as linhas viram a situação pela regra única.
 *
 *   Se o SQL dá as datas certas no Postgres, só o banco diz:
 *   `scripts/provar-ultima-entrega.mjs`.
 */

import { describe, expect, it } from 'vitest';

import type { Sql, Tx } from '@/server/db';
import { readDeliveryStatus } from '@/server/delivery-status';
import { readPanel } from '@/server/panel';
import type { AuthenticatedActor } from '@/server/session';

/* ───────────────────────────── o dublê de `tx` ───────────────────────────── */

type Renderizado = { sql: string; valores: unknown[]; dublê: true };
type Linha = Record<string, unknown>;

const ehRenderizado = (v: unknown): v is Renderizado =>
  typeof v === 'object' && v !== null && (v as Renderizado).dublê === true;

/**
 * Cada chamada vira um fragmento que TAMBÉM é uma promessa: aninhado, entra no
 * texto do pai; aguardado, pergunta ao `responder` e guarda o SQL lido.
 */
function criarDublê(responder: (sql: string, valores: unknown[]) => Linha[]) {
  const lidas: Renderizado[] = [];
  const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    let sql = strings[0] ?? '';
    const valores: unknown[] = [];
    values.forEach((v, i) => {
      if (ehRenderizado(v)) {
        sql += v.sql;
        valores.push(...v.valores);
      } else {
        valores.push(v);
        sql += '?';
      }
      sql += strings[i + 1] ?? '';
    });
    const fragmento: Renderizado = { sql, valores, dublê: true };
    return Object.assign(fragmento, {
      then(ok: (linhas: Linha[]) => unknown, falha?: (e: unknown) => unknown) {
        const limpo = { ...fragmento, sql: sql.replace(/\s+/g, ' ').trim() };
        lidas.push(limpo);
        return Promise.resolve(responder(limpo.sql, valores)).then(ok, falha);
      },
    });
  }) as unknown as Tx;
  return { tx, lidas };
}

const ATIVO = '0f6c4d2e-1b3a-4c5d-8e9f-0a1b2c3d4e5f';
const OUTRO = '1f6c4d2e-1b3a-4c5d-8e9f-0a1b2c3d4e5f';
const CANCELADO = '2f6c4d2e-1b3a-4c5d-8e9f-0a1b2c3d4e5f';

/** 06/10/2026, meio-dia em São Paulo. */
const AGORA = new Date('2026-10-06T15:00:00Z');

/** As três consultas da leitura, reconhecidas pelo que só cada uma tem. */
function respostaDaSemanal(sql: string): Linha[] | null {
  if (sql.includes('distinct on (i.client_id)')) {
    return [{ client_id: ATIVO, scheduled_at: new Date('2026-10-05T13:00:00Z'), is_completed: true }];
  }
  if (sql.includes('i.completed_at is null or')) {
    return [
      // Vencida de agosto: sem corte de meses (decisão de 06/10), ela conta.
      { client_id: ATIVO, scheduled_at: new Date('2026-08-01T13:00:00Z'), is_completed: false },
      { client_id: ATIVO, scheduled_at: new Date('2026-09-21T13:00:00Z'), is_completed: false },
      { client_id: ATIVO, scheduled_at: new Date('2026-10-06T13:00:00Z'), is_completed: false },
      { client_id: ATIVO, scheduled_at: new Date('2026-10-09T13:00:00Z'), is_completed: true },
    ];
  }
  if (sql.includes('i.scheduled_at is null')) {
    return [
      { client_id: ATIVO, scheduled_at: null, is_completed: false },
      { client_id: ATIVO, scheduled_at: null, is_completed: true },
    ];
  }
  return null;
}

describe('readDeliveryStatus', () => {
  it('sem cliente, nenhuma consulta sai', async () => {
    const { tx, lidas } = criarDublê(() => []);
    const r = await readDeliveryStatus(tx, [], AGORA);
    expect(r.size).toBe(0);
    expect(lidas).toHaveLength(0);
  });

  it('três consultas, todas presas aos ids pedidos e ao "hoje" de São Paulo', async () => {
    const { tx, lidas } = criarDublê((sql) => respostaDaSemanal(sql) ?? []);
    await readDeliveryStatus(tx, [ATIVO, OUTRO], AGORA);

    expect(lidas).toHaveLength(3);
    for (const q of lidas) {
      expect(q.sql).toContain('from ideworks.content_items i');
      expect(q.sql).toContain('i.client_id = any(?::uuid[])');
      expect(q.valores[0]).toEqual([ATIVO, OUTRO]);
      expect(q.valores).toContain('2026-10-06');
      // F38, Fase 4: a própria consulta exige cliente ativo.
      expect(q.sql).toContain('exists (select 1 from ideworks.clients ativo where ativo.id = i.client_id and ativo.is_active)');
    }
    // O dia é cortado em São Paulo, não em UTC.
    expect(lidas[0].valores).toContain('America/Sao_Paulo');
    // Vencida não tem corte de meses (06/10): nenhum intervalo na consulta,
    // só "sem ✓" ou "dia futuro".
    expect(lidas[1].sql).not.toContain('make_interval');
    expect(lidas[1].sql).toContain('i.completed_at is null or (i.scheduled_at at time zone ?)::date > ?::date');
    // "Sem dia" é só do mês corrente.
    expect(lidas[2].sql).toContain("i.reference_month = date_trunc('month', ?::date)::date");
  });

  it('as linhas viram a situação pela regra única; cliente sem peça volta "sem entrega"', async () => {
    const { tx } = criarDublê((sql) => respostaDaSemanal(sql) ?? []);
    const r = await readDeliveryStatus(tx, [ATIVO, OUTRO], AGORA);

    expect(r.get(ATIVO)).toEqual({
      today: '2026-10-06',
      lastDeliveryOn: '2026-10-05',
      daysSinceLastDelivery: 1,
      overdue: ['2026-08-01', '2026-09-21'],
      dueToday: 1,
      unscheduled: 2,
      nextScheduledOn: '2026-10-09',
    });
    expect(r.get(OUTRO)).toMatchObject({ lastDeliveryOn: null, overdue: [], nextScheduledOn: null });
  });
});

describe('readPanel — o campo novo `deliveryStatus`', () => {
  const actor: AuthenticatedActor = {
    userId: 'aaaa0002-0000-4000-8000-000000000001',
    email: 'teste@exemplo.com',
    papel: 'admin',
    isSuperadmin: true,
    isSuper: false,
    areas: [],
    hasAllClientsAccess: true,
  } as unknown as AuthenticatedActor;

  const clienteLido = (id: string, name: string, isActive: boolean): Linha => ({
    id,
    name,
    category_id: 'cat',
    category_name: 'Ide',
    category_sort_order: 0,
    urgency: 'paz',
    is_active: isActive,
    inactive_at: isActive ? null : '2026-09-10T12:00:00Z',
    finance_ok: true,
    started_on: '2026-01-01',
    renews_on: null,
    plan_id: null,
    tags: [],
  });

  it('ativo ganha a situação; cancelado fica nulo e nem entra na consulta', async () => {
    const { tx, lidas } = criarDublê((sql) => {
      if (sql.includes('from ideworks.clients c')) {
        return [clienteLido(ATIVO, 'Hiper Center', true), clienteLido(CANCELADO, 'Zeca', false)];
      }
      return respostaDaSemanal(sql) ?? [];
    });
    const sql = { begin: (trabalho: (t: Tx) => Promise<unknown>) => trabalho(tx) } as unknown as Sql;

    const painel = await readPanel(sql, actor, '2026-10-01', '2026-10-31', AGORA);
    const ativo = painel.clients.find((c) => c.id === ATIVO);
    const cancelado = painel.clients.find((c) => c.id === CANCELADO);

    expect(ativo?.deliveryStatus).toMatchObject({
      lastDeliveryOn: '2026-10-05',
      overdue: ['2026-08-01', '2026-09-21'],
      nextScheduledOn: '2026-10-09',
    });
    expect(cancelado?.deliveryStatus).toBeNull();

    // Os campos de antes continuam lá, do mesmo jeito.
    expect(cancelado).toMatchObject({ isActive: false, inPeriod: { scheduled: 0, completed: 0 } });
    expect(ativo?.delivery.measurable).toBe(false);

    const daSemanal = lidas.filter((q) => q.sql.includes('from ideworks.content_items i'));
    expect(daSemanal).toHaveLength(3);
    for (const q of daSemanal) expect(q.valores[0]).toEqual([ATIVO]);
  });
});
