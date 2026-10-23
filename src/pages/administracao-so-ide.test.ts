/**
 * F31, Fase 3a — a administração só fala da Ide: as peças de tela.
 *
 * O servidor decide QUEM recebe a unidade omitida (ver
 * `server/omitidas-banco.test.ts`, "Pessoas, Convite e Catálogos"): aqui se
 * prova o que a tela desenha com o que chegou — o selo "omitida" em Catálogos,
 * o × da janela de unidades na linha do título, e o resumo do Convite com cara
 * de botão.
 *
 * Desenho no servidor (`renderToStaticMarkup`): nenhum `useEffect` roda, então
 * as peças são exercidas com os dados na mão, sem a página inteira.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AcoesDaUnidade, SelosDaUnidade } from '@/pages/Catalogos';
import { AcessoPorUnidade } from '@/pages/Contas';
import { EditorDeLista } from '@/pages/Pessoas';

describe('Catálogos — o selo "omitida"', () => {
  const selos = (unidade: { isDefault: boolean; omitida?: boolean }) =>
    renderToStaticMarkup(createElement(SelosDaUnidade, { unidade }));

  it('a unidade omitida (que só o super admin recebe) sai com o selo', () => {
    const html = selos({ isDefault: false, omitida: true });
    expect(html).toContain('>omitida</span>');
    // Diz que nada foi apagado e como voltar, ao parar o ponteiro.
    expect(html).toMatch(/title="[^"]*Nada foi apagado[^"]*"/);
  });

  it('sem o campo (todos os outros casos, e a variável desligada), nenhum selo "omitida"', () => {
    expect(selos({ isDefault: false })).toBe('');
    expect(selos({ isDefault: true })).toContain('>padrão</span>');
    expect(selos({ isDefault: true })).not.toContain('omitida');
  });
});

describe('Pessoas — a janela de unidades em 390', () => {
  const html = renderToStaticMarkup(
    createElement(EditorDeLista, {
      titulo: 'Acesso aos clientes por unidade',
      subtitulo: 'Maria de Souza Albuquerque',
      explicacao: 'A pessoa passa a ver TODOS os clientes das unidades marcadas.',
      carregar: async (): Promise<[{ id: string; nome: string }[], { id: string; nome: string }[]]> => [[], []],
      aoFechar: () => {},
      aoSalvar: async () => {},
    }),
  );
  const cabecalho = html.match(/<header[^>]*>([\s\S]*?)<\/header>/);

  it('o cabeçalho não quebra linha: o × não cai sozinho embaixo do título', () => {
    expect(cabecalho).not.toBeNull();
    const classe = html.match(/<header class="([^"]*)"/)?.[1] ?? '';
    expect(classe).toContain('flex');
    expect(classe).not.toContain('flex-wrap');
  });

  it('o × mora no próprio cabeçalho, ao lado do título, que é quem encolhe', () => {
    const dentro = cabecalho?.[1] ?? '';
    expect(dentro).toContain('aria-label="Fechar"');
    expect(dentro).toContain('Acesso aos clientes por unidade');
    // O bloco do título encolhe e quebra por dentro; a contagem não encolhe.
    expect(dentro).toMatch(/^<div class="[^"]*\bmin-w-0\b[^"]*\bflex-1\b/);
    expect(dentro).toMatch(/class="[^"]*\bshrink-0\b[^"]*"[^>]*>0 marcado\(s\)</);
  });
});

describe('Convite — o resumo recolhido tem cara de que abre', () => {
  const resumo = (marcadas: string[]) =>
    renderToStaticMarkup(
      createElement(AcessoPorUnidade, {
        todas: [
          { id: 'a', nome: 'Ide' },
          { id: 'b', nome: 'Ide Hub' },
        ],
        marcadas,
        aoAlternar: () => {},
      }),
    );

  it('fechado por padrão, com o verbo do que se faz ao abrir e a contagem à vista', () => {
    const html = resumo([]);
    expect(html).toMatch(/<details(?![^>]*\bopen\b)[^>]*>/);
    const sumario = html.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? '';
    expect(sumario).toContain('Escolher unidades');
    expect(sumario).toContain('nenhuma marcada');
    expect(resumo(['a'])).toContain('1 marcada<');
    expect(resumo(['a', 'b'])).toContain('2 marcadas');
  });

  it('é botão com borda, e a seta é SVG que gira com o `open` — não mais o ▸ de fonte', () => {
    const html = resumo([]);
    const classe = html.match(/<summary class="([^"]*)"/)?.[1] ?? '';
    expect(classe).toContain('o-btn');
    expect(classe).toContain('o-btn-vidro');
    const sumario = html.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? '';
    expect(sumario).toMatch(/^<svg[^>]*class="[^"]*group-open:rotate-90/);
    expect(html).not.toContain('▸');
  });

  it('as unidades oferecidas são as que chegaram (o servidor já tirou a omitida)', () => {
    const html = resumo(['b']);
    expect(html).toContain('>Ide<');
    expect(html).toContain('>Ide Hub<');
    expect(html).not.toContain('Alma');
  });
});

describe('Catálogos — a unidade omitida não tem botão (F31, Fase 3b)', () => {
  const acoes = (unidade: { isDefault: boolean; omitida?: boolean }) =>
    renderToStaticMarkup(
      createElement(AcoesDaUnidade, {
        unidade,
        aoTornarPadrao: () => {},
        aoEditar: () => {},
        aoApagar: () => {},
      }),
    );

  it('omitida: nem "Tornar padrão", nem Editar, nem apagar — só o selo, desenhado ao lado', () => {
    expect(acoes({ isDefault: false, omitida: true })).toBe('');
  });

  it('as outras seguem com os três botões de sempre', () => {
    const html = acoes({ isDefault: false });
    expect(html).toContain('Tornar padrão');
    expect(html).toContain('Editar');
    // F13: a lixeira com nome no lugar do `✕` solto.
    expect(html).toContain('aria-label="Apagar a unidade"');
  });

  it('a padrão: sem "Tornar padrão", e o apagar desabilitado — como antes', () => {
    const html = acoes({ isDefault: true });
    expect(html).not.toContain('Tornar padrão');
    expect(html).toContain('Editar');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Apagar a unidade"/);
  });
});
