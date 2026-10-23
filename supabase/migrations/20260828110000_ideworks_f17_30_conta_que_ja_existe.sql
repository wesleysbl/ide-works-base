-- =============================================================================
-- IDE WORKS — F17.30  Quem ja tem conta e vinculado, nao recriado
-- =============================================================================
-- O DEFEITO, MEDIDO
--   Tirada a trava de conta de teste (F17.28), a primeira pessoa convidada de
--   verdade digitou o codigo e recebeu na tela, em ingles cru:
--
--       User already registered
--
--   `gestao@exemplo.com.br` foi criada em 2025-09-23 e entrou pela ultima
--   vez em 2026-07-22. `atendimento@exemplo.com.br` existe desde 2025-10-27.
--   Nenhuma das duas tem perfil no IDE Works. Sao contas REAIS, da agencia, em
--   uso — a autenticacao e a mesma do Sistema IDE (decisao D8), com as 21
--   contas da agencia dentro.
--
--   O convite foi desenhado para CRIAR conta, e ninguem pensou no caso de a
--   pessoa ja ter uma — que hoje e o caso da maioria.
--
-- O QUE ESTA FUNCAO RESOLVE, E POR QUE ELA PRECISA EXISTIR
--   A ativacao precisa do id da conta para aplicar o convite nela. O papel da
--   aplicacao NAO alcanca o cadastro de login: medido nesta etapa,
--   `has_schema_privilege('ideworks_app', 'auth', 'usage')` devolve `false`, e
--   um `select ... from auth.users` responde `permission denied for schema
--   auth`. Sem esta funcao nao ha id, e sem id nao ha como vincular.
--
--   Entao ela e `security definer` — roda com os poderes do dono, que alcanca
--   o cadastro — e devolve UMA COISA SO: o identificador. Nunca e-mail, nunca
--   data, e em hipotese nenhuma qualquer coisa derivada de senha.
--
-- ⚠️ O QUE ELA NAO FAZ, E ESSA E A INVARIANTE DA ETAPA
--   Ela LE. Nao escreve, nao redefine senha, nao confere senha, nao cria e nao
--   apaga conta. E por isso e `stable`, e nao `volatile`: o proprio Postgres
--   recusaria uma escrita aqui dentro. Errar isso tiraria o acesso de uma
--   pessoa real ao Sistema IDE em producao.
--
-- ⚠️ POR QUE ELA NAO E UM ORACULO DE E-MAILS
--   Uma funcao que responde "este endereco tem conta?" para qualquer entrada e
--   exatamente a enumeracao de usuarios que `src/auth/activation.ts` gasta uma
--   secao inteira para impedir. Por isso ha DUAS guardas, e a resposta e a
--   mesma — nulo — quando qualquer uma delas reprova:
--
--     1. so responde dentro da janela de pre-autenticacao, ou a quem
--        administra. Funcionario logado nao alcanca esta funcao;
--
--     2. so responde quando existe convite PENDENTE E NAO EXPIRADO para
--        aquele endereco. Convite so nasce por decisao de quem administra, e
--        morre em 72 horas — entao a pergunta so pode ser feita sobre alguem a
--        quem ja se decidiu dar acesso.
--
--   Nulo cobre os dois casos indistinguiveis de proposito: "nao ha conta" e
--   "nao ha convite". Quem chama nao consegue separar um do outro.
--
--   E a ORDEM de cima tambem e guarda: a rota so chega aqui DEPOIS de conferir
--   o codigo. Perguntar antes da prova responderia a pergunta a quem nao tinha
--   direito a ela.
--
-- SEGURANCA POR LINHA
--   Esta migration nao cria tabela, entao nao ha politica nova. `invitations`
--   ja tem RLS ligada com `_select`, `_insert` e `_update`, todas decidindo
--   pela linha inteira — e a leitura daqui de dentro passa por cima delas por
--   ser `security definer`, que e o motivo de as duas guardas acima estarem
--   escritas no corpo, e nao presumidas de quem chama.
-- =============================================================================

create or replace function ideworks.find_existing_account(p_email text)
  returns uuid
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select u.id
    from auth.users u
   where lower(u.email) = lower(btrim(coalesce(p_email, '')))
     and lower(btrim(coalesce(p_email, ''))) <> ''
     -- guarda 1: a janela de pre-autenticacao, ou quem administra
     and (ideworks.is_preauth() or ideworks.acting_is_superadmin())
     -- guarda 2: ha convite pendente e no prazo para este endereco
     and exists (
       select 1
         from ideworks.invitations i
        where lower(i.email) = lower(btrim(coalesce(p_email, '')))
          and i.status = 'pending'
          and i.expires_at > now())
   limit 1;
$fn$;

revoke all on function ideworks.find_existing_account(text) from public;
grant execute on function ideworks.find_existing_account(text) to ideworks_app;

comment on function ideworks.find_existing_account(text) is
  'Devolve o identificador da conta de login deste endereco, e SO isso. '
  'Responde apenas na janela de pre-autenticacao ou a quem administra, e '
  'apenas quando ha convite pendente e no prazo para o mesmo endereco — sem '
  'as duas guardas ela seria um oraculo de quais e-mails tem conta. Nulo '
  'quando nao ha conta e tambem quando nao ha convite: os dois casos sao '
  'indistinguiveis de proposito. Ela LE o cadastro e nada mais: nao cria, nao '
  'apaga e nunca toca em senha.';
