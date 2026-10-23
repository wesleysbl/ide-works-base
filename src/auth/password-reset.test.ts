import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { GENERIC_REFUSAL } from '@/auth/activation';
import { hashCode } from '@/auth/activation-code';

import {
  type PendingReset,
  type ResetPorts,
  type ResetRedeemPorts,
  RESET_AUDIT_ACTION,
  decidePasswordReset,
  decideResetRedeem,
} from '@/auth/password-reset';

const PEDIDO = {
  targetUserId: 'alvo',
  targetEmail: 'alvo@exemplo.com.br',
  actorUserId: 'admin',
  actorEmail: 'admin@exemplo.com.br',
};

function ports(over: Partial<ResetPorts> = {}): ResetPorts {
  return {
    findProfile: vi.fn(async () => ({ userId: 'alvo', email: 'alvo@exemplo.com.br' })),
    listPendingInvitations: vi.fn(async () => []),
    ...over,
  };
}

describe('redefinir é ativar de novo', () => {
  it('procede para uma conta existente', async () => {
    const d = await decidePasswordReset(PEDIDO, ports());
    expect(d.ok).toBe(true);
  });

  it('recusa para quem não tem conta do IDE Works', async () => {
    const d = await decidePasswordReset(PEDIDO, ports({ findProfile: async () => null }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('no_such_profile');
  });

  it('recusa autoatendimento — a recuperação é feita por outra pessoa', async () => {
    const d = await decidePasswordReset(
      { ...PEDIDO, actorUserId: 'alvo' },
      ports(),
    );
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('self_service_not_allowed');
  });
});

describe('códigos anteriores morrem', () => {
  it('invalida todos os convites pendentes da pessoa', async () => {
    const d = await decidePasswordReset(
      PEDIDO,
      ports({ listPendingInvitations: async () => [{ id: 'i1' }, { id: 'i2' }] }),
    );
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.invalidateInvitationIds).toEqual(['i1', 'i2']);
  });

  it('sem pendências, não há nada a invalidar', async () => {
    const d = await decidePasswordReset(PEDIDO, ports());
    if (d.ok) expect(d.invalidateInvitationIds).toEqual([]);
  });

  it('usa o e-mail do perfil, não o que veio no pedido', async () => {
    // Se confiasse no pedido, um e-mail divergente deixaria vivo o convite real.
    const p = ports();
    await decidePasswordReset({ ...PEDIDO, targetEmail: 'digitado-errado@x.com' }, p);
    expect(p.listPendingInvitations).toHaveBeenCalledWith('alvo@exemplo.com.br');
  });
});

describe('o rastro que compensa o risco', () => {
  it('registra quem redefiniu a senha de quem, e quando', async () => {
    const d = await decidePasswordReset(PEDIDO, ports());
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.audit.action).toBe('account_password_reset');
      expect(d.audit.actorId).toBe('admin');
      expect(d.audit.actorEmail).toBe('admin@exemplo.com.br');
      expect(d.audit.targetId).toBe('alvo');
    }
  });

  it('guarda o e-mail do alvo em texto — o livro sobrevive à exclusão da conta', async () => {
    const d = await decidePasswordReset(PEDIDO, ports());
    if (d.ok) expect(d.audit.targetEmail).toBe('alvo@exemplo.com.br');
  });

  it('nenhum segredo entra no registro', async () => {
    // Varre os VALORES, não as chaves: o nome da ação precisa dizer o que
    // aconteceu, e `account_password_reset` contém "password" de propósito.
    // Confundir os dois foi o primeiro erro deste teste.
    const d = await decidePasswordReset(PEDIDO, ports());
    expect(d.ok).toBe(true);
    if (!d.ok) return;

    const valores = Object.entries(d.audit)
      .filter(([chave]) => chave !== 'action')
      .map(([, valor]) => String(valor));

    for (const valor of valores) {
      expect(valor).not.toMatch(/[0-9a-f]{32,}/i); // impressão digital
      expect(valor).not.toMatch(/^[0-9A-Z]{9}$/); // código de ativação
    }
  });

  it('o registro só carrega quem, o quê e em quem — nada mais', async () => {
    const d = await decidePasswordReset(PEDIDO, ports());
    if (d.ok) {
      expect(Object.keys(d.audit).sort()).toEqual([
        'action',
        'actorEmail',
        'actorId',
        'targetEmail',
        'targetId',
      ]);
    }
  });
});

/* ═══════════════════ o outro lado: gastar o código (F17.31) ════════════════ */

const CODIGO = 'ABC23456X';

async function convite(over: Partial<PendingReset> = {}): Promise<PendingReset> {
  return {
    id: 'i1',
    email: 'alvo@exemplo.com.br',
    codeHash: await hashCode(CODIGO),
    expiresAt: new Date('2026-08-30T00:00:00Z'),
    failedAttempts: 0,
    purpose: 'reset',
    ...over,
  };
}

const AGORA = new Date('2026-08-28T00:00:00Z');

function portas(pendente: PendingReset | null, limitado = false): ResetRedeemPorts {
  return {
    isRateLimited: vi.fn(async () => limitado),
    recordAttempt: vi.fn(async () => {}),
    findPendingReset: vi.fn(async () => pendente),
  };
}

const pedido = { email: 'alvo@exemplo.com.br', code: CODIGO, password: 'senha-nova-123' };

describe('⚠️ código de CONVITE não troca senha', () => {
  it('recusa a intenção `invite`, mesmo com o código certo e tudo mais em ordem', async () => {
    const d = await decideResetRedeem(
      pedido,
      portas(await convite({ purpose: 'invite' })),
      AGORA,
    );
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('wrong_purpose');
  });

  it('e a intenção é conferida ANTES do código — um convite correto não chega perto', async () => {
    // Contador intacto: o convite de outra pessoa não pode ser travado por
    // alguém digitando na porta errada.
    const d = await decideResetRedeem(
      pedido,
      portas(await convite({ purpose: 'invite' })),
      AGORA,
    );
    if (!d.ok) expect(d.countsAgainstInvitation).toBe(false);
  });

  it('a mesma linha, com intenção `reset`, passa — a diferença é só ela', async () => {
    const d = await decideResetRedeem(pedido, portas(await convite()), AGORA);
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.invitationId).toBe('i1');
  });
});

describe('a recusa não diz nada sobre quem está do outro lado', () => {
  it('a frase é a MESMA da ativação, em todos os casos', async () => {
    const casos = [
      await decideResetRedeem(pedido, portas(null), AGORA),
      await decideResetRedeem(pedido, portas(await convite(), true), AGORA),
      await decideResetRedeem(pedido, portas(await convite({ purpose: 'invite' })), AGORA),
      await decideResetRedeem({ ...pedido, code: 'ZZZ99999Z' }, portas(await convite()), AGORA),
      await decideResetRedeem(
        pedido,
        portas(await convite({ expiresAt: new Date('2026-08-27T00:00:00Z') })),
        AGORA,
      ),
      await decideResetRedeem(pedido, portas(await convite({ failedAttempts: 10 })), AGORA),
    ];

    for (const caso of casos) {
      expect(caso.ok).toBe(false);
      if (!caso.ok) expect(caso.message).toBe(GENERIC_REFUSAL);
    }
    // Seis motivos distintos por trás da mesma frase: é isso que impede
    // descobrir quais endereços têm código só digitando endereços.
    expect(new Set(casos.map((c) => (c.ok ? 'ok' : c.reason))).size).toBe(6);
  });
});

describe('o contador só avança por código errado', () => {
  it('código errado conta contra a linha', async () => {
    const d = await decideResetRedeem(
      { ...pedido, code: 'ZZZ99999Z' },
      portas(await convite()),
      AGORA,
    );
    if (!d.ok) expect(d.countsAgainstInvitation).toBe(true);
  });

  it('vencido, travado e sem código não contam — senão qualquer um trava o de outro', async () => {
    const vencido = await decideResetRedeem(
      pedido,
      portas(await convite({ expiresAt: new Date('2026-08-27T00:00:00Z') })),
      AGORA,
    );
    const travado = await decideResetRedeem(
      pedido,
      portas(await convite({ failedAttempts: 10 })),
      AGORA,
    );
    const inexistente = await decideResetRedeem(pedido, portas(null), AGORA);
    for (const d of [vencido, travado, inexistente]) {
      if (!d.ok) expect(d.countsAgainstInvitation).toBe(false);
    }
  });
});

describe('a caixa do endereço e do código é perdoada', () => {
  it('o endereço volta normalizado, e é por ele que o resto do caminho anda', async () => {
    const d = await decideResetRedeem(
      { ...pedido, email: '  ALVO@Exemplo.com.BR ' },
      portas(await convite()),
      AGORA,
    );
    if (d.ok) expect(d.email).toBe('alvo@exemplo.com.br');
  });

  it('o código com hífen e minúscula é o mesmo código', async () => {
    const d = await decideResetRedeem(
      { ...pedido, code: 'abc-234-56x' },
      portas(await convite()),
      AGORA,
    );
    expect(d.ok).toBe(true);
  });
});

describe('o nome da ação combina com o que a migration grava', () => {
  it('é o mesmo texto dos dois lados', () => {
    // O rastro é escrito pelo BANCO, na mesma transação que cria o código. Se
    // as duas pontas divergissem, o registro existiria com outro nome e
    // ninguém acharia a redefinição procurando por ela.
    const sql = readFileSync(
      join(
        import.meta.dirname,
        '..',
        '..',
        'supabase',
        'migrations',
        '20260828120000_ideworks_f17_31_redefinir_senha_com_codigo.sql',
      ),
      'utf8',
    );
    expect(RESET_AUDIT_ACTION).toBe('account_password_reset');
    expect(sql).toContain(`'${RESET_AUDIT_ACTION}'`);
  });

  it('e a migration carrega as duas guardas da etapa', () => {
    const sql = readFileSync(
      join(
        import.meta.dirname,
        '..',
        '..',
        'supabase',
        'migrations',
        '20260828120000_ideworks_f17_31_redefinir_senha_com_codigo.sql',
      ),
      'utf8',
    );
    // `aplicar_convite` recusa linha de redefinição…
    expect(sql).toMatch(/if v_purpose <> 'invite' then/);
    // …e a porta da senha só responde sobre linha de redefinição.
    expect(sql).toMatch(/i\.purpose = 'reset'/);
  });
});

/**
 * A TENTATIVA TEM DE SER CONTADA, E O TETO É O MESMO DA ATIVAÇÃO — A3.
 *
 * O cabeçalho de `resetRedeemPorts` sempre disse que o teto era compartilhado
 * com a ativação: *"são duas portas que recebem código digitado, e um teto por
 * porta seria o dobro de tentativas por endereço para quem estivesse
 * chutando"*. Só que nenhuma das duas ESCREVIA a linha — era um teto
 * compartilhado de zero. Estes casos travam a escrita; o compartilhamento de
 * verdade, gastando numa porta e batendo na outra, é provado contra o banco em
 * `scripts/provar-o-teto-do-codigo.mjs`.
 */
describe('⚠️ o limitador conta — F17.53 / A3', () => {
  it('registra a tentativa no caminho feliz', async () => {
    const p = portas(await convite());
    await decideResetRedeem(pedido, p, AGORA);
    expect(p.recordAttempt).toHaveBeenCalledWith('alvo@exemplo.com.br');
  });

  it('registra mesmo quando não há código pendente para o endereço', async () => {
    const p = portas(null);
    await decideResetRedeem(pedido, p, AGORA);
    expect(p.recordAttempt).toHaveBeenCalledWith('alvo@exemplo.com.br');
  });

  it('registra quando o código está errado', async () => {
    const p = portas(await convite());
    await decideResetRedeem({ ...pedido, code: 'ZZZ999ZZZ' }, p, AGORA);
    expect(p.recordAttempt).toHaveBeenCalledWith('alvo@exemplo.com.br');
  });

  it('NÃO registra quando o teto já estourou', async () => {
    const p = portas(await convite(), true);
    const d = await decideResetRedeem(pedido, p, AGORA);
    expect(p.recordAttempt).not.toHaveBeenCalled();
    expect(d.ok).toBe(false);
  });

  it('conta ANTES de procurar o código pendente', async () => {
    const p = portas(await convite());
    await decideResetRedeem(pedido, p, AGORA);
    const contou = (p.recordAttempt as unknown as { mock: { invocationCallOrder: number[] } }).mock
      .invocationCallOrder[0];
    const procurou = (p.findPendingReset as unknown as { mock: { invocationCallOrder: number[] } })
      .mock.invocationCallOrder[0];
    expect(contou).toBeLessThan(procurou);
  });

  it('a recusa por teto tem a MESMA forma da recusa comum', async () => {
    const porTeto = await decideResetRedeem(pedido, portas(await convite(), true), AGORA);
    const porCodigo = await decideResetRedeem(
      { ...pedido, code: 'ZZZ999ZZZ' },
      portas(await convite()),
      AGORA,
    );
    expect(porTeto.ok).toBe(false);
    expect(porCodigo.ok).toBe(false);
    if (!porTeto.ok && !porCodigo.ok) expect(porTeto.message).toBe(porCodigo.message);
  });
});
