/**
 * O SELETOR DE DIA — F17.42.
 *
 * O QUE ESTE ARQUIVO GUARDA
 *   A decisão desta etapa é uma AUSÊNCIA: nenhum dia nasce marcado ao criar
 *   conteúdo. Ausência não quebra teste nenhum quando volta atrás — alguém
 *   reintroduz o "padrão de hoje" para poupar um clique, tudo continua verde, e
 *   a tela volta a gravar a data errada em silêncio. É exatamente o defeito que
 *   a etapa veio consertar, e por isso ele é o primeiro caso daqui.
 *
 * ESCRITO EM `createElement`, E NÃO EM JSX
 *   A suíte só inclui `*.test.ts`. Um `.tsx` não seria executado — e teste que
 *   não roda é pior que teste nenhum, porque conta como cobertura.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CalendarioDeUmMes, SeletorDeDia } from '@/ui/SeletorDeDia';
import { casasDoMes } from '@/ui/grade-do-mes';

const MES = '2026-08';

function calendario(p: {
  mesInicial?: string;
  valor?: string | null;
  faixa?: { de: string; ate: string } | null;
  apenasNaFaixa?: boolean;
} = {}): string {
  return renderToStaticMarkup(
    createElement(CalendarioDeUmMes, {
      mesInicial: p.mesInicial ?? MES,
      valor: p.valor ?? null,
      faixa: p.faixa ?? null,
      apenasNaFaixa: p.apenasNaFaixa,
      aoEscolher: () => {},
    }),
  );
}

const quantos = (html: string, marca: string) => html.split(marca).length - 1;

describe('nenhum dia nasce marcado', () => {
  it('ao criar conteúdo, o calendário abre sem escolha nenhuma', () => {
    // A primeira versão desta etapa deixava a sugestão pré-marcada, "para se
    // trocar num clique". O usuário recusou: *"nem tem essa de um clique"*.
    expect(quantos(calendario(), 'data-escolhido="true"')).toBe(0);
  });

  it('o dia de hoje aparece como anel, e o anel não escolhe nada', () => {
    // `data-hoje` existe — é orientação. Se ele passasse a marcar o dia, o
    // caso acima cairia junto, que é o ponto de os dois estarem aqui.
    expect(calendario()).toContain('data-hoje=');
  });

  it('o item que JÁ TEM data abre com o dia dele marcado, e só ele', () => {
    const html = calendario({ valor: '2026-08-09' });
    expect(quantos(html, 'data-escolhido="true"')).toBe(1);
    expect(html).toMatch(/data-escolhido="true"[^>]*>9</);
  });
});

describe('o passado custa o mesmo que o futuro', () => {
  it('o mês anterior está a um toque', () => {
    expect(calendario()).toContain('aria-label="Mês anterior"');
    expect(calendario()).toContain('aria-label="Próximo mês"');
  });

  it('nenhum dia é recusado por ser passado', () => {
    // Lançar atrasado é o caso comum desta tela, não o desvio.
    expect(calendario()).not.toContain('disabled');
  });

  it('o item com data abre no mês DELE, e não no mês de competência', () => {
    // Item de agosto com data em julho: quem vai trocar o dia precisa ver
    // julho, senão o primeiro toque é sempre voltar um mês.
    // `julho` em minúscula: quem dá a maiúscula é o `capitalize` da folha, e
    // não o texto — é assim no seletor de data da tarefa desde a F17.
    expect(calendario({ mesInicial: MES, valor: '2026-07-14' })).toContain('julho');
  });
});

describe('a grade é a aritmética da F17.40', () => {
  it('os dias desenhados são exatamente os de `casasDoMes`', () => {
    const html = calendario();
    const dias = casasDoMes(MES).filter((d): d is string => d !== null);
    expect(dias.length).toBe(31);
    for (const dia of dias) expect(html).toContain(`>${Number(dia.slice(8, 10))}<`);
    // E nenhuma casa a mais: 31 botões de dia, nem 35 nem 42.
    expect(quantos(html, 'class="cu-cal-dia"')).toBe(31);
  });

  it('nada aqui passa por `toISOString`', () => {
    // Existe tarefa real com prazo `82025-08-07`, e `toISOString` devolve
    // `+082025-08-07` — todo `slice(0, 10)` cortaria errado.
    // Sem os comentários: o cabeçalho do arquivo EXPLICA a armadilha, e a
    // explicação não pode fazer a guarda falhar.
    const fonte = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'SeletorDeDia.tsx'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(fonte).not.toContain('toISOString');
    expect(fonte).not.toMatch(/new Date\(/);
  });
});

describe('a faixa orienta, e não escolhe', () => {
  const faixa = { de: '2026-08-03', ate: '2026-08-09' };

  it('marca os dias da semana que abriu o seletor', () => {
    expect(quantos(calendario({ faixa }), 'data-faixa="true"')).toBe(7);
  });

  it('não marca o dia já escolhido — a regra dela vence a dele na folha', () => {
    const html = calendario({ faixa, valor: '2026-08-05' });
    expect(quantos(html, 'data-faixa="true"')).toBe(6);
    expect(quantos(html, 'data-escolhido="true"')).toBe(1);
  });
});

describe('a faixa que LIMITA — F35 (o + da aba Semana)', () => {
  const faixa = { de: '2026-08-03', ate: '2026-08-09' };

  it('sem pedir, nenhum dia fica desabilitado — a ficha continua livre', () => {
    expect(quantos(calendario({ faixa }), 'disabled=""')).toBe(0);
  });

  it('com `apenasNaFaixa`, só os 7 dias da semana ficam clicáveis', () => {
    const html = calendario({ faixa, apenasNaFaixa: true });
    expect(quantos(html, 'disabled=""')).toBe(31 - 7);
    expect(html).toMatch(/data-faixa="true"(?![^>]*disabled)[^>]*>3</);
    // E continua sem dia marcado: limitar não é sugerir.
    expect(quantos(html, 'data-escolhido="true"')).toBe(0);
  });
});

describe('o balão tem as três saídas da F17.33', () => {
  it('título e X', () => {
    const html = renderToStaticMarkup(
      createElement(SeletorDeDia, {
        rotulo: 'Escolher o dia',
        mesInicial: MES,
        ancora: null,
        aoEscolher: () => {},
        aoFechar: () => {},
      }),
    );
    // O título vem de `Balao`, e é ele que traz o `X` junto. `Esc` e clique
    // fora são efeito, e por isso vivem em `menus.tsx`, não aqui.
    expect(html).toContain('cu-balao-titulo');
    expect(html).toContain('aria-label="Fechar"');
    expect(html).toContain('Escolher o dia');
  });
});
