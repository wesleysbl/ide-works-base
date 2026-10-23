/**
 * A ÁRVORE, UMA VEZ, PARA TODAS AS TELAS — etapa F17.CARGA02.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE ARQUIVO SUBSTITUI
 *
 *   Quatro cópias do mesmo bloco. `Quadro`, `Pasta` e `Espaco` tinham cada uma
 *   o seu `lerArvore` — `api.arvoreCompleta()`, dois `useState`, o `catch` que
 *   manda ao login no 401 e a mesma frase de último caso — e a barra lateral
 *   tinha a quarta, para as outras catorze telas.
 *
 *   Quatro cópias não divergiam por descuido: divergiam porque cada etapa que
 *   mexia numa não tinha por que abrir as outras. `Pasta` guardava a recusa num
 *   estado próprio (`treeError`) e oferecia `Tentar de novo`; `Quadro` misturava
 *   a recusa da árvore com a do quadro no mesmo aviso; a barra engolia a dela
 *   numa linha discreta. Três leituras iguais, três comportamentos diferentes.
 *
 *   E, sobretudo: eram quatro LEITURAS. Ir do quadro à tarefa e voltar pagava a
 *   árvore inteira três vezes — a dívida 3 da F17.67, medida lá em dezessete
 *   telas.
 *
 * ⚠️ E ELA ABSORVEU A OUTRA ÁRVORE — F17.CARGA03
 *   Havia uma SEGUNDA rota, `GET /board/tree`, que partia da view `tree` e por
 *   isso não sabia representar espaço sem lista, pasta sem lista nem nada
 *   arquivado. A ficha da tarefa a buscava ao MONTAR, para um menu de "mover de
 *   lista" que nasce fechado — ~520 ms pagos em toda abertura de tarefa por um
 *   balão que quase nunca abre.
 *
 *   A F17.CARGA03 conferiu a equivalência e a achou EXATA, e a prova não é de
 *   opinião: `readFullTree` traz `list_is_live` de um `left join` com a MESMA
 *   view `ideworks.tree` que `readTree` filtra com `where t.is_live`. Não são
 *   duas contas de "vivo" que precisam concordar — é a mesma coluna, lida por
 *   dois caminhos. E as duas consultas partem de `lists` com o mesmo
 *   `join ideworks.spaces`, sob as mesmas políticas de linha, então a lista que
 *   uma enxerga é exatamente a lista que a outra enxerga.
 *
 *   Por isso o menu da ficha passou a derivar os destinos desta leitura, com
 *   `paraNavegacao(buildFullTree(linhas))` — a ponte que `@/board/arvore` já
 *   mantinha para `Quadro` e `Pasta`. A rota continua no Worker (os scripts de
 *   medição a usam); o que sumiu foi a chamada da tela.
 *
 * O 401 MORA AQUI, E NÃO EM CADA TELA
 *   As quatro cópias faziam o mesmo `window.location.replace('/')`. Fazer isso
 *   quatro vezes é quatro lugares para uma delas esquecer — e a que esquecesse
 *   mostraria "Não foi possível carregar os espaços" a quem, na verdade, só
 *   precisa entrar de novo.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';

import { type Empresa, type FullTreeRow } from '@/board/arvore';
import { ApiError, api, indisponivel, semSessao } from '@/lib/api';
import { CHAVE_DA_ARVORE, invalidarArvore, useClienteDeConsultas } from '@/lib/consultas';

/** A frase de último caso — a mesma que as quatro cópias tinham, agora uma só. */
const NAO_DEU = 'Não foi possível carregar os espaços.';

/**
 * O vazio ESTÁVEL.
 *
 * `[]` escrito na hora seria um array novo a cada desenho, e `ArvoreDoQuadro`
 * recebe isto como propriedade: bastaria para refazer memórias que dependem
 * dela. O vazio é um só.
 */
const SEM_EMPRESAS: Empresa[] = [];

async function lerArvoreCompleta({
  signal,
}: {
  signal: AbortSignal;
}): Promise<{ linhas: FullTreeRow[]; empresas: Empresa[] }> {
  const r = await api.arvoreCompleta(signal);
  return { linhas: r.spaces as FullTreeRow[], empresas: r.companies as Empresa[] };
}

/**
 * A consulta, do jeito que a tela a pede.
 *
 * Exportada para a suíte poder ligar um observador a ELA — o mesmo objeto que
 * `useArvoreCompleta` entrega ao React —, e não a uma cópia parecida. Um teste
 * que montasse suas próprias opções provaria o teste, não a tela.
 */
export const consultaDaArvore = {
  queryKey: CHAVE_DA_ARVORE,
  queryFn: lerArvoreCompleta,
} as const;

/**
 * O SERVIDOR RECUSOU — e recusa não é falha de rede.
 *
 * ⚠️ A DIFERENÇA ENTRE AS DUAS DECIDE O QUE FICA NA TELA, e ela é o motivo
 *   deste predicado existir:
 *
 *     · falha passageira (rede, 5xx) → a árvore que já está desenhada FICA. É o
 *       comportamento certo: sumir com o mapa porque uma revalidação falhou
 *       seria punir quem não fez nada;
 *     · recusa de acesso (403) → a árvore SOME. `Esta conta está desativada` é
 *       o servidor dizendo que o que está na tela não deveria estar. Mantê-la
 *       visível seria a tela afirmando uma autorização que acabou.
 *
 *   O 401 não passa por aqui: ele já mandou para o login.
 *
 * ⚠️ E ELA SOME DA TELA, SEM SAIR DO CACHE À FORÇA. Tirar a consulta do cache
 *   com um observador vivo faz o gancho reconstruí-la vazia no desenho seguinte,
 *   pedir de novo, levar outro 403 — e recomeçar. Um laço de pedidos contra uma
 *   conta desativada é pior que o defeito que ele consertaria. Como TODA tela
 *   lê a árvore por este gancho, esconder aqui esconde em todas.
 */
const acessoRecusado = (erro: unknown) => erro instanceof ApiError && erro.status === 403;

/** A sessão acabou — a tela vai ao login, e isto não é recusa de árvore. */
export const sessaoAcabou = (erro: unknown): boolean => erro !== null && semSessao(erro);

export type LeituraDaArvore = {
  /** As linhas achatadas, ou `null` enquanto não houve resposta (e na recusa). */
  linhas: FullTreeRow[] | null;
  empresas: Empresa[];
  /** A frase do banco, inteira. `null` quando não há recusa a mostrar. */
  recusa: string | null;
  /** A recusa é passageira: a tela pode oferecer `Tentar de novo`. */
  recuperavel: boolean;
};

/**
 * EM QUE PÉ ESTÁ A LEITURA — F17.CARGA03, e é o que separa três coisas que a
 * barra vinha desenhando como uma só.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O DEFEITO QUE ISTO FECHA, VISTO NUMA CAPTURA DE TELA
 *
 *   `ArvoreDoQuadro` desenha `Nenhum espaço ao seu alcance.` sempre que a lista
 *   de espaços chega vazia — e ela chega vazia ENQUANTO A LEITURA AINDA ESTÁ NO
 *   AR, porque quem monta a árvore converte `linhas === null` em `[]`.
 *
 *   O dono do projeto viu essa frase numa captura e a leu como falta de acesso:
 *   uma frase sobre PERMISSÃO ocupando o lugar de "estou carregando". A tela
 *   afirmava um veredito do servidor antes de o servidor ter dito qualquer
 *   coisa.
 *
 * AS TRÊS SÃO DIFERENTES, E A DIFERENÇA VEM DE `leituraDaArvore`
 *
 *   `carregando` — não há linhas E não há recusa. Ninguém respondeu ainda.
 *                  Esqueleto; nenhuma frase sobre alcance.
 *   `recusada`   — não há linhas E há recusa. O servidor respondeu, e respondeu
 *                  "não". Mensagem, e a tentativa de novo quando for passageira.
 *   `pronta`     — há linhas. Vazio AQUI é vazio de verdade: o servidor
 *                  respondeu bem e não há espaço nenhum.
 *
 * ⚠️ REVALIDAÇÃO QUE FALHOU CONTINUA `pronta`, e é de propósito: as linhas de
 *   antes seguem na tela (`leituraDaArvore` só as apaga na recusa de acesso) e
 *   quem desenha mostra a recusa numa faixa discreta ao lado do mapa, sem
 *   trocá-lo por um esqueleto. Sumir com a árvore porque uma leitura de fundo
 *   tropeçou seria punir quem não fez nada.
 *
 * ⚠️ A SESSÃO VENCIDA CAI EM `carregando`, E ISSO É CERTO. No 401,
 *   `leituraDaArvore` zera a recusa de propósito — quem responde a ele é o
 *   login, e o gancho já está navegando para lá. Um esqueleto no meio do
 *   caminho é neutro; `Nenhum espaço ao seu alcance` seria a tela acusando de
 *   falta de acesso quem só precisa entrar de novo.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export type EstadoDaLeitura = 'carregando' | 'pronta' | 'recusada';

/** Pura, e provada caso a caso — a mesma razão de `leituraDaArvore` ser pura. */
export function comoEstaAArvore(leitura: LeituraDaArvore): EstadoDaLeitura {
  if (leitura.linhas !== null) return 'pronta';
  return leitura.recusa === null ? 'carregando' : 'recusada';
}

export type ArvoreCompartilhada = LeituraDaArvore & {
  /** Em que pé está a leitura — espera, recusa ou resposta. Ver `EstadoDaLeitura`. */
  estado: EstadoDaLeitura;

  /**
   * Releia a árvore AGORA — depois de criar, renomear, arquivar, mover, trocar
   * acesso, ou de qualquer gesto que mexa nas contagens dela.
   *
   * ⚠️ É a mesma releitura para todas as telas montadas: uma chamada, um
   * pedido, e a resposta chega à página e à barra ao mesmo tempo.
   */
  recarregar: () => Promise<void>;
};

/**
 * O QUE A TELA MOSTRA, dada a última resposta e o último erro. Pura.
 *
 * Separada do gancho pela mesma razão de `ondeCabe` e `deveBloquear`: a decisão
 * é onde mora o erro, e aqui ela se prova sem navegador, caso a caso. O que
 * sobra no gancho é fiação.
 */
export function leituraDaArvore(
  dados: { linhas: FullTreeRow[]; empresas: Empresa[] } | undefined,
  erro: unknown,
): LeituraDaArvore {
  // Recusa de acesso não deixa o desenho antigo passar; falha passageira deixa.
  const desenhar = dados === undefined || acessoRecusado(erro) ? null : dados;
  return {
    linhas: desenhar?.linhas ?? null,
    empresas: desenhar?.empresas ?? SEM_EMPRESAS,
    recusa:
      erro === null || erro === undefined || sessaoAcabou(erro)
        ? null
        : erro instanceof ApiError
          ? erro.message
          : NAO_DEU,
    recuperavel: indisponivel(erro),
  };
}

export function useArvoreCompleta(): ArvoreCompartilhada {
  const cliente = useClienteDeConsultas();

  const { data, error } = useQuery(consultaDaArvore, cliente);

  /* Sessão vencida não é recusa de árvore: é a hora de entrar de novo. Num
     efeito, e não no meio do desenho — navegar durante o desenho é o tipo de
     coisa que funciona até o dia em que não funciona. */
  const acabou = sessaoAcabou(error);
  useEffect(() => {
    if (acabou) window.location.replace('/');
  }, [acabou]);

  const recarregar = useCallback(() => invalidarArvore(cliente), [cliente]);

  const leitura = leituraDaArvore(data, error);
  return { ...leitura, estado: comoEstaAArvore(leitura), recarregar };
}
