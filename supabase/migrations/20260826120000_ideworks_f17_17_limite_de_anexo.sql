-- =============================================================================
-- F17.17 — O TETO DO ANEXO CAI PARA 5 MB
-- =============================================================================
-- DECISAO DO USUARIO, 2026-08-26: "5mb no maximooooo".
--
-- A F17.6 pos o teto em 25 MiB (26214400) por um motivo tecnico — a memoria do
-- Worker, que e de 128 MB e segura o corpo inteiro para repassa-lo ao balde.
-- Esse motivo continua valendo como TETO ABSOLUTO, mas ele nao e o limite que a
-- agencia deve enxergar. O limite de produto e 5 MB, e e este arquivo que o
-- escreve no banco.
--
-- -----------------------------------------------------------------------------
-- OS DOIS TETOS PRECISAM CONCORDAR, E ESSA E A RAZAO DE ESTA MIGRATION EXISTIR
-- -----------------------------------------------------------------------------
--   Ha dois guardas de tamanho, e eles vivem em lugares diferentes:
--
--     1. `task_attachments_size_ceiling` .... o `check` da LINHA, no Postgres.
--        Ele recusa DEPOIS que os bytes ja subiram — o codigo grava o objeto e
--        so entao insere a ficha. A recusa dele custa um envio inteiro.
--
--     2. `storage.buckets.file_size_limit` .. o teto do BALDE, no servico de
--        Storage. Ele recusa DURANTE o envio, com um 413 e uma frase em ingles.
--
--   Se os dois divergirem, a pessoa recebe o erro de um lugar diferente do que
--   a tela promete. Divergencia aqui nao e inconsistencia estetica: e um envio
--   perdido e uma mensagem que ninguem entende.
--
--   O TERCEIRO LUGAR e `TETO_DE_BYTES`, em `src/board/conversa.ts` — a tela e o
--   servidor o importam de la, e `src/board/conversa.test.ts` le ESTE arquivo e
--   exige que os dois numeros escritos aqui sejam ele. `provar-comentarios-e-
--   anexos.mjs` fecha o circulo perguntando ao banco e ao Storage de verdade.
--
--   5 * 1024 * 1024 = 5242880. A base e 1024 porque e a que o Explorador, o
--   Finder e o proprio ClickUp mostram: "5 MB" na tela e 5242880 no banco sao a
--   mesma coisa dita em duas linguas.
--
-- -----------------------------------------------------------------------------
-- POR QUE ISTO NAO QUEBRA NENHUMA LINHA EXISTENTE
-- -----------------------------------------------------------------------------
--   `alter table ... add constraint` VALIDA as linhas que ja existem. Se
--   houvesse um anexo maior que 5 MB guardado, este arquivo falharia inteiro —
--   e falhar e o comportamento certo: baixar o teto abaixo de algo que ja esta
--   la exige uma decisao humana sobre o que fazer com aquele arquivo.
--
--   Medido em 2026-08-26, antes de aplicar: `ideworks.task_attachments` tem
--   ZERO linhas. A chave de servico do Storage acabou de ser ligada e ninguem
--   anexou nada ainda. A validacao passa sem tocar em dado de ninguem.
--
-- -----------------------------------------------------------------------------
-- O QUE ESTE ARQUIVO NAO FAZ
-- -----------------------------------------------------------------------------
--   Nao cria tabela, nao mexe em politica, nao toca no schema `public` (que e
--   do Sistema IDE, em producao) e nao cria nem apaga usuario. Ele troca um
--   numero em dois lugares e reescreve os comentarios que o explicavam.
-- =============================================================================

-- --- 1. o `check` da linha ---------------------------------------------------
-- `drop` + `add` e nao `alter`: Postgres nao tem "alterar a expressao de um
-- check". O par acontece na mesma transacao da migration, entao nao existe
-- janela em que a tabela fique sem teto.
alter table ideworks.task_attachments
  drop constraint if exists task_attachments_size_ceiling;

alter table ideworks.task_attachments
  add constraint task_attachments_size_ceiling check (byte_size <= 5242880);

comment on constraint task_attachments_size_ceiling on ideworks.task_attachments is
  '5 MB (5242880 bytes) — decisao do usuario na F17.17, contra os 25 MiB da '
  'F17.6. O MESMO numero esta em storage.buckets.file_size_limit do balde '
  'ideworks-anexos e em TETO_DE_BYTES, em src/board/conversa.ts. Se os tres '
  'divergirem, a pessoa recebe o erro de um lugar diferente do que a tela '
  'promete. Arquivo maior entra como link do Dropbox, ao lado.';

-- --- 2. o teto do balde ------------------------------------------------------
-- O MESMO NUMERO, e escrito aqui na mesma transacao de proposito: separa-los em
-- duas migrations criaria um intervalo em que os dois discordam.
--
-- `update` e nao `insert ... on conflict`: o balde ja existe desde a F17.6, e
-- reinseri-lo aqui repetiria a decisao de `public = false` num arquivo que nao
-- e sobre isso. O `where` deixa o comando idempotente sem depender de conflito.
update storage.buckets
   set file_size_limit = 5242880
 where id = 'ideworks-anexos';

-- --- 3. a conferencia, dentro da propria migration ---------------------------
-- Ela e barata e responde a pergunta que importa: os dois tetos concordam?
-- Uma migration que so escreve deixa a conferencia para quem lembrar de fazer.
do $$
declare
  do_balde bigint;
  do_check text;
begin
  select file_size_limit into do_balde
    from storage.buckets where id = 'ideworks-anexos';

  select pg_get_constraintdef(c.oid) into do_check
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'ideworks'
     and t.relname = 'task_attachments'
     and c.conname = 'task_attachments_size_ceiling';

  if do_balde is distinct from 5242880 then
    raise exception 'o teto do balde ficou em % em vez de 5242880', do_balde;
  end if;

  if do_check is null or position('5242880' in do_check) = 0 then
    raise exception 'o check da linha nao ficou em 5242880: %', do_check;
  end if;

  raise notice 'teto do anexo: balde % · check % — os dois concordam', do_balde, do_check;
end $$;
