/**
 * A aba Captação — etapa F4.10.
 *
 * Registro de gravação: quando, quem captou, quantos vídeos, de que tipo, em
 * que pé está, roteiro e duração.
 *
 * O ESTADO DA GRAVAÇÃO É ENUM, E AQUI ISSO SE JUSTIFICA
 *   Nas outras etapas eu recusei enums que o legado tinha no código e não na
 *   operação — o status do calendário (três valores, um em uso) e a marca de
 *   "importante" (zero em 75). Aqui os quatro estados aparecem TODOS nas 77
 *   gravações do legado. O critério nunca foi gosto: é se a operação usa.
 *
 * DATA, QUEM, ESTADO — E O MÊS QUE CONTA — F11C do plano UX
 *   Cada gravação é uma linha com a coluna do dia à esquerda (a mesma de
 *   Conteúdos e Histórico), quantos vídeos e de que tipo, quem captou e o
 *   estado. A lista se divide em "Em <mês>" — as que somam no captados do
 *   topo — e "Outros meses", que não contam: a regra da conta ficou visível
 *   na própria lista. Captação não é entrega: "Publicado" aqui não conclui
 *   item nenhum de Conteúdos.
 *
 * O CONTADOR DO MÊS
 *   O painel do Sistema IDE mostra "3/8 captados/mês" no cartão do cliente. O
 *   numerador é a soma dos vídeos gravados no mês; o denominador é a cota de
 *   vídeo do contrato daquele mês. A conta aparece aqui no topo.
 */

import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, api } from '@/lib/api';
import { EstadoDaPagina } from '@/ui/EstadoDaPagina';
import { hojeNaAgencia } from '@/ui/grade-do-mes';
import { IconeLapis, IconeLixeira, IconeMais, IconePessoas, IconeVideo } from '@/ui/Icones';
import { Area, Aviso, Campo, Selecao, Selo, type Tom } from '@/ui/primitivos';

type Estado = 'recorded' | 'in_edit' | 'edited' | 'published';
type Tipo = 'testimonial' | 'event' | 'institutional' | 'product' | 'promotional' | 'other';

const ESTADO: Record<Estado, { rotulo: string; tom: Tom }> = {
  recorded: { rotulo: 'Gravado', tom: 'neutro' },
  in_edit: { rotulo: 'Em edição', tom: 'warn' },
  edited: { rotulo: 'Editado', tom: 'neutro' },
  published: { rotulo: 'Publicado', tom: 'ok' },
};

const TIPO: Record<Tipo, string> = {
  testimonial: 'Depoimento',
  event: 'Evento',
  institutional: 'Institucional',
  product: 'Produto',
  promotional: 'Promocional',
  other: 'Outro',
};

type Captacao = {
  id: string;
  recordedOn: string;
  capturedBy: { id: string; name: string } | null;
  capturedByNote: string | null;
  videoCount: number;
  kinds: Tipo[];
  status: Estado;
  script: string | null;
  notes: string | null;
  totalMinutes: number | null;
};

type Pessoa = { id: string; name: string };

type Rascunho = {
  id: string | null;
  recordedOn: string;
  capturedBy: string;
  capturedByNote: string;
  videoCount: string;
  kinds: Tipo[];
  status: Estado;
  script: string;
  notes: string;
  totalMinutes: string;
};

const rascunhoVazio = (): Rascunho => ({
  id: null,
  // O dia de São Paulo: pelo dia UTC, uma gravação registrada às 22h nascia com a data de amanhã.
  recordedOn: hojeNaAgencia(),
  capturedBy: '',
  capturedByNote: '',
  videoCount: '1',
  kinds: [],
  status: 'recorded',
  script: '',
  notes: '',
  totalMinutes: '',
});

const dataCurta = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const diaEMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const ano = (iso: string) => iso.slice(0, 4);

const nomeDoMes = (mes: string) => {
  const t = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${mes}-01T12:00:00Z`),
  );
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** "2 vídeos · Institucional, Produto" — o nome da gravação para quem ouve. */
const nomeDaGravacao = (c: Captacao) =>
  `gravação de ${dataCurta(c.recordedOn)}, ${c.videoCount} ${c.videoCount === 1 ? 'vídeo' : 'vídeos'}`;

export function Captacao({
  clienteId,
  mes,
  cotaDeVideoNoMes,
}: {
  clienteId: string;
  /** `YYYY-MM` — o mês que a tela do cliente está mostrando. */
  mes: string;
  cotaDeVideoNoMes: number;
}) {
  const [captacoes, setCaptacoes] = useState<Captacao[]>([]);
  const [equipe, setEquipe] = useState<Pessoa[]>([]);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** A leitura falhou — separada da recusa de um gesto (F11C). */
  const [erroDaLeitura, setErroDaLeitura] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await api.captacoes(clienteId);
      setCaptacoes(r.captures as Captacao[]);
      setErroDaLeitura(null);
    } catch (e) {
      setErroDaLeitura(e instanceof ApiError ? e.message : 'Não foi possível carregar as gravações.');
    } finally {
      setCarregando(false);
    }
  }, [clienteId]);

  useEffect(() => {
    setCarregando(true);
    void carregar();
  }, [carregar]);

  useEffect(() => {
    api
      .equipe()
      .then((r) => setEquipe(r.team))
      .catch(() => setEquipe([]));
  }, []);

  /** Vídeos captados no mês que a tela está mostrando. */
  const captadosNoMes = useMemo(
    () =>
      captacoes
        .filter((c) => c.recordedOn.slice(0, 7) === mes)
        .reduce((n, c) => n + c.videoCount, 0),
    [captacoes, mes],
  );

  /** As que contam no mês e as que não contam, cada grupo do mais novo ao mais antigo. */
  const grupos = useMemo(() => {
    const ordem = [...captacoes].sort((a, b) => b.recordedOn.localeCompare(a.recordedOn));
    return {
      doMes: ordem.filter((c) => c.recordedOn.slice(0, 7) === mes),
      outros: ordem.filter((c) => c.recordedOn.slice(0, 7) !== mes),
    };
  }, [captacoes, mes]);
  const aguardando = captacoes.filter((c) => c.status === 'recorded' || c.status === 'in_edit').length;

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    if (rascunho === null) return;
    setErro(null);
    setSalvando(true);

    const corpo = {
      recordedOn: rascunho.recordedOn,
      capturedBy: rascunho.capturedBy === '' ? null : rascunho.capturedBy,
      capturedByNote: rascunho.capturedByNote,
      videoCount: Number(rascunho.videoCount),
      kinds: rascunho.kinds,
      status: rascunho.status,
      script: rascunho.script,
      notes: rascunho.notes,
      totalMinutes: rascunho.totalMinutes === '' ? null : Number(rascunho.totalMinutes),
    };

    try {
      if (rascunho.id) await api.salvarCaptacao(rascunho.id, corpo);
      else await api.criarCaptacao(clienteId, corpo);
      setRascunho(null);
      await carregar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  async function apagar(c: Captacao) {
    if (!window.confirm(`Apagar a gravação de ${dataCurta(c.recordedOn)}?`)) return;
    setErro(null);
    try {
      await api.excluirCaptacao(c.id);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível apagar.');
    }
    await carregar();
  }

  const editar = (c: Captacao) => {
    setErro(null);
    setRascunho({
      id: c.id,
      recordedOn: c.recordedOn,
      capturedBy: c.capturedBy?.id ?? '',
      capturedByNote: c.capturedByNote ?? '',
      videoCount: String(c.videoCount),
      kinds: c.kinds,
      status: c.status,
      script: c.script ?? '',
      notes: c.notes ?? '',
      totalMinutes: c.totalMinutes === null ? '' : String(c.totalMinutes),
    });
  };

  const avisoDoGesto = erro && (
    <div className="mb-3">
      <Aviso tipo="erro">{erro}</Aviso>
    </div>
  );

  const original = rascunho?.id ? captacoes.find((c) => c.id === rascunho.id) : undefined;
  const formulario = rascunho !== null && (
    <form
      onSubmit={salvar}
      className="o-form"
      aria-label={original ? `Editar a ${nomeDaGravacao(original)}` : 'Registrar gravação'}
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Campo
          rotulo="Data da gravação *"
          type="date"
          value={rascunho.recordedOn}
          onChange={(e) => setRascunho({ ...rascunho, recordedOn: e.target.value })}
        />
        <Campo
          rotulo="Quantos vídeos *"
          type="number"
          min={1}
          inputMode="numeric"
          value={rascunho.videoCount}
          onChange={(e) => setRascunho({ ...rascunho, videoCount: e.target.value })}
        />
        <Campo
          rotulo="Duração (min)"
          type="number"
          min={0}
          inputMode="numeric"
          value={rascunho.totalMinutes}
          onChange={(e) => setRascunho({ ...rascunho, totalMinutes: e.target.value })}
        />
        <Selecao
          rotulo="Em que pé está"
          value={rascunho.status}
          onChange={(e) => setRascunho({ ...rascunho, status: e.target.value as Estado })}
        >
          {(Object.keys(ESTADO) as Estado[]).map((st) => (
            <option key={st} value={st}>
              {ESTADO[st].rotulo}
            </option>
          ))}
        </Selecao>
      </div>

      <div>
        <span className="o-rotulo">Tipos de vídeo</span>
        <div className="flex flex-wrap gap-1">
          {(Object.keys(TIPO) as Tipo[]).map((t) => {
            const marcado = rascunho.kinds.includes(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={marcado}
                className="o-btn o-btn-vidro o-btn-sm"
                onClick={() =>
                  setRascunho({
                    ...rascunho,
                    kinds: marcado ? rascunho.kinds.filter((x) => x !== t) : [...rascunho.kinds, t],
                  })
                }
              >
                {TIPO[t]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Dois campos, como no histórico: quem do time captou, e quem de fora. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Selecao
          rotulo="Captado por (do time)"
          value={rascunho.capturedBy}
          onChange={(e) => setRascunho({ ...rascunho, capturedBy: e.target.value })}
        >
          <option value="">— ninguém do time —</option>
          {equipe.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Selecao>
        <Campo
          rotulo="Ou por quem, de fora"
          placeholder="Ex: produtora contratada"
          value={rascunho.capturedByNote}
          onChange={(e) => setRascunho({ ...rascunho, capturedByNote: e.target.value })}
        />
      </div>

      <Area
        rotulo="Roteiro"
        placeholder="O que foi combinado gravar"
        value={rascunho.script}
        onChange={(e) => setRascunho({ ...rascunho, script: e.target.value })}
      />
      <Area
        rotulo="Observações"
        placeholder="O que aconteceu na gravação"
        value={rascunho.notes}
        onChange={(e) => setRascunho({ ...rascunho, notes: e.target.value })}
      />

      {/* UMA AÇÃO PRINCIPAL POR TELA — F43 Fase 10. O verde sólido é do
          "Registrar gravação" no alto da aba; aqui o confirmar é o tom
          (vidro) e o cancelar é texto (fantasma). */}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="o-btn o-btn-fantasma o-btn-sm"
          onClick={() => {
            setRascunho(null);
            setErro(null);
          }}
        >
          Cancelar
        </button>
        <button type="submit" className="o-btn o-btn-vidro o-btn-sm" disabled={salvando}>
          {salvando ? 'Salvando…' : rascunho.id ? 'Salvar' : 'Registrar'}
        </button>
      </div>
    </form>
  );

  function linha(c: Captacao) {
    if (rascunho?.id === c.id) {
      return (
        <li key={c.id} className="cl-linha-form">
          {avisoDoGesto}
          {formulario}
        </li>
      );
    }
    const quem = [c.capturedBy?.name, c.capturedByNote].filter(Boolean).join(' · ');
    return (
      <li key={c.id} className="cl-linha">
        <span className="cl-dia">
          {diaEMes(c.recordedOn)}
          <small>{ano(c.recordedOn)}</small>
        </span>

        <div className="cl-linha-corpo">
          <div className="cl-linha-titulo flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <IconeVideo className="h-3.5 w-3.5 text-mute" />
              <span className="tnum">{c.videoCount}</span> {c.videoCount === 1 ? 'vídeo' : 'vídeos'}
            </span>
            <Selo tom={ESTADO[c.status].tom}>{ESTADO[c.status].rotulo}</Selo>
          </div>

          <div className="cl-linha-meta">
            {quem ? (
              <span className="inline-flex items-center gap-1">
                <IconePessoas className="h-3 w-3" />
                captado por {quem}
              </span>
            ) : (
              <span>sem responsável anotado</span>
            )}
            {c.totalMinutes !== null && <span className="tnum o-mono">{c.totalMinutes} min</span>}
            {c.kinds.map((t) => (
              <span key={t} className="o-etiqueta">
                {TIPO[t]}
              </span>
            ))}
          </div>

          {c.script && <p className="cl-linha-texto">{c.script}</p>}
          {c.notes && (
            <p className="cl-linha-texto" data-apoio>
              {c.notes}
            </p>
          )}
        </div>

        <div className="cl-acoes">
          <button
            type="button"
            className="o-btn o-btn-fantasma o-btn-icone"
            title="Editar"
            aria-label={`Editar a ${nomeDaGravacao(c)}`}
            onClick={() => editar(c)}
          >
            <IconeLapis />
          </button>
          <button
            type="button"
            className="o-btn o-btn-fantasma o-btn-icone"
            title="Apagar gravação"
            aria-label={`Apagar a ${nomeDaGravacao(c)}`}
            onClick={() => void apagar(c)}
          >
            <IconeLixeira />
          </button>
        </div>
      </li>
    );
  }

  const novo = rascunho !== null && rascunho.id === null;
  const faltam = Math.max(0, cotaDeVideoNoMes - captadosNoMes);
  const tomDaConta =
    cotaDeVideoNoMes === 0 ? undefined : captadosNoMes >= cotaDeVideoNoMes ? 'ok' : 'warn';

  return (
    <div className="pb-10">
      <div className="cl-cabeca">
        <h2 className="cl-area-titulo">Captação</h2>
        {!carregando && erroDaLeitura === null && (
          <p className="cl-resumo-area" aria-label="Resumo da captação">
            <span data-tom={tomDaConta}>
              <b>
                {captadosNoMes}/{cotaDeVideoNoMes}
              </b>{' '}
              vídeos captados em {nomeDoMes(mes)}
            </span>
            <span>
              {cotaDeVideoNoMes === 0
                ? 'sem vídeo contratado neste mês'
                : faltam > 0
                  ? `faltam ${faltam}`
                  : 'cota do mês captada'}
            </span>
            <span data-tom={aguardando > 0 ? 'warn' : undefined}>
              <b>{aguardando}</b> aguardando edição
            </span>
          </p>
        )}
        <div className="cl-cabeca-acoes">
          <button
            type="button"
            className="o-btn o-btn-solido o-btn-sm"
            disabled={novo}
            onClick={() => {
              setErro(null);
              setRascunho(rascunhoVazio());
            }}
          >
            <IconeMais />
            Registrar gravação
          </button>
        </div>
      </div>

      {novo && (
        <div className="o-card cl-form-novo p-3">
          {avisoDoGesto}
          {formulario}
        </div>
      )}

      {rascunho === null && avisoDoGesto}

      {carregando ? (
        <EstadoDaPagina tipo="carregando" titulo="Carregando as gravações…" />
      ) : erroDaLeitura !== null ? (
        <EstadoDaPagina
          tipo="erro"
          titulo={erroDaLeitura}
          acao={{ rotulo: 'Tentar de novo', aoClicar: () => void carregar() }}
        />
      ) : captacoes.length === 0 && !novo ? (
        <EstadoDaPagina
          tipo="vazio"
          titulo="Nenhuma gravação registrada"
          acao={{ rotulo: 'Registrar gravação', aoClicar: () => setRascunho(rascunhoVazio()) }}
        >
          Anote aqui cada dia de captação. É daqui que sai o “captados no mês” do topo.
        </EstadoDaPagina>
      ) : (
        <>
          <section className="cl-grupo" aria-label={`Em ${nomeDoMes(mes)}`}>
            <h3 className="cl-grupo-titulo">
              Em {nomeDoMes(mes)} <span className="tnum">{grupos.doMes.length}</span>
              <span className="cl-grupo-nota"> · somam no captados do mês</span>
            </h3>
            {grupos.doMes.length > 0 ? (
              <ul className="cl-lista">{grupos.doMes.map(linha)}</ul>
            ) : (
              <p className="cl-lista cl-lista-vazia">Nenhuma gravação neste mês.</p>
            )}
          </section>
          {grupos.outros.length > 0 && (
            <section className="cl-grupo" aria-label="Outros meses">
              <h3 className="cl-grupo-titulo">
                Outros meses <span className="tnum">{grupos.outros.length}</span>
                <span className="cl-grupo-nota"> · não contam em {nomeDoMes(mes)}</span>
              </h3>
              <ul className="cl-lista">{grupos.outros.map(linha)}</ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
