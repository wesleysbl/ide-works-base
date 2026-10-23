/**
 * Orientação ao agente no MCP — o que a IA lê quando erra a chamada, quando
 * falta permissão e quando pergunta "o que eu posso fazer aqui?".
 *
 * POR QUE EXISTE
 *   O agente não vê o código: vê o texto da recusa. Três erros comuns saíam sem
 *   dizer o que fazer depois:
 *     1. Entrada inválida (enum errado, campo faltando). O SDK validava o schema
 *        ANTES do handler e devolvia um despejo em inglês do Zod
 *        ("Input validation error: Invalid arguments for tool …"), sem código.
 *        Agora a validação é nossa (`mcp.ts`), e a frase diz qual campo e o que
 *        vale — em português, com `invalid_input`.
 *     2. Permissão que a conexão não tem. A recusa de leitura era a mesma frase
 *        ("Fora do alcance desta integração.") para "falta a permissão X" e para
 *        "este id está fora do recorte". As duas continuam com o MESMO código
 *        (`permission_denied`) e a mesma verificação — aqui só se acrescenta a
 *        frase do que fazer. Saber QUAL permissão falta não revela nada de
 *        novo: o próprio `get_context` já lista as permissões da conexão.
 *     3. `get_context` dizia as permissões, mas não o que elas liberam.
 *
 * O QUE ESTE ARQUIVO NÃO FAZ
 *   Não decide acesso. Quem nega é `allowsOperation`/`decideAccess` e o recorte
 *   das leituras; esta tabela só EXPLICA uma negação que já aconteceu (e monta o
 *   texto do `get_context`). Se ela divergir do código, a recusa continua certa
 *   e a frase fica incompleta — por isso a suíte
 *   `mcp-contrato-ponta-a-ponta.test.ts` prende a tabela às 38 ferramentas.
 */

import type { z } from 'zod';

import type { IntegrationCapability } from '@/integrations/grants';

/** O que uma ferramenta exige da conexão. `todas` = todas juntas; `alguma` = basta uma. */
export type ExigenciaDaFerramenta = {
  todas?: readonly IntegrationCapability[];
  alguma?: readonly IntegrationCapability[];
  /** Só vale se quem conectou for administrador AGORA (relido a cada chamada). */
  admin?: true;
};

/**
 * As permissões de cada ferramenta, na ordem de `tools/list`. A chave é o nome
 * da ferramenta (`McpToolName`); um teste prende as duas listas iguais.
 */
export const EXIGENCIAS_DAS_FERRAMENTAS = {
  get_context: {},
  search: { alguma: ['boards:read', 'tasks:read', 'clients:read', 'people:read'] },
  get_board: { todas: ['boards:read'] },
  get_task: { todas: ['tasks:read'] },
  get_client: { todas: ['clients:read'] },
  list_people: { todas: ['people:read'] },
  get_person_work: { todas: ['people:read'] },
  list_comments: { todas: ['comments:read'] },
  get_delivery_report: { todas: ['reports:delivery:read'] },
  get_marketing_report: { todas: ['reports:marketing:read'] },
  get_client_mural: { todas: ['clients:read'] },
  get_client_history: { todas: ['clients:read'] },
  get_client_delivery_history: { todas: ['reports:delivery:read'] },
  get_delivery_trend: { todas: ['reports:delivery:read'] },
  get_workflow: { todas: ['boards:read'] },
  get_planning_weeks: { todas: ['reports:delivery:read'] },
  get_delivery_status: { todas: ['reports:delivery:read'] },
  get_admin_week: { todas: ['boards:read', 'tasks:read'], admin: true },
  get_month_attention: { todas: ['reports:delivery:read'] },
  get_client_month: { todas: ['reports:delivery:read'] },
  get_calendar: { todas: ['reports:delivery:read'] },
  list_tags: { todas: ['boards:read'] },
  list_clients: { todas: ['clients:read'] },
  list_boards: { todas: ['boards:read'] },
  list_tasks: { todas: ['tasks:read'] },
  add_comment: { todas: ['comments:write'] },
  preview_move: { todas: ['tasks:move'] },
  move_task: { todas: ['tasks:move'] },
  create_task: { todas: ['tasks:write'] },
  update_task: { todas: ['tasks:write'] },
  assign_task: { todas: ['tasks:assign'] },
  complete_task: { todas: ['tasks:complete'] },
  reopen_task: { todas: ['tasks:complete'] },
  add_mural_note: { todas: ['clients:mural:write'] },
  update_mural_note: { todas: ['clients:mural:write'] },
  add_history_entry: { todas: ['clients:history:write'] },
  update_history_entry: { todas: ['clients:history:write'] },
  release_task: { todas: ['tasks:assign', 'tasks:write', 'tasks:move'], admin: true },
} as const satisfies Record<string, ExigenciaDaFerramenta>;

export type FerramentaConhecida = keyof typeof EXIGENCIAS_DAS_FERRAMENTAS;

function exigenciaDe(ferramenta: string, args: unknown): ExigenciaDaFerramenta | null {
  if (!Object.prototype.hasOwnProperty.call(EXIGENCIAS_DAS_FERRAMENTAS, ferramenta)) return null;
  const base: ExigenciaDaFerramenta = EXIGENCIAS_DAS_FERRAMENTAS[ferramenta as FerramentaConhecida];
  // `search` com `kinds` pede a leitura de CADA tipo pedido (sem `kinds`, basta uma das quatro).
  if (ferramenta === 'search' && args !== null && typeof args === 'object') {
    const kinds = (args as Record<string, unknown>).kinds;
    if (Array.isArray(kinds) && kinds.length > 0) {
      const porTipo: Record<string, IntegrationCapability> = {
        board: 'boards:read',
        task: 'tasks:read',
        client: 'clients:read',
        person: 'people:read',
      };
      const caps = kinds.flatMap((kind) => (typeof kind === 'string' && porTipo[kind] ? [porTipo[kind]] : []));
      if (caps.length > 0) return { todas: caps };
    }
  }
  // `list_tasks` filtrando por pessoa (assigneeId/createdBy) lê nomes: pede people:read também.
  if (ferramenta === 'list_tasks' && args !== null && typeof args === 'object') {
    const pedido = args as Record<string, unknown>;
    if (pedido.assigneeId !== undefined || pedido.createdBy !== undefined) {
      return { ...base, todas: [...(base.todas ?? []), 'people:read'] };
    }
  }
  return base;
}

/** As permissões que a conexão NÃO tem e que a ferramenta (com estes argumentos) pede. */
export function permissoesQueFaltam(
  ferramenta: string,
  args: unknown,
  tem: ReadonlySet<string>,
): IntegrationCapability[] {
  const exigencia = exigenciaDe(ferramenta, args);
  if (!exigencia) return [];
  const faltam = (exigencia.todas ?? []).filter((cap) => !tem.has(cap));
  if (exigencia.alguma && !exigencia.alguma.some((cap) => tem.has(cap))) {
    return [...faltam, ...exigencia.alguma];
  }
  return faltam;
}

/* ───────────────────────── a recusa, com o que fazer ───────────────────────── */

const FRASE_GENERICA_DE_RECUSA = 'Fora do alcance desta integração.';

const COMO_AMPLIAR =
  'Peça a quem conectou para reconectar a IA marcando essa permissão (tela Conexões); get_context mostra as permissões atuais.';

const CONFERIR_O_ID =
  'Confira o id com search (ou list_boards, list_clients, list_people); get_context mostra o recorte desta conexão. ' +
  'Se ele deveria estar liberado, quem conectou precisa ampliar o alcance da conexão (tela Conexões).';

/**
 * Acrescenta à recusa o PRÓXIMO PASSO, sem trocar o código nem esconder a
 * frase original. Idempotente: uma frase que já orienta (cita `get_context` ou
 * "Peça a quem conectou") passa como veio.
 *
 * `permission_denied` tem duas causas que o código sempre tratou igual — falta a
 * permissão da ferramenta, ou o id está fora do recorte da conexão (ou não
 * existe). A frase agora diz qual das duas é, quando dá para saber pela tabela.
 */
export function orientarRecusa(input: {
  codigo: string;
  mensagem: string;
  ferramenta: string;
  args: unknown;
  /** As permissões efetivas da conexão agora (vazio = conexão inerte). */
  tem: ReadonlySet<string>;
}): string {
  const { codigo, mensagem, ferramenta, args, tem } = input;
  if (/get_context|Peça a quem conectou/.test(mensagem)) return mensagem;

  if (codigo === 'permission_denied') {
    const faltam = permissoesQueFaltam(ferramenta, args, tem);
    if (faltam.length > 0) {
      // A frase da escrita já nomeia a permissão ("… (tasks:write)"): só falta o que fazer.
      if (faltam.every((cap) => mensagem.includes(cap))) return `${mensagem} ${COMO_AMPLIAR}`;
      const rotulo = faltam.length === 1 ? 'a permissão' : 'as permissões';
      const original = mensagem === FRASE_GENERICA_DE_RECUSA ? '' : ` (${mensagem})`;
      return `Esta conexão não tem ${rotulo} ${faltam.join(', ')}, que ${ferramenta} exige. ${COMO_AMPLIAR}${original}`;
    }
    // Papel de administrador: a frase do próprio portão já explica; nada a somar.
    if (/administrador/.test(mensagem)) return mensagem;
    if (mensagem === FRASE_GENERICA_DE_RECUSA) {
      return `${mensagem} A conexão tem a permissão desta ferramenta; então o id não existe ou está fora das empresas e clientes liberados. ${CONFERIR_O_ID}`;
    }
    // Só a recusa de ALCANCE ganha "confira o id": a de regra (a IA só edita o que a IA escreveu)
    // já diz o que fazer, e mandar procurar outro id seria o conselho errado. A que já aponta a
    // ferramenta para achar o id (search, list_people…) não leva o conselho em dobro.
    if (/search|list_(boards|clients|people|tasks)/.test(mensagem)) return mensagem;
    return /recorte|alcance|concessão|não encontrad/.test(mensagem) ? `${mensagem} ${CONFERIR_O_ID}` : mensagem;
  }

  if (codigo === 'not_found') return `${mensagem} ${CONFERIR_O_ID}`;
  if (codigo === 'data_incomplete') {
    return `${mensagem} Peça menos itens (limit menor) ou filtre (clientId, month, período) e tente de novo.`;
  }
  return mensagem;
}

/* ───────────────────────── entrada inválida, em português ───────────────────────── */

function tipoEmPortugues(tipo: string): string {
  const nomes: Record<string, string> = {
    string: 'texto',
    number: 'número',
    integer: 'número inteiro',
    boolean: 'verdadeiro ou falso (true/false)',
    array: 'lista',
    object: 'objeto',
    null: 'nulo',
    undefined: 'vazio',
    date: 'data',
    nan: 'número inválido',
  };
  return nomes[tipo] ?? tipo;
}

function recortar(valor: unknown): string {
  const texto = JSON.stringify(valor);
  if (texto === undefined) return String(valor);
  return texto.length > 40 ? `${texto.slice(0, 37)}…` : texto;
}

/**
 * As frases padrão do Zod, em português. Mensagem escrita no schema
 * (`.regex(…, 'UUID inválido.')`) tem prioridade sobre o mapa e passa intacta —
 * é a regra do Zod, e é por isso que o mapa só cuida do que ficou sem frase.
 */
export const mapaDeErrosEmPortugues: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case 'invalid_type':
      if (issue.received === 'undefined') return { message: 'é obrigatório' };
      return { message: `deve ser ${tipoEmPortugues(issue.expected)}, mas veio ${tipoEmPortugues(issue.received)}` };
    case 'invalid_literal':
      return { message: `deve ser exatamente ${JSON.stringify(issue.expected)}` };
    case 'invalid_enum_value':
      return {
        message: `valor ${recortar(issue.received)} não existe; use um de: ${issue.options.map(String).join(', ')}`,
      };
    case 'unrecognized_keys':
      return { message: `campo(s) que esta ferramenta não aceita: ${issue.keys.join(', ')}` };
    case 'invalid_union':
      return { message: 'não bate com nenhum dos formatos aceitos' };
    case 'invalid_string':
      if (issue.validation === 'uuid') return { message: 'não é um UUID válido' };
      if (issue.validation === 'datetime') return { message: 'não é uma data e hora ISO válida' };
      return { message: 'tem formato inválido' };
    case 'too_small':
      if (issue.type === 'string') {
        return { message: issue.minimum === 1 ? 'não pode ser vazio' : `precisa de pelo menos ${issue.minimum} caractere(s)` };
      }
      if (issue.type === 'array') return { message: `precisa de pelo menos ${issue.minimum} item(ns)` };
      return { message: `precisa ser maior ou igual a ${issue.minimum}` };
    case 'too_big':
      if (issue.type === 'string') return { message: `passa de ${issue.maximum} caracteres` };
      if (issue.type === 'array') return { message: `aceita no máximo ${issue.maximum} item(ns)` };
      return { message: `precisa ser menor ou igual a ${issue.maximum}` };
    case 'not_finite':
      return { message: 'precisa ser um número finito' };
    default:
      return { message: ctx.defaultError };
  }
};

/** `from.listId`, `assigneeIds[0]` — o caminho do campo como o agente o escreveria. */
function caminhoDoCampo(caminho: ReadonlyArray<string | number>): string {
  let texto = '';
  for (const parte of caminho) {
    texto += typeof parte === 'number' ? `[${parte}]` : texto === '' ? parte : `.${parte}`;
  }
  return texto;
}

/**
 * Os problemas da entrada, um por frase, até três: `"statusType" valor "pronto"
 * não existe; use um de: …`. Vazio quando o erro não tem detalhe útil.
 */
export function detalharEntradaInvalida(error: z.ZodError): string {
  const frases: string[] = [];
  for (const issue of error.issues) {
    const campo = caminhoDoCampo(issue.path);
    // A frase escrita no schema ("UUID inválido.", "Use AAAA-MM-DD.") vem com ponto e inicial maiúscula:
    // entra depois de dois-pontos e sem o ponto, para o fim da frase não ficar com dois.
    const texto = issue.message.replace(/[.\s]+$/, '');
    const frase = campo === '' ? texto : /^\p{Lu}/u.test(texto) ? `"${campo}": ${texto}` : `"${campo}" ${texto}`;
    if (!frases.includes(frase)) frases.push(frase);
    if (frases.length === 3) break;
  }
  const mais = error.issues.length > frases.length ? ` (+${error.issues.length - frases.length})` : '';
  return frases.length === 0 ? '' : `Problema: ${frases.join('; ')}${mais}.`;
}

/* ───────────────────────── o texto de get_context ───────────────────────── */

/**
 * "O que eu posso fazer?" — em duas linhas, a partir das permissões efetivas:
 * as ferramentas que a conexão usa e as que pedem uma permissão que falta (com
 * a permissão ao lado). Admin só aparece como aviso: o papel é relido pelo
 * portão de cada ferramenta, e `get_context` não o expõe.
 */
export function ferramentasPelasPermissoes(tem: ReadonlySet<string>): { liberadas: string[]; bloqueadas: string[] } {
  const liberadas: string[] = [];
  const bloqueadas: string[] = [];
  for (const ferramenta of Object.keys(EXIGENCIAS_DAS_FERRAMENTAS)) {
    const faltam = permissoesQueFaltam(ferramenta, undefined, tem);
    const exigencia = EXIGENCIAS_DAS_FERRAMENTAS[ferramenta as FerramentaConhecida] as ExigenciaDaFerramenta;
    const sufixoAdmin = exigencia.admin ? ' (só admin)' : '';
    if (faltam.length === 0) liberadas.push(`${ferramenta}${sufixoAdmin}`);
    else bloqueadas.push(`${ferramenta} (${faltam.join(' + ')})`);
  }
  return { liberadas, bloqueadas };
}
