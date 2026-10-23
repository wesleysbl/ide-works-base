import { describe, expect, it, vi } from 'vitest';

import {
  type AccountStatusPorts,
  type ActiveSession,
  type SessionPorts,
  SESSION_REPLACED_MESSAGE,
  decideAccountStatusChange,
  decideSessionReplacement,
} from '@/auth/session';

const USER = 'user-1';

const navegador = (id: string): ActiveSession => ({ id, userId: USER, kind: 'browser' });
const programatico = (id: string, clientId: string): ActiveSession => ({
  id,
  userId: USER,
  kind: 'programmatic',
  clientId,
});

function ports(active: ActiveSession[] = [], live = true): SessionPorts {
  return {
    listActiveSessions: vi.fn(async () => active),
    isProgrammaticAccessLive: vi.fn(async () => live),
  };
}

describe('um dispositivo por vez', () => {
  it('entrar no navegador derruba a sessão de navegador anterior', async () => {
    const d = await decideSessionReplacement(
      { userId: USER, kind: 'browser' },
      ports([navegador('s1')]),
    );
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.revoke).toEqual(['s1']);
  });

  it('sem sessão anterior, não derruba nada', async () => {
    const d = await decideSessionReplacement({ userId: USER, kind: 'browser' }, ports([]));
    if (d.ok) expect(d.revoke).toEqual([]);
  });

  it('derruba todas as de navegador, não só a última', async () => {
    const d = await decideSessionReplacement(
      { userId: USER, kind: 'browser' },
      ports([navegador('s1'), navegador('s2')]),
    );
    if (d.ok) expect(d.revoke).toEqual(['s1', 's2']);
  });

  it('a mensagem diz "substituída", não "sessão inválida"', () => {
    expect(SESSION_REPLACED_MESSAGE).toContain('substituída');
    expect(SESSION_REPLACED_MESSAGE).not.toContain('inválida');
  });
});

describe('abrir no navegador NÃO mata o acesso programático', () => {
  // Esta é a regressão que o sistema de origem sofreu: a sessão do conector era
  // tratada como mais um dispositivo, então abrir o sistema no navegador o
  // derrubava.

  it('login de navegador não encosta em sessão programática', async () => {
    const d = await decideSessionReplacement(
      { userId: USER, kind: 'browser' },
      ports([navegador('s1'), programatico('p1', 'conector')]),
    );
    if (d.ok) {
      expect(d.revoke).toContain('s1');
      expect(d.revoke).not.toContain('p1');
    }
  });

  it('acesso programático não derruba quem está no navegador', async () => {
    const d = await decideSessionReplacement(
      { userId: USER, kind: 'programmatic', clientId: 'conector' },
      ports([navegador('s1')]),
    );
    if (d.ok) expect(d.revoke).toEqual([]);
  });

  it('acesso programático substitui só o anterior do MESMO cliente', async () => {
    const d = await decideSessionReplacement(
      { userId: USER, kind: 'programmatic', clientId: 'conector' },
      ports([programatico('p1', 'conector'), programatico('p2', 'outro')]),
    );
    if (d.ok) expect(d.revoke).toEqual(['p1']);
  });
});

describe('a isenção é conferida contra o banco', () => {
  it('não basta o programa DIZER que é isento', async () => {
    const d = await decideSessionReplacement(
      { userId: USER, kind: 'programmatic', clientId: 'inventado' },
      ports([], false),
    );
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('unauthorized_programmatic_access');
  });

  it('recusa quem se diz programático sem identificar o cliente', async () => {
    const d = await decideSessionReplacement({ userId: USER, kind: 'programmatic' }, ports());
    expect(d.ok).toBe(false);
  });

  it('recusa identificador vazio', async () => {
    const d = await decideSessionReplacement(
      { userId: USER, kind: 'programmatic', clientId: '' },
      ports(),
    );
    expect(d.ok).toBe(false);
  });

  it('não autorizado NÃO vira sessão de navegador por engano', async () => {
    const p = ports([navegador('s1')], false);
    const d = await decideSessionReplacement(
      { userId: USER, kind: 'programmatic', clientId: 'inventado' },
      p,
    );
    expect(d.ok).toBe(false);
    // Se tivesse virado sessão de navegador, teria derrubado s1.
    expect(p.listActiveSessions).not.toHaveBeenCalled();
  });

  it('a autorização é consultada antes de qualquer decisão', async () => {
    const p = ports([], true);
    await decideSessionReplacement(
      { userId: USER, kind: 'programmatic', clientId: 'conector' },
      p,
    );
    expect(p.isProgrammaticAccessLive).toHaveBeenCalledWith('conector');
  });
});

describe('desativar e reativar conta', () => {
  const statusPorts = (superadmin = false): AccountStatusPorts => ({
    isSuperadmin: vi.fn(async () => superadmin),
  });

  it('desativar encerra todas as sessões na hora', async () => {
    const d = await decideAccountStatusChange(
      { targetUserId: 'alvo', actorUserId: 'admin', disable: true },
      statusPorts(),
    );
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.revokeAllSessions).toBe(true);
  });

  it('reativar não devolve sessão — a pessoa entra de novo, normalmente', async () => {
    const d = await decideAccountStatusChange(
      { targetUserId: 'alvo', actorUserId: 'admin', disable: false },
      statusPorts(),
    );
    if (d.ok) expect(d.revokeAllSessions).toBe(false);
  });

  it('ninguém desativa a própria conta', async () => {
    const d = await decideAccountStatusChange(
      { targetUserId: 'admin', actorUserId: 'admin', disable: true },
      statusPorts(),
    );
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('cannot_disable_self');
  });

  it('administrador de topo não desativa outro de topo', async () => {
    const d = await decideAccountStatusChange(
      { targetUserId: 'outro-topo', actorUserId: 'admin', disable: true },
      statusPorts(true),
    );
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.reason).toBe('cannot_disable_superadmin');
      expect(d.message).toContain('Redefinir a senha dele é permitido');
    }
  });

  it('mas REATIVAR um administrador de topo é permitido', async () => {
    const d = await decideAccountStatusChange(
      { targetUserId: 'outro-topo', actorUserId: 'admin', disable: false },
      statusPorts(true),
    );
    expect(d.ok).toBe(true);
  });
});
