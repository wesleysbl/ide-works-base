import { describe, expect, it } from 'vitest';

import { type WeeklyPiece, deliveryStatusOf, diaNaAgencia } from '@/delivery/ultima-entrega';

/** 06/10/2026, meio-dia em São Paulo (UTC−3). */
const AGORA = new Date('2026-10-06T15:00:00Z');

/** Uma peça marcada para um dia, às 10h de São Paulo. */
const peca = (dia: string | null, isCompleted: boolean, isExtra = false): WeeklyPiece => ({
  scheduledAt: dia === null ? null : `${dia}T13:00:00Z`,
  isCompleted,
  isExtra,
});

describe('deliveryStatusOf — a regra de entrega pela Semanal', () => {
  it('nenhuma peça: sem entrega registrada, nada vencido, nada marcado', () => {
    expect(deliveryStatusOf([], AGORA)).toEqual({
      today: '2026-10-06',
      lastDeliveryOn: null,
      daysSinceLastDelivery: null,
      overdue: [],
      dueToday: 0,
      unscheduled: 0,
      nextScheduledOn: null,
    });
  });

  it('só peças futuras: nenhuma entrega, e a próxima é a mais perto', () => {
    const r = deliveryStatusOf([peca('2026-10-20', false), peca('2026-10-09', false)], AGORA);
    expect(r.lastDeliveryOn).toBeNull();
    expect(r.overdue).toEqual([]);
    expect(r.nextScheduledOn).toBe('2026-10-09');
  });

  it('entregue ontem: última entrega é ontem, há 1 dia', () => {
    const r = deliveryStatusOf([peca('2026-10-05', true)], AGORA);
    expect(r.lastDeliveryOn).toBe('2026-10-05');
    expect(r.daysSinceLastDelivery).toBe(1);
  });

  it('a última entrega é o dia MAIS RECENTE entre as entregas, não a ordem de chegada', () => {
    const r = deliveryStatusOf(
      [peca('2026-10-02', true), peca('2026-10-05', true), peca('2026-09-03', true)],
      AGORA,
    );
    expect(r.lastDeliveryOn).toBe('2026-10-05');
  });

  it('vencida anteontem: sem ✓ e com dia anterior a hoje', () => {
    const r = deliveryStatusOf([peca('2026-10-04', false)], AGORA);
    expect(r.overdue).toEqual(['2026-10-04']);
    expect(r.dueToday).toBe(0);
    expect(r.lastDeliveryOn).toBeNull();
  });

  it('as vencidas saem do dia mais antigo ao mais novo, uma por peça', () => {
    const r = deliveryStatusOf(
      [peca('2026-10-04', false), peca('2026-09-21', false), peca('2026-10-04', false)],
      AGORA,
    );
    expect(r.overdue).toEqual(['2026-09-21', '2026-10-04', '2026-10-04']);
  });

  it('vence hoje: sem ✓ marcada para hoje não é vencida', () => {
    const r = deliveryStatusOf([peca('2026-10-06', false)], AGORA);
    expect(r.dueToday).toBe(1);
    expect(r.overdue).toEqual([]);
  });

  it('marcada para hoje e já com ✓: é entrega de hoje, há 0 dias', () => {
    const r = deliveryStatusOf([peca('2026-10-06', true)], AGORA);
    expect(r.lastDeliveryOn).toBe('2026-10-06');
    expect(r.daysSinceLastDelivery).toBe(0);
    expect(r.dueToday).toBe(0);
  });

  it('concluída sem dia: não define a última entrega, conta em "sem dia"', () => {
    const r = deliveryStatusOf([peca(null, true), peca(null, false)], AGORA);
    expect(r.lastDeliveryOn).toBeNull();
    expect(r.unscheduled).toBe(2);
  });

  it('extra entregue conta como entrega', () => {
    const r = deliveryStatusOf([peca('2026-10-02', true), peca('2026-10-03', true, true)], AGORA);
    expect(r.lastDeliveryOn).toBe('2026-10-03');
  });

  it('adiantada (futura com ✓) não é entrega: aparece como a próxima marcada', () => {
    const r = deliveryStatusOf([peca('2026-10-01', true), peca('2026-10-09', true)], AGORA);
    expect(r.lastDeliveryOn).toBe('2026-10-01');
    expect(r.nextScheduledOn).toBe('2026-10-09');
  });

  it('virada do dia em São Paulo: peça às 23h de ontem (2h de hoje em UTC) é de ontem', () => {
    // 05/10 23h em SP = 06/10 02h UTC. Cortado em UTC, viraria "hoje".
    const r = deliveryStatusOf([{ scheduledAt: '2026-10-06T02:00:00Z', isCompleted: false }], AGORA);
    expect(r.overdue).toEqual(['2026-10-05']);
    expect(r.dueToday).toBe(0);
  });

  it('virada do dia em São Paulo: às 22h de hoje (1h de amanhã em UTC) ainda é hoje', () => {
    const noite = new Date('2026-10-07T01:00:00Z');
    const r = deliveryStatusOf([peca('2026-10-06', false), peca('2026-10-07', false)], noite);
    expect(r.today).toBe('2026-10-06');
    expect(r.dueToday).toBe(1);
    expect(r.nextScheduledOn).toBe('2026-10-07');
  });

  it('o caso da Hiper Center em 06/10: entrega em 05/10, uma vencida de 21/09, próxima 09/10', () => {
    const r = deliveryStatusOf(
      [
        peca('2026-10-05', true),
        peca('2026-09-21', false),
        peca('2026-10-09', false),
        peca('2026-10-16', false),
      ],
      AGORA,
    );
    expect(r).toMatchObject({
      lastDeliveryOn: '2026-10-05',
      overdue: ['2026-09-21'],
      nextScheduledOn: '2026-10-09',
    });
  });

  it('dias desde a última entrega atravessam o mês e o ano', () => {
    const r = deliveryStatusOf([peca('2025-12-31', true)], new Date('2026-01-02T15:00:00Z'));
    expect(r.daysSinceLastDelivery).toBe(2);
  });

  it('aceita o Date que o driver devolve', () => {
    const r = deliveryStatusOf([{ scheduledAt: new Date('2026-10-05T13:00:00Z'), isCompleted: true }], AGORA);
    expect(r.lastDeliveryOn).toBe('2026-10-05');
  });

  it('instante inválido lança, nomeando o valor, em vez de sumir com a peça', () => {
    expect(() => diaNaAgencia('ontem')).toThrow(/ontem/);
  });
});
