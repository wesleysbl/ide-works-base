/**
 * A BARRA DE FILTROS DO ESCOPO — F18B (R09, contrato 3).
 *
 * Busca por título e responsável são a MESMA peça do quadro e de `Todas as
 * tarefas` (`BarraDeFiltro`, F17.55): a espera de digitação, o `Enter` que
 * atravessa, o menu de gente. Aqui ela ganha os recortes que só um escopo
 * tem — time (pasta), cliente (lista), etapa (id real, agrupada por fluxo),
 * prazo — e `Incluir concluídas`. Todos vão ao SERVIDOR: a busca alcança o
 * que não está no lote carregado.
 *
 * ⚠️ A FRASE "N de M" DA `BarraDeFiltro` FICA DESLIGADA (`aplicado={null}`).
 * Quem diz o alcance aqui é `AlcanceDoEscopo`, que sabe separar "abertas" de
 * "com as concluídas" e "carregadas" de "encontradas" — a barra antiga
 * compararia o achado com o total histórico.
 *
 * No celular os recortes recolhem atrás de `Filtros (n)`; busca, responsável
 * e o seletor de modo continuam à vista.
 */

import { SlidersHorizontal } from 'lucide-react';
import { useId, useState } from 'react';

import { BarraDeFiltro } from '@/board/BarraDeFiltro';
import {
  type Agrupamento,
  ROTULO_DO_AGRUPAMENTO,
  agrupamentoPadrao,
  agrupamentosDoEscopo,
  ROTULO_DO_PRAZO,
  opcoesDeEtapa,
  opcoesDeLista,
  opcoesDePasta,
  quantosFiltros,
  temFiltroDoEscopo,
} from '@/board/lista-kanban';
import {
  type CatalogoDoEscopo,
  type Escopo,
  type FiltroDoEscopo,
  PRAZOS,
  type Prazo,
  SEM_FILTRO_DO_ESCOPO,
} from '@/board/tarefas-do-escopo';

function Campo({
  rotulo,
  valor,
  aoMudar,
  children,
  desativado,
  padrao = '',
}: {
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  children: React.ReactNode;
  desativado?: boolean;
  /** O valor que NÃO se destaca: só recorte ligado ganha a borda da marca. */
  padrao?: string;
}) {
  const id = useId();
  return (
    <span className="ek-campo">
      <label className="ek-rotulo" htmlFor={id}>
        {rotulo}
      </label>
      <select
        id={id}
        className="o-campo o-campo-sm o-select ek-select"
        value={valor}
        data-cheio={valor !== padrao}
        disabled={desativado}
        onChange={(e) => aoMudar(e.target.value)}
      >
        {children}
      </select>
    </span>
  );
}

export function FiltrosDoEscopo({
  escopo,
  filtro,
  catalogo,
  ocupado,
  aoMudar,
  agrupar,
  aoAgrupar,
  aposABusca,
}: {
  escopo: Escopo;
  /** O filtro pedido (o do endereço). */
  filtro: FiltroDoEscopo;
  catalogo: CatalogoDoEscopo | null;
  ocupado: boolean;
  aoMudar: (f: FiltroDoEscopo) => void;
  /** Só na Lista: o Kanban já agrupa por fluxo e etapa. */
  agrupar?: Agrupamento;
  aoAgrupar?: (a: Agrupamento) => void;
  /** O que fica na mesma linha da busca, na ponta (o seletor de modo). */
  aposABusca?: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const painel = useId();
  const ligados = quantosFiltros(filtro);
  const pastas = escopo === 'espaco' ? opcoesDePasta(catalogo) : [];
  const listas = escopo === 'lista' ? [] : opcoesDeLista(catalogo, filtro.pasta);
  const etapas = opcoesDeEtapa(catalogo);
  const etapaForaDoMenu = filtro.etapa !== null && !etapas.some((g) => g.etapas.some((e) => e.valor === filtro.etapa));
  const pastaForaDoMenu = filtro.pasta !== null && !pastas.some((p) => p.valor === filtro.pasta);
  const listaForaDoMenu = filtro.lista !== null && !listas.some((l) => l.valor === filtro.lista);

  const mudar = (parcial: Partial<FiltroDoEscopo>) => aoMudar({ ...filtro, ...parcial });

  return (
    <div className="ek-filtros" data-aberto={aberto}>
      <div className="ek-filtros-linha">
        <BarraDeFiltro
          filtro={filtro}
          aplicado={null}
          opcoes={catalogo?.assigneeOptions ?? []}
          semResponsavel={catalogo?.unassignedTasks ?? 0}
          achadas={0}
          total={0}
          ocupado={ocupado && catalogo === null}
          aoMudar={(f) => aoMudar({ ...filtro, texto: f.texto, responsavel: f.responsavel })}
        />
        <button
          type="button"
          className="o-btn o-btn-vidro o-btn-sm ek-abrir-filtros"
          aria-expanded={aberto}
          aria-controls={painel}
          onClick={() => setAberto((v) => !v)}
        >
          <SlidersHorizontal size={15} strokeWidth={1.9} aria-hidden="true" />
          Filtros
          {ligados > 0 && <span className="ek-conta tnum">{ligados}</span>}
        </button>
        {aposABusca && <span className="ek-filtros-fim">{aposABusca}</span>}
      </div>

      <div className="ek-recortes" id={painel}>
        {escopo === 'espaco' && (
          <Campo
            rotulo="Time"
            valor={filtro.pasta ?? ''}
            aoMudar={(v) => {
              const pasta = v === '' ? null : v;
              // O cliente escolhido pode não morar no time novo: sai junto.
              const lista = filtro.lista !== null && pasta !== null && !opcoesDeLista(catalogo, pasta).some((l) => l.valor === filtro.lista) ? null : filtro.lista;
              mudar({ pasta, lista });
            }}
          >
            <option value="">Todos os times</option>
            {pastas.map((p) => (
              <option key={p.valor} value={p.valor}>
                {p.rotulo}
              </option>
            ))}
            {pastaForaDoMenu && <option value={filtro.pasta ?? ''}>Time escolhido</option>}
          </Campo>
        )}

        {escopo !== 'lista' && (
          <Campo rotulo="Cliente" valor={filtro.lista ?? ''} aoMudar={(v) => mudar({ lista: v === '' ? null : v })}>
            <option value="">Todos os clientes</option>
            {listas.map((l) => (
              <option key={l.valor} value={l.valor}>
                {l.rotulo}
              </option>
            ))}
            {listaForaDoMenu && <option value={filtro.lista ?? ''}>Cliente escolhido</option>}
          </Campo>
        )}

        <Campo rotulo="Etapa" valor={filtro.etapa ?? ''} aoMudar={(v) => mudar({ etapa: v === '' ? null : v })}>
          <option value="">Todas as etapas</option>
          {etapas.length === 1
            ? etapas[0].etapas.map((e) => (
                <option key={e.valor} value={e.valor}>
                  {e.rotulo}
                </option>
              ))
            : etapas.map((g, i) => (
                <optgroup key={`${g.fluxo}-${i}`} label={g.fluxo}>
                  {g.etapas.map((e) => (
                    <option key={e.valor} value={e.valor}>
                      {e.rotulo}
                    </option>
                  ))}
                </optgroup>
              ))}
          {etapaForaDoMenu && <option value={filtro.etapa ?? ''}>Etapa escolhida</option>}
        </Campo>

        <Campo rotulo="Prazo" valor={filtro.prazo ?? ''} aoMudar={(v) => mudar({ prazo: v === '' ? null : (v as Prazo) })}>
          <option value="">Qualquer prazo</option>
          {PRAZOS.map((p) => (
            <option key={p} value={p}>
              {ROTULO_DO_PRAZO[p]}
            </option>
          ))}
        </Campo>

        <label className="ek-marcar">
          <input type="checkbox" checked={filtro.concluidas} onChange={(e) => mudar({ concluidas: e.target.checked })} />
          Incluir concluídas
        </label>

        {agrupar !== undefined && aoAgrupar && (
          <Campo rotulo="Agrupar" valor={agrupar} padrao={agrupamentoPadrao(escopo)} aoMudar={(v) => aoAgrupar(v as Agrupamento)}>
            {agrupamentosDoEscopo(escopo).map((a) => (
              <option key={a} value={a}>
                {ROTULO_DO_AGRUPAMENTO[a]}
              </option>
            ))}
          </Campo>
        )}

        {(temFiltroDoEscopo(filtro) || filtro.concluidas) && (
          <button type="button" className="o-btn o-btn-vidro o-btn-sm ek-limpar" onClick={() => aoMudar(SEM_FILTRO_DO_ESCOPO)}>
            Limpar filtros
          </button>
        )}
      </div>
    </div>
  );
}
