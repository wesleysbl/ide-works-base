/**
 * AS TELAS DA META SEM A EMPRESA OMITIDA, CONTRA UM POSTGRES DE VERDADE — F31, Fase 3b.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   O MESMO código de `server/meta-*.ts` rodando sobre o PGlite (o adaptador é o
 *   de `omitidas-banco.test.ts`): com `IDEWORKS_EMPRESAS_OMITIDAS` ligada, a
 *   conta da Alma9 — e a conta ligada a cliente da Alma9 — somem de Contas,
 *   Conexões, Ranking e da lista de empresas; o endereço direto de uma delas
 *   responde "não encontrado"; e com a variável desligada tudo volta como era.
 *
 *   A REGRA quando a empresa da conta e a do cliente divergem mora em
 *   `contaDaMetaForaDasOmitidas`: a conta sai se QUALQUER uma for omitida. As
 *   duas divergências estão no terreno abaixo, uma de cada lado.
 *
 * O QUE ELE NÃO PROVA
 *   As políticas de linha (RLS) — mesmo limite de `omitidas-banco.test.ts`.
 *
 * NENHUMA REDE: o PGlite roda no próprio processo.
 */

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Sql, Tx } from '@/server/db';
import { CatalogoRefused, deleteCategoria, saveCategoria, setCategoriaPadrao } from '@/server/catalogos';
import { readConexoes } from '@/server/meta-conexoes';
import {
  ContaRefused,
  atribuirCliente,
  importarContas,
  readContas,
  readEmpresasParaMeta,
} from '@/server/meta-contas';
import { readRanking } from '@/server/meta-ranking';
import { FRASE_DE_NAO_ENCONTRADO, conferirOmitidas, esquecerResolucoes } from '@/server/omitidas';
import type { AuthenticatedActor } from '@/server/session';

/* ───────────────────────────── o adaptador ───────────────────────────── */

type Fragmento = {
  readonly dublê: true;
  readonly strings: readonly string[];
  readonly args: readonly unknown[];
};

const ehFragmento = (v: unknown): v is Fragmento =>
  typeof v === 'object' && v !== null && (v as Fragmento).dublê === true;

function montar(f: Fragmento, params: unknown[]): string {
  let texto = f.strings[0] ?? '';
  f.args.forEach((a, i) => {
    if (ehFragmento(a)) texto += montar(a, params);
    else {
      params.push(a);
      texto += `$${params.length}`;
    }
    texto += f.strings[i + 1] ?? '';
  });
  return texto;
}

let db: PGlite;
/** O texto de cada consulta que passou — para provar "nada muda desligada". */
let textos: string[] = [];

const tx = ((strings: TemplateStringsArray, ...args: unknown[]) => {
  const f: Fragmento & PromiseLike<unknown[]> = {
    dublê: true,
    strings,
    args,
    then(ok, falha) {
      const params: unknown[] = [];
      const texto = montar(f, params);
      textos.push(texto);
      return db.query(texto, params).then((r) => r.rows).then(ok, falha);
    },
  };
  return f;
}) as unknown as Tx;

const sql = { begin: (trabalho: (t: Tx) => Promise<unknown>) => trabalho(tx) } as unknown as Sql;

/* ───────────────────────────── o terreno ───────────────────────────── */

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const IDE = id(1);
const ALMA = id(3);
const PADRAO = id(4);
const C_IDE = id(10);
const C_ALMA = id(11);
/** Um cliente que não existe (ou que quem pergunta não enxerga). */
const C_FANTASMA = id(12);

/** Token da Ide, cliente da Ide: fica. */
const A_IDE = id(100);
/** Token da Alma9, sem cliente: sai. */
const A_ALMA = id(101);
/** Token da Alma9 ligada a cliente da IDE — divergência 1: sai. */
const A_ALMA_CIDE = id(102);
/** Token da Ide ligada a cliente da ALMA9 — divergência 2: sai. */
const A_IDE_CALMA = id(103);
/** Perfil sem empresa nem cliente (credencial padrão): fica. */
const A_SEM = id(104);
/** Token da Ide ligada a um cliente que a consulta não acha. */
const A_IDE_CFANTASMA = id(105);

const TODAS = [A_IDE, A_ALMA, A_ALMA_CIDE, A_IDE_CALMA, A_SEM, A_IDE_CFANTASMA];
const VISIVEIS = [A_IDE, A_SEM, A_IDE_CFANTASMA];

const EU = id(99);

const base: AuthenticatedActor = {
  userId: EU,
  email: 'wesley@example.invalid',
  papel: 'super_admin',
  isSuperadmin: true,
  isSuper: true,
  areas: [],
  hasAllClientsAccess: true,
};
const ligado: AuthenticatedActor = { ...base, categoriasOmitidas: [ALMA] };
const desligado = base;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema ideworks;
    create type ideworks.meta_asset_kind as enum ('ad_account', 'instagram_account');
    create table ideworks.client_categories(id uuid primary key, name text, is_default boolean default false,
      sort_order int default 0, meta_secret_name text, updated_at timestamptz);
    create table ideworks.clients(id uuid primary key, name text, category_id uuid, is_active boolean default true);
    create table ideworks.meta_assets(id uuid primary key, kind ideworks.meta_asset_kind, external_id text,
      display_name text, business_id text, business_name text, page_id text, page_name text,
      is_active boolean default true, last_seen_at timestamptz, last_error text,
      client_id uuid, category_id uuid, created_by uuid);
    create table ideworks.meta_daily_organic(asset_id uuid, day date);
    create table ideworks.meta_daily_campaign(asset_id uuid, day date);
    create table ideworks.meta_daily_ad(asset_id uuid, ad_id text, campaign_id text, day date,
      spend numeric, impressions numeric, clicks numeric, link_clicks numeric, reach numeric,
      actions jsonb default '[]');
    create table ideworks.meta_ads(asset_id uuid, ad_id text, campaign_id text, name text, adset_name text,
      thumbnail_url text, effective_status text, instagram_permalink text);
    create table ideworks.meta_campaigns(asset_id uuid, campaign_id text, name text, objective text,
      effective_status text);
    create table ideworks.chamadas(o_que text, alvo uuid, cliente uuid);
    create function ideworks.set_asset_client(a uuid, c uuid) returns void language sql as
      $$ insert into ideworks.chamadas values ('set_asset_client', a, c) $$;
    create function ideworks.set_default_category(c uuid) returns void language sql as
      $$ insert into ideworks.chamadas values ('set_default_category', c, null) $$;
    create function ideworks.delete_category(c uuid) returns int language sql as
      $$ insert into ideworks.chamadas values ('delete_category', c, null) returning 0 $$;
    create function ideworks.upsert_meta_asset(k ideworks.meta_asset_kind, e text, d text, bi text, bn text,
      pi text, pn text, c uuid) returns void language sql as $$ select $$;

    insert into ideworks.client_categories(id, name, is_default, sort_order, meta_secret_name) values
      ('${IDE}', 'Ide', false, 1, null), ('${ALMA}', 'Alma9', false, 3, 'IDEWORKS_META_TOKEN_ALMA9'),
      ('${PADRAO}', 'Sem categoria', true, 4, null);
    insert into ideworks.clients(id, name, category_id) values
      ('${C_IDE}', 'Cliente Ide', '${IDE}'), ('${C_ALMA}', 'Cliente Alma', '${ALMA}');
    insert into ideworks.meta_assets(id, kind, external_id, display_name, business_name, client_id, category_id) values
      ('${A_IDE}', 'ad_account', 'act_1', 'Conta Ide', 'BM Ide', '${C_IDE}', '${IDE}'),
      ('${A_ALMA}', 'ad_account', 'act_2', 'Conta Alma', 'BM Alma', null, '${ALMA}'),
      ('${A_ALMA_CIDE}', 'ad_account', 'act_3', 'Conta Alma do cliente Ide', 'BM Alma', '${C_IDE}', '${ALMA}'),
      ('${A_IDE_CALMA}', 'ad_account', 'act_4', 'Conta Ide do cliente Alma', 'BM Ide Alma', '${C_ALMA}', '${IDE}'),
      ('${A_SEM}', 'instagram_account', 'ig_5', '@sem.empresa', null, null, null),
      ('${A_IDE_CFANTASMA}', 'ad_account', 'act_6', 'Conta Ide de cliente sumido', 'BM Ide', '${C_FANTASMA}', '${IDE}');
    insert into ideworks.meta_daily_ad(asset_id, ad_id, campaign_id, day, spend, impressions, clicks, link_clicks, reach)
      select a.id, 'ad-' || a.external_id, 'camp-' || a.external_id, '2026-09-10', 10, 100, 5, 3, 50
        from ideworks.meta_assets a where a.kind = 'ad_account';
    insert into ideworks.meta_ads(asset_id, ad_id, campaign_id, name)
      select a.id, 'ad-' || a.external_id, 'camp-' || a.external_id, 'Anúncio ' || a.display_name
        from ideworks.meta_assets a where a.kind = 'ad_account';
  `);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  esquecerResolucoes();
  textos = [];
  await db.exec('delete from ideworks.chamadas');
});

const ids = (linhas: ReadonlyArray<{ id: string }>) => linhas.map((l) => l.id).sort();

/* ───────────────────────────── as listas ───────────────────────────── */

describe('F31.3b — Contas da Meta (e o pareamento, que parte delas)', () => {
  it('ligada: some a conta da Alma9 e as duas divergentes; nenhum "Alma" na resposta', async () => {
    const contas = await readContas(sql, ligado);
    expect(ids(contas)).toEqual([...VISIVEIS].sort());
    expect(JSON.stringify(contas)).not.toMatch(/Alma/);
    // O filtro "Empresa" da tela nasce das empresas das contas: sobra uma só.
    const empresas = new Set(contas.map((c) => c.empresa?.id).filter(Boolean));
    expect([...empresas]).toEqual([IDE]);
  });

  it('desligada: todas as contas, e nenhuma consulta com recorte', async () => {
    const contas = await readContas(sql, desligado);
    expect(ids(contas)).toEqual([...TODAS].sort());
    for (const t of textos) expect(t).not.toContain('omit_');
  });
});

describe('F31.3b — as empresas da Meta (descoberta e importação do super admin)', () => {
  it('ligada: a Alma9 não é oferecida, e a contagem da Ide segue a regra da lista', async () => {
    const empresas = await readEmpresasParaMeta(sql, ligado);
    expect(empresas.map((e) => e.name)).toEqual(['Ide', 'Sem categoria']);
    // A_IDE e A_IDE_CFANTASMA; a A_IDE_CALMA (cliente da Alma9) não conta.
    expect(empresas.find((e) => e.id === IDE)?.contas).toBe(2);
  });

  it('desligada: a lista de sempre', async () => {
    const empresas = await readEmpresasParaMeta(sql, desligado);
    expect(empresas.map((e) => e.name)).toEqual(['Alma9', 'Ide', 'Sem categoria']);
    expect(empresas.find((e) => e.id === IDE)?.contas).toBe(3);
    expect(empresas.find((e) => e.id === ALMA)?.contas).toBe(2);
    for (const t of textos) expect(t).not.toContain('omit_');
  });

  it('"o sistema agora conhece N" conta o que a tela mostra', async () => {
    expect((await importarContas(sql, ligado, [])).contas).toBe(VISIVEIS.length);
    expect((await importarContas(sql, desligado, [])).contas).toBe(TODAS.length);
  });
});

describe('F31.3b — Conexões da Meta', () => {
  it('ligada: o cliente da Alma9 some, e o cliente da Ide perde a conta do token da Alma9', async () => {
    const clientes = await readConexoes(sql, ligado);
    expect(clientes.map((c) => c.name)).toEqual(['Cliente Ide']);
    expect(clientes[0].assets.map((a) => a.id)).toEqual([A_IDE]);
  });

  it('desligada: os dois clientes, cada um com as contas de sempre', async () => {
    const clientes = await readConexoes(sql, desligado);
    expect(clientes.map((c) => c.name)).toEqual(['Cliente Alma', 'Cliente Ide']);
    expect(clientes.find((c) => c.id === C_IDE)?.assets.map((a) => a.id).sort()).toEqual(
      [A_IDE, A_ALMA_CIDE].sort(),
    );
    expect(clientes.find((c) => c.id === C_ALMA)?.assets.map((a) => a.id)).toEqual([A_IDE_CALMA]);
  });
});

describe('F31.3b — Ranking de criativos', () => {
  it('ligada: só criativos, gerenciadores e empresa da Ide — o menu "Empresa" fica com uma e some', async () => {
    const r = await readRanking(sql, ligado, '2026-09-01', '2026-09-30', null, null);
    expect(r.empresas).toEqual([{ id: IDE, nome: 'Ide' }]);
    expect(r.gerenciadores).toEqual(['BM Ide']);
    expect(r.criativos.map((c) => c.conta).sort()).toEqual(['Conta Ide', 'Conta Ide de cliente sumido']);
  });

  it('ligada: pedir a empresa omitida pelo endereço devolve vazio, sem erro', async () => {
    const r = await readRanking(sql, ligado, '2026-09-01', '2026-09-30', null, ALMA);
    expect(r.criativos).toEqual([]);
    expect(r.gerenciadores).toEqual([]);
  });

  it('desligada: o ranking de sempre', async () => {
    const r = await readRanking(sql, desligado, '2026-09-01', '2026-09-30', null, null);
    expect(r.empresas.map((e) => e.nome)).toEqual(['Alma9', 'Ide']);
    expect(r.criativos).toHaveLength(5);
    for (const t of textos) expect(t).not.toContain('omit_');
  });
});

/* ───────────────────────────── o endereço direto ───────────────────────────── */

describe('F31.3b — endereço direto de UMA conta (/meta-assets/:id/…)', () => {
  const ator = { kind: 'user' as const, userId: EU, isSuperadmin: true, isSuper: true };
  const conferir = (conta: string, resto = '/report/paid') =>
    conferirOmitidas(sql, ator, ['alma9'], `/meta-assets/${conta}${resto}`);

  it.each([
    ['da Alma9, sem cliente', A_ALMA],
    ['do token da Alma9 ligada a cliente da Ide', A_ALMA_CIDE],
    ['do token da Ide ligada a cliente da Alma9', A_IDE_CALMA],
  ])('conta %s → "não encontrado"', async (_nome, conta) => {
    for (const resto of ['/report/paid', '/report/organic', '/media', '/campaigns', '/client', '']) {
      esquecerResolucoes();
      expect((await conferir(conta, resto)).recusa).toBe(FRASE_DE_NAO_ENCONTRADO['conta-meta']);
    }
  });

  it.each([
    ['da Ide', A_IDE],
    ['sem empresa', A_SEM],
  ])('conta %s passa', async (_nome, conta) => {
    expect((await conferir(conta)).recusa).toBeNull();
  });

  it('a empresa ACHADA fica guardada: a segunda conferência não vai ao banco', async () => {
    await conferir(A_ALMA_CIDE);
    const antes = textos.length;
    expect((await conferir(A_ALMA_CIDE)).recusa).toBe(FRASE_DE_NAO_ENCONTRADO['conta-meta']);
    expect(textos.length).toBe(antes);
  });

  it('cliente ligado que a consulta não acha NÃO vira guardado: pergunta de novo', async () => {
    // Sob a política de quem pergunta, o cliente pode estar só fora do alcance
    // dele — guardar "não omitida" deixaria passar para o super admin.
    await conferir(A_IDE_CFANTASMA);
    const antes = textos.length;
    expect((await conferir(A_IDE_CFANTASMA)).recusa).toBeNull();
    expect(textos.length).toBeGreaterThan(antes);
  });
});

describe('F31.3b — ligar conta a cliente da empresa omitida', () => {
  it('ligada: "Cliente não encontrado." e o banco nem é chamado', async () => {
    await expect(atribuirCliente(sql, ligado, A_IDE, C_ALMA)).rejects.toMatchObject({
      message: 'Cliente não encontrado.',
      status: 404,
    });
    await expect(atribuirCliente(sql, ligado, A_IDE, C_ALMA)).rejects.toBeInstanceOf(ContaRefused);
    expect((await db.query('select * from ideworks.chamadas')).rows).toEqual([]);
  });

  it('ligada: cliente da Ide, e desligar a conta, seguem', async () => {
    await atribuirCliente(sql, ligado, A_IDE, C_IDE);
    await atribuirCliente(sql, ligado, A_IDE, null);
    expect((await db.query('select o_que from ideworks.chamadas')).rows).toHaveLength(2);
  });

  it('desligada: nenhuma conferência a mais', async () => {
    await atribuirCliente(sql, desligado, A_IDE, C_ALMA);
    // A declaração do ator (`set_config`) e a função — nada mais.
    const consultas = textos.filter((t) => !t.includes('set_config'));
    expect(consultas).toEqual(['select ideworks.set_asset_client($1, $2)']);
  });
});

/* ───────────────────────────── Catálogos ───────────────────────────── */

describe('F31.3b — a unidade omitida não se torna padrão, não se renomeia, não se apaga', () => {
  it.each([
    ['tornar padrão', () => setCategoriaPadrao(sql, ligado, ALMA)],
    ['renomear', () => saveCategoria(sql, ligado, ALMA, { name: 'Alma Nove', sortOrder: 3 })],
    ['apagar', () => deleteCategoria(sql, ligado, ALMA)],
  ])('%s: recusado, e nada chega ao banco', async (_acao, fazer) => {
    const erro = await fazer().catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(CatalogoRefused);
    expect((erro as CatalogoRefused).status).toBe(409);
    expect((erro as Error).message).toContain('IDEWORKS_EMPRESAS_OMITIDAS');
    expect(textos).toEqual([]);
  });

  it('as outras unidades, com a variável ligada, seguem', async () => {
    await setCategoriaPadrao(sql, ligado, IDE);
    await deleteCategoria(sql, ligado, IDE);
    expect((await db.query('select o_que from ideworks.chamadas order by o_que')).rows).toEqual([
      { o_que: 'delete_category' },
      { o_que: 'set_default_category' },
    ]);
  });

  it('desligada: a Alma9 é uma unidade como as outras', async () => {
    await setCategoriaPadrao(sql, desligado, ALMA);
    await saveCategoria(sql, desligado, ALMA, { name: 'Alma9', sortOrder: 3 });
    expect((await db.query('select o_que from ideworks.chamadas')).rows).toEqual([
      { o_que: 'set_default_category' },
    ]);
  });
});
