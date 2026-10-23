/**
 * O compromisso — etapa F17.44.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ELE É, E O QUE ELE NÃO É
 *   Reunião, gravação, viagem. Ocupa o dia do cliente e **não entrega nada**.
 *
 *   Por isso ele mora em `ideworks.appointments`, e não em
 *   `ideworks.content_items`. A separação não é de rótulo:
 *
 *     entrega      conta na cota do mês  — é o que o cliente contratou
 *     compromisso  NÃO conta             — ocupa o dia, não é entregável
 *
 *   Se compromisso entrasse na conta, o medidor de entrega passaria a mentir, e
 *   o nível de entrega calculado a partir dele iria junto. Numa tabela
 *   separada, isso deixa de depender de alguém lembrar de um `where`: as seis
 *   contagens do sistema leem `content_items`, e `content_items` não mudou.
 *
 * ⚠️ A HORA É ANULÁVEL, E É POR ISSO QUE ELA EXISTE
 *   `content_items.scheduled_at` é um instante, e item sem hora grava
 *   meia-noite — daí as 2.598 pastilhas `00:00` que o calendário mostrava.
 *   Aqui o dia é `date` e a hora é `time` **anulável**: hora que não existe é
 *   `null`, e `null` não vira `00:00` em formatação nenhuma.
 *
 * ⚠️ O IDENTIFICADOR NASCE AQUI, E NÃO NO `returning` DO BANCO
 *   Mesma razão da F17.32b, em `client-write.ts`: `appointments_select`
 *   pergunta a `ideworks.can_see_client`, que é `stable` e enxerga o retrato de
 *   ANTES da instrução. A linha recém-inserida não está nele, e
 *   `insert ... returning id` seria recusado com `42501` — inclusive para quem
 *   alcança o cliente.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { clienteNoMesSql } from '@/server/cliente-no-periodo';
import { type Sql, type Tx, inlineDate, inlineUuid, inlineUuidList, withActor } from '@/server/db';
import { recorteDasOmitidas } from '@/server/omitidas';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

export type Appointment = {
  id: string;
  clientId: string;
  clientName: string;
  /** Dia civil `AAAA-MM-DD`. Já é dia no banco — não há fuso a resolver. */
  day: string;
  /** `HH:MM`, ou `null` quando o compromisso é do dia inteiro. */
  time: string | null;
  title: string;
  notes: string | null;
};

/** O que a tela manda ao criar ou ao corrigir. */
export type AppointmentInput = {
  clientId: string;
  day: string;
  /** `HH:MM` ou `null`. Texto vazio conta como `null`. */
  time: string | null;
  title: string;
  notes: string | null;
};

export class AppointmentRefused extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AppointmentRefused';
  }
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Confere o que veio da rede antes de encostar no banco.
 *
 * As três recusas são frases de gente, e nenhuma delas cita coluna, tabela ou
 * código: quem digita um título vazio precisa saber que falta o nome, não que
 * `appointments_title_not_blank` reprovou.
 *
 * ⚠️ O dia é conferido por FORMA, e nunca convertido para `Date`. Existe prazo
 * real `82025-08-07` neste banco, e `new Date(...).toISOString()` devolve
 * `+082025-08-07` — todo `slice(0, 10)` do projeto cortaria errado. Aqui o
 * texto viaja como texto até o `::date` do Postgres, que é quem sabe recusar
 * um 31 de fevereiro.
 */
export function validarCompromisso(v: Partial<AppointmentInput>): AppointmentInput {
  const titulo = (v.title ?? '').trim();
  if (titulo === '') throw new AppointmentRefused('Dê um nome ao compromisso.', 400);
  if (titulo.length > 200) {
    throw new AppointmentRefused('O nome do compromisso está longo demais.', 400);
  }
  if (!v.clientId) throw new AppointmentRefused('Escolha de qual cliente é.', 400);
  if (!v.day || !DIA.test(v.day)) throw new AppointmentRefused('Escolha o dia.', 400);

  // Hora em branco NÃO é meia-noite. É a etapa inteira: o dia inteiro é um
  // estado legítimo, e transformá-lo em `00:00` é o defeito que veio consertar.
  const hora = (v.time ?? '').trim();
  if (hora !== '' && !HORA.test(hora)) {
    throw new AppointmentRefused('A hora precisa estar entre 00:00 e 23:59.', 400);
  }

  const nota = (v.notes ?? '').trim();
  return {
    clientId: v.clientId,
    day: v.day,
    time: hora === '' ? null : hora,
    title: titulo,
    notes: nota === '' ? null : nota,
  };
}

export type AppointmentPeriod = { from: string; to: string };

/**
 * Lê os compromissos do período. Fim **exclusivo**, como o do calendário: `to`
 * é o primeiro dia de fora.
 *
 * `to_char` no `day` e no `start_time` porque o driver devolveria `Date` e
 * `string` conforme o tipo, e o dia voltaria a passar por `Date` na volta —
 * que é justamente o caminho que este projeto não usa para data.
 */
export async function readAppointments(
  sql: Sql,
  actor: AuthenticatedActor,
  period: AppointmentPeriod,
  clientId?: string,
): Promise<Appointment[]> {
  return withActor(sql, asDbActor(actor), (tx) => lerCompromissos(tx, actor, period, clientId));
}

/**
 * Os compromissos no `tx` de quem chama (que já declarou o ator) — o calendário
 * lê entregas e compromissos na MESMA transação (perf do servidor, 09/10/2026:
 * eram duas, de 6 idas cada). O período e o cliente vão no texto quando têm o
 * formato de data e de UUID; fora dele continuam parâmetro.
 */
export async function lerCompromissos(
  tx: Tx,
  actor: AuthenticatedActor,
  period: AppointmentPeriod,
  clientId?: string,
): Promise<Appointment[]> {
  const linhas = await tx`
    select a.id, a.client_id, c.name as client_name,
           to_char(a.day, 'YYYY-MM-DD') as day,
           to_char(a.start_time, 'HH24:MI') as time,
           a.title, a.notes
      from ideworks.appointments a
      join ideworks.clients c on c.id = a.client_id
     where a.day >= ${inlineDate(tx, period.from)}::date
       and a.day < ${inlineDate(tx, period.to)}::date
       ${
         // F38, Fases 4 e 5 (D6): sem cliente = calendário geral, e o
         // cancelado só até o mês do cancelamento (o mês do `day`). Com
         // cliente = a ficha dele, que guarda o passado (ver calendar.ts).
         clientId
           ? tx`and a.client_id = ${inlineUuid(tx, clientId)}`
           : tx`and ${clienteNoMesSql(tx, tx`a.client_id`, tx`a.day`)}`
       }
       ${recorteDasOmitidas(tx, actor, (ids) => tx`and c.category_id <> all(${inlineUuidList(tx, ids)}::uuid[])`)}
     order by a.day, a.start_time nulls last, c.name`;

  return linhas.map((r) => ({
    id: r.id as string,
    clientId: r.client_id as string,
    clientName: r.client_name as string,
    day: r.day as string,
    // `to_char` de uma hora nula devolve nulo, e é assim que o dia inteiro
    // chega à tela sem hora nenhuma.
    time: (r.time as string | null) ?? null,
    title: r.title as string,
    notes: (r.notes as string | null) ?? null,
  }));
}

export async function createAppointment(
  sql: Sql,
  actor: AuthenticatedActor,
  entrada: Partial<AppointmentInput>,
): Promise<string> {
  const v = validarCompromisso(entrada);
  return withActor(sql, asDbActor(actor), async (tx) => {
    // Ver a nota do topo: o `uuid` nasce aqui porque `can_see_client` é
    // `stable` e não enxerga a linha nascendo.
    const id = crypto.randomUUID();
    try {
      await tx`
        insert into ideworks.appointments
          (id, client_id, day, start_time, title, notes, created_by)
        values (${id}, ${v.clientId}, ${v.day}::date,
                ${v.time}::time, ${v.title}, ${v.notes}, ${actor.userId})`;
    } catch (erro) {
      throw traduzir(erro);
    }
    return id;
  });
}

/**
 * Corrige um compromisso inteiro.
 *
 * ⚠️ `client_id` VAI NO `update`, e é de propósito: mover um compromisso de
 * cliente é uma correção legítima — alguém marcou a reunião na agenda errada.
 * Quem impede o abuso é `appointments_update`, que tem `with check` além do
 * `using`: não dá para empurrar a linha para um cliente fora do alcance.
 */
export async function updateAppointment(
  sql: Sql,
  actor: AuthenticatedActor,
  id: string,
  entrada: Partial<AppointmentInput>,
): Promise<boolean> {
  const v = validarCompromisso(entrada);
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const linhas = await tx`
        update ideworks.appointments
           set client_id = ${v.clientId}, day = ${v.day}::date,
               start_time = ${v.time}::time, title = ${v.title},
               notes = ${v.notes}, updated_at = now()
         where id = ${id}
         returning id`;
      return linhas.length > 0;
    } catch (erro) {
      throw traduzir(erro);
    }
  });
}

export async function deleteAppointment(
  sql: Sql,
  actor: AuthenticatedActor,
  id: string,
): Promise<boolean> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    const linhas = await tx`
      delete from ideworks.appointments where id = ${id} returning id`;
    return linhas.length > 0;
  });
}

/**
 * O que o banco recusou, dito em português e sem citar o banco.
 *
 * `42501` é a política de linha: quem não alcança o cliente não marca nada
 * nele. A frase não distingue "cliente não existe" de "cliente de outra
 * carteira" — distinguir entregaria a existência da carteira alheia, que é a
 * mesma decisão que a rota de conclusão de item já tinha tomado.
 */
function traduzir(erro: unknown): AppointmentRefused {
  const e = erro as { code?: string; constraint_name?: string };
  if (e.code === '42501') {
    return new AppointmentRefused('Este cliente não está na sua carteira.', 403);
  }
  if (e.code === '23503') {
    return new AppointmentRefused('Cliente não encontrado.', 404);
  }
  if (e.code === '23514' && e.constraint_name === 'appointments_title_not_blank') {
    return new AppointmentRefused('Dê um nome ao compromisso.', 400);
  }
  // Data impossível — 31 de fevereiro, por exemplo. O Postgres é quem sabe
  // dizer isso; o servidor só confere a FORMA.
  if (e.code === '22008' || e.code === '22007') {
    return new AppointmentRefused('Esse dia não existe no calendário.', 400);
  }
  if (erro instanceof AppointmentRefused) return erro;
  return new AppointmentRefused('Não foi possível gravar o compromisso.', 400);
}
