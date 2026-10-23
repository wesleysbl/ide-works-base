import { describe, expect, it, vi } from 'vitest';

import {
  type RateLimitPorts,
  LIMITS,
  checkRateLimit,
  recordAttempt,
} from '@/auth/rate-limit';

const AGORA = new Date('2026-08-19T12:00:00Z');
const QUEM = { email: 'fulano@exemplo.com.br', ip: '203.0.113.7' };

function ports(over: Partial<RateLimitPorts> = {}): RateLimitPorts {
  return {
    countAttempts: vi.fn(async () => 0),
    recordAttempt: vi.fn(async () => {}),
    reportFailure: vi.fn(),
    ...over,
  };
}

describe('os tetos do documento de acesso', () => {
  it('login por conta: 5 em 15 minutos', () => {
    expect(LIMITS.login.email).toEqual({ max: 5, windowMinutes: 15 });
  });
  it('login por origem: 10 em 15 minutos', () => {
    expect(LIMITS.login.ip).toEqual({ max: 10, windowMinutes: 15 });
  });
  it('ativação por conta: 10 em 15 minutos', () => {
    expect(LIMITS.activation.email).toEqual({ max: 10, windowMinutes: 15 });
  });
  it('ativação por origem: 20 em 15 minutos', () => {
    expect(LIMITS.activation.ip).toEqual({ max: 20, windowMinutes: 15 });
  });
});

describe('checkRateLimit', () => {
  it('deixa passar quem está dentro do teto', async () => {
    const v = await checkRateLimit('login', QUEM, ports({ countAttempts: async () => 4 }), AGORA);
    expect(v.allowed).toBe(true);
  });

  it('barra ao atingir o teto — o quinto erro já bloqueia o sexto', async () => {
    const v = await checkRateLimit('login', QUEM, ports({ countAttempts: async () => 5 }), AGORA);
    expect(v.allowed).toBe(false);
    expect(v.blockedBy).toBe('email');
  });

  it('barra por origem mesmo com a conta limpa — proxy e rede de máquinas', async () => {
    const p = ports({
      countAttempts: async (_purpose, scope) => (scope === 'email' ? 0 : 10),
    });
    const v = await checkRateLimit('login', QUEM, p, AGORA);
    expect(v.allowed).toBe(false);
    expect(v.blockedBy).toBe('ip');
  });

  it('barra por conta mesmo com a origem limpa — quem tem muitos endereços', async () => {
    const p = ports({
      countAttempts: async (_purpose, scope) => (scope === 'email' ? 5 : 0),
    });
    const v = await checkRateLimit('login', QUEM, p, AGORA);
    expect(v.allowed).toBe(false);
    expect(v.blockedBy).toBe('email');
  });

  it('a janela é deslizante e calculada a partir de agora', async () => {
    const p = ports();
    await checkRateLimit('login', QUEM, p, AGORA);
    expect(p.countAttempts).toHaveBeenCalledWith(
      'login',
      'email',
      QUEM.email,
      new Date('2026-08-19T11:45:00Z'),
    );
  });

  it('usa tetos diferentes para ativação e para login', async () => {
    const p = ports({ countAttempts: async () => 7 });
    // 7 passa do teto de login por conta (5) mas não do de ativação (10).
    expect((await checkRateLimit('login', QUEM, p, AGORA)).allowed).toBe(false);
    expect((await checkRateLimit('activation', QUEM, p, AGORA)).allowed).toBe(true);
  });
});

describe('falha aberta — com o banco fora, a tentativa passa', () => {
  const quebrado = () =>
    ports({
      countAttempts: async () => {
        throw new Error('banco indisponível');
      },
    });

  it('deixa passar em vez de trancar quem precisa entrar para consertar', async () => {
    const v = await checkRateLimit('login', QUEM, quebrado(), AGORA);
    expect(v.allowed).toBe(true);
    expect(v.failedOpen).toBe(true);
  });

  it('grita a falha — silêncio aqui transformaria a trava em teatro', async () => {
    const p = quebrado();
    await checkRateLimit('login', QUEM, p, AGORA);
    expect(p.reportFailure).toHaveBeenCalled();
  });

  it('distingue "passou por estar dentro do teto" de "passou por indisponibilidade"', async () => {
    const normal = await checkRateLimit('login', QUEM, ports(), AGORA);
    expect(normal.allowed).toBe(true);
    expect(normal.failedOpen).toBe(false);
  });
});

describe('recordAttempt', () => {
  it('registra nas duas dimensões — conta e origem', async () => {
    const p = ports();
    await recordAttempt('login', QUEM, p);
    expect(p.recordAttempt).toHaveBeenCalledWith('login', 'email', QUEM.email);
    expect(p.recordAttempt).toHaveBeenCalledWith('login', 'ip', QUEM.ip);
  });

  it('falha ao registrar não derruba a operação — o registro é o extra', async () => {
    const p = ports({
      recordAttempt: async () => {
        throw new Error('sem banco');
      },
    });
    await expect(recordAttempt('login', QUEM, p)).resolves.toBeUndefined();
    expect(p.reportFailure).toHaveBeenCalled();
  });
});
