/**
 * O QUE A TELA MOSTRA DEPOIS DE CADA RESPOSTA DA ÁRVORE — F17.CARGA02.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTES CASOS, E NÃO OUTROS
 *
 *   Ligar o cache mudou uma coisa que ninguém pede e todo mundo sente: com
 *   estado em componente, um erro apagava o que estava na tela porque o
 *   `catch` escrevia `[]`. Com cache, o dado ANTERIOR sobrevive ao erro — e
 *   isso é certo em um caso e perigoso no outro:
 *
 *     · a revalidação que falhou por rede ou 5xx → o mapa FICA. Sumir com a
 *       árvore porque uma leitura de fundo tropeçou seria punir quem não fez
 *       nada, e a pessoa perderia o lugar onde estava;
 *     · o `403` de uma conta desativada → o mapa SOME. Ali o servidor está
 *       dizendo que aquilo não deveria estar na tela, e mantê-lo seria a tela
 *       afirmando uma autorização que acabou.
 *
 *   A conta é pura, e é aqui que ela se prova — sem navegador, caso a caso,
 *   como `ondeCabe` e `deveBloquear`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, expect, it } from 'vitest';

import { type Empresa, type FullTreeRow } from '@/board/arvore';
import { comoEstaAArvore, leituraDaArvore, sessaoAcabou } from '@/board/arvore-compartilhada';
import { ApiError } from '@/lib/api';

const LINHAS = [{ id: 'espaco-1' }] as unknown as FullTreeRow[];
const EMPRESAS = [{ id: 'empresa-1' }] as unknown as Empresa[];
const CHEGOU = { linhas: LINHAS, empresas: EMPRESAS };

/** A `ApiError` de uma falha passageira — a mesma que `@/lib/api` fabrica. */
const passageira = (mensagem: string, status: number) =>
  new ApiError(mensagem, status, undefined, undefined, true);

describe('antes de qualquer resposta', () => {
  it('não há linhas, não há recusa e não há o que tentar de novo', () => {
    // ⚠️ `linhas` NULO não é "nenhum espaço": é "ainda não sei". A diferença
    // entre os dois é o que a fase seguinte transforma em esqueleto e em frase.
    expect(leituraDaArvore(undefined, null)).toEqual({
      linhas: null,
      empresas: [],
      recusa: null,
      recuperavel: false,
    });
  });

  it('a lista vazia de empresas é sempre a MESMA — ela vai como propriedade', () => {
    // Um `[]` novo a cada desenho refaria memórias que dependem dele.
    expect(leituraDaArvore(undefined, null).empresas).toBe(
      leituraDaArvore(undefined, new Error('outra coisa')).empresas,
    );
  });
});

describe('a falha passageira preserva o que já está desenhado', () => {
  it('a árvore fica, com a frase do servidor e a oferta de tentar de novo', () => {
    const r = leituraDaArvore(CHEGOU, passageira('Não foi possível falar com o servidor.', 0));
    expect(r.linhas).toBe(LINHAS);
    expect(r.empresas).toBe(EMPRESAS);
    expect(r.recusa).toBe('Não foi possível falar com o servidor.');
    expect(r.recuperavel).toBe(true);
  });

  it('sem árvore anterior, a falha aparece sozinha', () => {
    const r = leituraDaArvore(undefined, passageira('Instável.', 503));
    expect(r.linhas).toBeNull();
    expect(r.recusa).toBe('Instável.');
    expect(r.recuperavel).toBe(true);
  });
});

describe('a recusa de acesso apaga a árvore da tela', () => {
  it('403 tira o desenho antigo e mostra a frase do servidor', () => {
    // `Esta conta está desativada. Procure um administrador.` — o 403 de
    // `authorize` quando alguém é cortado no meio do expediente.
    const r = leituraDaArvore(
      CHEGOU,
      new ApiError('Esta conta está desativada. Procure um administrador.', 403),
    );
    expect(r.linhas).toBeNull();
    expect(r.empresas).toEqual([]);
    expect(r.recusa).toBe('Esta conta está desativada. Procure um administrador.');
    // Não é passageiro: nada de "Tentar de novo" contra uma conta desativada.
    expect(r.recuperavel).toBe(false);
  });
});

describe('a sessão vencida não é recusa de árvore', () => {
  it('401 não vira faixa vermelha — quem responde a ele é o login', () => {
    const erro = new ApiError('Sessão inválida ou expirada. Entre novamente.', 401);
    expect(sessaoAcabou(erro)).toBe(true);
    // A frase de sessão numa faixa de "não foi possível carregar os espaços"
    // faria a pessoa procurar defeito onde só falta entrar de novo.
    expect(leituraDaArvore(CHEGOU, erro).recusa).toBeNull();
  });

  it('e nem toda falha é sessão vencida', () => {
    expect(sessaoAcabou(passageira('Instável.', 503))).toBe(false);
    expect(sessaoAcabou(null)).toBe(false);
  });
});

describe('o erro que não é do banco', () => {
  it('cai na frase de último caso, e não no texto cru da exceção', () => {
    // `TypeError: Failed to fetch` na cara de quem só queria ver as listas.
    const r = leituraDaArvore(undefined, new TypeError('Failed to fetch'));
    expect(r.recusa).toBe('Não foi possível carregar os espaços.');
    expect(r.recuperavel).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   ESPERA, FALHA E AUSÊNCIA DE ESPAÇOS SÃO TRÊS COISAS — F17.CARGA03
   ═══════════════════════════════════════════════════════════════════════════

   O caso do topo deste arquivo já dizia, na F17.CARGA02: "`linhas` NULO não é
   'nenhum espaço': é 'ainda não sei'. A diferença entre os dois é o que a fase
   seguinte transforma em esqueleto e em frase." É esta fase, e é este bloco.

   O defeito que ele fecha estava numa captura de tela: a barra dizia `Nenhum
   espaço ao seu alcance.` ENQUANTO a leitura ainda estava no ar, e o dono do
   projeto leu como falha de acesso — uma afirmação sobre permissão ocupando o
   lugar de "estou carregando". */

const CHEGOU_VAZIO = { linhas: [] as FullTreeRow[], empresas: [] as Empresa[] };

describe('em que pé está a leitura', () => {
  it('antes de qualquer resposta é ESPERA — nunca "nenhum espaço"', () => {
    expect(comoEstaAArvore(leituraDaArvore(undefined, null))).toBe('carregando');
  });

  it('resposta boa e VAZIA é o único caso em que a frase de alcance é verdade', () => {
    // Aqui o servidor respondeu, e respondeu "não há espaço nenhum para você".
    // Esta é a única situação em que a barra pode afirmar isso.
    expect(comoEstaAArvore(leituraDaArvore(CHEGOU_VAZIO, null))).toBe('pronta');
  });

  it('resposta boa e cheia também é PRONTA', () => {
    expect(comoEstaAArvore(leituraDaArvore(CHEGOU, null))).toBe('pronta');
  });

  it('falha sem nada na tela é RECUSADA — e recusada não é vazio', () => {
    // O critério explícito da fase: falha e resultado vazio precisam ser
    // visualmente distintos. Aqui eles já são estados distintos.
    const espera = comoEstaAArvore(leituraDaArvore(undefined, null));
    const falha = comoEstaAArvore(leituraDaArvore(undefined, passageira('Instável.', 503)));
    const vazio = comoEstaAArvore(leituraDaArvore(CHEGOU_VAZIO, null));
    expect(falha).toBe('recusada');
    expect(new Set([espera, falha, vazio]).size).toBe(3);
  });

  it('a recusa de acesso também é RECUSADA — o 403 não vira "nenhum espaço"', () => {
    // `Esta conta está desativada` apagou a árvore da tela (ver acima). Sem
    // esta distinção, a tela trocaria a frase do servidor por uma sobre alcance.
    const r = leituraDaArvore(CHEGOU, new ApiError('Esta conta está desativada.', 403));
    expect(comoEstaAArvore(r)).toBe('recusada');
  });

  it('REVALIDAÇÃO QUE FALHOU continua PRONTA — o mapa fica na tela', () => {
    // Trocar a árvore desenhada por um esqueleto porque uma leitura de fundo
    // tropeçou faria a pessoa perder o lugar onde estava. A recusa aparece numa
    // faixa discreta ao lado; o mapa não se mexe.
    const r = leituraDaArvore(CHEGOU, passageira('Não foi possível falar com o servidor.', 0));
    expect(comoEstaAArvore(r)).toBe('pronta');
    expect(r.linhas).toBe(LINHAS);
    expect(r.recusa).not.toBeNull();
  });

  it('a sessão vencida é ESPERA, e não acusação de falta de acesso', () => {
    // No 401 o gancho já está navegando para o login. Um esqueleto no meio do
    // caminho é neutro; `Nenhum espaço ao seu alcance` acusaria de falta de
    // acesso quem só precisa entrar de novo.
    const erro = new ApiError('Sessão inválida ou expirada. Entre novamente.', 401);
    expect(comoEstaAArvore(leituraDaArvore(undefined, erro))).toBe('carregando');
  });
});
