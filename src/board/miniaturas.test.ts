/**
 * A MINIATURA DO CARTÃO — a decisão, provada sem tela e sem rede. F17.56.
 *
 * O QUE ESTE ARQUIVO PROVA, E POR QUE CADA COISA IMPORTA
 *
 *   1. ENDEREÇO PERTO DE VENCER JÁ CONTA COMO VENCIDO. É a margem de trinta
 *      segundos, e ela é a diferença entre "o quadro voltou com imagem
 *      quebrada" e "o quadro pediu de novo antes de precisar".
 *
 *   2. NÃO SE PEDE O QUE JÁ SE TEM. O quadro redesenha a cada tecla da busca;
 *      sem esta regra, cada tecla viraria um lote de cinquenta assinaturas.
 *
 *   3. O QUE FALHOU NÃO SE PEDE DE NOVO. É a trava do laço: um objeto que sumiu
 *      do balde faria `<img>` → `error` → pedido → `<img>` → `error`, para
 *      sempre.
 *
 *   4. O QUE SAIU DA TELA SAI DO MAPA. Quem passa a tarde trocando de lista não
 *      pode acumular uma assinatura vencida por cartão que já viu.
 *
 *   5. O TEXTO ALTERNATIVO FALA DA TAREFA, E NÃO DE SI. Régua da F17.37: a tela
 *      não fala sobre si mesma. "Miniatura do anexo 1" não ajuda ninguém.
 *
 * ⚠️ NENHUMA IDA À REDE, E ISSO É DE FORMA. Todas as funções aqui são
 * síncronas, e função síncrona não espera resposta de ninguém. O
 * `network-guard` da F0.4 derrubaria um `fetch` escondido de qualquer jeito.
 */

import { describe, expect, it } from 'vitest';

import {
  MARGEM_DE_VENCIMENTO_MS,
  aPedir,
  aindaVale,
  apenasOsDesenhados,
  textoDaMiniatura,
} from '@/board/miniaturas';

const AGORA = Date.parse('2026-09-02T12:00:00.000Z');
const daquiA = (ms: number) => new Date(AGORA + ms).toISOString();

const SEM_FALHA = new Set<string>();

describe('o prazo do endereço assinado', () => {
  it('endereço com folga vale', () => {
    expect(aindaVale({ url: 'x', expiresAt: daquiA(300_000) }, AGORA)).toBe(true);
  });

  it('endereço já vencido não vale', () => {
    expect(aindaVale({ url: 'x', expiresAt: daquiA(-1) }, AGORA)).toBe(false);
  });

  it('⚠️ endereço DENTRO da margem já não vale — é o que evita a imagem quebrada', () => {
    expect(aindaVale({ url: 'x', expiresAt: daquiA(MARGEM_DE_VENCIMENTO_MS - 1) }, AGORA)).toBe(
      false,
    );
    expect(aindaVale({ url: 'x', expiresAt: daquiA(MARGEM_DE_VENCIMENTO_MS + 1) }, AGORA)).toBe(
      true,
    );
  });

  it('data ilegível não vale — e não estoura', () => {
    expect(aindaVale({ url: 'x', expiresAt: 'ontem de manhã' }, AGORA)).toBe(false);
    expect(aindaVale(undefined, AGORA)).toBe(false);
  });
});

describe('o que se pede', () => {
  it('pede o que ainda não tem endereço', () => {
    expect(aPedir(['a', 'b'], {}, SEM_FALHA, AGORA)).toEqual(['a', 'b']);
  });

  it('NÃO pede o que já tem endereço válido', () => {
    const conhecidas = { a: { url: 'u', expiresAt: daquiA(300_000) } };
    expect(aPedir(['a', 'b'], conhecidas, SEM_FALHA, AGORA)).toEqual(['b']);
  });

  it('pede de novo o que está vencendo', () => {
    const conhecidas = { a: { url: 'u', expiresAt: daquiA(5_000) } };
    expect(aPedir(['a'], conhecidas, SEM_FALHA, AGORA)).toEqual(['a']);
  });

  it('⚠️ NÃO pede o que já falhou — é a trava do laço', () => {
    expect(aPedir(['a', 'b'], {}, new Set(['a']), AGORA)).toEqual(['b']);
  });

  it('não repete o mesmo identificador, mesmo com dois cartões apontando para ele', () => {
    expect(aPedir(['a', 'a', 'b', 'a'], {}, SEM_FALHA, AGORA)).toEqual(['a', 'b']);
  });

  it('lista vazia não pede nada', () => {
    expect(aPedir([], {}, SEM_FALHA, AGORA)).toEqual([]);
  });
});

describe('o mapa não cresce sem teto', () => {
  it('guarda só o que continua desenhado', () => {
    const conhecidas = {
      a: { url: 'ua', expiresAt: daquiA(300_000) },
      b: { url: 'ub', expiresAt: daquiA(300_000) },
    };
    expect(apenasOsDesenhados(conhecidas, ['b'])).toEqual({
      b: { url: 'ub', expiresAt: daquiA(300_000) },
    });
  });

  it('trocar de lista esvazia o mapa', () => {
    const conhecidas = { a: { url: 'ua', expiresAt: daquiA(300_000) } };
    expect(apenasOsDesenhados(conhecidas, [])).toEqual({});
  });
});

describe('o que a tela diz de si mesma', () => {
  it('o texto alternativo fala da TAREFA, e não do mecanismo', () => {
    const t = textoDaMiniatura('[A] SABOR DOCE - ARTE EMBALAGEM');
    expect(t).toBe('Arte de [A] SABOR DOCE - ARTE EMBALAGEM');
    // A régua da F17.37, escrita como asserção: nenhum jargão de tela na tela.
    expect(t.toLowerCase()).not.toContain('miniatura');
    expect(t.toLowerCase()).not.toContain('prévia');
    expect(t.toLowerCase()).not.toContain('anexo');
  });
});
