/**
 * Envio de imagens do chat — F20.7.
 * Reaproveita a conferência de colagem da conversa da tarefa.
 */

import { BYTES_DA_ASSINATURA, conferirImagemColada } from '@/board/colar-imagem';
import { conferirArquivo } from '@/board/conversa';
import { ApiError, api } from '@/lib/api';

export async function enviarImagensDoChat(
  conversationId: string,
  arquivos: File[],
): Promise<{ ids: string[]; erros: string[] }> {
  const ids: string[] = [];
  const erros: string[] = [];
  for (const [i, arquivo] of arquivos.entries()) {
    try {
      const recusa = conferirArquivo(arquivo.name, arquivo.size);
      if (recusa) {
        erros.push(recusa);
        continue;
      }
      const cabeca = new Uint8Array(await arquivo.slice(0, BYTES_DA_ASSINATURA).arrayBuffer());
      const imagem = conferirImagemColada(cabeca, new Date(), i);
      if (!imagem.ok) {
        erros.push(imagem.motivo);
        continue;
      }
      const r = await api.chatEnviarImagem(
        conversationId,
        new File([arquivo], imagem.nome, { type: imagem.tipo }),
      );
      ids.push(r.id);
    } catch (e) {
      erros.push(
        e instanceof ApiError
          ? e.message
          : 'Não foi possível enviar a imagem. Tente novamente.',
      );
    }
  }
  return { ids, erros };
}
