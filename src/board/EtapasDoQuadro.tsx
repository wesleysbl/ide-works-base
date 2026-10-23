/**
 * AS PEÇAS DAS ETAPAS DO QUADRO — F06C (revisão de 28/09, R04).
 *
 *   `InterruptorDeVazias`  o botão "Recolher vazias" da faixa de ferramentas.
 *   `DobraDaEtapa`         o miolo da coluna recolhida: uma faixa estreita com
 *                          a contagem e o nome em pé. A `<section>` em volta é
 *                          a MESMA da coluna aberta (quem a desenha é a página),
 *                          e por isso a soltura de cartão continua valendo.
 *   `NavegacaoDeEtapas`    a fila de atalhos, na ordem do fluxo, quando a faixa
 *                          não cabe na tela.
 *
 * As decisões (quem recolhe, quando a fila aparece, onde a faixa para) são de
 * `./etapas-vazias`; o gancho que mede a tela é `./usar-etapas`.
 */

import { useEffect, useRef, type CSSProperties } from 'react';

import { contagemDaEtapa, rotuloDaRecolhida, tarefasDaEtapa } from '@/board/etapas-vazias';

/* ───────────────────────────── o interruptor ───────────────────────────── */

export function InterruptorDeVazias({
  ligado,
  vazias,
  aoAlternar,
}: {
  ligado: boolean;
  /** Quantas etapas estão vazias de verdade. */
  vazias: number;
  aoAlternar: () => void;
}) {
  return (
    <button
      type="button"
      className="q-interruptor q-interruptor-vazias"
      aria-pressed={ligado}
      title={
        ligado
          ? 'As etapas sem tarefa aparecem como faixas estreitas, na ordem do fluxo. Clique numa faixa para abri-la.'
          : 'Todas as etapas aparecem com a largura inteira, mesmo sem tarefa.'
      }
      onClick={aoAlternar}
    >
      Recolher vazias
      <span className="q-interruptor-conta tnum" aria-hidden="true">
        {vazias}
      </span>
      <span className="sr-only">
        {`, ${vazias} ${vazias === 1 ? 'etapa vazia' : 'etapas vazias'}`}
      </span>
    </button>
  );
}

/* ───────────────────────────── a coluna recolhida ───────────────────────────── */

/**
 * O miolo da coluna recolhida. Um botão só: o clique abre a etapa (e leva o
 * foco para o `Adicionar tarefa` dela, quando houver), que é o caminho para
 * criar ali. Soltar um cartão em cima funciona pela `<section>` da página.
 */
export function DobraDaEtapa({
  nome,
  idDoNome,
  aoAbrir,
}: {
  nome: string;
  /** O id do nome — a `<section>` se nomeia por ele. */
  idDoNome: string;
  aoAbrir: () => void;
}) {
  return (
    <button type="button" className="q-dobra" onClick={aoAbrir} aria-expanded={false} aria-label={rotuloDaRecolhida(nome)} title={`${nome} — sem tarefas. Clique para abrir a etapa.`}>
      <span className="q-ponto" aria-hidden="true" />
      <span className="q-dobra-conta tnum" aria-hidden="true">0</span>
      <span className="q-dobra-nome" id={idDoNome}>{nome}</span>
    </button>
  );
}

/* ───────────────────────────── a navegação ───────────────────────────── */

export type EtapaNaNavegacao = {
  chave: string;
  nome: string;
  cor: string | null;
  achadas: number;
  total: number;
  recolhida: boolean;
};

/**
 * A FILA DE ATALHOS DAS ETAPAS.
 *
 * Um botão por etapa, na ordem do fluxo, com a contagem da coluna. O clique
 * leva a faixa até a coluna (abrindo-a, se estava recolhida). As etapas que
 * estão à vista ficam marcadas — é o "você está aqui" de uma faixa que não
 * cabe na tela. A fila rola de lado sozinha no celular; a página não.
 */
export function NavegacaoDeEtapas({
  etapas,
  aVista,
  aoIr,
}: {
  etapas: readonly EtapaNaNavegacao[];
  aVista: readonly string[];
  aoIr: (chave: string) => void;
}) {
  /* A fila acompanha a faixa: quando a primeira etapa à vista sai da fila
     (celular, fila mais larga que a tela), a fila rola até ela — só a fila,
     com `scrollLeft`, sem `scrollIntoView` (que rolaria a página junto). */
  const fila = useRef<HTMLUListElement | null>(null);
  const primeira = aVista[0];
  useEffect(() => {
    const ul = fila.current;
    if (ul === null || primeira === undefined) return;
    const botao = Array.from(ul.querySelectorAll<HTMLElement>('.q-etapa')).find((b) => b.dataset.chave === primeira);
    if (!botao) return;
    const f = ul.getBoundingClientRect();
    const b = botao.getBoundingClientRect();
    if (b.left < f.left || b.right > f.right) ul.scrollLeft += b.left - f.left - 8;
  }, [primeira]);

  return (
    <nav className="q-etapas" aria-label="Ir para a etapa">
      <ul ref={fila}>
        {etapas.map((e) => (
          <li key={e.chave}>
            <button
              type="button"
              className="q-etapa"
              data-chave={e.chave}
              data-vazia={e.total === 0 ? 'true' : undefined}
              data-a-vista={aVista.includes(e.chave) ? 'true' : undefined}
              style={e.cor ? ({ ['--cor-status' as string]: e.cor } as CSSProperties) : undefined}
              aria-label={`${e.nome}, ${tarefasDaEtapa(e.achadas, e.total)}${e.recolhida ? ', recolhida' : ''}`}
              onClick={() => aoIr(e.chave)}
            >
              <span className="q-ponto" aria-hidden="true" />
              <span className="q-etapa-nome">{e.nome}</span>
              <span className="q-etapa-conta tnum" aria-hidden="true">
                {contagemDaEtapa(e.achadas, e.total)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Retorna uma etapa vazia aberta à faixa compacta, sem alterar as demais. */
export function RecolherEtapa({ nome, aoRecolher }: { nome: string; aoRecolher?: () => void }) {
  if (!aoRecolher) return null;
  return (
    <button type="button" className="q-recolher-etapa" aria-expanded={true}
      aria-label={`Recolher a etapa ${nome}`} title={`Recolher a etapa ${nome}`}
      onClick={aoRecolher}>
      <span aria-hidden="true">«</span>
    </button>
  );
}
