import { describe, expect, it } from 'vitest';

import {
  type LinhaDePlanejamento,
  ofereceAprovacao,
  ordenarPorRitual,
  proximoPasso,
  resumirRitual,
  travaDoPlanejamento,
} from '@/painel/planejamento';

const linha = (over: Partial<LinhaDePlanejamento> = {}): LinhaDePlanejamento => ({
  id: 'c1',
  name: 'Cliente',
  categoryId: 'cat',
  categoryName: 'IDE',
  plan: null,
  monthOpened: true,
  planningDoneAt: null,
  clientApprovedAt: null,
  ...over,
});

const fechado = (over: Partial<LinhaDePlanejamento> = {}) =>
  linha({ monthOpened: false, ...over });
const aberto = (over: Partial<LinhaDePlanejamento> = {}) => linha(over);
const planejado = (over: Partial<LinhaDePlanejamento> = {}) =>
  linha({ planningDoneAt: '2026-08-05T00:00:00Z', ...over });
const aprovado = (over: Partial<LinhaDePlanejamento> = {}) =>
  linha({
    planningDoneAt: '2026-08-05T00:00:00Z',
    clientApprovedAt: '2026-08-06T00:00:00Z',
    ...over,
  });

describe('ordenarPorRitual', () => {
  it('poe primeiro o que ainda da trabalho', () => {
    const r = ordenarPorRitual([
      aprovado({ id: 'pronto', name: 'A' }),
      planejado({ id: 'falta-aprovar', name: 'B' }),
      aberto({ id: 'falta-planejar', name: 'C' }),
      fechado({ id: 'nem-abriu', name: 'D' }),
    ]);
    expect(r.map((x) => x.id)).toEqual([
      'nem-abriu',
      'falta-planejar',
      'falta-aprovar',
      'pronto',
    ]);
  });

  it('desempata por nome dentro do mesmo estagio', () => {
    const r = ordenarPorRitual([aberto({ id: 'z', name: 'Zeta' }), aberto({ id: 'a', name: 'Alfa' })]);
    expect(r.map((x) => x.name)).toEqual(['Alfa', 'Zeta']);
  });

  it('respeita acento do portugues no desempate', () => {
    const r = ordenarPorRitual([
      aberto({ id: '2', name: 'Otica' }),
      aberto({ id: '1', name: 'Ática' }),
    ]);
    expect(r.map((x) => x.name)).toEqual(['Ática', 'Otica']);
  });

  it('nao altera a lista recebida', () => {
    const lista = [aprovado({ id: 'pronto' }), fechado({ id: 'nem-abriu' })];
    ordenarPorRitual(lista);
    expect(lista[0].id).toBe('pronto');
  });

  it('aprovado sem planejamento marcado ainda conta como aprovado', () => {
    // O banco permite: aprovar sem ter marcado planejado e um estado possivel,
    // e a ordem nao pode joga-lo de volta para o topo da fila de trabalho.
    const r = ordenarPorRitual([
      linha({ id: 'so-aprovado', clientApprovedAt: '2026-08-06T00:00:00Z' }),
      aberto({ id: 'falta-tudo', name: 'ZZ' }),
    ]);
    expect(r[0].id).toBe('falta-tudo');
  });
});

describe('resumirRitual', () => {
  it('conta cada estagio e o que falta', () => {
    const r = resumirRitual([
      fechado({ id: '1' }),
      fechado({ id: '2' }),
      aberto({ id: '3' }),
      planejado({ id: '4' }),
      aprovado({ id: '5' }),
      aprovado({ id: '6' }),
    ]);
    expect(r).toEqual({
      total: 6,
      fechado: 2,
      aberto: 1,
      planejado: 1,
      aprovado: 2,
      faltam: 4,
    });
  });

  it('lista vazia nao quebra e nao inventa pendencia', () => {
    expect(resumirRitual([])).toEqual({
      total: 0,
      fechado: 0,
      aberto: 0,
      planejado: 0,
      aprovado: 0,
      faltam: 0,
    });
  });

  it('tudo aprovado zera o que falta', () => {
    expect(resumirRitual([aprovado({ id: '1' }), aprovado({ id: '2' })]).faltam).toBe(0);
  });
});

describe('próximo passo e o que se oferece — F12', () => {
  it('cada estágio diz o próximo passo', () => {
    expect(proximoPasso(fechado()).acao).toBe('abrir');
    expect(proximoPasso(aberto()).acao).toBe('planejar');
    expect(proximoPasso(planejado()).acao).toBe('aprovar');
    expect(proximoPasso(aprovado()).acao).toBe('nenhuma');
  });

  it('a aprovação NÃO é oferecida antes do planejamento, nem com o mês fechado', () => {
    expect(ofereceAprovacao(fechado())).toBe(false);
    expect(ofereceAprovacao(aberto())).toBe(false);
    expect(ofereceAprovacao(planejado())).toBe(true);
  });

  it('depois de aprovada, a chave fica — é por ela que se retira a aprovação', () => {
    expect(ofereceAprovacao(aprovado())).toBe(true);
    // O estado que o banco permite: aprovado sem planejamento marcado.
    expect(ofereceAprovacao(linha({ clientApprovedAt: '2026-08-06T00:00:00Z' }))).toBe(true);
  });

  it('o planejamento de um mês aprovado está travado, com a frase da regra', () => {
    expect(travaDoPlanejamento(aprovado())).toMatch(/Retire a aprovação antes/);
    expect(travaDoPlanejamento(planejado())).toBeNull();
    expect(travaDoPlanejamento(aberto())).toBeNull();
    expect(travaDoPlanejamento(fechado())).toBeNull();
  });
});
