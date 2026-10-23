/**
 * "SOLICITAR APROVAÇÃO" NO CARD — F42, Fase 4.
 *
 * ONDE MORA
 *   Na ficha da tarefa, logo depois de "Anexar arquivo": é ali que estão os
 *   links do Dropbox que a janela pré-lista. A seção só existe quando o cliente
 *   DO CARD tem a aprovação externa ligada (ou quando o card já tem rodadas para
 *   mostrar) — cliente sem a chave não vê botão nenhum.
 *
 * O QUE ELA MOSTRA
 *   - esteira sem os três destinos: o que falta e o caminho para configurar
 *     (admin abre a caixa da esteira ali mesmo; os demais leem onde pedir);
 *   - pronta: "Solicitar aprovação" (ou "Enviar nova versão", quando há uma
 *     aberta — a nova a substitui);
 *   - as rodadas: versão, data, estado, quem enviou; "Copiar link do cliente"
 *     para quem pode (admin — a rota da Fase 3 é só dele).
 *
 * A JANELA
 *   F42, Fase 9: lista também as ARTES ANEXADAS ao card (imagem permanente,
 *   com miniatura assinada na hora), que vão como cópia imutável da rodada.
 *   Lista os links do Dropbox já no card (anexos, descrição, comentários),
 *   aceita colar mais, ordena o carrossel (↑ ↓, pelo teclado), mostra a legenda
 *   que será copiada (a descrição SALVA do card) e a prévia "como o cliente
 *   verá": arquivo toca/aparece pelo endereço `raw=1`; pasta vira "abrir pasta
 *   no Dropbox". `referrerPolicy="no-referrer"` nas mídias, como nos anexos.
 *
 * TESTES: `SecaoDaAprovacao` e `JanelaDeAprovacao` desenham no servidor
 * (`tela-da-aprovacao-do-card.test.ts`); o envio de verdade é o e2e
 * `aprovacao-envio`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { CaixaDaAprovacao } from '@/board/AprovacaoDaEsteira';
import {
  type AnexoDoCard,
  type LinkDoCard,
  anexosDoCard,
  chaveDoAnexo,
  dataEHora,
  entradasDasChaves,
  idDaChave,
  fraseDaDecisao,
  linksDoCard,
  moverNaOrdem,
  rotuloDeMateriais,
  situacaoDoCard,
} from '@/board/aprovacao-do-card';
import type { TaskDetail } from '@/board/ficha';
import { ApiError, api, semSessao } from '@/lib/api';
import type { AprovacaoDoCard, RodadaDoCard } from '@/server/aprovacao-envio';
import {
  type EntradaDoMaterial,
  type MaterialLido,
  LIMITE_DE_ITENS,
  ROTULO_DO_ESTADO,
  ROTULO_DO_TIPO,
  TOM_DO_ESTADO,
  conferirMateriais,
  fraseDoLinkRecusado,
  lerMaterial,
} from '@/server/material-de-aprovacao';
import { BotaoDeFechar, Janela } from '@/ui/janela';

import '@/ui/aprovacao.css';

const fraseDe = (e: unknown, padrao: string) => (e instanceof ApiError && e.message ? e.message : padrao);

/* ─────────────────────────── a prévia ─────────────────────────── */

/** Um material como o cliente o verá: vídeo toca, imagem aparece, pasta abre no Dropbox. */
export function PreviaDoMaterial({ material, posicao }: { material: MaterialLido; posicao: number }) {
  const [quebrou, setQuebrou] = useState(false);
  const rotulo = `${posicao}. ${material.nome}`;
  return (
    <figure className="ap-previa-item" data-previa-tipo={material.forma === 'pasta' ? 'pasta' : material.tipo}>
      {material.forma === 'pasta' ? (
        <a className="ap-previa-pasta" href={material.url} target="_blank" rel="noopener noreferrer">
          Abrir pasta no Dropbox
        </a>
      ) : material.tipo === 'image' && material.exibicao && !quebrou ? (
        <img
          className="ap-previa-midia"
          src={material.exibicao}
          alt={rotulo}
          // O Dropbox recebe o pedido do arquivo, e não o endereço desta tela.
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setQuebrou(true)}
        />
      ) : material.tipo === 'video' && material.exibicao && !quebrou ? (
        // `preload="metadata"`: a prévia não baixa o vídeo inteiro só por abrir.
        <video
          className="ap-previa-midia"
          src={material.exibicao}
          controls
          playsInline
          preload="metadata"
          aria-label={rotulo}
          onError={() => setQuebrou(true)}
        >
          <track kind="captions" />
        </video>
      ) : (
        <a className="ap-previa-pasta" href={material.url} target="_blank" rel="noopener noreferrer">
          Abrir no Dropbox
        </a>
      )}
      {quebrou && (
        <p className="ap-falha">
          Não carregou: o link pode estar fechado (precisa ser &quot;qualquer pessoa com o link&quot;) ou o arquivo foi
          apagado. O cliente verá o mesmo.
        </p>
      )}
      <figcaption className="ap-apoio">{rotulo}</figcaption>
    </figure>
  );
}

/**
 * A arte anexada como o cliente a verá (F42, Fase 9): a imagem do anexo, pela
 * miniatura assinada na hora. O cliente vê a CÓPIA feita no envio — os mesmos
 * bytes.
 */
export function PreviaDoAnexo({ anexo, endereco, posicao }: { anexo: AnexoDoCard; endereco: string | null; posicao: number }) {
  const [quebrou, setQuebrou] = useState(false);
  const rotulo = `${posicao}. ${anexo.nome}`;
  return (
    <figure className="ap-previa-item" data-previa-tipo="anexo">
      {endereco && !quebrou ? (
        <img
          className="ap-previa-midia"
          src={endereco}
          alt={rotulo}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setQuebrou(true)}
        />
      ) : (
        <p className="ap-apoio">{quebrou ? 'A miniatura não carregou aqui; a arte vai assim mesmo.' : 'carregando a arte…'}</p>
      )}
      <figcaption className="ap-apoio">{rotulo}</figcaption>
    </figure>
  );
}

/** Um material da ordem, já lido: link do Dropbox ou arte anexada. */
type Escolhido = { chave: string; nome: string; titulo: string; tipo: string; rotulo: string } & (
  | { forma: 'link'; material: MaterialLido }
  | { forma: 'anexo'; anexo: AnexoDoCard }
);

function lerEscolhido(chave: string, anexos: readonly AnexoDoCard[]): Escolhido | null {
  const id = idDaChave(chave);
  if (id !== null) {
    const anexo = anexos.find((a) => a.id === id) ?? { id, nome: 'Arte anexada', origem: 'anexo do card' };
    return { chave, forma: 'anexo', anexo, nome: anexo.nome, titulo: `Anexo do card: ${anexo.nome}`, tipo: 'anexo', rotulo: 'Arte' };
  }
  const m = lerMaterial(chave);
  if (m === null) return null;
  return {
    chave,
    forma: 'link',
    material: m,
    nome: m.nome,
    titulo: m.url,
    tipo: m.forma === 'pasta' ? 'pasta' : m.tipo,
    rotulo: m.forma === 'pasta' ? 'Pasta' : ROTULO_DO_TIPO[m.tipo],
  };
}

/* ─────────────────────────── a janela ─────────────────────────── */

export function JanelaDeAprovacao({
  clienteNome,
  etapaDeAguardando,
  legenda,
  legendaMudou = false,
  sugestoes,
  anexos = [],
  miniaturas = {},
  aberta = null,
  inicial = [],
  previaInicial = false,
  enviando = false,
  falha = null,
  aoEnviar,
  aoFechar,
}: {
  clienteNome: string | null;
  etapaDeAguardando: string | null;
  /** A descrição SALVA do card — é ela que o banco copia. */
  legenda: string | null;
  /** O briefing tem mudança ainda não salva: avisar que vai a versão salva. */
  legendaMudou?: boolean;
  sugestoes: readonly LinkDoCard[];
  /** F42, Fase 9: as artes anexadas ao card que podem ir ao cliente. */
  anexos?: readonly AnexoDoCard[];
  /** Endereço assinado da miniatura de cada anexo (id → url), pedido ao abrir. */
  miniaturas?: Readonly<Record<string, string>>;
  /** A versão aberta, que a nova vai substituir. */
  aberta?: number | null;
  /** Escolha inicial (para os testes de tela). */
  inicial?: readonly string[];
  previaInicial?: boolean;
  enviando?: boolean;
  falha?: string | null;
  aoEnviar: (materiais: EntradaDoMaterial[]) => void;
  aoFechar: () => void;
}) {
  const [escolhidos, setEscolhidos] = useState<string[]>([...inicial]);
  const [colado, setColado] = useState('');
  const [recusa, setRecusa] = useState<string | null>(null);
  const [previa, setPrevia] = useState(previaInicial);

  const materiais = escolhidos.map((k) => lerEscolhido(k, anexos)).filter((m): m is Escolhido => m !== null);
  const restantes = sugestoes.filter((s) => !escolhidos.includes(s.url));
  const anexosRestantes = anexos.filter((a) => !escolhidos.includes(chaveDoAnexo(a.id)));
  const cheio = escolhidos.length >= LIMITE_DE_ITENS;

  const incluir = (urls: readonly string[]) => setEscolhidos((e) => [...e, ...urls.filter((u) => !e.includes(u))].slice(0, LIMITE_DE_ITENS));

  const colar = () => {
    const linhas = colado
      .split(/\s+/)
      .map((l) => l.trim())
      .filter((l) => l !== '');
    if (linhas.length === 0) return;
    const prontos: string[] = [];
    for (const [i, l] of linhas.entries()) {
      const m = lerMaterial(l);
      if (m === null) {
        setRecusa(fraseDoLinkRecusado(escolhidos.length + i + 1, l));
        return;
      }
      prontos.push(m.url);
    }
    setRecusa(null);
    incluir(prontos);
    setColado('');
  };

  const conferido = conferirMateriais(entradasDasChaves(escolhidos));
  const podeEnviar = !enviando && conferido.ok;

  return (
    <Janela rotulo="Solicitar aprovação do cliente" largura="max-w-2xl ap-janela" aoFechar={aoFechar} devolverFoco>
      <div className="ap-janela-corpo" data-janela-aprovacao>
        <div className="ap-janela-topo">
          <h2 className="ap-janela-titulo">
            Solicitar aprovação{clienteNome ? <span className="ap-apoio"> · {clienteNome}</span> : null}
          </h2>
          <BotaoDeFechar aoFechar={aoFechar} />
        </div>

        <p className="ap-apoio">
          O cliente verá os materiais nesta ordem, com a legenda abaixo, no link dele. Ao enviar, o card vai para{' '}
          <b>{etapaDeAguardando ?? 'aguardando cliente'}</b>.
          {aberta !== null && ` A versão ${aberta}, ainda aberta, será substituída.`}
        </p>

        {/* --- o carrossel, na ordem ------------------------------------------ */}
        <section className="ap-bloco" aria-labelledby="ap-ordem-titulo">
          <h3 id="ap-ordem-titulo" className="ap-bloco-titulo">
            Material, na ordem do carrossel <span className="ap-conta">{escolhidos.length}/{LIMITE_DE_ITENS}</span>
          </h3>
          {materiais.length === 0 ? (
            <p className="ap-apoio">Nada escolhido ainda. Inclua as artes anexadas, os links do card ou cole outros abaixo.</p>
          ) : (
            <ol className="ap-ordem" data-ordem-aprovacao>
              {materiais.map((m, i) => (
                <li key={m.chave} className="ap-ordem-item" data-material={m.chave}>
                  <span className="ap-ordem-n tnum" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="ap-tipo" data-tipo={m.tipo}>
                    {m.rotulo}
                  </span>
                  <span className="ap-ordem-nome" title={m.titulo}>
                    {m.nome}
                  </span>
                  <span className="ap-ordem-acoes">
                    <button
                      type="button"
                      className="o-btn o-btn-fantasma o-btn-sm"
                      aria-label={`Subir ${m.nome}`}
                      disabled={i === 0 || enviando}
                      onClick={() => setEscolhidos((e) => moverNaOrdem(e, i, i - 1))}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="o-btn o-btn-fantasma o-btn-sm"
                      aria-label={`Descer ${m.nome}`}
                      disabled={i === materiais.length - 1 || enviando}
                      onClick={() => setEscolhidos((e) => moverNaOrdem(e, i, i + 1))}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="o-btn o-btn-fantasma o-btn-sm"
                      aria-label={`Tirar ${m.nome}`}
                      disabled={enviando}
                      onClick={() => setEscolhidos((e) => e.filter((u) => u !== m.chave))}
                    >
                      ✕
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* --- as artes anexadas ao card (F42, Fase 9) ------------------------ */}
        <section className="ap-bloco" aria-labelledby="ap-anexos-titulo">
          <h3 id="ap-anexos-titulo" className="ap-bloco-titulo">
            Artes anexadas a este card
          </h3>
          {anexos.length === 0 ? (
            <p className="ap-apoio">
              Nenhuma imagem anexada (png, jpg, webp ou gif). Vídeo vai pelo link do Dropbox.
            </p>
          ) : anexosRestantes.length === 0 ? (
            <p className="ap-apoio">Todas já estão no carrossel.</p>
          ) : (
            <>
              <ul className="ap-sugestoes">
                {anexosRestantes.map((a) => (
                  <li key={a.id} className="ap-sugestao" data-sugestao-anexo={a.id}>
                    {miniaturas[a.id] ? (
                      <img
                        className="ap-miniatura"
                        src={miniaturas[a.id]}
                        alt=""
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        data-miniatura
                      />
                    ) : (
                      <span className="ap-tipo" data-tipo="anexo">
                        Arte
                      </span>
                    )}
                    <span className="ap-ordem-nome" title={a.nome}>
                      {a.nome}
                      <span className="ap-origem"> · {a.origem}</span>
                    </span>
                    <button
                      type="button"
                      className="o-btn o-btn-vidro o-btn-sm"
                      aria-label={`Incluir ${a.nome}`}
                      disabled={cheio || enviando}
                      onClick={() => incluir([chaveDoAnexo(a.id)])}
                    >
                      Incluir
                    </button>
                  </li>
                ))}
              </ul>
              {anexosRestantes.length > 1 && (
                <button
                  type="button"
                  className="o-btn o-btn-fantasma o-btn-sm ap-incluir-todos"
                  disabled={cheio || enviando}
                  onClick={() => incluir(anexosRestantes.map((a) => chaveDoAnexo(a.id)))}
                >
                  Incluir todas as artes
                </button>
              )}
            </>
          )}
        </section>

        {/* --- os links que já estão no card ---------------------------------- */}
        <section className="ap-bloco" aria-labelledby="ap-sugestoes-titulo">
          <h3 id="ap-sugestoes-titulo" className="ap-bloco-titulo">
            Links do Dropbox neste card
          </h3>
          {sugestoes.length === 0 ? (
            <p className="ap-apoio">Nenhum link do Dropbox no card. Cole abaixo.</p>
          ) : restantes.length === 0 ? (
            <p className="ap-apoio">Todos já estão no carrossel.</p>
          ) : (
            <>
              <ul className="ap-sugestoes">
                {restantes.map((s) => {
                  const m = lerMaterial(s.url);
                  return (
                    <li key={s.url} className="ap-sugestao" data-sugestao={s.url}>
                      <span className="ap-tipo" data-tipo={m?.forma === 'pasta' ? 'pasta' : m?.tipo}>
                        {m?.forma === 'pasta' ? 'Pasta' : m ? ROTULO_DO_TIPO[m.tipo] : 'Link'}
                      </span>
                      <span className="ap-ordem-nome" title={s.url}>
                        {m?.nome ?? s.url}
                        <span className="ap-origem"> · {s.origem}</span>
                      </span>
                      <button
                        type="button"
                        className="o-btn o-btn-vidro o-btn-sm"
                        aria-label={`Incluir ${m?.nome ?? s.url}`}
                        disabled={cheio || enviando}
                        onClick={() => incluir([s.url])}
                      >
                        Incluir
                      </button>
                    </li>
                  );
                })}
              </ul>
              {restantes.length > 1 && (
                <button
                  type="button"
                  className="o-btn o-btn-fantasma o-btn-sm ap-incluir-todos"
                  disabled={cheio || enviando}
                  onClick={() => incluir(restantes.map((s) => s.url))}
                >
                  Incluir todos
                </button>
              )}
            </>
          )}
        </section>

        {/* --- colar mais ----------------------------------------------------- */}
        <section className="ap-bloco">
          <label className="ap-bloco-titulo" htmlFor="ap-colar">
            Colar links do Dropbox <span className="ap-apoio">(um por linha)</span>
          </label>
          <div className="ap-colar">
            <textarea
              id="ap-colar"
              className="ap-endereco"
              rows={2}
              value={colado}
              disabled={cheio || enviando}
              placeholder="https://www.dropbox.com/scl/fi/…"
              onChange={(e) => {
                setColado(e.target.value);
                setRecusa(null);
              }}
            />
            <button
              type="button"
              className="o-btn o-btn-vidro o-btn-sm"
              disabled={colado.trim() === '' || cheio || enviando}
              onClick={colar}
            >
              Adicionar
            </button>
          </div>
          {recusa && (
            <p className="ap-falha" role="alert" data-recusa-link>
              {recusa}
            </p>
          )}
        </section>

        {/* --- a legenda ------------------------------------------------------ */}
        <section className="ap-bloco" aria-labelledby="ap-legenda-titulo">
          <h3 id="ap-legenda-titulo" className="ap-bloco-titulo">
            Legenda (copiada da descrição do card)
          </h3>
          <div className="ap-legenda" data-legenda>
            {legenda && legenda.trim() !== '' ? legenda : <span className="ap-apoio">Sem legenda: a descrição do card está vazia.</span>}
          </div>
          {legendaMudou && (
            <p className="ap-alerta">
              A descrição tem mudança ainda não salva. Vai a versão salva — salve antes se a legenda mudou.
            </p>
          )}
          <p className="ap-apoio">Editar a descrição depois não muda o que foi enviado.</p>
        </section>

        {/* --- como o cliente verá -------------------------------------------- */}
        <section className="ap-bloco">
          <button
            type="button"
            className="o-btn o-btn-vidro o-btn-sm"
            aria-expanded={previa}
            disabled={materiais.length === 0}
            onClick={() => setPrevia((v) => !v)}
          >
            {previa ? 'Esconder a prévia' : 'Ver como o cliente verá'}
          </button>
          {previa && materiais.length > 0 && (
            <div className="ap-previa" data-previa-aprovacao>
              {materiais.map((m, i) =>
                m.forma === 'anexo' ? (
                  <PreviaDoAnexo key={m.chave} anexo={m.anexo} endereco={miniaturas[m.anexo.id] ?? null} posicao={i + 1} />
                ) : (
                  <PreviaDoMaterial key={m.chave} material={m.material} posicao={i + 1} />
                ),
              )}
              {legenda && legenda.trim() !== '' && <p className="ap-legenda ap-legenda-previa">{legenda}</p>}
            </div>
          )}
        </section>

        {/* --- o pé ----------------------------------------------------------- */}
        <div className="ap-janela-pe">
          {falha && (
            <p className="ap-falha" role="alert" data-falha-envio>
              {falha}
            </p>
          )}
          <div className="ap-botoes ap-botoes-fim">
            <button type="button" className="o-btn o-btn-fantasma o-btn-sm" disabled={enviando} onClick={aoFechar}>
              Cancelar
            </button>
            <button
              type="button"
              className="o-btn o-btn-primario o-btn-sm"
              disabled={!podeEnviar}
              data-enviar-aprovacao
              onClick={() => aoEnviar(entradasDasChaves(escolhidos))}
            >
              {enviando ? 'enviando…' : `Enviar ao cliente (${rotuloDeMateriais(escolhidos.length)})`}
            </button>
          </div>
        </div>
      </div>
    </Janela>
  );
}

/* ─────────────────────────── a seção da ficha ─────────────────────────── */

function LinhaDaRodada({ rodada }: { rodada: RodadaDoCard }) {
  const decisao = fraseDaDecisao(rodada);
  const comentario = rodada.decisionComment?.trim() ? rodada.decisionComment.trim() : null;
  return (
    <li className="ap-rodada" data-rodada={rodada.version} data-estado={rodada.state}>
      <span className="ap-rodada-versao tnum">v{rodada.version}</span>
      <span className="ap-rodada-estado" data-tom={TOM_DO_ESTADO[rodada.state]}>
        {ROTULO_DO_ESTADO[rodada.state]}
      </span>
      <span className="ap-apoio tnum">
        enviada {dataEHora(rodada.sentAt)}
        {rodada.sentBy ? ` · por ${rodada.sentBy}` : ''} · {rotuloDeMateriais(rodada.items.length)}
      </span>
      {/* F42, Fase 7: quem decidiu e quando — e o motivo, quando pediu ajustes. */}
      {decisao && (
        <span className="ap-rodada-decisao tnum" data-decisao>
          {decisao}
        </span>
      )}
      {comentario && (
        <p className="ap-rodada-motivo selecionavel" data-motivo>
          <span className="ap-rodada-motivo-rotulo">
            {rodada.state === 'rejected' ? 'Motivo do cliente:' : 'Comentário do cliente:'}
          </span>{' '}
          {comentario}
        </p>
      )}
    </li>
  );
}

/** A seção, sem efeito: tudo chega por `props`. */
export function SecaoDaAprovacao({
  aprovacao,
  ocupado = false,
  recado = null,
  falha = null,
  endereco = null,
  configurando = false,
  aoSolicitar,
  aoConfigurar,
  aoFecharConfiguracao,
  aoCopiar,
}: {
  aprovacao: AprovacaoDoCard;
  ocupado?: boolean;
  recado?: string | null;
  falha?: string | null;
  /** O link do cliente, quando o navegador não deixou copiar: fica à vista. */
  endereco?: string | null;
  configurando?: boolean;
  aoSolicitar: () => void;
  aoConfigurar: () => void;
  aoFecharConfiguracao: () => void;
  aoCopiar: () => void;
}) {
  const situacao = situacaoDoCard(aprovacao);
  if (situacao.tipo === 'oculto' && aprovacao.rounds.length === 0) return null;
  const aberta = aprovacao.rounds.find((r) => r.state === 'open') ?? null;

  return (
    <section className="a-secao ap-card" data-aprovacao-card data-situacao={situacao.tipo}>
      <div className="ap-card-topo">
        <span className="ap-card-titulo">Aprovação do cliente</span>
        {aprovacao.clientName && <span className="ap-apoio">{aprovacao.clientName}</span>}
      </div>

      {situacao.tipo === 'sem-destinos' && (
        <div className="ap-card-falta" data-falta-destinos>
          <p className="ap-alerta">{situacao.frase}</p>
          {aprovacao.canConfigure && aprovacao.listId ? (
            <span className="cu-ancora">
              <button
                type="button"
                className="o-btn o-btn-vidro o-btn-sm"
                aria-expanded={configurando}
                onClick={configurando ? aoFecharConfiguracao : aoConfigurar}
              >
                {/* F43, Fase 6: "esteira" saiu da ficha — a palavra de quem usa é "etapas". */}
                Configurar as etapas
              </button>
              {configurando && <CaixaDaAprovacao listId={aprovacao.listId} aoFechar={aoFecharConfiguracao} lado="baixo" />}
            </span>
          ) : (
            <p className="ap-apoio">
              Peça a um administrador: no menu <b>···</b> da lista, <b>Aprovação do cliente…</b>
            </p>
          )}
        </div>
      )}

      {situacao.tipo === 'pronto' && (
        <div className="ap-botoes">
          <button
            type="button"
            className="o-btn o-btn-primario o-btn-sm"
            data-solicitar-aprovacao
            disabled={ocupado}
            onClick={aoSolicitar}
          >
            {aberta ? 'Enviar nova versão' : 'Solicitar aprovação'}
          </button>
          {aprovacao.canCopyLink && (
            <button type="button" className="o-btn o-btn-fantasma o-btn-sm" disabled={ocupado} onClick={aoCopiar}>
              Copiar link do cliente
            </button>
          )}
        </div>
      )}

      {recado && (
        <p className="ap-ok" role="status">
          {recado}
        </p>
      )}
      {falha && (
        <p className="ap-falha" role="alert">
          {falha}
        </p>
      )}
      {endereco && <input className="ap-endereco" readOnly value={endereco} aria-label="Link do cliente" />}

      {aprovacao.rounds.length > 0 && (
        <ol className="ap-rodadas" aria-label="Rodadas enviadas" data-rodadas>
          {aprovacao.rounds.map((r) => (
            <LinhaDaRodada key={r.id} rodada={r} />
          ))}
        </ol>
      )}
    </section>
  );
}

/** Copia; se o navegador recusar, o endereço fica à vista para copiar à mão. */
async function paraAreaDeTransferencia(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

/** A seção com estado: lê ao abrir a ficha (só card com cliente), envia, copia. */
export function AprovacaoNaFicha({
  tarefa,
  descricaoPorSalvar = false,
  aoAssentar,
}: {
  tarefa: TaskDetail;
  /** O briefing tem mudança ainda não salva: a janela avisa que vai a versão salva. */
  descricaoPorSalvar?: boolean;
  aoAssentar: (t: TaskDetail) => void;
}) {
  const [aprovacao, setAprovacao] = useState<AprovacaoDoCard | null>(null);
  const [janela, setJanela] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [falhaDoEnvio, setFalhaDoEnvio] = useState<string | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  const [endereco, setEndereco] = useState<string | null>(null);
  const [configurando, setConfigurando] = useState(false);
  const [miniaturas, setMiniaturas] = useState<Record<string, string>>({});
  const temCliente = tarefa.clientId !== null;
  const artes = anexosDoCard(tarefa);
  const idsDasArtes = artes.map((a) => a.id).join(',');

  // As miniaturas das artes: assinadas NA HORA de abrir a janela (5 min), em
  // um pedido só, como o quadro (F17.56). Falhar só tira a miniatura. Cada
  // abertura da janela pede uma vez só, e só o que ainda não pediu: a ficha
  // relida (ou o efeito repetido do modo estrito) não reassina o mesmo anexo.
  const pedidas = useRef(new Set<string>());
  useEffect(() => {
    if (!janela) {
      pedidas.current.clear();
      return;
    }
    const faltam = idsDasArtes === '' ? [] : idsDasArtes.split(',').filter((id) => !pedidas.current.has(id));
    if (faltam.length === 0) return;
    for (const id of faltam) pedidas.current.add(id);
    void api
      .enderecosDosAnexos(faltam)
      .then((r) => setMiniaturas((m) => ({ ...m, ...Object.fromEntries(Object.entries(r.urls).map(([k, v]) => [k, v.url])) })))
      .catch(() => undefined);
  }, [janela, idsDasArtes]);

  const ler = useCallback(async () => {
    try {
      const r = await api.aprovacaoDoCard(tarefa.id);
      // Resposta sem a forma esperada (servidor antigo no meio de uma
      // publicação): a seção some em vez de derrubar a ficha.
      setAprovacao(r.approval && Array.isArray(r.approval.rounds) ? r.approval : null);
    } catch (e) {
      if (semSessao(e)) {
        window.location.replace('/');
        return;
      }
      // A seção é acessória: falhar a leitura não pode quebrar a ficha.
      setAprovacao(null);
    }
  }, [tarefa.id]);

  useEffect(() => {
    if (!temCliente) {
      setAprovacao(null);
      return;
    }
    void ler();
  }, [ler, temCliente, tarefa.clientId, tarefa.listId]);

  if (aprovacao === null) return null;

  const enviar = async (materiais: EntradaDoMaterial[]) => {
    setEnviando(true);
    setFalhaDoEnvio(null);
    try {
      const r = await api.solicitarAprovacao(tarefa.id, materiais);
      setAprovacao(r.approval);
      setJanela(false);
      setFalha(null);
      setRecado(
        `Versão ${r.version} enviada${r.superseded > 0 ? ' (a anterior foi substituída)' : ''}. O card foi para "${
          r.approval.awaitingStatusName ?? 'aguardando cliente'
        }".`,
      );
      aoAssentar(r.task as TaskDetail);
    } catch (e) {
      if (semSessao(e)) {
        window.location.replace('/');
        return;
      }
      setFalhaDoEnvio(fraseDe(e, 'Não foi possível enviar. Tente de novo.'));
    } finally {
      setEnviando(false);
    }
  };

  const copiar = async () => {
    if (aprovacao.clientId === null) return;
    setFalha(null);
    setRecado(null);
    setEndereco(null);
    try {
      const r = await api.copiarLinkDeAprovacao(aprovacao.clientId);
      if (await paraAreaDeTransferencia(r.url)) setRecado('Link do cliente copiado.');
      else setEndereco(r.url);
    } catch (e) {
      if (semSessao(e)) {
        window.location.replace('/');
        return;
      }
      setFalha(fraseDe(e, 'Não foi possível copiar o link do cliente.'));
    }
  };

  const aberta = aprovacao.rounds.find((r) => r.state === 'open') ?? null;

  return (
    <>
      <SecaoDaAprovacao
        aprovacao={aprovacao}
        ocupado={enviando}
        recado={recado}
        falha={falha}
        endereco={endereco}
        configurando={configurando}
        aoSolicitar={() => {
          setFalhaDoEnvio(null);
          setRecado(null);
          setJanela(true);
        }}
        aoConfigurar={() => setConfigurando(true)}
        aoFecharConfiguracao={() => {
          setConfigurando(false);
          void ler();
        }}
        aoCopiar={() => void copiar()}
      />
      {janela && (
        <JanelaDeAprovacao
          clienteNome={aprovacao.clientName}
          etapaDeAguardando={aprovacao.awaitingStatusName}
          legenda={tarefa.description}
          legendaMudou={descricaoPorSalvar}
          sugestoes={linksDoCard(tarefa)}
          anexos={artes}
          miniaturas={miniaturas}
          aberta={aberta?.version ?? null}
          enviando={enviando}
          falha={falhaDoEnvio}
          aoEnviar={(materiais) => void enviar(materiais)}
          aoFechar={() => {
            if (!enviando) setJanela(false);
          }}
        />
      )}
    </>
  );
}
