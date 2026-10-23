# Conectar o Ide Works ao Dropbox (só leitura)

Este tutorial é para quem administra o sistema, e se faz uma vez só. Leva uns 15 minutos.

Em resumo: você cria um app no Dropbox que **só lê**, autoriza esse app na conta do Dropbox **da agência**, e grava três chaves em dois lugares (no seu Mac e no Worker publicado). Depois disso o Ide Works consegue conferir se um link do Dropbox está aberto, quais arquivos ele tem e qual a versão de cada um.

O app **nunca escreve, move ou apaga** nada no Dropbox. Ele não tem permissão para isso.

Você vai precisar de:

- O login da conta do Dropbox **da agência** (a que guarda o material dos clientes).
- O Terminal aberto na pasta do Ide Work (`a pasta do projeto`).
- Um link de **arquivo** do Dropbox aberto para qualquer pessoa (um vídeo, de preferência) e um link **fechado** (só para a equipe ou com senha), para a prova do passo 6.

---

## 1. Criar o app

1. No navegador, entre no Dropbox com a conta **da agência**.
2. Abra **https://www.dropbox.com/developers/apps**.
3. Clique no botão azul **Create app**.
4. Em **1. Choose an API**, marque **Scoped access**.
5. Em **2. Choose the type of access you need**, marque **Full Dropbox**.
   - Por quê: o material dos clientes está espalhado pelo Dropbox, fora de qualquer pasta de app. "Full" aqui é só o alcance; o que o app **pode fazer** é decidido no passo 2, e lá só marcamos leitura.
6. Em **3. Name your app**, escreva **Ide Works Aprovacao**.
   - Se aparecer que o nome já existe, acrescente o ano: **Ide Works Aprovacao 2026**.
   - O nome não pode conter a palavra "Dropbox".
7. Marque a caixa de concordância, se aparecer, e clique em **Create app**.
8. Você cai na página do app, na aba **Settings**. No alto aparece o nome que você escolheu.

## 2. Dar as permissões (só leitura)

**Faça este passo antes do passo 4.** A autorização congela as permissões do momento; se você marcar depois, precisa autorizar de novo.

1. Na página do app, clique na aba **Permissions**.
2. Você vê uma lista de permissões com caixas de marcar, agrupadas em **Account Info**, **Files and folders**, **Collaboration** etc.
3. Marque **somente** estas duas:
   - Em **Files and folders**: **files.metadata.read** (ler a lista de arquivos de uma pasta e a versão de cada um).
   - Em **Collaboration**: **sharing.read** (ler os dados de um link compartilhado e repassar o arquivo para o cliente ver).
4. **account_info.read** já vem marcada e cinza. Deixe como está; o Dropbox exige.
5. **Não marque** nada que termine em `.write`, nem `files.content.read`. Não precisamos.
6. Role até o fim da página e clique em **Submit**.
7. Aparece uma faixa verde no alto: **"Permission change successfully updated"**. Se não aparecer, clique em **Submit** de novo.

## 3. Copiar a chave e o segredo do app

1. Volte para a aba **Settings**.
2. Procure **App key**. Ao lado tem um código de letras e números. Copie.
3. Logo abaixo, em **App secret**, clique em **Show**. Aparece outro código. Copie também.
4. Abra o arquivo **`.dev.vars`** da pasta do Ide Work (no Terminal: `open -e .dev.vars`).
5. No fim do arquivo, acrescente duas linhas, colando os códigos depois do `=` (sem espaço e sem aspas):

   ```
   IDEWORKS_DROPBOX_APP_KEY=cole-aqui-o-app-key
   IDEWORKS_DROPBOX_APP_SECRET=cole-aqui-o-app-secret
   ```

6. Salve o arquivo (**⌘S**) e feche.

## 4. Autorizar a conta da agência

1. No Terminal, na pasta do Ide Work, rode:

   ```
   node scripts/dropbox-autorizar.mjs
   ```

2. O Terminal mostra **"=== Autorizar o Ide Works no Dropbox ==="** e um endereço comprido que começa com `https://www.dropbox.com/oauth2/authorize?client_id=`.
   - Se em vez disso aparecer **"✗ Falta no .dev.vars"**, o passo 3 não ficou gravado. Confira as duas linhas e rode de novo.
3. Copie esse endereço e abra no navegador **logado na conta da agência**.
4. O Dropbox mostra a tela **"Ide Works Aprovacao would like to access…"** com a lista do que o app pode fazer. Confira: só deve falar em **ver** arquivos e links (nada de editar ou apagar).
   - Se a lista falar em editar ou apagar, pare. Volte ao passo 2 e desmarque o que não for leitura.
5. Clique em **Continue** (Continuar) e depois em **Allow** (Permitir).
6. Aparece a página **"Access code generated"** com um código. Copie o código.
7. Volte ao Terminal, onde está escrito **"Código:"**, cole e aperte **Enter**.
8. O Terminal mostra **"✓ Autorizado."** e, em **"Permissões concedidas"**, deve aparecer `account_info.read files.metadata.read sharing.read` (a ordem pode variar).
   - Se aparecer **"O código já foi usado ou venceu"**: o código vale poucos minutos e uma vez só. Rode o comando de novo e gere outro.
   - Se aparecer **"A chave ou o segredo do app no .dev.vars não batem"**: copie de novo o App key e o App secret (passo 3).
9. Logo abaixo aparece a linha que começa com **`IDEWORKS_DROPBOX_REFRESH_TOKEN=`**. Copie a linha inteira.
10. Abra o `.dev.vars` de novo (`open -e .dev.vars`), cole essa linha no fim, salve e feche.

O refresh token não vence. Ele só deixa de funcionar se alguém desconectar o app na conta da agência (em dropbox.com → Configurações → Apps conectados). Se isso acontecer, refaça este passo 4.

## 5. Gravar as três chaves no Worker publicado

No Terminal, na pasta do Ide Work, rode um comando de cada vez. Cada um pergunta o valor: cole o mesmo código que está no `.dev.vars` e aperte **Enter**.

1. ```
   npx wrangler secret put IDEWORKS_DROPBOX_APP_KEY
   ```
   Aparece **"Enter a secret value:"**. Cole o App key e aperte **Enter**. Deve terminar com **"✨ Success! Uploaded secret IDEWORKS_DROPBOX_APP_KEY"**.
2. ```
   npx wrangler secret put IDEWORKS_DROPBOX_APP_SECRET
   ```
   Cole o App secret. Deve terminar com **"✨ Success!"**.
3. ```
   npx wrangler secret put IDEWORKS_DROPBOX_REFRESH_TOKEN
   ```
   Cole só o token (o que vem depois do `=`), sem o nome. Deve terminar com **"✨ Success!"**.
4. Confira:

   ```
   npx wrangler secret list
   ```

   Na lista devem aparecer os três nomes: **IDEWORKS_DROPBOX_APP_KEY**, **IDEWORKS_DROPBOX_APP_SECRET** e **IDEWORKS_DROPBOX_REFRESH_TOKEN** (os valores nunca aparecem, só os nomes).

Gravar segredo não publica código novo nem tira nada do ar.

## 6. Provar que funcionou

1. Com um link de **arquivo aberto** (um vídeo), rode:

   ```
   node scripts/provar-dropbox.mjs "COLE-O-LINK-AQUI"
   ```

   Use as aspas: o link tem `&` e o Terminal cortaria sem elas.

   Deve aparecer:
   - **Visibilidade: qualquer pessoa com o link (publico)**
   - **"✓ Aberto para qualquer pessoa. Arquivos (1):"**, com o nome do arquivo, `[video]`, a versão (`rev`) e o tamanho.
   - Uma linha **"exibição:"** com um endereço terminado em `raw=1`.
2. Copie o endereço da linha **"exibição:"** e abra numa **janela anônima** do navegador (⇧⌘N no Chrome). O vídeo deve tocar ali, sem pedir login.
3. Agora rode com um link **fechado** (só para a equipe, ou com senha):

   ```
   node scripts/provar-dropbox.mjs "COLE-O-LINK-FECHADO-AQUI"
   ```

   Deve aparecer **"✗ Recusado (link_fechado)"** ou **"✗ Recusado (link_com_senha)"** e, entre aspas, a frase que a equipe vai ler, por exemplo: *"Este link do Dropbox não está aberto para qualquer pessoa…"*.
4. (Opcional) Com um link de **pasta** aberta, rode o mesmo comando acrescentando `--baixar` no fim. Deve listar todos os arquivos da pasta, cada um com a sua versão, e terminar com **"Repasse de … status 206, 1024 bytes"**. Isso prova que o Ide Works consegue mostrar arquivos de dentro de uma pasta.

## 7. O que me responder

Me mande, copiando do Terminal:

1. A linha **"Permissões concedidas"** do passo 4.
2. O resultado de `npx wrangler secret list` (só os três nomes do Dropbox).
3. A saída inteira do passo 6.1 (link aberto). Pode apagar o link se preferir.
4. **Sim ou não:** o vídeo tocou na janela anônima (passo 6.2)?
5. A saída do passo 6.3 (link fechado).
6. Se fez o 6.4, a última linha (**"Repasse de …"**).

Se algum passo mostrou algo diferente do que está escrito aqui, me mande o print daquele passo e o número dele.
