/**
 * OS DESTINOS DA APROVAÇÃO NA ESTEIRA, SEM TELA — F42, Fase 3.
 *
 * O que a caixa "Aprovação do cliente" precisa saber para desenhar: se a
 * configuração está completa, o que falta, o nome da etapa de cada destino e o
 * aviso de herança (gravar vale para todas as listas da mesma esteira).
 */

import type { Destinos, DestinosDaEsteira, EtapaDaEsteira } from '@/server/aprovacao-config';

export type ChaveDoDestino = keyof Destinos;

/** A ordem do caminho do card: enviado → aguardando → aprovado / reprovado. */
export const DESTINOS: ReadonlyArray<{ chave: ChaveDoDestino; rotulo: string; explica: string }> = [
  {
    chave: 'awaitingStatusId',
    rotulo: 'Aguardando cliente',
    explica: 'Para onde o card vai quando a equipe solicita a aprovação.',
  },
  {
    chave: 'approvedStatusId',
    rotulo: 'Aprovado',
    explica: 'Para onde o card vai quando o cliente aprova.',
  },
  {
    chave: 'rejectedStatusId',
    rotulo: 'Reprovado (refação)',
    explica: 'Para onde o card vai quando o cliente pede ajustes.',
  },
];

export const DESTINOS_VAZIOS: Destinos = { awaitingStatusId: null, approvedStatusId: null, rejectedStatusId: null };

export type SituacaoDosDestinos =
  | { tipo: 'completa' }
  | { tipo: 'incompleta'; faltando: string[] }
  | { tipo: 'vazia' };

/** Completa, incompleta (com o que falta) ou ainda não configurada. */
export function situacaoDosDestinos(d: Destinos): SituacaoDosDestinos {
  const faltando = DESTINOS.filter((x) => d[x.chave] === null).map((x) => x.rotulo);
  if (faltando.length === 0) return { tipo: 'completa' };
  if (faltando.length === DESTINOS.length) return { tipo: 'vazia' };
  return { tipo: 'incompleta', faltando };
}

export const fraseDaSituacao = (s: SituacaoDosDestinos): string =>
  s.tipo === 'completa'
    ? 'Configuração completa: o card anda sozinho quando o cliente responde.'
    : s.tipo === 'vazia'
      ? 'Incompleta: escolha as três etapas para a aprovação do cliente funcionar nesta esteira.'
      : `Incompleta: falta escolher ${s.faltando.join(' e ')}.`;

/** O nome da etapa de um destino, ou `null` se não escolhida (ou se sumiu da esteira). */
export function nomeDaEtapa(etapas: readonly EtapaDaEsteira[], id: string | null): string | null {
  if (id === null) return null;
  return etapas.find((e) => e.id === id)?.name ?? null;
}

const DE_ONDE: Record<DestinosDaEsteira['inheritedFrom'], string> = {
  list: 'Esta lista tem esteira própria: a configuração vale só para ela.',
  folder: 'A esteira vem da pasta: a configuração vale para todas as listas da pasta que a herdam.',
  space: 'A esteira vem do espaço: a configuração vale para todas as listas do espaço que a herdam.',
};

export const avisoDeHeranca = (de: DestinosDaEsteira['inheritedFrom']): string => DE_ONDE[de];

/** "Aguardando" igual a aprovado ou reprovado: o card não andaria. A tela não deixa salvar. */
export function destinosRepetidos(d: Destinos): boolean {
  return (
    d.awaitingStatusId !== null &&
    (d.awaitingStatusId === d.approvedStatusId || d.awaitingStatusId === d.rejectedStatusId)
  );
}

export const mesmosDestinos = (a: Destinos, b: Destinos): boolean =>
  DESTINOS.every((x) => a[x.chave] === b[x.chave]);
