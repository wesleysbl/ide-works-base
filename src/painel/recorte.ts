/**
 * O RECORTE DO PAINEL NO ENDEREÇO — F11A do plano UX.
 *
 * Período, filtros e ordenação eram estado local do `Painel`: abrir um cliente
 * e voltar devolvia a carteira inteira, no mês corrente, ordenada por entrega.
 * Quem filtrou "Crítico" para trabalhar um por um refazia o filtro a cada
 * volta. Agora o recorte mora no endereço (`@/ui/endereco`), com `replace`:
 * o VOLTAR do navegador o encontra, e o endereço colado mostra o mesmo recorte.
 *
 * O CONTRATO
 *   de, ate      intervalo; os dois ou nenhum. Sem eles = o mês corrente inteiro
 *   busca        texto (gravado por `useTextoNoEndereco`, não por aqui)
 *   urgencia     `perigo,alerta` — as chaves internas, nunca o rótulo
 *   plano        ids separados por vírgula
 *   etiqueta     ids separados por vírgula
 *   financeiro   `pendente` = só financeiro pendente
 *   ordem        `nome` | `renovacao` | `urgencia` | `ultimaEntrega` (sem = `entrega`).
 *                Lida sem caixa: `ultimaentrega` também vale (F38).
 *   sentido      `desc` (sem = crescente)
 *
 *   O padrão NUNCA é escrito: o painel sem recorte tem o endereço limpo de
 *   sempre (`/painel`), que é o que a barra lateral abre.
 *
 * TOLERANTE NA LEITURA
 *   Tudo vem da barra de endereço. Data impossível, intervalo invertido,
 *   urgência inventada, id com caractere estranho: cada peça inválida vira o
 *   padrão dela, sem derrubar as outras. Ids de plano e etiqueta não podem ser
 *   conferidos antes de a carteira chegar — a tela descarta os desconhecidos
 *   depois (`filtroConhecido`), sem reescrever o endereço.
 */

import { FILTRO_VAZIO, type ClienteDoPainel, type Filtro, ORDENS, type Ordem, type Urgencia } from '@/painel/carteira';

export type Periodo = { de: string; ate: string };

/** O recorte inteiro, menos a busca (que tem o seu gancho próprio). */
export type Recorte = {
  periodo: Periodo;
  filtro: Omit<Filtro, 'busca' | 'ativo'>;
  ordem: Ordem;
  crescente: boolean;
};

const URGENCIAS_VALIDAS: readonly Urgencia[] = ['perigo', 'alerta', 'paz'];
const ORDENS_VALIDAS = Object.keys(ORDENS) as Ordem[];

/** Quantos ids de uma lista o endereço carrega. Acima disso, o resto é ignorado. */
export const TETO_DE_IDS = 50;

/** O maior intervalo aceito pelo endereço, em meses tocados. */
export const TETO_DE_MESES = 36;

/** O mês inteiro como intervalo. */
export function mesInteiro(mes: string): Periodo {
  const [ano, m] = mes.split('-').map(Number);
  const ultimo = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  return { de: `${mes}-01`, ate: `${mes}-${String(ultimo).padStart(2, '0')}` };
}

/** `AAAA-MM-DD` que existe no calendário (31/02 não passa). */
export function dataValida(cru: string | null): cru is string {
  if (cru === null || !/^\d{4}-\d{2}-\d{2}$/.test(cru)) return false;
  const [a, m, d] = cru.split('-').map(Number);
  if (a < 2000 || a > 2100) return false;
  const data = new Date(Date.UTC(a, m - 1, d));
  return data.getUTCFullYear() === a && data.getUTCMonth() === m - 1 && data.getUTCDate() === d;
}

const mesesEntre = (de: string, ate: string) => {
  const [a0, m0] = de.split('-').map(Number);
  const [a1, m1] = ate.split('-').map(Number);
  return a1 * 12 + m1 - (a0 * 12 + m0) + 1;
};

/** O período do endereço, ou o mês de referência inteiro. */
export function periodoValido(de: string | null, ate: string | null, mesPadrao: string): Periodo {
  if (!dataValida(de) || !dataValida(ate) || de > ate || mesesEntre(de, ate) > TETO_DE_MESES) {
    return mesInteiro(mesPadrao);
  }
  return { de, ate };
}

/** Lista separada por vírgula: sem vazios, sem repetidos, só o formato de id. */
function idsValidos(cru: string | null): string[] {
  if (cru === null) return [];
  const vistos = new Set<string>();
  for (const parte of cru.split(',')) {
    const id = parte.trim();
    if (/^[A-Za-z0-9_-]{1,64}$/.test(id)) vistos.add(id);
    if (vistos.size >= TETO_DE_IDS) break;
  }
  return [...vistos];
}

/** O recorte que o endereço descreve. Puro. */
export function lerRecorte(parametros: URLSearchParams, mesPadrao: string): Recorte {
  const pedidas = new Set((parametros.get('urgencia') ?? '').split(',').map((u) => u.trim().toLowerCase()));
  const ordemCrua = (parametros.get('ordem') ?? '').trim().toLowerCase();
  return {
    periodo: periodoValido(parametros.get('de'), parametros.get('ate'), mesPadrao),
    filtro: {
      // Na ordem de gravidade, e não na ordem digitada: `alerta,perigo` e
      // `perigo,alerta` são o mesmo recorte e têm de reescrever igual.
      urgencias: URGENCIAS_VALIDAS.filter((u) => pedidas.has(u)),
      planoIds: idsValidos(parametros.get('plano')),
      etiquetaIds: idsValidos(parametros.get('etiqueta')),
      soFinanceiroPendente: parametros.get('financeiro')?.trim().toLowerCase() === 'pendente',
    },
    // Sem caixa: a leitura sempre baixou o texto, e a chave `ultimaEntrega`
    // (F38) tem maiúscula — comparar como veio a descartaria.
    ordem: ORDENS_VALIDAS.find((o) => o.toLowerCase() === ordemCrua) ?? 'entrega',
    crescente: parametros.get('sentido')?.trim().toLowerCase() !== 'desc',
  };
}

/**
 * As mudanças de endereço que descrevem um recorte — para `aplicarMudancas`.
 * Todo padrão vira `''`, que TIRA a chave do endereço.
 */
export function recorteParaEndereco(r: Recorte, mesPadrao: string): Record<string, string> {
  const padrao = mesInteiro(mesPadrao);
  const noPadrao = r.periodo.de === padrao.de && r.periodo.ate === padrao.ate;
  return {
    de: noPadrao ? '' : r.periodo.de,
    ate: noPadrao ? '' : r.periodo.ate,
    urgencia: URGENCIAS_VALIDAS.filter((u) => r.filtro.urgencias.includes(u)).join(','),
    plano: [...new Set(r.filtro.planoIds)].join(','),
    etiqueta: [...new Set(r.filtro.etiquetaIds)].join(','),
    financeiro: r.filtro.soFinanceiroPendente ? 'pendente' : '',
    ordem: r.ordem === 'entrega' ? '' : r.ordem,
    sentido: r.crescente ? '' : 'desc',
  };
}

/** O filtro completo da carteira ativa, a partir do recorte e da busca. */
export const filtroDoRecorte = (r: Recorte, busca: string): Filtro => ({
  ...FILTRO_VAZIO,
  ...r.filtro,
  busca,
});

/**
 * O filtro sem os ids que a carteira não conhece — plano apagado, etiqueta de
 * outra unidade, id digitado. Sem isso, um id morto no endereço esvaziaria a
 * carteira sem que nenhum controle aparecesse aceso para explicar por quê.
 */
export function filtroConhecido(f: Filtro, clientes: readonly ClienteDoPainel[]): Filtro {
  const planos = new Set(clientes.flatMap((c) => (c.plan ? [c.plan.id] : [])));
  const etiquetas = new Set(clientes.flatMap((c) => c.tags.map((t) => t.id)));
  return {
    ...f,
    planoIds: f.planoIds.filter((id) => planos.has(id)),
    etiquetaIds: f.etiquetaIds.filter((id) => etiquetas.has(id)),
  };
}

/**
 * Para onde o degrau `Painel` da ficha do cliente leva — F11A.
 *
 * O cartão abre a ficha levando no `state` da navegação o `?…` do painel. O
 * VOLTAR do navegador já devolvia o recorte (ele está no endereço); o degrau
 * da trilha é um link novo, e sem isto levava ao `/painel` limpo. Só aceita
 * uma consulta (`?…`) curta, sem `#`: o `state` sobrevive a recarregar a
 * página e não é lugar para confiar em qualquer coisa.
 */
export function destinoDoPainel(state: unknown): string {
  const cru = (state as { painel?: unknown } | null)?.painel;
  if (typeof cru !== 'string' || !cru.startsWith('?') || cru.length > 2000 || cru.includes('#')) {
    return '/painel';
  }
  return `/painel${cru}`;
}
