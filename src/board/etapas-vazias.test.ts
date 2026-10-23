/**
 * ETAPAS VAZIAS E NAVEGAÇÃO POR ETAPAS — F06C (revisão de 28/09, R04).
 *
 * As decisões são puras e se provam aqui; o desenho das peças também (sem
 * efeito: `renderToStaticMarkup`). O gesto — clicar, soltar, rolar — se prova
 * no navegador, em `scripts/e2e/espacos-e-arrasto.mjs` (F06C-*).
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DobraDaEtapa, InterruptorDeVazias, NavegacaoDeEtapas } from '@/board/EtapasDoQuadro';
import {
  colunasRecolhidas,
  contagemDaEtapa,
  deslocamentoAte,
  deslocamentoParaVer,
  gravarAbertas,
  interruptorUtil,
  lerAbertas,
  PREFIXO_ABERTAS,
  mostrarNavegacao,
  quantasVazias,
  tarefasDaEtapa,
} from '@/board/etapas-vazias';

/** O caso da revisão: 10 tarefas, as duas primeiras etapas vazias. */
const R04 = [
  { chave: 'a-fazer', total: 0, aVista: 0 },
  { chave: 'producao', total: 0, aVista: 0 },
  { chave: 'aprovacao', total: 1, aVista: 1 },
  { chave: 'ajustes', total: 0, aVista: 0 },
  { chave: 'enviado', total: 2, aVista: 2 },
  { chave: 'publicado', total: 7, aVista: 7 },
];
const nenhuma = new Set<string>();

describe('quais etapas recolhem', () => {
  it('as vazias de verdade, com a preferência ligada — na ordem do fluxo, nada some', () => {
    expect([...colunasRecolhidas(R04, true, nenhuma)]).toEqual(['a-fazer', 'producao', 'ajustes']);
  });

  it('desligada, nenhuma', () => {
    expect(colunasRecolhidas(R04, false, nenhuma).size).toBe(0);
  });

  it('a que a pessoa abriu à mão fica aberta', () => {
    expect([...colunasRecolhidas(R04, true, new Set(['producao']))]).toEqual(['a-fazer', 'ajustes']);
  });

  it('vazia pelo FILTRO não recolhe: tem tarefas, e a coluna diz que o filtro não achou', () => {
    const filtrada = [{ chave: 'x', total: 5, aVista: 0 }, { chave: 'y', total: 2, aVista: 2 }];
    expect(colunasRecolhidas(filtrada, true, nenhuma).size).toBe(0);
  });

  it('cartão recém-solto numa vazia (total ainda 0 até a releitura) abre a coluna na hora', () => {
    const soltou = R04.map((c) => (c.chave === 'a-fazer' ? { ...c, aVista: 1 } : c));
    expect(colunasRecolhidas(soltou, true, nenhuma).has('a-fazer')).toBe(false);
  });

  it('quadro sem tarefa nenhuma não recolhe nada — é onde se cria a primeira', () => {
    const nova = R04.map((c) => ({ ...c, total: 0, aVista: 0 }));
    expect(colunasRecolhidas(nova, true, nenhuma).size).toBe(0);
    expect(interruptorUtil(nova)).toBe(false);
  });

  it('o interruptor conta as vazias e só aparece quando muda alguma coisa', () => {
    expect(quantasVazias(R04)).toBe(3);
    expect(interruptorUtil(R04)).toBe(true);
    expect(interruptorUtil(R04.filter((c) => c.total > 0))).toBe(false);
  });
});

describe('a navegação por etapas', () => {
  it('só quando a faixa não cabe, e com três etapas ou mais', () => {
    expect(mostrarNavegacao(7, true)).toBe(true);
    expect(mostrarNavegacao(7, false)).toBe(false);
    expect(mostrarNavegacao(2, true)).toBe(false);
  });

  it('ir a uma etapa encosta a coluna na borda esquerda, sem passar dos limites', () => {
    const faixa = { left: 300, scrollLeft: 100, scrollWidth: 2000, clientWidth: 1000 };
    expect(deslocamentoAte(faixa, 800)).toBe(600);
    expect(deslocamentoAte(faixa, 100)).toBe(0);
    expect(deslocamentoAte(faixa, 5000)).toBe(1000);
  });

  it('abrir uma faixa rola só o necessário para ver a coluna inteira', () => {
    const faixa = { left: 0, right: 400, scrollLeft: 50, scrollWidth: 2000, clientWidth: 400 };
    expect(deslocamentoParaVer(faixa, { left: 100, right: 380 })).toBe(50);
    expect(deslocamentoParaVer(faixa, { left: 300, right: 580 })).toBe(230);
    // Mais larga que a faixa: começa pelo começo dela.
    expect(deslocamentoParaVer(faixa, { left: 300, right: 900 })).toBe(350);
    expect(deslocamentoParaVer(faixa, { left: -40, right: 240 })).toBe(10);
  });

  it('contagens escritas como no cabeçalho da coluna', () => {
    expect(contagemDaEtapa(3, 3)).toBe('3');
    expect(contagemDaEtapa(1, 3)).toBe('1 de 3');
    expect(tarefasDaEtapa(1, 1)).toBe('1 tarefa');
    expect(tarefasDaEtapa(0, 0)).toBe('0 tarefas');
    expect(tarefasDaEtapa(1, 3)).toBe('1 de 3 tarefas');
  });
});

describe('as peças, desenhadas', () => {
  it('a faixa recolhida é um botão que diz o que faz, com o nome em pé e o zero', () => {
    const html = renderToStaticMarkup(createElement(DobraDaEtapa, { nome: 'em produção', idDoNome: 'n1', aoAbrir: () => undefined }));
    expect(html).toContain('aria-label="Abrir a etapa em produção, vazia, 0 tarefas"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('<span class="q-dobra-nome" id="n1">em produção</span>');
    expect(html).toMatch(/q-dobra-conta[^>]*>0</);
  });

  it('o interruptor é aria-pressed e diz quantas etapas estão vazias', () => {
    const ligado = renderToStaticMarkup(createElement(InterruptorDeVazias, { ligado: true, vazias: 3, aoAlternar: () => undefined }));
    expect(ligado).toContain('aria-pressed="true"');
    expect(ligado).toContain('Recolher vazias');
    expect(ligado).toContain(', 3 etapas vazias');
    const um = renderToStaticMarkup(createElement(InterruptorDeVazias, { ligado: false, vazias: 1, aoAlternar: () => undefined }));
    expect(um).toContain('aria-pressed="false"');
    expect(um).toContain(', 1 etapa vazia');
  });

  it('a fila de atalhos: ordem do fluxo, contagem, recolhida dita e a etapa à vista marcada', () => {
    const html = renderToStaticMarkup(
      createElement(NavegacaoDeEtapas, {
        etapas: [
          { chave: 'a', nome: 'A fazer', cor: '#87909e', achadas: 0, total: 0, recolhida: true },
          { chave: 'b', nome: 'Em aprovação', cor: null, achadas: 1, total: 3, recolhida: false },
        ],
        aVista: ['b'],
        aoIr: () => undefined,
      }),
    );
    expect(html).toContain('<nav class="q-etapas" aria-label="Ir para a etapa">');
    expect(html.indexOf('A fazer')).toBeLessThan(html.indexOf('Em aprovação'));
    expect(html).toContain('aria-label="A fazer, 0 tarefas, recolhida"');
    expect(html).toContain('aria-label="Em aprovação, 1 de 3 tarefas"');
    expect(html).toMatch(/data-chave="b"[^>]*data-a-vista="true"/);
    expect(html).toMatch(/data-chave="a" data-vazia="true"/);
    expect(html).toContain('--cor-status:#87909e');
  });
});

describe('as abertas à mão voltam com a tela (ida à ficha)', () => {
  const armazem = () => {
    const m = new Map<string, string>();
    return {
      m,
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  };

  it('grava e lê de volta pela chave da tela; nenhuma apaga', () => {
    const a = armazem();
    gravarAbertas(a, '/quadro/l1', new Set(['producao']));
    expect([...lerAbertas(a, '/quadro/l1')]).toEqual(['producao']);
    expect(lerAbertas(a, '/quadro/l2').size).toBe(0);
    gravarAbertas(a, '/quadro/l1', new Set());
    expect(a.m.has(PREFIXO_ABERTAS + '/quadro/l1')).toBe(false);
  });

  it('tolera lixo, armazém negado e armazém que estoura', () => {
    const a = armazem();
    a.m.set(PREFIXO_ABERTAS + '/x', '{"nao":"lista"}');
    expect(lerAbertas(a, '/x').size).toBe(0);
    a.m.set(PREFIXO_ABERTAS + '/x', '["ok", 3, "", null]');
    expect([...lerAbertas(a, '/x')]).toEqual(['ok']);
    a.m.set(PREFIXO_ABERTAS + '/x', '{quebrado');
    expect(lerAbertas(a, '/x').size).toBe(0);
    expect(lerAbertas(null, '/x').size).toBe(0);
    const estoura = { getItem: () => { throw new Error('negado'); }, setItem: () => { throw new Error('cheio'); }, removeItem: () => undefined };
    expect(lerAbertas(estoura, '/x').size).toBe(0);
    expect(() => gravarAbertas(estoura, '/x', new Set(['a']))).not.toThrow();
  });

  it('a aberta guardada não recolhe; a que deixou de estar vazia não importa', () => {
    const fora = colunasRecolhidas(R04, true, new Set(['producao', 'aprovacao']));
    expect(fora.has('producao')).toBe(false);
    expect(fora.has('a-fazer')).toBe(true);
  });
});
