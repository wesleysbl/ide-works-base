/**
 * A entrega — comentário, anexo e link. Etapa F17.6.
 *
 * ARQUIVO PRÓPRIO, PELA MESMA RAZÃO DE `board-passos.ts`
 *   `server/board.ts` lê o quadro, `board-task.ts` escreve a tarefa,
 *   `board-passos.ts` escreve o que está DENTRO dela, e este escreve o que sai
 *   dela — o que a equipe entrega. Quatro arquivos, quatro assuntos.
 *
 * NENHUMA DECISÃO DE DOMÍNIO ACONTECE AQUI
 *   A F17.6 pôs tudo no banco, e quase tudo em forma DECLARATIVA:
 *
 *     "a resposta é de UM nível" ............ `task_comments_parent_fk`
 *     "a resposta é da MESMA tarefa" ........ a mesma chave composta
 *     "apagar o comentário leva a resposta" . `on delete cascade` da mesma
 *     "só o autor edita e apaga" ............ `task_comments_update/delete`
 *     "o corpo não pode ser `{}`" ........... `is_meaningful_name` (F17.4)
 *     "o endereço não executa código" ....... `task_links_url_is_web`
 *     "o arquivo cabe em 5 MB" .............. `task_attachments_size_ceiling`
 *     "quem alcança a tarefa alcança tudo" .. as oito políticas da F17.6
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O BALDE É PRIVADO, E A PORTA É ESTE ARQUIVO
 *
 *   O balde do Sistema IDE legado ERA público — documento de cliente lia-se sem
 *   login, e foi a F17.52 que o fechou. `ideworks-anexos` nunca precisou dessa
 *   correção: nasce `public = false` e sem NENHUMA política permissiva em
 *   `storage.objects`: `anon` e `authenticated` são negados por construção, e
 *   não por configuração.
 *
 *   Consequência: ninguém alcança o balde direto. O caminho é sempre este
 *   arquivo, e ele faz DUAS coisas, nesta ordem, sempre:
 *
 *     1. PERGUNTA AO BANCO se quem age alcança a tarefa. A pergunta é um
 *        `select` em `ideworks.tasks` sob o ator declarado — a política
 *        recorta, e a tarefa fora do alcance simplesmente não aparece. Não há
 *        `if` de permissão aqui, e não pode haver: o alcance vem do banco.
 *
 *     2. SÓ ENTÃO fala com o Storage, com a chave de serviço.
 *
 *   A chave é TRANSPORTE, e não autorização. Se ela virar autorização, a regra
 *   de acesso passa a morar em dois lugares — que é a dívida 8.1 do legado.
 *
 *   NENHUMA URL É PERMANENTE. A leitura sai de URL assinada com prazo
 *   (`PRAZO_DA_ASSINATURA`), e ela sai com `download` — o navegador SALVA em
 *   vez de renderizar. Só imagem e PDF são desenhados na página, e a lista de
 *   quais está em `board/conversa.ts`, não no banco: o banco não tem lista de
 *   permissão de tipo porque a agência anexa `.ai`, `.psd` e `.zip`.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A CHAVE DE SERVIÇO EXISTE — desde 2026-09-01, conferida na F17.52
 *   `IDEWORKS_SERVER_SUPABASE_SERVICE_KEY` está em `.dev.vars` e é segredo do
 *   Worker publicado (`wrangler secret list` a mostra ao lado dos dois segredos
 *   da Meta). O texto que dizia o contrário viveu aqui até a F17.52, e desligou
 *   o envio de documento por um motivo que já não era verdade.
 *
 *   Se ela faltar num ambiente novo, nada quebra em silêncio:
 *
 *     · comentário, resposta, link e o indicador "tem anexo" FUNCIONAM — nada
 *       neles toca no Storage;
 *     · enviar arquivo e abrir arquivo respondem 503 com `SEM_CHAVE`, que
 *       nomeia a variável e diz o que fazer.
 *
 *   Não há caminho alternativo, e a ausência dele é deliberada: um balde
 *   público resolveria o envio hoje e reencenaria a dívida do legado. Ver a
 *   seção "O BALDE" no fim da migration da F17.6.
 *
 * TODA ESCRITA DEVOLVE A FICHA DA TAREFA, RELIDA
 *   Mesma decisão da F17.10 e da F17.15. Escrever um comentário muda
 *   `task_progress.comment_count`, que é o que o cartão do quadro lê; devolver
 *   o que se pediu, em vez do que ficou, faria a tela mostrar um número que não
 *   é o do banco. A releitura é DENTRO da mesma transação — se abrisse a
 *   própria, veria o mundo de antes da escrita.
 */

import { assinaturaDeImagem } from '@/board/colar-imagem';
import { TETO_DE_BYTES, normalizarEndereco, tamanhoLegivel } from '@/board/conversa';
import type { TaskDetail } from '@/board/ficha';
import { BoardRefused } from '@/server/board';
import { lerFicha } from '@/server/board-task';
import { type Sql, type Tx, withActor } from '@/server/db';
import { emPortugues } from '@/server/recusas';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

/**
 * O balde, e a credencial que fala com ele.
 *
 * `serviceKey` é opcional NO TIPO porque ela é opcional NA REALIDADE — e um
 * tipo que a declarasse obrigatória obrigaria o Worker a inventar uma string
 * vazia, que é como um segredo ausente vira um erro incompreensível de HTTP
 * 401 em vez de uma frase que diz o que fazer.
 */
export type ArmazenamentoPrivado = {
  supabaseUrl: string;
  serviceKey?: string;
};

export const BALDE = 'ideworks-anexos';

/**
 * CINCO MINUTOS.
 *
 * Curto o bastante para um endereço vazado num histórico de navegação ou num
 * log de proxy não valer nada amanhã; longo o bastante para o maior anexo que
 * cabe — 5 MB desde a F17.17 — terminar de baixar numa conexão ruim. O ClickUp
 * usa prazo parecido.
 *
 * Ele NÃO é o tempo que a pessoa tem para clicar: a tela pede a assinatura no
 * clique, e não ao carregar a ficha. Uma ficha aberta há uma hora continua
 * funcionando.
 */
export const PRAZO_DA_ASSINATURA = 300;

const SEM_CHAVE =
  'O envio e a leitura de arquivo dependem de IDEWORKS_SERVER_SUPABASE_SERVICE_KEY, ' +
  'que não foi definida neste ambiente. O balde `ideworks-anexos` é PRIVADO — de ' +
  'propósito, e desde a F17.52 o balde de documentos do Sistema IDE também é —, ' +
  'então só o servidor com a chave de serviço alcança os bytes. ' +
  'Defina a chave (Configurações → API → service_role, no painel do Supabase) em ' +
  '`.dev.vars` para desenvolvimento e com `wrangler secret put ' +
  'IDEWORKS_SERVER_SUPABASE_SERVICE_KEY` para o publicado. Comentário e link ' +
  'funcionam sem ela.';

function exigirChave(armazenamento: ArmazenamentoPrivado): string {
  const chave = armazenamento.serviceKey?.trim();
  // 503, e não 500: o serviço não está configurado, e isso não é falha de quem
  // clicou nem defeito do código. A distinção importa para quem lê o log.
  if (!chave) throw new BoardRefused(SEM_CHAVE, 503);
  return chave;
}

/**
 * A frase que a tela mostra quando o banco recusa.
 *
 * AS RESTRIÇÕES DESTA ETAPA TÊM TRADUÇÃO PRÓPRIA, e não é enfeite: um `check`
 * responde `23514` com o nome da restrição e nada mais.
 * `violates check constraint "task_links_url_is_web"` não diz a ninguém que só
 * http e https passam.
 *
 * Os códigos das travas escritas à mão (`42501`, `23514`, `22023`) continuam
 * saindo com a FRASE DO BANCO, inteira — as travas da F17 nomeiam o que está no
 * caminho e o que fazer, e trocá-las por "algo deu errado" jogaria fora o
 * trabalho delas.
 */
function traduzir(erro: unknown): never {
  const e = erro as { code?: string; message?: string; constraint_name?: string };
  const frase = emPortugues(e.message);

  if (e.constraint_name === 'task_comments_body_says_something') {
    throw new BoardRefused(
      'O comentário precisa dizer alguma coisa além de pontuação e espaço — é a mesma trava que impede o `{}` do Trello de nascer aqui.',
      400,
    );
  }
  if (e.constraint_name === 'task_links_url_is_web') {
    throw new BoardRefused(
      'O endereço precisa começar com http:// ou https:// e não pode ter espaço. `javascript:` e `data:` são recusados pelo banco, e não só pela tela.',
      400,
    );
  }
  if (e.constraint_name === 'task_links_label_is_a_name') {
    throw new BoardRefused('Dê ao link um nome que diga o que ele é.', 400);
  }
  if (e.constraint_name === 'task_comments_parent_fk') {
    throw new BoardRefused(
      'A resposta pertence ao comentário que ela responde, e ele tem que estar na mesma tarefa. A conversa tem UM nível: não se responde a uma resposta.',
      400,
    );
  }
  if (e.constraint_name === 'task_attachments_size_ceiling') {
    // O NÚMERO VEM DE `TETO_DE_BYTES`, e não da frase. Escrevê-lo à mão aqui foi
    // o que fez esta linha dizer "25 MB" depois de o teto virar 5 — uma recusa
    // que mente sobre o próprio limite manda a pessoa tentar de novo à toa.
    throw new BoardRefused(
      `O arquivo passa de ${tamanhoLegivel(TETO_DE_BYTES)}. Para algo maior, ponha o link ao lado.`,
      400,
    );
  }
  if (e.constraint_name === 'task_attachments_size_positive') {
    throw new BoardRefused('Arquivo vazio — zero byte é arquivo que não subiu.', 400);
  }
  if (e.constraint_name === 'task_attachments_name_is_a_name') {
    throw new BoardRefused('O arquivo precisa de um nome.', 400);
  }

  if (e.code === '42501') throw new BoardRefused(frase || 'Fora do seu alcance.', 403);
  if (e.code === '22023') throw new BoardRefused(frase || 'Escrita recusada.', 400);
  if (e.code === '23514') throw new BoardRefused(frase || 'Escrita recusada.', 400);
  if (e.code === '23503') throw new BoardRefused(frase || 'Escrita recusada.', 400);
  if (e.code === '23505') {
    throw new BoardRefused('Este arquivo já está guardado com esse caminho.', 409);
  }

  throw erro;
}

/**
 * A tarefa a que este comentário, anexo ou link pertence.
 *
 * A POLÍTICA JÁ RECORTOU: `task_comments_select`, `task_attachments_select` e
 * `task_links_select` chamam `can_reach_task_id`, então uma linha fora do
 * alcance simplesmente não aparece. Ausência aqui é "não existe OU não é sua", e
 * as duas respondem igual de propósito — distinguir contaria que existe.
 */
async function tarefaDoComentario(tx: Tx, id: string): Promise<string> {
  const [l] = await tx`select c.task_id from ideworks.task_comments c where c.id = ${id}`;
  if (!l) throw new BoardRefused('Comentário não encontrado, ou fora do seu alcance.', 404);
  return l.task_id as string;
}

async function tarefaDoLink(tx: Tx, id: string): Promise<string> {
  const [l] = await tx`select k.task_id from ideworks.task_links k where k.id = ${id}`;
  if (!l) throw new BoardRefused('Link não encontrado, ou fora do seu alcance.', 404);
  return l.task_id as string;
}

/* ───────────────────────────── o comentário ───────────────────────────── */

function exigirCorpoDoComentario(body: string): void {
  if (body.trim() === '') {
    throw new BoardRefused('Escreva alguma coisa antes de enviar.', 400);
  }
}

/**
 * Miolo transacional de `postComment` COM a ficha relida — F16.6b.
 *
 * Recebe um `Tx` JÁ ABERTO. Não chama `withActor` nem `sql.begin`. Quem age já
 * foi declarado na transação que envolve esta chamada — a política
 * `task_comments_insert` continua exigindo `acting_user_id()`, e a ficha relê
 * na mesma transação, como antes.
 *
 * POR QUE ELE SE SEPAROU DO MIOLO MAGRO — F23, incidente de 22/09/2026
 *   `lerFicha` custa DOZE consultas. A tela precisa delas: o cartão mostra
 *   contagem de comentário, e a ficha inteira volta com a escrita para o
 *   quadro não ter de pedir de novo.
 *
 *   O caminho do agente jogava essas doze fora. `SQL_COMMENT_MUTATOR.post`
 *   (`src/integrations/writes.ts`) só usa `posted.id` — e pagava a releitura
 *   inteira DENTRO da transação que segura `for update` na concessão. Era a
 *   maior fatia das ~15 idas ao banco de um `add_comment`, e cada uma delas é
 *   tempo de janela aberta.
 *
 *   É o mesmo argumento que `deleteCommentInTx` já escreve logo abaixo: UM
 *   miolo magro, dois chamadores, e a releitura só de quem a usa.
 */
export async function postCommentWithDetailInTx(
  tx: Tx,
  taskId: string | null,
  entrada: { body: string; parentId: string | null },
): Promise<{ id: string; task: TaskDetail }> {
  const { id, taskId: dono } = await postCommentInTx(tx, taskId, entrada);
  try {
    // A ficha da TAREFA, e não a do comentário: é ela que está na tela, e a
    // contagem que o cartão lê muda com esta escrita.
    return { id, task: await lerFicha(tx, dono) };
  } catch (erro) {
    if (erro instanceof BoardRefused) throw erro;
    traduzir(erro);
  }
}

/**
 * O miolo MAGRO: escreve o comentário e devolve o id e a tarefa dona.
 *
 * Nenhuma releitura de ficha aqui. Quem quer a ficha chama
 * `postCommentWithDetailInTx`, que é o que a tela humana faz.
 *
 *   F16.7 — mesmo `Tx` do ledger:
 *   o store SQL de `runAgentWrite` abre UMA `withActor` (Actor com
 *   `integration`) e põe esse `Tx` em `AgentWriteTx.sqlTx`. Dentro de
 *   `mutate`, chamar esta função — nunca o wrapper `postComment`, que abriria
 *   um segundo `begin` fora do registro de execução. O `insertExecution` corre
 *   na mesma transação: falha no ledger desfaz o comentário.
 *
 *   HTTP/MCP `add_comment` usa este miolo via `src/integrations/writes.ts`.
 *
 * A interface humana não muda: `postComment` continua sendo `withActor` +
 * `postCommentWithDetailInTx`, mesma resposta e mesmos erros (`BoardRefused`).
 */
export async function postCommentInTx(
  tx: Tx,
  taskId: string | null,
  entrada: { body: string; parentId: string | null },
): Promise<{ id: string; taskId: string }> {
  exigirCorpoDoComentario(entrada.body);

  try {
    const [criado] = await tx`
      select ideworks.post_task_comment(
               ${taskId}::uuid, ${entrada.body}, ${entrada.parentId}::uuid) as id`;

    const id = criado?.id as string | undefined;
    if (!id) throw new BoardRefused('Não foi possível escrever o comentário.', 400);

    // A tarefa DONA sai do banco, e não do parâmetro: `post_task_comment`
    // tira a tarefa do comentário que está sendo respondido quando `taskId`
    // vem nulo. Resolver isso aqui seria uma segunda versão da regra.
    const [dono] = await tx`
      select c.task_id from ideworks.task_comments c where c.id = ${id}`;

    return { id, taskId: dono!.task_id as string };
  } catch (erro) {
    if (erro instanceof BoardRefused) throw erro;
    traduzir(erro);
  }
}

/**
 * Escrever, e responder.
 *
 * A RESPOSTA NÃO MANDA A TAREFA, e isso é o ponto: `ideworks.post_task_comment`
 * a tira do comentário que está sendo respondido. Resolver isso aqui seria uma
 * segunda versão da regra, e a segunda é sempre a errada.
 *
 * O AUTOR TAMBÉM NÃO SE MANDA. A ação usa `ideworks.acting_user_id()`, e a
 * política `task_comments_insert` exige que ele seja quem age — quem alcança a
 * tarefa não pode postar em nome de outra pessoa. Num sistema onde o comentário
 * É a entrega, isso seria falsificação de entrega.
 *
 * O VAZIO É RECUSADO ANTES DE ABRIR A TRANSAÇÃO. O miolo (`postCommentInTx`)
 * recusa de novo para o caminho do agente, que chama o miolo direto.
 */
export async function postComment(
  sql: Sql,
  actor: AuthenticatedActor,
  taskId: string | null,
  entrada: { body: string; parentId: string | null },
): Promise<{ id: string; task: TaskDetail }> {
  exigirCorpoDoComentario(entrada.body);

  return withActor(sql, asDbActor(actor), (tx) =>
    postCommentWithDetailInTx(tx, taskId, entrada),
  );
}

/**
 * Reescrever o próprio comentário.
 *
 * NÃO HÁ CONFERÊNCIA DE AUTOR AQUI, e a ausência é o desenho: quem filtra é a
 * política `task_comments_update`, que exige `author_id = acting_user_id()`. Um
 * `if (comentario.author_id !== actor.userId)` seria uma segunda regra de
 * acesso — e a segunda é a que fica para trás na primeira mudança.
 */
export async function editComment(
  sql: Sql,
  actor: AuthenticatedActor,
  commentId: string,
  body: string,
): Promise<TaskDetail> {
  if (body.trim() === '') {
    throw new BoardRefused('Um comentário vazio não é uma edição — apague-o.', 400);
  }

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const taskId = await tarefaDoComentario(tx, commentId);
      await tx`select ideworks.edit_task_comment(${commentId}, ${body})`;
      return await lerFicha(tx, taskId);
    } catch (erro) {
      if (erro instanceof BoardRefused) throw erro;
      traduzir(erro);
    }
  });
}

/**
 * Apagar o próprio comentário — e as respostas dele, pela cascata.
 *
 * `task_comments_parent_fk on delete cascade` leva as respostas junto. É o
 * comportamento do ClickUp, e é o único coerente: uma resposta sem a fala que
 * ela responde é um fragmento sem contexto.
 *
 * ATENÇÃO, e está aqui porque é assimétrico: as respostas caem MESMO SENDO DE
 * OUTRA PESSOA. A política protege cada linha de ser editada por quem não a
 * escreveu, mas a cascata é uma ação referencial — ela não passa por política.
 * Quem apaga o próprio comentário apaga o que penduraram nele. A tela avisa
 * antes, com o número.
 */
export async function deleteComment(
  sql: Sql,
  actor: AuthenticatedActor,
  commentId: string,
): Promise<TaskDetail> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    const { taskId } = await deleteCommentInTx(tx, commentId);
    try {
      return await lerFicha(tx, taskId);
    } catch (erro) {
      if (erro instanceof BoardRefused) throw erro;
      traduzir(erro);
    }
  });
}

/**
 * O MIOLO do apagar, no `Tx` de quem chama — mesmo padrão de
 * `postCommentInTx` (F16.6b).
 *
 * POR QUE O MIOLO EXISTE (F21.2)
 *   O desfazer em lote do dono apaga vários comentários de uma concessão e
 *   marca o ledger na MESMA transação. Ele não pode chamar `deleteComment`,
 *   que abriria um `withActor` por comentário: cada um confirmaria sozinho, e
 *   a falha ao marcar o ledger deixaria comentários apagados sem registro do
 *   desfazer. Um segundo `delete from task_comments` escrito no lote seria
 *   pior ainda — uma segunda regra de exclusão, e a segunda é a que fica para
 *   trás. Por isso: UM miolo, dois chamadores.
 *
 * A ficha relida NÃO sai daqui. Quem apaga um comentário pela tela quer a
 * ficha; quem apaga cinquenta em lote releria a mesma tarefa cinquenta vezes.
 */
export async function deleteCommentInTx(
  tx: Tx,
  commentId: string,
): Promise<{ taskId: string }> {
  try {
    const taskId = await tarefaDoComentario(tx, commentId);

    const apagados = await tx`
      delete from ideworks.task_comments where id = ${commentId} returning id`;

    // `task_comments_delete` filtra em SILÊNCIO — o `using` de um `delete`
    // não levanta erro, ele simplesmente não alcança a linha. Sem o
    // `returning`, apagar o comentário alheio pareceria ter funcionado.
    if (apagados.length === 0) {
      throw new BoardRefused(
        'Só o autor apaga o próprio comentário. Num sistema onde o comentário É a entrega, apagar a fala de outra pessoa é apagar o registro do que foi entregue.',
        403,
      );
    }
    return { taskId };
  } catch (erro) {
    if (erro instanceof BoardRefused) throw erro;
    traduzir(erro);
  }
}

/* ───────────────────────────── o link externo ───────────────────────────── */

/**
 * `www.dropbox.com/x` entra como `https://www.dropbox.com/x`.
 *
 * A NORMALIZAÇÃO É AQUI, E NÃO SÓ NA TELA, porque quem chama a API não é
 * necessariamente a tela — e porque é assim que o comentário real da agência
 * está escrito: endereço cru, sem esquema. `task_links_url_is_web` exige o
 * esquema, então sem isto a digitação natural da equipe seria recusada.
 *
 * O que `normalizarEndereco` recusa é recusado aqui com frase, antes de o
 * `check` do banco responder com o nome de uma restrição.
 */
export async function addLink(
  sql: Sql,
  actor: AuthenticatedActor,
  taskId: string,
  entrada: { label: string; url: string },
): Promise<{ id: string; task: TaskDetail }> {
  const endereco = normalizarEndereco(entrada.url);
  if (endereco === null) {
    throw new BoardRefused(
      'Endereço inválido. Só http e https entram — `javascript:` e `data:` são recusados, no banco e aqui.',
      400,
    );
  }
  if (entrada.label.trim() === '') {
    throw new BoardRefused('Dê ao link um nome que diga o que ele é.', 400);
  }

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const [criado] = await tx`
        select ideworks.add_task_link(${taskId}, ${entrada.label}, ${endereco}) as id`;

      const id = criado?.id as string | undefined;
      if (!id) throw new BoardRefused('Não foi possível guardar o link.', 400);

      return { id, task: await lerFicha(tx, taskId) };
    } catch (erro) {
      if (erro instanceof BoardRefused) throw erro;
      traduzir(erro);
    }
  });
}

/** Campo ausente é campo NÃO MEXIDO — como no `PATCH` da ficha. */
export async function patchLink(
  sql: Sql,
  actor: AuthenticatedActor,
  linkId: string,
  patch: { label?: string; url?: string },
): Promise<TaskDetail> {
  let endereco: string | null = null;
  if (patch.url !== undefined) {
    endereco = normalizarEndereco(patch.url);
    if (endereco === null) {
      throw new BoardRefused(
        'Endereço inválido. Só http e https entram — `javascript:` e `data:` são recusados, no banco e aqui.',
        400,
      );
    }
  }

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const taskId = await tarefaDoLink(tx, linkId);
      const mudados = await tx`
        update ideworks.task_links l
           set label      = case when ${patch.label !== undefined}
                                 then ${patch.label ?? ''}::text else l.label end,
               url        = case when ${endereco !== null}
                                 then ${endereco}::text else l.url end,
               updated_at = now()
         where l.id = ${linkId}
        returning l.id`;
      // Achou na leitura e não escreveu: a política de escrita (`execute`)
      // barrou quem só vê a tarefa — o mesmo desenho de `deleteAttachment`.
      if (mudados.length === 0) throw new BoardRefused('Você não pode mexer neste link.', 403);
      return await lerFicha(tx, taskId);
    } catch (erro) {
      if (erro instanceof BoardRefused) throw erro;
      traduzir(erro);
    }
  });
}

/**
 * Apagar o link.
 *
 * SEM REGRA DE AUTOR, ao contrário do comentário, e a diferença é deliberada: o
 * link do Dropbox é da TAREFA, não de quem o pendurou. Quem trabalha na tarefa
 * troca um endereço que mudou. Comentário é FALA — e fala alheia não se
 * reescreve.
 */
export async function deleteLink(
  sql: Sql,
  actor: AuthenticatedActor,
  linkId: string,
): Promise<TaskDetail> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const taskId = await tarefaDoLink(tx, linkId);
      const apagados = await tx`delete from ideworks.task_links where id = ${linkId} returning id`;
      if (apagados.length === 0) throw new BoardRefused('Você não pode apagar este link.', 403);
      return await lerFicha(tx, taskId);
    } catch (erro) {
      if (erro instanceof BoardRefused) throw erro;
      traduzir(erro);
    }
  });
}

/* ───────────────────────────── o anexo ───────────────────────────── */

/**
 * O caminho do objeto dentro do balde.
 *
 * `<id da tarefa>/<sorteio>.<extensão>` — e o NOME ORIGINAL NÃO ENTRA NELE.
 *
 * Três razões, e nenhuma é estética:
 *   1. O nome original é texto de terceiro. Ele traria acento, barra, `..` e
 *      caractere de controle para dentro de uma chave de objeto — e a chave de
 *      objeto é parte de uma URL.
 *   2. Dois arquivos com o mesmo nome na mesma tarefa são normais (`v1.pdf`
 *      duas vezes). Com o nome na chave, o segundo sobrescreveria o primeiro
 *      em silêncio.
 *   3. O nome de verdade está em `task_attachments.file_name`, que é o que a
 *      ficha mostra e o que o download devolve. A chave é endereço, não rótulo.
 *
 * O prefixo por tarefa não é organização: é o que torna "apagar a tarefa apaga
 * os objetos dela" uma varredura de prefixo em vez de uma lista.
 */
export function caminhoDoObjeto(taskId: string, fileName: string, inText = false): string {
  const ponto = fileName.lastIndexOf('.');
  const bruta = ponto > 0 ? fileName.slice(ponto + 1) : '';
  const extensao = /^[A-Za-z0-9]{1,12}$/.test(bruta) ? `.${bruta.toLowerCase()}` : '';
  return `${taskId}/${inText ? 'inline/' : ''}${crypto.randomUUID()}${extensao}`;
}

/**
 * Uma ida ao Storage, e UMA SÓ.
 *
 * O corpo é lido sempre — no sucesso e na falha —, e não só quando dá erro.
 * A primeira versão desta função descartava o corpo do sucesso, e quem
 * precisava dele (a assinatura) acabou fazendo a requisição DUAS VEZES: dois
 * endereços assinados, dois registros no serviço, e o segundo sobrescrevendo o
 * primeiro. Ler uma vez e devolver o texto resolve os dois casos.
 */
type RespostaDoBalde = { ok: boolean; status: number; texto: string };

async function falarComOBalde(
  armazenamento: ArmazenamentoPrivado,
  caminho: string,
  init: RequestInit,
): Promise<RespostaDoBalde> {
  const chave = exigirChave(armazenamento);
  const r = await fetch(`${armazenamento.supabaseUrl}/storage/v1/${caminho}`, {
    ...init,
    headers: {
      // A CHAVE VAI NOS DOIS CABEÇALHOS, e não é redundância: o `apikey` é o
      // que o roteador do Supabase lê para decidir o projeto, e o `Bearer` é o
      // que o serviço de Storage lê para decidir o papel. Faltando um, a
      // resposta é 401 sem explicação.
      apikey: chave,
      Authorization: `Bearer ${chave}`,
      ...(init.headers ?? {}),
    },
  });
  return { ok: r.ok, status: r.status, texto: await r.text().catch(() => '') };
}

/**
 * Para onde a limpeza conta POR QUE cada remoção falhou.
 *
 * As limpezas do cron engolem a falha de cada item de propósito (um item ruim
 * não pode parar os outros; ele volta na próxima batida). Só que contar
 * "0 removidas, 100 falhas" sem a causa deixa a pessoa de plantão sem por onde
 * começar — chave de serviço trocada (401), balde renomeado (404) e queda do
 * Storage (503) têm o mesmo sintoma. O `worker` passa o `log`.
 */
export type RegistroDeFalha = (mensagem: string, erro?: unknown) => void;

/**
 * O registro com teto: cem falhas iguais viram poucas linhas e um resumo, e não
 * cem linhas no mesmo segundo. `fechar` escreve o resumo.
 */
export function registroDeFalhasComTeto(registrar: RegistroDeFalha | undefined, teto = 5) {
  let vistas = 0;
  return {
    falha(mensagem: string, erro?: unknown) {
      vistas += 1;
      if (registrar && vistas <= teto) registrar(mensagem, erro);
    },
    fechar() {
      if (registrar && vistas > teto) {
        registrar(`… e mais ${vistas - teto} falha(s) parecidas (${vistas} falhas no total nesta volta).`);
      }
    },
  };
}

/** Remove os bytes antes do registro. Falhas ficam elegíveis para o próximo cron. */
export async function purgeExpiredAttachments(
  sql: Sql,
  armazenamento: ArmazenamentoPrivado,
  registrar?: RegistroDeFalha,
) {
  exigirChave(armazenamento);
  const vencidos = await withActor(sql, { kind: 'collector' }, (tx) =>
    tx`select * from ideworks.expired_attachments()`);
  let removed = 0;
  let failed = 0;
  const falhas = registroDeFalhasComTeto(registrar);
  const deadline = Date.now() + 45_000;
  for (const anexo of vencidos) {
    if (Date.now() >= deadline) break;
    try {
      // A API de remoção também aceita caminhos já ausentes, permitindo retentativas.
      const r = await falarComOBalde(armazenamento, `object/${BALDE}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [anexo.storage_path] }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) {
        failed++;
        falhas.falha(`imagem temporária ${anexo.id}: o Storage respondeu ${r.status}`);
        continue;
      }
      await withActor(sql, { kind: 'collector' }, (tx) =>
        tx`select ideworks.finish_expired_attachment(${anexo.id}, ${anexo.storage_path})`);
      removed++;
    } catch (erro) {
      failed++;
      falhas.falha(`imagem temporária ${anexo.id}: a remoção falhou`, erro);
    }
  }
  falhas.fechar();
  return { removed, failed };
}

/**
 * Enviar o arquivo.
 *
 * A ORDEM É: alcance → bytes → linha. E ela não é arbitrária.
 *
 *   1. O ALCANCE VEM DO BANCO. Um `select` em `ideworks.tasks` sob o ator
 *      declarado: a política recorta, e a tarefa fora do alcance não aparece.
 *      Sem este passo, a chave de serviço — que ignora RLS — deixaria qualquer
 *      pessoa com sessão gravar bytes em qualquer tarefa.
 *
 *   2. OS BYTES PRIMEIRO, A LINHA DEPOIS. Uma linha que nascesse antes
 *      apareceria na ficha como um anexo que não abre, e ninguém saberia se o
 *      arquivo se perdeu ou se ainda está subindo. Ver o cabeçalho da tabela.
 *
 *   3. SE A LINHA FALHAR, O OBJETO É APAGADO. É a compensação que fecha o
 *      passo 2 pelo outro lado: sem ela, uma recusa do banco deixaria um objeto
 *      pago e invisível no balde para sempre.
 */
export async function uploadAttachment(
  sql: Sql,
  actor: AuthenticatedActor,
  armazenamento: ArmazenamentoPrivado,
  taskId: string,
  arquivo: { fileName: string; contentType: string; bytes: ArrayBuffer; temporary?: boolean; inText?: boolean },
): Promise<{ id: string; task: TaskDetail }> {
  // A chave é conferida ANTES de qualquer coisa: sem ela nada disto funciona, e
  // descobrir isso depois de ler 20 MB do corpo da requisição é desperdiçar o
  // envio inteiro da pessoa.
  exigirChave(armazenamento);

  if (arquivo.fileName.trim() === '') {
    throw new BoardRefused('O arquivo precisa de um nome.', 400);
  }
  if (arquivo.bytes.byteLength === 0) {
    throw new BoardRefused('Arquivo vazio — zero byte é arquivo que não subiu.', 400);
  }

  // ⚠️ O TETO É CONFERIDO AQUI, ANTES DE FALAR COM O BALDE.
  //
  //   O balde tem teto próprio (`file_size_limit`) e o banco tem o dele
  //   (`task_attachments_size_ceiling`) — os três são o MESMO número, e
  //   `TETO_DE_BYTES` é onde ele mora. Mas a ORDEM importa: sem esta linha,
  //   quem passasse do teto receberia a recusa do BALDE, que responde 502 com
  //   uma frase em inglês sobre `maximum allowed size`, no meio de um envio.
  //
  //   Com ela, a recusa é 400 em português, diz o tamanho e o teto, e chega
  //   antes de um único byte sair para o Storage.
  if (arquivo.bytes.byteLength > TETO_DE_BYTES) {
    throw new BoardRefused(
      `O arquivo tem ${tamanhoLegivel(arquivo.bytes.byteLength)} e o teto é ` +
        `${tamanhoLegivel(TETO_DE_BYTES)}. Para algo maior, ponha o link do Dropbox ao lado.`,
      400,
    );
  }

  if (arquivo.inText) arquivo = { ...arquivo, temporary: true };
  if (arquivo.temporary) {
    const tipo = assinaturaDeImagem(new Uint8Array(arquivo.bytes));
    if (!tipo) throw new BoardRefused('Envie uma imagem PNG ou JPEG para correção.', 400);
    arquivo = { ...arquivo, contentType: tipo };
  }

  const caminho = caminhoDoObjeto(taskId, arquivo.fileName, arquivo.inText);

  // 1. O ALCANCE, no banco, antes de gravar um byte.
  await withActor(sql, asDbActor(actor), async (tx) => {
    const [t] = await tx`select t.id from ideworks.tasks t where t.id = ${taskId}`;
    if (!t) throw new BoardRefused('Tarefa não encontrada, ou fora do seu alcance.', 404);
  });

  // 2. Os bytes.
  const envio = await falarComOBalde(armazenamento, `object/${BALDE}/${caminho}`, {
    method: 'POST',
    body: arquivo.bytes,
    headers: {
      'Content-Type': arquivo.contentType || 'application/octet-stream',
      // Sem isto o Storage sobrescreve em silêncio. O caminho tem um sorteio,
      // então colisão é praticamente impossível — e é justamente por isso que
      // uma colisão significaria outra coisa, e tem que falhar alto.
      'x-upsert': 'false',
    },
  });

  if (!envio.ok) {
    throw new BoardRefused(
      `O balde recusou o arquivo (${envio.status}). ${envio.texto.slice(0, 200)}`,
      502,
    );
  }

  // 3. A linha. Se ela falhar, o objeto sai.
  try {
    return await withActor(sql, asDbActor(actor), async (tx) => {
      try {
        const [criado] = await tx`
          insert into ideworks.task_attachments
                 (task_id, file_name, content_type, byte_size, storage_path, uploaded_by, expires_at)
          values (${taskId}, ${arquivo.fileName.trim()},
                  ${arquivo.contentType || 'application/octet-stream'},
                  ${arquivo.bytes.byteLength}, ${caminho}, ${actor.userId},
                  case when ${arquivo.temporary === true} then now() + interval '240 hours' else null end)
          returning id`;

        if (!criado) throw new BoardRefused('Tarefa não encontrada, ou fora do seu alcance.', 403);
        return { id: criado.id as string, task: await lerFicha(tx, taskId) };
      } catch (erro) {
        if (erro instanceof BoardRefused) throw erro;
        traduzir(erro);
      }
    });
  } catch (erro) {
    // A compensação. Ela é `catch` e segue em frente de propósito: se a
    // limpeza também falhar, o que a pessoa precisa ver é a recusa ORIGINAL —
    // "o banco recusou o tamanho", e não "não consegui apagar um objeto".
    await falarComOBalde(armazenamento, `object/${BALDE}/${caminho}`, { method: 'DELETE' }).catch(
      () => undefined,
    );
    throw erro;
  }
}

/**
 * A URL assinada, com prazo — o único jeito de ler um anexo.
 *
 * NÃO EXISTE URL PERMANENTE. Até a F17.52, o balde do legado era o contraste:
 * documento de cliente com endereço fixo e público, que quem o recebesse por
 * engano leria para sempre. Desde a F17.52 os dois baldes obedecem à mesma
 * regra, e o endereço morre em `PRAZO_DA_ASSINATURA` segundos.
 *
 * `download` VAI SEMPRE. Ele faz o Storage responder com
 * `Content-Disposition: attachment`, então o navegador SALVA em vez de
 * renderizar — e um arquivo de tipo declarado torto não vira página executando
 * no domínio do Supabase. A pré-visualização de imagem e PDF usa a mesma URL
 * dentro de `<img>` e `<object>`, que não executam script do arquivo.
 */
export async function signAttachment(
  sql: Sql,
  actor: AuthenticatedActor,
  armazenamento: ArmazenamentoPrivado,
  attachmentId: string,
): Promise<{ url: string; expiresAt: string; fileName: string; contentType: string }> {
  exigirChave(armazenamento);

  // O ALCANCE VEM DO BANCO: `task_attachments_select` chama `can_reach_task_id`,
  // então o anexo fora do alcance simplesmente não aparece nesta consulta. Não
  // há `if` de permissão aqui, e não pode haver.
  const anexo = await withActor(sql, asDbActor(actor), async (tx) => {
    const [a] = await tx`
      select a.storage_path, a.file_name, a.content_type
        from ideworks.task_attachments a
       where a.id = ${attachmentId}
         and (a.expires_at is null or a.expires_at > now())`;
    if (!a) throw new BoardRefused('Anexo não encontrado, ou fora do seu alcance.', 404);
    return a;
  });

  const { url, expiresAt } = await assinarObjetoDoBalde(
    armazenamento,
    BALDE,
    anexo.storage_path as string,
    anexo.file_name as string,
  );

  return {
    url,
    expiresAt,
    fileName: anexo.file_name as string,
    contentType: anexo.content_type as string,
  };
}

/**
 * Assinar UM objeto de UM balde — a mecânica, sem nenhuma regra de acesso.
 *
 * ⚠️ ESTA FUNÇÃO NÃO PERGUNTA NADA AO BANCO, e quem a chama tem de ter
 * perguntado antes. Ela é o transporte: recebe um balde, um caminho e um nome, e
 * devolve um endereço que morre em `PRAZO_DA_ASSINATURA` segundos. Chamá-la sem
 * conferir o alcance seria pôr a regra de acesso no lugar errado — a dívida 8.1
 * do legado, escrita de novo.
 *
 * ELA GANHOU O PARÂMETRO `balde` NA F17.52, e por um motivo concreto: o balde do
 * legado, `client-history-documents`, deixou de ser público naquela etapa, e os
 * 9 documentos de cliente passaram a precisar exatamente desta mecânica. Duas
 * cópias dela — uma por balde — seriam duas chances de uma delas esquecer o
 * prazo ou o `download`.
 */
export async function assinarObjetoDoBalde(
  armazenamento: ArmazenamentoPrivado,
  balde: string,
  caminho: string,
  nomeParaBaixar: string,
): Promise<{ url: string; expiresAt: string }> {
  const r = await falarComOBalde(armazenamento, `object/sign/${balde}/${caminho}`, {
    method: 'POST',
    body: JSON.stringify({ expiresIn: PRAZO_DA_ASSINATURA }),
    headers: { 'Content-Type': 'application/json' },
  });

  if (!r.ok) {
    throw new BoardRefused(
      `O balde não assinou o endereço (${r.status}). ${r.texto.slice(0, 200)}`,
      502,
    );
  }

  // A resposta do Storage traz `signedURL` como caminho relativo. Montá-la
  // aqui, e não na tela, mantém o endereço do provedor num lugar só — e é o que
  // permite trocar de provedor sem mexer em componente nenhum.
  let corpo: { signedURL?: string };
  try {
    corpo = JSON.parse(r.texto) as { signedURL?: string };
  } catch {
    throw new BoardRefused('O balde respondeu algo que não é uma assinatura.', 502);
  }

  if (!corpo.signedURL) {
    throw new BoardRefused('O balde não devolveu endereço assinado.', 502);
  }

  const nome = encodeURIComponent(nomeParaBaixar);
  const juncao = corpo.signedURL.includes('?') ? '&' : '?';

  return {
    url: `${armazenamento.supabaseUrl}/storage/v1${corpo.signedURL}${juncao}download=${nome}`,
    expiresAt: new Date(Date.now() + PRAZO_DA_ASSINATURA * 1000).toISOString(),
  };
}

/**
 * ⚠️ QUANTOS ENDEREÇOS UM PEDIDO PODE ASSINAR DE UMA VEZ — F17.56.
 *
 * A coluna do quadro mostra 50 cartões (`CARTOES_POR_COLUNA`) e a esteira mais
 * larga em uso tem 9 status, o que dá 450 no pior caso de uma tela só. O teto
 * é 200: cobre folgadamente qualquer quadro real — hoje as 1.797 tarefas têm
 * 24 anexos no total —, e ainda assim é um teto, porque um pedido sem teto é o
 * que transforma uma rota barata em alavanca de custo para quem tem sessão.
 *
 * Passando disso a rota RECUSA em vez de cortar em silêncio: cortar faria a
 * tela mostrar metade das artes sem ninguém entender por quê.
 */
export const ANEXOS_POR_PEDIDO = 200;

/**
 * Assinar VÁRIOS anexos de uma vez — a rota que o quadro usa. F17.56.
 *
 * ⚠️ A ORDEM É A MESMA DE SEMPRE, E ELA É O DESENHO INTEIRO:
 *
 *   1. PERGUNTA AO BANCO quais desses anexos quem age alcança. O `select` roda
 *      sob o ator declarado, e `task_attachments_select` chama
 *      `can_reach_task_id` — então o anexo fora do alcance simplesmente não
 *      volta desta consulta. Não há `if` de permissão aqui, e não pode haver.
 *
 *   2. SÓ ENTÃO assina, e SÓ o que voltou.
 *
 * ID QUE NÃO VOLTA NÃO É ERRO, e é por isso que ela devolve um mapa em vez de
 * uma lista na mesma ordem: "não existe" e "não é seu" têm de ser
 * indistinguíveis do lado de fora. Dizer qual das duas é responderia, para
 * quem perguntasse com uma lista de identificadores inventados, se aquele
 * anexo existe — e existir já é informação sobre trabalho de outra empresa.
 *
 * POR QUE EM LOTE, COM NÚMERO
 *   Medido em 2026-09-02 contra o Storage real, 12 caminhos, conexão quente,
 *   três corridas: em lote 27 / 31 / 29 ms; um a um 516 / 522 / 519 ms.
 *   Dezessete vezes. Assinar por cartão seria uma ida de rede por cartão numa
 *   tela que mostra cinquenta.
 */
export async function signAttachments(
  sql: Sql,
  actor: AuthenticatedActor,
  armazenamento: ArmazenamentoPrivado,
  attachmentIds: readonly string[],
): Promise<Record<string, { url: string; expiresAt: string }>> {
  const pedidos = [...new Set(attachmentIds)];
  if (pedidos.length === 0) return {};
  if (pedidos.length > ANEXOS_POR_PEDIDO) {
    throw new BoardRefused(
      `São ${pedidos.length} arquivos num pedido só, e o teto é ${ANEXOS_POR_PEDIDO}. Peça em partes.`,
      400,
    );
  }

  exigirChave(armazenamento);

  const alcancaveis = await withActor(sql, asDbActor(actor), (tx) => tx`
    select a.id, a.storage_path, a.file_name
      from ideworks.task_attachments a
     where a.id = any(${pedidos}::uuid[])
       and (a.expires_at is null or a.expires_at > now())`);

  if (alcancaveis.length === 0) return {};

  const assinados = await assinarObjetosDoBalde(
    armazenamento,
    BALDE,
    alcancaveis.map((a) => ({
      caminho: a.storage_path as string,
      nomeParaBaixar: a.file_name as string,
    })),
  );

  const saida: Record<string, { url: string; expiresAt: string }> = {};
  for (const a of alcancaveis) {
    const assinado = assinados[a.storage_path as string];
    // O caminho que o balde não assinou fica DE FORA do mapa, e não entra como
    // endereço quebrado: um `src` que dá erro faz a tela pedir de novo, e pedir
    // de novo por um objeto que sumiu do balde é um laço.
    if (assinado) saida[a.id as string] = assinado;
  }
  return saida;
}

/**
 * Assinar VÁRIOS objetos do MESMO balde — a mecânica em lote, sem regra de
 * acesso nenhuma. F17.56.
 *
 * ⚠️ COMO A IRMÃ DELA, ESTA FUNÇÃO NÃO PERGUNTA NADA AO BANCO. Quem a chama
 * tem de ter perguntado antes. Ver `assinarObjetoDoBalde`, logo acima.
 *
 * O Storage tem uma rota própria para isto (`POST object/sign/{balde}` com
 * `paths`), e ela devolve UMA LINHA POR CAMINHO com `error` e `signedURL`.
 * Um caminho que falha não derruba os outros — é por isso que o retorno é um
 * mapa por caminho, e não uma lista posicional que obrigaria quem chama a
 * confiar na ordem.
 */
export async function assinarObjetosDoBalde(
  armazenamento: ArmazenamentoPrivado,
  balde: string,
  objetos: readonly { caminho: string; nomeParaBaixar: string }[],
): Promise<Record<string, { url: string; expiresAt: string }>> {
  if (objetos.length === 0) return {};

  const r = await falarComOBalde(armazenamento, `object/sign/${balde}`, {
    method: 'POST',
    body: JSON.stringify({
      expiresIn: PRAZO_DA_ASSINATURA,
      paths: objetos.map((o) => o.caminho),
    }),
    headers: { 'Content-Type': 'application/json' },
  });

  if (!r.ok) {
    throw new BoardRefused(
      `O balde não assinou os endereços (${r.status}). ${r.texto.slice(0, 200)}`,
      502,
    );
  }

  let corpo: { path?: string; signedURL?: string | null; error?: string | null }[];
  try {
    corpo = JSON.parse(r.texto) as typeof corpo;
  } catch {
    throw new BoardRefused('O balde respondeu algo que não é uma assinatura.', 502);
  }
  if (!Array.isArray(corpo)) {
    throw new BoardRefused('O balde respondeu algo que não é uma assinatura.', 502);
  }

  const nomePorCaminho = new Map(objetos.map((o) => [o.caminho, o.nomeParaBaixar]));
  const expiresAt = new Date(Date.now() + PRAZO_DA_ASSINATURA * 1000).toISOString();
  const saida: Record<string, { url: string; expiresAt: string }> = {};

  for (const linha of corpo) {
    if (typeof linha?.path !== 'string' || typeof linha.signedURL !== 'string') continue;
    const nome = encodeURIComponent(nomePorCaminho.get(linha.path) ?? 'arquivo');
    const juncao = linha.signedURL.includes('?') ? '&' : '?';
    saida[linha.path] = {
      url: `${armazenamento.supabaseUrl}/storage/v1${linha.signedURL}${juncao}download=${nome}`,
      expiresAt,
    };
  }

  return saida;
}

/**
 * Apagar o anexo — a linha e o objeto.
 *
 * A LINHA SAI PRIMEIRO, e é o inverso do envio. A razão é a mesma dos dois
 * lados: o estado ruim que se quer evitar é "aparece na ficha e não abre".
 * Apagando a linha antes, o pior caso é um objeto órfão no balde — invisível,
 * privado e inerte. Apagando o objeto antes, o pior caso seria um anexo listado
 * que dá erro ao clicar, que é o estado que confunde quem está trabalhando.
 */
export async function deleteAttachment(
  sql: Sql,
  actor: AuthenticatedActor,
  armazenamento: ArmazenamentoPrivado,
  attachmentId: string,
): Promise<TaskDetail> {
  const { caminho, ficha, temporario } = await withActor(sql, asDbActor(actor), async (tx) => {
    const [a] = await tx`
      select a.task_id, a.storage_path, a.expires_at
        from ideworks.task_attachments a
       where a.id = ${attachmentId}`;
    if (!a) throw new BoardRefused('Anexo não encontrado, ou fora do seu alcance.', 404);

    const removidos = await tx`delete from ideworks.task_attachments where id = ${attachmentId} returning id`;
    if (!removidos.length) throw new BoardRefused('Você não pode apagar este anexo.', 403);
    if (a.expires_at) {
      // Falhar aqui desfaz a exclusão da linha, preservando o caminho para a limpeza.
      const r = await falarComOBalde(armazenamento, `object/${BALDE}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [a.storage_path] }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) throw new BoardRefused('Não foi possível apagar a imagem. Tente novamente.', 502);
    }

    return {
      temporario: !!a.expires_at,
      caminho: a.storage_path as string,
      ficha: await lerFicha(tx, a.task_id as string),
    };
  });

  // Sem chave, a linha já saiu e o objeto fica para trás. É o comportamento
  // certo: a ficha tem que poder ser limpa mesmo com o Storage inacessível, e
  // um objeto órfão num balde privado não vaza nada. Fica registrado no log.
  if (!temporario && armazenamento.serviceKey?.trim()) {
    await falarComOBalde(armazenamento, `object/${BALDE}/${caminho}`, { method: 'DELETE' }).catch(
      () => undefined,
    );
  }

  return ficha;
}

/* ───────────────── a cópia da arte para a aprovação do cliente (F42, Fase 9) ───────────────── */

/**
 * ⚠️ COMO `assinarObjetoDoBalde`, NENHUMA DESTAS PERGUNTA NADA AO BANCO. Quem
 * chama já conferiu o alcance: o envio, sob o ator, que o anexo é do card
 * (`aprovacao-envio.ts`); a rota pública, pelo token, que o item é de uma
 * chamada visível do cliente (`public_approval_item_object`). A chave é
 * transporte.
 */

/** Confere a chave antes de qualquer ida ao balde (503 com a frase que diz o que fazer). */
export const exigirChaveDoBalde = (armazenamento: ArmazenamentoPrivado): void => {
  exigirChave(armazenamento);
};

/**
 * Copia um objeto DENTRO de `ideworks-anexos` (`POST object/copy` do Storage).
 * Sem `x-upsert`: um destino que já existe falha alto — o caminho tem o id da
 * rodada, então colisão significa outra coisa.
 */
export async function copiarObjetoNoBalde(
  armazenamento: ArmazenamentoPrivado,
  de: string,
  para: string,
): Promise<void> {
  const r = await falarComOBalde(armazenamento, 'object/copy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId: BALDE, sourceKey: de, destinationKey: para }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) {
    throw new BoardRefused(`O balde não copiou a arte (${r.status}). Tente de novo.`, 502);
  }
}

/** Apaga objetos de `ideworks-anexos` (a compensação do envio). Aceita caminho já ausente. */
export async function apagarObjetosDoBalde(armazenamento: ArmazenamentoPrivado, caminhos: readonly string[]): Promise<void> {
  if (caminhos.length === 0) return;
  await falarComOBalde(armazenamento, `object/${BALDE}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: caminhos }),
    signal: AbortSignal.timeout(10_000),
  });
}

/**
 * Lê os bytes de um objeto de `ideworks-anexos`, como `Response` crua (o corpo
 * segue em fluxo, sem ser carregado na memória do Worker). Quem chama decide
 * cabeçalhos e o que fazer com a falha.
 */
export async function lerObjetoDoBalde(armazenamento: ArmazenamentoPrivado, caminho: string): Promise<Response> {
  const chave = exigirChave(armazenamento);
  const endereco = caminho.split('/').map(encodeURIComponent).join('/');
  return fetch(`${armazenamento.supabaseUrl}/storage/v1/object/authenticated/${BALDE}/${endereco}`, {
    headers: { apikey: chave, Authorization: `Bearer ${chave}` },
    signal: AbortSignal.timeout(15_000),
  });
}
