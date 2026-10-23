-- =============================================================================
-- IDE WORKS — F4.10  Mural e Captacao
-- =============================================================================
-- MEDIDO NO LEGADO EM 2026-08-20
--
--   `client_notes`     14 notas em 12 clientes; cores blue/green/red/yellow
--   `video_captures`   77 gravacoes em 28 clientes
--   `client_captures`  **0 linhas** — tabela que nunca rodou. NAO vem.
--
-- O QUE MUDA, E POR QUE
--
--   1 · `month_year text` SAI. Em 77 linhas ele NUNCA diverge de
--       `to_char(data_gravacao,'YYYY-MM')` — e por isso mesmo nao precisa
--       existir: e derivacao guardada, e derivacao guardada so pode piorar com
--       o tempo. E a mesma dividia do `month_year` em seis tabelas do legado.
--
--   2 · O STATUS VIRA ENUM DE VERDADE — e aqui, ao contrario da F3.2 e da F4.9,
--       O ENUM SE JUSTIFICA. Os quatro valores estao TODOS em uso nas 77 linhas:
--       Gravado, Em edicao, Editado, Publicado. Nao e fluxo inventado; e fluxo
--       que roda. O criterio nao e "enum e bom" nem "enum e ruim": e se a
--       operacao usa.
--
--   3 · O TIPO DE VIDEO VIRA ENUM ARRAY. Seis valores em uso, e 14 das 77 sem
--       nenhum. Continua opcional; o que muda e que grafia nova passa a ser
--       recusada em vez de entrar calada.
--
--   4 · QUEM CAPTOU GANHA DOIS CAMPOS, como na F4.9: `captured_by` referencia
--       de verdade e `captured_by_note` para quem nao e do time. No legado
--       `captador_id` esta sempre preenchido e os 77 apontam para alguem que
--       NAO tem perfil — e `captador_nome` e a unica coisa que sobrou.
--
--   5 · A NOTA DO MURAL NASCE COM LUGAR. No legado `position_x`, `position_y`,
--       `width` e `height` sao anulaveis: post-it sem posicao nao tem onde ser
--       desenhado, e a tela precisa inventar um lugar toda vez que abre.
-- =============================================================================

-- --- mural --------------------------------------------------------------------
do $$ begin
  create type ideworks.note_color as enum ('yellow', 'green', 'blue', 'red');
exception when duplicate_object then null; end $$;

comment on type ideworks.note_color is
  'As quatro cores em uso no mural do legado. Cor fora da lista e recusada, em '
  'vez de virar post-it invisivel por causa de um valor que o CSS nao conhece.';

create table if not exists ideworks.mural_notes (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references ideworks.clients (id) on delete cascade,

  title      text,
  content    text not null,
  color      ideworks.note_color not null default 'yellow',

  -- Ver (5) no cabecalho: a nota nasce com lugar e tamanho.
  position_x integer not null default 0,
  position_y integer not null default 0,
  width      integer not null default 220,
  height     integer not null default 180,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint mural_notes_content_not_blank check (btrim(content) <> ''),
  constraint mural_notes_title_not_blank   check (title is null or btrim(title) <> ''),

  -- Post-it de tamanho zero ou negativo nao e post-it: e uma linha que a tela
  -- desenha e ninguem consegue clicar.
  constraint mural_notes_size_positive check (width > 0 and height > 0),

  -- Coordenada negativa joga a nota para fora da area visivel, e ela some sem
  -- ter sido apagada.
  constraint mural_notes_position_non_negative check (position_x >= 0 and position_y >= 0)
);

create index if not exists mural_notes_client_idx on ideworks.mural_notes (client_id, created_at);

comment on table ideworks.mural_notes is
  'O quadro de cortica do cliente. Posicao e tamanho sao obrigatorios: no legado '
  'sao anulaveis, e a tela precisa inventar um lugar a cada abertura.';

-- --- captacao -----------------------------------------------------------------
do $$ begin
  create type ideworks.capture_status as enum ('recorded', 'in_edit', 'edited', 'published');
exception when duplicate_object then null; end $$;

comment on type ideworks.capture_status is
  'Os quatro estados de uma gravacao. Ao contrario do status do calendario — que '
  'tem tres valores no codigo e UM em uso —, estes quatro aparecem TODOS nas 77 '
  'gravacoes do legado. O enum existe porque a operacao usa, nao porque enum e bonito.';

do $$ begin
  create type ideworks.capture_kind as enum
    ('testimonial', 'event', 'institutional', 'product', 'promotional', 'other');
exception when duplicate_object then null; end $$;

create table if not exists ideworks.video_captures (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references ideworks.clients (id) on delete cascade,

  recorded_on       date not null,

  -- Ver (4) no cabecalho.
  captured_by       uuid references auth.users (id) on delete set null,
  captured_by_note  text,

  video_count       integer not null,
  kinds             ideworks.capture_kind[] not null default '{}',
  status            ideworks.capture_status not null default 'recorded',

  script            text,
  notes             text,
  total_minutes     integer,

  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Gravacao de zero video nao e gravacao. As 77 do legado tem todas ao menos um.
  constraint video_captures_count_positive check (video_count > 0),
  constraint video_captures_minutes_non_negative
    check (total_minutes is null or total_minutes >= 0),
  constraint video_captures_note_not_blank
    check (captured_by_note is null or btrim(captured_by_note) <> '')
);

-- A aba le por cliente, do mais recente para o mais antigo; o painel soma o mes.
create index if not exists video_captures_client_idx
  on ideworks.video_captures (client_id, recorded_on desc);

comment on table ideworks.video_captures is
  'Registro de gravacao. SEM `month_year`: em 77 linhas do legado ele nunca '
  'diverge de `data_gravacao`, e derivacao guardada so pode piorar com o tempo.';
comment on column ideworks.video_captures.video_count is
  'Quantos videos foram gravados na sessao. E o numerador do "captados/mes" do '
  'painel; o denominador e a cota de video do contrato daquele mes.';

-- --- seguranca por linha ------------------------------------------------------
alter table ideworks.mural_notes    enable row level security;
alter table ideworks.video_captures enable row level security;

-- Quem enxerga o cliente cuida do mural e das gravacoes dele: e trabalho de
-- quem atende, nao de administrador.
create policy mural_notes_select on ideworks.mural_notes for select
  using (ideworks.can_see_client(client_id));
create policy mural_notes_write on ideworks.mural_notes for all
  using (ideworks.can_see_client(client_id))
  with check (ideworks.can_see_client(client_id));

create policy video_captures_select on ideworks.video_captures for select
  using (ideworks.can_see_client(client_id));
create policy video_captures_write on ideworks.video_captures for all
  using (ideworks.can_see_client(client_id))
  with check (ideworks.can_see_client(client_id));

grant all privileges on all tables in schema ideworks to ideworks_app;
