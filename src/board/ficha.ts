/**
 * A ficha da tarefa — a forma dela, e as contas puras. Etapa F17.10.
 *
 * O QUE ESTE ARQUIVO É
 *   Os tipos que atravessam servidor e tela, mais as poucas contas que não
 *   dependem de nada: o que mudou desde que a ficha abriu, o que falta para
 *   poder salvar, e como se escreve um instante.
 *
 * REGRA DE DOMÍNIO CONTINUA NÃO MORANDO AQUI
 *   Mesma regra de `board.ts`, e ela vale ainda mais nesta etapa, porque agora
 *   se ESCREVE. Quem pode criar, qual status a tarefa pode ter, quem entra como
 *   responsável, o que acontece com a conclusão ao trocar de coluna: tudo isso
 *   está no banco desde a F17.1..F17.3c, em `can_reach_task`,
 *   `task_status_guard`, `set_task_assignees`, `set_task_tags` e `move_task`.
 *
 *   Se aparecer aqui uma linha decidindo qualquer uma dessas coisas, é defeito.
 *   O que aparece é o contrário: `mudancas()` monta o pedido, e o servidor manda
 *   as ações do banco fazerem o trabalho.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A TRAVA DA ATRIBUIÇÃO, QUE A TELA PRECISA DIZER EM VOZ ALTA
 *
 *   `set_task_assignees` **ignora em silêncio** quem não tem perfil no IDE
 *   Works — decisão da F4.8, e ela está certa: atribuir a quem não entra no
 *   sistema é atribuir a ninguém.
 *
 *   Só que hoje há **8 perfis** aqui contra **35 membros** no ClickUp. O seletor
 *   vai listar oito pessoas, e não é defeito da tela: é o estado do sistema.
 *
 *   Duas consequências, e as duas estão implementadas:
 *     1. a tela DIZ que só aparece quem tem acesso ao IDE Works — esconder isso
 *        faria parecer que a equipe sumiu;
 *     2. depois de salvar, a ficha é RELIDA e mostra o que de fato ficou. Uma
 *        função que ignora sem falar só é honesta se quem a chama confere.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { BoardAssignee, BoardStatus, BoardTag, Priority } from '@/board/board';
// A entrega — F17.6. Mesma razão de `passos.ts`: a forma mora fora daqui
// porque o cartão do quadro também precisa da contagem, e ele não conhece
// `TaskDetail`.
import type { Anexo, Comentario, Link } from '@/board/conversa';
// O histórico da tarefa — F17.41 (a automação) e F17.65 (a mão).
import type { EventoDaTarefa } from '@/board/historico';
// Os passos da tarefa — F17.15. A forma mora em `passos.ts` porque o cartão do
// quadro também precisa da contagem, e ele não conhece `TaskDetail`.
import type { Checklist, Subtask, TaskProgress } from '@/board/passos';
// O selo de origem — F26.9: "Carla, via ChatGPT" no `Criada por`.
import { textoDoSeloDeOrigem } from '@/ui/selo-de-origem';

/* ───────────────────────────── a forma ───────────────────────────── */

export type TaskType = {
  id: string;
  /** O número do ClickUp — é ele que a tarefa carrega em `custom_item_id`. */
  customItemId: number;
  name: string;
};

export type TaskPerson = BoardAssignee;

/** O que a tarefa é, inteira — com a descrição, que o cartão do quadro não traz. */
export type TaskDetail = {
  id: string;
  title: string;
  description: string | null;

  listId: string | null;
  listName: string | null;
  /**
   * O id da pasta — acrescentado na F17.25.
   *
   * A ficha já trazia o NOME da pasta, e nome não navega: a trilha do topo
   * precisa abrir aquele nó na árvore do quadro, e nó se abre por id
   * (`folder:<id>`, a mesma chave que `@/ui/lugar` guarda). O valor já estava
   * na view `ideworks.tree`, de onde os outros quatro saem — nenhuma migration
   * foi precisa.
   */
  folderId: string | null;
  folderName: string | null;
  spaceId: string | null;
  spaceName: string | null;
  categoryName: string | null;

  statusId: string | null;
  priority: Priority | null;
  /** `YYYY-MM-DD` cru. O ano pode ter cinco dígitos — ver `board.ts`. */
  dueOn: string | null;
  startOn: string | null;

  customItemId: number | null;
  taskTypeId: string | null;
  taskTypeName: string | null;
  /** Verdadeiro quando o número aponta para tipo que não está no catálogo. */
  taskTypeMissing: boolean;
  /** O tipo da demanda (F40): `video | arte | foto | outros`; nulo = sem tipo. */
  type?: 'video' | 'arte' | 'foto' | 'outros' | null;
  /** A lista da tarefa é de produção (F40, Fase 4)? Nela o tipo não se apaga. Ausente = não. */
  listIsProduction?: boolean;

  clientId: string | null;
  clientName: string | null;
  /**
   * DE ONDE VEM O CLIENTE — F38, Fase 7.
   *
   * `clientId` acima é o cliente DA TAREFA pela regra única (o dela; na falta,
   * o da lista). Estes três dizem as duas pontas separadas, para o cartão
   * mostrar "da lista", "escolhido na tarefa" ou a diferença entre os dois
   * (tarefa movida de lista com o cliente escolhido). E a marca da lista diz
   * se o cliente é obrigatório. Ver `@/board/cliente-da-tarefa`.
   *
   * OPCIONAIS: ficha de antes da Fase 7 não os traz.
   */
  ownClientId?: string | null;
  listClientId?: string | null;
  listClientName?: string | null;
  listRequiresClient?: boolean;

  assignees: TaskPerson[];
  watchers: TaskPerson[];
  tags: BoardTag[];

  completedAt: string | null;
  completedBy: TaskPerson | null;
  archivedAt: string | null;
  createdBy: TaskPerson | null;
  /**
   * O nome da conexão de IA pela qual a tarefa foi CRIADA — F26, fase 9.
   *
   * `tasks.via_name`, gravado por gatilho a partir da sessão (F26.2) e imutável
   * depois: editar pela IA uma tarefa que uma pessoa criou não a torna "criada
   * via Claude". Nulo = criada por gente. Opcional porque a ficha de antes da
   * F26 não o trazia — ausente e nulo querem dizer o mesmo.
   */
  createdVia?: string | null;
  createdAt: string;
  updatedAt: string;

  /** A esteira da lista, resolvida pelo banco. Vazia quando a tarefa não está em lista. */
  statuses: BoardStatus[];
  statusSetName: string | null;
  inheritedFrom: 'list' | 'folder' | 'space' | null;

  /** O que existe no ESPAÇO da tarefa para escolher. Vazio quando não há lista. */
  availableTags: BoardTag[];
  availableTypes: TaskType[];

  /* --- os passos, F17.15 --------------------------------------------------- */

  /**
   * A mãe, quando esta tarefa é subtarefa.
   *
   * `parentTitle` vem por junção à esquerda em `tasks`, que tem política — mas
   * ela nunca sai nula na prática: a subtarefa mora na MESMA lista da mãe
   * (`tasks_parent_same_list_fk`), então quem alcança uma alcança a outra. Se um
   * dia sair nula, a tela mostra "subtarefa de uma tarefa fora do seu alcance"
   * em vez de esconder o vínculo.
   */
  parentId: string | null;
  parentTitle: string | null;

  /**
   * As filhas DIRETAS, incluindo as arquivadas.
   *
   * As arquivadas vêm porque a ficha precisa poder DIZER que existem — a
   * contagem de `progress` as exclui, e uma lista que também as omitisse faria
   * trabalho arquivado sumir sem deixar rastro.
   */
  subtasks: Subtask[];

  /** Os checklists da tarefa, com os itens achatados. Ver `passos.ts`. */
  checklists: Checklist[];

  /* --- a entrega, F17.6 ---------------------------------------------------- */

  /**
   * A conversa, ACHATADA — comentário e resposta na mesma lista.
   *
   * Quem monta os dois níveis é `aninharConversa`, que tem teste. Vir achatado
   * é o mesmo desenho de `checklists[].items` e de `buildTree`: uma consulta
   * só, e a forma se monta onde é possível prová-la.
   */
  comments: Comentario[];

  /**
   * Os arquivos. Aqui está só a FICHA de cada um — nome, tipo, tamanho, autor.
   *
   * Os bytes moram no balde privado `ideworks-anexos` e nunca atravessam esta
   * estrutura: a tela pede uma URL assinada, com prazo, quando alguém clica.
   */
  attachments: Anexo[];

  /** Os links externos, ao lado do anexo. Dropbox e Google Docs. */
  links: Link[];

  /* --- o histórico de movimentação, F17.41 + F17.65 ------------------------ */

  /**
   * O que já aconteceu com esta tarefa, DO MAIS ANTIGO PARA O MAIS RECENTE.
   *
   * ⚠️ ATÉ A F17.64 ISTO SE CHAMAVA `automationLog`, e o nome era verdade: só a
   * automação escrevia em `task_events`. Desde a F17.65 a mudança feita À MÃO
   * escreve na mesma tabela — quem trocou o status, quem tirou o responsável,
   * quem mudou a tarefa de lista —, e um campo chamado "registro da automação"
   * passaria a mentir sobre o próprio conteúdo.
   *
   * A ordem é CRESCENTE porque a linha do tempo mora dentro da conversa, cujo
   * campo de escrever fica no pé. Ver `@/board/historico`.
   *
   * Vazio em toda tarefa que ninguém mexeu depois da F17.65, e isso é o normal:
   * registro retroativo não se fabrica.
   */
  history: EventoDaTarefa[];

  /** O que `ideworks.task_progress` responde. A ÚNICA definição da contagem. */
  progress: TaskProgress;
};

/** O que a ficha manda de volta. Campo ausente = campo não mexido. */
export type TaskPatch = {
  title?: string;
  description?: string | null;
  dueOn?: string | null;
  startOn?: string | null;
  priority?: Priority | null;
  customItemId?: number | null;
  /** F40: troca o tipo. Nulo apaga — recusado em lista de produção (`type_required`). */
  type?: 'video' | 'arte' | 'foto' | 'outros' | null;
  assigneeIds?: string[];
  watcherIds?: string[];
  tagIds?: string[];
  statusId?: string;
};

/**
 * O que o formulário de criação manda.
 *
 * `startOn` entrou na F17.10b: o seletor de data do ClickUp tem DOIS campos —
 * `Data inicial` e `Data de vencimento` — e desenhar o primeiro sem poder
 * gravá-lo seria um campo que mente. `tasks.start_on` já existia desde a F17.3.
 */
export type NewTask = {
  title: string;
  description: string | null;
  dueOn: string | null;
  startOn: string | null;
  priority: Priority | null;
  statusId: string | null;
  customItemId: number | null;
  assigneeIds: string[];
  tagIds: string[];
  /**
   * F38, Fase 6 — o cliente escolhido. Ausente ou nulo = "herda da lista".
   * Em lista compartilhada (`requires_client`) ele é obrigatório; em lista de
   * cliente, só vale o da lista. Ver `server/cliente-da-tarefa.ts`.
   */
  clientId?: string | null;
  /**
   * F40, Fase 2 — o tipo da demanda. Obrigatório em lista de PRODUÇÃO (sem ele
   * a criação é recusada com `type_required`); em lista interna é opcional.
   */
  type?: 'video' | 'arte' | 'foto' | 'outros' | null;
};

export const tarefaVazia = (): NewTask => ({
  title: '',
  description: null,
  dueOn: null,
  startOn: null,
  priority: null,
  statusId: null,
  customItemId: null,
  assigneeIds: [],
  tagIds: [],
});

/* ───────────────────────────── o rascunho da ficha ───────────────────────────── */

/**
 * O estado editável da ficha.
 *
 * Separado do `TaskDetail` de propósito: o que veio do banco não se mistura com
 * o que está sendo digitado. É essa separação que permite responder "há algo por
 * salvar?" sem heurística e sem marcar sujo o que ninguém tocou.
 */
export type Rascunho = {
  title: string;
  description: string;
  dueOn: string;
  startOn: string;
  priority: Priority | null;
  customItemId: number | null;
  assigneeIds: string[];
  watcherIds: string[];
  tagIds: string[];
};

export function rascunhoDe(t: TaskDetail): Rascunho {
  return {
    title: t.title,
    description: t.description ?? '',
    dueOn: t.dueOn ?? '',
    startOn: t.startOn ?? '',
    priority: t.priority,
    customItemId: t.customItemId,
    assigneeIds: t.assignees.map((p) => p.id),
    watcherIds: t.watchers.map((p) => p.id),
    tagIds: t.tags.map((g) => g.id),
  };
}

const mesmoConjunto = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
};

const vazioOuNulo = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/**
 * O pedido mínimo: só o que mudou.
 *
 * POR QUE NÃO MANDAR TUDO SEMPRE
 *   Três razões. (a) `set_task_assignees` e `set_task_tags` APAGAM e reinserem —
 *   mandar a lista igual reescreveria `assigned_at` de todo mundo a cada
 *   salvamento, e a data de atribuição deixaria de querer dizer alguma coisa.
 *   (b) Uma escrita a menos é um gatilho a menos rodando: toda edição de tarefa
 *   com lista dispara o guarda do status, que são três consultas. (c) O que não
 *   se manda não pode ser sobrescrito por engano.
 */
export function mudancas(inicial: Rascunho, atual: Rascunho): TaskPatch {
  const p: TaskPatch = {};

  if (atual.title.trim() !== inicial.title.trim()) p.title = atual.title.trim();
  if (atual.description !== inicial.description) p.description = vazioOuNulo(atual.description);
  if (atual.dueOn !== inicial.dueOn) p.dueOn = vazioOuNulo(atual.dueOn);
  if (atual.startOn !== inicial.startOn) p.startOn = vazioOuNulo(atual.startOn);
  if (atual.priority !== inicial.priority) p.priority = atual.priority;
  if (atual.customItemId !== inicial.customItemId) p.customItemId = atual.customItemId;
  if (!mesmoConjunto(atual.assigneeIds, inicial.assigneeIds)) p.assigneeIds = atual.assigneeIds;
  if (!mesmoConjunto(atual.watcherIds, inicial.watcherIds)) p.watcherIds = atual.watcherIds;
  if (!mesmoConjunto(atual.tagIds, inicial.tagIds)) p.tagIds = atual.tagIds;

  return p;
}

export const temMudanca = (p: TaskPatch): boolean => Object.keys(p).length > 0;

/* ───────────────────────────── recusas que a tela pode dar sozinha ───────────────────────────── */

/**
 * O que a tela consegue recusar antes de gastar uma ida ao banco.
 *
 * ISTO NÃO SUBSTITUI O BANCO, E NÃO PODE PARECER QUE SUBSTITUI. `tasks_title_not_blank`
 * e o formato da data continuam sendo conferidos lá, porque quem chama a API
 * não é necessariamente esta tela. O que está aqui é conforto de digitação: a
 * pessoa vê o erro embaixo do campo, e não como uma faixa vermelha depois de
 * meio segundo.
 */
export function conferirTitulo(titulo: string): string | null {
  if (titulo.trim() === '') return 'A tarefa precisa de um título.';
  return null;
}

/**
 * A data que o campo de data produz.
 *
 * O campo nativo só emite `YYYY-MM-DD` — mas a ficha também ABRE com o que o
 * banco tem, e o banco tem `82025-08-07`. Um valor desses no campo nativo sai
 * como texto vazio, e salvar sem tocar no prazo APAGARIA o prazo torto. Por isso
 * o prazo só entra no pedido quando muda, e por isso esta função aceita ano de
 * até seis dígitos: para reconhecer o que já existe em vez de recusá-lo.
 */
export function conferirData(valor: string, rotulo: string): string | null {
  if (valor.trim() === '') return null;
  if (!/^\d{1,6}-\d{2}-\d{2}$/.test(valor.trim())) return `${rotulo} inválido.`;
  return null;
}

export function conferirRascunho(r: Rascunho): Record<string, string> {
  const erros: Record<string, string> = {};
  const t = conferirTitulo(r.title);
  if (t) erros.title = t;
  const d = conferirData(r.dueOn, 'Prazo');
  if (d) erros.dueOn = d;
  const s = conferirData(r.startOn, 'Início');
  if (s) erros.startOn = s;
  return erros;
}

export function conferirNova(n: NewTask): Record<string, string> {
  const erros: Record<string, string> = {};
  const t = conferirTitulo(n.title);
  if (t) erros.title = t;
  const d = conferirData(n.dueOn ?? '', 'Prazo');
  if (d) erros.dueOn = d;
  const s = conferirData(n.startOn ?? '', 'Início');
  if (s) erros.startOn = s;
  return erros;
}

/* ───────────────────────────── o que a tela mostra ───────────────────────────── */

/**
 * `07/08/2025 · 14:32`, no fuso de quem olha.
 *
 * INSTANTE PASSA POR `Date`, E DIA NÃO — a diferença não é descuido. O prazo é
 * um DIA escrito pela equipe, e pode ter ano de cinco dígitos (ver `board.ts`).
 * `created_at` é um INSTANTE gravado pelo Postgres com fuso: ele nunca é torto,
 * e precisa mesmo virar o relógio de quem lê.
 */
export function formatarInstante(iso: string | null): string | null {
  if (iso === null) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** O que o rodapé da ficha escreve para cada carimbo. */
export type LinhaDoRodape = { rotulo: string; valor: string };

export function rodapeDaFicha(t: TaskDetail): LinhaDoRodape[] {
  const linhas: LinhaDoRodape[] = [];
  const criacao = formatarInstante(t.createdAt);

  linhas.push({
    rotulo: 'Criada',
    valor: criacao === null ? 'instante ilegível' : criacao,
  });
  linhas.push({
    rotulo: 'Criada por',
    // As duas listas e os dois espaços do Pilar B nasceram por migration, sem
    // autor — dizer "criada por ninguém" é mais honesto do que omitir a linha.
    // Criada pela IA de alguém (F26.9): "Carla, via ChatGPT".
    valor:
      textoDoSeloDeOrigem(t.createdVia, t.createdBy?.name) ??
      t.createdBy?.name ??
      'sem autor registrado',
  });
  linhas.push({
    rotulo: 'Última atualização',
    valor: formatarInstante(t.updatedAt) ?? 'instante ilegível',
  });

  if (t.completedAt !== null) {
    linhas.push({
      rotulo: 'Concluída',
      valor: `${formatarInstante(t.completedAt) ?? 'instante ilegível'}${
        t.completedBy ? ` · por ${t.completedBy.name}` : ''
      }`,
    });
  } else {
    linhas.push({ rotulo: 'Concluída', valor: 'ainda não' });
  }

  if (t.archivedAt !== null) {
    linhas.push({
      rotulo: 'Arquivada',
      valor: formatarInstante(t.archivedAt) ?? 'instante ilegível',
    });
  }

  return linhas;
}

/**
 * Quem foi pedido e não entrou.
 *
 * É a resposta ao "ignora em silêncio" de `set_task_assignees`: pediram-se
 * cinco, ficaram três, e a tela precisa nomear os dois que sumiram — senão a
 * pessoa clica em salvar, vê a lista encolher, e não sabe por quê.
 */
export function ignorados(
  pedidos: readonly string[],
  ficaram: readonly { id: string }[],
  diretorio: readonly TaskPerson[],
): TaskPerson[] {
  const dentro = new Set(ficaram.map((p) => p.id));
  return pedidos
    .filter((id) => !dentro.has(id))
    .map((id) => diretorio.find((p) => p.id === id) ?? { id, name: 'pessoa sem perfil' });
}

/* --- F07 do plano UX: o nome que o chip de responsáveis mostra ----------- */

/** "Ana Souza" · "Ana Souza e Juca Lima" · "Ana Souza e mais 2" · "Ninguém". */
export function nomesDosResponsaveis(pessoas: readonly { name: string }[]): string {
  if (pessoas.length === 0) return 'Ninguém';
  if (pessoas.length === 1) return pessoas[0].name;
  if (pessoas.length === 2) return `${pessoas[0].name} e ${pessoas[1].name}`;
  return `${pessoas[0].name} e mais ${pessoas.length - 1}`;
}

/* --- F44, Fase 8: o recado depois de concluir ou reabrir ------------------ */

/**
 * O recado do botão Concluir/Reabrir, lido da ficha RELIDA.
 *
 * Desde a F44_6 concluir é o arrasto para a coluna que fecha (reabrir, para a
 * primeira que abre), e a automação daquela etapa roda: pode trocar quem cuida
 * ou levar a tarefa adiante, para outra lista. Sem automação, o recado é o de
 * sempre; com ela, ele diz o que a regra fez — senão a pessoa clica em
 * "Concluir" e vê a tarefa aberta noutra lista sem saber por quê.
 */
export function recadoDaConclusao(
  antes: Pick<TaskDetail, 'listId' | 'assignees'>,
  depois: Pick<TaskDetail, 'listId' | 'listName' | 'completedAt' | 'assignees'>,
  concluir: boolean,
): string {
  const base = concluir ? 'Concluída — o banco também moveu a etapa para a coluna que fecha.' : 'Reaberta.';
  if (depois.listId !== antes.listId) {
    const lista = depois.listName ? ` “${depois.listName}”` : '';
    return concluir && depois.completedAt === null
      ? `A automação da coluna que fecha levou a tarefa para a lista${lista}, onde ela segue aberta.`
      : `${base} A automação da etapa levou a tarefa para a lista${lista}.`;
  }
  const ids = (p: readonly { id: string }[]) => p.map((x) => x.id).sort().join(',');
  if (ids(depois.assignees) !== ids(antes.assignees)) {
    return `${base} A automação da etapa passou a tarefa para ${nomesDosResponsaveis(depois.assignees)}.`;
  }
  return base;
}

/* ═══════════════════════════════════════════════════════════════════════════
   F43, FASE 6 — O CARD EM DUAS COLUNAS: as duas contas puras da ficha nova.
   Moram aqui, e não no componente, pela regra das telas desta suíte: o teste
   de tela desenha no servidor e não roda efeito — a decisão precisa ser uma
   função que se prova sozinha.
   ═══════════════════════════════════════════════════════════════════════════ */

/** As três seções do corpo que podem nascer recolhidas. */
export type SecaoDaFicha = 'subtarefas' | 'checklists' | 'anexos';

/** A ordem da ficha real (subtarefa → checklist → anexo) — a mesma da linha "+". */
export const SECOES_DA_FICHA: readonly SecaoDaFicha[] = ['subtarefas', 'checklists', 'anexos'];

/** O que a linha "+ Subtarefa · + Checklist · + Anexo" escreve. */
export const ROTULO_DA_SECAO: Record<SecaoDaFicha, string> = {
  subtarefas: 'Subtarefa',
  checklists: 'Checklist',
  anexos: 'Anexo',
};

/**
 * AS SEÇÕES QUE NÃO TÊM NADA PARA MOSTRAR — F43, Fase 6.
 *
 * Seção vazia vira um botão na linha "+ …", e não um cabeçalho com a linha de
 * criação aberta: medido na base real, a maioria das tarefas não tem subtarefa,
 * checklist nem anexo, e as três caixas vazias empurravam a conversa para
 * baixo da dobra (o pedido do Wesley: "não sabem onde começa ou termina algo").
 *
 * ⚠️ O MESMO RECORTE DAS PRÓPRIAS SEÇÕES, e não um parecido:
 *   · subtarefa ARQUIVADA conta — `PassosDaTarefa` diz que ela existe ("não
 *     aparecem acima nem entram na contagem"), e esconder a seção a faria
 *     sumir sem rastro;
 *   · o print com validade (`expiresAt`) NÃO conta — ele mora na conversa, e
 *     `AnexosDaTarefa` o tira da grade pelo mesmo critério;
 *   · o link conta: ele é a entrega, ao lado do arquivo.
 */
export function secoesVazias(
  t: Pick<TaskDetail, 'subtasks' | 'checklists' | 'attachments' | 'links'>,
): SecaoDaFicha[] {
  const vazias: SecaoDaFicha[] = [];
  if (t.subtasks.length === 0) vazias.push('subtarefas');
  if (t.checklists.length === 0) vazias.push('checklists');
  if (t.attachments.every((a) => a.expiresAt) && t.links.length === 0) vazias.push('anexos');
  return vazias;
}

/**
 * O ESTADO DO TEXTO — o que a linha do Salvar diz, F43 Fase 6.
 *
 * A frase fixa "Status, responsáveis… gravam ao escolher. Título e briefing vão
 * com Salvar." saiu da ficha e foi para o `?` ao lado deste estado. O contrato
 * de salvar NÃO mudou (cabeçalho de `FichaDaTarefa`: o chip salva na hora, o
 * texto salva no botão); o que mudou é que a linha diz, sempre, em que pé o
 * texto está — e não só quando há algo por salvar.
 *
 * A PRECEDÊNCIA: escrevendo > falhou > por salvar > salvo. "Salvando" vale
 * para qualquer escrita no ar (chip incluído — era o que o rótulo do botão
 * dizia antes); "falhou" só para a gravação do TEXTO, e só enquanto ainda há
 * texto por salvar — a frase do banco continua na faixa de erro acima, e a
 * linha muda de tom (ver `ROTULO_DO_ESTADO`).
 */
export type EstadoDoTexto = 'salvo' | 'por-salvar' | 'salvando' | 'falhou';

export function estadoDoTexto(e: {
  porSalvar: boolean;
  escrevendo: boolean;
  falhouOTexto: boolean;
}): EstadoDoTexto {
  if (e.escrevendo) return 'salvando';
  if (e.falhouOTexto && e.porSalvar) return 'falhou';
  return e.porSalvar ? 'por-salvar' : 'salvo';
}

/**
 * A palavra de cada estado.
 *
 * ⚠️ "há alterações por salvar" é LITERAL e não pode mudar de caixa: os e2e
 * (`saida-da-tarefa`, `data-e-cabecalho`, `combinados`, `comum.mjs`) esperam
 * por ela com `exact: true`. E "Salvo" vai SEM ponto: "Salvo." é o recado que
 * a faixa verde dá depois do botão, e duas peças com o mesmo texto exato
 * tornariam ambígua a espera desses mesmos e2e.
 *
 * ⚠️ E A FALHA DIZ A MESMA FRASE, EM VERMELHO. Depois de uma gravação que não
 * entrou o texto CONTINUA por salvar — é isso que a pessoa precisa saber, e é
 * o que o e2e `combinados` (b) cobra no meio da renovação fora do ar. O porquê
 * da falha já está na faixa de erro acima, com a frase do banco; aqui muda o
 * tom (`data-estado="falhou"`) e o `title` aponta para a faixa. Uma frase
 * diferente ("Não foi salvo") esconderia justamente o "continua pendente".
 */
export const ROTULO_DO_ESTADO: Record<EstadoDoTexto, string> = {
  salvo: 'Salvo',
  'por-salvar': 'há alterações por salvar',
  salvando: 'Salvando…',
  falhou: 'há alterações por salvar',
};

/** O `title` de cada estado — só a falha tem o que acrescentar. */
export const TITULO_DO_ESTADO: Partial<Record<EstadoDoTexto, string>> = {
  falhou: 'A última tentativa de salvar não gravou — o motivo está no aviso acima. O texto continua aqui.',
};
