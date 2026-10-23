/**
 * LISTA | KANBAN DO ESCOPO — as decisões puras. Etapa F18B (revisão de 28/09,
 * R09: "escolher Lista ou Kanban em todas as visões de trabalho").
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE MORA AQUI
 *   Tudo o que a tela decide e que dá para provar sem navegador: qual modo vale
 *   (endereço › preferência desta tela › preferência do tipo de tela › padrão),
 *   como as linhas se agrupam, como o Kanban se divide em FAIXAS POR FLUXO, qual
 *   destino de etapa é válido para um cartão, e a frase do alcance.
 *
 * ⚠️ UMA ETAPA É UM ID, NUNCA UM NOME
 *   Um espaço junta dezenas de fluxos (a AGÊNCIA IDE real: 33 fluxos, 422
 *   etapas, 13 nomes). `A fazer` do fluxo de vídeo e `A fazer` do fluxo de
 *   arte são DUAS etapas — cada uma com a sua ordem, cor e regra de conclusão.
 *   O Kanban daqui desenha uma faixa por fluxo com as etapas reais dele, e o
 *   cartão só anda dentro da faixa dele. Mover para um fluxo que não é o da
 *   lista da tarefa é recusado antes de ir ao banco — nada de conversão
 *   silenciosa.
 *
 * ⚠️ A CONTAGEM É DO RECORTE, E O LOTE É OUTRA COISA
 *   `counts` vem do banco sobre o recorte inteiro; `linhas` é o que já chegou.
 *   A frase do alcance diz os dois ("12 de 122 abertas carregadas") e nunca
 *   compara o total histórico do panorama com um lote.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  type CatalogoDoEscopo,
  type ContagensDoEscopo,
  type EtapaDoFluxo,
  type FiltroDoEscopo,
  type FluxoDoEscopo,
  type LinhaDoEscopo,
  type Prazo,
  SEM_PASTA,
} from '@/board/tarefas-do-escopo';

/** Os rótulos do menu `Prazo`. */
export const ROTULO_DO_PRAZO: Record<Prazo, string> = {
  atrasado: 'Atrasadas',
  hoje: 'Para hoje',
  semana: 'Próximos 7 dias',
  sem: 'Sem prazo',
};

/* ───────────────────────────── o modo ───────────────────────────── */

export type Modo = 'panorama' | 'lista' | 'kanban';

/**
 * Onde o seletor aparece. Cada um guarda a sua escolha. F18C: `checklist` e
 * `conteudos` são as duas listas operacionais da ficha do cliente — com as
 * colunas dos ESTADOS que o modelo delas tem (ver `@/clients/QuadroDeEstados`),
 * nunca etapas inventadas.
 */
export type ContextoDoModo = 'espaco' | 'pasta' | 'lista' | 'pessoal' | 'global' | 'checklist' | 'conteudos';

export const MODOS_DO_CONTEXTO: Record<ContextoDoModo, readonly Modo[]> = {
  espaco: ['panorama', 'lista', 'kanban'],
  pasta: ['lista', 'kanban'],
  lista: ['lista', 'kanban'],
  pessoal: ['lista', 'kanban'],
  global: ['lista', 'kanban'],
  checklist: ['lista', 'kanban'],
  conteudos: ['lista', 'kanban'],
};

/**
 * O padrão de cada contexto — o que vale sem endereço nem preferência, e o que
 * NÃO se escreve no endereço. No espaço, o panorama que já existia; na pasta e
 * na lista, o quadro que elas sempre abriram; nas telas da pessoa, a lista.
 */
export const MODO_PADRAO: Record<ContextoDoModo, Modo> = {
  espaco: 'panorama',
  pasta: 'kanban',
  lista: 'kanban',
  pessoal: 'lista',
  global: 'lista',
  checklist: 'lista',
  conteudos: 'lista',
};

export const ROTULO_DO_MODO: Record<Modo, string> = {
  panorama: 'Panorama',
  lista: 'Lista',
  kanban: 'Kanban',
};

/** O parâmetro do endereço — o mesmo `ver` de `Todas as tarefas`. */
export const PARAMETRO_DO_MODO = 'ver';

/**
 * O modo, se `cru` for um modo que ESTE contexto oferece. Tolerante.
 *
 * `quadro` é o nome antigo do Kanban em `Minhas tarefas` e `Todas as tarefas`
 * (F17.79: `/meu-trabalho?ver=quadro`). Endereço colado em comentário antes da
 * F18C continua abrindo no Kanban.
 */
export function modoValido(cru: unknown, contexto: ContextoDoModo): Modo | null {
  if (typeof cru !== 'string') return null;
  const minusculo = cru.trim().toLowerCase();
  const limpo = minusculo === 'quadro' ? 'kanban' : minusculo;
  return (MODOS_DO_CONTEXTO[contexto] as readonly string[]).includes(limpo) ? (limpo as Modo) : null;
}

/** A chave da preferência: `espaco:<id>` para a tela, `espaco` para o tipo. */
export const chaveDoModo = (contexto: ContextoDoModo, id?: string | null): string =>
  id ? `${contexto}:${id}` : contexto;

/**
 * O modo que vale. Endereço (colado, VOLTAR) manda; depois a escolha feita
 * NESTA tela; depois a última escolha neste TIPO de tela (quem sempre usa o
 * Kanban nas pastas abre a pasta nova no Kanban); por fim o padrão.
 */
export function resolverModo({
  doEndereco,
  guardados,
  contexto,
  id,
}: {
  doEndereco: string | null;
  guardados: Readonly<Record<string, string>>;
  contexto: ContextoDoModo;
  id?: string | null;
}): Modo {
  return (
    modoValido(doEndereco, contexto) ??
    (id ? modoValido(guardados[chaveDoModo(contexto, id)], contexto) : null) ??
    modoValido(guardados[chaveDoModo(contexto)], contexto) ??
    MODO_PADRAO[contexto]
  );
}

/** Quantas telas guardam modo. As mais antigas saem primeiro. */
export const TETO_DE_MODOS = 120;

/**
 * Os modos guardados, saneados: só texto → modo conhecido, com teto. Tolerante,
 * como todo o `@/ui/lugar`: o que está no navegador pode ser qualquer coisa.
 */
export function modosValidos(v: unknown, teto = TETO_DE_MODOS): Record<string, Modo> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return {};
  const pares = Object.entries(v as Record<string, unknown>).filter(
    (par): par is [string, Modo] =>
      par[0].trim() !== '' && typeof par[1] === 'string' && (par[1] === 'panorama' || par[1] === 'lista' || par[1] === 'kanban'),
  );
  return Object.fromEntries(pares.length <= teto ? pares : pares.slice(pares.length - teto));
}

/**
 * Guardar a escolha: vale para ESTA tela e vira o padrão do tipo de tela.
 * A chave escolhida vai para o FIM (é a mais recente, e o teto corta do começo).
 */
export function lembrarModo(
  guardados: Readonly<Record<string, string>>,
  contexto: ContextoDoModo,
  id: string | null,
  modo: Modo,
): Record<string, Modo> {
  const proximos: Record<string, unknown> = { ...guardados };
  const chaves = id ? [chaveDoModo(contexto), chaveDoModo(contexto, id)] : [chaveDoModo(contexto)];
  for (const c of chaves) {
    delete proximos[c];
    proximos[c] = modo;
  }
  return modosValidos(proximos);
}

/** O que vai para `?ver=`: nada quando é o padrão do contexto. */
export const modoParaEndereco = (modo: Modo, contexto: ContextoDoModo): string =>
  modo === MODO_PADRAO[contexto] ? '' : modo;

/* ───────────────────────────── o agrupamento ───────────────────────────── */

export type Agrupamento = 'origem' | 'etapa' | 'nenhum';
export const AGRUPAMENTOS: readonly Agrupamento[] = ['origem', 'etapa', 'nenhum'] as const;
export const ROTULO_DO_AGRUPAMENTO: Record<Agrupamento, string> = {
  origem: 'Time e cliente',
  etapa: 'Etapa',
  nenhum: 'Sem grupos',
};
export const PARAMETRO_DO_AGRUPAMENTO = 'agrupar';

/**
 * Os agrupamentos que um escopo oferece e o padrão dele. F18C: na LISTA de um
 * cliente a origem é a própria tela — "Time e cliente" daria um grupo só,
 * repetindo o título —, então ali o padrão é a etapa (o que o Kanban mostra
 * em colunas) e a origem não entra no menu.
 */
export const agrupamentosDoEscopo = (escopo: 'espaco' | 'pasta' | 'lista'): readonly Agrupamento[] =>
  escopo === 'lista' ? ['etapa', 'nenhum'] : AGRUPAMENTOS;
export const agrupamentoPadrao = (escopo: 'espaco' | 'pasta' | 'lista'): Agrupamento => (escopo === 'lista' ? 'etapa' : 'origem');

export const agrupamentoValido = (cru: string | null, escopo: 'espaco' | 'pasta' | 'lista' = 'espaco'): Agrupamento => {
  const limpo = (cru ?? '').trim().toLowerCase();
  return (agrupamentosDoEscopo(escopo) as readonly string[]).includes(limpo) ? (limpo as Agrupamento) : agrupamentoPadrao(escopo);
};

/** O que a linha deixa de repetir porque o grupo já diz. */
export type Omissao = { origem: boolean; etapa: boolean };

export type GrupoDaLista = {
  chave: string;
  /** Nulo = sem cabeçalho (agrupamento `nenhum`). */
  titulo: string | null;
  /** A linha menor acima do título: a pasta da lista, ou o fluxo da etapa. */
  sobre: string | null;
  /** Cor da etapa, quando o grupo é uma etapa. */
  cor: string | null;
  linhas: LinhaDoEscopo[];
  /** Quantas o banco achou neste grupo, quando ele sabe (etapa). */
  achadas: number | null;
  omite: Omissao;
};

const porNome = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });

/** A origem de uma linha em palavras: "Cliente · lista", sem inventar cliente. */
export function origemDaLinha(l: Pick<LinhaDoEscopo, 'clientName' | 'listName'>): string {
  if (l.clientName && l.listName && porNome(l.clientName, l.listName) !== 0) return `${l.clientName} · ${l.listName}`;
  return l.clientName ?? l.listName ?? 'Sem lista';
}

/** O time (pasta) de uma linha, ou "Sem pasta" para as listas soltas no espaço. */
export const timeDaLinha = (l: Pick<LinhaDoEscopo, 'folderId' | 'folderName'>): string =>
  l.folderId === null ? 'Sem pasta' : l.folderName ?? 'Sem pasta';

/**
 * As linhas carregadas em grupos. A ordem DENTRO do grupo é a do servidor
 * (prazo, prioridade, título) — o grupo não reordena o que o cursor ordenou.
 */
export function agruparLinhas(
  linhas: readonly LinhaDoEscopo[],
  agrupar: Agrupamento,
  fluxos: readonly FluxoDoEscopo[] = [],
  statusCounts: Readonly<Record<string, { total: number; matched: number }>> = {},
): GrupoDaLista[] {
  if (agrupar === 'nenhum') {
    return linhas.length === 0
      ? []
      : [{ chave: 'todas', titulo: null, sobre: null, cor: null, linhas: [...linhas], achadas: null, omite: { origem: false, etapa: false } }];
  }

  if (agrupar === 'origem') {
    const grupos = new Map<string, GrupoDaLista & { ordem: [string, string] }>();
    for (const l of linhas) {
      const chave = l.listId ?? 'sem-lista';
      let g = grupos.get(chave);
      if (!g) {
        const time = timeDaLinha(l);
        g = {
          chave,
          titulo: origemDaLinha(l),
          sobre: time,
          cor: null,
          linhas: [],
          achadas: null,
          omite: { origem: true, etapa: false },
          // Listas sem pasta vão para o fim, como na árvore.
          ordem: [l.folderId === null ? '￿' : time, origemDaLinha(l)],
        };
        grupos.set(chave, g);
      }
      g.linhas.push(l);
    }
    return [...grupos.values()]
      .sort((a, b) => porNome(a.ordem[0], b.ordem[0]) || porNome(a.ordem[1], b.ordem[1]))
      .map((g) => ({ chave: g.chave, titulo: g.titulo, sobre: g.sobre, cor: g.cor, linhas: g.linhas, achadas: g.achadas, omite: g.omite }));
  }

  // Por etapa: a ordem do fluxo, e o fluxo pela ordem do catálogo.
  const posicao = new Map<string, { fluxo: FluxoDoEscopo; etapa: EtapaDoFluxo; i: number; j: number }>();
  fluxos.forEach((fluxo, i) => fluxo.etapas.forEach((etapa, j) => posicao.set(etapa.id, { fluxo, etapa, i, j })));
  const grupos = new Map<string, GrupoDaLista & { i: number; j: number }>();
  for (const l of linhas) {
    const onde = l.statusId ? posicao.get(l.statusId) : undefined;
    const chave = onde ? onde.etapa.id : 'sem-etapa';
    let g = grupos.get(chave);
    if (!g) {
      g = onde
        ? {
            chave,
            titulo: onde.etapa.name,
            sobre: fluxos.length > 1 ? onde.fluxo.name : null,
            cor: onde.etapa.color,
            linhas: [],
            achadas: statusCounts[onde.etapa.id]?.matched ?? onde.etapa.matched,
            omite: { origem: false, etapa: true },
            i: onde.i,
            j: onde.j,
          }
        : { chave, titulo: 'Sem etapa', sobre: null, cor: null, linhas: [], achadas: null, omite: { origem: false, etapa: true }, i: Infinity, j: 0 };
      grupos.set(chave, g);
    }
    g.linhas.push(l);
  }
  return [...grupos.values()]
    .sort((a, b) => a.i - b.i || a.j - b.j)
    .map((g) => ({ chave: g.chave, titulo: g.titulo, sobre: g.sobre, cor: g.cor, linhas: g.linhas, achadas: g.achadas, omite: g.omite }));
}

/* ───────────────────────────── o Kanban ───────────────────────────── */

export type ColunaDoKanban = {
  etapa: EtapaDoFluxo;
  linhas: LinhaDoEscopo[];
  /** As do recorte nesta etapa, contadas no banco. */
  achadas: number;
};

export type FaixaDoKanban = {
  fluxo: FluxoDoEscopo;
  colunas: ColunaDoKanban[];
  achadas: number;
  carregadas: number;
};

export type KanbanDoEscopo = {
  faixas: FaixaDoKanban[];
  /** Linhas cuja etapa não está no fluxo da lista delas (ou sem etapa). */
  semEtapa: LinhaDoEscopo[];
  /** Fluxos do recorte sem nenhuma tarefa achada: não ganham faixa. */
  fluxosSemTarefa: number;
};

/**
 * As faixas. Uma por FLUXO que tem tarefa no recorte; em cada uma, as etapas
 * reais do fluxo em ordem. Nada é mesclado por nome.
 *
 * O cartão cai na coluna do seu `statusId` DENTRO do fluxo da sua lista
 * (`workflowId`). Etapa que não pertence ao fluxo da lista vai para `semEtapa`
 * — é o mesmo "órfão" do quadro da pasta, dito em aviso.
 */
export function kanbanDoEscopo(
  fluxos: readonly FluxoDoEscopo[],
  linhas: readonly LinhaDoEscopo[],
  statusCounts: Readonly<Record<string, { total: number; matched: number }>> = {},
): KanbanDoEscopo {
  const porEtapa = new Map<string, LinhaDoEscopo[]>();
  const etapasDoFluxo = new Map(fluxos.map((f) => [f.id, new Set(f.etapas.map((e) => e.id))]));
  const semEtapa: LinhaDoEscopo[] = [];
  for (const l of linhas) {
    const doFluxo = l.workflowId ? etapasDoFluxo.get(l.workflowId) : undefined;
    if (!l.statusId || !doFluxo || !doFluxo.has(l.statusId)) {
      semEtapa.push(l);
      continue;
    }
    const lista = porEtapa.get(l.statusId) ?? [];
    lista.push(l);
    porEtapa.set(l.statusId, lista);
  }

  const faixas: FaixaDoKanban[] = [];
  let fluxosSemTarefa = 0;
  for (const fluxo of fluxos) {
    const colunas = fluxo.etapas.map((etapa) => ({
      etapa,
      linhas: porEtapa.get(etapa.id) ?? [],
      achadas: statusCounts[etapa.id]?.matched ?? etapa.matched,
    }));
    const achadas = colunas.reduce((s, c) => s + c.achadas, 0);
    const carregadas = colunas.reduce((s, c) => s + c.linhas.length, 0);
    if (achadas === 0 && carregadas === 0) {
      fluxosSemTarefa += 1;
      continue;
    }
    faixas.push({ fluxo, colunas, achadas, carregadas });
  }
  return { faixas, semEtapa, fluxosSemTarefa };
}

/** Por que um destino não vale — dito com o nome da lista e da etapa. */
export type Destino = { ok: true; etapa: EtapaDoFluxo } | { ok: false; motivo: string };

/**
 * Pode esta tarefa ir para esta etapa? Só se a etapa for do FLUXO da lista
 * dela. A escrita é `ideworks.move_task` com a lista da própria tarefa; o
 * banco ainda confere permissão e transição, e a tela desfaz se ele recusar.
 */
export function destinoDaEtapa(
  linha: Pick<LinhaDoEscopo, 'workflowId' | 'statusId' | 'listId' | 'listName'>,
  etapaId: string,
  fluxos: readonly FluxoDoEscopo[],
): Destino {
  if (linha.listId === null) return { ok: false, motivo: 'Esta tarefa não está em lista nenhuma; abra a ficha para escolher onde ela fica.' };
  const fluxo = fluxos.find((f) => f.etapas.some((e) => e.id === etapaId));
  const etapa = fluxo?.etapas.find((e) => e.id === etapaId);
  if (!fluxo || !etapa) return { ok: false, motivo: 'Essa etapa não está mais neste quadro. Recarregue a tela.' };
  if (fluxo.id !== linha.workflowId) {
    return {
      ok: false,
      motivo: `A lista ${linha.listName ?? 'desta tarefa'} usa outro fluxo, e “${etapa.name}” não é uma etapa dele. Mova a tarefa dentro da faixa do fluxo dela.`,
    };
  }
  return { ok: true, etapa };
}

/**
 * A etapa que FECHA no fluxo da tarefa (`demanda concluída`) — o destino do ✓.
 * `null` quando o fluxo não tem uma, ou quando a tarefa já está nela.
 */
export function etapaQueFecha(
  linha: Pick<LinhaDoEscopo, 'workflowId' | 'statusId'>,
  fluxos: readonly FluxoDoEscopo[],
): EtapaDoFluxo | null {
  const fluxo = fluxos.find((f) => f.id === linha.workflowId);
  const etapa = fluxo?.etapas.find((e) => e.type === 'closed') ?? null;
  return etapa === null || etapa.id === linha.statusId ? null : etapa;
}

/** A etapa ao lado, no MESMO fluxo — o que as setas do teclado fazem. */
export function etapaVizinha(
  linha: Pick<LinhaDoEscopo, 'workflowId' | 'statusId'>,
  fluxos: readonly FluxoDoEscopo[],
  direcao: -1 | 1,
): EtapaDoFluxo | null {
  const fluxo = fluxos.find((f) => f.id === linha.workflowId);
  if (!fluxo) return null;
  const i = fluxo.etapas.findIndex((e) => e.id === linha.statusId);
  if (i < 0) return null;
  return fluxo.etapas[i + direcao] ?? null;
}

/**
 * O cartão mudou de etapa: a linha e as contagens por etapa, na hora (o banco
 * confirma depois, e a tela relê). Devolve cópias.
 */
export function aplicarMovimento(
  linhas: readonly LinhaDoEscopo[],
  statusCounts: Readonly<Record<string, { total: number; matched: number }>>,
  taskId: string,
  etapa: Pick<EtapaDoFluxo, 'id' | 'name' | 'type' | 'color'>,
): { linhas: LinhaDoEscopo[]; statusCounts: Record<string, { total: number; matched: number }> } {
  const contas: Record<string, { total: number; matched: number }> = Object.fromEntries(
    Object.entries(statusCounts).map(([k, v]) => [k, { ...v }]),
  );
  const proximas = linhas.map((l) => {
    if (l.id !== taskId || l.statusId === etapa.id) return l;
    const de = l.statusId ? contas[l.statusId] : undefined;
    if (de) {
      de.total = Math.max(0, de.total - 1);
      de.matched = Math.max(0, de.matched - 1);
    }
    const para = (contas[etapa.id] ??= { total: 0, matched: 0 });
    para.total += 1;
    para.matched += 1;
    return { ...l, statusId: etapa.id, statusName: etapa.name, statusType: etapa.type, statusColor: etapa.color };
  });
  return { linhas: proximas, statusCounts: contas };
}

/* ───────────────────────────── o alcance ───────────────────────────── */

/** Algum filtro além de "incluir concluídas"? Concluídas é o universo, não peneira. */
export const temFiltroDoEscopo = (f: FiltroDoEscopo): boolean =>
  f.texto.trim() !== '' || f.responsavel !== null || f.pasta !== null || f.lista !== null || f.etapa !== null || f.prazo !== null;

/** Quantos filtros estão ligados — o número do botão `Filtros` no celular. */
export const quantosFiltros = (f: FiltroDoEscopo): number =>
  [f.responsavel, f.pasta, f.lista, f.etapa, f.prazo].filter((v) => v !== null).length + (f.concluidas ? 1 : 0);

const fmt = (n: number) => n.toLocaleString('pt-BR');

/**
 * A frase do alcance. `principal` é o que o resultado é; `base`, contra o que
 * ele foi contado. Sem filtro, a base é o universo ("122 abertas"); com filtro,
 * "12 de 30 encontradas", entre as 122 abertas. `de N carregadas` só quando há
 * mais no banco do que na tela.
 */
export function textoDoAlcance({
  carregadas,
  counts,
  filtro,
  hasMore,
}: {
  carregadas: number;
  counts: ContagensDoEscopo;
  filtro: FiltroDoEscopo;
  hasMore: boolean;
}): { principal: string; base: string | null } {
  const palavra = filtro.concluidas ? (counts.total === 1 ? 'tarefa' : 'tarefas') : counts.abertas === 1 ? 'aberta' : 'abertas';
  const universo = filtro.concluidas ? counts.total : counts.abertas;
  if (!temFiltroDoEscopo(filtro)) {
    return {
      principal: hasMore ? `${fmt(carregadas)} de ${fmt(universo)} ${palavra} carregadas` : `${fmt(universo)} ${palavra}`,
      base: filtro.concluidas ? null : `${fmt(counts.total)} no total, com as concluídas`,
    };
  }
  const achou = counts.matched === 1 ? 'encontrada' : 'encontradas';
  return {
    principal: hasMore ? `${fmt(carregadas)} de ${fmt(counts.matched)} ${achou} carregadas` : `${fmt(counts.matched)} ${achou}`,
    base: `entre ${fmt(universo)} ${palavra}`,
  };
}

/* ───────────────────────────── os menus ───────────────────────────── */

export type OpcaoDeMenu = { valor: string; rotulo: string };

/** As pastas do menu `Time`, e `Sem pasta` quando há lista solta. */
export function opcoesDePasta(catalogo: CatalogoDoEscopo | null): OpcaoDeMenu[] {
  if (!catalogo) return [];
  const opcoes = [...catalogo.pastas]
    .sort((a, b) => porNome(a.name, b.name))
    .map((p) => ({ valor: p.id, rotulo: p.archived ? `${p.name} (arquivada)` : p.name }));
  if (catalogo.listas.some((l) => l.folderId === null)) opcoes.push({ valor: SEM_PASTA, rotulo: 'Sem pasta' });
  return opcoes;
}

/** As listas do menu `Cliente`, só as do time escolhido. O nome é o do cliente quando visível. */
export function opcoesDeLista(catalogo: CatalogoDoEscopo | null, pasta: string | null): OpcaoDeMenu[] {
  if (!catalogo) return [];
  return catalogo.listas
    .filter((l) => pasta === null || (pasta === SEM_PASTA ? l.folderId === null : l.folderId === pasta))
    .map((l) => ({ valor: l.id, rotulo: origemDaLinha({ clientName: l.clientName, listName: l.name }) }))
    .sort((a, b) => porNome(a.rotulo, b.rotulo));
}

/**
 * As etapas do menu, AGRUPADAS POR FLUXO (é `<optgroup>`): o id real de cada
 * uma. Só as que têm alguma tarefa no escopo — um menu de 422 etapas onde 380
 * estão vazias não ajuda a achar nada.
 */
export function opcoesDeEtapa(catalogo: CatalogoDoEscopo | null): { fluxo: string; etapas: OpcaoDeMenu[] }[] {
  if (!catalogo) return [];
  return catalogo.fluxos
    .map((f) => ({
      fluxo: f.name,
      etapas: f.etapas.filter((e) => e.total > 0).map((e) => ({ valor: e.id, rotulo: e.name })),
    }))
    .filter((g) => g.etapas.length > 0);
}
