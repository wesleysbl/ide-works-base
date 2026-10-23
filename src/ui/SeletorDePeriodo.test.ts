import { describe, expect, it } from 'vitest';

/**
 * As contas de calendario, testadas sem tela.
 *
 * Elas sao a parte que erra em silencio: virada de mes, ano bissexto e o dia
 * que muda por causa de fuso. A aparencia a gente ve; a aritmetica, nao.
 */

const iso = (a: number, m: number, d: number) =>
  `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const diasNoMes = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate();
const primeiroDiaSemana = (a: number, m: number) => new Date(Date.UTC(a, m - 1, 1)).getUTCDay();
function somarDias(data: string, dias: number) {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

describe('quantos dias tem o mes', () => {
  it.each([
    [2026, 1, 31], [2026, 2, 28], [2026, 4, 30], [2026, 8, 31], [2026, 12, 31],
  ])('%i-%i tem %i dias', (a, m, esperado) => {
    expect(diasNoMes(a, m)).toBe(esperado);
  });

  it('fevereiro de ano bissexto tem 29', () => {
    expect(diasNoMes(2028, 2)).toBe(29);
  });

  it('e ano divisivel por 100 mas nao por 400 NAO e bissexto', () => {
    expect(diasNoMes(2100, 2)).toBe(28);
  });
});

describe('em que dia da semana o mes comeca', () => {
  it('1 de agosto de 2026 e sabado', () => {
    // A referencia mostra o dia 1 sozinho na ultima coluna: sabado.
    expect(primeiroDiaSemana(2026, 8)).toBe(6);
  });

  it('domingo e zero, para a grade comecar em D', () => {
    expect(primeiroDiaSemana(2026, 11)).toBe(0);
  });
});

describe('somar dias atravessa viradas', () => {
  it.each([
    ['2026-08-20', -6, '2026-08-14'],
    ['2026-08-01', -1, '2026-07-31'],
    ['2026-01-01', -1, '2025-12-31'],
    ['2028-03-01', -1, '2028-02-29'],
    ['2026-12-31', 1, '2027-01-01'],
  ])('%s %i dias = %s', (de, n, esperado) => {
    expect(somarDias(de, n)).toBe(esperado);
  });

  it('o atalho de 7 dias cobre 7 dias, nao 8', () => {
    const fim = '2026-08-20';
    expect(somarDias(fim, -(7 - 1))).toBe('2026-08-14');
  });
});

describe('a data nunca vira objeto com hora', () => {
  it('o primeiro dia do mes continua sendo o dia 1', () => {
    // Montar com `new Date(2026, 7, 1)` e formatar em UTC devolveria dia 31 de
    // julho em qualquer fuso a oeste de Greenwich — o Brasil inteiro.
    expect(iso(2026, 8, 1)).toBe('2026-08-01');
  });
});
