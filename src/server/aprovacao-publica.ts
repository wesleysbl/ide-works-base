/**
 * A API PÚBLICA DO CLIENTE — F42, Fase 5.
 *
 * Com o token, e só com ele, o cliente lê as suas chamadas, comenta e decide.
 * Nada interno vaza. Este arquivo é o lado do Worker; o banco (migration F42_6)
 * já devolve só o permitido, e aqui se repete a trava:
 *
 *   - LISTA PERMITIDA EXPLÍCITA: cada objeto da resposta é montado por
 *     `escolher(objeto, CHAVES_…)`, que copia só as chaves da lista. Uma coluna
 *     nova na função do banco não chega ao cliente sem alguém mudar a lista
 *     daqui (e o teste que compara as chaves).
 *   - ITENS: link de ARQUIVO volta com `exibicao` (o próprio link com `raw=1`,
 *     `rlkey` mantido, `dl` fora — `enderecoDeExibicao`); link de PASTA volta
 *     com `abrirNoDropbox` (o link original). O outro campo vem nulo.
 *   - LEGENDA: a cópia no banco fica intacta; a exibida perde os links crus do
 *     Dropbox (o material já está nos itens; o link cru na legenda é ruído e
 *     abriria a pasta inteira da produção).
 *   - TUDO PELO HASH: o token cru nunca sai do Worker nem vai ao log; o banco
 *     recebe o SHA-256 (`hashDoToken`), e o limite usa só um pedaço dele.
 *
 * O LIMITE DE PEDIDOS (decisão desta fase)
 *   O projeto já conta no BANCO (`auth_attempts`, F1.4; `integration_rate_events`,
 *   F16.2b) porque o Worker tem várias cópias e contador em memória de isolado
 *   é trava de teatro. A API de Rate Limiting da Cloudflare também resolveria,
 *   mas conta por data center e de forma aproximada, pede binding novo no
 *   `wrangler.toml` e não roda na suíte; a contagem no banco é exata, já é o
 *   padrão da casa e o volume do piloto (um cliente, uma ou duas chamadas por
 *   dia) não pesa. Uma ida só: `approval_link_rate_hit` conta token e IP e
 *   registra se couber.
 *
 *   Tetos, por minuto (janela deslizante de 60 s):
 *     leitura — 60 por token, 120 por IP;
 *     escrita — 20 por token, 30 por IP.
 *   Por quê: abrir a página faz uma leitura, e cada aprovação/comentário faz uma
 *   escrita e uma leitura; 60/20 é muito acima de uma pessoa clicando, e corta
 *   laço de robô. O IP tem folga para duas ou três pessoas do mesmo escritório
 *   (mesma saída de rede) e continua contendo quem varre tokens. O limite vem
 *   DEPOIS da conferência do formato do token (token fora do formato é 404 sem
 *   banco, F42 Fase 3) e ANTES de resolver o link — token inexistente também
 *   conta, por IP.
 *
 * CSRF E ABUSO: POST só com `Content-Type: application/json` (formulário de
 * outro site não manda esse tipo sem passar pelo CORS, que esta API não abre);
 * `Origin`, quando vem, tem de ser a do app; corpo até 8 KiB.
 */

import { type ArmazenamentoPrivado, lerObjetoDoBalde } from '@/server/board-anexos';
import { CorpoGrandeDemais, lerTextoComTeto } from '@/server/corpo-com-teto';
import { type Sql, withActor } from '@/server/db';
import { enderecoDeExibicao, formaDoLink } from '@/server/dropbox';

/* ─────────────────────────── frases ─────────────────────────── */

/** A MESMA para token inexistente, revogado, desligado, inativo e chamada de outro cliente. */
export const FRASE_NAO_ENCONTRADO = 'Link inválido ou desativado.';
export const FRASE_LIMITE = 'Muitos pedidos em pouco tempo. Espere um minuto e tente de novo.';
export const FRASE_REPROVAR_SEM_COMENTARIO = 'Para pedir ajustes, escreva o que precisa mudar.';
export const FRASE_COMENTARIO_VAZIO = 'Escreva o comentário.';
export const FRASE_SO_JSON = 'Envie os dados em JSON.';
export const FRASE_OUTRA_ORIGEM = 'Pedido recusado: ele não veio da página de aprovação.';
export const FRASE_CORPO_GRANDE = 'Pedido grande demais.';
export const FRASE_CORPO_INVALIDO = 'Pedido em formato inválido.';
export const FRASE_NAO_ESTA_ABERTA = 'Este envio não está mais aberto: só dá para ver.';

/** Até quantos caracteres um comentário do cliente pode ter (o banco repete). */
export const TETO_DO_COMENTARIO = 2000;
export const FRASE_COMENTARIO_LONGO = `Comentário longo demais: até ${TETO_DO_COMENTARIO} caracteres.`;

/** Corpo máximo de um POST público, em bytes. */
export const TETO_DO_CORPO = 8 * 1024;

/* ─────────────────────────── o limite de pedidos ─────────────────────────── */

/**
 * `media` (F42, Fase 9): as imagens das artes anexadas, contadas à parte da
 * leitura. Uma chamada com 20 artes faz 21 pedidos por abertura; no balde da
 * leitura (60/min), três recargas já barrariam as imagens. 200 por token e
 * 240 por IP cobrem várias aberturas e ainda cortam laço de robô.
 */
export type TipoDePedido = 'read' | 'write' | 'media';

export const JANELA_DO_LIMITE_SEGUNDOS = 60;
export const LIMITES_PUBLICOS: Record<TipoDePedido, { token: number; ip: number }> = {
  read: { token: 60, ip: 120 },
  write: { token: 20, ip: 30 },
  media: { token: 200, ip: 240 },
};

/* ─────────────────────────── a recusa ─────────────────────────── */

/** Recusa com status e corpo prontos. A rota pública a responde com os seus cabeçalhos. */
export class RecusaPublica extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 413 | 415 | 429 | 502,
    readonly corpo: Record<string, unknown>,
    readonly esperarSegundos?: number,
  ) {
    super(String(corpo.message ?? 'recusado'));
    this.name = 'RecusaPublica';
  }
}

const naoEncontrado = () => new RecusaPublica(404, { message: FRASE_NAO_ENCONTRADO });

/* ─────────────────────────── a resposta: lista permitida ─────────────────────────── */

export type EstadoPublico = 'aberta' | 'aprovada' | 'reprovada';

export type ItemPublico = {
  id: string;
  ordem: number;
  tipo: 'video' | 'image' | 'other';
  nome: string;
  /**
   * `anexo` (F42, Fase 9): arte anexada ao card, copiada para a rodada. A
   * resposta traz `exibicao` nulo; a página monta o endereço da imagem com o
   * token dela (`/api/public/aprovacao/<token>/chamadas/<id>/itens/<id>/imagem`).
   */
  forma: 'arquivo' | 'pasta' | 'anexo';
  /** Arquivo: o endereço que toca/mostra sem login (`raw=1`). Pasta e anexo: nulo. */
  exibicao: string | null;
  /** Pasta: o link original, para abrir no Dropbox. Arquivo: nulo. */
  abrirNoDropbox: string | null;
};

export type ComentarioPublico = { id: string; texto: string; criadoEm: string; itemId: string | null };

export type ChamadaPublica = {
  id: string;
  titulo: string;
  versao: number;
  enviadaEm: string;
  legenda: string | null;
  estado: EstadoPublico;
  decididaEm: string | null;
  itens: ItemPublico[];
  comentarios: ComentarioPublico[];
};

export type PaginaPublica = { ok: true; cliente: { nome: string }; chamadas: ChamadaPublica[] };

export const CHAVES_DA_PAGINA = ['ok', 'cliente', 'chamadas'] as const;
export const CHAVES_DO_CLIENTE = ['nome'] as const;
export const CHAVES_DA_CHAMADA = [
  'id',
  'titulo',
  'versao',
  'enviadaEm',
  'legenda',
  'estado',
  'decididaEm',
  'itens',
  'comentarios',
] as const;
export const CHAVES_DO_ITEM = ['id', 'ordem', 'tipo', 'nome', 'forma', 'exibicao', 'abrirNoDropbox'] as const;
export const CHAVES_DO_COMENTARIO = ['id', 'texto', 'criadoEm', 'itemId'] as const;

/** Copia SÓ as chaves da lista — o resto do objeto nunca atravessa. */
export function escolher<T>(objeto: Record<string, unknown>, chaves: readonly string[]): T {
  const saida: Record<string, unknown> = {};
  for (const k of chaves) saida[k] = objeto[k] ?? null;
  return saida as T;
}

const ESTADO_PUBLICO: Record<string, EstadoPublico> = {
  open: 'aberta',
  approved: 'aprovada',
  rejected: 'reprovada',
};

const comoData = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const dataOuNulo = (v: unknown): string | null => (v === null || v === undefined ? null : comoData(v));

/**
 * A legenda exibida, sem link cru do Dropbox. `[rótulo](link do Dropbox)` vira
 * o rótulo; `<link>` e o link solto saem. Linha que SÓ tinha o link (ou um
 * rótulo do tipo "Vídeo:" antes dele) some; as linhas em branco do texto ficam,
 * sem repetir. Sem link do Dropbox, o texto volta igual.
 */
export function legendaSemDropbox(texto: string | null | undefined): string | null {
  if (texto === null || texto === undefined) return null;
  const DOMINIO = String.raw`(?:https?:\/\/)?(?:[a-z0-9-]+\.)*dropbox(?:usercontent)?\.com\/`;
  const markdown = new RegExp(String.raw`\[([^\]]*)\]\(\s*<?${DOMINIO}[^)]*\)`, 'gi');
  const anguloso = new RegExp(String.raw`<${DOMINIO}[^>\s]*>`, 'gi');
  const solto = new RegExp(String.raw`${DOMINIO}[^\s<>()[\]"'\`]*`, 'gi');
  const limpar = (linha: string) => linha.replace(markdown, '$1').replace(anguloso, '').replace(solto, '');
  if (limpar(texto) === texto) return texto;

  const saida: string[] = [];
  for (const original of texto.split('\n')) {
    const semLink = limpar(original);
    const mudou = semLink !== original;
    const limpa = mudou ? semLink.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/, '') : original;
    // Sobrou nada, só pontuação, ou só o rótulo ("Vídeo:", "Link -"): a linha era o link.
    if (mudou && (limpa.trim() === '' || /^[^\n]{0,40}[:\-–—]\s*$/.test(limpa) || /^[\p{P}\s]*$/u.test(limpa))) continue;
    if (limpa.trim() === '' && saida.length > 0 && saida[saida.length - 1].trim() === '') continue;
    saida.push(limpa);
  }
  const final = saida.join('\n').trim();
  return final === '' ? null : final;
}

type ItemDoBanco = {
  id: string;
  position: number;
  url: string | null;
  kind: string;
  file_name: string;
  /** F42_7: a arte é cópia de anexo. O caminho do balde nunca vem. */
  attachment?: boolean;
};
type ComentarioDoBanco = { id: string; body: string; created_at: unknown; item_id: string | null };
type ChamadaDoBanco = {
  id: string;
  task_title: string;
  version: number;
  sent_at: unknown;
  caption: string | null;
  state: string;
  decided_at: unknown;
  items: ItemDoBanco[] | null;
  comments: ComentarioDoBanco[] | null;
};

export function montarItem(i: ItemDoBanco): ItemPublico {
  if (i.attachment === true || i.url === null) {
    return escolher<ItemPublico>(
      {
        id: String(i.id),
        ordem: Number(i.position),
        tipo: 'image',
        nome: String(i.file_name),
        forma: 'anexo',
        exibicao: null,
        abrirNoDropbox: null,
      },
      CHAVES_DO_ITEM,
    );
  }
  const arquivo = formaDoLink(i.url) === 'arquivo';
  const exibicao = arquivo ? enderecoDeExibicao(i.url) : null;
  return escolher<ItemPublico>(
    {
      id: String(i.id),
      ordem: Number(i.position),
      tipo: i.kind === 'video' || i.kind === 'image' ? i.kind : 'other',
      nome: String(i.file_name),
      forma: arquivo ? 'arquivo' : 'pasta',
      exibicao,
      abrirNoDropbox: arquivo ? null : String(i.url),
    },
    CHAVES_DO_ITEM,
  );
}

export function montarComentario(c: ComentarioDoBanco): ComentarioPublico {
  return escolher<ComentarioPublico>(
    { id: String(c.id), texto: String(c.body), criadoEm: comoData(c.created_at), itemId: c.item_id ? String(c.item_id) : null },
    CHAVES_DO_COMENTARIO,
  );
}

/** Uma chamada do banco na forma pública — ou `null` se o estado não é visível. */
export function montarChamada(c: ChamadaDoBanco): ChamadaPublica | null {
  const estado = ESTADO_PUBLICO[c.state];
  if (!estado) return null;
  return escolher<ChamadaPublica>(
    {
      id: String(c.id),
      titulo: String(c.task_title),
      versao: Number(c.version),
      enviadaEm: comoData(c.sent_at),
      legenda: legendaSemDropbox(c.caption),
      estado,
      decididaEm: dataOuNulo(c.decided_at),
      itens: [...(c.items ?? [])].sort((a, b) => a.position - b.position).map(montarItem),
      comentarios: (c.comments ?? []).map(montarComentario),
    },
    CHAVES_DA_CHAMADA,
  );
}

const ordemDoEstado = (c: ChamadaPublica) => (c.estado === 'aberta' ? 0 : 1);

export function montarPagina(p: { client_name: string; rounds: ChamadaDoBanco[] | null }): PaginaPublica {
  const chamadas = (p.rounds ?? [])
    .map(montarChamada)
    .filter((c): c is ChamadaPublica => c !== null);
  // O banco já ordena; a ordem se repete aqui (estável): abertas primeiro.
  const ordenadas = chamadas
    .map((c, i) => ({ c, i }))
    .sort((a, b) => ordemDoEstado(a.c) - ordemDoEstado(b.c) || a.i - b.i)
    .map((x) => x.c);
  return escolher<PaginaPublica>(
    {
      ok: true,
      cliente: escolher<{ nome: string }>({ nome: String(p.client_name) }, CHAVES_DO_CLIENTE),
      chamadas: ordenadas,
    },
    CHAVES_DA_PAGINA,
  );
}

/* ─────────────────────────── o pedido ─────────────────────────── */

/**
 * O IP de quem pede, como chave do limite: o primeiro da lista, até 128
 * caracteres. F42, Fase 6: IPv6 conta pelo PREFIXO /64 (`2001:db8:1:2::/64`).
 * Um aparelho recebe um /64 inteiro do provedor e troca de endereço dentro
 * dele à vontade (endereços temporários); contar por endereço deixaria quem
 * varre tokens ganhar um balde novo a cada pedido. IPv4 fica como está; IPv4
 * embutido em IPv6 (`::ffff:1.2.3.4`) volta a ser o IPv4. O que não parece
 * IPv6 válido segue cru (até 128 caracteres), como antes.
 */
export function chaveDoIp(bruto: string): string {
  const primeiro = bruto.split(',')[0]?.trim() ?? '';
  if (primeiro === '') return '0.0.0.0';
  return (prefixoIpv6(primeiro) ?? primeiro).slice(0, 128);
}

/** `a:b:c:d::/64` de um IPv6 (com `::`, zona e IPv4 no fim), o IPv4 de um mapeado, ou `null`. */
export function prefixoIpv6(ip: string): string | null {
  let s = ip.trim();
  if (s.startsWith('[')) {
    const fim = s.indexOf(']');
    if (fim < 0) return null;
    s = s.slice(1, fim);
  }
  s = s.split('%')[0];
  if (!s.includes(':')) return null;
  const metades = s.split('::');
  if (metades.length > 2) return null;
  const grupos = (t: string) => (t === '' ? [] : t.split(':'));
  const cabeca = grupos(metades[0]);
  const cauda = metades.length === 2 ? grupos(metades[1]) : [];
  // IPv4 no fim (`::ffff:1.2.3.4`, `64:ff9b::1.2.3.4`) vira dois grupos.
  const ultimaLista = metades.length === 2 ? cauda : cabeca;
  const ultimo = ultimaLista[ultimaLista.length - 1];
  if (ultimo?.includes('.')) {
    const oct = ultimo.split('.');
    if (oct.length !== 4 || oct.some((o) => !/^\d{1,3}$/.test(o) || Number(o) > 255)) return null;
    const n = oct.map(Number);
    ultimaLista.splice(ultimaLista.length - 1, 1, ((n[0] << 8) | n[1]).toString(16), ((n[2] << 8) | n[3]).toString(16));
  }
  let todos: string[];
  if (metades.length === 2) {
    if (cabeca.length + cauda.length > 7) return null;
    todos = [...cabeca, ...Array(8 - cabeca.length - cauda.length).fill('0'), ...cauda];
  } else {
    if (cabeca.length !== 8) return null;
    todos = cabeca;
  }
  if (todos.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  const valores = todos.map((g) => parseInt(g, 16));
  // `::ffff:a.b.c.d` é um IPv4 visto por um soquete IPv6: conta como o IPv4.
  if (valores.slice(0, 5).every((v) => v === 0) && valores[5] === 0xffff) {
    return [valores[6] >> 8, valores[6] & 255, valores[7] >> 8, valores[7] & 255].join('.');
  }
  return `${valores.slice(0, 4).map((v) => v.toString(16)).join(':')}::/64`;
}

/** A chave do token no limite: metade do hash — identifica o link, não serve de credencial. */
export const chaveDoToken = (hash: string): string => hash.slice(0, 32);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const pareceId = (v: string): boolean => UUID.test(v);

/**
 * O corpo de um POST público: só JSON, só da origem do app (quando o navegador
 * diz a origem), até `TETO_DO_CORPO`. Devolve o objeto ou lança a recusa.
 */
export async function lerCorpoPublico(request: Request, origemDoApp: string): Promise<Record<string, unknown>> {
  const tipo = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (tipo !== 'application/json') throw new RecusaPublica(415, { message: FRASE_SO_JSON });
  const origem = request.headers.get('Origin');
  if (origem !== null && origem !== origemDoApp) throw new RecusaPublica(403, { message: FRASE_OUTRA_ORIGEM });
  const declarado = Number(request.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(declarado) && declarado > TETO_DO_CORPO) {
    throw new RecusaPublica(413, { message: FRASE_CORPO_GRANDE });
  }
  // Lê até o teto e desiste: sem `Content-Length` (corpo em pedaços) o cabeçalho
  // acima não vale, e esta rota não pede sessão — quem manda 90 MB aqui não
  // pode ganhar 90 MB da memória do Worker.
  let texto: string;
  try {
    texto = await lerTextoComTeto(request, TETO_DO_CORPO);
  } catch (erro) {
    if (erro instanceof CorpoGrandeDemais) throw new RecusaPublica(413, { message: FRASE_CORPO_GRANDE });
    throw erro;
  }
  if (texto.trim() === '') return {};
  let corpo: unknown;
  try {
    corpo = JSON.parse(texto);
  } catch {
    throw new RecusaPublica(400, { message: FRASE_CORPO_INVALIDO });
  }
  if (corpo === null || typeof corpo !== 'object' || Array.isArray(corpo)) {
    throw new RecusaPublica(400, { message: FRASE_CORPO_INVALIDO });
  }
  return corpo as Record<string, unknown>;
}

/** Texto com sentido: a mesma regra do banco (`is_meaningful_name`): não vazio, não só pontuação. */
export const temSentido = (texto: string): boolean => {
  const t = texto.trim();
  return t !== '' && !/^[\p{P}\p{S}\s]+$/u.test(t);
};

/**
 * O texto de um comentário. `obrigatorio` = reprovar ou comentar; aprovar aceita
 * vazio (nulo). Lança 400 com a frase certa.
 */
export function conferirTexto(bruto: unknown, obrigatorio: boolean, fraseVazio: string): string | null {
  if (bruto !== undefined && bruto !== null && typeof bruto !== 'string') {
    throw new RecusaPublica(400, { message: FRASE_CORPO_INVALIDO });
  }
  const texto = typeof bruto === 'string' ? bruto.trim() : '';
  if (texto === '') {
    if (obrigatorio) throw new RecusaPublica(400, { message: fraseVazio });
    return null;
  }
  if (!temSentido(texto)) throw new RecusaPublica(400, { message: fraseVazio });
  if ([...texto].length > TETO_DO_COMENTARIO) throw new RecusaPublica(400, { message: FRASE_COMENTARIO_LONGO });
  return texto;
}

/* ─────────────────────────── o banco ─────────────────────────── */

/** "07/10/2026 às 14:32", no horário de Brasília. */
export function dataEHora(iso: string): string {
  const d = new Date(iso);
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? '';
  return `${p('day')}/${p('month')}/${p('year')} às ${p('hour')}:${p('minute')}`;
}

/** A recusa de "já respondida", com a data quando houve decisão. */
export function recusaJaRespondida(detalhe: string | undefined): RecusaPublica {
  let d: { state?: string; decided_at?: string | null } = {};
  try {
    d = JSON.parse(detalhe ?? '{}') as typeof d;
  } catch {
    d = {};
  }
  const estado = d.state ? (ESTADO_PUBLICO[d.state] ?? null) : null;
  const quando = d.decided_at ? new Date(d.decided_at).toISOString() : null;
  const message = quando ? `Você já respondeu este envio em ${dataEHora(quando)}.` : FRASE_NAO_ESTA_ABERTA;
  return new RecusaPublica(409, { message, estado, decididaEm: quando });
}

type ErroDoBanco = { code?: string; hint?: string; detail?: string };

/** Traduz a recusa do banco (IW042 + hint) para a resposta pública. */
function traduzir(erro: unknown, fraseVazio: string): never {
  const e = erro as ErroDoBanco;
  if (e.code === 'IW042') {
    switch (e.hint) {
      case 'link_invalid':
      case 'round_not_found':
      case 'item_not_found':
        throw naoEncontrado();
      case 'round_not_open':
        throw recusaJaRespondida(e.detail);
      case 'comment_required':
        throw new RecusaPublica(400, { message: fraseVazio });
      case 'comment_too_long':
        throw new RecusaPublica(400, { message: FRASE_COMENTARIO_LONGO });
      default:
        break;
    }
  }
  // Corpo sem sentido que escapou da conferência (23514) ou argumento inválido.
  if (e.code === '23514' || e.code === '22023') throw new RecusaPublica(400, { message: fraseVazio });
  throw erro;
}

/**
 * Conta o pedido no limite. Lança 429 (com quantos segundos esperar) quando o
 * token ou o IP passou do teto. O banco fora do ar sobe como falha (500): sem
 * banco a rota não funciona de qualquer jeito.
 */
export async function conferirLimitePublico(
  sql: Sql,
  tipo: TipoDePedido,
  hash: string,
  ip: string,
): Promise<void> {
  const teto = LIMITES_PUBLICOS[tipo];
  const r = await withActor(sql, { kind: 'preauth' }, async (tx) => {
    const [linha] = await tx`
      select ideworks.approval_link_rate_hit(${tipo}, ${chaveDoToken(hash)}, ${chaveDoIp(ip)},
                                             ${teto.token}::int, ${teto.ip}::int,
                                             ${JANELA_DO_LIMITE_SEGUNDOS}::int) as r`;
    return (linha?.r ?? { allowed: true }) as { allowed: boolean; retry_after?: number };
  });
  if (!r.allowed) {
    const espera = Math.max(1, Number(r.retry_after ?? JANELA_DO_LIMITE_SEGUNDOS));
    throw new RecusaPublica(429, { message: FRASE_LIMITE }, espera);
  }
}

export async function lerPaginaPublica(sql: Sql, hash: string): Promise<PaginaPublica> {
  const p = await withActor(sql, { kind: 'preauth' }, async (tx) => {
    const [linha] = await tx`select ideworks.public_approval_page(${hash}) as p`;
    return (linha?.p ?? null) as { client_name: string; rounds: ChamadaDoBanco[] } | null;
  });
  if (!p) throw naoEncontrado();
  return montarPagina(p);
}

export async function lerChamadaPublica(sql: Sql, hash: string, roundId: string): Promise<ChamadaPublica> {
  if (!pareceId(roundId)) throw naoEncontrado();
  const c = await withActor(sql, { kind: 'preauth' }, async (tx) => {
    const [linha] = await tx`select ideworks.public_approval_round(${hash}, ${roundId}::uuid) as c`;
    return (linha?.c ?? null) as ChamadaDoBanco | null;
  });
  const montada = c ? montarChamada(c) : null;
  if (!montada) throw naoEncontrado();
  return montada;
}

/** O cliente comenta uma chamada aberta (item opcional), sem decidir. */
export async function comentarComoCliente(
  sql: Sql,
  hash: string,
  roundId: string,
  corpo: Record<string, unknown>,
): Promise<ComentarioPublico> {
  if (!pareceId(roundId)) throw naoEncontrado();
  const texto = conferirTexto(corpo.texto, true, FRASE_COMENTARIO_VAZIO) as string;
  const itemBruto = corpo.itemId;
  if (itemBruto !== undefined && itemBruto !== null && (typeof itemBruto !== 'string' || !pareceId(itemBruto))) {
    throw naoEncontrado();
  }
  const itemId = typeof itemBruto === 'string' ? itemBruto : null;
  const c = await withActor(sql, { kind: 'preauth' }, async (tx) => {
    try {
      const [linha] = await tx`
        select ideworks.comment_approval_round(${hash}, ${roundId}::uuid, ${itemId}::uuid, ${texto}) as c`;
      return linha.c as ComentarioDoBanco;
    } catch (erro) {
      return traduzir(erro, FRASE_COMENTARIO_VAZIO);
    }
  });
  return montarComentario(c);
}

/**
 * O cliente aprova ou reprova. A trava da linha no banco faz a segunda decisão
 * (outra aba, clique duplo) esperar a primeira e cair em 409. Devolve a chamada
 * como ficou, lida na mesma transação.
 */
export async function decidirComoCliente(
  sql: Sql,
  hash: string,
  roundId: string,
  decisao: 'approve' | 'reject',
  corpo: Record<string, unknown>,
): Promise<ChamadaPublica> {
  if (!pareceId(roundId)) throw naoEncontrado();
  const fraseVazio = decisao === 'reject' ? FRASE_REPROVAR_SEM_COMENTARIO : FRASE_COMENTARIO_VAZIO;
  const comentario = conferirTexto(corpo.comentario, decisao === 'reject', fraseVazio);
  const c = await withActor(sql, { kind: 'preauth' }, async (tx) => {
    try {
      await tx`select ideworks.decide_approval_round(${hash}, ${roundId}::uuid, ${decisao}, ${comentario}) as r`;
    } catch (erro) {
      return traduzir(erro, fraseVazio);
    }
    const [linha] = await tx`select ideworks.public_approval_round(${hash}, ${roundId}::uuid) as c`;
    return (linha?.c ?? null) as ChamadaDoBanco | null;
  });
  const montada = c ? montarChamada(c) : null;
  if (!montada) throw naoEncontrado();
  return montada;
}

/* ─────────────────────────── a imagem da arte anexada (F42, Fase 9) ─────────────────────────── */

export const FRASE_IMAGEM_FALHOU = 'Não foi possível carregar a imagem agora. Tente de novo.';

/**
 * A imagem de um item de ANEXO, servida PELO WORKER.
 *
 * POR QUE PROXY, E NÃO URL ASSINADA
 *   - O caminho do balde nunca sai: uma URL assinada do Storage carrega
 *     `ideworks-anexos/aprovacoes/<rodada>/…` no endereço.
 *   - Revogar o link corta na hora: não sobra uma URL assinada viva por minutos.
 *   - Os bytes saem com os cabeçalhos da rota pública (no-referrer, noindex,
 *     nosniff, CSP sem script), do mesmo domínio da página.
 *   - É simples: ≤ 5 MB por arte, em fluxo, sem carregar na memória.
 *
 * Token → cliente → chamada visível dele → item de anexo daquela chamada, tudo
 * em `public_approval_item_object` (F42_7). Qualquer outro caso: o MESMO 404.
 * O tipo vem do banco (lista fechada de imagens), não do Storage.
 */
export async function servirImagemPublica(
  sql: Sql,
  armazenamento: ArmazenamentoPrivado,
  hash: string,
  roundId: string,
  itemId: string,
): Promise<Response> {
  if (!pareceId(roundId) || !pareceId(itemId)) throw naoEncontrado();
  const o = await withActor(sql, { kind: 'preauth' }, async (tx) => {
    const [linha] = await tx`
      select ideworks.public_approval_item_object(${hash}, ${roundId}::uuid, ${itemId}::uuid) as o`;
    return (linha?.o ?? null) as { storage_path: string; content_type: string } | null;
  });
  if (!o) throw naoEncontrado();

  let r: Response;
  try {
    r = await lerObjetoDoBalde(armazenamento, o.storage_path);
  } catch {
    throw new RecusaPublica(502, { message: FRASE_IMAGEM_FALHOU });
  }
  if (r.status === 400 || r.status === 404) throw naoEncontrado();
  if (!r.ok || !r.body) throw new RecusaPublica(502, { message: FRASE_IMAGEM_FALHOU });

  const cabecalhos = new Headers({
    'Content-Type': o.content_type,
    // Cache curto e só do navegador: a cópia não muda, mas o link pode ser
    // revogado; cinco minutos é o teto do que sobra depois disso.
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  const tamanho = r.headers.get('Content-Length');
  if (tamanho) cabecalhos.set('Content-Length', tamanho);
  return new Response(r.body, { status: 200, headers: cabecalhos });
}
