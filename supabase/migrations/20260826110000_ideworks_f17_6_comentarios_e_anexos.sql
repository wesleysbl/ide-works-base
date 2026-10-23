-- =============================================================================
-- IDE WORKS — F17.6  Comentários, anexos e links
-- =============================================================================
-- O COMENTÁRIO É A ENTREGA, E ISSO NÃO É FIGURA DE LINGUAGEM
--   Medido nas tarefas reais da Agência Ide: o designer termina o trabalho
--   postando o link do Dropbox num comentário. Em `[A] JATOBÁ - NÚMERO ALTO
--   DE INVESTIDORES` o comentário é, literalmente:
--
--     www.dropbox.com/scl/fo/exemplo00000000000000/AAexemploDePasta000000_X?rlkey=…
--
--   E as tarefas carregam PDF de roteiro como anexo — `Jatobá Investimentos -
--   Roteiro Leads quiz 1.pdf`, `Calendario-Editorial-Cliente-0001.pdf` —
--   com links de Google Docs e Dropbox espalhados pela descrição.
--
--   Sem esta etapa o sistema tem onde planejar o trabalho e não tem onde
--   ENTREGÁ-LO.
--
-- ========================================== A DÍVIDA QUE ESTA ETAPA NÃO REPETE
--   O balde de documentos do Sistema IDE legado é PÚBLICO. Medido neste banco,
--   nesta sessão:
--
--     storage.buckets → client-history-documents · public = TRUE
--     as 4 políticas de storage.objects que o servem filtram SÓ por bucket_id
--
--   Documento de cliente se lê sem login. Está registrado como dívida conhecida
--   do projeto, e o balde desta etapa não a herda: `ideworks-anexos` nasce
--   `public = false` e SEM política permissiva nenhuma em `storage.objects`.
--
--   RLS ligada + zero política permissiva = negado a `anon` e a `authenticated`,
--   por construção e não por configuração. Quem alcança é só quem ignora RLS —
--   a chave de serviço, do lado do servidor. Ver a seção "O BALDE" no fim.
--
-- ================================ O QUE ESTA MIGRATION MEDIU — 2026-08-26 ====
--   ideworks.tasks .............. 18 linhas (1 arquivada, 18 com descrição)
--   ideworks.spaces / lists ..... 2 e 2 · folders 0
--   ideworks.task_checklists .... 0 · checklist_items 0
--   ideworks.task_tags .......... 0 · task_watchers 0
--   ideworks.profiles ........... 7
--   tabelas no schema ........... 43   · funcoes 90 · gatilhos 11
--   storage.buckets ............. 1, e ele é público (a dívida acima)
--
--   Nenhuma linha existente é tocada. Esta migration acrescenta TRÊS tabelas
--   vazias, redefine uma view, cria três ações e um balde. As 18 tarefas ficam
--   exatamente como estão.
--
-- ================================================ ZERO GATILHOS NOVOS ========
--   O projeto está em ONZE gatilhos e cada um é um custo declarado. Esta etapa
--   não acrescenta nenhum, e não por sorte: as quatro invariantes que ela
--   precisa guardar cabem todas em forma DECLARATIVA.
--
--     "a resposta é de UM nível" ......... colunas geradas + chave composta
--     "a resposta é da MESMA tarefa" ..... a mesma chave composta
--     "só o autor edita e apaga" ......... a política de escrita
--     "o endereço não executa código" .... `check` com regex
--
--   O aninhamento é o mesmo desenho de `checklist_items` na F17.15, e a razão
--   é a mesma: com `nest_level` estritamente decrescendo do filho para o pai,
--   CICLO É IMPOSSÍVEL por geometria — não há caminho de volta. O que em
--   `tasks` exigiu o 11º gatilho (profundidade livre) aqui não exige nenhum
--   (profundidade fixa).
--
--   Sondado em tabela descartável, os cinco casos: raiz passa, resposta passa,
--   neto recusado `23503`, resposta apontando para comentário de OUTRA tarefa
--   recusada `23503`, auto-pai recusado `23503`, e apagar a raiz leva a
--   resposta junto (`sobraram 0`).
--
-- ====================================== POR QUE A RESPOSTA É DE UM NÍVEL SÓ ==
--   Não é simplificação: é a forma da origem. No ClickUp o comentário tem
--   `reply_count` e as respostas vêm por uma chamada própria, numa lista PLANA.
--   Resposta de resposta não existe lá. Uma réplica com profundidade livre
--   inventaria uma forma que a equipe nunca viu e que a importação — se um dia
--   voltar — não teria como preencher.
--
-- ============================================ EDITAR E APAGAR SÓ PELO AUTOR ==
--   Está na política, e não numa função: `task_comments_update` e
--   `task_comments_delete` exigem `author_id = ideworks.acting_user_id()` no
--   `using`. Uma pessoa que não é a autora simplesmente NÃO ENCONTRA a linha
--   para escrever nela — e por isso a ação devolve "não encontrado ou não é
--   seu", que é a mesma resposta para as duas coisas, de propósito.
--
--   O `with check` do INSERT também exige `author_id = acting_user_id()`. Sem
--   ele, quem alcança a tarefa poderia postar EM NOME DE OUTRA PESSOA — e num
--   sistema onde o comentário É a entrega, isso é falsificação de entrega.
--
--   NÃO HÁ EXCEÇÃO DE ADMINISTRADOR. Apagar o comentário alheio é reescrever o
--   registro do que foi entregue; quem precisa tirar a tarefa do caminho tem
--   `archived_at`, e quem apaga a TAREFA leva os comentários pela cascata —
--   que é uma decisão sobre a tarefa, não sobre a fala de alguém.
--
-- ============================================== O `edited_at`, E POR QUE ELE =
--   Instante, e não booleano — a regra do projeto. "Editado às 14:32" é
--   diferente de "editado", e num comentário que carrega um link de entrega a
--   diferença é quem precisa saber se o link mudou depois de lido.
--
--   Ele é carimbado por `ideworks.edit_task_comment`, e não por gatilho: há UM
--   caminho de edição, e ele já existe. Um gatilho seria o 12º do projeto para
--   guardar uma invariante que nada ameaça.
--
-- ================================================== O LINK, COISA PRÓPRIA ====
--   Rótulo e endereço, ao lado do anexo. Dropbox e Google Docs são o padrão da
--   casa e hoje vivem COLADOS no meio do texto — a descrição do Jatobá tem
--   três deles no corpo.
--
--   O `check` do endereço é LISTA DE PERMISSÃO (`^https?://…`), e não lista de
--   proibição. Sondado: `javascript:alert(1)` e `JavaScript:alert(1)` recusados,
--   `data:text/html;base64,…` recusado, `https://a.com/ b` recusado por causa do
--   espaço. É a mesma decisão de `enderecoSeguro` em `src/board/markdown.ts`,
--   agora também no banco — porque quem chama a API não é necessariamente a
--   tela.
--
--   `www.dropbox.com/x` SEM esquema é recusado aqui, e é assim que o comentário
--   real está escrito. Quem completa o `https://` é `normalizarUrl` em
--   `src/clients/formulario.ts`, que já existe e já faz isso desde a F2. O banco
--   guarda o endereço COMPLETO; a tela é que aceita a digitação curta.
--
-- ================================== O INDICADOR "TEM ANEXO", ENFIM COMPLETO ==
--   A F17.9a precisou de "tem descrição" e "tem anexo" no cartão. O primeiro
--   saiu; o segundo NÃO PÔDE, porque a tabela não existia — e o agente relatou
--   em vez de devolver `false` fixo, que teria sido um indicador que nunca
--   acende prometendo um dado inexistente.
--
--   Agora a tabela existe. A contagem entra em `ideworks.task_progress`, que é
--   A ÚNICA definição de contagem do projeto desde a F17.15 — cartão, linha e
--   ficha leem dela. Três `count(*)` escritos à mão em três consultas
--   divergiriam no primeiro ajuste, que é a dívida 8.1 do legado outra vez.
--
--   E o conteúdo NÃO vem junto: a view devolve NÚMERO. O quadro continua sem
--   trazer descrição, sem trazer corpo de comentário e sem trazer nome de
--   arquivo. `hasAttachment` é `attachment_count > 0`, calculado no banco.
--
--   CUSTO DECLARADO: a view passa de 5 para 8 subconsultas correlacionadas por
--   linha. Com as 18 tarefas reais é ruído; com 500 numa lista são 4000 buscas
--   por índice numa consulta de quadro. Os três índices novos
--   (`…_task_idx`) são exatamente o que as sustenta.
--
-- ======================================================= O ALCANCE, DE NOVO ==
--   Comentário, anexo e link HERDAM o alcance da tarefa. Nenhuma expressão
--   nova: `ideworks.can_reach_task_id` é da F17.3 e já serve `task_assignees`,
--   `task_watchers` e `task_checklists`.
--
--   Ela recebe o ID DA TAREFA, e não as colunas da linha nova, e isso é seguro
--   — ao contrário do caso medido na F17.2b. Lá a função recebia o id da linha
--   SENDO INSERIDA e o `with check` julgava uma linha que a subconsulta ainda
--   não enxergava, devolvendo nulo (e nulo nega). Aqui a subconsulta é em OUTRA
--   tabela, e a tarefa já existe antes do comentário — senão a chave
--   estrangeira recusaria primeiro.
-- =============================================================================

-- --- o comentário -------------------------------------------------------------
create table if not exists ideworks.task_comments (
  id           uuid primary key default gen_random_uuid(),

  -- `cascade`: o comentário é parte da tarefa. Fora dela ele não quer dizer
  -- nada — não há a quem responder nem sobre o que falar. Mesma decisão de
  -- `task_assignees` (F4.8), `task_watchers` (F17.10) e `task_checklists`
  -- (F17.15).
  task_id      uuid not null references ideworks.tasks (id) on delete cascade,

  -- A RESPOSTA EM LINHA. Um nível só, como no ClickUp — ver o cabeçalho.
  parent_id    uuid,

  -- AS DUAS COLUNAS QUE SUBSTITUEM UM GATILHO INTEIRO, iguais às de
  -- `checklist_items` na F17.15.
  --   `nest_level`   0 para comentário, 1 para resposta.
  --   `parent_level` -1 para comentário, 0 para resposta — o nível que o pai
  --                  DEVE ter.
  --
  -- Um comentário de nível 0 pede pai de nível -1, que nenhuma linha tem: ele
  -- só existe SEM pai. Uma resposta de nível 1 pede pai de nível 0. O nível
  -- decresce estritamente, logo não há neto e não há ciclo.
  nest_level   smallint generated always as
               (case when parent_id is null then 0 else 1 end) stored,
  parent_level smallint generated always as
               (case when parent_id is null then -1 else 0 end) stored,

  -- MARKDOWN, como a descrição. É o mesmo formato de armazenamento, e quem
  -- desenha é o mesmo `src/ui/Markdown.tsx` — o renderizador somente-leitura
  -- que ficou sem chamador quando o editor rico entrou na F17.10b e foi
  -- mantido de propósito, para isto.
  body         text not null,

  -- Instante da edição, nulo enquanto ninguém editou. Carimbado por
  -- `ideworks.edit_task_comment`.
  edited_at    timestamptz,

  -- O AUTOR, e é ele que a política de escrita compara com quem age.
  -- `on delete set null` como toda outra referência a pessoa no schema: apagar
  -- a conta não apaga a entrega, e um comentário sem autor deixa de poder ser
  -- editado — que é a resposta certa, e não um comentário editável por
  -- qualquer um.
  author_id    uuid references auth.users (id) on delete set null,

  source_id    text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- A regra de nome da F17.4, usada aqui como regra de CORPO. Medida contra o
  -- banco nesta sessão: aceita o link cru do Dropbox, aceita `✅` e `👍`;
  -- recusa `...`, `{}` e só espaço. Comentário vazio não é comentário.
  constraint task_comments_body_says_something check (ideworks.is_meaningful_name(body)),

  -- O trio que a chave estrangeira composta referencia.
  constraint task_comments_id_level_key unique (id, nest_level, task_id),

  -- Três coisas numa restrição só: a resposta está um nível abaixo, está na
  -- MESMA tarefa, e não há ciclo. `on delete cascade` porque a resposta sem a
  -- fala que ela responde é um fragmento sem contexto.
  constraint task_comments_parent_fk
    foreign key (parent_id, parent_level, task_id)
    references ideworks.task_comments (id, nest_level, task_id)
    on delete cascade
);

create unique index if not exists task_comments_source_key
  on ideworks.task_comments (source_id) where source_id is not null;

-- A ordem da conversa é CRONOLÓGICA, e o índice é o que a serve. Ele também
-- sustenta a contagem de `task_progress`.
create index if not exists task_comments_task_idx
  on ideworks.task_comments (task_id, created_at);

-- A contagem de respostas de cada comentário — o `reply_count` do ClickUp.
-- Parcial porque a esmagadora maioria dos comentários não é resposta.
create index if not exists task_comments_parent_idx
  on ideworks.task_comments (parent_id) where parent_id is not null;

-- "O que eu escrevi" — o outro sentido, que a F17.13 vai listar. Mesmo par de
-- `task_assignees_user_idx` (F4.8) e `checklist_items_assignee_idx` (F17.15).
create index if not exists task_comments_author_idx
  on ideworks.task_comments (author_id) where author_id is not null;

comment on table ideworks.task_comments is
  'A conversa da tarefa. Na Agencia Ide o comentario com o link do Dropbox E a '
  'entrega — nao e metadado. Corpo em markdown, desenhado pelo mesmo '
  'src/ui/Markdown.tsx da descricao. Resposta em linha de UM nivel, como no '
  'ClickUp.';
comment on column ideworks.task_comments.parent_id is
  'A resposta em linha. UM nivel so, garantido pelas colunas geradas e por '
  'task_comments_parent_fk — sem gatilho nenhum, porque o nivel decresce '
  'estritamente e nao ha caminho de volta.';
comment on column ideworks.task_comments.body is
  'Markdown. Passa por ideworks.is_meaningful_name: comentario so com '
  'pontuacao ou so com espaco e recusado. Aceita o link cru e aceita emoji — '
  'medido contra o banco.';
comment on column ideworks.task_comments.edited_at is
  'Instante da edicao, nulo enquanto ninguem editou. Carimbado por '
  'ideworks.edit_task_comment. Instante e nao booleano: "editado as 14:32" '
  'responde se o link mudou depois de lido; "editado" nao responde nada.';
comment on column ideworks.task_comments.author_id is
  'Quem escreveu. E ele que a politica compara com ideworks.acting_user_id() '
  'para deixar editar e apagar. Sem autor (conta apagada) ninguem edita, que e '
  'a resposta certa.';
comment on constraint task_comments_parent_fk on ideworks.task_comments is
  'Tres coisas numa restricao so: a resposta esta um nivel abaixo, esta na '
  'mesma tarefa, e nao ha ciclo. Mesmo desenho de checklist_items_parent_fk na '
  'F17.15.';

-- --- o anexo, no balde privado ------------------------------------------------
-- A LINHA SÓ NASCE DEPOIS QUE OS BYTES CHEGAM, e isso é desenho.
--   Uma coluna `status = 'enviando'` produziria anexo que aparece na ficha e
--   não abre — e ninguém sabe se o arquivo se perdeu ou se ainda está subindo.
--   `server/board-anexos.ts` grava o objeto PRIMEIRO e insere a linha DEPOIS;
--   se a inserção falhar, ele apaga o objeto. O balde pode ficar com um órfão
--   numa falha de rede no meio; a ficha nunca fica com uma promessa vazia.
create table if not exists ideworks.task_attachments (
  id           uuid primary key default gen_random_uuid(),

  task_id      uuid not null references ideworks.tasks (id) on delete cascade,

  file_name    text not null,

  -- A EXTENSÃO É DERIVADA, e não informada. Regra 1 do roteiro: o que se pode
  -- calcular não se guarda duas vezes. Sondado: `Roteiro.PDF`→`pdf`,
  -- `a.b.Jpeg`→`jpeg`, `x.tar.gz`→`gz`, `sem-extensao`→nulo.
  --
  -- O teto de 12 caracteres é o que impede um nome com um ponto no meio de uma
  -- frase de virar "extensão".
  extension    text generated always as
               (lower(substring(file_name from '[.]([A-Za-z0-9]{1,12})$'))) stored,

  -- O tipo declarado por quem enviou. NÃO HÁ LISTA DE PERMISSÃO, e a ausência
  -- é medida: a agência anexa PDF, imagem, `.ai`, `.psd` e `.zip`, e uma lista
  -- recusaria trabalho real na primeira semana.
  --
  -- O risco correspondente é tratado na LEITURA, e não aqui: a URL assinada sai
  -- sempre com `?download=`, então o navegador SALVA em vez de renderizar. Só
  -- imagem e PDF são pré-visualizados, e a tela decide isso por uma lista curta
  -- que ela conhece.
  content_type text not null,

  -- Bytes. `bigint` porque `integer` estoura em 2 GB, e o dia em que alguém
  -- anexar um vídeo bruto não deve ser o dia em que a coluna estoura.
  byte_size    bigint not null,

  -- A chave do objeto dentro de `ideworks-anexos`. Única porque duas linhas
  -- apontando para o mesmo objeto fariam apagar uma delas quebrar a outra.
  --
  -- O caminho começa pelo id da TAREFA, e isso não é organização: é o que
  -- permite, quando a chave de servico existir, uma politica de storage por
  -- prefixo — e e o que torna "apagar a tarefa apaga os objetos dela" uma
  -- varredura de prefixo em vez de uma lista.
  storage_path text not null,

  uploaded_by  uuid references auth.users (id) on delete set null,

  source_id    text,

  created_at   timestamptz not null default now(),

  constraint task_attachments_name_is_a_name check (ideworks.is_meaningful_name(file_name)),

  -- Arquivo de zero byte é arquivo que não subiu. Recusar é melhor que mostrar
  -- um anexo que abre vazio.
  constraint task_attachments_size_positive check (byte_size > 0),

  -- 25 MiB. O teto NÃO é do Postgres nem do balde: é da memória do Worker, que
  -- é de 128 MB e precisa segurar o corpo inteiro para repassá-lo. Ele está
  -- declarado aqui para a recusa vir do banco também, e não só do código.
  constraint task_attachments_size_ceiling check (byte_size <= 26214400),

  constraint task_attachments_type_not_blank check (btrim(content_type) <> ''),

  constraint task_attachments_path_not_blank check (btrim(storage_path) <> '')
);

create unique index if not exists task_attachments_path_key
  on ideworks.task_attachments (storage_path);

create unique index if not exists task_attachments_source_key
  on ideworks.task_attachments (source_id) where source_id is not null;

create index if not exists task_attachments_task_idx
  on ideworks.task_attachments (task_id, created_at);

comment on table ideworks.task_attachments is
  'O arquivo da tarefa. Os bytes moram no balde PRIVADO ideworks-anexos; aqui '
  'fica so a ficha dele. A linha so nasce depois que os bytes chegam — status '
  '"enviando" produziria anexo que aparece e nao abre.';
comment on column ideworks.task_attachments.extension is
  'Gerada a partir do nome. Regra 1 do roteiro: o que se calcula nao se guarda '
  'duas vezes. Nula quando o nome nao tem extensao.';
comment on column ideworks.task_attachments.content_type is
  'O tipo declarado por quem enviou. SEM lista de permissao, de proposito: a '
  'agencia anexa .ai, .psd e .zip. O risco e tratado na leitura — a URL '
  'assinada sai com ?download=, e so imagem e PDF sao pre-visualizados.';
comment on column ideworks.task_attachments.storage_path is
  'A chave do objeto dentro de ideworks-anexos, comecando pelo id da tarefa. O '
  'prefixo por tarefa e o que torna a limpeza uma varredura em vez de uma '
  'lista.';
comment on constraint task_attachments_size_ceiling on ideworks.task_attachments is
  '25 MiB. O teto e da memoria do Worker (128 MB), que segura o corpo inteiro '
  'para repassa-lo ao balde — nao do Postgres nem do balde.';

-- --- o link externo, coisa de primeira classe ---------------------------------
create table if not exists ideworks.task_links (
  id         uuid primary key default gen_random_uuid(),

  task_id    uuid not null references ideworks.tasks (id) on delete cascade,

  -- O rótulo é o que a pessoa lê. Sem ele a ficha vira uma pilha de endereços
  -- de 90 caracteres, que é exatamente o problema que esta tabela resolve.
  label      text not null,

  url        text not null,

  sort_order integer not null default 0,

  created_by uuid references auth.users (id) on delete set null,

  source_id  text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint task_links_label_is_a_name check (ideworks.is_meaningful_name(label)),

  -- LISTA DE PERMISSÃO, e não de proibição. Sondado contra o banco:
  -- `javascript:alert(1)` e `JavaScript:alert(1)` recusados, `data:` recusado,
  -- endereço com espaço recusado. O mesmo critério de `enderecoSeguro` em
  -- `src/board/markdown.ts`, agora também no banco — porque quem chama a API
  -- não é necessariamente a tela.
  constraint task_links_url_is_web check (url ~* '^https?://[^[:space:]]+$')
);

create unique index if not exists task_links_source_key
  on ideworks.task_links (source_id) where source_id is not null;

create index if not exists task_links_task_idx
  on ideworks.task_links (task_id, sort_order);

comment on table ideworks.task_links is
  'O link externo como coisa propria, ao lado do anexo. Dropbox e Google Docs '
  'sao o padrao da casa e hoje vivem colados no meio do texto da descricao. '
  'Rotulo e endereco, sem tirar nada de onde ja esta.';
comment on constraint task_links_url_is_web on ideworks.task_links is
  'Lista de PERMISSAO: so http e https, e sem espaco. javascript: e data: sao '
  'recusados pelo banco, e nao so pela tela — quem chama a API nao e '
  'necessariamente a tela.';

-- --- a ação de escrever comentário --------------------------------------------
-- POR QUE UMA AÇÃO, E NÃO UM `insert` DIRETO
--   Uma razão só, e ela basta: a RESPOSTA tem que nascer na mesma tarefa do
--   comentário que ela responde, e quem escreve manda o id do PAI, não o da
--   tarefa. Resolver isso no chamador seria uma segunda versão da regra — e a
--   segunda é sempre a errada.
--
--   `security invoker`, de propósito, ao contrário de `set_checklist_item_resolved`.
--   Lá o alcance precisava ser conferido à mão porque a função escrevia por id;
--   aqui as políticas fazem todo o trabalho: `task_comments_insert` exige
--   alcance e exige que o autor seja quem age. Uma função `definer` teria que
--   reimplementar as duas — e reimplementar regra de acesso é a dívida 8.1.
create or replace function ideworks.post_task_comment(
  p_task_id   uuid,
  p_body      text,
  p_parent_id uuid default null)
  returns uuid
  language plpgsql
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_task uuid;
  v_id   uuid;
begin
  if p_parent_id is not null then
    -- A tarefa vem do PAI, e não de quem chama. Filtrado pela política: um
    -- comentário fora do alcance simplesmente não aparece aqui.
    select c.task_id into v_task
      from ideworks.task_comments c
     where c.id = p_parent_id;

    if not found then
      raise exception
        'o comentario que voce quer responder nao existe ou esta fora do seu alcance'
        using errcode = '42501';
    end if;

    -- Responder um comentario que ja e resposta e recusado pela chave
    -- estrangeira composta, com `23503`. A recusa vem daqui antes, com frase —
    -- `violates foreign key constraint task_comments_parent_fk` nao explica a
    -- ninguem que a conversa e de um nivel so.
    if exists (select 1 from ideworks.task_comments c
                where c.id = p_parent_id and c.parent_id is not null) then
      raise exception
        'no ClickUp a conversa tem UM nivel: responde-se ao comentario, nao a uma resposta. Responda o comentario original.'
        using errcode = '23514';
    end if;

    -- Quem chama pode ter mandado a tarefa junto. Se mandou OUTRA, e engano de
    -- quem chama, e engano silencioso e pior que recusa.
    if p_task_id is not null and p_task_id <> v_task then
      raise exception
        'a resposta pertence a tarefa do comentario que ela responde, e a tarefa informada nao e essa.'
        using errcode = '23514';
    end if;
  else
    v_task := p_task_id;
  end if;

  if v_task is null then
    raise exception 'comentario precisa de tarefa, ou do comentario que ele responde'
      using errcode = '22023';
  end if;

  -- O ALCANCE VEM DO BANCO, E A CONFERENCIA E ANTES DA ESCRITA.
  --   `task_comments_insert` recusaria de qualquer jeito — `with check` LEVANTA
  --   `42501`, nao filtra em silencio como o `using` de um `update`. Mas a
  --   frase dele e "new row violates row-level security policy for table
  --   task_comments", que nao diz a ninguem o que fazer.
  --
  --   Este `select` e recortado pela politica de `tasks`: tarefa fora do
  --   alcance simplesmente nao aparece. E a mesma pergunta que a politica fara,
  --   feita antes, so para a recusa ser legivel. Nao e uma segunda regra: e a
  --   mesma politica, consultada.
  if not exists (select 1 from ideworks.tasks t where t.id = v_task) then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;

  insert into ideworks.task_comments (task_id, parent_id, body, author_id)
  values (v_task, p_parent_id, btrim(p_body), ideworks.acting_user_id())
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function ideworks.post_task_comment(uuid, text, uuid) is
  'Escreve comentario ou resposta. A resposta HERDA a tarefa do comentario que '
  'responde — quem chama manda o id do pai, nao o da tarefa. Invoker de '
  'proposito: as politicas ja exigem alcance e ja exigem que o autor seja quem '
  'age.';

-- --- a ação de editar ---------------------------------------------------------
-- O `edited_at` mora AQUI, e é o único caminho de edição.
--
-- A recusa não distingue "não existe" de "não é seu", e isso é deliberado: a
-- política de `update` já filtrou por `author_id = acting_user_id()`, então a
-- linha alheia simplesmente não aparece — e dizer "esse comentario nao e seu"
-- confirmaria que ele existe.
create or replace function ideworks.edit_task_comment(
  p_comment_id uuid,
  p_body       text)
  returns void
  language plpgsql
  set search_path = ideworks, pg_temp
as $fn$
begin
  update ideworks.task_comments c
     set body       = btrim(p_body),
         edited_at  = now(),
         updated_at = now()
   where c.id = p_comment_id;

  if not found then
    raise exception
      'comentario nao encontrado, ou nao e seu. So o autor edita o proprio comentario — num sistema onde o comentario E a entrega, reescrever a fala de outra pessoa e reescrever o que foi entregue.'
      using errcode = '42501';
  end if;
end;
$fn$;

comment on function ideworks.edit_task_comment(uuid, text) is
  'Reescreve o proprio comentario e carimba edited_at. So o autor alcanca a '
  'linha — quem filtra e a politica task_comments_update, nao um if aqui. A '
  'recusa nao distingue "nao existe" de "nao e seu", de proposito.';

-- --- a ação de guardar link ---------------------------------------------------
-- `max + 1`, e não `count`: apagar o link do meio deixaria dois com a mesma
-- posição, e a ordem passaria a depender do desempate por nome. Mesma decisão
-- de `createChecklist` na F17.15.
create or replace function ideworks.add_task_link(
  p_task_id uuid,
  p_label   text,
  p_url     text)
  returns uuid
  language plpgsql
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_id uuid;
begin
  -- Mesma conferencia de `post_task_comment`, e pelo mesmo motivo: a politica
  -- recusaria com `42501`, mas com a frase crua do Postgres. Ver la.
  if not exists (select 1 from ideworks.tasks t where t.id = p_task_id) then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;

  insert into ideworks.task_links (task_id, label, url, sort_order, created_by)
  select p_task_id, btrim(p_label), btrim(p_url),
         coalesce(max(l.sort_order) + 1, 0), ideworks.acting_user_id()
    from ideworks.task_links l
   where l.task_id = p_task_id
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function ideworks.add_task_link(uuid, text, text) is
  'Guarda o link externo na tarefa, na ultima posicao. `max + 1` e nao `count`: '
  'apagar o link do meio deixaria dois com a mesma posicao. O endereco e '
  'recusado pelo check task_links_url_is_web se nao for http ou https.';

-- --- segurança por linha ------------------------------------------------------
alter table ideworks.task_comments    enable row level security;
alter table ideworks.task_attachments enable row level security;
alter table ideworks.task_links       enable row level security;

-- LER É ALCANCE PURO. A MESMA função das políticas de `task_assignees`,
-- `task_watchers` e `task_checklists`, e não uma cópia da expressão.
drop policy if exists task_comments_select on ideworks.task_comments;
create policy task_comments_select on ideworks.task_comments for select
  using (ideworks.can_reach_task_id(task_id));

-- ESCREVER EXIGE SER O AUTOR — ver o cabeçalho. Sem esta metade, quem alcança a
-- tarefa poderia postar em nome de outra pessoa, que num sistema onde o
-- comentário É a entrega é falsificação de entrega.
drop policy if exists task_comments_insert on ideworks.task_comments;
create policy task_comments_insert on ideworks.task_comments for insert
  with check (ideworks.can_reach_task_id(task_id)
              and author_id = ideworks.acting_user_id());

drop policy if exists task_comments_update on ideworks.task_comments;
create policy task_comments_update on ideworks.task_comments for update
  using      (ideworks.can_reach_task_id(task_id)
              and author_id = ideworks.acting_user_id())
  with check (ideworks.can_reach_task_id(task_id)
              and author_id = ideworks.acting_user_id());

drop policy if exists task_comments_delete on ideworks.task_comments;
create policy task_comments_delete on ideworks.task_comments for delete
  using (ideworks.can_reach_task_id(task_id)
         and author_id = ideworks.acting_user_id());

-- ANEXO E LINK NÃO TÊM REGRA DE AUTOR, e a diferença é deliberada: o arquivo
-- entregue e o link do Dropbox são da TAREFA, não de quem os pendurou. Quem
-- trabalha na tarefa troca um PDF desatualizado. O comentário é FALA — e fala
-- alheia não se reescreve.
drop policy if exists task_attachments_select on ideworks.task_attachments;
create policy task_attachments_select on ideworks.task_attachments for select
  using (ideworks.can_reach_task_id(task_id));

drop policy if exists task_attachments_write on ideworks.task_attachments;
create policy task_attachments_write on ideworks.task_attachments for all
  using      (ideworks.can_reach_task_id(task_id))
  with check (ideworks.can_reach_task_id(task_id));

drop policy if exists task_links_select on ideworks.task_links;
create policy task_links_select on ideworks.task_links for select
  using (ideworks.can_reach_task_id(task_id));

drop policy if exists task_links_write on ideworks.task_links;
create policy task_links_write on ideworks.task_links for all
  using      (ideworks.can_reach_task_id(task_id))
  with check (ideworks.can_reach_task_id(task_id));

-- --- a contagem, num lugar só -------------------------------------------------
-- O TEXTO ABAIXO É O DA F17.15, COM TRÊS CONTAGENS A MAIS. Nada foi removido, e
-- nada foi reescrito: `subtask_count`, `subtask_done`, `checklist_count`,
-- `checklist_total` e `checklist_done` saem exatamente como estavam.
--
-- POR QUE AQUI, E NÃO NUMA VIEW NOVA
--   Porque é a mesma pergunta. Cartão, linha e ficha já leem daqui para saber
--   quantas subtarefas há; perguntar "tem anexo?" em outro lugar obrigaria o
--   quadro a duas junções e faria a próxima etapa escolher entre as duas.
--   Uma definição só — a lição da dívida 8.1, e a razão de a view existir.
--
-- POR QUE NÚMERO, E NÃO BOOLEANO
--   `hasAttachment` é `attachment_count > 0`, e o número custa o mesmo que o
--   booleano (o índice responde os dois com uma busca). Mas o número também
--   serve o cabeçalho da seção — `Anexos · 3` — e o booleano não serviria.
--
-- `security_invoker` para a view respeitar a política de quem consulta, como
-- `tree`, `list_workflow`, `task_labels` e a própria `task_progress` desde a
-- F17.15. Sem isso ela rodaria com os poderes do dono e contaria comentário que
-- quem pergunta não pode ver.
drop view if exists ideworks.task_progress;
create view ideworks.task_progress
  with (security_invoker = true)
as
select
  t.id as task_id,

  -- Filhas DIRETAS, e não a descendência inteira. A justificativa está na
  -- decisão 2 do cabeçalho da F17.15; a recursão aparece navegando, não somando.
  (select count(*)
     from ideworks.tasks c
    where c.parent_id = t.id
      and c.archived_at is null)::int as subtask_count,

  (select count(*)
     from ideworks.tasks c
    where c.parent_id = t.id
      and c.archived_at is null
      and c.completed_at is not null)::int as subtask_done,

  (select count(*)
     from ideworks.task_checklists k
    where k.task_id = t.id)::int as checklist_count,

  (select count(*)
     from ideworks.checklist_items i
     join ideworks.task_checklists k on k.id = i.checklist_id
    where k.task_id = t.id)::int as checklist_total,

  (select count(*)
     from ideworks.checklist_items i
     join ideworks.task_checklists k on k.id = i.checklist_id
    where k.task_id = t.id
      and i.resolved_at is not null)::int as checklist_done,

  -- F17.6 — o indicador "tem anexo" que a F17.9a não pôde fazer.
  (select count(*)
     from ideworks.task_attachments a
    where a.task_id = t.id)::int as attachment_count,

  (select count(*)
     from ideworks.task_links l
    where l.task_id = t.id)::int as link_count,

  -- A CONVERSA INTEIRA, resposta incluída. A pergunta que o número responde no
  -- cartão é "há conversa nesta tarefa", e uma resposta é conversa. A contagem
  -- POR comentário — o `reply_count` do ClickUp — é outra pergunta, mora só na
  -- ficha, e por isso é calculada lá: numero que aparece num lugar so nao
  -- precisa de definicao compartilhada.
  (select count(*)
     from ideworks.task_comments c
    where c.task_id = t.id)::int as comment_count

from ideworks.tasks t;

comment on view ideworks.task_progress is
  'A contagem de subtarefas, itens de checklist, anexos, links e comentarios da '
  'tarefa, numa definicao so — cartao, linha e ficha leem daqui. subtask_count '
  'e de filhas DIRETAS e nao conta arquivada; checklist_total conta o item e o '
  'filho dele; comment_count conta a resposta tambem.';

-- --- permissões ---------------------------------------------------------------
-- Expressão de política roda com os poderes de quem consulta: sem `execute`, o
-- papel do app bateria em "permission denied for function" em vez de bater na
-- regra. `can_reach_task_id` e `acting_user_id` já foram concedidas na F17.3 e
-- na F1.9 e não se repetem aqui.
grant all privileges on all tables in schema ideworks to ideworks_app;
grant execute on function ideworks.post_task_comment(uuid, text, uuid) to ideworks_app;
grant execute on function ideworks.edit_task_comment(uuid, text)       to ideworks_app;
grant execute on function ideworks.add_task_link(uuid, text, text)     to ideworks_app;

-- =============================================================================
-- O BALDE — `ideworks-anexos`, privado, sem exceção
-- =============================================================================
-- ELE NASCE `public = false` E SEM POLÍTICA PERMISSIVA NENHUMA.
--
--   `storage.objects` tem RLS ligada e as quatro políticas que existem hoje são
--   TODAS filtradas por `bucket_id = 'client-history-documents'` — o balde do
--   legado. Nenhuma delas alcança este.
--
--   RLS ligada + zero política que case = NEGADO, para `anon` e para
--   `authenticated`, por construção. Não é uma configuração que alguém possa
--   afrouxar sem escrever uma política nova e visível.
--
-- POR QUE NÃO SE ESCREVE AQUI UMA POLÍTICA QUE CHAME `can_reach_task_id`
--   Foi medido, e não funcionaria — funcionaria ao contrário.
--
--     ideworks.acting_user_id() = current_setting('app.user_id', true)
--
--   Esse valor é declarado pelo Worker em `withActor`, numa sessão Postgres de
--   verdade. A API de Storage não roda SQL do chamador: ela conecta como
--   `authenticated` com as claims do crachá, e `app.user_id` nunca é declarado
--   ali. A função devolveria NULO para todo mundo, e nulo nega — a política
--   pareceria existir e negaria até quem tem direito.
--
--   E medido também: o schema `ideworks` concede USAGE só a `postgres` e a
--   `ideworks_app`. Nem `anon` nem `authenticated` alcançam o schema, então a
--   política sequer conseguiria EXECUTAR a função.
--
--   As duas saídas seriam (a) escrever uma SEGUNDA regra de acesso dentro de
--   `storage`, que é exatamente o que este projeto proíbe desde a F17.1, ou
--   (b) fazer `acting_user_id` cair em `auth.uid()` — mexer na função de que
--   TODA política do schema depende, numa etapa que não é essa. Nenhuma das
--   duas se faz aqui.
--
--   O caminho certo é o que a arquitetura já usa em todo o resto: **o Worker é
--   a porta**. Ele confere o alcance NO BANCO, como `ideworks_app`, e só então
--   fala com o Storage com a chave de serviço. A permissão continua vindo do
--   banco; a chave é só o transporte.
--
-- A CHAVE DE SERVIÇO NÃO EXISTE NESTE PROJETO HOJE
--   `IDEWORKS_SERVER_SUPABASE_SERVICE_KEY` está declarada em `.env.example` e
--   lida por `worker/index.ts`, e ENQUANTO ELA FALTAR as rotas de envio e de
--   leitura respondem 503 dizendo o nome dela. Comentário, link, o modelo do
--   anexo e o indicador funcionam sem ela.
--
-- O ROLLBACK NÃO APAGA O BALDE, E A RAZÃO FOI MEDIDA DUAS VEZES
--   Primeira medição: `delete from storage.buckets` responde
--   `42501 Direct deletion from storage tables is not allowed. Use the Storage
--   API instead.` — mesmo como `postgres`. O guarda é o gatilho
--   `storage.protect_delete()`.
--
--   SEGUNDA MEDIÇÃO, que corrigiu a primeira: o gatilho TEM uma porta, e ela é
--   desenho do Supabase, não brecha. Ele lê `current_setting(
--   'storage.allow_delete_query')` e só recusa quando o valor não é `'true'`.
--   Com `set local storage.allow_delete_query = 'true'` dentro de uma
--   transação, o `delete` passa — sondado num balde descartável, que sumiu.
--
--   Então "não dá para apagar" era FALSO, e a decisão de não apagar continua
--   valendo por outro motivo, que é o verdadeiro: um balde vazio e
--   `public = false`, sem nenhuma política permissiva, é INERTE — não vaza
--   nada e não custa nada. Apagá-lo pelo rollback exigiria desligar um guarda
--   de perda de dados do provedor para remover algo inofensivo. Quem quiser
--   removê-lo de fato usa o painel ou a API de Storage.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('ideworks-anexos', 'ideworks-anexos', false, 26214400)
on conflict (id) do update
  -- `do update` e nao `do nothing`: se o balde ja existisse PUBLICO por engano,
  -- `do nothing` deixaria a divida do legado se repetir em silencio. A
  -- reaplicacao da migration tem que FECHAR o balde, nao ignora-lo.
  set public = false, file_size_limit = 26214400;
