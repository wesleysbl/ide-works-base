-- =============================================================================
-- IDE WORKS — F11d  Links, etiquetas, historico, captacoes, mural e tarefas
-- =============================================================================
-- O QUE O LEGADO GUARDA E ESTE MODELO NAO TEM ONDE POR
--
--   AUTORIA. Nota do mural, tarefa e captacao registram QUEM la. Aqui a chave
--   estrangeira aponta para `ideworks.profiles`, e nenhuma dessas pessoas foi
--   migrada — sao 26 no legado, 4 aqui, e trazer gente e decisao de ACESSO, nao
--   de importacao. Entao `created_by` fica nulo, e onde ha campo de texto o
--   nome e preservado (`led_by_note`, `captured_by_note`).
--
--   Escolher um usuario plausivel para "nao ficar vazio" seria fabricar
--   autoria, e autoria fabricada e indistinguivel de verdadeira depois.
--
--   ANEXO DO HISTORICO. Tres registros dos clientes ativos tem documento em
--   `documentos jsonb`. Eles NAO vem: o anexo depende de balde privado com
--   chave de servico, que ainda nao existe. O texto do evento vem inteiro.
--
--   `importante` DO HISTORICO. Zero registros marcados — nada se perde.
--
-- A UNICA ALTERACAO DE DADO DA MIGRACAO INTEIRA
--   Um link entre 309 esta gravado sem esquema (`www.linkedin.com/in/...`). A
--   regra daqui recusa url sem esquema — ela existe para barrar `javascript:`.
--   Um endereco assim nao e perigoso, e incompleto. Completar com `https://`
--   recupera o que a pessoa quis dizer; deixar de fora perderia o link.
--
-- TEXTO EM BRANCO VIRA NULO
--   32 registros de historico tem subtitulo `''`. Aqui a regra e "ou tem
--   conteudo, ou e nulo": string vazia e um terceiro estado que nao quer dizer
--   nada e obriga toda leitura a testar duas coisas.
--
-- REPETIVEL, como as anteriores: o uuid de origem e a chave.
-- =============================================================================

create or replace function ideworks.migracao_resto_previa(
  p_somente_ativos boolean default true
) returns table (o_que text, quantidade bigint, observacao text)
  language plpgsql stable security definer
  set search_path = ideworks, public, pg_temp
as $fn$
begin
  if not ideworks.acting_is_super() then
    raise exception 'so o super admin migra' using errcode = '42501';
  end if;

  return query
  select 'links', count(*), 'ordem reconstruida pela data de criacao'::text
    from public.client_links l join public.clients c on c.id=l.client_id
   where (not p_somente_ativos or c.ativo)
     and exists (select 1 from ideworks.clients d where d.id=l.client_id)
  union all
  select 'links repetidos (mesmo cliente e url)', count(*),
         'vem como estao — apagar dado de gente nao e trabalho de rotina'::text
    from (select l.client_id, l.link from public.client_links l
            join public.clients c on c.id=l.client_id
           where (not p_somente_ativos or c.ativo)
           group by 1,2 having count(*)>1) s
  union all
  select 'etiquetas', count(*), null::text from public.client_tags
  union all
  select 'etiquetas atribuidas', count(*), null::text
    from public.client_tag_assignments a join public.clients c on c.id=a.client_id
   where (not p_somente_ativos or c.ativo)
     and exists (select 1 from ideworks.clients d where d.id=a.client_id)
  union all
  select 'historico', count(*), 'o lider vai para nota de texto: 32 grafias, nenhuma e um usuario'::text
    from public.client_history h join public.clients c on c.id=h.client_id
   where (not p_somente_ativos or c.ativo)
     and exists (select 1 from ideworks.clients d where d.id=h.client_id)
  union all
  select 'historico COM anexo', count(*) filter (where h.documentos is not null
           and h.documentos::text not in ('null','[]','{}')),
         'o anexo NAO vem: depende de balde privado, que ainda nao existe'::text
    from public.client_history h join public.clients c on c.id=h.client_id
   where (not p_somente_ativos or c.ativo)
  union all
  select 'captacoes', count(*), null::text
    from public.video_captures v join public.clients c on c.id=v.client_id
   where (not p_somente_ativos or c.ativo)
     and exists (select 1 from ideworks.clients d where d.id=v.client_id)
  union all
  select 'notas do mural', count(*), 'a AUTORIA nao vem: as pessoas ainda nao foram migradas'::text
    from public.client_notes n join public.clients c on c.id=n.client_id
   where (not p_somente_ativos or c.ativo)
     and exists (select 1 from ideworks.clients d where d.id=n.client_id)
  union all
  select 'demandas', count(*), 'viram tarefas'::text
    from public.demands d join public.clients c on c.id=d.client_uuid
   where (not p_somente_ativos or c.ativo)
     and exists (select 1 from ideworks.clients w where w.id=d.client_uuid)
  union all
  select 'demandas SEM cliente identificado', count(*),
         'nao ha para onde levar — ficam no legado'::text
    from public.demands where client_uuid is null;
end;
$fn$;

create or replace function ideworks.migrar_o_resto(
  p_somente_ativos boolean default true
) returns table (
  links integer, etiquetas integer, atribuicoes integer,
  historico integer, captacoes integer, notas integer, tarefas integer
)
  language plpgsql security definer
  set search_path = ideworks, public, pg_temp
as $fn$
declare a integer; b integer; c integer; d integer; e integer; f integer; g integer;
begin
  if not ideworks.acting_is_super() then
    raise exception 'so o super admin migra' using errcode = '42501';
  end if;

  -- LINKS. A ordem nao existe no legado; e reconstruida pela data de criacao,
  -- que e a ordem em que apareceram na tela de la. Ver o cabecalho sobre o
  -- esquema completado.
  with gravado as (
    insert into ideworks.client_links (id, client_id, title, url, sort_order, created_at)
    select l.id, l.client_id, l.titulo,
           case when l.link ~* '^[a-z][a-z0-9+.-]*://.' then l.link
                else 'https://' || l.link end,
           (row_number() over (partition by l.client_id order by l.created_at, l.id))::int,
           l.created_at
      from public.client_links l join public.clients cl on cl.id=l.client_id
     where (not p_somente_ativos or cl.ativo)
       and exists (select 1 from ideworks.clients w where w.id=l.client_id)
       and btrim(coalesce(l.titulo,'')) <> ''
       and btrim(coalesce(l.link,''))   <> ''
    on conflict (id) do update set
      title = excluded.title, url = excluded.url, sort_order = excluded.sort_order
    returning 1
  ) select count(*)::int into a from gravado;

  -- ETIQUETAS. Vem TODAS, inclusive as so usadas por cliente inativo: etiqueta
  -- e vocabulario da agencia, nao propriedade do cliente.
  with gravado as (
    insert into ideworks.client_tags (id, name, color, created_at)
    select t.id, t.name, t.color, t.created_at from public.client_tags t
     where btrim(coalesce(t.name,'')) <> ''
    on conflict (id) do update set name = excluded.name, color = excluded.color
    returning 1
  ) select count(*)::int into b from gravado;

  -- `do nothing`, e nao `do update`: reatribuir nao pode reescrever a data em
  -- que a etiqueta foi posta. Em consequencia, este contador conta as NOVAS —
  -- rodar de novo devolve zero, e isso e certo, nao perda.
  with gravado as (
    insert into ideworks.client_tag_assignments (client_id, tag_id, assigned_at)
    select distinct on (a2.client_id, a2.tag_id) a2.client_id, a2.tag_id, a2.created_at
      from public.client_tag_assignments a2 join public.clients cl on cl.id=a2.client_id
     where (not p_somente_ativos or cl.ativo)
       and exists (select 1 from ideworks.clients w where w.id=a2.client_id)
       and exists (select 1 from ideworks.client_tags t where t.id=a2.tag_id)
     order by a2.client_id, a2.tag_id, a2.created_at
    on conflict (client_id, tag_id) do nothing
    returning 1
  ) select count(*)::int into c from gravado;

  -- HISTORICO. `lider_responsavel` e TEXTO LIVRE com 32 grafias — nenhuma delas
  -- e um usuario do sistema. Vai para `led_by_note`, e `led_by` fica nulo.
  with gravado as (
    insert into ideworks.client_history
      (id, client_id, happened_on, title, subtitle, body, led_by, led_by_note, created_by)
    select h.id, h.client_id, h.data_evento, btrim(h.titulo),
           nullif(btrim(coalesce(h.subtitulo,'')),''), h.corpo,
           null, nullif(btrim(coalesce(h.lider_responsavel,'')),''), null
      from public.client_history h join public.clients cl on cl.id=h.client_id
     where (not p_somente_ativos or cl.ativo)
       and exists (select 1 from ideworks.clients w where w.id=h.client_id)
       and btrim(coalesce(h.titulo,'')) <> ''
       and btrim(coalesce(h.corpo,''))  <> ''
    on conflict (id) do update set
      happened_on = excluded.happened_on, title = excluded.title,
      subtitle = excluded.subtitle, body = excluded.body,
      led_by_note = excluded.led_by_note, updated_at = now()
    returning 1
  ) select count(*)::int into d from gravado;

  -- CAPTACOES. `month_year` do legado nao vem: ja foi medido que ele nunca
  -- diverge de `data_gravacao`, entao guardar os dois seria guardar a mesma
  -- coisa duas vezes e criar a chance de discordarem.
  with gravado as (
    insert into ideworks.video_captures
      (id, client_id, recorded_on, captured_by, captured_by_note, video_count,
       kinds, status, script, notes, total_minutes, created_by)
    select v.id, v.client_id, v.data_gravacao,
           null, nullif(btrim(coalesce(v.captador_nome,'')),''), v.quantidade_videos,
           coalesce((select array_agg(
             case t when 'Depoimento' then 'testimonial' when 'Evento' then 'event'
                    when 'Institucional' then 'institutional' when 'Produto' then 'product'
                    when 'Promocional' then 'promotional' else 'other' end::ideworks.capture_kind)
             from unnest(coalesce(v.tipos_videos,'{}')) t), '{}'::ideworks.capture_kind[]),
           (case v.status when 'Gravado' then 'recorded' when 'Em edição' then 'in_edit'
                 when 'Editado' then 'edited' else 'published' end)::ideworks.capture_status,
           nullif(btrim(coalesce(v.roteiro,'')),''),
           nullif(btrim(coalesce(v.observacoes,'')),''),
           v.duracao_total_minutos, null
      from public.video_captures v join public.clients cl on cl.id=v.client_id
     where (not p_somente_ativos or cl.ativo)
       and exists (select 1 from ideworks.clients w where w.id=v.client_id)
       and v.quantidade_videos > 0
    on conflict (id) do update set
      recorded_on = excluded.recorded_on, captured_by_note = excluded.captured_by_note,
      video_count = excluded.video_count, kinds = excluded.kinds,
      status = excluded.status, script = excluded.script, notes = excluded.notes,
      total_minutes = excluded.total_minutes, updated_at = now()
    returning 1
  ) select count(*)::int into e from gravado;

  -- MURAL. Posicao e tamanho sao obrigatorios aqui e opcionais la; nulo vira o
  -- padrao da tela, e nao zero — nota empilhada no canto some atras das outras.
  with gravado as (
    insert into ideworks.mural_notes
      (id, client_id, title, content, color, position_x, position_y, width, height, created_by)
    select n.id, n.client_id, nullif(btrim(coalesce(n.title,'')),''), n.content,
           n.background_color::ideworks.note_color,
           greatest(coalesce(n.position_x, 24), 0), greatest(coalesce(n.position_y, 24), 0),
           greatest(coalesce(n.width, 240), 1),     greatest(coalesce(n.height, 200), 1),
           null
      from public.client_notes n join public.clients cl on cl.id=n.client_id
     where (not p_somente_ativos or cl.ativo)
       and exists (select 1 from ideworks.clients w where w.id=n.client_id)
       and btrim(coalesce(n.content,'')) <> ''
    on conflict (id) do update set
      title = excluded.title, content = excluded.content, color = excluded.color,
      position_x = excluded.position_x, position_y = excluded.position_y,
      width = excluded.width, height = excluded.height, updated_at = now()
    returning 1
  ) select count(*)::int into f from gravado;

  -- DEMANDAS -> TAREFAS. As sem `client_uuid` nao vem: a coluna antiga
  -- `client_id` la e TEXTO, e casar texto com cliente seria adivinhar.
  with gravado as (
    insert into ideworks.tasks
      (id, client_id, title, description, due_on, completed_at, completed_by,
       archived_at, created_by)
    select t.id, t.client_uuid, btrim(t.nome),
           nullif(btrim(coalesce(t.descricao,'')),''), t.prazo,
           case when coalesce(t.concluido,false) then coalesce(t.completed_at, t.updated_at) end,
           null,
           case when coalesce(t.arquivado,false) then t.updated_at end,
           null
      from public.demands t join public.clients cl on cl.id=t.client_uuid
     where (not p_somente_ativos or cl.ativo)
       and exists (select 1 from ideworks.clients w where w.id=t.client_uuid)
       and btrim(coalesce(t.nome,'')) <> ''
    on conflict (id) do update set
      title = excluded.title, description = excluded.description,
      due_on = excluded.due_on, completed_at = excluded.completed_at,
      archived_at = excluded.archived_at, updated_at = now()
    returning 1
  ) select count(*)::int into g from gravado;

  return query select a, b, c, d, e, f, g;
end;
$fn$;

grant execute on function ideworks.migracao_resto_previa(boolean) to ideworks_app;
grant execute on function ideworks.migrar_o_resto(boolean)        to ideworks_app;
