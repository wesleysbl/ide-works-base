/**
 * A geometria dos gráficos — etapa F9.
 *
 * POR QUE ISTO É UM MÓDULO SEPARADO, E NÃO CÓDIGO DENTRO DO COMPONENTE
 *   Gráfico erra em silêncio. Uma linha fora do quadro, um eixo que divide por
 *   zero quando todos os valores são iguais, um buraco na série desenhado como
 *   queda até o chão — nada disso quebra o build, nada disso aparece no teste
 *   de tela, e tudo isso mente para quem lê. Separado, vira número, e número se
 *   confere.
 *
 *   Já aconteceu neste projeto uma classe do Tailwind que não gerava CSS nenhum
 *   e passou por build, lint e 440 testes. A lição foi: o que não é medido, não
 *   está certo — está só sem contradição aparente.
 *
 * O BURACO NÃO É ZERO
 *   `null` na série significa "não há linha para esse dia". A curva **se
 *   interrompe** ali e recomeça depois. Ligar os dois lados desenharia uma
 *   rampa que ninguém viveu; descer até o eixo desenharia uma queda que não
 *   houve. Por isso `segmentos` existe: um traço por trecho contínuo.
 *
 * SEM BIBLIOTECA
 *   Escala e caminho são vinte linhas de conta. Uma dependência de gráfico traz
 *   tema próprio, cor literal e um DOM que o OBSIDIAN teria de reconquistar
 *   classe por classe — e a regra deste projeto é que a cor mora em uma
 *   variável só.
 *
 * O PAR DE NOMES
 *   Este arquivo é a conta; `Graficos.tsx` é o desenho. Chamaram-se `grafico.ts`
 *   e `Grafico.tsx` por algumas horas, e num sistema que ignora maiúsculas —
 *   Windows, macOS — isso é o MESMO arquivo: o empacotador resolveu os dois
 *   para um só e o build quebrou dizendo que um export não existia, apontando
 *   um arquivo onde ele de fato nunca esteve. `test/fontes-integras.test.ts`
 *   passa a barrar o par.
 */

export type Ponto = { dia: string; valor: number | null };

/** A caixa de desenho, em unidades do `viewBox`. */
export type Caixa = { largura: number; altura: number };

export type Limites = { min: number; max: number };

/**
 * O piso e o teto do eixo.
 *
 * O piso é zero por decisão: começar o eixo no menor valor exagera qualquer
 * oscilação — é o truque de gráfico mais antigo que existe, e faz variação de
 * 2% parecer despencar. Só desce abaixo de zero quando há valor negativo de
 * verdade (saldo de seguidores, por exemplo).
 *
 * Série inteira igual — inclusive toda zero — receberia teto igual ao piso e
 * dividiria por zero na escala. Nesse caso o teto sobe, e a linha fica reta no
 * lugar certo em vez de sumir.
 */
export function limites(pontos: readonly Ponto[]): Limites {
  const valores = pontos.map((p) => p.valor).filter((v): v is number => v !== null);
  if (valores.length === 0) return { min: 0, max: 1 };

  const menor = Math.min(...valores);
  const maior = Math.max(...valores);
  const min = Math.min(0, menor);
  // Um respiro no topo: linha encostada na borda parece cortada.
  const max = maior > min ? maior + (maior - min) * 0.08 : min + 1;
  return { min, max };
}

/**
 * Onde cada ponto cai dentro da caixa.
 *
 * O eixo Y do SVG cresce para baixo, então o valor maior recebe o `y` menor —
 * é a inversão que faz o gráfico ficar de cabeça para cima se esquecida.
 */
export function posicionar(
  pontos: readonly Ponto[],
  caixa: Caixa,
  lim: Limites = limites(pontos),
): { x: number; y: number | null; ponto: Ponto }[] {
  const n = pontos.length;
  const faixa = lim.max - lim.min || 1;

  return pontos.map((ponto, i) => ({
    // Um ponto só fica no meio, e não colado na borda esquerda.
    x: n === 1 ? caixa.largura / 2 : (i / (n - 1)) * caixa.largura,
    y: ponto.valor === null ? null : caixa.altura - ((ponto.valor - lim.min) / faixa) * caixa.altura,
    ponto,
  }));
}

export type Posicionado = ReturnType<typeof posicionar>;

/**
 * Quebra a série nos buracos.
 *
 * Cada trecho contínuo vira um traço próprio. Trecho de um ponto só sobrevive —
 * é o dia isolado que a coleta pegou, e some se a gente exigir dois.
 */
export function segmentos(pos: Posicionado): { x: number; y: number }[][] {
  const saida: { x: number; y: number }[][] = [];
  let atual: { x: number; y: number }[] = [];

  for (const p of pos) {
    if (p.y === null) {
      if (atual.length > 0) saida.push(atual);
      atual = [];
    } else {
      atual.push({ x: p.x, y: p.y });
    }
  }
  if (atual.length > 0) saida.push(atual);
  return saida;
}

const nn = (v: number) => Number(v.toFixed(2));

/** O `d` de um traço. Vazio quando não há o que desenhar. */
export function caminho(trecho: readonly { x: number; y: number }[]): string {
  if (trecho.length === 0) return '';
  // Um ponto só não tem linha: vira um traço mínimo, senão o SVG não pinta nada
  // e o dia isolado desaparece da tela.
  if (trecho.length === 1) {
    const p = trecho[0];
    return `M ${nn(p.x - 0.5)} ${nn(p.y)} L ${nn(p.x + 0.5)} ${nn(p.y)}`;
  }
  return trecho.map((p, i) => `${i === 0 ? 'M' : 'L'} ${nn(p.x)} ${nn(p.y)}`).join(' ');
}

/**
 * O mesmo traço fechado contra o chão, para o preenchimento sob a curva.
 *
 * Fecha no piso da CAIXA, não no zero do eixo: com valor negativo os dois não
 * coincidem, e fechar no zero deixaria um vão pintado por fora da área.
 */
export function caminhoDeArea(
  trecho: readonly { x: number; y: number }[],
  caixa: Caixa,
): string {
  if (trecho.length === 0) return '';
  const primeiro = trecho[0];
  const ultimo = trecho[trecho.length - 1];
  const linha = caminho(trecho);
  return `${linha} L ${nn(ultimo.x)} ${nn(caixa.altura)} L ${nn(primeiro.x)} ${nn(caixa.altura)} Z`;
}

/**
 * As marcas do eixo horizontal: no máximo `quantas`, sempre incluindo as pontas.
 *
 * Um rótulo por dia num mês vira borrão. Escolher de quantos em quantos é a
 * diferença entre eixo legível e tinta.
 */
export function marcasDoEixo(pontos: readonly Ponto[], quantas = 5): number[] {
  const n = pontos.length;
  if (n === 0) return [];
  if (n <= quantas) return pontos.map((_, i) => i);

  const passo = (n - 1) / (quantas - 1);
  const indices = new Set<number>();
  for (let i = 0; i < quantas; i++) indices.add(Math.round(i * passo));
  return [...indices].sort((a, b) => a - b);
}

/**
 * A altura de cada barra, como fração do maior valor.
 *
 * Fração e não pixel: quem desenha decide o tamanho. Tudo zero devolve tudo
 * zero — barra nenhuma, em vez de todas cheias por divisão por zero.
 */
export function alturasRelativas(valores: readonly (number | null)[]): number[] {
  const maior = Math.max(0, ...valores.filter((v): v is number => v !== null));
  if (maior === 0) return valores.map(() => 0);
  return valores.map((v) => (v === null ? 0 : Math.max(0, v) / maior));
}

/**
 * A LEITURA EM TEXTO DA CURVA — F14 do plano UX.
 *
 * O `aria-label` era "série diária" em todos os gráficos: o leitor de tela
 * ouvia a mesma frase três vezes e nenhum número. Agora o nome é o título do
 * gráfico mais o que a curva mostra (o maior dia, quantos dias sem coleta), e
 * a tabela dos dias fica a um clique para quem prefere ler a conferir a forma.
 */
const diaDoResumo = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

export function resumoDaSerie(pontos: readonly Ponto[], formatar: (v: number) => string): string {
  const comDado = pontos.filter((p): p is { dia: string; valor: number } => p.valor !== null);
  if (pontos.length === 0) return 'sem dias no período';
  if (comDado.length === 0) return 'nenhum dia do período tem dado';
  const maior = comDado.reduce((a, b) => (b.valor > a.valor ? b : a));
  const faltam = pontos.length - comDado.length;
  return (
    `${diaDoResumo(pontos[0].dia)} a ${diaDoResumo(pontos[pontos.length - 1].dia)}; ` +
    `maior valor ${formatar(maior.valor)} em ${diaDoResumo(maior.dia)}` +
    (faltam > 0 ? `; ${faltam} ${faltam === 1 ? 'dia' : 'dias'} sem coleta` : '')
  );
}
