/**
 * O calendário — F17.10b.
 *
 * O QUE ESTES TESTES GUARDAM
 *   Que a grade do seletor de data continue certa para o ano 82025, que é a
 *   razão de o arquivo existir. `new Date(82025, 7, 7)` até funciona no Node;
 *   o que não funciona é `toISOString()` — e é ele que todo caminho de data do
 *   projeto usaria sem pensar.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { today } from '@/board/board';
import {
  CABECALHO_DA_SEMANA,
  atalhos,
  diaDaSemana,
  diaDesdeEpoca,
  diaDigitadoVale,
  diasDesdeEpoca,
  gradeDoMes,
  iso,
  mesVizinho,
  mesmoDia,
  nomeDoDia,
  somarDias,
} from '@/board/calendario';

describe('a conversão de dia para número e de volta', () => {
  it('a época é zero', () => {
    expect(diasDesdeEpoca({ year: 1970, month: 1, day: 1 })).toBe(0);
  });

  it('volta ao mesmo dia', () => {
    for (const d of [
      { year: 1970, month: 1, day: 1 },
      { year: 1999, month: 12, day: 31 },
      { year: 2000, month: 2, day: 29 },
      { year: 2026, month: 8, day: 25 },
      { year: 1899, month: 3, day: 1 },
      { year: 82025, month: 8, day: 7 },
    ]) {
      expect(diaDesdeEpoca(diasDesdeEpoca(d))).toEqual(d);
    }
  });

  it('bate com o relógio do sistema para datas comuns', () => {
    // Prova de que o algoritmo é o mesmo calendário — feita SÓ com ano de
    // quatro dígitos, que é onde `Date` é confiável.
    for (const [y, m, d] of [
      [2026, 8, 25],
      [2024, 2, 29],
      [1970, 1, 1],
      [2000, 1, 1],
    ] as const) {
      const oficial = Date.UTC(y, m - 1, d) / 86400000;
      expect(diasDesdeEpoca({ year: y, month: m, day: d })).toBe(oficial);
    }
  });
});

describe('o dia da semana', () => {
  it('1970-01-01 foi quinta', () => {
    expect(diaDaSemana({ year: 1970, month: 1, day: 1 })).toBe(4);
  });

  it('bate com o relógio do sistema no ano corrente', () => {
    for (let i = 0; i < 40; i += 1) {
      const d = new Date(Date.UTC(2026, 0, 1 + i));
      expect(diaDaSemana({ year: 2026, month: d.getUTCMonth() + 1, day: d.getUTCDate() })).toBe(
        d.getUTCDay(),
      );
    }
  });

  it('responde para o ano 82025 sem estourar', () => {
    expect(diaDaSemana({ year: 82025, month: 8, day: 7 })).toBeGreaterThanOrEqual(0);
    expect(diaDaSemana({ year: 82025, month: 8, day: 7 })).toBeLessThanOrEqual(6);
  });
});

describe('a grade do mês', () => {
  it('tem sempre 42 casas e começa num domingo', () => {
    for (const [ano, mes] of [
      [2026, 2],
      [2026, 8],
      [2024, 2],
      [82025, 8],
    ] as const) {
      const g = gradeDoMes(ano, mes);
      expect(g).toHaveLength(42);
      expect(diaDaSemana(g[0].dia)).toBe(0);
      expect(CABECALHO_DA_SEMANA).toHaveLength(7);
    }
  });

  it('marca como do mês só os dias do mês', () => {
    const g = gradeDoMes(2026, 8);
    const dentro = g.filter((c) => c.doMes);
    expect(dentro).toHaveLength(31);
    expect(dentro[0].dia.day).toBe(1);
    expect(dentro[30].dia.day).toBe(31);
  });

  it('abre no mês da tarefa do ano 82025', () => {
    const g = gradeDoMes(82025, 8);
    expect(g.some((c) => c.doMes && c.dia.day === 7)).toBe(true);
  });
});

describe('a navegação de mês', () => {
  it('atravessa a virada do ano nos dois sentidos', () => {
    expect(mesVizinho(2026, 12, 1)).toEqual({ ano: 2027, mes: 1 });
    expect(mesVizinho(2026, 1, -1)).toEqual({ ano: 2025, mes: 12 });
    expect(mesVizinho(2026, 8, 0)).toEqual({ ano: 2026, mes: 8 });
  });
});

describe('a escrita da data', () => {
  it('põe zero à esquerda no mês e no dia, e não encolhe o ano', () => {
    expect(iso({ year: 2026, month: 8, day: 5 })).toBe('2026-08-05');
    expect(iso({ year: 82025, month: 8, day: 7 })).toBe('82025-08-07');
  });

  /**
   * O DIA DE HOJE É O DIA DO RELÓGIO LOCAL, E NÃO O DIA UTC — F17.AUD07.
   *
   * `new Date().toISOString().slice(0, 10)` responde em UTC: às 22h de São
   * Paulo já é amanhã lá, e o cliente novo nascia com a data errada (achado 8
   * da auditoria). `iso(today(agora))` lê ano, mês e dia pelo relógio local.
   *
   * ⚠️ As datas são construídas POR COMPONENTE (`new Date(ano, mês, dia, hora)`)
   * e lidas por componente — os dois lados usam o fuso do processo, então o
   * teste vale em qualquer máquina, sem depender de `TZ`. O que se prova é que
   * a composição nunca passa por `toISOString`: se passasse, numa máquina a
   * oeste de Greenwich o primeiro caso viraria `2026-09-10`.
   */
  it('o dia de hoje sai do relógio local, sem passar por UTC — F17.AUD07', () => {
    // 22h de 09/09/2026: em São Paulo o dia UTC já é 10/09.
    expect(iso(today(new Date(2026, 8, 9, 22, 0)))).toBe('2026-09-09');
    // Meia-noite local: virou o dia, e é o dia novo que vale.
    expect(iso(today(new Date(2026, 8, 10, 0, 0)))).toBe('2026-09-10');
    // 23h59 de 31/12: o ano não vira antes da hora.
    expect(iso(today(new Date(2026, 11, 31, 23, 59)))).toBe('2026-12-31');
  });

  /**
   * E A FICHA DO CLIENTE NOVO USA ESSA COMPOSIÇÃO — F17.AUD07, verificação.
   *
   * O teste acima prova `iso(today())`. Ele NÃO prova que `FichaDeCliente`
   * a chama: a verificação da etapa devolveu a ficha ao
   * `new Date().toISOString().slice(0, 10)` e a suíte inteira continuou verde.
   * O preenchimento acontece dentro de um `useEffect`, que `renderToStaticMarkup`
   * não executa, e a suíte não tem DOM de propósito — então o que se prova aqui
   * é o CÓDIGO da ficha, no mesmo gênero de `tela-da-tarefa.test.ts` lendo
   * `tarefa.css`: a data inicial nasce de `iso(today())`, e nenhuma linha de
   * código (os comentários contam a história e ficam de fora) volta a passar
   * por `toISOString`.
   */
  it('a ficha do cliente novo nasce de `iso(today())`, não do dia UTC — F17.AUD07', () => {
    const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const fonte = readFileSync(join(RAIZ, 'src', 'clients', 'FichaDeCliente.tsx'), 'utf8');
    // Só o código: fora as linhas de comentário de bloco (` * …`, `/** …`) e de linha.
    const codigo = fonte
      .split('\n')
      .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l))
      .join('\n');
    expect(codigo).toMatch(/startedOn:\s*iso\(today\(\)\)/);
    expect(codigo).not.toMatch(/toISOString/);
    // E `today` e `iso` são os do quadro e do calendário — não uma cópia local.
    expect(fonte).toMatch(/import \{ today \} from '@\/board\/board'/);
    expect(fonte).toMatch(/import \{ iso \} from '@\/board\/calendario'/);
  });
});

describe('os atalhos', () => {
  // 2026-08-25 é uma terça-feira.
  const hoje = { year: 2026, month: 8, day: 25 };
  const mapa = Object.fromEntries(atalhos(hoje).map((a) => [a.chave, a.dia]));

  it('são sete — `Mais tarde` não existe porque o prazo não tem hora', () => {
    expect(atalhos(hoje)).toHaveLength(7);
    expect(atalhos(hoje).map((a) => a.chave)).not.toContain('mais-tarde');
  });

  it('hoje é hoje e amanhã é o dia seguinte', () => {
    expect(mesmoDia(mapa.hoje, hoje)).toBe(true);
    expect(iso(mapa.amanha)).toBe('2026-08-26');
  });

  it('este final de semana é o sábado que vem', () => {
    expect(diaDaSemana(mapa['fim-de-semana'])).toBe(6);
    expect(iso(mapa['fim-de-semana'])).toBe('2026-08-29');
  });

  it('se hoje é sábado, este final de semana é hoje', () => {
    const sabado = { year: 2026, month: 8, day: 29 };
    const m = Object.fromEntries(atalhos(sabado).map((a) => [a.chave, a.dia]));
    expect(mesmoDia(m['fim-de-semana'], sabado)).toBe(true);
  });

  it('semana que vem é a segunda seguinte, nunca hoje', () => {
    expect(diaDaSemana(mapa['semana-que-vem'])).toBe(1);
    expect(iso(mapa['semana-que-vem'])).toBe('2026-08-31');

    const segunda = { year: 2026, month: 8, day: 24 };
    const m = Object.fromEntries(atalhos(segunda).map((a) => [a.chave, a.dia]));
    expect(iso(m['semana-que-vem'])).toBe('2026-08-31');
  });

  it('próximo final de semana é sete dias depois deste', () => {
    expect(diasDesdeEpoca(mapa['proximo-fim-de-semana']) - diasDesdeEpoca(mapa['fim-de-semana'])).toBe(7);
  });

  it('duas e quatro semanas são 14 e 28 dias', () => {
    expect(mesmoDia(mapa['duas-semanas'], somarDias(hoje, 14))).toBe(true);
    expect(mesmoDia(mapa['quatro-semanas'], somarDias(hoje, 28))).toBe(true);
  });
});

describe('o dia digitado só se entrega quando assenta', () => {
  // O campo de data do Chrome entrega um valor a cada dígito: digitar o ano
  // 2026 passa por 0002, 0020 e 0202, e digitar o dia 15 passa pelo dia 01. Na
  // ficha cada entrega é uma gravação — o prazo ia ao banco pela metade.
  it('a data inteira com ano de verdade vale, inclusive o ano de cinco dígitos que o legado tem', () => {
    expect(diaDigitadoVale('2026-10-15')).toBe(true);
    expect(diaDigitadoVale('1999-01-01')).toBe(true);
    expect(diaDigitadoVale('82025-08-07')).toBe(true);
  });

  it('o ano pela metade (0002, 0020, 0202) não vale: é caminho de digitação, e não prazo', () => {
    expect(diaDigitadoVale('0002-10-15')).toBe(false);
    expect(diaDigitadoVale('0020-10-15')).toBe(false);
    expect(diaDigitadoVale('0202-10-15')).toBe(false);
  });

  it('texto que não é data não vale', () => {
    expect(diaDigitadoVale('amanhã')).toBe(false);
    expect(diaDigitadoVale('2026-13-01')).toBe(false);
    expect(diaDigitadoVale('2026-10')).toBe(false);
    expect(diaDigitadoVale('15/10/2026')).toBe(false);
  });

  it('campo vazio só vale ao SAIR do campo: no meio da digitação ele é um segmento apagado, e não "sem prazo"', () => {
    expect(diaDigitadoVale('')).toBe(false);
    expect(diaDigitadoVale('', true)).toBe(true);
    // Ao sair, o que não é data nem vazio continua não valendo.
    expect(diaDigitadoVale('0202-10-15', true)).toBe(false);
    expect(diaDigitadoVale('2026-10-15', true)).toBe(true);
  });
});


describe('nomeDoDia — o nome acessível de uma casa do calendário', () => {
  it('diz o dia da semana, o dia, o mês e o ano por extenso', () => {
    expect(nomeDoDia({ year: 2026, month: 10, day: 15 })).toBe('quinta-feira, 15 de outubro de 2026');
    expect(nomeDoDia({ year: 2026, month: 3, day: 1 })).toBe('domingo, 1 de março de 2026');
    expect(nomeDoDia({ year: 2026, month: 8, day: 29 })).toBe('sábado, 29 de agosto de 2026');
  });

  it('o número visível da casa continua dentro do nome (WCAG 2.5.3)', () => {
    for (let dia = 1; dia <= 31; dia += 1) {
      expect(nomeDoDia({ year: 2026, month: 10, day: dia })).toContain(String(dia));
    }
  });
});
