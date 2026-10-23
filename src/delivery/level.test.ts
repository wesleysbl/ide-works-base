import { describe, expect, it } from 'vitest';

import {
  CONTENT_WEIGHTS,
  UnknownContentType,
  calculateDeliveryLevel,
  type ContractItem,
  type DeliveredItem,
} from '@/delivery/level';

const feito = (contentType: string, isExtra = false): DeliveredItem => ({
  contentType,
  isExtra,
  isCompleted: true,
});
const pendente = (contentType: string, isExtra = false): DeliveredItem => ({
  contentType,
  isExtra,
  isCompleted: false,
});

/** Atalho: só o resultado mensurável, ou falha o teste. */
function nivel(contract: ContractItem[], delivered: DeliveredItem[]) {
  const r = calculateDeliveryLevel(contract, delivered);
  if (!r.measurable) throw new Error(`esperava mensurável, veio ${r.reason}`);
  return r;
}

describe('os pesos por esforço', () => {
  it('vídeo vale três vezes uma arte', () => {
    expect(CONTENT_WEIGHTS.video).toBe(3 * CONTENT_WEIGHTS.arte);
  });

  it('foto vale uma vez e meia', () => {
    expect(CONTENT_WEIGHTS.foto).toBe(1.5);
  });

  it('a ponderação muda o resultado — não é média simples', () => {
    // Contrato: 1 vídeo (3 pontos) + 3 artes (3 pontos) = 6 pontos.
    const contrato = [
      { contentType: 'video', quantity: 1 },
      { contentType: 'arte', quantity: 3 },
    ];
    // Entregar só o vídeo é metade dos pontos, mas 1 de 4 itens.
    expect(nivel(contrato, [feito('video')]).level).toBe(50);
    // Entregar as 3 artes também é metade dos pontos, com 3 de 4 itens.
    expect(nivel(contrato, [feito('arte'), feito('arte'), feito('arte')]).level).toBe(50);
  });
});

describe('caminho normal', () => {
  const contrato = [
    { contentType: 'video', quantity: 2 },
    { contentType: 'arte', quantity: 4 },
  ];

  it('contrato cumprido exatamente dá 100%', () => {
    const itens = [feito('video'), feito('video'), ...Array(4).fill(feito('arte'))];
    expect(nivel(contrato, itens).level).toBe(100);
  });

  it('nada entregue dá 0%', () => {
    expect(nivel(contrato, []).level).toBe(0);
  });

  it('item planejado e não feito não conta', () => {
    expect(nivel(contrato, [pendente('video'), pendente('arte')]).level).toBe(0);
  });

  it('a abertura por tipo bate com o total', () => {
    const r = nivel(contrato, [feito('video')]);
    const soma = r.breakdown.reduce((s, b) => s + b.deliveredPoints, 0);
    expect(soma).toBe(r.deliveredPoints);
  });
});

describe('a base é limitada a 100%, os extras não', () => {
  const contrato = [{ contentType: 'arte', quantity: 2 }];

  it('entregar mais do que o contratado sem marcar extra não passa de 100', () => {
    const r = nivel(contrato, [feito('arte'), feito('arte'), feito('arte'), feito('arte')]);
    expect(r.base).toBe(100);
    expect(r.level).toBe(100);
  });

  it('extras passam de 100', () => {
    const r = nivel(contrato, [feito('arte'), feito('arte'), feito('arte', true)]);
    expect(r.base).toBe(100);
    expect(r.bonus).toBe(50);
    expect(r.level).toBe(150);
  });

  it('extras não têm teto', () => {
    const extras = Array(10).fill(feito('arte', true));
    expect(nivel(contrato, [...extras]).bonus).toBe(500);
  });

  it('extra planejado e não feito não vira bônus', () => {
    const r = nivel(contrato, [feito('arte'), feito('arte'), pendente('arte', true)]);
    expect(r.level).toBe(100);
  });

  it('só extras, sem a base, soma bônus sobre base zero', () => {
    const r = nivel(contrato, [feito('arte', true), feito('arte', true)]);
    expect(r.base).toBe(0);
    expect(r.bonus).toBe(100);
    expect(r.level).toBe(100);
  });
});

describe('tipo entregue fora do contrato', () => {
  const contrato = [{ contentType: 'arte', quantity: 2 }];

  it('conta como bônus, porque não foi contratado', () => {
    const r = nivel(contrato, [feito('arte'), feito('arte'), feito('video')]);
    expect(r.base).toBe(100);
    expect(r.bonus).toBeGreaterThan(0);
  });

  it('aparece no resultado em vez de sumir no cálculo', () => {
    const r = nivel(contrato, [feito('video'), feito('foto')]);
    expect(r.deliveredOutsideContract).toBe(2);
  });

  it('quando tudo foi contratado, o número é zero', () => {
    const r = nivel(contrato, [feito('arte'), feito('arte', true)]);
    expect(r.deliveredOutsideContract).toBe(0);
  });
});

describe('o que não é mensurável não vira zero', () => {
  it('mês sem contrato diz que não foi aberto', () => {
    const r = calculateDeliveryLevel([], [feito('arte')]);
    expect(r.measurable).toBe(false);
    if (!r.measurable) {
      expect(r.reason).toBe('no_contract');
      expect(r.message).toContain('ainda não foi aberto');
    }
  });

  it('contrato com todas as cotas em zero também não é mensurável', () => {
    const r = calculateDeliveryLevel([{ contentType: 'arte', quantity: 0 }], []);
    expect(r.measurable).toBe(false);
    if (!r.measurable) expect(r.reason).toBe('empty_contract');
  });

  it('não divide por zero', () => {
    expect(() => calculateDeliveryLevel([{ contentType: 'arte', quantity: 0 }], [])).not.toThrow();
  });

  it('zero entregue COM contrato é 0% de verdade — e isso é diferente', () => {
    const r = calculateDeliveryLevel([{ contentType: 'arte', quantity: 2 }], []);
    expect(r.measurable).toBe(true);
    if (r.measurable) expect(r.level).toBe(0);
  });
});

/**
 * F17.57 — os três casos medidos em setembro de 2026, com nome e tudo.
 *
 * Os três chegam aqui com a MESMA lista congelada: vazia. Era por ela que a
 * função decidia, e por isso os três recebiam a frase do primeiro.
 */
describe('três motivos para não haver medida, três frases', () => {
  it('mês nunca aberto: diz que não foi aberto', () => {
    const r = calculateDeliveryLevel([], [], { monthOpened: false, hasContentContract: true });
    expect(r.measurable).toBe(false);
    if (!r.measurable) {
      expect(r.reason).toBe('no_contract');
      expect(r.message).toContain('ainda não foi aberto');
    }
  });

  it('mês ABERTO e sem item congelado NÃO diz que não foi aberto — o Hiper Center', () => {
    const r = calculateDeliveryLevel([], [], { monthOpened: true, hasContentContract: true });
    expect(r.measurable).toBe(false);
    if (!r.measurable) {
      expect(r.reason).toBe('empty_contract');
      expect(r.message).not.toContain('não foi aberto');
      expect(r.message).toContain('sem cota');
    }
  });

  it('cliente sem contrato de conteúdo diz isso, e não fala do mês — a Agência Ide', () => {
    const r = calculateDeliveryLevel([], [], { monthOpened: true, hasContentContract: false });
    expect(r.measurable).toBe(false);
    if (!r.measurable) {
      expect(r.reason).toBe('no_content_contract');
      expect(r.message).not.toContain('não foi aberto');
      expect(r.message).toContain('não tem contrato de conteúdo mensal');
    }
  });

  it('os dois casos de zero mostram frases DIFERENTES', () => {
    const zerado = calculateDeliveryLevel([], [], {
      monthOpened: true,
      hasContentContract: true,
    });
    const semContrato = calculateDeliveryLevel([], [], {
      monthOpened: true,
      hasContentContract: false,
    });
    expect(zerado.measurable).toBe(false);
    expect(semContrato.measurable).toBe(false);
    if (!zerado.measurable && !semContrato.measurable) {
      expect(zerado.message).not.toBe(semContrato.message);
      expect(zerado.reason).not.toBe(semContrato.reason);
    }
  });

  it('mês fechado ganha de "não contrata conteúdo" — senão a caixa se contradiz', () => {
    // Com o mês fechado a tela mostra o crachá `mês não aberto` e o botão
    // `Abrir o mês`. Dizer ali "este cliente não tem contrato de conteúdo
    // mensal" seria a mesma discordância que a F17.57 veio consertar.
    const r = calculateDeliveryLevel([], [], { monthOpened: false, hasContentContract: false });
    expect(r.measurable).toBe(false);
    if (!r.measurable) expect(r.reason).toBe('no_contract');
  });

  it('sem contexto, a recusa continua a de antes', () => {
    const r = calculateDeliveryLevel([], []);
    expect(r.measurable).toBe(false);
    if (!r.measurable) expect(r.reason).toBe('no_contract');
  });

  it('linha congelada com quantidade zero nunca vira "não foi aberto"', () => {
    // Há item congelado, logo alguém abriu o mês — mesmo sem o chamador dizer.
    const r = calculateDeliveryLevel([{ contentType: 'arte', quantity: 0 }], []);
    expect(r.measurable).toBe(false);
    if (!r.measurable) expect(r.reason).toBe('empty_contract');
  });
});

describe('falha alto em tipo desconhecido', () => {
  it.each([
    ['grafia do calendário do legado', 'Video'],
    ['plural do legado', 'videos'],
    ['tipo novo', 'reels'],
    ['vazio', ''],
  ])('recusa %s', (_nome, tipo) => {
    expect(() => calculateDeliveryLevel([{ contentType: tipo, quantity: 1 }], [])).toThrow(
      UnknownContentType,
    );
  });

  it('a mensagem nomeia o valor recebido e lista os válidos', () => {
    try {
      calculateDeliveryLevel([{ contentType: 'Video', quantity: 1 }], []);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain('"Video"');
      expect((e as Error).message).toContain('video, arte, foto, ads');
    }
  });

  it('explica por que recusa em vez de assumir peso 1', () => {
    expect(() => calculateDeliveryLevel([{ contentType: 'x', quantity: 1 }], [])).toThrow(
      /peso 1/,
    );
  });

  it('recusa também no item entregue, não só no contrato', () => {
    expect(() =>
      calculateDeliveryLevel([{ contentType: 'arte', quantity: 1 }], [feito('Arte')]),
    ).toThrow(UnknownContentType);
  });
});

describe('o número é reproduzível', () => {
  it('o mesmo par contrato/itens dá sempre o mesmo resultado', () => {
    const contrato = [
      { contentType: 'video', quantity: 3 },
      { contentType: 'foto', quantity: 2 },
    ];
    const itens = [feito('video'), feito('foto'), feito('arte', true)];
    const a = calculateDeliveryLevel(contrato, itens);
    const b = calculateDeliveryLevel(contrato, itens);
    expect(a).toEqual(b);
  });

  it('carrega a versão da fórmula, para o número ser rastreável', () => {
    const r = calculateDeliveryLevel([{ contentType: 'arte', quantity: 1 }], []);
    expect(r.formulaVersion).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it('a ordem dos itens não muda o resultado', () => {
    const contrato = [{ contentType: 'arte', quantity: 2 }];
    const a = nivel(contrato, [feito('arte'), feito('arte', true)]);
    const b = nivel(contrato, [feito('arte', true), feito('arte')]);
    expect(a.level).toBe(b.level);
  });
});
