import { describe, expect, it } from 'vitest';

import { dueState, today } from '@/board/board';
import { DIAS_EM_BREVE, lerPrazo } from '@/board/prazo';

/**
 * Os limites de `lerPrazo` — verificação da F06B. Os casos do meio já estão em
 * `tela-do-trabalho.test.ts`; aqui ficam as bordas: virada de mês e de ano,
 * perto da meia-noite, o que o banco pode mandar que não é data pura, e a
 * concordância com `dueState`, que é quem pinta a mesma tarefa na ficha.
 */
const ler = (dueOn: string | null, hoje: { year: number; month: number; day: number }, completedAt: string | null = null) =>
  lerPrazo({ dueOn, completedAt }, hoje);

describe('lerPrazo — bordas do calendário', () => {
  it('virada de mês: 30/09 → 01/10 é Amanhã; 01/10 visto em 30/09 não é atrasada', () => {
    const hoje = { year: 2026, month: 9, day: 30 };
    expect(ler('2026-10-01', hoje)?.estado).toBe('amanha');
    expect(ler('2026-09-29', hoje)).toMatchObject({ estado: 'atrasada', curto: 'Atrasada · 29/09' });
  });

  it('virada de ano: 31/12 → 01/01 é Amanhã e a data curta leva o ano quando não é o de hoje', () => {
    const hoje = { year: 2026, month: 12, day: 31 };
    expect(ler('2027-01-01', hoje)).toEqual({ estado: 'amanha', curto: 'Amanhã', completo: 'Vence amanhã, 01/01/2027' });
    expect(ler('2027-01-05', hoje)).toMatchObject({ estado: 'embreve', curto: '05/01/2027' });
    expect(ler('2026-12-30', hoje)?.curto).toBe('Atrasada · 30/12');
  });

  it('fevereiro de ano bissexto: 28/02 → 29/02 é Amanhã; 29/02 → 01/03 também', () => {
    expect(ler('2028-02-29', { year: 2028, month: 2, day: 28 })?.estado).toBe('amanha');
    expect(ler('2028-03-01', { year: 2028, month: 2, day: 29 })?.estado).toBe('amanha');
  });

  it(`"em breve" vai de 2 a ${DIAS_EM_BREVE} dias, atravessando o mês`, () => {
    const hoje = { year: 2026, month: 9, day: 28 };
    expect(ler('2026-09-30', hoje)?.estado).toBe('embreve');
    expect(ler('2026-10-04', hoje)?.estado).toBe('embreve');
    expect(ler('2026-10-05', hoje)?.estado).toBe('futura');
  });
});

describe('lerPrazo — perto da meia-noite o dia é o do relógio de parede', () => {
  it('23:59 e 00:00 locais caem em dias diferentes, sem passar por UTC', () => {
    const quase = today(new Date(2026, 8, 28, 23, 59, 59));
    const virou = today(new Date(2026, 8, 29, 0, 0, 0));
    expect(ler('2026-09-28', quase)?.estado).toBe('hoje');
    expect(ler('2026-09-28', virou)?.estado).toBe('atrasada');
    expect(ler('2026-09-29', quase)?.estado).toBe('amanha');
    expect(ler('2026-09-29', virou)?.estado).toBe('hoje');
  });
});

describe('lerPrazo — o que chega do banco', () => {
  const hoje = { year: 2026, month: 9, day: 28 };

  it('data pura `aaaa-mm-dd` (o servidor lê `due_on::text`) é a forma lida', () => {
    expect(ler('2026-09-28', hoje)?.estado).toBe('hoje');
    expect(ler(' 2026-09-28 ', hoje)?.estado).toBe('hoje');
  });

  it('timestamp não vira dia por fuso nenhum: é ilegível e diz o valor, em vez de adivinhar', () => {
    const r = ler('2026-09-28T02:00:00.000Z', hoje);
    expect(r?.estado).toBe('ilegivel');
    expect(r?.completo).toContain('2026-09-28T02:00:00.000Z');
  });

  it('concluída nunca vira atrasada, hoje ou amanhã — nem com prazo vencido há meses', () => {
    for (const dueOn of ['2026-01-01', '2026-09-27', '2026-09-28', '2026-09-29']) {
      const r = ler(dueOn, hoje, '2026-09-28T12:00:00Z');
      expect(r?.estado).toBe('concluida');
      expect(r?.curto).not.toMatch(/Atrasada|Hoje|Amanhã/);
    }
  });
});

describe('lerPrazo concorda com dueState', () => {
  it('atrasada/hoje/concluída/ilegível são as mesmas; amanhã, em breve e futura são o "futura" de dueState', () => {
    const hoje = { year: 2026, month: 9, day: 28 };
    const casos: [string | null, string | null][] = [
      ['2025-12-31', null],
      ['2026-09-27', null],
      ['2026-09-28', null],
      ['2026-09-29', null],
      ['2026-10-02', null],
      ['2027-03-01', null],
      ['2026-09-01', '2026-09-02T00:00:00Z'],
      ['lixo', null],
    ];
    for (const [dueOn, completedAt] of casos) {
      const base = dueState({ dueOn, completedAt }, hoje);
      const estado = lerPrazo({ dueOn, completedAt }, hoje)?.estado;
      const esperado = base === 'futura' ? ['amanha', 'embreve', 'futura'] : [base];
      expect(esperado).toContain(estado);
    }
  });
});
