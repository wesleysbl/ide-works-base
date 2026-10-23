/**
 * O planejamento por semana — etapa F35, Fase 1 (a regra, sem tela).
 *
 * POR QUE A META É CALCULADA, E NÃO DIGITADA
 *   A planilha "IDE DEMANDAS" tinha a meta da semana escrita à mão — e cada
 *   pessoa dividia a cota de um jeito. Aqui a meta da semana é a cota do mês
 *   do cliente dividida pelas semanas, na proporção dos dias úteis de cada uma.
 *   Ninguém digita, então ninguém diverge.
 *
 * POR QUE DIAS ÚTEIS, E NÃO "COTA ÷ NÚMERO DE SEMANAS"
 *   As semanas vêm de `semanasDoMes` (a mesma divisão da grade semanal da
 *   ficha) e têm tamanhos diferentes: uma ponta pode ter 10 dias, outra 4.
 *   Dividir por igual cobraria da semana de 4 dias o mesmo que da de 10.
 *   Sábado e domingo não contam porque a produção não acontece neles — uma
 *   peça agendada no sábado conta na semana que contém o sábado, mas o sábado
 *   não aumenta a meta.
 *
 * POR QUE O RESTO VAI PELO MAIOR RESÍDUO
 *   Arredondar cada semana sozinha faz a soma escapar da cota (8 artes viram
 *   7 ou 9). O maior resíduo garante soma = cota exata; o empate vai para a
 *   semana mais cedo, para a cobrança vir antes, e não amontoada no fim.
 *
 * A PEÇA CONTA NA SEMANA EM QUE ESTÁ AGENDADA
 *   Decisão do Wesley em 01/10/2026: não na semana em que foi concluída. O dia
 *   é o dia de São Paulo do instante (`diaDoInstante`) — o MESMO critério da
 *   grade semanal (`Semanal.tsx`) e do Calendário. A grade grava ao meio-dia
 *   (`meioDiaDoDia`) para o dia não virar conforme o fuso; e o recorte por
 *   `slice(0, 10)` (dia de UTC) que havia aqui errava a peça das 22h, que
 *   chega como 01h do dia seguinte.
 */

import type { ItemDaGrade } from '@/clients/Semanal';
import { CONTENT_TYPES, type ContentType } from '@/delivery/level';
import { type Semana, semanasDoMes } from '@/delivery/semanas';
import { diaDoInstante } from '@/ui/grade-do-mes';

/** A peça é a mesma da grade semanal da ficha — não uma forma paralela. */
export type PecaDoPlanejamento = ItemDaGrade;

/** Cota do mês por tipo. Tipo ausente vale 0. */
export type CotaDoMes = Partial<Record<ContentType, number>>;

/**
 * ✓ concluída · ● agendada no prazo · ✕ atrasada (o dia passou sem conclusão).
 * A "vaga sem peça" (·) não é sinal de peça: a tela a desenha com `meta - peças`.
 */
export type SinalDaPeca = 'feita' | 'agendada' | 'atrasada';

export type EstadoDaSemana = 'neutra' | 'futura' | 'bateu' | 'risco' | 'andamento' | 'abaixo';

export type SinalNaSemana = {
  id: string;
  sinal: SinalDaPeca;
  /** `YYYY-MM-DD`. */
  dia: string;
  title: string | null;
  isExtra: boolean;
};

export type CelulaDaSemana = {
  semana: Semana;
  meta: number;
  /** Concluídas agendadas nesta semana — extra inclusa. */
  feito: number;
  /** Na ordem do dia. */
  sinais: SinalNaSemana[];
  estado: EstadoDaSemana;
};

export type LinhaDoTipo = {
  tipo: ContentType;
  /** Cota do mês deste tipo; 0 quando a sublinha só existe porque há peça ("extra"). */
  cota: number;
  /** Tipo sem cota que aparece só porque existe peça dele. */
  semCotaDoTipo: boolean;
  celulas: CelulaDaSemana[];
  mes: {
    /** Todas as concluídas do tipo no mês de competência — com dia, sem dia ou fora das semanas. */
    feito: number;
    cota: number;
    /** Peças sem dia: não entram em semana nenhuma, a tela mostra "+N sem dia". */
    semDia: number;
    /** Agendadas fora do mês de competência: também não entram em semana. */
    foraDoMes: number;
  };
};

export type PlanejamentoDoCliente = {
  semanas: Semana[];
  /** Na ordem de `CONTENT_TYPES`: tipos com cota, e depois de cota 0 só os que têm peça. */
  tipos: LinhaDoTipo[];
  /** Nenhum tipo com cota — uma linha só na tela, sem cor de atraso. */
  semCota: boolean;
  /** Alguma semana corrente em risco. Sempre `false` em cliente sem cota. */
  emRisco: boolean;
  /** Alguma semana passada abaixo da meta. Sempre `false` em cliente sem cota. */
  abaixo: boolean;
};

const comoDia = (d: Date) => d.toISOString().slice(0, 10);
const diaDaSemana = (dia: string) => new Date(`${dia}T12:00:00Z`).getUTCDay();

/** Dias de segunda a sexta entre `de` e `ate`, inclusivos. */
export function diasUteis(de: string, ate: string): number {
  if (de > ate) return 0;
  let n = 0;
  const d = new Date(`${de}T12:00:00Z`);
  for (let dia = comoDia(d); dia <= ate; d.setUTCDate(d.getUTCDate() + 1), dia = comoDia(d)) {
    const s = diaDaSemana(dia);
    if (s !== 0 && s !== 6) n += 1;
  }
  return n;
}

/**
 * Divide a cota entre as semanas pelos dias úteis, resto pelo maior resíduo
 * (empate → semana mais cedo). A soma é sempre a cota.
 */
export function dividirMeta(cota: number, semanas: readonly Semana[]): number[] {
  const total = Math.max(0, Math.floor(cota));
  if (semanas.length === 0) return [];
  let pesos = semanas.map((s) => diasUteis(s.de, s.ate));
  const somaPesos = pesos.reduce((a, b) => a + b, 0);
  // Mês sem dia útil não existe no calendário; a guarda só evita dividir por
  // zero — e aí cada semana pesa igual.
  if (somaPesos === 0) pesos = semanas.map(() => 1);
  const soma = pesos.reduce((a, b) => a + b, 0);

  const exatas = pesos.map((p) => (total * p) / soma);
  const metas = exatas.map((x) => Math.floor(x));
  let resto = total - metas.reduce((a, b) => a + b, 0);

  const ordem = exatas
    .map((x, i) => ({ i, residuo: x - Math.floor(x) }))
    // Semana sem dia útil não recebe resto: ela tem resíduo 0 de qualquer jeito,
    // mas o filtro deixa a intenção explícita.
    .filter(({ i }) => pesos[i] > 0)
    .sort((a, b) => b.residuo - a.residuo || a.i - b.i);
  for (const { i } of ordem) {
    if (resto <= 0) break;
    metas[i] += 1;
    resto -= 1;
  }
  return metas;
}

/**
 * O número da semana que contém hoje, ou `null` se hoje não é deste mês.
 *
 * Mora aqui, e não na grade, pelo mesmo motivo de `agruparPorResponsavel`: a
 * regra do mês do cliente (`planejamento-do-mes.ts`, F43) também precisa saber
 * qual é "esta semana", e uma regra pura não deve importar uma tela.
 */
export function semanaDeHoje(planejamento: Pick<PlanejamentoDoCliente, 'semanas'>, hoje: string): number | null {
  return planejamento.semanas.find((s) => hoje >= s.de && hoje <= s.ate)?.numero ?? null;
}

/**
 * O dia da peça, pelo mesmo recorte da grade semanal e do Calendário: o dia
 * civil da AGÊNCIA (São Paulo), e não o de UTC. `null` quando não tem dia.
 */
export function diaDaPeca(peca: Pick<PecaDoPlanejamento, 'scheduledAt'>): string | null {
  return peca.scheduledAt === null ? null : diaDoInstante(peca.scheduledAt);
}

/**
 * ✓ / ● / ✕. "Atrasada" só depois que o dia passou: no próprio dia a peça
 * ainda está no prazo. Peça sem dia não tem sinal — ela não tem prazo.
 */
export function sinalDaPeca(
  peca: Pick<PecaDoPlanejamento, 'scheduledAt' | 'completedAt'>,
  hoje: string,
): SinalDaPeca | null {
  if (peca.completedAt !== null) return 'feita';
  const dia = diaDaPeca(peca);
  if (dia === null) return null;
  return dia < hoje ? 'atrasada' : 'agendada';
}

/**
 * O estado de uma célula. A ordem das perguntas é a regra:
 *   1. meta 0 e nada concluído → neutra (cota pequena demais para esta semana não é atraso);
 *   2. começa depois de hoje → futura (ainda não se cobra);
 *   3. feito ≥ meta → bateu;
 *   4. semana corrente → risco se o agendado não cobre a meta, ou se o que
 *      falta concluir não cabe nos dias úteis que sobram (hoje incluso);
 *      senão, andamento;
 *   5. semana passada → abaixo.
 *
 * "Agendado" aqui é só o ● — a peça atrasada (✕) não conta como cobertura:
 * ela já é o sinal de que a semana escorregou.
 */
export function estadoDaSemana(
  semana: Semana,
  meta: number,
  sinais: readonly Pick<SinalNaSemana, 'sinal'>[],
  hoje: string,
): EstadoDaSemana {
  const feito = sinais.filter((s) => s.sinal === 'feita').length;
  // Meta 0 sem nada concluído é neutra mesmo com peça agendada/atrasada: sem
  // isso, "0 ≥ 0" pintaria de "bateu" uma semana em que nada foi entregue.
  if (meta === 0 && feito === 0) return 'neutra';
  if (semana.de > hoje) return 'futura';
  if (feito >= meta) return 'bateu';
  if (hoje <= semana.ate) {
    const agendadas = sinais.filter((s) => s.sinal === 'agendada').length;
    const faltam = meta - feito;
    const sobram = diasUteis(hoje > semana.de ? hoje : semana.de, semana.ate);
    return agendadas + feito < meta || faltam > sobram ? 'risco' : 'andamento';
  }
  return 'abaixo';
}

const ehTipo = (t: string): t is ContentType => (CONTENT_TYPES as readonly string[]).includes(t);

/**
 * Monta o planejamento de um cliente num mês.
 *
 * `mes` aceita `YYYY-MM` ou `YYYY-MM-DD`; `hoje` é `YYYY-MM-DD` (parâmetro, e
 * não `new Date()`, para o teste fixar o dia e a tela usar o dia de Brasília).
 *
 * Peça de tipo desconhecido (fora de `CONTENT_TYPES`) é ignorada: não há
 * sublinha para ela, e inventar uma seria cobrar o que nenhum contrato mede.
 */
export function planejarSemanas(entrada: {
  mes: string;
  cota: CotaDoMes;
  pecas: readonly PecaDoPlanejamento[];
  hoje: string;
}): PlanejamentoDoCliente {
  const { mes, cota, pecas, hoje } = entrada;
  const semanas = semanasDoMes(mes);
  const cotaDe = (t: ContentType) => Math.max(0, Math.floor(cota[t] ?? 0));
  const semCota = CONTENT_TYPES.every((t) => cotaDe(t) === 0);

  const tipos: LinhaDoTipo[] = [];
  for (const tipo of CONTENT_TYPES) {
    const doTipo = pecas.filter((p) => ehTipo(p.contentType) && p.contentType === tipo);
    const cotaDoTipo = cotaDe(tipo);
    if (cotaDoTipo === 0 && doTipo.length === 0) continue;

    const metas = dividirMeta(cotaDoTipo, semanas);
    let semDia = 0;
    let foraDoMes = 0;
    const porSemana = semanas.map(() => [] as SinalNaSemana[]);

    for (const p of doTipo) {
      const dia = diaDaPeca(p);
      if (dia === null) {
        semDia += 1;
        continue;
      }
      const i = semanas.findIndex((s) => dia >= s.de && dia <= s.ate);
      // Agendada fora do mês de competência: não é empurrada para a semana mais
      // próxima (mesma regra de `semanaDaData` e da grade semanal).
      if (i < 0) {
        foraDoMes += 1;
        continue;
      }
      porSemana[i].push({
        id: p.id,
        sinal: sinalDaPeca(p, hoje) as SinalDaPeca,
        dia,
        title: p.title,
        isExtra: p.isExtra,
      });
    }

    const celulas = semanas.map((semana, i) => {
      const sinais = porSemana[i].sort((a, b) => a.dia.localeCompare(b.dia) || a.id.localeCompare(b.id));
      return {
        semana,
        meta: metas[i],
        feito: sinais.filter((s) => s.sinal === 'feita').length,
        sinais,
        estado: estadoDaSemana(semana, metas[i], sinais, hoje),
      };
    });

    tipos.push({
      tipo,
      cota: cotaDoTipo,
      semCotaDoTipo: cotaDoTipo === 0,
      celulas,
      mes: {
        feito: doTipo.filter((p) => p.completedAt !== null).length,
        cota: cotaDoTipo,
        semDia,
        foraDoMes,
      },
    });
  }

  // Cliente sem cota não entra na conta de atraso — nem por uma peça avulsa.
  const estados = semCota ? [] : tipos.flatMap((t) => t.celulas.map((c) => c.estado));
  return {
    semanas,
    tipos,
    semCota,
    emRisco: estados.includes('risco'),
    abaixo: estados.includes('abaixo'),
  };
}

/**
 * Ordem dentro do grupo de um responsável: em risco, abaixo, o resto — e o
 * nome em pt-BR para desempatar. Mesmo motivo de `ordenarPorRitual`: quem abre
 * a tela quer achar primeiro onde ainda dá para salvar a semana.
 */
export function ordenarPorSemana<T extends { name: string; planejamento: PlanejamentoDoCliente }>(
  linhas: readonly T[],
): T[] {
  const peso = (p: PlanejamentoDoCliente) => (p.emRisco ? 0 : p.abaixo ? 1 : 2);
  return [...linhas].sort((a, b) => {
    const pa = peso(a.planejamento);
    const pb = peso(b.planejamento);
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name, 'pt-BR');
  });
}

/** O nome do grupo de quem não tem responsável. */
export const SEM_RESPONSAVEL = 'Sem responsável';

export type GrupoPorResponsavel<T> = {
  /** `null` = "Sem responsável". */
  id: string | null;
  nome: string;
  linhas: T[];
  emRisco: number;
};

/**
 * Agrupa por responsável. Grupos pelo nome (pt-BR), "Sem responsável" no fim;
 * dentro de cada um, a ordem de `ordenarPorSemana` (em risco, abaixo, resto).
 * O cliente com dois responsáveis aparece nos dois grupos.
 *
 * Mora aqui, e não na tela, para a leitura `get_planning_weeks` das integrações
 * agrupar pela MESMA regra — a tela (`GradeDaSemana`) só a reexporta.
 */
export function agruparPorResponsavel<
  T extends {
    name: string;
    owners: readonly { id: string; name: string }[];
    planejamento: PlanejamentoDoCliente;
  },
>(linhas: readonly T[]): GrupoPorResponsavel<T>[] {
  const porDono = new Map<string, { nome: string; linhas: T[] }>();
  const semDono: T[] = [];
  for (const l of linhas) {
    if (l.owners.length === 0) {
      semDono.push(l);
      continue;
    }
    for (const o of l.owners) {
      const g = porDono.get(o.id) ?? { nome: o.name.trim() || 'Pessoa sem nome', linhas: [] };
      // O mesmo dono duas vezes no mesmo cliente não duplica a linha.
      if (!g.linhas.includes(l)) g.linhas.push(l);
      porDono.set(o.id, g);
    }
  }

  const montar = (id: string | null, nome: string, ls: T[]): GrupoPorResponsavel<T> => {
    const ordenadas = ordenarPorSemana(ls);
    return { id, nome, linhas: ordenadas, emRisco: ordenadas.filter((l) => l.planejamento.emRisco).length };
  };

  const grupos = [...porDono.entries()]
    .map(([id, g]) => montar(id, g.nome, g.linhas))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  if (semDono.length > 0) grupos.push(montar(null, SEM_RESPONSAVEL, semDono));
  return grupos;
}
