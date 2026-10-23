-- =============================================================================
-- IDE WORKS — F4.5  Escrita de cliente
-- =============================================================================
-- O QUE ESTA ETAPA DESTRAVA
--   Ate aqui o cockpit era somente-leitura: o cadastro de cliente continuava
--   acontecendo no Sistema IDE. Duas coisas faltavam no banco.
--
-- 1 · OS LINKS DO CLIENTE
--   A ficha do legado mostra WhatsApp, Instagram, Facebook, Meu Negocio e
--   TikTok. Ja e tabela la (`public.client_links`, 309 linhas em 72 clientes,
--   ate 14 num mesmo cliente). O que muda aqui sao tres coisas, e cada uma sai
--   de uma medicao no dado real do legado, feita em 2026-08-20:
--
--   (a) ORDEM EXPLICITA. La nao ha coluna de ordem, entao a ficha lista pela
--       ordem que o banco devolver — que muda sozinha depois de um UPDATE, e
--       ninguem entende por que o WhatsApp desceu.
--
--   (b) DUPLICATA IMPOSSIVEL. La nao ha unicidade, e existe uma acao de API
--       chamada `clients__dedupe_links` **so para remendar isso**. Medido:
--       19 clientes com o mesmo link repetido. Aqui o par titulo+link e unico
--       por cliente, entao a acao de reparo perde a razao de existir — mesmo
--       argumento da D2 sobre as cinco acoes de reparo de conteudo.
--
--       O indice e sobre titulo+link, NAO sobre link sozinho: os 19 casos sao
--       o mesmo endereco com rotulos diferentes ("WhatsApp" e "WhatsApp
--       Comercial"), que e uso legitimo. Unicidade so no link recusaria dado
--       verdadeiro na migracao da F11.
--
--   (c) LINK QUE EXECUTA SCRIPT NAO ENTRA. A ficha e aberta por todo o time e
--       um link e um alvo de clique.
--
--       PRIMEIRA VERSAO DESTA REGRA ESTAVA ERRADA e foi corrigida antes de
--       chegar a tela: eu exigia `https?://`, e os 3 links do legado que
--       falham nessa regra sao **dados legitimos** — dois `sheinlink://` de
--       loja Shein e um LinkedIn sem esquema. A agencia trabalha com
--       marketplace, e cada marketplace inventa o seu esquema proprio.
--
--       Lista fechada de esquemas permitidos, portanto, nao serve: ela estaria
--       desatualizada no dia seguinte. O que se exige e `esquema://alguma
--       coisa` — o que ja recusa `javascript:x` e `data:x`, que nao tem `//` —
--       mais a recusa nominal dos que executam, porque `javascript://` COM as
--       barras e um desvio conhecido (o resto da linha vira comentario em JS).
--
-- 2 · AS CHAVES QUE A OPERACAO VIRA TODO DIA
--   `urgency` e `finance_ok` moram em `clients`, e a politica de escrita de
--   `clients` exige administrador. Correto para plano, data e contrato — errado
--   para estas duas: quem cuida da carteira precisa marcar "este cliente virou
--   perigo" sem depender de um administrador acordar.
--
--   RLS decide por LINHA, nao por coluna. Nao ha politica que diga "pode
--   atualizar so estas duas". Entao a permissao mais fina sai por acao, do
--   mesmo jeito que `complete_item` na F3.2: funcao com dono, que confere
--   `can_see_client` por dentro.
--
--   O que continua exigindo administrador, e por que:
--     plano, categoria, datas, cota      e contrato — muda o que se cobra
--     ativo / inativo                    e fim de relacao comercial
--     nome, documento, contato           e cadastro
-- =============================================================================

-- --- links da ficha -----------------------------------------------------------
create table if not exists ideworks.client_links (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references ideworks.clients (id) on delete cascade,
  title      text not null,
  url        text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),

  -- Titulo em branco vira um botao sem rotulo na ficha: clicavel e mudo.
  constraint client_links_title_not_blank check (btrim(title) <> ''),

  -- Ver (c) no cabecalho. Exige `esquema://alguma coisa` e recusa nominalmente
  -- os esquemas que executam. Aceita `sheinlink://`, `whatsapp://`, e o que a
  -- proxima loja inventar.
  constraint client_links_url_is_safe check (
    url ~* '^[a-z][a-z0-9+.-]*://.'
    and url !~* '^(javascript|data|vbscript|file):'
  )
);

create index if not exists client_links_client_idx
  on ideworks.client_links (client_id, sort_order);

-- Ver (b) no cabecalho: e este indice que aposenta `clients__dedupe_links`.
create unique index if not exists client_links_sem_duplicata
  on ideworks.client_links (client_id, lower(btrim(title)), lower(btrim(url)));

comment on table ideworks.client_links is
  'Links da ficha do cliente. Existe no legado como `public.client_links`; aqui '
  'ganha ordem explicita, unicidade que torna a acao de deduplicacao '
  'desnecessaria, e recusa de link que executa script.';
comment on constraint client_links_url_is_safe on ideworks.client_links is
  'Exige `esquema://alguma coisa` e recusa javascript/data/vbscript/file. NAO e '
  'lista fechada de esquemas: o legado tem `sheinlink://` legitimo, e cada '
  'marketplace inventa o seu.';

alter table ideworks.client_links enable row level security;

-- Quem enxerga o cliente le os links dele; escrever e cadastro, entao e do
-- administrador, igual ao resto da ficha.
create policy client_links_select on ideworks.client_links for select
  using (ideworks.can_see_client(client_id));
create policy client_links_write on ideworks.client_links for all
  using (ideworks.acting_is_superadmin()) with check (ideworks.acting_is_superadmin());

-- --- as chaves operacionais ---------------------------------------------------
-- Nulo em um parametro significa "nao mexa nisto", e nao "apague". As duas
-- chaves sao independentes: a tela liga uma sem saber o valor da outra.
create or replace function ideworks.set_client_flags(
  p_client_id  uuid,
  p_urgency    ideworks.urgency_level default null,
  p_finance_ok boolean default null
) returns void
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if p_urgency is null and p_finance_ok is null then
    raise exception 'nada a alterar: informe urgencia ou financeiro'
      using errcode = '22023';
  end if;

  update ideworks.clients
     set urgency    = coalesce(p_urgency, urgency),
         finance_ok = coalesce(p_finance_ok, finance_ok),
         updated_at = now()
   where id = p_client_id
     and ideworks.can_see_client(id);

  -- A recusa e indistinguivel entre "nao existe" e "nao e seu", de proposito:
  -- a diferenca entre as duas revelaria a existencia de cliente de outra
  -- carteira para quem perguntasse por ID.
  if not found then
    raise exception 'cliente nao encontrado ou fora do seu alcance'
      using errcode = '42501';
  end if;
end;
$fn$;

comment on function ideworks.set_client_flags(uuid, ideworks.urgency_level, boolean) is
  'Urgencia e financeiro-ok: as duas chaves que a operacao vira todo dia. '
  'Exige enxergar o cliente, NAO ser administrador — RLS decide por linha e '
  'nao saberia distinguir estas colunas das contratuais.';

-- --- ativar e desativar -------------------------------------------------------
-- Existe como acao porque `is_active` e `inactive_at` andam juntos: a restricao
-- `clients_inactive_has_date` recusa desligado-sem-data e ligado-com-data. Duas
-- escritas separadas a cargo de quem chama e um convite a errar uma delas.
create or replace function ideworks.set_client_active(
  p_client_id uuid,
  p_active    boolean
) returns void
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so administrador ativa ou desativa cliente'
      using errcode = '42501';
  end if;

  update ideworks.clients
     set is_active   = p_active,
         -- Reativar limpa a data. Manter a antiga faria "inativo desde" mentir
         -- na proxima vez que o cliente saisse.
         inactive_at = case when p_active then null else coalesce(inactive_at, now()) end,
         updated_at  = now()
   where id = p_client_id;

  if not found then
    raise exception 'cliente nao encontrado' using errcode = '42501';
  end if;
end;
$fn$;

comment on function ideworks.set_client_active(uuid, boolean) is
  'Liga e desliga o cliente mantendo `inactive_at` coerente com `is_active`. '
  'Reativar limpa a data — guardar a antiga faria "inativo desde" mentir.';

grant execute on function ideworks.set_client_flags(uuid, ideworks.urgency_level, boolean)
  to ideworks_app;
grant execute on function ideworks.set_client_active(uuid, boolean) to ideworks_app;
grant all privileges on all tables in schema ideworks to ideworks_app;
