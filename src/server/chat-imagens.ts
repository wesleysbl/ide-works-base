/**
 * Imagens do chat — F20.7.
 *
 * Molde F17.81: mesmo balde privado, diretório `chat/`, teto 5 MB, PNG/JPEG
 * pelo conteúdo real (`assinaturaDeImagem`). Bytes primeiro, registro depois.
 * Limpeza: bytes → registro → mensagem; falha do armazenamento deixa para a
 * volta seguinte.
 */

import { assinaturaDeImagem } from '@/board/colar-imagem';
import { TETO_DE_BYTES, tamanhoLegivel } from '@/board/conversa';
import {
  BALDE,
  PRAZO_DA_ASSINATURA,
  assinarObjetoDoBalde,
  registroDeFalhasComTeto,
  type ArmazenamentoPrivado,
  type RegistroDeFalha,
} from '@/server/board-anexos';
import {
  CHAT_PURGE_BATCH,
  CHAT_PURGE_BUDGET_MS,
  ChatRefused,
  type ChatMessage,
} from '@/server/chat';
import { type Sql, withActor } from '@/server/db';
import { emPortugues } from '@/server/recusas';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SEM_CHAVE =
  'O envio e a leitura de imagem do chat dependem de IDEWORKS_SERVER_SUPABASE_SERVICE_KEY, ' +
  'que não foi definida neste ambiente.';

function exigirChave(armazenamento: ArmazenamentoPrivado): string {
  const chave = armazenamento.serviceKey?.trim();
  if (!chave) throw new ChatRefused(SEM_CHAVE, 503);
  return chave;
}

function exigirUuid(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || !UUID.test(valor)) {
    throw new ChatRefused(`${campo} inválido.`, 400);
  }
  return valor;
}

function traduzir(erro: unknown): never {
  if (erro instanceof ChatRefused) throw erro;
  const e = erro as { code?: string; message?: string };
  const frase = emPortugues(e.message);
  if (e.code === '42501') throw new ChatRefused(frase || 'Fora do seu alcance.', 403);
  if (e.code === '22023') throw new ChatRefused(frase || 'Pedido recusado.', 400);
  if (e.code === '23514') throw new ChatRefused(frase || 'Pedido recusado.', 400);
  if (e.code === '23505') throw new ChatRefused(frase || 'Imagem já registrada.', 400);
  throw erro;
}

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
      apikey: chave,
      Authorization: `Bearer ${chave}`,
      ...(init.headers ?? {}),
    },
  });
  return { ok: r.ok, status: r.status, texto: await r.text().catch(() => '') };
}

/** O status da resposta do Storage — a limpeza o registra quando a remoção falha. */
async function apagarBytesComStatus(
  armazenamento: ArmazenamentoPrivado,
  storagePath: string,
): Promise<{ ok: boolean; status: number }> {
  const r = await falarComOBalde(armazenamento, `object/${BALDE}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: [storagePath] }),
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: r.ok, status: r.status };
}

async function apagarBytes(
  armazenamento: ArmazenamentoPrivado,
  storagePath: string,
): Promise<boolean> {
  return (await apagarBytesComStatus(armazenamento, storagePath)).ok;
}

/** Prefixo próprio do chat no balde privado dos anexos. */
export function caminhoDaImagemDoChat(conversationId: string, fileName: string): string {
  const ponto = fileName.lastIndexOf('.');
  const bruta = ponto > 0 ? fileName.slice(ponto + 1) : '';
  const extensao = /^[A-Za-z0-9]{1,12}$/.test(bruta) ? `.${bruta.toLowerCase()}` : '';
  return `chat/${conversationId}/${crypto.randomUUID()}${extensao}`;
}

export type ChatImageDraft = {
  id: string;
  conversationId: string;
  fileName: string;
  contentType: string;
  byteSize: number;
};

/**
 * Sobe rascunho: alcance → bytes → linha. Se a linha falhar, o objeto sai.
 */
export async function uploadChatImageDraft(
  sql: Sql,
  actor: AuthenticatedActor,
  armazenamento: ArmazenamentoPrivado,
  conversationId: string,
  arquivo: { fileName: string; contentType: string; bytes: ArrayBuffer },
): Promise<ChatImageDraft> {
  exigirChave(armazenamento);
  const conv = exigirUuid(conversationId, 'Conversa');

  if (arquivo.fileName.trim() === '') {
    throw new ChatRefused('O arquivo precisa de um nome.', 400);
  }
  if (arquivo.bytes.byteLength === 0) {
    throw new ChatRefused('Arquivo vazio — zero byte é arquivo que não subiu.', 400);
  }
  if (arquivo.bytes.byteLength > TETO_DE_BYTES) {
    throw new ChatRefused(
      `O arquivo tem ${tamanhoLegivel(arquivo.bytes.byteLength)} e o teto é ` +
        `${tamanhoLegivel(TETO_DE_BYTES)}. Para algo maior, ponha o link do Dropbox ao lado.`,
      400,
    );
  }

  const tipo = assinaturaDeImagem(new Uint8Array(arquivo.bytes));
  if (!tipo) {
    throw new ChatRefused(
      'Este arquivo não é uma imagem PNG ou JPEG válida. Envie um print ou uma imagem nesses formatos.',
      400,
    );
  }

  const caminho = caminhoDaImagemDoChat(conv, arquivo.fileName);

  await withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const [c] = await tx`
        select id from ideworks.conversations
         where id = ${conv}::uuid`;
      if (!c) throw new ChatRefused('Conversa não encontrada, ou fora do seu alcance.', 404);
    } catch (e) {
      traduzir(e);
    }
  });

  const envio = await falarComOBalde(armazenamento, `object/${BALDE}/${caminho}`, {
    method: 'POST',
    body: arquivo.bytes,
    headers: {
      'Content-Type': tipo,
      'x-upsert': 'false',
    },
  });
  if (!envio.ok) {
    throw new ChatRefused(
      `O balde recusou o arquivo (${envio.status}). ${envio.texto.slice(0, 200)}`,
      502,
    );
  }

  try {
    return await withActor(sql, asDbActor(actor), async (tx) => {
      try {
        const [r] = await tx`
          select ideworks.register_chat_image_draft(
            ${conv}::uuid,
            ${arquivo.fileName.trim()},
            ${tipo},
            ${arquivo.bytes.byteLength},
            ${caminho}
          ) as id`;
        if (!r?.id) throw new ChatRefused('Não foi possível registrar a imagem.', 400);
        return {
          id: r.id as string,
          conversationId: conv,
          fileName: arquivo.fileName.trim(),
          contentType: tipo,
          byteSize: arquivo.bytes.byteLength,
        };
      } catch (e) {
        traduzir(e);
      }
    });
  } catch (erro) {
    await falarComOBalde(armazenamento, `object/${BALDE}/${caminho}`, { method: 'DELETE' }).catch(
      () => undefined,
    );
    throw erro;
  }
}

/** Endereço assinado (5 min). Alcance pela RLS de chat_images. */
export async function signChatImage(
  sql: Sql,
  actor: AuthenticatedActor,
  armazenamento: ArmazenamentoPrivado,
  imageId: string,
): Promise<{ url: string; expiresAt: string; fileName: string; contentType: string }> {
  exigirChave(armazenamento);
  const id = exigirUuid(imageId, 'Imagem');

  const imagem = await withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const [a] = await tx`
        select i.storage_path, i.file_name, i.content_type
          from ideworks.chat_images i
         where i.id = ${id}::uuid
           and (i.expires_at is null or i.expires_at > now())`;
      if (!a) throw new ChatRefused('Imagem não encontrada, ou fora do seu alcance.', 404);
      return a;
    } catch (e) {
      traduzir(e);
    }
  });

  const { url, expiresAt } = await assinarObjetoDoBalde(
    armazenamento,
    BALDE,
    imagem.storage_path as string,
    imagem.file_name as string,
  );

  return {
    url,
    expiresAt,
    fileName: imagem.file_name as string,
    contentType: imagem.content_type as string,
  };
}

/** Vários endereços de uma vez — mesmo teto mental dos anexos do quadro. */
export async function signChatImages(
  sql: Sql,
  actor: AuthenticatedActor,
  armazenamento: ArmazenamentoPrivado,
  imageIds: readonly string[],
): Promise<Record<string, { url: string; expiresAt: string }>> {
  exigirChave(armazenamento);
  const pedidos = [...new Set(imageIds.filter((x) => typeof x === 'string' && UUID.test(x)))];
  if (pedidos.length === 0) return {};
  if (pedidos.length > 200) {
    throw new ChatRefused('Peça no máximo 200 imagens por vez.', 400);
  }

  const linhas = await withActor(sql, asDbActor(actor), async (tx) => {
    try {
      return await tx`
        select i.id, i.storage_path, i.file_name
          from ideworks.chat_images i
         where i.id = any (${pedidos}::uuid[])
           and (i.expires_at is null or i.expires_at > now())`;
    } catch (e) {
      traduzir(e);
    }
  });

  const saida: Record<string, { url: string; expiresAt: string }> = {};
  for (const linha of linhas) {
    const { url, expiresAt } = await assinarObjetoDoBalde(
      armazenamento,
      BALDE,
      linha.storage_path as string,
      linha.file_name as string,
    );
    saida[linha.id as string] = { url, expiresAt };
  }
  return saida;
}

/**
 * Apaga a mensagem: bytes das imagens → registros → lápide.
 * Falha do armazenamento aborta (mensagem e imagens permanecem).
 */
export async function deleteChatMessageWithImages(
  sql: Sql,
  actor: AuthenticatedActor,
  armazenamento: ArmazenamentoPrivado,
  messageId: string,
  apagarMensagem: (
    sql: Sql,
    actor: AuthenticatedActor,
    messageId: string,
  ) => Promise<ChatMessage>,
): Promise<ChatMessage> {
  exigirChave(armazenamento);
  const id = exigirUuid(messageId, 'Mensagem');

  const imagens = await withActor(sql, asDbActor(actor), async (tx) => {
    try {
      // ⚠️ O AUTOR SE CONFERE ANTES DE QUALQUER BYTE SAIR DO BALDE. A lista de
      // imagens abaixo vale para QUALQUER mensagem que o ator alcança (é a
      // mesma leitura da limpeza), e a recusa de "só o autor apaga" mora na
      // última etapa, `delete_chat_message` — depois de os bytes já terem ido.
      // Sem esta conferência, qualquer membro do Geral apagava a imagem de um
      // colega: levava o 403 e a imagem já não existia. A leitura é sob a
      // política de `messages` (alcance e janela); mensagem que a pessoa nem
      // vê não entra aqui e segue o caminho de sempre, que recusa na lápide.
      const [m] = await tx`
        select author_id from ideworks.messages where id = ${id}::uuid`;
      if (m && m.author_id !== actor.userId) {
        throw new ChatRefused('Só o autor apaga a mensagem.', 403);
      }
      return await tx`select * from ideworks.chat_images_of_message(${id}::uuid)`;
    } catch (e) {
      traduzir(e);
    }
  });

  for (const img of imagens) {
    const ok = await apagarBytes(armazenamento, img.storage_path as string);
    if (!ok) {
      throw new ChatRefused('Não foi possível apagar a imagem. Tente novamente.', 502);
    }
    await withActor(sql, asDbActor(actor), async (tx) => {
      try {
        await tx`select ideworks.finish_chat_image_row(
          ${img.id as string}::uuid, ${img.storage_path as string})`;
      } catch (e) {
        traduzir(e);
      }
    });
  }

  return apagarMensagem(sql, actor, id);
}

/**
 * Limpeza do cron: rascunhos órfãos e mensagens vencidas com imagem.
 * Ordem: bytes → registro → mensagem. Falha deixa para a volta seguinte.
 */
export async function purgeExpiredChatMessages(
  sql: Sql,
  armazenamento: ArmazenamentoPrivado,
  registrar?: RegistroDeFalha,
): Promise<{ removed: number; failed: number }> {
  exigirChave(armazenamento);
  let removed = 0;
  let failed = 0;
  // A causa de cada falha vai para o registro (com teto) — ver `RegistroDeFalha`.
  const falhas = registroDeFalhasComTeto(registrar);
  const deadline = Date.now() + CHAT_PURGE_BUDGET_MS;

  // A) Rascunhos vencidos (24 h).
  const rascunhos = await withActor(sql, { kind: 'collector' }, (tx) =>
    tx`select * from ideworks.expired_chat_draft_images()`);
  for (const img of rascunhos) {
    if (Date.now() >= deadline) break;
    try {
      const r = await apagarBytesComStatus(armazenamento, img.storage_path as string);
      if (!r.ok) {
        failed++;
        falhas.falha(`rascunho de imagem ${img.id as string}: o Storage respondeu ${r.status}`);
        continue;
      }
      await withActor(sql, { kind: 'collector' }, (tx) =>
        tx`select ideworks.finish_expired_chat_draft_image(
          ${img.id as string}::uuid, ${img.storage_path as string})`);
      removed++;
    } catch (erro) {
      failed++;
      falhas.falha(`rascunho de imagem ${img.id as string}: a remoção falhou`, erro);
    }
  }

  // B) Mensagens vencidas: bytes → registro → mensagem.
  while (Date.now() < deadline) {
    const msgs = await withActor(sql, { kind: 'collector' }, async (tx) => {
      const rows = await tx`
        select * from ideworks.expired_chat_messages_for_purge(${CHAT_PURGE_BATCH})`;
      return rows.map((r) => r.message_id as string);
    });
    if (msgs.length === 0) break;

    let avançouNesteLote = 0;
    for (const messageId of msgs) {
      if (Date.now() >= deadline) break;
      try {
        const imagens = await withActor(sql, { kind: 'collector' }, (tx) =>
          tx`select * from ideworks.chat_images_of_message(${messageId}::uuid)`);

        let imagensOk = true;
        for (const img of imagens) {
          const r = await apagarBytesComStatus(armazenamento, img.storage_path as string);
          if (!r.ok) {
            imagensOk = false;
            failed++;
            falhas.falha(`mensagem ${messageId}: o Storage respondeu ${r.status} ao apagar a imagem`);
            break;
          }
          await withActor(sql, { kind: 'collector' }, (tx) =>
            tx`select ideworks.finish_chat_image_row(
              ${img.id as string}::uuid, ${img.storage_path as string})`);
        }
        if (!imagensOk) continue;

        const [feito] = await withActor(sql, { kind: 'collector' }, (tx) =>
          tx`select ideworks.finish_expired_chat_message(${messageId}::uuid) as ok`);
        if (feito?.ok) {
          removed++;
          avançouNesteLote++;
        }
      } catch (erro) {
        failed++;
        falhas.falha(`mensagem ${messageId}: a limpeza falhou`, erro);
      }
    }

    // Nada avançou neste lote (todas falharam no armazenamento) — evita laço.
    if (avançouNesteLote === 0) break;
  }

  falhas.fechar();
  return { removed, failed };
}

export { PRAZO_DA_ASSINATURA };
