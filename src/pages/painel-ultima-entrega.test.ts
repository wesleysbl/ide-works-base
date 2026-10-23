/**
 * F38, Fase 2 — o cartão do Painel com a última entrega pela Semanal. Desde
 * a F43 Fase 10 o cartão é uma LINHA da carteira (`CartaoDeCliente` manteve o
 * nome); as mesmas informações, em colunas.
 *
 * Desenho no servidor (`renderToStaticMarkup`): nenhum `useEffect` roda, então
 * o cartão é exercido sozinho, com o cliente na mão. A carteira inteira, a
 * ordenação pelo seletor e o celular estão em
 * `scripts/e2e/painel-ultima-entrega.mjs`.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { calculateDeliveryLevel } from '@/delivery/level';
import type { DeliveryStatus } from '@/delivery/ultima-entrega';
import type { ClienteDoPainel } from '@/painel/carteira';
import { CartaoDeCliente } from '@/pages/Painel';

const situacao = (over: Partial<DeliveryStatus> = {}): DeliveryStatus => ({
  today: '2026-10-06',
  lastDeliveryOn: null,
  daysSinceLastDelivery: null,
  overdue: [],
  dueToday: 0,
  unscheduled: 0,
  nextScheduledOn: null,
  ...over,
});

const cliente = (over: Partial<ClienteDoPainel> = {}): ClienteDoPainel => ({
  id: 'c-fonseca',
  name: 'Fonseca Moura',
  categoryId: 'cat-ide',
  categoryName: 'Ide',
  categorySortOrder: 0,
  plan: null,
  urgency: 'paz',
  isActive: true,
  inactiveAt: null,
  financeOk: true,
  startedOn: '2026-01-01',
  renewsOn: null,
  tags: [],
  inPeriod: { scheduled: 0, completed: 0 },
  delivery: calculateDeliveryLevel([], [], { monthOpened: false, hasContentContract: true }),
  deliveryStatus: situacao({ lastDeliveryOn: '2026-10-05', daysSinceLastDelivery: 1 }),
  ...over,
});

const desenhar = (c: ClienteDoPainel) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(CartaoDeCliente, { c, aoEditar: () => {}, origem: '', rotuloDaEntrega: 'Entrega do mês' }),
    ),
  );

/** O texto visível, sem marcação — como a pessoa lê. */
const texto = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');

const rotuloDoLink = (html: string) => /<a [^>]*aria-label="([^"]*)"/.exec(html)?.[1] ?? '';

describe('o cartão do Painel — última entrega (F38)', () => {
  it('com entrega: "Última entrega 05/10 · há 1 dia", na coluna dela', () => {
    const html = desenhar(cliente());
    expect(texto(html)).toContain('Última entrega 05/10 · há 1 dia');
    // F43 Fase 10 — o cartão virou linha da carteira, e a última entrega
    // ganhou coluna própria (era no cabeçalho do cartão, ao lado do anel).
    // O que se cobra é o mesmo: a linha a diz, com o nome da medida, e o
    // nome acessível do link também.
    const coluna = /<div class="pn-linha-ultima">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
    expect(coluna).toContain('class="pn-ultima"');
    expect(coluna).toContain('Última entrega');
    expect(rotuloDoLink(html)).toContain('última entrega 05/10, há 1 dia');
  });

  it('entrega de hoje diz "hoje"', () => {
    const html = desenhar(cliente({ deliveryStatus: situacao({ lastDeliveryOn: '2026-10-06', daysSinceLastDelivery: 0 }) }));
    expect(texto(html)).toContain('Última entrega 06/10 · hoje');
  });

  it('sem entrega: "Sem entrega registrada", na tela e no nome acessível', () => {
    const html = desenhar(cliente({ deliveryStatus: situacao() }));
    expect(texto(html)).toContain('Sem entrega registrada');
    expect(texto(html)).not.toContain('Última entrega');
    expect(rotuloDoLink(html)).toContain('sem entrega registrada');
  });

  it('sem situação (cancelado) o cartão não inventa "sem entrega"', () => {
    const html = desenhar(cliente({ isActive: false, deliveryStatus: null }));
    expect(html).not.toContain('pn-ultima');
    expect(texto(html)).not.toContain('Sem entrega registrada');
  });

  it('peças vencidas e que vencem hoje aparecem em "Pede ação", com o tom de cada uma', () => {
    const html = desenhar(
      cliente({ deliveryStatus: situacao({ lastDeliveryOn: '2026-10-01', daysSinceLastDelivery: 5, overdue: ['2026-08-01', '2026-10-01'], dueToday: 1 }) }),
    );
    const faixa = /<ul class="pn-situacoes" aria-label="Pede ação">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? '';
    expect(faixa).toMatch(/<li data-tom="err">[\s\S]*?2 peças vencidas sem ✓<\/li>/);
    expect(faixa).toMatch(/<li data-tom="warn">[\s\S]*?1 peça vence hoje<\/li>/);
    // Cada uma com o seu ícone (svg), como as situações de antes.
    expect(faixa.match(/<svg/g)).toHaveLength(2);
  });
});

describe('o cartão diante de um servidor anterior à F38', () => {
  it('sem o campo `deliveryStatus`, desenha sem a linha e sem quebrar', () => {
    const antigo: Partial<ClienteDoPainel> = cliente();
    delete antigo.deliveryStatus;
    const html = desenhar(antigo as ClienteDoPainel);
    expect(html).toContain('Fonseca Moura');
    expect(html).not.toContain('pn-ultima');
  });
});
