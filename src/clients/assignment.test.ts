import { describe, expect, it, vi } from 'vitest';

import {
  type AssignmentPorts,
  type AssignmentTarget,
  decideAccessScope,
  decideAssignClient,
} from '@/clients/assignment';

const admin = { userId: 'admin', isSuperadmin: true };
const membro = { userId: 'membro', isSuperadmin: false };
const CLIENTE = 'cliente-1';

function ports(over: Partial<AssignmentTarget> = {}, clientExists = true): AssignmentPorts {
  return {
    findTarget: vi.fn(async () => ({
      userId: 'alvo',
      hasProfile: true,
      hasAllClientsAccess: false,
      ...over,
    })),
    clientExists: vi.fn(async () => clientExists),
  };
}

describe('só administrador mexe em carteira', () => {
  it('membro comum não atribui cliente', async () => {
    const d = await decideAssignClient(membro, 'alvo', CLIENTE, ports());
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('not_superadmin');
  });

  it('membro comum não muda alcance de acesso', async () => {
    const d = await decideAccessScope(membro, { targetUserId: 'alvo', grantAll: true }, ports());
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('not_superadmin');
  });

  it('a permissão é conferida ANTES de consultar qualquer coisa', async () => {
    const p = ports();
    await decideAssignClient(membro, 'alvo', CLIENTE, p);
    expect(p.findTarget).not.toHaveBeenCalled();
  });
});

describe('não se cria vínculo órfão', () => {
  it('recusa quem não tem conta no IDE Works', async () => {
    const d = await decideAssignClient(admin, 'alvo', CLIENTE, ports({ hasProfile: false }));
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.reason).toBe('target_has_no_profile');
      expect(d.message).toContain('Crie o acesso antes');
    }
  });

  it('recusa quem não existe de todo', async () => {
    const p: AssignmentPorts = { findTarget: async () => null, clientExists: async () => true };
    const d = await decideAssignClient(admin, 'fantasma', CLIENTE, p);
    expect(d.ok).toBe(false);
  });

  it('recusa cliente inexistente', async () => {
    const d = await decideAssignClient(admin, 'alvo', 'nao-existe', ports({}, false));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('client_not_found');
  });
});

describe('acesso amplo e vínculo convivem', () => {
  it('atribuir a quem já vê tudo é aceito, mas avisado', async () => {
    const d = await decideAssignClient(
      admin,
      'alvo',
      CLIENTE,
      ports({ hasAllClientsAccess: true }),
    );
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.redundant).toBe(true);
      expect(d.note).toContain('não muda nada agora');
    }
  });

  it('o vínculo é gravado assim mesmo — sobrevive à retirada do acesso amplo', async () => {
    const d = await decideAssignClient(
      admin,
      'alvo',
      CLIENTE,
      ports({ hasAllClientsAccess: true }),
    );
    // `ok: true` significa "grave". Recusar aqui deixaria a pessoa sem nada no
    // dia em que o acesso amplo fosse retirado.
    expect(d.ok).toBe(true);
  });

  it('atribuir a quem não vê tudo não é redundante', async () => {
    const d = await decideAssignClient(admin, 'alvo', CLIENTE, ports());
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.redundant).toBe(false);
  });
});

describe('mudança de alcance', () => {
  it('dar acesso amplo mantém os vínculos', async () => {
    const d = await decideAccessScope(admin, { targetUserId: 'alvo', grantAll: true }, ports());
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.keepAssignments).toBe(true);
      expect(d.note).toContain('continuam guardados');
    }
  });

  it('retirar acesso amplo devolve a carteira que já existia', async () => {
    const d = await decideAccessScope(admin, { targetUserId: 'alvo', grantAll: false }, ports());
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.note).toContain('apenas os clientes que lhe foram atribuídos');
  });

  it('ninguém retira o próprio acesso amplo', async () => {
    const d = await decideAccessScope(
      admin,
      { targetUserId: 'admin', grantAll: false },
      ports(),
    );
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('cannot_narrow_self');
  });

  it('mas dar acesso amplo a si mesmo é permitido', async () => {
    const d = await decideAccessScope(admin, { targetUserId: 'admin', grantAll: true }, ports());
    expect(d.ok).toBe(true);
  });

  it('recusa mudar alcance de quem não tem conta', async () => {
    const d = await decideAccessScope(
      admin,
      { targetUserId: 'alvo', grantAll: true },
      ports({ hasProfile: false }),
    );
    expect(d.ok).toBe(false);
  });
});
