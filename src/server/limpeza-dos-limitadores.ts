/**
 * A LIMPEZA DIÁRIA DOS LIMITADORES — F44, Fase 7.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ELA APAGA
 *   Os dois limitadores que moram no banco — `integration_rate_events` (o freio
 *   dos agentes, F16.2b) e `auth_attempts` (login e ativação, F1.4) — só
 *   escreviam. Linha fora da janela nunca mais é contada, então ela sai: pelas
 *   funções `purge_integration_rate_events` e `purge_auth_attempts` (migration
 *   `20261009130000_ideworks_f44_5_limpezas.sql`), sob o ator `collector`.
 *
 * A JANELA SAI DAQUI, DOS TETOS DO CÓDIGO
 *   A MAIOR janela de cada limitador, lida das mesmas tabelas que os freios
 *   usam (`INTEGRATION_RATE_LIMITS`, `LIMITS`), mais uma folga. Escrever o
 *   número na migration o deixaria para trás no dia em que alguém aumentasse
 *   um teto — e a limpeza passaria a apagar linha que o freio ainda conta.
 *   A folga cobre a diferença entre o relógio do Worker (que calcula o `since`
 *   da contagem) e o do banco (que carimba e apaga): apagar um pouco depois
 *   da janela não custa nada; um pouco antes afrouxaria o limite.
 *
 * UMA VEZ POR DIA
 *   O gatilho bate a cada 15 minutos (`wrangler.toml`); a limpeza vai numa só
 *   batida — a das 06:00 UTC, 03:00 em São Paulo, a hora mais quieta da
 *   agência. Uma batida perdida só adia a limpeza para o dia seguinte: a
 *   tabela carrega mais um dia, e nada mais muda.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { LIMITS } from '@/auth/rate-limit';
import { INTEGRATION_RATE_LIMITS } from '@/integrations/limits';
import { type Sql, withActor } from '@/server/db';

/** A folga sobre a janela — ver o cabeçalho. */
export const FOLGA_DA_LIMPEZA_MS = 60_000;

/** A maior janela do freio dos agentes, com a folga, em segundos. */
export const JANELA_DA_LIMPEZA_DE_INTEGRACAO_S = Math.ceil(
  (Math.max(...Object.values(INTEGRATION_RATE_LIMITS).map((r) => r.windowMs)) + FOLGA_DA_LIMPEZA_MS) / 1000,
);

/** A maior janela do limitador de login e ativação, com a folga, em segundos. */
export const JANELA_DA_LIMPEZA_DE_TENTATIVAS_S = Math.ceil(
  (Math.max(
    ...Object.values(LIMITS).flatMap((porEscopo) => Object.values(porEscopo).map((r) => r.windowMinutes * 60_000)),
  ) +
    FOLGA_DA_LIMPEZA_MS) /
    1000,
);

/** A hora (UTC) da batida que limpa: 06:00 UTC = 03:00 em São Paulo. */
export const HORA_DA_LIMPEZA_UTC = 6;

/** O intervalo do gatilho, em minutos — os `crons` do `wrangler.toml`. */
const INTERVALO_DO_GATILHO_MIN = 15;

/**
 * Esta batida é a da limpeza diária?
 *
 * Verdadeiro só para a batida que cai em [06:00, 06:15) UTC — com o gatilho a
 * cada 15 minutos, exatamente uma por dia.
 */
export function ehBatidaDaLimpezaDiaria(instante: Date): boolean {
  return instante.getUTCHours() === HORA_DA_LIMPEZA_UTC && instante.getUTCMinutes() < INTERVALO_DO_GATILHO_MIN;
}

/**
 * O instante da batida: `scheduledTime` do evento do gatilho (a hora marcada,
 * em ms) quando a plataforma o manda; senão, agora. Pela hora MARCADA, e não
 * pela do relógio, porque a batida pode começar alguns segundos atrasada.
 */
export function instanteDaBatida(evento: object): Date {
  const marcado = (evento as Record<string, unknown>).scheduledTime;
  return typeof marcado === 'number' && Number.isFinite(marcado) ? new Date(marcado) : new Date();
}

export type LimpezaDosLimitadores = {
  /** Linhas apagadas de `integration_rate_events`. */
  integracao: number;
  /** Linhas apagadas de `auth_attempts`. */
  tentativas: number;
};

/**
 * Apaga, nas duas tabelas, o que passou da janela.
 *
 * UMA TRANSAÇÃO POR TABELA: o que a primeira apagou fica, mesmo que a segunda
 * falhe. A falha sobe para quem chamou (o `scheduled`), que a registra — mesma
 * regra das outras limpezas do gatilho —, e o que não saiu sai no dia seguinte.
 */
export async function limparLimitadores(sql: Sql): Promise<LimpezaDosLimitadores> {
  const integracao = await withActor(sql, { kind: 'collector' }, async (tx) => {
    const [linha] = await tx`
      select ideworks.purge_integration_rate_events(${JANELA_DA_LIMPEZA_DE_INTEGRACAO_S}::int) as apagadas`;
    return Number(linha?.apagadas ?? 0);
  });
  const tentativas = await withActor(sql, { kind: 'collector' }, async (tx) => {
    const [linha] = await tx`
      select ideworks.purge_auth_attempts(${JANELA_DA_LIMPEZA_DE_TENTATIVAS_S}::int) as apagadas`;
    return Number(linha?.apagadas ?? 0);
  });
  return { integracao, tentativas };
}
