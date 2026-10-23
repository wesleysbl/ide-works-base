/**
 * A SAÍDA DE UMA TELA COM TEXTO POR SALVAR — etapa F17.AUD03.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O DEFEITO, REPRODUZIDO NA AUDITORIA DE 09/09/2026 (achado 3)
 *
 *   Abrir uma tarefa, mudar o título, ver "há alterações por salvar", clicar
 *   no X e reabrir. O título original reaparecia. Zero pedidos de gravação,
 *   nenhuma pergunta. O X e o `‹ Voltar` navegavam sem olhar para `porSalvar`;
 *   a barra lateral, a trilha, os links para a mãe e as subtarefas e o botão
 *   do navegador faziam o mesmo, cada um pelo seu caminho.
 *
 * A REGRA QUE ESTE ARQUIVO ESCREVE
 *   Há UMA porta de saída, e quem tem texto por salvar a registra. Toda saída
 *   interna passa pelo roteador — `Link`, `navigate`, o botão do navegador —, e
 *   é lá, num bloqueio só (`GuardaDeSaida`, na moldura raiz), que se pergunta:
 *   há porta, ela tem alteração, e o destino é OUTRO endereço? Se sim, a
 *   navegação espera uma decisão de três respostas:
 *
 *     Salvar e sair       → grava; só sai se o servidor confirmou
 *     Descartar e sair    → apaga o rascunho desta ficha e sai
 *     Continuar editando  → fica, com tudo como estava (Esc e fechar = isto)
 *
 *   Uma decisão conclui UMA vez. Enquanto grava, nada mais entra: nem outro
 *   `Salvar`, nem `Continuar` — a escrita já foi. Se a gravação falha (erro de
 *   validação, rede, banco), a pessoa fica na ficha com o texto inteiro, e o
 *   erro é o que a própria ficha já mostra.
 *
 * O QUE O BLOQUEIO DO ROTEADOR NÃO ALCANÇA
 *   Recarregar e fechar a aba não passam pelo roteador. Para esses há só o
 *   aviso nativo do navegador (`beforeunload`), e só enquanto houver alteração
 *   — um aviso permanente ensinaria a ignorá-lo. Nenhuma gravação remota
 *   acontece ali: o navegador não espera por ela. O que segura o texto numa
 *   recarga é o rascunho local da F17.AUD02, que a ficha grava enquanto se
 *   digita e OFERECE ao voltar.
 *
 * POR QUE O REGISTRO É DE MÓDULO, E NÃO CONTEXTO
 *   A tela da tarefa é montada nos testes dentro de `MemoryRouter`, sem
 *   roteador de dados — e `useBlocker` lança fora de um. Então a tela não
 *   bloqueia nada: ela só REGISTRA a porta aqui. Quem bloqueia mora na moldura
 *   raiz, dentro do `RouterProvider`, e lê o registro na hora de decidir. A
 *   tela continua fina, montável em qualquer roteador, e a decisão é pura.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { fichaAoLadoDe } from '@/ui/ficha-ao-lado';

/** O que uma tela com texto por salvar oferece à saída. */
export type PortaDeSaida = {
  /** Há texto diferente da última versão confirmada? Lido na hora da pergunta. */
  temAlteracao(): boolean;
  /**
   * Grava e diz se o servidor CONFIRMOU. `false` é "ficou na ficha": erro de
   * validação, de rede ou de gravação — e a ficha já mostrou qual.
   */
  salvar(): Promise<boolean>;
  /** Abandona o texto e o rascunho local DESTA ficha, e só dela. */
  descartar(): void;
};

/* ─────────────────────────────── o registro ─────────────────────────────── */

let porta: PortaDeSaida | null = null;

/**
 * A tela registra a porta ao montar e devolve o que a tira ao desmontar. A
 * baixa só vale para a MESMA porta: em modo estrito o React monta, desmonta e
 * monta de novo, e a baixa da primeira montagem não pode apagar a segunda.
 */
export function registrarSaida(nova: PortaDeSaida): () => void {
  porta = nova;
  return () => {
    if (porta === nova) porta = null;
  };
}

/** A porta registrada agora, ou `null` — nenhuma tela tem texto por salvar. */
export const portaDeSaida = (): PortaDeSaida | null => porta;

/* ─────────────────────────────── bloquear? ─────────────────────────────── */

/**
 * A pergunta do roteador, pura.
 *
 * ⚠️ MESMO ENDEREÇO NÃO É SAIR. Trocar de aba ou de visão escreve `?aba=` no
 * endereço com `replace` (F17.24), e isso passa pelo roteador como uma
 * navegação. Perguntar "sair sem salvar?" a quem só trocou de aba seria uma
 * pergunta sem resposta certa. O que conta é o CAMINHO mudar.
 *
 * ⚠️ MAS FECHAR A FICHA AO LADO É SAIR — F43, Fase 7. O card aberto ao lado do
 * Quadro não muda o caminho do roteador: a entrada do painel é o MESMO
 * `/quadro/:lista`, com a ficha no estado (ver `@/ui/ficha-ao-lado`). Fechar
 * pelo ✕, pelo `Esc`, pelo clique fora ou pelo Voltar do navegador é voltar
 * para a entrada sem ficha — o mesmo caminho, e a ficha some com o texto.
 * Então o "lugar" é o caminho MAIS a ficha ao lado: muda um ou outro, e a
 * pergunta é a mesma de sair da página cheia. Trocar de aba com o painel
 * aberto (mesmo caminho, mesma ficha) continua sem pergunta.
 */
export function deveBloquear(
  porta: PortaDeSaida | null,
  de: { pathname: string; state?: unknown },
  para: { pathname: string; state?: unknown },
): boolean {
  if (porta === null) return false;
  if (de.pathname === para.pathname && fichaAoLadoDe(de.state) === fichaAoLadoDe(para.state)) return false;
  return porta.temAlteracao();
}

/**
 * O aviso nativo ao recarregar ou fechar. Devolve se avisou.
 *
 * `returnValue` com texto, e não só `preventDefault`: navegadores mais antigos
 * só mostram o aviso com ele. O texto em si nenhum navegador exibe.
 */
export function aoAbandonarDocumento(
  porta: PortaDeSaida | null,
  evento: { preventDefault(): void; returnValue?: unknown },
): boolean {
  if (porta === null || !porta.temAlteracao()) return false;
  evento.preventDefault();
  evento.returnValue = 'Há alterações por salvar.';
  return true;
}

/* ─────────────────────────────── a decisão ─────────────────────────────── */

export type Escolha = 'salvar' | 'descartar' | 'continuar';

export type DecisaoDeSaida = {
  /** A pessoa escolheu. Fora de hora (gravando, ou já decidido) não faz nada. */
  escolher(escolha: Escolha): Promise<void>;
  /** A gravação de `Salvar e sair` está no ar. */
  salvando(): boolean;
  /** Já saiu ou já ficou: esta decisão acabou. */
  concluida(): boolean;
};

/**
 * Uma decisão por navegação bloqueada.
 *
 * `prosseguir` é o `proceed` do bloqueio — conclui a navegação que a pessoa
 * pediu, para o destino que ela pediu. `ficar` é o `reset`. Cada um é chamado
 * NO MÁXIMO uma vez, e nunca os dois: é a garantia de "uma única decisão de
 * saída" do plano, mesmo que a pessoa clique duas vezes ou aperte Esc no meio
 * de uma gravação.
 */
export function criarDecisaoDeSaida(
  porta: PortaDeSaida,
  saidas: { prosseguir(): void; ficar(): void },
  aoMudar?: () => void,
): DecisaoDeSaida {
  let salvando = false;
  let concluida = false;

  const concluir = (como: 'prosseguir' | 'ficar') => {
    if (concluida) return;
    concluida = true;
    saidas[como]();
    aoMudar?.();
  };

  return {
    async escolher(escolha) {
      if (concluida || salvando) return;

      if (escolha === 'continuar') {
        concluir('ficar');
        return;
      }
      if (escolha === 'descartar') {
        porta.descartar();
        concluir('prosseguir');
        return;
      }

      salvando = true;
      aoMudar?.();
      let confirmou = false;
      try {
        confirmou = await porta.salvar();
      } catch {
        // A ficha já tratou o erro e o mostrou; aqui só se sabe que não saiu.
        confirmou = false;
      }
      salvando = false;
      // Sem confirmação, a pessoa fica — com o texto, e podendo tentar de novo.
      concluir(confirmou ? 'prosseguir' : 'ficar');
    },
    salvando: () => salvando,
    concluida: () => concluida,
  };
}
