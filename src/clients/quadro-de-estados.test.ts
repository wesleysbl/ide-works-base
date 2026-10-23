/**
 * O Kanban das listas da ficha do cliente — F18C (R09). Desenho estático: as
 * colunas são os estados passados (nada inventado), cada cartão é focável e
 * diz que as setas o movem, e coluna sem item diz a frase dela.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { QuadroDeEstados } from '@/clients/QuadroDeEstados';

type Item = { id: string; titulo: string };

const desenhar = (ocupados?: Set<string>) =>
  renderToStaticMarkup(
    createElement(QuadroDeEstados<Item>, {
      rotulo: 'Demandas por estado',
      colunas: [
        { chave: 'pendentes', nome: 'Pendentes', cor: 'var(--hair-3)', itens: [{ id: 'd1', titulo: 'Briefing' }], aceita: true, vazia: 'Nada pendente.' },
        { chave: 'concluidas', nome: 'Concluídas', cor: 'var(--luz)', itens: [], aceita: true, vazia: 'Nenhuma concluída.' },
      ],
      idDoItem: (i: Item) => i.id,
      nomeDoItem: (i: Item) => i.titulo,
      desenhar: (i: Item) => createElement('span', { className: 'x' }, i.titulo),
      ocupados,
      aoMover: () => {},
    }),
  );

describe('QuadroDeEstados', () => {
  it('uma coluna por estado passado, na ordem, com nome e contagem', () => {
    const html = desenhar();
    expect(html).toContain('role="group" aria-label="Demandas por estado"');
    expect([...html.matchAll(/class="q-coluna-nome[^"]*"[^>]*>([^<]+)</g)].map((m) => m[1])).toEqual(['Pendentes', 'Concluídas']);
    expect(html).toContain('data-estado="pendentes"');
    expect(html).toContain('--cor-status:var(--luz)');
  });

  it('o cartão arrasta, é focável e anuncia a alternativa pelas setas', () => {
    const html = desenhar();
    expect(html).toMatch(/<li data-item="d1" class="q-cartao cl-cartao" draggable="true"[^>]*tabindex="0"/);
    expect(html).toContain('aria-label="Briefing. Use as setas para a esquerda e para a direita para mudar de coluna."');
  });

  it('coluna vazia diz a frase dela; cartão esperando o servidor não arrasta', () => {
    expect(desenhar()).toContain('<li class="cl-estado-vazio">Nenhuma concluída.</li>');
    expect(desenhar(new Set(['d1']))).toMatch(/data-item="d1"[^>]*draggable="false"[^>]*data-salvando="true"/);
  });
});
