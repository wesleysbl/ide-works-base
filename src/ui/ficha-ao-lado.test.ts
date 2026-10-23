/**
 * A FICHA AO LADO — F43, Fase 7: as regras puras do card que abre num painel
 * à direita do Quadro (`@/ui/ficha-ao-lado`), o link único dos pontos que
 * abrem card (`LinkDaTarefa`) e a moldura que desenha o painel.
 *
 * O clique, o painel por cima do Quadro, o `Esc`, a guarda de saída, o F5 e a
 * comparação de controles entre o painel e a página são provados no Chrome
 * (`scripts/e2e/card-ao-lado.mjs`).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { LinkDaTarefa } from '@/board/LinkDaTarefa';
import {
  CHAVE_DA_FICHA_AO_LADO,
  cliqueAbreAoLado,
  comFichaAoLado,
  enderecoDaTarefa,
  fichaAoLadoDe,
  fichaAoLadoFechou,
  semFichaAoLado,
  telaQueAbreAoLado,
} from '@/ui/ficha-ao-lado';

describe('o estado da entrada', () => {
  it('lê a ficha ao lado só quando ela é um texto', () => {
    expect(fichaAoLadoDe({ fichaAoLado: 't1' })).toBe('t1');
    expect(fichaAoLadoDe({ fichaAoLado: '' })).toBeNull();
    expect(fichaAoLadoDe({ fichaAoLado: 3 })).toBeNull();
    expect(fichaAoLadoDe(null)).toBeNull();
    expect(fichaAoLadoDe('t1')).toBeNull();
    expect(fichaAoLadoDe({ progresso: { aba: 'feito', paginas: 2 } })).toBeNull();
  });

  it('abrir ao lado MANTÉM o que a tela guardava na entrada (o progresso de Minhas tarefas)', () => {
    const progresso = { aba: 'pendente', paginas: 3 };
    expect(comFichaAoLado({ progresso }, 't1')).toEqual({ progresso, [CHAVE_DA_FICHA_AO_LADO]: 't1' });
    expect(comFichaAoLado(null, 't1')).toEqual({ fichaAoLado: 't1' });
    expect(comFichaAoLado(['x'], 't1')).toEqual({ fichaAoLado: 't1' });
  });

  it('tirar a ficha devolve o resto, ou `null`', () => {
    const progresso = { aba: 'pendente', paginas: 3 };
    expect(semFichaAoLado({ progresso, fichaAoLado: 't1' })).toEqual({ progresso });
    expect(semFichaAoLado({ fichaAoLado: 't1' })).toBeNull();
    expect(semFichaAoLado(null)).toBeNull();
  });

  it('o endereço colável é a rota da página cheia', () => {
    expect(enderecoDaTarefa('abc')).toBe('/tarefa/abc');
  });

  it('a tela de trás relê quando a ficha fecha ou dá lugar a outra — e só aí', () => {
    expect(fichaAoLadoFechou('t1', null)).toBe(true);
    expect(fichaAoLadoFechou('t1', 't2')).toBe(true);
    expect(fichaAoLadoFechou(null, 't1')).toBe(false);
    expect(fichaAoLadoFechou('t1', 't1')).toBe(false);
    expect(fichaAoLadoFechou(null, null)).toBe(false);
  });
});

describe('onde e com que clique o card abre ao lado', () => {
  it('nas cinco telas de trabalho: Quadro (com e sem lista), Pasta, Espaço, Minhas e Todas', () => {
    for (const p of ['/quadro', '/quadro/l1', '/quadro/pasta/p1', '/quadro/espaco/e1', '/meu-trabalho', '/tarefas', '/tarefas/']) {
      expect(telaQueAbreAoLado(p), p).toBe(true);
    }
  });

  it('em nenhuma outra: a ficha, os avisos, o Controle, o Planejamento abrem a página cheia', () => {
    for (const p of ['/tarefa/t1', '/avisos', '/controle-da-semana', '/planejamento', '/painel', '/', '/quadro/a/b/c', '/tarefass']) {
      expect(telaQueAbreAoLado(p), p).toBe(false);
    }
  });

  const clique = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
  it('o clique simples do botão principal abre ao lado', () => {
    expect(cliqueAbreAoLado(clique)).toBe(true);
  });

  it('Ctrl, ⌘, Shift, Alt e o botão do meio são do navegador (aba nova → página cheia)', () => {
    expect(cliqueAbreAoLado({ ...clique, ctrlKey: true })).toBe(false);
    expect(cliqueAbreAoLado({ ...clique, metaKey: true })).toBe(false);
    expect(cliqueAbreAoLado({ ...clique, shiftKey: true })).toBe(false);
    expect(cliqueAbreAoLado({ ...clique, altKey: true })).toBe(false);
    expect(cliqueAbreAoLado({ ...clique, button: 1 })).toBe(false);
    expect(cliqueAbreAoLado({ ...clique, defaultPrevented: true })).toBe(false);
  });
});

describe('LinkDaTarefa — o link único', () => {
  const desenhar = (caminho: string, props: Partial<Parameters<typeof LinkDaTarefa>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: [caminho] },
        createElement(LinkDaTarefa, { id: 't-1', className: 'q-titulo-cartao q-abre', children: 'Revisar carrossel', ...props }),
      ),
    );

  it('o `href` é SEMPRE a página cheia — no Quadro e fora dele', () => {
    expect(desenhar('/quadro/l1')).toContain('href="/tarefa/t-1"');
    expect(desenhar('/avisos')).toContain('href="/tarefa/t-1"');
  });

  it('leva classe, título, nome acessível e o `draggable` do cartão', () => {
    const html = desenhar('/quadro/l1', { title: 'Subtarefa de X', rotulo: 'Abrir a tarefa mãe: X', draggable: false });
    expect(html).toContain('class="q-titulo-cartao q-abre"');
    expect(html).toContain('title="Subtarefa de X"');
    expect(html).toContain('aria-label="Abrir a tarefa mãe: X"');
    expect(html).toContain('draggable="false"');
  });
});

describe('quem usa o link único, e quem não usa', () => {
  const ler = (f: string) => readFileSync(join(import.meta.dirname, '..', f), 'utf8');

  it('os pontos que abrem card usam `LinkDaTarefa`, e nenhum `<Link to="/tarefa/…">` sobrou neles', () => {
    for (const f of ['board/CartaoDeTarefa.tsx', 'board/LinhaDeTrabalho.tsx', 'board/ListaDoEscopo.tsx']) {
      const fonte = ler(f);
      expect(fonte, f).toContain('<LinkDaTarefa');
      expect(fonte, f).not.toMatch(/<Link\s+to=\{`\/tarefa\//);
    }
  });

  it('os links de DENTRO da ficha e os avisos continuam abrindo a página cheia', () => {
    expect(ler('board/PassosDaTarefa.tsx')).toMatch(/<Link to=\{`\/tarefa\/\$\{sub\.id\}`\}/);
    expect(ler('board/ListaDeAvisos.tsx')).toMatch(/#comentario-/);
    expect(ler('board/ListaDeAvisos.tsx')).not.toContain('LinkDaTarefa');
  });

  it('a moldura desenha o painel com espera própria, fora da espera das telas', () => {
    const moldura = ler('ui/Moldura.tsx');
    expect(moldura).toMatch(/lazy\(\(\) => import\('@\/board\/FichaAoLado'\)\)/);
    expect(moldura).toMatch(/<Suspense fallback=\{null\}>\s*<FichaAoLado id=\{id\} \/>\s*<\/Suspense>/);
    expect(moldura).toMatch(/<Outlet \/>\s*<FichaAoLadoDaTela \/>/);
  });

  it('o painel é largo, cobre a tela abaixo de 1024 px, e tem "Abrir em tela cheia"', () => {
    const painel = ler('board/FichaAoLado.tsx');
    expect(painel).toContain('largura="min(64rem, 100vw)"');
    expect(painel).toContain('telaInteira="tablet"');
    expect(painel).toContain('aria-label="Abrir em tela cheia"');
    expect(painel).toMatch(/<FichaDaTarefa\s+key=\{id\}/);
  });

  it('as cinco telas releem quando o card ao lado fecha', () => {
    for (const f of ['pages/Quadro.tsx', 'pages/Pasta.tsx', 'pages/MeuTrabalho.tsx', 'pages/TodasAsTarefas.tsx', 'board/TrabalhoDoEscopo.tsx']) {
      expect(ler(f), f).toContain('useAoFecharAFichaAoLado(');
    }
  });
});
