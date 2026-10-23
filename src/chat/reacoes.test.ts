/**
 * A lógica das reações do chat — F24.3.
 *
 * Aqui só a parte pura: agrupar, alternar otimista e aplicar o evento ao vivo.
 * O desenho está guardado em `tela-do-chat.test.ts`, que monta no servidor.
 */

import { describe, expect, it } from 'vitest';

import { CHAT_REACTION_EMOJIS } from '@/server/chat';
import {
  EMOJIS_DE_REACAO,
  agruparPorMensagem,
  agruparReacoes,
  alternarReacaoLocal,
  apenasDasMensagens,
  chaveDaReacao,
  definirReacao,
  desfazerPalpite,
  fundirMudancas,
  relogioDaReposicao,
  minhaReacao,
  rotuloDaReacao,
  saiuDoToqueLongo,
  TOLERANCIA_DO_TOQUE_PX,
  type ReacaoNaTela,
} from '@/chat/reacoes';

const r = (
  messageId: string,
  actorId: string,
  emoji: string,
  reactedAt = '2026-09-22T12:00:00.000Z',
): ReacaoNaTela => ({ messageId, actorId, emoji, reactedAt });

describe('a lista dos seis emojis', () => {
  it('é a mesma do servidor, item a item', () => {
    expect([...EMOJIS_DE_REACAO]).toEqual([...CHAT_REACTION_EMOJIS]);
  });
});

describe('agregação por emoji', () => {
  it('conta por emoji e marca a minha', () => {
    const grupos = agruparReacoes(
      [
        r('m1', 'u1', '👍', '2026-09-22T12:00:00.000Z'),
        r('m1', 'u2', '👍', '2026-09-22T12:00:01.000Z'),
        r('m1', 'u3', '🙏', '2026-09-22T12:00:02.000Z'),
      ],
      'm1',
      'u2',
    );
    expect(grupos).toEqual([
      { emoji: '👍', contagem: 2, minha: true },
      { emoji: '🙏', contagem: 1, minha: false },
    ]);
  });

  it('guarda a ordem de chegada do primeiro de cada emoji', () => {
    const grupos = agruparReacoes(
      [
        r('m1', 'u3', '🙏', '2026-09-22T12:00:05.000Z'),
        r('m1', 'u1', '👍', '2026-09-22T12:00:01.000Z'),
      ],
      'm1',
      null,
    );
    expect(grupos.map((g) => g.emoji)).toEqual(['👍', '🙏']);
  });

  it('separa por mensagem e devolve vazio para quem não tem reação', () => {
    const mapa = agruparPorMensagem([r('m1', 'u1', '👍'), r('m2', 'u1', '😂')], 'u1');
    expect(mapa.get('m1')).toEqual([{ emoji: '👍', contagem: 1, minha: true }]);
    expect(mapa.get('m2')).toEqual([{ emoji: '😂', contagem: 1, minha: true }]);
    expect(agruparReacoes([], 'm3', 'u1')).toEqual([]);
  });

  it('sem sessão nenhuma reação é minha', () => {
    expect(agruparReacoes([r('m1', 'u1', '👍')], 'm1', null)).toEqual([
      { emoji: '👍', contagem: 1, minha: false },
    ]);
  });
});

describe('alternância otimista', () => {
  it('o mesmo emoji remove a minha', () => {
    const antes = [r('m1', 'u1', '👍'), r('m1', 'u2', '👍')];
    const depois = alternarReacaoLocal(antes, {
      messageId: 'm1',
      actorId: 'u1',
      emoji: '👍',
      reactedAt: '2026-09-22T13:00:00.000Z',
    });
    expect(depois.removida).toBe(true);
    expect(depois.lista).toEqual([r('m1', 'u2', '👍')]);
  });

  it('outro emoji troca, e continua uma por pessoa', () => {
    const depois = alternarReacaoLocal([r('m1', 'u1', '👍')], {
      messageId: 'm1',
      actorId: 'u1',
      emoji: '❤️',
      reactedAt: '2026-09-22T13:00:00.000Z',
    });
    expect(depois.removida).toBe(false);
    expect(depois.lista).toHaveLength(1);
    expect(minhaReacao(depois.lista, 'm1', 'u1')).toBe('❤️');
  });

  it('a recusa volta ao estado anterior sem sobra', () => {
    const antes: ReacaoNaTela[] = [r('m1', 'u2', '😂')];
    const palpite = alternarReacaoLocal(antes, {
      messageId: 'm1',
      actorId: 'u1',
      emoji: '👍',
      reactedAt: '2026-09-22T13:00:00.000Z',
    });
    expect(palpite.lista).toHaveLength(2);
    // A tela guarda `antes` e devolve tal e qual quando a API recusa.
    expect(antes).toEqual([r('m1', 'u2', '😂')]);
  });

  it('não toca na reação de outra mensagem nem na de outra pessoa', () => {
    const depois = definirReacao(
      [r('m1', 'u2', '👍'), r('m2', 'u1', '🙏')],
      { messageId: 'm1', actorId: 'u1', emoji: '😢', reactedAt: '2026-09-22T13:00:00.000Z' },
    );
    expect(depois).toHaveLength(3);
    expect(minhaReacao(depois, 'm2', 'u1')).toBe('🙏');
  });
});

describe('o evento ao vivo', () => {
  it('a remoção some com a reação da pessoa', () => {
    const depois = definirReacao([r('m1', 'u2', '👍')], {
      messageId: 'm1',
      actorId: 'u2',
      emoji: null,
      reactedAt: '2026-09-22T13:00:00.000Z',
    });
    expect(depois).toEqual([]);
  });

  it('a chegada substitui a reação anterior da mesma pessoa', () => {
    const depois = definirReacao([r('m1', 'u2', '👍')], {
      messageId: 'm1',
      actorId: 'u2',
      emoji: '😮',
      reactedAt: '2026-09-22T13:00:00.000Z',
    });
    expect(depois).toEqual([r('m1', 'u2', '😮', '2026-09-22T13:00:00.000Z')]);
  });
});

describe('rótulo e poda', () => {
  it('diz emoji, contagem e se sou eu', () => {
    expect(rotuloDaReacao({ emoji: '👍', contagem: 1, minha: false })).toBe(
      '👍, 1 pessoa — tocar reage também',
    );
    expect(rotuloDaReacao({ emoji: '👍', contagem: 3, minha: true })).toBe(
      '👍, 3 pessoas, incluindo você — tocar remove a sua',
    );
  });

  it('guarda só as reações das mensagens na tela', () => {
    expect(apenasDasMensagens([r('m1', 'u1', '👍'), r('m9', 'u1', '👍')], ['m1'])).toEqual([
      r('m1', 'u1', '👍'),
    ]);
  });
});

describe('tolerância do toque longo', () => {
  const zero = { x: 100, y: 200 };

  it('o tremor do dedo não cancela', () => {
    expect(saiuDoToqueLongo(zero, { x: 103, y: 204 })).toBe(false);
    expect(saiuDoToqueLongo(zero, zero)).toBe(false);
  });

  it('exatamente na tolerância ainda vale — passou dela, cancela', () => {
    expect(saiuDoToqueLongo(zero, { x: 100 + TOLERANCIA_DO_TOQUE_PX, y: 200 })).toBe(false);
    expect(saiuDoToqueLongo(zero, { x: 100 + TOLERANCIA_DO_TOQUE_PX + 1, y: 200 })).toBe(true);
  });

  it('rolar o fio (movimento vertical) cancela', () => {
    expect(saiuDoToqueLongo(zero, { x: 100, y: 260 })).toBe(true);
  });

  it('mede na diagonal, não por eixo', () => {
    // 8px em cada eixo dá 11,3px de distância: passa da tolerância de 10.
    expect(saiuDoToqueLongo(zero, { x: 108, y: 208 })).toBe(true);
  });

  it('sem origem guardada, cancela', () => {
    expect(saiuDoToqueLongo(null, zero)).toBe(true);
  });

  it('a tolerância é 10px', () => {
    expect(TOLERANCIA_DO_TOQUE_PX).toBe(10);
  });
});

describe('fusão da reposição depois de ficar offline', () => {
  const mudanca = (
    messageId: string,
    actorId: string,
    emoji: string,
    reactedAt: string,
    removed = false,
  ) => ({ messageId, actorId, emoji, reactedAt, removed });

  it('traz o que apareceu e apaga o que foi removido', () => {
    const depois = fundirMudancas(
      [r('m1', 'u1', '👍', '2026-09-22T12:00:00.000Z')],
      [
        mudanca('m1', 'u1', '👍', '2026-09-22T12:05:00.000Z', true),
        mudanca('m2', 'u2', '🙏', '2026-09-22T12:06:00.000Z'),
      ],
    );
    expect(depois).toEqual([r('m2', 'u2', '🙏', '2026-09-22T12:06:00.000Z')]);
  });

  it('não pisa no palpite em voo, mas aceita o de outra pessoa', () => {
    const emVoo = new Set([chaveDaReacao('m1', 'u1')]);
    const depois = fundirMudancas(
      [r('m1', 'u1', '❤️', '2026-09-22T12:10:00.000Z')],
      [
        // Leitura antiga do servidor: diria que eu não tenho reação nenhuma.
        mudanca('m1', 'u1', '👍', '2026-09-22T12:09:00.000Z', true),
        mudanca('m1', 'u2', '😂', '2026-09-22T12:09:30.000Z'),
      ],
      emVoo,
    );
    expect(minhaReacao(depois, 'm1', 'u1')).toBe('❤️');
    expect(minhaReacao(depois, 'm1', 'u2')).toBe('😂');
  });

  it('sem mudança nenhuma a lista sai igual', () => {
    const antes = [r('m1', 'u1', '👍')];
    expect(fundirMudancas(antes, [])).toEqual(antes);
  });

  it('a troca de emoji de uma pessoa continua sendo uma linha só', () => {
    const depois = fundirMudancas(
      [r('m1', 'u2', '👍', '2026-09-22T12:00:00.000Z')],
      [mudanca('m1', 'u2', '😮', '2026-09-22T12:01:00.000Z')],
    );
    expect(depois).toEqual([r('m1', 'u2', '😮', '2026-09-22T12:01:00.000Z')]);
  });

  it('o relógio anda até a mudança mais nova, inclusive a que foi pulada', () => {
    expect(
      relogioDaReposicao('2026-09-22T12:00:00.000Z', [
        mudanca('m1', 'u1', '👍', '2026-09-22T12:03:00.000Z'),
        mudanca('m1', 'u2', '🙏', '2026-09-22T12:02:00.000Z'),
      ]),
    ).toBe('2026-09-22T12:03:00.000Z');
    expect(relogioDaReposicao('2026-09-22T12:00:00.000Z', [])).toBe('2026-09-22T12:00:00.000Z');
  });

  it('a chave é por pessoa e por mensagem', () => {
    expect(chaveDaReacao('m1', 'u1')).not.toBe(chaveDaReacao('m1', 'u2'));
    expect(chaveDaReacao('m1', 'u1')).toBe(chaveDaReacao('m1', 'u1'));
  });
});

describe('a recusa desfaz só o meu palpite', () => {
  it('a reação que chegou de outra pessoa no meio do caminho fica', () => {
    const antes: ReacaoNaTela[] = [];
    const palpite = alternarReacaoLocal(antes, {
      messageId: 'm1',
      actorId: 'u1',
      emoji: '👍',
      reactedAt: '2026-09-22T13:00:00.000Z',
    }).lista;
    // Evento ao vivo de OUTRA pessoa chega enquanto a API não respondeu.
    const comOutra = definirReacao(palpite, {
      messageId: 'm1',
      actorId: 'u2',
      emoji: '🙏',
      reactedAt: '2026-09-22T13:00:01.000Z',
    });
    const depoisDaRecusa = desfazerPalpite(comOutra, {
      messageId: 'm1',
      actorId: 'u1',
      emoji: null,
      reactedAt: '2026-09-22T13:00:00.000Z',
    });
    expect(minhaReacao(depoisDaRecusa, 'm1', 'u1')).toBe(null);
    expect(minhaReacao(depoisDaRecusa, 'm1', 'u2')).toBe('🙏');
  });

  it('quem já tinha um emoji volta para ele, não para o nada', () => {
    const depois = desfazerPalpite([r('m1', 'u1', '❤️', '2026-09-22T13:00:05.000Z')], {
      messageId: 'm1',
      actorId: 'u1',
      emoji: '👍',
      reactedAt: '2026-09-22T12:00:00.000Z',
    });
    expect(depois).toEqual([r('m1', 'u1', '👍', '2026-09-22T12:00:00.000Z')]);
  });
});
