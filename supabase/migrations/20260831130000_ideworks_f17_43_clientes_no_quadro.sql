-- =============================================================================
-- F17.43 — OS CLIENTES ENTRAM NO QUADRO
--
-- O PEDIDO, COM A CAPTURA DO CLICKUP JUNTO
--   *"podemos puxar os clientes na parte de quadro?"* — a barra da Helena mostra
--   um espaço `TIME HELENA` com os CLIENTES como listas: Jatobá 11, Valentini
--   3, DXI 4, Clinimax 4, Sabor Doce 6, Estúdio Ide 15.
--
-- O QUE ESTAVA MEDIDO ANTES DE ESCREVER
--   `ideworks.lists` tinha `space_id`, `folder_id`, `name`, `content`,
--   `sort_order`, `archived_at`, `source_id` — e nenhuma coluna de cliente.
--   96 clientes, 6 listas. Pôr os clientes no quadro à mão daria 96 TEXTOS que
--   não sabem que são clientes: renomear um deles quebraria a ligação que
--   ninguém tinha declarado, e o quadro nunca chegaria à cota, ao contrato nem
--   ao nível de entrega que o painel já calcula.
--
--   Daí `lists.client_id`. A lista É a lista daquele cliente.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ 1. O VÍNCULO NÃO DÁ ALCANCE A NINGUÉM, E ISSO É A DECISÃO DA ETAPA
--
--   A F17.3 fez a TAREFA ter dois caminhos de alcance — a lista ou o cliente —,
--   e `can_reach_task` é a união dos dois. Seria um passo curto, e errado,
--   fazer `can_see_list` valer também por `can_see_client`: toda lista ligada a
--   um cliente viraria visível para quem enxerga o cliente, e 96 clientes
--   trazidos abririam de uma vez o quadro de trabalho de quem só tinha o
--   cadastro.
--
--   Isso NÃO foi pedido. O vínculo desta etapa é para NAVEGAR (a lista leva à
--   ficha) e para ligar o quadro à entrega. O alcance continua sendo o do NÓ,
--   exatamente como a F17.23 o deixou: `can_see_space`, `chain_level` e
--   `node_level` não são tocadas por esta migration, e `lists_select` continua
--   sendo `can_see_space(space_id)` e mais nada.
--
--   `scripts/provar-clientes-no-quadro.mjs` compara par a par, sobre o dado
--   real, a regra de antes com a de depois e exige `ganhou = 0`.
-- ─────────────────────────────────────────────────────────────────────────────
-- 2. O QUE O VÍNCULO PRECISA GARANTIR, E POR QUE CADA GARANTIA É DECLARADA
--
--   a) APAGAR O CLIENTE NÃO APAGA O TRABALHO. `on delete set null`, e não
--      `cascade`: a lista guarda tarefas, comentários e anexos de gente que
--      trabalhou. Levar tudo junto por causa de um cadastro seria destruir o
--      registro do trabalho para arrumar o cadastro.
--
--   b) O MESMO CLIENTE NÃO ENTRA DUAS VEZES NO MESMO ESPAÇO. É o que faz
--      "cliente já trazido some da escolha" ser verdade no banco, e não só na
--      tela: duas pessoas trazendo a mesma lista ao mesmo tempo dariam duas
--      listas com o mesmo nome, e ninguém saberia qual das duas é a do cliente.
--
--      O índice é POR ESPAÇO, e não global: o mesmo cliente pode ter lista no
--      espaço de um time e no de outro — é o desenho do ClickUp, em que a
--      Helena tem `Jatobá` no espaço dela e outro time pode ter a sua.
--
--      Ele NÃO é parcial por `archived_at`. Se fosse, arquivar a lista soltaria
--      o cliente para ser trazido de novo, e DESARQUIVAR a primeira bateria em
--      recusa — o desarquivamento é a volta que arquivar promete, e ele não
--      pode depender do que alguém fez no meio.
--
--   c) NINGUÉM LIGA A LISTA A UM CLIENTE QUE NÃO ENXERGA. `lists_write` fala do
--      ESPAÇO; ela não tem nada a dizer sobre o cliente. Sem o guarda abaixo,
--      qualquer pessoa com alcance ao espaço poderia escrever um identificador
--      de cliente qualquer na coluna.
--
--      É um guarda que ESTREITA: ele recusa escrita, e não abre leitura. O nome
--      do cliente continua saindo de `clients_select` na hora de ler — quem não
--      enxerga o cliente vê a lista sem o vínculo, e não o nome dele.
--
-- 3. POR QUE UM GATILHO, E NÃO UMA POLÍTICA
--   Pôr `can_see_client` no `using` de `lists_write` deixaria SEM EDIÇÃO toda
--   lista já ligada a um cliente fora do alcance de quem edita: renomear,
--   arquivar e mover parariam de funcionar por causa de uma coluna que a pessoa
--   nem estava mexendo. E `lists_write` é `for all` — inclui `select` —, o que
--   já custou três correções que não corrigiam nesta mesma fase.
--
--   O gatilho é `before insert or update of client_id`: renomear, arquivar e
--   mover NÃO mencionam a coluna e não pagam nada por ela.
--
-- 4. A VIEW `ideworks.tree` NÃO É TOCADA
--   Ela responde à pergunta do quadro — "que listas vivas eu alcanço" — e o
--   vínculo não muda essa resposta. Quem lê o cliente da lista é a árvore
--   completa (`server/tree.ts`), direto de `ideworks.lists`. Mexer na view
--   custaria a `security_invoker` inteira sendo reescrita por uma coluna que a
--   pergunta dela não faz.
-- =============================================================================

-- --- a coluna ----------------------------------------------------------------
alter table ideworks.lists
  add column if not exists client_id uuid;

alter table ideworks.lists
  drop constraint if exists lists_client_fk;

alter table ideworks.lists
  add constraint lists_client_fk
  foreign key (client_id) references ideworks.clients (id) on delete set null;

comment on column ideworks.lists.client_id is
  'A lista E a lista daquele cliente — F17.43. Opcional: a lista de time, a de '
  'demandas gerais e a `Skills` da referencia nao tem cliente nenhum. NAO da '
  'alcance: quem enxerga a lista continua sendo quem enxerga o espaco dela.';

comment on constraint lists_client_fk on ideworks.lists is
  '`on delete set null`, e nao cascata: apagar o cadastro do cliente nao pode '
  'levar junto as tarefas, os comentarios e os anexos de quem trabalhou nelas.';

-- --- o mesmo cliente nao entra duas vezes no mesmo espaco ---------------------
create unique index if not exists lists_client_key
  on ideworks.lists (space_id, client_id) where client_id is not null;

-- Para a pergunta do outro lado: "que listas sao deste cliente".
create index if not exists lists_client_idx
  on ideworks.lists (client_id) where client_id is not null;

-- --- o guarda do vinculo ------------------------------------------------------
create or replace function ideworks.list_client_reach_guard()
  returns trigger
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  -- Soltar o vinculo (`client_id` para nulo) nao pergunta nada: quem alcanca a
  -- lista pode desfazer a ligacao dela, e exigir alcance ao cliente para SOLTAR
  -- prenderia a lista a um cadastro que a pessoa nem enxerga.
  if new.client_id is null then
    return new;
  end if;

  -- No `update`, so quando a coluna MUDA de valor. Regravar o mesmo vinculo por
  -- tabela ou por ferramenta de escrita em bloco nao e um vinculo novo.
  if tg_op = 'UPDATE' and new.client_id is not distinct from old.client_id then
    return new;
  end if;

  if not ideworks.can_see_client(new.client_id) then
    raise exception
      'esse cliente esta fora do seu alcance: so da para ligar a lista a um cliente que voce ja enxerga. Nada foi gravado.'
      using errcode = '42501';
  end if;

  return new;
end;
$fn$;

comment on function ideworks.list_client_reach_guard() is
  'Impede ligar a lista a cliente fora do alcance de quem escreve — F17.43. '
  'ESTREITA e nunca alarga: ele recusa escrita, e nenhuma leitura passa a ser '
  'permitida por causa dele. `before insert or update of client_id`, para '
  'renomear, arquivar e mover a lista nao pagarem nada por ele.';

drop trigger if exists lists_client_reach_guard on ideworks.lists;
create trigger lists_client_reach_guard
  before insert or update of client_id on ideworks.lists
  for each row execute function ideworks.list_client_reach_guard();

-- --- permissoes ---------------------------------------------------------------
-- NADA A CONCEDER, e esta escrito para nao parecer esquecimento: a migration nao
-- cria tabela, view nem funcao chamavel. `list_client_reach_guard` e funcao de
-- gatilho, e permissao de funcao de gatilho e conferida na CRIACAO do gatilho,
-- nao a cada disparo — mesma nota da F17.3, da F17.4 e da F17.4b.
--
-- `ideworks.lists` ja e alcancavel por `ideworks_app` desde a F17.1
-- (`grant all privileges on all tables in schema ideworks`), e coluna nova de
-- tabela existente herda a permissao da tabela.
