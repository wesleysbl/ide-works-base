/**
 * A LEITURA QUE AS TELAS DIVIDEM — F17.CARGA02.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTES TESTES PROVAM, E O QUE ELES SE RECUSAM A PROVAR
 *
 *   Cada caso aqui é um COMPORTAMENTO observável: quantas vezes o servidor foi
 *   chamado, o que cada tela viu, e o que sobrou em memória depois de alguém
 *   sair. Nenhum deles procura o nome de uma biblioteca no código-fonte nem
 *   conta chamadas para afirmar desempenho — o plano proíbe as duas coisas, e
 *   com razão: prova assim passa com a implementação errada.
 *
 * ⚠️ SEM NAVEGADOR, E MESMO ASSIM SOBRE A COISA CERTA
 *   A suíte roda em `node`. Um `useQuery` precisaria de DOM; um `QueryObserver`
 *   ligado à MESMA consulta que o gancho entrega ao React, não — e é ele o
 *   motor que o gancho usa por baixo. Por isso `consultaDaArvore` e
 *   `consultaDaSessao` são exportadas: o teste liga um observador ao objeto que
 *   a tela usa, e não a uma cópia parecida que provaria só a si mesma.
 *
 *   Cada `parar()` de assinatura é uma tela que desmontou. Cada assinatura
 *   nova, uma tela que montou. É assim que "remontar dentro da validade" se
 *   escreve sem navegador.
 *
 * NADA DE REDE: `vi.stubGlobal('fetch', …)` substitui a trava de
 * `test/setup/network-guard.ts` só dentro de cada teste, e `afterEach` a devolve.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  type QueryClient,
  QueryObserver,
  environmentManager,
  focusManager,
  onlineManager,
} from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type FullTreeRow, buildFullTree, paraNavegacao } from '@/board/arvore';
import { consultaDaArvore } from '@/board/arvore-compartilhada';
import { consultaDaEquipe } from '@/board/equipe-compartilhada';
import {
  CHAVE_DA_ARVORE,
  CHAVE_DA_SESSAO,
  criarClienteDeConsultas,
  donoDasConsultas,
  esquecerConsultas,
  invalidarArvore,
  invalidarEquipe,
} from '@/lib/consultas';
import { donoConfirmado, esquecerDono } from '@/ui/rascunho';
import { conferirIdentidade, consultaDaSessao } from '@/ui/sessao';

/* ─────────────────────────── o servidor de mentira ─────────────────────────── */

const ARVORE = '/api/board/tree/full';
const EU = '/api/auth/me';
const RENOVAR = '/api/auth/refresh';
const EQUIPE = '/api/team';
/** A rota que a ficha da tarefa pedia SÓ para o menu de mudar de lista. */
const ARVORE_DO_MENU = '/api/board/tree';

type Resposta = { status: number; corpo: unknown };
/** Uma rota: recebe a ORDEM da chamada (1, 2, 3…) e o sinal de cancelamento. */
type Rota = (vez: number, sinal: AbortSignal | null | undefined) => Promise<Resposta> | Resposta;

function servidor(rotas: Record<string, Rota>) {
  const contagem: Record<string, number> = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (entrada: unknown, init?: RequestInit) => {
      const caminho = String(entrada);
      contagem[caminho] = (contagem[caminho] ?? 0) + 1;
      const rota = rotas[caminho];
      if (rota === undefined) {
        return new Response(JSON.stringify({ message: `rota não dublada: ${caminho}` }), {
          status: 404,
        });
      }
      const { status, corpo } = await rota(contagem[caminho], init?.signal);
      return new Response(JSON.stringify(corpo), { status });
    }),
  );
  return {
    /** Quantas vezes este caminho foi pedido ao servidor. */
    vezes: (caminho: string) => contagem[caminho] ?? 0,
  };
}

/** A resposta da árvore, marcada com o dono para o teste saber de quem ela é. */
const arvoreDe = (dono: string): Resposta => ({
  status: 200,
  corpo: { ok: true, companies: [{ id: `empresa-${dono}` }], spaces: [{ id: `espaco-${dono}` }] },
});

const sessaoDe = (userId: string): Resposta => ({
  status: 200,
  corpo: {
    ok: true,
    userId,
    email: `${userId}@ide.test`,
    isSuperadmin: false,
    isSuper: false,
    papel: 'member',
    areas: ['quadro'],
  },
});

/** Deixa as promessas e os `setTimeout` de 0 correrem. Timers aqui são reais. */
const assentar = () => new Promise((pronto) => setTimeout(pronto, 0));

/** Uma tela que monta: assina a consulta e devolve o que a desmonta. */
function telaQueOlha<T>(cliente: QueryClient, consulta: T) {
  const observador = new QueryObserver(
    cliente,
    consulta as ConstructorParameters<typeof QueryObserver>[1],
  );
  const vistos: unknown[] = [];
  const parar = observador.subscribe(() => vistos.push(observador.getCurrentResult().data));
  return {
    parar,
    dados: () => observador.getCurrentResult().data,
    /** Tudo o que esta tela chegou a mostrar, na ordem. */
    vistos,
  };
}

let cliente: QueryClient;

beforeEach(() => {
  cliente = criarClienteDeConsultas();
  // `mount()` é o que o provedor faz: assina foco de janela e volta da rede.
  cliente.mount();
  esquecerDono();
});

afterEach(() => {
  cliente.unmount();
  cliente.clear();
  esquecerDono();
  /* O foco e a rede são de MÓDULO na biblioteca — deixá-los mexidos faria o
     teste seguinte herdar uma janela sem foco, e ele falharia por causa deste. */
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  // E o "estamos no servidor?", que um teste precisou dizer que não.
  environmentManager.setIsServer(() => typeof window === 'undefined');
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/* ─────────────────────────── a árvore ─────────────────────────── */

describe('a árvore é uma leitura só', () => {
  it('duas telas que a pedem ao mesmo tempo produzem UM pedido', async () => {
    // É o caso do `/quadro`: a página desenha a árvore e a barra lateral
    // desenha a árvore. Antes eram duas leituras da rota mais cara do sistema.
    const s = servidor({ [ARVORE]: () => arvoreDe('ana') });

    const pagina = telaQueOlha(cliente, consultaDaArvore);
    const barra = telaQueOlha(cliente, consultaDaArvore);
    await assentar();

    expect(s.vezes(ARVORE)).toBe(1);
    expect(pagina.dados()).toEqual(barra.dados());
    expect(pagina.dados()).toBeDefined();

    pagina.parar();
    barra.parar();
  });

  it('remontar dentro da validade não pede de novo', async () => {
    // Quadro → tarefa → voltar. A tela desmonta e monta, e o dado ainda vale.
    const s = servidor({ [ARVORE]: () => arvoreDe('ana') });

    const primeira = telaQueOlha(cliente, consultaDaArvore);
    await assentar();
    expect(s.vezes(ARVORE)).toBe(1);
    primeira.parar();

    const segunda = telaQueOlha(cliente, consultaDaArvore);
    await assentar();

    expect(s.vezes(ARVORE)).toBe(1);
    // E ela não abre em branco: o dado que já estava lá é o primeiro quadro.
    expect(segunda.dados()).toEqual(primeira.dados());
    segunda.parar();
  });

  it('passada a validade, a tela seguinte relê', async () => {
    /* ⚠️ SÓ O RELÓGIO É DE MENTIRA. `toFake: ['Date']` deixa `setTimeout` e as
       promessas reais — com os temporizadores falsos, a resposta do servidor
       dublado nunca chegaria, e o teste provaria o contrário do que diz. */
    vi.useFakeTimers({ toFake: ['Date'] });
    const s = servidor({ [ARVORE]: (vez) => arvoreDe(vez === 1 ? 'antes' : 'depois') });

    const primeira = telaQueOlha(cliente, consultaDaArvore);
    await assentar();
    primeira.parar();

    vi.setSystemTime(new Date(Date.now() + 31_000));

    const segunda = telaQueOlha(cliente, consultaDaArvore);
    await assentar();

    expect(s.vezes(ARVORE)).toBe(2);
    expect(segunda.dados()).toEqual({
      linhas: [{ id: 'espaco-depois' }],
      empresas: [{ id: 'empresa-depois' }],
    });
    segunda.parar();
  });

  it('um gesto que altera a árvore provoca UMA releitura, e ela chega às duas telas', async () => {
    // Mover um cartão, arquivar uma lista, criar um espaço: a página invalida
    // uma vez. Antes, cada tela relia a sua cópia — ou a barra ficava mentindo.
    const s = servidor({ [ARVORE]: (vez) => arvoreDe(vez === 1 ? 'antes' : 'depois') });

    const pagina = telaQueOlha(cliente, consultaDaArvore);
    const barra = telaQueOlha(cliente, consultaDaArvore);
    await assentar();
    expect(s.vezes(ARVORE)).toBe(1);

    await invalidarArvore(cliente);
    await assentar();

    expect(s.vezes(ARVORE)).toBe(2);
    expect(pagina.dados()).toEqual({
      linhas: [{ id: 'espaco-depois' }],
      empresas: [{ id: 'empresa-depois' }],
    });
    expect(barra.dados()).toEqual(pagina.dados());

    pagina.parar();
    barra.parar();
  });
});

describe('a revalidação acontece nas três voltas, e só sobre o que venceu', () => {
  it('voltar para a aba relê o vencido — e deixa o que ainda vale em paz', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const s = servidor({ [ARVORE]: (vez) => arvoreDe(`v${vez}`) });

    const tela = telaQueOlha(cliente, consultaDaArvore);
    await assentar();
    expect(s.vezes(ARVORE)).toBe(1);

    // Sai e volta com o dado fresco: nada é pedido. É o que separa isto de um
    // polling — a volta à aba não é, por si só, motivo para ir ao banco.
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await assentar();
    expect(s.vezes(ARVORE)).toBe(1);

    // Uma hora no e-mail, e volta: agora sim.
    vi.setSystemTime(new Date(Date.now() + 31_000));
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await assentar();
    expect(s.vezes(ARVORE)).toBe(2);

    tela.parar();
  });

  it('a volta da rede relê o que venceu enquanto ela estava fora', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const s = servidor({ [ARVORE]: (vez) => arvoreDe(`v${vez}`) });

    const tela = telaQueOlha(cliente, consultaDaArvore);
    await assentar();
    expect(s.vezes(ARVORE)).toBe(1);

    onlineManager.setOnline(false);
    vi.setSystemTime(new Date(Date.now() + 31_000));
    await assentar();
    // Sem rede, ninguém insiste: pedir com o wi-fi fora só gera erro.
    expect(s.vezes(ARVORE)).toBe(1);

    onlineManager.setOnline(true);
    await assentar();
    expect(s.vezes(ARVORE)).toBe(2);

    tela.parar();
  });

  it('e nada é pedido sozinho enquanto a tela fica aberta — não há polling', async () => {
    /* ⚠️ DUAS MENTIRAS SÃO PRECISAS AQUI, e cada uma fecha um jeito de este
       teste passar sem provar nada:

         · `useFakeTimers` inteiro, e não só o relógio: um intervalo de
           releitura é um temporizador, e com temporizador real ele não chegaria
           a disparar dentro do teste;
         · `setIsServer(false)`: sem navegador a biblioteca se julga NO SERVIDOR
           e não agenda temporizador NENHUM — então nem um intervalo de um
           segundo dispararia, e a asserção abaixo seria verdadeira por acidente.
           Medido: com `refetchInterval: 1_000` e sem esta linha, este teste
           passa. Com ela, falha — que é o que um teste tem de fazer. */
    vi.useFakeTimers();
    environmentManager.setIsServer(() => false);
    const s = servidor({ [ARVORE]: (vez) => arvoreDe(`v${vez}`) });

    const tela = telaQueOlha(cliente, consultaDaArvore);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.vezes(ARVORE)).toBe(1);

    // Dez minutos de tela aberta, sem foco novo, sem reconexão, sem gesto.
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(s.vezes(ARVORE)).toBe(1);
    tela.parar();
  });
});

/* ─────────────────────────── a sessão ─────────────────────────── */

describe('a sessão é uma leitura só', () => {
  it('página e barra produzem UMA consulta inicial de sessão', async () => {
    // Este é o caso medido: a ficha da tarefa pergunta, e a barra dentro dela
    // pergunta de novo — dois `/auth/me` idênticos lado a lado.
    const s = servidor({ [EU]: () => sessaoDe('ana') });

    const pagina = telaQueOlha(cliente, consultaDaSessao);
    const barra = telaQueOlha(cliente, consultaDaSessao);
    await assentar();

    expect(s.vezes(EU)).toBe(1);
    expect(pagina.dados()).toEqual(barra.dados());
    expect(donoDasConsultas(cliente)).toBe('ana');

    pagina.parar();
    barra.parar();
  });

  it('uma renovação legítima de crachá não é uma segunda leitura de sessão', async () => {
    /* O crachá vence de hora em hora (F17.62). A leitura leva 401, a renovação
       acontece UMA vez em `@/lib/api`, e a chamada se refaz. Para as duas telas
       isso é UMA consulta de sessão — o que o plano manda não contar como
       segunda. */
    const s = servidor({
      [EU]: (vez) => (vez === 1 ? { status: 401, corpo: { message: 'vencido' } } : sessaoDe('ana')),
      [RENOVAR]: () => ({ status: 200, corpo: { ok: true } }),
    });

    const pagina = telaQueOlha(cliente, consultaDaSessao);
    const barra = telaQueOlha(cliente, consultaDaSessao);
    await assentar();

    expect(s.vezes(RENOVAR)).toBe(1);
    // Duas idas a `/auth/me`: a que levou 401 e a que se refez. Não quatro.
    expect(s.vezes(EU)).toBe(2);
    expect(pagina.dados()).toEqual(barra.dados());
    expect(donoDasConsultas(cliente)).toBe('ana');

    pagina.parar();
    barra.parar();
  });
});

/* ─────────────────────── trocar de gente na mesma aba ─────────────────────── */

describe('trocar de conta não mistura ninguém', () => {
  it('a árvore de quem saiu não fica na tela, e a leitura nova é a de quem entrou', async () => {
    let quem = 'ana';
    const s = servidor({
      [EU]: () => sessaoDe(quem),
      [ARVORE]: () => arvoreDe(quem),
    });

    const sessao = telaQueOlha(cliente, consultaDaSessao);
    const arvore = telaQueOlha(cliente, consultaDaArvore);
    await assentar();
    expect(arvore.dados()).toEqual({
      linhas: [{ id: 'espaco-ana' }],
      empresas: [{ id: 'empresa-ana' }],
    });

    // Outra aba trocou de conta; esta confere quem é.
    quem = 'bia';
    const quantosJaVi = arvore.vistos.length;
    await conferirIdentidade(cliente);
    await assentar();

    expect(donoDasConsultas(cliente)).toBe('bia');
    expect(s.vezes(ARVORE)).toBe(2);
    expect(arvore.dados()).toEqual({
      linhas: [{ id: 'espaco-bia' }],
      empresas: [{ id: 'empresa-bia' }],
    });

    /* ⚠️ E NUNCA, EM MOMENTO NENHUM DEPOIS DA TROCA, a árvore da ana voltou a
       ser desenhada. É o critério mais perigoso da fase, e ele não se prova
       olhando só o estado final: uma implementação que apagasse DEPOIS de
       redesenhar passaria naquela asserção e falharia nesta. */
    for (const visto of arvore.vistos.slice(quantosJaVi)) {
      expect(visto).not.toEqual({
        linhas: [{ id: 'espaco-ana' }],
        empresas: [{ id: 'empresa-ana' }],
      });
    }

    sessao.parar();
    arvore.parar();
  });

  it('a resposta atrasada da conta anterior não repovoa o cache limpo', async () => {
    // A leitura da ana está NO AR quando ela sai. A resposta chega depois.
    let soltar!: () => void;
    const presa = new Promise<void>((pronto) => {
      soltar = pronto;
    });
    servidor({
      [ARVORE]: async () => {
        await presa;
        return arvoreDe('ana');
      },
    });

    const arvore = telaQueOlha(cliente, consultaDaArvore);
    await assentar();
    expect(arvore.dados()).toBeUndefined();

    esquecerConsultas(cliente);
    soltar();
    await assentar();
    await assentar();

    expect(cliente.getQueryData(CHAVE_DA_ARVORE)).toBeUndefined();
    expect(arvore.dados()).toBeUndefined();
    expect(arvore.vistos.every((v) => v === undefined)).toBe(true);

    arvore.parar();
  });

  it('sair apaga o que estava em memória e NÃO pede nada de novo', async () => {
    /* Sem crachá não há quem leia: um pedido novo aqui voltaria 401, e uma
       sequência deles seria a tela brigando com o próprio logout. */
    const s = servidor({ [ARVORE]: () => arvoreDe('ana'), [EU]: () => sessaoDe('ana') });

    const sessao = telaQueOlha(cliente, consultaDaSessao);
    const arvore = telaQueOlha(cliente, consultaDaArvore);
    await assentar();
    expect(s.vezes(ARVORE)).toBe(1);
    expect(donoDasConsultas(cliente)).toBe('ana');

    esquecerConsultas(cliente);
    await assentar();

    expect(cliente.getQueryData(CHAVE_DA_ARVORE)).toBeUndefined();
    expect(arvore.dados()).toBeUndefined();
    expect(donoDasConsultas(cliente)).toBeNull();
    expect(s.vezes(ARVORE)).toBe(1);

    sessao.parar();
    arvore.parar();
  });
});

/* ─────────────────── o aviso de outra aba, e as três respostas ─────────────────── */

describe('o aviso de outra aba distingue as três respostas da renovação', () => {
  it('recusa real de sessão apaga identidade, rascunho e cache', async () => {
    const s = servidor({
      [EU]: (vez) => (vez === 1 ? sessaoDe('ana') : { status: 401, corpo: { message: 'fora' } }),
      [RENOVAR]: () => ({
        status: 401,
        corpo: { message: 'Sessão inválida ou expirada. Entre novamente.' },
      }),
    });

    const sessao = telaQueOlha(cliente, consultaDaSessao);
    const arvore = telaQueOlha(cliente, consultaDaArvore);
    await assentar();
    expect(donoConfirmado()).toBe('ana');

    await conferirIdentidade(cliente);
    await assentar();

    expect(s.vezes(RENOVAR)).toBe(1);
    // O dono do rascunho, o dono do cache e o dado privado: os três somem.
    expect(donoConfirmado()).toBeNull();
    expect(donoDasConsultas(cliente)).toBeNull();
    expect(cliente.getQueryData(CHAVE_DA_ARVORE)).toBeUndefined();
    expect(arvore.dados()).toBeUndefined();
    // E a tela lê `null` — que é o que a manda para o login.
    expect(cliente.getQueryData(CHAVE_DA_SESSAO)).toBeNull();
    expect(sessao.dados()).toBeNull();

    sessao.parar();
    arvore.parar();
  });

  it('renovação indisponível NÃO é logout — nada é apagado', async () => {
    /* F17.AUD04, achado 5: um `503` de segundos virava logout, e o texto que
       estava sendo escrito ia junto. A distinção não se desfaz por esta porta. */
    const s = servidor({
      [EU]: (vez) => (vez === 1 ? sessaoDe('ana') : { status: 401, corpo: { message: 'vencido' } }),
      [RENOVAR]: () => ({
        status: 503,
        corpo: { message: 'Não foi possível renovar agora. Tente de novo.' },
      }),
      [ARVORE]: () => arvoreDe('ana'),
    });

    const sessao = telaQueOlha(cliente, consultaDaSessao);
    const arvore = telaQueOlha(cliente, consultaDaArvore);
    await assentar();

    await conferirIdentidade(cliente);
    await assentar();

    expect(s.vezes(RENOVAR)).toBe(1);
    expect(donoConfirmado()).toBe('ana');
    expect(donoDasConsultas(cliente)).toBe('ana');
    expect(arvore.dados()).toEqual({
      linhas: [{ id: 'espaco-ana' }],
      empresas: [{ id: 'empresa-ana' }],
    });
    expect(sessao.dados()).not.toBeNull();

    sessao.parar();
    arvore.parar();
  });
});

/* ──────────────────── a atualização em segundo plano ──────────────────── */

describe('a atualização em segundo plano não mexe no que ainda não foi salvo', () => {
  it('reconfirmar a MESMA pessoa preserva o rascunho local', async () => {
    /* A sessão é reconfirmada a cada aviso de outra aba e a cada volta à aba.
       Se cada confirmação tratasse o dono como novo, a varredura de
       `assumirDono` apagaria o que a pessoa está escrevendo — o rascunho da
       ficha, que só some quando o dono MUDA (F17.AUD02). */
    const { assumirDono, chaveDaFicha, guardarRascunho, lerRascunho } = await import(
      '@/ui/rascunho'
    );
    const mapa = new Map<string, string>();
    const cofre = {
      getItem: (k: string) => mapa.get(k) ?? null,
      setItem: (k: string, v: string) => void mapa.set(k, v),
      removeItem: (k: string) => void mapa.delete(k),
      clear: () => mapa.clear(),
      key: (i: number) => [...mapa.keys()][i] ?? null,
      get length() {
        return mapa.size;
      },
    } as Storage;
    vi.stubGlobal('window', { sessionStorage: cofre, localStorage: cofre });

    servidor({ [EU]: () => sessaoDe('ana') });

    const ficha = { usuario: 'ana', tipo: 'tarefa', id: 't-1' } as const;
    assumirDono('ana');
    guardarRascunho(ficha, { title: 'briefing por salvar' });
    expect(mapa.has(chaveDaFicha(ficha))).toBe(true);

    // A revalidação de segundo plano: a mesma pessoa, de novo.
    const sessao = telaQueOlha(cliente, consultaDaSessao);
    await assentar();
    await conferirIdentidade(cliente);
    await assentar();

    expect(lerRascunho<{ title: string }>(ficha)?.valor).toEqual({
      title: 'briefing por salvar',
    });

    sessao.parar();
  });
});

/* ════════════════════ o menu de mudar de lista — F17.CARGA03 ════════════════════

   A ficha da tarefa pedia uma SEGUNDA árvore ao montar (`GET /board/tree`,
   ~520 ms) para alimentar um `MenuDeListas` que nasce FECHADO. A chamada saiu:
   os destinos são derivados da MESMA leitura que a barra lateral daquela tela
   já faz.

   ⚠️ O QUE ESTES DOIS CASOS PROVAM, E O QUE ELES NÃO PROVAM
     Provam que a fonte nova responde sem pedido próprio: com o servidor
     dublado respondendo AS DUAS rotas, derivar os destinos consome a árvore
     compartilhada e a rota do menu fica com ZERO chamadas.

     Não provam a tela inteira montada — a suíte roda em `node`, sem DOM. Que
     os destinos são os MESMOS de antes, com o arquivado fora, é
     `board/destinos-do-menu-de-lista.test.ts`, que compara o HTML do menu
     desenhado das duas fontes. */

describe('nenhuma árvore exclusiva do menu é pedida', () => {
  const UMA_LISTA = {
    status: 200,
    corpo: {
      ok: true,
      companies: [],
      spaces: [
        {
          spaceId: 's1',
          spaceName: 'Demandas',
          spaceColor: null,
          spaceArchivedAt: null,
          categoryId: 'c1',
          categoryName: 'Ide',
          folderId: null,
          folderName: null,
          folderArchivedAt: null,
          listId: 'l1',
          listName: 'MIMI (artes)',
          listContent: null,
          listArchivedAt: null,
          listIsLive: true,
          liveTasks: 3,
          totalTasks: 7,
          clientId: null,
          clientName: null,
          workflowName: 'Demandas',
          inheritedFrom: 'space',
        },
      ],
    },
  };

  it('os destinos saem da árvore JÁ compartilhada, sem uma segunda rota', async () => {
    const s = servidor({
      [ARVORE]: () => UMA_LISTA,
      // Dublada de propósito: se alguém a pedir, a contagem sobe e o caso cai.
      [ARVORE_DO_MENU]: () => ({ status: 200, corpo: { ok: true, spaces: [] } }),
    });

    // A barra lateral da ficha da tarefa monta e lê a árvore, como sempre.
    const barra = telaQueOlha(cliente, consultaDaArvore);
    await assentar();

    // E a ficha deriva os destinos do menu daquela mesma resposta.
    const dados = barra.dados() as { linhas: FullTreeRow[] } | undefined;
    const destinos = paraNavegacao(buildFullTree(dados?.linhas ?? []));

    expect(destinos).toEqual([
      {
        id: 's1',
        name: 'Demandas',
        color: null,
        categoryName: 'Ide',
        folders: [],
        lists: [{ id: 'l1', name: 'MIMI (artes)', liveTasks: 3, totalTasks: 7 }],
      },
    ]);
    expect(s.vezes(ARVORE)).toBe(1);
    expect(s.vezes(ARVORE_DO_MENU)).toBe(0);

    barra.parar();
  });

  it('abrir cinco tarefas seguidas não paga cinco árvores', async () => {
    // O percurso medido: quadro → tarefa → voltar → outra tarefa. Cada ficha
    // desmonta a anterior; dentro da validade, nenhuma delas paga leitura.
    const s = servidor({
      [ARVORE]: () => UMA_LISTA,
      [ARVORE_DO_MENU]: () => ({ status: 200, corpo: { ok: true, spaces: [] } }),
    });

    for (let i = 0; i < 5; i += 1) {
      const ficha = telaQueOlha(cliente, consultaDaArvore);
      await assentar();
      ficha.parar();
    }

    expect(s.vezes(ARVORE)).toBe(1);
    expect(s.vezes(ARVORE_DO_MENU)).toBe(0);
  });
});

/* ═══════════════════════ o diretório de gente — F17.CARGA03 ═══════════════════════

   `GET /team` era lido ao montar pela ficha da tarefa E pela caixa de tarefa
   nova, cada uma com o mesmo `try/catch` letra por letra. Abrir cinco tarefas
   seguidas pagava cinco vezes a mesma lista de oito nomes. */

const equipeDe = (...nomes: string[]): Resposta => ({
  status: 200,
  corpo: { ok: true, team: nomes.map((n) => ({ id: n, name: n })), me: nomes[0] },
});

describe('o diretório é uma leitura só', () => {
  it('duas telas que o pedem ao mesmo tempo produzem UM pedido', async () => {
    // É o caso de abrir a caixa de tarefa nova por cima da ficha: as duas
    // desenham o mesmo seletor de responsável.
    const s = servidor({ [EQUIPE]: () => equipeDe('ana', 'bia') });

    const ficha = telaQueOlha(cliente, consultaDaEquipe);
    const caixa = telaQueOlha(cliente, consultaDaEquipe);
    await assentar();

    expect(s.vezes(EQUIPE)).toBe(1);
    expect(ficha.dados()).toEqual({
      pessoas: [
        { id: 'ana', name: 'ana' },
        { id: 'bia', name: 'bia' },
      ],
      meuId: 'ana',
    });
    expect(caixa.dados()).toEqual(ficha.dados());

    ficha.parar();
    caixa.parar();
  });

  it('abrir cinco tarefas seguidas lê o diretório UMA vez', async () => {
    const s = servidor({ [EQUIPE]: () => equipeDe('ana') });

    for (let i = 0; i < 5; i += 1) {
      const ficha = telaQueOlha(cliente, consultaDaEquipe);
      await assentar();
      ficha.parar();
    }

    expect(s.vezes(EQUIPE)).toBe(1);
  });

  it('MUDAR PESSOAS relê — e a tela montada recebe a lista nova', async () => {
    // Desativar alguém em `Pessoas` e voltar ao quadro: sem a invalidação, o
    // seletor continuaria oferecendo quem acabou de sair até o cache vencer.
    const s = servidor({
      [EQUIPE]: (vez) => (vez === 1 ? equipeDe('ana', 'bia') : equipeDe('ana')),
    });

    const ficha = telaQueOlha(cliente, consultaDaEquipe);
    await assentar();
    expect(s.vezes(EQUIPE)).toBe(1);

    await invalidarEquipe(cliente);
    await assentar();

    expect(s.vezes(EQUIPE)).toBe(2);
    expect(ficha.dados()).toEqual({ pessoas: [{ id: 'ana', name: 'ana' }], meuId: 'ana' });

    ficha.parar();
  });

  it('e uma mudança de pessoas NÃO relê a árvore — cada invalidação é do seu', async () => {
    const s = servidor({ [ARVORE]: () => arvoreDe('ana'), [EQUIPE]: () => equipeDe('ana') });

    const barra = telaQueOlha(cliente, consultaDaArvore);
    const ficha = telaQueOlha(cliente, consultaDaEquipe);
    await assentar();

    await invalidarEquipe(cliente);
    await assentar();

    expect(s.vezes(EQUIPE)).toBe(2);
    expect(s.vezes(ARVORE)).toBe(1);

    barra.parar();
    ficha.parar();
  });

  it('a falha do diretório é SILÊNCIO, e ela é UMA tentativa', async () => {
    // Regra preservada da ficha da tarefa: sem o diretório o seletor de pessoas
    // fica vazio e a ficha ABRE do mesmo jeito. O que não pode acontecer é a
    // biblioteca repetir a falha em série por cima da API.
    const s = servidor({ [EQUIPE]: () => ({ status: 503, corpo: { message: 'Instável.' } }) });

    const ficha = telaQueOlha(cliente, consultaDaEquipe);
    await assentar();

    expect(ficha.dados()).toBeUndefined();
    expect(s.vezes(EQUIPE)).toBe(1);

    ficha.parar();
  });

  it('e a falha SE CURA na tarefa seguinte — sem F5 e sem botão', async () => {
    /* ⚠️ ESTE CASO GUARDA UMA REGRESSÃO QUE QUASE ENTROU. Antes desta fase,
       cada ficha lia `/team` ao montar, e uma falha de rede se curava sozinha
       na tarefa seguinte. Com a leitura compartilhada e o `retryOnMount: false`
       do cliente, a falha ficaria congelada por até cinco minutos, e o seletor
       de pessoas vazio sem nenhuma saída — porque a falha do diretório é
       silêncio de propósito, e não oferece `Tentar de novo` a ninguém.

       `consultaDaEquipe` reabre essa porta, e só ela. Ver o comentário lá. */
    const s = servidor({
      [EQUIPE]: (vez) =>
        vez === 1 ? { status: 503, corpo: { message: 'Instável.' } } : equipeDe('ana'),
    });

    const primeira = telaQueOlha(cliente, consultaDaEquipe);
    await assentar();
    expect(primeira.dados()).toBeUndefined();
    primeira.parar();

    // A pessoa fecha a tarefa e abre outra.
    const segunda = telaQueOlha(cliente, consultaDaEquipe);
    await assentar();

    expect(s.vezes(EQUIPE)).toBe(2);
    expect(segunda.dados()).toEqual({ pessoas: [{ id: 'ana', name: 'ana' }], meuId: 'ana' });
    segunda.parar();
  });

  it('mas uma leitura BOA continua sendo reaproveitada — a exceção é só para a falha', async () => {
    // `retryOnMount: true` não é `staleTime: 0`: dentro da validade, remontar
    // continua não pedindo nada. Sem isto, a exceção acima teria desfeito o
    // ganho inteiro desta fase no diretório.
    const s = servidor({ [EQUIPE]: () => equipeDe('ana') });

    const primeira = telaQueOlha(cliente, consultaDaEquipe);
    await assentar();
    primeira.parar();

    const segunda = telaQueOlha(cliente, consultaDaEquipe);
    await assentar();

    expect(s.vezes(EQUIPE)).toBe(1);
    segunda.parar();
  });

  it('trocar de conta não mostra o diretório da anterior', async () => {
    // A mesma máquina da árvore: quem separa os donos não é a chave, é
    // `consultasSaoDe`, chamado a cada resposta de `/auth/me`.
    const s = servidor({
      [EU]: (vez) => sessaoDe(vez === 1 ? 'ana' : 'bia'),
      [EQUIPE]: (vez) => (vez === 1 ? equipeDe('ana') : equipeDe('bia')),
    });

    const sessao = telaQueOlha(cliente, consultaDaSessao);
    const diretorio = telaQueOlha(cliente, consultaDaEquipe);
    await assentar();
    expect(diretorio.dados()).toEqual({ pessoas: [{ id: 'ana', name: 'ana' }], meuId: 'ana' });

    await conferirIdentidade(cliente);
    await assentar();

    expect(s.vezes(EQUIPE)).toBe(2);
    expect(diretorio.dados()).toEqual({ pessoas: [{ id: 'bia', name: 'bia' }], meuId: 'bia' });

    sessao.parar();
    diretorio.parar();
  });
});
