/**
 * A ESPERA DA BUSCA DO QUADRO NÃO FECHA O PAINEL QUE ACABOU DE ABRIR.
 *
 * O DEFEITO (F43, Fase 7)
 *   A caixa "Buscar tarefa pelo nome…" (`BarraDeFiltro`) grava a busca no
 *   endereço 350 ms depois da última tecla, com `replace` e sem `state`.
 *   Digitar e clicar num cartão antes disso: `LinkDaTarefa` empurra a entrada
 *   do painel (estado + máscara), e o relógio dispara DEPOIS, trocando essa
 *   entrada por uma sem o painel — o painel some.
 *
 * O QUE SE PROVA (sem navegador; o e2e é `card-ao-lado` CL13)
 *   - quem fica na tela recebe a busca no endereço depois da espera;
 *   - sair da caixa grava NA HORA (o `mousedown` do cartão vem antes do
 *     clique que abre o painel) — o padrão de `useTextoNoEndereco.gravarJa`;
 *   - se a entrada do histórico mudou com a busca ainda pendente, o relógio
 *     não escreve por cima da entrada nova;
 *   - `cancelar` (a peça saiu, ou Enter/Esc/X gravaram por outro caminho)
 *     esquece o pendente.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ESPERA_DA_BUSCA, esperaDaBusca } from '@/board/espera-da-busca';

let entrada: string | null;
let gravadas: string[];

const nova = () =>
  esperaDaBusca({
    espera: ESPERA_DA_BUSCA,
    gravar: (texto) => gravadas.push(texto),
    ondeEstou: () => entrada,
  });

beforeEach(() => {
  vi.useFakeTimers();
  entrada = 'quadro-1';
  gravadas = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('quem fica na tela', () => {
  it('a busca vai para o endereço depois da espera — uma vez, com o último texto', () => {
    const e = nova();
    e.digitar('s');
    e.digitar('so');
    e.digitar('sabor');
    vi.advanceTimersByTime(ESPERA_DA_BUSCA - 1);
    expect(gravadas).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(gravadas).toEqual(['sabor']);
  });

  it('a espera continua de 350 ms', () => {
    expect(ESPERA_DA_BUSCA).toBe(350);
  });
});

describe('digitar e clicar logo num cartão', () => {
  it('sair da caixa grava na hora, e o relógio não grava de novo depois', () => {
    const e = nova();
    e.digitar('sabor');
    vi.advanceTimersByTime(100);
    e.gravarJa(); // o `blur` do `mousedown` no cartão
    expect(gravadas).toEqual(['sabor']);
    entrada = 'painel-da-tarefa'; // o clique empurra a entrada do painel
    vi.advanceTimersByTime(1000);
    expect(gravadas).toEqual(['sabor']);
  });

  it('a entrada mudou com a busca pendente: o relógio NÃO escreve por cima dela', () => {
    const e = nova();
    e.digitar('sabor');
    entrada = 'painel-da-tarefa';
    vi.advanceTimersByTime(1000);
    expect(gravadas).toEqual([]);
  });

  it('sair da caixa sem nada pendente não grava nada', () => {
    const e = nova();
    e.gravarJa();
    e.digitar('sabor');
    vi.advanceTimersByTime(ESPERA_DA_BUSCA);
    e.gravarJa();
    expect(gravadas).toEqual(['sabor']);
  });
});

describe('cancelar', () => {
  it('esquece o pendente: nem o relógio nem o `gravarJa` gravam', () => {
    const e = nova();
    e.digitar('sabor');
    e.cancelar();
    vi.advanceTimersByTime(1000);
    e.gravarJa();
    expect(gravadas).toEqual([]);
  });
});
