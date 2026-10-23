/**
 * O quadro de `Todas as tarefas` — etapa F17.18.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ELE NÃO PODE TER AS COLUNAS DA ESTEIRA
 *
 *   O quadro da F17.9a começa numa LISTA, e as colunas dele são a esteira
 *   resolvida daquela lista — `list_workflow` responde.
 *
 *   `Todas as tarefas` não começa em lista nenhuma. Ao alcance de uma pessoa há
 *   várias esteiras, e a F17.2 mediu nove distintas em produção: `a fazer` da
 *   `Demanda` e `a fazer` do `Conteúdo` são DUAS linhas de banco diferentes,
 *   com ids diferentes, em conjuntos diferentes. Juntá-las pelo nome seria
 *   inventar uma esteira que não existe.
 *
 *   O único vocabulário que TODA esteira fala é o **tipo** do status — os cinco
 *   que o ClickUp define e que a F17.2 copiou sem traduzir. É neles que este
 *   quadro agrupa.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * E POR ISSO O CARTÃO NÃO ARRASTA
 *   Soltar um cartão na coluna `Pronto` não diz em qual status daquela esteira
 *   a tarefa deve cair — `Conteúdo` tem um `done`, `Vídeo` tem outro, e a
 *   `Demanda` tem `demanda concluída`. Adivinhar seria mover o trabalho de
 *   alguém para um lugar que ninguém pediu.
 *
 *   Então o cartão daqui é um cartão que se LÊ e se ABRE. Quem move é o quadro
 *   da lista, que sabe qual esteira está em jogo.
 *
 *   ⚠️ ISTO ESTAVA ESCRITO NA TELA, EM QUATRO LINHAS, E SAIU NA F17.20. O
 *   cartão que não arrasta já não finge que arrasta — ele não tem `draggable`,
 *   e `.q-cartao[data-estatico]` tira o cursor de mão. O sinal está no
 *   comportamento; o parágrafo era a legenda do sinal.
 */

import { type Day } from '@/board/board';
import { ColunaVazia, CorpoDoCartao } from '@/board/CartaoDeTarefa';
import { ProvedorDeMiniaturas } from '@/board/MiniaturaDoCartao';
import { type WorkRow, colunasPorEtapa, colunasPorTipo } from '@/board/meu-trabalho';
// A roda e o arrasto do fundo — F17.25. A MESMA faixa `.q-colunas` do quadro da
// lista, então o mesmo gesto: um quadro que se puxa numa tela e não se puxa na
// outra ensinaria que a função some.
import { usePuxarParaRolar } from '@/board/rolagem';
// A rolagem de cada coluna e da faixa volta ao fechar o cartão — F32. Os
// nomes são os mesmos do quadro da lista; a chave é por endereço, e aqui ela
// inclui `?ver=quadro` e a aba.
import { ROLADOR } from '@/ui/rolagem-interna';
// A trilha compartilhada, na versão curta — F17.25.
import { Trilha } from '@/board/TrilhaDoLugar';
import { trilhaDaLinha } from '@/board/trilha';

export function QuadroPorTipo({
  linhas,
  hoje,
  filtrada = false,
  porEtapa,
}: {
  linhas: readonly WorkRow[];
  hoje: Day;
  /** Há busca/filtro aplicado: coluna sem cartão diz que é a busca — F06B. */
  filtrada?: boolean;
  /**
   * Colunas pelas ETAPAS reais (`Aprovação`, `Alteração`…) em vez dos cinco
   * tipos — `Minhas tarefas`. `base` é o lote inteiro da aba, de onde saem as
   * colunas; ver `colunasPorEtapa`.
   */
  porEtapa?: { base: readonly WorkRow[] };
}) {
  const colunas: { chave: string; rotulo: string; cor: string | null; linhas: WorkRow[] }[] = porEtapa
    ? colunasPorEtapa(linhas, porEtapa.base).map((c) => ({ ...c, chave: c.chave ?? 'sem-status' }))
    : colunasPorTipo(linhas).map((c) => ({ ...c, chave: c.tipo ?? 'sem-status', cor: null }));
  const faixa = usePuxarParaRolar<HTMLDivElement>();

  return (
    <div className="q-colunas" ref={faixa} data-rolagem={ROLADOR.faixa}>
      {/* A arte no cartão — F17.56. Ela entra aqui pelo mesmo motivo que
          `CorpoDoCartao` é compartilhado: `Todas as tarefas` desenha o MESMO
          cartão do quadro da lista, e uma das duas telas sem a arte seria a
          divergência que a F17.18 existe para não deixar acontecer.

          Sai de `linhas`, que é o que ESTA tela desenha — o teto de 500 de
          `board-trabalho` já cortou. */}
      <ProvedorDeMiniaturas ids={linhas.map((t) => t.previewAttachmentId)}>
      {colunas.map((c) => (
        <section
          key={c.chave}
          className="q-coluna"
          style={c.cor ? { ['--cor-status' as string]: c.cor } : undefined}
        >
          <header className="q-coluna-topo">
            <span className="q-ponto" />
            <h2 className="q-coluna-nome truncate">{c.rotulo}</h2>
            <span className="tnum ml-auto text-[0.72rem] text-mute">{c.linhas.length}</span>
          </header>

          <ul className="q-coluna-corpo" data-rolagem={ROLADOR.coluna(c.chave)}>
            {c.linhas.map((t) => (
              /* Sem `draggable`: ver o cabeçalho. O `<li>` que arrasta é o de
                 `pages/Quadro.tsx`, e o corpo é o MESMO dos dois. */
              <li key={t.id} className="q-cartao" data-estatico="true">
                <CorpoDoCartao tarefa={t} hoje={hoje} />
                {/* A trilha entra no cartão porque aqui ele saiu da lista dele:
                    no quadro da lista, "de onde é" está no cabeçalho da tela.

                    F17.25: virou a MESMA peça das outras telas, na versão
                    curta. Antes era um `join(' / ')` — a terceira forma de
                    escrever a mesma coisa no mesmo sistema. */}
                {t.listName !== null && (
                  <p className="q-cartao-trilha">
                    <Trilha
                      degraus={trilhaDaLinha({ ...t, listId: t.listLive ? t.listId : null })}
                      compacta
                    />
                  </p>
                )}
              </li>
            ))}

            {/* F06B: com busca, a coluna vazia diz que é a busca. */}
            {c.linhas.length === 0 && <ColunaVazia filtrada={filtrada} />}
          </ul>
        </section>
      ))}
      </ProvedorDeMiniaturas>
    </div>
  );
}
