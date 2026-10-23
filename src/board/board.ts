/**
 * O quadro — a forma que a coluna e o cartão precisam. Etapa F17.9a.
 *
 * O QUE ESTE ARQUIVO É, E O QUE ELE NÃO É
 *   É a camada pura: tipos, montagem da árvore, agrupamento por coluna, leitura
 *   de data e de prazo. Nada aqui fala com o banco e nada aqui decide permissão.
 *
 *   REGRA DE DOMÍNIO NÃO MORA AQUI. Quem pode ver a lista, qual esteira vale
 *   para ela, e o que acontece quando um cartão troca de coluna — isso está no
 *   banco desde a F17.1..F17.4, em `can_see_list`, `resolve_status_set` e
 *   `move_task`. Reescrever qualquer uma delas em React seria a dívida 8.1
 *   outra vez: duas verdades sobre o mesmo fato, e a de baixo ganhando calada.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A DATA NÃO PASSA POR `new Date()`, E ISSO NÃO É PREFERÊNCIA
 *
 *   Uma das 18 tarefas reais tem prazo `82025-08-07` — ano oitenta e dois mil,
 *   herdado do legado. É dado da origem: não se conserta aqui.
 *
 *   Só que `new Date('82025-08-07').toISOString()` devolve
 *   `+082025-08-07T00:00:00.000Z` — com sinal e com seis dígitos de ano, porque
 *   é assim que a norma manda escrever ano expandido. Todo `.slice(0, 10)` do
 *   projeto devolveria `+082025-0` para essa linha, e o cartão sairia com uma
 *   data que não existe.
 *
 *   Então a data é lida como TEXTO, por pedaços, e comparada como número. Ano
 *   de quatro ou de cinco dígitos passa igual, e a tela não quebra por causa de
 *   um dado torto que ela não criou.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { FiltroDeTarefas } from '@/board/filtro';

/* ───────────────────────────── o vocabulário do banco ───────────────────────────── */

/** `ideworks.status_type` — os cinco do ClickUp, copiados sem tradução. */
export type StatusType = 'open' | 'unstarted' | 'custom' | 'done' | 'closed';

/** `ideworks.task_priority`, já na ordem da urgência. */
export type Priority = 'urgent' | 'high' | 'normal' | 'low';

export const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: 'Urgente',
  high: 'Alta',
  normal: 'Normal',
  low: 'Baixa',
};

/**
 * A cor da prioridade sai do design system, não do ClickUp.
 *
 * Prioridade é vocabulário NOSSO — o enum foi declarado na F17.3 com quatro
 * valores fixos. Cor de status e cor de etiqueta são outra coisa: vêm da
 * origem, variam por lista, e por isso entram como variável no elemento.
 */
export const PRIORITY_TOKEN: Record<Priority, string> = {
  urgent: 'var(--err)',
  high: 'var(--warn)',
  normal: 'var(--luz-ia)',
  low: 'var(--mute)',
};

/* ───────────────────────────── a árvore ───────────────────────────── */

/** Uma linha crua de `ideworks.tree`, como o servidor a devolve. */
export type TreeRow = {
  spaceId: string;
  spaceName: string;
  spaceColor: string | null;
  spaceSortOrder: number;
  categoryId: string | null;
  /** A empresa — `client_categories` É a empresa desde a F14. */
  categoryName: string | null;
  folderId: string | null;
  folderName: string | null;
  folderSortOrder: number | null;
  listId: string;
  listName: string;
  listSortOrder: number;
  /** Tarefas não arquivadas e não concluídas. Ver `readTree`. */
  liveTasks: number;
  /** Tarefas não arquivadas, concluídas ou não. */
  totalTasks: number;
};

export type TreeList = {
  id: string;
  name: string;
  liveTasks: number;
  totalTasks: number;
};

export type TreeFolder = {
  id: string;
  name: string;
  lists: TreeList[];
};

export type TreeSpace = {
  id: string;
  name: string;
  color: string | null;
  categoryName: string | null;
  folders: TreeFolder[];
  /** Listas penduradas direto no espaço, sem pasta. A F17.1 as previu. */
  lists: TreeList[];
};

const porTexto = (a: string, b: string) => a.localeCompare(b, 'pt-BR');

/**
 * A árvore montada a partir das linhas achatadas.
 *
 * Vem achatada do banco de propósito: a view `tree` já calcula `is_live` sobre a
 * corrente inteira, e refazer a junção em três consultas daria três respostas
 * que podem discordar entre si.
 *
 * Espaço sem lista nenhuma NÃO aparece — a view parte de `lists`. É o
 * comportamento certo para esta tela, que existe para chegar numa lista; um
 * espaço vazio seria uma pasta que não abre nada.
 */
export function buildTree(rows: readonly TreeRow[]): TreeSpace[] {
  const spaces = new Map<string, TreeSpace>();
  const folders = new Map<string, TreeFolder>();
  const ordem = new Map<string, number>();

  for (const r of rows) {
    let space = spaces.get(r.spaceId);
    if (!space) {
      space = {
        id: r.spaceId,
        name: r.spaceName,
        color: r.spaceColor,
        categoryName: r.categoryName,
        folders: [],
        lists: [],
      };
      spaces.set(r.spaceId, space);
      ordem.set(`s:${r.spaceId}`, r.spaceSortOrder);
    }

    const list: TreeList = {
      id: r.listId,
      name: r.listName,
      liveTasks: r.liveTasks,
      totalTasks: r.totalTasks,
    };
    ordem.set(`l:${r.listId}`, r.listSortOrder);

    if (r.folderId === null) {
      space.lists.push(list);
      continue;
    }

    let folder = folders.get(r.folderId);
    if (!folder) {
      folder = { id: r.folderId, name: r.folderName ?? '(sem nome)', lists: [] };
      folders.set(r.folderId, folder);
      ordem.set(`f:${r.folderId}`, r.folderSortOrder ?? 0);
      space.folders.push(folder);
    }
    folder.lists.push(list);
  }

  const posicao = (chave: string) => ordem.get(chave) ?? 0;
  const ordenarListas = (l: TreeList[]) =>
    l.sort((a, b) => posicao(`l:${a.id}`) - posicao(`l:${b.id}`) || porTexto(a.name, b.name));

  const resultado = [...spaces.values()];
  for (const s of resultado) {
    s.folders.sort(
      (a, b) => posicao(`f:${a.id}`) - posicao(`f:${b.id}`) || porTexto(a.name, b.name),
    );
    for (const f of s.folders) ordenarListas(f.lists);
    ordenarListas(s.lists);
  }

  // A empresa primeiro: os dois espaços da casa se chamam `Demandas`, e sem a
  // empresa na frente a barra lateral mostraria dois itens idênticos.
  return resultado.sort(
    (a, b) =>
      porTexto(a.categoryName ?? '', b.categoryName ?? '') ||
      posicao(`s:${a.id}`) - posicao(`s:${b.id}`) ||
      porTexto(a.name, b.name),
  );
}

/* ───────────────────────────── o quadro ───────────────────────────── */

export type BoardStatus = {
  id: string;
  name: string;
  type: StatusType;
  /**
   * A cor que veio do ClickUp — `#d3d3d3`, `#6bc950`.
   *
   * É **dado**, não estilo (decisão D10). Ela entra na tela como variável CSS no
   * próprio elemento; nunca como classe, porque muda de lista para lista e
   * porque classe de cor literal é o que o OBSIDIAN existe para proibir.
   */
  color: string | null;
  sortOrder: number;
};

export type BoardAssignee = { id: string; name: string };

export type BoardTag = {
  id: string;
  name: string;
  /** Também cor de dado, também por variável. */
  bgColor: string | null;
  fgColor: string | null;
};

export type BoardTask = {
  id: string;
  title: string;
  statusId: string | null;
  priority: Priority | null;
  /** `YYYY-MM-DD` cru, do banco. O ano pode ter cinco dígitos: ver o cabeçalho. */
  dueOn: string | null;
  startOn: string | null;
  completedAt: string | null;
  /**
   * "Tem descrição", sem trazer a descrição.
   *
   * O quadro não pode buscar o briefing inteiro de cem tarefas para desenhar um
   * ícone. O servidor calcula o booleano na consulta.
   *
   * O irmão dele é `hasAttachment`, logo abaixo — ele ficou de fora da F17.9a
   * porque a tabela de anexo não existia, e devolver `false` fixo teria sido
   * prometer um dado que o modelo não tinha. Desde a F17.6 ele existe de
   * verdade.
   */
  hasDescription: boolean;

  /**
   * "Tem anexo", sem trazer o nome de arquivo nenhum — F17.6.
   *
   * Calculado no banco como `task_progress.attachment_count > 0`. É a mesma
   * view de onde sai o `5` das subtarefas, e por isso cartão, linha e ficha
   * nunca discordam. O quadro continua sem trazer descrição, sem trazer corpo
   * de comentário e sem trazer nome de arquivo: o que atravessa a rede é
   * número.
   */
  hasAttachment: boolean;
  clientId: string | null;
  clientName: string | null;
  assignees: BoardAssignee[];
  tags: BoardTag[];
  taskTypeName: string | null;
  /**
   * O TIPO DA DEMANDA — F40, Fase 2. `video | arte | foto | outros`; nulo =
   * "sem tipo" (card antigo, ou lista interna). Não se confunde com
   * `taskTypeName` (o tipo do ClickUp). Opcional: servidor de antes da F40 não o manda.
   */
  type?: 'video' | 'arte' | 'foto' | 'outros' | null;

  /* --- os passos, F17.15 --------------------------------------------------- */

  /**
   * A mãe, quando este cartão é de uma subtarefa.
   *
   * A subtarefa É um cartão da MESMA lista — `tasks_parent_same_list_fk` obriga
   * —, então ela chega aqui junto com as outras. Quem decide se ela aparece é o
   * interruptor `Subtarefas` da barra de controle, e não uma segunda consulta.
   */
  parentId: string | null;
  /** O título da mãe, para o cartão da subtarefa dizer de onde veio. */
  parentTitle: string | null;

  /**
   * A contagem que o cartão mostra, vinda de `ideworks.task_progress`.
   *
   * FILHAS DIRETAS, não arquivadas. Ver o cabeçalho da migration da F17.15: o
   * número fica ao lado da mãe e responde "em quantos passos esta tarefa foi
   * quebrada".
   */
  subtaskCount: number;
  checklistDone: number;
  checklistTotal: number;

  /**
   * A conversa da tarefa, contada — F17.6.
   *
   * Ela aparece no cartão pelo mesmo motivo que aparece no ClickUp: na Agência
   * Ide o comentário com o link do Dropbox É a entrega, então "tem conversa" é
   * um fato sobre o andamento do trabalho, e não um enfeite social.
   */
  commentCount: number;

  /**
   * A ARTE QUE O CARTÃO MOSTRA — F17.56.
   *
   * ⚠️ É UM IDENTIFICADOR, E NÃO UM ENDEREÇO. O quadro continua sem trazer
   * caminho no balde, nome de arquivo ou URL assinada: o que atravessa aqui é
   * o mesmo tipo de coisa que `hasAttachment` já trazia — um fato, não um
   * conteúdo. Quem transforma este id em imagem é `board/miniaturas`, numa
   * segunda ida que passa pela política do banco outra vez.
   *
   * Assinar no próprio quadro pareceria mais direto e seria pior por dois
   * motivos: gastaria uma assinatura por cartão que ninguém vai olhar, e faria
   * o prazo de cinco minutos começar a correr no instante do carregamento —
   * um quadro aberto e esquecido voltaria com imagem quebrada.
   *
   * `null` quando a tarefa não tem NENHUM anexo de imagem. Anexo que não é
   * imagem — `.ai`, `.psd`, `.zip`, os que a agência mais manda — continua
   * sendo só o clipe de papel: não há miniatura de um arquivo que o navegador
   * não desenha.
   */
  previewAttachmentId: string | null;

  /**
   * Quantos anexos de IMAGEM a tarefa tem — F17.56.
   *
   * O cartão mostra UMA e diz `+N` quando há mais. Mostrar todas cresceria o
   * cartão sem teto — a tarefa `[F] SABOR DOCE - 2 ANOS DA LOJA` tem quatro —, e
   * a coluna existe para caber muita tarefa na tela.
   */
  previewCount: number;
};

export type BoardHeader = {
  listId: string;
  listName: string;
  listContent: string | null;
  folderId: string | null;
  folderName: string | null;
  spaceId: string;
  spaceName: string;
  categoryName: string | null;
  statusSetName: string;
  /** De onde a esteira veio: `list`, `folder` ou `space`. Vem de `list_workflow`. */
  inheritedFrom: 'list' | 'folder' | 'space';
  /**
   * O CLIENTE DA LISTA E A MARCA "EXIGE CLIENTE" — F38, Fase 7.
   *
   * É o que o formulário de tarefa nova precisa para saber se o cliente vem da
   * lista (lista de cliente), se é obrigatório (lista compartilhada) ou se
   * pode ficar vazio (lista interna). Ver `@/board/cliente-da-tarefa`.
   *
   * OPCIONAIS: servidor de antes da Fase 7 não os manda, e ausente quer dizer
   * o mesmo que nulo/falso — lista interna, sem exigência.
   */
  clientId?: string | null;
  /** Nulo também quando quem lê alcança a lista e não alcança o cliente. */
  clientName?: string | null;
  requiresClient?: boolean;
  /**
   * LISTA DE PRODUÇÃO — F40, Fase 4. A esteira efetiva tem "atribuir demanda";
   * quem decide é o banco (`ideworks.list_is_production`). Nela, card novo
   * precisa de tipo. Opcional: servidor de antes da F40 não manda, e ausente
   * quer dizer lista interna (tipo opcional).
   */
  isProduction?: boolean;
};

export type Board = {
  header: BoardHeader;
  statuses: BoardStatus[];
  tasks: BoardTask[];
  /**
   * As etiquetas do ESPAÇO desta lista — acrescentado na F17.10.
   *
   * O quadro em si não as usa: quem usa é o formulário de tarefa nova, que abre
   * de dentro dele. Vêm junto com o quadro para criar uma tarefa não custar uma
   * segunda ida ao servidor só para saber o que se pode etiquetar.
   */
  availableTags: BoardTag[];
  /**
   * QUANTAS TAREFAS CADA COLUNA TEM DE VERDADE — F17.50.
   *
   * `tasks` traz uma JANELA de cada coluna (ver `CARTOES_POR_COLUNA` em
   * `@/server/board`), porque a política de acesso é avaliada cartão a cartão e
   * mil cartões custavam 7,6 s. Este mapa diz o total real, por `status.id`.
   *
   * ⚠️ É ele que o cabeçalho da coluna mostra. Contar os cartões que chegaram
   * faria a tela dizer `50` sobre uma coluna de 1.049 — que é exatamente o
   * defeito de esconder tarefa sem dizer.
   */
  columnTotals: Record<string, number>;
  /**
   * QUANTAS DE CADA COLUNA PASSARAM PELO FILTRO — F17.55.
   *
   * O irmão de `columnTotals`, contado na MESMA varredura e com as mesmas
   * chaves. Sem filtro os dois mapas são idênticos; com filtro, a coluna diz
   * `27 de 1.050` — e é por existirem os DOIS números que ela consegue dizer
   * isso. Um mapa só faria a tela ter de escolher entre esconder o total e
   * esconder o achado, e a F17.50 já mostrou o preço de um número sozinho.
   */
  columnMatched: Record<string, number>;
  /** O tamanho da janela que ESTA resposta usou. O `Mostrar mais` parte dele. */
  perColumn: number;
  /**
   * QUEM APARECE COMO RESPONSÁVEL NESTA LISTA — F17.55.
   *
   * ⚠️ NÃO SE DEDUZ DOS CARTÕES QUE CHEGARAM. A janela traz 50 por coluna; um
   * menu montado a partir dela ofereceria só quem calhou de estar nas primeiras
   * cinquenta, e a pessoa que trabalha no fim da fila simplesmente não
   * existiria para o filtro. Este é o censo da lista inteira, feito no banco.
   *
   * A contagem vai junto porque ela é a informação que faz escolher: `Helena
   * 25` diz o que `Helena` não diz.
   */
  assigneeOptions: BoardAssigneeOption[];
  /**
   * Quantas tarefas da lista não têm ninguém — a opção `Sem responsável`.
   *
   * Ela é a maioria: 1.015 das 1.070 da `ATENDIMENTO`, herança da importação da
   * F17.49. Um filtro de responsável sem esta opção deixaria 93% do trabalho
   * fora de qualquer peneira.
   */
  unassignedTasks: number;
  /**
   * O filtro que o SERVIDOR aplicou — F17.55.
   *
   * Volta para a tela poder dizer o que está filtrado a partir do que foi
   * filtrado, e não a partir do que foi digitado. Os dois se separam a cada
   * tecla: enquanto a resposta não chega, a caixa já mudou. Anunciar `27
   * achadas para "sonh"` seria contar o resultado de uma busca com o nome de
   * outra.
   */
  filter: FiltroDeTarefas;
};

/** Uma pessoa que aparece como responsável na lista, e quantas tarefas tem nela. */
export type BoardAssigneeOption = BoardAssignee & { tasks: number };

/**
 * QUANTOS CARTÕES POR COLUNA, DE PARTIDA — F17.50.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE EXISTE UM TETO, E POR QUE ELE É POR COLUNA
 *
 *   Medido em 2026-09-01, com a lista `ATENDIMENTO` que a F17.49 trouxe:
 *
 *     · 1.070 tarefas · a resposta pesava 598 KB · levava 7,6 s
 *     · a CONSULTA no banco levava 61 ms
 *
 *   Os 7,5 s que faltam não são consulta nem rede: são as POLÍTICAS DE ACESSO,
 *   avaliadas linha a linha. Medido: `can_reach_task` sozinha custou 695 ms
 *   para as 1.070 linhas — 0,65 ms cada —, e a consulta do quadro toca oito
 *   tabelas com política por cartão: tarefa, tarefa-mãe, cliente, responsáveis,
 *   etiquetas, subtarefas, itens de checklist, anexos e comentários.
 *
 *   Ou seja: o preço é POR CARTÃO CARREGADO. Carregar menos cartões é o único
 *   remédio que não mexe na parede de acesso — e afrouxar a parede para ganhar
 *   segundo seria trocar velocidade por vazamento, que é o negócio que a F17.32
 *   existe para nunca fazer.
 *
 * POR QUE ISTO NÃO ESCONDE TRABALHO
 *   Na mesma lista, 1.049 das 1.070 tarefas estão em `demanda concluída`. As
 *   colunas de trabalho têm 13, 6, 1 e 1 — nenhuma chega perto do teto, e
 *   nenhuma é cortada. Quem corta é a coluna do que já acabou.
 *
 *   E mesmo lá o corte é DITO: o cabeçalho da coluna mostra o total de verdade
 *   e o pé dela traz `Mostrar mais`. Lista que esconde tarefa sem avisar é pior
 *   do que lista lenta; esta avisa, e dá o caminho.
 *
 * POR QUE 50
 *   É a maior coluna de trabalho da base de hoje (13) com folga de quase quatro
 *   vezes, e cabe numa rolagem de coluna sem esforço.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const CARTOES_POR_COLUNA = 50;

export const INHERITED_LABEL: Record<BoardHeader['inheritedFrom'], string> = {
  list: 'própria da lista',
  folder: 'herdada da pasta',
  space: 'herdada do espaço',
};

export type Column = {
  status: BoardStatus;
  /** Os cartões que chegaram — a JANELA da coluna, quando ela foi cortada. */
  tasks: BoardTask[];
  /**
   * Quantos há na coluna de verdade — F17.50. Igual a `tasks.length` quando
   * nada foi cortado, maior quando foi. É este número que o cabeçalho mostra.
   */
  total: number;
  /**
   * Quantos passaram pelo filtro — F17.55. Igual a `total` quando não há
   * filtro, e é assim que o cabeçalho sabe se tem um ou dois números a dizer.
   */
  matched: number;
  /**
   * Quantos cartões CHEGARAM nesta coluna — os que o interruptor `Subtarefas`
   * esconde incluídos. É contra este número que o corte se mede
   * (`colunaCortada`): `tasks.length` conta só o que está à vista, e a
   * subtarefa escondida não é cartão que falta buscar.
   */
  carregadas: number;
};

/**
 * Uma coluna por status da esteira, na ordem dela.
 *
 * A ORDEM É A DO BANCO, e a coluna vazia FICA. Esconder a coluna sem cartão
 * mudaria o desenho da esteira conforme o dia — e é justamente a coluna vazia
 * que hoje conta a verdade: `a fazer` está vazia porque as 18 tarefas foram
 * concluídas, não porque a tela falhou.
 */
/**
 * O interruptor `Subtarefas` da barra de controle — F17.15.
 *
 * A SUBTAREFA É UM CARTÃO DA MESMA LISTA, e por isso ela já vem no quadro. O que
 * o interruptor faz é ESCONDER, e o padrão é escondido: uma `Etapa 1` com cinco
 * subtarefas viraria seis cartões numa coluna, e o quadro passaria a mostrar o
 * mesmo trabalho seis vezes.
 *
 * ESCONDER SÓ É HONESTO PORQUE O CARTÃO DA MÃE CONTA. É o par: o número no
 * cartão diz que há cinco lá dentro, e o interruptor mostra quais são. Um sem o
 * outro seria trabalho invisível.
 */
export function visiveisNoQuadro(
  tasks: readonly BoardTask[],
  mostrarSubtarefas: boolean,
): BoardTask[] {
  if (mostrarSubtarefas) return [...tasks];
  return tasks.filter((t) => t.parentId === null);
}

/** Quantos cartões o interruptor está escondendo agora. */
export const subtarefasEscondidas = (tasks: readonly BoardTask[]): number =>
  tasks.filter((t) => t.parentId !== null).length;

export function toColumns(
  statuses: readonly BoardStatus[],
  tasks: readonly BoardTask[],
  /**
   * Quantas há de verdade em cada coluna, por `status.id` — F17.50. Ausente, o
   * total é o que chegou: é o que vale para quem monta coluna sem servidor (a
   * suíte, e a tela da pessoa, que não tem janela).
   */
  totais?: Record<string, number>,
  /**
   * Quantas de cada coluna passaram pelo filtro — F17.55. Ausente, o filtrado é
   * o total: é o que vale para quem monta coluna sem servidor, e para toda tela
   * que não filtra.
   */
  achadas?: Record<string, number>,
  /**
   * Tudo o que chegou do servidor, ANTES de o interruptor `Subtarefas` tirar as
   * filhas. Ausente, `tasks` é tudo o que chegou — a suíte e as telas sem
   * interruptor.
   */
  chegaram: readonly BoardTask[] = tasks,
): Column[] {
  const porStatus = new Map<string, BoardTask[]>();
  for (const s of statuses) porStatus.set(s.id, []);
  for (const t of tasks) {
    if (t.statusId !== null) porStatus.get(t.statusId)?.push(t);
  }
  const chegadasPorStatus = new Map<string, number>();
  for (const t of chegaram) {
    if (t.statusId !== null) chegadasPorStatus.set(t.statusId, (chegadasPorStatus.get(t.statusId) ?? 0) + 1);
  }
  return [...statuses]
    .sort((a, b) => a.sortOrder - b.sortOrder || porTexto(a.name, b.name))
    .map((status) => {
      const cartoes = porStatus.get(status.id) ?? [];
      /* ⚠️ `Math.max` E NÃO O TOTAL SECO: o interruptor `Subtarefas` e o
         arrasto mexem em `tasks` sem falar com o servidor. Um cartão trazido
         para cá por arrasto não pode fazer a coluna dizer menos do que mostra. */
      const total = totais?.[status.id];
      const achado = achadas?.[status.id];
      return {
        status,
        tasks: cartoes,
        total: total === undefined ? cartoes.length : Math.max(total, cartoes.length),
        /* O filtrado passa pela MESMA guarda, e pelo mesmo motivo: com o filtro
           ligado, o cartão arrastado para esta coluna está à vista e bate com o
           filtro — a conta velha do servidor não pode dizer menos do que se vê. */
        matched:
          achado === undefined
            ? total === undefined
              ? cartoes.length
              : Math.max(total, cartoes.length)
            : Math.max(achado, cartoes.length),
        carregadas: Math.max(chegadasPorStatus.get(status.id) ?? 0, cartoes.length),
      };
    });
}

/**
 * Falta buscar cartão desta coluna? É o `Mostrar mais` do pé dela.
 *
 * ⚠️ SE MEDE PELO QUE CHEGOU, E NÃO PELO QUE ESTÁ À VISTA. Os totais do banco
 * contam toda tarefa da lista, subtarefa incluída; com o interruptor
 * `Subtarefas` desligado (o padrão) as filhas não são cartão, e comparar os
 * cartões à vista com o total fazia toda coluna com subtarefa dizer
 * `1 de 3 · Mostrar mais` — um botão que não trazia nada, porque o que faltava
 * estava só escondido (o interruptor já diz quantas são).
 */
export const colunaCortada = (c: Pick<Column, 'carregadas' | 'matched'>): boolean =>
  c.carregadas < c.matched;

/**
 * As tarefas que não couberam em coluna nenhuma.
 *
 * Não deveria haver nenhuma: o gatilho `task_status_guard` recusa status fora da
 * esteira resolvida da lista. Se aparecer alguma, a tela DIZ — some-la seria
 * esconder trabalho, que é o pior defeito possível num quadro.
 */
export function orphanTasks(
  statuses: readonly BoardStatus[],
  tasks: readonly BoardTask[],
): BoardTask[] {
  const conhecidos = new Set(statuses.map((s) => s.id));
  return tasks.filter((t) => t.statusId === null || !conhecidos.has(t.statusId));
}

export type BoardSummary = {
  total: number;
  /** Sem instante de conclusão. O gatilho garante que isto e "fora do status que fecha" são a mesma coisa. */
  open: number;
  done: number;
};

export function summarize(tasks: readonly BoardTask[]): BoardSummary {
  const done = tasks.filter((t) => t.completedAt !== null).length;
  return { total: tasks.length, open: tasks.length - done, done };
}

/**
 * O RESUMO DA LISTA INTEIRA, E NÃO DA JANELA — F17.50.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE `summarize` NÃO SERVE MAIS SOZINHO
 *
 *   Ele conta os cartões que chegaram. Enquanto o quadro trazia todos, isso era
 *   a lista inteira. Com a janela (ver `CARTOES_POR_COLUNA`), `ATENDIMENTO`
 *   traria cinquenta e um cartões e o cabeçalho anunciaria `71 tarefas` sobre
 *   uma lista de 1.070 — a tela mentindo com número redondo, que é pior do que
 *   a tela lenta que esta etapa veio consertar.
 *
 *   Então o total sai de `columnTotals`, que o servidor contou olhando TODAS as
 *   linhas. `concluídas` é a soma das colunas cujo status FECHA — e é a mesma
 *   definição do banco (`task_status_guard` mantém `completed_at` e "estar num
 *   status de tipo `closed`" como a mesma coisa, nos dois sentidos), então os
 *   dois caminhos concordam por construção, e não por coincidência.
 *
 * ⚠️ TAREFA SEM COLUNA NÃO SOME. `columnTotals` só tem status da esteira; o que
 * ficou órfão (status de outra esteira, ou nenhum) continua contado a partir
 * dos cartões, como sempre foi. Ver `orphanTasks`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function summarizeBoard(
  quadro: {
    statuses: readonly BoardStatus[];
    tasks: readonly BoardTask[];
    columnTotals: Record<string, number>;
    columnMatched?: Record<string, number>;
  },
  /**
   * QUAL DAS DUAS CONTAS — F17.55.
   *
   * `todas` é a lista inteira; `achadas`, o que o filtro deixou passar. As duas
   * saem daqui, da MESMA construção, lendo mapas irmãos que o banco encheu na
   * mesma varredura. É isso que impede a tela de dizer um total que não bate
   * com o filtrado que ela mesma mostra ao lado — dois cálculos parecidos, cada
   * um com sua conta de órfã, divergiriam na primeira etapa que mexesse num só.
   */
  quais: 'todas' | 'achadas' = 'todas',
): BoardSummary {
  const mapa =
    quais === 'achadas' ? (quadro.columnMatched ?? quadro.columnTotals) : quadro.columnTotals;

  const naColuna = (s: BoardStatus) =>
    Math.max(
      mapa[s.id] ?? 0,
      // A mesma guarda de `toColumns`: arrastar acrescenta cartão aqui sem
      // falar com o servidor, e o total velho não pode ficar abaixo do visível.
      quadro.tasks.filter((t) => t.statusId === s.id).length,
    );

  let total = 0;
  let done = 0;
  for (const s of quadro.statuses) {
    const n = naColuna(s);
    total += n;
    if (s.type === 'closed') done += n;
  }

  // As órfãs, que não estão em coluna nenhuma e mesmo assim são trabalho.
  const orfas = orphanTasks(quadro.statuses, quadro.tasks);
  total += orfas.length;
  done += orfas.filter((t) => t.completedAt !== null).length;

  return { total, open: total - done, done };
}

/* ───────────────────────────── datas ───────────────────────────── */

export type Day = { year: number; month: number; day: number };

/** `2025-08-07` e `82025-08-07` passam os dois. Qualquer outra coisa vira nulo. */
export function parseDay(iso: string | null): Day | null {
  if (iso === null) return null;
  const m = /^(\d{1,6})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** `07/08/2025`. Ano de cinco dígitos sai com cinco dígitos, porque é o que ele é. */
export function formatDay(iso: string | null): string | null {
  const d = parseDay(iso);
  if (d === null) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.day)}/${pad(d.month)}/${d.year}`;
}

/** Compara dois dias sem passar por `Date`. Negativo = `a` antes de `b`. */
export function compareDay(a: Day, b: Day): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

export function today(agora: Date = new Date()): Day {
  return {
    year: agora.getFullYear(),
    month: agora.getMonth() + 1,
    day: agora.getDate(),
  };
}

export type DueState = 'nenhum' | 'ilegivel' | 'concluida' | 'atrasada' | 'hoje' | 'futura';

/**
 * O que o prazo do cartão quer dizer hoje.
 *
 * TAREFA CONCLUÍDA NÃO ATRASA. Pintar de vermelho o prazo de trabalho já
 * entregue transformaria as 18 tarefas reais numa parede de alarme falso — e
 * alarme que sempre toca deixa de ser lido.
 */
/*
  Recebe as DUAS COLUNAS, e não o cartão inteiro — mudança da F17.10. A ficha
  (`TaskDetail`) responde a mesma pergunta e não é um `BoardTask`; pedir o objeto
  todo obrigaria a ficha a fingir que é cartão, e o cartão continua passando sem
  alteração nenhuma.
*/
export function dueState(
  task: { dueOn: string | null; completedAt: string | null },
  hoje: Day,
): DueState {
  if (task.dueOn === null) return 'nenhum';
  if (task.completedAt !== null) return 'concluida';
  const prazo = parseDay(task.dueOn);
  if (prazo === null) return 'ilegivel';
  const d = compareDay(prazo, hoje);
  if (d < 0) return 'atrasada';
  if (d === 0) return 'hoje';
  return 'futura';
}

export const DUE_TOKEN: Record<DueState, string | undefined> = {
  nenhum: undefined,
  ilegivel: 'var(--mute)',
  concluida: 'var(--mute)',
  atrasada: 'var(--err)',
  hoje: 'var(--warn)',
  futura: 'var(--mute)',
};

/* ───────────────────────────── responsáveis ───────────────────────────── */

/** Duas letras para o avatar. Nome de uma palavra devolve as duas primeiras. */
export function initials(name: string): string {
  const partes = name
    .trim()
    .split(/\s+/)
    .filter((p) => p !== '');
  if (partes.length === 0) return '??';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/** Quantos avatares cabem antes do `+N`. */
export const AVATARS_VISIVEIS = 3;

/* ───────────────────────────── o nome do status na tela ───────────────────────────── */

/**
 * Primeira letra em maiúscula, e nada mais — F17.20.
 *
 * O nome do status vem da origem em minúscula (`a fazer`, `concluída`,
 * `desing de capa`), e a ficha do chip o escrevia com `.toUpperCase()`:
 * `A FAZER`. Versalete é a marca visual que esta etapa foi encarregada de
 * tirar, e as colunas do quadro já saíram dela pelo `::first-letter` da folha.
 *
 * O chip não pôde usar o mesmo caminho: `::first-letter` só vale em contêiner
 * de bloco, e o rótulo do chip é um `<span>` em linha. Então a mesma regra
 * mora aqui, em função pura — e não vira uma terceira cópia solta da linha
 * `charAt(0).toUpperCase() + slice(1)` que `Cliente.tsx` e `Planejamento.tsx`
 * já repetem entre si.
 *
 * ⚠️ ELA NÃO TOCA NO RESTO DA FRASE. `desing de capa` é um erro de digitação
 * que está em produção, e a F17.2 decidiu copiar como está: `capitalize` do
 * CSS devolveria `Desing De Capa`, que não é português nem é o dado.
 */
export function emFrase(texto: string): string {
  const t = texto.trim();
  if (t === '') return t;
  return t[0].toLocaleUpperCase('pt-BR') + t.slice(1);
}
