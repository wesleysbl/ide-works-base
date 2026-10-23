/**
 * A FONTE HTTP DA COLETA, SEM REDE — F8 / F10a, rodada de fundo.
 *
 * O `fetch` é trocado por um roteiro: cada teste diz o que a Meta responderia a
 * cada pedido, e a fonte (`fonteDaMetaHttp`) roda por inteiro, sem tocar em
 * servidor nenhum.
 *
 * O QUE ESTES TESTES TRAVAM
 *
 *   1. PAGINAÇÃO. `diarioPorAnuncio` já seguia `paging.next`; a lista de
 *      campanhas, a lista de anúncios e o insight por campanha pediam
 *      `limit=200/300/500` e liam UMA página. Conta com mais que isso perdia o
 *      resto SEM ERRO — a mesma falha que a F19g já tinha corrigido na
 *      descoberta. Um dia por campanha × 28 dias estoura 500 linhas com 18
 *      campanhas.
 *
 *   2. ERRO QUE VALE PARA A EXECUÇÃO NÃO SE ENGOLE. Limite (4/17/613) e token
 *      (190) mandam parar a execução inteira — `classificarFalha(...).deveParar`.
 *      Só que a demografia, as quebras do dia, as publicações e o seguidor
 *      tinham `catch {}` que engolia TUDO: a conta seguia pedindo (até uma
 *      centena de chamadas por perfil, cada uma queimando a cota que acabou de
 *      estourar) e fechava como "ok", com buraco nos dados e sem uma linha de
 *      erro.
 *
 *   3. PRAZO POR PEDIDO. Um `fetch` sem prazo, que a Meta deixa pendurado, trava
 *      a execução inteira: o orçamento de tempo só é conferido ENTRE contas.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fonteDaMetaHttp } from '@/server/meta-coleta';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const resposta = (corpo: unknown, status = 200, cabecalhos: Record<string, string> = {}) =>
  new Response(JSON.stringify(corpo), { status, headers: cabecalhos });

const erroDaMeta = (code: number, message = 'erro') =>
  resposta({ error: { code, message } }, 400);

/** Instala um `fetch` de mentira e devolve a lista do que foi pedido. */
function fingir(responder: (url: string, n: number) => Response | Promise<Response>) {
  const pedidos: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    pedidos.push(url);
    return responder(url, pedidos.length);
  });
  return pedidos;
}

const GRAPH = 'https://graph.facebook.com/v21.0';
const JANELA = { de: '2026-09-12', ate: '2026-10-09' };

/** Coleção partida em páginas, com `paging.next` apontando para a seguinte. */
function paginas<T>(base: string, itens: T[], porPagina: number) {
  const lotes: Array<{ data: T[]; paging: { next?: string } }> = [];
  for (let i = 0; i < itens.length; i += porPagina) {
    const resto = i + porPagina < itens.length;
    lotes.push({
      data: itens.slice(i, i + porPagina),
      paging: resto ? { next: `${base}&after=${i + porPagina}` } : {},
    });
  }
  return lotes;
}

describe('paginação da coleta', () => {
  it('as campanhas seguem o cursor — a segunda página não se perde', async () => {
    const todas = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, name: `Campanha ${i}` }));
    const lotes = paginas(`${GRAPH}/act_1/campaigns?x=1`, todas, 2);
    let n = 0;
    const pedidos = fingir(() => resposta(lotes[n++] ?? { data: [] }));

    const r = await fonteDaMetaHttp('tok').campanhasDetalhe('act_1');

    expect(r.map((c) => c.campaignId)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4']);
    expect(pedidos).toHaveLength(3);
  });

  it('os anúncios seguem o cursor — 301º anúncio existe', async () => {
    const todos = Array.from({ length: 7 }, (_, i) => ({ id: `ad${i}`, name: `Anúncio ${i}` }));
    const lotes = paginas(`${GRAPH}/act_1/ads?x=1`, todos, 3);
    let n = 0;
    const pedidos = fingir(() => resposta(lotes[n++] ?? { data: [] }));

    const r = await fonteDaMetaHttp('tok').anuncios('act_1');

    expect(r).toHaveLength(7);
    expect(r.at(-1)?.adId).toBe('ad6');
    expect(pedidos).toHaveLength(3);
  });

  it('o insight por campanha segue o cursor, e o uso lido é o da ÚLTIMA página', async () => {
    const linhas = Array.from({ length: 4 }, (_, i) => ({
      date_start: `2026-10-0${i + 1}`,
      campaign_id: `c${i}`,
      campaign_name: `C${i}`,
      spend: '10',
    }));
    const lotes = paginas(`${GRAPH}/act_1/insights?level=campaign`, linhas, 2);
    let n = 0;
    fingir(() => {
      const uso = n === 0 ? 10 : 95;
      return resposta(lotes[n++] ?? { data: [] }, 200, {
        'x-fb-ads-insights-throttle': JSON.stringify({ app_id_util_pct: uso, acc_id_util_pct: uso }),
      });
    });

    const r = await fonteDaMetaHttp('tok').campanhas('act_1', JANELA);

    expect(r.dias).toHaveLength(4);
    // O limitador precisa enxergar a carga DEPOIS de todas as páginas.
    expect(JSON.parse(r.usoBruto ?? '{}')).toMatchObject({ app_id_util_pct: 95 });
  });

  it('o cursor só é seguido dentro do Graph — o token não viaja para outro endereço', async () => {
    let n = 0;
    const pedidos = fingir(() =>
      n++ === 0
        ? resposta({ data: [{ id: 'c0' }], paging: { next: 'https://evil.example/roubo?x=1' } })
        : resposta({ data: [{ id: 'c1' }] }),
    );

    const r = await fonteDaMetaHttp('tok').campanhasDetalhe('act_1');

    expect(r.map((c) => c.campaignId)).toEqual(['c0']);
    expect(pedidos).toHaveLength(1);
  });

  it('cursor circular não vira laço: o teto de páginas corta', async () => {
    const pedidos = fingir(() =>
      resposta({ data: [{ id: 'c' }], paging: { next: `${GRAPH}/act_1/campaigns?de=novo` } }),
    );

    await fonteDaMetaHttp('tok').campanhasDetalhe('act_1');

    expect(pedidos.length).toBeLessThanOrEqual(20);
  });
});

describe('erro que vale para a execução inteira não é engolido', () => {
  it.each([4, 17, 613, 190])('demografia: código %i sobe, e as outras quebras não são pedidas', async (codigo) => {
    const pedidos = fingir(() => erroDaMeta(codigo, 'estourou'));

    await expect(fonteDaMetaHttp('tok').demografia('ig_1')).rejects.toMatchObject({ code: codigo });

    expect(pedidos).toHaveLength(1);
  });

  it('demografia: recusa comum (perfil pequeno) continua sendo engolida — cinco quebras tentadas', async () => {
    const pedidos = fingir(() => erroDaMeta(100, 'Unsupported get request'));

    await expect(fonteDaMetaHttp('tok').demografia('ig_1')).resolves.toEqual([]);

    expect(pedidos).toHaveLength(5);
  });

  it('quebras do dia: limite sobe na primeira chamada, e não nas outras catorze', async () => {
    const pedidos = fingir(() => erroDaMeta(613, 'limite'));

    await expect(fonteDaMetaHttp('tok').quebrasDiarias('ig_1', JANELA)).rejects.toMatchObject({
      code: 613,
    });

    expect(pedidos).toHaveLength(1);
  });

  it('quebras do dia: recusa comum de um par continua não custando os outros', async () => {
    const pedidos = fingir(() => erroDaMeta(100, 'does not support'));

    await expect(fonteDaMetaHttp('tok').quebrasDiarias('ig_1', JANELA)).resolves.toEqual([]);

    // 7 dias × 2 pares
    expect(pedidos).toHaveLength(14);
  });

  it('publicações: limite no insight de uma delas para o laço — não são mais 74 chamadas', async () => {
    const pedidos = fingir((url) => {
      if (url.includes('/media?')) {
        return resposta({
          data: [
            { id: 'm1', media_product_type: 'FEED' },
            { id: 'm2', media_product_type: 'FEED' },
            { id: 'm3', media_product_type: 'FEED' },
          ],
        });
      }
      if (url.includes('/stories?')) return resposta({ data: [] });
      return erroDaMeta(4, 'limite do aplicativo');
    });

    await expect(fonteDaMetaHttp('tok').publicacoes('ig_1', JANELA)).rejects.toMatchObject({
      code: 4,
    });

    // media + stories + o primeiro insight. Nenhum dos outros dois.
    expect(pedidos).toHaveLength(3);
  });

  it('publicações: publicação nova sem insight (erro 100) continua ficando só com o cadastro', async () => {
    fingir((url) => {
      if (url.includes('/media?')) return resposta({ data: [{ id: 'm1', media_product_type: 'FEED' }] });
      if (url.includes('/stories?')) return resposta({ data: [] });
      return erroDaMeta(100, 'does not support the metric');
    });

    const r = await fonteDaMetaHttp('tok').publicacoes('ig_1', JANELA);

    expect(r.map((p) => p.mediaId)).toEqual(['m1']);
    expect(r[0].metrics).toEqual({});
  });

  it('orgânico: limite na chamada de seguidores sobe, em vez de a conta fechar "ok"', async () => {
    fingir((url) => {
      if (url.includes('follows_and_unfollows')) return erroDaMeta(17, 'limite do usuário');
      return resposta({ data: [] });
    });

    await expect(fonteDaMetaHttp('tok').organico('ig_1', JANELA)).rejects.toMatchObject({
      code: 17,
    });
  });
});

describe('prazo por pedido', () => {
  it('todo pedido à Meta leva um sinal de prazo', async () => {
    const prazo = vi.spyOn(AbortSignal, 'timeout');
    const sinais: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      sinais.push(init?.signal);
      return resposta({ data: [] });
    });

    await fonteDaMetaHttp('tok').campanhasDetalhe('act_1');

    expect(sinais).toHaveLength(1);
    expect(sinais[0]).toBeInstanceOf(AbortSignal);
    expect(prazo).toHaveBeenCalledOnce();
    expect(prazo.mock.calls[0][0]).toBeGreaterThanOrEqual(10_000);
  });

  it('pedido que estoura o prazo vira falha DA CONTA (não manda parar a execução) e não vaza o token', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() =>
      AbortSignal.abort(new DOMException('The operation timed out.', 'TimeoutError')),
    );
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw init.signal.reason;
      return resposta({ data: [] , url });
    });

    const erro = await fonteDaMetaHttp('segredo-do-token')
      .campanhasDetalhe('act_1')
      .catch((e: unknown) => e as Error);

    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toMatch(/Meta não respondeu/);
    expect((erro as Error).message).not.toContain('segredo-do-token');
    const { classificarFalha } = await import('@/meta/coleta');
    expect(classificarFalha(erro).deveParar).toBe(false);
  });
});

describe('o dia de hoje do orgânico', () => {
  /*
   * A janela de coleta termina no hoje em UTC (`janelaDeColeta`). Das 21h à
   * meia-noite de São Paulo esse "hoje" já é o dia seguinte — e, para o fuso em
   * que a Meta mede o dia, pode ainda nem ter começado. `since` no futuro é
   * recusado ("since param is not valid", medido em 2026-08-20): sem tratar,
   * a chamada de total_value do último dia derrubava a conta INTEIRA (a série
   * de reach e os dias anteriores incluídos) em todas as batidas dessas horas.
   */
  const SO_ALCANCE = {
    data: [
      {
        name: 'reach',
        values: [
          { value: 10, end_time: '2026-10-08T07:00:00+0000' },
          { value: 12, end_time: '2026-10-09T07:00:00+0000' },
        ],
      },
    ],
  };
  const TOTAIS = { data: [{ name: 'views', total_value: { value: 99 } }] };

  it('since recusado no último dia (hoje) não custa a conta: os dias anteriores ficam', async () => {
    fingir((url) => {
      if (url.includes('metric=reach')) return resposta(SO_ALCANCE);
      if (url.includes('metric=views,accounts_engaged')) {
        return url.includes(`since=${JANELA.ate}&`)
          ? erroDaMeta(100, '(#100) since param is not valid')
          : resposta(TOTAIS);
      }
      return resposta({ data: [] });
    });

    const r = await fonteDaMetaHttp('tok').organico('ig_1', JANELA);

    const porDia = Object.fromEntries(r.dias.map((d) => [d.day, d.metrics]));
    expect(porDia['2026-10-08']).toMatchObject({ reach: 10, views: 99 });
    expect(porDia['2026-10-09']).toMatchObject({ reach: 12 });
    expect(porDia['2026-10-09']).not.toHaveProperty('views');
  });

  it('o mesmo erro num dia que não é hoje continua subindo — não é pretexto para engolir qualquer recusa', async () => {
    fingir((url) => {
      if (url.includes('metric=reach')) return resposta(SO_ALCANCE);
      if (url.includes('metric=views,accounts_engaged')) {
        return url.includes('since=2026-10-05&')
          ? erroDaMeta(100, '(#100) since param is not valid')
          : resposta(TOTAIS);
      }
      return resposta({ data: [] });
    });

    await expect(fonteDaMetaHttp('tok').organico('ig_1', JANELA)).rejects.toMatchObject({
      code: 100,
    });
  });
});

describe('falha passageira da Meta', () => {
  /*
   * Um perfil do Instagram faz de 100 a 120 pedidos por coleta, e a Meta
   * devolve 500/502, "code 1" (erro desconhecido) e "code 2" (serviço
   * temporariamente indisponível) em uma fração deles. Sem repetir, UM pedido
   * ruim no meio desfazia a transação da conta inteira (as chamadas já feitas
   * incluídas) e a conta só voltava depois de uma volta completa da fila.
   */
  const TIMEOUT_DE_TESTE = 20_000;

  async function comRelogio<T>(trabalho: () => Promise<T>): Promise<T> {
    vi.useFakeTimers();
    try {
      const promessa = trabalho();
      // Evita "unhandled rejection" enquanto o relógio anda.
      promessa.catch(() => {});
      await vi.advanceTimersByTimeAsync(60_000);
      return await promessa;
    } finally {
      vi.useRealTimers();
    }
  }

  it.each([
    ['HTTP 502', () => resposta({}, 502)],
    ['code 2 (serviço indisponível)', () => erroDaMeta(2, 'Service temporarily unavailable')],
    ['code 1 (erro desconhecido)', () => erroDaMeta(1, 'An unknown error occurred')],
    [
      'is_transient',
      () => resposta({ error: { code: 99, message: 'tente de novo', is_transient: true } }, 400),
    ],
  ])('%s: repete o pedido e a coleta segue', async (_nome, falha) => {
    let n = 0;
    const pedidos = fingir(() => (n++ === 0 ? falha() : resposta({ data: [{ id: 'c1' }] })));

    const r = await comRelogio(() => fonteDaMetaHttp('tok').campanhasDetalhe('act_1'));

    expect(r.map((c) => c.campaignId)).toEqual(['c1']);
    expect(pedidos).toHaveLength(2);
  }, TIMEOUT_DE_TESTE);

  it('queda de rede (fetch rejeita) também repete', async () => {
    let n = 0;
    const pedidos: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      pedidos.push(url);
      if (n++ === 0) throw new TypeError('fetch failed');
      return resposta({ data: [{ id: 'c1' }] });
    });

    const r = await comRelogio(() => fonteDaMetaHttp('tok').campanhasDetalhe('act_1'));

    expect(r).toHaveLength(1);
    expect(pedidos).toHaveLength(2);
  }, TIMEOUT_DE_TESTE);

  it('desiste depois de três tentativas e sobe o último erro', async () => {
    const pedidos = fingir(() => erroDaMeta(2, 'Service temporarily unavailable'));

    await expect(
      comRelogio(() => fonteDaMetaHttp('tok').campanhasDetalhe('act_1')),
    ).rejects.toMatchObject({ code: 2 });

    expect(pedidos).toHaveLength(3);
  }, TIMEOUT_DE_TESTE);

  it.each([
    ['limite de uso (4)', () => erroDaMeta(4, 'limite')],
    ['token vencido (190)', () => erroDaMeta(190, 'token')],
    ['recusa da consulta (100)', () => erroDaMeta(100, 'does not support')],
    ['sem permissão (200)', () => erroDaMeta(200, 'permissão')],
    ['HTTP 400 sem código', () => resposta({}, 400)],
  ])('%s: NÃO repete — insistir queima a cota ou não muda nada', async (_nome, falha) => {
    const pedidos = fingir(falha);

    await expect(
      comRelogio(() => fonteDaMetaHttp('tok').campanhasDetalhe('act_1')),
    ).rejects.toBeDefined();

    expect(pedidos).toHaveLength(1);
  }, TIMEOUT_DE_TESTE);

  it('estouro de prazo NÃO repete: pedido pendurado três vezes seriam três minutos', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() =>
      AbortSignal.abort(new DOMException('The operation timed out.', 'TimeoutError')),
    );
    let chamadas = 0;
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      chamadas += 1;
      if (init?.signal?.aborted) throw init.signal.reason;
      return resposta({ data: [] });
    });

    await expect(
      comRelogio(() => fonteDaMetaHttp('tok').campanhasDetalhe('act_1')),
    ).rejects.toThrow(/Meta não respondeu/);

    expect(chamadas).toBe(1);
  }, TIMEOUT_DE_TESTE);
});
