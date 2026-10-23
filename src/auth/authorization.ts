/**
 * Papéis e as três barreiras — etapa F1.7.
 *
 * TRÊS BARREIRAS, NÃO UMA
 *   1. Crachá válido?          senão, 401
 *   2. É administrador?        o servidor consulta o perfil no banco; senão, 403
 *   3. O banco concorda?       cada tabela tem sua própria regra de acesso, que
 *                              confere de novo dentro do Postgres
 *
 *   A terceira é a que mais importa e a menos óbvia: a leitura do banco usa o
 *   crachá **da própria pessoa**, não uma chave-mestra. Então, mesmo que houvesse
 *   um erro de código deixando alguém chegar onde não devia, o banco devolveria
 *   vazio. Não é uma checagem espalhada pelo código, que pode ser esquecida num
 *   lugar — é o banco recusando na origem.
 *
 *   Este módulo é a **segunda** barreira. A primeira mora na borda; a terceira,
 *   nas políticas do schema. Nenhuma das três substitui as outras.
 *
 * A CHAVE-MESTRA
 *   A credencial que ignora todas as regras é usada em pouquíssimos lugares, e a
 *   lista é fechada e verificada por teste. Arquivo novo que a use quebra a
 *   construção e obriga justificativa escrita.
 */

export type Role = 'superadmin' | 'member';

export type Principal = {
  userId: string;
  role: Role;
  isActive: boolean;
};

export type Denial = { ok: false; status: 401 | 403; reason: string; message: string };
export type Grant = { ok: true };
export type AccessVerdict = Grant | Denial;

const UNAUTHENTICATED: Denial = {
  ok: false,
  status: 401,
  reason: 'no_valid_session',
  message: 'Sessão inválida ou expirada. Entre novamente.',
};

const FORBIDDEN: Denial = {
  ok: false,
  status: 403,
  reason: 'insufficient_role',
  message: 'Você não tem permissão para esta ação.',
};

const DISABLED: Denial = {
  ok: false,
  status: 403,
  reason: 'account_disabled',
  message: 'Esta conta está desativada. Procure um administrador.',
};

/**
 * Segunda barreira: o papel permite esta ação?
 *
 * `principal` nulo significa que a primeira barreira já não passou.
 */
export function authorize(
  principal: Principal | null,
  required: Role = 'member',
): AccessVerdict {
  if (!principal) return UNAUTHENTICATED;

  // Conta desativada é barrada em toda rota, não só no login: quem foi cortado
  // enquanto navegava não deve continuar navegando até o crachá vencer.
  if (!principal.isActive) return DISABLED;

  if (required === 'superadmin' && principal.role !== 'superadmin') return FORBIDDEN;

  return { ok: true };
}

/**
 * Lista fechada dos lugares onde a chave-mestra pode ser usada.
 *
 * Cada entrada precisa de justificativa por escrito. Acrescentar um caminho aqui
 * é decisão consciente; deixar de listar um que a use quebra o teste.
 */
export const SERVICE_KEY_ALLOWLIST: ReadonlyArray<{ path: string; why: string }> = [
  {
    path: 'src/server/auth-admin.ts',
    why: 'Criar conta no provedor e definir senha — só o administrador do projeto pode.',
  },
  {
    path: 'src/server/ports.ts',
    why:
      'Escrever a senha nova pela porta de administração do provedor — F17.31. É a única ' +
      'escrita de senha do projeto, e a chave é a única credencial que a alcança: o papel da ' +
      'aplicação não tem `usage` no schema de autenticação (medido na F17.30). A chave é ' +
      'TRANSPORTE, e não autorização — quem autoriza é `ideworks.find_reset_account`, que só ' +
      'devolve identificador para código de intenção `reset`, pendente e no prazo. Sem esse ' +
      'identificador, `setPasswordWithProvider` não tem em quem escrever.',
  },
  {
    path: 'src/server/audit-writer.ts',
    why: 'Gravar os livros de auditoria, que nenhum usuário logado pode escrever.',
  },
  {
    path: 'src/server/board-anexos.ts',
    why:
      'Falar com o balde PRIVADO `ideworks-anexos` — F17.6. Ele é `public = false` e não tem ' +
      'nenhuma política permissiva em `storage.objects`, então ninguém o alcança sem ignorar a ' +
      'segurança por linha. Uma política de storage que chamasse `ideworks.can_reach_task_id` ' +
      'NÃO resolveria: foi medido, `acting_user_id()` lê uma variável de sessão que a API de ' +
      'Storage nunca declara, e a função devolveria nulo para todo mundo. A chave é ' +
      'TRANSPORTE, e não autorização — quem decide o alcance continua sendo o banco, ' +
      'consultado antes de cada ida ao Storage, no próprio arquivo.',
  },
  {
    path: 'src/server/history.ts',
    why:
      'Assinar o endereço de um documento do histórico no balde `client-history-documents` — ' +
      'F17.52. Esse balde era do Sistema IDE e era `public = true`: contrato e transcrição de ' +
      'reunião de cliente liam-se SEM LOGIN, bastando ter o endereço, e o endereço estava ' +
      'gravado dentro do próprio dado. Fechado o balde, a única porta até os bytes é um ' +
      'endereço assinado de vida curta, e emiti-lo exige ignorar segurança por linha. A chave ' +
      'é TRANSPORTE, e não autorização: `signHistoryDocument` pergunta ao banco, sob o ator ' +
      'declarado, se o documento aparece — `history_documents_select` recorta por ' +
      '`can_see_client` — e só depois assina.',
  },
];

/**
 * Lista fechada das rotas públicas.
 *
 * Tudo o mais exige crachá. Acrescentar rota pública sem revisão quebra o teste
 * — foi assim que o sistema de origem manteve a superfície pequena.
 */
export const PUBLIC_ROUTES: ReadonlyArray<{ route: string; why: string }> = [
  { route: 'GET /health', why: 'Sonda de saúde. Não revela nada além de estar no ar.' },
  { route: 'POST /auth/login', why: 'A porta de entrada precisa ser alcançável sem crachá.' },
  { route: 'POST /auth/activate', why: 'Primeiro acesso: a pessoa ainda não tem crachá.' },
  {
    route: 'POST /auth/reset-password',
    why:
      'Escolher a senha nova — F17.31. Precisa ser pública pelo mesmo motivo do login: quem ' +
      'perdeu a senha não tem crachá para pedir, e exigir um seria trancar a porta justamente ' +
      'para quem está do lado de fora. O que ela exige é o código de intenção `reset`, que só ' +
      'quem administra emite, e a recusa é a MESMA frase da ativação — sem dizer se o ' +
      'endereço existe.',
  },
  {
    route: 'GET /public/aprovacao/:token',
    why:
      'A aprovação do cliente por link — F42. O cliente da agência não tem conta: o link fixo ' +
      'dele É a credencial. O token tem 256 bits e só o hash SHA-256 fica no banco; revogado, ' +
      'cliente desligado, inativo e inexistente respondem o mesmo 404, sem dizer qual caso. ' +
      'Responde com `Referrer-Policy: no-referrer` e `X-Robots-Tag: noindex` para o endereço ' +
      'não vazar nem ser indexado. Escritas do cliente (Fase 5) ficam sob o mesmo prefixo.',
  },
  // F42, Fase 5: o resto da API do cliente, sob o mesmo prefixo e a mesma
  // credencial (o token do link). Limite de pedidos por token e por IP no
  // banco; POST só JSON e só da origem do app. Ver `src/server/aprovacao-publica.ts`.
  {
    route: 'GET /public/aprovacao/:token/chamadas/:id',
    why: 'Uma chamada do cliente do link. Chamada de outro cliente responde o mesmo 404 do token inválido.',
  },
  {
    route: 'POST /public/aprovacao/:token/chamadas/:id/comentarios',
    why: 'O cliente comenta uma chamada aberta (ou um material dela) sem decidir. Sem conta: o token é a credencial.',
  },
  {
    route: 'POST /public/aprovacao/:token/chamadas/:id/aprovar',
    why: 'O cliente aprova a chamada. Decisão única, travada no banco; a segunda responde 409.',
  },
  {
    route: 'POST /public/aprovacao/:token/chamadas/:id/reprovar',
    why: 'O cliente pede ajustes, com comentário obrigatório. Decisão única, como aprovar.',
  },
];
