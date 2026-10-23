/**
 * As publicações — etapa F9f.
 *
 * A DIFERENÇA QUE MANDA NESTE ARQUIVO
 *   A série diária é do PERFIL: cada linha é um dia, e dias se somam (ou não,
 *   conforme `relatorio.ts`). Aqui cada linha é uma PUBLICAÇÃO, e a métrica
 *   dela é acumulada desde que foi ao ar — o alcance de um reel de maio
 *   continua subindo em agosto.
 *
 *   Consequência: não se soma alcance entre publicações. Duas publicações com
 *   1.000 de alcance não alcançaram 2.000 pessoas — provavelmente alcançaram
 *   quase as mesmas 1.000, porque são os mesmos seguidores. Pelo mesmo motivo
 *   de `relatorio.ts`: pessoas distintas não se somam.
 *
 *   O que se compara entre publicações é o DESEMPENHO DE CADA UMA, e é isso que
 *   este módulo entrega: mediana, melhor, e a taxa de engajamento.
 *
 * POR QUE MEDIANA, E NÃO MÉDIA
 *   Um reel viral multiplica a média e some com a informação. Se dez posts
 *   fizeram 500 e um fez 50.000, a média diz 5.000 — número que nenhum post
 *   fez, e que faria os dez parecerem fracassos. A mediana diz 500, que é o que
 *   se pode esperar do próximo.
 *
 *   A média continua disponível onde ela é a certa: em contagem de eventos.
 */

export type Publicacao = {
  id: string;
  mediaId: string;
  productType: 'FEED' | 'REELS' | 'STORY' | 'AD';
  mediaType: string | null;
  permalink: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  postedAt: string | null;
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saved: number | null;
  totalInteractions: number | null;
  profileVisits: number | null;
  follows: number | null;
  replies: number | null;
  navigation: number | null;

  /**
   * Se algum anuncio impulsionou esta publicacao — F9n.
   *
   * Quando e verdadeiro, TODOS os numeros acima incluem a entrega paga. O
   * Instagram nao separa, e nao ha como separar depois: o que da para fazer e
   * a tela DIZER, para ninguem comparar post pago com post organico como se
   * fossem a mesma coisa.
   */
  impulsionada?: boolean;
  anunciosQueImpulsionam?: number;
  investido?: number | null;
  /** So para dar ordem de grandeza. NAO se subtrai do alcance — ver o servidor. */
  alcancePago?: number | null;
};

/**
 * Os formatos, como a pessoa da agência fala deles.
 *
 * A Meta separa em dois eixos — onde publicou (`product_type`) e o que é
 * (`media_type`). "Carrossel" mora no segundo, "reel" no primeiro. Juntar os
 * dois num rótulo só é o que faz a tela falar a língua de quem usa.
 */
export type Formato = 'reel' | 'carrossel' | 'foto' | 'video' | 'story' | 'outro';

export function formatoDa(p: Publicacao): Formato {
  if (p.productType === 'STORY') return 'story';
  if (p.productType === 'REELS') return 'reel';
  if (p.mediaType === 'CAROUSEL_ALBUM') return 'carrossel';
  if (p.mediaType === 'IMAGE') return 'foto';
  if (p.mediaType === 'VIDEO') return 'video';
  return 'outro';
}

export const ROTULO_DO_FORMATO: Record<Formato, string> = {
  reel: 'Reels',
  carrossel: 'Carrossel',
  foto: 'Foto',
  video: 'Vídeo',
  story: 'Story',
  outro: 'Outro',
};

/* ─── contas que não inventam ──────────────────────────────────────────────── */

/** `null` quando o denominador é zero: taxa sem alcance não é 0%, é "não dá". */
export function taxaDeEngajamento(p: Publicacao): number | null {
  if (p.totalInteractions === null || p.reach === null || p.reach === 0) return null;
  return p.totalInteractions / p.reach;
}

/** A mediana dos valores conhecidos. `null` quando não há nenhum. */
export function mediana(valores: readonly (number | null)[]): number | null {
  const bons = valores.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (bons.length === 0) return null;
  const meio = Math.floor(bons.length / 2);
  // Par: a média dos dois centrais. Ímpar: o do meio.
  return bons.length % 2 === 0 ? (bons[meio - 1] + bons[meio]) / 2 : bons[meio];
}

export function somar(valores: readonly (number | null)[]): number | null {
  let total = 0;
  let houve = false;
  for (const v of valores) {
    if (v === null) continue;
    total += v;
    houve = true;
  }
  return houve ? total : null;
}

/* ─── o resumo por formato ─────────────────────────────────────────────────── */

export type ResumoDeFormato = {
  formato: Formato;
  quantidade: number;
  /** Mediana do alcance — ver o cabeçalho sobre por que não é média. */
  alcanceMediano: number | null;
  /** O melhor alcance do formato, e qual publicação foi. */
  melhorAlcance: number | null;
  melhorId: string | null;
  /** Interações SOMAM: são eventos, não pessoas. */
  interacoes: number | null;
  /** Mediana da taxa — a razão de cada publicação, não a razão das somas. */
  engajamentoMediano: number | null;
};

/**
 * Agrupa por formato e ordena pelo que mais rendeu alcance.
 *
 * A ordem responde "qual formato funciona melhor aqui", que é a pergunta que
 * abre esta tela. Formato sem alcance conhecido vai para o fim.
 */
export function porFormato(publicacoes: readonly Publicacao[]): ResumoDeFormato[] {
  const baldes = new Map<Formato, Publicacao[]>();
  for (const p of publicacoes) {
    const f = formatoDa(p);
    baldes.set(f, [...(baldes.get(f) ?? []), p]);
  }

  return [...baldes.entries()]
    .map(([formato, lista]) => {
      let melhor: Publicacao | null = null;
      for (const p of lista) {
        if (p.reach === null) continue;
        if (melhor === null || p.reach > (melhor.reach as number)) melhor = p;
      }

      return {
        formato,
        quantidade: lista.length,
        alcanceMediano: mediana(lista.map((p) => p.reach)),
        melhorAlcance: melhor?.reach ?? null,
        melhorId: melhor?.id ?? null,
        interacoes: somar(lista.map((p) => p.totalInteractions)),
        engajamentoMediano: mediana(lista.map(taxaDeEngajamento)),
      };
    })
    .sort((a, b) => (b.alcanceMediano ?? -1) - (a.alcanceMediano ?? -1));
}

/* ─── a lista ──────────────────────────────────────────────────────────────── */

export type Criterio = 'recentes' | 'alcance' | 'interacoes' | 'engajamento';

const VALOR: Record<Criterio, (p: Publicacao) => number | null> = {
  recentes: (p) => (p.postedAt === null ? null : Date.parse(p.postedAt)),
  alcance: (p) => p.reach,
  interacoes: (p) => p.totalInteractions,
  engajamento: taxaDeEngajamento,
};

/**
 * Ordena do maior para o menor, com o desconhecido SEMPRE no fim.
 *
 * "Sempre" inclusive quando se inverte a ordem: publicação sem alcance não é a
 * de menor alcance, é a que não se sabe — e ela subir ao topo faria a tela
 * afirmar o que não tem. É a mesma regra da carteira de clientes.
 */
export function ordenar(
  publicacoes: readonly Publicacao[],
  criterio: Criterio,
): Publicacao[] {
  const ler = VALOR[criterio];
  return [...publicacoes].sort((a, b) => {
    const va = ler(a);
    const vb = ler(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return vb - va;
  });
}

/** Filtra por formato. `null` devolve tudo. */
export const filtrarPorFormato = (
  publicacoes: readonly Publicacao[],
  formato: Formato | null,
): Publicacao[] =>
  formato === null ? [...publicacoes] : publicacoes.filter((p) => formatoDa(p) === formato);

/**
 * A primeira linha da legenda, para a lista não virar parede de texto.
 *
 * Corta na palavra, não no caractere: cortar no meio de uma palavra faz o
 * resumo parecer defeito de renderização.
 */
export function resumoDaLegenda(caption: string | null, limite = 70): string {
  if (caption === null) return '(sem legenda)';
  const primeira = caption.split('\n')[0].trim();
  if (primeira.length <= limite) return primeira;

  const cortado = primeira.slice(0, limite);
  const ultimoEspaco = cortado.lastIndexOf(' ');
  return `${ultimoEspaco > limite * 0.6 ? cortado.slice(0, ultimoEspaco) : cortado}…`;
}
