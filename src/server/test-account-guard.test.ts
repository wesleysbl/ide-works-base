import { describe, expect, it } from 'vitest';

import {
  RealAccountRefused,
  TEST_ACCOUNT_DOMAIN,
  assertNeverDeleteAccounts,
  assertTestAccount,
  isTestAccount,
  testAccountEmail,
} from '@/server/test-account-guard';

describe('o domínio reservado', () => {
  it('usa um domínio de topo que nunca pode ser registrado', () => {
    expect(TEST_ACCOUNT_DOMAIN.endsWith('.invalid')).toBe(true);
  });
});

describe('nenhum domínio real deste projeto passa', () => {
  // Domínios levantados em 2026-08-19 no projeto compartilhado.
  it.each([
    'wesley@exemplo.com.br',
    'alguem@gmail.com',
    'alguem@hotmail.com',
    'alguem@outlook.com.br',
    'alguem@exemplo',
  ])('recusa %s', (email) => {
    expect(isTestAccount(email)).toBe(false);
    expect(() => assertTestAccount(email)).toThrow(RealAccountRefused);
  });
});

describe('tentativas de contornar a trava', () => {
  it.each([
    ['sem o prefixo', 'alguem@ideworks.invalid'],
    ['domínio parecido', 'teste-x@ideworks.invalid.com.br'],
    ['domínio como subdomínio', 'teste-x@ideworks.invalid.exemplo.com.br'],
    ['prefixo no lugar errado', 'x-teste@ideworks.invalid'],
    ['domínio real com prefixo', 'teste-x@exemplo.com.br'],
    ['sufixo colado', 'teste-x@ideworks.invalidX'],
    ['vazio', ''],
    ['só o domínio', '@ideworks.invalid'],
  ])('recusa %s', (_nome, email) => {
    expect(isTestAccount(email)).toBe(false);
  });
});

describe('contas de teste legítimas', () => {
  it.each([
    'teste-admin@ideworks.invalid',
    'teste-convidado-1@ideworks.invalid',
    'teste-f19@ideworks.invalid',
  ])('aceita %s', (email) => {
    expect(isTestAccount(email)).toBe(true);
    expect(() => assertTestAccount(email)).not.toThrow();
  });

  it('não distingue caixa nem espaço em volta', () => {
    expect(isTestAccount('  TESTE-ADMIN@IDEWORKS.INVALID  ')).toBe(true);
  });
});

describe('a mensagem de recusa é acionável', () => {
  it('nomeia o endereço recusado', () => {
    expect(() => assertTestAccount('wesley@exemplo.com.br')).toThrow(
      /wesley@exemplo\.com\.br/,
    );
  });

  it('explica por que a trava existe', () => {
    expect(() => assertTestAccount('x@y.com')).toThrow(/compartilhada com o Sistema IDE/);
  });

  it('diz qual é o formato aceito', () => {
    expect(() => assertTestAccount('x@y.com')).toThrow(/ideworks\.invalid/);
  });
});

describe('testAccountEmail', () => {
  it('monta endereço que passa na própria trava', () => {
    expect(isTestAccount(testAccountEmail('convidado 1'))).toBe(true);
  });

  it('normaliza acento e espaço', () => {
    expect(testAccountEmail('Ativação Número 2')).toBe('teste-ativacao-numero-2@ideworks.invalid');
  });

  it('recusa rótulo vazio em vez de gerar endereço torto', () => {
    expect(() => testAccountEmail('   ')).toThrow();
  });
});

describe('nunca apagar conta', () => {
  it('a recusa é total — não há caminho de exclusão', () => {
    expect(() => assertNeverDeleteAccounts()).toThrow(/não apaga conta/);
  });

  it('explica que o alvo errado tira o acesso de uma pessoa real', () => {
    expect(() => assertNeverDeleteAccounts()).toThrow(/pessoa real/);
  });
});

describe('a lista de convidados — F1.9b', () => {
  it('quem está na lista passa, mesmo com a trava ligada', () => {
    expect(() =>
      assertTestAccount('joana@parceira.com.br', 'joana@parceira.com.br'),
    ).not.toThrow();
  });

  it('quem NÃO está na lista continua recusado', () => {
    expect(() => assertTestAccount('outro@parceira.com.br', 'joana@parceira.com.br')).toThrow(
      RealAccountRefused,
    );
  });

  it('não vale para o domínio inteiro', () => {
    // A regra mais importante deste arquivo. Um curinga de domínio seria uma
    // porta que ninguém revisa — e `@parceira.com.br` tem gente que não deveria
    // entrar ainda.
    expect(() => assertTestAccount('qualquer@parceira.com.br', '@parceira.com.br')).toThrow(
      RealAccountRefused,
    );
  });

  it('ignora espaço e maiúscula', () => {
    expect(() =>
      assertTestAccount('  Joana@Parceira.com.br ', 'joana@parceira.com.br'),
    ).not.toThrow();
  });

  it('lista vazia não libera ninguém', () => {
    expect(() => assertTestAccount('joana@parceira.com.br', '')).toThrow(RealAccountRefused);
    expect(() => assertTestAccount('joana@parceira.com.br', '  , ,')).toThrow(RealAccountRefused);
  });

  it('a conta de teste continua valendo sem lista nenhuma', () => {
    expect(() => assertTestAccount('teste-percurso@ideworks.invalid')).not.toThrow();
  });
});
