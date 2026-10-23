import { createContext } from 'react';

export type PessoaMencionavel = { id: string; name: string };
export type AlvoDeMencoes = {
  taskId?: string | null;
  listId?: string | null;
  /** Chat (F20.8): candidatos da conversa. */
  conversationId?: string | null;
};
export const ContextoDeMencoes = createContext<AlvoDeMencoes>({});
export const UUID_MENCAO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PADRAO_MENCAO = /@\[([^\]\r\n]{1,120})\]\(mention:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;
export function mencao(pessoa: PessoaMencionavel): string {
  const nome = pessoa.name.replaceAll('[', ' ').replaceAll(']', ' ').replace(/[\r\n]/g, ' ').trim().slice(0, 120);
  return `@[${nome || 'Pessoa'}](mention:${pessoa.id.toLowerCase()})`;
}
export function partesDeMencoes(valor: string): (string | PessoaMencionavel)[] {
  const partes: (string | PessoaMencionavel)[] = []; let fim = 0;
  for (const m of valor.matchAll(PADRAO_MENCAO)) {
    partes.push(valor.slice(fim, m.index), { id: m[2].toLowerCase(), name: m[1] });
    fim = m.index + m[0].length;
  }
  partes.push(valor.slice(fim)); return partes;
}
export const textoDasMencoes = (valor: string) => partesDeMencoes(valor).map((p) => typeof p === 'string' ? p : `@${p.name}`).join('');
export const filtrarMencionaveis = (pessoas: PessoaMencionavel[], consulta: string) => {
  const limpar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  return pessoas.filter((p) => limpar(p.name).includes(limpar(consulta.trim()))).slice(0, 12);
};

export function noDeMencao(p: PessoaMencionavel, doc: Document): HTMLElement {
  const no = doc.createElement('span');
  no.className = 'mencao'; no.contentEditable = 'false';
  no.setAttribute('data-mention-id', p.id); no.setAttribute('data-mention-name', p.name);
  no.textContent = `@${p.name}`; return no;
}
export function lerCampoComMencoes(el: Node): string {
  if (el.nodeType === 3) return (el.nodeValue ?? '').replace(/\u00a0/g, ' ');
  const no = el as Element;
  const id = no.getAttribute?.('data-mention-id');
  if (id && UUID_MENCAO.test(id)) return mencao({ id, name: no.getAttribute('data-mention-name') ?? '' });
  if (no.nodeName === 'BR') return '\n';
  let saida = '';
  for (const filho of el.childNodes) {
    if (['DIV', 'P'].includes(filho.nodeName) && saida && !saida.endsWith('\n')) saida += '\n';
    saida += lerCampoComMencoes(filho);
  }
  return saida;
}
