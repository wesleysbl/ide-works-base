/**
 * O CARD AO LADO DO QUADRO — F43, Fase 7.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE É
 *
 *   A MESMA ficha da página `/tarefa/:id` (`FichaDaTarefa`, separada na Fase
 *   6 para isto), dentro do painel lateral da Fase 3 (`PainelLateral`), por
 *   cima da tela de onde ela foi aberta. O Quadro continua montado atrás, com
 *   a rolagem, os lotes e as colunas como estavam. Nada da ficha foi copiado:
 *   os chips, o Salvar, o `···`, os passos, os anexos, a aprovação e a conversa
 *   são os mesmos componentes, com as mesmas portas — inclusive a porta de
 *   saída do texto por salvar (`@/ui/saida`).
 *
 *   ⚠️ Regra do Wesley (08/10): "Toma cuidado para não esconder nenhum botão
 *   sem querer… ou função". O que muda entre a página e o painel é SÓ o topo:
 *   a página tem a trilha e o X; o painel tem a mesma trilha, "Abrir em tela
 *   cheia" e o ✕. O e2e `card-ao-lado` lista os controles dos dois e compara.
 *
 * O TOPO
 *   · a trilha da tarefa (`trilhaDaTarefa`, a MESMA peça do topo da página):
 *     onde a tarefa mora, encurtando quando não cabe. Os degraus levam às telas
 *     deles, como na página — sair por ali passa pela guarda de saída;
 *   · "Abrir em tela cheia": a página `/tarefa/:id`, no lugar do painel
 *     (`replace` — Voltar de lá leva ao Quadro, de onde a pessoa veio, e não a
 *     um painel que ela já trocou pela página);
 *   · o ✕ do painel. Ele, o `Esc`, o clique fora e o Voltar do navegador
 *     FECHAM — e fechar é voltar uma entrada (ver `fechar`).
 *
 * O ESC DENTRO DE UM CAMPO NÃO FECHA O PAINEL
 *   Na página, `Esc` no campo de nova subtarefa limpa o campo; no item do
 *   checklist, desfaz o nome; no editor do comentário, cancela. Esses campos
 *   não param a tecla, e ela subiria até o painel — que fecharia a ficha
 *   inteira no meio de um gesto que só queria desfazer uma linha. Então,
 *   vindo de um campo de texto, o `Esc` faz o que fazia na página e para ali.
 *   Fora dos campos (o foco no painel, num chip, num botão) ele fecha.
 *
 * LARGURA
 *   `min(64rem, 100vw)` no computador e a tela inteira abaixo de 1024 px
 *   (`telaInteira="tablet"`). A ficha se ajusta pela própria largura
 *   (*container query* da Fase 6): no painel ela fica em UMA coluna, a mesma
 *   da página a 1366 px — a conversa pede largura (`ConversaDaTarefa`).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Maximize2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { FichaDaTarefa } from '@/board/FichaDaTarefa';
import type { TaskDetail } from '@/board/ficha';
import { textoDasMencoes } from '@/board/mencoes';
import { Trilha } from '@/board/TrilhaDoLugar';
import { trilhaDaTarefa } from '@/board/trilha';
import { enderecoDaTarefa, semFichaAoLado } from '@/ui/ficha-ao-lado';
import { PainelLateral } from '@/ui/PainelLateral';
import { temHistoricoNoApp } from '@/ui/volta';
import '@/ui/ficha-no-painel.css';

/**
 * Leva a tarefa que a ficha carregou para o topo do painel.
 *
 * A ficha é quem lê a tarefa, e ela a entrega a quem a hospeda pelo
 * `cabecalho` (Fase 6). A página desenha ali o topo; o painel tem o topo
 * FORA do corpo que rola (a linha do ✕), então aqui o cabeçalho não desenha
 * nada — só avisa.
 */
function Relatar({
  tarefa,
  aoMudar,
}: {
  tarefa: TaskDetail | null;
  aoMudar: (t: TaskDetail | null) => void;
}) {
  useEffect(() => {
    aoMudar(tarefa);
  }, [tarefa, aoMudar]);
  return null;
}

/** O alvo da tecla é um campo de texto? Ver "O ESC DENTRO DE UM CAMPO". */
function campoDeTexto(alvo: EventTarget): boolean {
  if (!(alvo instanceof HTMLElement)) return false;
  return alvo.isContentEditable || alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.tagName === 'SELECT';
}

/**
 * Quanto tempo um segundo pedido de fechar é o MESMO gesto.
 *
 * Fechar é `navigate(-1)`, e o navegador só conta a volta um instante depois.
 * Um clique duplo no ✕ (ou dois `Esc` colados) nesse instante voltaria DUAS
 * entradas — e tiraria a pessoa do Quadro. Depois disso, um novo pedido é
 * novo: quem escolheu "Continuar editando" na janela de saída precisa poder
 * fechar de novo.
 */
const MESMO_GESTO_MS = 600;

export default function FichaAoLado({ id }: { id: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [tarefa, setTarefa] = useState<TaskDetail | null>(null);
  /** O meio da trilha, quando ela encurta — o mesmo da página (F17.25). */
  const [trilhaAberta, setTrilhaAberta] = useState(false);
  const fechouEm = useRef(0);

  // A tarefa do topo é a desta ficha: outra id, outro topo (o efeito de
  // `Relatar` traz a nova quando ela chegar).
  const tarefaDaVez = tarefa !== null && tarefa.id.toLowerCase() === id.toLowerCase() ? tarefa : null;

  const fechar = useCallback(() => {
    const agora = Date.now();
    if (agora - fechouEm.current < MESMO_GESTO_MS) return;
    fechouEm.current = agora;
    // A entrada do painel foi EMPURRADA por cima da do Quadro (`LinkDaTarefa`):
    // fechar é voltar uma. A guarda de saída pergunta aqui, como pergunta no X
    // da página. Sem entrada nossa atrás (não acontece pelo clique, mas o
    // estado vem do navegador), tira a ficha da entrada no lugar.
    if (temHistoricoNoApp(window.history.state)) {
      navigate(-1);
      return;
    }
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: semFichaAoLado(location.state) },
    );
  }, [navigate, location]);

  return (
    <PainelLateral
      rotulo={tarefaDaVez ? `Tarefa: ${textoDasMencoes(tarefaDaVez.title)}` : 'Tarefa'}
      largura="min(64rem, 100vw)"
      telaInteira="tablet"
      aoFechar={fechar}
      contexto={
        <div className="fal-topo">
          <div className="fal-trilha">
            {tarefaDaVez && (
              <Trilha
                degraus={trilhaDaTarefa(tarefaDaVez)}
                expandida={trilhaAberta}
                aoExpandir={() => setTrilhaAberta(true)}
              />
            )}
          </div>
          <Link
            to={enderecoDaTarefa(id)}
            replace
            className="o-btn o-btn-fantasma o-btn-sm fal-tela-cheia"
            aria-label="Abrir em tela cheia"
            title="Abrir em tela cheia"
          >
            <Maximize2 size={14} strokeWidth={1.9} aria-hidden="true" />
            <span className="fal-tela-cheia-texto">Abrir em tela cheia</span>
          </Link>
        </div>
      }
    >
      <div
        className="fal-ficha"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && campoDeTexto(e.target)) e.stopPropagation();
        }}
      >
        <FichaDaTarefa
          key={id}
          tarefaId={id}
          cabecalho={(t) => <Relatar tarefa={t} aoMudar={setTarefa} />}
        />
      </div>
    </PainelLateral>
  );
}
