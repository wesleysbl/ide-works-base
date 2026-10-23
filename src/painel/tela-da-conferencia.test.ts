import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { BlocoDaConferencia } from '@/painel/BlocoDaConferencia';
import { CONFERENCIA_VAZIA, FRASE_DA_CONFERENCIA } from '@/painel/conferencia';
import Painel from '@/pages/Painel';

function desenhar(
  conferencia: Parameters<typeof BlocoDaConferencia>[0]['conferencia'],
  alcancaQuadro = true,
): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(BlocoDaConferencia, { conferencia, alcancaQuadro }),
    ),
  );
}

describe('o bloco da conferência no painel', () => {
  it('some quando os dois lados estão vazios — nada pendente, nada a apontar', () => {
    expect(desenhar(CONFERENCIA_VAZIA)).toBe('');
  });

  it('escreve a frase de trabalho pendente, não de erro', () => {
    const html = desenhar({
      clientesSemLista: [{ id: 'c-1', name: 'Jatobá' }],
      listasSemCliente: [],
    });
    expect(html).toContain(FRASE_DA_CONFERENCIA);
    expect(html).toContain('data-tom="info"');
    expect(html).not.toContain('data-tom="err"');
  });

  it('mostra os dois números e leva à ficha de quem está de fora', () => {
    const html = desenhar({
      clientesSemLista: [{ id: 'c-1', name: 'Jatobá' }],
      listasSemCliente: [
        { id: 'l-1', name: 'Skills', spaceName: 'TIME HELENA' },
      ],
    });
    expect(html).toContain('Clientes ativos sem lista · 1');
    expect(html).toContain('Listas de trabalho sem cliente · 1');
    expect(html).toContain('href="/cliente/c-1"');
    expect(html).toContain('Jatobá');
    expect(html).toContain('href="/quadro/l-1"');
    expect(html).toContain('Skills');
    expect(html).toContain('TIME HELENA');
  });

  it('nasce recolhido, com a soma dos dois lados no cabeçalho — F27', () => {
    // Pendência de cadastro não empurra a carteira: o painel desenha uma linha
    // só, e a lista abre no clique. `<details>` sem `open` é o "recolhido" que
    // o navegador entrega antes de qualquer efeito rodar.
    const html = desenhar({
      clientesSemLista: [{ id: 'c-1', name: 'Jatobá' }],
      listasSemCliente: [
        { id: 'l-1', name: 'Skills', spaceName: 'TIME HELENA' },
      ],
    });
    expect(html).toContain('Vínculos pendentes · 2');
    expect(html).toMatch(/<details(?![^>]*\bopen\b)[^>]*>/);
    expect(html).toContain('<summary');
  });

  it('sem a área do quadro, a lista solta aparece sem atalho', () => {
    // O atalho responderia 403; o nome da lista continua, porque é ele que
    // diz o que falta ligar.
    const html = desenhar(
      {
        clientesSemLista: [],
        listasSemCliente: [
          { id: 'l-1', name: 'Skills', spaceName: 'TIME HELENA' },
        ],
      },
      false,
    );
    expect(html).toContain('Skills');
    expect(html).not.toContain('href="/quadro/l-1"');
  });
});

/**
 * A TELA DO PAINEL NO PRIMEIRO DESENHO — F11A.
 *
 * Sem `useEffect` (a suíte desenha no servidor), a carteira não chegou: o que
 * se prova é o que o endereço já decide e a ordem da tela.
 */
const desenharPainel = (caminho: string) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [caminho] },
      createElement(Routes, null, createElement(Route, { path: '/painel', element: createElement(Painel) })),
    ),
  );

describe('F11A: a tela do painel', () => {
  it('o recorte do endereço acende o atalho e escolhe a ordem, antes de qualquer leitura', () => {
    const html = desenharPainel('/painel?urgencia=perigo&financeiro=pendente&ordem=nome&sentido=desc');
    expect(html).toMatch(/<button[^>]*class="pn-atalho"[^>]*data-tom="err"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/<button[^>]*class="pn-atalho"[^>]*data-tom="warn"[^>]*aria-pressed="false"/);
    expect(html).toMatch(/<option value="nome" selected="">/);
    expect(html).toContain('Decrescente');
  });

  it('primeira carga: esboço no lugar dos números, e nada de "0"', () => {
    const html = desenharPainel('/painel');
    expect(html).toContain('Carregando a carteira…');
    expect(html).not.toMatch(/class="pn-atalho-n tnum">\d/);
    expect(html).toContain('o-esqueleto');
  });

  it('a média se chama pelo que é: média do nível de entrega, não fração de peças', () => {
    const html = desenharPainel('/painel');
    expect(html).toContain('Média do nível de entrega · ');
    expect(html).not.toContain('Entrega contratada');
  });

  it('a ordem da tela: resumo → busca → peças e filtros (área recolhível) → carteira', () => {
    // F11A2: peças e filtros moram na área "Peças e filtros", depois da busca
    // no documento. No computador a régua das peças volta para cima da busca
    // por `order` (layout-foco.css), sem botão; no celular ela recolhe.
    const html = desenharPainel('/painel');
    const pos = ['pn-resumo', 'pn-ferramentas', 'iw-busca', 'pn-mais-botao', 'pn-mais', 'pn-tipos', 'pn-filtros', 'pn-recorte', 'pn-carteira'].map(
      (c) => html.search(new RegExp(`class="[^"]*\\b${c}\\b`)),
    );
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  });
});

describe('F11A2: a tela nomeia as dimensões', () => {
  it('os atalhos de urgência formam um grupo chamado "Urgência", marcado à mão; Financeiro fica fora', () => {
    const html = desenharPainel('/painel');
    expect(html).toMatch(/<div class="pn-urgencias" role="group" aria-labelledby="pn-urgencias-rotulo">/);
    expect(html).toContain('<span id="pn-urgencias-rotulo">Urgência</span>');
    expect(html).toContain('marcada à mão');
    expect(html).toContain('aria-label="Explicar: a urgência"');
    const fimDoGrupo = html.lastIndexOf('<button', html.indexOf('Financeiro pendente'));
    const grupo = html.slice(html.indexOf('class="pn-urgencias"'), fimDoGrupo);
    expect((grupo.match(/class="pn-atalho"/g) ?? []).length).toBe(3);
  });

  it('a área recolhível nasce fechada e o botão diz o que controla', () => {
    const html = desenharPainel('/painel?plano=pl-1&etiqueta=tg-1');
    expect(html).toMatch(/<button[^>]*class="o-btn o-btn-vidro pn-mais-botao"[^>]*aria-expanded="false"[^>]*aria-controls="pn-mais"/);
    expect(html).toMatch(/<div class="pn-mais" id="pn-mais">/);
    // Antes da primeira leitura os ids não são conferidos: os dois contam.
    expect(html).toMatch(/Peças e filtros<span class="pn-mais-n tnum">2<\/span>/);
  });

  it('nenhum "sem mês" genérico sobra na tela', () => {
    const html = desenharPainel('/painel');
    expect(html).not.toMatch(/sem mês/i);
    expect(html).not.toContain('com mês aberto');
  });
});

describe('F43 Fase 10: a carteira é uma lista de linhas', () => {
  it('primeira carga: linhas de esboço sob o cabeçalho das colunas, sem bloco emoldurado', () => {
    // A carteira deixou de ser grade de cartões (`o-card`): o esboço tem a
    // forma da linha, e o cabeçalho das colunas já nasce com o nome da
    // entrega. Ele é só visual (`aria-hidden`): cada linha diz os nomes.
    const html = desenharPainel('/painel');
    const lista = html.slice(html.indexOf('class="pn-lista"'));
    expect(lista).toMatch(/^class="pn-lista"><div class="pn-lista-cabeca" aria-hidden="true">/);
    expect(lista).toContain('Entrega do mês');
    expect((lista.match(/class="pn-cartao pn-cartao-esboco"/g) ?? []).length).toBe(3);
    const carteira = lista.slice(0, lista.indexOf('</section>'));
    expect(carteira).not.toContain('o-card');
  });

  it('nada da carteira e do "Peças e filtros" acende o verde da marca', async () => {
    // Sobras da Fase 5: a borda verde no botão filtrando, o número verde dele
    // e o atalho das renovações em letra verde. Verde é só do botão principal
    // e do lugar atual. O estado continua no atributo (`data-filtrando`).
    const html = desenharPainel('/painel?plano=pl-1');
    expect(html).toMatch(/<button[^>]*class="o-btn o-btn-vidro pn-mais-botao"[^>]*data-filtrando=""/);
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'layout-foco.css'), 'utf8');
    const painel = css.slice(css.indexOf('── O PAINEL — F11A'), css.indexOf('── FICHA DO CLIENTE — F11B'));
    expect(painel.length).toBeGreaterThan(1000);
    expect(painel).not.toMatch(/var\(--luz(-texto|-soft)?\)/);
  });
});
