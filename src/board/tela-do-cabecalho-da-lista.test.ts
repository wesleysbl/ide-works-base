/**
 * O CABEÇALHO DA LISTA DIZ DE QUE CLIENTE ELA É.
 *
 * POR QUE ESTE TESTE EXISTE
 *   A F17.43 deixou a dívida: só a barra lateral sabia de quem a lista era.
 *   Quem estava DENTRO do quadro precisava caçar o ícone na lateral. Esta
 *   peça é o caminho de volta — o nome escrito, e o clique abrindo a ficha.
 *
 * SEM NAVEGADOR, E POR ISSO SEM A PÁGINA INTEIRA
 *   `pages/Quadro.tsx` busca o quadro num efeito, e efeito não roda em
 *   `renderToStaticMarkup`. Desde a F06A o nome da lista É o título da página:
 *   o que se desenha aqui é a MESMA composição que o quadro monta quando a
 *   lista chegou — o `Topo` com o nome no `<h1>` e o `SinalDoClienteDaLista`
 *   na linha dele (`junto`). O que isso vale no navegador está em
 *   `scripts/e2e/espacos-e-arrasto.mjs` (F06A).
 *
 * ESCRITO EM `createElement`, E NÃO EM JSX
 *   A suíte só inclui `*.test.ts`. Um `.tsx` não seria executado.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { SinalDoClienteDaLista } from '@/board/SinalDoClienteDaLista';
import { Topo } from '@/ui/Topo';

function desenhar(clientId: string | null, clientName: string | null, nome = 'Demandas'): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(Topo, {
        titulo: nome,
        junto: createElement(SinalDoClienteDaLista, { clientId, clientName }),
      }),
    ),
  );
}

describe('dentro da lista, o cabeçalho diz de que cliente ela é', () => {
  it('o nome aparece e o clique leva à ficha', () => {
    const html = desenhar('cli-1', 'Jatobá');
    // F06A: o nome da lista é o `<h1>` — a identidade da página, e não a forma.
    expect(html).toMatch(/<h1 class="o-titulo">Demandas<\/h1>/);
    expect(html).toContain('Jatobá');
    expect(html).toContain('href="/cliente/cli-1"');
    expect(html).toContain('Abrir a ficha de Jatobá');
  });

  it('lista SEM cliente não ganha caminho nenhum — atalho morto é pior que ausente', () => {
    const html = desenhar(null, null);
    expect(html).toContain('Demandas');
    expect(html).not.toContain('Abrir a ficha de');
    expect(html).not.toContain('href="/cliente/');
  });

  it('com vínculo mas SEM o nome, nada é desenhado', () => {
    // Quem alcança a lista e não alcança o cliente lê o nome nulo. Um chip
    // "Ficha do cliente" levaria a um 404 — e contaria que o cliente existe.
    const html = desenhar('cli-1', null);
    expect(html).toContain('Demandas');
    expect(html).not.toContain('Abrir a ficha de');
    expect(html).not.toContain('href="/cliente/');
    expect(html).not.toContain('data-cliente-da-lista');
  });
});
