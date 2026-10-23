/**
 * F10d — claro, escuro, e "segue o sistema".
 *
 * O terceiro estado é o que costuma sumir, e é o que mais importa: sem ele, um
 * clique de curiosidade congela a tela para sempre.
 */

import { describe, expect, it } from 'vitest';

import { CHAVE, escolhaGuardada, temaDoSistema, temaEfetivo } from '@/ui/tema';

describe('escolhaGuardada', () => {
  it('lê a escolha da chave certa', () => {
    expect(escolhaGuardada((k) => (k === CHAVE ? 'claro' : null))).toBe('claro');
    expect(escolhaGuardada((k) => (k === CHAVE ? 'escuro' : null))).toBe('escuro');
  });

  it('nada guardado é "sistema", e não "escuro"', () => {
    // A diferença é toda: "escuro" é escolha, "sistema" é a ausência dela.
    expect(escolhaGuardada(() => null)).toBe('sistema');
  });

  it('valor estranho vira "sistema" em vez de estourar', () => {
    // O armazenamento é do navegador: pode ter qualquer coisa lá, inclusive de
    // uma versão futura deste mesmo sistema.
    expect(escolhaGuardada(() => 'roxo')).toBe('sistema');
    expect(escolhaGuardada(() => '')).toBe('sistema');
  });
});

describe('temaEfetivo', () => {
  it('a escolha manda sobre o aparelho', () => {
    expect(temaEfetivo('claro', 'escuro')).toBe('claro');
    expect(temaEfetivo('escuro', 'claro')).toBe('escuro');
  });

  it('em "sistema", o aparelho manda', () => {
    expect(temaEfetivo('sistema', 'claro')).toBe('claro');
    expect(temaEfetivo('sistema', 'escuro')).toBe('escuro');
  });
});

describe('temaDoSistema', () => {
  it('devolve claro quando o aparelho pede claro', () => {
    expect(temaDoSistema((c) => c.includes('light'))).toBe('claro');
  });

  it('sem preferência declarada, ESCURO — que é a cara do OBSIDIAN', () => {
    expect(temaDoSistema(() => false)).toBe('escuro');
  });
});

/**
 * F01 do plano UX — a paleta tem um dono só, e a marca é leve.
 *
 * Até a F01 `layout-foco.css` redefinia `--ink-*`, `--plat*` e `--mute` por
 * cima do OBSIDIAN. Os testes de contraste liam `obsidian.css` e passavam
 * medindo uma paleta que a tela já não usava. Se alguém voltar a sobrescrever
 * a paleta numa folha de componente, isto cai antes do contraste mentir.
 */
describe('F01: dono dos tokens e peso da marca', async () => {
  const { readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const raiz = join(import.meta.dirname, '..', '..');
  const foco = readFileSync(join(raiz, 'src', 'ui', 'layout-foco.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );

  it('layout-foco.css não redefine a paleta nem os papéis', () => {
    expect(foco).not.toMatch(/--(ink-\d|plat|plat-dim|mute|luz|iw-[a-z-]+)\s*:/);
  });

  it('a marca usa a máscara leve, e não a arte inteira', () => {
    expect(foco).toContain("url('/ideworks-marca.png')");
    expect(foco).not.toContain('ideworks-marca-original.png');
    expect(foco).not.toMatch(/\.iw-marca[^{]*\{[^}]*(mix-blend-mode|filter)/);
    const leve = statSync(join(raiz, 'public', 'ideworks-marca.png')).size;
    // F16: a arte original (1,38 MB) saiu de `public/` — ia para o dist sem uso.
    // Fica guardada em `docs/imagens/`, fora do pacote.
    const original = statSync(join(raiz, 'docs', 'imagens', 'ideworks-marca-original.png')).size;
    expect(leve).toBeLessThan(32 * 1024);
    expect(leve).toBeLessThan(original / 20);
  });

  it('a arte original não vai para o pacote (nada em public/ passa de 300 KB)', async () => {
    const { readdirSync } = await import('node:fs');
    const publicos = readdirSync(join(raiz, 'public'));
    expect(publicos).not.toContain('ideworks-marca-original.png');
    for (const nome of publicos) {
      expect({ nome, bytes: statSync(join(raiz, 'public', nome)).size }).toSatisfy(
        (x: { bytes: number }) => x.bytes < 300 * 1024,
      );
    }
  });
});
