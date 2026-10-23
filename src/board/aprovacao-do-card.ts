/**
 * "SOLICITAR APROVAÇÃO" NO CARD — as contas da tela, sem efeito. F42, Fase 4.
 *
 * Testado em `aprovacao-do-card.test.ts`; quem desenha é `AprovacaoDoCard.tsx`.
 */

import type { TaskDetail } from '@/board/ficha';
import type { AprovacaoDoCard, RodadaDoCard } from '@/server/aprovacao-envio';
import {
  type EntradaDoMaterial,
  anexoServeDeArte,
  linksDoDropboxNoTexto,
  normalizarLinkDoDropbox,
} from '@/server/material-de-aprovacao';

/** Um link do Dropbox achado no card, com de onde ele veio. */
export type LinkDoCard = { url: string; origem: string };

/**
 * Os links do Dropbox já presentes no card, na ordem em que a equipe os vê:
 * primeiro os links anexados (`task_links`), depois os da descrição, depois os
 * dos comentários (do mais antigo ao mais novo). Sem repetição.
 */
export function linksDoCard(tarefa: Pick<TaskDetail, 'links' | 'description' | 'comments'>): LinkDoCard[] {
  const achados: LinkDoCard[] = [];
  const por = (url: string | null, origem: string) => {
    if (url !== null && !achados.some((a) => a.url === url)) achados.push({ url, origem });
  };
  for (const l of tarefa.links) por(normalizarLinkDoDropbox(l.url), `anexo "${l.label}"`);
  for (const u of linksDoDropboxNoTexto(tarefa.description)) por(u, 'descrição');
  for (const c of tarefa.comments) {
    const autor = c.fromClient
      ? 'comentário do cliente'
      : c.author?.name
        ? `comentário de ${c.author.name}`
        : 'comentário';
    for (const u of linksDoDropboxNoTexto(c.body)) por(u, autor);
  }
  return achados;
}

/** Uma arte anexada ao card que pode ir ao cliente (F42, Fase 9). */
export type AnexoDoCard = { id: string; nome: string; origem: string };

/**
 * As artes anexadas ao card que podem ir ao cliente: imagem (png, jpg, webp,
 * gif) e permanente — a imagem temporária da conversa some em 10 dias. A
 * origem diz onde a equipe a vê: no comentário que a cita, na descrição, ou
 * "anexo do card". Na ordem em que foram anexadas.
 */
export function anexosDoCard(tarefa: Pick<TaskDetail, 'attachments' | 'description' | 'comments'>): AnexoDoCard[] {
  return tarefa.attachments
    .filter((a) => anexoServeDeArte({ contentType: a.contentType, fileName: a.fileName, expiresAt: a.expiresAt ?? null }))
    .map((a) => {
      const marca = `attachment:${a.id}`;
      const doComentario = tarefa.comments.find((c) => c.body.includes(marca));
      const origem = doComentario
        ? doComentario.fromClient
          ? 'comentário do cliente'
          : doComentario.author?.name
            ? `comentário de ${doComentario.author.name}`
            : 'comentário'
        : tarefa.description?.includes(marca)
          ? 'descrição'
          : 'anexo do card';
      return { id: a.id, nome: a.fileName, origem };
    });
}

/**
 * O que a janela guarda na ordem do carrossel: o link (o próprio endereço) ou
 * `anexo:<id>`. Um endereço do Dropbox nunca começa com `anexo:`.
 */
export const chaveDoAnexo = (id: string) => `anexo:${id}`;
export const idDaChave = (chave: string): string | null => (chave.startsWith('anexo:') ? chave.slice(6) : null);

/** As chaves da janela na forma que o envio aceita. */
export const entradasDasChaves = (chaves: readonly string[]): EntradaDoMaterial[] =>
  chaves.map((k) => {
    const id = idDaChave(k);
    return id === null ? { link: k } : { anexo: id };
  });

/** Troca a posição de um item com o vizinho. Fora dos limites, nada muda. */
export function moverNaOrdem<T>(lista: readonly T[], de: number, para: number): T[] {
  if (de < 0 || de >= lista.length || para < 0 || para >= lista.length || de === para) return [...lista];
  const nova = [...lista];
  const [item] = nova.splice(de, 1);
  nova.splice(para, 0, item);
  return nova;
}

export type SituacaoDoCard =
  | { tipo: 'oculto' }
  | { tipo: 'sem-destinos'; frase: string }
  | { tipo: 'pronto' };

/**
 * O que a seção mostra. Cliente sem a chave (ou card sem cliente): o botão NÃO
 * aparece — a seção só existe se já houver rodadas para mostrar. Esteira sem os
 * três destinos: diz o que falta e leva à configuração.
 */
export function situacaoDoCard(a: AprovacaoDoCard): SituacaoDoCard {
  if (a.clientId === null || !a.enabled) return { tipo: 'oculto' };
  if (!a.configured) {
    const falta = a.missing.map((m) => `"${m}"`).join(', ');
    return {
      tipo: 'sem-destinos',
      // F43, Fase 6: "etapas" no lugar de "esteira", o vocabulário da ficha.
      frase: `As etapas deste card ainda não dizem para onde ele vai na aprovação do cliente. Falta escolher: ${falta}.`,
    };
  }
  return { tipo: 'pronto' };
}

/** `07/10 16:20`, no fuso da agência — o mesmo em qualquer máquina. */
export function dataEHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(d)
    .replace(',', '');
}

export const rotuloDeMateriais = (n: number) => (n === 1 ? '1 material' : `${n} materiais`);

/**
 * F42, Fase 7 — quem decidiu a rodada e quando, numa linha: "aprovada em 07/10
 * 16:20 · pelo cliente, pelo link". Rodada sem decisão (aberta, substituída,
 * cancelada): nulo — a linha já diz o estado. `decidedVia` desconhecido não
 * inventa quem foi: a frase encolhe para a data.
 */
export function fraseDaDecisao(r: Pick<RodadaDoCard, 'state' | 'decidedAt' | 'decidedVia'>): string | null {
  if (r.decidedAt === null || (r.state !== 'approved' && r.state !== 'rejected')) return null;
  const verbo = r.state === 'approved' ? 'aprovada' : 'ajustes pedidos';
  const quem = r.decidedVia === 'client_link' ? ' · pelo cliente, pelo link' : '';
  return `${verbo} em ${dataEHora(r.decidedAt)}${quem}`;
}
