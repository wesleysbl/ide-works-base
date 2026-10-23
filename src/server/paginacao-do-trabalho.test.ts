/**
 * A paginação de `Minhas tarefas` — a camada pura. Etapa F17.AUD05.
 *
 * O QUE ESTE ARQUIVO PROVA, E POR QUE ELE É O LUGAR CERTO
 *   Tudo o que a rota decide ANTES de tocar no banco: se o endereço é válido,
 *   de onde continuar, quantas linhas pedir, se há mais e qual é o próximo
 *   cursor. Nada disso precisa de banco, e por isso roda aqui, sem rede. O
 *   SQL de cada ramo tem prova própria com o fragmento renderizado
 *   (`board-trabalho.test.ts`) e prova de ponta a ponta contra o banco
 *   (`scripts/provar-paginacao-do-trabalho.mjs`).
 *
 * AS ARMADILHAS QUE ELE GUARDA
 *   1. Cursor quebrado NÃO recomeça do zero em silêncio: recomeçar faria o
 *      consumidor que continua a partir do que recebeu entrar em laço.
 *   2. `limite` nunca vira zero nem passa de 100 — não existe consulta sem
 *      limite, nem por endereço torto.
 *   3. O próximo cursor é a chave da ÚLTIMA linha DEVOLVIDA, e não da linha a
 *      mais que só serviu para dizer "há continuação".
 *   4. Cursor de outra aba é recusado: a AUD06 troca de aba com carga em voo.
 */

import { describe, expect, it } from 'vitest';

import {
  type ChaveDeOrdem,
  type CursorDoTrabalho,
  codificarCursor,
  decodificarCursor,
  lerLimite,
  lerPedidoDePagina,
  LOTE_MAXIMO,
  LOTE_PADRAO,
  montarPagina,
  ramosDoCursor,
  VERSAO_DO_CURSOR,
} from '@/server/paginacao-do-trabalho';

const ID = '0f6c4d2e-1b3a-4c5d-8e9f-0a1b2c3d4e5f';
const OUTRO_ID = '9f6c4d2e-1b3a-4c5d-8e9f-0a1b2c3d4e5f';

const cursor = (mudou: Partial<CursorDoTrabalho> = {}): CursorDoTrabalho => ({
  v: VERSAO_DO_CURSOR,
  aba: 'pendente',
  dueOn: '2026-09-09',
  priority: 'high',
  title: 'post do dia',
  id: ID,
  ...mudou,
});

/** base64url de um JSON qualquer — para forjar cursores com forma errada. */
const b64 = (v: unknown) =>
  Buffer.from(JSON.stringify(v), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/* ───────────────────────────── o cursor ───────────────────────────── */

describe('o cursor — codificar e ler de volta', () => {
  it('vai e volta sem perder nada, inclusive nulos', () => {
    const c = cursor({ dueOn: null, priority: null });
    const lido = decodificarCursor(codificarCursor(c));
    expect(lido).toEqual({ ok: true, cursor: c });
  });

  it('é base64url: sem `+`, `/` nem `=`, para viver numa query string sem escape', () => {
    // Título escolhido para produzir `+` e `/` no base64 comum.
    const texto = codificarCursor(cursor({ title: '???>>>???>>>' }));
    expect(texto).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('acento no título sobrevive — passa por UTF-8, e não por `btoa` cru', () => {
    const c = cursor({ title: 'edição de vídeo — açaí' });
    const lido = decodificarCursor(codificarCursor(c));
    expect(lido.ok && lido.cursor.title).toBe('edição de vídeo — açaí');
  });

  it('o prazo do ano 82025 cabe no cursor — a data é texto, com quatro dígitos OU MAIS', () => {
    const c = cursor({ dueOn: '82025-08-07' });
    expect(decodificarCursor(codificarCursor(c))).toEqual({ ok: true, cursor: c });
  });

  it.each([
    ['base64 quebrado', 'isto não é base64!'],
    ['comprimento impossível de base64', 'A'],
    ['bytes que não são UTF-8', Buffer.from([0xff, 0xfe, 0xfd]).toString('base64url')],
    ['JSON inválido', Buffer.from('{nope', 'utf8').toString('base64url')],
    ['um número em vez de objeto', b64(42)],
    ['uma lista em vez de objeto', b64([1, 2])],
    ['nulo', b64(null)],
    ['sem versão', b64({ aba: 'pendente', dueOn: null, priority: null, title: 'a', id: ID })],
    ['versão desconhecida', b64({ ...cursor(), v: 2 })],
    ['versão como texto', b64({ ...cursor(), v: '1' })],
    ['sem aba', b64({ ...cursor(), aba: undefined })],
    ['aba desconhecida', b64({ ...cursor(), aba: 'todas' })],
    ['prazo com forma errada', b64({ ...cursor(), dueOn: '09/09/2026' })],
    ['prazo como número', b64({ ...cursor(), dueOn: 20260909 })],
    ['prioridade desconhecida', b64({ ...cursor(), priority: 'urgentissima' })],
    ['prioridade como número', b64({ ...cursor(), priority: 1 })],
    ['sem título', b64({ ...cursor(), title: undefined })],
    ['título como número', b64({ ...cursor(), title: 7 })],
    ['id que não é uuid', b64({ ...cursor(), id: 'abc' })],
    ['id ausente', b64({ ...cursor(), id: undefined })],
    ['com SQL no lugar do id', b64({ ...cursor(), id: "' or 1=1 --" })],
  ])('recusa %s', (_caso, texto) => {
    const lido = decodificarCursor(texto);
    expect(lido.ok).toBe(false);
  });

  it('o que sobrar de campo extra é IGNORADO — o cursor lido tem só os campos conhecidos', () => {
    const lido = decodificarCursor(b64({ ...cursor(), userId: 'outra-pessoa', isSuper: true }));
    expect(lido.ok).toBe(true);
    if (lido.ok) {
      expect(Object.keys(lido.cursor).sort()).toEqual(
        ['aba', 'dueOn', 'id', 'priority', 'title', 'v'].sort(),
      );
      expect('userId' in lido.cursor).toBe(false);
    }
  });
});

/* ───────────────────────────── os ramos ───────────────────────────── */

describe('os ramos do cursor — nulo é caso, e não coalesce', () => {
  const chave = (mudou: Partial<ChaveDeOrdem>): ChaveDeOrdem => ({
    dueOn: '2026-09-09',
    priority: 'high',
    title: 'a',
    id: ID,
    ...mudou,
  });

  it.each([
    [{ dueOn: '2026-09-09', priority: 'high' }, { prazo: 'com-valor', prioridade: 'com-valor' }],
    [{ dueOn: '2026-09-09', priority: null }, { prazo: 'com-valor', prioridade: 'nulo' }],
    [{ dueOn: null, priority: 'high' }, { prazo: 'nulo', prioridade: 'com-valor' }],
    [{ dueOn: null, priority: null }, { prazo: 'nulo', prioridade: 'nulo' }],
  ] as const)('%j → %j', (c, esperado) => {
    expect(ramosDoCursor(chave(c))).toEqual(esperado);
  });
});

/* ───────────────────────────── o limite ───────────────────────────── */

describe('o tamanho do lote — tolerante, e nunca sem limite', () => {
  it('o padrão e o teto são 100', () => {
    expect(LOTE_PADRAO).toBe(100);
    expect(LOTE_MAXIMO).toBe(100);
  });

  it.each([
    [null, LOTE_PADRAO],
    ['', LOTE_PADRAO],
    ['   ', LOTE_PADRAO],
    ['abc', LOTE_PADRAO],
    ['0', LOTE_PADRAO],
    ['-5', LOTE_PADRAO],
    ['0.4', LOTE_PADRAO],
    ['Infinity', LOTE_PADRAO],
    ['NaN', LOTE_PADRAO],
    ['1', 1],
    ['2.9', 2],
    ['25', 25],
    ['100', 100],
    ['101', LOTE_MAXIMO],
    ['500', LOTE_MAXIMO],
    ['1e9', LOTE_MAXIMO],
  ])('limite=%j → %i', (texto, esperado) => {
    expect(lerLimite(texto)).toBe(esperado);
  });
});

/* ───────────────────────────── o pedido ───────────────────────────── */

describe('ler o pedido do endereço', () => {
  it('sem `aba` é o contrato antigo — e `limite` sozinho não muda isso', () => {
    expect(lerPedidoDePagina({ aba: null, cursor: null, limite: null })).toEqual({
      ok: true,
      pedido: null,
    });
    expect(lerPedidoDePagina({ aba: null, cursor: null, limite: '10' })).toEqual({
      ok: true,
      pedido: null,
    });
  });

  it('`cursor` sem `aba` é recusado — ignorá-lo devolveria a primeira página de novo', () => {
    const r = lerPedidoDePagina({ aba: null, cursor: codificarCursor(cursor()), limite: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it('`aba` fora das três é 400, com a frase dizendo quais são', () => {
    const r = lerPedidoDePagina({ aba: 'todas', cursor: null, limite: null });
    expect(r).toEqual({
      ok: false,
      status: 400,
      message: 'Aba desconhecida: "todas". Use pendente, feito ou delegado.',
    });
  });

  it('a primeira página: aba, sem cursor, limite padrão', () => {
    expect(lerPedidoDePagina({ aba: 'feito', cursor: null, limite: null })).toEqual({
      ok: true,
      pedido: { aba: 'feito', cursor: null, limite: LOTE_PADRAO },
    });
  });

  it('a página seguinte: o cursor lido, com o limite pedido', () => {
    const c = cursor({ aba: 'delegado' });
    expect(
      lerPedidoDePagina({ aba: 'delegado', cursor: codificarCursor(c), limite: '50' }),
    ).toEqual({ ok: true, pedido: { aba: 'delegado', cursor: c, limite: 50 } });
  });

  it('cursor que não confere é 400 com frase de gente — e sem o motivo técnico', () => {
    const r = lerPedidoDePagina({ aba: 'pendente', cursor: 'lixo!', limite: null });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.message).toBe('Não deu para continuar a leitura de onde parou. Recarregue a lista.');
      expect(r.message).not.toMatch(/base64|JSON/);
    }
  });

  it('cursor de OUTRA aba é 400 — ele apontaria para o meio da aba nova', () => {
    const r = lerPedidoDePagina({
      aba: 'pendente',
      cursor: codificarCursor(cursor({ aba: 'feito' })),
      limite: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it('o pedido NÃO carrega identidade: não há campo de usuário para o endereço preencher', () => {
    const r = lerPedidoDePagina({ aba: 'pendente', cursor: null, limite: null });
    expect(r.ok).toBe(true);
    if (r.ok && r.pedido) expect(Object.keys(r.pedido).sort()).toEqual(['aba', 'cursor', 'limite']);
  });
});

/* ───────────────────────────── a página ───────────────────────────── */

describe('montar a página do que a consulta devolveu', () => {
  const lida = (n: number, chave: Partial<ChaveDeOrdem> = {}) => ({
    row: { n },
    chave: { dueOn: '2026-09-09', priority: null, title: `t${n}`, id: ID, ...chave },
  });

  it('menos que o limite: sem continuação, sem cursor', () => {
    const p = montarPagina([lida(1), lida(2)], { aba: 'pendente', limite: 3 });
    expect(p).toEqual({ rows: [{ n: 1 }, { n: 2 }], returned: 2, hasMore: false, nextCursor: null });
  });

  it('exatamente o limite: também sem continuação — a linha a mais não veio', () => {
    const p = montarPagina([lida(1), lida(2), lida(3)], { aba: 'pendente', limite: 3 });
    expect(p.hasMore).toBe(false);
    expect(p.returned).toBe(3);
    expect(p.nextCursor).toBeNull();
  });

  it('limite + 1: a linha a mais NÃO vai para a tela, só diz que há mais', () => {
    const p = montarPagina([lida(1), lida(2), lida(3), lida(4)], { aba: 'feito', limite: 3 });
    expect(p.rows).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(p.returned).toBe(3);
    expect(p.hasMore).toBe(true);
  });

  it('o próximo cursor é a chave da ÚLTIMA linha DEVOLVIDA, com a aba do pedido', () => {
    const p = montarPagina(
      [lida(1), lida(2), lida(3, { id: OUTRO_ID, priority: 'low' }), lida(4)],
      { aba: 'feito', limite: 3 },
    );
    expect(p.nextCursor).not.toBeNull();
    const lido = decodificarCursor(p.nextCursor ?? '');
    expect(lido).toEqual({
      ok: true,
      cursor: {
        v: VERSAO_DO_CURSOR,
        aba: 'feito',
        dueOn: '2026-09-09',
        priority: 'low',
        title: 't3',
        id: OUTRO_ID,
      },
    });
  });

  it('vazio: zero linhas, sem continuação', () => {
    expect(montarPagina([], { aba: 'delegado', limite: 100 })).toEqual({
      rows: [],
      returned: 0,
      hasMore: false,
      nextCursor: null,
    });
  });

  it('`returned` é o que veio, e não é confundido com um total — a página não sabe o total', () => {
    const p = montarPagina([lida(1)], { aba: 'pendente', limite: 100 });
    expect(p.returned).toBe(1);
    expect('total' in p).toBe(false);
  });
});
