-- Desfaz a F17.2b. Ordem inversa da aplicação.
--
-- O QUE ELE DEVOLVE
--   O estado exato da F17.2: `statuses_write` volta a ser alcance puro
--   (`can_see_status_set`) e `status_sets_write` volta com a regra escrita por
--   extenso dentro dela. Nenhuma tabela, coluna ou dado é tocado — esta etapa
--   não criou nenhum.
--
--   ATENÇÃO: reverter isto REABRE o buraco medido em 2026-08-24 — funcionário
--   não-administrador volta a poder renomear, acrescentar, apagar e recolorir os
--   status da esteira do ESPAÇO, que é a esteira herdada por toda lista sem
--   esteira própria. Só reverta com isso sabido.
--
-- A ORDEM AQUI NÃO É ESTÉTICA: PRIMEIRO O QUE USA, DEPOIS O QUE É USADO
--
--     políticas → can_write_status_set → can_write_owner
--
--   POLÍTICA → FUNÇÃO É DEPENDÊNCIA REGISTRADA, E ELA RECUSA ALTO.
--   Conferido em `pg_depend` (2026-08-24): `status_sets_write` e
--   `statuses_write` estão lá, cada uma DUAS vezes — uma pelo `using`, outra
--   pelo `with check`. Com a função na frente, o `restrict` implícito do
--   `drop function` recusa com `2BP01`, exatamente o erro que já parou o
--   rollback da F17.1 na linha 1. Restaurar as políticas primeiro é o que solta
--   as funções.
--
--   ENTRE AS DUAS FUNÇÕES A DEPENDÊNCIA NÃO É REGISTRADA — E ISSO É PIOR.
--   `can_write_status_set` chama `can_write_owner`, e o Postgres NÃO anota essa
--   ligação: corpo de função `language sql` escrito como literal (`$fn$ ...
--   $fn$`) não gera dependência nenhuma — só o corpo `begin atomic` geraria.
--   Medido: ZERO elos função→função em todo o schema `ideworks`.
--
--   Ou seja, apagar `can_write_owner` primeiro não daria erro. Daria uma
--   `can_write_status_set` viva chamando uma função que não existe mais, que só
--   quebraria na próxima escrita de status — longe daqui, e sem dizer por quê.
--
--   Como as duas caem neste arquivo, o estado final é o mesmo nas duas ordens.
--   A ordem está escrita assim para o dia em que alguém aproveitar só um pedaço
--   deste rollback: recusa ruidosa a gente conserta na hora; função órfã se
--   descobre semanas depois.
--
-- AS POLÍTICAS SÃO RESTAURADAS, NÃO APAGADAS
--   Um `drop policy` sem o `create` correspondente deixaria as duas tabelas sem
--   nenhuma política de escrita: com RLS ligada e nenhuma política permissiva,
--   ninguém escreveria mais nada — e a reversão passaria a depender de alguém
--   lembrar de recriar. Cada `drop` aqui vem colado no seu `create`.
--
-- ESTE ARQUIVO PODE DEIXAR DE RODAR SOZINHO — E ISSO É CORRETO
--   Quando as POLÍTICAS da F17.5 (campos personalizados) e da F17.8
--   (visualizações) passarem a chamar `can_write_owner` — as duas têm a MESMA
--   forma de posse de três níveis —, a última linha deixa de poder rodar antes
--   da reversão delas, e aí sim com `2BP01` na cara, porque política registra a
--   dependência. Mesma nota que o rollback da F17.2 já traz para `owner_space`.

-- 1. As políticas voltam ao texto da F17.2 — e é isso que solta as funções.
drop policy if exists statuses_write on ideworks.statuses;
create policy statuses_write on ideworks.statuses for all
  using (ideworks.can_see_status_set(status_set_id))
  with check (ideworks.can_see_status_set(status_set_id));

drop policy if exists status_sets_write on ideworks.status_sets;
create policy status_sets_write on ideworks.status_sets for all
  using (
    case when space_id is not null
         then ideworks.acting_is_superadmin()
         else ideworks.can_see_space(ideworks.owner_space(space_id, folder_id, list_id))
    end)
  with check (
    case when space_id is not null
         then ideworks.acting_is_superadmin()
         else ideworks.can_see_space(ideworks.owner_space(space_id, folder_id, list_id))
    end);

-- 2. A adaptadora por id antes da regra que ela chama.
drop function if exists ideworks.can_write_status_set(uuid);
drop function if exists ideworks.can_write_owner(uuid, uuid, uuid);
