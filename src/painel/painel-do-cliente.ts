/**
 * O que o painel do cliente decide — F43, Fase 3 (puro, sem tela).
 *
 * O PAINEL JUNTA QUATRO LUGARES NUM SÓ
 *   As chaves do mês (que moravam na lista do ritual e no topo da ficha), o
 *   contrato por tipo (a barra da visão Contrato), as semanas e as peças sem
 *   dia (a grade `Semanal` da ficha). As contas não são novas: o ritual é
 *   `proximoPasso`/`travaDoPlanejamento`/`ofereceAprovacao` (a MESMA regra que
 *   o servidor usa, `decideRitualChange`), o contrato é o de `planejarMes`.
 *   Aqui só se decide o que aparece, em que estado, e com que frase.
 *
 * AS CHAVES SÓ PARA QUEM PODE — e o porquê à vista
 *   A política do banco só deixa o administrador mudar o contrato do mês. Até
 *   a F43 o servidor respondia "ok" sem gravar para os outros (corrigido no
 *   Worker nesta fase: agora é 403 com frase). A tela não espera a recusa: para
 *   quem não administra, as chaves aparecem desligadas com o motivo escrito,
 *   para ninguém achar que gravou. Quem recusa de verdade continua sendo a API.
 */

import { CONTENT_TYPES, type ContentType } from '@/delivery/level';
import { mesPorExtenso } from '@/painel/contrato-na-tela';
import {
  type LinhaDePlanejamento,
  type ProximoPasso,
  ofereceAprovacao,
  proximoPasso,
  travaDoPlanejamento,
} from '@/painel/planejamento';
import type { LinhaDoMes } from '@/painel/planejamento-do-mes';
import type { PlanningWeekItem } from '@/server/planning-weeks';

/** O motivo visível das chaves desligadas — curto, cabe ao lado delas. */
export const SO_ADMIN_MARCA = 'Só um administrador marca.';
/** O do botão de abrir: a frase que o servidor já devolve na recusa. */
export const SO_ADMIN_ABRE = 'Só um administrador abre o mês.';

/* ───────────────────────────── os passos do mês ───────────────────────────── */

/** Cada passo: feito (✓), o de agora, os de depois — ou não se sabe. */
export type EstadoDoPasso = 'feito' | 'agora' | 'depois' | 'desconhecido';

export type PassoDoMes = { chave: 'aberto' | 'planejado' | 'aprovado'; rotulo: string; estado: EstadoDoPasso };

const ROTULO_DO_PASSO: Record<PassoDoMes['chave'], string> = {
  aberto: 'Mês aberto',
  planejado: 'Planejamento',
  aprovado: 'Aprovação do cliente',
};

/**
 * Os três passos do mês do cliente, na ordem do ritual.
 *
 * Cliente que só veio na leitura das semanas (`so-semanas`): sabe-se que o mês
 * abriu, não se foi planejado ou aprovado — os dois ficam `desconhecido`, em
 * vez de dizer "agora: planejamento" de um mês já aprovado.
 */
export function passosDoMes(linha: Pick<LinhaDoMes, 'estagio' | 'leitura'>): PassoDoMes[] {
  const estados: Record<LinhaDoMes['estagio'], [EstadoDoPasso, EstadoDoPasso, EstadoDoPasso]> = {
    fechado: ['agora', 'depois', 'depois'],
    aberto: ['feito', 'agora', 'depois'],
    planejado: ['feito', 'feito', 'agora'],
    aprovado: ['feito', 'feito', 'feito'],
  };
  const e: [EstadoDoPasso, EstadoDoPasso, EstadoDoPasso] =
    linha.leitura === 'so-semanas' && linha.estagio !== 'fechado'
      ? ['feito', 'desconhecido', 'desconhecido']
      : estados[linha.estagio];
  return (['aberto', 'planejado', 'aprovado'] as const).map((chave, i) => ({
    chave,
    // "Mês aberto" aceso num mês FECHADO leria como o contrário: enquanto não
    // abre, o passo diz o que é — a mesma palavra da coluna da tabela.
    rotulo: chave === 'aberto' && e[i] !== 'feito' ? 'Mês não aberto' : ROTULO_DO_PASSO[chave],
    estado: e[i],
  }));
}

/* ───────────────────────────── a ação do mês ───────────────────────────── */

export type ChaveDoMes = { ligada: boolean; desativada: boolean };

/**
 * O que o painel oferece no mês do cliente — UM próximo passo escrito e os
 * controles que a regra do ritual aceita agora.
 *
 *   abrir        mês não aberto: o botão "Abrir o mês" (de administrador).
 *   chaves       mês aberto: "Planejamento OK" sempre (é por ela que se
 *                reabre o plano), "Cliente aprovou" só quando a regra deixa
 *                aprovar ou para retirar a aprovação (`ofereceAprovacao`) —
 *                antes disso, `espera` diz por quê ela ainda não está ali.
 *   sem-leitura  o planejamento e a aprovação não vieram (`so-semanas`):
 *                oferecer a chave seria marcar às cegas.
 *
 * `souAdmin` `null` é "a sessão ainda não chegou": tudo desligado e SEM
 * motivo — dizer "só administrador" a um administrador por meio segundo
 * seria pior que a espera.
 */
export type AcaoDoMes =
  | { tipo: 'abrir'; passo: ProximoPasso; desativada: boolean; motivo: string | null }
  | {
      tipo: 'chaves';
      passo: ProximoPasso;
      planejamento: ChaveDoMes & {
        /** A regra que trava a chave (mês aprovado não se desplaneja), para o `title` e o leitor. */
        trava: string | null;
      };
      aprovacao: ChaveDoMes | null;
      espera: string | null;
      /** O porquê à vista quando quem olha não pode marcar. */
      motivo: string | null;
    }
  | { tipo: 'sem-leitura'; passo: ProximoPasso; texto: string };

export function acaoDoMes(
  linha: LinhaDePlanejamento & Pick<LinhaDoMes, 'leitura'>,
  souAdmin: boolean | null,
): AcaoDoMes {
  const passo = proximoPasso(linha);
  const naoPode = souAdmin !== true;
  const motivoAVista = souAdmin === false;

  if (!linha.monthOpened) {
    return { tipo: 'abrir', passo, desativada: naoPode, motivo: motivoAVista ? SO_ADMIN_ABRE : null };
  }
  if (linha.leitura === 'so-semanas') {
    return {
      tipo: 'sem-leitura',
      passo,
      texto: 'O planejamento e a aprovação deste mês não vieram nesta leitura. Recarregue para marcar.',
    };
  }
  const trava = travaDoPlanejamento(linha);
  const comAprovacao = ofereceAprovacao(linha);
  return {
    tipo: 'chaves',
    passo,
    planejamento: { ligada: linha.planningDoneAt !== null, desativada: naoPode || trava !== null, trava },
    aprovacao: comAprovacao ? { ligada: linha.clientApprovedAt !== null, desativada: naoPode } : null,
    espera: comAprovacao ? null : 'A aprovação do cliente vem depois do planejamento.',
    motivo: motivoAVista ? SO_ADMIN_MARCA : null,
  };
}

/* ───────────────────────────── quem e o plano ───────────────────────────── */

/** "Carla · plano Conteúdo" — "Carla e Helena", "Sem responsável", "sem plano". */
export function subtituloDoCliente(linha: Pick<LinhaDoMes, 'owners' | 'plan'>): string {
  const nomes = linha.owners.map((o) => o.name);
  const quem =
    nomes.length === 0
      ? 'Sem responsável'
      : nomes.length === 1
        ? nomes[0]
        : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
  return `${quem} · ${linha.plan ? `plano ${linha.plan.name}` : 'sem plano'}`;
}

/** "Contrato de outubro" — com o ano quando não é o de hoje. */
export function tituloDoContrato(mes: string, hoje: string): string {
  return `Contrato de ${mesPorExtenso(mes.slice(0, 7), hoje)}`;
}

/* ───────────────────────────── a grade semanal ───────────────────────────── */

export type EntradaDaSemanal = {
  itens: PlanningWeekItem[];
  contratado: Record<ContentType, number>;
  mesAberto: boolean;
  semContratoDeConteudo: boolean;
};

/**
 * O cliente do mês na forma que a `Semanal` da ficha recebe — a grade é a
 * MESMA, e quem muda é só de onde vêm os números.
 *
 *   contratado            a cota do mês, com zero nos tipos ausentes (a
 *                         `Semanal` soma os quatro). Mês aberto: é o contrato
 *                         congelado — o mesmo que a ficha lê do medidor.
 *   mesAberto             `quotaSource === 'contrato'` é a regra do servidor
 *                         para "o contrato do mês existe"; o ritual confirma.
 *   semContratoDeConteudo do cadastro de hoje (F17.57), como na ficha.
 */
export function entradaDaSemanal(
  linha: Pick<LinhaDoMes, 'items' | 'quota' | 'quotaSource' | 'monthOpened' | 'hasContentContract'>,
): EntradaDaSemanal {
  const contratado = Object.fromEntries(CONTENT_TYPES.map((t) => [t, linha.quota[t] ?? 0])) as Record<
    ContentType,
    number
  >;
  return {
    itens: linha.items,
    contratado,
    mesAberto: linha.quotaSource === 'contrato' || linha.monthOpened,
    semContratoDeConteudo: !linha.hasContentContract,
  };
}

/* ───────────────────────────── a escrita do painel ───────────────────────────── */

/**
 * Uma escrita do painel (abrir o mês, as chaves) e a releitura — puro.
 *
 * A RESPOSTA É DO CLIENTE E DO MÊS DO PEDIDO — revisão pós-F43. Clicar
 * "Planejamento OK" em outubro e trocar de mês pelas setas antes da resposta:
 * o efeito do painel limpava a recusa ao trocar, e a resposta de outubro
 * chegava DEPOIS e pintava "Só um administrador…" no painel de novembro, sobre
 * um mês em que ninguém clicou nada. Agora, se a tela já não está no cliente e
 * no mês do pedido (`aindaAqui`), a recusa não entra. É a regra da gravação de
 * `@/ui/vez`: o banco já tem a escrita; o que se impede é a resposta dela
 * cair noutra tela.
 *
 * A LISTA DE TRÁS NÃO FICA PARA TRÁS — revisão do planejamento (09/10/2026).
 * O que NÃO se impede é a releitura: com a escrita feita e o painel fechado (ou
 * em outro cliente), ninguém mais relia o mês, e a tabela e a faixa seguiam
 * contando o cliente como "mês não aberto" até recarregar a página.
 *
 * A ESCRITA SÓ TERMINA COM O MÊS RELIDO — `reler` devolve a promessa da
 * releitura, e ela é esperada: é o que segura o `ocupado` do painel até os
 * dados estarem frescos.
 */
export async function gravarNoPainel({
  gravar,
  aindaAqui,
  reler,
  recusou,
}: {
  gravar: () => Promise<unknown>;
  /** A tela ainda está no cliente e no mês do pedido? */
  aindaAqui: () => boolean;
  /** Relê o mês; a promessa termina quando ele chega. */
  reler: () => Promise<unknown> | void;
  /** A recusa, para a tela mostrar — só se ela ainda é a do pedido. */
  recusou: (erro: unknown) => void;
}): Promise<void> {
  let falha: { erro: unknown } | null = null;
  try {
    await gravar();
  } catch (erro) {
    falha = { erro };
  }
  if (!aindaAqui()) {
    // O painel que pediu já não está na tela (fechou, outro cliente, outro
    // mês), mas a ESCRITA DEU CERTO e a lista de trás (a tabela, a faixa
    // "Precisa de atenção") ainda mostra o mês de antes — "mês não aberto" de
    // um cliente cujo mês acabou de abrir. Relê sem esperar: o `reler` da
    // página lê o mês que está nela AGORA, então nenhum dado de outro mês entra
    // sob o nome deste. Na recusa não há nada novo no banco, e não se relê.
    if (falha === null) void reler();
    return;
  }
  // A recusa aparece e o mês é relido mesmo assim: ela pode ter vindo de um
  // estado que mudou noutra tela.
  if (falha !== null) recusou(falha.erro);
  await reler();
}

