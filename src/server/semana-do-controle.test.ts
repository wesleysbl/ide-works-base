import { describe, expect, it } from 'vitest';

import {
  diaDeSaoPaulo,
  diasDaSemana,
  domingoDaSemana,
  ehDiaValido,
  mesesDaSemana,
  metaDaSemana,
  segundaDaSemana,
  semanaDoInstante,
  semanaVizinha,
} from '@/server/semana-do-controle';

describe('F40 — a semana (segunda a domingo, São Paulo)', () => {
  it('é identificada pela data da segunda', () => {
    expect(segundaDaSemana('2026-10-05')).toBe('2026-10-05'); // segunda
    expect(segundaDaSemana('2026-10-07')).toBe('2026-10-05'); // quarta
    expect(segundaDaSemana('2026-10-11')).toBe('2026-10-05'); // domingo é da semana que termina
    expect(segundaDaSemana('2026-10-12')).toBe('2026-10-12'); // segunda seguinte
    expect(domingoDaSemana('2026-10-05')).toBe('2026-10-11');
  });

  it('a virada do domingo para a segunda vale no fuso de São Paulo, não no UTC', () => {
    // 02:00Z de 12/10 ainda é domingo 23:00 em São Paulo.
    expect(diaDeSaoPaulo(new Date('2026-10-12T02:00:00Z'))).toBe('2026-10-11');
    expect(semanaDoInstante(new Date('2026-10-12T02:00:00Z'))).toBe('2026-10-05');
    // 03:00Z é a segunda 00:00 de São Paulo.
    expect(semanaDoInstante(new Date('2026-10-12T03:00:00Z'))).toBe('2026-10-12');
  });

  it('a semana que cruza setembro e outubro de 2026', () => {
    expect(segundaDaSemana('2026-10-02')).toBe('2026-09-28');
    expect(diasDaSemana('2026-09-28')).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    ]);
    expect(mesesDaSemana('2026-09-28')).toEqual(['2026-09-01', '2026-10-01']);
    expect(mesesDaSemana('2026-10-05')).toEqual(['2026-10-01']);
  });

  it('navega para a vizinha', () => {
    expect(semanaVizinha('2026-10-05', 1)).toBe('2026-10-12');
    expect(semanaVizinha('2026-10-05', -1)).toBe('2026-09-28');
  });

  it('valida a data', () => {
    expect(ehDiaValido('2026-10-05')).toBe(true);
    expect(ehDiaValido('2026-02-30')).toBe(false);
    expect(ehDiaValido('05/10/2026')).toBe(false);
    expect(ehDiaValido(undefined)).toBe(false);
  });
});

describe('F40 — a meta da semana', () => {
  const mesmaCota = (c: Record<string, number>) => () => c;

  it('semana dentro de um mês: é a célula da aba Semana do Planejamento', () => {
    // 4 vídeos em outubro/2026: as células (1–4, 5–11, 12–18, 19–25, 26–31) ficam 0,1,1,1,1.
    expect(metaDaSemana('2026-10-05', mesmaCota({ video: 4 }))).toEqual({ video: 1 });
    expect(metaDaSemana('2026-10-12', mesmaCota({ video: 4 }))).toEqual({ video: 1 });
  });

  it('semana que cruza meses: cada dia usa a cota do SEU mês', () => {
    // 22 vídeos: 1 por dia útil em setembro e em outubro. 28–30/09 (3) + 01–02/10 (2).
    expect(metaDaSemana('2026-09-28', mesmaCota({ video: 22 }))).toEqual({ video: 5 });
    // Cota só em setembro: a parte de outubro é zero.
    expect(metaDaSemana('2026-09-28', (mes) => (mes === '2026-09-01' ? { video: 22 } : {}))).toEqual({ video: 3 });
    // Cota só em outubro: a de setembro é zero.
    expect(metaDaSemana('2026-09-28', (mes) => (mes === '2026-10-01' ? { video: 22 } : {}))).toEqual({ video: 2 });
  });

  it('célula do Planejamento que atravessa a borda da semana reparte pelos dias', () => {
    // Setembro/2026: a última célula é 21–30 (28–30 absorvidos). 22 vídeos → 8 nela, 1 por dia útil.
    expect(metaDaSemana('2026-09-21', mesmaCota({ video: 22 }))).toEqual({ video: 5 });
  });

  it('cliente sem cota: nenhum tipo tem meta', () => {
    expect(metaDaSemana('2026-10-05', mesmaCota({}))).toEqual({});
  });

  it('meta só para vídeo, arte e foto', () => {
    const meta = metaDaSemana('2026-10-05', mesmaCota({ video: 22, arte: 22, foto: 22, ads: 22 } as never));
    expect(Object.keys(meta).sort()).toEqual(['arte', 'foto', 'video']);
  });

  it('a soma das semanas do mês é a cota', () => {
    let soma = 0;
    for (let s = '2026-09-28'; s <= '2026-10-26'; s = semanaVizinha(s, 1)) {
      // Só as semanas inteiramente em outubro, mais a de virada tratada pela parte de outubro.
      soma += metaDaSemana(s, (mes) => (mes === '2026-10-01' ? { video: 9 } : {})).video ?? 0;
    }
    expect(soma).toBe(9);
  });
});
