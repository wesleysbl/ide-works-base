import { describe, expect, it, vi } from 'vitest';
import type { Sql, Tx } from '@/server/db';
import type { AuthenticatedActor } from '@/server/session';
import { TETO_DE_AVISOS, countUnreadNotices, markNotice, readNotices } from '@/server/board-avisos';

vi.mock('@/server/db', () => ({
  withActor: (sql: unknown, _actor: unknown, run: (tx: unknown) => unknown) => run(sql),
}));

const actor = { userId: '00000000-0000-0000-0000-000000000001', isSuper: false, isSuperadmin: false } as AuthenticatedActor;
type Query = { text: string; values: unknown[]; then?: unknown };

function database() {
  const queries: Query[] = [];
  const tx = ((strings: TemplateStringsArray, ...args: unknown[]) => {
    const q: Query = { text: strings[0], values: [] };
    args.forEach((arg, i) => {
      if (arg && typeof arg === 'object' && 'text' in arg) {
        const fragment = arg as Query;
        q.text += fragment.text;
        q.values.push(...fragment.values);
      } else {
        q.text += '?';
        q.values.push(arg);
      }
      q.text += strings[i + 1];
    });
    return Object.assign(q, { then(resolve: (rows: unknown[]) => void) {
      queries.push(q);
      if (q.text.includes('as unread')) return resolve([{ unread: 1 }]);
      if (q.text.includes("'agente'::text as tipo")) return resolve([{
        key: 'agent:move:exec-1', tipo: 'agente', task_id: 'task-9',
        task_title: 'Card movido', agent_event: 'move', agent_name: 'Claude do atendimento',
        daily_limit: 50, occurred_at: '2026-09-21T12:00:00Z', seen: false,
      }]);
      if (q.text.includes("'atribuicao'::text as tipo")) return resolve([{
        key: 'assignment:event-1', tipo: 'atribuicao', task_id: 'task-1',
        task_title: 'Post', occurred_at: '2026-09-14T12:00:00Z', seen: false,
      }]);
      resolve([]);
    } });
  }) as unknown as Tx;
  return { sql: tx as unknown as Sql, queries };
}

describe('notificações de atribuição manual', () => {
  it('lista e ambos os contadores consultam os novos destinatários, sem autoatribuições', async () => {
    const { sql, queries } = database();
    const result = await readNotices(sql, actor, false);
    // A caixa passou a ter mais de uma fonte simulada (F21.3 somou a de
    // agente): o que este caso mede é a de atribuição, e só ela.
    const atribuicoesLidas = result.notices.filter((a) => a.tipo === 'atribuicao');
    expect(atribuicoesLidas).toHaveLength(1);
    expect(atribuicoesLidas[0]).toMatchObject({ key: 'assignment:event-1', tipo: 'atribuicao', seen: false });
    expect(result.unread).toBe(1);
    expect(await countUnreadNotices(sql, actor)).toBe(1);
    const assignments = queries.filter(q => q.text.includes('any(e.added_user_ids)'));
    expect(assignments).toHaveLength(3);
    for (const q of assignments) {
      expect(q.text).toContain('e.actor_id is distinct from ?::uuid');
      expect(q.text).toContain('t.archived_at is null');
      expect(q.text).toContain("nr.notice_key = 'assignment:' || e.id::text");
      expect(q.values.filter(v => v === actor.userId).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('marcar e desmarcar usam a chave do evento e a identidade de quem leu', async () => {
    const { sql, queries } = database();
    await markNotice(sql, actor, 'assignment:event-1', true);
    await markNotice(sql, actor, 'assignment:event-1', false);
    expect(queries[0].text).toContain('on conflict do nothing');
    expect(queries[1].text).toContain('delete from ideworks.notice_reads');
    for (const q of queries) expect(q.values).toEqual([actor.userId, 'assignment:event-1']);
  });
});


/**
 * F21.3 — A FONTE DE AVISO DE AGENTE.
 *
 * O que estes casos provam é a FORMA da consulta: de onde ela lê, para quem
 * ela é, quais são os três gatilhos e que ela usa o mesmo teto e o mesmo
 * visto das outras. Que a POLÍTICA DE LINHA recorta o resto — que o dono de
 * outra concessão não vê esta — é banco de verdade, e quem mede é a prova em
 * `scripts/`, exatamente como nos avisos de automação.
 */
describe('avisos de escrita de agente', () => {
  const consultasDeAgente = (queries: Query[]) =>
    queries.filter((q) => q.text.includes('ideworks.integration_executions'));

  it('lê do registro de execuções que já existe, e só para o dono da concessão', async () => {
    const { sql, queries } = database();
    await readNotices(sql, actor, false);

    const agentes = consultasDeAgente(queries);
    // Uma na listagem e uma na conta de não vistos: o mesmo pedaço de SQL.
    expect(agentes).toHaveLength(2);
    for (const q of agentes) {
      expect(q.text).toContain('from ideworks.integration_executions e');
      // O DESTINATÁRIO É O DONO. Nada de "quem observa a tarefa".
      expect(q.text).toContain('where e.owner_id = ?');
      expect(q.values).toContain(actor.userId);
      // Nenhuma tabela nova de evento de aviso.
      expect(q.text).not.toMatch(/integration_(notice|alert)/i);
    }
  });

  it('gera aviso nos três casos decididos, e o comentário de rotina fica de fora', async () => {
    const { sql, queries } = database();
    await readNotices(sql, actor, false);
    const [q] = consultasDeAgente(queries);

    // Os três casos, e só eles.
    expect(q.text).toContain("(values ('move'::text), ('limit'::text), ('first'::text)) as c(caso)");
    // MOVIMENTO: fato direto da linha.
    expect(q.text).toContain("when 'move'  then b.operation = 'move_task'");
    // TETO BATIDO: a escrita que ocupou a última vaga do dia — a recusa não
    // vira linha, então o aviso nasce da última que passou.
    expect(q.text).toContain("when 'limit' then b.teto > 0 and b.ordem_do_dia = b.teto");
    // PRIMEIRA ESCRITA: a mais antiga daquela concessão.
    expect(q.text).toContain('else              b.ordem_total = 1');

    // E NADA MAIS. Comentário de rotina não casa com caso nenhum: cinquenta
    // deles passam por aqui sem gerar um aviso.
    expect(q.text).not.toContain("b.operation = 'add_comment' then");
  });

  it('estrear e bater o teto no mesmo dia são DOIS avisos, com duas chaves', async () => {
    const { sql, queries } = database();
    await readNotices(sql, actor, false);
    const [q] = consultasDeAgente(queries);

    // O `cross join lateral` devolve UMA LINHA POR CASO QUE VALE, e a chave
    // carrega o caso: a mesma escrita pode render `agent:first:<id>` e
    // `agent:limit:<id>`, com dois vistos independentes.
    expect(q.text).toContain("as c(caso)");
    expect(q.text).toContain("nr.notice_key = 'agent:' || c.caso || ':' || b.id::text");
    expect(q.text).toContain("'agent:' || c.caso || ':' || b.id::text as key");
  });

  it('respeita o teto de linhas, o visto e o recorte das outras fontes', async () => {
    const { sql, queries } = database();
    const result = await readNotices(sql, actor, false);

    const [listagem] = consultasDeAgente(queries);
    expect(listagem.values).toContain(TETO_DE_AVISOS);
    expect(listagem.text).toContain('(nr.user_id is not null) as seen');
    expect(listagem.text).toContain('left join ideworks.notice_reads nr');
    // Perder o acesso à tarefa oculta o aviso: o alvo TEM de aparecer (F26.6
    // trocou o `join` por três `left join` exclusivos, e o `where` cobra o alvo
    // da operação). Tarefa arquivada continua fora.
    expect(listagem.text).toContain(
      "where ((t.id is not null and t.archived_at is null) or mn.id is not null or ch.id is not null)",
    );
    // Escrita já desfeita não cobra ação nenhuma.
    expect(listagem.text).toContain("to_jsonb(e) ->> 'undone_at' as undone_at");
    expect(listagem.text).toContain('where z.undone_at is null');
    // O teto do dia é lido do registro inteiro: o deploy pode chegar antes da
    // migration da F21.1 sem derrubar a caixa de entrada.
    expect(listagem.text).toContain("to_jsonb(g) ->> 'daily_write_limit'");

    const aviso = result.notices.find((a) => a.tipo === 'agente');
    expect(aviso).toMatchObject({
      key: 'agent:move:exec-1',
      taskId: 'task-9',
      agentEvent: 'move',
      agentName: 'Claude do atendimento',
      dailyLimit: 50,
      seen: false,
    });
  });

  it('a conta de não vistos soma a fonte nova, igual às outras', async () => {
    const { sql, queries } = database();
    await countUnreadNotices(sql, actor);
    const [conta] = queries.filter((q) => q.text.includes('as unread'));
    expect(conta.text).toContain('ideworks.integration_executions');
    expect(conta.text).toContain('count(*) filter (where nr.user_id is null)');
  });
});

describe('avisos de menção no chat', () => {
  it('consulta chat_mentions e entra na conta de não vistos', async () => {
    const { sql, queries } = database();
    await readNotices(sql, actor, false);
    await countUnreadNotices(sql, actor);
    const chat = queries.filter((q) => q.text.includes('ideworks.chat_mentions'));
    expect(chat.length).toBeGreaterThanOrEqual(2);
    for (const q of chat) {
      expect(q.text).toContain("nr.notice_key = 'chat_mention:' || m.id::text");
      expect(q.text).toContain('msg.deleted_at is null');
      expect(q.text).toContain('ideworks.chat_retention()');
    }
    const [conta] = queries.filter((q) => q.text.includes('as unread'));
    expect(conta.text).toContain('ideworks.chat_mentions');
  });
});

/**
 * F26.6 — O AVISO TAMBÉM ENXERGA NOTA DO MURAL E REGISTRO DO HISTÓRICO.
 *
 * Até a F26.5 todo alvo era tarefa, e o `join` INNER com `tasks` deixava sem
 * aviso a estreia (e o teto) de uma conexão cuja escrita caiu no mural ou no
 * histórico. A forma provada aqui: cada alvo sai da tabela certa, SÓ para as
 * operações dele, o cliente vem do alvo, e o comportamento das tarefas fica.
 */
describe('avisos de agente com alvo no mural e no histórico', () => {
  const consultaDeAgente = (queries: Query[]) =>
    queries.filter((q) => q.text.includes('ideworks.integration_executions'))[0];

  it('cada alvo é lido da sua tabela, e só para as operações dele', async () => {
    const { sql, queries } = database();
    await readNotices(sql, actor, false);
    const q = consultaDeAgente(queries);
    expect(q.text).toContain('left join ideworks.tasks t');
    expect(q.text).toContain(
      "and b.operation not in ('add_mural_note', 'update_mural_note',\n                                  'add_history_entry', 'update_history_entry')",
    );
    expect(q.text).toContain('left join ideworks.mural_notes mn');
    expect(q.text).toContain("and b.operation in ('add_mural_note', 'update_mural_note')");
    expect(q.text).toContain('left join ideworks.client_history ch');
    expect(q.text).toContain("and b.operation in ('add_history_entry', 'update_history_entry')");
    // O cliente vem do alvo, seja ele qual for.
    expect(q.text).toContain('cl.id = coalesce(t.client_id, mn.client_id, ch.client_id)');
  });

  it('o aviso diz o tipo de alvo e o cliente, e o título nunca é o texto da nota', async () => {
    const { sql, queries } = database();
    await readNotices(sql, actor, false);
    const q = consultaDeAgente(queries);
    expect(q.text).toContain("then 'mural_note'");
    expect(q.text).toContain("then 'history_entry'");
    expect(q.text).toContain('cl.id as client_id');
    expect(q.text).toContain("coalesce(nullif(btrim(mn.title), ''), 'Nota do mural')");
    expect(q.text).not.toContain('mn.content');
    expect(q.text).not.toContain('ch.body');
  });

  it('a conta de não vistos usa a mesma fonte, com os três alvos', async () => {
    const { sql, queries } = database();
    await countUnreadNotices(sql, actor);
    const [conta] = queries.filter((q) => q.text.includes('as unread'));
    expect(conta.text).toContain('left join ideworks.mural_notes mn');
    expect(conta.text).toContain('left join ideworks.client_history ch');
  });
});

describe('o aviso de agente de nota traz o cliente, e não uma tarefa', () => {
  it('comoAviso lê client_id e target_kind', async () => {
    const queries: Query[] = [];
    const tx = ((strings: TemplateStringsArray, ...args: unknown[]) => {
      const q: Query = { text: strings.join('?'), values: args };
      return Object.assign(q, {
        then(resolve: (rows: unknown[]) => void) {
          queries.push(q);
          if (q.text.includes('as unread')) return resolve([{ unread: 1 }]);
          if (q.text.includes("'agente'::text as tipo")) {
            return resolve([
              {
                key: 'agent:first:exec-7',
                tipo: 'agente',
                task_id: null,
                task_title: 'Reunião de pauta',
                list_name: 'Mural',
                client_name: 'Clinimax',
                client_id: 'cliente-7',
                target_kind: 'mural_note',
                agent_event: 'first',
                agent_name: 'Claude',
                daily_limit: 50,
                occurred_at: '2026-09-22T12:00:00Z',
                seen: false,
              },
            ]);
          }
          resolve([]);
        },
      });
    }) as unknown as Sql;
    const result = await readNotices(tx, actor, false);
    const aviso = result.notices.find((a) => a.tipo === 'agente');
    expect(aviso).toMatchObject({
      taskId: '',
      clientId: 'cliente-7',
      targetKind: 'mural_note',
      clientName: 'Clinimax',
      listName: 'Mural',
    });
  });
});

/**
 * F42, Fase 7 — A RESPOSTA DO CLIENTE PELO LINK.
 *
 * A forma da consulta: de onde lê, para quem é, a chave estável e que ela
 * entra nas duas contagens. Que a política das rodadas recorta (responsável sem
 * alcance ao cliente não recebe) e que marcar como visto é por pessoa está
 * provado no Postgres em `aprovacao-sino-banco.test.ts`.
 */
describe('avisos da aprovação do cliente', () => {
  const consultasDeAprovacao = (queries: Query[]) => queries.filter((q) => q.text.includes('ideworks.approval_rounds r'));

  it('lê as rodadas DECIDIDAS, para quem enviou e para os responsáveis, com a chave da rodada', async () => {
    const { sql, queries } = database();
    await readNotices(sql, actor, false);
    const aprovacoes = consultasDeAprovacao(queries);
    // Uma na listagem e uma na conta de não vistos.
    expect(aprovacoes).toHaveLength(2);
    for (const q of aprovacoes) {
      expect(q.text).toContain("r.state in ('approved', 'rejected')");
      expect(q.text).toContain('r.sent_by = ?::uuid');
      expect(q.text).toContain('a.task_id = r.task_id and a.user_id = ?::uuid');
      expect(q.text).toContain("nr.notice_key = 'approval:' || r.id::text");
      expect(q.text).toContain('t.archived_at is null');
      expect(q.values.filter((v) => v === actor.userId).length).toBeGreaterThanOrEqual(3);
    }
    const [lista] = aprovacoes.filter((q) => q.text.includes("'aprovacao'::text as tipo"));
    expect(lista.text).toContain("'approval:' || r.id::text as key");
    // O motivo (o comentário da decisão) é o destino do aviso.
    expect(lista.text).toContain('r.decision_comment_id as comment_id');
  });

  it('a barra lateral conta a fonte nova também', async () => {
    const { sql, queries } = database();
    await countUnreadNotices(sql, actor);
    const [conta] = queries.filter((q) => q.text.includes('as unread'));
    expect(conta.text).toContain('ideworks.approval_rounds r');
  });

  it('a linha vira aviso tipado, com a decisão e a versão', async () => {
    const tx = ((strings: TemplateStringsArray, ...args: unknown[]) => {
      const q: Query = { text: strings.join('?'), values: args };
      return Object.assign(q, {
        then(resolve: (rows: unknown[]) => void) {
          if (q.text.includes('as unread')) return resolve([{ unread: 1 }]);
          if (q.text.includes("'aprovacao'::text as tipo")) {
            return resolve([
              {
                key: 'approval:r1', tipo: 'aprovacao', task_id: 'task-7', task_title: 'Carrossel',
                occurred_at: '2026-10-07T15:00:00Z', comment_id: 'c9', approval_decision: 'rejected',
                approval_version: 3, seen: false,
              },
            ]);
          }
          resolve([]);
        },
      });
    }) as unknown as Tx;
    const r = await readNotices(tx as unknown as Sql, actor, false);
    const [aviso] = r.notices.filter((a) => a.tipo === 'aprovacao');
    expect(aviso).toMatchObject({
      key: 'approval:r1', tipo: 'aprovacao', taskId: 'task-7', commentId: 'c9',
      approvalDecision: 'rejected', approvalVersion: 3, seen: false,
    });
  });

  it('marcar e desmarcar aceitam a chave da rodada', async () => {
    const { sql, queries } = database();
    await markNotice(sql, actor, 'approval:r1', true);
    await markNotice(sql, actor, 'approval:r1', false);
    for (const q of queries) expect(q.values).toEqual([actor.userId, 'approval:r1']);
  });
});
