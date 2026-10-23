/**
 * "IR PARA…" — F43, Fase 9. As regras puras da busca e a janela desenhada.
 *
 * O que só o navegador prova — `Ctrl + K` abrindo de verdade, `Enter`
 * navegando, `Esc` devolvendo o foco, o editor rico ficando com o `Ctrl + K`
 * dele — está em `scripts/e2e/ir-para.mjs`. Aqui fica o que decide: o atalho,
 * quem entra na lista, a ordem, o teto de cada grupo e a marcação da janela.
 *
 * ESCRITO EM `createElement`, E NÃO EM JSX — a suíte só inclui `*.test.ts`.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { type Area } from '@/auth/areas';
import { type FullTreeRow, buildFullTree } from '@/board/arvore';
import { atalhoDeTecla } from '@/board/barra-de-comandos';
import { MenuDaConta } from '@/board/ContaNoPe';
import { GatilhoDoIrPara, JanelaDoIrPara } from '@/board/IrPara';
import {
  type Destino,
  TETO_DO_GRUPO,
  destinosDaArvore,
  ehAtalhoDaBusca,
  moverAtivo,
  pontuar,
  procurarTarefas,
  resultadosDoIrPara,
  teclaDoAtalho,
  telasDoIrPara,
} from '@/board/ir-para';
import { ehAtalhoDeRecolher } from '@/board/secao-recolhivel';
import { DESTINO_DO_ITEM, ITENS_DA_BARRA, ROTULO_DO_ITEM } from '@/ui/preferencias';

/* ───────────────────────────── o atalho ───────────────────────────── */

describe('F43 Fase 9: o atalho da busca é `Ctrl + K` ou `⌘ + K`, fora de campo e de janela', () => {
  const tecla = (key: string, extra: Partial<Parameters<typeof ehAtalhoDaBusca>[0]> = {}) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...extra,
  });
  /** Um elemento de mentira com o `closest` que a regra lê. */
  const emJanela = (tagName: string) => ({
    tagName,
    closest: (s: string) => (s === '[role="dialog"]' ? { role: 'dialog' } : null),
  });
  const naPagina = (tagName: string) => ({ tagName, closest: () => null });

  it('Ctrl e ⌘ com o K abrem — com a trava de maiúsculas também', () => {
    expect(ehAtalhoDaBusca(tecla('k', { ctrlKey: true }))).toBe(true);
    expect(ehAtalhoDaBusca(tecla('k', { metaKey: true }))).toBe(true);
    expect(ehAtalhoDaBusca(tecla('K', { ctrlKey: true }))).toBe(true);
  });

  it('o K sozinho é só uma letra', () => {
    expect(ehAtalhoDaBusca(tecla('k'))).toBe(false);
  });

  it('⚠️ com o foco onde se escreve, a tecla é do campo — o editor rico guarda o "inserir link"', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'input']) {
      expect(ehAtalhoDaBusca(tecla('k', { ctrlKey: true, target: { tagName } })), tagName).toBe(false);
    }
    // O parágrafo dentro do `[contenteditable]` do editor herda `isContentEditable`.
    expect(
      ehAtalhoDaBusca(tecla('k', { metaKey: true, target: { tagName: 'P', isContentEditable: true } })),
    ).toBe(false);
    // E o editor continua traduzindo a mesma tecla em link: nada foi tirado dele.
    expect(atalhoDeTecla({ key: 'k', ctrlKey: true, metaKey: false, shiftKey: false })).toBe('link');
  });

  it('fora de campo (a página, um botão, um link) o atalho vale', () => {
    expect(ehAtalhoDaBusca(tecla('k', { ctrlKey: true, target: naPagina('BUTTON') }))).toBe(true);
    expect(ehAtalhoDaBusca(tecla('k', { ctrlKey: true, target: naPagina('A') }))).toBe(true);
    expect(ehAtalhoDaBusca(tecla('k', { metaKey: true, target: { tagName: 'BODY' } }))).toBe(true);
    expect(ehAtalhoDaBusca(tecla('k', { ctrlKey: true, target: null }))).toBe(true);
  });

  it('dentro de outra janela aberta não abre — nada de duas camadas modais', () => {
    expect(ehAtalhoDaBusca(tecla('k', { ctrlKey: true, target: emJanela('BUTTON') }))).toBe(false);
  });

  it('modificador a mais, tecla segurada ou já tratada não contam', () => {
    expect(ehAtalhoDaBusca(tecla('k', { ctrlKey: true, shiftKey: true }))).toBe(false);
    // O AltGr do Windows chega como Ctrl + Alt.
    expect(ehAtalhoDaBusca(tecla('k', { ctrlKey: true, altKey: true }))).toBe(false);
    expect(ehAtalhoDaBusca(tecla('k', { ctrlKey: true, repeat: true }))).toBe(false);
    expect(ehAtalhoDaBusca(tecla('k', { ctrlKey: true, defaultPrevented: true }))).toBe(false);
  });

  it('não se confunde com o `Ctrl + .` de recolher a barra, nem com os do editor', () => {
    expect(ehAtalhoDaBusca(tecla('.', { ctrlKey: true }))).toBe(false);
    expect(ehAtalhoDeRecolher(tecla('k', { ctrlKey: true }))).toBe(false);
    for (const k of ['b', 'i', 's', 'x', 'Enter']) {
      expect(ehAtalhoDaBusca(tecla(k, { ctrlKey: true })), k).toBe(false);
    }
  });

  it('a tecla se escreve `⌘K` no Mac e no iPad, `Ctrl K` no resto', () => {
    for (const p of ['MacIntel', 'macOS', 'iPhone', 'iPad']) expect(teclaDoAtalho(p), p).toBe('⌘K');
    for (const p of ['Win32', 'Windows', 'Linux x86_64', 'Android', '']) expect(teclaDoAtalho(p), p).toBe('Ctrl K');
  });
});

/* ───────────────────────────── as telas ───────────────────────────── */

const tudo = () => true;
const soAs = (...areas: Area[]) => (a: Area) => areas.includes(a);
const destinos = (lista: readonly Destino[]) => lista.map((d) => d.para);

describe('F43 Fase 9: as telas oferecidas são as que a sessão alcança', () => {
  it('quem administra (e alcança tudo) recebe a barra inteira, na ordem dela, e o menu da conta', () => {
    const telas = telasDoIrPara({ alcanca: tudo, souAdmin: true, chatOk: true });
    expect(destinos(telas)).toEqual([
      ...ITENS_DA_BARRA.map((i) => DESTINO_DO_ITEM[i]),
      '/pessoas',
      '/catalogos',
      '/meta',
      '/meta/ranking',
      '/conexoes',
    ]);
    // O nome é o mesmo da barra: a busca não inventa um segundo nome para a tela.
    for (const i of ITENS_DA_BARRA) {
      expect(telas.find((t) => t.para === DESTINO_DO_ITEM[i])?.rotulo).toBe(ROTULO_DO_ITEM[i]);
    }
    expect(telas.find((t) => t.para === '/conexoes')?.rotulo).toBe('Agentes de IA');
  });

  it('o Controle da semana é por PAPEL: área marcada sem ser admin não basta', () => {
    const telas = telasDoIrPara({ alcanca: tudo, souAdmin: false, chatOk: true });
    expect(destinos(telas)).not.toContain('/controle-da-semana');
    // …e as telas de área continuam, que são por área.
    expect(destinos(telas)).toContain('/pessoas');
  });

  it('só com o quadro: nada de entrega, nada de Pessoas, Catálogos e Meta — e Agentes de IA fica', () => {
    const telas = destinos(telasDoIrPara({ alcanca: soAs('quadro'), souAdmin: false, chatOk: false }));
    expect(telas).toEqual(['/avisos', '/meu-trabalho', '/tarefas', '/quadro', '/conexoes']);
  });

  it('com a chave do chat desligada, o Chat não é oferecido', () => {
    expect(destinos(telasDoIrPara({ alcanca: tudo, souAdmin: true, chatOk: false }))).not.toContain('/chat');
  });

  it('com a área da Meta, a Meta e o Ranking de criativos', () => {
    const telas = destinos(telasDoIrPara({ alcanca: soAs('meta'), souAdmin: false, chatOk: false }));
    expect(telas).toEqual(['/meta', '/meta/ranking', '/conexoes']);
  });

  it('⚠️ todo destino do menu da conta está na busca — as duas listas não se separam', () => {
    // O menu é desenhado de verdade, com uma sessão que alcança tudo; o ponto
    // (outro sistema, em aba nova) não é tela daqui.
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(MenuDaConta, {
          sessao: { userId: 'u', email: 'a@b.c', nome: null, isSuperadmin: true, isSuper: true, papel: 'super_admin', areas: [] },
          ancora: null,
          temaAtual: 'escuro',
          saindo: false,
          aoFechar: () => {},
          aoPersonalizar: () => {},
          aoMudarTema: () => {},
          aoSair: () => {},
        }),
      ),
    );
    const doMenu = [...html.matchAll(/<a [^>]*role="menuitem"[^>]*>/g)]
      .map((m) => /href="(\/[^"]*)"/.exec(m[0])?.[1])
      .filter((h): h is string => h !== undefined);
    expect(doMenu.length).toBeGreaterThanOrEqual(4);
    const daBusca = destinos(telasDoIrPara({ alcanca: tudo, souAdmin: true, chatOk: true }));
    for (const d of doMenu) expect(daBusca, d).toContain(d);
  });
});

/* ───────────────────────────── a árvore ───────────────────────────── */

const linha = (p: Partial<FullTreeRow>): FullTreeRow => ({
  spaceId: 'e1',
  spaceName: 'Conteúdo',
  spaceColor: null,
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
  listIsLive: true,
  liveTasks: 0,
  totalTasks: 0,
  clientId: null,
  clientName: null,
  workflowName: null,
  inheritedFrom: null,
  ...p,
});

const ARVORE = buildFullTree([
  linha({ folderId: 'p1', folderName: 'MIMI', listId: 'l1', listName: 'Demandas', clientId: 'cx-mimi', clientName: 'Mimi Store' }),
  linha({ folderId: 'p1', folderName: 'MIMI', listId: 'l2', listName: 'Vídeos', clientId: 'cx-mimi', clientName: 'Mimi Store' }),
  linha({ listId: 'l3', listName: 'Avulsa' }),
  // Cliente que a pessoa não alcança: id sem nome — não vira atalho.
  linha({ listId: 'l4', listName: 'Bastidores', clientId: 'cx-oculto', clientName: null }),
  linha({ listId: 'l5', listName: 'Antiga', listIsLive: false, listArchivedAt: '2026-09-01', clientId: 'cx-velho', clientName: 'Velho Cliente' }),
  linha({ spaceId: 'e2', spaceName: 'Arquivo', spaceArchivedAt: '2026-08-01', listId: 'l6', listName: 'Morta', listIsLive: false }),
  linha({ spaceId: 'e3', spaceName: 'Atendimento', listId: 'l7', listName: 'Abertura', clientId: 'cx-bella', clientName: 'Bella Casa' }),
]);

describe('F43 Fase 9: clientes, espaços, pastas e listas saem da árvore já carregada', () => {
  const { clientes, lugares } = destinosDaArvore(ARVORE, true);

  it('espaço, pasta e lista vivos, cada um com o endereço da tela dele', () => {
    const porChave = new Map(lugares.map((d) => [d.chave, d]));
    expect(porChave.get('espaco:e1')?.para).toBe('/quadro/espaco/e1');
    expect(porChave.get('pasta:p1')?.para).toBe('/quadro/pasta/p1');
    expect(porChave.get('lista:l1')?.para).toBe('/quadro/l1');
    expect(porChave.get('lista:l1')?.detalhe).toBe('Lista · Conteúdo › MIMI');
    expect(porChave.get('lista:l3')?.detalhe).toBe('Lista · Conteúdo');
    expect(porChave.get('pasta:p1')?.detalhe).toBe('Pasta · Conteúdo');
  });

  it('o arquivado não é lugar para onde se vai trabalhar', () => {
    const chaves = lugares.map((d) => d.chave);
    expect(chaves).not.toContain('lista:l5');
    expect(chaves).not.toContain('espaco:e2');
    expect(chaves).not.toContain('lista:l6');
  });

  it('o cliente aparece uma vez, por ordem de nome, e só quando a lista leva à ficha', () => {
    expect(clientes.map((c) => [c.rotulo, c.para])).toEqual([
      ['Bella Casa', '/cliente/cx-bella'],
      ['Mimi Store', '/cliente/cx-mimi'],
    ]);
  });

  it('sem a área da entrega (onde mora a ficha), nenhum cliente é oferecido', () => {
    expect(destinosDaArvore(ARVORE, false).clientes).toEqual([]);
    // As listas continuam: elas são do quadro.
    expect(destinosDaArvore(ARVORE, false).lugares.length).toBe(lugares.length);
  });

  it('dois espaços com o mesmo nome em empresas diferentes levam a empresa na frente', () => {
    const gemeos = buildFullTree([
      linha({ spaceId: 'a', spaceName: 'Demandas', categoryName: 'Ide' }),
      linha({ spaceId: 'b', spaceName: 'Demandas', categoryId: 'c2', categoryName: 'Ide Hub' }),
    ]);
    expect(destinosDaArvore(gemeos, true).lugares.map((d) => d.rotulo)).toEqual(['Ide · Demandas', 'Ide Hub · Demandas']);
  });
});

/* ───────────────────────────── a busca ───────────────────────────── */

describe('F43 Fase 9: a nota de cada destino — começo de palavra antes de pedaço no meio', () => {
  it('nome inteiro, começo do nome, começo de palavra, apelido, pedaço no meio — nesta ordem', () => {
    const plan = { rotulo: 'Planejamento' };
    expect(pontuar('planejamento', plan)).toBe(0);
    expect(pontuar('plan', plan)).toBe(1);
    expect(pontuar('tar to', { rotulo: 'Todas as tarefas' })).toBe(2);
    expect(pontuar('agenda', { rotulo: 'Calendário', apelidos: ['agenda'] })).toBe(3);
    expect(pontuar('nej', plan)).toBe(4);
    expect(pontuar('xyz', plan)).toBeNull();
  });

  it('sem acento e sem caixa, dos dois lados', () => {
    expect(pontuar('calendario', { rotulo: 'Calendário' })).toBe(0);
    expect(pontuar('CATÁ', { rotulo: 'Catálogos' })).toBe(1);
    expect(pontuar('mes', { rotulo: 'Planejamento', apelidos: ['mês do cliente'] })).toBe(3);
  });

  it('consulta vazia não pontua ninguém', () => {
    expect(pontuar('   ', { rotulo: 'Painel' })).toBeNull();
  });
});

describe('F43 Fase 9: os resultados, agrupados e em ordem', () => {
  const telas = telasDoIrPara({ alcanca: tudo, souAdmin: true, chatOk: true });
  const { clientes, lugares } = destinosDaArvore(ARVORE, true);
  const fontes = { telas, clientes, lugares, procurarTarefasOk: true };
  const resumo = (consulta: string, f = fontes) =>
    resultadosDoIrPara(consulta, f).map((g) => [g.chave, g.itens.map((d) => d.rotulo)]);

  it('sem nada digitado, só as telas — a lista óbvia, na ordem da barra', () => {
    const grupos = resultadosDoIrPara('', fontes);
    expect(grupos.map((g) => g.chave)).toEqual(['telas']);
    expect(grupos[0].itens).toEqual(telas);
    expect(resultadosDoIrPara('   ', fontes).map((g) => g.chave)).toEqual(['telas']);
  });

  it('"plan" põe o Planejamento em primeiro — é o `Enter` do e2e', () => {
    const grupos = resultadosDoIrPara('plan', fontes);
    expect(grupos[0].chave).toBe('telas');
    expect(grupos[0].itens[0].para).toBe('/planejamento');
  });

  it('o nome exato de uma lista passa à frente das telas que só a têm no meio', () => {
    // "Demandas" é lista; nenhuma tela se chama assim.
    expect(resumo('demandas')[0]).toEqual(['listas', ['Demandas']]);
    // "mimi" é o nome INTEIRO da pasta e só o começo do cliente: a pasta vem
    // primeiro, com as listas dela logo atrás (apelido), e o cliente depois.
    expect(resumo('mimi')).toEqual([
      ['listas', ['MIMI', 'Demandas', 'Vídeos']],
      ['clientes', ['Mimi Store']],
      ['tarefas', ['Procurar tarefas com “mimi”']],
    ]);
    // Com o nome do cliente inteiro, o cliente passa à frente.
    expect(resumo('mimi store')[0]).toEqual(['clientes', ['Mimi Store']]);
  });

  it('"Procurar tarefas com …" vem sempre por último, e leva a Todas as tarefas filtrada', () => {
    const grupos = resultadosDoIrPara('peça de março', fontes);
    const ultimo = grupos[grupos.length - 1];
    expect(ultimo.chave).toBe('tarefas');
    expect(ultimo.itens).toHaveLength(1);
    expect(ultimo.itens[0].rotulo).toBe('Procurar tarefas com “peça de março”');
    expect(ultimo.itens[0].para).toBe('/tarefas?busca=pe%C3%A7a+de+mar%C3%A7o');
    expect(new URLSearchParams(ultimo.itens[0].para.split('?')[1]).get('busca')).toBe('peça de março');
  });

  it('quando nada casa, sobra a busca de tarefas — e sem o quadro, nada', () => {
    expect(resumo('zzqx')).toEqual([['tarefas', ['Procurar tarefas com “zzqx”']]]);
    expect(resultadosDoIrPara('zzqx', { ...fontes, procurarTarefasOk: false })).toEqual([]);
  });

  it('cada grupo tem teto — a busca é para ir, não para listar a árvore de novo', () => {
    const muitas = Array.from({ length: 30 }, (_, i): Destino => ({
      chave: `lista:${i}`,
      tipo: 'lista',
      rotulo: `Lista ${i}`,
      para: `/quadro/${i}`,
    }));
    const grupos = resultadosDoIrPara('lista', { ...fontes, lugares: muitas });
    const listas = grupos.find((g) => g.chave === 'listas');
    expect(listas?.itens).toHaveLength(TETO_DO_GRUPO.listas);
    // Empate de nota: a ordem de origem (a da árvore).
    expect(listas?.itens.map((d) => d.para).slice(0, 3)).toEqual(['/quadro/0', '/quadro/1', '/quadro/2']);
  });

  it('o texto procurado tem o teto da busca de tarefas', () => {
    const longo = 'a'.repeat(300);
    const busca = new URLSearchParams(procurarTarefas(longo).para.split('?')[1]).get('busca');
    expect(busca).toHaveLength(120);
  });

  it('as setas dão a volta nas pontas', () => {
    expect(moverAtivo(0, 4, 1)).toBe(1);
    expect(moverAtivo(3, 4, 1)).toBe(0);
    expect(moverAtivo(0, 4, -1)).toBe(3);
    expect(moverAtivo(-1, 4, 1)).toBe(0);
    expect(moverAtivo(0, 0, 1)).toBe(0);
  });
});

/* ───────────────────────────── a janela, desenhada ───────────────────────────── */

describe('F43 Fase 9: a janela é uma caixa de combinação de verdade', () => {
  const telas = telasDoIrPara({ alcanca: tudo, souAdmin: true, chatOk: true });
  const desenhar = (consultaInicial: string) =>
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(JanelaDoIrPara, {
          telas,
          podeVerClientes: true,
          procurarTarefasOk: true,
          aoIr: () => {},
          aoFechar: () => {},
          consultaInicial,
        }),
      ),
    );

  it('é um diálogo com nome, e o campo é o `combobox` que controla a lista', () => {
    const html = desenhar('plan');
    expect(html).toMatch(/role="dialog" aria-modal="true" aria-label="Buscar ou ir para"/);
    const campo = /<input[^>]*role="combobox"[^>]*>/.exec(html)?.[0] ?? '';
    expect(campo).toContain('aria-label="Buscar telas, clientes e listas"');
    expect(campo).toContain('aria-expanded="true"');
    const lista = /aria-controls="([^"]+)"/.exec(campo)?.[1];
    expect(lista).toBeTruthy();
    expect(html).toContain(`id="${lista}" role="listbox"`);
  });

  it('a opção ativa é a primeira — Planejamento —, e o campo aponta para ela', () => {
    const html = desenhar('plan');
    const campo = /<input[^>]*role="combobox"[^>]*>/.exec(html)?.[0] ?? '';
    const ativa = /aria-activedescendant="([^"]+)"/.exec(campo)?.[1];
    const opcao = new RegExp(`<div id="${ativa}" role="option" aria-selected="true"[^>]*>([\\s\\S]*?)</div>`).exec(html);
    expect(opcao?.[1]).toContain('Planejamento');
    // Só uma está ativa.
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
  });

  it('os grupos têm nome, e a busca de tarefas é a última opção', () => {
    const html = desenhar('plan');
    expect(html).toMatch(/role="group" aria-labelledby="[^"]+"/);
    expect(html).toContain('>Telas</div>');
    expect(html).toContain('>Tarefas</div>');
    const opcoes = [...html.matchAll(/role="option"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => m[1]);
    expect(opcoes[opcoes.length - 1]).toContain('Procurar tarefas com “plan”');
  });

  it('o `X` de fechar existe, com nome — a regra das janelas (F17.33)', () => {
    expect(desenhar('')).toContain('aria-label="Fechar"');
  });

  it('sem nada digitado, a lista é a das telas, e nenhuma frase de "nada encontrado"', () => {
    const html = desenhar('');
    expect(html).toContain('>Notificações</span>');
    expect(html).not.toContain('Nada encontrado');
    expect(html).not.toContain('Procurar tarefas');
  });
});

describe('F43 Fase 9: o gatilho da barra', () => {
  const desenhar = (soIcones: boolean) =>
    renderToStaticMarkup(createElement(GatilhoDoIrPara, { soIcones, tecla: 'Ctrl K', aberto: false, aoAbrir: () => {} }));

  it('com a barra aberta: o nome escrito e a tecla ao lado, fora do nome acessível', () => {
    const html = desenhar(false);
    expect(html).toMatch(/^<button type="button" class="bl-ir"/);
    expect(html).toContain('<span class="bl-ir-texto">Buscar ou ir para…</span>');
    expect(html).toContain('<kbd class="bl-ir-tecla" aria-hidden="true">Ctrl K</kbd>');
    expect(html).toContain('aria-keyshortcuts="Control+K Meta+K"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('aria-label=');
  });

  it('em `Somente ícones`: só a lupa, com o nome no `aria-label` e no `title`', () => {
    const html = desenhar(true);
    expect(html).toContain('aria-label="Buscar ou ir para…"');
    expect(html).toContain('title="Buscar ou ir para… (Ctrl K)"');
    expect(html).not.toContain('bl-ir-texto');
    expect(html).toContain('<svg');
  });
});
