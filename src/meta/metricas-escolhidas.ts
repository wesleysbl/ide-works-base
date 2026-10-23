/**
 * Quais métricas a tabela mostra, e onde a escolha fica guardada — F10j.
 *
 * A ESCOLHA SOBREVIVE À NAVEGAÇÃO, E ISSO É O PONTO
 *   Sem guardar, quem monta a leitura de uma conta perde as colunas ao abrir a
 *   conta seguinte — e a comparação entre duas contas, que é o uso normal,
 *   passa a exigir remontar tudo a cada troca.
 *
 *   Fica em `localStorage`, e aqui isso é seguro: o que se guarda é uma lista
 *   de NOMES DE COLUNA. Não há dado de cliente nenhum. É a diferença para o
 *   rascunho de formulário, que guarda CNPJ e por isso ficou em
 *   `sessionStorage`.
 *
 * A CONTA NÃO ENTRA NA CHAVE, DE PROPÓSITO
 *   Guardar por conta faria cada uma abrir com colunas diferentes, e a pessoa
 *   nunca saberia por que a tabela mudou de forma. A escolha é de quem lê, não
 *   da conta.
 */

import { useCallback, useEffect, useState } from 'react';

import { PADRAO } from '@/meta/metricas';

const CHAVE = 'ideworks:metricas:';

/** Lê e grava sem derrubar nada: `localStorage` lança em navegação privada. */
function lerGuardado(onde: string): string[] | null {
  try {
    const cru = window.localStorage.getItem(CHAVE + onde);
    if (cru === null) return null;
    const lido: unknown = JSON.parse(cru);
    return Array.isArray(lido) && lido.every((x) => typeof x === 'string') ? lido : null;
  } catch {
    return null;
  }
}

function guardar(onde: string, chaves: string[]): void {
  try {
    window.localStorage.setItem(CHAVE + onde, JSON.stringify(chaves));
  } catch {
    /* sem cofre, a escolha vale só nesta visita — e isso é melhor que quebrar */
  }
}

/**
 * As colunas escolhidas, e como mudá-las.
 *
 * `onde` separa a tabela de campanhas da de anúncios: são leituras diferentes,
 * e quem quer "custo por conversa" no anúncio nem sempre quer na campanha.
 */
export function useMetricas(onde: 'campanhas' | 'anuncios') {
  const [escolhidas, setEscolhidas] = useState<string[]>(() => lerGuardado(onde) ?? PADRAO);

  useEffect(() => {
    setEscolhidas(lerGuardado(onde) ?? PADRAO);
  }, [onde]);

  const alternar = useCallback(
    (chave: string) => {
      setEscolhidas((atual) => {
        const nova = atual.includes(chave)
          ? atual.filter((c) => c !== chave)
          : [...atual, chave];
        guardar(onde, nova);
        return nova;
      });
    },
    [onde],
  );

  const limpar = useCallback(() => {
    // Volta ao padrão em vez de esvaziar: tabela sem coluna nenhuma é uma tela
    // quebrada, e "limpar" nunca deveria produzir uma.
    setEscolhidas(PADRAO);
    guardar(onde, PADRAO);
  }, [onde]);

  return { escolhidas, alternar, limpar };
}
