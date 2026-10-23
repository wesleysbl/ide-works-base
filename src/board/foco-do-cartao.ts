/**
 * O FOCO ACOMPANHA O CARTÃO — acessibilidade, WCAG 2.5.7 (alternativa ao arrasto),
 * 2.4.3 (ordem do foco) e 4.1.3 (mensagens de status).
 *
 * O PROBLEMA, MEDIDO NO CHROME
 *   Arrastar um cartão para outra etapa tem alternativa de teclado desde a F17:
 *   com o cartão em foco, `←` e `→` o levam à etapa vizinha. Só que o cartão
 *   muda de COLUNA, e no React isso é desmontar um `<li>` e montar outro — o
 *   foco, que estava no antigo, caía no `<body>`. A pessoa apertava `→` uma vez
 *   e a segunda seta não fazia nada (o foco já não estava no cartão), e nenhuma
 *   voz dizia para onde ele foi. A ficha do cliente (`QuadroDeEstados`) já
 *   resolvia isso para o quadro dela; Quadro, Pasta e o kanban do Espaço não.
 *
 * O QUE ESTE GANCHO FAZ
 *   `seguir` registra "o cartão X vai para a etapa Y" e já põe a frase "«X» movida
 *   para Y." em `aviso`, para uma região `role="status"` da tela (a tela é
 *   otimista: o cartão muda de coluna na hora; se a gravação falhar, o aviso de
 *   erro, esse sim `role="alert"`, vem em seguida). Depois de cada desenho, se o
 *   cartão já está na etapa Y, o foco vai para ele. Se o cartão não chega a Y em
 *   alguns segundos (a gravação falhou e o cartão voltou), o registro é
 *   esquecido — um foco que aparecesse do nada, mais tarde, roubaria a pessoa de
 *   onde ela estiver.
 *
 *   O cartão se acha por `[data-etapa="Y"] [data-cartao="X"]`: a coluna já
 *   carregava `data-etapa` (a navegação por etapas a usa), e o cartão ganhou
 *   `data-cartao`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** Quanto tempo se espera o cartão chegar à etapa nova antes de esquecer o pedido. */
export const ESPERA_DO_CARTAO_MS = 5000;

/** A frase que o leitor de tela diz depois do movimento. Pura, para a suíte. */
export function fraseDoMovimento(titulo: string, etapa: string): string {
  const nome = titulo.trim() === '' ? 'Tarefa' : titulo.trim();
  return `${nome} movida para ${etapa}.`;
}

/** O seletor do cartão dentro da coluna de destino. Puro, para a suíte. */
export function seletorDoCartao(etapaId: string, tarefaId: string): string {
  const esc = (v: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, '\\$&'));
  return `[data-etapa="${esc(etapaId)}"] [data-cartao="${esc(tarefaId)}"]`;
}

export function useFocoDoCartao() {
  const pendente = useRef<{ etapaId: string; tarefaId: string; ate: number } | null>(null);
  const [aviso, setAviso] = useState('');

  // Sem lista de dependências, de propósito: roda depois de CADA desenho, que é
  // quando o cartão aparece na coluna nova (a tela é otimista, mas a leitura do
  // banco também redesenha).
  useEffect(() => {
    const p = pendente.current;
    if (p === null) return;
    if (Date.now() > p.ate) {
      pendente.current = null;
      return;
    }
    const cartao = document.querySelector<HTMLElement>(seletorDoCartao(p.etapaId, p.tarefaId));
    if (cartao === null) return;
    pendente.current = null;
    cartao.focus();
  });

  /** O cartão `tarefaId` (de título `titulo`) vai para a etapa `etapaId` (de nome `etapa`). */
  const seguir = useCallback((tarefaId: string, titulo: string, etapaId: string, etapa: string) => {
    setAviso(fraseDoMovimento(titulo, etapa));
    pendente.current = { etapaId, tarefaId, ate: Date.now() + ESPERA_DO_CARTAO_MS };
  }, []);

  return { seguir, aviso };
}
