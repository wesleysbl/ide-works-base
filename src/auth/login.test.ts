import { describe, expect, it, vi } from 'vitest';

import {
  type LoginPorts,
  DISABLED_ACCOUNT_MESSAGE,
  GENERIC_LOGIN_REFUSAL,
  attemptLogin,
} from '@/auth/login';

const AGORA = new Date('2026-08-19T12:00:00Z');
const PEDIDO = { email: 'fulano@exemplo.com.br', password: 'senha-certa', ip: '203.0.113.7' };

function ports(over: Partial<LoginPorts> = {}): LoginPorts {
  return {
    countAttempts: vi.fn(async () => 0),
    recordAttempt: vi.fn(async () => {}),
    reportFailure: vi.fn(),
    verifyPassword: vi.fn(async () => ({ ok: true as const, userId: 'user-1' })),
    findIdeWorksProfile: vi.fn(async () => ({ userId: 'user-1', isActive: true })),
    replacePreviousSession: vi.fn(async () => false),
    ...over,
  };
}

describe('caminho feliz', () => {
  it('entra com senha correta e perfil ativo', async () => {
    const r = await attemptLogin(PEDIDO, ports(), AGORA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.userId).toBe('user-1');
  });

  it('normaliza o e-mail antes de tudo', async () => {
    const p = ports();
    await attemptLogin({ ...PEDIDO, email: '  FULANO@Exemplo.com.BR ' }, p, AGORA);
    expect(p.verifyPassword).toHaveBeenCalledWith('fulano@exemplo.com.br', 'senha-certa');
  });

  it('avisa quando derrubou uma sessão anterior', async () => {
    const p = ports({ replacePreviousSession: async () => true });
    const r = await attemptLogin(PEDIDO, p, AGORA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sessionReplaced).toBe(true);
  });
});

describe('o usuário do sistema legado NÃO entra no IDE Works', () => {
  // Esta é a conferência que só existe porque a autenticação é compartilhada
  // com o Sistema IDE em produção (decisão D8). Sem ela, qualquer uma das 21
  // contas do legado contornaria o modelo de convite fechado.

  it('senha correta sem perfil no IDE Works é recusada', async () => {
    const p = ports({ findIdeWorksProfile: async () => null });
    const r = await attemptLogin(PEDIDO, p, AGORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_ideworks_profile');
  });

  it('a recusa é indistinguível de senha errada — não entrega quem é do legado', async () => {
    const semPerfil = await attemptLogin(PEDIDO, ports({ findIdeWorksProfile: async () => null }), AGORA);
    const senhaErrada = await attemptLogin(
      PEDIDO,
      ports({ verifyPassword: async () => ({ ok: false as const }) }),
      AGORA,
    );
    expect(semPerfil.ok).toBe(false);
    expect(senhaErrada.ok).toBe(false);
    if (!semPerfil.ok && !senhaErrada.ok) expect(semPerfil.message).toBe(senhaErrada.message);
  });

  it('não derruba sessão de quem não tinha direito de entrar', async () => {
    const p = ports({ findIdeWorksProfile: async () => null });
    await attemptLogin(PEDIDO, p, AGORA);
    expect(p.replacePreviousSession).not.toHaveBeenCalled();
  });
});

describe('conta desativada', () => {
  const desativada = () =>
    ports({ findIdeWorksProfile: async () => ({ userId: 'user-1', isActive: false }) });

  it('é barrada mesmo com senha válida', async () => {
    const r = await attemptLogin(PEDIDO, desativada(), AGORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('account_disabled');
  });

  it('tem motivo próprio, distinto de senha errada', async () => {
    const r = await attemptLogin(PEDIDO, desativada(), AGORA);
    if (!r.ok) {
      expect(r.message).toBe(DISABLED_ACCOUNT_MESSAGE);
      expect(r.message).not.toBe(GENERIC_LOGIN_REFUSAL);
    }
  });

  it('e isso não vaza nada: só se chega aqui DEPOIS de a senha bater', async () => {
    const p = ports({
      verifyPassword: async () => ({ ok: false as const }),
      // Espião de propósito: o teste precisa provar que ele NÃO foi chamado.
      findIdeWorksProfile: vi.fn(async () => ({ userId: 'user-1', isActive: false })),
    });
    const r = await attemptLogin(PEDIDO, p, AGORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe(GENERIC_LOGIN_REFUSAL);
    expect(p.findIdeWorksProfile).not.toHaveBeenCalled();
  });

  it('não derruba a sessão de conta desativada', async () => {
    const p = desativada();
    await attemptLogin(PEDIDO, p, AGORA);
    expect(p.replacePreviousSession).not.toHaveBeenCalled();
  });
});

describe('limitador (decisão D6)', () => {
  it('barra quando o teto por conta estoura', async () => {
    const p = ports({ countAttempts: async (_p, scope) => (scope === 'email' ? 5 : 0) });
    const r = await attemptLogin(PEDIDO, p, AGORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('rate_limited');
  });

  it('barrado responde a frase genérica — não confirma que a conta existe', async () => {
    const p = ports({ countAttempts: async () => 99 });
    const r = await attemptLogin(PEDIDO, p, AGORA);
    if (!r.ok) expect(r.message).toBe(GENERIC_LOGIN_REFUSAL);
  });

  it('barrado nem chega a conferir a senha', async () => {
    const p = ports({ countAttempts: async () => 99 });
    await attemptLogin(PEDIDO, p, AGORA);
    expect(p.verifyPassword).not.toHaveBeenCalled();
  });

  it('registra a tentativa ANTES de saber o resultado', async () => {
    // Contar só as que falham deixaria um ataque bem-sucedido sem rastro.
    const p = ports();
    await attemptLogin(PEDIDO, p, AGORA);
    expect(p.recordAttempt).toHaveBeenCalledWith('login', 'email', PEDIDO.email);
    expect(p.recordAttempt).toHaveBeenCalledWith('login', 'ip', PEDIDO.ip);
  });

  it('com o banco fora, o login continua respondendo e a falha vai para o registro', async () => {
    const p = ports({
      countAttempts: async () => {
        throw new Error('banco indisponível');
      },
    });
    const r = await attemptLogin(PEDIDO, p, AGORA);
    expect(r.ok).toBe(true);
    expect(p.reportFailure).toHaveBeenCalled();
  });
});

describe('este código nunca vê senha', () => {
  it('delega a conferência ao provedor, sem comparar nada', async () => {
    const p = ports();
    await attemptLogin(PEDIDO, p, AGORA);
    expect(p.verifyPassword).toHaveBeenCalledOnce();
  });

  it('senha errada devolve a frase genérica', async () => {
    const p = ports({ verifyPassword: async () => ({ ok: false as const }) });
    const r = await attemptLogin(PEDIDO, p, AGORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe(GENERIC_LOGIN_REFUSAL);
  });
});
