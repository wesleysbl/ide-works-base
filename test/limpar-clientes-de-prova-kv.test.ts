/**
 * A LIMPEZA DOS CLIENTES OAUTH DE PROVA NO KV — F44, Fase 9.
 * Só apaga nome "Cliente de integração" E retorno em `agent.test`.
 */
import { describe, expect, it } from 'vitest';

// @ts-expect-error — script .mjs sem tipos
import { ehClienteDeProva, idDoNamespace } from '../scripts/limpar-clientes-de-prova-kv.mjs';

const cliente = (clientName: string, redirectUris: string[]) =>
  JSON.stringify({ clientId: 'x', clientName, redirectUris, clientSecret: 'nunca-impresso' });

describe('ehClienteDeProva', () => {
  it('nome de prova + retorno agent.test → é de prova', () => {
    expect(ehClienteDeProva(cliente('Cliente de integração', ['https://agent.test/callback']))).toBe(true);
  });
  it('mesmo nome com retorno real → NÃO', () => {
    expect(ehClienteDeProva(cliente('Cliente de integração', ['https://claude.ai/api/mcp/auth_callback']))).toBe(false);
  });
  it('um retorno de prova e outro real → NÃO', () => {
    expect(
      ehClienteDeProva(cliente('Cliente de integração', ['https://agent.test/callback', 'https://claude.ai/cb'])),
    ).toBe(false);
  });
  it('retorno de prova com outro nome → NÃO', () => {
    expect(ehClienteDeProva(cliente('Claude', ['https://agent.test/callback']))).toBe(false);
  });
  it('host parecido (agent.test.evil.com) → NÃO', () => {
    expect(ehClienteDeProva(cliente('Cliente de integração', ['https://agent.test.evil.com/cb']))).toBe(false);
  });
  it('lixo → NÃO', () => {
    expect(ehClienteDeProva('não é json')).toBe(false);
    expect(ehClienteDeProva('null')).toBe(false);
    expect(ehClienteDeProva(cliente('Cliente de integração', []))).toBe(false);
  });
});

describe('idDoNamespace', () => {
  it('lê o id do OAUTH_KV', () => {
    expect(idDoNamespace('[[kv_namespaces]]\nbinding = "OAUTH_KV"\nid = "0123456789abcdef0123456789abcdef"\n')).toBe(
      '0123456789abcdef0123456789abcdef',
    );
  });
});
