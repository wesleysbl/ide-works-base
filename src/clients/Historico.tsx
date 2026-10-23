/**
 * A aba Histórico — etapa F4.9.
 *
 * A LINHA DO TEMPO ORDENA PELO DIA DO EVENTO, NÃO PELO DO REGISTRO
 *   Reunião de segunda anotada na quarta tem duas datas. Ordenar pela do
 *   registro poria a reunião depois de coisas que aconteceram depois dela.
 *   A tela mostra a do registro só quando as duas divergem — aí a diferença é
 *   informação, e não ruído.
 *
 * O DOCUMENTO ABRE POR ENDEREÇO ASSINADO, E SÓ ASSIM — F17.52
 *   O balde de documentos do Sistema IDE ERA `public = true`: as URLs gravadas
 *   lá apontam para a rota pública do Storage, e transcrição de reunião de
 *   cliente lia-se sem login, bastando ter o endereço. Medido em 2026-08-20,
 *   fechado em 2026-09-01.
 *
 *   Hoje o balde é privado. Clicar num documento pede ao Worker um endereço que
 *   vale cinco minutos, e o Worker só o emite depois de o banco confirmar que
 *   quem pediu alcança o cliente. A tabela guarda o CAMINHO do arquivo — nunca
 *   a URL —, que é o que tornou esta troca possível sem migração de dado.
 *
 * O ENVIO DE ARQUIVO CONTINUA FORA, E O MOTIVO MUDOU
 *   Não é mais falta de lugar privado: o lugar existe. O que falta é a etapa
 *   que decide ONDE o documento novo passa a morar — o balde do legado, com
 *   nome e políticas herdados, ou um balde do IDE Works como `ideworks-anexos`.
 *   Escolher isso no meio de uma etapa de segurança seria decidir arquitetura
 *   por conveniência. O botão segue desligado, com o motivo a um clique.
 *
 * DATA, ORIGEM E ANEXOS — F11C do plano UX
 *   A linha do tempo virou a coluna do dia (à esquerda, a mesma família de
 *   Conteúdos e Captação) e o relato ao lado. Embaixo do relato: quem
 *   conduziu, o selo da IA quando houver, a data do registro quando diverge, e
 *   os documentos como botões de verdade — com "Abrindo…" enquanto o endereço
 *   é assinado e, se falhar, a frase do servidor AO LADO do documento, e não
 *   no alto da aba, longe de quem clicou.
 *
 * O REGISTRO ESCRITO PELA IA LEVA O SELO — F26.9
 *   *"Carla, via ChatGPT"*, no pé do registro, ao lado de quem conduziu. A aba
 *   não mostra quem REGISTROU (mostra quem conduziu, que é outra pessoa), então
 *   o selo nomeia a pessoa junto com a conexão. Registro de gente não ganha
 *   selo. O registro virou peça própria (`RegistroDoHistorico`) para o teste
 *   desenhá-lo: a aba carrega os registros num efeito, e
 *   `renderToStaticMarkup` não roda efeito.
 */

import { type FormEvent, useCallback, useEffect, useState } from 'react';

import { Ajuda } from '@/board/menus';
import { filtrarEventos } from '@/clients/historico-busca';
import { ApiError, api } from '@/lib/api';
import { EstadoDaPagina } from '@/ui/EstadoDaPagina';
import { dataCurtaDoInstante, diaDoInstante, hojeNaAgencia } from '@/ui/grade-do-mes';
import { IconeBusca, IconeClipe, IconeFechar, IconeLapis, IconeLixeira, IconeMais, IconePessoas } from '@/ui/Icones';
import { Area, Aviso, Campo, Selecao } from '@/ui/primitivos';
import { SeloDeOrigem } from '@/ui/SeloDeOrigem';

type Documento = {
  id: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedAt: string;
};

export type Evento = {
  id: string;
  happenedOn: string;
  title: string;
  subtitle: string | null;
  body: string;
  ledBy: { id: string; name: string } | null;
  ledByNote: string | null;
  createdAt: string;
  documents: Documento[];
  /** A conexão de IA pela qual o registro foi escrito (F26.9). Nula = gente. */
  viaName?: string | null;
  /** Quem pediu à IA. Só vem quando `viaName` vem. */
  viaAuthorName?: string | null;
};

type Pessoa = { id: string; name: string };

type Rascunho = {
  id: string | null;
  happenedOn: string;
  title: string;
  subtitle: string;
  body: string;
  ledBy: string;
  ledByNote: string;
};

/* O dia de São Paulo, e não o de UTC: o registro feito às 22h nascia com a data de amanhã. */
const hoje = () => hojeNaAgencia();

const rascunhoVazio = (): Rascunho => ({
  id: null,
  happenedOn: hoje(),
  title: '',
  subtitle: '',
  body: '',
  ledBy: '',
  ledByNote: '',
});

const dataLonga = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));

/** "22 set" e "2026", para a coluna do dia. */
const diaEMes = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${iso.slice(0, 10)}T12:00:00Z`))
    .replace(' de ', ' ')
    .replace('.', '');

/** A falha ao abrir um documento — dita junto dele. */
export type FalhaDoDocumento = { documentoId: string; mensagem: string };

/** Tamanho em unidade legível. `null` quando o legado não registrou. */
function tamanho(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function Historico({ clienteId }: { clienteId: string }) {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [equipe, setEquipe] = useState<Pessoa[]>([]);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** A leitura falhou — separada da recusa de um gesto (F11C). */
  const [erroDaLeitura, setErroDaLeitura] = useState<string | null>(null);
  const [falhaDoDocumento, setFalhaDoDocumento] = useState<FalhaDoDocumento | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [busca, setBusca] = useState('');
  /** Qual documento está sendo assinado agora. Um por vez, e só o clicado. */
  const [abrindo, setAbrindo] = useState<string | null>(null);

  /**
   * Abrir um documento — sempre por endereço assinado, pedido NO CLIQUE.
   *
   * O ENDEREÇO NÃO EXISTE ANTES DO CLIQUE, e é isso que muda desde a F17.52.
   * Antes, o endereço estava gravado no dado e era público: quem o recebesse
   * por engano abria o contrato do cliente para sempre, sem entrar no sistema.
   * Agora o Worker assina um que vale cinco minutos, e só depois de o banco
   * dizer que quem pediu alcança o cliente.
   */
  const abrirDocumento = (documento: Documento) => {
    void (async () => {
      setFalhaDoDocumento(null);
      setAbrindo(documento.id);
      try {
        const r = await api.enderecoDoDocumento(documento.id);
        // `noopener` e `noreferrer`: o endereço da tela interna não é assunto de
        // ninguém, e a aba nova não pode alcançar esta.
        window.open(r.url, '_blank', 'noopener,noreferrer');
      } catch (e) {
        setFalhaDoDocumento({
          documentoId: documento.id,
          mensagem: e instanceof ApiError ? e.message : 'Não foi possível abrir o documento.',
        });
      } finally {
        setAbrindo(null);
      }
    })();
  };

  const carregar = useCallback(async () => {
    try {
      const r = await api.historico(clienteId);
      setEventos(r.events as Evento[]);
      setErroDaLeitura(null);
    } catch (e) {
      setErroDaLeitura(e instanceof ApiError ? e.message : 'Não foi possível carregar o histórico.');
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

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    if (rascunho === null) return;
    setErro(null);
    setSalvando(true);

    const corpo = {
      happenedOn: rascunho.happenedOn,
      title: rascunho.title,
      subtitle: rascunho.subtitle,
      body: rascunho.body,
      ledBy: rascunho.ledBy === '' ? null : rascunho.ledBy,
      ledByNote: rascunho.ledByNote,
    };

    try {
      if (rascunho.id) await api.salvarEvento(rascunho.id, corpo);
      else await api.criarEvento(clienteId, corpo);
      setRascunho(null);
      await carregar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  async function apagar(e: Evento) {
    if (!window.confirm(`Apagar "${e.title}" do histórico? Não há como desfazer.`)) return;
    setErro(null);
    try {
      await api.excluirEvento(e.id);
    } catch (erro) {
      setErro(erro instanceof ApiError ? erro.message : 'Não foi possível apagar.');
    }
    await carregar();
  }

  const editar = (e: Evento) => {
    setErro(null);
    setRascunho({
      id: e.id,
      happenedOn: e.happenedOn,
      title: e.title,
      subtitle: e.subtitle ?? '',
      body: e.body,
      ledBy: e.ledBy?.id ?? '',
      ledByNote: e.ledByNote ?? '',
    });
  };

  const avisoDoGesto = erro && (
    <div className="mb-3">
      <Aviso tipo="erro">{erro}</Aviso>
    </div>
  );

  const original = rascunho?.id ? eventos.find((e) => e.id === rascunho.id) : undefined;
  const formulario = rascunho !== null && (
    <form
      onSubmit={salvar}
      className="o-form"
      aria-label={original ? `Editar “${original.title}”` : 'Registrar evento'}
    >
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <Campo
          rotulo="Quando aconteceu *"
          type="date"
          dica="Não é a data em que você está anotando."
          value={rascunho.happenedOn}
          onChange={(e) => setRascunho({ ...rascunho, happenedOn: e.target.value })}
        />
        <Campo
          rotulo="Título *"
          placeholder="Ex: reunião de alinhamento do trimestre"
          value={rascunho.title}
          autoFocus
          onChange={(e) => setRascunho({ ...rascunho, title: e.target.value })}
        />
      </div>

      <Campo
        rotulo="Subtítulo"
        placeholder="Uma linha de contexto, se ajudar"
        value={rascunho.subtitle}
        onChange={(e) => setRascunho({ ...rascunho, subtitle: e.target.value })}
      />

      <Area
        rotulo="O que aconteceu *"
        placeholder="O relato. É isto que alguém vai ler daqui a um ano."
        value={rascunho.body}
        onChange={(e) => setRascunho({ ...rascunho, body: e.target.value })}
      />

      {/* Dois campos porque são duas coisas: quem do time conduziu, e quem
          de fora conduziu. O legado tinha um só, e virou texto livre com 32
          grafias para poucas pessoas. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Selecao
          rotulo="Conduzido por (do time)"
          value={rascunho.ledBy}
          onChange={(e) => setRascunho({ ...rascunho, ledBy: e.target.value })}
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
          placeholder="Ex: o próprio cliente, um fornecedor"
          value={rascunho.ledByNote}
          onChange={(e) => setRascunho({ ...rascunho, ledByNote: e.target.value })}
        />
      </div>

      {/* UMA AÇÃO PRINCIPAL POR TELA — F43 Fase 10. O verde sólido é do
          "Registrar evento" no alto da aba; aqui o confirmar é o tom (vidro)
          e o cancelar é texto (fantasma): a ordem entre os dois continua
          clara sem dois botões verdes na mesma tela. */}
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

  const novo = rascunho !== null && rascunho.id === null;
  // O registro que está sendo editado nunca some da tela por causa da busca.
  const achados = new Set(filtrarEventos(eventos, busca).map((e) => e.id));
  const visiveis = eventos.filter((e) => achados.has(e.id) || e.id === rascunho?.id);
  const buscando = busca.trim() !== '';

  return (
    <div className="pb-10">
      <div className="cl-cabeca">
        <h2 className="cl-area-titulo">Histórico</h2>
        {!carregando && erroDaLeitura === null && eventos.length > 0 && (
          <p className="cl-resumo-area">
            <span>
              <b>{eventos.length}</b>{' '}
              {eventos.length === 1 ? 'registro' : 'registros'}
            </span>
            <span className="cl-longo">do mais recente ao mais antigo, pelo dia em que aconteceu</span>
          </p>
        )}
        <div className="cl-cabeca-acoes">
          {/* O PARÁGRAFO DE CINCO LINHAS VIROU `?` — F17.37. Ele estava certo
              em existir: quem vê um botão desligado precisa poder saber por
              quê. A explicação continua a um clique. */}
          <button type="button" className="o-btn o-btn-fantasma o-btn-sm" disabled aria-disabled>
            <IconeClipe className="h-3.5 w-3.5" />
            Anexar documento — pendente
          </button>
          <Ajuda sobre="por que anexar está desligado" lado="baixo-direita">
            Ler já está resolvido: o documento abre por um endereço que vale
            cinco minutos e exige estar dentro do sistema. Falta decidir em que
            lugar o documento novo passa a ser guardado — e essa escolha é de
            outra etapa.
          </Ajuda>
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
            Registrar evento
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

      {/* A BUSCA — só quando há o que buscar. Roda sobre o que a aba já carregou. */}
      {!carregando && erroDaLeitura === null && eventos.length > 1 && (
        <div className="iw-busca" role="search">
          <IconeBusca className="iw-busca-lupa h-4 w-4" />
          <input
            type="text"
            value={busca}
            maxLength={120}
            placeholder="Buscar nas reuniões e registros por palavra-chave…"
            aria-label="Buscar no histórico"
            autoComplete="off"
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setBusca('');
            }}
          />
          {buscando && (
            <>
              <span className="tnum text-xs text-mute" role="status">
                {visiveis.length} de {eventos.length}
              </span>
              <button
                type="button"
                className="iw-busca-limpar"
                aria-label="Limpar a busca"
                onClick={() => setBusca('')}
              >
                <IconeFechar className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      )}

      {carregando ? (
        <EstadoDaPagina tipo="carregando" titulo="Carregando o histórico…" />
      ) : erroDaLeitura !== null ? (
        <EstadoDaPagina
          tipo="erro"
          titulo={erroDaLeitura}
          acao={{ rotulo: 'Tentar de novo', aoClicar: () => void carregar() }}
        />
      ) : eventos.length === 0 && !novo ? (
        <EstadoDaPagina
          tipo="vazio"
          titulo="Nada registrado ainda"
          acao={{ rotulo: 'Registrar evento', aoClicar: () => setRascunho(rascunhoVazio()) }}
        >
          O histórico guarda o que não cabe em nenhuma outra área — reunião, mudança de
          escopo, conversa difícil, decisão tomada.
        </EstadoDaPagina>
      ) : buscando && visiveis.length === 0 ? (
        <EstadoDaPagina
          tipo="sem-resultado"
          titulo={`Nenhum registro com “${busca.trim()}”`}
          acao={{ rotulo: 'Limpar a busca', aoClicar: () => setBusca('') }}
        >
          A busca olha título, texto, quem conduziu, data e nome dos documentos.
        </EstadoDaPagina>
      ) : (
        <ol className="cl-linha-do-tempo" aria-label="Linha do tempo do cliente">
          {visiveis.map((e) =>
            rascunho?.id === e.id ? (
              <li key={e.id} className="cl-evento">
                <div className="cl-evento-data" aria-hidden>
                  {diaEMes(e.happenedOn)}
                  <small>{e.happenedOn.slice(0, 4)}</small>
                </div>
                <div className="o-card p-3">
                  {avisoDoGesto}
                  {formulario}
                </div>
              </li>
            ) : (
              <RegistroDoHistorico
                key={e.id}
                evento={e}
                abrindo={abrindo}
                falha={falhaDoDocumento}
                aoEditar={() => editar(e)}
                aoApagar={() => void apagar(e)}
                aoAbrirDocumento={abrirDocumento}
              />
            ),
          )}
        </ol>
      )}
    </div>
  );
}

/**
 * Um registro da linha do tempo. Recebe tudo por propriedade — o teste o
 * desenha sem efeito, e o que ele desenha é o que a pessoa vê.
 */
export function RegistroDoHistorico({
  evento: e,
  abrindo,
  falha = null,
  aoEditar,
  aoApagar,
  aoAbrirDocumento,
}: {
  evento: Evento;
  /** Qual documento está sendo assinado agora. */
  abrindo: string | null;
  /** A última falha ao abrir um documento — aparece só no registro dele. */
  falha?: FalhaDoDocumento | null;
  aoEditar: () => void;
  aoApagar: () => void;
  aoAbrirDocumento: (d: Documento) => void;
}) {
  const falhaAqui = falha && e.documents.some((d) => d.id === falha.documentoId) ? falha : null;
  const quem = [e.ledBy?.name, e.ledByNote].filter(Boolean).join(' · ');
  return (
    <li className="cl-evento">
      <div className="cl-evento-data">
        <time dateTime={e.happenedOn.slice(0, 10)} title={dataLonga(e.happenedOn)}>
          {diaEMes(e.happenedOn)}
          <small>{e.happenedOn.slice(0, 4)}</small>
        </time>
      </div>

      <div className="min-w-0">
        <header className="cl-evento-cabeca">
          <div className="min-w-0">
            <h3 className="cl-evento-titulo">{e.title}</h3>
            {e.subtitle && <p className="cl-evento-sub">{e.subtitle}</p>}
          </div>

          <div className="cl-acoes">
            <button
              type="button"
              className="o-btn o-btn-fantasma o-btn-icone"
              title="Editar"
              aria-label={`Editar “${e.title}”`}
              onClick={aoEditar}
            >
              <IconeLapis />
            </button>
            <button
              type="button"
              className="o-btn o-btn-fantasma o-btn-icone"
              title="Apagar do histórico"
              aria-label={`Apagar “${e.title}” do histórico`}
              onClick={aoApagar}
            >
              <IconeLixeira />
            </button>
          </div>
        </header>

        <p className="cl-linha-texto">{e.body}</p>

        <div className="cl-linha-meta">
          {quem && (
            <span className="inline-flex items-center gap-1">
              <IconePessoas className="h-3 w-3" />
              conduzido por {quem}
            </span>
          )}

          {/* Quem pediu à IA e por qual conexão (F26.9). Registro de gente: nada. */}
          <SeloDeOrigem via={e.viaName} pessoa={e.viaAuthorName} />

          {/* Só quando as duas datas divergem. Iguais, a segunda é ruído. O dia do
              registro é o de São Paulo: o corte por posição era o dia UTC, e todo
              registro feito entre 21h e 23h59 do próprio dia ganhava um "registrado
              em" de amanhã. */}
          {diaDoInstante(e.createdAt) !== e.happenedOn && (
            <span className="o-mono">registrado em {dataCurtaDoInstante(e.createdAt)}</span>
          )}
        </div>

        {e.documents.length > 0 && (
          <ul className="cl-docs" aria-label={`Documentos de “${e.title}”`}>
            {e.documents.map((d) => {
              const nesta = abrindo === d.id;
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    className="cl-doc"
                    title={`Abrir ${d.fileName}`}
                    aria-label={`Abrir ${d.fileName}`}
                    aria-busy={nesta || undefined}
                    disabled={nesta}
                    onClick={() => aoAbrirDocumento(d)}
                  >
                    <IconeClipe className="h-3.5 w-3.5 shrink-0" />
                    <span className="cl-doc-nome">{d.fileName}</span>
                    {nesta ? (
                      <small>abrindo…</small>
                    ) : (
                      d.sizeBytes !== null && <small>{tamanho(d.sizeBytes)}</small>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {falhaAqui && (
          <div className="cl-doc-falha">
            <Aviso tipo="erro">{falhaAqui.mensagem}</Aviso>
          </div>
        )}
      </div>
    </li>
  );
}
