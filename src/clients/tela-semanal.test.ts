/**
 * A GRADE SEMANAL DEPOIS QUE O DIA DEIXOU DE SER ADIVINHADO — F17.42.
 *
 * O QUE ESTE ARQUIVO GUARDA
 *   Que os três caminhos que precisam de um dia — criar, datar o que não tem
 *   dia e trocar o dia do que já tem — passam pelo calendário, e que nenhum
 *   deles voltou a escolher o dia sozinho.
 *
 *   O caminho inteiro (clique → HTTP → Postgres) é `scripts/provar-o-dia.mjs`,
 *   que fala com o banco de verdade. Os dois juntos cobrem a etapa; nenhum dos
 *   dois sozinho.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { type ItemDaGrade, Semanal } from '@/clients/Semanal';
import { CONTENT_TYPES, type ContentType } from '@/delivery/level';

const FONTE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'Semanal.tsx'),
  'utf8',
);

/** Onde a convenção do meio-dia mora desde a F17.44 — ver o teste lá embaixo. */
const CONVENCAO = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'grade-do-mes.ts'),
  'utf8',
);

/** Sem comentário nenhum: o cabeçalho CONTA o que morreu, e contar não é fazer. */
const CODIGO = FONTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const item = (p: Partial<ItemDaGrade> = {}): ItemDaGrade => ({
  id: 'i1',
  contentType: 'video',
  scheduledAt: '2026-08-09T12:00:00Z',
  completedAt: null,
  isExtra: false,
  title: null,
  ...p,
});

const contratado = Object.fromEntries(CONTENT_TYPES.map((t) => [t, 2])) as Record<
  ContentType,
  number
>;

const tela = (itens: ItemDaGrade[]) =>
  renderToStaticMarkup(
    createElement(Semanal, {
      clienteId: 'c1',
      mes: '2026-08',
      itens,
      contratado,
      mesAberto: true,
      aoMudar: () => {},
    }),
  );

describe('o dia não se adivinha mais', () => {
  it('a função que chutava hoje não existe mais', () => {
    // Ela dizia, no comentário: "é o que a pessoa quer dizer ao clicar `+` na
    // semana corrente". Não era — quem opera esta tela lança o que já
    // aconteceu, muitas vezes atrasado.
    expect(CODIGO).not.toContain('diaSugerido');
  });

  it('a tela não lê o relógio para decidir data nenhuma', () => {
    expect(CODIGO).not.toMatch(/new Date\(/);
  });

  it('o meio-dia continua sendo o meio-dia, num lugar só', () => {
    // Meio-dia é de propósito: com hora cheia o dia vira conforme o fuso.
    // Um lugar só porque três caminhos gravam data, e três cópias divergem.
    //
    // ⚠️ O LUGAR MUDOU NA F17.44, e o teste seguiu junto: agora são QUATRO
    // caminhos que gravam data — os três desta tela e o calendário, que passou
    // a criar entrega. A convenção mora em `@/ui/grade-do-mes`, e esta tela a
    // pede emprestada; o que o teste continua guardando é que ela é UMA.
    expect(FONTE.split('T12:00:00Z').length - 1).toBe(0);
    expect(FONTE).toContain('const noDia = meioDiaDoDia;');
    expect(CONVENCAO.split('T12:00:00Z').length - 1).toBe(1);
  });
});

describe('a fila principal é o que ainda não tem dia', () => {
  it('item sem dia oferece o calendário, e não uma semana pronta', () => {
    const html = tela([item({ scheduledAt: null })]);
    expect(html).toContain('Escolher o dia');
    // `S1 S2 S3 S4` jogava o item num dia escolhido pelo sistema.
    expect(html).not.toContain('colocar na');
    expect(html).not.toMatch(/>S\d</);
  });

  it('o que já tem dia pode trocar de dia sem ser apagado e refeito', () => {
    const html = tela([item()]);
    expect(html).toContain('Trocar o dia');
    // E marcar como feito continua sendo um clique no dia, como sempre foi.
    expect(html).toContain('clique para marcar como feito');
  });

  it('o `+` avisa que vai perguntar o dia, em vez de criar calado', () => {
    expect(tela([])).toContain('escolher o dia');
  });
});

describe('a luz do tipo não pinta letra pequena', () => {
  it('a letra da pastilha do dia fica na platina — régua da F17.37', () => {
    // A 10,6px a luz como tinta mede 2,43 no pior caso, e a régua pede 7:1.
    expect(CODIGO).not.toMatch(/color:\s*feito\s*\?\s*cor/);
    expect(CODIGO).toContain("color: feito ? 'var(--plat)' : 'var(--plat-dim)'");
  });

  // F43 Fase 5 — MUDOU DE PROPÓSITO. Até aqui a feita levava a luz do tipo no
  // contorno e no fundo (o que este teste chegou a exigir). A camada calma
  // tirou o contorno e trocou o fundo pelo "ok" calmo: a cor do tipo fica no
  // ícone e na barra do tipo, e a pastilha diz só "feito" ou "a fazer".
  it('a pastilha do dia não tem contorno do tipo, e a feita é o "ok" calmo', () => {
    expect(CODIGO).not.toMatch(/borderColor:\s*feito\s*\?\s*cor/);
    expect(CODIGO).not.toMatch(/color-mix\(in srgb, \$\{cor\}/);
    expect(CODIGO).toContain("? 'var(--ok-soft)'");
  });
});

describe('achar a semana e o item — F11C', () => {
  const comHoje = (itens: ItemDaGrade[], hoje: string | null) =>
    renderToStaticMarkup(
      createElement(Semanal, {
        clienteId: 'c1',
        mes: '2026-08',
        itens,
        contratado,
        mesAberto: true,
        hoje,
        aoMudar: () => {},
      }),
    );

  it('a pastilha do dia se chama pelo item (tipo, título e dia), não pelo número do dia', () => {
    const html = comHoje(
      [
        item({ id: 'a', title: 'Bastidores', scheduledAt: '2026-08-12T12:00:00Z' }),
        item({ id: 'b', title: 'Bastidores', scheduledAt: '2026-08-12T12:00:00Z' }),
      ],
      null,
    );
    expect(html).toContain('aria-label="Vídeo “Bastidores”, dia 12/08 (1 de 2)"');
    expect(html).toContain('aria-label="Vídeo “Bastidores”, dia 12/08 (2 de 2)"');
    expect(html).toContain('aria-pressed="false"');
  });

  it('um atalho por semana, com o que falta, e outro para o que não tem dia', () => {
    const html = comHoje(
      [item({ id: 'a', scheduledAt: '2026-08-12T12:00:00Z' }), item({ id: 'b', scheduledAt: null })],
      null,
    );
    expect(html).toContain('aria-label="Ir para a semana"');
    expect(html).toContain('1 a fazer');
    expect(html).toMatch(/<b>Sem dia<\/b>/);
    expect(html).toContain('id="cl-sem-dia"');
  });

  it('a semana de hoje acende — só com o dia vindo de fora, e só dentro do mês', () => {
    const dentro = comHoje([], '2026-08-12');
    expect(dentro).toContain('aria-current="date"');
    expect(dentro).toContain('>agora<');
    const fora = comHoje([], '2026-09-12');
    expect(fora).not.toContain('aria-current="date"');
  });

  it('a peça das 22h do último dia do mês fica no mês e na última semana — dia de São Paulo, não de UTC', () => {
    // 22h de 31/08 em São Paulo chega como 01h de 01/09 em UTC. Com o recorte
    // por `slice(0, 10)` ela virava "com dia em outro mês" e sumia da semana.
    const html = comHoje([item({ id: 'a', title: 'Noturna', scheduledAt: '2026-09-01T01:00:00.000Z' })], null);
    expect(html).not.toContain('com dia em outro mês');
    expect(html).toContain('aria-label="Vídeo “Noturna”, dia 31/08"');
  });

  it('cada item aparece uma vez só: com dia na semana, sem dia na fila', () => {
    const html = comHoje(
      [item({ id: 'a', title: 'Com dia', scheduledAt: '2026-08-12T12:00:00Z' }), item({ id: 'b', title: 'Sem dia', scheduledAt: null })],
      null,
    );
    expect(html.split('aria-label="Vídeo “Com dia”, dia 12/08"').length - 1).toBe(1);
    expect(html.split('Escolher o dia — Vídeo “Sem dia”, sem data').length - 1).toBe(1);
  });
});
