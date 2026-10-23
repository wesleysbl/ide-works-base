-- =============================================================================
-- IDE WORKS — F17.36b  Quem tem `entrega` ganha o `quadro`
-- =============================================================================
-- ⚠️ ESTA E A METADE QUE IMPEDE O ESTRAGO, E ELA E O MOTIVO DA ETAPA TER RISCO
--   A F17.36 criou o valor `quadro`. Sozinho, ele nao muda nada. O dano nasce
--   no instante em que o codigo passa a classificar `/board` como `quadro`: a
--   partir dali, quem nao tiver `quadro` na propria lista abre o quadro e leva
--   403 — e "quem nao tem" seria, sem esta migration, TODA a equipe.
--
--   Entao a regra desta etapa e uma so: ninguem perde o quadro por causa de uma
--   etapa que so queria criar a caixinha. Quem hoje trabalha no quadro trabalha
--   nele porque tem `entrega`; logo, todo perfil com `entrega` recebe `quadro`.
--   Separar depois e ato humano, pessoa por pessoa, na tela de pessoas.
--
-- ELA E TRANSACIONAL, E A F17.36 NAO PODIA SER
--   `alter type ... add value` e o `update` que usa o valor novo nao cabem na
--   mesma transacao (ver o cabecalho da F17.36). Aqui nao ha `alter type`:
--   estas quatro instrucoes correm juntas, e ou todas valem ou nenhuma vale.
--
-- O CONVITE PENDENTE TAMBEM CONTA
--   `ideworks.invitations.areas` guarda o acesso PROMETIDO, e `aplicar_convite`
--   o copia para o perfil quando a pessoa ativa. Um convite feito ontem com
--   `entrega` criaria, amanha, a primeira pessoa do sistema sem quadro — e
--   ninguem ligaria uma coisa a outra.
--
-- O PADRAO DA COLUNA MUDA PELO MESMO MOTIVO
--   `'{entrega}'` era "uma pessoa nova precisa conseguir trabalhar" (F13). O
--   lugar onde se trabalha passou a ser o quadro, entao o padrao passa a ser
--   `'{entrega,quadro}'`. Ele quase nunca e usado — o convite diz as areas —,
--   mas quando for, precisa dizer a mesma coisa.
--
-- SEGURANCA POR LINHA
--   Nenhuma tabela nova, nenhuma politica nova. `acting_areas()` continua
--   `security definer` com `search_path` fixo; o que muda nela e uma lista
--   literal, que estava incompleta desde o instante em que o enum cresceu.
-- =============================================================================

-- --- 1. ninguem perde o quadro ------------------------------------------------
update ideworks.profiles
   set areas = areas || 'quadro'::ideworks.area,
       updated_at = now()
 where 'entrega' = any(areas)
   and not ('quadro' = any(areas));

-- --- 2. nem quem ainda nem entrou ---------------------------------------------
update ideworks.invitations
   set areas = areas || 'quadro'::ideworks.area
 where status = 'pending'
   and 'entrega' = any(areas)
   and not ('quadro' = any(areas));

-- --- 3. o padrao de quem chegar depois ----------------------------------------
alter table ideworks.profiles
  alter column areas set default '{entrega,quadro}'::ideworks.area[];

-- --- 4. quem administra alcanca a area nova tambem -----------------------------
-- A lista e literal, e literal incompleto e mentira silenciosa: sem `quadro`
-- aqui, `acting_areas()` responderia que quem administra NAO alcanca o quadro.
create or replace function ideworks.acting_areas()
  returns ideworks.area[]
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select case
           when ideworks.acting_is_superadmin()
             then '{entrega,quadro,meta,catalogos,pessoas}'::ideworks.area[]
           else coalesce(
             (select p.areas from ideworks.profiles p where p.id = ideworks.acting_user_id()),
             '{}'::ideworks.area[]
           )
         end;
$fn$;

comment on column ideworks.profiles.areas is
  'As partes do sistema que esta pessoa alcanca. Quem administra alcanca todas '
  'sem depender desta coluna — ver `acting_areas`. Desde a F17.36 o quadro do '
  'Pilar B e area propria (`quadro`), e nao mais parte de `entrega`.';
