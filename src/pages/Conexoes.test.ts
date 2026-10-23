/**
 * F16.9b — tela de conexões, selo na conversa, GET do ledger e fluxo HTTP
 * das 5 ações. Não é piloto de fornecedor (Codex/Claude/ChatGPT/n8n).
 *
 * Sem DOM pesado: primeiro quadro da conversa + handler injetável.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { areaDaRota, podeChamar } from '@/auth/areas';
import { ConectarAgente } from '@/board/ConectarAgente';
import { MenuDaConta } from '@/board/ContaNoPe';
import { AvisoDasConexoesAntigas, LinhaDaExecucao, SelosDasPermissoes } from '@/board/PecasDaConexao';
import {
  OPERACOES_DO_AGENTE,
  avisoDasConexoesAntigasDispensado,
  conexoesAnterioresAoCorte,
  ROTULO_DA_CAPACIDADE,
  confirmacaoDoDesfazer,
  feitoAteAgora,
  resumoDoDesfazer,
  rotuloDaOperacao,
} from '@/board/rotulos-da-conexao';
import { ConversaDaTarefa } from '@/board/ConversaDaTarefa';
import { execucoesDaResposta, seloDeAgente, type Comentario } from '@/board/conversa';
import type { TaskDetail } from '@/board/ficha';
import { SEM_PROGRESSO } from '@/board/passos';
import { ROTAS } from '@/rotas';
import {
  ADD_COMMENT_PATH,
  CONNECTIONS_PATH,
  GET_DELIVERY_REPORT_PATH,
  GET_PERSON_WORK_PATH,
  MOVE_TASK_PATH,
  SEARCH_PATH,
} from '@/integrations/contract';
import {
  PUBLISHED_ORIGIN,
  clientRecipes,
  serverAddresses,
} from '@/integrations/client-recipes';
import { MemoryCatalog } from '@/integrations/context';
import { MemoryAgentWriteStore } from '@/integrations/executions';
import { INTEGRATION_CAPABILITIES, type PersonAccess } from '@/integrations/grants';
import {
  MemoryGrantStore,
  OAUTH_CONSENT_PATH,
  OAUTH_CSRF_COOKIE,
  PROOF_REDIRECT_URI,
  PROOF_SCOPE,
  createIntegrationHandler,
  httpAudience,
  type IntegrationServer,
} from '@/integrations/handler';
import { MemoryWorkCatalog } from '@/integrations/reads';
import { MemoryDeliveryCatalog } from '@/integrations/reports';
import { MemoryCommentBoard, MemoryMoveBoard } from '@/integrations/writes';
import { SESSION_COOKIE as HUMAN_SESSION } from '@/server/session';
import type { AuthenticatedActor, SessionResult } from '@/server/session';

const ORIGIN = 'https://ideworks.test';
const HTTP = httpAudience(ORIGIN);
const HUMAN_COOKIE = `${HUMAN_SESSION}=human-ok`;
const COMPANY_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLIENT_A = 'cliente-jatoba';
const COMMENT_TASK = '33333333-3333-4333-8333-333333333333';
const MOVE_ID = 'ccccccc1-ccc1-4cc1-8cc1-ccccccccccc1';
const LIST_ID = 'aaaaaaa1-aaa1-4aa1-8aa1-aaaaaaaaaaa1';
const ST_REF = 'bbbbbbb1-bbb1-4bb1-8bb1-bbbbbbbbbbb1';
const ST_APROV = 'bbbbbbb7-bbb7-4bb7-8bb7-bbbbbbbbbbb7';

const OWNER: AuthenticatedActor = {
  userId: '11111111-1111-1111-1111-111111111111',
  email: 'wesley@exemplo.com.br',
  papel: 'admin',
  isSuperadmin: true,
  isSuper: false,
  areas: ['entrega', 'quadro'],
  hasAllClientsAccess: true,
};

const PERSON: PersonAccess = {
  userId: OWNER.userId,
  isActive: true,
  isSuperadmin: true,
  isSuper: false,
  companyIds: [COMPANY_A],
  clientIds: [CLIENT_A],
  hasAllClientsAccess: true,
};

const FICHA: TaskDetail = {
  id: '604ef3c5-a635-45f0-914b-087c47f9eb85',
  title: 'Peça',
  description: null,
  listId: 'l1',
  listName: 'Jatobá',
  folderId: null,
  folderName: null,
  spaceId: 's1',
  spaceName: 'AGÊNCIA IDE',
  categoryName: 'Ide',
  statusId: 'st1',
  priority: null,
  dueOn: null,
  startOn: null,
  customItemId: null,
  taskTypeId: null,
  taskTypeName: null,
  taskTypeMissing: false,
  clientId: null,
  clientName: null,
  assignees: [],
  watchers: [],
  tags: [],
  completedAt: null,
  completedBy: null,
  archivedAt: null,
  createdBy: null,
  createdAt: '2026-08-26T10:00:00.000Z',
  updatedAt: '2026-08-26T10:00:00.000Z',
  statuses: [],
  statusSetName: 'Demandas',
  inheritedFrom: 'space',
  availableTags: [],
  availableTypes: [],
  parentId: null,
  parentTitle: null,
  subtasks: [],
  checklists: [],
  comments: [],
  attachments: [],
  links: [],
  history: [],
  progress: { ...SEM_PROGRESSO, commentCount: 1 },
};

const fala = (p: Partial<Comentario> = {}): Comentario => ({
  id: 'c-agente',
  parentId: null,
  body: 'Arte pronta para revisão.',
  author: { id: OWNER.userId, name: 'Wesley Lourenço' },
  createdAt: '2026-09-21T06:00:00.000Z',
  editedAt: null,
  replyCount: 0,
  mine: false,
  replies: [],
  ...p,
});

describe('a rota /conexoes', () => {
  it('está na tabela e a API de gestão é livre para qualquer autenticado', () => {
    const [moldura] = ROTAS;
    const caminhos = (moldura.children ?? []).map((r) => r.path);
    expect(caminhos).toContain('/conexoes');
    expect(areaDaRota('/integrations/v1/connections')).toBe('livre');
    expect(areaDaRota('/integrations/v1/connections/executions')).toBe('livre');
    expect(podeChamar('/integrations/v1/connections', [], false)).toBe(true);
  });
});

describe('a porta de entrada da tela', () => {
  /**
   * A tela nasceu órfã: a rota existia e NENHUMA tela linkava para ela — só
   * se chegava digitando a URL. Uma tela que corta o acesso de uma IA aos
   * dados da agência não pode depender de alguém saber a URL de cor.
   *
   * O link mora FORA de `ITENS_DA_BARRA`, porque item de seção entra em
   * `Personalizar` e pode ser escondido. Até a F28 ele era um botão solto no pé
   * da barra; desde a F29 ele mora no menu da conta (`ContaNoPe`), que é o pé
   * — e o chip, como o pé, não é item de seção e não se esconde.
   */
  const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', 'board');
  const barra = readFileSync(join(pasta, 'BarraLateral.tsx'), 'utf8');
  const conta = readFileSync(join(pasta, 'ContaNoPe.tsx'), 'utf8');

  it('o menu da conta leva a /conexoes', () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(MenuDaConta, {
          sessao: null,
          ancora: null,
          temaAtual: 'escuro',
          saindo: false,
          aoFechar: () => {},
          aoPersonalizar: () => {},
          aoMudarTema: () => {},
          aoSair: () => {},
        }),
      ),
    );
    expect(html).toMatch(/<a[^>]*href="\/conexoes"[^>]*>[\s\S]*?Agentes de IA/);
  });

  it('a tela se chama como o item que leva a ela: "Agentes de IA" — F29.5b', () => {
    const tela = readFileSync(join(pasta, '..', 'pages', 'Conexoes.tsx'), 'utf8');
    expect(tela).toContain('<Topo titulo="Agentes de IA" />');
    expect(tela).not.toContain('<Topo titulo="Conexões"');
  });

  it('sem `podeVer`: qualquer autenticado gerencia as próprias conexões', () => {
    // A rota da API é `livre`; um filtro de área aqui esconderia a tela de
    // revogar de quem mais precisa dela.
    expect(conta).toContain("link('/conexoes', 'Agentes de IA'");
    expect(conta).not.toMatch(/area:\s*'conexoes'/);
  });

  it('o chip fica no pé, fora das seções, e não entre os itens que a pessoa pode esconder', () => {
    expect(barra).toContain('<ContaNoPe');
    expect(barra.indexOf('<ContaNoPe')).toBeGreaterThan(barra.indexOf('secoes.map('));
    expect(barra).not.toContain("'conexoes',");
  });
});

describe('selo na conversa (join pelo ledger)', () => {
  const ledger = [
    {
      operation: 'add_comment',
      commentId: 'c-agente',
      actedAs: { integrationName: 'Claude da agência', ownerId: OWNER.userId },
      result: { commentId: 'c-agente', actedAs: { integrationName: 'Claude da agência' } },
    },
    { operation: 'move_task', commentId: null, result: { taskId: MOVE_ID } },
  ];

  /**
   * A conversa humana não pode depender do formato do ledger. Quando o GET
   * responde 200 com outro corpo — integração desligada servindo o HTML do
   * site, proxy, rota ainda não publicada — `executions` vem ausente. Antes
   * disto a lista virava `undefined`, `seloDeAgente` fazia `.find` nela e a
   * conversa INTEIRA sumia atrás do ErrorBoundary. Ver `scripts/e2e/conversa-chat.mjs`.
   */
  it('trata resposta sem executions como ledger vazio, e não derruba a conversa', () => {
    expect(execucoesDaResposta({ ok: true, notices: [], rows: [] })).toEqual([]);
    expect(execucoesDaResposta(undefined)).toEqual([]);
    expect(execucoesDaResposta(null)).toEqual([]);
    expect(execucoesDaResposta({ executions: null })).toEqual([]);
    expect(execucoesDaResposta({ executions: 'nada' })).toEqual([]);
    expect(execucoesDaResposta({ executions: ledger })).toEqual(ledger);
    expect(seloDeAgente('c-agente', 'Wesley', execucoesDaResposta({ ok: true }))).toBeNull();
  });

  it('reconhece o comentário do agente e ignora fala humana', () => {
    expect(seloDeAgente('c-agente', 'Wesley Lourenço', ledger)).toEqual({
      integration: 'Claude da agência',
      person: 'Wesley Lourenço',
    });
    expect(seloDeAgente('c-humano', 'Ana', ledger)).toBeNull();
  });

  it('aparece no primeiro quadro da conversa, sem efeito', () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(ConversaDaTarefa, {
          tarefa: { ...FICHA, comments: [fala()] },
          ocupado: false,
          aoAssentar: () => {},
          aoErro: () => {},
          execucoesIniciais: ledger,
        }),
      ),
    );
    expect(html).toContain('Claude da agência · Wesley Lourenço');
    expect(html).toContain('Comentário do agente Claude da agência, em nome de Wesley Lourenço');
    const semAgente = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(ConversaDaTarefa, {
          tarefa: { ...FICHA, comments: [fala({ id: 'c-humano', author: { id: 'a', name: 'Ana' } })] },
          ocupado: false,
          aoAssentar: () => {},
          aoErro: () => {},
          execucoesIniciais: ledger,
        }),
      ),
    );
    expect(semAgente).not.toContain('Claude da agência');
    expect(semAgente).toContain('Ana');
  });
});

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64Url(bytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

function mergeCookies(previous: string, response: Response): string {
  const map = new Map<string, string>();
  for (const part of previous.split(';').map((item) => item.trim()).filter(Boolean)) {
    const [key, ...rest] = part.split('=');
    map.set(key, rest.join('='));
  }
  for (const set of response.headers.getSetCookie()) {
    const pair = set.split(';')[0] ?? '';
    const [key, ...rest] = pair.split('=');
    const value = rest.join('=');
    if (!key) continue;
    if (value === '') map.delete(key);
    else map.set(key, value);
  }
  return [...map.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

function sessionResult(cookieHeader: string): SessionResult {
  if (!cookieHeader.includes(`${HUMAN_SESSION}=human-ok`)) {
    return { ok: false, status: 401, reason: 'no_token', message: 'Faltou o crachá.' };
  }
  return { ok: true, actor: OWNER };
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function completeHttpGrant(server: IntegrationServer): Promise<{ access: string; grantId: string }> {
  const pair = await pkce();
  const authorize = new URL('/oauth/authorize', ORIGIN);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', server.clientId);
  authorize.searchParams.set('redirect_uri', PROOF_REDIRECT_URI);
  authorize.searchParams.set('code_challenge', pair.challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  authorize.searchParams.set('state', 'f16-9b');
  authorize.searchParams.set('scope', PROOF_SCOPE);
  authorize.searchParams.set('resource', HTTP);

  const started = await server.fetch(new Request(authorize.toString()));
  const withSession = `${mergeCookies('', started)}; ${HUMAN_COOKIE}`;
  const page = await server.fetch(
    new Request(authorize.toString(), { headers: { Cookie: withSession, Accept: 'application/json' } }),
  );
  const payload = await parseJson(page);
  const cookies = mergeCookies(withSession, page);
  const csrf =
    typeof payload.csrf === 'string'
      ? payload.csrf
      : (cookies.match(new RegExp(`${OAUTH_CSRF_COOKIE}=([^;]+)`))?.[1] ?? '');

  const posted = await server.fetch(
    new Request(new URL(OAUTH_CONSENT_PATH, ORIGIN), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookies },
      body: JSON.stringify({
        csrf,
        capabilities: [...INTEGRATION_CAPABILITIES],
        company_scope: 'all',
        client_scope: 'all',
      }),
    }),
  );
  const code = new URL(posted.headers.get('Location')!).searchParams.get('code');
  const tokenRes = await server.fetch(
    new Request(new URL('/oauth/token', ORIGIN), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: PROOF_REDIRECT_URI,
        client_id: server.clientId,
        code_verifier: pair.verifier,
        resource: HTTP,
      }),
    }),
  );
  const body = await parseJson(tokenRes);
  const access = String(body.access_token);
  const unwrapped = await server.helpers.unwrapToken(access);
  const grantId = String((unwrapped?.grant.props as { grantId?: string } | undefined)?.grantId ?? '');
  return { access, grantId };
}

function agentHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: ORIGIN };
}

describe('GET execuções (sessão humana)', () => {
  it('lista o ledger e recusa token de agente', async () => {
    const grants = new MemoryGrantStore();
    grants.seedPerson(PERSON);
    const writes = new MemoryAgentWriteStore();
    writes.seedPerson(PERSON);
    const server = await createIntegrationHandler({
      grants,
      writes,
      resolveSession: async (request) => sessionResult(request.headers.get('Cookie') ?? ''),
    });
    const { access, grantId } = await completeHttpGrant(server);
    const grant = await grants.get(grantId, OWNER.userId);
    expect(grant).toBeTruthy();
    writes.seedGrant(grant!);
    writes.executions.set('exec-1', {
      id: 'exec-1',
      grantId,
      ownerId: OWNER.userId,
      operation: 'add_comment',
      targetId: COMMENT_TASK,
      occurredAt: new Date('2026-09-21T06:00:00.000Z'),
      result: {
        commentId: 'c-agente',
        actedAs: { ownerId: OWNER.userId, integrationId: grantId, integrationName: 'Cliente de integração' },
      },
      changes: { commentsAdded: 1 },
      idempotencyKey: 'idem-1',
      paramsHash: 'a'.repeat(64),
      policyVersion: grant!.policyVersion,
      origin: 'http',
      active: true,
    });

    const asAgent = await server.fetch(
      new Request(`${ORIGIN}${CONNECTIONS_PATH}/executions`, { headers: { Authorization: `Bearer ${access}` } }),
    );
    expect(asAgent.status).toBe(401);

    const listed = await server.fetch(
      new Request(`${ORIGIN}${CONNECTIONS_PATH}/executions`, { headers: { Cookie: HUMAN_COOKIE } }),
    );
    expect(listed.status).toBe(200);
    const body = await parseJson(listed);
    const executions = body.executions as Array<Record<string, unknown>>;
    expect(executions).toHaveLength(1);
    expect(executions[0].commentId).toBe('c-agente');
    expect(executions[0].operation).toBe('add_comment');
    expect(JSON.stringify(executions[0])).not.toMatch(/body|Arte pronta/);
  });
});

describe('fluxo HTTP das 5 ações (não é piloto de fornecedor)', () => {
  it('relatório, search, person, comment e move contra o handler injetável', async () => {
    const grants = new MemoryGrantStore();
    grants.seedPerson(PERSON);
    const writes = new MemoryAgentWriteStore();
    writes.seedPerson(PERSON);
    const comments = new MemoryCommentBoard(OWNER.userId, {
      taskCompanies: new Map([[COMMENT_TASK, COMPANY_A]]),
      taskClients: new Map([[COMMENT_TASK, CLIENT_A]]),
    });
    const board = new MemoryMoveBoard({
      lists: [
        {
          id: LIST_ID,
          name: 'Atendimento',
          companyId: COMPANY_A,
          clientId: CLIENT_A,
          statuses: [
            { id: ST_REF, name: 'Refação', type: 'custom', color: null },
            { id: ST_APROV, name: 'Aprovação', type: 'custom', color: null },
          ],
        },
      ],
      tasks: [
        {
          id: MOVE_ID,
          title: 'Peça da campanha',
          listId: LIST_ID,
          statusId: ST_REF,
          parentId: null,
          clientId: CLIENT_A,
          companyId: COMPANY_A,
          completedAt: null,
        },
      ],
    });
    const server = await createIntegrationHandler({
      grants,
      writes,
      comments,
      board,
      catalog: new MemoryCatalog([{ id: COMPANY_A, name: 'Agência Ide' }], new Map([[OWNER.userId, 'Wesley Lourenço']])),
      work: new MemoryWorkCatalog({
        boards: [
          {
            id: 'lista-atendimento-jatoba',
            name: 'Atendimento',
            companyId: COMPANY_A,
            companyName: 'Agência Ide',
            spaceId: 'space-a',
            spaceName: 'Entrega',
            folderId: null,
            folderName: null,
            clientId: CLIENT_A,
            clientName: 'Jatobá',
            canSeeSpace: true,
            statuses: [{ id: 'status-aberto', name: 'Aberto', sortOrder: 1 }],
          },
        ],
        tasks: [
          {
            id: 'tarefa-peca',
            title: 'Peça da campanha Jatobá',
            description: 'Briefing curto.',
            companyId: COMPANY_A,
            companyName: 'Agência Ide',
            boardId: 'lista-atendimento-jatoba',
            clientId: CLIENT_A,
            clientName: 'Jatobá',
            statusId: 'status-aberto',
            dueOn: '2026-09-30',
            people: [{ id: 'pessoa-helena', name: 'Helena' }],
          },
        ],
        clients: [
          { id: CLIENT_A, name: 'Jatobá', companyId: COMPANY_A, companyName: 'Agência Ide', listIds: ['lista-atendimento-jatoba'] },
        ],
        comments: [],
        people: [
          {
            id: 'pessoa-helena',
            name: 'Helena',
            companyId: COMPANY_A,
            companyName: 'Agência Ide',
            detail: 'atendimento',
            email: 'NAO_VAZAR_EMAIL',
            papel: 'NAO_VAZAR_PAPEL',
          },
        ],
      }),
      delivery: new MemoryDeliveryCatalog({
        clients: [{ id: CLIENT_A, name: 'Jatobá', companyId: COMPANY_A, companyName: 'Agência Ide' }],
        contracts: [{ clientId: CLIENT_A, referenceMonth: '2026-09-01', contentType: 'arte', quantity: 1 }],
        items: [
          {
            clientId: CLIENT_A,
            referenceMonth: '2026-09-01',
            scheduledOn: '2026-09-10',
            contentType: 'arte',
            isExtra: false,
            isCompleted: true,
          },
        ],
        opened: [{ clientId: CLIENT_A, referenceMonth: '2026-09-01' }],
        contentContractClientIds: [CLIENT_A],
      }),
      resolveSession: async (request) => sessionResult(request.headers.get('Cookie') ?? ''),
    });

    const { access, grantId } = await completeHttpGrant(server);
    const grant = await grants.get(grantId, OWNER.userId);
    expect(grant).toBeTruthy();
    writes.seedGrant(grant!);
    writes.seedPerson(PERSON);

    const auth = agentHeaders(access);
    const relatorio = await server.fetch(
      new Request(`${ORIGIN}${GET_DELIVERY_REPORT_PATH}`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ from: '2026-09-01', to: '2026-09-30' }),
      }),
    );
    expect(relatorio.status).toBe(200);
    expect((await parseJson(relatorio)).operation).toBe('get_delivery_report');

    const search = await server.fetch(
      new Request(`${ORIGIN}${SEARCH_PATH}`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ q: 'Peça da campanha' }),
      }),
    );
    expect(search.status).toBe(200);
    const searchBody = await parseJson(search);
    expect(searchBody.operation).toBe('search');
    expect(JSON.stringify(searchBody)).toContain('Peça da campanha Jatobá');

    const person = await server.fetch(
      new Request(`${ORIGIN}${GET_PERSON_WORK_PATH}`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ id: 'pessoa-helena' }),
      }),
    );
    expect(person.status).toBe(200);
    const personBody = await parseJson(person);
    expect(personBody.operation).toBe('get_person_work');
    expect(JSON.stringify(personBody)).toContain('Helena');
    expect(JSON.stringify(personBody)).not.toContain('NAO_VAZAR_EMAIL');

    const comment = await server.fetch(
      new Request(`${ORIGIN}${ADD_COMMENT_PATH}`, {
        method: 'POST',
        headers: { ...auth, 'Idempotency-Key': 'idem-piloto-comentario' },
        body: JSON.stringify({ taskId: COMMENT_TASK, body: 'Arte pronta para revisão.' }),
      }),
    );
    expect(comment.status).toBe(200);
    const commentBody = await parseJson(comment);
    expect(commentBody.operation).toBe('add_comment');
    expect(commentBody.commentId).toBeTruthy();
    expect(JSON.stringify(commentBody)).not.toContain('Arte pronta');

    const move = await server.fetch(
      new Request(`${ORIGIN}${MOVE_TASK_PATH}`, {
        method: 'POST',
        headers: { ...auth, 'Idempotency-Key': 'idem-piloto-movimento' },
        body: JSON.stringify({
          taskId: MOVE_ID,
          listId: LIST_ID,
          statusId: ST_APROV,
          from: { listId: LIST_ID, statusId: ST_REF },
        }),
      }),
    );
    expect(move.status).toBe(200);
    const moveBody = await parseJson(move);
    expect(moveBody.operation).toBe('move_task');
    expect(moveBody.statusId).toBe(ST_APROV);

    const ledger = await server.fetch(
      new Request(`${ORIGIN}${CONNECTIONS_PATH}/executions`, { headers: { Cookie: HUMAN_COOKIE } }),
    );
    expect(ledger.status).toBe(200);
    const executions = (await parseJson(ledger)).executions as Array<Record<string, unknown>>;
    expect(executions.some((row) => row.operation === 'add_comment')).toBe(true);
    expect(executions.some((row) => row.operation === 'move_task')).toBe(true);
  });
});

/**
 * F21.4 — receita de conexão por cliente.
 *
 * O que estes casos protegem: o endereço do servidor sair certo em toda receita,
 * nenhuma receita prometer compatibilidade que ninguém testou, e o texto que o
 * botão copia ser o mesmo texto que a tela mostra.
 */
describe('[f21.4] conectar um agente', () => {
  const enderecos = serverAddresses('https://works.exemplo.com.br');

  it('oferece os cinco clientes, e cada receita traz o endereço real do servidor', () => {
    const receitas = clientRecipes(enderecos);
    expect(receitas.map((r) => r.id)).toEqual([
      'claude-code',
      'claude-web',
      'chatgpt',
      'codex',
      'automacao',
    ]);
    for (const receita of receitas) {
      const copiados = receita.copies.map((c) => c.text).join('\n');
      expect(copiados).toContain(enderecos.mcp);
      expect(receita.steps.length).toBeGreaterThan(2);
      expect(receita.friction.length).toBeGreaterThan(20);
    }
    expect(clientRecipes(enderecos)[4].copies.map((c) => c.text).join('\n')).toContain(
      enderecos.http,
    );
  });

  it('o endereço vem da origem aberta, e só cai no publicado em desenvolvimento', () => {
    expect(serverAddresses('https://outro.exemplo.com/').mcp).toBe('https://outro.exemplo.com/mcp');
    expect(serverAddresses('http://localhost:5173').origin).toBe(PUBLISHED_ORIGIN);
    expect(serverAddresses(null).origin).toBe(PUBLISHED_ORIGIN);
    expect(serverAddresses('https://works.exemplo.com.br').http).toBe(
      'https://works.exemplo.com.br/api/integrations/v1',
    );
  });

  it('nenhuma receita se declara testada, e cada uma diz o que falta', () => {
    for (const receita of clientRecipes(enderecos)) {
      expect(receita.status).toBe('nao-testado');
      expect(receita.pending.length).toBeGreaterThan(20);
    }
  });

  it('o primeiro quadro mostra a escolha do cliente e a receita do primeiro', () => {
    const html = renderToStaticMarkup(createElement(ConectarAgente));
    for (const receita of clientRecipes(enderecos)) {
      expect(html).toContain(receita.label);
    }
    expect(html).toContain('não testado');
    // O texto copiável do primeiro cliente aparece inteiro na tela — é o mesmo
    // campo que alimenta o botão de copiar, então não há como divergirem.
    // Fora do navegador a tela não tem origem, e cai no endereço publicado.
    const primeira = clientRecipes(serverAddresses(null))[0];
    expect(html).toContain(primeira.copies[0].text);
    expect(html).toContain('Copiar');
    expect(html).toContain(primeira.friction.slice(0, 30));
  });

  it('não promete um clique nem esconde a passagem pelo navegador', () => {
    const texto = clientRecipes(enderecos)
      .map((r) => [r.summary, r.friction, r.pending, ...r.steps].join(' '))
      .join(' ')
      .toLowerCase();
    expect(texto).toContain('navegador');
    expect(texto).not.toContain('um clique só');
    expect(texto).not.toContain('basta clicar');
    expect(texto).toContain('uma única vez');
  });
});

describe('[f26.4] a tela de Conexões conhece as permissões e as escritas novas', () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const F26_1 = join(
    raiz,
    'supabase',
    'migrations',
    '20260922290000_ideworks_f26_1_permissoes_e_operacoes_da_ia.sql',
  );

  it('as operações da tela são exatamente as que o registro do banco aceita', () => {
    const sql = readFileSync(F26_1, 'utf8');
    const trecho = sql.match(/add constraint integration_executions_operation_sane check \(([\s\S]*?)\n {2}\);/);
    expect(trecho).not.toBeNull();
    const doBanco = [...(trecho?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...OPERACOES_DO_AGENTE]).toEqual(doBanco);
  });

  it('toda permissão tem selo curto, e as cinco novas dizem o que fazem', () => {
    expect(Object.keys(ROTULO_DA_CAPACIDADE).sort()).toEqual([...INTEGRATION_CAPABILITIES].sort());
    const html = renderToStaticMarkup(
      createElement(SelosDasPermissoes, { capabilities: [...INTEGRATION_CAPABILITIES] }),
    );
    for (const [cap, texto] of [
      ['tasks:write', 'criar e editar tarefas'],
      ['tasks:assign', 'definir responsáveis'],
      ['tasks:complete', 'concluir e reabrir'],
      ['clients:mural:write', 'escrever no mural'],
      ['clients:history:write', 'registrar no histórico'],
    ] as const) {
      expect(ROTULO_DA_CAPACIDADE[cap]).toBe(texto);
      expect(html).toContain(`>${texto}</span>`);
      // O nome técnico fica só no título, ao parar o ponteiro.
      expect(html).toContain(`title="${cap}"`);
    }
    // Permissão que a tela não conhece aparece pelo nome, sem sumir.
    expect(renderToStaticMarkup(createElement(SelosDasPermissoes, { capabilities: ['x:y'] }))).toContain(
      '>x:y</span>',
    );
  });

  const linha = (operation: string) =>
    renderToStaticMarkup(
      createElement(LinhaDaExecucao, {
        execucao: {
          grantName: 'Claude do Wesley',
          operation,
          origin: 'mcp',
          active: true,
          occurredAt: '2026-09-22T12:00:00.000Z',
          actedAs: { integrationName: 'Claude do Wesley' },
        },
      }),
    );

  it('cada escrita nova tem rótulo próprio no histórico de execuções', () => {
    const esperado: Record<string, string> = {
      add_comment: 'comentário',
      move_task: 'movimento',
      create_task: 'tarefa criada',
      update_task: 'tarefa editada',
      assign_task: 'responsáveis definidos',
      complete_task: 'tarefa concluída',
      reopen_task: 'tarefa reaberta',
      add_mural_note: 'nota no mural',
      update_mural_note: 'nota do mural editada',
      add_history_entry: 'registro no histórico',
      update_history_entry: 'registro do histórico editado',
    };
    expect(Object.keys(esperado)).toEqual([...OPERACOES_DO_AGENTE]);
    for (const op of OPERACOES_DO_AGENTE) {
      expect(rotuloDaOperacao(op)).toBe(esperado[op]);
      const html = linha(op);
      expect(html).toContain(`>${esperado[op]}</span>`);
      expect(html).not.toContain(`>${op}<`);
    }
  });

  it('a linha diz quando o desfazer não devolve a mudança — e só nesses casos', () => {
    const naoVolta = ['move_task', 'update_mural_note', 'update_history_entry'];
    for (const op of OPERACOES_DO_AGENTE) {
      const html = linha(op);
      if (naoVolta.includes(op)) {
        expect(html, op).toContain('>não se desfaz</span>');
      } else if (op === 'update_task') {
        expect(html).toContain('>texto não se desfaz</span>');
        expect(html).toContain('título e descrição editados não voltam');
      } else {
        expect(html, op).not.toContain('se desfaz');
      }
    }
  });

  it('o resumo do cartão conta cada tipo de escrita', () => {
    const g = 'grant-1';
    const e = (operation: string, undoneAt: string | null = null) => ({
      grantId: g,
      operation,
      occurredAt: '2026-09-22T12:00:00.000Z',
      undoneAt,
    });
    const texto = feitoAteAgora(g, [
      e('create_task'),
      e('create_task'),
      e('assign_task'),
      e('complete_task', '2026-09-22T13:00:00.000Z'),
      e('add_mural_note'),
      e('add_history_entry'),
      e('add_comment'),
      e('operacao_do_futuro'),
      { ...e('move_task'), grantId: 'outra' },
    ]);
    expect(texto).toBe(
      'Já fez: 1 comentário(s) · 2 tarefa(s) criada(s) · 1 troca(s) de responsáveis · ' +
        '1 tarefa(s) concluída(s) · 1 nota(s) no mural · 1 registro(s) no histórico · ' +
        '1 outra(s) escrita(s) — a última em 22/09/2026. 1 já desfeita(s).',
    );
    expect(feitoAteAgora(g, [])).toBe('Nada escrito por esta conexão ainda.');
  });

  it('a confirmação do desfazer diz o que volta e o que não volta', () => {
    const texto = confirmacaoDoDesfazer('Claude do Wesley', 3);
    expect(texto).toMatch(/serão APAGADOS/);
    expect(texto).toMatch(/3 aparece\(m\)/);
    expect(texto).toMatch(/não tem volta/);
    expect(texto).toContain('tarefa criada é arquivada');
    expect(texto).toContain('nota do mural e registro do histórico criados são apagados');
    expect(texto).toContain('responsáveis, prazo, início, prioridade, etiquetas e conclusão voltam');
    expect(texto).toContain('NÃO voltam: texto editado (título, descrição, nota do mural, registro do histórico)');
    expect(texto).toContain('movimento de card');
  });
});

describe('[f26.8] o resultado do desfazer, em português', () => {
  it('diz o que voltou por tipo, o que ficou com o motivo e o que não se desfaz', () => {
    const resumo = resumoDoDesfazer({
      removed: 2,
      kept: 0,
      items: [
        { operation: 'add_history_entry', status: 'undone', message: 'Registro apagado do histórico do cliente.' },
        { operation: 'add_mural_note', status: 'undone', message: 'Nota apagada do mural.' },
        { operation: 'update_mural_note', status: 'not_undoable', message: 'Edição de nota do mural não se desfaz.' },
        {
          operation: 'update_task',
          status: 'skipped',
          message: 'O prazo: uma pessoa mudou isso depois, e fica como ela deixou.',
        },
        {
          operation: 'update_task',
          status: 'undone',
          message: 'A prioridade voltou ao valor anterior.',
          textNotUndone: ['title'],
        },
        { operation: 'move_task', status: 'not_undoable', message: 'Movimento de card não se desfaz.' },
        { operation: 'assign_task', status: 'undone', message: 'Os responsáveis voltaram a ser os de antes.' },
        { operation: 'add_comment', status: 'undone', message: 'Comentário apagado da conversa.' },
        { operation: 'add_comment', status: 'undone', message: 'Comentário apagado da conversa.' },
        { operation: 'create_task', status: 'already_gone', message: 'A tarefa já estava arquivada.' },
      ],
    });
    expect(resumo.titulo).toBe(
      'Desfeito: 2 comentário(s) apagado(s), 1 edição(ões) de tarefa desfeita(s), ' +
        '1 troca(s) de responsáveis desfeita(s), 1 nota(s) apagada(s) do mural, ' +
        '1 registro(s) apagado(s) do histórico, 1 já tinha(m) sido apagada(s) ou arquivada(s) antes.',
    );
    expect(resumo.pulados).toEqual(['Tarefa editada — O prazo: uma pessoa mudou isso depois, e fica como ela deixou.']);
    expect(resumo.naoVoltam).toBe(
      'Não se desfaz: 1 movimento(s) · 1 nota(s) do mural editada(s) · o texto de 1 tarefa(s) editada(s) — ' +
        'texto editado e movimento de card continuam como a IA deixou.',
    );
  });

  it('lote vazio diz que não havia o que desfazer; resposta antiga cai no texto dos comentários', () => {
    expect(resumoDoDesfazer({ removed: 0, kept: 0, items: [] })).toEqual({
      titulo: 'Nada voltou: não havia o que desfazer nesta conexão.',
      pulados: [],
      naoVoltam: null,
    });
    expect(resumoDoDesfazer({ removed: 2, kept: 1 }).titulo).toBe(
      'Desfeito: 2 comentário(s) apagado(s), 1 ficaram de pé (sem permissão para apagar).',
    );
  });
});

describe('[f44.9] aviso único das conexões autorizadas antes de 09/10', () => {
  const conexao = (id: string, authorizedAt: string | null, extra: Record<string, unknown> = {}) => ({
    id,
    name: `Agente ${id}`,
    authorizedAt,
    revokedAt: null,
    live: true,
    ...extra,
  });

  it('só as vivas autorizadas antes do corte entram; sem data, revogada e vencida ficam de fora', () => {
    const lista = [
      conexao('antiga', '2026-09-22T12:00:00.000Z'),
      conexao('nova', '2026-10-09T10:00:00.000Z'),
      conexao('virada', '2026-10-08T23:30:00-03:00'),
      conexao('sem-data', null),
      conexao('revogada', '2026-09-01T00:00:00.000Z', { revokedAt: '2026-09-02T00:00:00.000Z' }),
      conexao('vencida', '2026-09-01T00:00:00.000Z', { live: false }),
    ];
    expect(conexoesAnterioresAoCorte(lista).map((c) => c.id)).toEqual(['antiga', 'virada']);
  });

  it('desenha UM aviso, com a frase e a lista das antigas; sem antigas, nada', () => {
    const html = renderToStaticMarkup(
      createElement(AvisoDasConexoesAntigas, {
        antigas: [
          { id: 'a', name: 'Claude do Wesley', authorizedAt: '2026-09-22T12:00:00.000Z' },
          { id: 'b', name: 'Codex', authorizedAt: '2026-09-25T12:00:00.000Z' },
        ],
        aoDispensar: () => {},
      }),
    );
    expect(html.match(/data-aviso="conexoes-antigas"/g)).toHaveLength(1);
    expect(html).toContain('2 conexões foram autorizadas antes de 09/10');
    expect(html).toContain('plano, renovação, cota e');
    expect(html).toContain('revise ou reconecte');
    expect(html).toContain('Claude do Wesley');
    expect(html).toContain('Codex');
    expect(html).toContain('Entendi, dispensar');
    expect(renderToStaticMarkup(createElement(AvisoDasConexoesAntigas, { antigas: [] }))).toBe('');
  });

  it('sem armazenamento (servidor, janela privada) o aviso não está dispensado e nada quebra', () => {
    expect(avisoDasConexoesAntigasDispensado()).toBe(false);
  });
});
