/**
 * F43 Fase 10 — a carteira do Painel em linhas, sem anel e sem as quatro
 * barras coloridas.
 *
 * O QUE ESTE TESTE GUARDA
 *   A troca de forma (cartão → linha) só é melhora se nenhuma informação nem
 *   botão sumir no caminho — regra do Wesley em 08/10: "não esconder nenhum
 *   botão sem querer… ou função". Então cobra-se, na linha: o número da
 *   entrega (o que o anel mostrava), a barra ÚNICA e neutra, as peças por tipo
 *   em texto com o extra, plano, etiqueta com a cor escolhida, renovação, "no
 *   intervalo", o link para o cliente e o lápis de editar.
 *
 * Desenho no servidor (`renderToStaticMarkup`), como o resto da suíte: a
 * linha é exercida sozinha, com o cliente na mão.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { calculateDeliveryLevel, type ContractItem, type DeliveredItem } from '@/delivery/level';
import type { ClienteDoPainel } from '@/painel/carteira';
import { CartaoDeCliente } from '@/pages/Painel';

/** `n` peças entregues de um tipo (e `extras` além do contrato). */
const feitas = (tipo: string, n: number, extras = 0): DeliveredItem[] => [
  ...Array.from({ length: n }, () => ({ contentType: tipo, isExtra: false, isCompleted: true })),
  ...Array.from({ length: extras }, () => ({ contentType: tipo, isExtra: true, isCompleted: true })),
];

const contrato: ContractItem[] = [
  { contentType: 'video', quantity: 4 },
  { contentType: 'arte', quantity: 8 },
];

const cliente = (over: Partial<ClienteDoPainel> = {}): ClienteDoPainel => ({
  id: 'c-aurora',
  name: 'Aurora Mercado',
  categoryId: 'cat-ide',
  categoryName: 'Ide',
  categorySortOrder: 0,
  plan: { id: 'pl-1', name: 'Plano Conteúdo', colorBg: '#eef2ee', colorText: '#3b5a41', colorBorder: '#cfdcd1' },
  urgency: 'alerta',
  isActive: true,
  inactiveAt: null,
  financeOk: true,
  startedOn: '2026-01-01',
  renewsOn: '2026-12-05',
  tags: [{ id: 'tg-1', name: 'Recorrente', color: '#4b7555' }],
  inPeriod: { scheduled: 6, completed: 2 },
  delivery: calculateDeliveryLevel(contrato, [...feitas('video', 2), ...feitas('arte', 4, 2)]),
  deliveryStatus: null,
  ...over,
});

const desenhar = (c: ClienteDoPainel, aoEditar = () => {}) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(CartaoDeCliente, { c, aoEditar, origem: '?ordem=nome', rotuloDaEntrega: 'Entrega do mês' }),
    ),
  );

const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('F43 Fase 10: a linha da carteira', () => {
  it('o anel saiu: a entrega é o NÚMERO, com o nome da medida, e uma barra só', () => {
    const c = cliente();
    const html = desenhar(c);
    // O anel era um `<circle>` com traço medido; ícone de urgência pode ter círculo.
    expect(html).not.toContain('stroke-dasharray');
    // O nível é o de `calculateDeliveryLevel` (pesos por tipo); a linha só o escreve.
    const nivel = c.delivery.measurable ? c.delivery.level : NaN;
    expect(nivel).toBeGreaterThan(0);
    expect(nivel).toBeLessThan(100);
    expect(html).toContain(
      `<p class="pn-entrega"><span class="pn-entrega-valor tnum">${nivel}%</span><span class="pn-entrega-rotulo pn-dim">Entrega do mês</span>`,
    );
    // Uma barra, e não uma por tipo; a cor não é a do tipo (é a da folha).
    expect(html.match(/class="pn-entrega-barra"/g)).toHaveLength(1);
    expect(html).not.toContain('o-barra');
    expect(html).toContain(`style="width:${nivel}%"`);
    expect(html).not.toMatch(/--luz-ia|--tipo-arte|--luz-estudio|--luz-lives/);
  });

  it('as peças por tipo em texto, só os tipos do contrato, com o "+N" do extra', () => {
    const html = desenhar(cliente());
    const tipos = /<p class="pn-cartao-tipos" data-n="2">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? '';
    expect(texto(tipos)).toBe('Vídeos 2/4 Artes 4/8 +2');
    expect(tipos).not.toContain('Fotos');
    expect(tipos).not.toContain('ADS');
  });

  it('acima de 100%: o número diz o bônus, e a barra para cheia', () => {
    const html = desenhar(
      cliente({ delivery: calculateDeliveryLevel(contrato, [...feitas('video', 4, 3), ...feitas('arte', 8)]) }),
    );
    expect(html).toMatch(/pn-entrega-valor tnum">1\d\d%</);
    expect(html).toContain('style="width:100%"');
  });

  it('sem medida: traço, o motivo escrito e nenhuma barra', () => {
    const html = desenhar(cliente({ delivery: calculateDeliveryLevel([], [], { monthOpened: false, hasContentContract: true }) }));
    expect(html).toContain('pn-entrega-valor tnum">—<');
    expect(html).not.toContain('pn-entrega-barra');
    expect(html).toMatch(/<p class="pn-cartao-motivo" data-motivo="no_contract">/);
  });

  it('plano, etiqueta (com a cor que a agência escolheu), renovação e "no intervalo" continuam', () => {
    const html = desenhar(cliente());
    const apoio = /<p class="pn-cartao-rodape">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? '';
    expect(texto(apoio)).toBe('Plano Conteúdo Recorrente Renova 05/12/2026 no intervalo 2/6');
    expect(apoio).toContain('background:#4b7555');
  });

  it('o link leva ao cliente e o lápis continua lá, com nome, depois do link', () => {
    const c = cliente();
    const html = desenhar(c);
    const nivel = c.delivery.measurable ? c.delivery.level : NaN;
    const link = html.indexOf('href="/cliente/c-aurora"');
    const lapis = html.indexOf('aria-label="Editar Aurora Mercado"');
    expect(link).toBeGreaterThan(-1);
    expect(lapis).toBeGreaterThan(link);
    expect(html).toContain(`aria-label="Abrir Aurora Mercado — urgência Atenção, entrega do mês ${nivel}%"`);
    expect(html).toMatch(/<button type="button" title="Editar Aurora Mercado" aria-label="Editar Aurora Mercado" class="o-btn o-btn-fantasma o-btn-icone o-editar-cartao pn-editar">/);
  });

  it('a urgência leva o nome da dimensão e a nota de que é marcada à mão', () => {
    const html = desenhar(cliente({ urgency: 'perigo' }));
    expect(html).toMatch(/<p class="pn-urgencia" data-tom="err" title="A urgência é marcada à mão/);
    expect(texto(/<p class="pn-urgencia"[\s\S]*?<\/p>/.exec(html)?.[0] ?? '')).toBe('Urgência Crítico (marcada à mão)');
  });
});
