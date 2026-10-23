import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  criarAtualizadorLimitado, iniciarRecuperacaoDoChat, INTERVALO_CONTADOR_MS,
  INTERVALO_PING_MS, PRAZO_ABERTURA_MS, PRAZO_PONG_MS, lerComPrazo, PRAZO_LEITURA_MS,
} from '@/chat/recuperacao';
import { CHAT_LIVE_FECHADA_POR_LIMITE_DE_ABAS } from '@/server/chat-live';

class CanalFake {
  readyState = 0;
  onopen: WebSocket['onopen'] = null;
  onclose: WebSocket['onclose'] = null;
  onmessage: WebSocket['onmessage'] = null;
  onerror: WebSocket['onerror'] = null;
  send = vi.fn();
  close = vi.fn(() => { this.readyState = 3; });
  abrir() { this.readyState = 1; this.onopen?.call(this as unknown as WebSocket, {} as Event); }
  receber(data: string) { this.onmessage?.call(this as unknown as WebSocket, { data } as MessageEvent); }
  cair() { this.readyState = 3; this.onclose?.call(this as unknown as WebSocket, {} as CloseEvent); }
  /** O servidor fechou com um código (o navegador entrega o `CloseEvent`). */
  fecharPeloServidor(code: number) {
    this.readyState = 3;
    this.onclose?.call(this as unknown as WebSocket, { code } as CloseEvent);
  }
}

function montar() {
  let visivel = true;
  const canais: CanalFake[] = [];
  const op = {
    abrir: vi.fn(() => { const c = new CanalFake(); canais.push(c); return c; }),
    visivel: () => visivel,
    status: vi.fn(), mensagem: vi.fn(), alcance: vi.fn(), contador: vi.fn(),
    conferirSessao: vi.fn(async () => 'tentar-de-novo' as const),
  };
  const controle = iniciarRecuperacaoDoChat(op);
  return { op, canais, controle, visibilidade(v: boolean) { visivel = v; controle.aoVisibilidade(); } };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.useRealTimers(); });

describe('recuperação do canal real usada pelo gerente', () => {
  it('ping/pong mantém canal e reconcilia contador mesmo sem eventos', async () => {
    const { canais, op, controle } = montar();
    canais[0].abrir();
    expect(canais[0].send).toHaveBeenCalledWith('ping');
    canais[0].receber('pong');
    await vi.advanceTimersByTimeAsync(INTERVALO_PING_MS);
    canais[0].receber('pong');
    await vi.advanceTimersByTimeAsync(INTERVALO_CONTADOR_MS - INTERVALO_PING_MS);
    expect(op.contador).toHaveBeenCalledTimes(1);
    expect(op.abrir).toHaveBeenCalledTimes(1);
    expect(op.mensagem).not.toHaveBeenCalled();
    controle.encerrar();
  });

  it('silêncio fecha e reconecta sem esperar onclose; canal velho não entrega dados', async () => {
    const { canais, op, controle } = montar();
    canais[0].abrir();
    const eventoAntigo = canais[0].onmessage;
    await vi.advanceTimersByTimeAsync(PRAZO_PONG_MS + 500);
    expect(canais[0].close).toHaveBeenCalledOnce();
    expect(canais).toHaveLength(2);
    canais[1].abrir();
    canais[1].receber('pong');
    eventoAntigo?.call(canais[0] as unknown as WebSocket, { data: 'velho' } as MessageEvent);
    canais[1].receber('novo');
    expect(op.mensagem.mock.calls).toEqual([['novo']]);
    expect(op.alcance).toHaveBeenCalledTimes(2);
    controle.encerrar();
  });

  it('abertura presa renova sessão e não abre dois canais com foco repetido', async () => {
    const { canais, op, controle } = montar();
    await vi.advanceTimersByTimeAsync(PRAZO_ABERTURA_MS);
    for (let i = 0; i < 20; i++) controle.aoVisibilidade();
    expect(op.conferirSessao).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(500);
    expect(canais).toHaveLength(2);
    expect(op.alcance).toHaveBeenCalledOnce();
    controle.encerrar();
  });

  it('aba suspensa pausa ping/poll e retoma com novo prazo de pong', async () => {
    const { canais, op, controle, visibilidade } = montar();
    canais[0].abrir();
    visibilidade(false);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(canais).toHaveLength(1);
    expect(op.contador).not.toHaveBeenCalled();
    expect(canais[0].send).toHaveBeenCalledTimes(1);
    visibilidade(true);
    expect(canais[0].send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(PRAZO_PONG_MS - 1);
    expect(canais[0].close).not.toHaveBeenCalled();
    canais[0].receber('pong');
    controle.encerrar();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sessão terminal para reconexões e contador, inclusive depois do foco', async () => {
    const { canais, op, controle } = montar();
    op.conferirSessao.mockImplementation(async () => 'parar' as never);
    canais[0].cair();
    await vi.advanceTimersByTimeAsync(0);
    controle.aoVisibilidade();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(op.abrir).toHaveBeenCalledOnce();
    expect(op.contador).not.toHaveBeenCalled();
    expect(op.status).toHaveBeenLastCalledWith('desligado');
    controle.encerrar();
  });

  it('desmontar durante renovação não agenda nova conexão nem conserva timers', async () => {
    const { canais, op, controle } = montar();
    let concluir!: (valor: 'tentar-de-novo') => void;
    op.conferirSessao.mockImplementation(() => new Promise((resolve) => { concluir = resolve; }));
    canais[0].cair();
    controle.encerrar();
    concluir('tentar-de-novo');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(op.abrir).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('limite de abas: a aba expulsa não volta sozinha', () => {
  /*
   * O DEFEITO: a central expulsa a aba MAIS ANTIGA quando a pessoa abre a
   * quinta. A aba expulsa via só um `close` depois de ter aberto — e o gerente
   * reconectava na hora (com a espera já zerada pela abertura anterior,
   * 250–500 ms), o que expulsava a seguinte, que reconectava... Cinco abas
   * abertas viravam uma troca contínua de conexões: um `resolveActor` no banco
   * e uma releitura da lista de conversas a cada meio segundo, para sempre,
   * mesmo com as abas escondidas.
   */
  it('fechada pelo limite, não agenda reconexão — e a lista de abas não vira ciranda', async () => {
    const { canais, op, controle } = montar();
    canais[0].abrir();
    canais[0].fecharPeloServidor(CHAT_LIVE_FECHADA_POR_LIMITE_DE_ABAS);

    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(op.abrir).toHaveBeenCalledOnce();
    expect(op.status).toHaveBeenLastCalledWith('desligado');
    // O selo de não lidas continua sendo reconciliado de tempos em tempos.
    expect(op.contador).toHaveBeenCalled();
    controle.encerrar();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('quando a pessoa volta para essa aba, ela reconecta uma vez', async () => {
    const { canais, op, controle, visibilidade } = montar();
    canais[0].abrir();
    canais[0].fecharPeloServidor(CHAT_LIVE_FECHADA_POR_LIMITE_DE_ABAS);
    await vi.advanceTimersByTimeAsync(60_000);

    visibilidade(false);
    expect(op.abrir).toHaveBeenCalledOnce();
    visibilidade(true);
    controle.aoVisibilidade();
    controle.aoVisibilidade();

    expect(canais).toHaveLength(2);
    canais[1].abrir();
    expect(op.status).toHaveBeenLastCalledWith('conectado');
    controle.encerrar();
  });

  it('a aba expulsa que continua à vista relê o que mudou a cada ciclo do contador', async () => {
    // Sem o canal ao vivo, uma janela visível (outro monitor) não pode ficar
    // parada no que viu: relê de tempos em tempos, como o contador de não lidas.
    const { canais, op, controle, visibilidade } = montar();
    canais[0].abrir();
    canais[0].fecharPeloServidor(CHAT_LIVE_FECHADA_POR_LIMITE_DE_ABAS);
    expect(op.alcance).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INTERVALO_CONTADOR_MS);
    expect(op.alcance).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(INTERVALO_CONTADOR_MS);
    expect(op.alcance).toHaveBeenCalledTimes(3);

    // Escondida, não gasta rede à toa.
    visibilidade(false);
    await vi.advanceTimersByTimeAsync(3 * INTERVALO_CONTADOR_MS);
    expect(op.alcance).toHaveBeenCalledTimes(3);
    controle.encerrar();
  });

  it('queda comum depois de aberta continua reconectando sozinha', async () => {
    const { canais, op, controle } = montar();
    canais[0].abrir();
    canais[0].fecharPeloServidor(1006);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(op.abrir).toHaveBeenCalledTimes(2);
    controle.encerrar();
  });
});

describe('contador sem tempestade nem resposta de sessão antiga', () => {
  it('leitura presa é abortada e libera a próxima consulta; resposta tardia é ignorada', async () => {
    const sessao = new AbortController();
    let sinal!: AbortSignal;
    let concluir!: (valor: number) => void;
    const aplicar = vi.fn();
    const ler = vi.fn().mockImplementationOnce((s: AbortSignal) => {
      sinal = s;
      return new Promise<number>((resolve) => { concluir = resolve; });
    }).mockResolvedValue(4);
    const c = criarAtualizadorLimitado(() => lerComPrazo(ler, sessao.signal), aplicar);
    c.atualizar();
    await vi.advanceTimersByTimeAsync(PRAZO_LEITURA_MS);
    expect(sinal.aborted).toBe(true);
    c.atualizar();
    await vi.advanceTimersByTimeAsync(0);
    concluir(99);
    await vi.advanceTimersByTimeAsync(0);
    expect(aplicar.mock.calls).toEqual([[4]]);
    c.encerrar();
    sessao.abort();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rajada em voo pede uma releitura limitada, sem concorrência', async () => {
    const resolvers: Array<(v: number) => void> = [];
    const ler = vi.fn(() => new Promise<number>((r) => resolvers.push(r)));
    const aplicar = vi.fn();
    const c = criarAtualizadorLimitado(ler, aplicar);
    c.atualizar();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 100; i++) c.atualizar();
    expect(ler).toHaveBeenCalledOnce();
    resolvers[0](2);
    await vi.advanceTimersByTimeAsync(0);
    // As 100 chamadas viram UMA releitura, que começa depois da primeira acabar.
    expect(ler).toHaveBeenCalledTimes(2);
    resolvers[1](5);
    await vi.advanceTimersByTimeAsync(0);
    expect(ler).toHaveBeenCalledTimes(2);
    expect(aplicar.mock.calls).toEqual([[2], [5]]);
    c.encerrar();
  });

  it('evento logo depois de uma leitura concluída relê na hora, sem esperar relógio', async () => {
    // C5 do e2e: conversation_read chega 50 ms depois de outra leitura; o selo
    // não pode ficar com o valor velho até um intervalo fixo vencer.
    const ler = vi.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(0);
    const aplicar = vi.fn();
    const c = criarAtualizadorLimitado(ler, aplicar);
    c.atualizar();
    await vi.advanceTimersByTimeAsync(0);
    expect(aplicar.mock.calls).toEqual([[3]]);
    await vi.advanceTimersByTimeAsync(50);
    c.atualizar();
    await vi.advanceTimersByTimeAsync(0);
    expect(ler).toHaveBeenCalledTimes(2);
    expect(aplicar.mock.calls).toEqual([[3], [0]]);
    c.encerrar();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resposta antiga após troca de sessão é descartada; falha permite próximo ciclo', async () => {
    let concluir!: (v: number) => void;
    const aplicar = vi.fn();
    const antigo = criarAtualizadorLimitado(() => new Promise<number>((r) => { concluir = r; }), aplicar);
    antigo.atualizar();
    await vi.advanceTimersByTimeAsync(0);
    antigo.encerrar();
    const ler = vi.fn().mockRejectedValueOnce(new Error('rede')).mockResolvedValue(7);
    const novo = criarAtualizadorLimitado(ler, aplicar);
    novo.atualizar();
    await vi.advanceTimersByTimeAsync(1000);
    novo.atualizar();
    await vi.advanceTimersByTimeAsync(0);
    concluir(99);
    await vi.advanceTimersByTimeAsync(0);
    expect(aplicar.mock.calls).toEqual([[7]]);
    novo.encerrar();
    expect(vi.getTimerCount()).toBe(0);
  });
});
