/**
 * A GRADE DO MÊS — F17.40.
 *
 * O QUE ESTE ARQUIVO GUARDA
 *   1. Que TIRAR a grade de dentro de `Calendario.tsx` não mudou um dia sequer.
 *      A prova é comparar a versão nova, em aritmética inteira, com a conta
 *      antiga em `Date` — mês a mês, por onze anos. Se o desenho mudasse, este
 *      teste diria exatamente em qual mês.
 *
 *   2. Que a conta de dia não volta a passar por `Date`. `82025-08-07` existe no
 *      banco, e `new Date('82025-08-07T00:00:00Z')` é `Invalid Date` — o
 *      `toISOString()` seguinte ESTOURA. Não é um dia errado: é a tela caindo.
 *
 *   3. Que a cor do tipo não pinta letra. É a decisão da F17.37, e ela some sem
 *      quebrar nada — só devolvendo texto de 11px a 2,43 de contraste. Desde a
 *      F43 Fase 5 ela também não pinta fundo nem contorno: só o ícone.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  type EntradaDoMes,
  casasDoMes,
  corDoTipo,
  deslocarMes,
  detalheDaEntrada,
  diaDoInstante,
  diasDaAgenda,
  hojeNaAgencia,
  janelaDoMes,
  nomeAcessivelDaEntrada,
  nomeDoDia,
  nomeDoMes,
  ordenarNoDia,
  perguntaAntesDeApagar,
  porDia,
  recorteDaCasa,
  rotuloDaEntrada,
  somarUmDia,
} from '@/ui/grade-do-mes';

/**
 * A grade EXATAMENTE como `Calendario.tsx` a montava antes desta etapa.
 * Copiada de propósito: é a testemunha de que nada mudou.
 */
function gradeAntiga(mes: string): Array<string | null> {
  const [ano, m] = mes.split('-').map(Number);
  const vazios = new Date(Date.UTC(ano, m - 1, 1)).getUTCDay();
  const total = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  return [
    ...Array.from({ length: vazios }, () => null),
    ...Array.from({ length: total }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`),
  ];
}

const meses: string[] = [];
for (let ano = 2020; ano <= 2030; ano++) {
  for (let m = 1; m <= 12; m++) meses.push(`${ano}-${String(m).padStart(2, '0')}`);
}

describe('a grade extraída desenha o mesmo mês que a de dentro da tela', () => {
  it.each(meses)('%s', (mes) => {
    expect(casasDoMes(mes)).toEqual(gradeAntiga(mes));
  });

  it('fevereiro bissexto tem 29 dias, e o de 2100 tem 28', () => {
    // 2100 é divisível por 4 e NÃO é bissexto — a regra dos séculos. Vale como
    // prova de que a aritmética inteira não é uma tabela decorada.
    expect(casasDoMes('2024-02').filter((d) => d !== null)).toHaveLength(29);
    expect(casasDoMes('2100-02').filter((d) => d !== null)).toHaveLength(28);
  });

  it('a grade começa no domingo, sempre', () => {
    // Agosto de 2026 começa num sábado: seis buracos antes do dia 1º.
    const casas = casasDoMes('2026-08');
    expect(casas.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(casas[6]).toBe('2026-08-01');
  });
});

describe('a janela é o período, ou o mês inteiro', () => {
  it('sem período, é do dia 1º ao dia 1º do mês seguinte', () => {
    expect(janelaDoMes('2026-08', null)).toEqual({ from: '2026-08-01', to: '2026-09-01' });
  });

  it('dezembro vira janeiro do ano que vem, e não mês 13', () => {
    expect(janelaDoMes('2026-12', null)).toEqual({ from: '2026-12-01', to: '2027-01-01' });
  });

  it('com período, o fim é EXCLUSIVO — o dia escolhido continua dentro', () => {
    expect(janelaDoMes('2026-08', { de: '2026-08-10', ate: '2026-08-14' })).toEqual({
      from: '2026-08-10',
      to: '2026-08-15',
    });
  });

  it('período de um dia só é um dia só', () => {
    expect(janelaDoMes('2026-08', { de: '2026-08-31', ate: '2026-08-31' })).toEqual({
      from: '2026-08-31',
      to: '2026-09-01',
    });
  });
});

describe('a conta de dia não passa por `Date`', () => {
  it('o ano de cinco dígitos soma um dia como qualquer outro', () => {
    // A conta antiga não devolvia um dia errado aqui: ela ESTOURAVA.
    expect(() => {
      const d = new Date('82025-08-07T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    }).toThrow();

    expect(somarUmDia('82025-08-07')).toBe('82025-08-08');
  });

  it('virada de mês e de ano', () => {
    expect(somarUmDia('2026-08-31')).toBe('2026-09-01');
    expect(somarUmDia('2026-12-31')).toBe('2027-01-01');
    expect(somarUmDia('2024-02-28')).toBe('2024-02-29');
  });

  it('o que não é dia volta como veio, sem virar data inventada', () => {
    expect(somarUmDia('sem data')).toBe('sem data');
  });
});

/* ─────────────────────────── as duas lentes ─────────────────────────── */

const entrada = (p: Partial<EntradaDoMes> = {}): EntradaDoMes => ({
  kind: 'delivery',
  id: 'i1',
  clientId: 'c1',
  clientName: 'Padaria do Zé',
  contentType: 'video',
  day: '2026-08-12',
  time: '15:30',
  title: 'Bastidores',
  isExtra: false,
  isCompleted: false,
  notes: null,
  ...p,
});

describe('a pastilha diz o que falta saber, e não o que já se sabe', () => {
  it('de fora do cliente, ela diz DE QUEM é', () => {
    expect(rotuloDaEntrada(entrada(), 'de-todos')).toBe('Padaria do Zé');
  });

  it('de dentro da ficha, ela diz O QUE é', () => {
    expect(rotuloDaEntrada(entrada(), 'de-um-cliente')).toBe('Vídeo · Bastidores');
  });

  it('sem título, sobra o tipo — nunca um travessão sozinho', () => {
    expect(rotuloDaEntrada(entrada({ title: null }), 'de-um-cliente')).toBe('Vídeo');
  });

  it('tipo desconhecido aparece como veio, e não some', () => {
    expect(rotuloDaEntrada(entrada({ contentType: 'podcast', title: null }), 'de-um-cliente')).toBe(
      'podcast',
    );
  });

  it('o detalhe do cursor não repete o cliente dentro da ficha dele', () => {
    expect(detalheDaEntrada(entrada({ isExtra: true }), 'de-um-cliente')).toBe(
      'Vídeo · 15:30 · Bastidores · extra',
    );
    expect(detalheDaEntrada(entrada(), 'de-todos')).toBe(
      'Padaria do Zé · Vídeo · 15:30 · Bastidores',
    );
  });
});

/*
 * F43 Fase 5 — ESTE BLOCO MUDOU DE PROPÓSITO. Até aqui ele guardava a decisão
 * da F17.37 ("a cor do tipo vai para o contorno e o fundo da pastilha, nunca
 * para a letra"). A camada calma levou a cor também para fora do contorno e do
 * fundo: a pastilha é neutra e a cor mora só no ícone. A metade da F17.37 que
 * continua valendo — a letra nunca leva a luz do tipo — é o último caso abaixo,
 * agora lido da folha de estilo, que é onde a pastilha ganha cor.
 */
describe('a cor do tipo pinta o ícone, e só ele — F43 Fase 5 (antes F17.37)', () => {
  it.each(['video', 'arte', 'foto', 'ads'])('%s tem cor própria, num token', (tipo) => {
    expect(corDoTipo(tipo)).toMatch(/^var\(--[a-z-]+\)$/);
    expect(corDoTipo(tipo)).not.toBe('var(--mute)');
  });

  it('nenhum tipo usa o verde da marca — ele é da ação e do lugar atual', () => {
    const tipos = ['video', 'arte', 'foto', 'ads'];
    for (const tipo of tipos) {
      expect(corDoTipo(tipo)).not.toBe('var(--luz-agencia)');
      expect(corDoTipo(tipo)).not.toBe('var(--luz)');
    }
    // Quatro tipos, quatro cores: duas iguais e a cor deixa de dizer o tipo.
    expect(new Set(tipos.map(corDoTipo)).size).toBe(4);
  });

  it('tipo que o sistema não conhece fica na tinta apagada', () => {
    expect(corDoTipo('podcast')).toBe('var(--mute)');
  });

  it('a pastilha e a linha da agenda não usam a cor do tipo — só o ícone usa', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'layout-foco.css'), 'utf8');
    const regra = (seletor: string) => {
      const i = css.indexOf(`\n${seletor} {`);
      expect(i, `a regra ${seletor} existe`).toBeGreaterThan(-1);
      return css.slice(i, css.indexOf('}', i));
    };
    // Letra, fundo e contorno: nenhum deles lê `--cal-cor`. A 11px a luz do
    // tipo como tinta chegava a 2,43 (`Arte` no claro, F17.37); como fio e
    // fundo, ela virava o mosaico que a F43 tirou.
    expect(regra('.cal-pastilha')).not.toContain('--cal-cor');
    expect(regra('.cal-linha')).not.toContain('--cal-cor');
    expect(regra('.cal-icone')).toContain('var(--cal-cor');
  });
});

describe('cada conteúdo cai no dia dele', () => {
  it('dois no mesmo dia ficam juntos, e a ordem que veio do servidor se mantém', () => {
    const mapa = porDia([
      entrada({ id: 'a', day: '2026-08-12' }),
      entrada({ id: 'b', day: '2026-08-12' }),
      entrada({ id: 'c', day: '2026-08-13' }),
    ]);
    expect(mapa.get('2026-08-12')?.map((e) => e.id)).toEqual(['a', 'b']);
    expect(mapa.get('2026-08-13')?.map((e) => e.id)).toEqual(['c']);
    expect(mapa.get('2026-08-14')).toBeUndefined();
  });
});

/* ─────────────────── as duas decisões que somem sem quebrar ─────────────────── */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function fontes(pasta: string): string[] {
  const achados: string[] = [];
  for (const e of readdirSync(pasta, { withFileTypes: true })) {
    const caminho = join(pasta, e.name);
    if (e.isDirectory()) achados.push(...fontes(caminho));
    else if (['.ts', '.tsx'].includes(extname(e.name)) && !e.name.includes('.test.'))
      achados.push(caminho);
  }
  return achados;
}

const TELA = fontes(SRC).map((f) => [f.slice(SRC.length + 1), readFileSync(f, 'utf8')] as const);

describe('existe UMA grade de mês, e não duas', () => {
  it('só um arquivo desenha a casa do calendário', () => {
    // A casa é `cal-casa` dentro da `cal-grade` (F12; antes, `min-h-24` numa
    // `grid-cols-7`). Se um segundo arquivo passar a desenhá-la, as duas
    // grades começam a divergir no primeiro ajuste — foi o que custou os
    // ícones da árvore (F17.25) e a trilha do lugar (F17.26).
    const quem = TELA.filter(([, s]) => s.includes('"cal-grade"') && s.includes('"cal-casa"')).map(
      ([f]) => f,
    );
    expect(quem).toEqual([join('ui', 'GradeDoMes.tsx')]);
  });

  it('nenhuma tela busca o calendário por conta própria', () => {
    // `api.calendario` mora dentro de `useConteudosDoMes`, onde está a guarda
    // contra a resposta atrasada. Uma chamada solta em outro arquivo é uma
    // segunda chance de esquecer a guarda.
    const quem = TELA.filter(([, s]) => s.includes('api.calendario')).map(([f]) => f);
    expect(quem).toEqual([join('ui/conteudos-do-mes.ts')]);
  });
});

describe('a resposta que chega tarde não manda na tela', () => {
  it('a busca do mês numera cada pedido e descarta o que ficou para trás', () => {
    // Sem isto, pedir dezembro e receber agosto depois deixa a tela com a grade
    // de dezembro e os conteúdos de agosto — medido em 2026-08-31, 622 → 158.
    const fonte = readFileSync(join(SRC, 'ui', 'conteudos-do-mes.ts'), 'utf8');
    expect(fonte).toContain('useRef');
    expect(fonte).toMatch(/if \(minha !== vez\.current\) return/);
  });
});

/* ─────────────────────────── F12 — hoje, mês, nome, casa, agenda ─────────────────────────── */

describe('hoje é o dia da agência, e não o do computador nem o de UTC — F12', () => {
  it('no último dia do mês às 23h30 de Brasília ainda é esse dia (UTC já virou)', () => {
    expect(hojeNaAgencia(new Date('2026-10-01T02:30:00Z'))).toBe('2026-09-30');
  });
  it('meia hora depois da meia-noite de Brasília já é o dia seguinte', () => {
    expect(hojeNaAgencia(new Date('2026-10-01T03:30:00Z'))).toBe('2026-10-01');
  });
  it('na virada do ano', () => {
    expect(hojeNaAgencia(new Date('2027-01-01T02:59:00Z'))).toBe('2026-12-31');
    expect(hojeNaAgencia(new Date('2027-01-01T03:00:00Z'))).toBe('2027-01-01');
  });
});

describe('o dia de um instante marcado é o da agência — revisão do planejamento', () => {
  it('as 22h de São Paulo (01h UTC do dia seguinte) são do dia de São Paulo', () => {
    expect(diaDoInstante('2026-10-01T01:00:00.000Z')).toBe('2026-09-30');
    expect(diaDoInstante('2027-01-01T02:59:00Z')).toBe('2026-12-31');
  });
  it('a meia-noite do legado e o meio-dia da grade seguem no próprio dia', () => {
    expect(diaDoInstante('2026-10-01T03:00:00.000Z')).toBe('2026-10-01');
    expect(diaDoInstante('2026-10-01T12:00:00Z')).toBe('2026-10-01');
  });
  it('um instante com deslocamento vale pelo instante, não pelo texto', () => {
    expect(diaDoInstante('2026-10-01T22:30:00-03:00')).toBe('2026-10-01');
    expect(diaDoInstante('2026-10-02T01:30:00+00:00')).toBe('2026-10-01');
  });
  it('dia puro volta como veio; o que não é instante volta cortado, sem estourar', () => {
    expect(diaDoInstante('2026-10-05')).toBe('2026-10-05');
    expect(diaDoInstante('2026-10-05T10:00:00')).toBe('2026-10-05');
    expect(diaDoInstante('82025-08-07')).toBe('82025-08-07'.slice(0, 10));
    expect(() => diaDoInstante('banana')).not.toThrow();
  });
});

describe('apagar entrega já feita pede confirmação — revisão do planejamento', () => {
  const entrega = (over: Partial<EntradaDoMes> = {}): EntradaDoMes => entrada({ kind: 'delivery', ...over });

  it('a entrega concluída pergunta antes (e a frase diz o que se perde)', () => {
    const pergunta = perguntaAntesDeApagar(entrega({ isCompleted: true }));
    expect(pergunta).toContain('já foi marcada como feita');
    expect(pergunta).toContain('medidor');
  });

  it('o botão Apagar da janela passa pela pergunta antes de chamar a rota', () => {
    const janela = readFileSync(join(SRC, 'ui', 'MarcarNoDia.tsx'), 'utf8');
    const apagar = janela.slice(janela.indexOf('function apagar()'), janela.indexOf('const tituloDaJanela'));
    expect(apagar).toContain('perguntaAntesDeApagar(existente)');
    expect(apagar.indexOf('window.confirm(pergunta)')).toBeGreaterThan(-1);
    expect(apagar.indexOf('window.confirm(pergunta)')).toBeLessThan(apagar.indexOf('api.excluirItem'));
  });

  it('a entrega por fazer e o compromisso seguem apagando direto', () => {
    expect(perguntaAntesDeApagar(entrega({ isCompleted: false }))).toBeNull();
    expect(perguntaAntesDeApagar(entrega({ kind: 'appointment', isCompleted: true }))).toBeNull();
  });
});

describe('o mês vizinho e o nome do mês, sem Date', () => {
  it('atravessa o ano nos dois sentidos', () => {
    expect(deslocarMes('2026-12', 1)).toBe('2027-01');
    expect(deslocarMes('2027-01', -1)).toBe('2026-12');
    expect(deslocarMes('2026-09', 0)).toBe('2026-09');
  });
  it('escreve por extenso', () => {
    expect(nomeDoMes('2026-03')).toBe('março de 2026');
    expect(nomeDoDia('2026-09-28')).toBe('segunda, 28 de setembro');
  });
});

describe('o nome acessível de cada entrada — R06', () => {
  it('conteúdo de fora do cliente: cliente, tipo, título, dia e estado', () => {
    expect(nomeAcessivelDaEntrada(entrada({ isCompleted: true }), 'de-todos')).toBe(
      'Padaria do Zé — Vídeo “Bastidores”, dia 12/08, concluído',
    );
  });
  it('sem título não inventa título', () => {
    expect(nomeAcessivelDaEntrada(entrada({ title: null, isExtra: true }), 'de-um-cliente')).toBe(
      'Vídeo sem título, dia 12/08, extra, pendente',
    );
  });
  it('compromisso diz que é compromisso e a hora, ou "dia inteiro"', () => {
    const c = entrada({ kind: 'appointment', contentType: '', title: 'Gravação', time: null });
    expect(nomeAcessivelDaEntrada(c, 'de-um-cliente')).toBe('Compromisso “Gravação”, dia 12/08, dia inteiro');
    expect(nomeAcessivelDaEntrada({ ...c, time: '09:00' }, 'de-todos')).toBe(
      'Padaria do Zé — Compromisso “Gravação”, dia 12/08, às 09:00',
    );
  });
});

describe('o dia cheio tem teto, e nada some', () => {
  const lista = Array.from({ length: 9 }, (_, i) => i);
  it('até quatro, tudo; acima, três e "+N"', () => {
    expect(recorteDaCasa(lista.slice(0, 4), false)).toEqual({ mostrar: [0, 1, 2, 3], escondidos: 0 });
    expect(recorteDaCasa(lista, false)).toEqual({ mostrar: [0, 1, 2], escondidos: 6 });
  });
  it('expandida, mostra tudo', () => {
    expect(recorteDaCasa(lista, true)).toEqual({ mostrar: lista, escondidos: 0 });
  });
});

describe('a ordem dentro do dia — compromisso, o que falta, o concluído', () => {
  it('ordena por natureza e estado, e preserva a ordem do servidor dentro de cada grupo', () => {
    const r = ordenarNoDia([
      entrada({ id: 'feito-a', isCompleted: true }),
      entrada({ id: 'falta-a' }),
      entrada({ id: 'reuniao-15', kind: 'appointment', contentType: '', time: '15:00' }),
      entrada({ id: 'falta-b' }),
      entrada({ id: 'reuniao-dia', kind: 'appointment', contentType: '', time: null }),
      entrada({ id: 'reuniao-09', kind: 'appointment', contentType: '', time: '09:00' }),
    ]);
    expect(r.map((e) => e.id)).toEqual(['reuniao-dia', 'reuniao-09', 'reuniao-15', 'falta-a', 'falta-b', 'feito-a']);
  });
});

describe('os dias da agenda', () => {
  const janela = janelaDoMes('2026-09', null);
  it('só os dias com algo, em ordem, e hoje mesmo vazio', () => {
    const d = diasDaAgenda(
      [entrada({ id: 'b', day: '2026-09-20' }), entrada({ id: 'a', day: '2026-09-03' })],
      janela,
      '2026-09-10',
    );
    expect(d.map((x) => [x.dia, x.entradas.length])).toEqual([
      ['2026-09-03', 1],
      ['2026-09-10', 0],
      ['2026-09-20', 1],
    ]);
  });
  it('hoje fora da janela não entra, e o que está fora da janela também não', () => {
    const d = diasDaAgenda([entrada({ day: '2026-10-01' })], janela, '2026-10-02');
    expect(d).toEqual([]);
  });
});
