/**
 * O CONTROLE DA SEMANA, A PARTE QUE NÃO DESENHA — F40, Fase 7.
 *
 * Tudo o que a tela decide sem tocar no DOM mora aqui, para a suíte conferir
 * com dados fixos: o nome da semana, o rótulo do tipo, a frase de cada recusa,
 * quando o OK está liberado e para onde o clique do Andamento leva.
 *
 * ⚠️ OS TIPOS VÊM DO SERVIDOR (`import type`, apagado no build). A forma da
 *   resposta tem UM dono — `@/server/controle-da-semana` —, e a tela não guarda
 *   uma cópia que envelheça sozinha.
 */

import type {
  CardAtrasado,
  CardParaAtribuir,
  ControleDaSemana,
  GrupoParaAtribuir,
  LinhaDeAndamento,
  LinhaDeFalta,
  TipoDoGrupo,
} from '@/server/controle-da-semana';
import { OPCOES_DO_TIPO, type TipoDaTarefa } from '@/server/tipo-da-tarefa';

export type {
  CardAtrasado,
  CardParaAtribuir,
  ControleDaSemana,
  GrupoParaAtribuir,
  LinhaDeAndamento,
  LinhaDeFalta,
  TipoDoGrupo,
};
export { OPCOES_DO_TIPO };
export type { TipoDaTarefa };

export const ROTA_DO_CONTROLE = '/controle-da-semana';

/** A frase do OK bloqueado por falta de tipo — a mesma do servidor e do formulário. */
export const FRASE_ESCOLHA_O_TIPO = 'Escolha o tipo: Vídeo, Arte, Foto ou Outros';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const partes = (dia: string): { d: string; m: number } => ({ d: dia.slice(8, 10), m: Number(dia.slice(5, 7)) - 1 });

/**
 * "06 – 12/out" — a semana de segunda a domingo. Atravessando o mês, cada ponta
 * diz o seu: "28/set – 04/out". Sem `Date`: o fuso do navegador não decide o dia.
 */
export function rotuloDaSemana(inicio: string, fim: string): string {
  const a = partes(inicio);
  const b = partes(fim);
  if (a.m === b.m) return `${a.d} – ${b.d}/${MESES[b.m]}`;
  return `${a.d}/${MESES[a.m]} – ${b.d}/${MESES[b.m]}`;
}

/** "09/10" — o prazo curto das linhas. `null` é a lacuna que o captador deixou. */
export function prazoCurto(dia: string | null): string {
  if (dia === null) return 'Sem data';
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

/** O nome do tipo na tela. `null` é o grupo "Sem tipo". */
export function rotuloDoTipo(tipo: TipoDoGrupo | string): string {
  if (tipo === null) return 'Sem tipo';
  return OPCOES_DO_TIPO.find((o) => o.value === tipo)?.label ?? 'Sem tipo';
}

/** O parâmetro `?semana=` do endereço, só se for uma data de verdade. */
export function semanaDoEndereco(valor: string | null): string | null {
  if (valor === null || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  const [a, m, d] = valor.split('-').map(Number);
  const dia = new Date(Date.UTC(a, m - 1, d));
  const volta = dia.toISOString().slice(0, 10);
  return volta === valor ? valor : null;
}

/** O que a linha de Para atribuir tem escolhido agora. */
export type EscolhaDaLinha = {
  /** `''` = ninguém ainda. */
  pessoaId: string;
  /** AAAA-MM-DD, ou `''`. */
  prazo: string;
  /** O tipo escolhido AQUI, para o card que veio sem tipo; `''` = nenhum. */
  tipo: string;
};

/**
 * Por que o OK está parado — ou `null` quando pode ir. A frase serve de dica
 * (`title`) do botão: botão desabilitado que não diz por quê é botão quebrado.
 */
export function porQueOOkEstaParado(tipoDoGrupo: TipoDoGrupo, e: EscolhaDaLinha): string | null {
  if (tipoDoGrupo === null && e.tipo === '') return FRASE_ESCOLHA_O_TIPO;
  if (e.pessoaId === '') return 'Escolha a pessoa';
  if (e.prazo === '') return 'Escolha o prazo';
  return null;
}

/**
 * As recusas do servidor já chegam em português e acionáveis; aqui só se
 * impede que uma falha SEM frase (rede, 5xx com corpo técnico) vire texto cru.
 */
export function fraseDaFalha(mensagem: string | null | undefined, padrao: string): string {
  const m = (mensagem ?? '').trim();
  if (m === '' || m.length > 240 || /^[{[<]/.test(m) || /\b(SQLSTATE|Error:|at \S+\.(ts|js))/.test(m)) return padrao;
  return m;
}

/** As linhas do Andamento: por cliente, depois pelo tipo, "Sem tipo" no fim. */
export function ordenarAndamento(linhas: readonly LinhaDeAndamento[]): LinhaDeAndamento[] {
  const ordem = (t: TipoDoGrupo) => (t === null ? OPCOES_DO_TIPO.length : OPCOES_DO_TIPO.findIndex((o) => o.value === t));
  return [...linhas].sort(
    (a, b) => a.clientName.localeCompare(b.clientName, 'pt-BR') || ordem(a.type) - ordem(b.type),
  );
}

/** Só o que ainda falta, do cliente que mais falta para o que menos. */
export function soAsFaltas(itens: readonly LinhaDeFalta[]): LinhaDeFalta[] {
  return itens
    .filter((i) => i.missing > 0)
    .sort((a, b) => b.missing - a.missing || a.clientName.localeCompare(b.clientName, 'pt-BR'));
}

/** "Cliente X — Vídeo: 0 de 2". */
export const fraseDaFalta = (f: LinhaDeFalta): string =>
  `${f.clientName} — ${rotuloDoTipo(f.type)}: ${f.cards} de ${f.target}`;

/** Quantos cards há esperando atribuição, somando os grupos. */
export const totalParaAtribuir = (grupos: readonly GrupoParaAtribuir[]): number =>
  grupos.reduce((n, g) => n + g.cards.length, 0);

/**
 * O destino do clique numa linha do Andamento: a primeira lista viva do cliente
 * no quadro; sem lista (ou sem alcance para lê-las), a ficha do cliente.
 */
export function destinoDoCliente(clientId: string, listas: readonly { id: string; archived?: boolean }[]): string {
  const viva = listas.find((l) => !l.archived);
  return viva ? `/quadro/${viva.id}` : `/cliente/${clientId}`;
}

/* ─────────────── F41: a semana por cliente, de relance ─────────────── */

/** Os cinco números da faixa do topo. */
export type TotaisDaFaixa = {
  paraAtribuir: number;
  emAndamento: number;
  feitos: number;
  clientesEmFalta: number;
  atrasados: number;
};

/** Soma o que a faixa mostra. "Atrasados" é o total do servidor (a lista é cortada). */
export function totaisDaFaixa(d: Pick<ControleDaSemana, 'toAssign' | 'progress' | 'missing'>): TotaisDaFaixa {
  return {
    paraAtribuir: totalParaAtribuir(d.toAssign),
    emAndamento: d.progress.reduce((n, l) => n + l.doing, 0),
    feitos: d.progress.reduce((n, l) => n + l.done, 0),
    clientesEmFalta: new Set(d.missing.items.filter((i) => i.missing > 0).map((i) => i.clientId)).size,
    atrasados: d.missing.overdueTotal,
  };
}

export type TomDoCartao = 'ok' | 'warn' | 'err' | 'neutro';

export type CartaoDaFaixa = {
  id: keyof TotaisDaFaixa;
  rotulo: string;
  valor: number;
  tom: TomDoCartao;
  /** O que o tom quer dizer em palavras — a cor nunca é a única pista. */
  estado: string;
};

/** Os cinco cartões, com o tom de cada um: zero problema = verde, atenção = âmbar, falta/atraso = vermelho. */
export function cartoesDaFaixa(t: TotaisDaFaixa): CartaoDaFaixa[] {
  return [
    { id: 'paraAtribuir', rotulo: 'Para atribuir', valor: t.paraAtribuir, tom: t.paraAtribuir > 0 ? 'warn' : 'ok', estado: t.paraAtribuir > 0 ? 'atenção' : 'em dia' },
    { id: 'emAndamento', rotulo: 'Em andamento', valor: t.emAndamento, tom: 'neutro', estado: 'produção' },
    { id: 'feitos', rotulo: 'Feitos', valor: t.feitos, tom: t.feitos > 0 ? 'ok' : 'neutro', estado: t.feitos > 0 ? 'entregues' : 'nenhum ainda' },
    { id: 'clientesEmFalta', rotulo: 'Clientes em falta', valor: t.clientesEmFalta, tom: t.clientesEmFalta > 0 ? 'err' : 'ok', estado: t.clientesEmFalta > 0 ? 'abaixo da meta' : 'em dia' },
    { id: 'atrasados', rotulo: 'Atrasados', valor: t.atrasados, tom: t.atrasados > 0 ? 'err' : 'ok', estado: t.atrasados > 0 ? 'vencidos' : 'em dia' },
  ];
}

export type EstadoDoCliente = 'atrasado' | 'falta' | 'em-dia';

/** Atrasado manda sobre falta, e falta sobre em dia. */
export function estadoDoCliente(atrasados: number, faltam: number): EstadoDoCliente {
  if (atrasados > 0) return 'atrasado';
  if (faltam > 0) return 'falta';
  return 'em-dia';
}

/** O selo do cabeçalho do grupo. */
export function seloDoEstado(estado: EstadoDoCliente, atrasados: number, faltam: number): { texto: string; tom: TomDoCartao } {
  if (estado === 'atrasado') return { texto: `${atrasados} ${atrasados === 1 ? 'atrasado' : 'atrasados'}`, tom: 'err' };
  if (estado === 'falta') return { texto: `falta ${faltam}`, tom: 'warn' };
  return { texto: '✓ em dia', tom: 'ok' };
}

export type Progresso = {
  cards: number;
  target: number;
  /** 0–100, limitado: a barra nunca passa da caixa. */
  pct: number;
  /** Quantos cards passam da meta (0 quando não passa). */
  excedente: number;
  /** "1/2", ou "3/2 +1" quando passa da meta. */
  texto: string;
};

export function progressoDoTipo(cards: number, target: number): Progresso {
  const excedente = Math.max(0, cards - target);
  const pct = target > 0 ? Math.min(100, Math.round((cards / target) * 100)) : 0;
  return { cards, target, pct, excedente, texto: `${cards}/${target}${excedente > 0 ? ` +${excedente}` : ''}` };
}

export type BarraDoTipo = Progresso & { type: LinhaDeFalta['type']; missing: number };

export type GrupoDoCliente = {
  clientId: string;
  clientName: string;
  estado: EstadoDoCliente;
  /** Os atrasados do cliente que vieram na leitura (o servidor corta em 200). */
  atrasados: CardAtrasado[];
  /** Soma do que falta nos tipos com meta. */
  faltam: number;
  barras: BarraDoTipo[];
  paraAtribuir: GrupoParaAtribuir[];
  andamento: LinhaDeAndamento[];
};

const ordemDoTipo = (t: TipoDoGrupo) => (t === null ? OPCOES_DO_TIPO.length : OPCOES_DO_TIPO.findIndex((o) => o.value === t));
const RANGO: Record<EstadoDoCliente, number> = { atrasado: 0, falta: 1, 'em-dia': 2 };

/**
 * Junta as quatro partes da leitura num grupo por cliente e ordena: atrasados,
 * depois em falta, depois em dia; dentro de cada faixa, pelo nome.
 */
export function agruparPorCliente(d: Pick<ControleDaSemana, 'toAssign' | 'progress' | 'missing'>): GrupoDoCliente[] {
  const mapa = new Map<string, GrupoDoCliente>();
  const de = (clientId: string, clientName: string): GrupoDoCliente => {
    let g = mapa.get(clientId);
    if (!g) {
      g = { clientId, clientName, estado: 'em-dia', atrasados: [], faltam: 0, barras: [], paraAtribuir: [], andamento: [] };
      mapa.set(clientId, g);
    }
    return g;
  };
  for (const g of d.toAssign) if (g.cards.length > 0) de(g.clientId, g.clientName).paraAtribuir.push(g);
  for (const l of d.progress) de(l.clientId, l.clientName).andamento.push(l);
  for (const i of d.missing.items) {
    const g = de(i.clientId, i.clientName);
    g.faltam += i.missing;
    g.barras.push({ ...progressoDoTipo(i.cards, i.target), type: i.type, missing: i.missing });
  }
  for (const a of d.missing.overdue) de(a.clientId, a.clientName).atrasados.push(a);

  const grupos = [...mapa.values()];
  for (const g of grupos) {
    g.estado = estadoDoCliente(g.atrasados.length, g.faltam);
    g.barras.sort((a, b) => ordemDoTipo(a.type) - ordemDoTipo(b.type));
    g.andamento = ordenarAndamento(g.andamento);
    g.paraAtribuir.sort((a, b) => ordemDoTipo(a.type) - ordemDoTipo(b.type));
  }
  return grupos.sort((a, b) => RANGO[a.estado] - RANGO[b.estado] || a.clientName.localeCompare(b.clientName, 'pt-BR'));
}

/* ───────────── abrir e recolher: o que fica lembrado no navegador ───────────── */

/** `clientId → aberto`. Só guarda o que a pessoa escolheu; o resto segue o padrão do estado. */
export type PreferenciaDeAbertos = Record<string, boolean>;

/** O mínimo do `Storage` que a tela usa — e que um teste consegue imitar. */
export type Cofre = Pick<Storage, 'getItem' | 'setItem'>;

/** Por pessoa, quando a sessão tem id: dois admins no mesmo navegador não herdam a escolha um do outro. */
export const chaveDaPreferencia = (userId?: string | null): string =>
  `ideworks:controle-da-semana:abertos:v2:${userId ? userId : 'anonimo'}`;

/** O `localStorage`, ou `null` quando o navegador nega (aba privada, dados bloqueados). */
export function cofreDoNavegador(): Cofre | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function lerPreferencia(cofre: Cofre | null, chave: string): PreferenciaDeAbertos {
  if (!cofre) return {};
  try {
    const bruto = cofre.getItem(chave);
    if (!bruto) return {};
    const v: unknown = JSON.parse(bruto);
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return {};
    const saida: PreferenciaDeAbertos = {};
    for (const [k, valor] of Object.entries(v)) if (typeof valor === 'boolean') saida[k] = valor;
    return saida;
  } catch {
    return {};
  }
}

/** `true` se gravou. Sem cofre, ou com ele cheio/negado, a tela segue sem lembrar. */
export function gravarPreferencia(cofre: Cofre | null, chave: string, pref: PreferenciaDeAbertos): boolean {
  if (!cofre) return false;
  try {
    cofre.setItem(chave, JSON.stringify(pref));
    return true;
  } catch {
    return false;
  }
}

/**
 * F41 Fase 2: todos os clientes começam recolhidos, em qualquer estado. O que
 * pede atenção está no bloco "Para atribuir" e no selo do cabeçalho.
 * (A chave `…:v2:` descarta o que a Fase 1 gravou, quando o padrão era outro.)
 */
export const abertoPorPadrao: (estado: EstadoDoCliente) => boolean = () => false;

export function estaAberto(g: Pick<GrupoDoCliente, 'clientId' | 'estado'>, pref: PreferenciaDeAbertos): boolean {
  return pref[g.clientId] ?? abertoPorPadrao(g.estado);
}

/** "Expandir tudo" / "Recolher tudo": marca todos os grupos de uma vez. */
export function marcarTodos(grupos: readonly Pick<GrupoDoCliente, 'clientId'>[], aberto: boolean, pref: PreferenciaDeAbertos): PreferenciaDeAbertos {
  const proxima = { ...pref };
  for (const g of grupos) proxima[g.clientId] = aberto;
  return proxima;
}

/** Os cards de um cliente no bloco "Para atribuir", já na ordem dos tipos. */
export type ClienteParaAtribuir = {
  clientId: string;
  clientName: string;
  total: number;
  grupos: GrupoParaAtribuir[];
};

/**
 * O bloco "Para atribuir": só os clientes com card esperando, NA ORDEM da lista
 * de clientes (urgência), para as duas partes da tela contarem a mesma história.
 */
export function clientesParaAtribuir(grupos: readonly GrupoDoCliente[]): ClienteParaAtribuir[] {
  return grupos
    .filter((g) => g.paraAtribuir.some((x) => x.cards.length > 0))
    .map((g) => ({
      clientId: g.clientId,
      clientName: g.clientName,
      total: totalParaAtribuir(g.paraAtribuir),
      grupos: g.paraAtribuir,
    }));
}
