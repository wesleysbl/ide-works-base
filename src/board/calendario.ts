/**
 * O calendário do seletor de data — etapa F17.10b.
 *
 * POR QUE ELE NÃO USA `Date` PARA NADA ALÉM DE "QUE HORAS SÃO"
 *   Existe tarefa real com prazo `82025-08-07` — ano oitenta e dois mil,
 *   herdado do legado. `new Date('82025-08-07')` devolve `+082025-08-07` no
 *   `toISOString()`, e todo `.slice(0, 10)` do projeto sairia com `+082025-0`.
 *
 *   O seletor de data ABRE em cima do prazo que existe. Se ele montasse a grade
 *   com `new Date(ano, mes, 1)`, abrir a ficha dessa tarefa mostraria um mês que
 *   não é o dela — ou nada.
 *
 *   Então a aritmética inteira é feita aqui, em número inteiro: o algoritmo de
 *   Howard Hinnant converte data civil ↔ dias desde 1970-01-01 sem tabela, sem
 *   laço e sem limite de ano. Ele é exato para qualquer ano do calendário
 *   gregoriano proléptico, inclusive 82025.
 *
 *   `Date` aparece uma vez só, em `board.ts`, para responder "que dia é hoje" —
 *   e essa pergunta é sobre o relógio de quem olha, não sobre o dado.
 *
 * IDIOMA
 *   Interface em português (decisão D5). O cabeçalho da semana é o do ClickUp em
 *   português: `do 2ª 3ª 4ª 5ª 6ª sá`.
 */

import { type Day, formatDay, parseDay } from '@/board/board';

/* ───────────────────────────── aritmética de dia ───────────────────────────── */

/**
 * Dias desde 1970-01-01, pelo algoritmo `days_from_civil` de Howard Hinnant.
 *
 * Divisão inteira em toda parte — `Math.floor` e não `|0`, porque `|0` trunca em
 * 32 bits e o ano 82025 estoura isso na multiplicação por 146097.
 */
export function diasDesdeEpoca(d: Day): number {
  const y = d.year - (d.month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (d.month + (d.month > 2 ? -3 : 9)) + 2) / 5) + d.day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** O inverso — `civil_from_days`. */
export function diaDesdeEpoca(dias: number): Day {
  const z = dias + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  return { year: y + (month <= 2 ? 1 : 0), month, day };
}

/** `0` é domingo — a mesma origem do cabeçalho `do 2ª 3ª 4ª 5ª 6ª sá`. */
export function diaDaSemana(d: Day): number {
  const dias = diasDesdeEpoca(d);
  // 1970-01-01 foi quinta-feira, que é 4 com domingo em 0.
  return ((((dias + 4) % 7) + 7) % 7);
}

export function somarDias(d: Day, n: number): Day {
  return diaDesdeEpoca(diasDesdeEpoca(d) + n);
}

export const mesmoDia = (a: Day, b: Day): boolean =>
  a.year === b.year && a.month === b.month && a.day === b.day;

/**
 * `YYYY-MM-DD`, e ano de cinco dígitos sai com cinco.
 *
 * Nada de `padStart(4)` no ano: encolher `82025` para caber em quatro casas
 * seria inventar uma data. O banco tem `date`, que aceita o ano como ele é.
 */
export function iso(d: Day): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.year).padStart(4, '0')}-${pad(d.month)}-${pad(d.day)}`;
}

/* ───────────────────────────── o dia digitado ───────────────────────────── */

/**
 * Quanto o campo de dia espera, depois da última tecla, para entregar o que foi
 * digitado. Mais que o intervalo entre dois dígitos de quem digita sem pensar, e
 * menos que a pausa de quem terminou.
 */
export const ESPERA_DO_DIA_DIGITADO = 600;

/**
 * O DIA DIGITADO SÓ SE ENTREGA QUANDO ASSENTA.
 *
 * O campo de data nativo do Chrome entrega um valor a CADA dígito, e o valor
 * intermediário é uma data inteira e válida: digitar o ano 2026 passa por
 * `0002`, `0020` e `0202`; digitar o dia 15 passa pelo dia 01. Na ficha cada
 * entrega era uma gravação — o prazo ia ao banco como `0002-10-15`, e a
 * resposta de uma tecla antiga, chegando com a pessoa já na seguinte, devolvia
 * o campo ao valor velho no meio da digitação.
 *
 * Aqui se decide o que VALE entregar: uma data inteira com ano de verdade
 * (de 1000 em diante — o `82025` do legado também passa; os anos de um a três
 * dígitos só existem no caminho da digitação). O vazio só vale AO SAIR do campo
 * (`aoSair`): no meio da digitação ele é um segmento apagado, e gravá-lo
 * apagaria o prazo para recolocá-lo meio segundo depois.
 */
export function diaDigitadoVale(texto: string, aoSair = false): boolean {
  if (texto === '') return aoSair;
  const dia = parseDay(texto);
  return dia !== null && dia.year >= 1000;
}

/* ───────────────────────────── nomes ───────────────────────────── */

export const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

/** O cabeçalho da grade, como o ClickUp em português o escreve. */
export const CABECALHO_DA_SEMANA = ['do', '2ª', '3ª', '4ª', '5ª', '6ª', 'sá'] as const;

/** O dia da semana por extenso, de `0` (domingo) a `6` — para o nome acessível do dia. */
export const DIA_POR_EXTENSO = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
] as const;

/**
 * `quinta-feira, 15 de outubro de 2026` — o NOME ACESSÍVEL de uma casa do
 * calendário (WCAG 4.1.2, 2.4.6). A casa mostra só `15`; o leitor de tela lia
 * "15, botão" trinta e cinco vezes seguidas, sem mês, ano nem dia da semana. O
 * número visível continua dentro do nome (2.5.3).
 */
export function nomeDoDia(d: Day): string {
  return `${DIA_POR_EXTENSO[diaDaSemana(d)]}, ${d.day} de ${MESES[d.month - 1]} de ${d.year}`;
}

/** O que vai à direita de cada atalho. */
export const DIA_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;

/* ───────────────────────────── a grade do mês ───────────────────────────── */

export type CasaDoCalendario = {
  dia: Day;
  /** Falso para os dias do mês anterior e do seguinte que completam a grade. */
  doMes: boolean;
};

/**
 * Seis semanas de sete dias, sempre.
 *
 * SEMPRE 42 CASAS, e não "as que couberem": grade que muda de altura conforme o
 * mês faz o calendário pular quando se navega, e o botão que estava debaixo do
 * cursor sai de baixo dele no meio do clique.
 */
export function gradeDoMes(ano: number, mes: number): CasaDoCalendario[] {
  const primeiro: Day = { year: ano, month: mes, day: 1 };
  const inicio = somarDias(primeiro, -diaDaSemana(primeiro));
  return Array.from({ length: 42 }, (_, i) => {
    const dia = somarDias(inicio, i);
    return { dia, doMes: dia.month === mes && dia.year === ano };
  });
}

/** Anda de mês sem estourar dezembro nem janeiro. */
export function mesVizinho(ano: number, mes: number, passo: number): { ano: number; mes: number } {
  const total = ano * 12 + (mes - 1) + passo;
  return { ano: Math.floor(total / 12), mes: (((total % 12) + 12) % 12) + 1 };
}

/* ───────────────────────────── os atalhos ───────────────────────────── */

export type Atalho = {
  chave: string;
  rotulo: string;
  dia: Day;
};

/**
 * Os atalhos da coluna da esquerda do seletor.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SÃO SETE, E NÃO OITO — `Mais tarde` NÃO EXISTE AQUI
 *
 *   No ClickUp `Mais tarde` é "hoje, mais para o fim do dia": ele carimba uma
 *   HORA. Aqui `tasks.due_on` e `tasks.start_on` são `date` — dia, sem hora.
 *
 *   Então `Mais tarde` gravaria exatamente o mesmo que `Hoje`. Dois botões lado
 *   a lado escrevendo o mesmo valor é pior do que um botão a menos: quem clica
 *   no segundo acredita ter dito outra coisa.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `Este final de semana` é o sábado que vem — e hoje, se hoje for sábado.
 * `Semana que vem` é a segunda-feira seguinte. `Próximo final de semana` é o
 * sábado depois deste.
 */
export function atalhos(hoje: Day): Atalho[] {
  const dow = diaDaSemana(hoje);
  const ateSabado = (6 - dow + 7) % 7;
  const ateSegunda = (1 - dow + 7) % 7 || 7;

  return [
    { chave: 'hoje', rotulo: 'Hoje', dia: hoje },
    { chave: 'amanha', rotulo: 'Amanhã', dia: somarDias(hoje, 1) },
    { chave: 'fim-de-semana', rotulo: 'Este final de semana', dia: somarDias(hoje, ateSabado) },
    { chave: 'semana-que-vem', rotulo: 'Semana que vem', dia: somarDias(hoje, ateSegunda) },
    {
      chave: 'proximo-fim-de-semana',
      rotulo: 'Próximo final de semana',
      dia: somarDias(hoje, ateSabado + 7),
    },
    { chave: 'duas-semanas', rotulo: '2 semanas', dia: somarDias(hoje, 14) },
    { chave: 'quatro-semanas', rotulo: '4 semanas', dia: somarDias(hoje, 28) },
  ];
}

/* ───────────────────────────── o que o chip escreve ───────────────────────────── */

/**
 * `07/08/82025`, ou o texto cru quando o dia é ilegível — nunca "sem prazo".
 *
 * Devolver o valor bruto em vez de nulo é deliberado: um prazo que a tela não
 * consegue formatar continua sendo um prazo, e mostrá-lo como ausente é a
 * mentira que apagaria o dado no primeiro salvamento.
 */
export function rotuloDeDia(valor: string | null): string | null {
  if (valor === null || valor.trim() === '') return null;
  return formatDay(valor) ?? valor;
}
