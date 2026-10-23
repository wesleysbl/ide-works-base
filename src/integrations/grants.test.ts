/**
 * Interseção e projeção das concessões — F16.1.
 *
 * A suíte não fala com o banco (F0.4). Políticas reais ficam em
 * `scripts/provar-concessoes.mjs`. Aqui cabe o recorte que a ficha da
 * tarefa e o ator de integração precisam acertar sem rede.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { assertIntegrationActor } from '@/server/db';
import {
  CAPABILITY_LABELS,
  INTEGRATION_CAPABILITIES,
  READ_CAPABILITIES,
  WRITE_CAPABILITIES,
  WRITE_DEPENDENCY_REASONS,
  WRITE_REQUIRES_READ,
  allowsOperation,
  asIntegrationActor,
  assertWriteImpliesRead,
  clientAllowed,
  decideAccess,
  effectiveCapabilities,
  effectiveCompanies,
  grantIsLive,
  hashAutomationSecret,
  projectTask,
  verifyAutomationSecret,
  type IntegrationGrant,
  type PersonAccess,
  type TaskProjectionInput,
} from '@/integrations/grants';

const agora = new Date('2026-09-20T23:54:00-03:00');

const admin: PersonAccess = {
  userId: 'owner-admin',
  isActive: true,
  isSuperadmin: true,
  isSuper: false,
  companyIds: ['empresa-a', 'empresa-b'],
  clientIds: ['cliente-a', 'cliente-b'],
  hasAllClientsAccess: false,
};

const funcionario: PersonAccess = {
  ...admin,
  userId: 'owner-func',
  isSuperadmin: false,
  companyIds: ['empresa-a'],
  clientIds: ['cliente-a'],
};

const leitura: IntegrationGrant = {
  id: 'grant-leitura',
  ownerId: admin.userId,
  oauthClientId: 'ideworks-claude',
  name: 'Claude da agência',
  capabilities: [...READ_CAPABILITIES],
  allowedCompanyIds: ['empresa-a'],
  allowedClientIds: null,
  expiresAt: null,
  revokedAt: null,
  policyVersion: 1,
};

const tarefa: TaskProjectionInput = {
  id: 'tarefa-1',
  title: 'Peça da campanha',
  client: { id: 'cliente-a', name: 'Jatobá' },
  people: [{ id: 'pessoa-1', name: 'Helena' }],
  comments: [{ id: 'c1', body: 'Link da entrega' }],
};

describe('o contrato fecha as catorze capacidades', () => {
  // As nove da F16 e, depois delas, as cinco da F26 — a mesma ordem do enum do
  // banco (ver "o enum do banco" no fim).
  it('são exatamente os nomes combinados na F16 e na F26', () => {
    expect([...INTEGRATION_CAPABILITIES]).toEqual([
      'boards:read',
      'tasks:read',
      'clients:read',
      'people:read',
      'comments:read',
      'reports:delivery:read',
      'reports:marketing:read',
      'comments:write',
      'tasks:move',
      'tasks:write',
      'tasks:assign',
      'tasks:complete',
      'clients:mural:write',
      'clients:history:write',
    ]);
  });

  it('toda escrita tem a leitura exigida, e as cinco da F26 seguem o banco', () => {
    expect(Object.keys(WRITE_REQUIRES_READ).sort()).toEqual([...WRITE_CAPABILITIES].sort());
    for (const write of ['tasks:write', 'tasks:assign', 'tasks:complete'] as const) {
      expect(WRITE_REQUIRES_READ[write]).toEqual(['tasks:read', 'boards:read']);
      expect(() => assertWriteImpliesRead([write])).toThrow(/tasks:read e boards:read/);
      expect(() => assertWriteImpliesRead([write, 'tasks:read'])).toThrow(/boards:read/);
      expect(() => assertWriteImpliesRead([write, 'tasks:read', 'boards:read'])).not.toThrow();
    }
    for (const write of ['clients:mural:write', 'clients:history:write'] as const) {
      expect(WRITE_REQUIRES_READ[write]).toEqual(['clients:read']);
      expect(() => assertWriteImpliesRead([write])).toThrow(/clients:read/);
      expect(() => assertWriteImpliesRead([write, 'clients:read'])).not.toThrow();
    }
  });

  it('nenhuma capacidade nova vem sem frase e sem motivo', () => {
    for (const cap of INTEGRATION_CAPABILITIES) {
      expect(CAPABILITY_LABELS[cap], cap).toBeTruthy();
      expect(CAPABILITY_LABELS[cap]).not.toBe(cap);
    }
    for (const write of WRITE_CAPABILITIES) {
      expect(WRITE_DEPENDENCY_REASONS[write], write).toMatch(/^Quem .+\.$/);
    }
    // Leitura não entra em WRITE_CAPABILITIES; escrita não entra em READ.
    for (const read of READ_CAPABILITIES) {
      expect((WRITE_CAPABILITIES as readonly string[]).includes(read)).toBe(false);
    }
    expect(READ_CAPABILITIES.length + WRITE_CAPABILITIES.length).toBe(INTEGRATION_CAPABILITIES.length);
  });

  it('escrita exige a leitura do recurso — e a recusa é explícita', () => {
    expect(() => assertWriteImpliesRead(['comments:write'])).toThrow(/comments:read/);
    expect(() => assertWriteImpliesRead(['comments:write', 'comments:read'])).toThrow(/tasks:read/);
    expect(() => assertWriteImpliesRead(['tasks:move', 'tasks:read'])).toThrow(/boards:read/);
    expect(() =>
      assertWriteImpliesRead(['comments:write', 'comments:read', 'tasks:read']),
    ).not.toThrow();
    expect(() => assertWriteImpliesRead(['tasks:move', 'tasks:read', 'boards:read'])).not.toThrow();
    expect(WRITE_REQUIRES_READ['comments:write']).toEqual(['comments:read', 'tasks:read']);
    expect(WRITE_REQUIRES_READ['tasks:move']).toEqual(['tasks:read', 'boards:read']);
  });
});

describe('concessão só-leitura nunca autoriza mutação', () => {
  it('comments:write e tasks:move ficam de fora mesmo com dono administrador', () => {
    expect(allowsOperation(admin, leitura, 'comments:write', agora)).toBe(false);
    expect(allowsOperation(admin, leitura, 'tasks:move', agora)).toBe(false);
    expect(allowsOperation(admin, leitura, 'tasks:read', agora)).toBe(true);
    expect(allowsOperation(admin, leitura, 'boards:read', agora)).toBe(true);
    expect(decideAccess({ person: admin, grant: leitura, operation: 'comments:write', now: agora })).toEqual({
      allowed: false,
      reason: 'capability',
    });
    expect(decideAccess({ person: admin, grant: leitura, operation: 'tasks:move', now: agora })).toEqual({
      allowed: false,
      reason: 'capability',
    });
  });
});

describe('administrador com concessão restrita não amplia o agente', () => {
  it('o papel não entra no conjunto efetivo de capacidades', () => {
    const caps = effectiveCapabilities(admin, leitura, agora);
    expect(caps.has('tasks:read')).toBe(true);
    expect(caps.has('comments:write')).toBe(false);
    expect(caps.has('tasks:move')).toBe(false);
    // isSuperadmin verdadeiro na pessoa, ausente no agente
    expect(admin.isSuperadmin).toBe(true);
    expect(caps.size).toBe(READ_CAPABILITIES.length);
  });

  it('super admin com só-leitura também não move nem comenta', () => {
    const topo: PersonAccess = { ...admin, isSuper: true, companyIds: [] };
    const grant: IntegrationGrant = { ...leitura, ownerId: topo.userId, allowedCompanyIds: ['empresa-a'] };
    expect(allowsOperation(topo, grant, 'tasks:move', agora)).toBe(false);
    expect(allowsOperation(topo, grant, 'comments:write', agora)).toBe(false);
    expect(
      decideAccess({
        person: topo,
        grant,
        operation: 'tasks:read',
        companyId: 'empresa-a',
        now: agora,
      }).allowed,
    ).toBe(true);
    expect(
      decideAccess({
        person: topo,
        grant,
        operation: 'tasks:read',
        companyId: 'empresa-outra',
        now: agora,
      }),
    ).toEqual({ allowed: false, reason: 'company' });
  });
});

describe('a mesma concessão perde a empresa quando o responsável perde o acesso', () => {
  it('allowlist intacta não sobrevive à ficha sem a empresa', () => {
    const grant: IntegrationGrant = {
      ...leitura,
      ownerId: funcionario.userId,
      allowedCompanyIds: ['empresa-a'],
    };
    expect(effectiveCompanies(funcionario, grant)).toEqual({
      kind: 'ids',
      ids: new Set(['empresa-a']),
    });
    expect(
      decideAccess({
        person: funcionario,
        grant,
        operation: 'tasks:read',
        companyId: 'empresa-a',
        now: agora,
      }).allowed,
    ).toBe(true);

    const semEmpresa: PersonAccess = { ...funcionario, companyIds: [] };
    expect(effectiveCompanies(semEmpresa, grant)).toEqual({ kind: 'none' });
    expect(
      decideAccess({
        person: semEmpresa,
        grant,
        operation: 'tasks:read',
        companyId: 'empresa-a',
        now: agora,
      }),
    ).toEqual({ allowed: false, reason: 'company' });
  });

  it('empresa que nunca foi da pessoa não entra pela concessão', () => {
    const grant: IntegrationGrant = {
      ...leitura,
      ownerId: funcionario.userId,
      allowedCompanyIds: ['empresa-b'],
    };
    expect(effectiveCompanies(funcionario, grant)).toEqual({ kind: 'none' });
  });
});

describe('tarefa visível não vaza relação não concedida', () => {
  it('sem clients/people/comments:read os três campos saem nulos', () => {
    const projetada = projectTask(tarefa, ['tasks:read', 'boards:read']);
    expect(projetada).toEqual({
      id: 'tarefa-1',
      title: 'Peça da campanha',
      client: null,
      people: null,
      comments: null,
    });
  });

  it('cada leitura revela só a relação dela', () => {
    expect(projectTask(tarefa, ['tasks:read', 'clients:read']).client).toEqual(tarefa.client);
    expect(projectTask(tarefa, ['tasks:read', 'clients:read']).people).toBeNull();
    expect(projectTask(tarefa, ['tasks:read', 'people:read']).people).toEqual(tarefa.people);
    expect(projectTask(tarefa, ['tasks:read', 'people:read']).comments).toBeNull();
    expect(projectTask(tarefa, ['tasks:read', 'comments:read']).comments).toEqual(tarefa.comments);
    expect(projectTask(tarefa, ['tasks:read', 'comments:read']).client).toBeNull();
  });

  it('relação ausente na origem continua nula mesmo com a leitura concedida', () => {
    expect(projectTask({ id: 't', title: 'x' }, READ_CAPABILITIES)).toEqual({
      id: 't',
      title: 'x',
      client: null,
      people: null,
      comments: null,
    });
  });
});

describe('concessão morta ou dono errado não autoriza nada', () => {
  it('revogada, vencida, dono outro ou desativado devolvem conjunto vazio', () => {
    expect(grantIsLive({ ...leitura, revokedAt: agora }, agora)).toBe(false);
    expect(grantIsLive({ ...leitura, expiresAt: agora }, agora)).toBe(false);
    expect(effectiveCapabilities({ ...admin, isActive: false }, leitura, agora).size).toBe(0);
    expect(effectiveCapabilities(funcionario, leitura, agora).size).toBe(0);
    const morta = decideAccess({
      person: admin,
      grant: { ...leitura, revokedAt: agora },
      operation: 'tasks:read',
      now: agora,
    });
    expect(morta.allowed).toBe(false);
    if (!morta.allowed) expect(morta.reason).toBe('grant_inactive');
  });

  it('cliente some junto quando a empresa some, mesmo com o id na allowlist', () => {
    const grant: IntegrationGrant = {
      ...leitura,
      ownerId: funcionario.userId,
      allowedCompanyIds: ['empresa-a'],
      allowedClientIds: ['cliente-a'],
    };
    expect(clientAllowed(funcionario, grant, 'cliente-a', 'empresa-a')).toBe(true);
    expect(
      clientAllowed({ ...funcionario, companyIds: [], clientIds: [] }, grant, 'cliente-a', 'empresa-a'),
    ).toBe(false);
  });
});

describe('credencial de automação guarda só o verificador', () => {
  it('a impressão digital tem 64 hex e não contém o segredo', async () => {
    const segredo = 'a'.repeat(32);
    const hash = await hashAutomationSecret(segredo);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(segredo);
    expect(await verifyAutomationSecret(segredo, hash)).toBe(true);
    expect(await verifyAutomationSecret(`${segredo}x`, hash)).toBe(false);
  });

  it('segredo curto é recusado — hash de lixo não vira credencial', async () => {
    await expect(hashAutomationSecret('curto')).rejects.toThrow(/32/);
  });
});

describe('ator de integração: proprietário ≠ origem', () => {
  it('humano sem concessão não lança — o withActor antigo continua válido', () => {
    expect(() =>
      assertIntegrationActor({
        kind: 'user',
        userId: 'u1',
        isSuperadmin: true,
        isSuper: false,
      }),
    ).not.toThrow();
  });

  it('recusa proprietário diferente da pessoa que age', () => {
    expect(() =>
      asIntegrationActor(
        { userId: 'u1', isSuperadmin: false, isSuper: false },
        { integrationId: 'g', grantId: 'g', ownerId: 'u2', origin: 'mcp' },
      ),
    ).toThrow(/proprietário/);
  });

  it('origem viaja junto e distinta do dono', () => {
    const ator = asIntegrationActor(
      { userId: 'u1', isSuperadmin: true, isSuper: false },
      { integrationId: 'g', grantId: 'g', ownerId: 'u1', origin: 'automation' },
    );
    expect(ator.kind).toBe('user');
    if (ator.kind !== 'user') return;
    expect(ator.userId).toBe('u1');
    expect(ator.integration?.origin).toBe('automation');
    expect(ator.integration?.ownerId).toBe(ator.userId);
  });
});

describe('migration F16.2b fica no schema do IDE Works', () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const nome = '20260921034400_ideworks_f16b_limites.sql';
  const sql = readFileSync(join(raiz, 'supabase', 'migrations', nome), 'utf8');
  const rollback = readFileSync(join(raiz, 'supabase', 'rollback', nome), 'utf8');

  it('o nome casa com o teste de par e com o regex da fase', () => {
    expect(nome).toMatch(/^\d{14}_ideworks_f\d+[a-z]*_/);
    expect(rollback.length).toBeGreaterThan(100);
    expect(rollback).toContain('drop table if exists ideworks.integration_rate_events');
    expect(rollback).toContain('drop function if exists ideworks.lookup_live_automation_credential(text)');
  });

  it('não toca no legado nem cria conta no Auth', () => {
    expect(sql).not.toMatch(/insert\s+into\s+auth\./i);
    expect(sql).not.toMatch(/create\s+user/i);
    expect(sql).not.toMatch(/\bpublic\.\w+/);
    expect(sql).toContain('create table ideworks.integration_rate_events');
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('lookup_live_automation_credential');
    expect(sql).toContain('grant execute');
    expect(sql).toContain('ideworks_app');
  });
});

describe('migration fica no schema do IDE Works', () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const nome = '20260920235400_ideworks_f16a_concessoes.sql';
  const sql = readFileSync(join(raiz, 'supabase', 'migrations', nome), 'utf8');
  const rollback = readFileSync(join(raiz, 'supabase', 'rollback', nome), 'utf8');

  it('o nome casa com o teste de par e com o regex da fase', () => {
    expect(nome).toMatch(/^\d{14}_ideworks_f\d+[a-z]*_/);
    expect(rollback.length).toBeGreaterThan(100);
  });

  it('não toca no legado nem cria conta no Auth', () => {
    expect(sql).not.toMatch(/insert\s+into\s+auth\./i);
    expect(sql).not.toMatch(/create\s+user/i);
    expect(sql).not.toMatch(/\bpublic\.\w+/);
    expect(sql).toContain('create table ideworks.integration_grants');
    expect(sql).toContain('create table ideworks.integration_credentials');
  });

  it('as nove capacidades da F16 estão no enum que esta migration cria', () => {
    // As cinco da F26 entram por `alter type` na F26.1 — ver "o enum do banco".
    for (const cap of INTEGRATION_CAPABILITIES.slice(0, 9)) {
      expect(sql).toContain(`'${cap}'`);
    }
  });

  it('guarda verificador, não segredo em claro', () => {
    expect(sql).toContain('secret_verifier');
    expect(sql).toContain('^[0-9a-f]{64}$');
    expect(sql).not.toMatch(/secret_plain|token_plain|secret text not null/);
  });
});

/**
 * O enum do banco é a soma de TODAS as migrations: o `create type` da F16.1 e
 * cada `alter type ... add value` depois dele. Ler só a f16a — como o teste
 * acima faz — não enxerga a F26.1, e uma migration futura que acrescente
 * permissão passaria em silêncio.
 */
describe('o enum do banco e a lista do contrato', () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const pasta = join(raiz, 'supabase', 'migrations');
  const F26_1 = '20260922290000_ideworks_f26_1_permissoes_e_operacoes_da_ia.sql';

  const enumDoBanco = (): string[] => {
    const valores: string[] = [];
    for (const nome of readdirSync(pasta).filter((n) => n.endsWith('.sql')).sort()) {
      const sql = readFileSync(join(pasta, nome), 'utf8');
      const criado = sql.match(
        /create\s+type\s+ideworks\.integration_capability\s+as\s+enum\s*\(([\s\S]*?)\);/i,
      );
      if (criado) {
        valores.splice(0, valores.length, ...[...criado[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
      }
      for (const m of sql.matchAll(
        /alter\s+type\s+ideworks\.integration_capability\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'([^']+)'/gi,
      )) {
        if (!valores.includes(m[1])) valores.push(m[1]);
      }
    }
    return valores;
  };

  /** As cinco que a F26.1 acrescentou ao enum e a F26 fase 4 levou ao consentimento. */
  const CINCO_DA_F26 = [
    'tasks:write',
    'tasks:assign',
    'tasks:complete',
    'clients:mural:write',
    'clients:history:write',
  ];

  it('o banco tem as catorze, as nove da F16 primeiro', () => {
    expect(enumDoBanco()).toEqual([
      'boards:read',
      'tasks:read',
      'clients:read',
      'people:read',
      'comments:read',
      'reports:delivery:read',
      'reports:marketing:read',
      'comments:write',
      'tasks:move',
      'tasks:write',
      'tasks:assign',
      'tasks:complete',
      'clients:mural:write',
      'clients:history:write',
    ]);
  });

  it('o contrato é exatamente o enum do banco, na mesma ordem', () => {
    // Nada fica guardado "para depois": capacidade que o banco aceita e o
    // consentimento não oferece, ou o contrário, quebra aqui.
    expect([...INTEGRATION_CAPABILITIES]).toEqual(enumDoBanco());
    expect(INTEGRATION_CAPABILITIES.slice(9)).toEqual(CINCO_DA_F26);
  });

  describe('migration F26.1', () => {
    const sql = readFileSync(join(pasta, F26_1), 'utf8');
    const rollback = readFileSync(join(raiz, 'supabase', 'rollback', F26_1), 'utf8');

    it('o nome casa com o teste de par e com o regex da fase', () => {
      expect(F26_1).toMatch(/^\d{14}_ideworks_f\d+[a-z]*_/);
      expect(rollback.length).toBeGreaterThan(100);
    });

    it('não toca no legado nem cria conta no Auth', () => {
      expect(sql).not.toMatch(/insert\s+into\s+auth\./i);
      expect(sql).not.toMatch(/create\s+user/i);
      expect(sql).not.toMatch(/\bpublic\.\w+/);
      expect(rollback).not.toMatch(/\bpublic\.\w+/);
    });

    it('não usa valor novo do enum na mesma transação (55P04)', () => {
      // O CHECK compara texto. Um literal `'tasks:write'::ideworks.integration_capability`
      // quebraria a migration inteira com "unsafe use of new value". O cabeçalho
      // cita esse literal para explicar o motivo — por isso os comentários saem.
      const codigo = sql.replace(/--.*$/gm, '');
      for (const cap of CINCO_DA_F26) {
        expect(codigo).not.toContain(`'${cap}'::ideworks.integration_capability`);
        expect(codigo).not.toContain(`'${cap}'::integration_capability`);
      }
      expect(codigo).toContain('capabilities::text[]');
    });

    it('as nove operações novas entram no registro e nas aprovações, e as duas antigas ficam', () => {
      const operacoes = [
        'add_comment',
        'move_task',
        'create_task',
        'update_task',
        'assign_task',
        'complete_task',
        'reopen_task',
        'add_mural_note',
        'update_mural_note',
        'add_history_entry',
        'update_history_entry',
      ];
      for (const constraint of [
        'integration_executions_operation_sane',
        'integration_write_approvals_operation_sane',
      ]) {
        const trecho = sql.match(
          new RegExp(`add constraint ${constraint} check \\(([\\s\\S]*?)\\n  \\);`),
        );
        expect(trecho, constraint).not.toBeNull();
        const citadas = [...(trecho?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
        expect(citadas, constraint).toEqual(operacoes);
      }
    });

    it('não afrouxa o alvo nem o registro compacto', () => {
      expect(sql).not.toMatch(/target_id/i);
      expect(sql).not.toMatch(/result_compact/i);
    });

    it('o rollback recria o tipo com as nove e refaz a conferência da credencial', () => {
      expect(rollback).toContain('create type ideworks.integration_capability_f16 as enum');
      expect(rollback).toContain('drop type ideworks.integration_capability;');
      expect(rollback).toContain('create function ideworks.lookup_live_automation_credential(p_verifier text)');
      expect(rollback).toContain(
        'grant execute on function ideworks.lookup_live_automation_credential(text) to ideworks_app',
      );
      expect(rollback).not.toMatch(/delete\s+from\s+ideworks\.integration_executions/i);
      expect(rollback).not.toMatch(/drop\s+table/i);
    });
  });
});
