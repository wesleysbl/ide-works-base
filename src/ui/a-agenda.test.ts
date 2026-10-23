/**
 * O CALENDÁRIO VIRA AGENDA — F17.44.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA SUÍTE GUARDA, E O QUE ELA NÃO ALCANÇA
 *
 *   Aqui mora o que se prova sem banco e sem navegador: o vocabulário das duas
 *   naturezas, a cor que as distingue, a validação que recusa hora inventada e
 *   o desenho do primeiro quadro da grade.
 *
 *   ⚠️ A ASSERÇÃO CENTRAL DA ETAPA — *"compromisso NÃO entra na cota"* — é
 *   medida em `scripts/provar-a-agenda.mjs`, que fala com o banco e com o
 *   Worker de verdade, cria um compromisso e compara a cota antes e depois. Ela
 *   não cabe aqui porque "não mudou" só significa alguma coisa quando o mesmo
 *   instrumento consegue medir uma mudança — e a mudança é criar uma entrega.
 *
 *   O que cabe aqui, e é o pé desse tripé, é a rede de baixo: se algum dia um
 *   compromisso for empurrado para dentro do medidor, ele RECUSA em vez de
 *   contar. Ver o último bloco.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { UnknownContentType, calculateDeliveryLevel } from '@/delivery/level';
import { AppointmentRefused, validarCompromisso } from '@/server/appointments';
import { GradeDoMes } from '@/ui/GradeDoMes';
import {
  COR_DO_COMPROMISSO,
  type EntradaDoMes,
  corDaEntrada,
  detalheDaEntrada,
  ehCompromisso,
  janelaDoMes,
  meioDiaDoDia,
  mesDoDia,
  rotuloDaEntrada,
} from '@/ui/grade-do-mes';

const entrega = (p: Partial<EntradaDoMes> = {}): EntradaDoMes => ({
  kind: 'delivery',
  id: 'i1',
  clientId: 'c1',
  clientName: 'Padaria do Zé',
  contentType: 'video',
  day: '2026-08-12',
  time: null,
  title: 'Bastidores',
  isExtra: false,
  isCompleted: false,
  notes: null,
  ...p,
});

const compromisso = (p: Partial<EntradaDoMes> = {}): EntradaDoMes =>
  entrega({
    kind: 'appointment',
    id: 'a1',
    contentType: '',
    time: '14:30',
    title: 'Gravação na loja',
    ...p,
  });

/* ───────────────── as duas naturezas se leem diferente ───────────────── */

describe('entrega e compromisso não se confundem na tela', () => {
  it('a pastilha do compromisso mostra o NOME dele, e não a palavra "Compromisso"', () => {
    // Quem marcou "Gravação na loja" quer ler "Gravação na loja". Uma palavra
    // de categoria roubaria o espaço da única informação da pastilha.
    expect(rotuloDaEntrada(compromisso(), 'de-um-cliente')).toBe('Gravação na loja');
  });

  it('de fora do cliente, o nome do cliente vem junto', () => {
    expect(rotuloDaEntrada(compromisso(), 'de-todos')).toBe('Padaria do Zé · Gravação na loja');
  });

  it('a palavra "Compromisso" aparece no detalhe, que é onde ela cabe', () => {
    const d = detalheDaEntrada(compromisso({ notes: 'Levar o tripé' }), 'de-um-cliente');
    expect(d).toBe('Compromisso · 14:30 · Gravação na loja · Levar o tripé');
  });

  it('compromisso nunca leva marca de extra — extra é vocabulário de cota', () => {
    // `isExtra` existe no tipo porque a grade desenha as duas coisas com a
    // mesma peça, mas o servidor manda sempre `false`, e o detalhe não o cita.
    expect(detalheDaEntrada(compromisso({ isExtra: true }), 'de-um-cliente')).not.toContain(
      'extra',
    );
  });

  // F43 Fase 5: `corDaEntrada` devolve a COR (do ícone), e não mais um estilo
  // de contorno e fundo — a pastilha ficou neutra. As perguntas são as mesmas.
  it('a cor do compromisso é a quinta luz — que nenhum tipo usa', () => {
    const cor = corDaEntrada(compromisso());
    expect(cor).toBe(COR_DO_COMPROMISSO);
    expect(COR_DO_COMPROMISSO).toBe('var(--luz-filmes)');
    // E não é a cor de nenhum dos quatro tipos: a cor não diz "mais um tipo",
    // diz "isto não é conteúdo".
    for (const luz of ['--luz-ia', '--tipo-arte', '--luz-agencia', '--luz-estudio', '--luz-lives']) {
      expect(cor).not.toContain(luz);
    }
  });

  it('a entrega continua com a cor do tipo dela', () => {
    expect(corDaEntrada(entrega({ contentType: 'video' }))).toBe('var(--luz-ia)');
    expect(corDaEntrada(entrega({ contentType: 'arte' }))).toBe('var(--tipo-arte)');
  });

  it('`ehCompromisso` é a única pergunta que separa as duas', () => {
    expect(ehCompromisso(compromisso())).toBe(true);
    expect(ehCompromisso(entrega())).toBe(false);
  });
});

/* ───────────────────────── a hora que não existe ───────────────────────── */

describe('hora que não existe não vira 00:00', () => {
  it('hora em branco é gravada como nula', () => {
    expect(validarCompromisso({ clientId: 'c', day: '2026-08-12', title: 'Reunião', time: '' }).time)
      .toBeNull();
    expect(
      validarCompromisso({ clientId: 'c', day: '2026-08-12', title: 'Reunião', time: null }).time,
    ).toBeNull();
  });

  it('e só espaço também é nulo — barra de espaço apertada sem querer', () => {
    expect(
      validarCompromisso({ clientId: 'c', day: '2026-08-12', title: 'Reunião', time: '   ' }).time,
    ).toBeNull();
  });

  it('meia-noite DIGITADA é uma hora de verdade, e sobrevive', () => {
    // O defeito nunca foi `00:00` existir: foi `00:00` aparecer onde ninguém
    // escolheu hora nenhuma. Quem marca uma virada de ano às 00:00 tem razão.
    expect(
      validarCompromisso({ clientId: 'c', day: '2026-12-31', title: 'Virada', time: '00:00' }).time,
    ).toBe('00:00');
  });

  it('hora impossível é recusada em português, sem citar o banco', () => {
    try {
      validarCompromisso({ clientId: 'c', day: '2026-08-12', title: 'x', time: '25:00' });
      throw new Error('devia ter recusado');
    } catch (e) {
      expect(e).toBeInstanceOf(AppointmentRefused);
      expect((e as AppointmentRefused).message).toBe('A hora precisa estar entre 00:00 e 23:59.');
      expect((e as AppointmentRefused).message).not.toMatch(/time|column|constraint|null/i);
    }
  });

  it('compromisso sem nome é recusado — pastilha em branco não informa nada', () => {
    expect(() => validarCompromisso({ clientId: 'c', day: '2026-08-12', title: '  ' })).toThrow(
      AppointmentRefused,
    );
  });

  it('sem cliente e sem dia também se recusa, e cada frase diz o que falta', () => {
    expect(() => validarCompromisso({ day: '2026-08-12', title: 'x' })).toThrow(
      'Escolha de qual cliente é.',
    );
    expect(() => validarCompromisso({ clientId: 'c', title: 'x' })).toThrow('Escolha o dia.');
  });

  it('dia fora da forma `AAAA-MM-DD` é recusado antes de chegar ao banco', () => {
    expect(() => validarCompromisso({ clientId: 'c', day: '12/08/2026', title: 'x' })).toThrow(
      'Escolha o dia.',
    );
  });
});

/* ─────────────────── datas por pedaços, nunca por Date ─────────────────── */

describe('o mês de competência sai do dia, sem passar por Date', () => {
  it('dia comum devolve o primeiro dia do mês', () => {
    expect(mesDoDia('2026-09-15')).toBe('2026-09-01');
  });

  it('⚠️ ano de cinco casas NÃO é recortado por posição', () => {
    // Existe prazo real `82025-08-07` neste banco. `dia.slice(0, 7)` daria
    // `8202`, e `new Date(...).toISOString()` daria `+082025-08-07`.
    expect(mesDoDia('82025-08-07')).toBe('82025-08-01');
  });

  it('o que não se lê como dia volta nulo, e quem chamou decide', () => {
    expect(mesDoDia('sem data')).toBeNull();
  });

  it('a convenção do meio-dia mora num lugar só', () => {
    expect(meioDiaDoDia('2026-08-12')).toBe('2026-08-12T12:00:00Z');
  });
});

/* ─────────────────────── a grade deixou de ser visor ─────────────────────── */

const naRota = (no: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, no));

const grade = (props: Record<string, unknown>) =>
  naRota(
    createElement(GradeDoMes, {
      mes: '2026-08',
      janela: janelaDoMes('2026-08', null),
      entradas: [],
      lente: 'de-um-cliente',
      ...props,
    } as never),
  );

describe('a grade só ganha alça quando a tela pede', () => {
  it('sem `aoMarcarNoDia`, o dia continua sendo um número', () => {
    expect(grade({})).not.toContain('Marcar no dia');
  });

  it('com a alça, cada dia vira um gesto com nome próprio', () => {
    const html = grade({ aoMarcarNoDia: () => {} });
    // O nome diz o DIA, e não "+": trinta botões chamados "+" não distinguem
    // nada para quem ouve a tela.
    expect(html).toContain('aria-label="Marcar no dia 1"');
    expect(html).toContain('aria-label="Marcar no dia 31"');
  });

  it('o `+` está sempre visível, e não só sob o cursor', () => {
    // Foi o achado do usuário: "eles não possuem botão de +". Alça que só
    // aparece ao passar o mouse não existe para quem usa por toque.
    //
    // `overflow-hidden` e `aria-hidden` existem na grade e não escondem alça
    // nenhuma — por isso a busca é pelas classes que ESCONDEM: `invisible`,
    // `opacity-0` e o par `group-hover`.
    const html = grade({ aoMarcarNoDia: () => {} });
    expect(html).not.toMatch(/\binvisible\b|opacity-0|group-hover/);
    expect(html.split('>+</span>').length - 1).toBe(31);
  });

  it('sem `aoAbrirEntrada`, a pastilha não abre nada', () => {
    const html = grade({ entradas: [compromisso()] });
    expect(html).toContain('Gravação na loja');
    expect(html).not.toContain('<button');
  });

  it('com a alça, a pastilha vira botão — e as duas naturezas convivem', () => {
    const html = grade({
      entradas: [entrega(), compromisso()],
      aoAbrirEntrada: () => {},
    });
    expect(html).toContain('Gravação na loja');
    expect(html).toContain('Bastidores');
    expect(html).toContain('14:30');
  });

  it('a hora desenhada é só a do compromisso — entrega não mostra hora', () => {
    // O servidor manda `time: null` na entrega desde a F17.44. Aqui se guarda
    // que a grade não inventa uma de volta.
    const html = grade({ entradas: [entrega()] });
    expect(html).not.toContain('00:00');
    expect(html).not.toContain('09:00');
  });
});

/* ─────────────── a rede de baixo: o medidor recusa, não conta ─────────────── */

describe('se um compromisso chegasse ao medidor, ele recusaria', () => {
  const contrato = [{ contentType: 'video', quantity: 4 }];

  it('o tipo vazio do compromisso não vale peso 1 — ele lança', () => {
    // É a decisão da F3.3, e é ela que faz a separação desta etapa ter uma
    // segunda rede: o sistema antigo assumia peso 1 no que não reconhecia, e
    // errava calado. Aqui um compromisso empurrado para dentro da conta PARA a
    // conta, em vez de somar uma reunião ao que o cliente contratou.
    expect(() =>
      calculateDeliveryLevel(contrato, [
        { contentType: '', isExtra: false, isCompleted: true },
      ]),
    ).toThrow(UnknownContentType);
  });

  it('e a conta sem ele fecha normalmente', () => {
    const r = calculateDeliveryLevel(contrato, [
      { contentType: 'video', isExtra: false, isCompleted: true },
    ]);
    expect(r.measurable).toBe(true);
  });
});
