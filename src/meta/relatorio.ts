/**
 * Os relatórios da Meta — etapa F9.
 *
 * É aqui que a série diária vira número de tela: KPI de campanha e KPI de
 * perfil, mais as séries que os gráficos desenham.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A ARMADILHA QUE DECIDE O DESENHO INTEIRO: NEM TODA MÉTRICA SE SOMA
 *
 *   `impressões` é uma CONTAGEM DE EVENTOS. Se segunda teve 1.000 e terça teve
 *   1.000, a semana teve 2.000. Somar está certo.
 *
 *   `alcance` é uma CONTAGEM DE PESSOAS DISTINTAS. Se as mesmas 1.000 pessoas
 *   viram o anúncio nos dois dias, a semana alcançou 1.000 — não 2.000. Somar
 *   alcance diário **infla o número**, e infla mais quanto maior o período: no
 *   mês, um perfil pequeno chega a reportar mais "alcance" do que existe de
 *   gente no país.
 *
 *   A Meta não tem esse problema porque ela guarda quem viu. Nós guardamos só o
 *   total do dia — e desse total **não dá para reconstruir** o do período. Não é
 *   limitação da nossa coleta: é matemática. Nenhuma soma, média ou fórmula
 *   sobre números diários recupera a interseção que foi jogada fora.
 *
 *   Então este módulo **se recusa a somar alcance**. Onde o dado é de pessoas
 *   distintas, ele devolve a média diária e o pico, que são verdade, em vez de
 *   um total que seria mentira. As duas classes estão marcadas no tipo, não no
 *   comentário: `SOMAVEIS` e `DISTINTAS`. Quem acrescentar métrica escolhe.
 *
 *   O legado errava exatamente isto, e é por isso que a regra virou código.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * DIVISÃO POR ZERO NÃO É ZERO
 *   CTR de uma campanha com zero impressão não é 0% — é *não existe*. Todo
 *   derivado devolve `null` quando o denominador é zero, e a tela mostra "—".
 *   Um zero ali seria lido como "performou mal", que é afirmação diferente de
 *   "não rodou".
 *
 * DIA SEM LINHA NÃO É DIA COM ZERO
 *   A coleta grava uma linha por dia com movimento. Um buraco na série pode ser
 *   "não gastou" ou "não coletamos" — e as duas coisas não podem virar a mesma
 *   barra de altura zero. A série devolve `null` no buraco, e o gráfico
 *   interrompe a linha ali.
 */

/* ─── o que a coleta guarda ────────────────────────────────────────────────── */

export type DiaDeCampanha = {
  day: string;
  campaignId: string;
  campaignName: string | null;
  spend: number | null;
  reach: number | null;
  impressions: number | null;
  clicks: number | null;
  linkClicks: number | null;
  conversions: number | null;
  conversionValue: number | null;
};

export type DiaOrganico = {
  day: string;
  reach: number | null;
  views: number | null;
  accountsEngaged: number | null;
  totalInteractions: number | null;
  follows: number | null;
  unfollows: number | null;
  profileLinksTaps: number | null;
  /**
   * As quatro que a coleta buscava e jogava fora até a F9d.
   *
   * São SALDO, como `totalInteractions`: podem ser negativas quando mais gente
   * desfaz do que faz. Ver o cabeçalho de `server/meta-coleta.ts`.
   */
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  /**
   * O TOTAL de seguidores no dia — não o ganho.
   *
   * Só vem carimbado no último dia de cada coleta, então a maioria dos dias tem
   * nulo aqui. É de propósito: guardando um por coleta, a curva de crescimento
   * passa a existir. A Meta não a devolve — `follows` dá o ganho do dia e nunca
   * o total de ontem.
   */
  followersTotal: number | null;
  mediaCount: number | null;
};

/* ─── as duas classes de métrica ───────────────────────────────────────────── */

/** Contagem de eventos: somar dias é legítimo. */
export const SOMAVEIS = [
  'spend',
  'impressions',
  'clicks',
  'linkClicks',
  'conversions',
  'conversionValue',
  'views',
  'totalInteractions',
  'follows',
  'unfollows',
  'profileLinksTaps',
] as const;

/** Contagem de pessoas distintas: somar dias infla. Ver o cabeçalho. */
export const DISTINTAS = ['reach', 'accountsEngaged'] as const;

export type MetricaSomavel = (typeof SOMAVEIS)[number];
export type MetricaDistinta = (typeof DISTINTAS)[number];

const eDistinta = (m: string): m is MetricaDistinta =>
  (DISTINTAS as readonly string[]).includes(m);

/**
 * O que se pode dizer sobre uma métrica de pessoas distintas sem mentir.
 *
 * Não tem `total` de propósito. Se um dia alguém precisar do alcance do
 * período, o caminho é pedir à Meta — não somar aqui.
 */
export type PorDia = {
  /** Média dos dias que TÊM dado. Dia não coletado não puxa a média para baixo. */
  media: number | null;
  /** O melhor dia do período. */
  pico: number | null;
  /** Em que dia foi o pico — a tela mostra, e é a pergunta seguinte. */
  diaDoPico: string | null;
  /** Quantos dias entraram na conta. Sem isso a média não se interpreta. */
  dias: number;
};

/* ─── aritmética que se recusa a inventar ──────────────────────────────────── */

/** Divisão que devolve `null` — e não zero, nem Infinity, nem NaN. */
export function dividir(a: number | null, b: number | null): number | null {
  if (a === null || b === null || b === 0) return null;
  const r = a / b;
  return Number.isFinite(r) ? r : null;
}

/**
 * Soma que distingue "nenhum dado" de "zero".
 *
 * Uma campanha sem nenhum dia coletado tem gasto `null`, não `0`. Zero diria
 * "não gastou nada", que é informação que não temos.
 */
export function somar(valores: readonly (number | null)[]): number | null {
  let total = 0;
  let houve = false;
  for (const v of valores) {
    if (v === null) continue;
    total += v;
    houve = true;
  }
  return houve ? total : null;
}

/** Média, pico e dia do pico — a leitura honesta de métrica de pessoas. */
export function porDia(
  linhas: readonly { day: string; valor: number | null }[],
): PorDia {
  const comDado = linhas.filter((l) => l.valor !== null) as {
    day: string;
    valor: number;
  }[];
  if (comDado.length === 0) return { media: null, pico: null, diaDoPico: null, dias: 0 };

  let pico = comDado[0];
  let soma = 0;
  for (const l of comDado) {
    soma += l.valor;
    // `>` e não `>=`: empate fica com o dia mais antigo, que é o que a pessoa
    // aponta quando pergunta "quando foi".
    if (l.valor > pico.valor) pico = l;
  }
  return {
    media: soma / comDado.length,
    pico: pico.valor,
    diaDoPico: pico.day,
    dias: comDado.length,
  };
}

/* ─── campanhas ────────────────────────────────────────────────────────────── */

export type ResumoDeCampanha = {
  campaignId: string;
  campaignName: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  linkClicks: number | null;
  conversions: number | null;
  conversionValue: number | null;
  /** Pessoas distintas: só média e pico. Ver o cabeçalho. */
  alcance: PorDia;
  /** Derivados — `null` sempre que o denominador é zero. */
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cpa: number | null;
  roas: number | null;
  /** Quantos dias do período essa campanha teve movimento. */
  dias: number;
};

function derivar(
  base: Omit<ResumoDeCampanha, 'ctr' | 'cpc' | 'cpm' | 'cpa' | 'roas'>,
): ResumoDeCampanha {
  const { spend, impressions, clicks, conversions, conversionValue } = base;
  return {
    ...base,
    ctr: dividir(clicks, impressions),
    cpc: dividir(spend, clicks),
    // CPM é por MIL impressões — o fator não é enfeite.
    cpm: dividir(spend === null ? null : spend * 1000, impressions),
    cpa: dividir(spend, conversions),
    roas: dividir(conversionValue, spend),
  };
}

/**
 * Junta as linhas diárias de UMA campanha.
 *
 * O nome vem da linha mais recente: campanha renomeada no meio do período
 * aparece com o nome de agora, que é como a pessoa vai procurá-la no
 * gerenciador.
 */
export function resumirCampanha(dias: readonly DiaDeCampanha[]): ResumoDeCampanha {
  const ordenados = [...dias].sort((a, b) => a.day.localeCompare(b.day));
  const ultimoComNome = [...ordenados].reverse().find((d) => d.campaignName !== null);

  return derivar({
    campaignId: ordenados[0]?.campaignId ?? '',
    campaignName: ultimoComNome?.campaignName ?? null,
    spend: somar(ordenados.map((d) => d.spend)),
    impressions: somar(ordenados.map((d) => d.impressions)),
    clicks: somar(ordenados.map((d) => d.clicks)),
    linkClicks: somar(ordenados.map((d) => d.linkClicks)),
    conversions: somar(ordenados.map((d) => d.conversions)),
    conversionValue: somar(ordenados.map((d) => d.conversionValue)),
    alcance: porDia(ordenados.map((d) => ({ day: d.day, valor: d.reach }))),
    dias: new Set(ordenados.map((d) => d.day)).size,
  });
}

/**
 * O período inteiro, campanha por campanha, do maior gasto para o menor.
 *
 * Campanha sem gasto vai para o fim — não porque não importe, mas porque a
 * pergunta que abre esta tela é "para onde foi o dinheiro".
 */
export function porCampanha(dias: readonly DiaDeCampanha[]): ResumoDeCampanha[] {
  const baldes = new Map<string, DiaDeCampanha[]>();
  for (const d of dias) {
    const b = baldes.get(d.campaignId);
    if (b) b.push(d);
    else baldes.set(d.campaignId, [d]);
  }
  return [...baldes.values()]
    .map(resumirCampanha)
    .sort(
      (a, b) =>
        (b.spend ?? -1) - (a.spend ?? -1) ||
        (a.campaignName ?? a.campaignId).localeCompare(b.campaignName ?? b.campaignId),
    );
}

/**
 * O total da conta no período.
 *
 * Repare que **não** é a soma dos resumos por campanha para o alcance: cada
 * campanha tem o seu pico em dia diferente, e somar picos não dá pico. O total
 * refaz a conta a partir dos dias — e mesmo assim o alcance da conta continua
 * sendo média e pico, pelo motivo do cabeçalho.
 */
export function resumirPago(dias: readonly DiaDeCampanha[]): ResumoDeCampanha {
  const porDiaSomado = new Map<string, number | null>();
  for (const d of dias) {
    if (d.reach === null) continue;
    porDiaSomado.set(d.day, (porDiaSomado.get(d.day) ?? 0) + d.reach);
  }

  return derivar({
    campaignId: '',
    campaignName: null,
    spend: somar(dias.map((d) => d.spend)),
    impressions: somar(dias.map((d) => d.impressions)),
    clicks: somar(dias.map((d) => d.clicks)),
    linkClicks: somar(dias.map((d) => d.linkClicks)),
    conversions: somar(dias.map((d) => d.conversions)),
    conversionValue: somar(dias.map((d) => d.conversionValue)),
    alcance: porDia([...porDiaSomado].map(([day, valor]) => ({ day, valor }))),
    dias: new Set(dias.map((d) => d.day)).size,
  });
}

/* ─── perfil do Instagram ──────────────────────────────────────────────────── */

export type ResumoOrganico = {
  /** Somáveis: eventos. */
  views: number | null;
  totalInteractions: number | null;
  follows: number | null;
  unfollows: number | null;
  profileLinksTaps: number | null;
  /** Saldo de seguidores. `null` enquanto a Meta não separar entrada de saída. */
  saldoDeSeguidores: number | null;
  /** Pessoas distintas: média e pico. */
  alcance: PorDia;
  contasEngajadas: PorDia;
  /** Quantas das pessoas alcançadas interagiram, em média por dia. */
  taxaDeEngajamento: number | null;
  dias: number;
  /**
   * O estado do perfil hoje: quantos seguidores e quantas publicações.
   *
   * Vem do dia mais recente que TEM o dado, não do último dia do período — a
   * coleta carimba isso uma vez por passagem, e a fila leva horas para dar a
   * volta. Exigir o último dia mostraria travessão para metade da carteira.
   */
  seguidores: number | null;
  publicacoes: number | null;
};

export function resumirOrganico(dias: readonly DiaOrganico[]): ResumoOrganico {
  const alcance = porDia(dias.map((d) => ({ day: d.day, valor: d.reach })));
  const contasEngajadas = porDia(
    dias.map((d) => ({ day: d.day, valor: d.accountsEngaged })),
  );
  const follows = somar(dias.map((d) => d.follows));
  const unfollows = somar(dias.map((d) => d.unfollows));

  return {
    views: somar(dias.map((d) => d.views)),
    totalInteractions: somar(dias.map((d) => d.totalInteractions)),
    follows,
    unfollows,
    profileLinksTaps: somar(dias.map((d) => d.profileLinksTaps)),
    // Sem os dois lados, o saldo não existe. Mostrar só `follows` como "ganho"
    // seria contar entrada e esconder saída.
    saldoDeSeguidores: follows === null || unfollows === null ? null : follows - unfollows,
    alcance,
    contasEngajadas,
    // Razão entre duas MÉDIAS de pessoas distintas — as duas medidas no mesmo
    // dia, então a comparação se sustenta. Somar antes de dividir não se
    // sustentaria.
    taxaDeEngajamento: dividir(contasEngajadas.media, alcance.media),
    dias: new Set(dias.map((d) => d.day)).size,
    ...ultimoConhecido(dias),
  };
}

/**
 * O último valor CONHECIDO de seguidores e publicações.
 *
 * Percorre do dia mais recente para trás até achar. Pegar simplesmente o último
 * dia devolveria nulo quase sempre: o carimbo acontece uma vez por coleta, e a
 * fila leva horas para voltar à mesma conta.
 */
function ultimoConhecido(dias: readonly DiaOrganico[]): {
  seguidores: number | null;
  publicacoes: number | null;
} {
  let seguidores: number | null = null;
  let publicacoes: number | null = null;

  for (const d of [...dias].sort((a, b) => b.day.localeCompare(a.day))) {
    if (seguidores === null && d.followersTotal !== null) seguidores = d.followersTotal;
    if (publicacoes === null && d.mediaCount !== null) publicacoes = d.mediaCount;
    if (seguidores !== null && publicacoes !== null) break;
  }
  return { seguidores, publicacoes };
}

/* ─── as séries que os gráficos desenham ───────────────────────────────────── */

export type Ponto = { dia: string; valor: number | null };

/** Todos os dias do intervalo, inclusive nas duas pontas. */
export const TETO_DE_DIAS = 800;

export function diasDoIntervalo(de: string, ate: string): string[] {
  const dias: string[] = [];
  const fim = new Date(`${ate}T00:00:00Z`);
  for (
    let d = new Date(`${de}T00:00:00Z`);
    d.getTime() <= fim.getTime();
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    dias.push(d.toISOString().slice(0, 10));
    // Intervalo invertido devolve vazio pelo próprio laço. O teto é para
    // intervalo absurdo vindo da barra de endereço, e corta em 800 exatos —
    // cortar em 801 seria um teto que não é o número que ele diz ser.
    if (dias.length >= TETO_DE_DIAS) break;
  }
  return dias;
}

/**
 * A série de uma métrica, dia a dia, com buraco onde não há linha.
 *
 * O buraco é `null` de propósito: ver o cabeçalho. Quando o mesmo dia tem
 * várias linhas — uma por campanha —, elas se somam **se a métrica for
 * somável**. Alcance não se soma entre campanhas do mesmo dia pelo mesmo motivo
 * de sempre; aqui a soma é aceita como aproximação **apenas** para desenhar a
 * forma da curva, e por isso `serie` recusa métrica distinta e obriga quem
 * quer o alcance a passar por `serieDeDistinta`, que só existe para gráfico.
 */
export function serie<T extends { day: string }>(
  linhas: readonly T[],
  metrica: keyof T & string,
  de: string,
  ate: string,
): Ponto[] {
  if (eDistinta(metrica)) {
    throw new Error(
      `"${metrica}" conta pessoas distintas: use serieDeDistinta, que diz na tela que a curva é aproximada.`,
    );
  }
  return montar(linhas, metrica, de, ate);
}

/**
 * A curva de uma métrica de pessoas distintas.
 *
 * Existe para **forma**, não para número: o eixo mostra a subida e a descida,
 * e a tela que a usa é obrigada a dizer que o total não se soma. Nome
 * comprido de propósito — ninguém chama por engano.
 */
export function serieDeDistinta<T extends { day: string }>(
  linhas: readonly T[],
  metrica: MetricaDistinta,
  de: string,
  ate: string,
): Ponto[] {
  return montar(linhas, metrica as keyof T & string, de, ate);
}

function montar<T extends { day: string }>(
  linhas: readonly T[],
  metrica: keyof T & string,
  de: string,
  ate: string,
): Ponto[] {
  const soma = new Map<string, number>();
  for (const l of linhas) {
    const v = l[metrica];
    if (typeof v !== 'number') continue;
    soma.set(l.day, (soma.get(l.day) ?? 0) + v);
  }
  return diasDoIntervalo(de, ate).map((dia) => ({
    dia,
    valor: soma.has(dia) ? (soma.get(dia) as number) : null,
  }));
}

/* ─── comparação com o período anterior ────────────────────────────────────── */

/**
 * Variação relativa entre dois períodos.
 *
 * `null` quando não dá para comparar: sem valor anterior, ou anterior zero —
 * crescer de 0 para 10 não é "+∞%", é "não havia base".
 */
export function variacao(atual: number | null, anterior: number | null): number | null {
  if (atual === null || anterior === null || anterior === 0) return null;
  return (atual - anterior) / anterior;
}

/**
 * Para onde uma métrica quer ir.
 *
 * SUBIR NÃO É SEMPRE BOM, E PINTAR TUDO DE VERDE QUANDO SOBE É MENTIRA
 *   CPC que dobrou não é conquista: é o mesmo clique custando o dobro. CPA,
 *   CPM e CPC são CUSTO — quanto menor, melhor.
 *
 *   E gasto não é nem uma coisa nem outra. Investir mais não é bom nem ruim; é
 *   decisão. Pintar de verde faria a tela parabenizar quem estourou o
 *   orçamento, e de vermelho, quem economizou de propósito.
 *
 *   Alcance e impressões também são neutros aqui: sobem quando se investe mais,
 *   então repetir a cor do investimento seria contar a mesma coisa duas vezes
 *   fingindo que são duas.
 */
export type Sentido = 'maior_melhor' | 'menor_melhor' | 'neutro';

export const SENTIDO: Record<string, Sentido> = {
  // Custo: menor é melhor.
  cpc: 'menor_melhor',
  cpm: 'menor_melhor',
  cpa: 'menor_melhor',
  // Retorno e eficiência: maior é melhor.
  roas: 'maior_melhor',
  ctr: 'maior_melhor',
  conversions: 'maior_melhor',
  conversionValue: 'maior_melhor',
  clicks: 'maior_melhor',
  linkClicks: 'maior_melhor',
  // Volume orgânico: maior é melhor, porque não se compra.
  views: 'maior_melhor',
  totalInteractions: 'maior_melhor',
  follows: 'maior_melhor',
  profileLinksTaps: 'maior_melhor',
  // Decisão, não resultado.
  spend: 'neutro',
  impressions: 'neutro',
  reach: 'neutro',
};

export type Leitura = 'bom' | 'ruim' | 'neutro';

/**
 * Como pintar uma variação. `null` quando não há o que dizer.
 *
 * Variação minúscula não vira cor: 0,4% para cima não é melhora, é ruído, e
 * pintar de verde ensina a acreditar em oscilação.
 */
export const LIMIAR_DE_RUIDO = 0.02;

export function lerVariacao(metrica: string, variacao: number | null): Leitura | null {
  if (variacao === null) return null;
  if (Math.abs(variacao) < LIMIAR_DE_RUIDO) return 'neutro';

  const sentido = SENTIDO[metrica] ?? 'neutro';
  if (sentido === 'neutro') return 'neutro';

  const subiu = variacao > 0;
  return (sentido === 'maior_melhor') === subiu ? 'bom' : 'ruim';
}

/**
 * O período de mesmo tamanho imediatamente antes — para o "vs. anterior".
 *
 * Sete dias comparam com os sete anteriores, não com "a semana passada do
 * calendário". Quem escolheu o intervalo escolheu o tamanho da régua.
 */
export function periodoAnterior(de: string, ate: string): { de: string; ate: string } {
  const dias = diasDoIntervalo(de, ate).length;
  const recuar = (d: string, n: number) => {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() - n);
    return x.toISOString().slice(0, 10);
  };
  return { de: recuar(de, dias), ate: recuar(ate, dias) };
}
