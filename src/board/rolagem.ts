/**
 * PUXAR O QUADRO — etapa F17.25.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE O USUÁRIO PEDIU
 *
 *   *"há uma barra que precisa ser selecionada com o mouse. Precisa modificar
 *   para que possa ser também com o scroll do mouse e clicando nos espaços do
 *   quadro, como se fosse o puxar de um dedo em uma tela de celular."*
 *
 *   **"Também".** A barra de rolagem FICA. Isto acrescenta dois caminhos:
 *
 *     1. A RODA horizontal do mouse rola o quadro de lado (política F34).
 *     2. ARRASTAR O FUNDO puxa o quadro, como o dedo na tela do celular.
 *
 * O QUE FOI MEDIDO ANTES (Chrome, lista `demanda`, 12 colunas)
 *     `.q-colunas` → scrollWidth 3492, clientWidth 1084 — sobra rolagem
 *     roda com deltaY 300 sobre a faixa → scrollLeft 0. NÃO rolava.
 *     arrastar o fundo 220px → scrollLeft 0, e 34 caracteres SELECIONADOS.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ AS TRÊS ARMADILHAS, E A SEGUNDA JÁ MORDEU NESTE PROJETO
 *
 *   1. **O ARRASTO DO FUNDO NÃO PODE BRIGAR COM O ARRASTO DO CARTÃO.**
 *      O cartão tem arrasto próprio (`draggable`, e soltar muda o status). Se o
 *      gesto de rolagem começasse em cima dele, mover um cartão viraria rolar o
 *      quadro — e a única função nova da F17.9a morreria.
 *
 *      Por isso `podePuxar` recusa o gesto em cima de QUALQUER coisa que já
 *      tenha gesto: o cartão, o botão, o link, o campo. Só sobra o fundo — o
 *      vão entre colunas, a faixa do cabeçalho da coluna, o espaço abaixo do
 *      último cartão. É literalmente "os espaços do quadro".
 *
 *   2. **CLIQUE NÃO É ARRASTO, E ARRASTO NÃO PODE VIRAR CLIQUE.**
 *      Sem limiar, todo clique com um pixel de tremida viraria rolagem; e todo
 *      arrasto terminaria disparando o clique de quem estava embaixo. As duas
 *      metades estão aqui: o gesto só COMEÇA depois de `LIMIAR` pixels, e
 *      quando começou, o clique seguinte é engolido uma vez.
 *
 *   3. **O TECLADO CONTINUA INTEIRO.**
 *      As setas ← → movem o cartão em foco desde a F17.9a. Nada aqui escuta
 *      tecla, e a faixa não ganha `tabIndex` — ela não entra na ordem de
 *      tabulação e não rouba foco de ninguém.
 *
 * A INÉRCIA RESPEITA `prefers-reduced-motion`
 *   O impulso depois do dedo é o que faz o gesto parecer celular, e é também
 *   movimento não pedido. Quem configurou menos movimento no sistema
 *   operacional recebe a rolagem seca: para onde arrastou, e para ali.
 *
 *   ⚠️ Isto NÃO é coberto pelo bloco de `obsidian.css` que zera transição e
 *   animação: aquilo vale para CSS, e isto é `requestAnimationFrame`. Medido,
 *   não suposto.
 *
 * SÓ O EIXO HORIZONTAL, E É DECISÃO
 *   A faixa de colunas rola de lado; quem rola para baixo é a PÁGINA e o corpo
 *   de cada coluna (`.q-coluna-corpo`, com `overflow-y: auto`). Puxar o
 *   vertical daqui seria uma terceira mão disputando o mesmo eixo com as duas
 *   que já existem — e o defeito que o usuário descreveu é o da barra
 *   horizontal.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EIXOS INDEPENDENTES — F34, pedido de 26/09/2026
 *
 *   A roda vertical não muda a posição lateral em nenhum alvo: fundo,
 *   cabeçalho, coluna curta ou longa, inclusive nos limites. A conversão da
 *   F17.25/F32 foi removida. O navegador cuida dos dois eixos, inclusive
 *   Shift+roda. O ouvinte passivo só interrompe a inércia de um arrasto anterior.
 */

import { useCallback, useRef } from 'react';

/* ═════════════════════════ as decisões, puras ═════════════════════════ */

/**
 * O que NUNCA começa um arrasto de rolagem.
 *
 * Tudo aqui já tem gesto próprio. `.q-cartao` é o mais importante — ver a
 * armadilha 1. `[draggable="true"]` pega qualquer coisa arrastável que apareça
 * depois desta etapa sem ninguém lembrar de voltar aqui.
 */
export const SEM_PUXAR =
  '.q-cartao, button, a, input, textarea, select, label, [role="button"], [contenteditable], [draggable="true"]';

/** Quantos pixels separam um clique de um arrasto. */
export const LIMIAR = 5;

/** A janela de amostras que decide a velocidade do impulso, em milissegundos. */
export const JANELA = 90;

/** Abaixo disto o dedo estava parando — não há impulso. Pixels por ms. */
export const IMPULSO_MINIMO = 0.15;

/** Quanto da velocidade sobra a cada quadro de 16 ms. */
export const ATRITO = 0.93;

/** Abaixo disto o impulso acabou. Pixels por ms. */
export const PARADA = 0.02;

/** O mínimo que o alvo de um gesto precisa saber responder. */
export type AlvoDoGesto = { closest(seletor: string): unknown } | null;

/**
 * Se o ponto onde a pessoa pressionou é FUNDO.
 *
 * Recebe o alvo do evento, e não um elemento do DOM, de propósito: assim a
 * decisão se testa sem navegador — que é onde ela precisa ser guardada, porque
 * é ela que impede a briga com o arrasto do cartão.
 */
export function podePuxar(alvo: AlvoDoGesto): boolean {
  if (alvo === null || alvo === undefined) return false;
  return alvo.closest(SEM_PUXAR) === null;
}

/** Se o ponteiro andou o bastante para o gesto deixar de ser um clique. */
export function passouDoLimiar(dx: number, dy: number, limiar = LIMIAR): boolean {
  return Math.hypot(dx, dy) >= limiar;
}

/**
 * Se a faixa ainda tem para onde ir naquele sentido.
 *
 * O arrasto de cartão na borda só agenda outro quadro enquanto houver espaço
 * naquele sentido. Os gestos de roda são nativos e não passam por esta regra.
 */
export function podeAbsorver(
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
  passo: number,
): boolean {
  const maximo = scrollWidth - clientWidth;
  if (maximo <= 1) return false;
  if (passo > 0) return scrollLeft < maximo - 1;
  if (passo < 0) return scrollLeft > 1;
  return false;
}

export type Amostra = { t: number; x: number };

/**
 * A velocidade do fim do gesto, em pixels por milissegundo.
 *
 * Só as amostras da última fração de segundo contam: quem arrasta devagar,
 * para, e solta, não quer impulso nenhum — e uma média do gesto inteiro daria
 * impulso mesmo assim.
 */
export function velocidade(
  amostras: readonly Amostra[],
  agora: number,
  janela = JANELA,
): number {
  const recentes = amostras.filter((a) => agora - a.t <= janela);
  if (recentes.length < 2) return 0;
  const primeira = recentes[0];
  const ultima = recentes[recentes.length - 1];
  const dt = ultima.t - primeira.t;
  if (dt <= 0) return 0;
  return (ultima.x - primeira.x) / dt;
}

/** Quanto sobra da velocidade depois de `ms` milissegundos de atrito. */
export function comAtrito(v: number, ms: number, atrito = ATRITO): number {
  return v * Math.pow(atrito, ms / 16);
}

/* ═══════════════ o cartão arrastado até a borda — 2026-09-17 ═══════════════ */

/**
 * O QUE O USUÁRIO DESCREVEU
 *   *"quando pega um card e arrasta para o lado ele não rola para as listas
 *   seguintes […] ele fica preso e não mostra rolando a página com o card em
 *   mãos para soltar em outra coluna"*.
 *
 *   O arrasto do cartão é o nativo do navegador (`draggable`). Durante ele a
 *   roda do mouse não chega na página e os eventos de ponteiro param — os dois
 *   caminhos da F17.25 ficam mudos. A coluna que está fora da tela era
 *   inalcançável sem soltar o cartão.
 *
 *   A saída é a de todo quadro de cartões: **encostar o cartão na borda da faixa
 *   faz a faixa andar**, mais rápido quanto mais perto da beirada.
 */

/**
 * Quantos pixels de cada borda puxam a faixa.
 *
 * ⚠️ 160, E NÃO OS 20 DO NAVEGADOR — MEDIDO NO CHROME. O Chrome já rola sozinho
 *   durante o arrasto, mas só com o PONTEIRO a uns 20px da beirada. Quem pega o
 *   cartão pelo título carrega a imagem dele sobrando uns 150px à direita do
 *   ponteiro: a imagem bate na borda e o ponteiro ainda está longe dos 20px. É
 *   exatamente o "fica preso" que o usuário descreveu. A primeira prova deste
 *   conserto segurava o ponteiro a 8px da borda e passava ATÉ no código antigo.
 */
export const BORDA_DO_ARRASTO = 160;

/** O passo na beirada extrema, em pixels a cada quadro de 16 ms (~1.500 px/s). */
export const PASSO_DO_ARRASTO = 24;

/**
 * O passo ao ENTRAR na borda (~190 px/s).
 *
 * ⚠️ HÁ UM PISO, E ELE FOI MEDIDO. A primeira rampa começava do zero e crescia
 *   com o quadrado da profundidade: com o ponteiro onde a mão o deixa — 120px
 *   da borda —, a faixa andou 147px em dois segundos. Parecia travada do mesmo
 *   jeito. Com o piso, entrar na borda já se vê andar, e ainda dá tempo de mirar
 *   a última coluna à vista: ela leva mais de um segundo e meio para passar.
 */
export const PASSO_MINIMO_DO_ARRASTO = 3;

/**
 * Sem `dragover` há este tempo, o arrasto é dado por encerrado.
 *
 * O navegador repete `dragover` mesmo com o ponteiro parado, e `drop`/`dragend`
 * encerram o gesto. Isto é só a rede de baixo: se o cartão sair do documento no
 * meio do arrasto, o `dragend` dele não sobe até ninguém.
 */
export const SILENCIO_DO_ARRASTO = 1500;

export type Caixa = { left: number; right: number; top: number; bottom: number };

/**
 * Quanto a faixa anda neste quadro com o cartão em `x, y` — negativo para a
 * esquerda, zero quando o cartão está longe das bordas.
 *
 * As decisões, uma por linha:
 *   · fora da ALTURA da faixa, nada: arrastar pelo cabeçalho da página até o
 *     canto não pode sair rolando o quadro;
 *   · a borda é a da parte VISÍVEL da faixa — cortada pela janela —, senão a
 *     borda direita de um quadro largo ficaria fora da tela, onde o ponteiro
 *     não chega;
 *   · faixa estreita encolhe a borda para um quarto da largura, senão o miolo
 *     inteiro seria borda e soltar numa coluna do meio viraria rolagem;
 *   · passar um pouco da beirada (a margem da página) ainda puxa, na força
 *     máxima; longe dela, não;
 *   · a força cresce EM LINHA com a profundidade, de `PASSO_MINIMO_DO_ARRASTO`
 *     na entrada até `maximo` na beirada — ver o piso.
 */
export function passoDoArrasto(
  x: number,
  y: number,
  caixa: Caixa,
  larguraDaJanela: number,
  borda = BORDA_DO_ARRASTO,
  maximo = PASSO_DO_ARRASTO,
  minimo = PASSO_MINIMO_DO_ARRASTO,
): number {
  if (y < caixa.top || y > caixa.bottom) return 0;
  const esquerda = Math.max(caixa.left, 0);
  const direita = Math.min(caixa.right, larguraDaJanela);
  const largura = direita - esquerda;
  if (largura <= 0) return 0;

  const zona = Math.min(borda, largura / 4);
  if (x < esquerda - zona || x > direita + zona) return 0;

  const forca = (profundidade: number) =>
    Math.round(minimo + (maximo - minimo) * Math.min(1, profundidade / zona));
  if (x < esquerda + zona) return -forca(esquerda + zona - x);
  if (x > direita - zona) return forca(x - (direita - zona));
  return 0;
}

/* ═════════════════════════ o gesto, no navegador ═════════════════════════ */

/**
 * Prende os dois gestos numa faixa que rola de lado.
 *
 * Devolve a `ref` para pôr no elemento. Ele precisa ser o que tem
 * `overflow-x: auto` — a faixa `.q-colunas`.
 *
 * ⚠️ E É `ref` DE FUNÇÃO, NÃO `useRef` COM `useEffect([])` — ISTO FOI MEDIDO
 *   A primeira versão usava `useEffect` com dependências vazias. No Chrome,
 *   NENHUM dos dois gestos funcionava, e o cursor de mão aparecia — a folha
 *   estava aplicada e o comportamento não.
 *
 *   A causa: a faixa `.q-colunas` só é desenhada DEPOIS que o quadro chega do
 *   servidor (`{quadro && …}`). O efeito de montagem rodava antes disso, achava
 *   `ref.current === null`, saía — e não voltava mais, porque a lista de
 *   dependências vazia diz "rode uma vez".
 *
 *   A `ref` de função é chamada pelo React NO MOMENTO em que o nó entra e sai
 *   do documento. Ela não depende de adivinhar quando isso acontece.
 */
export function usePuxarParaRolar<T extends HTMLElement>(): (no: T | null) => void {
  /** O que desfaz a montagem anterior. */
  const desfazer = useRef<(() => void) | null>(null);

  return useCallback((faixa: T | null) => {
    // O nó anterior saiu (ou vai ser trocado): tira os ouvintes dele antes de
    // qualquer outra coisa. Sem isto, trocar de lista deixaria um ouvinte por
    // quadro aberto, todos escrevendo no mesmo `scrollLeft`.
    desfazer.current?.();
    desfazer.current = null;
    if (faixa === null) return;

    let quadroDaInercia: number | null = null;
    const pararInercia = () => {
      if (quadroDaInercia !== null) {
        cancelAnimationFrame(quadroDaInercia);
        quadroDaInercia = null;
      }
    };

    /* --- 1. a roda ----------------------------------------------------- */

    // A roda pertence ao navegador, em ambos os eixos e em todos os alvos.
    // Só cancela um impulso anterior para o giro vertical não herdar movimento lateral.
    const aoRodar = pararInercia;

    /* --- 2. arrastar o fundo -------------------------------------------- */

    let ponteiro: number | null = null;
    let inicioX = 0;
    let inicioY = 0;
    let inicioDaRolagem = 0;
    let puxando = false;
    let amostras: Amostra[] = [];
    let engolirClique: ((ev: Event) => void) | null = null;

    const soltarOClique = () => {
      if (engolirClique === null) return;
      faixa.removeEventListener('click', engolirClique, true);
      engolirClique = null;
    };

    const aoPressionar = (e: PointerEvent) => {
      // Só o botão principal. O do meio já é a rolagem automática do navegador,
      // e o direito abre o menu de contexto.
      if (e.button !== 0) return;
      pararInercia();
      soltarOClique();
      if (!podePuxar(e.target as unknown as AlvoDoGesto)) return;

      ponteiro = e.pointerId;
      inicioX = e.clientX;
      inicioY = e.clientY;
      inicioDaRolagem = faixa.scrollLeft;
      puxando = false;
      amostras = [{ t: e.timeStamp, x: e.clientX }];
    };

    const aoMover = (e: PointerEvent) => {
      if (ponteiro === null || e.pointerId !== ponteiro) return;
      const dx = e.clientX - inicioX;
      const dy = e.clientY - inicioY;

      if (!puxando) {
        if (!passouDoLimiar(dx, dy)) return;
        puxando = true;
        faixa.dataset.puxando = 'true';
        // A captura mantém o gesto vivo mesmo quando o ponteiro sai da faixa —
        // sem ela, puxar até a borda da tela soltava o quadro no meio.
        try {
          faixa.setPointerCapture(e.pointerId);
        } catch {
          /* navegador sem captura: o gesto ainda funciona dentro da faixa. */
        }
      }

      amostras.push({ t: e.timeStamp, x: e.clientX });
      if (amostras.length > 12) amostras.shift();
      faixa.scrollLeft = inicioDaRolagem - dx;
    };

    const aoSoltar = (e: PointerEvent) => {
      if (ponteiro === null || e.pointerId !== ponteiro) return;
      ponteiro = null;
      delete faixa.dataset.puxando;
      try {
        faixa.releasePointerCapture(e.pointerId);
      } catch {
        /* já solto */
      }
      if (!puxando) return;
      puxando = false;

      // O CLIQUE QUE VEM DEPOIS DE UM ARRASTO NÃO É CLIQUE. Ele é engolido uma
      // vez, na fase de captura, antes de chegar em quem estava embaixo.
      engolirClique = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
        soltarOClique();
      };
      faixa.addEventListener('click', engolirClique, true);
      // Plano B: se nenhum clique vier (o ponteiro saiu da faixa antes de
      // soltar), o ouvinte não pode ficar esperando o próximo clique de
      // verdade. O `pointerdown` seguinte também o tira — os dois juntos
      // cobrem os dois caminhos.
      setTimeout(soltarOClique, 300);

      const v = velocidade(amostras, e.timeStamp);
      amostras = [];
      if (Math.abs(v) < IMPULSO_MINIMO) return;
      if (menosMovimento()) return;

      let velocidadeAtual = v;
      let anterior = performance.now();
      const passoDaInercia = (agora: number) => {
        const dt = Math.min(agora - anterior, 50);
        anterior = agora;
        faixa.scrollLeft -= velocidadeAtual * dt;
        velocidadeAtual = comAtrito(velocidadeAtual, dt);
        if (Math.abs(velocidadeAtual) < PARADA) {
          quadroDaInercia = null;
          return;
        }
        quadroDaInercia = requestAnimationFrame(passoDaInercia);
      };
      quadroDaInercia = requestAnimationFrame(passoDaInercia);
    };

    /* --- 3. o cartão arrastado encostando na borda — 2026-09-17 ---------- */

    // ⚠️ O `dragover` É OUVIDO NO DOCUMENTO, E NÃO NA FAIXA. Quem passa um
    // pouco da beirada — a margem da página — sai de cima da faixa, e ali ela
    // não recebe mais nada. O documento recebe, e a posição continua certa.
    const doc = faixa.ownerDocument;
    let cartaoX = 0;
    let cartaoY = 0;
    let ultimoSinal = 0;
    let quadroDoArrasto: number | null = null;
    let anteriorDoArrasto = 0;
    /** O pedaço de pixel que sobrou do quadro anterior — ver `rolarNaBorda`. */
    let sobra = 0;

    const pararArrasto = () => {
      if (quadroDoArrasto !== null) {
        cancelAnimationFrame(quadroDoArrasto);
        quadroDoArrasto = null;
      }
      doc.removeEventListener('dragover', aoPassarComCartao, true);
      doc.removeEventListener('drop', pararArrasto, true);
      doc.removeEventListener('dragend', pararArrasto, true);
    };

    const rolarNaBorda = (agora: number) => {
      quadroDoArrasto = null;
      if (agora - ultimoSinal > SILENCIO_DO_ARRASTO) return;
      const passo = passoDoArrasto(cartaoX, cartaoY, faixa.getBoundingClientRect(), window.innerWidth);
      // Parou de haver o que rolar (longe da borda, ou a faixa chegou na ponta):
      // o laço dorme, e o próximo `dragover` o acorda.
      if (passo === 0 || !podeAbsorver(faixa.scrollLeft, faixa.scrollWidth, faixa.clientWidth, passo)) {
        sobra = 0;
        return;
      }
      // O passo é por 16 ms, e não por quadro: numa tela de 120 Hz o quadro
      // corre duas vezes e a faixa andaria no dobro da velocidade. A sobra
      // guarda o meio pixel que o `scrollLeft` arredondaria para zero.
      // O carimbo do quadro é o do COMEÇO do quadro, e pode ser anterior ao
      // `performance.now()` do `dragover` que o pediu: sem o piso em zero, o
      // primeiro passo sairia negativo e a faixa daria um pixel para trás.
      const dt = Math.max(0, Math.min(agora - anteriorDoArrasto, 50));
      anteriorDoArrasto = agora;
      const total = (passo * dt) / 16 + sobra;
      const inteiro = Math.trunc(total);
      sobra = total - inteiro;
      faixa.scrollLeft += inteiro;
      quadroDoArrasto = requestAnimationFrame(rolarNaBorda);
    };

    function aoPassarComCartao(e: DragEvent) {
      cartaoX = e.clientX;
      cartaoY = e.clientY;
      ultimoSinal = performance.now();
      if (quadroDoArrasto === null) {
        anteriorDoArrasto = ultimoSinal;
        quadroDoArrasto = requestAnimationFrame(rolarNaBorda);
      }
    }

    // Só o arrasto que NASCE na faixa liga a borda: um arquivo trazido da mesa
    // do computador para a tela não é cartão, e não tem por que rolar o quadro.
    const aoComecarArrasto = () => {
      pararArrasto();
      sobra = 0;
      doc.addEventListener('dragover', aoPassarComCartao, true);
      doc.addEventListener('drop', pararArrasto, true);
      doc.addEventListener('dragend', pararArrasto, true);
    };

    faixa.addEventListener('wheel', aoRodar, { passive: true });
    faixa.addEventListener('pointerdown', aoPressionar);
    faixa.addEventListener('pointermove', aoMover);
    faixa.addEventListener('pointerup', aoSoltar);
    faixa.addEventListener('pointercancel', aoSoltar);
    faixa.addEventListener('dragstart', aoComecarArrasto);

    desfazer.current = () => {
      pararInercia();
      pararArrasto();
      faixa.removeEventListener('dragstart', aoComecarArrasto);
      soltarOClique();
      faixa.removeEventListener('wheel', aoRodar);
      faixa.removeEventListener('pointerdown', aoPressionar);
      faixa.removeEventListener('pointermove', aoMover);
      faixa.removeEventListener('pointerup', aoSoltar);
      faixa.removeEventListener('pointercancel', aoSoltar);
    };
  }, []);
}

/** Quem pediu menos movimento no sistema operacional. */
function menosMovimento(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
