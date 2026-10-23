/**
 * A TELA DA TAREFA ABRE — F17.10, refeita na F17.10b.
 *
 * POR QUE ESTE TESTE EXISTE
 *   Mesma razão de `tela-do-quadro.test.ts`: `typecheck` não pega import
 *   circular, componente indefinido, nem hook fora de ordem. Uma etapa cujo
 *   produto é uma tela que se abre não pode ser dada por pronta porque compilou.
 *
 *   Na F17.10b ele ganhou um segundo trabalho: guardar a FORMA. O usuário
 *   reprovou a etapa anterior por ela não se parecer com o ClickUp, e as peças
 *   dessa semelhança — as abas, os dois seletores, a fila de chips, o menu de
 *   prioridade com bandeira e `Limpar`, o seletor de data com dois campos mais
 *   atalhos mais calendário — são conferíveis no HTML produzido.
 *
 * SEM NAVEGADOR, E POR ISSO SEM `useEffect`
 *   A suíte roda em ambiente `node`, sem DOM, e com o isolamento de rede da F0.4
 *   ligado. `renderToStaticMarkup` monta a árvore e não roda efeito — então o
 *   que se prova aqui é o PRIMEIRO quadro.
 *
 *   Uma consequência a saber: o `EditorRico` PREENCHE o conteúdo num efeito, e
 *   por isso aqui ele sai com a barra de ferramentas e a caixa vazia. O texto
 *   dentro dele é do navegador — quem prova isso é `editor-rico.test.ts`, que
 *   testa a ida e a volta do markdown sem DOM nenhum.
 *
 * ESCRITO EM `createElement`, E NÃO EM JSX
 *   A suíte só inclui `*.test.ts`. Um `.tsx` não seria executado — e teste que
 *   não roda é pior que teste nenhum, porque conta como cobertura.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { type Board, CARTOES_POR_COLUNA } from '@/board/board';
import { SEM_FILTRO } from '@/board/filtro';
import { EditorRico } from '@/board/EditorRico';
import {
  MenuDeData,
  MenuDeEtiquetas,
  MenuDePessoas,
  MenuDePrioridade,
  MenuDeStatus,
} from '@/board/menus';
import { ModalDeTarefa } from '@/board/ModalDeTarefa';
import { AdicionarNaColuna } from '@/board/pecas-da-ficha';
import Tarefa from '@/pages/Tarefa';
import { Markdown } from '@/ui/Markdown';

function desenhar(caminho: string): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [caminho] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: '/tarefa/:tarefaId', element: createElement(Tarefa) }),
      ),
    ),
  );
}

const semRota = (elemento: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, elemento));

const QUADRO: Board = {
  header: {
    listId: '604ef3c5-a635-45f0-914b-087c47f9eb85',
    listName: 'Todas as demandas',
    listContent: null,
    folderId: null,
    folderName: null,
    spaceId: 'aaaaaaaa-0000-0000-0000-000000000000',
    spaceName: 'Demandas',
    categoryName: 'Ide',
    statusSetName: 'Demandas',
    inheritedFrom: 'space',
  },
  statuses: [
    { id: 's1', name: 'a fazer', type: 'open', color: '#d3d3d3', sortOrder: 0 },
    { id: 's2', name: 'concluída', type: 'closed', color: '#6bc950', sortOrder: 1 },
  ],
  tasks: [],
  availableTags: [],
  columnTotals: {},
  columnMatched: {},
  perColumn: CARTOES_POR_COLUNA,
  assigneeOptions: [],
  unassignedTasks: 0,
  filter: SEM_FILTRO,
};

const HOJE = { year: 2026, month: 8, day: 25 };

/* ───────────────────────────── a página ───────────────────────────── */

describe('a página da tarefa monta', () => {
  it('com id na URL, monta sem estourar', () => {
    expect(() => desenhar('/tarefa/604ef3c5-a635-45f0-914b-087c47f9eb85')).not.toThrow();
  });

  /**
   * ⚠️ ELA MONTA COM A ÁRVORE E O DIRETÓRIO SEM RESPOSTA — F17.CARGA03.
   *
   * A tarefa 5 da fase: a ficha continua utilizável sem esperar árvore, imagens
   * ou menus auxiliares. Este é o quadro em que isso é mais fácil de quebrar —
   * a primeira montagem, com as duas consultas compartilhadas ainda em branco
   * (aqui não há efeito, e portanto não há resposta para nenhuma delas).
   *
   * O que se exige é a MOLDURA de trabalho inteira: o topo aderente, com o
   * título, e o X que fecha respeitando texto não salvo. Nenhum deles pode
   * depender de dado que ainda não chegou. (Até a F29 a lista tinha também o
   * `‹ Voltar` da moldura; desde a Fase 4 a ficha fica só com o X — ver o caso
   * logo abaixo.)
   */
  it('a moldura de trabalho aparece sem árvore e sem diretório — F17.CARGA03', () => {
    const html = desenhar('/tarefa/604ef3c5-a635-45f0-914b-087c47f9eb85');
    expect(html).toMatch(/<header class="o-topo[^"]*\bt-cabeca\b/);
    expect(html).toContain('aria-label="Fechar tarefa e voltar"');
    // E nenhuma faixa de erro por causa das leituras que ainda não voltaram:
    // sem árvore some só o menu de lista; sem diretório, só as opções de gente.
    expect(html).not.toContain('Não foi possível carregar os espaços');
  });

  /**
   * O MENU DE MUDAR DE LISTA NASCE FECHADO — e é por isso que a fase 3 pôde
   * tirar a árvore que só ele consumia.
   *
   * ⚠️ ESTE CASO GUARDA A PREMISSA, e não o ganho. Se um dia o menu passar a
   * desenhar aberto — ou a montar escondido —, os destinos voltam a ser
   * necessários na abertura, e a decisão desta fase precisa ser reexaminada.
   * O caso falha, e quem mexer lê o porquê aqui.
   */
  it('o menu de mudar de lista não é desenhado na abertura — F17.CARGA03', () => {
    const html = desenhar('/tarefa/604ef3c5-a635-45f0-914b-087c47f9eb85');
    expect(html).not.toContain('aria-label="Buscar lista"');
    expect(html).not.toContain('Nenhuma lista ao seu alcance');
  });

  /**
   * A VOLTA MUDOU DE FORMA DUAS VEZES, e não de existência.
   *
   * Era um `<a href="/quadro">← Quadro</a>` à direita do título, só desta tela.
   * A F17.33 a trocou pela peça única de `PaginaLarga` — `‹ Voltar`, acima do
   * título. A F29 (Fase 4) tirou o `‹ Voltar`: o Wesley achou que ele
   * confundia "anterior" com "acima", e escolheu que a trilha o substitui. A
   * ficha fica só com o X — e o destino dele é o mesmo que o Voltar tinha:
   * aqui, sem navegador e portanto sem histórico, `comoVoltar` cai no lugar
   * acima, que enquanto a tarefa não chegou do banco é `/quadro` (e, com ela,
   * o quadro da lista dela — `destinoAcima` em `trilha.test.ts`).
   */
  it('desenha o topo com o título, e nenhum `‹ Voltar` — F29', () => {
    const html = desenhar('/tarefa/604ef3c5-a635-45f0-914b-087c47f9eb85');
    expect(html).toMatch(/<h1 class="o-titulo[^"]*">Tarefa<\/h1>/);
    expect(html).not.toContain('>Voltar</button>');
    // A marca saiu do título: ela mora no alto da barra (F29.1).
    expect(html).not.toMatch(/<h1[^>]*>[\s\S]*?>ide<[\s\S]*?<\/h1>/);
    // A linha da trilha fica reservada enquanto a tarefa não chegou.
    expect(html).toContain('o-topo-trilha');
  });

  /**
   * O X QUE FECHA A FICHA — F17.78.
   *
   * O pedido veio com a captura do ClickUp: o X no canto superior direito da
   * tarefa. Aqui ele é a MESMA peça `Voltar`, no modo `close`, à direita da
   * trilha — e a ordem no HTML é a posição na tela, então o que se confere é
   * que ele vem DEPOIS da trilha.
   *
   * ⚠️ A trilha só desenha quando a tarefa chegou, e este é o PRIMEIRO quadro,
   * sem efeito e sem banco: `tr-trilha` pode não existir. Nesse caso a âncora
   * é o título do topo (F29) — o X é uma ação do topo, à direita dele, e vem
   * depois do título de qualquer jeito.
   *
   * E o ícone é o desenhado à mão (`IconeFechar`, em `@/ui/Icones`): a
   * primeira versão importava o X de uma biblioteca de ícones, e seria o
   * primeiro uso dela em `src/` — contra a regra do cabeçalho de `Icones.tsx`.
   * Só `aria-label`, sem `title` — igual ao X do modal.
   */
  it('desenha o X que fecha a ficha, depois da trilha, à mão e sem `title` — F17.78', () => {
    const html = desenhar('/tarefa/604ef3c5-a635-45f0-914b-087c47f9eb85');
    const rotulo = 'aria-label="Fechar tarefa e voltar"';
    expect(html).toContain(rotulo);

    const posicaoDoX = html.indexOf(rotulo);
    const posicaoDaTrilha = html.indexOf('tr-trilha');
    if (posicaoDaTrilha >= 0) {
      expect(posicaoDoX).toBeGreaterThan(posicaoDaTrilha);
    } else {
      expect(posicaoDoX).toBeGreaterThan(html.indexOf('>Tarefa</h1>'));
    }

    expect(html).not.toContain('lucide');
    const botaoDoX = /<button[^>]*aria-label="Fechar tarefa e voltar"[^>]*>/.exec(html)?.[0] ?? '';
    expect(botaoDoX).not.toBe('');
    expect(botaoDoX).not.toContain('title=');
    // O mesmo traço do X do modal (`@/board/menus`), dentro do botão.
    expect(html).toContain('d="M6 6l12 12M18 6L6 18"');
  });

  /**
   * O X NÃO SAI DA JANELA — F17.AUD07 (achado 9 da auditoria).
   *
   * Sem DOM não há rolagem para medir; o que se prova aqui é a ESTRUTURA que
   * a medição no Chrome depende: o X está DENTRO do cabeçalho `.t-cabeca`, e
   * antes do cartão da ficha — e a regra CSS desse cabeçalho é `sticky` no
   * topo, com número de camada abaixo de todo menu (`.cu-balao`, 120), janela
   * (`.o-scrim`, 100) e gaveta (91), e com fundo de token, não de cor literal.
   * A prova em navegador real (1440 e 390, claro e escuro) fica no plano.
   */
  it('o X mora num cabeçalho aderente, abaixo dos menus e das janelas — F17.AUD07', () => {
    const html = desenhar('/tarefa/604ef3c5-a635-45f0-914b-087c47f9eb85');
    // F29: o cabeçalho aderente é o `Topo`, com a classe `t-cabeca` a mais.
    const cabecalho = html.search(/<header class="o-topo[^"]*\bt-cabeca\b/);
    const x = html.indexOf('aria-label="Fechar tarefa e voltar"');
    expect(cabecalho).toBeGreaterThanOrEqual(0);
    expect(x).toBeGreaterThan(cabecalho);
    // Entre o cabeçalho e o X não começa o cartão da ficha: o X é do cabeçalho.
    const entre = html.slice(cabecalho, x);
    expect(entre).not.toContain('cu-ficha');

    const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const css = readFileSync(join(RAIZ, 'src', 'ui', 'tarefa.css'), 'utf8');
    const inicio = css.indexOf('.t-cabeca {');
    expect(inicio).toBeGreaterThanOrEqual(0);
    const regra = css.slice(inicio, css.indexOf('}', inicio));
    expect(regra).toMatch(/position:\s*sticky/);
    expect(regra).toMatch(/top:\s*0\b/);
    const camada = Number(/z-index:\s*(\d+)/.exec(regra)?.[1]);
    expect(camada).toBeGreaterThanOrEqual(1);
    // Abaixo da menor camada flutuante do sistema: a gaveta da barra lateral (90).
    expect(camada).toBeLessThan(90);
    expect(regra).toMatch(/background:\s*var\(--/);
    expect(regra).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});

/* ───────────────────────────── o modal ───────────────────────────── */

describe('o modal de tarefa nova tem a FORMA do ClickUp', () => {
  const html = semRota(
    createElement(ModalDeTarefa, {
      quadro: QUADRO,
      arvore: [],
      aoFechar: () => {},
      aoCriar: () => {},
    }),
  );

  it('é modal, e não página', () => {
    expect(html).toContain('cu-fundo');
    expect(html).toContain('cu-modal');
    expect(html).toContain('aria-modal="true"');
  });

  it('tem a aba `Tarefa` — e NÃO tem `Lembrete`, que é outra entidade', () => {
    expect(html).toContain('role="tablist"');
    expect(html).toContain('>Tarefa<');
    expect(html).not.toContain('Lembrete');
  });

  it('tem minimizar e fechar no canto', () => {
    expect(html).toContain('aria-label="Minimizar"');
    expect(html).toContain('aria-label="Fechar"');
  });

  it('tem o seletor de lista, mostrando a lista atual', () => {
    expect(html).toContain('cu-seletor');
    expect(html).toContain('Todas as demandas');
  });

  it('tem o título grande, sem prometer o `/` que não existe', () => {
    expect(html).toContain('cu-titulo');
    expect(html).toContain('placeholder="Nome da Tarefa"');
    // O TÍTULO não cita a barra: ele não tem menu de comandos, e prometer
    // atalho que não responde é pior do que não mencioná-lo. Quem ganhou o `/`
    // na F17.16 foi a DESCRIÇÃO — e lá o convite está escrito, ver abaixo.
    expect(html).toContain('placeholder="Nome da Tarefa"');
  });

  it('tem a descrição em EDITOR RICO, e nenhuma caixa de markdown', () => {
    expect(html).toContain('cu-editor');
    expect(html).toContain('Adicione uma descrição');
    // A caixa de markdown da F17.10 era um `textarea` com a classe `t-editor`.
    expect(html).not.toContain('t-editor');
    expect(html).not.toContain('Escreva em markdown');
  });

  /*
    F17.16 — O MODAL NASCE LIMPO.

    O usuário abriu a tela publicada ao lado do ClickUp dele e apontou a faixa
    `Aa | B I S </> | • 1. ☑ | 🔗 ▦ ❝ — 🙂`, que ocupava uma linha inteira o
    tempo todo: *"no ClickUp o modal é limpo"*.

    Este teste guarda o estado NORMAL — sem seleção, sem `/` digitado. A barra
    de formatação não pode estar aqui. Ela vive agora dentro de um `.cu-balao`
    que só nasce ancorado na seleção, e o que prova que nenhum comando dela se
    perdeu é `barra-de-comandos.test.ts`, sobre o catálogo de onde ela é
    desenhada.
  */
  it('F17.16: NÃO tem faixa de formatação no estado normal', () => {
    expect(html).not.toContain('cu-ferramentas');
    expect(html).not.toContain('cu-bolha');
    expect(html).not.toContain('Negrito');
    // A caixa que ancora o que flutua existe; o que flutua, não.
    expect(html).toContain('cu-editor-caixa');
    expect(html).not.toContain('cu-flutua');
  });

  it('F17.16: a descrição convida o `/`, e o `/` responde', () => {
    // O convite só pode estar escrito porque o menu existe — ver
    // `barra-de-comandos.ts`. Prometer e não responder é o que a F17.10b
    // recusou fazer no título, e continua recusando lá.
    expect(html).toContain("digite &#x27;/&#x27; para inserir");
  });

  it('tem a fila de chips: status, responsável, data, prioridade e `···`', () => {
    expect(html).toContain('cu-chips');
    /*
      ⚠️ ESTA LINHA DIZIA `A FAZER`, EM VERSALETE, E MUDOU NA F17.20.

      O nome do status vem da origem em minúscula (`a fazer`), e o chip o
      escrevia com `.toUpperCase()`. Versalete é a marca visual que aquela etapa
      tirou do sistema inteiro — as colunas do quadro saíram dela pela folha, e
      o chip por `emFrase`, porque `::first-letter` não vale em elemento de
      linha.

      O que o teste guarda continua o mesmo: o chip de status traz o NOME do
      status, e não um rótulo genérico. A segunda asserção é nova e guarda a
      decisão: ele não volta a gritar.
    */
    expect(html).toContain('A fazer');
    expect(html).not.toContain('A FAZER');
    expect(html).toContain('Responsável');
    expect(html).toContain('Data de vencimento');
    expect(html).toContain('Prioridade');
    // Cinco fichas na fila: as quatro nomeadas mais o `···`. A sexta é a do
    // CLIENTE, ao lado da lista (F38, Fase 7) — ver o bloco do cliente abaixo.
    expect(html.match(/class="cu-chip"/g)?.length).toBe(6);
    expect(html.match(/data-cliente-da-criacao=/g)?.length).toBe(1);
  });

  it('a cor do status entra como VARIÁVEL, nunca como classe — D10', () => {
    expect(html).toContain('--cor-status:#d3d3d3');
  });

  it('tem o rodapé com `Criar Tarefa` e a seta de menu ao lado', () => {
    expect(html).toContain('cu-rodape');
    expect(html).toContain('Criar Tarefa');
    expect(html).toContain('aria-label="Opções de criação"');
  });
});

/* ───────────────────────────── os menus ───────────────────────────── */

describe('o menu de prioridade', () => {
  const html = semRota(
    createElement(MenuDePrioridade, { valor: null, aoEscolher: () => {}, aoFechar: () => {} }),
  );

  it('tem as quatro na ordem da urgência, e o `Limpar` depois de um fio', () => {
    const ordem = ['Urgente', 'Alta', 'Normal', 'Baixa', 'Limpar'];
    let onde = -1;
    for (const palavra of ordem) {
      const i = html.indexOf(palavra);
      expect(i).toBeGreaterThan(onde);
      onde = i;
    }
    expect(html).toContain('cu-sep');
  });

  it('cada uma tem bandeira colorida, e a cor sai de token', () => {
    expect(html).toContain('--cor-bandeira:var(--err)');
    expect(html).toContain('--cor-bandeira:var(--warn)');
    expect(html).toContain('--cor-bandeira:var(--luz-ia)');
    expect(html).toContain('--cor-bandeira:var(--mute)');
  });
});

describe('o seletor de data', () => {
  const html = semRota(
    createElement(MenuDeData, {
      inicio: '',
      vencimento: '',
      hoje: HOJE,
      aoMudar: () => {},
      aoFechar: () => {},
    }),
  );

  it('tem os DOIS campos', () => {
    expect(html).toContain('Data inicial');
    expect(html).toContain('Data de vencimento');
  });

  it('tem a coluna de atalhos, com o dia da semana à direita', () => {
    for (const a of [
      'Hoje',
      'Amanhã',
      'Este final de semana',
      'Semana que vem',
      'Próximo final de semana',
      '2 semanas',
      '4 semanas',
    ]) {
      expect(html).toContain(a);
    }
    // 2026-08-29 é sábado — o dia da semana acompanha o atalho.
    expect(html).toContain('sáb');
  });

  it('NÃO tem `Mais tarde` — `due_on` é `date`, sem hora', () => {
    expect(html).not.toContain('Mais tarde');
  });

  it('tem o calendário com mês, ano, cabeçalho em português e o dia de hoje', () => {
    expect(html).toContain('agosto 2026');
    expect(html).toContain('>do<');
    expect(html).toContain('>2ª<');
    expect(html).toContain('>sá<');
    expect(html).toContain('data-hoje="true"');
    expect(html).toContain('aria-label="Mês anterior"');
  });

  it('abre no mês do prazo do ano 82025 sem estourar', () => {
    const torto = semRota(
      createElement(MenuDeData, {
        inicio: '',
        vencimento: '82025-08-07',
        hoje: HOJE,
        aoMudar: () => {},
        aoFechar: () => {},
      }),
    );
    expect(torto).toContain('agosto 82025');
    expect(torto).toContain('data-escolhido="true"');
  });
});

describe('o seletor de responsável', () => {
  const html = semRota(
    createElement(MenuDePessoas, {
      diretorio: [
        { id: 'a', name: 'Ana' },
        { id: 'b', name: 'wesley@ide.com' },
      ],
      escolhidos: ['a'],
      meuId: 'b',
      aoMudar: () => {},
      aoFechar: () => {},
    }),
  );

  it('tem o campo de busca no topo, com o texto da referência', () => {
    expect(html).toContain('Busque ou insira o e-mail');
  });

  it('tem a seção `Pessoas` com `Eu` no topo', () => {
    expect(html).toContain('Pessoas');
    expect(html.indexOf('>Eu<')).toBeLessThan(html.indexOf('Ana'));
  });

  it('cada pessoa tem avatar com iniciais e cor', () => {
    expect(html).toContain('cu-avatar');
    expect(html).toContain('--cor-pessoa:var(');
  });

  it('quem está escolhido sai MARCADO, e não só colorido', () => {
    expect(html).toContain('aria-checked="true"');
  });

  it('diz a verdade sobre os oito perfis — a trava da F4.8', () => {
    expect(html).toContain('Só aparece quem tem acesso ao IDE Works');
  });

  it('NÃO tem a seção `Equipes` da referência — grupo não existe no modelo', () => {
    expect(html).not.toContain('Equipes');
  });
});

describe('o menu de status', () => {
  it('mostra a esteira com o ponto na cor do ClickUp', () => {
    const html = semRota(
      createElement(MenuDeStatus, {
        statuses: QUADRO.statuses,
        valor: 's1',
        aoEscolher: () => {},
        aoFechar: () => {},
      }),
    );
    expect(html).toContain('a fazer');
    expect(html).toContain('concluída');
    expect(html).toContain('--cor-status:#6bc950');
  });
});

describe('o menu de etiquetas', () => {
  it('sem etiqueta no espaço, diz que a primeira nasce ali', () => {
    const html = semRota(
      createElement(MenuDeEtiquetas, {
        disponiveis: [],
        escolhidas: [],
        aoMudar: () => {},
        aoFechar: () => {},
      }),
    );
    expect(html).toContain('A primeira nasce aqui');
  });

  it('sem espaço não oferece criar — não há onde a etiqueta morar', () => {
    const html = semRota(
      createElement(MenuDeEtiquetas, {
        disponiveis: [],
        escolhidas: [],
        aoMudar: () => {},
        aoFechar: () => {},
      }),
    );
    expect(html).not.toContain('Etiqueta nova');
  });
});

/* ───────────────────────────── o editor ───────────────────────────── */

describe('o editor rico', () => {
  const html = semRota(
    createElement(EditorRico, { valorInicial: '# oi', semente: 1, aoMudar: () => {} }),
  );

  it('é um `contenteditable`, e não um `textarea` de markdown', () => {
    expect(html).toContain('contenteditable="true"');
    expect(html).toContain('role="textbox"');
    expect(html).not.toContain('<textarea');
  });

  /*
    A LISTA DE COMANDOS SAIU DAQUI, E NÃO SE PERDEU.

    Até a F17.16 esta conferência lia a faixa fixa do HTML. A faixa saiu do
    estado normal — pedido do usuário —, e com ela saiu a única coisa que este
    teste sabia olhar: sem seleção não há bolha, e sem bolha não há rótulo no
    primeiro desenho.

    A conferência foi para onde a verdade passou a morar: os DOIS catálogos de
    `barra-de-comandos.ts`, de onde a bolha e o menu `/` são desenhados. Ver
    `barra-de-comandos.test.ts` — ele confere que os doze comandos continuam
    alcançáveis e que os quatro atalhos continuam respondendo.

    O que se prova AQUI é o que só o HTML mostra: no estado normal, nada disso
    aparece na tela.
  */
  it('F17.16: nenhum rótulo de formatação no estado normal', () => {
    for (const t of ['Negrito', 'Itálico', 'Riscado', 'Tabela', 'Regra horizontal', 'Emoji']) {
      expect(html).not.toContain(t);
    }
    expect(html).not.toContain('cu-bolha');
  });

  it('NÃO existe `dangerouslySetInnerHTML` no caminho — a caixa nasce vazia', () => {
    // O conteúdo entra por `createElement` num efeito. Se um dia alguém trocar
    // isso por HTML cru, o `# oi` apareceria aqui no primeiro desenho.
    expect(html).not.toContain('<h1');
  });

  it('desativado, não é editável', () => {
    const travado = semRota(
      createElement(EditorRico, {
        valorInicial: '',
        semente: 1,
        aoMudar: () => {},
        desativado: true,
      }),
    );
    expect(travado).toContain('contenteditable="false"');
    expect(travado).not.toContain('cu-ferramentas');
  });
});

/* ───────────────────────────── o briefing desenhado ───────────────────────────── */

describe('o renderizador do briefing', () => {
  it('título, tabela, caixa e link saem desenhados', () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, {
        fonte: [
          '# Título',
          '',
          '| a | b |',
          '| --- | --- |',
          '| 1 | 2 |',
          '',
          '- [x] feito',
          '',
          '[link](https://exemplo.com)',
        ].join('\n'),
      }),
    );
    expect(html).toContain('<h1');
    expect(html).toContain('<table');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('href="https://exemplo.com"');
    // Link externo nunca sem `noopener noreferrer`.
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('NÃO existe HTML injetado: `<script>` do briefing sai escapado', () => {
    // É a decisão de segurança da etapa. Se um dia alguém trocar a árvore por
    // `dangerouslySetInnerHTML`, este teste é o que grita.
    const html = renderToStaticMarkup(
      createElement(Markdown, { fonte: '<script>roubar()</script>' }),
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('descrição vazia diz que está vazia', () => {
    expect(renderToStaticMarkup(createElement(Markdown, { fonte: '' }))).toContain('Sem descrição');
  });
});

/* ───────────────────────────── a coluna do quadro ───────────────────────────── */

describe('o `+ Adicionar tarefa` da coluna do quadro', () => {
  it('começa fechado — uma caixa de texto aberta em cada coluna vira um formulário', () => {
    const html = semRota(
      createElement(AdicionarNaColuna, { statusId: 's1', aoCriar: async () => true }),
    );
    expect(html).toContain('+ Adicionar tarefa');
    expect(html).not.toContain('<textarea');
  });
});

/* ───────────────────────────── a D10 ───────────────────────────── */

describe('A D10 NA TELA: nenhuma cor literal do Tailwind no que ela desenha', () => {
  // Mesma rede de `tela-do-quadro.test.ts`. Olha o HTML PRODUZIDO, e não a
  // fonte — é o que sobra depois de toda condicional.
  const PALETA_DO_TAILWIND =
    /\b(?:bg|text|border|from|to|via|fill|stroke|ring|divide|shadow|outline|decoration|accent|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;

  it('a ficha da tarefa', () => {
    expect(desenhar('/tarefa/604ef3c5-a635-45f0-914b-087c47f9eb85')).not.toMatch(
      PALETA_DO_TAILWIND,
    );
  });

  it('o modal de tarefa nova', () => {
    const html = semRota(
      createElement(ModalDeTarefa, {
        quadro: QUADRO,
        arvore: [],
        aoFechar: () => {},
        aoCriar: () => {},
      }),
    );
    expect(html).not.toMatch(PALETA_DO_TAILWIND);
  });

  it('os menus', () => {
    for (const menu of [
      createElement(MenuDePrioridade, { valor: null, aoEscolher: () => {}, aoFechar: () => {} }),
      createElement(MenuDeData, {
        inicio: '',
        vencimento: '',
        hoje: HOJE,
        aoMudar: () => {},
        aoFechar: () => {},
      }),
      createElement(MenuDePessoas, {
        diretorio: [{ id: 'a', name: 'Ana' }],
        escolhidos: [],
        meuId: null,
        aoMudar: () => {},
        aoFechar: () => {},
      }),
    ]) {
      expect(semRota(menu)).not.toMatch(PALETA_DO_TAILWIND);
    }
  });

  it('o briefing desenhado', () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, { fonte: '# a\n\n| x |\n| --- |\n| 1 |' }),
    );
    expect(html).not.toMatch(PALETA_DO_TAILWIND);
  });
});
