/**
 * O que a visão Contrato escreve — F43, Fase 2 (puro, sem tela).
 *
 * A CONTA É DA FASE 1; AQUI SÓ SE DECIDE A PALAVRA
 *   Contrato, entregue, marcada, sem dia, meta da semana e motivos saem de
 *   `planejamento-do-mes.ts`. Este arquivo transforma esses números no que a
 *   pessoa lê ("2 de 8 · 5 sem dia", "nada marcado", "Planejar") — e mora fora
 *   dos componentes para o teste cobrar cada frase sem desenhar a tela, e para
 *   uma revisão de texto achar todas num lugar só.
 *
 * COR SÓ ONDE HÁ MOTIVO
 *   O idioma calmo da F43: neutro é o padrão; `warn` e `err` só marcam o que a
 *   faixa "Precisa de atenção" também cobraria (sem dia, nada marcado,
 *   atrasada, mês não aberto). O que está em dia não ganha verde — ganha
 *   silêncio.
 */

import { MESES } from '@/board/calendario';
import { enderecoDoCliente } from '@/clients/contexto';
import { CONTENT_TYPES, type ContentType } from '@/delivery/level';
import { RITUAL_LABEL, type RitualState, ritualStage } from '@/delivery/month-ritual';
import { semanasDoMes } from '@/delivery/semanas';
import { type EstagioDoRitual, type ResumoDoRitual, resumirRitual } from '@/painel/planejamento';
import type { ChaveDoMotivo, ContratoDoTipo, LinhaDoMes } from '@/painel/planejamento-do-mes';
import { semanaDeHoje } from '@/painel/planejamento-semanal';

export type TomDaTela = 'neutro' | 'warn' | 'err';

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/* ───────────────────────────── a faixa de atenção ───────────────────────────── */

/** O que a faixa escreve no alto: título, o detalhe ao lado e a linha calma de "ninguém". */
export type CabecalhoDaFaixa = { titulo: string; detalhe: string; vazio: string };

/** "outubro" — e "outubro de 2025" quando o ano não é o de hoje. */
export function mesPorExtenso(mes: string, hoje: string): string {
  const nome = MESES[Number(mes.slice(5, 7)) - 1] ?? mes;
  return mes.slice(0, 4) === hoje.slice(0, 4) ? nome : `${nome} de ${mes.slice(0, 4)}`;
}

/**
 * No mês de hoje a faixa fala da SEMANA — "esta semana" é o pedido do Wesley
 * (o alerta olha o mês e a semana). Fora dele não há "esta semana" (Casos de
 * Borda do plano): a faixa fala do mês.
 */
export function cabecalhoDaFaixa(mes: string, hoje: string, quantos: number): CabecalhoDaFaixa {
  const clientes = plural(quantos, 'cliente', 'clientes');
  const doMes = mes.slice(0, 7);
  if (doMes === hoje.slice(0, 7)) {
    const semanas = semanasDoMes(doMes);
    const n = semanaDeHoje({ semanas }, hoje);
    const s = n === null ? null : semanas[n - 1];
    const nome = MESES[Number(doMes.slice(5, 7)) - 1] ?? doMes;
    const quando = s ? ` · semana ${s.numero}, de ${Number(s.de.slice(8, 10))} a ${Number(s.ate.slice(8, 10))} de ${nome}` : '';
    return {
      titulo: 'Precisa de atenção esta semana',
      detalhe: `${clientes}${quando}`,
      vazio: 'Ninguém atrasado esta semana.',
    };
  }
  const nome = mesPorExtenso(doMes, hoje);
  return {
    titulo: `Precisa de atenção em ${nome}`,
    detalhe: clientes,
    vazio: `Ninguém precisa de atenção em ${nome}.`,
  };
}

/** Atrasada é entrega que já falhou: vermelho. O resto ainda se resolve: âmbar. */
export function tomDoMotivo(chave: ChaveDoMotivo): Exclude<TomDaTela, 'neutro'> {
  return chave === 'atrasadas' ? 'err' : 'warn';
}

/** A área da ficha do cliente que resolve o motivo (`@/clients/contexto`). */
export type AreaDaAcao = 'conteudos' | 'semanal';

export type AcaoDaAtencao = {
  /** O texto do botão — um verbo. */
  rotulo: 'Abrir o mês' | 'Ver peças' | 'Planejar';
  /** O nome acessível: o verbo e o cliente, para dez "Planejar" não soarem iguais. */
  nome: string;
  area: AreaDaAcao;
};

/**
 * UMA ação por linha, a do motivo mais pesado.
 *   mês não aberto → Abrir o mês (abrir é de administrador);
 *   atrasadas      → Ver peças (as do mês, com as vencidas);
 *   o resto        → Planejar (a grade semanal, onde se dá dia à peça).
 *
 * Desde a Fase 3 as três abrem o painel do cliente ao lado, onde moram o
 * botão de abrir, as peças e a grade — o verbo diz por onde começar. `area` é
 * a área da ficha que resolve o mesmo motivo, para quem a quiser.
 */
export function acaoDaAtencao(linha: Pick<LinhaDoMes, 'name' | 'motivos'>): AcaoDaAtencao {
  const chave = linha.motivos[0]?.chave;
  if (chave === 'mes-nao-aberto') return { rotulo: 'Abrir o mês', nome: `Abrir o mês de ${linha.name}`, area: 'conteudos' };
  if (chave === 'atrasadas') return { rotulo: 'Ver peças', nome: `Ver peças de ${linha.name}`, area: 'conteudos' };
  return { rotulo: 'Planejar', nome: `Planejar ${linha.name}`, area: 'semanal' };
}

/**
 * A ficha do cliente na área e no MÊS exibidos — abrir outubro e cair em
 * novembro na ficha seria trocar de contrato sem avisar. O mês de hoje não é
 * escrito (o endereço limpo de sempre, como em `enderecoDoCliente`).
 */
export function enderecoDaFicha(id: string, mes: string, hoje: string, area: AreaDaAcao = 'conteudos'): string {
  return enderecoDoCliente(id, { area, mes: mes.slice(0, 7), periodo: null }, hoje.slice(0, 7));
}

/* ───────────────────────────── a tabela do contrato ───────────────────────────── */

/**
 * As colunas de tipo: só os que aparecem no mês — com contrato ou com peça —
 * de quem tem contrato. Sem cliente nenhum com ads, não há coluna de ads. Quem
 * não tem contrato não abre coluna: a linha dele diz "sem contrato" inteira.
 * A ordem é a de `CONTENT_TYPES`, a mesma da grade semanal.
 */
export function tiposDoMes(linhas: readonly Pick<LinhaDoMes, 'temContrato' | 'tipos'>[]): ContentType[] {
  const presentes = new Set(linhas.filter((l) => l.temContrato).flatMap((l) => l.tipos.map((t) => t.tipo)));
  return CONTENT_TYPES.filter((t) => presentes.has(t));
}

/**
 * As três partes da barra de um tipo — e elas somam o contrato.
 *   entregue  as peças do contrato concluídas;
 *   marcada   as que têm dia e não saíram (no prazo, vencidas ou fora do mês:
 *             todas já têm dia; a vencida é dita na coluna da semana e na faixa);
 *   semDia    o que ainda não tem dia (`faltaMarcar`: sem dia + não criadas).
 */
export function partesDaBarra(t: ContratoDoTipo): { entregue: number; marcada: number; semDia: number } {
  return { entregue: t.entregues, marcada: t.marcadas + t.atrasadas + t.foraDoMes, semDia: t.faltaMarcar };
}

export type LegendaDoTipo = {
  /** "2 de 8" — entregue de contrato. `null` no tipo sem contrato (só extra). */
  feito: { entregues: number; contrato: number } | null;
  /** "5 sem dia" · "tudo marcado" · "tudo entregue" · "1 extra". */
  resto: string;
  tom: TomDaTela;
  /** "+1 extra" ao lado, quando o tipo tem contrato e também extra. */
  extra: string | null;
};

export function legendaDoTipo(t: ContratoDoTipo): LegendaDoTipo {
  const extras = t.extras + t.extrasPendentes;
  if (t.contrato === 0) return { feito: null, resto: plural(extras, 'extra', 'extras'), tom: 'neutro', extra: null };
  const feito = { entregues: t.entregues, contrato: t.contrato };
  const extra = extras > 0 ? `+${plural(extras, 'extra', 'extras')}` : null;
  if (t.faltaMarcar > 0) return { feito, resto: `${t.faltaMarcar} sem dia`, tom: 'warn', extra };
  return { feito, resto: t.entregues >= t.contrato ? 'tudo entregue' : 'tudo marcado', tom: 'neutro', extra };
}

/** O que a barra diz ao leitor de tela — o desenho sozinho não fala. */
export function descricaoDaBarra(rotuloDoTipo: string, t: ContratoDoTipo): string {
  const p = partesDaBarra(t);
  return `${rotuloDoTipo}: ${t.entregues} de ${t.contrato} entregues, ${plural(p.marcada, 'marcada', 'marcadas')}, ${p.semDia} sem dia`;
}

export type EstaSemana = { texto: string; tom: TomDaTela; titulo: string };

/**
 * A coluna "Esta semana" de um cliente: a soma dos tipos na semana de hoje.
 * `null` fora do mês atual (a coluna nem aparece) e para quem não tem
 * contrato. A ordem das perguntas é a da gravidade, a mesma da faixa:
 * atrasada, nada marcado, falta marcar; e, sem falta, quanto saiu.
 *
 * Extra conta em "feitas" — é a célula da F35 ("extra aparece e conta em
 * feito, mas não altera a meta").
 */
export function estaSemanaDoCliente(linha: Pick<LinhaDoMes, 'temContrato' | 'tipos'>): EstaSemana | null {
  if (!linha.temContrato) return null;
  const semanas = linha.tipos.flatMap((t) => (t.semana ? [t.semana] : []));
  if (semanas.length === 0) return null;
  const meta = semanas.reduce((n, s) => n + s.meta, 0);
  const feitas = semanas.reduce((n, s) => n + s.feitas, 0);
  const marcadas = semanas.reduce((n, s) => n + s.marcadas, 0);
  const atrasadas = semanas.reduce((n, s) => n + s.atrasadas, 0);
  // O QUE A META PEDE, TIPO A TIPO. A meta é de cada tipo (a célula da F35 e os
  // motivos da faixa a medem assim): o que sobra de uma arte não paga um vídeo
  // que falta. Somar tudo e comparar com a meta somada pintava "✓ 3 de 3" num
  // cliente com 3 artes (uma extra) e nenhum vídeo — enquanto a faixa, no mesmo
  // cliente, dizia "falta marcar 1 vídeo".
  const feitasNaMeta = semanas.reduce((n, s) => n + Math.min(s.feitas, s.meta), 0);
  const cobertasNaMeta = semanas.reduce((n, s) => n + Math.min(s.feitas + s.marcadas, s.meta), 0);
  const titulo = `Meta da semana: ${meta}. ${plural(feitas, 'entregue', 'entregues')}, ${plural(marcadas, 'marcada', 'marcadas')}, ${plural(atrasadas, 'atrasada', 'atrasadas')}.`;

  if (atrasadas > 0) return { texto: plural(atrasadas, 'atrasada', 'atrasadas'), tom: 'err', titulo };
  if (meta === 0) {
    return feitas + marcadas > 0
      ? { texto: `${feitas + marcadas} sem meta`, tom: 'neutro', titulo }
      : { texto: 'sem meta', tom: 'neutro', titulo };
  }
  if (feitas + marcadas === 0) return { texto: 'nada marcado', tom: 'warn', titulo };
  if (feitasNaMeta >= meta) return { texto: `✓ ${feitas} de ${meta}`, tom: 'neutro', titulo };
  const faltam = meta - cobertasNaMeta;
  if (faltam > 0) return { texto: `falta marcar ${faltam}`, tom: 'warn', titulo };
  return { texto: `${feitasNaMeta} de ${meta}`, tom: 'neutro', titulo };
}

/* ───────────────────────────── o mês do cliente ───────────────────────────── */

/**
 * O estágio em poucas palavras, que cabem na coluna — o que FALTA, como as
 * faixas do resumo antigo. O nome longo (`RITUAL_LABEL`) vai no `title`.
 */
export const ESTAGIO_CURTO: Record<LinhaDoMes['estagio'], string> = {
  fechado: 'Mês não aberto',
  aberto: 'Falta planejar',
  planejado: 'Falta aprovar',
  aprovado: 'Aprovado',
};

/** Cada um dos três passos (aberto, planejado, aprovado). */
export type PontoDoMes = 'feito' | 'falta' | 'atencao' | 'depois' | 'desconhecido';

export type MesDoClienteNaTela = { pontos: [PontoDoMes, PontoDoMes, PontoDoMes]; rotulo: string; titulo: string };

/**
 * Os três pontos do mês do cliente e o nome do passo.
 *
 * O próximo passo é um anel neutro (`falta`); só o mês NÃO ABERTO de quem tem
 * contrato vira âmbar (`atencao`) — é o único estágio que é motivo na faixa.
 *
 * Cliente que só veio na leitura das semanas (`so-semanas`): sabe-se se o mês
 * abriu, não se foi planejado ou aprovado — os dois pontos ficam
 * `desconhecido`, em vez de afirmar "falta planejar" de um mês já planejado.
 */
export function mesDoClienteNaTela(
  linha: Pick<LinhaDoMes, 'estagio' | 'leitura' | 'temContrato' | 'hasContentContract'>,
): MesDoClienteNaTela {
  const titulo = `Mês do cliente: ${RITUAL_LABEL[linha.estagio]}`;
  const aberto = linha.estagio !== 'fechado';
  if (!aberto) {
    const atencao = linha.temContrato && linha.hasContentContract;
    return { pontos: [atencao ? 'atencao' : 'falta', 'depois', 'depois'], rotulo: ESTAGIO_CURTO.fechado, titulo };
  }
  if (linha.leitura === 'so-semanas') {
    return {
      pontos: ['feito', 'desconhecido', 'desconhecido'],
      rotulo: 'Aberto',
      titulo: 'Mês do cliente: aberto (planejamento e aprovação não vieram nesta leitura)',
    };
  }
  if (linha.estagio === 'aberto') return { pontos: ['feito', 'falta', 'depois'], rotulo: ESTAGIO_CURTO.aberto, titulo };
  if (linha.estagio === 'planejado') return { pontos: ['feito', 'feito', 'falta'], rotulo: ESTAGIO_CURTO.planejado, titulo };
  return { pontos: ['feito', 'feito', 'feito'], rotulo: ESTAGIO_CURTO.aprovado, titulo };
}

/* ───────────────────────────── o resumo por etapa e "Só o que falta" — Fase 4 ───────────────────────────── */

/**
 * AS DUAS FUNÇÕES QUE A ANTIGA ABA MÊS TINHA, DE VOLTA
 *   A aba Mês (F12) abria com o resumo do mês por etapa — "Mês não aberto ·
 *   Falta planejar · Falta aprovar · Aprovados", cada um com quantos — e um
 *   botão "Só o que falta" que deixava na lista só quem ainda não está
 *   aprovado. A Fase 2 tirou a aba e os dois foram junto, sem ninguém pedir; o
 *   Wesley pediu de volta ("não esconder nenhum botão sem querer… ou função").
 *
 *   A conta é a MESMA de antes: `resumirRitual`, sobre `ritualStage`. E o
 *   resumo segue o que a tabela mostra (o filtro de nome e o "Só o que
 *   falta"), como seguia o filtro na aba Mês: um contador que fala de 91
 *   clientes sobre uma lista de 3 não descreve nada.
 */
export const ETAPAS_DO_RESUMO: ReadonlyArray<{ chave: EstagioDoRitual; rotulo: string }> = [
  { chave: 'fechado', rotulo: 'Mês não aberto' },
  { chave: 'aberto', rotulo: 'Falta planejar' },
  { chave: 'planejado', rotulo: 'Falta aprovar' },
  { chave: 'aprovado', rotulo: 'Aprovados' },
];

/** As linhas que o "Só o que falta" deixa: quem ainda não está aprovado. Desligado, todas. */
export function soOQueFalta<T extends RitualState>(linhas: readonly T[], ligado: boolean): T[] {
  return ligado ? linhas.filter((l) => ritualStage(l) !== 'aprovado') : [...linhas];
}

/** Os quatro números da linha do resumo, na ordem de `ETAPAS_DO_RESUMO`. */
export function resumoPorEtapa(linhas: readonly RitualState[]): Array<{ chave: EstagioDoRitual; rotulo: string; quantos: number }> {
  const r: ResumoDoRitual = resumirRitual(linhas);
  return ETAPAS_DO_RESUMO.map((e) => ({ ...e, quantos: r[e.chave] }));
}

/* ───────────────────────────── o filtro ───────────────────────────── */

/** Sem acento e sem caixa: "cafe" acha "Café do Bairro" — no celular ninguém põe acento. */
const normalizar = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');

/** As linhas cujo nome contém o texto. Texto vazio (ou só espaço) devolve tudo. */
export function filtrarPorNome<T extends { name: string }>(linhas: readonly T[], texto: string): T[] {
  const alvo = normalizar(texto.trim());
  if (alvo === '') return [...linhas];
  return linhas.filter((l) => normalizar(l.name).includes(alvo));
}

/** O "6 clientes" de "Carla · 6 clientes" — o cliente de dois responsáveis conta nos dois. */
export function contagemDoGrupo(quantos: number): string {
  return plural(quantos, 'cliente', 'clientes');
}
