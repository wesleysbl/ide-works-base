/**
 * A PÁGINA DO CLIENTE, SEM TELA — F42, Fase 6.
 *
 * Tudo o que a página `/aprovar/:token` precisa e que não é desenho: o
 * cliente da API pública, as frases e as datas. Mora fora do `.tsx` por duas
 * razões: o teste lê sem DOM, e a regra do Vite (arquivo de componente só
 * exporta componente).
 *
 * ⚠️ NADA AQUI USA `@/lib/api`
 *   O cliente da API do sistema renova o crachá quando recebe 401 (vai a
 *   `/auth/refresh`) e manda o cookie da sessão. O cliente da agência NÃO TEM
 *   sessão: a credencial dele é o token do endereço. Este arquivo fala só com
 *   `/api/public/aprovacao/…`, com `credentials: 'omit'` — nem o cookie de
 *   alguém da equipe que abra o link no próprio navegador atravessa — e com
 *   `referrerPolicy: 'no-referrer'`.
 *
 * ⚠️ OS TIPOS VÊM DO SERVIDOR, O CÓDIGO NÃO
 *   `@/server/aprovacao-publica` importa o banco (`postgres`). Daqui só se
 *   importa TIPO (`import type`), que some no pacote. A data por extenso é
 *   reescrita aqui pelo mesmo motivo.
 */

import type { ChamadaPublica, ComentarioPublico, PaginaPublica } from '@/server/aprovacao-publica';

export type { ChamadaPublica, ComentarioPublico, ItemPublico, PaginaPublica } from '@/server/aprovacao-publica';

/* ─────────────────────────── frases ─────────────────────────── */

export const FRASE_REDE = 'Sem conexão com a Ide agora. Confira a internet e tente de novo.';
export const FRASE_FALHA = 'Não foi possível concluir. Tente de novo em instantes.';
export const FRASE_LIMITE_TELA = 'Muitas tentativas em pouco tempo. Aguarde um instante e tente de novo.';
export const FRASE_MATERIAL_NAO_ABRIU = 'Não abriu? Tente de novo ou fale com o atendimento.';
export const FRASE_MOTIVO_OBRIGATORIO = 'Para pedir ajustes, escreva o que precisa mudar.';
export const FRASE_COMENTARIO_OBRIGATORIO = 'Escreva o comentário antes de enviar.';
/** O mesmo teto do servidor (`TETO_DO_COMENTARIO`). */
export const TETO_DO_TEXTO = 2000;

/* ─────────────────────────── o erro ─────────────────────────── */

/** Recusa ou falha da API pública: a frase do servidor, o status e, no 429, a espera. */
export class ErroPublico extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly esperarSegundos?: number,
  ) {
    super(message);
    this.name = 'ErroPublico';
  }
}

export const ehLinkInvalido = (e: unknown) => e instanceof ErroPublico && e.status === 404;
export const ehLimite = (e: unknown) => e instanceof ErroPublico && e.status === 429;
export const ehJaRespondida = (e: unknown) => e instanceof ErroPublico && e.status === 409;

/** A frase a mostrar para um erro qualquer. O 429 ganha a frase da tela, mais calma que a do servidor. */
export function fraseDoErro(e: unknown): string {
  if (ehLimite(e)) return FRASE_LIMITE_TELA;
  if (e instanceof ErroPublico && e.message) return e.message;
  return FRASE_FALHA;
}

/* ─────────────────────────── a API ─────────────────────────── */

type Busca = typeof fetch;

/**
 * O cliente da API pública de UM token. `buscar` existe para o teste; a página
 * usa o `fetch` do navegador.
 */
export function apiDoLink(token: string, buscar: Busca = (...a) => fetch(...a)) {
  const raiz = `/api/public/aprovacao/${encodeURIComponent(token)}`;

  async function pedir<T>(caminho: string, corpo?: Record<string, unknown>): Promise<T> {
    let resposta: Response;
    try {
      resposta = await buscar(raiz + caminho, {
        method: corpo ? 'POST' : 'GET',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: corpo
          ? { Accept: 'application/json', 'Content-Type': 'application/json' }
          : { Accept: 'application/json' },
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
    } catch {
      throw new ErroPublico(FRASE_REDE, 0);
    }
    let dados: Record<string, unknown> = {};
    let ehObjeto = false;
    try {
      const lido: unknown = await resposta.json();
      ehObjeto = typeof lido === 'object' && lido !== null && !Array.isArray(lido);
      if (ehObjeto) dados = lido as Record<string, unknown>;
    } catch {
      dados = {};
    }
    // Um 200 sem objeto JSON é de intermediário (portal de wi-fi, proxy): não é
    // a página, e entregá-la como `{}` estourava a tela em `pagina.cliente.nome`.
    if (resposta.ok && !ehObjeto) throw new ErroPublico(FRASE_FALHA, resposta.status);
    if (!resposta.ok) {
      const espera = Number(resposta.headers.get('Retry-After') ?? '');
      const frase = typeof dados.message === 'string' && dados.message ? dados.message : FRASE_FALHA;
      throw new ErroPublico(frase, resposta.status, Number.isFinite(espera) && espera > 0 ? espera : undefined);
    }
    return dados as T;
  }

  const daChamada = (id: string) => `/chamadas/${encodeURIComponent(id)}`;
  const comImagens = (c: ChamadaPublica) => comEnderecoDasArtes(raiz, c);

  return {
    pagina: () =>
      pedir<PaginaPublica>('').then((p) => ({ ...p, chamadas: (p.chamadas ?? []).map(comImagens) })),
    chamada: (id: string) =>
      pedir<{ ok: true; chamada: ChamadaPublica }>(daChamada(id)).then((r) => comImagens(r.chamada)),
    comentar: (id: string, texto: string, itemId: string | null) =>
      pedir<{ ok: true; comentario: ComentarioPublico }>(
        daChamada(id) + '/comentarios',
        itemId ? { texto, itemId } : { texto },
      ).then((r) => r.comentario),
    aprovar: (id: string) =>
      pedir<{ ok: true; chamada: ChamadaPublica }>(daChamada(id) + '/aprovar', {}).then((r) => comImagens(r.chamada)),
    reprovar: (id: string, comentario: string) =>
      pedir<{ ok: true; chamada: ChamadaPublica }>(daChamada(id) + '/reprovar', { comentario }).then((r) =>
        comImagens(r.chamada),
      ),
  };
}

export type ApiDoLink = ReturnType<typeof apiDoLink>;

/**
 * F42, Fase 9 — a arte anexada (`forma: 'anexo'`) chega sem endereço: a API
 * não devolve o token. Aqui, com a raiz do link (que já carrega o token),
 * cada uma ganha o endereço da imagem servida pelo Worker. O resto fica igual.
 */
export function comEnderecoDasArtes(raiz: string, c: ChamadaPublica): ChamadaPublica {
  if (!c.itens.some((i) => i.forma === 'anexo')) return c;
  return {
    ...c,
    itens: c.itens.map((i) =>
      i.forma === 'anexo'
        ? {
            ...i,
            exibicao: `${raiz}/chamadas/${encodeURIComponent(c.id)}/itens/${encodeURIComponent(i.id)}/imagem`,
          }
        : i,
    ),
  };
}

/* ─────────────────────────── datas ─────────────────────────── */

const partesEmBrasilia = (iso: string, comAno: boolean, comHora: boolean) => {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    ...(comAno ? { year: 'numeric' } : {}),
    ...(comHora ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }).formatToParts(new Date(iso));
  return (t: string) => partes.find((x) => x.type === t)?.value ?? '';
};

/** "07/10" — o selo da lista. */
export function diaEMes(iso: string): string {
  const p = partesEmBrasilia(iso, false, false);
  return `${p('day')}/${p('month')}`;
}

/** "07/10/2026 às 14:32", no horário de Brasília. */
export function dataEHoraCurta(iso: string): string {
  const p = partesEmBrasilia(iso, true, true);
  return `${p('day')}/${p('month')}/${p('year')} às ${p('hour')}:${p('minute')}`;
}

/* ─────────────────────────── a chamada ─────────────────────────── */

export const estaAberta = (c: Pick<ChamadaPublica, 'estado'>) => c.estado === 'aberta';

/** Abertas primeiro, na ordem que vieram; depois as respondidas. */
export function separar(chamadas: readonly ChamadaPublica[]) {
  return {
    abertas: chamadas.filter(estaAberta),
    respondidas: chamadas.filter((c) => !estaAberta(c)),
  };
}

/** O selo de uma chamada respondida: "Aprovado em 07/10" ou "Ajustes pedidos em 07/10". */
export function seloDaDecisao(c: Pick<ChamadaPublica, 'estado' | 'decididaEm'>, longo = false): string | null {
  if (c.estado === 'aberta') return null;
  const base = c.estado === 'aprovada' ? 'Aprovado' : 'Ajustes pedidos';
  if (!c.decididaEm) return base;
  return `${base} em ${longo ? dataEHoraCurta(c.decididaEm) : diaEMes(c.decididaEm)}`;
}

/** "1 material", "4 materiais". */
export const quantosMateriais = (n: number) => `${n} ${n === 1 ? 'material' : 'materiais'}`;

/** Marca o material `i` como visto (lista ordenada, sem repetir). */
export function marcarVisto(vistos: readonly number[], i: number): number[] {
  return vistos.includes(i) ? [...vistos] : [...vistos, i].sort((a, b) => a - b);
}

/** Quantos dos `total` materiais já foram vistos (índices fora do intervalo não contam). */
export function quantosVistos(vistos: readonly number[], total: number): number {
  return new Set(vistos.filter((i) => i >= 0 && i < total)).size;
}

/** O primeiro material ainda não visto, ou `null` se viu todos. */
export function primeiroNaoVisto(vistos: readonly number[], total: number): number | null {
  for (let i = 0; i < total; i++) if (!vistos.includes(i)) return i;
  return null;
}

/** "Você viu 1 de 4 materiais. Quer aprovar mesmo assim?" — ou `null` se viu todos. */
export function perguntaDosVistos(vistos: readonly number[], total: number): string | null {
  const v = quantosVistos(vistos, total);
  if (total === 0 || v >= total) return null;
  return `Você viu ${v} de ${total} ${total === 1 ? 'material' : 'materiais'}. Quer aprovar mesmo assim?`;
}

/** Troca a chamada de mesmo id na página (depois de comentar ou decidir). */
export function trocarChamada(pagina: PaginaPublica, nova: ChamadaPublica): PaginaPublica {
  return { ...pagina, chamadas: pagina.chamadas.map((c) => (c.id === nova.id ? nova : c)) };
}

/** Acrescenta um comentário recém-gravado à chamada, sem reler a página. */
export function comComentario(c: ChamadaPublica, comentario: ComentarioPublico): ChamadaPublica {
  if (c.comentarios.some((x) => x.id === comentario.id)) return c;
  return { ...c, comentarios: [...c.comentarios, comentario] };
}

/**
 * O texto de um comentário ou motivo antes de ir ao servidor: aparado, não
 * vazio, até o teto. Devolve a frase do problema, ou `null` se pode enviar.
 */
export function problemaDoTexto(texto: string, fraseVazio: string): string | null {
  const t = texto.trim();
  if (t === '' || /^[\p{P}\p{S}\s]+$/u.test(t)) return fraseVazio;
  if ([...t].length > TETO_DO_TEXTO) return `Texto longo demais: até ${TETO_DO_TEXTO} caracteres.`;
  return null;
}
