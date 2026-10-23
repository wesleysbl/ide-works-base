/**
 * O SELETOR DE CLIENTE — F38, Fase 7.
 *
 * Três lugares usam as peças deste arquivo, com a MESMA regra
 * (`@/board/cliente-no-cartao`):
 *
 *   · o modal de tarefa nova (`ModalDeTarefa`): um chip "Cliente" na fila de
 *     chips. Em lista compartilhada ele é obrigatório e o formulário diz o que
 *     falta ANTES de ir ao servidor; em lista interna "Interna, sem cliente" é
 *     opção; em lista de cliente o chip só MOSTRA o cliente da lista;
 *   · o `+ Adicionar tarefa` da coluna (`AdicionarNaColuna`): o mesmo chip,
 *     dentro da caixinha, só quando a lista é compartilhada — ver a decisão
 *     escrita lá;
 *   · o cartão da tarefa (`pages/Tarefa.tsx`): a propriedade "Cliente", com
 *     a origem ("da lista", "escolhido na tarefa", "diferente do da lista") e
 *     a troca.
 *
 * A LISTA DE CLIENTES É PEDIDA AO ABRIR, e não com o quadro: são dezenas de
 * nomes que só interessam a quem vai escolher. `GET
 * /board/lists/:id/client-options` devolve os ativos, ao alcance e da empresa
 * da lista — o servidor recorta; esta tela não filtra de novo.
 */

import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { nomeCasaComABusca } from '@/board/busca-de-nome';
import {
  type ListaDoCliente,
  ROTULO_DA_ORIGEM,
  origemDoCliente,
  tipoDaLista,
  trocaDeCliente,
} from '@/board/cliente-no-cartao';
import type { TaskDetail } from '@/board/ficha';
import { Balao, IconeCliente, ItemDeMenu, type Lado, Separador } from '@/board/menus';
import { ApiError, api, semSessao } from '@/lib/api';

export type OpcaoDeCliente = { id: string; name: string };

/* ───────────────────────────── a leitura, ao abrir ───────────────────────────── */

/**
 * Os clientes da lista, lidos na primeira abertura do seletor — e relidos se
 * a lista mudar (o modal troca de lista de destino). Nada roda ao montar:
 * quem chama `carregar` é o clique.
 */
function useClientesDaLista(listId: string | null) {
  const [estado, setEstado] = useState<{
    listId: string | null;
    clientes: OpcaoDeCliente[] | null;
    carregando: boolean;
    erro: string | null;
  }>({ listId: null, clientes: null, carregando: false, erro: null });

  const carregar = useCallback(async () => {
    if (listId === null) return;
    if (estado.listId === listId && (estado.clientes !== null || estado.carregando)) return;
    setEstado({ listId, clientes: null, carregando: true, erro: null });
    try {
      const r = await api.clientesDaLista(listId);
      setEstado({ listId, clientes: r.clients, carregando: false, erro: null });
    } catch (e) {
      if (semSessao(e)) {
        window.location.replace('/');
        return;
      }
      setEstado({
        listId,
        clientes: null,
        carregando: false,
        erro: e instanceof ApiError ? e.message : 'Não foi possível ler os clientes.',
      });
    }
  }, [listId, estado.listId, estado.clientes, estado.carregando]);

  const daLista = estado.listId === listId;
  return {
    clientes: daLista ? estado.clientes : null,
    carregando: daLista && estado.carregando,
    erro: daLista ? estado.erro : null,
    carregar,
  };
}

/* ───────────────────────────── o menu ───────────────────────────── */

export function MenuDeClientes({
  clientes,
  carregando,
  erro,
  valor,
  semCliente,
  aoEscolher,
  aoFechar,
  lado,
  ancora,
}: {
  clientes: readonly OpcaoDeCliente[] | null;
  carregando: boolean;
  erro: string | null;
  valor: string | null;
  /** Oferece "Interna, sem cliente" — só em lista interna. */
  semCliente: boolean;
  aoEscolher: (clientId: string | null) => void;
  aoFechar: () => void;
  lado?: Lado;
  /** Para o balão fugir de contêiner que corta (a coluna do quadro). */
  ancora?: HTMLElement | null;
}) {
  const [busca, setBusca] = useState('');
  const filtrados = useMemo(() => {
    const todos = clientes ?? [];
    return todos.filter((c) => nomeCasaComABusca(c.name, busca));
  }, [clientes, busca]);

  const escolher = (id: string | null) => {
    aoEscolher(id);
    aoFechar();
  };

  return (
    <Balao lado={lado} aoFechar={aoFechar} rotulo="Cliente" ancora={ancora}>
      <input
        className="cu-busca"
        data-foco="1"
        value={busca}
        placeholder="Buscar cliente…"
        aria-label="Buscar cliente"
        onChange={(e) => setBusca(e.target.value)}
      />
      {semCliente && (
        <>
          <ItemDeMenu marcado={valor === null} aoEscolher={() => escolher(null)}>
            <span className="rotulo">Interna, sem cliente</span>
          </ItemDeMenu>
          <Separador />
        </>
      )}
      <div className="cu-rolagem" data-clientes="1">
        {erro && <p className="cu-vazio" role="alert">{erro}</p>}
        {!erro && carregando && <p className="cu-vazio" role="status">Buscando os clientes…</p>}
        {!erro && !carregando && clientes !== null && filtrados.length === 0 && (
          <p className="cu-vazio">
            {clientes.length === 0 ? 'Nenhum cliente ativo ao seu alcance.' : 'Nenhum cliente com esse nome.'}
          </p>
        )}
        {filtrados.map((c) => (
          <ItemDeMenu
            key={c.id}
            marcado={valor !== null && valor.toLowerCase() === c.id.toLowerCase()}
            aoEscolher={() => escolher(c.id)}
          >
            <IconeCliente c="h-3.5 w-3.5 shrink-0" />
            <span className="rotulo" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {c.name}
            </span>
          </ItemDeMenu>
        ))}
      </div>
      <p className="cu-vazio">Só clientes ativos da empresa desta lista.</p>
    </Balao>
  );
}

/* ───────────────────────────── na criação ───────────────────────────── */

/**
 * O chip "Cliente" do formulário de tarefa nova (modal e criação rápida).
 *
 * `valorNome` é o nome do escolhido, guardado por quem chama junto com o id:
 * o catálogo pode nem ter sido lido ainda quando o chip é desenhado de novo.
 */
export function ChipDoClienteNaCriacao({
  listId,
  lista,
  valor,
  valorNome,
  aoMudar,
  aberto,
  aoAlternar,
  faltando,
  desativado,
  lado = 'cima',
  flutuante = false,
}: {
  listId: string;
  lista: ListaDoCliente;
  valor: string | null;
  valorNome: string | null;
  aoMudar: (clientId: string | null, nome: string | null) => void;
  aberto: boolean;
  aoAlternar: () => void;
  /** A lista é compartilhada e o cliente ainda não foi escolhido, e a pessoa tentou criar. */
  faltando?: boolean;
  desativado?: boolean;
  lado?: Lado;
  /** Desenhar o balão em portal (a caixinha da coluna fica dentro de contêiner que corta). */
  flutuante?: boolean;
}) {
  const tipo = tipoDaLista(lista);
  const { clientes, carregando, erro, carregar } = useClientesDaLista(listId);
  const [ancora, setAncora] = useState<HTMLElement | null>(null);

  // Lista de cliente: o cliente vem dela. Mostrado, sem seletor — não há o
  // que escolher, e a criação recusaria outro.
  if (tipo === 'cliente') {
    return (
      <span
        className="cu-chip"
        data-cheio="true"
        data-cliente-da-criacao="lista"
        title="A tarefa herda o cliente desta lista"
      >
        <IconeCliente c="h-3.5 w-3.5 shrink-0" />
        <span className="rotulo">{lista.clientName ?? 'cliente da lista'} · da lista</span>
      </span>
    );
  }

  const obrigatorio = tipo === 'compartilhada';
  const rotulo =
    valor !== null
      ? (valorNome ?? 'Cliente escolhido')
      : obrigatorio
        ? 'Cliente (obrigatório)'
        : 'Interna, sem cliente';

  return (
    <span className="cu-ancora">
      <button
        ref={setAncora}
        type="button"
        className="cu-chip"
        aria-expanded={aberto}
        aria-haspopup="menu"
        aria-label={valor !== null ? `Cliente: ${rotulo}` : obrigatorio ? 'Escolher o cliente (obrigatório)' : 'Cliente: interna, sem cliente'}
        data-cheio={valor !== null}
        data-cliente-da-criacao={tipo}
        data-erro={faltando === true && valor === null ? 'true' : undefined}
        disabled={desativado}
        onClick={() => {
          if (!aberto) void carregar();
          aoAlternar();
        }}
      >
        <IconeCliente c="h-3.5 w-3.5 shrink-0" />
        <span className="rotulo">{rotulo}</span>
      </button>
      {aberto && (
        <MenuDeClientes
          clientes={clientes}
          carregando={carregando}
          erro={erro}
          valor={valor}
          semCliente={!obrigatorio}
          aoEscolher={(id) =>
            aoMudar(id, id === null ? null : ((clientes ?? []).find((c) => c.id === id)?.name ?? null))
          }
          aoFechar={aoAlternar}
          lado={lado}
          ancora={flutuante ? ancora : undefined}
        />
      )}
    </span>
  );
}

/* ───────────────────────────── no cartão ───────────────────────────── */

/**
 * A propriedade "Cliente" do cartão da tarefa.
 *
 * Mostra o cliente, de onde ele veio, e — quando a regra deixa — troca. O
 * motivo de não deixar aparece escrito (subtarefa, tarefa com subtarefas,
 * lista de cliente), em vez de um chip que abre e volta recusado.
 */
export function ClienteNaFicha({
  tarefa,
  aberto,
  aoAlternar,
  ocupado,
  aoTrocar,
}: {
  tarefa: Pick<
    TaskDetail,
    | 'id'
    | 'listId'
    | 'parentId'
    | 'subtasks'
    | 'clientId'
    | 'clientName'
    | 'ownClientId'
    | 'listClientId'
    | 'listClientName'
    | 'listRequiresClient'
  >;
  aberto: boolean;
  aoAlternar: () => void;
  ocupado: boolean;
  aoTrocar: (clientId: string | null) => void;
}) {
  const origem = origemDoCliente(tarefa);
  const troca = trocaDeCliente(tarefa);
  const { clientes, carregando, erro, carregar } = useClientesDaLista(tarefa.listId);

  const nome = tarefa.clientId ? (tarefa.clientName ?? 'cliente fora do seu alcance') : 'Sem cliente';
  const compartilhada = tipoDaLista({
    clientId: tarefa.listClientId,
    requiresClient: tarefa.listRequiresClient,
  }) === 'compartilhada';

  return (
    <>
      {troca.pode ? (
        <span className="cu-ancora">
          <button
            type="button"
            className="cu-chip t-cliente"
            aria-expanded={aberto}
            aria-haspopup="menu"
            aria-label={`Cliente: ${nome}. Trocar o cliente`}
            data-cheio={tarefa.clientId !== null}
            data-erro={compartilhada && tarefa.clientId === null ? 'true' : undefined}
            disabled={ocupado}
            onClick={() => {
              if (!aberto && troca.opcoes === 'clientes') void carregar();
              aoAlternar();
            }}
          >
            <IconeCliente c="h-3.5 w-3.5 shrink-0" />
            <span className="rotulo">{nome}</span>
          </button>
          {aberto && troca.opcoes === 'clientes' && (
            <MenuDeClientes
              clientes={clientes}
              carregando={carregando}
              erro={erro}
              valor={tarefa.ownClientId ?? null}
              semCliente={troca.semCliente}
              aoEscolher={aoTrocar}
              aoFechar={aoAlternar}
              lado="baixo"
            />
          )}
          {aberto && troca.opcoes === 'lista' && (
            <Balao lado="baixo" aoFechar={aoAlternar} rotulo="Cliente">
              <ItemDeMenu
                aoEscolher={() => {
                  aoTrocar(null);
                  aoAlternar();
                }}
              >
                <IconeCliente c="h-3.5 w-3.5 shrink-0" />
                <span className="rotulo">Usar o da lista ({tarefa.listClientName ?? 'cliente da lista'})</span>
              </ItemDeMenu>
            </Balao>
          )}
        </span>
      ) : (
        <span className="cu-chip t-cliente" data-cheio={tarefa.clientId !== null} title={troca.motivo}>
          <IconeCliente c="h-3.5 w-3.5 shrink-0" />
          <span className="rotulo">{nome}</span>
        </span>
      )}
      {origem && (
        <span className="t-prop-apoio" data-origem-do-cliente={origem}>
          {origem === 'diferente'
            ? `${ROTULO_DA_ORIGEM.diferente} (lista: ${tarefa.listClientName ?? 'outro cliente'})`
            : ROTULO_DA_ORIGEM[origem]}
        </span>
      )}
      {!origem && compartilhada && (
        <span className="t-prop-apoio" data-origem-do-cliente="falta">
          lista compartilhada: escolha o cliente
        </span>
      )}
      {tarefa.clientId && tarefa.clientName && (
        <Link to={`/cliente/${tarefa.clientId}`} className="t-prop-apoio" aria-label={`Abrir a ficha de ${tarefa.clientName}`}>
          ficha
        </Link>
      )}
      {!troca.pode && <span className="t-prop-apoio">{troca.motivo}</span>}
    </>
  );
}
