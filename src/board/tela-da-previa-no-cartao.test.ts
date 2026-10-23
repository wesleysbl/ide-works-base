/**
 * A PRÉVIA APARECE NO CARTÃO — e só a nossa. F17.56.
 *
 * POR QUE ESTE ARQUIVO EXISTE, TENDO `miniaturas.test.ts`
 *   Aquele prova a DECISÃO — o que pedir, quando um endereço vence. Este prova
 *   o DESENHO: que o `<img>` sai, que ele sai com os atributos que a etapa
 *   depende, e — o que mais importa — que ele NÃO sai quando não deve.
 *
 * ⚠️ A ASSERÇÃO CENTRAL É UMA NEGATIVA, E ELA É DO USUÁRIO
 *   O cabeçalho de `board/previa-de-link.ts` explica por quê: um `<img src>`
 *   para hospedeiro desconhecido conta ÀQUELE hospedeiro que alguém abriu a
 *   tarefa. A F17.22 abriu uma porta — os hospedeiros que o dono declarou
 *   seus — e o resto continua fechado.
 *
 *   Esta etapa não podia reabrir o furo pelo cartão. A prova é dupla:
 *
 *     · o cartão de uma tarefa SEM anexo não tem `<img>` nenhum, nem `src` de
 *       lugar nenhum — mesmo que o quadro venha cheio de link;
 *     · o único `src` que o cartão desenha é o que o BALCÃO entregou, e o
 *       balcão só se enche pela rota assinada do nosso servidor. O cartão não
 *       tem caminho de código que leia endereço de dado.
 *
 * SEM NAVEGADOR, E POR ISSO SEM `useEffect`
 *   A suíte roda em `node` e `renderToStaticMarkup` não roda efeito. É por isso
 *   que existe `MiniaturasDeMentira`: ela entrega o mapa já pronto, e o que se
 *   prova aqui é o desenho a partir dele. O caminho de rede inteiro —
 *   navegador → Worker → política → Storage — é
 *   `scripts/provar-a-previa-no-cartao.mjs`.
 *
 * ESCRITO EM `createElement`, E NÃO EM JSX
 *   A suíte só inclui `*.test.ts`. Um `.tsx` não seria executado, e teste que
 *   não roda é pior que teste nenhum porque conta como cobertura.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { type BoardTask, type Day } from '@/board/board';
import { CorpoDoCartao } from '@/board/CartaoDeTarefa';
import { MiniaturasDeMentira } from '@/board/MiniaturaDoCartao';
import { type Assinaturas } from '@/board/miniaturas';

const HOJE: Day = { year: 2026, month: 9, day: 2 };

const ANEXO = 'aaaa0004-0000-4000-8000-000000000001';
const ASSINADO =
  'https://exemplo.supabase.co/storage/v1/object/sign/ideworks-anexos/x/y.png' +
  '?token=abc&download=arte.png';

const tarefa = (p: Partial<BoardTask> = {}): BoardTask => ({
  id: 'a1',
  title: '[A] SABOR DOCE - ARTE EMBALAGEM',
  statusId: 's1',
  priority: null,
  dueOn: null,
  startOn: null,
  completedAt: null,
  hasDescription: false,
  hasAttachment: false,
  clientId: null,
  clientName: null,
  assignees: [],
  tags: [],
  taskTypeName: null,
  parentId: null,
  parentTitle: null,
  subtaskCount: 0,
  checklistDone: 0,
  checklistTotal: 0,
  commentCount: 0,
  previewAttachmentId: null,
  previewCount: 0,
  ...p,
});

function desenhar(t: BoardTask, assinaturas: Assinaturas = {}): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(
        MiniaturasDeMentira,
        { assinaturas },
        createElement(CorpoDoCartao, { tarefa: t, hoje: HOJE }),
      ),
    ),
  );
}

describe('a arte aparece no cartão', () => {
  it('com anexo de imagem e endereço na mão, o cartão desenha a arte', () => {
    const html = desenhar(tarefa({ hasAttachment: true, previewAttachmentId: ANEXO, previewCount: 1 }), {
      [ANEXO]: { url: ASSINADO, expiresAt: '2026-09-02T12:05:00.000Z' },
    });
    expect(html).toContain('q-miniatura');
    expect(html).toContain(`src="${ASSINADO.replace(/&/g, '&amp;')}"`);
  });

  it('o texto alternativo diz de QUE tarefa é a arte', () => {
    const html = desenhar(tarefa({ previewAttachmentId: ANEXO, previewCount: 1 }), {
      [ANEXO]: { url: ASSINADO, expiresAt: '2026-09-02T12:05:00.000Z' },
    });
    expect(html).toContain('alt="Arte de [A] SABOR DOCE - ARTE EMBALAGEM"');
  });

  it('⚠️ a arte NÃO arrasta — senão puxar o cartão pela imagem largaria a imagem (F17.25)', () => {
    const html = desenhar(tarefa({ previewAttachmentId: ANEXO, previewCount: 1 }), {
      [ANEXO]: { url: ASSINADO, expiresAt: '2026-09-02T12:05:00.000Z' },
    });
    expect(html).toMatch(/<img[^>]*draggable="false"/);
  });

  it('a arte espera a vez para carregar — a coluna rola com cinquenta (F17.27)', () => {
    const html = desenhar(tarefa({ previewAttachmentId: ANEXO, previewCount: 1 }), {
      [ANEXO]: { url: ASSINADO, expiresAt: '2026-09-02T12:05:00.000Z' },
    });
    expect(html).toMatch(/<img[^>]*loading="lazy"/);
  });

  it('com QUATRO artes, o cartão mostra uma e diz quantas faltam', () => {
    const html = desenhar(tarefa({ previewAttachmentId: ANEXO, previewCount: 4 }), {
      [ANEXO]: { url: ASSINADO, expiresAt: '2026-09-02T12:05:00.000Z' },
    });
    // `+3`, e não `4`: o número que interessa é o que NÃO está à vista.
    expect(html).toContain('+3');
    expect((html.match(/<img/g) ?? []).length).toBe(1);
  });

  it('com UMA arte, não há contador — `+0` seria ruído', () => {
    const html = desenhar(tarefa({ previewAttachmentId: ANEXO, previewCount: 1 }), {
      [ANEXO]: { url: ASSINADO, expiresAt: '2026-09-02T12:05:00.000Z' },
    });
    expect(html).not.toContain('q-miniatura-mais');
  });
});

describe('⚠️ o cartão SEM arte não ganha nada — nem espaço, nem elemento', () => {
  it('tarefa sem anexo nenhum não desenha `<img>` nem a caixa da miniatura', () => {
    const html = desenhar(tarefa());
    expect(html).not.toContain('<img');
    expect(html).not.toContain('q-miniatura');
  });

  it('tarefa COM anexo que não é imagem fica só com o clipe de papel', () => {
    /* `previewAttachmentId` nulo é exatamente o que o banco devolve para uma
       tarefa cujo único anexo é `.ai` ou `.psd` — o `like 'image/%'` da
       consulta não casa. O clipe continua; a arte, não. */
    const html = desenhar(tarefa({ hasAttachment: true }));
    expect(html).not.toContain('<img');
    expect(html).not.toContain('q-miniatura');
  });

  it('⚠️ enquanto o endereço não chega, o cartão não reserva espaço', () => {
    /* Este é o caso do primeiro quadro: o quadro já veio, o lote de assinaturas
       ainda não. Um esqueleto cinza aqui faria a coluna inteira PULAR quando as
       artes chegassem — e faria os 1.781 cartões sem arte pagarem altura pela
       arte que 16 têm. */
    const html = desenhar(tarefa({ hasAttachment: true, previewAttachmentId: ANEXO, previewCount: 2 }));
    expect(html).not.toContain('<img');
    expect(html).not.toContain('q-miniatura');
  });

  it('cartão fora de qualquer provedor desenha como antes desta etapa', () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(CorpoDoCartao, {
          tarefa: tarefa({ previewAttachmentId: ANEXO, previewCount: 1 }),
          hoje: HOJE,
        }),
      ),
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('SABOR DOCE');
  });
});

describe('⚠️ o furo da prévia de link continua fechado', () => {
  /*
    A REGRA, EM UMA FRASE: anexo NOSSO aparece sempre; link EXTERNO só de
    hospedeiro na lista do dono, e o cartão não desenha link nenhum.

    A prova é de SUPERFÍCIE, e é a única que vale: o cartão não tem por onde
    receber um endereço externo. `BoardTask` não carrega link, `CorpoDoCartao`
    não importa `previa-de-link`, e o único `src` que ele escreve vem do balcão
    — que só se enche pela rota assinada. Um `<img>` para terceiro precisaria de
    uma mudança DELIBERADA em pelo menos três arquivos, e ela esbarraria neste
    teste.
  */
  it('o cartão não conhece link nenhum: nenhum `src` fora do balcão', () => {
    const html = desenhar(
      tarefa({
        hasAttachment: true,
        commentCount: 3,
        previewAttachmentId: ANEXO,
        previewCount: 1,
      }),
      { [ANEXO]: { url: ASSINADO, expiresAt: '2026-09-02T12:05:00.000Z' } },
    );

    const fontes = [...html.matchAll(/src="([^"]*)"/g)].map((m) => m[1]);
    expect(fontes.length).toBe(1);
    // O único endereço desenhado é o assinado do NOSSO balde, e ele traz o
    // `token` que o Storage exige — ou seja, não é endereço permanente.
    expect(fontes[0]).toContain('/storage/v1/object/sign/ideworks-anexos/');
    expect(fontes[0]).toContain('token=');
  });

  it('o cartão não desenha `<img>` para hospedeiro que o dono não declarou seu', () => {
    /* Um endereço de terceiro dentro do TÍTULO da tarefa — que é o único texto
       livre que o cartão desenha — continua sendo texto. Nada nele vira `src`. */
    const html = desenhar(
      tarefa({ title: 'Ver https://tracker.exemplo-desconhecido.com/pixel.png agora' }),
    );
    expect(html).not.toContain('<img');
    expect(html).not.toContain('tracker.exemplo-desconhecido.com/pixel.png"');
  });
});
