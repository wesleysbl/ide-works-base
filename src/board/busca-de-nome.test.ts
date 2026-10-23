/**
 * A busca por nome nos seletores da tarefa (pessoa, lista, cliente).
 *
 * O QUE ESTES TESTES GUARDAM
 *   Que "joao" ache "João" e "luiza" ache "Ana Luíza". Os quatro seletores do
 *   quadro comparavam `nome.toLowerCase().includes(busca.toLowerCase())`: quem
 *   digitava sem acento — o normal, no teclado do dia a dia — não achava a
 *   pessoa, a lista nem o cliente, e o seletor dizia "Ninguém com esse nome".
 *   A busca por título (`filtro.ts`) e as das telas de Pessoas e Meta já
 *   dobravam o acento; estas quatro ficaram para trás.
 */

import { describe, expect, it } from 'vitest';

import { nomeCasaComABusca, paraBusca } from '@/board/busca-de-nome';

describe('paraBusca', () => {
  it('tira acento e caixa', () => {
    expect(paraBusca('João')).toBe('joao');
    expect(paraBusca('CONCEIÇÃO')).toBe('conceicao');
    expect(paraBusca('Ana Luíza')).toBe('ana luiza');
  });

  it('dobra o acento digitado em forma decomposta (teclado do macOS)', () => {
    expect(paraBusca('João')).toBe('joao');
  });

  it('não mexe no que não tem acento', () => {
    expect(paraBusca('Ide Hub 2')).toBe('ide hub 2');
  });
});

describe('nomeCasaComABusca', () => {
  it('busca sem acento acha nome com acento, e o contrário também', () => {
    expect(nomeCasaComABusca('João Silva', 'joao')).toBe(true);
    expect(nomeCasaComABusca('Joao Silva', 'joão')).toBe(true);
    expect(nomeCasaComABusca('Clínica Sorrir', 'clinica')).toBe(true);
  });

  it('acha no meio do nome, em qualquer caixa', () => {
    expect(nomeCasaComABusca('Ana Luíza Prado', 'LUIZA')).toBe(true);
    expect(nomeCasaComABusca('Ana Luíza Prado', 'prado')).toBe(true);
  });

  it('busca vazia ou só espaços casa com tudo', () => {
    expect(nomeCasaComABusca('Qualquer um', '')).toBe(true);
    expect(nomeCasaComABusca('Qualquer um', '   ')).toBe(true);
  });

  it('o que não está no nome não casa', () => {
    expect(nomeCasaComABusca('João Silva', 'maria')).toBe(false);
  });
});
