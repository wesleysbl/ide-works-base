/**
 * O PLANO DA FAXINA — F38, Fase 8. Puro: recebe as tarefas já lidas e decide.
 *
 * Três decisões moram aqui, e as três scripts as usam:
 *   · `planejarPreenchimento` — quais tarefas só têm o cliente na lista e podem
 *     recebê-lo, e quais ficam de fora porque o título aponta OUTRO cliente;
 *   · `linhasDaPlanilha` — quem entra na planilha do atendimento;
 *   · `validarPlanilha` — o que fazer com cada linha da planilha devolvida.
 *
 * A ÁRVORE É UMA UNIDADE. O `task_parent_guard` exige que subtarefa tenha o mesmo
 * cliente da mãe, e recusa trocar o cliente de uma mãe que tem filhas. Por isso
 * mãe e filhas (arquivadas inclusive — o guarda conta todas) são decididas e
 * gravadas juntas, com o cliente da RAIZ.
 */

import { type ClienteRef, type Sugestao, normalizar, semSinalDeCancelado, sugerirCliente } from './sugestao';

export type TarefaLida = {
  id: string;
  parentId: string | null;
  clientId: string | null;
  listId: string | null;
  title: string;
  archived: boolean;
  createdAt: string | null;
  completedAt: string | null;
  status: string | null;
  listName: string | null;
  folderName: string | null;
  listClientId: string | null;
  listRequiresClient: boolean;
};

/**
 * As quatro listas compartilhadas que a migration `20261007100000` marca com
 * "exige cliente" (ATENDIMENTO, ESTÚDIO, Estúdio Ide, Jobs Antonelli). Enquanto
 * a marca não foi aplicada, o banco ainda diz `false`; a faxina já as trata
 * como exigentes, para não deixar passar "interna" numa lista que vai exigir.
 */
export const LISTAS_COMPARTILHADAS = new Set([
  'aaaa0001-0000-4000-8000-000000000001',
  'aaaa0001-0000-4000-8000-000000000002',
  'aaaa0001-0000-4000-8000-000000000003',
  'aaaa0001-0000-4000-8000-000000000004',
]);

/** A lista exige cliente: marcada no banco, ou uma das quatro compartilhadas sem cliente. */
export function listaExigeCliente(t: Pick<TarefaLida, 'listId' | 'listClientId' | 'listRequiresClient'>): boolean {
  if (t.listClientId !== null) return false;
  return t.listRequiresClient || (t.listId !== null && LISTAS_COMPARTILHADAS.has(t.listId));
}

export type Arvores = {
  porId: Map<string, TarefaLida>;
  filhasDe: Map<string, TarefaLida[]>;
  raizDe: (id: string) => TarefaLida;
  /** A raiz e toda a descendência, arquivadas inclusive. */
  noDaArvore: (raizId: string) => TarefaLida[];
};

export function montarArvores(tarefas: readonly TarefaLida[]): Arvores {
  const porId = new Map(tarefas.map((t) => [t.id, t]));
  const filhasDe = new Map<string, TarefaLida[]>();
  for (const t of tarefas) {
    if (t.parentId === null) continue;
    const lista = filhasDe.get(t.parentId) ?? [];
    lista.push(t);
    filhasDe.set(t.parentId, lista);
  }
  const raizDe = (id: string): TarefaLida => {
    let atual = porId.get(id);
    if (!atual) throw new Error(`tarefa ${id} fora do conjunto lido`);
    for (let passo = 0; atual.parentId !== null && passo < 500; passo += 1) {
      const pai = porId.get(atual.parentId);
      if (!pai) break;
      atual = pai;
    }
    return atual;
  };
  const noDaArvore = (raizId: string): TarefaLida[] => {
    const raiz = porId.get(raizId);
    if (!raiz) return [];
    const saida: TarefaLida[] = [];
    const pilha = [raiz];
    while (pilha.length > 0) {
      const t = pilha.pop() as TarefaLida;
      saida.push(t);
      pilha.push(...(filhasDe.get(t.id) ?? []));
    }
    return saida;
  };
  return { porId, filhasDe, raizDe, noDaArvore };
}

/** Sem cliente na tarefa e na lista. */
export const semClienteEfetivo = (t: TarefaLida): boolean => t.clientId === null && t.listClientId === null;

/** Só tem o cliente na lista. */
export const soClienteNaLista = (t: TarefaLida): boolean => t.clientId === null && t.listClientId !== null;

export type ArvoreAGravar = {
  raizId: string;
  clienteId: string;
  /** Todas as tarefas da árvore que estão sem cliente e ganham o cliente. */
  aGravar: TarefaLida[];
  /** A árvore inteira, para destacar e reanexar as filhas. */
  todas: TarefaLida[];
};

export type Excluida = {
  tarefa: TarefaLida;
  sugestao: Sugestao;
  clienteDaLista: ClienteRef | null;
};

export type PlanoDePreenchimento = {
  arvores: ArvoreAGravar[];
  excluidas: Excluida[];
  contagem: {
    aGravar: number;
    naoArquivadasAGravar: number;
    maes: number;
    filhas: number;
    excluidas: number;
  };
};

/**
 * Quem recebe o cliente da lista. Entram as tarefas NÃO arquivadas sem cliente
 * numa lista com cliente. A ÁRVORE sai inteira (vai para a planilha) quando o
 * título de alguma tarefa dela aponta outro cliente que não o da lista, em grau
 * "exato" ou "parecido".
 */
export function planejarPreenchimento(tarefas: readonly TarefaLida[], clientes: readonly ClienteRef[]): PlanoDePreenchimento {
  const arv = montarArvores(tarefas);
  const porCliente = new Map(clientes.map((c) => [c.id, c]));

  const candidatas = tarefas.filter((t) => !t.archived && soClienteNaLista(t));
  const raizes = new Map<string, TarefaLida[]>();
  for (const t of candidatas) {
    const raiz = arv.raizDe(t.id);
    const lista = raizes.get(raiz.id) ?? [];
    lista.push(t);
    raizes.set(raiz.id, lista);
  }

  const arvores: ArvoreAGravar[] = [];
  const excluidas: Excluida[] = [];
  for (const [raizId, membros] of raizes) {
    const raiz = arv.porId.get(raizId) as TarefaLida;
    const clienteId = raiz.clientId ?? raiz.listClientId;
    if (clienteId === null) continue;

    let desvio: Excluida | null = null;
    for (const m of membros) {
      const s = sugerirCliente(m.title, clientes);
      if (s.grau !== 'nenhum' && s.cliente && s.cliente.id !== clienteId) {
        desvio = { tarefa: m, sugestao: s, clienteDaLista: porCliente.get(clienteId) ?? null };
        break;
      }
    }
    if (desvio) {
      for (const m of membros) {
        excluidas.push({ ...desvio, tarefa: m, sugestao: m === desvio.tarefa ? desvio.sugestao : sugerirCliente(m.title, clientes) });
      }
      continue;
    }

    const todas = arv.noDaArvore(raizId);
    arvores.push({ raizId, clienteId, aGravar: todas.filter((t) => t.clientId === null), todas });
  }

  const gravadas = arvores.flatMap((a) => a.aGravar);
  const naoArq = gravadas.filter((t) => !t.archived);
  return {
    arvores,
    excluidas,
    contagem: {
      aGravar: gravadas.length,
      naoArquivadasAGravar: naoArq.length,
      maes: naoArq.filter((t) => t.parentId === null && (arv.filhasDe.get(t.id)?.length ?? 0) > 0).length,
      filhas: naoArq.filter((t) => t.parentId !== null).length,
      excluidas: excluidas.length,
    },
  };
}

export type LinhaDaPlanilha = {
  tarefa: TarefaLida;
  clienteDaLista: ClienteRef | null;
  sugestao: Sugestao;
  /** "sem cliente" ou "o título aponta outro cliente que não o da lista". */
  origem: 'sem-cliente' | 'outro-cliente';
};

/** Não arquivadas sem cliente em lugar nenhum, mais as excluídas do preenchimento. */
export function linhasDaPlanilha(
  tarefas: readonly TarefaLida[],
  clientes: readonly ClienteRef[],
  excluidas: readonly Excluida[],
): LinhaDaPlanilha[] {
  const porCliente = new Map(clientes.map((c) => [c.id, c]));
  const linhas: LinhaDaPlanilha[] = [];
  for (const t of tarefas) {
    if (t.archived || !semClienteEfetivo(t)) continue;
    linhas.push({ tarefa: t, clienteDaLista: null, sugestao: sugerirCliente(t.title, clientes), origem: 'sem-cliente' });
  }
  for (const e of excluidas) {
    linhas.push({
      tarefa: e.tarefa,
      clienteDaLista: e.tarefa.listClientId ? (porCliente.get(e.tarefa.listClientId) ?? null) : null,
      sugestao: sugerirCliente(e.tarefa.title, clientes),
      origem: 'outro-cliente',
    });
  }
  return linhas.sort((a, b) => (a.tarefa.createdAt ?? '').localeCompare(b.tarefa.createdAt ?? ''));
}

/* ─────────────────────── a planilha devolvida ─────────────────────── */

export type LinhaLida = {
  /** Número da linha no arquivo (cabeçalho é a 1), para apontar o erro. */
  numero: number;
  tarefa: string;
  confirmado: string;
  interna: string;
};

export type ResultadoDaLinha = {
  numero: number;
  tarefa: string;
  acao: 'gravar' | 'interna' | 'nada' | 'recusada';
  clienteId?: string;
  clienteNome?: string;
  /** Cliente cancelado: grava, mas o relatório avisa. */
  cancelado?: boolean;
  /** O cliente escolhido não é o da lista da tarefa. */
  diferenteDaLista?: boolean;
  motivo?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SIM = new Set(['s', 'sim', 'x', '1', 'true', 'verdadeiro', 'yes', 'y']);
export const marcouInterna = (v: string): boolean => SIM.has(normalizar(v));

export type ResolucaoDeCliente = { ok: true; cliente: ClienteRef } | { ok: false; motivo: string };

/** Por id, ou por nome exato normalizado (com o sinal "(cancelado)" tolerado). Sem chute. */
export function resolverCliente(texto: string, clientes: readonly ClienteRef[]): ResolucaoDeCliente {
  const bruto = texto.trim();
  if (UUID.test(bruto)) {
    const c = clientes.find((x) => x.id.toLowerCase() === bruto.toLowerCase());
    return c ? { ok: true, cliente: c } : { ok: false, motivo: `cliente desconhecido: o id "${bruto}" não existe` };
  }
  const n = normalizar(semSinalDeCancelado(bruto));
  if (n === '') return { ok: false, motivo: 'cliente confirmado vazio' };
  const iguais = clientes.filter((c) => normalizar(c.name) === n);
  if (iguais.length === 1) return { ok: true, cliente: iguais[0] as ClienteRef };
  if (iguais.length > 1) {
    return { ok: false, motivo: `cliente ambíguo: "${bruto}" é o nome de ${iguais.length} clientes (${iguais.map((c) => c.id.slice(0, 8)).join(', ')}); escreva o id` };
  }
  return { ok: false, motivo: `cliente desconhecido: "${bruto}" não é o nome exato de nenhum cliente` };
}

/**
 * Valida cada linha e a árvore dela. Nada de chute: linha duvidosa é recusada com
 * o motivo. `tarefas` traz o que está no banco AGORA (todas, arquivadas inclusive,
 * para a árvore).
 */
export function validarPlanilha(
  linhas: readonly LinhaLida[],
  tarefas: readonly TarefaLida[],
  clientes: readonly ClienteRef[],
): { resultados: ResultadoDaLinha[]; arvores: ArvoreAGravar[] } {
  const arv = montarArvores(tarefas);
  const porCliente = new Map(clientes.map((c) => [c.id, c]));
  const vistas = new Set<string>();

  const resultados: ResultadoDaLinha[] = linhas.map((l) => {
    const base = { numero: l.numero, tarefa: l.tarefa.trim() };
    const recusa = (motivo: string): ResultadoDaLinha => ({ ...base, acao: 'recusada', motivo });

    const confirmado = l.confirmado.trim();
    const interna = marcouInterna(l.interna);
    if (confirmado === '' && !interna) return { ...base, acao: 'nada' };

    if (!UUID.test(base.tarefa)) return recusa(`id de tarefa inválido: "${base.tarefa}"`);
    const t = arv.porId.get(base.tarefa);
    if (!t) return recusa('tarefa não encontrada no banco');
    if (vistas.has(t.id)) return recusa('linha repetida: a tarefa já apareceu acima');
    vistas.add(t.id);
    if (t.archived) return recusa('a tarefa está arquivada');
    if (t.clientId !== null) {
      return recusa(`a tarefa já tem cliente (${porCliente.get(t.clientId)?.name ?? t.clientId}); a faxina não troca cliente`);
    }
    if (confirmado !== '' && interna) return recusa('linha com cliente confirmado E marcada como interna: escolha uma');

    if (interna) {
      if (listaExigeCliente(t)) {
        return recusa(`a lista "${t.listName ?? ''}" exige cliente: não pode ficar interna, escolha o cliente`);
      }
      return { ...base, acao: 'interna' };
    }

    const r = resolverCliente(confirmado, clientes);
    if (!r.ok) return recusa(r.motivo);
    return {
      ...base,
      acao: 'gravar',
      clienteId: r.cliente.id,
      clienteNome: r.cliente.name,
      cancelado: !r.cliente.isActive,
      diferenteDaLista: t.listClientId !== null && t.listClientId !== r.cliente.id,
    };
  });

  // A ÁRVORE: mãe e filhas têm o mesmo cliente, ou nenhuma é gravada.
  const porRaiz = new Map<string, ResultadoDaLinha[]>();
  for (const r of resultados) {
    if (r.acao !== 'gravar' && r.acao !== 'interna') continue;
    const raiz = arv.raizDe(r.tarefa);
    porRaiz.set(raiz.id, [...(porRaiz.get(raiz.id) ?? []), r]);
  }

  const arvores: ArvoreAGravar[] = [];
  for (const [raizId, rs] of porRaiz) {
    const raiz = arv.porId.get(raizId) as TarefaLida;
    const gravar = rs.filter((r) => r.acao === 'gravar');
    if (gravar.length === 0) continue;
    const recusarTodas = (motivo: string) => {
      for (const r of gravar) {
        r.acao = 'recusada';
        r.motivo = motivo;
      }
    };
    if (rs.some((r) => r.acao === 'interna')) {
      recusarTodas('mãe e subtarefas andam juntas: outra tarefa desta árvore está marcada como interna');
      continue;
    }
    const distintos = new Set(gravar.map((r) => r.clienteId));
    if (distintos.size > 1) {
      recusarTodas('mãe e subtarefas andam juntas: a planilha confirma clientes diferentes para tarefas da mesma árvore');
      continue;
    }
    const clienteId = gravar[0]?.clienteId as string;
    if (raiz.clientId !== null && raiz.clientId !== clienteId) {
      recusarTodas(`a tarefa-mãe já tem o cliente ${porCliente.get(raiz.clientId)?.name ?? raiz.clientId}; a subtarefa herda o da mãe`);
      continue;
    }
    const todas = arv.noDaArvore(raizId);
    arvores.push({ raizId, clienteId, aGravar: todas.filter((t) => t.clientId === null), todas });
  }
  return { resultados, arvores };
}
