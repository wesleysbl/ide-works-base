/**
 * O TRABALHO DE UM ESCOPO EM LISTA OU KANBAN — F18B (R09). A peça que as
 * telas montam (o espaço nesta fase; pasta, lista e as telas da pessoa na
 * F18C).
 *
 * UM RECORTE, DUAS COMPOSIÇÕES
 *   Os filtros moram no ENDEREÇO (`busca`, `responsavel`, `pasta`, `lista`,
 *   `etapa`, `prazo`, `concluidas`, e `agrupar` na Lista) — só o que está
 *   ligado, como em `Todas as tarefas`. A leitura é UMA (`useTarefasDoEscopo`)
 *   e as duas composições desenham o mesmo estado: alternar Lista/Kanban não
 *   pede nada ao servidor nem mexe em filtro, responsável, prazo ou etapa.
 *
 * O ALCANCE, SEMPRE DITO
 *   "12 de 122 abertas carregadas", "30 encontradas · entre 122 abertas".
 *   Nunca o total histórico do panorama contra um lote (ver `textoDoAlcance`).
 *
 * OS ESTADOS
 *   Carregando (esqueleto), vazio (o escopo não tem tarefa aberta), filtro sem
 *   resultado (com `Limpar filtros`), erro (com `Tentar de novo` quando é
 *   passageiro). Com dados na tela e filtro novo em voo, a tela fica e escurece
 *   um pouco (`aria-busy`) em vez de piscar o esqueleto.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { avisoDaAutomacao } from '@/board/automacoes';
import { useFocoDoCartao } from '@/board/foco-do-cartao';
import { textoDasMencoes } from '@/board/mencoes';
import { today } from '@/board/board';
import { InterruptorDeVazias } from '@/board/EtapasDoQuadro';
import { FiltrosDoEscopo } from '@/board/FiltrosDoEscopo';
import { type ConcluirDoCartao } from '@/board/CartaoDeTarefa';
import { KanbanDoEscopo, type MovimentoDoKanban } from '@/board/KanbanDoEscopo';
import {
  type Agrupamento,
  PARAMETRO_DO_AGRUPAMENTO,
  agrupamentoPadrao,
  agrupamentoValido,
  agruparLinhas,
  aplicarMovimento,
  destinoDaEtapa,
  etapaQueFecha,
  etapaVizinha,
  kanbanDoEscopo,
  temFiltroDoEscopo,
  textoDoAlcance,
} from '@/board/lista-kanban';
import { ListaDoEscopo } from '@/board/ListaDoEscopo';
import {
  type Escopo,
  type FiltroDoEscopo,
  type LinhaDoEscopo,
  SEM_FILTRO_DO_ESCOPO,
  lerFiltroDoEscopo,
  paraEnderecoDoEscopo,
} from '@/board/tarefas-do-escopo';
import { useTarefasDoEscopo } from '@/board/usar-tarefas-do-escopo';
import { ApiError, api, semSessao } from '@/lib/api';
import { useLugar } from '@/ui/aparencia';
import { useParametrosNoEndereco } from '@/ui/endereco';
import { useAoFecharAFichaAoLado } from '@/ui/usar-ficha-ao-lado';
import { EstadoDaPagina } from '@/ui/EstadoDaPagina';
import { Aviso } from '@/ui/primitivos';
import '@/ui/escopo.css';

/** As chaves do filtro no endereço — todas, para `Limpar` apagar cada uma. */
const CHAVES_DO_FILTRO = ['busca', 'responsavel', 'pasta', 'lista', 'etapa', 'prazo', 'concluidas'] as const;

export function TrabalhoDoEscopo({
  escopo,
  id,
  modo,
  seletor,
  nomeDoEscopo,
}: {
  escopo: Escopo;
  id: string;
  modo: 'lista' | 'kanban';
  /** O seletor de modo, na ponta da linha de busca. */
  seletor?: React.ReactNode;
  /** "neste espaço" — para a frase do vazio. */
  nomeDoEscopo: string;
}) {
  const [parametros, definirParametros] = useParametrosNoEndereco();
  const chaveDoFiltro = CHAVES_DO_FILTRO.map((k) => parametros.get(k) ?? '').join('\u0000');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filtro = useMemo(() => lerFiltroDoEscopo(parametros), [chaveDoFiltro]);
  const agrupar = agrupamentoValido(parametros.get(PARAMETRO_DO_AGRUPAMENTO), escopo);

  const trocarFiltro = useCallback(
    (f: FiltroDoEscopo) => {
      const noEndereco = paraEnderecoDoEscopo(f);
      definirParametros(Object.fromEntries(CHAVES_DO_FILTRO.map((k) => [k, noEndereco[k] ?? ''])));
    },
    [definirParametros],
  );
  const trocarAgrupamento = useCallback(
    (a: Agrupamento) => definirParametros({ [PARAMETRO_DO_AGRUPAMENTO]: a === agrupamentoPadrao(escopo) ? '' : a }),
    [definirParametros, escopo],
  );

  const pedido = useMemo(() => ({ escopo, id, filtro }), [escopo, id, filtro]);
  const dados = useTarefasDoEscopo(pedido);
  /* O CARD AO LADO FECHOU — F43, Fase 7. A lista (ou o kanban) não desmontou;
     relê sem esvaziar e sem perder o que estava carregado (`recarregar`), para
     o que mudou no painel aparecer aqui. */
  useAoFecharAFichaAoLado(() => void dados.recarregar());
  const [lugar, definirLugar] = useLugar();
  const hoje = useRef(today()).current;

  const fluxos = useMemo(() => dados.catalogo?.fluxos ?? [], [dados.catalogo]);
  const linhas = dados.linhas;

  /* --- mover de etapa --- */
  const [salvando, setSalvando] = useState<ReadonlySet<string>>(() => new Set());
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'info'; texto: string } | null>(null);

  const mover = useCallback(
    async (taskId: string, etapaId: string) => {
      const linha = linhas?.find((l) => l.id === taskId);
      if (!linha || linha.statusId === etapaId || salvando.has(taskId)) return;
      const destino = destinoDaEtapa(linha, etapaId, fluxos);
      if (!destino.ok) {
        setAviso({ tipo: 'erro', texto: destino.motivo });
        return;
      }
      const origem = fluxos.flatMap((f) => f.etapas).find((e) => e.id === linha.statusId) ?? null;
      dados.ajustar((e) => ({ ...e, ...aplicarMovimento(e.linhas ?? [], e.statusCounts, taskId, destino.etapa) }));
      setAviso(null);
      setSalvando((s) => new Set(s).add(taskId));
      try {
        const r = await api.moverTarefaNoQuadro(taskId, linha.listId as string, etapaId);
        const partes: string[] = [];
        if (r.move.statusRepositioned && r.move.statusId !== etapaId) partes.push('O banco reposicionou o cartão: a etapa pedida não valia para a lista dele.');
        if (r.move.subtasksMoved > 0) partes.push(`${r.move.subtasksMoved} subtarefa(s) foram junto — a subtarefa mora na lista da mãe.`);
        if (r.move.automation !== null) partes.push(avisoDaAutomacao(r.move.automation));
        if (partes.length > 0) setAviso({ tipo: 'info', texto: partes.join(' ') });
        // RELER, e não deduzir — mesma regra do quadro da pasta: a etapa que
        // fecha carimba a conclusão, e só o banco sabe o que mudou junto.
        await dados.recarregar();
      } catch (e) {
        if (semSessao(e)) {
          window.location.replace('/');
          return;
        }
        if (origem) dados.ajustar((x) => ({ ...x, ...aplicarMovimento(x.linhas ?? [], x.statusCounts, taskId, origem) }));
        setAviso({ tipo: 'erro', texto: e instanceof ApiError ? e.message : 'Não foi possível mover. O cartão voltou.' });
      } finally {
        setSalvando((s) => {
          const proximo = new Set(s);
          proximo.delete(taskId);
          return proximo;
        });
      }
    },
    [linhas, fluxos, salvando, dados],
  );

  /* O ✓ de uma linha ou cartão: leva a tarefa à etapa que fecha o fluxo dela —
     a mesma escrita de arrastar para lá. Sem etapa que feche, não há ✓. */
  const concluirDe = useCallback(
    (linha: LinhaDoEscopo): ConcluirDoCartao | undefined => {
      const etapa = etapaQueFecha(linha, fluxos);
      if (etapa === null || linha.listId === null) return undefined;
      return { desativado: salvando.has(linha.id), aoConcluir: () => void mover(linha.id, etapa.id) };
    },
    [fluxos, salvando, mover],
  );

  /* O FOCO ACOMPANHA O CARTÃO e a mudança é DITA — ver `@/board/foco-do-cartao`. */
  const { seguir: seguirOCartao, aviso: avisoDoCartao } = useFocoDoCartao();
  const movimento: MovimentoDoKanban = useMemo(
    () => ({
      aoMover: (taskId, etapaId) => void mover(taskId, etapaId),
      aoMoverPeloTeclado: (taskId, direcao) => {
        const linha = linhas?.find((l) => l.id === taskId);
        const vizinha = linha ? etapaVizinha(linha, fluxos, direcao) : null;
        if (linha && vizinha) {
          seguirOCartao(taskId, textoDasMencoes(linha.title), vizinha.id, vizinha.name);
          void mover(taskId, vizinha.id);
        }
      },
      salvando,
      concluirDe,
    }),
    [mover, linhas, fluxos, salvando, concluirDe, seguirOCartao],
  );

  /* --- derivados --- */
  const grupos = useMemo(() => {
    if (linhas === null) return [];
    const g = agruparLinhas(linhas, agrupar, fluxos, dados.statusCounts);
    // F18C: na lista de um cliente a origem é a própria tela (o título e o chip
    // do cliente); repetir "cliente · lista" e o time em cada linha é ruído.
    return escopo === 'lista' ? g.map((x) => ({ ...x, omite: { ...x.omite, origem: true } })) : g;
  }, [linhas, agrupar, fluxos, dados.statusCounts, escopo]);
  const kanban = useMemo(
    () => kanbanDoEscopo(fluxos, linhas ?? [], dados.statusCounts),
    [fluxos, linhas, dados.statusCounts],
  );

  const aplicado = dados.aplicado ?? filtro;
  const filtrado = temFiltroDoEscopo(aplicado);
  const alcance =
    dados.counts && linhas !== null
      ? textoDoAlcance({ carregadas: linhas.length, counts: dados.counts, filtro: aplicado, hasMore: dados.hasMore })
      : null;
  const paraRecolher = kanban.faixas.flatMap((f) => f.colunas.map((c) => ({ achadas: c.achadas, aVista: c.linhas.length })));
  const vazias = paraRecolher.filter((c) => c.achadas === 0 && c.aVista === 0).length;

  const semResultado = linhas !== null && linhas.length === 0 && !dados.erro;

  return (
    <div className="ek-trabalho" data-modo={modo}>
      <FiltrosDoEscopo
        escopo={escopo}
        filtro={filtro}
        catalogo={dados.catalogo}
        ocupado={dados.carregando}
        aoMudar={trocarFiltro}
        agrupar={modo === 'lista' ? agrupar : undefined}
        aoAgrupar={modo === 'lista' ? trocarAgrupamento : undefined}
        aposABusca={seletor}
      />

      <div className="ek-alcance" role="status" aria-live="polite">
        {alcance ? (
          <>
            <span className="ek-alcance-principal tnum">{alcance.principal}</span>
            {alcance.base && <span className="ek-alcance-base tnum">{alcance.base}</span>}
            {dados.carregando && <span className="ek-alcance-base">· atualizando…</span>}
          </>
        ) : (
          !dados.erro && <span className="ek-alcance-base">Contando as tarefas…</span>
        )}
        {modo === 'kanban' && vazias > 0 && (
          <span className="ek-alcance-fim">
            <InterruptorDeVazias ligado={lugar.vazias} vazias={vazias} aoAlternar={() => definirLugar((l) => ({ ...l, vazias: !l.vazias }))} />
          </span>
        )}
      </div>

      {/* O que o teclado fez no kanban, dito — ver `@/board/foco-do-cartao`. */}
      <p className="sr-only" role="status">{avisoDoCartao}</p>

      {aviso && (
        <div className="mb-3">
          <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>
        </div>
      )}

      {dados.erro && (
        <EstadoDaPagina
          tipo="erro"
          titulo={dados.erro}
          acao={dados.recuperavel ? { rotulo: 'Tentar de novo', aoClicar: () => void dados.tentarDeNovo() } : undefined}
        />
      )}

      {linhas === null && !dados.erro && <EstadoDaPagina tipo="carregando" titulo="Carregando as tarefas…" linhas={5} />}

      {semResultado &&
        (filtrado ? (
          <EstadoDaPagina
            tipo="sem-resultado"
            titulo="Nenhuma tarefa com estes filtros"
            acao={{ rotulo: 'Limpar filtros', aoClicar: () => trocarFiltro({ ...SEM_FILTRO_DO_ESCOPO, concluidas: aplicado.concluidas }) }}
          >
            {`A busca foi feita em todas as ${aplicado.concluidas ? 'tarefas' : 'tarefas abertas'} ${nomeDoEscopo}, não só nas carregadas.`}
          </EstadoDaPagina>
        ) : (
          <EstadoDaPagina
            tipo="vazio"
            titulo={aplicado.concluidas ? `Nenhuma tarefa ${nomeDoEscopo}` : `Nenhuma tarefa aberta ${nomeDoEscopo}`}
            acao={aplicado.concluidas ? undefined : { rotulo: 'Incluir concluídas', aoClicar: () => trocarFiltro({ ...aplicado, concluidas: true }) }}
          >
            {aplicado.concluidas ? 'Quando alguém criar uma tarefa numa lista daqui, ela aparece aqui.' : 'Tudo o que está nas listas daqui já foi concluído.'}
          </EstadoDaPagina>
        ))}

      {linhas !== null && linhas.length > 0 && (
        <div className="ek-corpo" aria-busy={dados.carregando}>
          {modo === 'lista' ? (
            <ListaDoEscopo grupos={grupos} hoje={hoje} hasMore={dados.hasMore} concluirDe={concluirDe} />
          ) : (
            <>
              <KanbanDoEscopo
                faixas={kanban.faixas}
                hoje={hoje}
                recolherVazias={lugar.vazias}
                movimento={movimento}
                hasMore={dados.hasMore}
                carregandoMais={dados.carregandoMais}
                aoCarregarMais={() => void dados.carregarMais()}
                filtrada={filtrado}
              />
              {kanban.semEtapa.length > 0 && (
                <div className="mt-3">
                  <Aviso tipo="atencao">
                    {kanban.semEtapa.length} {kanban.semEtapa.length === 1 ? 'tarefa carregada está' : 'tarefas carregadas estão'} com etapa fora
                    do fluxo da lista e não {kanban.semEtapa.length === 1 ? 'cabe' : 'cabem'} em coluna nenhuma — veja na Lista.
                  </Aviso>
                </div>
              )}
            </>
          )}

          {dados.erroMais && (
            <div className="mt-3">
              <Aviso tipo="erro" acao={{ rotulo: 'Tentar de novo', aoClicar: () => void dados.carregarMais() }}>
                {dados.erroMais}
              </Aviso>
            </div>
          )}

          {dados.hasMore && (
            <div className="ek-mais">
              <button type="button" className="o-btn o-btn-vidro" onClick={() => void dados.carregarMais()} disabled={dados.carregandoMais}>
                {dados.carregandoMais ? 'Carregando…' : 'Carregar mais tarefas'}
              </button>
              {alcance && <span className="ek-mais-conta tnum">{alcance.principal}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * OS RECORTES QUE SÓ A LISTA USA — F18C.
 *
 * Na pasta e na lista, o Kanban é o quadro de sempre (F17.64 / F17.55): ele
 * filtra por busca e responsável. Cliente, etapa e prazo são recortes da
 * Lista (`FiltrosDoEscopo`). Alternar o modo NÃO apaga filtro nenhum — eles
 * ficam no endereço e voltam ao voltar para a Lista —, mas o Kanban diz que
 * não os aplica, em vez de mostrar outro universo calado.
 */
export function FiltrosSoDaLista({ aoVerNaLista }: { aoVerNaLista: () => void }) {
  const [parametros] = useParametrosNoEndereco();
  const ligados = (
    [
      ['lista', 'cliente'],
      ['etapa', 'etapa'],
      ['prazo', 'prazo'],
    ] as const
  )
    .filter(([k]) => (parametros.get(k) ?? '') !== '')
    .map(([, nome]) => nome);
  if (ligados.length === 0) return null;
  const quais = ligados.length === 1 ? ligados[0] : `${ligados.slice(0, -1).join(', ')} e ${ligados[ligados.length - 1]}`;
  return (
    <div className="mb-3" data-filtros-so-da-lista="">
      <Aviso tipo="info" acao={{ rotulo: 'Ver na Lista', aoClicar: aoVerNaLista }}>
        {`O filtro de ${quais} vale na Lista. O Kanban mostra as tarefas pela busca e pelo responsável.`}
      </Aviso>
    </div>
  );
}
