/**
 * O NOME DE UM ITEM DE CONTEÚDO — F11C do plano UX (R47).
 *
 * POR QUE ISTO EXISTE
 *   A caixa de conclusão de Conteúdos se chamava "marcar Vídeo" — a mesma
 *   frase para os três vídeos do mês. Quem ouve a tela não sabia qual estava
 *   marcando, e a pastilha da Semanal era ainda pior: o nome dela era o número
 *   do dia ("12"). Um item se reconhece pelo tipo, pelo título e pelo dia; é
 *   isso que o nome diz, nas duas áreas, pela mesma função.
 *
 * QUANDO AINDA ASSIM EMPATA
 *   Dois "Vídeo sem título, sem data" no mesmo mês existem (o mês abre com a
 *   cota inteira sem título). Aí o nome ganha a posição: "(2 de 3)". A ordem é
 *   a da lista recebida — a mesma que a tela desenha.
 */

import { diaDoInstante } from '@/ui/grade-do-mes';

export type ItemNomeavel = {
  id: string;
  contentType: string;
  scheduledAt: string | null;
  isExtra: boolean;
  title: string | null;
};

export const ROTULO_DO_TIPO_DE_CONTEUDO: Record<string, string> = {
  video: 'Vídeo',
  arte: 'Arte',
  foto: 'Foto',
  ads: 'Ads',
};

const diaCurto = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** "Vídeo “Peça 1”, dia 12/09, extra" — sem desempate. */
export function nomeDoItem(item: ItemNomeavel): string {
  const tipo = ROTULO_DO_TIPO_DE_CONTEUDO[item.contentType] ?? item.contentType;
  const titulo = item.title?.trim() ? ` “${item.title.trim()}”` : ' sem título';
  const dia = item.scheduledAt ? `, dia ${diaCurto(diaDoInstante(item.scheduledAt))}` : ', sem data';
  return `${tipo}${titulo}${dia}${item.isExtra ? ', extra' : ''}`;
}

/** O nome de cada item da lista, com "(n de m)" só onde o nome se repete. */
export function nomesDosItens(itens: readonly ItemNomeavel[]): Map<string, string> {
  const base = itens.map((i) => nomeDoItem(i));
  const total = new Map<string, number>();
  for (const n of base) total.set(n, (total.get(n) ?? 0) + 1);

  const visto = new Map<string, number>();
  const nomes = new Map<string, string>();
  itens.forEach((item, i) => {
    const n = base[i];
    const m = total.get(n) ?? 1;
    if (m === 1) {
      nomes.set(item.id, n);
      return;
    }
    const k = (visto.get(n) ?? 0) + 1;
    visto.set(n, k);
    nomes.set(item.id, `${n} (${k} de ${m})`);
  });
  return nomes;
}
