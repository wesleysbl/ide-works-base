/**
 * A VEZ — respostas fora de ordem. Etapa F17.AUD01.
 *
 * O QUE ESTES TESTES PROTEGEM
 *   Cada caso aqui é uma reprodução da auditoria de 09/09/2026, escrita ao
 *   contrário: o script `docs/auditoria-2026-09-09/reproduzir-fluxos.mjs`
 *   afirmava o DEFEITO no Chrome; aqui a mesma sequência de eventos afirma o
 *   comportamento certo, sem navegador. As esperas são timers falsos, e a ordem
 *   das respostas é a que a auditoria usou: a mãe atrasada 1,4 s, a busca
 *   antiga chegando depois da nova.
 *
 * A TELA DE MENTIRA
 *   `tela()` é o mínimo que uma página faz com uma leitura: guarda o que
 *   chegou, guarda o erro, e liga e desliga `carregando`. É por ela que se
 *   confere o que a ficha, o histórico e o quadro fariam — os três usam
 *   `abrir`/`reabrir` + `entregar` do mesmo jeito.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Bilhete, criarVez, entregar } from '@/ui/vez';

/** Uma resposta que demora `ms`. */
const demora = <T>(ms: number, valor: T): Promise<T> =>
  new Promise((resolver) => setTimeout(() => resolver(valor), ms));

/** Uma recusa que demora `ms`. */
const recusa = (ms: number, erro: unknown): Promise<never> =>
  new Promise((_, recusar) => setTimeout(() => recusar(erro), ms));

/** O que uma página faz com uma leitura, e nada mais. */
function tela() {
  const vez = criarVez();
  const estado = { naTela: null as string | null, erro: null as string | null, carregando: false };
  /** Tudo o que entrou, na ordem — para provar que a resposta velha não passou. */
  const entradas: string[] = [];

  const ler = (recurso: string, promessa: Promise<{ id: string }>, releitura = false) => {
    const bilhete = releitura ? vez.reabrir(recurso) : vez.abrir(recurso);
    if (bilhete === null) return Promise.resolve(false);
    estado.carregando = true;
    estado.erro = null;
    return entregar(vez, bilhete, promessa, {
      chegou: (r) => {
        estado.naTela = r.id;
        entradas.push(r.id);
      },
      falhou: (e) => {
        estado.naTela = null;
        estado.erro = String(e);
      },
      terminou: () => {
        estado.carregando = false;
      },
    });
  };

  return { vez, estado, entradas, ler };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/* ───────────────────────── a ficha — achado 1 ───────────────────────── */

describe('a ficha: a resposta atrasada da mãe não substitui a filha — achado 1', () => {
  it('filha → mãe lenta → Voltar: a filha fica, e a mãe que chega depois é jogada fora', async () => {
    const t = tela();

    // Abre a filha; ela chega em 100 ms.
    const filha1 = t.ler('child', demora(100, { id: 'child' }));
    await vi.advanceTimersByTimeAsync(100);
    expect(t.estado.naTela).toBe('child');

    // Abre a mãe, que a auditoria atrasou em 1,4 s.
    const mae = t.ler('parent', demora(1400, { id: 'parent' }));
    expect(t.estado.carregando).toBe(true);

    // Voltar, antes de a mãe chegar: a filha é aberta de novo e chega rápido.
    await vi.advanceTimersByTimeAsync(200);
    const filha2 = t.ler('child', demora(100, { id: 'child' }));
    await vi.advanceTimersByTimeAsync(100);
    expect(t.estado.naTela).toBe('child');
    expect(t.estado.carregando).toBe(false);

    // A mãe chega, atrasada. Antes desta etapa, ela pintava a ficha aqui.
    await vi.advanceTimersByTimeAsync(1400);
    expect(await Promise.all([filha1, mae, filha2])).toEqual([true, false, true]);
    expect(t.estado.naTela).toBe('child');
    expect(t.entradas).toEqual(['child', 'child']);

    // E o destino de qualquer gravação continua sendo a filha.
    expect(t.vez.sobre('child')).toBe(true);
    expect(t.vez.sobre('parent')).toBe(false);
  });

  it('a mãe que chega ANTES de a filha voltar entra, e a filha a substitui em seguida', async () => {
    const t = tela();
    t.ler('child', demora(10, { id: 'child' }));
    await vi.advanceTimersByTimeAsync(10);

    void t.ler('parent', demora(50, { id: 'parent' }));
    await vi.advanceTimersByTimeAsync(50);
    expect(t.estado.naTela).toBe('parent');

    void t.ler('child', demora(50, { id: 'child' }));
    await vi.advanceTimersByTimeAsync(50);
    expect(t.estado.naTela).toBe('child');
    expect(t.entradas).toEqual(['child', 'parent', 'child']);
  });

  it('uma resposta antiga da MESMA tarefa também não entra: vale a geração, não só o id', async () => {
    const t = tela();
    // Duas leituras da mesma tarefa — a primeira lenta, a segunda rápida.
    const lenta = t.ler('x', demora(300, { id: 'x' }));
    const rapida = t.ler('x', demora(50, { id: 'x' }));
    await vi.advanceTimersByTimeAsync(300);
    expect(await lenta).toBe(false);
    expect(await rapida).toBe(true);
    expect(t.entradas).toEqual(['x']);
  });
});

/* ──────────────────────── a gravação — tarefa 5 ─────────────────────── */

describe('a gravação: a resposta serve à ficha que continua na tela', () => {
  /** Uma gravação como a ficha faz: guarda o alvo no começo, pergunta no fim. */
  const gravar = async (t: ReturnType<typeof tela>, promessa: Promise<{ id: string }>) => {
    const alvo = t.vez.recurso();
    if (alvo === null || !t.vez.sobre(alvo)) return 'nem enviou';
    const ficha = await promessa;
    if (!t.vez.sobre(alvo)) return 'jogada fora';
    t.estado.naTela = ficha.id;
    return 'entrou';
  };

  it('começada na filha e respondida com a mãe na tela, a resposta é jogada fora', async () => {
    const t = tela();
    void t.ler('child', demora(10, { id: 'child' }));
    await vi.advanceTimersByTimeAsync(10);

    const gravacao = gravar(t, demora(500, { id: 'child' }));
    // No meio da gravação, a pessoa abre a mãe — e a mãe chega.
    void t.ler('parent', demora(100, { id: 'parent' }));
    await vi.advanceTimersByTimeAsync(100);
    expect(t.estado.naTela).toBe('parent');

    await vi.advanceTimersByTimeAsync(400);
    expect(await gravacao).toBe('jogada fora');
    // A mãe ficou intacta: a gravação não a substituiu pela ficha da filha.
    expect(t.estado.naTela).toBe('parent');
  });

  it('começada na filha, com ida à mãe e VOLTA, a resposta entra — a tela está na filha', async () => {
    const t = tela();
    void t.ler('child', demora(10, { id: 'child' }));
    await vi.advanceTimersByTimeAsync(10);

    const gravacao = gravar(t, demora(500, { id: 'child' }));
    void t.ler('parent', demora(1400, { id: 'parent' }));
    await vi.advanceTimersByTimeAsync(100);
    void t.ler('child', demora(100, { id: 'child' }));
    await vi.advanceTimersByTimeAsync(400);

    expect(await gravacao).toBe('entrou');
    expect(t.estado.naTela).toBe('child');
    expect(t.vez.sobre('child')).toBe(true);
  });

  it('a tela desmontada não recebe a resposta da gravação', async () => {
    const t = tela();
    void t.ler('child', demora(10, { id: 'child' }));
    await vi.advanceTimersByTimeAsync(10);
    const gravacao = gravar(t, demora(100, { id: 'child' }));
    t.vez.encerrar();
    await vi.advanceTimersByTimeAsync(100);
    expect(await gravacao).toBe('jogada fora');
  });
});

/* ────────────────────────── a busca — achado 6 ──────────────────────── */

describe('a busca: a resposta antiga não substitui a nova — achado 6', () => {
  it('"antiga" lenta e "nova" rápida: fica "nova", qualquer que seja a ordem de chegada', async () => {
    const t = tela();
    const antiga = t.ler('busca=antiga', demora(800, { id: 'lista de antiga' }));
    await vi.advanceTimersByTimeAsync(100);
    const nova = t.ler('busca=nova', demora(50, { id: 'lista de nova' }));
    await vi.advanceTimersByTimeAsync(50);
    expect(t.estado.naTela).toBe('lista de nova');

    await vi.advanceTimersByTimeAsync(800);
    expect(await antiga).toBe(false);
    expect(await nova).toBe(true);
    expect(t.estado.naTela).toBe('lista de nova');
    expect(t.entradas).toEqual(['lista de nova']);
  });

  it('o ERRO atrasado da busca antiga não apaga o resultado da nova', async () => {
    const t = tela();
    const antiga = t.ler('busca=antiga', recusa(800, new Error('caiu')));
    await vi.advanceTimersByTimeAsync(100);
    void t.ler('busca=nova', demora(50, { id: 'lista de nova' }));
    await vi.advanceTimersByTimeAsync(800);

    expect(await antiga).toBe(false);
    expect(t.estado.naTela).toBe('lista de nova');
    expect(t.estado.erro).toBeNull();
  });

  it('o erro da busca ATUAL, esse entra', async () => {
    const t = tela();
    void t.ler('busca=x', recusa(50, new Error('caiu')));
    await vi.advanceTimersByTimeAsync(50);
    expect(t.estado.erro).toContain('caiu');
    expect(t.estado.naTela).toBeNull();
    expect(t.estado.carregando).toBe(false);
  });
});

/* ─────────────────────── o carregamento — tarefa 3 ──────────────────── */

describe('o carregamento: a operação antiga não oculta o da nova', () => {
  it('a antiga que termina ANTES da nova não desliga o "carregando"', async () => {
    const t = tela();
    void t.ler('a', demora(100, { id: 'a' }));
    await vi.advanceTimersByTimeAsync(10);
    void t.ler('b', demora(500, { id: 'b' }));
    expect(t.estado.carregando).toBe(true);

    // A antiga chega. Antes desta etapa, o `finally` dela apagava o carregando
    // da nova — e a tela ficava sem "Abrindo…" com nada na tela.
    await vi.advanceTimersByTimeAsync(100);
    expect(t.estado.carregando).toBe(true);
    expect(t.estado.naTela).toBeNull();

    await vi.advanceTimersByTimeAsync(400);
    expect(t.estado.carregando).toBe(false);
    expect(t.estado.naTela).toBe('b');
  });

  it('a releitura que se sobrepõe à leitura da rota é quem desliga o "carregando"', async () => {
    // Uma releitura silenciosa (`Mostrar mais`) pode superar a leitura de
    // abertura. A leitura superada não termina; quem termina é a releitura —
    // senão o carregando ficaria preso ligado.
    const t = tela();
    void t.ler('b', demora(500, { id: 'b' }));
    await vi.advanceTimersByTimeAsync(10);
    void t.ler('b', demora(100, { id: 'b' }), true);
    await vi.advanceTimersByTimeAsync(100);
    expect(t.estado.carregando).toBe(false);
    expect(t.estado.naTela).toBe('b');
    await vi.advanceTimersByTimeAsync(500);
    expect(t.entradas).toEqual(['b']);
  });
});

/* ────────────────────────── a desmontagem ───────────────────────────── */

describe('a desmontagem: depois de encerrar, nada entra', () => {
  it('dado, erro e término são todos descartados', async () => {
    const t = tela();
    const dado = t.ler('a', demora(100, { id: 'a' }));
    t.vez.encerrar();
    await vi.advanceTimersByTimeAsync(100);
    expect(await dado).toBe(false);
    expect(t.estado.naTela).toBeNull();
    // `carregando` ficou como estava: a tela não existe mais para desligá-lo.
    expect(t.estado.carregando).toBe(true);

    const t2 = tela();
    const erro = t2.ler('a', recusa(100, new Error('caiu')));
    t2.vez.encerrar();
    await vi.advanceTimersByTimeAsync(100);
    expect(await erro).toBe(false);
    expect(t2.estado.erro).toBeNull();
    expect(t2.vez.recurso()).toBeNull();
    expect(t2.vez.sobre('a')).toBe(false);
  });

  it('abrir depois de encerrar volta a valer — o vaivém do StrictMode', async () => {
    const t = tela();
    const antes = t.vez.abrir('a');
    t.vez.encerrar();
    void t.ler('a', demora(10, { id: 'a' }));
    await vi.advanceTimersByTimeAsync(10);
    expect(t.estado.naTela).toBe('a');
    // O bilhete de antes do encerramento continua velho.
    expect(t.vez.vale(antes)).toBe(false);
  });
});

/* ───────────────────────────── a releitura ──────────────────────────── */

describe('reabrir: só o que está na tela se relê', () => {
  it('relê o recurso da vez, e a leitura anterior dele deixa de valer', () => {
    const vez = criarVez();
    const primeiro = vez.abrir('x');
    const segundo = vez.reabrir('x');
    expect(segundo).not.toBeNull();
    expect(vez.vale(primeiro)).toBe(false);
    expect(vez.vale(segundo as Bilhete)).toBe(true);
    expect((segundo as Bilhete).geracao).toBeGreaterThan(primeiro.geracao);
  });

  it('recusa reler o que já saiu da tela — a releitura atrasada de X com M no endereço', async () => {
    const t = tela();
    void t.ler('x', demora(10, { id: 'x' }));
    await vi.advanceTimersByTimeAsync(10);
    void t.ler('m', demora(100, { id: 'm' }));

    // O `mover` de X termina agora e quer reler X. Não há o que reler.
    expect(t.vez.reabrir('x')).toBeNull();
    expect(await t.ler('x', demora(10, { id: 'x' }), true)).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    expect(t.estado.naTela).toBe('m');
    expect(t.entradas).toEqual(['x', 'm']);
  });

  it('antes da primeira abertura não há o que reler', () => {
    expect(criarVez().reabrir('x')).toBeNull();
  });
});

/* ────────────────────────────── entregar ────────────────────────────── */

describe('entregar', () => {
  it('na ordem normal, entrega dado e término', async () => {
    const vez = criarVez();
    const b = vez.abrir('a');
    const chegou = vi.fn();
    const terminou = vi.fn();
    const p = entregar(vez, b, demora(10, 7), { chegou, falhou: vi.fn(), terminou });
    await vi.advanceTimersByTimeAsync(10);
    expect(await p).toBe(true);
    expect(chegou).toHaveBeenCalledWith(7);
    expect(terminou).toHaveBeenCalledTimes(1);
  });

  it('o que estoura ao aplicar vai para `falhou`, e `terminou` roda mesmo assim', async () => {
    const vez = criarVez();
    const b = vez.abrir('a');
    const falhou = vi.fn();
    const terminou = vi.fn();
    const p = entregar(vez, b, demora(10, 7), {
      chegou: () => {
        throw new Error('ao aplicar');
      },
      falhou,
      terminou,
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(await p).toBe(true);
    expect(falhou).toHaveBeenCalledWith(expect.objectContaining({ message: 'ao aplicar' }));
    expect(terminou).toHaveBeenCalledTimes(1);
  });

  it('`terminou` é opcional', async () => {
    const vez = criarVez();
    const b = vez.abrir('a');
    const p = entregar(vez, b, demora(10, 7), { chegou: vi.fn(), falhou: vi.fn() });
    await vi.advanceTimersByTimeAsync(10);
    expect(await p).toBe(true);
  });
});
