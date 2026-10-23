import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  type Principal,
  PUBLIC_ROUTES,
  SERVICE_KEY_ALLOWLIST,
  authorize,
} from '@/auth/authorization';

const membro: Principal = { userId: 'u1', role: 'member', isActive: true };
const admin: Principal = { userId: 'u2', role: 'superadmin', isActive: true };

describe('segunda barreira — o papel', () => {
  it('sem crachá é 401, não 403 — a distinção importa para quem depura', () => {
    const v = authorize(null);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.status).toBe(401);
  });

  it('membro entra em rota comum', () => {
    expect(authorize(membro).ok).toBe(true);
  });

  it('membro é barrado em rota de administração, com 403', () => {
    const v = authorize(membro, 'superadmin');
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.status).toBe(403);
      expect(v.reason).toBe('insufficient_role');
    }
  });

  it('administrador entra em rota de administração', () => {
    expect(authorize(admin, 'superadmin').ok).toBe(true);
  });

  it('administrador também entra em rota comum', () => {
    expect(authorize(admin).ok).toBe(true);
  });
});

describe('conta desativada é barrada em TODA rota, não só no login', () => {
  // Quem foi cortado enquanto navegava não deve seguir navegando até o crachá
  // vencer sozinho.
  const cortado: Principal = { ...membro, isActive: false };

  it('barra em rota comum', () => {
    const v = authorize(cortado);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('account_disabled');
  });

  it('barra administrador desativado em rota de administração', () => {
    const v = authorize({ ...admin, isActive: false }, 'superadmin');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('account_disabled');
  });

  it('o motivo é distinto de falta de permissão — são problemas diferentes', () => {
    const desativado = authorize({ ...membro, isActive: false }, 'superadmin');
    const semPapel = authorize(membro, 'superadmin');
    expect(desativado.ok).toBe(false);
    expect(semPapel.ok).toBe(false);
    if (!desativado.ok && !semPapel.ok) expect(desativado.reason).not.toBe(semPapel.reason);
  });

  it('desativado é conferido ANTES do papel — o corte vale para todos', () => {
    const v = authorize({ ...membro, isActive: false }, 'superadmin');
    if (!v.ok) expect(v.reason).toBe('account_disabled');
  });
});

describe('lista fechada da chave-mestra', () => {
  it('toda entrada tem justificativa escrita', () => {
    for (const item of SERVICE_KEY_ALLOWLIST) {
      expect(item.why.length).toBeGreaterThan(20);
    }
  });

  it('nenhum arquivo fora da lista usa a chave-mestra', () => {
    const permitidos = new Set(SERVICE_KEY_ALLOWLIST.map((i) => i.path.replace(/\\/g, '/')));
    const raiz = join(import.meta.dirname, '..', '..');

    const varrer = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const cheio = join(dir, e.name);
        if (e.isDirectory()) return e.name === 'node_modules' ? [] : varrer(cheio);
        return /\.(ts|tsx)$/.test(e.name) && !e.name.includes('.test.') ? [cheio] : [];
      });

    const infratores = varrer(join(raiz, 'src')).filter((arquivo) => {
      const relativo = arquivo.replace(/\\/g, '/').slice(raiz.replace(/\\/g, '/').length + 1);
      if (permitidos.has(relativo)) return false;
      return /service_role|SERVICE_ROLE|serviceRoleKey/.test(readFileSync(arquivo, 'utf8'));
    });

    expect(infratores).toEqual([]);
  });
});

describe('lista fechada de rotas públicas', () => {
  it('toda rota pública tem justificativa escrita', () => {
    for (const item of PUBLIC_ROUTES) {
      expect(item.why.length).toBeGreaterThan(20);
    }
  });

  it('só as nove esperadas são públicas', () => {
    // A quarta entrou na F17.31, e o número aqui é o freio: uma rota pública a
    // mais tem que passar por esta linha, e por quem a lê. A quinta é o link
    // de aprovação do cliente (F42, Fase 3); as quatro seguintes são o resto da
    // API do cliente sob o mesmo token (F42, Fase 5).
    expect(PUBLIC_ROUTES.map((r) => r.route).sort()).toEqual([
      'GET /health',
      'GET /public/aprovacao/:token',
      'GET /public/aprovacao/:token/chamadas/:id',
      'POST /auth/activate',
      'POST /auth/login',
      'POST /auth/reset-password',
      'POST /public/aprovacao/:token/chamadas/:id/aprovar',
      'POST /public/aprovacao/:token/chamadas/:id/comentarios',
      'POST /public/aprovacao/:token/chamadas/:id/reprovar',
    ]);
  });

  it('nenhuma rota de administração está na lista pública', () => {
    for (const item of PUBLIC_ROUTES) {
      expect(item.route).not.toMatch(/admin/i);
    }
  });
});
