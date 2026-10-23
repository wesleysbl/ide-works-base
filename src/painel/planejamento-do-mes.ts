/**
 * O mês do cliente — F43, Fase 1 (a regra, sem tela).
 *
 * O QUE ELA RESPONDE
 *   "O que este cliente tem de contrato, e está acontecendo?" — o pedido mais
 *   importante do Wesley em 08/10/2026: "tem gente do planejamento que esquece
 *   de atender o cliente porque não viu". Por cliente e por tipo: o contrato do
 *   mês, o entregue, o marcado, o atrasado, o sem dia e a meta desta semana; e a
 *   lista de quem precisa de atenção, com o porquê numa frase pronta.
 *
 * DUAS LEITURAS, UMA LINHA
 *   O ritual (`GET /planning`: mês aberto, planejado, aprovado) e as semanas
 *   (`GET /planning/weeks`: responsáveis, contrato, peças) recortam os MESMOS
 *   clientes — ativos, visíveis pela política, fora das omitidas —, mas são duas
 *   chamadas: um cliente criado ou desativado entre uma e outra chega só numa.
 *   Ele aparece com o que se sabe (`leitura` diz o que faltou) e não derruba a
 *   tela.
 *
 * NENHUMA CONTA NOVA DE SEMANA
 *   Meta, sinal e estado de cada semana são os de `planejarSemanas` (F35); o dia
 *   e o "atrasada" da peça são `sinalDaPeca`; "esta semana" é `semanaDeHoje`;
 *   "dentro do mês" é `semanaDaData`. Esta regra só reparte e escreve — uma
 *   segunda cópia ficaria para trás na primeira mudança, como a do ritual na
 *   aba Mês ficou.
 */

import { MESES } from '@/board/calendario';
import type { ContentType } from '@/delivery/level';
import { RITUAL_LABEL, type RitualState, ritualStage } from '@/delivery/month-ritual';
import { type Semana, semanaDaData } from '@/delivery/semanas';
import type { EstagioDoRitual } from '@/painel/planejamento';
import {
  type EstadoDaSemana,
  type GrupoPorResponsavel,
  type LinhaDoTipo,
  type PecaDoPlanejamento,
  type PlanejamentoDoCliente,
  agruparPorResponsavel,
  diaDaPeca,
  diasUteis,
  planejarSemanas,
  semanaDeHoje,
  sinalDaPeca,
} from '@/painel/planejamento-semanal';
import type { PlanningRow } from '@/server/planning';
import type { PlanningWeeksRow } from '@/server/planning-weeks';
import { TIPO_ROTULO } from '@/ui/grade-do-mes';

/* ───────────────────────────── a junção ───────────────────────────── */

/**
 * De onde veio o que se sabe do cliente.
 *
 *   completa    as duas leituras o trouxeram.
 *   so-ritual   só o ritual: sem responsáveis, sem contrato, sem peças.
 *   so-semanas  só as semanas: o mês aberto é deduzido; planejado e aprovado
 *               ficam desconhecidos (vêm `null`).
 */
export type LeituraDoCliente = 'completa' | 'so-ritual' | 'so-semanas';

/**
 * O cliente com as duas leituras juntas. Tem a forma de `PlanningWeeksRow`
 * (a grade da F35 e `agruparPorResponsavel` o aceitam) e a de `RitualState`
 * (`proximoPasso`, `ofereceAprovacao` e `travaDoPlanejamento` também).
 */
export type ClienteDoMes = PlanningWeeksRow & RitualState & { leitura: LeituraDoCliente };

/**
 * Junta o ritual e as semanas pelo id do cliente, em ordem de nome (pt-BR).
 *
 * CLIENTE SÓ NAS SEMANAS
 *   "Mês aberto" é deduzido de `quotaSource === 'contrato'`. Não é palpite: é a
 *   MESMA regra do servidor (`resolvePlanningQuota` só devolve `contrato` quando
 *   existe a linha do contrato do mês, que é o que `readPlanning` chama de
 *   aberto). Planejado e aprovado não têm de onde sair e vêm `null` — por isso
 *   o estágio pode dizer "falta planejar" de um mês já planejado; a tela lê
 *   `leitura` antes de oferecer as chaves.
 *
 * CLIENTE SÓ NO RITUAL
 *   Sem a leitura das peças não há contrato, responsável nem peça para contar.
 *   `hasContentContract` vem falso de propósito: sem prova de contrato, a regra
 *   não acusa ninguém (ele não entra na atenção). `quotaSource` segue o mês
 *   aberto (`contrato` ⇔ aberto, a invariante que o resto do app lê), com cota
 *   vazia.
 *
 * NAS DUAS, O RITUAL MANDA NO RITUAL
 *   Se o mês foi aberto entre as duas chamadas, `monthOpened` é o do ritual —
 *   é a leitura dona desse fato.
 *
 * A ordem é refeita pelo nome em pt-BR, e não herdada do servidor: a união das
 * duas listas precisa de uma ordem só, e é a mesma de `ordenarPorRitual`.
 */
export function juntarLeituras(
  ritual: readonly PlanningRow[],
  semanas: readonly PlanningWeeksRow[],
): ClienteDoMes[] {
  const doRitual = new Map(ritual.map((r) => [r.id, r]));
  const dasSemanas = new Map(semanas.map((s) => [s.id, s]));
  const ids = new Set([...dasSemanas.keys(), ...doRitual.keys()]);

  const clientes: ClienteDoMes[] = [];
  for (const id of ids) {
    const r = doRitual.get(id);
    const s = dasSemanas.get(id);
    if (s && r) {
      clientes.push({
        ...s,
        monthOpened: r.monthOpened,
        planningDoneAt: r.planningDoneAt,
        clientApprovedAt: r.clientApprovedAt,
        leitura: 'completa',
      });
    } else if (s) {
      clientes.push({
        ...s,
        monthOpened: s.quotaSource === 'contrato',
        planningDoneAt: null,
        clientApprovedAt: null,
        leitura: 'so-semanas',
      });
    } else if (r) {
      clientes.push({
        ...r,
        owners: [],
        quotaSource: r.monthOpened ? 'contrato' : 'nenhuma',
        quota: {},
        hasContentContract: false,
        items: [],
        leitura: 'so-ritual',
      });
    }
  }
  return clientes.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id));
}

/* ─────────────────────────── o contrato por tipo ─────────────────────────── */

/**
 * A semana de hoje de um tipo — a célula da F35, sem recontar. Por isso
 * `feitas` e `marcadas` incluem a extra: na semana a extra conta no ritmo
 * (decisão da F35, "extra aparece e conta em feito, mas não altera a meta").
 */
export type SemanaDoTipo = {
  meta: number;
  /** ✓ agendadas nesta semana. */
  feitas: number;
  /** ● pendentes com dia nesta semana, de hoje em diante. */
  marcadas: number;
  /** ✕ pendentes com dia nesta semana que já passou. */
  atrasadas: number;
  estado: EstadoDaSemana;
};

/**
 * Um tipo do contrato do mês.
 *
 * O CONTRATO SE PARTE EM SEIS, E A SOMA FECHA
 *   As peças DO CONTRATO (as que não são extra) caem em exatamente um balde:
 *
 *     contrato = entregues + marcadas + atrasadas + foraDoMes + semDia + naoCriadas
 *
 *   Fecha sempre que as peças do contrato não passam do contrato — e é o
 *   servidor que garante isso ao criar sem dizer se é extra (F17.44: "extra
 *   quando a base daquele tipo já está cheia"). Se um dia passar, `naoCriadas`
 *   para em zero e nada fica negativo.
 *
 *   É a pergunta de quem planeja: dos N do contrato, quantos saíram, quantos
 *   têm dia, quantos existem sem dia e quantos nem existem. `faltaMarcar` junta
 *   os dois últimos — é o trabalho de marcar que sobra.
 *
 * O QUE É EXTRA
 *   A regra de `calculateDeliveryLevel`: a peça marcada como extra, ou qualquer
 *   peça de tipo que o contrato do mês não prevê. Extra não paga contrato: ela
 *   fica fora dos seis baldes. `extras` conta só as entregues — o mesmo número
 *   que o medidor de entrega chama de extra ("extra planejado e não feito não é
 *   bônus"). As que faltam sair ficam em `extrasPendentes`, para não sumirem.
 */
export type ContratoDoTipo = {
  tipo: ContentType;
  /** Do contrato congelado, ou do cadastro se o mês não abriu. 0 = o tipo só aparece porque tem peça. */
  contrato: number;
  /** Peças do contrato concluídas (com dia ou sem). */
  entregues: number;
  /** Peças do contrato pendentes, com dia dentro do mês, de hoje em diante. */
  marcadas: number;
  /** Peças do contrato pendentes cujo dia já passou — dentro do mês ou fora: vencida é vencida. */
  atrasadas: number;
  /** Peças do contrato pendentes com dia fora do mês, ainda não vencido (as semanas do mês não as mostram). */
  foraDoMes: number;
  /** Peças do contrato que existem e não têm dia. */
  semDia: number;
  /** O que o contrato pede e nem existe como peça ainda. */
  naoCriadas: number;
  /** Do contrato, quantas ainda não têm dia: `semDia + naoCriadas`. */
  faltaMarcar: number;
  /** Extras entregues. */
  extras: number;
  /** Extras que ainda não saíram, com dia ou sem. */
  extrasPendentes: number;
  /** Das pendentes, as que já passaram do dia. Entram no motivo "atrasadas": o cliente espera a extra também. */
  extrasAtrasadas: number;
  /** `null` quando hoje não é deste mês — "esta semana" não se aplica. */
  semana: SemanaDoTipo | null;
};

function contarTipo(
  linha: LinhaDoTipo,
  pecas: readonly PecaDoPlanejamento[],
  mes: string,
  hoje: string,
  semanaAtual: number | null,
): ContratoDoTipo {
  const contrato = linha.cota;
  const c = {
    entregues: 0,
    marcadas: 0,
    atrasadas: 0,
    foraDoMes: 0,
    semDia: 0,
    extras: 0,
    extrasPendentes: 0,
    extrasAtrasadas: 0,
  };

  for (const p of pecas) {
    const sinal = sinalDaPeca(p, hoje);
    if (p.isExtra || contrato === 0) {
      if (sinal === 'feita') c.extras += 1;
      else {
        c.extrasPendentes += 1;
        if (sinal === 'atrasada') c.extrasAtrasadas += 1;
      }
      continue;
    }
    if (sinal === 'feita') c.entregues += 1;
    else if (sinal === null) c.semDia += 1;
    else if (sinal === 'atrasada') c.atrasadas += 1;
    // Agendada no prazo: o sinal só existe com dia, então `scheduledAt` está lá.
    else if (semanaDaData(mes, diaDaPeca(p) as string) === null) c.foraDoMes += 1;
    else c.marcadas += 1;
  }

  const comDia = c.marcadas + c.atrasadas + c.foraDoMes;
  const celula = semanaAtual === null ? undefined : linha.celulas[semanaAtual - 1];
  return {
    tipo: linha.tipo,
    contrato,
    ...c,
    naoCriadas: Math.max(0, contrato - (c.entregues + comDia + c.semDia)),
    faltaMarcar: Math.max(0, contrato - c.entregues - comDia),
    semana: celula
      ? {
          meta: celula.meta,
          feitas: celula.feito,
          marcadas: celula.sinais.filter((s) => s.sinal === 'agendada').length,
          atrasadas: celula.sinais.filter((s) => s.sinal === 'atrasada').length,
          estado: celula.estado,
        }
      : null,
  };
}

/**
 * O contrato do mês de um cliente, tipo a tipo — na ordem e com os tipos de
 * `planejarSemanas` (os com contrato, e depois os de contrato 0 que têm peça;
 * tipo desconhecido é ignorado lá e aqui).
 */
export function contratoDoCliente(
  cliente: Pick<ClienteDoMes, 'quota' | 'items'>,
  mes: string,
  hoje: string,
): { planejamento: PlanejamentoDoCliente; semanaAtual: Semana | null; tipos: ContratoDoTipo[] } {
  const planejamento = planejarSemanas({ mes, cota: cliente.quota, pecas: cliente.items, hoje });
  const n = semanaDeHoje(planejamento, hoje);
  return {
    planejamento,
    semanaAtual: n === null ? null : planejamento.semanas[n - 1],
    tipos: planejamento.tipos.map((linha) =>
      contarTipo(
        linha,
        cliente.items.filter((p) => p.contentType === linha.tipo),
        mes,
        hoje,
        n,
      ),
    ),
  };
}

/* ─────────────────────────── os motivos de atenção ─────────────────────────── */

export type ChaveDoMotivo =
  | 'mes-nao-aberto'
  | 'semana-sem-peca'
  | 'atrasadas'
  | 'semana-em-risco'
  | 'semana-anterior-abaixo'
  | 'sem-dia';

export type MotivoDeAtencao = {
  chave: ChaveDoMotivo;
  /** A frase pronta, em português, que a faixa mostra como está. */
  texto: string;
  peso: number;
};

/**
 * O peso de cada motivo — quem aparece primeiro na faixa.
 *
 * A ORDEM É A DO ESQUECIMENTO
 *   Mês não aberto é o cliente esquecido na raiz: sem ele o contrato não
 *   congelou e nada do mês anda. Logo depois, o pedido literal do Wesley: a
 *   semana sem nada marcado ("esquece de atender o cliente porque não viu").
 *   Atrasada é entrega que já falhou; semana em risco ainda dá para salvar;
 *   semana passada abaixo já passou; peças sem dia são trabalho de marcar que
 *   ainda tem o mês pela frente.
 */
export const PESO_DO_MOTIVO: Readonly<Record<ChaveDoMotivo, number>> = Object.freeze({
  'mes-nao-aberto': 60,
  'semana-sem-peca': 50,
  atrasadas: 40,
  'semana-em-risco': 30,
  'semana-anterior-abaixo': 20,
  'sem-dia': 10,
});

/**
 * A partir de quantas peças do contrato sem dia o cliente pede atenção — antes
 * da última semana do mês. Na última, qualquer peça sem dia pede (ver
 * `motivosDeAtencao`).
 */
export const LIMITE_SEM_DIA = 3;

export type OpcoesDaAtencao = {
  /** Padrão `LIMITE_SEM_DIA`. */
  limiteSemDia?: number;
};

/** O mês exibido em relação a hoje. Só no `atual` existe "esta semana". */
export type QuandoDoMes = 'passado' | 'atual' | 'futuro';

/** Um cliente no mês: as duas leituras, o contrato por tipo e os motivos. */
export type LinhaDoMes = ClienteDoMes & {
  /** `YYYY-MM` — o mês de que estes números são (a regra da F35 contra o mês errado na tela). */
  mes: string;
  /** `YYYY-MM-DD` em que os números foram contados. */
  hoje: string;
  quando: QuandoDoMes;
  estagio: EstagioDoRitual;
  /** `RITUAL_LABEL` do estágio: "mês não aberto", "aberto, falta planejar"… */
  rotuloDoEstagio: string;
  /**
   * Compra conteúdo neste mês: o cadastro de hoje tem cota, OU o contrato do
   * mês congelou com cota (mês congelado não se reescreve — F17.57 —, então o
   * contrato de outubro vale mesmo que o cadastro tenha zerado depois).
   * Falso = "sem contrato": nunca entra na atenção.
   */
  temContrato: boolean;
  /** O de `planejarSemanas`, inteiro — a grade semanal e `agruparPorResponsavel` o leem. */
  planejamento: PlanejamentoDoCliente;
  /** A semana (F35) que contém hoje; `null` fora do mês atual. */
  semanaAtual: Semana | null;
  tipos: ContratoDoTipo[];
  /** Do mais pesado ao mais leve. Vazio para quem não tem contrato. */
  motivos: MotivoDeAtencao[];
  /** O peso do motivo mais pesado; 0 sem motivo. */
  peso: number;
};

type LinhaSemMotivos = Omit<LinhaDoMes, 'motivos' | 'peso'>;

const soma = <T>(xs: readonly T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);

/**
 * Por que este cliente precisa de atenção — cada motivo com a frase pronta.
 *
 * QUEM NÃO REPETE QUEM (a precedência)
 *   1. Sem contrato → nenhum motivo. Zero ali é o combinado, não falta.
 *   2. Mês não aberto (só de quem tem contrato de conteúdo no cadastro) cala os
 *      motivos de semana e o "sem dia": sem o mês aberto o contrato não
 *      congelou e as peças nem nasceram — o passo é abrir, e dizer "nada
 *      marcado" ao lado seria a mesma falta contada de novo. "Atrasadas" fica:
 *      peça vencida é fato à parte, não consequência.
 *   3. Semana sem nada marcado cala "semana em risco": é o mesmo buraco, dito
 *      do jeito mais grave.
 *   4. Semana em risco SÓ por peça atrasada (nada a marcar e o que falta cabe
 *      nos dias úteis) sai: "atrasadas" já diz.
 *   5. Semana passada abaixo da meta SÓ por peças atrasadas sai, pelo mesmo
 *      motivo; fica quando houve vaga sem peça nenhuma.
 *   6. Fora do mês atual não há "esta semana" nem "semana passada": a faixa
 *      fala do mês (atrasadas e sem dia).
 *   7. Na última semana do mês, o "sem dia" não espera o limite: uma peça
 *      basta (contrato pequeno não tem meta nas últimas semanas).
 */
export function motivosDeAtencao(linha: LinhaSemMotivos, opcoes: OpcoesDaAtencao = {}): MotivoDeAtencao[] {
  if (!linha.temContrato) return [];
  const motivos: MotivoDeAtencao[] = [];
  const motivo = (chave: ChaveDoMotivo, texto: string) => motivos.push({ chave, texto, peso: PESO_DO_MOTIVO[chave] });
  const passado = linha.quando === 'passado';

  const mesNaoAberto = !linha.monthOpened && linha.hasContentContract;
  if (mesNaoAberto) {
    const nome = MESES[Number(linha.mes.slice(5, 7)) - 1] ?? linha.mes;
    motivo('mes-nao-aberto', `O mês de ${nome} ${passado ? 'não foi aberto' : 'ainda não foi aberto'}.`);
  }

  const atrasadas = soma(linha.tipos, (t) => t.atrasadas + t.extrasAtrasadas);
  if (atrasadas > 0) {
    motivo(
      'atrasadas',
      atrasadas === 1 ? '1 peça passou do dia sem entrega.' : `${atrasadas} peças passaram do dia sem entrega.`,
    );
  }

  if (mesNaoAberto) return motivos.sort((a, b) => b.peso - a.peso);

  if (linha.semanaAtual !== null) {
    const semana = linha.semanaAtual;
    const comSemana = linha.tipos.flatMap((t) => (t.semana ? [{ tipo: t.tipo, ...t.semana }] : []));
    const metaDaSemana = comSemana.filter((s) => s.meta > 0);
    // "Nada marcado" é NADA: peça de qualquer tipo na semana (mesmo extra, mesmo
    // de tipo sem meta) já mostra que alguém olhou o cliente.
    const nadaNaSemana = comSemana.every((s) => s.feitas + s.marcadas + s.atrasadas === 0);

    if (metaDaSemana.length > 0 && nadaNaSemana) {
      motivo(
        'semana-sem-peca',
        `Nada marcado esta semana. O contrato pede ${juntarComE(metaDaSemana.map((s) => quantidadeDoTipo(s.meta, s.tipo)))}.`,
      );
    } else {
      // Os mesmos dias úteis que `estadoDaSemana` conta para o que sobra.
      const sobram = diasUteis(linha.hoje > semana.de ? linha.hoje : semana.de, semana.ate);
      const marcar: string[] = [];
      const entregar: string[] = [];
      for (const s of comSemana.filter((x) => x.estado === 'risco')) {
        const semPeca = s.meta - s.feitas - s.marcadas - s.atrasadas;
        if (semPeca > 0) marcar.push(quantidadeDoTipo(semPeca, s.tipo));
        else if (s.meta - s.feitas > sobram) entregar.push(quantidadeDoTipo(s.meta - s.feitas, s.tipo));
      }
      const partes: string[] = [];
      if (marcar.length > 0) partes.push(`falta marcar ${juntarComE(marcar)}`);
      if (entregar.length > 0) {
        partes.push(
          `falta entregar ${juntarComE(entregar)}${
            sobram === 0 ? ', sem dia útil sobrando' : ` em ${sobram} ${sobram === 1 ? 'dia útil' : 'dias úteis'}`
          }`,
        );
      }
      if (partes.length > 0) motivo('semana-em-risco', `Esta semana está em risco: ${partes.join('; ')}.`);
    }

    // A semana passada DESTE mês. Na semana 1 a anterior é de outro mês, de
    // outro contrato — não se cobra daqui.
    if (semana.numero > 1) {
      const anteriores = linha.planejamento.tipos.flatMap((t) => {
        const c = t.celulas[semana.numero - 2];
        return c && c.estado === 'abaixo' ? [{ tipo: t.tipo, celula: c }] : [];
      });
      // Na semana que já passou não há ● (todo dia dela é < hoje): o que falta
      // é ✕ ou vaga sem peça. Só a vaga é novidade em relação a "atrasadas".
      const vagas = soma(anteriores, ({ celula }) =>
        Math.max(0, celula.meta - celula.feito - celula.sinais.filter((s) => s.sinal === 'atrasada').length),
      );
      if (vagas > 0) {
        const quanto = anteriores.map(({ tipo, celula }) => `${celula.feito} de ${quantidadeDoTipo(celula.meta, tipo)}`);
        motivo('semana-anterior-abaixo', `A semana passada fechou abaixo da meta (${juntarComE(quanto)}).`);
      }
    }
  }

  // NA ÚLTIMA SEMANA DO MÊS O LIMITE CAI PARA UMA PEÇA. O limite existe para a
  // faixa não gritar no começo do mês, quando ainda dá tempo de planejar. Na
  // última semana não dá mais: com o contrato pequeno (2 vídeos, metas
  // [0, 1, 1, 0, 0]) a meta da semana é 0, a semana passada não "fechou
  // abaixo" e dois sem dia ficavam abaixo do limite — o cliente com o mês
  // inteiro por entregar não aparecia em motivo nenhum.
  const naUltimaSemana =
    linha.semanaAtual !== null && linha.semanaAtual.numero === linha.planejamento.semanas.length;
  const limite = Math.min(opcoes.limiteSemDia ?? LIMITE_SEM_DIA, naUltimaSemana ? 1 : Infinity);
  const semDia = linha.tipos.filter((t) => t.contrato > 0 && t.faltaMarcar > 0);
  const totalSemDia = soma(semDia, (t) => t.faltaMarcar);
  if (totalSemDia > 0 && totalSemDia >= limite) {
    const quais = juntarComE(semDia.map((t) => parteDoContrato(t.faltaMarcar, t.contrato, t.tipo)));
    const uma = totalSemDia === 1;
    // No mês que já passou não há "ainda": o que ficou sem dia ficou.
    const verbo = passado ? (uma ? 'ficou sem dia' : 'ficaram sem dia') : uma ? 'ainda está sem dia' : 'ainda estão sem dia';
    motivo('sem-dia', `${maiuscula(quais)} do mês ${verbo}.`);
  }

  return motivos.sort((a, b) => b.peso - a.peso);
}

/* ─────────────────────────── o mês inteiro ─────────────────────────── */

/** Um cliente no mês, com tudo contado. `mes` aceita `YYYY-MM` ou `YYYY-MM-DD`. */
export function mesDoCliente(
  cliente: ClienteDoMes,
  mes: string,
  hoje: string,
  opcoes: OpcoesDaAtencao = {},
): LinhaDoMes {
  const doMes = mes.slice(0, 7);
  const deHoje = hoje.slice(0, 7);
  const estagio = ritualStage(cliente);
  const linha: LinhaSemMotivos = {
    ...cliente,
    mes: doMes,
    hoje,
    quando: doMes < deHoje ? 'passado' : doMes > deHoje ? 'futuro' : 'atual',
    estagio,
    rotuloDoEstagio: RITUAL_LABEL[estagio],
    temContrato:
      cliente.hasContentContract ||
      (cliente.quotaSource === 'contrato' && Object.values(cliente.quota).some((q) => (q ?? 0) > 0)),
    ...contratoDoCliente(cliente, doMes, hoje),
  };
  const motivos = motivosDeAtencao(linha, opcoes);
  return { ...linha, motivos, peso: motivos[0]?.peso ?? 0 };
}

/**
 * As duas leituras do mês → uma linha por cliente, em ordem de nome.
 * `hoje` é parâmetro (e não `new Date()`) para o teste fixar o dia e a tela
 * usar o dia de Brasília, como em `planejarSemanas`.
 */
export function planejarMes(entrada: {
  ritual: readonly PlanningRow[];
  semanas: readonly PlanningWeeksRow[];
  mes: string;
  hoje: string;
  limiteSemDia?: number;
}): LinhaDoMes[] {
  const { ritual, semanas, mes, hoje, limiteSemDia } = entrada;
  return juntarLeituras(ritual, semanas).map((c) => mesDoCliente(c, mes, hoje, { limiteSemDia }));
}

/**
 * Quem precisa de atenção: só quem tem contrato e algum motivo, do motivo mais
 * pesado ao mais leve, e o nome (pt-BR) no empate. O dia já está em cada linha
 * (contado por `planejarMes`), então a lista não o pede de novo.
 */
export function listaDeAtencao(linhas: readonly LinhaDoMes[]): LinhaDoMes[] {
  return linhas
    .filter((l) => l.temContrato && l.motivos.length > 0)
    .sort((a, b) => b.peso - a.peso || a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id));
}

/**
 * A carteira inteira por responsável — a regra da F35, sem cópia: o cliente
 * de dois responsáveis aparece nos dois grupos, "Sem responsável" vai no fim,
 * e dentro do grupo vale `ordenarPorSemana` (em risco, abaixo, resto).
 */
export function agruparMesPorResponsavel(linhas: readonly LinhaDoMes[]): GrupoPorResponsavel<LinhaDoMes>[] {
  return agruparPorResponsavel(linhas);
}

/* ─────────────────────────── os nomes dos tipos ─────────────────────────── */

/** Arte e foto são "a"; vídeo e ads são "o" ("o ads", como se fala na agência). */
const GENERO: Record<ContentType, 'a' | 'o'> = { video: 'o', arte: 'a', foto: 'a', ads: 'o' };

/**
 * "vídeo"/"vídeos", "arte"/"artes", "foto"/"fotos", "ads"/"ads". O singular é o
 * `TIPO_ROTULO` do Calendário em minúscula — a mesma palavra em toda tela; "ads"
 * já termina em "s" e não muda (a ficha também escreve "ADS" no plural).
 */
export function nomeDoTipo(tipo: ContentType, n: number): string {
  const um = (TIPO_ROTULO[tipo] ?? tipo).toLowerCase();
  return n === 1 || um.endsWith('s') ? um : `${um}s`;
}

/** "1 vídeo", "2 artes", "3 ads". */
export function quantidadeDoTipo(n: number, tipo: ContentType): string {
  return `${n} ${nomeDoTipo(tipo, n)}`;
}

/** "a", "a e b", "a, b e c". */
export function juntarComE(partes: readonly string[]): string {
  if (partes.length <= 1) return partes[0] ?? '';
  return `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
}

/** "5 das 8 artes", "1 dos 4 vídeos" — e, quando é tudo, "as 8 artes" ou "o vídeo". */
function parteDoContrato(n: number, total: number, tipo: ContentType): string {
  const g = GENERO[tipo];
  if (n < total) return `${n} d${g}s ${quantidadeDoTipo(total, tipo)}`;
  return total === 1 ? `${g} ${nomeDoTipo(tipo, 1)}` : `${g}s ${quantidadeDoTipo(total, tipo)}`;
}

const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
