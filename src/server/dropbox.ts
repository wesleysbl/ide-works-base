/**
 * Conexão com o Dropbox, só leitura — F42 Fase 2.
 *
 * PARA QUE SERVE
 *   A aprovação do cliente aponta para material no Dropbox (o Ide Works não
 *   guarda vídeo). Este módulo responde três perguntas sobre um link colado
 *   pela equipe:
 *
 *     1. ele está aberto para qualquer pessoa? (o cliente não tem conta)
 *     2. quais arquivos ele contém? (link de arquivo = um; link de pasta = a lista)
 *     3. qual a versão (`rev`) atual de cada um? (prova do que foi aprovado)
 *
 * SÓ LEITURA, E SÓ TRÊS ROTAS
 *   `sharing/get_shared_link_metadata` e `sharing/get_shared_link_file` pedem o
 *   escopo `sharing.read`; `files/list_folder` (+ `/continue`) pede
 *   `files.metadata.read`. Nenhuma rota de escrita é chamada aqui — e o app do
 *   Dropbox nem tem permissão para isso (ver `docs/tutoriais/dropbox.md`).
 *   Fonte dos escopos: `sharing.stone` e `files.stone` do repositório oficial
 *   `dropbox/dropbox-api-spec`.
 *
 * O CRACHÁ
 *   O segredo de longo prazo é o refresh token (`token_access_type=offline`).
 *   O access token dura ~4 h; ele é renovado sob demanda e guardado em memória
 *   no isolado, com margem de 5 min. Um 401 com o crachá em cache força UMA
 *   renovação e repete a chamada; o segundo 401 vira `cracha_invalido`.
 *
 * EXIBIR SEM LOGIN
 *   - Link de ARQUIVO: o próprio link com `raw=1` (preservando `rlkey`) abre o
 *     arquivo direto no navegador, sem a página de prévia do Dropbox.
 *     Documentado em help.dropbox.com/share/force-download.
 *   - Arquivo DENTRO de um link de PASTA: o Dropbox não documenta endereço
 *     direto por arquivo. O caminho oficial é `sharing/get_shared_link_file`
 *     com `path` relativo — rota de download que aceita `Range` (como todas as
 *     rotas "content-download" da API v2). Então quem exibe é o Worker,
 *     repassando os bytes: `baixarDoLink` devolve a resposta em fluxo, com
 *     `Range`/206 preservados, para a rota pública da Fase 5 servir.
 *
 * SEM DEPENDÊNCIAS
 *   Nada é importado de propósito: o script `scripts/provar-dropbox.mjs` roda
 *   este arquivo direto no Node (remoção de tipos), sem o atalho `@/`. Por isso
 *   também não há `enum` nem propriedade de parâmetro em construtor.
 */

/* ─────────────────────────── segredos ─────────────────────────── */

export const SEGREDOS_DO_DROPBOX = [
  'IDEWORKS_DROPBOX_APP_KEY',
  'IDEWORKS_DROPBOX_APP_SECRET',
  'IDEWORKS_DROPBOX_REFRESH_TOKEN',
] as const;

export type CredenciaisDoDropbox = {
  appKey: string;
  appSecret: string;
  refreshToken: string;
};

/**
 * Lê as três chaves do ambiente. Variável vazia conta como ausente (segredo
 * apagado deixa a variável definida e vazia).
 */
export function credenciaisDoDropbox(
  env: Partial<Record<string, unknown>>,
): { ok: true; credenciais: CredenciaisDoDropbox } | { ok: false; faltando: string[] } {
  const valor = (nome: string) => {
    const v = env[nome];
    return typeof v === 'string' ? v.trim() : '';
  };
  const faltando = SEGREDOS_DO_DROPBOX.filter((n) => valor(n) === '');
  if (faltando.length > 0) return { ok: false, faltando: [...faltando] };
  return {
    ok: true,
    credenciais: {
      appKey: valor('IDEWORKS_DROPBOX_APP_KEY'),
      appSecret: valor('IDEWORKS_DROPBOX_APP_SECRET'),
      refreshToken: valor('IDEWORKS_DROPBOX_REFRESH_TOKEN'),
    },
  };
}

/* ─────────────────────────── recusas ─────────────────────────── */

export type MotivoDaRecusa =
  | 'sem_credencial'
  | 'cracha_invalido'
  | 'permissao_faltando'
  | 'dropbox_fora'
  | 'link_invalido'
  | 'link_nao_suportado'
  | 'link_inexistente'
  | 'link_fechado'
  | 'link_com_senha'
  | 'link_sem_download';

/** As frases que a equipe lê. Dizem o que aconteceu e o que fazer. */
export const FRASES_DO_DROPBOX: Record<MotivoDaRecusa, string> = {
  sem_credencial:
    'A conexão com o Dropbox ainda não foi configurada neste ambiente. Avise um admin.',
  cracha_invalido:
    'A conexão do Ide Works com o Dropbox caiu. Avise um admin: é preciso refazer a ' +
    'autorização do Dropbox (tutorial do Dropbox, passo 4).',
  permissao_faltando:
    'O app do Dropbox está sem a permissão de leitura necessária. Avise um admin ' +
    '(tutorial do Dropbox, passo 2).',
  dropbox_fora: 'O Dropbox não respondeu agora. Tente de novo em instantes.',
  link_invalido:
    'Isto não parece um link do Dropbox. No Dropbox, clique em Compartilhar → Copiar link ' +
    'e cole aqui.',
  link_nao_suportado:
    'Este tipo de link do Dropbox não é aceito. Use um link de arquivo ou de pasta ' +
    '(Compartilhar → Copiar link).',
  link_inexistente:
    'Este link do Dropbox não existe mais ou expirou. Gere um link novo no Dropbox e cole aqui.',
  link_fechado:
    'Este link do Dropbox não está aberto para qualquer pessoa, e o cliente não conseguiria ' +
    'abrir. No Dropbox, em Compartilhar → Configurações do link, escolha "Qualquer pessoa com ' +
    'o link" e cole o link de novo.',
  link_com_senha:
    'Este link do Dropbox pede senha, e o cliente não teria como abrir. Tire a senha nas ' +
    'configurações do link no Dropbox e cole o link de novo.',
  link_sem_download:
    'Este link do Dropbox está com o download desligado, e assim o material não toca fora do ' +
    'Dropbox. Nas configurações do link, ligue "Permitir downloads" e cole o link de novo.',
};

/** Status HTTP sugerido para a rota que repassar a recusa. */
const STATUS_DA_RECUSA: Record<MotivoDaRecusa, 422 | 503> = {
  sem_credencial: 503,
  cracha_invalido: 503,
  permissao_faltando: 503,
  dropbox_fora: 503,
  link_invalido: 422,
  link_nao_suportado: 422,
  link_inexistente: 422,
  link_fechado: 422,
  link_com_senha: 422,
  link_sem_download: 422,
};

export class DropboxRecusa extends Error {
  readonly motivo: MotivoDaRecusa;
  readonly status: 422 | 503;
  /** O que o Dropbox disse, para o log. Nunca vai para a tela. */
  readonly detalhe: string | null;

  constructor(motivo: MotivoDaRecusa, detalhe: string | null = null) {
    super(FRASES_DO_DROPBOX[motivo]);
    this.name = 'DropboxRecusa';
    this.motivo = motivo;
    this.status = STATUS_DA_RECUSA[motivo];
    this.detalhe = detalhe;
  }
}

/* ─────────────────────────── tipos de arquivo ─────────────────────────── */

export type Midia = 'video' | 'imagem' | 'outro';

const TIPOS: Record<string, { midia: Midia; mime: string }> = {
  mp4: { midia: 'video', mime: 'video/mp4' },
  m4v: { midia: 'video', mime: 'video/mp4' },
  mov: { midia: 'video', mime: 'video/quicktime' },
  webm: { midia: 'video', mime: 'video/webm' },
  jpg: { midia: 'imagem', mime: 'image/jpeg' },
  jpeg: { midia: 'imagem', mime: 'image/jpeg' },
  png: { midia: 'imagem', mime: 'image/png' },
  gif: { midia: 'imagem', mime: 'image/gif' },
  webp: { midia: 'imagem', mime: 'image/webp' },
  avif: { midia: 'imagem', mime: 'image/avif' },
  // HEIC só abre no Safari; continua sendo imagem para a aprovação.
  heic: { midia: 'imagem', mime: 'image/heic' },
};

function extensao(nome: string): string {
  const ponto = nome.lastIndexOf('.');
  return ponto < 0 ? '' : nome.slice(ponto + 1).toLowerCase();
}

/** Vídeo, imagem ou outro — pela extensão do nome (o Dropbox não manda mime). */
export function midiaDoArquivo(nome: string): Midia {
  return TIPOS[extensao(nome)]?.midia ?? 'outro';
}

/** O `Content-Type` para servir os bytes. Desconhecido = octet-stream. */
export function mimeDoArquivo(nome: string): string {
  return TIPOS[extensao(nome)]?.mime ?? 'application/octet-stream';
}

/* ─────────────────────────── endereços ─────────────────────────── */

const HOSPEDEIROS = new Set(['dropbox.com', 'www.dropbox.com']);

function urlDoDropbox(link: string): URL | null {
  let u: URL;
  try {
    u = new URL(link.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !HOSPEDEIROS.has(u.hostname.toLowerCase())) return null;
  return u;
}

/** Link de arquivo (`/scl/fi/…` ou o antigo `/s/…`), de pasta, ou nenhum. */
export function formaDoLink(link: string): 'arquivo' | 'pasta' | null {
  const u = urlDoDropbox(link);
  if (!u) return null;
  if (/^\/(scl\/fi|s)\//.test(u.pathname)) return 'arquivo';
  if (/^\/(scl\/fo|sh)\//.test(u.pathname)) return 'pasta';
  return null;
}

/**
 * O endereço que abre o ARQUIVO direto no navegador, sem login e sem a página
 * de prévia: o próprio link com `raw=1`. `rlkey` (a chave dos links `scl`) e
 * os demais parâmetros ficam; `dl` sai, porque `dl=1` forçaria download.
 *
 * Link de pasta devolve `null`: não há endereço documentado por arquivo — os
 * arquivos da pasta são servidos pelo Worker via `baixarDoLink`.
 */
export function enderecoDeExibicao(link: string): string | null {
  const u = urlDoDropbox(link);
  if (!u || formaDoLink(link) !== 'arquivo') return null;
  u.searchParams.delete('dl');
  u.searchParams.set('raw', '1');
  u.hostname = 'www.dropbox.com';
  return u.toString();
}

/* ─────────────────────────── visibilidade ─────────────────────────── */

export type Visibilidade =
  | 'publico'
  | 'equipe'
  | 'senha'
  | 'so_logado'
  | 'so_membros'
  | 'ninguem'
  | 'desconhecida';

export const NOMES_DA_VISIBILIDADE: Record<Visibilidade, string> = {
  publico: 'qualquer pessoa com o link',
  equipe: 'só a equipe do Dropbox',
  senha: 'com senha',
  so_logado: 'só quem entra numa conta do Dropbox',
  so_membros: 'só quem foi convidado para o conteúdo',
  ninguem: 'ninguém além de quem já tem acesso',
  desconhecida: 'o Dropbox não informou',
};

type Tag = { '.tag'?: string } | undefined | null;

type PermissoesDoLink = {
  resolved_visibility?: Tag;
  effective_audience?: Tag;
  require_password?: boolean | null;
  allow_download?: boolean | null;
};

/**
 * Resolve a visibilidade. O Dropbox devolve `resolved_visibility` (campo
 * antigo) OU `effective_audience` (novo), conforme o link — os dois são lidos.
 * `require_password` vence os dois: link "público" com senha não é aberto.
 */
export function visibilidadeDoLink(p: PermissoesDoLink | undefined): Visibilidade {
  if (!p) return 'desconhecida';
  if (p.require_password === true) return 'senha';
  const resolvida = p.resolved_visibility?.['.tag'];
  const audiencia = p.effective_audience?.['.tag'];
  switch (resolvida) {
    case 'public':
      return 'publico';
    case 'team_only':
      return 'equipe';
    case 'password':
    case 'team_and_password':
      return 'senha';
    case 'shared_folder_only':
      return 'so_membros';
    case 'no_one':
    case 'only_you':
      return 'ninguem';
  }
  switch (audiencia) {
    case 'public':
      return 'publico';
    case 'team':
      return 'equipe';
    case 'password':
      return 'senha';
    case 'public_logged_in_only':
      return 'so_logado';
    case 'members':
      return 'so_membros';
    case 'no_one':
      return 'ninguem';
  }
  return 'desconhecida';
}

/* ─────────────────────────── o que o módulo devolve ─────────────────────────── */

export type LinkDoDropbox = {
  /** O link como o Dropbox o reconhece (canônico). */
  url: string;
  tipo: 'arquivo' | 'pasta';
  id: string | null;
  nome: string;
  /** Só arquivo. Muda a cada nova versão do arquivo. */
  rev: string | null;
  tamanho: number | null;
  modificadoEm: string | null;
  visibilidade: Visibilidade;
  /** Download liberado no link. Desligado = `raw=1` e repasse não funcionam. */
  permiteBaixar: boolean;
  /** Só arquivo. */
  midia: Midia | null;
};

export type ArquivoDoDropbox = {
  id: string;
  nome: string;
  rev: string;
  tamanho: number;
  modificadoEm: string | null;
  midia: Midia;
  /**
   * Caminho relativo à raiz do link, para `baixarDoLink`. Nulo quando o
   * arquivo É o link (link de arquivo).
   */
  caminho: string | null;
  /** `raw=1` do link de arquivo; nulo para arquivo de pasta (vai pelo Worker). */
  enderecoDeExibicao: string | null;
};

export type ConferenciaDoLink = {
  link: LinkDoDropbox;
  arquivos: ArquivoDoDropbox[];
  /** Subpastas de um link de pasta: não entram (a listagem não é recursiva). */
  subpastasIgnoradas: number;
};

/**
 * A recusa que o link merece pela visibilidade, ou nula se o cliente consegue
 * abrir. Visibilidade desconhecida também é recusa: sem prova de que está
 * aberto, não se envia.
 */
export function recusaDaVisibilidade(link: LinkDoDropbox): DropboxRecusa | null {
  if (link.visibilidade === 'senha') return new DropboxRecusa('link_com_senha');
  if (link.visibilidade !== 'publico') {
    return new DropboxRecusa('link_fechado', `visibilidade: ${link.visibilidade}`);
  }
  if (!link.permiteBaixar) return new DropboxRecusa('link_sem_download');
  return null;
}

/* ─────────────────────────── o cliente HTTP ─────────────────────────── */

const API = 'https://api.dropboxapi.com/2';
const CONTEUDO = 'https://content.dropboxapi.com/2';
const TOKEN = 'https://api.dropboxapi.com/oauth2/token';
/** Renova 5 min antes de vencer. */
const MARGEM_MS = 5 * 60 * 1000;
/** Teto de páginas de `list_folder` — 2.000 itens por página, folga enorme. */
const TETO_DE_PAGINAS = 20;

type Cracha = { token: string; validoAte: number };

/**
 * Cache do crachá no isolado, por app + refresh token. Fora do objeto do
 * cliente para sobreviver entre requisições do mesmo isolado.
 */
const crachas = new Map<string, Cracha>();
const renovando = new Map<string, Promise<Cracha>>();

/** Para teste: esquece todos os crachás guardados. */
export function esquecerCrachasDoDropbox(): void {
  crachas.clear();
  renovando.clear();
}

export type OpcoesDoDropbox = {
  /** Injetado em teste; padrão é o `fetch` global no momento da chamada. */
  fetch?: typeof fetch;
  /** Relógio, para teste da validade do crachá. */
  agora?: () => number;
  /** Tempo máximo de uma chamada à API (padrão 10 s). */
  tempoLimiteMs?: number;
};

export type DownloadDoDropbox = {
  /** Status 200 ou 206, corpo em fluxo, cabeçalhos prontos para repassar. */
  resposta: Response;
  /** A versão servida — para conferir contra a rodada. */
  rev: string | null;
};

export type ClienteDoDropbox = {
  /** Dados de um link: arquivo ou pasta, versão, visibilidade. */
  lerLink(url: string): Promise<LinkDoDropbox>;
  /** Arquivos (só arquivos, não recursivo) de um link de PASTA, paginando. */
  listarPasta(url: string): Promise<{ arquivos: ArquivoDoDropbox[]; subpastasIgnoradas: number }>;
  /**
   * Lê o link, recusa se o cliente não conseguir abrir e devolve os arquivos
   * com versão. É a pergunta inteira da Fase 2 numa chamada.
   */
  conferirLink(url: string): Promise<ConferenciaDoLink>;
  /**
   * Os bytes de um arquivo do link (`caminho` relativo, para link de pasta),
   * repassando `Range` — é por aqui que o Worker exibe arquivo de pasta.
   */
  baixarDoLink(url: string, caminho: string | null, range?: string | null): Promise<DownloadDoDropbox>;
};

type ErroDoDropbox = { error_summary?: string; error?: Record<string, unknown> & { '.tag'?: string } };

/** Junta as tags aninhadas: `{'.tag':'path','path':{'.tag':'not_found'}}` → `path/not_found`. */
function tagsDoErro(corpo: ErroDoDropbox | null): string {
  const partes: string[] = [];
  let atual: unknown = corpo?.error;
  for (let i = 0; i < 4 && atual && typeof atual === 'object'; i += 1) {
    const tag = (atual as { '.tag'?: unknown })['.tag'];
    if (typeof tag !== 'string') break;
    partes.push(tag);
    atual = (atual as Record<string, unknown>)[tag];
  }
  return partes.join('/') || (corpo?.error_summary ?? '');
}

function recusaDo409(tags: string): DropboxRecusa {
  if (tags.startsWith('shared_link_not_found') || tags.includes('not_found')) {
    return new DropboxRecusa('link_inexistente', tags);
  }
  if (tags.startsWith('shared_link_access_denied')) return new DropboxRecusa('link_fechado', tags);
  if (tags.startsWith('unsupported_link_type') || tags.startsWith('shared_link_is_directory')) {
    return new DropboxRecusa('link_nao_suportado', tags);
  }
  if (tags.includes('restricted_content') || tags.includes('unsupported_content_type')) {
    return new DropboxRecusa('link_sem_download', tags);
  }
  // Conflito desconhecido: tratado como link inutilizável, com a tag no log.
  return new DropboxRecusa('link_inexistente', tags);
}

/** JSON seguro para cabeçalho HTTP: o Dropbox exige não-ASCII escapado. */
function jsonParaCabecalho(valor: unknown): string {
  return JSON.stringify(valor).replace(
    /[\u007f-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

const lerJson = async (r: Response): Promise<unknown> => {
  const texto = await r.text().catch(() => '');
  try {
    return JSON.parse(texto);
  } catch {
    return texto === '' ? null : { error_summary: texto.slice(0, 300) };
  }
};

export function clienteDoDropbox(
  credenciais: CredenciaisDoDropbox,
  opcoes: OpcoesDoDropbox = {},
): ClienteDoDropbox {
  const agora = opcoes.agora ?? (() => Date.now());
  const limite = opcoes.tempoLimiteMs ?? 10_000;
  const chave = `${credenciais.appKey}:${credenciais.refreshToken}`;
  const buscar = (url: string, init: RequestInit) => (opcoes.fetch ?? globalThis.fetch)(url, init);

  /** `fetch` com tempo limite; falha de rede vira `dropbox_fora`. */
  async function chamar(url: string, init: RequestInit): Promise<Response> {
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), limite);
    try {
      return await buscar(url, { ...init, signal: controle.signal });
    } catch (e) {
      throw new DropboxRecusa('dropbox_fora', e instanceof Error ? e.message : String(e));
    } finally {
      // O tempo limite vale até chegarem os cabeçalhos: no download, o corpo
      // em fluxo pode durar o vídeo inteiro.
      clearTimeout(relogio);
    }
  }

  async function renovar(): Promise<Cracha> {
    const corpo = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credenciais.refreshToken,
      client_id: credenciais.appKey,
      client_secret: credenciais.appSecret,
    });
    const r = await chamar(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corpo.toString(),
    });
    const dados = (await lerJson(r)) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    } | null;
    if (r.status >= 500 || r.status === 429) {
      throw new DropboxRecusa('dropbox_fora', `oauth2/token ${r.status}`);
    }
    if (!r.ok || !dados?.access_token) {
      throw new DropboxRecusa(
        'cracha_invalido',
        `oauth2/token ${r.status}: ${dados?.error ?? ''} ${dados?.error_description ?? ''}`.trim(),
      );
    }
    const segundos = Number(dados.expires_in);
    const cracha = {
      token: dados.access_token,
      validoAte: agora() + (Number.isFinite(segundos) ? segundos * 1000 : 3600_000) - MARGEM_MS,
    };
    crachas.set(chave, cracha);
    return cracha;
  }

  async function cracha(forcar: boolean): Promise<string> {
    const guardado = crachas.get(chave);
    if (!forcar && guardado && guardado.validoAte > agora()) return guardado.token;
    // Pedidos simultâneos dividem uma renovação só.
    let emCurso = renovando.get(chave);
    if (!emCurso) {
      emCurso = renovar().finally(() => renovando.delete(chave));
      renovando.set(chave, emCurso);
    }
    return (await emCurso).token;
  }

  /**
   * Chama a API com o crachá; num 401, renova UMA vez e repete. Devolve a
   * resposta bem-sucedida, ou lança a recusa certa.
   */
  async function comCracha(
    montar: (token: string) => [string, RequestInit],
  ): Promise<Response> {
    for (let tentativa = 0; tentativa < 2; tentativa += 1) {
      const token = await cracha(tentativa > 0);
      const [url, init] = montar(token);
      const r = await chamar(url, init);
      if (r.ok) return r;

      const corpo = (await lerJson(r)) as ErroDoDropbox | null;
      const tags = tagsDoErro(corpo);
      if (r.status === 401) {
        if (tags.startsWith('missing_scope')) throw new DropboxRecusa('permissao_faltando', tags);
        if (tentativa === 0) {
          crachas.delete(chave);
          continue;
        }
        throw new DropboxRecusa('cracha_invalido', tags);
      }
      if (r.status === 409) throw recusaDo409(tags);
      if (r.status === 400) {
        // 400 do Dropbox é argumento rejeitado; com URL vinda da equipe, é o link.
        throw new DropboxRecusa('link_invalido', `400: ${tags}`);
      }
      if (r.status === 403) throw new DropboxRecusa('permissao_faltando', `403: ${tags}`);
      if (r.status === 416) return r; // Range fora do arquivo: o navegador decide.
      throw new DropboxRecusa('dropbox_fora', `${r.status}: ${tags}`);
    }
    throw new DropboxRecusa('cracha_invalido');
  }

  async function rpc<T>(rota: string, arg: unknown): Promise<T> {
    const r = await comCracha((token) => [
      `${API}/${rota}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(arg),
      },
    ]);
    return (await lerJson(r)) as T;
  }

  function exigirLink(url: string): string {
    const u = urlDoDropbox(url);
    if (!u || formaDoLink(url) === null) throw new DropboxRecusa('link_invalido', url.slice(0, 200));
    return u.toString();
  }

  async function lerLink(url: string): Promise<LinkDoDropbox> {
    const link = exigirLink(url);
    const m = await rpc<{
      '.tag'?: string;
      url?: string;
      id?: string;
      name?: string;
      rev?: string;
      size?: number;
      server_modified?: string;
      link_permissions?: PermissoesDoLink;
    }>('sharing/get_shared_link_metadata', { url: link });

    const tipo = m['.tag'] === 'folder' ? 'pasta' : m['.tag'] === 'file' ? 'arquivo' : null;
    if (!tipo) throw new DropboxRecusa('link_nao_suportado', `tag: ${String(m['.tag'])}`);
    const nome = m.name ?? '';
    return {
      url: m.url ?? link,
      tipo,
      id: m.id ?? null,
      nome,
      rev: tipo === 'arquivo' ? (m.rev ?? null) : null,
      tamanho: tipo === 'arquivo' && typeof m.size === 'number' ? m.size : null,
      modificadoEm: m.server_modified ?? null,
      visibilidade: visibilidadeDoLink(m.link_permissions),
      // Ausente = permitido (o padrão do Dropbox).
      permiteBaixar: m.link_permissions?.allow_download !== false,
      midia: tipo === 'arquivo' ? midiaDoArquivo(nome) : null,
    };
  }

  type Entrada = {
    '.tag'?: string;
    id?: string;
    name?: string;
    rev?: string;
    size?: number;
    server_modified?: string;
    is_downloadable?: boolean;
  };
  type Pagina = { entries?: Entrada[]; cursor?: string; has_more?: boolean };

  async function listarPasta(url: string) {
    const link = exigirLink(url);
    const arquivos: ArquivoDoDropbox[] = [];
    let subpastasIgnoradas = 0;

    let pagina = await rpc<Pagina>('files/list_folder', {
      path: '',
      shared_link: { url: link },
      recursive: false,
    });
    for (let i = 0; ; i += 1) {
      for (const e of pagina.entries ?? []) {
        if (e['.tag'] === 'folder') subpastasIgnoradas += 1;
        if (e['.tag'] !== 'file' || !e.id || !e.name || !e.rev) continue;
        // Google Docs e afins não têm bytes para mostrar.
        if (e.is_downloadable === false) continue;
        arquivos.push({
          id: e.id,
          nome: e.name,
          rev: e.rev,
          tamanho: typeof e.size === 'number' ? e.size : 0,
          modificadoEm: e.server_modified ?? null,
          midia: midiaDoArquivo(e.name),
          caminho: `/${e.name}`,
          enderecoDeExibicao: null,
        });
      }
      if (!pagina.has_more || !pagina.cursor) break;
      if (i + 1 >= TETO_DE_PAGINAS) {
        throw new DropboxRecusa('link_nao_suportado', `pasta com mais de ${TETO_DE_PAGINAS} páginas`);
      }
      pagina = await rpc<Pagina>('files/list_folder/continue', { cursor: pagina.cursor });
    }

    // Ordem natural do nome: "2.jpg" antes de "10.jpg" — vira a ordem inicial do carrossel.
    arquivos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }));
    return { arquivos, subpastasIgnoradas };
  }

  async function conferirLink(url: string): Promise<ConferenciaDoLink> {
    const link = await lerLink(url);
    const recusa = recusaDaVisibilidade(link);
    if (recusa) throw recusa;

    if (link.tipo === 'arquivo') {
      if (!link.id || !link.rev) throw new DropboxRecusa('link_nao_suportado', 'arquivo sem id/rev');
      return {
        link,
        subpastasIgnoradas: 0,
        arquivos: [
          {
            id: link.id,
            nome: link.nome,
            rev: link.rev,
            tamanho: link.tamanho ?? 0,
            modificadoEm: link.modificadoEm,
            midia: link.midia ?? 'outro',
            caminho: null,
            enderecoDeExibicao: enderecoDeExibicao(link.url) ?? enderecoDeExibicao(url),
          },
        ],
      };
    }
    const { arquivos, subpastasIgnoradas } = await listarPasta(url);
    return { link, arquivos, subpastasIgnoradas };
  }

  async function baixarDoLink(
    url: string,
    caminho: string | null,
    range?: string | null,
  ): Promise<DownloadDoDropbox> {
    const link = exigirLink(url);
    const arg: Record<string, string> = { url: link };
    if (caminho) arg.path = caminho.startsWith('/') ? caminho : `/${caminho}`;

    const r = await comCracha((token) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        'Dropbox-API-Arg': jsonParaCabecalho(arg),
      };
      if (range) headers.Range = range;
      return [`${CONTEUDO}/sharing/get_shared_link_file`, { method: 'POST', headers }];
    });

    let meta: { name?: string; rev?: string } = {};
    try {
      meta = JSON.parse(r.headers.get('Dropbox-API-Result') ?? '{}');
    } catch {
      meta = {};
    }
    const nome = meta.name ?? caminho ?? '';
    const cabecalhos = new Headers({
      'Content-Type': mimeDoArquivo(nome),
      'Accept-Ranges': 'bytes',
      // Material do cliente não fica em cache compartilhado.
      'Cache-Control': 'private, max-age=300',
    });
    for (const h of ['Content-Length', 'Content-Range', 'ETag', 'Last-Modified']) {
      const v = r.headers.get(h);
      if (v) cabecalhos.set(h, v);
    }
    return {
      resposta: new Response(r.body, { status: r.status, headers: cabecalhos }),
      rev: meta.rev ?? null,
    };
  }

  return { lerLink, listarPasta, conferirLink, baixarDoLink };
}
