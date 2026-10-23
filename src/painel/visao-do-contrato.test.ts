/**
 * A visão Contrato e a faixa "Precisa de atenção" — F43, Fase 2.
 *
 * Desenha no servidor (`renderToStaticMarkup`, nenhum efeito roda) com um
 * mês e um HOJE fixos: outubro de 2026, hoje quarta 07/10 — semana 2 (05–11).
 * As semanas de outubro/2026: 01–04 (2 dias úteis), 05–11, 12–18, 19–25,
 * 26–31. Metas: 8 artes → [0,2,2,2,2]; 4 artes ou vídeos → [0,1,1,1,1];
 * 2 vídeos ou fotos → [0,1,1,0,0].
 *
 * A carteira (a mesma do e2e `agenda-planejamento` AG8):
 *   Aurora    Helena      mês NÃO aberto (contrato no cadastro)   → Abrir o mês
 *   Café      Carla       nada marcado na semana, muito sem dia    → Planejar
 *   Estúdio   Carla       uma arte vencida (05/10)                 → Ver peças
 *   Horizonte Helena      em dia, aprovado                         → fora da faixa
 *   Livraria  Carla+Helena 5 das 8 artes sem dia                   → Planejar
 *   Norte     ninguém     sem contrato                             → fora da faixa
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import {
  acaoDaAtencao,
  estaSemanaDoCliente,
  legendaDoTipo,
  partesDaBarra,
  tiposDoMes,
} from '@/painel/contrato-na-tela';
import { FaixaDeAtencao, LIMITE_DA_FAIXA } from '@/painel/FaixaDeAtencao';
import { type ContratoDoTipo, type LinhaDoMes, planejarMes } from '@/painel/planejamento-do-mes';
import { VisaoDoContrato } from '@/painel/VisaoDoContrato';
import { enderecoDoPainel } from '@/painel/visoes-do-planejamento';
import type { PlanningRow } from '@/server/planning';
import type { PlanningWeekItem, PlanningWeeksRow } from '@/server/planning-weeks';

const HOJE = '2026-10-07';
const MES = '2026-10';
const CARLA = { id: 'u-carla', name: 'Carla' };
const HELENA = { id: 'u-helena', name: 'Helena' };

let seq = 0;
const peca = (tipo: string, dia: string | null, feita = false): PlanningWeekItem => ({
  id: `p${++seq}`,
  contentType: tipo,
  scheduledAt: dia ? `${dia}T12:00:00Z` : null,
  completedAt: feita && dia ? `${dia}T15:00:00Z` : null,
  isExtra: false,
  title: null,
});

const semanas = (id: string, name: string, over: Partial<PlanningWeeksRow> = {}): PlanningWeeksRow => ({
  id,
  name,
  categoryId: 'cat',
  categoryName: 'Ide',
  plan: null,
  owners: [],
  quotaSource: 'contrato',
  quota: {},
  hasContentContract: true,
  items: [],
  ...over,
});
const ritual = (id: string, name: string, over: Partial<PlanningRow> = {}): PlanningRow => ({
  id,
  name,
  categoryId: 'cat',
  categoryName: 'Ide',
  plan: null,
  monthOpened: true,
  planningDoneAt: null,
  clientApprovedAt: null,
  ...over,
});

const PLANEJADO = { planningDoneAt: '2026-10-02T12:00:00Z' };
const APROVADO = { ...PLANEJADO, clientApprovedAt: '2026-10-04T12:00:00Z' };

const RITUAL: PlanningRow[] = [
  ritual('c-aurora', 'Aurora Mercado', { monthOpened: false }),
  ritual('c-cafe', 'Café do Bairro'),
  ritual('c-estudio', 'Estúdio Jardim', PLANEJADO),
  ritual('c-horizonte', 'Horizonte Studio', APROVADO),
  ritual('c-livraria', 'Livraria Sete Mares', APROVADO),
  ritual('c-norte', 'Norte Arquitetura'),
];

const SEMANAS: PlanningWeeksRow[] = [
  semanas('c-aurora', 'Aurora Mercado', { owners: [HELENA], quotaSource: 'cadastro', quota: { arte: 4, video: 2 } }),
  semanas('c-cafe', 'Café do Bairro', {
    owners: [CARLA],
    quota: { arte: 8, video: 4 },
    items: [peca('arte', '2026-10-02', true), peca('arte', '2026-10-20')],
  }),
  semanas('c-estudio', 'Estúdio Jardim', {
    owners: [CARLA],
    quota: { arte: 4, foto: 2 },
    items: [
      peca('arte', '2026-10-05'), // passou do dia sem entrega
      peca('arte', '2026-10-08'),
      peca('arte', '2026-10-15'),
      peca('arte', '2026-10-22'),
      peca('foto', '2026-10-09'),
      peca('foto', '2026-10-16'),
    ],
  }),
  semanas('c-horizonte', 'Horizonte Studio', {
    owners: [HELENA],
    quota: { video: 2, arte: 4 },
    items: [
      peca('arte', '2026-10-06', true),
      peca('arte', '2026-10-13'),
      peca('arte', '2026-10-20'),
      peca('arte', '2026-10-27'),
      peca('video', '2026-10-06', true),
      peca('video', '2026-10-14'),
    ],
  }),
  semanas('c-livraria', 'Livraria Sete Mares', {
    owners: [CARLA, HELENA],
    quota: { arte: 8 },
    items: [peca('arte', '2026-10-02', true), peca('arte', '2026-10-06', true), peca('arte', '2026-10-08')],
  }),
  semanas('c-norte', 'Norte Arquitetura', { quotaSource: 'contrato', hasContentContract: false }),
];

const linhasDe = (mes = MES, hoje = HOJE) => planejarMes({ ritual: RITUAL, semanas: SEMANAS, mes, hoje });
const LINHAS = linhasDe();

// A tela de verdade: o Planejamento, com a visão no endereço. O `href` que abre
// o painel (Fase 3) é só a consulta — o caminho é o da tela.
const comRoteador = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/planejamento?visao=contrato'] }, el));
const ENDERECO = new URLSearchParams('visao=contrato');
const doPainel = (id: string) => enderecoDoPainel(ENDERECO, id);
const faixa = (linhas: readonly LinhaDoMes[] = LINHAS, mes = MES, hoje = HOJE) =>
  comRoteador(createElement(FaixaDeAtencao, { linhas, mes, hoje, enderecoDoPainel: doPainel }));
const contrato = (filtro = '', linhas: readonly LinhaDoMes[] = LINHAS, mes = MES, hoje = HOJE, soFalta = false) =>
  comRoteador(
    createElement(VisaoDoContrato, { linhas, mes, hoje, filtro, aoFiltrar: () => {}, soFalta, aoMudarSoFalta: () => {}, enderecoDoPainel: doPainel }),
  );

/** As linhas `<li>` da faixa, na ordem. */
const alertas = (html: string) =>
  [...html.matchAll(/<li class="plc-alerta" data-cliente="([^"]+)" data-motivo="([^"]+)" data-tom="([^"]+)">([\s\S]*?)<\/li>/g)].map(
    (m) => ({ id: m[1], motivo: m[2], tom: m[3], html: m[4] }),
  );

/** Os `<tbody>` de cada grupo da tabela, em ordem. */
const grupos = (html: string) =>
  [...html.matchAll(/<tbody class="plc-grupo" data-grupo="([^"]+)">([\s\S]*?)<\/tbody>/g)].map((m) => ({ id: m[1], html: m[2] }));
const clientesEm = (html: string) => [...html.matchAll(/<tr class="plc-linha" data-cliente="([^"]+)"/g)].map((m) => m[1]);
const linhaDe = (html: string, id: string) => html.match(new RegExp(`<tr class="plc-linha" data-cliente="${id}"[\\s\\S]*?</tr>`))?.[0] ?? '';
const celula = (linha: string, tipo: string) =>
  linha.match(new RegExp(`<td class="plc-tipo" data-tipo="${tipo}">([\\s\\S]*?)</td>`))?.[1] ?? '';

/* ───────────────────────────── a faixa ───────────────────────────── */

describe('FaixaDeAtencao — quem precisa de atenção esta semana', () => {
  const html = faixa();
  const linhas = alertas(html);

  it('o título fala da semana, com quantos clientes e qual semana', () => {
    expect(html).toContain('>Precisa de atenção esta semana</h2>');
    expect(html).toContain('<span class="plc-faixa-detalhe">4 clientes · semana 2, de 5 a 11 de outubro</span>');
  });

  it('entram só os atrasados, do motivo mais pesado ao mais leve', () => {
    expect(linhas.map((l) => l.id)).toEqual(['c-aurora', 'c-cafe', 'c-estudio', 'c-livraria']);
    expect(linhas.map((l) => l.motivo)).toEqual(['mes-nao-aberto', 'semana-sem-peca', 'atrasadas', 'sem-dia']);
  });

  it('quem está em dia e quem não tem contrato não aparecem', () => {
    expect(html).not.toContain('Horizonte Studio');
    expect(html).not.toContain('Norte Arquitetura');
  });

  it('cada linha escreve o motivo numa frase pronta', () => {
    expect(linhas[0].html).toContain('O mês de outubro ainda não foi aberto.');
    expect(linhas[1].html).toContain('Nada marcado esta semana. O contrato pede 1 vídeo e 2 artes.');
    expect(linhas[2].html).toContain('1 peça passou do dia sem entrega.');
    expect(linhas[3].html).toContain('5 das 8 artes do mês ainda estão sem dia.');
  });

  it('o segundo motivo vem junto, mais apagado', () => {
    expect(linhas[1].html).toContain(
      '<span class="plc-alerta-mais"> Os 4 vídeos e 6 das 8 artes do mês ainda estão sem dia.</span>',
    );
  });

  it('atrasada é vermelho; o resto, âmbar', () => {
    expect(linhas.map((l) => l.tom)).toEqual(['warn', 'warn', 'err', 'warn']);
  });

  it('UMA ação por linha, com o verbo do motivo e o nome do cliente para o leitor de tela', () => {
    const link = (html: string) => {
      const a = html.match(/<a ([^>]*)>([^<]*)<\/a>/);
      return {
        texto: a?.[2],
        href: a?.[1].match(/href="([^"]*)"/)?.[1],
        nome: a?.[1].match(/aria-label="([^"]*)"/)?.[1],
      };
    };
    for (const l of linhas) expect(l.html.match(/<a /g)).toHaveLength(1);
    // Fase 3: a ação abre o painel do cliente ao lado (`?cliente=`), sem perder a visão.
    const painel = (id: string) => `/planejamento?visao=contrato&amp;cliente=${id}`;
    expect(link(linhas[0].html)).toEqual({ texto: 'Abrir o mês', href: painel('c-aurora'), nome: 'Abrir o mês de Aurora Mercado' });
    expect(link(linhas[1].html)).toEqual({ texto: 'Planejar', href: painel('c-cafe'), nome: 'Planejar Café do Bairro' });
    expect(link(linhas[2].html)).toEqual({ texto: 'Ver peças', href: painel('c-estudio'), nome: 'Ver peças de Estúdio Jardim' });
    expect(link(linhas[3].html)).toEqual({ texto: 'Planejar', href: painel('c-livraria'), nome: 'Planejar Livraria Sete Mares' });
    // O painel é uma janela: o link diz isso ao leitor de tela.
    expect(linhas[1].html).toContain('aria-haspopup="dialog"');
  });

  it('fora do mês de hoje, a ação também abre o painel — o mês é o da tela, e ele acompanha', () => {
    const setembro = faixa(linhasDe('2026-09'), '2026-09');
    expect(setembro).toMatch(/href="\/planejamento\?visao=contrato&amp;cliente=c-aurora"/);
    expect(setembro).not.toContain('href="/cliente/');
  });

  it('sem moldura por linha: nenhum `o-card`', () => {
    expect(html).not.toContain('o-card');
  });
});

describe('FaixaDeAtencao — ninguém atrasado e outros meses', () => {
  const emDia = LINHAS.filter((l) => l.id === 'c-horizonte' || l.id === 'c-norte');

  it('ninguém atrasado é UMA linha calma, e não um bloco de vazio', () => {
    const html = faixa(emDia);
    expect(html).toContain('<p class="plc-faixa-calma">Ninguém atrasado esta semana.</p>');
    expect(html).not.toContain('<ul');
    expect(html).not.toContain('iw-estado');
    expect(html).not.toContain('plc-faixa-detalhe');
  });

  it('fora do mês de hoje, a faixa fala do mês, e não de "esta semana"', () => {
    const html = faixa(linhasDe('2026-09'), '2026-09');
    expect(html).toContain('>Precisa de atenção em setembro</h2>');
    expect(html).not.toContain('esta semana');
    expect(faixa(linhasDe('2026-09').filter((l) => l.id === 'c-norte'), '2026-09')).toContain(
      'Ninguém precisa de atenção em setembro.',
    );
  });

  it('noutro ano, o mês leva o ano', () => {
    expect(faixa([], '2025-12')).toContain('Precisa de atenção em dezembro de 2025');
  });
});

describe('FaixaDeAtencao — muitos clientes', () => {
  const muitos = planejarMes({
    ritual: [],
    semanas: Array.from({ length: 9 }, (_, i) =>
      semanas(`c-${i}`, `Cliente ${i + 1}`, { quota: { arte: 8 } }),
    ),
    mes: MES,
    hoje: HOJE,
  });

  it(`os ${LIMITE_DA_FAIXA} primeiros abertos; o resto recolhido num "Ver mais"`, () => {
    const html = faixa(muitos);
    const [abertos, recolhidos] = html.split('<details');
    expect(alertas(abertos)).toHaveLength(LIMITE_DA_FAIXA);
    expect(alertas(recolhidos)).toHaveLength(4);
    expect(html).toContain('<span class="plc-faixa-mais">Ver mais 4 clientes</span>');
    // O total continua no cabeçalho.
    expect(html).toContain('9 clientes · semana 2');
  });

  it('um a mais que o limite não vira "Ver mais 1": mostra todos', () => {
    const html = faixa(muitos.slice(0, LIMITE_DA_FAIXA + 1));
    expect(html).not.toContain('<details');
    expect(alertas(html)).toHaveLength(LIMITE_DA_FAIXA + 1);
  });
});

/* ───────────────────────────── a tabela ───────────────────────────── */

describe('VisaoDoContrato — grupos por responsável', () => {
  const html = contrato();
  const gs = grupos(html);

  it('um grupo por responsável, pelo nome, e "Sem responsável" no fim', () => {
    expect(gs.map((g) => g.id)).toEqual(['u-carla', 'u-helena', 'sem-responsavel']);
  });

  it('o cabeçalho do grupo diz o nome e quantos clientes', () => {
    expect(gs[0].html).toContain('<span class="plc-grupo-nome">Carla</span> · 3 clientes');
    expect(gs[1].html).toContain('<span class="plc-grupo-nome">Helena</span> · 3 clientes');
    expect(gs[2].html).toContain('<span class="plc-grupo-nome">Sem responsável</span> · 1 cliente');
  });

  it('o cliente de dois responsáveis aparece nos dois grupos', () => {
    expect(clientesEm(gs[0].html)).toContain('c-livraria');
    expect(clientesEm(gs[1].html)).toContain('c-livraria');
  });

  it('dentro do grupo, quem está em risco na semana vem antes (a ordem da F35)', () => {
    expect(clientesEm(gs[0].html)).toEqual(['c-cafe', 'c-estudio', 'c-livraria']);
    expect(clientesEm(gs[1].html)).toEqual(['c-aurora', 'c-horizonte', 'c-livraria']);
  });

  it('o nome do cliente abre o painel do cliente ao lado (Fase 3), num link de verdade', () => {
    expect(html).toMatch(
      /<a class="plc-nome" aria-haspopup="dialog" href="\/planejamento\?visao=contrato&amp;cliente=c-cafe"[^>]*>Café do Bairro<\/a>/,
    );
    expect(html).not.toContain('href="/cliente/');
  });

  it('sem moldura por linha: nenhum `o-card`, e cada linha é um `<tr>` comum', () => {
    expect(html).not.toContain('o-card');
    expect(html.match(/<tr class="plc-linha"/g)).toHaveLength(7);
  });
});

describe('VisaoDoContrato — as colunas', () => {
  const html = contrato();

  it('uma coluna por tipo que aparece no mês — sem ninguém com ads, sem coluna de ads', () => {
    const tipos = [...html.matchAll(/<th scope="col" class="plc-tipo" data-tipo="([a-z]+)">([^<]+)<\/th>/g)].map((m) => [m[1], m[2]]);
    expect(tipos).toEqual([
      ['video', 'Vídeo'],
      ['arte', 'Arte'],
      ['foto', 'Foto'],
    ]);
    expect(html).not.toContain('data-tipo="ads"');
  });

  it('no mês de hoje, a coluna "Esta semana" existe', () => {
    expect(html).toContain('<th scope="col" class="plc-semana">Esta semana</th>');
  });

  it('noutro mês, "esta semana" não é dele: a coluna some', () => {
    const setembro = contrato('', linhasDe('2026-09'), '2026-09');
    expect(setembro).not.toContain('Esta semana');
    expect(setembro).not.toContain('class="plc-semana"');
  });

  it('o cliente sem contrato não abre coluna e diz "sem contrato" na linha inteira', () => {
    expect(tiposDoMes(LINHAS.filter((l) => l.id === 'c-norte'))).toEqual([]);
    expect(linhaDe(html, 'c-norte')).toContain('<td class="plc-sem-contrato" colSpan="3">sem contrato</td>');
  });

  it('o tipo que o cliente não contratou é um travessão', () => {
    expect(celula(linhaDe(html, 'c-cafe'), 'foto')).toContain('—');
  });
});

describe('VisaoDoContrato — a barra de três partes', () => {
  const html = contrato();

  it('entregue, marcada e sem dia, cada parte do tamanho do que conta', () => {
    const arte = celula(linhaDe(html, 'c-livraria'), 'arte');
    expect(arte).toContain('<span data-parte="entregue" style="flex-grow:2"></span>');
    expect(arte).toContain('<span data-parte="marcada" style="flex-grow:1"></span>');
    expect(arte).toContain('<span data-parte="sem-dia" style="flex-grow:5"></span>');
  });

  it('embaixo, "2 de 8 · 5 sem dia" — e o "sem dia" é o que tem cor', () => {
    const arte = celula(linhaDe(html, 'c-livraria'), 'arte');
    expect(arte).toContain('<b class="tnum">2</b> de 8 · <span data-tom="warn">5 sem dia</span>');
  });

  it('tudo com dia: "tudo marcado", sem cor e sem a parte vazia', () => {
    const arte = celula(linhaDe(html, 'c-horizonte'), 'arte');
    expect(arte).toContain('<b class="tnum">1</b> de 4 · <span>tudo marcado</span>');
    expect(arte).not.toContain('data-parte="sem-dia"');
  });

  it('nada criado: a barra é só o trilho, "0 de 4 · 4 sem dia"', () => {
    const video = celula(linhaDe(html, 'c-cafe'), 'video');
    expect(video).toContain('<span data-parte="sem-dia" style="flex-grow:4"></span>');
    expect(video).not.toContain('data-parte="entregue"');
    expect(video).toContain('<b class="tnum">0</b> de 4 · <span data-tom="warn">4 sem dia</span>');
  });

  it('a vencida tem dia: conta em "marcada", e quem a acusa é a coluna da semana', () => {
    const arte = celula(linhaDe(html, 'c-estudio'), 'arte');
    expect(arte).toContain('<span data-parte="marcada" style="flex-grow:4"></span>');
    expect(arte).toContain('tudo marcado');
  });

  it('a barra fala com o leitor de tela', () => {
    expect(celula(linhaDe(html, 'c-livraria'), 'arte')).toContain(
      'role="img" aria-label="Arte: 2 de 8 entregues, 1 marcada, 5 sem dia"',
    );
  });
});

describe('VisaoDoContrato — o mês do cliente e esta semana', () => {
  const html = contrato();
  const semana = (id: string) => linhaDe(html, id).match(/<td class="plc-semana">([\s\S]*?)<\/td>/)?.[1] ?? '';

  it('três pontos e o passo; só o mês não aberto de quem tem contrato é âmbar', () => {
    const aurora = linhaDe(html, 'c-aurora');
    expect(aurora).toContain('<i data-ponto="atencao"></i><i data-ponto="depois"></i><i data-ponto="depois"></i>');
    expect(aurora).toContain('<span class="plc-etapas-nome">Mês não aberto</span>');
    const cafe = linhaDe(html, 'c-cafe');
    expect(cafe).toContain('<i data-ponto="feito"></i><i data-ponto="falta"></i><i data-ponto="depois"></i>');
    expect(cafe).toContain('Falta planejar');
    expect(linhaDe(html, 'c-estudio')).toContain('Falta aprovar');
    expect(linhaDe(html, 'c-horizonte')).toContain(
      '<i data-ponto="feito"></i><i data-ponto="feito"></i><i data-ponto="feito"></i></span><span class="plc-etapas-nome">Aprovado</span>',
    );
  });

  it('nada marcado (âmbar), atrasada (vermelho), e a semana que já bateu em silêncio', () => {
    expect(semana('c-cafe')).toContain('data-tom="warn"');
    expect(semana('c-cafe')).toContain('>nada marcado<');
    expect(semana('c-estudio')).toContain('data-tom="err"');
    expect(semana('c-estudio')).toContain('>1 atrasada<');
    expect(semana('c-horizonte')).toMatch(/<span title="[^"]*">✓ 2 de 2<\/span>/);
    expect(semana('c-livraria')).toMatch(/<span title="[^"]*">1 de 2<\/span>/);
  });

  it('quem não tem contrato não tem semana', () => {
    expect(semana('c-norte')).toContain('—');
  });
});

describe('VisaoDoContrato — o filtro', () => {
  it('"cafe" acha "Café do Bairro" (sem acento, sem caixa)', () => {
    const html = contrato('cafe');
    expect([...new Set(clientesEm(html))]).toEqual(['c-cafe']);
  });

  it('as colunas não mudam com o filtro', () => {
    expect(contrato('cafe')).toContain('data-tipo="foto"');
  });

  it('nada achado: o estado "sem resultado" com a saída de limpar', () => {
    const html = contrato('xyz');
    expect(html).toContain('data-estado="sem-resultado"');
    expect(html).toContain('Nenhum cliente com “xyz”.');
    expect(html).toContain('Limpar filtro');
    expect(html).not.toContain('<table');
  });
});

/* ─────────────── o resumo por etapa e "Só o que falta" — Fase 4 ─────────────── */

/**
 * AS DUAS FUNÇÕES DA ANTIGA ABA MÊS, DE VOLTA. A Fase 2 tirou a aba e elas
 * foram junto; o Wesley pediu de volta ("não esconder nenhum botão sem
 * querer… ou função"). Os nomes são os de antes: as quatro etapas do resumo
 * (`ESTAGIOS` da aba Mês) e o botão "Só o que falta" com `aria-pressed`.
 */
describe('VisaoDoContrato — o resumo por etapa e "Só o que falta" (Fase 4)', () => {
  const html = contrato();
  const ferramentas = html.slice(html.indexOf('class="plc-ferramentas"'), html.indexOf('<table'));
  const resumo = (h: string) =>
    [...h.matchAll(/<li data-estagio="([a-z]+)">([^<]+) <b class="tnum">(\d+)<\/b><\/li>/g)].map((m) => [m[2], Number(m[3])]);

  it('na linha do filtro, antes da tabela: o campo, o botão, o resumo e a legenda', () => {
    const ordem = ['iw-busca', 'Só o que falta', 'class="plc-resumo"', 'class="plc-legenda"'].map((t) => ferramentas.indexOf(t));
    expect(ordem.every((p) => p >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
  });

  it('as quatro etapas com quantos clientes há em cada — a conta de `resumirRitual`', () => {
    // Aurora não abriu; Café e Norte falta planejar; Estúdio falta aprovar;
    // Horizonte e Livraria aprovados. A Livraria, de dois responsáveis, conta uma vez.
    expect(resumo(ferramentas)).toEqual([
      ['Mês não aberto', 1],
      ['Falta planejar', 2],
      ['Falta aprovar', 1],
      ['Aprovados', 2],
    ]);
    expect(ferramentas).toContain('aria-label="Clientes por etapa do mês de outubro de 2026"');
  });

  it('discreto: sem caixa e sem cor — texto e número', () => {
    const linha = ferramentas.slice(ferramentas.indexOf('class="plc-resumo"'));
    expect(linha.slice(0, linha.indexOf('</ul>'))).not.toMatch(/data-tom|o-card|o-selo|style=/);
  });

  it('o botão "Só o que falta" alterna, com `aria-pressed`, como na aba Mês', () => {
    expect(ferramentas).toMatch(/<button type="button" aria-pressed="false" class="[^"]*o-btn-vidro[^"]*">Só o que falta<\/button>/);
    expect(contrato('', LINHAS, MES, HOJE, true)).toMatch(/<button type="button" aria-pressed="true"[^>]*>Só o que falta<\/button>/);
  });

  it('ligado, a tabela fica só com quem ainda não está aprovado — e o resumo conta o que ela mostra', () => {
    const ligado = contrato('', LINHAS, MES, HOJE, true);
    expect([...new Set(clientesEm(ligado))].sort()).toEqual(['c-aurora', 'c-cafe', 'c-estudio', 'c-norte']);
    expect(resumo(ligado)).toEqual([
      ['Mês não aberto', 1],
      ['Falta planejar', 2],
      ['Falta aprovar', 1],
      ['Aprovados', 0],
    ]);
  });

  it('o resumo segue também o filtro de nome', () => {
    expect(resumo(contrato('cafe'))).toEqual([
      ['Mês não aberto', 0],
      ['Falta planejar', 1],
      ['Falta aprovar', 0],
      ['Aprovados', 0],
    ]);
  });

  it('nada pendente: diz isso, e a saída é mostrar todos (não "nenhum cliente")', () => {
    const nada = contrato('horizonte', LINHAS, MES, HOJE, true);
    expect(nada).toContain('Nada falta fechar com “horizonte”.');
    expect(nada).toContain('Mostrar todos');
    expect(nada).not.toContain('Nenhum cliente com');
    expect(nada).not.toContain('<table');
    const aprovados = planejarMes({ ritual: RITUAL.filter((r) => r.clientApprovedAt), semanas: SEMANAS, mes: MES, hoje: HOJE }).filter(
      (l) => l.estagio === 'aprovado',
    );
    expect(contrato('', aprovados, MES, HOJE, true)).toContain('Nada falta fechar neste mês.');
  });

  it('o nome que não existe continua dizendo "nenhum cliente", com ou sem o botão', () => {
    expect(contrato('xyz', LINHAS, MES, HOJE, true)).toContain('Nenhum cliente com “xyz”.');
  });
});

/* ───────────────────────────── as palavras ───────────────────────────── */

describe('as palavras da visão Contrato', () => {
  const tipo = (over: Partial<ContratoDoTipo>): ContratoDoTipo => ({
    tipo: 'arte',
    contrato: 4,
    entregues: 0,
    marcadas: 0,
    atrasadas: 0,
    foraDoMes: 0,
    semDia: 0,
    naoCriadas: 0,
    faltaMarcar: 0,
    extras: 0,
    extrasPendentes: 0,
    extrasAtrasadas: 0,
    semana: null,
    ...over,
  });

  it('as três partes somam o contrato', () => {
    const t = tipo({ entregues: 1, marcadas: 1, atrasadas: 1, foraDoMes: 1, faltaMarcar: 0 });
    expect(partesDaBarra(t)).toEqual({ entregue: 1, marcada: 3, semDia: 0 });
  });

  it('tudo entregue, extra ao lado, e o tipo que só tem extra', () => {
    expect(legendaDoTipo(tipo({ entregues: 4, extras: 1 }))).toMatchObject({ resto: 'tudo entregue', extra: '+1 extra' });
    expect(legendaDoTipo(tipo({ contrato: 0, extras: 1, extrasPendentes: 1 }))).toMatchObject({ feito: null, resto: '2 extras' });
  });

  it('a semana: falta marcar quando o marcado não cobre a meta', () => {
    const linha = {
      temContrato: true,
      tipos: [tipo({ semana: { meta: 3, feitas: 1, marcadas: 1, atrasadas: 0, estado: 'risco' } })],
    };
    expect(estaSemanaDoCliente(linha)).toMatchObject({ texto: 'falta marcar 1', tom: 'warn' });
  });

  it('a semana: o que sobra de um tipo não paga a falta de outro (a coluna diz o mesmo que a faixa)', () => {
    // 2 artes de meta com 3 entregues (uma extra) e 1 vídeo de meta sem peça:
    // a faixa acusa "falta marcar 1 vídeo"; somar tudo (3 de 3) pintava "✓".
    const linha = {
      temContrato: true,
      tipos: [
        tipo({ tipo: 'arte', semana: { meta: 2, feitas: 3, marcadas: 0, atrasadas: 0, estado: 'bateu' } }),
        tipo({ tipo: 'video', semana: { meta: 1, feitas: 0, marcadas: 0, atrasadas: 0, estado: 'risco' } }),
      ],
    };
    expect(estaSemanaDoCliente(linha)).toMatchObject({ texto: 'falta marcar 1', tom: 'warn' });
  });

  it('a semana: com tudo coberto por tipo, o placar conta só o que a meta pede', () => {
    const linha = {
      temContrato: true,
      tipos: [
        tipo({ tipo: 'arte', semana: { meta: 2, feitas: 3, marcadas: 0, atrasadas: 0, estado: 'bateu' } }),
        tipo({ tipo: 'video', semana: { meta: 1, feitas: 0, marcadas: 1, atrasadas: 0, estado: 'andamento' } }),
      ],
    };
    expect(estaSemanaDoCliente(linha)).toMatchObject({ texto: '2 de 3', tom: 'neutro' });
    const batida = {
      temContrato: true,
      tipos: [
        tipo({ tipo: 'arte', semana: { meta: 2, feitas: 3, marcadas: 0, atrasadas: 0, estado: 'bateu' } }),
        tipo({ tipo: 'video', semana: { meta: 1, feitas: 1, marcadas: 0, atrasadas: 0, estado: 'bateu' } }),
      ],
    };
    expect(estaSemanaDoCliente(batida)).toMatchObject({ texto: '✓ 4 de 3', tom: 'neutro' });
  });

  it('a semana sem meta e sem peça não acusa ninguém', () => {
    const linha = { temContrato: true, tipos: [tipo({ semana: { meta: 0, feitas: 0, marcadas: 0, atrasadas: 0, estado: 'neutra' } })] };
    expect(estaSemanaDoCliente(linha)).toMatchObject({ texto: 'sem meta', tom: 'neutro' });
  });

  it('o motivo mais pesado escolhe a ação', () => {
    const nome = 'X';
    expect(acaoDaAtencao({ name: nome, motivos: [{ chave: 'semana-em-risco', texto: '', peso: 30 }] }).rotulo).toBe('Planejar');
    expect(acaoDaAtencao({ name: nome, motivos: [{ chave: 'semana-anterior-abaixo', texto: '', peso: 20 }] }).area).toBe('semanal');
  });
});

describe('VisaoDoContrato — cliente que veio só numa das leituras (Casos de Borda)', () => {
  const linhas = planejarMes({
    ritual: [...RITUAL, ritual('c-novo', 'Novo Cliente', PLANEJADO)],
    semanas: [...SEMANAS, semanas('c-so-semanas', 'Só Semanas', { owners: [CARLA], quota: { arte: 4 } })],
    mes: MES,
    hoje: HOJE,
  });
  const html = contrato('', linhas);

  it('só no ritual: aparece, sem afirmar "sem contrato" de quem não se leu as peças', () => {
    const novo = linhaDe(html, 'c-novo');
    expect(novo).toContain('data-leitura="so-ritual"');
    expect(novo).toContain('peças não carregadas');
    expect(novo).not.toContain('sem contrato');
    expect(novo).toContain('Falta aprovar');
  });

  it('só nas semanas: o mês aberto se sabe; planejado e aprovado ficam em aberto, sem palpite', () => {
    const so = linhaDe(html, 'c-so-semanas');
    expect(so).toContain('<i data-ponto="feito"></i><i data-ponto="desconhecido"></i><i data-ponto="desconhecido"></i>');
    expect(so).toContain('<span class="plc-etapas-nome">Aberto</span>');
    expect(celula(so, 'arte')).toContain('0</b> de 4');
  });
});
