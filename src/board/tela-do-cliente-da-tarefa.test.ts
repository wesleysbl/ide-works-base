/**
 * O CLIENTE DA TAREFA NA TELA — F38, Fase 7.
 *
 * Desenhado no servidor (`renderToStaticMarkup`): nenhum `useEffect` roda, e
 * a lista de clientes — que só é pedida ao ABRIR o seletor — não chega aqui.
 * O que se prova é o primeiro quadro de cada peça e a regra pura. O fluxo
 * inteiro (marcar a lista na árvore, criar sem cliente e ver o erro, criar com
 * cliente, trocar no cartão) está em `scripts/e2e/cliente-da-tarefa.mjs`.
 *
 * Escrito em `createElement`: a suíte só inclui `*.test.ts`.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { CARTOES_POR_COLUNA, type Board } from '@/board/board';
import { ChipDoClienteNaCriacao, ClienteNaFicha, MenuDeClientes } from '@/board/ClienteDaTarefa';
import {
  FRASE_FALTA_CLIENTE,
  faltaCliente,
  origemDoCliente,
  tipoDaLista,
  trocaDeCliente,
} from '@/board/cliente-no-cartao';
import { SEM_FILTRO } from '@/board/filtro';
import { ModalDeTarefa } from '@/board/ModalDeTarefa';
import { AdicionarNaColuna } from '@/board/pecas-da-ficha';

const semRota = (elemento: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, elemento));

const FONSECA = 'aaaa0003-0000-4000-8000-000000000001';
const CHARME = '11111111-2222-3333-4444-555555555555';

const quadro = (header: Partial<Board['header']>): Board => ({
  header: {
    listId: 'aaaa0001-0000-4000-8000-000000000001',
    listName: 'ATENDIMENTO',
    listContent: null,
    folderId: null,
    folderName: null,
    spaceId: 'aaaaaaaa-0000-0000-0000-000000000000',
    spaceName: 'AGÊNCIA IDE',
    categoryName: 'Ide',
    statusSetName: 'Demandas',
    inheritedFrom: 'space',
    ...header,
  },
  statuses: [{ id: 's1', name: 'a fazer', type: 'open', color: '#d3d3d3', sortOrder: 0 }],
  tasks: [],
  availableTags: [],
  columnTotals: {},
  columnMatched: {},
  perColumn: CARTOES_POR_COLUNA,
  assigneeOptions: [],
  unassignedTasks: 0,
  filter: SEM_FILTRO,
});

/* ───────────────────────────── a regra pura ───────────────────────────── */

describe('a regra do cliente na tela', () => {
  it('três tipos de lista: de cliente, compartilhada e interna', () => {
    expect(tipoDaLista({ clientId: FONSECA })).toBe('cliente');
    expect(tipoDaLista({ clientId: FONSECA, requiresClient: true })).toBe('cliente');
    expect(tipoDaLista({ clientId: null, requiresClient: true })).toBe('compartilhada');
    expect(tipoDaLista({ clientId: null, requiresClient: false })).toBe('interna');
    // Servidor de antes da Fase 7 não manda a marca: vale interna.
    expect(tipoDaLista({})).toBe('interna');
  });

  it('só a lista compartilhada exige o cliente ao criar', () => {
    expect(faltaCliente({ requiresClient: true }, null)).toBe(FRASE_FALTA_CLIENTE);
    expect(faltaCliente({ requiresClient: true }, undefined)).toBe(FRASE_FALTA_CLIENTE);
    expect(faltaCliente({ requiresClient: true }, FONSECA)).toBeNull();
    expect(faltaCliente({ requiresClient: false }, null)).toBeNull();
    expect(faltaCliente({ clientId: FONSECA }, null)).toBeNull();
  });

  it('de onde veio o cliente: da lista, escolhido na tarefa ou diferente do da lista', () => {
    // Sem cliente próprio, o da lista vale — herança.
    expect(origemDoCliente({ clientId: FONSECA, ownClientId: null, listClientId: FONSECA })).toBe('lista');
    // O gatilho grava o da lista ao criar: o mesmo id é herança também.
    expect(origemDoCliente({ clientId: FONSECA, ownClientId: FONSECA, listClientId: FONSECA.toUpperCase() })).toBe('lista');
    // Lista sem cliente: o cliente é o escolhido na tarefa.
    expect(origemDoCliente({ clientId: FONSECA, ownClientId: FONSECA, listClientId: null })).toBe('tarefa');
    // Tarefa movida com o cliente antigo: o cartão mostra a diferença.
    expect(origemDoCliente({ clientId: CHARME, ownClientId: CHARME, listClientId: FONSECA })).toBe('diferente');
    expect(origemDoCliente({ clientId: null, ownClientId: null, listClientId: null })).toBeNull();
  });

  it('o que o cartão deixa trocar espelha as recusas do servidor', () => {
    const base = {
      listId: 'l1',
      parentId: null,
      subtasks: [],
      clientId: null,
      ownClientId: null,
      listClientId: null,
      listRequiresClient: false,
    };
    expect(trocaDeCliente(base)).toEqual({ pode: true, opcoes: 'clientes', semCliente: true });
    expect(trocaDeCliente({ ...base, listRequiresClient: true })).toEqual({
      pode: true,
      opcoes: 'clientes',
      semCliente: false,
    });
    // Lista de cliente: herdado não se troca; o diferente só volta ao da lista.
    expect(trocaDeCliente({ ...base, clientId: FONSECA, listClientId: FONSECA }).pode).toBe(false);
    expect(
      trocaDeCliente({ ...base, clientId: CHARME, ownClientId: CHARME, listClientId: FONSECA }),
    ).toEqual({ pode: true, opcoes: 'lista' });
    // O banco trava estes dois: o cartão diz por quê, sem chip que volta recusado.
    expect(trocaDeCliente({ ...base, parentId: 'mae' })).toMatchObject({ pode: false });
    expect(trocaDeCliente({ ...base, subtasks: [{}] })).toMatchObject({ pode: false });
    expect(trocaDeCliente({ ...base, listId: null })).toMatchObject({ pode: false });
  });
});

/* ───────────────────────────── a criação ───────────────────────────── */

describe('o modal de tarefa nova pede o cliente conforme a lista', () => {
  const modal = (header: Partial<Board['header']>) =>
    semRota(
      createElement(ModalDeTarefa, {
        quadro: quadro(header),
        arvore: [],
        aoFechar: () => {},
        aoCriar: () => {},
      }),
    );

  it('lista COMPARTILHADA: o chip diz que o cliente é obrigatório', () => {
    const html = modal({ requiresClient: true });
    expect(html).toContain('data-cliente-da-criacao="compartilhada"');
    expect(html).toContain('Cliente (obrigatório)');
    // Ainda não tentou criar: o chip não nasce em erro.
    expect(html).not.toContain('data-erro="true"');
  });

  it('lista INTERNA: "Interna, sem cliente" é o valor de partida', () => {
    const html = modal({ requiresClient: false });
    expect(html).toContain('data-cliente-da-criacao="interna"');
    expect(html).toContain('Interna, sem cliente');
    expect(html).not.toContain('obrigatório');
  });

  it('lista de CLIENTE: mostra o cliente da lista, sem seletor', () => {
    const html = modal({ listName: 'Fonseca Moura', clientId: FONSECA, clientName: 'Fonseca Moura' });
    expect(html).toContain('data-cliente-da-criacao="lista"');
    expect(html).toContain('Fonseca Moura · da lista');
    // Sem botão: não há o que escolher.
    expect(html).not.toMatch(/<button[^>]*data-cliente-da-criacao/);
  });

  it('chip em erro quando a pessoa tentou criar sem o cliente', () => {
    const html = semRota(
      createElement(ChipDoClienteNaCriacao, {
        listId: 'l1',
        lista: { requiresClient: true },
        valor: null,
        valorNome: null,
        aoMudar: () => {},
        aberto: false,
        aoAlternar: () => {},
        faltando: true,
      }),
    );
    expect(html).toContain('data-erro="true"');
    expect(html).toContain('aria-label="Escolher o cliente (obrigatório)"');
  });

  it('o escolhido aparece pelo nome', () => {
    const html = semRota(
      createElement(ChipDoClienteNaCriacao, {
        listId: 'l1',
        lista: { requiresClient: true },
        valor: FONSECA,
        valorNome: 'Fonseca Moura',
        aoMudar: () => {},
        aberto: false,
        aoAlternar: () => {},
        faltando: true,
      }),
    );
    expect(html).toContain('Fonseca Moura');
    expect(html).not.toContain('data-erro="true"');
  });

  it('o `+ Adicionar tarefa` continua fechado e curto em toda lista', () => {
    const html = semRota(
      createElement(AdicionarNaColuna, {
        statusId: 's1',
        aoCriar: async () => true,
        lista: { listId: 'l1', clientId: null, requiresClient: true },
      }),
    );
    expect(html).toContain('+ Adicionar tarefa');
    expect(html).not.toContain('data-cliente-rapido');
  });
});

/* ───────────────────────────── o menu ───────────────────────────── */

describe('o menu de clientes', () => {
  const CLIENTES = [
    { id: FONSECA, name: 'Fonseca Moura' },
    { id: CHARME, name: 'Charme' },
  ];
  const menu = (semCliente: boolean, valor: string | null) =>
    renderToStaticMarkup(
      createElement(MenuDeClientes, {
        clientes: CLIENTES,
        carregando: false,
        erro: null,
        valor,
        semCliente,
        aoEscolher: () => {},
        aoFechar: () => {},
      }),
    );

  it('tem busca, os clientes e o escolhido marcado', () => {
    const html = menu(false, CHARME);
    expect(html).toContain('aria-label="Buscar cliente"');
    expect(html).toContain('Fonseca Moura');
    expect(html.match(/aria-checked="true"/g)?.length).toBe(1);
  });

  it('"Interna, sem cliente" só em lista interna', () => {
    expect(menu(true, null)).toContain('Interna, sem cliente');
    expect(menu(false, null)).not.toContain('Interna, sem cliente');
  });

  it('enquanto lê, diz que está buscando — e não "nenhum cliente"', () => {
    const html = renderToStaticMarkup(
      createElement(MenuDeClientes, {
        clientes: null,
        carregando: true,
        erro: null,
        valor: null,
        semCliente: false,
        aoEscolher: () => {},
        aoFechar: () => {},
      }),
    );
    expect(html).toContain('Buscando os clientes…');
    expect(html).not.toContain('Nenhum cliente');
  });
});

/* ───────────────────────────── o cartão ───────────────────────────── */

describe('o cliente no cartão da tarefa', () => {
  const ficha = (t: Partial<Parameters<typeof ClienteNaFicha>[0]['tarefa']>) =>
    semRota(
      createElement(ClienteNaFicha, {
        tarefa: {
          id: 't1',
          listId: 'l1',
          parentId: null,
          subtasks: [],
          clientId: null,
          clientName: null,
          ownClientId: null,
          listClientId: null,
          listClientName: null,
          listRequiresClient: false,
          ...t,
        },
        aberto: false,
        aoAlternar: () => {},
        ocupado: false,
        aoTrocar: () => {},
      }),
    );

  it('herdado da lista: diz "da lista", sem botão de troca', () => {
    const html = ficha({
      clientId: FONSECA,
      clientName: 'Fonseca Moura',
      ownClientId: FONSECA,
      listClientId: FONSECA,
      listClientName: 'Fonseca Moura',
    });
    expect(html).toContain('data-origem-do-cliente="lista"');
    expect(html).toContain('da lista');
    expect(html).not.toContain('Trocar o cliente');
    expect(html).toContain('Lista de cliente: a tarefa fica com o cliente da lista.');
  });

  it('escolhido na tarefa numa lista compartilhada: troca à mão', () => {
    const html = ficha({
      clientId: FONSECA,
      clientName: 'Fonseca Moura',
      ownClientId: FONSECA,
      listRequiresClient: true,
    });
    expect(html).toContain('escolhido na tarefa');
    expect(html).toContain('aria-label="Cliente: Fonseca Moura. Trocar o cliente"');
  });

  it('movida com o cliente antigo: mostra a diferença e oferece o da lista', () => {
    const html = ficha({
      clientId: CHARME,
      clientName: 'Charme',
      ownClientId: CHARME,
      listClientId: FONSECA,
      listClientName: 'Fonseca Moura',
    });
    expect(html).toContain('data-origem-do-cliente="diferente"');
    expect(html).toContain('diferente do da lista (lista: Fonseca Moura)');
    expect(html).toContain('Trocar o cliente');
  });

  it('sem cliente numa lista compartilhada: o chip em erro e o que falta', () => {
    const html = ficha({ listRequiresClient: true });
    expect(html).toContain('Sem cliente');
    expect(html).toContain('data-erro="true"');
    expect(html).toContain('lista compartilhada: escolha o cliente');
  });

  it('subtarefa: o cliente é o da mãe, e o cartão diz por quê', () => {
    const html = ficha({ parentId: 'mae', clientId: FONSECA, clientName: 'Fonseca Moura', listRequiresClient: true });
    expect(html).not.toContain('Trocar o cliente');
    expect(html).toContain('Subtarefa usa o cliente da tarefa-mãe.');
  });
});
