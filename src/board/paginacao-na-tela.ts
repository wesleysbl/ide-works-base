/**
 * A PAGINAÇÃO DE `Minhas tarefas`, DO LADO DA TELA — etapa F17.AUD06.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O DEFEITO QUE ESTA PEÇA FECHA (achado 4 da auditoria de 2026-09-09)
 *   O servidor trazia até 500 linhas e a tela separava as abas; a pendente
 *   posterior ao teto sumia, e a aba dizia `Pendente 0`. A AUD05 mudou o
 *   contrato: `api.meuTrabalho({ aba, cursor })` filtra a aba ANTES do teto,
 *   conta cada aba inteira e devolve lotes de 100 com continuação. Este
 *   arquivo é quem consome esse contrato — e é puro, sem React, para se provar
 *   com promessas fora de ordem, como a suíte roda.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * AS SETE FASES, E POR QUE SÃO SETE
 *   `carregando` (nada na tela, primeira página em voo) · `pronto` (há linhas
 *   e há mais) · `carregando-mais` (próximo lote em voo, as linhas FICAM) ·
 *   `fim` (tudo carregado) · `vazio` (o servidor confirmou zero) ·
 *   `erro-inicial` (a primeira falhou, nada na tela) · `erro-ao-carregar-mais`
 *   (um lote seguinte falhou, as linhas ficam). "Não vi" e "não tem" são
 *   imagens diferentes; `carregando` e `vazio` são fases diferentes por isso.
 *   E o erro no meio não apaga o que já foi lido: a pessoa rolou até ali.
 *
 * O ACÚMULO É POR IDENTIDADE, NA ORDEM DE CHEGADA
 *   Cada lote chega na ordem do servidor (`due_on, priority, lower(title),
 *   id`), e a página seguinte continua de onde a anterior parou. Então a ordem
 *   de chegada É a ordenação — basta concatenar. O que se confere é o `id`:
 *   uma tarefa que mude de lugar entre dois pedidos poderia vir duas vezes, e
 *   duas cópias do mesmo cartão é o defeito que "sem duplicata" nomeia.
 *
 * AS CONTAGENS SÃO AS DA PRIMEIRA PÁGINA
 *   A AUD05 anotou o custo: `counts` é uma varredura de `tasks` sob RLS a cada
 *   página. As contagens que a tela mostra saem da primeira página de cada
 *   abertura; as das páginas seguintes são ignoradas. Se um dia o servidor
 *   deixar de mandá-las nas continuações, nada aqui muda. Quem revalida é a
 *   volta de uma ficha, que relê a janela desde a primeira página.
 *
 * DUAS DEFESAS CONTRA A RESPOSTA ERRADA
 *   1. O BILHETE de `@/ui/vez` (F17.AUD01): trocar de aba abre bilhete novo, e
 *      a resposta da aba anterior que chegar depois não passa. `Carregar mais`
 *      é continuação do MESMO recurso (a aba), então usa `reabrir` — a geração
 *      cresce, o recurso não muda, e uma continuação atrasada de `pendente`
 *      com `feito` na tela também não passa.
 *   2. A ABA DA RESPOSTA e a de cada LINHA: mesmo com bilhete válido, uma
 *      página cujo `aba` não é o da tela é descartada, e uma linha que
 *      `abaDaLinha` não classifica na aba pedida também. O servidor deriva o
 *      `where` da mesma tabela que `abaDaLinha` lê, então isso não acontece —
 *      é a rede, não a regra.
 *
 * O PROGRESSO DE LEITURA
 *   `progresso()` diz quantas páginas estão na tela. A tela guarda isso na
 *   entrada de navegação e, ao voltar de uma ficha, chama `abrir(aba,
 *   progresso)`: as páginas são relidas em sequência até cobrir o que havia
 *   (com teto), e só então a rolagem guardada por `LembrarRolagem` encontra a
 *   altura. Reler, e não guardar as linhas: a tarefa que a pessoa acabou de
 *   editar precisa voltar como ficou.
 */

import { type Aba, type WorkRow, abaDaLinha } from '@/board/meu-trabalho';
import { type Bilhete, criarVez, entregar } from '@/ui/vez';

/* ───────────────────────────── os tipos ───────────────────────────── */

export type Fase =
  | 'carregando'
  | 'pronto'
  | 'carregando-mais'
  | 'fim'
  | 'vazio'
  | 'erro-inicial'
  | 'erro-ao-carregar-mais';

/** Um pedido ao servidor: a aba, e de onde continuar (`null` = do começo). */
export type Pedido = { aba: Aba; cursor: string | null };

/** O que uma página traz — a resposta de `api.meuTrabalho({ aba })`, já tipada. */
export type PaginaDoTrabalho = {
  aba: Aba;
  rows: readonly WorkRow[];
  counts: Record<Aba, number>;
  hasMore: boolean;
  nextCursor: string | null;
};

/** Quem vai ao servidor. Injetado: a suíte o dubla com promessas atrasadas. */
export type Leitor = (pedido: Pedido) => Promise<PaginaDoTrabalho>;

/** Quantas páginas estavam na tela — o que se guarda na entrada de navegação. */
export type Progresso = { aba: Aba; paginas: number };

export type EstadoDaPaginacao = {
  aba: Aba;
  fase: Fase;
  /** As linhas da aba, acumuladas, na ordem do servidor, sem repetição. */
  linhas: readonly WorkRow[];
  /**
   * As contagens das três abas, da primeira página desta abertura. `null` até
   * ela chegar — e a tela não escreve zero no lugar: zero é resposta, não
   * ausência. Ao trocar de aba, as contagens anteriores FICAM até as novas
   * chegarem: são os mesmos três números, e piscar `…` neles a cada troca
   * seria ruído.
   */
  counts: Record<Aba, number> | null;
  /** Quantos lotes entraram nesta abertura. */
  paginas: number;
  /** Quantos lotes esta abertura quer — 1, ou o progresso a restaurar. */
  alvo: number;
  hasMore: boolean;
  /** O erro cru do último pedido que falhou. Quem o traduz é a tela. */
  erro: unknown;
};

/**
 * Até quantas páginas a volta de uma ficha relê. Dez páginas são mil tarefas
 * e dez idas ao banco em sequência — acima disso, a pessoa que rolou tanto
 * volta ao começo da janela, e não a uma tela travada relendo.
 */
export const TETO_DA_RESTAURACAO = 10;

export function estadoInicial(aba: Aba): EstadoDaPaginacao {
  return {
    aba,
    fase: 'carregando',
    linhas: [],
    counts: null,
    paginas: 0,
    alvo: 1,
    hasMore: false,
    erro: null,
  };
}

/* ───────────────────────────── o progresso na entrada ───────────────────────────── */

/**
 * Lê o progresso guardado numa entrada de navegação (`location.state`).
 *
 * Tolerante: o estado da entrada vem do navegador, sobrevive ao F5 e pode ter
 * sido escrito por outra versão desta tela. Qualquer forma que não seja a
 * exata vira `null` — e `null` é "começa da primeira página", que é o padrão.
 */
export function lerProgresso(estadoDaEntrada: unknown, abas: readonly Aba[]): Progresso | null {
  if (estadoDaEntrada === null || typeof estadoDaEntrada !== 'object') return null;
  const p = (estadoDaEntrada as { progresso?: unknown }).progresso;
  if (p === null || typeof p !== 'object') return null;
  const { aba, paginas } = p as { aba?: unknown; paginas?: unknown };
  if (typeof aba !== 'string' || !(abas as readonly string[]).includes(aba)) return null;
  if (typeof paginas !== 'number' || !Number.isInteger(paginas) || paginas < 1) return null;
  return { aba: aba as Aba, paginas };
}

/** O par de `lerProgresso`: o que a tela escreve na entrada. */
export function comProgresso(progresso: Progresso): { progresso: Progresso } {
  return { progresso };
}

/* ───────────────────────────── a máquina ───────────────────────────── */

export type PaginacaoNaTela = {
  /**
   * Abre a aba: zera as linhas, abre bilhete novo e lê a primeira página.
   * Com `progresso` da MESMA aba, relê em sequência até cobrir as páginas
   * que havia (até `TETO_DA_RESTAURACAO`). Progresso de outra aba é ignorado.
   */
  abrir(aba: Aba, progresso?: Progresso | null): void;
  /** O próximo lote da mesma aba. Nada acontece sem `hasMore` ou com pedido em voo. */
  carregarMais(): void;
  /** Repete o pedido que falhou — o MESMO cursor, para a mesma aba. */
  tentarDeNovo(): void;
  /**
   * Relê a janela que está na tela SEM esvaziá-la — F43, Fase 7: o card ao
   * lado fechou e a lista não desmontou. Ver o comentário na implementação.
   */
  reler(): void;
  /** A tela foi desmontada: nada que estiver em voo entra. */
  encerrar(): void;
  estado(): EstadoDaPaginacao;
  progresso(): Progresso;
};

export function criarPaginacaoNaTela(opcoes: {
  ler: Leitor;
  aba: Aba;
  aoMudar?: (estado: EstadoDaPaginacao) => void;
}): PaginacaoNaTela {
  const vez = criarVez();
  let estado = estadoInicial(opcoes.aba);
  /** As identidades já na tela — a rede contra a duplicata. */
  let ids = new Set<string>();
  /** De onde o próximo lote continua. Só avança quando um lote ENTRA. */
  let cursor: string | null = null;

  const mudar = (parcial: Partial<EstadoDaPaginacao>) => {
    estado = { ...estado, ...parcial };
    opcoes.aoMudar?.(estado);
  };

  const chegou = (abaPedida: Aba, pagina: PaginaDoTrabalho) => {
    // A segunda defesa (ver o cabeçalho): o bilhete já conferiu a geração;
    // aqui se confere a ABA. Um pedido de outra aba com bilhete válido não
    // existe (`reabrir` só reabre a aba da vez), mas se existir, não entra.
    if (abaPedida !== estado.aba) return;
    // E a página que o servidor devolveu com OUTRA aba é falha, não silêncio:
    // deixá-la de fora sem dizer nada prenderia a tela em "Carregando…".
    if (pagina.aba !== estado.aba) {
      falhou(new Error('A resposta veio de outra aba. Tente de novo.'));
      return;
    }

    const novas: WorkRow[] = [];
    for (const linha of pagina.rows) {
      // Linha que a regra da tela não põe nesta aba não entra: o servidor
      // deriva o `where` da mesma tabela, então isso é rede, não regra.
      if (abaDaLinha(linha) !== estado.aba) continue;
      if (ids.has(linha.id)) continue;
      ids.add(linha.id);
      novas.push(linha);
    }

    const linhas = novas.length === 0 ? estado.linhas : [...estado.linhas, ...novas];
    const haMais = pagina.hasMore && pagina.nextCursor !== null;
    cursor = haMais ? pagina.nextCursor : null;
    const paginas = estado.paginas + 1;

    mudar({
      linhas,
      paginas,
      // As contagens da PRIMEIRA página desta abertura, e só dela. Ver o cabeçalho.
      counts: estado.paginas === 0 ? pagina.counts : estado.counts,
      hasMore: haMais,
      fase: haMais ? 'pronto' : linhas.length === 0 ? 'vazio' : 'fim',
      erro: null,
    });

    // A restauração: enquanto faltar página e houver mais, continua sozinha.
    if (haMais && paginas < estado.alvo) proximo();
  };

  const falhou = (erro: unknown) => {
    mudar({ fase: estado.paginas === 0 ? 'erro-inicial' : 'erro-ao-carregar-mais', erro });
  };

  const pedir = (aba: Aba, deOnde: string | null, bilhete: Bilhete) => {
    void entregar(vez, bilhete, opcoes.ler({ aba, cursor: deOnde }), {
      chegou: (pagina) => chegou(aba, pagina),
      falhou,
    });
  };

  /** O próximo lote, por `reabrir`: continuação do recurso da vez. */
  const proximo = () => {
    const bilhete = vez.reabrir(estado.aba);
    if (bilhete === null) return;
    mudar({ fase: 'carregando-mais', erro: null });
    pedir(estado.aba, cursor, bilhete);
  };

  return {
    abrir(aba, progresso = null) {
      const bilhete = vez.abrir(aba);
      ids = new Set();
      cursor = null;
      const alvo =
        progresso !== null && progresso.aba === aba
          ? Math.min(Math.max(progresso.paginas, 1), TETO_DA_RESTAURACAO)
          : 1;
      estado = { ...estadoInicial(aba), counts: estado.counts, alvo };
      opcoes.aoMudar?.(estado);
      pedir(aba, null, bilhete);
    },

    carregarMais() {
      if (estado.fase !== 'pronto') return;
      proximo();
    },

    tentarDeNovo() {
      if (estado.fase === 'erro-inicial') {
        // A vez continua sendo desta aba: é releitura, não abertura.
        const bilhete = vez.reabrir(estado.aba);
        if (bilhete === null) return;
        mudar({ fase: 'carregando', erro: null });
        pedir(estado.aba, null, bilhete);
        return;
      }
      // O cursor NÃO avançou com a falha: `proximo` repete o mesmo pedido.
      if (estado.fase === 'erro-ao-carregar-mais') proximo();
    },

    /*
      A RELEITURA SILENCIOSA — F43, Fase 7.

      `abrir` zera as linhas e relê: é o certo para trocar de aba e para a volta
      da ficha em PÁGINA (a tela remontou, não havia nada para mostrar). Com o
      card ao lado a lista nunca saiu da tela — esvaziá-la para reler faria a
      página encolher, e a rolagem de quem estava no terceiro lote iria ao topo.

      Então: as mesmas páginas, da primeira até quantas havia (com o teto da
      restauração), lidas por fora num rascunho; a tela só troca quando a última
      chega, de uma vez. As contagens são as da primeira, como em toda abertura.

      ⚠️ BILHETE NOVO, MESMA ABA (`abrir`, e depois `reabrir` a cada lote). Um
      gesto no meio — trocar de aba, "Carregar mais" — abre outro bilhete, e a
      releitura morre calada: vale o gesto da pessoa. E ela só começa com a tela
      em repouso (sem pedido no ar e sem erro à vista): com um lote chegando, o
      bilhete novo jogaria fora esse lote e prenderia a fase em "carregando".
      Falhar também é calado: a lista que estava na tela continua lá.
    */
    reler() {
      if (estado.fase !== 'pronto' && estado.fase !== 'fim' && estado.fase !== 'vazio') return;
      const aba = estado.aba;
      const alvo = Math.min(Math.max(estado.paginas, 1), TETO_DA_RESTAURACAO);
      const novas: WorkRow[] = [];
      const vistas = new Set<string>();
      let contagens: Record<Aba, number> | null = null;
      let lidas = 0;

      const pedirLote = (deOnde: string | null, bilhete: Bilhete) => {
        void entregar(vez, bilhete, opcoes.ler({ aba, cursor: deOnde }), {
          chegou: (pagina) => {
            // A tela mudou de aba no meio: o bilhete já teria barrado; isto é cinto.
            if (aba !== estado.aba || pagina.aba !== aba) return;
            for (const l of pagina.rows) {
              if (abaDaLinha(l) !== aba || vistas.has(l.id)) continue;
              vistas.add(l.id);
              novas.push(l);
            }
            if (lidas === 0) contagens = pagina.counts;
            lidas += 1;
            const haMais = pagina.hasMore && pagina.nextCursor !== null;
            if (haMais && lidas < alvo) {
              const proximoBilhete = vez.reabrir(aba);
              if (proximoBilhete !== null) pedirLote(pagina.nextCursor, proximoBilhete);
              return;
            }
            // Chegou tudo: a tela troca de uma vez.
            ids = vistas;
            cursor = haMais ? pagina.nextCursor : null;
            mudar({
              linhas: novas,
              paginas: lidas,
              alvo: lidas,
              counts: contagens ?? estado.counts,
              hasMore: haMais,
              fase: haMais ? 'pronto' : novas.length === 0 ? 'vazio' : 'fim',
              erro: null,
            });
          },
          // A releitura é silenciosa: falhou, fica o que estava na tela.
          falhou: () => {},
        });
      };

      pedirLote(null, vez.abrir(aba));
    },

    encerrar: () => vez.encerrar(),
    estado: () => estado,
    progresso: () => ({ aba: estado.aba, paginas: estado.paginas }),
  };
}
