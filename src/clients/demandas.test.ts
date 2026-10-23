import { describe, expect, it } from 'vitest';

import {
  type Demanda,
  agruparDemandas,
  diasAteOPrazo,
  estadoDaDemanda,
  ordenarDemandas,
  resumirDemandas,
} from '@/clients/demandas';

const AGORA = new Date('2026-08-20T12:00:00Z');

const demanda = (over: Partial<Demanda> = {}): Demanda => ({
  id: 't1',
  title: 'Tarefa',
  description: null,
  dueOn: null,
  completedAt: null,
  completedBy: null,
  archivedAt: null,
  assignees: [],
  createdAt: '2026-08-01T00:00:00Z',
  ...over,
});

describe('estadoDaDemanda', () => {
  it('prazo no passado é atrasada', () => {
    expect(estadoDaDemanda(demanda({ dueOn: '2026-08-19' }), AGORA)).toBe('atrasada');
  });

  it('prazo hoje ainda NÃO é atrasada', () => {
    // O prazo é um dia inteiro. Uma conta por instante contra a meia-noite diz
    // que venceu às 00h01 do proprio dia do prazo.
    expect(estadoDaDemanda(demanda({ dueOn: '2026-08-20' }), AGORA)).toBe('hoje');
  });

  it('às 23h59 do dia do prazo continua não sendo atrasada', () => {
    const quaseMeiaNoite = new Date('2026-08-20T23:59:59Z');
    expect(estadoDaDemanda(demanda({ dueOn: '2026-08-20' }), quaseMeiaNoite)).toBe('hoje');
  });

  it('prazo no futuro é em dia', () => {
    expect(estadoDaDemanda(demanda({ dueOn: '2026-08-25' }), AGORA)).toBe('em_dia');
  });

  it('sem prazo nunca é atrasada', () => {
    // No legado `prazo` é NOT NULL, então quem não tinha prazo ganhava data
    // inventada — e data inventada vence.
    expect(estadoDaDemanda(demanda({ dueOn: null }), AGORA)).toBe('sem_prazo');
  });

  it('concluída vence o prazo estourado', () => {
    // Pintar de vermelho o que já foi entregue ensina a ignorar o vermelho.
    const d = demanda({ dueOn: '2026-01-01', completedAt: '2026-08-19T10:00:00Z' });
    expect(estadoDaDemanda(d, AGORA)).toBe('concluida');
  });

  it('concluída sem prazo também é concluída', () => {
    expect(estadoDaDemanda(demanda({ completedAt: '2026-08-01T00:00:00Z' }), AGORA)).toBe(
      'concluida',
    );
  });
});

describe('diasAteOPrazo', () => {
  it('conta os dias que faltam', () => {
    expect(diasAteOPrazo('2026-08-25', AGORA)).toBe(5);
  });

  it('é zero no dia do prazo', () => {
    expect(diasAteOPrazo('2026-08-20', AGORA)).toBe(0);
  });

  it('fica negativo depois de vencer', () => {
    expect(diasAteOPrazo('2026-08-10', AGORA)).toBe(-10);
  });

  it('não se confunde com a hora do dia', () => {
    expect(diasAteOPrazo('2026-08-21', new Date('2026-08-20T23:59:00Z'))).toBe(1);
  });

  it('sem prazo devolve nulo, nunca zero', () => {
    expect(diasAteOPrazo(null, AGORA)).toBeNull();
  });
});

describe('o "hoje" é o dia de São Paulo, e não o de UTC', () => {
  // 22h de 20/08 em Brasília já é 01h de 21/08 em UTC. A agência trabalha até
  // tarde, e o Checklist dizia "atrasada" para o que vence hoje a partir das 21h.
  const NOITE_DE_20 = new Date('2026-08-21T01:00:00Z');
  const MADRUGADA_DE_21 = new Date('2026-08-21T03:00:00Z'); // 00h de 21/08 em Brasília

  it('às 22h de Brasília o prazo do dia continua sendo "vence hoje"', () => {
    expect(estadoDaDemanda(demanda({ dueOn: '2026-08-20' }), NOITE_DE_20)).toBe('hoje');
  });

  it('às 22h de Brasília o prazo de amanhã continua em dia', () => {
    expect(estadoDaDemanda(demanda({ dueOn: '2026-08-21' }), NOITE_DE_20)).toBe('em_dia');
  });

  it('à meia-noite de Brasília o prazo de ontem passa a atrasado', () => {
    expect(estadoDaDemanda(demanda({ dueOn: '2026-08-20' }), MADRUGADA_DE_21)).toBe('atrasada');
  });

  it('os dias até o prazo contam a partir do dia de Brasília', () => {
    expect(diasAteOPrazo('2026-08-20', NOITE_DE_20)).toBe(0);
    expect(diasAteOPrazo('2026-08-21', NOITE_DE_20)).toBe(1);
  });

  it('o resumo do topo concorda: às 22h, o do dia é "vence hoje" e não atrasada', () => {
    const r = resumirDemandas([demanda({ id: 'a', dueOn: '2026-08-20' })], NOITE_DE_20);
    expect(r).toMatchObject({ atrasadas: 0, vencemHoje: 1 });
  });
});

describe('ordenarDemandas', () => {
  it('põe o que cobra atenção primeiro', () => {
    const r = ordenarDemandas(
      [
        demanda({ id: 'concluida', dueOn: '2026-08-01', completedAt: '2026-08-02T00:00:00Z' }),
        demanda({ id: 'sem-prazo' }),
        demanda({ id: 'em-dia', dueOn: '2026-08-30' }),
        demanda({ id: 'hoje', dueOn: '2026-08-20' }),
        demanda({ id: 'atrasada', dueOn: '2026-08-10' }),
      ],
      AGORA,
    );
    expect(r.map((d) => d.id)).toEqual(['atrasada', 'hoje', 'em-dia', 'sem-prazo', 'concluida']);
  });

  it('dentro do grupo, prazo mais próximo primeiro', () => {
    const r = ordenarDemandas(
      [
        demanda({ id: 'muito-atrasada', dueOn: '2026-01-01' }),
        demanda({ id: 'pouco-atrasada', dueOn: '2026-08-19' }),
      ],
      AGORA,
    );
    expect(r.map((d) => d.id)).toEqual(['muito-atrasada', 'pouco-atrasada']);
  });

  it('sem prazo, a mais antiga primeiro', () => {
    const r = ordenarDemandas(
      [
        demanda({ id: 'nova', createdAt: '2026-08-15T00:00:00Z' }),
        demanda({ id: 'velha', createdAt: '2026-02-01T00:00:00Z' }),
      ],
      AGORA,
    );
    expect(r.map((d) => d.id)).toEqual(['velha', 'nova']);
  });

  it('não altera a lista recebida', () => {
    const lista = [demanda({ id: 'b', dueOn: '2026-08-30' }), demanda({ id: 'a', dueOn: '2026-01-01' })];
    ordenarDemandas(lista, AGORA);
    expect(lista[0].id).toBe('b');
  });
});

describe('resumirDemandas', () => {
  it('separa pendente de concluída, e conta os alarmes', () => {
    const r = resumirDemandas(
      [
        demanda({ id: '1', dueOn: '2026-08-10' }),
        demanda({ id: '2', dueOn: '2026-08-11' }),
        demanda({ id: '3', dueOn: '2026-08-20' }),
        demanda({ id: '4', dueOn: '2026-09-01' }),
        demanda({ id: '5' }),
        demanda({ id: '6', dueOn: '2026-01-01', completedAt: '2026-01-02T00:00:00Z' }),
      ],
      AGORA,
    );
    expect(r).toEqual({ pendentes: 5, atrasadas: 2, vencemHoje: 1, concluidas: 1 });
  });

  it('concluída atrasada não conta como atrasada', () => {
    const r = resumirDemandas(
      [demanda({ dueOn: '2026-01-01', completedAt: '2026-08-01T00:00:00Z' })],
      AGORA,
    );
    expect(r.atrasadas).toBe(0);
    expect(r.concluidas).toBe(1);
  });

  it('lista vazia devolve tudo zerado', () => {
    expect(resumirDemandas([], AGORA)).toEqual({
      pendentes: 0,
      atrasadas: 0,
      vencemHoje: 0,
      concluidas: 0,
    });
  });
});

describe('agruparDemandas — F11C', () => {
  const lista = [
    demanda({ id: 'arq-atrasada', dueOn: '2026-08-01', archivedAt: '2026-08-05T00:00:00Z' }),
    demanda({ id: 'feita', dueOn: '2026-08-10', completedAt: '2026-08-09T00:00:00Z' }),
    demanda({ id: 'sem-prazo' }),
    demanda({ id: 'atrasada', dueOn: '2026-08-19' }),
    demanda({ id: 'arq-feita', completedAt: '2026-07-01T00:00:00Z', archivedAt: '2026-07-02T00:00:00Z' }),
  ];

  it('arquivada fica no grupo dela, mesmo atrasada — não sobe acima do que cobra atenção', () => {
    const g = agruparDemandas(lista, AGORA);
    expect(g.pendentes.map((d) => d.id)).toEqual(['atrasada', 'sem-prazo']);
    expect(g.concluidas.map((d) => d.id)).toEqual(['feita']);
    expect(g.arquivadas.map((d) => d.id)).toEqual(['arq-atrasada', 'arq-feita']);
  });

  it('nenhuma demanda some nem se repete', () => {
    const g = agruparDemandas(lista, AGORA);
    const ids = [...g.pendentes, ...g.concluidas, ...g.arquivadas].map((d) => d.id);
    expect(ids.sort()).toEqual(lista.map((d) => d.id).sort());
  });

  it('o resumo sem as arquivadas é o mesmo com ou sem "Ver arquivadas"', () => {
    const semArquivadas = lista.filter((d) => d.archivedAt === null);
    const g = agruparDemandas(lista, AGORA);
    expect(resumirDemandas([...g.pendentes, ...g.concluidas], AGORA)).toEqual(
      resumirDemandas(semArquivadas, AGORA),
    );
  });
});
