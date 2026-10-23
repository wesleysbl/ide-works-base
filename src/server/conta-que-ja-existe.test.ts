/**
 * A CONTA QUE JÁ EXISTE, E A FRASE QUE VAZOU — etapa F17.30.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A FRASE, INTEIRA, COMO ELA CHEGOU AO OLHO DE QUEM ESTAVA ATIVANDO
 *
 *     User already registered
 *
 *   Em inglês, na tela, sem dizer o que fazer. Ela é a resposta do provedor de
 *   autenticação a `/auth/v1/signup` quando o endereço tem dono, e chegou até
 *   ali por uma fresta de uma linha em `createAccountWithProvider`:
 *
 *       message: explicacoes[body.error_code ?? ''] ?? body.msg ?? '…'
 *                                                     ^^^^^^^^
 *
 *   O `?? body.msg` era o combinado de "se não souber traduzir, repassa". O que
 *   se repassa é texto do provedor: muda de versão para versão, está em inglês,
 *   e nunca foi escrito para esta tela.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * OS DOIS CONSERTOS QUE ESTE ARQUIVO COBRA
 *
 *   1. ENDEREÇO COM DONO NÃO É RECUSA — É VÍNCULO. A autenticação é a mesma do
 *      Sistema IDE (decisão D8) e ter conta lá é o caso da MAIORIA da agência.
 *      `gestao@exemplo.com.br` existe desde 2025-09-23 e entrou pela última
 *      vez cinco semanas antes desta etapa.
 *
 *   2. NADA DO PROVEDOR SOBE PARA A TELA. O que ele responde vira ou uma frase
 *      nossa que se conhece, ou a frase de último caso — e o motivo cru vai
 *      para o registro, onde é útil e não assusta ninguém.
 *
 * ⚠️ O QUE ESTE ARQUIVO **NÃO** PROVA, E É A ASSERÇÃO MAIS IMPORTANTE DA ETAPA
 *   Que a senha da conta existente não muda. Isso é fato do cadastro real, não
 *   de um dublê, e mora em `scripts/provar-conta-que-ja-existe.mjs` — que mede
 *   o carimbo do cadastro antes e depois e confere que a senha antiga continua
 *   abrindo sessão. Aqui não há provedor nenhum: um dublê que "não muda a
 *   senha" não prova nada sobre o provedor de verdade.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAccountWithProvider } from '@/server/ports';

const PROVEDOR = { url: 'https://exemplo.invalid', anonKey: 'chave', testAccountsOnly: false };

/** A resposta do provedor, combinada por status e corpo. */
function fingirProvedor(status: number, corpo: unknown) {
  const chamadas: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    chamadas.push(url);
    return new Response(JSON.stringify(corpo), { status });
  });
  return chamadas;
}

afterEach(() => vi.unstubAllGlobals());

/** A resposta MEDIDA contra o cadastro real em 2026-08-28. */
const COMO_O_PROVEDOR_RESPONDE_HOJE = {
  code: 422,
  error_code: 'user_already_exists',
  msg: 'User already registered',
};

describe('o endereço que já tem dono', () => {
  it('não é recusa: a ativação segue, e diz que a conta já existia', async () => {
    fingirProvedor(422, COMO_O_PROVEDOR_RESPONDE_HOJE);
    const r = await createAccountWithProvider(PROVEDOR, 'gestao@exemplo.invalid', 'senha-boa-1');
    expect(r.ok).toBe(true);
    expect(r.ok && r.alreadyExisted).toBe(true);
  });

  /*
    A frase é do provedor, e provedor muda de versão. Versões anteriores
    respondem 400 e mandam só o texto — reconhecer as duas formas é o que
    impede a correção de expirar sozinha numa atualização.
  */
  it('a forma antiga da mesma resposta também é reconhecida', async () => {
    fingirProvedor(400, { msg: 'User already registered' });
    const r = await createAccountWithProvider(PROVEDOR, 'gestao@exemplo.invalid', 'senha-boa-1');
    expect(r.ok && r.alreadyExisted).toBe(true);
  });

  it('conta nova continua nascendo, e se diz nova', async () => {
    fingirProvedor(200, { user: { id: 'u1' } });
    const r = await createAccountWithProvider(PROVEDOR, 'teste-novo@ideworks.invalid', 'senha-boa-1');
    expect(r.ok).toBe(true);
    expect(r.ok && r.alreadyExisted).toBe(false);
  });

  it('só uma chamada ao provedor, e é a de sempre', async () => {
    const chamadas = fingirProvedor(422, COMO_O_PROVEDOR_RESPONDE_HOJE);
    await createAccountWithProvider(PROVEDOR, 'gestao@exemplo.invalid', 'senha-boa-1');
    expect(chamadas).toEqual(['https://exemplo.invalid/auth/v1/signup']);
  });
});

describe('nenhuma frase do provedor chega à tela', () => {
  it('A FRASE QUE VAZOU não sai mais daqui', async () => {
    fingirProvedor(422, COMO_O_PROVEDOR_RESPONDE_HOJE);
    const r = await createAccountWithProvider(PROVEDOR, 'gestao@exemplo.invalid', 'senha-boa-1');
    // Ela nem chega a ser mensagem: virou o caminho feliz do vínculo.
    expect(JSON.stringify(r)).not.toContain('already registered');
  });

  const RECUSAS: Array<[string, { error_code?: string; msg?: string }]> = [
    ['inglês solto', { msg: 'Something went terribly wrong' }],
    ['detalhe do cadastro', { msg: 'duplicate key value violates unique constraint' }],
    ['código que não conhecemos', { error_code: 'unexpected_failure', msg: 'Unexpected failure' }],
    ['corpo vazio', {}],
  ];

  it.each(RECUSAS)('recusa por %s sai com frase nossa, e em português', async (_n, corpo) => {
    fingirProvedor(500, corpo);
    const r = await createAccountWithProvider(PROVEDOR, 'teste-x@ideworks.invalid', 'senha');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toBe('Senha recusada. Escolha outra e tente de novo.');
      if (corpo.msg !== undefined) expect(r.message).not.toContain(corpo.msg);
    }
  });

  it('o motivo cru vai para o registro, que é onde ele serve', async () => {
    fingirProvedor(500, { error_code: 'unexpected_failure', msg: 'Unexpected failure' });
    const registrado: string[] = [];
    await createAccountWithProvider(PROVEDOR, 'teste-x@ideworks.invalid', 'senha', (m) =>
      registrado.push(m),
    );
    expect(registrado.join(' ')).toContain('unexpected_failure');
    expect(registrado.join(' ')).toContain('Unexpected failure');
  });

  it('a senha fraca continua com a explicação de sempre — ela é a exceção', async () => {
    fingirProvedor(422, { error_code: 'weak_password', msg: 'Password is too weak' });
    const r = await createAccountWithProvider(PROVEDOR, 'teste-x@ideworks.invalid', '123456');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain('8 caracteres');
      expect(r.message).not.toContain('weak');
    }
  });
});

describe('a trava de conta de teste não foi afrouxada', () => {
  it('com a trava ligada, endereço real nem chega ao provedor', async () => {
    const chamadas = fingirProvedor(200, {});
    await expect(
      createAccountWithProvider(
        { ...PROVEDOR, testAccountsOnly: true },
        'alguem@exemplo.com.br',
        'senha-boa-1',
      ),
    ).rejects.toThrow();
    expect(chamadas).toEqual([]);
  });
});
