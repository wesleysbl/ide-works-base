/**
 * O CARD EM DUAS COLUNAS — F43, Fase 6.
 *
 * O QUE ESTE TESTE GUARDA
 *   A ficha saiu de `pages/Tarefa.tsx` para `FichaDaTarefa`, e ganhou três
 *   coisas que quebram calado:
 *     · a ORDEM do documento — a de uma coluna, que é também a ordem do Tab
 *       (título, propriedades, briefing… conversa). As duas colunas são só
 *       posição de grade (`tarefa.css`), e o teste confere as duas metades: o
 *       HTML na ordem certa e a folha com a regra que põe `.t-lado` à direita;
 *     · a linha "+ Subtarefa · + Checklist · + Anexo" no lugar das seções
 *       vazias — e, com ela, a linha de criação de subtarefa que deixou de
 *       nascer aberta em toda tarefa sem subtarefa;
 *     · o vocabulário: "Etapa", "sem etapas", "etapas de …" — nada de
 *       "esteira" na ficha — e o contrato de salvar no `?`, não mais à vista.
 *
 * SEM NAVEGADOR, E POR ISSO COM `tarefaInicial`
 *   `renderToStaticMarkup` não roda efeito, e a ficha lê a tarefa num efeito.
 *   `tarefaInicial` é a porta para o primeiro quadro — o mesmo desenho de
 *   `execucoesIniciais` na conversa. A página não a usa.
 *
 * ESCRITO EM `createElement`, E NÃO EM JSX: a suíte só inclui `*.test.ts`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { EXPLICACAO_DO_SALVAR, FichaDaTarefa, SOBRE_O_SALVAR } from '@/board/FichaDaTarefa';
import type { TaskDetail } from '@/board/ficha';
import { SEM_PROGRESSO, type Subtask } from '@/board/passos';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const FICHA: TaskDetail = {
  id: '604ef3c5-a635-45f0-914b-087c47f9eb85',
  title: 'Revisar carrossel da campanha',
  description: 'Carrossel de 6 telas.',
  listId: 'l1',
  listName: 'Criação',
  folderId: null,
  folderName: null,
  spaceId: 's1',
  spaceName: 'Horizonte Studio',
  categoryName: 'Ide',
  statusId: 'st1',
  priority: null,
  dueOn: null,
  startOn: null,
  customItemId: null,
  taskTypeId: null,
  taskTypeName: null,
  taskTypeMissing: false,
  clientId: null,
  clientName: null,
  assignees: [],
  watchers: [],
  tags: [],
  completedAt: null,
  completedBy: null,
  archivedAt: null,
  createdBy: { id: 'z', name: 'Wesley' },
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
  statuses: [
    { id: 'st1', name: 'a fazer', type: 'open', color: '#d3d3d3', sortOrder: 0 },
    { id: 'st2', name: 'concluída', type: 'closed', color: '#6bc950', sortOrder: 1 },
  ],
  statusSetName: 'Produção',
  inheritedFrom: 'space',
  availableTags: [],
  availableTypes: [],
  parentId: null,
  parentTitle: null,
  subtasks: [],
  checklists: [],
  comments: [],
  attachments: [],
  links: [],
  history: [],
  progress: SEM_PROGRESSO,
};

const SUB: Subtask = {
  id: 'f1',
  title: 'Separar as fotos do ensaio',
  statusId: 'st1',
  statusName: 'a fazer',
  statusColor: '#d3d3d3',
  statusType: 'open',
  priority: null,
  dueOn: null,
  completedAt: null,
  archivedAt: null,
  assignees: [],
  subtaskCount: 0,
};

const desenhar = (tarefa: TaskDetail): string =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(FichaDaTarefa, {
        tarefaId: tarefa.id,
        tarefaInicial: tarefa,
        cabecalho: (t: TaskDetail | null) =>
          createElement('header', { className: 'cabecalho-de-teste' }, t?.title ?? 'abrindo'),
      }),
    ),
  );

/* ───────────────────────────── a forma ───────────────────────────── */

describe('a ficha extraída desenha o que a página desenhava', () => {
  const html = desenhar(FICHA);

  it('o cabeçalho de quem hospeda vem ANTES da ficha, e recebe a tarefa', () => {
    const cab = html.indexOf('class="cabecalho-de-teste"');
    expect(cab).toBeGreaterThanOrEqual(0);
    expect(cab).toBeLessThan(html.indexOf('class="cu-ficha"'));
    expect(html).toContain('>Revisar carrossel da campanha</header>');
  });

  it('as âncoras dos testes e dos e2e continuam: `.cu-trilha` com Salvar, o título, `dt`, `data-prop`, carimbos', () => {
    expect(html).toMatch(/<div class="cu-trilha" data-por-salvar="false">[\s\S]*?>Salvar<\/button>/);
    expect(html).toContain('aria-label="Título da tarefa"');
    expect(html).toContain('<dl class="t-props">');
    expect(html).toContain('data-prop="tipo"');
    expect(html).toContain('data-prop="cliente"');
    expect(html).toContain('class="cu-carimbos"');
  });

  it('a ORDEM do documento é a de uma coluna: título, propriedades, briefing, conversa', () => {
    const titulo = html.indexOf('aria-label="Título da tarefa"');
    const props = html.indexOf('<dl class="t-props">');
    const carimbos = html.indexOf('class="cu-carimbos"');
    const briefing = html.indexOf('class="cu-ficha-corpo"');
    const conversa = html.indexOf('class="c-bloco"');
    expect(titulo).toBeLessThan(props);
    expect(props).toBeLessThan(carimbos);
    expect(carimbos).toBeLessThan(briefing);
    expect(briefing).toBeLessThan(conversa);
  });

  it('propriedades e carimbos moram juntos em `.t-lado` — a coluna da direita quando a ficha é larga', () => {
    const lado = html.slice(html.indexOf('<div class="t-lado">'), html.indexOf('class="cu-ficha-corpo"'));
    expect(lado).toContain('<dl class="t-props">');
    expect(lado).toContain('class="cu-carimbos"');
  });

  it('a conversa mora DENTRO da ficha, no corpo — e não mais num bloco abaixo do cartão', () => {
    const corpo = html.indexOf('<div class="t-corpo">');
    const fimDaFicha = html.lastIndexOf('</section>');
    const conversa = html.indexOf('class="c-bloco"');
    expect(corpo).toBeGreaterThanOrEqual(0);
    expect(conversa).toBeGreaterThan(corpo);
    expect(conversa).toBeLessThan(fimDaFicha);
  });
});

/* ───────────────────────────── o vocabulário ───────────────────────────── */

describe('"esteira" e "status" saem da ficha — F43, vocabulário do plano', () => {
  it('a propriedade se chama Etapa, e o conjunto diz "etapas de …" com o significado no `title`', () => {
    const html = desenhar(FICHA);
    expect(html).toContain('<dt>Etapa</dt>');
    expect(html).not.toContain('<dt>Status</dt>');
    expect(html).toContain('etapas de Produção');
    expect(html).toMatch(/title="As etapas desta tarefa vêm do conjunto &quot;Produção&quot;/);
    expect(html.toLowerCase()).not.toContain('esteira ');
  });

  it('lista sem etapas resolvidas diz "sem etapas"', () => {
    const html = desenhar({ ...FICHA, statuses: [], statusSetName: null });
    expect(html).toContain('sem etapas');
    expect(html).not.toContain('sem esteira');
  });
});

/* ───────────────────────────── salvar ───────────────────────────── */

describe('o contrato de salvar continua, e a linha diz em que pé o texto está', () => {
  const html = desenhar(FICHA);

  it('o estado aparece sempre — "Salvo" quando não há texto por salvar', () => {
    // `role="status"`: o estado muda sem a página recarregar, e o leitor de tela precisa ouvir (WCAG 4.1.3).
    expect(html).toContain('<span class="t-estado" role="status" data-estado="salvo">Salvo</span>');
  });

  it('a frase de instrução saiu da tela e foi para o `?` ao lado do estado', () => {
    // Antes: `.t-contrato`, sempre à vista embaixo das propriedades. O que ela
    // protegia — a pessoa saber que o chip grava e o texto espera o botão —
    // continua alcançável, com as mesmas palavras.
    expect(html).not.toContain('t-contrato');
    expect(html).not.toContain('gravam ao escolher');
    expect(html).toMatch(/<span class="t-estado"[^>]*>Salvo<\/span><button[^>]*aria-label="Explicar: quando a tarefa grava"/);
    expect(SOBRE_O_SALVAR).toBe('quando a tarefa grava');
    expect(EXPLICACAO_DO_SALVAR).toContain('gravam ao escolher');
    expect(EXPLICACAO_DO_SALVAR).toContain('Título e briefing vão com Salvar');
  });

  it('NÃO há salvamento automático: o botão Salvar continua, desativado sem nada por salvar', () => {
    expect(html).toMatch(/<button type="button" class="o-btn o-btn-primario o-btn-sm" title="Salva o título e o briefing \(Ctrl\+S\)" disabled="">Salvar<\/button>/);
  });
});

/* ───────────────────────────── as seções vazias ───────────────────────────── */

describe('seção vazia vira um botão da linha "+"', () => {
  it('tarefa sem nada: uma linha com as três, e nenhuma caixa vazia', () => {
    const html = desenhar(FICHA);
    expect(html).toContain('aria-label="Adicionar à tarefa"');
    for (const nome of ['subtarefa', 'checklist', 'anexo']) {
      expect(html).toContain(`aria-label="Adicionar ${nome}"`);
    }
    // A linha de criação de subtarefa NÃO nasce aberta (até a Fase 6 nascia).
    expect(html).not.toContain('aria-label="Nome da subtarefa"');
    // O título da seção vazia ("Adicionar subtarefa", que abria a linha) não é
    // desenhado; o nome continua no botão da linha "+", que faz o mesmo.
    expect(html).not.toContain('<span>Adicionar subtarefa</span>');
    expect(html).not.toContain('Checklists');
    expect(html).not.toContain('Anexar arquivo');
  });

  it('com subtarefa, a seção aparece como sempre (linha de criação aberta) e o "+" dela sai da linha', () => {
    const html = desenhar({ ...FICHA, subtasks: [SUB], progress: { ...SEM_PROGRESSO, subtaskCount: 1 } });
    expect(html).toContain('Separar as fotos do ensaio');
    expect(html).toContain('aria-label="Nome da subtarefa"');
    expect(html).not.toContain('aria-label="Adicionar subtarefa"');
    expect(html).toContain('aria-label="Adicionar checklist"');
    expect(html).toContain('aria-label="Adicionar anexo"');
  });

  it('com as três preenchidas, a linha "+" some', () => {
    const html = desenhar({
      ...FICHA,
      subtasks: [SUB],
      checklists: [{ id: 'k1', name: 'Checklist', sortOrder: 0, items: [] }],
      links: [{ id: 'l1', label: 'Dropbox', url: 'https://www.dropbox.com/scl/fo/a', sortOrder: 0, createdBy: null, createdAt: '2026-10-01T12:00:00.000Z' }],
    });
    expect(html).not.toContain('t-acrescentar');
    expect(html).toContain('Checklists');
    expect(html).toContain('Anexar arquivo');
  });
});

/* ───────────────────────────── a folha ───────────────────────────── */

describe('as duas colunas são da FICHA, por container query — tarefa.css', () => {
  const css = readFileSync(join(RAIZ, 'src', 'ui', 'tarefa.css'), 'utf8');
  const bloco = css.slice(css.indexOf('@container ficha (min-width: 66rem)'));

  it('`.cu-ficha` é o contêiner, e o limiar é a largura dela — não a da janela', () => {
    expect(css).toMatch(/\.cu-ficha \{ container: ficha \/ inline-size; \}/);
    expect(css).toContain('@container ficha (min-width: 66rem)');
  });

  it('em uma coluna `.t-lado` some como caixa e os carimbos voltam para antes da conversa', () => {
    expect(css).toMatch(/\.t-lado \{ display: contents; \}/);
    expect(css).toMatch(/\.t-lado > \.cu-carimbos \{ order: 1; \}/);
    expect(css).toMatch(/\.t-corpo > \.c-bloco \{ order: 2; \}/);
  });

  it('em duas, `.t-lado` vai para a segunda coluna e atravessa todas as linhas', () => {
    const lado = bloco.slice(bloco.indexOf('.t-lado {'), bloco.indexOf('}', bloco.indexOf('.t-lado {')));
    expect(lado).toContain('grid-column: 2;');
    expect(lado).toContain('grid-row: 1 / -1;');
    // E não gruda: a linha do Salvar já gruda, e o e2e B1 rola o balão do chip.
    expect(lado).not.toContain('sticky');
  });
});

/* ───────────────────────────── nenhum controle some ───────────────────────────── */

/**
 * O PEDIDO DO WESLEY NESTA FASE: "Toma cuidado para não esconder nenhum botão
 * sem querer… ou função."
 *
 * A comparação de verdade foi feita no Chrome, antes × depois, com os nomes
 * acessíveis de todos os botões, links e campos da ficha (nenhum sumiu; os das
 * seções vazias ficaram a um clique do "+"). Este caso deixa a regra de pé
 * para as próximas fases: a lista abaixo é cada controle que a ficha tinha
 * antes da Fase 6, e cada um tem de continuar no primeiro quadro — ou, nas
 * seções vazias, ter o botão "Adicionar …" que o traz.
 */
describe('nenhum controle da ficha some — pedido do Wesley, F43 Fase 6', () => {
  const SEMPRE = [
    ['seletor de lista', 'title="Lista: Criação"'],
    ['tipo antigo (número do ClickUp)', '<span class="nome">Arte antiga</span>'],
    ['Salvar', '>Salvar</button>'],
    ['⋯ (Mover, Observadores, Arquivar)', 'aria-label="Mais ações da tarefa"'],
    ['título', 'aria-label="Título da tarefa"'],
    ['Etapa', '<span class="rotulo">A fazer</span>'],
    ['Concluir', '<span class="rotulo">Concluir</span>'],
    ['Responsáveis', '<span class="rotulo">Ninguém</span>'],
    ['Prazo', '<span class="rotulo">Sem prazo</span>'],
    ['Prioridade', '<span class="rotulo">Sem prioridade</span>'],
    ['Etiquetas', '<span class="rotulo">Nenhuma</span>'],
    ['Tipo', 'data-prop="tipo"'],
    ['Cliente', 'data-prop="cliente"'],
    ['briefing', 'class="cu-ficha-corpo"'],
    ['comentar', '>Comentar</button>'],
    ['anexar imagem no comentário', 'aria-label="Anexar imagem"'],
  ] as const;

  const COM_TUDO: TaskDetail = {
    ...FICHA,
    availableTypes: [{ id: 'tt1', customItemId: 7, name: 'Arte antiga' }],
    taskTypeName: 'Arte antiga',
    subtasks: [SUB],
    checklists: [{ id: 'k1', name: 'Checklist', sortOrder: 0, items: [] }],
    links: [{ id: 'l1', label: 'Dropbox', url: 'https://www.dropbox.com/scl/fo/a', sortOrder: 0, createdBy: null, createdAt: '2026-10-01T12:00:00.000Z' }],
    progress: { ...SEM_PROGRESSO, subtaskCount: 1, checklistCount: 1, linkCount: 1 },
  };

  it.each(SEMPRE)('%s continua no primeiro quadro, com tarefa cheia e com tarefa vazia', (_nome, marca) => {
    expect(desenhar(COM_TUDO)).toContain(marca);
    expect(desenhar({ ...COM_TUDO, subtasks: [], checklists: [], links: [], progress: SEM_PROGRESSO })).toContain(marca);
  });

  it('com as seções preenchidas, os controles delas estão todos à vista', () => {
    const html = desenhar(COM_TUDO);
    expect(html).toContain('aria-label="Nome da subtarefa"');
    expect(html).toContain('+ Adicionar checklist');
    expect(html).toContain('Anexar arquivo');
    expect(html).toContain('Guardar link');
  });

  it('com as seções vazias, cada uma tem o botão que a traz — visível, sem passar o mouse', () => {
    const html = desenhar({ ...COM_TUDO, subtasks: [], checklists: [], links: [], progress: SEM_PROGRESSO });
    for (const nome of ['Adicionar subtarefa', 'Adicionar checklist', 'Adicionar anexo']) {
      expect(html).toContain(`aria-label="${nome}"`);
    }
    // "Visível sem passar o mouse": a folha não esconde a linha nem os botões.
    const css = readFileSync(join(RAIZ, 'src', 'ui', 'tarefa.css'), 'utf8');
    // (`opacity: 0.5` do botão desativado não conta: só o zero que some.)
    expect(css).not.toMatch(/\.t-acrescentar[^{]*\{[^}]*(opacity:\s*0\s*;|display:\s*none|visibility:\s*hidden)/);
  });
});
