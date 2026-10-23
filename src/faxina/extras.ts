/**
 * AS PEÇAS QUE NASCERAM EXTRA POR ENGANO — F44, Fase 4. Puro: recebe o que foi
 * lido do banco e decide quais extras voltam para a base.
 *
 * DE ONDE VEIO O ENGANO
 *   Até o commit `58a4c80` (PR #2), `POST /items` sem `isExtra` — o "+" da
 *   grade de Semanas e o "+ Peça" do calendário — comparava a base só com o
 *   contrato do mês. Mês ainda não aberto não tem contrato: a cota dava zero e
 *   toda peça planejada antes da abertura nascia `is_extra = true`. E
 *   `open_month` congela a cota sem reclassificar nada — as peças ficavam
 *   extras para sempre. O servidor parou de errar; o que já foi gravado errado
 *   se conserta com esta regra.
 *
 * A REGRA — a do servidor desde `58a4c80`, confirmada pelo Wesley em 09/10/2026
 *   Num cliente, mês e tipo de peça: se a base (`is_extra = false`) é menor que
 *   a cota daquele mês, os extras daquele mês e tipo ocupam as vagas, do mais
 *   antigo (`created_at`) para o mais novo, até completar a cota. O que sobra
 *   continua extra. Cada tipo conta separado.
 *
 *   A cota sai de `resolvePlanningQuota`, a MESMA conta da grade de Semanas e
 *   de `POST /items`: mês ABERTO vale o contrato congelado, mesmo vazio
 *   (F17.57); mês sem contrato vale o cadastro de hoje (`client_quotas`,
 *   quantidade > 0); sem nenhum dos dois, cota zero — e nada muda.
 *
 * SÓ O EXTRA CRIADO ANTES DE O MÊS ABRIR É CANDIDATO
 *   O plano supunha que "extra de propósito só existe com a base cheia". Não é
 *   bem assim: a ficha do cliente tem "Acrescentar extra" (`Cliente.tsx`), que
 *   aparece com o mês aberto e grava `isExtra: true` sem olhar a base. Com o
 *   mês aberto, todo caminho de criação já comparava com o contrato certo — o
 *   engano só existia ANTES da abertura. Então o candidato é o extra de mês
 *   nunca aberto, ou criado antes de `opened_at`; o criado depois fica como
 *   está, e o relatório o mostra à parte (`extraDepoisDaAbertura`).
 *
 * IDEMPOTENTE POR CONSTRUÇÃO
 *   O extra que vira base passa a contar na base. Rodar de novo acha vaga zero.
 *
 * SÓ O MÊS CORRENTE E OS SEGUINTES (padrão confirmado em 09/10/2026)
 *   Mês passado mudaria o nível de entrega que já foi visto e cobrado. Entra só
 *   com `aPartirDe = null` (o `--incluir-passados` do script).
 */

import type { ContentType } from '@/delivery/level';
import {
  type QuotaSource,
  quotasDoCadastro,
  quotasDoContrato,
  resolvePlanningQuota,
} from '@/server/planning-weeks';
import { hojeNaAgencia } from '@/ui/grade-do-mes';

/** Uma peça (`content_items`) de cliente ativo, como a leitura devolve. */
export type PecaLida = {
  id: string;
  clientId: string;
  /** `AAAA-MM-01` — o mês de competência, o que o contrato cobra. */
  referenceMonth: string;
  contentType: string;
  isExtra: boolean;
  title: string | null;
  /** ISO em UTC, com microssegundo — a ordem "da mais antiga para a mais nova". */
  createdAt: string;
  /** ISO em UTC, com microssegundo — o que o desfazer devolve. */
  updatedAt: string;
};

/** Uma linha de `month_contracts` com junção à esquerda nos itens. */
export type LinhaDoContrato = {
  clientId: string;
  referenceMonth: string;
  /** ISO em UTC, com microssegundo — quando o mês foi aberto. */
  openedAt: string;
  contentType: string | null;
  quantity: number;
};

/** Uma linha de `client_quotas` — o cadastro de hoje. */
export type LinhaDoCadastro = { clientId: string; contentType: string; quantity: number };

/**
 * Por que o grupo fica como está, ou não:
 *   vaga                       base menor que a cota — extras de antes da abertura viram base;
 *   base-cheia                 a base já cobre a cota — o extra é extra de verdade;
 *   sem-cota                   cota zero (mês aberto vazio, ou nem contrato nem cadastro);
 *   extra-depois-da-abertura   há vaga, mas todo extra foi criado com o mês já aberto.
 */
export type Motivo = 'vaga' | 'base-cheia' | 'sem-cota' | 'extra-depois-da-abertura';

/** Um cliente, mês e tipo que TEM extra. */
export type GrupoComExtra = {
  clientId: string;
  referenceMonth: string;
  contentType: ContentType;
  fonte: QuotaSource;
  cota: number;
  base: number;
  /** Todos os extras do grupo, do mais antigo para o mais novo. */
  extras: PecaLida[];
  /** Os extras criados com o mês JÁ aberto — nunca candidatos. */
  extraDepoisDaAbertura: PecaLida[];
  /** Os primeiros `cota − base` candidatos — os que voltam para a base. */
  viramBase: PecaLida[];
  motivo: Motivo;
};

/** O primeiro dia do mês corrente em São Paulo — `AAAA-MM-01`. */
export function mesCorrenteNaAgencia(agora: Date = new Date()): string {
  return `${hojeNaAgencia(agora).slice(0, 7)}-01`;
}

/** Da mais antiga para a mais nova; o id desempata (duas no mesmo microssegundo). */
function maisAntigaPrimeiro(a: PecaLida, b: PecaLida): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Decide, grupo a grupo (cliente · mês · tipo), quais extras viram base.
 *
 * Devolve SÓ os grupos que têm extra — os outros não têm o que mudar —, na
 * ordem cliente, mês, tipo. Quem chama soma `viramBase` para gravar.
 *
 * @param aPartirDe `AAAA-MM-01`: meses antes dele ficam de fora. `null` = todos.
 */
export function planejarReclassificacao(entrada: {
  pecas: readonly PecaLida[];
  contratos: readonly LinhaDoContrato[];
  cadastro: readonly LinhaDoCadastro[];
  aPartirDe: string | null;
}): GrupoComExtra[] {
  const { aPartirDe } = entrada;
  const noRecorte = (mes: string) => aPartirDe === null || mes >= aPartirDe;

  // O contrato é POR MÊS: `quotasDoContrato` recebe as linhas de um mês só.
  const linhasPorMes = new Map<string, LinhaDoContrato[]>();
  const abertoEm = new Map<string, string>();
  for (const l of entrada.contratos) {
    if (!noRecorte(l.referenceMonth)) continue;
    const lista = linhasPorMes.get(l.referenceMonth) ?? [];
    lista.push(l);
    linhasPorMes.set(l.referenceMonth, lista);
    abertoEm.set(`${l.clientId}|${l.referenceMonth}`, l.openedAt);
  }
  const contratoPorMes = new Map<string, ReturnType<typeof quotasDoContrato>>();
  const contratoDoMes = (mes: string) => {
    let c = contratoPorMes.get(mes);
    if (!c) {
      c = quotasDoContrato(linhasPorMes.get(mes) ?? []);
      contratoPorMes.set(mes, c);
    }
    return c;
  };

  // Cota zero no cadastro é "sem cota" — o mesmo `quantity > 0` da grade de
  // Semanas e de `POST /items`.
  const cadastro = quotasDoCadastro(entrada.cadastro.filter((q) => Number(q.quantity) > 0));

  type Acumulado = { clientId: string; referenceMonth: string; contentType: ContentType; base: number; extras: PecaLida[] };
  const grupos = new Map<string, Acumulado>();
  for (const p of entrada.pecas) {
    if (!noRecorte(p.referenceMonth)) continue;
    const chave = `${p.clientId}|${p.referenceMonth}|${p.contentType}`;
    let g = grupos.get(chave);
    if (!g) {
      g = { clientId: p.clientId, referenceMonth: p.referenceMonth, contentType: p.contentType as ContentType, base: 0, extras: [] };
      grupos.set(chave, g);
    }
    if (p.isExtra) g.extras.push(p);
    else g.base += 1;
  }

  const saida: GrupoComExtra[] = [];
  for (const g of grupos.values()) {
    if (g.extras.length === 0) continue;
    const contrato = contratoDoMes(g.referenceMonth);
    const { quotaSource, quota } = resolvePlanningQuota({
      opened: contrato.opened.has(g.clientId),
      contract: contrato.byClient.get(g.clientId),
      registry: cadastro.get(g.clientId),
    });
    const cota = quota[g.contentType] ?? 0;
    const vagas = Math.max(0, cota - g.base);
    const extras = [...g.extras].sort(maisAntigaPrimeiro);
    // Mesmo formato de instante dos dois lados (ISO em UTC, seis casas): a
    // comparação de texto é a de tempo.
    const aberto = abertoEm.get(`${g.clientId}|${g.referenceMonth}`);
    const antesDeAbrir = (p: PecaLida) => aberto === undefined || p.createdAt < aberto;
    const candidatos = extras.filter(antesDeAbrir);
    const viramBase = candidatos.slice(0, vagas);
    saida.push({
      clientId: g.clientId,
      referenceMonth: g.referenceMonth,
      contentType: g.contentType,
      fonte: quotaSource,
      cota,
      base: g.base,
      extras,
      extraDepoisDaAbertura: extras.filter((p) => !antesDeAbrir(p)),
      viramBase,
      motivo:
        cota === 0 ? 'sem-cota' : vagas === 0 ? 'base-cheia' : viramBase.length === 0 ? 'extra-depois-da-abertura' : 'vaga',
    });
  }

  return saida.sort(
    (a, b) =>
      a.clientId.localeCompare(b.clientId) ||
      a.referenceMonth.localeCompare(b.referenceMonth) ||
      a.contentType.localeCompare(b.contentType),
  );
}
