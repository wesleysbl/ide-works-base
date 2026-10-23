import { describe, expect, it } from 'vitest';

import { defaultPeriod, itemNoPeriodo, repartirItensDoMes } from '@/server/client-detail';

describe('defaultPeriod — o mes inteiro', () => {
  it('agosto vai de 01/08 ate 01/09, fim exclusivo', () => {
    expect(defaultPeriod('2026-08-01')).toEqual({ from: '2026-08-01', to: '2026-09-01' });
  });

  it('dezembro vira o ano', () => {
    expect(defaultPeriod('2026-12-01')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
  });

  it('fevereiro em ano bissexto termina no dia 1 de marco de qualquer jeito', () => {
    // O fim e exclusivo, entao o numero de dias do mes nao importa — e por isso
    // que ele e exclusivo.
    expect(defaultPeriod('2028-02-01')).toEqual({ from: '2028-02-01', to: '2028-03-01' });
  });

  it('normaliza qualquer dia do mes para o primeiro', () => {
    expect(defaultPeriod('2026-08-31')).toEqual({ from: '2026-08-01', to: '2026-09-01' });
  });
});

describe('itemNoPeriodo — o dia do item é o de São Paulo', () => {
  const setembro = { from: '2026-09-01', to: '2026-10-01' };

  it('a peça das 22h do dia 30 (01h UTC do dia 1) ainda é de setembro', () => {
    // Com o dia de UTC ela saía da lista de setembro, e o Calendário a mostrava lá.
    expect(itemNoPeriodo(new Date('2026-10-01T01:00:00.000Z'), setembro)).toBe(true);
    expect(itemNoPeriodo('2026-10-01T01:00:00.000Z', setembro)).toBe(true);
  });

  it('a peça da meia-noite de São Paulo do dia 1 já é de outubro', () => {
    expect(itemNoPeriodo(new Date('2026-10-01T03:00:00.000Z'), setembro)).toBe(false);
  });

  it('o primeiro dia do período entra, mesmo agendado às 22h do dia anterior em UTC não', () => {
    // 22h de 31/08 em São Paulo é do mês anterior.
    expect(itemNoPeriodo(new Date('2026-09-01T01:00:00.000Z'), setembro)).toBe(false);
    expect(itemNoPeriodo(new Date('2026-09-01T12:00:00.000Z'), setembro)).toBe(true);
  });

  it('sem data (ou data ilegível) não está em período nenhum', () => {
    expect(itemNoPeriodo(null, setembro)).toBe(false);
    expect(itemNoPeriodo('banana', setembro)).toBe(false);
  });
});

describe('repartirItensDoMes — a lista de Conteúdos não perde peça do mês', () => {
  const item = (id: string, agendadoEm: string | null) => ({ id, scheduled_at: agendadoEm });
  // Agosto: uma dentro, uma agendada para setembro (competência de agosto, dia de outro mês) e uma sem data.
  const doMes = [item('dentro', '2026-08-12T15:00:00.000Z'), item('transbordo', '2026-09-02T15:00:00.000Z'), item('sem-data', null)];

  it('sem período escolhido, a peça de agosto agendada em setembro continua na lista', () => {
    // O medidor de agosto a conta; a lista a escondia, e ninguém achava a terceira peça.
    const { agendados, semData } = repartirItensDoMes(doMes);
    expect(agendados.map((i) => i.id)).toEqual(['dentro', 'transbordo']);
    expect(semData.map((i) => i.id)).toEqual(['sem-data']);
  });

  it('com período escolhido, a lista respeita o recorte pedido', () => {
    const { agendados, semData } = repartirItensDoMes(doMes, { from: '2026-08-10', to: '2026-08-20' });
    expect(agendados.map((i) => i.id)).toEqual(['dentro']);
    // O sem data não depende de período: vem sempre à parte.
    expect(semData.map((i) => i.id)).toEqual(['sem-data']);
  });
});
