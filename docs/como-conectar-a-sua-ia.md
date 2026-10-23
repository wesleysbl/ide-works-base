# Como conectar a sua IA ao IDE Works

A sua IA (Claude, ChatGPT ou outra) pode ler o IDE Works e, se você deixar, cadastrar tarefas,
distribuir trabalho e registrar coisas no mural e no histórico dos clientes. Ela faz isso em seu
nome: enxerga só o que você enxerga, e tudo o que ela escreve aparece como **"Seu nome, via
Claude"** (ou "via ChatGPT") para toda a equipe.

## 1. Conectar (ou reconectar)

1. Entre no IDE Works e abra **Conexões**, no menu.
2. Escolha a ferramenta que você usa (Claude no site ou no app, ChatGPT, Claude Code, Codex) e siga
   o passo a passo que aparece ali.
3. Quando a IA abrir a tela do IDE Works pedindo autorização, **marque só o que você quer que ela
   faça** (veja a tabela abaixo) e confirme.
4. Na conversa com a IA, peça algo simples para testar, como "quais tarefas estão comigo
   atrasadas?".

**Já tinha conectado antes de 23/09/2026?** Reconecte uma vez, porque as permissões novas só
aparecem numa autorização nova. A autorização nova substitui a antiga.

## 2. O que cada permissão libera

| Permissão | O que a IA pode fazer |
|---|---|
| Ver quadros, tarefas, clientes, pessoas, comentários, relatórios | Só ler. Sem essas leituras ela não enxerga nada. |
| Comentar nas tarefas | Escrever comentário em tarefa |
| Mover tarefas entre listas | Trocar a etapa de uma tarefa |
| **Criar e editar tarefas** | Criar tarefa; mudar título, descrição, prazo, início, prioridade, etiquetas |
| **Definir os responsáveis das tarefas** | Escolher quem faz. Mexe na fila de outra pessoa, então use com cuidado |
| **Concluir e reabrir tarefas** | Marcar como concluída ou reabrir |
| **Escrever notas no mural do cliente** | Criar nota no mural e editar as notas que ela mesma criou |
| **Registrar fatos no histórico do cliente** | Criar registro no histórico (por exemplo, o resumo de uma reunião) e editar os que ela mesma criou |

**A IA nunca edita o que uma pessoa escreveu** no mural ou no histórico. Se você pedir, ela vai
responder que não pode.

## 3. Os freios

- **Ensaio antes:** peça "mostra antes o que você vai fazer". A IA confere tudo e responde o que
  faria, sem gravar nada.
- **Teto do dia:** cada conexão faz no máximo 50 escritas por dia. Dá para mudar em **Conexões**.
- **A IA pode pedir a sua confirmação antes de mudar algo que já existe:** editar tarefa, trocar
  responsáveis, mover, concluir, reabrir, liberar demanda e editar nota ou registro estão marcados
  como "altera um dado existente", e alguns aplicativos de IA perguntam antes de rodar. Comentar,
  criar tarefa, escrever nota e registrar fato só acrescentam, e não são marcados assim.
- **Repetir não duplica:** se a IA repetir o mesmo pedido (a mesma chave), o IDE Works devolve o que
  já fez e não grava de novo.
- **Desfazer:** em **Conexões**, "Desfazer escritas" volta o que a IA fez:
  - a tarefa criada é **arquivada**;
  - a nota e o registro criados são **apagados**;
  - prazo, responsáveis, prioridade, etiquetas e conclusão **voltam ao que eram**.
- **O que não se desfaz:** texto editado (título, descrição, nota, histórico) e mudança de etapa.
- **O que uma pessoa mexeu depois fica como ela deixou.** A tela mostra o motivo.

## 4. Pedidos que funcionam bem

- "Cria as 8 pautas de outubro do cliente X na lista Y, com prazo toda sexta, para a Carla."
- "Registra no histórico do Clinimax o resumo desta reunião: …"
- "Deixa uma nota amarela no mural da Sabor Doce: aprovações só com a Fulana."
- "Como evoluiu a entrega do Clinimax nos últimos 6 meses?"
- "Quem caiu mais de 20 pontos de agosto para setembro?"

## 5. O que a IA lê (e o que ela não vê)

Além de tarefas, clientes e relatórios, a IA lê o que o site mostra de mais novo. Você não precisa
decorar os nomes das ferramentas: peça em português e ela escolhe. Os nomes ficam aqui para quem
quiser conferir.

| Você pergunta | Ferramenta que ela usa |
|---|---|
| "Quais as etapas da lista Redes Sociais do Clinimax?" | `get_workflow` — mostra as etapas na ordem, de que tipo são e de onde vêm (da lista, da pasta ou do espaço) |
| "Como está a semana do cliente Sabor Doce?" | `get_planning_weeks` — o mês por semana: cota, meta, o que já foi entregue e o que falta, por responsável |
| "Quais clientes estão ficando para trás neste mês?" | `get_month_attention` — a lista 'Precisa de atenção' da visão Contrato do Planejamento: por cliente, em que ponto está o mês (aberto, planejado, aprovado), o contrato por tipo (entregue, marcado, atrasado, sem dia, ainda não criado) e o motivo em uma frase. Peça 'só os que precisam de atenção' para a lista curta |
| "Qual peça falta do cliente Sabor Doce este mês? O que já foi entregue?" | `get_client_month` — o mês do cliente com cada peça pelo nome (tipo, dia, se tem ✓, se é extra), o contrato e o medidor |
| "O que está marcado esta semana? Que gravações temos em outubro?" | `get_calendar` — as peças com dia e os compromissos (reunião, gravação, viagem) de um período de até 62 dias, de todos os clientes ou de um |
| "Quais são os clientes? Quem está em Atenção ou Crítico? Quem renova em novembro?" | `list_clients` — a carteira ativa com plano, urgência, financeiro, renovação e etiquetas (sem telefone, e-mail nem CNPJ). `get_client` traz também a cota que o cliente contrata hoje |
| "Qual a última entrega de cada cliente? Quem tem peça vencida?" | `get_delivery_status` — o mesmo número do cartão do Painel, pela Semanal: última entrega, peças vencidas (com o dia), as que vencem hoje e a próxima marcada. Só clientes ativos |
| "Que listas existem? Qual a lista do cliente Sabor Doce?" | `list_boards` — as listas com espaço, pasta, cliente, se a lista exige cliente e se é de produção |
| "O que está atrasado na pasta TIME HELENA? O que a Carla criou? Quais vídeos em aberto do cliente X?" | `list_tasks` — as tarefas com filtro (lista, pasta, espaço, responsável, quem criou, etapa, tipo, prazo, atrasadas, cliente) |
| "O que é urgente na fila da Carla?" | `get_person_work` — cada item vem com a etapa e a prioridade (urgente, alta, normal ou baixa). Tarefa de cliente cancelado não entra na fila nem nas contagens |
| "Quem mexeu nesta tarefa? Quais links do Dropbox ela tem? O checklist está completo?" | `get_task` — agora traz etiquetas, seguidores, a tarefa-mãe, os checklists (com o que já foi resolvido), os links, o histórico de movimentação (quando, quem e o quê), quem criou e a pasta e o espaço |
| "Quais etiquetas existem na lista Redes Sociais? Marque esta tarefa como Reels." | `list_tags` — as etiquetas do espaço, com os códigos que a IA usa ao criar ou editar a tarefa |
| "Esta tarefa é urgente? Quando ela começa?" | `get_task` e `get_board` — trazem prioridade, data de início, data de conclusão e o tipo da etapa |
| "Procure 'desconto' no histórico do cliente Clinimax." | `get_client_history` com busca por palavra |
| "O Zeca ainda é cliente?" | `search` — cliente cancelado só aparece quando você pergunta pelo nome dele, e a resposta é só "cancelado em dd/mm/aaaa" |
| "Qual foi a média de entrega de agosto?" | `get_delivery_report` e `get_delivery_trend` — cliente cancelado conta até o mês do cancelamento, inclusive. Nos meses seguintes ele não entra na média e aparece como "cancelado", nunca como 0% |
| "Crie uma tarefa na ATENDIMENTO para a Fonseca Moura." | `create_task` com o cliente — veja abaixo |
| "Crie o card já em Produção na lista da Fonseca." | `get_workflow` para achar a etapa e `create_task` com ela (`statusId`). Sem etapa, o card nasce na primeira |
| "Quebre esse card em subtarefas: roteiro, gravação e edição." | `create_task` com a tarefa-mãe (`parentId`), uma vez por subtarefa; `get_task` da mãe mostra as subtarefas |

**Receita: última entrega por cliente** (uma chamada, sem montar consulta):

1. Chame `get_delivery_status` sem filtro. Ele devolve uma linha por cliente **ativo**, com `lastDeliveryOn`
   (a última entrega), `daysSinceLastDelivery`, `overdueDays` (peças vencidas sem ✓, com o dia de cada
   uma), `dueToday` e `nextScheduledOn`. Se vier `hasMore`, repita com `cursor`.
2. A fonte é a **Semanal** (as peças do mês com dia marcado e ✓), **não** as tarefas concluídas do
   quadro. Não calcule a entrega contando tarefas.
3. Cliente cancelado não aparece, e isso é o certo: ele está fora da carteira. Se perguntarem por
   um deles pelo nome, use `search`: a resposta é só "cancelado em dd/mm/aaaa".
4. O número é o do cartão do Painel. Se o relatório não bater com o Painel, o erro está no relatório.
5. Para "quanto da cota foi entregue no mês", o caminho é outro: `get_delivery_report`.

Coisas para saber:

- **Busca no histórico:** com várias palavras, só aparece o registro que tem todas. Não importa
  acento nem maiúscula. Os sinais `%`, `_` e `\` são procurados como texto comum. O nome de quem
  conduziu a reunião só entra na busca se você deu a permissão de ver pessoas. Se a lista vier
  em várias páginas, a IA precisa continuar com a mesma palavra.
- **Etapas mudam de número:** se alguém alterou a esteira da pasta, as etapas ganham números
  novos. Por isso, antes de mover uma tarefa, a IA relê as etapas.
- **Tarefas arquivadas não aparecem:** a IA já não enxerga o que está arquivado, então o campo de
  arquivamento sempre vem vazio.
- **Planejamento semanal:** precisa da permissão de ver relatórios de entrega. Cliente sem cota e
  sem peça no mês fica de fora da conta, e a IA avisa quantos ficaram de fora.
- **Toda tarefa nasce com cliente:** na lista de um cliente, a tarefa fica com o cliente da lista.
  Nas listas compartilhadas (ATENDIMENTO, ESTÚDIO, Estúdio Ide e Jobs Antonelli), a IA precisa dizer
  de qual cliente é a tarefa; se não disser, o IDE Works recusa e ela pergunta a você. Cliente
  cancelado é recusado, com a data do cancelamento.
- **O card já nasce na etapa certa:** a IA pode criar a tarefa em "Em produção", "Aprovação" ou
  outra etapa da lista (ela lê as etapas com `get_workflow`). Sem etapa, nasce na primeira, como
  sempre. Etapa de outra lista é recusada e a IA recebe as etapas da lista para escolher; nada é
  criado. Etapa do tipo concluída faz o card nascer concluído. O ensaio mostra a etapa antes, e o
  desfazer em lote desfaz a criação inteira.
- **Subtarefa nasce com o cliente da mãe:** a IA cria subtarefa dentro de um card, e ela fica na
  mesma lista e com o mesmo cliente do card. Se a IA tentar outra lista ou outro cliente, o IDE
  Works recusa. Card arquivado, de cliente cancelado ou fora do que você liberou também é
  recusado. O desfazer em lote arquiva a subtarefa criada pela IA, e o card-mãe fica.

**Quando a IA erra ou não pode, ela é avisada do que fazer.** Entrada errada (um valor que não existe, um
campo que falta) volta com o nome do campo e o que vale. Se faltar uma permissão, a recusa diz qual
e que é preciso **reconectar a IA** marcando-a (em **Conexões**). Se o código não existe ou está fora
das empresas e clientes que você liberou, a IA é mandada conferir com a busca. Se as escritas
estiverem desligadas no servidor, ou o teto do dia acabar, ela avisa você em vez de insistir.
No começo de uma conversa, a IA pode chamar `get_context`: ele diz em texto quais ferramentas as suas
permissões liberam e quais pedem uma permissão que falta.

**Empresas omitidas ficam de fora.** O que o site omite (as unidades de negócio listadas em
`IDEWORKS_EMPRESAS_OMITIDAS`) a IA também não vê: clientes, listas, tarefas e planejamento dessas empresas somem para ela, como se
não existissem. Nada foi apagado, só escondido.

**O que a IA ainda não faz**, de propósito: criar entrega no Planejamento, reordenar listas,
mudar a esteira de uma pasta, excluir lista ou cliente, editar o cadastro de uma pessoa, e ler o
chat, as notificações e as menções (são privados). Veja o mapa completo em
[`docs/mapa-site-para-agentes.md`](mapa-site-para-agentes.md).

**Reconecte para ver as leituras novas.** Se você conectou a sua IA antes de elas entrarem no ar,
abra uma conversa nova depois de reconectar: as ferramentas só carregam no começo da conversa.
