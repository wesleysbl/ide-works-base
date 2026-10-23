/**
 * PARA ONDE O VOLTAR LEVA — F17.33. Desde a F29, só o X da ficha da tarefa.
 *
 * A armadilha desta etapa cabe numa frase: **`history.back()` cego manda para
 * fora do sistema**. Quem abre `/tarefa/<id>` de um link colado no WhatsApp tem
 * o histórico vazio, e o passo anterior dele é o WhatsApp.
 *
 * Estes testes provam a decisão, e não o desenho: `comoVoltar` é pura, e o
 * botão só existe quando ela diz que existe.
 */

import { describe, expect, it } from 'vitest';

import { comoVoltar, temHistoricoNoApp } from '@/ui/volta';

describe('há passo anterior dentro do sistema?', () => {
  it('o índice do roteador acima de zero diz que sim', () => {
    expect(temHistoricoNoApp({ idx: 1 })).toBe(true);
    expect(temHistoricoNoApp({ idx: 7, key: 'abc' })).toBe(true);
  });

  it('índice zero é a entrada em que o sistema foi ABERTO — não há nada atrás', () => {
    expect(temHistoricoNoApp({ idx: 0 })).toBe(false);
  });

  it('sem estado nenhum, não há', () => {
    expect(temHistoricoNoApp(null)).toBe(false);
    expect(temHistoricoNoApp(undefined)).toBe(false);
    expect(temHistoricoNoApp({})).toBe(false);
  });

  it('o que vem do navegador pode ser qualquer coisa, e não estoura', () => {
    // `history.state` é gravável por qualquer script da página, inclusive por
    // uma versão anterior deste app que tenha ficado numa entrada antiga.
    expect(temHistoricoNoApp('1')).toBe(false);
    expect(temHistoricoNoApp({ idx: '3' })).toBe(false);
    expect(temHistoricoNoApp({ idx: Number.NaN })).toBe(false);
    expect(temHistoricoNoApp({ idx: -1 })).toBe(false);
    expect(temHistoricoNoApp(42)).toBe(false);
  });
});

/*
 * ⚠️ O BLOCO DE `lugarAcima` SAIU NA F29 (Fase 5a), COM A TABELA. Ela dizia o
 * lugar acima de cada rota para o `‹ Voltar` das molduras, que não existe
 * mais: esse lugar virou o primeiro degrau da trilha de cada tela — provado
 * em `trilha.test.ts` (`trilhaDeDetalhe`) e em
 * `test/toda-tela-diz-onde-esta.test.ts`. O X da ficha sempre passa o dele.
 */

describe('a decisão inteira', () => {
  it('com histórico, volta ao passo anterior — é o que o botão promete', () => {
    expect(comoVoltar('/tarefa/t1', { idx: 3 }, '/quadro/l9')).toEqual({ modo: 'historico' });
  });

  it('⚠️ SEM histórico, NÃO usa o histórico — vai ao lugar acima', () => {
    // É este o caso do link colado. Um `back()` aqui sairia do sistema.
    expect(comoVoltar('/tarefa/t1', { idx: 0 }, '/quadro/l1')).toEqual({ modo: 'lugar', para: '/quadro/l1' });
  });

  it('sem histórico e sem lugar acima, não há botão', () => {
    expect(comoVoltar('/tarefa/t1', { idx: 0 }, null)).toBeNull();
    expect(comoVoltar('/tarefa/t1', null, null)).toBeNull();
  });

  it('o lugar acima só vale sem histórico', () => {
    expect(comoVoltar('/tarefa/t1', { idx: 0 }, '/quadro/l9')).toEqual({
      modo: 'lugar',
      para: '/quadro/l9',
    });
    expect(comoVoltar('/tarefa/t1', { idx: 2 }, '/quadro/l9')).toEqual({ modo: 'historico' });
  });

  it('um voltar que abre a tela que já está aberta não é voltar', () => {
    expect(comoVoltar('/quadro', { idx: 0 }, '/quadro')).toBeNull();
    expect(comoVoltar('/meta', { idx: 0 }, '/meta/')).toBeNull();
  });
});
