/**
 * Sessão: do crachá ao ator — etapa F4.1.
 *
 * COMO O CRACHÁ É CONFERIDO
 *   A cada chamada, perguntamos ao provedor de autenticação se aquele crachá é
 *   válido e de quem é. **Não há atalho e não há cache.** Guardar a resposta
 *   pouparia uma chamada e criaria uma janela em que uma conta desativada
 *   continua entrando — exatamente o tipo de brecha que não aparece em teste
 *   porque depende de tempo.
 *
 * DUAS CONFERÊNCIAS, NÃO UMA
 *   O crachá diz **quem é a pessoa**. Ele não diz se ela tem acesso ao IDE
 *   Works. Como a autenticação é compartilhada com o Sistema IDE em produção
 *   (decisão D8), as 21 contas do legado têm crachá válido aqui.
 *
 *   Por isso, depois de validar o crachá, ainda é preciso encontrar o perfil —
 *   e ele precisa estar ativo. Quem foi desativado enquanto navegava para na
 *   requisição seguinte, não quando o crachá vencer sozinho.
 */

import { type Area, podeChamar, recusaDeArea } from '@/auth/areas';
import { type Papel } from '@/auth/papeis';
import { type Actor, type Sql, inlineUuid, userActor, withActor } from '@/server/db';
import { conferirOmitidas, lerNomesOmitidos } from '@/server/omitidas';

export type AuthenticatedActor = {
  userId: string;
  email: string;
  /** super_admin > admin > funcionario — F14. */
  papel: Papel;
  /** Verdadeiro para super_admin E administrador: quem ADMINISTRA. */
  isSuperadmin: boolean;
  /** Só o topo. É ele que cria outro super admin e apaga pessoa. */
  isSuper: boolean;
  /** As partes do sistema que esta pessoa alcanca — F13. */
  areas: Area[];
  hasAllClientsAccess: boolean;
  /**
   * O nome da pessoa, para o chip da conta no pé da barra — F29.
   *
   * Sai da MESMA coluna que a tela de Pessoas mostra (`profiles.full_name`, via
   * `admin_directory()`), lida na mesma linha que esta conferência já busca: é
   * uma coluna a mais no `select`, e não uma ida a mais ao banco por pedido.
   *
   * OPCIONAL de propósito: os atores montados à mão (suítes, integração) não
   * precisam de nome, e ausente quer dizer o mesmo que `null` — a tela mostra
   * o e-mail. Vazio ou só espaços também vira `null`: um nome em branco no chip
   * seria pior que o e-mail.
   */
  nome?: string | null;
  /**
   * As empresas OMITIDAS desta instalação, em ids — F31.
   *
   * Vem de `IDEWORKS_EMPRESAS_OMITIDAS` (por nome, resolvida em
   * `server/omitidas.ts`) e viaja no ator porque é ele que toda leitura já
   * recebe: cada consulta de cliente, espaço, lista ou tarefa monta o recorte
   * com os ajudantes de lá, sem parâmetro novo em cada assinatura.
   *
   * OPCIONAL de propósito: ausente quer dizer "nada omitido", que é o
   * comportamento de antes da F31. Os atores montados à mão (suítes)
   * continuam como eram. O AGENTE de IA não usa este ator: leva as omitidas
   * em `PersonAccess.omittedCompanyIds` (F31, Fase 3b — `integrations/grants.ts`).
   */
  categoriasOmitidas?: readonly string[];
};

export type SessionRefusal =
  | 'no_token'
  | 'invalid_token'
  | 'no_ideworks_profile'
  | 'account_disabled'
  /**
   * Entrou, mas esta parte do sistema não é dele — F13.
   *
   * É um motivo PRÓPRIO, e não `no_ideworks_profile`: quem não tem perfil não
   * entra em lugar nenhum; quem não tem a área trabalha normalmente no resto.
   * A tela precisa distinguir para não mandar a pessoa fazer login de novo.
   */
  | 'area_not_allowed'
  /**
   * O endereço aponta para algo de empresa OMITIDA — F31.
   *
   * 404 com a mesma frase que a rota daria para um id que não existe: dizer
   * "omitido" contaria que a coisa existe, e de qual empresa ela é.
   */
  | 'not_found';

export type SessionResult =
  | { ok: true; actor: AuthenticatedActor }
  | { ok: false; status: 401 | 403 | 404; reason: SessionRefusal; message: string };

export type SessionProvider = {
  url: string;
  anonKey: string;
  /**
   * `IDEWORKS_EMPRESAS_OMITIDAS`, como veio do ambiente — F31. Ausente ou vazia
   * = nada omitido. A API humana a passa, e desde a Fase 3b também a sessão
   * humana da integração (Conexões e consentimento, `integrations/handler.ts`).
   */
  empresasOmitidas?: string;
};

const UNAUTHENTICATED = {
  ok: false as const,
  status: 401 as const,
  reason: 'invalid_token' as const,
  message: 'Sessão inválida ou expirada. Entre novamente.',
};

/**
 * Nome do cookie da sessão.
 *
 * O crachá viaja em cookie **inacessível ao JavaScript**, e não em memória nem
 * em `localStorage`. As três opções foram tentadas nesta ordem, e a razão de
 * cada troca vale registrar:
 *
 *   memória      seguro contra script, mas morre a cada recarga. Na prática,
 *                apertar F5 desloga — e foi o que aconteceu com quem usou.
 *   localStorage sobrevive à recarga, mas qualquer script que chegue à página
 *                lê o crachá. Troca segurança por conforto.
 *   cookie sem   sobrevive à recarga E o script não alcança. Não é meio-termo:
 *   acesso ao    é melhor que as duas nos dois critérios.
 *   script
 *
 * `SameSite=Strict` fecha a porta que o cookie abriria — o navegador não o
 * envia em requisição vinda de outro site, que é a defesa contra pedido forjado.
 */
export const SESSION_COOKIE = 'ideworks_sessao';

/**
 * O cookie da RENOVAÇÃO — F17.62.
 *
 * Separado do cookie da sessão de propósito: eles têm vidas diferentes e são
 * trocados em momentos diferentes. O de sessão carrega um crachá que o provedor
 * mata em uma hora; este carrega o direito de pedir outro, e é ele que faz a
 * pessoa atravessar o dia sem digitar a senha de novo.
 *
 * Ele guarda DUAS coisas, separadas por `~`: o crachá de renovação e o
 * instante-limite da sessão (segundos desde 1970). O limite viaja junto porque
 * é o que impede a renovação de virar sessão eterna — ver `TETO_DA_SESSAO`.
 */
export const REFRESH_COOKIE = 'ideworks_renovacao';

/**
 * O teto padrão é de doze horas. Com "Manter conectado", são trinta dias
 * contados do login. Renovar o token preserva o limite original nos dois casos.
 *
 * POR QUE DOZE, E NÃO OITO
 *   Oito horas era o número do cookie antigo, e ele foi escolhido como "um
 *   expediente". Um expediente com almoço no meio passa de oito horas contadas
 *   do primeiro login — foi medido: entre 2026-08-31 e 2026-09-03 a mediana
 *   entre dois logins da mesma pessoa foi de 64 minutos, e as jornadas iam das
 *   07h às 21h. Doze horas cobrem o dia inteiro e ainda pedem crachá novo na
 *   manhã seguinte.
 *
 * O TETO NÃO É SÓ UM NÚMERO NO COOKIE
 *   Quem alcança o teto tem a sessão ENCERRADA NO PROVEDOR (`scope=local`), e
 *   não apenas o cookie apagado. Sem isso o crachá de renovação continuaria
 *   valendo para quem o tivesse copiado, e o teto seria enfeite.
 */
export const TETO_DA_SESSAO_EM_SEGUNDOS = 60 * 60 * 12;

export const REMEMBERED_SESSION_SECONDS = 60 * 60 * 24 * 30;

/** Monta o cabeçalho que grava o cookie. `maxAge` em segundos; 0 apaga. */
/**
 * Quantos segundos o crachá ainda vale, lidos do `exp` do próprio token.
 *
 * Serve à TELA renovar antes de vencer (ver `criarRenovacao` em `lib/api.ts`),
 * e só a isso: nada aqui confere assinatura, e nada aqui decide acesso — quem
 * decide é `resolveActor`, que pergunta ao provedor. Um token adulterado só
 * enganaria a própria tela sobre QUANDO renovar.
 *
 * Volta DURAÇÃO, e não horário: o relógio da máquina de quem usa pode estar
 * errado, e uma duração não depende dele.
 */
export function segundosAteVencer(
  token: string | null | undefined,
  agoraEmSegundos: number = Math.floor(Date.now() / 1000),
): number | null {
  const meio = token?.split('.')[1];
  if (!meio) return null;
  try {
    const base64 = meio.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as {
      exp?: unknown;
    };
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null;
    return Math.max(0, Math.floor(payload.exp - agoraEmSegundos));
  } catch {
    return null;
  }
}

export function sessionCookieHeader(token: string, maxAgeSeconds: number): string {
  return cookieHeader(SESSION_COOKIE, token, maxAgeSeconds);
}

/**
 * Monta o cookie da renovação. `maxAge` em segundos; 0 apaga.
 *
 * `limiteEmSegundos` é o instante em que a sessão acaba, e ele NÃO é recalculado
 * a cada renovação: é o mesmo do login até o fim. Recalcular seria o mesmo que
 * não ter teto.
 */
export function refreshCookieHeader(
  refreshToken: string,
  limiteEmSegundos: number,
  maxAgeSeconds: number,
): string {
  const valor = refreshToken === '' ? '' : `${refreshToken}~${limiteEmSegundos}`;
  return cookieHeader(REFRESH_COOKIE, valor, maxAgeSeconds);
}

/**
 * As mesmas defesas para os dois cookies.
 *
 * `SameSite=Strict` continua aqui, e continua sendo o certo — ver o cabeçalho
 * de `SESSION_COOKIE`. Ele não custa nada a quem chega por link de fora: a
 * página é um arquivo estático que não pede crachá, e a chamada que o exige
 * parte de dentro dela, que é do mesmo site. Medido na F17.62.
 */
function cookieHeader(nome: string, valor: string, maxAgeSeconds: number): string {
  return [
    `${nome}=${valor}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Secure',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

function cookieValue(request: Request, nome: string): string | null {
  const bruto = request.headers.get('Cookie');
  if (!bruto) return null;
  for (const par of bruto.split(';')) {
    const [chave, ...resto] = par.trim().split('=');
    if (chave === nome) return resto.join('=') || null;
  }
  return null;
}

function cookieToken(request: Request): string | null {
  return cookieValue(request, SESSION_COOKIE);
}

/**
 * O crachá de renovação e o instante-limite da sessão, como vieram do cookie.
 *
 * Devolve `null` quando não há cookie ou quando ele não tem as duas partes —
 * cookie meio escrito é cookie que não serve, e tratar o que falta como zero
 * daria uma sessão vencida em 1970, que é uma recusa confusa em vez de clara.
 */
export function refreshFromCookie(
  request: Request,
): { refreshToken: string; limiteEmSegundos: number } | null {
  const bruto = cookieValue(request, REFRESH_COOKIE);
  if (!bruto) return null;
  const corte = bruto.lastIndexOf('~');
  if (corte <= 0) return null;
  const limite = Number(bruto.slice(corte + 1));
  if (!Number.isFinite(limite) || limite <= 0) return null;
  return { refreshToken: bruto.slice(0, corte), limiteEmSegundos: limite };
}

/**
 * O crachá, venha de onde vier.
 *
 * O cookie é o caminho do navegador. O cabeçalho `Authorization` continua
 * aceito para chamada programática — script, verificação, integração — que não
 * tem navegador para guardar cookie.
 */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? '';
  const [tipo, valor] = header.split(' ');
  if (tipo?.toLowerCase() === 'bearer' && valor) return valor;
  return cookieToken(request);
}

/**
 * Traduz o crachá em ator. Devolve recusa em vez de lançar: quem chama precisa
 * escolher o código de resposta, e uma exceção viraria 500 — o servidor
 * dizendo "quebrei" quando na verdade barrou de propósito.
 */
export async function resolveActor(
  request: Request,
  sql: Sql,
  provider: SessionProvider,
  /**
   * O caminho da API, para conferir a ÁREA — F13.
   *
   * A CONFERÊNCIA MORA AQUI, E NÃO EM CADA ROTA
   *   Aqui já se decide identidade, e é por onde toda rota protegida passa.
   *   Espalhá-la pelas quarenta e oito chamadas seria quarenta e oito lugares
   *   para esquecer de uma — e a que faltasse não daria sinal nenhum.
   *
   * O PARÂMETRO É OPCIONAL, E ISSO É UMA FRESTA CONHECIDA
   *   Sem ele a área não é conferida. É por isso que a proteção não depende de
   *   quem chama lembrar: `test/areas.test.ts` lê o Worker e cobra que toda
   *   rota esteja classificada, e o teste de cobertura abaixo cobra que toda
   *   chamada passe o caminho.
   */
  caminho?: string,
): Promise<SessionResult> {
  const token = bearerToken(request);
  if (!token) {
    return { ...UNAUTHENTICATED, reason: 'no_token', message: 'Faltou o crachá.' };
  }

  const resposta = await fetch(`${provider.url}/auth/v1/user`, {
    headers: { apikey: provider.anonKey, Authorization: `Bearer ${token}` },
  });
  if (!resposta.ok) return UNAUTHENTICATED;

  const corpo = (await resposta.json()) as { id?: string; email?: string };
  if (!corpo.id) return UNAUTHENTICATED;

  // Segunda conferência: existir na autenticação não é ter acesso ao IDE Works.
  //
  // O id vai NO TEXTO (`inlineUuid`) e não como parâmetro: roda em TODA rota
  // protegida, e o parâmetro custava uma ida a mais (o driver pergunta o tipo
  // ao servidor antes de executar). Id fora do formato UUID cai no parâmetro.
  // Medido: 5 idas -> 3 (`db-idas.test.ts`).
  const perfil = await withActor(sql, { kind: 'preauth' }, async (tx) => {
    const linhas = await tx`
      select id, email, full_name, role::text as role, is_superadmin, is_active, has_all_clients_access, areas
        from ideworks.profiles where id = ${inlineUuid(tx, corpo.id!)}`;
    return linhas[0];
  });

  if (!perfil) {
    // Mesma frase de crachá inválido, de propósito: dizer "você existe no outro
    // sistema" entregaria quem é usuário do legado.
    return { ...UNAUTHENTICATED, reason: 'no_ideworks_profile' };
  }

  if (!perfil.is_active) {
    return {
      ok: false,
      status: 403,
      reason: 'account_disabled',
      message: 'Esta conta está desativada. Procure um administrador.',
    };
  }

  const areas = (perfil.areas as Area[] | null) ?? [];

  // TERCEIRA CONFERÊNCIA: entrar não é alcançar tudo — F13.
  //
  // A recusa é 403 e diz QUAL área falta, para o pedido a quem administra ser
  // específico. Um "sem permissão" genérico faria a pessoa abrir chamado sem
  // saber o que pedir.
  if (caminho !== undefined && !podeChamar(caminho, areas, perfil.is_superadmin as boolean)) {
    return {
      ok: false,
      status: 403,
      reason: 'area_not_allowed',
      message: recusaDeArea(caminho),
    };
  }

  // QUARTA CONFERÊNCIA: o que não é da Ide não aparece — F31.
  //
  // Mora aqui pelo mesmo motivo da área: é por onde toda rota protegida passa.
  // O endereço que aponta direto para algo de empresa omitida para aqui, com a
  // frase de "não encontrado" da própria rota; as LEITURAS de lista recebem os
  // ids no ator e recortam com eles. Vale para todos, super admin incluído — o
  // pedido é "só Ide" — e sem a variável não há ida ao banco nenhuma.
  const nomesOmitidos = lerNomesOmitidos(provider.empresasOmitidas);
  let categoriasOmitidas: string[] = [];
  if (nomesOmitidos.length > 0) {
    // ⚠️ A OMISSÃO NUNCA DERRUBA O PEDIDO. Se a conferência falhar (erro de
    // SQL, permissão, conexão, coluna que mudou), o pedido segue SEM omitir
    // nada, com aviso no log. Omitir é cosmético — o alcance continua sendo
    // das políticas do banco —, e um tropeço aqui viraria 500 em TODA rota
    // protegida, login incluído.
    try {
      const conferencia = await conferirOmitidas(
        sql,
        userActor({
          userId: perfil.id as string,
          isSuperadmin: perfil.is_superadmin as boolean,
          isSuper: perfil.role === 'super_admin',
        }),
        nomesOmitidos,
        caminho,
      );
      if (conferencia.recusa) {
        return { ok: false, status: 404, reason: 'not_found', message: conferencia.recusa };
      }
      categoriasOmitidas = conferencia.ids;
    } catch (erro) {
      console.warn(
        `[ide-works] F31: a conferência de IDEWORKS_EMPRESAS_OMITIDAS falhou — nada omitido neste pedido: ${
          erro instanceof Error ? erro.message : String(erro)
        }`,
      );
      categoriasOmitidas = [];
    }
  }

  return {
    ok: true,
    actor: {
      userId: perfil.id as string,
      email: perfil.email as string,
      papel: (perfil.role as Papel | null) ?? 'funcionario',
      isSuperadmin: perfil.is_superadmin as boolean,
      isSuper: perfil.role === 'super_admin',
      areas,
      hasAllClientsAccess: perfil.has_all_clients_access as boolean,
      nome: nomeLegivel(perfil.full_name),
      // Só quando há omitida: o ator de quem não configurou nada continua
      // idêntico ao de antes da F31, campo a campo.
      ...(categoriasOmitidas.length > 0 ? { categoriasOmitidas } : {}),
    },
  };
}

/** `full_name` como a tela pode mostrar: texto com letra, ou `null`. F29. */
function nomeLegivel(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
}

/** Converte o ator autenticado no formato que o banco espera na declaração. */
export function asDbActor(actor: AuthenticatedActor): Actor {
  return {
    kind: 'user',
    userId: actor.userId,
    isSuperadmin: actor.isSuperadmin,
    isSuper: actor.isSuper,
  };
}
