/**
 * LISTA | KANBAN DO ESCOPO — F18B (R09). As decisões puras e as peças
 * desenhadas sem efeito (`renderToStaticMarkup`). O gesto — alternar, filtrar,
 * paginar, voltar da ficha — se prova em `scripts/e2e/lista-kanban.mjs`.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { type Day } from '@/board/board';
import {
  TETO_DE_MODOS,
  agruparLinhas,
  aplicarMovimento,
  destinoDaEtapa,
  etapaVizinha,
  kanbanDoEscopo,
  lembrarModo,
  modoParaEndereco,
  modoValido,
  modosValidos,
  opcoesDeEtapa,
  opcoesDeLista,
  opcoesDePasta,
  origemDaLinha,
  resolverModo,
  textoDoAlcance,
} from '@/board/lista-kanban';
import { ListaDoEscopo } from '@/board/ListaDoEscopo';
import { SeletorDeModo } from '@/board/SeletorDeForma';
import {
  type CatalogoDoEscopo,
  type FluxoDoEscopo,
  type LinhaDoEscopo,
  SEM_FILTRO_DO_ESCOPO,
} from '@/board/tarefas-do-escopo';
import { juntarLote, lerCarregadas, primeiroLote } from '@/board/usar-tarefas-do-escopo';
import { lerLugar } from '@/ui/lugar';

const HOJE: Day = { year: 2026, month: 9, day: 29 };

const linha = (id: string, extra: Partial<LinhaDoEscopo> = {}): LinhaDoEscopo => ({
  id,
  title: `Tarefa ${id}`,
  statusId: 'v-afazer',
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
  categoryName: 'Ide',
  spaceName: 'Espaço',
  folderName: 'TIME A',
  listId: 'l-video',
  listName: 'Vídeos',
  listLive: true,
  statusName: 'A fazer',
  statusType: 'open',
  statusColor: '#87909e',
  assignedToMe: false,
  createdByMe: false,
  otherAssignees: 0,
  spaceId: 'e1',
  folderId: 'p-a',
  workflowId: 'f-video',
  workflowName: 'Vídeo',
  statusSortOrder: 0,
  ...extra,
});

const etapa = (id: string, name: string, sortOrder: number, total = 1, matched = total) => ({
  id, name, type: 'open' as const, color: null, sortOrder, total, matched,
});

/** Dois fluxos com uma etapa de MESMO NOME (`A fazer`). */
const FLUXOS: FluxoDoEscopo[] = [
  { id: 'f-video', name: 'Vídeo', lists: 2, etapas: [etapa('v-afazer', 'A fazer', 0, 2), etapa('v-edicao', 'Edição', 1, 1), etapa('v-feito', 'Feito', 2, 0)] },
  { id: 'f-arte', name: 'Arte', lists: 1, etapas: [etapa('a-afazer', 'A fazer', 0, 1), etapa('a-aprov', 'Aprovação', 1, 0)] },
  { id: 'f-vazio', name: 'Sem uso', lists: 1, etapas: [etapa('z-1', 'A fazer', 0, 0)] },
];

describe('o modo — endereço, preferência da tela, do tipo, padrão', () => {
  it('o espaço oferece Panorama, Lista e Kanban; a pasta, só Lista e Kanban', () => {
    expect(modoValido('panorama', 'espaco')).toBe('panorama');
    expect(modoValido('panorama', 'pasta')).toBeNull();
    expect(modoValido(' KANBAN ', 'pasta')).toBe('kanban');
    expect(modoValido('lixo', 'espaco')).toBeNull();
    expect(modoValido('panorama', 'checklist')).toBeNull();
  });

  it('F18C: `?ver=quadro` (o nome antigo em Minhas/Todas) é o Kanban em qualquer tela', () => {
    expect(modoValido('quadro', 'pessoal')).toBe('kanban');
    expect(modoValido('Quadro', 'global')).toBe('kanban');
    expect(modoValido('quadro', 'espaco')).toBe('kanban');
    expect(resolverModo({ doEndereco: 'quadro', guardados: {}, contexto: 'pessoal' })).toBe('kanban');
  });

  it('F18C: cada tela de trabalho tem o seu padrão, e as listas do cliente abrem na Lista', () => {
    expect(resolverModo({ doEndereco: null, guardados: {}, contexto: 'pasta', id: 'p1' })).toBe('kanban');
    expect(resolverModo({ doEndereco: null, guardados: {}, contexto: 'lista', id: 'l1' })).toBe('kanban');
    expect(resolverModo({ doEndereco: null, guardados: {}, contexto: 'global' })).toBe('lista');
    expect(resolverModo({ doEndereco: null, guardados: {}, contexto: 'checklist', id: 'c1' })).toBe('lista');
    expect(resolverModo({ doEndereco: null, guardados: {}, contexto: 'conteudos', id: 'c1' })).toBe('lista');
  });

  it('F18C: a escolha numa tela não vaza para outra de outro tipo', () => {
    let g = lembrarModo({}, 'pasta', 'p1', 'lista');
    g = lembrarModo(g, 'checklist', 'c1', 'kanban');
    expect(resolverModo({ doEndereco: null, guardados: g, contexto: 'lista', id: 'l1' })).toBe('kanban');
    expect(resolverModo({ doEndereco: null, guardados: g, contexto: 'espaco', id: 'e1' })).toBe('panorama');
    expect(resolverModo({ doEndereco: null, guardados: g, contexto: 'pessoal' })).toBe('lista');
    expect(resolverModo({ doEndereco: null, guardados: g, contexto: 'conteudos', id: 'c1' })).toBe('lista');
    expect(resolverModo({ doEndereco: null, guardados: g, contexto: 'pasta', id: 'p1' })).toBe('lista');
    expect(resolverModo({ doEndereco: null, guardados: g, contexto: 'checklist', id: 'c1' })).toBe('kanban');
  });

  it('endereço manda; depois a tela; depois o tipo; depois o padrão', () => {
    const guardados = { espaco: 'lista', 'espaco:e1': 'kanban' };
    expect(resolverModo({ doEndereco: 'lista', guardados, contexto: 'espaco', id: 'e1' })).toBe('lista');
    expect(resolverModo({ doEndereco: null, guardados, contexto: 'espaco', id: 'e1' })).toBe('kanban');
    expect(resolverModo({ doEndereco: null, guardados, contexto: 'espaco', id: 'e2' })).toBe('lista');
    expect(resolverModo({ doEndereco: 'banana', guardados: {}, contexto: 'espaco', id: 'e2' })).toBe('panorama');
    expect(resolverModo({ doEndereco: null, guardados: {}, contexto: 'pessoal' })).toBe('lista');
  });

  it('trocar no espaço não mexe na pasta, na lista nem nas telas da pessoa', () => {
    const antes = { pasta: 'lista', 'pasta:p1': 'lista', pessoal: 'kanban' };
    const depois = lembrarModo(antes, 'espaco', 'e1', 'kanban');
    expect(depois).toEqual({ ...antes, espaco: 'kanban', 'espaco:e1': 'kanban' });
    expect(resolverModo({ doEndereco: null, guardados: depois, contexto: 'pasta', id: 'p1' })).toBe('lista');
  });

  it('o padrão não vai para o endereço', () => {
    expect(modoParaEndereco('panorama', 'espaco')).toBe('');
    expect(modoParaEndereco('lista', 'espaco')).toBe('lista');
    expect(modoParaEndereco('kanban', 'pasta')).toBe('');
  });

  it('guardado torto vira nada, e o teto corta os mais antigos', () => {
    expect(modosValidos(null)).toEqual({});
    expect(modosValidos(['lista'])).toEqual({});
    expect(modosValidos({ a: 'lista', b: 'quadro', c: 3, '': 'kanban' })).toEqual({ a: 'lista' });
    const muitos = Object.fromEntries(Array.from({ length: TETO_DE_MODOS + 5 }, (_, i) => [`espaco:${i}`, 'lista']));
    const saneados = modosValidos(muitos);
    expect(Object.keys(saneados)).toHaveLength(TETO_DE_MODOS);
    expect(saneados['espaco:0']).toBeUndefined();
    expect(saneados[`espaco:${TETO_DE_MODOS + 4}`]).toBe('lista');
  });

  it('`ideworks:lugar` antigo, sem `modos`, lê vazio', () => {
    expect(lerLugar(JSON.stringify({ lista: 'x' })).modos).toEqual({});
    expect(lerLugar(JSON.stringify({ modos: { 'espaco:e1': 'kanban', x: 'y' } })).modos).toEqual({ 'espaco:e1': 'kanban' });
  });
});

describe('agrupar a Lista', () => {
  const linhas = [
    linha('1', { listId: 'l-b', listName: 'Bravo', folderId: 'p-a', folderName: 'TIME A' }),
    linha('2', { listId: 'l-solta', listName: 'Avulsa', folderId: null, folderName: null }),
    linha('3', { listId: 'l-a', listName: 'Alfa', clientName: 'Cliente Alfa', folderId: 'p-a', folderName: 'TIME A' }),
    linha('4', { listId: 'l-b', listName: 'Bravo', folderId: 'p-a', folderName: 'TIME A' }),
  ];

  it('por time e cliente: um grupo por lista, as soltas no fim, a origem sai da linha', () => {
    const grupos = agruparLinhas(linhas, 'origem');
    expect(grupos.map((g) => g.titulo)).toEqual(['Bravo', 'Cliente Alfa · Alfa', 'Avulsa']);
    expect(grupos.map((g) => g.sobre)).toEqual(['TIME A', 'TIME A', 'Sem pasta']);
    expect(grupos[0].linhas.map((l) => l.id)).toEqual(['1', '4']);
    expect(grupos.every((g) => g.omite.origem && !g.omite.etapa)).toBe(true);
  });

  it('por etapa: a etapa REAL — duas `A fazer` de fluxos diferentes são dois grupos', () => {
    const grupos = agruparLinhas(
      [linha('v'), linha('a', { statusId: 'a-afazer', workflowId: 'f-arte' }), linha('x', { statusId: 'outro' })],
      'etapa',
      FLUXOS,
    );
    expect(grupos.map((g) => [g.titulo, g.sobre])).toEqual([
      ['A fazer', 'Vídeo'],
      ['A fazer', 'Arte'],
      ['Sem etapa', null],
    ]);
    expect(grupos.every((g) => g.omite.etapa)).toBe(true);
    expect(grupos[0].achadas).toBe(2);
  });

  it('sem grupos: um bloco só, sem cabeçalho, com tudo na linha', () => {
    const [g] = agruparLinhas(linhas, 'nenhum');
    expect(g.titulo).toBeNull();
    expect(g.linhas).toHaveLength(4);
    expect(g.omite).toEqual({ origem: false, etapa: false });
    expect(agruparLinhas([], 'nenhum')).toEqual([]);
  });

  it('a origem não inventa cliente', () => {
    expect(origemDaLinha({ clientName: null, listName: 'Vídeos' })).toBe('Vídeos');
    expect(origemDaLinha({ clientName: 'FOCUS', listName: 'focus' })).toBe('FOCUS');
    expect(origemDaLinha({ clientName: null, listName: null })).toBe('Sem lista');
  });
});

describe('o Kanban — faixas por fluxo', () => {
  const linhas = [
    linha('v1'),
    linha('v2', { statusId: 'v-edicao' }),
    linha('a1', { statusId: 'a-afazer', workflowId: 'f-arte', listId: 'l-arte', listName: 'Artes' }),
    // Etapa de outro fluxo na lista de vídeo: não cai em coluna nenhuma.
    linha('orfa', { statusId: 'a-aprov' }),
  ];

  it('uma faixa por fluxo com tarefa; as etapas não se mesclam por nome', () => {
    const k = kanbanDoEscopo(FLUXOS, linhas);
    expect(k.faixas.map((f) => f.fluxo.name)).toEqual(['Vídeo', 'Arte']);
    expect(k.faixas[0].colunas.map((c) => [c.etapa.id, c.linhas.map((l) => l.id)])).toEqual([
      ['v-afazer', ['v1']],
      ['v-edicao', ['v2']],
      ['v-feito', []],
    ]);
    expect(k.faixas[1].colunas[0].linhas.map((l) => l.id)).toEqual(['a1']);
    expect(k.semEtapa.map((l) => l.id)).toEqual(['orfa']);
    expect(k.fluxosSemTarefa).toBe(1);
  });

  it('as contagens da coluna são do recorte (banco), não do lote', () => {
    const k = kanbanDoEscopo(FLUXOS, [linha('v1')], { 'v-afazer': { total: 40, matched: 12 } });
    expect(k.faixas[0].colunas[0]).toMatchObject({ achadas: 12 });
    expect(k.faixas[0].colunas[0].linhas).toHaveLength(1);
  });

  it('destino só dentro do fluxo da lista da tarefa — sem conversão silenciosa', () => {
    const v = linha('v1');
    expect(destinoDaEtapa(v, 'v-edicao', FLUXOS)).toMatchObject({ ok: true });
    const outro = destinoDaEtapa(v, 'a-aprov', FLUXOS);
    expect(outro.ok).toBe(false);
    if (!outro.ok) expect(outro.motivo).toContain('usa outro fluxo');
    expect(destinoDaEtapa(v, 'nao-existe', FLUXOS).ok).toBe(false);
    expect(destinoDaEtapa({ ...v, listId: null }, 'v-edicao', FLUXOS).ok).toBe(false);
  });

  it('as setas andam uma etapa, e param na ponta do fluxo', () => {
    expect(etapaVizinha(linha('v1'), FLUXOS, 1)?.id).toBe('v-edicao');
    expect(etapaVizinha(linha('v1'), FLUXOS, -1)).toBeNull();
    expect(etapaVizinha(linha('a', { statusId: 'a-aprov', workflowId: 'f-arte' }), FLUXOS, 1)).toBeNull();
  });

  it('mover ajusta linha e contagens, e desfazer volta ao que era', () => {
    const contas = { 'v-afazer': { total: 2, matched: 2 }, 'v-edicao': { total: 1, matched: 1 } };
    const ida = aplicarMovimento([linha('v1')], contas, 'v1', FLUXOS[0].etapas[1]);
    expect(ida.linhas[0]).toMatchObject({ statusId: 'v-edicao', statusName: 'Edição' });
    expect(ida.statusCounts).toEqual({ 'v-afazer': { total: 1, matched: 1 }, 'v-edicao': { total: 2, matched: 2 } });
    expect(contas['v-afazer'].total).toBe(2);
    const volta = aplicarMovimento(ida.linhas, ida.statusCounts, 'v1', FLUXOS[0].etapas[0]);
    expect(volta.statusCounts).toEqual(contas);
  });
});

describe('o alcance — o lote nunca se passa pelo total', () => {
  const counts = { total: 589, abertas: 122, matched: 122, semEtapa: 0 };

  it('sem filtro: as abertas, e quantas estão carregadas', () => {
    expect(textoDoAlcance({ carregadas: 50, counts, filtro: SEM_FILTRO_DO_ESCOPO, hasMore: true })).toEqual({
      principal: '50 de 122 abertas carregadas',
      base: '589 no total, com as concluídas',
    });
    expect(textoDoAlcance({ carregadas: 122, counts, filtro: SEM_FILTRO_DO_ESCOPO, hasMore: false }).principal).toBe('122 abertas');
  });

  it('com concluídas, o universo é o total', () => {
    const r = textoDoAlcance({ carregadas: 50, counts: { ...counts, matched: 589 }, filtro: { ...SEM_FILTRO_DO_ESCOPO, concluidas: true }, hasMore: true });
    expect(r).toEqual({ principal: '50 de 589 tarefas carregadas', base: null });
  });

  it('com filtro: encontradas, entre as abertas', () => {
    const r = textoDoAlcance({ carregadas: 3, counts: { ...counts, matched: 3 }, filtro: { ...SEM_FILTRO_DO_ESCOPO, texto: 'reels' }, hasMore: false });
    expect(r).toEqual({ principal: '3 encontradas', base: 'entre 122 abertas' });
  });
});

describe('os menus', () => {
  const catalogo: CatalogoDoEscopo = {
    pastas: [{ id: 'p-b', name: 'TIME B', archived: false }, { id: 'p-a', name: 'TIME A', archived: false }],
    listas: [
      { id: 'l1', name: 'Vídeos', folderId: 'p-a', folderName: 'TIME A', clientId: 'c1', clientName: 'FOCUS', archived: false, workflowId: 'f-video' },
      { id: 'l2', name: 'Avulsa', folderId: null, folderName: null, clientId: null, clientName: null, archived: false, workflowId: 'f-video' },
    ],
    fluxos: FLUXOS,
    assigneeOptions: [],
    unassignedTasks: 0,
  };

  it('times em ordem, e `Sem pasta` quando há lista solta', () => {
    expect(opcoesDePasta(catalogo).map((o) => o.rotulo)).toEqual(['TIME A', 'TIME B', 'Sem pasta']);
  });

  it('clientes do time escolhido; `Sem pasta` mostra as soltas', () => {
    expect(opcoesDeLista(catalogo, 'p-a').map((o) => o.rotulo)).toEqual(['FOCUS · Vídeos']);
    expect(opcoesDeLista(catalogo, 'sem').map((o) => o.valor)).toEqual(['l2']);
  });

  it('etapas por fluxo, só as que têm tarefa, pelo id real', () => {
    expect(opcoesDeEtapa(catalogo)).toEqual([
      { fluxo: 'Vídeo', etapas: [{ valor: 'v-afazer', rotulo: 'A fazer' }, { valor: 'v-edicao', rotulo: 'Edição' }] },
      { fluxo: 'Arte', etapas: [{ valor: 'a-afazer', rotulo: 'A fazer' }] },
    ]);
  });
});

describe('os lotes do gancho', () => {
  it('a volta da ficha pede o que havia, dentro do piso e do teto do contrato', () => {
    expect(primeiroLote(0)).toBe(50);
    expect(primeiroLote(80)).toBe(80);
    expect(primeiroLote(300)).toBe(100);
    expect(lerCarregadas('abc')).toBe(0);
    expect(lerCarregadas('-3')).toBe(0);
    expect(lerCarregadas('150')).toBe(150);
  });

  it('juntar lotes não repete tarefa', () => {
    expect(juntarLote([linha('1'), linha('2')], [linha('2'), linha('3')]).map((l) => l.id)).toEqual(['1', '2', '3']);
  });
});

describe('as peças desenhadas', () => {
  const desenhar = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(MemoryRouter, null, el));

  it('o seletor do espaço tem três botões pressionáveis; o da pasta, dois', () => {
    const espaco = desenhar(createElement(SeletorDeModo, { contexto: 'espaco', valor: 'lista', aoEscolher: () => undefined }));
    expect(espaco).toContain('role="group"');
    expect(espaco).toContain('aria-label="Forma de ver"');
    expect(espaco.match(/aria-pressed/g)).toHaveLength(3);
    expect(espaco).toMatch(/aria-pressed="true"[^>]*>.*Lista/);
    const pasta = desenhar(createElement(SeletorDeModo, { contexto: 'pasta', valor: 'kanban', aoEscolher: () => undefined }));
    expect(pasta.match(/aria-pressed/g)).toHaveLength(2);
    expect(pasta).not.toContain('Panorama');
  });

  it('a linha diz "Sem responsável" e "Sem prazo", e não repete a origem que o grupo já diz', () => {
    const l = linha('1', { clientName: 'FOCUS', listName: 'Vídeos' });
    const porOrigem = desenhar(createElement(ListaDoEscopo, { grupos: agruparLinhas([l], 'origem'), hoje: HOJE, hasMore: false }));
    expect(porOrigem).toContain('Sem responsável');
    expect(porOrigem).toContain('Sem prazo');
    expect(porOrigem).toContain('FOCUS · Vídeos'); // no cabeçalho do grupo
    expect(porOrigem).not.toContain('Cliente ou lista: ');
    const semGrupo = desenhar(createElement(ListaDoEscopo, { grupos: agruparLinhas([l], 'nenhum'), hoje: HOJE, hasMore: false }));
    expect(semGrupo).toContain('Cliente ou lista: ');
    expect(semGrupo).toContain('href="/quadro/l-video"');
    expect(semGrupo).toContain('href="/tarefa/1"');
    expect(semGrupo).toContain('aria-expanded="false"');
  });

  it('a régua tem as seis colunas sem grupo, e perde a etapa quando o grupo é a etapa', () => {
    const l = linha('1');
    const semGrupo = desenhar(createElement(ListaDoEscopo, { grupos: agruparLinhas([l], 'nenhum'), hoje: HOJE, hasMore: false }));
    for (const c of ['Tarefa', 'Cliente / lista', 'Time', 'Etapa', 'Responsável', 'Prazo']) expect(semGrupo).toContain(`<span>${c}</span>`);
    const porEtapa = desenhar(createElement(ListaDoEscopo, { grupos: agruparLinhas([l], 'etapa', FLUXOS), hoje: HOJE, hasMore: false }));
    expect(porEtapa).not.toContain('<span>Etapa</span>');
    expect(porEtapa).toContain('data-omite-etapa="true"');
  });
});
