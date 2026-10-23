/**
 * O DIA DE UMA PEÇA MARCADA É O DE SÃO PAULO — revisão do planejamento, 09/10/2026.
 *
 * O QUE ESCAPAVA
 *   `scheduledAt` chega do servidor como um instante em UTC. `scheduledAt
 *   .slice(0, 10)` é o dia em UTC: a grade grava ao meio-dia e os dois relógios
 *   concordam, mas a peça marcada às 22h de Brasília chega como 01h do dia
 *   seguinte — caía na célula do dia errado (no último dia do mês, no mês
 *   errado) enquanto o Calendário e a "última entrega" a mostravam no dia certo.
 *
 *   `diaDoInstante` (src/ui/grade-do-mes.ts) é o recorte único. Este teste põe
 *   a regra onde ela não depende de lembrar: nenhuma tela nem regra recorta o
 *   dia de `scheduledAt` por posição.
 *
 * O CORTE EM SQL TAMBÉM (conferência de 09/10/2026)
 *   O Painel (`inPeriod`) e os relatórios do MCP cortavam o dia por
 *   `(scheduled_at at time zone 'UTC')::date`: a mesma peça das 22h do último
 *   dia do mês contava no mês SEGUINTE ali e no certo no Planejamento. Não era
 *   decisão — era o corte que ninguém revisou. Agora há um só (`diaDaPecaSql`,
 *   em `cliente-no-periodo.ts`), e este teste proíbe voltar: nenhuma consulta
 *   corta o dia em UTC, nem direto (`at time zone 'UTC'`) nem pelo fuso da
 *   sessão do banco (`scheduled_at::date`, que é UTC).
 *
 * O RÓTULO TAMBÉM (conferência de 09/10/2026, rodada 2)
 *   Quatro telas ainda escreviam o dia UTC de um instante na etiqueta
 *   ("registrado em", "revogada em", "convidado em", a data da publicação, a
 *   conclusão da demanda). O nome do campo diz o que ele é, e a convenção é
 *   do projeto inteiro: `…On` é um DIA (`dueOn`, `happenedOn`, `recordedOn`) e
 *   `…At`/`…Em` é um INSTANTE (`createdAt`, `completedAt`, `criadoEm`). Cortar
 *   `…At` em dez posições, ou passá-lo a um `dataCurta`/`dataLonga`/`diaCurto`
 *   (que cortam), é o dia UTC. `dataCurtaDoInstante`/`diaDoInstante` são os caminhos.
 *
 * O QUE ELE NÃO COBRE
 *   Função ou visão do banco (as migrations não se mexem daqui). A prova de que
 *   as telas e o MCP concordam é `o-dia-da-peca-banco.test.ts`, sobre o PGlite.
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

/** `scheduledAt` (ou `…scheduledAt as string)`) cortado em dez posições. */
const DIA_UTC_DA_PECA = /scheduledAt[^\n]*\.slice\(\s*0\s*,\s*10\s*\)/;

/**
 * `inactiveAt` cortado em dez posições: o "Inativo desde" mostrava o dia UTC do
 * cancelamento enquanto a regra do mês do cancelamento (`cliente-no-periodo.ts`)
 * usa o de São Paulo — cancelado às 22h do dia 31, a etiqueta dizia 1º do mês
 * seguinte e o cliente ainda contava no mês anterior.
 */
const DIA_UTC_DO_CANCELAMENTO = /inactiveAt[^\n]*\.slice\(\s*0\s*,\s*10\s*\)/;

/**
 * Qualquer INSTANTE (`…At`, ou `…Em` em português: `criadoEm`, `expiraEm`)
 * cortado em dez posições. `scheduledAt` e `inactiveAt` já têm regra própria
 * (com a frase certa); esta é a rede para todos os outros campos de instante —
 * `createdAt`, `completedAt`, `archivedAt`, `occurredAt`, `postedAt`, …
 */
const DIA_UTC_DE_UM_INSTANTE = /\b[A-Za-z]\w*(?:At|Em)\b(?:\s+as\s+string\))?\s*\.slice\(\s*0\s*,\s*10\s*\)/;

/**
 * Um instante entregue a um formatador de DIA que o corta por posição
 * (`dataCurta`, `dataLonga`, `diaCurto`): `dataCurta(d.completedAt)`.
 * Para instante, o formatador é `dataCurtaDoInstante` (ou `diaDoInstante`
 * antes de formatar). `diaEMes` fica de fora de propósito: em
 * `src/aprovacao/cliente.ts` ele já é um formatador de instante (Intl em
 * São Paulo), e o mesmo nome em `Captacao.tsx` recebe um dia.
 */
const INSTANTE_NO_FORMATADOR_DE_DIA =
  /\b(?:dataCurta|dataLonga|diaCurto)\(\s*[\w.?![\]]*(?:At|Em)\s*\)/;

/** Um instante virado em `Date` e lido em UTC: `new Date(x.createdAt).toISOString().slice(…)`, `.getUTCDate()`. */
const INSTANTE_LIDO_EM_UTC =
  /new Date\([^)\n]*(?:At|Em)\)\s*\.(?:toISOString\(\)\s*\.slice|getUTC(?:Date|Month|FullYear|Day))/;

/** `semanaDaData` quer um DIA; o instante cortado dentro dela é o dia UTC. */
const SEMANA_DO_INSTANTE = /semanaDaData\([^)\n]*scheduledAt/;

/** Dia cortado em UTC dentro de SQL: o fuso dito (`at time zone 'UTC'`, `timezone('UTC', …)`). */
const SQL_EM_UTC = /(?:at\s+time\s+zone|timezone\s*\()\s*'(?:UTC|Etc\/UTC|GMT|Z)'/i;

/**
 * Dia cortado pelo fuso da SESSÃO do banco, que é UTC: a coluna de instante
 * convertida direto em `date`.
 */
const SQL_NO_FUSO_DA_SESSAO = /\b(?:scheduled_at|completed_at|inactive_at)\s*\)?\s*::date\b/i;

const ehComentario = (linha: string) => /^\s*(\*|\/\/|\/\*|--)/.test(linha);

function reincidentesDe(regra: RegExp): string[] {
  const achados: string[] = [];
  for (const pasta of ['src', 'worker']) {
    for (const arquivo of fontes(join(RAIZ, pasta))) {
      readFileSync(arquivo, 'utf8')
        .split('\n')
        .forEach((linha, i) => {
          if (!ehComentario(linha) && regra.test(linha)) {
            achados.push(`${arquivo.slice(RAIZ.length + 1)}:${i + 1}`);
          }
        });
    }
  }
  return achados;
}

describe('o dia da peça marcada não sai do UTC', () => {
  it('nenhuma tela nem regra faz `scheduledAt.slice(0, 10)`', () => {
    expect(
      reincidentesDe(DIA_UTC_DA_PECA),
      'Use `diaDoInstante(scheduledAt)` (src/ui/grade-do-mes.ts): às 22h de Brasília o dia UTC da peça já é o seguinte.',
    ).toEqual([]);
  });

  it('nenhuma consulta corta o dia em UTC (`at time zone \'UTC\'`)', () => {
    expect(
      reincidentesDe(SQL_EM_UTC),
      'Use `diaDaPecaSql` (src/server/cliente-no-periodo.ts): o dia da peça é o de São Paulo, `at time zone AGENCY_TIMEZONE`.',
    ).toEqual([]);
  });

  it('nenhuma consulta converte `scheduled_at`/`completed_at`/`inactive_at` em `date` pelo fuso da sessão', () => {
    expect(
      reincidentesDe(SQL_NO_FUSO_DA_SESSAO),
      'O `::date` direto usa o fuso da sessão do banco (UTC). Passe por `at time zone AGENCY_TIMEZONE` (`diaDaPecaSql`).',
    ).toEqual([]);
  });

  it('o "Inativo desde" não corta `inactiveAt` por posição', () => {
    expect(
      reincidentesDe(DIA_UTC_DO_CANCELAMENTO),
      'Use `diaDoInstante(inactiveAt)` (src/ui/grade-do-mes.ts): o mês do cancelamento é o de São Paulo.',
    ).toEqual([]);
  });

  it('a semana da peça sai do DIA (`diaDaPeca`), e não do instante `scheduledAt`', () => {
    expect(
      reincidentesDe(SEMANA_DO_INSTANTE),
      '`semanaDaData` corta a string em dez posições: passe `diaDaPeca(peca)`.',
    ).toEqual([]);
  });

  it('nenhum campo de instante (`createdAt`, `completedAt`, `postedAt`, `criadoEm`…) é cortado em dez posições', () => {
    expect(
      reincidentesDe(DIA_UTC_DE_UM_INSTANTE),
      '`…At`/`…Em` é um instante: o corte por posição é o dia UTC. Use `diaDoInstante(x)` ou `dataCurtaDoInstante(x)` (src/ui/grade-do-mes.ts).',
    ).toEqual([]);
  });

  it('nenhum instante vai a um formatador de dia (`dataCurta`, `dataLonga`, `diaCurto`)', () => {
    expect(
      reincidentesDe(INSTANTE_NO_FORMATADOR_DE_DIA),
      '`dataCurta`/`dataLonga`/`diaCurto` cortam o texto em dez posições e servem a um DIA (`dueOn`, `happenedOn`). Para um instante: `dataCurtaDoInstante(x)`.',
    ).toEqual([]);
  });

  it('nenhum instante vira `Date` para ser lido em UTC (`.toISOString().slice`, `.getUTC…`)', () => {
    expect(
      reincidentesDe(INSTANTE_LIDO_EM_UTC),
      'O dia de um instante é o de São Paulo: `diaDoInstante(x)` (src/ui/grade-do-mes.ts).',
    ).toEqual([]);
  });

  it('as regras de instante pegam o que prometem e deixam o resto em paz', () => {
    const pega = (regra: RegExp, linhas: string[]) => linhas.map((l) => regra.test(l));
    expect(
      pega(DIA_UTC_DE_UM_INSTANTE, [
        'e.createdAt.slice(0, 10) !== e.happenedOn',
        "p.postedAt.slice(0,10).split('-')",
        '(row.completedAt as string).slice(0, 10)',
        'c.criadoEm.slice( 0 , 10 )',
      ]),
    ).toEqual([true, true, true, true]);
    expect(
      pega(DIA_UTC_DE_UM_INSTANTE, [
        'e.happenedOn.slice(0, 10)',
        'd.dueOn.slice(0, 10)',
        'recordedOn.slice(0, 7)',
        'format.slice(0, 10)',
        'diaDoInstante(e.createdAt) !== e.happenedOn',
      ]),
    ).toEqual([false, false, false, false, false]);

    expect(
      pega(INSTANTE_NO_FORMATADOR_DE_DIA, [
        'dataCurta(d.completedAt)',
        'dataCurta(c.criadoEm)',
        'dataCurta(minhas[0].occurredAt)',
        'diaCurto( e.archivedAt )',
      ]),
    ).toEqual([true, true, true, true]);
    expect(
      pega(INSTANTE_NO_FORMATADOR_DE_DIA, [
        'dataCurta(d.dueOn)',
        'dataCurta(diaDoInstante(c.inactiveAt))',
        'dataCurtaDoInstante(d.completedAt)',
        'diaEMes(c.decididaEm)',
      ]),
    ).toEqual([false, false, false, false]);

    expect(
      pega(INSTANTE_LIDO_EM_UTC, [
        'new Date(x.createdAt).toISOString().slice(0, 10)',
        'new Date(c.expiresAt).getUTCDate()',
      ]),
    ).toEqual([true, true]);
    expect(
      pega(INSTANTE_LIDO_EM_UTC, [
        'new Date(x.dueOn).getTime()',
        'new Date(`${mes}-01T12:00:00Z`).getUTCDate()',
      ]),
    ).toEqual([false, false]);
  });
});
