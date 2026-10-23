/**
 * O que cada campanha está tentando fazer — etapa F10a.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 *   A tela de campanhas mostrava as mesmas colunas para todas: gasto,
 *   impressões, cliques, CTR, resultados. Só que "resultado" não é uma coisa
 *   só. Uma campanha de mensagem quer CONVERSA INICIADA; uma de vendas quer
 *   COMPRA; uma de engajamento quer curtida, comentário e salvamento; uma de
 *   alcance quer gente vendo.
 *
 *   Mostrar "11 resultados" para uma e "612" para outra, na mesma coluna, é
 *   comparar coisas que não se comparam — e a leitura sai errada nas duas.
 *
 * DOIS VOCABULÁRIOS PARA A MESMA COISA, E OS DOIS ESTÃO EM USO
 *   A Meta trocou os nomes dos objetivos (o chamado ODAX) e não migrou o
 *   histórico. Medido na carteira em 2026-08-21, as duas gerações convivem:
 *
 *     OUTCOME_ENGAGEMENT  175   POST_ENGAGEMENT   10
 *     OUTCOME_SALES        60   CONVERSIONS        2
 *     OUTCOME_LEADS        34   LEAD_GENERATION    4
 *     OUTCOME_TRAFFIC      24   LINK_CLICKS       34
 *     MESSAGES             59
 *     OUTCOME_AWARENESS     6
 *
 *   Pior: o mesmo anúncio devolve `OUTCOME_TRAFFIC` quando se pergunta à
 *   campanha e `LINK_CLICKS` quando se pergunta ao insight. Tratar os dois
 *   nomes como objetivos diferentes partiria a mesma campanha em duas.
 *
 *   Por isso existe FAMÍLIA: o nome da Meta é a entrada, a família é o que a
 *   tela usa.
 *
 * A LISTA É ORDENADA, E A ORDEM É A REGRA
 *   Uma campanha de mensagem devolve dezenas de tipos de ação ao mesmo tempo —
 *   `messaging_conversation_started_7d`, `total_messaging_connection`,
 *   `messaging_first_reply`, e mais cinco de profundidade de conversa. Todos
 *   são verdade; só um é O resultado.
 *
 *   A ordem de `acoes` é a ordem de preferência, e a primeira que existir
 *   ganha. Sem isso, somar tudo contaria a mesma conversa cinco vezes.
 */

export type Familia =
  | 'mensagem'
  | 'leads'
  | 'vendas'
  | 'trafego'
  | 'engajamento'
  | 'alcance'
  | 'outro';

/**
 * De cada nome da Meta para a família. As duas gerações, medidas na carteira.
 *
 * Nome desconhecido cai em `outro` em vez de virar `engajamento` por descuido —
 * a Meta acrescenta objetivo, e chutar a família faria a tela cobrar o
 * resultado errado de uma campanha inteira.
 */
const FAMILIA_POR_OBJETIVO: Record<string, Familia> = {
  // mensagem
  MESSAGES: 'mensagem',
  OUTCOME_MESSAGES: 'mensagem',
  // leads
  OUTCOME_LEADS: 'leads',
  LEAD_GENERATION: 'leads',
  // vendas
  OUTCOME_SALES: 'vendas',
  CONVERSIONS: 'vendas',
  PRODUCT_CATALOG_SALES: 'vendas',
  // tráfego
  OUTCOME_TRAFFIC: 'trafego',
  LINK_CLICKS: 'trafego',
  // engajamento
  OUTCOME_ENGAGEMENT: 'engajamento',
  POST_ENGAGEMENT: 'engajamento',
  PAGE_LIKES: 'engajamento',
  EVENT_RESPONSES: 'engajamento',
  // alcance
  OUTCOME_AWARENESS: 'alcance',
  REACH: 'alcance',
  BRAND_AWARENESS: 'alcance',
  VIDEO_VIEWS: 'alcance',
};

export const familiaDoObjetivo = (objetivo: string | null): Familia =>
  objetivo === null ? 'outro' : (FAMILIA_POR_OBJETIVO[objetivo.toUpperCase()] ?? 'outro');

export const ROTULO_DA_FAMILIA: Record<Familia, string> = {
  mensagem: 'Mensagem',
  leads: 'Leads',
  vendas: 'Vendas',
  trafego: 'Tráfego',
  engajamento: 'Engajamento',
  alcance: 'Alcance',
  outro: 'Outro objetivo',
};

/**
 * O que conta como RESULTADO em cada família.
 *
 * `acoes` está em ordem de preferência: a primeira que a campanha tiver é a que
 * vale. `coluna` existe para a família cujo resultado não é uma ação e sim uma
 * métrica de entrega — alcance é gente alcançada, não evento disparado.
 *
 * Os nomes de ação foram medidos na carteira em 2026-08-21, não copiados da
 * documentação.
 */
export type DefinicaoDeResultado = {
  rotulo: string;
  /** O nome no singular, para o custo por resultado ("custo por conversa"). */
  unidade: string;
  acoes: readonly string[];
  coluna?: 'reach' | 'impressions' | 'clicks' | 'linkClicks';
};

export const RESULTADO_DA_FAMILIA: Record<Familia, DefinicaoDeResultado> = {
  mensagem: {
    rotulo: 'Conversas iniciadas',
    unidade: 'conversa',
    // `total_messaging_connection` vem junto e é maior; ela conta conexão, não
    // conversa aberta. A que a Meta mostra como resultado é a primeira.
    acoes: [
      'onsite_conversion.messaging_conversation_started_7d',
      'onsite_conversion.total_messaging_connection',
    ],
  },
  leads: {
    rotulo: 'Leads',
    unidade: 'lead',
    acoes: ['lead', 'onsite_conversion.lead_grouped', 'onsite_web_lead'],
  },
  vendas: {
    rotulo: 'Compras',
    unidade: 'compra',
    acoes: [
      'omni_purchase',
      'offsite_conversion.fb_pixel_purchase',
      'purchase',
      'web_in_store_purchase',
    ],
  },
  trafego: {
    rotulo: 'Visitas ao destino',
    unidade: 'visita',
    // `landing_page_view` é quem CHEGOU; `link_click` é quem clicou. A
    // diferença entre os dois é a página que não carregou, e é informação.
    acoes: ['landing_page_view', 'omni_landing_page_view', 'link_click'],
  },
  engajamento: {
    rotulo: 'Engajamento',
    unidade: 'interação',
    acoes: ['post_engagement', 'page_engagement'],
  },
  alcance: {
    rotulo: 'Alcance',
    unidade: 'pessoa',
    acoes: [],
    coluna: 'reach',
  },
  outro: {
    rotulo: 'Resultados',
    unidade: 'resultado',
    // Sem saber o objetivo, o clique é o denominador comum honesto.
    acoes: ['link_click', 'post_engagement'],
  },
};

/* ─── ler as ações ─────────────────────────────────────────────────────────── */

export type Acao = { action_type?: string; value?: unknown };

/** Soma um tipo de ação. `null` quando ele não aparece — não é zero. */
export function valorDaAcao(acoes: readonly Acao[], tipo: string): number | null {
  let total = 0;
  let houve = false;
  for (const a of acoes) {
    if (a.action_type !== tipo) continue;
    const v = Number(a.value);
    if (!Number.isFinite(v)) continue;
    total += v;
    houve = true;
  }
  return houve ? total : null;
}

export type Resultado = {
  valor: number | null;
  /** Qual ação foi usada — a tela mostra, e é o que torna o número auditável. */
  origem: string | null;
};

/**
 * O resultado de uma família, a partir das ações e das colunas.
 *
 * A PRIMEIRA QUE EXISTIR GANHA, e as outras são ignoradas. Somar todas contaria
 * a mesma conversa cinco vezes — ver o cabeçalho.
 */
export function resultadoDe(
  familia: Familia,
  acoes: readonly Acao[],
  colunas: { reach?: number | null; impressions?: number | null; clicks?: number | null; linkClicks?: number | null } = {},
): Resultado {
  const def = RESULTADO_DA_FAMILIA[familia];

  if (def.coluna) {
    const v = colunas[def.coluna] ?? null;
    return { valor: v, origem: v === null ? null : def.coluna };
  }

  for (const tipo of def.acoes) {
    const v = valorDaAcao(acoes, tipo);
    if (v !== null) return { valor: v, origem: tipo };
  }
  return { valor: null, origem: null };
}

/* ─── os rankings ──────────────────────────────────────────────────────────── */

/**
 * As perguntas que um ranking responde.
 *
 * Cada uma é "qual criativo entregou mais X". `resultado` é especial: o X
 * depende do objetivo da campanha, e por isso ele é resolvido por família em
 * vez de por um nome fixo de ação.
 */
export type ChaveDeRanking =
  | 'resultado'
  | 'curtidas'
  | 'comentarios'
  | 'salvamentos'
  | 'compartilhamentos'
  | 'alcance'
  | 'visualizacoes'
  | 'cliques'
  | 'custo_por_resultado';

export type DefinicaoDeRanking = {
  rotulo: string;
  /** A pergunta em uma linha, para a tela dizer o que está ordenando. */
  pergunta: string;
  acao?: string;
  coluna?: 'reach' | 'impressions' | 'clicks' | 'spend';
  /** Custo: menor é melhor, e a ordem se inverte. */
  menorMelhor?: boolean;
};

export const RANKINGS: Record<ChaveDeRanking, DefinicaoDeRanking> = {
  resultado: {
    rotulo: 'Resultado',
    pergunta: 'qual criativo entregou mais do que a campanha foi buscar',
  },
  curtidas: {
    rotulo: 'Curtidas',
    pergunta: 'qual criativo foi mais curtido',
    acao: 'post_reaction',
  },
  comentarios: {
    rotulo: 'Comentários',
    pergunta: 'qual criativo gerou mais conversa embaixo do post',
    acao: 'comment',
  },
  salvamentos: {
    rotulo: 'Salvamentos',
    pergunta: 'qual criativo as pessoas guardaram para depois',
    acao: 'onsite_conversion.post_save',
  },
  compartilhamentos: {
    rotulo: 'Compartilhamentos',
    pergunta: 'qual criativo as pessoas passaram adiante',
    acao: 'post',
  },
  alcance: {
    rotulo: 'Alcance',
    pergunta: 'qual criativo chegou a mais gente',
    coluna: 'reach',
  },
  visualizacoes: {
    rotulo: 'Visualizações',
    pergunta: 'qual vídeo foi mais assistido',
    acao: 'video_view',
  },
  cliques: {
    rotulo: 'Cliques no link',
    pergunta: 'qual criativo levou mais gente para fora',
    acao: 'link_click',
  },
  custo_por_resultado: {
    rotulo: 'Custo por resultado',
    pergunta: 'qual criativo entregou mais barato',
    menorMelhor: true,
  },
};

/**
 * Quais rankings fazem sentido para cada família.
 *
 * Oferecer "visualizações" numa campanha de vendas, ou "compras" numa de
 * alcance, enche a tela de abas vazias — e aba vazia ensina que a tela está
 * quebrada.
 */
export const RANKINGS_DA_FAMILIA: Record<Familia, readonly ChaveDeRanking[]> = {
  mensagem: ['resultado', 'custo_por_resultado', 'alcance', 'cliques'],
  leads: ['resultado', 'custo_por_resultado', 'alcance', 'cliques'],
  vendas: ['resultado', 'custo_por_resultado', 'cliques', 'alcance'],
  trafego: ['resultado', 'custo_por_resultado', 'cliques', 'alcance'],
  engajamento: [
    'resultado',
    'curtidas',
    'comentarios',
    'salvamentos',
    'compartilhamentos',
    'alcance',
    'visualizacoes',
  ],
  alcance: ['alcance', 'visualizacoes', 'custo_por_resultado', 'curtidas'],
  outro: ['resultado', 'alcance', 'cliques', 'curtidas'],
};
