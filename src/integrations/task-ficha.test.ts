/**
 * A ficha inteira do `get_task` — conferência de 08/10/2026, G6 (no dublê em memória).
 *
 * Os campos novos são ADITIVOS e opcionais; o que já existia não muda. Aqui:
 * a projeção por capacidade (pessoa, quadro, cliente), o recorte do histórico
 * (lista e cliente fora da conexão não são nomeados), os tetos com o total, o
 * orçamento de 64 KiB (a ficha encolhe, nunca derruba um get_task que já
 * funcionava), o cursor (a ficha só na primeira página) e as três superfícies
 * (função, HTTP, MCP) iguais. O SQL está em `task-ficha-banco.test.ts`.
 */

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import type { EventoDaTarefa } from '@/board/historico';
import {
  GET_TASK_CHECKLISTS_MAX,
  GET_TASK_CHECKLIST_ITEMS_MAX,
  GET_TASK_HISTORY_MAX,
  GET_TASK_LINKS_MAX,
  GET_TASK_PATH,
  getTaskOpenApiExample,
  getTaskResponseSchema,
} from '@/integrations/contract';
import { MemoryCatalog } from '@/integrations/context';
import type { IntegrationCapability, IntegrationGrant, PersonAccess } from '@/integrations/grants';
import { dispatchIntegrationHttp } from '@/integrations/http';
import { MemoryMarketingCatalog } from '@/integrations/marketing';
import { handleMcpRequest } from '@/integrations/mcp';
import { measureJsonBytes, RESPONSE_BUDGET_BYTES } from '@/integrations/page';
import { MemoryWorkCatalog, getTaskWork, type MemoryTask } from '@/integrations/reads';
import { EMPTY_DELIVERY_CATALOG } from '@/integrations/reports';
import { eventoVisivel } from '@/integrations/task-ficha';

const COMPANY_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMPANY_ALMA = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CLIENT_A = 'cliente-jatoba';
const CLIENT_B = 'cliente-sabor-doce';
const CLIENT_ALMA = 'cliente-alma9';
const OWNER_ID = '11111111-1111-1111-1111-111111111111';
const ORIGIN = 'https://ideworks.test';
const AGORA = new Date('2026-10-08T12:00:00.000Z');

const TODAS: IntegrationCapability[] = ['tasks:read', 'boards:read', 'clients:read', 'people:read', 'comments:read'];
const SUPER: PersonAccess = {
  userId: OWNER_ID,
  isActive: true,
  isSuperadmin: true,
  isSuper: true,
  companyIds: [COMPANY_A, COMPANY_ALMA],
  clientIds: [CLIENT_A, CLIENT_B, CLIENT_ALMA],
  hasAllClientsAccess: true,
};
const SEM_ALMA: PersonAccess = { ...SUPER, omittedCompanyIds: [COMPANY_ALMA] };

const grant = (over: Partial<IntegrationGrant> = {}): IntegrationGrant => ({
  id: 'grant-ficha',
  ownerId: OWNER_ID,
  oauthClientId: 'claude',
  name: 'Claude',
  capabilities: TODAS,
  allowedCompanyIds: null,
  allowedClientIds: null,
  expiresAt: null,
  revokedAt: null,
  policyVersion: 1,
  ...over,
});
const sem = (...tiradas: IntegrationCapability[]) => grant({ capabilities: TODAS.filter((c) => !tiradas.includes(c)) });

const evento = (id: string, extra: Partial<EventoDaTarefa>, hora = '10'): EventoDaTarefa => ({
  id,
  automationName: null,
  actorName: 'Helena',
  fromListName: null,
  toListName: null,
  fromStatusName: null,
  toStatusName: null,
  fromClientName: null,
  toClientName: null,
  removed: [],
  added: [],
  occurredAt: `2026-09-19T${hora}:00:00.000Z`,
  viaName: null,
  ...extra,
});

const board = (id: string, name: string, companyId: string, clientId: string | null, canSee = true) => ({
  id,
  name,
  companyId,
  companyName: companyId === COMPANY_A ? 'Agência Ide' : 'Alma Nove',
  spaceId: `space-${id}`,
  spaceName: `Espaço ${name}`,
  folderId: `pasta-${id}`,
  folderName: `Pasta ${name}`,
  clientId,
  clientName: clientId,
  canSeeSpace: canSee,
  statuses: [{ id: 'aberto', name: 'Aberto', sortOrder: 1, type: 'open' as const }],
});

function tarefa(over: Partial<MemoryTask> & { id: string }): MemoryTask {
  return {
    title: 'Peça da campanha',
    description: 'Briefing.',
    companyId: COMPANY_A,
    companyName: 'Agência Ide',
    boardId: 'lista-a',
    clientId: CLIENT_A,
    clientName: 'Jatobá',
    statusId: 'aberto',
    dueOn: null,
    people: [],
    ...over,
  };
}

const FICHA: MemoryTask = tarefa({
  id: 'tarefa-ficha',
  parentId: 'tarefa-mae',
  tags: [{ id: 'etiqueta-reels', name: 'Reels', bgColor: '#7c3aed', fgColor: '#ffffff' }],
  watchers: [{ id: 'pessoa-ana', name: 'Ana' }],
  checklists: [
    {
      id: 'check-1',
      name: 'Antes de enviar',
      items: [
        { id: 'i1', name: 'Revisar a legenda', parentItemId: null, resolvedAt: '2026-09-20T15:00:00.000Z', assignee: { id: 'pessoa-helena', name: 'Helena' } },
        { id: 'i2', name: 'Conferir a música', parentItemId: null, resolvedAt: null, assignee: null },
      ],
    },
  ],
  links: [{ id: 'l1', label: 'Pasta no Dropbox', url: 'https://www.dropbox.com/scl/fo/exemplo' }],
  history: [
    evento('e1', { fromStatusName: 'A fazer', toStatusName: 'Aprovação' }, '10'),
    // Veio de uma lista da Alma9 (omitida) e de um cliente que a concessão não cobre.
    { ...evento('e2', { fromListName: 'Lista Secreta da Alma', toListName: 'Redes sociais' }, '11'), fromListId: 'lista-alma', toListId: 'lista-a' },
    { ...evento('e3', { fromClientName: 'Sabor Doce', toClientName: 'Jatobá' }, '12'), fromClientId: CLIENT_B, toClientId: CLIENT_A },
    evento('e4', { removed: ['Murilo'], added: ['Ana'] }, '13'),
    evento('e5', { actorName: null, automationName: 'Regra: aprovou, avisa', fromStatusName: 'Aprovação', toStatusName: 'Enviado', viaName: 'Claude da Carla' }, '14'),
  ],
  createdBy: { id: 'pessoa-helena', name: 'Helena' },
  completedBy: { id: 'pessoa-ana', name: 'Ana' },
  completedAt: '2026-09-25T12:00:00.000Z',
  createdVia: 'Claude da Carla',
  createdAt: '2026-09-18T13:00:00.000Z',
});

const MASSA: MemoryTask[] = [
  FICHA,
  tarefa({ id: 'tarefa-mae', title: 'Campanha de outubro' }),
  tarefa({ id: 'tarefa-filha', title: 'Filha', parentId: 'tarefa-mae-fora' }),
  tarefa({ id: 'tarefa-mae-fora', title: 'Mãe de outro cliente', clientId: CLIENT_B, clientName: 'Sabor Doce' }),
  tarefa({ id: 'tarefa-sem-ficha', title: 'Dublê antigo' }),
];

const BOARDS = [
  board('lista-a', 'Redes sociais', COMPANY_A, CLIENT_A),
  board('lista-alma', 'Lista Secreta da Alma', COMPANY_ALMA, CLIENT_ALMA),
];

const WORK = new MemoryWorkCatalog({
  boards: BOARDS,
  tasks: MASSA,
  clients: [
    { id: CLIENT_A, name: 'Jatobá', companyId: COMPANY_A, companyName: 'Agência Ide', listIds: ['lista-a'] },
    { id: CLIENT_B, name: 'Sabor Doce', companyId: COMPANY_A, companyName: 'Agência Ide', listIds: [] },
    { id: CLIENT_ALMA, name: 'Cliente Alma', companyId: COMPANY_ALMA, companyName: 'Alma Nove', listIds: ['lista-alma'] },
  ],
});

function ctxDe(g: IntegrationGrant, person: PersonAccess = SUPER, work: MemoryWorkCatalog = WORK) {
  return { grant: g, person, origin: 'http' as const, companies: [], displayName: 'Wesley', work, now: AGORA };
}

async function ler(g: IntegrationGrant, id = 'tarefa-ficha', person: PersonAccess = SUPER, work: MemoryWorkCatalog = WORK, cursor?: string) {
  const r = await getTaskWork(ctxDe(g, person, work), { id, cursor });
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return getTaskResponseSchema.parse(r.body);
}

describe('get_task — a ficha inteira', () => {
  it('com todas as leituras: etiquetas, seguidores, mãe, checklists, links, histórico, criador, pasta e espaço', async () => {
    const { task } = await ler(grant());
    expect(task.tags).toEqual([{ id: 'etiqueta-reels', name: 'Reels', bgColor: '#7c3aed', fgColor: '#ffffff' }]);
    expect(task.watchers).toEqual([{ id: 'pessoa-ana', name: 'Ana' }]);
    expect(task.parentId).toBe('tarefa-mae');
    expect(task.parentTitle).toBe('Campanha de outubro');
    expect(task.checklists).toEqual([
      {
        id: 'check-1',
        name: 'Antes de enviar',
        items: [
          { id: 'i1', name: 'Revisar a legenda', parentItemId: null, resolved: true, resolvedAt: '2026-09-20T15:00:00.000Z', assignee: { id: 'pessoa-helena', name: 'Helena' } },
          { id: 'i2', name: 'Conferir a música', parentItemId: null, resolved: false, resolvedAt: null, assignee: null },
        ],
      },
    ]);
    expect(task.checklistItemTotal).toBe(2);
    expect(task.links).toEqual([{ id: 'l1', label: 'Pasta no Dropbox', url: 'https://www.dropbox.com/scl/fo/exemplo' }]);
    expect(task.linkTotal).toBe(1);
    expect(task.createdBy).toEqual({ id: 'pessoa-helena', name: 'Helena' });
    expect(task.completedBy).toEqual({ id: 'pessoa-ana', name: 'Ana' });
    expect(task.createdVia).toBe('Claude da Carla');
    expect(task.createdAt).toBe('2026-09-18T13:00:00.000Z');
    expect(task.folder).toEqual({ id: 'pasta-lista-a', name: 'Pasta Redes sociais' });
    expect(task.space).toEqual({ id: 'space-lista-a', name: 'Espaço Redes sociais' });
    expect(task.history?.map((e) => [e.by, e.automation, e.via, e.changes])).toEqual([
      ['Helena', false, null, ['alterou o status de A fazer para Aprovação']],
      ['Helena', false, null, ['alterou a lista de Lista Secreta da Alma para Redes sociais']],
      ['Helena', false, null, ['trocou o cliente de Sabor Doce para Jatobá']],
      ['Helena', false, null, ['removeu o responsável: Murilo', 'adicionou o responsável: Ana']],
      ['Regra: aprovou, avisa', true, 'Claude da Carla', ['alterou o status de Aprovação para Enviado']],
    ]);
    expect(task.historyTotal).toBe(5);
    // Os campos que já existiam seguem iguais.
    expect(task).toMatchObject({
      id: 'tarefa-ficha',
      title: 'Peça da campanha',
      completedAt: '2026-09-25T12:00:00.000Z',
      client: { id: CLIENT_A, name: 'Jatobá' },
      people: [],
    });
  });

  it('o catálogo que não traz a ficha (dublê antigo): campos ausentes, nunca vazios inventados — e o get_task segue igual', async () => {
    const { task } = await ler(grant(), 'tarefa-sem-ficha');
    expect(task.title).toBe('Dublê antigo');
    for (const campo of ['tags', 'watchers', 'checklists', 'links', 'history', 'createdBy', 'completedBy', 'createdVia'] as const) {
      expect(task[campo]).toBeUndefined();
    }
    // A mãe e a pasta/espaço vêm da lista e da própria tarefa, mesmo no dublê antigo.
    expect(task.parentId).toBeNull();
    expect(task.folder?.id).toBe('pasta-lista-a');
  });

  it('sem people:read: seguidores, criador, concluinte e responsável de item nulos; frase de gente some; regra e IA ficam', async () => {
    const { task } = await ler(sem('people:read'));
    expect(task.watchers).toBeNull();
    expect(task.createdBy).toBeNull();
    expect(task.completedBy).toBeNull();
    expect(task.checklists?.[0]?.items.map((i) => i.assignee)).toEqual([null, null]);
    expect(task.history?.map((e) => e.id)).toHaveLength(4);
    expect(task.history?.flatMap((e) => e.changes).join('|')).not.toMatch(/responsável/);
    expect(task.history?.every((e) => e.by === null || e.automation)).toBe(true);
    expect(task.historyTotal).toBe(4);
    expect(JSON.stringify(task)).not.toMatch(/Helena|Murilo|"Ana"/);
    expect(task.history?.at(-1)).toMatchObject({ by: 'Regra: aprovou, avisa', automation: true, via: 'Claude da Carla' });
    expect(task.createdVia).toBe('Claude da Carla');
  });

  it('sem boards:read: pasta e espaço só com id; lista e etapa somem do histórico', async () => {
    const { task } = await ler(sem('boards:read'));
    expect(task.folder).toEqual({ id: 'pasta-lista-a', name: null });
    expect(task.space).toEqual({ id: 'space-lista-a', name: null });
    expect(task.history?.flatMap((e) => e.changes).join('|')).not.toMatch(/lista|status/);
  });

  it('sem clients:read: o nome do cliente some do histórico', async () => {
    const { task } = await ler(sem('clients:read'));
    expect(task.client).toBeNull();
    expect(task.history?.flatMap((e) => e.changes).join('|')).not.toMatch(/cliente/);
  });

  it('empresa omitida: a lista da Alma9 nunca é nomeada no histórico', async () => {
    const { task } = await ler(grant(), 'tarefa-ficha', SEM_ALMA);
    expect(JSON.stringify(task)).not.toContain('Alma');
    expect(JSON.stringify(task)).not.toContain('Secreta');
    expect(task.history?.[1]?.changes).toEqual(['moveu para a lista Redes sociais']);
  });

  it('cliente que a concessão não cobre: o nome dele não aparece no histórico', async () => {
    const { task } = await ler(grant({ allowedClientIds: [CLIENT_A] }));
    expect(JSON.stringify(task)).not.toContain('Sabor Doce');
    expect(task.history?.[2]?.changes).toEqual(['definiu o cliente Jatobá']);
  });

  it('mãe fora do recorte de cliente: parentId e parentTitle nulos', async () => {
    const dentro = await ler(grant(), 'tarefa-filha');
    expect(dentro.task.parentTitle).toBe('Mãe de outro cliente');
    const fora = await ler(grant({ allowedClientIds: [CLIENT_A] }), 'tarefa-filha');
    expect(fora.task.parentId).toBeNull();
    expect(fora.task.parentTitle).toBeNull();
    expect(JSON.stringify(fora)).not.toContain('Mãe de outro cliente');
  });

  it('outro cliente e outra empresa: a tarefa em si segue recusada (nada da ficha vaza por aí)', async () => {
    const recusa = await getTaskWork(ctxDe(grant({ allowedClientIds: [CLIENT_B] })), { id: 'tarefa-ficha' });
    expect(recusa.ok).toBe(false);
    const omitida = await getTaskWork(ctxDe(grant(), SEM_ALMA), { id: 'tarefa-alma' });
    expect(omitida.ok).toBe(false);
  });
});

describe('eventoVisivel — a frase só existe para quem pode ler o que ela nomeia', () => {
  const completo = evento(
    'ev',
    {
      fromStatusName: 'A fazer',
      toStatusName: 'Aprovação',
      fromListName: 'A',
      toListName: 'B',
      fromClientName: 'X',
      toClientName: 'Y',
      removed: ['Murilo'],
      added: ['Ana'],
    },
    '10',
  );
  const caps = (...c: IntegrationCapability[]) => new Set(c);

  it('tudo liberado: todas as frases', () => {
    expect(eventoVisivel(completo, caps(...TODAS))?.changes).toEqual([
      'alterou o status de A fazer para Aprovação',
      'alterou a lista de A para B',
      'trocou o cliente de X para Y',
      'removeu o responsável: Murilo',
      'adicionou o responsável: Ana',
    ]);
  });

  it('só tasks:read: nenhuma frase, e o evento some (null)', () => {
    expect(eventoVisivel(completo, caps('tasks:read'))).toBeNull();
  });

  it('cada capacidade libera só a sua frase', () => {
    expect(eventoVisivel(completo, caps('boards:read'))?.changes).toEqual([
      'alterou o status de A fazer para Aprovação',
      'alterou a lista de A para B',
    ]);
    expect(eventoVisivel(completo, caps('clients:read'))?.changes).toEqual(['trocou o cliente de X para Y']);
    expect(eventoVisivel(completo, caps('people:read'))?.changes).toEqual([
      'removeu o responsável: Murilo',
      'adicionou o responsável: Ana',
    ]);
  });
});

describe('get_task — tetos, orçamento e cursor', () => {
  const muitas = tarefa({
    id: 'tarefa-cheia',
    checklists: Array.from({ length: 20 }, (_, c) => ({
      id: `k${c}`,
      name: `Lista ${c}`,
      items: Array.from({ length: 8 }, (_, i) => ({
        id: `k${c}-i${i}`,
        name: `Item ${c}-${i}`,
        parentItemId: null,
        resolvedAt: null,
        assignee: null,
      })),
    })),
    links: Array.from({ length: 45 }, (_, n) => ({ id: `l${n}`, label: `Link ${n}`, url: `https://www.dropbox.com/scl/fo/${n}` })),
    history: Array.from({ length: 50 }, (_, n) =>
      evento(`h${n}`, { fromStatusName: 'A fazer', toStatusName: `Etapa ${n}` }, String(10 + (n % 10))),
    ),
  });
  const work = new MemoryWorkCatalog({ boards: BOARDS, tasks: [muitas] });

  it('15 checklists, 60 itens, 30 links e os 30 fatos mais recentes, cada um com o total', async () => {
    const { task } = await ler(grant(), 'tarefa-cheia', SUPER, work);
    expect(task.checklists).toHaveLength(GET_TASK_CHECKLISTS_MAX);
    expect(task.checklists?.reduce((n, l) => n + l.items.length, 0)).toBe(GET_TASK_CHECKLIST_ITEMS_MAX);
    expect(task.checklistItemTotal).toBe(160);
    expect(task.links).toHaveLength(GET_TASK_LINKS_MAX);
    expect(task.linkTotal).toBe(45);
    expect(task.history).toHaveLength(GET_TASK_HISTORY_MAX);
    expect(task.historyTotal).toBe(50);
    expect(task.history?.at(-1)?.id).toBe('h49');
    expect(task.history?.[0]?.id).toBe('h20');
  });

  it('a ficha nunca derruba um get_task que já funcionava: se a parte fixa pesa demais, os grupos grandes encolhem e saem', async () => {
    // Rodadas de aprovação enormes ocupam o orçamento ANTES da ficha.
    const pesada = tarefa({
      id: 'tarefa-pesada',
      checklists: muitas.checklists,
      links: Array.from({ length: 45 }, (_, n) => ({ id: `l${n}`, label: `Link ${n}`, url: `https://www.dropbox.com/scl/fo/${'x'.repeat(300)}${n}` })),
      history: muitas.history,
      approvalRounds: Array.from({ length: 12 }, (_, r) => ({
        id: `rodada-${r}`,
        version: r + 1,
        state: 'superseded' as const,
        sentAt: '2026-09-20T10:00:00.000Z',
        decidedAt: null,
        decidedBy: null,
        closedAt: null,
        items: Array.from({ length: 12 }, (_, n) => ({
          position: n + 1,
          kind: 'video' as const,
          fileName: `arquivo-${r}-${n}.mp4`,
          source: 'dropbox' as const,
          url: `https://www.dropbox.com/scl/fo/${'y'.repeat(180)}${r}${n}`,
        })),
        clientComments: null,
      })),
    });
    const w = new MemoryWorkCatalog({ boards: BOARDS, tasks: [pesada] });
    const r = await getTaskWork(ctxDe(grant(), SUPER, w), { id: 'tarefa-pesada' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(measureJsonBytes(r.body)).toBeLessThanOrEqual(RESPONSE_BUDGET_BYTES);
    // As rodadas (o que já existia) seguem inteiras.
    expect(r.body.task.approvalRounds).toHaveLength(12);
    // Os grupos grandes encolheram, mas o resto da ficha ficou.
    const links = r.body.task.links?.length ?? 0;
    expect(links).toBeLessThan(GET_TASK_LINKS_MAX);
    expect(r.body.task.folder).toBeDefined();
  });

  it('descrição longa: a ficha vem só na primeira página, a continuação não a repete, e o cursor anda até o fim', async () => {
    const longa = tarefa({
      id: 'tarefa-longa',
      description: 'palavra '.repeat(30000),
      links: FICHA.links,
      history: FICHA.history,
      tags: FICHA.tags,
    });
    const w = new MemoryWorkCatalog({
      boards: BOARDS,
      tasks: [longa],
      clients: [
        { id: CLIENT_A, name: 'Jatobá', companyId: COMPANY_A, companyName: 'Agência Ide', listIds: ['lista-a'] },
        { id: CLIENT_B, name: 'Sabor Doce', companyId: COMPANY_A, companyName: 'Agência Ide', listIds: [] },
      ],
    });
    const primeira = await ler(grant(), 'tarefa-longa', SUPER, w);
    expect(primeira.hasMore).toBe(true);
    expect(primeira.task.links).toHaveLength(1);
    expect(primeira.task.history).toHaveLength(5);

    let pedaco = primeira.task.description ?? '';
    let cursor = primeira.nextCursor;
    let paginas = 1;
    while (cursor) {
      const pagina = await ler(grant(), 'tarefa-longa', SUPER, w, cursor);
      expect(pagina.task.links).toBeUndefined();
      expect(pagina.task.history).toBeUndefined();
      expect(pagina.task.tags).toBeUndefined();
      pedaco += pagina.task.description ?? '';
      cursor = pagina.nextCursor;
      paginas += 1;
      expect(paginas).toBeLessThan(10);
    }
    expect(pedaco).toBe(longa.description);
  });
});

describe('get_task — contrato, HTTP e MCP', () => {
  const memoryCatalog = new MemoryCatalog([{ id: COMPANY_A, name: 'Agência Ide' }], new Map([[OWNER_ID, 'Wesley']]));

  it('o exemplo do OpenAPI traz a ficha e passa no schema', () => {
    const exemplo = getTaskResponseSchema.parse(getTaskOpenApiExample());
    expect(exemplo.task.history?.length).toBeGreaterThan(0);
    expect(exemplo.task.checklists?.[0]?.items.length).toBeGreaterThan(0);
    expect(exemplo.task.links?.length).toBeGreaterThan(0);
  });

  it('HTTP GET, MCP e a função devolvem a mesma ficha', async () => {
    const direto = await ler(grant());
    const resposta = await dispatchIntegrationHttp({
      request: new Request(`${ORIGIN}${GET_TASK_PATH}?id=tarefa-ficha`),
      grant: grant(),
      person: SUPER,
      origin: 'http',
      catalog: memoryCatalog,
      work: WORK,
      delivery: EMPTY_DELIVERY_CATALOG,
      now: AGORA,
    });
    expect(resposta.status).toBe(200);
    const corpo = (await resposta.json()) as { task: unknown };
    expect(corpo.task).toEqual(direto.task);

    const mcp = await handleMcpRequest({
      request: new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_task', arguments: { id: 'tarefa-ficha' } } }),
      }),
      grant: grant(),
      person: SUPER,
      origin: 'mcp',
      catalog: memoryCatalog,
      work: WORK,
      delivery: EMPTY_DELIVERY_CATALOG,
      marketing: new MemoryMarketingCatalog(),
      now: AGORA,
    });
    const resultado = ((await mcp.json()) as { result: { structuredContent?: { task: unknown } } }).result;
    expect(resultado.structuredContent?.task).toEqual(direto.task);
  });
});
