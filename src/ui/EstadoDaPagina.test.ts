/**
 * OS ESTADOS DE UMA ÁREA — F03 do plano UX (§6 da especificação).
 *
 * O critério da fase: nulo (carregando), zero (vazio) e erro são DISTINTOS na
 * tela e na leitura acessível. Aqui se prova a leitura — papel vivo de cada
 * um, a frase, a ação — e que filtro sem resultado não se passa por vazio.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { EstadoDaPagina } from '@/ui/EstadoDaPagina';

const desenhar = (props: Parameters<typeof EstadoDaPagina>[0]) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(EstadoDaPagina, props)));

const nada = () => undefined;

describe('EstadoDaPagina', () => {
  it('carregando: status educado, a frase lida, o esqueleto escondido do leitor — e nenhum zero', () => {
    const html = desenhar({ tipo: 'carregando' });
    expect(html).toMatch(/<div class="iw-estado" data-estado="carregando" role="status">/);
    expect(html).toContain('>Carregando…</span>');
    expect(html).toMatch(/<div class="iw-esqueleto" aria-hidden="true">/);
    expect(html.match(/iw-esqueleto-linha/g)).toHaveLength(3);
    expect(html).not.toMatch(/>0</);
    expect(html).not.toContain('role="alert"');
  });

  it('vazio: conteúdo da página, sem papel vivo, com a ação permitida', () => {
    const html = desenhar({ tipo: 'vazio', titulo: 'Nenhuma tarefa ao seu alcance', acao: { rotulo: 'Ver quadros', para: '/quadro' } });
    expect(html).toContain('data-estado="vazio"');
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain('>Nenhuma tarefa ao seu alcance</p>');
    expect(html).toMatch(/<a class="o-btn[^"]*iw-estado-acao"[^>]*href="\/quadro"[^>]*>Ver quadros<\/a>/);
  });

  it('filtro sem resultado: é anunciado (resposta ao que a pessoa fez) e oferece limpar — não é "vazio"', () => {
    const html = desenhar({ tipo: 'sem-resultado', titulo: 'Nenhuma tarefa com este filtro', acao: { rotulo: 'Limpar filtro', aoClicar: nada } });
    expect(html).toContain('data-estado="sem-resultado"');
    expect(html).toContain('role="status"');
    expect(html).toMatch(/<button type="button" class="o-btn[^"]*">Limpar filtro<\/button>/);
    expect(html).not.toContain('data-estado="vazio"');
  });

  it('sem acesso: explica, sem papel vivo', () => {
    const html = desenhar({ tipo: 'sem-acesso', titulo: 'Esta lista não está ao seu alcance' });
    expect(html).toContain('data-estado="sem-acesso"');
    expect(html).not.toMatch(/role="(status|alert)"/);
  });

  it('erro: é o `Aviso` (alerta) com a frase do servidor e Tentar de novo', () => {
    const html = desenhar({ tipo: 'erro', titulo: 'Não foi possível carregar.', acao: { rotulo: 'Tentar de novo', aoClicar: nada } });
    expect(html).toContain('data-estado="erro"');
    expect(html).toMatch(/role="alert" class="o-alerta" data-tom="err"/);
    expect(html).toContain('Não foi possível carregar.');
    expect(html).toContain('>Tentar de novo</button>');
  });

  it('os cinco são distinguíveis pelo `data-estado` e pelo papel', () => {
    const leitura = (['carregando', 'vazio', 'sem-resultado', 'sem-acesso', 'erro'] as const).map((tipo) => {
      const html = desenhar({ tipo, titulo: 'x' });
      return `${/data-estado="([^"]+)"/.exec(html)?.[1]}:${/role="(status|alert)"/.exec(html)?.[1] ?? '-'}`;
    });
    expect(leitura).toEqual(['carregando:status', 'vazio:-', 'sem-resultado:status', 'sem-acesso:-', 'erro:alert']);
  });
  it('F06C: duas saídas lado a lado — botão e link, cada uma com o seu nome', () => {
    const html = desenhar({
      tipo: 'vazio',
      titulo: 'Nada pendente com você',
      acao: [
        { rotulo: 'Ver delegadas (2)', aoClicar: nada },
        { rotulo: 'Todas as tarefas', para: '/tarefas' },
      ],
    });
    expect(html).toContain('class="iw-estado-acao iw-estado-acoes"');
    expect(html).toContain('>Ver delegadas (2)</button>');
    expect(html).toMatch(/<a [^>]*href="\/tarefas"[^>]*>Todas as tarefas<\/a>/);
  });

  it('F06C: no erro, uma lista de ações vale só pelo primeiro botão', () => {
    const html = desenhar({
      tipo: 'erro',
      titulo: 'Falhou.',
      acao: [{ rotulo: 'Ir', para: '/x' }, { rotulo: 'Tentar de novo', aoClicar: nada }],
    });
    expect(html).toContain('>Tentar de novo</button>');
    expect(html).not.toContain('href="/x"');
  });
});
