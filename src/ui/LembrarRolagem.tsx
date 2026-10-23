/**
 * A ROLAGEM VOLTA PARA ONDE ESTAVA — etapa F17.24.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE FOI MEDIDO, ANTES DE ESCREVER
 *
 *   Chrome, `/tarefas`, rolagem em 600px, F5 → `window.scrollY` volta **0**.
 *
 *   E a causa não é o navegador estar desligado: `history.scrollRestoration`
 *   nasce em `auto`, e o Chrome TENTA restaurar. Ele tenta cedo demais. Quando
 *   ele tenta, a tela ainda é o esqueleto — a lista de tarefas chega meio
 *   segundo depois, do banco —, a página tem 900px de altura em vez de 4000, e
 *   600 não cabe. O navegador corta para o máximo possível, que é zero.
 *
 *   É o defeito clássico de aplicativo de uma página só com dado assíncrono, e
 *   ele não se resolve mexendo em CSS: só quem sabe que o conteúdo chegou é
 *   quem está olhando a altura da página.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `sessionStorage`, E NÃO `localStorage`
 *   As duas são "o navegador". A diferença que decide: `sessionStorage` morre
 *   com a ABA. Rolagem de uma aba que foi fechada ontem não é memória, é ruído
 *   — abrir o sistema de manhã e cair no meio da lista seria pior do que
 *   começar no topo. Recarregar a MESMA aba, que é o que o usuário reclamou,
 *   preserva o `sessionStorage` inteiro.
 *
 * ⚠️ O GESTO DA PESSOA GANHA DA RESTAURAÇÃO, SEMPRE
 *   A restauração fica tentando enquanto o conteúdo cresce. Se ela ficasse
 *   tentando sem limite, alguém que rolasse durante a carga seria puxado de
 *   volta pelo próprio sistema — que é um defeito bem pior do que o que isto
 *   conserta. Qualquer roda de mouse, toque, tecla de rolagem ou barra
 *   arrastada CANCELA a restauração na hora.
 *
 * ⚠️ E ELA TEM PRAZO
 *   `LIMITE` de tentativas. Sem prazo, uma tela que nunca alcança a altura
 *   guardada — porque a tarefa foi apagada, porque o filtro mudou — ficaria
 *   empurrando a página para sempre.
 *
 * POR QUE `manual`
 *   Com `auto`, o Chrome faz a tentativa dele (que dá zero, medido) DEPOIS da
 *   nossa em algumas cargas, e o resultado é a página pular para o lugar certo
 *   e voltar para o topo à vista de todo mundo. `manual` desliga a dele; a
 *   nossa faz o mesmo trabalho no momento em que ele serve.
 *
 * ONDE ELE MORA
 *   Uma vez só, em `App`, dentro do `BrowserRouter` e fora das `Routes`: a
 *   rolagem é do documento, e uma cópia por tela seria dezesseis lugares para
 *   a regra divergir.
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const PREFIXO = 'ideworks:rolagem:';

/** Quantas vezes tentar assentar a página no lugar guardado. Ver o cabeçalho. */
const LIMITE = 40;

/** De quanto em quanto tempo. 40 × 60ms = 2,4s, que cobre a leitura do banco. */
const PASSO = 60;

/** Abaixo disto não vale guardar: é o topo, e o topo já é o padrão. */
const MINIMO = 40;

/**
 * Por quantas voltas a RESERVA DE ALTURA fica no ar. Ver o bloco dela lá
 * embaixo para o que ela é.
 *
 * 15 × 60ms = 900ms. O número saiu da medição, e não do dedo: voltando de uma
 * ficha para `/tarefas`, a lista chegou do banco entre 560ms e 626ms nas três
 * corridas. 900ms cobre isso com folga e ainda limita o pior caso — uma
 * resposta que demore mais do que isso mostra o vazio da reserva por 900ms, e
 * não pelos 2,4s do prazo inteiro.
 */
const RESERVA = 15;

/**
 * Quanto tempo NÃO se grava depois de soltar a reserva.
 *
 * ⚠️ MEDIDO, e sem isto a F17.24 morre em silêncio. Soltar a reserva encurta a
 * página, e encurtar a página APARA a rolagem — o que dispara um `scroll`. Esse
 * `scroll` chegava com a página em 0 e gravava 0, que é o mesmo que apagar a
 * memória (é o que `MINIMO` faz). Na medida: a chave de `/tarefas` valia 700
 * aos 150ms e tinha sumido aos 400ms; o F5 seguinte voltava ao topo.
 *
 * O `scroll` do aparo não é gesto de ninguém, e não deve contar como um.
 */
const TRAVA_APOS_APARO = 250;

const ler = (chave: string): number => {
  try {
    const cru = window.sessionStorage.getItem(PREFIXO + chave);
    if (cru === null) return 0;
    const n = Number.parseInt(cru, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
};

const gravar = (chave: string, valor: number) => {
  try {
    if (valor < MINIMO) window.sessionStorage.removeItem(PREFIXO + chave);
    else window.sessionStorage.setItem(PREFIXO + chave, String(valor));
  } catch {
    // Navegação privada, ou armazenamento cheio. Sem memória de rolagem — que é
    // exatamente o comportamento de antes desta etapa.
  }
};

export function LembrarRolagem() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    try {
      if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    } catch {
      // Navegador sem a propriedade: a dele continua ligada, e a nossa também.
      // O pior caso é o pulo descrito no cabeçalho, não a perda da função.
    }
  }, []);

  useEffect(() => {
    // O atalho de notificação posiciona no comentário depois que a ficha chega.
    if (hash.startsWith('#comentario-')) return;
    const guardada = ler(pathname);

    let tentativas = 0;
    let parado = false;
    let relogio: ReturnType<typeof setInterval> | null = null;

    /**
     * ⚠️ ENQUANTO SE RESTAURA, NÃO SE GRAVA. Isto foi medido, e sem isto a
     * função não funciona de jeito nenhum.
     *
     *   Sintoma: F5 em 600px voltava em 0, e a chave sumia do `sessionStorage`
     *   antes de um segundo de vida.
     *
     *   Causa: `React.StrictMode` (ver `main.tsx`) monta, DESMONTA e monta de
     *   novo todo efeito. A limpeza da primeira montagem rodava quando a tela
     *   ainda era o esqueleto, com a rolagem em 0 — e gravar 0 APAGA a memória
     *   (é o que `MINIMO` faz). A segunda montagem já não achava nada para
     *   restaurar.
     *
     *   Não é um caso de teste artificial: qualquer gravação disparada durante
     *   a carga faz o mesmo estrago, porque durante a carga a rolagem é sempre
     *   zero. A trava é o conserto certo, e não o `StrictMode`.
     */
    let restaurando = guardada >= MINIMO;

    /** Até quando o `scroll` não é de ninguém. Ver `TRAVA_APOS_APARO`. */
    let travadoAte = 0;

    /* ═══════════════════ a reserva de altura — F17.33 ═══════════════════

       O QUE FOI MEDIDO, NO CHROME, ANTES DE ESCREVER ISTO

         Voltar de uma ficha para `/tarefas` com a lista rolada em 833px. A
         série da rolagem, quadro a quadro:

           t=0ms    → 0px    (página com 1047px de altura)
           t=492ms  → 68px   (página com 968px — o ESQUELETO)
           t=626ms  → 833px  (página com 1733px — o conteúdo chegou)

         São DOIS solavancos, em 626ms. E o do meio não é um erro de conta: é
         `scrollTo(0, 833)` APARADO pelo máximo de uma página que ainda não
         tem conteúdo. Enquanto a lista carrega, o relógio abaixo pede 833 a
         cada 60ms e o navegador entrega o que couber — 0, depois 68, depois
         833. A rolagem SOBE EM DEGRAUS à vista de todo mundo.

       POR QUE NÃO BASTA "ESPERAR A PÁGINA CRESCER"

         Esperaria meio segundo olhando o topo de uma lista que a pessoa não
         pediu, e só então saltaria 833px de uma vez. Um solavanco em vez de
         dois é melhor, mas continua sendo um solavanco.

       A RESERVA: A PÁGINA FINGE A ALTURA QUE TINHA

         `min-height` no `<html>`, do tamanho de onde se estava. Aí o lugar
         guardado EXISTE já no primeiro quadro, o `scrollTo` não é aparado, e
         o conteúdo aparece por baixo de uma rolagem que já está certa.

         ⚠️ Ela mora no `<html>`, e não no `<body>`, porque é preciso medir a
         altura DE VERDADE enquanto a mentira está no ar. Medido no Chrome:
         com `min-height: 9000px` no `<html>`, `documentElement.scrollHeight`
         foi a 9000 e `body.scrollHeight` ficou em 953. O corpo é a régua
         honesta, e é ele que diz quando a reserva pode sair.

       ⚠️ E ELA SAI SEMPRE
         `parar()` a solta — e `parar()` é chamado pelo gesto da pessoa, pelo
         prazo e pela limpeza do efeito. Uma reserva esquecida seria uma
         página com meia tela de vazio embaixo para o resto da sessão.
       ═══════════════════════════════════════════════════════════════════ */

    const raiz = document.documentElement;
    /** A altura de verdade — ver acima por que é o corpo, e não a raiz. */
    const alturaReal = () => document.body.scrollHeight;
    /** A página já dá para chegar ao lugar guardado sem a reserva? */
    const alcanca = () => alturaReal() - window.innerHeight >= guardada - 2;

    const parar = () => {
      parado = true;
      restaurando = false;
      if (raiz.style.minHeight !== '') {
        raiz.style.removeProperty('min-height');
        travadoAte = Date.now() + TRAVA_APOS_APARO;
      }
      if (relogio !== null) {
        clearInterval(relogio);
        relogio = null;
      }
    };

    /* --- o gesto da pessoa cancela. Ver o cabeçalho. --- */
    const desistir = () => parar();
    const teclaDeRolagem = (e: KeyboardEvent) => {
      const rola = [
        'PageUp',
        'PageDown',
        'Home',
        'End',
        'ArrowUp',
        'ArrowDown',
        ' ',
      ].includes(e.key);
      if (rola) parar();
    };

    if (guardada >= MINIMO) {
      window.addEventListener('wheel', desistir, { passive: true, once: true });
      window.addEventListener('touchmove', desistir, { passive: true, once: true });
      window.addEventListener('mousedown', desistir, { once: true });
      window.addEventListener('keydown', teclaDeRolagem);

      /*
        ⚠️ NÃO SE ADIVINHA "O CONTEÚDO CHEGOU" PELA ALTURA — DUAS TENTATIVAS
        FALHARAM, E AS DUAS FORAM MEDIDAS.

          1ª: "cresceu um pixel, espere duas voltas". Soltou a reserva aos
              609ms; o conteúdo de `/tarefas` chegou aos 626ms. Dezessete
              milissegundos de diferença, e a rolagem ficou em 68px.

          2ª: "cresceu mais que `MINIMO` e ficou parada por cinco voltas". O
              ESQUELETO cresce sozinho — medido em 900 → 968px, mais que
              `MINIMO`, e parado ali por meio segundo enquanto o banco
              respondia. A reserva saiu antes dos 400ms, a rolagem foi a 0 e a
              chave do `sessionStorage` foi apagada junto.

        A altura não sabe a diferença entre "o esqueleto acabou de desenhar" e
        "a lista chegou". Então a reserva não pergunta a ela: ela tem PRAZO
        (`RESERVA`), e sai antes disso se o lugar guardado passar a existir de
        verdade — que é o caso normal e o único sem solavanco nenhum.
      */
      const tentar = () => {
        if (parado) return;
        tentativas += 1;
        const reservando = tentativas <= RESERVA;

        /*
          ⚠️ FORA DA RESERVA, SÓ SE ROLA QUANDO O LUGAR EXISTE.

          Rolar antes disso é pedir 833 e receber o máximo do esqueleto — e é
          exatamente o que fazia a rolagem subir em DEGRAUS (0 → 68 → 833, em
          626ms, medido). Durante a reserva não há esse risco: a página tem a
          altura de onde se estava, então o pedido é sempre atendido inteiro.
        */
        if (reservando || alcanca()) {
          // `scrollTo` sem `behavior` é instantâneo: uma rolagem animada de
          // 600px a cada F5 seria o "efeito" que a F17.20 tirou do sistema.
          window.scrollTo(0, guardada);
        }
        if (!reservando && raiz.style.minHeight !== '') {
          raiz.style.removeProperty('min-height');
          travadoAte = Date.now() + TRAVA_APOS_APARO;
        }

        if (alcanca() || tentativas >= LIMITE) parar();
      };

      // A reserva antes da primeira tentativa — sem ela a primeira tentativa é
      // justamente o degrau do meio que a medição pegou.
      raiz.style.minHeight = `${guardada + window.innerHeight}px`;
      tentar();
      relogio = setInterval(tentar, PASSO);
    } else {
      // Sem posição guardada, uma tela nova começa no topo. Sem esta linha,
      // trocar de tela herdaria a rolagem da anterior — que é o outro defeito
      // clássico de aplicativo de uma página só.
      window.scrollTo(0, 0);
    }

    /* --- guardar enquanto rola --- */
    const guardarAgora = () => {
      if (restaurando) return;
      // O `scroll` que a própria reserva causou ao sair não é de ninguém.
      if (Date.now() < travadoAte) return;
      gravar(pathname, Math.round(window.scrollY));
    };

    let pendente = false;
    const aoRolar = () => {
      if (pendente) return;
      pendente = true;
      // Uma gravação por quadro, e não uma por evento: o `scroll` dispara
      // dezenas de vezes por segundo, e `sessionStorage` é síncrono.
      window.requestAnimationFrame(() => {
        pendente = false;
        guardarAgora();
      });
    };
    window.addEventListener('scroll', aoRolar, { passive: true });

    // `pagehide` e não `beforeunload`: o segundo desliga o cache de volta do
    // navegador em parte deles, e o que se quer aqui é só o último retrato.
    //
    // ⚠️ E a limpeza do efeito NÃO grava. Ela roda no desmonte do `StrictMode`
    // e ao trocar de tela — nos dois casos com a rolagem já em zero. Quem
    // guarda é o `scroll`, que já gravou a última posição enquanto a pessoa
    // rolava; aqui só se cobre o fechamento da aba.
    window.addEventListener('pagehide', guardarAgora);

    return () => {
      parar();
      window.removeEventListener('scroll', aoRolar);
      window.removeEventListener('pagehide', guardarAgora);
      window.removeEventListener('wheel', desistir);
      window.removeEventListener('touchmove', desistir);
      window.removeEventListener('mousedown', desistir);
      window.removeEventListener('keydown', teclaDeRolagem);
    };
  }, [pathname, hash]);

  return null;
}
