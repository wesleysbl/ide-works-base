/**
 * A fila das gravações dos chips da ficha.
 *
 * O QUE ESTES TESTES GUARDAM
 *   Marcar três responsáveis em sequência, com a rede lenta, mandava três
 *   `PATCH` em paralelo — `[a]`, `[a,b]`, `[a,c]` — e a resposta do primeiro,
 *   chegando no meio do terceiro clique, devolvia o menu ao `[a]`: o terceiro
 *   clique partia de um conjunto sem o `b`, e o `b` se perdia no servidor. A
 *   fila faz as gravações saírem uma depois da outra, na ordem dos cliques, e
 *   diz qual é a última — só a resposta dela tem a palavra final sobre o que a
 *   tela mostra.
 */

import { describe, expect, it } from 'vitest';

import { criarFilaDeGravacoes } from '@/board/fila-de-gravacoes';

/** Uma gravação cuja resposta o teste solta quando quiser. */
function gravacaoManual<T>() {
  let resolver!: (v: T) => void;
  let rejeitar!: (e: unknown) => void;
  const promessa = new Promise<T>((res, rej) => {
    resolver = res;
    rejeitar = rej;
  });
  return { promessa, resolver, rejeitar };
}

const microtarefas = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('as gravações saem uma depois da outra, na ordem em que foram pedidas', () => {
  it('a segunda só começa quando a primeira termina', async () => {
    const fila = criarFilaDeGravacoes();
    const eventos: string[] = [];
    const a = gravacaoManual<string>();
    const b = gravacaoManual<string>();

    const pa = fila.enfileirar(() => { eventos.push('começa a'); return a.promessa; });
    const pb = fila.enfileirar(() => { eventos.push('começa b'); return b.promessa; });

    await microtarefas();
    expect(eventos).toEqual(['começa a']);

    a.resolver('ra');
    expect(await pa.resultado).toBe('ra');
    await microtarefas();
    expect(eventos).toEqual(['começa a', 'começa b']);

    b.resolver('rb');
    expect(await pb.resultado).toBe('rb');
  });

  it('a que falhou não trava a seguinte, e a falha chega só a quem a pediu', async () => {
    const fila = criarFilaDeGravacoes();
    const a = gravacaoManual<string>();
    const pa = fila.enfileirar(() => a.promessa);
    const pb = fila.enfileirar(async () => 'rb');

    a.rejeitar(new Error('recusou'));
    await expect(pa.resultado).rejects.toThrow('recusou');
    expect(await pb.resultado).toBe('rb');
  });
});

describe('só a última tem a palavra final', () => {
  it('ehAUltima é verdadeiro só para a gravação mais nova', () => {
    const fila = criarFilaDeGravacoes();
    const a = fila.enfileirar(async () => 1);
    expect(a.ehAUltima()).toBe(true);
    const b = fila.enfileirar(async () => 2);
    expect(a.ehAUltima()).toBe(false);
    expect(b.ehAUltima()).toBe(true);
  });

  it('terminou diz se não resta nenhuma no ar — é o que desliga o "salvando"', async () => {
    const fila = criarFilaDeGravacoes();
    const a = fila.enfileirar(async () => 1);
    const b = fila.enfileirar(async () => 2);
    await a.resultado;
    expect(a.terminou()).toBe(false);
    await b.resultado;
    expect(b.terminou()).toBe(true);
  });

  it('depois de esvaziar, a fila recomeça: a próxima é a primeira de novo', async () => {
    const fila = criarFilaDeGravacoes();
    const a = fila.enfileirar(async () => 1);
    await a.resultado;
    expect(a.terminou()).toBe(true);
    const b = fila.enfileirar(async () => 2);
    expect(b.ehAUltima()).toBe(true);
    await b.resultado;
    expect(b.terminou()).toBe(true);
  });
});
