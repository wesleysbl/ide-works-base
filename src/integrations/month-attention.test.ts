/**
 * `get_month_attention` — conferência de 08/10/2026, lacuna G1.
 *
 * A leitura NÃO tem regra própria: o ritual, o contrato por tipo nos seis
 * baldes e os motivos vêm de `planejarMes` / `listaDeAtencao` /
 * `agruparMesPorResponsavel` (a visão Contrato do Planejamento). Os testes
 * provam quatro coisas: o recorte da concessão (outra empresa, outro cliente da
 * mesma empresa, empresa omitida e cliente cancelado nunca aparecem), a
 * projeção por capacidade (nome de pessoa só com `people:read`), os números e a
 * ordem IGUAIS aos da regra da tela, e o cursor andando até o fim.
 */

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import { RITUAL_LABEL } from '@/delivery/month-ritual';
import {
  GET_MONTH_ATTENTION_PATH,
  MONTH_ATTENTION_REASON_KEYS,
  MONTH_RITUAL_STAGES,
  getMonthAttentionInputSchema,
  getMonthAttentionOpenApiExample,
  getMonthAttentionResponseSchema,
  integrationOpenApi,
  jsonSchemaFromZod,
} from '@/integrations/contract';
import { MemoryCatalog } from '@/integrations/context';
import { type IntegrationCapability, type IntegrationGrant, type PersonAccess } from '@/integrations/grants';
import { dispatchIntegrationHttp } from '@/integrations/http';
import { MemoryMarketingCatalog } from '@/integrations/marketing';
import { handleMcpRequest } from '@/integrations/mcp';
import { getMonthAttention, leiturasDoRetrato } from '@/integrations/month-attention';
import { measureJsonBytes, RESPONSE_BUDGET_BYTES } from '@/integrations/page';
import { EMPTY_WORK_CATALOG } from '@/integrations/reads';
import {
  MemoryDeliveryCatalog,
  type DeliveryCatalog,
  type MemoryDeliveryData,
  type MemoryDeliveryItem,
  type ReportCtx,
} from '@/integrations/reports';
import {
  PESO_DO_MOTIVO,
  agruparMesPorResponsavel,
  listaDeAtencao,
  planejarMes,
} from '@/painel/planejamento-do-mes';

const COMPANY_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const COMPANY_ALMA = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CLIENT_A = 'cliente-jatoba';
const CLIENT_REBROTA = 'cliente-rebrota';
const CLIENT_HUB = 'cliente-hub';
const CLIENT_B = 'cliente-filmes';
const CLIENT_ALMA = 'cliente-alma9';
const CLIENT_ZECA = 'cliente-zeca';
const CLIENT_A2 = 'cliente-sabor-doce';
const OWNER_ID = '11111111-1111-1111-1111-111111111111';
const FOLDER_HELENA = '22222222-2222-4222-8222-222222222222';
const USER_ANA = '33333333-3333-4333-8333-333333333333';
const USER_HELENA = '44444444-4444-4444-8444-444444444444';
const ORIGIN = 'https://ideworks.test';
/** Segunda-feira, 05/10/2026, 09h em São Paulo. */
const AGORA = new Date('2026-10-05T12:00:00.000Z');
const OUT = '2026-10-01';

const COMPANIES = [
  { id: COMPANY_A, name: 'Agência Ide' },
  { id: COMPANY_B, name: 'Ide Filmes' },
  { id: COMPANY_ALMA, name: 'Alma Nove' },
];

const SUPER: PersonAccess = {
  userId: OWNER_ID,
  isActive: true,
  isSuperadmin: true,
  isSuper: true,
  companyIds: [COMPANY_A, COMPANY_B, COMPANY_ALMA],
  clientIds: [CLIENT_A, CLIENT_A2, CLIENT_REBROTA, CLIENT_HUB, CLIENT_B, CLIENT_ALMA, CLIENT_ZECA],
  hasAllClientsAccess: true,
};
const SEM_ALMA: PersonAccess = { ...SUPER, omittedCompanyIds: [COMPANY_ALMA] };
/** Quem NÃO é o topo: alcança só a empresa A e os clientes dela (a regra de `can_see_client`). */
const DA_EMPRESA_A: PersonAccess = {
  ...SUPER,
  isSuper: false,
  isSuperadmin: false,
  hasAllClientsAccess: false,
  companyIds: [COMPANY_A],
  clientIds: [CLIENT_A, CLIENT_A2, CLIENT_REBROTA, CLIENT_HUB],
};

function grant(partial: Partial<IntegrationGrant> = {}): IntegrationGrant {
  return {
    id: 'grant-atencao',
    ownerId: OWNER_ID,
    oauthClientId: 'claude',
    name: 'Claude da agência',
    capabilities: ['reports:delivery:read'],
    allowedCompanyIds: null,
    allowedClientIds: null,
    expiresAt: null,
    revokedAt: null,
    policyVersion: 1,
    ...partial,
  };
}

function peca(
  clientId: string,
  contentType: string,
  scheduledOn: string | null,
  completed: boolean,
  extra: Partial<MemoryDeliveryItem> = {},
): MemoryDeliveryItem {
  return {
    clientId,
    referenceMonth: OUT,
    contentType,
    isExtra: false,
    isCompleted: completed,
    scheduledOn,
    ...extra,
  };
}

/**
 * Jatobá: mês aberto e PLANEJADO por Helena (02/10), vídeo 8 e arte 4; um
 * vídeo feito (02/10), um atrasado (03/10), um agendado (08/10), um sem dia; uma
 * arte agendada (12/10); pasta TIME HELENA. Sabor Doce: aberto, planejado e
 * APROVADO, tudo em dia, mesma pasta. Rebrota: mês NÃO aberto, cota do cadastro
 * (arte 3), carteira da Ana. HUB: aberto, sem cota e sem peça. Filmes: outra
 * empresa, aprovado. Alma Nove: empresa omitida. Zeca: CANCELADO.
 */
const ITEMS: MemoryDeliveryItem[] = [
  peca(CLIENT_A, 'video', '2026-10-02', true, { id: 'v-feito', title: 'Reels de abertura' }),
  peca(CLIENT_A, 'video', '2026-10-03', false, { id: 'v-atrasado' }),
  peca(CLIENT_A, 'video', '2026-10-08', false, { id: 'v-agendado' }),
  peca(CLIENT_A, 'video', null, false, { id: 'v-sem-dia' }),
  peca(CLIENT_A, 'arte', '2026-10-12', false, { id: 'a-agendada' }),
  peca(CLIENT_A2, 'arte', '2026-10-02', true, { id: 'sd-a1' }),
  peca(CLIENT_A2, 'arte', '2026-10-06', false, { id: 'sd-a2' }),
  peca(CLIENT_B, 'foto', '2026-10-14', true, { id: 'f-feita' }),
  peca(CLIENT_ALMA, 'video', '2026-10-06', true, { id: 'alma-v' }),
  peca(CLIENT_ZECA, 'video', '2026-10-03', false, { id: 'zeca-v' }),
];

const DATA: MemoryDeliveryData = {
  clients: [
    { id: CLIENT_A, name: 'Jatobá', companyId: COMPANY_A, companyName: 'Agência Ide' },
    { id: CLIENT_A2, name: 'Sabor Doce', companyId: COMPANY_A, companyName: 'Agência Ide' },
    { id: CLIENT_REBROTA, name: 'Rebrota', companyId: COMPANY_A, companyName: 'Agência Ide' },
    { id: CLIENT_HUB, name: 'Cliente HUB', companyId: COMPANY_A, companyName: 'Agência Ide' },
    { id: CLIENT_B, name: 'Cliente Filmes', companyId: COMPANY_B, companyName: 'Ide Filmes' },
    { id: CLIENT_ALMA, name: 'Cliente Alma', companyId: COMPANY_ALMA, companyName: 'Alma Nove' },
    {
      id: CLIENT_ZECA,
      name: 'Zeca',
      companyId: COMPANY_A,
      companyName: 'Agência Ide',
      isActive: false,
      cancelledOn: '2026-10-04',
    },
  ],
  contracts: [
    { clientId: CLIENT_A, referenceMonth: OUT, contentType: 'video', quantity: 8 },
    { clientId: CLIENT_A, referenceMonth: OUT, contentType: 'arte', quantity: 4 },
    { clientId: CLIENT_A2, referenceMonth: OUT, contentType: 'arte', quantity: 2 },
    { clientId: CLIENT_B, referenceMonth: OUT, contentType: 'foto', quantity: 2 },
    { clientId: CLIENT_ALMA, referenceMonth: OUT, contentType: 'video', quantity: 4 },
    { clientId: CLIENT_ZECA, referenceMonth: OUT, contentType: 'video', quantity: 4 },
  ],
  items: ITEMS,
  opened: [
    { clientId: CLIENT_A, referenceMonth: OUT },
    { clientId: CLIENT_A2, referenceMonth: OUT },
    { clientId: CLIENT_HUB, referenceMonth: OUT },
    { clientId: CLIENT_B, referenceMonth: OUT },
    { clientId: CLIENT_ALMA, referenceMonth: OUT },
    { clientId: CLIENT_ZECA, referenceMonth: OUT },
  ],
  ritual: [
    {
      clientId: CLIENT_A,
      referenceMonth: OUT,
      planningDoneAt: '2026-10-02T13:00:00.000Z',
      planningDoneBy: { id: USER_HELENA, name: 'Helena' },
      clientApprovedAt: null,
      clientApprovedBy: null,
    },
    {
      clientId: CLIENT_A2,
      referenceMonth: OUT,
      planningDoneAt: '2026-10-01T13:00:00.000Z',
      planningDoneBy: { id: USER_HELENA, name: 'Helena' },
      clientApprovedAt: '2026-10-02T15:00:00.000Z',
      clientApprovedBy: { id: USER_ANA, name: 'Ana' },
    },
    {
      clientId: CLIENT_B,
      referenceMonth: OUT,
      planningDoneAt: '2026-10-01T13:00:00.000Z',
      planningDoneBy: null,
      clientApprovedAt: '2026-10-02T15:00:00.000Z',
      clientApprovedBy: null,
    },
  ],
  registry: [
    { clientId: CLIENT_REBROTA, contentType: 'arte', quantity: 3 },
    { clientId: CLIENT_A, contentType: 'video', quantity: 8 },
    { clientId: CLIENT_A2, contentType: 'arte', quantity: 2 },
    { clientId: CLIENT_ZECA, contentType: 'video', quantity: 4 },
  ],
  folders: [
    { clientId: CLIENT_A, folderId: FOLDER_HELENA, folderName: 'TIME HELENA' },
    { clientId: CLIENT_A2, folderId: FOLDER_HELENA, folderName: 'TIME HELENA' },
  ],
  portfolio: [{ clientId: CLIENT_REBROTA, userId: USER_ANA, name: 'Ana' }],
};
const CATALOG = new MemoryDeliveryCatalog(DATA);

function ctxFor(
  g: IntegrationGrant = grant(),
  person: PersonAccess = SUPER,
  delivery: DeliveryCatalog = CATALOG,
): ReportCtx {
  return { grant: g, person, origin: 'http', companies: COMPANIES, displayName: 'Wesley Lourenço', delivery, now: AGORA };
}

async function ok(input: Parameters<typeof getMonthAttention>[1], ctx: ReportCtx = ctxFor()) {
  const result = await getMonthAttention(ctx, input);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.body;
}

describe('get_month_attention — a leitura', () => {
  it('ritual, contrato nos seis baldes e motivos: o que a visão Contrato mostra', async () => {
    const body = await ok({ month: '2026-10' });
    expect(body.operation).toBe('get_month_attention');
    expect(body.month).toBe('2026-10');
    expect(body.today).toBe('2026-10-05');
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();

    // Cancelado (Zeca), outra empresa omitida (Alma) não entram quando a pessoa a omite — aqui SUPER vê a Alma.
    expect(body.clients.map((c) => c.name)).not.toContain('Zeca');

    const jatoba = body.clients.find((c) => c.id === CLIENT_A);
    expect(jatoba).toMatchObject({
      name: 'Jatobá',
      company: { id: COMPANY_A, name: 'Agência Ide' },
      stage: 'planejado',
      stageLabel: 'planejado, falta aprovação',
      hasContract: true,
      quotaSource: 'contrato',
      when: 'atual',
      currentWeek: { number: 2, from: '2026-10-05', to: '2026-10-11' },
      needsAttention: true,
    });
    expect(jatoba?.ritual).toEqual({
      monthOpened: true,
      planningDoneAt: '2026-10-02T13:00:00.000Z',
      planningDoneBy: null,
      clientApprovedAt: null,
      clientApprovedBy: null,
    });
    const video = jatoba?.types.find((t) => t.type === 'video');
    // O contrato (8) se parte em seis e a soma fecha.
    expect(video).toMatchObject({
      contract: 8,
      delivered: 1,
      scheduled: 1,
      late: 1,
      outsideMonth: 0,
      withoutDay: 1,
      notCreated: 4,
      missingToSchedule: 5,
      extras: 0,
    });
    expect(
      (video?.delivered ?? 0) +
        (video?.scheduled ?? 0) +
        (video?.late ?? 0) +
        (video?.outsideMonth ?? 0) +
        (video?.withoutDay ?? 0) +
        (video?.notCreated ?? 0),
    ).toBe(video?.contract);
    expect(video?.week).toEqual({ goal: 2, done: 0, scheduled: 1, late: 0, state: 'risco' });
    expect(jatoba?.reasons.map((r) => r.key)).toEqual(['atrasadas', 'semana-em-risco', 'sem-dia']);
    expect(jatoba?.reasons[0]).toEqual({
      key: 'atrasadas',
      text: '1 peça passou do dia sem entrega.',
      weight: PESO_DO_MOTIVO.atrasadas,
    });
    expect(jatoba?.weight).toBe(PESO_DO_MOTIVO.atrasadas);

    // Mês NÃO aberto: o estágio é "fechado" e o motivo mais grave é abrir o mês.
    const rebrota = body.clients.find((c) => c.id === CLIENT_REBROTA);
    expect(rebrota).toMatchObject({ stage: 'fechado', stageLabel: RITUAL_LABEL.fechado, quotaSource: 'cadastro' });
    expect(rebrota?.ritual.monthOpened).toBe(false);
    expect(rebrota?.reasons.map((r) => r.key)).toEqual(['mes-nao-aberto']);
    expect(rebrota?.reasons[0]?.text).toBe('O mês de outubro ainda não foi aberto.');

    // Aprovado e em dia: sem motivo.
    const sonho = body.clients.find((c) => c.id === CLIENT_A2);
    expect(sonho).toMatchObject({ stage: 'aprovado', needsAttention: false, weight: 0 });
    expect(sonho?.reasons).toEqual([]);

    // Aberto, sem cota e sem peça: sem contrato, nunca entra na atenção.
    const hub = body.clients.find((c) => c.id === CLIENT_HUB);
    expect(hub).toMatchObject({ hasContract: false, needsAttention: false, reasons: [], types: [] });
  });

  it('summary conta o filtro inteiro: clientes, com contrato, atenção, estágio e motivo', async () => {
    const body = await ok({ month: '2026-10' });
    expect(body.summary.clients).toBe(body.clients.length);
    expect(body.summary.withContract).toBe(body.clients.filter((c) => c.hasContract).length);
    expect(body.summary.needingAttention).toBe(body.clients.filter((c) => c.needsAttention).length);
    expect(Object.values(body.summary.byStage).reduce((a, b) => a + b, 0)).toBe(body.summary.clients);
    expect(body.summary.byStage.fechado).toBe(1);
    expect(body.summary.byStage.aprovado).toBe(2);
    expect(body.summary.byReason.map((r) => r.key)).toEqual([...MONTH_ATTENTION_REASON_KEYS]);
    expect(body.summary.byReason.find((r) => r.key === 'mes-nao-aberto')?.clients).toBe(1);
    expect(body.summary.byReason.find((r) => r.key === 'atrasadas')?.clients).toBe(1);
  });

  it('onlyAttention: só quem precisa, do motivo mais pesado ao mais leve; o resto vem depois', async () => {
    const soAtencao = await ok({ month: '2026-10', onlyAttention: true });
    // Rebrota (mês não aberto, 60), Filmes (nada marcado esta semana, 50), Jatobá (atrasada, 40), Alma (sem dia, 10).
    expect(soAtencao.clients.map((c) => c.id)).toEqual([CLIENT_REBROTA, CLIENT_B, CLIENT_A, CLIENT_ALMA]);
    expect(soAtencao.clients.every((c) => c.needsAttention)).toBe(true);
    expect(soAtencao.summary.clients).toBe((await ok({ month: '2026-10' })).summary.clients);
    expect(soAtencao.self).toBe(`${GET_MONTH_ATTENTION_PATH}?month=2026-10&onlyAttention=true`);

    const todos = await ok({ month: '2026-10' });
    // Quem precisa vem primeiro (mesma ordem); depois o resto, por nome.
    expect(todos.clients.slice(0, 4).map((c) => c.id)).toEqual([CLIENT_REBROTA, CLIENT_B, CLIENT_A, CLIENT_ALMA]);
    expect(todos.clients.slice(4).map((c) => c.name)).toEqual(['Cliente HUB', 'Sabor Doce']);
  });

  it('groups: por responsável, "Sem responsável" no fim; a pessoa da carteira é kind person', async () => {
    const body = await ok({ month: '2026-10' }, ctxFor(grant({ capabilities: ['reports:delivery:read', 'people:read'] })));
    const nomes = body.groups.map((g) => g.owner?.name ?? null);
    expect(nomes).toEqual(['Ana', 'TIME HELENA', null]);
    expect(body.groups[0]?.owner).toEqual({ id: USER_ANA, name: 'Ana', kind: 'person' });
    expect(body.groups[1]?.owner).toEqual({ id: FOLDER_HELENA, name: 'TIME HELENA', kind: 'folder' });
    const helena = body.groups.find((g) => g.owner?.id === FOLDER_HELENA);
    expect(helena).toMatchObject({ clientIds: [CLIENT_A, CLIENT_A2], needingAttention: 1, atRisk: 1 });
    expect(body.groups.at(-1)?.owner).toBeNull();
  });

  it('filtros: ownerId e clientId; responsável sem cliente é lista vazia', async () => {
    const helena = await ok({ month: '2026-10', ownerId: FOLDER_HELENA });
    expect(helena.clients.map((c) => c.id).sort()).toEqual([CLIENT_A, CLIENT_A2].sort());
    expect(helena.summary.clients).toBe(2);
    const ninguem = await ok({ month: '2026-10', ownerId: '99999999-9999-4999-8999-999999999999' });
    expect(ninguem.clients).toEqual([]);
    expect(ninguem.summary.clients).toBe(0);
    const um = await ok({ month: '2026-10', clientId: CLIENT_A });
    expect(um.clients.map((c) => c.id)).toEqual([CLIENT_A]);
    expect(um.self).toBe(`${GET_MONTH_ATTENTION_PATH}?month=2026-10&clientId=${CLIENT_A}`);
  });

  it('mês passado e futuro: sem "esta semana"; o motivo fala do mês', async () => {
    const passado = await ok({ month: '2026-09' });
    expect(passado.clients.every((c) => c.when === 'passado' && c.currentWeek === null)).toBe(true);
    expect(passado.clients.flatMap((c) => c.types).every((t) => t.week === null)).toBe(true);
    const futuro = await ok({ month: '2026-11' });
    expect(futuro.clients.every((c) => c.when === 'futuro')).toBe(true);
  });

  it('mês sem nada a planejar é lista vazia, não erro', async () => {
    const vazio = await ok({ month: '2026-10' }, ctxFor(grant(), SUPER, new MemoryDeliveryCatalog()));
    expect(vazio.clients).toEqual([]);
    expect(vazio.groups).toEqual([]);
    expect(vazio.summary).toMatchObject({ clients: 0, withContract: 0, needingAttention: 0 });
  });

  it('sem month: o mês atual da agência', async () => {
    const body = await ok({});
    expect(body.month).toBe('2026-10');
  });
});

describe('get_month_attention — é a regra da tela, sem segunda cópia', () => {
  it('as mesmas linhas, os mesmos motivos e a mesma ordem de planejarMes + listaDeAtencao sobre o mesmo retrato', async () => {
    const snapshot = await CATALOG.loadPlanning(
      { companies: { kind: 'all' }, clients: 'all', capabilities: new Set(['reports:delivery:read']) },
      OUT,
    );
    const { ritual, semanas } = leiturasDoRetrato(snapshot);
    const linhas = planejarMes({ ritual, semanas, mes: '2026-10', hoje: '2026-10-05' });
    const lista = listaDeAtencao(linhas);

    const body = await ok({ month: '2026-10', onlyAttention: true });
    expect(body.clients.map((c) => c.id)).toEqual(lista.map((l) => l.id));
    for (const linha of lista) {
      const lido = body.clients.find((c) => c.id === linha.id);
      expect(lido?.reasons).toEqual(linha.motivos.map((m) => ({ key: m.chave, text: m.texto, weight: m.peso })));
      expect(lido?.stage).toBe(linha.estagio);
      expect(lido?.stageLabel).toBe(linha.rotuloDoEstagio);
      expect(lido?.types.map((t) => [t.type, t.contract, t.delivered, t.scheduled, t.late, t.outsideMonth, t.withoutDay, t.notCreated])).toEqual(
        linha.tipos.map((t) => [t.tipo, t.contrato, t.entregues, t.marcadas, t.atrasadas, t.foraDoMes, t.semDia, t.naoCriadas]),
      );
    }

    const todos = await ok({ month: '2026-10' });
    const grupos = agruparMesPorResponsavel(linhas);
    expect(todos.groups.map((g) => [g.owner?.id ?? null, g.clientIds])).toEqual(
      grupos.map((g) => [g.id, g.linhas.map((l) => l.id)]),
    );
  });

  it('as chaves de motivo e os estágios do contrato são os da regra', () => {
    expect([...MONTH_ATTENTION_REASON_KEYS].sort()).toEqual(Object.keys(PESO_DO_MOTIVO).sort());
    // Do mais pesado ao mais leve, como a faixa.
    const pesos = MONTH_ATTENTION_REASON_KEYS.map((k) => PESO_DO_MOTIVO[k]);
    expect([...pesos].sort((a, b) => b - a)).toEqual(pesos);
    expect([...MONTH_RITUAL_STAGES].sort()).toEqual(Object.keys(RITUAL_LABEL).sort());
  });
});

describe('get_month_attention — o recorte da concessão', () => {
  it('outra empresa: a concessão da empresa A não vê Filmes nem Alma, nem a soma delas no summary', async () => {
    const body = await ok({ month: '2026-10' }, ctxFor(grant({ allowedCompanyIds: [COMPANY_A] })));
    const ids = body.clients.map((c) => c.id);
    expect(ids.sort()).toEqual([CLIENT_A, CLIENT_A2, CLIENT_HUB, CLIENT_REBROTA].sort());
    expect(JSON.stringify(body)).not.toContain('Cliente Filmes');
    expect(JSON.stringify(body)).not.toContain('Cliente Alma');
    expect(body.summary.clients).toBe(4);
    expect(body.coverage.kind).toBe('partial');
  });

  it('outro cliente da MESMA empresa concedida: concessão por cliente só devolve o permitido', async () => {
    const body = await ok({ month: '2026-10' }, ctxFor(grant({ allowedClientIds: [CLIENT_A] })));
    expect(body.clients.map((c) => c.id)).toEqual([CLIENT_A]);
    expect(body.summary.clients).toBe(1);
    expect(JSON.stringify(body)).not.toContain('Rebrota');
    expect(JSON.stringify(body)).not.toContain('Sabor Doce');

    // Pedir pelo id um cliente de fora é a MESMA recusa de um id que não existe.
    const fora = await getMonthAttention(ctxFor(grant({ allowedClientIds: [CLIENT_A] })), { month: '2026-10', clientId: CLIENT_A2 });
    const inexistente = await getMonthAttention(ctxFor(), { month: '2026-10', clientId: 'cliente-que-nao-existe' });
    expect(fora).toEqual({ ok: false, code: 'permission_denied', message: 'Fora do alcance desta integração.' });
    expect(inexistente).toEqual(fora);
  });

  it('a pessoa que alcança só a empresa A (vínculo por empresa) não vê os clientes de B', async () => {
    const body = await ok({ month: '2026-10' }, ctxFor(grant(), DA_EMPRESA_A));
    expect(body.clients.map((c) => c.id).sort()).toEqual([CLIENT_A, CLIENT_A2, CLIENT_HUB, CLIENT_REBROTA].sort());
    const filmes = await getMonthAttention(ctxFor(grant(), DA_EMPRESA_A), { month: '2026-10', clientId: CLIENT_B });
    expect(filmes.ok).toBe(false);
  });

  it('empresa omitida (Alma Nove): nenhum rastro, nem pelo id, nem no summary, nem nos grupos', async () => {
    const body = await ok({ month: '2026-10' }, ctxFor(grant(), SEM_ALMA));
    expect(body.clients.map((c) => c.id)).not.toContain(CLIENT_ALMA);
    expect(JSON.stringify(body)).not.toContain('Alma');
    expect(body.groups.flatMap((g) => g.clientIds)).not.toContain(CLIENT_ALMA);
    const com = await ok({ month: '2026-10' });
    expect(com.summary.clients).toBe(body.summary.clients + 1);
    expect(com.summary.needingAttention).toBe(body.summary.needingAttention + 1);

    const pelaId = await getMonthAttention(ctxFor(grant(), SEM_ALMA), { month: '2026-10', clientId: CLIENT_ALMA });
    expect(pelaId.ok).toBe(false);
    if (!pelaId.ok) expect(pelaId.code).toBe('permission_denied');
  });

  it('cliente cancelado fica de fora (só a carteira ativa), inclusive pelo id', async () => {
    const body = await ok({ month: '2026-10' });
    expect(JSON.stringify(body)).not.toContain('Zeca');
    const pelaId = await getMonthAttention(ctxFor(), { month: '2026-10', clientId: CLIENT_ZECA });
    expect(pelaId.ok).toBe(false);
    if (!pelaId.ok) expect(pelaId.code).toBe('permission_denied');
  });

  it('sem reports:delivery:read: permission_denied antes de qualquer outra checagem', async () => {
    const negado = { ok: false, code: 'permission_denied', message: 'Fora do alcance desta integração.' };
    const semCapacidade = grant({ capabilities: ['boards:read'] });
    expect(await getMonthAttention(ctxFor(semCapacidade), { month: '2026-10' })).toEqual(negado);
    expect(await getMonthAttention(ctxFor(semCapacidade), { month: '2026-13', limit: 0 })).toEqual(negado);
  });

  it('entrada inválida: mês, limite e cursor ruins são recusados antes de ler o banco', async () => {
    let lidas = 0;
    const espiao: DeliveryCatalog = {
      load: (scope, period) => CATALOG.load(scope, period),
      loadCalendar: (scope, period) => CATALOG.loadCalendar(scope, period),
      loadMonthly: (scope, period) => CATALOG.loadMonthly(scope, period),
      loadDeliveryStatus: (scope, now) => CATALOG.loadDeliveryStatus(scope, now),
      loadPlanning: (scope, month) => {
        lidas += 1;
        return CATALOG.loadPlanning(scope, month);
      },
    };
    const ctx = ctxFor(grant(), SUPER, espiao);
    const mes = await getMonthAttention(ctx, { month: '2026-13' });
    expect(mes.ok === false && mes.code).toBe('invalid_input');
    const limite = await getMonthAttention(ctx, { month: '2026-10', limit: 101 });
    expect(limite.ok === false && limite.code).toBe('limit_exceeded');
    const cursor = await getMonthAttention(ctx, { month: '2026-10', cursor: 'lixo!' });
    expect(cursor.ok === false && cursor.code).toBe('invalid_cursor');
    expect(lidas).toBe(0);
  });

  it('com clientId: UMA leitura, estreitada ao cliente', async () => {
    const escopos: unknown[] = [];
    const espiao: DeliveryCatalog = {
      load: (scope, period) => CATALOG.load(scope, period),
      loadCalendar: (scope, period) => CATALOG.loadCalendar(scope, period),
      loadMonthly: (scope, period) => CATALOG.loadMonthly(scope, period),
      loadDeliveryStatus: (scope, now) => CATALOG.loadDeliveryStatus(scope, now),
      loadPlanning: (scope, month) => {
        escopos.push(scope.clients);
        return CATALOG.loadPlanning(scope, month);
      },
    };
    const body = await ok({ month: '2026-10', clientId: CLIENT_A }, ctxFor(grant(), SUPER, espiao));
    expect(body.clients.map((c) => c.id)).toEqual([CLIENT_A]);
    expect(escopos).toEqual([new Set([CLIENT_A])]);
  });
});

describe('get_month_attention — projeção por capacidade', () => {
  it('sem people:read: quem planejou/aprovou e o nome do responsável-pessoa vêm nulos; pasta e ids ficam', async () => {
    const sem = await ok({ month: '2026-10' });
    const sonho = sem.clients.find((c) => c.id === CLIENT_A2);
    expect(sonho?.ritual.planningDoneAt).toBe('2026-10-01T13:00:00.000Z');
    expect(sonho?.ritual.planningDoneBy).toBeNull();
    expect(sonho?.ritual.clientApprovedBy).toBeNull();
    const rebrota = sem.clients.find((c) => c.id === CLIENT_REBROTA);
    expect(rebrota?.owners).toEqual([{ id: USER_ANA, name: null, kind: 'person' }]);
    expect(sem.groups.find((g) => g.owner?.id === USER_ANA)?.owner).toEqual({ id: USER_ANA, name: null, kind: 'person' });
    // A pasta (time) é do relatório, não é nome de pessoa.
    expect(sem.clients.find((c) => c.id === CLIENT_A)?.owners).toEqual([
      { id: FOLDER_HELENA, name: 'TIME HELENA', kind: 'folder' },
    ]);
    expect(JSON.stringify(sem)).not.toContain('Helena"');
    expect(JSON.stringify(sem)).not.toContain('"Ana"');
  });

  it('com people:read: os nomes aparecem', async () => {
    const com = await ok({ month: '2026-10' }, ctxFor(grant({ capabilities: ['reports:delivery:read', 'people:read'] })));
    const sonho = com.clients.find((c) => c.id === CLIENT_A2);
    expect(sonho?.ritual.planningDoneBy).toEqual({ id: USER_HELENA, name: 'Helena' });
    expect(sonho?.ritual.clientApprovedBy).toEqual({ id: USER_ANA, name: 'Ana' });
    expect(com.clients.find((c) => c.id === CLIENT_REBROTA)?.owners).toEqual([{ id: USER_ANA, name: 'Ana', kind: 'person' }]);
    // Mês legado sem "quem": continua nulo, com ou sem permissão.
    expect(com.clients.find((c) => c.id === CLIENT_B)?.ritual.planningDoneBy).toBeNull();
  });

  it('o link de aprovação do cliente nunca sai: nada de token, link ou hash no corpo', async () => {
    const texto = JSON.stringify(await ok({ month: '2026-10' }));
    expect(texto).not.toMatch(/token|hash|ciphertext|link/i);
  });
});

describe('get_month_attention — paginação e orçamento', () => {
  it('limit e cursor: as páginas cobrem os clientes uma vez só, na ordem da tela', async () => {
    const todos = (await ok({ month: '2026-10' })).clients.map((c) => c.id);
    const vistos: string[] = [];
    let cursor: string | undefined;
    let paginas = 0;
    do {
      const body = await ok({ month: '2026-10', limit: 2, cursor });
      expect(body.clients.length).toBeLessThanOrEqual(2);
      vistos.push(...body.clients.map((c) => c.id));
      // Os totais descrevem o filtro inteiro, em qualquer página.
      expect(body.summary.clients).toBe(todos.length);
      cursor = body.nextCursor ?? undefined;
      expect(body.hasMore).toBe(cursor !== undefined);
      paginas += 1;
    } while (cursor !== undefined && paginas < 20);
    expect(vistos).toEqual(todos);
    expect(paginas).toBe(Math.ceil(todos.length / 2));
  });

  it('onlyAttention pagina com cursor também (ordem da faixa, não a alfabética)', async () => {
    const primeira = await ok({ month: '2026-10', onlyAttention: true, limit: 1 });
    expect(primeira.clients.map((c) => c.id)).toEqual([CLIENT_REBROTA]);
    expect(primeira.hasMore).toBe(true);
    const segunda = await ok({ month: '2026-10', onlyAttention: true, limit: 1, cursor: primeira.nextCursor as string });
    expect(segunda.clients.map((c) => c.id)).toEqual([CLIENT_B]);
    expect(segunda.hasMore).toBe(true);
    const terceira = await ok({ month: '2026-10', onlyAttention: true, limit: 2, cursor: segunda.nextCursor as string });
    expect(terceira.clients.map((c) => c.id)).toEqual([CLIENT_A, CLIENT_ALMA]);
    expect(terceira.hasMore).toBe(false);
    expect(terceira.nextCursor).toBeNull();
  });

  it('99 clientes com os quatro tipos: cada página cabe em 64 KiB, o cursor anda até o fim e traz todos uma vez só', async () => {
    const clients = Array.from({ length: 99 }, (_, i) => ({
      id: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
      name: `Cliente de nome bem comprido para pesar no orçamento número ${String(i).padStart(2, '0')}`,
      companyId: COMPANY_A,
      companyName: 'Agência Ide — unidade de nome comprido',
    }));
    const tipos = ['video', 'arte', 'foto', 'ads'] as const;
    const catalog = new MemoryDeliveryCatalog({
      clients,
      contracts: clients.flatMap((client) =>
        tipos.map((tipo) => ({ clientId: client.id, referenceMonth: OUT, contentType: tipo, quantity: 8 })),
      ),
      items: clients.flatMap((client) =>
        tipos.flatMap((tipo) => [peca(client.id, tipo, '2026-10-03', false), peca(client.id, tipo, '2026-10-13', false)]),
      ),
      opened: clients.map((client) => ({ clientId: client.id, referenceMonth: OUT })),
    });
    const vistos: string[] = [];
    let cursor: string | undefined;
    let paginas = 0;
    do {
      const body = await ok({ month: '2026-10', limit: 100, cursor }, ctxFor(grant(), SUPER, catalog));
      expect(measureJsonBytes(body)).toBeLessThanOrEqual(RESPONSE_BUDGET_BYTES);
      vistos.push(...body.clients.map((c) => c.id));
      cursor = body.nextCursor ?? undefined;
      paginas += 1;
      expect(body.hasMore).toBe(cursor !== undefined);
    } while (cursor !== undefined && paginas < 50);
    expect(vistos).toHaveLength(99);
    expect(new Set(vistos).size).toBe(99);
    // O orçamento corta: não coube tudo numa página só.
    expect(paginas).toBeGreaterThan(1);
  }, 30_000);
});

describe('get_month_attention — contrato, HTTP e MCP', () => {
  const memoryCatalog = new MemoryCatalog(COMPANIES, new Map([[OWNER_ID, 'Wesley Lourenço']]));

  it('OpenAPI publica GET e POST, schemas iguais ao Zod e exemplo válido; entrada estrita', () => {
    const doc = integrationOpenApi() as {
      info: { description: string };
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown> };
    };
    expect(Object.keys(doc.paths['/get_month_attention'] ?? {}).sort()).toEqual(['get', 'post']);
    expect(doc.components.schemas.GetMonthAttentionInput).toEqual(jsonSchemaFromZod(getMonthAttentionInputSchema));
    expect(doc.components.schemas.GetMonthAttentionResponse).toEqual(
      jsonSchemaFromZod(getMonthAttentionResponseSchema),
    );
    expect(doc.info.description).toContain('get_month_attention');
    const exemplo = getMonthAttentionResponseSchema.parse(getMonthAttentionOpenApiExample());
    expect(exemplo.clients[0]?.reasons.length).toBeGreaterThan(0);

    expect(getMonthAttentionInputSchema.safeParse({ month: '2026-10', onlyAttention: true }).success).toBe(true);
    expect(getMonthAttentionInputSchema.safeParse({ onlyAttention: 'true' }).success).toBe(false);
    expect(getMonthAttentionInputSchema.safeParse({ month: '2026-10-01' }).success).toBe(false);
    expect(getMonthAttentionInputSchema.safeParse({ ownerId: 'nao-e-uuid' }).success).toBe(false);
    expect(getMonthAttentionInputSchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  function http(path: string, init?: RequestInit, g: IntegrationGrant = grant(), person: PersonAccess = SUPER) {
    return dispatchIntegrationHttp({
      request: new Request(`${ORIGIN}${path}`, init),
      grant: g,
      person,
      origin: 'http',
      catalog: memoryCatalog,
      delivery: CATALOG,
      now: AGORA,
    });
  }

  function mcpPost(method: string, params: unknown): Request {
    return new Request(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
  }

  async function callTool(args: unknown, g: IntegrationGrant = grant()) {
    const response = await handleMcpRequest({
      request: mcpPost('tools/call', { name: 'get_month_attention', arguments: args }),
      grant: g,
      person: SUPER,
      origin: 'mcp',
      catalog: memoryCatalog,
      work: EMPTY_WORK_CATALOG,
      delivery: CATALOG,
      marketing: new MemoryMarketingCatalog(),
      now: AGORA,
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as {
      result: { isError?: boolean; content: Array<{ text: string }>; structuredContent?: Record<string, unknown> };
    }).result;
  }

  it('paridade: HTTP GET (onlyAttention=true na query), HTTP POST, MCP e a função devolvem o mesmo corpo', async () => {
    const direto = await ok({ month: '2026-10', onlyAttention: true });

    const get = await http(`${GET_MONTH_ATTENTION_PATH}?month=2026-10&onlyAttention=true`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(direto);

    const post = await http(GET_MONTH_ATTENTION_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month: '2026-10', onlyAttention: true }),
    });
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual(direto);

    const mcp = await callTool({ month: '2026-10', onlyAttention: true });
    expect(mcp.isError).toBeUndefined();
    expect(mcp.structuredContent).toEqual(direto);
    expect(mcp.content[0]?.text).toContain('mês 2026-10');
    expect(mcp.content[0]?.text).toContain('4 de 6 cliente(s) precisam de atenção');
    expect(mcp.content[0]?.text).toContain('Jatobá');
  });

  it('HTTP GET com limit e a segunda página pelo cursor', async () => {
    const primeira = await http(`${GET_MONTH_ATTENTION_PATH}?month=2026-10&limit=4`);
    expect(primeira.status).toBe(200);
    const corpo = getMonthAttentionResponseSchema.parse(await primeira.json());
    expect(corpo.clients).toHaveLength(4);
    expect(corpo.hasMore).toBe(true);
    const segunda = await http(
      `${GET_MONTH_ATTENTION_PATH}?month=2026-10&limit=4&cursor=${encodeURIComponent(corpo.nextCursor as string)}`,
    );
    expect(getMonthAttentionResponseSchema.parse(await segunda.json()).clients).toHaveLength(2);
  });

  it('HTTP: 403 sem a permissão, 400 com entrada inválida (onlyAttention que não é booleano, mês, campo extra, cursor ruim)', async () => {
    const sem = await http(GET_MONTH_ATTENTION_PATH, undefined, grant({ capabilities: ['boards:read'] }));
    expect(sem.status).toBe(403);
    for (const ruim of ['month=2026-1', 'onlyAttention=sim', 'foo=1']) {
      const resposta = await http(`${GET_MONTH_ATTENTION_PATH}?${ruim}`);
      expect(resposta.status).toBe(400);
      expect(((await resposta.json()) as { error: string }).error).toBe('invalid_input');
    }
    const cursor = await http(`${GET_MONTH_ATTENTION_PATH}?month=2026-10&cursor=lixo!`);
    expect(cursor.status).toBe(400);
    expect(((await cursor.json()) as { error: string }).error).toBe('invalid_cursor');
  });

  it('MCP: recusa com o código estável (sem permissão, cliente de fora, cancelado) e campo desconhecido', async () => {
    const sem = await callTool({ month: '2026-10' }, grant({ capabilities: ['boards:read' as IntegrationCapability] }));
    expect(sem.isError).toBe(true);
    expect((JSON.parse(sem.content[0]?.text ?? '{}') as { error: string }).error).toBe('permission_denied');

    const fora = await callTool({ month: '2026-10', clientId: CLIENT_B }, grant({ allowedClientIds: [CLIENT_A] }));
    expect(fora.isError).toBe(true);
    expect((JSON.parse(fora.content[0]?.text ?? '{}') as { error: string }).error).toBe('permission_denied');

    const cancelado = await callTool({ month: '2026-10', clientId: CLIENT_ZECA });
    expect(cancelado.isError).toBe(true);

    const extra = await callTool({ month: '2026-10', foo: 1 });
    expect(extra.isError).toBe(true);
  });
});
