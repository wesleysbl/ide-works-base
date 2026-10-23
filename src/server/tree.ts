/**
 * A árvore, lida por inteiro e escrita pela tela — etapa F17.14.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NENHUMA DECISÃO DE DOMÍNIO ACONTECE NESTE ARQUIVO
 *
 *   Quem pode criar espaço é a política `spaces_write` (`acting_is_superadmin`).
 *   Quem pode criar pasta e lista é `folders_write` / `lists_write`
 *   (`can_see_space`). Se a lista pode apontar para aquela pasta, quem diz é a
 *   chave composta `lists_folder_same_space_fk`. Se ela pode mudar de espaço,
 *   quem diz são `lists_tag_space_guard` (F17.4b) e `lists_workflow_guard`
 *   (F17.3c). Se a esteira nova serve, quem diz é `create_status_set` mais o
 *   `status_tree_guard`.
 *
 *   Aqui só se monta o comando e se traduz a recusa. Um `if (isSuperadmin)`
 *   neste arquivo seria a dívida 8.1 outra vez — a regra em dois lugares, e a
 *   de cima ficando para trás na primeira mudança.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * POR QUE ESTA LEITURA NÃO É A DE `readTree`
 *   `readTree` (em `server/board.ts`) parte da view `ideworks.tree`, que começa
 *   em `lists`. Ela responde a pergunta do QUADRO — "que listas vivas eu
 *   alcanço" — e é incapaz de mostrar espaço sem lista, pasta sem lista e
 *   qualquer coisa arquivada. Os três são exatamente o que esta etapa cria e
 *   desarquiva.
 *
 *   As duas continuam existindo e uma prova as obriga a concordar:
 *   `scripts/provar-arvore-na-tela.mjs` confere lista por lista e contagem por
 *   contagem. A liveness da LISTA continua saindo de `tree.is_live` nas duas —
 *   a corrente inteira é calculada num lugar só.
 *
 * ESCRITA RECUSADA POR POLÍTICA NEM SEMPRE LEVANTA ERRO
 *   No `insert`, o `with check` recusa e o Postgres levanta `42501`. No
 *   `update`, o `using` FILTRA: nenhuma linha é tocada, nenhum erro sobe, e o
 *   servidor devolveria "salvo" para uma escrita que não aconteceu. Por isso
 *   todo `update` daqui usa `returning` e trata zero linha como recusa — e
 *   pergunta de novo, com `select`, para saber se foi falta de alcance ou falta
 *   de permissão, e dizer qual dos dois.
 */

import type {
  AcessoDoNo,
  ArvoreCompleta,
  ClienteParaTrazer,
  DestinoDeEtapa,
  Empresa,
  FullTreeRow,
  NivelDeAcesso,
  PessoaComNivel,
  StatusEmEdicao,
} from '@/board/arvore';
import { BoardRefused } from '@/server/board';
import { type Sql, type Tx, comoJson, withActor } from '@/server/db';
import { estaOmitida, recorteAtivo, recorteDasOmitidas } from '@/server/omitidas';
import { emPortugues } from '@/server/recusas';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

/* ───────────────────────────── a recusa, em português ───────────────────── */

/** A frase do Postgres quando a política de linha barra um `insert`. */
const E_POLITICA = /row-level security|permission denied/i;

const NOME_DO_NIVEL = {
  space: 'espaço',
  folder: 'pasta',
  list: 'lista',
} as const;

type Nivel = keyof typeof NOME_DO_NIVEL;

/**
 * A frase que a tela mostra quando o banco recusa.
 *
 * OS DEZ GATILHOS DA F17 ESCREVEM MENSAGENS LONGAS DE PROPÓSITO: elas nomeiam a
 * tarefa, a etiqueta e o espaço que estão no caminho, e dizem o que fazer.
 * Trocá-las por "não foi possível mover" jogaria fora o trabalho de três etapas
 * inteiras. Então a frase do banco passa INTEIRA, e só o que o Postgres escreve
 * em inglês genérico é substituído.
 */
function traduzir(erro: unknown, nivel: Nivel): never {
  const e = erro as { code?: string; message?: string; constraint_name?: string };
  const frase = (e.message ?? '').split('\n')[0];
  // A MESMA FRASE, DITA PARA GENTE (F17.19). A original continua servindo para
  // reconhecer a recusa da POLÍTICA logo abaixo — ela vem em inglês, e é por ela
  // que se decide entre "só administrador" e "fora do seu alcance".
  const paraGente = emPortugues(frase);
  const coisa = NOME_DO_NIVEL[nivel];

  if (e.constraint_name === 'spaces_name_not_blank') {
    throw new BoardRefused('O espaço precisa de um nome.', 400);
  }
  if (e.constraint_name === 'folders_name_not_blank') {
    throw new BoardRefused('A pasta precisa de um nome.', 400);
  }
  if (e.constraint_name === 'lists_name_not_blank') {
    throw new BoardRefused('A lista precisa de um nome.', 400);
  }

  // A chave composta da F17.1: a lista não pode apontar para pasta de outro
  // espaço. É declarativa, não é gatilho — e por isso a frase é nossa.
  if (e.constraint_name === 'lists_folder_same_space_fk') {
    throw new BoardRefused(
      'A pasta escolhida não é desse espaço. Uma lista só entra em pasta do próprio espaço — o banco recusa por chave, não por conferência. Nada foi movido.',
      400,
    );
  }

  // `tasks_status_fk` é `on delete restrict`: apagar a esteira de uma lista que
  // tem tarefa parada num status dela é o que ele impede.
  if (e.constraint_name === 'tasks_status_fk') {
    // ⚠️ "OU CONCLUA" SAIU DAQUI NA F17.19, E NÃO FOI ESTILO.
    // Concluir NÃO solta a tarefa da etapa: ela continua apontando para a mesma
    // linha, e a chave estrangeira recusa de novo. A frase antiga mandava a
    // pessoa fazer um trabalho que não muda nada — e ela fazia.
    throw new BoardRefused(
      'Há tarefa parada numa etapa desta esteira, e o banco não deixa apagá-la enquanto isso. Diga para qual etapa essas tarefas vão, e a mudança passa. Nada foi mudado.',
      400,
    );
  }
  if (e.constraint_name === 'tasks_list_fk') {
    throw new BoardRefused(
      'Esta lista tem tarefas, e o banco não deixa apagá-la. Arquive-a: arquivar esconde sem destruir, e desarquivar traz tudo de volta.',
      400,
    );
  }

  // O índice único `lists_client_key` saiu na F17.83: o mesmo cliente pode ter
  // N listas no mesmo espaço. Não há mais recusa 409 desse índice para traduzir.

  if (e.code === '23505') {
    throw new BoardRefused(`Já existe ${coisa === 'espaço' ? 'um' : 'uma'} ${coisa} assim.`, 400);
  }

  // Os dez gatilhos da F17: `23514` e `22023`. A frase é deles — passada pelo
  // tradutor da F17.19, que tira nome de função e de tabela do caminho do olho.
  if (e.code === '23514' || e.code === '22023') {
    throw new BoardRefused(paraGente || 'Escrita recusada pelo banco.', 400);
  }

  if (e.code === '42501') {
    if (E_POLITICA.test(frase) || frase === '') {
      throw new BoardRefused(
        nivel === 'space'
          ? // ⚠️ A F17.54 acrescentou a SEGUNDA metade da frase, e ela não é
            // enfeite: desde ela `spaces_write` exige administrar o sistema E
            // alcançar a empresa do espaço. Sem a segunda metade, um
            // administrador que escolhesse uma empresa que não é dele leria
            // "só administrador cria espaço" — sendo administrador —, e
            // procuraria o defeito onde ele não está.
            'Só administrador cria ou edita espaço, e só nas empresas em que ele está. Pasta e lista você pode criar — o espaço é estrutural, e a política do banco reserva ele para quem administra a empresa dele.'
          : `Este ${coisa} está fora do seu alcance: você só mexe nos espaços das empresas em que está.`,
        403,
      );
    }
    throw new BoardRefused(paraGente, 403);
  }

  throw erro;
}

/* ──────────────────── a recusa que vira PERGUNTA (F17.19) ─────────────────── */

/**
 * A única recusa deste arquivo que a tela não mostra: ela PERGUNTA.
 *
 * `ideworks.set_list_workflow` recusa apagar etapa que tem tarefa dentro sem
 * dizer para onde as tarefas vão — e a recusa termina com `sem destino: a | b`.
 * Recusar aqui seria trancar a porta com a chave do lado de dentro: quem quer
 * apagar a etapa sabe para onde mandar as tarefas, só não foi perguntado.
 *
 * O `409` não é enfeite: `400` significaria "seu pedido está errado", e o
 * pedido não está — ele está INCOMPLETO, e o servidor sabe exatamente o que
 * falta. É a mesma distinção que o `409` das ações destrutivas do Sistema IDE
 * faz quando devolve a prévia antes de executar.
 */
export class PrecisaDeDestino extends BoardRefused {
  readonly semDestino: readonly string[];

  constructor(semDestino: readonly string[]) {
    super(
      semDestino.length === 1
        ? `Há tarefa parada na etapa “${semDestino[0]}”, que a esteira nova não tem. Diga para onde essas tarefas vão.`
        : `Há tarefa parada em etapas que a esteira nova não tem: ${semDestino
            .map((n) => `“${n}”`)
            .join(', ')}. Diga para onde essas tarefas vão.`,
      409,
    );
    this.name = 'PrecisaDeDestino';
    this.semDestino = semDestino;
  }
}

/** `… Nada foi mudado. sem destino: a fazer | revisão` → `['a fazer', 'revisão']`. */
function etapasSemDestino(erro: unknown): string[] {
  const frase = ((erro as { message?: string }).message ?? '').split('\n')[0];
  const i = frase.indexOf('sem destino:');
  if (i < 0) return [];
  return frase
    .slice(i + 'sem destino:'.length)
    .split('|')
    .map((n) => n.trim())
    .filter((n) => n !== '');
}

/** Zero linha tocada num `update`: o `using` da política filtrou, ou não existe. */
async function recusaDeUpdate(tx: Tx, nivel: Nivel, id: string): Promise<never> {
  const tabela = nivel === 'space' ? 'spaces' : nivel === 'folder' ? 'folders' : 'lists';
  const visivel =
    tabela === 'spaces'
      ? await tx`select 1 from ideworks.spaces where id = ${id}`
      : tabela === 'folders'
        ? await tx`select 1 from ideworks.folders where id = ${id}`
        : await tx`select 1 from ideworks.lists where id = ${id}`;

  if (visivel.length > 0) {
    // Enxerga e não escreve. Hoje só acontece com espaço, e a frase diz por quê.
    throw new BoardRefused(
      nivel === 'space'
        ? 'Só administrador cria ou edita espaço. Você enxerga este espaço, mas não pode alterá-lo.'
        : `Você enxerga ${nivel === 'folder' ? 'esta pasta' : 'esta lista'}, mas não pode alterá-la.`,
      403,
    );
  }

  // Inexistente e fora do alcance respondem igual, de propósito: distinguir os
  // dois contaria que a coisa existe para quem não pode vê-la.
  throw new BoardRefused(
    nivel === 'space'
      ? 'Espaço não encontrado, ou fora do seu alcance.'
      : nivel === 'folder'
        ? 'Pasta não encontrada, ou fora do seu alcance.'
        : 'Lista não encontrada, ou fora do seu alcance.',
    404,
  );
}

const comoNumero = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const comoInstante = (v: unknown): string | null =>
  v === null || v === undefined ? null : new Date(v as string).toISOString();

/* ───────────────────────────── a leitura ───────────────────────────── */

/**
 * A árvore inteira que a pessoa alcança — inclusive o vazio e o arquivado.
 *
 * TRÊS SELECTS EM UNIÃO, E NÃO UM `left join` EM CADEIA.
 *   `spaces left join folders left join lists` parece o caminho óbvio e PERDE a
 *   lista solta: num espaço que tem pastas, o `left join` só produz linhas com
 *   pasta, e a lista de `folder_id` nulo não casa com nenhuma delas. O `Skills`
 *   da referência — lista pendurada direto no espaço — sumiria justamente nos
 *   espaços organizados.
 *
 *   Então: uma linha por LISTA (com a pasta dela, se tiver), uma por PASTA sem
 *   lista, e uma por ESPAÇO sem nada. Cada linha significa uma coisa só.
 *
 * NENHUMA CLÁUSULA DE ALCANCE AQUI. `spaces_select`, `folders_select` e
 * `lists_select` já recortam, e a view `tree` é `security_invoker`.
 */
export async function readFullTree(
  sql: Sql,
  actor: AuthenticatedActor,
): Promise<ArvoreCompleta> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    // As duas consultas (a árvore e as empresas do "Espaço novo") não levam
    // parâmetro e saem na MESMA ida — perf do servidor, 08/10/2026. A das
    // empresas é declarada aqui em cima só para entrar na mesma leva.
    const consultaDasEmpresas = tx`
      select c.id, c.name
        from ideworks.client_categories c
       order by c.sort_order, lower(c.name)`;

    const consultaDaArvore = tx`
      with lista as (
        select s.id as space_id, s.name as space_name, s.color as space_color,
               s.sort_order as space_sort_order, s.archived_at as space_archived_at,
               s.category_id, c.name as category_name,
               f.id as folder_id, f.name as folder_name,
               f.sort_order as folder_sort_order, f.archived_at as folder_archived_at,
               l.id as list_id, l.name as list_name, l.content as list_content,
               l.sort_order as list_sort_order, l.archived_at as list_archived_at,
               l.client_id,
               -- F38, Fase 7: a marca "exige cliente" (lista compartilhada).
               coalesce(l.requires_client, false) as requires_client,
               -- ⚠️ JUNÇÃO À ESQUERDA, E O NOME PODE VIR NULO — F17.43.
               -- A política de leitura de cliente recorta esta junção: quem
               -- alcança a lista mas não alcança o cliente lê o nome nulo, e a
               -- tela mostra a lista sem vínculo. É o comportamento certo — o
               -- vínculo não é caminho de leitura para o cadastro.
               cl.name as client_name,
               coalesce(tr.is_live, false) as list_is_live,
               (select count(*)::int from ideworks.tasks k
                 where k.list_id = l.id
                   and k.archived_at is null
                   and k.completed_at is null) as live_tasks,
               (select count(*)::int from ideworks.tasks k
                 where k.list_id = l.id
                   and k.archived_at is null) as total_tasks,
               w.status_set_name, w.inherited_from
          from ideworks.lists l
          join ideworks.spaces s on s.id = l.space_id
          left join ideworks.client_categories c on c.id = s.category_id
          left join ideworks.folders f on f.id = l.folder_id
          left join ideworks.clients cl on cl.id = l.client_id
          left join ideworks.tree tr on tr.list_id = l.id
          left join lateral (
                 select lw.status_set_name, lw.inherited_from
                   from ideworks.list_workflow lw
                  where lw.list_id = l.id
                  limit 1) w on true
      ),
      pasta_vazia as (
        select s.id, s.name, s.color, s.sort_order, s.archived_at,
               s.category_id, c.name,
               f.id, f.name, f.sort_order, f.archived_at,
               null::uuid, null::text, null::text, null::integer, null::timestamptz,
               null::uuid, false, null::text,
               false, 0, 0, null::text, null::text
          from ideworks.folders f
          join ideworks.spaces s on s.id = f.space_id
          left join ideworks.client_categories c on c.id = s.category_id
         where not exists (select 1 from ideworks.lists l where l.folder_id = f.id)
      ),
      espaco_vazio as (
        select s.id, s.name, s.color, s.sort_order, s.archived_at,
               s.category_id, c.name,
               null::uuid, null::text, null::integer, null::timestamptz,
               null::uuid, null::text, null::text, null::integer, null::timestamptz,
               null::uuid, false, null::text,
               false, 0, 0, null::text, null::text
          from ideworks.spaces s
          left join ideworks.client_categories c on c.id = s.category_id
         where not exists (select 1 from ideworks.folders f where f.space_id = s.id)
           and not exists (select 1 from ideworks.lists   l where l.space_id = s.id)
      )
      select * from lista
      union all select * from pasta_vazia
      union all select * from espaco_vazio
       order by category_name nulls last, space_sort_order, space_name, space_id,
                folder_sort_order nulls first, folder_name, folder_id,
                list_sort_order, list_name`;

    const [linhas, empresas] = await Promise.all([consultaDaArvore, consultaDasEmpresas]);

    // F31 — o que é de empresa omitida não entra na árvore. Filtrado AQUI, e
    // não na consulta: a união de três partes já é a mais delicada do
    // arquivo, e cada linha dela já traz a empresa. Sem omitida, nada sai.
    const spaces: FullTreeRow[] = linhas
      .filter((r) => !estaOmitida(actor, r.category_id as string | null))
      .map((r) => ({
      spaceId: r.space_id as string,
      spaceName: r.space_name as string,
      spaceColor: (r.space_color as string | null) ?? null,
      spaceArchivedAt: comoInstante(r.space_archived_at),
      categoryId: (r.category_id as string | null) ?? null,
      categoryName: (r.category_name as string | null) ?? null,
      folderId: (r.folder_id as string | null) ?? null,
      folderName: (r.folder_name as string | null) ?? null,
      folderArchivedAt: comoInstante(r.folder_archived_at),
      listId: (r.list_id as string | null) ?? null,
      listName: (r.list_name as string | null) ?? null,
      listContent: (r.list_content as string | null) ?? null,
      listArchivedAt: comoInstante(r.list_archived_at),
      listIsLive: r.list_is_live === true,
      liveTasks: comoNumero(r.live_tasks),
      totalTasks: comoNumero(r.total_tasks),
      clientId: (r.client_id as string | null) ?? null,
      clientName: (r.client_name as string | null) ?? null,
      requiresClient: r.requires_client === true,
      workflowName: (r.status_set_name as string | null) ?? null,
      inheritedFrom: (r.inherited_from as FullTreeRow['inheritedFrom']) ?? null,
    }));

    // As empresas, para o seletor de "espaço novo". `categories_select` libera a
    // leitura para quem tem sessão — a empresa não é segredo, e a mesma leitura
    // já existe em `server/meta-contas.ts`. Quem não é administrador vai ver a
    // lista e receber a recusa do banco ao tentar criar: é o desenho pedido
    // desta etapa — mostrar a recusa, não antecipá-la.
    // F31 — nem a empresa omitida é oferecida no "Espaço novo".
    const companies: Empresa[] = empresas
      .filter((c) => !estaOmitida(actor, c.id as string))
      .map((c) => ({
        id: c.id as string,
        name: c.name as string,
      }));

    return { companies, spaces };
  });
}

/* ───────────────────────────── espaço ───────────────────────────── */

export type NoCriado = { id: string; name: string };

/**
 * Criar espaço — e a esteira dele, na mesma transação.
 *
 * ⚠️ O ESPAÇO NASCE COM ESTEIRA, E ISSO NÃO É CONVENIÊNCIA.
 *   Uma lista resolve a esteira por lista → pasta → espaço. Espaço sem conjunto
 *   de status nenhum produz lista sem esteira, e `readBoard` recusa essa lista
 *   com "o quadro não tem coluna nenhuma". Ou seja: um espaço sem esteira
 *   nasceria morto, e a primeira lista criada dentro dele abriria uma tela de
 *   erro.
 *
 *   No ClickUp o espaço também nasce com status — não existe espaço sem eles. A
 *   esteira padrão é a mesma das duas reais da casa (`a fazer` → `concluída`),
 *   e a lista pode trocar a dela depois.
 */
export async function createSpace(
  sql: Sql,
  actor: AuthenticatedActor,
  entrada: {
    categoryId: string;
    name: string;
    statuses: readonly StatusEmEdicao[];
    /** O nome da esteira — o do molde escolhido. Ausente vira `Padrão`. */
    workflowName?: string;
  },
): Promise<NoCriado> {
  const nome = entrada.name.trim();
  if (nome === '') throw new BoardRefused('O espaço precisa de um nome.', 400);

  const nomeDaEsteira = (entrada.workflowName ?? '').trim() || 'Padrão';

  // F31 — nada nasce em empresa omitida. A MESMA recusa de empresa que não
  // existe: a tela não a oferece, e quem forjar o pedido não descobre nada.
  if (estaOmitida(actor, entrada.categoryId)) {
    throw new BoardRefused('Empresa não encontrada.', 404);
  }

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const [criado] = await tx`
        insert into ideworks.spaces (category_id, name, created_by)
        values (${entrada.categoryId}, ${nome}, ${actor.userId})
        returning id, name`;

      if (!criado) throw new BoardRefused('Empresa não encontrada.', 404);

      await tx`
        select ideworks.create_status_set(
          ${nomeDaEsteira},
          ${comoJson(tx, entrada.statuses)}::jsonb,
          ${criado.id as string}, null::uuid, null::uuid, null::text, ${actor.userId})`;

      // A mesma rede de `createList`, e pela mesma razão — ver o comentário lá.
      await tx`set constraints all immediate`;
      await tx`set constraints all deferred`;

      return { id: criado.id as string, name: criado.name as string };
    } catch (erro) {
      if (erro instanceof BoardRefused) throw erro;
      traduzir(erro, 'space');
    }
  });
}

export type PatchDeNo = { name?: string; archived?: boolean };

export async function patchSpace(
  sql: Sql,
  actor: AuthenticatedActor,
  spaceId: string,
  mudou: PatchDeNo,
): Promise<NoCriado> {
  if (mudou.name !== undefined && mudou.name.trim() === '') {
    throw new BoardRefused('O espaço precisa de um nome.', 400);
  }

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      let linha: Record<string, unknown> | undefined;

      if (mudou.name !== undefined) {
        [linha] = await tx`
          update ideworks.spaces
             set name = ${mudou.name.trim()}, updated_at = now()
           where id = ${spaceId}
          returning id, name`;
        if (!linha) await recusaDeUpdate(tx, 'space', spaceId);
      }

      if (mudou.archived !== undefined) {
        // Instante, não booleano — e ele NÃO desce para pastas e listas. Ver a
        // F17.1: "arquivado desde quando" viraria ficção se o desarquivamento
        // trouxesse junto o que já estava arquivado antes.
        [linha] = await tx`
          update ideworks.spaces
             set archived_at = (case when ${mudou.archived}::boolean then now() end),
                 updated_at = now()
           where id = ${spaceId}
          returning id, name`;
        if (!linha) await recusaDeUpdate(tx, 'space', spaceId);
      }

      if (!linha) throw new BoardRefused('Nada a mudar.', 400);
      return { id: linha.id as string, name: linha.name as string };
    } catch (erro) {
      if (erro instanceof BoardRefused) throw erro;
      traduzir(erro, 'space');
    }
  });
}

/* ───────────────────────────── pasta ───────────────────────────── */

export async function createFolder(
  sql: Sql,
  actor: AuthenticatedActor,
  spaceId: string,
  name: string,
): Promise<NoCriado> {
  const nome = name.trim();
  if (nome === '') throw new BoardRefused('A pasta precisa de um nome.', 400);

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const [criada] = await tx`
        insert into ideworks.folders (space_id, name, created_by)
        values (${spaceId}, ${nome}, ${actor.userId})
        returning id, name`;

      if (!criada) throw new BoardRefused('Espaço não encontrado, ou fora do seu alcance.', 403);
      return { id: criada.id as string, name: criada.name as string };
    } catch (erro) {
      if (erro instanceof BoardRefused) throw erro;
      traduzir(erro, 'folder');
    }
  });
}

export async function patchFolder(
  sql: Sql,
  actor: AuthenticatedActor,
  folderId: string,
  mudou: PatchDeNo,
): Promise<NoCriado> {
  if (mudou.name !== undefined && mudou.name.trim() === '') {
    throw new BoardRefused('A pasta precisa de um nome.', 400);
  }

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      let linha: Record<string, unknown> | undefined;

      if (mudou.name !== undefined) {
        [linha] = await tx`
          update ideworks.folders
             set name = ${mudou.name.trim()}, updated_at = now()
           where id = ${folderId}
          returning id, name`;
        if (!linha) await recusaDeUpdate(tx, 'folder', folderId);
      }

      if (mudou.archived !== undefined) {
        [linha] = await tx`
          update ideworks.folders
             set archived_at = (case when ${mudou.archived}::boolean then now() end),
                 updated_at = now()
           where id = ${folderId}
          returning id, name`;
        if (!linha) await recusaDeUpdate(tx, 'folder', folderId);
      }

      if (!linha) throw new BoardRefused('Nada a mudar.', 400);
      return { id: linha.id as string, name: linha.name as string };
    } catch (erro) {
      if (erro instanceof BoardRefused) throw erro;
      traduzir(erro, 'folder');
    }
  });
}

/* ───────────────────────────── lista ───────────────────────────── */

/**
 * Criar lista — e, se for pedida, a esteira PRÓPRIA dela, na mesma transação.
 *
 * ⚠️ A ESTEIRA ENTRA NO MESMO BLOCO PORQUE ELA É PARTE DO ATO (regra 9).
 *   Acrescentado na F17.16. A alternativa — criar a lista, responder, e a tela
 *   chamar `POST /lists/:id/workflow` em seguida — tem um estado intermediário
 *   real: a segunda chamada pode falhar (rede, recusa de `create_status_set`) e
 *   deixar uma lista existindo com a esteira ERRADA, herdada, sem que ninguém
 *   tenha pedido isso. Quem criou uma lista `Vídeo` acharia que ela tem dez
 *   colunas e encontraria duas.
 *
 *   `withActor` é `sql.begin`: se a esteira for recusada, a lista não nasce.
 *
 * SEM `workflow`, NADA MUDA — e é o padrão.
 *   A lista continua nascendo SEM conjunto próprio e resolvendo por pasta →
 *   espaço, que é como as duas listas reais funcionam hoje. `Herdar` não é um
 *   molde vazio; é a ausência de molde.
 */
export async function createList(
  sql: Sql,
  actor: AuthenticatedActor,
  spaceId: string,
  entrada: {
    name: string;
    folderId: string | null;
    workflow?: { name: string; statuses: readonly StatusEmEdicao[] } | null;
  },
): Promise<NoCriado> {
  const nome = entrada.name.trim();
  if (nome === '') throw new BoardRefused('A lista precisa de um nome.', 400);

  const esteira = entrada.workflow ?? null;
  if (esteira !== null && esteira.name.trim() === '') {
    throw new BoardRefused('A esteira precisa de um nome.', 400);
  }

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      // As DUAS colunas juntas, sempre. Com `folder_id` nulo a chave composta
      // fica satisfeita por definição e a lista nasce solta no espaço — o
      // `Skills` da referência.
      const [criada] = await tx`
        insert into ideworks.lists (space_id, folder_id, name, created_by)
        values (${spaceId}, ${entrada.folderId}, ${nome}, ${actor.userId})
        returning id, name`;

      if (!criada) throw new BoardRefused('Espaço não encontrado, ou fora do seu alcance.', 403);

      if (esteira !== null) {
        // A lista de status vai CRUA para a função do banco, que confere tipo
        // por tipo e recusa esteira sem exatamente um status que fecha. Filtrar
        // aqui daria uma segunda conferência, mais fraca — e a frase que a tela
        // mostra é a dela.
        await tx`
          select ideworks.create_status_set(
            ${esteira.name.trim()},
            ${comoJson(tx, esteira.statuses)}::jsonb,
            null::uuid, null::uuid, ${criada.id as string}, null::text, ${actor.userId})`;

        // ⚠️ O GUARDA DA ÁRVORE FALA AQUI, E NÃO NO `commit` — F17.19.
        // Ele virou gatilho de restrição diferido, e `withActor` fecha a
        // transação DEPOIS deste `try`: sem estas duas linhas uma recusa dele
        // escaparia do `traduzir` e chegaria à tela como erro de servidor, sem
        // frase e sem código. Hoje a lista nasce vazia e ele não tem o que
        // recusar; a rede é para quando isso deixar de ser verdade.
        // O modo volta ao diferido, pelo motivo medido na F17.19b.
        await tx`set constraints all immediate`;
        await tx`set constraints all deferred`;
      }

      return { id: criada.id as string, name: criada.name as string };
    } catch (erro) {
      if (erro instanceof BoardRefused) throw erro;
      traduzir(erro, 'list');
    }
  });
}

/* ─────────────────── os clientes que entram no quadro (F17.43) ───────────── */

/**
 * Que clientes dá para trazer para ESTE espaço.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NENHUM RECORTE DE ALCANCE É ESCRITO AQUI.
 *   `clients_select` já responde "que clientes eu enxergo", e é a MESMA regra
 *   que a ficha, o painel e a carteira usam. Repetir a conta com um `join` em
 *   `user_clients` daria uma segunda versão dela — e é exatamente o defeito
 *   que a F17.32 encontrou em produção, 61 contas visíveis para quem não devia.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A CAIXA INFORMA, NÃO ESCONDE.
 *   A unicidade por espaço saiu na F17.83; trazer de novo cria a segunda
 *   lista. Esconder quem já veio seria a caixa mentindo sobre o que o sistema
 *   permite. Quem já tem lista neste espaço volta com `listCountInSpace`.
 *
 * A CONTAGEM SAI DESTA CONSULTA, E NÃO DE UMA SEGUNDA IDA.
 *   `count(l.id)` no `left join` das listas DESTE espaço. Recalcular na tela
 *   — olhando a árvore, filtrando pasta, somando de outro espaço — daria uma
 *   segunda opinião, e ela ficaria para trás na primeira aba deixada aberta.
 *
 *   A lista ARQUIVADA continua contando. A regra está em
 *   `contarListasDoClienteNoEspaco`: arquivar não desfaz o vínculo, e o selo
 *   responde existência neste espaço, não "está viva". Sem `archived_at is
 *   null` de propósito — se a arquivada não contasse, a caixa diria que o
 *   cliente nunca veio enquanto a lista dele dorme no arquivo.
 */
export async function readClientsForSpace(
  sql: Sql,
  actor: AuthenticatedActor,
  spaceId: string,
): Promise<{ clients: ClienteParaTrazer[] }> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    // O espaço primeiro: sem ele, a resposta seria a lista inteira de clientes
    // para um lugar onde nada poderá ser criado.
    const [espaco] = await tx`select 1 from ideworks.spaces where id = ${spaceId}`;
    if (!espaco) {
      throw new BoardRefused('Espaço não encontrado, ou fora do seu alcance.', 404);
    }

    // F31 — cliente de empresa omitida não é oferecido para trazer.
    const linhas = await tx`
      select c.id, c.name, c.is_active,
             count(l.id)::int as list_count_in_space
        from ideworks.clients c
        left join ideworks.lists l
          on l.client_id = c.id and l.space_id = ${spaceId}
       ${recorteDasOmitidas(tx, actor, (ids) => tx`where c.category_id <> all(${ids}::uuid[])`)}
       group by c.id, c.name, c.is_active
       order by c.is_active desc, lower(c.name)`;

    return {
      // Cliente inativo não é oferecido para trazer: ele saiu da carteira.
      clients: linhas.filter((c) => c.is_active === true).map((c) => ({
        id: c.id as string,
        name: c.name as string,
        active: c.is_active === true,
        listCountInSpace: comoNumero(c.list_count_in_space),
      })),
    };
  });
}

export type ListaDeCliente = { id: string; name: string; clientId: string };

/**
 * Trazer clientes para o quadro: uma lista por cliente, com o VÍNCULO.
 *
 * ⚠️ O NOME VEM DO CLIENTE, LIDO AQUI E NÃO MANDADO PELA TELA.
 *   Se o nome viesse do navegador, uma aba aberta há uma semana criaria a lista
 *   com o nome antigo do cliente — e o vínculo diria uma coisa enquanto o nome
 *   dizia outra. Ler na mesma transação em que se grava é o que faz os dois
 *   nascerem concordando.
 *
 * ⚠️ O IDENTIFICADOR NASCE AQUI, E NÃO NO `returning` — a lição da F17.32b.
 *   `lists_select` pergunta a `can_act_on_chain`, que é `stable`: ela enxerga o
 *   retrato de ANTES da instrução, e a linha que está nascendo não está nele.
 *   `insert ... returning id` seria recusado com `42501` mesmo para quem
 *   alcança o espaço — foi assim que `client-write.ts` e `meta-conexoes.ts`
 *   pararam de funcionar, e o conserto dos dois foi este.
 *
 * ⚠️ UMA TRANSAÇÃO SÓ, PARA VINTE CLIENTES.
 *   `withActor` é `sql.begin`. Se o décimo for recusado, nenhum dos dez
 *   primeiros fica: trazer vinte clientes e receber onze listas seria pior do
 *   que não trazer nenhum, porque ninguém saberia quais faltaram.
 *
 * O QUE ESTA FUNÇÃO NÃO DECIDE
 *   Quem pode criar lista (`lists_write`), e quem pode ligar a lista àquele
 *   cliente (`lists_client_reach_guard`). Os dois são do banco. O que este
 *   arquivo faz é ler os nomes pela política e traduzir a recusa.
 */
export async function bringClients(
  sql: Sql,
  actor: AuthenticatedActor,
  spaceId: string,
  entrada: { folderId: string | null; clientIds: readonly string[] },
): Promise<{ created: ListaDeCliente[] }> {
  const pedidos = [...new Set(entrada.clientIds)];
  if (pedidos.length === 0) {
    throw new BoardRefused('Escolha ao menos um cliente para trazer.', 400);
  }

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      // Recortado por `clients_select`: cliente fora do alcance não volta, e a
      // conta abaixo denuncia a diferença em vez de criar a lista sem ele.
      // F31 — cliente de empresa omitida conta como fora do alcance: a
      // diferença abaixo recusa o lote inteiro, sem dizer qual.
      const achados = await tx`
        select c.id, c.name
          from ideworks.clients c
         where c.id = any(${pedidos}::uuid[])
           ${recorteDasOmitidas(tx, actor, (ids) => tx`and c.category_id <> all(${ids}::uuid[])`)}
         order by lower(c.name)`;

      if (achados.length !== pedidos.length) {
        throw new BoardRefused(
          'Algum cliente escolhido não está mais ao seu alcance. Recarregue a escolha e tente de novo — nada foi criado.',
          403,
        );
      }

      const criadas: ListaDeCliente[] = achados.map((c) => ({
        id: crypto.randomUUID(),
        name: c.name as string,
        clientId: c.id as string,
      }));

      // As DUAS colunas da chave composta juntas, sempre — mesma razão de
      // `createList`. Com `folder_id` nulo a lista nasce solta no espaço.
      await tx`
        insert into ideworks.lists ${tx(
          criadas.map((l) => ({
            id: l.id,
            space_id: spaceId,
            folder_id: entrada.folderId,
            name: l.name,
            client_id: l.clientId,
            created_by: actor.userId,
          })),
          'id',
          'space_id',
          'folder_id',
          'name',
          'client_id',
          'created_by',
        )}`;

      // A mesma rede de `createSpace` e `createList`: os guardas diferidos da
      // F17 falam no `commit`, que acontece DEPOIS deste `try`. Sem estas duas
      // linhas uma recusa deles escaparia do tradutor e chegaria à tela como
      // erro de servidor, sem frase e sem código.
      await tx`set constraints all immediate`;
      await tx`set constraints all deferred`;

      return { created: criadas };
    } catch (erro) {
      if (erro instanceof BoardRefused) throw erro;
      traduzir(erro, 'list');
    }
  });
}

export type PatchDeLista = PatchDeNo & {
  content?: string | null;
  /**
   * A marca "exige cliente" — F38, Fase 7. Só faz sentido em lista SEM
   * cliente (a de cliente já dá o cliente à tarefa), e só ADMINISTRADOR liga
   * ou desliga: quem confere o papel é o Worker, antes de chamar aqui.
   */
  requiresClient?: boolean;
  /** Mover: as duas viajam JUNTAS, e `folderId` nulo é a raiz do espaço. */
  mover?: { spaceId: string; folderId: string | null };
};

/**
 * Renomear, arquivar e MOVER a lista.
 *
 * ⚠️ O MOVIMENTO MENCIONA AS DUAS COLUNAS NUMA ESCRITA SÓ.
 *   `lists_tag_space_guard` (F17.4b) dispara `before update of space_id`;
 *   `lists_workflow_guard` (F17.3c) dispara `after update of space_id,
 *   folder_id`. Os dois disparam pela MENÇÃO da coluna. Escrever `space_id`
 *   numa instrução e `folder_id` na seguinte deixaria a lista, entre as duas,
 *   apontando para uma pasta de outro espaço — estado que a chave composta
 *   recusaria, e com razão.
 *
 *   Renomear e arquivar NÃO mencionam as duas colunas, e por isso não pagam a
 *   varredura de etiquetas nem a de status. É o motivo de este arquivo montar
 *   três instruções separadas em vez de um `update` genérico com todas as
 *   colunas.
 */
export async function patchList(
  sql: Sql,
  actor: AuthenticatedActor,
  listId: string,
  mudou: PatchDeLista,
): Promise<NoCriado> {
  if (mudou.name !== undefined && mudou.name.trim() === '') {
    throw new BoardRefused('A lista precisa de um nome.', 400);
  }

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      let linha: Record<string, unknown> | undefined;

      if (mudou.name !== undefined) {
        [linha] = await tx`
          update ideworks.lists
             set name = ${mudou.name.trim()}, updated_at = now()
           where id = ${listId}
          returning id, name`;
        if (!linha) await recusaDeUpdate(tx, 'list', listId);
      }

      if (mudou.content !== undefined) {
        const texto = mudou.content === null ? null : mudou.content.trim() || null;
        [linha] = await tx`
          update ideworks.lists
             set content = ${texto}, updated_at = now()
           where id = ${listId}
          returning id, name`;
        if (!linha) await recusaDeUpdate(tx, 'list', listId);
      }

      if (mudou.mover !== undefined) {
        // F31 — mover para espaço de empresa omitida é mover para um espaço
        // que, para quem move, não existe. Mesma frase de espaço fora do
        // alcance; nada é escrito.
        if (recorteAtivo(actor)) {
          const [destino] = await tx`
            select s.category_id from ideworks.spaces s where s.id = ${mudou.mover.spaceId}`;
          if (destino && estaOmitida(actor, destino.category_id as string)) {
            throw new BoardRefused('Espaço não encontrado, ou fora do seu alcance.', 404);
          }
        }
        [linha] = await tx`
          update ideworks.lists
             set space_id  = ${mudou.mover.spaceId},
                 folder_id = ${mudou.mover.folderId},
                 updated_at = now()
           where id = ${listId}
          returning id, name`;
        if (!linha) await recusaDeUpdate(tx, 'list', listId);
      }

      if (mudou.requiresClient !== undefined) {
        const [atual] = await tx`select client_id from ideworks.lists where id = ${listId}`;
        if (!atual) await recusaDeUpdate(tx, 'list', listId);
        if (mudou.requiresClient && atual.client_id !== null) {
          throw new BoardRefused(
            'Esta lista já é de um cliente, e a tarefa dela herda esse cliente. A marca "exige cliente" é só para lista sem cliente.',
            400,
          );
        }
        [linha] = await tx`
          update ideworks.lists
             set requires_client = ${mudou.requiresClient}::boolean, updated_at = now()
           where id = ${listId}
          returning id, name`;
        if (!linha) await recusaDeUpdate(tx, 'list', listId);
      }

      if (mudou.archived !== undefined) {
        [linha] = await tx`
          update ideworks.lists
             set archived_at = (case when ${mudou.archived}::boolean then now() end),
                 updated_at = now()
           where id = ${listId}
          returning id, name`;
        if (!linha) await recusaDeUpdate(tx, 'list', listId);
      }

      if (!linha) throw new BoardRefused('Nada a mudar.', 400);
      return { id: linha.id as string, name: linha.name as string };
    } catch (erro) {
      if (erro instanceof BoardRefused) throw erro;
      traduzir(erro, 'list');
    }
  });
}

/**
 * EXCLUIR A LISTA — só depois de arquivada.
 *
 * Arquivar é o passo reversível; excluir é o que vem depois, quando a lista
 * ficou parada e ninguém mais a quer. Por isso a lista viva é recusada: a
 * pessoa precisa ter arquivado antes, e a tela só oferece o item na arquivada.
 *
 * ⚠️ AS TAREFAS VÃO JUNTO. `tasks.list_id` é `on delete restrict`, então a
 * lista só sai depois das tarefas dela (as subtarefas caem por cascata). É uma
 * transação só: ou some tudo, ou nada. A política de escrita de tarefa e de
 * lista continua julgando — quem não pode apagar, é recusado pelo banco.
 */
export async function deleteList(
  sql: Sql,
  actor: AuthenticatedActor,
  listId: string,
): Promise<{ tasks: number }> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const [lista] = await tx`select archived_at from ideworks.lists where id = ${listId}`;
      if (!lista) await recusaDeUpdate(tx, 'list', listId);
      if (lista.archived_at === null) {
        throw new BoardRefused('Arquive a lista antes de excluí-la.', 409);
      }

      const apagadas = await tx`delete from ideworks.tasks where list_id = ${listId} returning id`;
      const [feita] = await tx`delete from ideworks.lists where id = ${listId} returning id`;
      // `using` da política julgou a linha: se sumiu do alcance no meio, nada foi feito.
      if (!feita) throw new BoardRefused('Você não pode excluir esta lista.', 403);
      return { tasks: apagadas.length };
    } catch (erro) {
      if (erro instanceof BoardRefused) throw erro;
      traduzir(erro, 'list');
    }
  });
}

/* ───────────────────────────── a esteira da lista ───────────────────────── */

/**
 * Dar à lista uma esteira PRÓPRIA, ou mexer na que ela já tem.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ ISTO DEIXOU DE SER "APAGAR E CRIAR" NA F17.19.
 *
 *   Era: `delete from status_sets` seguido de `create_status_set`. Funcionava
 *   só com a lista VAZIA. Com tarefa dentro, o `delete` esbarrava em
 *   `tasks_status_fk` ou o `insert` esbarrava no `status_tree_guard` — e o
 *   usuário, que só queria ACRESCENTAR UMA ETAPA numa lista em uso, levava uma
 *   recusa. *"é normal ter que alterar no meio do caminho"*, e era.
 *
 *   Agora quem faz é `ideworks.set_list_workflow`, que mexe no conjunto no
 *   lugar quando ele já é da lista, e migra as tarefas pela identidade da etapa
 *   (ou pelo nome) quando a lista passa a ter esteira própria. O guarda da
 *   F17.3c continua valendo, e a função o força a falar antes de devolver.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A PERGUNTA QUE A TELA PRECISA FAZER
 *   Quando uma etapa que tem tarefa dentro some e nada no pedido diz para onde
 *   essas tarefas vão, o banco recusa com a lista de nomes depois de
 *   `sem destino:`. Aqui essa lista vira `semDestino`, e a tela monta um
 *   seletor por nome em vez de mostrar uma recusa e parar.
 */
export async function setListWorkflow(
  sql: Sql,
  actor: AuthenticatedActor,
  listId: string,
  entrada: {
    name: string;
    statuses: readonly StatusEmEdicao[];
    destinos?: readonly DestinoDeEtapa[];
  },
): Promise<{ statusSetId: string; moved: number; inheritedBefore: boolean }> {
  const nome = entrada.name.trim();
  if (nome === '') throw new BoardRefused('A esteira precisa de um nome.', 400);

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const [feito] = await tx`
        select ideworks.set_list_workflow(
          ${listId},
          ${nome},
          ${comoJson(tx, entrada.statuses)}::jsonb,
          ${comoJson(tx, entrada.destinos ?? [])}::jsonb,
          ${actor.userId}) as r`;

      const r = (feito?.r ?? {}) as {
        status_set_id?: string;
        moved?: number;
        inherited_before?: boolean;
      };
      return {
        statusSetId: r.status_set_id ?? '',
        moved: Number(r.moved ?? 0),
        inheritedBefore: r.inherited_before === true,
      };
    } catch (erro) {
      if (erro instanceof BoardRefused) throw erro;
      const semDestino = etapasSemDestino(erro);
      if (semDestino.length > 0) throw new PrecisaDeDestino(semDestino);
      traduzir(erro, 'list');
    }
  });
}

/** Voltar a herdar: a lista perde a esteira própria e resolve pela pasta ou pelo espaço. */
export async function clearListWorkflow(
  sql: Sql,
  actor: AuthenticatedActor,
  listId: string,
): Promise<{ removed: boolean }> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const apagados = await tx`
        delete from ideworks.status_sets where list_id = ${listId} returning id`;

      if (apagados.length === 0) {
        throw new BoardRefused(
          'Esta lista já não tem esteira própria — ela herda da pasta ou do espaço.',
          400,
        );
      }
      return { removed: true };
    } catch (erro) {
      if (erro instanceof BoardRefused) throw erro;
      traduzir(erro, 'list');
    }
  });
}

/* ───────────────────────────── quem alcança cada nó (F17.23) ────────────── */

/**
 * O acesso de um nó da árvore — quem alcança, em que nível, e se está fechado.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NENHUMA DECISÃO DE ACESSO ACONTECE NESTE ARQUIVO, E AQUI ISSO É CRÍTICO.
 *
 *   Quem responde "esta pessoa alcança?" é `ideworks.node_level`; quem responde
 *   "esta pessoa pode mudar o acesso?" é `ideworks.can_grant_on`; e quem grava
 *   as duas coisas em bloco é `ideworks.set_node_access`. Um `if` de nível neste
 *   arquivo seria a segunda regra de acesso do sistema — a dívida 8.1 do legado
 *   no lugar mais perigoso possível.
 *
 *   `node_access` é `security definer` e RECUSA sozinha quem não alcança o nó.
 *   Este módulo só traduz a recusa para português.
 * ─────────────────────────────────────────────────────────────────────────────
 */
// Os três tipos moram em `board/arvore.ts`, porque a TELA também os usa. Uma
// definição, e não duas que divergem na primeira mudança.
export type { AcessoDoNo, NivelDeAcesso, PessoaComNivel };

/** O nó, na forma que o banco espera: exatamente um dos três preenchido. */
export type NoDeAcesso = { nivel: Nivel; id: string };

const trincaDoNo = (no: NoDeAcesso) =>
  [
    no.nivel === 'space' ? no.id : null,
    no.nivel === 'folder' ? no.id : null,
    no.nivel === 'list' ? no.id : null,
  ] as const;

/**
 * A recusa da função, dita para gente.
 *
 * ⚠️ AS DUAS RECUSAS DE `42501` SÃO DIFERENTES, e dizer a mesma frase para as
 * duas seria mentir numa delas: "não alcanço" e "alcanço mas não posso mudar"
 * mandam a pessoa fazer coisas opostas. O banco as separa pelo texto, e é ele
 * que decide — aqui só se escolhe a frase.
 *
 * Inexistente e fora do alcance respondem IGUAL, de propósito: distinguir os
 * dois contaria que a coisa existe para quem não pode vê-la. É o mesmo critério
 * de `recusaDeUpdate`, acima.
 */
const SUMIU = {
  space: 'Espaço não encontrado, ou fora do seu alcance.',
  folder: 'Pasta não encontrada, ou fora do seu alcance.',
  list: 'Lista não encontrada, ou fora do seu alcance.',
} as const;

function traduzirAcesso(erro: unknown, no: NoDeAcesso): never {
  const e = erro as { code?: string; message?: string };
  const frase = e.message ?? '';

  if (e.code === '42501') {
    if (/nao encontrado/i.test(frase)) {
      throw new BoardRefused(SUMIU[no.nivel], 403);
    }
    throw new BoardRefused(
      'Quem muda quem alcança é quem administra o sistema, quem criou isto, ou quem recebeu o nível de administrar aqui.',
      403,
    );
  }

  throw new BoardRefused(emPortugues(frase) || 'Não foi possível ler quem alcança isto.', 400);
}

export async function readNodeAccess(
  sql: Sql,
  actor: AuthenticatedActor,
  no: NoDeAcesso,
): Promise<AcessoDoNo> {
  const [espaco, pasta, lista] = trincaDoNo(no);

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const [linha] = await tx`
        select ideworks.node_access(${espaco}, ${pasta}, ${lista}) as a`;
      return (linha?.a ?? {}) as AcessoDoNo;
    } catch (erro) {
      traduzirAcesso(erro, no);
    }
  });
}

/**
 * Fechar ou abrir o nó e trocar a lista de quem alcança — numa escrita só.
 *
 * As duas coisas são a MESMA decisão (regra 9): feitas em dois comandos, uma
 * falha no meio deixaria o nó fechado sem ninguém dentro, e trabalho de gente de
 * verdade sumiria da tela sem que ninguém tivesse pedido.
 */
export async function writeNodeAccess(
  sql: Sql,
  actor: AuthenticatedActor,
  no: NoDeAcesso,
  entrada: { restricted: boolean; grants: readonly PessoaComNivel[] },
): Promise<AcessoDoNo> {
  const [espaco, pasta, lista] = trincaDoNo(no);

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const [linha] = await tx`
        select ideworks.set_node_access(
          ${espaco}, ${pasta}, ${lista},
          ${entrada.restricted},
          ${comoJson(
            tx,
            entrada.grants.map((g) => ({ userId: g.userId, level: g.level })),
          )}::jsonb) as a`;
      return (linha?.a ?? {}) as AcessoDoNo;
    } catch (erro) {
      traduzirAcesso(erro, no);
    }
  });
}


/** Reordena listas ativas da mesma pasta, com trava e escrita atômica. */
export async function reorderList(
  sql: Sql, actor: AuthenticatedActor, listId: string, direction: unknown,
): Promise<void> {
  if (!['up', 'down', 'first', 'last'].includes(direction as string)) {
    throw new BoardRefused('Escolha uma posição válida para a lista.', 400);
  }
  await withActor(sql, asDbActor(actor), async (tx) => {
    const [origin] = await tx`
      select l.folder_id, l.space_id, s.category_id
      from ideworks.lists l join ideworks.spaces s on s.id = l.space_id
      where l.id = ${listId} and l.archived_at is null`;
    if (!origin || !origin.folder_id || estaOmitida(actor, origin.category_id as string)) {
      throw new BoardRefused('Lista não encontrada numa pasta disponível.', 404);
    }
    // Serializa reorganizações da pasta antes de ler a ordem atual.
    const [folder] = await tx`
      select id from ideworks.folders where id = ${origin.folder_id as string}
      and archived_at is null
      and ideworks.can_act_on_chain(space_id, id, null, 'create')
      for update`;
    if (!folder) throw new BoardRefused('Você não tem permissão para reorganizar esta pasta.', 403);
    const visible = await tx`
      select id from ideworks.lists where folder_id = ${origin.folder_id as string}
      and space_id = ${origin.space_id as string} and archived_at is null`;
    const rows = await tx`
      select id, name from ideworks.lists
      where folder_id = ${origin.folder_id as string} and space_id = ${origin.space_id as string}
      and archived_at is null
      order by sort_order, name, id for update`;
    if (visible.length !== rows.length || visible.some((r) => !rows.some((locked) => locked.id === r.id))) {
      throw new BoardRefused('Você precisa de permissão para editar as listas desta pasta. Atualize se a pasta mudou.', 403);
    }
    const ids = rows.map((r) => r.id as string);
    const from = ids.indexOf(listId);
    if (from < 0) throw new BoardRefused('A lista mudou de pasta. Atualize e tente novamente.', 409);
    const to = direction === 'first' ? 0 : direction === 'last' ? ids.length - 1
      : Math.max(0, Math.min(ids.length - 1, from + (direction === 'up' ? -1 : 1)));
    if (from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, listId);
    const changed = await tx`
      update ideworks.lists l set sort_order = pos.ord::integer, updated_at = now()
      from unnest(${ids}::uuid[]) with ordinality as pos(id, ord)
      where l.id = pos.id and l.folder_id = ${origin.folder_id as string}
      returning l.id`;
    if (changed.length !== ids.length) {
      throw new BoardRefused('Você precisa de permissão para editar as listas desta pasta.', 403);
    }
  });
}


export async function folderWorkflow(
  sql: Sql, actor: AuthenticatedActor, folderId: string, input: unknown = null,
): Promise<Record<string, unknown>> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    const [folder] = await tx`select s.category_id from ideworks.folders f
      join ideworks.spaces s on s.id=f.space_id where f.id=${folderId}`;
    if (!folder || estaOmitida(actor, folder.category_id as string)) {
      throw new BoardRefused('Pasta não encontrada, ou fora do seu alcance.', 404);
    }
    try {
      const [row] = await tx`select ideworks.folder_workflow(${folderId}::uuid, ${input === null ? null : comoJson(tx,input)}::jsonb) as result`;
      return row.result as Record<string, unknown>;
    } catch (error) {
      const missing = etapasSemDestino(error);
      if (missing.length) throw new PrecisaDeDestino(missing);
      const code = (error as { code?: string }).code;
      if (code === '40001') throw new BoardRefused('As listas ou etapas mudaram. Feche e abra o editor novamente.',409);
      if (code === '23505') throw new BoardRefused('A mudança juntaria automações incompatíveis na mesma etapa. Escolha destinos diferentes ou ajuste as automações.',409);
      traduzir(error, 'folder');
    }
  });
}
