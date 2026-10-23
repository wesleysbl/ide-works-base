import { describe, expect, it } from 'vitest';

import { intervaloDaSemana, semanaDaData, semanasDoMes } from '@/delivery/semanas';

/** Compacta para `de→ate` e facilita ler a expectativa inteira de uma vez. */
const faixas = (mes: string) => semanasDoMes(mes).map((s) => `${s.de.slice(8)}→${s.ate.slice(8)}`);

describe('semanasDoMes', () => {
  it('agosto de 2026 começa num sábado: as duas pontas curtas somem', () => {
    // Cortes nas segundas 3, 10, 17, 24, 31.
    // Sobram 01–02 (2 dias) na frente e 31 (1 dia) no fim; os dois são absorvidos.
    expect(faixas('2026-08')).toEqual(['01→09', '10→16', '17→23', '24→31']);
  });

  it('setembro de 2026 começa numa terça: só a ponta do fim é curta', () => {
    // 01–06 tem 6 dias e sobrevive; 28–30 tem 3 e volta para a faixa anterior.
    expect(faixas('2026-09')).toEqual(['01→06', '07→13', '14→20', '21→30']);
  });

  it('começar na segunda não livra a ponta do fim de ser absorvida', () => {
    // Junho de 2026 começa numa segunda, mas tem 30 dias: sobram 29 e 30, que
    // são dois dias e voltam para a faixa anterior. A semana 4 fica com 9 dias.
    expect(faixas('2026-06')).toEqual(['01→07', '08→14', '15→21', '22→30']);
  });

  it('fevereiro comum que começa na segunda dá quatro semanas exatas', () => {
    // 2027-02-01 é uma segunda-feira e o mês tem 28 dias.
    expect(faixas('2027-02')).toEqual(['01→07', '08→14', '15→21', '22→28']);
  });

  it('fevereiro bissexto não perde o dia 29', () => {
    const s = semanasDoMes('2028-02');
    expect(s[s.length - 1].ate).toBe('2028-02-29');
  });

  it('nenhum dia do mês fica de fora, em nenhum mês de dois anos', () => {
    // A propriedade que importa: se um dia não cair em semana nenhuma, o item
    // agendado nele some da grade sem aviso — e o medidor passa a discordar da
    // lista de conteúdos.
    for (let ano = 2026; ano <= 2027; ano++) {
      for (let m = 1; m <= 12; m++) {
        const mes = `${ano}-${String(m).padStart(2, '0')}`;
        const semanas = semanasDoMes(mes);
        const ultimoDia = new Date(Date.UTC(ano, m, 0)).getUTCDate();

        expect(semanas[0].de).toBe(`${mes}-01`);
        expect(semanas[semanas.length - 1].ate).toBe(`${mes}-${String(ultimoDia).padStart(2, '0')}`);

        // Contíguas, sem buraco e sem sobreposição.
        const cobertos = semanas.reduce((total, s) => total + s.dias, 0);
        expect(cobertos).toBe(ultimoDia);

        for (let i = 1; i < semanas.length; i++) {
          const fimAnterior = Number(semanas[i - 1].ate.slice(8));
          expect(Number(semanas[i].de.slice(8))).toBe(fimAnterior + 1);
        }
      }
    }
  });

  it('todo mês tem 4 ou 5 semanas, nunca 6, em dois anos', () => {
    for (let ano = 2026; ano <= 2027; ano++) {
      for (let m = 1; m <= 12; m++) {
        const n = semanasDoMes(`${ano}-${String(m).padStart(2, '0')}`).length;
        expect(n).toBeGreaterThanOrEqual(4);
        expect(n).toBeLessThanOrEqual(5);
      }
    }
  });

  it('nenhuma semana fica com menos de quatro dias', () => {
    for (let m = 1; m <= 12; m++) {
      for (const s of semanasDoMes(`2026-${String(m).padStart(2, '0')}`)) {
        expect(s.dias).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('numera a partir de 1, sem buraco', () => {
    expect(semanasDoMes('2026-08').map((s) => s.numero)).toEqual([1, 2, 3, 4]);
  });

  it('aceita o mês com dia junto', () => {
    expect(faixas('2026-08-17')).toEqual(faixas('2026-08'));
  });

  it('recusa mês inválido em vez de devolver faixa torta', () => {
    expect(() => semanasDoMes('2026-13')).toThrow(/inválido/);
    expect(() => semanasDoMes('sei lá')).toThrow(/inválido/);
  });
});

describe('semanaDaData', () => {
  it('encontra a semana de uma data do mês', () => {
    expect(semanaDaData('2026-08', '2026-08-03')).toBe(1);
    expect(semanaDaData('2026-08', '2026-08-09')).toBe(1);
    expect(semanaDaData('2026-08', '2026-08-10')).toBe(2);
    expect(semanaDaData('2026-08', '2026-08-31')).toBe(4);
  });

  it('o dia 1 sempre cai na semana 1', () => {
    expect(semanaDaData('2026-08', '2026-08-01')).toBe(1);
  });

  it('data de outro mês devolve nulo, e não a semana mais próxima', () => {
    // Aproximar cobraria de agosto uma produção que é de julho.
    expect(semanaDaData('2026-08', '2026-07-31')).toBeNull();
    expect(semanaDaData('2026-08', '2026-09-01')).toBeNull();
  });

  it('ignora a hora que vier junto', () => {
    expect(semanaDaData('2026-08', '2026-08-12T23:30:00Z')).toBe(2);
  });
});

describe('intervaloDaSemana', () => {
  it('escreve o intervalo em português, sem ponto na abreviação', () => {
    const [primeira] = semanasDoMes('2026-08');
    expect(intervaloDaSemana(primeira)).toBe('01–09 ago');
  });
});
