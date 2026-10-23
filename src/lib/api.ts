/**
 * Cliente da camada de API.
 *
 * O navegador fala **só** com a nossa borda, nunca direto com o provedor de
 * autenticação. É a decisão D6: no sistema de origem o login da tela ia direto
 * ao provedor e, por isso, escapava do limitador de tentativas.
 *
 * Consequência prática deste arquivo: não existe aqui nenhuma importação do
 * cliente do provedor. Se um dia aparecer uma, o atalho voltou.
 *
 * O CRACHÁ NÃO PASSA POR AQUI
 *   Ele vive num cookie que o JavaScript não alcança — nem este código. O
 *   navegador o envia sozinho quando a requisição leva `credentials`.
 *
 *   Foram três tentativas, e a razão de cada troca está em `server/session.ts`:
 *   memória morria a cada recarga (apertar F5 deslogava, e foi o que aconteceu
 *   com quem usou), `localStorage` seria legível por qualquer script, e o
 *   cookie sem acesso ao script resolve os dois — não é meio-termo, é melhor
 *   nos dois critérios.
 */

import type { ClientBoardList } from '@/clients/listas-do-quadro';
import type { ControleDaSemana } from '@/server/controle-da-semana';
import type { AprovacaoDoCliente, Destinos, DestinosDaEsteira } from '@/server/aprovacao-config';
import type { AprovacaoDoCard } from '@/server/aprovacao-envio';
import type { EntradaDoMaterial } from '@/server/material-de-aprovacao';
import type { AcessoDoNo, NivelDeAcesso } from '@/board/arvore';
import type { Automacao, AutomacaoEmEdicao, AutomacaoQueRodou } from '@/board/automacoes';
import type { Aviso } from '@/board/avisos';
import type { BoardAssigneeOption } from '@/board/board';
import { type FiltroDeTarefas, paraEndereco } from '@/board/filtro';
import type { Aba } from '@/board/meu-trabalho';
import { type PedidoDoEscopo, type TarefasDoEscopo, enderecoDoEscopo } from '@/board/tarefas-do-escopo';

import type { EscolhaDeEtapa, OrigemDoMovimento } from '@/board/mudanca-de-lista';
import type { Conferencia } from '@/painel/conferencia';

const BASE = '/api';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /**
     * Erros por campo, quando o servidor os manda.
     *
     * O formulário de cliente tem dezoito campos: dizer só "confira os campos"
     * obriga a pessoa a caçar qual deles. Com isto, a tela destaca o campo.
     */
    readonly erros?: Record<string, string>,
    /**
     * As etapas que ficaram SEM DESTINO ao trocar a esteira de uma lista — F17.19.
     *
     * Chega só no `409` de `POST /board/lists/:id/workflow`. Não é mensagem de
     * erro: é o que a tela precisa para PERGUNTAR para onde vão as tarefas, em
     * vez de mostrar uma recusa e parar.
     */
    readonly semDestino?: readonly string[],
    /**
     * A falha é PASSAGEIRA — F17.AUD04.
     *
     * Vale para a rede que caiu (`status 0`) e para a renovação da sessão que
     * não pôde acontecer AGORA (o `503` de `/auth/refresh`, ou a borda que não
     * respondeu). Nos dois casos a sessão NÃO acabou: os cookies estão lá, e a
     * próxima tentativa tende a funcionar. Quem chama fica na tela, com o
     * texto, a rota e os filtros, e oferece tentar de novo — em vez de mandar
     * para o login. Ver `indisponivel`.
     */
    readonly temporario = false,
    /** O código da recusa, quando o servidor manda (`type_required`, `client_required`…). */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** A `ApiError` de uma falha passageira — rede, ou renovação que não pôde acontecer agora. */
const temporaria = (mensagem: string, status: number) =>
  new ApiError(mensagem, status, undefined, undefined, true);

/** Uma transferência que aguarda a escolha da etapa de destino. */
export class MovimentoPrecisaDeEtapa extends ApiError {
  constructor(message: string, readonly escolha: EscolhaDeEtapa) {
    super(message, 409);
    this.name = 'MovimentoPrecisaDeEtapa';
  }
}

/** Verdadeiro quando a recusa foi de sessão — quem chama manda para o login. */
export const semSessao = (e: unknown) => e instanceof ApiError && e.status === 401;

/**
 * Verdadeiro quando a falha é passageira — F17.AUD04.
 *
 * É a OUTRA pergunta que toda tela faz depois de `semSessao`: não é sessão
 * vencida, é o caminho que falhou. A resposta certa é manter o que está na
 * tela e oferecer "Tentar de novo". Nunca as duas ao mesmo tempo: uma falha
 * passageira não tem `status 401`.
 */
export const indisponivel = (e: unknown) => e instanceof ApiError && e.temporario;

/**
 * Uma LEITURA que falhou merece "Tentar de novo"? — conferência de 09/10/2026.
 *
 * Sim na falha passageira (`indisponivel`), no 5xx do servidor e no que nem é
 * `ApiError`: ler não tem efeito colateral, e uma tela que para na frase do erro
 * sem saída obriga a recarregar a página (a regra que `Minhas tarefas` já
 * seguia desde a F04). Não numa recusa (4xx — conta desativada, sem acesso,
 * não encontrado): outra tentativa devolveria a mesma resposta.
 *
 * Só para LEITURAS. Numa escrita um 5xx pode ter executado, e repetir é decisão
 * da pessoa, com o texto ainda na tela.
 */
export const recuperavelAoLer = (e: unknown): boolean =>
  indisponivel(e) || !(e instanceof ApiError) || e.status >= 500;

/**
 * A LEITURA FOI CANCELADA — e cancelar NÃO É FALHAR. Etapa F17.CARGA02.
 *
 * ⚠️ POR QUE ISTO NÃO É UMA `ApiError`, E ESSA É A DECISÃO INTEIRA
 *   Sem esta classe, um `fetch` abortado caía no `catch` de `chamar` e virava
 *   `temporaria(FALHA_DE_REDE, 0)` — indistinguível do wi-fi que caiu. Duas
 *   consequências, as duas erradas:
 *
 *     · `getBoard` repete falha passageira uma vez. Trocar de pasta durante uma
 *       leitura lenta abortaria o pedido e o REFARIA — a tela pagando pelo
 *       pedido que ela mesma acabou de descartar;
 *     · a tela mostraria "Verifique a conexão" para quem só clicou noutro lugar.
 *
 *   Como ela não é `ApiError`, `semSessao` e `indisponivel` são os dois falsos,
 *   e a repetição de `getBoard` a devolve intacta na primeira volta. Quem
 *   cancela é quem sabe que cancelou — e não precisa de aviso nenhum.
 */
export class LeituraCancelada extends Error {
  constructor() {
    super('Leitura cancelada.');
    this.name = 'LeituraCancelada';
  }
}

/** Verdadeiro quando quem chamou desistiu — trocou de tela, de filtro, ou saiu. */
export const cancelada = (e: unknown) => e instanceof LeituraCancelada;

/**
 * O `fetch` rejeitou por causa do cancelamento?
 *
 * Duas perguntas, porque uma só não basta: o padrão manda rejeitar com uma
 * `DOMException` de nome `AbortError`, mas nem todo ambiente que a suíte usa
 * fabrica esse nome. O sinal aberto na mão é a resposta que sempre existe.
 */
const abortou = (sinal: AbortSignal | null | undefined, erro: unknown): boolean =>
  sinal?.aborted === true ||
  (typeof erro === 'object' && erro !== null && (erro as { name?: unknown }).name === 'AbortError');

/** Um 200 que não trouxe um objeto JSON — ver `ler`. */
const RESPOSTA_INESPERADA = 'O servidor respondeu algo inesperado. Tente de novo.';

async function ler<T>(resposta: Response): Promise<T> {
  const lido: unknown = await resposta.json().catch(() => undefined);
  /*
    ⚠️ UM 200 QUE NÃO É UM OBJETO JSON NÃO É DADO — conferência de 09/10/2026.
    O Worker responde JSON em tudo sob `/api`; quem responde outra coisa com
    status 200 é um intermediário (portal de login de wi-fi, proxy de empresa,
    borda que serviu a página dela). O corpo ilegível virava `{}` e era entregue
    como a resposta — e a tela, que lê `r.plans.length`, estourava no desenho.
    Passa a ser falha PASSAGEIRA, a mesma da rede caída: a tela fica onde está e
    oferece "Tentar de novo". Só vale para o sucesso: numa recusa (4xx/5xx) o
    corpo ilegível continua indo para a frase genérica de baixo.
  */
  const ehObjeto = typeof lido === 'object' && lido !== null && !Array.isArray(lido);
  if (resposta.ok && !ehObjeto) throw temporaria(RESPOSTA_INESPERADA, resposta.status);
  const dados = (ehObjeto ? lido : {}) as {
    message?: string;
    code?: string;
    erros?: Record<string, string>;
    semDestino?: readonly string[];
    escolhaDeEtapa?: EscolhaDeEtapa;
  } & T;
  if (!resposta.ok) {
    if (resposta.status === 409 && dados.escolhaDeEtapa) {
      throw new MovimentoPrecisaDeEtapa(dados.message ?? 'Escolha a etapa de destino.', dados.escolhaDeEtapa);
    }
    throw new ApiError(
      dados.message ?? 'Não foi possível concluir.',
      resposta.status,
      dados.erros,
      dados.semDestino,
      false,
      dados.code,
    );
  }
  return dados;
}

/** Rede fora não é culpa de quem digitou — e a mensagem precisa dizer isso. */
const FALHA_DE_REDE = 'Não foi possível falar com o servidor. Verifique a conexão.';

/* ────────────── a renovação do crachá — F17.62, e F17.AUD04 ──────────────

   O crachá de acesso do provedor vive UMA HORA — medido: `exp - iat` de um
   crachá real deste projeto dá 3.600 segundos exatos. O cookie dizia oito
   horas, e a diferença era o defeito que a equipe relatou como *"deslogando da
   tela fácil"*: passada a primeira hora, a chamada seguinte voltava 401 e a
   tela mandava para o login no meio do expediente.

   A renovação acontece AQUI, e não em cada tela: `pedir` é por onde toda
   chamada passa. Ao ver 401, ele troca o crachá uma vez e REFAZ a chamada. Quem
   está trabalhando não vê nada — que é o comportamento certo para uma hora que
   virou.

   ⚠️ UMA RENOVAÇÃO POR VEZ, E SÓ UMA TENTATIVA
     O crachá de renovação GIRA: cada troca invalida o anterior. Uma tela abre
     seis chamadas de uma vez, e seis renovações em paralelo gastariam o crachá
     na primeira e derrubariam as outras cinco. Por isso a promessa é
     compartilhada — quem chegar durante uma renovação espera a mesma.

     E a chamada refeita NÃO tenta de novo: se o 401 voltar com crachá novo, o
     problema não é o relógio, e insistir seria um laço.

   ⚠️ A RENOVAÇÃO TEM TRÊS RESPOSTAS, NÃO DUAS — F17.AUD04, achado 5 da
   auditoria de 09/09/2026

     A versão anterior reduzia a renovação a um booleano. Com `false`, `pedir`
     devolvia o 401 ORIGINAL — e toda tela lê 401 como "sessão acabou" e manda
     para o login. Só que o Worker já dizia mais do que isso em `/auth/refresh`:

       2xx  renovou e trocou os cookies                          → `renovada`
       401  a credencial não vale mais; apagou os cookies         → `recusada`
       503  o provedor não respondeu; cookies INTACTOS            → `indisponivel`

     Reproduzido: leitura de tarefas com 401, renovação com 503 — a tela
     navegava para `/` sem mostrar a frase do 503, e o texto que estava sendo
     escrito ia junto. Uma indisponibilidade de segundos virava logout.

     Agora o veredito da renovação é o que sobe. `recusada` vira um 401 com a
     FRASE DA RENOVAÇÃO (é a mais específica: "limite do dia" e "inválida ou
     expirada" são coisas diferentes, e o 401 da chamada original não sabe
     qual). `indisponivel` vira uma `ApiError` PASSAGEIRA, com o status e a
     frase da renovação — `semSessao` é falso, `indisponivel` é verdadeiro, e
     as vinte telas que perguntam `semSessao` ficam onde estão sem que nenhuma
     precise ser reescrita.

   O QUE SE REFAZ, E O QUE NÃO SE REFAZ
     Refazer depois de 401 é seguro, para LEITURA e para GRAVAÇÃO: a recusa de
     sessão vem ANTES de o servidor executar qualquer coisa — nada foi escrito,
     e a chamada refeita é a primeira que chega ao banco.

     Falha de TRANSPORTE é outra história. Quando `fetch` lança, o pedido pode
     ter chegado inteiro e sido executado, e só a resposta se perdeu. Reenviar
     um `POST` de comentário duplicaria o comentário. Esse erro sobe como está
     (`status 0`, passageiro), e quem decide repetir é a pessoa, com o texto
     ainda na tela — a F17.AUD03 garante isso para a ficha da tarefa. */

/** O que `POST /auth/refresh` respondeu, já traduzido em veredito. */
export type Renovacao =
  /** `valePor`: quantos segundos o crachá novo vale, quando o servidor disse. */
  | { resultado: 'renovada'; valePor?: number | null }
  /** A credencial não vale mais: inválida, vencida ou no teto do dia. Os cookies já foram. */
  | { resultado: 'recusada'; mensagem: string }
  /** Não deu para renovar AGORA. A sessão continua; a próxima tentativa tende a funcionar. */
  | { resultado: 'indisponivel'; mensagem: string; status: number };

/*
  As frases de último caso espelham as do Worker, para quando o corpo vier sem
  `message` — uma borda no meio do caminho pode responder 502 vazio.
*/
const SESSAO_RECUSADA = 'Sessão inválida ou expirada. Entre novamente.';
const RENOVACAO_INDISPONIVEL = 'Não foi possível renovar agora. Tente de novo.';

/**
 * Traduz a resposta de `POST /auth/refresh` no veredito.
 *
 * Só o 401 encerra a sessão. Qualquer outra falha — o 503 do provedor fora do
 * ar, um 502 da borda, um 500 — não é veredito sobre a credencial: é o caminho
 * que falhou, e falha de caminho se tenta de novo.
 */
export function classificarRenovacao(status: number, mensagem: string | undefined): Renovacao {
  if (status >= 200 && status < 300) return { resultado: 'renovada' };
  if (status === 401) return { resultado: 'recusada', mensagem: mensagem ?? SESSAO_RECUSADA };
  return { resultado: 'indisponivel', mensagem: mensagem ?? RENOVACAO_INDISPONIVEL, status };
}

async function renovarOCracha(): Promise<Renovacao> {
  let r: Response;
  try {
    r = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'same-origin' });
  } catch {
    return { resultado: 'indisponivel', mensagem: FALHA_DE_REDE, status: 0 };
  }
  const corpo = (await r.json().catch(() => ({}))) as {
    message?: string;
    crachaValePor?: unknown;
  };
  const veredito = classificarRenovacao(r.status, corpo.message);
  if (veredito.resultado !== 'renovada') return veredito;
  return { resultado: 'renovada', valePor: segundosOuNulo(corpo.crachaValePor) };
}

function segundosOuNulo(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Com quanto de folga a renovação acontece ANTES de o crachá vencer.
 *
 * Um minuto cobre a viagem da chamada e um relógio de servidor um pouco à
 * frente. Menos que isso e a chamada pode chegar já com o crachá morto.
 */
const FOLGA_DA_RENOVACAO_MS = 60_000;

/** As portas de identidade não renovam: renovar o login seria um laço. */
const SEM_RENOVACAO = ['/auth/login', '/auth/logout', '/auth/refresh'];

/**
 * A chamada que renova a sessão UMA vez e se refaz UMA vez.
 *
 * É o miolo de `pedir`, separado do `fetch` para ser provado sem rede e sem
 * tela: `renovar` é a única porta, e cada instância tem a SUA renovação em
 * curso — o navegador tem uma; a suíte cria quantas precisar.
 *
 * `fazer` é a chamada em si, e é chamada no máximo duas vezes: a primeira, e a
 * refeita depois de `renovada`. A refeita não passa por aqui de novo.
 */
export function criarRenovacao(
  renovar: () => Promise<Renovacao>,
  relogio: () => number = () => Date.now(),
) {
  let emCurso: Promise<Renovacao> | null = null;
  /**
   * Quando o crachá vence, no relógio DESTA máquina. `null` = não se sabe, e
   * aí vale o comportamento de antes: renovar só depois de um 401.
   */
  let venceEm: number | null = null;

  const anotarVencimento = (valePor: number | null | undefined) => {
    venceEm = typeof valePor === 'number' && Number.isFinite(valePor)
      ? relogio() + valePor * 1000
      : null;
  };

  /** Quem chegar durante uma renovação espera a mesma, e lê o mesmo veredito. */
  const renovarUmaVez = (): Promise<Renovacao> => {
    emCurso ??= renovar()
      .then((r) => {
        // Renovada, vale o prazo novo. Fora isso o prazo é esquecido: a
        // recusa já encerrou a sessão, e com o provedor fora do ar insistir a
        // cada chamada não ajuda — o 401, se vier, renova como sempre.
        anotarVencimento(r.resultado === 'renovada' ? r.valePor : null);
        return r;
      })
      .finally(() => {
        emCurso = null;
      });
    return emCurso;
  };

  /**
   * RENOVAR ANTES DE VENCER — 22/09/2026.
   *
   * Voltar a uma aba parada disparava as chamadas de uma vez com o crachá já
   * vencido: oito 401 no mesmo segundo, renovação no seguinte. Com o prazo
   * conhecido, a primeira chamada renova ANTES e as outras esperam a mesma
   * renovação — nenhuma sai com o crachá morto.
   */
  const pertoDeVencer = () => venceEm !== null && relogio() >= venceEm - FOLGA_DA_RENOVACAO_MS;

  async function comRenovacao(
    caminho: string,
    fazer: () => Promise<Response>,
  ): Promise<Response> {
    if (!SEM_RENOVACAO.includes(caminho) && (emCurso || pertoDeVencer())) {
      const antes = await renovarUmaVez();
      if (antes.resultado === 'recusada') throw new ApiError(antes.mensagem, 401);
      // `indisponivel`: a chamada sai assim mesmo — o crachá pode ainda valer.
    }
    const resposta = await fazer();
    if (resposta.status !== 401 || SEM_RENOVACAO.includes(caminho)) return resposta;

    const renovacao = await renovarUmaVez();
    switch (renovacao.resultado) {
      case 'renovada':
        return fazer();
      case 'recusada':
        throw new ApiError(renovacao.mensagem, 401);
      case 'indisponivel':
        throw temporaria(renovacao.mensagem, renovacao.status);
    }
  }

  return Object.assign(comRenovacao, { anotarVencimento });
}

const comRenovacao = criarRenovacao(renovarOCracha);

/** Anota o prazo do crachá que a resposta trouxe, e devolve a resposta intacta. */
function anotarPrazo<T extends { crachaValePor?: number | null }>(r: T): T {
  comRenovacao.anotarVencimento(r.crachaValePor);
  return r;
}

async function chamar(caminho: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${BASE}${caminho}`, {
      ...init,
      // Sem isto o navegador não envia o cookie da sessão.
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch (erro) {
    // Desistência de quem chamou vem antes de qualquer diagnóstico de rede:
    // ver `LeituraCancelada`. Cancelar não é falhar, e não se repete.
    if (abortou(init.signal, erro)) throw new LeituraCancelada();
    // Dizer "e-mail ou senha inválidos" aqui faria a pessoa duvidar da própria
    // senha por causa do wi-fi.
    throw temporaria(FALHA_DE_REDE, 0);
  }
}

/**
 * Por onde toda chamada JSON passa. A renovação e a repetição são as de
 * `comRenovacao`; a falha de transporte de `chamar` sobe antes de qualquer
 * renovação — e nunca é refeita daqui, pelo motivo escrito no bloco acima.
 */
async function pedir<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  return ler<T>(await comRenovacao(caminho, () => chamar(caminho, init)));
}

const post = <T>(caminho: string, corpo: unknown) =>
  pedir<T>(caminho, { method: 'POST', body: JSON.stringify(corpo) });
const put = <T>(caminho: string, corpo: unknown) =>
  pedir<T>(caminho, { method: 'PUT', body: JSON.stringify(corpo) });
const patch = <T>(caminho: string, corpo: unknown) =>
  pedir<T>(caminho, { method: 'PATCH', body: JSON.stringify(corpo) });
/**
 * `sinal` é opcional e só as leituras compartilhadas o usam — F17.CARGA02.
 *
 * Ele é o que a camada de consultas entrega ao pedir a leitura: quando aquela
 * consulta deixa de interessar (a tela desmontou, o filtro mudou, a identidade
 * trocou), o sinal abre e o pedido morre no navegador em vez de voltar para
 * uma tela que não o espera mais. Ver `LeituraCancelada`.
 */
const get = <T>(caminho: string, sinal?: AbortSignal) =>
  pedir<T>(caminho, sinal === undefined ? {} : { signal: sinal });
const del = <T>(caminho: string) => pedir<T>(caminho, { method: 'DELETE' });

/** Leituras do quadro podem ser repetidas uma vez após falha transitória.
 * A repetição fica dentro da renovação: uma recusa de sessão ou uma falha
 * ao renovar não dispara outro ciclo de autenticação. Escritas não passam aqui.
 *
 * ⚠️ CANCELAMENTO NÃO ENTRA NA REPETIÇÃO — F17.CARGA02. `LeituraCancelada` não
 * é `ApiError`, então a condição abaixo a devolve na primeira volta. Repetir o
 * pedido que quem chamou acabou de descartar seria pagar duas vezes por nada.
 */
async function getBoard<T>(path: string, sinal?: AbortSignal): Promise<T> {
  const transientStatus = (status: number) => [500, 502, 503, 504].includes(status);
  const response = await comRenovacao(path, async () => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const result = await chamar(path, sinal === undefined ? {} : { signal: sinal });
        if (attempt > 0 || !transientStatus(result.status)) return result;
        await result.body?.cancel();
      } catch (error) {
        if (attempt > 0 || !(error instanceof ApiError) || error.status !== 0) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  });
  try {
    return await ler<T>(response);
  } catch (error) {
    if (error instanceof ApiError && transientStatus(error.status)) {
      throw temporaria(error.message, error.status);
    }
    throw error;
  }
}


/**
 * A cauda de consulta das duas telas que filtram — F17.55.
 *
 * `URLSearchParams` e não concatenação: um título com `&` ou com espaço é
 * comum, e montar `?busca=${texto}` à mão quebraria a busca justamente no
 * termo que a pessoa digitou. Vazio devolve string vazia, então o endereço de
 * quem não filtra continua sendo o de sempre.
 */
function comFiltro(filtro?: FiltroDeTarefas, porColuna?: number): string {
  const p = new URLSearchParams(filtro === undefined ? {} : paraEndereco(filtro));
  if (porColuna !== undefined) p.set('per-column', String(porColuna));
  const cauda = p.toString();
  return cauda === '' ? '' : `?${cauda}`;
}

export const api = {
  /**
   * A configuração que o navegador precisa saber — F17.22 / F20.3.
   *
   * `trustedImageHosts` são os hospedeiros que o dono desta instalação declarou
   * seus, separados por vírgula. Quem decide o que fazer com eles é
   * `@/board/previa-de-link`; quem os entrega é `src/main.tsx`, uma vez, na
   * abertura. Não exige sessão — ver a rota no Worker.
   *
   * `chat` é o estado da chave IDEWORKS_CHAT (desligado|piloto|ligado). A tela
   * do chat (F20.5) esconde o item quando vem desligado.
   */
  configuracao: () =>
    get<{ ok: true; trustedImageHosts: string; chat: 'desligado' | 'piloto' | 'ligado' }>(
      '/config',
    ),

  entrar: (email: string, password: string, rememberMe = false) =>
    post<{ ok: true; userId: string; crachaValePor?: number | null }>('/auth/login', {
      email,
      password,
      rememberMe,
    }).then(anotarPrazo),

  sair: () => post<{ ok: true }>('/auth/logout', {}),

  /**
   * Quem é a pessoa da sessão. As telas usam para saber se há sessão.
   *
   * ⚠️ UMA LEITURA PARA A TELA INTEIRA desde a F17.CARGA02: página e barra
   * lateral dividem a mesma consulta em `@/ui/sessao`, e não duas. O `sinal`
   * é o de lá — a leitura morre com a tela que a pediu.
   */
  eu: (sinal?: AbortSignal) =>
    get<{
      ok: true;
      /** O id estável do ator autenticado — o dono de qualquer rascunho local. F17.AUD02. */
      userId: string;
      email: string;
      /** O nome do perfil, ou `null` sem nome — F29. Opcional: servidor antigo não manda. */
      nome?: string | null;
      isSuperadmin: boolean;
      /** So o topo: decide empresa e cria outro super admin. */
      isSuper: boolean;
      papel: string;
      areas: string[];
      /** Quantos segundos o crachá ainda vale — ver `criarRenovacao`. */
      crachaValePor?: number | null;
    }>('/auth/me', sinal).then(anotarPrazo),

  /**
   * O painel de um INTERVALO — dias inclusivos nas duas pontas.
   *
   * O medidor continua sendo dos meses que o intervalo toca, inteiros; os dias
   * servem à leitura de produção datada. Ver `server/panel.ts`.
   *
   * `conferencia` vem na mesma leitura. Recalcular os dois lados na tela
   * daria uma segunda opinião sobre a junção.
   */
  painel: (de: string, ate: string) =>
    get<{
      ok: true;
      from: string;
      to: string;
      months: string[];
      clients: unknown[];
      conferencia: Conferencia;
    }>(`/clients?from=${encodeURIComponent(de)}&to=${encodeURIComponent(ate)}`),

  cliente: (id: string, month: string, from?: string, to?: string) => {
    const q = new URLSearchParams({ month });
    if (from && to) {
      q.set('from', from);
      q.set('to', to);
    }
    return get<{ ok: true; client: unknown }>(`/clients/${id}?${q}`);
  },

  alternarConclusao: (itemId: string, concluir: boolean) =>
    concluir
      ? post<{ ok: true }>(`/items/${itemId}/completion`, {})
      : del<{ ok: true }>(`/items/${itemId}/completion`),

  /*
    ⚠️ `isExtra` OMITIDO NÃO É `false` — F17.44.

    Quem sabe se o item nasce extra é o MÊS: extra é o que passa da cota
    contratada daquele tipo. A grade semanal tem esse número na mão e o manda;
    o calendário, que passou a criar entrega, desenha dias e não cotas.

    Então omitir o campo é dizer "decida você", e a decisão sai no servidor com
    a mesma regra da grade — em vez de a tela do calendário guardar uma segunda
    cópia da conta, que ficaria para trás na primeira mudança. `JSON.stringify`
    apaga a chave indefinida, e é o servidor que a vê faltando.
  */
  criarItem: (
    clientId: string,
    month: string,
    contentType: string,
    isExtra?: boolean,
    scheduledAt?: string | null,
    title?: string | null,
  ) =>
    post<{ ok: true; id: string }>('/items', {
      clientId,
      month,
      contentType,
      isExtra,
      scheduledAt,
      title,
    }),

  /** Só o nome — F17.44. Dia e conclusão têm rota própria; tipo não se corrige. */
  renomearItem: (itemId: string, title: string | null) =>
    put<{ ok: true }>(`/items/${itemId}`, { title }),

  excluirItem: (itemId: string) => del<{ ok: true }>(`/items/${itemId}`),

  calendario: (from: string, to: string, client?: string) => {
    const q = new URLSearchParams({ from, to });
    if (client) q.set('client', client);
    return get<{ ok: true; entries: unknown[] }>(`/calendar?${q}`);
  },

  agendar: (itemId: string, at: string | null) =>
    at === null
      ? del<{ ok: true }>(`/items/${itemId}/schedule`)
      : post<{ ok: true }>(`/items/${itemId}/schedule`, { at }),

  /*
    O compromisso — F17.44. Reunião, gravação, viagem: ocupa o dia e NÃO entra
    na cota do mês. Rota própria porque tabela própria, e a tabela é própria
    porque é assim que a cota fica fora de perigo por aritmética, e não por
    lembrança de um filtro.

    `hora` vai como `null` quando é o dia inteiro. ⚠️ Não mande `'00:00'` para
    dizer "sem hora": meia-noite é uma hora, e foi ela que encheu o calendário
    de `00:00` do lado das entregas.
  */
  criarCompromisso: (entrada: {
    clientId: string;
    day: string;
    time: string | null;
    title: string;
    notes: string | null;
  }) => post<{ ok: true; id: string }>('/appointments', entrada),

  salvarCompromisso: (
    id: string,
    entrada: {
      clientId: string;
      day: string;
      time: string | null;
      title: string;
      notes: string | null;
    },
  ) => put<{ ok: true }>(`/appointments/${id}`, entrada),

  excluirCompromisso: (id: string) => del<{ ok: true }>(`/appointments/${id}`),

  abrirMes: (clientId: string, month: string) =>
    post<{ ok: true; contractId: string }>(`/clients/${clientId}/months/${month}/open`, {}),

  marcarRitual: (
    clientId: string,
    month: string,
    passo: 'planning' | 'approval',
    feito: boolean,
  ) =>
    feito
      ? post<{ ok: true; note?: string }>(`/clients/${clientId}/months/${month}/${passo}`, {})
      : del<{ ok: true }>(`/clients/${clientId}/months/${month}/${passo}`),

  /* --- ficha do cliente (F4.5) --- */

  catalogos: () =>
    get<{
      ok: true;
      plans: Array<{ id: string; name: string; colorBg: string; colorText: string; colorBorder: string }>;
      categories: Array<{ id: string; name: string; isDefault: boolean }>;
      tags: Array<{ id: string; name: string; color: string }>;
    }>('/catalogs'),

  /** O cliente na forma do formulário, não na do banco. */
  fichaDoCliente: (id: string) => get<{ ok: true; client: unknown }>(`/clients/${id}/form`),

  /** Listas do quadro ligadas a este cliente — F17.84. O mesmo caminho da ficha, do relatório e da IA. */
  listasDoQuadroDoCliente: (id: string) =>
    get<{ ok: true; lists: ClientBoardList[] }>(`/clients/${id}/board-lists`),

  criarCliente: (entrada: unknown) => post<{ ok: true; id: string }>('/clients', entrada),

  salvarCliente: (id: string, entrada: unknown) =>
    put<{ ok: true; id: string }>(`/clients/${id}`, entrada),

  /** Urgência e financeiro-ok: as duas que a operação vira todo dia. */
  chavesDoCliente: (
    id: string,
    chaves: { urgency?: 'paz' | 'alerta' | 'perigo'; financeOk?: boolean },
  ) => post<{ ok: true }>(`/clients/${id}/flags`, chaves),

  ativarCliente: (id: string, active: boolean) =>
    post<{ ok: true }>(`/clients/${id}/active`, { active }),

  /** Excluir de vez um cliente JÁ INATIVO. Só o administrador. */
  excluirCliente: (id: string) => del<{ ok: true }>(`/clients/${id}`),

  /* --- a aprovação do cliente por link (F42, Fase 3) — só admin --- */

  /** Ligada? Tem link vivo? (o token não vem: copiar é outra chamada). */
  aprovacaoDoCliente: (id: string) =>
    get<{ ok: true; approval: AprovacaoDoCliente }>(`/clients/${id}/approval`),

  /** Liga ou desliga. Desligar não revoga o link: religar o devolve. */
  ligarAprovacaoDoCliente: (id: string, enabled: boolean) =>
    post<{ ok: true; approval: AprovacaoDoCliente }>(`/clients/${id}/approval`, { enabled }),

  /** O endereço completo do link vivo, decifrado no servidor. */
  copiarLinkDeAprovacao: (id: string) =>
    get<{ ok: true; url: string; createdAt: string }>(`/clients/${id}/approval/link`),

  /** Gera o link novo; o antigo para de funcionar na mesma hora. */
  gerarLinkDeAprovacao: (id: string) =>
    post<{ ok: true; url: string; createdAt: string; revoked: number }>(`/clients/${id}/approval/link`, {}),

  /* --- demandas (F4.8) --- */

  /** Quem pode receber demanda. Vem do diretório, não de `profiles`. */
  /**
   * Quem pode receber tarefa, e qual deles sou eu.
   *
   * `me` entrou na F17.10b: o seletor de responsável do ClickUp põe `Eu` no
   * topo. `team_directory()` devolve nome e identificador — sem `me`, a tela
   * teria de adivinhar qual das oito linhas é a de quem está olhando.
   */
  /**
   * ⚠️ `sinal` — F17.CARGA03. Esta leitura virou uma consulta compartilhada
   * (`@/board/equipe-compartilhada`): desmontar a última tela que a olhava
   * aborta o pedido, e cancelar não é falhar. Mesmo desenho de `arvoreCompleta`.
   */
  equipe: (sinal?: AbortSignal) =>
    get<{ ok: true; team: Array<{ id: string; name: string }>; me?: string }>('/team', sinal),

  demandas: (clientId: string, comArquivadas = false) =>
    get<{ ok: true; tasks: unknown[] }>(
      `/clients/${clientId}/tasks${comArquivadas ? '?archived=1' : ''}`,
    ),

  criarDemanda: (clientId: string, entrada: unknown) =>
    post<{ ok: true; id: string }>(`/clients/${clientId}/tasks`, entrada),

  salvarDemanda: (taskId: string, entrada: unknown) =>
    put<{ ok: true }>(`/tasks/${taskId}`, entrada),

  concluirDemanda: (taskId: string, concluir: boolean) =>
    concluir
      ? post<{ ok: true }>(`/tasks/${taskId}/completion`, {})
      : del<{ ok: true }>(`/tasks/${taskId}/completion`),

  arquivarDemanda: (taskId: string, arquivar: boolean) =>
    arquivar
      ? post<{ ok: true }>(`/tasks/${taskId}/archive`, {})
      : del<{ ok: true }>(`/tasks/${taskId}/archive`),

  excluirDemanda: (taskId: string) => del<{ ok: true }>(`/tasks/${taskId}`),

  /* --- histórico (F4.9) --- */

  historico: (clientId: string) =>
    get<{ ok: true; events: unknown[] }>(`/clients/${clientId}/history`),

  criarEvento: (clientId: string, entrada: unknown) =>
    post<{ ok: true; id: string }>(`/clients/${clientId}/history`, entrada),

  salvarEvento: (eventId: string, entrada: unknown) =>
    put<{ ok: true }>(`/history/${eventId}`, entrada),

  excluirEvento: (eventId: string) => del<{ ok: true }>(`/history/${eventId}`),

  /**
   * O endereço para abrir um documento do histórico — assinado, e com prazo.
   *
   * PEDIDO NO CLIQUE, pelo mesmo motivo do anexo da tarefa: assinar ao carregar
   * a aba gastaria uma assinatura por documento que ninguém vai abrir, e uma
   * aba deixada aberta teria uma pilha de endereços vencidos.
   *
   * Até a F17.52 este método não existia porque não precisava existir: o
   * endereço estava gravado dentro do dado, público, e qualquer um o abria.
   */
  enderecoDoDocumento: (documentId: string) =>
    get<{
      ok: true;
      url: string;
      expiresAt: string;
      fileName: string;
      contentType: string | null;
    }>(`/history/documents/${documentId}/url`),

  /* --- conexões da Meta (F7) --- */

  /**
   * O mapa de contas por cliente.
   *
   * Nenhuma resposta daqui traz token: não há token no banco. O System User é
   * um só para toda a carteira e vive como segredo do Worker.
   */
  /**
   * As contas da Meta como entidade própria — F7d.
   *
   * A conta existe na Meta com ou sem cliente cadastrado aqui. O vínculo com o
   * Sistema IDE é ponte opcional, e se faz na ficha do cliente.
   */
  contasDaMeta: () =>
    get<{ ok: true; hasToken: boolean; accounts: unknown[] }>('/meta/accounts'),

  /**
   * As empresas do grupo e a credencial da Meta de cada uma — F7g.
   *
   * `configurada` diz se o segredo existe NESTE servidor. É o que permite a
   * tela avisar antes de tentar, em vez de o erro aparecer só na coleta
   * seguinte — e lá ele chega disfarçado de "conta não encontrada".
   */
  empresasDaMeta: () =>
    get<{
      ok: true;
      podeEscolher: boolean;
      empresas: Array<{
        id: string;
        name: string;
        secretName: string | null;
        contas: number;
        configurada: boolean;
      }>;
    }>('/meta/companies'),

  /**
   * `empresaId` decide COM QUAL TOKEN descobrir e com que carimbo gravar.
   * Nulo mantém o caminho antigo, com a credencial padrão.
   */
  importarContasDaMeta: (empresaId: string | null = null) =>
    post<{
      ok: true;
      total: number;
      contas: number;
      empresa: { id: string; name: string } | null;
      avisos: string[];
      /** De quem é o token que trouxe estas contas — F19f. */
      identidade: { id: string; nome: string | null } | null;
    }>('/meta/accounts/import', empresaId ? { empresaId } : {}),

  atribuirClienteAConta: (assetId: string, clientId: string | null) =>
    post<{ ok: true }>(`/meta-assets/${assetId}/client`, { clientId }),

  /* --- os relatórios (F9) --- */

  /**
   * As linhas diárias do intervalo — cruas.
   *
   * O servidor não soma nada de propósito: somar alcance de dias diferentes
   * infla o número, e a regra de o que se soma e o que não se soma mora em
   * `@/meta/relatorio`, que tem teste. Ver o cabeçalho de lá.
   */
  relatorioPago: (assetId: string, de: string, ate: string) =>
    get<{
      ok: true;
      conta: { id: string; displayName: string | null; externalId: string } | null;
      dias: unknown[];
    }>(`/meta-assets/${assetId}/report/paid?from=${de}&to=${ate}`),

  relatorioOrganico: (assetId: string, de: string, ate: string) =>
    get<{
      ok: true;
      conta: { id: string; displayName: string | null; externalId: string } | null;
      dias: unknown[];
      demografia: unknown[];
      quebras: unknown[];
    }>(`/meta-assets/${assetId}/report/organic?from=${de}&to=${ate}`),

  /**
   * Cada publicação da conta.
   *
   * Sem intervalo: a métrica de uma publicação é acumulada desde que foi ao ar.
   * Ver `server/meta-relatorio.ts`.
   */
  publicacoesDaConta: (assetId: string) =>
    get<{ ok: true; publicacoes: unknown[] }>(`/meta-assets/${assetId}/media`),

  /**
   * O livro de execuções da coleta.
   *
   * É por ele que se sabe que a coleta parou — o log da Cloudflare expira, o
   * livro não. Em 2026-08-20 a coleta ficou catorze horas morta e ninguém viu
   * porque nada na tela fazia esta pergunta.
   */
  saudeDaColeta: () =>
    get<{ ok: true; hasToken: boolean; runs: unknown[] }>('/meta/health'),

  /* --- o controle da semana dos admins (F40, Fase 7) --- */

  /**
   * A semana inteira numa leitura: para atribuir, andamento e faltas. `semana`
   * é qualquer dia (o servidor leva à segunda); sem ela, a semana de hoje. Só
   * admin — o resto recebe 403 com a frase pronta.
   */
  controleDaSemana: (semana?: string | null, sinal?: AbortSignal) =>
    get<{ ok: true } & ControleDaSemana>(
      `/admin/semana${semana ? `?semana=${encodeURIComponent(semana)}` : ''}`,
      sinal,
    ),

  /** O OK: grava pessoa e prazo e move o card para a fila do tipo, numa transação. */
  liberarDemanda: (corpo: { taskId: string; assigneeIds: string[]; dueOn: string }) =>
    post<{ ok: true; release: unknown }>('/admin/semana/liberar', corpo),

  /* --- administração de pessoas (F12) --- */

  /**
   * Quem são as pessoas, e o que cada uma alcança.
   *
   * Devolve também `eu`: a tela marca "você" e evita oferecer os botões que o
   * banco vai recusar — ninguém tira o próprio papel nem se desativa.
   */
  pessoas: () =>
    get<{ ok: true; pessoas: unknown[]; eu: string }>('/admin/people'),

  /** Lista leve de clientes, para escolher carteira. */
  clientesParaCarteira: () =>
    get<{ ok: true; clientes: { id: string; nome: string }[] }>('/admin/clients'),

  carteiraDaPessoa: (userId: string) =>
    get<{ ok: true; clientes: { id: string; nome: string }[] }>(
      `/admin/people/${userId}/clients`,
    ),

  definirCarteira: (userId: string, clientIds: string[]) =>
    put<{ ok: true; total: number }>(`/admin/people/${userId}/clients`, { clientIds }),

  /** As empresas que existem — as unidades de negócio. */
  empresas: () =>
    get<{ ok: true; empresas: { id: string; nome: string }[] }>('/admin/companies'),

  empresasDaPessoa: (userId: string) =>
    get<{ ok: true; empresas: { id: string; nome: string }[] }>(
      `/admin/people/${userId}/companies`,
    ),

  /** Só o super admin — mudar empresa troca a carteira inteira de uma vez. */
  definirEmpresas: (userId: string, ids: string[]) =>
    put<{ ok: true; total: number }>(`/admin/people/${userId}/companies`, { ids }),

  /** Só o super admin. Apaga o perfil daqui; NÃO mexe no cadastro compartilhado. */
  editarCadastro: (userId: string, dados: { nome: string; email: string; anterior: { nome: string | null; email: string } }) =>
    put<{ ok: true }>(`/admin/people/${userId}/profile`, dados),

  apagarPessoa: (userId: string) => del<{ ok: true }>(`/admin/people/${userId}`),

  /** A fila: convites que ainda não viraram conta. */
  filaDeAcesso: () =>
    get<{
      ok: true;
      convites: {
        id: string;
        email: string;
        expiraEm: string;
        tentativasFalhas: number;
        criadoEm: string;
        vencido: boolean;
        /** `invite` dá acesso; `reset` deixa escolher senha nova — F17.31. */
        intencao: 'invite' | 'reset';
      }[];
    }>('/admin/queue'),

  cancelarConvite: (id: string) => del<{ ok: true }>(`/admin/queue/${id}`),

  /**
   * O código que deixa a pessoa escolher uma senha nova — F17.31.
   *
   * ⚠️ Não passa senha por aqui, nem de ida nem de volta: quem administra gera
   * o CÓDIGO e o entrega à mão; a senha é escolhida por quem tem a conta, e
   * ninguém mais a sabe. Gerar outro mata os códigos pendentes anteriores
   * daquele endereço.
   *
   * O código volta UMA vez. Depois disto ele não existe em lugar nenhum — o
   * banco guarda só a impressão digital.
   */
  gerarRedefinicao: (userId: string) =>
    post<{ ok: true; code: string; expiresAt: string; email: string; revogados: number }>(
      `/admin/people/${userId}/password-reset`,
      {},
    ),

  /** Gastar o código e escolher a senha. Rota pública: quem perdeu a senha não tem crachá. */
  redefinirSenha: (email: string, code: string, password: string) =>
    post<{ ok: true; email: string }>('/auth/reset-password', { email, code, password }),

  definirAreas: (userId: string, areas: string[]) =>
    put<{ ok: true }>(`/admin/people/${userId}/areas`, { areas }),

  definirPapel: (userId: string, papel: string, todosOsClientes: boolean) =>
    put<{ ok: true }>(`/admin/people/${userId}/role`, { papel, todosOsClientes }),

  definirPessoaAtiva: (userId: string, ativo: boolean) =>
    put<{ ok: true }>(`/admin/people/${userId}/active`, { ativo }),

  /** As campanhas de uma conta, com o objetivo e as ações somadas. */
  campanhasDaConta: (assetId: string, de: string, ate: string) =>
    get<{ ok: true; campanhas: unknown[] }>(
      `/meta-assets/${assetId}/campaigns?from=${de}&to=${ate}`,
    ),

  /**
   * Os anúncios de UMA campanha — F10i.
   *
   * Inclui os desligados de propósito: a pergunta que abre esta lista é "qual
   * criativo funcionou", e a resposta costuma estar num que já foi pausado.
   */
  anunciosDaCampanha: (assetId: string, campaignId: string, de: string, ate: string) =>
    get<{ ok: true; anuncios: unknown[] }>(
      `/meta-assets/${assetId}/campaigns/${encodeURIComponent(campaignId)}/ads?from=${de}&to=${ate}`,
    ),

  /**
   * O ranking de criativos de um gerenciador.
   *
   * `bm` nulo traz todos os gerenciadores que a pessoa enxerga.
   */
  /**
   * `empresa` filtra ANTES do gerenciador — e por isso a lista de
   * gerenciadores que volta também encolhe. Ver `readRanking`.
   */
  rankingDeCriativos: (de: string, ate: string, bm: string | null, empresa: string | null = null) =>
    get<{
      ok: true;
      gerenciadores: string[];
      empresas: Array<{ id: string; nome: string }>;
      criativos: unknown[];
    }>(
      `/meta/ranking?from=${de}&to=${ate}` +
        (bm === null ? '' : `&bm=${encodeURIComponent(bm)}`) +
        (empresa === null ? '' : `&empresa=${encodeURIComponent(empresa)}`),
    ),

  conexoesDaMeta: () => get<{ ok: true; clients: unknown[] }>('/meta/connections'),

  /**
   * O que o token enxerga.
   *
   * Existe porque pedir o identificador digitado não funciona: a URL do perfil
   * do Instagram não contém o id. Ver `server/meta-descoberta.ts`.
   */
  descobrirContasDaMeta: () =>
    get<{
      ok: true;
      semToken: boolean;
      contas: Array<{
        kind: 'ad_account' | 'instagram_account';
        externalId: string;
        displayName: string | null;
        via: string | null;
      }>;
      avisos: string[];
      identidade: { id: string; nome: string | null } | null;
    }>('/meta/discover'),

  conectarAtivo: (
    clientId: string,
    entrada: { kind: string; externalId: string; displayName?: string },
  ) => post<{ ok: true; id: string }>(`/clients/${clientId}/meta-assets`, entrada),

  ligarAtivo: (assetId: string, isActive: boolean) =>
    patch<{ ok: true }>(`/meta-assets/${assetId}`, { isActive }),

  desconectarAtivo: (assetId: string) => del<{ ok: true }>(`/meta-assets/${assetId}`),

  /* --- catálogos (F2.4) --- */

  /** Os três catálogos com a contagem de uso de cada item. */
  catalogosCompletos: () =>
    get<{
      ok: true;
      plans: Array<{
        id: string;
        name: string;
        colorBg: string;
        colorText: string;
        colorBorder: string;
        sortOrder: number;
        isActive: boolean;
        clientCount: number;
      }>;
      categories: Array<{
        id: string;
        name: string;
        isDefault: boolean;
        sortOrder: number;
        clientCount: number;
        /** F31, Fase 3a — a unidade omitida; só o super admin a recebe. */
        omitida?: boolean;
      }>;
      tags: Array<{ id: string; name: string; color: string; clientCount: number }>;
    }>('/catalogs/manage'),

  salvarCatalogo: (
    tipo: 'plans' | 'categories' | 'tags',
    id: string | null,
    entrada: unknown,
  ) =>
    id
      ? put<{ ok: true; id: string }>(`/${tipo}/${id}`, entrada)
      : post<{ ok: true; id: string }>(`/${tipo}`, entrada),

  excluirCatalogo: (tipo: 'plans' | 'categories' | 'tags', id: string) =>
    del<{ ok: true; reallocated?: number }>(`/${tipo}/${id}`),

  definirCategoriaPadrao: (id: string) => post<{ ok: true }>(`/categories/${id}/default`, {}),

  fundirEtiquetas: (de: string, para: string) =>
    post<{ ok: true; moved: number }>(`/tags/${de}/merge`, { into: para }),

  /** Etiquetar cliente: exige enxergar o cliente, não ser administrador. */
  etiquetarCliente: (clientId: string, tagIds: string[]) =>
    post<{ ok: true }>(`/clients/${clientId}/tags`, { tagIds }),

  /**
   * O ritual mensal de todos os clientes — F5.3.
   *
   * Fala em MÊS, e não em intervalo como o painel: o que se planeja e se aprova
   * é o contrato do mês.
   */
  planejamento: (month: string) =>
    get<{ ok: true; month: string; clients: unknown[] }>(
      `/planning?month=${encodeURIComponent(month)}`,
    ),

  /**
   * O mês cliente a cliente, para a aba Semana do Planejamento — F35.
   *
   * O servidor devolve o mês cru (cota, peças com dia, responsáveis); dividir
   * em semanas e julgar o risco é da tela, que sabe o "hoje" de quem olha.
   */
  planejamentoSemanal: (month: string) =>
    get<{ ok: true; month: string; clients: unknown[] }>(
      `/planning/weeks?month=${encodeURIComponent(month)}`,
    ),

  /* --- mural e captação (F4.10) --- */

  mural: (clientId: string) => get<{ ok: true; notes: unknown[] }>(`/clients/${clientId}/mural`),

  criarNota: (clientId: string, entrada: unknown) =>
    post<{ ok: true; id: string }>(`/clients/${clientId}/mural`, entrada),

  /**
   * Atualização PARCIAL, de propósito.
   *
   * Arrastar um post-it grava só a posição. Mandar o conteúdo junto
   * sobrescreveria o que outra pessoa acabou de escrever na mesma nota.
   */
  salvarNota: (notaId: string, campos: Record<string, unknown>) =>
    patch<{ ok: true }>(`/mural/${notaId}`, campos),

  excluirNota: (notaId: string) => del<{ ok: true }>(`/mural/${notaId}`),

  captacoes: (clientId: string) =>
    get<{ ok: true; captures: unknown[] }>(`/clients/${clientId}/captures`),

  criarCaptacao: (clientId: string, entrada: unknown) =>
    post<{ ok: true; id: string }>(`/clients/${clientId}/captures`, entrada),

  salvarCaptacao: (id: string, entrada: unknown) => put<{ ok: true }>(`/captures/${id}`, entrada),

  excluirCaptacao: (id: string) => del<{ ok: true }>(`/captures/${id}`),

  /**
   * `nome` entrou na F17.29: é o nome que a pessoa confirmou ou corrigiu. Vai
   * vazio quando ela não mexeu em nada e o convite é antigo — e aí vale a
   * sugestão guardada no convite. Vazio nunca é parede.
   *
   * `senhaDefinida` diz se a senha digitada aqui passou a valer — F17.39.
   *
   * Quase sempre sim: conta nova nasce com ela, e quem já tinha conta recebe um
   * convite que a define. Falso só no caminho da F17.30 — convite comum sobre
   * conta que já existe —, e aí a pessoa continua entrando com a senha de
   * sempre. Sem este sinal a tela prometeria uma troca que não aconteceu, que
   * foi o que prendeu duas pessoas do lado de fora.
   */
  ativar: (email: string, code: string, password: string, nome = '') =>
    post<{ ok: true; email: string; senhaDefinida?: boolean }>('/auth/activate', {
      email,
      code,
      password,
      nome,
    }),

  /**
   * O acesso vai JUNTO com o convite — F14d.
   *
   * Quem convida e quem esta com o cracha: nao ha mais  no corpo. Um
   * id de outra pessoa ali faria o convite sair no nome dela.
   */
  convidar: (
    email: string,
    nome: string,
    acesso: { papel: string; areas: string[]; empresas: string[] },
  ) =>
    post<{ ok: true; code: string; expiresAt: string }>('/admin/invitations', {
      email,
      nome,
      ...acesso,
    }),

  /* --- o quadro do Pilar B (F17.9a) --- */

  /*
   * ⚠️ `arvoreDoQuadro()` SAIU DAQUI — F17.CARGA03, e a ausência é a entrega.
   *
   *   Ela pedia `GET /board/tree` (a view `tree`, só lista viva, ~520 ms) e
   *   tinha UM consumidor: a ficha da tarefa, que a buscava ao MONTAR para
   *   alimentar um menu de "mover de lista" que nasce fechado. Toda abertura de
   *   tarefa pagava uma árvore inteira por um balão que quase nunca abre.
   *
   *   A conferência de equivalência da fase 3 deu EXATA — `readFullTree` traz
   *   `list_is_live` de um `left join` com a MESMA view que `readTree` filtra —,
   *   então o menu passou a derivar os destinos da árvore compartilhada, com
   *   `paraNavegacao(buildFullTree(linhas))`. Ver o cabeçalho de
   *   `@/board/arvore-compartilhada`.
   *
   *   ⚠️ A ROTA CONTINUA NO WORKER, E ISTO NÃO É SOBRA. `scripts/medir-a-carga`,
   *   `scripts/provar-quadro` e outros cinco a medem e a provam por HTTP direto,
   *   sem passar por este módulo. O que sumiu foi a chamada da TELA — e o
   *   método some junto para ninguém a reabrir por engano.
   */

  /**
   * Uma lista: a esteira resolvida e os cartões.
   *
   * A descrição das tarefas NÃO vem junto — só o booleano de "tem descrição".
   * Ver o cabeçalho de `server/board.ts`.
   */
  quadroDaLista: (listId: string, porColuna?: number, filtro?: FiltroDeTarefas) =>
    getBoard<{ ok: true; board: unknown }>(
      /* `per-column` — F17.50. Ausente, o servidor usa o padrão dele; quem
         apertou `Mostrar mais` manda a janela maior.
         `busca` e `responsavel` — F17.55, pelo mesmo caminho. */
      `/board/lists/${listId}${comFiltro(filtro, porColuna)}`,
    ),

  /**
   * O QUADRO DA PASTA — todos os clientes juntos. F17.64.
   *
   * A MESMA forma de `quadroDaLista`, e isso não é preguiça: `per-column`,
   * `busca` e `responsavel` significam aqui o que significam lá, então o
   * endereço de um quadro filtrado se lê igual nos dois.
   *
   * O que volta NÃO é um `Board`: as colunas são NOMES DE ETAPA, e não status.
   * Ver `@/board/quadro-da-pasta`.
   */
  quadroDaPasta: (folderId: string, porColuna?: number, filtro?: FiltroDeTarefas) =>
    getBoard<{ ok: true; board: unknown }>(`/board/folders/${folderId}${comFiltro(filtro, porColuna)}`),

  /**
   * Mover o cartão de coluna ou de lista.
   *
   * Chama `ideworks.move_task`, que troca lista e status na mesma escrita. A
   * resposta diz o que FICOU, e não o que se pediu: o banco pode reposicionar.
   *
   * `null` preserva a etapa equivalente na lista de destino. Sem equivalente,
   * a resposta 409 pede uma escolha antes de mover. Um ID explícito representa
   * a coluna escolhida; `origem` confere o estado visto na janela.
   */
  moverTarefaNoQuadro: (taskId: string, listId: string, statusId: string | null, origem?: OrigemDoMovimento) =>
    post<{
      ok: true;
      move: {
        taskId: string;
        listId: string;
        statusId: string;
        previousStatusId: string | null;
        statusRepositioned: boolean;
        /**
         * Quantas subtarefas foram JUNTO — F17.15.
         *
         * `move_task` move a subárvore inteira na mesma escrita: mover só a mãe
         * seria recusado pela cascata da chave estrangeira batendo no guarda do
         * status. Levar cinco subtarefas sem dizer nada seria invisível.
         */
        subtasksMoved: number;
        /**
         * A automação da etapa de chegada, quando havia uma — F17.41.
         *
         * Nula na esmagadora maioria das mudanças de etapa. Vem preenchida para
         * a tela DIZER que a tarefa se mexeu sozinha: sem isso o cartão sai da
         * coluna debaixo do dedo de quem arrastou e nada explica por quê.
         */
        automation: AutomacaoQueRodou | null;
      };
    }>(`/board/tasks/${taskId}/move`, { listId, statusId, ...(origem ? { origem } : {}) }),

  /* --- `Meu trabalho` e `Todas as tarefas` (F17.18) --- */

  /**
   * O que me diz respeito: atribuído a mim, ou criado por mim com responsável.
   *
   * SEM ARGUMENTO, é a leitura de sempre: a rede grossa (teto 500), e quem
   * decide em qual das três abas cada linha cai é `abaDaLinha`, em
   * `@/board/meu-trabalho`. Os campos novos vêm ausentes.
   *
   * COM `aba`, é a página — F17.AUD05: o servidor filtra a aba ANTES do teto,
   * usando a MESMA tabela de que `abaDaLinha` deriva, e devolve um lote (até
   * 100) com as contagens das três abas contadas no banco inteiro. `total` é
   * a contagem da aba, NUNCA `rows.length`; `returned` é o que veio neste
   * lote; `hasMore` e `nextCursor` dizem como continuar. O cursor é opaco: a
   * tela guarda e devolve, e não lê nem monta. `limite` acima de 100 vira 100.
   *
   * A tela migra para a página na AUD06; até lá ela chama sem argumento.
   */
  meuTrabalho: (pagina?: { aba: Aba; cursor?: string | null; limite?: number }) => {
    const p = new URLSearchParams();
    if (pagina !== undefined) {
      p.set('aba', pagina.aba);
      if (pagina.cursor) p.set('cursor', pagina.cursor);
      if (pagina.limite !== undefined) p.set('limite', String(pagina.limite));
    }
    const cauda = p.toString();
    return get<{
      ok: true;
      work: {
        rows: unknown[];
        total: number;
        capped: boolean;
        /* --- só com `aba` --- */
        aba?: Aba;
        counts?: Record<Aba, number>;
        returned?: number;
        hasMore?: boolean;
        nextCursor?: string | null;
      };
    }>(`/board/my-tasks${cauda === '' ? '' : `?${cauda}`}`);
  },

  /**
   * Tudo o que a pessoa alcança — o histórico, em lista ou em quadro.
   *
   * `total` NÃO é o comprimento de `rows`: a leitura tem teto, e sem a conta
   * separada a tela diria "500 tarefas" para sempre em vez de "500 de 3.120".
   */
  todasAsTarefas: (filtro?: FiltroDeTarefas) =>
    get<{
      ok: true;
      work: {
        rows: unknown[];
        total: number;
        matched: number;
        capped: boolean;
        assigneeOptions: BoardAssigneeOption[];
        unassignedTasks: number;
      };
    }>(`/board/all-tasks${comFiltro(filtro)}`),

  /**
   * As tarefas de um espaço, pasta ou lista, paginadas — F18A (R09).
   *
   * O MESMO universo para Lista e Kanban: `counts` e `statusCounts` são do
   * recorte inteiro e voltam a cada lote; `returned` é o lote. `catalog`
   * (menus e fluxos com as etapas reais) só vem na primeira página. O cursor
   * é opaco: guarde `nextCursor` e devolva. `sinal` cancela a leitura antiga.
   */
  tarefasDoEscopo: (pedido: PedidoDoEscopo, sinal?: AbortSignal) =>
    getBoard<{ ok: true; tasks: TarefasDoEscopo }>(enderecoDoEscopo(pedido), sinal),

  /* --- a caixa de entrada (F17.46) --- */

  /**
   * O que chegou para mim — e ainda não vi.
   *
   * O aviso NÃO é uma linha gravada: ele é lido de `task_events` (a tarefa que
   * a automação passou) e do prazo da tarefa. Por isso não há `id` aqui, e sim
   * `key` — um texto opaco que só serve para dizer qual aviso foi marcado. A
   * tela o devolve como veio, sem nunca o interpretar.
   *
   * Com `vistos`, a caixa traz também o que já foi marcado — é o que permite
   * DESMARCAR. Sem a volta, um toque errado apagaria para sempre o único lugar
   * que diz "isto chegou para você".
   */
  avisos: (vistos = false) =>
    get<{ ok: true; notices: { notices: Aviso[]; unread: number; capped: boolean } }>(
      `/board/notices${vistos ? '?vistos=1' : ''}`,
    ),

  /**
   * Só o número, para a pastilha da barra lateral.
   *
   * Chamada própria porque ela roda em toda tela que desenha a barra: trazer a
   * caixa inteira para escrever um algarismo seria pagar a leitura toda por
   * nada.
   */
  contarAvisos: () => get<{ ok: true; unread: number }>('/board/notices/count'),

  pessoasParaMencionar: (alvo: {
    taskId?: string | null;
    listId?: string | null;
    conversationId?: string | null;
  }) => {
    if (alvo.conversationId) {
      return get<{ ok: true; people: { id: string; name: string }[] }>(
        `/chat/conversations/${encodeURIComponent(alvo.conversationId)}/mentionable`,
      );
    }
    return get<{ ok: true; people: { id: string; name: string }[] }>(
      `/board/mentionable?${alvo.taskId ? `task=${encodeURIComponent(alvo.taskId)}` : `list=${encodeURIComponent(alvo.listId ?? '')}`}`,
    );
  },

  /**
   * Marcar como visto, ou desmarcar — e a caixa RELIDA volta junto.
   *
   * O visto é POR PESSOA: dois leitores do mesmo fato não brigam pelo mesmo
   * registro, e `task_events` continua sem `update` e sem `delete`.
   */
  marcarAviso: (key: string, read: boolean, vistos = false) =>
    post<{ ok: true; notices: { notices: Aviso[]; unread: number; capped: boolean } }>(
      `/board/notices/read${vistos ? '?vistos=1' : ''}`,
      { key, read },
    ),

  /* --- a ficha da tarefa (F17.10) --- */

  /**
   * A tarefa inteira — com a descrição, que o cartão do quadro não traz.
   *
   * Vem junto o que a ficha precisa para os seletores: a esteira da lista, as
   * etiquetas e os tipos do ESPAÇO. Buscar cada um numa chamada daria quatro
   * idas ao servidor para abrir uma tarefa.
   */
  tarefaDoQuadro: (taskId: string) =>
    get<{
      ok: true;
      task: unknown;
      /**
       * Se o envio de arquivo está de pé — F17.6.
       *
       * O balde é privado e os bytes só passam pela chave de serviço no
       * servidor. A tela precisa saber ANTES de desenhar `📎 Anexar arquivo`:
       * um botão que aceita o arquivo, sobe 20 MB e então responde 503 é botão
       * morto com o agravante de gastar o envio.
       *
       * O servidor diz SE a credencial existe, e nunca qual é — mesmo desenho
       * de `hasToken` em `GET /meta/health`.
       */
      storage?: { ready: boolean; variable: string };
    }>(`/board/tasks/${taskId}`),

  /**
   * QUEM SE PODE PÔR COMO RESPONSÁVEL NESTA TAREFA — F17.69.
   *
   * ⚠️ SÓ QUANDO O MENU ABRE, e nunca junto do quadro. O quadro da pasta está
   * em 379 ms (F17.74) porque a política de `task_assignees` cobra uma pergunta
   * de alcance POR LINHA (F17.3); pendurar esta lista no carregamento
   * multiplicaria isso por cartão. Aqui é uma tarefa, no clique.
   *
   * A lista já vem estreitada por tarefa: quem eu posso oferecer (F17.53) E que
   * alcança a empresa DAQUELA tarefa (F17.41). `assigned` diz quem já está —
   * vem do banco, e não do que o quadro trouxe, porque entre o carregamento e o
   * clique alguém pode ter mexido pela ficha.
   *
   * Lista VAZIA não é erro: é a recusa da tarefa fora do alcance, dita em voz
   * baixa. Quem escreve continua sendo `salvarTarefaDoQuadro`.
   */
  pessoasAtribuiveis: (taskId: string) =>
    get<{
      ok: true;
      people: { id: string; name: string; assigned: boolean }[];
      /** Quem está olhando — `Eu` no topo do seletor, como na ficha (F17.10b). */
      me: string;
    }>(`/board/tasks/${taskId}/assignable`),

  /** Criar tarefa na lista — o `+ Adicionar tarefa` e o formulário completo. */
  criarTarefaNoQuadro: (listId: string, entrada: unknown) =>
    post<{ ok: true; id: string; task: unknown }>(`/board/lists/${listId}/tasks`, entrada),

  /**
   * Os clientes que o seletor oferece para esta lista — F38, Fase 7.
   * Ativos, ao alcance e da empresa da lista. Pedido ao abrir o seletor.
   */
  clientesDaLista: (listId: string) =>
    get<{ ok: true; clients: { id: string; name: string }[] }>(
      `/board/lists/${listId}/client-options`,
    ),

  /**
   * Trocar o cliente da tarefa — F38, Fase 7. `null` é "o da lista" (lista de
   * cliente) ou "interna, sem cliente" (lista interna). A resposta é a ficha
   * relida.
   */
  trocarClienteDaTarefa: (taskId: string, clientId: string | null) =>
    put<{ ok: true; task: unknown }>(`/board/tasks/${taskId}/client`, { clientId }),

  /**
   * Salvar o que MUDOU na ficha.
   *
   * `PATCH`, e campo ausente é campo não mexido: mandar tudo sempre apagaria o
   * prazo do ano 82025 a cada salvamento, porque o campo nativo de data não
   * sabe mostrá-lo e devolve vazio.
   *
   * A resposta é a ficha RELIDA, e não o que se pediu — `set_task_assignees`
   * ignora em silêncio quem não tem perfil, e o gatilho carimba a conclusão
   * sozinho.
   */
  salvarTarefaDoQuadro: (taskId: string, mudou: unknown) =>
    patch<{ ok: true; task: unknown }>(`/board/tasks/${taskId}`, mudou),

  concluirTarefaDoQuadro: (taskId: string, concluida: boolean) =>
    concluida
      ? post<{ ok: true; task: unknown }>(`/board/tasks/${taskId}/completion`, {})
      : del<{ ok: true; task: unknown }>(`/board/tasks/${taskId}/completion`),

  arquivarTarefaDoQuadro: (taskId: string, arquivada: boolean) =>
    arquivada
      ? post<{ ok: true; task: unknown }>(`/board/tasks/${taskId}/archive`, {})
      : del<{ ok: true; task: unknown }>(`/board/tasks/${taskId}/archive`),

  /** Etiqueta nova no espaço. `task_tags` está vazia — alguém precisa começar. */
  criarEtiquetaDoEspaco: (
    spaceId: string,
    entrada: { name: string; bgColor: string | null; fgColor: string | null },
  ) => post<{ ok: true; tag: unknown }>(`/board/spaces/${spaceId}/tags`, entrada),

  /* --- criar e editar a árvore (F17.14) --- */

  /**
   * A árvore INTEIRA que a pessoa alcança — com o vazio e com o arquivado.
   *
   * Não é a mesma coisa que `arvoreDoQuadro`. Aquela parte da view `tree`, que
   * começa em `lists`, e por isso não sabe representar espaço sem lista, pasta
   * sem lista, nem nada arquivado — que é justamente o que esta etapa cria e
   * desarquiva. Ver o cabeçalho de `server/tree.ts`.
   *
   * ⚠️ UMA LEITURA PARA TODAS AS TELAS desde a F17.CARGA02. Ela era refeita ao
   * montar cada uma das dezessete telas que desenham a barra — a dívida 3 da
   * F17.67. Agora quem a pede é `useArvoreCompleta`, em `@/board/arvore-compartilhada`,
   * e as telas dividem a mesma resposta enquanto ela valer.
   */
  arvoreCompleta: (sinal?: AbortSignal) =>
    getBoard<{ ok: true; companies: unknown[]; spaces: unknown[] }>('/board/tree/full', sinal),

  /**
   * Espaço novo — e a esteira dele, na mesma escrita. Só administrador.
   *
   * `esteira` foi acrescentado na F17.16: é o MOLDE escolhido na criação
   * (`Conteúdo`, `Vídeo`, `ADS`, `Demanda`, `Simples`). Sem ele o Worker cai na
   * esteira padrão de dois estados — espaço nunca nasce sem esteira, porque a
   * primeira lista dentro dele abriria um quadro sem coluna nenhuma.
   */
  criarEspaco: (
    categoryId: string,
    name: string,
    esteira?: { name: string; statuses: readonly { name: string; type: string; color: string }[] },
  ) =>
    post<{ ok: true; space: { id: string; name: string } }>('/board/spaces', {
      categoryId,
      name,
      ...(esteira ? { workflowName: esteira.name, statuses: esteira.statuses } : {}),
    }),

  editarEspaco: (spaceId: string, mudou: { name?: string; archived?: boolean }) =>
    patch<{ ok: true; space: { id: string; name: string } }>(
      `/board/spaces/${spaceId}`,
      mudou,
    ),

  criarPasta: (spaceId: string, name: string) =>
    post<{ ok: true; folder: { id: string; name: string } }>(
      `/board/spaces/${spaceId}/folders`,
      { name },
    ),

  lerEsteiraDaPasta: (id: string) => get<{
    ok: true; name: string; statuses: import('@/board/arvore').StatusEmEdicao[];
    originals: import('@/board/arvore').StatusEmEdicao[];
    revision: string; lists: number; archived: number; tasks: number;
  }>(`/board/folders/${id}/workflow`),
  aplicarEsteiraDaPasta: (id: string, input: {
    name: string; statuses: readonly import('@/board/arvore').StatusEmEdicao[];
    destinos: readonly { de: string; para: string }[]; revision: string;
  }) => post<{ ok: true; lists: number; moved: number }>(`/board/folders/${id}/workflow`, input),

  reordenarLista: (id: string, direction: 'up' | 'down' | 'first' | 'last') =>
    post<{ ok: true }>(`/board/lists/${id}/order`, { direction }),

  editarPasta: (folderId: string, mudou: { name?: string; archived?: boolean }) =>
    patch<{ ok: true; folder: { id: string; name: string } }>(
      `/board/folders/${folderId}`,
      mudou,
    ),

  /**
   * Lista nova. `folderId` nulo é a lista SOLTA no espaço — e ela existe.
   *
   * `esteira` foi acrescentado na F17.16, e aqui a AUSÊNCIA dela significa
   * herdar — que continua sendo o padrão. Com molde, a lista nasce com a esteira
   * própria na MESMA transação: uma lista `Vídeo` que existisse com as duas
   * colunas herdadas seria pior que nenhuma lista.
   */
  criarLista: (
    spaceId: string,
    entrada: {
      name: string;
      folderId: string | null;
      esteira?: {
        name: string;
        statuses: readonly { name: string; type: string; color: string }[];
      } | null;
    },
  ) =>
    post<{ ok: true; list: { id: string; name: string } }>(`/board/spaces/${spaceId}/lists`, {
      name: entrada.name,
      folderId: entrada.folderId,
      ...(entrada.esteira
        ? { workflowName: entrada.esteira.name, statuses: entrada.esteira.statuses }
        : {}),
    }),

  /**
   * Os clientes ao alcance para trazer a este espaço — F17.43 / F17.83.
   *
   * Quem já tem lista AQUI continua na lista, com `listCountInSpace`. Trazer
   * de novo cria outra lista — a unicidade por espaço saiu na F17.83. A
   * contagem vem nesta mesma leitura; a tela não soma de novo.
   */
  clientesParaTrazer: (spaceId: string) =>
    get<{
      ok: true;
      clients: { id: string; name: string; active: boolean; listCountInSpace: number }[];
    }>(`/board/spaces/${spaceId}/client-lists`),

  /**
   * Trazer clientes: uma lista por cliente, COM o vínculo.
   *
   * O nome não viaja — ele é lido do cliente na mesma transação em que a lista
   * nasce. Mandar daqui faria uma aba velha criar a lista com o nome antigo.
   */
  trazerClientes: (
    spaceId: string,
    entrada: { folderId: string | null; clientIds: readonly string[] },
  ) =>
    post<{ ok: true; created: { id: string; name: string; clientId: string }[] }>(
      `/board/spaces/${spaceId}/client-lists`,
      entrada,
    ),

  /**
   * Renomear, arquivar e MOVER a lista.
   *
   * `spaceId` e `folderId` viajam JUNTOS: `lists_folder_same_space_fk` é chave
   * composta, e mandar um sem o outro é um estado que o banco recusa.
   */
  editarLista: (
    listId: string,
    mudou: {
      name?: string;
      content?: string | null;
      archived?: boolean;
      spaceId?: string;
      folderId?: string | null;
      /** A marca "exige cliente" — F38, Fase 7. Só administrador. */
      requiresClient?: boolean;
    },
  ) => patch<{ ok: true; list: { id: string; name: string } }>(`/board/lists/${listId}`, mudou),

  /** Excluir de vez uma lista JÁ ARQUIVADA, com as tarefas dela. */
  excluirLista: (listId: string) => del<{ ok: true; tasks: number }>(`/board/lists/${listId}`),

  /**
   * Dar à lista uma esteira própria, ou mexer na que ela já tem.
   *
   * `destinos` só é preenchido na SEGUNDA tentativa: quando a primeira volta com
   * `409` e a lista de etapas que ficaram sem destino (F17.19), a tela pergunta
   * para onde vão as tarefas e manda de novo com a resposta.
   */
  esteiraDaLista: (
    listId: string,
    entrada: {
      name: string;
      statuses: readonly { id?: string; name: string; type: string; color: string }[];
      destinos?: readonly { de: string; para: string }[];
    },
  ) =>
    post<{ ok: true; statusSetId: string; moved: number; inheritedBefore: boolean }>(
      `/board/lists/${listId}/workflow`,
      entrada,
    ),

  /** Voltar a herdar: a lista perde a esteira própria e resolve pela pasta ou pelo espaço. */
  herdarEsteiraDaLista: (listId: string) =>
    del<{ ok: true }>(`/board/lists/${listId}/workflow`),

  /** Os destinos da aprovação do cliente na esteira desta lista (F42, Fase 3). Só admin. */
  destinosDaAprovacao: (listId: string) =>
    get<{ ok: true; approval: DestinosDaEsteira }>(`/board/lists/${listId}/approval-targets`),

  /** Grava os três destinos (nulo = ainda não escolhido) na esteira resolvida da lista. */
  gravarDestinosDaAprovacao: (listId: string, destinos: Destinos) =>
    put<{ ok: true; approval: DestinosDaEsteira }>(`/board/lists/${listId}/approval-targets`, destinos),

  /* --- "Solicitar aprovação" no card (F42, Fase 4) --- */

  /** A seção da ficha: cliente ligado, esteira com os três destinos, rodadas. */
  aprovacaoDoCard: (taskId: string) =>
    get<{ ok: true; approval: AprovacaoDoCard }>(`/board/tasks/${taskId}/approval-rounds`),

  /**
   * Envia a chamada com os materiais na ordem do carrossel — link do Dropbox ou
   * arte anexada ao card (F42, Fase 9); o card vai para "aguardando cliente".
   */
  solicitarAprovacao: (taskId: string, materiais: EntradaDoMaterial[]) =>
    post<{
      ok: true;
      roundId: string;
      version: number;
      superseded: number;
      approval: AprovacaoDoCard;
      task: unknown;
    }>(`/board/tasks/${taskId}/approval-rounds`, { materiais }),

  /* --- as automações da etapa (F17.41) --- */

  /**
   * As regras desta lista: quando a tarefa chega em tal etapa, faça isto.
   *
   * Quem EXECUTA a regra não é rota nenhuma: é `ideworks.move_task`, na mesma
   * escrita em que troca lista e status. Estas três rotas só configuram.
   */
  automacoesDaLista: (listId: string) =>
    get<{ ok: true; automations: Automacao[] }>(`/board/lists/${listId}/automations`),

  /** Grava — `id` nulo cria, preenchido muda. O banco recusa o que não pode. */
  salvarAutomacao: (listId: string, entrada: AutomacaoEmEdicao) =>
    post<{ ok: true; automation: Automacao }>(`/board/lists/${listId}/automations`, entrada),

  /** Apaga a regra. O registro do que ela já fez continua na tarefa. */
  apagarAutomacao: (automationId: string) =>
    del<{ ok: true }>(`/board/automations/${automationId}`),

  /* --- quem alcança cada nó da árvore (F17.23) --- */

  /**
   * Quem alcança este espaço, pasta ou lista — e em que nível.
   *
   * A resposta traz três listas diferentes, e a distinção importa:
   *   `grants`      o que está escrito NESTE nó;
   *   `reachers`    quem alcança DE VERDADE, já contando a corrente inteira;
   *   `closedAbove` as paredes acima, para a tela poder dizer por que uma
   *                 concessão dada aqui não surtiu efeito.
   */
  acessoDoNo: (nivel: 'space' | 'folder' | 'list', id: string) =>
    get<{ ok: true; access: AcessoDoNo }>(`/board/access/${nivel}/${id}`),

  /** Fechar ou abrir o nó e trocar a lista de quem alcança — numa escrita só. */
  salvarAcessoDoNo: (
    nivel: 'space' | 'folder' | 'list',
    id: string,
    entrada: { restricted: boolean; grants: readonly { userId: string; level: NivelDeAcesso }[] },
  ) => put<{ ok: true; access: AcessoDoNo }>(`/board/access/${nivel}/${id}`, entrada),

  /* --- os passos da tarefa: subtarefa e checklist (F17.15) --- */

  /**
   * A subtarefa nasce dentro da mãe, e NÃO se manda a lista dela.
   *
   * `ideworks.tasks_parent_guard` copia a lista e o cliente da mãe, e
   * `tasks_parent_same_list_fk` recusa qualquer outra. Mandar a lista daqui
   * seria uma segunda versão da regra.
   */
  criarSubtarefa: (taskId: string, entrada: unknown) =>
    post<{ ok: true; id: string; task: unknown }>(`/board/tasks/${taskId}/subtasks`, entrada),

  /** Prender a uma mãe, ou soltar (`parentId` nulo). Ciclo é recusado pelo banco. */
  definirMaeDaTarefa: (taskId: string, parentId: string | null) =>
    parentId === null
      ? del<{ ok: true; task: unknown }>(`/board/tasks/${taskId}/parent`)
      : put<{ ok: true; task: unknown }>(`/board/tasks/${taskId}/parent`, { parentId }),

  /**
   * Todas as escritas de checklist DEVOLVEM A FICHA RELIDA.
   *
   * Marcar um item muda a contagem, e a contagem sai de
   * `ideworks.task_progress`. Devolver o que se pediu faria a tela mostrar um
   * número que não é o do banco.
   */
  criarChecklist: (taskId: string, name?: string) =>
    post<{ ok: true; task: unknown }>(`/board/tasks/${taskId}/checklists`, { name }),

  renomearChecklist: (checklistId: string, name: string) =>
    patch<{ ok: true; task: unknown }>(`/board/checklists/${checklistId}`, { name }),

  apagarChecklist: (checklistId: string) =>
    del<{ ok: true; task: unknown }>(`/board/checklists/${checklistId}`),

  criarItemDeChecklist: (
    checklistId: string,
    entrada: { name: string; parentItemId?: string | null },
  ) => post<{ ok: true; task: unknown }>(`/board/checklists/${checklistId}/items`, entrada),

  salvarItemDeChecklist: (
    itemId: string,
    mudou: { name?: string; resolved?: boolean; assigneeId?: string | null },
  ) => patch<{ ok: true; task: unknown }>(`/board/checklist-items/${itemId}`, mudou),

  apagarItemDeChecklist: (itemId: string) =>
    del<{ ok: true; task: unknown }>(`/board/checklist-items/${itemId}`),

  /* --- a entrega: comentário, link e anexo (F17.6) --- */

  /**
   * Comentar, ou RESPONDER.
   *
   * A resposta manda `parentId` e NÃO manda a tarefa: `post_task_comment` a
   * tira do comentário respondido. Mandar as duas seria uma segunda versão da
   * regra, e o banco recusa se elas discordarem.
   *
   * O AUTOR também não se manda. Ele é `ideworks.acting_user_id()`, e a
   * política exige que seja quem age — postar em nome de outra pessoa, num
   * sistema onde o comentário É a entrega, seria falsificar a entrega.
   */
  comentarTarefa: (taskId: string, body: string, parentId: string | null = null) =>
    post<{ ok: true; id: string; task: unknown }>(`/board/tasks/${taskId}/comments`, {
      body,
      parentId,
    }),

  /** Só o autor edita. Quem filtra é a política, não esta chamada. */
  editarComentario: (commentId: string, body: string) =>
    patch<{ ok: true; task: unknown }>(`/board/comments/${commentId}`, { body }),

  /** Apagar leva as RESPOSTAS junto, pela cascata — inclusive as de outras pessoas. */
  apagarComentario: (commentId: string) =>
    del<{ ok: true; task: unknown }>(`/board/comments/${commentId}`),

  /**
   * O link externo, ao lado do anexo.
   *
   * `www.dropbox.com/x` entra assim mesmo: o servidor completa o `https://`,
   * porque é assim que a equipe digita e é assim que o comentário real está
   * escrito. O que não é http nem https é recusado no servidor E no banco.
   */
  guardarLink: (taskId: string, entrada: { label: string; url: string }) =>
    post<{ ok: true; id: string; task: unknown }>(`/board/tasks/${taskId}/links`, entrada),

  salvarLink: (linkId: string, mudou: { label?: string; url?: string }) =>
    patch<{ ok: true; task: unknown }>(`/board/links/${linkId}`, mudou),

  apagarLink: (linkId: string) => del<{ ok: true; task: unknown }>(`/board/links/${linkId}`),

  /**
   * Enviar arquivo — a ÚNICA chamada do projeto que não é JSON.
   *
   * `pedir` põe `Content-Type: application/json` em tudo, e um corpo binário
   * com esse cabeçalho chega ao Worker como texto corrompido. Por isso este
   * `fetch` é escrito à mão: o navegador tem que escolher o `Content-Type`
   * sozinho, com a fronteira do `multipart`, e qualquer valor que a gente
   * escrevesse aqui estaria errado.
   *
   * O cookie continua indo por `credentials`, como em todo o resto.
   */
  enviarAnexo: async (taskId: string, arquivo: File, opcoes?: { temporaria: boolean; noTexto?: boolean }) => {
    const forma = new FormData();
    forma.append('arquivo', arquivo, arquivo.name);
    if (opcoes?.temporaria) forma.append('temporaria', 'true');
    if (opcoes?.noTexto) forma.append('noTexto', 'true');

    // A MESMA renovação de `pedir` — F17.62, F17.AUD04. Este caminho não passa
    // por `pedir`, mas passa por `comRenovacao`: um envio de arquivo é
    // justamente o que a pessoa não quer perder na virada da hora, e o
    // veredito (renovada, recusada, indisponível) tem que ser o mesmo daqui.
    const caminho = `/board/tasks/${taskId}/attachments`;
    const enviar = async (): Promise<Response> => {
      try {
        return await fetch(`${BASE}${caminho}`, {
          method: 'POST',
          credentials: 'same-origin',
          body: forma,
        });
      } catch {
        throw temporaria(FALHA_DE_REDE, 0);
      }
    };

    return ler<{ ok: true; id: string; task: unknown }>(await comRenovacao(caminho, enviar));
  },

  /**
   * O endereço assinado, com prazo — pedido NO CLIQUE, e não ao abrir a ficha.
   *
   * Assinar tudo na abertura gastaria uma assinatura por anexo que ninguém vai
   * abrir, e faria uma ficha deixada aberta por dez minutos ter uma pilha de
   * endereços vencidos. Pedir no clique dá sempre um endereço fresco.
   */
  enderecoDoAnexo: (attachmentId: string) =>
    get<{ ok: true; url: string; expiresAt: string; fileName: string; contentType: string }>(
      `/board/attachments/${attachmentId}/url`,
    ),

  apagarAnexo: (attachmentId: string) =>
    del<{ ok: true; task: unknown }>(`/board/attachments/${attachmentId}`),

  /**
   * OS ENDEREÇOS DAS MINIATURAS DO QUADRO, EM UM PEDIDO SÓ — F17.56.
   *
   * A ficha pede um por vez porque lá é UM clique numa lista curta. Aqui são
   * cinquenta cartões que desenham sozinhos, e uma ida por cartão seria
   * cinquenta idas — 17× mais caro do lado do Storage, medido.
   *
   * `POST` não escreve nada: a lista de identificadores é longa demais para
   * caber numa `query string` sem risco de ser cortada por proxy.
   *
   * O mapa que volta pode ter MENOS chaves do que se pediu, e isso é o desenho:
   * o que está fora do alcance de quem pergunta simplesmente não volta.
   */
  enderecosDosAnexos: (ids: readonly string[]) =>
    post<{ ok: true; urls: Record<string, { url: string; expiresAt: string }> }>(
      '/board/attachments/urls',
      { ids },
    ),

  /* --- conexões de agente (F16.9b). Sessão humana; não é token de agente. --- */

  conexoesDaIntegracao: () =>
    get<{
      connections: Array<{
        id: string;
        name: string;
        oauthClientId: string;
        capabilities: string[];
        reach: { companies: string[] | null; clients: string[] | null };
        expiresAt: string | null;
        revokedAt: string | null;
        policyVersion: number;
        live: boolean;
        /** Teto diário de escritas vigente (F21.1); 0 suspende sem revogar. */
        dailyWriteLimit: number;
        /** Quantas escritas a conexão já gastou hoje, no fuso da agência. */
        usedToday: number;
      }>;
      /** Quando a cota do dia vira, no fuso da agência. */
      dayResetsAt: string;
    }>('/integrations/v1/connections'),

  /**
   * Governo da conexão (F21.5a): renomear e mudar o teto diário. Sessão
   * humana e só do dono — um agente não aumenta o próprio teto nem se
   * renomeia. O nome de nascença é o que o cliente OAuth declarou: ele
   * IDENTIFICA, não AUTORIZA.
   */
  ajustarConexaoDaIntegracao: (
    grantId: string,
    mudanca: { name?: string; dailyWriteLimit?: number },
  ) =>
    patch<{
      ok: true;
      connection: {
        id: string;
        name: string;
        dailyWriteLimit: number;
        usedToday: number;
        live: boolean;
      };
      dayResetsAt: string;
    }>(`/integrations/v1/connections/${grantId}`, mudanca),

  emitirCredencialDaIntegracao: (grantId: string) =>
    post<{ secret: string; credentialId: string; grantId: string }>(
      `/integrations/v1/connections/${grantId}/credentials`,
      {},
    ),

  revogarConexaoDaIntegracao: (grantId: string) =>
    post<{ ok: true; id: string; revokedAt: string | null }>(
      `/integrations/v1/connections/${grantId}/revoke`,
      {},
    ),

  /**
   * Desfazer em lote (F21.2): apaga os comentários publicados por uma
   * concessão. Sem recorte = tudo dela; com `since`/`until` = só a janela.
   * O que o dono não pode apagar fica de pé e volta em `keptComments`.
   */
  desfazerEscritasDaIntegracao: (grantId: string, recorte: { since?: string; until?: string } = {}) =>
    post<{
      ok: true;
      grantId: string;
      undoneAt: string;
      window: { from: string | null; to: string | null };
      examined: number;
      removed: number;
      alreadyGone: number;
      kept: number;
      keptComments: Array<{
        commentId: string;
        executionId: string;
        reason: 'permission_denied' | 'not_found';
        message: string;
      }>;
      /** F26.8 — cada escrita examinada, da mais nova para a mais antiga. */
      items?: Array<{
        executionId: string;
        operation: string;
        targetId: string;
        occurredAt: string;
        status: 'undone' | 'already_gone' | 'skipped' | 'not_undoable';
        reason: string | null;
        message: string;
        textNotUndone?: string[];
      }>;
      undone?: number;
      skipped?: number;
      notUndoable?: number;
    }>(`/integrations/v1/connections/${grantId}/undo`, recorte),

  execucoesDaIntegracao: () =>
    get<{
      executions: Array<{
        id: string;
        grantId: string;
        grantName: string;
        operation: string;
        targetId: string;
        occurredAt: string;
        origin: string;
        active: boolean;
        undoneAt: string | null;
        result: Record<string, unknown>;
        actedAs: { integrationName?: string; ownerId?: string } | null;
        commentId: string | null;
      }>;
    }>('/integrations/v1/connections/executions'),

  /* ───────────────────────── chat da equipe — F20.5 ───────────────────────── */

  chatConversas: (sinal?: AbortSignal) =>
    get<{
      ok: true;
      conversations: Array<{
        id: string;
        kind: 'general' | 'group' | 'direct';
        name: string | null;
        archivedAt: string | null;
        lastMessage: {
          id: string;
          body: string | null;
          kind: 'person' | 'system' | null;
          authorId: string | null;
          at: string | null;
          deletedAt: string | null;
        } | null;
        unreadCount: number;
        lastReadAt: string | null;
        myRole: 'owner' | 'member' | null;
        peerUserId: string | null;
        peerName: string | null;
        peerIsActive: boolean | null;
        members: Array<{
          id: string;
          name: string;
          role: 'owner' | 'member' | null;
          isActive: boolean;
        }>;
      }>;
    }>('/chat/conversations', sinal),

  chatMensagens: (
    conversationId: string,
    cursor?: { beforeAt: string; beforeId: string } | null,
  ) => {
    const q = new URLSearchParams();
    if (cursor) {
      q.set('beforeAt', cursor.beforeAt);
      q.set('beforeId', cursor.beforeId);
    }
    const cauda = q.toString();
    return get<{
      ok: true;
      messages: Array<{
        id: string;
        conversationId: string;
        authorId: string | null;
        body: string;
        kind: 'person' | 'system';
        createdAt: string;
        editedAt: string | null;
        deletedAt: string | null;
        clientKey: string | null;
      }>;
      /* As reações vivas do mesmo lote — a bolha nasce com o rodapé certo (F24). */
      reactions?: Array<{
        messageId: string;
        actorId: string;
        emoji: string;
        reactedAt: string;
      }>;
    }>(`/chat/conversations/${conversationId}/messages${cauda ? `?${cauda}` : ''}`);
  },

  /** Alterna a minha reação numa mensagem: mesmo emoji remove, outro troca. */
  chatReagir: (messageId: string, emoji: string) =>
    post<{
      ok: true;
      reaction: {
        messageId: string;
        actorId: string;
        emoji: string;
        reactedAt: string;
        removed: boolean;
      };
    }>(`/chat/messages/${messageId}/reactions`, { emoji }),

  chatMudancas: (conversationId: string, since: string) =>
    get<{
      ok: true;
      messages: Array<{
        id: string;
        conversationId: string;
        authorId: string | null;
        body: string;
        kind: 'person' | 'system';
        createdAt: string;
        editedAt: string | null;
        deletedAt: string | null;
        clientKey: string | null;
      }>;
    }>(
      `/chat/conversations/${conversationId}/changes?since=${encodeURIComponent(since)}`,
    ),

  /**
   * O que mudou nas reações de uma conversa desde um instante — reposição
   * depois de ficar offline (F24.4). Vem com a removida (`removed`), que é o
   * que mata a reação fantasma.
   */
  chatReacoesMudadas: (conversationId: string, since: string) =>
    get<{
      ok: true;
      reactions: Array<{
        messageId: string;
        actorId: string;
        emoji: string;
        reactedAt: string;
        removed: boolean;
      }>;
    }>(
      `/chat/conversations/${conversationId}/reactions/changes?since=${encodeURIComponent(since)}`,
    ),

  chatEnviar: (
    conversationId: string,
    body: string,
    clientKey: string,
    imageIds?: readonly string[],
  ) =>
    post<{
      ok: true;
      message: {
        id: string;
        conversationId: string;
        authorId: string | null;
        body: string;
        kind: 'person' | 'system';
        createdAt: string;
        editedAt: string | null;
        deletedAt: string | null;
        clientKey: string | null;
        recipientIds: string[];
      };
    }>(`/chat/conversations/${conversationId}/messages`, {
      body,
      clientKey,
      ...(imageIds && imageIds.length > 0 ? { imageIds: [...imageIds] } : {}),
    }),

  chatEnviarImagem: async (conversationId: string, arquivo: File) => {
    const forma = new FormData();
    forma.append('arquivo', arquivo, arquivo.name);
    const caminho = `/chat/conversations/${conversationId}/images`;
    const enviar = async (): Promise<Response> => {
      try {
        return await fetch(`${BASE}${caminho}`, {
          method: 'POST',
          credentials: 'same-origin',
          body: forma,
        });
      } catch {
        throw temporaria(FALHA_DE_REDE, 0);
      }
    };
    return ler<{ ok: true; id: string }>(await comRenovacao(caminho, enviar));
  },

  enderecosDasImagensDoChat: (ids: readonly string[]) =>
    post<{ ok: true; urls: Record<string, { url: string; expiresAt: string }> }>(
      '/chat/images/urls',
      { ids },
    ),

  enderecoDaImagemDoChat: (imageId: string) =>
    get<{ ok: true; url: string; expiresAt: string; fileName: string; contentType: string }>(
      `/chat/images/${imageId}/url`,
    ),

  chatEditar: (messageId: string, body: string) =>
    patch<{
      ok: true;
      message: {
        id: string;
        conversationId: string;
        authorId: string | null;
        body: string;
        kind: 'person' | 'system';
        createdAt: string;
        editedAt: string | null;
        deletedAt: string | null;
        clientKey: string | null;
      };
    }>(`/chat/messages/${messageId}`, { body }),

  chatApagar: (messageId: string) =>
    del<{
      ok: true;
      message: {
        id: string;
        conversationId: string;
        authorId: string | null;
        body: string;
        kind: 'person' | 'system';
        createdAt: string;
        editedAt: string | null;
        deletedAt: string | null;
        clientKey: string | null;
      };
    }>(`/chat/messages/${messageId}`),

  chatMarcarLida: (conversationId: string, readAt: string) =>
    post<{ ok: true; lastReadAt: string }>(`/chat/conversations/${conversationId}/read`, {
      readAt,
    }),

  chatDiretorio: () =>
    get<{ ok: true; people: Array<{ id: string; name: string }> }>('/chat/directory'),

  /* ───────────────────────── chat — grupos e direta (F20.6) ───────────────── */

  chatCriarGrupo: (name: string, memberIds: string[]) =>
    post<{ ok: true; id: string }>('/chat/conversations/groups', { name, memberIds }),

  chatAbrirDireta: (userId: string) =>
    post<{ ok: true; id: string }>('/chat/conversations/direct', { userId }),

  chatRenomear: (conversationId: string, name: string) =>
    patch<{ ok: true }>(`/chat/conversations/${conversationId}`, { name }),

  chatAdicionarMembro: (conversationId: string, userId: string) =>
    post<{ ok: true }>(`/chat/conversations/${conversationId}/members`, { userId }),

  chatRemoverMembro: (conversationId: string, userId: string) =>
    del<{ ok: true }>(`/chat/conversations/${conversationId}/members/${userId}`),

  chatSair: (conversationId: string) =>
    post<{ ok: true }>(`/chat/conversations/${conversationId}/leave`, {}),

  chatPassarPosse: (conversationId: string, userId: string) =>
    post<{ ok: true }>(`/chat/conversations/${conversationId}/ownership`, { userId }),
};
