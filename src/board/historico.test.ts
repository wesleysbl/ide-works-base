/**
 * O HISTÓRICO DE MOVIMENTAÇÃO — a frase e a linha do tempo. F17.65.
 *
 * O QUE ESTE ARQUIVO PROVA, E O QUE ELE NÃO CONSEGUE PROVAR
 *   Aqui não há banco. Ele NÃO prova que trocar o status à mão deixa rastro,
 *   nem que ninguém consegue apagar um evento, nem que quem não vê a tarefa não
 *   vê o evento — isso é `scripts/provar-o-historico.mjs`, que precisa de banco
 *   vivo e termina em `ROLLBACK_PROPOSITAL`.
 *
 *   O que ele guarda é o que quebra em silêncio: a FRASE que a pessoa lê, e a
 *   ORDEM em que os degraus aparecem.
 */

import { describe, expect, it } from 'vitest';

import type { Comentario } from '@/board/conversa';
import {
  type EventoDaTarefa,
  foiAutomacao,
  frasesDoEvento,
  montarHistorico,
  quemFez,
} from '@/board/historico';

/** O que a captura do usuário mostra: a Helena empurrando a tarefa à mão. */
const A_MAO: EventoDaTarefa = {
  id: '31',
  automationName: null,
  actorName: 'Helena',
  fromListName: 'Estúdio Ide',
  toListName: 'ESTÚDIO',
  fromStatusName: 'Aprovação',
  toStatusName: 'Enviar Fotos Ao Cliente',
  removed: ['Murilo Siqueira'],
  added: [],
  occurredAt: '2026-09-03T12:00:00.000Z',
};

/** A mesma tabela, o outro sujeito: a regra da F17.41. */
const A_REGRA: EventoDaTarefa = {
  id: '30',
  automationName: 'Passa para o atendimento',
  actorName: 'Helena',
  fromListName: 'Sabor Doce',
  toListName: 'ATENDIMENTO',
  fromStatusName: 'em revisão',
  toStatusName: 'na fila',
  removed: ['Caio Moraes'],
  added: ['Carla'],
  occurredAt: '2026-09-03T12:00:00.000Z',
};

const fala = (id: string, createdAt: string): Comentario => ({
  id,
  parentId: null,
  body: 'entrega no Dropbox',
  author: { id: 'u1', name: 'Carla' },
  createdAt,
  editedAt: null,
  replyCount: 0,
  mine: false,
  replies: [],
});

/* ─────────────────────────────── a frase ─────────────────────────────── */

describe('o sujeito da frase', () => {
  it('é a PESSOA quando a mudança foi feita à mão', () => {
    expect(quemFez(A_MAO)).toBe('Helena');
    expect(foiAutomacao(A_MAO)).toBe(false);
  });

  it('é o nome da REGRA quando foi a automação — e não quem estava agindo', () => {
    // `actor_id` está preenchido nos dois casos: é quem empurrou a tarefa. Mas
    // quem TIROU o responsável foi a regra, e é o nome dela que encabeça.
    expect(quemFez(A_REGRA)).toBe('Passa para o atendimento');
    expect(foiAutomacao(A_REGRA)).toBe(true);
  });

  it('a regra APAGADA continua nomeada — o livro não se reescreve', () => {
    // `task_events.automation_id` é `on delete set null`, e `automation_name` é
    // o retrato do nome no instante em que a regra rodou.
    expect(quemFez({ ...A_REGRA, automationName: 'Uma regra que já não existe' })).toBe(
      'Uma regra que já não existe',
    );
  });

  it('evento sem ator nenhum não começa a frase no verbo', () => {
    expect(quemFez({ ...A_MAO, actorName: null })).toBe('Alguém');
  });
});

describe('a frase do evento — o que a captura do usuário mostra', () => {
  it('escreve as três coisas da captura, uma por linha e na ordem dela', () => {
    expect(frasesDoEvento(A_MAO)).toEqual([
      'alterou o status de Aprovação para Enviar Fotos Ao Cliente',
      'alterou a lista de Estúdio Ide para ESTÚDIO',
      'removeu o responsável: Murilo Siqueira',
    ]);
  });

  it('⚠️ A REGRA E A PESSOA FALAM A MESMA LÍNGUA — muda o sujeito, não o verbo', () => {
    // Uma coluna com dois vocabulários obrigaria quem lê a aprender dois
    // idiomas para ler uma lista só.
    expect(frasesDoEvento(A_REGRA)).toEqual([
      'alterou o status de em revisão para na fila',
      'alterou a lista de Sabor Doce para ATENDIMENTO',
      'removeu o responsável: Caio Moraes',
      'adicionou o responsável: Carla',
    ]);
  });

  it('a troca que só mexe em responsável não inventa mudança de lista nem de etapa', () => {
    expect(
      frasesDoEvento({
        ...A_MAO,
        fromListName: null,
        toListName: null,
        fromStatusName: null,
        toStatusName: null,
        removed: ['Murilo Siqueira'],
        added: ['Carla', 'Nara'],
      }),
    ).toEqual(['removeu o responsável: Murilo Siqueira', 'adicionou os responsáveis: Carla, Nara']);
  });

  it('vários que saem cabem numa linha só, e todos com nome', () => {
    expect(frasesDoEvento({ ...A_MAO, removed: ['Murilo Siqueira', 'Helena'] })[2]).toBe(
      'removeu os responsáveis: Murilo Siqueira, Helena',
    );
  });

  it('⚠️ O NOME APAGADO AINDA TEM NOME — é o retrato que o servidor devolveu', () => {
    // As quatro chaves de lista e de etapa são `on delete set null`: apagar a
    // etapa da esteira levaria o id, e o histórico decairia para "de — para —".
    // A F17.65 guarda o retrato ao ESCREVER, e o servidor o usa como paraquedas
    // quando a junção não devolve nada. Aqui o nome já chega resolvido.
    expect(
      frasesDoEvento({ ...A_MAO, fromStatusName: 'Aprovação', toStatusName: 'Etapa que sumiu' })[0],
    ).toBe('alterou o status de Aprovação para Etapa que sumiu');
  });

  it('nome que NÃO veio não vira travessão — a linha some em vez de mentir', () => {
    // É o caso do evento velho, gravado antes de existir retrato, cuja lista foi
    // apagada depois. "alterou a lista de — para —" é pior do que não dizer.
    expect(
      frasesDoEvento({ ...A_MAO, fromListName: null, toListName: null }),
    ).toEqual([
      'alterou o status de Aprovação para Enviar Fotos Ao Cliente',
      'removeu o responsável: Murilo Siqueira',
    ]);
  });

  it('mudança que não mudou nada não vira linha', () => {
    expect(
      frasesDoEvento({
        ...A_MAO,
        fromListName: 'ESTÚDIO',
        toListName: 'ESTÚDIO',
        fromStatusName: 'Aprovação',
        toStatusName: 'Aprovação',
        removed: [],
        added: [],
      }),
    ).toEqual([]);
  });

  it('só o destino conhecido diz para ONDE, sem fingir que sabe de onde', () => {
    expect(
      frasesDoEvento({ ...A_MAO, fromListName: null, fromStatusName: null, removed: [] }),
    ).toEqual(['pôs o status em Enviar Fotos Ao Cliente', 'moveu para a lista ESTÚDIO']);
  });
});

/* ─────────────────────────── a linha do tempo ─────────────────────────── */

describe('a frase do cliente — F38, fase 7', () => {
  const base: EventoDaTarefa = {
    id: '50',
    automationName: null,
    actorName: 'Carla',
    fromListName: null,
    toListName: null,
    fromStatusName: null,
    toStatusName: null,
    removed: [],
    added: [],
    occurredAt: '2026-10-07T12:00:00.000Z',
  };

  it('trocou de um cliente para outro', () => {
    expect(frasesDoEvento({ ...base, fromClientName: 'Fonseca Moura', toClientName: 'Hiper Center' })).toEqual([
      'trocou o cliente de Fonseca Moura para Hiper Center',
    ]);
  });

  it('antes sem cliente: definiu; depois sem cliente: tirou', () => {
    expect(frasesDoEvento({ ...base, fromClientName: null, toClientName: 'Hiper Center' })).toEqual(['definiu o cliente Hiper Center']);
    expect(frasesDoEvento({ ...base, fromClientName: 'Hiper Center', toClientName: null })).toEqual(['tirou o cliente Hiper Center']);
  });

  it('evento que não mexe no cliente (ficha antiga, campos ausentes ou nulos) não ganha frase de cliente', () => {
    expect(frasesDoEvento({ ...base, removed: ['Ana'] })).toEqual(['removeu o responsável: Ana']);
    expect(frasesDoEvento({ ...base, fromClientName: null, toClientName: null, removed: ['Ana'] })).toEqual(['removeu o responsável: Ana']);
  });

  it('mesmo nome dos dois lados não vira linha, e a ordem é status, lista, cliente, responsáveis', () => {
    expect(frasesDoEvento({ ...base, fromClientName: 'X', toClientName: 'X' })).toEqual([]);
    expect(
      frasesDoEvento({
        ...base,
        fromStatusName: 'a',
        toStatusName: 'b',
        fromClientName: 'X',
        toClientName: 'Y',
        added: ['Ana'],
      }),
    ).toEqual(['alterou o status de a para b', 'trocou o cliente de X para Y', 'adicionou o responsável: Ana']);
  });

  it('a troca de cliente vira degrau da linha do tempo, com o sujeito', () => {
    const itens = montarHistorico({
      criadaPor: null,
      criadaEm: '2026-10-01T00:00:00.000Z',
      eventos: [{ ...base, fromClientName: 'X', toClientName: 'Y' }],
      falas: [],
    });
    expect(itens).toMatchObject([{ tipo: 'evento', quem: 'Carla', frases: ['trocou o cliente de X para Y'] }]);
  });
});

describe('a linha do tempo mistura as duas fontes', () => {
  it('⚠️ OS COMENTÁRIOS ENTRAM NO MEIO, em ordem de instante', () => {
    // É o pedido: *"e os comentários no meio, na mesma linha do tempo — é isso
    // que torna a coluna legível"*.
    const linha = montarHistorico({
      criadaPor: 'Nara',
      criadaEm: '2026-09-01T09:00:00.000Z',
      eventos: [{ ...A_MAO, occurredAt: '2026-09-02T09:00:00.000Z' }],
      falas: [fala('c1', '2026-09-01T18:00:00.000Z'), fala('c2', '2026-09-03T08:00:00.000Z')],
    });
    expect(linha.map((i) => `${i.tipo}:${i.chave}`)).toEqual([
      'criacao:criacao',
      'comentario:cc1',
      'evento:e31',
      'comentario:cc2',
    ]);
  });

  it('do mais ANTIGO para o mais recente — o campo de escrever fica no pé', () => {
    const linha = montarHistorico({
      criadaPor: null,
      criadaEm: '2026-09-01T09:00:00.000Z',
      eventos: [
        { ...A_MAO, id: '90', occurredAt: '2026-09-03T10:00:00.000Z' },
        { ...A_MAO, id: '80', occurredAt: '2026-09-02T10:00:00.000Z' },
      ],
      falas: [],
    });
    expect(linha.map((i) => i.chave)).toEqual(['e80', 'e90']);
  });

  it('⚠️ AS DUAS LINHAS DA MESMA TRANSAÇÃO SAEM NA ORDEM DO BANCO', () => {
    // `move_task` grava DUAS linhas quando a regra dispara: a da mão e a da
    // regra. `occurred_at` é o instante da TRANSAÇÃO e é o MESMO nas duas — só
    // a identidade crescente as desempata. Sem isso a ordem seria aleatória, e
    // a tela mostraria a reação antes do gesto.
    const linha = montarHistorico({
      criadaPor: null,
      criadaEm: '2026-09-01T09:00:00.000Z',
      eventos: [A_MAO, A_REGRA],
      falas: [],
    });
    expect(linha.map((i) => i.chave)).toEqual(['e30', 'e31']);
  });

  it('a chave desempata por NÚMERO, e não por texto', () => {
    // `e100` depois de `e30`. Comparação de texto poria `e100` antes.
    const linha = montarHistorico({
      criadaPor: null,
      criadaEm: '2026-09-01T09:00:00.000Z',
      eventos: [
        { ...A_MAO, id: '100' },
        { ...A_MAO, id: '30' },
      ],
      falas: [],
    });
    expect(linha.map((i) => i.chave)).toEqual(['e30', 'e100']);
  });
});

describe('⚠️ o passado não se fabrica', () => {
  it('SEM AUTOR não há linha de criação — 1.758 das 1.829 tarefas vieram do ClickUp', () => {
    // `created_at` delas é o instante da IMPORTAÇÃO, não o da criação. Escrever
    // "criada em 21/08" numa tarefa de abril seria inventar passado com cara de
    // fato.
    const linha = montarHistorico({
      criadaPor: null,
      criadaEm: '2026-08-21T17:50:11.951Z',
      eventos: [],
      falas: [],
    });
    expect(linha).toEqual([]);
  });

  it('COM AUTOR a linha existe, e é lida de `tasks` — não é evento gravado', () => {
    const linha = montarHistorico({
      criadaPor: 'Nara',
      criadaEm: '2026-09-01T09:00:00.000Z',
      eventos: [],
      falas: [],
    });
    expect(linha).toEqual([
      { tipo: 'criacao', chave: 'criacao', quem: 'Nara', quando: '2026-09-01T09:00:00.000Z' },
    ]);
  });

  it('tarefa sem histórico nenhum devolve lista vazia — e não um degrau em branco', () => {
    expect(
      montarHistorico({ criadaPor: null, criadaEm: '2026-08-21T17:50:11.951Z', eventos: [], falas: [] }),
    ).toHaveLength(0);
  });

  it('evento sem frase legível não vira degrau mudo', () => {
    const linha = montarHistorico({
      criadaPor: null,
      criadaEm: '2026-09-01T09:00:00.000Z',
      eventos: [
        {
          ...A_MAO,
          fromListName: null,
          toListName: null,
          fromStatusName: null,
          toStatusName: null,
          removed: [],
          added: [],
        },
      ],
      falas: [],
    });
    expect(linha).toEqual([]);
  });
});
