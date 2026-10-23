/**
 * O motor de coleta — etapa F8.
 *
 * ELE É O PRODUTO, NÃO A INFRAESTRUTURA
 *   A Meta guarda métrica de usuário por 90 dias, demografia por 30 e insight
 *   de story por 24 horas. **O histórico não existe lá — só vai existir se for
 *   nosso.** Coleta perdida é dado perdido para sempre, e não há como buscar
 *   depois.
 *
 *   Por isso o livro de execuções e o alarme nascem aqui, com a primeira
 *   versão. Sem registro de execução, não há como saber que faltou.
 *
 * A FONTE É UMA PORTA
 *   `FonteDaMeta` existe para o motor ser testável sem rede e sem token — a
 *   implementação de verdade fala com o Graph API, e a de teste devolve o que o
 *   teste quiser. É o mesmo padrão de `server/ports.ts`.
 *
 * QUEM ESCREVE É FUNÇÃO COM DONO
 *   As três tabelas de métrica têm RLS ligada e **nenhuma política de
 *   inserção**. A única porta são as funções da migration da F8, e elas recusam
 *   quando há sessão de pessoa declarada.
 */

import {
  type Desfecho,
  type Janela,
  classificarFalha,
  desfechoDaExecucao,
  devePausar,
  janelaDeColeta,
  lerUso,
} from '@/meta/coleta';
import { type Sql, type Tx, comoJson, withActor } from '@/server/db';

/* ─────────────────────────── a porta ─────────────────────────── */

export type DiaOrganico = {
  day: string;
  /** As métricas conhecidas mais `extra` com tudo o que veio junto. */
  metrics: Record<string, number | Record<string, unknown>>;
};

export type DiaDeCampanha = {
  day: string;
  campaignId: string;
  campaignName: string | null;
  metrics: Record<string, number | string | Record<string, unknown>>;
};

/**
 * O que o motor precisa da Meta.
 *
 * Devolve também o cabeçalho de uso, porque o limite da Meta é por CARGA e não
 * por contagem de chamadas (viabilidade 6.4) — e só a resposta sabe quanto
 * custou.
 */
export type FonteDaMeta = {
  organico(
    contaExterna: string,
    janela: Janela,
  ): Promise<{ dias: DiaOrganico[]; usoBruto: string | null }>;

  campanhas(
    contaExterna: string,
    janela: Janela,
  ): Promise<{ dias: DiaDeCampanha[]; usoBruto: string | null }>;

  /** O retrato do público — F9e. Só perfil do Instagram tem. */
  demografia(contaExterna: string): Promise<QuebraDemografica[]>;

  /** As quebras do dia: seguidor vs não seguidor, e por tipo de conteúdo — F9g. */
  quebrasDiarias(contaExterna: string, janela: Janela): Promise<QuebraDiaria[]>;

  /** Cada publicação, individualmente — F9f. */
  publicacoes(contaExterna: string, janela: Janela): Promise<Publicacao[]>;

  /** As campanhas com o OBJETIVO — F10a. Só conta de anúncio. */
  campanhasDetalhe(contaExterna: string): Promise<CampanhaDetalhe[]>;

  /** Os anúncios — o que a equipe chama de criativo — F10a. */
  anuncios(contaExterna: string): Promise<AnuncioDetalhe[]>;

  /** O fato diário por anúncio — F10a. */
  diarioPorAnuncio(contaExterna: string, janela: Janela): Promise<DiaDeAnuncio[]>;
};

export type CampanhaDetalhe = {
  campaignId: string;
  name: string | null;
  /**
   * Cru, como a Meta devolveu.
   *
   * A tradução para família acontece na LEITURA, em `meta/objetivos.ts`.
   * Traduzir aqui congelaria o mapa no momento da coleta — e a Meta ainda está
   * migrando o vocabulário, com as duas gerações convivendo na mesma carteira.
   */
  objective: string | null;
  status: string | null;
  effectiveStatus: string | null;
};

export type AnuncioDetalhe = {
  adId: string;
  campaignId: string | null;
  adsetName: string | null;
  name: string | null;
  creativeId: string | null;
  thumbnailUrl: string | null;
  effectiveStatus: string | null;
  /**
   * A publicacao do Instagram que este anuncio impulsiona — F9n.
   *
   * E o unico jeito de saber que uma publicacao teve entrega paga: a metrica
   * do Instagram ja vem com o pago somado, e nao avisa.
   */
  instagramMediaId: string | null;
  instagramPermalink: string | null;
};

export type DiaDeAnuncio = {
  day: string;
  adId: string;
  campaignId: string | null;
  metrics: Record<string, unknown>;
};

export type Dimensao = 'age' | 'gender' | 'city' | 'country' | 'age_gender';

export type QuebraDiaria = {
  day: string;
  metric: string;
  dimension: string;
  buckets: Record<string, number>;
};

export type QuebraDemografica = {
  dimensao: Dimensao;
  /** `{'25-34': 19696, ...}`, cru como a Meta devolveu. */
  buckets: Record<string, number>;
};

export type Publicacao = {
  mediaId: string;
  productType: 'FEED' | 'REELS' | 'STORY';
  mediaType: string | null;
  permalink: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  postedAt: string | null;
  metrics: Record<string, number>;
};

export type ResultadoDaColeta = {
  runId: string | null;
  janela: Janela;
  desfecho: Desfecho;
  ativosTotal: number;
  ativosOk: number;
  ativosComFalha: number;
  linhasGravadas: number;
  primeiraFalha: string | null;
  /** Verdadeiro quando parou por limite de uso ou pelo relógio, deixando ativos sem visitar. */
  interrompida: boolean;
  /** Nao rodou porque outra coleta ja estava em andamento. Nao e erro. */
  jaEmAndamento?: boolean;
};

type AtivoParaColetar = {
  id: string;
  kind: 'instagram_account' | 'ad_account';
  externalId: string;
  /**
   * O NOME da variável de ambiente com o token que alcança esta conta — nunca
   * o token. Vem da empresa da conta (F7g).
   *
   * Nulo significa "a credencial padrão": conta sem empresa, ou empresa sem
   * credencial própria. O banco não decide isso porque o banco não sabe quais
   * variáveis existem no ambiente.
   */
  secretName: string | null;
};

/**
 * De qual token cada conta precisa — a peça que faz duas empresas conviverem.
 *
 * POR QUE UMA FUNÇÃO, E NÃO UM TOKEN
 *   Cada empresa do grupo tem BM própria, System User próprio e portanto token
 *   próprio. Uma conta da Alma Nove é invisível para o token da Ide, e
 *   vice-versa: não é questão de permissão a mais, é outra credencial.
 *
 *   Devolver `null` é a resposta honesta para "não tenho essa credencial aqui".
 *   Quem chama transforma isso numa falha registrada, e não num token errado
 *   usado por engano — que daria "conta não encontrada" e mandaria todo mundo
 *   procurar o problema na Meta.
 */
export type EscolhaDeFonte = (segredo: string | null) => FonteDaMeta | null;

/**
 * O caso de uma credencial só: script de linha de comando, teste, e o mundo
 * antes da Alma Nove. Existe para esses não precisarem montar um mapa de um
 * item só.
 */
export function umaFonteSo(fonte: FonteDaMeta): EscolhaDeFonte {
  return () => fonte;
}

/**
 * Monta a escolha a partir do ambiente.
 *
 * VARRE O AMBIENTE EM VEZ DE LISTAR AS EMPRESAS
 *   Listar `IDEWORKS_META_TOKEN` e `IDEWORKS_META_TOKEN_ALMA9` no código faria
 *   a terceira empresa exigir uma publicação. Varrendo, ela exige um segredo
 *   novo e uma linha no banco — que é o que a F7g já previu.
 *
 * O PADRÃO É `IDEWORKS_META_TOKEN`
 *   É o nome que existia quando havia um token só, e as 41 contas de produção
 *   apontam para ele. Trocar o padrão renomearia o que já está em uso.
 */
export function credenciaisDoAmbiente(
  env: Record<string, unknown>,
  padrao = 'IDEWORKS_META_TOKEN',
): EscolhaDeFonte {
  const porNome = new Map<string, FonteDaMeta>();
  for (const [nome, valor] of Object.entries(env)) {
    if (!/^IDEWORKS_META_TOKEN[A-Z0-9_]*$/.test(nome)) continue;
    if (typeof valor !== 'string' || valor.trim() === '') continue;
    porNome.set(nome, fonteDaMetaHttp(valor));
  }
  return (segredo) => porNome.get(segredo ?? padrao) ?? null;
}

/**
 * Existe ALGUM token da Meta no ambiente — o geral ou o de qualquer empresa?
 *
 * É a porta do gatilho e da coleta manual. Olhar só `IDEWORKS_META_TOKEN` as
 * deixava paradas num ambiente que tem apenas `IDEWORKS_META_TOKEN_<EMPRESA>`,
 * mesmo com contas dessa empresa na fila. A conta cuja credencial falta continua
 * falhando com o nome do segredo (ver `credenciaisDoAmbiente`).
 */
export function haTokenDaMeta(env: Record<string, unknown>): boolean {
  return Object.entries(env).some(
    ([nome, valor]) =>
      /^IDEWORKS_META_TOKEN[A-Z0-9_]*$/.test(nome) &&
      typeof valor === 'string' &&
      valor.trim() !== '',
  );
}

/* ─────────────────────────── o motor ─────────────────────────── */

/**
 * Quantas contas uma execução automática chega a visitar.
 *
 * É TETO, NÃO META: quem manda é o relógio (`TETO_DE_TEMPO_MS`). Este número só
 * evita puxar uma fila absurda do banco quando o relógio ainda tem folga.
 */
export const CONTAS_POR_EXECUCAO = 12;

/**
 * O orçamento de tempo de uma execução automática.
 *
 * POR QUE O RELÓGIO MANDA, E NÃO A CONTAGEM DE CONTAS
 *   A F9h escolheu doze contas a partir de uma média — 23 segundos por conta.
 *   A média mentiu, porque as contas não custam a mesma coisa: uma conta de
 *   anúncio é uma chamada; um perfil do Instagram é orgânico, mais demografia,
 *   mais quebras, mais uma chamada de insight POR PUBLICAÇÃO.
 *
 *   Medido em 2026-08-20: a primeira execução automática, com lote misto, levou
 *   152 segundos. A segunda, 624. E a terceira nunca terminou — a fila entregou
 *   doze perfis do Instagram seguidos, o pior lote possível.
 *
 * O QUE ACONTECEU DEPOIS, E POR QUE FOI TÃO SILENCIOSO
 *   A execução inteira era UMA transação. Ao ser morta pelo teto da plataforma,
 *   ela desfazia tudo — inclusive a linha do livro de execuções e o avanço de
 *   `last_attempt_at`. Não sobrava rastro. E a batida seguinte, meia hora
 *   depois, pegava exatamente as mesmas doze contas, porque nada tinha
 *   avançado.
 *
 *   Resultado: catorze horas sem coletar nada, sem uma única linha de erro em
 *   lugar nenhum. O registro da falha era desfeito junto com a falha.
 *
 * A CORREÇÃO TEM DUAS PARTES, E PRECISA DAS DUAS
 *   1. Uma transação POR CONTA: o que já foi coletado fica, e a fila avança
 *      mesmo que a execução morra no meio.
 *   2. Este relógio: a execução para SOZINHA antes do teto da plataforma e
 *      registra "parcial". Parar por conta própria é informação; ser morto não
 *      deixa nem rastro.
 *
 *   Quatro minutos, contra o teto de quinze da plataforma. A folga é para a
 *   conta que já começou poder terminar — o relógio é conferido ANTES de cada
 *   conta, nunca no meio de uma.
 */
export const TETO_DE_TEMPO_MS = 4 * 60 * 1000;

/**
 * Quantas paginas se segue por conta, no insight por anuncio.
 *
 * Uma conta da carteira tem 300 anuncios; com uma linha por anuncio por dia em
 * 28 dias, sao milhares de linhas em paginas de 500. Vinte paginas cobrem dez
 * mil linhas, que e mais do que qualquer conta da carteira produz — e ainda
 * assim e teto, porque conta absurda nao pode prender a execucao inteira.
 */
const TETO_DE_PAGINAS = 20;

/** `object_in_use`: o banco recusou porque ja ha coleta rodando. */
const EM_ANDAMENTO = '55006';

/**
 * Grava os dias do orgânico de UMA conta — TODOS, inclusive os antigos que só
 * trazem o alcance.
 *
 * ⚠️ DEPENDE DA MIGRATION F44_1 (`20261009090000_ideworks_f44_1_organico_nao_apaga.sql`)
 *   As métricas de total (views, interações, curtidas, comentários,
 *   compartilhamentos, salvamentos, seguidores ganhos e perdidos…) só se buscam
 *   nos últimos 7 dias (`DIAS_DE_TOTAL_VALUE`), mas o `reach` vem dos 28: o dia
 *   que sai da janela de 7 chega com `{ reach }` só. Antes da F44_1,
 *   `ideworks.upsert_organic_day` regravava a linha com `x = excluded.x` e esse
 *   dia perdia tudo o mais a cada batida — que a Meta só guarda por 90 dias. Com
 *   a F44_1 cada métrica é `coalesce(novo, antigo)` e `extra` junta: o que não
 *   veio fica como estava.
 *
 *   Publicar este código num banco SEM a F44_1 volta a apagar as métricas dos
 *   dias com mais de 7 dias a cada coleta. A migration vai antes.
 *
 * O PALIATIVO QUE SAIU (PR #2, 09/10/2026)
 *   Enquanto o banco apagava, esta função deixava de mandar o dia só de alcance
 *   que já tinha linha. Como o coletor não enxerga as linhas (sem ator, a
 *   política de leitura de `meta_daily_organic` esconde), na prática não mandava
 *   nenhum, e a conta nova ficava sem os 28 dias de alcance. Agora todo dia vai,
 *   e a conta nova volta a recebê-los.
 *
 * Devolve quantas linhas foram gravadas.
 */
export async function gravarDiasOrganicos(
  tx: Tx,
  ativoId: string,
  dias: readonly DiaOrganico[],
): Promise<number> {
  for (const dia of dias) {
    await tx`
      select ideworks.upsert_organic_day(
        ${ativoId}, ${dia.day}, ${comoJson(tx, dia.metrics)}::jsonb)`;
  }
  return dias.length;
}

export async function coletar(
  sql: Sql,
  /**
   * Qual credencial fala com cada conta. Ver `EscolhaDeFonte` — deixou de ser
   * uma fonte só quando a Alma Nove entrou com BM e token próprios (F7g).
   */
  escolherFonte: EscolhaDeFonte,
  agora = new Date(),
  /** Zero varre tudo — é o que o script de linha de comando usa. */
  limite = 0,
  /** Zero desliga o relógio — idem. */
  tetoDeTempoMs = 0,
): Promise<ResultadoDaColeta> {
  const janela = janelaDeColeta(agora);
  const comecou = Date.now();

  /**
   * A fila e o livro, em transações CURTAS e próprias.
   *
   * Nada aqui fica aberto enquanto a coleta trabalha: era isso que segurava
   * lock em `meta_assets` por treze minutos.
   */
  const paraColetar = await withActor(sql, { kind: 'collector' }, async (tx) => {
    // A leitura dos ativos passa por consulta comum porque `meta_assets` tem
    // política de SELECT por cliente — e o coletor não declara ator, então
    // não enxergaria nada. Por isso lê com a função de dono abaixo.
    const ativos = (await tx`
      select id, kind::text as kind, external_id, secret_name
        from ideworks.meta_assets_para_coleta(${limite})`) as unknown as Array<{
      id: string;
      kind: string;
      external_id: string;
      secret_name: string | null;
    }>;

    return ativos
      .filter((a) => a.kind === 'instagram_account' || a.kind === 'ad_account')
      .map(
        (a): AtivoParaColetar => ({
          id: a.id,
          kind: a.kind as AtivoParaColetar['kind'],
          externalId: a.external_id,
          secretName: a.secret_name,
        }),
      );
  });

  /**
   * Abrir o livro é também PEGAR A VEZ.
   *
   * `start_collection_run` recusa quando já há execução em andamento, e recusar
   * aqui é o certo: duas coletas simultâneas pegam exatamente as mesmas contas
   * da fila — nenhuma commitou ainda — e disputam linha por linha até uma morrer
   * com "canceling statement due to lock timeout". Medido em 2026-08-21, com a
   * automática e a manual a 49 segundos de distância.
   *
   * Chegar atrasado não é erro: é a coleta funcionando. Devolve-se uma execução
   * vazia em vez de gritar.
   */
  let runId: string;
  try {
    runId = await withActor(sql, { kind: 'collector' }, async (tx) => {
      const [run] = await tx`
        select ideworks.start_collection_run(${janela.de}, ${janela.ate}) as id`;
      return run.id as string;
    });
  } catch (erro) {
    if ((erro as { code?: string }).code === EM_ANDAMENTO) {
      return {
        runId: null,
        janela,
        desfecho: 'ok',
        ativosTotal: 0,
        ativosOk: 0,
        ativosComFalha: 0,
        linhasGravadas: 0,
        primeiraFalha: null,
        interrompida: true,
        jaEmAndamento: true,
      };
    }
    throw erro;
  }

  let ok = 0;
  let falhos = 0;
  let linhas = 0;
  let primeiraFalha: string | null = null;
  let interrompida = false;

  /**
   * As credenciais que a Meta já recusou NESTA execução, com a frase da recusa.
   *
   * TOKEN VENCIDO É DA CREDENCIAL, NÃO DA EXECUÇÃO
   *   Com um token só, "token inválido" realmente valia para tudo, e o motor
   *   parava. Desde a F7g há um token por empresa (BM e System User próprios):
   *   o da Alma9 vencer não diz nada sobre o da Ide. Parar a execução inteira
   *   faria cada batida terminar na primeira conta da empresa com o token ruim
   *   e deixaria as contas boas da outra esperando horas pela vez.
   *
   *   Então só as contas DA MESMA CREDENCIAL são puladas — sem chamar a Meta, e
   *   falhando com a frase do token, para a tela de conexões dizer o motivo. A
   *   chave é o nome do segredo (`''` é a credencial padrão).
   *
   *   Limite de uso é outra coisa: é do APLICATIVO, vale para as duas empresas,
   *   e continua parando a execução (`interrompida`).
   */
  const credenciaisRecusadas = new Map<string, string>();

  for (const ativo of paraColetar) {
    // Parou por limite de uso ou pelo relógio: os ativos restantes ficam para a próxima
    // execução, e a janela de 28 dias garante que nada se perde por isso.
    if (interrompida) break;

    // O ORÇAMENTO DE TEMPO, CONFERIDO ANTES DE COMEÇAR CADA CONTA.
    //
    // É o que impede a execução de ser MORTA em vez de terminar. Ver
    // `TETO_DE_TEMPO_MS`: parar sozinho e registrar "parcial" é informação;
    // ser morto no meio não deixa nem rastro.
    //
    // O `> 0` não é defensividade vazia: zero significa "sem relógio", e sem
    // ele a subtração daria um número positivo já na primeira conta — a coleta
    // pararia antes de visitar qualquer uma.
    if (tetoDeTempoMs > 0 && Date.now() - comecou > tetoDeTempoMs) {
      interrompida = true;
      break;
    }

    /**
     * A TENTATIVA SE REGISTRA ANTES DO TRABALHO, E EM TRANSAÇÃO PRÓPRIA.
     *
     * O orçamento acima protege contra ser morto ENTRE contas. Não protege
     * contra ser morto DENTRO de uma — e é isso que acontece com uma conta
     * grande demais para caber no tempo que a plataforma dá.
     *
     * Quando isso acontece não há sucesso nem `catch`: nada é gravado. E como
     * a fila ordena pela conta tentada há mais tempo, a conta que matou a
     * execução continua sendo a mais antiga — então a execução seguinte
     * escolhe exatamente ela, e morre no mesmo lugar.
     *
     * A conta pesada não atrasa a fila: ela SEQUESTRA a fila. Aconteceu em
     * 2026-08-21, com a "Pró Forma" (300 anúncios, 901 linhas diárias):
     * quatro execuções seguidas morreram nela e as outras 40 contas ficaram
     * duas horas sem ser visitadas, sem uma linha de erro em lugar nenhum.
     *
     * Marcando antes, ser morto custa UM lugar na fila em vez da fila inteira.
     * Não conserta a conta pesada — conserta o estrago que ela causa nas
     * outras, que é a diferença entre "uma conta com problema" e "a coleta
     * parada".
     */
    try {
      await withActor(sql, { kind: 'collector' }, async (tx) => {
        await tx`select ideworks.mark_asset_attempt(${ativo.id})`;
      });
    } catch {
      /* Se nem isto passar, seguir e tentar a conta: o pior caso volta a ser o
         de antes, e não um caso novo. */
    }

    // A credencial desta conta já foi recusada nesta execução: não adianta
    // perguntar de novo à Meta. A tentativa acima já fez a conta andar na fila.
    const recusada = credenciaisRecusadas.get(ativo.secretName ?? '');
    if (recusada !== undefined) {
      falhos += 1;
      primeiraFalha ??= recusada;
      try {
        await withActor(sql, { kind: 'collector' }, async (tx) => {
          await tx`select ideworks.touch_asset(${ativo.id}, ${recusada})`;
        });
      } catch {
        /* segue */
      }
      continue;
    }

    /**
     * A CREDENCIAL DESTA CONTA, E O QUE FAZER QUANDO ELA NÃO EXISTE.
     *
     * Faltar a credencial é o erro mais provável de toda esta mudança: basta
     * cadastrar a empresa no banco e esquecer o `wrangler secret put`. Por isso
     * ele falha ALTO — a conta é marcada com o nome do segredo que falta, e a
     * tela de conexões passa a dizer exatamente o que fazer.
     *
     * O contrário — cair na credencial padrão quando a certa não existe — seria
     * pior de um jeito difícil de enxergar: a Meta responderia "conta não
     * encontrada", que é a mesma resposta de uma conta apagada. Ninguém
     * procuraria um segredo faltando; procurariam na Meta, do lado errado.
     */
    const fonte = escolherFonte(ativo.secretName);
    if (!fonte) {
      const mensagem =
        `Sem a credencial ${ativo.secretName ?? 'padrão'} neste ambiente. ` +
        'Defina o segredo no Worker, ou corrija a empresa desta conta.';
      falhos += 1;
      primeiraFalha ??= mensagem;
      try {
        await withActor(sql, { kind: 'collector' }, async (tx) => {
          await tx`select ideworks.touch_asset(${ativo.id}, ${mensagem})`;
        });
      } catch {
        /* segue */
      }
      continue;
    }

    try {
      // UMA TRANSAÇÃO POR CONTA, e esta é a decisão que sustenta o resto.
      //
      // Antes, a execução inteira era uma transação só. Duas consequências, e
      // as duas aconteceram de verdade em 2026-08-20:
      //
      //   1. Treze minutos segurando lock em `meta_assets` travaram uma
      //      migration — o `alter table` ficou esperando e estourou.
      //
      //   2. Pior: uma execução morta pelo teto de tempo da plataforma
      //      desfazia TUDO, inclusive a linha do livro e o avanço de
      //      `last_attempt_at`. Não sobrava rastro nenhum, e a batida seguinte
      //      pegava exatamente as mesmas contas — que estouravam de novo. A
      //      coleta parou por catorze horas em silêncio, sem uma linha de erro,
      //      porque o registro do erro também era desfeito.
      //
      // Com uma transação por conta, o que já foi coletado FICA. A conta
      // seguinte começa do zero, e a fila avança mesmo que a execução morra.
      const escritas = await withActor(sql, { kind: 'collector' }, async (tx) => {
        let n = 0;

        // `comoJson(tx, ...)` e não `JSON.stringify(...)` — o porquê está em
        // `server/db.ts`, e é a diferença entre gravar a métrica e gravar uma
        // linha inteira de nulos sem erro nenhum.
        if (ativo.kind === 'instagram_account') {
          const r = await fonte.organico(ativo.externalId, janela);
          n += await gravarDiasOrganicos(tx, ativo.id, r.dias);

          // --- o retrato do público (F9e) ---------------------------------
          // Datado de HOJE, e não da janela: `follower_demographics` é
          // `lifetime` — ela responde "como está agora", nunca "como era".
          for (const q of await fonte.demografia(ativo.externalId)) {
            await tx`
              select ideworks.upsert_follower_demographics(
                ${ativo.id}, ${janela.ate}, ${q.dimensao}::ideworks.demographic_dimension,
                ${comoJson(tx, q.buckets)}::jsonb)`;
            n += 1;
          }

          // --- as quebras do dia (F9g) ------------------------------------
          for (const q of await fonte.quebrasDiarias(ativo.externalId, janela)) {
            await tx`
              select ideworks.upsert_daily_breakdown(
                ${ativo.id}, ${q.day}, ${q.metric}, ${q.dimension},
                ${comoJson(tx, q.buckets)}::jsonb)`;
            n += 1;
          }

          // --- cada publicação (F9f) --------------------------------------
          for (const p of await fonte.publicacoes(ativo.externalId, janela)) {
            await tx`
              select ideworks.upsert_media(
                ${ativo.id}, ${p.mediaId},
                ${p.productType}::ideworks.media_product, ${p.mediaType},
                ${p.permalink}, ${p.caption}, ${p.thumbnailUrl}, ${p.postedAt},
                ${comoJson(tx, p.metrics)}::jsonb)`;
            n += 1;
          }

          if (devePausar(lerUso(r.usoBruto))) interrompida = true;
        } else {
          const r = await fonte.campanhas(ativo.externalId, janela);
          for (const dia of r.dias) {
            await tx`
              select ideworks.upsert_campaign_day(
                ${ativo.id}, ${dia.day}, ${dia.campaignId}, ${dia.campaignName},
                ${comoJson(tx, dia.metrics)}::jsonb)`;
            n += 1;
          }

          // --- o objetivo, o criativo e o fato diário por anúncio (F10a) ----
          //
          // A campanha guarda O OBJETIVO, que é o que decide qual métrica é
          // "resultado". Sem ele, a tela mostra a mesma coluna para uma
          // campanha de mensagem e uma de vendas — números que não se comparam.
          // EM LOTE, E NÃO LINHA POR LINHA — F7i.
          //
          // Uma chamada por linha custava, na "Pró Forma", cerca de 1.220
          // idas e voltas ao banco dentro de UMA execução do Worker: 300
          // anúncios, 901 dias-anúncio e as campanhas. O teto de
          // sub-requisições da plataforma é dessa ordem, e o Worker morria
          // antes de gravar qualquer coisa — não por ser lento, por ser MUITO.
          //
          // Agora são três chamadas. O volume viaja como um parâmetro jsonb, e
          // o texto da consulta fica do mesmo tamanho para uma linha ou mil.
          const campanhas = await fonte.campanhasDetalhe(ativo.externalId);
          if (campanhas.length > 0) {
            const [{ upsert_campaigns_lote: gravadas }] = await tx`
              select ideworks.upsert_campaigns_lote(
                ${ativo.id},
                ${comoJson(
                  tx,
                  campanhas.map((c) => ({
                    campaign_id: c.campaignId,
                    name: c.name,
                    objective: c.objective,
                    status: c.status,
                    effective_status: c.effectiveStatus,
                  })),
                )}::jsonb)`;
            n += Number(gravadas);
          }

          const anuncios = await fonte.anuncios(ativo.externalId);
          if (anuncios.length > 0) {
            const [{ upsert_ads_lote: gravados }] = await tx`
              select ideworks.upsert_ads_lote(
                ${ativo.id},
                ${comoJson(
                  tx,
                  anuncios.map((a) => ({
                    ad_id: a.adId,
                    campaign_id: a.campaignId,
                    adset_name: a.adsetName,
                    name: a.name,
                    creative_id: a.creativeId,
                    thumbnail_url: a.thumbnailUrl,
                    effective_status: a.effectiveStatus,
                    instagram_media_id: a.instagramMediaId,
                    instagram_permalink: a.instagramPermalink,
                  })),
                )}::jsonb)`;
            n += Number(gravados);
          }

          const diario = await fonte.diarioPorAnuncio(ativo.externalId, janela);
          if (diario.length > 0) {
            const [{ upsert_daily_ads_lote: gravadas }] = await tx`
              select ideworks.upsert_daily_ads_lote(
                ${ativo.id},
                ${comoJson(
                  tx,
                  diario.map((d) => ({
                    day: d.day,
                    ad_id: d.adId,
                    campaign_id: d.campaignId,
                    metrics: d.metrics,
                  })),
                )}::jsonb)`;
            n += Number(gravadas);
          }

          if (devePausar(lerUso(r.usoBruto))) interrompida = true;
        }

        await tx`select ideworks.touch_asset(${ativo.id}, null)`;
        return n;
      });

      linhas += escritas;
      ok += 1;
    } catch (erro) {
      const falha = classificarFalha(erro);
      falhos += 1;
      primeiraFalha ??= falha.mensagem;

      // Anotar a falha NO ATIVO é o que faz a tela conseguir dizer de quem o
      // dado parou de chegar. Em transação PRÓPRIA: a da conta já se desfez, e
      // escrever nela seria escrever no vazio.
      //
      // Se nem isto passar, a execução continua: perder o registro de uma
      // falha é ruim, perder as contas seguintes é pior.
      try {
        await withActor(sql, { kind: 'collector' }, async (tx) => {
          await tx`select ideworks.touch_asset(${ativo.id}, ${falha.mensagem})`;
        });
      } catch {
        /* segue */
      }

      // Token vencido fecha só a credencial; o resto que manda parar (limite
      // de uso) fecha a execução. Ver `credenciaisRecusadas`.
      if (falha.tipo === 'token') {
        credenciaisRecusadas.set(ativo.secretName ?? '', falha.mensagem);
      } else if (falha.deveParar) {
        interrompida = true;
      }
    }
  }

  /**
   * PARAR PELO RELÓGIO NÃO É "PARCIAL".
   *
   * A primeira versão marcava `partial` sempre que o orçamento cortava. Só que
   * o orçamento corta SEMPRE — é para isso que ele existe. Toda execução sairia
   * amarela, e um aviso que aparece de meia em meia hora vira paisagem: quando
   * a parcial de verdade chegasse, ninguém olharia.
   *
   * `partial` volta a significar o que sempre significou: **alguma conta
   * falhou**. Uma execução que visitou quatro das doze e parou no tempo
   * combinado fez exatamente o que devia — e quem conta essa história é
   * `assets_ok` contra `assets_total`, que ficam registrados.
   *
   * O sinal de que o orçamento está apertado demais não é este campo: é a conta
   * que envelhece sem ser visitada, e disso cuida `saudeDaColeta`, com o limite
   * de 12 horas.
   */
  const desfecho = desfechoDaExecucao(ok, falhos);

  await withActor(sql, { kind: 'collector' }, async (tx) => {
    await tx`
      select ideworks.finish_collection_run(
        ${runId}, ${desfecho}::ideworks.collection_outcome,
        ${paraColetar.length}, ${ok}, ${falhos}, ${linhas}, ${primeiraFalha})`;
  });

  return {
    runId,
    janela,
    desfecho,
    ativosTotal: paraColetar.length,
    ativosOk: ok,
    ativosComFalha: falhos,
    linhasGravadas: linhas,
    primeiraFalha,
    interrompida,
    jaEmAndamento: false,
  };
}

/* ─────────────────────────── a fonte de verdade ─────────────────────────── */

const GRAPH = 'https://graph.facebook.com/v21.0';

/**
 * Quantas publicações se busca por conta, por execução.
 *
 * Um perfil da carteira tem 2.281 publicações. Como cada uma custa uma chamada
 * de insight, buscar tudo seria 2.281 chamadas para UMA conta — e há 21 contas.
 *
 * Pega-se as 25 mais recentes, sem recorte de data: a métrica de uma publicação
 * é acumulada desde que ela foi ao ar, então recortar pela janela do relatório
 * não faria sentido — e conta que posta pouco ficaria sem relatório nenhum.
 */
const TETO_DE_PUBLICACOES = 25;

/**
 * O conjunto de métricas de cada tipo de publicação.
 *
 * NÃO É PREFERÊNCIA, É IMPOSIÇÃO
 *   A Meta recusa a chamada INTEIRA quando um tipo recebe métrica que ele não
 *   suporta. Medido em 2026-08-20: pedir `profile_visits` e `follows` para um
 *   reel devolve erro 100 — "does not support the profile_visits, follows
 *   metric for this media product type" — e nenhuma das outras sete métricas
 *   vem junto.
 *
 *   É a mesma armadilha que fez as 20 contas de anúncio sumirem na F9b: um
 *   campo a mais não custa o campo, custa a resposta.
 */
const METRICAS_DA_PUBLICACAO = {
  FEED: 'reach,views,likes,comments,shares,saved,total_interactions,profile_visits,follows',
  REELS: 'reach,views,likes,comments,shares,saved,total_interactions',
  STORY: 'reach,views,replies,navigation,total_interactions,shares',
} as const;

/**
 * As métricas de conta que **exigem** `metric_type=total_value`.
 *
 * Medido em 2026-08-20: `reach` é a única que aceita `period=day` e devolve
 * série. Pedir qualquer uma destas sem `metric_type` devolve erro 100 dizendo
 * exatamente isso.
 */
const METRICAS_DE_TOTAL = [
  'views',
  'accounts_engaged',
  'total_interactions',
  'likes',
  'comments',
  'shares',
  'saves',
  'profile_links_taps',
] as const;

/**
 * Quantos dias do orgânico se refaz por execução.
 *
 * Menos que a janela de 28 dias do pago, e de propósito: aqui cada dia custa
 * uma chamada, e o que muda no orgânico é só o passado recente — a Meta leva
 * até 48h para fechar o cálculo. Sete cobre isso com folga.
 */
const DIAS_DE_TOTAL_VALUE = 7;

/** Soma (ou subtrai) dias a uma data civil, sem passar por fuso. */
function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const maiorData = (a: string, b: string) => (a >= b ? a : b);

/**
 * Erro cru da Meta, para `classificarFalha` poder ler o código.
 *
 * Campo declarado e atribuído no corpo, e não como propriedade de parâmetro:
 * a forma curta exige compilador, e o Node roda TypeScript apenas REMOVENDO os
 * tipos. Com ela, todo script que importa este módulo morre com "parameter
 * property is not supported in strip-only mode" — foi o que manteve
 * `coletar-agora.mjs` quebrado sem ninguém notar.
 */
class ErroDaMeta extends Error {
  readonly code: number;
  /** A Meta (ou a rede) falhou agora, e o mesmo pedido pode passar daqui a pouco. */
  readonly transitorio: boolean;

  constructor(code: number, message: string, transitorio = false) {
    super(message);
    this.name = 'ErroDaMeta';
    this.code = code;
    this.transitorio = transitorio;
  }
}

/**
 * Quanto se espera por UM pedido à Meta.
 *
 * POR QUE EXISTE
 *   O `fetch` do Worker não tem prazo próprio: uma resposta que a Meta deixa
 *   pendurada prende a execução até a plataforma matá-la. E o orçamento de
 *   tempo (`TETO_DE_TEMPO_MS`) só é conferido ENTRE contas — não protege contra
 *   um pedido que não volta. Morta assim, a execução fica `running` no livro e
 *   a trava de "uma coleta por vez" segura a batida seguinte.
 *
 * POR QUE SESSENTA SEGUNDOS
 *   O pior pedido medido (insight por anúncio de uma conta de 300 anúncios)
 *   leva dezenas de segundos em várias páginas, nunca um minuto numa só. Acima
 *   disso não é lentidão, é pedido perdido.
 */
const PRAZO_DO_PEDIDO_MS = 60_000;

/** O Graph, e só ele: é para onde o token pode viajar. */
const ORIGEM_DO_GRAPH = 'https://graph.facebook.com/';

/**
 * Quanto se espera antes de cada nova tentativa de um pedido que falhou de forma
 * passageira — duas esperas, logo até TRÊS tentativas.
 *
 * POR QUE REPETIR
 *   Um perfil do Instagram faz de 100 a 120 pedidos por coleta. Com uma fração
 *   de 5xx, "erro desconhecido" (code 1) e "serviço indisponível" (code 2) —
 *   que a própria Meta documenta como passageiros —, UM pedido ruim no meio
 *   desfazia a transação da conta inteira, as chamadas já feitas incluídas, e a
 *   conta só voltava depois de uma volta completa da fila.
 *
 * O QUE NÃO SE REPETE
 *   Limite de uso e token (insistir queima a cota), recusa da consulta e falta
 *   de permissão (não mudam sozinhas) e estouro de prazo (um pedido pendurado
 *   três vezes seriam três minutos). São pedidos de LEITURA: repetir é seguro.
 */
const ESPERAS_ENTRE_TENTATIVAS_MS = [500, 2_000] as const;

const dormir = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function falhouDeFormaPassageira(erro: unknown): boolean {
  if (erro instanceof ErroDaMeta) return erro.transitorio;
  // `fetch` rejeita com TypeError quando a rede cai antes de haver resposta.
  return erro instanceof TypeError;
}

async function pedir(url: string): Promise<{ corpo: unknown; uso: string | null }> {
  for (let tentativa = 0; ; tentativa += 1) {
    try {
      return await pedirUmaVez(url);
    } catch (erro) {
      const espera = ESPERAS_ENTRE_TENTATIVAS_MS[tentativa];
      if (espera === undefined || !falhouDeFormaPassageira(erro)) throw erro;
      await dormir(espera);
    }
  }
}

async function pedirUmaVez(url: string): Promise<{ corpo: unknown; uso: string | null }> {
  let resposta: Response;
  try {
    resposta = await fetch(url, { signal: AbortSignal.timeout(PRAZO_DO_PEDIDO_MS) });
  } catch (erro) {
    // A mensagem é nossa, e não a do erro: a do navegador/runtime pode trazer a
    // URL, e a URL leva o token. Código 0 não casa com nenhuma regra de
    // `classificarFalha` — cai em "outro", que falha ESTA conta e segue.
    const nome = (erro as { name?: string } | null)?.name;
    if (nome === 'TimeoutError' || nome === 'AbortError') {
      throw new ErroDaMeta(
        0,
        `A Meta não respondeu em ${Math.round(PRAZO_DO_PEDIDO_MS / 1000)} segundos.`,
      );
    }
    throw erro;
  }
  const corpo = (await resposta.json().catch(() => ({}))) as {
    error?: { code?: number; message?: string; is_transient?: boolean };
  };

  if (!resposta.ok || corpo.error) {
    const codigo = Number(corpo.error?.code ?? resposta.status);
    throw new ErroDaMeta(
      codigo,
      corpo.error?.message ?? `A Meta respondeu ${resposta.status}.`,
      // 1 = erro desconhecido, 2 = serviço temporariamente indisponível.
      resposta.status >= 500 || codigo === 1 || codigo === 2 || corpo.error?.is_transient === true,
    );
  }
  return { corpo, uso: resposta.headers.get('x-fb-ads-insights-throttle') };
}

/**
 * Uma coleção INTEIRA, seguindo `paging.next` — a mesma lição da F19g.
 *
 * A Meta pagina pelo tamanho da RESPOSTA, e não pelo `limit` pedido. Ler uma
 * página só é apostar que a conta cabe nela; no dia em que não couber, a lista
 * encolhe SEM ERRO — e o ranking, o objetivo da campanha e a miniatura saem
 * montados sobre um pedaço.
 *
 * O cursor só é seguido quando aponta para o Graph: ele carrega o token, e um
 * endereço vindo de resposta não é motivo para mandá-lo a outro servidor.
 * O teto de páginas impede cursor circular de virar laço, e conta absurda de
 * prender a execução inteira.
 *
 * O uso devolvido é o da ÚLTIMA página que o trouxe: é a carga de agora, a que
 * o limitador precisa enxergar.
 */
async function paginar<T>(
  primeira: string,
): Promise<{ itens: T[]; uso: string | null }> {
  const itens: T[] = [];
  let uso: string | null = null;
  let url = primeira;
  for (let pagina = 0; pagina < TETO_DE_PAGINAS && url !== ''; pagina += 1) {
    const r = await pedir(url);
    const c = r.corpo as { data?: T[]; paging?: { next?: string } };
    itens.push(...(c.data ?? []));
    uso = r.uso ?? uso;
    const proxima = typeof c.paging?.next === 'string' ? c.paging.next : '';
    url = proxima.startsWith(ORIGEM_DO_GRAPH) ? proxima : '';
  }
  return { itens, uso };
}

/**
 * Num `catch` que engole de propósito, deixa passar o que vale para a EXECUÇÃO.
 *
 * Recusa de uma métrica (perfil pequeno, publicação nova, tipo sem insight) é
 * da conta e pode ser engolida: o resto dela segue valendo. Limite de uso e
 * token vencido não são: `classificarFalha` marca os dois com `deveParar`,
 * porque nada melhora no pedido seguinte — insistir só queima a cota que
 * acabou de estourar. Engolidos aqui, a conta seguia pedindo (até uma centena
 * de chamadas por perfil) e fechava como "ok", com buraco nos dados e sem uma
 * linha de erro em lugar nenhum.
 */
function repassarSeDeveParar(erro: unknown): void {
  if (classificarFalha(erro).deveParar) throw erro;
}

/**
 * A fonte de verdade: o Graph API.
 *
 * O TOKEN É UM SÓ, E VEM DE FORA
 *   Há um System User na BM do Grupo Ideal com acesso de parceiro às BMs dos
 *   clientes (decisão D14). O token dele é segredo do Worker — nunca esteve no
 *   banco e nunca passa por aqui em nenhuma outra forma.
 */
export function fonteDaMetaHttp(token: string): FonteDaMeta {
  if (token.trim() === '') {
    throw new Error('Sem token da Meta: defina IDEWORKS_META_TOKEN no Worker.');
  }
  const auth = `access_token=${encodeURIComponent(token)}`;

  return {
    /**
     * O orgânico precisa de DUAS formas de chamada, e isso não é escolha —
     * é como a API responde. Medido contra contas reais em 2026-08-20:
     *
     *   `reach`     é a ÚNICA que aceita `period=day` e devolve série diária.
     *               Uma chamada traz a janela inteira.
     *
     *   todo o resto (`views`, `accounts_engaged`, `total_interactions`,
     *               `likes`, `comments`, `shares`, `saves`,
     *               `profile_links_taps`) EXIGE `metric_type=total_value` —
     *               e `total_value` **colapsa o período num número só**.
     *
     *   Ou seja: para ter série diária dessas, é uma chamada POR DIA. Não há
     *   parâmetro que faça a API devolver a série delas de uma vez; tentar
     *   `period=day` sem `metric_type` devolve erro 100 dizendo isso.
     *
     * A JANELA DAS DUAS É DIFERENTE, DE PROPÓSITO
     *   `reach` custa uma chamada, então cobre os 28 dias inteiros. As de
     *   `total_value` custam uma chamada por dia CADA — 28 dias × 21 contas
     *   seriam 588 chamadas por execução, para reescrever números de dias que
     *   já não mudam.
     *
     *   A regra dos 28 dias veio do PAGO (número de anúncio muda por 28 dias).
     *   No orgânico o que muda é o passado recente, por causa do atraso de até
     *   48h no cálculo. Sete dias cobrem isso com folga, e a execução diária dá
     *   a cada dia sete oportunidades de ser capturado.
     *
     * O DIA É O `since` DA JANELA
     *   Medido: pedir `since=D&until=D` devolve VAZIO; `since=D&until=D+1`
     *   devolve um balde com `end_time = D`. E `since` no futuro é recusado
     *   com "since param is not valid". Então a janela `[D, D+1)` é o dia `D`,
     *   e é assim que os dois tipos de chamada são rotulados — o que garante
     *   que `reach` e `views` do mesmo dia caiam na mesma linha.
     */
    async organico(conta, janela) {
      const porDia = new Map<string, Record<string, number | Record<string, unknown>>>();
      const guardar = (dia: string, campos: Record<string, number | Record<string, unknown>>) =>
        porDia.set(dia, { ...(porDia.get(dia) ?? {}), ...campos });

      // --- 1. alcance: uma chamada, a janela toda ---------------------------
      // `until` é EXCLUSIVO sobre o `end_time`, então soma-se um dia para o
      // último dia da janela entrar.
      const { corpo } = await pedir(
        `${GRAPH}/${conta}/insights?metric=reach&period=day` +
          `&since=${janela.de}&until=${somarDias(janela.ate, 1)}&${auth}`,
      );

      for (const metrica of ((corpo as { data?: unknown[] }).data ?? []) as Array<{
        name?: string;
        values?: Array<{ value?: unknown; end_time?: string }>;
      }>) {
        for (const v of metrica.values ?? []) {
          const dia = (v.end_time ?? '').slice(0, 10);
          const valor = Number(v.value);
          if (dia === '' || !Number.isFinite(valor)) continue;
          guardar(dia, { reach: valor });
        }
      }

      // --- 2. o resto: uma chamada por dia ----------------------------------
      const inicio = maiorData(janela.de, somarDias(janela.ate, -(DIAS_DE_TOTAL_VALUE - 1)));

      for (let dia = inicio; dia <= janela.ate; dia = somarDias(dia, 1)) {
        const amanha = somarDias(dia, 1);

        let lote: Awaited<ReturnType<typeof pedir>>;
        try {
          lote = await pedir(
            `${GRAPH}/${conta}/insights?metric=${METRICAS_DE_TOTAL.join(',')}` +
              `&metric_type=total_value&period=day&since=${dia}&until=${amanha}&${auth}`,
          );
        } catch (erro) {
          // O ÚLTIMO DIA É O "HOJE" EM UTC, e a Meta recusa `since` no futuro
          // ("since param is not valid"). Das 21h à meia-noite de São Paulo o
          // hoje em UTC já é amanhã, e para o fuso em que a Meta mede o dia ele
          // pode ainda nem ter começado. Sem este desvio a chamada derrubava a
          // conta INTEIRA — o reach e os dias anteriores incluídos — em todas
          // as batidas dessas horas. O dia volta, completo, na batida seguinte.
          //
          // Só vale para o último dia: a mesma recusa num dia do passado é
          // outra coisa, e continua subindo.
          if (dia === janela.ate && /since param is not valid/i.test(String((erro as Error)?.message))) {
            continue;
          }
          throw erro;
        }

        const campos: Record<string, number> = {};
        for (const m of ((lote.corpo as { data?: unknown[] }).data ?? []) as Array<{
          name?: string;
          total_value?: { value?: unknown };
        }>) {
          const valor = Number(m.total_value?.value);
          if (typeof m.name === 'string' && Number.isFinite(valor)) campos[m.name] = valor;
        }
        if (Object.keys(campos).length > 0) guardar(dia, campos);

        // --- seguidores: chamada separada, porque exige quebra --------------
        // `follows_and_unfollows` só responde com `breakdown=follow_type`, e as
        // chaves são FOLLOWER e NON_FOLLOWER — nomes que não dizem qual é
        // "ganhou" e qual é "perdeu". Na primeira medição as duas vieram ZERO,
        // e com zero não dá para distinguir: as colunas ficaram NULAS e o bruto
        // foi para `extra`, à espera de um dia com movimento.
        //
        // O dia chegou. Em 2026-08-20, contra 16 dias-conta de 8 perfis:
        //
        //     FOLLOWER == follower_count em 16 de 16 casos,
        //
        // e `follower_count` é, por definição da Meta, os NOVOS seguidores do
        // dia. NON_FOLLOWER varia de forma independente — há dia com FOLLOWER=0
        // e NON_FOLLOWER=4, e o inverso —, então não é o mesmo número com outro
        // nome. Logo: FOLLOWER = entraram, NON_FOLLOWER = saíram.
        //
        // O bruto continua indo para `extra`. Ele custa nada e é o que permite
        // refazer esta leitura se a Meta mudar os nomes.
        try {
          const seg = await pedir(
            `${GRAPH}/${conta}/insights?metric=follows_and_unfollows` +
              `&metric_type=total_value&breakdown=follow_type&period=day` +
              `&since=${dia}&until=${amanha}&${auth}`,
          );
          const bruto = ((seg.corpo as { data?: unknown[] }).data ?? [])[0] as
            | {
                total_value?: {
                  breakdowns?: Array<{
                    results?: Array<{ dimension_values?: string[]; value?: unknown }>;
                  }>;
                };
              }
            | undefined;

          if (bruto) {
            const resultados = bruto.total_value?.breakdowns?.[0]?.results ?? [];
            const ler = (chave: string) => {
              const achado = resultados.find((r) => r.dimension_values?.[0] === chave);
              const v = Number(achado?.value);
              return achado !== undefined && Number.isFinite(v) ? v : null;
            };

            const entraram = ler('FOLLOWER');
            const sairam = ler('NON_FOLLOWER');

            guardar(dia, {
              extra: { follows_and_unfollows: bruto },
              // Só grava o que veio. Ausente continua nulo — e nulo é "não
              // sei", que a tela mostra como travessão em vez de zero.
              ...(entraram === null ? {} : { follows: entraram }),
              ...(sairam === null ? {} : { unfollows: sairam }),
            });
          }
        } catch (erro) {
          // Uma conta sem essa métrica não pode derrubar o dia inteiro dela —
          // mas limite de uso e token vencido não são da métrica: sobem.
          repassarSeDeveParar(erro);
        }
      }

      // --- o que o perfil é HOJE (F10f) -------------------------------------
      //
      // Seguidores e número de publicações não são métricas de dia: são o
      // estado atual do perfil. A Meta devolve os dois num campo direto, sem
      // insight nenhum.
      //
      // Vão carimbados no ÚLTIMO dia da janela, e isso é o que transforma um
      // número em série: guardando um por coleta, a curva de crescimento de
      // seguidores passa a existir. A Meta não a devolve — `follower_count`
      // dá o ganho do dia, nunca o total de ontem.
      try {
        const { corpo } = await pedir(
          `${GRAPH}/${conta}?fields=followers_count,media_count&${auth}`,
        );
        const c = corpo as { followers_count?: unknown; media_count?: unknown };
        const seguidores = Number(c.followers_count);
        const publicacoes = Number(c.media_count);
        guardar(janela.ate, {
          ...(Number.isFinite(seguidores) ? { followers_total: seguidores } : {}),
          ...(Number.isFinite(publicacoes) ? { media_count: publicacoes } : {}),
        });
      } catch (erro) {
        // Perfil que não devolve o campo continua com a série do dia. Não é
        // motivo para perder o resto da conta — salvo limite e token.
        repassarSeDeveParar(erro);
      }

      return {
        dias: [...porDia.entries()].map(([day, metrics]) => ({ day, metrics })),
        // O orgânico não recebe o cabeçalho de carga: ele é só das chamadas de
        // insights de anúncio. Ver `lerUso`.
        usoBruto: null,
      };
    },

    /**
     * As campanhas com o objetivo — F10a.
     *
     * O OBJETIVO NÃO VEM NO INSIGHT, E QUANDO VEM, VEM ERRADO
     *   `/insights` devolve um campo `objective`, e ele traz o nome ANTIGO: a
     *   mesma campanha aparece como `OUTCOME_TRAFFIC` aqui e `LINK_CLICKS` lá.
     *   Medido em 2026-08-21. Por isso o objetivo vem da campanha, que é quem o
     *   tem de verdade.
     */
    async campanhasDetalhe(conta) {
      // Pagina: `limit=200` é pedido, e não garantia — a Meta pagina pelo
      // tamanho da resposta. Ver `paginar`.
      const { itens } = await paginar<{
        id?: string;
        name?: string;
        objective?: string;
        status?: string;
        effective_status?: string;
      }>(
        `${GRAPH}/${conta}/campaigns?fields=id,name,objective,status,effective_status` +
          `&limit=200&${auth}`,
      );
      return itens
        .filter((c) => typeof c.id === 'string')
        .map((c) => ({
          campaignId: c.id as string,
          name: c.name ?? null,
          objective: c.objective ?? null,
          status: c.status ?? null,
          effectiveStatus: c.effective_status ?? null,
        }));
    },

    /**
     * Os anúncios e as miniaturas — F10a.
     *
     * A miniatura mora no CRIATIVO, não no anúncio, e por isso vem em subcampo.
     * O endereço é do CDN da Meta e expira; a tela esconde o quadro quando
     * quebra, em vez de mostrar ícone de imagem partida.
     */
    async anuncios(conta) {
      // `effective_instagram_media_id` e o que liga o anuncio a PUBLICACAO que
      // ele impulsiona — F9n. Sem ele nao ha como saber que uma publicacao teve
      // entrega paga: a metrica do Instagram ja vem somada e nao avisa.
      const campos ='id,name,campaign_id,adset{name},effective_status,' +
        'creative{id,thumbnail_url,effective_instagram_media_id,instagram_permalink_url}';
      //
      // PAGINA, e é o caso que mais importa: a conta mais pesada da carteira
      // tem 300 anúncios, exatamente o `limit`. O 301º não aparecia — sem nome,
      // sem miniatura, sem o vínculo com a publicação impulsionada — e nenhum
      // erro avisava.
      const { itens } = await paginar<{
        id?: string;
        name?: string;
        campaign_id?: string;
        adset?: { name?: string };
        effective_status?: string;
        creative?: {
          id?: string;
          thumbnail_url?: string;
          effective_instagram_media_id?: string;
          instagram_permalink_url?: string;
        };
      }>(`${GRAPH}/${conta}/ads?fields=${encodeURIComponent(campos)}&limit=300&${auth}`);
      return itens
        .filter((a) => typeof a.id === 'string')
        .map((a) => ({
          adId: a.id as string,
          campaignId: a.campaign_id ?? null,
          adsetName: a.adset?.name ?? null,
          name: a.name ?? null,
          creativeId: a.creative?.id ?? null,
          thumbnailUrl: a.creative?.thumbnail_url ?? null,
          effectiveStatus: a.effective_status ?? null,
          instagramMediaId: a.creative?.effective_instagram_media_id ?? null,
          instagramPermalink: a.creative?.instagram_permalink_url ?? null,
        }));
    },

    /**
     * O fato diário por anúncio — F10a.
     *
     * UMA CHAMADA SÓ, e é o que torna isto viável: medido em 2026-08-21,
     * `level=ad&time_increment=1` devolveu 221 linhas (46 anúncios × 7 dias)
     * sem paginar. Coletar criativo custa o mesmo que coletar campanha.
     *
     * A lista de ações vai CRUA para o banco. Qual delas é "o resultado"
     * depende do objetivo, e o objetivo muda — guardar só a que interessa hoje
     * jogaria fora a resposta de amanhã, que a Meta não devolve.
     */
    async diarioPorAnuncio(conta, janela) {
      const campos = [
        'ad_id',
        'campaign_id',
        'spend',
        'reach',
        'impressions',
        'clicks',
        'inline_link_clicks',
        'actions',
      ].join(',');

      type LinhaDeAnuncio = {
        date_start?: string;
        ad_id?: string;
        campaign_id?: string;
        spend?: string;
        reach?: string;
        impressions?: string;
        clicks?: string;
        inline_link_clicks?: string;
        actions?: unknown;
      };

      // AQUI PAGINA, E ISSO NÃO É ZELO EXCESSIVO.
      //
      // Uma conta da carteira tem 300 anúncios. Com `time_increment=1` sobre 28
      // dias, o teto de 500 linhas por página é atingido — medido em
      // 2026-08-21: a resposta veio com exatamente 500 e mais páginas atrás.
      //
      // Sem seguir `paging.next`, a coleta guardaria os primeiros dias e
      // largaria o resto em silêncio. O ranking de criativo sairia montado
      // sobre um pedaço, e nada na tela diria isso.
      //
      // O teto de páginas (em `paginar`) é porque uma conta absurda não pode
      // prender a execução inteira. O orçamento de tempo já corta, mas depender
      // só dele deixaria a conta seguinte sem vez toda vez.
      const { itens: linhas } = await paginar<LinhaDeAnuncio>(
        `${GRAPH}/${conta}/insights?level=ad&fields=${campos}&time_increment=1` +
          `&time_range=${encodeURIComponent(JSON.stringify({ since: janela.de, until: janela.ate }))}` +
          `&limit=500&${auth}`,
      );

      return linhas
        .filter((l) => typeof l.ad_id === 'string' && typeof l.date_start === 'string')
        .map((l) => ({
          day: (l.date_start as string).slice(0, 10),
          adId: l.ad_id as string,
          campaignId: l.campaign_id ?? null,
          metrics: {
            spend: Number(l.spend ?? 0),
            reach: Number(l.reach ?? 0),
            impressions: Number(l.impressions ?? 0),
            clicks: Number(l.clicks ?? 0),
            link_clicks: Number(l.inline_link_clicks ?? 0),
            actions: l.actions ?? [],
          },
        }));
    },

    async campanhas(conta, janela) {
      const campos = [
        'campaign_id',
        'campaign_name',
        'spend',
        'reach',
        'impressions',
        'clicks',
        'inline_link_clicks',
        'actions',
        'action_values',
      ].join(',');

      // Uma linha por campanha por DIA: 18 campanhas ativas × 28 dias já passam
      // das 500 do `limit`. Lendo só a primeira página, os últimos dias de
      // gasto sumiam do relatório sem erro nenhum. Ver `paginar`.
      const { itens: linhas, uso } = await paginar<Record<string, unknown>>(
        `${GRAPH}/${conta}/insights?level=campaign&fields=${campos}` +
          `&time_increment=1&time_range=${encodeURIComponent(
            JSON.stringify({ since: janela.de, until: janela.ate }),
          )}&limit=500&${auth}`,
      );

      return {
        dias: linhas.map((l) => {
          const acoes = (l.actions ?? []) as Array<{ action_type?: string; value?: unknown }>;
          const valores = (l.action_values ?? []) as Array<{
            action_type?: string;
            value?: unknown;
          }>;

          // "Conversão" aqui é o que a Meta já atribui — nada é calculado por
          // nós, e não há Pixel próprio (escopo, seção 1).
          const conversao = acoes.find((a) =>
            /purchase|complete_registration|lead/i.test(a.action_type ?? ''),
          );
          const valorDaConversao = valores.find((a) =>
            /purchase|complete_registration|lead/i.test(a.action_type ?? ''),
          );

          return {
            day: String(l.date_start ?? '').slice(0, 10),
            campaignId: String(l.campaign_id ?? ''),
            campaignName: typeof l.campaign_name === 'string' ? l.campaign_name : null,
            metrics: {
              spend: Number(l.spend ?? 0),
              reach: Number(l.reach ?? 0),
              impressions: Number(l.impressions ?? 0),
              clicks: Number(l.clicks ?? 0),
              link_clicks: Number(l.inline_link_clicks ?? 0),
              conversions: Number(conversao?.value ?? 0),
              conversion_value: Number(valorDaConversao?.value ?? 0),
              // Guarda a lista inteira: a Meta tem dezenas de tipos de ação, e
              // qual deles interessa muda por cliente.
              extra: { actions: acoes, action_values: valores },
            },
          };
        }),
        usoBruto: uso,
      };
    },

    /**
     * O retrato do público — F9e.
     *
     * Quatro chamadas, uma por quebra: a Meta não aceita `breakdown=age,city`
     * numa só. Cada uma falha por conta própria, e falha é comum aqui — perfil
     * com poucos seguidores recebe recusa em vez de números, porque a Meta
     * protege identidade em amostra pequena. Isso não pode custar as outras
     * três quebras nem o resto da coleta daquela conta.
     */
    async demografia(conta) {
      const quebras: QuebraDemografica[] = [];

      // `age,gender` junto é o que o app do Instagram desenha na barra de faixa
      // etária — cada faixa partida entre mulheres e homens. A Meta entrega as
      // 21 combinações numa chamada; sem ela, a tela só saberia os dois eixos
      // separados e não daria para reproduzir aquele gráfico.
      for (const dimensao of ['age', 'gender', 'city', 'country', 'age,gender'] as const) {
        try {
          const { corpo } = await pedir(
            `${GRAPH}/${conta}/insights?metric=follower_demographics` +
              `&period=lifetime&metric_type=total_value&breakdown=${dimensao}&${auth}`,
          );

          const resultados =
            (
              (corpo as {
                data?: Array<{
                  total_value?: {
                    breakdowns?: Array<{
                      results?: Array<{ dimension_values?: string[]; value?: unknown }>;
                    }>;
                  };
                }>;
              }).data ?? []
            )[0]?.total_value?.breakdowns?.[0]?.results ?? [];

          const buckets: Record<string, number> = {};
          for (const r of resultados) {
            const chave = (r.dimension_values ?? []).join(', ');
            const valor = Number(r.value);
            if (chave !== '' && Number.isFinite(valor)) buckets[chave] = valor;
          }

          if (Object.keys(buckets).length > 0) {
            // `age,gender` vira `age_gender`: a vírgula é sintaxe da URL, não
            // nome de dimensão, e o banco guarda o nome.
            quebras.push({ dimensao: dimensao.replace(',', '_') as Dimensao, buckets });
          }
        } catch (erro) {
          // Uma quebra recusada não derruba as outras. Ver o comentário acima.
          // Limite e token vencido, esses sim, param a conta na primeira.
          repassarSeDeveParar(erro);
        }
      }

      return quebras;
    },

    /**
     * As quebras do dia — F9g.
     *
     * DUAS MÉTRICAS POR CHAMADA, E ISSO É METADE DO CUSTO
     *   A Meta aceita `metric=views,reach` com um `breakdown` só. Medido em
     *   2026-08-20: as duas voltam com a quebra de cada uma. Pedir separado
     *   dobraria as chamadas por dia por conta, e a execução já leva 12
     *   minutos.
     *
     * O CONJUNTO DE FAIXAS NÃO É FIXO
     *   Na mesma medição apareceram `DEFAULT_DO_NOT_USE` e `CAROUSEL_CONTAINER`
     *   em `media_product_type` — nenhum dos dois documentado. Por isso nada
     *   aqui filtra faixa: guarda-se o que veio, e a tela decide o que mostrar.
     */
    async quebrasDiarias(conta, janela) {
      const achadas: QuebraDiaria[] = [];
      const inicio = maiorData(janela.de, somarDias(janela.ate, -(DIAS_DE_TOTAL_VALUE - 1)));

      const PARES = [
        { metricas: 'views,reach', dimensao: 'follow_type' },
        { metricas: 'views,total_interactions', dimensao: 'media_product_type' },
      ] as const;

      for (let dia = inicio; dia <= janela.ate; dia = somarDias(dia, 1)) {
        for (const par of PARES) {
          try {
            const { corpo } = await pedir(
              `${GRAPH}/${conta}/insights?metric=${par.metricas}` +
                `&metric_type=total_value&breakdown=${par.dimensao}&period=day` +
                `&since=${dia}&until=${somarDias(dia, 1)}&${auth}`,
            );

            for (const m of ((corpo as { data?: unknown[] }).data ?? []) as Array<{
              name?: string;
              total_value?: {
                breakdowns?: Array<{
                  results?: Array<{ dimension_values?: string[]; value?: unknown }>;
                }>;
              };
            }>) {
              const buckets: Record<string, number> = {};
              for (const r of m.total_value?.breakdowns?.[0]?.results ?? []) {
                const chave = (r.dimension_values ?? []).join(', ');
                const valor = Number(r.value);
                if (chave !== '' && Number.isFinite(valor)) buckets[chave] = valor;
              }
              if (typeof m.name === 'string' && Object.keys(buckets).length > 0) {
                achadas.push({ day: dia, metric: m.name, dimension: par.dimensao, buckets });
              }
            }
          } catch (erro) {
            // Um par recusado num dia não custa os outros dias nem o outro par.
            // Limite e token vencido não são do par: sobem, em vez de as outras
            // treze chamadas queimarem a cota que acabou de estourar.
            repassarSeDeveParar(erro);
          }
        }
      }

      return achadas;
    },

    /**
     * Cada publicação, individualmente — F9f.
     *
     * DUAS LISTAS, E NÃO UMA
     *   `/media` traz post, carrossel e reel. Story NÃO aparece ali: tem borda
     *   própria, `/stories`, e só devolve o que ainda está no ar. É por isso
     *   que a coleta precisa rodar todo dia — o que a Meta apagou em 24 horas
     *   não volta por nenhum caminho.
     *
     * CADA TIPO TEM O SEU CONJUNTO DE MÉTRICAS
     *   Não é preferência: a API RECUSA a chamada inteira se um reel receber
     *   `profile_visits` ou `follows`. Medido em 2026-08-20 — erro 100, com a
     *   frase "does not support the profile_visits, follows metric for this
     *   media product type". Pedir o conjunto certo é obrigação, não economia.
     */
    async publicacoes(conta) {
      const achadas: Publicacao[] = [];

      const listar = async (url: string, comoStory: boolean) => {
        const { corpo } = await pedir(url);
        return (
          (corpo as {
            data?: Array<{
              id?: string;
              media_product_type?: string;
              media_type?: string;
              permalink?: string;
              caption?: string;
              thumbnail_url?: string;
              media_url?: string;
              timestamp?: string;
            }>;
          }).data ?? []
        ).map((m) => ({
          mediaId: String(m.id ?? ''),
          productType: (comoStory
            ? 'STORY'
            : m.media_product_type === 'REELS'
              ? 'REELS'
              : 'FEED') as Publicacao['productType'],
          mediaType: typeof m.media_type === 'string' ? m.media_type : null,
          permalink: typeof m.permalink === 'string' ? m.permalink : null,
          caption: typeof m.caption === 'string' ? m.caption : null,
          // Vídeo tem capa; foto não, e aí a própria imagem serve.
          thumbnailUrl:
            typeof m.thumbnail_url === 'string'
              ? m.thumbnail_url
              : typeof m.media_url === 'string'
                ? m.media_url
                : null,
          postedAt: typeof m.timestamp === 'string' ? m.timestamp : null,
          metrics: {} as Record<string, number>,
        }));
      };

      // `media_url` JUNTO com `thumbnail_url`, e não um ou outro: a Meta só
      // devolve `thumbnail_url` para VÍDEO, onde ele é o quadro de capa. Para
      // foto e carrossel o campo vem nulo, e a imagem está em `media_url`.
      //
      // Medido em 2026-08-20: uma publicação FEED/IMAGE voltou com miniatura
      // nula, e a aba Conteúdo ficaria com quadrados vazios onde o app do
      // Instagram mostra a imagem.
      const campos =
        'id,media_product_type,media_type,permalink,caption,thumbnail_url,media_url,timestamp';

      // AS MAIS RECENTES, SEM FILTRO DE DATA — e são duas razões.
      //
      // 1. A métrica de uma publicação é ACUMULADA desde que ela foi ao ar, não
      //    do dia. Recortá-la pela janela do relatório não faz sentido: um post
      //    de maio continua rendendo alcance em agosto.
      //
      // 2. `since`/`until` em `/media` só entende timestamp UNIX. Com data ISO
      //    a Meta devolve LISTA VAZIA — sem erro, sem aviso, zero itens.
      //    Medido em 2026-08-20: sem filtro, 60 publicações; com `since=
      //    2026-07-24`, nenhuma. Um parâmetro que falha em silêncio é pior que
      //    um que recusa, e a forma de não errar nele é não usá-lo.
      //
      // O teto é o que limita o custo, e limita melhor: conta que posta pouco
      // continua tendo relatório. Medido: um perfil da carteira não publica no
      // feed desde junho — pela janela, ele apareceria vazio para sempre.
      try {
        achadas.push(
          ...(await listar(
            `${GRAPH}/${conta}/media?fields=${campos}&limit=${TETO_DE_PUBLICACOES}&${auth}`,
            false,
          )),
        );
      } catch (erro) {
        // Sem a lista de publicações ainda dá para pegar os stories. É uma
        // troca deliberada: publicação é dado adicional, e derrubar o ativo
        // aqui desfaria o savepoint e custaria a série diária, que é o produto.
        //
        // A exceção é limite de uso e token vencido: aí a execução inteira
        // para (ver `repassarSeDeveParar`), e a conta volta na próxima.
        repassarSeDeveParar(erro);
      }

      try {
        achadas.push(
          ...(await listar(`${GRAPH}/${conta}/stories?fields=${campos}&limit=50&${auth}`, true)),
        );
      } catch (erro) {
        // Conta sem story no ar responde vazio; recusa aqui não custa o resto.
        repassarSeDeveParar(erro);
      }

      for (const p of achadas) {
        if (p.mediaId === '') continue;
        try {
          const { corpo } = await pedir(
            `${GRAPH}/${p.mediaId}/insights?metric=${METRICAS_DA_PUBLICACAO[p.productType]}&${auth}`,
          );
          for (const m of ((corpo as { data?: unknown[] }).data ?? []) as Array<{
            name?: string;
            values?: Array<{ value?: unknown }>;
          }>) {
            const valor = Number(m.values?.[0]?.value);
            if (typeof m.name === 'string' && Number.isFinite(valor)) p.metrics[m.name] = valor;
          }
        } catch (erro) {
          // Publicação muito nova, ou tipo sem insight: fica com os dados
          // cadastrais e sem métrica. Melhor que sumir da lista. Já limite de
          // uso não é da publicação: são até 75 chamadas seguidas no mesmo
          // erro, e só a primeira diz alguma coisa.
          repassarSeDeveParar(erro);
        }
      }

      return achadas.filter((p) => p.mediaId !== '');
    },
  };
}
