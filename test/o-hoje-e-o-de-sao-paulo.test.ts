/**
 * "HOJE" É O DIA DE SÃO PAULO — conferência de 08/10/2026.
 *
 * O QUE ESCAPAVA
 *   `new Date().toISOString().slice(0, 10)` é o dia em UTC. Em Brasília, a
 *   partir das 21h ele já é o dia seguinte — e no último dia do mês, o mês
 *   seguinte. A agência trabalha até tarde, e o defeito aparecia em coisas que
 *   ninguém liga ao fuso: o Painel abrindo em novembro no dia 31 de outubro às
 *   22h, "Últimos 7 dias" terminando amanhã, o registro de histórico e a
 *   captação nascendo com a data de amanhã.
 *
 *   A F17.AUD07 e a F12 do plano UX já tinham consertado dois desses lugares
 *   (a ficha do cliente novo e o calendário) e deixado a regra só nos
 *   comentários. Este teste a põe onde ela não depende de lembrar: o dia de
 *   "hoje" que a TELA ou a ROTA usam vem de `hojeNaAgencia` / `diaDeSaoPaulo`.
 *
 * O QUE ELE NÃO COBRE
 *   Conta de data que parte de uma data JÁ ESCOLHIDA (somar dias a um
 *   `AAAA-MM-DD`) é aritmética de calendário e continua em UTC de propósito —
 *   não passa por aqui. Só a expressão de "agora" convertida direto em texto.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

function fontes(pasta: string): string[] {
  const achados: string[] = [];
  for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
    const caminho = join(pasta, entrada.name);
    if (entrada.isDirectory()) achados.push(...fontes(caminho));
    else if (['.ts', '.tsx'].includes(extname(entrada.name)) && !/\.test\.tsx?$/.test(entrada.name)) {
      achados.push(caminho);
    }
  }
  return achados;
}

/** "Agora" convertido direto em dia (`slice(0, 10)`) ou em mês (`slice(0, 7)`). */
const DIA_UTC_DE_AGORA = /new Date\(\)\s*\.toISOString\(\)\s*\.slice\(\s*0\s*,\s*(7|10)\s*\)/;

const ehComentario = (linha: string) => /^\s*(\*|\/\/|\/\*)/.test(linha);

describe('o dia de "hoje" não sai do UTC', () => {
  it('nenhuma tela nem rota faz `new Date().toISOString().slice(0, 10|7)`', () => {
    const reincidentes: string[] = [];
    for (const pasta of ['src', 'worker']) {
      for (const arquivo of fontes(join(RAIZ, pasta))) {
        readFileSync(arquivo, 'utf8')
          .split('\n')
          .forEach((linha, i) => {
            if (!ehComentario(linha) && DIA_UTC_DE_AGORA.test(linha)) {
              reincidentes.push(`${arquivo.slice(RAIZ.length + 1)}:${i + 1}`);
            }
          });
      }
    }
    expect(
      reincidentes,
      'Use `hojeNaAgencia()` / `mesDeHoje()` (src/ui/grade-do-mes.ts) ou `diaDeSaoPaulo()` ' +
        '(src/server/semana-do-controle.ts): às 21h de Brasília o dia UTC já é o seguinte.',
    ).toEqual([]);
  });
});
