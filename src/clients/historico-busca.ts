/**
 * A BUSCA DO HISTÓRICO.
 *
 * Roda no navegador, sobre os registros que a aba já carregou: o histórico de um
 * cliente cabe inteiro na tela, então não há ida ao servidor por tecla.
 *
 * Sem acento e sem diferença de maiúscula (`reuniao` acha `Reunião`), e várias
 * palavras valem TODAS — `banner outubro` só acha o registro que tem as duas,
 * em qualquer campo e em qualquer ordem.
 */

import type { Evento } from '@/clients/Historico';

export const semAcento = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** As palavras da busca, já sem acento e caixa; várias valem TODAS. */
export function palavrasDaBusca(busca: string): string[] {
  return semAcento(busca).split(/\s+/).filter(Boolean);
}

/** Tudo o que a pessoa lê num registro, numa cadeia só. */
function textoDoEvento(e: Evento): string {
  return semAcento(
    [
      e.title,
      e.subtitle,
      e.body,
      e.ledBy?.name,
      e.ledByNote,
      e.viaName,
      e.happenedOn.slice(0, 10).split('-').reverse().join('/'),
      ...e.documents.map((d) => d.fileName),
    ]
      .filter((p): p is string => typeof p === 'string' && p !== '')
      .join(' \n '),
  );
}

export function filtrarEventos<T extends Evento>(eventos: readonly T[], busca: string): T[] {
  const palavras = palavrasDaBusca(busca);
  if (palavras.length === 0) return [...eventos];
  return eventos.filter((e) => {
    const texto = textoDoEvento(e);
    return palavras.every((p) => texto.includes(p));
  });
}
