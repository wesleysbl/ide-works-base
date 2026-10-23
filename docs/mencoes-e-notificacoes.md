# Menções e notificações

Digite `@` e parte do nome, escolha a pessoa por clique/toque ou pelas setas e Enter/Tab. Escape fecha a lista. O nome escolhido aparece destacado, sem link, nos títulos das tarefas e subtarefas, na descrição, nos comentários/respostas e nos nomes de checklists e itens.

A lista mostra somente pessoas ativas que podem acessar aquela tarefa ou a lista de destino. A API recebe o contexto, identifica o autor pela sessão e consulta a função `mentionable_people`. O banco valida novamente cada destinatário novo na gravação; uma mudança de permissão entre abrir a lista e salvar pode recusar a menção.

Ao salvar, o destinatário recebe uma entrada em **Meu trabalho → Notificações**, com o nome de quem mencionou, o card, a lista e atalhos. Menções em comentários levam ao comentário destacado. O sino mostra o total não visto e atualiza a cada 30 segundos enquanto a aba está visível e ao voltar ao aplicativo. É possível marcar como visto e trazer de volta.

Cada origem mantém um aviso por destinatário. Alterar o texto ao redor não repete o aviso. Remover a menção remove o aviso; inserir novamente cria outro. Mencionar a si mesmo não gera notificação. Há um limite de 20 destinatários diferentes por origem (título e descrição da mesma tarefa contam juntos). Não há avisos retroativos para textos antigos com `@nome` sem seleção.

Os textos persistem a referência `@[Nome](mention:UUID)`. A apresentação usa elementos de texto seguros, sem HTML recebido do usuário. O nome exibido no texto é o selecionado naquele momento; o nome do autor na notificação é resolvido na leitura. A tabela `task_mentions` aceita escrita somente por gatilhos, com RLS que permite ao destinatário ler avisos de tarefas ainda ao seu alcance. Perder acesso oculta o aviso.

Validação: suíte Vitest, TypeScript, ESLint, Chrome com API simulada (`scripts/e2e/mencoes.py` e regressão `imagens-no-texto.py`) e migração/rollback em PostgreSQL local via PGlite (`scripts/testar-mencoes-banco.mjs`). Este último cobre privilégios padrão, candidatos, destinatários inválidos, duplicação, exclusão, checklists, limite e perda de acesso.

Migração: `20260911180517_ideworks_f17_82_mencoes_e_notificacoes.sql`. Para reverter, publique a versão anterior do Worker antes do SQL correspondente em `supabase/rollback`; o rollback remove os avisos, mas preserva os textos.

## Responsáveis adicionados manualmente

Adicionar pessoas pelo avatar do cartão ou pelo campo de responsáveis gera o aviso **“Você foi adicionado como responsável por este post.”** no grupo **Adicionaram você como responsável**. O título abre a tarefa. A notificação participa do contador e pode ser marcada como vista ou trazida de volta, individualmente para cada destinatário.

A consulta usa `task_events.added_user_ids`, que registra somente as pessoas acrescentadas ao conjunto de responsáveis. Manter alguém selecionado não repete o aviso; remover e adicionar novamente gera outro evento. Autoatribuições e remoções não geram aviso. Atribuições por automação mantêm seus avisos atuais. A consulta respeita as políticas de acesso da tarefa e oculta tarefas arquivadas.

Não há migração: eventos manuais já registrados também passam a aparecer. Os avisos são históricos; remover a responsabilidade não apaga um aviso anterior enquanto a pessoa ainda puder acessar a tarefa. A atualização segue os mesmos 30 segundos e o retorno à aba usados pelas demais notificações.

Validação desta conexão: testes de consulta e contadores em `src/server/board-avisos.test.ts`, renderização do aviso em `src/board/tela-dos-avisos.test.ts`, suíte de frases/agrupamento, TypeScript e ESLint. Os testes de consulta usam um dublê do banco; não representam uma entrega real entre contas em produção.
