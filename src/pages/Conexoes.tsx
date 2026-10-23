/**
 * Gestão das conexões de agente — etapa F16.9b.
 *
 * A API já existia em `/api/integrations/v1/connections` (sessão humana).
 * Esta tela é o que a pessoa vê: alcance, capacidades, validade, revogada,
 * emitir o segredo UMA vez, revogar, e o ledger recente. Sem isto a F16.7
 * (comentário de agente) também ficava invisível — o selo na conversa lê
 * o mesmo ledger.
 *
 * Qualquer autenticado gerencia as PRÓPRIAS conexões. A recusa de área
 * não entra: a rota da API é `livre` em `auth/areas.ts`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { TelaComBarra } from '@/board/TelaComBarra';
import { ConectarAgente } from '@/board/ConectarAgente';
import { AvisoDasConexoesAntigas, LinhaDaExecucao, SelosDasPermissoes } from '@/board/PecasDaConexao';
import {
  avisoDasConexoesAntigasDispensado,
  conexoesAnterioresAoCorte,
  confirmacaoDoDesfazer,
  dispensarAvisoDasConexoesAntigas,
  feitoAteAgora,
  resumoDoDesfazer,
  type ResumoDoDesfazer,
} from '@/board/rotulos-da-conexao';
import { Ajuda } from '@/board/menus';
import { ApiError, api, semSessao } from '@/lib/api';
import { BotaoDeFechar, Janela } from '@/ui/janela';
import { EstadoDaPagina } from '@/ui/EstadoDaPagina';
import { dataCurtaDoInstante } from '@/ui/grade-do-mes';
import { Aviso, PaginaLarga, Selo } from '@/ui/primitivos';
import { Topo } from '@/ui/Topo';

const SEGREDO_UMA_VEZ =
  'Copie agora: este segredo não será mostrado de novo. ' +
  'O sistema guarda só a impressão digital — se perder, será preciso emitir outro.';

type Conexao = {
  id: string;
  name: string;
  oauthClientId: string;
  capabilities: string[];
  reach: { companies: string[] | null; clients: string[] | null };
  expiresAt: string | null;
  revokedAt: string | null;
  /** Quando foi autorizada (F44, Fase 9). Nulo = o servidor não trouxe a data. */
  authorizedAt?: string | null;
  policyVersion: number;
  live: boolean;
  dailyWriteLimit: number;
  usedToday: number;
};

type Execucao = {
  id: string;
  grantId: string;
  grantName: string;
  operation: string;
  targetId: string;
  occurredAt: string;
  origin: string;
  active: boolean;
  result: Record<string, unknown>;
  actedAs: { integrationName?: string; ownerId?: string } | null;
  commentId: string | null;
  /** F21.2: quando o dono desfez esta escrita. Nulo = continua valendo. */
  undoneAt: string | null;
};

type Segredo = { grantId: string; nome: string; secret: string; origem: HTMLElement | null };

/**
 * O NOME DA CONEXÃO É DO DONO, NÃO DO AGENTE — F21.5a.
 *
 * O nome de nascença é o `client_name` que o programa do agente declara no
 * OAuth. Ele IDENTIFICA, NÃO AUTORIZA: nenhuma decisão do servidor sai dele.
 * Mas é esse texto que aparece na caixa de entrada de quem deveria fiscalizar
 * o agente — e um agente que se anuncia como "Suporte oficial" na tela do
 * fiscal é problema de leitura, não de permissão. Aqui o dono troca o nome, e
 * o nome dele é que passa a aparecer em todo lugar.
 */
const SOBRE_O_NOME =
  'Este nome é só para você reconhecer a conexão. Quem escolheu o nome de hoje foi ' +
  'o programa do agente — e um programa pode se anunciar com o nome que quiser. ' +
  'Nenhuma permissão muda com o nome.';

const SOBRE_O_TETO =
  'Quantas escritas esta conexão pode fazer por dia. Passou do teto, o agente é ' +
  'recusado até a virada do dia. Zero suspende as escritas sem revogar a conexão — ' +
  'a leitura continua.';

function textoDoAlcance(reach: Conexao['reach']): string {
  const empresas =
    reach.companies === null
      ? 'todas as empresas'
      : reach.companies.length === 0
        ? 'nenhuma empresa'
        : `${reach.companies.length} empresa(s)`;
  const clientes =
    reach.clients === null
      ? 'todos os clientes'
      : reach.clients.length === 0
        ? 'nenhum cliente à parte'
        : `${reach.clients.length} cliente(s)`;
  return `${empresas} · ${clientes}`;
}

/**
 * O ESTADO E A VALIDADE SÃO DUAS PERGUNTAS — F13.
 *
 * Antes um selo só dizia "revogada", "vencida", "sem prazo" ou "até 12/10":
 * a mesma peça respondia "ela funciona?" e "até quando?". Agora o selo do
 * cabeçalho diz se a conexão atende (ativa / revogada / vencida) e a linha
 * "Validade" diz o prazo — inclusive o de uma revogada, que é quando parou.
 */
function estadoDe(c: Conexao): { texto: string; tom: 'ok' | 'warn' } {
  if (c.revokedAt) return { texto: 'revogada', tom: 'warn' };
  if (!c.live) return { texto: 'vencida', tom: 'warn' };
  return { texto: 'ativa', tom: 'ok' };
}

function validadeDe(c: Conexao): string {
  if (c.revokedAt) return `revogada em ${dataCurtaDoInstante(c.revokedAt)}`;
  if (!c.expiresAt) return 'sem prazo';
  return `${c.live ? 'até' : 'venceu em'} ${dataCurtaDoInstante(c.expiresAt)}`;
}

/**
 * A COTA DO DIA, DITA COMO A RECUSA DIZ — F21.5a.
 *
 * O número usado e o teto vêm do servidor, já resolvidos: a tela não
 * recalcula nada e não reinterpreta a frase da recusa. Se recalculasse,
 * mostraria um número e o freio aplicaria outro.
 */
function cotaDe(
  c: Conexao,
  viradaDoDia: string | null,
): { texto: string; detalhe: string; tom: 'ok' | 'warn' | 'neutro' } {
  const vira = viradaDoDia
    ? `A cota vira às ${new Date(viradaDoDia).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      })}.`
    : 'A cota vira na virada do dia.';
  if (c.dailyWriteLimit === 0) {
    return {
      texto: 'escritas suspensas',
      detalhe: 'Teto zero: o agente lê, mas não escreve. A conexão continua de pé.',
      tom: 'warn',
    };
  }
  const estourou = c.usedToday >= c.dailyWriteLimit;
  return {
    texto: `${c.usedToday} de ${c.dailyWriteLimit} hoje`,
    detalhe: estourou ? `Cota do dia esgotada — as escritas estão sendo recusadas. ${vira}` : vira,
    tom: estourou ? 'warn' : 'ok',
  };
}

const NOME_VAZIO = 'O nome não pode ficar vazio: escreva outro, ou deixe como estava.';

/**
 * O QUE OS DOIS CAMPOS ESTÃO PEDINDO — a mesma leitura para a frase e para o
 * salvar, de propósito: duas leituras divergiriam no dia em que uma mudasse.
 *
 * ⚠️ CAMPO DO TETO VAZIO NÃO É ZERO. `Number('')` é 0, e zero suspende o
 * agente: esvaziar o campo suspenderia uma conexão por acidente, e ninguém
 * apaga um número querendo isso. Vazio aqui quer dizer "não mexi no teto".
 * Zero DIGITADO continua valendo e continua suspendendo — a suspensão é uma
 * decisão, não um descuido.
 */
function mudancaPedida(
  c: Conexao,
  nome: string,
  teto: string,
): { name?: string; dailyWriteLimit?: number; recusa?: string } {
  const limpo = nome.trim();
  if (limpo.length === 0) return { recusa: NOME_VAZIO };
  const mudanca: { name?: string; dailyWriteLimit?: number } = {};
  if (limpo !== c.name) mudanca.name = limpo;
  const escrito = teto.trim();
  if (escrito.length > 0) {
    const numero = Number(escrito);
    if (Number.isInteger(numero) && numero >= 0 && numero !== c.dailyWriteLimit) {
      mudanca.dailyWriteLimit = numero;
    }
  }
  return mudanca;
}

/** A frase que a janela mostra ANTES de salvar: o que muda, e o efeito. */
function oQueVaiAcontecer(c: Conexao, nome: string, teto: string): string {
  const pedido = mudancaPedida(c, nome, teto);
  if (pedido.recusa) return pedido.recusa;
  const frases: string[] = [];
  if (pedido.name) {
    frases.push(
      `A conexão passa a aparecer como «${pedido.name}» aqui, na caixa de entrada e no selo da conversa.`,
    );
  }
  const numero = pedido.dailyWriteLimit;
  if (numero !== undefined) {
    frases.push(
      numero === 0
        ? `O teto passa de ${c.dailyWriteLimit} para 0: a próxima escrita do agente é recusada, e ele continua lendo.`
        : `O teto passa de ${c.dailyWriteLimit} para ${numero} escrita(s) por dia, valendo já na próxima escrita` +
          (c.usedToday >= numero
            ? ' — e como ele já gastou ' + c.usedToday + ' hoje, as escritas continuam recusadas até a virada do dia.'
            : '.'),
    );
  }
  if (frases.length === 0) return 'Nada muda: os dois campos estão como já estavam.';
  return frases.join(' ');
}

export default function Conexoes() {
  const [conexoes, setConexoes] = useState<Conexao[]>([]);
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [falha, setFalha] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [segredo, setSegredo] = useState<Segredo | null>(null);
  const [segredoCopiado, setSegredoCopiado] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  // A trava de verdade (dois cliques no mesmo quadro chegam antes do `disabled`).
  const escrevendo = useRef(false);
  const [viradaDoDia, setViradaDoDia] = useState<string | null>(null);
  const [governo, setGoverno] = useState<Conexao | null>(null);
  const [nomeNovo, setNomeNovo] = useState('');
  const [tetoNovo, setTetoNovo] = useState('');
  const [recado, setRecado] = useState<string | null>(null);
  // O resultado do "Desfazer escritas": o que voltou, o que ficou e por quê.
  const [resumo, setResumo] = useState<ResumoDoDesfazer | null>(null);
  const [erroDoGoverno, setErroDoGoverno] = useState<string | null>(null);
  const [avisoAntigasDispensado, setAvisoAntigasDispensado] = useState(avisoDasConexoesAntigasDispensado);

  const carregar = useCallback(async () => {
    try {
      const [c, e] = await Promise.all([
        api.conexoesDaIntegracao(),
        api.execucoesDaIntegracao().catch(() => ({ executions: [] as Execucao[] })),
      ]);
      setConexoes(c.connections);
      setViradaDoDia(c.dayResetsAt ?? null);
      setExecucoes(e.executions);
      setFalha(null);
    } catch (err) {
      if (semSessao(err)) {
        window.location.replace('/');
        return;
      }
      setFalha(err instanceof ApiError ? err.message : 'Não foi possível carregar as conexões.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /** Liga a trava da conexão; devolve falso se outra escrita está em curso. */
  function travar(id: string): boolean {
    if (escrevendo.current) return false;
    escrevendo.current = true;
    setOcupado(id);
    return true;
  }
  function soltar() {
    escrevendo.current = false;
    setOcupado(null);
  }

  async function emitir(c: Conexao, origem: HTMLElement | null) {
    if (!travar(c.id)) return;
    setErro(null);
    setRecado(null);
    try {
      const r = await api.emitirCredencialDaIntegracao(c.id);
      setSegredoCopiado(false);
      setSegredo({ grantId: c.id, nome: c.name, secret: r.secret, origem });
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível emitir a credencial. Tente de novo.');
    } finally {
      soltar();
    }
  }

  async function revogar(c: Conexao) {
    const certeza = window.confirm(
      `Revogar «${c.name}»? Chamadas novas do agente passam a ser recusadas. O histórico de execuções permanece.`,
    );
    if (!certeza) return;
    if (!travar(c.id)) return;
    setErro(null);
    setRecado(null);
    try {
      await api.revogarConexaoDaIntegracao(c.id);
      setRecado(`«${c.name}» revogada: chamadas novas do agente são recusadas. O histórico continua abaixo.`);
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível revogar. Tente de novo.');
    } finally {
      soltar();
    }
  }

  function abrirGoverno(c: Conexao) {
    setErro(null);
    setRecado(null);
    setResumo(null);
    setGoverno(c);
    setErroDoGoverno(null);
    setNomeNovo(c.name);
    setTetoNovo(String(c.dailyWriteLimit));
  }

  async function salvarGoverno() {
    if (!governo) return;
    const { recusa, ...mudanca } = mudancaPedida(governo, nomeNovo, tetoNovo);
    // Clicar em Salvar SEMPRE dá retorno: ou salva, ou diz por que não.
    if (recusa) {
      setErroDoGoverno(recusa);
      return;
    }
    if (mudanca.name === undefined && mudanca.dailyWriteLimit === undefined) {
      setGoverno(null);
      setRecado('Nada mudou: os dois campos estavam como já estavam.');
      return;
    }
    if (!travar(governo.id)) return;
    setErro(null);
    setErroDoGoverno(null);
    try {
      await api.ajustarConexaoDaIntegracao(governo.id, mudanca);
      setGoverno(null);
      setRecado(
        mudanca.dailyWriteLimit === undefined
          ? `Pronto: a conexão passou a se chamar «${mudanca.name}».`
          : `Pronto: o teto agora é de ${mudanca.dailyWriteLimit} escrita(s) por dia. Vale já na próxima escrita.`,
      );
      await carregar();
    } catch (err) {
      // A RECUSA FICA NA JANELA — F13: fechada a janela, a frase aparecia no
      // alto da página com o que a pessoa digitou perdido.
      setErroDoGoverno(err instanceof ApiError ? err.message : 'Não foi possível salvar. Tente de novo.');
    } finally {
      soltar();
    }
  }

  async function desfazer(c: Conexao) {
    const feitas = execucoes.filter((e) => e.grantId === c.id && !e.undoneAt).length;
    // A confirmação DIZ O QUE VAI ACONTECER ANTES DE ACONTECER: o que some, o
    // que volta, o que fica, e o que não volta (texto editado e movimento).
    const certeza = window.confirm(confirmacaoDoDesfazer(c.name, feitas));
    if (!certeza) return;
    if (!travar(c.id)) return;
    setErro(null);
    setRecado(null);
    setResumo(null);
    try {
      const r = await api.desfazerEscritasDaIntegracao(c.id);
      setResumo(resumoDoDesfazer(r));
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível desfazer. Tente de novo.');
    } finally {
      soltar();
    }
  }

  const vivas = conexoes.filter((c) => c.live);
  const revogadas = conexoes.filter((c) => c.revokedAt);

  return (
    <PaginaLarga>
      <TelaComBarra contexto="administracao">
        {/* O TOPO — F29 (Fase 5a). Saíram o `IDE Works · agentes` de cima do
            título e o `‹ Painel` à mão: Conexões é tela principal (o menu da
            conta leva a ela, em "Agentes de IA"), e o caminho para o Painel é
            a barra.
            F29.5b: o título é "Agentes de IA", o MESMO nome do item do menu
            que traz a pessoa aqui — clicar em "Agentes de IA" e cair numa
            tela chamada "Conexões" fazia parecer que o clique errou de porta.
            A métrica "Conexões" abaixo fica: ela conta conexões, não nomeia a
            tela. */}
        <Topo titulo="Agentes de IA" />

        {carregando && <EstadoDaPagina tipo="carregando" titulo="Carregando as conexões…" linhas={3} />}

        {!carregando && falha && (
          <EstadoDaPagina
            tipo="erro"
            titulo={falha}
            acao={{
              rotulo: 'Tentar de novo',
              aoClicar: () => {
                setCarregando(true);
                void carregar();
              },
            }}
          />
        )}

        {erro && (
          <div className="ad-aviso">
            <Aviso tipo="erro">{erro}</Aviso>
          </div>
        )}

        {recado && (
          <p className="ad-recado" role="status">
            {recado}
          </p>
        )}

        {!carregando && !falha && !avisoAntigasDispensado && (
          <AvisoDasConexoesAntigas
            antigas={conexoesAnterioresAoCorte(conexoes)}
            aoDispensar={() => {
              dispensarAvisoDasConexoesAntigas();
              setAvisoAntigasDispensado(true);
            }}
          />
        )}

        {resumo && (
          <div className="ad-aviso">
            <Aviso tipo={resumo.pulados.length > 0 ? 'atencao' : 'ok'}>
              <p>{resumo.titulo}</p>
              {resumo.pulados.length > 0 && (
                <>
                  <p className="mt-2">Ficaram como estão ({resumo.pulados.length}):</p>
                  <ul className="mt-1 list-disc pl-5">
                    {resumo.pulados.map((linha, i) => (
                      <li key={i}>{linha}</li>
                    ))}
                  </ul>
                </>
              )}
              {resumo.naoVoltam && <p className="mt-2">{resumo.naoVoltam}</p>}
            </Aviso>
          </div>
        )}

        {!carregando && !falha && (
          <>
            <dl className="ad-numeros" aria-label="Resumo das conexões">
              <div className="ad-numero">
                <dt>Conexões</dt>
                <dd className="ad-numero-valor tnum">{conexoes.length}</dd>
              </div>
              <div className="ad-numero" data-tom={vivas.length === 0 && conexoes.length > 0 ? 'warn' : undefined}>
                <dt>Vivas</dt>
                <dd className="ad-numero-valor tnum">{vivas.length}</dd>
                <dd className="ad-numero-nota">atendem o agente agora</dd>
              </div>
              <div className="ad-numero">
                <dt>Revogadas</dt>
                <dd className="ad-numero-valor tnum">{revogadas.length}</dd>
                <dd className="ad-numero-nota">histórico mantido</dd>
              </div>
            </dl>

            {conexoes.length === 0 ? (
              <EstadoDaPagina tipo="vazio" titulo="Nenhuma conexão ainda">
                Siga a receita do seu programa, logo abaixo: a autorização começa
                dentro dele. Depois de autorizada, a conexão aparece aqui — e é aqui
                que se emite o segredo da automação, uma vez só.
              </EstadoDaPagina>
            ) : (
              <ul className="ad-conexoes">
                {conexoes.map((c) => {
                  const estado = estadoDe(c);
                  const cota = cotaDe(c, viradaDoDia);
                  return (
                    <li
                      key={c.id}
                      className="ad-conexao"
                      data-estado={estado.texto}
                      aria-busy={ocupado === c.id || undefined}
                      aria-labelledby={`cx-${c.id}`}
                    >
                      <div className="ad-conexao-cabeca">
                        <h2 id={`cx-${c.id}`} className="ad-conexao-nome">
                          {c.name}
                        </h2>
                        <Selo tom={estado.tom} ponto>
                          {estado.texto}
                        </Selo>
                      </div>
                      <dl className="ad-fatos">
                        <div>
                          <dt>Alcance</dt>
                          <dd>{textoDoAlcance(c.reach)}</dd>
                        </div>
                        <div>
                          <dt>Validade</dt>
                          <dd>{validadeDe(c)}</dd>
                        </div>
                        <div className="ad-fatos-largo">
                          <dt>Escritas hoje</dt>
                          <dd>
                            {/* Parada (revogada/vencida), a cota não é "ok": é só o número. */}
                            <Selo tom={c.live ? cota.tom : 'neutro'}>{cota.texto}</Selo>{' '}
                            <span className="ad-fatos-apoio">{cota.detalhe}</span>
                          </dd>
                        </div>
                        <div className="ad-fatos-largo">
                          <dt>Execuções</dt>
                          <dd>{feitoAteAgora(c.id, execucoes)}</dd>
                        </div>
                      </dl>
                      <div className="ad-fatos-permissoes">
                        <span className="ad-fatos-rotulo">Pode</span>
                        <SelosDasPermissoes capabilities={c.capabilities} />
                      </div>
                      <div className="ad-conexao-acoes">
                        <button
                          type="button"
                          className="o-btn o-btn-vidro o-btn-sm"
                          disabled={ocupado === c.id}
                          onClick={() => abrirGoverno(c)}
                        >
                          Nome e teto
                        </button>
                        <button
                          type="button"
                          className="o-btn o-btn-vidro o-btn-sm"
                          disabled={ocupado === c.id || !c.live}
                          onClick={(e) => void emitir(c, e.currentTarget)}
                        >
                          {c.live ? 'Emitir / rotacionar credencial' : 'Credencial indisponível'}
                        </button>
                        <span className="ad-conexao-perigo">
                          <button
                            type="button"
                            className="o-btn o-btn-fantasma o-btn-sm"
                            disabled={ocupado === c.id}
                            onClick={() => void desfazer(c)}
                          >
                            Desfazer escritas
                          </button>
                          <button
                            type="button"
                            className="o-btn o-btn-fantasma o-btn-sm"
                            disabled={ocupado === c.id || Boolean(c.revokedAt)}
                            onClick={() => void revogar(c)}
                          >
                            Revogar
                          </button>
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        <ConectarAgente />

        <section className="ad-secao" aria-labelledby="ad-execucoes">
          <div className="ad-secao-cabeca">
            <h2 id="ad-execucoes" className="ad-secao-titulo">
              Execuções recentes <span className="tnum">{execucoes.length}</span>
            </h2>
            <Ajuda sobre="o ledger das escritas de agente">
              Tudo o que um agente escreveu: comentários, movimentos, tarefas,
              notas do mural e registros do histórico. O registro não guarda
              texto — só o efeito (ids, destino). Onde aparece «não se desfaz»,
              o «Desfazer escritas» não devolve aquela mudança.
            </Ajuda>
          </div>
          {execucoes.length === 0 ? (
            <p className="ad-vazio">Nenhuma execução ainda.</p>
          ) : (
            <div className="o-card overflow-hidden">
              {execucoes.map((e) => (
                <LinhaDaExecucao key={e.id} execucao={e} />
              ))}
            </div>
          )}
        </section>
      </TelaComBarra>

      {governo && (
        <Janela rotulo="Nome e teto da conexão" aoFechar={() => setGoverno(null)} devolverFoco>
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="eyebrow">Nome e teto</div>
              <h2 className="o-titulo text-lg">{governo.name}</h2>
            </div>
            <BotaoDeFechar aoFechar={() => setGoverno(null)} />
          </header>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void salvarGoverno();
            }}
          >
            <div className="mt-3 space-y-4">
              <label className="block">
                <span className="eyebrow">Nome da conexão</span>
                <input
                  className="o-campo mt-1 w-full"
                  aria-label="Nome da conexão"
                  maxLength={80}
                  value={nomeNovo}
                  onChange={(e) => setNomeNovo(e.target.value)}
                />
                <span className="mt-1 block text-[0.8125rem] text-mute">{SOBRE_O_NOME}</span>
              </label>
              <label className="block">
                <span className="eyebrow">Teto diário de escritas</span>
                <input
                  className="o-campo tnum mt-1 w-full"
                  aria-label="Teto diário de escritas"
                  type="number"
                  min={0}
                  max={100000}
                  step={1}
                  value={tetoNovo}
                  onChange={(e) => setTetoNovo(e.target.value)}
                />
                <span className="mt-1 block text-[0.8125rem] text-mute">
                  {SOBRE_O_TETO} Deixar o campo em branco é não mexer no teto.
                </span>
              </label>
              {/* A CONFIRMAÇÃO DIZ O QUE VAI ACONTECER ANTES DE ACONTECER. */}
              <Aviso tipo="atencao">
                <span>{oQueVaiAcontecer(governo, nomeNovo, tetoNovo)}</span>
              </Aviso>
              {erroDoGoverno && <Aviso tipo="erro">{erroDoGoverno}</Aviso>}
            </div>
            <footer className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" className="o-btn o-btn-fantasma" onClick={() => setGoverno(null)}>
                Cancelar
              </button>
              <button type="submit" className="o-btn o-btn-solido" disabled={ocupado === governo.id}>
                {ocupado === governo.id ? 'Salvando…' : 'Salvar'}
              </button>
            </footer>
          </form>
        </Janela>
      )}

      {/* A CREDENCIAL DE EXIBIÇÃO ÚNICA — preservada na F13: o segredo mora só
          neste estado da tela (nunca em cofre do navegador, endereço ou log) e
          some ao fechar. `data-segredo` é a marca que as capturas usam para
          tarjar o valor. */}
      {segredo && (
        <Janela rotulo="Credencial de automação" aoFechar={() => setSegredo(null)} devolverFoco={segredo.origem}>
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="eyebrow">Credencial de automação</div>
              <h2 className="o-titulo text-lg">{segredo.nome}</h2>
            </div>
            <BotaoDeFechar aoFechar={() => setSegredo(null)} />
          </header>
          <div className="mt-3 space-y-3">
            <Aviso tipo="atencao">{SEGREDO_UMA_VEZ}</Aviso>
            <div className="rounded-md border border-hair-2 bg-ink-2 p-4 text-center">
              <div className="text-xs uppercase tracking-wide text-mute">Segredo</div>
              <div className="mt-1 break-all font-mono text-sm tracking-wide text-luz" data-segredo>
                {segredo.secret}
              </div>
            </div>
          </div>
          <footer className="mt-4 flex flex-wrap justify-end gap-2">
            <button type="button" className="o-btn o-btn-fantasma" onClick={() => setSegredo(null)}>
              Fechar
            </button>
            <button
              type="button"
              className="o-btn o-btn-solido"
              onClick={async () => {
                await navigator.clipboard.writeText(segredo.secret);
                setSegredoCopiado(true);
              }}
            >
              {segredoCopiado ? 'Copiado' : 'Copiar segredo'}
            </button>
          </footer>
        </Janela>
      )}
    </PaginaLarga>
  );
}
