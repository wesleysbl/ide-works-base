/**
 * O TÍTULO DA ABA — acessibilidade, WCAG 2.4.2 (Página com título).
 *
 * O `index.html` traz `<title>IDE Works</title>` e nada mais o mudava: as 25 telas
 * tinham o mesmo título. Quem usa leitor de tela ouve o título ao entrar na
 * página e ao trocar de aba; quem tem dez abas do sistema abertas só as
 * distingue por ele; e o histórico do navegador lista "IDE Works" vinte vezes.
 * Numa aplicação de uma página só o título não muda sozinho na troca de rota —
 * é preciso dizer.
 *
 * A REGRA: `<nome da tela> · IDE Works`. O nome é o do `<h1>` (o `Topo` e a moldura
 * pública o dizem), então título e cabeçalho nunca divergem. A entrada, cujo
 * `<h1>` é a própria marca, fica só `IDE Works`.
 */

import { useEffect } from 'react';

export const NOME_DO_SISTEMA = 'IDE Works';

/** O título do documento para uma tela. Puro, para a suíte. */
export function tituloDoDocumento(tela: string | null | undefined): string {
  const nome = (tela ?? '').replace(/\s+/g, ' ').trim();
  return nome === '' || nome === NOME_DO_SISTEMA ? NOME_DO_SISTEMA : `${nome} · ${NOME_DO_SISTEMA}`;
}

/**
 * Põe o título da tela na aba e o devolve ao nome do sistema ao sair.
 *
 * O desmonte da tela que sai roda ANTES da montagem da que entra, então a volta
 * ao nome do sistema nunca pisa no título novo; ela só vale para uma tela que
 * não diz o seu (a página do cliente tem o dela, em `PaginaDoCliente`).
 */
export function useTituloDoDocumento(tela: string | null | undefined) {
  useEffect(() => {
    document.title = tituloDoDocumento(tela);
    return () => {
      document.title = NOME_DO_SISTEMA;
    };
  }, [tela]);
}
