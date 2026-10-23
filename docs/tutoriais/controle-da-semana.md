# Controle da semana: criar a demanda e liberar com um OK

Este tutorial tem duas partes.

- **Parte 1, para o captador:** como criar a demanda do cliente.
- **Parte 2, para os admins:** como ver a semana, escolher pessoa e prazo, dar o OK e acompanhar o que falta.

Em resumo: o captador cria o card na etapa **atribuir demanda** e escolhe o **tipo** (Vídeo, Arte, Foto ou Outros). O admin escolhe quem faz e o prazo, e dá **OK**. O card vai sozinho para a fila certa.

---

## Parte 1. Para o captador

### 1. Abrir a lista do cliente

1. Na barra lateral, abra o espaço, a pasta e a **lista do cliente**.
2. Você vê o quadro com as etapas em colunas.
3. Procure a coluna **atribuir demanda**. É nela que o card nasce.

### 2. Criar o card

1. Na coluna **atribuir demanda**, clique em **+ Adicionar tarefa**.
2. Escreva o título. Diga o que o cliente pediu.
3. Você vê quatro botões: **Vídeo**, **Arte**, **Foto** e **Outros**.

### 3. Escolher o tipo (obrigatório)

1. Clique no botão do tipo da demanda.
2. O botão escolhido fica marcado.
3. Enquanto você não escolher, o botão de criar fica apagado. Embaixo dele aparece a frase **"Escolha o tipo: Vídeo, Arte, Foto ou Outros"**.
4. Se tiver dúvida, escolha **Outros**.

### 4. Sugerir o prazo (opcional)

1. Clique no campo de prazo e escolha a data em que a entrega deve sair.
2. É só uma sugestão. O admin confirma ou troca na hora de liberar.
3. Se você não puser prazo, o card aparece para o admin em **Sem data**. Ele ainda pode liberar.

### 5. Criar e conferir

1. Clique em criar.
2. O card aparece na coluna **atribuir demanda**.
3. Olhe o card. Ele mostra um **selo pequeno com o tipo** (por exemplo, "Vídeo").
4. Pronto. Agora é com os admins. Você não precisa mexer mais.

Para trocar o tipo depois, abra o card e clique em outro botão na propriedade **Tipo**. Em lista de produção não dá para apagar o tipo, só trocar.

---

## Parte 2. Para os admins

Só quem é admin vê a aba **Controle da semana**.

### 1. Abrir a aba

1. Na barra lateral, procure a seção **Entrega**.
2. Clique em **Controle da semana**.
3. Se o item não aparecer, você não é admin.

### 2. Ler o topo

1. No alto você vê a semana, por exemplo **"06 – 12/out"**. A semana vai de segunda a domingo.
2. Clique em **‹** para ir à semana anterior e em **›** para ir à seguinte.
3. Clique em **Esta semana** para voltar à semana de hoje.

### 3. Bloco "Para atribuir"

Aqui ficam os cards que estão em **atribuir demanda** e esperam um dono. Eles vêm agrupados por cliente e por tipo.

1. Ache o card. Cada linha mostra o selo do tipo, o título e o prazo sugerido pelo captador.
2. Em **Pessoa**, escolha quem vai fazer.
3. Confira o **prazo**. Troque se precisar. Se o card veio sem prazo, ele aparece em **Sem data** (só na semana atual) e você precisa pôr um.
4. Clique em **OK**.
5. A linha some deste bloco. O card foi para a fila do tipo e passa a contar no Andamento.

Se o card aparecer como **Sem tipo** (é um card antigo), escolha o tipo na própria linha antes. Sem tipo o OK não funciona.

Se aparecer **"Já liberado por Fulano às HH:MM"**, outro admin já deu o OK neste card. Não precisa fazer nada. A tela mostra o estado novo ao recarregar.

### 4. Para onde o card vai

O tipo decide a etapa. Você não escolhe isso.

| Tipo | Vai para a etapa |
|---|---|
| Vídeo | a fazer video |
| Arte | a fazer arte |
| Foto | a fazer |
| Outros | a fazer |

O card continua na mesma lista do cliente. Só muda de coluna. O histórico do card guarda o movimento com o seu nome.

### 5. Bloco "Andamento"

É uma tabela com uma linha por cliente e tipo. Cada coluna conta cards:

- **Aguardando:** ainda em atribuir demanda, sem dono.
- **Por fazer:** já liberados, esperando começar.
- **Em andamento:** alguém está trabalhando.
- **Feito:** concluídos.

Para ver os cards, clique no nome do cliente. A lista dele abre no quadro.

### 6. Bloco "Faltando"

Mostra o que a cota do cliente previa para a semana e ainda não tem card.

1. Leia assim: **"Cliente X, Vídeo: 0 de 2"** quer dizer que a semana pedia 2 vídeos e há 0 cards de vídeo com prazo nesta semana. Faltam 2.
2. A conta usa o prazo do card. Card em qualquer etapa conta, até em atribuir demanda.
3. Só aparecem as metas em falta. Se o cliente está em dia, ele não aparece.
4. Mais abaixo, a lista **Atrasados** mostra os cards com prazo vencido que ainda não terminaram, com o nome do responsável.
5. Para resolver uma falta, peça ao captador para criar o card, ou crie você.

### 7. O aviso no sino

1. Olhe o sino. Para os admins ele traz um aviso-resumo, por exemplo: **"26 clientes com falta nesta semana · 3 com cards atrasados"**.
2. Clique no aviso. Você cai no Controle da semana, na semana certa.
3. O aviso é recalculado a cada 5 minutos. Um OK que você deu pode levar até 5 minutos para sumir do número.
4. Se você marcar como lido e os números mudarem depois, ele volta como não lido.
5. Quando não falta nada, o aviso some.

### 8. Usar a IA

Se a sua IA está conectada ao IDE Works (veja `docs/como-conectar-a-sua-ia.md`), você pode pedir:

- "O que falta nesta semana?" Ela lê os três blocos.
- "Libera o card X para a Fulana com prazo dia 16." Ela dá o OK pelo mesmo caminho da tela.

Para isso a conexão precisa ter as permissões de ler quadros e tarefas, e de definir responsáveis, editar e mover tarefas. A IA só libera se você for admin. Se ela errar, o desfazer em lote devolve o card para atribuir demanda, sem responsável.

---

## Se algo der errado

| O que aparece | O que fazer |
|---|---|
| **"Escolha o tipo: Vídeo, Arte, Foto ou Outros"** e o botão de criar apagado | Clique em um dos quatro botões de tipo. |
| **"A lista X não tem a etapa a fazer arte"** (ou "a fazer video") | A esteira dessa lista não tem a etapa de destino. Peça a um admin para criar a etapa na esteira da lista. Depois dê o OK de novo. |
| **"Já liberado por Fulano às HH:MM"** | Outro admin já liberou. Nada a fazer. |
| Botão **OK** não funciona | Confira se escolheu a **pessoa** e o **prazo**. Se o card está como **Sem tipo**, escolha o tipo primeiro. |
| Não vejo o item **Controle da semana** | Só admin vê. Fale com um admin. |
| Abri o endereço direto e aparece **"sem acesso"** | Mesmo motivo: a aba é só para admin. |
| O número do sino não mudou depois do OK | Espere até 5 minutos. O aviso é recalculado nesse intervalo. A aba mostra o número ao vivo. |
| Criei o card e não acho na aba | Veja a semana do **prazo**. Card sem prazo só aparece em **Sem data** na semana atual. Confira também se o card está mesmo em **atribuir demanda**. |
