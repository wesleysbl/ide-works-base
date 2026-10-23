/**
 * O TOPO DAS TELAS — F29 (Fases 4 e 5a).
 *
 * O pedido do Wesley (23/09, opção A): **a trilha substitui o Voltar**. O
 * `‹ Voltar` fazia "anterior" ou "acima" sem dizer qual; cada degrau da trilha
 * diz o nome do lugar a que leva. Estes testes guardam a forma do topo —
 * título, trilha, ações, e NENHUM Voltar — e o destino de cada degrau, que é o
 * que substitui o botão.
 *
 * Desenho sem navegador (`renderToStaticMarkup`), como o resto da suíte: nenhum
 * efeito roda, então a trilha sai inteira (a medição que a encurta é efeito).
 */

import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { Trilha } from '@/board/TrilhaDoLugar';
import { trilhaDaTarefa, trilhaDeDetalhe, trilhaDoQuadro } from '@/board/trilha';
import { Pagina, PaginaLarga } from '@/ui/primitivos';
import { Topo } from '@/ui/Topo';
import { Voltar } from '@/ui/Voltar';

const noRoteador = (no: ReactNode, caminho = '/tarefa/t1') =>
  renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [caminho] }, no));

const LUGAR = {
  categoryName: 'Ide',
  spaceId: 'sa',
  spaceName: 'AGÊNCIA IDE',
  folderId: 'f1',
  folderName: 'TIME HELENA',
  listId: 'l1',
  listName: 'Jatobá',
};

/** Os `href` dos degraus, na ordem da trilha. */
const hrefs = (html: string) =>
  [...(/<nav class="tr-trilha"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '').matchAll(/href="([^"]*)"/g)].map(
    (m) => m[1],
  );

describe('o topo', () => {
  it('tela principal: só o título, num `<h1>`, sem trilha, sem Voltar e sem a marca', () => {
    const html = noRoteador(createElement(Topo, { titulo: 'Minhas tarefas' }), '/meu-trabalho');
    expect(html).toMatch(/<header class="o-topo[^"]*"/);
    expect(html).toMatch(/<h1 class="o-titulo[^"]*">Minhas tarefas<\/h1>/);
    expect(html).not.toContain('tr-trilha');
    // Sem a linha reservada: tela principal não tem trilha nenhuma a esperar.
    expect(html).not.toContain('o-topo-trilha');
    expect(html).not.toContain('Voltar');
    // A marca "ide" mora no alto da barra desde a F29.1.
    expect(html).not.toMatch(/>ide</);
  });

  it('a trilha da ficha: cada degrau leva a um lugar com nome, e o último é onde se está', () => {
    const html = noRoteador(
      createElement(Topo, {
        titulo: 'Tarefa',
        trilha: createElement(Trilha, {
          degraus: trilhaDaTarefa({ ...LUGAR, title: 'Gravar depoimento' }),
        }),
      }),
    );
    // Raiz → `/quadro`; espaço, pasta e lista → a tela de cada um (28/09). A
    // tarefa — onde se está — não clica. A empresa saiu na F31.
    expect(hrefs(html)).toEqual(['/quadro', '/quadro/espaco/sa', '/quadro/pasta/f1', '/quadro/l1']);
    expect(html).toContain('aria-current="page"');
    expect(html).toMatch(/<span class="tr-degrau" title="Gravar depoimento" aria-current="page">/);
    // A trilha vem ANTES do título: o caminho em cima, o nome da tela embaixo.
    expect(html.indexOf('tr-trilha')).toBeLessThan(html.indexOf('<h1'));
    expect(html).not.toContain('Voltar');
  });

  it('no quadro, espaço e pasta LEVAM às telas deles, mesmo com a árvore na tela (28/09)', () => {
    const html = noRoteador(
      createElement(Topo, {
        titulo: 'Quadro',
        trilha: createElement(Trilha, { degraus: trilhaDoQuadro(LUGAR), aoRevelar: () => {} }),
      }),
      '/quadro/l1',
    );
    // "Clicar em TIME HELENA abre os cards do Time Helena todos juntos" (Wesley).
    // Revelar o nó na árvore recolhida não mostrava nada. A raiz não clica no
    // quadro (`/quadro` reabriria esta mesma lista) e a lista é onde se está.
    expect(hrefs(html)).toEqual(['/quadro/espaco/sa', '/quadro/pasta/f1']);
    expect(html).not.toContain('na barra lateral');
  });

  it('trilha que ainda não chegou (`null`): a linha fica reservada, vazia — o título não pula', () => {
    const html = noRoteador(createElement(Topo, { titulo: 'Tarefa', trilha: null }));
    expect(html).toContain('o-topo-trilha');
    expect(html).not.toContain('tr-trilha');
    expect(html.indexOf('o-topo-trilha')).toBeLessThan(html.indexOf('<h1'));
  });

  it('as ações moram à direita do título — o X da ficha é a única saída que não é degrau', () => {
    const html = noRoteador(
      createElement(Topo, {
        titulo: 'Tarefa',
        className: 't-cabeca',
        trilha: null,
        acoes: createElement(Voltar, { acima: '/quadro/l1' }),
      }),
    );
    expect(html).toMatch(/<header class="o-topo[^"]*\bt-cabeca\b/);
    const x = html.indexOf('aria-label="Fechar tarefa e voltar"');
    expect(x).toBeGreaterThan(html.indexOf('</h1>'));
    expect(html).not.toContain('>Voltar</button>');
  });
});

describe('o topo das telas de detalhe fora da árvore — F29 (Fase 5a)', () => {
  it('a ficha do cliente: `Painel ›` leva ao painel, e o cliente é onde se está', () => {
    const html = noRoteador(
      createElement(Topo, {
        titulo: 'Jatobá',
        trilha: createElement(Trilha, {
          degraus: trilhaDeDetalhe({ nome: 'Painel', destino: '/painel' }, 'Jatobá'),
        }),
      }),
      '/cliente/c1',
    );
    expect(hrefs(html)).toEqual(['/painel']);
    expect(html).toMatch(/<a class="tr-degrau"[^>]*href="\/painel"[^>]*>[\s\S]*?Painel/);
    expect(html).toMatch(/<span class="tr-degrau" title="Jatobá" aria-current="page">/);
    expect(html).not.toContain('Voltar');
  });
});

describe('o alvo do "Pular para o conteúdo" — F29 (Fase 5a)', () => {
  it('o topo é `#conteudo`, e recebe foco só por programa (`tabindex="-1"`)', () => {
    const html = noRoteador(createElement(Topo, { titulo: 'Painel' }), '/painel');
    expect(html).toMatch(/<header class="o-topo[^"]*" id="conteudo" tabindex="-1">/);
  });
});

describe('as ações que não cabem descem — F29 (Fase 5a)', () => {
  it('o topo quebra de linha, e as ações não travam a largura', () => {
    const html = noRoteador(
      createElement(Topo, { titulo: 'Painel', acoes: createElement('button', null, 'Novo cliente') }),
      '/painel',
    );
    expect(html).toMatch(/<header class="o-topo[^"]*\bflex-wrap\b/);
    // O título tem base própria: é ela que empurra as ações para baixo, em vez
    // de o título encolher até sumir ao lado delas.
    expect(html).toContain('flex-[1_1_12rem]');
    // Sem `shrink-0` na caixa das ações: numa linha só delas, quebram por dentro.
    expect(html).not.toMatch(/<div class="[^"]*shrink-0[^"]*"><button>Novo cliente/);
  });

  it('o título mora no alto da linha, qualquer que seja a altura das ações — F29.5b', () => {
    // Com `items-center` o `<h1>` descia conforme as ações da tela: o do Painel
    // ficava abaixo do do Chat. O topo alinha pelo alto; as ações se centram.
    const html = noRoteador(
      createElement(Topo, { titulo: 'Painel', acoes: createElement('button', null, 'Novo cliente') }),
      '/painel',
    );
    expect(html).toMatch(/<header class="o-topo[^"]*\bitems-start\b/);
    expect(html).not.toMatch(/<header class="o-topo[^"]*\bitems-center\b/);
    expect(html).toMatch(/<div class="[^"]*\bself-center\b[^"]*"><button>Novo cliente/);
  });
});

describe('as molduras não desenham saída nenhuma — F29 (Fase 5a)', () => {
  it('a larga não desenha o Voltar em rota nenhuma — nem onde havia um lugar acima', () => {
    // `/cliente/x` tinha lugar acima na tabela (`/painel`), e até a Fase 4 a
    // moldura desenhava o Voltar ali. Desde a 5a a saída é o topo da tela.
    for (const rota of ['/cliente/x', '/meta/ranking', '/painel']) {
      const html = noRoteador(createElement(PaginaLarga, { children: 'miolo' }), rota);
      expect(html, rota).not.toContain('Voltar');
      expect(html).toContain('miolo');
    }
  });

  it('a estreita só desenha saída quando a tela a pede, e com o NOME do lugar', () => {
    const semSaida = noRoteador(createElement(Pagina, { titulo: 'IDE Works', children: 'x' }), '/');
    expect(semSaida).not.toContain('<a');
    expect(semSaida).not.toContain('Voltar');

    const comSaida = noRoteador(
      createElement(Pagina, { titulo: 'Ativar conta', saida: { rotulo: 'Entrada', para: '/' }, children: 'x' }),
      '/ativar',
    );
    expect(comSaida).toMatch(/<a class="o-btn[^"]*" href="\/"[^>]*>[\s\S]*?Entrada<\/a>/);
    expect(comSaida).not.toContain('Voltar');
    // A saída vem antes do título, onde o Voltar morava.
    expect(comSaida.indexOf('Entrada')).toBeLessThan(comSaida.indexOf('<h1'));
  });
});

describe('as duas alturas do topo — F03 do plano UX', () => {
  it('página: sem `data-variante`, ações num contêiner nomeado, título sem truncar', () => {
    const html = noRoteador(createElement(Topo, { titulo: 'Painel', acoes: createElement('button', { type: 'button' }, 'Novo cliente') }), '/painel');
    expect(html).not.toContain('data-variante');
    expect(html).toMatch(/<div class="o-topo-acoes[^"]*"><button type="button">Novo cliente<\/button><\/div>/);
    // O nome quebra em vez de sumir em reticências: é a resposta a "onde estou".
    expect(html).toMatch(/<h1 class="o-titulo">Painel<\/h1>/);
  });

  it('compacta: continua o `<h1>` e o alvo do "Pular para o conteúdo"', () => {
    const html = noRoteador(createElement(Topo, { titulo: 'Chat', variante: 'compacta' }), '/chat');
    expect(html).toMatch(/<header class="o-topo[^"]*" id="conteudo" tabindex="-1" data-variante="compacta">/);
    expect(html).toMatch(/<h1 class="o-titulo">Chat<\/h1>/);
  });
});
