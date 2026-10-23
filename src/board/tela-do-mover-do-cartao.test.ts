/**
 * MOVER A TAREFA DIRETO DO CARTÃO — o desenho. F17.63.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O PEDIDO
 *
 *   *"eu uso para mover algumas demandas para outra lista, sabe"* — com duas
 *   capturas do ClickUp: o `···` da tarefa com `Mover para`, e o seletor que
 *   ele abre (busca, `Recentes`, e a árvore de espaços abaixo).
 *
 * O QUE ESTE ARQUIVO PROVA, E O QUE ELE NÃO PROVA
 *
 *   Prova o DESENHO, sem navegador: que o `···` sai, que ele é um `<button>`
 *   (a metade da armadilha do arrasto que se responde sem pixel), que o
 *   seletor traz busca, `Recentes` e a árvore, e que o cartão SEM a `prop`
 *   continua exatamente o cartão de antes desta etapa.
 *
 *   NÃO prova que o balão fica por cima, que ele cabe numa janela de 720px,
 *   nem que arrastar o cartão continua movendo de coluna. As três são frases
 *   sobre PIXEL e sobre PONTEIRO, e um teste que fingisse medi-las estaria
 *   testando o próprio fingimento. Elas moram em
 *   `scripts/provar-mover-do-cartao.mjs`, no Chrome de verdade.
 *
 *   Também não prova que mover FUNCIONA: quem escreve é `ideworks.move_task`,
 *   e a recusa de um destino fora do alcance é do banco. Mesma sonda.
 *
 * SEM NAVEGADOR, E POR ISSO O BALÃO SAI NO LUGAR
 *   `Balao` só usa portal quando há `document`; em `node` ele devolve o corpo
 *   ali mesmo. É por isso que o balão aparece no HTML desta prova.
 *
 * ESCRITO EM `createElement`, E NÃO EM JSX
 *   A suíte só inclui `*.test.ts`. Um `.tsx` não seria executado, e teste que
 *   não roda é pior que teste nenhum porque conta como cobertura.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { acharListas } from '@/board/arvore';
import { type BoardTask, type Day, type TreeSpace } from '@/board/board';
import { CorpoDoCartao, type MoverDoCartao } from '@/board/CartaoDeTarefa';
import { SEM_PUXAR, podePuxar } from '@/board/rolagem';

const HOJE: Day = { year: 2026, month: 9, day: 3 };

const tarefa = (p: Partial<BoardTask> = {}): BoardTask => ({
  id: 'a1',
  title: '[A] SABOR DOCE - ARTE SACOLA',
  statusId: 's1',
  priority: null,
  dueOn: null,
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
  previewAttachmentId: null,
  previewCount: 0,
  ...p,
});

/** A árvore VIVA, na forma que o seletor fala. Duas empresas, de propósito. */
const ARVORE: TreeSpace[] = [
  {
    id: 'e1',
    name: 'Conteúdo',
    color: null,
    categoryName: 'Ide',
    lists: [{ id: 'l-aqui', name: 'Demandas', liveTasks: 7, totalTasks: 20 }],
    folders: [
      {
        id: 'f1',
        name: 'MIMI',
        lists: [{ id: 'l-mimi', name: 'Artes', liveTasks: 2, totalTasks: 5 }],
      },
    ],
  },
  {
    id: 'e2',
    name: 'Skills',
    color: null,
    categoryName: null,
    lists: [{ id: 'l-skills', name: 'Fila', liveTasks: 0, totalTasks: 3 }],
    folders: [],
  },
];

const mover = (p: Partial<MoverDoCartao> = {}): MoverDoCartao => ({
  arvore: ARVORE,
  recentes: [],
  listaAtual: 'l-aqui',
  aberto: false,
  desativado: false,
  aoAlternar: () => {},
  aoFechar: () => {},
  aoEscolher: () => {},
  ...p,
});

function desenhar(t: BoardTask, m?: MoverDoCartao): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(CorpoDoCartao, { tarefa: t, hoje: HOJE, mover: m }),
    ),
  );
}

/* ───────────────────────────── o `···` ───────────────────────────── */

describe('o `···` do cartão', () => {
  it('sai quando a página oferece o movimento', () => {
    const html = desenhar(tarefa(), mover());
    expect(html).toContain('q-cartao-acao');
    expect(html).toContain('aria-haspopup="menu"');
  });

  it('⚠️ NÃO sai sem a `prop` — o cartão de `Todas as tarefas` fica como estava', () => {
    // Aquele quadro agrupa por TIPO de status e o cartão de lá não se arrasta;
    // esta etapa não mexeu nele. Um `···` que aparecesse lá seria função nova
    // entregue sem ninguém ter medido a tela onde ela cai.
    const html = desenhar(tarefa());
    expect(html).not.toContain('q-cartao-acao');
    expect(html).not.toContain('Mover para');
  });

  it('diz de QUAL tarefa ele é — cinquenta na coluna, cinquenta nomes', () => {
    const html = desenhar(tarefa({ title: 'ARTE SACOLA' }), mover());
    expect(html).toContain('aria-label="Mover ARTE SACOLA para outra lista"');
  });

  it('fecha para quem lê a tela quando está fechado, e abre quando está aberto', () => {
    expect(desenhar(tarefa(), mover())).toContain('aria-expanded="false"');
    expect(desenhar(tarefa(), mover({ aberto: true }))).toContain('aria-expanded="true"');
  });

  it('espera o banco em vez de aceitar um segundo pedido', () => {
    expect(desenhar(tarefa(), mover({ desativado: true }))).toContain('disabled=""');
  });

  /**
   * ⚠️ A ARMADILHA (a) DA ETAPA, NA METADE QUE SE RESPONDE SEM NAVEGADOR.
   *
   * `podePuxar` (F17.25) recusa o gesto de rolagem sobre `button`, e é isso
   * que impede o `···` novo de transformar "mover um cartão" em "rolar a
   * tela". Provar que o elemento É um `button` é provar que ele cai naquela
   * lista — a lista em si tem prova própria em `rolagem.test.ts`.
   */
  it('É UM `button`, e por isso `podePuxar` já o recusa', () => {
    const html = desenhar(tarefa(), mover());
    expect(html).toMatch(/<button[^>]*class="cu-icone-btn"/);
    expect(SEM_PUXAR).toContain('button');
    expect(podePuxar({ closest: (s: string) => (s.includes('button') ? {} : null) })).toBe(false);
  });
});

/* ───────────────────────────── o seletor ───────────────────────────── */

describe('o seletor de destino', () => {
  const aberto = (p: Partial<MoverDoCartao> = {}) =>
    desenhar(tarefa(), mover({ aberto: true, ...p }));

  it('abre com título `Mover para` e o `X` de fechar — F17.33', () => {
    const html = aberto();
    expect(html).toContain('Mover para');
    expect(html).toContain('aria-label="Fechar"');
  });

  it('tem caixa de busca, como na captura', () => {
    expect(aberto()).toContain('aria-label="Buscar lista"');
  });

  /**
   * ⚠️ A ARMADILHA (o seletor vai ter 40 listas), na metade estrutural.
   *
   * `.cu-rolagem` é a caixa que rola dentro do balão, e o teto dela sai do
   * espaço medido até a borda da janela (F17.35). Sem esta caixa não há o que
   * rolar, e um menu de quarenta listas passa da tela. Que ela DE FATO role
   * numa janela de 720px é medida, e está na sonda.
   */
  it('a lista de destinos mora numa caixa que rola', () => {
    expect(aberto()).toContain('cu-rolagem');
  });

  it('desenha a árvore inteira, com espaço e pasta escritos', () => {
    const html = aberto();
    // F31: sem `Ide · ` na frente — `Conteúdo` não tem gêmeo em outra empresa.
    expect(html).toContain('>Conteúdo</div>');
    expect(html).not.toContain('Ide · ');
    expect(html).toContain('Skills');
    expect(html).toContain('MIMI / Artes');
  });

  it('marca onde a tarefa está hoje, em vez de esconder', () => {
    // Um menu de mover que some com a lista de origem obriga a pessoa a
    // lembrar de onde a coisa veio. Mesma decisão de `destinosDeLista`.
    expect(aberto()).toMatch(/aria-checked="true"[^>]*>[^<]*<svg[\s\S]*?Demandas/);
  });

  it('F31: o espaço de outra empresa com o MESMO nome leva a empresa no título', () => {
    const comGemeo: TreeSpace[] = [
      ...ARVORE,
      {
        id: 'e3',
        name: 'Conteúdo',
        color: null,
        categoryName: 'Ide Hub',
        lists: [{ id: 'l-hub', name: 'Fila', liveTasks: 1, totalTasks: 1 }],
        folders: [],
      },
    ];
    const html = desenhar(tarefa(), mover({ aberto: true, arvore: comGemeo }));
    expect(html).toContain('>Ide · Conteúdo</div>');
    expect(html).toContain('>Ide Hub · Conteúdo</div>');
    // `Skills` não tem gêmeo e continua sozinho.
    expect(html).not.toContain(' · Skills');
  });
});

/* ───────────────────────────── `Recentes` ───────────────────────────── */

describe('a seção `Recentes`', () => {
  const comRecentes = (ids: string[], listaAtual = 'l-aqui') =>
    desenhar(
      tarefa(),
      mover({ aberto: true, listaAtual, recentes: acharListas(ARVORE, ids) }),
    );

  it('não é desenhada quando não há destino nenhum', () => {
    // Um `Recentes` vazio é uma promessa vazia ocupando a primeira linha do
    // menu — e a primeira linha é a que a pessoa lê antes de decidir buscar.
    expect(desenhar(tarefa(), mover({ aberto: true }))).not.toContain('Recentes');
  });

  it('aparece com o caminho inteiro, e não só o nome', () => {
    // Duas listas `Demandas` em espaços diferentes é o caso normal aqui, e
    // `Recentes` tira justamente o cabeçalho de espaço que as separaria.
    const html = comRecentes(['l-mimi']);
    expect(html).toContain('Recentes');
    expect(html).toContain('Conteúdo / MIMI / Artes');
    expect(html).not.toContain('Ide · ');
  });

  it('a lista onde a tarefa JÁ está não é oferecida como destino', () => {
    const html = comRecentes(['l-aqui', 'l-skills']);
    // `Skills / Fila` continua; a de origem sai da seção — e continua marcada
    // lá embaixo, na árvore.
    expect(html).toContain('Skills / Fila');
    expect(html.split('Recentes')[1].split('cu-balao-titulo')[0]).not.toContain('Demandas');
  });

  /**
   * ⚠️ A METADE DO ACESSO QUE SE PROVA SEM BANCO — F17.63.
   *
   * O id lembrado mora no NAVEGADOR, e navegador não confere permissão. Quem
   * confere é a árvore, que já chegou recortada pela política de linha: um id
   * que não está nela não é achado por `acharListas`, e não vira linha de
   * menu. A seção não tem caminho próprio até o banco, e é essa ausência que
   * a faz herdar o alcance em vez de o repetir — o alcance foi corrigido em
   * quatro etapas esta semana (F17.32, F17.34, F17.54), e um segundo caminho
   * seria o que ficaria para trás na quinta.
   *
   * A outra metade — pedido montado à mão sendo recusado — é do banco, e está
   * em `scripts/provar-mover-do-cartao.mjs`.
   */
  it('LISTA FORA DO ALCANCE NÃO APARECE, nem por ter sido usada antes', () => {
    const html = comRecentes(['l-de-outra-empresa']);
    expect(html).not.toContain('Recentes');
    expect(html).not.toContain('l-de-outra-empresa');
  });
});
