/**
 * A BORDA DA API HUMANA, DO PONTO DE VISTA DE QUEM ATACA — revisão de segurança de 09/10/2026.
 *
 * O Worker de verdade (`worker.fetch`), com o provedor e o banco dublê no desenho
 * de `entradas-invalidas-rotas.test.ts`. O dublê registra o que foi consultado
 * (fora o perfil) para provar que a recusa acontece ANTES do banco.
 *
 * O QUE SE PROVA
 *   · pedido que muda estado e vem de outra origem é recusado (403), com ou sem
 *     cookie de sessão — o cookie é `SameSite=Strict`, mas "mesmo site" inclui
 *     qualquer outro subdomínio do domínio;
 *   · toda resposta JSON da API é `no-store` (dado por pessoa e endereço assinado);
 *   · envio de arquivo e corpo JSON acima do teto são recusados ANTES de entrar na
 *     memória do Worker — com `Content-Length` e, sem ele, contando o que chega —,
 *     inclusive nas portas que não pedem sessão;
 *   · corpo JSON `null` e campo do tipo errado nas portas públicas são 400, e
 *     não o 500 de um `TypeError`; texto torto que só o Postgres enxerga (`22P02`
 *     e família) também;
 *   · rota que escreve "o que falta" (áreas, carteira, papel, `ativo`, acesso do
 *     nó, etiquetas, dono da conta, mãe e cliente da tarefa) exige o campo dito:
 *     ausência não vira "apague tudo";
 *   · a recusa do banco não vaza nome de tabela, de função nem de restrição;
 *   · as portas de administração que conferem o papel NO CÓDIGO recusam quem não
 *     administra sem consultar o banco.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import worker from '../worker/index';

const PESSOA = '00000000-0000-0000-0000-0000000000a1';
const CLIENTE = '00000000-0000-0000-0000-00000000c001';
const TAREFA = '00000000-0000-0000-0000-00000000ba5e';

const consultas: string[] = [];
let idasAoProvedor = 0;
/** O que o dublê faz com uma consulta que não é do perfil. `undefined` = devolve vazio. */
let aoConsultar: ((texto: string, valores: unknown[]) => unknown[] | undefined) | null = null;
let perfil: Record<string, unknown>;

vi.mock('@/server/db', async (original) => ({
  ...(await original<typeof import('@/server/db')>()),
  connect: () => ({
    end: async () => {},
    begin: async (work: (tx: unknown) => Promise<unknown>) =>
      work(
        Object.assign(
          async (partes: TemplateStringsArray, ...valores: unknown[]) => {
            const texto = partes.join('?');
            if (texto.includes('set_config')) return [];
            if (texto.includes('from ideworks.profiles')) return [perfil];
            consultas.push(texto);
            return aoConsultar?.(texto, valores) ?? [];
          },
          { json: (valor: unknown) => valor },
        ),
      ),
  }),
}));

const env = {
  IDEWORKS_PUBLIC_SUPABASE_URL: 'https://provider.invalid',
  IDEWORKS_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
  IDEWORKS_SERVER_SUPABASE_SERVICE_KEY: 'service-key',
};

const PERFIL_DE_ADMIN = {
  id: PESSOA,
  email: 'admin@example.invalid',
  full_name: null,
  role: 'admin',
  is_superadmin: true,
  is_active: true,
  has_all_clients_access: true,
  areas: ['entrega', 'quadro', 'meta', 'catalogos', 'pessoas'],
};

type Pedido = { cabecalhos?: Record<string, string>; corpo?: unknown; bruto?: BodyInit };

const chamar = (metodo: string, caminho: string, { cabecalhos, corpo, bruto }: Pedido = {}) =>
  worker.fetch(
    new Request(`https://app.invalid/api${caminho}`, {
      method: metodo,
      headers: {
        Cookie: 'ideworks_sessao=test-access',
        'Content-Type': 'application/json',
        ...cabecalhos,
      },
      body: bruto ?? (corpo === undefined ? undefined : JSON.stringify(corpo)),
    }),
    env as never,
  );

let fetchOriginal: typeof fetch;

beforeEach(() => {
  consultas.length = 0;
  idasAoProvedor = 0;
  aoConsultar = null;
  perfil = { ...PERFIL_DE_ADMIN };
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (url === 'https://provider.invalid/auth/v1/user') {
      idasAoProvedor += 1;
      return new Response(JSON.stringify({ id: PESSOA, email: 'admin@example.invalid' }), { status: 200 });
    }
    return fetchOriginal(entrada, init);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

const mensagem = async (r: Response) => ((await r.json()) as { message: string }).message;

describe('CSRF: pedido que muda estado só vale se vier da página do app', () => {
  const FORA = 'https://sibling.example.invalid';

  it.each([
    ['POST', '/items', { clientId: CLIENTE, month: '2026-10-01', contentType: 'video' }],
    ['PUT', `/clients/${CLIENTE}/form`, {}],
    ['DELETE', `/items/${TAREFA}`, undefined],
    ['POST', '/auth/logout', undefined],
    ['POST', '/auth/login', { email: 'a@example.invalid', password: 'x' }],
  ])('%s %s de outra origem é 403, sem tocar no banco nem no provedor', async (metodo, caminho, corpo) => {
    const r = await chamar(metodo, caminho, { cabecalhos: { Origin: FORA }, corpo });
    expect(r.status).toBe(403);
    expect(await mensagem(r)).toMatch(/não veio da página/i);
    expect(consultas).toEqual([]);
    expect(idasAoProvedor).toBe(0);
  });

  it('`Origin: null` (iframe com sandbox, página data:) também é recusado', async () => {
    const r = await chamar('POST', '/items', { cabecalhos: { Origin: 'null' }, corpo: {} });
    expect(r.status).toBe(403);
  });

  it('a mesma origem do app passa (e cai nas recusas de sempre)', async () => {
    const r = await chamar('POST', '/items', { cabecalhos: { Origin: 'https://app.invalid' }, corpo: {} });
    expect(r.status).toBe(400); // faltou cliente, mês e tipo: a rota respondeu
  });

  it('chamada programática, sem Origin, continua passando', async () => {
    const r = await chamar('POST', '/items', { corpo: {} });
    expect(r.status).toBe(400);
  });

  it('leitura não é recusada por origem (o cookie nem viaja, e o navegador não deixa ler)', async () => {
    const r = await chamar('GET', '/team', { cabecalhos: { Origin: FORA } });
    expect(r.status).toBe(200);
  });

  it('em desenvolvimento, o front (:8080) fala com o Worker (:8787) por proxy', async () => {
    const r = await worker.fetch(
      new Request('http://127.0.0.1:8787/api/items', {
        method: 'POST',
        headers: {
          Cookie: 'ideworks_sessao=test-access',
          'Content-Type': 'application/json',
          Origin: 'http://localhost:8080',
        },
        body: '{}',
      }),
      env as never,
    );
    expect(r.status).toBe(400);
  });
});

describe('cache: nada que é de uma pessoa fica guardado no navegador nem no meio do caminho', () => {
  it.each([
    ['uma leitura da pessoa', 'GET', '/team', 200],
    ['a recusa de quem não tem sessão', 'GET', '/auth/me-que-nao-existe', 404],
    ['uma rota que não existe', 'GET', '/nada-aqui', 404],
  ])('%s: no-store e nosniff', async (_nome, metodo, caminho, status) => {
    const r = await chamar(metodo, caminho);
    expect(r.status).toBe(status);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('sem cookie também: o 401 não pode ser reaproveitado para quem chega depois', async () => {
    const r = await worker.fetch(new Request('https://app.invalid/api/team'), env as never);
    expect(r.status).toBe(401);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
  });

  it('o endereço assinado de um anexo nunca é cacheável', async () => {
    globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
      if (url === 'https://provider.invalid/auth/v1/user') {
        return new Response(JSON.stringify({ id: PESSOA, email: 'admin@example.invalid' }), { status: 200 });
      }
      if (url.includes('/storage/v1/object/sign/')) {
        return new Response(JSON.stringify({ signedURL: '/object/sign/ideworks-anexos/x?token=t' }), { status: 200 });
      }
      return fetchOriginal(entrada, init);
    }) as typeof fetch;
    aoConsultar = (texto) =>
      texto.includes('from ideworks.task_attachments')
        ? [{ storage_path: `${TAREFA}/a.png`, file_name: 'a.png', content_type: 'image/png' }]
        : undefined;

    const r = await chamar('GET', `/board/attachments/${TAREFA}/url`);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { url: string }).url).toContain('token=t');
    expect(r.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('envio de arquivo: o corpo grande é recusado ANTES de ir para a memória do Worker', () => {
  const MB = 1024 * 1024;
  const rotas = [
    ['o anexo da tarefa', `/board/tasks/${TAREFA}/attachments`],
    ['a imagem do chat', `/chat/conversations/${TAREFA}/images`],
  ] as const;

  /** Um multipart de verdade, com `tamanho` bytes de arquivo. */
  const multipart = (tamanho: number) => {
    const forma = new FormData();
    forma.set('arquivo', new File([new Uint8Array(tamanho)], 'a.png', { type: 'image/png' }));
    return forma;
  };

  const chat = { ...env, IDEWORKS_CHAT: 'ligado' };
  const enviar = (caminho: string, corpo: BodyInit, cabecalhos: Record<string, string> = {}) => {
    const { 'Content-Type': _ignorado, ...semTipo } = { 'Content-Type': '', ...cabecalhos };
    void _ignorado;
    return worker.fetch(
      new Request(`https://app.invalid/api${caminho}`, {
        method: 'POST',
        headers: { Cookie: 'ideworks_sessao=test-access', ...semTipo },
        body: corpo,
      }),
      chat as never,
    );
  };

  it.each(rotas)('%s: Content-Length acima do teto é 413, sem ler o corpo', async (_nome, caminho) => {
    const lendo = vi.spyOn(Request.prototype, 'formData');
    try {
      const r = await enviar(caminho, multipart(10), { 'Content-Length': String(60 * MB) });
      expect(r.status).toBe(413);
      expect(await mensagem(r)).toMatch(/teto/i);
      expect(lendo).not.toHaveBeenCalled();
      expect(consultas).toEqual([]);
    } finally {
      lendo.mockRestore();
    }
  });

  it.each(rotas)('%s: sem Content-Length (corpo em pedaços), o excesso é cortado na leitura', async (_nome, caminho) => {
    // Sem o cabeçalho, ninguém sabe o tamanho de antemão: o Worker conta o que
    // chega e desiste no teto, sem montar o arquivo inteiro.
    let lidos = 0;
    const pedaco = new Uint8Array(1 * MB);
    const corpo = new ReadableStream<Uint8Array>({
      pull(controle) {
        if (lidos >= 40) return controle.close();
        lidos += 1;
        controle.enqueue(pedaco);
      },
    });
    const r = await worker.fetch(
      new Request(`https://app.invalid/api${caminho}`, {
        method: 'POST',
        headers: { Cookie: 'ideworks_sessao=test-access', 'Content-Type': 'multipart/form-data; boundary=x' },
        body: corpo,
        // @ts-expect-error — `duplex` é exigido pelo Node para corpo em fluxo
        duplex: 'half',
      }),
      chat as never,
    );
    expect(r.status).toBe(413);
    expect(lidos).toBeLessThan(40);
  });

  it.each(rotas)('%s: um arquivo dentro do teto segue o caminho de sempre', async (_nome, caminho) => {
    const r = await enviar(caminho, multipart(10));
    // O dublê não acha tarefa nem conversa (e o arquivo de teste nem é PNG): a
    // recusa é outra, nunca a do tamanho.
    expect(r.status).not.toBe(413);
    expect(r.status).toBeLessThan(500);
  });
});

describe('pedido torto é 400 com a frase, e não o 500 de um TypeError', () => {
  /** Sem cookie, sem origem: o que a porta pública recebe de quem monta o pedido à mão. */
  const publica = (caminho: string, bruto: string) =>
    worker.fetch(
      new Request(`https://app.invalid/api${caminho}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bruto,
      }),
      env as never,
    );

  it.each([
    ['/auth/login', 'null'],
    ['/auth/login', '{"email":123,"password":"x"}'],
    ['/auth/login', '{"email":"a@example.invalid","password":{"a":1}}'],
    ['/auth/login', '{"email":["a@example.invalid"],"password":"x"}'],
    ['/auth/activate', 'null'],
    ['/auth/activate', '{"email":123,"code":"ABC-DEF-GHJ","password":"x"}'],
    ['/auth/activate', '{"email":"a@example.invalid","code":{},"password":"x"}'],
    ['/auth/activate', '{"email":"a@example.invalid","code":"ABC-DEF-GHJ","password":7}'],
    ['/auth/reset-password', 'null'],
    ['/auth/reset-password', '{"email":123,"code":"ABC-DEF-GHJ","password":"x"}'],
    ['/auth/reset-password', '{"email":"a@example.invalid","code":"ABC-DEF-GHJ","password":false}'],
  ])('%s com %s é 400, sem tocar no banco', async (caminho, bruto) => {
    const r = await publica(caminho, bruto);
    expect(r.status).toBe(400);
    expect(consultas).toEqual([]);
    expect(idasAoProvedor).toBe(0);
  });

  it.each([
    ['POST', '/items'],
    ['POST', `/clients/${CLIENTE}/flags`],
    ['PUT', `/admin/people/${PESSOA}/role`],
    ['POST', '/board/notices/read'],
    ['POST', `/board/tasks/${TAREFA}/comments`],
  ])('%s %s com o corpo `null` é recusa de pedido, e não falha do servidor', async (metodo, caminho) => {
    const r = await chamar(metodo, caminho, { bruto: 'null' });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  /** Um id que tem a forma de uuid na rota mas não no Postgres, e uma lista de ids tortos no corpo. */
  const assinar = () => chamar('POST', '/board/attachments/urls', { corpo: { ids: ['isto-nao-e-um-uuid'] } });

  it('texto que o Postgres recusa (`22P02`) é 400 genérico, sem o nome do tipo nem do valor', async () => {
    aoConsultar = () => {
      throw Object.assign(new Error('invalid input syntax for type uuid: "isto-nao-e-um-uuid"'), {
        code: '22P02',
      });
    };
    const r = await assinar();
    expect(r.status).toBe(400);
    const frase = await mensagem(r);
    expect(frase).not.toMatch(/uuid|syntax|isto-nao/i);
    expect(frase).toMatch(/confira/i);
  });

  it.each(['22007', '22008', '22003', '22001'])('o código %s também é pedido torto', async (code) => {
    aoConsultar = () => {
      throw Object.assign(new Error('qualquer coisa do banco'), { code });
    };
    expect((await assinar()).status).toBe(400);
  });

  it('falha de verdade do banco (conexão, permissão) continua sendo 500', async () => {
    aoConsultar = () => {
      throw Object.assign(new Error('connection terminated'), { code: '08006' });
    };
    expect((await assinar()).status).toBe(500);
  });

  it('porcentagem malformada no endereço da campanha é 400', async () => {
    const r = await chamar('GET', `/meta-assets/${TAREFA}/campaigns/%E0%A4%A/ads?from=2026-10-01&to=2026-10-31`);
    expect(r.status).toBe(400);
    expect(consultas).toEqual([]);
  });
});

describe('administração: o campo que falta NÃO vira "apague tudo"', () => {
  beforeEach(() => {
    // As funções de escrita do banco devolvem a contagem / o retrato do que gravaram.
    aoConsultar = (texto) =>
      texto.includes('set_node_access') ? [{ a: {} }] : texto.includes('set_user_') ? [{ total: 1 }] : [];
  });

  const ALVO = '00000000-0000-0000-0000-0000000000b2';
  const OUTRO = '00000000-0000-0000-0000-0000000000b3';

  type Rota = {
    nome: string;
    metodo: string;
    caminho: string;
    escrita: string;
    certos: unknown[];
    tortos: unknown[];
  };
  const rotas: Rota[] = [
    {
      nome: 'ativar/desativar',
      metodo: 'PUT',
      caminho: `/admin/people/${ALVO}/active`,
      escrita: 'set_user_active',
      certos: [{ ativo: false }, { ativo: true }],
      tortos: [{}, { ativo: 'false' }, { ativo: null }, { active: false }],
    },
    {
      nome: 'áreas',
      metodo: 'PUT',
      caminho: `/admin/people/${ALVO}/areas`,
      escrita: 'set_user_areas',
      certos: [{ areas: ['entrega', 'quadro'] }, { areas: [] }],
      tortos: [{}, { areas: 'entrega' }, { areas: ['root'] }, { areas: [1] }],
    },
    {
      nome: 'carteira',
      metodo: 'PUT',
      caminho: `/admin/people/${ALVO}/clients`,
      escrita: 'set_user_clients',
      certos: [{ clientIds: [CLIENTE] }, { clientIds: [] }],
      tortos: [{}, { clientIds: CLIENTE }, { clientIds: ['nao-e-uuid'] }, { clientIds: [null] }],
    },
    {
      nome: 'empresas',
      metodo: 'PUT',
      caminho: `/admin/people/${ALVO}/companies`,
      escrita: 'set_user_categories',
      certos: [{ ids: [OUTRO] }, { ids: [] }],
      tortos: [{}, { ids: OUTRO }, { ids: ['x'] }],
    },
    {
      nome: 'papel',
      metodo: 'PUT',
      caminho: `/admin/people/${ALVO}/role`,
      escrita: 'set_user_role',
      certos: [
        { papel: 'funcionario', todosOsClientes: false },
        { papel: 'admin', todosOsClientes: true },
      ],
      tortos: [
        {},
        { papel: 'funcionario' },
        { todosOsClientes: false },
        { papel: 'root', todosOsClientes: false },
        { papel: 'admin', todosOsClientes: 'sim' },
      ],
    },
    {
      nome: 'acesso do nó',
      metodo: 'PUT',
      caminho: `/board/access/list/${TAREFA}`,
      escrita: 'set_node_access',
      certos: [
        { restricted: true, grants: [{ userId: ALVO, level: 'execute' }] },
        { restricted: false, grants: [] },
      ],
      tortos: [
        {},
        { restricted: true },
        { grants: [] },
        { restricted: 'sim', grants: [] },
        { restricted: true, grants: [{ level: 'execute' }] },
        { restricted: true, grants: [{ userId: 'x' }] },
      ],
    },
  ];

  for (const rota of rotas) {
    describe(rota.nome, () => {
      it.each<unknown>(rota.tortos)('pedido sem o que precisa dizer (%j) é 400 e não escreve', async (corpo) => {
        const r = await chamar(rota.metodo, rota.caminho, { corpo });
        expect(r.status).toBe(400);
        expect(consultas.join('\n')).not.toContain(rota.escrita);
      });

      it.each(['null', '[]', '"texto"', 'isto nao e json'])('corpo %s é 400 e não escreve', async (bruto) => {
        const r = await chamar(rota.metodo, rota.caminho, { bruto });
        expect(r.status).toBe(400);
        expect(consultas.join('\n')).not.toContain(rota.escrita);
      });

      it.each<unknown>(rota.certos)('o pedido completo (%j) segue para o banco', async (corpo) => {
        const r = await chamar(rota.metodo, rota.caminho, { corpo });
        expect(r.status).toBeLessThan(400);
        expect(consultas.join('\n')).toContain(rota.escrita);
      });
    });
  }
});

describe('o mesmo vale para quem desliga, desvincula ou solta sem dizer o quê', () => {
  const CONTA = '00000000-0000-0000-0000-0000000000c3';

  const casos = [
    {
      nome: 'etiquetas do cliente (`tagIds` ausente apagaria todas)',
      metodo: 'POST',
      caminho: `/clients/${CLIENTE}/tags`,
      escrita: 'set_client_tags',
      tortos: [{}, { tagIds: 'x' }, { tagIds: ['nao-e-uuid'] }],
      certos: [{ tagIds: [] }, { tagIds: [CLIENTE] }],
    },
    {
      nome: 'dono da conta da Meta (`clientId` ausente ou torto desvincularia)',
      metodo: 'POST',
      caminho: `/meta-assets/${CONTA}/client`,
      escrita: 'set_asset_client',
      tortos: [{}, { clientId: 'abc' }, { clientId: 7 }, { cliente: CLIENTE }],
      certos: [{ clientId: null }, { clientId: CLIENTE }],
    },
    {
      nome: 'mãe da tarefa (`parentId` ausente soltaria a subtarefa)',
      metodo: 'PUT',
      caminho: `/board/tasks/${TAREFA}/parent`,
      escrita: 'update ideworks.tasks t',
      tortos: [{}, { parentId: null }, { parentId: 'abc' }, { parentId: 3 }],
      certos: [{ parentId: CLIENTE }],
    },
    {
      nome: 'cliente da tarefa (`clientId` ausente ou torto tiraria o cliente)',
      metodo: 'PUT',
      caminho: `/board/tasks/${TAREFA}/client`,
      escrita: 'from ideworks.tasks t',
      tortos: [{}, { clientId: 7 }, { clientId: ['x'] }],
      certos: [{ clientId: null }, { clientId: CLIENTE }],
    },
  ];

  for (const c of casos) {
    describe(c.nome, () => {
      it.each<unknown>(c.tortos)('pedido sem dizer o quê (%j) é 400 e não escreve', async (corpo) => {
        const r = await chamar(c.metodo, c.caminho, { corpo });
        expect(r.status).toBe(400);
        expect(consultas.join('\n')).not.toContain(c.escrita);
      });

      it.each(['null', 'isto nao e json'])('corpo %s é 400 e não escreve', async (bruto) => {
        const r = await chamar(c.metodo, c.caminho, { bruto });
        expect(r.status).toBe(400);
        expect(consultas.join('\n')).not.toContain(c.escrita);
      });

      it.each<unknown>(c.certos)('o pedido completo (%j) segue para o banco', async (corpo) => {
        await chamar(c.metodo, c.caminho, { corpo });
        expect(consultas.join('\n')).toContain(c.escrita);
      });
    });
  }
});

describe('a recusa do banco não vaza nome de tabela, função nem restrição', () => {
  const ALVO = '00000000-0000-0000-0000-0000000000b2';
  const recusar = (code: string, texto: string) => {
    aoConsultar = () => {
      throw Object.assign(new Error(texto), { code });
    };
  };

  it('política de linha (a tabela está no texto do Postgres)', async () => {
    recusar('42501', 'new row violates row-level security policy for table "mural_notes"');
    const r = await chamar('POST', `/clients/${CLIENTE}/mural`, { corpo: { content: 'oi' } });
    expect(r.status).toBe(403);
    const frase = await mensagem(r);
    expect(frase).not.toMatch(/mural_notes|row-level|policy|table/i);
    expect(frase).toMatch(/permiss/i);
  });

  it('permissão negada em função (o nome da função está no texto)', async () => {
    recusar('42501', 'permission denied for function set_user_areas');
    const r = await chamar('PUT', `/admin/people/${ALVO}/areas`, { corpo: { areas: ['entrega'] } });
    expect(r.status).toBe(403);
    const frase = await mensagem(r);
    expect(frase).not.toMatch(/set_user_areas|function|denied/i);
    expect(frase).toMatch(/permiss/i);
  });

  it('a frase que o banco escreve para gente passa inteira — é ela que explica', async () => {
    recusar('42501', 'so super admin cria outro super admin');
    const r = await chamar('PUT', `/admin/people/${ALVO}/areas`, { corpo: { areas: ['entrega'] } });
    expect(r.status).toBe(403);
    expect(await mensagem(r)).toBe('so super admin cria outro super admin');
  });
});

describe('a superfície de agentes não é tocada pela rede do corpo nulo', () => {
  it('`request.json()` de /mcp continua devolvendo `null` como veio', async () => {
    const pedido = new Request('https://app.invalid/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    });
    // Sem integração configurada o handler recusa; o que importa é que o corpo
    // não foi reescrito antes de chegar lá.
    await worker.fetch(pedido, env as never).catch(() => undefined);
    const descritor = Object.getOwnPropertyDescriptor(pedido, 'json');
    expect(descritor).toBeUndefined();
  });

  it('a API humana é a única que ganha o `json()` blindado', async () => {
    const pedido = new Request('https://app.invalid/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    });
    await worker.fetch(pedido, env as never);
    expect(Object.getOwnPropertyDescriptor(pedido, 'json')).toBeDefined();
  });
});

describe('corpo JSON: o excesso é cortado na leitura, também antes de haver sessão', () => {
  const MB = 1024 * 1024;

  /** Um corpo em pedaços de 1 MB, SEM Content-Length (como o cliente que manda em "chunked"). */
  const emPedacos = (mb: number) => {
    const contagem = { lidos: 0 };
    const pedaco = new TextEncoder().encode(' '.repeat(MB));
    const corpo = new ReadableStream<Uint8Array>({
      pull(controle) {
        if (contagem.lidos >= mb) return controle.close();
        contagem.lidos += 1;
        controle.enqueue(pedaco);
      },
    });
    return { corpo, contagem };
  };

  const enviar = (caminho: string, corpo: BodyInit, cabecalhos: Record<string, string> = {}) =>
    worker.fetch(
      new Request(`https://app.invalid/api${caminho}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...cabecalhos },
        body: corpo,
        // @ts-expect-error — `duplex` é exigido pelo Node para corpo em fluxo
        duplex: 'half',
      }),
      env as never,
    );

  it('Content-Length declarado grande demais é 413 antes de qualquer leitura', async () => {
    const lendo = vi.spyOn(Request.prototype, 'json');
    try {
      const r = await enviar('/items', '{}', {
        Cookie: 'ideworks_sessao=test-access',
        'Content-Length': String(50 * MB),
      });
      expect(r.status).toBe(413);
      expect(idasAoProvedor).toBe(0);
      expect(consultas).toEqual([]);
    } finally {
      lendo.mockRestore();
    }
  });

  it('login sem Content-Length: a leitura desiste no teto e a rota responde 400', async () => {
    const { corpo, contagem } = emPedacos(60);
    const r = await enviar('/auth/login', corpo);
    expect(r.status).toBe(400);
    expect(contagem.lidos).toBeLessThan(10);
    expect(consultas).toEqual([]);
    expect(idasAoProvedor).toBe(0);
  });

  it('rota autenticada sem Content-Length: mesma desistência', async () => {
    const { corpo, contagem } = emPedacos(60);
    const r = await enviar('/items', corpo, { Cookie: 'ideworks_sessao=test-access' });
    expect(r.status).toBe(400);
    expect(contagem.lidos).toBeLessThan(10);
  });

  it('a rota pública da aprovação (8 KiB) corta o excesso e responde 413', async () => {
    const { corpo, contagem } = emPedacos(60);
    const token = 'A'.repeat(43);
    const r = await enviar(`/public/aprovacao/${token}/chamadas/${TAREFA}/comentarios`, corpo);
    expect(r.status).toBe(413);
    expect(contagem.lidos).toBeLessThan(3);
    expect(consultas).toEqual([]);
  });

  it('um JSON de tamanho normal continua passando', async () => {
    const r = await enviar('/items', JSON.stringify({ clientId: CLIENTE, month: '2026-10-01' }), {
      Cookie: 'ideworks_sessao=test-access',
    });
    expect(r.status).toBe(400); // faltou o tipo: a rota respondeu, e não o corte
    expect(await mensagem(r)).toMatch(/cliente, mês e tipo/i);
  });
});

describe('portas de administração: quem não administra leva 403 antes de qualquer consulta', () => {
  const ALVO = '00000000-0000-0000-0000-0000000000b2';
  const LISTA = '00000000-0000-0000-0000-0000000000d4';

  beforeEach(() => {
    perfil = {
      ...PERFIL_DE_ADMIN,
      role: 'funcionario',
      is_superadmin: false,
      has_all_clients_access: false,
      areas: ['entrega', 'quadro', 'meta', 'catalogos', 'pessoas'], // TODAS as áreas: o papel é que barra
    };
  });

  const portas: [string, string, unknown][] = [
    ['POST', '/meta/collect', {}],
    ['GET', '/meta/discover', undefined],
    ['GET', '/meta/companies', undefined],
    ['POST', '/meta/accounts/import', {}],
    ['POST', '/admin/invitations', { email: 'novo@example.invalid', nome: 'Novo' }],
    ['GET', '/admin/semana', undefined],
    ['POST', '/admin/semana/liberar', { taskId: TAREFA, assigneeIds: [], dueOn: '2026-10-12' }],
    ['GET', `/clients/${CLIENTE}/approval`, undefined],
    ['POST', `/clients/${CLIENTE}/approval`, { enabled: true }],
    ['GET', `/clients/${CLIENTE}/approval/link`, undefined],
    ['POST', `/clients/${CLIENTE}/approval/link`, {}],
    ['DELETE', `/clients/${CLIENTE}/approval/link`, undefined],
    ['PUT', `/board/lists/${LISTA}/approval-targets`, {}],
    ['PATCH', `/board/lists/${LISTA}`, { requiresClient: true }],
    ['PUT', `/admin/people/${ALVO}/profile`, { nome: 'X', email: 'x@example.invalid', anterior: { nome: null, email: 'y@example.invalid' } }],
  ];

  it.each(portas)('%s %s', async (metodo, caminho, corpo) => {
    const r = await chamar(metodo, caminho, { corpo });
    expect(r.status).toBe(403);
    // Nenhuma ida ao banco além do perfil: a recusa é do papel, não do alcance.
    expect(consultas).toEqual([]);
  });

  it('o convite ao topo (super admin) é recusado a quem só administra', async () => {
    perfil = { ...PERFIL_DE_ADMIN, role: 'admin', is_superadmin: true };
    const r = await chamar('POST', '/admin/invitations', {
      corpo: { email: 'teste-novo@ideworks.invalid', nome: 'Novo', papel: 'super_admin' },
    });
    expect(r.status).toBe(403);
    expect(await mensagem(r)).toMatch(/super admin/i);
  });

  it('o admin comum não escolhe a empresa da descoberta da Meta (só o topo)', async () => {
    perfil = { ...PERFIL_DE_ADMIN, role: 'admin', is_superadmin: true };
    const r = await chamar('GET', `/meta/discover?empresa=${CLIENTE}`);
    expect(r.status).toBe(403);
  });
});

describe('limite de tentativas: um IPv6 não ganha um balde novo a cada endereço', () => {
  /** Estoura só o teto de ORIGEM e guarda a chave que o limitador usou para ela. */
  const origensDoLimitador = async (rota: string, ip: string, corpo: unknown) => {
    const chaves: string[] = [];
    aoConsultar = (texto, valores) => {
      if (!texto.includes('from ideworks.auth_attempts')) return undefined;
      // (propósito, escopo, chave, desde)
      const [, escopo, chave] = valores as [string, string, string];
      if (escopo !== 'ip') return [{ n: 0 }];
      chaves.push(chave);
      return [{ n: 999 }];
    };
    await worker.fetch(
      new Request(`https://app.invalid/api${rota}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
        body: JSON.stringify(corpo),
      }),
      env as never,
    );
    return chaves;
  };

  const login = { email: 'a@example.invalid', password: 'x' };

  it('login: dois endereços do mesmo /64 contam no mesmo teto', async () => {
    const a = await origensDoLimitador('/auth/login', '2001:db8:1:2::1', login);
    const b = await origensDoLimitador('/auth/login', '2001:db8:1:2:aaaa:bbbb:cccc:dddd', login);
    expect(a.length).toBeGreaterThan(0);
    expect(a.at(-1)).toBe('2001:db8:1:2::/64');
    expect(b.at(-1)).toBe('2001:db8:1:2::/64');
  });

  it('login: outro /64 é outro teto, e IPv4 fica como está', async () => {
    const outro = await origensDoLimitador('/auth/login', '2001:db8:1:3::1', login);
    const v4 = await origensDoLimitador('/auth/login', '203.0.113.7', login);
    expect(outro.at(-1)).toBe('2001:db8:1:3::/64');
    expect(v4.at(-1)).toBe('203.0.113.7');
  });

  it.each([
    ['/auth/activate', { email: 'a@example.invalid', code: 'ABC-DEF-GHJ', password: 'x' }],
    ['/auth/reset-password', { email: 'a@example.invalid', code: 'ABC-DEF-GHJ', password: 'x' }],
  ])('%s usa a mesma chave', async (rota, corpo) => {
    const a = await origensDoLimitador(rota, '2001:db8:1:2::1', corpo);
    expect(a.at(-1)).toBe('2001:db8:1:2::/64');
  });
});
