/**
 * AS DUAS SEÇÕES ABREM, E COM A FORMA DA REFERÊNCIA — F17.15.
 *
 * POR QUE ESTE TESTE EXISTE
 *   Mesma razão de `tela-da-tarefa.test.ts`: `typecheck` não pega import
 *   circular, componente indefinido nem hook fora de ordem. E, como lá, ele tem
 *   um segundo trabalho — guardar a FORMA.
 *
 *   O usuário mandou a ficha real do ClickUp como referência e vai abrir as duas
 *   lado a lado. As peças dessa semelhança são conferíveis no HTML produzido:
 *
 *     · o cabeçalho `Adicionar subtarefa` com a seta de recolher;
 *     · a LINHA de criação com o círculo do status, o campo com o texto de
 *       ajuda exato, a fila de ícones compacta, `Cancelar` e `Salvar ↵`;
 *     · o cartão de checklist com nome em negrito, contador `0 de 0` POR
 *       EXTENSO, `+ Adicionar item` dentro e `+ Adicionar checklist` embaixo.
 *
 *   E o que NÃO pode estar lá: `Adicione os campos`, `Vincular itens` e `Anexar
 *   arquivo` aparecem na referência mas são de outras etapas. Botão morto é pior
 *   que botão ausente, e um teste que só olhasse o que existe deixaria alguém
 *   "completar o desenho" sem função atrás.
 *
 * SEM NAVEGADOR, E POR ISSO SEM `useEffect`
 *   A suíte roda em ambiente `node`. `renderToStaticMarkup` monta a árvore e não
 *   roda efeito — o que se prova aqui é o PRIMEIRO quadro.
 *
 * ESCRITO EM `createElement`, E NÃO EM JSX
 *   A suíte só inclui `*.test.ts`. Um `.tsx` não seria executado — e teste que
 *   não roda é pior que teste nenhum, porque conta como cobertura.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { TaskDetail } from '@/board/ficha';
import { EXPLICACAO_DOS_PASSOS, PassosDaTarefa, SOBRE_DOS_PASSOS, SeloDaMae } from '@/board/PassosDaTarefa';
import { SEM_PROGRESSO, type Subtask } from '@/board/passos';

const HOJE = { year: 2026, month: 8, day: 26 };

const FICHA: TaskDetail = {
  id: '604ef3c5-a635-45f0-914b-087c47f9eb85',
  title: 'Etapa 1: Organização Estratégica Inicial',
  description: null,
  listId: 'l1',
  listName: 'Fiorart (setup)',
  folderId: null,
  folderName: null,
  spaceId: 's1',
  spaceName: 'Alma 9',
  categoryName: 'Alma9',
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
  createdBy: null,
  createdAt: '2026-08-26T10:00:00.000Z',
  updatedAt: '2026-08-26T10:00:00.000Z',
  statuses: [
    { id: 'st1', name: 'a fazer', type: 'open', color: '#d3d3d3', sortOrder: 0 },
    { id: 'st2', name: 'concluída', type: 'closed', color: '#6bc950', sortOrder: 1 },
  ],
  statusSetName: 'Demandas',
  inheritedFrom: 'space',
  availableTags: [],
  availableTypes: [],
  parentId: null,
  parentTitle: null,
  subtasks: [],
  checklists: [],
  // A entrega — F17.6. Ela NÃO é desenhada por `PassosDaTarefa`, e é por isso
  // que o teste "as seções de outras etapas não aparecem" continua valendo sem
  // uma linha alterada: `📎 Anexar arquivo` mora em `AnexosDaTarefa`, que é
  // outro componente e é montado depois deste na ficha.
  comments: [],
  attachments: [],
  links: [],
  // Tarefa que nunca passou por etapa automatizada — o caso normal (F17.41).
  history: [],
  progress: SEM_PROGRESSO,
};

/** As cinco subtarefas reais da `Etapa 1`, medidas na tela do usuário. */
const CINCO: Subtask[] = [
  '1.1 Reunião de Kickoff',
  '1.2 Acesso às Plataformas',
  '1.3 Análise de Produtos',
  '1.4 Definição de SKUs',
  '1.5 Estruturação de Variações',
].map((title, i) => ({
  id: `f${i}`,
  title,
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
}));

const desenhar = (tarefa: TaskDetail): string =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(PassosDaTarefa, {
        tarefa,
        equipe: [{ id: 'a', name: 'Ana' }],
        meuId: 'a',
        hoje: HOJE,
        ocupado: false,
        aoAssentar: () => {},
        aoErro: () => {},
      }),
    ),
  );

/* ───────────────────────────── a seção de subtarefa ───────────────────────────── */

describe('a seção de subtarefa tem a forma da referência', () => {
  const html = desenhar(FICHA);

  it('o cabeçalho é `Adicionar subtarefa` enquanto não há nenhuma', () => {
    expect(html).toContain('Adicionar subtarefa');
    expect(html).toContain('aria-expanded="true"');
  });

  it('a LINHA de criação traz o texto de ajuda exato da referência', () => {
    expect(html).toContain("Nome da Tarefa ou digite &#x27;/&#x27; para inserir comandos");
  });

  it('a fila de ícones é compacta e SEM rótulo — pessoa, data, bandeira, etiqueta', () => {
    // Só ícone: o nome de cada um vive no `title`, que é o que a referência faz
    // e o que mantém a linha em uma linha só.
    expect(html).toContain('aria-label="Responsável"');
    expect(html).toContain('aria-label="Data"');
    expect(html).toContain('aria-label="Prioridade"');
    expect(html).toContain('aria-label="Etiquetas"');
    expect(html).toContain('class="p-icones"');
  });

  it('`Cancelar` e `Salvar ↵` — e o ↵ confirma que Enter salva', () => {
    expect(html).toContain('Cancelar');
    expect(html).toContain('Salvar');
    expect(html).toContain('↵');
  });

  it('a tela DIZ que a subtarefa nasce na lista da mãe — a decisão é do banco', () => {
    // F43, Fase 6: a nota de rodapé virou `?` ao lado do título da seção (ela
    // explica a tela — regra da F17.24). O que se protege continua: a
    // informação existe, inteira, e se alcança por um botão de verdade.
    expect(html).toContain(`aria-label="Explicar: ${SOBRE_DOS_PASSOS.subtarefa}"`);
    expect(EXPLICACAO_DOS_PASSOS.subtarefa).toContain('mesma lista');
    // Fechado, o `?` não ocupa a seção — que é o ponto da mudança.
    expect(html).not.toContain('mesma lista');
  });

  it('o `/` que o texto de ajuda promete é um campo que ABRE menu, e não decoração', () => {
    // O texto de ajuda da referência escreve, com todas as letras, "digite '/'
    // para inserir comandos". Copiar a frase e deixar o `/` inerte seria pior
    // que um botão morto — a promessa está escrita, e a pessoa vai tentar.
    //
    // Sem DOM não dá para digitar aqui; o que este teste guarda é que o campo
    // ANUNCIA que abre algo (`aria-expanded`), e a lista de comandos vive no
    // mesmo componente. O comportamento de digitar está no cabeçalho de
    // `LinhaDeSubtarefa`.
    expect(html).toContain('aria-label="Nome da subtarefa"');
    expect(html).toContain('aria-expanded="false"');
  });
});

describe('com subtarefas, o cabeçalho vira `Subtarefas` e cada linha aparece', () => {
  const html = desenhar({
    ...FICHA,
    subtasks: CINCO,
    progress: { ...SEM_PROGRESSO, subtaskCount: 5 },
  });

  it('as cinco da `Etapa 1` real', () => {
    for (const s of CINCO) expect(html).toContain(s.title);
  });

  it('o cabeçalho conta `0 de 5 concluídas`', () => {
    expect(html).toContain('Subtarefas');
    expect(html).toContain('0 de 5 concluídas');
  });

  it('cada linha abre a ficha DELA — a profundidade livre se navega, não se soma', () => {
    expect(html).toContain('href="/tarefa/f0"');
    expect(html).toContain('href="/tarefa/f4"');
  });
});

describe('a subtarefa arquivada não some, e não conta', () => {
  const html = desenhar({
    ...FICHA,
    subtasks: [...CINCO, { ...CINCO[0], id: 'fx', title: 'passo antigo', archivedAt: '2026-08-01T00:00:00.000Z' }],
    progress: { ...SEM_PROGRESSO, subtaskCount: 5 },
  });

  it('a ficha DIZ quantas estão arquivadas, em vez de omiti-las em silêncio', () => {
    // `task_progress` as exclui de propósito — o cartão do quadro diria 6 e
    // abriria com 5. Escondê-las aqui também faria trabalho arquivado sumir sem
    // deixar rastro.
    expect(html).toContain('arquivada(s) não aparecem acima');
  });
});

/* ───────────────────────────── a seção de checklist ───────────────────────────── */

describe('o checklist é CARTÃO, e o contador é por extenso', () => {
  const html = desenhar({
    ...FICHA,
    checklists: [
      {
        id: 'k1',
        name: 'Checklist',
        sortOrder: 0,
        items: [
          {
            id: 'i1',
            checklistId: 'k1',
            parentItemId: null,
            name: 'Levantar SKUs',
            sortOrder: 0,
            resolvedAt: null,
            assignee: null,
            children: [],
          },
        ],
      },
    ],
    progress: { ...SEM_PROGRESSO, checklistCount: 1, checklistTotal: 1, checklistDone: 0 },
  });

  it('`0 de 1` POR EXTENSO — a forma da referência, e não `0/1`', () => {
    expect(html).toContain('0 de 1');
    expect(html).not.toContain('>0/1<');
  });

  it('o cartão tem borda própria e nome em campo — renomear é digitar, não é menu', () => {
    expect(html).toContain('class="p-cartao"');
    expect(html).toContain('aria-label="Nome do checklist"');
  });

  it('`+ Adicionar item` fica DENTRO do cartão e `+ Adicionar checklist` embaixo de todos', () => {
    expect(html.indexOf('+ Adicionar item')).toBeLessThan(html.indexOf('+ Adicionar checklist'));
  });

  it('a caixa do item é um botão de verdade, com estado lido em voz alta', () => {
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('aria-checked="false"');
  });

  it('a ficha explica a diferença entre a caixa do checklist e a caixa do briefing', () => {
    // A ficha passa a ter DUAS caixinhas com significados diferentes. Confundi-las
    // é o defeito que esta etapa poderia introduzir.
    // F43, Fase 6: a explicação foi para o `?` ao lado de "Checklists", sem
    // mudar de texto — cobra-se o botão que a abre e a frase inteira.
    expect(html).toContain(`aria-label="Explicar: ${SOBRE_DOS_PASSOS.checklist}"`);
    expect(EXPLICACAO_DOS_PASSOS.checklist).toContain('grava no clique');
    expect(EXPLICACAO_DOS_PASSOS.checklist).toContain('Salvar');
  });
});

describe('o ícone de pessoa do cartão não é botão morto', () => {
  it('com o checklist VAZIO ele fica desativado, e o `title` diz por quê', () => {
    const html = desenhar({
      ...FICHA,
      checklists: [{ id: 'k1', name: 'Checklist', sortOrder: 0, items: [] }],
      progress: { ...SEM_PROGRESSO, checklistCount: 1 },
    });
    expect(html).toContain('o responsável é do item, não do checklist');
    expect(html).toContain('disabled=""');
  });
});

/* ───────────────────────────── o que NÃO é desta etapa ───────────────────────────── */

describe('as três seções de outras etapas não são desenhadas', () => {
  const html = desenhar(FICHA);

  it('nem campos personalizados (F17.5), nem dependências, nem anexo (F17.6)', () => {
    // Elas aparecem na referência ENTRE as duas desta etapa, e é por isso que a
    // ordem já está certa. Desenhá-las agora seria prometer o que não há.
    expect(html).not.toContain('Adicione os campos');
    expect(html).not.toContain('Vincular itens');
    expect(html).not.toContain('Anexar arquivo');
  });

  it('e a subtarefa vem ANTES do checklist, como na ficha real', () => {
    expect(html.indexOf('Adicionar subtarefa')).toBeLessThan(html.indexOf('Checklists'));
  });
});

/* ───────────────────────────── a mãe ───────────────────────────── */

describe('o caminho de volta', () => {
  it('a subtarefa aberta pelo endereço dela DIZ de quem é', () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(SeloDaMae, {
          tarefa: { ...FICHA, parentId: 'mae1', parentTitle: 'Etapa 1' },
        }),
      ),
    );
    expect(html).toContain('href="/tarefa/mae1"');
    expect(html).toContain('subtarefa de Etapa 1');
  });

  it('tarefa sem mãe não desenha nada', () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(SeloDaMae, { tarefa: FICHA })),
    );
    expect(html).toBe('');
  });
});

/* ───────────────────────────── a D10 ───────────────────────────── */

describe('A D10 NA TELA: nenhuma cor literal do Tailwind no que ela desenha', () => {
  // Mesma rede de `tela-da-tarefa.test.ts`. Olha o HTML PRODUZIDO, e não a
  // fonte — é o que sobra depois de toda condicional.
  const PALETA_DO_TAILWIND =
    /\b(?:bg|text|border|from|to|via|fill|stroke|ring|divide|shadow|outline|decoration|accent|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;

  it('as duas seções, com subtarefa e com checklist dentro', () => {
    const html = desenhar({
      ...FICHA,
      subtasks: CINCO,
      checklists: [
        {
          id: 'k1',
          name: 'Checklist',
          sortOrder: 0,
          items: [
            {
              id: 'i1',
              checklistId: 'k1',
              parentItemId: null,
              name: 'Levantar SKUs',
              sortOrder: 0,
              resolvedAt: '2026-08-26T09:00:00.000Z',
              assignee: { id: 'a', name: 'Ana' },
              children: [],
            },
          ],
        },
      ],
      progress: {
        ...SEM_PROGRESSO,
        subtaskCount: 5,
        subtaskDone: 0,
        checklistCount: 1,
        checklistTotal: 1,
        checklistDone: 1,
      },
    });
    expect(html).not.toMatch(PALETA_DO_TAILWIND);
  });
});

/* ───────────────────────────── F43, Fase 6: as seções recolhidas ───────────────────────────── */

describe('F43 Fase 6 — a ficha pode deixar as seções de fora', () => {
  const recolhida = (extra: Record<string, unknown>) =>
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(PassosDaTarefa, {
          tarefa: FICHA,
          equipe: [{ id: 'a', name: 'Ana' }],
          meuId: 'a',
          hoje: HOJE,
          ocupado: false,
          aoAssentar: () => {},
          aoErro: () => {},
          ...extra,
        }),
      ),
    );

  it('sem `mostrarSubtarefas`, a linha de criação NÃO nasce aberta — quem a abre é o "+ Subtarefa" da ficha', () => {
    // Até a Fase 6 toda tarefa sem subtarefa abria com a linha de criação à
    // vista (é o que o caso "Adicionar subtarefa" lá em cima ainda prova, com
    // as `props` de sempre). A ficha agora passa `false` quando não há
    // subtarefa — a decisão é `secoesVazias`, em `ficha.test.ts`.
    const html = recolhida({ mostrarSubtarefas: false });
    expect(html).not.toContain('aria-label="Nome da subtarefa"');
    expect(html).not.toContain('Adicionar subtarefa');
    expect(html).toContain('Checklists');
  });

  it('sem `mostrarChecklists`, a seção de checklist some inteira', () => {
    const html = recolhida({ mostrarChecklists: false });
    expect(html).not.toContain('Checklists');
    expect(html).not.toContain('+ Adicionar checklist');
    expect(html).toContain('Adicionar subtarefa');
  });

  it('as duas de fora: nada desenhado — nenhuma caixa vazia', () => {
    expect(recolhida({ mostrarSubtarefas: false, mostrarChecklists: false })).toBe('');
  });
});
