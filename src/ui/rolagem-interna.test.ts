/**
 * A ROLAGEM DE DENTRO DO QUADRO VOLTA — F32 (Fase 2), a parte pura.
 *
 * O que precisa ser verdade sempre:
 *
 *   1. A LEITURA NUNCA ESTOURA. O texto guardado veio do navegador, e o
 *      `sessionStorage` pode nem existir (navegação privada, site bloqueado).
 *      Se a leitura estourasse, a `Moldura` cairia e o sistema inteiro junto.
 *   2. O TOPO NÃO É GUARDADO, e rolar de volta ao topo APAGA o que havia —
 *      senão a coluna voltaria para uma posição que a pessoa já desfez.
 *   3. A MESMA TELA É A MESMA CHAVE, escrita de qualquer jeito; visões
 *      diferentes (`?ver=`, `?aba=`) são chaves diferentes.
 *   4. A restauração não rola enquanto o conteúdo chega (o degrau da F17.33),
 *      e aceita "o mais perto que dá" quando a caixa parou de crescer — o caso
 *      do cartão concluído lá dentro, que deixa a coluna mais curta.
 */

import { describe, expect, it } from 'vitest';

import {
  type Armazem,
  ESTAVEL,
  PREFIXO,
  ROLADOR,
  TETO,
  alcanca,
  chaveDaTela,
  comPosicao,
  gravarRolagens,
  lerRolagens,
  passoDaRestauracao,
} from '@/ui/rolagem-interna';

/** Um `sessionStorage` de mentira, com o que foi gravado à vista. */
function armazemDeTeste(inicial: Record<string, string> = {}) {
  const dados = new Map(Object.entries(inicial));
  const armazem: Armazem = {
    getItem: (k) => dados.get(k) ?? null,
    setItem: (k, v) => void dados.set(k, String(v)),
    removeItem: (k) => void dados.delete(k),
  };
  return { armazem, dados };
}

/** Um armazém que estoura em tudo — cota cheia, acesso negado. */
const armazemQueEstoura: Armazem = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

describe('a chave da tela', () => {
  it('é o caminho, sem barra no fim, quando não há busca', () => {
    expect(chaveDaTela('/quadro/abc', '')).toBe('/quadro/abc');
    expect(chaveDaTela('/quadro/abc/', '')).toBe('/quadro/abc');
    expect(chaveDaTela('/', '')).toBe('/');
  });

  it('a ordem dos parâmetros não muda a chave', () => {
    expect(chaveDaTela('/meu-trabalho', '?aba=feito&ver=quadro')).toBe(
      chaveDaTela('/meu-trabalho', '?ver=quadro&aba=feito'),
    );
  });

  it('visões diferentes são chaves diferentes', () => {
    const quadro = chaveDaTela('/meu-trabalho', '?ver=quadro');
    expect(chaveDaTela('/meu-trabalho', '?ver=lista')).not.toBe(quadro);
    expect(chaveDaTela('/meu-trabalho', '?ver=quadro&aba=feito')).not.toBe(quadro);
    expect(chaveDaTela('/quadro/abc', '?busca=sonho')).not.toBe(chaveDaTela('/quadro/abc', ''));
  });

  it('os nomes das caixas são estáveis', () => {
    expect(ROLADOR.faixa).toBe('faixa');
    expect(ROLADOR.coluna('st-1')).toBe('coluna:st-1');
  });
});

describe('a leitura nunca estoura', () => {
  it('sem armazém, ou sem nada guardado, é vazio', () => {
    expect(lerRolagens(null, '/quadro/a')).toEqual({});
    expect(lerRolagens(armazemDeTeste().armazem, '/quadro/a')).toEqual({});
  });

  it('armazém que estoura é vazio, e não exceção', () => {
    expect(() => lerRolagens(armazemQueEstoura, '/quadro/a')).not.toThrow();
    expect(lerRolagens(armazemQueEstoura, '/quadro/a')).toEqual({});
  });

  it('texto que não é JSON, ou JSON que não é objeto, é vazio', () => {
    for (const cru of ['não sou json {', 'null', '42', '"texto"', '[1,2]']) {
      const { armazem } = armazemDeTeste({ [PREFIXO + '/q']: cru });
      expect(lerRolagens(armazem, '/q')).toEqual({});
    }
  });

  it('entrada com forma errada sai sozinha, sem levar as outras', () => {
    const { armazem } = armazemDeTeste({
      [PREFIXO + '/q']: JSON.stringify({
        faixa: { x: 150, y: 0 },
        'coluna:a': { x: 0, y: 2420.4 },
        'coluna:b': { x: 'muito', y: 3 },
        'coluna:c': { x: -5, y: 10 },
        'coluna:d': null,
        'coluna:e': { x: 0, y: 0 },
        'coluna:f': { x: 0, y: Number.MAX_VALUE * 10 },
      }),
    });
    expect(lerRolagens(armazem, '/q')).toEqual({
      faixa: { x: 150, y: 0 },
      'coluna:a': { x: 0, y: 2420 },
    });
  });

  it('respeita o teto de caixas por tela', () => {
    const muitas = Object.fromEntries(
      Array.from({ length: TETO + 50 }, (_, i) => [`coluna:${i}`, { x: 0, y: i + 1 }]),
    );
    const { armazem } = armazemDeTeste({ [PREFIXO + '/q']: JSON.stringify(muitas) });
    expect(Object.keys(lerRolagens(armazem, '/q'))).toHaveLength(TETO);
  });
});

describe('a gravação', () => {
  it('grava só o que saiu do topo, arredondado', () => {
    const { armazem, dados } = armazemDeTeste();
    gravarRolagens(armazem, '/q', {
      faixa: { x: 150.6, y: 0 },
      'coluna:a': { x: 0, y: 0 },
      'coluna:b': { x: 0, y: 2420 },
    });
    expect(JSON.parse(dados.get(PREFIXO + '/q') ?? 'null')).toEqual({
      faixa: { x: 151, y: 0 },
      'coluna:b': { x: 0, y: 2420 },
    });
  });

  it('tela toda no topo APAGA a chave — a posição antiga não pode voltar', () => {
    const { armazem, dados } = armazemDeTeste({ [PREFIXO + '/q']: '{"faixa":{"x":300,"y":0}}' });
    gravarRolagens(armazem, '/q', { faixa: { x: 0, y: 0 } });
    expect(dados.has(PREFIXO + '/q')).toBe(false);
  });

  it('armazém que estoura, ou ausente, não derruba nada', () => {
    expect(() => gravarRolagens(armazemQueEstoura, '/q', { faixa: { x: 1, y: 0 } })).not.toThrow();
    expect(() => gravarRolagens(armazemQueEstoura, '/q', {})).not.toThrow();
    expect(() => gravarRolagens(null, '/q', { faixa: { x: 1, y: 0 } })).not.toThrow();
  });

  it('o que se grava é o que se lê', () => {
    const { armazem } = armazemDeTeste();
    const retrato = { faixa: { x: 150, y: 0 }, 'coluna:st0': { x: 0, y: 2420 } };
    gravarRolagens(armazem, '/quadro/l', retrato);
    expect(lerRolagens(armazem, '/quadro/l')).toEqual(retrato);
    expect(lerRolagens(armazem, '/quadro/outra')).toEqual({});
  });
});

describe('o retrato', () => {
  it('atualiza uma caixa sem mexer nas outras, e sem mudar o original', () => {
    const antes = { faixa: { x: 150, y: 0 } };
    const depois = comPosicao(antes, 'coluna:a', { x: 0, y: 99.6 });
    expect(depois).toEqual({ faixa: { x: 150, y: 0 }, 'coluna:a': { x: 0, y: 100 } });
    expect(antes).toEqual({ faixa: { x: 150, y: 0 } });
  });

  it('a caixa que volta ao topo sai do retrato', () => {
    expect(comPosicao({ faixa: { x: 150, y: 0 }, 'coluna:a': { x: 0, y: 9 } }, 'coluna:a', { x: 0, y: 0 })).toEqual({
      faixa: { x: 150, y: 0 },
    });
  });
});

describe('a restauração', () => {
  const coluna = (conteudo: number, caixa = 600) => ({
    scrollLeft: 0,
    scrollTop: 0,
    scrollWidth: 272,
    clientWidth: 272,
    scrollHeight: conteudo,
    clientHeight: caixa,
  });

  it('alcança quando o conteúdo já cobre o lugar, nos dois eixos', () => {
    expect(alcanca(coluna(3020), { x: 0, y: 2420 })).toBe(true);
    expect(alcanca(coluna(3019), { x: 0, y: 2420 })).toBe(true); // 1px de folga (arredondamento)
    expect(alcanca(coluna(2900), { x: 0, y: 2420 })).toBe(false);
    expect(alcanca(coluna(3020), { x: 10, y: 0 })).toBe(false);
  });

  it('com o lugar ao alcance, conclui — mesmo na primeira volta', () => {
    expect(passoDaRestauracao(coluna(3020), { x: 0, y: 2420 }, 0)).toBe('concluir');
  });

  it('enquanto o conteúdo chega, espera — não rola em degraus', () => {
    expect(passoDaRestauracao(coluna(900), { x: 0, y: 2420 }, 0)).toBe('esperar');
    expect(passoDaRestauracao(coluna(900), { x: 0, y: 2420 }, ESTAVEL - 1)).toBe('esperar');
  });

  it('a caixa parada que não alcança vai ao mais perto que dá — o cartão que saiu da coluna', () => {
    expect(passoDaRestauracao(coluna(2900), { x: 0, y: 2420 }, ESTAVEL)).toBe('aparar');
  });
});
