/**
 * O PAINEL DO CLIENTE NO PLANEJAMENTO — F43, Fase 3.
 *
 * O PEDIDO
 *   Clicar num cliente do Planejamento abre, à direita e sem sair da tela, o
 *   mês dele: os passos do mês com as chaves, o contrato por tipo, as peças
 *   por semana e as que estão sem dia. É o protótipo aprovado ("Café do Bairro
 *   · Carla · plano Conteúdo"), e junta o que vivia em quatro lugares: a lista
 *   do ritual (que saiu na Fase 2), o topo da ficha, a visão Contrato e a aba
 *   Semanal da ficha.
 *
 * NADA DE REGRA NOVA
 *   O ritual é `acaoDoMes` (sobre `proximoPasso`, `travaDoPlanejamento` e
 *   `ofereceAprovacao`, a mesma regra do servidor); a barra de cada tipo é a
 *   `BarraDoTipo` da visão Contrato, igual pixel a pixel; as semanas são a
 *   `Semanal` da ficha, inteira. O painel só junta e escreve.
 *
 * O QUE É PURO E O QUE NÃO É
 *   `ConteudoDoPainel` desenha um cliente pronto — o teste o lê com
 *   `renderToStaticMarkup`. `PainelDoCliente` é a parte com estado, pequena:
 *   grava a chave, guarda a recusa e mostra a chave virada enquanto o pedido
 *   anda (e a devolve se o servidor recusar).
 *
 * A FRASE DA RECUSA É A DO SERVIDOR
 *   "Marque o mês como planejado antes…", "Só um administrador marca o
 *   planejamento…": a tela mostra como veio (`Aviso`), e a chave volta para o
 *   que o servidor diz que é.
 */

import { type ReactNode, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';

import { Semanal } from '@/clients/Semanal';
import { ApiError, api, semSessao } from '@/lib/api';
import { enderecoDaFicha, mesDoClienteNaTela, mesPorExtenso } from '@/painel/contrato-na-tela';
import {
  type AcaoDoMes,
  acaoDoMes,
  entradaDaSemanal,
  gravarNoPainel,
  passosDoMes,
  subtituloDoCliente,
  tituloDoContrato,
} from '@/painel/painel-do-cliente';
import type { LinhaDoMes } from '@/painel/planejamento-do-mes';
import { fraseDaFalha } from '@/painel/visoes-do-planejamento';
import { BarraDoTipo } from '@/painel/VisaoDoContrato';
import { TIPO_ROTULO, nomeDoMes } from '@/ui/grade-do-mes';
import { IconeDireita, IconeEsquerda } from '@/ui/Icones';
import { PainelLateral } from '@/ui/PainelLateral';
import { Aviso, Chave } from '@/ui/primitivos';
import { useVez } from '@/ui/vez';
import '@/ui/planejamento.css';

/** A chave virada enquanto o pedido anda — some quando o mês relido chega. */
export type ChaveVirada = { passo: 'planning' | 'approval'; valor: boolean };

const maiusculo = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const minusculo = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/* ───────────────────────────── o mês do cliente ───────────────────────────── */

/**
 * Os três passos, o próximo escrito e os controles que a regra aceita agora.
 * A recusa do servidor aparece aqui embaixo, perto da chave que a causou.
 */
function MesNoPainel({
  linha,
  acao,
  ocupado,
  virada,
  recusa,
  aoAbrirMes,
  aoMarcar,
}: {
  linha: LinhaDoMes;
  acao: AcaoDoMes;
  ocupado: boolean;
  virada: ChaveVirada | null;
  recusa: string | null;
  aoAbrirMes: () => void;
  aoMarcar: (passo: ChaveVirada['passo'], valor: boolean) => void;
}) {
  const passos = passosDoMes(linha);
  // O âmbar da tabela: só o mês não aberto de quem tem contrato é motivo.
  const atencao = mesDoClienteNaTela(linha).pontos.includes('atencao');
  const proximo =
    acao.passo.acao === 'nenhuma' ? acao.passo.texto : `Próximo passo: ${minusculo(acao.passo.texto)}.`;
  const ligada = (passo: ChaveVirada['passo'], doServidor: boolean) =>
    virada?.passo === passo ? virada.valor : doServidor;

  return (
    <section
      className="plp-mes"
      aria-label={`Mês do cliente: ${linha.rotuloDoEstagio}`}
      data-estagio={linha.estagio}
      data-atencao={atencao || undefined}
    >
      <ol className="plp-passos">
        {passos.map((p) => (
          <li key={p.chave} data-passo={p.chave} data-estado={p.estado} aria-current={p.estado === 'agora' ? 'step' : undefined}>
            {p.estado === 'feito' && (
              <span className="plp-visto" aria-hidden="true">
                ✓
              </span>
            )}
            {p.rotulo}
            {p.estado === 'desconhecido' && <span className="sr-only"> (não veio nesta leitura)</span>}
          </li>
        ))}
      </ol>
      <p className="plp-proximo">{proximo}</p>

      {acao.tipo === 'abrir' && (
        <div className="plp-acoes">
          <button
            type="button"
            className="o-btn o-btn-solido o-btn-sm"
            disabled={ocupado || acao.desativada}
            onClick={aoAbrirMes}
          >
            Abrir o mês
          </button>
          {acao.motivo && <span className="plp-motivo">{acao.motivo}</span>}
        </div>
      )}

      {acao.tipo === 'chaves' && (
        <div className="plp-acoes">
          {/* A trava (mês aprovado não se desplaneja) vai no `title` e no
              leitor de tela: escrita à vista em todo mês aprovado, seria ruído
              no mês que está certo. */}
          <span title={acao.planejamento.trava ?? undefined}>
            <Chave
              rotulo="Planejamento OK"
              ligada={ligada('planning', acao.planejamento.ligada)}
              desativada={ocupado || acao.planejamento.desativada}
              aoMudar={(v) => aoMarcar('planning', v)}
            />
          </span>
          {acao.planejamento.trava && <span className="sr-only">{acao.planejamento.trava}</span>}
          {acao.aprovacao ? (
            <Chave
              rotulo="Cliente aprovou"
              ligada={ligada('approval', acao.aprovacao.ligada)}
              desativada={ocupado || acao.aprovacao.desativada}
              aoMudar={(v) => aoMarcar('approval', v)}
            />
          ) : (
            <span className="plp-espera">{acao.espera}</span>
          )}
          {/* O PORQUÊ À VISTA — quem não administra vê as chaves desligadas e
              sabe por quê, em vez de clicar e achar que gravou. */}
          {acao.motivo && <span className="plp-motivo">{acao.motivo}</span>}
        </div>
      )}

      {acao.tipo === 'sem-leitura' && <p className="plp-calmo">{acao.texto}</p>}

      {recusa && (
        <div className="plp-recusa">
          <Aviso tipo="erro">{recusa}</Aviso>
        </div>
      )}
    </section>
  );
}

/* ───────────────────────────── o contrato ───────────────────────────── */

function ContratoNoPainel({ linha, mes, hoje }: { linha: LinhaDoMes; mes: string; hoje: string }) {
  const idDoTitulo = useId();
  let corpo: ReactNode;
  if (linha.leitura === 'so-ritual') {
    // Sem a leitura das peças não há o que medir — "sem contrato" seria
    // afirmar o que não se leu (a mesma frase da tabela).
    corpo = <p className="plp-calmo">As peças deste cliente não vieram nesta leitura.</p>;
  } else if (!linha.temContrato || linha.tipos.length === 0) {
    corpo = <p className="plp-calmo">Sem contrato de conteúdo neste mês.</p>;
  } else {
    corpo = (
      <ul className="plp-tipos">
        {linha.tipos.map((t) => (
          <li key={t.tipo} className="plp-tipo" data-tipo={t.tipo}>
            <span className="plp-tipo-nome">{TIPO_ROTULO[t.tipo] ?? t.tipo}</span>
            <BarraDoTipo tipo={t.tipo} contrato={t} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <section className="plp-contrato" aria-labelledby={idDoTitulo}>
      <h3 id={idDoTitulo} className="plp-secao">
        {tituloDoContrato(mes, hoje)}
      </h3>
      {corpo}
      {/* Mês não aberto: a cota é a do cadastro de HOJE, e pode mudar até o
          mês congelar. Dizer de onde vem o número evita cobrar o que não foi
          vendido. */}
      {linha.temContrato && linha.quotaSource === 'cadastro' && (
        <p className="plp-nota">Pelo cadastro de hoje — o contrato congela quando o mês abre.</p>
      )}
    </section>
  );
}

/* ───────────────────────────── o painel inteiro ───────────────────────────── */

/**
 * O corpo do painel para um cliente pronto — puro. `souAdmin` `null` é a
 * sessão ainda chegando (chaves desligadas, sem motivo).
 */
export function ConteudoDoPainel({
  linha,
  mes,
  hoje,
  souAdmin,
  ocupado = false,
  virada = null,
  recusa = null,
  aoAbrirMes,
  aoMarcar,
  aoMudar,
}: {
  linha: LinhaDoMes;
  /** `YYYY-MM`. */
  mes: string;
  /** `YYYY-MM-DD`, no fuso da agência. */
  hoje: string;
  souAdmin: boolean | null;
  ocupado?: boolean;
  virada?: ChaveVirada | null;
  recusa?: string | null;
  aoAbrirMes: () => void;
  aoMarcar: (passo: ChaveVirada['passo'], valor: boolean) => void;
  /**
   * Releia o mês — depois de qualquer mudança nas peças. A promessa termina
   * quando o mês relido chegou: a `Semanal` espera por ela antes do próximo
   * gesto, para contar `naBase` (extra ou não) com o mês fresco.
   */
  aoMudar: () => Promise<unknown> | void;
}) {
  const acao = acaoDoMes(linha, souAdmin);
  const entrada = entradaDaSemanal(linha);
  return (
    <div className="plp" data-cliente={linha.id}>
      <MesNoPainel
        linha={linha}
        acao={acao}
        ocupado={ocupado}
        virada={virada}
        recusa={recusa}
        aoAbrirMes={aoAbrirMes}
        aoMarcar={aoMarcar}
      />
      <ContratoNoPainel linha={linha} mes={mes} hoje={hoje} />
      <section className="plp-pecas" aria-label="Peças do mês">
        {linha.leitura === 'so-ritual' ? (
          <>
            <h3 className="plp-secao">Peças do mês</h3>
            <p className="plp-calmo">As peças deste cliente não vieram nesta leitura.</p>
          </>
        ) : (
          // A GRADE DA FICHA, INTEIRA: semanas, "nada marcado", o `+` de cada
          // tipo, as peças sem dia com "Escolher o dia". Cada gesto dela relê
          // o mês da página (`aoMudar`), e o painel acompanha.
          <Semanal
            clienteId={linha.id}
            mes={mes.slice(0, 7)}
            hoje={hoje}
            itens={entrada.itens}
            contratado={entrada.contratado}
            mesAberto={entrada.mesAberto}
            semContratoDeConteudo={entrada.semContratoDeConteudo}
            titulo="Peças do mês"
            nivelDoTitulo={3}
            aoMudar={aoMudar}
          />
        )}
      </section>
    </div>
  );
}

/** O mês no alto do painel, com as setas — trocar aqui troca o da página. */
function MesDoPainel({ mes, aoMudarMes }: { mes: string; aoMudarMes: (passo: -1 | 1) => void }) {
  return (
    <div className="plp-mes-nav" role="group" aria-label="Mês do painel">
      <button
        type="button"
        className="o-btn o-btn-fantasma o-btn-icone"
        onClick={() => aoMudarMes(-1)}
        title="Ver o mês anterior"
        aria-label="Ver o mês anterior"
      >
        <IconeEsquerda />
      </button>
      <span className="plp-mes-nome tnum" aria-live="polite">
        {maiusculo(nomeDoMes(mes.slice(0, 7)))}
      </span>
      <button
        type="button"
        className="o-btn o-btn-fantasma o-btn-icone"
        onClick={() => aoMudarMes(1)}
        title="Ver o próximo mês"
        aria-label="Ver o próximo mês"
      >
        <IconeDireita />
      </button>
    </div>
  );
}

/**
 * O painel, com estado. Os dados vêm da página (a MESMA leitura do mês das
 * visões): trocar de mês aqui troca o da página, e o painel acompanha.
 *
 * `linha` `null` com o mês já lido é "este cliente não está na carteira deste
 * mês" — o painel diz isso com calma, em vez de sumir na cara de quem colou o
 * link ou trocou de mês.
 */
export function PainelDoCliente({
  id,
  linha,
  mes,
  hoje,
  carregando,
  erro,
  souAdmin,
  aoFechar,
  aoMudar,
  aoMudarMes,
}: {
  id: string;
  linha: LinhaDoMes | null;
  mes: string;
  hoje: string;
  carregando: boolean;
  erro: string | null;
  souAdmin: boolean | null;
  aoFechar: () => void;
  /** Relê o mês da página; a promessa termina quando ele chega. */
  aoMudar: () => Promise<unknown> | void;
  aoMudarMes: (passo: -1 | 1) => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [virada, setVirada] = useState<ChaveVirada | null>(null);
  const [recusa, setRecusa] = useState<string | null>(null);
  /** O nome de quando o cliente estava à vista — o título não pisca ao trocar de mês. */
  const [nome, setNome] = useState<string | null>(linha?.name ?? null);

  // O mês relido chegou: a verdade agora é a do servidor, e a chave virada sai.
  useEffect(() => {
    setVirada(null);
    if (linha !== null) setNome(linha.name);
  }, [linha]);

  /* A recusa é deste cliente neste mês; noutro mês ela não diz nada. E a
     resposta de um pedido feito noutro mês também não entra (`gravarNoPainel`):
     a vez é do cliente e do mês que estão no painel. */
  const vez = useVez();
  const alvo = `${id}|${mes.slice(0, 7)}`;
  useEffect(() => {
    vez.abrir(alvo);
    setRecusa(null);
  }, [vez, alvo]);

  async function executar(gravar: () => Promise<unknown>, otimista: ChaveVirada | null) {
    if (ocupado) return;
    const doPedido = alvo;
    setOcupado(true);
    setRecusa(null);
    setVirada(otimista);
    try {
      // A chave fica virada até o mês relido chegar (o efeito acima a solta),
      // e o painel fica ocupado até lá: o próximo gesto sai com o mês fresco.
      await gravarNoPainel({
        gravar,
        aindaAqui: () => vez.sobre(doPedido),
        reler: aoMudar,
        recusou: (e) => {
          if (semSessao(e)) {
            window.location.replace('/');
            return;
          }
          // A CHAVE VOLTA e a frase do servidor fica.
          setVirada(null);
          setRecusa(e instanceof ApiError ? e.message : 'Não foi possível concluir.');
        },
      });
    } finally {
      setOcupado(false);
    }
  }

  const dia = `${mes.slice(0, 7)}-01`;
  const titulo = linha?.name ?? nome ?? 'Cliente';

  let corpo: ReactNode;
  if (linha !== null) {
    corpo = (
      <ConteudoDoPainel
        linha={linha}
        mes={mes}
        hoje={hoje}
        souAdmin={souAdmin}
        ocupado={ocupado}
        virada={virada}
        recusa={recusa}
        aoAbrirMes={() => void executar(() => api.abrirMes(id, dia), null)}
        aoMarcar={(passo, valor) => void executar(() => api.marcarRitual(id, dia, passo, valor), { passo, valor })}
        aoMudar={aoMudar}
      />
    );
  } else if (carregando) {
    corpo = (
      <p className="plp-calmo" aria-busy="true">
        Carregando {mesPorExtenso(mes.slice(0, 7), hoje)}…
      </p>
    );
  } else if (erro !== null) {
    corpo = <Aviso tipo="erro">{fraseDaFalha(mes.slice(0, 7), erro)}</Aviso>;
  } else {
    corpo = (
      <p className="plp-calmo" data-estado="fora-do-mes">
        Este cliente não está na carteira de {nomeDoMes(mes.slice(0, 7))}.
      </p>
    );
  }

  return (
    <PainelLateral
      titulo={titulo}
      subtitulo={linha ? subtituloDoCliente(linha) : undefined}
      contexto={<MesDoPainel mes={mes} aoMudarMes={aoMudarMes} />}
      rodape={
        // A ficha no MÊS que está no painel — abrir outubro e cair em
        // novembro seria trocar de contrato sem avisar.
        <Link to={enderecoDaFicha(id, mes, hoje)} className="plp-link">
          Abrir ficha do cliente
        </Link>
      }
      aoFechar={aoFechar}
    >
      {corpo}
    </PainelLateral>
  );
}
