/**
 * A VISTA LISTA DO ESCOPO — F18B (R09, contratos 2 e 7).
 *
 *   Tarefa · Cliente/lista · Time/pasta · Etapa · Responsável · Prazo
 *
 * Uma linha por tarefa, numa régua comum a todos os grupos (as colunas se
 * alinham de um grupo para o outro). Quando o grupo já diz a origem ("Time e
 * cliente"), a linha não a repete; quando o grupo é a etapa, a etapa sai da
 * linha. "Sem responsável" e "Sem prazo" são ditos, não deixados em branco.
 *
 * NO CELULAR (< 720 px) A LINHA EMPILHA: título; origem; prazo e responsável
 * lado a lado. Time e etapa ficam atrás de `Detalhes` (botão com
 * `aria-expanded`) — nenhuma tabela larga obrigatória.
 *
 * O TÍTULO É O LINK para a ficha (`/tarefa/:id`), como em `LinhaDeTrabalho`;
 * voltar devolve modo, filtros (endereço) e posição (`LembrarRolagem` + os
 * lotes que o gancho recarrega). F43, Fase 7: o clique simples abre a ficha AO
 * LADO (`LinkDaTarefa`), e a lista nem sai da tela; o `href` é o mesmo.
 */

import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { type Day } from '@/board/board';
import { Avatares, type ConcluirDoCartao, PrazoCurto, SeloUrgente } from '@/board/CartaoDeTarefa';
import { TextoComMencoes } from '@/board/CamposDeMencao';
import { LinkDaTarefa } from '@/board/LinkDaTarefa';
import { textoDasMencoes } from '@/board/mencoes';
import { type GrupoDaLista, type Omissao, origemDaLinha, timeDaLinha } from '@/board/lista-kanban';
import { type LinhaDoEscopo } from '@/board/tarefas-do-escopo';

function Responsavel({ pessoas }: { pessoas: LinhaDoEscopo['assignees'] }) {
  if (pessoas.length === 0) return <span className="ek-nada">Sem responsável</span>;
  const primeiro = pessoas[0].name.split(' ')[0];
  return (
    <span className="ek-quem">
      <Avatares pessoas={pessoas} />
      <span className="ek-quem-nome truncate" aria-hidden="true">
        {pessoas.length === 1 ? primeiro : `${primeiro} +${pessoas.length - 1}`}
      </span>
    </span>
  );
}

function Etapa({ linha }: { linha: LinhaDoEscopo }) {
  return (
    <span className="ek-etapa" style={linha.statusColor ? { ['--cor-status' as string]: linha.statusColor } : undefined}>
      <span className="ek-etapa-ponto" aria-hidden="true" />
      <span className="truncate">{linha.statusName ?? 'Sem etapa'}</span>
    </span>
  );
}

export function LinhaDoEscopoNaLista({
  linha,
  hoje,
  omite,
  concluir,
}: {
  linha: LinhaDoEscopo;
  hoje: Day;
  omite: Omissao;
  /** O ✓ — ausente quando já está concluída ou o fluxo não tem etapa que feche. */
  concluir?: ConcluirDoCartao;
}) {
  const [aberta, setAberta] = useState(false);
  const origem = origemDaLinha(linha);
  const prazo = <PrazoCurto tarefa={linha} hoje={hoje} className="ek-prazo" />;

  return (
    <li className="ek-linha" data-concluida={linha.completedAt !== null} data-aberta={aberta}>
      <span className="ek-c ek-c-tarefa">
        <span className="ek-tarefa-topo">
          {concluir && (
            <button
              type="button"
              className="ek-concluir"
              aria-label={`Concluir ${textoDasMencoes(linha.title)}`}
              title="Concluir"
              disabled={concluir.desativado}
              onClick={concluir.aoConcluir}
            >
              <Check size={13} strokeWidth={2.4} aria-hidden="true" />
            </button>
          )}
          <SeloUrgente prioridade={linha.priority} />
          {/* F43, Fase 7: abre a ficha ao lado, com a lista atrás. */}
          <LinkDaTarefa id={linha.id} className="ek-titulo">
            <TextoComMencoes texto={linha.title} />
          </LinkDaTarefa>
        </span>
        {linha.parentTitle && (
          <span className="ek-mae truncate">
            <span className="sr-only">Subtarefa de </span>↳ {linha.parentTitle}
          </span>
        )}
      </span>

      {!omite.origem && (
        <span className="ek-c ek-c-origem">
          <span className="sr-only">Cliente ou lista: </span>
          {linha.listId && linha.listLive ? (
            <Link to={`/quadro/${linha.listId}`} className="ek-origem truncate" title={`Abrir o quadro de ${linha.listName ?? origem}`}>
              {origem}
            </Link>
          ) : (
            <span className="ek-origem truncate">
              {origem}
              {linha.listId && !linha.listLive && <span className="ek-nada"> · arquivada</span>}
            </span>
          )}
        </span>
      )}

      {!omite.origem && (
        <span className="ek-c ek-c-time ek-secundaria">
          <span className="ek-rotulo-celular">Time</span>
          <span className="sr-only">Time: </span>
          <span className={linha.folderId === null ? 'ek-nada truncate' : 'truncate'}>{timeDaLinha(linha)}</span>
        </span>
      )}

      {!omite.etapa && (
        <span className="ek-c ek-c-etapa ek-secundaria">
          <span className="ek-rotulo-celular">Etapa</span>
          <span className="sr-only">Etapa: </span>
          <Etapa linha={linha} />
        </span>
      )}

      <span className="ek-c ek-c-quem">
        <span className="sr-only">Responsável: </span>
        <Responsavel pessoas={linha.assignees} />
      </span>

      <span className="ek-c ek-c-prazo">
        <span className="sr-only">Prazo: </span>
        {linha.dueOn === null ? <span className="ek-nada">Sem prazo</span> : prazo}
      </span>

      {!(omite.origem && omite.etapa) && (
        <button
          type="button"
          className="ek-detalhes"
          aria-expanded={aberta}
          aria-label={`${aberta ? 'Ocultar' : 'Mostrar'} detalhes de ${linha.title}`}
          onClick={() => setAberta((v) => !v)}
        >
          <ChevronDown size={16} strokeWidth={1.9} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

/** O cabeçalho das colunas — uma vez, no alto. Só no desenho largo. */
function Regua({ omite }: { omite: Omissao }) {
  return (
    <div className="ek-regua" aria-hidden="true" data-omite-origem={omite.origem} data-omite-etapa={omite.etapa}>
      <span>Tarefa</span>
      {!omite.origem && <span>Cliente / lista</span>}
      {!omite.origem && <span>Time</span>}
      {!omite.etapa && <span>Etapa</span>}
      <span>Responsável</span>
      <span>Prazo</span>
    </div>
  );
}

export function ListaDoEscopo({
  grupos,
  hoje,
  hasMore,
  concluirDe,
}: {
  concluirDe?: (linha: LinhaDoEscopo) => ConcluirDoCartao | undefined;
  grupos: readonly GrupoDaLista[];
  hoje: Day;
  /** Há mais no banco: a contagem do grupo por origem é do que chegou. */
  hasMore: boolean;
}) {
  const omite = grupos[0]?.omite ?? { origem: false, etapa: false };
  return (
    <div className="ek-lista" data-omite-origem={omite.origem} data-omite-etapa={omite.etapa}>
      <Regua omite={omite} />
      {grupos.map((g) => (
        <section key={g.chave} className="ek-grupo" aria-label={g.titulo ?? 'Tarefas'}>
          {g.titulo !== null && (
            <header className="ek-grupo-topo" style={g.cor ? { ['--cor-status' as string]: g.cor } : undefined}>
              {g.cor !== null && <span className="ek-etapa-ponto" aria-hidden="true" />}
              <h3 className="ek-grupo-nome truncate">{g.titulo}</h3>
              {g.sobre && <span className="ek-grupo-sobre truncate">{g.sobre}</span>}
              <span
                className="ek-grupo-conta tnum"
                title={
                  g.achadas !== null
                    ? `${g.linhas.length} carregadas de ${g.achadas} nesta etapa`
                    : hasMore
                      ? `${g.linhas.length} carregadas até agora`
                      : `${g.linhas.length} tarefas`
                }
              >
                {g.achadas !== null
                  ? g.achadas !== g.linhas.length
                    ? `${g.linhas.length} de ${g.achadas}`
                    : g.linhas.length
                  : hasMore
                    ? // Sem total por lista no contrato: o número é do que chegou, e diz isso.
                      `${g.linhas.length} ${g.linhas.length === 1 ? 'carregada' : 'carregadas'}`
                    : g.linhas.length}
              </span>
            </header>
          )}
          <ul className="ek-linhas">
            {g.linhas.map((l) => (
              <LinhaDoEscopoNaLista key={l.id} linha={l} hoje={hoje} omite={g.omite} concluir={concluirDe?.(l)} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
