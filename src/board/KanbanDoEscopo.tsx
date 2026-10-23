/**
 * O KANBAN DO ESCOPO — F18B (R09, contrato 8).
 *
 * UMA FAIXA POR FLUXO, COM AS ETAPAS REAIS DELE
 *   O espaço junta listas de fluxos diferentes. Cada fluxo que tem tarefa no
 *   recorte ganha a sua faixa — nome do fluxo, quantas listas o usam, quantas
 *   tarefas — e, dentro dela, as colunas das etapas na ordem do fluxo. Duas
 *   etapas `A fazer` de fluxos diferentes ficam em faixas diferentes.
 *
 * O CARTÃO É O DO QUADRO (`CorpoDoCartao`), COM A LISTA DE ORIGEM
 *   Como no quadro da pasta: a coluna junta clientes, e o cartão sem
 *   procedência seria trabalho sem dono.
 *
 * ROLAGENS INDEPENDENTES, E A VOLTA DA FICHA
 *   Cada faixa rola de lado (`data-rolagem="faixa:<fluxo>"`), cada coluna rola
 *   por dentro (`coluna:<etapa>` — ids de etapa são únicos). A
 *   `LembrarRolagemInterna` da F32 devolve as duas ao voltar. As etapas vazias
 *   recolhem como na F06C (mesmo gancho, mesma dobra, mesma preferência).
 *
 * MOVER DE ETAPA
 *   Arrasto, ou ← → com o cartão focado — sempre DENTRO do fluxo do cartão.
 *   Quem decide se o destino vale é a tela que chama (`destinoDaEtapa`); a
 *   escrita é a do quadro (`ideworks.move_task`).
 */

import { useMemo, useState } from 'react';

import { type Day } from '@/board/board';
import { ColunaVazia, CorpoDoCartao, type ConcluirDoCartao } from '@/board/CartaoDeTarefa';
import { RecolherEtapa, DobraDaEtapa, NavegacaoDeEtapas } from '@/board/EtapasDoQuadro';
import { mostrarNavegacao } from '@/board/etapas-vazias';
import { type ColunaDoKanban, type FaixaDoKanban } from '@/board/lista-kanban';
import { textoDasMencoes } from '@/board/mencoes';
import { ProvedorDeMiniaturas } from '@/board/MiniaturaDoCartao';
import { usePuxarParaRolar } from '@/board/rolagem';
import { type LinhaDoEscopo } from '@/board/tarefas-do-escopo';
import { useEtapasDoQuadro } from '@/board/usar-etapas';

export type MovimentoDoKanban = {
  /** O cartão foi solto (ou mandado pelo teclado) em `etapaId`. */
  aoMover: (taskId: string, etapaId: string) => void;
  /** ← → no cartão focado. */
  aoMoverPeloTeclado: (taskId: string, direcao: -1 | 1) => void;
  salvando: ReadonlySet<string>;
  /** O ✓ do cartão — `undefined` quando o fluxo não tem etapa que feche. */
  concluirDe: (linha: LinhaDoEscopo) => ConcluirDoCartao | undefined;
};

function Cartao({
  linha,
  hoje,
  salvando,
  aoIniciar,
  aoTerminar,
  aoTeclar,
  concluir,
}: {
  linha: LinhaDoEscopo;
  concluir?: ConcluirDoCartao;
  hoje: Day;
  salvando: boolean;
  aoIniciar: () => void;
  aoTerminar: () => void;
  aoTeclar: (direcao: -1 | 1) => void;
}) {
  return (
    <li
      className="q-cartao"
      // O foco acha o cartão por aqui depois de trocar de etapa pelas setas.
      data-cartao={linha.id}
      draggable={!salvando}
      data-salvando={salvando}
      tabIndex={0}
      aria-label={`${textoDasMencoes(linha.title)}, da lista ${linha.listName ?? 'sem lista'}, etapa ${linha.statusName ?? 'sem etapa'}. Use as setas para a esquerda e para a direita para mudar de etapa dentro do fluxo.`}
      onDragStart={(e) => {
        if (e.target !== e.currentTarget) return;
        e.dataTransfer.setData('text/plain', linha.id);
        e.dataTransfer.effectAllowed = 'move';
        aoIniciar();
      }}
      onDragEnd={aoTerminar}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || salvando) return;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          aoTeclar(e.key === 'ArrowLeft' ? -1 : 1);
        }
      }}
    >
      <CorpoDoCartao
        tarefa={linha}
        hoje={hoje}
        concluir={concluir}
        lista={linha.listId ? { id: linha.listId, name: linha.listName ?? 'Lista' } : undefined}
      />
    </li>
  );
}

function Coluna({
  coluna,
  idDoNome,
  recolhida,
  aoAbrir,
  aoRecolher,
  hoje,
  movimento,
  arrastando,
  setArrastando,
  hasMore,
  carregandoMais,
  aoCarregarMais,
  filtrada,
}: {
  coluna: ColunaDoKanban;
  idDoNome: string;
  recolhida: boolean;
  aoAbrir: () => void;
  aoRecolher?: () => void;
  hoje: Day;
  movimento: MovimentoDoKanban;
  arrastando: string | null;
  setArrastando: (id: string | null) => void;
  hasMore: boolean;
  carregandoMais: boolean;
  aoCarregarMais: () => void;
  filtrada: boolean;
}) {
  const [alvo, setAlvo] = useState(false);
  const { etapa, linhas, achadas } = coluna;
  return (
    <section
      className="q-coluna"
      data-etapa={etapa.id}
      data-recolhida={recolhida ? 'true' : undefined}
      data-alvo={alvo}
      tabIndex={-1}
      aria-labelledby={idDoNome}
      style={etapa.color ? { ['--cor-status' as string]: etapa.color } : undefined}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setAlvo(true);
      }}
      onDragLeave={() => setAlvo(false)}
      onDrop={(e) => {
        e.preventDefault();
        setAlvo(false);
        const id = e.dataTransfer.getData('text/plain') || arrastando;
        setArrastando(null);
        if (id) movimento.aoMover(id, etapa.id);
      }}
    >
      {recolhida ? (
        <DobraDaEtapa nome={etapa.name} idDoNome={idDoNome} aoAbrir={aoAbrir} />
      ) : (
        <>
          <header className="q-coluna-topo">
            <span className="q-ponto" />
            <h3 className="q-coluna-nome truncate" id={idDoNome}>
              {etapa.name}
            </h3>
            <span className="tnum ml-auto text-[0.72rem] text-plat-dim" title={`${linhas.length} carregadas de ${achadas} nesta etapa`}>
              {linhas.length === achadas ? achadas : `${linhas.length} de ${achadas}`}
            </span>
            <RecolherEtapa nome={etapa.name} aoRecolher={aoRecolher} />
          </header>
          <ul className="q-coluna-corpo" data-rolagem={`coluna:${etapa.id}`}>
            {linhas.map((l) => (
              <Cartao
                key={l.id}
                linha={l}
                hoje={hoje}
                salvando={movimento.salvando.has(l.id)}
                aoIniciar={() => setArrastando(l.id)}
                aoTerminar={() => setArrastando(null)}
                aoTeclar={(d) => movimento.aoMoverPeloTeclado(l.id, d)}
                concluir={movimento.concluirDe(l)}
              />
            ))}
            {linhas.length === 0 && <ColunaVazia filtrada={filtrada && etapa.total > 0} total={etapa.total} />}
          </ul>
          {linhas.length < achadas && hasMore && (
            <div className="q-coluna-corte">
              <span className="tnum" aria-live="polite">
                {linhas.length} de {achadas}
              </span>
              <button type="button" className="q-coluna-mais" onClick={aoCarregarMais} disabled={carregandoMais}>
                {carregandoMais ? 'Buscando…' : 'Carregar mais'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Faixa({
  faixa,
  indice,
  recolherVazias,
  ...resto
}: {
  faixa: FaixaDoKanban;
  indice: number;
  recolherVazias: boolean;
  hoje: Day;
  movimento: MovimentoDoKanban;
  arrastando: string | null;
  setArrastando: (id: string | null) => void;
  hasMore: boolean;
  carregandoMais: boolean;
  aoCarregarMais: () => void;
  filtrada: boolean;
}) {
  const puxar = usePuxarParaRolar<HTMLDivElement>();
  const paraRecolher = useMemo(
    () => faixa.colunas.map((c) => ({ chave: c.etapa.id, total: c.achadas, aVista: c.linhas.length })),
    [faixa.colunas],
  );
  const etapas = useEtapasDoQuadro({ quadroId: faixa.fluxo.id, faixaDaTela: `fluxo:${faixa.fluxo.id}`, colunas: paraRecolher, recolher: recolherVazias, puxar });
  const idDoTitulo = `ek-fluxo-${indice}`;

  return (
    <section className="ek-faixa" aria-labelledby={idDoTitulo}>
      <header className="ek-faixa-topo">
        <h2 className="ek-faixa-nome" id={idDoTitulo}>
          {faixa.fluxo.name}
        </h2>
        <span className="ek-faixa-sobre tnum">
          {faixa.fluxo.lists} {faixa.fluxo.lists === 1 ? 'lista' : 'listas'}
          <span aria-hidden="true"> · </span>
          {faixa.carregadas === faixa.achadas ? faixa.achadas : `${faixa.carregadas} de ${faixa.achadas}`}{' '}
          {faixa.achadas === 1 ? 'tarefa' : 'tarefas'}
        </span>
      </header>
      {mostrarNavegacao(faixa.colunas.length, etapas.transborda) && (
        <NavegacaoDeEtapas
          etapas={faixa.colunas.map((c) => ({
            chave: c.etapa.id,
            nome: c.etapa.name,
            cor: c.etapa.color,
            achadas: c.linhas.length,
            total: c.achadas,
            recolhida: etapas.recolhidas.has(c.etapa.id),
          }))}
          aVista={etapas.aVista}
          aoIr={etapas.irPara}
        />
      )}
      <div
        className="q-colunas ek-colunas"
        ref={etapas.ref}
        data-rolagem={`faixa:${faixa.fluxo.id}`}
        data-recolhe={etapas.recolhidas.size > 0 ? 'true' : undefined}
      >
        {faixa.colunas.map((c, i) => (
          <Coluna
            key={c.etapa.id}
            coluna={c}
            idDoNome={`${idDoTitulo}-etapa-${i}`}
            recolhida={etapas.recolhidas.has(c.etapa.id)}
            aoAbrir={() => etapas.abrir(c.etapa.id)}
            aoRecolher={etapas.recolhiveis.has(c.etapa.id) ? () => etapas.fechar(c.etapa.id) : undefined}
            {...resto}
          />
        ))}
      </div>
    </section>
  );
}

export function KanbanDoEscopo({
  faixas,
  hoje,
  recolherVazias,
  movimento,
  hasMore,
  carregandoMais,
  aoCarregarMais,
  filtrada,
}: {
  faixas: readonly FaixaDoKanban[];
  hoje: Day;
  recolherVazias: boolean;
  movimento: MovimentoDoKanban;
  hasMore: boolean;
  carregandoMais: boolean;
  aoCarregarMais: () => void;
  filtrada: boolean;
}) {
  const [arrastando, setArrastando] = useState<string | null>(null);
  const artes = useMemo(() => faixas.flatMap((f) => f.colunas.flatMap((c) => c.linhas.map((l) => l.previewAttachmentId))), [faixas]);
  return (
    <ProvedorDeMiniaturas ids={artes}>
      <div className="ek-kanban">
        {faixas.map((f, i) => (
          <Faixa
            key={f.fluxo.id}
            faixa={f}
            indice={i}
            recolherVazias={recolherVazias}
            hoje={hoje}
            movimento={movimento}
            arrastando={arrastando}
            setArrastando={setArrastando}
            hasMore={hasMore}
            carregandoMais={carregandoMais}
            aoCarregarMais={aoCarregarMais}
            filtrada={filtrada}
          />
        ))}
      </div>
    </ProvedorDeMiniaturas>
  );
}
