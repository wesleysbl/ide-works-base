/**
 * AS DUAS TELAS DA PESSOA ABREM, E NÃO PROMETEM O QUE NÃO EXISTE — F17.18.
 *
 * POR QUE ESTE TESTE EXISTE
 *   Typecheck não pega import circular, componente indefinido nem gancho fora
 *   de ordem. Então as páginas são MONTADAS de verdade, e o que elas desenham é
 *   conferido.
 *
 * SEM NAVEGADOR, E POR ISSO SEM `useEffect`
 *   A suíte roda em ambiente `node`, sem DOM (e com o isolamento de rede da
 *   F0.4 ligado, que recusaria a chamada de qualquer jeito).
 *   `renderToStaticMarkup` monta a árvore e não roda efeito — então o que se
 *   prova aqui é o PRIMEIRO quadro. O resto do caminho, com o dado real, é
 *   `scripts/provar-meu-trabalho.mjs`.
 *
 * ⚠️ A REDE CONTRA BOTÃO MORTO É O TESTE DO MEIO
 *   A referência do ClickUp tem dezesseis seções que dependem de etapas que não
 *   existem. Botão morto é pior que botão ausente — é regra do projeto —, e uma
 *   lista escrita num comentário se perde. Aqui ela é executável: se qualquer
 *   um desses nomes aparecer no HTML da barra ou do painel, este arquivo falha.
 *
 * ESCRITO EM `createElement`, E NÃO EM JSX
 *   A suíte só inclui `*.test.ts`. Um `.tsx` não seria executado — e um teste
 *   que não roda é pior que teste nenhum, porque conta como cobertura.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { BarraDeFiltro } from '@/board/BarraDeFiltro';
import { ColunaVazia, CorpoDoCartao } from '@/board/CartaoDeTarefa';
import { LinhaDeTrabalho } from '@/board/LinhaDeTrabalho';
import { lerPrazo } from '@/board/prazo';
import { QuadroPorTipo } from '@/board/QuadroPorTipo';
import { ContagemDoQuadro, DescricaoDaLista, SobreAEsteira } from '@/board/CabecalhoDaLista';
import { DESCRICAO_CURTA, descricaoLonga } from '@/board/cabecalho-da-lista';
import { SEM_FILTRO } from '@/board/filtro';
import { GruposDeTrabalho } from '@/board/GruposDeTrabalho';
import type { WorkRow } from '@/board/meu-trabalho';
import { Personalizar } from '@/board/Personalizar';
import { ehAtalhoDeRecolher, preferenciasParaRevelar } from '@/board/secao-recolhivel';
import { definirModoDoChat, modoDoChat } from '@/chat/chave';
import MeuTrabalho from '@/pages/MeuTrabalho';
import TodasAsTarefas from '@/pages/TodasAsTarefas';
import { CHAVE, PADRAO, type Preferencias, escreverPreferencias } from '@/ui/preferencias';
import { Topo } from '@/ui/Topo';

function desenhar(caminho: string): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [caminho] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: '/meu-trabalho', element: createElement(MeuTrabalho) }),
        createElement(Route, { path: '/tarefas', element: createElement(TodasAsTarefas) }),
      ),
    ),
  );
}

/** O painel não abre sozinho — ele é montado direto, com o padrão de fábrica. */
const desenharPainel = (): string =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(Personalizar, {
        preferencias: PADRAO,
        aoMudar: () => {},
        aoFechar: () => {},
      }),
    ),
  );

/* ───────────────────────────── elas montam ───────────────────────────── */

describe('as duas telas montam', () => {
  it('`Meu trabalho` monta sem estourar', () => {
    expect(() => desenhar('/meu-trabalho')).not.toThrow();
  });

  it('`Todas as tarefas` monta sem estourar', () => {
    expect(() => desenhar('/tarefas')).not.toThrow();
  });

  it('o painel `Personalizar` monta sem estourar', () => {
    expect(() => desenharPainel()).not.toThrow();
  });
});

/* ───────────────────────────── os quatro grupos ───────────────────────────── */

/*
  ELES SÃO DESENHADOS PELO COMPONENTE, E NÃO PELA PÁGINA — e é por isso que
  este teste consegue prová-los. A página só monta os grupos depois de a
  resposta chegar, e `renderToStaticMarkup` não roda efeito: o primeiro quadro
  dela diz "Carregando o seu trabalho…", e nada mais.

  `GruposDeTrabalho` recebe as linhas prontas, então aqui elas são de mentira e
  a ordem, as contagens e as frases de vazio ficam à vista.
*/
const desenharGrupos = (linhas: WorkRow[] = []): string =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(GruposDeTrabalho, { linhas, hoje: { year: 2026, month: 8, day: 26 } }),
    ),
  );

/** Uma linha de referência. A F17.25 a tirou de dentro de um caso para dois
 *  poderem usá-la — o da trilha e o da lista arquivada. */
const UMA_LINHA: WorkRow = {
  id: 'a1b2',
  title: 'Gravar depoimento',
  statusId: 's1',
  priority: null,
  dueOn: '2026-08-26',
  startOn: null,
  completedAt: null,
  hasDescription: false,
  hasAttachment: false,
  clientId: null,
  clientName: null,
  assignees: [],
  tags: [],
  taskTypeName: null,
  parentId: null,
  parentTitle: null,
  subtaskCount: 0,
  checklistDone: 0,
  checklistTotal: 0,
  commentCount: 0,
  // A arte no cartão — F17.56. Ela nasce ausente: das 1.797 tarefas reais,
  // 16 têm anexo de imagem, e o cartão sem arte é o caso comum.
  previewAttachmentId: null,
  previewCount: 0,
  categoryName: 'Alma9',
  spaceName: 'ALMA 9',
  folderName: 'FOCUS Ibitinga',
  listId: 'l1',
  listName: 'FOCUS (Vídeos)',
  listLive: true,
  statusName: 'a fazer',
  statusType: 'open',
  statusColor: '#d3d3d3',
  assignedToMe: true,
  createdByMe: false,
  otherAssignees: 0,
};

describe('os quatro grupos', () => {
  const html = desenharGrupos();

  it('saem na ordem da referência: Hoje · Em atraso · Próximo · Não programado', () => {
    const posicao = (t: string) => html.indexOf(t);
    expect(posicao('Hoje')).toBeGreaterThan(-1);
    expect(posicao('Em atraso')).toBeGreaterThan(-1);
    expect(posicao('Próximo')).toBeGreaterThan(-1);
    expect(posicao('Não programado')).toBeGreaterThan(-1);
    expect(posicao('Hoje')).toBeLessThan(posicao('Em atraso'));
    expect(posicao('Em atraso')).toBeLessThan(posicao('Próximo'));
    expect(posicao('Próximo')).toBeLessThan(posicao('Não programado'));
  });

  it('cada um traz contagem e seta de recolher', () => {
    expect(html).toContain('mt-conta');
    expect(html).toContain('aria-expanded="true"');
  });

  it('o grupo vazio traz a frase honesta, e não cita lembrete', () => {
    // O ClickUp escreve "Sem tarefas atrasadas ou lembretes agendados".
    // Lembrete não existe no modelo, então a frase não o cita.
    //
    // ⚠️ A FRASE ENCURTOU NA F17.20 — era "Sem tarefas atrasadas.", virou
    // "Nada em atraso.". O que este teste guarda não é o comprimento dela: é
    // que o grupo vazio DIZ alguma coisa (e não fica mudo, virando "não
    // carregou") e que essa coisa não promete lembrete, que o modelo não tem.
    expect(html).toContain('Nada em atraso');
    expect(html).not.toContain('lembrete');
  });

  it('a linha traz a trilha `espaço › lista` e a etiqueta de prazo', () => {
    const com = desenharGrupos([UMA_LINHA]);
    expect(com).toContain('Gravar depoimento');
    // F31: a empresa saiu da trilha ("será apenas Ide", Wesley, 25/09). Ela
    // continua na linha que chega do servidor; só não é escrita.
    expect(com).toContain('ALMA 9');
    expect(com).not.toContain('Alma9');
    expect(com).toContain('FOCUS (Vídeos)');
    expect(com).toContain('Hoje');
    expect(com).toContain('href="/tarefa/a1b2"');
    // A cor do status é DADO, e entra como variável — nunca como classe (D10).
    expect(com).toContain('--cor-status:#d3d3d3');

    /* F17.25 — a trilha da linha virou a MESMA peça das outras telas.
       O separador é um só (`›`, era ` / `), e a LISTA passou a clicar: de
       `Minhas tarefas` dá para ir ao quadro de onde a tarefa mora sem abrir a
       tarefa antes. */
    expect(com).toContain('href="/quadro/l1"');
    expect(com).toContain('›');
    expect(com).toContain('data-compacta="true"');
  });

  it('LISTA ARQUIVADA não vira link — ela mandaria para outra lista', () => {
    // A regra de abertura da F17.24 troca a lista morta pela primeira viva, e
    // um degrau que leva a um lugar diferente do que diz é pior que um degrau
    // que não clica. O selo `· arquivada` continua explicando o porquê.
    const com = desenharGrupos([
      {
        ...UMA_LINHA,
        listLive: false,
      },
    ]);
    expect(com).not.toContain('href="/quadro/l1"');
    expect(com).toContain('arquivada');
  });
});

describe('`Meu trabalho` desenha as três abas', () => {
  const html = desenhar('/meu-trabalho');

  it('as três abas', () => {
    expect(html).toContain('Pendente');
    expect(html).toContain('Feito');
    expect(html).toContain('Delegado');
  });

  it('O TOPO VEM ANTES DAS ABAS, e diz onde se está — F17.25 → F29', () => {
    /*
      O pedido da F17.25 foi literal: *"no topo das abas (…) deve ter a trilha
      de onde foi clicado para acessar cada parte"*. A trilha daqui era `Meu
      trabalho › Minhas tarefas` — e nenhum dos dois degraus levava a lugar
      nenhum (seção não é lugar, e o segundo era onde já se estava).

      A F29 (Fase 4) trocou-a pelo topo único: tela principal mostra só o
      título, o nome do item da barra. O que o teste guarda é o mesmo — acima
      das abas, a tela diz onde se está.

      ⚠️ `Minhas tarefas` também está na barra lateral: procurá-la solta
      passaria com o topo apagado. A âncora é o `<h1>` do topo, e a POSIÇÃO
      dele é conferida contra a faixa de abas.
    */
    expect(html).toMatch(/<h1 class="o-titulo[^"]*">Minhas tarefas<\/h1>/);
    // F03: o seletor de forma é `iw-segmentos` (botões pressionáveis).
    expect(html.indexOf('o-topo')).toBeLessThan(html.indexOf('iw-segmentos'));
    expect(html).not.toContain('tr-trilha');
    expect(html).not.toContain('>Voltar</button>');
  });

  it('F29 (Fase 5a): o PRIMEIRO item focável é "Pular para o conteúdo", e ele leva ao topo', () => {
    /*
      Sem o Voltar, a primeira saída do topo ficou a ~250 Tabs — a barra, com a
      árvore, vem antes da coluna de conteúdo no HTML. O link mora na barra
      (`BarraLateral`), então vale para toda tela que a desenha; esta é uma.
    */
    const primeiro = /<(a|button|input|select|textarea)\b[^>]*>/.exec(html)?.[0] ?? '';
    expect(primeiro).toMatch(/^<a href="#conteudo" class="bl-pular">$/);
    expect(html).toMatch(/<a href="#conteudo" class="bl-pular">Pular para o conteúdo<\/a>/);
    // E o alvo existe, e é o topo: um `id` só na página.
    expect(html.match(/id="conteudo"/g)).toHaveLength(1);
    expect(html).toMatch(/<header class="o-topo[^"]*" id="conteudo" tabindex="-1">/);
  });

  it('a barra lateral traz as três seções e o chip da conta no pé', () => {
    expect(html).toContain('Meu trabalho');
    expect(html).toContain('Compartilhado comigo');
    expect(html).toContain('Entrega');
    // F29: `Personalizar a barra lateral` saiu do pé para o menu do chip. O
    // chip é a trava que o botão era, e ele vem DEPOIS da última seção.
    const barra = html.slice(html.indexOf('id="barra-lateral"'));
    expect(barra).toContain('class="bl-conta"');
    expect(barra.indexOf('class="bl-conta"')).toBeGreaterThan(
      barra.indexOf('Compartilhado comigo'),
    );
  });

  it('os itens da barra levam a rotas que existem', () => {
    // F43 Fase 4: o Calendário é a visão Calendário do Planejamento — o item
    // vai direto a ela, sem o desvio de `/calendario`.
    for (const rota of ['/meu-trabalho', '/tarefas', '/quadro', '/painel', '/planejamento?visao=calendario', '/planejamento']) {
      expect(html).toContain(`href="${rota}"`);
    }
  });

  /*
    F28: A ENTREGA VEM ANTES DA ÁRVORE, E O TOPO DEIXOU DE SER A MARCA.
    A árvore é a única seção que cresce; no meio, ela empurrava Painel,
    Calendário e Planejamento para debaixo da dobra. A ordem no HTML é a ordem
    na coluna — a altura que cada uma ganha só o navegador prova.
  */
  const barra = html.slice(html.indexOf('id="barra-lateral"'));

  it('F28: sem nada guardado, a barra desenha Meu trabalho → Entrega → Compartilhado comigo', () => {
    const posicoes = [
      barra.indexOf('aria-label="Meu trabalho"'),
      barra.indexOf('aria-label="Entrega"'),
      barra.indexOf('Compartilhado comigo'),
    ];
    expect(posicoes.every((p) => p >= 0)).toBe(true);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
  });

  it('F28: o topo é o item `Início`, leva à tela inicial e diz para onde', () => {
    // A garantia que a marca carregava — o topo leva à tela escolhida na aba
    // `Início` do painel — continua. O padrão de fábrica é `Minhas tarefas`.
    const topo = /<a class="bl-item bl-inicio"[^>]*>[\s\S]*?<\/a>/.exec(barra)?.[0] ?? '';
    expect(topo).toContain('href="/meu-trabalho"');
    expect(topo).toContain('title="Início — abre em Minhas tarefas"');
    expect(topo).toContain('>Início</span>');
    // E é a PRIMEIRA peça da barra, antes de qualquer seção.
    expect(barra.indexOf('bl-inicio')).toBeLessThan(barra.indexOf('bl-secao'));
  });

  it('F28: a marca "ide Trabalho" saiu da barra — ela mora no cabeçalho da página', () => {
    expect(barra).not.toContain('bl-marca');
    expect(barra).not.toMatch(/>ide<\/span>\s*<span>Trabalho</);
  });
});

describe('F28: em `Somente ícones`, o `Início` fica só com a casa e o nome acessível', () => {
  /*
    A preferência mora no navegador, e a suíte roda sem ele. Então o
    `localStorage` é emprestado só durante este desenho — o mesmo recurso de
    `src/ui/rascunho.test.ts` —, com a aparência `icones` e a tela inicial
    `Quadro`, para provar também que o destino acompanha a escolha.
  */
  const desenharComIcones = (): string => {
    const guardado = escreverPreferencias({ ...PADRAO, aparencia: 'icones', telaInicial: 'quadro' });
    vi.stubGlobal('window', {
      localStorage: { getItem: (k: string) => (k === CHAVE ? guardado : null) },
    });
    try {
      return desenhar('/meu-trabalho');
    } finally {
      vi.unstubAllGlobals();
    }
  };
  const barra = (() => {
    const html = desenharComIcones();
    return html.slice(html.indexOf('id="barra-lateral"'));
  })();
  const topo = /<a class="bl-item bl-inicio"[^>]*>[\s\S]*?<\/a>/.exec(barra)?.[0] ?? '';

  it('a barra está mesmo em `Somente ícones` — senão o resto não prova nada', () => {
    expect(barra).toContain('data-aparencia="icones"');
  });

  it('sem o nome no desenho, mas com ele no `aria-label` e no `title`', () => {
    expect(topo).not.toContain('>Início</span>');
    expect(topo).toContain('aria-label="Início — abre em Quadro"');
    expect(topo).toContain('title="Início — abre em Quadro"');
    expect(topo).toContain('<svg');
  });

  it('o destino segue a tela inicial escolhida', () => {
    expect(topo).toContain('href="/quadro"');
  });
});

/* ─────────────────── a barra recolhe, e as seções fecham — F29 ─────────────────── */

/**
 * `Meu trabalho` desenhado com uma preferência guardada — o mesmo empréstimo
 * de `localStorage` do bloco acima, para qualquer escolha. Devolve só a barra
 * (do `id` dela em diante).
 */
const barraCom = (mudou: Partial<Preferencias>): string => {
  const guardado = escreverPreferencias({ ...PADRAO, ...mudou });
  vi.stubGlobal('window', {
    localStorage: { getItem: (k: string) => (k === CHAVE ? guardado : null) },
  });
  try {
    const html = desenhar('/meu-trabalho');
    return html.slice(html.indexOf('id="barra-lateral"'));
  } finally {
    vi.unstubAllGlobals();
  }
};

/** A seção de navegação pelo nome — o `nav` inteiro, título e itens. */
const secaoDaBarra = (barra: string, nome: string): string =>
  new RegExp(`<nav[^>]*aria-label="${nome}"[\\s\\S]*?</nav>`).exec(barra)?.[0] ?? '';

/** O botão de recolher/expandir a barra, na linha do alto. */
const botaoDaBarra = (barra: string): string =>
  /<button[^>]*class="bl-recolher"[^>]*>/.exec(barra)?.[0] ?? '';

/*
  F43 FASE 8 — UMA BARRA SÓ. Até aqui este bloco provava o trilho de atalhos do
  layout Foco (`nav` "Atalhos principais": Início, Notificações, Chat e Painel
  só com ícone, e as cópias com nome escondidas pela folha acima de 1024px). O
  trilho saiu de propósito, e o bloco passou a provar o contrário: cada destino
  aparece UMA vez, com o nome — os e2e procuram os itens pelo nome acessível, e
  dois links com o mesmo nome fariam o `getByRole` achar dois.
*/
describe('F43 Fase 8: uma barra só — cada destino uma vez, com o nome', () => {
  /* Com a chave do chat LIGADA: desligada (o padrão da suíte, sem `/config`),
     o item Chat nem existe, e a conta abaixo não provaria nada sobre ele. */
  const barra = (() => {
    const antes = modoDoChat();
    definirModoDoChat('ligado');
    try {
      return barraCom({});
    } finally {
      definirModoDoChat(antes);
    }
  })();
  const quantas = (html: string, trecho: string) => html.split(trecho).length - 1;

  it('o trilho de atalhos saiu, e nada mais marca item como "atalho"', () => {
    expect(barra).not.toContain('Atalhos principais');
    expect(barra).not.toContain('iw-atalhos');
    expect(barra).not.toContain('data-atalho');
    expect(barra).not.toContain('data-so-atalhos');
  });

  it('cada destino aparece uma vez — sem segunda cópia escondida', () => {
    for (const rota of ['/avisos', '/chat', '/tarefas', '/quadro', '/painel', '/planejamento?visao=calendario', '/planejamento']) {
      expect(quantas(barra, `href="${rota}"`), rota).toBe(1);
    }
    // `/meu-trabalho` aparece duas vezes, e com dois nomes: o `Início` (a tela
    // inicial de fábrica) e o item `Minhas tarefas`.
    expect(quantas(barra, 'href="/meu-trabalho"')).toBe(2);
    for (const nome of ['Início', 'Notificações', 'Chat', 'Minhas tarefas', 'Painel']) {
      expect(quantas(barra, `<span class="bl-item-nome">${nome}</span>`), nome).toBe(1);
    }
  });

  it('Notificações e Chat são itens com nome de `Meu trabalho`, antes de Minhas tarefas', () => {
    const trabalho = secaoDaBarra(barra, 'Meu trabalho');
    const posicoes = ['/avisos', '/chat', '/meu-trabalho', '/tarefas', '/quadro'].map((r) =>
      trabalho.indexOf(`href="${r}"`),
    );
    expect(posicoes.every((p) => p >= 0)).toBe(true);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
    expect(trabalho).toContain('<span class="bl-item-nome">Notificações</span>');
    expect(trabalho).toContain('<span class="bl-item-nome">Chat</span>');
  });

  it('o Painel é item com nome de `Entrega`, antes de Calendário e Planejamento', () => {
    const entrega = secaoDaBarra(barra, 'Entrega');
    expect(entrega).toContain('<span class="bl-item-nome">Painel</span>');
    expect(entrega.indexOf('href="/painel"')).toBeLessThan(entrega.indexOf('href="/planejamento?visao=calendario"'));
    expect(entrega.indexOf('href="/planejamento?visao=calendario"')).toBeLessThan(entrega.indexOf('href="/planejamento"'));
  });

  it('esconder um item nas preferências o tira da barra inteira', () => {
    const html = barraCom({ itens: { ...PADRAO.itens, avisos: false, painel: false } });
    expect(html).toContain('>Início</span>');
    expect(html).not.toContain('href="/avisos"');
    expect(html).not.toContain('href="/painel"');
  });

  it('esconder a seção Entrega tira o Painel de toda a barra', () => {
    const html = barraCom({ secoes: { ...PADRAO.secoes, entrega: false } });
    expect(html).not.toContain('href="/painel"');
  });

  it('o `Início` é um só, com o nome, e segue a tela inicial escolhida', () => {
    const html = barraCom({ telaInicial: 'quadro' });
    expect(quantas(html, 'aria-label="Início — abre em Quadro"')).toBe(1);
    const topo = /<a class="bl-item bl-inicio"[^>]*>[\s\S]*?<\/a>/.exec(html)?.[0] ?? '';
    expect(topo).toContain('href="/quadro"');
    expect(topo).toContain('>Início</span>');
  });

  it('a folha não esconde mais as cópias com nome, nem reserva a faixa do trilho', () => {
    const folha = readFileSync(join(import.meta.dirname, '..', 'ui', 'layout-foco.css'), 'utf8');
    expect(folha).not.toContain('.iw-atalhos');
    expect(folha).not.toContain('data-atalho');
    expect(folha).not.toContain('data-so-atalhos');
    expect(folha).not.toContain('padding-left: 3.65rem');
    expect(folha).not.toMatch(/\.bl-inicio[^{]*\{[^}]*display:\s*none/);
  });
});

/*
  F43 FASE 9 — "BUSCAR OU IR PARA…". O gatilho da busca entra no alto da
  barra, entre a linha da marca e o `Início`. O pedido do Wesley para esta fase
  foi "toma cuidado para não esconder nenhum botão sem querer… ou função" —
  então este bloco prova as duas coisas: onde o gatilho entra, e que tudo o que
  já estava na barra continua lá, na mesma ordem e com o mesmo nome, nas duas
  aparências. Nenhuma asserção anterior deste arquivo precisou mudar.
*/
describe('F43 Fase 9: o gatilho "Buscar ou ir para…" entra no alto da barra sem tirar nada do lugar', () => {
  const html = desenhar('/meu-trabalho');
  const barra = html.slice(html.indexOf('id="barra-lateral"'));
  const gatilho = /<button[^>]*class="bl-ir"[^>]*>[\s\S]*?<\/button>/.exec(barra)?.[0] ?? '';
  const quantas = (texto: string, trecho: string) => texto.split(trecho).length - 1;

  it('existe uma vez só, é botão (abre a janela) e mostra a tecla', () => {
    expect(quantas(barra, 'class="bl-ir"')).toBe(1);
    expect(gatilho).toContain('<span class="bl-ir-texto">Buscar ou ir para…</span>');
    expect(gatilho).toMatch(/<kbd class="bl-ir-tecla" aria-hidden="true">(Ctrl K|⌘K)<\/kbd>/);
    expect(gatilho).toContain('aria-haspopup="dialog"');
    expect(gatilho).toContain('aria-expanded="false"');
  });

  it('fica DEPOIS da linha da marca e ANTES do `Início` e das seções', () => {
    const p = (t: string) => barra.indexOf(t);
    expect(p('class="bl-topo"')).toBeLessThan(p('class="bl-ir"'));
    expect(p('class="bl-recolher"')).toBeLessThan(p('class="bl-ir"'));
    expect(p('class="bl-ir"')).toBeLessThan(p('bl-inicio'));
    expect(p('class="bl-ir"')).toBeLessThan(p('bl-secao'));
  });

  it('"Pular para o conteúdo" continua sendo o primeiro focável da tela', () => {
    const primeiro = /<(a|button|input|select|textarea)\b[^>]*>/.exec(html)?.[0] ?? '';
    expect(primeiro).toMatch(/^<a href="#conteudo" class="bl-pular">$/);
  });

  it('⚠️ nada da barra sumiu nem mudou de nome: os mesmos controles, na mesma ordem, com o gatilho no meio', () => {
    const ordem = [
      'aria-label="Recolher a barra"',
      'class="bl-ir"',
      'aria-label="Início — abre em Minhas tarefas"',
      'aria-controls="bl-itens-trabalho"',
      'href="/avisos"',
      '<span class="bl-item-nome">Minhas tarefas</span>',
      'href="/tarefas"',
      'href="/quadro"',
      'aria-controls="bl-itens-entrega"',
      'href="/painel"',
      // F43 Fase 4: o Calendário virou visão do Planejamento — o item da barra
      // continua no mesmo lugar, com destino novo.
      'href="/planejamento?visao=calendario"',
      'href="/planejamento"',
      'Compartilhado comigo',
      'class="bl-conta"',
    ];
    const posicoes = ordem.map((t) => barra.indexOf(t));
    ordem.forEach((t, i) => expect(posicoes[i], t).toBeGreaterThan(-1));
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
    expect(barra).toContain('class="iw-marca bl-topo-marca"');
    // Cada item continua UMA vez (a regra da Fase 8): o gatilho não é link.
    for (const rota of ['/avisos', '/tarefas', '/quadro', '/painel', '/planejamento?visao=calendario', '/planejamento']) {
      expect(quantas(barra, `href="${rota}"`), rota).toBe(1);
    }
  });

  it('a janela nasce fechada: nenhum diálogo nem caixa de busca no primeiro desenho', () => {
    expect(html).not.toContain('role="combobox"');
    expect(html).not.toContain('aria-label="Buscar ou ir para"');
  });

  it('em `Somente ícones` o gatilho vira a lupa com nome, e os outros continuam com os deles', () => {
    const icones = barraCom({ aparencia: 'icones' });
    expect(icones).toContain('data-aparencia="icones"');
    const lupa = /<button[^>]*class="bl-ir"[^>]*>[\s\S]*?<\/button>/.exec(icones)?.[0] ?? '';
    expect(lupa).toContain('aria-label="Buscar ou ir para…"');
    expect(lupa).toMatch(/title="Buscar ou ir para… \((Ctrl K|⌘K)\)"/);
    expect(lupa).toContain('<svg');
    expect(lupa).not.toContain('bl-ir-texto');
    expect(lupa).not.toContain('<kbd');
    const nomes = [
      'Expandir a barra',
      'Início — abre em Minhas tarefas',
      'Notificações',
      'Minhas tarefas',
      'Todas as tarefas',
      'Quadro',
      'Painel',
      'Calendário',
      'Planejamento',
      'Compartilhado comigo — expandir a barra',
    ];
    for (const nome of nomes) expect(icones, nome).toContain(`aria-label="${nome}`);
    expect(icones).toContain('class="bl-conta"');
    // E a ordem: o botão de expandir, a lupa, o `Início`.
    expect(icones.indexOf('aria-label="Expandir a barra"')).toBeLessThan(icones.indexOf('class="bl-ir"'));
    expect(icones.indexOf('class="bl-ir"')).toBeLessThan(icones.indexOf('bl-inicio'));
  });
});

describe('F29: a linha do alto tem a marca e o botão de recolher', () => {
  const barra = barraCom({});

  it('o botão existe, com nome acessível e dizendo que a barra está expandida', () => {
    const botao = botaoDaBarra(barra);
    expect(botao).toContain('aria-label="Recolher a barra"');
    expect(botao).toContain('aria-expanded="true"');
  });

  it('a linha do alto vem ANTES do `Início`, e traz a marca', () => {
    expect(barra.indexOf('bl-topo')).toBeGreaterThan(-1);
    expect(barra.indexOf('bl-topo')).toBeLessThan(barra.indexOf('bl-inicio'));
    expect(barra).toContain('class="iw-marca bl-topo-marca"');
    expect(barra).toContain('aria-label="Ide Works"');
    expect(barra).toContain('role="img"');
    // F01: a marca deixou de puxar a arte inteira (1,38 MB) — a máscara leve
    // mora no CSS e a cor vem do tema.
    expect(barra).not.toContain('ideworks-marca-original.png');
  });

  it('em `Somente ícones` o botão vira o de expandir, e a marca sai', () => {
    const icones = barraCom({ aparencia: 'icones' });
    const botao = botaoDaBarra(icones);
    expect(botao).toContain('aria-label="Expandir a barra"');
    expect(botao).toContain('aria-expanded="false"');
    expect(icones).not.toContain('bl-topo-marca');
  });
});

describe('F29: cada seção abre e fecha pelo título', () => {
  it('de fábrica, os títulos são botões abertos, apontando para a caixa dos itens', () => {
    const barra = barraCom({});
    for (const [nome, chave] of [
      ['Meu trabalho', 'trabalho'],
      ['Entrega', 'entrega'],
    ] as const) {
      const secao = secaoDaBarra(barra, nome);
      expect(secao, nome).toMatch(
        new RegExp(`<button[^>]*aria-expanded="true"[^>]*aria-controls="bl-itens-${chave}"`),
      );
      expect(secao, nome).toContain(`id="bl-itens-${chave}"`);
    }
    expect(secaoDaBarra(barra, 'Entrega')).toContain('href="/planejamento?visao=calendario"');
  });

  it('⚠️ seção recolhida pela preferência NÃO desenha os itens — e as outras seguem abertas', () => {
    const barra = barraCom({ recolhidas: { ...PADRAO.recolhidas, entrega: true } });
    const entrega = secaoDaBarra(barra, 'Entrega');
    expect(entrega).toContain('aria-expanded="false"');
    // O título fica — é por ele que se reabre.
    expect(entrega).toContain('Entrega');
    for (const rota of ['/painel', '/planejamento?visao=calendario', '/planejamento']) {
      expect(entrega).not.toContain(`href="${rota}"`);
    }
    const trabalho = secaoDaBarra(barra, 'Meu trabalho');
    expect(trabalho).toContain('aria-expanded="true"');
    expect(trabalho).toContain('href="/meu-trabalho"');
  });

  it('em `Somente ícones` o recolhido é ignorado: todos os ícones, nenhum título', () => {
    // Sem título não há onde clicar para reabrir — o item sumiria sem volta.
    const barra = barraCom({
      aparencia: 'icones',
      recolhidas: { trabalho: true, arvore: true, entrega: true, gestao: true },
    });
    const entrega = secaoDaBarra(barra, 'Entrega');
    expect(entrega).toContain('href="/planejamento?visao=calendario"');
    expect(entrega).not.toContain('aria-expanded');
    expect(barra).not.toContain('bl-secao-alternar');
  });

  it('a árvore também recolhe pelo título, e o `+` de Novo espaço continua lá', () => {
    const aberta = barraCom({});
    expect(aberta).toMatch(
      /<button[^>]*class="bl-secao-alternar"[^>]*aria-expanded="true"[^>]*aria-controls="bl-itens-arvore"/,
    );

    const fechada = barraCom({ recolhidas: { ...PADRAO.recolhidas, arvore: true } });
    expect(fechada).toMatch(
      /<button[^>]*class="bl-secao-alternar"[^>]*aria-expanded="false"[^>]*aria-controls="bl-itens-arvore"/,
    );
    expect(fechada).toContain('Compartilhado comigo');
    expect(fechada).toContain('aria-label="Novo espaço"');
    // A caixa dos itens existe (alvo do `aria-controls`) e está vazia.
    expect(fechada).toMatch(/<div id="bl-itens-arvore" class="cu-arvore-corpo"><\/div>/);
  });
});

/* ─────────────────── a árvore numa coluna própria — F29, Fase 3 ─────────────────── */

/** A tela INTEIRA com uma preferência guardada — a grade (`.q-tela`) vem antes da barra. */
const telaCom = (mudou: Partial<Preferencias>): string => {
  const guardado = escreverPreferencias({ ...PADRAO, ...mudou });
  vi.stubGlobal('window', {
    localStorage: { getItem: (k: string) => (k === CHAVE ? guardado : null) },
  });
  try {
    return desenhar('/meu-trabalho');
  } finally {
    vi.unstubAllGlobals();
  }
};

/** A barra SÓ ELA — do `id` até a coluna, que é a irmã seguinte na grade. */
const soABarra = (html: string): string => {
  const inicio = html.indexOf('id="barra-lateral"');
  const coluna = html.indexOf('class="bl-coluna"', inicio);
  return html.slice(inicio, coluna === -1 ? undefined : coluna);
};

/** A coluna da árvore, quando existe — do começo dela ao fim da página. */
const aColuna = (html: string): string => {
  const i = html.indexOf('class="bl-coluna"');
  return i === -1 ? '' : html.slice(i);
};

/** O botão que solta e devolve a árvore. */
const botaoDaColuna = (html: string): string =>
  /<button[^>]*class="cu-icone-btn bl-soltar-arvore"[^>]*>/.exec(html)?.[0] ?? '';

/** A abertura da grade. */
const aGrade = (html: string): string => /<div class="q-tela"[^>]*>/.exec(html)?.[0] ?? '';

describe('F29: a árvore solta numa coluna própria', () => {
  it('de fábrica, o título da árvore traz o botão de abrir a coluna, desligado', () => {
    const html = telaCom({});
    const botao = botaoDaColuna(soABarra(html));
    expect(botao).toContain('aria-label="Abrir a árvore numa coluna"');
    expect(botao).toContain('aria-pressed="false"');
    // É irmão do `+`, no mesmo cabeçalho — e não filho do título que recolhe.
    const topo = /<header class="cu-arvore-topo">[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';
    expect(topo).toContain('bl-soltar-arvore');
    expect(topo).toContain('aria-label="Novo espaço"');
    expect(topo).not.toMatch(/<button[^>]*bl-secao-alternar[^>]*>(?:(?!<\/button>)[\s\S])*bl-soltar-arvore/);
  });

  it('de fábrica, a grade tem duas faixas e não há coluna', () => {
    const html = telaCom({});
    expect(aGrade(html)).not.toContain('data-coluna');
    expect(html).not.toContain('class="bl-coluna"');
  });

  it('ligada, a GRADE abre a terceira faixa — a mesma conta que a barra faz', () => {
    expect(aGrade(telaCom({ arvoreEmColuna: true }))).toContain('data-coluna="arvore"');
  });

  it('⚠️ ligada, a barra PERDE a seção da árvore, e a coluna a desenha', () => {
    const html = telaCom({ arvoreEmColuna: true });
    const barra = soABarra(html);
    expect(barra).not.toContain('Compartilhado comigo');
    expect(barra).not.toContain('bl-secao-arvore');
    expect(barra).not.toContain('cu-arvore');
    // As outras seções e o chip da conta continuam na barra.
    expect(secaoDaBarra(barra, 'Meu trabalho')).toContain('href="/meu-trabalho"');
    expect(barra).toContain('class="bl-conta"');

    const coluna = aColuna(html);
    expect(coluna).toContain('Compartilhado comigo');
    expect(coluna).toContain('cu-arvore');
    // Uma árvore só na página: a coluna não soma uma segunda à da barra.
    expect(html.match(/class="o-card q-barra cu-arvore/g)?.length).toBe(1);
  });

  it('ligada, o mesmo botão devolve: pressionado, e dizendo o que o clique faz', () => {
    const botao = botaoDaColuna(aColuna(telaCom({ arvoreEmColuna: true })));
    expect(botao).toContain('aria-label="Devolver a árvore para a barra"');
    expect(botao).toContain('aria-pressed="true"');
  });

  it('na coluna o título não recolhe — ela existe para mostrar a árvore', () => {
    const coluna = aColuna(telaCom({ arvoreEmColuna: true, recolhidas: { ...PADRAO.recolhidas, arvore: true } }));
    expect(coluna).not.toContain('bl-secao-alternar');
    // Título simples — e focável pelo código (F29, Fase 4): é para ele que o
    // foco vai quando o ícone único de `Somente ícones` expande a barra.
    expect(coluna).toContain('<h2 class="eyebrow" tabindex="-1">Compartilhado comigo</h2>');
  });

  it('F02: a grade diz o contexto e, sem medida, desenha a escolha guardada', () => {
    const grade = aGrade(telaCom({ arvoreEmColuna: true }));
    expect(grade).toContain('data-contexto="trabalho"');
    expect(grade).toContain('data-barra="icones-e-rotulos"');
    expect(grade).not.toContain('data-adaptada');
  });

  /* F02B (R08): ERA "recolher a barra esconde a coluna". O Wesley pediu uma
     coluna de cada vez — recolher o menu deixa a coluna, e a grade soma as
     duas faixas (rail 3.5rem + coluna 16.5rem). */
  it('⚠️ F02B: recolher o menu MANTÉM a coluna — e a grade reserva rail + coluna', () => {
    const html = telaCom({ arvoreEmColuna: true, aparencia: 'icones' });
    expect(html).toContain('class="bl-coluna"');
    expect(aGrade(html)).toContain('data-coluna="arvore"');
    expect(aGrade(html)).toContain('data-barra="icones"');
    expect(aColuna(html)).toContain('Compartilhado comigo');
  });

  it('F02B: recolher as LISTAS esconde a coluna — e a grade não reserva a faixa', () => {
    const html = telaCom({ arvoreEmColuna: true, listasRecolhidas: true });
    expect(html).not.toContain('class="bl-coluna"');
    expect(aGrade(html)).not.toContain('data-coluna');
    expect(aGrade(html)).toContain('data-barra="icones-e-rotulos"');
  });
});

/* ─────────── F02B: menu e listas recolhem cada um por si (R08) ─────────── */

/** O botão de recolher as listas, no título da coluna. */
const botaoRecolherListas = (html: string): string =>
  /<button[^>]*class="cu-icone-btn bl-recolher-listas"[^>]*>/.exec(html)?.[0] ?? '';
/** O ícone ou a linha da árvore na barra. */
const botaoDaArvoreNaBarra = (barra: string): string =>
  /<button[^>]*class="bl-item bl-item-arvore[^"]*"[^>]*>[\s\S]*?<\/button>/.exec(barra)?.[0] ?? '';

describe('F02B: recolher o menu e as listas independentemente', () => {
  const casos = [
    { aparencia: 'icones-e-rotulos', listasRecolhidas: false },
    { aparencia: 'icones', listasRecolhidas: false },
    { aparencia: 'icones-e-rotulos', listasRecolhidas: true },
    { aparencia: 'icones', listasRecolhidas: true },
  ] as const;

  for (const caso of casos) {
    const rotulo = `menu ${caso.aparencia === 'icones' ? 'compacto' : 'aberto'} + listas ${caso.listasRecolhidas ? 'recolhidas' : 'abertas'}`;
    it(`${rotulo}: grade, barra e coluna concordam`, () => {
      const html = telaCom({ arvoreEmColuna: true, ...caso });
      const grade = aGrade(html);
      expect(grade).toContain(`data-barra="${caso.aparencia}"`);
      const barra = soABarra(html);
      expect(barra).toMatch(/id="barra-lateral"[^>]*data-arvore="fora"/);
      // Uma árvore só, e nunca dentro da barra.
      expect(barra).not.toContain('cu-arvore');
      if (caso.listasRecolhidas) {
        expect(grade).not.toContain('data-coluna');
        expect(html).not.toContain('class="bl-coluna"');
        // O caminho de volta está na barra, com nome que diz o que faz.
        const volta = botaoDaArvoreNaBarra(barra);
        expect(volta).toContain('aria-label="Compartilhado comigo — mostrar listas"');
        expect(volta).toContain('aria-expanded="false"');
        // Com o menu aberto, o nome também está no desenho.
        if (caso.aparencia === 'icones-e-rotulos') {
          expect(volta).toContain('bl-mostrar-listas');
          expect(volta).toContain('<span class="bl-item-nome">Compartilhado comigo</span>');
        }
      } else {
        expect(grade).toContain('data-coluna="arvore"');
        const coluna = aColuna(html);
        expect(html).toContain('id="bl-coluna-listas" class="bl-coluna"');
        expect(botaoRecolherListas(coluna)).toContain('aria-label="Recolher listas"');
        // O botão de encaixar continua lá, com outro nome.
        expect(botaoDaColuna(coluna)).toContain('aria-label="Devolver a árvore para a barra"');
        expect(html.match(/class="o-card q-barra cu-arvore/g)?.length).toBe(1);
        if (caso.aparencia === 'icones') {
          // No rail, o ícone da árvore agora recolhe as listas — e não expande o menu.
          const icone = botaoDaArvoreNaBarra(barra);
          expect(icone).toContain('aria-label="Compartilhado comigo — recolher listas"');
          expect(icone).toContain('aria-expanded="true"');
          expect(icone).toContain('aria-controls="bl-coluna-listas"');
        } else {
          expect(barra).not.toContain('bl-item-arvore');
        }
      }
    });
  }

  it('recolher listas e encaixar são botões diferentes: nome e ícone distintos', () => {
    const coluna = aColuna(telaCom({ arvoreEmColuna: true }));
    const recolher = /<button[^>]*bl-recolher-listas[^>]*>[\s\S]*?<\/button>/.exec(coluna)?.[0] ?? '';
    const encaixar = /<button[^>]*bl-soltar-arvore[^>]*>[\s\S]*?<\/button>/.exec(coluna)?.[0] ?? '';
    expect(recolher).not.toBe('');
    expect(encaixar).not.toBe('');
    const desenho = (b: string) => b.replace(/^<button[^>]*>/, '');
    expect(desenho(recolher)).not.toBe(desenho(encaixar));
  });

  it('dentro da barra (sem coluna), não há botão de recolher listas', () => {
    const html = telaCom({});
    expect(html).not.toContain('bl-recolher-listas');
    expect(html).not.toContain('bl-mostrar-listas');
    // E `listasRecolhidas` sem a coluna não esconde nada: a árvore segue na barra.
    expect(soABarra(telaCom({ listasRecolhidas: true }))).toContain('cu-arvore');
  });

  it('revelar pela trilha: em coluna reabre SÓ as listas; dentro da barra expande o menu', () => {
    const base: Preferencias = { ...PADRAO, arvoreEmColuna: true, aparencia: 'icones', listasRecolhidas: true };
    expect(preferenciasParaRevelar(base)).toEqual({ ...base, listasRecolhidas: false });
    const aberta = { ...base, listasRecolhidas: false };
    expect(preferenciasParaRevelar(aberta)).toBe(aberta);
    const naBarra: Preferencias = { ...PADRAO, aparencia: 'icones' };
    expect(preferenciasParaRevelar(naBarra).aparencia).toBe('icones-e-rotulos');
    expect(preferenciasParaRevelar(PADRAO)).toBe(PADRAO);
  });
});

describe('F29: em `Somente ícones`, a árvore vira um ícone só', () => {
  /* Medido na Fase 1: a árvore inteira numa coluna de 3.5rem vazava da borda
     — cinquenta ícones de espaço além dela. */
  for (const arvoreEmColuna of [false, true]) {
    const barra = soABarra(telaCom({ aparencia: 'icones', arvoreEmColuna }));
    const icone = /<button[^>]*class="bl-item bl-item-arvore"[^>]*>[\s\S]*?<\/button>/.exec(barra)?.[0] ?? '';

    /* F02B: com a coluna ligada, o ícone alterna SÓ as listas (a coluna está
       ao lado, à vista) — ver o bloco F02B. Desligada, expande a barra. */
    const acao = arvoreEmColuna ? 'recolher listas' : 'expandir a barra';
    it(`um botão com nome acessível que diz o que o clique faz (coluna ${arvoreEmColuna ? 'ligada' : 'desligada'})`, () => {
      expect(icone).toContain(`aria-label="Compartilhado comigo — ${acao}"`);
      expect(icone).toContain(`title="Compartilhado comigo — ${acao}"`);
      expect(icone).toContain('<svg');
      // Um só.
      expect(barra.match(/bl-item-arvore/g)?.length).toBe(1);
    });

    it(`nenhum nó da árvore desenhado (coluna ${arvoreEmColuna ? 'ligada' : 'desligada'})`, () => {
      expect(barra).not.toContain('cu-arvore');
      expect(barra).not.toContain('aria-label="Novo espaço"');
      // E a barra avisa a folha, que devolve a altura e o chip ao pé.
      expect(barra).toMatch(/id="barra-lateral"[^>]*data-arvore="fora"/);
    });
  }

  it('com a barra expandida, o ícone não existe — a árvore está lá', () => {
    const html = telaCom({});
    expect(html).not.toContain('bl-item-arvore');
    expect(soABarra(html)).not.toContain('data-arvore=');
    // Com a árvore na coluna, a barra fica sem ela, e diz isso.
    expect(soABarra(telaCom({ arvoreEmColuna: true }))).toMatch(/id="barra-lateral"[^>]*data-arvore="fora"/);
  });
});

describe('F29: as setas dos títulos e do chip são desenho, e giram pelo `aria-expanded`', () => {
  const barra = barraCom({});

  it('os títulos de seção levam o SVG, e não mais o `▸` de texto', () => {
    const titulo = /<button[^>]*class="bl-secao-alternar"[^>]*aria-controls="bl-itens-entrega"[^>]*>[\s\S]*?<\/button>/.exec(barra)?.[0] ?? '';
    expect(titulo).toMatch(/<svg[^>]*class="bl-seta"/);
    expect(barra).not.toContain('▸');
    // O estado mora no botão; a seta não repete o `data-aberto`.
    expect(barra).not.toMatch(/class="bl-seta"[^>]*data-aberto/);
  });

  it('o chip da conta leva o mesmo SVG, e não o `▾`', () => {
    const chip = /<button[^>]*class="bl-conta"[\s\S]*?<\/button>/.exec(barra)?.[0] ?? '';
    expect(chip).toMatch(/<svg[^>]*class="bl-conta-seta"/);
    expect(chip).not.toContain('▾');
    expect(chip).not.toContain('▴');
  });
});

describe('F29: o atalho de recolher é `Ctrl + .` ou `⌘ + .`, e só ele', () => {
  const tecla = (key: string, extra: Partial<Parameters<typeof ehAtalhoDeRecolher>[0]> = {}) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...extra,
  });

  it('Ctrl e ⌘ com o ponto recolhem', () => {
    expect(ehAtalhoDeRecolher(tecla('.', { ctrlKey: true }))).toBe(true);
    expect(ehAtalhoDeRecolher(tecla('.', { metaKey: true }))).toBe(true);
  });

  it('o ponto sozinho é só um ponto — senão ninguém escreveria uma frase', () => {
    expect(ehAtalhoDeRecolher(tecla('.'))).toBe(false);
  });

  it('F29: com o foco num campo de texto o atalho não dispara — o ponto é do campo', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'input']) {
      expect(ehAtalhoDeRecolher(tecla('.', { ctrlKey: true, target: { tagName } })), tagName).toBe(
        false,
      );
    }
    // O editor rico: o parágrafo DENTRO de um `[contenteditable]` herda o
    // `isContentEditable` no navegador.
    expect(
      ehAtalhoDeRecolher(
        tecla('.', { metaKey: true, target: { tagName: 'P', isContentEditable: true } }),
      ),
    ).toBe(false);
  });

  it('F29: fora de campo (um botão, a página) o atalho continua valendo', () => {
    expect(ehAtalhoDeRecolher(tecla('.', { ctrlKey: true, target: { tagName: 'BUTTON' } }))).toBe(
      true,
    );
    expect(
      ehAtalhoDeRecolher(
        tecla('.', { metaKey: true, target: { tagName: 'BODY', isContentEditable: false } }),
      ),
    ).toBe(true);
    expect(ehAtalhoDeRecolher(tecla('.', { ctrlKey: true, target: null }))).toBe(true);
  });

  it('modificador a mais não conta, e os atalhos do editor seguem livres', () => {
    expect(ehAtalhoDeRecolher(tecla('.', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(ehAtalhoDeRecolher(tecla('.', { metaKey: true, altKey: true }))).toBe(false);
    for (const k of ['b', 'i', 'k', 's', 'x', 'Enter']) {
      expect(ehAtalhoDeRecolher(tecla(k, { ctrlKey: true })), k).toBe(false);
    }
  });
});

describe('`Todas as tarefas` oferece as duas formas', () => {
  const html = desenhar('/tarefas');

  it('Lista e Kanban — F18C: o quadro da pessoa se chama Kanban, como nas outras telas', () => {
    expect(html).toContain('<span class="iw-forma-rotulo">Lista</span>');
    expect(html).toContain('<span class="iw-forma-rotulo">Kanban</span>');
    expect(html).not.toContain('<span class="iw-forma-rotulo">Quadro</span>');
  });

  it('e o topo vem antes delas, só com o título — F17.25 → F29', () => {
    // Tela principal: a trilha `Meu trabalho › Todas as tarefas` saiu (nenhum
    // degrau levava a lugar nenhum) e o topo diz onde se está pelo título.
    expect(html).toMatch(/<h1 class="o-titulo[^"]*">Todas as tarefas<\/h1>/);
    // F03: o seletor de forma é `iw-segmentos` (botões pressionáveis).
    expect(html.indexOf('o-topo')).toBeLessThan(html.indexOf('iw-segmentos'));
    expect(html).not.toContain('tr-trilha');
    expect(html).not.toContain('>Voltar</button>');
  });

  /*
    ⚠️ AQUI HAVIA `toContain('ao seu alcance')`, E ELA JÁ NÃO TESTAVA O QUE DIZIA.

    A frase estava no subtítulo da página, e a F17.20 o tirou — mas o teste
    continuou VERDE. O motivo: a barra lateral desenha a árvore vazia com
    "Nenhum espaço ao seu alcance…", e o `toContain` não distingue a página da
    barra. Ou seja, ela passaria com o miolo da tela inteiro apagado. Foi
    medida, não suposta: a asserção sobreviveu à remoção do subtítulo.

    O que ela existia para guardar é que ESTA tela não é `Minhas tarefas` — e
    isso quem diz é o título. A âncora passa a ser o `<h1>`, o único lugar onde
    `o-titulo` e `Todas as tarefas` aparecem juntos (o nome também é item da
    barra lateral, dentro de um `<a>`).
  */
  it('o título diz que esta tela é a de TODAS, e não a de `Minhas tarefas`', () => {
    expect(html).toMatch(
      /<h1[^>]*class="[^"]*o-titulo[^"]*"[^>]*>[\s\S]*?Todas as tarefas[\s\S]*?<\/h1>/,
    );
    expect(html).not.toMatch(/<h1[^>]*>[\s\S]*?Meu trabalho[\s\S]*?<\/h1>/);
  });
});

/*
  `Minhas tarefas` NASCEU SÓ EM LISTA, e a equipe pediu o quadro: *"a aba
  'minhas tarefas' (…) colocar a opção de quadro, porque só tem em lista"*.
  O seletor é o MESMO de `Todas as tarefas`, e a escolha mora no endereço
  (`?ver=`), pela regra da F17.24 — então dá para prová-la aqui sem clique:
  basta montar a tela com a query string e ler qual aba saiu selecionada.

  F03 (UX09): a forma deixou de ser `role="tab"` sem painel e virou BOTÃO
  PRESSIONÁVEL (`AlternadorDeVista`) — Lista e Quadro redesenham o mesmo
  conjunto, não há painéis independentes. O React serializa `aria-pressed`
  como `"true"`/`"false"`, e é por esse texto que a escolhida é achada. A regex
  procura o `<button>` com `aria-pressed` que TERMINA no rótulo, para não
  confundir `Lista` com a palavra solta noutro lugar da tela.
*/
describe('`Minhas tarefas` oferece as duas formas — F17.79', () => {
  /* F05: o botão traz o ícone e a palavra num `<span>` (que recolhe no
     celular, mas continua sendo o nome). */
  const abaDeForma = (html: string, rotulo: string): string =>
    new RegExp(
      `<button[^>]*aria-pressed="(?:true|false)"[^>]*>(?:<svg[^]*?</svg>)?<span class="iw-forma-rotulo">${rotulo}</span></button>`,
    ).exec(html)?.[0] ?? '';

  it('desenha o seletor de forma, com `Lista` e `Kanban` (F18C)', () => {
    const html = desenhar('/meu-trabalho');
    expect(html).toContain('aria-label="Forma de ver"');
    expect(abaDeForma(html, 'Lista')).not.toBe('');
    expect(abaDeForma(html, 'Kanban')).not.toBe('');
    expect(abaDeForma(html, 'Quadro')).toBe('');
  });

  it('abre em `Lista`', () => {
    const html = desenhar('/meu-trabalho');
    expect(abaDeForma(html, 'Lista')).toContain('aria-pressed="true"');
    expect(abaDeForma(html, 'Kanban')).toContain('aria-pressed="false"');
    expect(html).toMatch(/<div role="group" aria-label="Forma de ver"/);
    expect(html).not.toMatch(/role="tab"[^>]*>(?:<svg[^]*?<\/svg>)?(?:<span[^>]*>)?(?:Lista|Kanban)</);
  });

  it('com `?ver=kanban`, abre em `Kanban`; o endereço antigo `?ver=quadro` também', () => {
    for (const ver of ['kanban', 'quadro']) {
      const html = desenhar(`/meu-trabalho?ver=${ver}`);
      expect(abaDeForma(html, 'Kanban'), ver).toContain('aria-pressed="true"');
      expect(abaDeForma(html, 'Lista'), ver).toContain('aria-pressed="false"');
    }
  });

  it('o seletor de forma vem DEPOIS das três abas de situação', () => {
    // A ordem no HTML é a posição na tela: situação à esquerda, forma à direita.
    const html = desenhar('/meu-trabalho');
    const situacao = html.indexOf('aria-label="Situação das tarefas"');
    const forma = html.indexOf('aria-label="Forma de ver"');
    expect(situacao).toBeGreaterThan(-1);
    expect(forma).toBeGreaterThan(situacao);
  });
});

describe('F05: `Minhas tarefas` — hierarquia curta e busca com alcance dito', () => {
  it('a introdução saiu: nada de "O que vamos entregar hoje?" acima de grupos com outras datas', () => {
    const html = desenhar('/meu-trabalho');
    expect(html).not.toContain('entregar hoje');
    expect(html).not.toContain('Seu espaço de trabalho');
    expect(html).not.toContain('iw-intro');
    expect(html).not.toContain('Suas listas');
  });

  it('a ordem é a da tela e do teclado: situação → busca → forma, numa faixa só', () => {
    const html = desenhar('/meu-trabalho');
    const faixa = html.indexOf('class="mt-controles"');
    const situacao = html.indexOf('aria-label="Situação das tarefas"');
    const busca = html.indexOf('Buscar nas tarefas carregadas');
    const forma = html.indexOf('aria-label="Forma de ver"');
    expect(faixa).toBeGreaterThan(-1);
    expect(faixa).toBeLessThan(situacao);
    expect(situacao).toBeLessThan(busca);
    expect(busca).toBeLessThan(forma);
    // O rótulo inteiro diz o alcance; o texto de dentro só encurta.
    expect(html).toMatch(/<span class="sr-only">Buscar nas tarefas carregadas<\/span>/);
  });

  it('a busca vem do endereço: `?busca=` abre com o texto na caixa (F5 e VOLTAR a conservam)', () => {
    const html = desenhar('/meu-trabalho?aba=feito&ver=quadro&busca=revis%C3%A3o');
    expect(html).toMatch(/<input[^>]*type="search"[^>]*value="revisão"/);
  });

  it('a busca longa demais é cortada no teto da busca geral, e não quebra a tela', () => {
    const html = desenhar('/meu-trabalho?busca=' + 'a'.repeat(300));
    expect(html).toMatch(new RegExp(`value="a{120}"`));
  });

  it('enquanto espera, sem linha de resultado nem passagem — "carregando" não é "0 encontradas"', () => {
    const html = desenhar('/meu-trabalho?busca=revisar');
    expect(html).toContain('Carregando…');
    expect(html).not.toContain('encontrada');
    expect(html).not.toContain('Nenhuma correspondência');
    expect(html).not.toContain('Buscar em Todas as tarefas');
  });
});

describe('F05: com filtro, grupo vazio não é desenhado — sem filtro, fica', () => {
  const desenharCom = (semVazios: boolean) =>
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(GruposDeTrabalho, { linhas: [UMA_LINHA], hoje: { year: 2026, month: 8, day: 26 }, semVazios }),
      ),
    );

  it('sem filtro: os quatro, com as frases de vazio', () => {
    const html = desenharCom(false);
    expect(html).toContain('Nada em atraso');
    expect((html.match(/class="mt-grupo"/g) ?? []).length).toBe(4);
  });

  it('com filtro: só o grupo que tem linha — "Nada em atraso" seria falso', () => {
    const html = desenharCom(true);
    expect((html.match(/class="mt-grupo"/g) ?? []).length).toBe(1);
    expect(html).toContain('data-grupo="hoje"');
    expect(html).not.toContain('Nada em atraso');
  });

  it('a seta é o SVG da barra, e não o `▸` de texto', () => {
    const html = desenharCom(false);
    expect(html).not.toContain('▸');
    expect(html).toMatch(/<svg[^>]*class="mt-caret"/);
  });

  it('sem filtro, os vazios vão para DEPOIS dos que têm linha — e continuam lá, com a frase', () => {
    const semPrazo = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(GruposDeTrabalho, { linhas: [{ ...UMA_LINHA, dueOn: null }], hoje: { year: 2026, month: 8, day: 26 } }),
      ),
    );
    const ordem = [...semPrazo.matchAll(/data-grupo="([\w-]+)"/g)].map((m) => m[1]);
    expect(ordem).toEqual(['sem-data', 'hoje', 'atraso', 'proximo']);
    expect(semPrazo).toContain('Nada para hoje');
    expect(semPrazo).toContain('Nada em atraso');
  });
});

describe('F05: `Todas as tarefas` avisa quando o alcance da busca muda', () => {
  const desenharTodas = (state?: unknown) =>
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: [{ pathname: '/tarefas', search: '?busca=revisar', state }] },
        createElement(Routes, null, createElement(Route, { path: '/tarefas', element: createElement(TodasAsTarefas) })),
      ),
    );

  it('vindo da passagem de Minhas: diz que agora é tudo ao alcance, e oferece a volta com o texto', () => {
    const html = desenharTodas({ alcanceDe: 'minhas' });
    expect(html).toContain('iw-alcance');
    expect(html).toContain('todas as tarefas ao seu alcance');
    expect(html).toContain('href="/meu-trabalho?busca=revisar"');
  });

  it('chegando de outro jeito (barra, link colado): nenhum aviso', () => {
    expect(desenharTodas()).not.toContain('iw-alcance');
    expect(desenharTodas({ outra: 1 })).not.toContain('iw-alcance');
  });

  it('o mesmo ritmo de Minhas: busca antes da forma, na mesma faixa', () => {
    const html = desenharTodas();
    const faixa = html.indexOf('class="mt-controles"');
    expect(faixa).toBeGreaterThan(-1);
    expect(faixa).toBeLessThan(html.indexOf('Buscar tarefa pelo nome'));
    expect(html.indexOf('Buscar tarefa pelo nome')).toBeLessThan(html.indexOf('aria-label="Forma de ver"'));
  });
});

/*
  PAGINADA — F17.AUD06, achado 4 da auditoria de 09/09/2026.

  O que dá para provar sem efeito é o PRIMEIRO quadro, e ele é justamente um
  dos critérios da etapa: "a tela nunca apresenta zero enquanto ainda está
  esperando a primeira resposta". Antes, `contarPorAba(linhas ?? [])` escrevia
  `0` nas três abas durante a espera — e zero é resposta, não ausência. O resto
  (lotes, troca de aba, volta de uma ficha) é `paginacao-na-tela.test.ts`.
*/
describe('`Minhas tarefas` paginada — F17.AUD06', () => {
  const abaDeSituacao = (html: string, rotulo: string): string =>
    new RegExp(`<button[^>]*role="tab"[^>]*>${rotulo}(?:<span[^>]*>[^<]*</span>)?</button>`).exec(html)?.[0] ??
    '';

  it('enquanto espera a primeira resposta, as abas NÃO mostram número — nem zero', () => {
    const html = desenhar('/meu-trabalho');
    for (const rotulo of ['Pendente', 'Feito', 'Delegado']) {
      const aba = abaDeSituacao(html, rotulo);
      expect(aba).not.toBe('');
      expect(aba).not.toContain('iw-segmento-conta');
      expect(aba).not.toMatch(/>0</);
    }
    expect(html).toContain('Carregando…');
  });

  it('sem resposta, não há `Carregar mais` nem grupo desenhado — "não vi" não é "não tem"', () => {
    const html = desenhar('/meu-trabalho');
    expect(html).not.toContain('Carregar mais');
    expect(html).not.toContain('mt-corte');
    expect(html).not.toContain('Nada para hoje');
    expect(html).not.toContain('Nada aqui');
  });

  it('a aba do endereço é a selecionada — `?aba=feito` abre em `Feito`', () => {
    const html = desenhar('/meu-trabalho?aba=feito');
    expect(abaDeSituacao(html, 'Feito')).toContain('aria-selected="true"');
    expect(abaDeSituacao(html, 'Pendente')).toContain('aria-selected="false"');
  });
});

/* ───────────────────────────── a rede contra botão morto ───────────────────────────── */

describe('⚠️ nenhuma seção que não existe aparece na tela', () => {
  /**
   * As dezesseis da referência que dependem de etapas que não existem.
   *
   * Elas estão aqui como TEXTO porque é assim que apareceriam para quem usa: um
   * item de barra lateral é o nome dele. Se uma delas for construída um dia,
   * tira-se a linha daqui — e o commit que a tira é o commit que a entrega.
   */
  /*
    ⚠️ `Caixa de entrada` SAIU DAQUI NA F17.46, E ESTE É O COMMIT QUE A ENTREGA.
    O comentário acima já dizia como isso se faz: *"se uma delas for construída
    um dia, tira-se a linha daqui — e o commit que a tira é o commit que a
    entrega"*. A tela existe (`/avisos`), a rota existe, e o item da barra leva
    a ela — então ela deixou de ser botão morto e passou a ser botão.

    As dezesseis restantes continuam sem tela, e continuam proibidas.
  */
  const NAO_EXISTEM = [
    'Respostas',
    'Comentários atribuídos',
    'Atividade do chat',
    'Rascunhos e enviadas',
    'Posts',
    'Reuniões',
    'Todos os canais',
    'Chats com IA',
    'Mensagens diretas',
    'Habilidades',
    'Planilhas de horas',
    'Quadros brancos',
    'Formulários',
    'Clipes',
    'Painéis',
    'Planejador',
  ];

  const telas: [string, string][] = [
    ['Meu trabalho', desenhar('/meu-trabalho')],
    ['Todas as tarefas', desenhar('/tarefas')],
    ['Personalizar', desenharPainel()],
  ];

  for (const [nome, html] of telas) {
    it.each(NAO_EXISTEM)(`${nome} não desenha "%s"`, (secao) => {
      // A aba `Início` do painel CITA quatro delas para explicar por que não
      // estão — mas em prosa, e não como item clicável. Por isso o teste procura
      // a seção dentro de um elemento com destino, e não a palavra solta.
      expect(html).not.toMatch(new RegExp(`<a[^>]*>[^<]*${secao}`, 'i'));
      expect(html).not.toMatch(new RegExp(`<button[^>]*>[^<]*${secao}`, 'i'));
    });
  }
});

/* ───────────────────────────── a D10 no HTML ───────────────────────────── */

describe('A D10 NA TELA: nenhuma cor literal do Tailwind no que elas desenham', () => {
  // A cor do OBSIDIAN mora em token; a do ClickUp entra como variável no
  // elemento. Nenhuma das duas vira `bg-emerald-400`. Este teste olha o HTML
  // PRODUZIDO, e não a fonte — é o que sobra depois de toda condicional.
  const PALETA_DO_TAILWIND =
    /\b(?:bg|text|border|from|to|via|fill|stroke|ring|divide|shadow|outline|decoration|accent|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;

  it('`Meu trabalho`', () => {
    expect(desenhar('/meu-trabalho')).not.toMatch(PALETA_DO_TAILWIND);
  });

  it('`Todas as tarefas`', () => {
    expect(desenhar('/tarefas')).not.toMatch(PALETA_DO_TAILWIND);
  });

  it('o painel `Personalizar`, com as onze amostras de cor', () => {
    // É a tela de MAIOR risco: ela desenha onze cores. Se alguma virasse
    // `bg-purple-500`, seria aqui.
    expect(desenharPainel()).not.toMatch(PALETA_DO_TAILWIND);
  });

  it('as amostras apontam para a variável da folha, e não para um hexadecimal', () => {
    const html = desenharPainel();
    expect(html).toContain('var(--cor-roxo)');
    expect(html).not.toMatch(/--amostra:\s*#/);
  });
});

/* ───────────────────────────── o painel ───────────────────────────── */

describe('o painel `Personalizar` tem as quatro abas, e as quatro fazem algo', () => {
  const html = desenharPainel();

  it('as quatro abas da referência', () => {
    for (const aba of ['Navegação', 'Início', 'Seções', 'Temas']) {
      expect(html).toContain(aba);
    }
  });

  it('abre na aba `Navegação`, com as caixas dos itens e a escolha de aparência', () => {
    expect(html).toContain('Somente ícones');
    expect(html).toContain('Ícones e rótulos');
    expect(html).toContain('Minhas tarefas');
    expect(html).toContain('type="checkbox"');
  });

  it('diz onde a preferência mora, e o que se perde', () => {
    expect(html).toContain('Guardado neste navegador');
  });

  it('F43 Fase 10: as frases que só explicavam viraram "?" ao lado do que explicam', () => {
    // "Esconder um item não tira o acesso", "Arraste para trocar a ordem…" e
    // "Esconder uma seção não apaga nada" eram parágrafos fixos. Agora cada
    // aba tem o nome da lista e um "?" — botão de verdade, com nome — e a
    // frase inteira mora nele. "Guardado neste navegador" fica escrito: ele
    // avisa do que se perde em outro computador.
    expect(html).toContain('<span>Itens da barra</span>');
    expect(html).toContain('aria-label="Explicar: esconder um item da barra"');
    expect(html).toContain('<span>Ordem e seções da barra</span>');
    expect(html).toContain('aria-label="Explicar: ordenar e esconder seções"');
    expect(html).not.toContain('Arraste para trocar a ordem');
    expect(html).not.toContain('Esconder um item não tira o acesso');
  });

  it('F43 Fase 8: a seção `Gestão` só aparece no painel de quem administra', () => {
    // Para um funcionário ela nunca aparece na barra: nem caixa, nem linha de arrastar.
    expect(html).not.toContain('Gestão');
    expect(html).not.toContain('Controle da semana');
    expect(html).toContain('posição 1 de 3');

    const doAdmin = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(Personalizar, {
          preferencias: PADRAO,
          aoMudar: () => {},
          aoFechar: () => {},
          souAdmin: true,
        }),
      ),
    );
    expect(doAdmin).toContain('<span class="pz-rotulo">Gestão</span>');
    expect(doAdmin).toContain('Controle da semana');
    expect(doAdmin).toContain('aria-label="Gestão, posição 3 de 4.');
  });
});

/* ───────────── F04: as seis telas vestem a mesma moldura ───────────── */

/**
 * AS SEIS QUE MONTAVAM A GRADE À MÃO — F04 do plano UX.
 *
 * `Minhas tarefas`, `Todas as tarefas`, `Notificações`, `Espaço`, `Pasta` e
 * `Quadro` repetiam a receita da `TelaComBarra` (grade, barra, composição
 * medida da F02, coluna de conteúdo). Uma regra de shell que mudasse só na
 * moldura deixava as seis para trás (UX10). Aqui a MESMA forma é conferida
 * nas seis: grade → barra → (coluna da árvore) → `q-conteudo`, com o topo
 * como primeira coisa da coluna; o quadro e a pasta com a cadeia de altura.
 */
async function desenharAs6(caminho: string, mudou: Partial<Preferencias> = {}): Promise<string> {
  const [{ default: CaixaDeEntrada }, { default: Espaco }, { default: Pasta }, { default: Quadro }] =
    await Promise.all([
      import('@/pages/CaixaDeEntrada'),
      import('@/pages/Espaco'),
      import('@/pages/Pasta'),
      import('@/pages/Quadro'),
    ]);
  const guardado = escreverPreferencias({ ...PADRAO, ...mudou });
  vi.stubGlobal('window', {
    localStorage: { getItem: (k: string) => (k === CHAVE ? guardado : null) },
  });
  try {
    return renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: [caminho] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: '/meu-trabalho', element: createElement(MeuTrabalho) }),
          createElement(Route, { path: '/tarefas', element: createElement(TodasAsTarefas) }),
          createElement(Route, { path: '/avisos', element: createElement(CaixaDeEntrada) }),
          createElement(Route, { path: '/quadro/espaco/:espacoId', element: createElement(Espaco) }),
          createElement(Route, { path: '/quadro/pasta/:pastaId', element: createElement(Pasta) }),
          createElement(Route, { path: '/quadro/:listaId?', element: createElement(Quadro) }),
        ),
      ),
    );
  } finally {
    vi.unstubAllGlobals();
  }
}

const AS_SEIS = [
  { tela: 'Minhas tarefas', caminho: '/meu-trabalho', aceso: '/meu-trabalho', altura: false },
  { tela: 'Todas as tarefas', caminho: '/tarefas', aceso: '/tarefas', altura: false },
  { tela: 'Notificações', caminho: '/avisos', aceso: '/avisos', altura: false },
  { tela: 'Espaço', caminho: '/quadro/espaco/e1', aceso: null, altura: false },
  { tela: 'Pasta', caminho: '/quadro/pasta/p1', aceso: null, altura: true },
  { tela: 'Quadro', caminho: '/quadro/l1', aceso: null, altura: true },
] as const;

describe('F04: as seis telas montadas à mão vestem a moldura comum', () => {
  it.each(AS_SEIS)('$tela: grade → barra → coluna de conteúdo, com o topo primeiro', async ({ caminho, altura }) => {
    const html = await desenharAs6(caminho);
    const grade = aGrade(html);
    expect(grade).toContain('data-contexto="trabalho"');
    expect(grade).toContain('data-barra="icones-e-rotulos"');
    if (altura) expect(grade).toContain('data-altura="tela"');
    else expect(grade).not.toContain('data-altura');
    // Uma grade, uma barra, uma coluna de conteúdo — nada montado duas vezes.
    expect(html.match(/class="q-tela"/g)?.length).toBe(1);
    expect(html.match(/id="barra-lateral"/g)?.length).toBe(1);
    expect(html.match(/class="q-conteudo min-w-0[^"]*"/g)?.length).toBe(1);
    // A coluna vem DEPOIS da barra, e o topo é a primeira coisa dentro dela.
    const conteudo = html.slice(html.search(/class="q-conteudo min-w-0/));
    expect(html.indexOf('id="barra-lateral"')).toBeLessThan(html.search(/class="q-conteudo min-w-0/));
    expect(conteudo).toMatch(/^class="q-conteudo min-w-0[^"]*"><header class="o-topo/);
  });

  it.each(AS_SEIS)('$tela: o item certo da barra fica aceso', async ({ caminho, aceso }) => {
    const barra = soABarra(await desenharAs6(caminho));
    const acesos = barra.match(/<a[^>]*aria-current="page"[^>]*>/g) ?? [];
    if (aceso === null) {
      // Espaço, pasta e quadro não SÃO um dos atalhos — a árvore diz onde se está.
      expect(acesos.filter((a) => /href="\/(meu-trabalho|tarefas|avisos)"/.test(a))).toEqual([]);
    } else {
      expect(acesos.some((a) => a.includes(`href="${aceso}"`))).toBe(true);
    }
  });

  it.each(AS_SEIS)('$tela: árvore em coluna ligada abre a faixa e traz a saída', async ({ caminho }) => {
    const html = await desenharAs6(caminho, { arvoreEmColuna: true });
    expect(aGrade(html)).toContain('data-coluna="arvore"');
    // A coluna nunca fica sem saída: o mesmo botão devolve a árvore à barra.
    expect(botaoDaColuna(aColuna(html))).toContain('aria-label="Devolver a árvore para a barra"');
    // E ela mora ENTRE a barra e o conteúdo — não dentro dele.
    expect(html.indexOf('class="bl-coluna"')).toBeLessThan(html.search(/class="q-conteudo min-w-0/));
  });

  it('`Minhas tarefas` pinta as linhas pela própria coluna, sem embrulho a mais', async () => {
    const html = await desenharAs6('/meu-trabalho');
    expect(html).toContain('class="q-conteudo min-w-0 iw-trabalho"');
    expect(html.match(/iw-trabalho/g)?.length).toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   F06A — O CABEÇALHO DO QUADRO, DA PASTA E DO ESPAÇO.

   O nome do lugar é o título; a descrição longa recolhe SEM perder texto; a
   esteira vira contexto a um clique; as contagens são as de antes, escritas;
   a busca do filtro fala a língua do `CampoDeBusca`. O que depende do quadro
   carregado (efeito) está provado no navegador: `espacos-e-arrasto.mjs` F06A.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('F06A: cabeçalho do quadro, pasta e espaço', () => {
  const LONGA =
    'Campanhas e entregas recorrentes do cliente. Priorizar peças com prazo nesta semana. O cliente aprova por WhatsApp até quarta; tudo o que chegar depois entra na semana seguinte.\nContato: marketing.';

  it('o nome do lugar é o <h1>; a marca e o cliente ficam FORA dele, na mesma linha', () => {
    const html = renderToStaticMarkup(
      createElement(Topo, {
        titulo: 'Produção',
        marca: createElement('span', { className: 'cu-marca-espaco' }, 'P'),
        junto: createElement('span', { className: 'cu-selo-morto' }, 'arquivado'),
      }),
    );
    expect(html).toMatch(/<h1 class="o-titulo">Produção<\/h1>/);
    const linha = /<div class="o-topo-nome">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
    expect(linha.indexOf('cu-marca-espaco')).toBeLessThan(linha.indexOf('<h1'));
    expect(linha.indexOf('<h1')).toBeLessThan(linha.indexOf('arquivado'));
  });

  it('sem marca nem vizinho, o topo continua o mesmo HTML de antes', () => {
    const html = renderToStaticMarkup(createElement(Topo, { titulo: 'Minhas tarefas' }));
    expect(html).not.toContain('o-topo-nome');
    expect(html).toContain('<h1 class="o-titulo">Minhas tarefas</h1>');
  });

  it('descrição curta: inteira, sem botão', () => {
    const curta = 'Campanhas do cliente.';
    expect(descricaoLonga(curta)).toBe(false);
    const html = renderToStaticMarkup(createElement(DescricaoDaLista, { texto: curta }));
    expect(html).toContain(curta);
    expect(html).not.toContain('<button');
    expect(html).not.toContain('data-recolhida');
  });

  it('descrição longa: recolhida por padrão, com o TEXTO INTEIRO no HTML e o botão ligado a ela', () => {
    expect(descricaoLonga('x'.repeat(DESCRICAO_CURTA + 1))).toBe(true);
    expect(descricaoLonga('linha 1\nlinha 2')).toBe(true);
    const html = renderToStaticMarkup(createElement(DescricaoDaLista, { texto: LONGA }));
    expect(html).toContain('data-recolhida="true"');
    // Nada cortado no conteúdo: recolher é desenho, não texto a menos.
    expect(html).toContain('Contato: marketing.');
    expect(html).toContain('tudo o que chegar depois entra na semana seguinte.');
    const id = /<p id="([^"]+)" class="q-descricao-texto/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`aria-controls="${id}"`);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Ler descrição inteira');
  });

  it('a esteira: nome à vista, herança no título, balão fechado até o clique', () => {
    const html = renderToStaticMarkup(
      createElement(SobreAEsteira, { nome: 'Fluxo de criação', heranca: 'folder', rotuloDaHeranca: 'herdada da pasta' }),
    );
    expect(html).toContain('Fluxo de criação');
    expect(html).toContain('title="Conjunto de status: Fluxo de criação · herdada da pasta"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('cu-balao');
  });

  it('as contagens são as recebidas, com singular e a origem da pasta antes', () => {
    const html = renderToStaticMarkup(createElement(ContagemDoQuadro, { total: 18, abertas: 16, feitas: 2 }));
    expect(html.replace(/<[^>]+>/g, '')).toBe('18 tarefas · 16 em aberto · 2 concluídas');
    expect(html).toContain('data-aberto="true"');
    const um = renderToStaticMarkup(createElement(ContagemDoQuadro, { total: 1, abertas: 0, feitas: 1 }));
    expect(um.replace(/<[^>]+>/g, '')).toBe('1 tarefa · 0 em aberto · 1 concluída');
    expect(um).toContain('data-aberto="false"');
    const pasta = renderToStaticMarkup(
      createElement(ContagemDoQuadro, { total: 4, abertas: 4, feitas: 0, antes: '2 listas · 5 etapas' }),
    );
    expect(pasta.replace(/<[^>]+>/g, '')).toBe('2 listas · 5 etapas · 4 tarefas · 4 em aberto · 0 concluídas');
  });

  it('a busca do filtro usa a caixa comum (40 px, anel na caixa) e continua `textbox` com o mesmo nome', () => {
    const html = renderToStaticMarkup(
      createElement(BarraDeFiltro, {
        filtro: { texto: 'sabor', responsavel: null },
        aplicado: { texto: 'sabor', responsavel: null },
        opcoes: [],
        semResponsavel: 0,
        achadas: 3,
        total: 10,
        ocupado: false,
        aoMudar: () => {},
      }),
    );
    expect(html).toContain('class="iw-busca q-filtro-caixa" role="search"');
    expect(html).toContain('type="text"');
    expect(html).toContain('aria-label="Buscar tarefa pelo nome"');
    expect(html).toContain('class="iw-busca-limpar"');
    expect(html).toContain('3 de 10');
    const vazio = renderToStaticMarkup(
      createElement(BarraDeFiltro, {
        filtro: SEM_FILTRO, aplicado: SEM_FILTRO, opcoes: [], semResponsavel: 0, achadas: 10, total: 10, ocupado: false, aoMudar: () => {},
      }),
    );
    expect(vazio).not.toContain('iw-busca-limpar');
    expect(vazio).not.toContain('de 10');
  });
});

/* ───────────────────────────── F06B — cartão, linha e coluna ───────────────────────────── */

describe('F06B — o prazo se lê com palavra, e a data inteira fica para quem ouve', () => {
  const HOJE = { year: 2026, month: 9, day: 28 };
  const ler = (dueOn: string | null, completedAt: string | null = null) => lerPrazo({ dueOn, completedAt }, HOJE);

  it('sem prazo não inventa nada', () => {
    expect(ler(null)).toBeNull();
  });

  it('atrasada, hoje e amanhã dizem a palavra; o completo traz a data inteira', () => {
    expect(ler('2026-09-25')).toEqual({ estado: 'atrasada', curto: 'Atrasada · 25/09', completo: 'Prazo vencido em 25/09/2026' });
    expect(ler('2026-09-28')).toEqual({ estado: 'hoje', curto: 'Hoje', completo: 'Vence hoje, 28/09/2026' });
    expect(ler('2026-09-29')).toEqual({ estado: 'amanha', curto: 'Amanhã', completo: 'Vence amanhã, 29/09/2026' });
  });

  it('em breve (2 a 6 dias) muda o tom, e a data curta diz quando; depois disso é futura', () => {
    expect(ler('2026-10-02')).toEqual({ estado: 'embreve', curto: '02/10', completo: 'Vence em 4 dias, 02/10/2026' });
    expect(ler('2026-10-04')?.estado).toBe('embreve');
    expect(ler('2026-10-05')).toEqual({ estado: 'futura', curto: '05/10', completo: 'Prazo 05/10/2026' });
  });

  it('o ano só aparece quando não é o de hoje; concluída nunca vira alarme; ilegível diz o valor', () => {
    expect(ler('2027-01-10')?.curto).toBe('10/01/2027');
    expect(ler('2025-12-31')?.curto).toBe('Atrasada · 31/12/2025');
    expect(ler('2026-09-01', '2026-09-02T10:00:00Z')).toEqual({ estado: 'concluida', curto: '01/09', completo: 'Prazo 01/09/2026 — tarefa já concluída' });
    expect(ler('82025-08-07')?.estado).toBe('futura');
    expect(ler('lixo')).toEqual({ estado: 'ilegivel', curto: 'prazo ilegível', completo: 'Prazo ilegível — valor no banco: lixo' });
  });
});

describe('F06B — o cartão: hierarquia, cliente só quando diz algo, alvos com nomes próprios', () => {
  const HOJE = { year: 2026, month: 8, day: 26 };
  const cheia = {
    ...UMA_LINHA,
    title: 'Revisar carrossel',
    dueOn: '2026-08-20',
    priority: 'high' as const,
    clientId: 'cli-h',
    clientName: 'Horizonte Studio',
    assignees: [{ id: 'u1', name: 'Beatriz Nogueira' }],
    taskTypeName: 'Arte',
    hasDescription: true,
    hasAttachment: true,
    commentCount: 3,
    subtaskCount: 2,
    checklistDone: 1,
    checklistTotal: 3,
  };
  const cartao = (props: Record<string, unknown>) =>
    renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CorpoDoCartao, { tarefa: cheia, hoje: HOJE, ...props })));

  it('o prazo vem primeiro no rodapé, com a palavra e a data inteira em texto para leitor de tela', () => {
    const html = cartao({});
    expect(html).toContain('class="q-prazo" data-estado="atrasada" title="Prazo vencido em 20/08/2026"');
    expect(html).toContain('Atrasada · 20/08');
    expect(html).toContain('<span class="sr-only">Prazo vencido em 20/08/2026</span>');
    expect(html.indexOf('q-prazo')).toBeLessThan(html.indexOf('q-prioridade'));
    expect(html).not.toContain('style="color:var(--err)"');
  });

  it('os indicadores continuam, cada um com nome, sem a pílula de antes', () => {
    const html = cartao({});
    for (const nome of ['Tem descrição', 'Tem anexo', '3 comentários', '2 subtarefas', '1 de 3 itens do checklist']) {
      expect(html).toMatch(new RegExp(`class="q-indicador" role="img"[^>]*aria-label="${nome}"`));
    }
    expect(html).not.toContain('p-selo');
  });

  it('o tipo é texto leve, separado das etiquetas', () => {
    const html = cartao({});
    expect(html).toContain('<span class="q-tipo" title="Tipo de tarefa">Arte</span>');
  });

  it('o cliente some só quando é o mesmo que o topo da visão já mostra', () => {
    expect(cartao({})).toContain('class="q-cartao-cliente"');
    expect(cartao({ clienteDaVisao: 'cli-h' })).not.toContain('q-cartao-cliente');
    // Tarefa de OUTRO cliente na mesma lista: continua dizendo.
    expect(cartao({ clienteDaVisao: 'cli-outro' })).toContain('>Horizonte Studio</span>');
  });

  it('tarefa sem nome de cliente não ganha cliente deduzido', () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(CorpoDoCartao, { tarefa: { ...cheia, clientName: null }, hoje: HOJE, clienteDaVisao: null })),
    );
    expect(html).not.toContain('q-cartao-cliente');
  });

  it('abrir tarefa, abrir lista e ver responsáveis têm nomes diferentes', () => {
    const html = cartao({ lista: { id: 'l9', name: 'Audiovisual' } });
    expect(html).toContain('aria-label="Abrir a lista Audiovisual"');
    expect(html).toMatch(/<a class="q-titulo-cartao q-abre"[^>]*href="\/tarefa\/a1b2"/);
    expect(html).toContain('role="img" aria-label="Responsáveis: Beatriz Nogueira"');
  });

  it('sem data e sem responsável: nada de prazo nem avatar inventado', () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(CorpoDoCartao, { tarefa: UMA_LINHA, hoje: { year: 2026, month: 9, day: 1 } })),
    );
    // UMA_LINHA vence em 26/08: com hoje em 01/09 está atrasada — então troco a data.
    const sem = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(CorpoDoCartao, { tarefa: { ...UMA_LINHA, dueOn: null }, hoje: HOJE })),
    );
    expect(html).toContain('data-estado="atrasada"');
    expect(sem).not.toContain('q-prazo');
    expect(sem).not.toContain('q-avatar');
  });
});

describe('F06B — a linha usa a mesma leitura do prazo', () => {
  it('atrasada diz a palavra; a data inteira fica no título e para quem ouve', () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(LinhaDeTrabalho, { tarefa: UMA_LINHA, hoje: { year: 2026, month: 9, day: 1 } })),
    );
    expect(html).toContain('class="mt-prazo" data-estado="atrasada" title="Prazo vencido em 26/08/2026"');
    expect(html).toContain('Atrasada · 26/08');
  });
});

describe('F06B — coluna vazia pelo filtro não é coluna vazia', () => {
  const vazia = (props: { filtrada: boolean; total?: number }) => renderToStaticMarkup(createElement(ColunaVazia, props));

  it('sem filtro, ou com a etapa vazia de verdade, diz que não há tarefa', () => {
    expect(vazia({ filtrada: false, total: 0 })).toBe('<li class="q-coluna-vazia" data-motivo="vazia">Nenhuma tarefa nesta etapa.</li>');
    expect(vazia({ filtrada: true, total: 0 })).toContain('data-motivo="vazia"');
  });

  it('com filtro e tarefas na etapa, diz quantas e que o filtro as tirou', () => {
    expect(vazia({ filtrada: true, total: 5 })).toBe('<li class="q-coluna-vazia" data-motivo="filtro">Nenhuma das 5 bate com o filtro.</li>');
    expect(vazia({ filtrada: true, total: 1 })).toContain('A única tarefa daqui não bate com o filtro.');
    expect(vazia({ filtrada: true })).toContain('Nenhuma bate com a busca.');
  });

  it('o quadro por tipo passa o filtro adiante, e sem filtro não fala em busca', () => {
    const desenharQuadro = (filtrada: boolean) =>
      renderToStaticMarkup(
        createElement(MemoryRouter, null, createElement(QuadroPorTipo, { linhas: [], hoje: { year: 2026, month: 8, day: 26 }, filtrada })),
      );
    expect(desenharQuadro(false)).not.toContain('busca');
    expect(desenharQuadro(true)).toContain('Nenhuma bate com a busca.');
    expect(desenharQuadro(false)).not.toContain('Nada aqui');
  });
});
