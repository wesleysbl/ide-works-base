-- =============================================================================
-- F17.46 — QUEM RECEBE A TAREFA FICA SABENDO
--
-- O PEDIDO, E A CORREÇÃO DELE
--   *"se a Carla deve cuidar, isso não deveria notificar a Carla em Minhas
--   tarefas ou algo do gênero?"* — e logo depois: *"não só a Carla, dei o nome
--   como exemplo por conta da imagem, mas no caso de cada pessoa para qual a
--   automação for criada."*
--
--   Não há pessoa especial. O aviso é para QUEM QUER QUE a automação designe.
--
-- O ESTADO MEDIDO ANTES DE ESCREVER
--   A tarefa já APARECE em `Minhas tarefas` de quem recebeu: a leitura filtra
--   por `task_assignees`, e a F17.41 mediu `Carla 0→1`. O que não existia era
--   NOTIFICAÇÃO — nenhuma, em lugar nenhum do sistema. Então a tarefa cai na
--   tela da pessoa e ela descobre quando abrir. Para quem não fica olhando o
--   quadro, é a tarefa parada esperando alguém reparar, que é exatamente o que
--   a automação veio evitar.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ESTA MIGRATION CRIA UMA TABELA SÓ, E É PEQUENA DE PROPÓSITO
--
--   O aviso NÃO É UMA LINHA GRAVADA. Ele é lido do que já existe:
--
--     · a tarefa passada por automação .... `task_events.added_user_id`, que
--       diz exatamente quem recebeu (F17.41);
--     · o prazo virando .................... `tasks.due_on`, sem dado novo.
--
--   Gravar uma segunda linha "aviso" ao lado do evento seria a mesma verdade em
--   dois lugares — a dívida 8.1 do legado —, e a segunda cópia ficaria para
--   trás na primeira vez que o registro mudasse de forma. Pior: o aviso gravado
--   sobreviveria à pessoa PERDER o alcance da tarefa, e ela continuaria vendo
--   na caixa de entrada o nome de um trabalho que já não pode abrir.
--
--   Lendo, o alcance vem de graça e sempre certo: `task_events` já é recortada
--   por `can_reach_task_id` e `tasks` por `can_reach_task`, desde a F17.3. Não
--   há uma segunda regra de alcance nesta etapa, e não pode haver.
--
-- ⚠️ O QUE ESTA MIGRATION **NÃO** FAZ, E POR QUÊ
--   1. NÃO TOCA EM `task_events`. Aquele livro não se reescreve: ele não tem
--      política de `update` nem de `delete`, e continua sem. Uma coluna `lida`
--      nele faria dois leitores brigarem pelo mesmo registro — a tarefa que a
--      automação passa tem UM destinatário hoje, mas o evento é visível para
--      todo mundo que alcança a tarefa, e o "visto" é de quem lê, nunca do
--      fato. Por isso o visto mora AQUI, por pessoa.
--   2. NÃO AVISA QUEM PERDEU A TAREFA. `removed_user_ids` existe no livro, mas
--      "você deixou de cuidar disto" não foi pedido, e aviso que ninguém pediu
--      é ruído que ensina a ignorar a caixa.
--   3. NÃO AVISA POR MENÇÃO EM COMENTÁRIO. Medido: `task_comments` tem `body`,
--      `author_id`, `parent_id` e `nest_level` — e NENHUMA estrutura de menção.
--      Avisar por menção exige construir a menção primeiro, que é
--      funcionalidade própria. Fica como dívida, com a menção antes.
--   4. NÃO INVENTA REGISTRO RETROATIVO. O livro só registra automação: trocar
--      responsável à mão continua sem rastro, e por isso continua sem aviso. É
--      a mesma dívida que a F17.41 registrou, e escrevê-la de novo aqui é mais
--      honesto do que fabricar evento para um fato que ninguém observou.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 1 — o visto, que é de quem lê
-- ─────────────────────────────────────────────────────────────────────────────

-- A CHAVE É OPACA, E ISSO É A DECISÃO CENTRAL DESTA TABELA.
--
--   `notice_key` é um texto montado pela MESMA consulta que desenha o aviso, e
--   por ninguém mais. Duas formas hoje:
--
--     automation:<id do evento>          o fato já aconteceu e não muda
--     due:<id da tarefa>:<data do prazo>  o fato É a data
--
--   Nada nesta tabela sabe ler esse texto, e nenhuma outra consulta o monta.
--   Uma coluna `kind` mais uma `ref` obrigariam a consulta, o servidor e a tela
--   a concordarem sobre a gramática do par — e a terceira versão dela seria a
--   errada, como a F17.45 mediu no nome da regra de automação.
--
--   ⚠️ E A DATA DENTRO DA CHAVE DO PRAZO NÃO É ENFEITE: ela é o que faz o aviso
--   VOLTAR quando o prazo muda. Marcar "vi que vence dia 01" e a tarefa passar
--   para o dia 03 é um fato NOVO, e um visto antigo que o calasse esconderia a
--   mudança justamente de quem precisa dela. Prazo adiado para longe some
--   sozinho, porque o aviso é lido e não gravado — não há linha para limpar.
create table if not exists ideworks.notice_reads (
  -- `auth.users`, como `task_assignees.user_id` e `task_events.added_user_id`:
  -- é o mesmo sujeito, e a chave estrangeira apontando para outro lugar faria
  -- parecer que são coisas diferentes.
  user_id uuid not null references auth.users (id) on delete cascade,

  notice_key text not null,

  read_at timestamptz not null default now(),

  primary key (user_id, notice_key),

  -- Rede de cima contra chave montada por engano do lado de fora. Não é um
  -- analisador — de propósito: a tabela não conhece a gramática da chave.
  constraint notice_reads_key_sane
    check (btrim(notice_key) <> '' and length(notice_key) <= 200)
);

comment on table ideworks.notice_reads is
  'O "ja vi isto", POR PESSOA. O aviso em si nao e gravado: ele e lido de '
  'task_events e de tasks.due_on. Aqui fica so o que cada um ja leu, e por isso '
  'dois leitores do mesmo fato nunca brigam pelo mesmo registro — e task_events '
  'continua sem update e sem delete, como a F17.41 o desenhou.';
comment on column ideworks.notice_reads.notice_key is
  'Texto OPACO montado pela consulta que desenha o aviso, e por ninguem mais. '
  'No aviso de prazo ele carrega a DATA: prazo que muda e fato novo, e o visto '
  'antigo nao pode cala-lo.';
comment on column ideworks.notice_reads.read_at is
  'Quando esta pessoa marcou. Serve a tela de "ja vistos" — e nao ao aviso, que '
  'nao e uma linha.';

-- A leitura quente é sempre "o que EU já vi", e a chave primária já a atende
-- pela primeira coluna. O índice abaixo é o da outra pergunta, a da tela dos
-- vistos: "o que eu vi, do mais recente para o mais antigo".
create index if not exists notice_reads_recent_idx
  on ideworks.notice_reads (user_id, read_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 2 — segurança por linha, na mesma migration
--
-- ⚠️ NENHUMA POLÍTICA AQUI FALA DE ALCANCE DE TAREFA, e a ausência é o desenho.
--   Esta tabela guarda o que EU já li. Quem recorta o que eu POSSO ler são as
--   políticas de `task_events` e de `tasks`, que já existem e já são a única
--   regra. Repetir `can_reach_task_id` aqui daria duas respostas para a mesma
--   pergunta, e a de cima ficaria para trás na primeira mudança.
--
--   O efeito prático: uma linha de visto de tarefa que eu não alcanço mais é
--   uma linha que nenhuma consulta encontra do outro lado. Ela não vaza nada —
--   o que ela guarda é um texto que eu mesmo escrevi.
-- ─────────────────────────────────────────────────────────────────────────────

alter table ideworks.notice_reads enable row level security;

-- ⚠️ TRÊS POLÍTICAS SEPARADAS, E NENHUM `for all`. Está escrito porque três
-- etapas já quase publicaram correção que não corrigia por isto: `for all`
-- INCLUI `select`. Aqui as três dizem a mesma coisa, então um `for all` até
-- funcionaria — mas ele também PASSARIA A INCLUIR `update` no dia em que
-- alguém acrescentasse uma coluna, e "visto" não se edita: marca-se ou
-- desmarca-se. A ausência de política de `update` é a regra.
drop policy if exists notice_reads_select on ideworks.notice_reads;
create policy notice_reads_select on ideworks.notice_reads for select
  using (user_id = ideworks.acting_user_id());

drop policy if exists notice_reads_insert on ideworks.notice_reads;
create policy notice_reads_insert on ideworks.notice_reads for insert
  with check (user_id = ideworks.acting_user_id());

-- Desmarcar existe porque marcar é UM clique e some com o aviso. Sem a volta,
-- um toque errado apagaria para sempre o único lugar que diz "isto chegou para
-- você" — e a pessoa nem saberia o que perdeu. É a mesma razão de `Ver
-- arquivados` na árvore: o gesto que esconde precisa do gesto que revela.
drop policy if exists notice_reads_delete on ideworks.notice_reads;
create policy notice_reads_delete on ideworks.notice_reads for delete
  using (user_id = ideworks.acting_user_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 3 — permissoes
--
-- Tabela NOVA não herda o `grant all privileges on all tables in schema
-- ideworks` da F17.1: aquele comando alcançou as tabelas que existiam naquele
-- dia. Sem a linha abaixo, a caixa de entrada responderia "permission denied
-- for table notice_reads" — que é erro de dono, não de política.
--
-- ⚠️ TRÊS VERBOS, E `update` NÃO É UM DELES. É a mesma decisão da ausência de
-- política de `update`, agora na camada de baixo: "visto" não se edita, marca-se
-- ou desmarca-se. Duas redes independentes para a mesma regra — privilégio de
-- papel e política de linha —, e é assim que o resto do schema já se protege.
--
-- Nenhuma função nova nesta etapa: a leitura do aviso é consulta comum, e ela
-- atravessa as políticas de `task_events` e de `tasks` como qualquer outra.
-- ─────────────────────────────────────────────────────────────────────────────
grant select, insert, delete on ideworks.notice_reads to ideworks_app;
