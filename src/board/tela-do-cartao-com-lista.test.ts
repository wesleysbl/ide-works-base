/**
 * O CARTÃO DIZ DE QUE LISTA ELE É — etapa F17.64.
 *
 * POR QUE ESTE TESTE EXISTE
 *   No quadro da pasta a coluna `a fazer arte` junta as tarefas de vinte e
 *   cinco clientes. Um cartão sem procedência ali é um pedido de trabalho sem
 *   cliente — quem pega não sabe para quem está fazendo. O usuário nomeou o
 *   defeito antes de ele existir: *"sem isso, tarefa de 29 clientes na mesma
 *   coluna vira sopa"*.
 *
 * ⚠️ E A AUSÊNCIA TAMBÉM É TESTADA
 *   No quadro da LISTA o nome não aparece, e isso não é esquecimento: ali a
 *   lista é o título da tela, e repeti-la em cinquenta cartões seria escrever o
 *   mesmo nome cinquenta vezes. Sem este segundo caso, a próxima sessão poria a
 *   procedência em todo cartão "para ficar consistente".
 *
 * ESCRITO EM `createElement`, E NÃO EM JSX: a suíte só inclui `*.test.ts`.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { type BoardTask, type Day } from '@/board/board';
import { CorpoDoCartao } from '@/board/CartaoDeTarefa';

const HOJE: Day = { year: 2026, month: 9, day: 3 };

const tarefa: BoardTask = {
  id: 'a1',
  title: '[A] VALENTINI - ARTE SACOLA',
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
};

const desenhar = (lista?: { id: string; name: string }): string =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(CorpoDoCartao, { tarefa, hoje: HOJE, lista }),
    ),
  );

describe('o cartão no quadro da pasta', () => {
  it('diz de que lista ele é', () => {
    const html = desenhar({ id: 'l1', name: 'Valentini' });
    expect(html).toContain('Valentini');
  });

  it('e o nome da lista é um LINK para o quadro dela', () => {
    // Quem quer ver só aquele cliente está a um clique, e o alvo é o endereço
    // de sempre — não um terceiro caminho para a mesma tela.
    const html = desenhar({ id: 'l1', name: 'Valentini' });
    expect(html).toContain('href="/quadro/l1"');
  });

  it('e o link NÃO arrasta', () => {
    /* O `<li>` é que arrasta (F17.25), e link nasce arrastável no navegador:
       sem isto, puxar o cartão pelo nome da lista largaria uma URL em vez de
       mover a tarefa de etapa. */
    const html = desenhar({ id: 'l1', name: 'Valentini' });
    const trecho = html.slice(html.indexOf('q-lista-do-cartao'));
    expect(trecho.slice(0, 200)).toContain('draggable="false"');
  });
});

describe('o mesmo cartão no quadro da lista', () => {
  it('NÃO repete o nome da lista', () => {
    const html = desenhar(undefined);
    expect(html).not.toContain('q-lista-do-cartao');
  });

  it('e continua desenhando o que sempre desenhou', () => {
    expect(desenhar(undefined)).toContain('[A] VALENTINI - ARTE SACOLA');
  });
});
