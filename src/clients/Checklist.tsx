/**
 * A aba Checklist — etapa F4.8.
 *
 * A interface diz "Demandas"; o schema diz `tasks`. Não é inconsistência: é a
 * decisão D5 (schema em inglês, tela em português) somada à regra 10 (o modelo
 * de tarefa é construído uma vez só, e o Pilar B vai reusar este).
 *
 * O QUE ELA MOSTRA PRIMEIRO
 *   O que está atrasado. A ordenação e o estado moram em `clients/demandas.ts`,
 *   com 19 testes — inclusive o caso que o legado erra: prazo é um DIA, então
 *   às 23h59 do dia do prazo a demanda ainda não está atrasada.
 *
 * UMA GRAMÁTICA COM AS OUTRAS ÁREAS — F11C do plano UX
 *   Cabeça (título · resumo em linha · ações), lista num cartão só com fio
 *   entre as linhas, e três grupos: pendentes, concluídas e — só quando se
 *   pede — arquivadas (`agruparDemandas`). Editar abre o formulário NO LUGAR
 *   da demanda, e não no alto da página longe dela. Demanda do cliente não é
 *   subtarefa nem checklist de tarefa do quadro: o modelo é este, sozinho.
 *
 * O TRABALHO DE AGORA PRIMEIRO — R05 da revisão de 28/09
 *   Um cliente real tinha 54 concluídas, de meses anteriores, com descrições
 *   longas abertas e `**` cru na tela. Agora: a lista diz o alcance ("todas
 *   as demandas deste cliente" — a competência do topo NÃO filtra aqui), as
 *   concluídas nascem recolhidas, a descrição abre só quando se pede e vem
 *   desenhada pelo mesmo `Markdown` seguro do briefing da tarefa. Editar
 *   continua mexendo no texto ORIGINAL.
 *
 * LISTA | KANBAN — F18C (revisão de 28/09, R09)
 *   O Kanban usa os TRÊS ESTADOS que a demanda já tem — Pendentes, Concluídas
 *   e (com "Ver arquivadas") Arquivadas — e nada além. Mudar de coluna é o
 *   mesmo gesto da Lista (marcar, desmarcar, arquivar, tirar do arquivo), com a
 *   mesma escrita. Demanda não vira tarefa do quadro. O modo é preferência
 *   deste cliente (`@/ui/lugar`, `checklist:<id>`), fora do endereço.
 *
 * ARQUIVAR NÃO É APAGAR
 *   Arquivada sai da lista e continua existindo, com a data em que saiu.
 *   Apagar existe também, e pede confirmação — porque é o único caminho sem
 *   volta desta tela.
 */

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  type Demanda,
  ROTULO_DO_ESTADO,
  agruparDemandas,
  diasAteOPrazo,
  estadoDaDemanda,
  resumirDemandas,
} from '@/clients/demandas';
import { SeletorDeModo } from '@/board/SeletorDeForma';
import { useModoDaTela } from '@/board/usar-modo';
import { type ColunaDeEstado, QuadroDeEstados } from '@/clients/QuadroDeEstados';
import { ApiError, api } from '@/lib/api';
import { EstadoDaPagina } from '@/ui/EstadoDaPagina';
import { dataCurtaDoInstante } from '@/ui/grade-do-mes';
import { IconeArquivo, IconeChevron, IconeLapis, IconeLixeira, IconeMais, IconePessoas } from '@/ui/Icones';
import { Markdown } from '@/ui/Markdown';
import { Area, Aviso, Campo, Selo, type Tom } from '@/ui/primitivos';
// As classes `md-*` do texto desenhado moram na folha do briefing.
import '@/ui/tarefa.css';

const TOM: Record<ReturnType<typeof estadoDaDemanda>, Tom> = {
  atrasada: 'err',
  hoje: 'warn',
  em_dia: 'neutro',
  sem_prazo: 'neutro',
  concluida: 'ok',
};

/** O DIA (`dueOn`) em DD/MM/AAAA. Para um instante, `dataCurtaDoInstante`. */
const dataCurta = (dia: string) => dia.slice(0, 10).split('-').reverse().join('/');

type Pessoa = { id: string; name: string };

type Rascunho = {
  id: string | null;
  title: string;
  description: string;
  dueOn: string;
  assigneeIds: string[];
};

const RASCUNHO_VAZIO: Rascunho = {
  id: null,
  title: '',
  description: '',
  dueOn: '',
  assigneeIds: [],
};

/* ─────────────────────────── o formulário ─────────────────────────── */

function FormularioDeDemanda({
  rotulo,
  rascunho,
  equipe,
  salvando,
  aoMudar,
  aoSalvar,
  aoCancelar,
}: {
  /** O nome do formulário — o título ORIGINAL, que não muda enquanto se digita. */
  rotulo: string;
  rascunho: Rascunho;
  equipe: Pessoa[];
  salvando: boolean;
  aoMudar: (r: Rascunho) => void;
  aoSalvar: (e: FormEvent) => void;
  aoCancelar: () => void;
}) {
  return (
    <form
      onSubmit={aoSalvar}
      className="o-form"
      aria-label={rotulo}
    >
      <Campo
        rotulo="O que precisa ser feito *"
        placeholder="Ex: aprovar roteiro do vídeo institucional"
        value={rascunho.title}
        autoFocus
        onChange={(e) => aoMudar({ ...rascunho, title: e.target.value })}
      />

      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <Campo
          rotulo="Prazo"
          type="date"
          dica="Opcional — sem prazo não vira atraso."
          value={rascunho.dueOn}
          onChange={(e) => aoMudar({ ...rascunho, dueOn: e.target.value })}
        />

        <div>
          <span className="o-rotulo">
            <IconePessoas className="mr-1 inline h-3 w-3" />
            Responsáveis
          </span>
          <div className="flex flex-wrap gap-1">
            {equipe.length === 0 && (
              <span className="text-[0.72rem] text-mute">Ninguém ativo para atribuir.</span>
            )}
            {equipe.map((p) => {
              const marcado = rascunho.assigneeIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={marcado}
                  aria-label={`${p.name} é responsável`}
                  className="o-btn o-btn-vidro o-btn-sm"
                  onClick={() =>
                    aoMudar({
                      ...rascunho,
                      assigneeIds: marcado
                        ? rascunho.assigneeIds.filter((x) => x !== p.id)
                        : [...rascunho.assigneeIds, p.id],
                    })
                  }
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <Area
        rotulo="Detalhes"
        placeholder="Contexto, links, o que combinar…"
        value={rascunho.description}
        onChange={(e) => aoMudar({ ...rascunho, description: e.target.value })}
      />

      {/* UMA AÇÃO PRINCIPAL POR TELA — F43 Fase 10. O verde sólido é do
          "Nova demanda" no alto da aba; aqui o confirmar é o tom (vidro) e o
          cancelar é texto (fantasma). */}
      <div className="flex justify-end gap-2">
        <button type="button" className="o-btn o-btn-fantasma o-btn-sm" onClick={aoCancelar}>
          Cancelar
        </button>
        <button type="submit" className="o-btn o-btn-vidro o-btn-sm" disabled={salvando}>
          {salvando ? 'Salvando…' : rascunho.id ? 'Salvar' : 'Criar demanda'}
        </button>
      </div>
    </form>
  );
}

/* ─────────────────────────── a aba ─────────────────────────── */

const prazoCurto = (dias: number) =>
  dias < 0 ? `${Math.abs(dias)}d atrás` : dias === 0 ? 'hoje' : `em ${dias}d`;

export function Checklist({ clienteId }: { clienteId: string }) {
  const [demandas, setDemandas] = useState<Demanda[]>([]);
  const [equipe, setEquipe] = useState<Pessoa[]>([]);
  const [verArquivadas, setVerArquivadas] = useState(false);
  /** As concluídas nascem recolhidas: o trabalho de agora vem primeiro (R05). */
  const [verConcluidas, setVerConcluidas] = useState(false);
  /** As demandas com a descrição aberta. Fechada é o padrão (R05). */
  const [comDetalhes, setComDetalhes] = useState<ReadonlySet<string>>(() => new Set());
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  /** A leitura falhou — F11C: separada da recusa de um gesto. Sem lista,
      "nenhuma demanda" seria mentira; a tela diz que não leu. */
  const [erroDaLeitura, setErroDaLeitura] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [modo, escolherModo] = useModoDaTela('checklist', clienteId, { endereco: false });
  /** Cartões esperando o servidor depois de mudar de coluna. */
  const [movendo, setMovendo] = useState<ReadonlySet<string>>(() => new Set());

  /* Se a leitura que está na tela trouxe as arquivadas. Ligar "Ver arquivadas"
     relê em segundo plano: até a resposta, a coluna/grupo diz "Carregando", e
     não "Nenhuma arquivada" — que seria mentira (F18C). */
  const [lidoComArquivadas, setLidoComArquivadas] = useState(false);
  /** Só a resposta da leitura mais recente vale (ligar/desligar rápido). */
  const leitura = useRef(0);
  const clienteLido = useRef<string | null>(null);

  const carregar = useCallback(async () => {
    const vez = ++leitura.current;
    try {
      const r = await api.demandas(clienteId, verArquivadas);
      if (vez !== leitura.current) return;
      setDemandas(r.tasks as Demanda[]);
      setLidoComArquivadas(verArquivadas);
      setErroDaLeitura(null);
    } catch (e) {
      if (vez !== leitura.current) return;
      setErroDaLeitura(e instanceof ApiError ? e.message : 'Não foi possível carregar as demandas.');
    } finally {
      if (vez === leitura.current) setCarregando(false);
    }
  }, [clienteId, verArquivadas]);

  useEffect(() => {
    // A tela inteira espera só na primeira leitura do cliente; alternar as
    // arquivadas não apaga o que já está na tela.
    if (clienteLido.current !== clienteId) {
      clienteLido.current = clienteId;
      setCarregando(true);
    }
    void carregar();
  }, [carregar, clienteId]);

  const carregandoArquivadas = verArquivadas && !lidoComArquivadas;

  useEffect(() => {
    // A equipe muda muito menos que as demandas, e é a mesma para qualquer
    // cliente — por isso não entra no `carregar`.
    api
      .equipe()
      .then((r) => setEquipe(r.team))
      .catch(() => setEquipe([]));
  }, []);

  async function executar(acao: () => Promise<unknown>) {
    setErro(null);
    try {
      await acao();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível concluir.');
    }
    await carregar();
  }

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    if (rascunho === null) return;

    if (rascunho.title.trim() === '') {
      setErro('A demanda precisa de um título.');
      return;
    }
    setErro(null);
    setSalvando(true);

    const corpo = {
      title: rascunho.title,
      description: rascunho.description.trim() === '' ? null : rascunho.description,
      dueOn: rascunho.dueOn === '' ? null : rascunho.dueOn,
      assigneeIds: rascunho.assigneeIds,
    };

    try {
      if (rascunho.id) await api.salvarDemanda(rascunho.id, corpo);
      else await api.criarDemanda(clienteId, corpo);
      setRascunho(null);
      await carregar();
    } catch (e) {
      // O rascunho FICA aberto, com o que foi escrito: a recusa não apaga a
      // edição pendente.
      setErro(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  const grupos = useMemo(() => agruparDemandas(demandas), [demandas]);
  // O resumo conta só o que não está arquivado: ligar "Ver arquivadas" não
  // pode mudar os números do topo.
  const resumo = useMemo(
    () => resumirDemandas([...grupos.pendentes, ...grupos.concluidas]),
    [grupos],
  );

  const original = rascunho?.id ? demandas.find((d) => d.id === rascunho.id) : undefined;
  const formulario = (
    <FormularioDeDemanda
      rotulo={original ? `Editar a demanda “${original.title}”` : 'Nova demanda'}
      rascunho={rascunho ?? RASCUNHO_VAZIO}
      equipe={equipe}
      salvando={salvando}
      aoMudar={setRascunho}
      aoSalvar={salvar}
      aoCancelar={() => {
        setRascunho(null);
        setErro(null);
      }}
    />
  );

  const avisoDoGesto = erro && (
    <div className="mb-3">
      <Aviso tipo="erro">{erro}</Aviso>
    </div>
  );

  function linha(d: Demanda) {
    if (rascunho?.id === d.id) {
      return (
        <li key={d.id} className="cl-linha-form">
          {avisoDoGesto}
          {formulario}
        </li>
      );
    }
    const estado = estadoDaDemanda(d);
    const feita = d.completedAt !== null;

    return (
      <li key={d.id} className="cl-linha" data-feito={feita || undefined} data-tom={estado === 'atrasada' ? 'err' : undefined}>
        {corpoDaDemanda(d)}
      </li>
    );
  }

  /** Caixa, corpo e ações de uma demanda — a linha da Lista e o cartão do Kanban. */
  function corpoDaDemanda(d: Demanda) {
    const estado = estadoDaDemanda(d);
    const feita = d.completedAt !== null;
    const dias = diasAteOPrazo(d.dueOn);
    const prazo = d.dueOn ? `, prazo ${dataCurta(d.dueOn)}` : '';

    return (
      <>
        <input
          type="checkbox"
          className="cl-marca"
          checked={feita}
          aria-label={`Concluir “${d.title}”${prazo}`}
          onChange={() => executar(() => api.concluirDemanda(d.id, !feita))}
        />

        <div className="cl-linha-corpo">
          <div className="cl-linha-titulo">{d.title}</div>
          {d.description && comDetalhes.has(d.id) && (
            <div className="cl-linha-texto cl-linha-md" id={`cl-detalhes-${d.id}`}>
              <Markdown fonte={d.description} />
            </div>
          )}

          <div className="cl-linha-meta">
            <Selo tom={TOM[estado]} ponto={estado === 'atrasada'}>
              {ROTULO_DO_ESTADO[estado]}
            </Selo>

            {d.dueOn && !feita && (
              <span className="tnum o-mono">
                prazo {dataCurta(d.dueOn)}
                {dias !== null && (
                  <span style={{ color: dias < 0 ? 'var(--err)' : undefined }}> · {prazoCurto(dias)}</span>
                )}
              </span>
            )}

            {feita && d.completedBy && (
              <span className="o-mono">
                por {d.completedBy.name}
                {d.completedAt && ` · ${dataCurtaDoInstante(d.completedAt)}`}
              </span>
            )}

            {d.assignees.length > 0 && (
              <span className="inline-flex flex-wrap items-center gap-1">
                <IconePessoas className="h-3 w-3" />
                {d.assignees.map((p) => (
                  <span key={p.id} className="o-etiqueta">
                    {p.name}
                  </span>
                ))}
              </span>
            )}

            {d.archivedAt && <Selo>arquivada {dataCurtaDoInstante(d.archivedAt)}</Selo>}

            {d.description && (
              <button
                type="button"
                className="cl-detalhes"
                aria-expanded={comDetalhes.has(d.id)}
                aria-controls={comDetalhes.has(d.id) ? `cl-detalhes-${d.id}` : undefined}
                aria-label={`${comDetalhes.has(d.id) ? 'Ocultar' : 'Ver'} os detalhes de “${d.title}”`}
                onClick={() =>
                  setComDetalhes((atual) => {
                    const novo = new Set(atual);
                    if (novo.has(d.id)) novo.delete(d.id);
                    else novo.add(d.id);
                    return novo;
                  })
                }
              >
                <IconeChevron className="h-2.5 w-2.5" />
                detalhes
              </button>
            )}
          </div>
        </div>

        <div className="cl-acoes">
          <button
            type="button"
            className="o-btn o-btn-fantasma o-btn-icone"
            title="Editar"
            aria-label={`Editar “${d.title}”`}
            onClick={() => {
              setErro(null);
              setRascunho({
                id: d.id,
                title: d.title,
                description: d.description ?? '',
                dueOn: d.dueOn ?? '',
                assigneeIds: d.assignees.map((p) => p.id),
              });
            }}
          >
            <IconeLapis />
          </button>
          <button
            type="button"
            className="o-btn o-btn-fantasma o-btn-icone"
            title={d.archivedAt ? 'Tirar do arquivo' : 'Arquivar'}
            aria-label={`${d.archivedAt ? 'Tirar do arquivo' : 'Arquivar'} “${d.title}”`}
            onClick={() => executar(() => api.arquivarDemanda(d.id, d.archivedAt === null))}
          >
            <IconeArquivo />
          </button>
          <button
            type="button"
            className="o-btn o-btn-fantasma o-btn-icone"
            title="Apagar de vez"
            aria-label={`Apagar “${d.title}” de vez`}
            onClick={() => {
              // O único caminho sem volta desta tela. Arquivar existe
              // justamente para que apagar seja raro.
              if (!window.confirm(`Apagar "${d.title}" de vez? Não há como desfazer.`)) {
                return;
              }
              void executar(() => api.excluirDemanda(d.id));
            }}
          >
            <IconeLixeira />
          </button>
        </div>
      </>
    );
  }

  /* --- o Kanban: as colunas são os estados da demanda --- */

  async function moverDemanda(d: Demanda, de: string, para: string) {
    if (movendo.has(d.id)) return;
    setMovendo((m) => new Set(m).add(d.id));
    await executar(async () => {
      if (para === 'arquivadas') {
        await api.arquivarDemanda(d.id, true);
        return;
      }
      if (de === 'arquivadas') await api.arquivarDemanda(d.id, false);
      const concluir = para === 'concluidas';
      if ((d.completedAt !== null) !== concluir) await api.concluirDemanda(d.id, concluir);
    });
    setMovendo((m) => {
      const proximo = new Set(m);
      proximo.delete(d.id);
      return proximo;
    });
  }

  function kanban() {
    const colunas: ColunaDeEstado<Demanda>[] = [
      { chave: 'pendentes', nome: 'Pendentes', cor: 'var(--hair-3)', itens: grupos.pendentes, aceita: true, vazia: 'Nada pendente.' },
      { chave: 'concluidas', nome: 'Concluídas', cor: 'var(--luz)', itens: grupos.concluidas, aceita: true, vazia: 'Nenhuma concluída.' },
    ];
    if (verArquivadas) {
      colunas.push({
        chave: 'arquivadas',
        nome: 'Arquivadas',
        cor: 'var(--mute)',
        itens: carregandoArquivadas ? [] : grupos.arquivadas,
        // Soltar numa coluna que ainda não leu seria mover às cegas.
        aceita: !carregandoArquivadas,
        vazia: 'Nenhuma arquivada.',
        carregando: carregandoArquivadas ? 'Carregando as arquivadas…' : undefined,
      });
    }
    const ocupados = new Set(movendo);
    if (rascunho?.id) ocupados.add(rascunho.id);
    return (
      <QuadroDeEstados
        rotulo="Demandas por estado"
        colunas={colunas}
        idDoItem={(d) => d.id}
        nomeDoItem={(d) => d.title}
        ocupados={ocupados}
        aoMover={(d, de, para) => void moverDemanda(d, de, para)}
        desenhar={(d) => {
          const estado = estadoDaDemanda(d);
          return (
            <div className="cl-linha" data-feito={d.completedAt !== null || undefined} data-tom={estado === 'atrasada' ? 'err' : undefined}>
              {corpoDaDemanda(d)}
            </div>
          );
        }}
      />
    );
  }

  function grupo(
    titulo: string,
    lista: Demanda[],
    { nota, recolhido }: { nota?: string; recolhido?: { aberto: boolean; alternar: () => void } } = {},
  ) {
    if (lista.length === 0) return null;
    // A demanda em edição nunca some dentro de um grupo recolhido.
    const aberto = !recolhido || recolhido.aberto || lista.some((d) => d.id === rascunho?.id);
    const id = `cl-grupo-${titulo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()}`;
    return (
      <section className="cl-grupo" aria-label={titulo}>
        <h3 className="cl-grupo-titulo">
          {recolhido ? (
            <button
              type="button"
              className="cl-grupo-alternar"
              aria-expanded={aberto}
              aria-controls={aberto ? id : undefined}
              onClick={recolhido.alternar}
            >
              <IconeChevron className="h-2.5 w-2.5" />
              {titulo} <span className="tnum">{lista.length}</span>
            </button>
          ) : (
            <>
              {titulo} <span className="tnum">{lista.length}</span>
            </>
          )}
          {nota && <span className="cl-grupo-nota"> · {nota}</span>}
        </h3>
        {aberto && (
          <ul className="cl-lista" id={id}>
            {lista.map(linha)}
          </ul>
        )}
      </section>
    );
  }

  const novo = rascunho !== null && rascunho.id === null;
  const nada = grupos.pendentes.length + grupos.concluidas.length + grupos.arquivadas.length === 0;

  return (
    <div className="pb-10">
      <div className="cl-cabeca">
        <h2 className="cl-area-titulo">Demandas</h2>
        {!carregando && erroDaLeitura === null && !nada && (
          <p className="cl-resumo-area" aria-label="Resumo das demandas">
            <span>
              <b>{resumo.pendentes}</b> pendentes
            </span>
            {resumo.atrasadas > 0 && (
              <span data-tom="err">
                <b>{resumo.atrasadas}</b>{' '}
                {resumo.atrasadas === 1 ? 'atrasada' : 'atrasadas'}
              </span>
            )}
            {resumo.vencemHoje > 0 && (
              <span data-tom="warn">
                <b>{resumo.vencemHoje}</b>{' '}
                {resumo.vencemHoje === 1 ? 'vence hoje' : 'vencem hoje'}
              </span>
            )}
            <span data-tom="ok">
              <b>{resumo.concluidas}</b>{' '}
              {resumo.concluidas === 1 ? 'concluída' : 'concluídas'}
            </span>
          </p>
        )}
        <div className="cl-cabeca-acoes">
          <SeletorDeModo contexto="checklist" valor={modo} aoEscolher={escolherModo} />
          <button
            type="button"
            aria-pressed={verArquivadas}
            className="o-btn o-btn-fantasma o-btn-sm"
            onClick={() => setVerArquivadas((v) => !v)}
          >
            <IconeArquivo />
            {verArquivadas ? 'Ocultar arquivadas' : 'Ver arquivadas'}
          </button>
          <button
            type="button"
            className="o-btn o-btn-solido o-btn-sm"
            disabled={novo}
            onClick={() => {
              setErro(null);
              setRascunho(RASCUNHO_VAZIO);
            }}
          >
            <IconeMais />
            Nova demanda
          </button>
        </div>
      </div>

      <p className="cl-alcance">
        Todas as demandas deste cliente — a competência do topo não filtra esta lista.
      </p>

      {(novo || (modo === 'kanban' && rascunho !== null)) && (
        /* No Kanban, editar abre o formulário aqui em cima: a coluna tem 280 px. */
        <div className="o-card cl-form-novo p-3">
          {avisoDoGesto}
          {formulario}
        </div>
      )}

      {/* A recusa de um gesto na lista (marcar, arquivar, apagar). A do
          formulário aparece dentro dele. */}
      {rascunho === null && avisoDoGesto}

      {carregando ? (
        <EstadoDaPagina tipo="carregando" titulo="Carregando as demandas…" />
      ) : erroDaLeitura !== null ? (
        <EstadoDaPagina
          tipo="erro"
          titulo={erroDaLeitura}
          acao={{ rotulo: 'Tentar de novo', aoClicar: () => void carregar() }}
        />
      ) : nada && !novo ? (
        <EstadoDaPagina
          tipo="vazio"
          titulo={verArquivadas ? 'Nenhuma demanda, nem arquivada' : 'Nenhuma demanda aberta'}
          acao={{ rotulo: 'Nova demanda', aoClicar: () => setRascunho(RASCUNHO_VAZIO) }}
        >
          Registre aqui o que foi combinado com este cliente. Prazo e responsáveis são
          opcionais — sem prazo, a demanda não vira atraso.
        </EstadoDaPagina>
      ) : modo === 'kanban' ? (
        kanban()
      ) : (
        <>
          {grupo('Pendentes', grupos.pendentes)}
          {grupo('Concluídas', grupos.concluidas, {
            recolhido: { aberto: verConcluidas, alternar: () => setVerConcluidas((v) => !v) },
          })}
          {carregandoArquivadas ? (
            <p className="cl-lista-vazia" role="status">
              Carregando as arquivadas…
            </p>
          ) : (
            verArquivadas && grupo('Arquivadas', grupos.arquivadas, { nota: 'fora da conta do resumo' })
          )}
        </>
      )}
    </div>
  );
}
