/**
 * A conversa, o anexo e o link da tarefa — etapa F17.6.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O COMENTÁRIO É A ENTREGA
 *
 *   Medido nas tarefas reais da Agência Ide: o designer termina o trabalho
 *   postando o link do Dropbox num comentário. Em `[A] JATOBÁ - NÚMERO ALTO
 *   DE INVESTIDORES` o comentário é, literalmente, o endereço da pasta.
 *
 *   Por isso duas coisas neste arquivo não são detalhe:
 *     1. `linkarTextoCru` — um endereço colado sozinho VIRA CLICÁVEL, mesmo sem
 *        a sintaxe `[texto](endereço)` do markdown. Sem isso, a entrega chega
 *        como texto que a pessoa precisa selecionar e copiar à mão.
 *     2. `enderecoSeguro` é reusado de `@/board/markdown`, e não reescrito. Uma
 *        segunda lista de esquemas permitidos é uma segunda chance de errar.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O QUE ESTE ARQUIVO É, E O QUE ELE NÃO É
 *   É a camada pura: os tipos que atravessam servidor e tela, e as contas que
 *   não dependem de nada.
 *
 *   REGRA DE DOMÍNIO NÃO MORA AQUI. Como na F17.15, quase tudo virou restrição
 *   declarativa no banco:
 *     · "a resposta é de UM nível" ......... `task_comments_parent_fk`
 *     · "a resposta é da MESMA tarefa" ..... a mesma chave composta
 *     · "só o autor edita e apaga" ......... `task_comments_update/delete`
 *     · "o corpo não pode ser `{}`" ........ `is_meaningful_name`, F17.4
 *     · "o endereço não executa código" .... `task_links_url_is_web`
 *     · "quem alcança a tarefa alcança" .... `can_reach_task_id`, F17.3
 *
 *   Se alguma dessas aparecer reimplementada aqui, é defeito. O que existe é
 *   conforto de digitação — a pessoa vê o erro antes de gastar uma ida ao
 *   servidor — e ele é sempre MENOS SEVERO OU IGUAL ao banco, nunca mais. A
 *   lição está escrita em `passos.ts`: validação de conforto mais severa que a
 *   regra mente sobre o que o sistema aceita.
 *
 * A CONTAGEM DE RESPOSTAS VEM DO SERVIDOR, E NÃO SE RECALCULA AQUI
 *   `replyCount` é o `reply_count` do ClickUp. Ele é contado na consulta da
 *   ficha, que traz a conversa inteira — mas a tela NÃO o deduz do array,
 *   porque um dia a conversa pode vir paginada e a conta passaria a mentir sem
 *   ninguém mexer nela.
 */

import { enderecoSeguro } from '@/board/markdown';
import type { TaskPerson } from '@/board/ficha';

/* ───────────────────────────── a forma ───────────────────────────── */

/** Um comentário, ou uma resposta a ele. */
export type Comentario = {
  id: string;
  /** Nulo no comentário, preenchido na resposta. UM nível só — ver o cabeçalho. */
  parentId: string | null;
  /** Markdown cru. Quem desenha é `src/ui/Markdown.tsx`. */
  body: string;
  author: TaskPerson | null;
  createdAt: string;
  /** Instante da edição, nulo enquanto ninguém editou. Nunca booleano. */
  editedAt: string | null;
  /** O `reply_count` do ClickUp. Sempre 0 numa resposta, porque não há neto. */
  replyCount: number;
  /**
   * Se quem está olhando é o autor.
   *
   * O SERVIDOR É QUEM DECIDE, e não a tela comparando ids. A regra de verdade é
   * a política `task_comments_update`, e o botão só reflete o que ela vai
   * responder — botão que aparece e leva 403 é pior que botão ausente.
   */
  mine: boolean;
  /** As respostas, montadas por `aninharConversa`. Não vem do banco. */
  replies: Comentario[];
  /**
   * F42, Fase 7 — escrito pelo CLIENTE no link de aprovação. Sem autor
   * (`author` nulo) e nunca `mine`. Opcional: a ficha de antes não o trazia.
   */
  fromClient?: boolean;
  /** O material da rodada a que o comentário do cliente se refere, e a posição dele no carrossel. */
  approvalItemName?: string | null;
  approvalItemPosition?: number | null;
  /** A versão da rodada em que o cliente escreveu. */
  approvalVersion?: number | null;
};

/** F42 — o nome que a conversa mostra no lugar do autor quando quem escreveu foi o cliente. */
export const AUTOR_DO_CLIENTE = 'Cliente (pelo link)';

/**
 * Quem a fala mostra como autor. Autor nulo é normal em dois casos: a conta
 * foi apagada (`autor sem perfil`) ou quem escreveu foi o cliente pelo link
 * (`Cliente (pelo link)`) — o cliente não tem conta, e "autor desconhecido"
 * pareceria defeito.
 */
export function autorDaFala(c: Pick<Comentario, 'id' | 'author' | 'fromClient'>): TaskPerson {
  if (c.author) return c.author;
  return c.fromClient === true
    ? // Um id só para o cliente: o avatar tira a cor do id, e cada fala do
      // mesmo cliente com uma cor diferente pareceria gente diferente.
      { id: 'cliente-pelo-link', name: AUTOR_DO_CLIENTE }
    : { id: c.id, name: 'autor sem perfil' };
}

/**
 * O selo do comentário do cliente: o material a que ele se refere e a versão.
 * "sobre arte-1.jpg · v2"; sem material (comentário da decisão), "v2"; sem
 * nada, nulo — o selo "do cliente" já diz o principal.
 */
export function materialDoComentario(c: Pick<Comentario, 'fromClient' | 'approvalItemName' | 'approvalVersion'>): string | null {
  if (c.fromClient !== true) return null;
  const partes: string[] = [];
  if (c.approvalItemName) partes.push(`sobre ${c.approvalItemName}`);
  if (typeof c.approvalVersion === 'number' && c.approvalVersion > 0) partes.push(`v${c.approvalVersion}`);
  return partes.length === 0 ? null : partes.join(' · ');
}

/** Linha do ledger usada para o selo. Compacta — nunca o corpo do comentário. */
export type ExecucaoDoLedger = {
  operation: string;
  commentId?: string | null;
  result?: Record<string, unknown> | null;
  actedAs?: { integrationName?: string; ownerId?: string } | null;
};

/**
 * O ledger do corpo de uma resposta — ou lista vazia.
 *
 * A conversa humana consulta `/integrations/v1/connections/executions` só
 * para desenhar o selo. Essa rota responde 503 com a integração desligada,
 * mas NADA garante que ela responda 200 com `{executions}`: o Worker pode
 * ainda não a publicar e servir o HTML do site, ou um proxy pode responder
 * por ela. Sem esta porta, `executions` ausente virava `undefined`, e o
 * `.find` de `seloDeAgente` derrubava a CONVERSA INTEIRA — não o selo.
 * O selo é um enfeite; a conversa não é.
 */
export function execucoesDaResposta(corpo: unknown): ExecucaoDoLedger[] {
  if (typeof corpo !== 'object' || corpo === null) return [];
  const lista = (corpo as { executions?: unknown }).executions;
  return Array.isArray(lista) ? (lista as ExecucaoDoLedger[]) : [];
}

/**
 * Junta comentário ↔ ledger (`actedAs` / `commentId`). Sem isto a F16.7
 * some na conversa humana: o autor continua sendo a pessoa, e ninguém
 * vê que foi o agente.
 */
export function seloDeAgente(
  commentId: string,
  authorName: string | null | undefined,
  execucoes: readonly ExecucaoDoLedger[],
): { integration: string; person: string } | null {
  const row = execucoes.find((e) => {
    if (e.operation !== 'add_comment') return false;
    if (e.commentId === commentId) return true;
    return e.result?.commentId === commentId;
  });
  if (!row) return null;
  const acted = row.actedAs ?? row.result?.actedAs;
  const integration =
    acted && typeof acted === 'object' && acted !== null && 'integrationName' in acted
      ? String((acted as { integrationName: unknown }).integrationName ?? '').trim()
      : '';
  if (!integration) return null;
  return { integration, person: authorName?.trim() || 'responsável' };
}

/** O arquivo da tarefa. Os bytes moram no balde privado; isto é a ficha dele. */
export type Anexo = {
  /** Prazo de exclusão das imagens da conversa; ausente em anexos permanentes. */
  expiresAt?: string | null;
  /** Imagem cujo lugar é definido pelo texto, inclusive enquanto é rascunho. */
  inText?: boolean;
  id: string;
  fileName: string;
  /** Derivada do nome pelo banco (coluna gerada). Nula quando não há ponto. */
  extension: string | null;
  contentType: string;
  byteSize: number;
  uploadedBy: TaskPerson | null;
  createdAt: string;
};

/** O link externo — Dropbox e Google Docs são o padrão da casa. */
export type Link = {
  id: string;
  label: string;
  url: string;
  sortOrder: number;
  createdBy: TaskPerson | null;
  createdAt: string;
};

/* ───────────────────────────── a árvore da conversa ───────────────────────────── */

/**
 * Os comentários achatados viram conversa de UM nível.
 *
 * VEM ACHATADO DO BANCO DE PROPÓSITO, pelo mesmo motivo de `aninharItens` e de
 * `buildTree`: uma consulta só, e a forma se monta aqui, onde tem teste. Duas
 * consultas dariam duas respostas que podem discordar.
 *
 * ÓRFÃO NÃO SOME. O banco não deixa nascer resposta cujo pai esteja em outra
 * tarefa — `task_comments_parent_fk` recusa —, mas se uma aparecer, ela é
 * mostrada na raiz em vez de desaparecer. Esconder a entrega de alguém é o pior
 * defeito possível nesta tela.
 *
 * A ORDEM É CRONOLÓGICA nos dois níveis, e não há desempate por outra coisa:
 * conversa se lê na ordem em que foi dita.
 */
export function aninharConversa(comentarios: readonly Comentario[]): Comentario[] {
  const porId = new Map<string, Comentario>();
  for (const c of comentarios) porId.set(c.id, { ...c, replies: [] });

  const raiz: Comentario[] = [];
  for (const c of comentarios) {
    const meu = porId.get(c.id);
    if (!meu) continue;
    const pai = c.parentId === null ? undefined : porId.get(c.parentId);
    if (pai) pai.replies.push(meu);
    else raiz.push(meu);
  }

  const ordenar = (lista: Comentario[]) => {
    lista.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const x of lista) ordenar(x.replies);
  };
  ordenar(raiz);
  return raiz;
}

/**
 * A QUEM O `Responder` DE UMA FALA ENDEREÇA.
 *
 * A conversa tem UM nível, e o banco o impõe: `post_task_comment` recusa
 * (23514) a resposta a uma resposta, com a frase "responda o comentário
 * original". A fala de segundo nível, porém, também oferece `Responder` — e
 * mandar o id DELA como pai fazia o botão falhar sempre, depois de a pessoa
 * escrever o texto. O botão não some (regra do Wesley: nenhum botão some sem
 * querer): numa resposta ele passa a endereçar o comentário original, que é
 * onde a conversa de um nível a põe, com a citação dele logo acima.
 *
 * Usa `parentId` da própria fala, e não a árvore montada: a resposta órfã (o
 * pai não veio na ficha) continua apontando para o pai verdadeiro.
 */
export function paiParaResponder(fala: Pick<Comentario, 'id' | 'parentId'>): string {
  return fala.parentId ?? fala.id;
}

/* ───────────────────────────── o texto que vira clique ───────────────────────────── */

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * NÃO EXISTE AQUI UMA FUNÇÃO PARA TRANSFORMAR ENDEREÇO CRU EM LINK. ELA JÁ
 * EXISTE, E ESTÁ EM `src/board/markdown.ts`.
 *
 *   Esta etapa começou escrevendo uma (`linkarTextoCru`), porque o comentário
 *   real da Agência Ide é o endereço do Dropbox colado sozinho e parecia que o
 *   analisador seguiria a sintaxe do markdown à risca. ERRADO — medido no HTML
 *   produzido: `parseInline` tem a regra `URL_SOLTA`, com o comentário
 *
 *     "Endereço solto no meio da frase. As tarefas reais colam link do Dropbox
 *      e do Google Docs sem colchete nenhum — sem isto eles não clicam."
 *
 *   A F17.10b já tinha resolvido o problema, pelo mesmo motivo e com a mesma
 *   medição. A função nova não era só redundante: ela produzia `[texto](url)`
 *   sobre um texto que o analisador ia auto-linkar de novo, e o resultado era
 *   `<a><a>…</a></a>` — âncora dentro de âncora, que é HTML inválido.
 *
 *   A regra fica num lugar só, e o lugar é `markdown.ts`. Este arquivo não
 *   toca no corpo do comentário: ele o entrega cru a `Markdown.tsx`.
 *
 *   `enderecoSeguro` continua sendo a única lista de permissão de esquema do
 *   projeto, e `normalizarEndereco`, logo abaixo, delega a ela.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/* ───────────────────────────── as recusas que a tela dá sozinha ───────────────────────────── */

/**
 * O mesmo critério de `is_meaningful_name`, medido contra o banco na F17.15.
 *
 * A classe é `\p{P}` SOZINHA — pontuação Unicode e nada além. Símbolo (`\p{S}`)
 * fica de fora de propósito: `[[:punct:]]` do Postgres ACEITA `✅`, `👍` e `→`,
 * e uma tela mais severa que o banco recusaria um comentário perfeitamente
 * válido com um erro que o sistema não tem.
 */
export function conferirComentario(corpo: string): string | null {
  const limpo = corpo.trim();
  if (limpo === '') return 'Escreva alguma coisa.';
  if (/^[\p{P}\s]+$/u.test(limpo)) {
    return 'Comentário só com pontuação é recusado pelo banco — escreva o que foi entregue.';
  }
  return null;
}

/**
 * O que a tela consegue dizer sobre o link antes de gastar uma ida ao servidor.
 *
 * O ENDEREÇO É NORMALIZADO, E NÃO SÓ CONFERIDO. `normalizarUrl` completa o
 * `https://` de `www.dropbox.com/x` — que é EXATAMENTE como o comentário real
 * está escrito. O banco recusa endereço sem esquema (`task_links_url_is_web`),
 * então sem esta normalização a digitação natural da equipe seria recusada.
 */
export type EntradaDeLink = { label: string; url: string };

export function conferirLink(e: EntradaDeLink): Record<string, string> {
  const erros: Record<string, string> = {};
  if (e.label.trim() === '') erros.label = 'Dê um nome ao link.';
  else if (/^[\p{P}\s]+$/u.test(e.label.trim())) erros.label = 'Nome só com pontuação é recusado.';
  if (e.url.trim() === '') erros.url = 'Cole o endereço.';
  else if (normalizarEndereco(e.url) === null) {
    erros.url = 'Endereço inválido. Só http e https — javascript: e data: são recusados.';
  }
  return erros;
}

const TEM_ESQUEMA = /^[a-z][a-z0-9+.-]*:/i;

/**
 * `www.dropbox.com/x` → `https://www.dropbox.com/x`; `javascript:…` → nulo.
 *
 * A MESMA regra de `normalizarUrl` em `src/clients/formulario.ts`, que existe
 * desde a F2 — mas a decisão final de segurança delega a `enderecoSeguro`, o
 * ÚNICO lugar do projeto que decide qual esquema pode virar `href`. Duas listas
 * de esquemas seriam duas chances de esquecer uma.
 */
export function normalizarEndereco(bruto: string): string | null {
  const v = bruto.trim();
  if (v === '') return null;
  const completo = TEM_ESQUEMA.test(v)
    ? v
    : /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$|\?)/i.test(v)
      ? `https://${v}`
      : v;
  const seguro = enderecoSeguro(completo);
  if (seguro === null) return null;
  // O banco exige http ou https e nada de espaço — `task_links_url_is_web`.
  // `enderecoSeguro` também aceita `mailto:` e caminho relativo, que servem ao
  // markdown mas não servem a esta tabela. Conferir aqui evita uma recusa do
  // Postgres com a frase de uma restrição.
  return /^https?:\/\/[^\s]+$/i.test(seguro) ? seguro : null;
}

/* ───────────────────────────── o que a tela escreve ───────────────────────────── */

/**
 * `5.0` → `5`, `3.4` → `3,4`.
 *
 * A CASA DECIMAL ZERADA SAI. O teto de anexo é exatamente 5 MB, e a tela o
 * escreve em três lugares — o rótulo do botão, a nota da seção e a frase da
 * recusa. `5,0 MB` num rótulo de limite lê-se como aproximação; `5 MB` lê-se
 * como regra, que é o que ele é.
 */
const enxugar = (n: string): string => n.replace(/\.0$/, '').replace('.', ',');

/**
 * `3,4 MB`, `812 KB`, `640 B`.
 *
 * BASE 1024, e o rótulo diz KB/MB e não KiB/MiB: é o que o Finder, o Explorador
 * e o próprio ClickUp escrevem, e a pessoa compara com o que vê no computador
 * dela. Ser tecnicamente exato aqui seria ser diferente de todo o resto.
 */
export function tamanhoLegivel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'tamanho desconhecido';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${enxugar(mb.toFixed(mb < 10 ? 1 : 0))} MB`;
  return `${enxugar((mb / 1024).toFixed(1))} GB`;
}

/**
 * O que se pré-visualiza, e o que só se baixa.
 *
 * LISTA CURTA E FECHADA, e é aqui que ela mora — não no banco. O banco guarda
 * o tipo declarado por quem enviou, SEM lista de permissão, porque a agência
 * anexa `.ai`, `.psd` e `.zip` e recusá-los seria recusar trabalho real.
 *
 * O risco de um tipo declarado torto (um `.html` dizendo-se `image/png`) é
 * contido do outro lado: a URL assinada sai sempre com `?download=`, então o
 * navegador SALVA em vez de renderizar. Só o que está nesta lista é desenhado
 * na página, e só em `<img>` e `<object>`, que não executam script do arquivo.
 */
export const imagem = (contentType: string): boolean =>
  /^image\/(png|jpeg|jpg|gif|webp|avif|svg\+xml)$/i.test(contentType.trim());

export const pdf = (contentType: string): boolean =>
  /^application\/pdf$/i.test(contentType.trim());

export const previsualizavel = (contentType: string): boolean =>
  imagem(contentType) || pdf(contentType);

/** `nenhum comentário`, `1 comentário`, `4 comentários`. */
export function rotuloDeComentarios(n: number): string {
  if (n === 0) return 'nenhum comentário';
  return n === 1 ? '1 comentário' : `${n} comentários`;
}

/** `1 resposta`, `3 respostas`. Vazio em zero — o ClickUp não escreve "0 respostas". */
export function rotuloDeRespostas(n: number): string {
  if (n === 0) return '';
  return n === 1 ? '1 resposta' : `${n} respostas`;
}

/**
 * ⚠️ O TETO DO ANEXO MORA AQUI, E SÓ AQUI. Decisão do usuário na F17.17:
 * **5 MB**, contra os 25 MiB da F17.6.
 *
 * TRÊS LUGARES PRECISAM CONCORDAR, e um deles não é TypeScript:
 *
 *   1. esta constante ....... a tela recusa ANTES de gastar o envio, e o
 *                             servidor recusa antes de falar com o balde
 *                             (`server/board-anexos.ts` importa daqui);
 *   2. `task_attachments_size_ceiling` ... o `check` da linha, no banco;
 *   3. `storage.buckets.file_size_limit` do balde `ideworks-anexos`.
 *
 * SE ELES DIVERGIREM, A PESSOA LEVA O ERRO DE UM LUGAR DIFERENTE DO QUE A TELA
 * PROMETE — o balde responde 502 com texto em inglês no meio de um envio que a
 * tela tinha aceitado. Por isso os três são conferidos juntos, em dois níveis:
 *
 *   · `conversa.test.ts` lê a migration `20260826120000_…_limite_de_anexo.sql`
 *     e exige que os DOIS números escritos nela sejam este;
 *   · `scripts/provar-comentarios-e-anexos.mjs` pergunta ao serviço de Storage
 *     e ao `pg_constraint` do banco de verdade, e compara com este arquivo.
 *
 * O número é 5 × 1024 × 1024 porque `tamanhoLegivel` conta em base 1024 — é o
 * que o Explorador, o Finder e o próprio ClickUp mostram. `5 MB` na tela e
 * `5242880` no banco são a mesma coisa dita nas duas línguas.
 */
export const TETO_DE_BYTES = 5 * 1024 * 1024;

export function conferirArquivo(nome: string, bytes: number): string | null {
  if (nome.trim() === '') return 'O arquivo precisa de um nome.';
  if (/^[\p{P}\s]+$/u.test(nome.trim())) return 'Nome só com pontuação é recusado pelo banco.';
  if (bytes <= 0) return 'Arquivo vazio — zero byte é arquivo que não subiu.';
  if (bytes > TETO_DE_BYTES) {
    // A RECUSA DIZ OS DOIS NÚMEROS. "Arquivo grande demais" obriga a pessoa a
    // adivinhar de quanto ela passou; com o tamanho e o teto lado a lado ela
    // sabe na hora se compensa comprimir ou se o caminho é o link.
    return `O arquivo tem ${tamanhoLegivel(bytes)} e o teto é ${tamanhoLegivel(TETO_DE_BYTES)}. Para algo maior, ponha o link do Dropbox ao lado.`;
  }
  return null;
}
