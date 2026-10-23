import { describe, expect, it, vi } from 'vitest';

import { type AuditPorts, recordAdminAction, redactSecrets } from '@/auth/audit';

function ports(over: Partial<AuditPorts> = {}): AuditPorts {
  return {
    append: vi.fn(async () => {}),
    reportFailure: vi.fn(),
    reportRedaction: vi.fn(),
    ...over,
  };
}

const base = {
  action: 'account_created' as const,
  actorId: 'admin',
  actorEmail: 'admin@exemplo.com.br',
  targetId: 'alvo',
  targetEmail: 'alvo@exemplo.com.br',
};

describe('redactSecrets — segredo nunca entra', () => {
  it.each([
    'senha',
    'password',
    'codigo',
    'code',
    'token',
    'hash',
    'chave',
    'apiKey',
    'secret',
    'authorization',
  ])('descarta o campo "%s"', (campo) => {
    const { clean, dropped } = redactSecrets({ [campo]: 'valor-sensivel', ok: 1 });
    expect(clean).not.toHaveProperty(campo);
    expect(clean).toHaveProperty('ok');
    expect(dropped).toContain(campo);
  });

  it('apaga em vez de mascarar — nem asterisco, nem tamanho', () => {
    const { clean } = redactSecrets({ senha: 'abcdefghi' });
    const texto = JSON.stringify(clean);
    expect(texto).not.toContain('*');
    expect(texto).not.toContain('9');
    expect(texto).toBe('{}');
  });

  it('é recursivo — pega segredo escondido dentro de outro objeto', () => {
    const { clean, dropped } = redactSecrets({
      pedido: { origem: 'tela', credenciais: { token: 'abc' } },
    });
    expect(JSON.stringify(clean)).not.toContain('abc');
    expect(dropped).toContain('pedido.credenciais');
  });

  it('atravessa listas', () => {
    const { clean } = redactSecrets({ itens: [{ nome: 'a', senha: 'x' }, { nome: 'b' }] });
    expect(JSON.stringify(clean)).not.toContain('"x"');
    expect(JSON.stringify(clean)).toContain('"a"');
  });

  it('não se engana com acento nem com caixa', () => {
    const { dropped } = redactSecrets({ Código: 'x', SENHA: 'y', Chave_API: 'z' });
    expect(dropped).toHaveLength(3);
  });

  it.each(['credenciais', 'credencial', 'segredo', 'Senha', 'CHAVE_API'])(
    'pega o campo em portugues: %s',
    (campo) => {
      const { dropped } = redactSecrets({ [campo]: 'x' });
      expect(dropped).toContain(campo);
    },
  );

  it('deixa passar o que não é segredo', () => {
    const { clean, dropped } = redactSecrets({ motivo: 'saiu da equipe', quando: '2026-08-19' });
    expect(clean).toEqual({ motivo: 'saiu da equipe', quando: '2026-08-19' });
    expect(dropped).toEqual([]);
  });
});

describe('recordAdminAction', () => {
  it('grava a entrada', async () => {
    const p = ports();
    expect(await recordAdminAction(base, p)).toBe(true);
    expect(p.append).toHaveBeenCalledOnce();
  });

  it('guarda o e-mail do alvo em texto — o livro sobrevive à exclusão da conta', async () => {
    const p = ports();
    await recordAdminAction(base, p);
    expect(p.append).toHaveBeenCalledWith(
      expect.objectContaining({ targetEmail: 'alvo@exemplo.com.br' }),
    );
  });

  it('grava o contexto já limpo de segredos', async () => {
    const p = ports();
    await recordAdminAction({ ...base, context: { motivo: 'ok', token: 'abc' } }, p);
    const gravado = vi.mocked(p.append).mock.calls[0][0];
    expect(gravado.context).toEqual({ motivo: 'ok' });
  });

  it('avisa quando barrou um campo — vira sinal de defeito, não some calado', async () => {
    const p = ports();
    await recordAdminAction({ ...base, context: { senha: 'x' } }, p);
    expect(p.reportRedaction).toHaveBeenCalledWith('account_created', ['senha']);
  });

  it('não avisa nada quando não havia o que barrar', async () => {
    const p = ports();
    await recordAdminAction({ ...base, context: { motivo: 'ok' } }, p);
    expect(p.reportRedaction).not.toHaveBeenCalled();
  });
});

describe('falha para o lado certo', () => {
  const quebrado = () =>
    ports({
      append: async () => {
        throw new Error('tabela ainda não existe');
      },
    });

  it('não lança — a ação em curso não pode morrer por causa do registro', async () => {
    await expect(recordAdminAction(base, quebrado())).resolves.toBe(false);
  });

  it('grita a falha', async () => {
    const p = quebrado();
    await recordAdminAction(base, p);
    expect(p.reportFailure).toHaveBeenCalled();
  });

  it('a mensagem de falha nomeia a ação que não foi registrada', async () => {
    const p = quebrado();
    await recordAdminAction(base, p);
    expect(vi.mocked(p.reportFailure).mock.calls[0][0]).toContain('account_created');
  });

  it('mesmo falhando, o segredo já tinha sido removido antes da tentativa', async () => {
    const p = quebrado();
    await recordAdminAction({ ...base, context: { senha: 'x' } }, p);
    expect(p.reportRedaction).toHaveBeenCalled();
  });
});
