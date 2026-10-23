import { TextoComMencoes } from '@/board/CamposDeMencao';
/**
 * A CAIXA DE ENTRADA, DESENHADA — F17.46.
 *
 * POR QUE ELA É UM COMPONENTE PRÓPRIO, E NÃO O MIOLO DA PÁGINA
 *   A mesma razão de `RegistroDaTarefa` na F17.41: a página carrega os avisos
 *   num efeito, e `renderToStaticMarkup` não roda efeito — um bloco lá dentro
 *   seria invisível para todo teste sem navegador. Aqui ele recebe os avisos por
 *   propriedade, e o teste desenha o que a pessoa vai ler.
 *
 * O QUE ELA DECIDE, E O QUE ELA NÃO DECIDE
 *   Ela desenha. Agrupar é de `@/board/avisos`, que é puro e tem teste; a ordem
 *   dentro de cada grupo é da consulta; e quem alcança o quê são as políticas de
 *   linha. Um `filter` de alcance aqui seria defeito.
 *
 * ⚠️ O TÍTULO É UM LINK PARA A TAREFA, E ISSO É METADE DA ETAPA
 *   Um aviso que diz "isto chegou para você" e não leva até lá obriga a pessoa
 *   a procurar a tarefa no quadro — que é o trabalho que o aviso veio poupar.
 */

import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import {
  type Aviso,
  ROTULO_DO_TIPO,
  agruparAvisos,
  apertoDoPrazo,
  avisoApontaCliente,
  fraseDoAviso,
  origemDoAviso,
  quandoDoAviso,
} from '@/board/avisos';

/**
 * Para onde o aviso leva. Tarefa: a ficha (e o comentário, se houver). Menção
 * no chat: a mensagem. Escrita do agente no mural ou no histórico (F26.6): o
 * cliente — não há tarefa, e um link `/tarefa/` vazio levaria a lugar nenhum.
 */
function destinoDoAviso(a: Aviso): string {
  if (a.tipo === 'mencao_chat' && a.conversationId) {
    return `/chat/${a.conversationId}${a.messageId ? `#chat-msg-${a.messageId}` : ''}`;
  }
  if (a.tipo === 'agente' && avisoApontaCliente(a)) return `/cliente/${a.clientId}`;
  // F40.8: sem tarefa; leva à aba, na semana do aviso.
  if (a.tipo === 'controle') return `/controle-da-semana${a.weekStart ? `?semana=${a.weekStart}` : ''}`;
  return `/tarefa/${a.taskId}${a.commentId ? `#comentario-${a.commentId}` : ''}`;
}
import type { Day } from '@/board/board';
import { EstadoDaPagina } from '@/ui/EstadoDaPagina';

/** O id do título de uma linha — o botão de marcar se descreve por ele. */
const idDoTitulo = (a: Aviso) => `av-titulo-${a.key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

export function ListaDeAvisos({
  avisos,
  hoje,
  aoMarcar,
  ocupado = null,
  agora,
  vazio,
}: {
  avisos: readonly Aviso[];
  hoje: Day;
  /** Marcar como visto, ou desmarcar. A página é que fala com o servidor. */
  aoMarcar: (aviso: Aviso, visto: boolean) => void;
  /**
   * As chaves que estão sendo gravadas agora, para o botão não repetir. Aceita
   * uma chave só (o desenho antigo) ou um conjunto — a F10 grava várias ao
   * mesmo tempo, porque marcar deixou de esperar a resposta.
   */
  ocupado?: string | ReadonlySet<string> | null;
  /** O relógio do "Hoje, 14:32". Injetável para teste; o padrão é agora. */
  agora?: Date;
  /** O estado vazio que a página quer mostrar (depende da vista). */
  vazio?: ReactNode;
}) {
  const grupos = agruparAvisos(avisos);
  const emVoo = (k: string) =>
    ocupado === null ? false : typeof ocupado === 'string' ? ocupado === k : ocupado.has(k);

  /* VAZIO É UM ESTADO, NÃO UMA LEGENDA — F10. Antes era um "Nada novo." solto
     em `eyebrow`; agora é o mesmo bloco quieto das outras telas (F03), e a
     página escolhe a frase conforme a vista. Sem `vazio`, o curto de sempre. */
  if (grupos.length === 0) return <>{vazio ?? <EstadoDaPagina tipo="vazio" titulo="Nada novo." />}</>;

  return (
    <div className="av-caixa">
      {grupos.map((g) => (
        <section key={g.tipo} className="av-grupo" aria-label={ROTULO_DO_TIPO[g.tipo]}>
          <h2 className="av-grupo-titulo">
            {ROTULO_DO_TIPO[g.tipo]}
            <span className="av-grupo-conta tnum">{g.avisos.length}</span>
          </h2>

          <ul className="av-lista">
            {g.avisos.map((a) => {
              const origemBruta = origemDoAviso(a);
              /* No chat o "título" É o nome da conversa; repetir o mesmo nome
                 como origem seria a linha falando duas vezes. */
              const origem = origemBruta !== null && origemBruta !== a.taskTitle ? origemBruta : null;
              const quando = quandoDoAviso(a.occurredAt, agora);
              const destino = destinoDoAviso(a);
              const titulo = idDoTitulo(a);
              return (
                <li
                  key={a.key}
                  className="av-linha"
                  data-aviso={a.key}
                  data-tipo={a.tipo}
                  data-visto={a.seen}
                  /* O aperto do prazo entra como ATRIBUTO, e a cor sai do CSS.
                     Só o aviso de prazo o tem; nos outros ele é ausente, e a
                     regra não pinta nada. */
                  data-aperto={apertoDoPrazo(a.dueOn, hoje) ?? undefined}
                >
                  {/* A marca de "novo" — o ponto verde. É desenho: quem lê com
                      leitor de tela já está na aba Novos, e o botão diz o estado. */}
                  <span className="av-ponto" aria-hidden="true" />

                  <div className="av-corpo">
                    {/* DESTINO E MARCAR SÃO ALVOS SEPARADOS — F10. A linha não é
                        clicável inteira: o título leva ao destino, o botão (no
                        canto de baixo, à direita) só marca. Um clique no botão
                        nunca navega, e abrir o destino nunca marca. */}
                    <Link to={destino} className="av-titulo" id={titulo}>
                      <TextoComMencoes texto={a.taskTitle} />
                    </Link>
                    {quando && (
                      <time className="av-quando tnum" dateTime={quando.iso} title={quando.completo}>
                        {quando.rotulo}
                      </time>
                    )}
                    <p className="av-frase">{fraseDoAviso(a, hoje)}</p>

                    <div className="av-pe">
                      <div className="av-info">
                        {origem !== null && <p className="av-origem">{origem}</p>}
                        {/* O CAMINHO DE VOLTA, A UM CLIQUE — F21.3. A frase já diz
                            que existe volta; este link evita que a pessoa tenha de
                            procurar a tela onde se desfaz, revoga e libera cota. */}
                        {a.tipo === 'agente' && <div className="av-atalhos">
                          {/* O RÓTULO SEGUE O QUE O LINK DE FATO ABRE. No movimento
                              de card não há comentário nenhum, e "ver o que ele
                              escreveu" prometeria um texto que não existe. A página
                              do cliente abre na primeira aba: o rótulo promete o
                              cliente, que é o que abre. */}
                          <Link to={destino}>
                            {avisoApontaCliente(a)
                              ? 'Abrir o cliente'
                              : a.commentId
                                ? 'Ver o que ele escreveu'
                                : 'Ver a tarefa'}
                          </Link>
                          <Link to="/conexoes">Agentes de IA</Link>
                        </div>}
                        {a.tipo === 'mencao' && <div className="av-atalhos">
                          <Link to={`/tarefa/${a.taskId}${a.commentId ? `#comentario-${a.commentId}` : ''}`}>Abrir {a.commentId ? 'comentário' : 'card'}</Link>
                          {a.listId && <Link to={`/quadro/${a.listId}`}>Abrir lista</Link>}
                        </div>}
                        {/* F42, Fase 7: o motivo do pedido de ajustes é o comentário
                            da decisão; aprovar sem comentário leva ao card. */}
                        {a.tipo === 'aprovacao' && <div className="av-atalhos">
                          <Link to={`/tarefa/${a.taskId}${a.commentId ? `#comentario-${a.commentId}` : ''}`}>
                            {a.commentId ? 'Ver o que o cliente escreveu' : 'Abrir card'}
                          </Link>
                        </div>}
                        {a.tipo === 'mencao_chat' && a.conversationId && <div className="av-atalhos">
                          <Link to={`/chat/${a.conversationId}${a.messageId ? `#chat-msg-${a.messageId}` : ''}`}>
                            Abrir conversa
                          </Link>
                        </div>}
                      </div>
  
                      {/* MARCAR É UM CLIQUE, E A VOLTA TAMBÉM. Sem a volta, um toque
                          errado apagaria para sempre o único lugar que diz "isto
                          chegou para você". O nome visível é curto; o leitor de tela
                          ouve também DE QUAL aviso (aria-describedby = o título). */}
                      <button
                        type="button"
                        className="av-botao"
                        aria-describedby={titulo}
                        disabled={emVoo(a.key)}
                        onClick={() => aoMarcar(a, !a.seen)}
                      >
                        {a.seen ? 'Trazer de volta' : 'Marcar como visto'}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
