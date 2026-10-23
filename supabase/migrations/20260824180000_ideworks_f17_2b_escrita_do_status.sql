-- =============================================================================
-- IDE WORKS — F17.2b  A escrita do status segue o dono da esteira
-- =============================================================================
-- O QUE ESTA ETAPA CONSERTA
--   A F17.2 declarou, no próprio cabeçalho, que a esteira do ESPAÇO é escrita
--   de administrador: "ela é o padrão herdado por toda lista que não tem a
--   própria — mexer nela muda o quadro do espaço inteiro de uma vez, e isso é
--   tão estrutural quanto criar o espaço".
--
--   `status_sets_write` cumpria isso. `statuses_write` não: ela usava
--   `can_see_status_set`, que é ALCANCE PURO. O funcionário comum não podia
--   criar nem renomear a esteira do espaço — mas podia reescrever o CONTEÚDO
--   dela inteiro, que é a mesma coisa por outro caminho.
--
--   Intenção declarada e comportamento real divergiam em silêncio, e
--   divergência silenciosa é a classe de dívida que este projeto existe para
--   não repetir.
--
-- A SONDA QUE EXPÔS O BURACO — 2026-08-24, COMO `ideworks_app`
--   Ator: funcionário não-administrador que ALCANÇA a empresa. Tudo dentro de
--   transação revertida, nada gravado.
--
--     recusado por erro     status_sets INSERT — criar outra esteira de espaço
--     bloqueado (0 linhas)  status_sets UPDATE — renomear a esteira do espaço
--     bloqueado (0 linhas)  status_sets DELETE — apagar a esteira do espaço
--
--     *** PERMITIDO (1) ***  statuses UPDATE — renomear `to do` do espaço
--     *** PERMITIDO (1) ***  statuses INSERT — acrescentar status ao espaço
--     *** PERMITIDO (1) ***  statuses DELETE — apagar `in progress` do espaço
--     *** PERMITIDO (3) ***  statuses UPDATE — trocar a COR do quadro do espaço
--
--   As quatro linhas com asterisco são o motivo deste arquivo existir. Ficam
--   registradas aqui para que ninguém "simplifique" a política de volta para
--   `can_see_status_set` achando que a distinção de nível é enfeite.
--
--   O que a mesma sonda mostrou de bom, e que continua valendo: o isolamento
--   ENTRE empresas estava intacto (0 linhas contra a outra empresa), e o gatilho
--   da F17.2 limitava o estrago (tirar o único status de fechamento era
--   recusado). O buraco era dentro da própria empresa.
--
-- POR QUE AGORA, E NÃO DEPOIS
--   Exposição hoje é ZERO: `status_sets` e `statuses` têm 0 linhas. Quem enche
--   as duas é a importação da F17.11. Consertar antes de existir dado custa uma
--   migration; consertar depois custaria uma migration MAIS a conferência de
--   quem mexeu no quê enquanto o buraco esteve aberto.
--
-- ONDE A REGRA MORA — UMA VEZ, E NÃO DUAS
--   A regra é uma frase: dono = espaço → administrador; dono = pasta ou lista →
--   quem alcança o espaço. Ela nasce aqui como `can_write_owner`, e as DUAS
--   políticas passam a chamá-la.
--
--   Copiar a expressão para dentro da segunda política seria a dívida 8.1 do
--   legado outra vez — regra de acesso duplicada, que fica para trás na primeira
--   mudança. É a mesma razão pela qual a F17.1 fez `can_see_space` e a F17.2 fez
--   `can_see_status_set`.
--
-- POR QUE SÃO DUAS FUNÇÕES, E NÃO UMA
--   `can_write_owner` recebe as COLUNAS de posse; `can_write_status_set` recebe
--   o ID do conjunto e delega para ela. Parece redundante, e não é.
--
--   `status_sets_write` NÃO PODE chamar a versão por id. No `insert`, o
--   `with check` é julgado sobre a linha nova, e uma subconsulta em
--   `status_sets` enxerga a fotografia do comando — que ainda NÃO contém a linha
--   sendo inserida. `can_write_status_set(new.id)` devolveria nulo, nulo nega, e
--   ninguém conseguiria mais criar esteira nenhuma. A versão por colunas lê a
--   própria linha e não tem esse problema.
--
--   `statuses_write`, do lado oposto, não tem coluna de posse nenhuma — só o
--   `status_set_id`. Para ela a versão por id é a única forma.
--
--   Duas portas, uma regra atrás das duas. A regra continua morando num lugar só.
--
-- CONJUNTO INEXISTENTE NEGA, E A MENSAGEM É A DA POLÍTICA
--   Sem linha em `status_sets`, `can_write_status_set` não devolve linha
--   nenhuma: o resultado é nulo, e nulo nega em política.
--
--   Num `insert` de status com `status_set_id` que não existe, a recusa de
--   política (42501) chega ANTES da chave estrangeira — que é gatilho `after` e
--   só roda depois. A mensagem, então, é "new row violates row-level security
--   policy for table statuses", e não a da chave.
--
--   Menos específica, e ainda assim a certa: devolver `true` para conjunto
--   desconhecido, só para melhorar o texto do erro, abriria um buraco em troca
--   de uma frase. Regra 3 do roteiro — o desconhecido recusa, não passa calado.
--
-- LER NÃO MUDA
--   `statuses_select` continua sendo alcance puro, e de propósito. Quem enxerga
--   o espaço enxerga a esteira dele inteira — inclusive a que ele não pode
--   editar, porque é justamente ela que a lista dele HERDA e é ela que o quadro
--   desenha. Esconder seria quebrar a tela para proteger o que a escrita já
--   protege.
--
-- A OPERAÇÃO DIÁRIA NÃO TRAVA
--   Pasta e lista continuam sendo do funcionário, dos dois lados — criar,
--   renomear, acrescentar, apagar e recolorir. Só o nível ESPAÇO passou a exigir
--   administrador, e ele é hoje UMA esteira em cada agência: o `to do` ·
--   `in progress` · `complete` do ALMA 9.
-- =============================================================================

-- --- a regra, num lugar só ----------------------------------------------------
-- `security definer` pelo mesmo motivo de `owner_space` e `can_see_space`: a
-- resposta tem que ser um fato, e o `search_path` fixo a torna imune a quem
-- chama de onde.
create or replace function ideworks.can_write_owner(
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select case
           when p_space_id is not null then ideworks.acting_is_superadmin()
           else ideworks.can_see_space(
                  ideworks.owner_space(p_space_id, p_folder_id, p_list_id))
         end
$fn$;

comment on function ideworks.can_write_owner(uuid, uuid, uuid) is
  'Quem escreve numa coisa de tres niveis: espaco e so administrador; pasta e '
  'lista sao de quem alcanca o espaco. Par de `owner_space` — a F17.5 (campos) '
  'e a F17.8 (visualizacoes) tem a MESMA forma de posse e chamam esta funcao, '
  'em vez de copiar a regra.';

-- A mesma regra, alcançada pelo id do conjunto. `security definer` para a busca
-- ser FACTUAL: sob a política de quem escreve, um conjunto fora do alcance
-- sumiria da consulta e a resposta viraria "não existe" em vez de "não pode".
create or replace function ideworks.can_write_status_set(target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.can_write_owner(ss.space_id, ss.folder_id, ss.list_id)
    from ideworks.status_sets ss
   where ss.id = target
$fn$;

comment on function ideworks.can_write_status_set(uuid) is
  'A regra de `can_write_owner` alcancada pelo id do conjunto — que e o que a '
  'tabela `statuses` tem em maos. Conjunto inexistente devolve nulo, e nulo '
  'nega.';

-- --- as duas políticas apontam para a mesma regra ------------------------------
-- `status_sets_write` NÃO muda de comportamento: a expressão que estava escrita
-- dentro dela é, linha por linha, o corpo de `can_write_owner`. Muda só o lugar
-- onde a regra mora — que é o ponto desta etapa.
drop policy if exists status_sets_write on ideworks.status_sets;
create policy status_sets_write on ideworks.status_sets for all
  using      (ideworks.can_write_owner(space_id, folder_id, list_id))
  with check (ideworks.can_write_owner(space_id, folder_id, list_id));

-- `statuses_write` MUDA: era `can_see_status_set` (alcance puro) e passa a ser a
-- regra do dono. É o conserto.
--
-- Num `update` que troca o `status_set_id`, `using` julga o conjunto ANTIGO e
-- `with check` o NOVO — então tirar um status da esteira do espaço e enfiar um
-- status nela exigem administrador, os dois, sem caso especial.
drop policy if exists statuses_write on ideworks.statuses;
create policy statuses_write on ideworks.statuses for all
  using      (ideworks.can_write_status_set(status_set_id))
  with check (ideworks.can_write_status_set(status_set_id));

-- --- permissões ---------------------------------------------------------------
-- Expressão de política roda com os poderes de quem consulta: sem `execute`, o
-- papel do app bateria em "permission denied for function" em vez de bater na
-- regra.
grant execute on function ideworks.can_write_owner(uuid, uuid, uuid) to ideworks_app;
grant execute on function ideworks.can_write_status_set(uuid)        to ideworks_app;
