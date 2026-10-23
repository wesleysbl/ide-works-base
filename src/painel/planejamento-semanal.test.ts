import { describe, expect, it } from 'vitest';

import { semanasDoMes } from '@/delivery/semanas';
import {
  type PecaDoPlanejamento,
  type PlanejamentoDoCliente,
  diaDaPeca,
  diasUteis,
  dividirMeta,
  ordenarPorSemana,
  planejarSemanas,
  sinalDaPeca,
} from '@/painel/planejamento-semanal';

let seq = 0;
const peca = (over: Partial<PecaDoPlanejamento> = {}): PecaDoPlanejamento => ({
  id: `p${++seq}`,
  contentType: 'arte',
  scheduledAt: null,
  completedAt: null,
  isExtra: false,
  title: null,
  ...over,
});
/** Agendada ao meio-dia UTC, como a grade grava (`meioDiaDoDia`). */
const em = (dia: string, over: Partial<PecaDoPlanejamento> = {}) => peca({ scheduledAt: `${dia}T12:00:00Z`, ...over });
const feita = (dia: string, over: Partial<PecaDoPlanejamento> = {}) =>
  em(dia, { completedAt: `${dia}T15:00:00Z`, ...over });

/*
 * Outubro/2026: começa numa quinta. Semanas 01–04 (2 dias úteis), 05–11,
 * 12–18, 19–25, 26–31 (5 cada) — 22 dias úteis.
 * Fevereiro/2026: dia 1 é domingo, a ponta é absorvida; 4 semanas de 5 úteis.
 * Agosto/2026: começa num sábado e termina numa segunda — as duas pontas curtas.
 */
const MESES = ['2026-10', '2026-02', '2026-08'];

describe('dividirMeta', () => {
  it('confere os meses de teste', () => {
    expect(semanasDoMes('2026-10').map((s) => diasUteis(s.de, s.ate))).toEqual([2, 5, 5, 5, 5]);
    expect(semanasDoMes('2026-02').map((s) => diasUteis(s.de, s.ate))).toEqual([5, 5, 5, 5]);
    const agosto = semanasDoMes('2026-08');
    expect(agosto[0].de).toBe('2026-08-01');
    expect(agosto[0].dias).toBeGreaterThan(7);
    expect(agosto[agosto.length - 1].dias).toBeGreaterThan(7);
    expect(agosto.map((s) => diasUteis(s.de, s.ate))).toEqual([5, 5, 5, 6]);
  });

  for (const mes of MESES) {
    for (const cota of [0, 1, 2, 8, 30]) {
      it(`soma das metas = cota (${mes}, cota ${cota})`, () => {
        const metas = dividirMeta(cota, semanasDoMes(mes));
        expect(metas.reduce((a, b) => a + b, 0)).toBe(cota);
        expect(metas.every((m) => Number.isInteger(m) && m >= 0)).toBe(true);
      });
    }
  }

  it('semana com 2 dias úteis recebe menos que semana com 5', () => {
    const metas = dividirMeta(8, semanasDoMes('2026-10'));
    expect(metas).toEqual([0, 2, 2, 2, 2]);
    expect(metas[0]).toBeLessThan(metas[1]);
    expect(dividirMeta(30, semanasDoMes('2026-10'))).toEqual([2, 7, 7, 7, 7]);
  });

  it('o resto empatado vai para a semana mais cedo', () => {
    expect(dividirMeta(2, semanasDoMes('2026-02'))).toEqual([1, 1, 0, 0]);
    expect(dividirMeta(1, semanasDoMes('2026-02'))).toEqual([1, 0, 0, 0]);
  });
});

describe('sinalDaPeca', () => {
  const hoje = '2026-10-14';
  it('concluída → feita, mesmo com o dia passado', () => {
    expect(sinalDaPeca(feita('2026-10-05'), hoje)).toBe('feita');
  });
  it('não concluída com dia hoje ou adiante → agendada', () => {
    expect(sinalDaPeca(em('2026-10-14'), hoje)).toBe('agendada');
    expect(sinalDaPeca(em('2026-10-20'), hoje)).toBe('agendada');
  });
  it('não concluída com o dia passado → atrasada', () => {
    expect(sinalDaPeca(em('2026-10-13'), hoje)).toBe('atrasada');
  });
  it('sem dia não tem sinal', () => {
    expect(sinalDaPeca(peca(), hoje)).toBeNull();
  });
});

describe('planejarSemanas — estados com hoje fixo (quarta, 14/10/2026, semana 3)', () => {
  const hoje = '2026-10-14';
  const plano = (pecas: PecaDoPlanejamento[], cota = { arte: 8 }) =>
    planejarSemanas({ mes: '2026-10-01', cota, pecas, hoje });
  const arte = (p: PlanejamentoDoCliente) => p.tipos.find((t) => t.tipo === 'arte')!;

  it('meta 0 sem peça → neutra; semana adiante → futura', () => {
    const p = plano([]);
    const c = arte(p).celulas;
    expect(c.map((x) => x.meta)).toEqual([0, 2, 2, 2, 2]);
    expect(c[0].estado).toBe('neutra');
    expect(c[3].estado).toBe('futura');
    expect(c[4].estado).toBe('futura');
  });

  it('meta 0 com peça não concluída (agendada ou atrasada) → neutra, não bateu', () => {
    // Semana 1 (01–04/10) tem meta 0 com cota 8.
    expect(arte(plano([em('2026-10-02')])).celulas[0].estado).toBe('neutra');
    expect(arte(plano([feita('2026-10-02')])).celulas[0].estado).toBe('bateu');
  });

  it('semana passada: feito ≥ meta → bateu; feito < meta → abaixo', () => {
    expect(arte(plano([feita('2026-10-06'), feita('2026-10-07')])).celulas[1].estado).toBe('bateu');
    const abaixo = plano([feita('2026-10-06'), em('2026-10-07')]);
    expect(arte(abaixo).celulas[1].estado).toBe('abaixo');
    expect(abaixo.abaixo).toBe(true);
    expect(abaixo.emRisco).toBe(true); // a semana 3 também está sem agendamento
  });

  it('semana corrente sem agendamento suficiente → risco', () => {
    const p = plano([em('2026-10-15')]);
    expect(arte(p).celulas[2].estado).toBe('risco');
    expect(p.emRisco).toBe(true);
  });

  it('peça atrasada não cobre a meta da semana corrente', () => {
    expect(arte(plano([em('2026-10-13'), em('2026-10-15')])).celulas[2].estado).toBe('risco');
  });

  it('semana corrente coberta e com dias → andamento', () => {
    expect(arte(plano([em('2026-10-15'), em('2026-10-16')])).celulas[2].estado).toBe('andamento');
  });

  it('semana corrente coberta mas sem dias úteis para o que falta → risco', () => {
    // Cota 30 → meta 7 na semana 3; sobram 3 dias úteis (14, 15, 16).
    const sete = Array.from({ length: 7 }, (_, i) => em(i < 4 ? '2026-10-15' : '2026-10-16'));
    const p = plano(sete, { arte: 30 });
    expect(arte(p).celulas[2].meta).toBe(7);
    expect(arte(p).celulas[2].estado).toBe('risco');
  });

  it('semana corrente batida → bateu', () => {
    expect(arte(plano([feita('2026-10-12'), feita('2026-10-13')])).celulas[2].estado).toBe('bateu');
  });

  it('mês passado não tem risco, só bateu/abaixo', () => {
    const p = planejarSemanas({ mes: '2026-09', cota: { arte: 4 }, pecas: [], hoje });
    expect(p.emRisco).toBe(false);
    expect(p.abaixo).toBe(true);
  });
});

describe('planejarSemanas — peças', () => {
  const hoje = '2026-10-14';

  it('sinais na semana em que a peça está agendada, na ordem do dia', () => {
    const p = planejarSemanas({
      mes: '2026-10',
      cota: { arte: 8 },
      pecas: [em('2026-10-16', { title: 'B' }), feita('2026-10-12', { title: 'A' }), em('2026-10-13')],
      hoje,
    });
    const c = p.tipos[0].celulas[2];
    expect(c.sinais.map((s) => s.sinal)).toEqual(['feita', 'atrasada', 'agendada']);
    expect(c.sinais[0].title).toBe('A');
    expect(c.feito).toBe(1);
  });

  it('extra aparece e conta em feito, mas não altera a meta', () => {
    const sem = planejarSemanas({ mes: '2026-10', cota: { arte: 8 }, pecas: [], hoje });
    const com = planejarSemanas({
      mes: '2026-10',
      cota: { arte: 8 },
      pecas: [feita('2026-10-06', { isExtra: true }), feita('2026-10-07', { isExtra: true }), feita('2026-10-08', { isExtra: true })],
      hoje,
    });
    expect(com.tipos[0].celulas.map((c) => c.meta)).toEqual(sem.tipos[0].celulas.map((c) => c.meta));
    expect(com.tipos[0].celulas[1].feito).toBe(3);
    expect(com.tipos[0].celulas[1].sinais.every((s) => s.isExtra)).toBe(true);
    expect(com.tipos[0].mes.feito).toBe(3);
  });

  it('peça sem dia fica fora das semanas e é contada à parte', () => {
    const p = planejarSemanas({
      mes: '2026-10',
      cota: { arte: 8 },
      pecas: [peca(), peca({ completedAt: '2026-10-02T10:00:00Z' }), em('2026-11-02')],
      hoje,
    });
    const arte = p.tipos[0];
    expect(arte.celulas.every((c) => c.sinais.length === 0)).toBe(true);
    expect(arte.mes.semDia).toBe(2);
    expect(arte.mes.foraDoMes).toBe(1);
    expect(arte.mes.feito).toBe(1);
  });

  it('peça de tipo sem cota vira sublinha com meta 0', () => {
    const p = planejarSemanas({ mes: '2026-10', cota: { video: 4 }, pecas: [em('2026-10-20')], hoje });
    expect(p.tipos.map((t) => t.tipo)).toEqual(['video', 'arte']);
    const arte = p.tipos[1];
    expect(arte.semCotaDoTipo).toBe(true);
    expect(arte.celulas.every((c) => c.meta === 0)).toBe(true);
    expect(arte.celulas[3].sinais).toHaveLength(1);
  });

  it('sem cota de nenhum tipo → semCota, sem risco nem abaixo', () => {
    const p = planejarSemanas({ mes: '2026-10', cota: { video: 0 }, pecas: [em('2026-10-13')], hoje });
    expect(p.semCota).toBe(true);
    expect(p.emRisco).toBe(false);
    expect(p.abaixo).toBe(false);
    expect(planejarSemanas({ mes: '2026-10', cota: {}, pecas: [], hoje }).tipos).toEqual([]);
  });

  it('tipo desconhecido é ignorado', () => {
    const p = planejarSemanas({ mes: '2026-10', cota: { arte: 1 }, pecas: [em('2026-10-20', { contentType: 'reels' })], hoje });
    expect(p.tipos.map((t) => t.tipo)).toEqual(['arte']);
  });
});

describe('ordenarPorSemana', () => {
  const hoje = '2026-10-14';
  const cliente = (name: string, pecas: PecaDoPlanejamento[], cota = { arte: 8 }) => ({
    name,
    planejamento: planejarSemanas({ mes: '2026-10', cota, pecas, hoje }),
  });

  it('risco, abaixo, resto — depois nome em pt-BR', () => {
    const ok = [feita('2026-10-06'), feita('2026-10-07'), em('2026-10-15'), em('2026-10-16')];
    const soAbaixo = [feita('2026-10-06'), em('2026-10-15'), em('2026-10-16')];
    const r = ordenarPorSemana([
      cliente('Ébano', ok),
      cliente('Zeta', soAbaixo),
      cliente('Bravo', []),
      cliente('Árvore', ok),
      cliente('Alfa', []),
    ]);
    expect(r.map((c) => c.name)).toEqual(['Alfa', 'Bravo', 'Zeta', 'Árvore', 'Ébano']);
  });
});

/*
 * O DIA DA PEÇA É O DE SÃO PAULO — revisão do planejamento (09/10/2026).
 *
 * `scheduled_at` é um instante e o servidor o entrega em UTC. A grade grava ao
 * meio-dia, e aí o dia de UTC e o de São Paulo coincidem; mas uma peça marcada
 * às 22h (01h UTC do dia seguinte) por outra porta caía na célula do dia
 * errado — e, no fim do mês, no mês errado —, enquanto o Calendário e a "última
 * entrega" a mostravam no dia certo. O recorte é o do Calendário: o dia civil
 * da agência.
 */
describe('o dia da peça é o de São Paulo, e não o de UTC', () => {
  // 22:00 de 30/09 em São Paulo é 01:00 de 01/10 em UTC.
  const as22hDe30Set = '2026-10-01T01:00:00.000Z';

  it('diaDaPeca devolve o dia de São Paulo', () => {
    expect(diaDaPeca(peca({ scheduledAt: as22hDe30Set }))).toBe('2026-09-30');
    // A convenção da grade (meio-dia UTC) e a meia-noite do legado (03h UTC) seguem no próprio dia.
    expect(diaDaPeca(peca({ scheduledAt: '2026-10-01T12:00:00Z' }))).toBe('2026-10-01');
    expect(diaDaPeca(peca({ scheduledAt: '2026-10-01T03:00:00.000Z' }))).toBe('2026-10-01');
    expect(diaDaPeca(peca({ scheduledAt: null }))).toBeNull();
  });

  it('a peça das 22h do último dia do mês fica na última semana do mês, e não "fora do mês"', () => {
    const p = planejarSemanas({ mes: '2026-09', cota: { arte: 4 }, pecas: [peca({ scheduledAt: as22hDe30Set })], hoje: '2026-09-10' });
    const arte = p.tipos[0];
    expect(arte.mes.foraDoMes).toBe(0);
    const ultima = arte.celulas[arte.celulas.length - 1];
    expect(ultima.sinais.map((s) => s.dia)).toEqual(['2026-09-30']);
  });

  it('a mesma peça não entra na primeira semana do mês seguinte', () => {
    const p = planejarSemanas({ mes: '2026-10', cota: { arte: 4 }, pecas: [peca({ scheduledAt: as22hDe30Set })], hoje: '2026-10-05' });
    const arte = p.tipos[0];
    expect(arte.celulas.every((c) => c.sinais.length === 0)).toBe(true);
    expect(arte.mes.foraDoMes).toBe(1);
  });

  it('o "atrasada" vira quando o dia de São Paulo passa, e não o de UTC', () => {
    // 22h de 14/10 em São Paulo. Em 15/10 (São Paulo) ela já passou do dia.
    const as22hDe14 = peca({ scheduledAt: '2026-10-15T01:00:00.000Z' });
    expect(sinalDaPeca(as22hDe14, '2026-10-15')).toBe('atrasada');
    expect(sinalDaPeca(as22hDe14, '2026-10-14')).toBe('agendada');
  });
});
