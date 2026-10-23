/**
 * Calendário editorial — etapa F5.1.
 *
 * ELE NÃO TEM TABELA PRÓPRIA, E ESSE É O PONTO
 *   No Sistema IDE o calendário é uma tabela separada da grade de produção. Os
 *   mesmos conteúdos são cadastrados duas vezes: 29 dos 30 clientes que usam o
 *   calendário também usam a grade. E as duas tabelas usam **vocabulários
 *   diferentes** para o tipo — `Video` de um lado, `videos` do outro.
 *
 *   Aqui o calendário é uma **consulta** sobre os itens que têm data. Agendar um
 *   conteúdo é dar-lhe data, não criar outro registro. Por isso não há como o
 *   calendário e a grade discordarem: são a mesma linha.
 *
 * O QUE NÃO APARECE AQUI
 *   Item sem data. Ele existe, conta para o contrato do mês e aparece na tela do
 *   cliente — mas um calendário não tem onde desenhá-lo. A tela do cliente diz
 *   quantos são, para ninguém achar que sumiram.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DUAS COISAS CAEM NO MESMO DIA — F17.44
 *
 *   A **entrega** é conteúdo: sai de `content_items`, e é o que a cota do mês
 *   conta. O **compromisso** — reunião, gravação, viagem — sai de
 *   `appointments`, ocupa o dia e não entrega nada.
 *
 *   As duas leituras são separadas de propósito, e são duas consultas, não um
 *   `union`: um `union` obrigaria as duas tabelas a terem as mesmas colunas, e
 *   a primeira coluna inventada para o lado que não a tem seria o começo de
 *   tratá-los como a mesma coisa. Eles não são: um conta na cota e o outro não.
 *
 * ⚠️ O `00:00` SAIU DAS PASTILHAS DE ENTREGA — E A HORA NUNCA EXISTIU
 *
 *   Este arquivo formatava `to_char(scheduled_at ..., 'HH24:MI')` sempre. Como
 *   `scheduled_at` é um instante e conteúdo se agenda por DIA, a hora era
 *   subproduto de duas convenções de fuso, nunca a escolha de ninguém:
 *
 *     · a migração do legado (F11b) grava meia-noite  →  `00:00`
 *     · a tela semanal grava `T12:00:00Z` para o dia não escorregar  →  `09:00`
 *
 *   Medido no banco em 2026-08-31: 2.598 conteúdos com data mostrando `00:00`,
 *   15 mostrando `09:00`, e 13 outras horas de scripts de prova. **Nenhuma
 *   tela do sistema oferece hora para conteúdo** — não há seletor de hora em
 *   lugar nenhum, e a F17.42 escolhe o DIA.
 *
 *   Mostrar qualquer uma dessas horas é mostrar um dado que ninguém escolheu.
 *   Então a entrega passa a vir sem hora, e a hora que aparece no calendário é
 *   sempre a hora de um compromisso — que é hora de verdade, digitada por
 *   alguém, e anulável no banco.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { type Appointment, lerCompromissos } from '@/server/appointments';
import { clienteNoMesSql } from '@/server/cliente-no-periodo';
import { type Sql, inlineDate, inlineText, inlineUuid, inlineUuidList, withActor } from '@/server/db';
import { recorteDasOmitidas } from '@/server/omitidas';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

/**
 * O que cai num dia da grade.
 *
 * `kind` é o que a tela usa para saber o que pode fazer com a pastilha —
 * entrega se conclui e se reagenda; compromisso se renomeia e ganha hora.
 */
export type CalendarEntry = {
  kind: 'delivery' | 'appointment';
  id: string;
  clientId: string;
  clientName: string;
  /** Vazio no compromisso: ele não é conteúdo, e por isso não tem tipo. */
  contentType: string;
  platform: string | null;
  /** Dia civil `AAAA-MM-DD`, já no fuso de quem opera. */
  day: string;
  /** `HH:MM`. Só o compromisso tem — ver a nota do topo. */
  time: string | null;
  title: string | null;
  isExtra: boolean;
  isCompleted: boolean;
  /** O que não coube no nome do compromisso. Sempre nulo na entrega. */
  notes: string | null;
};

export type CalendarPeriod = { from: string; to: string };

/**
 * Lê os itens agendados no período.
 *
 * O fim é **exclusivo**: `to` é o primeiro dia de fora. Assim o número de dias
 * do mês nunca entra na conta, e não existe o caso de esquecer o dia 31.
 *
 * O fuso é o da agência, fixo. Guardar o instante em UTC e desenhar o dia em
 * horário local é o que faz um post das 21h de segunda aparecer na terça — e
 * ninguém entende por quê.
 */
export const AGENCY_TIMEZONE = 'America/Sao_Paulo';

export async function readCalendar(
  sql: Sql,
  actor: AuthenticatedActor,
  period: CalendarPeriod,
  clientId?: string,
): Promise<CalendarEntry[]> {
  // PERF DO SERVIDOR, 09/10/2026 — as entregas e os compromissos saem na MESMA
  // transação e na mesma rajada (eram duas transações, de 6 idas cada, e a
  // segunda só começava quando a primeira terminava). O período, o cliente e o
  // fuso vão no texto; sem parâmetro, as duas consultas viajam juntas: 3 idas
  // com o begin e o commit, contra 12.
  const [entregas, compromissosLidos] = await withActor(sql, asDbActor(actor), async (tx) => {
    // F31: entrega de cliente de empresa omitida não cai no calendário. O
    // compromisso tem o mesmo recorte, em `lerCompromissos`.
    //
    // F38, Fases 4 e 5 (D6): no calendário GERAL (sem `clientId`) o cliente
    // cancelado só cai nos meses até o do cancelamento, inclusive — a regra
    // única de `cliente-no-periodo.ts`, pelo mês do dia exibido (São Paulo).
    // Do mês seguinte em diante ele some, nem a entrega nem o compromisso. Com
    // `clientId` é a aba da ficha de UM cliente, que segue mostrando o passado
    // dele inteiro, mesmo depois do cancelamento.
    const fuso = inlineText(tx, AGENCY_TIMEZONE);
    const lerEntregas = async (): Promise<CalendarEntry[]> => {
      const linhas = await tx`
        select i.id, i.client_id, c.name as client_name, i.content_type, i.platform,
               to_char(i.scheduled_at at time zone ${fuso}, 'YYYY-MM-DD') as day,
               i.title, i.is_extra, (i.completed_at is not null) as is_completed
          from ideworks.content_items i
          join ideworks.clients c on c.id = i.client_id
         where i.scheduled_at is not null
           and (i.scheduled_at at time zone ${fuso}) >= ${inlineDate(tx, period.from)}::timestamp
           and (i.scheduled_at at time zone ${fuso}) < ${inlineDate(tx, period.to)}::timestamp
           ${
             clientId
               ? tx`and i.client_id = ${inlineUuid(tx, clientId)}`
               : tx`and ${clienteNoMesSql(tx, tx`i.client_id`, tx`(i.scheduled_at at time zone ${fuso})::date`)}`
           }
           ${recorteDasOmitidas(tx, actor, (ids) => tx`and c.category_id <> all(${inlineUuidList(tx, ids)}::uuid[])`)}
         order by i.scheduled_at, c.name`;

      return linhas.map(
        (r): CalendarEntry => ({
          kind: 'delivery',
          id: r.id as string,
          clientId: r.client_id as string,
          clientName: r.client_name as string,
          contentType: r.content_type as string,
          platform: (r.platform as string | null) ?? null,
          day: r.day as string,
          // ⚠️ SEMPRE NULO, e a nota do topo diz por quê: a hora de um conteúdo
          // nunca foi escolhida por ninguém — ela é subproduto do fuso.
          time: null,
          title: (r.title as string | null) ?? null,
          isExtra: r.is_extra as boolean,
          isCompleted: r.is_completed as boolean,
          notes: null,
        }),
      );
    };
    return Promise.all([lerEntregas(), lerCompromissos(tx, actor, period, clientId)]);
  });

  const compromissos = compromissosLidos.map(
    (a: Appointment): CalendarEntry => ({
      kind: 'appointment',
      id: a.id,
      clientId: a.clientId,
      clientName: a.clientName,
      // Compromisso não é conteúdo. O vazio aqui não é falta de dado: é a
      // afirmação de que a pergunta "de que tipo?" não se aplica a ele.
      contentType: '',
      platform: null,
      day: a.day,
      time: a.time,
      title: a.title,
      isExtra: false,
      isCompleted: false,
      notes: a.notes,
    }),
  );

  /*
    A ordem é a do DIA, e dentro do dia a do relógio: quem tem hora vem antes
    de quem não tem, porque quem não tem ocupa o dia inteiro e não disputa
    posição na fila. Entre dois sem hora, o nome do cliente — a mesma regra que
    a consulta de entregas já usava sozinha.

    A comparação de hora é feita com um `if` explícito, e não com um texto
    sentinela do fim do alfabeto: sentinela é um valor inventado que compara
    bem por acidente, e o dia em que a hora mudar de forma ele passa a ordenar
    errado em silêncio.
  */
  const antesNoRelogio = (a: CalendarEntry, b: CalendarEntry) => {
    if (a.time !== null && b.time !== null) return a.time.localeCompare(b.time);
    if (a.time !== null) return -1;
    if (b.time !== null) return 1;
    return 0;
  };

  return [...entregas, ...compromissos].sort(
    (a, b) =>
      a.day.localeCompare(b.day) || antesNoRelogio(a, b) || a.clientName.localeCompare(b.clientName),
  );
}

/**
 * Dá data a um item que estava só planejado — ou tira a data, devolvendo-o ao
 * planejamento.
 *
 * Não cria registro novo: agendar é uma propriedade do item, não outro item. É
 * exatamente isso que impede o calendário de divergir da grade.
 */
/**
 * O instante que `scheduleItem` aceita: `AAAA-MM-DD`, com ou sem `THH:MM[:SS]`
 * e com ou sem `Z`/deslocamento — o dia TEM DE EXISTIR no calendário. A tela
 * manda o meio-dia do dia (`meioDiaDoDia`); o que não é isso nem se aproxima
 * ia ao `cast(... as timestamp)` do banco e voltava como 500.
 */
const INSTANTE_DE_AGENDA =
  /^(\d{4}-\d{2}-\d{2})(?:[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

export function ehInstanteDeAgenda(v: unknown): v is string {
  const m = typeof v === 'string' ? INSTANTE_DE_AGENDA.exec(v) : null;
  if (!m) return false;
  const d = new Date(`${m[1]}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === m[1];
}

/**
 * O `scheduledAt` de uma peça NOVA (`POST /items`), repartido em duas formas
 * que o INSERT trata cada uma do seu jeito:
 *
 *   · `diaPuro` — `AAAA-MM-DD`, só o dia. Vira o MEIO-DIA de São Paulo
 *     (`timezone(AGENCY_TIMEZONE, dia + 12h)`), o que a tela manda
 *     (`meioDiaDoDia`) e longe de qualquer virada de fuso. Gravado como veio, o
 *     banco o lia no fuso da sessão — UTC — e punha a peça às 21h do dia
 *     ANTERIOR em São Paulo (conferência de 09/10/2026);
 *   · `instante` — qualquer outra forma (`…T12:00:00Z`, `…T15:00:00.000Z`),
 *     entregue ao banco como sempre foi: é um instante, e não se reinterpreta.
 *
 * Os dois são nulos quando não há data: a peça nasce sem dia.
 */
export function instanteDaPecaNova(
  quando: string | null | undefined,
): { diaPuro: string | null; instante: string | null } {
  if (quando === undefined || quando === null) return { diaPuro: null, instante: null };
  return /^\d{4}-\d{2}-\d{2}$/.test(quando)
    ? { diaPuro: quando, instante: null }
    : { diaPuro: null, instante: quando };
}

export async function scheduleItem(
  sql: Sql,
  actor: AuthenticatedActor,
  itemId: string,
  when: string | null,
): Promise<boolean> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    // A conversão de fuso acontece no SQL, e o horário viaja como TEXTO PURO.
    //
    // Duas tentativas anteriores erraram aqui, e vale registrar as duas:
    //
    //   1. Passar `"2026-08-18 15:30 America/Sao_Paulo"` como um valor só: o
    //      driver tentou lê-lo como data e devolveu `Invalid time value`.
    //
    //   2. Passar `"2026-08-18 15:30"` e converter no SQL: o driver reconheceu
    //      a forma de data e a transformou em instante usando o fuso DA MÁQUINA
    //      antes de enviar. O banco recebeu 18:30 achando ser 15:30, aplicou o
    //      fuso de novo, e gravou 21:30. Três horas a mais, sem erro nenhum —
    //      exatamente o tipo de defeito que só aparece quando alguém compara o
    //      que digitou com o que a tela mostra.
    //
    // `cast(... as text)` tira do driver a chance de interpretar. O Postgres
    // recebe texto e é ele quem ancora no fuso da agência — que é quem sabe
    // fazer isso, inclusive no dia em que houver horário de verão de novo.
    const linhas =
      when === null
        ? await tx`
            update ideworks.content_items
               set scheduled_at = null, updated_at = now()
             where id = ${itemId}
             returning id`
        : await tx`
            update ideworks.content_items
               set scheduled_at = timezone(
                     ${AGENCY_TIMEZONE},
                     cast(cast(${when} as text) as timestamp)
                   ),
                   updated_at = now()
             where id = ${itemId}
             returning id`;
    return linhas.length > 0;
  });
}
