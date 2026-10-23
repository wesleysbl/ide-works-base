/**
 * Histórico do cliente — etapa F4.9.
 *
 * DUAS DATAS, E ELAS NÃO SÃO A MESMA
 *   `happened_on` é quando o evento aconteceu; `created_at` é quando alguém o
 *   registrou. Reunião de segunda anotada na quarta tem as duas, diferentes. A
 *   linha do tempo ordena pela primeira — ordenar pela segunda poria a reunião
 *   depois de coisas que vieram antes dela.
 *
 * QUEM CONDUZIU PODE NÃO SER DO TIME
 *   No Sistema IDE o líder é texto livre, e o resultado foram 32 grafias em 75
 *   linhas: "João", "Joao", "joao", "João Pedro" — e "Juca, Lia, João e Nuno",
 *   que são quatro pessoas num campo de uma.
 *
 *   Aqui são dois campos: referência de verdade para quem é do time, e uma nota
 *   livre para quem não é. O legado misturava os dois porque não tinha o
 *   segundo.
 *
 * O NOME VEM DO DIRETÓRIO, NÃO DE `profiles`
 *   Mesma armadilha da F4.8: a política de `profiles` mostra só o próprio
 *   perfil, então uma junção direta devolveria vazio em vez de erro. Ver a
 *   migration da F4.8b.
 */

import { type ArmazenamentoPrivado, assinarObjetoDoBalde } from '@/server/board-anexos';
import { type Sql, type Tx, withActor } from '@/server/db';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

export type HistoryDocument = {
  id: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedAt: string;
};

export type HistoryEvent = {
  id: string;
  clientId: string;
  happenedOn: string;
  title: string;
  subtitle: string | null;
  body: string;
  ledBy: { id: string; name: string } | null;
  ledByNote: string | null;
  createdAt: string;
  documents: HistoryDocument[];
  /**
   * O nome da conexão de IA pela qual o registro foi escrito (F26.2), para o
   * selo de origem da F26.9. Nulo = escrito por gente.
   */
  viaName: string | null;
  /**
   * Quem pediu à IA — o autor do registro, SÓ quando `viaName` existe. A aba
   * não mostra o autor de registro humano (mostra quem CONDUZIU, que é outra
   * pessoa), e o selo é o único lugar que o nomeia.
   */
  viaAuthorName: string | null;
};

export class HistoryRefused extends Error {
  readonly status: 400 | 403 | 404;

  constructor(message: string, status: 400 | 403 | 404) {
    super(message);
    this.name = 'HistoryRefused';
    this.status = status;
  }
}

export type EntradaDeEvento = {
  happenedOn: string;
  title: string;
  subtitle: string | null;
  body: string;
  ledBy: string | null;
  ledByNote: string | null;
};

const EH_DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Vazio e "só espaços" são a mesma coisa, e viram nulo — nunca string vazia. */
const ouNulo = (v: string | null) => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

function conferir(e: EntradaDeEvento): EntradaDeEvento {
  if (!EH_DATA.test(e.happenedOn)) {
    throw new HistoryRefused('Informe a data em que o evento aconteceu.', 400);
  }
  if ((e.title ?? '').trim() === '') throw new HistoryRefused('O evento precisa de um título.', 400);
  if ((e.body ?? '').trim() === '') {
    throw new HistoryRefused('Escreva o que aconteceu — um evento sem relato não informa nada.', 400);
  }
  return {
    happenedOn: e.happenedOn,
    title: e.title.trim(),
    subtitle: ouNulo(e.subtitle),
    body: e.body.trim(),
    ledBy: e.ledBy,
    ledByNote: ouNulo(e.ledByNote),
  };
}

function traduzir(erro: unknown): never {
  const e = erro as { code?: string; message?: string };
  if (e.code === '42501') throw new HistoryRefused(e.message ?? 'Sem permissão.', 403);
  // 31 de fevereiro: a forma `AAAA-MM-DD` passa por `conferir`, mas só o
  // Postgres sabe dizer que o dia não existe — e era 500.
  if (e.code === '22008' || e.code === '22007') {
    throw new HistoryRefused('Esse dia não existe no calendário.', 400);
  }
  throw erro;
}

const comoDia = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

/* ─────────────────────────── leitura ─────────────────────────── */

export async function readHistory(
  sql: Sql,
  actor: AuthenticatedActor,
  clientId: string,
): Promise<HistoryEvent[]> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    const linhas = await tx`
      select h.id, h.client_id, h.happened_on, h.title, h.subtitle, h.body,
             h.led_by, h.led_by_note, h.created_at,
             ideworks.display_name(h.led_by) as led_by_name,
             h.via_name,
             case when h.via_name is not null
                  then ideworks.display_name(h.created_by) end as via_author_name,
             coalesce(
               (select json_agg(json_build_object(
                          'id', d.id,
                          'fileName', d.file_name,
                          'mimeType', d.mime_type,
                          'sizeBytes', d.size_bytes,
                          'uploadedAt', d.uploaded_at)
                        order by d.uploaded_at)
                  from ideworks.history_documents d
                 where d.history_id = h.id),
               '[]'::json
             ) as documents
        from ideworks.client_history h
       where h.client_id = ${clientId}
       order by h.happened_on desc, h.created_at desc`;

    return linhas.map((r) => ({
      id: r.id as string,
      clientId: r.client_id as string,
      happenedOn: comoDia(r.happened_on),
      title: r.title as string,
      subtitle: (r.subtitle as string | null) ?? null,
      body: r.body as string,
      ledBy:
        r.led_by === null
          ? null
          : { id: r.led_by as string, name: (r.led_by_name as string | null) ?? '(sem nome)' },
      ledByNote: (r.led_by_note as string | null) ?? null,
      createdAt: new Date(r.created_at as string).toISOString(),
      documents: ((r.documents as HistoryDocument[]) ?? []).map((d) => ({
        ...d,
        // `bigint` chega como texto do driver; a tela quer número para formatar.
        sizeBytes: d.sizeBytes === null ? null : Number(d.sizeBytes),
        uploadedAt: new Date(d.uploadedAt).toISOString(),
      })),
      viaName: (r.via_name as string | null) ?? null,
      viaAuthorName: (r.via_author_name as string | null) ?? null,
    }));
  });
}

/* ─────────────────────────── escrita ─────────────────────────── */

export async function createEvent(
  sql: Sql,
  actor: AuthenticatedActor,
  clientId: string,
  entrada: EntradaDeEvento,
): Promise<string> {
  conferir(entrada);

  // O autor é quem está logado — sai da sessão, nunca do corpo do pedido.
  return withActor(sql, asDbActor(actor), (tx) =>
    createEventInTx(tx, clientId, entrada, actor.userId),
  );
}

/**
 * O MIOLO do registrar, no `Tx` de quem chama — F26.3, mesmo padrão de
 * `postCommentInTx` (`server/board-anexos.ts`).
 *
 * Recebe um `Tx` JÁ ABERTO, com o ator declarado; não chama `withActor` nem
 * `sql.begin`. A tela chama por `createEvent`; o agente (F26.6) chama direto
 * de dentro do `mutate` de `runAgentWrite`, no `sqlTx` do registro — o
 * invólucro abriria uma segunda transação fora do ledger.
 *
 * `conferir` roda aqui de novo (o invólucro já rodou antes de abrir a
 * transação): o agente chama o miolo direto, e a recusa com frase tem de
 * valer para ele também. É pura, então repetir não muda nada.
 *
 * `autorId` é parâmetro de quem chama, e quem chama é código confiável: a tela
 * passa a pessoa logada; o agente, o dono da concessão. Numa sessão de agente
 * o gatilho da F26.2 regrava `created_by` com quem age de qualquer jeito; na
 * sessão humana ninguém confere, e por isso o valor nunca vem do pedido.
 *
 * A TRADUÇÃO DE ERRO MORA AQUI: a recusa do gatilho `agent_client_record_guard`
 * (42501, com frase) sai como `HistoryRefused` legível para os dois chamadores.
 */
export async function createEventInTx(
  tx: Tx,
  clientId: string,
  entrada: EntradaDeEvento,
  autorId: string,
): Promise<string> {
  const e = conferir(entrada);

  try {
    const [criado] = await tx`
      insert into ideworks.client_history
        (client_id, happened_on, title, subtitle, body, led_by, led_by_note, created_by)
      values (${clientId}, ${e.happenedOn}, ${e.title}, ${e.subtitle}, ${e.body},
              ${e.ledBy}, ${e.ledByNote}, ${autorId})
      returning id`;

    // Sem política de inserção, o insert não devolve linha em vez de recusar.
    if (!criado) throw new HistoryRefused('Cliente não encontrado, ou fora do seu alcance.', 403);
    return criado.id as string;
  } catch (erro) {
    if (erro instanceof HistoryRefused) throw erro;
    traduzir(erro);
  }
}

export async function updateEvent(
  sql: Sql,
  actor: AuthenticatedActor,
  eventId: string,
  entrada: EntradaDeEvento,
): Promise<void> {
  conferir(entrada);

  return withActor(sql, asDbActor(actor), (tx) => updateEventInTx(tx, eventId, entrada));
}

/**
 * O MIOLO do editar registro, no `Tx` de quem chama — F26.3. Mesmo contrato
 * de `createEventInTx`: sem `withActor`, sem `begin`, tradução de erro aqui.
 *
 * Não há conferência de autoria neste arquivo, e é o desenho: na sessão de
 * agente, quem recusa editar o registro de outra pessoa é o gatilho
 * `agent_client_record_guard` (F26.2), e a frase dele sobe como
 * `HistoryRefused` 403 pelo `traduzir`.
 */
export async function updateEventInTx(
  tx: Tx,
  eventId: string,
  entrada: EntradaDeEvento,
): Promise<void> {
  const e = conferir(entrada);

  try {
    const alterados = await tx`
      update ideworks.client_history
         set happened_on = ${e.happenedOn},
             title       = ${e.title},
             subtitle    = ${e.subtitle},
             body        = ${e.body},
             led_by      = ${e.ledBy},
             led_by_note = ${e.ledByNote},
             updated_at  = now()
       where id = ${eventId}
       returning id`;

    if (alterados.length === 0) {
      throw new HistoryRefused('Evento não encontrado, ou fora do seu alcance.', 404);
    }
  } catch (erro) {
    if (erro instanceof HistoryRefused) throw erro;
    traduzir(erro);
  }
}

export async function deleteEvent(
  sql: Sql,
  actor: AuthenticatedActor,
  eventId: string,
): Promise<void> {
  return withActor(sql, asDbActor(actor), (tx) => deleteEventInTx(tx, eventId));
}

/**
 * O MIOLO do apagar registro, no `Tx` de quem chama — F26.8. Mesmo contrato de
 * `deleteNotaInTx`: o desfazer em lote apaga o registro que a IA criou dentro
 * da transação do dono, e a política filtra em silêncio (daí o `returning`).
 */
export async function deleteEventInTx(tx: Tx, eventId: string): Promise<void> {
  try {
    const apagados = await tx`
      delete from ideworks.client_history where id = ${eventId} returning id`;
    if (apagados.length === 0) {
      throw new HistoryRefused('Evento não encontrado, ou fora do seu alcance.', 404);
    }
  } catch (erro) {
    if (erro instanceof HistoryRefused) throw erro;
    traduzir(erro);
  }
}

/* ─────────────────────── abrir o documento ─────────────────────── */

/**
 * O balde do Sistema IDE, que deixou de ser público na F17.52.
 *
 * O NOME É DO LEGADO, e fica. Renomear balde no Supabase é copiar 15 objetos e
 * apagar 15 — muito risco para uma questão de gosto, sobre arquivos que são
 * contrato e transcrição de reunião de cliente.
 */
export const BALDE_DO_LEGADO = 'client-history-documents';

/**
 * O endereço para abrir um documento do histórico — assinado, e de vida curta.
 *
 * ⚠️ ESTA É A ÚNICA PORTA ATÉ ESSES BYTES, DESDE A F17.52.
 *   Até 2026-09-01 o balde era `public = true`: os 9 documentos de cliente
 *   gravados pelo Sistema IDE abriam SEM LOGIN, bastando ter o endereço, e o
 *   endereço estava gravado dentro do próprio dado (`documentos[].url`). A
 *   F17.52 fechou o balde e acrescentou `documentos[].path` ao lado da `url`,
 *   sem remover nada — e esse caminho é o que `history_documents.storage_path`
 *   guarda.
 *
 * A ORDEM É A MESMA DE `board-anexos.ts`, E NÃO PODE SER OUTRA:
 *
 *   1. PERGUNTA AO BANCO se quem age alcança o documento. É um `select` sob o
 *      ator declarado, e `history_documents_select` (F4.9) recorta por
 *      `can_see_client` — documento de cliente fora do alcance simplesmente não
 *      aparece. Não há `if` de permissão aqui, e não pode haver.
 *
 *   2. SÓ ENTÃO assina, com a chave de serviço. A chave é TRANSPORTE, e não
 *      autorização: ela ignora segurança por linha, e é justamente por isso que
 *      quem decide continua sendo o banco, consultado antes.
 *
 * A RECUSA DO STORAGE SOBE COMO `BoardRefused`, e é de propósito: 502 e 503 não
 * cabem em `HistoryRefused`, que só admite 400, 403 e 404 — e alargá-la faria a
 * recusa do histórico deixar de significar "o banco disse não". O Worker traduz
 * as duas.
 */
export async function signHistoryDocument(
  sql: Sql,
  actor: AuthenticatedActor,
  armazenamento: ArmazenamentoPrivado,
  documentId: string,
): Promise<{ url: string; expiresAt: string; fileName: string; contentType: string | null }> {
  const documento = await withActor(sql, asDbActor(actor), async (tx) => {
    const [d] = await tx`
      select d.storage_path, d.file_name, d.mime_type
        from ideworks.history_documents d
       where d.id = ${documentId}`;
    if (!d) throw new HistoryRefused('Documento não encontrado, ou fora do seu alcance.', 404);
    return d;
  });

  const { url, expiresAt } = await assinarObjetoDoBalde(
    armazenamento,
    BALDE_DO_LEGADO,
    documento.storage_path as string,
    documento.file_name as string,
  );

  return {
    url,
    expiresAt,
    fileName: documento.file_name as string,
    contentType: (documento.mime_type as string | null) ?? null,
  };
}
