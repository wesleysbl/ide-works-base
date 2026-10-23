import { BYTES_DA_ASSINATURA, conferirImagemColada } from '@/board/colar-imagem';
import { conferirArquivo } from '@/board/conversa';
import type { TaskDetail } from '@/board/ficha';
import { ApiError, api } from '@/lib/api';

/** Um lote é sequencial: cada resposta contém a ficha atualizada. */
export async function enviarImagens(taskId: string, arquivos: File[], aoAssentar: (t: TaskDetail) => void) {
  const ids: string[] = [];
  const erros: string[] = [];
  for (const [i, arquivo] of arquivos.entries()) {
    try {
      const recusa = conferirArquivo(arquivo.name, arquivo.size);
      if (recusa) { erros.push(recusa); continue; }
      const cabeca = new Uint8Array(await arquivo.slice(0, BYTES_DA_ASSINATURA).arrayBuffer());
      const imagem = conferirImagemColada(cabeca, new Date(), i);
      if (!imagem.ok) { erros.push(imagem.motivo); continue; }
      const r = await api.enviarAnexo(taskId, new File([arquivo], imagem.nome, { type: imagem.tipo }), { temporaria: true, noTexto: true });
      ids.push(r.id);
      aoAssentar(r.task as TaskDetail);
    } catch (e) {
      erros.push(e instanceof ApiError ? e.message : 'Não foi possível enviar a imagem. Tente novamente.');
    }
  }
  return { ids, erros };
}
