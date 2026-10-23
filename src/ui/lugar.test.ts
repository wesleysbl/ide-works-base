/**
 * ONDE A PESSOA ESTAVA — etapa F17.24.
 *
 * O QUE PRECISA SER VERDADE SEMPRE
 *   Vale o mesmo contrato de `preferencias.test.ts`: o que está guardado veio
 *   do navegador e pode ser qualquer coisa. A leitura nunca estoura — se
 *   estourar, a árvore não desenha e o sistema fica sem navegação.
 *
 *   E há duas armadilhas próprias desta etapa:
 *
 *   1. GUARDA-SE O RECOLHIDO, NÃO O ABERTO. Ao contrário, um espaço criado
 *      depois (por mim ou por outra pessoa) nasceria invisível para quem já
 *      tivesse mexido na árvore — que é o defeito mais caro possível numa
 *      barra de navegação.
 *
 *   2. A LISTA GUARDADA PODE TER SUMIDO. Arquivar a lista aberta é gesto
 *      comum, e um quadro que abrisse nela mostraria uma tela vazia sem dizer
 *      por quê.
 */

import { describe, expect, it } from 'vitest';

import {
  PADRAO,
  TETO,
  TETO_RECENTES,
  alternar,
  chavesValidas,
  escreverLugar,
  lembrarRecente,
  lerLugar,
  listaDeAbertura,
  recentesValidos,
} from '@/ui/lugar';

describe('a leitura nunca estoura', () => {
  it('sem nada guardado, devolve o padrão', () => {
    expect(lerLugar(null)).toEqual(PADRAO);
    expect(lerLugar('')).toEqual(PADRAO);
    expect(lerLugar('   ')).toEqual(PADRAO);
  });

  it('texto que não é JSON devolve o padrão em vez de estourar', () => {
    expect(() => lerLugar('não sou json {')).not.toThrow();
    expect(lerLugar('não sou json {')).toEqual(PADRAO);
  });

  it('JSON que não é objeto devolve o padrão', () => {
    expect(lerLugar('null')).toEqual(PADRAO);
    expect(lerLugar('42')).toEqual(PADRAO);
    expect(lerLugar('"texto"')).toEqual(PADRAO);
    expect(lerLugar('[1,2,3]')).toEqual(PADRAO);
  });

  it('campo com tipo errado vira o padrão daquele campo, sem levar os outros', () => {
    const lido = lerLugar(
      JSON.stringify({ lista: 42, arvore: 'nada disso', grupos: null, subtarefas: 'sim' }),
    );
    expect(lido.lista).toBeNull();
    expect(lido.arvore).toEqual([]);
    expect(lido.grupos).toEqual([]);
    expect(lido.subtarefas).toBe(false);
  });

  it('campo desconhecido de uma versão futura é descartado sem estragar o resto', () => {
    const lido = lerLugar(JSON.stringify({ lista: 'abc', inventado: { a: 1 } }));
    expect(lido.lista).toBe('abc');
    expect(lido).not.toHaveProperty('inventado');
  });

  it('lista vazia ou só espaço vale como "nenhuma"', () => {
    expect(lerLugar(JSON.stringify({ lista: '' })).lista).toBeNull();
    expect(lerLugar(JSON.stringify({ lista: '   ' })).lista).toBeNull();
  });

  it('o que se escreve é o que se lê de volta', () => {
    const lugar = {
      lista: 'abc-123',
      arvore: ['space:1', 'folder:2'],
      grupos: ['hoje'],
      recentes: ['lista-9', 'lista-4'],
      subtarefas: true,
      arquivados: true,
      vazias: false,
      modos: { espaco: 'kanban' as const, 'espaco:e1': 'lista' as const },
    };
    expect(lerLugar(escreverLugar(lugar))).toEqual(lugar);
  });

  it('F06C: guardado de antes, sem `vazias`, lê o padrão ligado; valor estranho também', () => {
    expect(lerLugar(JSON.stringify({ lista: 'abc', subtarefas: true })).vazias).toBe(true);
    expect(lerLugar(JSON.stringify({ vazias: 'sim' })).vazias).toBe(true);
    expect(lerLugar(JSON.stringify({ vazias: false })).vazias).toBe(false);
  });
});

describe('as chaves recolhidas', () => {
  it('repetida entra uma vez só', () => {
    expect(chavesValidas(['a', 'a', 'b'])).toEqual(['a', 'b']);
  });

  it('vazia e não-texto somem', () => {
    expect(chavesValidas(['a', '', '   ', 3, null, { x: 1 }])).toEqual(['a']);
  });

  it('o teto corta as MAIS ANTIGAS, e não as mais recentes', () => {
    const muitas = Array.from({ length: TETO + 3 }, (_, i) => `n${i}`);
    const cortadas = chavesValidas(muitas);
    expect(cortadas).toHaveLength(TETO);
    // as três primeiras foram embora; a última continua
    expect(cortadas).not.toContain('n0');
    expect(cortadas).toContain(`n${TETO + 2}`);
  });
});

describe('alternar', () => {
  it('põe quem não estava', () => {
    expect(alternar([], 'space:1')).toEqual(['space:1']);
  });

  it('tira quem estava', () => {
    expect(alternar(['space:1', 'folder:2'], 'space:1')).toEqual(['folder:2']);
  });

  it('não mexe no que veio — devolve lista nova', () => {
    const antes = ['space:1'];
    const depois = alternar(antes, 'folder:2');
    expect(antes).toEqual(['space:1']);
    expect(depois).not.toBe(antes);
  });
});

describe('qual lista o /quadro sem id abre', () => {
  const vivas = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('abre a guardada quando ela ainda está viva', () => {
    expect(listaDeAbertura('c', vivas)).toBe('c');
  });

  it('⚠️ cai na primeira quando a guardada foi arquivada ou apagada', () => {
    expect(listaDeAbertura('sumiu', vivas)).toBe('a');
  });

  it('sem nada guardado, abre a primeira — o comportamento de antes da F17.24', () => {
    expect(listaDeAbertura(null, vivas)).toBe('a');
  });

  it('sem lista viva nenhuma, não manda ninguém para lugar nenhum', () => {
    expect(listaDeAbertura('a', [])).toBeNull();
    expect(listaDeAbertura(null, [])).toBeNull();
  });
});

/* ────────────── os destinos recentes de mover — F17.63 ────────────── */

describe('os destinos recentes', () => {
  it('o último usado fica em CIMA', () => {
    expect(lembrarRecente(['b', 'c'], 'a')).toEqual(['a', 'b', 'c']);
  });

  it('repetir um destino não cria linha nova — ele SOBE', () => {
    // É o uso que o usuário descreveu: mover algumas demandas para a mesma
    // lista. Sem isto, cinco movimentos encheriam a seção com o mesmo nome e o
    // atalho morreria no primeiro dia.
    expect(lembrarRecente(['b', 'a', 'c'], 'a')).toEqual(['a', 'b', 'c']);
  });

  it('tem teto, e quem some é o MAIS ANTIGO', () => {
    const cheio = ['1', '2', '3', '4', '5'];
    expect(cheio).toHaveLength(TETO_RECENTES);
    expect(lembrarRecente(cheio, '6')).toEqual(['6', '1', '2', '3', '4']);
  });

  it('o corte é do lado contrário ao de `chavesValidas`, e é de propósito', () => {
    // Lá o mais recente está no FIM e o corte tira do começo; aqui o mais
    // recente está no COMEÇO. Os dois guardam o gesto mais novo — a lista é
    // que está escrita ao contrário, porque `Recentes` desenha de cima.
    expect(recentesValidos(['a', 'b', 'c', 'd', 'e', 'f'])).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('lixo guardado por outra versão não estoura nem entra', () => {
    expect(recentesValidos(['a', '', '   ', 3, null, { x: 1 }, 'a'])).toEqual(['a']);
    expect(recentesValidos('não é lista')).toEqual([]);
    expect(recentesValidos(undefined)).toEqual([]);
  });

  it('lugar guardado ANTES desta etapa lê recentes vazios, e não quebra', () => {
    // O `Lugar` de quem já usava o sistema não tem o campo. Tolerante na
    // leitura: campo que falta é preenchido, e ninguém perde a lista aberta.
    const antigo = JSON.stringify({ lista: 'abc', arvore: [], grupos: [], subtarefas: true });
    expect(lerLugar(antigo).recentes).toEqual([]);
    expect(lerLugar(antigo).lista).toBe('abc');
  });

  it('id vazio não vira destino', () => {
    expect(lembrarRecente(['a'], '')).toEqual(['a']);
    expect(lembrarRecente(['a'], '   ')).toEqual(['a']);
  });
});
