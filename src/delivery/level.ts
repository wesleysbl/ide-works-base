/**
 * Nível de entrega — etapa F3.3.
 *
 * UMA FÓRMULA SÓ, E ELA NÃO MORA EM COLUNA NENHUMA
 *   O Sistema IDE tem duas: `clients.nivel_entrega` guarda o resultado da versão
 *   **não ponderada**, congelado no mês em que aquele cliente foi mexido pela
 *   última vez, enquanto a tela calcula a **ponderada** ao vivo. O número do
 *   card e o da coluna podem discordar, e discordam.
 *
 *   Aqui o número **nunca é gravado**. É sempre recalculado, sempre com o mês
 *   junto — e como o contrato daquele mês está congelado (F3.1), recalcular em
 *   janeiro de 2027 devolve exatamente o mesmo que hoje.
 *
 * FALHA ALTO
 *   O legado mapeia onze grafias para quatro tipos e, no que não reconhece,
 *   assume **peso 1**. Um vídeo que chegasse escrito diferente valeria o mesmo
 *   que uma arte, e ninguém perceberia: erra calado.
 *
 *   Aqui, tipo desconhecido **lança**, nomeando o valor recebido.
 *
 * O QUE NÃO É MENSURÁVEL NÃO VIRA ZERO
 *   Mês sem contrato aberto não tem 0% — tem "não dá para dizer". Mostrar zero
 *   seria indistinguível de "nada foi entregue", que é uma acusação, não uma
 *   informação.
 *
 * TRÊS MOTIVOS DIFERENTES, TRÊS FRASES DIFERENTES — F17.57
 *   Até aqui, "não tenho o que medir" tinha uma frase só: *"Este mês ainda não
 *   foi aberto para este cliente."* Ela era decidida por `contract.length === 0`
 *   — ou seja, pela **cota congelada**, não pelo mês.
 *
 *   Medido em setembro de 2026: cinco clientes tinham o mês ABERTO (linha em
 *   `month_contracts`, com `opened_at`) e nenhum item congelado. A tela dizia a
 *   eles que o mês não fora aberto, e logo abaixo mostrava o ciclo em "aberto,
 *   falta planejar" com dois botões pedindo ação. Duas afirmações opostas na
 *   mesma caixa, e a errada era a que a pessoa lia primeiro.
 *
 *   Os cinco não eram o mesmo caso, e é por isso que uma frase só não servia:
 *
 *     4 clientes  não contratam conteúdo mensal — job avulso, HUB ou interno.
 *                 Zero neles é o combinado, não falta.
 *     1 cliente   contrata (12 no cadastro) e o mês congelou vazio. Aqui zero
 *                 é um acidente do mês, e mês congelado não se reescreve.
 *
 *   Quem sabe qual é qual não é esta função: é quem a chama, que enxerga o mês
 *   e o cadastro. Por isso o contexto entra por parâmetro — e, sem ele, o
 *   comportamento continua o de antes.
 */

export const CONTENT_TYPES = ['video', 'arte', 'foto', 'ads'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

/**
 * Pesos por esforço, herdados do legado.
 *
 * Um vídeo custa três vezes uma arte; uma foto, uma vez e meia. Sem isso,
 * entregar dez artes pareceria igual a entregar dez vídeos, e o medidor
 * premiaria o caminho mais fácil.
 */
export const CONTENT_WEIGHTS: Readonly<Record<ContentType, number>> = Object.freeze({
  video: 3,
  foto: 1.5,
  arte: 1,
  ads: 1,
});

/** Versão da fórmula. Muda quando o cálculo muda, para o número ser rastreável. */
export const FORMULA_VERSION = '2026-08-19.1';

export class UnknownContentType extends Error {
  constructor(value: string) {
    super(
      `Tipo de conteúdo desconhecido: "${value}". ` +
        `Os tipos válidos são: ${CONTENT_TYPES.join(', ')}. ` +
        'O cálculo recusa em vez de assumir peso 1 — foi assim que o sistema ' +
        'antigo fazia um vídeo valer o mesmo que uma arte, sem avisar ninguém.',
    );
    this.name = 'UnknownContentType';
  }
}

export type ContractItem = { contentType: string; quantity: number };

export type DeliveredItem = {
  contentType: string;
  isExtra: boolean;
  /** Só conta quem foi entregue. Extra planejado e não feito não é bônus. */
  isCompleted: boolean;
};

export type TypeBreakdown = {
  contentType: ContentType;
  weight: number;
  contracted: number;
  delivered: number;
  extras: number;
  contractedPoints: number;
  deliveredPoints: number;
  extraPoints: number;
};

/**
 * Por que não há o que medir. Cada um pede um próximo passo diferente da
 * pessoa que lê — e é por isso que são três, e não um.
 *
 *   no_contract          o mês não foi aberto. Próximo passo: abrir.
 *   no_content_contract  o cliente não contrata conteúdo mensal. Não há passo
 *                        nenhum: é o combinado.
 *   empty_contract       o mês foi aberto e congelou sem cota. Não se
 *                        reescreve; o que entrar agora nasce extra.
 */
export type UnmeasurableReason = 'no_contract' | 'no_content_contract' | 'empty_contract';

/**
 * O que a fórmula sozinha não enxerga.
 *
 * A lista de itens congelados é a mesma nos três casos — vazia. Sem isto,
 * distingui-los seria adivinhação.
 */
export type DeliveryContext = {
  /** Existe contrato de mês para este cliente, mesmo que sem nenhum item. */
  monthOpened?: boolean;
  /** O cadastro do cliente prevê algum conteúdo por mês, hoje. */
  hasContentContract?: boolean;
};

export type DeliveryResult =
  | {
      measurable: false;
      reason: UnmeasurableReason;
      message: string;
      formulaVersion: string;
    }
  | {
      measurable: true;
      /** Base + bônus. Passa de 100 quando há extras. */
      level: number;
      /** Limitada a 100, sempre. */
      base: number;
      /** Sem teto. */
      bonus: number;
      contractedPoints: number;
      deliveredPoints: number;
      extraPoints: number;
      breakdown: TypeBreakdown[];
      /**
       * Itens entregues de um tipo que o contrato do mês não previa. Contam como
       * bônus — não foram contratados — e aparecem aqui para a tela poder
       * mostrar, em vez de somem no cálculo.
       */
      deliveredOutsideContract: number;
      formulaVersion: string;
    };

function assertType(value: string): ContentType {
  if (!(CONTENT_TYPES as readonly string[]).includes(value)) throw new UnknownContentType(value);
  return value as ContentType;
}

const FRASE: Record<UnmeasurableReason, string> = {
  no_contract: 'Este mês ainda não foi aberto para este cliente.',
  no_content_contract: 'Este cliente não tem contrato de conteúdo mensal.',
  empty_contract: 'O mês foi aberto sem cota — não há base para medir.',
};

/**
 * Qual dos três motivos vale, dado o que o chamador sabe.
 *
 * A ORDEM É O QUE MANTÉM A CAIXA COERENTE CONSIGO MESMA. Na mesma caixa da
 * tela estão um crachá de estágio, um botão e esta frase, e os três têm de
 * dizer a mesma coisa.
 *
 * O mês fechado vem primeiro por isso: com ele fechado a tela mostra `mês não
 * aberto` e o botão `Abrir o mês`, e a frase "este cliente não tem contrato de
 * conteúdo mensal" ao lado desse botão seria a MESMA discordância que esta
 * etapa veio consertar — medida assim, no `Novo Cliente (sem mes aberto)`, que
 * não tem mês nem cota.
 *
 * "Não contrata conteúdo" só entra quando o mês já está aberto: aí não há
 * botão de abrir, e ela é a única coisa que há para dizer.
 */
function porQueNaoDaParaMedir(context: DeliveryContext | undefined): UnmeasurableReason {
  if (context?.monthOpened !== true) return 'no_contract';
  if (context?.hasContentContract === false) return 'no_content_contract';
  return 'empty_contract';
}

function semBase(context: DeliveryContext | undefined): DeliveryResult {
  const reason = porQueNaoDaParaMedir(context);
  return { measurable: false, reason, message: FRASE[reason], formulaVersion: FORMULA_VERSION };
}

/**
 * Calcula o nível de entrega de um mês.
 *
 * @param contract itens do contrato **daquele mês**, já congelado
 * @param delivered itens de conteúdo do mês
 * @param context o que a lista congelada não conta: se o mês foi aberto e se o
 *   cliente contrata conteúdo. Sem ele, a recusa é a de sempre — `no_contract`.
 */
export function calculateDeliveryLevel(
  contract: ContractItem[],
  delivered: DeliveredItem[],
  context?: DeliveryContext,
): DeliveryResult {
  if (contract.length === 0) return semBase(context);

  const contracted = new Map<ContentType, number>();
  for (const item of contract) {
    const type = assertType(item.contentType);
    contracted.set(type, (contracted.get(type) ?? 0) + item.quantity);
  }

  const done = new Map<ContentType, number>();
  const extras = new Map<ContentType, number>();
  for (const item of delivered) {
    const type = assertType(item.contentType);
    if (!item.isCompleted) continue; // planejado não é entregue

    // Item de tipo que o contrato não previa é, por definição, além do
    // contratado — mesmo sem estar marcado como extra.
    const beyondContract = item.isExtra || !contracted.has(type);
    const alvo = beyondContract ? extras : done;
    alvo.set(type, (alvo.get(type) ?? 0) + 1);
  }

  const breakdown: TypeBreakdown[] = [];
  let contractedPoints = 0;
  let deliveredPoints = 0;
  let extraPoints = 0;

  const todosOsTipos = new Set<ContentType>([
    ...contracted.keys(),
    ...done.keys(),
    ...extras.keys(),
  ]);

  for (const type of CONTENT_TYPES) {
    if (!todosOsTipos.has(type)) continue;

    const weight = CONTENT_WEIGHTS[type];
    const c = contracted.get(type) ?? 0;
    const d = done.get(type) ?? 0;
    const e = extras.get(type) ?? 0;

    contractedPoints += c * weight;
    deliveredPoints += d * weight;
    extraPoints += e * weight;

    breakdown.push({
      contentType: type,
      weight,
      contracted: c,
      delivered: d,
      extras: e,
      contractedPoints: c * weight,
      deliveredPoints: d * weight,
      extraPoints: e * weight,
    });
  }

  if (contractedPoints === 0) {
    // Contrato aberto mas com todas as cotas em zero. Dividir por isso daria
    // infinito; mostrar 0% diria "não entregou nada", que é diferente de "não
    // havia nada a entregar".
    //
    // Há linha congelada, então o mês foi aberto — mesmo que o chamador não
    // tenha dito. `empty_contract` é o piso aqui, nunca `no_contract`.
    return semBase({ monthOpened: true, hasContentContract: context?.hasContentContract });
  }

  const base = Math.min(100, Math.round((deliveredPoints / contractedPoints) * 100));
  const bonus = Math.round((extraPoints / contractedPoints) * 100);

  return {
    measurable: true,
    level: base + bonus,
    base,
    bonus,
    contractedPoints,
    deliveredPoints,
    extraPoints,
    breakdown,
    deliveredOutsideContract: [...extras.entries()]
      .filter(([type]) => !contracted.has(type))
      .reduce((soma, [, n]) => soma + n, 0),
    formulaVersion: FORMULA_VERSION,
  };
}
