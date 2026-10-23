/**
 * QUEM PEDE OS ENDEREÇOS DAS MINIATURAS — F17.56.
 *
 * A DECISÃO ESTÁ EM `board/miniaturas.ts`; aqui só há o React e a ida à rede.
 * Ver aquele cabeçalho para a regra de privacidade e para por que o prazo se
 * resolve pedindo sob demanda em vez de renovar num relógio.
 *
 * POR QUE CONTEXTO, E NÃO UM ATRIBUTO DESCENDO PELOS COMPONENTES
 *   O cartão está três níveis abaixo da página (`Coluna` → `Cartao` →
 *   `CorpoDoCartao`) e é desenhado por DUAS páginas — o quadro da lista e
 *   `Todas as tarefas`, que compartilham `CorpoDoCartao` desde a F17.18.
 *   Descer um atributo obrigaria as duas a lembrar de passá-lo, e a que
 *   esquecesse não daria erro nenhum: só ficaria sem arte.
 *
 *   E há a razão do LOTE: o pedido tem de ser UM para a tela inteira. Isso só
 *   se faz num lugar que vê todos os cartões de uma vez — que é justamente o
 *   provedor.
 *
 * ⚠️ CARTÃO FORA DO PROVEDOR NÃO QUEBRA. O contexto nasce vazio, e sem
 * endereço o cartão desenha exatamente como desenhava antes desta etapa. Uma
 * tela nova que esqueça o provedor perde a arte, e não a tela.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import {
  type Assinaturas,
  type Balcao,
  ContextoDeMiniaturas,
  aPedir,
  apenasOsDesenhados,
} from '@/board/miniaturas';
import { api } from '@/lib/api';

/**
 * O provedor: recebe os identificadores que a tela desenha e busca os que
 * faltam, em UM pedido.
 *
 * `ids` vem da página porque é ela que sabe quais cartões existem — inclusive
 * os que o filtro acabou de trocar. A dependência do efeito é a lista
 * ACHATADA, e não o vetor: um vetor novo com o mesmo conteúdo é o que o React
 * devolve a cada desenho, e usá-lo como dependência pediria o lote de novo a
 * cada tecla digitada na busca.
 */
export function ProvedorDeMiniaturas({
  ids,
  pedir,
  children,
}: {
  ids: readonly (string | null)[];
  /**
   * Quem assina os endereços. Padrão: anexos da tarefa (`/board/attachments/urls`).
   * No chat (F20.7) passa `api.enderecosDasImagensDoChat`.
   */
  pedir?: (
    ids: readonly string[],
  ) => Promise<{ urls: Record<string, { url: string; expiresAt: string }> }>;
  /* Opcional no TIPO porque `createElement(Provedor, props, filhos)` — a forma
     que os testes usam, já que a suíte só roda `.ts` — passa os filhos FORA das
     propriedades. Exigi-lo aqui quebraria a compilação de quem monta a árvore
     sem JSX. */
  children?: ReactNode;
}) {
  const [assinaturas, setAssinaturas] = useState<Assinaturas>({});
  const falhados = useRef<Set<string>>(new Set());
  /* Uma marca que muda quando um `<img>` reclama, só para acordar o efeito. */
  const [tentativa, setTentativa] = useState(0);
  /*
    ⚠️ O ESPELHO DO MAPA, e ele existe por uma razão de correção.

    Decidir O QUE PEDIR precisa do que já se sabe — mas fazer essa conta DENTRO
    de um `setAssinaturas(...)` poria uma ida à rede dentro de uma função que o
    React tem o direito de chamar duas vezes. O espelho deixa a decisão fora do
    desenho, e o `set` volta a ser só um `set`.
  */
  const espelho = useRef<Assinaturas>({});
  espelho.current = assinaturas;
  const pedirRef = useRef(pedir);
  pedirRef.current = pedir;

  const desenhados = useMemo(
    () => ids.filter((x): x is string => typeof x === 'string' && x !== ''),
    [ids],
  );
  const chave = desenhados.join(',');

  const aoFalhar = useCallback((id: string) => {
    if (falhados.current.has(id)) return;
    falhados.current.add(id);
    setAssinaturas((antes) => {
      if (!(id in antes)) return antes;
      const depois = { ...antes };
      delete depois[id];
      return depois;
    });
    setTentativa((n) => n + 1);
  }, []);

  useEffect(() => {
    let vivo = true;
    const naTela = chave === '' ? [] : chave.split(',');

    /* ⚠️ A LIMPEZA VEM ANTES DO PEDIDO. Trocar de lista com o mapa antigo
       ainda dentro faria o cartão novo desenhar a arte do cartão velho por um
       quadro, se um id se repetisse — e ela é o que impede o mapa de crescer
       sem teto em quem passa a tarde trocando de lista. */
    const podados = apenasOsDesenhados(espelho.current, naTela);
    if (Object.keys(podados).length !== Object.keys(espelho.current).length) {
      espelho.current = podados;
      setAssinaturas(podados);
    }

    const faltando = aPedir(naTela, espelho.current, falhados.current, Date.now());
    if (faltando.length > 0) {
      const quemPede = pedirRef.current ?? ((lista: readonly string[]) => api.enderecosDosAnexos(lista));
      void quemPede(faltando)
        .then((r) => {
          if (!vivo) return;
          /* O que se PEDIU e não VOLTOU não vai voltar numa segunda tentativa:
             ou o anexo não existe, ou ele está fora do alcance de quem olha. Os
             dois casos são finais, e marcá-los evita repetir o pedido a cada
             desenho. */
          for (const id of faltando) {
            if (!(id in r.urls)) falhados.current.add(id);
          }
          setAssinaturas((atual) => ({ ...atual, ...r.urls }));
        })
        .catch(() => {
          /* Silêncio de propósito: cartão sem arte é degradação, não falha da
             tela. Uma faixa de erro no quadro por causa de uma miniatura seria
             barulho sobre o trabalho de quem está lendo a coluna. */
          if (!vivo) return;
          for (const id of faltando) falhados.current.add(id);
          setAssinaturas((antes) => ({ ...antes }));
        });
    }

    return () => {
      vivo = false;
    };
  }, [chave, tentativa]);

  const balcao = useMemo<Balcao>(() => ({ assinaturas, aoFalhar, falhados: new Set(falhados.current) }), [assinaturas, aoFalhar]);

  return <ContextoDeMiniaturas.Provider value={balcao}>{children}</ContextoDeMiniaturas.Provider>;
}

/**
 * O provedor de MENTIRINHA, para teste de tela.
 *
 * A suíte roda em `node`, sem DOM e sem efeito (`renderToStaticMarkup`), então
 * `ProvedorDeMiniaturas` nunca chegaria a pedir nada — e um teste que só
 * conseguisse ver o cartão SEM arte não guardaria a parte que importa. Este
 * entrega o mapa já pronto.
 */
export function MiniaturasDeMentira({
  assinaturas,
  children,
}: {
  assinaturas: Assinaturas;
  children?: ReactNode;
}) {
  return (
    <ContextoDeMiniaturas.Provider value={{ assinaturas, aoFalhar: () => undefined }}>
      {children}
    </ContextoDeMiniaturas.Provider>
  );
}
