import { ImagemNoTexto } from '@/board/ImagemNoTexto';
import { ProvedorDeMiniaturas } from '@/board/MiniaturaDoCartao';
import { imagensDoTexto } from '@/board/imagens-no-texto';
import { formatarInstante, type TaskDetail } from '@/board/ficha';

/** Compatibilidade: prints anteriores não tinham vínculo com um comentário. */
export function ImagensDaConversa({ tarefa, ocupado, aoApagar }: {
  tarefa: TaskDetail;
  ocupado: boolean;
  aoApagar: (id: string) => Promise<boolean>;
}) {
  const usadas = new Set(imagensDoTexto([tarefa.description ?? '', ...tarefa.comments.map((c) => c.body)].join('\n')));
  const imagens = tarefa.attachments.filter((a) => a.expiresAt && !a.inText && !usadas.has(a.id));
  if (!imagens.length) return null;
  return <ProvedorDeMiniaturas ids={imagens.map((a) => a.id)}>
    <div className="imagens-anteriores">
      {imagens.map((a) => <div key={a.id}>
        <ImagemNoTexto id={a.id} alt={a.fileName} />
        <span className="a-nota">Exclusão em {formatarInstante(a.expiresAt ?? null)}</span>
        <button type="button" className="c-acao" disabled={ocupado}
          onClick={() => void aoApagar(a.id)}>Apagar imagem</button>
      </div>)}
    </div>
  </ProvedorDeMiniaturas>;
}
