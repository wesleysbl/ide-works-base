-- =============================================================================
-- ROLLBACK da F17.36b — quem tem `entrega` ganha o `quadro`
-- =============================================================================
-- ⚠️ SO RODE ISTO COM O CODIGO VELHO NO AR. Enquanto `src/auth/areas.ts`
-- classificar `/board` como `quadro`, tirar `quadro` das listas tranca a equipe
-- inteira fora do quadro — que e exatamente o 403 que a F17.36b existe para
-- impedir.
--
-- ⚠️ E ELE NAO DISTINGUE O QUE ESTA MIGRATION DEU DO QUE UM HUMANO DEU DEPOIS
--   A F17.36b deu `quadro` a quem tinha `entrega`. Depois disso, quem administra
--   pode ter tirado `entrega` de alguem e deixado so o `quadro`, ou dado
--   `quadro` a quem nunca teve `entrega`. Este rollback tira `quadro` de TODO
--   mundo, e essas decisoes se perdem.
--
--   Nao ha como separa-las: a coluna guarda o estado, e nao a historia de quem
--   o escreveu. O `admin_audit` guarda as mudancas de area feitas pela tela, e
--   e por ele que se remonta a mao o que era intencional.
--
-- O PADRAO E A FUNCAO VOLTAM EXATOS.
-- =============================================================================

update ideworks.profiles
   set areas = array_remove(areas, 'quadro'::ideworks.area),
       updated_at = now()
 where 'quadro' = any(areas);

update ideworks.invitations
   set areas = array_remove(areas, 'quadro'::ideworks.area)
 where 'quadro' = any(areas);

alter table ideworks.profiles
  alter column areas set default '{entrega}'::ideworks.area[];

create or replace function ideworks.acting_areas()
  returns ideworks.area[]
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select case
           when ideworks.acting_is_superadmin()
             then '{entrega,meta,catalogos,pessoas}'::ideworks.area[]
           else coalesce(
             (select p.areas from ideworks.profiles p where p.id = ideworks.acting_user_id()),
             '{}'::ideworks.area[]
           )
         end;
$fn$;

comment on column ideworks.profiles.areas is
  'As partes do sistema que esta pessoa alcanca. Quem administra alcanca todas '
  'sem depender desta coluna — ver `acting_areas`.';
