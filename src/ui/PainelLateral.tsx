/**
 * O PAINEL AO LADO — F43, Fase 3.
 *
 * O QUE ELE É
 *   Uma folha que abre à DIREITA da tela, por cima da página, sem tirar a
 *   pessoa de onde ela estava: a lista continua visível atrás, esmaecida, e
 *   fechar devolve tudo como estava — a rolagem e o foco. É o "clicar no
 *   cliente abre o mês dele ao lado" do Planejamento (Fase 3) e será o card
 *   ao lado do Quadro (Fase 7). Por isso ele não sabe nada de cliente nem de
 *   tarefa: recebe título, a linha de cima, o corpo e o rodapé.
 *
 * A REGRA DA `Janela` VALE AQUI (`@/ui/janela`, F17.33)
 *   "Janela e painel — o que tem cabeçalho próprio e tapa a tela — fecha pelos
 *   três: `X`, `Esc` e clique fora." O `X` é o mesmo `BotaoDeFechar`, o foco
 *   de abrir é o mesmo `useFocoDaJanela` e o de fechar, `useDevolverFoco`.
 *   O que ele acrescenta é o `Tab` preso (`prenderOTab`): o painel declara
 *   `aria-modal`, e o teclado não pode passear pela tabela coberta pelo véu.
 *
 * O CLIQUE FORA É NO VÉU, E SÓ COMEÇANDO NELE
 *   `mousedown` no véu, e não `click` no fundo: arrastar para selecionar um
 *   texto de dentro do painel e soltar fora não fecha nada — a mesma decisão
 *   da `Janela` e da `FichaDeCliente`.
 *
 * A PÁGINA DE TRÁS NÃO SE MEXE
 *   Abrir e fechar não rolam a página (o endereço muda só na consulta, e a
 *   memória de rolagem olha o caminho — `LembrarRolagem`). Quem rola é o
 *   corpo do painel, e a rolagem dele não escorre para a página
 *   (`overscroll-behavior`).
 *
 * EM PORTAL, NO `body`
 *   Pela mesma razão do `Balao` (`@/board/menus`): um ancestral com
 *   `position: sticky` ou `transform` prende o `fixed` no contexto dele, e o
 *   painel ficaria por baixo da barra lateral. Sem DOM (o teste desenha no
 *   servidor), ele sai no lugar, que é o que o teste lê.
 *
 * LARGURA
 *   `min(40rem, 100vw)` no computador — o protótipo aprovado; a Fase 7 pede
 *   mais (`largura`). Abaixo de 640 px ele ocupa a tela inteira: uma folha de
 *   88% num telefone deixaria uma tira da tabela que ninguém consegue usar.
 *
 *   `telaInteira="tablet"` — F43, Fase 7, o card ao lado do Quadro: a ficha
 *   é larga (64rem) e, abaixo de 1024 px, a tira do Quadro que sobraria ao
 *   lado não serve para nada. Ali o painel ocupa a tela inteira já no tablet.
 */

import { type CSSProperties, type ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

import { alcancaveisDe, prenderOTab, useDevolverFoco, useFocoDaJanela } from '@/ui/foco';
import { BotaoDeFechar } from '@/ui/janela';
import '@/ui/painel-lateral.css';

export function PainelLateral({
  titulo,
  subtitulo,
  rotulo,
  contexto,
  rodape,
  largura,
  telaInteira = 'celular',
  aoFechar,
  devolverFoco = true,
  children,
}: {
  /** O nome do painel, no alto do corpo — e o nome do diálogo (`aria-labelledby`). */
  titulo?: ReactNode;
  /** A linha calma ao lado do título ("Carla · plano Conteúdo"). */
  subtitulo?: ReactNode;
  /** O nome para o leitor de tela quando não há `titulo` visível. */
  rotulo?: string;
  /** A linha de cima, à esquerda do `X` — onde se está, ou um controle do painel. */
  contexto?: ReactNode;
  /** Fica preso embaixo, fora da rolagem: os links para sair dali. */
  rodape?: ReactNode;
  /** Uma medida CSS para a largura no computador. Padrão: `min(40rem, 100vw)`. */
  largura?: string;
  /**
   * A partir de quando ele ocupa a tela inteira: no celular (abaixo de 640 px,
   * o padrão) ou já no tablet (abaixo de 1024 px — a ficha da tarefa, Fase 7).
   */
  telaInteira?: 'celular' | 'tablet';
  aoFechar: () => void;
  /** O foco volta a quem abriu ao fechar — ver `useDevolverFoco`. */
  devolverFoco?: boolean | HTMLElement | null;
  children: ReactNode;
}) {
  const idDoTitulo = useId();
  // O mesmo `ref` serve ao foco de abrir e ao `Tab` preso, que lê a caixa na
  // hora da tecla.
  const painel = useFocoDaJanela<HTMLElement>();
  useDevolverFoco(devolverFoco);

  /* O FOCO QUE SE PERDEU — medido no navegador. Um balão em portal aberto de
     dentro do painel (o seletor de dia da grade) fecha e não devolve o foco a
     ninguém: ele cai no `<body>`, fora do painel. Dali o `Tab` andava pela
     página de trás e o `Esc` não chegava a ninguém. Este ouvinte só age
     nesse caso — foco no `<body>` e tecla que ninguém tratou —: o `Esc` fecha
     o painel, que é a camada de cima, e o `Tab` volta para dentro dele. */
  const fechar = useRef(aoFechar);
  useEffect(() => {
    fechar.current = aoFechar;
  }, [aoFechar]);
  useEffect(() => {
    const semDono = (e: KeyboardEvent) => {
      const caixa = painel.current;
      if (caixa === null || e.defaultPrevented) return;
      if (document.activeElement !== null && document.activeElement !== document.body) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        fechar.current();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const alcancaveis = alcancaveisDe(caixa);
        (alcancaveis.length === 0 ? caixa : alcancaveis[e.shiftKey ? alcancaveis.length - 1 : 0]).focus();
      }
    };
    document.addEventListener('keydown', semDono);
    return () => document.removeEventListener('keydown', semDono);
  }, [painel]);

  const estilo = largura ? ({ '--pll-largura': largura } as CSSProperties) : undefined;

  const corpo = (
    <div className="pll" data-painel-lateral="">
      <div className="pll-veu" aria-hidden="true" onMouseDown={aoFechar} />
      <section
        ref={painel}
        className="pll-painel"
        style={estilo}
        data-tela-inteira={telaInteira === 'tablet' ? 'tablet' : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titulo !== undefined ? idDoTitulo : undefined}
        aria-label={titulo === undefined ? rotulo : undefined}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            // Um menu ou uma janela de DENTRO já trataram a tecla e a pararam;
            // se ela chegou aqui, é deste painel — e daqui não sobe.
            e.preventDefault();
            e.stopPropagation();
            aoFechar();
            return;
          }
          prenderOTab(e, painel.current);
        }}
      >
        <header className="pll-topo">
          <div className="pll-contexto">{contexto}</div>
          <BotaoDeFechar aoFechar={aoFechar} />
        </header>
        <div className="pll-corpo">
          {titulo !== undefined && (
            <div className="pll-cabeca">
              <h2 id={idDoTitulo} className="pll-titulo">
                {titulo}
              </h2>
              {subtitulo !== undefined && <p className="pll-subtitulo">{subtitulo}</p>}
            </div>
          )}
          {children}
        </div>
        {rodape !== undefined && <footer className="pll-rodape">{rodape}</footer>}
      </section>
    </div>
  );

  if (typeof document === 'undefined') return corpo;
  return createPortal(corpo, document.body);
}
