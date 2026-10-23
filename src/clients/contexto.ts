/**
 * O CONTEXTO DA FICHA DO CLIENTE NO ENDEREÇO — F11B do plano UX.
 *
 * Área, competência e período eram estado local de `Cliente.tsx`: abrir a
 * ficha pelo link colado, recarregar a página ou voltar de uma tarefa sempre
 * devolvia `Conteúdos`, no mês corrente, com o mês inteiro. Agora os três
 * moram no endereço (`@/ui/endereco`, com `replace` — trocar de área não é
 * navegar), e o VOLTAR e o link colado reproduzem o que se estava olhando.
 *
 * O CONTRATO
 *   area   `calendario` | `checklist` | `semanal` | `captacao` | `mural` |
 *          `historico` (sem = `conteudos`)
 *   mes    `AAAA-MM` — a COMPETÊNCIA do contrato: o mês que se abre, planeja
 *          e aprova, e o que o medidor mede (sem = o mês corrente)
 *   de,ate o PERÍODO da produção, os dois ou nenhum (sem = o mês inteiro da
 *          competência). Ele recorta a lista; não muda o medidor nem o mês.
 *
 *   O padrão NUNCA é escrito, como no Painel (`@/painel/recorte`): a ficha
 *   aberta pela carteira tem o endereço limpo de sempre, `/cliente/<id>`.
 *
 * TOLERANTE NA LEITURA
 *   Tudo vem da barra de endereço: área inventada, mês impossível, período
 *   invertido ou longo demais viram o padrão de cada peça, sem derrubar as
 *   outras. Nada de rascunho mora aqui — só o que se está OLHANDO.
 */

import { TETO_DE_MESES, dataValida } from '@/painel/recorte';
import { escolhaValida } from '@/ui/endereco';

/** As sete áreas de trabalho da ficha, na ordem da tela. */
export const AREAS = [
  'conteudos',
  'calendario',
  'checklist',
  'semanal',
  'captacao',
  'mural',
  'historico',
] as const;

export type Area = (typeof AREAS)[number];

export const ROTULO_DA_AREA: Record<Area, string> = {
  conteudos: 'Conteúdos',
  calendario: 'Calendário',
  checklist: 'Checklist',
  semanal: 'Semanal',
  captacao: 'Captação',
  mural: 'Mural',
  historico: 'Histórico',
};

export type PeriodoDaProducao = { de: string; ate: string };

export type Contexto = {
  area: Area;
  /** A competência do contrato, `AAAA-MM`. */
  mes: string;
  /** O recorte da produção; `null` = o mês inteiro da competência. */
  periodo: PeriodoDaProducao | null;
};

/** `AAAA-MM` que existe (mês 01–12, ano 2000–2100). */
export function mesValido(cru: string | null): cru is string {
  if (cru === null || !/^\d{4}-\d{2}$/.test(cru)) return false;
  const [a, m] = cru.split('-').map(Number);
  return a >= 2000 && a <= 2100 && m >= 1 && m <= 12;
}

const mesesTocados = (de: string, ate: string) => {
  const [a0, m0] = de.split('-').map(Number);
  const [a1, m1] = ate.split('-').map(Number);
  return a1 * 12 + m1 - (a0 * 12 + m0) + 1;
};

/** O período do endereço, ou `null` (o mês inteiro). */
export function periodoDaProducao(de: string | null, ate: string | null): PeriodoDaProducao | null {
  if (!dataValida(de) || !dataValida(ate) || de > ate || mesesTocados(de, ate) > TETO_DE_MESES) return null;
  return { de, ate };
}

/** O contexto que o endereço descreve. Puro. */
export function lerContexto(parametros: URLSearchParams, mesPadrao: string): Contexto {
  const mes = parametros.get('mes')?.trim() ?? null;
  return {
    area: escolhaValida<Area>(parametros.get('area'), AREAS, 'conteudos'),
    mes: mesValido(mes) ? mes : mesPadrao,
    periodo: periodoDaProducao(parametros.get('de'), parametros.get('ate')),
  };
}

/**
 * As mudanças de endereço que descrevem um contexto — para `aplicarMudancas`.
 * Todo padrão vira `''`, que TIRA a chave. As quatro chaves vão sempre juntas:
 * quem grava parte do contexto de agora, e nunca de um desenho atrasado.
 */
export function contextoParaEndereco(c: Contexto, mesPadrao: string): Record<string, string> {
  return {
    area: c.area === 'conteudos' ? '' : c.area,
    mes: c.mes === mesPadrao ? '' : c.mes,
    de: c.periodo?.de ?? '',
    ate: c.periodo?.ate ?? '',
  };
}

/**
 * O endereço de outro cliente mantendo área, competência e período — o
 * anterior/próximo da ficha. Percorrer a carteira "em Semanal, em agosto" é
 * o gesto: cair em Conteúdos do mês corrente a cada cliente o desfaria.
 */
export function enderecoDoCliente(id: string, c: Contexto, mesPadrao: string): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(contextoParaEndereco(c, mesPadrao))) if (v !== '') p.set(k, v);
  const q = p.toString();
  return `/cliente/${encodeURIComponent(id)}${q ? `?${q}` : ''}`;
}

/** A chave de uma leitura da ficha — o que a resposta precisa ainda ser. */
export const chaveDaLeitura = (id: string, c: Pick<Contexto, 'mes' | 'periodo'>) =>
  `${id}|${c.mes}|${c.periodo ? `${c.periodo.de}..${c.periodo.ate}` : 'mes'}`;

/**
 * As observações são longas? Então a ficha mostra o começo e oferece o
 * resto — sem cortar nem descartar texto: o inteiro está a um clique, com as
 * quebras de linha que a pessoa escreveu.
 */
export function observacoesLongas(texto: string | null, { caracteres = 280, linhas = 5 } = {}): boolean {
  if (!texto) return false;
  return texto.length > caracteres || texto.split('\n').length > linhas;
}
