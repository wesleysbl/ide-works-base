/**
 * Os passos da tarefa — subtarefa e checklist. Etapa F17.15.
 *
 * O QUE ESTE ARQUIVO É, E O QUE ELE NÃO É
 *   É a camada pura: os tipos que atravessam servidor e tela, e as poucas contas
 *   que não dependem de nada — a contagem, a frase da contagem, e o aninhamento
 *   do item de checklist.
 *
 *   REGRA DE DOMÍNIO NÃO MORA AQUI, e nesta etapa isso é ainda mais literal do
 *   que nas anteriores: praticamente TUDO virou restrição declarativa no banco.
 *     · "a subtarefa mora na lista da mãe"  → `tasks_parent_same_list_fk`
 *     · "apagar a mãe leva as filhas"        → `on delete cascade` da mesma
 *     · "mover a mãe leva as filhas"         → `on update cascade` da mesma
 *     · "o item de checklist tem UM nível"   → `checklist_items_parent_fk`,
 *                                              com as duas colunas geradas
 *     · "ciclo é proibido"                   → `tasks_parent_guard`
 *     · "o nome não pode ser `{}`"           → `is_meaningful_name`, F17.4
 *
 *   Se alguma dessas aparecer reimplementada aqui, é defeito.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A CONTAGEM É DE FILHAS DIRETAS, E ELA VEM PRONTA DO BANCO
 *
 *   `ideworks.task_progress` é a única definição de "quantas subtarefas" e
 *   "quantos itens resolvidos" no projeto. Cartão, linha e ficha leem dela.
 *
 *   Aqui NÃO se recalcula nada disso a partir da lista carregada: a ficha traz a
 *   descendência direta, e o cartão do quadro não traz filha nenhuma — se a
 *   tela contasse o array que recebeu, o cartão diria zero para toda tarefa.
 *
 *   `contarItens` existe para o caso oposto e é honesto sobre isso: ela conta os
 *   itens DE UM CHECKLIST que a ficha já tem inteiro em mãos.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { Priority, TreeSpace } from '@/board/board';
import type { TaskPerson } from '@/board/ficha';

/* ───────────────────────────── a forma ───────────────────────────── */

/**
 * O que `ideworks.task_progress` responde sobre uma tarefa.
 *
 * `subtaskCount` são as filhas DIRETAS e não arquivadas. A justificativa está no
 * cabeçalho da migration da F17.15: o número fica ao lado da mãe e responde "em
 * quantos passos esta tarefa foi quebrada", que é um fato sobre ela — contar a
 * descendência faria o número mudar quando alguém quebrasse uma neta.
 */
export type TaskProgress = {
  subtaskCount: number;
  subtaskDone: number;
  checklistCount: number;
  checklistTotal: number;
  checklistDone: number;

  /* --- F17.6 ---------------------------------------------------------------
     As três entraram na MESMA view, e não numa nova, porque são a mesma
     pergunta: "o que esta tarefa tem dentro". O cartão do quadro já lia daqui
     para o `5` das subtarefas; ler "tem anexo" de outro lugar obrigaria a
     consulta do quadro a duas junções e faria a próxima etapa escolher entre
     as duas definições. Uma só — a lição da dívida 8.1.

     NÚMERO, e não booleano: `hasAttachment` é `attachmentCount > 0`, e custa o
     mesmo; mas o número também serve o cabeçalho `Anexos · 3`, e o booleano
     não serviria. */

  /** Quantos arquivos a tarefa tem no balde privado. O indicador do cartão. */
  attachmentCount: number;
  /** Quantos links externos — Dropbox, Google Docs — estão pendurados nela. */
  linkCount: number;
  /**
   * A conversa inteira, RESPOSTA INCLUÍDA.
   *
   * A pergunta que o número responde no cartão é "há conversa aqui", e uma
   * resposta é conversa. A contagem POR comentário — o `reply_count` do
   * ClickUp — é outra pergunta, mora só na ficha, e por isso é calculada lá.
   */
  commentCount: number;
};

export const SEM_PROGRESSO: TaskProgress = {
  subtaskCount: 0,
  subtaskDone: 0,
  checklistCount: 0,
  checklistTotal: 0,
  checklistDone: 0,
  attachmentCount: 0,
  linkCount: 0,
  commentCount: 0,
};

/**
 * Uma filha direta, como a ficha da mãe a mostra.
 *
 * NÃO É UM `BoardTask` NEM UM `TaskDetail`. É menos que os dois de propósito: a
 * linha da subtarefa mostra status, título, responsáveis, prazo e a contagem
 * DELA — trazer a descrição de cinco subtarefas para desenhar cinco linhas seria
 * o mesmo defeito que o quadro evita ao não trazer briefing.
 */
export type Subtask = {
  id: string;
  title: string;
  statusId: string | null;
  statusName: string | null;
  statusColor: string | null;
  statusType: string | null;
  priority: Priority | null;
  /** `YYYY-MM-DD` cru. O ano pode ter cinco dígitos — ver `board.ts`. */
  dueOn: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  assignees: TaskPerson[];
  /** As filhas DELA. É assim que a profundidade livre aparece: navegando. */
  subtaskCount: number;
};

/** O item que resolve. `children` é montado por `aninharItens`, não vem do banco. */
export type ChecklistItem = {
  id: string;
  checklistId: string;
  parentItemId: string | null;
  name: string;
  sortOrder: number;
  /** Instante, e não booleano: responde "resolvido desde quando?". */
  resolvedAt: string | null;
  assignee: TaskPerson | null;
  children: ChecklistItem[];
};

export type Checklist = {
  id: string;
  name: string;
  sortOrder: number;
  /** Achatados, na ordem. Quem aninha é `aninharItens`. */
  items: ChecklistItem[];
};

/** O que o formulário de subtarefa manda. Espelho curto de `NewTask`. */
export type NewSubtask = {
  title: string;
  dueOn: string | null;
  /**
   * A data INICIAL.
   *
   * Ela existe aqui por uma razão de tela, e não de modelo: o seletor de data do
   * ClickUp — o mesmo componente que o modal usa — tem DOIS campos, `Data
   * inicial` e `Data de vencimento`. Desenhar o menu com os dois e gravar só um
   * deixaria METADE do menu sem efeito, que é a mesma coisa que um botão morto.
   * `tasks.start_on` existe desde a F17.3.
   */
  startOn: string | null;
  priority: Priority | null;
  statusId: string | null;
  assigneeIds: string[];
  tagIds: string[];
};

export const subtarefaVazia = (): NewSubtask => ({
  title: '',
  dueOn: null,
  startOn: null,
  priority: null,
  statusId: null,
  assigneeIds: [],
  tagIds: [],
});

/* ───────────────────────────── as contas ───────────────────────────── */

/**
 * `resolvidos / total` de UM checklist.
 *
 * CONTA O FILHO TAMBÉM. A pergunta que o contador responde é "quanto deste
 * checklist está feito", e um subitem por fazer é trabalho por fazer. É a mesma
 * definição de `task_progress.checklist_total` no banco — as duas precisam
 * concordar, senão o cartão e a ficha diriam números diferentes sobre a mesma
 * caixa.
 */
export function contarItens(itens: readonly ChecklistItem[]): {
  resolvidos: number;
  total: number;
} {
  let resolvidos = 0;
  for (const i of itens) if (i.resolvedAt !== null) resolvidos += 1;
  return { resolvidos, total: itens.length };
}

/**
 * `0 de 1` — POR EXTENSO, e não `0/1`.
 *
 * É a forma da tela real que o usuário mandou como referência: o contador ao
 * lado do nome do checklist está escrito com a palavra. A barra fica para o
 * cartão do quadro, onde não há espaço para três palavras.
 */
export const porExtenso = (resolvidos: number, total: number): string =>
  `${resolvidos} de ${total}`;

/** `0/1` — a forma curta, para o cartão e a linha. */
export const porBarra = (resolvidos: number, total: number): string =>
  `${resolvidos}/${total}`;

/**
 * Os itens achatados viram árvore de UM nível.
 *
 * VEM ACHATADO DO BANCO DE PROPÓSITO, pelo mesmo motivo de `buildTree`: uma
 * consulta só, e a forma se monta aqui, onde tem teste. Duas consultas dariam
 * duas respostas que podem discordar.
 *
 * ÓRFÃO NÃO SOME. O banco não deixa nascer um item cujo pai esteja em outro
 * checklist — `checklist_items_parent_fk` recusa —, mas se um aparecer, ele é
 * mostrado na raiz em vez de desaparecer. Esconder trabalho é o pior defeito
 * possível numa lista de passos.
 */
export function aninharItens(itens: readonly ChecklistItem[]): ChecklistItem[] {
  const porId = new Map<string, ChecklistItem>();
  for (const i of itens) porId.set(i.id, { ...i, children: [] });

  const raiz: ChecklistItem[] = [];
  for (const i of itens) {
    const meu = porId.get(i.id);
    if (!meu) continue;
    const pai = i.parentItemId === null ? undefined : porId.get(i.parentItemId);
    if (pai) pai.children.push(meu);
    else raiz.push(meu);
  }

  const ordenar = (lista: ChecklistItem[]) => {
    lista.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'pt-BR'));
    for (const x of lista) ordenar(x.children);
  };
  ordenar(raiz);
  return raiz;
}

/**
 * A próxima posição na ordem — para o item novo nascer no fim, e não no meio.
 *
 * `+ 1` sobre o maior, e não `length`: apagar o item do meio deixaria dois com a
 * mesma posição, e a ordem passaria a depender do desempate por nome.
 */
export const proximaPosicao = (existentes: readonly { sortOrder: number }[]): number =>
  existentes.reduce((maior, x) => Math.max(maior, x.sortOrder), -1) + 1;

/* ───────────────────────────── o que a tela escreve ───────────────────────────── */

/** `5 subtarefas`, `1 subtarefa`, `nenhuma subtarefa`. */
export function rotuloDeSubtarefas(n: number): string {
  if (n === 0) return 'nenhuma subtarefa';
  return n === 1 ? '1 subtarefa' : `${n} subtarefas`;
}

/**
 * O que o interruptor `Subtarefas` do quadro diz quando está desligado.
 *
 * Ele NOMEIA quantos cartões estão escondidos. Um interruptor que só diz
 * "Subtarefas" deixa a pessoa sem saber se há algo do outro lado — e quem criou
 * uma subtarefa e não a vê no quadro conclui que o sistema a perdeu.
 */
export function rotuloDoInterruptor(escondidas: number, ligado: boolean): string {
  if (ligado) return 'Subtarefas · visíveis no quadro';
  if (escondidas === 0) return 'Subtarefas';
  return `Subtarefas · ${escondidas} ${escondidas === 1 ? 'escondida' : 'escondidas'}`;
}

/**
 * A validação que a tela consegue fazer sozinha — o mesmo critério do banco.
 *
 * ISTO NÃO SUBSTITUI `is_meaningful_name`, E NÃO PODE PARECER QUE SUBSTITUI. A
 * restrição continua no banco, porque quem chama a API não é necessariamente
 * esta tela. O que está aqui é conforto: a pessoa vê o erro antes de gastar uma
 * ida ao servidor.
 *
 * A regra é a MEDIDA na F17.4 — "não pode ser só pontuação e espaço" — e não a
 * outra candidata ("tem que ter letra ou dígito"), porque a primeira aceita a
 * etiqueta que é só um emoji e a segunda a recusa. Aqui a diferença importa
 * igual: `🎬` é nome de item que gente escolhe de propósito.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A CLASSE É `\p{P}` SOZINHA, E ISSO FOI MEDIDO CONTRA O BANCO — 2026-08-26
 *
 *   A primeira versão desta função usava `[\p{P}\p{S}\s]`, e ela era MAIS
 *   SEVERA QUE O BANCO. Passados 21 nomes por `ideworks.is_meaningful_name`, o
 *   Postgres respondeu:
 *
 *     recusa .... `{}` `[]` `---` `...` `()` `#` `?!` `«»` `—`   (Unicode `P`)
 *     ACEITA .... `+++` `===` `→` `🎬` `✅`                       (Unicode `S`)
 *
 *   Ou seja: `[[:punct:]]` do Postgres é a PONTUAÇÃO Unicode e nada além dela —
 *   símbolo matemático, seta e emoji passam. Com `\p{S}` na classe, esta tela
 *   recusaria nomes que o banco aceita, e a pessoa veria um erro inventado pelo
 *   navegador sobre um nome perfeitamente válido.
 *
 *   Validação de conforto que é mais severa que a regra é pior que validação
 *   nenhuma: ela mente sobre o que o sistema aceita.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function conferirNomeComSentido(nome: string): string | null {
  const limpo = nome.trim();
  if (limpo === '') return 'Escreva um nome.';
  // `\p{P}` é PONTUAÇÃO em Unicode e `\s` é espaço — a tradução exata de
  // `^[[:punct:][:space:]]+$` do Postgres, conferida caso a caso. Símbolo
  // (`\p{S}`) fica de fora de propósito: ver o cabeçalho.
  if (/^[\p{P}\s]+$/u.test(limpo)) {
    return 'Nome só com pontuação é recusado pelo banco — foi assim que o `{}` do Trello sujou o ClickUp.';
  }
  return null;
}

/* ───────────────────────────── a lista de destino ───────────────────────────── */

/**
 * A subtarefa NÃO escolhe lista, e por isso não há menu de lista na linha dela.
 *
 * Esta função existe para a tela poder DIZER onde a subtarefa vai nascer, em vez
 * de deixar a pessoa adivinhar. Ela não decide nada: quem decide é
 * `tasks_parent_guard`, que preenche `list_id` a partir da mãe, e
 * `tasks_parent_same_list_fk`, que recusa qualquer outra.
 */
export function ondeNasce(
  arvore: readonly TreeSpace[],
  listId: string | null,
): string | null {
  if (listId === null) return null;
  for (const espaco of arvore) {
    for (const l of espaco.lists) if (l.id === listId) return `${espaco.name} / ${l.name}`;
    for (const pasta of espaco.folders) {
      for (const l of pasta.lists) {
        if (l.id === listId) return `${espaco.name} / ${pasta.name} / ${l.name}`;
      }
    }
  }
  return null;
}
