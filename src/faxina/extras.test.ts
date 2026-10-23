import { describe, expect, it } from 'vitest';

import { type LinhaDoCadastro, type LinhaDoContrato, type PecaLida, mesCorrenteNaAgencia, planejarReclassificacao } from './extras';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const OUT = '2026-10-01';
const NOV = '2026-11-01';
const SET = '2026-09-01';

let n = 0;
const peca = (extra: Partial<PecaLida>): PecaLida => {
  n += 1;
  return {
    id: `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
    clientId: A,
    referenceMonth: OUT,
    contentType: 'arte',
    isExtra: false,
    title: null,
    createdAt: `2026-09-${String(n % 28 + 1).padStart(2, '0')}T12:00:00.000000Z`,
    updatedAt: '2026-10-01T12:00:00.000000Z',
    ...extra,
  };
};
const base = (q: number, extra: Partial<PecaLida> = {}) => Array.from({ length: q }, () => peca(extra));
const extra = (createdAt: string, outro: Partial<PecaLida> = {}) => peca({ isExtra: true, createdAt, ...outro });

const contrato = (clientId: string, referenceMonth: string, itens: Record<string, number> | null, openedAt = '2026-10-01T09:00:00.000000Z'): LinhaDoContrato[] =>
  itens === null
    ? [{ clientId, referenceMonth, openedAt, contentType: null, quantity: 0 }]
    : Object.entries(itens).map(([contentType, quantity]) => ({ clientId, referenceMonth, openedAt, contentType, quantity }));
const cadastro = (clientId: string, itens: Record<string, number>): LinhaDoCadastro[] =>
  Object.entries(itens).map(([contentType, quantity]) => ({ clientId, contentType, quantity }));

const planejar = (pecas: PecaLida[], contratos: LinhaDoContrato[], cad: LinhaDoCadastro[], aPartirDe: string | null = OUT) =>
  planejarReclassificacao({ pecas, contratos, cadastro: cad, aPartirDe });

describe('planejarReclassificacao — a regra da Fase 4 da F44', () => {
  it('base menor que a cota recebe os extras do mais antigo para o mais novo; o que sobra fica extra', () => {
    const novo = extra('2026-09-20T10:00:00.000000Z');
    const antigo = extra('2026-09-02T10:00:00.000000Z');
    const meio = extra('2026-09-10T10:00:00.000000Z');
    // Mês não aberto: vale o cadastro (arte 3). Base 1 → duas vagas.
    const [g] = planejar([...base(1), novo, antigo, meio], [], cadastro(A, { arte: 3 }));
    expect(g).toMatchObject({ clientId: A, referenceMonth: OUT, contentType: 'arte', fonte: 'cadastro', cota: 3, base: 1, motivo: 'vaga' });
    expect(g?.extras.map((p) => p.id)).toEqual([antigo.id, meio.id, novo.id]);
    expect(g?.viramBase.map((p) => p.id)).toEqual([antigo.id, meio.id]);
  });

  it('extras que cabem inteiros viram todos base', () => {
    const e1 = extra('2026-09-02T10:00:00.000000Z');
    const e2 = extra('2026-09-03T10:00:00.000000Z');
    const [g] = planejar([e1, e2], [], cadastro(A, { arte: 8 }));
    expect(g?.viramBase.map((p) => p.id)).toEqual([e1.id, e2.id]);
  });

  it('base cheia não muda', () => {
    const [g] = planejar([...base(3), extra('2026-09-02T10:00:00.000000Z')], [], cadastro(A, { arte: 3 }));
    expect(g).toMatchObject({ motivo: 'base-cheia', cota: 3, base: 3 });
    expect(g?.viramBase).toEqual([]);
  });

  it('mês sem contrato nem cota no cadastro não muda — e cota zero no cadastro é "sem cota"', () => {
    const [sem] = planejar([extra('2026-09-02T10:00:00.000000Z')], [], []);
    expect(sem).toMatchObject({ fonte: 'nenhuma', cota: 0, motivo: 'sem-cota' });
    expect(sem?.viramBase).toEqual([]);

    const [zero] = planejar([extra('2026-09-02T10:00:00.000000Z')], [], cadastro(A, { arte: 0 }));
    expect(zero).toMatchObject({ fonte: 'nenhuma', motivo: 'sem-cota' });
    expect(zero?.viramBase).toEqual([]);
  });

  it('mês ABERTO vale o contrato congelado, e não o cadastro de hoje — mesmo vazio (F17.57)', () => {
    const cedo = '2026-09-02T10:00:00.000000Z'; // antes da abertura (01/10 09:00)
    // Contrato 4, cadastro 1: valem as 4.
    const pecas = [extra(cedo), extra(cedo), extra(cedo)];
    const [g] = planejar(pecas, contrato(A, OUT, { arte: 4 }), cadastro(A, { arte: 1 }));
    expect(g).toMatchObject({ fonte: 'contrato', cota: 4, motivo: 'vaga' });
    expect(g?.viramBase).toHaveLength(3);

    // Aberto sem item: cota zero, mesmo com cadastro.
    const [vazio] = planejar([extra(cedo)], contrato(A, OUT, null), cadastro(A, { arte: 5 }));
    expect(vazio).toMatchObject({ fonte: 'contrato', cota: 0, motivo: 'sem-cota' });
  });

  it('cada tipo conta separado', () => {
    const video = extra('2026-09-02T10:00:00.000000Z', { contentType: 'video' });
    const arte1 = extra('2026-09-03T10:00:00.000000Z');
    const arte2 = extra('2026-09-04T10:00:00.000000Z');
    const grupos = planejar(
      [...base(2, { contentType: 'video' }), video, arte1, arte2],
      [],
      cadastro(A, { video: 2, arte: 3 }),
    );
    const porTipo = Object.fromEntries(grupos.map((g) => [g.contentType, g]));
    expect(porTipo.video).toMatchObject({ motivo: 'base-cheia', base: 2, cota: 2 });
    expect(porTipo.video?.viramBase).toEqual([]);
    expect(porTipo.arte).toMatchObject({ motivo: 'vaga', base: 0, cota: 3 });
    expect(porTipo.arte?.viramBase.map((p) => p.id)).toEqual([arte1.id, arte2.id]);
  });

  it('cada cliente e cada mês contam separado', () => {
    const deA = extra('2026-09-02T10:00:00.000000Z');
    const deB = extra('2026-09-02T10:00:00.000000Z', { clientId: B });
    const deNov = extra('2026-09-02T10:00:00.000000Z', { referenceMonth: NOV });
    const grupos = planejar(
      [...base(1), deA, ...base(2, { clientId: B }), deB, deNov],
      [],
      [...cadastro(A, { arte: 1 }), ...cadastro(B, { arte: 3 })],
    );
    const de = (c: string, m: string) => grupos.find((g) => g.clientId === c && g.referenceMonth === m);
    expect(de(A, OUT)?.motivo).toBe('base-cheia');
    expect(de(B, OUT)?.viramBase.map((p) => p.id)).toEqual([deB.id]);
    expect(de(A, NOV)?.viramBase.map((p) => p.id)).toEqual([deNov.id]);
  });

  it('extra criado com o mês JÁ aberto não é candidato — pode ser o "Acrescentar extra" da ficha', () => {
    const abertura = '2026-10-01T09:00:00.000000Z';
    const antes = extra('2026-09-30T18:00:00.000000Z');
    const depois1 = extra('2026-10-02T10:00:00.000000Z');
    const depois2 = extra('2026-10-01T09:00:00.000001Z'); // um microssegundo depois
    const [g] = planejar([...base(1), depois1, antes, depois2], contrato(A, OUT, { arte: 4 }, abertura), []);
    expect(g?.viramBase.map((p) => p.id)).toEqual([antes.id]);
    expect(g?.extraDepoisDaAbertura.map((p) => p.id)).toEqual([depois2.id, depois1.id]);
    expect(g?.motivo).toBe('vaga');

    const [so] = planejar([extra('2026-10-02T10:00:00.000000Z')], contrato(A, OUT, { arte: 4 }, abertura), []);
    expect(so).toMatchObject({ motivo: 'extra-depois-da-abertura', cota: 4, base: 0 });
    expect(so?.viramBase).toEqual([]);
  });

  it('só o mês corrente e os seguintes; com `aPartirDe = null`, os passados entram', () => {
    const passado = extra('2026-08-20T10:00:00.000000Z', { referenceMonth: SET });
    const atual = extra('2026-09-20T10:00:00.000000Z');
    const pecas = [passado, atual];
    const cad = cadastro(A, { arte: 2 });
    expect(planejar(pecas, [], cad, OUT).map((g) => g.referenceMonth)).toEqual([OUT]);
    const todos = planejar(pecas, [], cad, null);
    expect(todos.map((g) => g.referenceMonth)).toEqual([SET, OUT]);
    expect(todos.flatMap((g) => g.viramBase.map((p) => p.id))).toEqual([passado.id, atual.id]);
  });

  it('é idempotente: depois de aplicar, a segunda conta não acha vaga', () => {
    const pecas = [...base(1), extra('2026-09-02T10:00:00.000000Z'), extra('2026-09-03T10:00:00.000000Z'), extra('2026-09-04T10:00:00.000000Z')];
    const cad = cadastro(A, { arte: 3 });
    const primeira = planejar(pecas, [], cad);
    const viram = new Set(primeira.flatMap((g) => g.viramBase.map((p) => p.id)));
    expect(viram.size).toBe(2);
    const depois = pecas.map((p) => (viram.has(p.id) ? { ...p, isExtra: false } : p));
    const segunda = planejar(depois, [], cad);
    expect(segunda.flatMap((g) => g.viramBase)).toEqual([]);
    expect(segunda[0]).toMatchObject({ motivo: 'base-cheia', base: 3, cota: 3 });
  });

  it('duas peças no mesmo instante: o id desempata, e a ordem não depende da leitura', () => {
    const mesmo = '2026-09-02T10:00:00.123456Z';
    const p1 = extra(mesmo);
    const p2 = extra(mesmo);
    const ida = planejar([p2, p1], [], cadastro(A, { arte: 1 }));
    const volta = planejar([p1, p2], [], cadastro(A, { arte: 1 }));
    expect(ida[0]?.viramBase.map((p) => p.id)).toEqual([p1.id]);
    expect(volta[0]?.viramBase.map((p) => p.id)).toEqual([p1.id]);
  });

  it('grupo sem extra não aparece', () => {
    expect(planejar(base(2), [], cadastro(A, { arte: 5 }))).toEqual([]);
  });
});

describe('mesCorrenteNaAgencia', () => {
  it('é o mês de São Paulo, não o de UTC', () => {
    // 31/10 às 22h em Brasília já é 01/11 em UTC.
    expect(mesCorrenteNaAgencia(new Date('2026-11-01T01:00:00Z'))).toBe('2026-10-01');
    expect(mesCorrenteNaAgencia(new Date('2026-11-01T03:00:00Z'))).toBe('2026-11-01');
    expect(mesCorrenteNaAgencia(new Date('2026-10-09T12:00:00Z'))).toBe('2026-10-01');
  });
});
