/**
 * A VISÃO GERAL DO ESPAÇO, DESENHADA — etapa F17.26.
 *
 * POR QUE ESTE TESTE EXISTE
 *   O usuário vai abrir esta tela ao lado do ClickUp dele e comparar peça por
 *   peça. Cada `it` aqui é UM item dessa comparação: a pasta com as listas
 *   dentro, a LISTA SOLTA ao lado, o `feitas/total` de cada lista, o somatório
 *   da pasta e o do espaço, e o atalho para o quadro.
 *
 * ⚠️ E QUATRO DELES SÃO AUSÊNCIAS
 *   `Cor`, `Início`, `Término` e `Favoritos` aparecem na captura de referência
 *   e NÃO existem no modelo. Um teste que só olha o que está lá deixaria a
 *   próxima sessão reintroduzi-las "para ficar igual à imagem". Aqui elas são
 *   proibidas por escrito.
 *
 * SEM NAVEGADOR, E POR ISSO SEM `useEffect`
 *   `renderToStaticMarkup` monta e não roda efeito. Por isso o que se desenha é
 *   `CorpoDoEspaco`, que recebe a visão pronta — a tela inteira busca a árvore
 *   num efeito. O caminho completo, com política de linha de verdade, é
 *   `scripts/provar-visao-do-espaco.mjs`.
 *
 * ESCRITO EM `createElement`, E NÃO EM JSX
 *   A suíte só inclui `*.test.ts`. Um `.tsx` não seria executado, e teste que
 *   não roda é pior que teste nenhum: ele conta como cobertura.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { type FullTreeRow, buildFullTree } from '@/board/arvore';
import { montarVisaoDoEspaco } from '@/board/visao-do-espaco';
import { CorpoDoEspaco } from '@/pages/Espaco';

const base: FullTreeRow = {
  spaceId: 's1',
  spaceName: 'Focus',
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

const LINHAS: FullTreeRow[] = [
  {
    ...base,
    folderId: 'f1',
    folderName: 'Cronograma',
    listId: 'l1',
    listName: 'Setembro',
    listIsLive: true,
    liveTasks: 1,
    totalTasks: 4,
    workflowName: 'Padrão',
    inheritedFrom: 'list',
  },
  {
    ...base,
    listId: 'l2',
    listName: 'Todas as demandas',
    listIsLive: true,
    liveTasks: 0,
    totalTasks: 14,
    workflowName: 'Demandas',
    inheritedFrom: 'space',
  },
];

function desenhar(linhas: FullTreeRow[] = LINHAS, mostrarArquivados = false): string {
  const espaco = buildFullTree(linhas)[0];
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(CorpoDoEspaco, { visao: montarVisaoDoEspaco(espaco, mostrarArquivados) }),
    ),
  );
}

describe('o corpo mostra o que há no espaço', () => {
  const html = desenhar();

  it('a PASTA aparece, com o nome dela', () => {
    expect(html).toContain('Cronograma');
  });

  it('a lista de dentro da pasta aparece', () => {
    expect(html).toContain('Setembro');
  });

  it('A LISTA SOLTA APARECE — o caso que todo desenho ingênuo perde', () => {
    expect(html).toContain('Todas as demandas');
    expect(html).toContain('Listas sem pasta');
  });

  it('cada lista tem atalho para o quadro dela', () => {
    expect(html).toContain('href="/quadro/l1"');
    expect(html).toContain('href="/quadro/l2"');
  });

  it('o progresso de cada lista é `feitas/total`, e não em aberto/total', () => {
    // `Setembro`: 4 no total, 1 em aberto → 3 feitas. Se alguém inverter o
    // sinal, sai `1/4` e este teste fica vermelho.
    expect(html).toContain('>3<');
    expect(html).toContain('/4');
    expect(html).toContain('/14');
  });

  it('a esteira resolvida aparece na linha da lista', () => {
    expect(html).toContain('Padrão');
    expect(html).toContain('Demandas');
    expect(html).toContain('herdada do espaço');
  });

  it('o somatório da PASTA está lá — quem olha o cliente quer o número dele', () => {
    // Uma pasta, uma lista: `1 lista`.
    expect(html).toContain('1 lista');
  });

  it('o número que se copia é selecionável — F17.25', () => {
    expect(html).toContain('selecionavel');
  });
});

describe('as quatro peças da referência que NÃO entram', () => {
  const html = desenhar();

  it('não há `Favoritos`: não existe em lugar nenhum do sistema', () => {
    expect(html).not.toMatch(/favorito/i);
  });

  it('não há `Cor` como coluna: a lista não tem cor no modelo', () => {
    expect(html).not.toMatch(/>\s*Cor\s*</);
  });

  it('não há `Início` nem `Término`: a lista não tem data no modelo', () => {
    expect(html).not.toMatch(/In[íi]cio/);
    expect(html).not.toMatch(/T[ée]rmino/);
  });

  it('não há o cartão `Documentos`: documento é a F17.7', () => {
    expect(html).not.toMatch(/documento/i);
  });
});

describe('os três casos de borda desenham', () => {
  it('espaço VAZIO abre e diz o próximo passo, sem parecer defeito', () => {
    const html = desenhar([base]);
    expect(html).toContain('ainda não tem pasta nem lista');
    // Uma linha curta, e não um parágrafo didático — F17.20.
    expect(html.replace(/<[^>]+>/g, '').trim().length).toBeLessThan(160);
  });

  it('espaço SÓ com lista solta desenha a lista solta e nenhuma pasta', () => {
    const html = desenhar(LINHAS.filter((r) => r.listId === 'l2'));
    expect(html).toContain('Todas as demandas');
    expect(html).not.toContain('Cronograma');
  });

  it('espaço ARQUIVADO abre: com o interruptor ligado, o conteúdo continua lá', () => {
    const arquivado = LINHAS.map((r) => ({
      ...r,
      spaceArchivedAt: '2026-08-01T00:00:00Z',
      listIsLive: false,
    }));
    expect(desenhar(arquivado, true)).toContain('Cronograma');
    // Desligado, ele parece vazio — a MESMA regra da árvore ao lado, e não uma
    // segunda opinião sobre o que está morto.
    expect(desenhar(arquivado, false)).toContain('ainda não tem pasta nem lista');
  });

  it('pasta sem lista nenhuma diz isso em três palavras', () => {
    const semLista = buildFullTree([
      { ...base, folderId: 'f9', folderName: 'Vazia' },
    ])[0];
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(CorpoDoEspaco, { visao: montarVisaoDoEspaco(semLista, false) }),
      ),
    );
    expect(html).toContain('Pasta sem lista');
  });
});

describe('a lista diz de que cliente ela é — o caminho de volta', () => {
  it('o nome aparece e o clique leva à ficha', () => {
    const html = desenhar([
      {
        ...base,
        listId: 'l1',
        listName: 'Demandas',
        listIsLive: true,
        liveTasks: 1,
        totalTasks: 4,
        clientId: 'cli-1',
        clientName: 'Jatobá',
      },
    ]);
    expect(html).toContain('Jatobá');
    expect(html).toContain('href="/cliente/cli-1"');
    expect(html).toContain('Abrir a ficha de Jatobá');
    expect(html).toContain('href="/quadro/l1"');
  });

  it('duas listas do mesmo cliente mostram o sinal nas DUAS', () => {
    const html = desenhar([
      {
        ...base,
        listId: 'l-a',
        listName: 'Demandas',
        listIsLive: true,
        clientId: 'cli-1',
        clientName: 'Jatobá',
      },
      {
        ...base,
        listId: 'l-b',
        listName: 'Conteúdo',
        listIsLive: true,
        clientId: 'cli-1',
        clientName: 'Jatobá',
      },
    ]);
    expect(html.split('Abrir a ficha de Jatobá').length - 1).toBe(2);
    expect(html).toContain('Demandas');
    expect(html).toContain('Conteúdo');
  });

  it('com vínculo mas SEM o nome, nada é desenhado — nem nome, nem atalho', () => {
    const html = desenhar([
      {
        ...base,
        listId: 'l1',
        listName: 'Demandas',
        listIsLive: true,
        clientId: 'cli-1',
        clientName: null,
      },
    ]);
    expect(html).toContain('Demandas');
    expect(html).not.toContain('Abrir a ficha de');
    expect(html).not.toContain('href="/cliente/');
    expect(html).not.toContain('data-cliente-da-lista');
  });
});
