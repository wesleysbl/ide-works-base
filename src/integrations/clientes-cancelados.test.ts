/**
 * Cliente cancelado fora das leituras do presente — F38, Fase 4.
 *
 * Cliente com `is_active = false` é CANCELADO. Na busca ele só volta quando a
 * pergunta é pelo nome dele (o texto é o começo do nome, até uma fronteira de
 * palavra), e volta só com id, nome, `cancelled: true` e o dia. Uma palavra
 * genérica do ramo ("enxovais") não despeja os cancelados. A ficha dele é só
 * identificação e dia; o mural continua lendo o passado.
 *
 * O SQL que faz o mesmo está em `sql-work-busca.test.ts`; a prova no banco é
 * `scripts/provar-clientes-cancelados.mjs`.
 */

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import { getClientResponseSchema, searchResponseSchema } from '@/integrations/contract';
import { MemoryCatalog } from '@/integrations/context';
import { READ_CAPABILITIES, type IntegrationGrant, type PersonAccess } from '@/integrations/grants';
import { MemoryMarketingCatalog, getMarketingReport, type MarketingAssetRow } from '@/integrations/marketing';
import { handleMcpRequest } from '@/integrations/mcp';
import {
  MemoryWorkCatalog,
  cancelledNameMatches,
  getClientMuralWork,
  getClientWork,
  getPersonWork,
  getTaskWork,
  searchWork,
  type MemoryClient,
  type ReadCtx,
} from '@/integrations/reads';
import { MemoryDeliveryCatalog } from '@/integrations/reports';

const EMPRESA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DONO = '11111111-1111-1111-1111-111111111111';
const AGORA = new Date('2026-10-06T15:00:00.000Z');

const cliente = (id: string, name: string, cancelledOn?: string): MemoryClient => ({
  id,
  name,
  companyId: EMPRESA,
  companyName: 'Agência Ide',
  listIds: [`lista-${id}`],
  ...(cancelledOn ? { isActive: false, cancelledOn } : {}),
});

const CLIENTES: MemoryClient[] = [
  cliente('mirela', 'Mirela Enxovais'),
  cliente('souza', 'Souza e Leal Enxovais'),
  cliente('cris', 'Cida Enxovais', '2026-05-12'),
  cliente('mimi', 'Mimi Enxovais', '2026-07-29'),
  cliente('vania', 'Vânia Enxovais', '2026-01-05'),
  cliente('zeca', 'Zeca Hamburgueria', '2025-12-30'),
  cliente('acai', 'Açaí da Mata', '2025-12-17'),
];

const lista = (clientId: string, name: string) => ({
  id: `lista-${clientId}`,
  name,
  companyId: EMPRESA,
  companyName: 'Agência Ide',
  spaceId: 'space',
  spaceName: 'Entrega',
  folderId: null,
  folderName: null,
  clientId,
  clientName: CLIENTES.find((c) => c.id === clientId)?.name ?? null,
  canSeeSpace: true,
  statuses: [{ id: 'aberto', name: 'Aberto', sortOrder: 1, type: 'open' as const }],
});

const tarefa = (id: string, title: string, boardId: string, clientId: string | null) => ({
  id,
  title,
  description: null,
  companyId: EMPRESA,
  companyName: 'Agência Ide',
  boardId,
  clientId,
  clientName: clientId ? (CLIENTES.find((c) => c.id === clientId)?.name ?? null) : null,
  statusId: 'aberto',
  dueOn: null,
  // F38, Fase 6.2: todas da Helena, para o `get_person_work`.
  people: [{ id: 'helena', name: 'Helena' }],
});

const WORK = new MemoryWorkCatalog({
  clients: CLIENTES,
  boards: [lista('mirela', 'Campanha Mirela'), lista('zeca', 'Campanha Zeca')],
  tasks: [
    tarefa('t-mirela', 'Campanha de enxovais', 'lista-mirela', 'mirela'),
    // Cliente cancelado na própria tarefa.
    { ...tarefa('t-zeca', 'Campanha do lanche', 'lista-zeca', 'zeca'), completedAt: '2025-12-20T12:00:00.000Z' },
    // Sem cliente na tarefa, mas a lista é de cliente cancelado.
    tarefa('t-zeca-lista', 'Campanha sem cliente', 'lista-zeca', null),
  ],
  people: [{ id: 'helena', name: 'Helena', companyId: EMPRESA, companyName: 'Agência Ide', detail: null }],
  muralNotes: [
    {
      id: 'nota-zeca',
      clientId: 'zeca',
      title: null,
      content: 'Contrato encerrado em dezembro.',
      color: 'yellow',
      author: null,
      createdById: null,
      viaName: null,
      createdAt: '2025-12-30T12:00:00.000Z',
      updatedAt: '2025-12-30T12:00:00.000Z',
    },
  ],
});

const PESSOA: PersonAccess = {
  userId: DONO,
  isActive: true,
  isSuperadmin: true,
  isSuper: false,
  companyIds: [EMPRESA],
  clientIds: CLIENTES.map((c) => c.id),
  hasAllClientsAccess: true,
};

const CONCESSAO: IntegrationGrant = {
  id: 'grant',
  ownerId: DONO,
  oauthClientId: 'claude',
  name: 'Claude',
  capabilities: [...READ_CAPABILITIES],
  allowedCompanyIds: [EMPRESA],
  allowedClientIds: null,
  expiresAt: null,
  revokedAt: null,
  policyVersion: 1,
};

const ctx: ReadCtx = {
  grant: CONCESSAO,
  person: PESSOA,
  origin: 'mcp',
  companies: [{ id: EMPRESA, name: 'Agência Ide' }],
  displayName: 'Wesley',
  work: WORK,
  now: AGORA,
};

async function buscar(q: string, kinds?: Array<'board' | 'task' | 'client' | 'person'>) {
  const r = await searchWork(ctx, { q, ...(kinds ? { kinds } : {}) });
  if (!r.ok) throw new Error(r.message);
  expect(searchResponseSchema.safeParse(r.body).success).toBe(true);
  return r.body.items;
}

describe('cancelledNameMatches — a regra de casamento do cancelado', () => {
  it.each([
    ['Zeca Hamburgueria', 'Zeca', true],
    ['Zeca Hamburgueria', '  zeca  ', true],
    ['Zeca Hamburgueria', 'zeca hamburgueria', true],
    ['Cida Enxovais', 'Cida', true],
    ['Açaí da Mata', 'acai', true],
    ['Dra. Gabriela Melo', 'Dra', true],
    ['Zeca Hamburgueria', 'zec', false],
    ['Cida Enxovais', 'enxovais', false],
    ['Cida Enxovais', 'cris enx', false],
    ['Zeca Hamburgueria', 'hamburgueria', false],
    ['Zeca Hamburgueria', '', false],
  ])('%s com "%s" → %s', (nome, busca, esperado) => {
    expect(cancelledNameMatches(nome, busca)).toBe(esperado);
  });
});

describe('search — cancelado fora da listagem, presente pelo nome', () => {
  it('"enxovais" traz só os ativos: nem Cida, nem Mimi, nem Vânia', async () => {
    const itens = await buscar('enxovais', ['client']);
    expect(itens.map((h) => h.title).sort()).toEqual(['Mirela Enxovais', 'Souza e Leal Enxovais']);
    expect(itens.every((h) => h.cancelled === undefined)).toBe(true);
  });

  it('"Zeca" traz só o achado mínimo, com cancelled e o dia', async () => {
    const itens = await buscar('Zeca', ['client']);
    expect(itens).toEqual([
      {
        kind: 'client',
        id: 'zeca',
        title: 'Zeca Hamburgueria',
        detail: 'cancelado em 30/12/2025',
        board: null,
        client: null,
        company: null,
        cancelled: true,
        cancelledOn: '2025-12-30',
      },
    ]);
  });

  it('"Cida Enxovais" acha a Cida pelo nome inteiro; "zec" (meio de palavra) não acha nada', async () => {
    expect((await buscar('Cida Enxovais', ['client'])).map((h) => h.id)).toEqual(['cris']);
    expect(await buscar('zec', ['client'])).toEqual([]);
  });

  it('quadro e tarefa de cliente cancelado não voltam, nem pelo cliente da lista', async () => {
    const itens = await buscar('campanha', ['board', 'task']);
    expect(itens.map((h) => h.id).sort()).toEqual(['lista-mirela', 't-mirela']);
  });

  it('sem `kinds`, o cancelado continua só no achado de cliente', async () => {
    const itens = await buscar('zeca');
    expect(itens.map((h) => `${h.kind}:${h.id}`)).toEqual(['client:zeca']);
  });
});

describe('get_client — cancelado devolve só identificação e o dia', () => {
  it('cancelado: id, nome, cancelled e cancelledOn; sem empresa nem listas', async () => {
    const r = await getClientWork(ctx, { id: 'zeca' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(getClientResponseSchema.safeParse(r.body).success).toBe(true);
    expect(r.body.client).toEqual({ id: 'zeca', name: 'Zeca Hamburgueria', cancelled: true, cancelledOn: '2025-12-30' });
  });

  it('ativo: a ficha de sempre, sem marca de cancelado', async () => {
    const r = await getClientWork(ctx, { id: 'mirela' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.client).toMatchObject({ id: 'mirela', company: { id: EMPRESA, name: 'Agência Ide' } });
    expect(r.body.client).not.toHaveProperty('cancelled');
  });

  it('o passado continua acessível: mural e tarefa do cancelado pelo id', async () => {
    const mural = await getClientMuralWork(ctx, { clientId: 'zeca' });
    expect(mural.ok && mural.body.items.map((n) => n.id)).toEqual(['nota-zeca']);
    const t = await getTaskWork(ctx, { id: 't-zeca' });
    expect(t.ok && t.body.task.id).toBe('t-zeca');
  });
});

describe('MCP — o texto compacto diz que o cliente está cancelado', () => {
  async function chamar(name: string, args: unknown) {
    const response = await handleMcpRequest({
      request: new Request('https://ideworks.test/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      }),
      grant: CONCESSAO,
      person: PESSOA,
      origin: 'mcp',
      catalog: new MemoryCatalog([{ id: EMPRESA, name: 'Agência Ide' }], new Map([[DONO, 'Wesley']])),
      work: WORK,
      delivery: new MemoryDeliveryCatalog(),
      marketing: new MemoryMarketingCatalog(),
      now: AGORA,
    });
    expect(response.status).toBe(200);
    const { result } = (await response.json()) as { result: { isError?: boolean; content: Array<{ text: string }> } };
    expect(result.isError).toBeUndefined();
    return result.content[0]?.text ?? '';
  }

  it('get_client de cancelado: "nome · cancelado em dd/mm/aaaa", sem "0 lista(s)"', async () => {
    expect(await chamar('get_client', { id: 'zeca' })).toBe('Zeca Hamburgueria · cancelado em 30/12/2025');
    expect(await chamar('get_client', { id: 'mirela' })).toBe('Mirela Enxovais · 1 lista(s)');
  });

  it('search: o achado de cancelado leva a data; os outros achados ficam como antes', async () => {
    expect(await chamar('search', { q: 'Zeca', kinds: ['client'] })).toBe(
      '1 resultado(s): client Zeca Hamburgueria (zeca) · cancelado em 30/12/2025',
    );
    expect(await chamar('search', { q: 'campanha', kinds: ['board', 'task'] })).toBe(
      '2 resultado(s): board Campanha Mirela (lista-mirela); task Campanha de enxovais (t-mirela)',
    );
  });
});

describe('F38, Fase 6.2 — get_person_work sem tarefa de cliente cancelado', () => {
  it('a tarefa do cancelado sai da lista e das contagens, pelo cliente dela ou pelo da lista', async () => {
    const r = await getPersonWork(ctx, { id: 'helena' });
    if (!r.ok) throw new Error(r.message);
    expect(r.body.items.map((t) => t.id)).toEqual(['t-mirela']);
    // Sem o filtro seriam 3 tarefas (2 abertas do Zeca e da lista dele, 1 concluída do Zeca).
    expect(r.body.counts).toEqual({ tasks: 1, open: 1, done: 0 });
  });

  it('pelo id, a tarefa do cancelado continua lendo (passado acessível)', async () => {
    const r = await getTaskWork(ctx, { id: 't-zeca-lista' });
    expect(r.ok).toBe(true);
  });
});

describe('F38, Fase 6.2 — get_marketing_report e o cliente cancelado (regra de período, D3/D6)', () => {
  const conta = (id: string, clientId: string | null, extra: Partial<MarketingAssetRow> = {}): MarketingAssetRow => ({
    id,
    kind: 'ad_account',
    displayName: id,
    externalId: `act_${id}`,
    clientId,
    clientName: clientId,
    companyId: EMPRESA,
    companyName: 'Agência Ide',
    currency: 'BRL',
    lastSeenAt: null,
    ...extra,
  });
  const dia = (assetId: string, day: string) => ({
    assetId,
    day,
    campaignId: 'c',
    campaignName: null,
    spend: 10,
    reach: null,
    impressions: null,
    clicks: null,
    linkClicks: null,
    conversions: null,
    conversionValue: null,
    collectedAt: null,
  });
  const marketing = new MemoryMarketingCatalog({
    assets: [
      conta('mirela-ads', 'mirela'),
      conta('sem-cliente-ads', null),
      // Cancelado em 12/05/2026.
      conta('cris-ads', 'cris', { clientIsActive: false, clientCancelledOn: '2026-05-12' }),
    ],
    paidDays: [
      dia('mirela-ads', '2026-10-01'),
      dia('sem-cliente-ads', '2026-10-01'),
      dia('cris-ads', '2026-05-20'),
      dia('cris-ads', '2026-06-02'),
      dia('cris-ads', '2026-10-01'),
    ],
  });
  const mctx = {
    grant: CONCESSAO,
    person: PESSOA,
    origin: 'mcp' as const,
    companies: [{ id: EMPRESA, name: 'Agência Ide' }],
    displayName: 'Wesley',
    marketing,
    now: AGORA,
  };

  it('a janela padrão (presente) não traz a conta do cancelado', async () => {
    const r = await getMarketingReport(mctx, {});
    if (!r.ok) throw new Error(r.message);
    expect(r.body.paid.accounts.map((a) => a.id).sort()).toEqual(['mirela-ads', 'sem-cliente-ads']);
    expect(r.body.paid.spendByCurrency[0]?.spend.value).toBe(20);
  });

  it('período que pega o mês do cancelamento traz a conta, só com os dias até esse mês', async () => {
    // Maio conta (o mês do cancelamento); o dia de junho fica fora.
    const r = await getMarketingReport(mctx, { from: '2026-05-01', to: '2026-06-30' });
    if (!r.ok) throw new Error(r.message);
    const cris = r.body.paid.accounts.find((a) => a.id === 'cris-ads');
    expect(cris?.kpis.spend.value).toBe(10);
    expect(cris?.kpis.days).toBe(1);
    expect(r.body.paid.spendByCurrency[0]?.spend.value).toBe(10);
  });

  it('período todo depois do mês do cancelamento não traz a conta', async () => {
    const r = await getMarketingReport(mctx, { from: '2026-06-01', to: '2026-06-30' });
    if (!r.ok) throw new Error(r.message);
    expect(r.body.paid.accounts.map((a) => a.id)).not.toContain('cris-ads');
  });
});
