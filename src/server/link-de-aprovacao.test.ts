/**
 * O TOKEN DO LINK DE APROVAÇÃO — F42, Fase 3.
 *
 * Gerar (aleatório, forte, formato de endereço), hash (estável, SHA-256 hex,
 * sensível a maiúscula), cifrar e decifrar (volta o mesmo token; outro cliente,
 * outra chave ou texto adulterado não abrem) e a chave do ambiente.
 */

import { describe, expect, it } from 'vitest';

import {
  BYTES_DO_TOKEN,
  ChaveDoLinkAusente,
  CifraInvalida,
  FORMATO_DO_TOKEN,
  SEGREDO_DA_CHAVE,
  chaveDoAmbiente,
  cifrarToken,
  deBase64,
  decifrarToken,
  enderecoDoLink,
  gerarToken,
  hashDoToken,
  paraBase64Url,
  tokenTemFormato,
} from '@/server/link-de-aprovacao';

/** 32 bytes fixos em base64 — chave SÓ de teste. */
const CHAVE_DE_TESTE = Buffer.alloc(32, 7).toString('base64');
const OUTRA_CHAVE = Buffer.alloc(32, 9).toString('base64');
const CLIENTE = '00000000-0000-0000-0000-00000000c001';
const OUTRO_CLIENTE = '00000000-0000-0000-0000-00000000c002';

describe('gerar o token', () => {
  it('tem 43 caracteres base64url (32 bytes) e casa o formato aceito pela rota pública', () => {
    const t = gerarToken();
    expect(t).toMatch(FORMATO_DO_TOKEN);
    expect(tokenTemFormato(t)).toBe(true);
    expect(deBase64(t)).toHaveLength(BYTES_DO_TOKEN);
  });

  it('é aleatório: mil tokens, mil diferentes', () => {
    const vistos = new Set(Array.from({ length: 1000 }, gerarToken));
    expect(vistos.size).toBe(1000);
  });

  it('formato errado não passa (curto, longo, com caractere de fora)', () => {
    const t = gerarToken();
    expect(tokenTemFormato(t.slice(1))).toBe(false);
    expect(tokenTemFormato(t + 'A')).toBe(false);
    expect(tokenTemFormato(`${t.slice(0, 42)}/`)).toBe(false);
    expect(tokenTemFormato('')).toBe(false);
  });
});

describe('o hash', () => {
  it('é SHA-256 hexadecimal, estável e o mesmo que o Node calcula', async () => {
    const { createHash } = await import('node:crypto');
    const t = gerarToken();
    const h = await hashDoToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashDoToken(t)).toBe(h);
    expect(h).toBe(createHash('sha256').update(t).digest('hex'));
  });

  it('diferencia maiúscula de minúscula (base64url não se normaliza)', async () => {
    expect(await hashDoToken('A'.repeat(43))).not.toBe(await hashDoToken('a'.repeat(43)));
  });
});

describe('cifrar e decifrar', () => {
  it('volta o mesmo token', async () => {
    const chave = await chaveDoAmbiente({ [SEGREDO_DA_CHAVE]: CHAVE_DE_TESTE });
    const t = gerarToken();
    const c = await cifrarToken(t, chave, CLIENTE);
    expect(c).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(c).not.toContain(t);
    expect(await decifrarToken(c, chave, CLIENTE)).toBe(t);
  });

  it('o mesmo token cifra diferente a cada vez (vetor novo)', async () => {
    const chave = await chaveDoAmbiente({ [SEGREDO_DA_CHAVE]: CHAVE_DE_TESTE });
    const t = gerarToken();
    expect(await cifrarToken(t, chave, CLIENTE)).not.toBe(await cifrarToken(t, chave, CLIENTE));
  });

  it('preso ao cliente: o texto de um cliente não abre na linha de outro', async () => {
    const chave = await chaveDoAmbiente({ [SEGREDO_DA_CHAVE]: CHAVE_DE_TESTE });
    const c = await cifrarToken(gerarToken(), chave, CLIENTE);
    await expect(decifrarToken(c, chave, OUTRO_CLIENTE)).rejects.toBeInstanceOf(CifraInvalida);
  });

  it('outra chave, texto adulterado e formato estranho não abrem', async () => {
    const chave = await chaveDoAmbiente({ [SEGREDO_DA_CHAVE]: CHAVE_DE_TESTE });
    const outra = await chaveDoAmbiente({ [SEGREDO_DA_CHAVE]: OUTRA_CHAVE });
    const c = await cifrarToken(gerarToken(), chave, CLIENTE);
    await expect(decifrarToken(c, outra, CLIENTE)).rejects.toBeInstanceOf(CifraInvalida);
    const [v, iv, corpo] = c.split('.');
    const trocado = corpo.startsWith('A') ? `B${corpo.slice(1)}` : `A${corpo.slice(1)}`;
    await expect(decifrarToken(`${v}.${iv}.${trocado}`, chave, CLIENTE)).rejects.toBeInstanceOf(CifraInvalida);
    await expect(decifrarToken('v2.x.y', chave, CLIENTE)).rejects.toBeInstanceOf(CifraInvalida);
    await expect(decifrarToken('lixo', chave, CLIENTE)).rejects.toBeInstanceOf(CifraInvalida);
  });
});

describe('a chave do ambiente', () => {
  it('ausente ou vazia: recusa nomeando o segredo', async () => {
    await expect(chaveDoAmbiente({})).rejects.toBeInstanceOf(ChaveDoLinkAusente);
    await expect(chaveDoAmbiente({ [SEGREDO_DA_CHAVE]: '   ' })).rejects.toThrow(SEGREDO_DA_CHAVE);
  });

  it('tamanho errado ou fora de base64: recusa como inválida', async () => {
    await expect(chaveDoAmbiente({ [SEGREDO_DA_CHAVE]: Buffer.alloc(16, 1).toString('base64') })).rejects.toThrow(
      /32 bytes/,
    );
    await expect(chaveDoAmbiente({ [SEGREDO_DA_CHAVE]: 'não é base64!' })).rejects.toThrow(/32 bytes/);
  });

  it('aceita base64url também (sem `=`)', async () => {
    const url = paraBase64Url(new Uint8Array(32).fill(7));
    const chave = await chaveDoAmbiente({ [SEGREDO_DA_CHAVE]: url });
    const t = gerarToken();
    // A mesma chave em base64 comum decifra o que a base64url cifrou.
    const comum = await chaveDoAmbiente({ [SEGREDO_DA_CHAVE]: CHAVE_DE_TESTE });
    expect(await decifrarToken(await cifrarToken(t, chave, CLIENTE), comum, CLIENTE)).toBe(t);
  });
});

describe('o endereço', () => {
  it('é <origem>/aprovar/<token>, sem barra dobrada', () => {
    expect(enderecoDoLink('https://ideworks.example/', 'abc')).toBe('https://ideworks.example/aprovar/abc');
    expect(enderecoDoLink('https://ideworks.example', 'abc')).toBe('https://ideworks.example/aprovar/abc');
  });
});
