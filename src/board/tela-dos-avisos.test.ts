/**
 * A CAIXA DE ENTRADA ABRE, E LEVA ATÉ A TAREFA — F17.46.
 *
 * SEM NAVEGADOR, E POR ISSO SEM `useEffect`
 *   `renderToStaticMarkup` monta a árvore e não roda efeito: o que se prova
 *   aqui da PÁGINA é o primeiro quadro. A lista é um componente próprio
 *   justamente por isso — ela recebe os avisos por propriedade, e o teste
 *   desenha o que a pessoa vai ler. O caminho com dado real é
 *   `scripts/provar-avisos.mjs`.
 *
 * ESCRITO EM `createElement`, E NÃO EM JSX
 *   A suíte só inclui `*.test.ts`. Um `.tsx` não seria executado — e um teste
 *   que não roda é pior que teste nenhum, porque conta como cobertura.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { Aviso } from '@/board/avisos';
import { ListaDeAvisos } from '@/board/ListaDeAvisos';
import type { Day } from '@/board/board';
import CaixaDeEntrada from '@/pages/CaixaDeEntrada';

const HOJE: Day = { year: 2026, month: 8, day: 31 };

const CHEGOU: Aviso = {
  key: 'automation:41',
  tipo: 'automacao',
  taskId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  taskTitle: 'Post de setembro',
  listName: 'ATENDIMENTO',
  clientName: 'Sabor Doce',
  occurredAt: '2026-08-31T12:00:00.000Z',
  dueOn: null,
  automationName: 'Passa para o atendimento',
  fromListName: 'Sabor Doce',
  toListName: 'ATENDIMENTO',
  toStatusName: 'na fila',
  seen: false,
};

const VENCE: Aviso = {
  ...CHEGOU,
  key: 'due:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:2026-08-31',
  tipo: 'prazo',
  taskTitle: 'Relatório de agosto',
  occurredAt: null,
  dueOn: '2026-08-31',
  automationName: null,
  fromListName: null,
  toListName: null,
  toStatusName: null,
};

const desenharPagina = (caminho = '/avisos'): string =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [caminho] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: '/avisos', element: createElement(CaixaDeEntrada) }),
      ),
    ),
  );

const desenharLista = (avisos: Aviso[]): string =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(ListaDeAvisos, { avisos, hoje: HOJE, aoMarcar: () => {} }),
    ),
  );

/* ───────────────────────────── ela monta ───────────────────────────── */

describe('a tela', () => {
  it('monta sem estourar', () => {
    expect(() => desenharPagina()).not.toThrow();
  });

  it('o título diz que esta tela é a caixa, e não `Meu trabalho`', () => {
    const html = desenharPagina();
    expect(html).toMatch(
      /<h1[^>]*class="[^"]*o-titulo[^"]*"[^>]*>[\s\S]*?Notificações[\s\S]*?<\/h1>/,
    );
    expect(html).not.toMatch(/<h1[^>]*>[\s\S]*?Meu trabalho[\s\S]*?<\/h1>/);
  });

  it('ela tem as duas vistas, e `Novos` é a que abre', () => {
    const html = desenharPagina();
    expect(html).toContain('Novos');
    expect(html).toContain('Já vistos');
    // A vista mora no endereço (F17.24): `?ver=vistos` abre na outra.
    expect(desenharPagina('/avisos?ver=vistos')).toContain('Já vistos');
  });

  it('a barra lateral leva à caixa — o item deixou de ser botão morto', () => {
    // Até a F17.45, `Caixa de entrada` estava na lista de seções proibidas de
    // `tela-do-trabalho.test.ts`, porque não havia tela. Agora há, e o item
    // aponta para ela.
    expect(desenharPagina()).toMatch(/<a[^>]*href="\/avisos"/);
  });
});

/* ───────────────────────────── a lista ───────────────────────────── */

describe('cada aviso diz o que é, e leva até a tarefa', () => {
  const html = desenharLista([CHEGOU, VENCE]);

  it('⚠️ o título é um LINK para a tarefa — é metade da etapa', () => {
    // Um aviso que diz "isto chegou para você" e não leva até lá obriga a
    // pessoa a caçar a tarefa no quadro, que é o trabalho que ele veio poupar.
    expect(html).toMatch(
      new RegExp(`<a[^>]*href="/tarefa/${CHEGOU.taskId}"[^>]*>[^<]*Post de setembro`),
    );
  });

  it('a frase explica por que o aviso apareceu', () => {
    expect(html).toContain('passou esta tarefa para você');
    expect(html).toContain('Vence hoje');
  });

  it('os dois grupos aparecem, com a contagem ao lado do nome', () => {
    expect(html).toContain('Chegou para você');
    expect(html).toContain('Prazo virando');
  });

  it('o prazo pinta a linha, e não a letra — a régua da F17.37', () => {
    expect(html).toMatch(/data-aperto="hoje"/);
  });

  it('marcar é um clique, e a volta também', () => {
    expect(html).toContain('Marcar como visto');
    expect(desenharLista([{ ...CHEGOU, seen: true }])).toContain('Trazer de volta');
  });

  it('o que já foi visto sai marcado no desenho, e não some da aba dos vistos', () => {
    expect(desenharLista([{ ...CHEGOU, seen: true }])).toMatch(/data-visto="true"/);
  });

  it('a caixa vazia é um ESTADO (F10), curto, e não um parágrafo sobre si mesma', () => {
    const vazia = desenharLista([]);
    expect(vazia).toContain('Nada novo.');
    expect(vazia).toContain('data-estado="vazio"');
    // Vazio é conteúdo da página, não alarme: sem role=alert.
    expect(vazia).not.toContain('role="alert"');
  });
});

/* ───────────────────────────── a D10 no HTML ───────────────────────────── */

describe('A D10 NA TELA: nenhuma cor literal do Tailwind no que ela desenha', () => {
  const PALETA_DO_TAILWIND =
    /\b(?:bg|text|border|from|to|via|fill|stroke|ring|divide|shadow|outline|decoration|accent|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;

  it('a página', () => {
    expect(desenharPagina()).not.toMatch(PALETA_DO_TAILWIND);
  });

  it('a lista, com os dois tipos de aviso', () => {
    expect(desenharLista([CHEGOU, VENCE])).not.toMatch(PALETA_DO_TAILWIND);
  });
});


describe('atribuição manual', () => {
  it('mostra a frase solicitada, o link do post e a ação de leitura', () => {
    const html = desenharLista([{ ...CHEGOU, tipo: 'atribuicao', key: 'assignment:42' }]);
    expect(html).toContain('Você foi adicionado como responsável por este post.');
    expect(html).toContain(`/tarefa/${CHEGOU.taskId}`);
    expect(html).toContain('Marcar como visto');
    expect(html).not.toContain('Uma automação');
  });
});


/* ─────────────── F42, Fase 7 — o cliente respondeu, desenhado ─────────────── */

describe('a resposta do cliente na caixa', () => {
  const PEDIU: Aviso = {
    ...CHEGOU,
    key: 'approval:rodada-1',
    tipo: 'aprovacao',
    automationName: null,
    fromListName: null,
    toListName: null,
    toStatusName: null,
    commentId: 'motivo-1',
    approvalDecision: 'rejected',
    approvalVersion: 1,
  };

  it('pediu ajustes: grupo "O cliente respondeu", a frase, o link para o motivo e o botão de visto', () => {
    const html = desenharLista([PEDIU]);
    expect(html).toContain('O cliente respondeu');
    expect(html).toContain('Cliente pediu ajustes na versão 1 pelo link.');
    expect(html).toContain(`/tarefa/${CHEGOU.taskId}#comentario-motivo-1`);
    expect(html).toContain('Ver o que o cliente escreveu');
    expect(html).toContain('Marcar como visto');
    expect(html).toContain('data-aviso="approval:rodada-1"');
  });

  it('aprovou sem comentário: leva ao card', () => {
    const html = desenharLista([{ ...PEDIU, approvalDecision: 'approved', commentId: null }]);
    expect(html).toContain('Cliente aprovou a versão 1 pelo link.');
    expect(html).toContain('>Abrir card</a>');
    expect(html).not.toContain('#comentario-');
  });
});

/* ─────────────────────── o aviso de agente, desenhado ─────────────────── */

/**
 * F21.3 — A LINHA DO AGENTE NA CAIXA.
 *
 * O que as frases dizem já tem prova em `avisos.test.ts`. O que falta provar é
 * que a caixa DESENHA essa linha como desenha as outras: cabeçalho próprio,
 * título que leva à tarefa, o mesmo botão de visto — e o caminho de volta a um
 * clique, que é a metade da etapa.
 */
describe('escrita de agente na caixa', () => {
  const DO_AGENTE: Aviso = {
    ...CHEGOU,
    key: 'agent:move:11111111-2222-3333-4444-555555555555',
    tipo: 'agente',
    automationName: null,
    fromListName: null,
    toListName: null,
    toStatusName: null,
    agentEvent: 'move',
    agentName: 'Claude do atendimento',
    dailyLimit: 50,
  };

  it('tem cabeçalho próprio, frase sem vocabulário técnico e o caminho de volta', () => {
    const html = desenharLista([DO_AGENTE]);
    expect(html).toContain('Um agente de IA escreveu por você');
    expect(html).toContain('Claude do atendimento');
    expect(html).toContain('/conexoes');
    expect(html).toContain(`/tarefa/${CHEGOU.taskId}`);
    expect(html).not.toMatch(/MCP|concess|ledger/i);
  });

  it('marca como visto igual aos avisos que já existiam', () => {
    expect(desenharLista([DO_AGENTE])).toContain('Marcar como visto');
    expect(desenharLista([{ ...DO_AGENTE, seen: true }])).toContain('Trazer de volta');
    expect(desenharLista([{ ...DO_AGENTE, seen: true }])).toMatch(/data-visto="true"/);
  });

  it('a estreia que bate o teto no mesmo dia desenha DUAS linhas, com dois botões', () => {
    const estreia = { ...DO_AGENTE, key: 'agent:first:exec-1', agentEvent: 'first' as const };
    const teto = { ...DO_AGENTE, key: 'agent:limit:exec-1', agentEvent: 'limit' as const };
    const html = desenharLista([estreia, teto]);
    expect(html.match(/class="av-linha"/g)).toHaveLength(2);
    expect(html).toContain('pela primeira vez');
    expect(html).toContain('50 escritas permitidas por dia');
  });

  it('não traz cor literal do Tailwind', () => {
    expect(desenharLista([DO_AGENTE])).not.toMatch(
      /\b(?:bg|text|border)-(?:slate|gray|red|amber|blue)-\d{2,3}\b/,
    );
  });
});


/**
 * F21.3 — O AVISO DE AGENTE, DESENHADO.
 *
 * O que se mede aqui é a PROMESSA DO RÓTULO: um atalho só pode dizer o que ele
 * de fato abre. E o caminho de volta — a tela de conexões — precisa estar
 * clicável, e não só descrito na frase.
 */
describe('o aviso de agente na lista', () => {
  const AGENTE: Aviso = {
    ...CHEGOU,
    key: 'agent:move:11111111-2222-3333-4444-555555555555',
    tipo: 'agente',
    taskTitle: 'Card do cliente',
    automationName: null,
    fromListName: null,
    toListName: null,
    toStatusName: null,
    agentEvent: 'move',
    agentName: 'Claude do atendimento',
    dailyLimit: 50,
    commentId: null,
  };

  it('movimento de card não promete um comentário que não existe', () => {
    const html = desenharLista([AGENTE]);
    expect(html).toContain('Ver a tarefa');
    expect(html).not.toContain('Ver o que ele escreveu');
  });

  it('escrita de comentário leva ao comentário, e o rótulo diz isso', () => {
    const html = desenharLista([
      { ...AGENTE, key: 'agent:first:c1', agentEvent: 'first', commentId: 'c0ffee00-0000-4000-8000-000000000000' },
    ]);
    expect(html).toContain('Ver o que ele escreveu');
    expect(html).toContain('#comentario-c0ffee00-0000-4000-8000-000000000000');
  });

  it('o caminho de desfazer é clicável, e não só uma frase', () => {
    const html = desenharLista([AGENTE]);
    expect(html).toMatch(/<a[^>]*href="\/conexoes"/);
    expect(html).toContain('Agentes de IA');
    // E a frase nomeia a conexão que agiu, para a pessoa saber qual é.
    expect(html).toContain('Claude do atendimento');
  });
});

/**
 * F26.6 — ESCRITA DO AGENTE NO MURAL OU NO HISTÓRICO.
 *
 * Não há tarefa: o título e o atalho levam ao CLIENTE, e o rótulo promete o
 * que o link abre (a página do cliente), não uma tarefa que não existe.
 */
describe('o aviso de agente com alvo no cliente', () => {
  const NA_NOTA: Aviso = {
    ...CHEGOU,
    key: 'agent:first:77777777-2222-3333-4444-555555555555',
    tipo: 'agente',
    taskId: '',
    taskTitle: 'Reunião de pauta',
    listName: 'Mural',
    clientName: 'Clinimax',
    clientId: '99999999-8888-4777-8666-555555555555',
    targetKind: 'mural_note',
    automationName: null,
    fromListName: null,
    toListName: null,
    toStatusName: null,
    agentEvent: 'first',
    agentName: 'Claude',
    dailyLimit: 50,
    commentId: null,
  };

  it('o título e o atalho levam ao cliente, e nenhum link vai para /tarefa/', () => {
    const html = desenharLista([NA_NOTA]);
    expect(html).toMatch(/<a class="av-titulo"[^>]*href="\/cliente\/99999999-8888-4777-8666-555555555555"/);
    expect(html).toContain('Abrir o cliente');
    expect(html).not.toContain('/tarefa/');
    expect(html).not.toContain('Ver a tarefa');
    expect(html).toContain('pela primeira vez no mural de Clinimax');
    expect(html).toContain('Clinimax · Mural');
    expect(html).toMatch(/<a[^>]*href="\/conexoes"/);
  });

  it('no histórico, idem', () => {
    const html = desenharLista([
      { ...NA_NOTA, key: 'agent:limit:x', agentEvent: 'limit', targetKind: 'history_entry', listName: 'Histórico' },
    ]);
    expect(html).toContain('/cliente/99999999-8888-4777-8666-555555555555');
    expect(html).toContain('Clinimax · Histórico');
    expect(html).toContain('50 escritas permitidas por dia');
    expect(html).not.toContain('/tarefa/');
  });
});

/* ─────────────────────── menção no chat — F20.8 ─────────────────────── */

describe('menção no chat na caixa', () => {
  const DO_CHAT: Aviso = {
    ...CHEGOU,
    key: 'chat_mention:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    tipo: 'mencao_chat',
    taskId: '',
    taskTitle: 'Geral',
    listName: 'Geral',
    clientName: null,
    conversationId: 'cccccccc-0000-4000-8000-000000000001',
    messageId: 'mmmmmmmm-0000-4000-8000-000000000002',
    actorName: 'Alice',
    automationName: null,
    fromListName: null,
    toListName: null,
    toStatusName: null,
  };

  it('tem cabeçalho próprio, frase e link para a mensagem destacada', () => {
    const html = desenharLista([DO_CHAT]);
    expect(html).toContain('Mencionaram você no chat');
    expect(html).toContain('Alice mencionou você no chat.');
    expect(html).toContain('/chat/cccccccc-0000-4000-8000-000000000001#chat-msg-mmmmmmmm-0000-4000-8000-000000000002');
    expect(html).toContain('Abrir conversa');
    expect(html).toContain('Marcar como visto');
  });

  it('marcar como visto e trazer de volta iguais aos demais', () => {
    expect(desenharLista([{ ...DO_CHAT, seen: true }])).toContain('Trazer de volta');
    expect(desenharLista([{ ...DO_CHAT, seen: true }])).toMatch(/data-visto="true"/);
  });
});

/* ─────────────────────── F10 do plano UX ─────────────────────── */

describe('F10 — evento, origem, quando e destino, sem cliques ambíguos', () => {
  const AGORA = new Date('2026-08-31T18:00:00.000Z');
  const desenhar = (avisos: Aviso[], ocupado: string | ReadonlySet<string> | null = null) =>
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(ListaDeAvisos, { avisos, hoje: HOJE, aoMarcar: () => {}, agora: AGORA, ocupado }),
      ),
    );

  it('o botão de marcar NÃO mora dentro do link, e o link não mora dentro do botão', () => {
    const html = desenhar([CHEGOU]);
    // Nenhum <button> entre um <a ...> e o seu </a>, e nenhum <a> dentro de <button>.
    expect(html).not.toMatch(/<a [^>]*>(?:(?!<\/a>).)*<button/s);
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*<a /s);
    // A linha não é um link nem tem onClick de navegação: é um <li> comum.
    expect(html).toMatch(/<li class="av-linha"/);
  });

  it('o botão diz DE QUAL aviso é (aria-describedby aponta o título)', () => {
    const html = desenhar([CHEGOU]);
    const id = /<a class="av-titulo" id="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`aria-describedby="${id}"`);
  });

  it('cada linha diz quando, em São Paulo, com o instante completo no title', () => {
    const html = desenhar([CHEGOU]);
    expect(html).toMatch(/<time class="av-quando[^"]*" dateTime="2026-08-31T12:00:00.000Z" title="31\/08\/2026 às 09:00">Hoje, 09:00<\/time>/);
  });

  it('o aviso de prazo não repete o tempo: a frase já é o tempo', () => {
    expect(desenhar([VENCE])).not.toContain('<time');
  });

  it('a origem aparece, e no chat não repete o nome da conversa', () => {
    expect(desenhar([CHEGOU])).toContain('<p class="av-origem">Sabor Doce · ATENDIMENTO</p>');
    const doChat: Aviso = {
      ...CHEGOU, key: 'chat_mention:x', tipo: 'mencao_chat', taskId: '', taskTitle: 'Geral', listName: 'Geral',
      clientName: null, conversationId: 'c1', messageId: 'm1', actorName: 'Alice',
    };
    expect(desenhar([doChat])).not.toContain('av-origem');
  });

  it('só a linha em gravação fica desabilitada (várias podem estar em voo)', () => {
    const outro = { ...CHEGOU, key: 'automation:42', taskTitle: 'Outro' };
    const html = desenhar([CHEGOU, outro], new Set(['automation:42']));
    expect(html.match(/<button[^>]*disabled=""/g)?.length).toBe(1);
    expect(html).toMatch(/data-aviso="automation:42"[\s\S]*?<button[^>]*disabled=""/);
  });

  it('novo leva o ponto; visto, o anel (o atributo que o CSS lê)', () => {
    expect(desenhar([CHEGOU])).toMatch(/data-visto="false"[^>]*>\s*<span class="av-ponto"/);
    expect(desenhar([{ ...CHEGOU, seen: true }])).toMatch(/data-visto="true"/);
  });
});

describe('F10 — a página antes da primeira leitura', () => {
  it('carrega sem mostrar zero nem vazio como se já soubesse', () => {
    const html = desenharPagina();
    expect(html).toContain('data-estado="carregando"');
    expect(html).not.toContain('Nada novo.');
    // A aba Novos não leva contagem antes de saber o número.
    expect(html).not.toContain('iw-segmento-conta');
  });
});
