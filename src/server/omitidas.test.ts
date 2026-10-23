/**
 * EMPRESAS OMITIDAS — a parte pura e a forma do SQL. F31, Fase 2.
 *
 * O resultado contra Postgres de verdade (a linha da Alma9 sumindo) está em
 * `omitidas-banco.test.ts`. Aqui ficam o que não precisa de banco — ler a
 * variável, reconhecer o endereço — e as leituras cujo esquema é grande demais
 * para o PGlite do teste (a caixa de avisos, as listas do cliente): delas se
 * confere que o recorte ENTRA com a variável ligada e que a consulta sai
 * idêntica à de antes com ela desligada.
 */

import { describe, expect, it, vi } from 'vitest';

import type { Sql, Tx } from '@/server/db';
import { alvoDoCaminho, estaOmitida, lerNomesOmitidos, recorteAtivo } from '@/server/omitidas';
import type { AuthenticatedActor } from '@/server/session';

vi.mock('@/server/db', async (original) => ({
  ...(await original<typeof import('@/server/db')>()),
  withActor: (sql: unknown, _actor: unknown, run: (tx: unknown) => unknown) => run(sql),
}));

const { countUnreadNotices, readNotices } = await import('@/server/board-avisos');
const { readClientBoardLists } = await import('@/server/client-board-lists');

const ALMA = '00000000-0000-0000-0000-00000000a1a1';

describe('lerNomesOmitidos — a variável', () => {
  it.each([
    [undefined, []],
    ['', []],
    ['  ,  , ', []],
    ['Alma9', ['alma9']],
    [' ALMA9 , alma9,Outra ', ['alma9', 'outra']],
  ])('%j → %j', (texto, nomes) => {
    expect(lerNomesOmitidos(texto)).toEqual(nomes);
  });
});

describe('alvoDoCaminho — o que o endereço aponta', () => {
  const X = '0f6c4d2e-1b3a-4c5d-8e9f-0a1b2c3d4e5f';

  it.each([
    [`/clients/${X}`, 'cliente'],
    [`/clients/${X}/months/2026-09-01/open`, 'cliente'],
    [`/board/lists/${X}/workflow`, 'lista'],
    [`/board/tasks/${X}/assignable`, 'tarefa'],
    [`/board/attachments/${X}`, 'anexo'],
    [`/history/documents/${X}/url`, 'documento'],
    [`/tasks/${X}/completion`, 'demanda'],
    // F31, Fase 3b — as rotas de UMA conta da Meta.
    [`/meta-assets/${X}/report/paid`, 'conta-meta'],
    [`/meta-assets/${X}/report/organic`, 'conta-meta'],
    [`/meta-assets/${X}/media`, 'conta-meta'],
    [`/meta-assets/${X}/campaigns`, 'conta-meta'],
    [`/meta-assets/${X}/campaigns/120210/ads`, 'conta-meta'],
    [`/meta-assets/${X}/client`, 'conta-meta'],
    [`/meta-assets/${X}`, 'conta-meta'],
    // Ligar conta a um cliente é endereço do CLIENTE.
    [`/clients/${X}/meta-assets`, 'cliente'],
  ])('%s → %s', (caminho, tipo) => {
    expect(alvoDoCaminho(caminho)).toEqual({ tipo, id: X });
  });

  it.each([
    // Administração e chat não passam por aqui — ou não têm empresa. As
    // listas da Meta (`/meta/accounts`, `/meta/ranking`) recortam na consulta.
    `/admin/people/${X}/clients`,
    '/meta/accounts',
    '/meta/ranking',
    `/chat/conversations/${X}/messages`,
    '/board/tree',
    '/clients',
    '/board/attachments/urls',
    undefined,
  ])('%s → nada', (caminho) => {
    expect(alvoDoCaminho(caminho)).toBeNull();
  });
});

describe('o ator sem omitidas é o de antes da F31', () => {
  it('sem o campo, nada é omitido', () => {
    expect(recorteAtivo({})).toBe(false);
    expect(estaOmitida({}, ALMA)).toBe(false);
    expect(estaOmitida({ categoriasOmitidas: [ALMA] }, ALMA)).toBe(true);
    expect(estaOmitida({ categoriasOmitidas: [ALMA] }, null)).toBe(false);
  });
});

/* ───────────────────────────── a forma do SQL ───────────────────────────── */

type Consulta = { texto: string; valores: unknown[] };

/** O dublê de `tx`: renderiza fragmento aninhado e responde vazio. */
function banco(resposta: (texto: string) => unknown[] = () => []) {
  const consultas: Consulta[] = [];
  const tx = ((strings: TemplateStringsArray, ...args: unknown[]) => {
    const q: Consulta & { dublê: true } = { texto: strings[0] ?? '', valores: [], dublê: true };
    args.forEach((a, i) => {
      if (a && typeof a === 'object' && (a as { dublê?: boolean }).dublê) {
        q.texto += (a as Consulta).texto;
        q.valores.push(...(a as Consulta).valores);
      } else {
        q.texto += '?';
        q.valores.push(a);
      }
      q.texto += strings[i + 1] ?? '';
    });
    return Object.assign(q, {
      then(ok: (linhas: unknown[]) => void) {
        consultas.push(q);
        ok(resposta(q.texto));
      },
    });
  }) as unknown as Tx;
  return { sql: tx as unknown as Sql, consultas };
}

const base = {
  userId: '00000000-0000-0000-0000-000000000001',
  isSuper: false,
  isSuperadmin: false,
} as AuthenticatedActor;
const ligado = { ...base, categoriasOmitidas: [ALMA] } as AuthenticatedActor;

const semEspaco = (t: string) => t.replace(/\s+/g, ' ').trim();

describe('Notificações — toda fonte de TAREFA leva o recorte; o chat não', () => {
  it('ligada: menção, atribuição, automação, prazo, agente e aprovação recortam; a lista e as contagens igual', async () => {
    const { sql, consultas } = banco((t) => (t.includes('as unread') ? [{ unread: 0 }] : []));
    await readNotices(sql, ligado, false);
    await countUnreadNotices(sql, ligado);

    const porTipo = (marca: string) => consultas.filter((q) => q.texto.includes(marca));
    for (const marca of [
      "'mencao'::text",
      "'atribuicao'::text",
      "'automacao'::text",
      "'prazo'::text",
      "'agente'::text",
      // F42, Fase 7: a resposta do cliente é fonte de TAREFA, e recorta igual.
      "'aprovacao'::text",
    ]) {
      const [q] = porTipo(marca);
      expect(q, marca).toBeDefined();
      expect(q.texto).toContain('omit_s.category_id = any(');
      expect(q.valores).toContainEqual([ALMA]);
    }
    // O agente olha também o cliente da nota e do registro.
    expect(semEspaco(porTipo("'agente'::text")[0].texto)).toContain(
      'and (t.id is not null or cl.category_id is null or cl.category_id <> all(?::uuid[]))',
    );
    // O chat não tem recorte por empresa (D24).
    expect(porTipo("'mencao_chat'::text")[0].texto).not.toContain('omit_');

    // As duas contagens (caixa e barra lateral): seis fontes de tarefa, seis recortes.
    const contagens = porTipo('as unread');
    expect(contagens).toHaveLength(2);
    for (const q of contagens) expect(q.texto.match(/omit_s\.category_id/g)).toHaveLength(6);
  });

  it('desligada: nenhuma consulta muda — nem texto de recorte, nem parâmetro', async () => {
    const { sql, consultas } = banco((t) => (t.includes('as unread') ? [{ unread: 0 }] : []));
    await readNotices(sql, base, false);
    await countUnreadNotices(sql, base);
    for (const q of consultas) {
      expect(q.texto).not.toContain('omit_');
      expect(q.texto).not.toContain('category_id');
      expect(q.valores.flat()).not.toContain(ALMA);
    }
  });
});

describe('Listas do quadro na ficha do cliente', () => {
  const CLIENTE = '00000000-0000-0000-0000-0000000000c1';
  const resposta = (t: string) => (t.includes('from ideworks.clients') ? [{ id: CLIENTE }] : []);

  it('ligada: a lista em espaço de empresa omitida sai', async () => {
    const { sql, consultas } = banco(resposta);
    await readClientBoardLists(sql, ligado, CLIENTE);
    const [q] = consultas.filter((c) => c.texto.includes('client_board_lists'));
    expect(semEspaco(q.texto)).toContain(
      'where space_id not in (select s.id from ideworks.spaces s where s.category_id = any(?::uuid[]))',
    );
    expect(q.valores).toContainEqual([ALMA]);
  });

  it('desligada: a consulta de sempre', async () => {
    const { sql, consultas } = banco(resposta);
    await readClientBoardLists(sql, base, CLIENTE);
    const [q] = consultas.filter((c) => c.texto.includes('client_board_lists'));
    expect(q.texto).not.toContain('space_id not in');
    expect(q.valores).toEqual([CLIENTE]);
  });
});
