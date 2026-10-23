/**
 * A API PÚBLICA DO CLIENTE — F42, Fase 5.
 *
 * Exercita o Worker de verdade (`worker.fetch`), sem sessão, com o banco
 * simulado em memória no desenho de `aprovacao-rotas.test.ts`. O dublê imita as
 * funções da F42_6 e a `decide_approval_round` da F42_4 (as regras de verdade
 * estão provadas no PGlite, em `src/server/aprovacao-publica-banco.test.ts`) e,
 * DE PROPÓSITO, devolve chaves internas a mais (`task_id`, `sent_by`, autor,
 * identificador do Dropbox): é a lista permitida do Worker que tem de barrá-las.
 *
 * O que se prova:
 *   - privacidade: as chaves do JSON são exatamente as da lista permitida, em
 *     todos os níveis; nenhum comentário interno, nenhum id de pessoa ou card;
 *   - item de arquivo com `raw=1` (mantém `rlkey`, sem `dl`); pasta com o link
 *     original; legenda sem link do Dropbox;
 *   - 404 idêntico para token inexistente, revogado e chamada de outro cliente;
 *   - comentar: 201; item de outra chamada 404; vazio 400; longo 400; chamada
 *     decidida 409;
 *   - aprovar em paralelo: uma 200 e outra 409 ("já foi respondida em …"), um
 *     evento só; reprovar sem comentário: 400 sem ir ao banco decidir;
 *   - POST só JSON (415) e só da origem do app (403);
 *   - 429 depois do teto, com `Retry-After`, para leitura e para escrita;
 *   - os cabeçalhos `no-referrer`/`noindex`/`no-store` em toda resposta;
 *   - o token nunca vai ao log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import worker from '../worker/index';
import {
  CHAVES_DA_CHAMADA,
  CHAVES_DA_PAGINA,
  CHAVES_DO_CLIENTE,
  CHAVES_DO_COMENTARIO,
  CHAVES_DO_ITEM,
  FRASE_NAO_ENCONTRADO,
  FRASE_REPROVAR_SEM_COMENTARIO,
  LIMITES_PUBLICOS,
  TETO_DO_COMENTARIO,
  chaveDoIp,
  legendaSemDropbox,
  prefixoIpv6,
} from '@/server/aprovacao-publica';
import { hashDoToken } from '@/server/link-de-aprovacao';

/* ─────────────────────────── o banco dublê ─────────────────────────── */

const TOKEN_A = 'A'.repeat(43);
const TOKEN_B = 'B'.repeat(43);
const TOKEN_REVOGADO = 'R'.repeat(43);
const TOKEN_NENHUM = 'N'.repeat(43);
const CLIENTE_A = '00000000-0000-0000-0000-00000000c00a';
const CLIENTE_B = '00000000-0000-0000-0000-00000000c00b';
const PESSOA = '00000000-0000-0000-0000-0000000000e1';
const CARD = '00000000-0000-0000-0000-00000000ca7d';
const R_ABERTA = '00000000-0000-0000-0000-0000000000a1';
const R_APROVADA = '00000000-0000-0000-0000-0000000000a2';
const R_DE_B = '00000000-0000-0000-0000-0000000000b1';
const I_ARQUIVO = '00000000-0000-0000-0000-0000000001a1';
const I_PASTA = '00000000-0000-0000-0000-0000000001a2';
const I_DE_APROVADA = '00000000-0000-0000-0000-0000000001b1';

const LINK_ARQUIVO = 'https://www.dropbox.com/scl/fi/abc123/peca%201.mp4?rlkey=xyz&dl=0';
const LINK_PASTA = 'https://www.dropbox.com/scl/fo/def456/AAAbbb?rlkey=pasta&dl=0';

type Comentario = { id: string; body: string; created_at: string; item_id: string | null; from_client: boolean; author_id: string | null };
type Rodada = {
  id: string;
  client: string;
  state: 'open' | 'approved' | 'rejected' | 'superseded';
  decided_at: string | null;
  task_title: string;
  version: number;
  sent_at: string;
  caption: string;
  items: { id: string; position: number; url: string | null; kind: string; file_name: string; storage_path?: string; content_type?: string }[];
  comments: Comentario[];
};

let hashes: Record<string, string>;
let banco: { links: Map<string, string>; rodadas: Rodada[]; eventos: number; limite: Map<string, number[]> };
const consultas: string[] = [];

function erroIw(hint: string, detail?: string) {
  return Object.assign(new Error(hint), { code: 'IW042', hint, detail });
}

const VISIVEL = new Set(['open', 'approved', 'rejected']);

/** Como a função do banco devolve — COM chaves internas a mais, para o Worker barrar. */
function comoDoBanco(r: Rodada) {
  return {
    id: r.id,
    task_title: r.task_title,
    version: r.version,
    sent_at: r.sent_at,
    caption: r.caption,
    state: r.state,
    decided_at: r.decided_at,
    task_id: CARD,
    sent_by: PESSOA,
    list_id: '00000000-0000-0000-0000-0000000001f1',
    // F42_7: a função real devolve só `attachment`; o dublê manda também o
    // caminho do balde, para provar que a lista permitida o barra.
    items: r.items.map((i) => ({ ...i, attachment: i.storage_path !== undefined, dropbox_file_id: 'id:segredo', dropbox_rev: 'rev-segredo' })),
    comments: r.comments
      .filter((c) => c.from_client)
      .map((c) => ({ id: c.id, body: c.body, created_at: c.created_at, item_id: c.item_id, author_id: PESSOA })),
  };
}

function responder(texto: string, v: unknown[]): unknown[] {
  if (texto.includes('set_config')) return [];
  if (texto.includes('approval_link_rate_hit')) {
    const [tipo, chaveToken, chaveIp, maxToken, maxIp, janela] = v as [string, string, string, number, number, number];
    const agora = Date.now();
    const desde = agora - janela * 1000;
    const vivos = (k: string) => (banco.limite.get(k) ?? []).filter((t) => t >= desde);
    for (const [escopo, k, max] of [
      ['token', `${tipo}:token:${chaveToken}`, maxToken],
      ['ip', `${tipo}:ip:${chaveIp}`, maxIp],
    ] as const) {
      const lista = vivos(k);
      if (lista.length >= max) {
        return [{ r: { allowed: false, blocked_by: escopo, retry_after: Math.ceil((lista[0] + janela * 1000 - agora) / 1000) } }];
      }
    }
    for (const k of [`${tipo}:token:${chaveToken}`, `${tipo}:ip:${chaveIp}`]) banco.limite.set(k, [...vivos(k), agora]);
    return [{ r: { allowed: true } }];
  }
  const cliente = (hash: unknown) => banco.links.get(hash as string) ?? null;
  if (texto.includes('public_approval_page')) {
    const c = cliente(v[0]);
    if (!c) return [{ p: null }];
    const rounds = banco.rodadas
      .filter((r) => r.client === c && VISIVEL.has(r.state))
      .sort((a, b) => Number(b.state === 'open') - Number(a.state === 'open'))
      .map(comoDoBanco);
    return [{ p: { client_name: c === CLIENTE_A ? 'Padaria Aurora' : 'Loja Beta', client_id: c, rounds } }];
  }
  if (texto.includes('decide_approval_round')) {
    const [hash, id, decisao, comentario] = v as [string, string, string, string | null];
    const c = cliente(hash);
    if (!c) throw erroIw('link_invalid');
    const r = banco.rodadas.find((x) => x.id === id && x.client === c);
    if (!r) throw erroIw('round_not_found');
    if (r.state !== 'open') {
      throw erroIw('round_not_open', JSON.stringify({ state: r.state, decided_at: r.decided_at, closed_at: null }));
    }
    if (decisao === 'reject' && !comentario?.trim()) throw erroIw('comment_required');
    r.state = decisao === 'approve' ? 'approved' : 'rejected';
    r.decided_at = '2026-10-07T17:32:00.000Z';
    if (comentario) {
      r.comments.push({ id: `c${r.comments.length + 1}`, body: comentario, created_at: r.decided_at, item_id: null, from_client: true, author_id: null });
    }
    banco.eventos += 1;
    return [{ r: { state: r.state } }];
  }
  if (texto.includes('public_approval_round')) {
    const c = cliente(v[0]);
    const r = banco.rodadas.find((x) => x.id === v[1] && x.client === c && VISIVEL.has(x.state));
    return [{ c: c && r ? comoDoBanco(r) : null }];
  }
  if (texto.includes('public_approval_item_object')) {
    const c = cliente(v[0]);
    const r = banco.rodadas.find((x) => x.id === v[1] && x.client === c && VISIVEL.has(x.state));
    const i = r?.items.find((x) => x.id === v[2] && x.storage_path !== undefined);
    return [{ o: c && r && i ? { storage_path: i.storage_path, content_type: i.content_type } : null }];
  }
  if (texto.includes('comment_approval_round')) {
    const [hash, id, item, corpo] = v as [string, string, string | null, string];
    const c = cliente(hash);
    if (!c) throw erroIw('link_invalid');
    const r = banco.rodadas.find((x) => x.id === id && x.client === c && VISIVEL.has(x.state));
    if (!r) throw erroIw('round_not_found');
    if (r.state !== 'open') {
      throw erroIw('round_not_open', JSON.stringify({ state: r.state, decided_at: r.decided_at, closed_at: null }));
    }
    if (item && !r.items.some((i) => i.id === item)) throw erroIw('item_not_found');
    const novo: Comentario = { id: `c${r.comments.length + 1}`, body: corpo, created_at: '2026-10-07T17:00:00.000Z', item_id: item, from_client: true, author_id: null };
    r.comments.push(novo);
    return [{ c: { id: novo.id, body: novo.body, created_at: novo.created_at, item_id: novo.item_id } }];
  }
  throw new Error(`Consulta não prevista na prova: ${texto}`);
}

vi.mock('@/server/db', async (original) => ({
  ...(await original<typeof import('@/server/db')>()),
  connect: () => ({
    end: async () => {},
    begin: async (work: (tx: unknown) => Promise<unknown>) =>
      work(async (partes: TemplateStringsArray, ...valores: unknown[]) => {
        const texto = partes.join('?');
        consultas.push(texto);
        // Uma volta no laço de eventos, como a rede: pedidos em paralelo se intercalam.
        await new Promise((r) => setTimeout(r, 0));
        return responder(texto, valores);
      }),
  }),
}));

/* ─────────────────────────── o Worker ─────────────────────────── */

const env = {
  IDEWORKS_PUBLIC_SUPABASE_URL: 'https://provider.invalid',
  IDEWORKS_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
  IDEWORKS_SERVER_SUPABASE_SERVICE_KEY: 'service-key',
};
const ORIGEM = 'https://app.invalid';

const pedir = (
  metodo: string,
  caminho: string,
  corpo?: unknown,
  cabecalhos: Record<string, string> = { 'Content-Type': 'application/json', Origin: ORIGEM },
  ip = '203.0.113.7',
) =>
  worker.fetch(
    new Request(`${ORIGEM}/api/public/aprovacao/${caminho}`, {
      method: metodo,
      headers: { 'CF-Connecting-IP': ip, ...(metodo === 'GET' ? {} : cabecalhos) },
      body: corpo === undefined ? undefined : typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
    }),
    env as never,
  );

const ler = (token: string, ip?: string) => pedir('GET', token, undefined, undefined, ip);

function cabecalhosPublicos(r: Response) {
  expect(r.headers.get('Referrer-Policy')).toBe('no-referrer');
  expect(r.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  expect(r.headers.get('Cache-Control')).toBe('no-store');
}

let erros: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  consultas.length = 0;
  hashes = {
    [TOKEN_A]: await hashDoToken(TOKEN_A),
    [TOKEN_B]: await hashDoToken(TOKEN_B),
  };
  banco = {
    links: new Map([
      [hashes[TOKEN_A], CLIENTE_A],
      [hashes[TOKEN_B], CLIENTE_B],
    ]),
    eventos: 0,
    limite: new Map(),
    rodadas: [
      {
        id: R_APROVADA,
        client: CLIENTE_A,
        state: 'approved',
        decided_at: '2026-10-06T13:00:00.000Z',
        task_title: 'Arte do dia das mães',
        version: 1,
        sent_at: '2026-10-05T12:00:00.000Z',
        caption: 'Legenda antiga',
        items: [{ id: I_DE_APROVADA, position: 1, url: 'https://www.dropbox.com/scl/fi/zz/arte.jpg?rlkey=k', kind: 'image', file_name: 'arte.jpg' }],
        comments: [
          { id: 'ci', body: 'INTERNO: o cliente vai reclamar', created_at: '2026-10-05T12:01:00.000Z', item_id: null, from_client: false, author_id: PESSOA },
        ],
      },
      {
        id: R_ABERTA,
        client: CLIENTE_A,
        state: 'open',
        decided_at: null,
        task_title: 'Reels de lançamento',
        version: 2,
        sent_at: '2026-10-07T12:00:00.000Z',
        caption: `Chegou o pão de fermentação natural!\n\nVídeo: ${LINK_ARQUIVO}\n[pasta das fotos](${LINK_PASTA})\n#padaria`,
        items: [
          { id: I_PASTA, position: 2, url: LINK_PASTA, kind: 'other', file_name: 'Pasta do Dropbox' },
          { id: I_ARQUIVO, position: 1, url: LINK_ARQUIVO, kind: 'video', file_name: 'peca 1.mp4' },
        ],
        comments: [
          { id: 'cj', body: 'INTERNO: refazer a cor', created_at: '2026-10-07T12:01:00.000Z', item_id: null, from_client: false, author_id: PESSOA },
        ],
      },
      {
        id: R_DE_B,
        client: CLIENTE_B,
        state: 'open',
        decided_at: null,
        task_title: 'Segredo da Loja Beta',
        version: 1,
        sent_at: '2026-10-07T10:00:00.000Z',
        caption: 'beta',
        items: [{ id: '00000000-0000-0000-0000-0000000002b1', position: 1, url: 'https://www.dropbox.com/scl/fi/b/b.jpg?rlkey=b', kind: 'image', file_name: 'b.jpg' }],
        comments: [],
      },
    ],
  };
  erros = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  // O token cru nunca vai ao log — em nenhuma resposta desta suíte.
  const registrado = erros.mock.calls.map((c: unknown[]) => c.map(String).join(' ')).join('\n');
  for (const t of [TOKEN_A, TOKEN_B, TOKEN_REVOGADO, TOKEN_NENHUM]) expect(registrado).not.toContain(t);
  erros.mockRestore();
});

/* ─────────────────────────── privacidade ─────────────────────────── */

/** Confere, em todos os níveis, que as chaves são EXATAMENTE as da lista permitida. */
function soChavesPermitidas(pagina: Record<string, unknown>) {
  expect(Object.keys(pagina).sort()).toEqual([...CHAVES_DA_PAGINA].sort());
  expect(Object.keys(pagina.cliente as object).sort()).toEqual([...CHAVES_DO_CLIENTE].sort());
  for (const c of pagina.chamadas as Record<string, unknown>[]) conferirChamada(c);
}

function conferirChamada(c: Record<string, unknown>) {
  expect(Object.keys(c).sort()).toEqual([...CHAVES_DA_CHAMADA].sort());
  for (const i of c.itens as object[]) expect(Object.keys(i).sort()).toEqual([...CHAVES_DO_ITEM].sort());
  for (const k of c.comentarios as object[]) expect(Object.keys(k).sort()).toEqual([...CHAVES_DO_COMENTARIO].sort());
}

describe('GET /public/aprovacao/:token — a página', () => {
  it('cliente e chamadas, abertas primeiro, só com as chaves permitidas e nada interno', async () => {
    const r = await ler(TOKEN_A);
    expect(r.status).toBe(200);
    cabecalhosPublicos(r);
    const corpo = (await r.json()) as Record<string, unknown>;
    soChavesPermitidas(corpo);
    expect(corpo.cliente).toEqual({ nome: 'Padaria Aurora' });
    const chamadas = corpo.chamadas as { id: string; estado: string }[];
    expect(chamadas.map((c) => [c.id, c.estado])).toEqual([
      [R_ABERTA, 'aberta'],
      [R_APROVADA, 'aprovada'],
    ]);
    const texto = JSON.stringify(corpo);
    for (const proibido of ['INTERNO', PESSOA, CARD, 'id:segredo', 'rev-segredo', CLIENTE_A, 'Segredo da Loja Beta']) {
      expect(texto).not.toContain(proibido);
    }
  });

  it('arquivo vem com raw=1 (rlkey mantido, sem dl); pasta com o link original; itens na ordem', async () => {
    const corpo = (await (await ler(TOKEN_A)).json()) as { chamadas: { id: string; itens: Record<string, unknown>[] }[] };
    const aberta = corpo.chamadas.find((c) => c.id === R_ABERTA)!;
    const [arquivo, pasta] = aberta.itens;
    expect(arquivo).toMatchObject({ id: I_ARQUIVO, ordem: 1, tipo: 'video', forma: 'arquivo', abrirNoDropbox: null });
    const exibicao = new URL(arquivo.exibicao as string);
    expect(exibicao.searchParams.get('raw')).toBe('1');
    expect(exibicao.searchParams.get('rlkey')).toBe('xyz');
    expect(exibicao.searchParams.has('dl')).toBe(false);
    expect(pasta).toMatchObject({ id: I_PASTA, ordem: 2, forma: 'pasta', exibicao: null, abrirNoDropbox: LINK_PASTA });
  });

  it('a legenda exibida não traz link do Dropbox (o rótulo do link markdown fica)', async () => {
    const corpo = (await (await ler(TOKEN_A)).json()) as { chamadas: { id: string; legenda: string }[] };
    const legenda = corpo.chamadas.find((c) => c.id === R_ABERTA)!.legenda;
    expect(legenda).not.toMatch(/dropbox/i);
    expect(legenda).toContain('Chegou o pão de fermentação natural!');
    expect(legenda).toContain('pasta das fotos');
    expect(legenda).toContain('#padaria');
  });

  it('token inexistente, revogado e fora do formato: o mesmo 404, com os cabeçalhos', async () => {
    const corpos: string[] = [];
    for (const t of [TOKEN_NENHUM, TOKEN_REVOGADO, 'curto']) {
      const r = await ler(t);
      expect(r.status).toBe(404);
      cabecalhosPublicos(r);
      corpos.push(await r.text());
    }
    expect(new Set(corpos).size).toBe(1);
    expect(JSON.parse(corpos[0])).toEqual({ message: FRASE_NAO_ENCONTRADO });
  });

  it('caminho ou método fora da API: o mesmo 404 com os cabeçalhos', async () => {
    for (const [m, c] of [
      ['GET', `${TOKEN_A}/chamadas/${R_ABERTA}/aprovar`],
      ['POST', TOKEN_A],
      ['GET', `${TOKEN_A}/outra-coisa`],
    ] as const) {
      const r = await pedir(m, c, m === 'POST' ? {} : undefined);
      expect(r.status).toBe(404);
      cabecalhosPublicos(r);
      expect(await r.json()).toEqual({ message: FRASE_NAO_ENCONTRADO });
    }
  });
});

describe('GET /public/aprovacao/:token/chamadas/:id — uma chamada', () => {
  it('a do próprio cliente vem, com as chaves permitidas', async () => {
    const r = await ler(`${TOKEN_A}/chamadas/${R_ABERTA}`);
    expect(r.status).toBe(200);
    cabecalhosPublicos(r);
    const corpo = (await r.json()) as { ok: boolean; chamada: Record<string, unknown> };
    expect(Object.keys(corpo).sort()).toEqual(['chamada', 'ok']);
    conferirChamada(corpo.chamada);
    expect(JSON.stringify(corpo)).not.toContain('INTERNO');
  });

  it('chamada de outro cliente responde o MESMO 404 do token inválido', async () => {
    const deOutro = await ler(`${TOKEN_A}/chamadas/${R_DE_B}`);
    const invalido = await ler(TOKEN_NENHUM);
    expect(deOutro.status).toBe(404);
    cabecalhosPublicos(deOutro);
    expect(await deOutro.text()).toBe(await invalido.text());
    expect((await ler(`${TOKEN_A}/chamadas/nao-e-id`)).status).toBe(404);
  });
});

/* ─────────────────────────── comentar ─────────────────────────── */

const comentar = (token: string, rodada: string, corpo: unknown, cab?: Record<string, string>) =>
  pedir('POST', `${token}/chamadas/${rodada}/comentarios`, corpo, cab);

describe('POST …/comentarios — comentar sem decidir', () => {
  it('201 com o comentário (só as chaves permitidas); a chamada continua aberta', async () => {
    const r = await comentar(TOKEN_A, R_ABERTA, { texto: '  O vídeo está ótimo.  ', itemId: I_ARQUIVO });
    expect(r.status).toBe(201);
    cabecalhosPublicos(r);
    const corpo = (await r.json()) as { comentario: Record<string, unknown> };
    expect(Object.keys(corpo.comentario).sort()).toEqual([...CHAVES_DO_COMENTARIO].sort());
    expect(corpo.comentario).toMatchObject({ texto: 'O vídeo está ótimo.', itemId: I_ARQUIVO });
    expect(banco.rodadas.find((x) => x.id === R_ABERTA)!.state).toBe('open');
    const lida = (await (await ler(`${TOKEN_A}/chamadas/${R_ABERTA}`)).json()) as { chamada: { comentarios: { texto: string }[] } };
    expect(lida.chamada.comentarios.map((c) => c.texto)).toEqual(['O vídeo está ótimo.']);
  });

  it('item de outra chamada e chamada de outro cliente: 404; vazio e só pontuação: 400; longo: 400', async () => {
    expect((await comentar(TOKEN_A, R_ABERTA, { texto: 'oi', itemId: I_DE_APROVADA })).status).toBe(404);
    expect((await comentar(TOKEN_A, R_DE_B, { texto: 'oi' })).status).toBe(404);
    expect((await comentar(TOKEN_A, R_ABERTA, { texto: '   ' })).status).toBe(400);
    expect((await comentar(TOKEN_A, R_ABERTA, { texto: '...' })).status).toBe(400);
    expect((await comentar(TOKEN_A, R_ABERTA, { texto: 'a'.repeat(TETO_DO_COMENTARIO + 1) })).status).toBe(400);
    expect((await comentar(TOKEN_A, R_ABERTA, { texto: 'a'.repeat(TETO_DO_COMENTARIO) })).status).toBe(201);
  });

  it('chamada já decidida: 409 com a data da resposta', async () => {
    const r = await comentar(TOKEN_A, R_APROVADA, { texto: 'mudei de ideia' });
    expect(r.status).toBe(409);
    cabecalhosPublicos(r);
    expect(((await r.json()) as { message: string }).message).toBe('Você já respondeu este envio em 06/10/2026 às 10:00.');
  });
});

/* ─────────────────────────── decidir ─────────────────────────── */

describe('POST …/aprovar e …/reprovar', () => {
  it('aprovar em paralelo: uma 200 e outra 409, e o card se move uma vez só', async () => {
    const [a, b] = await Promise.all([
      pedir('POST', `${TOKEN_A}/chamadas/${R_ABERTA}/aprovar`, {}),
      pedir('POST', `${TOKEN_A}/chamadas/${R_ABERTA}/aprovar`, {}),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    cabecalhosPublicos(a);
    cabecalhosPublicos(b);
    const ok = a.status === 200 ? a : b;
    const recusado = a.status === 200 ? b : a;
    const feito = (await ok.json()) as { chamada: Record<string, unknown> };
    conferirChamada(feito.chamada);
    expect(feito.chamada.estado).toBe('aprovada');
    expect(await recusado.json()).toEqual({
      message: 'Você já respondeu este envio em 07/10/2026 às 14:32.',
      estado: 'aprovada',
      decididaEm: '2026-10-07T17:32:00.000Z',
    });
    expect(banco.eventos).toBe(1);
  });

  it('reprovar sem comentário (ou só com pontuação): 400, sem ir ao banco decidir', async () => {
    for (const corpo of [{}, { comentario: '   ' }, { comentario: '?!' }]) {
      const r = await pedir('POST', `${TOKEN_A}/chamadas/${R_ABERTA}/reprovar`, corpo);
      expect(r.status).toBe(400);
      cabecalhosPublicos(r);
      expect(await r.json()).toEqual({ message: FRASE_REPROVAR_SEM_COMENTARIO });
    }
    expect(consultas.some((c) => c.includes('decide_approval_round'))).toBe(false);
    expect(banco.eventos).toBe(0);
  });

  it('reprovar com comentário: 200, estado "reprovada" e o comentário do cliente na chamada', async () => {
    const r = await pedir('POST', `${TOKEN_A}/chamadas/${R_ABERTA}/reprovar`, { comentario: 'Trocar a música.' });
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { chamada: { estado: string; comentarios: { texto: string }[] } };
    expect(corpo.chamada.estado).toBe('reprovada');
    expect(corpo.chamada.comentarios.map((c) => c.texto)).toEqual(['Trocar a música.']);
  });

  it('decidir chamada de outro cliente: o mesmo 404', async () => {
    const r = await pedir('POST', `${TOKEN_A}/chamadas/${R_DE_B}/aprovar`, {});
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ message: FRASE_NAO_ENCONTRADO });
    expect(banco.rodadas.find((x) => x.id === R_DE_B)!.state).toBe('open');
  });
});

/* ─────────────────────────── CSRF e abuso ─────────────────────────── */

describe('POST só JSON e só da origem do app', () => {
  it('outro tipo de corpo: 415, sem banco', async () => {
    const r = await pedir('POST', `${TOKEN_A}/chamadas/${R_ABERTA}/aprovar`, 'comentario=oi', {
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    expect(r.status).toBe(415);
    cabecalhosPublicos(r);
    expect(consultas).toEqual([]);
  });

  it('Origin de outro site: 403, sem banco; sem Origin (chamada de programa) passa', async () => {
    const r = await pedir('POST', `${TOKEN_A}/chamadas/${R_ABERTA}/aprovar`, {}, {
      'Content-Type': 'application/json',
      Origin: 'https://malicioso.example',
    });
    expect(r.status).toBe(403);
    cabecalhosPublicos(r);
    expect(consultas).toEqual([]);
    const semOrigem = await pedir('POST', `${TOKEN_A}/chamadas/${R_ABERTA}/comentarios`, { texto: 'ok' }, {
      'Content-Type': 'application/json; charset=utf-8',
    });
    expect(semOrigem.status).toBe(201);
  });

  it('corpo grande demais: 413; JSON quebrado: 400', async () => {
    const grande = await pedir('POST', `${TOKEN_A}/chamadas/${R_ABERTA}/comentarios`, { texto: 'x'.repeat(9000) });
    expect(grande.status).toBe(413);
    const quebrado = await pedir('POST', `${TOKEN_A}/chamadas/${R_ABERTA}/comentarios`, '{texto');
    expect(quebrado.status).toBe(400);
  });
});

describe('o limite de pedidos', () => {
  it(`leitura: depois de ${LIMITES_PUBLICOS.read.token} pedidos do mesmo token no minuto, 429 com Retry-After`, async () => {
    for (let i = 0; i < LIMITES_PUBLICOS.read.token; i++) {
      // IPs diferentes: quem barra é o teto do TOKEN.
      expect((await ler(TOKEN_A, `198.51.100.${i}`)).status).toBe(200);
    }
    const r = await ler(TOKEN_A, '198.51.100.250');
    expect(r.status).toBe(429);
    cabecalhosPublicos(r);
    expect(Number(r.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
    expect(((await r.json()) as { message: string }).message).toMatch(/Muitos pedidos/);
    // Outro link continua respondendo.
    expect((await ler(TOKEN_B, '198.51.100.251')).status).toBe(200);
  });

  it(`mais de ${LIMITES_PUBLICOS.read.ip} pedidos por minuto do mesmo IP: 429, mesmo com token inexistente`, async () => {
    for (let i = 0; i < LIMITES_PUBLICOS.read.ip; i++) {
      const t = i % 2 === 0 ? TOKEN_NENHUM : TOKEN_REVOGADO;
      expect((await ler(t, '192.0.2.9')).status).toBe(404);
    }
    expect((await ler(TOKEN_A, '192.0.2.9')).status).toBe(429);
  });

  it(`escrita: depois de ${LIMITES_PUBLICOS.write.token} comentários do mesmo token no minuto, 429`, async () => {
    for (let i = 0; i < LIMITES_PUBLICOS.write.token; i++) {
      expect((await comentar(TOKEN_A, R_ABERTA, { texto: `comentário ${i + 1}` })).status).toBe(201);
    }
    const r = await comentar(TOKEN_A, R_ABERTA, { texto: 'mais um' });
    expect(r.status).toBe(429);
    expect(r.headers.get('Retry-After')).not.toBeNull();
    // A leitura conta à parte.
    expect((await ler(TOKEN_A)).status).toBe(200);
  });
});

/**
 * IPv6 CONTA PELO /64 — F42, Fase 6 (achado baixo da verificação da Fase 5).
 * Um aparelho recebe um /64 inteiro e troca de endereço dentro dele; contar
 * por endereço daria um balde novo a cada pedido de quem varre tokens.
 */
describe('a chave do IP no limite', () => {
  it('IPv4 fica como está; lista de proxies usa o primeiro; vazio vira 0.0.0.0', () => {
    expect(chaveDoIp('203.0.113.7')).toBe('203.0.113.7');
    expect(chaveDoIp(' 203.0.113.7 , 10.0.0.1')).toBe('203.0.113.7');
    expect(chaveDoIp('')).toBe('0.0.0.0');
  });

  it('IPv6 vira o prefixo /64, em qualquer grafia do mesmo endereço', () => {
    expect(chaveDoIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(chaveDoIp('2001:0DB8:0001:0002::1')).toBe('2001:db8:1:2::/64');
    expect(chaveDoIp('[2001:db8:1:2::ff]')).toBe('2001:db8:1:2::/64');
    expect(chaveDoIp('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(chaveDoIp('::1')).toBe('0:0:0:0::/64');
    expect(chaveDoIp('2001:db8::')).toBe('2001:db8:0:0::/64');
    expect(chaveDoIp('64:ff9b::192.0.2.1')).toBe('64:ff9b:0:0::/64');
  });

  it('IPv4 mapeado em IPv6 volta a ser o IPv4', () => {
    expect(chaveDoIp('::ffff:198.51.100.4')).toBe('198.51.100.4');
    expect(chaveDoIp('::ffff:c633:6404')).toBe('198.51.100.4');
  });

  it('o que não é IPv6 válido segue cru (até 128 caracteres)', () => {
    expect(prefixoIpv6('1::2::3')).toBeNull();
    expect(prefixoIpv6('2001:db8:zz::1')).toBeNull();
    expect(prefixoIpv6('1:2:3:4:5:6:7:8:9')).toBeNull();
    expect(prefixoIpv6('::ffff:300.1.1.1')).toBeNull();
    expect(chaveDoIp('nao-e-ip')).toBe('nao-e-ip');
    expect(chaveDoIp('x'.repeat(200))).toHaveLength(128);
  });

  it(`pela rota: ${LIMITES_PUBLICOS.read.ip} pedidos de endereços DIFERENTES do mesmo /64 esgotam o teto do IP`, async () => {
    for (let i = 0; i < LIMITES_PUBLICOS.read.ip; i++) {
      const t = i % 2 === 0 ? TOKEN_NENHUM : TOKEN_REVOGADO;
      expect((await ler(t, `2001:db8:aa:bb::${(i + 1).toString(16)}`)).status).toBe(404);
    }
    expect((await ler(TOKEN_A, '2001:db8:aa:bb:ffff:1:2:3')).status).toBe(429);
    // Outro /64 tem o seu balde.
    expect((await ler(TOKEN_A, '2001:db8:aa:bc::1')).status).toBe(200);
  });
});

describe('legendaSemDropbox', () => {
  it('tira link solto, entre <> e o destino do link markdown; sem link, devolve igual', () => {
    expect(legendaSemDropbox('Olá\nhttps://www.dropbox.com/scl/fi/a/b.mp4?rlkey=1&dl=0\nTchau')).toBe('Olá\nTchau');
    expect(legendaSemDropbox('Veja <https://dropbox.com/s/x/y.jpg> agora')).toBe('Veja agora');
    expect(legendaSemDropbox('[as fotos](https://www.dropbox.com/scl/fo/p/q?rlkey=r) do dia')).toBe('as fotos do dia');
    expect(legendaSemDropbox('www.dropbox.com/scl/fi/a/b.jpg')).toBeNull();
    expect(legendaSemDropbox('Só texto, https://exemplo.com.br fica.')).toBe('Só texto, https://exemplo.com.br fica.');
    expect(legendaSemDropbox(null)).toBeNull();
  });
});

/* ─────────────────────────── a arte anexada (F42, Fase 9) ─────────────────────────── */

describe('GET …/chamadas/:id/itens/:item/imagem — a arte anexada', () => {
  const I_ARTE = '00000000-0000-0000-0000-0000000001a9';
  const I_ARTE_B = '00000000-0000-0000-0000-0000000002b9';
  const I_ARTE_VELHA = '00000000-0000-0000-0000-0000000003c9';
  const R_SUBSTITUIDA = '00000000-0000-0000-0000-0000000000a3';
  const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  let fetchOriginal: typeof fetch;
  let pedidosAoBalde: string[];

  beforeEach(() => {
    const aberta = banco.rodadas.find((r) => r.id === R_ABERTA)!;
    aberta.items.push({
      id: I_ARTE,
      position: 3,
      url: null,
      kind: 'image',
      file_name: 'Capa.png',
      storage_path: `aprovacoes/${R_ABERTA}/3-capa.png`,
      content_type: 'image/png',
    });
    banco.rodadas.find((r) => r.id === R_DE_B)!.items.push({
      id: I_ARTE_B,
      position: 2,
      url: null,
      kind: 'image',
      file_name: 'b.png',
      storage_path: `aprovacoes/${R_DE_B}/2-b.png`,
      content_type: 'image/png',
    });
    banco.rodadas.push({
      id: R_SUBSTITUIDA,
      client: CLIENTE_A,
      state: 'superseded',
      decided_at: null,
      task_title: 'Velha',
      version: 1,
      sent_at: '2026-10-07T09:00:00.000Z',
      caption: '',
      items: [{ id: I_ARTE_VELHA, position: 1, url: null, kind: 'image', file_name: 'v.png', storage_path: `aprovacoes/${R_SUBSTITUIDA}/1-v.png`, content_type: 'image/png' }],
      comments: [],
    });
    pedidosAoBalde = [];
    fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
      if (url.startsWith('https://provider.invalid/storage/v1/object/authenticated/ideworks-anexos/')) {
        pedidosAoBalde.push(`${url} ${new Headers(init?.headers).get('Authorization')}`);
        return new Response(BYTES, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(BYTES.length) } });
      }
      return fetchOriginal(entrada, init);
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  const imagem = (token: string, rodada: string, item: string) =>
    pedir('GET', `${token}/chamadas/${rodada}/itens/${item}/imagem`);

  it('a página traz a arte como "anexo", sem endereço e sem o caminho do balde', async () => {
    const r = await ler(TOKEN_A);
    const texto = await r.text();
    expect(texto).not.toContain('aprovacoes/');
    expect(texto).not.toContain('storage_path');
    const pagina = JSON.parse(texto) as { chamadas: { id: string; itens: Record<string, unknown>[] }[] };
    const arte = pagina.chamadas.find((c) => c.id === R_ABERTA)!.itens.find((i) => i.id === I_ARTE)!;
    expect(Object.keys(arte).sort()).toEqual([...CHAVES_DO_ITEM].sort());
    expect(arte).toMatchObject({ forma: 'anexo', tipo: 'image', nome: 'Capa.png', exibicao: null, abrirNoDropbox: null });
  });

  it('com o token certo: 200, Content-Type de imagem, os bytes, cabeçalhos de privacidade e cache curto', async () => {
    const r = await imagem(TOKEN_A, R_ABERTA, I_ARTE);
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe('image/png');
    expect(r.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect(r.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(r.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(BYTES);
    expect(pedidosAoBalde).toEqual([
      `https://provider.invalid/storage/v1/object/authenticated/ideworks-anexos/aprovacoes/${R_ABERTA}/3-capa.png Bearer service-key`,
    ]);
  });

  it('de outro cliente, substituída, item que não é anexo, token inválido: o MESMO 404, e nada pedido ao balde', async () => {
    const casos = [
      imagem(TOKEN_A, R_DE_B, I_ARTE_B),
      imagem(TOKEN_B, R_ABERTA, I_ARTE),
      imagem(TOKEN_A, R_SUBSTITUIDA, I_ARTE_VELHA),
      imagem(TOKEN_A, R_ABERTA, I_ARQUIVO),
      imagem(TOKEN_NENHUM, R_ABERTA, I_ARTE),
      imagem('curto', R_ABERTA, I_ARTE),
      imagem(TOKEN_A, 'nao-e-id', I_ARTE),
    ];
    for (const r of await Promise.all(casos)) {
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ message: FRASE_NAO_ENCONTRADO });
      cabecalhosPublicos(r);
    }
    expect(pedidosAoBalde).toEqual([]);
  });

  it('só GET', async () => {
    const r = await pedir('POST', `${TOKEN_A}/chamadas/${R_ABERTA}/itens/${I_ARTE}/imagem`, {});
    expect(r.status).toBe(404);
  });

  it('o limite das imagens é à parte (media) e responde 429 com Retry-After', async () => {
    expect(LIMITES_PUBLICOS.media.token).toBeGreaterThan(LIMITES_PUBLICOS.read.token);
    for (let i = 0; i < LIMITES_PUBLICOS.media.token; i++) banco.limite.set(`media:token:${hashes[TOKEN_A].slice(0, 32)}`, [...(banco.limite.get(`media:token:${hashes[TOKEN_A].slice(0, 32)}`) ?? []), Date.now()]);
    const r = await imagem(TOKEN_A, R_ABERTA, I_ARTE);
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('Retry-After'))).toBeGreaterThan(0);
    // A leitura da página não foi gasta pelas imagens.
    expect((await ler(TOKEN_A)).status).toBe(200);
  });
});
