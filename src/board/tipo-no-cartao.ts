/**
 * O TIPO DA DEMANDA NA TELA DO QUADRO — F40, Fase 4.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DUAS LISTAS, UMA REGRA (D2/D4 do plano F40; espelha `cliente-no-cartao`)
 *
 *   · Lista de PRODUÇÃO (`isProduction`): o tipo é obrigatório ao criar, e uma
 *     vez escolhido não se apaga ("nenhum" some do seletor da ficha).
 *   · Lista INTERNA: o tipo é opcional, e "nenhum" é uma escolha de verdade.
 *   · Card antigo sem tipo em lista de produção continua válido: aparece como
 *     "Sem tipo" na ficha e permite escolher.
 *
 *   Quem decide de verdade é o servidor (`server/tipo-da-tarefa.ts`) e o
 *   gatilho `tasks_demand_type_guard`. Esta tela ANTECIPA a frase para a pessoa
 *   não perder o título digitado; ela não é uma segunda regra. Quem diz que a
 *   lista é de produção é o banco, e chega pronto em `header.isProduction`
 *   (quadro) e `listIsProduction` (ficha): nada aqui procura "atribuir demanda".
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { FRASE_TIPO_OBRIGATORIO, OPCOES_DO_TIPO, type TipoDaTarefa } from '@/server/tipo-da-tarefa';

export { OPCOES_DO_TIPO };
export type { TipoDaTarefa };

/** A frase do servidor, igual na criação, na ficha e no Controle da semana. */
export const FRASE_FALTA_TIPO = FRASE_TIPO_OBRIGATORIO;

/** A lista, no que a regra do tipo precisa. Ausente = lista interna. */
export type ListaDoTipo = { isProduction?: boolean };

export const ehListaDeProducao = (lista: ListaDoTipo | undefined | null): boolean =>
  lista?.isProduction === true;

/** O que falta para criar, quanto ao tipo. `null` = nada falta. */
export function faltaTipo(lista: ListaDoTipo | undefined | null, tipo: TipoDaTarefa | null | undefined): string | null {
  if (!ehListaDeProducao(lista)) return null;
  return tipo ? null : FRASE_FALTA_TIPO;
}

/** O nome do tipo no selo; `null` quando não há tipo (o cartão não desenha selo). */
export function rotuloDoTipoDoCartao(tipo: TipoDaTarefa | null | undefined): string | null {
  if (!tipo) return null;
  return OPCOES_DO_TIPO.find((o) => o.value === tipo)?.label ?? null;
}

export type OpcaoDaFicha = { value: TipoDaTarefa | null; label: string };

/**
 * As opções que a ficha oferece. Em lista de produção, as quatro e nada mais
 * (o servidor recusa apagar). Em lista interna entra "Nenhum" no começo.
 */
export function opcoesDaFicha(producao: boolean): OpcaoDaFicha[] {
  const quatro: OpcaoDaFicha[] = OPCOES_DO_TIPO.map((o) => ({ value: o.value, label: o.label }));
  return producao ? quatro : [{ value: null, label: 'Nenhum' }, ...quatro];
}

/** O que a ficha escreve quando a tarefa não tem tipo. */
export const ROTULO_SEM_TIPO = 'Sem tipo';

/**
 * A frase de uma recusa de criação/edição. O servidor devolve `type_required`
 * com a frase certa; aqui garantimos que ela é SEMPRE a mesma, mesmo que o
 * texto cru venha diferente (gatilho do banco, proxy, versão antiga).
 */
export function fraseDaRecusa(erro: { message: string; code?: string }): string {
  return erro.code === 'type_required' ? FRASE_FALTA_TIPO : erro.message;
}
