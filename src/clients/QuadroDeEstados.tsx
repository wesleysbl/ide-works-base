/**
 * O KANBAN DAS LISTAS DA FICHA DO CLIENTE — F18C (revisão de 28/09, R09).
 *
 * ⚠️ AS COLUNAS SÃO OS ESTADOS QUE O MODELO JÁ TEM, E NADA MAIS
 *   Demanda (Checklist): pendente · concluída · arquivada. Conteúdo: a
 *   entregar · entregue. Nenhuma etapa inventada, nenhum item convertido em
 *   tarefa do quadro. Mover um cartão de coluna é o MESMO gesto que a Lista já
 *   tem (a caixa de marcar, o botão de arquivar), com a mesma escrita.
 *
 * A MESMA GRAMÁTICA DO QUADRO
 *   `.q-colunas`/`.q-coluna`/`.q-cartao` de `ui/quadro.css`: cabeçalho com o
 *   ponto de cor, o nome e a contagem; cartão que se arrasta; e as setas ←/→
 *   com o cartão em foco como alternativa ao arrasto. Coluna que não aceita
 *   soltura (ex.: nada volta para "A entregar" sem ser pelo próprio item) não
 *   se acende.
 */

import { type ReactNode, useEffect, useRef, useState } from 'react';

import '@/ui/quadro.css';

export type ColunaDeEstado<T> = {
  chave: string;
  nome: string;
  /** Uma cor do sistema (`var(--…)`), nunca literal. */
  cor: string;
  itens: T[];
  /** Pode receber cartão de outra coluna. */
  aceita: boolean;
  /** A frase da coluna sem cartão. */
  vazia: string;
  /** A coluna ainda espera a leitura: diz isto no lugar da frase de vazio. */
  carregando?: string;
};

export function QuadroDeEstados<T>({
  rotulo,
  colunas,
  idDoItem,
  nomeDoItem,
  desenhar,
  ocupados,
  aoMover,
}: {
  /** O nome do grupo (leitor de tela): "Demandas por estado". */
  rotulo: string;
  colunas: ColunaDeEstado<T>[];
  idDoItem: (item: T) => string;
  nomeDoItem: (item: T) => string;
  desenhar: (item: T) => ReactNode;
  /** Itens esperando o servidor: não arrastam de novo. */
  ocupados?: ReadonlySet<string>;
  aoMover: (item: T, de: string, para: string) => void;
}) {
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);

  /* O FOCO ACOMPANHA O CARTÃO. Pelas setas, o cartão troca de coluna quando o
     servidor responde (ou na hora, se a tela for otimista); o foco espera por
     ele na coluna de destino, para a próxima seta continuar do mesmo cartão. */
  const caixa = useRef<HTMLDivElement>(null);
  const focar = useRef<{ id: string; para: string } | null>(null);
  useEffect(() => {
    const f = focar.current;
    if (!f || !caixa.current) return;
    const el = caixa.current.querySelector<HTMLElement>(`[data-estado="${f.para}"] [data-item="${CSS.escape(f.id)}"]`);
    if (el) {
      focar.current = null;
      el.focus();
    }
  });

  const acharItem = (id: string): { item: T; coluna: string } | null => {
    for (const c of colunas) {
      const item = c.itens.find((i) => idDoItem(i) === id);
      if (item !== undefined) return { item, coluna: c.chave };
    }
    return null;
  };

  const soltar = (id: string, para: string) => {
    setArrastando(null);
    setAlvo(null);
    const achado = acharItem(id);
    if (!achado || achado.coluna === para) return;
    if (!colunas.find((c) => c.chave === para)?.aceita) return;
    aoMover(achado.item, achado.coluna, para);
  };

  /** A coluna vizinha que aceita, pulando as que não aceitam. */
  const vizinha = (de: string, direcao: -1 | 1): string | null => {
    let i = colunas.findIndex((c) => c.chave === de) + direcao;
    while (i >= 0 && i < colunas.length) {
      if (colunas[i].aceita) return colunas[i].chave;
      i += direcao;
    }
    return null;
  };

  return (
    <div className="q-colunas cl-estados" role="group" aria-label={rotulo} ref={caixa}>
      {colunas.map((c) => {
        const idDoNome = `cl-estado-${c.chave}`;
        return (
          <section
            key={c.chave}
            className="q-coluna"
            data-estado={c.chave}
            aria-labelledby={idDoNome}
            data-alvo={alvo === c.chave && arrastando !== null && c.aceita}
            style={{ ['--cor-status' as string]: c.cor }}
            onDragOver={(e) => {
              if (!c.aceita || arrastando === null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setAlvo(c.chave);
            }}
            onDragLeave={() => setAlvo((a) => (a === c.chave ? null : a))}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/plain') || arrastando;
              if (id) soltar(id, c.chave);
            }}
          >
            <header className="q-coluna-topo">
              <span className="q-ponto" />
              <h3 className="q-coluna-nome truncate" id={idDoNome}>
                {c.nome}
              </h3>
              <span className="tnum ml-auto text-[0.72rem] text-plat-dim">{c.carregando ? '…' : c.itens.length}</span>
            </header>
            <ul className="q-coluna-corpo">
              {c.itens.map((item) => {
                const id = idDoItem(item);
                const ocupado = ocupados?.has(id) ?? false;
                return (
                  <li
                    key={id}
                    data-item={id}
                    className="q-cartao cl-cartao"
                    draggable={!ocupado}
                    data-arrastando={arrastando === id}
                    data-salvando={ocupado}
                    tabIndex={0}
                    aria-label={`${nomeDoItem(item)}. Use as setas para a esquerda e para a direita para mudar de coluna.`}
                    onDragStart={(e) => {
                      if (e.target !== e.currentTarget) return;
                      e.dataTransfer.setData('text/plain', id);
                      e.dataTransfer.effectAllowed = 'move';
                      setArrastando(id);
                    }}
                    onDragEnd={() => {
                      setArrastando(null);
                      setAlvo(null);
                    }}
                    onKeyDown={(e) => {
                      // Só o próprio cartão: as setas dentro de um campo andam no texto.
                      if (e.target !== e.currentTarget || ocupado) return;
                      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                      e.preventDefault();
                      const para = vizinha(c.chave, e.key === 'ArrowLeft' ? -1 : 1);
                      if (!para) return;
                      focar.current = { id, para };
                      aoMover(item, c.chave, para);
                    }}
                  >
                    {desenhar(item)}
                  </li>
                );
              })}
              {c.carregando ? (
                <li className="cl-estado-vazio" role="status" aria-busy="true">
                  {c.carregando}
                </li>
              ) : (
                c.itens.length === 0 && <li className="cl-estado-vazio">{c.vazia}</li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
