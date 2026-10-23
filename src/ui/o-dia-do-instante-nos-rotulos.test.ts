/**
 * O DIA QUE O RÓTULO ESCREVE É O DE SÃO PAULO — revisão de 09/10/2026.
 *
 * O QUE ESCAPAVA
 *   O Planejamento, o Painel e o MCP já contavam o dia de um instante em São
 *   Paulo (`diaDoInstante`). Mas os rótulos de data de várias telas ainda
 *   cortavam o instante por posição — `criadoEm.slice(0, 10)` é o dia em UTC, e
 *   às 21h de Brasília o dia UTC já é o seguinte. Uma conexão revogada às 22h
 *   do dia 20 dizia "revogada em 21/09"; um convite feito à noite dizia
 *   "convidado em" amanhã; uma demanda concluída às 23h dizia o dia seguinte.
 *
 *   O defeito que o usuário VÊ com mais facilidade é o do Histórico do
 *   cliente: o "registrado em …" só deve aparecer quando o registro foi feito
 *   num dia diferente do que ele conta. Comparando o dia UTC de `createdAt` com
 *   `happenedOn`, todo registro feito entre 21h e 23h59 do próprio dia ganhava
 *   um "registrado em" de amanhã, sem ter nada a avisar.
 *
 *   Este arquivo prova os rótulos que têm peça para desenhar. As telas que só
 *   se desenham no navegador (Checklist, Conexões, Pessoas) têm o cenário em
 *   `scripts/e2e`, e a trava que impede o corte por posição é a de
 *   `test/o-dia-da-peca-e-o-de-sao-paulo.test.ts`.
 *
 * ESCRITO EM `createElement`, E NÃO EM JSX — a suíte só inclui `*.test.ts`.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LinhaDaExecucao } from '@/board/PecasDaConexao';
import { feitoAteAgora } from '@/board/rotulos-da-conexao';
import { type Evento, RegistroDoHistorico } from '@/clients/Historico';
import { AbaConteudo } from '@/meta/PainelDoPerfil';
import type { Publicacao } from '@/meta/publicacoes';
import { dataCurtaDoInstante } from '@/ui/grade-do-mes';

/* ─────────────────────────── o rótulo em si ─────────────────────────── */

describe('dataCurtaDoInstante: DD/MM/AAAA no dia de São Paulo', () => {
  it('às 22h de Brasília (01h UTC do dia seguinte) é o dia de Brasília', () => {
    expect(dataCurtaDoInstante('2026-10-09T01:00:00.000Z')).toBe('08/10/2026');
  });

  it('no último dia do mês, o rótulo não pula para o mês seguinte', () => {
    expect(dataCurtaDoInstante('2026-11-01T01:30:00.000Z')).toBe('31/10/2026');
    expect(dataCurtaDoInstante('2027-01-01T02:59:00Z')).toBe('31/12/2026');
  });

  it('de manhã e à tarde o dia UTC e o de São Paulo coincidem', () => {
    expect(dataCurtaDoInstante('2026-10-09T12:00:00.000Z')).toBe('09/10/2026');
    expect(dataCurtaDoInstante('2026-10-09T03:00:00.000Z')).toBe('09/10/2026');
  });

  it('o deslocamento escrito no texto vale pelo instante', () => {
    expect(dataCurtaDoInstante('2026-10-08T22:30:00-03:00')).toBe('08/10/2026');
    expect(dataCurtaDoInstante('2026-10-09T01:30:00+00:00')).toBe('08/10/2026');
  });

  it('o que não se lê como dia volta como veio, sem estourar', () => {
    expect(dataCurtaDoInstante('banana')).toBe('banana');
    expect(dataCurtaDoInstante('')).toBe('');
  });
});

/* ──────────────────── o histórico do cliente ──────────────────── */

const REGISTRO: Evento = {
  id: 'h1',
  happenedOn: '2026-10-08',
  title: 'Reunião de alinhamento',
  subtitle: null,
  body: 'Decidimos dobrar os vídeos em outubro.',
  ledBy: null,
  ledByNote: null,
  createdAt: '2026-10-08T15:00:00.000Z',
  documents: [],
};

const registro = (e: Evento) =>
  renderToStaticMarkup(
    createElement(RegistroDoHistorico, {
      evento: e,
      abrindo: null,
      aoEditar: () => {},
      aoApagar: () => {},
      aoAbrirDocumento: () => {},
    }),
  );

describe('o "registrado em" do histórico só aparece quando as datas divergem — em São Paulo', () => {
  it('registrado à tarde no próprio dia: nada a avisar', () => {
    expect(registro(REGISTRO)).not.toContain('registrado em');
  });

  it('⚠️ registrado às 22h do próprio dia (01h UTC do seguinte): nada a avisar', () => {
    // 08/10 às 22h em Brasília = 09/10 às 01h em UTC. O registro conta o dia 08
    // e foi feito no dia 08: o "registrado em 09/10/2026" era falso e inútil.
    const html = registro({ ...REGISTRO, createdAt: '2026-10-09T01:00:00.000Z' });
    expect(html).not.toContain('registrado em');
  });

  it('⚠️ registrado às 23h59 do próprio dia, no último dia do mês: nada a avisar', () => {
    const html = registro({ ...REGISTRO, happenedOn: '2026-10-31', createdAt: '2026-11-01T02:59:00.000Z' });
    expect(html).not.toContain('registrado em');
  });

  it('registrado dias depois: avisa, com o dia de São Paulo', () => {
    const html = registro({ ...REGISTRO, createdAt: '2026-10-12T15:00:00.000Z' });
    expect(html).toContain('registrado em 12/10/2026');
  });

  it('⚠️ registrado à noite de outro dia: avisa o dia em que a pessoa registrou, e não o seguinte', () => {
    // Aconteceu em 08/10, registrado em 11/10 às 22h de Brasília (12/10 01h UTC).
    const html = registro({ ...REGISTRO, createdAt: '2026-10-12T01:00:00.000Z' });
    expect(html).toContain('registrado em 11/10/2026');
    expect(html).not.toContain('12/10/2026');
  });

  it('⚠️ registrado às 22h do dia anterior ao que conta: avisa (o dia UTC diria "iguais")', () => {
    // O registro conta o dia 09/10 mas foi feito em 08/10 às 22h (09/10 01h UTC).
    // Pelo dia UTC as datas pareciam iguais e o aviso sumia.
    const html = registro({ ...REGISTRO, happenedOn: '2026-10-09', createdAt: '2026-10-09T01:00:00.000Z' });
    expect(html).toContain('registrado em 08/10/2026');
  });
});

/* ─────────────────────── as conexões do agente ─────────────────────── */

describe('"a última em" e a data da execução são as de São Paulo', () => {
  it('a última escrita feita às 22h diz o dia de Brasília', () => {
    const texto = feitoAteAgora('g1', [
      { grantId: 'g1', operation: 'add_comment', occurredAt: '2026-10-09T01:00:00.000Z', undoneAt: null },
    ]);
    expect(texto).toContain('a última em 08/10/2026');
  });

  it('a linha do histórico de execuções diz o dia de Brasília', () => {
    const html = renderToStaticMarkup(
      createElement(LinhaDaExecucao, {
        execucao: {
          grantName: 'Claude do Wesley',
          operation: 'add_comment',
          origin: 'mcp',
          active: true,
          occurredAt: '2026-11-01T01:30:00.000Z',
          actedAs: null,
        },
      }),
    );
    expect(html).toContain('>31/10/2026<');
  });
});

/* ───────────────────── as publicações do Instagram ───────────────────── */

const PUBLICACAO: Publicacao = {
  id: 'p1',
  mediaId: 'm1',
  productType: 'FEED',
  mediaType: 'IMAGE',
  permalink: null,
  caption: 'Lançamento da coleção',
  thumbnailUrl: null,
  postedAt: '2026-10-09T01:30:00.000Z',
  reach: 100,
  views: null,
  likes: null,
  comments: null,
  shares: null,
  saved: null,
  totalInteractions: null,
  profileVisits: null,
  follows: null,
  replies: null,
  navigation: null,
};

describe('a data da publicação é o dia de São Paulo', () => {
  it('postada às 22h30 de Brasília (01h30 UTC do dia seguinte)', () => {
    const html = renderToStaticMarkup(createElement(AbaConteudo, { publicacoes: [PUBLICACAO] }));
    expect(html).toContain('>08/10/2026<');
    expect(html).not.toContain('09/10/2026');
  });
});
