/**
 * Conexão com o Dropbox — F42 Fase 2.
 *
 * A rede é bloqueada na suíte (`test/setup/network-guard.ts`): cada teste
 * injeta um `fetch` que responde como o Dropbox responderia, no formato da
 * especificação oficial (`dropbox/dropbox-api-spec`, `sharing.stone` e
 * `files.stone`).
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  DropboxRecusa,
  FRASES_DO_DROPBOX,
  clienteDoDropbox,
  credenciaisDoDropbox,
  enderecoDeExibicao,
  esquecerCrachasDoDropbox,
  formaDoLink,
  midiaDoArquivo,
  visibilidadeDoLink,
} from '@/server/dropbox';

const CRED = { appKey: 'chave', appSecret: 'segredo', refreshToken: 'refresh' };

const LINK_ARQUIVO = 'https://www.dropbox.com/scl/fi/abc123/video-final.mp4?rlkey=xyz789&dl=0';
const LINK_PASTA = 'https://www.dropbox.com/scl/fo/pasta1/def456?rlkey=k1&dl=0';

type Chamada = { url: string; init: RequestInit };

const json = (corpo: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const TOKEN_OK = () => json({ access_token: 'tok-1', expires_in: 14400, token_type: 'bearer' });

const permissoes = (extra: Record<string, unknown> = {}) => ({
  resolved_visibility: { '.tag': 'public' },
  can_revoke: false,
  allow_download: true,
  ...extra,
});

const metaArquivo = (extra: Record<string, unknown> = {}) => ({
  '.tag': 'file',
  url: LINK_ARQUIVO,
  id: 'id:arquivo1',
  name: 'video-final.mp4',
  rev: '015f1a2b3c4d',
  size: 52_428_800,
  server_modified: '2026-10-07T12:00:00Z',
  client_modified: '2026-10-07T12:00:00Z',
  link_permissions: permissoes(),
  ...extra,
});

/** Um Dropbox de mentira: `rotas` decide a resposta por sufixo do endereço. */
function dropbox(rotas: Record<string, (c: Chamada, n: number) => Response | Promise<Response>>) {
  const chamadas: Chamada[] = [];
  const contagem = new Map<string, number>();
  const fetchFalso = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const c = { url, init: init ?? {} };
    chamadas.push(c);
    const rota = Object.keys(rotas).find((r) => url.endsWith(r));
    if (!rota) throw new Error(`rota não simulada: ${url}`);
    const n = (contagem.get(rota) ?? 0) + 1;
    contagem.set(rota, n);
    return rotas[rota](c, n);
  }) as typeof fetch;
  return { fetchFalso, chamadas, vezes: (rota: string) => contagem.get(rota) ?? 0 };
}

const corpoDe = (c: Chamada) => JSON.parse(String(c.init.body));
const autorizacao = (c: Chamada) => new Headers(c.init.headers).get('Authorization');

async function recusa(p: Promise<unknown>): Promise<DropboxRecusa> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DropboxRecusa) return e;
    throw e;
  }
  throw new Error('esperava uma recusa e a chamada passou');
}

beforeEach(() => esquecerCrachasDoDropbox());

describe('credenciaisDoDropbox', () => {
  it('nomeia exatamente as chaves que faltam', () => {
    const r = credenciaisDoDropbox({
      IDEWORKS_DROPBOX_APP_KEY: 'x',
      IDEWORKS_DROPBOX_APP_SECRET: '   ',
    });
    expect(r).toEqual({
      ok: false,
      faltando: ['IDEWORKS_DROPBOX_APP_SECRET', 'IDEWORKS_DROPBOX_REFRESH_TOKEN'],
    });
  });

  it('com as três, devolve as credenciais', () => {
    const r = credenciaisDoDropbox({
      IDEWORKS_DROPBOX_APP_KEY: 'a',
      IDEWORKS_DROPBOX_APP_SECRET: 'b',
      IDEWORKS_DROPBOX_REFRESH_TOKEN: 'c',
    });
    expect(r).toEqual({ ok: true, credenciais: { appKey: 'a', appSecret: 'b', refreshToken: 'c' } });
  });
});

describe('endereço de exibição', () => {
  it('link de arquivo vira raw=1, sem dl e com rlkey preservado', () => {
    const e = enderecoDeExibicao(LINK_ARQUIVO);
    expect(e).not.toBeNull();
    const u = new URL(e!);
    expect(u.hostname).toBe('www.dropbox.com');
    expect(u.pathname).toBe('/scl/fi/abc123/video-final.mp4');
    expect(u.searchParams.get('raw')).toBe('1');
    expect(u.searchParams.get('rlkey')).toBe('xyz789');
    expect(u.searchParams.has('dl')).toBe(false);
  });

  it('link antigo /s/ também converte; dl=1 sai', () => {
    const e = enderecoDeExibicao('https://dropbox.com/s/exemplo0000000a/arte.png?dl=1');
    expect(e).toBe('https://www.dropbox.com/s/exemplo0000000a/arte.png?raw=1');
  });

  it('link de pasta não tem endereço de exibição', () => {
    expect(enderecoDeExibicao(LINK_PASTA)).toBeNull();
    expect(enderecoDeExibicao('https://www.dropbox.com/sh/abc/def?dl=0')).toBeNull();
  });

  it('o que não é Dropbox não converte', () => {
    expect(enderecoDeExibicao('https://evil.example.com/scl/fi/abc/x.mp4?dl=0')).toBeNull();
    expect(enderecoDeExibicao('http://www.dropbox.com/scl/fi/abc/x.mp4')).toBeNull();
    expect(enderecoDeExibicao('não é link')).toBeNull();
    expect(formaDoLink('https://www.dropbox.com/home/pasta')).toBeNull();
  });
});

describe('tipo do arquivo', () => {
  it('classifica pela extensão, sem diferenciar maiúsculas', () => {
    expect(midiaDoArquivo('Reels 01.MP4')).toBe('video');
    expect(midiaDoArquivo('bruto.mov')).toBe('video');
    expect(midiaDoArquivo('carrossel-2.JPEG')).toBe('imagem');
    expect(midiaDoArquivo('arte.png')).toBe('imagem');
    expect(midiaDoArquivo('roteiro.pdf')).toBe('outro');
    expect(midiaDoArquivo('sem-extensao')).toBe('outro');
  });
});

describe('visibilidade', () => {
  it('lê resolved_visibility e, na falta dele, effective_audience', () => {
    expect(visibilidadeDoLink({ resolved_visibility: { '.tag': 'public' } })).toBe('publico');
    expect(visibilidadeDoLink({ resolved_visibility: { '.tag': 'team_only' } })).toBe('equipe');
    expect(visibilidadeDoLink({ effective_audience: { '.tag': 'public' } })).toBe('publico');
    expect(visibilidadeDoLink({ effective_audience: { '.tag': 'team' } })).toBe('equipe');
    expect(visibilidadeDoLink({ effective_audience: { '.tag': 'public_logged_in_only' } })).toBe(
      'so_logado',
    );
    expect(visibilidadeDoLink({})).toBe('desconhecida');
  });

  it('senha vence a audiência pública', () => {
    expect(
      visibilidadeDoLink({ effective_audience: { '.tag': 'public' }, require_password: true }),
    ).toBe('senha');
  });
});

describe('conferirLink', () => {
  it('link de arquivo aberto: visibilidade pública, um arquivo com versão e endereço raw', async () => {
    const d = dropbox({
      '/oauth2/token': TOKEN_OK,
      '/sharing/get_shared_link_metadata': () => json(metaArquivo()),
    });
    const r = await clienteDoDropbox(CRED, { fetch: d.fetchFalso }).conferirLink(LINK_ARQUIVO);

    expect(r.link.visibilidade).toBe('publico');
    expect(r.link.tipo).toBe('arquivo');
    expect(r.arquivos).toHaveLength(1);
    expect(r.arquivos[0]).toMatchObject({
      id: 'id:arquivo1',
      rev: '015f1a2b3c4d',
      midia: 'video',
      caminho: null,
    });
    expect(r.arquivos[0].enderecoDeExibicao).toContain('raw=1');
    expect(r.arquivos[0].enderecoDeExibicao).toContain('rlkey=xyz789');

    // A troca do refresh token foi pelo formulário OAuth, com as credenciais do app.
    const troca = d.chamadas[0];
    expect(troca.url).toBe('https://api.dropboxapi.com/oauth2/token');
    const form = new URLSearchParams(String(troca.init.body));
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('refresh');
    expect(form.get('client_id')).toBe('chave');
    // E a consulta levou o crachá novo.
    expect(autorizacao(d.chamadas[1])).toBe('Bearer tok-1');
    expect(corpoDe(d.chamadas[1])).toEqual({ url: new URL(LINK_ARQUIVO).toString() });
  });

  it('link fechado para a equipe (team_only) é recusado com a frase para a equipe', async () => {
    const d = dropbox({
      '/oauth2/token': TOKEN_OK,
      '/sharing/get_shared_link_metadata': () =>
        json(metaArquivo({ link_permissions: permissoes({ resolved_visibility: { '.tag': 'team_only' } }) })),
    });
    const e = await recusa(clienteDoDropbox(CRED, { fetch: d.fetchFalso }).conferirLink(LINK_ARQUIVO));
    expect(e.motivo).toBe('link_fechado');
    expect(e.status).toBe(422);
    expect(e.message).toBe(FRASES_DO_DROPBOX.link_fechado);
    expect(e.message).toContain('Qualquer pessoa com o link');
  });

  it('link que o Dropbox nega acessar (409 shared_link_access_denied) também é "fechado"', async () => {
    const d = dropbox({
      '/oauth2/token': TOKEN_OK,
      '/sharing/get_shared_link_metadata': () =>
        json(
          { error_summary: 'shared_link_access_denied/..', error: { '.tag': 'shared_link_access_denied' } },
          409,
        ),
    });
    const e = await recusa(clienteDoDropbox(CRED, { fetch: d.fetchFalso }).conferirLink(LINK_ARQUIVO));
    expect(e.motivo).toBe('link_fechado');
  });

  it('link com senha é recusado', async () => {
    const d = dropbox({
      '/oauth2/token': TOKEN_OK,
      '/sharing/get_shared_link_metadata': () =>
        json(
          metaArquivo({
            link_permissions: permissoes({
              resolved_visibility: undefined,
              effective_audience: { '.tag': 'public' },
              require_password: true,
            }),
          }),
        ),
    });
    const e = await recusa(clienteDoDropbox(CRED, { fetch: d.fetchFalso }).conferirLink(LINK_ARQUIVO));
    expect(e.motivo).toBe('link_com_senha');
    expect(e.message).toContain('pede senha');
  });

  it('link com download desligado é recusado (raw=1 não tocaria)', async () => {
    const d = dropbox({
      '/oauth2/token': TOKEN_OK,
      '/sharing/get_shared_link_metadata': () =>
        json(metaArquivo({ link_permissions: permissoes({ allow_download: false }) })),
    });
    const e = await recusa(clienteDoDropbox(CRED, { fetch: d.fetchFalso }).conferirLink(LINK_ARQUIVO));
    expect(e.motivo).toBe('link_sem_download');
  });

  it('link inexistente ou expirado (409 shared_link_not_found)', async () => {
    const d = dropbox({
      '/oauth2/token': TOKEN_OK,
      '/sharing/get_shared_link_metadata': () =>
        json({ error_summary: 'shared_link_not_found/', error: { '.tag': 'shared_link_not_found' } }, 409),
    });
    const e = await recusa(clienteDoDropbox(CRED, { fetch: d.fetchFalso }).conferirLink(LINK_ARQUIVO));
    expect(e.motivo).toBe('link_inexistente');
    expect(e.message).toContain('não existe mais ou expirou');
  });

  it('o que não é link do Dropbox é recusado sem chamar a API', async () => {
    const d = dropbox({});
    const e = await recusa(
      clienteDoDropbox(CRED, { fetch: d.fetchFalso }).conferirLink('https://drive.google.com/x'),
    );
    expect(e.motivo).toBe('link_invalido');
    expect(d.chamadas).toHaveLength(0);
  });

  it('pasta: lista só os arquivos, pagina até o fim e ordena pelo nome natural', async () => {
    const d = dropbox({
      '/oauth2/token': TOKEN_OK,
      '/sharing/get_shared_link_metadata': () =>
        json({
          '.tag': 'folder',
          url: LINK_PASTA,
          id: 'id:pasta1',
          name: 'Carrossel outubro',
          link_permissions: permissoes(),
        }),
      '/files/list_folder': () =>
        json({
          entries: [
            { '.tag': 'file', id: 'id:10', name: '10.jpg', rev: 'r10', size: 100 },
            { '.tag': 'folder', id: 'id:sub', name: 'brutos' },
            { '.tag': 'file', id: 'id:gdoc', name: 'roteiro.gdoc', rev: 'rg', size: 1, is_downloadable: false },
          ],
          cursor: 'c1',
          has_more: true,
        }),
      '/files/list_folder/continue': () =>
        json({
          entries: [
            { '.tag': 'file', id: 'id:2', name: '2.jpg', rev: 'r2', size: 200 },
            { '.tag': 'file', id: 'id:v', name: 'reels.mov', rev: 'rv', size: 300 },
          ],
          cursor: 'c2',
          has_more: false,
        }),
    });
    const r = await clienteDoDropbox(CRED, { fetch: d.fetchFalso }).conferirLink(LINK_PASTA);

    expect(r.link.tipo).toBe('pasta');
    expect(r.arquivos.map((a) => a.nome)).toEqual(['2.jpg', '10.jpg', 'reels.mov']);
    expect(r.arquivos.map((a) => a.rev)).toEqual(['r2', 'r10', 'rv']);
    expect(r.arquivos.map((a) => a.midia)).toEqual(['imagem', 'imagem', 'video']);
    expect(r.arquivos[0]).toMatchObject({ caminho: '/2.jpg', enderecoDeExibicao: null });
    expect(r.subpastasIgnoradas).toBe(1);

    const primeira = d.chamadas.find((c) => c.url.endsWith('/files/list_folder'))!;
    expect(corpoDe(primeira)).toMatchObject({ path: '', shared_link: { url: LINK_PASTA }, recursive: false });
    const segunda = d.chamadas.find((c) => c.url.endsWith('/files/list_folder/continue'))!;
    expect(corpoDe(segunda)).toEqual({ cursor: 'c1' });
  });

  it('Dropbox 5xx vira "fora do ar", com status 503', async () => {
    const d = dropbox({
      '/oauth2/token': TOKEN_OK,
      '/sharing/get_shared_link_metadata': () => new Response('Internal Server Error', { status: 503 }),
    });
    const e = await recusa(clienteDoDropbox(CRED, { fetch: d.fetchFalso }).conferirLink(LINK_ARQUIVO));
    expect(e.motivo).toBe('dropbox_fora');
    expect(e.status).toBe(503);
    expect(e.message).toBe('O Dropbox não respondeu agora. Tente de novo em instantes.');
  });

  it('falha de rede (ou tempo esgotado) também vira "fora do ar"', async () => {
    const d = dropbox({
      '/oauth2/token': TOKEN_OK,
      '/sharing/get_shared_link_metadata': () => {
        throw new TypeError('fetch failed');
      },
    });
    const e = await recusa(clienteDoDropbox(CRED, { fetch: d.fetchFalso }).conferirLink(LINK_ARQUIVO));
    expect(e.motivo).toBe('dropbox_fora');
  });

  it('tempo esgotado aborta a chamada', async () => {
    const lento = ((_: unknown, init?: RequestInit) =>
      new Promise((_r, rejeitar) => {
        init?.signal?.addEventListener('abort', () => rejeitar(new Error('aborted')));
      })) as typeof fetch;
    const e = await recusa(
      clienteDoDropbox(CRED, { fetch: lento, tempoLimiteMs: 10 }).conferirLink(LINK_ARQUIVO),
    );
    expect(e.motivo).toBe('dropbox_fora');
  });
});

describe('crachá', () => {
  it('crachá vencido (401 expired_access_token) é renovado uma vez e a chamada repete', async () => {
    let token = 0;
    const d = dropbox({
      '/oauth2/token': () => json({ access_token: `tok-${++token}`, expires_in: 14400 }),
      '/sharing/get_shared_link_metadata': (_c, n) =>
        n === 1
          ? json({ error_summary: 'expired_access_token/', error: { '.tag': 'expired_access_token' } }, 401)
          : json(metaArquivo()),
    });
    const r = await clienteDoDropbox(CRED, { fetch: d.fetchFalso }).lerLink(LINK_ARQUIVO);
    expect(r.rev).toBe('015f1a2b3c4d');
    expect(d.vezes('/oauth2/token')).toBe(2);
    const consultas = d.chamadas.filter((c) => c.url.endsWith('get_shared_link_metadata'));
    expect(consultas.map(autorizacao)).toEqual(['Bearer tok-1', 'Bearer tok-2']);
  });

  it('crachá em cache é reaproveitado até perto de vencer', async () => {
    let relogio = 0;
    const d = dropbox({
      '/oauth2/token': TOKEN_OK,
      '/sharing/get_shared_link_metadata': () => json(metaArquivo()),
    });
    const cliente = clienteDoDropbox(CRED, { fetch: d.fetchFalso, agora: () => relogio });
    await cliente.lerLink(LINK_ARQUIVO);
    relogio = 3 * 3600 * 1000; // 3 h depois: ainda vale (4 h − 5 min de margem)
    await cliente.lerLink(LINK_ARQUIVO);
    expect(d.vezes('/oauth2/token')).toBe(1);
    relogio = 4 * 3600 * 1000 - 60_000; // dentro da margem: renova
    await cliente.lerLink(LINK_ARQUIVO);
    expect(d.vezes('/oauth2/token')).toBe(2);
  });

  it('401 persistente vira "crachá inválido"', async () => {
    const d = dropbox({
      '/oauth2/token': TOKEN_OK,
      '/sharing/get_shared_link_metadata': () =>
        json({ error_summary: 'invalid_access_token/', error: { '.tag': 'invalid_access_token' } }, 401),
    });
    const e = await recusa(clienteDoDropbox(CRED, { fetch: d.fetchFalso }).lerLink(LINK_ARQUIVO));
    expect(e.motivo).toBe('cracha_invalido');
    expect(e.status).toBe(503);
  });

  it('refresh token revogado (invalid_grant) vira "crachá inválido", sem consultar o link', async () => {
    const d = dropbox({
      '/oauth2/token': () => json({ error: 'invalid_grant', error_description: 'refresh token is malformed' }, 400),
    });
    const e = await recusa(clienteDoDropbox(CRED, { fetch: d.fetchFalso }).lerLink(LINK_ARQUIVO));
    expect(e.motivo).toBe('cracha_invalido');
    expect(e.message).toContain('refazer a autorização');
    expect(e.detalhe).toContain('invalid_grant');
    expect(d.chamadas.every((c) => c.url.endsWith('/oauth2/token'))).toBe(true);
  });

  it('app sem a permissão (401 missing_scope) diz qual passo refazer', async () => {
    const d = dropbox({
      '/oauth2/token': TOKEN_OK,
      '/sharing/get_shared_link_metadata': () =>
        json(
          { error_summary: 'missing_scope/', error: { '.tag': 'missing_scope', required_scope: 'sharing.read' } },
          401,
        ),
    });
    const e = await recusa(clienteDoDropbox(CRED, { fetch: d.fetchFalso }).lerLink(LINK_ARQUIVO));
    expect(e.motivo).toBe('permissao_faltando');
  });
});

describe('baixarDoLink', () => {
  it('repassa Range ao get_shared_link_file e devolve 206 com o tipo do arquivo', async () => {
    const d = dropbox({
      '/oauth2/token': TOKEN_OK,
      '/sharing/get_shared_link_file': () =>
        new Response('abcdef', {
          status: 206,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Range': 'bytes 0-5/52428800',
            'Content-Length': '6',
            'Dropbox-API-Result': JSON.stringify({ name: 'reels.mov', rev: 'rv' }),
          },
        }),
    });
    const r = await clienteDoDropbox(CRED, { fetch: d.fetchFalso }).baixarDoLink(
      LINK_PASTA,
      'reels.mov',
      'bytes=0-5',
    );
    expect(r.resposta.status).toBe(206);
    expect(r.rev).toBe('rv');
    expect(r.resposta.headers.get('Content-Type')).toBe('video/quicktime');
    expect(r.resposta.headers.get('Content-Range')).toBe('bytes 0-5/52428800');
    expect(await r.resposta.text()).toBe('abcdef');

    const chamada = d.chamadas.find((c) => c.url.endsWith('get_shared_link_file'))!;
    expect(chamada.url).toBe('https://content.dropboxapi.com/2/sharing/get_shared_link_file');
    const h = new Headers(chamada.init.headers);
    expect(h.get('Range')).toBe('bytes=0-5');
    expect(JSON.parse(h.get('Dropbox-API-Arg')!)).toEqual({ url: LINK_PASTA, path: '/reels.mov' });
  });

  it('nome com acento vai escapado no cabeçalho (o Dropbox exige ASCII)', async () => {
    const d = dropbox({
      '/oauth2/token': TOKEN_OK,
      '/sharing/get_shared_link_file': () =>
        new Response('x', { status: 200, headers: { 'Dropbox-API-Result': '{}' } }),
    });
    await clienteDoDropbox(CRED, { fetch: d.fetchFalso }).baixarDoLink(LINK_PASTA, '/Promoção.jpg');
    const h = new Headers(d.chamadas.find((c) => c.url.endsWith('get_shared_link_file'))!.init.headers);
    const arg = h.get('Dropbox-API-Arg')!;
    expect(arg).toMatch(/^[\x20-\x7e]+$/);
    expect(JSON.parse(arg).path).toBe('/Promoção.jpg');
  });
});
