/**
 * A visão Calendário do Planejamento — F43, Fase 4.
 *
 * Desenha a TELA inteira (`Planejamento`, com barra e topo) no servidor
 * (`renderToStaticMarkup`, nenhum efeito roda): o que se prova é o primeiro
 * quadro de cada endereço — qual aba está escolhida, que controles existem e
 * quantos de cada, e que item da barra está aceso. Os dados não chegam (a
 * busca é efeito); o que eles fazem na tela está nos testes da visão Contrato,
 * da grade e no e2e `agenda-planejamento`.
 *
 * ⚠️ O MÊS DE HOJE é o do relógio da máquina (`mesDeHoje`), o mesmo que a tela
 * calcula: o teste não fixa data, ele compara com a mesma conta.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import Planejamento from '@/pages/Planejamento';
import { mesDeHoje } from '@/ui/grade-do-mes';

const desenhar = (endereco: string) =>
  renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [endereco] }, createElement(Planejamento)));

const quantas = (html: string, trecho: string) => html.split(trecho).length - 1;

/** O `<a>` da barra que leva a `href`. */
const itemDaBarra = (html: string, href: string) =>
  html.match(new RegExp(`<a[^>]*href="${href.replace(/[?]/g, '\\?')}"[^>]*>`))?.[0] ?? '';

/** A aba (`role="tab"`) com o nome, inteira. */
const aba = (html: string, nome: string) =>
  html.match(new RegExp(`<button[^>]*role="tab"[^>]*>(?:(?!</button>)[\\s\\S])*?${nome}(?:(?!</button>)[\\s\\S])*?</button>`))?.[0] ?? '';

describe('`/planejamento?visao=calendario` — a terceira visão', () => {
  const html = desenhar('/planejamento?visao=calendario');

  it('as três abas, com Calendário escolhida', () => {
    for (const nome of ['Contrato', 'Semanas', 'Calendário']) expect(aba(html, nome), nome).not.toBe('');
    expect(aba(html, 'Calendário')).toContain('aria-selected="true"');
    expect(aba(html, 'Contrato')).toContain('aria-selected="false"');
  });

  it('o título continua sendo o Planejamento', () => {
    expect(html).toMatch(/<h1[^>]*>Planejamento<\/h1>/);
  });

  it('UM controle de mês: o do calendário — um "Mês anterior", um "Próximo mês", sem o mês do topo', () => {
    expect(quantas(html, 'aria-label="Mês anterior"')).toBe(1);
    expect(quantas(html, 'aria-label="Próximo mês"')).toBe(1);
    expect(html).not.toContain('aria-label="Mês do planejamento"');
    expect(html).toContain('class="cal-barra"');
  });

  it('a barra do calendário inteira, com os nomes de sempre: o campo do mês, Hoje, o período e Mês/Agenda', () => {
    expect(html).toMatch(new RegExp(`<input type="month"[^>]*aria-label="Mês do calendário"[^>]*value="${mesDeHoje()}"`));
    expect(html).toMatch(/aria-label="Hoje, \d\d\/\d\d\/\d{4}"/);
    expect(html).toContain('Mês todo');
    expect(html).toMatch(/aria-pressed="(true|false)"[^>]*>Mês<\/button>/);
    expect(html).toMatch(/aria-pressed="(true|false)"[^>]*>Agenda<\/button>/);
  });

  it('UMA ação no topo: o `+ Marcar` de sempre — e não um `+ Peça` ao lado', () => {
    expect(quantas(html, '>+ Marcar</button>')).toBe(1);
    expect(html).not.toContain('>+ Peça</button>');
  });

  it('a barra acende o Calendário (foi por ele que se chegou), e não o Planejamento', () => {
    const calendario = itemDaBarra(html, '/planejamento?visao=calendario');
    expect(calendario).toContain('aria-current="page"');
    expect(calendario).toContain('data-atual="true"');
    expect(itemDaBarra(html, '/planejamento')).not.toContain('aria-current');
  });

  it('o carregando, o erro e o vazio do ritual não são do calendário', () => {
    expect(html).not.toContain('Nenhum cliente ativo neste mês.');
    expect(html).not.toMatch(/Carregando [a-zç]+ de \d{4}…/);
  });
});

describe('o mês no endereço', () => {
  it('`?mes=AAAA-MM` abre aquele mês no calendário', () => {
    expect(desenhar('/planejamento?visao=calendario&mes=2026-12')).toMatch(/<input type="month"[^>]*value="2026-12"/);
  });

  it('…e nas outras visões: o mês do topo diz o mês do endereço', () => {
    expect(desenhar('/planejamento?mes=2027-01')).toContain('Janeiro de 2027');
  });

  it('mês inválido abre o mês de hoje, e não tela vazia', () => {
    expect(desenhar('/planejamento?visao=calendario&mes=2026-13')).toMatch(new RegExp(`<input type="month"[^>]*value="${mesDeHoje()}"`));
  });
});

describe('as outras visões continuam como eram', () => {
  const html = desenhar('/planejamento');

  it('Contrato: o mês do topo, com UM "Próximo mês", e o `+ Peça`', () => {
    expect(html).toContain('aria-label="Mês do planejamento"');
    expect(quantas(html, 'aria-label="Próximo mês"')).toBe(1);
    expect(quantas(html, '>+ Peça</button>')).toBe(1);
    expect(html).not.toContain('>+ Marcar</button>');
    expect(html).not.toContain('class="cal-barra"');
  });

  it('a barra acende o Planejamento', () => {
    expect(itemDaBarra(html, '/planejamento')).toContain('aria-current="page"');
    expect(itemDaBarra(html, '/planejamento?visao=calendario')).not.toContain('aria-current');
  });

  it('Semanas também acende o Planejamento', () => {
    expect(itemDaBarra(desenhar('/planejamento?visao=semanas'), '/planejamento')).toContain('aria-current="page"');
  });
});
