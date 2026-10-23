-- =============================================================================
-- IDE WORKS — F17.44  O compromisso, que ocupa o dia e nao entrega nada
-- =============================================================================
-- O ACHADO DO USUARIO
--   *"Qual a logica do calendario de cada cliente e o geral sendo que eles nao
--   possuem botao de +? Onde sao adicionadas essas entregas? Compromissos?"*
--
--   O calendario nasceu visor: o conteudo nasce em `Conteudos` e no `Semanal`,
--   e a grade so desenha. Para virar agenda ele precisa aceitar duas coisas
--   diferentes — a ENTREGA, que o cliente contratou, e o COMPROMISSO, que
--   ocupa o dia e nao entrega nada.
--
-- ⚠️ POR QUE ISTO E UMA TABELA NOVA, E NAO UM VALOR NOVO DE `content_type`
--
--   A separacao e o coracao da etapa, nao um rotulo:
--
--     entrega      conta na cota do mes  — e o que o cliente contratou
--     compromisso  NAO conta             — reuniao, gravacao, viagem
--
--   Se compromisso entrar na conta, o medidor de entrega do cliente passa a
--   mentir, e o nivel de entrega que o painel calcula vai junto.
--
--   Um valor novo no enum `ideworks.content_type` poria a decisao em CADA
--   consulta que conta. Sao quatro hoje — duas em `panel.ts`, uma em
--   `client-detail.ts`, uma em `calendar.ts` — mais a contagem da base na tela
--   semanal e mais `delivery/level.ts`, que RECUSA tipo desconhecido. Esquecer
--   um `where` em qualquer uma delas e uma cota errada que ninguem ve.
--
--   Numa tabela separada nao ha `where` para esquecer: `content_items` nao
--   muda, e por isso NENHUMA conta muda. A prova disso e aritmetica, e nao
--   inspecao — `scripts/provar-a-agenda.mjs` mede a cota antes e depois.
--
--   E o compromisso tambem nao CABE em `content_items`: nao tem tipo de
--   conteudo, nao tem mes de competencia, nao e extra e nao se conclui. Seriam
--   quatro colunas obrigatorias sem sentido para metade das linhas.
--
-- ⚠️ DIA CIVIL E HORA CIVIL, E NAO UM INSTANTE
--   `content_items.scheduled_at` e `timestamptz`, e e dai que sai a divida que
--   esta etapa fecha: item sem hora grava meia-noite, e a pastilha do
--   calendario mostrava `00:00` para 2.598 dos 2.626 conteudos com data
--   (medido em 2026-08-31).
--
--   Aqui o dia e `date` e a hora e `time` ANULAVEL. Hora que nao existe e
--   `null`, e `null` nao vira `00:00` em formatacao nenhuma. O defeito nao e
--   corrigido: ele fica impossivel de escrever.
--
--   De quebra some a danca de fuso — nao ha `at time zone` nesta tabela, e nao
--   ha a convencao do `T12:00:00Z` que a tela semanal precisa usar para o dia
--   nao escorregar.
--
-- O CLIENTE E OBRIGATORIO
--   Foi o que o usuario pediu para o calendario geral: *"no geral, escolher de
--   qual cliente e"*. Compromisso sem dono nao teria onde aparecer — nem na
--   aba do cliente, nem com nome no geral — e sobretudo nao teria por onde ser
--   recortado pelo alcance. E `can_see_client(client_id)` que fecha esta
--   tabela, exatamente como fecha `content_items`.
-- =============================================================================

create table if not exists ideworks.appointments (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references ideworks.clients (id) on delete cascade,

  -- Dia civil no fuso da agencia, ja resolvido. Nao e instante: um compromisso
  -- e "dia 12", e nao "o momento X visto de tal lugar".
  day        date not null,

  -- ⚠️ NULO = O DIA INTEIRO. E a coluna que impede o `00:00` de voltar.
  start_time time,

  title      text not null,
  notes      text,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),

  -- Compromisso sem nome e uma pastilha em branco no dia: ocupa espaco e nao
  -- informa nada. O `btrim` recusa tambem o titulo feito so de espacos, que e
  -- o que um formulario deixa passar quando alguem aperta a barra sem querer.
  constraint appointments_title_not_blank check (btrim(title) <> '')
);

comment on table ideworks.appointments is
  'O compromisso: reuniao, gravacao, viagem. Ocupa o dia e NAO entrega nada — '
  'por isso mora fora de content_items, que e o que a cota do mes conta. '
  'Tabela separada e a unica forma de a separacao ser aritmetica em vez de '
  'depender de um `where` lembrado em cada consulta que conta.';
comment on column ideworks.appointments.day is
  'Dia civil no fuso da agencia. `date`, e nao `timestamptz`: compromisso e '
  'dia, nao instante — e assim nao ha conversao de fuso para errar.';
comment on column ideworks.appointments.start_time is
  'Nulo = o dia inteiro. E a coluna que faz a hora inexistente NAO virar '
  '00:00, que era o que o calendario mostrava em 2.598 dos 2.626 conteudos '
  'com data.';
comment on column ideworks.appointments.notes is
  'O que nao cabe no titulo. Opcional: obrigar detalhe faz inventar detalhe.';

-- As duas perguntas da tela, nesta ordem: "o mes deste cliente" (a aba) e "o
-- mes de todo mundo" (o calendario geral). A primeira usa as duas colunas; a
-- segunda usa `day`, e o indice parcial por dia serve os dois casos porque
-- `client_id` vem primeiro so na aba.
create index if not exists appointments_client_day_idx
  on ideworks.appointments (client_id, day);
create index if not exists appointments_day_idx
  on ideworks.appointments (day);

-- --- seguranca por linha, na mesma migration ---------------------------------
--
-- ⚠️ QUATRO POLITICAS SEPARADAS, E NENHUM `for all`. Esta escrito porque tres
-- etapas deste projeto quase publicaram correcao que nao corrigia por isto:
-- `for all` INCLUI `select`. Aqui as quatro dizem a mesma coisa hoje — e
-- separadas elas continuam dizendo o que se quis dizer no dia em que uma
-- delas precisar mudar.
--
-- O criterio e o de `content_items`, e de proposito: quem enxerga o cliente
-- mexe na agenda dele. Exigir administrador para marcar uma reuniao
-- paralisaria a operacao diaria de quem cuida da carteira.
alter table ideworks.appointments enable row level security;

drop policy if exists appointments_select on ideworks.appointments;
create policy appointments_select on ideworks.appointments for select
  using (ideworks.can_see_client(client_id));

drop policy if exists appointments_insert on ideworks.appointments;
create policy appointments_insert on ideworks.appointments for insert
  with check (ideworks.can_see_client(client_id));

-- `using` E `with check`: sem o segundo, quem alcanca o cliente A poderia
-- mudar `client_id` para o cliente B que nao alcanca — mover a linha para
-- fora do proprio alcance, escrevendo onde nao pode.
drop policy if exists appointments_update on ideworks.appointments;
create policy appointments_update on ideworks.appointments for update
  using (ideworks.can_see_client(client_id))
  with check (ideworks.can_see_client(client_id));

drop policy if exists appointments_delete on ideworks.appointments;
create policy appointments_delete on ideworks.appointments for delete
  using (ideworks.can_see_client(client_id));

-- --- permissoes ---------------------------------------------------------------
--
-- Tabela NOVA nao herda o `grant all privileges on all tables in schema
-- ideworks` da F17.1: aquele comando alcancou as tabelas que existiam naquele
-- dia. Sem a linha abaixo o calendario responderia "permission denied for
-- table appointments" — que e erro de dono, e nao de politica.
grant select, insert, update, delete on ideworks.appointments to ideworks_app;
