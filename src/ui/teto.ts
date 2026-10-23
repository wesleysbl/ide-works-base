/**
 * ONDE O MENU CABE — a geometria da etapa F17.35.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O PEDIDO DO USUÁRIO
 *
 *   *"Precisamos melhorar as abas de menus e seleções, todas ficam muito
 *   extensas e blocadas, às vezes sem barra lateral ou com o scroll limitado."*
 *
 * O QUE ESTAVA ERRADO, MEDIDO ANTES DE MEXER
 *   `.cu-balao` não tinha teto de altura nenhum, e `.cu-rolagem` tinha um teto
 *   de `15rem` — unidade de FONTE. Em Chrome a 1280×720, o menu `Mover a lista
 *   para…` abria com 333px de altura a partir de y=529: a base caía em 861 numa
 *   janela de 720. **141 pixels de menu fora da tela**, e nada para alcançá-los,
 *   porque quem rolava era a caixa de dentro, já no fim do próprio curso.
 *
 * A REGRA QUE ESTE ARQUIVO ESCREVE
 *   O teto de um menu é o ESPAÇO QUE EXISTE entre a âncora e a borda da janela,
 *   e não um número em `rem`. O mesmo menu, na mesma tela, tem tetos diferentes
 *   conforme onde foi aberto — que é exatamente o que "caber" quer dizer.
 *
 * POR QUE UM ARQUIVO SÓ PARA ISTO
 *   Porque a conta é pura e a conta é onde mora o erro. Aqui ela se prova sem
 *   navegador, item por item; nos componentes só sobra ler a caixa e aplicar.
 *   São três peças que precisam da mesma conta — `Balao`, `Menu` e `Gaveta` —
 *   e três cópias dela seriam três lugares para divergir.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useState, type RefObject } from 'react';

/** Os quatro lados de abertura. Nome igual ao de `data-lado` na folha. */
export type Lado = 'baixo' | 'cima' | 'baixo-direita' | 'cima-direita';

/** Entre a âncora e o balão. Igual ao `0.3rem` da folha, arredondado. */
export const FOLGA = 5;

/** Entre o balão e a borda da janela. Menos que isto lê como corte. */
export const MARGEM = 8;

/**
 * O teto abaixo do qual um menu deixa de ser menu.
 *
 * `132px` são cerca de quatro itens de `.cu-item` mais a folga do balão. Com
 * menos do que isso a pessoa vê uma fresta e rola às cegas — pior do que um
 * menu que cobre um pedaço da âncora. Quando nem este mínimo existe dos dois
 * lados, quem escolhe é o lado maior, e o balão flutuante ainda se prende
 * dentro da janela ao posicionar.
 */
export const TETO_MINIMO = 132;

/**
 * DE QUE TAMANHO O MENU QUER SER — e por que não basta medir a altura dele.
 *
 * ⚠️ Esta é a armadilha desta etapa, e ela custou uma rodada. Assim que o teto
 * passa a valer, a altura medida do balão é a altura JÁ CORTADA — que cabe do
 * lado escolhido por definição. Uma decisão de lado alimentada por ela nunca
 * mais mudaria de ideia, e um menu grande ficaria preso do lado apertado.
 *
 * A primeira tentativa foi guardar a altura do PRIMEIRO quadro num `ref`. Ela
 * também estava errada, e o erro foi medido: no menu do `···` da árvore, ir de
 * `Mover a lista para…` para o menu de trás NÃO desmonta o balão — o React
 * reconcilia os dois no mesmo lugar da árvore, o `ref` sobrevive, e o menu de
 * dez destinos herdava a altura do menu de cinco itens. Medido a 1280×1200: ele
 * abria para baixo com 296px de lista para 454px de conteúdo, tendo 790px
 * livres acima.
 *
 * A conta certa soma à altura corrente TUDO o que sobrou de fora — o que passa
 * do balão e o que passa da lista de dentro. Ela não depende do teto: quando o
 * teto encolhe um pixel, a sobra cresce um pixel, e o total não se move.
 */
export type Medida = {
  /** A altura que o balão tem AGORA. */
  readonly altura: number;
  /** O que passou do próprio balão: `scrollHeight - clientHeight`. */
  readonly sobraDoBalao: number;
  /** O mesmo, para a `.cu-rolagem` de dentro, quando existe. */
  readonly sobraDaLista: number;
};

export const alturaDesejada = (m: Medida): number =>
  Math.round(m.altura + m.sobraDoBalao + m.sobraDaLista);

/** Só o que interessa de um `DOMRect`. Assim a conta se prova sem navegador. */
export type Caixa = {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
};

export type Janela = { readonly largura: number; readonly altura: number };

export type Escolha = {
  /** O lado onde o menu de fato cabe — pode não ser o pedido. */
  readonly lado: Lado;
  /** O teto de altura em pixels, para `max-height`. */
  readonly teto: number;
  /** Quanto há entre a âncora e a borda de baixo, já descontadas folga e margem. */
  readonly abaixo: number;
  /** O mesmo, para cima. */
  readonly acima: number;
};

const paraBaixoNo = (lado: Lado) => lado === 'baixo' || lado === 'baixo-direita';
const alinhadoAEsquerda = (lado: Lado) => lado === 'baixo' || lado === 'cima';

const compor = (paraBaixo: boolean, aEsquerda: boolean): Lado =>
  paraBaixo ? (aEsquerda ? 'baixo' : 'baixo-direita') : aEsquerda ? 'cima' : 'cima-direita';

/**
 * Onde o menu cabe, e de quanto ele pode crescer ali.
 *
 * ⚠️ A ALTURA QUE ENTRA AQUI É A DESEJADA, e nunca a corrente. Ver `Medida`
 *   e `alturaDesejada` acima — é lá que está a explicação e o defeito medido.
 *
 *   `0` significa "ainda não sei", e aí a escolha é só pelo espaço.
 *
 * ⚠️ E O LADO PEDIDO NÃO É DONO DA DECISÃO — foi medido. Com a regra "fica no
 *   lado pedido enquanto ali couber um menu de quatro itens", o `Mover a lista
 *   para…` da última lista da árvore abria para baixo com 89px de lista para
 *   454px de conteúdo, numa janela de 720 — enquanto havia 511px livres ACIMA
 *   da âncora. Cabia na tela e não passava da borda, e ainda assim era a
 *   reclamação do usuário em outra forma: *"o scroll limitado"*.
 *
 * A largura entra do mesmo jeito no eixo horizontal: se encostar na direita
 * pelo lado pedido, alinha pela outra ponta — e só se lá couber.
 */
export function ondeCabe(
  ancora: Caixa,
  janela: Janela,
  pedido: Lado,
  largura: number,
  /** De que tamanho o menu quer ser. Ver `alturaDesejada`. */
  desejada = 0,
): Escolha {
  const abaixo = Math.round(janela.altura - ancora.bottom - FOLGA - MARGEM);
  const acima = Math.round(ancora.top - FOLGA - MARGEM);

  const preferidoAbaixo = paraBaixoNo(pedido);
  const espacoPreferido = preferidoAbaixo ? abaixo : acima;
  const espacoOutro = preferidoAbaixo ? acima : abaixo;
  /* COM A ALTURA EM MÃOS: fica no lado pedido se o menu INTEIRO cabe ali; se
     não cabe, vai para o outro lado caso lá caiba; e se não cabe em lugar
     nenhum, vai para o lado MAIOR — é onde a pessoa vê mais de uma vez.

     SEM A ALTURA (o primeiro quadro, ou quem chama sem medir): fica no lado
     pedido enquanto ali houver menu que se use, e só abaixo disso vira. Virar
     por palpite seria pior — a pessoa aprende de que lado o menu abre. */
  const fica = (cabe: boolean) => (cabe ? preferidoAbaixo : !preferidoAbaixo);
  const paraBaixo =
    desejada > 0
      ? espacoPreferido >= desejada
        ? preferidoAbaixo
        : fica(!(espacoOutro >= desejada || espacoOutro > espacoPreferido))
      : fica(espacoPreferido >= TETO_MINIMO || espacoPreferido >= espacoOutro);

  const espaco = paraBaixo ? abaixo : acima;
  const tetoDaJanela = Math.round(janela.altura - 2 * MARGEM);
  const teto = Math.max(1, Math.min(Math.max(espaco, TETO_MINIMO), tetoDaJanela));

  // --- o eixo horizontal ---
  // Sem largura medida (o primeiro quadro) não há o que decidir: mantém o pedido.
  let aEsquerda = alinhadoAEsquerda(pedido);
  if (largura > 0) {
    const cabeAlinhadoAEsquerda = ancora.left + largura <= janela.largura - MARGEM;
    const cabeAlinhadoADireita = ancora.right - largura >= MARGEM;
    if (aEsquerda && !cabeAlinhadoAEsquerda && cabeAlinhadoADireita) aEsquerda = false;
    else if (!aEsquerda && !cabeAlinhadoADireita && cabeAlinhadoAEsquerda) aEsquerda = true;
  }

  return { lado: compor(paraBaixo, aEsquerda), teto, abaixo, acima };
}

/**
 * O teto de uma LISTA que pende de um botão — o caso de `Menu` e `Gaveta`,
 * onde o balão inteiro é a lista e não há quatro lados para escolher.
 *
 * A conta não precisa da âncora: o balão é preso pelo TOPO (`mt-2` embaixo do
 * botão), então `topoDoBalao` não se mexe quando o teto muda. É o que torna a
 * medida estável — a alternativa, medir a altura do balão, se alimentaria do
 * próprio efeito, porque a altura dele já é a altura cortada.
 *
 * `moldura` é o que o balão gasta ALÉM da lista: o campo de busca no topo, o
 * cabeçalho, o `Limpar` do pé. Ela também é estável — cresce e encolhe junto
 * com o balão, e a diferença entre os dois é sempre a mesma.
 */
export function tetoDaLista(topoDoBalao: number, alturaDaJanela: number, moldura: number): number {
  return Math.max(TETO_MINIMO, Math.round(alturaDaJanela - topoDoBalao - MARGEM - moldura));
}

/** Onde a lista de `Menu`/`Gaveta` cabe: para baixo do botão, ou para cima. */
export type Pendura = {
  /** O teto da lista em pixels. */
  readonly teto: number;
  /** `true` quando abrir para baixo deixaria a lista menor do que se usa. */
  readonly paraCima: boolean;
};

/**
 * A medida de `Menu` e `Gaveta`, em pixels — ou `null` no primeiro quadro,
 * antes de haver caixa.
 *
 * ⚠️ `useEffect` e não `useLayoutEffect`: a suíte desenha estas telas com
 * `renderToStaticMarkup`, e `useLayoutEffect` no servidor é aviso em toda
 * execução. A mesma decisão que `Balao` já tinha tomado.
 */
export function usePendura(
  gatilho: RefObject<HTMLElement | null>,
  balao: RefObject<HTMLElement | null>,
  lista: RefObject<HTMLElement | null>,
  ativo: boolean,
): Pendura | null {
  const [pendura, setPendura] = useState<Pendura | null>(null);

  useEffect(() => {
    if (!ativo) {
      setPendura(null);
      return;
    }
    const medir = () => {
      const g = gatilho.current;
      const b = balao.current;
      const l = lista.current;
      if (g === null || b === null || l === null) return;
      const cg = g.getBoundingClientRect();
      const alturaDaJanela = window.innerHeight;
      const moldura = Math.max(0, b.getBoundingClientRect().height - l.clientHeight);

      /* A folga entre o botão e o balão vem do `mt-2`/`mb-2` da peça, e não de
         medida: medida ela mudaria de sinal assim que o balão virasse para
         cima, e a conta passaria a se alimentar da própria decisão. */
      const FOLGA_DA_PECA = 8;
      // Para baixo o balão começa logo abaixo do botão; para cima ele termina
      // logo acima dele. Nos dois casos a ponta presa é a que não se mexe.
      const abaixo = tetoDaLista(cg.bottom + FOLGA_DA_PECA, alturaDaJanela, moldura);
      const acima = Math.max(
        TETO_MINIMO,
        Math.round(cg.top - FOLGA_DA_PECA - MARGEM - moldura),
      );
      const paraCima = abaixo <= TETO_MINIMO && acima > abaixo;

      const novo = { teto: paraCima ? acima : abaixo, paraCima };
      setPendura((tinha) =>
        tinha !== null && tinha.teto === novo.teto && tinha.paraCima === novo.paraCima
          ? tinha
          : novo,
      );
    };
    medir();
    const quadro = window.requestAnimationFrame(medir);
    // `true` na captura: a rolagem que importa pode ser a de uma caixa interna,
    // e o evento de rolagem de elemento não sobe por borbulhamento.
    window.addEventListener('scroll', medir, true);
    window.addEventListener('resize', medir);
    return () => {
      window.cancelAnimationFrame(quadro);
      window.removeEventListener('scroll', medir, true);
      window.removeEventListener('resize', medir);
    };
  }, [ativo, gatilho, balao, lista]);

  return pendura;
}

/**
 * Quanto empurrar na horizontal um balão preso pela ponta DIREITA da âncora
 * para ele caber inteiro na janela — F27.
 *
 * O calendário do `SeletorDePeriodo` abre alinhado à direita do botão
 * (`right-0`), e no desktop é o lugar certo. No celular o botão cai perto do
 * meio da linha, e os 288px do balão passavam 93px da borda ESQUERDA a 390px.
 * Trocar de ponta, como `ondeCabe` faz, não basta: com o botão no meio, nem
 * alinhado à direita nem à esquerda cabe em toda largura de tela.
 *
 * Então a conta prende o balão entre as duas margens e devolve o quanto ele
 * andou. Quando já cabe, devolve 0 — e é isso que garante o desktop intacto.
 * Quando nem ele inteiro cabe, encosta na margem esquerda; o `max-width` da
 * peça corta o que sobrar.
 */
export function deslocamentoParaCaber(
  direitaDaAncora: number,
  largura: number,
  larguraDaJanela: number,
): number {
  const esquerda = direitaDaAncora - largura;
  const maximo = Math.max(MARGEM, larguraDaJanela - MARGEM - largura);
  return Math.round(Math.min(Math.max(esquerda, MARGEM), maximo) - esquerda);
}

/**
 * Rola até o item focado aparecer.
 *
 * `block: 'nearest'` e não `'center'`: centralizar move a lista inteira a cada
 * seta, e a pessoa perde a referência de onde estava. `nearest` só mexe quando
 * o item de fato está fora — que é o pedido da etapa.
 */
export function rolarAteAparecer(el: HTMLElement): void {
  el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}
