/**
 * OS DOIS CONTROLES SEGMENTADOS DO SISTEMA — F03 do plano UX.
 *
 * O DEFEITO QUE ELES FECHAM (UX09 da auditoria, W04)
 *   `Minhas tarefas`, `Todas as tarefas` e `Notificações` declaravam
 *   `role="tab"` em botões comuns: sem foco móvel, sem setas, sem painel
 *   associado. O leitor de tela anunciava "aba 1 de 3" e depois nada do que
 *   uma aba promete funcionava. Semântica sem o comportamento é pior do que
 *   nenhuma — ela ensina o atalho errado.
 *
 * DUAS PEÇAS, PORQUE SÃO DUAS PERGUNTAS DIFERENTES
 *   · `AlternadorDeVista` — "COMO ver o mesmo conteúdo" (Lista × Quadro).
 *     Não há painéis independentes: é o mesmo conjunto redesenhado. Então são
 *     BOTÕES PRESSIONÁVEIS (`aria-pressed`) num `role="group"` com nome. Tab
 *     entra em cada um, Enter e Espaço acionam — o que o navegador já faz.
 *   · `Abas` — "QUAL conteúdo ver" (Pendente × Feito × Delegado; as abas do
 *     Personalizar). Aqui há painel, e o padrão completo da APG:
 *     `tablist`/`tab`/`tabpanel`, `aria-controls`, foco móvel (só a aba
 *     selecionada entra no Tab), ←/→ trocam, Home/End vão às pontas. Ativação
 *     automática: a aba segue o foco, como na APG para painéis que desenham
 *     rápido — e as telas já descartam a resposta antiga (`useVez`).
 *
 * O DESENHO É UM SÓ (`.iw-segmentos`, `layout-foco.css`): um trilho rebaixado
 * e o item escolhido em relevo. Mesma forma para as duas, porque para o olho
 * as duas são "escolha uma"; a diferença que importa é a do teclado.
 */

import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';

import { idDaAba, indiceDaTecla } from '@/ui/abas';

export interface OpcaoSegmentada<T extends string> {
  valor: T;
  rotulo: ReactNode;
  /**
   * O número ao lado do rótulo. `undefined` = não há número (ainda não chegou
   * ou não se aplica) — e isso é diferente de zero, que é resposta. Ver a
   * regra do AUD06 em `MeuTrabalho`.
   */
  contagem?: number | string;
}

/* ───────────────────────────── botões pressionáveis ───────────────────────────── */

export function AlternadorDeVista<T extends string>({
  rotulo,
  opcoes,
  valor,
  aoEscolher,
  className = '',
}: {
  /** O nome do grupo para o leitor de tela — "Forma de ver". */
  rotulo: string;
  opcoes: readonly OpcaoSegmentada<T>[];
  valor: T;
  aoEscolher: (valor: T) => void;
  className?: string;
}) {
  /* O botão responde na hora, mesmo quando a forma nova demora a desenhar
     (ver `pendente` em `Abas`: o endereço troca num `startTransition`).
     Qualquer mudança do `valor` encerra a espera — com duas opções, ou ele
     chegou onde se pediu, ou veio de fora (voltar do navegador) e manda. */
  const [pendente, setPendente] = useState<T | null>(null);
  useEffect(() => setPendente(null), [valor]);
  const naVez = pendente ?? valor;
  return (
    <div role="group" aria-label={rotulo} className={`iw-segmentos ${className}`.trim()}>
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          className="iw-segmento"
          aria-pressed={o.valor === naVez}
          onClick={() => {
            if (o.valor === naVez) return;
            setPendente(o.valor);
            aoEscolher(o.valor);
          }}
        >
          {o.rotulo}
          {o.contagem !== undefined && <span className="iw-segmento-conta tnum">{o.contagem}</span>}
        </button>
      ))}
    </div>
  );
}

/* ───────────────────────────── abas de verdade ───────────────────────────── */

/**
 * As abas. O PAINEL é de quem chama — ele sabe o que desenhar —, e recebe
 * `role="tabpanel"`, `id={idDoPainel}` e `aria-labelledby={idDaAba(base, valor)}`.
 * `base` vem de `useIdDasAbas()` ou de um nome fixo quando só há um conjunto na
 * tela.
 */
export function Abas<T extends string>({
  rotulo,
  base,
  opcoes,
  valor,
  aoEscolher,
  idDoPainel,
  className = '',
  classeDaAba = '',
}: {
  rotulo: string;
  base: string;
  opcoes: readonly OpcaoSegmentada<T>[];
  valor: T;
  aoEscolher: (valor: T) => void;
  /** Um painel para todas (o conteúdo muda por dentro) ou um por aba. */
  idDoPainel: string | ((valor: T) => string);
  className?: string;
  /** Classe a mais em cada aba — as telas antigas ainda leem `cu-aba`. */
  classeDaAba?: string;
}) {
  const fila = useRef<HTMLDivElement>(null);

  /*
   * A ABA QUE O TECLADO ESCOLHEU, até o `valor` do pai chegar nela —
   * achado da verificação da F03.
   *
   * As telas guardam a aba no endereço, e o React Router 7 troca o endereço
   * dentro de um `startTransition`: o endereço muda na hora, mas o desenho com
   * o `valor` novo pode vir depois (máquina carregada, lista grande). Nesse
   * intervalo o foco já estava na aba nova e o `tabIndex=0` ainda na antiga —
   * um Tab logo em seguida caía numa aba que não é a escolhida (e2e
   * `paginacao` 8, intermitente com load ~15). Guardar a escolha aqui é
   * atualização urgente: vale já no desenho que termina o próprio `keydown`.
   * Some quando o pai alcança, ou quando o foco sai da fila.
   */
  const [pendente, setPendente] = useState<T | null>(null);
  useEffect(() => {
    if (pendente !== null && pendente === valor) setPendente(null);
  }, [pendente, valor]);
  const naVez = pendente ?? valor;

  const teclar = (e: KeyboardEvent<HTMLButtonElement>, atual: number) => {
    const proximo = indiceDaTecla(e.key, atual, opcoes.length);
    if (proximo === null) return;
    e.preventDefault();
    const alvo = fila.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[proximo];
    alvo?.focus();
    const escolhida = opcoes[proximo];
    if (escolhida) escolher(escolhida.valor);
  };

  /** Pede ao pai e já desenha a escolha (ver `pendente`). */
  const escolher = (v: T) => {
    if (v === naVez) return;
    setPendente(v);
    aoEscolher(v);
  };

  const sair = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPendente(null);
  };

  return (
    <div
      ref={fila}
      role="tablist"
      aria-label={rotulo}
      className={`iw-segmentos ${className}`.trim()}
      onBlur={sair}
    >
      {opcoes.map((o, i) => {
        const selecionada = o.valor === naVez;
        return (
          <button
            key={o.valor}
            id={idDaAba(base, o.valor)}
            type="button"
            role="tab"
            aria-selected={selecionada}
            aria-controls={typeof idDoPainel === 'string' ? idDoPainel : idDoPainel(o.valor)}
            tabIndex={selecionada ? 0 : -1}
            className={`iw-segmento ${classeDaAba}`.trim()}
            onClick={() => escolher(o.valor)}
            onKeyDown={(e) => teclar(e, i)}
          >
            {o.rotulo}
            {o.contagem !== undefined && <span className="iw-segmento-conta tnum">{o.contagem}</span>}
          </button>
        );
      })}
    </div>
  );
}
