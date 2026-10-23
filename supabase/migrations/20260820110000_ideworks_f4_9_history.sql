-- =============================================================================
-- IDE WORKS — F4.9  Historico do cliente, com documentos
-- =============================================================================
-- O QUE FOI MEDIDO EM `public.client_history` (75 eventos, 42 clientes), 2026-08-20
--
--   1 · A MARCA DE "IMPORTANTE" NUNCA FOI USADA. `importante boolean NOT NULL`
--       esta FALSE em 75 de 75. E o mesmo caso do enum de status do calendario
--       na F3.2: campo que existe no codigo e nao existe na operacao. Nao entra.
--       Se um dia a equipe descrever para que serve, entra como migration.
--
--   2 · O LIDER E TEXTO LIVRE. `lider_responsavel text NOT NULL`, com 32 grafias
--       distintas em 75 linhas — e NENHUMA casa com perfil do sistema. Ha
--       "João", "Joao", "joao" e "João Pedro"; ha "Ana" e "Ana Sol"; e ha
--       "Juca, Lia, João e Nuno " (com espaco no fim), que sao QUATRO pessoas
--       num campo de uma.
--
--       Aqui viram duas coisas diferentes, porque sao duas coisas diferentes:
--         `led_by`        referencia de verdade, para quem e do time
--         `led_by_note`   texto livre, para quem nao e — cliente, fornecedor,
--                         convidado. O legado nao tinha onde por isso, e por
--                         isso tudo virou texto.
--
--   3 · OS DOCUMENTOS SAO UM `jsonb`. Um array de objetos com `id` que e
--       timestamp, `url` publica, `nome`, `tipo`, `tamanho` e `data_upload`.
--       Nao da para indexar, nao da para restringir, nao da para apagar o
--       arquivo junto com a linha. Aqui e tabela.
--
--   4 · O BALDE DE ARQUIVOS E PUBLICO. Medido em `storage.buckets`:
--       `client-history-documents` esta com `public = true`, sem limite de
--       tamanho e sem restricao de tipo, com 15 arquivos dentro. As URLs
--       gravadas sao `/object/public/...` — ou seja, transcricao de reuniao de
--       cliente le-se SEM LOGIN, bastando ter o endereco.
--
--       O IDE Works nao repete isso. Esta migration NAO cria balde nem mexe no
--       do legado (mexer em balde de producao quebraria o sistema que esta no
--       ar): ela guarda o CAMINHO dentro do balde, nunca a URL. Quem entrega o
--       arquivo e o servidor, com URL assinada de vida curta, depois de
--       conferir que a pessoa enxerga aquele cliente.
--
--       O balde privado e criado na etapa de armazenamento; ate la a tabela
--       aceita evento sem documento, que e o caso de 66 dos 75 do legado.
-- =============================================================================

create table if not exists ideworks.client_history (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references ideworks.clients (id) on delete cascade,

  -- Quando o evento ACONTECEU. Diferente de `created_at`, que e quando alguem
  -- registrou: reuniao de segunda anotada na quarta tem as duas datas, e
  -- confundi-las poe a linha do tempo fora de ordem.
  happened_on  date not null,

  title        text not null,
  subtitle     text,
  body         text not null,

  -- Ver (2) no cabecalho.
  led_by       uuid references auth.users (id) on delete set null,
  led_by_note  text,

  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint client_history_title_not_blank check (btrim(title) <> ''),
  constraint client_history_body_not_blank  check (btrim(body) <> ''),

  -- Subtitulo em branco e o mesmo que nao ter: 32 dos 75 do legado estao assim,
  -- e metade e string vazia em vez de nulo. Duas formas de dizer "nao tem"
  -- obrigam toda leitura a testar as duas.
  constraint client_history_subtitle_not_blank check (subtitle is null or btrim(subtitle) <> ''),
  constraint client_history_note_not_blank     check (led_by_note is null or btrim(led_by_note) <> '')
);

-- A linha do tempo le por cliente, do mais recente para o mais antigo.
create index if not exists client_history_client_idx
  on ideworks.client_history (client_id, happened_on desc, created_at desc);

comment on table ideworks.client_history is
  'Linha do tempo do cliente. Sem a marca "importante" do legado, que esta '
  'false em 75 de 75 registros — campo que existe no codigo e nao na operacao.';
comment on column ideworks.client_history.happened_on is
  'Quando ACONTECEU, nao quando foi registrado. As duas datas sao diferentes e '
  'confundi-las poe a linha do tempo fora de ordem.';
comment on column ideworks.client_history.led_by_note is
  'Quem conduziu, quando NAO e do time. No legado tudo era texto livre, e o '
  'resultado foram 32 grafias para poucas pessoas — incluindo quatro nomes '
  'dentro de um campo so.';

-- --- documentos ---------------------------------------------------------------
create table if not exists ideworks.history_documents (
  id           uuid primary key default gen_random_uuid(),
  history_id   uuid not null references ideworks.client_history (id) on delete cascade,

  -- CAMINHO dentro do balde, nunca URL. Ver (4) no cabecalho: URL gravada e URL
  -- que vaza, e a do legado e publica. Quem entrega o arquivo e o servidor.
  storage_path text not null,

  file_name    text not null,
  mime_type    text,
  size_bytes   bigint,

  uploaded_by  uuid references auth.users (id) on delete set null,
  uploaded_at  timestamptz not null default now(),

  constraint history_documents_name_not_blank check (btrim(file_name) <> ''),
  constraint history_documents_path_not_blank check (btrim(storage_path) <> ''),

  -- Tamanho negativo nao existe, e zero e arquivo vazio: aceita-se zero, recusa-se
  -- o impossivel.
  constraint history_documents_size_non_negative check (size_bytes is null or size_bytes >= 0),

  -- O mesmo arquivo nao entra duas vezes no mesmo evento.
  constraint history_documents_path_unique unique (history_id, storage_path)
);

create index if not exists history_documents_history_idx
  on ideworks.history_documents (history_id, uploaded_at);

comment on column ideworks.history_documents.storage_path is
  'Caminho dentro do balde PRIVADO. Nunca URL: a URL do legado e publica e o '
  'arquivo le-se sem login. Aqui o servidor assina um endereco de vida curta '
  'depois de conferir que a pessoa enxerga o cliente.';

-- --- seguranca por linha ------------------------------------------------------
alter table ideworks.client_history    enable row level security;
alter table ideworks.history_documents enable row level security;

-- Quem enxerga o cliente le e escreve o historico dele: registrar o que
-- aconteceu e trabalho de quem atende, nao de administrador.
create policy client_history_select on ideworks.client_history for select
  using (ideworks.can_see_client(client_id));
create policy client_history_insert on ideworks.client_history for insert
  with check (ideworks.can_see_client(client_id));
create policy client_history_update on ideworks.client_history for update
  using (ideworks.can_see_client(client_id))
  with check (ideworks.can_see_client(client_id));
create policy client_history_delete on ideworks.client_history for delete
  using (ideworks.can_see_client(client_id));

create policy history_documents_select on ideworks.history_documents for select
  using (exists (select 1 from ideworks.client_history h
                  where h.id = history_id and ideworks.can_see_client(h.client_id)));
create policy history_documents_write on ideworks.history_documents for all
  using (exists (select 1 from ideworks.client_history h
                  where h.id = history_id and ideworks.can_see_client(h.client_id)))
  with check (exists (select 1 from ideworks.client_history h
                       where h.id = history_id and ideworks.can_see_client(h.client_id)));

grant all privileges on all tables in schema ideworks to ideworks_app;
