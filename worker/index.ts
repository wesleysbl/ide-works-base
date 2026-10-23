/**
 * Camada de API do IDE Works — etapa F1.9.
 *
 * POR QUE O NAVEGADOR FALA COM ELA, E NÃO DIRETO COM O PROVEDOR
 *   Executa a decisão D6. No sistema de onde o modelo de acesso veio, o login da
 *   tela vai direto do navegador ao provedor de autenticação — e por isso escapa
 *   do limitador de tentativas. O próprio documento assume isso como lacuna.
 *
 *   Aqui o login passa por aqui, e o limitador vale.
 *
 * ROTAS PÚBLICAS
 *   Só as três da lista fechada em `src/auth/authorization.ts`. Acrescentar rota
 *   pública sem revisão quebra o teste.
 */

import { GENERIC_REFUSAL, decideActivation } from '@/auth/activation';
import { decideResetRedeem } from '@/auth/password-reset';
import {
  expiresAt,
  generateCode,
  hashCode,
  MAX_FAILED_ATTEMPTS,
} from '@/auth/activation-code';
import {
  NAME_MAX_LENGTH,
  NAME_TOO_LONG,
  checkInvitedName,
  normalizeName,
} from '@/auth/invited-name';
import { attemptLogin } from '@/auth/login';
import { RECUSA_SO_ADMIN_MARCA, decideRitualChange } from '@/delivery/month-ritual';
import { CONTENT_TYPES, type ContentType } from '@/delivery/level';
import { type ServerEnv, connect, withActor } from '@/server/db';
import {
  AppointmentRefused,
  createAppointment,
  deleteAppointment,
  updateAppointment,
} from '@/server/appointments';
import {
  AGENCY_TIMEZONE,
  ehInstanteDeAgenda,
  instanteDaPecaNova,
  readCalendar,
  scheduleItem,
} from '@/server/calendar';
import { readClientBoardLists } from '@/server/client-board-lists';
import { ClientNotVisible, readClientDetail } from '@/server/client-detail';
import {
  WriteRefused,
  createClient,
  readCatalogs,
  readClientForm,
  deleteClient,
  setClientActive,
  setClientFlags,
  updateClient,
} from '@/server/client-write';
import { ENTRADA_VAZIA, type EntradaDeCliente, validarCliente } from '@/clients/formulario';
import {
  type EntradaDeTarefa,
  TaskRefused,
  createTask,
  deleteTask,
  readTasks,
  readTeam,
  setTaskArchived,
  setTaskCompleted,
  updateTask,
} from '@/server/tasks';
import {
  MuralRefused,
  createCaptacao,
  createNota,
  deleteCaptacao,
  deleteNota,
  readCaptacoes,
  readMural,
  updateCaptacao,
  updateNota,
} from '@/server/mural-e-captacao';
import {
  type EntradaDeEvento,
  HistoryRefused,
  createEvent,
  deleteEvent,
  readHistory,
  signHistoryDocument,
  updateEvent,
} from '@/server/history';
import {
  BoardRefused,
  MoveNeedsStatus,
  TypeRequired,
  moveTaskOnBoard,
  readBoard,
  readTree,
} from '@/server/board';
// O quadro da pasta — F17.64. Leitura própria, zero escrita nova.
import { readFolderBoard } from '@/server/board-pasta';
// Lista|Kanban por espaço, pasta ou lista — F18A. Leitura paginada, zero escrita.
import { lerPedidoDoEscopo, readScopeTasks } from '@/server/tarefas-do-escopo';
// A busca por título e o filtro de responsável — F17.55. O modelo do filtro é
// puro e mora com o quadro; o que a rota faz é LER o que veio no endereço.
import { lerFiltro } from '@/board/filtro';
// As automações de etapa — F17.41. Configuram a regra; quem a EXECUTA é
// `ideworks.move_task`, na mesma escrita em que troca lista e status.
import {
  deleteListAutomation,
  readListAutomations,
  writeListAutomation,
} from '@/server/board-automacoes';
// `Meu trabalho` e `Todas as tarefas` — F17.18. Quinto arquivo do quadro, e o
// primeiro que parte da PESSOA em vez da lista: `board.ts` lê uma lista,
// `board-task.ts` escreve a tarefa, e este responde "o que é meu".
import { readAllWork, readMyWork, readMyWorkPage } from '@/server/board-trabalho';
// A paginação de `Minhas tarefas` — F17.AUD05. Lê e CONFERE o que veio no
// endereço (aba, cursor, limite) antes de qualquer consulta; a pessoa em nome
// de quem se lê continua vindo só da sessão.
import { lerPedidoDePagina } from '@/server/paginacao-do-trabalho';
// A caixa de entrada — F17.46. Mesma família do anterior, e a pergunta é o
// passo seguinte dele: `board-trabalho.ts` responde "o que é meu", este
// responde "o que CHEGOU para mim, e eu ainda não vi".
import { countUnreadNotices, markNotice, readNotices } from '@/server/board-avisos';
import { readMentionablePeople } from '@/server/board-mencoes';
// Chat da equipe — F20.3 + central ao vivo F20.4.
import {
  ChatRefused,
  addConversationMember,
  assertChatAllowed,
  chatDirectory,
  chatMentionRecipientIds,
  chatModeFromEnv,
  chatRecipientIds,
  createGroupConversation,
  deleteChatMessage,
  editChatMessage,
  leaveConversation,
  listChatMentionable,
  listChatMessageChanges,
  listChatMessagesWithReactions,
  listChatReactionChanges,
  listMyChatConversations,
  markConversationRead,
  openDirectConversation,
  removeConversationMember,
  renameConversation,
  sendChatMessage,
  toggleChatReaction,
  transferConversationOwnership,
} from '@/server/chat';
import {
  avisarCentral,
  avisarDepoisDoCommit,
  concluirAvisos,
  derrubarPessoaNaCentral,
  entregarConexaoACentral,
  fecharTodasNaCentral,
  mensagemParaEvento,
  prepararAvisoDepoisDoCommit,
} from '@/server/chat-aviso';
import {
  deleteChatMessageWithImages,
  purgeExpiredChatMessages,
  signChatImage,
  signChatImages,
  uploadChatImageDraft,
} from '@/server/chat-imagens';
import { origemDaPaginaConfere } from '@/server/chat-live';
import {
  lerAcessoPedido,
  lerAreasPedidas,
  lerAtivoPedido,
  lerCarteiraPedida,
  lerClienteDaTarefa,
  lerDonoDaConta,
  lerEmpresasPedidas,
  lerEtiquetasPedidas,
  lerMaePedida,
  lerPapelPedido,
} from '@/server/entradas-de-escrita';
import {
  declaraCorpoMaiorQue,
  ehEnvioDeArquivo,
  lerFormularioComTeto,
  lerTextoComTeto,
  tetoDoJson,
} from '@/server/corpo-com-teto';
import { frasePublicaDaRecusa } from '@/server/recusas';
import {
  FRASE_OUTRA_ORIGEM_DO_PEDIDO,
  pedidoVeioDeOutraOrigem,
} from '@/server/origem-do-pedido';
import { ChatCentral } from './chat-central';

export { ChatCentral };
// A ficha da tarefa — F17.10. Arquivo próprio: `server/board.ts` lê o quadro, e
// este escreve a tarefa.
import type { NewTask, TaskPatch } from '@/board/ficha';
import {
  createBoardTask,
  createSpaceTag,
  patchBoardTask,
  readClientOptions,
  readTaskDetail,
  setBoardTaskArchived,
  setBoardTaskClient,
  setBoardTaskCompleted,
} from '@/server/board-task';
// Os passos da tarefa — F17.15. Arquivo próprio pelo mesmo motivo: `board.ts` lê
// o quadro, `board-task.ts` escreve a tarefa, e este escreve o que está DENTRO
// dela — subtarefa e checklist.
import type { NewSubtask } from '@/board/passos';
import {
  addChecklistItem,
  createChecklist,
  createSubtask,
  deleteChecklist,
  deleteChecklistItem,
  patchChecklistItem,
  renameChecklist,
  setTaskParent,
} from '@/server/board-passos';
// A entrega — F17.6. Quarto arquivo, quarto assunto: `board.ts` lê o quadro,
// `board-task.ts` escreve a tarefa, `board-passos.ts` escreve o que está dentro
// dela, e este escreve o que SAI dela — comentário, anexo e link.
import {
  type ArmazenamentoPrivado,
  addLink,
  deleteAttachment,
  deleteComment,
  deleteLink,
  editComment,
  patchLink,
  postComment,
  signAttachment,
  signAttachments,
  uploadAttachment,
  purgeExpiredAttachments,
} from '@/server/board-anexos';
// Criar e editar a árvore — F17.14. Arquivo próprio pelo mesmo motivo do
// anterior: `server/board.ts` lê o quadro, `board-task.ts` escreve a tarefa, e
// este escreve o CHÃO — espaço, pasta e lista.
import { ESTEIRA_PADRAO, type StatusEmEdicao } from '@/board/arvore';
// O teto do anexo — F17.17. Ele mora em UM lugar só (`board/conversa.ts`), e a
// borda o importa em vez de repetir o número: repetido, ele já divergiu uma vez.
import { TETO_DE_BYTES, tamanhoLegivel } from '@/board/conversa';
import {
  bringClients,
  clearListWorkflow,
  createFolder,
  createList,
  createSpace,
  type NivelDeAcesso,
  type NoDeAcesso,
  PrecisaDeDestino,
  patchFolder,
  deleteList,
  patchList,
  reorderList,
  folderWorkflow,
  patchSpace,
  readClientsForSpace,
  readFullTree,
  readNodeAccess,
  setListWorkflow,
  writeNodeAccess,
} from '@/server/tree';
import { firstDayOfMonth, monthsInRange, readPanel } from '@/server/panel';
import {
  CatalogoRefused,
  deleteCategoria,
  deleteEtiqueta,
  deletePlano,
  mergeEtiquetas,
  readCatalogos,
  saveCategoria,
  saveEtiqueta,
  savePlano,
  setCategoriaPadrao,
  setEtiquetasDoCliente,
} from '@/server/catalogos';
import {
  ConexaoRefused,
  addAtivo,
  deleteAtivo,
  readConexoes,
  setAtivoLigado,
} from '@/server/meta-conexoes';
import {
  CONTAS_POR_EXECUCAO,
  TETO_DE_TEMPO_MS,
  coletar,
  credenciaisDoAmbiente,
  haTokenDaMeta,
} from '@/server/meta-coleta';
import {
  ContaRefused,
  atribuirCliente,
  importarContas,
  readEmpresasParaMeta,
  readContas,
} from '@/server/meta-contas';
import { descobrirContas } from '@/server/meta-descoberta';
import {
  RelatorioRefused,
  readPublicacoes,
  readRelatorioOrganico,
  readRelatorioPago,
} from '@/server/meta-relatorio';
import {
  readAnunciosDaCampanha,
  readCampanhasComObjetivo,
  readRanking,
} from '@/server/meta-ranking';
import {
  PessoaRefused,
  apagarPessoa,
  cancelarConvite,
  gerarRedefinicao,
  readCarteira,
  readClientesParaCarteira,
  readEmpresas,
  readFila,
  readPessoas,
  readTodasEmpresas,
  setAreas,
  setAtivo as setPessoaAtiva,
  setCarteira,
  setEmpresas,
  setPapel,
} from '@/server/pessoas';
import { editarCadastro } from '@/server/pessoa-cadastro';
import { PAPEIS, type Papel } from '@/auth/papeis';
import { AREAS, type Area } from '@/auth/areas';
import { readPlanning } from '@/server/planning';
import { readControleDaSemana } from '@/server/controle-da-semana';
import { diaDeSaoPaulo, ehDiaValido } from '@/server/semana-do-controle';
import { LiberarRecusado, liberarDemanda } from '@/server/liberar-demanda';
import { ehBatidaDaLimpezaDiaria, instanteDaBatida, limparLimitadores } from '@/server/limpeza-dos-limitadores';
// A aprovação do cliente por link — F42, Fase 3: a configuração (cliente, link
// e destinos da esteira) e a cifra do token.
import {
  AprovacaoRecusada,
  FRASE_SO_ADMIN as FRASE_SO_ADMIN_APROVACAO,
  gerarLinkDoCliente,
  gravarDestinosDaLista,
  lerAprovacaoDoCliente,
  lerCifraDoLink,
  lerDestinosDaLista,
  lerEntradaDosDestinos,
  ligarAprovacao,
  revogarLinkDoCliente,
} from '@/server/aprovacao-config';
import {
  ChaveDoLinkAusente,
  CifraInvalida,
  chaveDoAmbiente,
  cifrarToken,
  decifrarToken,
  enderecoDoLink,
  gerarToken,
  hashDoToken,
  tokenTemFormato,
} from '@/server/link-de-aprovacao';
// F42, Fase 4: "Solicitar aprovação" no card — a seção da ficha e o envio.
import { enviarParaAprovacao, lerAprovacaoDoCard, lerEntradaDoEnvio } from '@/server/aprovacao-envio';
// F42, Fase 5: a API pública do cliente (ler, comentar, decidir) e o limite.
import {
  FRASE_NAO_ENCONTRADO as FRASE_NAO_ENCONTRADO_PUBLICO,
  RecusaPublica,
  chaveDoIp,
  comentarComoCliente,
  conferirLimitePublico,
  decidirComoCliente,
  lerChamadaPublica,
  lerCorpoPublico,
  lerPaginaPublica,
  servirImagemPublica,
} from '@/server/aprovacao-publica';
import { readPlanningWeeks, resolvePlanningQuota } from '@/server/planning-weeks';
/* A lista de quem se pode pôr como responsável NESTA tarefa — F17.69. */
import { lerPessoasAtribuiveis } from '@/server/responsaveis-da-tarefa';
import {
  activationPorts,
  findExistingAccountId,
  findInviteAccountId,
  findResetAccountId,
  loginPorts,
  refreshWithProvider,
  resetRedeemPorts,
  revokeSessionWithProvider,
  setPasswordWithProvider,
  verifyPasswordWithProvider,
} from '@/server/ports';
import {
  REMEMBERED_SESSION_SECONDS,
  TETO_DA_SESSAO_EM_SEGUNDOS,
  asDbActor,
  bearerToken,
  refreshCookieHeader,
  refreshFromCookie,
  resolveActor,
  segundosAteVencer,
  sessionCookieHeader,
} from '@/server/session';
import { assertTestAccount } from '@/server/test-account-guard';
import {
  handleIntegration,
  isIntegrationPath,
  refuseHumanApiIfIntegrationToken,
  type IntegrationEnv,
} from '@/integrations/handler';
// A rede de contenção do `fetch` reaproveita o id de requisição das
// integrações: um só formato de id em todo o Worker, um só cabeçalho a pedir
// quando alguém relatar uma falha.
import { resolveRequestId, withRequestId } from '@/integrations/limits';

type Env = ServerEnv & {
  ASSETS?: { fetch(request: Request): Promise<Response> };
  /**
   * KV do OAuth de agentes — namespace `ide-works-oauth`, ligado no
   * `wrangler.toml` em 21/09/2026. É onde moram o cliente registrado, o
   * pedido pendente e o token.
   *
   * Opcional no tipo porque `vite dev` e a suíte rodam SEM binding e caem em
   * `MemoryKv` de propósito. Em produção, ausência aqui = `Invalid client_id`
   * no `/oauth/authorize`, porque o registro fica preso no isolado que o criou.
   */
  OAUTH_KV?: IntegrationEnv['OAUTH_KV'];
  IDEWORKS_PUBLIC_SUPABASE_ANON_KEY: string;
  /**
   * Superfície de agentes. Só `'false'` desliga `/mcp`, OAuth e
   * `/api/integrations/v1`. Site e `/api` humana não leem esta var.
   */
  IDEWORKS_INTEGRATIONS_ENABLED?: string;
  /** Escritas de agente (`add_comment` / `move_task`). Mesma leitura. */
  IDEWORKS_INTEGRATION_WRITES_ENABLED?: string;
  IDEWORKS_TEST_ACCOUNTS_ONLY?: string;
  /** Lista de e-mails liberados apesar da trava, separados por virgula. */
  IDEWORKS_ALLOWED_ACCOUNTS?: string;
  /** O domínio próprio, ex.: `https://works.suaempresa.com.br`. Vazio = sem redirecionar. */
  IDEWORKS_PUBLIC_ORIGIN?: string;
  /**
   * Os hospedeiros de imagem em que ESTA INSTALAÇÃO confia — F17.22.
   *
   * Separados por vírgula, comparados por igualdade exata de `hostname`, sem
   * curinga. É o que autoriza a prévia a apontar um `<img src>` para o
   * Nextcloud do próprio usuário; fora da lista, nada muda. O motivo inteiro
   * está em `wrangler.toml` e em `src/board/previa-de-link.ts`.
   *
   * NÃO É SEGREDO: são nomes de servidor que já aparecem em cada link colado
   * numa tarefa. Por isso a rota que os entrega não exige sessão — a tela de
   * login precisa deles antes de haver sessão alguma.
   */
  IDEWORKS_TRUSTED_IMAGE_HOSTS?: string;
  /**
   * Chave do chat — F20.3. Três estados: desligado | piloto | ligado.
   * Ausente ou texto inválido = desligado. Ver `chatModeFromEnv`.
   */
  IDEWORKS_CHAT?: string;
  /**
   * As empresas OMITIDAS das telas — F31. Nomes de `client_categories`,
   * separados por vírgula, sem diferenciar maiúsculas. Ausente ou vazia = nada
   * omitido. Omitir não apaga nada; o porquê inteiro está em `wrangler.toml` e
   * em `src/server/omitidas.ts`.
   */
  IDEWORKS_EMPRESAS_OMITIDAS?: string;
  /**
   * Central de entrega ao vivo — F20.4 / D22.
   * Binding do Durable Object `ChatCentral` (SQLite, uma instância).
   * Opcional no tipo: testes de borda montam Env sem a central.
   */
  CHAT_CENTRAL?: DurableObjectNamespace;
  /**
   * O token do System User da Meta — decisão D14, e a credencial PADRÃO.
   *
   * Segredo do Worker, e nunca linha de tabela. A D14 dizia "há UM System User
   * para toda a carteira"; deixou de ser verdade quando a Alma Nove entrou com
   * BM e app próprios. O que sobreviveu da decisão é a parte que importa:
   * **token não mora no banco**. O banco guarda só o NOME da variável de cada
   * empresa (F7g).
   *
   * As demais chegam como `IDEWORKS_META_TOKEN_<EMPRESA>` e não são declaradas
   * aqui de propósito: `credenciaisDoAmbiente` varre o ambiente, para uma
   * empresa nova custar um segredo e uma linha no banco — e não uma publicação.
   */
  IDEWORKS_META_TOKEN?: string;
  /**
   * A chave de serviço do Supabase — F17.6, e ELA EXISTE desde 2026-09-01:
   * está em `.dev.vars` e é segredo do Worker publicado, conferido com
   * `wrangler secret list` na F17.52. O texto que dizia o contrário viveu aqui
   * por dias depois de deixar de ser verdade, e desligou uma tela por engano.
   *
   * O balde `ideworks-anexos` é PRIVADO e não tem nenhuma política permissiva
   * em `storage.objects`: `anon` e `authenticated` são negados por construção.
   * O balde de documentos do Sistema IDE era o contrário — público, com
   * documento de cliente legível sem login — até a F17.52 o fechar.
   *
   * Consequência: só quem ignora RLS alcança os bytes, e quem ignora RLS é o
   * papel `service_role`. A chave dele é TRANSPORTE, e não autorização: quem
   * decide o alcance continua sendo o banco, consultado antes de cada ida ao
   * Storage. Ver o cabeçalho de `server/board-anexos.ts`.
   *
   * PREFIXO `IDEWORKS_SERVER_`, e não `IDEWORKS_PUBLIC_`: o empacotador exporta
   * SÓ o prefixo público, e há teste que quebra a construção se um segredo
   * escapar para o pacote. Uma `service_role` no navegador daria a qualquer
   * visitante o banco inteiro, `public` do Sistema IDE incluído.
   *
   * Num ambiente onde ela falte, comentário e link funcionam e as rotas de
   * arquivo respondem 503 nomeando esta variável.
   */
  IDEWORKS_SERVER_SUPABASE_SERVICE_KEY?: string;
  /**
   * O app do Dropbox, só leitura — F42 Fase 2. Os três juntos: chave e segredo
   * do app (App Console) e o refresh token da conta da agência
   * (`scripts/dropbox-autorizar.mjs`). Lidos por `credenciaisDoDropbox`
   * (`src/server/dropbox.ts`); faltando um, a aprovação recusa com a frase
   * `sem_credencial`. Sem prefixo `IDEWORKS_PUBLIC_`: nunca vão ao navegador.
   */
  IDEWORKS_DROPBOX_APP_KEY?: string;
  IDEWORKS_DROPBOX_APP_SECRET?: string;
  IDEWORKS_DROPBOX_REFRESH_TOKEN?: string;
  /**
   * A chave do link de aprovação do cliente — F42 Fase 3. 32 bytes em base64
   * (`openssl rand -base64 32`). Cifra o token do link fixo (AES-GCM) para a
   * equipe poder copiá-lo de novo; o banco guarda só o texto cifrado. Faltando,
   * "gerar" e "copiar link" respondem 503 nomeando o segredo; a rota pública
   * não precisa dela (resolve por hash). TROCAR a chave invalida a cópia dos
   * links existentes (o link continua resolvendo; só "copiar" pede gerar outro).
   * Ver `src/server/link-de-aprovacao.ts`.
   */
  IDEWORKS_APPROVAL_LINK_KEY?: string;
};

/**
 * Toda resposta JSON da API é de UMA pessoa (ou o endereço assinado de um
 * arquivo dela) e sai `no-store`: navegador, extensão e intermediário não a
 * guardam, e o botão Voltar não a reapresenta depois do Sair. `nosniff` porque
 * o corpo é dado, nunca página — nenhum navegador deve adivinhar outro tipo.
 * Quem precisa de outro cache o declara por cima (`headers.set`), como a rota
 * pública da aprovação faz com a imagem.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });

const log = (message: string, error?: unknown) =>
  console.error(`[ide-works] ${message}`, error ?? '');

/**
 * Os códigos do Postgres que significam "o VALOR que veio não serve", e não
 * "o servidor falhou": texto inválido para o tipo (uuid, enum, boolean),
 * data/hora inválida ou fora da faixa, número fora da faixa, texto longo demais.
 */
const CODIGOS_DE_PEDIDO_TORTO: ReadonlySet<string> = new Set([
  '22P02', // invalid_text_representation
  '22007', // invalid_datetime_format
  '22008', // datetime_field_overflow
  '22003', // numeric_value_out_of_range
  '22001', // string_data_right_truncation
]);

const FRASE_PEDIDO_TORTO =
  'Algum dado do pedido não tem a forma esperada. Confira os campos e tente de novo.';

/** A recusa do envio cujo corpo passa do teto antes mesmo de ser lido. */
const FRASE_PEDIDO_GRANDE = 'Pedido grande demais.';

const FRASE_ENVIO_GRANDE =
  `O envio passa do teto de ${tamanhoLegivel(TETO_DE_BYTES)}. ` +
  'Para algo maior, ponha o link do Dropbox ao lado.';

/** Um uuid na forma que o Postgres aceita — para recusar com 400, e não 500. */
const UUID_DA_ROTA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A origem do pedido, como CHAVE dos limites de tentativa (login, ativação,
 * redefinição, aprovação pública).
 *
 * IPv6 conta pelo /64: um aparelho recebe um /64 inteiro do provedor e troca de
 * endereço dentro dele à vontade, então contar por endereço dava a quem testa
 * senhas um balde novo a cada tentativa — o teto por origem (10 em 15 minutos no
 * login) não valia nada contra IPv6. Só o teto por conta segurava. IPv4 fica como
 * está. `chaveDoIp` é idempotente: a aprovação pública a aplica de novo sem efeito.
 */
function clientIp(request: Request): string {
  return chaveDoIp(
    request.headers.get('CF-Connecting-IP') ?? request.headers.get('x-forwarded-for') ?? '0.0.0.0',
  );
}

/**
 * De qual empresa descobrir, e com qual token — F7g.
 *
 * POR QUE ESCOLHER A EMPRESA É ATO DE SUPER ADMIN
 *   Escolher a empresa aqui decide de qual portfólio as contas entram, e com
 *   que carimbo. Errar isso liga contas da Alma Nove como se fossem da Ide, e
 *   o conserto depois é conta por conta — a coleta de cada uma passa a usar o
 *   token que não a alcança, e cada uma falha em silêncio até alguém notar.
 *
 * SEM EMPRESA CONTINUA VALENDO
 *   É o caminho de antes, com a credencial padrão. Um administrador comum
 *   continua podendo importar assim, sem escolher nada.
 */
async function credencialDaEmpresa(
  sql: ReturnType<typeof connect>,
  actor: Parameters<typeof readEmpresasParaMeta>[1],
  env: Env,
  empresaId: string | null,
): Promise<
  | { token: string | null; empresa: { id: string; name: string } | null }
  | { recusa: string; status: 403 | 404 }
> {
  if (!empresaId) {
    return { token: env.IDEWORKS_META_TOKEN ?? null, empresa: null };
  }

  if (!actor.isSuper) {
    return { recusa: 'Só o super admin escolhe a empresa da descoberta.', status: 403 };
  }

  const empresa = (await readEmpresasParaMeta(sql, actor)).find((e) => e.id === empresaId);
  if (!empresa) return { recusa: 'Empresa não encontrada.', status: 404 };

  const nome = empresa.secretName ?? 'IDEWORKS_META_TOKEN';
  const valor = (env as unknown as Record<string, unknown>)[nome];
  if (typeof valor !== 'string' || valor.trim() === '') {
    // Diz QUAL segredo falta. "Sem token" genérico faria procurar no lugar
    // errado quando o que existe é uma variável não definida neste ambiente.
    return {
      recusa: `A empresa "${empresa.name}" usa a credencial ${nome}, que não está definida neste servidor.`,
      status: 404,
    };
  }
  return { token: valor, empresa: { id: empresa.id, name: empresa.name } };
}

/**
 * O endereço próprio do sistema (o domínio de `[[routes]]` no `wrangler.toml`),
 * lido de `IDEWORKS_PUBLIC_ORIGIN`. Vazio = ainda não há domínio próprio, e o
 * `*.workers.dev` atende tudo, sem redirecionar.
 */
function enderecoProprio(env: Pick<Env, 'IDEWORKS_PUBLIC_ORIGIN'>): string | null {
  const valor = (env.IDEWORKS_PUBLIC_ORIGIN ?? '').trim().replace(/\/+$/, '');
  return /^https:\/\/[^/]+$/.test(valor) ? valor : null;
}

/**
 * PÁGINA PEDIDA PELO `*.workers.dev` VAI PARA O ENDEREÇO PRÓPRIO (301).
 *
 * POR QUE O ENDEREÇO ANTIGO CONTINUA LIGADO
 *   `workers_dev = true` no `wrangler.toml` é o seguro contra uma rota que
 *   falhe no deploy. Além disso, o Claude e outros agentes já estão conectados
 *   a ele (OAuth e MCP): trocar o endereço delas quebra a conexão.
 *
 * O QUE FICA VIVO NELE, SEM REDIRECIONAR
 *   `/api/*` (inclui `/api/meta/*`, a saúde e a coleta), `/mcp*`, `/oauth/*` e
 *   `/.well-known/*` — tudo o que é máquina, não navegação. Só `GET` e `HEAD`
 *   de PÁGINA (o resto do site) é mandado embora; mesmo caminho e mesma query.
 *
 * SÓ FUNCIONA PORQUE O `run_worker_first` DO `wrangler.toml` MANDA AS PÁGINAS
 * PARA CÁ. Sem isso a Cloudflare serve o `index.html` antes do Worker rodar.
 */
function redirecionamentoDoWorkersDev(
  request: Request,
  env: Pick<Env, 'IDEWORKS_PUBLIC_ORIGIN'>,
): Response | null {
  const destino = enderecoProprio(env);
  if (!destino) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  if (!url.hostname.endsWith('.workers.dev')) return null;
  const { pathname } = url;
  if (
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/.well-known/') ||
    isIntegrationPath(pathname)
  ) {
    return null;
  }
  return new Response(null, {
    status: 301,
    headers: { location: `${destino}${pathname}${url.search}` },
  });
}

/**
 * O atendimento de uma requisição, INTEIRO — extraído do `fetch` na F23.
 *
 * Ele era o corpo do próprio `fetch`. Saiu de lá para o `fetch` poder ser só a
 * rede de contenção de último nível: `try { atenderRequisicao(...) } catch`.
 * Nada do que está aqui dentro mudou de comportamento com a extração.
 */
async function atenderRequisicao(
  request: Request,
  env: Env,
  ctx?: { waitUntil(promise: Promise<unknown>): void; props?: unknown },
): Promise<Response> {
  const url = new URL(request.url);

  // O ENDEREÇO ANTIGO (`*.workers.dev`) SÓ ATENDE MÁQUINA — F44, Fase 9.
  // Página que chega por ele vai, com 301, para o endereço próprio.
  const paraOEnderecoProprio = redirecionamentoDoWorkersDev(request, env);
  if (paraOEnderecoProprio) return paraOEnderecoProprio;

  // MCP, OAuth e HTTP de integrações PRECISAM vir antes do fallback de
  // arquivos. Sem este recorte, `/mcp` devolve o HTML do site e o cliente
  // de agente acha que o servidor falou português de página, não JSON-RPC.
  if (isIntegrationPath(url.pathname)) {
    return handleIntegration(request, env, ctx ?? { waitUntil() {} });
  }

  // O front e servido pelo proprio Worker: uma implantacao so, mesma origem,
  // sem CORS. Tudo sob /api e API; o resto e o site.
  //
  // Em desenvolvimento o servidor do front faz o mesmo recorte por proxy, para
  // os dois ambientes se comportarem igual — divergencia entre eles e a fonte
  // classica do "funciona na minha maquina".
  if (!url.pathname.startsWith('/api')) {
    if (!env.ASSETS) return new Response('Site não publicado neste Worker.', { status: 404 });

    const resposta = await env.ASSETS.fetch(request);

    // O front tem rotas proprias (/painel, /cliente/:id). O servidor de
    // arquivos nao as conhece e devolve a pagina com 404 — o navegador exibe
    // certo, mas o codigo diz "nao existe", o que engana monitoracao, cache e
    // buscador. Numa aplicacao de pagina unica, a pagina EXISTE: quem resolve
    // o caminho e o front.
    if (resposta.status === 404 && request.headers.get('Accept')?.includes('text/html')) {
      return new Response(resposta.body, {
        status: 200,
        headers: resposta.headers,
      });
    }
    return resposta;
  }

  // PEDIDO QUE MUDA ESTADO SÓ VALE SE SAIU DA PÁGINA DO APP. O cookie é
  // `SameSite=Strict`, mas outro subdomínio do mesmo domínio é "o mesmo site" —
  // ver `origem-do-pedido.ts`. Antes de tudo: não toca no provedor nem no banco.
  // A rota pública da aprovação (sem cookie) faz a própria conferência, com os
  // cabeçalhos dela (`lerCorpoPublico`).
  if (
    !url.pathname.startsWith('/api/public/aprovacao/') &&
    pedidoVeioDeOutraOrigem(request)
  ) {
    return json({ message: FRASE_OUTRA_ORIGEM_DO_PEDIDO }, 403);
  }

  // CORPO JSON GRANDE DEMAIS É 413 SEM LER NADA. Sem esta porta o Worker puxava
  // o corpo inteiro para a memória (`request.json()`) antes de olhar o que era —
  // inclusive em `/auth/login`, que não pede sessão. Envio de arquivo tem o teto
  // próprio (`lerFormularioComTeto`) e a aprovação pública, o dela.
  if (
    !url.pathname.startsWith('/api/public/aprovacao/') &&
    !ehEnvioDeArquivo(request) &&
    declaraCorpoMaiorQue(request, tetoDoJson(url.pathname))
  ) {
    return json({ message: FRASE_PEDIDO_GRANDE }, 413);
  }

  // Token de integração não autentica a API humana — cookie de sessão ou
  // Bearer do Supabase. O crachá MCP/HTTP de agente tem outra audiência.
  const recusaIntegracao = await refuseHumanApiIfIntegrationToken(request, env);
  if (recusaIntegracao) return recusaIntegracao;

  const caminho = url.pathname.slice(4) || '/';
  // `rota` vai para o log nas falhas. O token do link de aprovação (F42) é a
  // credencial do cliente: no log ele sai mascarado. As comparações exatas com
  // `rota` não alcançam este caminho (ele casa por `caminho`).
  const rota = `${request.method} ${caminho}`.replace(/^([A-Z]+ \/public\/aprovacao\/)[^/]+/, '$1:token');

  // --- saúde: não revela nada além de estar no ar --------------------------
  if (rota === 'GET /health') {
    const ref = env.IDEWORKS_PUBLIC_SUPABASE_URL?.replace('https://', '').split('.')[0];
    return json({ ok: true, schema: 'ideworks', projeto: ref ?? '(não configurado)' });
  }

  // --- a configuração que o NAVEGADOR precisa saber — F17.22 ---------------
  //
  // Uma só coisa até agora: em quais hospedeiros de imagem esta instalação
  // confia. A prévia do link decide com ela se um endereço pode virar `<img
  // src>`, e essa decisão acontece no navegador — daí ela precisar atravessar.
  //
  // SEM SESSÃO, e é deliberado: a lista não é segredo (são nomes de servidor
  // que já aparecem em cada link colado numa tarefa) e o sistema a lê na
  // abertura, antes de existir sessão. Exigir crachá aqui faria a lista
  // chegar só depois do login, e a primeira tarefa aberta perderia a imagem.
  //
  // Não toca no banco. É o que a mantém mais rápida que qualquer leitura de
  // tarefa — ver `src/main.tsx`.
  if (rota === 'GET /config') {
    // `chat` atravessa sem sessão pelo mesmo motivo dos hospedeiros: a barra
    // lateral precisa saber se esconde o item antes (e sem) login completo.
    return json({
      ok: true,
      trustedImageHosts: env.IDEWORKS_TRUSTED_IMAGE_HOSTS ?? '',
      chat: chatModeFromEnv(env.IDEWORKS_CHAT),
    });
  }

  const provider = {
    url: env.IDEWORKS_PUBLIC_SUPABASE_URL,
    anonKey: env.IDEWORKS_PUBLIC_SUPABASE_ANON_KEY,
    // Enquanto o banco for compartilhado com o Sistema IDE em produção, só se
    // cria conta em domínio reservado. Desligar isto é decisão explícita.
    testAccountsOnly: env.IDEWORKS_TEST_ACCOUNTS_ONLY !== 'false',
    // Quem entra apesar da trava — nomes proprios, versionados. Ver
    // `test-account-guard.ts`.
    allowedAccounts: env.IDEWORKS_ALLOWED_ACCOUNTS ?? '',
    // A porta de administração do provedor. Só o caminho de redefinição de
    // senha a usa, e só depois de o código de intenção "reset" ter batido.
    serviceKey: env.IDEWORKS_SERVER_SUPABASE_SERVICE_KEY,
    // O que não é da Ide sai das leituras — F31. `resolveActor` resolve os
    // nomes, barra o endereço direto e entrega os ids no ator.
    empresasOmitidas: env.IDEWORKS_EMPRESAS_OMITIDAS,
  };

  const sql = connect(env);

  /**
   * A credencial que fala com o Storage — e ela serve DOIS baldes.
   *
   * Estava declarada lá embaixo, junto das rotas de anexo da tarefa, e subiu
   * na F17.52: o documento do histórico do cliente passou a precisar da mesma
   * assinatura, e a rota dele vem antes na ordem do arquivo.
   *
   * `ideworks-anexos` ..................... privado desde que nasceu (F17.6)
   * `client-history-documents` ............ privado desde a F17.52
   *
   * A chave é TRANSPORTE, e não autorização: quem decide o alcance é o banco,
   * consultado sob o ator declarado antes de cada ida ao Storage. Faltando a
   * chave, as rotas de arquivo respondem 503 nomeando a variável — e nenhuma
   * outra rota sente falta dela.
   */
  const armazenamento: ArmazenamentoPrivado = {
    supabaseUrl: env.IDEWORKS_PUBLIC_SUPABASE_URL,
    serviceKey: env.IDEWORKS_SERVER_SUPABASE_SERVICE_KEY,
  };

  try {
    // --- login ------------------------------------------------------------
    if (rota === 'POST /auth/login') {
      const body = (await request.json().catch(() => ({}))) as {
        email?: string;
        password?: string;
        rememberMe?: boolean;
      };
      // Texto, e não "qualquer coisa verdadeira": `email: 123` chegava a
      // `.trim()` e virava o 500 de um TypeError numa porta sem sessão.
      if (
        typeof body.email !== 'string' ||
        typeof body.password !== 'string' ||
        !body.email ||
        !body.password
      ) {
        return json({ message: 'e-mail ou senha inválidos' }, 400);
      }

      const cracha: { value: { accessToken: string; refreshToken: string | null } | null } = { value: null };
      const resultado = await attemptLogin(
        { email: body.email, password: body.password, ip: clientIp(request) },
        loginPorts(sql, provider, log, (t) => {
          cracha.value = t;
        }),
      );

      if (!resultado.ok) return json({ message: resultado.message }, 401);

      // O crachá só sai quando TODAS as conferências passaram. Emiti-lo junto
      // com a senha correta entregaria acesso a quem não tem perfil no IDE
      // Works, ou está desativado — os dois casos que o login barra depois.
      //
      // Ele vai em cookie INACESSÍVEL AO JAVASCRIPT: sobrevive à recarga e
      // nem o nosso código o alcança. O corpo devolve `accessToken` apenas
      // para chamada programática, que não tem navegador guardando cookie.
      const emitido = cracha.value;
      const resposta = json({
        ok: true,
        userId: resultado.userId,
        accessToken: emitido?.accessToken ?? null,
        // Quanto o crachá vale, para a tela renovar ANTES de vencer.
        crachaValePor: segundosAteVencer(emitido?.accessToken),
      });
      if (emitido) {
        /*
         * ⚠️ O `Max-Age` DE OITO HORAS ERA UMA MENTIRA — F17.62.
         *
         * O crachá de acesso do provedor vive UMA HORA: medido, `exp - iat`
         * de um crachá real deste projeto dá 3.600 segundos exatos. Dizer ao
         * navegador que o cookie vale oito horas não estendia o crachá — só
         * fazia o navegador continuar mandando um crachá morto, e o provedor
         * recusar. Era isso que a equipe chamava de "deslogando fácil".
         *
         * Agora os dois cookies vivem o TETO da sessão, e quem decide se a
         * sessão continua é a renovação, não o relógio do cookie.
         */
        // Somente o booleano true solicita o prazo maior. Clientes antigos
        // que não enviam a preferência continuam com doze horas.
        const duration = body.rememberMe === true
          ? REMEMBERED_SESSION_SECONDS
          : TETO_DA_SESSAO_EM_SEGUNDOS;
        const limite = Math.floor(Date.now() / 1000) + duration;
        resposta.headers.append(
          'Set-Cookie',
          sessionCookieHeader(emitido.accessToken, duration),
        );
        if (emitido.refreshToken) {
          resposta.headers.append(
            'Set-Cookie',
            refreshCookieHeader(emitido.refreshToken, limite, duration),
          );
        }
      }
      return resposta;
    }

    // --- renovar o crachá ---------------------------------------------------
    //
    // O token de acesso dura uma hora; a sessão segue o prazo escolhido no login.
    //   Esta rota é a ponte entre as duas frases. A tela a chama quando uma
    //   chamada volta 401 — uma vez, e refaz a chamada original. Quem trabalha
    //   não vê nada acontecer: era isso, e não a tela de login, o que devia
    //   acontecer ao virar a hora.
    //
    // ⚠️ ELA NÃO ENTRA NO LIMITADOR, E ISSO É DELIBERADO
    //   O limitador existe contra quem ADIVINHA SENHA. Aqui não há senha para
    //   adivinhar: ou a pessoa tem o crachá de renovação, ou não tem. Contá-la
    //   junto trancaria o escritório inteiro para fora — são dez tentativas
    //   por origem a cada quinze minutos, e a agência sai por um endereço só.
    if (rota === 'POST /auth/refresh') {
      const guardado = refreshFromCookie(request);
      const apagarTudo = (mensagem: string) => {
        const r = json({ message: mensagem }, 401);
        r.headers.append('Set-Cookie', sessionCookieHeader('', 0));
        r.headers.append('Set-Cookie', refreshCookieHeader('', 0, 0));
        return r;
      };

      if (!guardado) {
        return apagarTudo('Sessão inválida ou expirada. Entre novamente.');
      }

      const agora = Math.floor(Date.now() / 1000);
      if (agora >= guardado.limiteEmSegundos) {
        // O TETO CHEGOU — e ele encerra a sessão de verdade.
        //
        // Apagar o cookie tiraria o crachá deste navegador e deixaria o
        // crachá de renovação vivo no provedor para quem o tivesse copiado.
        // Então trocamos uma última vez, só para ter um crachá de acesso com
        // que pedir a revogação, e encerramos a sessão no provedor.
        const ultima = await refreshWithProvider(provider, guardado.refreshToken);
        if (ultima.ok) await revokeSessionWithProvider(provider, ultima.accessToken);
        return apagarTudo('Sua sessão chegou ao limite de duração. Entre novamente.');
      }

      const renovado = await refreshWithProvider(provider, guardado.refreshToken);
      if (!renovado.ok) {
        // O PROVEDOR FORA DO AR NÃO APAGA A SESSÃO DE NINGUÉM.
        //
        // `503` e cookies INTACTOS: a próxima tentativa — a recarga da
        // pessoa, ou a chamada seguinte — encontra o mesmo crachá de
        // renovação e funciona. Apagar aqui trocaria uma indisponibilidade de
        // segundos por uma senha digitada de novo, que é exatamente a queixa
        // que esta etapa veio calar.
        if (renovado.motivo === 'indisponivel') {
          log('renovação de crachá: o provedor não respondeu');
          return json({ message: 'Não foi possível renovar agora. Tente de novo.' }, 503);
        }
        return apagarTudo('Sessão inválida ou expirada. Entre novamente.');
      }

      // O TETO NÃO ANDA. `limiteEmSegundos` é o do login, e é ele que volta
      // para o cookie — recalculá-lo aqui faria a sessão nunca acabar.
      const quantoFalta = guardado.limiteEmSegundos - agora;
      const resposta = json({
        ok: true,
        expiresAt: guardado.limiteEmSegundos,
        crachaValePor: segundosAteVencer(renovado.accessToken),
      });
      resposta.headers.append(
        'Set-Cookie',
        sessionCookieHeader(renovado.accessToken, quantoFalta),
      );
      resposta.headers.append(
        'Set-Cookie',
        refreshCookieHeader(renovado.refreshToken, guardado.limiteEmSegundos, quantoFalta),
      );
      return resposta;
    }

    // --- sair ---------------------------------------------------------------
    if (rota === 'POST /auth/logout') {
      // SAIR ENCERRA A SESSÃO NO PROVEDOR, e não só neste navegador — F17.62.
      //
      // Enquanto o crachá morria em uma hora, apagar o cookie bastava. Com a
      // renovação, um crachá copiado valeria o dia inteiro, e `Sair` teria
      // virado uma promessa que só vale para quem já estava na cadeira.
      //
      // `scope=local`: ver `revokeSessionWithProvider`. O padrão do provedor
      // derrubaria a pessoa também do Sistema IDE, que é o mesmo cadastro.
      const cracha = bearerToken(request);
      let encerrada = cracha ? await revokeSessionWithProvider(provider, cracha) : false;

      // ⚠️ O CRACHÁ DE ACESSO VIVE UMA HORA, E O COOKIE DELE O DIA INTEIRO. Quem
      // volta a uma aba parada e clica em Sair leva um crachá já morto: o
      // provedor recusa a revogação com ele, o cookie era apagado do mesmo
      // jeito, e o crachá de RENOVAÇÃO seguia valendo no provedor para quem o
      // tivesse copiado — o "Sair" que só vale para quem já estava na cadeira.
      // Nesse caso troca-se o de renovação UMA última vez, só para ter um
      // crachá de acesso novo com que pedir a revogação (o mesmo caminho do
      // teto de sessão, em `/auth/refresh`).
      if (!encerrada) {
        const guardado = refreshFromCookie(request);
        if (guardado) {
          const ultima = await refreshWithProvider(provider, guardado.refreshToken);
          if (ultima.ok) encerrada = await revokeSessionWithProvider(provider, ultima.accessToken);
        }
        // Sem cookie nenhum não há sessão a encerrar; com cookie e sem sucesso,
        // fica no registro — a saída não espera por isso, os cookies já saem.
        if (!encerrada && (cracha || guardado)) {
          log('saída: a sessão não pôde ser encerrada no provedor (o crachá de renovação segue vivo)');
        }
      }

      const resposta = json({ ok: true });
      resposta.headers.append('Set-Cookie', sessionCookieHeader('', 0));
      resposta.headers.append('Set-Cookie', refreshCookieHeader('', 0, 0));
      return resposta;
    }

    // --- quem sou eu --------------------------------------------------------
    // As telas perguntam isto ao abrir. Sem sessão, mandam para o login em vez
    // de mostrar uma lista vazia com "faltou o crachá" — que faz a pessoa achar
    // que o sistema quebrou, quando ela só precisa entrar.
    if (rota === 'GET /auth/me') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      return json({
        ok: true,
        // O ID ESTÁVEL de quem está na sessão — F17.AUD02. É o que vincula um
        // rascunho local ao seu autor. Vem do ator autenticado, o mesmo que
        // `/auth/login` já devolvia; o e-mail não serve para isso, porque
        // pode ser trocado e é o que a pessoa DIGITA, não o que o servidor
        // conferiu.
        userId: sessao.actor.userId,
        email: sessao.actor.email,
        // O NOME, para o chip da conta — F29. A mesma coluna que a tela de
        // Pessoas mostra, lida na conferência do crachá (ver `resolveActor`).
        // `null` quando a pessoa não tem nome: a tela mostra o e-mail.
        nome: sessao.actor.nome ?? null,
        isSuperadmin: sessao.actor.isSuperadmin,
        // O TOPO da hierarquia, separado de quem apenas administra: e ele
        // que decide empresa e cria outro super admin. A tela precisa saber
        // para nao oferecer o que a rota vai recusar.
        isSuper: sessao.actor.isSuper,
        papel: sessao.actor.papel,
        // As areas vao para a TELA esconder o que a pessoa nao alcanca. A
        // permissao continua sendo do servidor — isto e so para nao oferecer
        // uma porta que vai bater na cara.
        areas: sessao.actor.areas,
        // Quanto o crachá desta requisição ainda vale. A tela renova com um
        // minuto de folga, em vez de esperar o 401 — ver `criarRenovacao`.
        crachaValePor: segundosAteVencer(bearerToken(request)),
      });
    }

    // --- painel de clientes -----------------------------------------------
    if (rota === 'GET /clients') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      // O painel fala em INTERVALO desde a F4.11. Sem `from`/`to`, o padrão é
      // o mês corrente inteiro — que é o comportamento anterior, preservado
      // para quem chama a rota sem saber do intervalo.
      //
      // O MÊS PADRÃO É O DE SÃO PAULO, e não o de UTC: no último dia do mês, a
      // partir das 21h de Brasília, o UTC já está no mês seguinte.
      const hoje = diaDeSaoPaulo(new Date());
      const de = url.searchParams.get('from');
      const ate = url.searchParams.get('to');

      const inicio = de ?? firstDayOfMonth(hoje);
      const fim =
        ate ??
        new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)), 0))
          .toISOString()
          .slice(0, 10);

      try {
        const painel = await readPanel(sql, sessao.actor, inicio, fim);
        return json({
          ok: true,
          from: inicio,
          to: fim,
          months: monthsInRange(inicio, fim),
          clients: painel.clients,
          conferencia: painel.conferencia,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          /inválido|invertido|meses por vez/.test(error.message)
        ) {
          return json({ message: error.message }, 400);
        }
        throw error;
      }
    }

    // --- tela do cliente ---------------------------------------------------
    const detalhe = caminho.match(/^\/clients\/([0-9a-f-]{36})$/i);
    if (request.method === 'GET' && detalhe) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const mes = url.searchParams.get('month') ?? diaDeSaoPaulo(new Date());
      const de = url.searchParams.get('from');
      const ate = url.searchParams.get('to');
      const periodo = de && ate ? { from: de, to: ate } : undefined;

      try {
        return json({
          ok: true,
          client: await readClientDetail(sql, sessao.actor, detalhe[1], mes, periodo),
        });
      } catch (error) {
        if (error instanceof ClientNotVisible) return json({ message: error.message }, 404);
        if (error instanceof Error && error.message.includes('inválido')) {
          return json({ message: error.message }, 400);
        }
        throw error;
      }
    }

    // --- ritual mensal: abrir, planejar, aprovar ---------------------------
    // O PASSO CASA EXATO — sem `/i`. Com ele, `/Planning` casava aqui e,
    // como as comparações abaixo são exatas (`=== 'planning'`), caía no ramo
    // da APROVAÇÃO e gravava "cliente aprovou". Só o id aceita maiúsculas.
    const ritual = caminho.match(
      /^\/clients\/([0-9a-fA-F-]{36})\/months\/(\d{4}-\d{2}-\d{2})\/(open|planning|approval)$/,
    );
    if (ritual && (request.method === 'POST' || request.method === 'DELETE')) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const [, clienteId, mes, marco] = ritual;
      const feito = request.method === 'POST';

      // A forma `AAAA-MM-DD` não basta: `2026-02-30` passava pela expressão e
      // explodia no `::date` do banco como 500. Dia que não existe é pedido
      // errado, e a resposta diz qual.
      if (!ehDiaValido(mes)) return json({ message: `Mês inválido: "${mes}".` }, 400);
      // A expressão aceita 36 caracteres de hexa e hífen em qualquer ordem; o
      // que não é uuid de verdade também explodiria no banco como 500.
      if (!UUID_DA_ROTA.test(clienteId)) return json({ message: 'Cliente inválido.' }, 400);

      // Abrir o mês congela o contrato. É ação de administrador, e a própria
      // função do banco recusa quem não for.
      if (marco === 'open') {
        if (!feito) {
          return json(
            { message: 'Um mês aberto não se fecha: o contrato daquele mês fica congelado.' },
            400,
          );
        }
        try {
          const id = await withActor(sql, asDbActor(sessao.actor), async (tx) => {
            const linhas = await tx`
              select ideworks.open_month(${clienteId}, ${mes}::date, ${sessao.actor.userId}) as id`;
            return linhas[0]?.id as string;
          });
          return json({ ok: true, contractId: id });
        } catch (error) {
          /* SÓ A RECUSA DO BANCO É "SÓ ADMINISTRADOR". `open_month` recusa
             quem não é administrador com `42501`; antes, TODA falha virava esse
             403 — banco fora do ar, cliente que não existe — e a pessoa ouvia
             que não tinha permissão quando o problema era outro. Cliente
             inexistente é a chave estrangeira (`23503`); o resto sobe para a
             falha genérica, com log. */
          const codigo = (error as { code?: string }).code;
          if (codigo === '42501') {
            log('abertura de mês recusada', error);
            return json({ message: 'Só um administrador abre o mês.' }, 403);
          }
          if (codigo === '23503') return json({ message: 'Cliente não encontrado.' }, 404);
          throw error;
        }
      }

      const estado = await withActor(sql, asDbActor(sessao.actor), async (tx) => {
        const linhas = await tx`
          select planning_done_at, client_approved_at
            from ideworks.month_contracts
           where client_id = ${clienteId} and reference_month = ${mes}::date`;
        return linhas[0];
      });

      const decisao = decideRitualChange(
        {
          monthOpened: estado !== undefined,
          planningDoneAt: (estado?.planning_done_at as string | null) ?? null,
          clientApprovedAt: (estado?.client_approved_at as string | null) ?? null,
        },
        { step: marco === 'planning' ? 'planning' : 'approval', done: feito },
      );

      if (!decisao.ok) return json({ message: decisao.message, reason: decisao.reason }, 409);

      const gravadas = await withActor(sql, asDbActor(sessao.actor), async (tx) => {
        const quando = feito ? new Date() : null;
        const quem = feito ? sessao.actor.userId : null;
        const feitas =
          marco === 'planning'
            ? await tx`
                update ideworks.month_contracts
                   set planning_done_at = ${quando}, planning_done_by = ${quem}
                 where client_id = ${clienteId} and reference_month = ${mes}::date`
            : await tx`
                update ideworks.month_contracts
                   set client_approved_at = ${quando}, client_approved_by = ${quem}
                 where client_id = ${clienteId} and reference_month = ${mes}::date`;
        return feitas.count;
      });

      /* NENHUMA LINHA GRAVADA NÃO É "OK" — F43, Fase 3. A leitura logo acima
         ACHOU o contrato do mês (senão a regra teria recusado com
         `month_not_opened`); se o `update` não mexeu em linha nenhuma, foi a
         política `contracts_update` (só administrador) que o barrou — o banco
         não reclama, só não grava. Responder `ok` aqui era a tela mostrando
         a chave ligada sobre um mês que continuava igual. */
      if (gravadas === 0) return json({ message: RECUSA_SO_ADMIN_MARCA }, 403);

      return json({ ok: true, note: decisao.note });
    }

    // --- calendário --------------------------------------------------------
    // Sem tabela propria: e uma consulta sobre os itens que tem data. No
    // legado o calendario e uma tabela separada, e os mesmos conteudos sao
    // cadastrados duas vezes, com vocabularios diferentes para o tipo.
    if (rota === 'GET /calendar') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const de = url.searchParams.get('from');
      const ate = url.searchParams.get('to');
      if (!de || !ate) return json({ message: 'Informe o período (from e to).' }, 400);
      // Dia que não existe (ou texto) iria ao `::date` do banco e voltava 500.
      if (!ehDiaValido(de) || !ehDiaValido(ate)) {
        return json({ message: 'Período inválido: use from e to em AAAA-MM-DD, com dias que existem.' }, 400);
      }

      const cliente = url.searchParams.get('client') ?? undefined;
      if (cliente && !UUID_DA_ROTA.test(cliente)) return json({ message: 'Cliente inválido.' }, 400);
      return json({
        ok: true,
        period: { from: de, to: ate },
        entries: await readCalendar(sql, sessao.actor, { from: de, to: ate }, cliente),
      });
    }

    // --- agendar e desagendar ----------------------------------------------
    const agenda = caminho.match(/^\/items\/([0-9a-f-]{36})\/schedule$/i);
    if (agenda && (request.method === 'POST' || request.method === 'DELETE')) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      let quando: string | null = null;
      if (request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as { at?: unknown };
        if (!body.at) return json({ message: 'Informe a data e a hora.' }, 400);
        if (!ehInstanteDeAgenda(body.at)) {
          return json({ message: 'Data inválida: use AAAA-MM-DD, com um dia que existe.' }, 400);
        }
        quando = body.at;
      }

      const mudou = await scheduleItem(sql, sessao.actor, agenda[1], quando);
      return mudou ? json({ ok: true }) : json({ message: 'Item não encontrado.' }, 404);
    }

    // --- marcar e desmarcar produção ---------------------------------------
    // Quem enxerga o cliente pode marcar. Exigir administrador aqui
    // paralisaria a operação diária de quem cuida da carteira.
    const conclusao = caminho.match(/^\/items\/([0-9a-f-]{36})\/completion$/i);
    if (conclusao && (request.method === 'POST' || request.method === 'DELETE')) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      try {
        await withActor(sql, asDbActor(sessao.actor), async (tx) => {
          if (request.method === 'POST') {
            await tx`select ideworks.complete_item(${conclusao[1]}, ${sessao.actor.userId})`;
          } else {
            await tx`select ideworks.uncomplete_item(${conclusao[1]})`;
          }
        });
        return json({ ok: true });
      } catch (error) {
        // A função do banco recusa com 42501 tanto para item inexistente
        // quanto para item de cliente alheio. A mensagem é a mesma nos dois:
        // distinguir entregaria a existência de itens de outra carteira.
        log('conclusão recusada', error);
        return json({ message: 'Item não encontrado.' }, 404);
      }
    }

    // --- criar item ---------------------------------------------------------
    if (rota === 'POST /items') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const body = (await request.json().catch(() => ({}))) as {
        clientId?: string;
        month?: string;
        contentType?: string;
        isExtra?: boolean;
        scheduledAt?: string | null;
        title?: string | null;
      };
      if (!body.clientId || !body.month || !body.contentType) {
        return json({ message: 'Informe cliente, mês e tipo de conteúdo.' }, 400);
      }
      // Entrada errada é 400 com a frase, e não o 500 do `::uuid`, do
      // `::ideworks.content_type` ou do `firstDayOfMonth` lá embaixo. O mês
      // vem como as telas mandam (`AAAA-MM-01`) — ou `AAAA-MM`, que a rota
      // sempre aceitou —, mas tem de existir no calendário.
      if (typeof body.clientId !== 'string' || !UUID_DA_ROTA.test(body.clientId)) {
        return json({ message: 'Cliente inválido.' }, 400);
      }
      if (
        typeof body.month !== 'string' ||
        !(ehDiaValido(body.month) || /^\d{4}-(0[1-9]|1[0-2])$/.test(body.month))
      ) {
        return json({ message: `Mês inválido: "${String(body.month)}".` }, 400);
      }
      if (
        body.scheduledAt !== undefined &&
        body.scheduledAt !== null &&
        !ehInstanteDeAgenda(body.scheduledAt)
      ) {
        return json({ message: 'Data inválida: use AAAA-MM-DD, com um dia que existe.' }, 400);
      }
      if (!(CONTENT_TYPES as readonly unknown[]).includes(body.contentType)) {
        return json(
          {
            message:
              `Tipo de conteúdo inválido: "${String(body.contentType)}". ` +
              `Os tipos válidos são: ${CONTENT_TYPES.join(', ')}.`,
          },
          400,
        );
      }

      const criado = await withActor(sql, asDbActor(sessao.actor), async (tx) => {
        /*
          ⚠️ QUEM NÃO DIZ SE É EXTRA, PERGUNTA AO MÊS — F17.44.

          A grade semanal manda `isExtra` calculado por ela: extra é o que
          passa da cota DO MÊS, e não da semana. O calendário, que passou a
          criar entrega nesta etapa, não tem esse número em mãos — a grade do
          mês desenha dias, e não cotas.

          Copiar a conta para a tela do calendário daria duas respostas para a
          mesma pergunta, e a de cima ficaria para trás na primeira mudança —
          que é exatamente o que a F17.25 e a F17.26 tiveram de recolher.
          Então quem não manda o campo recebe a resposta do banco, com a mesma
          regra: `is_extra` quando a base daquele tipo já está cheia.

          MÊS AINDA NÃO ABERTO PERGUNTA AO CADASTRO — correção da revisão
          pós-F43. Até aqui, mês sem contrato dava cota zero e o primeiro item
          já nascia extra. Só que o planejamento acontece ANTES da abertura: o
          "+" da grade de Semanas e o "+ Peça" do calendário criavam as oito
          artes do mês todas como extra, e `open_month` congela a cota sem
          reclassificar nada — as peças ficavam extras para sempre, e a faixa
          lia "0 entregues, 8 sem dia" num mês com tudo marcado. Agora a cota
          sai de `resolvePlanningQuota`, a mesma regra da grade de Semanas: mês
          ABERTO vale o contrato congelado, mesmo vazio (F17.57); mês sem
          contrato vale o cadastro de hoje (`client_quotas`); sem nenhum dos
          dois, cota zero e extra, como antes. O que já foi gravado como extra
          antes desta correção continua extra — reclassificar é ordem do dono.
        */
        let extra = body.isExtra;
        if (extra === undefined) {
          const tipo = body.contentType as ContentType;
          const [conta] = await tx`
            select
              (select count(*)
                 from ideworks.content_items
                where client_id = ${body.clientId!}
                  and reference_month = ${firstDayOfMonth(body.month!)}
                  and content_type = ${tipo}::ideworks.content_type
                  and not is_extra) as na_base,
              exists (select 1
                        from ideworks.month_contracts mc
                       where mc.client_id = ${body.clientId!}
                         and mc.reference_month = ${firstDayOfMonth(body.month!)})
                as mes_aberto,
              coalesce((select i.quantity
                          from ideworks.month_contracts mc
                          join ideworks.month_contract_items i on i.contract_id = mc.id
                         where mc.client_id = ${body.clientId!}
                           and mc.reference_month = ${firstDayOfMonth(body.month!)}
                           and i.content_type
                                 = ${tipo}::ideworks.content_type), 0)
                as contratado,
              coalesce((select q.quantity
                          from ideworks.client_quotas q
                         where q.client_id = ${body.clientId!}
                           and q.content_type = ${tipo}::ideworks.content_type), 0)
                as cadastrado`;
          const { quota } = resolvePlanningQuota({
            opened: Boolean(conta.mes_aberto),
            contract: { [tipo]: Number(conta.contratado) },
            // Cota zero no cadastro é "sem cota" — o mesmo `quantity > 0` da
            // leitura da grade de Semanas.
            registry: Number(conta.cadastrado) > 0 ? { [tipo]: Number(conta.cadastrado) } : undefined,
          });
          extra = Number(conta.na_base) >= (quota[tipo] ?? 0);
        }

        // O DIA PURO É O MEIO-DIA DE SÃO PAULO (conferência de 09/10/2026): sem
        // isto, `'2026-10-31'` era lido no fuso da sessão (UTC) e a peça nascia
        // às 21h de 30/10 — o dia anterior no Calendário. Ver `instanteDaPecaNova`.
        const { diaPuro, instante } = instanteDaPecaNova(body.scheduledAt);
        const linhas = await tx`
          insert into ideworks.content_items
            (client_id, reference_month, content_type, is_extra, scheduled_at, title)
          values (${body.clientId!}, ${firstDayOfMonth(body.month!)},
                  ${body.contentType!}::ideworks.content_type,
                  ${extra},
                  coalesce(timezone(${AGENCY_TIMEZONE},
                                    cast(cast(${diaPuro} as text) as date) + time '12:00'),
                           ${instante}),
                  ${body.title ?? null})
          returning id`;
        return linhas[0]?.id as string | undefined;
      });

      return criado
        ? json({ ok: true, id: criado }, 201)
        : json({ message: 'Não foi possível criar o item.' }, 400);
    }

    // --- compromisso (F17.44) ------------------------------------------------
    // A OUTRA coisa que cai num dia. Reuniao, gravacao, viagem: ocupa o dia e
    // NAO entrega nada — por isso mora em `appointments`, e nao em
    // `content_items`, que e o que a cota do mes conta. A separacao e a etapa
    // inteira; ver `src/server/appointments.ts`.
    if (rota === 'POST /appointments') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      try {
        const corpo = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const id = await createAppointment(sql, sessao.actor, corpo);
        return json({ ok: true, id }, 201);
      } catch (error) {
        if (error instanceof AppointmentRefused) {
          return json({ message: error.message }, error.status);
        }
        throw error;
      }
    }

    const compromisso = caminho.match(/^\/appointments\/([0-9a-f-]{36})$/i);
    if (compromisso && (request.method === 'PUT' || request.method === 'DELETE')) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      try {
        if (request.method === 'DELETE') {
          const apagou = await deleteAppointment(sql, sessao.actor, compromisso[1]);
          return apagou
            ? json({ ok: true })
            : json({ message: 'Compromisso não encontrado.' }, 404);
        }

        const corpo = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const mudou = await updateAppointment(sql, sessao.actor, compromisso[1], corpo);
        // A politica ja recusou o que esta fora da carteira; o `returning`
        // vazio nao distingue "nao existe" de "e de outra carteira", e a
        // resposta e a mesma nos dois casos — distinguir entregaria a agenda
        // alheia. E a mesma decisao da conclusao de item.
        return mudou ? json({ ok: true }) : json({ message: 'Compromisso não encontrado.' }, 404);
      } catch (error) {
        if (error instanceof AppointmentRefused) {
          return json({ message: error.message }, error.status);
        }
        throw error;
      }
    }

    // --- rodar a coleta agora (F8) -------------------------------------------
    // A coleta normal é por gatilho de tempo. Esta rota existe para duas
    // coisas: provar a configuração no dia em que o token entra, e recuperar
    // um dia perdido sem esperar 24 horas — e coleta perdida é dado perdido
    // para sempre.
    //
    // MESMO LOTE E MESMO RELÓGIO DO GATILHO. Sem eles, esta rota varria a
    // carteira inteira (~100 contas, de 23 a 52 segundos cada) dentro de UMA
    // requisição: ela não termina, o cliente desiste, a plataforma cancela o
    // pedido no meio de uma conta e o livro fica `running` por 15 minutos,
    // segurando a batida seguinte do cron. Cada chamada faz uma volta curta e
    // devolve `interrompida`; chamar de novo continua o rodízio.
    if (rota === 'POST /meta/collect') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      if (!sessao.actor.isSuperadmin) {
        return json({ message: 'Só administrador dispara a coleta.' }, 403);
      }
      if (!haTokenDaMeta(env as unknown as Record<string, unknown>)) {
        return json(
          {
            message:
              'Sem token da Meta. Defina IDEWORKS_META_TOKEN (ou IDEWORKS_META_TOKEN_<EMPRESA>) como segredo do Worker ' +
              '(em desenvolvimento, no .dev.vars).',
          },
          409,
        );
      }
      return json({
        ok: true,
        ...(await coletar(
          sql,
          credenciaisDoAmbiente(env as unknown as Record<string, unknown>),
          new Date(),
          CONTAS_POR_EXECUCAO,
          TETO_DE_TEMPO_MS,
        )),
      });
    }

    // --- saúde da coleta -----------------------------------------------------
    if (rota === 'GET /meta/health') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      // F44, Fase 6: o livro vem pela função, e não pela tabela. `first_error`
      // traz o texto cru da Meta (conta, token, permissão) e só quem administra
      // o vê — para os demais chega nulo. O papel da aplicação nem tem mais
      // `select` nessa coluna (migration `ideworks_f44_3_trancas`).
      const execucoes = await withActor(sql, asDbActor(sessao.actor), async (tx) => {
        return tx`
          select id, started_at, finished_at, outcome::text as outcome,
                 window_from, window_to, assets_total, assets_ok, assets_failed,
                 rows_written, first_error
            from ideworks.recent_collection_runs(20)
           order by started_at desc`;
      });

      return json({
        ok: true,
        // A tela precisa saber se dá para sequer tentar. Diz apenas SE existe
        // token, nunca qual — segredo não sai por rota.
        hasToken: haTokenDaMeta(env as unknown as Record<string, unknown>),
        runs: execucoes,
      });
    }

    // --- descobrir o que o token enxerga (F7b) ------------------------------
    // Existe porque pedir o identificador digitado não funciona: a URL do
    // perfil do Instagram não contém o id. Se o token já enxerga o
    // portfólio, quem lista as contas é o sistema.
    if (rota === 'GET /meta/discover') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      if (!sessao.actor.isSuperadmin) {
        return json({ message: 'Só administrador consulta as contas da Meta.' }, 403);
      }

      const escolha = await credencialDaEmpresa(
        sql,
        sessao.actor,
        env,
        url.searchParams.get('empresa'),
      );
      if ('recusa' in escolha) return json({ message: escolha.recusa }, escolha.status);
      if (!escolha.token) {
        return json({ ok: true, contas: [], avisos: [], identidade: null, semToken: true });
      }
      return json({
        ok: true,
        semToken: false,
        empresa: escolha.empresa,
        ...(await descobrirContas(escolha.token)),
      });
    }

    // --- as empresas e a credencial de cada uma (F7g) -----------------------
    // Só o NOME da variável sai daqui, e `configurada` diz se ela existe neste
    // ambiente — que é o que a tela precisa para avisar antes de tentar, em
    // vez de o erro aparecer só na coleta seguinte.
    if (rota === 'GET /meta/companies') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      if (!sessao.actor.isSuperadmin) {
        return json({ message: 'Só administrador vê as credenciais por empresa.' }, 403);
      }
      const empresas = await readEmpresasParaMeta(sql, sessao.actor);
      const ambiente = env as unknown as Record<string, unknown>;
      return json({
        ok: true,
        // Só o super admin escolhe empresa na descoberta — pedido explícito.
        podeEscolher: sessao.actor.isSuper,
        empresas: empresas.map((e) => ({
          ...e,
          configurada: Boolean(
            typeof ambiente[e.secretName ?? 'IDEWORKS_META_TOKEN'] === 'string' &&
              (ambiente[e.secretName ?? 'IDEWORKS_META_TOKEN'] as string).trim() !== '',
          ),
        })),
      });
    }

    // --- as contas da Meta, como entidade própria (F7d) ---------------------
    if (rota === 'GET /meta/accounts') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      return json({
        ok: true,
        hasToken: haTokenDaMeta(env as unknown as Record<string, unknown>),
        accounts: await readContas(sql, sessao.actor),
      });
    }

    // Importar copia o que a Meta respondeu. Não infere dono, não casa nome:
    // casar é decisão de gente, e acontece na ficha do cliente.
    if (rota === 'POST /meta/accounts/import') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      if (!sessao.actor.isSuperadmin) {
        return json({ message: 'Só administrador importa contas da Meta.' }, 403);
      }

      const corpo = (await request.json().catch(() => ({}))) as { empresaId?: unknown };
      const empresaId = typeof corpo.empresaId === 'string' ? corpo.empresaId : null;

      const escolha = await credencialDaEmpresa(sql, sessao.actor, env, empresaId);
      if ('recusa' in escolha) return json({ message: escolha.recusa }, escolha.status);
      if (!escolha.token) {
        return json({ message: 'Sem token da Meta no servidor.' }, 409);
      }

      const achado = await descobrirContas(escolha.token);
      const r = await importarContas(sql, sessao.actor, achado.contas, escolha.empresa?.id ?? null);
      return json({
        ok: true,
        ...r,
        empresa: escolha.empresa,
        avisos: achado.avisos,
        // De quem é o token — F19f. Sem isso, "meu cliente não veio" não tem
        // como ser respondido por quem olha a tela.
        identidade: achado.identidade,
      });
    }

    // A ponte com o Sistema IDE. Exige enxergar o cliente, não ser
    // administrador: quem cuida da carteira sabe de quem é a conta.
    const donoDaConta = caminho.match(/^\/meta-assets\/([0-9a-f-]{36})\/client$/i);
    if (request.method === 'POST' && donoDaConta) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      // `null` desvincula, mas DITO: `{}` ou um texto que não é id não desvincula
      // a conta em silêncio — ver `entradas-de-escrita.ts`.
      const pedido = lerDonoDaConta(await request.json().catch(() => null));
      if (!pedido.ok) return json({ message: pedido.message }, 400);

      await atribuirCliente(sql, sessao.actor, donoDaConta[1], pedido.valor);
      return json({ ok: true });
    }

    // --- os relatórios (F9) --------------------------------------------------
    // Duas rotas e não uma: campanha e perfil respondem perguntas diferentes,
    // vêm de tabelas diferentes e nem sequer têm as mesmas colunas. Uma rota
    // só com `?tipo=` economizaria uma linha aqui e devolveria um objeto de
    // forma variável para a tela desembrulhar.
    //
    // Nenhuma delas soma nada: o Worker entrega as linhas do intervalo e quem
    // calcula é o módulo puro, que tem teste.
    const relatorioPago = caminho.match(/^\/meta-assets\/([0-9a-f-]{36})\/report\/paid$/i);
    if (request.method === 'GET' && relatorioPago) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const de = url.searchParams.get('from');
      const ate = url.searchParams.get('to');
      if (!de || !ate) return json({ message: 'Informe o intervalo.' }, 400);

      return json({
        ok: true,
        ...(await readRelatorioPago(sql, sessao.actor, relatorioPago[1], de, ate)),
      });
    }

    const relatorioOrganico = caminho.match(
      /^\/meta-assets\/([0-9a-f-]{36})\/report\/organic$/i,
    );
    if (request.method === 'GET' && relatorioOrganico) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const de = url.searchParams.get('from');
      const ate = url.searchParams.get('to');
      if (!de || !ate) return json({ message: 'Informe o intervalo.' }, 400);

      return json({
        ok: true,
        ...(await readRelatorioOrganico(sql, sessao.actor, relatorioOrganico[1], de, ate)),
      });
    }

    // Cada publicação — F9f. Sem intervalo de propósito: a métrica de uma
    // publicação é acumulada desde que foi ao ar, e recortá-la pela janela
    // esconderia justamente a que ainda está rendendo.
    const publicacoes = caminho.match(/^\/meta-assets\/([0-9a-f-]{36})\/media$/i);
    if (request.method === 'GET' && publicacoes) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      return json({ ok: true, ...(await readPublicacoes(sql, sessao.actor, publicacoes[1])) });
    }

    // As campanhas de uma conta COM O OBJETIVO — F10g. Cada campanha mostra
    // a métrica que ELA persegue, e não uma coluna "resultados" que quer
    // dizer coisa diferente em cada linha.
    const campanhasDaConta = caminho.match(/^\/meta-assets\/([0-9a-f-]{36})\/campaigns$/i);
    if (request.method === 'GET' && campanhasDaConta) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      return json({
        ok: true,
        campanhas: await readCampanhasComObjetivo(
          sql, sessao.actor, campanhasDaConta[1],
          url.searchParams.get('from') ?? '', url.searchParams.get('to') ?? '',
        ),
      });
    }

    // Os anúncios de UMA campanha — F10i. Inclui os desligados: a pergunta
    // que abre esta lista é "qual criativo funcionou", e a resposta costuma
    // estar num anúncio que já foi pausado.
    const anunciosDaCampanha = caminho.match(
      /^\/meta-assets\/([0-9a-f-]{36})\/campaigns\/([^/]+)\/ads$/i,
    );
    if (request.method === 'GET' && anunciosDaCampanha) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      return json({
        ok: true,
        anuncios: await readAnunciosDaCampanha(
          sql,
          sessao.actor,
          anunciosDaCampanha[1],
          decodeURIComponent(anunciosDaCampanha[2]),
          url.searchParams.get('from') ?? '',
          url.searchParams.get('to') ?? '',
        ),
      });
    }

    // --- administração de pessoas (F12) ------------------------------------
    //
    // Nenhuma conferência de papel aqui: ela vive nas funções com dono do
    // banco, que recusam com 42501. Repetir a regra criaria uma segunda
    // verdade — e a errada seria a que ninguém olhou.
    if (rota === 'GET /admin/companies') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      return json({ ok: true, ...(await readTodasEmpresas(sql, sessao.actor)) });
    }

    // --- painel de controle dos admins, a semana — F40, Fase 5 --------------
    // Só admin/super_admin: a leitura recusa com 403 antes de consultar.
    // `?semana=AAAA-MM-DD` (qualquer dia → a segunda dele); sem parâmetro, a atual.
    if (rota === 'GET /admin/semana') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      return json({
        ok: true,
        ...(await readControleDaSemana(sql, sessao.actor, url.searchParams.get('semana'))),
      });
    }

    // F40, Fase 6 — o OK: grava pessoas e prazo e move o card para a fila do tipo,
    // numa transação. Corpo: { taskId, assigneeIds: string[], dueOn: 'AAAA-MM-DD' }.
    // Só admin (403 no módulo). Recusas legíveis, com `code` (ver `liberar-demanda.ts`).
    if (rota === 'POST /admin/semana/liberar') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      const body = (await request.json().catch(() => ({}))) as {
        taskId?: unknown;
        assigneeIds?: unknown;
        dueOn?: unknown;
      };
      if (typeof body.taskId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.taskId)) {
        return json({ message: 'Diga qual card liberar (taskId).' }, 400);
      }
      return json({
        ok: true,
        release: await liberarDemanda(sql, sessao.actor, {
          taskId: body.taskId,
          assigneeIds: Array.isArray(body.assigneeIds) ? (body.assigneeIds as string[]) : [],
          dueOn: typeof body.dueOn === 'string' ? body.dueOn : '',
        }),
      });
    }

    if (rota === 'GET /admin/queue') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      return json({ ok: true, ...(await readFila(sql, sessao.actor)) });
    }

    const convite = caminho.match(/^\/admin\/queue\/([0-9a-f-]{36})$/i);
    if (request.method === 'DELETE' && convite) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      await cancelarConvite(sql, sessao.actor, convite[1]);
      return json({ ok: true });
    }

    if (rota === 'GET /admin/clients') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      return json({ ok: true, ...(await readClientesParaCarteira(sql, sessao.actor)) });
    }

    if (rota === 'GET /admin/people') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      return json({ ok: true, ...(await readPessoas(sql, sessao.actor)) });
    }

    const cadastroDe = caminho.match(/^\/admin\/people\/([0-9a-f-]{36})\/profile$/i);
    if (request.method === 'PUT' && cadastroDe) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      await editarCadastro(sql, sessao.actor, provider, cadastroDe[1], await request.json().catch(() => null));
      return json({ ok: true });
    }

    const carteiraDe = caminho.match(/^\/admin\/people\/([0-9a-f-]{36})\/clients$/i);
    if (carteiraDe) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      if (request.method === 'GET') {
        return json({ ok: true, ...(await readCarteira(sql, sessao.actor, carteiraDe[1])) });
      }
      if (request.method === 'PUT') {
        // A carteira que falta no pedido NÃO é "esvazie": ver `entradas-de-escrita.ts`.
        const pedida = lerCarteiraPedida(await request.json().catch(() => null));
        if (!pedida.ok) return json({ message: pedida.message }, 400);
        return json({
          ok: true,
          ...(await setCarteira(sql, sessao.actor, carteiraDe[1], pedida.valor)),
        });
      }
    }

    const empresasDe = caminho.match(/^\/admin\/people\/([0-9a-f-]{36})\/companies$/i);
    if (empresasDe) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      if (request.method === 'GET') {
        return json({ ok: true, ...(await readEmpresas(sql, sessao.actor, empresasDe[1])) });
      }
      if (request.method === 'PUT') {
        const pedidas = lerEmpresasPedidas(await request.json().catch(() => null));
        if (!pedidas.ok) return json({ message: pedidas.message }, 400);
        return json({
          ok: true,
          ...(await setEmpresas(sql, sessao.actor, empresasDe[1], pedidas.valor)),
        });
      }
    }

    const apagarDe = caminho.match(/^\/admin\/people\/([0-9a-f-]{36})$/i);
    if (request.method === 'DELETE' && apagarDe) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      await apagarPessoa(sql, sessao.actor, apagarDe[1]);
      return json({ ok: true });
    }

    const areasDe = caminho.match(/^\/admin\/people\/([0-9a-f-]{36})\/areas$/i);
    if (request.method === 'PUT' && areasDe) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      const pedidas = lerAreasPedidas(await request.json().catch(() => null));
      if (!pedidas.ok) return json({ message: pedidas.message }, 400);
      await setAreas(sql, sessao.actor, areasDe[1], pedidas.valor);
      return json({ ok: true });
    }

    const papelDe = caminho.match(/^\/admin\/people\/([0-9a-f-]{36})\/role$/i);
    if (request.method === 'PUT' && papelDe) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      // Sem `papel` o pedido NÃO é "rebaixe a funcionário": ver `entradas-de-escrita.ts`.
      const pedido = lerPapelPedido(await request.json().catch(() => null));
      if (!pedido.ok) return json({ message: pedido.message }, 400);
      await setPapel(
        sql,
        sessao.actor,
        papelDe[1],
        pedido.valor.papel,
        pedido.valor.todosOsClientes,
      );
      return json({ ok: true });
    }

    /**
     * O código que deixa a pessoa escolher uma senha nova — F17.31.
     *
     * ⚠️ QUEM ADMINISTRA GERA O CÓDIGO; QUEM TEM A CONTA ESCOLHE A SENHA.
     *   Esta rota NÃO recebe senha, não devolve senha e não escreve senha —
     *   não há campo para isso em lugar nenhum do caminho. Ela devolve o
     *   código UMA vez, para ser entregue à mão, como o convite já faz.
     *
     *   A alternativa — administrador digita a senha e entrega — foi
     *   descartada: contradiz a frase impressa no próprio convite, "quem
     *   define a senha é o dono da conta — você nunca a saberá".
     *
     * Nenhuma conferência de papel aqui: `ideworks.issue_password_reset`
     * recusa quem não administra e recusa o pedido para si mesmo, e é ela que
     * grava o rastro na mesma transação.
     */
    const senhaDe = caminho.match(/^\/admin\/people\/([0-9a-f-]{36})\/password-reset$/i);
    if (request.method === 'POST' && senhaDe) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      return json({ ok: true, ...(await gerarRedefinicao(sql, sessao.actor, senhaDe[1])) });
    }

    const ativoDe = caminho.match(/^\/admin\/people\/([0-9a-f-]{36})\/active$/i);
    if (request.method === 'PUT' && ativoDe) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      // Sem `ativo` o pedido NÃO é "desative a pessoa": ver `entradas-de-escrita.ts`.
      const pedido = lerAtivoPedido(await request.json().catch(() => null));
      if (!pedido.ok) return json({ message: pedido.message }, 400);
      const ativo = pedido.valor;
      await setPessoaAtiva(sql, sessao.actor, ativoDe[1], ativo);
      // Corte ativo F20.4: desativar derruba as conexões ao vivo na hora.
      if (!ativo) {
        avisarDepoisDoCommit(
          ctx,
          () => derrubarPessoaNaCentral(env, ativoDe[1]),
          log,
        );
      }
      return json({ ok: true });
    }

    // O ranking de criativos — F10c. Atravessa contas: o recorte é o
    // GERENCIADOR, porque é a unidade que a agência usa para falar de um
    // cliente, e um gerenciador pode ter mais de uma conta de anúncio.
    if (rota.startsWith('GET /meta/ranking')) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      const de = url.searchParams.get('from') ?? '';
      const ate = url.searchParams.get('to') ?? '';
      const bm = url.searchParams.get('bm');
      const empresa = url.searchParams.get('empresa');
      return json({
        ok: true,
        ...(await readRanking(
          sql,
          sessao.actor,
          de,
          ate,
          bm === '' ? null : bm,
          empresa === '' ? null : empresa,
        )),
      });
    }

    // --- conexões da Meta (F7) ----------------------------------------------
    // Nenhuma destas rotas devolve token: não há token no banco. O System User
    // é um só para toda a carteira e vive como segredo do Worker.
    if (rota === 'GET /meta/connections') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      return json({ ok: true, clients: await readConexoes(sql, sessao.actor) });
    }

    const ativosDoCliente = caminho.match(/^\/clients\/([0-9a-f-]{36})\/meta-assets$/i);
    if (request.method === 'POST' && ativosDoCliente) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const id = await addAtivo(sql, sessao.actor, ativosDoCliente[1], body);
      return json({ ok: true, id }, 201);
    }

    const ativo = caminho.match(/^\/meta-assets\/([0-9a-f-]{36})$/i);
    if (ativo) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      if (request.method === 'PATCH') {
        const body = (await request.json().catch(() => ({}))) as { isActive?: unknown };
        if (typeof body.isActive !== 'boolean') {
          return json({ message: 'Informe se o ativo fica ligado.' }, 400);
        }
        await setAtivoLigado(sql, sessao.actor, ativo[1], body.isActive);
        return json({ ok: true });
      }
      if (request.method === 'DELETE') {
        await deleteAtivo(sql, sessao.actor, ativo[1]);
        return json({ ok: true });
      }
    }

    // --- catálogos: planos, categorias e etiquetas (F2.4) -------------------
    // A leitura é para qualquer pessoa identificada — os selos e filtros
    // dependem dela. A escrita é recusada pelo banco para quem não é
    // administrador, e a frase da recusa vem de lá.
    if (rota === 'GET /catalogs/manage') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      return json({ ok: true, ...(await readCatalogos(sql, sessao.actor)) });
    }

    const catalogo = caminho.match(
      /^\/(plans|categories|tags)(?:\/([0-9a-f-]{36}))?(?:\/(default|merge))?$/i,
    );
    if (catalogo && request.method !== 'GET') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const [, tipo, id, acao] = catalogo;
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

      if (acao === 'default' && id) {
        await setCategoriaPadrao(sql, sessao.actor, id);
        return json({ ok: true });
      }
      if (acao === 'merge' && id) {
        const para = typeof body.into === 'string' ? body.into : '';
        if (!/^[0-9a-f-]{36}$/i.test(para)) {
          return json({ message: 'Informe a etiqueta de destino.' }, 400);
        }
        return json({ ok: true, moved: await mergeEtiquetas(sql, sessao.actor, id, para) });
      }

      if (request.method === 'DELETE' && id) {
        if (tipo === 'plans') await deletePlano(sql, sessao.actor, id);
        else if (tipo === 'tags') await deleteEtiqueta(sql, sessao.actor, id);
        else {
          return json({
            ok: true,
            reallocated: await deleteCategoria(sql, sessao.actor, id),
          });
        }
        return json({ ok: true });
      }

      if (request.method === 'POST' || request.method === 'PUT') {
        const alvo = request.method === 'PUT' ? (id ?? null) : null;
        const salvo =
          tipo === 'plans'
            ? await savePlano(sql, sessao.actor, alvo, body)
            : tipo === 'categories'
              ? await saveCategoria(sql, sessao.actor, alvo, body)
              : await saveEtiqueta(sql, sessao.actor, alvo, body);
        return json({ ok: true, id: salvo }, request.method === 'POST' ? 201 : 200);
      }
    }

    // Etiquetar cliente é trabalho do dia a dia, e por isso não exige
    // administrador — a função do banco confere só se a pessoa enxerga.
    const etiquetasDoCliente = caminho.match(/^\/clients\/([0-9a-f-]{36})\/tags$/i);
    if (request.method === 'POST' && etiquetasDoCliente) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      // `tagIds` ausente NÃO é "tire todas": ver `entradas-de-escrita.ts`.
      const pedidas = lerEtiquetasPedidas(await request.json().catch(() => null));
      if (!pedidas.ok) return json({ message: pedidas.message }, 400);
      await setEtiquetasDoCliente(sql, sessao.actor, etiquetasDoCliente[1], pedidas.valor);
      return json({ ok: true });
    }

    // --- planejamento do mês, todos os clientes -----------------------------
    if (rota === 'GET /planning') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const mes = url.searchParams.get('month') ?? diaDeSaoPaulo(new Date());
      try {
        return json({
          ok: true,
          month: firstDayOfMonth(mes),
          clients: await readPlanning(sql, sessao.actor, mes),
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes('inválido')) {
          return json({ message: error.message }, 400);
        }
        throw error;
      }
    }

    // --- planejamento por semana, todos os clientes — F35 -------------------
    //
    // Comparação EXATA de rota, como a de cima: `GET /planning` não engole
    // `/planning/weeks`, e vice-versa. Sob `/api/*`, já coberto por
    // `run_worker_first` no wrangler.toml — nada a acrescentar lá.
    if (rota === 'GET /planning/weeks') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const mes = url.searchParams.get('month') ?? diaDeSaoPaulo(new Date());
      try {
        return json({
          ok: true,
          month: firstDayOfMonth(mes),
          clients: await readPlanningWeeks(sql, sessao.actor, mes),
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes('inválido')) {
          return json({ message: error.message }, 400);
        }
        throw error;
      }
    }

    // --- mural e captação ---------------------------------------------------
    const muralDoCliente = caminho.match(/^\/clients\/([0-9a-f-]{36})\/mural$/i);
    if (muralDoCliente) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      if (request.method === 'GET') {
        return json({ ok: true, notes: await readMural(sql, sessao.actor, muralDoCliente[1]) });
      }
      if (request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const id = await createNota(sql, sessao.actor, muralDoCliente[1], body);
        return json({ ok: true, id }, 201);
      }
    }

    const nota = caminho.match(/^\/mural\/([0-9a-f-]{36})$/i);
    if (nota) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      if (request.method === 'PATCH' || request.method === 'PUT') {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        await updateNota(sql, sessao.actor, nota[1], body);
        return json({ ok: true });
      }
      if (request.method === 'DELETE') {
        await deleteNota(sql, sessao.actor, nota[1]);
        return json({ ok: true });
      }
    }

    const captacoesDoCliente = caminho.match(/^\/clients\/([0-9a-f-]{36})\/captures$/i);
    if (captacoesDoCliente) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      if (request.method === 'GET') {
        return json({
          ok: true,
          captures: await readCaptacoes(sql, sessao.actor, captacoesDoCliente[1]),
        });
      }
      if (request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const id = await createCaptacao(sql, sessao.actor, captacoesDoCliente[1], body);
        return json({ ok: true, id }, 201);
      }
    }

    const captacao = caminho.match(/^\/captures\/([0-9a-f-]{36})$/i);
    if (captacao) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      if (request.method === 'PUT') {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        await updateCaptacao(sql, sessao.actor, captacao[1], body);
        return json({ ok: true });
      }
      if (request.method === 'DELETE') {
        await deleteCaptacao(sql, sessao.actor, captacao[1]);
        return json({ ok: true });
      }
    }

    // --- histórico do cliente -----------------------------------------------
    const historicoDoCliente = caminho.match(/^\/clients\/([0-9a-f-]{36})\/history$/i);
    if (historicoDoCliente) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      if (request.method === 'GET') {
        return json({
          ok: true,
          events: await readHistory(sql, sessao.actor, historicoDoCliente[1]),
        });
      }
      if (request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as Partial<EntradaDeEvento>;
        const id = await createEvent(sql, sessao.actor, historicoDoCliente[1], {
          happenedOn: body.happenedOn ?? '',
          title: body.title ?? '',
          subtitle: body.subtitle ?? null,
          body: body.body ?? '',
          ledBy: body.ledBy ?? null,
          ledByNote: body.ledByNote ?? null,
        });
        return json({ ok: true, id }, 201);
      }
    }

    // O documento do histórico só abre por endereço ASSINADO, e de vida curta
    // — F17.52. O balde `client-history-documents` era público até
    // 2026-09-01: contrato e transcrição de reunião de cliente liam-se sem
    // login. Agora o caminho é este, e ele passa pelo banco antes do Storage.
    const enderecoDoDocumento = caminho.match(
      /^\/history\/documents\/([0-9a-f-]{36})\/url$/i,
    );
    if (request.method === 'GET' && enderecoDoDocumento) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      return json({
        ok: true,
        ...(await signHistoryDocument(
          sql,
          sessao.actor,
          armazenamento,
          enderecoDoDocumento[1],
        )),
      });
    }

    const evento = caminho.match(/^\/history\/([0-9a-f-]{36})$/i);
    if (evento) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      if (request.method === 'PUT') {
        const body = (await request.json().catch(() => ({}))) as Partial<EntradaDeEvento>;
        await updateEvent(sql, sessao.actor, evento[1], {
          happenedOn: body.happenedOn ?? '',
          title: body.title ?? '',
          subtitle: body.subtitle ?? null,
          body: body.body ?? '',
          ledBy: body.ledBy ?? null,
          ledByNote: body.ledByNote ?? null,
        });
        return json({ ok: true });
      }
      if (request.method === 'DELETE') {
        await deleteEvent(sql, sessao.actor, evento[1]);
        return json({ ok: true });
      }
    }

    // --- demandas (tabela `tasks`, regra 10 do roteiro) ---------------------
    if (rota === 'GET /team') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      // `me` entrou na F17.10b: o seletor de responsável do ClickUp põe `Eu`
      // no topo, e sem o próprio identificador a tela não sabe qual dos oito
      // nomes é o de quem está olhando. É o id de quem pediu — nada de
      // terceiro sai daqui que já não saísse.
      return json({ ok: true, team: await readTeam(sql, sessao.actor), me: sessao.actor.userId });
    }

    // --- chat da equipe (F20.3) + central ao vivo (F20.4 / D22) --------------
    //
    // Toda rota é `livre` (D26). A chave IDEWORKS_CHAT é o freio: desligado
    // recusa; piloto só super admin; ligado qualquer autenticado. Token de
    // integração já foi barrado na borda.
    //
    // Aviso à central: SEMPRE depois do commit, via waitUntil — falha no aviso
    // não falha o envio. Chave desligada fecha as conexões abertas.
    //
    // Desvio: `POST .../ownership` (passar a posse) não estava na lista da
    // F20.3; a tela da F20.6 precisa. Exposta como `livre` também.
    const modoDoChat = () => chatModeFromEnv(env.IDEWORKS_CHAT);
    const exigirChat = (sessao: { actor: { isSuper: boolean } }) => {
      const modo = modoDoChat();
      if (modo === 'desligado') {
        avisarDepoisDoCommit(ctx, () => fecharTodasNaCentral(env), log);
      }
      assertChatAllowed(modo, sessao.actor.isSuper);
    };

    // Conexão ao vivo — WebSocket. Conferência completa + origem, depois
    // entrega à central carimbada com a pessoa e o momento.
    if (rota === 'GET /chat/live') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Esperado WebSocket.', { status: 426 });
      }
      if (!origemDaPaginaConfere(request)) {
        return json({ message: 'Origem da página não confere.' }, 403);
      }
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      exigirChat(sessao);
      return entregarConexaoACentral(env, request, sessao.actor.userId, Date.now());
    }

    if (rota === 'GET /chat/conversations') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      exigirChat(sessao);
      return json({ ok: true, conversations: await listMyChatConversations(sql, sessao.actor) });
    }

    if (rota === 'POST /chat/conversations/groups') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      exigirChat(sessao);
      const body = (await request.json().catch(() => ({}))) as {
        name?: unknown;
        memberIds?: unknown;
      };
      const id = await createGroupConversation(sql, sessao.actor, body.name, body.memberIds);
      const nome = typeof body.name === 'string' ? body.name.trim() : null;
      const membros = Array.isArray(body.memberIds)
        ? body.memberIds.filter((m): m is string => typeof m === 'string')
        : [];
      const destinatarios = Array.from(new Set([sessao.actor.userId, ...membros]));
      avisarDepoisDoCommit(
        ctx,
        () =>
          avisarCentral(env, destinatarios, {
            type: 'conversation_created',
            conversationId: id,
            kind: 'group',
            name: nome,
          }),
        log,
      );
      return json({ ok: true, id }, 201);
    }

    if (rota === 'POST /chat/conversations/direct') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      exigirChat(sessao);
      const body = (await request.json().catch(() => ({}))) as { userId?: unknown };
      const id = await openDirectConversation(sql, sessao.actor, body.userId);
      const outro = typeof body.userId === 'string' ? body.userId : '';
      const destinatarios = [sessao.actor.userId, outro].filter(Boolean);
      avisarDepoisDoCommit(
        ctx,
        () =>
          avisarCentral(env, destinatarios, {
            type: 'conversation_created',
            conversationId: id,
            kind: 'direct',
            name: null,
          }),
        log,
      );
      return json({ ok: true, id }, 201);
    }

    if (rota === 'GET /chat/directory') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      exigirChat(sessao);
      return json({ ok: true, people: await chatDirectory(sql, sessao.actor) });
    }

    // Candidatos à menção @ nesta conversa — F20.8.
    const chatMentionable = caminho.match(
      /^\/chat\/conversations\/([0-9a-f-]{36})\/mentionable$/i,
    );
    if (chatMentionable && request.method === 'GET') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      exigirChat(sessao);
      return json({
        ok: true,
        people: await listChatMentionable(sql, sessao.actor, chatMentionable[1]),
      });
    }

    const chatMsgs = caminho.match(
      /^\/chat\/conversations\/([0-9a-f-]{36})\/messages$/i,
    );
    if (chatMsgs && request.method === 'GET') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      exigirChat(sessao);
      const beforeAt = url.searchParams.get('beforeAt');
      const beforeId = url.searchParams.get('beforeId');
      const cursor =
        beforeAt && beforeId ? { beforeAt, beforeId } : null;
      // A bolha já nasce com o rodapé certo: as reações vivas do mesmo lote.
      // Mensagens e reações na MESMA transação (eram duas, uma atrás da outra).
      const { messages, reactions } = await listChatMessagesWithReactions(
        sql,
        sessao.actor,
        chatMsgs[1],
        cursor,
      );
      return json({ ok: true, messages, reactions });
    }

    if (chatMsgs && request.method === 'POST') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      exigirChat(sessao);
      const body = (await request.json().catch(() => ({}))) as {
        body?: unknown;
        clientKey?: unknown;
        imageIds?: unknown;
      };
      const message = await sendChatMessage(
        sql,
        sessao.actor,
        chatMsgs[1],
        body.body,
        body.clientKey,
        body.imageIds,
      );
      await prepararAvisoDepoisDoCommit(
        ctx,
        async () => {
          const mencionados = await chatMentionRecipientIds(sql, sessao.actor, message.id).catch((err) => {
            log('destinatários de menção indisponíveis (mensagem já gravada)', err);
            return [] as string[];
          });
          return async () => {
            await concluirAvisos([
              avisarCentral(env, message.recipientIds, {
                type: 'message_new',
                message: mensagemParaEvento(message),
              }),
              avisarCentral(env, mencionados, {
                type: 'chat_mention',
                conversationId: message.conversationId,
                messageId: message.id,
              }),
            ]);
          };
        },
        log,
      );
      return json({ ok: true, message }, 201);
    }

    // Imagens do chat — F20.7. Rascunho em multipart; assinatura sob demanda.
    const chatImagens = caminho.match(
      /^\/chat\/conversations\/([0-9a-f-]{36})\/images$/i,
    );
    if (chatImagens && request.method === 'POST') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      exigirChat(sessao);
      // O teto vale ANTES de o corpo entrar na memória — ver `corpo-com-teto.ts`.
      const lido = await lerFormularioComTeto(request, TETO_DE_BYTES);
      if (lido.grande) return json({ message: FRASE_ENVIO_GRANDE }, 413);
      const forma = lido.forma;
      const arquivo = forma?.get('arquivo');
      if (!(arquivo instanceof File)) {
        return json({ message: 'Nenhum arquivo veio no envio.' }, 400);
      }
      if (arquivo.size > TETO_DE_BYTES) {
        return json(
          {
            message:
              `O arquivo tem ${tamanhoLegivel(arquivo.size)} e o teto do envio é ` +
              `${tamanhoLegivel(TETO_DE_BYTES)}. Para algo maior, ponha o link do Dropbox ao lado.`,
          },
          413,
        );
      }
      const r = await uploadChatImageDraft(sql, sessao.actor, armazenamento, chatImagens[1], {
        fileName: arquivo.name,
        contentType: arquivo.type,
        bytes: await arquivo.arrayBuffer(),
      });
      return json({ ok: true, id: r.id }, 201);
    }

    const chatImagemUrl = caminho.match(/^\/chat\/images\/([0-9a-f-]{36})\/url$/i);
    if (chatImagemUrl && request.method === 'GET') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      exigirChat(sessao);
      return json({
        ok: true,
        ...(await signChatImage(sql, sessao.actor, armazenamento, chatImagemUrl[1])),
      });
    }

    if (request.method === 'POST' && caminho === '/chat/images/urls') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      exigirChat(sessao);
      const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
      const ids = Array.isArray(body.ids)
        ? body.ids.filter((x): x is string => typeof x === 'string')
        : [];
      return json({
        ok: true,
        urls: await signChatImages(sql, sessao.actor, armazenamento, ids),
      });
    }

    const chatChanges = caminho.match(
      /^\/chat\/conversations\/([0-9a-f-]{36})\/changes$/i,
    );
    if (chatChanges && request.method === 'GET') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      exigirChat(sessao);
      const since = url.searchParams.get('since') ?? '';
      return json({
        ok: true,
        messages: await listChatMessageChanges(sql, sessao.actor, chatChanges[1], since),
      });
    }

    // Reações do chat — F24.2. Alternar numa mensagem; ler o que mudou desde
    // um instante (reposição offline, inclui a removida).
    const chatReactionsChanges = caminho.match(
      /^\/chat\/conversations\/([0-9a-f-]{36})\/reactions\/changes$/i,
    );
    if (chatReactionsChanges && request.method === 'GET') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      exigirChat(sessao);
      const since = url.searchParams.get('since') ?? '';
      return json({
        ok: true,
        reactions: await listChatReactionChanges(
          sql,
          sessao.actor,
          chatReactionsChanges[1],
          since,
        ),
      });
    }

    const chatReaction = caminho.match(
      /^\/chat\/messages\/([0-9a-f-]{36})\/reactions$/i,
    );
    if (chatReaction && request.method === 'POST') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      exigirChat(sessao);
      const body = (await request.json().catch(() => ({}))) as { emoji?: unknown };
      const reaction = await toggleChatReaction(
        sql,
        sessao.actor,
        chatReaction[1],
        body.emoji,
      );
      // Destinatários vêm da própria transação, como em `message_new`.
      avisarDepoisDoCommit(
        ctx,
        () =>
          avisarCentral(env, reaction.recipientIds, {
            type: 'chat_reaction',
            conversationId: reaction.conversationId,
            messageId: reaction.messageId,
            actorId: reaction.actorId,
            emoji: reaction.emoji,
            removed: reaction.removed,
            reactedAt: reaction.reactedAt,
          }),
        log,
      );
      return json({ ok: true, reaction });
    }

    const chatMembers = caminho.match(
      /^\/chat\/conversations\/([0-9a-f-]{36})\/members(?:\/([0-9a-f-]{36}))?$/i,
    );
    if (chatMembers && request.method === 'POST' && !chatMembers[2]) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      exigirChat(sessao);
      const body = (await request.json().catch(() => ({}))) as { userId?: unknown };
      await addConversationMember(sql, sessao.actor, chatMembers[1], body.userId);
      await prepararAvisoDepoisDoCommit(
        ctx,
        async () => {
          const destinatarios = await chatRecipientIds(sql, sessao.actor, chatMembers[1]);
          return async () => {
            await avisarCentral(env, destinatarios, {
              type: 'conversation_changed',
              conversationId: chatMembers[1],
            });
          };
        },
        log,
      );
      return json({ ok: true });
    }

    if (chatMembers && request.method === 'DELETE' && chatMembers[2]) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      exigirChat(sessao);
      const removido = chatMembers[2];
      await removeConversationMember(sql, sessao.actor, chatMembers[1], removido);
      await prepararAvisoDepoisDoCommit(
        ctx,
        async () => {
          const restantes = await chatRecipientIds(sql, sessao.actor, chatMembers[1]);
          return async () => {
            await concluirAvisos([
              avisarCentral(env, restantes, {
                type: 'conversation_changed',
                conversationId: chatMembers[1],
              }),
              avisarCentral(env, [removido], {
                type: 'conversation_left',
                conversationId: chatMembers[1],
              }),
            ]);
          };
        },
        log,
      );
      return json({ ok: true });
    }

    const chatLeave = caminho.match(/^\/chat\/conversations\/([0-9a-f-]{36})\/leave$/i);
    if (chatLeave && request.method === 'POST') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      exigirChat(sessao);
      // Destinatários ANTES de sair — depois o ator pode perder o alcance.
      const antes = await chatRecipientIds(sql, sessao.actor, chatLeave[1]);
      await leaveConversation(sql, sessao.actor, chatLeave[1]);
      const restantes = antes.filter((id) => id !== sessao.actor.userId);
      avisarDepoisDoCommit(
        ctx,
        async () => {
          await concluirAvisos([
            avisarCentral(env, restantes, {
              type: 'conversation_changed',
              conversationId: chatLeave[1],
            }),
            avisarCentral(env, [sessao.actor.userId], {
              type: 'conversation_left',
              conversationId: chatLeave[1],
            }),
          ]);
        },
        log,
      );
      return json({ ok: true });
    }

    const chatOwnership = caminho.match(
      /^\/chat\/conversations\/([0-9a-f-]{36})\/ownership$/i,
    );
    if (chatOwnership && request.method === 'POST') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      exigirChat(sessao);
      const body = (await request.json().catch(() => ({}))) as { userId?: unknown };
      await transferConversationOwnership(sql, sessao.actor, chatOwnership[1], body.userId);
      await prepararAvisoDepoisDoCommit(
        ctx,
        async () => {
          const destinatarios = await chatRecipientIds(sql, sessao.actor, chatOwnership[1]);
          return async () => {
            await avisarCentral(env, destinatarios, {
              type: 'conversation_changed',
              conversationId: chatOwnership[1],
            });
          };
        },
        log,
      );
      return json({ ok: true });
    }

    const chatRead = caminho.match(/^\/chat\/conversations\/([0-9a-f-]{36})\/read$/i);
    if (chatRead && request.method === 'POST') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      exigirChat(sessao);
      const body = (await request.json().catch(() => ({}))) as { readAt?: unknown };
      const lastReadAt = await markConversationRead(
        sql,
        sessao.actor,
        chatRead[1],
        body.readAt,
      );
      // Leitura: avisa todos os membros da conversa (para atualizar checks azuis em tempo real
      // no remetente e zerar contadores nas outras abas do leitor).
      await prepararAvisoDepoisDoCommit(
        ctx,
        async () => {
          const destinatarios = await chatRecipientIds(sql, sessao.actor, chatRead[1]);
          return async () => {
            await avisarCentral(env, destinatarios, {
              type: 'conversation_read',
              conversationId: chatRead[1],
              readAt: lastReadAt,
              personId: sessao.actor.userId,
            });
          };
        },
        log,
      );
      return json({ ok: true, lastReadAt });
    }

    const chatConv = caminho.match(/^\/chat\/conversations\/([0-9a-f-]{36})$/i);
    if (chatConv && request.method === 'PATCH') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      exigirChat(sessao);
      const body = (await request.json().catch(() => ({}))) as { name?: unknown };
      await renameConversation(sql, sessao.actor, chatConv[1], body.name);
      await prepararAvisoDepoisDoCommit(
        ctx,
        async () => {
          const destinatarios = await chatRecipientIds(sql, sessao.actor, chatConv[1]);
          return async () => {
            await avisarCentral(env, destinatarios, {
              type: 'conversation_changed',
              conversationId: chatConv[1],
            });
          };
        },
        log,
      );
      return json({ ok: true });
    }

    const chatMsg = caminho.match(/^\/chat\/messages\/([0-9a-f-]{36})$/i);
    if (chatMsg && request.method === 'PATCH') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      exigirChat(sessao);
      const body = (await request.json().catch(() => ({}))) as { body?: unknown };
      const mencionadosAntes = await chatMentionRecipientIds(
        sql,
        sessao.actor,
        chatMsg[1],
      );
      const message = await editChatMessage(sql, sessao.actor, chatMsg[1], body.body);
      await prepararAvisoDepoisDoCommit(
        ctx,
        async () => {
          const destinatarios = await chatRecipientIds(sql, sessao.actor, message.conversationId);
          const mencionadosDepois = await chatMentionRecipientIds(sql, sessao.actor, message.id).catch((err) => {
            log('destinatários de menção indisponíveis (edição já gravada)', err);
            return [] as string[];
          });
          const sino = [...new Set([...mencionadosAntes, ...mencionadosDepois])]
            .filter((id) => destinatarios.includes(id));
          return async () => {
            await concluirAvisos([
              avisarCentral(env, destinatarios, {
                type: 'message_edited',
                message: mensagemParaEvento(message),
              }),
              avisarCentral(env, sino, {
                type: 'chat_mention',
                conversationId: message.conversationId,
                messageId: message.id,
              }),
            ]);
          };
        },
        log,
      );
      return json({ ok: true, message });
    }

    if (chatMsg && request.method === 'DELETE') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      exigirChat(sessao);
      const mencionadosAntes = await chatMentionRecipientIds(
        sql,
        sessao.actor,
        chatMsg[1],
      );
      const message = await deleteChatMessageWithImages(
        sql,
        sessao.actor,
        armazenamento,
        chatMsg[1],
        deleteChatMessage,
      );
      await prepararAvisoDepoisDoCommit(
        ctx,
        async () => {
          const destinatarios = await chatRecipientIds(sql, sessao.actor, message.conversationId);
          const sino = mencionadosAntes.filter((id) => destinatarios.includes(id));
          return async () => {
            await concluirAvisos([
              avisarCentral(env, destinatarios, {
                type: 'message_deleted',
                message: mensagemParaEvento(message),
              }),
              avisarCentral(env, sino, {
                type: 'chat_mention',
                conversationId: message.conversationId,
                messageId: message.id,
              }),
            ]);
          };
        },
        log,
      );
      return json({ ok: true, message });
    }

    const tarefasDoCliente = caminho.match(/^\/clients\/([0-9a-f-]{36})\/tasks$/i);
    if (tarefasDoCliente) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      if (request.method === 'GET') {
        const comArquivadas = url.searchParams.get('archived') === '1';
        return json({
          ok: true,
          tasks: await readTasks(sql, sessao.actor, tarefasDoCliente[1], comArquivadas),
        });
      }

      if (request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as Partial<EntradaDeTarefa>;
        const id = await createTask(sql, sessao.actor, tarefasDoCliente[1], {
          title: body.title ?? '',
          description: body.description ?? null,
          dueOn: body.dueOn ?? null,
          assigneeIds: body.assigneeIds ?? [],
        });
        return json({ ok: true, id }, 201);
      }
    }

    const tarefa = caminho.match(/^\/tasks\/([0-9a-f-]{36})$/i);
    if (tarefa) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      if (request.method === 'PUT') {
        const body = (await request.json().catch(() => ({}))) as Partial<EntradaDeTarefa>;
        await updateTask(sql, sessao.actor, tarefa[1], {
          title: body.title ?? '',
          description: body.description ?? null,
          dueOn: body.dueOn ?? null,
          assigneeIds: body.assigneeIds ?? [],
        });
        return json({ ok: true });
      }

      if (request.method === 'DELETE') {
        await deleteTask(sql, sessao.actor, tarefa[1]);
        return json({ ok: true });
      }
    }

    const conclusaoDaTarefa = caminho.match(/^\/tasks\/([0-9a-f-]{36})\/completion$/i);
    if (conclusaoDaTarefa && (request.method === 'POST' || request.method === 'DELETE')) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      await setTaskCompleted(sql, sessao.actor, conclusaoDaTarefa[1], request.method === 'POST');
      return json({ ok: true });
    }

    const arquivoDaTarefa = caminho.match(/^\/tasks\/([0-9a-f-]{36})\/archive$/i);
    if (arquivoDaTarefa && (request.method === 'POST' || request.method === 'DELETE')) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      await setTaskArchived(sql, sessao.actor, arquivoDaTarefa[1], request.method === 'POST');
      return json({ ok: true });
    }

    // --- o quadro do Pilar B (F17.9a) ---------------------------------------
    // Três rotas, e nenhuma delas repete regra de alcance: a política de linha
    // e as views `security_invoker` fazem o recorte. Ver `server/board.ts`.
    if (rota === 'GET /board/tree') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      return json({ ok: true, spaces: await readTree(sql, sessao.actor) });
    }

    const quadroDaLista = caminho.match(/^\/board\/lists\/([0-9a-f-]{36})$/i);
    if (request.method === 'GET' && quadroDaLista) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      /* `per-column`: quantos cartões por coluna — F17.50. Ausente ou torto
         cai no padrão, e `readBoard` prende o número entre 1 e o máximo dele.
         Quem aperta `Mostrar mais` manda o número maior. */
      const pedido = Number(url.searchParams.get('per-column'));
      /* `busca` e `responsavel` — F17.55. `lerFiltro` é tolerante de
         propósito: os dois vêm da barra de endereço, e `?responsavel=eu` vira
         "qualquer um" em vez de estourar. O recorte de acesso NÃO passa por
         aqui — ele é a política de linha, dentro da consulta. */
      return json({
        ok: true,
        board: await readBoard(
          sql,
          sessao.actor,
          quadroDaLista[1],
          Number.isFinite(pedido) && pedido > 0 ? pedido : undefined,
          lerFiltro(url.searchParams.get('busca'), url.searchParams.get('responsavel')),
        ),
      });
    }

    /* O QUADRO DA PASTA — F17.64. Todos os clientes da pasta numa grade só.
       Mesma forma da rota da lista, e de propósito: `per-column`, `busca` e
       `responsavel` significam ali o que significam aqui. O recorte continua
       sendo a política de linha — ver `server/board-pasta.ts`.

       ⚠️ NÃO HÁ ROTA DE ESCRITA NOVA. Arrastar no quadro da pasta usa
       `POST /board/tasks/:id/move`, logo abaixo, com a lista DA PRÓPRIA
       tarefa: o que muda é a etapa, não o dono do cartão (regra 9). */
    const quadroDaPasta = caminho.match(/^\/board\/folders\/([0-9a-f-]{36})$/i);
    if (request.method === 'GET' && quadroDaPasta) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      const pedido = Number(url.searchParams.get('per-column'));
      return json({
        ok: true,
        board: await readFolderBoard(
          sql,
          sessao.actor,
          quadroDaPasta[1],
          Number.isFinite(pedido) && pedido > 0 ? pedido : undefined,
          lerFiltro(url.searchParams.get('busca'), url.searchParams.get('responsavel')),
        ),
      });
    }

    // Arrastar o cartão. Não há `update tasks set status_id` aqui nem em
    // `server/board.ts`: quem escreve é `ideworks.move_task`, que troca lista
    // e status em bloco e devolve o que fez.
    const movimentoNoQuadro = caminho.match(/^\/board\/tasks\/([0-9a-f-]{36})\/move$/i);
    if (request.method === 'POST' && movimentoNoQuadro) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const body = (await request.json().catch(() => ({}))) as {
        listId?: string;
        statusId?: string | null;
        origem?: { listId: string | null; statusId: string | null };
      };
      if (!body.listId) {
        // A mesma recusa que `move_task` daria, dita antes de gastar a ida ao
        // banco — e com a mesma saída: arquivar é o caminho para tirar a
        // tarefa do quadro sem apagá-la.
        return json(
          { message: 'Mover exige a lista de destino. Para tirar a tarefa do quadro, arquive-a.' },
          400,
        );
      }

      if (body.origem !== undefined &&
          (!body.origem || typeof body.origem !== 'object' ||
           !(body.origem.listId === null || typeof body.origem.listId === 'string') ||
           !(body.origem.statusId === null || typeof body.origem.statusId === 'string'))) {
        return json({ message: 'Confirme novamente a tarefa antes de mover.' }, 400);
      }

      return json({
        ok: true,
        move: await moveTaskOnBoard(
          sql,
          sessao.actor,
          movimentoNoQuadro[1],
          body.listId,
          body.statusId ?? null,
          body.origem,
        ),
      });
    }

    // --- `Meu trabalho` e `Todas as tarefas` (F17.18) -----------------------
    // Duas leituras, zero escrita, e nenhuma regra de alcance repetida: a
    // política de linha de `tasks` recorta as duas. A diferença entre elas é
    // uma cláusula `where` — ver `server/board-trabalho.ts`.
    if (rota === 'GET /board/my-tasks') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      /* A PÁGINA DE UMA ABA — F17.AUD05. `?aba=pendente|feito|delegado`, com
         `cursor` e `limite` opcionais, filtra a aba ANTES do teto e devolve
         lotes de 100 com as contagens das três abas. Sem `aba`, a resposta é
         a de sempre — o consumidor antigo não muda até a AUD06.

         `aba` desconhecida, `cursor` que não confere e `cursor` sem `aba`
         viram 400 AQUI, antes de tocar no banco. `limite` torto cai no
         padrão, como `per-column` do quadro.

         ⚠️ NENHUM DESSES PARÂMETROS DIZ QUEM LÊ. `sessao.actor` é a única
         fonte de `userId`, e a política de linha continua valendo dentro de
         `withActor`. O cursor decide DE ONDE continuar; o alcance é o de
         sempre. */
      const pedido = lerPedidoDePagina({
        aba: url.searchParams.get('aba'),
        cursor: url.searchParams.get('cursor'),
        limite: url.searchParams.get('limite'),
      });
      if (!pedido.ok) return json({ message: pedido.message }, pedido.status);
      if (pedido.pedido === null) {
        return json({ ok: true, work: await readMyWork(sql, sessao.actor) });
      }
      return json({ ok: true, work: await readMyWorkPage(sql, sessao.actor, pedido.pedido) });
    }

    if (rota === 'GET /board/all-tasks') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      /* `busca` e `responsavel` — F17.55. É o que devolve a saída da tela: o
         teto de 500 por prazo crescente deixava as 116 tarefas ABERTAS todas
         fora do corte (achado 1 da revisão de 2026-09-02). Filtrando, o que
         se procura cabe. */
      return json({
        ok: true,
        work: await readAllWork(
          sql,
          sessao.actor,
          lerFiltro(url.searchParams.get('busca'), url.searchParams.get('responsavel')),
        ),
      });
    }

    /* TAREFAS DE UM ESCOPO — F18A (R09: Lista|Kanban em todas as visões).
       `?escopo=espaco|pasta|lista&id=` + filtros + `cursor`/`limite`. Escopo,
       id e cursor tortos são 400 AQUI, antes do banco. O alcance é a política
       de linha, dentro de `withActor` — ver `server/tarefas-do-escopo.ts`. */
    if (rota === 'GET /board/scope-tasks') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      const pedido = lerPedidoDoEscopo(url.searchParams);
      if (!pedido.ok) return json({ message: pedido.message }, pedido.status);
      return json({ ok: true, tasks: await readScopeTasks(sql, sessao.actor, pedido.pedido) });
    }

    // Menções e notificações: destinatários e avisos respeitam o acesso no banco.
    if (rota === 'GET /board/mentionable') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      return json({ ok: true, people: await readMentionablePeople(sql, sessao.actor,
        url.searchParams.get('task'), url.searchParams.get('list')) });
    }

    if (rota === 'GET /board/notices') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      // `vistos=1` traz também o que já foi marcado. Sem o parâmetro, o que já
      // foi visto sai da frente — que é o pedido da etapa.
      const vistos = url.searchParams.get('vistos') === '1';
      return json({ ok: true, notices: await readNotices(sql, sessao.actor, vistos) });
    }

    // Só o número, para a pastilha da barra lateral. Rota própria porque ela
    // roda em toda tela que desenha a barra: trazer a caixa inteira para
    // escrever um algarismo seria pagar a leitura toda por nada.
    if (rota === 'GET /board/notices/count') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      return json({ ok: true, unread: await countUnreadNotices(sql, sessao.actor) });
    }

    // UMA rota para marcar e desmarcar, e não duas. É o mesmo gesto com o
    // interruptor em duas posições — duas rotas dariam dois caminhos para o
    // mesmo estado, e o segundo divergiria do primeiro na primeira mudança.
    if (rota === 'POST /board/notices/read') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const body = (await request.json().catch(() => ({}))) as {
        key?: unknown;
        read?: unknown;
      };
      if (typeof body.key !== 'string') {
        return json({ message: 'Não deu para marcar este aviso. Recarregue a caixa e tente de novo.' }, 400);
      }
      await markNotice(sql, sessao.actor, body.key, body.read !== false);
      // A caixa RELIDA vem junto, como toda escrita da ficha da tarefa faz: a
      // tela mostra o que FICOU, e não o que ela pediu. Ver o cabeçalho de
      // `server/board-task.ts`.
      const vistos = url.searchParams.get('vistos') === '1';
      return json({ ok: true, notices: await readNotices(sql, sessao.actor, vistos) });
    }

    // --- a ficha da tarefa (F17.10) -----------------------------------------
    // Sete rotas, e nenhuma delas repete regra: a política de linha recorta, e
    // quem escreve conjunto é sempre uma ação do banco (`set_task_assignees`,
    // `set_task_tags`, `set_task_watchers`, `move_task`, `complete_task`).
    //
    // TODA ESCRITA DEVOLVE A FICHA RELIDA. As ações de lista ignoram em
    // silêncio quem não tem perfil, e o gatilho do status carimba a conclusão
    // por conta própria — devolver o que se pediu, em vez do que ficou, seria
    // mentir com boa intenção. Ver o cabeçalho de `server/board-task.ts`.
    const tarefaNaLista = caminho.match(/^\/board\/lists\/([0-9a-f-]{36})\/tasks$/i);
    if (request.method === 'POST' && tarefaNaLista) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const body = (await request.json().catch(() => ({}))) as Partial<NewTask>;
      const id = await createBoardTask(sql, sessao.actor, tarefaNaLista[1], {
        title: body.title ?? '',
        description: body.description ?? null,
        dueOn: body.dueOn ?? null,
        startOn: body.startOn ?? null,
        priority: body.priority ?? null,
        statusId: body.statusId ?? null,
        customItemId: body.customItemId ?? null,
        assigneeIds: body.assigneeIds ?? [],
        tagIds: body.tagIds ?? [],
        // F38, Fase 6 — o cliente escolhido. Ausente = herda da lista; em
        // lista compartilhada, sem ele a criação é recusada (400).
        clientId: typeof body.clientId === 'string' ? body.clientId : null,
        // F40, Fase 2 — o tipo (`video|arte|foto|outros`). Valor torto chega ao
        // miolo, que o recusa em português; ausente em lista de produção = 400
        // `type_required`.
        type: body.type ?? null,
      });
      return json({ ok: true, id, task: await readTaskDetail(sql, sessao.actor, id) }, 201);
    }

    /* OS CLIENTES QUE O SELETOR OFERECE — F38, Fase 7. Ativos, ao alcance,
       da empresa da lista. Pedido quando alguém ABRE o seletor (no formulário
       de tarefa nova, no `+ Adicionar tarefa` ou no cartão), e não junto com o
       quadro: custo somado ao quadro, zero. */
    const clientesDaLista = caminho.match(/^\/board\/lists\/([0-9a-f-]{36})\/client-options$/i);
    if (request.method === 'GET' && clientesDaLista) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      return json({ ok: true, clients: await readClientOptions(sql, sessao.actor, clientesDaLista[1]) });
    }

    /* TROCAR O CLIENTE DA TAREFA — F38, Fase 7. Rota própria, e não um campo
       do `PATCH` da ficha: o `PATCH` também é o miolo do `update_task` da IA,
       e a troca de cliente tem regra própria (a da criação, lida na lista
       atual). `clientId` nulo = "o da lista" em lista de cliente, "interna,
       sem cliente" em lista interna, e recusa em lista compartilhada. */
    const clienteDaTarefa = caminho.match(/^\/board\/tasks\/([0-9a-f-]{36})\/client$/i);
    if (request.method === 'PUT' && clienteDaTarefa) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      // `clientId` ausente ou torto NÃO é "tire o cliente": ver `entradas-de-escrita.ts`.
      const pedido = lerClienteDaTarefa(await request.json().catch(() => null));
      if (!pedido.ok) return json({ message: pedido.message }, 400);
      return json({
        ok: true,
        task: await setBoardTaskClient(sql, sessao.actor, clienteDaTarefa[1], pedido.valor),
      });
    }

    const fichaDaTarefa = caminho.match(/^\/board\/tasks\/([0-9a-f-]{36})$/i);
    if (fichaDaTarefa) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      if (request.method === 'GET') {
        return json({
          ok: true,
          task: await readTaskDetail(sql, sessao.actor, fichaDaTarefa[1]),
          /**
           * SE O ENVIO DE ARQUIVO ESTÁ DE PÉ — F17.6.
           *
           * A tela precisa saber ANTES de desenhar o botão. Sem isto,
           * `📎 Anexar arquivo` apareceria clicável, aceitaria o arquivo,
           * subiria o corpo inteiro e só então levaria um 503 — que é a
           * definição de botão morto, com o agravante de gastar o envio.
           *
           * Mesmo desenho de `hasToken` em `GET /meta/health`: o servidor diz
           * SE a credencial existe, e nunca qual é. Segredo não sai por rota.
           *
           * Vai só no `GET`, e não nas escritas: o valor não muda entre uma
           * chamada e outra, e repeti-lo em oito respostas seria oito lugares
           * para esquecer de atualizar.
           */
          storage: {
            ready: Boolean(env.IDEWORKS_SERVER_SUPABASE_SERVICE_KEY?.trim()),
            variable: 'IDEWORKS_SERVER_SUPABASE_SERVICE_KEY',
          },
        });
      }

      // `PATCH`, e não `PUT`: campo ausente é campo NÃO MEXIDO. Um `PUT` que
      // carregasse tudo apagaria o prazo do ano 82025 toda vez que alguém
      // salvasse o título, porque o campo nativo de data não sabe mostrá-lo.
      if (request.method === 'PATCH') {
        const body = (await request.json().catch(() => ({}))) as TaskPatch;
        return json({
          ok: true,
          task: await patchBoardTask(sql, sessao.actor, fichaDaTarefa[1], body),
        });
      }
    }

    /**
     * QUEM SE PODE PÔR COMO RESPONSÁVEL NESTA TAREFA — F17.69.
     *
     * ⚠️ ROTA DE LEITURA, E SÓ DE LEITURA. Quem ESCREVE responsável continua
     * sendo o `PATCH` logo acima, com `assigneeIds` — a mesma
     * `ideworks.set_task_assignees` que a ficha usa, e por isso o rastro em
     * `task_events` (F17.65) sai de um lugar só. A capa do cartão não ganhou
     * caminho de escrita próprio (regra 9).
     *
     * ELA NÃO ENTRA NO CARREGAMENTO DO QUADRO, e isso é o desenho: o quadro
     * da pasta está em 379 ms (F17.74) porque `task_assignees_select` cobra
     * `can_reach_task_id` por linha (F17.3). Esta lista é pedida quando
     * alguém ABRE o menu de um cartão — uma tarefa, uma vez. Custo somado ao
     * quadro: zero.
     */
    const atribuiveisDaTarefa = caminho.match(
      /^\/board\/tasks\/([0-9a-f-]{36})\/assignable$/i,
    );
    if (atribuiveisDaTarefa && request.method === 'GET') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      return json({
        ok: true,
        // ⚠️ Vazia NÃO É ERRO, é recusa: a função do banco devolve zero linhas
        // quando quem pergunta não alcança a tarefa. Ver
        // `server/responsaveis-da-tarefa.ts`.
        people: await lerPessoasAtribuiveis(sql, sessao.actor, atribuiveisDaTarefa[1]),
        // `me` pela mesma razão de `GET /team` (F17.10b): o seletor põe `Eu`
        // no topo, e é quem mais se atribui tarefa. É o id de QUEM PEDIU —
        // nada de terceiro sai daqui que já não saísse. Vem junto para a capa
        // não precisar de uma segunda ida ao servidor no meio do gesto.
        me: sessao.actor.userId,
      });
    }

    const conclusaoNoQuadro = caminho.match(/^\/board\/tasks\/([0-9a-f-]{36})\/completion$/i);
    if (conclusaoNoQuadro && (request.method === 'POST' || request.method === 'DELETE')) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      return json({
        ok: true,
        task: await setBoardTaskCompleted(
          sql,
          sessao.actor,
          conclusaoNoQuadro[1],
          request.method === 'POST',
        ),
      });
    }

    const arquivoNoQuadro = caminho.match(/^\/board\/tasks\/([0-9a-f-]{36})\/archive$/i);
    if (arquivoNoQuadro && (request.method === 'POST' || request.method === 'DELETE')) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      return json({
        ok: true,
        task: await setBoardTaskArchived(
          sql,
          sessao.actor,
          arquivoNoQuadro[1],
          request.method === 'POST',
        ),
      });
    }

    // --- os passos da tarefa (F17.15) ---------------------------------------
    // Oito rotas, e nenhuma delas confere regra nenhuma: a subtarefa herda a
    // lista pelo gatilho `tasks_parent_guard`, a mãe de outra lista é recusada
    // por `tasks_parent_same_list_fk`, o ciclo pelo mesmo gatilho, o nome `{}`
    // por `is_meaningful_name`, e o alcance pelas quatro políticas.
    //
    // TODAS DEVOLVEM A FICHA DA TAREFA, RELIDA — marcar um item muda a
    // contagem do checklist e criar uma subtarefa muda a do cartão, e as duas
    // saem de `ideworks.task_progress`. Ver `server/board-passos.ts`.
    const subtarefasDaTarefa = caminho.match(/^\/board\/tasks\/([0-9a-f-]{36})\/subtasks$/i);
    if (request.method === 'POST' && subtarefasDaTarefa) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const body = (await request.json().catch(() => ({}))) as Partial<NewSubtask>;
      const r = await createSubtask(sql, sessao.actor, subtarefasDaTarefa[1], {
        title: body.title ?? '',
        dueOn: body.dueOn ?? null,
        startOn: body.startOn ?? null,
        priority: body.priority ?? null,
        statusId: body.statusId ?? null,
        assigneeIds: body.assigneeIds ?? [],
        tagIds: body.tagIds ?? [],
      });
      return json({ ok: true, id: r.id, task: r.task }, 201);
    }

    // Prender e SOLTAR. Soltar é o único caminho de volta que não apaga
    // trabalho: apagar a mãe leva as filhas, pelo `on delete cascade`.
    const maeDaTarefa = caminho.match(/^\/board\/tasks\/([0-9a-f-]{36})\/parent$/i);
    if (maeDaTarefa && (request.method === 'PUT' || request.method === 'DELETE')) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      // Soltar é DELETE. `PUT` sem `parentId` não solta a subtarefa em silêncio.
      let mae: string | null = null;
      if (request.method === 'PUT') {
        const pedida = lerMaePedida(await request.json().catch(() => null));
        if (!pedida.ok) return json({ message: pedida.message }, 400);
        mae = pedida.valor;
      }
      return json({
        ok: true,
        task: await setTaskParent(sql, sessao.actor, maeDaTarefa[1], mae),
      });
    }

    const checklistsDaTarefa = caminho.match(/^\/board\/tasks\/([0-9a-f-]{36})\/checklists$/i);
    if (request.method === 'POST' && checklistsDaTarefa) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const body = (await request.json().catch(() => ({}))) as { name?: string };
      return json(
        {
          ok: true,
          // `Checklist` é o nome padrão no ClickUp, e é ele que aparece quando
          // ninguém escolhe outro.
          task: await createChecklist(
            sql,
            sessao.actor,
            checklistsDaTarefa[1],
            body.name?.trim() || 'Checklist',
          ),
        },
        201,
      );
    }

    const umChecklist = caminho.match(/^\/board\/checklists\/([0-9a-f-]{36})$/i);
    if (umChecklist && (request.method === 'PATCH' || request.method === 'DELETE')) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      if (request.method === 'DELETE') {
        return json({ ok: true, task: await deleteChecklist(sql, sessao.actor, umChecklist[1]) });
      }
      const body = (await request.json().catch(() => ({}))) as { name?: string };
      return json({
        ok: true,
        task: await renameChecklist(sql, sessao.actor, umChecklist[1], body.name ?? ''),
      });
    }

    const itensDoChecklist = caminho.match(/^\/board\/checklists\/([0-9a-f-]{36})\/items$/i);
    if (request.method === 'POST' && itensDoChecklist) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        parentItemId?: string | null;
      };
      return json(
        {
          ok: true,
          task: await addChecklistItem(sql, sessao.actor, itensDoChecklist[1], {
            name: body.name ?? '',
            parentItemId: body.parentItemId ?? null,
          }),
        },
        201,
      );
    }

    const umItem = caminho.match(/^\/board\/checklist-items\/([0-9a-f-]{36})$/i);
    if (umItem && (request.method === 'PATCH' || request.method === 'DELETE')) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      if (request.method === 'DELETE') {
        return json({ ok: true, task: await deleteChecklistItem(sql, sessao.actor, umItem[1]) });
      }
      // Campo ausente é campo NÃO MEXIDO: marcar o item não pode apagar o
      // responsável dele.
      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        resolved?: boolean;
        assigneeId?: string | null;
      };
      return json({
        ok: true,
        task: await patchChecklistItem(sql, sessao.actor, umItem[1], body),
      });
    }

    // --- a entrega: comentário, link e anexo (F17.6) ------------------------
    // Nove rotas, e nenhuma delas confere regra nenhuma. Quem decide:
    //   alcance ................. `can_reach_task_id`, nas oito políticas
    //   "só o autor edita" ...... `task_comments_update` / `_delete`
    //   "a resposta é 1 nível" .. `task_comments_parent_fk`
    //   "http ou https" ......... `task_links_url_is_web`
    //   "cabe em 5 MB" .......... `task_attachments_size_ceiling`
    //
    // TODAS DEVOLVEM A FICHA DA TAREFA, RELIDA — comentar muda
    // `task_progress.comment_count`, que é o número do cartão do quadro.
    //
    // O BALDE É PRIVADO E AS DUAS ROTAS DE ARQUIVO PRECISAM DA CHAVE DE
    // SERVIÇO — `armazenamento` é declarado no alto da função desde a F17.52,
    // porque o documento do histórico também precisa dele. Faltando a chave,
    // as rotas de arquivo respondem 503 com a frase que nomeia a variável, e
    // as de comentário e link continuam funcionando: não tocam no Storage.
    const comentariosDaTarefa = caminho.match(/^\/board\/tasks\/([0-9a-f-]{36})\/comments$/i);
    if (request.method === 'POST' && comentariosDaTarefa) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const body = (await request.json().catch(() => ({}))) as {
        body?: string;
        parentId?: string | null;
      };
      const r = await postComment(sql, sessao.actor, comentariosDaTarefa[1], {
        body: body.body ?? '',
        parentId: body.parentId ?? null,
      });
      return json({ ok: true, id: r.id, task: r.task }, 201);
    }

    const umComentario = caminho.match(/^\/board\/comments\/([0-9a-f-]{36})$/i);
    if (umComentario && (request.method === 'PATCH' || request.method === 'DELETE')) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      if (request.method === 'DELETE') {
        return json({ ok: true, task: await deleteComment(sql, sessao.actor, umComentario[1]) });
      }
      const body = (await request.json().catch(() => ({}))) as { body?: string };
      return json({
        ok: true,
        task: await editComment(sql, sessao.actor, umComentario[1], body.body ?? ''),
      });
    }

    // --- "Solicitar aprovação" no card — F42, Fase 4 ------------------------
    // GET: a seção da ficha (cliente ligado? esteira com os três destinos?
    // rodadas). POST: confere os materiais (link do Dropbox ou anexo de imagem
    // do card — F42, Fase 9; 400 e nada gravado), copia as artes para a pasta
    // da rodada no balde privado e chama `create_approval_round`; IW042 vira
    // 409 com a frase; devolve a ficha nova, porque o card mudou de etapa.
    const rodadasDoCard = caminho.match(/^\/board\/tasks\/([0-9a-f-]{36})\/approval-rounds$/i);
    if (rodadasDoCard && (request.method === 'GET' || request.method === 'POST')) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      const taskId = rodadasDoCard[1].toLowerCase();
      if (request.method === 'GET') {
        return json({ ok: true, approval: await lerAprovacaoDoCard(sql, sessao.actor, taskId) });
      }
      const itens = lerEntradaDoEnvio(await request.json().catch(() => null));
      const enviada = await enviarParaAprovacao(sql, sessao.actor, armazenamento, taskId, itens);
      return json(
        { ok: true, ...enviada, task: await readTaskDetail(sql, sessao.actor, taskId) },
        201,
      );
    }

    const linksDaTarefa = caminho.match(/^\/board\/tasks\/([0-9a-f-]{36})\/links$/i);
    if (request.method === 'POST' && linksDaTarefa) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const body = (await request.json().catch(() => ({}))) as {
        label?: string;
        url?: string;
      };
      const r = await addLink(sql, sessao.actor, linksDaTarefa[1], {
        label: body.label ?? '',
        url: body.url ?? '',
      });
      return json({ ok: true, id: r.id, task: r.task }, 201);
    }

    const umLink = caminho.match(/^\/board\/links\/([0-9a-f-]{36})$/i);
    if (umLink && (request.method === 'PATCH' || request.method === 'DELETE')) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      if (request.method === 'DELETE') {
        return json({ ok: true, task: await deleteLink(sql, sessao.actor, umLink[1]) });
      }
      // Campo ausente é campo NÃO MEXIDO: renomear o link não pode apagar o
      // endereço dele.
      const body = (await request.json().catch(() => ({}))) as {
        label?: string;
        url?: string;
      };
      return json({ ok: true, task: await patchLink(sql, sessao.actor, umLink[1], body) });
    }

    // A ÚNICA ROTA DO PROJETO QUE NÃO RECEBE JSON. O corpo é `multipart`, e é
    // o navegador que escolhe a fronteira dele — ver `api.enviarAnexo`.
    const anexosDaTarefa = caminho.match(/^\/board\/tasks\/([0-9a-f-]{36})\/attachments$/i);
    if (request.method === 'POST' && anexosDaTarefa) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      // O TETO VALE ANTES DE O CORPO ENTRAR NA MEMÓRIA — `corpo-com-teto.ts`.
      // O Worker tem 128 MB e `formData()` monta o envio inteiro: um arquivo de
      // 200 MB derrubaria a requisição com um erro de plataforma em vez de uma
      // frase (e levaria junto quem dividia o isolado). A conferência de
      // `arquivo.size` logo abaixo só diz a frase certa para o que coube.
      const lido = await lerFormularioComTeto(request, TETO_DE_BYTES);
      if (lido.grande) return json({ message: FRASE_ENVIO_GRANDE }, 413);
      const forma = lido.forma;
      const arquivo = forma?.get('arquivo');

      if (!(arquivo instanceof File)) {
        return json({ message: 'Nenhum arquivo veio no envio.' }, 400);
      }

      // O banco recusa de novo, com o mesmo número.
      //
      // ⚠️ O NÚMERO VEM DE `TETO_DE_BYTES` — F17.17. Escrito à mão aqui, ele
      // era o QUARTO lugar onde o teto morava (tela, servidor, `check` do
      // banco e balde), e o quarto é o que ninguém lembra de mudar junto.
      if (arquivo.size > TETO_DE_BYTES) {
        return json(
          {
            message:
              `O arquivo tem ${tamanhoLegivel(arquivo.size)} e o teto do envio é ` +
              `${tamanhoLegivel(TETO_DE_BYTES)}. Para algo maior, ponha o link do Dropbox ao lado do anexo.`,
          },
          413,
        );
      }

      const r = await uploadAttachment(sql, sessao.actor, armazenamento, anexosDaTarefa[1], {
        temporary: forma?.get('temporaria') === 'true',
        inText: forma?.get('noTexto') === 'true',
        fileName: arquivo.name,
        contentType: arquivo.type,
        bytes: await arquivo.arrayBuffer(),
      });
      return json({ ok: true, id: r.id, task: r.task }, 201);
    }

    // O endereço assinado, com prazo. NÃO EXISTE endereço permanente — é o
    // que separa este balde do balde do legado, cujo documento de cliente tem
    // endereço fixo e público.
    const enderecoDoAnexo = caminho.match(/^\/board\/attachments\/([0-9a-f-]{36})\/url$/i);
    if (request.method === 'GET' && enderecoDoAnexo) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      return json({
        ok: true,
        ...(await signAttachment(sql, sessao.actor, armazenamento, enderecoDoAnexo[1])),
      });
    }

    /*
      OS ENDEREÇOS DO QUADRO, EM UM PEDIDO SÓ — F17.56.

      `POST` e não `GET` porque a lista de identificadores é o CORPO: cinquenta
      UUIDs numa `query string` passam de mil e oitocentos caracteres, e há
      proxy que corta antes disso. Ele não escreve nada — a rota assina e
      pronto.

      A peneira de acesso é a MESMA de `signAttachment`, e está no banco: id
      que não volta da consulta não entra no mapa. Ver `signAttachments`.
    */
    if (request.method === 'POST' && caminho === '/board/attachments/urls') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
      const ids = Array.isArray(body.ids)
        ? body.ids.filter((x): x is string => typeof x === 'string')
        : [];

      return json({
        ok: true,
        urls: await signAttachments(sql, sessao.actor, armazenamento, ids),
      });
    }

    const umAnexo = caminho.match(/^\/board\/attachments\/([0-9a-f-]{36})$/i);
    if (request.method === 'DELETE' && umAnexo) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      return json({
        ok: true,
        task: await deleteAttachment(sql, sessao.actor, armazenamento, umAnexo[1]),
      });
    }

    // A etiqueta nasce aqui porque `task_tags` está VAZIA: sem esta rota, "pôr
    // etiqueta pela tela" seria um seletor sem opção nenhuma.
    const etiquetaDoEspaco = caminho.match(/^\/board\/spaces\/([0-9a-f-]{36})\/tags$/i);
    if (request.method === 'POST' && etiquetaDoEspaco) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        bgColor?: string | null;
        fgColor?: string | null;
      };
      return json(
        {
          ok: true,
          tag: await createSpaceTag(sql, sessao.actor, etiquetaDoEspaco[1], {
            name: body.name ?? '',
            bgColor: body.bgColor ?? null,
            fgColor: body.fgColor ?? null,
          }),
        },
        201,
      );
    }

    // --- criar e editar a árvore (F17.14) -----------------------------------
    // Nove rotas, e NENHUMA delas confere quem pode o quê. As políticas da
    // F17.1 decidem — `spaces_write` exige administrador, `folders_write` e
    // `lists_write` exigem alcance ao espaço —, e `server/tree.ts` traduz a
    // recusa. Um `if (isSuperadmin)` aqui seria a segunda regra de acesso.
    if (rota === 'GET /board/tree/full') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      return json({ ok: true, ...(await readFullTree(sql, sessao.actor)) });
    }

    if (rota === 'POST /board/spaces') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const body = (await request.json().catch(() => ({}))) as {
        categoryId?: string;
        name?: string;
        workflowName?: string;
        statuses?: StatusEmEdicao[];
      };
      if (!body.categoryId) {
        return json(
          { message: 'O espaço pertence a uma empresa. Escolha qual antes de criar.' },
          400,
        );
      }
      /*
        O ESPAÇO NUNCA NASCE SEM ESTEIRA — e é por isso que o padrão mora aqui.

        Espaço sem conjunto de status nasce morto: a primeira lista dentro dele
        abriria um quadro sem coluna nenhuma. Ver `createSpace`.

        A F17.16 passou a aceitar um MOLDE vindo da tela (`Conteúdo`, `Vídeo`,
        `ADS`, `Demanda`, `Simples`), porque a esteira de dois estados deixou
        de ser a única. O que não mudou é a garantia: lista vazia ou ausente
        cai em `ESTEIRA_PADRAO`, e nunca em "sem esteira". Os status vão crus
        para `create_status_set`, que é quem confere tipo e fim.
      */
      const escolhidos = body.statuses ?? [];
      return json(
        {
          ok: true,
          space: await createSpace(sql, sessao.actor, {
            categoryId: body.categoryId,
            name: body.name ?? '',
            workflowName: body.workflowName,
            statuses: escolhidos.length > 0 ? escolhidos : ESTEIRA_PADRAO,
          }),
        },
        201,
      );
    }

    const espacoDaArvore = caminho.match(/^\/board\/spaces\/([0-9a-f-]{36})$/i);
    if (request.method === 'PATCH' && espacoDaArvore) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        archived?: boolean;
      };
      return json({
        ok: true,
        space: await patchSpace(sql, sessao.actor, espacoDaArvore[1], body),
      });
    }

    const pastaNoEspaco = caminho.match(/^\/board\/spaces\/([0-9a-f-]{36})\/folders$/i);
    if (request.method === 'POST' && pastaNoEspaco) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      const body = (await request.json().catch(() => ({}))) as { name?: string };
      return json(
        {
          ok: true,
          folder: await createFolder(sql, sessao.actor, pastaNoEspaco[1], body.name ?? ''),
        },
        201,
      );
    }

    const pastaDaArvore = caminho.match(/^\/board\/folders\/([0-9a-f-]{36})$/i);
    if (request.method === 'PATCH' && pastaDaArvore) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        archived?: boolean;
      };
      return json({
        ok: true,
        folder: await patchFolder(sql, sessao.actor, pastaDaArvore[1], body),
      });
    }

    const listaNoEspaco = caminho.match(/^\/board\/spaces\/([0-9a-f-]{36})\/lists$/i);
    if (request.method === 'POST' && listaNoEspaco) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        folderId?: string | null;
        workflowName?: string;
        statuses?: StatusEmEdicao[];
      };
      /*
        AS ETAPAS, NA CRIAÇÃO — F17.16.

        Diferente do espaço: aqui a AUSÊNCIA de status significa herdar, e
        herdar é o padrão. A lista sem conjunto próprio resolve a esteira por
        pasta → espaço, que é como as duas listas reais funcionam. Cair num
        padrão aqui daria a toda lista uma esteira própria que ninguém pediu —
        e desfazer isso depois exigiria `DELETE .../workflow` lista por lista.
      */
      const doMolde = body.statuses ?? [];
      return json(
        {
          ok: true,
          list: await createList(sql, sessao.actor, listaNoEspaco[1], {
            name: body.name ?? '',
            // Nulo é a lista SOLTA no espaço, e ela existe de propósito: a
            // chave composta fica satisfeita por definição com pasta nula.
            folderId: body.folderId ?? null,
            workflow:
              doMolde.length === 0
                ? null
                : { name: body.workflowName ?? 'Esteira', statuses: doMolde },
          }),
        },
        201,
      );
    }

    /*
      OS CLIENTES ENTRAM NO QUADRO — F17.43.

      Duas rotas no mesmo endereço, e é a mesma pergunta vista dos dois lados:
      o `GET` devolve os clientes ao alcance, com quantas listas cada um já
      tem neste espaço; o `POST` traz. Trazer de novo cria outra lista.

      ⚠️ NENHUMA DAS DUAS CONFERE ALCANCE. `clients_select` recorta a leitura,
      `lists_write` decide a criação e `lists_client_reach_guard` decide o
      vínculo. Um `if` aqui seria a segunda regra de acesso do sistema, no
      lugar em que ela mais custa.
    */
    const clientesDoEspaco = caminho.match(
      /^\/board\/spaces\/([0-9a-f-]{36})\/client-lists$/i,
    );
    if (request.method === 'GET' && clientesDoEspaco) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      return json({
        ok: true,
        ...(await readClientsForSpace(sql, sessao.actor, clientesDoEspaco[1])),
      });
    }

    if (request.method === 'POST' && clientesDoEspaco) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      const body = (await request.json().catch(() => ({}))) as {
        folderId?: string | null;
        clientIds?: string[];
      };
      return json(
        {
          ok: true,
          ...(await bringClients(sql, sessao.actor, clientesDoEspaco[1], {
            // Nulo é a lista SOLTA no espaço — a mesma leitura de `criarLista`.
            folderId: body.folderId ?? null,
            clientIds: body.clientIds ?? [],
          })),
        },
        201,
      );
    }

    // `PATCH`, no mesmo endereço em que o `GET` devolve o quadro. Renomear,
    // arquivar e mover são a mesma coisa vista de fora: mexer na lista.
    const ordemDaLista = caminho.match(/^\/board\/lists\/([0-9a-f-]{36})\/order$/i);
    if (request.method === 'POST' && ordemDaLista) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      const body = await request.json().catch(() => ({})) as { direction?: unknown };
      await reorderList(sql, sessao.actor, ordemDaLista[1], body.direction);
      return json({ ok: true });
    }

    const listaDaArvore = caminho.match(/^\/board\/lists\/([0-9a-f-]{36})$/i);
    if (request.method === 'PATCH' && listaDaArvore) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        content?: string | null;
        archived?: boolean;
        spaceId?: string;
        folderId?: string | null;
        requiresClient?: unknown;
      };

      /* A MARCA "EXIGE CLIENTE" — F38, Fase 7. SÓ ADMINISTRADOR.
         A política `lists_write` deixa quem cria lista mexer nela, mas esta
         marca muda a regra de criação para a equipe INTEIRA naquela lista (o
         plano pede "só para admin"). Por isso a conferência do papel mora
         aqui, como nas rotas de administração. */
      if (body.requiresClient !== undefined) {
        if (typeof body.requiresClient !== 'boolean') {
          return json({ message: 'requiresClient precisa ser verdadeiro ou falso.' }, 400);
        }
        if (!sessao.actor.isSuperadmin) {
          return json(
            { message: 'Só administrador liga ou desliga a marca "exige cliente" da lista.' },
            403,
          );
        }
      }

      return json({
        ok: true,
        list: await patchList(sql, sessao.actor, listaDaArvore[1], {
          name: body.name,
          content: body.content,
          archived: body.archived,
          requiresClient: typeof body.requiresClient === 'boolean' ? body.requiresClient : undefined,
          // AS DUAS COLUNAS VIAJAM JUNTAS. `spaceId` sozinho deixaria a lista
          // apontando para uma pasta de outro espaço, e a chave composta
          // recusaria — com razão. Sem `spaceId` não há movimento nenhum.
          mover:
            body.spaceId === undefined
              ? undefined
              : { spaceId: body.spaceId, folderId: body.folderId ?? null },
        }),
      });
    }

    if (request.method === 'DELETE' && listaDaArvore) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      return json({ ok: true, ...(await deleteList(sql, sessao.actor, listaDaArvore[1])) });
    }

    const esteiraDaPasta = caminho.match(/^\/board\/folders\/([0-9a-f-]{36})\/workflow$/i);
    if (esteiraDaPasta && (request.method === 'GET' || request.method === 'POST')) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      const input = request.method === 'GET' ? null : await request.json().catch(() => ({}));
      if (request.method === 'POST' && (input === null || typeof input !== 'object' || Array.isArray(input))) {
        return json({ message: 'Informe a esteira da pasta.' }, 400);
      }
      return json({ ok: true, ...(await folderWorkflow(sql, sessao.actor, esteiraDaPasta[1], input)) });
    }

    // --- os destinos da aprovação do cliente na esteira — F42, Fase 3 -------
    // A esteira é a RESOLVIDA da lista (lista → pasta → espaço). Só admin: 403
    // no módulo, antes do banco; o banco recusa etapa de outra esteira (IW042).
    const destinosDaAprovacao = caminho.match(/^\/board\/lists\/([0-9a-f-]{36})\/approval-targets$/i);
    if (destinosDaAprovacao && (request.method === 'GET' || request.method === 'PUT')) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      if (request.method === 'GET') {
        return json({ ok: true, approval: await lerDestinosDaLista(sql, sessao.actor, destinosDaAprovacao[1]) });
      }
      if (!sessao.actor.isSuperadmin) return json({ message: FRASE_SO_ADMIN_APROVACAO }, 403);
      const destinos = lerEntradaDosDestinos(await request.json().catch(() => ({})));
      return json({
        ok: true,
        approval: await gravarDestinosDaLista(sql, sessao.actor, destinosDaAprovacao[1], destinos),
      });
    }

    const esteiraDaLista = caminho.match(/^\/board\/lists\/([0-9a-f-]{36})\/workflow$/i);
    if (esteiraDaLista && (request.method === 'POST' || request.method === 'DELETE')) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      if (request.method === 'DELETE') {
        return json({ ok: true, ...(await clearListWorkflow(sql, sessao.actor, esteiraDaLista[1])) });
      }

      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        statuses?: StatusEmEdicao[];
        destinos?: { de: string; para: string }[];
      };
      return json(
        {
          ok: true,
          ...(await setListWorkflow(sql, sessao.actor, esteiraDaLista[1], {
            name: body.name ?? '',
            // A lista de status vai CRUA para `ideworks.set_list_workflow`, que
            // confere tipo por tipo e recusa o que não é um dos cinco do
            // ClickUp. Filtrar aqui daria uma segunda conferência, mais fraca.
            statuses: body.statuses ?? [],
            // Para onde vão as tarefas de uma etapa que sumiu — F17.19. Vem
            // vazio na primeira tentativa; a tela só o preenche depois de o
            // banco dizer quais etapas ficaram sem destino.
            destinos: body.destinos ?? [],
          })),
        },
        201,
      );
    }

    // --- as automações de uma lista (F17.41) -------------------------------
    // Duas rotas, e NENHUMA delas confere quem pode o quê.
    // `ideworks.set_task_automation` recusa sozinha — alcance nas duas
    // pontas, autoridade na lista de origem, e a etapa pertencendo à esteira
    // resolvida —, e a política de linha filtra a leitura. Um
    // `if (isSuperadmin)` aqui seria a segunda regra de acesso do sistema.
    //
    // ⚠️ QUEM EXECUTA A REGRA NÃO É ESTA ROTA. É `ideworks.move_task`, na
    // mesma escrita em que troca lista e status. Aqui só se configura.
    const automacoesDaLista = caminho.match(
      /^\/board\/lists\/([0-9a-f-]{36})\/automations$/i,
    );
    if (automacoesDaLista && (request.method === 'GET' || request.method === 'POST')) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      if (request.method === 'GET') {
        return json({
          ok: true,
          automations: await readListAutomations(sql, sessao.actor, automacoesDaLista[1]),
        });
      }

      const body = (await request.json().catch(() => ({}))) as {
        id?: string | null;
        name?: string;
        triggerStatusId?: string;
        targetListId?: string | null;
        targetStatusId?: string | null;
        assigneeId?: string | null;
        active?: boolean;
      };

      return json({
        ok: true,
        automation: await writeListAutomation(sql, sessao.actor, automacoesDaLista[1], {
          id: body.id ?? null,
          name: body.name ?? '',
          triggerStatusId: body.triggerStatusId ?? '',
          targetListId: body.targetListId ?? null,
          targetStatusId: body.targetStatusId ?? null,
          assigneeId: body.assigneeId ?? null,
          active: body.active !== false,
        }),
      });
    }

    const automacao = caminho.match(/^\/board\/automations\/([0-9a-f-]{36})$/i);
    if (automacao && request.method === 'DELETE') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      await deleteListAutomation(sql, sessao.actor, automacao[1]);
      return json({ ok: true });
    }

    // --- quem alcança cada nó da árvore (F17.23) ---------------------------
    // Duas rotas, e NENHUMA delas confere quem pode o quê. `node_access` e
    // `set_node_access` recusam sozinhas — a primeira exige alcance, a segunda
    // exige `can_grant_on` —, e `server/tree.ts` traduz a recusa. Um
    // `if (isSuperadmin)` aqui seria a segunda regra de acesso do sistema.
    const acessoDoNo = caminho.match(
      /^\/board\/access\/(space|folder|list)\/([0-9a-f-]{36})$/i,
    );
    if (acessoDoNo && (request.method === 'GET' || request.method === 'PUT')) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const no: NoDeAcesso = {
        nivel: acessoDoNo[1].toLowerCase() as NoDeAcesso['nivel'],
        id: acessoDoNo[2],
      };

      if (request.method === 'GET') {
        return json({ ok: true, access: await readNodeAccess(sql, sessao.actor, no) });
      }

      // Pedido sem `restricted` ou sem `grants` NÃO é "abra o nó e tire todo
      // mundo": ver `entradas-de-escrita.ts`.
      const pedido = lerAcessoPedido(await request.json().catch(() => null));
      if (!pedido.ok) return json({ message: pedido.message }, 400);

      return json({
        ok: true,
        access: await writeNodeAccess(sql, sessao.actor, no, {
          restricted: pedido.valor.restricted,
          // Os níveis vão CRUS para `set_node_access`, que os converte para o
          // tipo do banco e recusa o que não existe. Filtrar aqui daria uma
          // segunda conferência, mais fraca, sobre a mesma pergunta.
          grants: pedido.valor.grants.map((g) => ({
            userId: g.userId,
            name: '',
            level: (typeof g.level === 'string' ? g.level : 'execute') as NivelDeAcesso,
          })),
        }),
      });
    }

    // --- apagar item --------------------------------------------------------
    // A grade semanal tem `−` ao lado de cada tipo, e ele precisa desfazer o
    // `+`. Sem esta rota, um item criado por engano ficaria para sempre
    // pesando no denominador do medidor.
    //
    // Apaga de verdade, sem confirmação em duas etapas: um item de conteúdo
    // vazio não tem histórico a perder, e exigir confirmação para desfazer um
    // clique acidental faria a grade ser desagradável de usar. As ações que
    // simulam antes são as que destroem trabalho — não esta.
    // --- renomear item (F17.44) ---------------------------------------------
    // O calendario passou a CRIAR entrega, e com nome. Sem esta rota, o nome
    // dado no nascimento seria a unica coisa que nunca mais mudaria — e
    // corrigir um nome e a edicao mais banal que existe.
    //
    // So o nome: dia e conclusao ja tem rota propria, e o tipo nao se corrige
    // (trocar video por arte muda o PESO da entrega no medidor, e isso e
    // apagar um item e criar outro, nao renomear).
    const renomear = caminho.match(/^\/items\/([0-9a-f-]{36})$/i);
    if (request.method === 'PUT' && renomear) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const corpo = (await request.json().catch(() => ({}))) as { title?: unknown };
      if (corpo.title !== undefined && corpo.title !== null && typeof corpo.title !== 'string') {
        return json({ message: 'Título inválido.' }, 400);
      }
      const nome = (corpo.title ?? '').trim();

      const mudou = await withActor(sql, asDbActor(sessao.actor), async (tx) => {
        const linhas = await tx`
          update ideworks.content_items
             set title = ${nome === '' ? null : nome}, updated_at = now()
           where id = ${renomear[1]}
           returning id`;
        return linhas.length > 0;
      });

      return mudou ? json({ ok: true }) : json({ message: 'Item não encontrado.' }, 404);
    }

    const remocao = caminho.match(/^\/items\/([0-9a-f-]{36})$/i);
    if (request.method === 'DELETE' && remocao) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const apagados = await withActor(sql, asDbActor(sessao.actor), async (tx) => {
        // A política já recusa o que está fora da carteira; o `returning`
        // distingue "não existe" de "apagou", e a resposta é a mesma nos dois
        // casos por fora — distinguir revelaria itens de outra carteira.
        const linhas = await tx`
          delete from ideworks.content_items where id = ${remocao[1]} returning id`;
        return linhas.length;
      });

      return apagados > 0 ? json({ ok: true }) : json({ message: 'Item não encontrado.' }, 404);
    }

    // --- catálogo do formulário -------------------------------------------
    // Planos e categorias, para os dois seletores da ficha. Vem numa chamada
    // só porque a tela precisa dos dois ao mesmo tempo, e duas idas fariam o
    // formulário abrir com um seletor preenchido e o outro ainda vazio.
    if (rota === 'GET /catalogs') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      return json({ ok: true, ...(await readCatalogs(sql, sessao.actor)) });
    }

    // --- ler cliente na forma do formulário -------------------------------
    const paraEditar = caminho.match(/^\/clients\/([0-9a-f-]{36})\/form$/i);
    if (request.method === 'GET' && paraEditar) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      return json({ ok: true, client: await readClientForm(sql, sessao.actor, paraEditar[1]) });
    }

    // --- listas do quadro deste cliente (F17.84) --------------------------
    // A mesma pergunta da ficha, do relatório e da IA. Quem não alcança o
    // cliente leva o 404 único; quem alcança e o cliente não tem lista
    // nenhuma leva lista vazia, nunca erro.
    const listasDoQuadro = caminho.match(/^\/clients\/([0-9a-f-]{36})\/board-lists$/i);
    if (request.method === 'GET' && listasDoQuadro) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      try {
        return json({
          ok: true,
          lists: await readClientBoardLists(sql, sessao.actor, listasDoQuadro[1]),
        });
      } catch (error) {
        if (error instanceof ClientNotVisible) return json({ message: error.message }, 404);
        throw error;
      }
    }

    // --- criar e editar cliente -------------------------------------------
    // A MESMA validação da tela roda aqui. Não é redundância: a tela valida
    // para avisar antes de enviar, e o servidor valida porque nunca confia em
    // quem chama — um POST montado à mão não passa por tela nenhuma.
    const editar = caminho.match(/^\/clients\/([0-9a-f-]{36})$/i);
    if (rota === 'POST /clients' || (request.method === 'PUT' && editar)) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const corpo = (await request.json().catch(() => ({}))) as Partial<EntradaDeCliente>;
      const conferido = validarCliente({ ...ENTRADA_VAZIA, ...corpo });
      if (!conferido.ok) {
        return json({ message: 'Confira os campos destacados.', erros: conferido.erros }, 400);
      }

      if (editar) {
        await updateClient(sql, sessao.actor, editar[1], conferido.valor);
        return json({ ok: true, id: editar[1] });
      }
      return json({ ok: true, id: await createClient(sql, sessao.actor, conferido.valor) }, 201);
    }

    // --- a aprovação do cliente por link — F42, Fases 3 e 5 ------------------
    //
    // A PÚBLICA PRIMEIRO, e sem sessão: o cliente não tem conta. O token
    // resolve por hash (ator `preauth`, funções `security definer` da F42_6);
    // revogado, desligado, inativo, inexistente e chamada de outro cliente
    // respondem o MESMO 404. Token fora do formato nem vai ao banco. Os
    // cabeçalhos valem para TODAS as respostas (inclusive recusa e 429): o
    // endereço carrega o token, e ele não pode vazar por `Referer` nem cair em
    // buscador. A falha inesperada (500) recebe os mesmos lá no fim. O token
    // nunca vai ao log: `rota` o mascara.
    //
    //   GET  /public/aprovacao/:token                         cliente + chamadas
    //   GET  /public/aprovacao/:token/chamadas/:id            uma chamada
    //   POST /public/aprovacao/:token/chamadas/:id/comentarios  { texto, itemId? }
    //   POST /public/aprovacao/:token/chamadas/:id/aprovar      { comentario? }
    //   POST /public/aprovacao/:token/chamadas/:id/reprovar     { comentario }
    //   GET  /public/aprovacao/:token/chamadas/:id/itens/:item/imagem  a arte anexada
    //        (F42, Fase 9): bytes da cópia servidos pelo Worker; o caminho do
    //        balde nunca sai. Limite à parte (`media`).
    //
    // Limite por token e por IP (leitura/escrita) e o porquê dos tetos: ver
    // `src/server/aprovacao-publica.ts`.
    const aprovacaoPublica = caminho.match(
      /^\/public\/aprovacao\/([^/]+)(?:\/chamadas\/([^/]+)(?:\/(comentarios|aprovar|reprovar))?)?\/?$/,
    );
    if (caminho.startsWith('/public/aprovacao/')) {
      const publica = (body: unknown, status: number) => {
        const r = json(body, status);
        r.headers.set('Referrer-Policy', 'no-referrer');
        r.headers.set('X-Robots-Tag', 'noindex, nofollow');
        r.headers.set('Cache-Control', 'no-store');
        return r;
      };
      const naoExiste = () => publica({ message: FRASE_NAO_ENCONTRADO_PUBLICO }, 404);
      const imagemPublica = caminho.match(/^\/public\/aprovacao\/([^/]+)\/chamadas\/([^/]+)\/itens\/([^/]+)\/imagem$/);
      if (imagemPublica) {
        const [, tokenDaImagem, rodadaDaImagem, itemDaImagem] = imagemPublica;
        if (!tokenTemFormato(tokenDaImagem) || request.method !== 'GET') return naoExiste();
        try {
          const hashDaImagem = await hashDoToken(tokenDaImagem);
          await conferirLimitePublico(sql, 'media', hashDaImagem, clientIp(request));
          const r = await servirImagemPublica(sql, armazenamento, hashDaImagem, rodadaDaImagem, itemDaImagem);
          r.headers.set('Referrer-Policy', 'no-referrer');
          r.headers.set('X-Robots-Tag', 'noindex, nofollow');
          return r;
        } catch (erro) {
          if (erro instanceof RecusaPublica) {
            if (erro.status !== 404) log(`aprovação pública recusada em ${rota}: ${erro.status} ${erro.message}`);
            const r = publica(erro.corpo, erro.status);
            if (erro.esperarSegundos !== undefined) r.headers.set('Retry-After', String(erro.esperarSegundos));
            return r;
          }
          throw erro;
        }
      }
      if (!aprovacaoPublica) return naoExiste();
      const [, token, chamadaId, acao] = aprovacaoPublica;
      if (!tokenTemFormato(token)) return naoExiste();
      const escrita = acao !== undefined;
      if (request.method !== (escrita ? 'POST' : 'GET')) return naoExiste();

      try {
        const corpo = escrita ? await lerCorpoPublico(request, url.origin) : {};
        const hash = await hashDoToken(token);
        await conferirLimitePublico(sql, escrita ? 'write' : 'read', hash, clientIp(request));

        if (!chamadaId) return publica(await lerPaginaPublica(sql, hash), 200);
        if (!acao) return publica({ ok: true, chamada: await lerChamadaPublica(sql, hash, chamadaId) }, 200);
        if (acao === 'comentarios') {
          return publica({ ok: true, comentario: await comentarComoCliente(sql, hash, chamadaId, corpo) }, 201);
        }
        const decisao = acao === 'aprovar' ? 'approve' : 'reject';
        return publica({ ok: true, chamada: await decidirComoCliente(sql, hash, chamadaId, decisao, corpo) }, 200);
      } catch (erro) {
        if (erro instanceof RecusaPublica) {
          if (erro.status !== 404) log(`aprovação pública recusada em ${rota}: ${erro.status} ${erro.message}`);
          const r = publica(erro.corpo, erro.status);
          if (erro.esperarSegundos !== undefined) r.headers.set('Retry-After', String(erro.esperarSegundos));
          return r;
        }
        throw erro;
      }
    }

    // Ligar/desligar e ler o estado da aprovação do cliente. Só admin (403 no
    // módulo); fora do alcance é 404 (política `clients_select`).
    const aprovacaoDoCliente = caminho.match(/^\/clients\/([0-9a-f-]{36})\/approval$/i);
    if (aprovacaoDoCliente && (request.method === 'GET' || request.method === 'POST')) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      if (request.method === 'GET') {
        return json({ ok: true, approval: await lerAprovacaoDoCliente(sql, sessao.actor, aprovacaoDoCliente[1]) });
      }
      // Quem não administra ouve 403 antes de o corpo ser lido (F42, Fase 4).
      if (!sessao.actor.isSuperadmin) return json({ message: FRASE_SO_ADMIN_APROVACAO }, 403);
      const body = (await request.json().catch(() => ({}))) as { enabled?: unknown };
      if (typeof body.enabled !== 'boolean') {
        return json({ message: 'Diga se a aprovação externa fica ligada (enabled: true ou false).' }, 400);
      }
      return json({
        ok: true,
        approval: await ligarAprovacao(sql, sessao.actor, aprovacaoDoCliente[1], body.enabled),
      });
    }

    // O link: GET copia (decifra no Worker e devolve a URL), POST gera um novo
    // (revoga o vivo na mesma transação), DELETE só revoga.
    const linkDoCliente = caminho.match(/^\/clients\/([0-9a-f-]{36})\/approval\/link$/i);
    if (linkDoCliente && ['GET', 'POST', 'DELETE'].includes(request.method)) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      const clientId = linkDoCliente[1].toLowerCase();
      if (request.method === 'DELETE') {
        return json({ ok: true, ...(await revogarLinkDoCliente(sql, sessao.actor, clientId)) });
      }
      // A chave só é lida por quem administra: a 403 vem antes da 503.
      if (!sessao.actor.isSuperadmin) return json({ message: FRASE_SO_ADMIN_APROVACAO }, 403);
      const chave = await chaveDoAmbiente(env as unknown as Record<string, unknown>);
      if (request.method === 'GET') {
        const guardado = await lerCifraDoLink(sql, sessao.actor, clientId);
        const token = await decifrarToken(guardado.cifrado, chave, clientId);
        return json({ ok: true, url: enderecoDoLink(url.origin, token), createdAt: guardado.createdAt });
      }
      const gerado = await gerarLinkDoCliente(sql, sessao.actor, clientId, async () => {
        const token = gerarToken();
        return { token, hash: await hashDoToken(token), cifrado: await cifrarToken(token, chave, clientId) };
      });
      return json(
        { ok: true, url: enderecoDoLink(url.origin, gerado.token), createdAt: gerado.createdAt, revoked: gerado.revoked },
        201,
      );
    }

    // --- as chaves do dia a dia -------------------------------------------
    const chaves = caminho.match(/^\/clients\/([0-9a-f-]{36})\/flags$/i);
    if (request.method === 'POST' && chaves) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const body = (await request.json().catch(() => ({}))) as {
        urgency?: 'paz' | 'alerta' | 'perigo';
        financeOk?: boolean;
      };
      // Valor fora do vocabulário é recusa, não `default` silencioso. Regra 3
      // do roteiro: falhar alto. O enum do banco recusaria de qualquer jeito,
      // mas com uma mensagem que ninguém entende.
      if (body.urgency !== undefined && !['paz', 'alerta', 'perigo'].includes(body.urgency)) {
        return json({ message: `Urgência desconhecida: "${body.urgency}".` }, 400);
      }
      // O mesmo para o financeiro: texto aqui ia ao `::boolean` do banco e voltava 500.
      if (body.financeOk !== undefined && typeof body.financeOk !== 'boolean') {
        return json({ message: 'Informe o financeiro como verdadeiro ou falso.' }, 400);
      }

      await setClientFlags(sql, sessao.actor, chaves[1], body);
      return json({ ok: true });
    }

    if (request.method === 'DELETE' && editar) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      await deleteClient(sql, sessao.actor, editar[1]);
      return json({ ok: true });
    }

    const ligar = caminho.match(/^\/clients\/([0-9a-f-]{36})\/active$/i);
    if (request.method === 'POST' && ligar) {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);

      const body = (await request.json().catch(() => ({}))) as { active?: boolean };
      if (typeof body.active !== 'boolean') {
        return json({ message: 'Informe se o cliente fica ativo.' }, 400);
      }

      await setClientActive(sql, sessao.actor, ligar[1], body.active);
      return json({ ok: true });
    }

    // --- ativação ---------------------------------------------------------
    if (rota === 'POST /auth/activate') {
      const body = (await request.json().catch(() => ({}))) as {
        email?: string;
        code?: string;
        password?: string;
        nome?: string;
      };
      if (
        typeof body.email !== 'string' ||
        typeof body.code !== 'string' ||
        typeof body.password !== 'string' ||
        !body.email ||
        !body.code ||
        !body.password
      ) {
        return json({ message: 'e-mail ou código inválido, ou expirado' }, 400);
      }

      /**
       * O NOME AQUI NÃO É OBRIGATÓRIO — F17.29, e é de propósito.
       *
       * Quem convida é que responde pelo nome estar lá. Cobrá-lo também aqui
       * trancaria a porta de quem tem convite criado ANTES desta etapa, que
       * não tem sugestão nenhuma para mostrar — uma ausência antiga viraria
       * parede para quem não fez nada.
       *
       * Vazio não é perda: o banco cai na sugestão guardada no convite.
       */
      const nomeEscolhido = normalizeName(body.nome);
      if (nomeEscolhido.length > NAME_MAX_LENGTH) {
        return json({ message: NAME_TOO_LONG }, 400);
      }

      // A ORIGEM ENTRA AQUI — F17.53. O teto de `activation` tem dois lados,
      // por endereço e por origem, e sem `clientIp` o segundo nunca era
      // consultado. É o mesmo `clientIp(request)` que o login já usava.
      const ports = activationPorts(sql, provider, log, clientIp(request));
      const resultado = await decideActivation(
        { email: body.email, code: body.code, password: body.password },
        ports,
      );

      if (!resultado.ok) {
        // Só o código errado avança o contador do convite. Punir os outros
        // casos deixaria um convite legítimo travável por terceiro.
        if (resultado.countsAgainstInvitation) {
          /**
           * ⚠️ A INTENÇÃO ENTRA NO `where` — achado A10 da auditoria de
           * 2026-09-01, corrigido na F17.53.
           *
           * Sem ela, um código errado digitado NA ATIVAÇÃO queimava também o
           * contador de um código de REDEFINIÇÃO pendente do mesmo endereço,
           * e aos dez erros o revogava. A pessoa pedia a senha nova, um
           * terceiro errava a ativação, e o código dela morria sem que
           * ninguém conseguisse explicar por quê.
           *
           * A rota de redefinição sempre filtrou (`and purpose = 'reset'`);
           * esta não filtrava. A lista é a mesma que `ACTIVATION_PURPOSES`
           * confere na decisão — F17.39.
           */
          await withActor(sql, { kind: 'preauth' }, async (tx) => {
            await tx`
              update ideworks.invitations
                 set failed_attempts = failed_attempts + 1,
                     status = case when failed_attempts + 1 >= ${MAX_FAILED_ATTEMPTS}
                                   then 'revoked'::ideworks.invitation_status
                                   else status end
               where lower(email) = ${body.email!.trim().toLowerCase()}
                 and status = 'pending'
                 -- A10: so convite que ATIVA. Ver a nota acima.
                 and purpose in ('invite', 'invite_with_password')`;
          });
        }
        return json({ message: resultado.message }, 400);
      }

      // A conta existe no provedor, mas ainda não tem perfil no IDE Works — e
      // sem perfil ninguém entra (é a regra que barra as contas do sistema
      // legado). Criar o perfil sob a autoridade de QUEM CONVIDOU é o que
      // fecha o ciclo: foi ele quem decidiu dar acesso.
      const convite = await withActor(sql, { kind: 'preauth' }, async (tx) => {
        const linhas = await tx`
          select created_by from ideworks.invitations where id = ${resultado.invitationId}`;
        return linhas[0]?.created_by as string | null;
      });

      if (!convite) {
        log(`convite ${resultado.invitationId} sem autor: perfil não criado`);
        return json({ message: 'e-mail ou código inválido, ou expirado' }, 400);
      }

      /**
       * DE QUEM É A CONTA QUE VAI RECEBER O CONVITE — os três caminhos.
       *
       * CONTA NOVA: ela acabou de nascer com a senha que a pessoa escolheu,
       * então conferir a senha devolve a identidade e de quebra prova que a
       * conta ficou de pé.
       *
       * ⚠️ CONTA QUE JÁ EXISTIA, CONVITE COMUM (F17.30): a senha dela NÃO É
       * NOSSA, e não se confere o que não se sabe. A identidade vem do
       * cadastro, pela função que só responde a quem já provou ter o código —
       * e a senha digitada no formulário é descartada aqui, sem chegar a
       * lugar nenhum.
       *
       * ⚠️ CONTA QUE JÁ EXISTIA, CONVITE QUE DEFINE A SENHA (F17.39): a
       * autorização vem de `find_invite_account`, que só responde sobre a
       * intenção nova. Nulo ali é o fim do caminho — é assim que um convite
       * comum continua sem conseguir trocar a senha de ninguém.
       *
       * Repetir a linha do `verifyPasswordWithProvider` nos dois ramos de
       * conta existente não daria "não confere": daria a senha de outra
       * pessoa sendo testada contra a conta dela. Eles existem para que essa
       * linha nunca seja escrita.
       */
      let userId: string;
      if (resultado.alreadyExisted && resultado.definesPassword) {
        const autorizada = await findInviteAccountId(
          sql,
          resultado.email,
          resultado.invitationId,
        );
        if (!autorizada) {
          // A decisão disse que este convite define a senha e a porta do
          // banco não autorizou. Não há caminho seguro à frente, e a frase é
          // a genérica: um erro específico aqui diria que o código valia.
          log(`convite sem autorização para definir senha em ${resultado.email}`);
          return json({ message: GENERIC_REFUSAL }, 400);
        }

        /**
         * A SENHA É ESCRITA ANTES DE O CÓDIGO SER GASTO, e a ordem é a mesma
         * da F17.31, pelo mesmo motivo: recusada a senha, a pessoa já provou
         * ter o código, e queimá-lo a deixaria trancada com um código morto
         * na mão. `aplicar_convite`, logo abaixo, é quem o gasta.
         */
        const escrita = await setPasswordWithProvider(
          provider,
          autorizada,
          resultado.email,
          body.password,
          log,
        );
        if (!escrita.ok) return json({ message: escrita.message }, 400);

        userId = autorizada;
      } else if (resultado.alreadyExisted) {
        const existente = await findExistingAccountId(sql, resultado.email);
        if (!existente) {
          // O cadastro disse que o endereço tem dono e a função não achou
          // ninguém. Não há caminho seguro à frente: seguir criaria perfil
          // para um identificador inventado.
          log(`conta já existente não pôde ser resolvida para ${resultado.email}`);
          return json({ message: 'Não foi possível concluir. Tente de novo.' }, 500);
        }
        userId = existente;
      } else {
        const credenciais = await verifyPasswordWithProvider(
          provider,
          resultado.email,
          body.password,
        );
        if (!credenciais.ok) {
          log('conta criada mas o provedor não devolveu identidade');
          return json({ message: 'Não foi possível concluir. Tente de novo.' }, 500);
        }
        userId = credenciais.userId;
      }

      await withActor(
        sql,
        { kind: 'user', userId: convite, isSuperadmin: true, isSuper: true },
        async (tx) => {
          // TUDO O QUE O CONVITE PROMETEU, NUMA TRANSAÇÃO SÓ — F14d, e o
          // nome desde a F17.29.
          //
          // Perfil, nome, empresa, áreas e papel nascem juntos ou não
          // nascem. Aplicar metade deixaria a pessoa DENTRO com acesso que
          // ninguém escolheu, e ninguém iria conferir depois — ela já
          // entrou. O nome na mesma transação da senha é o mesmo motivo:
          // um passo separado é um passo que falha sozinho.
          //
          // A mesma chamada serve aos dois caminhos: ela já recebia o
          // identificador de fora, e o `on conflict (id)` dela é justamente o
          // que cobre quem já tinha conta.
          await tx`
            select ideworks.aplicar_convite(
              ${userId}, ${resultado.email}, ${resultado.invitationId},
              ${nomeEscolhido === '' ? null : nomeEscolhido})`;

          // O registro separa nascer de ser vinculado. São fatos diferentes:
          // um criou conta no cadastro compartilhado, o outro só deu acesso a
          // quem já entrava por ele — e quem auditar depois precisa saber
          // qual dos dois aconteceu.
          await tx`
            insert into ideworks.admin_audit
              (actor_id, actor_email, action, target_id, target_email)
            values (${convite}, 'sistema',
                    ${resultado.alreadyExisted ? 'account_linked' : 'account_created'},
                    ${userId}, ${resultado.email})`;
        },
      );

      return json({
        ok: true,
        email: resultado.email,
        // A TELA DIZ COISAS DIFERENTES CONFORME A SENHA TENHA VALIDO OU NÃO.
        //
        // É o único fato que muda o que a pessoa faz a seguir, e a esta
        // altura ele já é fato: se a senha ia ser definida e o provedor a
        // recusou, o caminho acima já respondeu 400 e nem chegou aqui.
        senhaDefinida: resultado.definesPassword,
      });
    }


    /* --- a senha nova, por quem tem o código (F17.31) --------------------- */
    /**
     * ⚠️ ESTE É O ÚNICO CAMINHO DO PROJETO QUE ESCREVE SENHA DE ALGUÉM, e o
     * cadastro é o do Sistema IDE em produção. Ele está escrito para que um
     * código de CONVITE não consiga percorrê-lo, e não por cuidado de quem o
     * lê depois:
     *
     *   · `resetRedeemPorts.findPendingReset` só enxerga linha de intenção
     *     `reset` — um código de convite não é sequer encontrado aqui;
     *   · `decideResetRedeem` confere a intenção outra vez, antes do código;
     *   · `ideworks.find_reset_account` é a ÚNICA fonte do identificador da
     *     conta, e só responde sobre linha `reset`, pendente e no prazo.
     *
     *   Sem identificador não há chamada ao provedor. A porta não tem
     *   permissão de trocar senha por convite — não é que ela se contenha.
     *
     * A RECUSA É A MESMA FRASE DA ATIVAÇÃO, sempre. Dizer "não há código para
     * este e-mail" numa hora e "código errado" noutra entregaria quais
     * endereços têm conta a quem só digitasse endereços.
     *
     * O REGISTRO DA REDEFINIÇÃO NÃO É ESCRITO AQUI, e não é esquecimento: a
     * janela de pré-autenticação não tem ator declarado, e a política de
     * `admin_audit` recusa linha sem autor — com razão. O rastro é gravado na
     * emissão, que é o ato administrativo; o que fica deste lado é a hora em
     * que o código foi gasto, na própria linha.
     */
    if (rota === 'POST /auth/reset-password') {
      const body = (await request.json().catch(() => ({}))) as {
        email?: string;
        code?: string;
        password?: string;
      };
      if (
        typeof body.email !== 'string' ||
        typeof body.code !== 'string' ||
        typeof body.password !== 'string' ||
        !body.email ||
        !body.code ||
        !body.password
      ) {
        return json({ message: GENERIC_REFUSAL }, 400);
      }

      const alvo = body.email.trim().toLowerCase();
      const decisao = await decideResetRedeem(
        { email: body.email, code: body.code, password: body.password },
        // A origem entra aqui pelo mesmo motivo da ativação — F17.53. E o
        // teto que as duas portas consultam é o mesmo, então uma tentativa
        // gasta aqui encurta o da ativação, e vice-versa.
        resetRedeemPorts(sql, log, clientIp(request)),
      );

      if (!decisao.ok) {
        // Só o código errado avança o contador — e só o contador do código de
        // senha daquele endereço. Punir o convite pendente de alguém por um
        // erro digitado nesta porta travaria o acesso de quem nem chegou aqui.
        if (decisao.countsAgainstInvitation) {
          await withActor(sql, { kind: 'preauth' }, async (tx) => {
            await tx`
              update ideworks.invitations
                 set failed_attempts = failed_attempts + 1,
                     status = case when failed_attempts + 1 >= ${MAX_FAILED_ATTEMPTS}
                                   then 'revoked'::ideworks.invitation_status
                                   else status end
               where lower(email) = ${alvo}
                 and status = 'pending'
                 and purpose = 'reset'`;
          });
        }
        log(`redefinição recusada: ${decisao.reason}`);
        return json({ message: decisao.message }, 400);
      }

      const conta = await findResetAccountId(sql, decisao.email, decisao.invitationId);
      if (!conta) {
        // O código valia e não há conta para ele. Não há caminho seguro à
        // frente, e a frase é a genérica: um erro específico aqui diria que o
        // código estava certo.
        log(`código de senha válido sem conta correspondente para ${decisao.email}`);
        return json({ message: GENERIC_REFUSAL }, 400);
      }

      const escrita = await setPasswordWithProvider(
        provider,
        conta,
        decisao.email,
        body.password,
        log,
      );
      if (!escrita.ok) {
        // O código NÃO é gasto: a pessoa já provou que o tem, e queimá-lo por
        // uma senha fraca a deixaria trancada com um código morto na mão.
        return json({ message: escrita.message }, 400);
      }

      // Gasto só agora, e depois de a senha ter trocado de verdade. A ordem
      // inversa perderia o código no dia em que o provedor recusasse.
      await withActor(sql, { kind: 'preauth' }, async (tx) => {
        await tx`
          update ideworks.invitations
             set status = 'used', used_at = now()
           where id = ${decisao.invitationId} and status = 'pending' and purpose = 'reset'`;
      });

      return json({ ok: true, email: decisao.email });
    }

    // --- convite (administração) ------------------------------------------
    // Rota administrativa: exige crachá. Enquanto a sessão própria não existe,
    // ela recusa — e recusar é o comportamento seguro.
    if (rota === 'POST /admin/invitations') {
      const sessao = await resolveActor(request, sql, provider, caminho);
      if (!sessao.ok) return json({ message: sessao.message }, sessao.status);
      if (!sessao.actor.isSuperadmin) {
        return json({ message: 'Só administrador convida.' }, 403);
      }

      const corpoConvite = (await request.json().catch(() => ({}))) as {
        email?: string;
        nome?: unknown;
        actorId?: string;
        empresas?: unknown;
        areas?: unknown;
        papel?: unknown;
      };
      // Quem convida é quem está com o crachá. `actorId` no corpo era o
      // caminho de antes, quando a rota não exigia sessão — e um id de outra
      // pessoa no corpo faria o convite sair no nome dela.
      const body = {
        email: corpoConvite.email,
        actorId: sessao.actor.userId,
      };
      if (!body.email) {
        return json({ message: 'Informe o e-mail de quem será convidado.' }, 400);
      }

      /**
       * O NOME É EXIGIDO AQUI, E SÓ AQUI — F17.29.
       *
       * Quem convida sabe quem está convidando, e este é o único momento em
       * que o vazio ainda pode ser impedido de graça: depois a pessoa já
       * entrou, e ninguém volta para conferir por que ela aparece como
       * `atendimento@…` na lista de responsáveis.
       *
       * A mesma conferência roda na tela. Não é redundância: a tela avisa
       * antes de enviar, e aqui se recusa porque um POST montado à mão não
       * passa por tela nenhuma.
       */
      const nome = checkInvitedName(corpoConvite.nome);
      if (!nome.ok) return json({ message: nome.message }, 400);
      if (provider.testAccountsOnly) assertTestAccount(body.email, provider.allowedAccounts ?? '');

      /**
       * O ACESSO É DECIDIDO AQUI, E NÃO DEPOIS — F14d.
       *
       * Antes: convidava-se, a pessoa ativava, e só então alguém abria a
       * ficha dela para dizer empresa e áreas. Entre uma coisa e outra ela já
       * estava dentro, com o padrão. Decisão separada do ato é decisão que
       * alguém esquece.
       */
      const empresas = Array.isArray(corpoConvite.empresas)
        ? corpoConvite.empresas.filter(
            (e): e is string => typeof e === 'string' && /^[0-9a-f-]{36}$/i.test(e),
          )
        : [];
      const areasPedidas = Array.isArray(corpoConvite.areas)
        ? corpoConvite.areas.filter((a): a is Area => AREAS.includes(a as Area))
        : [];
      const papelPedido: Papel = PAPEIS.includes(corpoConvite.papel as Papel)
        ? (corpoConvite.papel as Papel)
        : 'funcionario';

      /**
       * QUEM PODE PROMETER O QUÊ.
       *
       * `set_user_role` exige super admin para criar outro super admin. Sem
       * repetir a trava aqui, o convite viraria o caminho de contorná-la:
       * bastaria convidar em vez de editar.
       */
      if (papelPedido === 'super_admin' && !sessao.actor.isSuper) {
        return json({ message: 'Só o super admin cria outro super admin.' }, 403);
      }

      const code = generateCode();
      const hash = await hashCode(code);
      const prazo = expiresAt();

      const podeProm = await withActor(
        sql,
        {
          kind: 'user',
          userId: body.actorId,
          isSuperadmin: true,
          isSuper: sessao.actor.isSuper,
        },
        async (tx) => {
          /**
           * A EMPRESA PROMETIDA, CONFERIDA ANTES — F17.36c.
           *
           * A trava de verdade é a política de escrita da tabela, e ela vale
           * mesmo que esta linha suma. O que se ganha aqui é a FRASE: barrado
           * pela política, o pedido volta como violação de regra de linha, que
           * não diz a ninguém o que fazer a seguir.
           *
           * A pergunta é a mesma dos outros dois lugares, e é feita ao banco —
           * escrevê-la aqui em JavaScript criaria uma segunda verdade.
           */
          const [r] = await tx`
            select ideworks.can_grant_categories(${empresas}::uuid[]) as pode`;
          if (r.pode !== true) return false;

          /**
           * ⚠️ A INTENÇÃO DO CONVITE É DECIDIDA PELO BANCO, DENTRO DESTE
           * `insert` — F17.39.
           *
           * Das 30 pessoas do sistema legado, as 30 têm conta de login. Para
           * elas o convite nasce `invite_with_password`, e a senha que a
           * pessoa escolher na ativação passa a valer; para quem não tem
           * conta ele nasce `invite`, e o caminho é o de sempre.
           *
           * A resposta é consumida AQUI e não volta para esta rota: ela
           * escreve o valor sem nunca tê-lo em mãos. Se a tela de quem
           * convida soubesse, ela viraria um oráculo para administrador
           * descobrir quem tem conta fora da própria empresa — justo depois
           * de a F17.34 ter fechado isso. Quem vê a diferença é só quem
           * ativa.
           */
          await tx`
            insert into ideworks.invitations
              (email, full_name, code_hash, expires_at, created_by, categories, areas, role,
               purpose)
            values (${body.email!.trim().toLowerCase()}, ${nome.value}, ${hash}, ${prazo},
                    ${body.actorId!},
                    ${empresas}::uuid[],
                    ${areasPedidas}::ideworks.area[],
                    ${papelPedido}::ideworks.papel,
                    ideworks.purpose_for_new_invitation(${body.email!.trim().toLowerCase()}))`;
          return true;
        },
      );

      if (!podeProm) {
        return json(
          { message: 'Você só pode dar acesso às empresas de que participa.' },
          403,
        );
      }

      // O código volta UMA vez. Depois disto ele não existe em lugar nenhum —
      // o banco guarda só a impressão digital.
      return json({ ok: true, code, expiresAt: prazo.toISOString() });
    }

    return json({ message: 'Rota não encontrada.' }, 404);
  } catch (error) {
    // O TEXTO INTERNO DO POSTGRES NÃO SAI. Toda recusa com status traz a frase do
    // banco; as que ele escreve para gente passam inteiras, mas a política de
    // linha e o `grant` que falta falam em inglês, com nome de tabela, de função
    // e de restrição (ver `frasePublicaDaRecusa`). Troca-se aqui, num lugar só,
    // em vez de em cada um dos catorze `traduzir` — que repassam `e.message`.
    if (error instanceof Error && typeof (error as { status?: unknown }).status === 'number') {
      const publica = frasePublicaDaRecusa(error.message);
      if (publica !== error.message) {
        log(`recusa do banco em ${rota}: ${error.message}`);
        error.message = publica;
      }
    }

    // Recusa de escrita já vem traduzida e com o código certo. Cair no 500
    // abaixo faria "só administrador cadastra cliente" — que é a regra
    // funcionando — parecer defeito do servidor.
    // F42, Fase 3: a configuração da aprovação recusa com status e frase; a
    // chave ausente é configuração do servidor (503, nomeando o segredo); a
    // cifra que não abre pede gerar um link novo (409).
    if (error instanceof AprovacaoRecusada) {
      log(`aprovação do cliente recusada em ${rota}: ${error.message}`);
      return json({ message: error.message }, error.status);
    }
    if (error instanceof ChaveDoLinkAusente) {
      log(`aprovação do cliente sem chave em ${rota}: ${error.message}`);
      return json({ message: error.message }, 503);
    }
    if (error instanceof CifraInvalida) {
      log(`link de aprovação não decifrou em ${rota}`);
      return json({ message: error.message }, 409);
    }

    if (error instanceof RelatorioRefused) {
      log(`relatório recusado em ${rota}: ${error.message}`);
      return json({ message: error.message }, error.status);
    }

    if (error instanceof ContaRefused) {
      log(`conta da Meta recusada em ${rota}: ${error.message}`);
      return json({ message: error.message }, error.status);
    }

    // A frase vem do BANCO e chega inteira à tela. "Você não pode tirar o
    // próprio papel de administrador" só é útil se a pessoa a ler — trocar
    // por "sem permissão" apagaria justamente o que ela precisa entender.
    if (error instanceof PessoaRefused) {
      log(`administração de pessoas recusada em ${rota}: ${error.message}`);
      return json({ message: error.message }, error.status);
    }

    if (error instanceof ConexaoRefused) {
      log(`conexão recusada em ${rota}: ${error.message}`);
      return json({ message: error.message }, error.status);
    }

    if (error instanceof CatalogoRefused) {
      log(`catálogo recusado em ${rota}: ${error.message}`);
      return json({ message: error.message }, error.status);
    }

    if (error instanceof MuralRefused) {
      log(`mural/captação recusado em ${rota}: ${error.message}`);
      return json({ message: error.message }, error.status);
    }

    if (error instanceof HistoryRefused) {
      log(`histórico recusado em ${rota}: ${error.message}`);
      return json({ message: error.message }, error.status);
    }

    if (error instanceof TaskRefused) {
      log(`demanda recusada em ${rota}: ${error.message}`);
      return json({ message: error.message }, error.status);
    }

    // A recusa do quadro sai com a FRASE DO BANCO. As dez travas da F17 dizem
    // o que está no caminho e o que fazer; trocá-las por "algo deu errado"
    // jogaria fora exatamente o trabalho delas.
    if (error instanceof BoardRefused) {
      log(`quadro recusado em ${rota}: ${error.message}`);
      // A F17.19 acrescentou UMA recusa que a tela não mostra: ela pergunta.
      // Os nomes das etapas sem destino viajam junto para o seletor poder ser
      // montado — sem eles a tela teria de adivinhar quais são.
      const semDestino =
        error instanceof PrecisaDeDestino ? { semDestino: error.semDestino } : {};
      const escolha = error instanceof MoveNeedsStatus
        ? { escolhaDeEtapa: error.escolhaDeEtapa } : {};
      // F40: a recusa do tipo diz o código e as quatro opções.
      const tipo = error instanceof TypeRequired
        ? { code: error.code, options: error.options } : {};
      // F40, Fase 6: a recusa de liberar também diz o código.
      const liberar = error instanceof LiberarRecusado ? { code: error.code } : {};
      return json({ message: error.message, ...semDestino, ...escolha, ...tipo, ...liberar }, error.status);
    }

    if (error instanceof ChatRefused) {
      log(`chat recusado em ${rota}: ${error.message}`);
      return json({ message: error.message }, error.status);
    }

    if (error instanceof WriteRefused) {
      log(`escrita recusada em ${rota}: ${error.message}`);
      return json({ message: error.message }, error.status);
    }

    // Recusa deliberada não é falha do servidor. Antes desta separação, a
    // trava de conta de teste — funcionando corretamente — devolvia 500
    // genérico, e quem chamasse acharia que o sistema quebrou em vez de
    // entender que foi barrado de propósito.
    if (
      error instanceof Error &&
      (error.name === 'RealAccountRefused' || error.name === 'ConfigError')
    ) {
      log(`recusa deliberada em ${rota}: ${error.message}`);
      return json({ message: error.message }, 400);
    }

    // PEDIDO TORTO QUE SÓ O POSTGRES ENXERGOU É 400, e não falha do servidor.
    // Texto que não é uuid, data que não existe, valor fora do enum ou grande
    // demais para a coluna: quem mandou errou, e repetir o mesmo pedido não
    // adianta. Cada módulo conferia o seu campo e esquecia outros; esta rede
    // pega o que sobrou, sem repetir o texto do banco (nome de tipo e valor).
    // A conexão que caiu, a permissão que faltou e o resto seguem como 500.
    const codigoDoBanco = (error as { code?: unknown } | null)?.code;
    if (
      (typeof codigoDoBanco === 'string' && CODIGOS_DE_PEDIDO_TORTO.has(codigoDoBanco)) ||
      error instanceof URIError
    ) {
      log(`pedido torto em ${rota}`, error);
      return json({ message: FRASE_PEDIDO_TORTO }, 400);
    }

    log(`falha em ${rota}`, error);
    const falha = json({ message: 'Não foi possível concluir. Tente de novo.' }, 500);
    // A rota pública da aprovação (F42) carrega o token no endereço: nem a
    // falha pode vazá-lo por `Referer` ou cair em buscador.
    if (/^\/public\/aprovacao\//.test(caminho)) {
      falha.headers.set('Referrer-Policy', 'no-referrer');
      falha.headers.set('X-Robots-Tag', 'noindex, nofollow');
      falha.headers.set('Cache-Control', 'no-store');
    }
    return falha;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

/**
 * A REDE DE CONTENÇÃO DE ÚLTIMO NÍVEL DO WORKER — F23, incidente de 22/09/2026.
 *
 * POR QUE ELA EXISTE
 *   Em 22/09/2026 `add_comment` do MCP gravava o comentário e devolvia
 *   `502 Bad gateway` a quem chamou. O diagnóstico levou um dia inteiro para
 *   concluir que o defeito não era o 502: era NÃO EXISTIR `try/catch` de
 *   último nível em lugar nenhum. Um erro inesperado subia até a borda da
 *   Cloudflare, que desenha a própria página de erro — sem corpo JSON, sem
 *   `X-Request-Id`, sem o cabeçalho de medição. Não havia o que ler, e o
 *   agente, lendo 502, repetia a escrita que já tinha sido gravada.
 *
 *   `src/integrations/handler.ts` ganhou a rede do lado dos agentes. Esta é a
 *   do Worker inteiro: o site (ASSETS), a `/api` humana antes do `try` grande
 *   que ela já tem lá dentro, e o próprio despacho para a integração.
 *
 * O QUE ELA NÃO FAZ
 *   Não engole recusa nenhuma: o que responde com código próprio — 400, 401,
 *   403, 404, 503, 504 — já respondeu lá dentro e nunca chega aqui. A rede
 *   pega só o que hoje escaparia.
 *
 *   E não vaza detalhe interno: o cliente recebe uma frase e o id da
 *   requisição; pilha, SQL, token e cookie ficam no log — que o
 *   `[observability]` do `wrangler.toml` passou a guardar pelo mesmo motivo.
 */
function redeDeContencaoDoWorker(erro: unknown, request: Request): Response {
  const requestId = resolveRequestId(request);
  const caminho = (() => {
    try {
      // O token do link de aprovação (F42) é credencial: no log, mascarado.
      return new URL(request.url).pathname.replace(/^(\/api\/public\/aprovacao\/)[^/]+/, '$1:token');
    } catch {
      return '(url ilegível)';
    }
  })();
  // Caminho e método bastam para achar a chamada. A busca da URL NÃO entra:
  // `?q=` de uma busca é conteúdo de quem pesquisou.
  console.error(
    `[ide-works] falha inesperada em ${request.method} ${caminho} (request_id=${requestId})`,
    erro,
  );
  return withRequestId(
    json(
      {
        error: 'internal',
        message:
          'Falha inesperada no servidor. A operação pode não ter sido concluída — ' +
          'o id desta requisição identifica a ocorrência no registro.',
        requestId,
      },
      500,
    ),
    requestId,
  );
}

/**
 * `request.json()` que não devolve `null` — troca o método NA PRÓPRIA requisição.
 *
 * As rotas leem o corpo com `(await request.json().catch(() => ({})))` e depois
 * acessam `body.campo`: JSON inválido já cai em `{}` e vira a recusa da própria
 * rota ("Informe…", 400). Mas o JSON válido `null` não cai — é um `null`, e
 * `null.email` é um TypeError, que chegava ao cliente como 500 numa rota pública
 * de login. `null` passa a valer o mesmo que corpo ilegível: `{}`.
 *
 * É seguro porque as rotas que ESCREVEM exigem o campo dito (ver
 * `entradas-de-escrita.ts`): `{}` nunca vira "apague tudo". Se o ambiente não
 * deixar redefinir o método, o pedido segue como veio — o ganho some, nada quebra.
 */
function corpoJsonNuncaNulo(request: Request): void {
  try {
    // Só a API humana. A superfície de agentes (`/mcp`, OAuth, `/api/integrations`)
    // lê o corpo à sua maneira e tem o seu próprio contrato para `null`.
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith('/api') || isIntegrationPath(pathname)) return;

    Object.defineProperty(request, 'json', {
      configurable: true,
      writable: true,
      value: async (): Promise<unknown> => {
        // Lê até o teto — sem `Content-Length` (corpo em pedaços) a declaração
        // não vale, e quem conta é a leitura. Estourou: lança, e o
        // `.catch(() => ({}))` da rota o trata como corpo ilegível.
        const lido: unknown = JSON.parse(await lerTextoComTeto(request, tetoDoJson(pathname)));
        return lido === null ? {} : lido;
      },
    });
  } catch {
    /* fica como veio */
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx?: { waitUntil(promise: Promise<unknown>): void; props?: unknown },
  ): Promise<Response> {
    corpoJsonNuncaNulo(request);
    try {
      return await atenderRequisicao(request, env, ctx);
    } catch (erro) {
      return redeDeContencaoDoWorker(erro, request);
    }
  },

  /**
   * O gatilho de tempo da coleta — etapa F8.
   *
   * POR QUE ELE NÃO SILENCIA A FALHA
   *   Coleta perdida é dado perdido para sempre: a Meta guarda métrica de
   *   usuário por 90 dias e story por 24 horas. Um erro engolido aqui vira um
   *   buraco no histórico que ninguém consegue preencher depois.
   *
   *   Então tudo o que acontece vai para o log — e, mais importante, para
   *   `meta_collection_runs`, que é o livro que a tela lê. O log da Cloudflare
   *   expira; o livro não.
   *
   * SEM TOKEN, ELE REGISTRA E SAI
   *   Não tenta, não falha por "token inválido", e não deixa execução pendurada
   *   em `running`. Enquanto o token não existir, a mensagem diz exatamente
   *   isso.
   */
  async scheduled(evento: { cron: string }, env: Env): Promise<void> {
    const sql = connect(env);
    try {
      // A expiração das imagens independe das credenciais da coleta de métricas.
      try {
        const limpeza = await purgeExpiredAttachments(
          sql,
          {
            supabaseUrl: env.IDEWORKS_PUBLIC_SUPABASE_URL,
            serviceKey: env.IDEWORKS_SERVER_SUPABASE_SERVICE_KEY,
          },
          log,
        );
        log(`imagens temporárias: ${limpeza.removed} removidas, ${limpeza.failed} falhas`);
      } catch (erro) {
        log('limpeza de imagens temporárias falhou; nova tentativa no próximo cron', erro);
      }

      // As tabelas dos limitadores (agentes e login) — F44, Fase 7. UMA batida
      // por dia, a das 06:00 UTC; a janela vem dos tetos do código. Ver
      // `server/limpeza-dos-limitadores.ts`. Roda sem token da Meta, como as
      // outras limpezas, e a falha vira log: a coleta segue.
      if (ehBatidaDaLimpezaDiaria(instanteDaBatida(evento))) {
        try {
          const limpos = await limparLimitadores(sql);
          log(
            `limitadores: ${limpos.integracao} chamadas de agente e ` +
              `${limpos.tentativas} tentativas de login fora da janela apagadas`,
          );
        } catch (erro) {
          log('limpeza dos limitadores falhou; nova tentativa amanhã, na mesma batida', erro);
        }
      }

      // Mensagens do chat fora da janela de 30 dias — F20.3.
      // Lote e orçamento próprios; roda mesmo sem token da Meta e com a chave
      // do chat desligada (desligar esconde a superfície, não suspende retenção).
      try {
        const limpezaChat = await purgeExpiredChatMessages(
          sql,
          {
            supabaseUrl: env.IDEWORKS_PUBLIC_SUPABASE_URL,
            serviceKey: env.IDEWORKS_SERVER_SUPABASE_SERVICE_KEY,
          },
          log,
        );
        log(
          `mensagens do chat: ${limpezaChat.removed} removidas, ${limpezaChat.failed} falhas`,
        );
      } catch (erro) {
        log('limpeza de mensagens do chat falhou; nova tentativa no próximo cron', erro);
      }

      if (!haTokenDaMeta(env as unknown as Record<string, unknown>)) {
        log(`coleta não rodou (${evento.cron}): sem IDEWORKS_META_TOKEN nem IDEWORKS_META_TOKEN_<EMPRESA>.`);
        return;
      }
      // EM LOTE, e não tudo. O porquê está em `CONTAS_POR_EXECUCAO`: uma
      // varredura completa leva 12 minutos e encosta no teto de tempo do
      // gatilho. A fila roda sozinha pela conta visitada há mais tempo.
      const r = await coletar(
        sql,
        // Uma credencial POR EMPRESA (F7g). A conta cuja credencial não estiver
        // definida aqui falha com o nome do segredo que falta, em vez de cair
        // caladamente na credencial errada.
        credenciaisDoAmbiente(env as unknown as Record<string, unknown>),
        new Date(),
        CONTAS_POR_EXECUCAO,
        TETO_DE_TEMPO_MS,
      );
      log(
        `coleta ${r.desfecho}: ${r.ativosOk}/${r.ativosTotal} ativos, ` +
          `${r.linhasGravadas} linhas, janela ${r.janela.de}..${r.janela.ate}` +
          (r.interrompida ? ' (interrompida por limite de uso ou pelo relógio)' : '') +
          (r.primeiraFalha ? ` — primeira falha: ${r.primeiraFalha}` : ''),
      );
    } catch (erro) {
      // A execução pode ter ficado marcada como `running` se a falha veio antes
      // do fechamento. A tela mostra isso como execução que nunca terminou, que
      // é a verdade — melhor que fingir um desfecho.
      log('coleta falhou inteira', erro);
      throw erro;
    } finally {
      await sql.end({ timeout: 5 }).catch(() => {});
    }
  },
};
