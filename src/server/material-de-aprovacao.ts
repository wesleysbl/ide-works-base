/**
 * O MATERIAL DE UMA CHAMADA DE APROVAÇÃO — F42, Fase 4. Puro: roda no Worker e
 * na tela.
 *
 * SÓ O LINK (decisão do Wesley em 07/10: a API do Dropbox ficou para depois)
 *   Sem consultar o Dropbox, o que dá para saber de um link é o que está ESCRITO
 *   nele: se é do Dropbox, se é de arquivo (`/scl/fi/…`, `/s/…`) ou de pasta
 *   (`/scl/fo/…`, `/sh/…`), o nome do arquivo (o último pedaço do caminho) e,
 *   pela extensão, se é vídeo, imagem ou outro. É isso que o envio grava; o
 *   identificador e a versão do arquivo ficam nulos (migration F42_5).
 *
 *   A conferência é a MESMA nos dois lados: a tela avisa antes de enviar e o
 *   Worker recusa de novo (400, nada gravado) — a tela não é a trava.
 *
 * O QUE ESTE ARQUIVO NÃO FAZ: ver se o link está aberto para qualquer pessoa.
 * Sem a API não há como; a prévia "como o cliente verá" é a conferência da
 * equipe (o vídeo toca, a imagem aparece — ou não).
 */

import { enderecoDeExibicao, formaDoLink, midiaDoArquivo } from '@/server/dropbox';

/** O tipo do item como o banco o guarda (`ideworks.approval_item_kind`). */
export type TipoDoItem = 'video' | 'image' | 'other';

/** Um item como `create_approval_round` o recebe, sem identificador nem versão. */
export type ItemDoEnvio = { dropbox_url: string; kind: TipoDoItem; file_name: string };

export type MaterialLido = {
  /** O link como será gravado: com `https://`, sem espaços. */
  url: string;
  forma: 'arquivo' | 'pasta';
  tipo: TipoDoItem;
  nome: string;
  /** O endereço que toca/mostra o arquivo sem login (`raw=1`); nulo em pasta. */
  exibicao: string | null;
};

export const LIMITE_DE_ITENS = 20;
const TETO_DO_ENDERECO = 2048;

export const FRASE_SEM_ITENS = 'Escolha ao menos um material para enviar.';
export const FRASE_ITENS_DEMAIS = `Até ${LIMITE_DE_ITENS} materiais por chamada. Para mais, envie o link de uma pasta.`;

/** A frase da recusa de um link que não é do Dropbox — a mesma na tela e no Worker. */
export function fraseDoLinkRecusado(posicao: number, link: string): string {
  const curto = link.trim().length > 60 ? `${link.trim().slice(0, 57)}…` : link.trim();
  return `O ${posicao}º link não é um link de compartilhamento do Dropbox ("${curto}"). Cole o link de um arquivo ou de uma pasta do Dropbox (dropbox.com/scl/…).`;
}

export function fraseDoLinkRepetido(primeira: number, segunda: number): string {
  return `O mesmo link aparece no ${primeira}º e no ${segunda}º material. Tire a repetição.`;
}

const TIPO_DA_MIDIA = { video: 'video', imagem: 'image', outro: 'other' } as const;

/**
 * `www.dropbox.com/x` → `https://www.dropbox.com/x`, como o comentário real é
 * colado. Qualquer outro esquema que não `https` fica de fora.
 */
export function normalizarLinkDoDropbox(bruto: string): string | null {
  const v = bruto.trim();
  if (v === '' || v.length > TETO_DO_ENDERECO) return null;
  const comEsquema = /^(www\.)?dropbox\.com\//i.test(v) ? `https://${v}` : v;
  // `new URL` (em formaDoLink) conserta usuário:senha@, porta e barras invertidas;
  // o banco não: o texto tem de já estar na forma que a restrição aceita.
  if (!/^https:\/\/(www\.)?dropbox\.com\//i.test(comEsquema)) return null;
  return formaDoLink(comEsquema) === null ? null : comEsquema;
}

function decodificar(pedaco: string): string {
  try {
    return decodeURIComponent(pedaco);
  } catch {
    return pedaco;
  }
}

/**
 * O nome do arquivo escrito no link: `/scl/fi/<id>/<nome>` e `/s/<id>/<nome>`.
 * Pasta não carrega nome legível (o terceiro pedaço de `/scl/fo/` é chave).
 */
export function nomeDoLink(url: string, forma: 'arquivo' | 'pasta'): string {
  if (forma === 'pasta') return 'Pasta do Dropbox';
  const partes = new URL(url).pathname.split('/').filter((p) => p !== '');
  const indice = partes[0] === 'scl' ? 3 : 2;
  const nome = decodificar(partes[indice] ?? '').trim();
  return nome === '' ? 'Arquivo do Dropbox' : nome;
}

/** O que o link diz de si — ou `null` quando ele não é do Dropbox. */
export function lerMaterial(bruto: string): MaterialLido | null {
  const url = normalizarLinkDoDropbox(bruto);
  if (url === null) return null;
  const forma = formaDoLink(url);
  if (forma === null) return null;
  const nome = nomeDoLink(url, forma);
  return {
    url,
    forma,
    nome,
    tipo: forma === 'pasta' ? 'other' : TIPO_DA_MIDIA[midiaDoArquivo(nome)],
    exibicao: forma === 'arquivo' ? enderecoDeExibicao(url) : null,
  };
}

/**
 * Confere a lista inteira, na ordem. Devolve os itens prontos para o banco, ou
 * a frase da PRIMEIRA recusa — nada vai ao banco com um link ruim no meio.
 */
export function conferirLinks(
  links: readonly string[],
): { ok: true; itens: ItemDoEnvio[]; materiais: MaterialLido[] } | { ok: false; frase: string } {
  if (links.length === 0) return { ok: false, frase: FRASE_SEM_ITENS };
  if (links.length > LIMITE_DE_ITENS) return { ok: false, frase: FRASE_ITENS_DEMAIS };
  const materiais: MaterialLido[] = [];
  const vistos = new Map<string, number>();
  for (const [i, link] of links.entries()) {
    const m = lerMaterial(link);
    if (m === null) return { ok: false, frase: fraseDoLinkRecusado(i + 1, link) };
    const antes = vistos.get(m.url);
    if (antes !== undefined) return { ok: false, frase: fraseDoLinkRepetido(antes, i + 1) };
    vistos.set(m.url, i + 1);
    materiais.push(m);
  }
  return {
    ok: true,
    materiais,
    itens: materiais.map((m) => ({ dropbox_url: m.url, kind: m.tipo, file_name: m.nome })),
  };
}

/**
 * Os links do Dropbox escritos num texto (descrição em markdown, comentário),
 * na ordem e sem repetição. Pega `https://…`, `www.dropbox.com/…` e o link
 * dentro de `[rótulo](…)`; a pontuação que fecha a frase sai do fim.
 */
export function linksDoDropboxNoTexto(texto: string | null | undefined): string[] {
  if (!texto) return [];
  const achados: string[] = [];
  const padrao = /(?:https?:\/\/)?(?:www\.)?dropbox\.com\/[^\s<>()[\]"'`]+/gi;
  for (const bruto of texto.match(padrao) ?? []) {
    const limpo = bruto.replace(/[.,;:!?*_]+$/, '');
    const url = normalizarLinkDoDropbox(limpo.replace(/^http:\/\//i, 'https://'));
    if (url !== null && !achados.includes(url)) achados.push(url);
  }
  return achados;
}

/* ─────────────────────────── as artes anexadas (F42, Fase 9) ─────────────────────────── */

/**
 * ARTE ANEXADA AO CARD COMO MATERIAL — F42, Fase 9.
 *
 * No card real as artes são anexos (balde privado `ideworks-anexos`, até
 * 5 MB), não links do Dropbox. Anexo de IMAGEM entra como material: no envio,
 * o Worker copia o objeto para `aprovacoes/<rodada>/<ordem>-<nome-seguro>` e o
 * cliente vê a cópia — imutável, mesmo que o anexo seja apagado ou trocado.
 * Vídeo segue pelo Dropbox (passa de 5 MB).
 *
 * O corpo do envio é `{ materiais: [{ link } | { anexo }] }`, na ordem do
 * carrossel. `{ links: [...] }` (a forma da Fase 4) continua aceito.
 */
export type EntradaDoMaterial = { link: string } | { anexo: string };

/** Um material conferido, pronto para o Worker: link lido ou id do anexo. */
export type MaterialPedido =
  | { tipo: 'link'; item: ItemDoEnvio; material: MaterialLido }
  | { tipo: 'anexo'; anexoId: string };

/** Tipos de imagem que a página do cliente desenha. O banco repete a lista (F42_7). */
export const TIPOS_DE_ARTE = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
const EXTENSOES_DE_ARTE = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

const ID_DO_ANEXO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O anexo serve de arte? Imagem (pelo tipo E pela extensão) e permanente (sem prazo). */
export function anexoServeDeArte(a: {
  contentType: string | null | undefined;
  fileName: string;
  expiresAt?: string | Date | null;
}): boolean {
  if (a.expiresAt) return false;
  const tipo = (a.contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!(TIPOS_DE_ARTE as readonly string[]).includes(tipo)) return false;
  const ponto = a.fileName.lastIndexOf('.');
  return ponto > 0 && EXTENSOES_DE_ARTE.includes(a.fileName.slice(ponto + 1).toLowerCase());
}

export const fraseDoAnexoNaoEncontrado = (posicao: number) =>
  `O ${posicao}º material não é um anexo deste card (ou foi apagado). Feche a janela e escolha de novo.`;
export const fraseDoAnexoDeOutroCard = (posicao: number, nome: string) =>
  `O ${posicao}º material ("${nome}") é anexo de outro card. Só as artes anexadas a este card vão ao cliente.`;
export const fraseDoAnexoTemporario = (posicao: number, nome: string) =>
  `O ${posicao}º material ("${nome}") é uma imagem temporária da conversa (some em 10 dias). Anexe a arte ao card para enviá-la.`;
export const fraseDoAnexoQueNaoEImagem = (posicao: number, nome: string) =>
  `O ${posicao}º material ("${nome}") não é imagem (png, jpg, webp ou gif). Vídeo e outros arquivos vão pelo link do Dropbox.`;
export const fraseDoAnexoRepetido = (primeira: number, segunda: number) =>
  `O mesmo anexo aparece no ${primeira}º e no ${segunda}º material. Tire a repetição.`;
export const FRASE_MATERIAL_TORTO = 'Cada material é um link do Dropbox ou um anexo do card, na ordem do carrossel.';

/**
 * Confere a lista inteira, na ordem, sem banco: link do Dropbox lido, id de
 * anexo com formato, sem repetição, entre 1 e o teto. O anexo em si (do card?
 * imagem? temporário?) o Worker confere no banco.
 */
export function conferirMateriais(
  entradas: readonly EntradaDoMaterial[],
): { ok: true; pedidos: MaterialPedido[] } | { ok: false; frase: string } {
  if (entradas.length === 0) return { ok: false, frase: FRASE_SEM_ITENS };
  if (entradas.length > LIMITE_DE_ITENS) return { ok: false, frase: FRASE_ITENS_DEMAIS };
  const pedidos: MaterialPedido[] = [];
  const links = new Map<string, number>();
  const anexos = new Map<string, number>();
  for (const [i, e] of entradas.entries()) {
    const pos = i + 1;
    if ('anexo' in e) {
      if (typeof e.anexo !== 'string' || !ID_DO_ANEXO.test(e.anexo)) {
        return { ok: false, frase: fraseDoAnexoNaoEncontrado(pos) };
      }
      const id = e.anexo.toLowerCase();
      const antes = anexos.get(id);
      if (antes !== undefined) return { ok: false, frase: fraseDoAnexoRepetido(antes, pos) };
      anexos.set(id, pos);
      pedidos.push({ tipo: 'anexo', anexoId: id });
      continue;
    }
    const m = typeof e.link === 'string' ? lerMaterial(e.link) : null;
    if (m === null) return { ok: false, frase: fraseDoLinkRecusado(pos, String(e.link ?? '')) };
    const antes = links.get(m.url);
    if (antes !== undefined) return { ok: false, frase: fraseDoLinkRepetido(antes, pos) };
    links.set(m.url, pos);
    pedidos.push({ tipo: 'link', material: m, item: { dropbox_url: m.url, kind: m.tipo, file_name: m.nome } });
  }
  return { ok: true, pedidos };
}

/**
 * O nome da cópia no balde: `<ordem>-<nome-seguro>`. Sem acento, sem espaço,
 * sem barra nem `..`: só `[a-z0-9._-]`, até 80 caracteres, a extensão
 * preservada. O nome de verdade fica em `file_name`; este é endereço.
 */
export function nomeSeguro(fileName: string): string {
  const ponto = fileName.lastIndexOf('.');
  const extBruta = ponto > 0 ? fileName.slice(ponto + 1).toLowerCase() : '';
  const ext = /^[a-z0-9]{1,8}$/.test(extBruta) ? extBruta : '';
  const base = (ponto > 0 ? fileName.slice(0, ponto) : fileName)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 70);
  return `${base === '' ? 'arte' : base}${ext ? `.${ext}` : ''}`;
}

/** Onde mora a cópia da arte de uma rodada: `aprovacoes/<rodada>/<ordem>-<nome>`. */
export const caminhoDaCopia = (roundId: string, posicao: number, fileName: string) =>
  `aprovacoes/${roundId}/${posicao}-${nomeSeguro(fileName)}`;

/* ─────────────────────────── as rodadas ─────────────────────────── */

export type EstadoDaRodada = 'open' | 'approved' | 'rejected' | 'superseded' | 'cancelled' | 'locked_changed';

export const ROTULO_DO_ESTADO: Record<EstadoDaRodada, string> = {
  open: 'aguardando o cliente',
  approved: 'aprovada',
  rejected: 'ajustes pedidos',
  superseded: 'substituída',
  cancelled: 'cancelada',
  locked_changed: 'travada: material mudou',
};

export const TOM_DO_ESTADO: Record<EstadoDaRodada, 'ok' | 'err' | 'warn' | 'mute'> = {
  open: 'warn',
  approved: 'ok',
  rejected: 'err',
  superseded: 'mute',
  cancelled: 'mute',
  locked_changed: 'err',
};

export const ROTULO_DO_TIPO: Record<TipoDoItem, string> = {
  video: 'Vídeo',
  image: 'Imagem',
  other: 'Outro',
};
