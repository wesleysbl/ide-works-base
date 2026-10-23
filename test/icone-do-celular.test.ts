/**
 * O ÍCONE DO CELULAR — F29, pedido do Wesley em 23/09/2026.
 *
 * Salvar o IdeWorks na tela inicial tem de mostrar o logo e o nome "IdeWorks".
 * Nada disto quebra quando se desfaz: um manifesto com JSON inválido, um ícone
 * apagado ou o `<link>` que some do `index.html` só devolvem, em silêncio, a
 * letra no círculo do Android e a foto da página do iPhone. Por isso a guarda
 * lê os fontes, como `letra-pequena.test.ts` — não precisa de navegador.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLICO = join(RAIZ, 'public');
const INDEX = readFileSync(join(RAIZ, 'index.html'), 'utf8');

type Icone = { src: string; sizes: string; type: string; purpose?: string };

/** Largura e altura lidas do cabeçalho IHDR do PNG (bytes 16–23). */
function dimensoes(arquivo: string): [number, number] {
  const b = new Uint8Array(readFileSync(arquivo));
  expect(String.fromCharCode(b[1], b[2], b[3]), `${arquivo} não é PNG`).toBe('PNG');
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return [v.getUint32(16), v.getUint32(20)];
}

describe('o manifesto do app', () => {
  const texto = readFileSync(join(PUBLICO, 'manifest.webmanifest'), 'utf8');

  it('é JSON válido e se chama IdeWorks', () => {
    const m = JSON.parse(texto) as { short_name: string; name: string; display: string };
    expect(m.short_name).toBe('IdeWorks');
    expect(m.name).toBe('IdeWorks');
    expect(m.display).toBe('standalone');
  });

  it('aponta ícones 192 e 512 que existem em `public/` e têm o tamanho que dizem', () => {
    const { icons } = JSON.parse(texto) as { icons: Icone[] };
    const tamanhos = new Set(icons.map((i) => i.sizes));
    expect(tamanhos).toEqual(new Set(['192x192', '512x512']));
    expect(icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const i of icons) {
      const arquivo = join(PUBLICO, i.src.replace(/^\//, ''));
      expect(existsSync(arquivo), `${i.src} não existe em public/`).toBe(true);
      const [l, a] = dimensoes(arquivo);
      expect(`${l}x${a}`, i.src).toBe(i.sizes);
    }
  });
});

describe('o index.html aponta para o ícone', () => {
  it('liga o manifesto', () => {
    expect(INDEX).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/);
  });

  it('liga o apple-touch-icon, que existe e tem 180×180', () => {
    expect(INDEX).toMatch(/<link rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
    expect(dimensoes(join(PUBLICO, 'apple-touch-icon.png'))).toEqual([180, 180]);
  });

  it('o iPhone abre em tela cheia com o nome IdeWorks', () => {
    expect(INDEX).toMatch(/<meta name="apple-mobile-web-app-capable" content="yes"/);
    expect(INDEX).toMatch(/<meta name="apple-mobile-web-app-title" content="IdeWorks"/);
  });
});
