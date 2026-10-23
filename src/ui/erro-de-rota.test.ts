/**
 * A TELA DE ERRO DE ROTA — conferência de 09/10/2026.
 *
 * Uma tela que estoura ao desenhar (dado parcial da API, um nulo onde se
 * esperava lista) fazia o roteador mostrar o "Unexpected Application Error!"
 * dele, com a pilha crua, trocando o app INTEIRO — barra lateral inclusa. Aqui
 * se prova o que se prova sem navegador:
 *
 *   1. como se reconhece a falha de PEDAÇO que não baixou (a publicação trocou
 *      os nomes dos arquivos) — o caso que `recarga-por-pacote-novo` já trata
 *      e que pede outro botão;
 *   2. o que a tela diz em cada caso, e que os dois botões existem;
 *   3. que a tabela de rotas a usa em toda tela — e que, desenhada no lugar de
 *      uma tela estourada, ela mantém a barra lateral (e some com ela nas
 *      rotas públicas, onde a barra buscaria dados de quem não tem sessão).
 *
 * O botão em ação (reerguer a tela, recarregar) é provado no navegador, em
 * `scripts/e2e/tela-de-erro.mjs`: `renderToStaticMarkup` não executa efeitos
 * nem fronteiras de erro.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, type RouteObject, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { ROTAS } from '@/rotas';
import { TelaDeErro } from '@/ui/ErroDeRota';
import { detalhesDoErro, ehFalhaDePacote } from '@/ui/erro-de-rota';

describe('ehFalhaDePacote — o pedaço da tela que não baixou', () => {
  it('reconhece a frase de cada navegador e a do Vite', () => {
    const frases = [
      'Failed to fetch dynamically imported module: https://works.example/assets/Quadro-a1b2c3.js', // Chrome
      'error loading dynamically imported module: https://works.example/assets/Quadro-a1b2c3.js', // Firefox
      'Importing a module script failed.', // Safari
      'Unable to preload CSS for /assets/Quadro-a1b2c3.css', // Vite, folha de estilo do pedaço
    ];
    for (const frase of frases) expect(ehFalhaDePacote(new TypeError(frase)), frase).toBe(true);
  });

  it('reconhece o nome ChunkLoadError', () => {
    const erro = new Error('Loading chunk 7 failed.');
    erro.name = 'ChunkLoadError';
    expect(ehFalhaDePacote(erro)).toBe(true);
  });

  it('um estouro de código comum NÃO é falha de pedaço — tentar de novo pode resolver', () => {
    expect(ehFalhaDePacote(new TypeError("Cannot read properties of undefined (reading 'length')"))).toBe(false);
    expect(ehFalhaDePacote(new Error('boom'))).toBe(false);
  });

  it('valores que não são Error (string, nulo, objeto solto) não quebram a pergunta', () => {
    expect(ehFalhaDePacote('Failed to fetch dynamically imported module')).toBe(false);
    expect(ehFalhaDePacote(null)).toBe(false);
    expect(ehFalhaDePacote(undefined)).toBe(false);
    expect(ehFalhaDePacote({ status: 404 })).toBe(false);
  });
});

describe('detalhesDoErro — o que o desenvolvedor vê', () => {
  it('Error: a mensagem e a pilha', () => {
    const erro = new TypeError('x é indefinido');
    const d = detalhesDoErro(erro);
    expect(d).toContain('TypeError: x é indefinido');
    expect(d).toContain('erro-de-rota.test');
  });

  it('o que não é Error vira texto, sem lançar', () => {
    expect(detalhesDoErro('quebrou')).toBe('quebrou');
    expect(detalhesDoErro(null)).toBe('Erro sem detalhes.');
    expect(detalhesDoErro({ status: 404, statusText: 'Not Found' })).toContain('404');
  });
});

const nada = () => undefined;
const desenhar = (props: Parameters<typeof TelaDeErro>[0]) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(TelaDeErro, props)));

describe('TelaDeErro', () => {
  it('estouro comum: diz em português que a tela não abriu e oferece os dois botões', () => {
    const html = desenhar({ pacoteNovo: false, aoTentarDeNovo: nada, aoRecarregar: nada });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Algo deu errado ao montar esta tela');
    expect(html).toContain('>Tentar de novo</button>');
    expect(html).toContain('>Recarregar a página</button>');
    // Nada de pilha crua para quem não é desenvolvedor.
    expect(html).not.toContain('<details');
    expect(html).not.toContain('Unexpected Application Error');
  });

  it('falha de pedaço: pede a recarga e NÃO oferece "Tentar de novo" (o `lazy` guarda a falha)', () => {
    const html = desenhar({ pacoteNovo: true, aoTentarDeNovo: nada, aoRecarregar: nada });
    expect(html).toContain('versão nova');
    expect(html).toContain('>Recarregar a página</button>');
    expect(html).not.toContain('Tentar de novo');
  });

  it('em desenvolvimento os detalhes técnicos vêm recolhidos, abaixo', () => {
    const html = desenhar({
      pacoteNovo: false,
      detalhes: "TypeError: Cannot read properties of undefined (reading 'length')",
      aoTentarDeNovo: nada,
      aoRecarregar: nada,
    });
    expect(html).toContain('<details');
    expect(html).toContain('Cannot read properties of undefined');
    expect(html.indexOf('>Tentar de novo<')).toBeLessThan(html.indexOf('<details'));
  });
});

/* ───────────────────── a tabela de rotas usa a tela ───────────────────── */

const telas = (): RouteObject[] => ROTAS[0].children ?? [];

/**
 * Desenha a tabela com o erro de UMA rota já registrado (`hydrationData`), que
 * é como o roteador de dados guarda o que o `RenderErrorBoundary` receberia.
 * Sem DOM não há fronteira de erro viva; isto prova a ligação (qual elemento
 * aparece no lugar da tela) e o que ele desenha em volta.
 */
function desenharComErroEm(caminho: string, erro: unknown): string {
  const ids = createMemoryRouter(ROTAS);
  const rota = ids.routes[0].children?.find((r) => r.path === caminho) ?? ids.routes.find((r) => r.path === caminho);
  expect(rota?.id, `a rota ${caminho} precisa de id`).toBeTruthy();
  const roteador = createMemoryRouter(ROTAS, {
    initialEntries: [caminho.replace(':token', 'abc')],
    hydrationData: { loaderData: {}, errors: { [rota!.id as string]: erro } },
  });
  const original = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return;
    original(...args);
  };
  try {
    return renderToStaticMarkup(createElement(RouterProvider, { router: roteador }));
  } finally {
    console.error = original;
  }
}

describe('a tabela de rotas', () => {
  it('toda tela, a moldura e a página do cliente têm a tela de erro — nenhuma cai no padrão da biblioteca', () => {
    expect(ROTAS[0].errorElement, 'a moldura').toBeTruthy();
    expect(ROTAS[1].errorElement, '/aprovar/:token').toBeTruthy();
    for (const tela of telas()) expect(tela.errorElement, tela.path).toBeTruthy();
  });

  it('uma tela com sessão que estoura vira a tela amigável, COM a barra lateral', () => {
    const html = desenharComErroEm('/catalogos', new TypeError("Cannot read properties of undefined (reading 'length')"));
    expect(html).toContain('Esta tela não abriu');
    expect(html).toContain('Tentar de novo');
    expect(html).toContain('Recarregar a página');
    expect(html).not.toContain('Unexpected Application Error');
    // A moldura de navegação continua: a pessoa pode ir para outro lugar.
    expect(html).toContain('q-tela');
    expect(html).toContain('bl-barra');
  });

  it('uma rota pública que estoura não monta a barra (ela buscaria dados de quem não tem sessão)', () => {
    const html = desenharComErroEm('/ativar', new TypeError('boom'));
    expect(html).toContain('Esta tela não abriu');
    expect(html).not.toContain('bl-barra');
    expect(html).not.toContain('q-tela');
  });

  it('a página do cliente (fora da moldura) também cai na tela amigável, sem barra', () => {
    const html = desenharComErroEm('/aprovar/:token', new TypeError('boom'));
    expect(html).toContain('Esta tela não abriu');
    expect(html).not.toContain('bl-barra');
  });
});
