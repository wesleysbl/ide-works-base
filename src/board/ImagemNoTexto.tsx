import { useState } from 'react';
import { useMiniatura } from '@/board/miniaturas';
import { Janela, BotaoDeFechar } from '@/ui/janela';
import '@/ui/imagens-no-texto.css';

/** Visível ao abrir a tarefa; o clique só amplia a imagem já carregada. */
export function ImagemNoTexto({ id, alt = 'Imagem anexada' }: { id: string; alt?: string }) {
  const { url, aoFalhar, indisponivel } = useMiniatura(id);
  const [ampliada, setAmpliada] = useState(false);
  if (!url) return <span className="imagem-no-texto-aviso" role="status" aria-label={alt}>
    {indisponivel ? 'Imagem expirada ou indisponível.' : 'Carregando imagem…'}
  </span>;
  return <span>
    <button type="button" className="imagem-no-texto-link" onClick={() => setAmpliada(true)}
      aria-label="Ampliar imagem">
    <img src={url} alt={alt} className="imagem-no-texto" draggable={false}
      referrerPolicy="no-referrer" onError={aoFalhar} />
    </button>
    {ampliada && <Janela rotulo="Imagem anexada" aoFechar={() => setAmpliada(false)}>
      <BotaoDeFechar aoFechar={() => setAmpliada(false)} />
      <img src={url} alt={alt} className="imagem-no-texto" referrerPolicy="no-referrer" />
    </Janela>}
  </span>;
}
