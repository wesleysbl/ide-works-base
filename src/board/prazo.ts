/**
 * COMO O PRAZO SE LÊ NO CARTÃO E NA LINHA — F06B do plano UX.
 *
 * O cartão escrevia `28/09/2026 · atrasada` e a linha escrevia `28/09/2026`
 * sozinho, com a cor dizendo o resto. Duas leituras da mesma data, e uma delas
 * dependia só da cor — que não chega a quem não distingue o vermelho, nem a
 * quem ouve a tela.
 *
 * AQUI HÁ UMA LEITURA SÓ, EM TRÊS CAMADAS
 *   · `estado` — o que o prazo quer dizer hoje (vira `data-estado` e tom);
 *   · `curto`  — o que cabe no rodapé: `Hoje`, `Amanhã`, `Atrasada · 25/09`,
 *                `03/10` (o ano só aparece quando não é o de hoje);
 *   · `completo` — a frase inteira, com a data inteira, para o `title` e para
 *                  o leitor de tela: `Prazo vencido em 25/09/2026`.
 *
 * O ATRASO ESTÁ NA PALAVRA, e não só na cor. `Hoje` e `Amanhã` também. `Em
 * breve` (dois a seis dias) muda só o tom: a data curta já diz quando, e uma
 * palavra a mais em cada cartão da semana seria ruído.
 *
 * NADA AQUI MUDA O QUE SE GUARDA. `dueOn` continua `aaaa-mm-dd`; isto é só
 * leitura, sem `Date` (o fuso do navegador não mexe no dia — mesma regra de
 * `etiquetaDePrazo`).
 */

import { type Day, dueState, formatDay, parseDay } from '@/board/board';
import { diasDesdeEpoca } from '@/board/calendario';

export type EstadoDoPrazo =
  | 'atrasada'
  | 'hoje'
  | 'amanha'
  | 'embreve'
  | 'futura'
  | 'concluida'
  | 'ilegivel';

export type LeituraDoPrazo = {
  estado: EstadoDoPrazo;
  /** O que se escreve no cartão/linha. */
  curto: string;
  /** A frase inteira, com a data inteira — `title` e leitor de tela. */
  completo: string;
};

/** Até quantos dias à frente o prazo é "em breve". */
export const DIAS_EM_BREVE = 6;

const pad = (n: number) => String(n).padStart(2, '0');

/** `25/09` no ano de hoje; `25/09/2027` fora dele. */
export function dataCurta(prazo: Day, hoje: Day): string {
  const base = `${pad(prazo.day)}/${pad(prazo.month)}`;
  return prazo.year === hoje.year ? base : `${base}/${prazo.year}`;
}

export function lerPrazo(
  tarefa: { dueOn: string | null; completedAt: string | null },
  hoje: Day,
): LeituraDoPrazo | null {
  const estado = dueState(tarefa, hoje);
  if (estado === 'nenhum') return null;
  if (estado === 'ilegivel') {
    return { estado, curto: 'prazo ilegível', completo: `Prazo ilegível — valor no banco: ${tarefa.dueOn}` };
  }

  const prazo = parseDay(tarefa.dueOn) as Day;
  const inteira = formatDay(tarefa.dueOn) as string;
  const curta = dataCurta(prazo, hoje);

  if (estado === 'concluida') {
    return { estado, curto: curta, completo: `Prazo ${inteira} — tarefa já concluída` };
  }
  if (estado === 'atrasada') {
    return { estado, curto: `Atrasada · ${curta}`, completo: `Prazo vencido em ${inteira}` };
  }
  if (estado === 'hoje') return { estado, curto: 'Hoje', completo: `Vence hoje, ${inteira}` };

  const dias = diasDesdeEpoca(prazo) - diasDesdeEpoca(hoje);
  if (dias === 1) return { estado: 'amanha', curto: 'Amanhã', completo: `Vence amanhã, ${inteira}` };
  if (dias <= DIAS_EM_BREVE) {
    return { estado: 'embreve', curto: curta, completo: `Vence em ${dias} dias, ${inteira}` };
  }
  return { estado: 'futura', curto: curta, completo: `Prazo ${inteira}` };
}
