/**
 * O `where` da aba e a condição do cursor, renderizados — etapa F17.AUD05.
 *
 * O QUE ESTE ARQUIVO PROVA, E O QUE ELE NÃO PROVA
 *   A suíte não fala com banco (bloqueio de rede da F0.4). O que dá para provar
 *   aqui é a FORMA do SQL: que o `where` de cada aba sai da tabela
 *   `ESPECIFICACAO_DAS_ABAS` (e não de um `if` escrito à mão), que a
 *   identidade que entra nele é a do ator e só ela, e que a condição "depois
 *   do cursor" muda de ramo conforme os nulos — os quatro ramos, cada um com o
 *   SQL que o cabeçalho de `depoisDoCursor` descreve.
 *
 *   Se o SQL está CERTO para o Postgres — se a página seguinte começa onde a
 *   anterior parou, sem pular nem repetir — só o banco diz. É
 *   `scripts/provar-paginacao-do-trabalho.mjs`, com 501 tarefas e empates.
 *
 * O DUBLÊ DE `tx`
 *   Um tag de template que renderiza fragmentos aninhados para texto, trocando
 *   cada valor por `?` e guardando-o numa lista. É o suficiente para ler o SQL
 *   e para conferir que nenhum valor virou texto de consulta.
 */

import { describe, expect, it } from 'vitest';

import { ABAS, ESPECIFICACAO_DAS_ABAS } from '@/board/meu-trabalho';
import type { Tx } from '@/server/db';
import { depoisDoCursor, predicadoDaAba } from '@/server/board-trabalho';

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

const EU = 'aaaa0002-0000-4000-8000-000000000001';
const ID = '0f6c4d2e-1b3a-4c5d-8e9f-0a1b2c3d4e5f';

/* ───────────────────────────── a aba ───────────────────────────── */

describe('o `where` de cada aba sai da tabela', () => {
  it('`pendente`: atribuída a mim = true, concluída = false — e nada sobre criação', () => {
    const r = render(predicadoDaAba(dublê, EU, 'pendente'));
    expect(r.sql).toBe(
      '(exists (select 1 from ideworks.task_assignees a where a.task_id = t.id and a.user_id = ?)) = ?::boolean ' +
        'and (t.completed_at is not null) = ?::boolean',
    );
    expect(r.valores).toEqual([EU, true, false]);
  });

  it('`feito`: atribuída a mim = true, concluída = true', () => {
    const r = render(predicadoDaAba(dublê, EU, 'feito'));
    expect(r.sql).toBe(
      '(exists (select 1 from ideworks.task_assignees a where a.task_id = t.id and a.user_id = ?)) = ?::boolean ' +
        'and (t.completed_at is not null) = ?::boolean',
    );
    expect(r.valores).toEqual([EU, true, true]);
  });

  it('`delegado`: atribuída a mim = FALSE, criei = true, tem outros = true — e nada sobre conclusão', () => {
    const r = render(predicadoDaAba(dublê, EU, 'delegado'));
    expect(r.sql).toBe(
      '(exists (select 1 from ideworks.task_assignees a where a.task_id = t.id and a.user_id = ?)) = ?::boolean ' +
        'and (coalesce(t.created_by = ?, false)) = ?::boolean ' +
        'and (exists (select 1 from ideworks.task_assignees a where a.task_id = t.id and a.user_id <> ?)) = ?::boolean',
    );
    expect(r.valores).toEqual([EU, false, EU, true, EU, true]);
    expect(r.sql).not.toContain('completed_at');
  });

  it('cada aba tem exatamente um conjunto por fato citado — a tabela manda, não um `if`', () => {
    for (const aba of ABAS) {
      const citados = Object.keys(ESPECIFICACAO_DAS_ABAS[aba]).length;
      const r = render(predicadoDaAba(dublê, EU, aba));
      // Cada fato citado entra como `= ?::boolean`, um por fato — nem mais
      // (um `if` a mais escondido), nem menos (um fato da tabela ignorado).
      expect(r.sql.match(/= \?::boolean/g)?.length, aba).toBe(citados);
      expect(r.valores.filter((v) => typeof v === 'boolean').length, aba).toBe(citados);
    }
  });

  it('a ÚNICA identidade no `where` é a do ator — no dublê (sem `unsafe`) ela entra como parâmetro', () => {
    for (const aba of ABAS) {
      const r = render(predicadoDaAba(dublê, EU, aba));
      expect(r.sql, aba).not.toContain(EU);
      const textos = r.valores.filter((v) => typeof v === 'string');
      expect(new Set(textos), aba).toEqual(new Set([EU]));
    }
  });
});

describe('o `where` de cada aba com o cliente real (que tem `unsafe`)', () => {
  const comUnsafe = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) =>
      (dublê as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Renderizado)(strings, ...values),
    { unsafe: (texto: string): Renderizado => ({ sql: texto, valores: [], dublê: true }) },
  ) as unknown as Tx;

  it('o id do ator (UUID canônico) e o valor de cada fato vão no TEXTO — sem parâmetro nenhum', () => {
    const r = render(predicadoDaAba(comUnsafe, EU, 'delegado'));
    expect(r.valores).toEqual([]);
    expect(r.sql).toBe(
      "(exists (select 1 from ideworks.task_assignees a where a.task_id = t.id and a.user_id = '" + EU + "')) = false::boolean " +
        "and (coalesce(t.created_by = '" + EU + "', false)) = true::boolean " +
        "and (exists (select 1 from ideworks.task_assignees a where a.task_id = t.id and a.user_id <> '" + EU + "')) = true::boolean",
    );
  });

  it('id fora do formato não vira texto: continua parâmetro (nada de aspa no SQL)', () => {
    const torto = "x' or '1'='1";
    const r = render(predicadoDaAba(comUnsafe, torto, 'pendente'));
    expect(r.sql).not.toContain('or ');
    expect(r.valores).toEqual([torto]);
  });
});

/* ───────────────────────────── o cursor ───────────────────────────── */

describe('"depois do cursor" — os quatro ramos', () => {
  const chave = { dueOn: '2026-09-09', priority: 'high' as const, title: 'post', id: ID };

  it('prazo COM valor e prioridade COM valor: os três `or` em cada nível', () => {
    const r = render(depoisDoCursor(dublê, chave));
    expect(r.sql).toBe(
      '(t.due_on is null or t.due_on > ?::date or (t.due_on = ?::date and ' +
        '(t.priority is null or t.priority > ?::ideworks.task_priority or (t.priority = ?::ideworks.task_priority and ' +
        '(lower(t.title) > ?::text or (lower(t.title) = ?::text and t.id > ?::uuid))))))',
    );
    expect(r.valores).toEqual([
      '2026-09-09',
      '2026-09-09',
      'high',
      'high',
      'post',
      'post',
      ID,
    ]);
  });

  it('prazo COM valor e prioridade NULA: só quem também não tem prioridade vem depois', () => {
    const r = render(depoisDoCursor(dublê, { ...chave, priority: null }));
    expect(r.sql).toBe(
      '(t.due_on is null or t.due_on > ?::date or (t.due_on = ?::date and ' +
        '(t.priority is null and ' +
        '(lower(t.title) > ?::text or (lower(t.title) = ?::text and t.id > ?::uuid)))))',
    );
    expect(r.valores).toEqual(['2026-09-09', '2026-09-09', 'post', 'post', ID]);
    expect(r.sql).not.toContain('task_priority');
  });

  it('prazo NULO e prioridade COM valor: só quem não tem prazo vem depois', () => {
    const r = render(depoisDoCursor(dublê, { ...chave, dueOn: null }));
    expect(r.sql).toBe(
      '(t.due_on is null and ' +
        '(t.priority is null or t.priority > ?::ideworks.task_priority or (t.priority = ?::ideworks.task_priority and ' +
        '(lower(t.title) > ?::text or (lower(t.title) = ?::text and t.id > ?::uuid)))))',
    );
    expect(r.valores).toEqual(['high', 'high', 'post', 'post', ID]);
    expect(r.sql).not.toContain('::date');
  });

  it('prazo NULO e prioridade NULA: o fim da lista, desempatado por título e id', () => {
    const r = render(depoisDoCursor(dublê, { ...chave, dueOn: null, priority: null }));
    expect(r.sql).toBe(
      '(t.due_on is null and (t.priority is null and ' +
        '(lower(t.title) > ?::text or (lower(t.title) = ?::text and t.id > ?::uuid))))',
    );
    expect(r.valores).toEqual(['post', 'post', ID]);
  });

  it('nenhum valor do cursor vira texto de SQL — nem um título com aspas e ponto-e-vírgula', () => {
    const r = render(
      depoisDoCursor(dublê, { ...chave, title: "x'; drop table ideworks.tasks; --" }),
    );
    expect(r.sql).not.toContain('drop table');
    expect(r.valores).toContain("x'; drop table ideworks.tasks; --");
  });

  it('o id compara como uuid e o prazo como date — os moldes explícitos estão lá', () => {
    const r = render(depoisDoCursor(dublê, chave));
    expect(r.sql).toContain('t.id > ?::uuid');
    expect(r.sql).toContain('t.due_on > ?::date');
    expect(r.sql).toContain('t.priority > ?::ideworks.task_priority');
  });
});
