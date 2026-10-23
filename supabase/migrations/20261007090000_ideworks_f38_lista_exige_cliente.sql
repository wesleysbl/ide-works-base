-- F38, Fase 6 — a tarefa nasce com cliente (parte 1 de 2: a regra, sem marcar lista).
--
-- O QUE MUDA
--   1. `lists.requires_client` (boolean, padrão false): a lista SEM cliente que
--      leva esta marca é COMPARTILHADA — toda tarefa nova dela precisa de um
--      cliente escolhido. Lista sem cliente e sem a marca é INTERNA: a tarefa
--      dela pode ficar sem cliente.
--   2. O gatilho `tasks_client_from_list`, só no INSERT de tarefa raiz:
--      · tarefa sem cliente em lista de cliente herda o cliente da lista;
--      · tarefa sem cliente em lista compartilhada (marcada) é recusada (23514).
--
-- O QUE ESTA MIGRATION NÃO FAZ: MARCAR AS LISTAS (decisão do Wesley, 07/10)
--   Nenhuma lista recebe a marca aqui. Com todas em `false`, nada é bloqueado:
--   tarefa em lista de cliente passa a herdar o cliente, e as listas
--   compartilhadas (ATENDIMENTO, ESTÚDIO, Estúdio Ide, Jobs Antonelli) continuam
--   aceitando tarefa sem cliente, como hoje. Pode ser aplicada já.
--   A marca das quatro mora em
--   `20261007100000_ideworks_f38_marcar_listas_compartilhadas.sql`, que só
--   entra junto com a publicação da Fase 7 (o seletor de cliente no quadro) —
--   antes dele, a equipe não teria como escolher o cliente e ficaria travada.
--
-- POR QUE A HERANÇA É GATILHO, E NÃO SÓ CÓDIGO
--   Quem insere tarefa hoje é o quadro e o MCP (os dois por
--   `createBoardTaskInTx`), mas também as subtarefas (`createSubtask`) e os
--   scripts de importação. Uma regra do modelo mora no banco — é como a
--   subtarefa já herda lista e cliente da mãe (`task_parent_guard`). O código
--   continua conferindo ANTES (para dar a frase certa a cada um e recusar
--   cliente cancelado ou fora do alcance); o gatilho é a garantia de que nenhum
--   caminho esquecido grave tarefa de lista de cliente sem o cliente.
--
-- O QUE O GATILHO NÃO FAZ (de propósito)
--   · SUBTAREFA (`parent_id` preenchido) passa reto: ela herda o cliente da mãe
--     pelo `task_parent_guard`, e mãe e filha com clientes diferentes seriam
--     lidas por gente diferente. O nome `tasks_client_from_list` dispara ANTES
--     de `tasks_parent_guard` (ordem alfabética), quando a subtarefa ainda nem
--     tem lista; a saída explícita por `parent_id` vale qualquer que seja a
--     ordem.
--   · UPDATE: mover tarefa entre listas não mexe no cliente aqui. Isso é a
--     Fase 7 (cartão) e o caso de borda "tarefa movida" do plano.
--   · Tarefas existentes: nenhuma é preenchida. A faxina é a Fase 8.
--
-- REVERSÃO (aditiva; nada some além do que esta migration criou)
--   -- Se a 20261007100000 (marca das listas) já foi aplicada, a marca some
--   -- junto com a coluna; não precisa revertê-la antes.
--   drop trigger if exists tasks_client_from_list on ideworks.tasks;
--   drop function if exists ideworks.task_client_from_list();
--   alter table ideworks.lists drop column if exists requires_client;
--   -- Depois: node scripts/conferir-schema.mjs --gravar (o retrato volta ao de antes).
--   -- As tarefas criadas enquanto valeu continuam com o cliente gravado, que é
--   -- o que se quer; nenhuma reversão de dado é necessária.

alter table ideworks.lists
  add column if not exists requires_client boolean not null default false;

comment on column ideworks.lists.requires_client is
  'F38: lista sem cliente que exige cliente em toda tarefa nova (lista compartilhada). '
  'Sem cliente e sem a marca, a lista é interna e a tarefa pode ficar sem cliente.';

create or replace function ideworks.task_client_from_list()
  returns trigger
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_client   uuid;
  v_requires boolean;
begin
  -- Subtarefa: o cliente é o da mãe (`task_parent_guard`). Tarefa sem lista
  -- (demanda antiga do cliente): não há lista de onde herdar.
  if new.parent_id is not null or new.list_id is null then
    return new;
  end if;

  -- Escolhido na tarefa: fica o escolhido. Quem confere se o cliente é
  -- alcançável, ativo e compatível com a lista é o código (`createBoardTaskInTx`).
  if new.client_id is not null then
    return new;
  end if;

  select l.client_id, l.requires_client
    into v_client, v_requires
    from ideworks.lists l
   where l.id = new.list_id;

  -- Lista inexistente: quem recusa é a chave estrangeira, com a frase dela.
  if not found then
    return new;
  end if;

  if v_client is not null then
    new.client_id := v_client;
    return new;
  end if;

  if v_requires then
    raise exception
      'Esta lista é compartilhada: toda tarefa dela precisa de um cliente. Escolha o cliente ao criar, ou crie a tarefa na lista do cliente.'
      using errcode = '23514';
  end if;

  -- Lista interna: a tarefa fica sem cliente.
  return new;
end;
$fn$;

comment on function ideworks.task_client_from_list() is
  'F38, Fase 6: no INSERT de tarefa raiz sem cliente, herda o cliente da lista; '
  'em lista compartilhada (requires_client) sem cliente, recusa com 23514. '
  'Subtarefa e tarefa sem lista passam reto.';

drop trigger if exists tasks_client_from_list on ideworks.tasks;
create trigger tasks_client_from_list
  before insert on ideworks.tasks
  for each row execute function ideworks.task_client_from_list();
