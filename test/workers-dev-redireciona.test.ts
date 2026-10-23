/**
 * O ENDEREÇO `*.workers.dev` SÓ ATENDE MÁQUINA — F44, Fase 9.
 *
 * `workers_dev = true` continua no `wrangler.toml` (seguro contra rota que falha
 * no deploy; agentes de IA ainda conectam por ele). Página pedida por esse host
 * vai para o endereço próprio (`IDEWORKS_PUBLIC_ORIGIN`) com 301, mesmo caminho e mesma query. API, MCP,
 * OAuth e `.well-known` NÃO são redirecionados.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import worker from '../worker/index';

vi.mock('@/server/db', async (original) => ({
  ...(await original<typeof import('@/server/db')>()),
  connect: () => ({ end: async () => {} }),
}));

const paginas: string[] = [];
const AMBIENTE = {
  IDEWORKS_PUBLIC_SUPABASE_URL: 'https://provider.invalid',
  IDEWORKS_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
  IDEWORKS_PUBLIC_ORIGIN: 'https://works.exemplo.com.br',
  ASSETS: {
    fetch: async (r: Request) => {
      paginas.push(new URL(r.url).pathname);
      return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    },
  },
} as unknown as Parameters<typeof worker.fetch>[1];

const ANTIGO = 'https://ide-works.exemplo.workers.dev';

async function pedir(url: string, init?: RequestInit, ambiente = AMBIENTE) {
  paginas.length = 0;
  return worker.fetch(new Request(url, init), ambiente);
}

describe('sem domínio próprio configurado', () => {
  it('o workers.dev serve a página, sem redirecionar', async () => {
    const semDominio = { ...AMBIENTE, IDEWORKS_PUBLIC_ORIGIN: '' } as typeof AMBIENTE;
    const r = await pedir(`${ANTIGO}/painel`, undefined, semDominio);
    expect(r.status).toBe(200);
    expect(paginas).toEqual(['/painel']);
  });
});

describe('página pelo host workers.dev', () => {
  it('GET de página vai com 301, mantendo caminho e query', async () => {
    const r = await pedir(`${ANTIGO}/cliente/42?aba=metas`);
    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toBe('https://works.exemplo.com.br/cliente/42?aba=metas');
    expect(paginas).toHaveLength(0);
  });

  it('a raiz e o HEAD também', async () => {
    expect((await pedir(`${ANTIGO}/`)).headers.get('location')).toBe('https://works.exemplo.com.br/');
    const head = await pedir(`${ANTIGO}/painel`, { method: 'HEAD' });
    expect(head.status).toBe(301);
  });

  it('a página do cliente (/aprovar/:token) também segue para o endereço próprio', async () => {
    const r = await pedir(`${ANTIGO}/aprovar/abc`);
    expect(r.headers.get('location')).toBe('https://works.exemplo.com.br/aprovar/abc');
  });

  it.each([
    '/api/health',
    '/api/meta/collect',
    '/mcp',
    '/mcp/x',
    '/oauth/authorize',
    '/oauth/token',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource/mcp',
  ])('%s continua vivo no workers.dev (sem 301)', async (caminho) => {
    const r = await pedir(`${ANTIGO}${caminho}`);
    expect(r.status).not.toBe(301);
    expect(r.headers.get('location')).toBeNull();
  });

  it('POST em página não é redirecionado (só navegação)', async () => {
    const r = await pedir(`${ANTIGO}/painel`, { method: 'POST' });
    expect(r.status).not.toBe(301);
  });
});

describe('página pelo endereço próprio ou local', () => {
  it.each(['https://works.exemplo.com.br/painel', 'http://localhost:8787/painel'])(
    '%s é servida pelo site, sem redirecionar',
    async (url) => {
      const r = await pedir(url);
      expect(r.status).toBe(200);
      expect(paginas).toEqual(['/painel']);
    },
  );
});

describe('wrangler.toml', () => {
  const toml = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'wrangler.toml'),
    'utf8',
  );

  it('mantém workers_dev ligado', () => {
    expect(toml).toMatch(/^workers_dev = true$/m);
  });

  it('manda as páginas para o Worker antes dos arquivos (menos /assets/*)', () => {
    const lista = /run_worker_first = \[([^\]]*)\]/.exec(toml)?.[1] ?? '';
    expect(lista).toContain('"/*"');
    expect(lista).toContain('"!/assets/*"');
  });
});
