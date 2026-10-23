/**
 * A MOVIMENTAÇÃO APARECE NA TAREFA — F17.65.
 *
 * POR QUE ESTE TESTE EXISTE
 *   `historico.test.ts` prova a frase e a ordem; `scripts/provar-o-historico.mjs`
 *   prova que o banco grava e recusa. Este prova o que sobra e é o que a pessoa
 *   vê: que a linha desenha NOMES e não identificadores, que ela diz QUANDO, e
 *   que uma mudança feita por regra não se disfarça de pessoa.
 *
 * ESCRITO EM `createElement`, E NÃO EM JSX
 *   A suíte só inclui `*.test.ts`. Um `.tsx` não seria executado, e teste que
 *   não roda é pior que teste nenhum: ele conta como cobertura.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { EventoDaTarefa } from '@/board/historico';
import { montarHistorico } from '@/board/historico';
import { MovimentacaoDaTarefa } from '@/board/MovimentacaoDaTarefa';

const A_MAO: EventoDaTarefa = {
  id: '904121',
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

/** Desenha o primeiro (e único) degrau que a entrada produz. */
const desenhar = (evento: EventoDaTarefa | null, criadaPor: string | null = null) => {
  const [item] = montarHistorico({
    criadaPor,
    criadaEm: '2026-09-01T09:00:00.000Z',
    eventos: evento === null ? [] : [evento],
    falas: [],
  });
  if (item === undefined || item.tipo === 'comentario') return '';
  return renderToStaticMarkup(createElement(MovimentacaoDaTarefa, { item }));
};

describe('a linha da movimentação na ficha da tarefa', () => {
  it('diz o que a captura do usuário mostra, com o nome de quem fez', () => {
    const html = desenhar(A_MAO);
    expect(html).toContain('Helena');
    expect(html).toContain('alterou o status de Aprovação para Enviar Fotos Ao Cliente');
    expect(html).toContain('alterou a lista de Estúdio Ide para ESTÚDIO');
    expect(html).toContain('removeu o responsável: Murilo Siqueira');
  });

  it('⚠️ NOMES, E NÃO IDENTIFICADORES — nem o do próprio evento aparece', () => {
    // O identificador da linha é chave de banco, e a tela não nomeia banco (o
    // teste de varredura cobra o mesmo em todo `.tsx`).
    expect(desenhar(A_MAO)).not.toContain(A_MAO.id);
  });

  it('e diz QUANDO — movimentação sem instante não explica nada', () => {
    const html = desenhar(A_MAO);
    expect(html).toContain('tnum');
    expect(html).toContain('03/09/2026');
  });

  it('⚠️ A REGRA NÃO SE DISFARÇA DE PESSOA', () => {
    // Sem o selo, `Passa para o atendimento` se lê como o nome de alguém que
    // ninguém conhece — e a linha passa a confundir em vez de explicar.
    const html = desenhar({ ...A_MAO, automationName: 'Passa para o atendimento' });
    expect(html).toContain('Passa para o atendimento');
    expect(html).toContain('automação');
    expect(html).toContain('data-automatica="true"');
  });

  it('F42.7 — o card que o CLIENTE moveu pelo link: "Aprovação do cliente" é o autor, sem pessoa da equipe', () => {
    // `decide_approval_round` grava `automation_name = 'Aprovação do cliente'`
    // e `actor_id` nulo (a rota pública não tem ator): `actorName` chega nulo.
    const html = desenhar({
      ...A_MAO,
      automationName: 'Aprovação do cliente',
      actorName: null,
      fromListName: null,
      toListName: null,
      fromStatusName: 'aguardando cliente',
      toStatusName: 'refação',
      removed: [],
    });
    expect(html).toContain('<span class="c-autor">Aprovação do cliente</span>');
    expect(html).toContain('automação');
    expect(html).toContain('alterou o status de aguardando cliente para refação');
    expect(html).not.toContain('Alguém');
  });

  it('a mudança feita à mão NÃO leva o selo de automação', () => {
    const html = desenhar(A_MAO);
    expect(html).not.toContain('automação');
    expect(html).toContain('data-automatica="false"');
  });

  it('`criou esta tarefa` é uma linha da mesma família, com o nome de quem criou', () => {
    const html = desenhar(null, 'Nara');
    expect(html).toContain('Nara');
    expect(html).toContain('criou esta tarefa');
  });

  it('⚠️ TAREFA SEM HISTÓRICO NÃO DESENHA NADA — nem uma caixa vazia', () => {
    // 1.758 das 1.829 tarefas não têm autor nem evento. Um bloco dizendo "sem
    // histórico" apareceria em 96% das fichas, e a tela não fala sobre si mesma
    // (F17.37).
    expect(desenhar(null, null)).toBe('');
  });

  it('instante ilegível some sozinho, e a frase continua legível', () => {
    // Existe tarefa com prazo no ano 82025 neste banco. A linha não pode
    // desaparecer nem escrever `Invalid Date` por causa de um relógio torto.
    const html = desenhar({ ...A_MAO, occurredAt: 'nao é data' });
    expect(html).toContain('alterou o status de Aprovação para Enviar Fotos Ao Cliente');
    expect(html).not.toContain('Invalid');
    expect(html).not.toContain('NaN');
  });
});
