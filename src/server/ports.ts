/**
 * Adaptadores reais das portas de acesso — etapa F1.9.
 *
 * As decisões vivem em `src/auth/*`, puras e sem saber que banco existe. Aqui
 * ficam os fios: consulta, chamada ao provedor de autenticação, gravação.
 *
 * A separação não é enfeite — foi ela que deixou verificar toda a lógica de
 * acesso sem criar uma única conta no projeto que hospeda os 21 logins reais do
 * Sistema IDE.
 */

import type { ActivationPorts, PendingInvitation } from '@/auth/activation';
import type { AuditPorts } from '@/auth/audit';
import type { LoginPorts, IdeWorksProfile } from '@/auth/login';
import type {
  PendingReset,
  ResetPorts,
  ResetRedeemPorts,
} from '@/auth/password-reset';
import {
  type LimitPurpose,
  type LimitScope,
  checkRateLimit,
  recordAttempt,
} from '@/auth/rate-limit';
import { type Sql, comoJson, withActor } from '@/server/db';
import { type AuthenticatedActor, asDbActor } from '@/server/session';
import { assertTestAccount } from '@/server/test-account-guard';

export type AuthProvider = {
  url: string;
  anonKey: string;
  /** Quando ligado, só se cria conta em domínio reservado. Ver F1.9. */
  testAccountsOnly: boolean;
  /**
   * Endereços nomeados que podem entrar mesmo com a trava ligada.
   *
   * Lista separada por vírgula, comparada por igualdade exata. Ver
   * `estaNaLista` — a alternativa era desligar a trava, que valeria para
   * qualquer endereço, inclusive digitado errado.
   */
  allowedAccounts?: string;
  /**
   * A chave de serviço — a porta de administração do provedor. F17.31.
   *
   * Só o caminho de redefinição de senha a usa, e só depois de o código de
   * intenção `reset` ter batido. Opcional porque o ambiente pode não tê-la: aí
   * a rota recusa dizendo o nome da variável, em vez de estourar.
   */
  serviceKey?: string;
};

// --- provedor de autenticação -------------------------------------------------

/**
 * Confere a senha. Este código nunca vê, guarda nem compara senha.
 *
 * Devolve também o crachá emitido, para quem chama não precisar conferir a
 * senha uma segunda vez só para obtê-lo — o que gastaria duas tentativas do
 * limitador por um login só.
 */
export async function verifyPasswordWithProvider(
  provider: AuthProvider,
  email: string,
  password: string,
): Promise<
  { ok: true; userId: string; accessToken: string; refreshToken: string | null } | { ok: false }
> {
  const response = await fetch(`${provider.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: provider.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) return { ok: false };
  const body = (await response.json()) as {
    user?: { id?: string };
    access_token?: string;
    /**
     * ⚠️ O SEGUNDO CRACHÁ, QUE ATÉ A F17.62 ERA JOGADO FORA.
     *
     * O crachá de acesso do provedor vive **uma hora** — medido: `exp - iat` de
     * um crachá real deste projeto dá 3.600 segundos exatos. O cookie dizia
     * `Max-Age` de oito horas, e essa diferença era o defeito: a partir da
     * primeira hora o cookie continuava sendo enviado, o provedor recusava, e a
     * pessoa caía no login no meio do expediente.
     *
     * O crachá de renovação é o que permite pedir outro crachá de acesso sem
     * senha. Sem guardá-lo não existe renovação possível — nenhuma.
     */
    refresh_token?: string;
  };
  return body.user?.id && body.access_token
    ? {
        ok: true,
        userId: body.user.id,
        accessToken: body.access_token,
        refreshToken: body.refresh_token ?? null,
      }
    : { ok: false };
}

/**
 * Troca o crachá de renovação por um crachá de acesso novo — F17.62.
 *
 * O crachá de renovação **gira**: o provedor devolve outro a cada troca e
 * invalida o anterior. Por isso quem chama precisa gravar o novo — guardar o
 * antigo faria a renovação seguinte falhar, e a pessoa cairia no login
 * exatamente como antes desta etapa.
 */
export async function refreshWithProvider(
  provider: AuthProvider,
  refreshToken: string,
): Promise<
  | { ok: true; accessToken: string; refreshToken: string }
  /**
   * ⚠️ RECUSAR NÃO É O MESMO QUE NÃO RESPONDER, e confundir os dois cria de
   * volta o defeito que esta etapa veio consertar.
   *
   *   `recusado`  o provedor disse NÃO — o crachá de renovação não vale mais.
   *               Aí os cookies são apagados e a pessoa entra de novo.
   *   `indisponivel` o provedor caiu, deu erro de servidor ou a rede falhou.
   *               O crachá pode estar perfeito. Apagar o cookie aqui tiraria a
   *               sessão de gente que só teve azar de tempo, e a queixa
   *               voltaria com outro nome.
   */
  | { ok: false; motivo: 'recusado' | 'indisponivel' }
> {
  let response: Response;
  try {
    response = await fetch(`${provider.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: provider.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    return { ok: false, motivo: 'indisponivel' };
  }
  if (!response.ok) {
    return { ok: false, motivo: response.status >= 500 ? 'indisponivel' : 'recusado' };
  }
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
  };
  return body.access_token && body.refresh_token
    ? { ok: true, accessToken: body.access_token, refreshToken: body.refresh_token }
    : { ok: false, motivo: 'recusado' };
}

/**
 * Encerra a sessão NO PROVEDOR — F17.62.
 *
 * ⚠️ `scope=local`, E ISTO NÃO É DETALHE.
 *   O padrão do provedor é `global`: ele derruba TODAS as sessões da pessoa.
 *   A autenticação é a mesma do Sistema IDE em produção (decisão D8), então
 *   `global` faria quem sai do IDE Works ser deslogado do sistema legado que a
 *   agência usa para trabalhar — no meio do expediente, sem entender por quê.
 *
 *   `local` derruba só a sessão deste crachá, que é a que o botão `Sair`
 *   promete encerrar.
 *
 * Falhar aqui não impede a saída: quem chama já apaga os cookies, e a pessoa
 * está fora do navegador dela de qualquer jeito. O que se perde é a revogação
 * do crachá de renovação — registrado, não escondido.
 */
export async function revokeSessionWithProvider(
  provider: AuthProvider,
  accessToken: string,
): Promise<boolean> {
  try {
    const response = await fetch(`${provider.url}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: { apikey: provider.anonKey, Authorization: `Bearer ${accessToken}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * O que o provedor responde quando o endereço já tem dono.
 *
 * Medido em 2026-08-28 contra o cadastro real: `422`, com
 * `{"error_code":"user_already_exists","msg":"User already registered"}`.
 * Versões anteriores do provedor respondem `400` e trazem só a frase, então as
 * duas formas são reconhecidas — quem escreve a frase é o provedor, e ela muda
 * sem avisar.
 */
function contaJaExiste(body: { error_code?: string; msg?: string }): boolean {
  if (body.error_code === 'user_already_exists' || body.error_code === 'email_exists') return true;
  return /already\s+registered|already\s+exists/i.test(body.msg ?? '');
}

/**
 * Garante que existe conta de login para este e-mail.
 *
 * ⚠️ O ENDEREÇO QUE JÁ TEM DONO NÃO É RECUSA — É VÍNCULO (F17.30)
 *   Tirada a trava da F17.28, a primeira pessoa convidada de verdade recebeu
 *   `User already registered` na tela, em inglês. Ela tem conta desde
 *   2025-09-23 e entrou há cinco semanas: a autenticação é a mesma do Sistema
 *   IDE, e ter conta lá é o caso da MAIORIA da agência.
 *
 *   Então o endereço já registrado devolve `{ ok: true, alreadyExisted: true }`,
 *   e quem chama aplica o convite na conta que existe.
 *
 * ⚠️ A SENHA DA CONTA QUE JÁ EXISTE NÃO É TOCADA
 *   Este `signup` é a única chamada do caminho, e contra endereço com dono ele
 *   RECUSA — não redefine nada. Medido: o carimbo `updated_at` do cadastro é o
 *   mesmo antes e depois, a senha antiga continua abrindo sessão, e a senha
 *   digitada no formulário não abre. Nenhuma outra linha daqui para baixo
 *   escreve em autenticação, e nenhuma pode passar a escrever: o cadastro é o
 *   do Sistema IDE em produção, e trocar a senha de alguém tira o acesso de uma
 *   pessoa real.
 *
 * A trava de conta de teste roda **antes** de qualquer chamada. Enquanto ela
 * estiver ligada, só se cria conta em domínio reservado — e nunca se apaga
 * nenhuma.
 */
export async function createAccountWithProvider(
  provider: AuthProvider,
  email: string,
  password: string,
  log: (m: string, e?: unknown) => void = () => {},
): Promise<{ ok: true; alreadyExisted: boolean } | { ok: false; message: string }> {
  if (provider.testAccountsOnly) assertTestAccount(email, provider.allowedAccounts ?? '');

  const response = await fetch(`${provider.url}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: provider.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (response.ok) return { ok: true, alreadyExisted: false };

  const body = (await response.json().catch(() => ({}))) as {
    error_code?: string;
    msg?: string;
  };

  if (contaJaExiste(body)) return { ok: true, alreadyExisted: true };

  // A senha é o único ponto do fluxo com mensagem explicativa. Recusá-la sem
  // explicar deixaria a pessoa presa sem saber por quê.
  const explicacoes: Record<string, string> = {
    weak_password: 'Senha fraca. Use ao menos 8 caracteres e algo menos previsível.',
    validation_failed: 'Senha recusada. Use ao menos 8 caracteres.',
    over_email_send_rate_limit: 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.',
    signup_disabled: 'Não foi possível concluir por aqui. Fale com quem criou seu acesso.',
  };

  // ⚠️ A FRASE DO PROVEDOR NÃO SOBE MAIS PARA A TELA.
  //
  // Aqui havia `?? body.msg ??`, e foi por essa fresta que `User already
  // registered` chegou ao olho de quem estava ativando: em inglês, dizendo um
  // detalhe do cadastro, e sem dizer o que fazer. O que o provedor escreve é
  // dele — muda de versão para versão, e nunca foi escrito para esta tela.
  // O desconhecido tem frase própria, e o motivo cru vai para o registro.
  const conhecida = explicacoes[body.error_code ?? ''];
  if (conhecida === undefined) {
    log(
      `provedor recusou a criação de conta com motivo que não sabemos traduzir: ` +
        `${response.status} ${body.error_code ?? 'sem código'} — «${body.msg ?? 'sem frase'}»`,
    );
  }

  return { ok: false, message: conhecida ?? 'Senha recusada. Escolha outra e tente de novo.' };
}

/**
 * Escreve a senha nova pela porta de administração do provedor — F17.31.
 *
 * ⚠️ ESTA É A ÚNICA FUNÇÃO DESTE PROJETO QUE ESCREVE SENHA DE ALGUÉM, e o
 * cadastro é o do Sistema IDE em produção. Ela existe atrás de duas coisas que
 * não são cortesia de quem chama:
 *
 *   1. `userId` não vem de consulta nem do corpo do pedido. Vem de
 *      `ideworks.find_reset_account`, que só responde sobre linha de intenção
 *      `reset` — e é por isso que código de convite não troca senha de
 *      ninguém. Sem identificador, esta função não tem em quem escrever;
 *   2. a trava de conta de teste roda antes, como em `createAccountWithProvider`.
 *      Enquanto ela estiver ligada, só se escreve em domínio reservado.
 *
 * A frase do provedor NÃO sobe para a tela. Foi por essa fresta que `User
 * already registered` chegou ao olho de quem estava ativando (F17.30); o motivo
 * cru vai para o registro, e a tela recebe frase escrita para ela.
 */
export async function setPasswordWithProvider(
  provider: AuthProvider,
  userId: string,
  email: string,
  password: string,
  log: (m: string, e?: unknown) => void = () => {},
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (provider.testAccountsOnly) assertTestAccount(email, provider.allowedAccounts ?? '');

  const chave = provider.serviceKey?.trim();
  if (!chave) {
    log('redefinição pedida sem IDEWORKS_SERVER_SUPABASE_SERVICE_KEY no ambiente');
    return {
      ok: false,
      message: 'Não foi possível concluir por aqui. Fale com quem criou seu acesso.',
    };
  }

  const response = await fetch(`${provider.url}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: {
      apikey: chave,
      Authorization: `Bearer ${chave}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  });

  if (response.ok) return { ok: true };

  const body = (await response.json().catch(() => ({}))) as {
    error_code?: string;
    msg?: string;
  };

  // A senha é o único ponto do fluxo com mensagem explicativa. Recusá-la sem
  // explicar deixaria a pessoa presa sem saber por quê — e ela está aqui
  // justamente porque já estava presa.
  const explicacoes: Record<string, string> = {
    weak_password: 'Senha fraca. Use ao menos 8 caracteres e algo menos previsível.',
    validation_failed: 'Senha recusada. Use ao menos 8 caracteres.',
    same_password: 'Essa já é a sua senha. Escolha uma diferente.',
    over_request_rate_limit: 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.',
  };

  const conhecida = explicacoes[body.error_code ?? ''];
  if (conhecida === undefined) {
    log(
      `provedor recusou a troca de senha com motivo que não sabemos traduzir: ` +
        `${response.status} ${body.error_code ?? 'sem código'} — «${body.msg ?? 'sem frase'}»`,
    );
  }

  return { ok: false, message: conhecida ?? 'Senha recusada. Escolha outra e tente de novo.' };
}

// --- portas do limitador ------------------------------------------------------

export function rateLimitPorts(sql: Sql, log: (m: string, e?: unknown) => void) {
  return {
    async countAttempts(
      purpose: LimitPurpose,
      scope: LimitScope,
      key: string,
      since: Date,
    ): Promise<number> {
      return withActor(sql, { kind: 'preauth' }, async (tx) => {
        const rows = await tx`
          select count(*)::int as n from ideworks.auth_attempts
           where purpose = ${purpose}::ideworks.attempt_purpose
             and scope = ${scope}::ideworks.attempt_scope
             and scope_key = ${key}
             and occurred_at >= ${since}`;
        return Number(rows[0].n);
      });
    },

    async recordAttempt(purpose: LimitPurpose, scope: LimitScope, key: string): Promise<void> {
      await withActor(sql, { kind: 'preauth' }, async (tx) => {
        await tx`
          insert into ideworks.auth_attempts (purpose, scope, scope_key)
          values (${purpose}::ideworks.attempt_purpose, ${scope}::ideworks.attempt_scope, ${key})`;
      });
    },

    reportFailure(context: string, error: unknown) {
      log(context, error);
    },
  };
}

// --- portas do login ----------------------------------------------------------

/**
 * @param onToken recebe o crachá emitido quando a senha confere. Existe porque a
 *   decisão de login (`attemptLogin`) não conhece crachá — ela decide se a
 *   pessoa entra, e emitir o crachá é assunto da borda. Sem isto, o Worker
 *   precisaria conferir a senha de novo só para pegá-lo, gastando duas
 *   tentativas do limitador por um login só.
 */
export function loginPorts(
  sql: Sql,
  provider: AuthProvider,
  log: (m: string, e?: unknown) => void,
  onToken?: (cracha: { accessToken: string; refreshToken: string | null }) => void,
): LoginPorts {
  return {
    ...rateLimitPorts(sql, log),

    async verifyPassword(email, password) {
      const r = await verifyPasswordWithProvider(provider, email, password);
      // Os DOIS crachás sobem — o de acesso, que vale uma hora, e o de
      // renovação, que é o que faz a sessão atravessar o expediente (F17.62).
      if (r.ok) onToken?.({ accessToken: r.accessToken, refreshToken: r.refreshToken });
      return r;
    },

    async findIdeWorksProfile(userId: string): Promise<IdeWorksProfile | null> {
      return withActor(sql, { kind: 'preauth' }, async (tx) => {
        const rows = await tx`
          select id, is_active from ideworks.profiles where id = ${userId}`;
        return rows.length === 0
          ? null
          : { userId: rows[0].id as string, isActive: rows[0].is_active as boolean };
      });
    },

    async replacePreviousSession(): Promise<boolean> {
      // O provedor emite o crachá; a sessão única entra quando houver registro
      // de sessão próprio (etapa futura). Devolver false aqui é honesto: hoje
      // nada foi derrubado, e mentir "true" faria a tela avisar em falso.
      return false;
    },
  };
}

// --- portas da ativação -------------------------------------------------------

/**
 * @param ip a origem do pedido. ENTROU NA F17.53, e sem ela o teto por origem
 *   de `LIMITS.activation` — 20 em 15 minutos — estava declarado e nunca era
 *   consultado: a versão anterior olhava só o escopo `email`, com o número 10
 *   escrito à mão aqui em vez de lido de `LIMITS`.
 */
export function activationPorts(
  sql: Sql,
  provider: AuthProvider,
  log: (m: string, e?: unknown) => void,
  ip: string,
): ActivationPorts {
  const limits = rateLimitPorts(sql, log);

  return {
    // Os DOIS tetos, pelo mesmo `checkRateLimit` do login — nada de contagem
    // paralela com número próprio. Ele já falha aberto e grita a falha: com o
    // banco fora, travar tudo impediria justamente quem precisa entrar para
    // consertar.
    async isRateLimited(email: string): Promise<boolean> {
      return !(await checkRateLimit('activation', { email, ip }, limits)).allowed;
    },

    // ⚠️ A LINHA QUE NÃO EXISTIA — achado A3. Ver o comentário da porta em
    // `activation.ts`: sem esta escrita, o `isRateLimited` acima lia zero para
    // sempre. A intenção é `activation`, que é a MESMA que a redefinição de
    // senha conta e escreve — o teto é um só para as duas portas de código.
    async recordAttempt(email: string): Promise<void> {
      await recordAttempt('activation', { email, ip }, limits);
    },

    async findPendingInvitation(email: string): Promise<PendingInvitation | null> {
      return withActor(sql, { kind: 'preauth' }, async (tx) => {
        /**
         * ⚠️ A INTENÇÃO NO `where` NÃO É FILTRO DE CONVENIÊNCIA — F17.31.
         *
         * Esta consulta pega UM código: o pendente mais recente. Sem ela, um
         * código de senha emitido depois do convite seria o escolhido, e o
         * convite legítimo passaria a ser recusado com a frase genérica — sem
         * ninguém conseguir explicar por quê.
         *
         * F17.39: são DUAS as intenções que ativam — `invite` e
         * `invite_with_password` —, e `reset` continua de fora. A lista é
         * escrita aqui e conferida de novo na decisão, que é onde ela se prova
         * sem banco nenhum.
         */
        const rows = await tx`
          select id, email, code_hash, expires_at, failed_attempts, purpose
            from ideworks.invitations
           where lower(email) = ${email} and status = 'pending'
             and purpose in ('invite', 'invite_with_password')
           order by created_at desc limit 1`;
        if (rows.length === 0) return null;
        return {
          id: rows[0].id as string,
          email: rows[0].email as string,
          codeHash: rows[0].code_hash as string,
          expiresAt: new Date(rows[0].expires_at as string),
          failedAttempts: Number(rows[0].failed_attempts),
          // Lida do banco e devolvida como veio: a decisão a confere de novo, e
          // fixá-la aqui faria a conferência de lá passar sempre.
          purpose: rows[0].purpose as PendingInvitation['purpose'],
        };
      });
    },

    ensureAccount: (email, password) =>
      createAccountWithProvider(provider, email, password, log),
  };
}

/**
 * O identificador da conta que a pessoa JÁ TINHA — F17.30.
 *
 * POR QUE ISTO NÃO É UMA CONSULTA COMUM
 *   O papel da aplicação não alcança o cadastro de login. Medido:
 *   `has_schema_privilege('ideworks_app', 'auth', 'usage')` é `false`, e um
 *   `select` direto responde `permission denied for schema auth`. Quem
 *   atravessa é `ideworks.find_existing_account`, que roda com os poderes do
 *   dono e devolve **só** o identificador.
 *
 * ⚠️ A GUARDA MORA NA FUNÇÃO, E NÃO AQUI
 *   Ela só responde dentro da janela de pré-autenticação (ou a quem administra)
 *   e só quando há convite pendente e no prazo para o mesmo endereço. Sem isso
 *   seria um oráculo de quais e-mails têm conta — a enumeração de usuários que
 *   `src/auth/activation.ts` existe para impedir. Nulo cobre "não há conta" e
 *   "não há convite" sem distinguir os dois.
 *
 * A ORDEM TAMBÉM É GUARDA: quem chama só chega aqui DEPOIS de o código bater.
 */
export async function findExistingAccountId(sql: Sql, email: string): Promise<string | null> {
  return withActor(sql, { kind: 'preauth' }, async (tx) => {
    const linhas = await tx`select ideworks.find_existing_account(${email}) as id`;
    return (linhas[0]?.id as string | null) ?? null;
  });
}

/**
 * O identificador da conta cuja senha ESTE CONVITE autoriza definir — F17.39.
 *
 * ⚠️ É A ÚNICA FONTE DESSE IDENTIFICADOR NO CAMINHO EM QUE O CONVITE ESCREVE
 * SENHA, e a guarda mora na função do banco, não aqui: ela só responde sobre
 * linha de intenção `invite_with_password`, pendente, no prazo e do mesmo
 * endereço, e só dentro da janela de pré-autenticação (ou a quem administra).
 *
 * Um convite comum devolve NULO — é por aqui que a invariante da F17.30
 * continua de pé, e não por cuidado de quem chama. Sem identificador não há
 * chamada ao provedor: o caminho da senha morre antes.
 *
 * A irmã dela é `findResetAccountId`, e as duas são separadas de propósito:
 * cada uma responde sobre a própria intenção, e nenhuma abre a porta da outra.
 */
export async function findInviteAccountId(
  sql: Sql,
  email: string,
  invitationId: string,
): Promise<string | null> {
  return withActor(sql, { kind: 'preauth' }, async (tx) => {
    const linhas = await tx`
      select ideworks.find_invite_account(${email}, ${invitationId}) as id`;
    return (linhas[0]?.id as string | null) ?? null;
  });
}

/* ─────────────────── portas da redefinição de senha (F17.31) ──────────────── */

/**
 * O que `decidePasswordReset` precisa saber para decidir — nada além.
 *
 * ⚠️ RODA SOB O CRACHÁ DE VERDADE DE QUEM PEDIU, E NÃO SOB UM FABRICADO — F17.38.
 *
 *   Até 2026-08-31 esta função montava `{ isSuperadmin: true }` na mão, sem
 *   `isSuper`. Funcionou enquanto `profiles_select` não olhava empresa. A
 *   F17.34 fez ela olhar, e o crachá inventado passou a valer como
 *   ADMINISTRADOR COMUM: o dono, que tem ZERO empresas marcadas, deixou de
 *   enxergar as próprias pessoas, e `Redefinir` respondia "não há conta do IDE
 *   Works para esta pessoa" para gente que estava ali na tela.
 *
 *   Fabricar crachá é sempre isso: uma cópia que envelhece sozinha quando a
 *   regra muda de lugar. O de verdade acompanha.
 *
 * `profiles_select` e a política de `invitations` continuam sendo quem recorta:
 * quem não administra recebe lista vazia e perfil nulo, e a decisão recusa por
 * conta própria — sem `if` de papel aqui.
 */
export function resetPorts(sql: Sql, actor: AuthenticatedActor): ResetPorts {
  const comoQuemPediu = asDbActor(actor);

  return {
    async findProfile(userId: string) {
      return withActor(sql, comoQuemPediu, async (tx) => {
        const linhas = await tx`select id, email from ideworks.profiles where id = ${userId}`;
        return linhas.length === 0
          ? null
          : { userId: linhas[0].id as string, email: linhas[0].email as string };
      });
    },

    async listPendingInvitations(email: string) {
      return withActor(sql, comoQuemPediu, async (tx) => {
        const linhas = await tx`
          select id from ideworks.invitations
           where lower(email) = ${email.trim().toLowerCase()} and status = 'pending'`;
        return linhas.map((l) => ({ id: l.id as string }));
      });
    },
  };
}

/**
 * Portas de quem está gastando o código — a janela de pré-autenticação.
 *
 * O limitador é o mesmo da ativação, e de propósito: são duas portas que
 * recebem código digitado, e um teto por porta seria o dobro de tentativas por
 * endereço para quem estivesse chutando.
 *
 * ⚠️ F17.53: até esta etapa a frase acima era só intenção. As duas portas
 * CONTAVAM sob a intenção `activation`, mas nenhuma das duas ESCREVIA — o teto
 * compartilhado era um teto compartilhado de zero. Agora as duas escrevem, e é
 * por isso que gastar tentativa numa encurta a outra.
 *
 * @param ip a origem do pedido, pelo mesmo motivo de `activationPorts`.
 */
export function resetRedeemPorts(
  sql: Sql,
  log: (m: string, e?: unknown) => void,
  ip: string,
): ResetRedeemPorts {
  const limits = rateLimitPorts(sql, log);

  return {
    async isRateLimited(email: string): Promise<boolean> {
      return !(await checkRateLimit('activation', { email, ip }, limits)).allowed;
    },

    async recordAttempt(email: string): Promise<void> {
      await recordAttempt('activation', { email, ip }, limits);
    },

    async findPendingReset(email: string): Promise<PendingReset | null> {
      return withActor(sql, { kind: 'preauth' }, async (tx) => {
        const linhas = await tx`
          select id, email, code_hash, expires_at, failed_attempts, purpose
            from ideworks.invitations
           where lower(email) = ${email} and status = 'pending' and purpose = 'reset'
           order by created_at desc limit 1`;
        if (linhas.length === 0) return null;
        return {
          id: linhas[0].id as string,
          email: linhas[0].email as string,
          codeHash: linhas[0].code_hash as string,
          expiresAt: new Date(linhas[0].expires_at as string),
          failedAttempts: Number(linhas[0].failed_attempts),
          // Lida do banco e devolvida como veio: a decisão a confere de novo, e
          // fixá-la aqui em `'reset'` faria a conferência de lá passar sempre.
          purpose: linhas[0].purpose as PendingReset['purpose'],
        };
      });
    },
  };
}

/**
 * O identificador da conta cuja senha este código autoriza trocar — F17.31.
 *
 * ⚠️ É A ÚNICA FONTE DESSE IDENTIFICADOR NO CAMINHO DA SENHA, e a guarda mora
 * na função do banco, não aqui: ela só responde sobre linha de intenção
 * `reset`, pendente, no prazo e do mesmo endereço, e só dentro da janela de
 * pré-autenticação (ou a quem administra). Nulo cobre todos os casos sem
 * distinguir um do outro — inclusive "esse código é de convite".
 */
export async function findResetAccountId(
  sql: Sql,
  email: string,
  invitationId: string,
): Promise<string | null> {
  return withActor(sql, { kind: 'preauth' }, async (tx) => {
    const linhas = await tx`
      select ideworks.find_reset_account(${email}, ${invitationId}) as id`;
    return (linhas[0]?.id as string | null) ?? null;
  });
}

// --- portas da auditoria ------------------------------------------------------

// ⚠️ Recebe o CRACHA, e nao os campos dele soltos — F17.38. Ver o cabecalho de
// `resetPorts`: remontar permissao aqui e o defeito que custou o `Redefinir`.
export function auditPorts(
  sql: Sql,
  actor: AuthenticatedActor,
  log: (m: string, e?: unknown) => void,
): AuditPorts {
  return {
    async append(entry) {
      await withActor(sql, asDbActor(actor), async (tx) => {
        await tx`
          insert into ideworks.admin_audit
            (actor_id, actor_email, action, target_id, target_email, context)
          values (${actor.userId}, ${entry.actorEmail}, ${entry.action},
                  ${entry.targetId ?? null}, ${entry.targetEmail ?? null},
                  ${comoJson(tx, entry.context ?? {})}::jsonb)`;
      });
    },
    reportFailure: (context, error) => log(context, error),
    reportRedaction: (action, dropped) =>
      log(`auditoria descartou campo suspeito em "${action}": ${dropped.join(', ')}`),
  };
}
