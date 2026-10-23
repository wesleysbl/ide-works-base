/** Exercita as rotas reais do Worker com banco e provedor simulados. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { attemptLogin } from '@/auth/login';
import { refreshWithProvider, revokeSessionWithProvider } from '@/server/ports';

vi.mock('@/server/db', async (original) => ({
  ...await original<typeof import('@/server/db')>(),
  connect: () => ({ end: async () => {} }),
}));
vi.mock('@/auth/login', () => ({ attemptLogin: vi.fn() }));
vi.mock('@/server/ports', async (original) => ({
  ...await original<typeof import('@/server/ports')>(),
  loginPorts: (_sql: unknown, _provider: unknown, _log: unknown,
    emit: (tokens: { accessToken: string; refreshToken: string }) => void) => {
    emit({ accessToken: 'test-access', refreshToken: 'test-refresh' });
    return {};
  },
  refreshWithProvider: vi.fn(),
  revokeSessionWithProvider: vi.fn(),
}));

const env = {
  IDEWORKS_PUBLIC_SUPABASE_URL: 'https://provider.invalid',
  IDEWORKS_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
};
const now = 1_800_000_000;
const request = (path: string, body: unknown, cookie?: string) => worker.fetch(
  new Request(`https://app.invalid/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  }), env,
);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now * 1000);
  vi.mocked(attemptLogin).mockResolvedValue({ ok: true, userId: 'test-user', sessionReplaced: false });
  vi.mocked(refreshWithProvider).mockResolvedValue({ ok: true, accessToken: 'new-access', refreshToken: 'new-refresh' });
});
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

describe('Sair encerra a sessão no provedor, mesmo com o crachá de acesso vencido', () => {
  // O crachá de acesso vive UMA hora; o cookie dele vive o dia inteiro. Quem volta
  // a uma aba parada e clica em Sair leva ao Worker um crachá já morto: o
  // provedor recusa a revogação com ele, o cookie era apagado, e o crachá de
  // RENOVAÇÃO continuava valendo no provedor para quem o tivesse copiado.
  const cookies = `ideworks_sessao=access-vencido; ideworks_renovacao=test-refresh~${now + 43_200}`;

  it('o provedor recusa o crachá vencido: renova uma última vez e revoga com o novo', async () => {
    vi.mocked(revokeSessionWithProvider).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const response = await request('logout', {}, cookies);
    expect(response.status).toBe(200);
    expect(refreshWithProvider).toHaveBeenCalledTimes(1);
    expect(vi.mocked(refreshWithProvider).mock.calls[0][1]).toBe('test-refresh');
    expect(vi.mocked(revokeSessionWithProvider).mock.calls.map((c) => c[1])).toEqual([
      'access-vencido',
      'new-access',
    ]);
    for (const cookie of response.headers.getSetCookie()) expect(cookie).toContain('Max-Age=0');
  });

  it('o crachá de acesso valeu: revoga e não gasta uma renovação à toa', async () => {
    vi.mocked(revokeSessionWithProvider).mockResolvedValue(true);
    await request('logout', {}, cookies);
    expect(refreshWithProvider).not.toHaveBeenCalled();
    expect(revokeSessionWithProvider).toHaveBeenCalledTimes(1);
  });

  it('sem o cookie de acesso, só com o de renovação, também encerra no provedor', async () => {
    vi.mocked(revokeSessionWithProvider).mockResolvedValue(true);
    await request('logout', {}, `ideworks_renovacao=test-refresh~${now + 43_200}`);
    expect(vi.mocked(revokeSessionWithProvider).mock.calls.map((c) => c[1])).toEqual(['new-access']);
  });

  it('o provedor fora do ar não segura a saída: os cookies saem do mesmo jeito', async () => {
    vi.mocked(revokeSessionWithProvider).mockResolvedValue(false);
    vi.mocked(refreshWithProvider).mockResolvedValue({ ok: false, motivo: 'indisponivel' });
    const response = await request('logout', {}, cookies);
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toHaveLength(2);
  });

  it('sem cookie nenhum não há o que encerrar, e a saída responde ok', async () => {
    const response = await request('logout', {});
    expect(response.status).toBe(200);
    expect(refreshWithProvider).not.toHaveBeenCalled();
    expect(revokeSessionWithProvider).not.toHaveBeenCalled();
  });
});

describe('duração da sessão escolhida no login', () => {
  it.each([
    [true, 2_592_000], [false, 43_200], [undefined, 43_200], ['true', 43_200], [1, 43_200],
  ])('preferência %s grava cookies com duração %s', async (rememberMe, duration) => {
    const response = await request('login', { email: 'test@example.invalid', password: 'fake', rememberMe });
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) {
      expect(cookie).toContain(`Max-Age=${duration}`);
      expect(cookie).toContain('HttpOnly; SameSite=Strict; Secure');
    }
    expect(cookies[1]).toContain(`test-refresh~${now + Number(duration)}`);
  });

  it('login recusado não grava cookies persistentes', async () => {
    vi.mocked(attemptLogin).mockResolvedValue({ ok: false, reason: 'bad_credentials', message: 'Recusado' });
    const response = await request('login', { email: 'test@example.invalid', password: 'fake', rememberMe: true });
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('renovar no dia seguinte mantém o vencimento original dos 30 dias', async () => {
    const limit = now + 2_592_000;
    vi.setSystemTime((now + 86_400) * 1000);
    const response = await request('refresh', {}, `ideworks_renovacao=test-refresh~${limit}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, crachaValePor: null, expiresAt: limit });
    for (const cookie of response.headers.getSetCookie()) expect(cookie).toContain('Max-Age=2505600');
    expect(response.headers.getSetCookie()[1]).toContain(`new-refresh~${limit}`);
  });

  it('ao completar 30 dias, recusa a renovação e apaga os cookies', async () => {
    const limit = now + 2_592_000;
    vi.setSystemTime(limit * 1000);
    const response = await request('refresh', {}, `ideworks_renovacao=test-refresh~${limit}`);
    expect(response.status).toBe(401);
    expect(revokeSessionWithProvider).toHaveBeenCalled();
    for (const cookie of response.headers.getSetCookie()) expect(cookie).toContain('Max-Age=0');
  });

  it('Sair apaga os dois cookies mesmo antes dos 30 dias', async () => {
    const response = await request('logout', {}, `ideworks_sessao=test-access; ideworks_renovacao=test-refresh~${now + 2_592_000}`);
    expect(response.status).toBe(200);
    expect(revokeSessionWithProvider).toHaveBeenCalled();
    expect(response.headers.getSetCookie()).toHaveLength(2);
    for (const cookie of response.headers.getSetCookie()) expect(cookie).toContain('Max-Age=0');
  });
});
