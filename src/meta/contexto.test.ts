/**
 * O contexto dos números da área Meta — F14.
 *
 * Protege o que a tela afirma ANTES do número: o período (do endereço ou o
 * padrão), quantos dias ele tem, quantos têm dado — e que link velho ou
 * digitado à mão não quebra a leitura.
 */

import { describe, expect, it } from 'vitest';

import {
  coberturaDoPeriodo,
  dias,
  janelaPadrao,
  periodoDoEndereco,
  rotuloDoPeriodo,
  tamanhoDoPeriodo,
} from '@/meta/contexto';

const p = (q: string) => new URLSearchParams(q);

describe('periodoDoEndereco', () => {
  it('lê de e ate válidos', () => {
    expect(periodoDoEndereco(p('de=2026-09-01&ate=2026-09-07'))).toEqual({ de: '2026-09-01', ate: '2026-09-07' });
  });
  it('sem os dois, não há período pedido', () => {
    expect(periodoDoEndereco(p(''))).toBeNull();
    expect(periodoDoEndereco(p('de=2026-09-01'))).toBeNull();
  });
  it('data malformada ou intervalo invertido vira a janela padrão (null), sem erro', () => {
    expect(periodoDoEndereco(p('de=ontem&ate=2026-09-07'))).toBeNull();
    expect(periodoDoEndereco(p('de=2026-09-08&ate=2026-09-07'))).toBeNull();
  });
});

describe('janelaPadrao', () => {
  it('são 28 dias contando hoje — a janela da coleta, igual à de antes nas duas telas', () => {
    const j = janelaPadrao(new Date('2026-09-29T15:00:00Z'));
    expect(j).toEqual({ de: '2026-09-02', ate: '2026-09-29' });
    expect(tamanhoDoPeriodo(j)).toBe(28);
  });

  it('o "hoje" é o de São Paulo: às 22h30 de 28/09 a janela termina em 28/09, e não em 29/09', () => {
    // 01h30 UTC de 29/09 = 22h30 de 28/09 em São Paulo. O seletor de período
    // já mede no fuso da agência; a janela padrão terminava no dia seguinte.
    const j = janelaPadrao(new Date('2026-09-29T01:30:00Z'));
    expect(j).toEqual({ de: '2026-09-01', ate: '2026-09-28' });
    expect(tamanhoDoPeriodo(j)).toBe(28);
  });
});

describe('como o período se escreve', () => {
  it('mesmo ano: o ano uma vez', () => {
    expect(rotuloDoPeriodo({ de: '2026-09-02', ate: '2026-09-29' })).toBe('02/09 – 29/09/2026');
  });
  it('anos diferentes: os dois anos', () => {
    expect(rotuloDoPeriodo({ de: '2025-12-20', ate: '2026-01-10' })).toBe('20/12/2025 – 10/01/2026');
  });
  it('um dia só', () => {
    expect(rotuloDoPeriodo({ de: '2026-09-02', ate: '2026-09-02' })).toBe('02/09/2026');
  });
  it('plural escrito, não "dia(s)"', () => {
    expect(dias(1)).toBe('1 dia');
    expect(dias(28)).toBe('28 dias');
  });
});

describe('coberturaDoPeriodo', () => {
  const periodo = { de: '2026-09-01', ate: '2026-09-05' };
  it('conta dias distintos com linha, dentro do período', () => {
    const linhas = [{ day: '2026-09-01' }, { day: '2026-09-01' }, { day: '2026-09-03' }, { day: '2026-08-31' }];
    expect(coberturaDoPeriodo(linhas, periodo)).toEqual({ comDado: 2, total: 5 });
  });
  it('sem linha nenhuma: zero dias com dado, e o total continua o do período', () => {
    expect(coberturaDoPeriodo([], periodo)).toEqual({ comDado: 0, total: 5 });
  });
});
