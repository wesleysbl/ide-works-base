/**
 * A APROVAÇÃO EXTERNA NA FICHA DO CLIENTE — F42, Fase 3.
 *
 * O QUE A ADMIN FAZ AQUI, UMA VEZ POR CLIENTE
 *   1. liga a chave "Aprovação externa";
 *   2. gera o link (ou copia o que já existe) e manda ao cliente pelo WhatsApp.
 *   "Gerar novo link" derruba o anterior NA HORA — por isso pede confirmação
 *   ali mesmo, com a frase do que acontece.
 *
 * DENTRO DE "DADOS DO CLIENTE", E NÃO NO TOPO
 *   É configuração de uma vez, não operação do dia: o topo da ficha é medido
 *   (as áreas começam antes de 35% da altura no celular — `cliente-ux` CX1) e
 *   um bloco a mais ali empurraria a produção para baixo.
 *
 * SÓ ADMIN
 *   Quem não administra não vê o bloco (`ehAdmin`) — e as rotas respondem 403 de
 *   qualquer jeito. A leitura só sai quando "Dados do cliente" abre pela
 *   primeira vez: ficha aberta todo dia não paga uma ida a mais ao servidor.
 *
 * TESTES
 *   `PainelDaAprovacao` é a tela pura (desenha no servidor, sem efeito); o
 *   estado depois do clique se prova no e2e `aprovacao-configuracao`.
 */

import { useCallback, useEffect, useState } from 'react';

import { ApiError, api, semSessao } from '@/lib/api';
import { Chave } from '@/ui/primitivos';
import { ehAdmin, useSessao } from '@/ui/sessao';
import type { AprovacaoDoCliente } from '@/server/aprovacao-config';

import '@/ui/aprovacao.css';

const FRASE_CONFIRMAR_NOVO =
  'O link antigo para de funcionar agora. Quem abrir o antigo verá "link inválido". Gerar mesmo assim?';

const dataEHora = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));

export type EstadoDoPainel =
  | { tipo: 'carregando' }
  | { tipo: 'erro'; mensagem: string }
  | { tipo: 'pronto'; aprovacao: AprovacaoDoCliente };

/** A tela, sem efeito nenhum: tudo o que muda chega por `props`. */
export function PainelDaAprovacao({
  estado,
  ocupado = false,
  confirmando = false,
  endereco = null,
  aviso = null,
  falha = null,
  aoLigar,
  aoCopiar,
  aoPedirNovo,
  aoConfirmarNovo,
  aoCancelarNovo,
  aoTentarDeNovo,
}: {
  estado: EstadoDoPainel;
  ocupado?: boolean;
  /** A pergunta "o link antigo para de funcionar agora" está aberta. */
  confirmando?: boolean;
  /** O endereço já em mãos (depois de copiar ou gerar). */
  endereco?: string | null;
  /** O que acabou de dar certo ("Link copiado."). */
  aviso?: string | null;
  /** A recusa do último gesto, com a frase do servidor. */
  falha?: string | null;
  aoLigar: (v: boolean) => void;
  aoCopiar: () => void;
  aoPedirNovo: () => void;
  aoConfirmarNovo: () => void;
  aoCancelarNovo: () => void;
  aoTentarDeNovo: () => void;
}) {
  return (
    <div className="o-card ap-cliente" data-aprovacao-cliente>
      <h2 className="eyebrow px-3 pt-3">Aprovação externa</h2>
      <p className="ap-apoio">
        O cliente abre um link fixo, sem conta, vê o material de cada card e aprova ou pede ajustes. O card anda
        sozinho na esteira.
      </p>

      {estado.tipo === 'carregando' && <p className="ap-apoio">Lendo a aprovação deste cliente…</p>}

      {estado.tipo === 'erro' && (
        <p className="ap-falha" role="alert">
          {estado.mensagem}{' '}
          <button type="button" className="o-btn o-btn-vidro o-btn-sm" onClick={aoTentarDeNovo}>
            Tentar de novo
          </button>
        </p>
      )}

      {estado.tipo === 'pronto' && (
        <div className="ap-corpo">
          <div className="ap-linha">
            <Chave
              rotulo="Aprovação externa"
              ligada={estado.aprovacao.enabled}
              desativada={ocupado}
              aoMudar={aoLigar}
            />
            <span className="ap-estado" data-ligada={estado.aprovacao.enabled || undefined}>
              {estado.aprovacao.enabled ? 'ligada' : 'desligada'}
            </span>
          </div>

          {!estado.aprovacao.active && estado.aprovacao.enabled && (
            <p className="ap-alerta">Cliente inativo: o link não abre enquanto ele estiver inativo.</p>
          )}

          {!estado.aprovacao.enabled && estado.aprovacao.link && (
            <p className="ap-apoio">Desligada, o link não abre. Ligar de novo devolve o mesmo link.</p>
          )}

          {estado.aprovacao.enabled && (
            <div className="ap-link">
              <p className="ap-apoio" data-link-desde>
                {estado.aprovacao.link
                  ? `Link criado em ${dataEHora(estado.aprovacao.link.createdAt)}.`
                  : 'Ainda não há link para este cliente.'}
              </p>

              {!confirmando && (
                <div className="ap-botoes">
                  {estado.aprovacao.link && (
                    <button type="button" className="o-btn o-btn-primario o-btn-sm" disabled={ocupado} onClick={aoCopiar}>
                      Copiar link
                    </button>
                  )}
                  <button
                    type="button"
                    className="o-btn o-btn-vidro o-btn-sm"
                    disabled={ocupado}
                    onClick={estado.aprovacao.link ? aoPedirNovo : aoConfirmarNovo}
                  >
                    {estado.aprovacao.link ? 'Gerar novo link' : 'Gerar link'}
                  </button>
                </div>
              )}

              {confirmando && (
                <div className="ap-confirmar" role="group" aria-label="Confirmar novo link">
                  <p>{FRASE_CONFIRMAR_NOVO}</p>
                  <div className="ap-botoes">
                    <button type="button" className="o-btn o-btn-primario o-btn-sm" disabled={ocupado} onClick={aoConfirmarNovo}>
                      Sim, gerar novo link
                    </button>
                    <button type="button" className="o-btn o-btn-vidro o-btn-sm" disabled={ocupado} onClick={aoCancelarNovo}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {endereco && (
                <input
                  className="ap-endereco"
                  readOnly
                  value={endereco}
                  aria-label="Link de aprovação do cliente"
                  onFocus={(e) => e.currentTarget.select()}
                />
              )}
            </div>
          )}

          {aviso && (
            <p className="ap-ok" role="status">
              {aviso}
            </p>
          )}
          {falha && (
            <p className="ap-falha" role="alert">
              {falha}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const fraseDe = (e: unknown, padrao: string) => (e instanceof ApiError && e.message ? e.message : padrao);

/** Copia; se o navegador recusar, o endereço fica à vista para copiar à mão. */
async function paraAreaDeTransferencia(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

/** O bloco com estado. `aberto`: "Dados do cliente" está à vista. */
export function AprovacaoExterna({ clientId, aberto }: { clientId: string; aberto: boolean }) {
  const { sessao } = useSessao();
  const souAdmin = ehAdmin(sessao);
  const [estado, setEstado] = useState<EstadoDoPainel>({ tipo: 'carregando' });
  const [lido, setLido] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [endereco, setEndereco] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [falha, setFalha] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setEstado({ tipo: 'carregando' });
    try {
      const r = await api.aprovacaoDoCliente(clientId);
      if (!r.approval) throw new Error('resposta sem aprovação');
      setEstado({ tipo: 'pronto', aprovacao: r.approval });
    } catch (e) {
      if (semSessao(e)) {
        window.location.replace('/');
        return;
      }
      setEstado({ tipo: 'erro', mensagem: fraseDe(e, 'Não foi possível ler a aprovação deste cliente.') });
    }
  }, [clientId]);

  // Outro cliente: nada do anterior fica na tela.
  useEffect(() => {
    setLido(null);
    setConfirmando(false);
    setEndereco(null);
    setAviso(null);
    setFalha(null);
  }, [clientId]);

  useEffect(() => {
    if (!aberto || !souAdmin || lido === clientId) return;
    setLido(clientId);
    void carregar();
  }, [aberto, souAdmin, lido, clientId, carregar]);

  if (!souAdmin) return null;

  const gesto = async (fn: () => Promise<void>, padrao: string) => {
    setOcupado(true);
    setFalha(null);
    setAviso(null);
    try {
      await fn();
    } catch (e) {
      if (semSessao(e)) {
        window.location.replace('/');
        return;
      }
      setFalha(fraseDe(e, padrao));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <PainelDaAprovacao
      estado={estado}
      ocupado={ocupado}
      confirmando={confirmando}
      endereco={endereco}
      aviso={aviso}
      falha={falha}
      aoTentarDeNovo={() => void carregar()}
      aoLigar={(v) =>
        void gesto(async () => {
          const r = await api.ligarAprovacaoDoCliente(clientId, v);
          setEstado({ tipo: 'pronto', aprovacao: r.approval });
          if (!v) setEndereco(null);
        }, 'Não foi possível mudar a aprovação.')
      }
      aoCopiar={() =>
        void gesto(async () => {
          const r = await api.copiarLinkDeAprovacao(clientId);
          setEndereco(r.url);
          setAviso((await paraAreaDeTransferencia(r.url)) ? 'Link copiado.' : 'Copie o link abaixo.');
        }, 'Não foi possível copiar o link.')
      }
      aoPedirNovo={() => {
        setAviso(null);
        setFalha(null);
        setConfirmando(true);
      }}
      aoCancelarNovo={() => setConfirmando(false)}
      aoConfirmarNovo={() =>
        void gesto(async () => {
          const r = await api.gerarLinkDeAprovacao(clientId);
          setConfirmando(false);
          setEndereco(r.url);
          setEstado((atual) =>
            atual.tipo === 'pronto'
              ? { tipo: 'pronto', aprovacao: { ...atual.aprovacao, link: { createdAt: r.createdAt } } }
              : atual,
          );
          setAviso(
            (await paraAreaDeTransferencia(r.url))
              ? 'Link novo gerado e copiado.'
              : 'Link novo gerado. Copie o link abaixo.',
          );
        }, 'Não foi possível gerar o link.')
      }
    />
  );
}
