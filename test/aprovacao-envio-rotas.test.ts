/**
 * "SOLICITAR APROVAÇÃO" NO CARD — AS ROTAS. F42, Fase 4.
 *
 * O Worker de verdade (`worker.fetch`) com provedor e banco dublês, no desenho
 * de `aprovacao-rotas.test.ts`. O dublê imita `create_approval_round` nas regras
 * que importam para a rota (cliente ligado, três destinos, substitui a aberta,
 * versão seguinte, card para "aguardando"); as regras de verdade estão provadas
 * contra o PGlite em `src/server/aprovacao-do-cliente-banco.test.ts`.
 *
 * O que se prova:
 *   - envio válido (3 imagens + 1 vídeo) grava a v1 NA ORDEM, sem identificador
 *     nem versão do Dropbox, e devolve a ficha com o card em "aguardando";
 *   - link que não é do Dropbox: 400 com a frase, e o banco nem é chamado;
 *   - card sem cliente, cliente desligado e esteira sem destinos: 409 com a
 *     frase escrita direito;
 *   - segundo envio: v2, e a v1 "substituída";
 *   - GET lista as rodadas (mais nova primeiro) e diz o que falta na esteira.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import worker from '../worker/index';
import { FRASES_DO_ENVIO } from '@/server/aprovacao-envio';

const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const EQUIPE = '00000000-0000-0000-0000-0000000000b2';
const CLIENTE = '00000000-0000-0000-0000-00000000c001';
const CARD = '00000000-0000-0000-0000-0000000007a1';
const CARD_SEM_CLIENTE = '00000000-0000-0000-0000-0000000007a2';
const CARD_FORA = '00000000-0000-0000-0000-0000000007ff';
const LISTA = '00000000-0000-0000-0000-0000000001a1';
const ESTEIRA = '00000000-0000-0000-0000-0000000005e1';
const E_FAZER = '00000000-0000-0000-0000-00000000e001';
const E_AGUARDANDO = '00000000-0000-0000-0000-00000000e002';
const E_APROVADO = '00000000-0000-0000-0000-00000000e003';
const E_REFACAO = '00000000-0000-0000-0000-00000000e004';

type Rodada = { id: string; task_id: string; version: number; state: string; sent_at: Date; sent_by: string };
type Item = {
  round_id: string;
  position: number;
  dropbox_url: string | null;
  kind: string;
  file_name: string;
  dropbox_file_id: string | null;
  dropbox_rev: string | null;
  storage_path?: string | null;
  is_attachment?: boolean;
};
type Anexo = { id: string; task_id: string; file_name: string; content_type: string; storage_path: string; expires_at: Date | null };

let quem = ADMIN;
let banco: {
  tarefas: Map<string, { list_id: string; client_id: string | null; status_id: string }>;
  cliente: { approval_enabled: boolean; is_active: boolean };
  alvos: { awaiting: string | null; approved: string | null; rejected: string | null };
  rodadas: Rodada[];
  itens: Item[];
  anexos: Anexo[];
};
const consultas: string[] = [];
/** O que o Storage dublê recebeu, na ordem: `copy de → para` e `delete caminho`. */
const balde: string[] = [];
let copiaFalhaNa = 0;

const iw042 = (hint: string, mensagem: string) => Object.assign(new Error(mensagem), { code: 'IW042', hint });

type ItemPedido = {
  dropbox_url?: string;
  kind?: string;
  file_name?: string;
  dropbox_file_id?: string;
  dropbox_rev?: string;
  attachment_id?: string;
  storage_path?: string;
};

function criarRodada(taskId: string, itens: ItemPedido[], roundId: string | null = null) {
  const t = banco.tarefas.get(taskId);
  if (!t) throw Object.assign(new Error('fora'), { code: '42501' });
  if (t.client_id === null) throw iw042('task_without_client', 'Este card nao tem cliente: a aprovacao externa e por cliente.');
  if (!banco.cliente.approval_enabled) throw iw042('approval_disabled', 'A aprovacao externa nao esta ligada para este cliente.');
  const a = banco.alvos;
  if (!a.awaiting || !a.approved || !a.rejected) throw iw042('approval_not_configured', 'A esteira deste card ainda nao tem as tres etapas');
  let superseded = 0;
  for (const r of banco.rodadas) {
    if (r.task_id === taskId && r.state === 'open') {
      r.state = 'superseded';
      superseded++;
    }
  }
  const version = Math.max(0, ...banco.rodadas.filter((r) => r.task_id === taskId).map((r) => r.version)) + 1;
  const id = roundId ?? `00000000-0000-0000-0000-0000000f000${version}`;
  banco.rodadas.push({ id, task_id: taskId, version, state: 'open', sent_at: new Date('2026-10-07T19:20:00Z'), sent_by: quem });
  itens.forEach((i, n) => {
    if (i.storage_path !== undefined) {
      // Como a função real: o anexo manda no nome; a cópia mora debaixo da rodada.
      const a = banco.anexos.find((x) => x.id === i.attachment_id);
      if (!a || a.task_id !== taskId || !i.storage_path.startsWith(`aprovacoes/${id}/`)) {
        throw iw042('attachment_invalid', 'anexo invalido');
      }
      banco.itens.push({ round_id: id, position: n + 1, dropbox_url: null, kind: 'image', file_name: a.file_name, dropbox_file_id: null, dropbox_rev: null, storage_path: i.storage_path, is_attachment: true });
      return;
    }
    banco.itens.push({
      round_id: id,
      position: n + 1,
      dropbox_url: i.dropbox_url ?? null,
      kind: i.kind ?? 'other',
      file_name: i.file_name ?? '',
      dropbox_file_id: i.dropbox_file_id ?? null,
      dropbox_rev: i.dropbox_rev ?? null,
      is_attachment: false,
    });
  });
  t.status_id = a.awaiting;
  return { round_id: id, version, superseded };
}

function responder(texto: string, v: unknown[]): unknown[] {
  if (texto.includes('set_config')) return [];
  if (texto.includes('from ideworks.profiles')) {
    const admin = quem === ADMIN;
    return [
      {
        id: quem,
        email: admin ? 'admin@example.invalid' : 'equipe@example.invalid',
        full_name: null,
        role: admin ? 'admin' : 'funcionario',
        is_superadmin: admin,
        is_active: true,
        has_all_clients_access: true,
        areas: ['entrega', 'quadro'],
      },
    ];
  }
  if (texto.includes('create_approval_round')) {
    // Como o driver real: texto vira uma STRING json (jsonb_typeof = 'string'),
    // e a função recusa como lista vazia. Só `sql.json(...)` chega como lista.
    const itens = v[1] as { json?: unknown } | string;
    if (typeof itens === 'string' || !Array.isArray(itens.json)) {
      throw iw042('no_items', 'p_items não é uma lista');
    }
    return [{ r: criarRodada(v[0] as string, itens.json as ItemPedido[], (v[2] as string | null) ?? null) }];
  }
  if (texto.includes('from ideworks.task_attachments a')) {
    const ids = v[0] as string[];
    return banco.anexos.filter((a) => ids.includes(a.id));
  }
  if (texto.includes('select t.id from ideworks.tasks t')) {
    return banco.tarefas.has(v[0] as string) ? [{ id: v[0] }] : [];
  }
  if (texto.includes('select t.id, t.list_id, t.client_id')) {
    const t = banco.tarefas.get(v[0] as string);
    return t ? [{ id: v[0], list_id: t.list_id, client_id: t.client_id }] : [];
  }
  if (texto.includes('select c.name, c.approval_enabled, c.is_active')) {
    return v[0] === CLIENTE ? [{ name: 'Cliente Um', ...banco.cliente }] : [];
  }
  if (texto.includes('resolve_status_set')) return [{ set_id: v[0] === LISTA ? ESTEIRA : null }];
  if (texto.includes('approval_targets_for')) {
    const a = banco.alvos;
    return [
      {
        awaiting_status_id: a.awaiting,
        approved_status_id: a.approved,
        rejected_status_id: a.rejected,
        awaiting_name: a.awaiting ? 'aguardando cliente' : null,
      },
    ];
  }
  if (texto.includes('from ideworks.approval_rounds r')) {
    return banco.rodadas
      .filter((r) => r.task_id === v[0])
      .sort((x, y) => y.version - x.version)
      .map((r) => ({ ...r, decided_at: null, closed_at: r.state === 'open' ? null : new Date(), sent_by_name: 'Fulana' }));
  }
  if (texto.includes('from ideworks.approval_round_items i')) {
    const ids = v[0] as string[];
    return banco.itens.filter((i) => ids.includes(i.round_id));
  }
  throw new Error(`Consulta não prevista na prova: ${texto}`);
}

vi.mock('@/server/db', async (original) => ({
  ...(await original<typeof import('@/server/db')>()),
  connect: () => ({
    end: async () => {},
    begin: async (work: (tx: unknown) => Promise<unknown>) =>
      work(
        Object.assign(
          async (partes: TemplateStringsArray, ...valores: unknown[]) => {
            const texto = partes.join('?');
            consultas.push(texto);
            return responder(texto, valores);
          },
          { json: (valor: unknown) => ({ json: valor }) },
        ),
      ),
  }),
}));

// A ficha inteira tem dezenas de consultas próprias, já provadas noutro lugar:
// aqui basta saber que a rota a devolve com a etapa que ficou.
vi.mock('@/server/board-task', async (original) => ({
  ...(await original<typeof import('@/server/board-task')>()),
  readTaskDetail: async (_sql: unknown, _actor: unknown, id: string) => ({ id, statusId: banco.tarefas.get(id)?.status_id }),
}));

const env: Record<string, string> = {
  IDEWORKS_PUBLIC_SUPABASE_URL: 'https://provider.invalid',
  IDEWORKS_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
};

const pedir = (metodo: string, caminho: string, corpo?: unknown, ambiente: Record<string, string> = env) =>
  worker.fetch(
    new Request(`https://app.invalid/api${caminho}`, {
      method: metodo,
      headers: { Cookie: 'ideworks_sessao=test-access', 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    }),
    ambiente as never,
  );

const LINKS = [
  'https://www.dropbox.com/scl/fi/aaa111/arte-1.jpg?rlkey=k1&dl=0',
  'https://www.dropbox.com/scl/fi/bbb222/arte-2.png?rlkey=k2&dl=0',
  'www.dropbox.com/scl/fi/ccc333/arte-3.webp?rlkey=k3&dl=0',
  'https://www.dropbox.com/scl/fi/ddd444/reels%20final.mp4?rlkey=k4&dl=0',
];

let fetchOriginal: typeof fetch;

beforeEach(() => {
  quem = EQUIPE;
  consultas.length = 0;
  banco = {
    tarefas: new Map([
      [CARD, { list_id: LISTA, client_id: CLIENTE, status_id: E_FAZER }],
      [CARD_SEM_CLIENTE, { list_id: LISTA, client_id: null, status_id: E_FAZER }],
    ]),
    cliente: { approval_enabled: true, is_active: true },
    alvos: { awaiting: E_AGUARDANDO, approved: E_APROVADO, rejected: E_REFACAO },
    rodadas: [],
    itens: [],
    anexos: [],
  };
  balde.length = 0;
  copiaFalhaNa = 0;
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (url === 'https://provider.invalid/auth/v1/user') {
      return new Response(JSON.stringify({ id: quem, email: 'x@example.invalid' }), { status: 200 });
    }
    if (url === 'https://provider.invalid/storage/v1/object/copy') {
      const b = JSON.parse(String(init?.body)) as { bucketId: string; sourceKey: string; destinationKey: string };
      balde.push(`copy ${b.bucketId}:${b.sourceKey} → ${b.destinationKey}`);
      if (copiaFalhaNa > 0 && balde.filter((x) => x.startsWith('copy')).length === copiaFalhaNa) {
        return new Response('{"error":"falhou"}', { status: 500 });
      }
      return new Response(JSON.stringify({ Key: `${b.bucketId}/${b.destinationKey}` }), { status: 200 });
    }
    if (url === 'https://provider.invalid/storage/v1/object/ideworks-anexos' && init?.method === 'DELETE') {
      for (const c of (JSON.parse(String(init.body)) as { prefixes: string[] }).prefixes) balde.push(`delete ${c}`);
      return new Response('[]', { status: 200 });
    }
    return fetchOriginal(entrada, init);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe('POST /board/tasks/:id/approval-rounds', () => {
  it('3 imagens + 1 vídeo: v1 na ordem escolhida, sem id/rev do Dropbox, e o card vai para "aguardando"', async () => {
    const r = await pedir('POST', `/board/tasks/${CARD}/approval-rounds`, { links: LINKS });
    expect(r.status).toBe(201);
    const corpo = (await r.json()) as {
      version: number;
      superseded: number;
      task: { statusId: string };
      approval: { rounds: { version: number; state: string; items: { fileName: string; kind: string }[] }[] };
    };
    expect(corpo.version).toBe(1);
    expect(corpo.superseded).toBe(0);
    expect(corpo.task.statusId).toBe(E_AGUARDANDO);
    expect(banco.itens.map((i) => [i.position, i.file_name, i.kind])).toEqual([
      [1, 'arte-1.jpg', 'image'],
      [2, 'arte-2.png', 'image'],
      [3, 'arte-3.webp', 'image'],
      [4, 'reels final.mp4', 'video'],
    ]);
    // `www.` sem esquema chega gravado com `https://`; nada de identificador inventado.
    expect(banco.itens[2].dropbox_url).toBe('https://www.dropbox.com/scl/fi/ccc333/arte-3.webp?rlkey=k3&dl=0');
    expect(banco.itens.every((i) => i.dropbox_file_id === null && i.dropbox_rev === null)).toBe(true);
    expect(corpo.approval.rounds).toHaveLength(1);
    expect(corpo.approval.rounds[0]).toMatchObject({ version: 1, state: 'open' });
    expect(corpo.approval.rounds[0].items.map((i) => i.kind)).toEqual(['image', 'image', 'image', 'video']);
  });

  it('pasta do Dropbox entra como "outro", com o nome genérico', async () => {
    const r = await pedir('POST', `/board/tasks/${CARD}/approval-rounds`, {
      links: ['https://www.dropbox.com/scl/fo/pasta123/AAkey?rlkey=z&dl=0'],
    });
    expect(r.status).toBe(201);
    expect(banco.itens[0]).toMatchObject({ kind: 'other', file_name: 'Pasta do Dropbox' });
  });

  it('link que não é do Dropbox: 400 com a frase, e nada vai ao banco', async () => {
    consultas.length = 0;
    const r = await pedir('POST', `/board/tasks/${CARD}/approval-rounds`, {
      links: [LINKS[0], 'https://drive.google.com/file/d/xyz/view'],
    });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { message: string }).message).toMatch(/^O 2º link não é um link de compartilhamento do Dropbox/);
    expect(consultas.some((c) => c.includes('create_approval_round'))).toBe(false);
    expect(banco.rodadas).toHaveLength(0);
    expect(banco.tarefas.get(CARD)!.status_id).toBe(E_FAZER);
  });

  it.each([
    [{ links: [] }, 'Escolha ao menos um material'],
    [{ links: 'https://www.dropbox.com/scl/fi/a/b.jpg' }, 'Mande a lista'],
    [{ links: [LINKS[0], LINKS[0]] }, 'aparece no 1º e no 2º'],
    [{ links: Array.from({ length: 21 }, (_, i) => `https://www.dropbox.com/scl/fi/x${i}/f${i}.jpg`) }, 'Até 20'],
  ])('corpo inválido %#: 400', async (corpo, frase) => {
    const r = await pedir('POST', `/board/tasks/${CARD}/approval-rounds`, corpo);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { message: string }).message).toContain(frase);
    expect(banco.rodadas).toHaveLength(0);
  });

  it('card sem cliente: 409 com a frase acentuada', async () => {
    const r = await pedir('POST', `/board/tasks/${CARD_SEM_CLIENTE}/approval-rounds`, { links: [LINKS[0]] });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { message: string }).message).toBe(FRASES_DO_ENVIO.task_without_client);
  });

  it('cliente com a chave desligada: 409, nada gravado', async () => {
    banco.cliente.approval_enabled = false;
    const r = await pedir('POST', `/board/tasks/${CARD}/approval-rounds`, { links: [LINKS[0]] });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { message: string }).message).toBe(FRASES_DO_ENVIO.approval_disabled);
    expect(banco.rodadas).toHaveLength(0);
  });

  it('esteira sem os três destinos: 409, nada gravado, card não se move', async () => {
    banco.alvos.rejected = null;
    const r = await pedir('POST', `/board/tasks/${CARD}/approval-rounds`, { links: [LINKS[0]] });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { message: string }).message).toBe(FRASES_DO_ENVIO.approval_not_configured);
    expect(banco.rodadas).toHaveLength(0);
    expect(banco.tarefas.get(CARD)!.status_id).toBe(E_FAZER);
  });

  it('card fora do alcance: 404', async () => {
    const r = await pedir('POST', `/board/tasks/${CARD_FORA}/approval-rounds`, { links: [LINKS[0]] });
    expect(r.status).toBe(404);
  });

  it('segundo envio: v2 aberta e v1 "substituída"', async () => {
    await pedir('POST', `/board/tasks/${CARD}/approval-rounds`, { links: LINKS });
    const r = await pedir('POST', `/board/tasks/${CARD}/approval-rounds`, { links: [LINKS[3], LINKS[0]] });
    expect(r.status).toBe(201);
    const corpo = (await r.json()) as { version: number; superseded: number; approval: { rounds: { version: number; state: string }[] } };
    expect(corpo).toMatchObject({ version: 2, superseded: 1 });
    expect(corpo.approval.rounds.map((x) => [x.version, x.state])).toEqual([
      [2, 'open'],
      [1, 'superseded'],
    ]);
  });
});

describe('GET /board/tasks/:id/approval-rounds', () => {
  it('pronto: cliente ligado, esteira completa, sem rodadas; não-admin não copia o link', async () => {
    const r = await pedir('GET', `/board/tasks/${CARD}/approval-rounds`);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { approval: unknown }).approval).toEqual({
      taskId: CARD,
      listId: LISTA,
      clientId: CLIENTE,
      clientName: 'Cliente Um',
      enabled: true,
      configured: true,
      missing: [],
      awaitingStatusName: 'aguardando cliente',
      canConfigure: false,
      canCopyLink: false,
      rounds: [],
    });
  });

  it('esteira incompleta: diz o que falta; admin pode configurar e copiar', async () => {
    quem = ADMIN;
    banco.alvos = { awaiting: E_AGUARDANDO, approved: null, rejected: null };
    const { approval } = (await (await pedir('GET', `/board/tasks/${CARD}/approval-rounds`)).json()) as {
      approval: { configured: boolean; missing: string[]; canConfigure: boolean; canCopyLink: boolean };
    };
    expect(approval).toMatchObject({ configured: false, missing: ['aprovado', 'reprovado'], canConfigure: true, canCopyLink: true });
  });

  it('cliente desligado: enabled falso (a tela esconde o botão)', async () => {
    banco.cliente.approval_enabled = false;
    const { approval } = (await (await pedir('GET', `/board/tasks/${CARD}/approval-rounds`)).json()) as {
      approval: { enabled: boolean };
    };
    expect(approval.enabled).toBe(false);
  });

  it('card fora do alcance: 404', async () => {
    expect((await pedir('GET', `/board/tasks/${CARD_FORA}/approval-rounds`)).status).toBe(404);
  });
});

/* ─────────────────────────── as artes anexadas (F42, Fase 9) ─────────────────────────── */

describe('POST /board/tasks/:id/approval-rounds com anexos', () => {
  const comChave = { ...env, IDEWORKS_SERVER_SUPABASE_SERVICE_KEY: 'service-key' };
  const A1 = '00000000-0000-0000-0000-0000000a0001';
  const A2 = '00000000-0000-0000-0000-0000000a0002';
  const A3 = '00000000-0000-0000-0000-0000000a0003';
  const DE_OUTRO = '00000000-0000-0000-0000-0000000a0004';
  const TEMPORARIO = '00000000-0000-0000-0000-0000000a0005';
  const PDF = '00000000-0000-0000-0000-0000000a0006';
  const OUTRO_CARD = '00000000-0000-0000-0000-0000000007a3';

  beforeEach(() => {
    banco.tarefas.set(OUTRO_CARD, { list_id: LISTA, client_id: CLIENTE, status_id: E_FAZER });
    const a = (id: string, task_id: string, file_name: string, content_type = 'image/png', expires_at: Date | null = null) => ({
      id,
      task_id,
      file_name,
      content_type,
      storage_path: `${task_id}/${id}.bin`,
      expires_at,
    });
    banco.anexos = [
      a(A1, CARD, 'Capa Promoção.png'),
      a(A2, CARD, 'arte 2.jpg', 'image/jpeg'),
      a(A3, CARD, 'fim.webp', 'image/webp'),
      a(DE_OUTRO, OUTRO_CARD, 'alheia.png'),
      a(TEMPORARIO, CARD, 'print.png', 'image/png', new Date(Date.now() + 3600_000)),
      a(PDF, CARD, 'roteiro.pdf', 'application/pdf'),
    ];
  });

  const MATERIAIS = [{ anexo: A1 }, { anexo: A2 }, { link: LINKS[3] }, { anexo: A3 }];

  it('3 anexos + 1 link: copia cada arte para a pasta da rodada ANTES de gravar, e grava os 4 na ordem', async () => {
    const r = await pedir('POST', `/board/tasks/${CARD}/approval-rounds`, { materiais: MATERIAIS }, comChave);
    expect(r.status).toBe(201);
    const corpo = (await r.json()) as {
      roundId: string;
      version: number;
      approval: { rounds: { items: { fileName: string; source: string; url: string | null }[] }[] };
    };
    const rid = corpo.roundId;
    expect(rid).toMatch(/^[0-9a-f-]{36}$/);
    expect(balde).toEqual([
      `copy ideworks-anexos:${CARD}/${A1}.bin → aprovacoes/${rid}/1-capa-promocao.png`,
      `copy ideworks-anexos:${CARD}/${A2}.bin → aprovacoes/${rid}/2-arte-2.jpg`,
      `copy ideworks-anexos:${CARD}/${A3}.bin → aprovacoes/${rid}/4-fim.webp`,
    ]);
    expect(banco.itens.map((i) => [i.position, i.file_name, i.is_attachment])).toEqual([
      [1, 'Capa Promoção.png', true],
      [2, 'arte 2.jpg', true],
      [3, 'reels final.mp4', false],
      [4, 'fim.webp', true],
    ]);
    expect(banco.itens[0].storage_path).toBe(`aprovacoes/${rid}/1-capa-promocao.png`);
    // A equipe vê o nome e a origem; o caminho do balde nunca sai.
    expect(corpo.approval.rounds[0].items.map((i) => [i.fileName, i.source, i.url])).toEqual([
      ['Capa Promoção.png', 'anexo', null],
      ['arte 2.jpg', 'anexo', null],
      ['reels final.mp4', 'dropbox', 'https://www.dropbox.com/scl/fi/ddd444/reels%20final.mp4?rlkey=k4&dl=0'],
      ['fim.webp', 'anexo', null],
    ]);
    expect(JSON.stringify(corpo)).not.toContain('aprovacoes/');
    expect(banco.tarefas.get(CARD)!.status_id).toBe(E_AGUARDANDO);
  });

  it.each([
    [DE_OUTRO, /^O 1º material \("alheia.png"\) é anexo de outro card/],
    [TEMPORARIO, /^O 1º material \("print.png"\) é uma imagem temporária/],
    [PDF, /^O 1º material \("roteiro.pdf"\) não é imagem/],
    ['00000000-0000-0000-0000-0000000a0999', /^O 1º material não é um anexo deste card/],
  ])('anexo recusado (%s): 400 com a frase, nenhuma cópia e nada gravado', async (anexo, frase) => {
    const r = await pedir('POST', `/board/tasks/${CARD}/approval-rounds`, { materiais: [{ anexo }, { link: LINKS[0] }] }, comChave);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { message: string }).message).toMatch(frase);
    expect(balde).toEqual([]);
    expect(consultas.some((c) => c.includes('create_approval_round'))).toBe(false);
    expect(banco.rodadas).toHaveLength(0);
    expect(banco.tarefas.get(CARD)!.status_id).toBe(E_FAZER);
  });

  it('a 2ª cópia falha: a 1ª é apagada, 502, e nada é gravado', async () => {
    copiaFalhaNa = 2;
    const r = await pedir('POST', `/board/tasks/${CARD}/approval-rounds`, { materiais: MATERIAIS }, comChave);
    expect(r.status).toBe(502);
    expect(balde).toHaveLength(3);
    const primeira = balde[0].split(' → ')[1];
    expect(balde[2]).toBe(`delete ${primeira}`);
    expect(consultas.some((c) => c.includes('create_approval_round'))).toBe(false);
    expect(banco.rodadas).toHaveLength(0);
  });

  it('o banco recusa depois das cópias: as cópias são apagadas e a recusa sobe (409)', async () => {
    banco.cliente.approval_enabled = false;
    const r = await pedir('POST', `/board/tasks/${CARD}/approval-rounds`, { materiais: MATERIAIS }, comChave);
    expect(r.status).toBe(409);
    const copiadas = balde.filter((b) => b.startsWith('copy')).map((b) => b.split(' → ')[1]);
    expect(copiadas).toHaveLength(3);
    expect(balde.filter((b) => b.startsWith('delete')).map((b) => b.slice(7))).toEqual(copiadas);
    expect(banco.rodadas).toHaveLength(0);
  });

  it('sem a chave do balde: anexo é 503 nomeando a variável; só link continua funcionando', async () => {
    const r = await pedir('POST', `/board/tasks/${CARD}/approval-rounds`, { materiais: [{ anexo: A1 }] });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { message: string }).message).toContain('IDEWORKS_SERVER_SUPABASE_SERVICE_KEY');
    const soLink = await pedir('POST', `/board/tasks/${CARD}/approval-rounds`, { materiais: [{ link: LINKS[0] }] });
    expect(soLink.status).toBe(201);
    expect(balde).toEqual([]);
  });

  it.each([
    [{ materiais: [{ anexo: A1, link: LINKS[0] }] }, 'Cada material é um link do Dropbox ou um anexo'],
    [{ materiais: [{}] }, 'Cada material é um link do Dropbox ou um anexo'],
    [{ materiais: [{ anexo: A1 }, { anexo: A1 }] }, 'O mesmo anexo aparece no 1º e no 2º'],
    [{ materiais: [{ anexo: 'nao-e-id' }] }, 'não é um anexo deste card'],
  ])('materiais tortos %#: 400, nada copiado', async (corpo, frase) => {
    const r = await pedir('POST', `/board/tasks/${CARD}/approval-rounds`, corpo, comChave);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { message: string }).message).toContain(frase);
    expect(balde).toEqual([]);
  });
});
