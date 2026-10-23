import type { ChatLiveStatus } from '@/chat/chat-live-context';
import { esperaDeReconexao } from '@/chat/reconexao';
import type { DepoisDeFechar } from '@/chat/sessao-do-canal';
import {
  CHAT_LIVE_FECHADA_POR_LIMITE_DE_ABAS,
  CHAT_LIVE_PING,
  CHAT_LIVE_PONG,
} from '@/server/chat-live';

export const INTERVALO_PING_MS = 25_000;
export const PRAZO_PONG_MS = 10_000;
export const PRAZO_ABERTURA_MS = 15_000;
export const INTERVALO_CONTADOR_MS = 30_000;
export const INTERVALO_MINIMO_CONSULTA_MS = 1_000;
export const PRAZO_LEITURA_MS = 15_000;

/** Aborta a rede ao vencer/desmontar e descarta até respostas que ignorem o sinal. */
export function lerComPrazo<T>(ler: (signal: AbortSignal) => Promise<T>, sessao: AbortSignal): Promise<T> {
  const pedido = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const cancelar = () => pedido.abort();
    const timer = setTimeout(cancelar, PRAZO_LEITURA_MS);
    const limpar = () => { clearTimeout(timer); sessao.removeEventListener('abort', cancelar); };
    pedido.signal.addEventListener('abort', () => {
      limpar();
      reject(new Error('Leitura do chat cancelada.'));
    }, { once: true });
    sessao.addEventListener('abort', cancelar, { once: true });
    if (sessao.aborted) { cancelar(); return; }
    void Promise.resolve().then(() => ler(pedido.signal)).then((valor) => {
      if (!pedido.signal.aborted) resolve(valor);
    }, reject).finally(limpar);
  });
}

/**
 * Uma consulta por vez; rajadas durante a consulta viram UMA releitura, que
 * começa assim que a atual termina. Sem piso de relógio: um evento real
 * (ex.: `conversation_read`) precisa de uma leitura que comece depois dele, e
 * esperar um intervalo fixo deixava o selo velho na tela (C5 do e2e). A taxa
 * fica limitada pela própria latência — banco lento, menos consultas.
 */
export function criarAtualizadorLimitado<T>(ler: () => Promise<T>, aplicar: (valor: T) => void) {
  let encerrado = false;
  let emVoo = false;
  let pendente = false;

  const atualizar = () => {
    if (encerrado) return;
    if (emVoo) { pendente = true; return; }
    pendente = false;
    emVoo = true;
    void Promise.resolve().then(ler).then((valor) => {
      if (!encerrado) aplicar(valor);
    }).catch(() => {
      // Falha transitória: o próximo evento/foco/ciclo tenta outra vez.
    }).finally(() => {
      emVoo = false;
      if (pendente && !encerrado) atualizar();
    });
  };
  return {
    atualizar,
    encerrar() { encerrado = true; },
  };
}

type Canal = Pick<WebSocket, 'readyState' | 'send' | 'close' | 'onopen' | 'onclose' | 'onmessage' | 'onerror'>;

/** Ciclo de uma sessão/aba. Os relógios e canais reais também passam por aqui nos testes. */
export function iniciarRecuperacaoDoChat(op: {
  abrir: () => Canal;
  visivel: () => boolean;
  status: (status: ChatLiveStatus) => void;
  mensagem: (dado: string) => void;
  alcance: () => void;
  contador: () => void;
  conferirSessao: () => Promise<DepoisDeFechar>;
}) {
  let encerrado = false;
  let parado = false;
  /** A central trocou esta aba por outra da mesma pessoa; só o foco a reabre. */
  let cedida = false;
  let conferindo = false;
  let tentativa = 0;
  let canal: Canal | null = null;
  let abriu = false;
  let ultimoAlcance = -Infinity;
  let reconexao: ReturnType<typeof setTimeout> | undefined;
  let prazo: ReturnType<typeof setTimeout> | undefined;
  let aguardandoPong = false;

  const alcance = () => {
    if (!op.visivel() || Date.now() - ultimoAlcance < INTERVALO_MINIMO_CONSULTA_MS) return;
    ultimoAlcance = Date.now();
    op.alcance();
  };
  const limparPrazo = () => { clearTimeout(prazo); prazo = undefined; aguardandoPong = false; };
  const agendar = () => {
    if (encerrado || parado || reconexao !== undefined) return;
    op.status('reconectando');
    reconexao = setTimeout(() => { reconexao = undefined; conectar(); }, esperaDeReconexao(tentativa++));
  };
  const falhou = (atual: Canal) => {
    if (encerrado || canal !== atual) return;
    canal = null;
    limparPrazo();
    // Não dependemos de onclose: uma rede silenciosa pode nunca entregá-lo.
    atual.onopen = atual.onmessage = atual.onclose = atual.onerror = null;
    try { atual.close(4000, 'conexao-sem-resposta'); } catch { /* já fechada */ }
    if (abriu) { agendar(); return; }
    conferindo = true;
    op.status('reconectando');
    void op.conferirSessao().then((decisao) => {
      if (encerrado) return;
      if (decisao === 'parar') { parado = true; op.status('desligado'); }
      else agendar();
    }).catch(agendar).finally(() => { conferindo = false; });
  };
  /**
   * A central expulsou esta aba para caber a quinta. Reconectar sozinha só
   * expulsaria outra, que reconectaria... (ver `CHAT_LIVE_FECHADA_POR_LIMITE_DE_ABAS`).
   * Fica quieta; o contador de não lidas segue sendo reconciliado, e a conexão
   * volta quando a pessoa volta para a aba (`aoVisibilidade`).
   */
  const cedeu = (atual: Canal) => {
    if (encerrado || canal !== atual) return;
    canal = null;
    limparPrazo();
    atual.onopen = atual.onmessage = atual.onclose = atual.onerror = null;
    cedida = true;
    op.status('desligado');
  };
  const vigiarAbertura = (atual: Canal) => {
    if (prazo !== undefined || !op.visivel()) return;
    prazo = setTimeout(() => { prazo = undefined; if (op.visivel()) falhou(atual); }, PRAZO_ABERTURA_MS);
  };
  const ping = () => {
    const atual = canal;
    if (!atual || !op.visivel() || aguardandoPong) return;
    if (atual.readyState === 0) { vigiarAbertura(atual); return; }
    if (atual.readyState !== 1) { falhou(atual); return; }
    aguardandoPong = true;
    prazo = setTimeout(() => { if (op.visivel()) falhou(atual); else limparPrazo(); }, PRAZO_PONG_MS);
    try { atual.send(CHAT_LIVE_PING); } catch { falhou(atual); }
  };
  const conectar = () => {
    if (encerrado || parado || conferindo || canal) return;
    cedida = false;
    op.status(tentativa === 0 ? 'conectando' : 'reconectando');
    let atual: Canal;
    try { atual = op.abrir(); } catch { agendar(); return; }
    canal = atual;
    abriu = false;
    vigiarAbertura(atual);
    atual.onopen = () => {
      if (encerrado || canal !== atual) return;
      abriu = true;
      tentativa = 0;
      limparPrazo();
      op.status('conectado');
      alcance();
      ping();
    };
    atual.onmessage = (evento) => {
      if (encerrado || canal !== atual || typeof evento.data !== 'string') return;
      if (evento.data === CHAT_LIVE_PONG) { limparPrazo(); return; }
      if (evento.data !== CHAT_LIVE_PING) op.mensagem(evento.data);
    };
    atual.onclose = (evento) => {
      if (evento?.code === CHAT_LIVE_FECHADA_POR_LIMITE_DE_ABAS) cedeu(atual);
      else falhou(atual);
    };
    atual.onerror = () => { /* onclose ou prazo recupera */ };
  };
  const batimento = setInterval(ping, INTERVALO_PING_MS);
  const reconciliacao = setInterval(() => {
    if (encerrado || parado || !op.visivel()) return;
    op.contador();
    // Sem o canal ao vivo, uma aba cedida que segue à vista (outro monitor) não
    // pode ficar parada no que viu: relê o que mudou no mesmo ritmo do contador.
    if (cedida) alcance();
  }, INTERVALO_CONTADOR_MS);
  conectar();
  return {
    aoVisibilidade() {
      if (encerrado || parado) return;
      if (!op.visivel()) { limparPrazo(); return; }
      alcance();
      if (!canal && reconexao === undefined) conectar();
      else ping();
    },
    encerrar() {
      encerrado = true;
      clearInterval(batimento);
      clearInterval(reconciliacao);
      clearTimeout(reconexao);
      limparPrazo();
      const atual = canal;
      canal = null;
      if (atual) {
        atual.onopen = atual.onmessage = atual.onclose = atual.onerror = null;
        try { atual.close(1000, 'sessao-encerrada'); } catch { /* já fechada */ }
      }
    },
  };
}
