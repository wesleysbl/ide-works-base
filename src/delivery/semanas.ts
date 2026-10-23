/**
 * As semanas de um mês — etapa F4.7.
 *
 * POR QUE ISTO PRECISA SER DECIDIDO, EM VEZ DE COPIADO
 *   No Sistema IDE a semana é uma **coluna**: `weekly_progress.week_number`,
 *   1 a 5, escolhida por quem cadastra. Medido nos 2.601 itens datados do
 *   legado em 2026-08-20:
 *
 *     semana 1 → 879 itens, dias 1 a 31, dia médio 12,5
 *     semana 2 → 579 itens, dias 1 a 31, dia médio 15,8
 *     semana 3 → 510 itens, dias 1 a 31, dia médio 19,9
 *     semana 4 → 633 itens, dias 1 a 31, dia médio 16,4
 *
 *   A regra "dias 1–7 é a semana 1" explicaria 35% dos casos da semana 1 e
 *   **15%** dos da semana 4. Não há regra: há gaveta. Um post do dia 28 mora na
 *   "Semana 01" porque alguém o arrastou para lá.
 *
 *   É por isso que a grade e o calendário do legado são dois cadastros do mesmo
 *   conteúdo — a grade não sabe a data, e o calendário não sabe a semana.
 *
 *   Aqui a semana é DERIVADA da data. Não há gaveta para divergir do calendário,
 *   e é a mesma decisão da F3.2 ("a semana some, vira consulta sobre datas").
 *
 * A REGRA, E O QUE ELA CUSTA
 *   1. O mês é cortado a cada segunda-feira.
 *   2. Um pedaço de menos de 4 dias na ponta é absorvido pelo vizinho — o do
 *      começo pelo seguinte, o do fim pelo anterior.
 *
 *   Consequência: **todo mês tem 4 ou 5 semanas**, a primeira sempre começa no
 *   dia 1, a última sempre termina no último dia, e nenhum dia fica de fora.
 *
 *   O custo é que uma semana de ponta pode ter até 10 dias. Aceito de propósito:
 *   a alternativa é uma "Semana 01" de dois dias, que parece produção fraca
 *   quando é só calendário — e a leitura errada de um medidor é pior que uma
 *   semana comprida.
 *
 * ITEM SEM DATA NÃO TEM SEMANA
 *   E isso é informação, não falha: 73% dos itens do legado estão assim. São
 *   planejados, ainda não agendados. A tela os mostra à parte, nunca empurrados
 *   para uma semana arbitrária — empurrar seria reinventar a gaveta.
 */

export type Semana = {
  /** 1 a 5. */
  numero: number;
  /** `YYYY-MM-DD`, inclusivo. */
  de: string;
  /** `YYYY-MM-DD`, inclusivo. */
  ate: string;
  /** Quantos dias ela cobre — a tela avisa quando não são sete. */
  dias: number;
};

/** Menos que isto na ponta é resto, não semana. */
const MINIMO_DE_DIAS = 4;

const comoDia = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Aceita `YYYY-MM` ou `YYYY-MM-DD`. Sempre em UTC: fazer a conta no fuso local
 * faria a semana começar num dia diferente conforme quem abre a tela.
 */
export function semanasDoMes(mes: string): Semana[] {
  const ano = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  if (!Number.isInteger(ano) || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new Error(`Mês inválido: "${mes}".`);
  }

  const ultimoDia = new Date(Date.UTC(ano, m, 0)).getUTCDate();

  // Corta a cada segunda. `getUTCDay()`: 0 é domingo, 1 é segunda.
  const cortes: number[] = [1];
  for (let dia = 2; dia <= ultimoDia; dia++) {
    if (new Date(Date.UTC(ano, m - 1, dia)).getUTCDay() === 1) cortes.push(dia);
  }

  let faixas = cortes.map((inicio, i) => ({
    inicio,
    fim: i + 1 < cortes.length ? cortes[i + 1] - 1 : ultimoDia,
  }));

  // Absorve as pontas curtas. A ordem importa: o começo primeiro, senão um mês
  // com as duas pontas curtas absorveria a mesma faixa duas vezes.
  if (faixas.length > 1 && faixas[0].fim - faixas[0].inicio + 1 < MINIMO_DE_DIAS) {
    faixas = [{ inicio: faixas[0].inicio, fim: faixas[1].fim }, ...faixas.slice(2)];
  }
  const ultima = faixas.length - 1;
  if (faixas.length > 1 && faixas[ultima].fim - faixas[ultima].inicio + 1 < MINIMO_DE_DIAS) {
    faixas = [
      ...faixas.slice(0, ultima - 1),
      { inicio: faixas[ultima - 1].inicio, fim: faixas[ultima].fim },
    ];
  }

  return faixas.map((f, i) => ({
    numero: i + 1,
    de: comoDia(new Date(Date.UTC(ano, m - 1, f.inicio))),
    ate: comoDia(new Date(Date.UTC(ano, m - 1, f.fim))),
    dias: f.fim - f.inicio + 1,
  }));
}

/**
 * Em que semana cai uma data.
 *
 * Devolve `null` quando a data não é daquele mês — e não a semana mais próxima.
 * Aproximar aqui colocaria um item de julho dentro de agosto sem ninguém pedir,
 * e o medidor de agosto passaria a cobrar produção que não é dele.
 */
export function semanaDaData(mes: string, data: string): number | null {
  const dia = data.slice(0, 10);
  const semana = semanasDoMes(mes).find((s) => dia >= s.de && dia <= s.ate);
  return semana?.numero ?? null;
}

/** Rótulo curto do intervalo: `01–09 ago`. */
export function intervaloDaSemana(s: Semana): string {
  const mesCurto = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' })
    .format(new Date(`${s.de}T12:00:00Z`))
    .replace('.', '');
  return `${s.de.slice(8, 10)}–${s.ate.slice(8, 10)} ${mesCurto}`;
}
