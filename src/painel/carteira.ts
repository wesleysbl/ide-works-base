/**
 * A carteira vista pelo cockpit — etapa F4.4.
 *
 * POR QUE ISTO NÃO ESTÁ DENTRO DA TELA
 *   Os sete cartões de número do topo, a ordenação e os filtros são **regra**,
 *   não desenho. Regra dentro de componente só é testável abrindo navegador.
 *
 * POR QUE O RESUMO É DERIVADO, E NUNCA CONSULTADO
 *   "Total de vídeos: 49/140" e a lista de clientes logo abaixo respondem à
 *   mesma pergunta. Se o total viesse de um agregado do banco e a lista de
 *   outra consulta, os dois poderiam divergir — e é exatamente isso que
 *   acontece no legado, onde `weekly_progress` guarda contagens que deveriam
 *   bater com `weekly_content_items` e não batem (88 divergências medidas).
 *
 *   Aqui o total é a soma do que está na tela. Não há o que divergir, porque
 *   não há segunda fonte.
 *
 * O RESUMO SEGUE O FILTRO, DE PROPÓSITO
 *   Filtrar por "IDE HUB" e continuar vendo o total dos 91 clientes seria um
 *   número que não descreve nada do que está à vista. O cabeçalho fala sempre
 *   sobre a lista visível.
 */

import { CONTENT_TYPES, type ContentType, type DeliveryResult, type UnmeasurableReason } from '@/delivery/level';
import type { DeliveryStatus } from '@/delivery/ultima-entrega';
import { hojeNaAgencia } from '@/ui/grade-do-mes';

export type Plano = {
  id: string;
  name: string;
  colorBg: string;
  colorText: string;
  colorBorder: string;
};

export type Etiqueta = { id: string; name: string; color: string };

export type Urgencia = 'paz' | 'alerta' | 'perigo';

export type ClienteDoPainel = {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  /**
   * A ordem escolhida na tela de catálogos. Nenhuma tela do painel a lê desde
   * a F31 (as abas de unidade, que a usavam, saíram); ela continua chegando
   * porque é a resposta do servidor, e o servidor não muda nesta etapa.
   */
  categorySortOrder: number;
  plan: Plano | null;
  urgency: Urgencia;
  isActive: boolean;
  inactiveAt: string | null;
  financeOk: boolean;
  startedOn: string;
  renewsOn: string | null;
  tags: Etiqueta[];
  /** Produção **datada** dentro do intervalo escolhido. Ver `server/panel.ts`. */
  inPeriod: { scheduled: number; completed: number };
  delivery: DeliveryResult;
  /**
   * F38 — situação de entrega pela Semanal (última entrega, vencidas, vence
   * hoje, sem dia, próxima). Nula para cliente inativo. Ver `server/panel.ts`.
   */
  deliveryStatus: DeliveryStatus | null;
};

/* ─────────────────────────── resumo ─────────────────────────── */

export type ResumoDeTipo = { contracted: number; delivered: number; extras: number };

export type Resumo = {
  total: number;
  urgencia: Record<Urgencia, number>;
  /** Média só entre quem tem contrato aberto. Quem não tem não é zero. */
  nivelMedio: number | null;
  /** Quantos entraram na média — a tela precisa dizer quando ela é parcial. */
  mensuraveis: number;
  porTipo: Record<ContentType, ResumoDeTipo>;
  financeiroPendente: number;
};

export function resumirCarteira(clientes: readonly ClienteDoPainel[]): Resumo {
  const porTipo = Object.fromEntries(
    CONTENT_TYPES.map((t) => [t, { contracted: 0, delivered: 0, extras: 0 }]),
  ) as Record<ContentType, ResumoDeTipo>;

  const urgencia: Record<Urgencia, number> = { paz: 0, alerta: 0, perigo: 0 };
  let somaDeNiveis = 0;
  let mensuraveis = 0;
  let financeiroPendente = 0;

  for (const c of clientes) {
    urgencia[c.urgency] += 1;
    if (!c.financeOk) financeiroPendente += 1;

    if (!c.delivery.measurable) continue;
    mensuraveis += 1;
    somaDeNiveis += c.delivery.level;

    for (const linha of c.delivery.breakdown) {
      const alvo = porTipo[linha.contentType];
      alvo.contracted += linha.contracted;
      alvo.delivered += linha.delivered;
      alvo.extras += linha.extras;
    }
  }

  return {
    total: clientes.length,
    urgencia,
    nivelMedio: mensuraveis === 0 ? null : Math.round(somaDeNiveis / mensuraveis),
    mensuraveis,
    porTipo,
    financeiroPendente,
  };
}

/* ─────────────────────────── ordenação ─────────────────────────── */

export const ORDENS = {
  entrega: 'Entrega',
  /** F38 — pela Semanal: crescente = há mais tempo sem entregar no topo. */
  ultimaEntrega: 'Última entrega',
  nome: 'Nome',
  renovacao: 'Renovação',
  urgencia: 'Urgência',
} as const;

export type Ordem = keyof typeof ORDENS;

const PESO_DA_URGENCIA: Record<Urgencia, number> = { perigo: 0, alerta: 1, paz: 2 };

/**
 * Ordena sem alterar a lista recebida.
 *
 * QUEM NÃO TEM CONTRATO VAI PARA O FIM, SEMPRE
 *   Em qualquer sentido. Tratar "não mensurável" como zero jogaria o cliente
 *   sem mês aberto para o topo da lista dos piores — uma acusação nascida de
 *   um `null`. Ele fica no fim tanto na crescente quanto na decrescente, e é
 *   o desempate final em todos os critérios.
 *
 *   "Última entrega" (F38) segue a mesma regra: quem nunca entregou — ou o
 *   cancelado, que não tem situação — não é "o mais atrasado de todos", é
 *   quem não tem data. Fica no fim nos dois sentidos. Na crescente, a data
 *   mais antiga vem primeiro: quem está há mais tempo sem entregar.
 */
export function ordenarCarteira(
  clientes: readonly ClienteDoPainel[],
  ordem: Ordem,
  crescente: boolean,
): ClienteDoPainel[] {
  const sinal = crescente ? 1 : -1;

  const chave = (c: ClienteDoPainel): number | null => {
    switch (ordem) {
      case 'entrega':
        return c.delivery.measurable ? c.delivery.level : null;
      case 'urgencia':
        return PESO_DA_URGENCIA[c.urgency];
      case 'renovacao':
        return c.renewsOn === null ? null : new Date(`${c.renewsOn}T00:00:00Z`).getTime();
      case 'ultimaEntrega': {
        const dia = c.deliveryStatus?.lastDeliveryOn ?? null;
        return dia === null ? null : new Date(`${dia}T00:00:00Z`).getTime();
      }
      case 'nome':
        return null;
    }
  };

  return [...clientes].sort((a, b) => {
    if (ordem !== 'nome') {
      const ka = chave(a);
      const kb = chave(b);
      // Sem valor cai para o fim independentemente do sentido escolhido.
      if (ka === null && kb === null) return a.name.localeCompare(b.name, 'pt-BR');
      if (ka === null) return 1;
      if (kb === null) return -1;
      if (ka !== kb) return (ka - kb) * sinal;
    }
    return a.name.localeCompare(b.name, 'pt-BR') * (ordem === 'nome' ? sinal : 1);
  });
}

/* ─────────────────────────── filtro ─────────────────────────── */

/**
 * O recorte da carteira na tela.
 *
 * ⚠️ SEM UNIDADE — F31. `categoriaId` morava aqui desde as abas do topo e o
 * Painel já o zerava desde `90cab18`; saiu de vez quando o sistema passou a
 * ser "apenas Ide" (Wesley, 25/09). A unidade continua decidindo QUEM VÊ o
 * cliente, no servidor; ela só deixou de ser recorte de tela.
 */
export type Filtro = {
  busca: string;
  planoIds: readonly string[];
  etiquetaIds: readonly string[];
  urgencias: readonly Urgencia[];
  /** `null` = tanto faz; a tela usa para separar ativos de arquivo. */
  ativo: boolean | null;
  soFinanceiroPendente: boolean;
};

export const FILTRO_VAZIO: Filtro = {
  busca: '',
  planoIds: [],
  etiquetaIds: [],
  urgencias: [],
  ativo: true,
  soFinanceiroPendente: false,
};

/** Um filtro vazio não filtra. Cada lista preenchida é um "qualquer um destes". */
export function filtrarCarteira(
  clientes: readonly ClienteDoPainel[],
  f: Filtro,
): ClienteDoPainel[] {
  const busca = f.busca.trim().toLowerCase();

  return clientes.filter((c) => {
    if (f.ativo !== null && c.isActive !== f.ativo) return false;
    if (f.soFinanceiroPendente && c.financeOk) return false;
    if (f.urgencias.length > 0 && !f.urgencias.includes(c.urgency)) return false;

    if (f.planoIds.length > 0) {
      // Sem plano nunca casa com um filtro de plano — inclusive porque não há
      // como o usuário pedir "os sem plano" marcando um selo que não existe.
      if (c.plan === null || !f.planoIds.includes(c.plan.id)) return false;
    }

    if (f.etiquetaIds.length > 0) {
      if (!c.tags.some((t) => f.etiquetaIds.includes(t.id))) return false;
    }

    if (busca !== '') {
      // SEM O NOME DA UNIDADE — F31. Com ele, buscar "ide" casava a carteira
      // inteira (todo cliente é da Ide ou da Ide Hub), e a busca parecia não
      // filtrar nada. Nome, plano e etiqueta são o que se procura.
      const alcance = [c.name, c.plan?.name ?? '', ...c.tags.map((t) => t.name)]
        .join(' ')
        .toLowerCase();
      if (!alcance.includes(busca)) return false;
    }

    return true;
  });
}

export const filtroEstaLimpo = (f: Filtro) =>
  f.busca.trim() === '' &&
  f.planoIds.length === 0 &&
  f.etiquetaIds.length === 0 &&
  f.urgencias.length === 0 &&
  !f.soFinanceiroPendente;

/* ─────────────────────────── renovação ─────────────────────────── */

/**
 * Dias até a renovação. Negativo = já venceu.
 *
 * Compara DIA com DIA, nunca o instante: às 23h, uma conta baseada em `now`
 * diria "faltam 0 dias" para algo que vence amanhã. Contrato vence no dia, não
 * na hora. E o "hoje" é o de São Paulo, o mesmo do calendário e do quadro: pelo
 * dia UTC, a partir das 21h de Brasília o contrato que renova amanhã já dizia
 * "renova hoje", e o de hoje dizia "venceu ontem".
 */
export function diasAteRenovar(renewsOn: string | null, hoje = new Date()): number | null {
  if (renewsOn === null) return null;
  const alvo = Date.UTC(
    Number(renewsOn.slice(0, 4)),
    Number(renewsOn.slice(5, 7)) - 1,
    Number(renewsOn.slice(8, 10)),
  );
  const dia = hojeNaAgencia(hoje);
  const base = Date.UTC(Number(dia.slice(0, 4)), Number(dia.slice(5, 7)) - 1, Number(dia.slice(8, 10)));
  return Math.round((alvo - base) / 86_400_000);
}

/** Os contratos que pedem atenção: vencidos primeiro, depois os mais próximos. */
export function proximasRenovacoes(
  clientes: readonly ClienteDoPainel[],
  janelaEmDias = 45,
  hoje = new Date(),
): Array<{ cliente: ClienteDoPainel; dias: number }> {
  return clientes
    .filter((c) => c.isActive && c.renewsOn !== null)
    .map((c) => ({ cliente: c, dias: diasAteRenovar(c.renewsOn, hoje) as number }))
    .filter((r) => r.dias <= janelaEmDias)
    .sort((a, b) => a.dias - b.dias);
}

/* ─────────────────────── atalhos do resumo — F11A ─────────────────────── */

/**
 * Quantos clientes cada ATALHO do resumo mostraria — F11A do plano UX.
 *
 * O resumo do topo virou botão: "Crítico 3" aplica o mesmo filtro que marcar
 * Crítico na gaveta Urgência. O número do botão tem de ser o número de
 * clientes que o clique vai deixar na carteira. Por isso cada contagem sai da
 * carteira filtrada por TUDO MENOS a própria dimensão: com "Crítico" ligado,
 * "Atenção" continua dizendo quantos ela acrescentaria, e não zero.
 *
 * Não é um cálculo novo de negócio — é `filtrarCarteira` + `resumirCarteira`,
 * as mesmas funções da lista, sobre outro recorte.
 */
export function contarAtalhos(
  clientes: readonly ClienteDoPainel[],
  f: Filtro,
): { urgencia: Record<Urgencia, number>; financeiroPendente: number } {
  return {
    urgencia: resumirCarteira(filtrarCarteira(clientes, { ...f, urgencias: [] })).urgencia,
    financeiroPendente: resumirCarteira(filtrarCarteira(clientes, { ...f, soFinanceiroPendente: false }))
      .financeiroPendente,
  };
}

/* ─────────────────────── situação do cartão — F11A ─────────────────────── */

export type Situacao = {
  chave: 'financeiro' | 'renovacao' | 'vencidas' | 'venceHoje';
  tom: 'err' | 'warn' | 'neutro';
  texto: string;
};

/**
 * O que se pode VERIFICAR no cliente e pede ação — F11A.
 *
 * Só fatos que a resposta traz: contrato vencido, peças da Semanal vencidas
 * sem ✓ e que vencem hoje (F38), financeiro marcado como pendente e contrato
 * que vence em até 30 dias. Não há "atrasado por entrega baixa" nem
 * "aprovação pendente": o primeiro seria uma acusação nascida de uma
 * porcentagem, e o segundo não tem campo na resposta. Mais grave primeiro.
 *
 * AS PEÇAS VENCIDAS SÃO FATO, NÃO PORCENTAGEM — F38
 *   "2 peças vencidas sem ✓" se confere abrindo a Semanal: são duas peças com
 *   dia marcado no passado e sem a marca de concluída. A regra é a única
 *   (`deliveryStatusOf`); o cartão só conta o que ela devolveu. Peça que
 *   vence hoje ainda não é atraso, e por isso tem tom de alerta, não de erro.
 *   Cliente cancelado não tem situação de entrega (nula), e nada entra.
 *
 * ⚠️ "SEM MÊS ABERTO" SAIU DAQUI — F11A2 (revisão de 28/09, R01). Esta lista
 * dizia "Sem mês aberto" para TODO cliente sem medida, e logo abaixo o mesmo
 * cartão lia "O mês foi aberto sem cota". Não medir tem três motivos, e dois
 * deles não pedem ação nenhuma. O motivo é o estado da ENTREGA, e mora no
 * lugar dela no cartão — ver `motivoSemMedida`.
 */
export function situacoesDoCliente(c: ClienteDoPainel, hoje = new Date()): Situacao[] {
  const saida: Situacao[] = [];
  const dias = diasAteRenovar(c.renewsOn, hoje);
  if (dias !== null && dias < 0) {
    saida.push({ chave: 'renovacao', tom: 'err', texto: `Contrato vencido há ${Math.abs(dias)}d` });
  }
  const vencidas = c.deliveryStatus?.overdue.length ?? 0;
  if (vencidas > 0) {
    saida.push({
      chave: 'vencidas',
      tom: 'err',
      texto: vencidas === 1 ? '1 peça vencida sem ✓' : `${vencidas} peças vencidas sem ✓`,
    });
  }
  const venceHoje = c.deliveryStatus?.dueToday ?? 0;
  if (venceHoje > 0) {
    saida.push({
      chave: 'venceHoje',
      tom: 'warn',
      texto: venceHoje === 1 ? '1 peça vence hoje' : `${venceHoje} peças vencem hoje`,
    });
  }
  if (!c.financeOk) saida.push({ chave: 'financeiro', tom: 'warn', texto: 'Financeiro pendente' });
  if (dias !== null && dias >= 0 && dias <= 30) {
    saida.push({
      chave: 'renovacao',
      tom: 'warn',
      texto: dias === 0 ? 'Renovação vence hoje' : `Renovação em ${dias}d`,
    });
  }
  return saida;
}

/* ─────────────────────── última entrega — F38 ─────────────────────── */

/**
 * "05/10 · há 1 dia" — a linha "Última entrega" do cartão, sem o rótulo.
 *
 * A data e os dias vêm prontos do servidor (`deliveryStatusOf`): a tela não
 * recalcula "hoje", para o cartão e a IA não discordarem na virada do dia.
 * O ano só aparece quando não é o de hoje — "27/01" de outro ano enganaria.
 * `null` = sem entrega registrada (o cartão diz isso com todas as letras).
 */
export function textoDaUltimaEntrega(s: DeliveryStatus): string | null {
  if (s.lastDeliveryOn === null) return null;
  const dia = s.lastDeliveryOn;
  const data =
    dia.slice(0, 4) === s.today.slice(0, 4)
      ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}`
      : `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
  const n = s.daysSinceLastDelivery ?? 0;
  const ha = n <= 0 ? 'hoje' : n === 1 ? 'há 1 dia' : `há ${n} dias`;
  return `${data} · ${ha}`;
}

/* ─────────────────────── por que não mede — F11A2 ─────────────────────── */

/**
 * O nome curto de cada motivo de não medir — F11A2 (revisão de 28/09, R01).
 *
 * O motivo JÁ vem na resposta (`delivery.reason`, `delivery/level.ts`); a tela
 * só o nomeia. Antes o cartão dizia "sem mês" a todos, inclusive a quem tinha
 * o mês aberto sem cota e a quem nem contrata conteúdo mensal. O cálculo não
 * muda: é o mesmo `DeliveryResult`, lido pelo motivo em vez de só pelo
 * `measurable`.
 */
export const ROTULO_DO_MOTIVO = {
  no_contract: 'Mês não aberto',
  empty_contract: 'Sem cota para medir',
  no_content_contract: 'Sem contrato mensal',
} as const satisfies Record<UnmeasurableReason, string>;

export type MotivoSemMedida = {
  motivo: UnmeasurableReason;
  /** O nome curto — o que o cartão escreve no lugar da porcentagem. */
  rotulo: string;
  /** A frase do servidor, que explica o motivo. */
  texto: string;
};

/**
 * Por que este cliente não tem medida, ou `null` se tem.
 *
 * Motivo que a tela não conhece (servidor mais novo que a aba aberta) não vira
 * "mês não aberto" por eliminação: fica "Sem medida", e a frase do servidor diz
 * o resto.
 */
export function motivoSemMedida(d: DeliveryResult): MotivoSemMedida | null {
  if (d.measurable) return null;
  const rotulo = (ROTULO_DO_MOTIVO as Record<string, string>)[d.reason] ?? 'Sem medida';
  return { motivo: d.reason, rotulo, texto: d.message };
}
