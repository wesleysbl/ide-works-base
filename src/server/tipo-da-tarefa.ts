/**
 * O TIPO DA TAREFA — F40, Fase 2.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A REGRA
 *
 *   Toda tarefa NOVA de lista de PRODUÇÃO (a esteira efetiva tem a etapa
 *   "atribuir demanda", sem acento e sem maiúscula) precisa de um tipo:
 *   Vídeo, Arte, Foto ou Outros. Lista interna não exige. Card antigo sem tipo
 *   continua editável em tudo o que não é o tipo. Subtarefa e tarefa sem lista
 *   passam reto.
 *
 *   QUEM DECIDE O QUE É "PRODUÇÃO" É O BANCO (`ideworks.list_is_production`,
 *   Fase 1). Este módulo só pergunta — uma vez por escrita, no `Tx` que já
 *   está aberto — e nunca refaz a regra em TypeScript.
 *
 * POR QUE O SERVIDOR VALIDA ANTES DO BANCO
 *   O gatilho `tasks_demand_type_guard` (parte 2 da migration) só entra junto
 *   com a publicação deste código. Até lá, e depois dela, a recusa precisa
 *   sair daqui, com a frase e as quatro opções. O gatilho é a garantia para
 *   qualquer outra porta: o SQLSTATE `IW040` que ele levanta é traduzido para
 *   a MESMA recusa (`TypeRequired`, em `@/server/board`).
 *
 * O CAMPO se chama `type` na API (`NewTask.type`, `TaskPatch.type`,
 * `TaskDetail.type`, `BoardTask.type`, `WorkRow.type`) e `demand_type` no banco.
 * Não se confunde com `taskType*` (o tipo do ClickUp, F17.5).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { Tx } from '@/server/db';
import { inlineUuid } from '@/server/db-literal';

export const TIPOS_DA_TAREFA = ['video', 'arte', 'foto', 'outros'] as const;
export type TipoDaTarefa = (typeof TIPOS_DA_TAREFA)[number];

export const OPCOES_DO_TIPO: ReadonlyArray<{ value: TipoDaTarefa; label: string }> = [
  { value: 'video', label: 'Vídeo' },
  { value: 'arte', label: 'Arte' },
  { value: 'foto', label: 'Foto' },
  { value: 'outros', label: 'Outros' },
];

/** A frase da recusa. A Fase 4 (tela) mostra a mesma. */
export const FRASE_TIPO_OBRIGATORIO = 'Escolha o tipo: Vídeo, Arte, Foto ou Outros';

export const FRASE_TIPO_INVALIDO = 'Tipo inválido. Use um destes: video, arte, foto ou outros.';

/** O valor é um dos quatro tipos? */
export function ehTipoDaTarefa(v: unknown): v is TipoDaTarefa {
  return typeof v === 'string' && (TIPOS_DA_TAREFA as readonly string[]).includes(v);
}

/** O valor lido do banco (`demand_type::text`) → o que a API devolve. */
export function comoTipoLido(v: unknown): TipoDaTarefa | null {
  return ehTipoDaTarefa(v) ? v : null;
}

/** A lista é de produção? Uma consulta, no `Tx` de quem escreve. */
export async function listaEhDeProducao(tx: Tx, listId: string): Promise<boolean> {
  const [linha] = await tx`select ideworks.list_is_production(${inlineUuid(tx, listId)}::uuid) as producao`;
  return linha?.producao === true;
}
