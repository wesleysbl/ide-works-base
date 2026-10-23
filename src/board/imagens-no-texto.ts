/** O texto guarda apenas o id do anexo privado; nunca uma URL assinada. */
export const ATTACHMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const referencias = () => /!\[[^\]\n]*\]\(attachment:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

export function imagemNoTexto(id: string): string {
  if (!ATTACHMENT_ID.test(id)) throw new Error('Identificador de imagem inválido.');
  return `![Imagem anexada](attachment:${id.toLowerCase()})`;
}

export function imagensDoTexto(texto: string): string[] {
  return [...new Set([...texto.matchAll(referencias())].map((m) => m[1].toLowerCase()))];
}

export function textoSemImagens(texto: string): string {
  if (!imagensDoTexto(texto).length) return texto;
  return texto.replace(new RegExp('(?:\\n\\n)?' + referencias().source, 'gi'), '');
}

export function juntarTextoEImagens(texto: string, ids: readonly string[]): string {
  return [texto, ...[...new Set(ids)].map(imagemNoTexto)].filter(Boolean).join('\n\n');
}
