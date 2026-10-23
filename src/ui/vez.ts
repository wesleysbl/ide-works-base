/**
 * A VEZ — quem decide se uma resposta ainda vale. Etapa F17.AUD01.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O DEFEITO, REPRODUZIDO NA AUDITORIA DE 09/09/2026 (achados 1 e 6)
 *
 *   Abrir a subtarefa; abrir a mãe; usar Voltar antes de a mãe chegar. A filha
 *   volta primeiro, e a resposta ATRASADA da mãe chega depois e pinta a ficha —
 *   com `/tarefa/<filha>` no endereço. Salvar dali mandava `PATCH` para a mãe.
 *
 *   Em `Todas as tarefas`, buscar "antiga" (lenta) e depois "nova" (rápida): a
 *   lista mostrava "nova" e voltava para "antiga". O campo e o endereço não.
 *
 *   As três telas — ficha, histórico e quadro — aplicavam a resposta assim que
 *   ela chegava, sem perguntar se ainda era a resposta que a tela esperava.
 *   `Quadro.tsx` até tinha `let cancelado`, mas conferia DEPOIS de `setQuadro`.
 *
 * A REGRA QUE ESTE ARQUIVO ESCREVE
 *   Toda leitura pega um BILHETE ao começar: sobre qual recurso, e de que
 *   geração. Só a última geração vale. A resposta que chega com bilhete velho
 *   não entra — nem o dado, nem o erro, nem o "acabou de carregar", que
 *   apagaria o carregamento da leitura nova. Trocar de rota abre bilhete novo;
 *   desmontar a tela encerra a vez, e daí nada mais entra.
 *
 *   ⚠️ GRAVAÇÃO É DIFERENTE, E A DIFERENÇA É DE PROPÓSITO. Uma gravação já
 *   enviada não se desfaz porque a pessoa trocou de tela — o banco já a tem. O
 *   que se impede é a resposta dela, que é a ficha RELIDA, substituir OUTRA
 *   ficha. Então a gravação guarda a identidade da tarefa no começo e pergunta
 *   `sobre(id)` no fim: a tela ainda está nesta tarefa? Se a pessoa foi à mãe e
 *   voltou, está — e a ficha relida entra, que é o certo: é o estado depois da
 *   gravação. Se está na mãe, a resposta é jogada fora, e a mãe fica intacta.
 *
 * POR QUE UM ARQUIVO SÓ PARA ISTO
 *   `FichaDeCliente` e `Painel` já fazem `let cancelado = false` à mão, e para
 *   um efeito com uma promessa isso basta. A ficha da tarefa tem oito caminhos
 *   de escrita e três blocos-filhos que devolvem a ficha inteira; o quadro relê
 *   em silêncio depois de cada gesto. Uma variável por efeito não alcança isso.
 *   E a conta, sendo pura, se prova aqui com promessas fora de ordem — sem
 *   navegador, que é como a suíte roda.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useState } from 'react';

/** O bilhete de uma leitura: sobre o quê, e de que geração. */
export type Bilhete = {
  /** O id da tarefa, da lista, ou a chave da busca. */
  readonly recurso: string;
  /** Cresce a cada abertura. Só a maior vale. */
  readonly geracao: number;
};

export type Vez = {
  /**
   * Começa uma leitura sobre `recurso`. Tudo o que estava aberto deixa de
   * valer — é o que a troca de rota faz.
   */
  abrir(recurso: string): Bilhete;
  /**
   * Relê o que JÁ está na tela: só abre se `recurso` for o da vez. Devolve
   * `null` quando a tela já foi para outro lugar — e aí não há o que reler.
   *
   * ⚠️ É a porta das releituras depois de um gesto (`mover`, `Mostrar mais`, a
   * volta de um movimento de cartão). Se elas usassem `abrir`, uma releitura
   * atrasada da tarefa X tornaria X a vez de novo com `/tarefa/M` no endereço —
   * o mesmo defeito que este arquivo fecha, por outra porta.
   */
  reabrir(recurso: string): Bilhete | null;
  /** A resposta deste bilhete ainda vale? Só a última geração, e só com a vez aberta. */
  vale(bilhete: Bilhete): boolean;
  /** `recurso` ainda é o da vez? A pergunta que a GRAVAÇÃO faz ao voltar. */
  sobre(recurso: string): boolean;
  /** O recurso da vez, ou `null` antes da primeira abertura e depois de encerrar. */
  recurso(): string | null;
  /**
   * Encerra a vez: a tela foi desmontada. Nada que estava aberto vale mais.
   *
   * Não é definitivo, e isso é deliberado: em `StrictMode` o React monta,
   * desmonta e monta de novo a mesma instância, e o efeito de rota chama
   * `abrir` outra vez. Um encerramento sem volta deixaria a tela surda em
   * desenvolvimento. `abrir` depois de `encerrar` começa uma geração nova — e
   * os bilhetes antigos continuam velhos.
   */
  encerrar(): void;
};

export function criarVez(): Vez {
  let geracao = 0;
  let atual: Bilhete | null = null;

  const abrir = (recurso: string): Bilhete => {
    geracao += 1;
    atual = { recurso, geracao };
    return atual;
  };

  return {
    abrir,
    reabrir: (recurso) => (atual !== null && atual.recurso === recurso ? abrir(recurso) : null),
    vale: (bilhete) => atual !== null && atual.geracao === bilhete.geracao,
    sobre: (recurso) => atual !== null && atual.recurso === recurso,
    recurso: () => atual?.recurso ?? null,
    encerrar: () => {
      atual = null;
    },
  };
}

/** Para onde a resposta vai, quando ela ainda vale. */
export type Portas<T> = {
  chegou: (valor: T) => void;
  falhou: (erro: unknown) => void;
  /** O `finally` da tela — tipicamente `setCarregando(false)`. */
  terminou?: () => void;
};

/**
 * Espera a promessa e só ENTREGA se o bilhete ainda for o da vez.
 *
 * É o `try { r = await …; usar(r) } catch { … } finally { … }` que as telas já
 * tinham, com a pergunta certa no meio: entre o `await` e o uso. Bilhete velho
 * não passa por porta nenhuma — inclusive `terminou`, porque o
 * `setCarregando(false)` de uma leitura antiga apagaria o "carregando" da nova.
 *
 * Devolve se entregou. `false` é "passou da vez": a tela nem ficou sabendo.
 *
 * O que estourar dentro de `chegou` vai para `falhou`, como no `try` original —
 * a resposta chegou, e foi ao aplicá-la que deu errado.
 */
export async function entregar<T>(
  vez: Vez,
  bilhete: Bilhete,
  promessa: Promise<T>,
  portas: Portas<T>,
): Promise<boolean> {
  let resultado: { ok: true; valor: T } | { ok: false; erro: unknown };
  try {
    resultado = { ok: true, valor: await promessa };
  } catch (erro) {
    resultado = { ok: false, erro };
  }

  if (!vez.vale(bilhete)) return false;

  try {
    if (resultado.ok) portas.chegou(resultado.valor);
    else throw resultado.erro;
  } catch (erro) {
    portas.falhou(erro);
  } finally {
    portas.terminou?.();
  }
  return true;
}

/**
 * Uma vez por montagem da tela, encerrada ao desmontar.
 *
 * `useState` com inicializador, e não `useRef`: cria uma única vez e não pede
 * leitura de `ref` durante o desenho.
 */
export function useVez(): Vez {
  const [vez] = useState(criarVez);
  useEffect(() => () => vez.encerrar(), [vez]);
  return vez;
}
