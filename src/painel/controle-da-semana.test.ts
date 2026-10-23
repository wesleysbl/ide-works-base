/**
 * O CONTROLE DA SEMANA, A TELA — F40, Fase 7.
 *
 * Desenha no servidor (`renderToStaticMarkup`: NENHUM `useEffect` roda), por
 * isso as provas são sobre os blocos com dados fixos e sobre a parte pura. A
 * tela inteira, com busca, OK e navegação de semana, é `scripts/e2e/controle-da-semana.mjs`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { BlocoParaAtribuir, FaixaDeNumeros, GrupoDoClienteBloco } from '@/painel/BlocosDoControle';
import {
  type Cofre,
  type ControleDaSemana,
  FRASE_ESCOLHA_O_TIPO,
  type GrupoParaAtribuir,
  abertoPorPadrao,
  agruparPorCliente,
  cartoesDaFaixa,
  chaveDaPreferencia,
  clientesParaAtribuir,
  destinoDoCliente,
  estadoDoCliente,
  estaAberto,
  fraseDaFalha,
  gravarPreferencia,
  lerPreferencia,
  marcarTodos,
  porQueOOkEstaParado,
  prazoCurto,
  progressoDoTipo,
  rotuloDaSemana,
  semanaDoEndereco,
  seloDoEstado,
  totaisDaFaixa,
} from '@/painel/controle-da-semana';
import {
  ITENS_DA_BARRA,
  ITENS_SO_ADMIN,
  PADRAO,
  SECAO_DO_ITEM,
  itensVisiveis,
  secoesVisiveis,
} from '@/ui/preferencias';
import { ehAdmin, type Sessao } from '@/ui/sessao';

const dentroDoRoteador = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, el));

const PESSOAS = [
  { id: 'u-ana', name: 'Ana' },
  { id: 'u-bia', name: 'Bia' },
];

const GRUPOS: GrupoParaAtribuir[] = [
  {
    clientId: 'c-saae',
    clientName: 'Saae Itaverde',
    type: 'video',
    cards: [
      {
        id: 't-1',
        title: 'Reels da obra',
        createdBy: { id: 'u-cap', name: 'Cátia' },
        suggestedDueOn: '2026-10-09',
        list: { id: 'l-1', name: 'Demandas' },
      },
    ],
  },
  {
    clientId: 'c-saae',
    clientName: 'Saae Itaverde',
    type: null,
    cards: [
      {
        id: 't-2',
        title: 'Card antigo sem tipo',
        createdBy: null,
        suggestedDueOn: null,
        list: { id: 'l-1', name: 'Demandas' },
      },
    ],
  },
];

const aoLiberar = async () => null;

const ATRASO = {
  id: 't-9',
  title: 'Post parado',
  dueOn: '2026-10-01',
  clientId: 'c-zeni',
  clientName: 'Zeni',
  type: 'arte' as const,
  list: { id: 'l-1', name: 'Demandas' },
  statusName: 'a fazer arte',
  assignees: [{ id: 'u-ana', name: 'Ana' }],
};

/** A semana: Zeni atrasado, Saae em falta (e com cards para atribuir), Bom Pão em dia. */
const SEMANA: Pick<ControleDaSemana, 'toAssign' | 'progress' | 'missing'> = {
  toAssign: GRUPOS,
  progress: [
    { clientId: 'c-bom', clientName: 'Bom Pão', type: 'video', awaiting: 0, todo: 0, doing: 1, done: 2 },
    { clientId: 'c-saae', clientName: 'Saae Itaverde', type: 'video', awaiting: 1, todo: 0, doing: 2, done: 1 },
    { clientId: 'c-zeni', clientName: 'Zeni', type: 'arte', awaiting: 0, todo: 2, doing: 1, done: 4 },
    { clientId: 'c-zeni', clientName: 'Zeni', type: 'video', awaiting: 3, todo: 0, doing: 0, done: 0 },
  ],
  missing: {
    items: [
      { clientId: 'c-bom', clientName: 'Bom Pão', type: 'video', target: 2, cards: 3, missing: 0 },
      { clientId: 'c-saae', clientName: 'Saae Itaverde', type: 'video', target: 2, cards: 1, missing: 1 },
      { clientId: 'c-saae', clientName: 'Saae Itaverde', type: 'foto', target: 1, cards: 0, missing: 1 },
      { clientId: 'c-zeni', clientName: 'Zeni', type: 'arte', target: 2, cards: 2, missing: 0 },
    ],
    overdue: [ATRASO, { ...ATRASO, id: 't-10', title: 'Sem dono', type: null, assignees: [] }],
    overdueTotal: 5,
  },
};

const pref = {};
const grupoDe = (id: string) => agruparPorCliente(SEMANA).find((g) => g.clientId === id)!;
const desenha = (id: string, aberto: boolean) =>
  dentroDoRoteador(
    createElement(GrupoDoClienteBloco, {
      grupo: grupoDe(id),
      aberto,
      aoAlternar: () => {},
      aoAbrirCliente: () => {},
    }),
  );
const desenhaBloco = (semana = SEMANA) =>
  dentroDoRoteador(
    createElement(BlocoParaAtribuir, {
      clientes: clientesParaAtribuir(agruparPorCliente(semana)),
      pessoas: PESSOAS,
      aoLiberar,
    }),
  );

describe('a faixa de números', () => {
  const totais = totaisDaFaixa(SEMANA);

  it('soma Para atribuir, Em andamento, Feitos, clientes em falta e atrasados', () => {
    expect(totais).toEqual({ paraAtribuir: 2, emAndamento: 4, feitos: 7, clientesEmFalta: 1, atrasados: 5 });
  });

  it('cada cartão tem rótulo, número e o estado em palavras (a cor não é a única pista)', () => {
    const html = renderToStaticMarkup(createElement(FaixaDeNumeros, { totais }));
    for (const r of ['Para atribuir', 'Em andamento', 'Feitos', 'Clientes em falta', 'Atrasados']) expect(html).toContain(r);
    expect(html).toMatch(/data-numero="atrasados"[^>]*><span[^>]*>Atrasados<\/span><strong[^>]*>5<\/strong><span[^>]*>vencidos</);
    expect(html).toMatch(/data-numero="feitos"[^>]*><span[^>]*>Feitos<\/span><strong[^>]*>7</);
  });

  it('o tom: zero problema = verde, atenção = âmbar, falta e atraso = vermelho', () => {
    const tons = (t: ReturnType<typeof totaisDaFaixa>) => Object.fromEntries(cartoesDaFaixa(t).map((c) => [c.id, c.tom]));
    expect(tons(totais)).toEqual({ paraAtribuir: 'warn', emAndamento: 'neutro', feitos: 'ok', clientesEmFalta: 'err', atrasados: 'err' });
    expect(tons({ paraAtribuir: 0, emAndamento: 0, feitos: 0, clientesEmFalta: 0, atrasados: 0 })).toEqual({
      paraAtribuir: 'ok', emAndamento: 'neutro', feitos: 'neutro', clientesEmFalta: 'ok', atrasados: 'ok',
    });
  });

  it('semana vazia: tudo zero', () => {
    expect(totaisDaFaixa({ toAssign: [], progress: [], missing: { items: [], overdue: [], overdueTotal: 0 } })).toEqual({
      paraAtribuir: 0, emAndamento: 0, feitos: 0, clientesEmFalta: 0, atrasados: 0,
    });
  });
});

describe('estado, ordem e progresso por cliente', () => {
  it('atrasado manda sobre falta, e falta sobre em dia', () => {
    expect(estadoDoCliente(2, 5)).toBe('atrasado');
    expect(estadoDoCliente(0, 5)).toBe('falta');
    expect(estadoDoCliente(0, 0)).toBe('em-dia');
  });

  it('a ordem é atrasado, falta, em dia; dentro de cada faixa, pelo nome', () => {
    const extra: typeof SEMANA = {
      ...SEMANA,
      missing: { ...SEMANA.missing, items: [...SEMANA.missing.items, { clientId: 'c-a', clientName: 'Alfa', type: 'arte', target: 1, cards: 0, missing: 1 }] },
    };
    expect(agruparPorCliente(extra).map((g) => `${g.clientName}:${g.estado}`)).toEqual([
      'Zeni:atrasado',
      'Alfa:falta',
      'Saae Itaverde:falta',
      'Bom Pão:em-dia',
    ]);
  });

  it('o grupo junta as quatro partes do cliente, com as barras na ordem dos tipos', () => {
    const saae = grupoDe('c-saae');
    expect(saae.faltam).toBe(2);
    expect(saae.barras.map((b) => b.type)).toEqual(['video', 'foto']);
    expect(saae.paraAtribuir).toHaveLength(2);
    expect(saae.andamento).toHaveLength(1);
    expect(grupoDe('c-zeni').atrasados.map((a) => a.id)).toEqual(['t-9', 't-10']);
  });

  it('o progresso é cards ÷ meta, limitado a 100%, e o excedente é dito', () => {
    expect(progressoDoTipo(1, 2)).toMatchObject({ pct: 50, excedente: 0, texto: '1/2' });
    expect(progressoDoTipo(0, 2)).toMatchObject({ pct: 0, texto: '0/2' });
    expect(progressoDoTipo(3, 2)).toMatchObject({ pct: 100, excedente: 1, texto: '3/2 +1' });
    expect(progressoDoTipo(2, 0)).toMatchObject({ pct: 0, texto: '2/0 +2' });
  });

  it('o selo diz "N atrasados", "falta N" ou "✓ em dia"', () => {
    expect(seloDoEstado('atrasado', 1, 0).texto).toBe('1 atrasado');
    expect(seloDoEstado('atrasado', 3, 0).texto).toBe('3 atrasados');
    expect(seloDoEstado('falta', 0, 2)).toEqual({ texto: 'falta 2', tom: 'warn' });
    expect(seloDoEstado('em-dia', 0, 0)).toEqual({ texto: '✓ em dia', tom: 'ok' });
  });
});

describe('o grupo do cliente', () => {
  it('em dia começa recolhido: botão com aria-expanded="false", aria-controls e corpo hidden', () => {
    expect(abertoPorPadrao('em-dia')).toBe(false);
    const html = desenha('c-bom', estaAberto(grupoDe('c-bom'), pref));
    expect(html).toContain('data-estado="em-dia"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="cs-corpo-c-bom"');
    expect(html).toMatch(/id="cs-corpo-c-bom" class="cs-grupo-corpo" hidden=""/);
    expect(html).toContain('✓ em dia');
  });

  it('F41 Fase 2: todos começam recolhidos, até o que tem falta ou atraso; o selo segue à vista', () => {
    for (const e of ['atrasado', 'falta', 'em-dia'] as const) expect(abertoPorPadrao(e)).toBe(false);
    const html = desenha('c-saae', estaAberto(grupoDe('c-saae'), pref));
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/class="cs-grupo-corpo" hidden/);
    expect(html).toContain('falta 2');
    expect(html).toContain('2 p/ atribuir');
    expect(html).not.toContain('Reels da obra');
  });

  it('aberto, mostra o corpo; os atrasados aparecem', () => {
    const html = desenha('c-saae', true);
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toMatch(/class="cs-grupo-corpo" hidden/);
    const atraso = desenha('c-zeni', true);
    expect(atraso).toContain('2 atrasados');
    expect(atraso).toContain('Post parado');
    expect(atraso).toContain('venceu em 01/10');
    expect(atraso).toContain('Sem responsável');
  });

  it('as barras mostram "1/2" e "0/1" com o nome do tipo', () => {
    const html = desenha('c-saae', true);
    expect(html).toContain('>1/2<');
    expect(html).toContain('>0/1<');
    expect(html).toContain('aria-label="Vídeo: 1 de 2"');
    expect(html).toContain('width:50%');
  });

  it('o corpo traz o andamento por etapa e o botão para o quadro', () => {
    const html = desenha('c-saae', true);
    for (const c of ['Aguardando', 'Por fazer', 'Em andamento', 'Feito']) expect(html).toContain(c);
    expect(html).toMatch(/data-coluna="em-andamento">2</);
    expect(html).toContain('aria-label="Abrir a lista de Saae Itaverde no quadro"');
  });

  it('o corpo do grupo NÃO traz os cards para atribuir (eles moram no bloco)', () => {
    const html = desenha('c-saae', true);
    expect(html).not.toContain('Reels da obra');
    expect(html).not.toContain('OK, liberar');
    expect(html).not.toContain('data-parte="para-atribuir"');
  });

  it('o bloco Para atribuir: título com total, subtítulo por cliente, card com OK (desabilitado até escolher), prazo sugerido e tipo faltando', () => {
    const html = desenhaBloco();
    expect(html).toContain('data-bloco="para-atribuir"');
    expect(html).toMatch(/Para atribuir<span[^>]*>2</);
    expect(html).toMatch(/<h3 class="cs-sub"><button[^>]*>(<span[^>]*><\/span>)?Saae Itaverde/);
    expect(html).toContain('Sugerido: 09/10');
    expect(html).toContain('aria-label="Prazo de Reels da obra" value="2026-10-09"');
    expect(html).toMatch(/aria-label="Pessoa para Reels da obra"><option value="" selected="">Escolha a pessoa</);
    expect(html).toContain('aria-label="Tipo de Card antigo sem tipo"');
    expect(html).toContain('Sem data');
    const botao = html.match(/<button[^>]*aria-label="OK, liberar Card antigo sem tipo"[^>]*>/)![0];
    expect(botao).toContain('disabled');
    expect(botao).toContain(`title="${FRASE_ESCOLHA_O_TIPO}"`);
    expect(html).not.toContain('aria-label="Tipo de Reels da obra"');
  });

  it('o bloco só tem clientes com card, na ordem de urgência da lista, e vazio diz a frase', () => {
    const lista = clientesParaAtribuir(agruparPorCliente(SEMANA));
    expect(lista.map((c) => [c.clientId, c.total])).toEqual([['c-saae', 2]]);
    const dois = {
      ...SEMANA,
      toAssign: [
        ...GRUPOS,
        { clientId: 'c-bom', clientName: 'Bom Pão', type: 'arte' as const, cards: [{ ...GRUPOS[0].cards[0], id: 't-3', title: 'Post do pão' }] },
      ],
    };
    // Saae (falta) vem antes de Bom Pão (em dia), como na lista de clientes.
    expect(clientesParaAtribuir(agruparPorCliente(dois)).map((c) => c.clientId)).toEqual(['c-saae', 'c-bom']);
    const vazio = desenhaBloco({ ...SEMANA, toAssign: [] });
    expect(vazio).toContain('Nada para atribuir nesta semana');
    expect(vazio).not.toContain('OK, liberar');
  });

  it('cliente sem nada em produção diz isso, em vez de um corpo vazio', () => {
    const vazio = agruparPorCliente({
      toAssign: [],
      progress: [],
      missing: { items: [{ clientId: 'c-x', clientName: 'X', type: 'video', target: 1, cards: 1, missing: 0 }], overdue: [], overdueTotal: 0 },
    })[0];
    const html = dentroDoRoteador(
      createElement(GrupoDoClienteBloco, { grupo: vazio, aberto: true, aoAlternar: () => {}, aoAbrirCliente: () => {} }),
    );
    expect(html).toContain('Nada em produção para este cliente nesta semana');
  });
});

describe('abrir e recolher lembrados no navegador', () => {
  const cofreDe = (inicial: Record<string, string> = {}): Cofre & { dados: Record<string, string> } => {
    const dados = { ...inicial };
    return { dados, getItem: (k) => dados[k] ?? null, setItem: (k, v) => void (dados[k] = v) };
  };
  const quebrado: Cofre = {
    getItem: () => {
      throw new Error('negado');
    },
    setItem: () => {
      throw new Error('cheio');
    },
  };

  it('a escolha vale mais que o padrão, e o resto segue o estado', () => {
    const saae = grupoDe('c-saae');
    const bom = grupoDe('c-bom');
    expect(estaAberto(saae, { 'c-saae': false })).toBe(false);
    expect(estaAberto(bom, { 'c-bom': true })).toBe(true);
    expect(estaAberto(saae, {})).toBe(false);
    expect(estaAberto(bom, {})).toBe(false);
  });

  it('"Expandir tudo" e "Recolher tudo" marcam todos, sem perder o que já havia', () => {
    const todos = agruparPorCliente(SEMANA);
    const fechado = marcarTodos(todos, false, { 'c-fora': true });
    expect(fechado).toEqual({ 'c-fora': true, 'c-zeni': false, 'c-saae': false, 'c-bom': false });
    expect(todos.every((g) => estaAberto(g, fechado) === false)).toBe(true);
    expect(todos.every((g) => estaAberto(g, marcarTodos(todos, true, fechado)))).toBe(true);
  });

  it('grava e lê de volta; a chave é por pessoa quando a sessão tem id', () => {
    const cofre = cofreDe();
    const chave = chaveDaPreferencia('u-ana');
    expect(chave).not.toBe(chaveDaPreferencia('u-bia'));
    expect(chave).toContain('u-ana');
    expect(chave).toContain(':v2:');
    expect(chaveDaPreferencia(null)).toBe(chaveDaPreferencia(undefined));
    expect(gravarPreferencia(cofre, chave, { 'c-saae': false })).toBe(true);
    expect(lerPreferencia(cofre, chave)).toEqual({ 'c-saae': false });
    expect(lerPreferencia(cofre, chaveDaPreferencia('u-bia'))).toEqual({});
  });

  it('sem armazenamento, com armazenamento que lança ou com lixo gravado: não quebra', () => {
    expect(lerPreferencia(null, 'k')).toEqual({});
    expect(gravarPreferencia(null, 'k', { a: true })).toBe(false);
    expect(lerPreferencia(quebrado, 'k')).toEqual({});
    expect(gravarPreferencia(quebrado, 'k', { a: true })).toBe(false);
    expect(lerPreferencia(cofreDe({ k: 'não é json' }), 'k')).toEqual({});
    expect(lerPreferencia(cofreDe({ k: '[1,2]' }), 'k')).toEqual({});
    expect(lerPreferencia(cofreDe({ k: '{"a":true,"b":"sim","c":1}' }), 'k')).toEqual({ a: true });
  });
});

describe('a regra do OK', () => {
  it('só libera com tipo (quando faltava), pessoa e prazo — nessa ordem de recusa', () => {
    expect(porQueOOkEstaParado(null, { pessoaId: 'p', prazo: '2026-10-09', tipo: '' })).toBe(FRASE_ESCOLHA_O_TIPO);
    expect(porQueOOkEstaParado('video', { pessoaId: '', prazo: '2026-10-09', tipo: '' })).toBe('Escolha a pessoa');
    expect(porQueOOkEstaParado('video', { pessoaId: 'p', prazo: '', tipo: '' })).toBe('Escolha o prazo');
    expect(porQueOOkEstaParado('video', { pessoaId: 'p', prazo: '2026-10-09', tipo: '' })).toBeNull();
    expect(porQueOOkEstaParado(null, { pessoaId: 'p', prazo: '2026-10-09', tipo: 'arte' })).toBeNull();
  });

  it('falha técnica não vira texto cru na tela', () => {
    expect(fraseDaFalha('{"error":"x"}', 'Tente de novo')).toBe('Tente de novo');
    expect(fraseDaFalha('SQLSTATE 23505 duplicate key', 'Tente de novo')).toBe('Tente de novo');
    expect(fraseDaFalha('', 'Tente de novo')).toBe('Tente de novo');
    expect(fraseDaFalha('Esse card já foi liberado por Ana.', 'x')).toBe('Esse card já foi liberado por Ana.');
  });
});

describe('o nome da semana e o endereço', () => {
  it('"06 – 12/out", e com a virada do mês cada ponta diz a sua', () => {
    expect(rotuloDaSemana('2026-10-05', '2026-10-11')).toBe('05 – 11/out');
    expect(rotuloDaSemana('2026-10-26', '2026-11-01')).toBe('26/out – 01/nov');
    expect(rotuloDaSemana('2026-09-28', '2026-10-04')).toBe('28/set – 04/out');
  });
  it('prazo curto e "Sem data"', () => {
    expect(prazoCurto('2026-10-09')).toBe('09/10');
    expect(prazoCurto(null)).toBe('Sem data');
  });
  it('só aceita data de verdade em ?semana=', () => {
    expect(semanaDoEndereco('2026-10-12')).toBe('2026-10-12');
    expect(semanaDoEndereco('2026-02-30')).toBeNull();
    expect(semanaDoEndereco('amanhã')).toBeNull();
    expect(semanaDoEndereco(null)).toBeNull();
  });
  it('clicar no cliente leva à primeira lista viva dele; sem lista, à ficha', () => {
    expect(destinoDoCliente('c-1', [{ id: 'l-x', archived: true }, { id: 'l-y' }])).toBe('/quadro/l-y');
    expect(destinoDoCliente('c-1', [])).toBe('/cliente/c-1');
  });
});

/*
  F43 Fase 8 ("Uma barra só"): o item saiu do fim de `Entrega` para a seção
  própria, `Gestão`, que só quem administra vê. As contas abaixo eram feitas na
  `entrega` e passaram para a `gestao`, de propósito; a regra é a mesma — o
  filtro é por papel, e não por área.
*/
describe('o item da barra é só de admin', () => {
  const alcancaTudo = () => true;

  it('funcionário não vê o item, nem com a área `pessoas` marcada — e a seção Gestão some com ele', () => {
    expect(itensVisiveis(PADRAO, 'gestao', alcancaTudo, false)).not.toContain('controle');
    expect(itensVisiveis(PADRAO, 'gestao', alcancaTudo)).not.toContain('controle');
    expect(secoesVisiveis(PADRAO, alcancaTudo, false)).not.toContain('gestao');
  });

  it('admin vê o item na Gestão, que vem logo depois da Entrega; a Entrega fica com os três', () => {
    expect(itensVisiveis(PADRAO, 'gestao', alcancaTudo, true)).toEqual(['controle']);
    expect(itensVisiveis(PADRAO, 'entrega', alcancaTudo, true)).toEqual([
      'painel',
      'calendario',
      'planejamento',
    ]);
    const secoes = secoesVisiveis(PADRAO, alcancaTudo, true);
    expect(secoes.indexOf('gestao')).toBe(secoes.indexOf('entrega') + 1);
  });

  it('o admin sem as outras áreas ainda vê a Gestão — e sem a Entrega', () => {
    const soPessoas = (a: string) => a === 'pessoas';
    expect(itensVisiveis(PADRAO, 'gestao', soPessoas, true)).toEqual(['controle']);
    expect(secoesVisiveis(PADRAO, soPessoas, true)).toContain('gestao');
    expect(secoesVisiveis(PADRAO, soPessoas, true)).not.toContain('entrega');
    expect(secoesVisiveis(PADRAO, soPessoas, false)).not.toContain('gestao');
  });

  it('o filtro vale para a lista inteira e o item está na seção Gestão', () => {
    expect(ITENS_SO_ADMIN).toEqual(['controle']);
    for (const i of ITENS_SO_ADMIN) {
      expect(ITENS_DA_BARRA).toContain(i);
      expect(SECAO_DO_ITEM[i]).toBe('gestao');
    }
  });

  it('`ehAdmin`: super admin e admin sim; funcionário e sem sessão não', () => {
    const base: Sessao = {
      userId: 'u', email: 'a@b.c', nome: null, isSuperadmin: false, isSuper: false, papel: 'funcionario', areas: ['pessoas'],
    };
    expect(ehAdmin(base)).toBe(false);
    expect(ehAdmin(null)).toBe(false);
    expect(ehAdmin({ ...base, isSuperadmin: true, papel: 'admin' })).toBe(true);
  });
});

describe('a página', () => {
  const fonte = readFileSync(join(import.meta.dirname, '..', 'pages', 'ControleDaSemana.tsx'), 'utf8');
  it('mostra "sem acesso" para quem não administra, sem buscar a semana', () => {
    expect(fonte).toContain('tipo="sem-acesso"');
    expect(fonte).toMatch(/if \(lendoASessao \|\| !souAdmin\) return;/);
  });
  it('desenha a faixa, um grupo por cliente, "Expandir tudo / Recolher tudo" e o estado vazio', () => {
    expect(fonte).toContain('<FaixaDeNumeros');
    expect(fonte).toContain('<BlocoParaAtribuir');
    expect(fonte.indexOf('<BlocoParaAtribuir')).toBeLessThan(fonte.indexOf('data-bloco="clientes"'));
    expect(fonte).toContain('<GrupoDoClienteBloco');
    expect(fonte).toContain('Expandir tudo');
    expect(fonte).toContain('Recolher tudo');
    expect(fonte).toContain('Nenhum cliente com produção nesta semana');
  });
  it('o item aceso na barra é o do controle', () => {
    expect(fonte).toContain('atual="controle"');
  });
});
