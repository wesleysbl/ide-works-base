/**
 * O PAINEL AO LADO — F43, Fase 3: o contrato de marcação e as pontas do `Tab`.
 *
 * Desenha no servidor (`renderToStaticMarkup`): nenhum efeito roda, e sem DOM o
 * painel sai no lugar em vez do portal — é o que se lê aqui. O foco de abrir,
 * o `Esc`, o clique no véu e o foco que volta são provados no navegador
 * (`agenda-planejamento` AG11).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { voltaDoTab } from '@/ui/foco';
import { PainelLateral } from '@/ui/PainelLateral';

type Props = Parameters<typeof PainelLateral>[0];
const desenhar = (props: Partial<Omit<Props, 'children'>> = {}) =>
  renderToStaticMarkup(
    createElement(PainelLateral, {
      titulo: 'Café do Bairro',
      aoFechar: () => {},
      ...props,
      children: createElement('p', { className: 'conteudo' }, 'o corpo'),
    }),
  );

describe('PainelLateral — a marcação', () => {
  const html = desenhar({
    subtitulo: 'Carla · plano Conteúdo',
    contexto: createElement('span', { className: 'onde' }, 'Outubro de 2026'),
    rodape: createElement('a', { href: '/cliente/c-1' }, 'Abrir ficha do cliente'),
  });
  const dialogo = html.match(/<section ([^>]*)>/)?.[1] ?? '';

  it('é um diálogo modal, alcançável por programa e não pelo Tab', () => {
    expect(dialogo).toContain('role="dialog"');
    expect(dialogo).toContain('aria-modal="true"');
    expect(dialogo).toContain('tabindex="-1"');
    expect(dialogo).toContain('class="pll-painel"');
  });

  it('o nome do diálogo é o título visível (`aria-labelledby` → o `<h2>`)', () => {
    const id = dialogo.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`<h2 id="${id}" class="pll-titulo">Café do Bairro</h2>`);
    expect(dialogo).not.toContain('aria-label=');
  });

  it('o subtítulo fica ao lado do título; o corpo vem embaixo', () => {
    expect(html).toContain('<p class="pll-subtitulo">Carla · plano Conteúdo</p>');
    expect(html.indexOf('pll-titulo')).toBeLessThan(html.indexOf('class="conteudo"'));
    expect(html).toMatch(/<div class="pll-corpo">[\s\S]*<p class="conteudo">o corpo<\/p>/);
  });

  it('o X tem nome e mora na linha de cima, com o contexto', () => {
    expect(html).toMatch(
      /<header class="pll-topo"><div class="pll-contexto"><span class="onde">Outubro de 2026<\/span><\/div><button type="button" class="[^"]*o-btn-icone[^"]*" aria-label="Fechar">/,
    );
  });

  it('o rodapé fica fora da rolagem do corpo', () => {
    expect(html).toMatch(/<\/div><footer class="pll-rodape"><a href="\/cliente\/c-1">Abrir ficha do cliente<\/a><\/footer><\/section>/);
  });

  it('o véu é decoração para o leitor de tela, e vem antes do painel', () => {
    expect(html).toMatch(/^<div class="pll" data-painel-lateral=""><div class="pll-veu" aria-hidden="true"><\/div><section /);
  });

  it('sem rodapé, não há `<footer>`; sem subtítulo, não há linha vazia', () => {
    const simples = desenhar();
    expect(simples).not.toContain('<footer');
    expect(simples).not.toContain('pll-subtitulo');
  });

  it('sem título visível, o nome vem de `rotulo` (para a Fase 7, o card)', () => {
    const semTitulo = desenhar({ titulo: undefined, rotulo: 'Tarefa: Revisar carrossel' });
    const abre = semTitulo.match(/<section ([^>]*)>/)?.[1] ?? '';
    expect(abre).toContain('aria-label="Tarefa: Revisar carrossel"');
    expect(abre).not.toContain('aria-labelledby');
    expect(semTitulo).not.toContain('<h2');
  });

  it('`telaInteira="tablet"` marca o painel (a ficha da Fase 7); o padrão não marca nada', () => {
    const tablet = desenhar({ telaInteira: 'tablet' }).match(/<section ([^>]*)>/)?.[1] ?? '';
    expect(tablet).toContain('data-tela-inteira="tablet"');
    expect(dialogo).not.toContain('data-tela-inteira');
  });

  it('a largura sob medida vai como variável — a folha decide o celular', () => {
    expect(desenhar({ largura: 'min(54rem, 100vw)' })).toContain('style="--pll-largura:min(54rem, 100vw)"');
    expect(dialogo).not.toContain('style=');
  });
});

describe('PainelLateral — a folha', () => {
  const css = readFileSync(join(import.meta.dirname, 'painel-lateral.css'), 'utf8');

  it('acima da gaveta da barra (90/91) e abaixo da `Janela` (100): a peça abre por cima do painel', () => {
    const z = Number(css.match(/\.pll \{[^}]*z-index: (\d+)/)?.[1]);
    expect(z).toBeGreaterThan(91);
    expect(z).toBeLessThan(100);
  });

  it('no computador, 40rem no máximo; abaixo de 640 px, a tela inteira', () => {
    expect(css).toMatch(/--pll-largura: min\(40rem, 100vw\)/);
    expect(css).toMatch(/@media \(max-width: 639\.98px\) \{\s*\.pll-painel \{ left: 0; width: auto;/);
  });

  it('`telaInteira="tablet"`: abaixo de 1024 px, a tela inteira (F43, Fase 7)', () => {
    expect(css).toMatch(
      /@media \(max-width: 1023\.98px\) \{\s*\.pll-painel\[data-tela-inteira='tablet'\] \{ left: 0; width: auto; border-left: 0; \}/,
    );
  });

  it('quem rola é o corpo, e a rolagem não escorre para a página de trás', () => {
    expect(css).toMatch(/\.pll-corpo \{[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain;/);
  });

  it('o véu é token com opacidade, não `rgba` literal (D10)', () => {
    expect(css).toMatch(/\.pll-veu \{[^}]*background: var\(--ink-0\);[^}]*opacity:/);
    expect(css).not.toMatch(/rgba?\(/);
  });
});

describe('o Tab preso — só nas pontas', () => {
  it('do último, o Tab volta ao primeiro', () => {
    expect(voltaDoTab(4, 5, false)).toBe(0);
  });

  it('do primeiro, o Shift+Tab vai ao último', () => {
    expect(voltaDoTab(0, 5, true)).toBe(4);
  });

  it('da própria caixa (o foco de abrir), o Shift+Tab vai ao último e o Tab segue o navegador', () => {
    expect(voltaDoTab(-1, 5, true)).toBe(4);
    expect(voltaDoTab(-1, 5, false)).toBeNull();
  });

  it('no meio, quem anda é o navegador', () => {
    expect(voltaDoTab(2, 5, false)).toBeNull();
    expect(voltaDoTab(2, 5, true)).toBeNull();
  });

  it('com um só alcançável, ele mesmo; sem nenhum, nada', () => {
    expect(voltaDoTab(0, 1, false)).toBe(0);
    expect(voltaDoTab(0, 1, true)).toBe(0);
    expect(voltaDoTab(-1, 0, false)).toBeNull();
  });
});
