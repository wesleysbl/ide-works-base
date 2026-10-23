import { describe, expect, it } from 'vitest';

import { MAX_MESES_NO_INTERVALO, firstDayOfMonth, monthsInRange } from '@/server/panel';

describe('firstDayOfMonth', () => {
  it.each([
    ['2026-08-01', '2026-08-01'],
    ['2026-08-15', '2026-08-01'],
    ['2026-08-31', '2026-08-01'],
    ['2026-01-31', '2026-01-01'],
    ['2026-12-25', '2026-12-01'],
  ])('normaliza %s para %s', (entrada, esperado) => {
    expect(firstDayOfMonth(entrada)).toBe(esperado);
  });

  it('aceita data com hora e ignora a hora', () => {
    expect(firstDayOfMonth('2026-08-15T23:59:59Z')).toBe('2026-08-01');
  });

  it('preenche o mes com zero a esquerda', () => {
    expect(firstDayOfMonth('2026-03-10')).toBe('2026-03-01');
  });

  it('recusa entrada invalida em vez de devolver data torta', () => {
    expect(() => firstDayOfMonth('mes que vem')).toThrow(/inválido/);
  });

  it('a mensagem nomeia o que foi recebido', () => {
    expect(() => firstDayOfMonth('2026-13-99')).toThrow(/2026-13-99/);
  });
});

describe('monthsInRange', () => {
  it('intervalo dentro de um mes toca um mes so', () => {
    expect(monthsInRange('2026-08-01', '2026-08-20')).toEqual(['2026-08-01']);
  });

  it('um dia sozinho tambem toca um mes', () => {
    expect(monthsInRange('2026-08-13', '2026-08-13')).toEqual(['2026-08-01']);
  });

  it('intervalo que atravessa a virada toca os dois meses', () => {
    // O ponto: "28/08 a 03/09" nao e meio contrato de cada — sao os dois
    // contratos inteiros, porque contrato nao se corta ao meio.
    expect(monthsInRange('2026-08-28', '2026-09-03')).toEqual(['2026-08-01', '2026-09-01']);
  });

  it('atravessa a virada do ano', () => {
    expect(monthsInRange('2026-12-20', '2027-01-05')).toEqual(['2026-12-01', '2027-01-01']);
  });

  it('devolve os meses em ordem, sem buraco', () => {
    expect(monthsInRange('2026-01-15', '2026-05-02')).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
      '2026-05-01',
    ]);
  });

  it('recusa intervalo invertido em vez de devolver lista vazia', () => {
    // Lista vazia daria painel vazio, que a pessoa leria como "nao ha clientes".
    expect(() => monthsInRange('2026-09-01', '2026-08-01')).toThrow(/invertido/);
  });

  it('aceita exatamente o teto', () => {
    const r = monthsInRange('2026-01-01', '2027-12-31');
    expect(r).toHaveLength(MAX_MESES_NO_INTERVALO);
  });

  it('recusa acima do teto, dizendo qual e o limite', () => {
    expect(() => monthsInRange('2020-01-01', '2030-01-01')).toThrow(/24 meses/);
  });

  it('recusa data invalida', () => {
    expect(() => monthsInRange('ontem', '2026-08-01')).toThrow(/inválido/);
  });
});
