/**
 * A BARRA LATERAL DESENHA A REFERÊNCIA — F17.14.
 *
 * POR QUE ESTE TESTE EXISTE
 *   O usuário vai abrir a tela ao lado do ClickUp dele e comparar peça por
 *   peça. Cada `it` aqui é UM item da referência que ele mandou — ícone por
 *   tipo, seta de expandir, `···` na linha, lista solta no espaço, linha
 *   selecionada com fundo. Se um deles sumir num refactor, o teste diz qual.
 *
 * SEM NAVEGADOR, E POR ISSO SEM `useEffect`
 *   `renderToStaticMarkup` monta a árvore e não roda efeito. O que se prova
 *   aqui é o PRIMEIRO quadro. O caminho inteiro — HTTP → Worker → Hyperdrive →
 *   Postgres, com as políticas e os dez gatilhos — é
 *   `scripts/provar-arvore-na-tela.mjs`.
 *
 * ESCRITO EM `createElement`, E NÃO EM JSX
 *   A suíte só inclui `*.test.ts`. Um `.tsx` não seria executado, e teste que
 *   não roda é pior que teste nenhum: ele conta como cobertura.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { type ClienteParaTrazer, type FullTreeRow, buildFullTree } from '@/board/arvore';
import { type EstadoDaLeitura } from '@/board/arvore-compartilhada';
import { ArvoreDoQuadro, CampoDaUnidade, SeletorDeMolde } from '@/board/ArvoreDoQuadro';
import { CaixaDeClientes } from '@/board/CaixaDeClientes';
import { MenuDeStatus } from '@/board/menus';
import { HERDAR, MOLDES_DE_ESTEIRA } from '@/board/moldes';

const base: FullTreeRow = {
  spaceId: 's1',
  spaceName: 'Demandas',
  spaceColor: '#7c8cff',
  spaceArchivedAt: null,
  categoryId: 'c1',
  categoryName: 'Ide',
  folderId: null,
  folderName: null,
  folderArchivedAt: null,
  listId: null,
  listName: null,
  listContent: null,
  listArchivedAt: null,
  listIsLive: false,
  liveTasks: 0,
  totalTasks: 0,
  clientId: null,
  clientName: null,
  workflowName: null,
  inheritedFrom: null,
};

/** A forma da referência: uma pasta com uma lista, e uma lista SOLTA ao lado. */
const LINHAS: FullTreeRow[] = [
  {
    ...base,
    folderId: 'f1',
    folderName: 'MIMI Enxovais',
    listId: 'l1',
    listName: 'MIMI (artes)',
    listIsLive: true,
    liveTasks: 3,
    totalTasks: 7,
    workflowName: 'Demandas',
    inheritedFrom: 'space',
  },
  {
    ...base,
    listId: 'l2',
    listName: 'Skills',
    listIsLive: true,
    liveTasks: 0,
    totalTasks: 0,
    workflowName: 'Demandas',
    inheritedFrom: 'space',
  },
];

function desenhar(
  linhas: FullTreeRow[] = LINHAS,
  opcoes: {
    listaAtiva?: string | null;
    mostrarArquivados?: boolean;
    /** Em que pé está a leitura — F17.CARGA03. Omitir é `pronta`, como a peça. */
    leitura?: EstadoDaLeitura;
  } = {},
): string {
  return renderToStaticMarkup(
    createElement(ArvoreDoQuadro, {
      arvore: buildFullTree(linhas),
      companies: [{ id: 'c1', name: 'Ide' }],
      // `?? 'l1'` engoliria o `null` explícito, que é o caso "nenhuma lista
      // escolhida" — justamente o que um dos testes precisa desenhar.
      listaAtiva: 'listaAtiva' in opcoes ? (opcoes.listaAtiva ?? null) : 'l1',
      mostrarArquivados: opcoes.mostrarArquivados ?? false,
      leitura: opcoes.leitura,
      aoAlternarArquivados: () => {},
      aoEscolher: () => {},
      aoRecarregar: async () => {},
      aoRecusar: () => {},
    }),
  );
}

describe('a barra lateral monta', () => {
  it('sem espaço nenhum, monta e diz por quê', () => {
    // Sem `leitura`, a peça assume `pronta` — leitura que voltou vazia. É este
    // o único caso em que a frase de alcance é verdade. Ver o bloco de baixo.
    const html = desenhar([]);
    expect(html).toContain('Nenhum espaço ao seu alcance');
  });

  it('desenha os três níveis da árvore', () => {
    const html = desenhar();
    expect(html).toContain('Demandas');
    expect(html).toContain('MIMI Enxovais');
    expect(html).toContain('MIMI (artes)');
  });
});

describe('peça por peça, contra a referência do ClickUp', () => {
  it('ÍCONE POR TIPO: o espaço tem marca com a inicial, a pasta e a lista têm traço próprio', () => {
    const html = desenhar();
    expect(html).toContain('cu-marca-espaco');
    // A cor do espaço vem do dado, como variável no elemento — decisão D10.
    expect(html).toContain('--cor-espaco:#7c8cff');
    // O traço da lista é a folha com marcas; o da pasta é a aba. Os dois `d`
    // são diferentes de propósito: dois ícones parecidos não distinguem nada.
    expect(html).toContain('M3.5 6.5l1.5 1.5 2.5-2.5');
    expect(html).toContain('M3 7a2 2 0 012-2h4l2 2h8');
  });

  it('SETA DE EXPANDIR à esquerda do espaço e da pasta, aberta por padrão', () => {
    const html = desenhar();
    expect(html).toContain('cu-caret');
    expect(html).toContain('data-aberto="true"');
    expect(html).toContain('aria-label="Recolher Demandas"');
    expect(html).toContain('aria-label="Recolher MIMI Enxovais"');
  });

  it('MENU `···` na linha — um por nó, com nome no rótulo', () => {
    const html = desenhar();
    expect(html).toContain('cu-no-acao');
    expect(html).toContain('aria-label="Ações de Demandas"');
    expect(html).toContain('aria-label="Ações de MIMI Enxovais"');
    expect(html).toContain('aria-label="Ações de MIMI (artes)"');
    expect(html).toContain('aria-label="Ações de Skills"');
  });

  it('LISTA SOLTA NO ESPAÇO: `Skills` no mesmo nível da pasta, e não dentro dela', () => {
    const html = desenhar();
    const pasta = html.indexOf('MIMI Enxovais');
    const solta = html.indexOf('Skills');
    expect(solta).toBeGreaterThan(pasta);
    // Nível 1 é o da pasta; a lista de dentro dela é nível 2.
    expect(html).toMatch(/data-nivel="1"[^>]*>(?:(?!data-nivel)[\s\S])*?Skills/);
    expect(html).toMatch(/data-nivel="2"[^>]*>(?:(?!data-nivel)[\s\S])*?MIMI \(artes\)/);
  });

  it('LINHA SELECIONADA marcada — o fundo vem de `data-atual` na folha', () => {
    expect(desenhar(LINHAS, { listaAtiva: 'l1' })).toContain('data-atual="true"');
    expect(desenhar(LINHAS, { listaAtiva: null })).not.toContain('data-atual="true"');
  });

  it('INDENTAÇÃO por nível: espaço 0, pasta e lista solta 1, lista em pasta 2', () => {
    const html = desenhar();
    expect(html).toContain('data-nivel="0"');
    expect(html).toContain('data-nivel="1"');
    expect(html).toContain('data-nivel="2"');
  });

  it('a contagem de tarefas separa o que está em aberto do total', () => {
    expect(desenhar()).toContain('title="3 em aberto · 7 no total"');
  });

  /* ─── F28: um número por linha, e ele é o que está em aberto ─── */

  it('F28: a lista mostra SÓ o que está em aberto; o total fica no `title` e no nome acessível', () => {
    const html = desenhar();
    // `3/7` virou `3`. O total não sumiu: está escrito por extenso.
    expect(html).not.toContain('/7');
    expect(html).toMatch(/class="cu-no-contagem"[^>]*>3<\/span>/);
    expect(html).toContain('<span class="sr-only">3 em aberto · 7 no total</span>');
  });

  it('F28: lista com ZERO em aberto não escreve número — a coluna só acende onde há trabalho', () => {
    const html = desenhar([
      { ...LINHAS[1], liveTasks: 0, totalTasks: 5 },
    ]);
    // A peça fica (é como as provas acham a linha de lista), vazia.
    expect(html).toMatch(/class="cu-no-contagem" title="0 em aberto · 5 no total" aria-hidden="true"><\/span>/);
    expect(html).toContain('<span class="sr-only">0 em aberto · 5 no total</span>');
  });

  it('F28: pasta ABERTA não escreve quantas listas tem — elas estão logo abaixo', () => {
    // A pasta `MIMI Enxovais` abre por padrão. A única contagem na tela é a da
    // lista de dentro (`3`); a lista solta `Skills` tem zero e não escreve.
    const html = desenhar();
    expect(html.match(/class="cu-no-contagem"[^>]*>[^<]+</g)).toEqual([
      'class="cu-no-contagem" title="3 em aberto · 7 no total" aria-hidden="true">3<',
    ]);
    expect(html).not.toContain(' listas"');
  });

  it('F31: nenhum prefixo de empresa quando o nome não tem gêmeo', () => {
    // "Será apenas Ide" (Wesley, 25/09). A F28 ainda escrevia `Ide · Demandas`
    // e `Ide · IDEAL HUB`; agora o espaço sai com o nome sozinho.
    const html = desenhar();
    expect(html).not.toContain('cu-no-empresa');
    expect(html).not.toContain('Ide · ');
    expect(desenhar([{ ...LINHAS[1], spaceName: 'IDEAL HUB' }])).not.toContain('Ide · ');
    const alma = desenhar([
      ...LINHAS,
      {
        ...LINHAS[1],
        spaceId: 's9',
        spaceName: 'CLIENTES',
        categoryId: 'c9',
        categoryName: 'Alma9',
        listId: 'l9',
      },
    ]);
    expect(alma).not.toContain('Alma9 · ');
    expect(alma).toContain('CLIENTES');
  });

  it('F31: os dois `Demandas` (Ide e Ide Hub) levam a empresa — é o único caso', () => {
    const html = desenhar([
      ...LINHAS,
      { ...LINHAS[1], spaceId: 's2', categoryId: 'c2', categoryName: 'Ide Hub', listId: 'l3' },
    ]);
    expect(html).toContain('<span class="cu-no-empresa">Ide · </span>');
    expect(html).toContain('<span class="cu-no-empresa">Ide Hub · </span>');
  });

  it('F31: árvore vazia não fala em empresa', () => {
    const html = desenhar([]);
    expect(html).toContain('Nenhum espaço ao seu alcance ainda.');
    expect(html).not.toMatch(/empresa/i);
  });

  it('o `+` do cabeçalho cria espaço, e ele NÃO some para quem não é administrador', () => {
    // Esconder seria reimplementar a política em React. O banco recusa e a
    // recusa aparece escrita. Ver o cabeçalho de `ArvoreDoQuadro`.
    expect(desenhar()).toContain('aria-label="Novo espaço"');
  });
});

describe('o campo "Unidade" do balão "Espaço novo" — F31', () => {
  const campo = (unidades: { id: string; name: string }[]) =>
    renderToStaticMarkup(
      createElement(CampoDaUnidade, { unidades, valor: unidades[0]?.id ?? '', aoMudar: () => {} }),
    );

  it('com UMA unidade oferecida, o campo nem aparece — o espaço nasce nela', () => {
    expect(campo([{ id: 'ide', name: 'Ide' }])).toBe('');
    expect(campo([])).toBe('');
  });

  it('com mais de uma, o campo fica, com as oferecidas', () => {
    const html = campo([
      { id: 'ide', name: 'Ide' },
      { id: 'hub', name: 'Ide Hub' },
    ]);
    expect(html).toContain('<span>Unidade</span>');
    expect(html).toContain('>Ide</option>');
    expect(html).toContain('>Ide Hub</option>');
    expect(html).not.toContain('Empresa');
  });
});

describe('arquivar não apaga, e a tela mostra isso', () => {
  const comArquivada: FullTreeRow[] = [
    LINHAS[0],
    {
      ...LINHAS[1],
      listIsLive: false,
      listArchivedAt: '2026-08-25T12:00:00.000Z',
    },
  ];

  it('escondido por padrão, com o interruptor contando quantos são', () => {
    const html = desenhar(comArquivada);
    expect(html).toContain('Mostrar arquivados (1)');
    expect(html).not.toContain('Skills');
  });

  it('ligado o interruptor, a lista arquivada volta — marcada como arquivada', () => {
    const html = desenhar(comArquivada, { mostrarArquivados: true });
    expect(html).toContain('Skills');
    expect(html).toContain('cu-selo-morto');
    expect(html).toContain('data-morto="true"');
  });

  it('sem nada arquivado, o interruptor não aparece — botão sem função não se desenha', () => {
    expect(desenhar()).not.toContain('Mostrar arquivados');
  });
});

describe('o estado vazio diz o que fazer, em vez de só dizer que está vazio', () => {
  it('espaço sem pasta e sem lista aponta para o `···`', () => {
    const html = desenhar([base]);
    expect(html).toContain('Espaço vazio');
    expect(html).toContain('para criar a primeira pasta ou lista');
  });

  it('pasta sem lista se anuncia — numa linha só, e o `···` dela continua ali (F28)', () => {
    const html = desenhar([{ ...base, folderId: 'f9', folderName: 'Recém-criada' }]);
    // Antes era uma segunda linha `Pasta sem lista.` embaixo da pasta. Agora o
    // vazio é dito pela própria linha: tom apagado (`data-vazia`), `title` e o
    // nome acessível.
    expect(html).not.toContain('Pasta sem lista.</p>');
    expect(html).toContain('data-vazia="true"');
    expect(html).toContain('title="Pasta sem lista. O ··· da linha cria a primeira."');
    expect(html).toContain('<span class="sr-only">(sem lista)</span>');
    // Sem seta: não há o que abrir. O `span` guarda o lugar dela.
    expect(html).not.toContain('Recolher Recém-criada');
    expect(html).not.toContain('Expandir Recém-criada');
    // É pelo `···` que se cria a primeira lista — ele não pode sumir junto.
    expect(html).toContain('aria-label="Ações de Recém-criada"');
    // E pasta vazia não ganha número de listas.
    expect(html).not.toContain('class="cu-no-contagem"');
  });

  it('pasta COM lista não é marcada como vazia', () => {
    expect(desenhar()).not.toContain('data-vazia="true"');
  });
});

/* ─────────────── as etapas escolhidas na CRIAÇÃO — F17.16 ─────────────── */

describe('AS ETAPAS SÃO PERGUNTADAS NA CRIAÇÃO, não configuradas depois', () => {
  /*
    *"dentro da lista deve ser personalizável as etapas, e não ser apenas a
    fazer e concluídas, na criação desse processo deve ser organizado."*

    O editor de esteira existia desde a F17.14, no `···` da lista. O que faltava
    era o momento — e é ele que estes casos guardam.
  */
  const seletor = (valor: string, comHerdar = true) =>
    renderToStaticMarkup(
      createElement(SeletorDeMolde, {
        valor,
        comHerdar,
        desativado: false,
        aoEscolher: () => {},
      }),
    );

  it('oferece os cinco moldes medidos, mais herdar', () => {
    const html = seletor(HERDAR);
    for (const m of MOLDES_DE_ESTEIRA) expect(html).toContain(`>${m.nome}<`);
    expect(html).toContain('>Herdar<');
    expect(MOLDES_DE_ESTEIRA.map((m) => m.nome)).toEqual([
      'Conteúdo',
      'Vídeo',
      'ADS',
      'Demanda',
      'Simples',
    ]);
  });

  it('herdar é o padrão da LISTA, e diz onde trocar depois', () => {
    const html = seletor(HERDAR);
    expect(html).toContain('aria-checked="true"');
    // O ESTADO continua escrito na tela: esta lista herda.
    expect(html).toContain('Herda a esteira da pasta ou do espaço');
    /*
      ⚠️ O CAMINHO PARA TROCAR SAIU DO PARÁGRAFO NA F17.24 — ele já estava
      escrito em três lugares. Ele continua em dois, e a asserção cobra os
      dois pelo NOME, para não passar por acaso quando um deles sumir:
        · o `title` da opção `Herdar`, que aparece ao passar o ponteiro;
        · o `?` ao lado da frase, que abre a explicação inteira.
    */
    expect(html).toContain('dá para trocar depois no ··· → Esteira…');
    expect(html).toContain('aria-label="Explicar: a esteira herdada"');
  });

  it('o ESPAÇO não oferece herdar — ele é a raiz da herança', () => {
    // Espaço sem esteira nasce morto: a primeira lista dentro dele abriria um
    // quadro sem coluna nenhuma. Ver `server/tree.ts`.
    expect(seletor('simples', false)).not.toContain('>Herdar<');
  });

  it('MOSTRA AS ETAPAS do molde escolhido — escolher sem ver é escolher no escuro', () => {
    const html = seletor('video');
    expect(html).toContain('ideia inicial');
    expect(html).toContain('em captação');
    expect(html).toContain('concluído');
    // Dez colunas na esteira de vídeo.
    expect(html.match(/class="cu-molde-etapa"/g)?.length).toBe(10);
  });

  it('o ERRO DE DIGITAÇÃO DA ORIGEM chega à tela — decisão D21', () => {
    // `desing de capa` é a coluna real do ClickUp da Ide. Ver `moldes.ts`: a
    // grafia é copiada de propósito, e há teste no catálogo também.
    expect(seletor('video')).toContain('desing de capa');
    expect(seletor('video')).not.toContain('design de capa');
  });

  it('marca qual etapa FECHA a esteira — é a que o banco exige', () => {
    expect(seletor('conteudo')).toContain('data-fim="true"');
    // Exatamente uma, em qualquer molde.
    expect(seletor('demanda').match(/data-fim="true"/g)?.length).toBe(1);
  });

  it('a cor da etapa entra como VARIÁVEL, nunca como classe — D10', () => {
    expect(seletor('ads')).toContain('--cor-status:');
  });
});

describe('A D10 NA TELA: nenhuma cor literal do Tailwind no que ela desenha', () => {
  const PALETA_DO_TAILWIND =
    /\b(?:bg|text|border|from|to|via|fill|stroke|ring|divide|shadow|outline|decoration|accent|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;

  it('a barra cheia', () => {
    expect(desenhar()).not.toMatch(PALETA_DO_TAILWIND);
  });

  it('a barra com arquivados à mostra', () => {
    expect(desenhar(LINHAS, { mostrarArquivados: true })).not.toMatch(PALETA_DO_TAILWIND);
  });

  it('a barra vazia', () => {
    expect(desenhar([])).not.toMatch(PALETA_DO_TAILWIND);
  });

  it('o seletor de etapas, com o molde mais colorido dos cinco', () => {
    const html = renderToStaticMarkup(
      createElement(SeletorDeMolde, {
        valor: 'demanda',
        comHerdar: true,
        desativado: false,
        aoEscolher: () => {},
      }),
    );
    expect(html).not.toMatch(PALETA_DO_TAILWIND);
  });
});

/* ────────────── o seletor de status agrupado — F17.19 ────────────── */

/**
 * A REFERÊNCIA QUE O USUÁRIO MANDOU, DESENHADA.
 *
 * O ClickUp agrupa o seletor por tipo, com cabeçalho. Até a F17.19 este menu
 * era uma lista corrida de oito colunas em versalete monoespaçado — e os
 * rótulos de tipo do editor eram invenção minha (`a fazer`, `no meio`,
 * `fecha o quadro`), que ninguém da equipe encontra no ClickUp dela.
 */
describe('o seletor de status desenha os quatro grupos da referência', () => {
  const E4 = [
    { id: '1', name: 'idéias', type: 'open' as const, color: '#d3d3d3', sortOrder: 0 },
    { id: '2', name: 'a fazer', type: 'unstarted' as const, color: '#f9d900', sortOrder: 1 },
    { id: '3', name: 'em andamento', type: 'custom' as const, color: '#a875ff', sortOrder: 2 },
    { id: '4', name: 'refação', type: 'custom' as const, color: '#ff7fab', sortOrder: 3 },
    { id: '5', name: 'publicar/agendar', type: 'done' as const, color: '#2ecd6f', sortOrder: 4 },
    { id: '6', name: 'concluído', type: 'closed' as const, color: '#6bc950', sortOrder: 5 },
  ];

  const desenharMenu = (statuses: typeof E4) =>
    renderToStaticMarkup(
      createElement(MenuDeStatus, {
        statuses,
        valor: '3',
        aoEscolher: () => {},
        aoFechar: () => {},
      }),
    );

  it('os quatro cabeçalhos aparecem, e na ordem do fluxo', () => {
    const html = desenharMenu(E4);
    const ordem = ['Não iniciado', 'Ativo', 'Feito', 'Fechado'].map((g) => html.indexOf(g));
    expect(ordem.every((i) => i >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
  });

  it('`idéias` e `a fazer` ficam sob o MESMO cabeçalho', () => {
    const html = desenharMenu(E4);
    // Entre `Não iniciado` e `Ativo` têm de caber os dois nomes.
    const trecho = html.slice(html.indexOf('Não iniciado'), html.indexOf('Ativo'));
    expect(trecho).toContain('idéias');
    expect(trecho).toContain('a fazer');
  });

  it('grupo VAZIO não ganha cabeçalho — rótulo sobre nada é ruído', () => {
    const html = desenharMenu(E4.filter((s) => s.type !== 'done'));
    expect(html).not.toContain('Feito');
    expect(html).toContain('Fechado');
  });

  it('e nenhum rótulo inventado sobreviveu', () => {
    const html = desenharMenu(E4);
    for (const inventado of ['no meio', 'fecha o quadro', 'não começou', 'pronto']) {
      expect(html).not.toContain(inventado);
    }
  });

  it('sem cor literal do Tailwind', () => {
    // A mesma expressão do bloco da D10 acima; repetida porque ela vive no
    // escopo daquele `describe`, e importá-la de lá seria mover a regra.
    expect(desenharMenu(E4)).not.toMatch(
      /\b(?:bg|text|border|from|to|via|fill|stroke|ring|divide|shadow|outline|decoration|accent|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
    );
  });
});

/* ─────────────── os clientes entram no quadro — F17.43 ─────────────── */

/**
 * O VÍNCULO APARECE NA ÁRVORE, E ELE É O CAMINHO ATÉ A FICHA.
 *
 * ⚠️ O QUE ESTE BLOCO NÃO PROVA, E POR QUÊ
 *   Que ninguém ganhou alcance. Isso é comparação par a par sobre o dado real,
 *   e mora em `scripts/provar-clientes-no-quadro.mjs`. Aqui não há banco: o que
 *   se guarda é que a tela desenha o vínculo e NÃO desenha o botão quando não
 *   há para onde ir.
 */
describe('a lista trazida diz de quem ela é — F17.43', () => {
  const COM_CLIENTE: FullTreeRow[] = [
    {
      ...base,
      listId: 'l9',
      listName: 'Jatobá',
      listIsLive: true,
      liveTasks: 11,
      totalTasks: 11,
      workflowName: 'Demandas',
      inheritedFrom: 'space',
      clientId: 'cli-1',
      clientName: 'Jatobá',
    },
  ];

  const comAbrirCliente = (linhas: FullTreeRow[]): string =>
    renderToStaticMarkup(
      createElement(ArvoreDoQuadro, {
        arvore: buildFullTree(linhas),
        companies: [{ id: 'c1', name: 'Ide' }],
        listaAtiva: null,
        mostrarArquivados: false,
        aoAlternarArquivados: () => {},
        aoEscolher: () => {},
        aoRecarregar: async () => {},
        aoRecusar: () => {},
        aoAbrirCliente: () => {},
      }),
    );

  it('a linha ganha o caminho para a ficha, nomeando o cliente', () => {
    expect(comAbrirCliente(COM_CLIENTE)).toContain('Abrir a ficha do cliente Jatobá');
  });

  it('o nome do cliente NÃO é repetido ao lado do nome da lista', () => {
    // A lista trazida nasce com o nome do cliente. Escrevê-lo duas vezes numa
    // barra estreita gastaria a largura para não dizer nada.
    const html = comAbrirCliente(COM_CLIENTE);
    const nomes = html.split('Jatobá').length - 1;
    // Uma no nome da lista, uma no rótulo do `···` (`Ações de Jatobá`),
    // uma no `title` do caminho para a ficha e uma no rótulo dele. Nenhuma
    // quinta — nenhuma delas está DESENHADA duas vezes ao lado da outra.
    expect(nomes).toBe(4);
  });

  it('lista SEM cliente não ganha caminho nenhum — botão morto é pior que ausente', () => {
    expect(comAbrirCliente(LINHAS)).not.toContain('Abrir a ficha');
  });

  it('com vínculo mas SEM o nome, nada é desenhado', () => {
    // Quem alcança a lista e não alcança o cliente lê o nome nulo. Um item
    // dizendo "Ficha do cliente" levaria a um 404 — e contaria que o cliente
    // existe para quem não pode vê-lo.
    const semNome = COM_CLIENTE.map((l) => ({ ...l, clientName: null }));
    expect(comAbrirCliente(semNome)).not.toContain('Abrir a ficha');
  });

  it('duas listas do mesmo cliente mostram o sinal nas DUAS — o vínculo nunca foi único', () => {
    // Cada linha responde por si. Um Map por cliente, ou um `find` que para
    // na primeira, apagaria o sinal da segunda e mentiria sobre o domínio.
    const duas: FullTreeRow[] = [
      {
        ...base,
        listId: 'l-a',
        listName: 'Demandas',
        listIsLive: true,
        liveTasks: 4,
        totalTasks: 4,
        workflowName: 'Demandas',
        inheritedFrom: 'space',
        clientId: 'cli-1',
        clientName: 'Jatobá',
      },
      {
        ...base,
        listId: 'l-b',
        listName: 'Conteúdo',
        listIsLive: true,
        liveTasks: 2,
        totalTasks: 2,
        workflowName: 'Demandas',
        inheritedFrom: 'space',
        clientId: 'cli-1',
        clientName: 'Jatobá',
      },
    ];
    const html = comAbrirCliente(duas);
    // Um sinal por lista: `aria-label="…"` conta um por linha. (Desde a F28 o
    // `title` diz a mesma frase, por isso se conta o atributo, e não a frase.)
    expect(html.split('aria-label="Abrir a ficha do cliente Jatobá"').length - 1).toBe(2);
    expect(html).toContain('Demandas');
    expect(html).toContain('Conteúdo');
  });

  it('sem `aoAbrirCliente`, a árvore continua montando', () => {
    // A suíte desenha esta tela FORA do roteador. Um `useNavigate` aqui dentro
    // derrubaria as duas dezenas de asserções acima.
    const html = desenhar(COM_CLIENTE);
    expect(html).toContain('Jatobá');
    expect(html).not.toContain('Abrir a ficha');
  });
});

describe('a caixa de trazer clientes — F17.43', () => {
  const caixa = (): string =>
    renderToStaticMarkup(
      createElement(CaixaDeClientes, {
        spaceId: 's1',
        folderId: null,
        onde: 'TIME HELENA',
        salvando: false,
        aoFechar: () => {},
        aoAgir: async () => ({ ok: true }),
      }),
    );

  it('diz para ONDE está trazendo', () => {
    expect(caixa()).toContain('TIME HELENA');
  });

  it('a busca e o rodapé ficam FORA da rolagem — senão o botão sai da tela', () => {
    const html = caixa();
    const inicioDaRolagem = html.indexOf('cu-rolagem');
    expect(html.indexOf('cu-busca')).toBeLessThan(inicioDaRolagem);
    expect(html.indexOf('cu-esteira-pe')).toBeGreaterThan(inicioDaRolagem);
  });

  it('a caixa é um balão, e por isso herda o teto medido e o fechar por Esc', () => {
    // 96 clientes não cabem em tela nenhuma. Quem põe o teto é `@/ui/teto`,
    // pelo `Balao` — e não uma altura em `rem` chutada aqui.
    expect(caixa()).toContain('cu-balao');
  });

  it('sem ninguém escolhido, o botão de trazer não age', () => {
    expect(caixa()).toMatch(/Trazer<\/button>/);
    const html = caixa();
    const pedaco = html.slice(html.indexOf('cu-esteira-pe'));
    expect(pedaco).toContain('disabled');
  });

  it('diz a consequência do clique, e não explica a si mesma', () => {
    expect(caixa()).toContain('vira uma lista com o nome do cliente');
    expect(caixa()).toContain('já tem lista aqui ganha outra');
  });

  it('sem cor literal do Tailwind', () => {
    expect(caixa()).not.toMatch(
      /\b(?:bg|text|border|from|to|via|fill|stroke|ring|divide|shadow|outline|decoration|accent|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
    );
  });
});

describe('a caixa informa quem já tem lista neste espaço', () => {
  const paraTrazer = (mudou: Partial<ClienteParaTrazer>): ClienteParaTrazer => ({
    id: 'c1',
    name: 'Jatobá',
    active: true,
    listCountInSpace: 0,
    ...mudou,
  });

  const caixaCom = (clientes: readonly ClienteParaTrazer[]): string =>
    renderToStaticMarkup(
      createElement(CaixaDeClientes, {
        spaceId: 's1',
        folderId: null,
        onde: 'TIME HELENA',
        salvando: false,
        aoFechar: () => {},
        aoAgir: async () => ({ ok: true }),
        clientesJaLidos: clientes,
      }),
    );

  it('deixou de dizer que todos já estão neste espaço', () => {
    const vazia = caixaCom([]);
    expect(vazia).toContain('Nenhum cliente ao seu alcance.');
    expect(vazia).not.toContain('já estão neste espaço');
    expect(vazia).not.toContain('ainda não veio');
  });

  it('zero listas: o nome aparece, o selo some', () => {
    const html = caixaCom([paraTrazer({ listCountInSpace: 0 })]);
    const linha = html.slice(html.indexOf('cu-rolagem'), html.indexOf('cu-esteira-pe'));
    expect(linha).toContain('Jatobá');
    expect(linha).not.toContain('já tem');
  });

  it('uma lista: o selo e a contagem certa', () => {
    expect(caixaCom([paraTrazer({ listCountInSpace: 1 })])).toContain('já tem 1 lista aqui');
  });

  it('várias listas: o plural e o número que o servidor mandou', () => {
    expect(caixaCom([paraTrazer({ listCountInSpace: 3 })])).toContain('já tem 3 listas aqui');
  });

  it('a contagem da arquivada chega pronta — a tela não filtra', () => {
    // Arquivada conta no servidor. Aqui só se prova que o número que chegou
    // é o que a pessoa lê, mesmo quando a única lista está no arquivo.
    expect(caixaCom([paraTrazer({ listCountInSpace: 1 })])).toContain('já tem 1 lista aqui');
  });

  it('quem já tem lista continua clicável — trazer de novo cria outra', () => {
    const html = caixaCom([paraTrazer({ listCountInSpace: 2 })]);
    const item = html.slice(html.indexOf('role="menuitemcheckbox"'), html.indexOf('Jatobá'));
    expect(item).not.toContain('disabled');
    expect(html).toContain('já tem 2 listas aqui');
  });

  it('inativo com lista já aqui mostra os dois sinais, e continua na escolha', () => {
    const html = caixaCom([
      paraTrazer({ name: 'Clinimax', active: false, listCountInSpace: 1 }),
    ]);
    expect(html).toContain('Clinimax');
    expect(html).toContain('já tem 1 lista aqui');
    expect(html).toContain('inativo');
  });

  it('com a carteira na frente, busca e rodapé continuam FORA da rolagem', () => {
    const html = caixaCom([
      paraTrazer({ id: 'a', name: 'Jatobá', listCountInSpace: 1 }),
      paraTrazer({ id: 'b', name: 'Valentini', listCountInSpace: 0 }),
      paraTrazer({ id: 'c', name: 'DXI', listCountInSpace: 4 }),
    ]);
    const inicioDaRolagem = html.indexOf('cu-rolagem');
    expect(html.indexOf('cu-busca')).toBeLessThan(inicioDaRolagem);
    expect(html.indexOf('cu-esteira-pe')).toBeGreaterThan(inicioDaRolagem);
    expect(html).toContain('cu-balao');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   ESPERA, FALHA E VAZIO SÃO TRÊS DESENHOS — F17.CARGA03
   ═══════════════════════════════════════════════════════════════════════════

   O defeito, visto numa captura de tela pelo dono do projeto: a barra dizia
   `Nenhum espaço ao seu alcance.` ENQUANTO a leitura ainda estava no ar, e ele
   leu como falha de acesso. A árvore vazia era desenhada igual nos três casos,
   porque quem monta converte "ainda não sei" (`linhas === null`) em `[]`.

   Aqui se prova o que a pessoa VÊ em cada um dos três. */

describe('a primeira carga não acusa ninguém de falta de acesso', () => {
  it('ENQUANTO CARREGA: esqueleto, e nenhuma palavra sobre alcance', () => {
    const html = desenhar([], { leitura: 'carregando' });
    expect(html).toContain('cu-esqueleto');
    expect(html).not.toContain('Nenhum espaço ao seu alcance');
  });

  it('o esqueleto tem o número FIXO de linhas — a barra não pula quando o dado chega', () => {
    // Seis, sempre. Um esqueleto que cresce com a espera empurra o conteúdo
    // debaixo do cursor no instante do clique.
    const html = desenhar([], { leitura: 'carregando' });
    expect(html.match(/cu-esqueleto-linha/g)).toHaveLength(6);
    // E ele desenha a FORMA de uma árvore, e não uma pilha de barras iguais.
    expect(html).toContain('data-nivel="0"');
    expect(html).toContain('data-nivel="1"');
    expect(html).toContain('data-nivel="2"');
  });

  it('a caixa se declara ocupada só na primeira carga', () => {
    expect(desenhar([], { leitura: 'carregando' })).toContain('aria-busy="true"');
    expect(desenhar([], { leitura: 'pronta' })).not.toContain('aria-busy="true"');
  });

  it('QUANDO O SERVIDOR RECUSA: nem esqueleto, nem frase de alcance', () => {
    // Quem fala é a faixa de recusa de quem chama — a barra e as três telas do
    // quadro —, com a frase inteira do banco. Uma segunda frase aqui dentro
    // diria a mesma coisa duas vezes, e a de dentro seria a genérica.
    const html = desenhar([], { leitura: 'recusada' });
    expect(html).not.toContain('cu-esqueleto');
    expect(html).not.toContain('Nenhum espaço ao seu alcance');
  });

  it('DEPOIS DE UMA LEITURA BOA E VAZIA: a frase, e o porquê dela', () => {
    const html = desenhar([], { leitura: 'pronta' });
    expect(html).toContain('Nenhum espaço ao seu alcance');
    // E o `?` ao lado, que explica POR QUE ela está vazia — a frase sozinha
    // manda a pessoa procurar defeito onde só falta uma empresa.
    expect(html).toContain('Explicar: por que a árvore está vazia');
    expect(html).not.toContain('cu-esqueleto');
  });

  it('os três desenhos são DIFERENTES entre si', () => {
    // O critério explícito da fase: falha e resultado vazio precisam ser
    // visualmente distintos — e nenhum dos dois pode parecer espera.
    const marcacoes = (['carregando', 'recusada', 'pronta'] as const).map((leitura) =>
      desenhar([], { leitura }),
    );
    expect(new Set(marcacoes).size).toBe(3);
  });
});

describe('revalidação não apaga o que está na tela', () => {
  it('com árvore desenhada, `carregando` não troca o mapa por um esqueleto', () => {
    // `leituraDaArvore` preserva as linhas numa falha passageira, e o estado
    // continua `pronta`. Mesmo que alguém passe `carregando` com dado na mão,
    // o esqueleto não entra por cima do que a pessoa está lendo.
    const html = desenhar(LINHAS, { leitura: 'carregando' });
    expect(html).toContain('MIMI (artes)');
    expect(html).not.toContain('cu-esqueleto');
    expect(html).not.toContain('aria-busy="true"');
  });
});
