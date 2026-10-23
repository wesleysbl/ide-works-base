/**
 * AS ROTAS DEPOIS DO ROTEADOR DE DADOS — etapa F17.AUD03.
 *
 * O QUE ESTES TESTES PROTEGEM
 *   A composição mudou de `<BrowserRouter><Routes>` para `createBrowserRouter`
 *   + `RouterProvider`, para o bloqueio de saída existir. O plano exigiu que
 *   endereços, carregamento sob demanda, aparência, histórico e restauração
 *   de rolagem ficassem iguais. Aqui se prova o que se prova sem navegador:
 *
 *     1. os vinte e três caminhos são os mesmos, na mesma ordem de casamento;
 *     2. a lista de rotas públicas é fechada — três, e o carimbo diz quais;
 *     3. a tabela ABRE num roteador de dados de memória, com a moldura raiz
 *        (tema, rolagem, guarda) em volta — e a ficha da tarefa abre dentro
 *        dela com o X e o `‹ Voltar`;
 *     4. o `history.state` que o roteador de dados escreve tem a forma que o
 *        `Voltar` lê (`idx`), na abertura, na navegação e na RECARGA.
 *
 * ESCRITO EM `createElement`, E NÃO EM JSX
 *   A suíte só inclui `*.test.ts`. Um `.tsx` não seria executado.
 */

import { createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  type RouteObject,
  RouterProvider,
  UNSAFE_createBrowserHistory as criarHistoricoDoNavegador,
  createMemoryRouter,
} from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import Tarefa from '@/pages/Tarefa';
import { CalendarioAntigo } from '@/painel/CalendarioAntigo';
import { ROTAS } from '@/rotas';
import { comoVoltar, temHistoricoNoApp } from '@/ui/volta';

/**
 * As telas, na ordem da tabela — as filhas da moldura. A tabela tem DUAS
 * entradas de topo: a moldura e, desde a F42 (Fase 6), a página do cliente,
 * que fica fora dela de propósito (ver o teste próprio abaixo).
 */
const telas = (): RouteObject[] => {
  expect(ROTAS).toHaveLength(2);
  const [moldura] = ROTAS;
  expect(moldura.path).toBeUndefined();
  expect(moldura.element).toBeTruthy();
  return moldura.children ?? [];
};

/* ────────────────────────── 1. os mesmos endereços ────────────────────────── */

describe('a tabela de rotas', () => {
  it('tem os vinte e seis caminhos, na mesma ordem', () => {
    expect(telas().map((r) => r.path)).toEqual([
      '/',
      '/ativar',
      '/redefinir',
      '/painel',
      '/cliente/:id',
      '/calendario',
      '/planejamento',
      '/controle-da-semana',
      '/quadro',
      '/quadro/espaco/:espacoId',
      '/quadro/pasta/:pastaId',
      '/quadro/:listaId',
      '/meu-trabalho',
      '/tarefas',
      '/avisos',
      '/chat',
      '/chat/:conversationId',
      '/tarefa/:tarefaId',
      '/catalogos',
      '/meta',
      '/meta/ranking',
      '/meta/:id',
      '/contas',
      '/pessoas',
      '/conexoes',
      '*',
    ]);
  });

  /**
   * F43 FASE 4 — O CALENDÁRIO VIROU VISÃO DO PLANEJAMENTO. O caminho fica na
   * tabela, no mesmo lugar (a lista acima não mudou): favoritos, comentários e
   * a barra de quem guardou a preferência continuam chegando. O elemento é o
   * desvio para `/planejamento?visao=calendario` — e não uma tela adiada.
   */
  it('`/calendario` continua na tabela, e o elemento é o desvio para a visão Calendário', () => {
    const rota = telas().find((r) => r.path === '/calendario');
    expect(isValidElement(rota?.element) && rota.element.type).toBe(CalendarioAntigo);
    expect(() => desenharNoRoteadorDeDados(ROTAS, '/calendario?mes=2026-12')).not.toThrow();
  });

  it('toda tela tem elemento, e nenhuma tem filhas — a moldura é a única mãe', () => {
    for (const r of telas()) {
      expect(r.element).toBeTruthy();
      expect(r.children).toBeUndefined();
    }
  });

  /* ─────────────────────── 2. a lista fechada de públicas ─────────────────────── */

  it('só as quatro esperadas são públicas — o mesmo freio de `PUBLIC_ROUTES`', () => {
    const publicas = [...telas(), ...ROTAS.slice(1)]
      .filter((r) => (r.handle as { publica?: boolean } | undefined)?.publica === true)
      .map((r) => r.path)
      .sort();
    expect(publicas).toEqual(['/', '/aprovar/:token', '/ativar', '/redefinir']);
  });

  /**
   * A PÁGINA DO CLIENTE FICA FORA DA MOLDURA — F42, Fase 6. A moldura monta o
   * gerente do chat, que pergunta `/auth/me`; o cliente da agência não tem
   * sessão e a página não pode fazer chamada autenticada nenhuma. O e2e
   * `aprovacao-cliente` confere no navegador que só `/api/public/aprovacao/…`
   * é pedido.
   */
  it('`/aprovar/:token` é irmã da moldura, sem filhas, e pública', () => {
    const [, cliente] = ROTAS;
    expect(cliente.path).toBe('/aprovar/:token');
    expect(cliente.children).toBeUndefined();
    expect(cliente.element).toBeTruthy();
    expect((cliente.handle as { publica?: boolean }).publica).toBe(true);
    // Nenhuma filha da moldura responde por `/aprovar`.
    expect(telas().some((r) => r.path?.startsWith('/aprovar'))).toBe(false);
  });
});

/* ───────────────────── 3. abre num roteador de dados ───────────────────── */

/**
 * ⚠️ O ROTEADOR DE DADOS USA `useLayoutEffect`, e o React avisa disso a cada
 * desenho sem DOM — o `MemoryRouter` das outras telas de teste não usa. Sem
 * DOM não há efeito nenhum, que é exatamente o que este teste quer: só o
 * primeiro quadro. O aviso é engolido AQUI, e só ele; qualquer outro erro de
 * console continua aparecendo.
 */
function desenharNoRoteadorDeDados(rotas: RouteObject[], caminho: string): string {
  const roteador = createMemoryRouter(rotas, { initialEntries: [caminho] });
  const erroOriginal = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return;
    erroOriginal(...args);
  };
  try {
    return renderToStaticMarkup(createElement(RouterProvider, { router: roteador }));
  } finally {
    console.error = erroOriginal;
  }
}

describe('a tabela abre num roteador de dados, com a moldura em volta', () => {
  /**
   * A ENTRADA CONTINUA SENDO A ÚNICA TELA NÃO ADIADA. O que ela desenha no
   * PRIMEIRO quadro é que mudou, em 2026-09-20 (`e0e595d`): antes do
   * formulário ela CONFERE a sessão, para quem já entrou não digitar de novo.
   *
   * Este teste dizia `type="email"` e passou a falhar ali — a asserção
   * envelheceu junto com a frase "desenha o formulário de login". Não era
   * regressão: era o teste descrevendo uma decisão que deixou de valer.
   *
   * ⚠️ AQUI NENHUM EFEITO RODA. `renderToStaticMarkup` não executa
   * `useEffect`, então `checkingSession` fica no valor inicial e o que sai é
   * SEMPRE o estado "verificando". Esperar o formulário neste desenho é
   * esperar o que este renderizador não sabe produzir.
   *
   * O que se prova segue sendo o mesmo de antes: `/` traz conteúdo REAL do
   * módulo da entrada — e não a espera vazia das telas adiadas, que é o
   * teste logo abaixo.
   *
   * O FORMULÁRIO é provado onde o efeito roda, no navegador:
   * `scripts/e2e/entrada-direta.mjs` preenche E-mail e Senha, marca os 30
   * dias e envia. Duplicar aquilo aqui exigiria DOM e `act` — esta suíte
   * inteira desenha no servidor.
   */
  it('a entrada — a única tela que não é adiada — desenha a conferência da sessão', () => {
    const html = desenharNoRoteadorDeDados(ROTAS, '/');
    expect(html).toContain('Verificando sua sessão');
    expect(html).toContain('role="status"');
    // O botão flutuante de tema saiu da moldura em 2026-09-11: no canto de
    // baixo ele cobria texto das telas. A escolha mora na aba `Temas` do
    // `Personalizar a barra lateral`.
    expect(html).not.toContain('class="o-tema"');
  });

  it('as telas adiadas não estouram: sem o pedaço carregado, sai a espera vazia', () => {
    for (const caminho of ['/painel', '/tarefa/x', '/quadro', '/conexoes', '/nao-existe', '/aprovar/abc']) {
      expect(() => desenharNoRoteadorDeDados(ROTAS, caminho)).not.toThrow();
    }
  });

  /**
   * A FICHA DA TAREFA DENTRO DA MOLDURA. A tabela real a adia; aqui ela entra
   * sem adiamento na MESMA moldura, para provar que a tela monta ao lado da
   * guarda (`useBlocker` dentro do roteador de dados) e que o X continua lá —
   * sem navegador não há histórico, então ele cai no lugar acima, que é
   * `/quadro` até a tarefa chegar. O `‹ Voltar` da moldura saiu na F29 (Fase
   * 4): a ficha fica só com o X e com a trilha.
   */
  it('a ficha da tarefa abre dentro da moldura, com o X e sem o `‹ Voltar`', () => {
    const [moldura] = ROTAS;
    const html = desenharNoRoteadorDeDados(
      [{ element: moldura.element, children: [{ path: '/tarefa/:tarefaId', element: createElement(Tarefa) }] }],
      '/tarefa/604ef3c5-a635-45f0-914b-087c47f9eb85',
    );
    expect(html).toContain('aria-label="Fechar tarefa e voltar"');
    expect(html).not.toContain('>Voltar</button>');
    // Sem bloqueio pendente, a janela de saída não existe no primeiro quadro.
    expect(html).not.toContain('Sair sem salvar?');
  });
});

/* ────────────────── 4. o `history.state` que o Voltar lê ────────────────── */

/**
 * Um `window` de mentira com só o que `createBrowserHistory` usa. Ela é a
 * MESMA função que `createBrowserRouter` chama — e a que o `<BrowserRouter>`
 * de antes chamava. O que se captura é o estado que ela escreve no navegador.
 */
function janelaDeMentira(estadoInicial: unknown, caminho = '/tarefa/x') {
  const escritos: unknown[] = [];
  const historico = {
    state: estadoInicial,
    pushState(estado: unknown, _titulo: string, url?: string) {
      historico.state = estado;
      escritos.push(estado);
      if (url) local.pathname = url;
    },
    replaceState(estado: unknown) {
      historico.state = estado;
      escritos.push(estado);
    },
    go() {},
  };
  const local = { pathname: caminho, search: '', hash: '', origin: 'http://ide.local' };
  const janela = {
    history: historico,
    location: local,
    addEventListener() {},
    removeEventListener() {},
  };
  return { janela: janela as unknown as Window, historico, escritos };
}

describe('o histórico do roteador de dados tem a forma que o Voltar lê', () => {
  it('na abertura por link direto, o índice é zero: não há passo nosso atrás', () => {
    const { janela, historico } = janelaDeMentira(null);
    criarHistoricoDoNavegador({ window: janela });
    expect(historico.state).toMatchObject({ idx: 0 });
    expect(temHistoricoNoApp(historico.state)).toBe(false);
    expect(comoVoltar('/tarefa/x', historico.state, '/quadro')).toEqual({ modo: 'lugar', para: '/quadro' });
  });

  it('depois de uma navegação interna, o índice cresce e o Voltar vira histórico', () => {
    const { janela, historico } = janelaDeMentira(null, '/quadro');
    const h = criarHistoricoDoNavegador({ window: janela });
    h.push('/tarefa/x');
    expect(historico.state).toMatchObject({ idx: 1 });
    expect(Object.keys(historico.state as object).sort()).toEqual(['idx', 'key', 'masked', 'usr']);
    expect(comoVoltar('/tarefa/x', historico.state, '/quadro')).toEqual({ modo: 'historico' });
  });

  it('na RECARGA, o índice que o navegador guardou é respeitado — o Voltar sobrevive ao F5', () => {
    const { janela, historico, escritos } = janelaDeMentira({ usr: null, key: 'abc', idx: 3 });
    criarHistoricoDoNavegador({ window: janela });
    expect(escritos).toEqual([]);
    expect(historico.state).toMatchObject({ idx: 3 });
    expect(comoVoltar('/tarefa/x', historico.state, '/quadro')).toEqual({ modo: 'historico' });
  });

  it('trocar de aba com `replace` não cria passo: o índice fica', () => {
    const { janela, historico } = janelaDeMentira({ usr: null, key: 'abc', idx: 0 }, '/tarefas');
    const h = criarHistoricoDoNavegador({ window: janela });
    h.replace('/tarefas?aba=feito');
    expect(historico.state).toMatchObject({ idx: 0 });
    expect(temHistoricoNoApp(historico.state)).toBe(false);
  });
});
