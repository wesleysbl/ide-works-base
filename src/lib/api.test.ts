/**
 * A RECUPERAÇÃO DE SESSÃO — etapa F17.AUD04.
 *
 * O QUE ESTES TESTES PROTEGEM
 *   O achado 5 da auditoria de 09/09/2026, escrito ao contrário: a reprodução
 *   `M2` afirmava que uma leitura com 401 seguida de uma renovação com 503
 *   levava a tela para o login, sem mostrar a frase do 503. Aqui a renovação
 *   tem três vereditos, e só um deles — a credencial recusada — é sessão
 *   acabada. Os outros dois mantêm a pessoa onde está.
 *
 * DUAS CAMADAS DE PROVA
 *   `criarRenovacao` é o miolo, provado sem rede: `fazer` e `renovar` são
 *   dublês contados, e cada instância tem a sua renovação em curso. A segunda
 *   parte dubla o `fetch` e chama o `api` de verdade, porque o que traduz um
 *   `503` em "indisponível" e um `401` em "recusada" é a fiação — e a
 *   reprodução da auditoria foi feita nela.
 *
 * NADA DE REDE: `vi.stubGlobal('fetch', …)` substitui a trava de
 * `test/setup/network-guard.ts` só dentro de cada teste, e `afterEach` a devolve.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  type Renovacao,
  api,
  cancelada,
  classificarRenovacao,
  criarRenovacao,
  indisponivel,
  recuperavelAoLer,
  semSessao,
} from '@/lib/api';

/** Uma resposta JSON com o status dado. */
const resposta = (status: number, corpo: unknown = { ok: true }) =>
  new Response(JSON.stringify(corpo), { status });

/**
 * A chamada em si: responde os status na ordem dada e repete o último. Contada,
 * porque o que se prova é QUANTAS vezes ela acontece.
 */
function chamadaQueResponde(...status: number[]) {
  let n = 0;
  return vi.fn(async () => {
    const s = status[Math.min(n, status.length - 1)];
    n += 1;
    return resposta(s, { ok: true, vez: n });
  });
}

/** A renovação com veredito fixo, resolvida quando a suíte mandar. */
function renovacaoControlada(veredito: Renovacao) {
  const pendentes: Array<(r: Renovacao) => void> = [];
  const renovar = vi.fn(
    () =>
      new Promise<Renovacao>((resolve) => {
        pendentes.push(resolve);
      }),
  );
  const concluir = () => {
    for (const resolver of pendentes.splice(0)) resolver(veredito);
  };
  return { renovar, concluir };
}

/** A renovação que responde na hora. */
const renovacaoImediata = (veredito: Renovacao) => vi.fn(async () => veredito);

const RENOVADA: Renovacao = { resultado: 'renovada' };
const RECUSADA: Renovacao = {
  resultado: 'recusada',
  mensagem: 'Sua sessão chegou ao limite do dia. Entre novamente.',
};
const FORA_DO_AR: Renovacao = {
  resultado: 'indisponivel',
  mensagem: 'Não foi possível renovar agora. Tente de novo.',
  status: 503,
};

/** Espera a rejeição e devolve o erro, tipado. */
async function erroDe(promessa: Promise<unknown>): Promise<ApiError> {
  try {
    await promessa;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('era para ter falhado');
}

/* ───────────────────────── o veredito da renovação ───────────────────────── */

describe('classificarRenovacao — o que /auth/refresh respondeu', () => {
  it('2xx é renovada', () => {
    expect(classificarRenovacao(200, undefined)).toEqual({ resultado: 'renovada' });
  });

  it('401 é recusada, com a frase do servidor', () => {
    expect(classificarRenovacao(401, 'Sua sessão chegou ao limite do dia. Entre novamente.')).toEqual(
      { resultado: 'recusada', mensagem: 'Sua sessão chegou ao limite do dia. Entre novamente.' },
    );
  });

  it('401 sem frase ganha a de último caso', () => {
    expect(classificarRenovacao(401, undefined)).toEqual({
      resultado: 'recusada',
      mensagem: 'Sessão inválida ou expirada. Entre novamente.',
    });
  });

  it('503 é indisponível, com a frase e o status', () => {
    expect(classificarRenovacao(503, 'Não foi possível renovar agora. Tente de novo.')).toEqual({
      resultado: 'indisponivel',
      mensagem: 'Não foi possível renovar agora. Tente de novo.',
      status: 503,
    });
  });

  /*
    Um 502 vazio é a borda no meio do caminho, e um 500 é o Worker que
    estourou. Nenhum dos dois é veredito sobre a credencial.
  */
  it('qualquer outra falha é indisponível, e não sessão acabada', () => {
    expect(classificarRenovacao(502, undefined)).toEqual({
      resultado: 'indisponivel',
      mensagem: 'Não foi possível renovar agora. Tente de novo.',
      status: 502,
    });
    expect(classificarRenovacao(500, 'Erro interno.').resultado).toBe('indisponivel');
  });
});

/* ───────────────────────── renovação simultânea ───────────────────────── */

describe('renovação simultânea — uma tela abre seis chamadas de uma vez', () => {
  it('seis 401 ao mesmo tempo compartilham UMA renovação, e as seis são refeitas', async () => {
    const { renovar, concluir } = renovacaoControlada(RENOVADA);
    const comRenovacao = criarRenovacao(renovar);
    const chamadas = Array.from({ length: 6 }, () => chamadaQueResponde(401, 200));

    const promessas = chamadas.map((fazer, i) => comRenovacao(`/board/tasks/${i}`, fazer));
    // Todas já bateram no 401 e estão esperando a mesma renovação.
    await new Promise((r) => setTimeout(r, 0));
    expect(renovar).toHaveBeenCalledTimes(1);

    concluir();
    const respostas = await Promise.all(promessas);

    expect(respostas.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(renovar).toHaveBeenCalledTimes(1);
    for (const fazer of chamadas) expect(fazer).toHaveBeenCalledTimes(2);
  });

  it('quem chega DEPOIS de a renovação terminar renova de novo — não fica preso na antiga', async () => {
    const renovar = renovacaoImediata(RENOVADA);
    const comRenovacao = criarRenovacao(renovar);

    await comRenovacao('/a', chamadaQueResponde(401, 200));
    await comRenovacao('/b', chamadaQueResponde(401, 200));

    expect(renovar).toHaveBeenCalledTimes(2);
  });

  it('cada instância tem a SUA renovação em curso', async () => {
    const primeira = renovacaoControlada(RENOVADA);
    const segunda = renovacaoControlada(RENOVADA);
    const a = criarRenovacao(primeira.renovar);
    const b = criarRenovacao(segunda.renovar);

    const pa = a('/a', chamadaQueResponde(401, 200));
    const pb = b('/b', chamadaQueResponde(401, 200));
    await new Promise((r) => setTimeout(r, 0));

    expect(primeira.renovar).toHaveBeenCalledTimes(1);
    expect(segunda.renovar).toHaveBeenCalledTimes(1);
    primeira.concluir();
    segunda.concluir();
    expect((await pa).status).toBe(200);
    expect((await pb).status).toBe(200);
  });
});

/* ───────────────────────── erro temporário ───────────────────────── */

describe('erro temporário — a renovação não pôde acontecer agora', () => {
  it('sobe como falha passageira, com a frase da renovação, e NÃO como sessão acabada', async () => {
    const renovar = renovacaoImediata(FORA_DO_AR);
    const comRenovacao = criarRenovacao(renovar);
    const fazer = chamadaQueResponde(401);

    const e = await erroDe(comRenovacao('/board/my-tasks', fazer));

    expect(indisponivel(e)).toBe(true);
    expect(semSessao(e)).toBe(false);
    expect(e.status).toBe(503);
    expect(e.message).toBe('Não foi possível renovar agora. Tente de novo.');
    // A chamada não é refeita: não há crachá novo para refazê-la.
    expect(fazer).toHaveBeenCalledTimes(1);
    expect(renovar).toHaveBeenCalledTimes(1);
  });

  it('três chamadas de uma vez levam a UMA renovação indisponível, e nenhuma é refeita', async () => {
    const { renovar, concluir } = renovacaoControlada(FORA_DO_AR);
    const comRenovacao = criarRenovacao(renovar);
    const chamadas = [chamadaQueResponde(401), chamadaQueResponde(401), chamadaQueResponde(401)];

    const promessas = chamadas.map((fazer, i) => erroDe(comRenovacao(`/x/${i}`, fazer)));
    await new Promise((r) => setTimeout(r, 0));
    concluir();
    const erros = await Promise.all(promessas);

    expect(erros.every((e) => indisponivel(e) && !semSessao(e))).toBe(true);
    expect(renovar).toHaveBeenCalledTimes(1);
    for (const fazer of chamadas) expect(fazer).toHaveBeenCalledTimes(1);
  });

  /*
    A pessoa clicou em "Tentar de novo" e o provedor voltou. A nova chamada leva
    401 (o crachá continua vencido), renova — agora com sucesso — e é refeita.
    Não há laço: cada chamada renova no máximo uma vez, e a falha anterior não
    deixou nada preso.
  */
  it('depois da falha, a próxima tentativa renova de novo e completa', async () => {
    const vereditos: Renovacao[] = [FORA_DO_AR, RENOVADA];
    const renovar = vi.fn(async () => vereditos.shift() ?? RENOVADA);
    const comRenovacao = criarRenovacao(renovar);

    const e = await erroDe(comRenovacao('/x', chamadaQueResponde(401)));
    expect(indisponivel(e)).toBe(true);

    const r = await comRenovacao('/x', chamadaQueResponde(401, 200));
    expect(r.status).toBe(200);
    expect(renovar).toHaveBeenCalledTimes(2);
  });

  it('a renovação que caiu na REDE também é passageira, com status 0', async () => {
    const comRenovacao = criarRenovacao(
      renovacaoImediata({ resultado: 'indisponivel', mensagem: 'Sem rede.', status: 0 }),
    );
    const e = await erroDe(comRenovacao('/x', chamadaQueResponde(401)));
    expect(indisponivel(e)).toBe(true);
    expect(e.status).toBe(0);
    expect(e.message).toBe('Sem rede.');
  });
});

/* ───────────────────────── sessão recusada ───────────────────────── */

describe('sessão recusada — a credencial não vale mais', () => {
  it('sobe como 401, com a frase da renovação, que é a mais específica', async () => {
    const renovar = renovacaoImediata(RECUSADA);
    const comRenovacao = criarRenovacao(renovar);
    const fazer = chamadaQueResponde(401);

    const e = await erroDe(comRenovacao('/board/my-tasks', fazer));

    expect(semSessao(e)).toBe(true);
    expect(indisponivel(e)).toBe(false);
    expect(e.status).toBe(401);
    expect(e.message).toBe('Sua sessão chegou ao limite do dia. Entre novamente.');
    expect(fazer).toHaveBeenCalledTimes(1);
  });

  it('as portas de identidade não renovam: o 401 do login é do login', async () => {
    const renovar = renovacaoImediata(RENOVADA);
    const comRenovacao = criarRenovacao(renovar);

    for (const caminho of ['/auth/login', '/auth/logout', '/auth/refresh']) {
      const r = await comRenovacao(caminho, chamadaQueResponde(401));
      expect(r.status).toBe(401);
    }
    expect(renovar).not.toHaveBeenCalled();
  });
});

/* ───────────────────────── retomada ───────────────────────── */

describe('retomada — renovada, a chamada é refeita UMA vez', () => {
  it('leitura: 401, renovação, e a resposta boa é a que volta', async () => {
    const renovar = renovacaoImediata(RENOVADA);
    const comRenovacao = criarRenovacao(renovar);
    const fazer = chamadaQueResponde(401, 200);

    const r = await comRenovacao('/board/my-tasks', fazer);

    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, vez: 2 });
    expect(fazer).toHaveBeenCalledTimes(2);
    expect(renovar).toHaveBeenCalledTimes(1);
  });

  it('a refeita que volta 401 NÃO renova de novo — o problema não é o relógio', async () => {
    const renovar = renovacaoImediata(RENOVADA);
    const comRenovacao = criarRenovacao(renovar);
    const fazer = chamadaQueResponde(401, 401);

    const r = await comRenovacao('/board/my-tasks', fazer);

    // Volta a resposta crua; é `ler` quem a transforma no 401 que manda para o login.
    expect(r.status).toBe(401);
    expect(fazer).toHaveBeenCalledTimes(2);
    expect(renovar).toHaveBeenCalledTimes(1);
  });

  it('sem 401 não há renovação nenhuma', async () => {
    const renovar = renovacaoImediata(RENOVADA);
    const comRenovacao = criarRenovacao(renovar);

    const ok = await comRenovacao('/a', chamadaQueResponde(200));
    const recusa = await comRenovacao('/b', chamadaQueResponde(403));

    expect(ok.status).toBe(200);
    expect(recusa.status).toBe(403);
    expect(renovar).not.toHaveBeenCalled();
  });

  it('a falha de transporte da chamada sobe ANTES de qualquer renovação', async () => {
    const renovar = renovacaoImediata(RENOVADA);
    const comRenovacao = criarRenovacao(renovar);
    const fazer = vi.fn(async (): Promise<Response> => {
      throw new ApiError('Sem rede.', 0, undefined, undefined, true);
    });

    const e = await erroDe(comRenovacao('/board/tasks/t1', fazer));

    expect(indisponivel(e)).toBe(true);
    expect(fazer).toHaveBeenCalledTimes(1);
    expect(renovar).not.toHaveBeenCalled();
  });
});

/* ───────────────────────── a fiação de verdade ───────────────────────── */

/** Um `fetch` de mentira: responde por caminho e método, e anota cada pedido. */
function fingirServidor(
  responder: (caminho: string, init: RequestInit | undefined, vez: number) => Response | Error,
) {
  const pedidos: { caminho: string; metodo: string; corpo: string | null }[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    pedidos.push({
      caminho: url,
      metodo: init?.method ?? 'GET',
      corpo: typeof init?.body === 'string' ? init.body : null,
    });
    const quantas = pedidos.filter((p) => p.caminho === url).length;
    const r = responder(url, init, quantas);
    if (r instanceof Error) throw r;
    return r;
  });
  return pedidos;
}

afterEach(() => vi.unstubAllGlobals());

describe('a fiação: o api de verdade com o fetch dublado', () => {
  /*
    A REPRODUÇÃO DA AUDITORIA (`M2`), invertida: leitura de tarefas com 401 e
    renovação com 503. Antes, o erro que subia era o 401 original e a tela ia
    para `/`. Agora sobe a frase do 503, passageira.
  */
  it('leitura 401 + renovação 503: sobe a frase da renovação, e não é sessão acabada', async () => {
    const pedidos = fingirServidor((caminho) => {
      if (caminho === '/api/auth/refresh') {
        return resposta(503, { message: 'Não foi possível renovar agora. Tente de novo.' });
      }
      return resposta(401, { message: 'Sessão inválida ou expirada. Entre novamente.' });
    });

    const e = await erroDe(api.meuTrabalho());

    expect(semSessao(e)).toBe(false);
    expect(indisponivel(e)).toBe(true);
    expect(e.status).toBe(503);
    expect(e.message).toBe('Não foi possível renovar agora. Tente de novo.');
    expect(pedidos.map((p) => p.caminho)).toEqual(['/api/board/my-tasks', '/api/auth/refresh']);
  });

  it('gravação 401 + renovação ok: o PATCH é refeito UMA vez, com o MESMO corpo', async () => {
    const pedidos = fingirServidor((caminho, _init, vez) => {
      if (caminho === '/api/auth/refresh') return resposta(200, { ok: true, expiresAt: 1 });
      return vez === 1 ? resposta(401, { message: 'Sessão inválida.' }) : resposta(200, { ok: true, task: { id: 't1' } });
    });

    const r = await api.salvarTarefaDoQuadro('t1', { title: 'Título novo' });

    expect(r).toEqual({ ok: true, task: { id: 't1' } });
    const gravacoes = pedidos.filter((p) => p.caminho === '/api/board/tasks/t1');
    expect(gravacoes).toHaveLength(2);
    expect(gravacoes[0].metodo).toBe('PATCH');
    expect(gravacoes[0].corpo).toBe(JSON.stringify({ title: 'Título novo' }));
    expect(gravacoes[1].corpo).toBe(gravacoes[0].corpo);
    expect(pedidos.filter((p) => p.caminho === '/api/auth/refresh')).toHaveLength(1);
  });

  it('leitura 401 + renovação ok: a leitura é refeita e entrega o resultado', async () => {
    fingirServidor((caminho, _init, vez) => {
      if (caminho === '/api/auth/refresh') return resposta(200, { ok: true });
      return vez === 1 ? resposta(401) : resposta(200, { ok: true, work: { rows: [], total: 0, capped: false } });
    });

    const r = await api.meuTrabalho();
    expect(r.work).toEqual({ rows: [], total: 0, capped: false });
  });

  /*
    O `fetch` lançou no meio de um PATCH. O pedido pode ter chegado e sido
    executado — só a resposta se perdeu. Reenviar por conta própria duplicaria
    uma escrita com efeito cumulativo (um comentário, por exemplo). O erro sobe
    passageiro e a tela, que guarda o texto (F17.AUD03), deixa a pessoa decidir.
  */
  it('falha de transporte na gravação: sobe com status 0, e NÃO é reenviada', async () => {
    const pedidos = fingirServidor(() => new TypeError('Failed to fetch'));

    const e = await erroDe(api.salvarTarefaDoQuadro('t1', { title: 'x' }));

    expect(e.status).toBe(0);
    expect(indisponivel(e)).toBe(true);
    expect(semSessao(e)).toBe(false);
    expect(e.message).toBe('Não foi possível falar com o servidor. Verifique a conexão.');
    expect(pedidos).toHaveLength(1);
  });

  it('a renovação que caiu na rede é passageira, com status 0, e os cookies ficam onde estão', async () => {
    const pedidos = fingirServidor((caminho) =>
      caminho === '/api/auth/refresh' ? new TypeError('Failed to fetch') : resposta(401),
    );

    const e = await erroDe(api.meuTrabalho());

    expect(indisponivel(e)).toBe(true);
    expect(e.status).toBe(0);
    expect(pedidos).toHaveLength(2);
  });

  it('leitura 401 + renovação 401: sessão acabada, com a frase do teto do dia', async () => {
    fingirServidor((caminho) =>
      caminho === '/api/auth/refresh'
        ? resposta(401, { message: 'Sua sessão chegou ao limite do dia. Entre novamente.' })
        : resposta(401, { message: 'Sessão inválida ou expirada. Entre novamente.' }),
    );

    const e = await erroDe(api.meuTrabalho());

    expect(semSessao(e)).toBe(true);
    expect(indisponivel(e)).toBe(false);
    expect(e.message).toBe('Sua sessão chegou ao limite do dia. Entre novamente.');
  });

  it('a renovação refeita que volta 401 de novo vai para o login, sem segunda renovação', async () => {
    const pedidos = fingirServidor((caminho) =>
      caminho === '/api/auth/refresh' ? resposta(200, { ok: true }) : resposta(401, { message: 'Sessão inválida.' }),
    );

    const e = await erroDe(api.meuTrabalho());

    expect(semSessao(e)).toBe(true);
    expect(pedidos.map((p) => p.caminho)).toEqual([
      '/api/board/my-tasks',
      '/api/auth/refresh',
      '/api/board/my-tasks',
    ]);
  });

  it('o login com 401 é recusa de senha, e não dispara renovação', async () => {
    const pedidos = fingirServidor(() => resposta(401, { message: 'E-mail ou senha inválidos.' }));

    const e = await erroDe(api.entrar('a@b.c', 'x'));

    expect(e.status).toBe(401);
    expect(e.message).toBe('E-mail ou senha inválidos.');
    expect(pedidos.map((p) => p.caminho)).toEqual(['/api/auth/login']);
  });
});

/* ───────────── `Minhas tarefas`, o endereço da página — F17.AUD05 ───────────── */

/*
  O CONTRATO PAGINADO É UM ENDEREÇO. O servidor lê `aba`, `cursor` e `limite`
  da query string, e é aqui que o cliente os escreve. Sem argumento, o
  endereço é o de sempre — nem um `?` a mais — para o consumidor antigo não
  mudar de forma antes da AUD06.
*/
/**
 * UM 200 QUE NÃO É JSON NÃO É DADO — conferência de 09/10/2026.
 *
 * O Worker responde JSON em tudo sob `/api`. Quem responde outra coisa com
 * status 200 é um intermediário: o portal de login de um wi-fi, um proxy de
 * empresa, uma borda que serviu a página dela. `ler` engolia o corpo ilegível
 * como `{}` e devolvia isso como a resposta — e a tela, que lê `r.plans.length`,
 * estourava no desenho em vez de dizer "tente de novo". Agora é falha
 * passageira, a mesma que a rede caída.
 */
describe('um 200 sem JSON de objeto: falha passageira, e nunca dado', () => {
  it('HTML com status 200 (portal de wi-fi, proxy) sobe como passageira, com a frase de tentar de novo', async () => {
    fingirServidor(() => new Response('<html><body>Faça login na rede</body></html>', { status: 200 }));

    const e = await erroDe(api.catalogosCompletos());

    expect(indisponivel(e)).toBe(true);
    expect(semSessao(e)).toBe(false);
    expect(e.status).toBe(200);
    expect(e.message).toBe('O servidor respondeu algo inesperado. Tente de novo.');
  });

  it('corpo vazio com status 200 também', async () => {
    fingirServidor(() => new Response('', { status: 200 }));
    expect(indisponivel(await erroDe(api.catalogosCompletos()))).toBe(true);
  });

  it('JSON que não é objeto (lista, nulo, texto) também', async () => {
    for (const corpo of ['[]', 'null', '"ok"', '7']) {
      fingirServidor(() => new Response(corpo, { status: 200 }));
      expect(indisponivel(await erroDe(api.catalogosCompletos())), corpo).toBe(true);
    }
  });

  it('a leitura do quadro (getBoard) segue a mesma regra', async () => {
    fingirServidor(() => new Response('<html></html>', { status: 200 }));
    expect(indisponivel(await erroDe(api.arvoreCompleta()))).toBe(true);
  });

  it('o objeto JSON de sempre passa intacto — inclusive sem as listas que a tela espera', async () => {
    fingirServidor(() => resposta(200, { ok: true }));
    expect(await api.catalogosCompletos()).toEqual({ ok: true });
  });

  it('um erro de verdade (4xx/5xx) continua sendo a frase do servidor, não a do inesperado', async () => {
    fingirServidor(() => resposta(500, { message: 'Falha no banco.' }));
    const e = await erroDe(api.catalogosCompletos());
    expect(e.message).toBe('Falha no banco.');
    expect(e.status).toBe(500);
  });
});

/**
 * QUANDO UMA LEITURA QUE FALHOU SE TENTA DE NOVO — conferência de 09/10/2026.
 *
 * `Minhas tarefas` já oferecia "Tentar de novo" também no 5xx (F04), porque uma
 * leitura não tem efeito colateral e "antes a tela parava na frase sem saída".
 * `Todas as tarefas` e a ficha da tarefa só ofereciam na falha passageira, e um
 * 500 do servidor os deixava num beco: o aviso, e nada além de recarregar a
 * página. A regra mora num lugar só.
 */
describe('recuperavelAoLer — o 5xx de uma leitura também se tenta de novo', () => {
  it('falha passageira (rede, renovação fora do ar) é recuperável', () => {
    expect(recuperavelAoLer(new ApiError('Sem rede.', 0, undefined, undefined, true))).toBe(true);
    expect(recuperavelAoLer(new ApiError('Renovação fora.', 503, undefined, undefined, true))).toBe(true);
  });

  it('500, 502 e 503 do servidor são recuperáveis, mesmo sem a marca de passageira', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(recuperavelAoLer(new ApiError('Falha no servidor.', status)), String(status)).toBe(true);
    }
  });

  it('recusa (4xx) NÃO é: outra tentativa não muda a resposta', () => {
    for (const status of [400, 403, 404]) {
      expect(recuperavelAoLer(new ApiError('Recusado.', status)), String(status)).toBe(false);
    }
  });

  it('o que não é ApiError (erro inesperado de código) também se tenta de novo', () => {
    expect(recuperavelAoLer(new TypeError('boom'))).toBe(true);
  });
});

describe('`meuTrabalho` — o endereço da página (F17.AUD05)', () => {
  it('sem argumento, o endereço é o de sempre, sem query string', async () => {
    const pedidos = fingirServidor(() =>
      resposta(200, { ok: true, work: { rows: [], total: 0, capped: false } }),
    );
    await api.meuTrabalho();
    expect(pedidos.map((p) => p.caminho)).toEqual(['/api/board/my-tasks']);
  });

  it('com aba, cursor e limite, os três vão na query string, na ordem aba·cursor·limite', async () => {
    const pedidos = fingirServidor(() =>
      resposta(200, { ok: true, work: { rows: [], total: 0, capped: false } }),
    );
    await api.meuTrabalho({ aba: 'feito', cursor: 'eyJ2IjoxfQ_-', limite: 50 });
    expect(pedidos.map((p) => p.caminho)).toEqual([
      '/api/board/my-tasks?aba=feito&cursor=eyJ2IjoxfQ_-&limite=50',
    ]);
  });

  it('cursor nulo ou ausente e limite ausente ficam FORA do endereço — a primeira página', async () => {
    const pedidos = fingirServidor(() =>
      resposta(200, { ok: true, work: { rows: [], total: 0, capped: false } }),
    );
    await api.meuTrabalho({ aba: 'pendente', cursor: null });
    await api.meuTrabalho({ aba: 'delegado' });
    expect(pedidos.map((p) => p.caminho)).toEqual([
      '/api/board/my-tasks?aba=pendente',
      '/api/board/my-tasks?aba=delegado',
    ]);
  });
});

describe('recuperação das leituras do quadro', () => {
  it.each([500, 502, 503, 504])('recupera uma falha %s preservando pasta e filtro', async (status) => {
    const requests = fingirServidor((_path, _init, attempt) => attempt === 1
      ? resposta(status)
      : resposta(200, { ok: true, board: { id: 'helena' } }));
    const result = await api.quadroDaPasta('helena', 100, { texto: 'arte', responsavel: null });
    expect(result.board).toEqual({ id: 'helena' });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(requests[1]);
    expect(requests[0].metodo).toBe('GET');
    expect(requests[0].caminho).toContain('busca=arte');
    expect(requests[0].caminho).toContain('per-column=100');
  });

  it('para após duas falhas e permite tentar novamente sem encerrar a sessão', async () => {
    const requests = fingirServidor(() => resposta(500, { message: 'Falha interna.' }));
    const error = await erroDe(api.quadroDaPasta('helena'));
    expect(requests).toHaveLength(2);
    expect(indisponivel(error)).toBe(true);
    expect(semSessao(error)).toBe(false);
    expect(error.message).toBe('Falha interna.');
  });

  it('recupera a árvore após falha de rede', async () => {
    const requests = fingirServidor((_path, _init, attempt) => attempt === 1
      ? new TypeError('Failed to fetch')
      : resposta(200, { ok: true, companies: [], spaces: [] }));
    expect((await api.arvoreCompleta()).spaces).toEqual([]);
    expect(requests).toHaveLength(2);
  });

  it.each([403, 404, 429])('não repete recusa %s', async (status) => {
    const requests = fingirServidor(() => resposta(status));
    expect((await erroDe(api.quadroDaPasta('helena'))).status).toBe(status);
    expect(requests).toHaveLength(1);
  });

  it('não repete a renovação que falhou', async () => {
    const requests = fingirServidor((path) => resposta(path === '/api/auth/refresh' ? 503 : 401));
    expect(indisponivel(await erroDe(api.quadroDaPasta('helena')))).toBe(true);
    expect(requests.map((r) => r.caminho)).toEqual(['/api/board/folders/helena', '/api/auth/refresh']);
  });

  it('não repete escrita com erro interno', async () => {
    const requests = fingirServidor(() => resposta(500));
    await erroDe(api.salvarTarefaDoQuadro('t1', { title: 'x' }));
    expect(requests).toHaveLength(1);
  });
});

/* ─────────────── cancelar não é falhar — F17.CARGA02 ─────────────── */

/*
  A CONSULTA COMPARTILHADA ABORTA LEITURAS. Quando a última tela que olhava uma
  consulta desmonta, ou quando a identidade muda, o pedido no ar é cancelado —
  e o `catch` de `chamar` via TODA rejeição de `fetch` como "a rede caiu".

  Duas consequências, e as duas eram erradas: `getBoard` REPETIA o pedido que
  quem chamou acabou de descartar, e a tela mostrava "Verifique a conexão" para
  quem só clicou noutro lugar. `LeituraCancelada` separa os dois casos, e estes
  testes são o que impede a separação de se desfazer.
*/

/** O `fetch` que só responde quando o teste mandar — ou quando cancelarem. */
function fingirServidorLento(
  responder: (caminho: string, vez: number, sinal: AbortSignal | null | undefined) => Promise<Response>,
) {
  const pedidos: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    pedidos.push(url);
    return responder(url, pedidos.filter((p) => p === url).length, init?.signal);
  });
  return pedidos;
}

/** Rejeita como o `fetch` de verdade rejeita quando o sinal abre. */
const ateCancelar = (sinal: AbortSignal | null | undefined): Promise<Response> =>
  new Promise<Response>((_, recusar) => {
    const abortar = () => recusar(new DOMException('The operation was aborted.', 'AbortError'));
    if (sinal?.aborted === true) {
      abortar();
      return;
    }
    sinal?.addEventListener('abort', abortar);
  });

describe('cancelamento', () => {
  it('a árvore cancelada não vira falha de rede, não repete e não renova', async () => {
    const pedidos = fingirServidorLento((_c, _v, sinal) => ateCancelar(sinal));
    const freio = new AbortController();

    const leitura = api.arvoreCompleta(freio.signal);
    // Uma volta do laço de eventos para o pedido chegar ao `fetch`.
    await new Promise((pronto) => setTimeout(pronto, 0));
    freio.abort();

    const e = await leitura.catch((erro: unknown) => erro);

    expect(cancelada(e)).toBe(true);
    // As três perguntas que as telas fazem respondem NÃO — nenhuma faixa
    // vermelha, nenhum "tentar de novo", nenhum login.
    expect(indisponivel(e)).toBe(false);
    expect(semSessao(e)).toBe(false);
    expect(e).not.toBeInstanceOf(ApiError);
    // Uma ida, e só. A repetição de `getBoard` não pega o cancelamento.
    expect(pedidos).toEqual(['/api/board/tree/full']);
  });

  it('a sessão cancelada não dispara renovação de crachá', async () => {
    const pedidos = fingirServidorLento((_c, _v, sinal) => ateCancelar(sinal));
    const freio = new AbortController();

    const leitura = api.eu(freio.signal);
    await new Promise((pronto) => setTimeout(pronto, 0));
    freio.abort();

    expect(cancelada(await leitura.catch((erro: unknown) => erro))).toBe(true);
    expect(pedidos).toEqual(['/api/auth/me']);
  });

  it('cancelar durante a espera da repetição não pede uma terceira vez', async () => {
    /* A primeira volta leva 503 — falha passageira, que `getBoard` repete uma
       vez depois de esperar. Se o cancelamento chegar nesse intervalo, a
       segunda volta encontra o sinal já aberto: ela nasce cancelada, e para. */
    const pedidos = fingirServidorLento(async (_c, vez, sinal) => {
      if (vez === 1) return new Response(JSON.stringify({ message: 'Instável.' }), { status: 503 });
      return ateCancelar(sinal);
    });
    const freio = new AbortController();

    const leitura = api.arvoreCompleta(freio.signal);
    await new Promise((pronto) => setTimeout(pronto, 50));
    freio.abort();

    const e = await leitura.catch((erro: unknown) => erro);

    expect(cancelada(e)).toBe(true);
    expect(indisponivel(e)).toBe(false);
    expect(pedidos).toEqual(['/api/board/tree/full', '/api/board/tree/full']);
  });
});

/* ─────────────────── renovar ANTES de vencer — 22/09/2026 ─────────────────── */

/*
  O DEFEITO: o crachá vale uma hora, e a tela só o renovava DEPOIS de uma
  chamada levar 401. Voltar a uma aba parada disparava as chamadas de uma vez —
  no console do Wesley, oito 401 vermelhos no mesmo segundo, renovação no
  seguinte. Nada quebrava, mas cada volta era uma rajada de recusas.

  Agora o servidor diz quanto o crachá ainda vale (`crachaValePor`, em segundos
  — duração, e não horário, para o relógio da máquina não entrar na conta). Com
  menos de um minuto, a primeira chamada renova ANTES, e as outras esperam a
  mesma renovação.
*/
describe('renovar antes de vencer', () => {
  const relogioEm = (inicio: number) => {
    let agora = inicio;
    return { relogio: () => agora, andar: (ms: number) => (agora += ms) };
  };

  it('perto de vencer: UMA renovação antes, e as seis chamadas saem uma vez cada, sem 401', async () => {
    const { renovar, concluir } = renovacaoControlada({ resultado: 'renovada', valePor: 3600 });
    const { relogio } = relogioEm(1_000_000);
    const comRenovacao = criarRenovacao(renovar, relogio);
    comRenovacao.anotarVencimento(30);
    const chamadas = Array.from({ length: 6 }, () => chamadaQueResponde(200));

    const promessas = chamadas.map((fazer, i) => comRenovacao(`/board/tasks/${i}`, fazer));
    await new Promise((pronto) => setTimeout(pronto, 0));

    // Nenhuma chamada sai com o crachá quase morto.
    for (const fazer of chamadas) expect(fazer).not.toHaveBeenCalled();
    concluir();
    const respostas = await Promise.all(promessas);

    expect(respostas.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    for (const fazer of chamadas) expect(fazer).toHaveBeenCalledTimes(1);
    expect(renovar).toHaveBeenCalledTimes(1);
  });

  it('com folga: não renova', async () => {
    const renovar = renovacaoImediata(RENOVADA);
    const comRenovacao = criarRenovacao(renovar, () => 0);
    comRenovacao.anotarVencimento(3600);

    await comRenovacao('/a', chamadaQueResponde(200));

    expect(renovar).not.toHaveBeenCalled();
  });

  it('o novo prazo da renovação vale: depois dela, nada de renovar a cada chamada', async () => {
    const renovar = renovacaoImediata({ resultado: 'renovada', valePor: 3600 });
    const { relogio, andar } = relogioEm(0);
    const comRenovacao = criarRenovacao(renovar, relogio);
    comRenovacao.anotarVencimento(10);

    await comRenovacao('/a', chamadaQueResponde(200));
    andar(60_000);
    await comRenovacao('/b', chamadaQueResponde(200));

    expect(renovar).toHaveBeenCalledTimes(1);

    // E o relógio andando até perto do novo prazo renova de novo.
    andar(3600_000 - 60_000 - 30_000);
    await comRenovacao('/c', chamadaQueResponde(200));
    expect(renovar).toHaveBeenCalledTimes(2);
  });

  it('sem prazo conhecido: o comportamento de antes (renova só no 401)', async () => {
    const renovar = renovacaoImediata(RENOVADA);
    const comRenovacao = criarRenovacao(renovar, () => 10 ** 12);

    await comRenovacao('/a', chamadaQueResponde(200));

    expect(renovar).not.toHaveBeenCalled();
  });

  it('recusada antes da chamada: sobe o 401 da renovação e a chamada nem sai', async () => {
    const renovar = renovacaoImediata(RECUSADA);
    const comRenovacao = criarRenovacao(renovar, () => 0);
    comRenovacao.anotarVencimento(0);
    const fazer = chamadaQueResponde(200);

    const e = await erroDe(comRenovacao('/a', fazer));

    expect(semSessao(e)).toBe(true);
    expect(e.message).toBe(RECUSADA.mensagem);
    expect(fazer).not.toHaveBeenCalled();
  });

  it('renovação fora do ar antes da chamada: a chamada sai assim mesmo — o crachá pode ainda valer', async () => {
    const renovar = renovacaoImediata(FORA_DO_AR);
    const comRenovacao = criarRenovacao(renovar, () => 0);
    comRenovacao.anotarVencimento(20);
    const fazer = chamadaQueResponde(200);

    const r = await comRenovacao('/a', fazer);

    expect(r.status).toBe(200);
    expect(fazer).toHaveBeenCalledTimes(1);
    // E não insiste a cada chamada enquanto o provedor estiver fora: volta ao 401.
    await comRenovacao('/b', chamadaQueResponde(200));
    expect(renovar).toHaveBeenCalledTimes(1);
  });

  it('as portas de identidade não passam pela renovação antecipada', async () => {
    const renovar = renovacaoImediata(RENOVADA);
    const comRenovacao = criarRenovacao(renovar, () => 0);
    comRenovacao.anotarVencimento(0);

    await comRenovacao('/auth/login', chamadaQueResponde(200));
    await comRenovacao('/auth/refresh', chamadaQueResponde(200));
    await comRenovacao('/auth/logout', chamadaQueResponde(200));

    expect(renovar).not.toHaveBeenCalled();
  });

  it('a fiação: /auth/me diz que falta pouco, e a chamada seguinte renova ANTES', async () => {
    const pedidos = fingirServidor((caminho) => {
      if (caminho === '/api/auth/me') {
        return resposta(200, { ok: true, userId: 'u', email: 'a@b', crachaValePor: 5 });
      }
      if (caminho === '/api/auth/refresh') return resposta(200, { ok: true, crachaValePor: 3600 });
      return resposta(200, { ok: true, conversations: [] });
    });

    await api.eu();
    await api.chatConversas();
    await api.chatConversas();

    expect(pedidos.map((p) => p.caminho)).toEqual([
      '/api/auth/me',
      '/api/auth/refresh',
      '/api/chat/conversations',
      '/api/chat/conversations',
    ]);
  });
});
