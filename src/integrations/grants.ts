/**
 * Concessões da integração — F16.1.
 *
 * Acesso efetivo = acesso atual da pessoa ∩ concessão ∩ operação ∩ regras
 * do recurso. Administrar o sistema NÃO amplia o agente: as capacidades
 * saem só da concessão, nunca do papel.
 *
 * Escritas exigem a leitura correspondente. Comentário identifica a tarefa;
 * movimento acontece num quadro. A recusa é explícita — não completamos
 * a leitura em silêncio.
 */

import { assertIntegrationActor, userActor, type Actor, type IntegrationContext } from '@/server/db';

export const INTEGRATION_CAPABILITIES = [
  'boards:read',
  'tasks:read',
  'clients:read',
  'people:read',
  'comments:read',
  'reports:delivery:read',
  'reports:marketing:read',
  'comments:write',
  'tasks:move',
  // F26: as cinco escritas novas, na MESMA ordem do enum do banco (F26.1). A
  // ordem é a da tela de consentimento, e o teste do enum compara as duas.
  'tasks:write',
  'tasks:assign',
  'tasks:complete',
  'clients:mural:write',
  'clients:history:write',
] as const;

export type IntegrationCapability = (typeof INTEGRATION_CAPABILITIES)[number];

export const READ_CAPABILITIES = [
  'boards:read',
  'tasks:read',
  'clients:read',
  'people:read',
  'comments:read',
  'reports:delivery:read',
  'reports:marketing:read',
] as const satisfies readonly IntegrationCapability[];

export const WRITE_CAPABILITIES = [
  'comments:write',
  'tasks:move',
  'tasks:write',
  'tasks:assign',
  'tasks:complete',
  'clients:mural:write',
  'clients:history:write',
] as const satisfies readonly IntegrationCapability[];

/**
 * Escrita sem a leitura do mesmo recurso (e do que ela precisa identificar)
 * é recusada. Não é inferência: quem concede precisa marcar as duas.
 */
export const WRITE_REQUIRES_READ: Record<
  (typeof WRITE_CAPABILITIES)[number],
  readonly IntegrationCapability[]
> = {
  'comments:write': ['comments:read', 'tasks:read'],
  'tasks:move': ['tasks:read', 'boards:read'],
  // F26 — as mesmas dependências que o banco confere na concessão
  // (`integration_grants_write_implies_read`, migration F26.1). Mudar aqui sem
  // mudar lá faz a tela aceitar o que o banco recusa, ou o contrário.
  'tasks:write': ['tasks:read', 'boards:read'],
  'tasks:assign': ['tasks:read', 'boards:read'],
  'tasks:complete': ['tasks:read', 'boards:read'],
  'clients:mural:write': ['clients:read'],
  'clients:history:write': ['clients:read'],
};

export type IntegrationGrant = {
  id: string;
  ownerId: string;
  oauthClientId: string;
  name: string;
  capabilities: readonly IntegrationCapability[];
  /** `null` = todas as empresas que o responsável alcança agora. `[]` = nenhuma. */
  allowedCompanyIds: readonly string[] | null;
  /** `null` = todos os clientes alcançáveis (ainda recortados pela empresa). `[]` = nenhum. */
  allowedClientIds: readonly string[] | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  policyVersion: number;
  /** Quando a concessão nasceu (a autorização no OAuth). Ausente em dublês. */
  createdAt?: Date | null;
  /**
   * Teto de escritas confirmadas por dia desta concessão (F21.1).
   *
   * OPCIONAL DE PROPÓSITO: o valor mora no banco com padrão 50, e quem monta
   * uma concessão em teste ou numa leitura que não precisa do teto não deve
   * ser obrigado a inventar um número. Ausente ou nulo = o padrão do
   * servidor (`DEFAULT_DAILY_WRITE_LIMIT`). O agente NÃO manda este valor:
   * ele é lido da linha da concessão dentro da transação da escrita.
   */
  dailyWriteLimit?: number | null;
};

export type PersonAccess = {
  userId: string;
  isActive: boolean;
  isSuperadmin: boolean;
  isSuper: boolean;
  companyIds: readonly string[];
  /**
   * Os clientes que a pessoa alcança pela regra de `can_see_client` (F17.32):
   * os vinculados a ela (`user_clients`) e todos os das empresas dela
   * (`user_categories`) — `reachableClientIdsInTx` (executions.ts). Com topo
   * ou "acesso a todos os clientes", só os vínculos diretos: a pessoa alcança
   * tudo, e a lista não decide nada.
   */
  clientIds: readonly string[];
  hasAllClientsAccess: boolean;
  /**
   * As empresas OMITIDAS desta instalação, em ids — F31, Fase 3b.
   *
   * É o mesmo recorte que a tela recebe em `AuthenticatedActor.categoriasOmitidas`
   * (`IDEWORKS_EMPRESAS_OMITIDAS`, resolvida por `server/omitidas.ts`), levado
   * ao agente pelo MESMO objeto que já decide o alcance dele. Assim o recorte
   * mora num lugar só (`effectiveCompanies`) e todas as leituras e escritas que
   * já perguntam a ele passam a omitir sem conferência nova em cada uma.
   *
   * OPCIONAL de propósito: ausente = nada omitido = o comportamento de antes da
   * F31, campo a campo. Omitir NÃO mexe na concessão guardada: quem concedeu
   * `allowed_company_ids` com a omitida continua com a concessão válida — a
   * omitida só deixa de aparecer.
   */
  omittedCompanyIds?: readonly string[];
  /**
   * O NOME de cada empresa de `companyIds` — F31, Fase 3b. Só a página de
   * consentimento o usa, para mostrar "Ide" em vez de um UUID. Ausente = a
   * página cai no id, como antes.
   */
  companyNames?: Readonly<Record<string, string>>;
};

/**
 * O recorte de empresas do agente.
 *
 * `omitted` — F31, Fase 3b: as empresas omitidas, quando há. Em `all` é o que
 * fica DE FORA do "todas"; em `ids` elas já saíram da lista, e o campo só
 * existe para quem precisa da lista crua (a conta da Meta ligada a cliente de
 * empresa omitida, em `marketing.ts`). Ausente = nada omitido. Use
 * `omittedIn(scope)` para ler — nunca `kind === 'all'` sozinho, que esqueceria
 * a exceção.
 */
export type CompanyScope =
  | { kind: 'none' }
  | { kind: 'all'; omitted?: ReadonlySet<string> }
  | { kind: 'ids'; ids: ReadonlySet<string>; omitted?: ReadonlySet<string> };

/** As empresas omitidas deste recorte — `[]` quando não há (o caminho de antes da F31). */
export function omittedIn(scope: CompanyScope): string[] {
  return scope.kind === 'none' || !scope.omitted ? [] : [...scope.omitted];
}

/** A empresa está omitida para esta pessoa? — F31, Fase 3b. */
export function companyOmitted(person: PersonAccess, companyId: string | null | undefined): boolean {
  return !!companyId && (person.omittedCompanyIds ?? []).includes(companyId);
}

export type TaskProjectionInput = {
  id: string;
  title: string;
  client?: { id: string; name: string } | null;
  people?: ReadonlyArray<{ id: string; name: string }> | null;
  comments?: ReadonlyArray<{ id: string; body: string }> | null;
};

export type TaskProjection = {
  id: string;
  title: string;
  client: { id: string; name: string } | null;
  people: ReadonlyArray<{ id: string; name: string }> | null;
  comments: ReadonlyArray<{ id: string; body: string }> | null;
};

export type AccessRefusal =
  | 'grant_inactive'
  | 'owner_mismatch'
  | 'owner_inactive'
  | 'capability'
  | 'company'
  | 'client';

export type AccessDecision = { allowed: true } | { allowed: false; reason: AccessRefusal };

export function isIntegrationCapability(value: string): value is IntegrationCapability {
  return (INTEGRATION_CAPABILITIES as readonly string[]).includes(value);
}

export function assertWriteImpliesRead(capabilities: readonly string[]): asserts capabilities is IntegrationCapability[] {
  const set = new Set(capabilities);
  for (const unknown of capabilities) {
    if (!isIntegrationCapability(unknown)) {
      throw new Error(`Capacidade de integração desconhecida: ${unknown}`);
    }
  }
  for (const write of WRITE_CAPABILITIES) {
    if (!set.has(write)) continue;
    const missing = WRITE_REQUIRES_READ[write].filter((required) => !set.has(required));
    if (missing.length > 0) {
      throw new Error(`${write} exige ${missing.join(' e ')}`);
    }
  }
}

export function grantIsLive(grant: IntegrationGrant, now: Date = new Date()): boolean {
  if (grant.revokedAt !== null) return false;
  if (grant.expiresAt !== null && grant.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

export function effectiveCapabilities(
  person: PersonAccess,
  grant: IntegrationGrant,
  now: Date = new Date(),
): ReadonlySet<IntegrationCapability> {
  if (!person.isActive) return new Set();
  if (person.userId !== grant.ownerId) return new Set();
  if (!grantIsLive(grant, now)) return new Set();
  // Papel de administrador não entra aqui de propósito.
  return new Set(grant.capabilities);
}

export function personReachesCompany(person: PersonAccess, companyId: string): boolean {
  if (person.isSuper) return true;
  return person.companyIds.includes(companyId);
}

export function effectiveCompanies(person: PersonAccess, grant: IntegrationGrant): CompanyScope {
  if (!person.isActive || person.userId !== grant.ownerId || !grantIsLive(grant)) {
    return { kind: 'none' };
  }

  const grantList = grant.allowedCompanyIds;
  if (grantList !== null && grantList.length === 0) return { kind: 'none' };

  // F31, Fase 3b — O QUE NÃO É DA IDE NÃO APARECE PARA O AGENTE.
  //
  // A omissão entra AQUI, e só aqui, porque é daqui que saem o `get_context`,
  // o recorte das leituras (`toWorkScope`), dos relatórios e das escritas
  // (`decideAccess`). Sem omitida o caminho é o de antes, linha a linha.
  //
  // A concessão guardada não muda: se ela lista a omitida, a omitida só some
  // do resultado. Se ela listava SÓ a omitida, sobra nada — e "nada" é o
  // `none` que a concessão sem empresa alcançável já dava.
  const omitted = new Set(person.omittedCompanyIds ?? []);
  if (omitted.size === 0) {
    if (grantList === null) {
      if (person.isSuper) return { kind: 'all' };
      return { kind: 'ids', ids: new Set(person.companyIds) };
    }

    const allowed = grantList.filter((id) => personReachesCompany(person, id));
    if (allowed.length === 0) return { kind: 'none' };
    return { kind: 'ids', ids: new Set(allowed) };
  }

  if (grantList === null) {
    if (person.isSuper) return { kind: 'all', omitted };
    return { kind: 'ids', ids: new Set(person.companyIds.filter((id) => !omitted.has(id))), omitted };
  }

  const allowed = grantList.filter((id) => personReachesCompany(person, id) && !omitted.has(id));
  if (allowed.length === 0) return { kind: 'none' };
  return { kind: 'ids', ids: new Set(allowed), omitted };
}

export function companyAllowed(scope: CompanyScope, companyId: string): boolean {
  if (scope.kind === 'none') return false;
  // F31, Fase 3b: "todas" é "todas menos as omitidas".
  if (scope.kind === 'all') return !scope.omitted?.has(companyId);
  return scope.ids.has(companyId);
}

export function personReachesClient(person: PersonAccess, clientId: string): boolean {
  if (person.isSuper || person.hasAllClientsAccess) return true;
  return person.clientIds.includes(clientId);
}

export function clientAllowed(
  person: PersonAccess,
  grant: IntegrationGrant,
  clientId: string,
  clientCompanyId: string | null,
): boolean {
  if (!person.isActive || person.userId !== grant.ownerId || !grantIsLive(grant)) return false;
  if (!personReachesClient(person, clientId)) return false;
  if (grant.allowedClientIds !== null) {
    if (grant.allowedClientIds.length === 0) return false;
    if (!grant.allowedClientIds.includes(clientId)) return false;
  }
  if (clientCompanyId !== null && !companyAllowed(effectiveCompanies(person, grant), clientCompanyId)) {
    return false;
  }
  return true;
}

export function allowsOperation(
  person: PersonAccess,
  grant: IntegrationGrant,
  operation: IntegrationCapability,
  now: Date = new Date(),
): boolean {
  return effectiveCapabilities(person, grant, now).has(operation);
}

/**
 * Interseção completa: pessoa ∩ concessão ∩ operação, com recorte de
 * empresa/cliente quando a operação aponta para um recurso.
 */
export function decideAccess(input: {
  person: PersonAccess;
  grant: IntegrationGrant;
  operation: IntegrationCapability;
  companyId?: string | null;
  clientId?: string | null;
  clientCompanyId?: string | null;
  now?: Date;
}): AccessDecision {
  const { person, grant, operation, now } = input;
  if (!person.isActive) return { allowed: false, reason: 'owner_inactive' };
  if (person.userId !== grant.ownerId) return { allowed: false, reason: 'owner_mismatch' };
  if (!grantIsLive(grant, now)) return { allowed: false, reason: 'grant_inactive' };
  if (!grant.capabilities.includes(operation)) return { allowed: false, reason: 'capability' };
  if (input.clientId) {
    if (!clientAllowed(person, grant, input.clientId, input.clientCompanyId ?? null)) {
      return { allowed: false, reason: 'client' };
    }
  } else if (input.companyId) {
    if (!companyAllowed(effectiveCompanies(person, grant), input.companyId)) {
      return { allowed: false, reason: 'company' };
    }
  }
  return { allowed: true };
}

/**
 * Tarefa visível não revela relação cuja leitura não foi concedida.
 * O identificador e o título ficam: são a própria tarefa.
 */
export function projectTask(
  task: TaskProjectionInput,
  capabilities: ReadonlySet<IntegrationCapability> | readonly IntegrationCapability[],
): TaskProjection {
  const caps = capabilities instanceof Set ? capabilities : new Set(capabilities);
  return {
    id: task.id,
    title: task.title,
    client: caps.has('clients:read') ? (task.client ?? null) : null,
    people: caps.has('people:read') ? (task.people ?? null) : null,
    comments: caps.has('comments:read') ? (task.comments ?? null) : null,
  };
}

export async function hashAutomationSecret(secret: string): Promise<string> {
  if (secret.length < 32) {
    throw new Error('A credencial de automação precisa de pelo menos 32 caracteres.');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyAutomationSecret(secret: string, storedHash: string): Promise<boolean> {
  let candidate: string;
  try {
    candidate = await hashAutomationSecret(secret);
  } catch {
    candidate = '0'.repeat(storedHash.length);
  }
  if (candidate.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) {
    diff |= candidate.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return diff === 0;
}

export function asIntegrationActor(
  owner: { userId: string; isSuperadmin: boolean; isSuper: boolean },
  integration: IntegrationContext,
): Actor {
  const actor = userActor({
    userId: owner.userId,
    isSuperadmin: owner.isSuperadmin,
    isSuper: owner.isSuper,
    integration,
  });
  assertIntegrationActor(actor);
  return actor;
}

/**
 * Frase em português que descreve o que o agente poderá fazer com cada
 * capacidade. Quem autoriza é uma pessoa da agência, não quem escreveu o
 * contrato: o nome técnico continua visível, mas em segundo plano.
 *
 * A frase tem de ser HONESTA sobre o que a leitura mostra hoje — quem marca a
 * caixa decide por ela. Quando uma ferramenta passa a devolver mais (a ficha do
 * cliente, o calendário, os links e o histórico da tarefa, quem fez o quê), a
 * frase da capacidade que a libera muda junto. Cada uma vira uma caixa de
 * seleção: curta, sem aspas retas, `&` nem `<` (a página os escapa e a frase
 * deixaria de aparecer como foi escrita); `handler.test.ts` prende isso.
 *
 * O tipo é `Record<IntegrationCapability, string>` de propósito: acrescentar
 * uma capacidade sem escrever o rótulo quebra o typecheck, em vez de a tela
 * passar a mostrar um nome cru em silêncio.
 */
export const CAPABILITY_LABELS: Record<IntegrationCapability, string> = {
  'boards:read': 'Ver os quadros e suas listas',
  'tasks:read': 'Ver as tarefas e tudo da ficha: links (Dropbox, Docs), checklists e o histórico completo de movimentação',
  'clients:read':
    'Ver os clientes (a lista toda): plano, início e renovação, urgência, cota contratada por tipo, etiquetas, mural, histórico e o cliente de cada tarefa',
  'people:read': 'Ver os nomes de quem está envolvido, inclusive quem fez o quê e quando no histórico de cada tarefa',
  'comments:read': 'Ler os comentários das tarefas',
  'reports:delivery:read':
    'Ver o relatório de entrega, as peças do mês, o calendário (entregas e título e hora dos compromissos) e quem marcou “Planejamento OK” e “Cliente aprovou”',
  'reports:marketing:read': 'Ver o relatório de marketing',
  'comments:write': 'Comentar nas tarefas',
  'tasks:move': 'Mover tarefas entre listas',
  'tasks:write': 'Criar e editar tarefas',
  'tasks:assign': 'Definir os responsáveis das tarefas',
  'tasks:complete': 'Concluir e reabrir tarefas',
  'clients:mural:write': 'Escrever notas no mural do cliente',
  'clients:history:write': 'Registrar fatos no histórico do cliente',
};

/**
 * Por que a leitura vem junto — uma linha por escrita, mostrada na hora em
 * que a tela marca as dependências. Mesmo motivo do tipo acima: capacidade
 * de escrita nova sem explicação quebra o typecheck.
 */
export const WRITE_DEPENDENCY_REASONS: Record<(typeof WRITE_CAPABILITIES)[number], string> = {
  'comments:write': 'Quem comenta precisa ler a tarefa e a conversa que já está lá — senão comenta sem ver.',
  'tasks:move': 'Quem move uma tarefa precisa ver a tarefa e o quadro para onde ela vai.',
  'tasks:write': 'Quem cria ou edita uma tarefa precisa ver as tarefas e o quadro onde ela fica.',
  'tasks:assign': 'Quem define responsáveis precisa ver a tarefa e o quadro dela — senão atribui às cegas.',
  'tasks:complete': 'Quem conclui ou reabre uma tarefa precisa ver a tarefa e o quadro dela.',
  'clients:mural:write': 'Quem escreve no mural precisa ver o cliente — senão escreve sem saber de quem é.',
  'clients:history:write': 'Quem registra no histórico precisa ver o cliente — senão registra sem saber de quem é.',
};
