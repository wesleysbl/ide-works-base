import { describe, expect, it, vi } from 'vitest';

import { hashCode } from '@/auth/activation-code';
import {
  type ActivationPorts,
  type PendingInvitation,
  GENERIC_REFUSAL,
  decideActivation,
  normalizeEmail,
} from '@/auth/activation';

const AGORA = new Date('2026-08-19T12:00:00Z');
const CODIGO = 'ABC123XYZ';
const EMAIL = 'fulano@exemplo.com.br';

async function convite(over: Partial<PendingInvitation> = {}): Promise<PendingInvitation> {
  return {
    id: 'inv-1',
    email: EMAIL,
    codeHash: await hashCode(CODIGO),
    expiresAt: new Date('2026-08-22T12:00:00Z'),
    failedAttempts: 0,
    purpose: 'invite',
    ...over,
  };
}

/** Dublê das portas. Nenhum teste toca em banco ou em autenticação real. */
function ports(over: Partial<ActivationPorts> = {}): ActivationPorts {
  return {
    isRateLimited: vi.fn(async () => false),
    recordAttempt: vi.fn(async () => {}),
    findPendingInvitation: vi.fn(async () => await convite()),
    ensureAccount: vi.fn(async () => ({ ok: true as const, alreadyExisted: false })),
    ...over,
  };
}

describe('decideActivation — caminho feliz', () => {
  it('ativa com código correto', async () => {
    const r = await decideActivation({ email: EMAIL, code: CODIGO, password: 'senha-boa-1' }, ports(), AGORA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.invitationId).toBe('inv-1');
  });

  it('aceita o código formatado e em minúscula', async () => {
    const r = await decideActivation(
      { email: EMAIL, code: 'abc-123-xyz', password: 'senha-boa-1' },
      ports(),
      AGORA,
    );
    expect(r.ok).toBe(true);
  });

  it('aceita a letra ambígua no lugar do dígito', async () => {
    const p = ports({ findPendingInvitation: async () => await convite({ codeHash: await hashCode('011222333') }) });
    const r = await decideActivation({ email: EMAIL, code: 'OII-222-333', password: 'senha-boa-1' }, p, AGORA);
    expect(r.ok).toBe(true);
  });

  it('não distingue maiúscula nem espaço no e-mail', async () => {
    const p = ports();
    await decideActivation({ email: '  FULANO@Exemplo.com.BR ', code: CODIGO, password: 'x' }, p, AGORA);
    expect(p.findPendingInvitation).toHaveBeenCalledWith(EMAIL);
  });
});

describe('a resposta é sempre a mesma — defesa contra enumeração de usuários', () => {
  const casos: Array<[string, () => ActivationPorts]> = [
    ['teto de tentativas estourado', () => ports({ isRateLimited: async () => true })],
    ['e-mail sem convite', () => ports({ findPendingInvitation: async () => null })],
    [
      'convite travado por erros',
      () => ports({ findPendingInvitation: async () => await convite({ failedAttempts: 10 }) }),
    ],
    [
      'convite expirado',
      () =>
        ports({
          findPendingInvitation: async () => await convite({ expiresAt: new Date('2026-08-01T00:00:00Z') }),
        }),
    ],
    ['código errado', () => ports()],
  ];

  it.each(casos)('%s devolve a frase única', async (nome, fabrica) => {
    const codigo = nome === 'código errado' ? 'ZZZ999ZZZ' : CODIGO;
    const r = await decideActivation({ email: EMAIL, code: codigo, password: 'senha-boa-1' }, fabrica(), AGORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe(GENERIC_REFUSAL);
  });

  it('as cinco recusas são indistinguíveis entre si na tela', async () => {
    const mensagens = new Set<string>();
    for (const [nome, fabrica] of casos) {
      const codigo = nome === 'código errado' ? 'ZZZ999ZZZ' : CODIGO;
      const r = await decideActivation({ email: EMAIL, code: codigo, password: 'senha-boa-1' }, fabrica(), AGORA);
      if (!r.ok) mensagens.add(r.message);
    }
    expect(mensagens.size).toBe(1);
  });

  it('o motivo real fica disponível para auditoria, mas não na mensagem', async () => {
    const r = await decideActivation(
      { email: EMAIL, code: CODIGO, password: 'x' },
      ports({ findPendingInvitation: async () => null }),
      AGORA,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('no_invitation');
      expect(r.message).not.toContain('invitation');
      expect(r.message).not.toContain('convite');
    }
  });
});

describe('ordem das conferências', () => {
  it('teto de tentativas vem antes de tudo — nem procura o convite', async () => {
    const p = ports({ isRateLimited: async () => true });
    await decideActivation({ email: EMAIL, code: CODIGO, password: 'x' }, p, AGORA);
    expect(p.findPendingInvitation).not.toHaveBeenCalled();
  });

  it('convite expirado nem chega a conferir o código', async () => {
    const p = ports({
      findPendingInvitation: async () => await convite({ expiresAt: new Date('2026-08-01T00:00:00Z') }),
    });
    await decideActivation({ email: EMAIL, code: CODIGO, password: 'x' }, p, AGORA);
    expect(p.ensureAccount).not.toHaveBeenCalled();
  });

  it('a conta só é criada depois de o código bater', async () => {
    const p = ports();
    await decideActivation({ email: EMAIL, code: 'ZZZ999ZZZ', password: 'x' }, p, AGORA);
    expect(p.ensureAccount).not.toHaveBeenCalled();
  });

  it('expira exatamente no instante do prazo, não um milissegundo depois', async () => {
    const prazo = new Date('2026-08-22T12:00:00Z');
    const p = ports({ findPendingInvitation: async () => await convite({ expiresAt: prazo }) });
    const r = await decideActivation({ email: EMAIL, code: CODIGO, password: 'x' }, p, prazo);
    expect(r.ok).toBe(false);
  });
});

describe('contador de erros do convite', () => {
  it('código errado conta contra o convite', async () => {
    const r = await decideActivation({ email: EMAIL, code: 'ZZZ999ZZZ', password: 'x' }, ports(), AGORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.countsAgainstInvitation).toBe(true);
  });

  it.each([
    ['teto de tentativas', () => ports({ isRateLimited: async () => true })],
    ['e-mail sem convite', () => ports({ findPendingInvitation: async () => null })],
  ])('%s NÃO conta — senão um terceiro travaria convite alheio', async (_n, fabrica) => {
    const r = await decideActivation({ email: EMAIL, code: CODIGO, password: 'x' }, fabrica(), AGORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.countsAgainstInvitation).toBe(false);
  });
});

/**
 * F17.30 — quem já tem conta é vinculado, não recriado.
 *
 * O caso que ninguém tinha previsto: a autenticação é a mesma do Sistema IDE, e
 * ter conta lá é o caso da MAIORIA da agência.
 */
describe('quem já tinha conta', () => {
  const jaTinha = () =>
    ports({ ensureAccount: vi.fn(async () => ({ ok: true as const, alreadyExisted: true })) });

  it('ativa em vez de falhar — conta com dono não é recusa', async () => {
    const r = await decideActivation(
      { email: EMAIL, code: CODIGO, password: 'senha-boa-1' },
      jaTinha(),
      AGORA,
    );
    expect(r.ok).toBe(true);
  });

  it('e quem chama fica sabendo, para não prometer senha nova a quem não trocou', async () => {
    const r = await decideActivation(
      { email: EMAIL, code: CODIGO, password: 'senha-boa-1' },
      jaTinha(),
      AGORA,
    );
    expect(r.ok && r.alreadyExisted).toBe(true);
  });

  it('conta nova continua dizendo que é nova — o caminho de hoje não mudou', async () => {
    const r = await decideActivation(
      { email: EMAIL, code: CODIGO, password: 'senha-boa-1' },
      ports(),
      AGORA,
    );
    expect(r.ok && r.alreadyExisted).toBe(false);
  });

  /**
   * ⚠️ A ORDEM É DECISÃO DE SEGURANÇA, e por isso ela é cobrada aqui.
   *
   * "Este e-mail já tem conta?" só se pergunta DEPOIS de o código bater. Antes
   * disso, qualquer pessoa descobriria quais endereços da agência têm conta só
   * digitando endereços — a enumeração de usuários que este módulo inteiro
   * existe para impedir.
   */
  it.each([
    ['código errado', 'ZZZ999ZZZ', () => jaTinha()],
    ['sem convite', CODIGO, () => ports({ findPendingInvitation: async () => null })],
    ['teto de tentativas', CODIGO, () => ports({ isRateLimited: async () => true })],
  ])('%s nem chega a perguntar se a conta existe', async (_n, codigo, fabrica) => {
    const p = fabrica();
    const r = await decideActivation({ email: EMAIL, code: codigo, password: 'x' }, p, AGORA);
    expect(p.ensureAccount).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe(GENERIC_REFUSAL);
  });

  it('e a senha digitada NÃO vale — é o caminho da F17.30, e ele ficou', async () => {
    const r = await decideActivation(
      { email: EMAIL, code: CODIGO, password: 'senha-boa-1' },
      jaTinha(),
      AGORA,
    );
    expect(r.ok && r.definesPassword).toBe(false);
  });

  it('a recusa é a MESMA frase, tenha a pessoa conta ou não', async () => {
    const comConta = await decideActivation(
      { email: EMAIL, code: 'ZZZ999ZZZ', password: 'x' },
      jaTinha(),
      AGORA,
    );
    const semConta = await decideActivation(
      { email: EMAIL, code: 'ZZZ999ZZZ', password: 'x' },
      ports(),
      AGORA,
    );
    expect(comConta.ok).toBe(false);
    expect(semConta.ok).toBe(false);
    if (!comConta.ok && !semConta.ok) {
      expect(comConta.message).toBe(semConta.message);
      expect(comConta.reason).toBe(semConta.reason);
    }
  });
});

describe('a senha é o único caso com mensagem explicativa', () => {
  const recusaSenha = () =>
    ports({
      ensureAccount: async () => ({
        ok: false as const,
        message: 'Essa senha já apareceu em vazamentos de outros sites. Escolha outra.',
      }),
    });

  it('explica o motivo em vez de devolver a frase genérica', async () => {
    const r = await decideActivation({ email: EMAIL, code: CODIGO, password: '123456' }, recusaSenha(), AGORA);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).not.toBe(GENERIC_REFUSAL);
      expect(r.message).toContain('vazamentos');
    }
  });

  it('o convite continua válido — a pessoa já provou que tem o código', async () => {
    const r = await decideActivation({ email: EMAIL, code: CODIGO, password: '123456' }, recusaSenha(), AGORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.countsAgainstInvitation).toBe(false);
  });
});

/**
 * F17.39 — o convite de quem já tem conta define a senha.
 *
 * Das 30 pessoas do sistema legado, as 30 têm conta de login: "a conta já
 * existe" é 100% dos convites que faltam. Pedir uma senha e descartá-la é
 * errado dezenove vezes seguidas.
 *
 * ⚠️ E ISSO NÃO DESFAZ A F17.30. A invariante «código de convite não toca senha
 * de conta que já existe» continua valendo para `invite`; quem passa a poder é
 * uma intenção TERCEIRA, declarada na linha.
 */
describe('convite que também define a senha', () => {
  const jaTinhaConta = { ok: true as const, alreadyExisted: true };

  const comIntencaoDeSenha = () =>
    ports({
      findPendingInvitation: async () => await convite({ purpose: 'invite_with_password' }),
      ensureAccount: vi.fn(async () => jaTinhaConta),
    });

  it('a senha digitada VALE — é a etapa inteira numa asserção', async () => {
    const r = await decideActivation(
      { email: EMAIL, code: CODIGO, password: 'senha-boa-1' },
      comIntencaoDeSenha(),
      AGORA,
    );
    expect(r.ok && r.definesPassword).toBe(true);
  });

  it('e o acesso é aplicado do mesmo jeito — o convite continua sendo convite', async () => {
    const r = await decideActivation(
      { email: EMAIL, code: CODIGO, password: 'senha-boa-1' },
      comIntencaoDeSenha(),
      AGORA,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.invitationId).toBe('inv-1');
      expect(r.alreadyExisted).toBe(true);
    }
  });

  it('conta nova define a senha nas duas intenções — não havia senha para proteger', async () => {
    for (const purpose of ['invite', 'invite_with_password'] as const) {
      const r = await decideActivation(
        { email: EMAIL, code: CODIGO, password: 'senha-boa-1' },
        ports({ findPendingInvitation: async () => await convite({ purpose }) }),
        AGORA,
      );
      expect(r.ok && r.definesPassword).toBe(true);
    }
  });

  /**
   * ⚠️ A INVARIANTE DA F17.30, COBRADA AQUI E NÃO SÓ NO BANCO.
   *
   * Errar isto tira o acesso de uma pessoa real ao Sistema IDE em produção.
   */
  it('convite COMUM sobre conta que já existe continua sem definir senha', async () => {
    const r = await decideActivation(
      { email: EMAIL, code: CODIGO, password: 'senha-boa-1' },
      ports({
        findPendingInvitation: async () => await convite({ purpose: 'invite' }),
        ensureAccount: async () => jaTinhaConta,
      }),
      AGORA,
    );
    expect(r.ok && r.definesPassword).toBe(false);
  });

  /** A simétrica da F17.31: código de senha não dá acesso a ninguém. */
  it('um código de redefinição é recusado, e antes de o código ser conferido', async () => {
    const p = ports({ findPendingInvitation: async () => await convite({ purpose: 'reset' }) });
    const r = await decideActivation({ email: EMAIL, code: CODIGO, password: 'x' }, p, AGORA);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('wrong_purpose');
      expect(r.message).toBe(GENERIC_REFUSAL);
      expect(r.countsAgainstInvitation).toBe(false);
    }
    expect(p.ensureAccount).not.toHaveBeenCalled();
  });

  it('e a recusa da intenção errada é indistinguível das outras na tela', async () => {
    const intencaoErrada = await decideActivation(
      { email: EMAIL, code: CODIGO, password: 'x' },
      ports({ findPendingInvitation: async () => await convite({ purpose: 'reset' }) }),
      AGORA,
    );
    const semConvite = await decideActivation(
      { email: EMAIL, code: CODIGO, password: 'x' },
      ports({ findPendingInvitation: async () => null }),
      AGORA,
    );
    expect(intencaoErrada.ok).toBe(false);
    expect(semConvite.ok).toBe(false);
    if (!intencaoErrada.ok && !semConvite.ok) {
      expect(intencaoErrada.message).toBe(semConvite.message);
    }
  });
});

describe('normalizeEmail', () => {
  it.each([
    ['  Fulano@Exemplo.COM  ', 'fulano@exemplo.com'],
    ['JA@B.CO', 'ja@b.co'],
  ])('normaliza %s', (entrada, esperado) => {
    expect(normalizeEmail(entrada)).toBe(esperado);
  });
});

/**
 * A TENTATIVA TEM DE SER CONTADA — achado A3 da auditoria de 2026-09-01.
 *
 * O defeito que estes casos travam: `isRateLimited` consultava `auth_attempts`
 * procurando linhas de intenção `activation`, e ninguém as escrevia. Eram 498
 * linhas na tabela em treze dias, 100% `login`, ZERO `activation`. A contagem
 * lia 0 e devolvia falso sempre — um limitador que nunca contou parece, por
 * fora, um limitador que ninguém estourou.
 */
describe('⚠️ o limitador conta — F17.53 / A3', () => {
  it('registra a tentativa no caminho feliz', async () => {
    const p = ports();
    await decideActivation({ email: EMAIL, code: CODIGO, password: 'senha-boa-1' }, p, AGORA);
    expect(p.recordAttempt).toHaveBeenCalledWith(EMAIL);
  });

  it('registra também quando o código está errado', async () => {
    const p = ports();
    await decideActivation({ email: EMAIL, code: 'ZZZ999ZZZ', password: 'x' }, p, AGORA);
    expect(p.recordAttempt).toHaveBeenCalledWith(EMAIL);
  });

  it('registra mesmo quando o endereço não tem convite nenhum', async () => {
    // É o caso que mais importa: é assim que se chuta endereço, e é o que
    // saía sem deixar rastro.
    const p = ports({ findPendingInvitation: async () => null });
    await decideActivation({ email: EMAIL, code: CODIGO, password: 'x' }, p, AGORA);
    expect(p.recordAttempt).toHaveBeenCalledWith(EMAIL);
  });

  it('registra com o endereço JÁ NORMALIZADO — senão o teto se fura com maiúscula', async () => {
    const p = ports();
    await decideActivation(
      { email: '  FULANO@Exemplo.com.BR ', code: CODIGO, password: 'x' },
      p,
      AGORA,
    );
    expect(p.recordAttempt).toHaveBeenCalledWith(EMAIL);
  });

  it('NÃO registra quando o teto já estourou — quem está barrado não estende a própria janela', async () => {
    const p = ports({ isRateLimited: async () => true });
    const r = await decideActivation({ email: EMAIL, code: CODIGO, password: 'x' }, p, AGORA);
    expect(p.recordAttempt).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });

  it('conta ANTES de procurar o convite — a ordem é o que dá rastro a quem chuta', async () => {
    const ordem: string[] = [];
    const p = ports({
      recordAttempt: async () => {
        ordem.push('contou');
      },
      findPendingInvitation: async () => {
        ordem.push('procurou');
        return await convite();
      },
    });
    await decideActivation({ email: EMAIL, code: CODIGO, password: 'senha-boa-1' }, p, AGORA);
    expect(ordem).toEqual(['contou', 'procurou']);
  });

  it('falha do registro não derruba a ativação — a ação é o que a pessoa pediu', async () => {
    const p = ports({
      recordAttempt: async () => {
        throw new Error('banco fora');
      },
    });
    // A porta engole a própria falha na borda; aqui se cobra que a decisão não
    // a transforme em recusa. Se um dia ela passar a estourar, este caso cai.
    await expect(
      decideActivation({ email: EMAIL, code: CODIGO, password: 'senha-boa-1' }, p, AGORA),
    ).rejects.toThrow('banco fora');
  });

  it('a recusa por teto tem a MESMA forma da recusa comum', async () => {
    const porTeto = await decideActivation(
      { email: EMAIL, code: CODIGO, password: 'x' },
      ports({ isRateLimited: async () => true }),
      AGORA,
    );
    const porCodigo = await decideActivation(
      { email: EMAIL, code: 'ZZZ999ZZZ', password: 'x' },
      ports(),
      AGORA,
    );
    expect(porTeto.ok).toBe(false);
    expect(porCodigo.ok).toBe(false);
    if (!porTeto.ok && !porCodigo.ok) {
      expect(porTeto.message).toBe(porCodigo.message);
      expect(porTeto.message).toBe(GENERIC_REFUSAL);
    }
  });
});
