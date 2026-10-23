/**
 * O catálogo de métricas escolhíveis — etapa F10j.
 *
 * POR QUE ISTO EXISTE
 *   As tabelas de campanha e de anúncio tinham colunas fixas: investido,
 *   resultado da família, custo por resultado, alcance, CTR. Serve para a
 *   leitura de sempre e não serve para a pergunta de hoje — "quantos leads o
 *   site trouxe", "quantas conversas começaram", "quanto custou cada
 *   salvamento".
 *
 *   A Meta guarda 73 tipos de ação diferentes na nossa base. Eles já estavam
 *   coletados, CRUS, desde a F10a — a decisão de guardar sem interpretar é o
 *   que torna isto possível agora sem coletar nada de novo.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A REGRA QUE SUSTENTA O SELETOR: SÓ SE OFERECE O QUE TEM DADO
 * ═══════════════════════════════════════════════════════════════════════════
 *   Oferecer as 73 faria uma lista onde 60 devolvem coluna vazia. E coluna
 *   vazia não é neutra: ela é lida como "zero", que é uma afirmação — "esta
 *   campanha não gerou nenhuma compra" quando na verdade aquela conta nunca
 *   mediu compra.
 *
 *   Por isso o catálogo é MONTADO A PARTIR DAS LINHAS que estão na tela.
 *   Muda de conta, muda a lista. É mais trabalho e é a única forma honesta.
 *
 * O NOME EM PORTUGUÊS NÃO É ENFEITE
 *   `onsite_conversion.messaging_conversation_started_7d` não diz nada para
 *   quem vai ler o relatório. Mas o nome cru continua acessível na dica, porque
 *   é ele que permite conferir contra o gerenciador da Meta — e conferir é o
 *   que faz o número valer.
 */

/** Uma linha de campanha ou de anúncio: as duas têm a mesma forma numérica. */
export type LinhaComMetricas = {
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  linkClicks: number | null;
  alcanceAprox: number | null;
  acoes: { action_type: string; value: number }[];
};

export type Formato = 'dinheiro' | 'inteiro' | 'percentual';

export type Metrica = {
  /** `spend`, `ctr`, `acao:lead`, `custo:lead` — estável, vai para o que se guarda. */
  chave: string;
  rotulo: string;
  formato: Formato;
  grupo: 'Entrega' | 'Custo' | 'Resultado' | 'Envolvimento';
  /** O nome cru da Meta, quando houver. É o que permite conferir lá. */
  origem?: string;
};

/**
 * As que sempre existem, porque vêm de coluna e não de ação.
 *
 * `alcance` carrega a ressalva no rótulo: ele conta pessoas distintas e aqui
 * está somado entre dias, então infla. Mantê-lo sem aviso seria o número mais
 * fácil de citar errado num relatório de cliente.
 */
export const METRICAS_BASE: Metrica[] = [
  { chave: 'spend', rotulo: 'Investido', formato: 'dinheiro', grupo: 'Entrega' },
  { chave: 'impressions', rotulo: 'Impressões', formato: 'inteiro', grupo: 'Entrega' },
  { chave: 'reach', rotulo: 'Alcance (aprox.)', formato: 'inteiro', grupo: 'Entrega' },
  { chave: 'clicks', rotulo: 'Cliques', formato: 'inteiro', grupo: 'Entrega' },
  { chave: 'link_clicks', rotulo: 'Cliques no link', formato: 'inteiro', grupo: 'Entrega' },
  { chave: 'ctr', rotulo: 'CTR', formato: 'percentual', grupo: 'Entrega' },
  { chave: 'cpm', rotulo: 'CPM', formato: 'dinheiro', grupo: 'Custo' },
  { chave: 'cpc', rotulo: 'CPC', formato: 'dinheiro', grupo: 'Custo' },
  { chave: 'frequencia', rotulo: 'Frequência', formato: 'inteiro', grupo: 'Entrega' },
];

/**
 * O dicionário do que a Meta chama por dentro.
 *
 * Só as que aparecem na base de verdade — conferido em 2026-08-24. O que não
 * estiver aqui aparece com o nome cru, que é feio e honesto: melhor uma
 * etiqueta técnica do que um nome inventado que descreva outra coisa.
 */
const NOME_DA_ACAO: Record<string, string> = {
  // mensagem
  'onsite_conversion.messaging_conversation_started_7d': 'Conversas iniciadas',
  'onsite_conversion.total_messaging_connection': 'Conexões por mensagem',
  'onsite_conversion.messaging_first_reply': 'Primeiras respostas',
  'onsite_conversion.messaging_conversation_replied_7d': 'Conversas respondidas',
  'onsite_conversion.messaging_user_depth_2_message_send': 'Conversas com 2 mensagens',
  'onsite_conversion.messaging_user_depth_3_message_send': 'Conversas com 3 mensagens',
  'onsite_conversion.messaging_user_depth_5_message_send': 'Conversas com 5 mensagens',
  'onsite_conversion.messaging_block': 'Bloqueios',

  // lead
  lead: 'Leads',
  'onsite_conversion.lead_grouped': 'Leads (agrupados)',
  onsite_web_lead: 'Leads no site',
  offsite_complete_registration_add_meta_leads: 'Cadastros completos',
  offsite_content_view_add_meta_leads: 'Conteúdo visto (leads)',
  offsite_search_add_meta_leads: 'Buscas (leads)',

  // site
  link_click: 'Cliques no link',
  landing_page_view: 'Visualizações da página de destino',
  omni_landing_page_view: 'Visualizações da página (todas as origens)',
  view_content: 'Visualizações de conteúdo',
  omni_view_content: 'Visualizações de conteúdo (todas as origens)',
  onsite_web_view_content: 'Visualizações de conteúdo no site',
  'offsite_conversion.fb_pixel_view_content': 'Conteúdo visto (pixel)',
  'offsite_conversion.fb_pixel_add_to_cart': 'Adições ao carrinho',
  'offsite_conversion.fb_pixel_purchase': 'Compras',
  'offsite_conversion.fb_pixel_lead': 'Leads (pixel)',
  purchase: 'Compras',
  add_to_cart: 'Adições ao carrinho',
  initiate_checkout: 'Finalizações iniciadas',

  // envolvimento
  page_engagement: 'Envolvimento com a página',
  post_engagement: 'Envolvimento com a publicação',
  post_interaction_net: 'Interações (líquidas)',
  post_interaction_gross: 'Interações (brutas)',
  post_reaction: 'Reações',
  'onsite_conversion.post_net_like': 'Curtidas',
  'onsite_conversion.post_unlike': 'Descurtidas',
  'onsite_conversion.post_save': 'Salvamentos',
  'onsite_conversion.post_unsave': 'Salvamentos desfeitos',
  'onsite_conversion.post_net_comment': 'Comentários (líquidos)',
  'onsite_conversion.post_net_save': 'Salvamentos (líquidos)',
  comment: 'Comentários',
  like: 'Curtidas',
  post: 'Compartilhamentos',
  video_view: 'Visualizações de vídeo',
};

/** Em qual gaveta a ação cai, para a lista não virar um monte só. */
function grupoDaAcao(tipo: string): Metrica['grupo'] {
  if (/messag|lead|purchase|checkout|cart|registration/i.test(tipo)) return 'Resultado';
  if (/landing_page|view_content|link_click/i.test(tipo)) return 'Resultado';
  return 'Envolvimento';
}

export const rotuloDaAcao = (tipo: string) => NOME_DA_ACAO[tipo] ?? tipo;

/**
 * O catálogo do que está na tela AGORA.
 *
 * Ver o cabeçalho: só entra ação que tem valor em alguma das linhas. Uma ação
 * presente com valor zero em todas conta como ausente — ela existe no retorno
 * da Meta por completude, e não porque foi medida.
 */
export function catalogoDe(linhas: LinhaComMetricas[]): Metrica[] {
  const comValor = new Set<string>();
  for (const l of linhas) {
    for (const a of l.acoes) {
      if (a.value > 0) comValor.add(a.action_type);
    }
  }

  const daAcao: Metrica[] = [];
  for (const tipo of [...comValor].sort((a, b) => rotuloDaAcao(a).localeCompare(rotuloDaAcao(b), 'pt-BR'))) {
    const rotulo = rotuloDaAcao(tipo);
    const grupo = grupoDaAcao(tipo);
    daAcao.push({ chave: `acao:${tipo}`, rotulo, formato: 'inteiro', grupo, origem: tipo });
    // O CUSTO POR AÇÃO É A COLUNA QUE RESPONDE "FOI CARO?".
    // "42 conversas" não diz nada sozinho; "R$ 3,80 por conversa" diz.
    daAcao.push({
      chave: `custo:${tipo}`,
      rotulo: `Custo/${rotulo.toLowerCase()}`,
      formato: 'dinheiro',
      grupo: 'Custo',
      origem: tipo,
    });
  }

  return [...METRICAS_BASE, ...daAcao];
}

const somaDaAcao = (l: LinhaComMetricas, tipo: string) =>
  l.acoes.filter((a) => a.action_type === tipo).reduce((s, a) => s + a.value, 0);

const dividir = (a: number | null, b: number | null) =>
  a === null || b === null || b === 0 ? null : a / b;

/**
 * O valor de uma métrica numa linha.
 *
 * Devolve `null`, e não zero, quando não há como calcular. Zero é uma
 * afirmação — "custou zero por lead" —, e `null` vira travessão na tela, que
 * é a leitura certa de "não dá para dizer".
 */
export function valorDaMetrica(chave: string, l: LinhaComMetricas): number | null {
  switch (chave) {
    case 'spend':
      return l.spend;
    case 'impressions':
      return l.impressions;
    case 'reach':
      return l.alcanceAprox;
    case 'clicks':
      return l.clicks;
    case 'link_clicks':
      return l.linkClicks;
    case 'ctr':
      return dividir(l.clicks, l.impressions);
    case 'cpm':
      return dividir(l.spend, l.impressions) === null ? null : (l.spend! / l.impressions!) * 1000;
    case 'cpc':
      return dividir(l.spend, l.clicks);
    case 'frequencia':
      return dividir(l.impressions, l.alcanceAprox);
    default:
      break;
  }

  if (chave.startsWith('acao:')) {
    const tipo = chave.slice(5);
    const v = somaDaAcao(l, tipo);
    // Ação que não veio é diferente de ação que veio zerada — mas as duas
    // significam "não aconteceu", e zero é a leitura certa aqui.
    return v;
  }

  if (chave.startsWith('custo:')) {
    const tipo = chave.slice(6);
    return dividir(l.spend, somaDaAcao(l, tipo) || null);
  }

  return null;
}

/** As colunas com que a tela abre, quando ninguém escolheu nada ainda. */
export const PADRAO = ['spend', 'reach', 'ctr'];
