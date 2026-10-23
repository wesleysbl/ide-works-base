/**
 * O SELO DE ORIGEM NAS TELAS — F26, fase 9.
 *
 * O QUE ESTE ARQUIVO GUARDA
 *   Que *"Carla, via ChatGPT"* aparece nos quatro lugares onde a IA de alguém
 *   escreve — a tarefa (quem criou), cada evento do histórico da tarefa, a nota
 *   do mural e o registro do histórico do cliente — e que a linha escrita por
 *   GENTE não ganha selo nenhum, nem cápsula vazia.
 *
 *   A marca nasce no banco (F26.2, gatilho a partir da sessão); a leitura da
 *   tela a traz como `viaName`/`createdVia`. O caminho inteiro no navegador,
 *   com a API simulada, é `scripts/e2e/selo-de-origem.mjs`.
 *
 * SEM NAVEGADOR, E POR ISSO SEM `useEffect`
 *   O mural e o histórico do cliente carregam num efeito; por isso a nota e o
 *   registro viraram peças próprias (`NotaDoMural`, `RegistroDoHistorico`),
 *   que recebem tudo por propriedade. O que se desenha aqui é o que a pessoa vê.
 *
 * ESCRITO EM `createElement`, E NÃO EM JSX
 *   A suíte só inclui `*.test.ts`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { ConversaDaTarefa } from '@/board/ConversaDaTarefa';
import { type TaskDetail, rodapeDaFicha } from '@/board/ficha';
import { type EventoDaTarefa, montarHistorico } from '@/board/historico';
import { MovimentacaoDaTarefa } from '@/board/MovimentacaoDaTarefa';
import { SEM_PROGRESSO } from '@/board/passos';
import { type Evento, RegistroDoHistorico } from '@/clients/Historico';
import { type Nota, NotaDoMural } from '@/clients/Mural';
import { SeloDeOrigem } from '@/ui/SeloDeOrigem';
import { textoDoSeloDeOrigem } from '@/ui/selo-de-origem';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fonte = (arquivo: string) => readFileSync(join(RAIZ, arquivo), 'utf8');

/** Quantas cápsulas `o-selo` o HTML desenhou. */
const selos = (html: string) => (html.match(/class="o-selo"/g) ?? []).length;

/* ─────────────────────────── a frase ─────────────────────────── */

describe('a frase do selo', () => {
  it('com a pessoa: "Carla, via ChatGPT"', () => {
    expect(textoDoSeloDeOrigem('ChatGPT', 'Carla')).toBe('Carla, via ChatGPT');
  });

  it('sem a pessoa (o nome já está ao lado): "via ChatGPT"', () => {
    expect(textoDoSeloDeOrigem('ChatGPT')).toBe('via ChatGPT');
    expect(textoDoSeloDeOrigem('ChatGPT', '  ')).toBe('via ChatGPT');
  });

  it('linha de gente não tem frase — nulo, ausente e em branco são a mesma coisa', () => {
    expect(textoDoSeloDeOrigem(null, 'Carla')).toBeNull();
    expect(textoDoSeloDeOrigem(undefined, 'Carla')).toBeNull();
    expect(textoDoSeloDeOrigem('   ', 'Carla')).toBeNull();
  });

  it('o selo reaproveita a cápsula neutra do comentário e diz a frase inteira no `title`', () => {
    const html = renderToStaticMarkup(
      createElement(SeloDeOrigem, { via: 'ChatGPT', pessoa: 'Carla', nomeAoLado: true }),
    );
    expect(html).toContain('class="o-selo"');
    // Tom neutro: sem `data-tom`, a mesma cápsula do selo do comentário.
    expect(html).not.toContain('data-tom');
    expect(html).toContain('>via ChatGPT<');
    expect(html).toContain('title="Escrito pela IA ChatGPT, em nome de Carla"');
  });

  it('selo sem conexão não desenha nada', () => {
    expect(renderToStaticMarkup(createElement(SeloDeOrigem, { via: null, pessoa: 'Carla' }))).toBe('');
  });
});

/* ─────────────────────── a tarefa: quem criou ─────────────────────── */

const FICHA: TaskDetail = {
  id: 't-selo',
  title: 'Pauta de outubro',
  description: null,
  listId: 'l1',
  listName: 'Clinimax',
  folderId: null,
  folderName: null,
  spaceId: 's1',
  spaceName: 'AGÊNCIA IDE',
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
  createdBy: { id: 'u-carla', name: 'Carla' },
  createdAt: '2026-09-22T10:00:00.000Z',
  updatedAt: '2026-09-22T10:00:00.000Z',
  statuses: [],
  statusSetName: 'Demandas',
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

const conversa = (tarefa: TaskDetail): string =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(ConversaDaTarefa, {
        tarefa,
        ocupado: false,
        aoAssentar: () => {},
        aoErro: () => {},
      }),
    ),
  );

describe('a tarefa criada pela IA', () => {
  it('a linha "criou esta tarefa" leva "via Claude" ao lado do nome de quem pediu', () => {
    const html = conversa({ ...FICHA, createdVia: 'Claude' });
    expect(html).toContain('criou esta tarefa');
    expect(html).toContain('>Carla<');
    expect(html).toContain('>via Claude<');
    // O nome não se repete dentro do selo: ele já é o sujeito da linha.
    expect(html).not.toContain('Carla, via Claude');
  });

  it('⚠️ tarefa criada por gente: a mesma linha, SEM selo', () => {
    for (const createdVia of [null, undefined]) {
      const html = conversa({ ...FICHA, createdVia });
      expect(html).toContain('criou esta tarefa');
      expect(html).not.toContain('via ');
      expect(selos(html)).toBe(0);
    }
  });

  it('o "Criada por" da ficha diz "Carla, via ChatGPT"; o de gente, só o nome', () => {
    const porIa = rodapeDaFicha({ ...FICHA, createdVia: 'ChatGPT' });
    expect(porIa.find((l) => l.rotulo === 'Criada por')?.valor).toBe('Carla, via ChatGPT');
    const porGente = rodapeDaFicha(FICHA);
    expect(porGente.find((l) => l.rotulo === 'Criada por')?.valor).toBe('Carla');
  });
});

/* ─────────────────── o histórico da tarefa: cada evento ─────────────────── */

const ATRIBUIU: EventoDaTarefa = {
  id: '501',
  automationName: null,
  actorName: 'Carla',
  fromListName: null,
  toListName: null,
  fromStatusName: null,
  toStatusName: null,
  removed: [],
  added: ['Ana'],
  occurredAt: '2026-09-22T11:00:00.000Z',
};

const linha = (evento: EventoDaTarefa) => {
  const [item] = montarHistorico({ criadaPor: null, criadaEm: FICHA.createdAt, eventos: [evento], falas: [] });
  if (item === undefined || item.tipo === 'comentario') throw new Error('sem degrau');
  return renderToStaticMarkup(createElement(MovimentacaoDaTarefa, { item }));
};

describe('cada evento do histórico da tarefa', () => {
  it('feito pela IA: "Carla" + "via ChatGPT", e a frase de sempre', () => {
    const html = linha({ ...ATRIBUIU, viaName: 'ChatGPT' });
    expect(html).toContain('>Carla<');
    expect(html).toContain('>via ChatGPT<');
    expect(html).toContain('adicionou o responsável: Ana');
    expect(html).toContain('title="Escrito pela IA ChatGPT, em nome de Carla"');
  });

  it('⚠️ feito por gente: nenhum selo', () => {
    for (const viaName of [null, undefined]) {
      const html = linha({ ...ATRIBUIU, viaName });
      expect(html).toContain('adicionou o responsável: Ana');
      expect(html).not.toContain('via ');
      expect(selos(html)).toBe(0);
    }
  });

  it('a regra que a IA disparou mostra os dois selos, e não atribui a regra a uma pessoa', () => {
    const html = linha({ ...ATRIBUIU, automationName: 'Passa para o atendimento', viaName: 'Claude' });
    expect(html).toContain('automação');
    expect(html).toContain('>via Claude<');
    expect(html).toContain('title="Escrito pela IA Claude"');
  });

  it('eventos vindos na ficha chegam à linha do tempo com o selo', () => {
    const html = conversa({
      ...FICHA,
      createdBy: null,
      history: [{ ...ATRIBUIU, viaName: 'ChatGPT' }, { ...ATRIBUIU, id: '502', added: ['Bia'] }],
    });
    expect(html).toContain('adicionou o responsável: Ana');
    expect(html).toContain('adicionou o responsável: Bia');
    // Um selo só: o do evento da IA. O humano, ao lado, fica sem.
    expect((html.match(/>via ChatGPT</g) ?? []).length).toBe(1);
  });
});

/* ─────────────────────────── a nota do mural ─────────────────────────── */

const NOTA: Nota = {
  id: 'n1',
  title: 'Acesso',
  content: 'A senha do Instagram mudou.',
  color: 'yellow',
  positionX: 16,
  positionY: 16,
  width: 220,
  height: 160,
};

const nota = (n: Nota) =>
  renderToStaticMarkup(
    createElement(NotaDoMural, {
      nota: n,
      editando: false,
      aoPegar: () => {},
      aoFocar: () => {},
      aoSoltarFoco: () => {},
      aoGravar: () => {},
      aoTrocarCor: () => {},
      aoApagar: () => {},
    }),
  );

describe('a nota do mural', () => {
  it('escrita pela IA: "Carla, via Claude" — o mural não mostra autor em outro lugar', () => {
    const html = nota({ ...NOTA, viaName: 'Claude', viaAuthorName: 'Carla' });
    expect(html).toContain('A senha do Instagram mudou.');
    expect(html).toContain('>Carla, via Claude<');
    // O texto encolhe para dar lugar ao pé com o selo.
    expect(html).toContain('h-[calc(100%-3.4rem)]');
  });

  it('⚠️ escrita por gente: nenhum selo, e a altura do texto de antes', () => {
    for (const viaName of [null, undefined]) {
      const html = nota({ ...NOTA, viaName, viaAuthorName: null });
      expect(html).toContain('A senha do Instagram mudou.');
      expect(html).not.toContain('via ');
      expect(selos(html)).toBe(0);
      expect(html).toContain('h-[calc(100%-1.75rem)]');
    }
  });

  it('autor sumido do diretório: o selo ainda diz a conexão', () => {
    expect(nota({ ...NOTA, viaName: 'Claude', viaAuthorName: null })).toContain('>via Claude<');
  });
});

/* ──────────────────── o registro do histórico do cliente ──────────────────── */

const REGISTRO: Evento = {
  id: 'h1',
  happenedOn: '2026-09-22',
  title: 'Reunião de alinhamento',
  subtitle: null,
  body: 'Decidimos dobrar os vídeos em outubro.',
  ledBy: { id: 'u-juca', name: 'Juca' },
  ledByNote: null,
  createdAt: '2026-09-22T15:00:00.000Z',
  documents: [],
};

const registro = (e: Evento) =>
  renderToStaticMarkup(
    createElement(RegistroDoHistorico, {
      evento: e,
      abrindo: null,
      aoEditar: () => {},
      aoApagar: () => {},
      aoAbrirDocumento: () => {},
    }),
  );

describe('o registro do histórico do cliente', () => {
  it('escrito pela IA: "Carla, via ChatGPT", ao lado de quem conduziu', () => {
    const html = registro({ ...REGISTRO, viaName: 'ChatGPT', viaAuthorName: 'Carla' });
    expect(html).toContain('Reunião de alinhamento');
    expect(html).toContain('Juca');
    expect(html).toContain('>Carla, via ChatGPT<');
  });

  it('⚠️ escrito por gente: nenhum selo', () => {
    for (const viaName of [null, undefined]) {
      const html = registro({ ...REGISTRO, viaName, viaAuthorName: null });
      expect(html).toContain('Reunião de alinhamento');
      expect(html).not.toContain('via ');
      expect(selos(html)).toBe(0);
    }
  });
});

/* ─────────────────────── as leituras trazem a marca ─────────────────────── */

describe('as leituras da tela trazem o nome da conexão', () => {
  // A leitura é SQL contra o Postgres, e a suíte não tem banco. O que se guarda
  // aqui é que a coluna continua pedida — sem ela, o selo some das quatro telas
  // em silêncio, porque ausente e nulo desenham o mesmo: nada.
  it('a ficha pede `t.via_name` e o `e.via_name` de cada evento', () => {
    const s = fonte('src/server/board-task.ts');
    expect(s).toMatch(/\bt\.via_name\b/);
    expect(s).toMatch(/\be\.via_name\b/);
    expect(s).toContain('createdVia:');
    expect(s).toContain('viaName:');
  });

  it('o mural e o histórico do cliente pedem `via_name` e o autor da linha de IA', () => {
    for (const arquivo of ['src/server/mural-e-captacao.ts', 'src/server/history.ts']) {
      const s = fonte(arquivo);
      expect(s, arquivo).toMatch(/via_name/);
      expect(s, arquivo).toContain('via_author_name');
      expect(s, arquivo).toContain('viaAuthorName:');
    }
  });
});
