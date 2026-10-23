/**
 * O QUE A TELA DE CONEXÕES ESCREVE SOBRE CADA PERMISSÃO E CADA ESCRITA — F26.4.
 *
 * Mora fora de `pages/Conexoes.tsx` para a suíte conseguir ler: a tela só
 * desenha a lista depois de carregar (um `useEffect`), e o teste desenha no
 * servidor, onde nenhum efeito roda.
 *
 * ⚠️ O tipo da permissão vem de `@/integrations/grants` só como TIPO. Aquele
 * módulo importa `@/server/db`; um `import` de valor puxaria o servidor para o
 * pacote do navegador. O `import type` some na compilação.
 *
 * As operações são as do banco (checagem `integration_executions_operation_sane`,
 * migration F26.1), não as de `AGENT_WRITE_OPERATIONS` em `executions.ts`: lá
 * estão só as que o servidor JÁ executa, e acrescentar ali abriria caminhos de
 * escrita que as Fases 5 e 6 ainda vão construir. A tela só LÊ o registro, então
 * basta saber dar nome ao que pode aparecer nele.
 */

import type { IntegrationCapability } from '@/integrations/grants';
import { dataCurtaDoInstante } from '@/ui/grade-do-mes';

/**
 * Selo curto de cada permissão no cartão da conexão. Leitura é substantivo (o
 * que o agente vê); escrita é verbo (o que ele faz). O `Record` completo faz o
 * typecheck quebrar se uma permissão nova chegar sem rótulo.
 */
export const ROTULO_DA_CAPACIDADE: Record<IntegrationCapability, string> = {
  'boards:read': 'quadros',
  'tasks:read': 'tarefas',
  'clients:read': 'clientes',
  'people:read': 'pessoas',
  'comments:read': 'conversa',
  'reports:delivery:read': 'entrega',
  'reports:marketing:read': 'Meta',
  'comments:write': 'comentar',
  'tasks:move': 'mover',
  'tasks:write': 'criar e editar tarefas',
  'tasks:assign': 'definir responsáveis',
  'tasks:complete': 'concluir e reabrir',
  'clients:mural:write': 'escrever no mural',
  'clients:history:write': 'registrar no histórico',
};

export function rotuloDaCapacidade(cap: string): string {
  return (ROTULO_DA_CAPACIDADE as Record<string, string>)[cap] ?? cap;
}

/** As onze operações que o registro da integração aceita (F26.1). */
export const OPERACOES_DO_AGENTE = [
  'add_comment',
  'move_task',
  'create_task',
  'update_task',
  'assign_task',
  'complete_task',
  'reopen_task',
  'add_mural_note',
  'update_mural_note',
  'add_history_entry',
  'update_history_entry',
] as const;

export type OperacaoDoAgente = (typeof OPERACOES_DO_AGENTE)[number];

/**
 * O que o "Desfazer escritas" faz com cada operação — a decisão 3 do plano F26:
 * criação volta (tarefa arquivada; comentário, nota e registro apagados) e as
 * mudanças pequenas voltam ao valor anterior; texto editado e movimento não.
 */
export type Desfaz = 'volta' | 'em-parte' | 'nao-volta';

type Operacao = {
  /** Selo da linha no histórico de execuções. */
  rotulo: string;
  /** "3 comentário(s)" no resumo do cartão. */
  contagem: (n: number) => string;
  desfaz: Desfaz;
};

export const OPERACAO: Record<OperacaoDoAgente, Operacao> = {
  add_comment: { rotulo: 'comentário', contagem: (n) => `${n} comentário(s)`, desfaz: 'volta' },
  move_task: { rotulo: 'movimento', contagem: (n) => `${n} movimento(s)`, desfaz: 'nao-volta' },
  create_task: { rotulo: 'tarefa criada', contagem: (n) => `${n} tarefa(s) criada(s)`, desfaz: 'volta' },
  update_task: { rotulo: 'tarefa editada', contagem: (n) => `${n} tarefa(s) editada(s)`, desfaz: 'em-parte' },
  assign_task: {
    rotulo: 'responsáveis definidos',
    contagem: (n) => `${n} troca(s) de responsáveis`,
    desfaz: 'volta',
  },
  complete_task: { rotulo: 'tarefa concluída', contagem: (n) => `${n} tarefa(s) concluída(s)`, desfaz: 'volta' },
  reopen_task: { rotulo: 'tarefa reaberta', contagem: (n) => `${n} tarefa(s) reaberta(s)`, desfaz: 'volta' },
  add_mural_note: { rotulo: 'nota no mural', contagem: (n) => `${n} nota(s) no mural`, desfaz: 'volta' },
  update_mural_note: {
    rotulo: 'nota do mural editada',
    contagem: (n) => `${n} nota(s) do mural editada(s)`,
    desfaz: 'nao-volta',
  },
  add_history_entry: {
    rotulo: 'registro no histórico',
    contagem: (n) => `${n} registro(s) no histórico`,
    desfaz: 'volta',
  },
  update_history_entry: {
    rotulo: 'registro do histórico editado',
    contagem: (n) => `${n} registro(s) do histórico editado(s)`,
    desfaz: 'nao-volta',
  },
};

function operacaoConhecida(op: string): op is OperacaoDoAgente {
  return (OPERACOES_DO_AGENTE as readonly string[]).includes(op);
}

/** Operação que a tela ainda não conhece aparece pelo nome técnico, sem sumir. */
export function rotuloDaOperacao(op: string): string {
  return operacaoConhecida(op) ? OPERACAO[op].rotulo : op;
}

/**
 * A etiqueta que a linha do histórico mostra quando o desfazer NÃO devolve
 * tudo. Operação que volta inteira não leva etiqueta: a lista fica limpa, e o
 * aviso aparece só onde há perda.
 */
export function notaDoDesfazer(op: string): { texto: string; explica: string } | null {
  if (!operacaoConhecida(op)) return null;
  const desfaz = OPERACAO[op].desfaz;
  if (desfaz === 'nao-volta') {
    return {
      texto: 'não se desfaz',
      explica:
        op === 'move_task'
          ? 'O movimento do card não é revertido pelo "Desfazer escritas".'
          : 'Texto editado não volta pelo "Desfazer escritas": a versão anterior não fica guardada.',
    };
  }
  if (desfaz === 'em-parte') {
    return {
      texto: 'texto não se desfaz',
      explica:
        'Responsáveis, prazo, início, prioridade e etiquetas voltam ao valor anterior; título e descrição editados não voltam.',
    };
  }
  return null;
}

type ExecucaoResumida = { grantId: string; operation: string; occurredAt: string; undoneAt: string | null };

/** O que esta conexão já fez, lido do mesmo registro que a lista da tela mostra. */
export function feitoAteAgora(grantId: string, execucoes: readonly ExecucaoResumida[]): string {
  const minhas = execucoes.filter((e) => e.grantId === grantId);
  if (minhas.length === 0) return 'Nada escrito por esta conexão ainda.';
  const desfeitas = minhas.filter((e) => e.undoneAt).length;
  const partes: string[] = [];
  for (const op of OPERACOES_DO_AGENTE) {
    const n = minhas.filter((e) => e.operation === op).length;
    if (n > 0) partes.push(OPERACAO[op].contagem(n));
  }
  const outras = minhas.filter((e) => !operacaoConhecida(e.operation)).length;
  if (outras > 0) partes.push(`${outras} outra(s) escrita(s)`);
  const ultima = dataCurtaDoInstante(minhas[0].occurredAt);
  return (
    `Já fez: ${partes.join(' · ')} — a última em ${ultima}.` +
    (desfeitas > 0 ? ` ${desfeitas} já desfeita(s).` : '')
  );
}

/**
 * A confirmação do "Desfazer escritas": diz ANTES o que some, o que volta e o
 * que fica. Segue a decisão 3 do plano F26, que o servidor cumpre desde a
 * F26.8 (`integrations/undo.ts`).
 */
export function confirmacaoDoDesfazer(nome: string, feitas: number): string {
  return (
    `Desfazer as escritas de «${nome}»?\n\n` +
    `Os comentários publicados por esta conexão serão APAGADOS da conversa — ` +
    `${feitas} aparece(m) na lista abaixo. Isso não tem volta.\n\n` +
    'Também voltam: tarefa criada é arquivada; nota do mural e registro do histórico ' +
    'criados são apagados; responsáveis, prazo, início, prioridade, etiquetas e ' +
    'conclusão voltam ao valor anterior. O que uma pessoa já mudou depois fica como está.\n\n' +
    'NÃO voltam: texto editado (título, descrição, nota do mural, registro do histórico) ' +
    'e movimento de card.\n\n' +
    'O registro de que existiram permanece, marcado como desfeito. Comentário ' +
    'que você não pode apagar fica de pé e é reportado.'
  );
}

/* ─────────────────────── o resultado do desfazer — F26.8 ─────────────────────── */

/** Um item da resposta do desfazer, só com o que a tela usa (`UndoItem`, integrations/undo.ts). */
export type ItemDoDesfazer = {
  operation: string;
  status: 'undone' | 'already_gone' | 'skipped' | 'not_undoable';
  message: string;
  textNotUndone?: string[];
};

export type RespostaDoDesfazer = {
  removed: number;
  kept: number;
  items?: ItemDoDesfazer[];
};

export type ResumoDoDesfazer = {
  /** A frase de cima: o que voltou, por tipo. */
  titulo: string;
  /** O que ficou como estava, um por linha, com o motivo em português. */
  pulados: string[];
  /** O que não se desfaz por natureza (texto editado, movimento). Nulo = nada. */
  naoVoltam: string | null;
};

/** Como dizer "voltou" para cada operação — a volta, e não a escrita. */
const VOLTOU: Record<OperacaoDoAgente, (n: number) => string> = {
  add_comment: (n) => `${n} comentário(s) apagado(s)`,
  move_task: (n) => `${n} movimento(s) desfeito(s)`,
  create_task: (n) => `${n} tarefa(s) arquivada(s)`,
  update_task: (n) => `${n} edição(ões) de tarefa desfeita(s)`,
  assign_task: (n) => `${n} troca(s) de responsáveis desfeita(s)`,
  complete_task: (n) => `${n} tarefa(s) reaberta(s)`,
  reopen_task: (n) => `${n} tarefa(s) concluída(s) de novo`,
  add_mural_note: (n) => `${n} nota(s) apagada(s) do mural`,
  update_mural_note: (n) => `${n} edição(ões) de nota desfeita(s)`,
  add_history_entry: (n) => `${n} registro(s) apagado(s) do histórico`,
  update_history_entry: (n) => `${n} edição(ões) de registro desfeita(s)`,
};

/**
 * O que a tela escreve depois do "Desfazer escritas": o que voltou por tipo,
 * o que ficou (com o motivo que o servidor deu), e o que não se desfaz.
 *
 * A frase de cada pulado é a do SERVIDOR — "uma pessoa mudou o prazo depois" —
 * precedida do rótulo da operação, para a pessoa saber de qual escrita se trata.
 * Resposta antiga (sem `items`) cai no texto de antes, só de comentários.
 */
export function resumoDoDesfazer(r: RespostaDoDesfazer): ResumoDoDesfazer {
  if (!r.items) {
    return {
      titulo:
        `Desfeito: ${r.removed} comentário(s) apagado(s)` +
        (r.kept > 0 ? `, ${r.kept} ficaram de pé (sem permissão para apagar).` : '.'),
      pulados: [],
      naoVoltam: null,
    };
  }

  const voltaram: string[] = [];
  for (const op of OPERACOES_DO_AGENTE) {
    const n = r.items.filter((i) => i.operation === op && i.status === 'undone').length;
    if (n > 0) voltaram.push(VOLTOU[op](n));
  }
  const outras = r.items.filter((i) => i.status === 'undone' && !operacaoConhecida(i.operation)).length;
  if (outras > 0) voltaram.push(`${outras} outra(s) escrita(s) desfeita(s)`);
  const idos = r.items.filter((i) => i.status === 'already_gone').length;
  if (idos > 0) voltaram.push(`${idos} já tinha(m) sido apagada(s) ou arquivada(s) antes`);

  const titulo =
    voltaram.length > 0 ? `Desfeito: ${voltaram.join(', ')}.` : 'Nada voltou: não havia o que desfazer nesta conexão.';

  const pulados = r.items
    .filter((i) => i.status === 'skipped')
    .map((i) => `${capitalizado(rotuloDaOperacao(i.operation))} — ${i.message}`);

  const partes: string[] = [];
  for (const op of OPERACOES_DO_AGENTE) {
    const n = r.items.filter((i) => i.operation === op && i.status === 'not_undoable').length;
    if (n > 0) partes.push(OPERACAO[op].contagem(n));
  }
  const textoFicou = r.items.filter((i) => i.status === 'undone' && (i.textNotUndone?.length ?? 0) > 0).length;
  if (textoFicou > 0) partes.push(`o texto de ${textoFicou} tarefa(s) editada(s)`);
  const naoVoltam =
    partes.length > 0
      ? `Não se desfaz: ${partes.join(' · ')} — texto editado e movimento de card continuam como a IA deixou.`
      : null;

  return { titulo, pulados, naoVoltam };
}

function capitalizado(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/* ── F44, Fase 9: o aviso das conexões autorizadas antes de 09/10 ───────────── */

/**
 * Em 09/10/2026 "ler clientes" passou a mostrar também plano, renovação, cota e
 * etiquetas. Quem autorizou uma conexão antes disso concedeu "ler clientes"
 * pelo que ele mostrava então: as permissões não mudaram, o que a mesma
 * permissão revela, sim. UM aviso na tela (não um por conexão), listando quais
 * são; dispensável, e a decisão fica só neste navegador.
 */
export const CORTE_DO_LER_CLIENTES = '2026-10-09T00:00:00-03:00';

const CHAVE_DO_AVISO_DISPENSADO = 'ideworks.conexoes-antigas.dispensado';

type ConexaoParaOAviso = {
  id: string;
  name: string;
  /** Quando a pessoa autorizou. Nulo/ausente = o servidor não disse: não acusa. */
  authorizedAt?: string | null;
  revokedAt: string | null;
  live: boolean;
};

/** As conexões vivas autorizadas antes do corte. Sem data, não entra. */
export function conexoesAnterioresAoCorte<T extends ConexaoParaOAviso>(conexoes: readonly T[]): T[] {
  const corte = Date.parse(CORTE_DO_LER_CLIENTES);
  return conexoes.filter((c) => {
    if (c.revokedAt || !c.live || !c.authorizedAt) return false;
    const quando = Date.parse(c.authorizedAt);
    return Number.isFinite(quando) && quando < corte;
  });
}

export function avisoDasConexoesAntigasDispensado(): boolean {
  try {
    return window.localStorage.getItem(CHAVE_DO_AVISO_DISPENSADO) === '1';
  } catch {
    return false;
  }
}

export function dispensarAvisoDasConexoesAntigas(): void {
  try {
    window.localStorage.setItem(CHAVE_DO_AVISO_DISPENSADO, '1');
  } catch {
    /* sem armazenamento: o aviso volta na próxima visita, e tudo bem */
  }
}

