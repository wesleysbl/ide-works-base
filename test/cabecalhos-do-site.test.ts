/**
 * OS CABEÇALHOS DO SITE — revisão de segurança de 09/10/2026.
 *
 * O site é estático e os cabeçalhos moram em `public/_headers` (Cloudflare
 * Workers Static Assets). O Worker só atende `/api`, `/mcp` e o OAuth; a casca
 * do app e a página do cliente (`/aprovar/:token`) saem do arquivo.
 *
 * O QUE SE COBRA
 *   · Nenhuma página do site pode ser posta dentro de um `<iframe>` de outro
 *     site. A do cliente tem um botão que muda estado (Aprovar) e o token no
 *     endereço: embutida numa página alheia, o cliente seria levado a clicar no
 *     que não vê. A do app já não carrega sessão em quadro de outro site
 *     (`SameSite=Strict`), mas não há motivo para ser embutida.
 *   · Nenhum navegador adivinha o tipo de um arquivo do site (`nosniff`).
 *   · A regra da página do cliente (sem Referer, sem buscador, sem cache) fica.
 *
 * O arquivo é lido como Cloudflare o lê: um caminho por linha sem recuo, e as
 * linhas recuadas abaixo dele são os cabeçalhos dessa regra.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const bruto = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'public', '_headers'),
  'utf8',
);

function regras(): Map<string, Map<string, string>> {
  const saida = new Map<string, Map<string, string>>();
  let atual: Map<string, string> | null = null;
  for (const linha of bruto.split('\n')) {
    if (linha.trim() === '' || linha.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(linha)) {
      atual = new Map();
      saida.set(linha.trim(), atual);
    } else if (atual) {
      const corte = linha.indexOf(':');
      atual.set(linha.slice(0, corte).trim().toLowerCase(), linha.slice(corte + 1).trim());
    }
  }
  return saida;
}

describe('public/_headers', () => {
  it('o site inteiro não se deixa embutir em página de outro site, nem ter o tipo adivinhado', () => {
    const todas = regras().get('/*');
    expect(todas, 'falta a regra /*').toBeDefined();
    expect(todas?.get('x-frame-options')).toBe('DENY');
    expect(todas?.get('x-content-type-options')).toBe('nosniff');
  });

  it('a página do cliente continua sem Referer, sem buscador e sem cache', () => {
    const cliente = regras().get('/aprovar/*');
    expect(cliente?.get('referrer-policy')).toBe('no-referrer');
    expect(cliente?.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(cliente?.get('cache-control')).toBe('no-store');
  });
});
