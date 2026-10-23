/**
 * A ABA DE CALENDÁRIO DO CLIENTE MONTA — F17.40.
 *
 * SEM NAVEGADOR, E POR ISSO SEM `useEffect`
 *   A suíte roda em `node`, sem DOM e com o isolamento de rede da F0.4 ligado.
 *   `renderToStaticMarkup` monta a árvore e não roda efeito — então o que se
 *   prova aqui é o PRIMEIRO quadro: a aba monta, a grade sai desenhada mesmo
 *   sem nenhum conteúdo, e nada estoura.
 *
 *   O caminho inteiro — HTTP → Worker → Postgres, com o recorte por cliente — é
 *   `scripts/provar-o-mes-do-cliente.mjs`, que fala com o banco de verdade e
 *   compara a aba com uma consulta direta. Os dois juntos cobrem a aba; nenhum
 *   dos dois sozinho.
 *
 * ESCRITO EM `createElement`, E NÃO EM JSX
 *   A suíte só inclui `*.test.ts`. Um `.tsx` não seria executado — e um teste
 *   que não roda é pior que teste nenhum, porque ele conta como cobertura.
 */

import { type ReactElement, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { CalendarioDoCliente } from '@/clients/CalendarioDoCliente';
import { AgendaDoMes, GradeDoMes } from '@/ui/GradeDoMes';
import type { EntradaDoMes } from '@/ui/grade-do-mes';
import { janelaDoMes } from '@/ui/grade-do-mes';

const naRota = (no: ReactElement) => renderToStaticMarkup(createElement(MemoryRouter, null, no));

function abaDoCliente(mes = '2026-08'): string {
  return naRota(
    createElement(CalendarioDoCliente, {
      clienteId: 'c1',
      mes,
      periodo: null,
      aoMudarPeriodo: () => {},
      aoMudar: () => {},
    }),
  );
}

const entrada = (p: Partial<EntradaDoMes> = {}): EntradaDoMes => ({
  kind: 'delivery',
  id: 'i1',
  clientId: 'c1',
  clientName: 'Padaria do Zé',
  contentType: 'video',
  day: '2026-08-12',
  time: '15:30',
  title: 'Bastidores',
  isExtra: false,
  isCompleted: false,
  notes: null,
  ...p,
});

function grade(lente: 'de-todos' | 'de-um-cliente', entradas: EntradaDoMes[], mes = '2026-08') {
  return naRota(
    createElement(GradeDoMes, { mes, janela: janelaDoMes(mes, null), entradas, lente }),
  );
}

describe('a aba monta', () => {
  it('sem estourar', () => {
    expect(() => abaDoCliente()).not.toThrow();
  });

  it('mês sem nada abre como um mês, e não como defeito', () => {
    const html = abaDoCliente();
    // Os 31 dias de agosto estão desenhados, cada um na casa dele.
    //
    // ⚠️ O número do dia deixou de ser um `<div>` na F17.44: ele virou o gesto
    // de marcar naquele dia, e por isso mora dentro de um botão com nome
    // próprio. O que este caso guarda continua sendo o mesmo — a grade abre
    // desenhada mesmo sem conteúdo nenhum.
    for (const dia of [1, 15, 31]) expect(html).toContain(`>${dia}</span>`);
    // E não há frase pedindo desculpa por estar vazio.
    expect(html).not.toMatch(/nenhum|vazio|sem conteúdo/i);
  });

  it('o seletor de intervalo é o mesmo do calendário geral', () => {
    // `Mês todo` é o rótulo que `SeletorDePeriodo` escreve sem período escolhido.
    expect(abaDoCliente()).toContain('Mês todo');
  });

  it('a aba não fala sobre si mesma', () => {
    expect(abaDoCliente()).not.toMatch(/esta aba|esta tela|aqui você/i);
  });
});

describe('a mesma grade, duas lentes', () => {
  it('de fora, o conteúdo diz de quem é e leva à ficha', () => {
    const html = grade('de-todos', [entrada()]);
    expect(html).toContain('href="/cliente/c1"');
    expect(html).toContain('Padaria do Zé');
  });

  it('de dentro da ficha, ele diz o que é e não leva a lugar nenhum', () => {
    const html = grade('de-um-cliente', [entrada()]);
    // Estar na ficha e ter um link para a ficha é um caminho que não vai a
    // lugar nenhum — e ainda ocupa a única linha que a casa tem.
    expect(html).not.toContain('href="/cliente/');
    expect(html).toContain('Vídeo · Bastidores');
    expect(html).not.toContain('Padaria do Zé');
  });

  it('as duas lentes desenham a MESMA quantidade de casas', () => {
    const contar = (h: string) => h.split('class="cal-casa"').length;
    expect(contar(grade('de-todos', []))).toBe(contar(grade('de-um-cliente', [])));
  });

  it('o conteúdo cai no dia dele, e só nele', () => {
    // F12: a casa leva o dia em `data-dia` — a âncora é o dado, e não o
    // desenho do número (que agora é um `<span>` com a marca de Hoje ao lado).
    const html = grade('de-um-cliente', [entrada({ day: '2026-08-12' })]);
    const antes = html.indexOf('data-dia="2026-08-12"');
    const depois = html.indexOf('data-dia="2026-08-13"');
    const posicao = html.indexOf('Bastidores');
    expect(posicao).toBeGreaterThan(antes);
    expect(posicao).toBeLessThan(depois);
  });

  it('concluído tem visto e estado no nome, e NÃO é riscado — R06/F12', () => {
    // O risco tirava justamente o nome que se queria ler (117 conteúdos na
    // revisão de 28/09, metade riscada). O estado agora é um visto, a letra
    // um degrau abaixo, e o nome acessível termina em "concluído".
    const html = grade('de-um-cliente', [entrada({ isCompleted: true })]);
    expect(html).not.toContain('line-through');
    expect(html).toContain('data-estado="concluido"');
    expect(html).toContain('cal-visto');
    expect(html).toContain('aria-label="Vídeo “Bastidores”, dia 12/08, concluído"');
    // `opacity-50` a 11px levava a pastilha para baixo de 3:1 de contraste.
    expect(html).not.toContain('opacity-50');
    expect(html).not.toContain('opacity-70');
  });
});

describe('dia cheio, hoje e agenda — F12', () => {
  const muitos = (n: number, dia = '2026-08-05') =>
    Array.from({ length: n }, (_, i) => entrada({ id: `m${i}`, day: dia, title: `Peça ${i + 1}` }));

  it('a casa mostra até o teto e o resto vira "+N mais"', () => {
    const html = grade('de-um-cliente', muitos(7));
    expect(html.split('class="cal-pastilha"').length - 1).toBe(3);
    expect(html).toContain('+4 mais');
    expect(html).toContain('aria-label="+4 mais: mostrar tudo no dia 5"');
    expect(html).toContain('aria-expanded="false"');
  });

  it('com quatro, cabem os quatro — sem "+N"', () => {
    const html = grade('de-um-cliente', muitos(4));
    expect(html.split('class="cal-pastilha"').length - 1).toBe(4);
    expect(html).not.toContain('mais</button>');
  });

  it('hoje tem marca e aria-current, e só um dia tem', () => {
    const html = naRota(
      createElement(GradeDoMes, {
        mes: '2026-08',
        janela: janelaDoMes('2026-08', null),
        entradas: [],
        lente: 'de-todos',
        hoje: '2026-08-20',
      }),
    );
    expect(html.split('aria-current="date"').length - 1).toBe(1);
    expect(html).toMatch(/data-dia="2026-08-20"[^>]*data-hoje="sim"/);
    expect(html).toContain('>Hoje<');
  });

  it('a agenda lista o dia com tipo e estado por extenso, e abre com o mesmo nome acessível', () => {
    const html = naRota(
      createElement(AgendaDoMes, {
        mes: '2026-08',
        janela: janelaDoMes('2026-08', null),
        entradas: [entrada({ isCompleted: true }), entrada({ id: 'i2', title: null, contentType: 'arte' })],
        lente: 'de-um-cliente',
        hoje: '2026-09-01',
      }),
    );
    expect(html).toContain('quarta, 12 de agosto');
    expect(html).toContain('Concluído');
    expect(html).toContain('Pendente');
    // Sem título inventado: "Sem título" à vista, "sem título" no nome.
    expect(html).toContain('Sem título');
    expect(html).toContain('aria-label="Arte sem título, dia 12/08, pendente"');
    expect(html).not.toContain('line-through');
  });

  it('agenda de mês vazio convida a marcar, sem zero falso', () => {
    const html = naRota(
      createElement(AgendaDoMes, {
        mes: '2026-08',
        janela: janelaDoMes('2026-08', null),
        entradas: [],
        lente: 'de-todos',
        hoje: '2026-09-01',
        aoMarcarNoDia: () => {},
      }),
    );
    expect(html).toContain('Nada marcado em agosto de 2026.');
    expect(html).toContain('+ Marcar');
  });

  it('a aba do cliente abre na forma Mês (sem janela, no servidor) e oferece a Agenda', () => {
    const html = abaDoCliente();
    expect(html).toContain('aria-label="Forma de ver o calendário"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>Mês</);
    expect(html).toContain('>Agenda<');
  });
});
