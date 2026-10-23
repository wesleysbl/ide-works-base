/**
 * A janela e a batida da limpeza dos limitadores — F44, Fase 7. Regra pura;
 * o banco está em `limpezas-f44-banco.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { LIMITS } from '@/auth/rate-limit';
import { INTEGRATION_RATE_LIMITS } from '@/integrations/limits';
import {
  FOLGA_DA_LIMPEZA_MS,
  HORA_DA_LIMPEZA_UTC,
  JANELA_DA_LIMPEZA_DE_INTEGRACAO_S,
  JANELA_DA_LIMPEZA_DE_TENTATIVAS_S,
  ehBatidaDaLimpezaDiaria,
  instanteDaBatida,
} from '@/server/limpeza-dos-limitadores';

describe('a janela da limpeza', () => {
  it('nunca é menor que a maior janela que um freio conta — senão a limpeza afrouxaria o limite', () => {
    for (const regra of Object.values(INTEGRATION_RATE_LIMITS)) {
      expect(JANELA_DA_LIMPEZA_DE_INTEGRACAO_S * 1000).toBeGreaterThanOrEqual(regra.windowMs + FOLGA_DA_LIMPEZA_MS);
    }
    for (const porEscopo of Object.values(LIMITS)) {
      for (const regra of Object.values(porEscopo)) {
        expect(JANELA_DA_LIMPEZA_DE_TENTATIVAS_S * 1000).toBeGreaterThanOrEqual(
          regra.windowMinutes * 60_000 + FOLGA_DA_LIMPEZA_MS,
        );
      }
    }
  });

  it('é a maior janela de hoje mais um minuto: 2 min para os agentes, 16 min para o login', () => {
    // Se um teto mudar, este número muda junto — é o que se quer. O teste
    // acima é a garantia; este só registra o valor de 09/10/2026.
    expect(JANELA_DA_LIMPEZA_DE_INTEGRACAO_S).toBe(120);
    expect(JANELA_DA_LIMPEZA_DE_TENTATIVAS_S).toBe(960);
  });

  it('cabe na faixa que o banco aceita (de 1 minuto a 7 dias)', () => {
    for (const s of [JANELA_DA_LIMPEZA_DE_INTEGRACAO_S, JANELA_DA_LIMPEZA_DE_TENTATIVAS_S]) {
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(60);
      expect(s).toBeLessThanOrEqual(7 * 24 * 3600);
    }
  });
});

describe('a batida da limpeza', () => {
  it('é exatamente uma das 96 batidas do dia: a das 06:00 UTC', () => {
    const meiaNoite = Date.parse('2026-10-10T00:00:00.000Z');
    const quais = Array.from({ length: 96 }, (_, i) => new Date(meiaNoite + i * 15 * 60_000)).filter(
      ehBatidaDaLimpezaDiaria,
    );
    expect(quais.map((d) => d.toISOString())).toEqual(['2026-10-10T06:00:00.000Z']);
    expect(HORA_DA_LIMPEZA_UTC).toBe(6);
  });

  it('a batida atrasada continua sendo a das 06:00 até 06:14:59', () => {
    expect(ehBatidaDaLimpezaDiaria(new Date('2026-10-10T06:14:59.999Z'))).toBe(true);
    expect(ehBatidaDaLimpezaDiaria(new Date('2026-10-10T06:15:00.000Z'))).toBe(false);
    expect(ehBatidaDaLimpezaDiaria(new Date('2026-10-10T05:59:59.999Z'))).toBe(false);
  });

  it('lê a hora marcada do evento; sem ela (ou torta), usa o relógio', () => {
    const marcada = Date.parse('2026-10-10T06:00:00.000Z');
    expect(instanteDaBatida({ cron: '*/15 * * * *', scheduledTime: marcada }).getTime()).toBe(marcada);

    const antes = Date.now();
    for (const evento of [{ cron: '*/15 * * * *' }, { cron: 'x', scheduledTime: 'ontem' }, { scheduledTime: NaN }]) {
      const t = instanteDaBatida(evento).getTime();
      expect(t).toBeGreaterThanOrEqual(antes);
      expect(t).toBeLessThanOrEqual(Date.now());
    }
  });
});
