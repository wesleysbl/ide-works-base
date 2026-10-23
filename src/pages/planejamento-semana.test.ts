/**
 * A aba Semana do Planejamento — F35, Fase 3.
 *
 * Desenha `GradeDaSemana` no servidor (`renderToStaticMarkup`, sem efeito
 * nenhum) com um mês e um HOJE fixos: outubro de 2026, hoje 07/10 — semana 2
 * (05–11 out). As semanas de outubro/2026: 01–04, 05–11, 12–18, 19–25, 26–31.
 *
 * Fixture: Ana e Bruno são responsáveis; Alfa é dos dois; Beta é só da Ana e
 * está em risco (cota de 2 vídeos dá meta 1 na semana 2, sem peça agendada);
 * Gama não tem responsável nem cota.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { type ClienteDaSemana, EXPLICACAO, GradeDaSemana, SOBRE } from '@/painel/GradeDaSemana';

const ANA = { id: 'u-ana', name: 'Ana' };
const BRUNO = { id: 'u-bruno', name: 'Bruno' };

const cliente = (p: Partial<ClienteDaSemana> & Pick<ClienteDaSemana, 'id' | 'name'>): ClienteDaSemana => ({
  categoryId: 'cat',
  categoryName: 'Ide',
  plan: null,
  owners: [],
  quotaSource: 'contrato',
  quota: {},
  hasContentContract: true,
  items: [],
  ...p,
});

const ALFA = cliente({
  id: 'c-alfa',
  name: 'Alfa',
  owners: [ANA, BRUNO],
  quota: { arte: 4 },
  items: [
    // Concluída na semana 2: a semana bate (meta 1).
    { id: 'p1', contentType: 'arte', scheduledAt: '2026-10-06T12:00:00Z', completedAt: '2026-10-06T15:00:00Z', isExtra: false, title: 'Post do dia' },
    // Sem dia: não entra em semana, vira "+1 sem dia".
    { id: 'p2', contentType: 'arte', scheduledAt: null, completedAt: null, isExtra: false, title: null },
    // Vídeo sem cota de vídeo: sublinha "Vídeo (extra)".
    { id: 'p3', contentType: 'video', scheduledAt: '2026-10-13T12:00:00Z', completedAt: null, isExtra: true, title: 'Reels' },
  ],
});

const BETA = cliente({ id: 'c-beta', name: 'Beta', owners: [ANA], quota: { video: 2 } });

const GAMA = cliente({
  id: 'c-gama',
  name: 'Gama',
  quotaSource: 'nenhuma',
  hasContentContract: false,
  items: [{ id: 'p9', contentType: 'arte', scheduledAt: '2026-10-02T12:00:00Z', completedAt: null, isExtra: true, title: 'Avulsa' }],
});

const desenhar = (clientes: ClienteDaSemana[], hoje = '2026-10-07') =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(GradeDaSemana, { mes: '2026-10', hoje, clientes, aoAbrirPeca: () => {} }),
    ),
  );

/** Os blocos `<tbody>` de cada grupo, em ordem. */
const grupos = (html: string) =>
  [...html.matchAll(/<tbody class="pls-grupo" data-grupo="([^"]+)">([\s\S]*?)<\/tbody>/g)].map((m) => ({
    id: m[1],
    html: m[2],
  }));

/** Os ids de cliente na ordem em que aparecem (uma vez por cliente). */
const clientesEm = (html: string) => [
  ...new Set([...html.matchAll(/data-cliente="([^"]+)"/g)].map((m) => m[1])),
];

describe('GradeDaSemana — agrupamento por responsável', () => {
  const html = desenhar([ALFA, BETA, GAMA]);
  const gs = grupos(html);

  it('um grupo por responsável, pelo nome, e "Sem responsável" no fim', () => {
    expect(gs.map((g) => g.id)).toEqual(['u-ana', 'u-bruno', 'sem-responsavel']);
  });

  it('o cliente de dois responsáveis aparece nos dois grupos', () => {
    expect(clientesEm(gs[0].html)).toContain('c-alfa');
    expect(clientesEm(gs[1].html)).toContain('c-alfa');
  });

  it('o cabeçalho do grupo diz quantos clientes e quantos em risco', () => {
    expect(gs[0].html).toContain('Ana (2 clientes) · <span data-tom="warn">1 em risco</span>');
    expect(gs[1].html).toContain('Bruno (1 cliente) · <span>0 em risco</span>');
    expect(gs[2].html).toContain('Sem responsável (1 cliente)');
  });

  it('dentro do grupo, o cliente em risco vem antes, mesmo fora da ordem alfabética', () => {
    expect(clientesEm(gs[0].html)).toEqual(['c-beta', 'c-alfa']);
    expect(gs[0].html).toMatch(/data-cliente="c-beta"[^>]*data-marca="risco"/);
  });

  it('o total do topo conta o cliente compartilhado uma vez só', () => {
    expect(html).toContain('3 clientes</span>');
    expect(html).toMatch(/<span class="tnum" data-tom="warn">1 em risco<\/span>/);
  });
});

describe('GradeDaSemana — sem cota, extra e sem dia', () => {
  const html = desenhar([ALFA, BETA, GAMA]);
  const gama = grupos(html)[2].html;

  it('cliente sem cota é uma linha só, "sem cota", sem cor de atraso nem placar', () => {
    expect(gama.match(/<tr class="pls-linha"/g)).toHaveLength(1);
    expect(gama).toContain('sem cota');
    expect(gama).not.toMatch(/data-estado="(risco|abaixo|bateu)"/);
    expect(gama).not.toContain('pls-placar');
    // A peça avulsa continua lá, e clicável.
    expect(gama).toMatch(/<button[^>]*class="pls-sinal"[^>]*data-sinal="atrasada"/);
  });

  it('tipo sem cota vira sublinha "(extra)" sem meta', () => {
    const ana = grupos(html)[0].html;
    expect(ana).toContain('Vídeo (extra)');
    const linhaExtra = ana.match(/<tr[^>]*data-cliente="c-alfa"[^>]*>(?:(?!<\/tr>)[\s\S])*Vídeo \(extra\)[\s\S]*?<\/tr>/)?.[0] ?? '';
    expect(linhaExtra).toContain('Vídeo (extra)');
    expect(linhaExtra).not.toMatch(/pls-placar tnum">\d+\/\d+/);
    expect(linhaExtra).toContain('0 feitas');
  });

  it('a sublinha "(extra)" vem depois dos tipos com cota', () => {
    const ana = grupos(html)[0].html;
    expect(ana.indexOf('>Arte<')).toBeLessThan(ana.indexOf('Vídeo (extra)'));
  });

  it('a peça sem dia aparece só na coluna Mês, como "+N sem dia"', () => {
    expect(html).toContain('+1 sem dia');
  });
});

describe('GradeDaSemana — célula, sinais e semana atual', () => {
  const html = desenhar([ALFA, BETA, GAMA]);

  it('a semana que contém hoje é marcada no cabeçalho e nas células', () => {
    expect(html).toMatch(/<th scope="col" class="pls-cabeca pls-semana" data-atual="true" aria-current="date"><span class="pls-semana-n">Semana 2<\/span>/);
    expect(html).toMatch(/<td class="pls-celula" data-estado="[a-z]+" data-atual="true">/);
  });

  it('a célula mostra os sinais e feito/meta; o hover diz título e dia', () => {
    expect(html).toMatch(/title="Post do dia · 06\/10 · concluída"[^>]*>✓<\/button>/);
    expect(html).toContain('<span class="pls-placar tnum">1/1</span>');
  });

  it('vaga sem peça aparece como "·" e a semana sem agendamento fica em risco', () => {
    const beta = html.match(/<tr[^>]*data-cliente="c-beta"[\s\S]*?<\/tr>/)?.[0] ?? '';
    expect(beta).toMatch(/data-estado="risco" data-atual="true"/);
    expect(beta).toContain('data-sinal="vaga"');
    expect(beta).toContain('<span class="pls-placar tnum">0/1</span>');
  });

  it('mês que não contém hoje não marca semana atual', () => {
    expect(desenhar([ALFA], '2026-11-15')).not.toContain('data-atual');
  });
});

describe('GradeDaSemana — o + da célula (Fase 4)', () => {
  const BLUESKY = cliente({ id: 'c-blue', name: 'Bluesky', owners: [ANA], quota: { arte: 8 } });
  const comMais = (clientes: ClienteDaSemana[]) =>
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(GradeDaSemana, {
          mes: '2026-10',
          hoje: '2026-10-07',
          clientes,
          aoAbrirPeca: () => {},
          aoCriar: () => {},
        }),
      ),
    );

  it('cada célula com tipo tem um + com o rótulo "Criar arte na semana 2 de Bluesky"', () => {
    const html = comMais([BLUESKY]);
    expect(html).toContain('aria-label="Criar arte na semana 2 de Bluesky"');
    // Uma por semana de outubro/2026 (cinco).
    expect(html.match(/class="pls-mais"/g)).toHaveLength(5);
    expect(html).toMatch(/<button type="button" class="pls-mais" aria-label="Criar arte na semana 1 de Bluesky"[^>]*aria-haspopup="dialog"[^>]*>\+<\/button>/);
  });

  it('a sublinha "(extra)" também cria, do tipo dela', () => {
    expect(comMais([ALFA])).toContain('aria-label="Criar vídeo na semana 3 de Alfa"');
  });

  it('cliente sem cota (linha única, sem tipo) não tem +', () => {
    expect(comMais([GAMA])).not.toContain('pls-mais');
  });

  it('sem `aoCriar` a grade é só leitura: nenhum +', () => {
    expect(desenhar([BLUESKY])).not.toContain('pls-mais');
  });

  it('com uma criação em curso, os + ficam desabilitados', () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(GradeDaSemana, {
          mes: '2026-10',
          hoje: '2026-10-07',
          clientes: [BLUESKY],
          aoAbrirPeca: () => {},
          aoCriar: () => {},
          ocupado: true,
        }),
      ),
    );
    expect(html.match(/class="pls-mais"[^>]*disabled=""/g)).toHaveLength(5);
  });
});

describe('a folha do + (Fase 4)', () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../ui/layout-foco.css'), 'utf8');

  it('o + some só onde há ponteiro fino, e volta no hover da célula', () => {
    const bloco = css.match(/@media \(hover: hover\) and \(pointer: fine\) \{([^}]*\}[^}]*\}[^}]*\})/)?.[1] ?? '';
    expect(bloco).toContain('.pls-mais { opacity: 0; }');
    expect(bloco).toContain('.pls-celula:hover .pls-mais');
  });

  it('fora daquele bloco o + não é escondido (no toque fica à vista)', () => {
    const fora = css.replace(/@media \(hover: hover\) and \(pointer: fine\) \{[^}]*\}[^}]*\}[^}]*\}/g, '');
    expect(fora).not.toMatch(/\.pls-mais[^{]*\{[^}]*(opacity: 0;|display: none)/);
  });
});

describe('os "?" da aba Semana (Fase 5)', () => {
  const html = desenhar([ALFA, BETA, GAMA]);

  it('os cinco "?" estão presentes, cada um com `aria-label="Explicar: …"`', () => {
    for (const sobre of [SOBRE.aba, SOBRE.semana, SOBRE.emRisco, SOBRE.mes, SOBRE.semCota]) {
      expect(html).toContain(`aria-label="Explicar: ${sobre}"`);
    }
    // F43 Fase 2: a aba Semana virou a visão Semanas — o `?` usa o nome novo.
    expect(html).toContain('aria-label="Explicar: a visão Semanas"');
    expect(html).toContain('aria-label="Explicar: a meta de cada semana"');
    expect(html).toContain('aria-label="Explicar: em risco"');
    expect(html).toContain('aria-label="Explicar: a coluna Mês"');
    expect(html).toContain('aria-label="Explicar: sem cota"');
  });

  it('são cinco e só cinco — nada de um "?" por linha ou por semana', () => {
    expect(html.match(/aria-label="Explicar: /g)).toHaveLength(5);
    // E cada um dentro do invólucro desta aba, que a folha esconde no toque.
    expect(html.match(/<span class="pls-ajuda"><button type="button" class="cu-ajuda"/g)).toHaveLength(5);
  });

  it('o da meta mora no cabeçalho da semana 1; o do Mês, no cabeçalho do Mês', () => {
    expect(html).toMatch(/<span class="pls-semana-n">Semana 1<span class="pls-ajuda"><button[^>]*aria-label="Explicar: a meta de cada semana"/);
    expect(html).toMatch(/<th scope="col" class="pls-cabeca pls-mes">Mês<span class="pls-ajuda"><button[^>]*aria-label="Explicar: a coluna Mês"/);
  });

  it('"em risco" e "sem cota" se explicam na legenda', () => {
    const legenda = html.match(/<ul class="pls-legenda"[\s\S]*?<\/ul>/)?.[0] ?? '';
    expect(legenda).toContain('aria-label="Explicar: em risco"');
    expect(legenda).toContain('aria-label="Explicar: sem cota"');
  });

  it('o da aba fica fora do `role="status"`', () => {
    const status = html.match(/<p class="pls-total" role="status">[\s\S]*?<\/p>/)?.[0] ?? '';
    expect(status).not.toContain('Explicar');
  });

  it('fechados, os textos não ocupam a grade', () => {
    for (const texto of Object.values(EXPLICACAO)) expect(html).not.toContain(texto);
  });

  it('os textos dizem de onde vem o número', () => {
    expect(EXPLICACAO.semana).toContain('dividida pelos dias úteis de cada semana');
    expect(EXPLICACAO.mes).toContain('cota do contrato do mês');
    expect(EXPLICACAO.semCota).toContain('não entra na conta de atraso');
  });
});

describe('a folha dos "?" (Fase 5)', () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../ui/layout-foco.css'), 'utf8');
  const blocos = [...css.matchAll(/@media \(hover: hover\) and \(pointer: fine\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]);

  it('o "?" novo só aparece dentro de `@media (hover: hover) and (pointer: fine)`', () => {
    expect(blocos.some((b) => b.includes('.pls-ajuda { display: inline-flex;'))).toBe(true);
  });

  it('fora daquele bloco ele começa escondido (no toque some)', () => {
    let fora = css;
    for (const b of blocos) fora = fora.replace(b, '');
    expect(fora).toMatch(/\.pls-ajuda \{ display: none; \}/);
    expect(fora).not.toMatch(/\.pls-ajuda[^{]*\{[^}]*display: inline/);
  });

  it('os ~30 "?" do resto do app não foram escondidos: `.cu-ajuda` não ganhou `display: none`', () => {
    // Sem os comentários, que citam `.cu-ajuda` em prosa; e a regra inteira
    // (seletor `{` corpo `}`), para não casar de uma regra até a seguinte.
    const regras = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+\{[^{}]*\}/g) ?? [];
    const daAjuda = regras.filter((r) => /\.cu-ajuda(?![-\w])/.test(r.split('{')[0]));
    expect(daAjuda.filter((r) => r.includes('display: none'))).toEqual([]);
  });

  it('o + não desce para outra linha: a célula não quebra', () => {
    expect(css).toMatch(/\.pls-celula-dentro \{[^}]*flex-wrap: nowrap/);
  });
});
