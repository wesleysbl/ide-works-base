/**
 * Tarefas de um escopo — a camada que decide SEM banco. Etapa F18A.
 *
 * O que se prova aqui: o endereço (estrito no universo, tolerante nos
 * filtros), o cursor (opaco, conferido, preso ao escopo), a FORMA do SQL da
 * peneira (só entra o que está ligado; nenhum valor vira texto), as contagens
 * e os fluxos do Kanban (etapas reais, nada mesclado por nome).
 *
 * O resultado contra um Postgres — política de linha parcial, cursores,
 * lista sem pasta — está em `tarefas-do-escopo-banco.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import {
  LOTE_DO_ESCOPO,
  LOTE_MAXIMO_DO_ESCOPO,
  SEM_FILTRO_DO_ESCOPO,
  enderecoDoEscopo,
  lerFiltroDoEscopo,
  paraEnderecoDoEscopo,
} from '@/board/tarefas-do-escopo';
import type { Tx } from '@/server/db';
import {
  type CursorDoEscopo,
  type EtapaLida,
  SEM_ETAPA,
  VERSAO_DO_CURSOR_DO_ESCOPO,
  codificarCursorDoEscopo,
  contagensDoMapa,
  decodificarCursorDoEscopo,
  lerPedidoDoEscopo,
  montarFluxos,
  peneiraDoEscopo,
  universoDoEscopo,
} from '@/server/tarefas-do-escopo';

const ESPACO = '0f6c4d2e-1b3a-4c5d-8e9f-0a1b2c3d4e5f';
const OUTRO = '1f6c4d2e-1b3a-4c5d-8e9f-0a1b2c3d4e5f';
const TAREFA = 'aaaa0002-0000-4000-8000-000000000001';
const PESSOA = '73f62070-0587-4181-93b5-5e657a4539ac';

const params = (o: Record<string, string>) => new URLSearchParams(o);

/* ───────────────────────────── o dublê de `tx` ───────────────────────────── */

type Renderizado = { sql: string; valores: unknown[]; dublê: true };
const ehRenderizado = (v: unknown): v is Renderizado =>
  typeof v === 'object' && v !== null && (v as Renderizado).dublê === true;
const dublê = ((strings: TemplateStringsArray, ...values: unknown[]): Renderizado => {
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
  return { sql, valores, dublê: true };
}) as unknown as Tx;
const render = (f: unknown): Renderizado => {
  if (!ehRenderizado(f)) throw new Error('o fragmento não veio do dublê');
  return { ...f, sql: f.sql.replace(/\s+/g, ' ').trim() };
};

/* ───────────────────────────── o endereço ───────────────────────────── */

describe('o pedido lido do endereço', () => {
  it('escopo e id válidos, sem mais nada: primeira página, lote padrão, sem filtro', () => {
    const r = lerPedidoDoEscopo(params({ escopo: 'espaco', id: ESPACO }));
    expect(r).toEqual({
      ok: true,
      pedido: { escopo: 'espaco', id: ESPACO, filtro: SEM_FILTRO_DO_ESCOPO, cursor: null, limite: LOTE_DO_ESCOPO },
    });
  });

  it('escopo desconhecido, sem id ou id torto: 400 antes do banco', () => {
    const casos: Record<string, string>[] = [
      { escopo: 'cliente', id: ESPACO },
      { id: ESPACO },
      { escopo: 'pasta' },
      { escopo: 'lista', id: 'nao-e-uuid' },
    ];
    for (const p of casos) {
      const r = lerPedidoDoEscopo(params(p));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
    }
  });

  it('limite: teto em 100, torto cai no padrão — nunca consulta sem limite', () => {
    const lim = (limite: string) => {
      const r = lerPedidoDoEscopo(params({ escopo: 'lista', id: ESPACO, limite }));
      return r.ok ? r.pedido.limite : -1;
    };
    expect(lim('500')).toBe(LOTE_MAXIMO_DO_ESCOPO);
    expect(lim('0')).toBe(LOTE_DO_ESCOPO);
    expect(lim('abc')).toBe(LOTE_DO_ESCOPO);
    expect(lim('20')).toBe(20);
  });

  it('filtros tolerantes: valor torto vira "qualquer", nunca 400', () => {
    const f = lerFiltroDoEscopo(
      params({ prazo: 'ontem', pasta: 'x', lista: 'y', etapa: 'z', responsavel: 'eu', concluidas: 'talvez' }),
    );
    expect(f).toEqual(SEM_FILTRO_DO_ESCOPO);
  });

  it('filtros ligados vão e voltam pelo endereço sem perder nada', () => {
    const filtro = {
      texto: 'documentário',
      responsavel: 'sem',
      pasta: 'sem',
      lista: TAREFA,
      etapa: PESSOA,
      prazo: 'atrasado' as const,
      concluidas: true,
    };
    const volta = lerFiltroDoEscopo(params(paraEnderecoDoEscopo(filtro)));
    expect(volta).toEqual(filtro);
    // Sem filtro, o endereço fica limpo.
    expect(paraEnderecoDoEscopo(SEM_FILTRO_DO_ESCOPO)).toEqual({});
  });

  it('o endereço da rota carrega escopo, filtros, cursor e lote', () => {
    const e = enderecoDoEscopo({
      escopo: 'pasta',
      id: ESPACO,
      filtro: { ...SEM_FILTRO_DO_ESCOPO, prazo: 'hoje' },
      cursor: 'abc',
      limite: 20,
    });
    expect(e.startsWith('/board/scope-tasks?')).toBe(true);
    const p = new URLSearchParams(e.split('?')[1]);
    expect(Object.fromEntries(p)).toEqual({ escopo: 'pasta', id: ESPACO, prazo: 'hoje', cursor: 'abc', limite: '20' });
  });
});

/* ───────────────────────────── o cursor ───────────────────────────── */

describe('o cursor do escopo', () => {
  const cursor: CursorDoEscopo = {
    v: VERSAO_DO_CURSOR_DO_ESCOPO,
    escopo: 'espaco',
    alvo: ESPACO,
    dueOn: '82025-08-07',
    priority: 'high',
    title: 'thumb documentário',
    id: TAREFA,
  };

  it('ida e volta, com acento e ano de cinco dígitos', () => {
    expect(decodificarCursorDoEscopo(codificarCursorDoEscopo(cursor))).toEqual(cursor);
  });

  it('continua só o MESMO escopo: cursor de outro espaço ou de outro nível é 400', () => {
    const texto = codificarCursorDoEscopo(cursor);
    const outroAlvo = lerPedidoDoEscopo(params({ escopo: 'espaco', id: OUTRO, cursor: texto }));
    const outroNivel = lerPedidoDoEscopo(params({ escopo: 'pasta', id: ESPACO, cursor: texto }));
    const mesmo = lerPedidoDoEscopo(params({ escopo: 'espaco', id: ESPACO, cursor: texto }));
    expect(outroAlvo.ok).toBe(false);
    expect(outroNivel.ok).toBe(false);
    expect(mesmo.ok && mesmo.pedido.cursor).toEqual(cursor);
  });

  it('cursor quebrado, de versão desconhecida ou com campo torto é recusado', () => {
    const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '');
    for (const t of [
      '!!!',
      b64({ ...cursor, v: 2 }),
      b64({ ...cursor, priority: 'altissima' }),
      b64({ ...cursor, id: 'x' }),
      b64({ ...cursor, dueOn: 'amanhã' }),
    ]) {
      expect(decodificarCursorDoEscopo(t)).toBeNull();
    }
  });
});

/* ───────────────────────────── o SQL ───────────────────────────── */

describe('o SQL do universo e da peneira', () => {
  it('espaço: listas vivas, fora de pasta arquivada — e as SEM pasta entram', () => {
    const r = render(universoDoEscopo(dublê, 'espaco', ESPACO));
    expect(r.sql).toBe(
      '(l.space_id = ?::uuid and l.archived_at is null and (l.folder_id is null or f.archived_at is null))',
    );
    expect(r.valores).toEqual([ESPACO]);
  });

  it('lista: a lista pedida, mesmo arquivada', () => {
    expect(render(universoDoEscopo(dublê, 'lista', ESPACO)).sql).toBe('(l.id = ?::uuid)');
  });

  it('sem filtro: só "abertas" (concluídas fora por padrão)', () => {
    const r = render(peneiraDoEscopo(dublê, SEM_FILTRO_DO_ESCOPO));
    expect(r.sql).toBe('(true and true) and t.completed_at is null');
    expect(r.valores).toEqual([]);
  });

  it('cada filtro ligado entra como parâmetro — nenhum valor vira texto de SQL', () => {
    const r = render(
      peneiraDoEscopo(dublê, {
        texto: "Ação'; drop table x",
        responsavel: PESSOA,
        pasta: 'sem',
        lista: TAREFA,
        etapa: TAREFA,
        prazo: 'atrasado',
        concluidas: true,
      }),
    );
    expect(r.sql).not.toContain('drop table');
    expect(r.sql).toContain('l.folder_id is null');
    expect(r.sql).toContain('l.id = ?::uuid');
    expect(r.sql).toContain('t.status_id = ?::uuid');
    expect(r.sql).toContain('t.due_on < ((now() at time zone ?::text)::date) and t.completed_at is null');
    expect(r.sql).not.toContain('and t.completed_at is null and'); // concluídas incluídas
    expect(r.valores).toContain("acao'; drop table x");
    expect(r.valores).toContain(PESSOA);
    expect(r.valores).toContain('America/Sao_Paulo');
  });

  it('"sem responsável" não manda a sentinela como uuid', () => {
    const r = render(peneiraDoEscopo(dublê, { ...SEM_FILTRO_DO_ESCOPO, responsavel: 'sem' }));
    expect(r.sql).toContain('not exists (select 1 from ideworks.task_assignees a where a.task_id = t.id)');
    expect(r.valores).not.toContain('sem');
  });
});

/* ───────────────────────────── contagens e fluxos ───────────────────────────── */

describe('as contagens do recorte', () => {
  it('total, abertas e resultado somam todas as etapas; "sem etapa" à parte', () => {
    const { counts, statusCounts } = contagensDoMapa({
      a: { total: 10, abertas: 7, matched: 3 },
      b: { total: 5, abertas: 5, matched: 5 },
      [SEM_ETAPA]: { total: 2, abertas: 1, matched: 1 },
    });
    expect(counts).toEqual({ total: 17, abertas: 13, matched: 9, semEtapa: 1 });
    expect(statusCounts).toEqual({ a: { total: 10, matched: 3 }, b: { total: 5, matched: 5 } });
    const somaEtapas = Object.values(statusCounts).reduce((s, x) => s + x.matched, 0);
    expect(somaEtapas + counts.semEtapa).toBe(counts.matched);
  });
});

describe('os fluxos do Kanban', () => {
  const W1 = 'w1';
  const W2 = 'w2';
  const W3 = 'w3';
  const etapa = (id: string, name: string, workflowId: string, sortOrder: number): EtapaLida => ({
    id,
    name,
    type: 'custom',
    color: null,
    sortOrder,
    workflowId,
    workflowName: workflowId.toUpperCase(),
  });
  const etapas = [
    etapa('s1b', 'Fazendo', W1, 1),
    etapa('s1a', 'A fazer', W1, 0),
    etapa('s2a', 'A fazer', W2, 0),
    etapa('s3a', 'Antiga', W3, 0),
  ];
  const listas = [
    { id: 'l1', folderId: 'p1', workflowId: W1 },
    { id: 'l2', folderId: 'p1', workflowId: W1 },
    { id: 'l3', folderId: null, workflowId: W2 },
  ];

  it('"A fazer" de dois fluxos são DUAS etapas, cada uma no seu fluxo, na ordem da esteira', () => {
    const fluxos = montarFluxos(listas, etapas, { s1a: { total: 4, matched: 2 } }, SEM_FILTRO_DO_ESCOPO);
    expect(fluxos.map((f) => [f.id, f.lists, f.etapas.map((e) => e.id)])).toEqual([
      [W1, 2, ['s1a', 's1b']],
      [W2, 1, ['s2a']],
    ]);
    expect(fluxos[0]?.etapas[0]).toMatchObject({ total: 4, matched: 2 });
  });

  it('filtro de pasta "sem" deixa só o fluxo das listas soltas', () => {
    const fluxos = montarFluxos(listas, etapas, {}, { pasta: 'sem', lista: null });
    expect(fluxos.map((f) => f.id)).toEqual([W2]);
  });

  it('fluxo que nenhuma lista usa, mas com tarefa numa etapa dele, continua tendo coluna', () => {
    const fluxos = montarFluxos(listas, etapas, { s3a: { total: 1, matched: 1 } }, SEM_FILTRO_DO_ESCOPO);
    expect(fluxos.map((f) => f.id)).toContain(W3);
  });
});
