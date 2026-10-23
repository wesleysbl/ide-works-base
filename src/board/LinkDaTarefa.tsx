/**
 * O LINK DA TAREFA NAS TELAS DE TRABALHO — F43, Fase 7.
 *
 * UM SÓ, PARA TODOS OS PONTOS QUE ABREM CARD
 *   O título do cartão do kanban (Quadro, Pasta, Espaço, e o quadro de Minhas e
 *   Todas), o "↳ mãe" do cartão, a linha de Minhas/Todas e a linha da Lista do
 *   escopo. Antes cada um era um `<Link to="/tarefa/:id">` solto; agora a regra
 *   de "abre ao lado ou abre a página" mora num lugar, e nenhum ponto diverge.
 *
 * O QUE ELE FAZ
 *   O `href` é SEMPRE `/tarefa/:id` — copiar o link, abrir em aba nova e os
 *   testes que procuram `a[href^="/tarefa/"]` continuam valendo. O clique
 *   simples (botão principal, sem Ctrl/⌘/Shift/Alt) numa das telas de trabalho
 *   (`telaQueAbreAoLado`) não sai da tela: empurra uma entrada no MESMO lugar,
 *   com a ficha no estado e o endereço mascarado como `/tarefa/:id` (ver
 *   `@/ui/ficha-ao-lado`). Quem desenha o painel é a moldura raiz
 *   (`FichaAoLado`), por cima da tela que continua montada atrás.
 *
 *   Qualquer outro clique é do navegador ou do `Link`: modificadores e botão do
 *   meio abrem a página cheia numa aba nova, como sempre.
 *
 * ⚠️ `navigate` SEM `replace`. Navegar para o mesmo caminho pelo `Link` vira
 * `replace` por padrão no roteador — e aí o Voltar do navegador não fecharia o
 * painel, sairia do Quadro. A entrada do painel é empurrada; fechar é voltar.
 */

import { type ReactNode } from 'react';
import { type Location, Link, useLocation, useNavigate } from 'react-router-dom';

import {
  cliqueAbreAoLado,
  comFichaAoLado,
  enderecoDaTarefa,
  telaQueAbreAoLado,
} from '@/ui/ficha-ao-lado';

/**
 * O LUGAR DE AGORA, LIDO NA HORA DO CLIQUE — e não o do último desenho.
 *
 * O caso é o do e2e `paginacao` F05-4: digitar a busca e clicar logo numa
 * linha. O `mousedown` tira o foco da caixa, e a busca pendente é gravada no
 * endereço nesse instante (`replace`, F05); o clique vem no evento seguinte. O
 * React Router 7 troca o endereço da TELA num `startTransition` — o atraso foi
 * medido na F03 (ver "O ENDEREÇO JÁ ANDOU" em `Minhas tarefas`) —, então o
 * `location` do desenho pode ainda ser o de ANTES da busca. Empurrar a entrada
 * do painel com ele poria atrás do painel a lista SEM a busca: a tela de trás
 * mudaria de conteúdo ao abrir o card. Nesta máquina o desenho já chegava a
 * tempo (o F05-4 passou com e sem esta leitura); ela fica porque o atraso
 * existe, e o F05-4 agora confere a lista de trás com o painel aberto. A barra
 * de endereço já está certa nessa hora (o roteador grava o histórico antes de
 * desenhar): é dela que sai o lugar, com o estado da entrada.
 *
 * Só vale sem máscara e no mesmo caminho do desenho; fora disso, o desenho.
 */
function lugarDoClique(desenho: Location): Pick<Location, 'pathname' | 'search' | 'hash' | 'state'> {
  if (typeof window === 'undefined') return desenho;
  const entrada = window.history.state as { usr?: unknown; masked?: unknown } | null;
  if (entrada?.masked) return desenho;
  const { pathname, search, hash } = window.location;
  if (pathname !== desenho.pathname) return desenho;
  return { pathname, search, hash, state: entrada?.usr ?? null };
}

export function LinkDaTarefa({
  id,
  className,
  title,
  rotulo,
  draggable,
  children,
}: {
  id: string;
  className?: string;
  title?: string;
  /** O nome acessível, quando o texto à vista não basta (o "↳ mãe" do cartão). */
  rotulo?: string;
  /** `false` no cartão que arrasta: o `<li>` é que arrasta, e link nasce arrastável. */
  draggable?: boolean;
  children: ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const aoLado = telaQueAbreAoLado(location.pathname);

  return (
    <Link
      to={enderecoDaTarefa(id)}
      className={className}
      title={title}
      aria-label={rotulo}
      draggable={draggable}
      onClick={(e) => {
        if (!aoLado || !cliqueAbreAoLado(e)) return;
        // O `Link` só navega se ninguém tiver impedido; daqui em diante quem
        // navega é esta linha, para o mesmo lugar, com a máscara.
        e.preventDefault();
        const agora = lugarDoClique(location);
        navigate(
          { pathname: agora.pathname, search: agora.search, hash: agora.hash },
          { state: comFichaAoLado(agora.state, id), mask: enderecoDaTarefa(id) },
        );
      }}
    >
      {children}
    </Link>
  );
}
