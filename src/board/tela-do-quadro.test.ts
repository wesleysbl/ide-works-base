/**
 * A TELA ABRE — F17.9a.
 *
 * POR QUE ESTE TESTE EXISTE
 *   Esta etapa foi escolhida pelo usuário justamente porque oito etapas de banco
 *   entregaram um modelo que ninguém conseguia abrir. Uma etapa de tela que
 *   "passa no typecheck" e explode ao montar não teria entregue nada — e
 *   typecheck não pega import circular, componente indefinido, nem hook fora de
 *   ordem.
 *
 *   Então a página é MONTADA de verdade, e o que ela desenha é conferido.
 *
 * SEM NAVEGADOR, E POR ISSO SEM `useEffect`
 *   A suíte roda em ambiente `node`, sem DOM (e com o isolamento de rede da
 *   F0.4 ligado, que recusaria a chamada de qualquer jeito). `renderToStaticMarkup`
 *   monta a árvore e não roda efeito — então o que se prova aqui é o PRIMEIRO
 *   quadro: a página monta, o cabeçalho e a barra lateral saem, e nada estoura.
 *
 *   O resto do caminho — HTTP → Worker → Hyperdrive → Postgres, com o dado real
 *   das 18 tarefas — é `scripts/provar-quadro.mjs`, que fala com o banco de
 *   verdade. Os dois juntos cobrem a tela inteira; nenhum dos dois sozinho.
 *
 * ESCRITO EM `createElement`, E NÃO EM JSX
 *   A suíte só inclui `*.test.ts`. Um `.tsx` não seria executado — e um teste
 *   que não roda é pior que teste nenhum, porque ele conta como cobertura.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import Quadro from '@/pages/Quadro';
import { BarraDeFiltro } from '@/board/BarraDeFiltro';
import { type FiltroDeTarefas, SEM_FILTRO, SEM_RESPONSAVEL } from '@/board/filtro';

function desenhar(caminho: string): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [caminho] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: '/quadro', element: createElement(Quadro) }),
        createElement(Route, { path: '/quadro/:listaId', element: createElement(Quadro) }),
      ),
    ),
  );
}

describe('a página do quadro monta', () => {
  it('sem lista escolhida, monta sem estourar', () => {
    expect(() => desenhar('/quadro')).not.toThrow();
  });

  it('com lista na URL, monta sem estourar', () => {
    expect(() => desenhar('/quadro/604ef3c5-a635-45f0-914b-087c47f9eb85')).not.toThrow();
  });

  it('desenha o cabeçalho da tela', () => {
    const html = desenhar('/quadro');
    /*
      ⚠️ ESTA ASSERÇÃO ERA `toContain('a réplica do ClickUp')`, E A F17.20 TIROU
      O SUBTÍTULO QUE A SATISFAZIA.

      Ela não estava aqui à toa: a palavra `Quadro` também é o nome de um ITEM
      da barra lateral, então `toContain('Quadro')` sozinho passa mesmo com o
      cabeçalho inteiro apagado. O subtítulo era a única parte do cabeçalho que
      só o cabeçalho tinha — e é exatamente o problema que o teste logo abaixo
      documenta ter acontecido na F17.18, ao contrário.

      Sem subtítulo, a âncora passa a ser o `<h1>`: o título da página é o único
      lugar do HTML onde `o-titulo` e `Quadro` aparecem juntos. Guarda a mesma
      coisa que o subtítulo guardava, e sem depender de uma frase de ajuda.
    */
    expect(html).toMatch(/<h1[^>]*class="[^"]*o-titulo[^"]*"[^>]*>[\s\S]*?Quadro[\s\S]*?<\/h1>/);
  });

  it('A TRILHA ABRE JUNTO COM A TELA, mesmo antes de o quadro chegar — F17.25', () => {
    /*
      Sem lista escolhida ainda não há empresa, espaço nem lista para mostrar —
      e é justamente aí que a tela ficaria sem trilha nenhuma, que é o defeito
      que esta etapa veio tirar. Ela cai para `Compartilhado comigo › Quadro`
      (F29.5b; antes `Meu trabalho › Quadro`, sem nenhum degrau clicável), com
      a raiz levando a `/quadro` — a mesma raiz da trilha carregada.

      ⚠️ `Quadro` e `Meu trabalho` também aparecem na barra lateral, então
      procurar as duas palavras soltas passaria com a trilha apagada. A âncora é
      o `<nav class="tr-trilha">` — o único lugar do HTML onde ela existe.
    */
    const html = desenhar('/quadro');
    const trilha = /<nav class="tr-trilha"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
    expect(trilha).not.toContain('Meu trabalho');
    expect(trilha).toMatch(/<a[^>]*href="\/quadro"[^>]*>[\s\S]*?Compartilhado comigo/);
    expect(trilha).toContain('Quadro');
    expect(trilha).toContain('›');
    // O último degrau é onde se está, e ele se anuncia para quem não vê.
    expect(trilha).toContain('aria-current="page"');
  });

  it('desenha a barra lateral da árvore e a volta para o painel', () => {
    const html = desenhar('/quadro');
    /*
      ⚠️ ESTA LINHA DIZIA `Espaços`, E FOI TROCADA NA F17.18 — com um agravante
      que vale registrar: ela tinha DEIXADO de testar o que dizia.

      A F17.18 renomeou a seção da árvore para `Compartilhado comigo`, que é o
      nome que o usuário pediu ao mostrar a barra lateral do ClickUp. Mesmo
      assim o teste continuou verde: a palavra `Espaços` sobrevive no subtítulo
      da página ("Espaços, listas e o trabalho em andamento"), e o `toContain`
      não distingue cabeçalho de subtítulo.

      Ou seja: a asserção passaria mesmo com a barra lateral inteira apagada.
      Ela agora procura o nome real da seção, que só a barra desenha.
    */
    expect(html).toContain('Compartilhado comigo');
    expect(html).toContain('href="/painel"');
  });

  it('a barra lateral traz as seções de navegação da F17.18', () => {
    // A árvore deixou de ser a barra inteira e virou UMA seção dela. Se a barra
    // sumir, o quadro continua montando e a pessoa perde a navegação — que é o
    // defeito silencioso que este arquivo existe para pegar.
    const html = desenhar('/quadro');
    expect(html).toContain('Minhas tarefas');
    expect(html).toContain('Todas as tarefas');
    // O pé é o chip da conta desde a F29: `Personalizar a barra lateral` mora
    // no menu dele, que nasce fechado. O chip é a garantia — sem ele, esconder
    // as seções trancaria a personalização por fora.
    expect(html).toContain('class="bl-conta"');
    expect(html).toContain('aria-label="Sua conta e configurações');
  });

  it('usa as classes do quadro, e não um desenho solto', () => {
    // `q-barra` vem de `src/ui/quadro.css`. Se a folha deixar de ser importada,
    // a tela continua montando e sai sem estrutura nenhuma — o defeito mais
    // silencioso possível numa etapa cujo produto é o desenho.
    expect(desenhar('/quadro')).toContain('q-barra');
  });
});

describe('A D10 NA TELA: nenhuma cor literal do Tailwind no que ela desenha', () => {
  // A cor do OBSIDIAN mora em token; a do ClickUp entra como variável no
  // elemento. Nenhuma das duas vira `bg-emerald-400`. Este teste olha o HTML
  // PRODUZIDO, e não a fonte — é o que sobra depois de toda condicional.
  const PALETA_DO_TAILWIND =
    /\b(?:bg|text|border|from|to|via|fill|stroke|ring|divide|shadow|outline|decoration|accent|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;

  it('a tela sem lista escolhida', () => {
    expect(desenhar('/quadro')).not.toMatch(PALETA_DO_TAILWIND);
  });

  it('a tela com lista na URL', () => {
    expect(desenhar('/quadro/604ef3c5-a635-45f0-914b-087c47f9eb85')).not.toMatch(
      PALETA_DO_TAILWIND,
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   A BARRA DE FILTRO — F17.55.

   Ela não aparece na página montada sem dado: só existe quando o quadro chegou
   do servidor, e aqui não há efeito. Então ela é desenhada direto, com os
   números medidos na `ATENDIMENTO` de 2026-09-02.

   O que este bloco cobra é a regra que a F17.50 comprou caro: **número que
   mente é pior que lista lenta**. Filtrando, os DOIS números têm de sair.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('a barra de filtro diz o que filtrou', () => {
  const OPCOES = [
    { id: '96dcfc56-8460-4fc8-870a-b4745a01b943', name: 'Caio Moraes', tasks: 30 },
    { id: '7a29e88c-fc46-4f3c-8d23-47e7809ae98b', name: 'Helena', tasks: 25 },
  ];

  const barra = (filtro: FiltroDeTarefas, achadas: number) =>
    renderToStaticMarkup(
      createElement(BarraDeFiltro, {
        filtro,
        aplicado: filtro,
        opcoes: OPCOES,
        semResponsavel: 1015,
        achadas,
        total: 1070,
        ocupado: false,
        aoMudar: () => {},
      }),
    );

  it('sem filtro, tem a lupa e o botão de responsável, e NENHUM número', () => {
    const html = barra(SEM_FILTRO, 1070);
    expect(html).toContain('aria-label="Buscar tarefa pelo nome"');
    expect(html).toContain('Responsável');
    // Anunciar `1070 de 1070` seria dizer que se filtrou algo quando não se
    // filtrou nada — e o total já está no cabeçalho, uma linha acima.
    expect(html).not.toContain('de 1070');
    expect(html).not.toContain('Limpar');
  });

  it('buscando, diz quantas achou E de quantas — nunca um número só', () => {
    const html = barra({ texto: 'sabor', responsavel: null }, 35);
    expect(html).toContain('35');
    expect(html).toContain('1070');
    expect(html).toContain('sabor');
    expect(html).toContain('Limpar');
  });

  it('`sem responsável` aparece pelo nome, e não como um código', () => {
    const html = barra({ texto: '', responsavel: SEM_RESPONSAVEL }, 1015);
    expect(html).toContain('Sem responsável');
    expect(html).not.toContain('&quot;sem&quot;');
  });

  it('escolhida a pessoa, o botão passa a mostrar o nome dela', () => {
    const html = barra({ texto: '', responsavel: OPCOES[0].id }, 30);
    expect(html).toContain('Caio Moraes');
    // O identificador não vai para a tela: ele não diz nada a ninguém.
    expect(html).not.toContain('96dcfc56');
  });

  it('os dois juntos são ditos os dois', () => {
    const html = barra({ texto: 'sabor', responsavel: OPCOES[0].id }, 6);
    expect(html).toContain('sabor');
    expect(html).toContain('Caio Moraes');
    expect(html).toContain('6');
  });

  /* A primeira captura desta etapa saiu com `sem responsável | 1015 de 1070 ·
     sem responsável` — o botão e a frase dizendo a mesma coisa, lado a lado. */
  it('o responsável aparece UMA vez, e não duas na mesma linha', () => {
    const html = barra({ texto: '', responsavel: SEM_RESPONSAVEL }, 1015);
    expect(html.split('Sem responsável')).toHaveLength(2);
  });

  it('D10: nenhuma cor literal do Tailwind', () => {
    const PALETA =
      /\b(?:bg|text|border|from|to|via|fill|stroke|ring|divide|shadow|outline|decoration|accent|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;
    expect(barra({ texto: 'sabor', responsavel: SEM_RESPONSAVEL }, 12)).not.toMatch(PALETA);
  });
});
