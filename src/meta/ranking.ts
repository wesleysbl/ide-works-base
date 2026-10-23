/**
 * Ordenar criativos — etapa F10c.
 *
 * O QUE ESTE MÓDULO DECIDE
 *   Dado um punhado de criativos e uma pergunta ("qual deu mais lead?"), qual é
 *   a ordem. A pergunta muda o número que se lê, e às vezes muda até a direção:
 *   em custo por resultado, o primeiro lugar é o MENOR.
 *
 * O RESULTADO DEPENDE DA CAMPANHA, NÃO DO CRIATIVO
 *   Um criativo não tem objetivo — quem tem é a campanha em que ele roda. Por
 *   isso `valorNoRanking` recebe a família junto: o mesmo anúncio, numa campanha
 *   de mensagem, tem como resultado a conversa iniciada; noutra de tráfego,
 *   a visita ao destino.
 *
 *   Quando o ranking mistura campanhas de objetivos diferentes — "todas as
 *   famílias" —, cada criativo é medido pelo objetivo da SUA campanha. Somar
 *   conversas com compras daria um número que não significa nada; ordenar
 *   "quanto cada um entregou do que foi buscar" significa.
 */

import {
  type Acao,
  type ChaveDeRanking,
  type Familia,
  RANKINGS,
  familiaDoObjetivo,
  resultadoDe,
  valorDaAcao,
} from '@/meta/objetivos';

export type Criativo = {
  adId: string;
  nome: string | null;
  campanha: string | null;
  objetivo: string | null;
  conta: string | null;
  gerenciador: string | null;
  miniatura: string | null;
  situacao: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  linkClicks: number | null;
  alcanceAprox: number | null;
  dias: number;
  acoes: Acao[];
};

/** A família da campanha em que o criativo rodou. */
export const familiaDoCriativo = (c: Criativo): Familia => familiaDoObjetivo(c.objetivo);

/**
 * O número que o ranking lê.
 *
 * `null` quando não dá para responder — e `null` é diferente de zero: "esta
 * campanha não mede compra" não é "houve zero compras".
 */
export function valorNoRanking(c: Criativo, chave: ChaveDeRanking): number | null {
  const familia = familiaDoCriativo(c);
  const def = RANKINGS[chave];

  if (chave === 'resultado') {
    return resultadoDe(familia, c.acoes, {
      reach: c.alcanceAprox,
      impressions: c.impressions,
      clicks: c.clicks,
      linkClicks: c.linkClicks,
    }).valor;
  }

  if (chave === 'custo_por_resultado') {
    const r = resultadoDe(familia, c.acoes, {
      reach: c.alcanceAprox,
      impressions: c.impressions,
      clicks: c.clicks,
      linkClicks: c.linkClicks,
    }).valor;
    // Sem gasto ou sem resultado não há custo. Zero resultado com gasto não é
    // "custo zero": é custo infinito, que não se ordena — fica de fora.
    if (c.spend === null || r === null || r === 0) return null;
    return c.spend / r;
  }

  if (def.coluna === 'reach') return c.alcanceAprox;
  if (def.coluna === 'impressions') return c.impressions;
  if (def.coluna === 'clicks') return c.clicks;
  if (def.coluna === 'spend') return c.spend;
  if (def.acao) return valorDaAcao(c.acoes, def.acao);

  return null;
}

/**
 * Ordena para o ranking.
 *
 * O DESCONHECIDO FICA SEMPRE NO FIM, inclusive quando a ordem se inverte por
 * ser custo. Criativo sem lead não é o de menor custo por lead: é o que não tem
 * custo por lead. Subir ao topo faria a tela premiar quem não entregou.
 */
export function ordenarRanking(
  criativos: readonly Criativo[],
  chave: ChaveDeRanking,
): { criativo: Criativo; valor: number | null }[] {
  const menorMelhor = RANKINGS[chave].menorMelhor === true;

  return criativos
    .map((criativo) => ({ criativo, valor: valorNoRanking(criativo, chave) }))
    .sort((a, b) => {
      if (a.valor === null && b.valor === null) return 0;
      if (a.valor === null) return 1;
      if (b.valor === null) return -1;
      return menorMelhor ? a.valor - b.valor : b.valor - a.valor;
    });
}

/** Só os criativos de uma família. `null` devolve todos. */
export const filtrarPorFamilia = (
  criativos: readonly Criativo[],
  familia: Familia | null,
): Criativo[] =>
  familia === null ? [...criativos] : criativos.filter((c) => familiaDoCriativo(c) === familia);

/**
 * Quantos criativos há por família, para as abas mostrarem contagem e para as
 * vazias não aparecerem.
 */
export function contarPorFamilia(criativos: readonly Criativo[]): Map<Familia, number> {
  const mapa = new Map<Familia, number>();
  for (const c of criativos) {
    const f = familiaDoCriativo(c);
    mapa.set(f, (mapa.get(f) ?? 0) + 1);
  }
  return mapa;
}
