# 8. Problemas comuns

## Na instalação

### `npm install` dá erro

- Confira `node -v`: precisa ser **24**. Com outra versão, o `npm ci`/`npm install` pode
  reclamar do `package-lock.json`. Use `nvm install 24 && nvm use`.
- Atrás de proxy de empresa, configure o npm (`npm config set proxy ...`) ou use outra rede.

### `instalar-banco.mjs` falha numa migration

- **`password authentication failed`**: a senha da URI é a do **banco** (criada com o
  projeto), não a do `ideworks_app`. Se esqueceu: Project Settings → Database →
  **Reset database password**.
- **`ENOTFOUND` / `timeout`**: use a URI do **Session pooler**, não a "Direct connection"
  (a direta só funciona em redes com IPv6).
- **Uma migration específica falhou**: nada dela ficou gravado. Leia a mensagem, corrija e
  rode de novo; as anteriores não se repetem.

### O SQL do primeiro acesso não mostra nenhuma linha no fim

O e-mail do passo 3 do `primeiro-acesso.sql` não bate com a conta criada em
**Authentication → Users**. Confira a grafia e rode de novo (o script pode rodar quantas
vezes precisar).

### O projeto não tem as chaves "legacy"

O código usa as chaves `anon` e `service_role` do formato antigo, que ficam na aba
**Legacy API Keys** (Project Settings → API Keys). O Supabase anunciou que vai desativar
esse formato até o fim de 2026
([guia do Supabase](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)).
Se o seu projeto só tiver as chaves novas (`sb_publishable_...` e `sb_secret_...`):

- a `publishable` entra no lugar da `anon`;
- a `secret` entra no lugar da `service_role`, mas o código a envia também no cabeçalho
  `Authorization: Bearer`, e o Supabase documenta essas chaves só no cabeçalho `apikey`.
  Se convidar pessoas ou anexar arquivos falhar com 401, os pontos a ajustar são
  `src/server/pessoa-cadastro.ts`, `src/server/ports.ts`, `src/server/board-anexos.ts` e
  `src/server/chat-imagens.ts`.

## Rodando no computador

### `npm run dev` falha com `EAFNOSUPPORT ... :::8080`

A sua máquina não tem IPv6 ligado. Rode o site assim:

```bash
npx vite --host 127.0.0.1
```

### `npm run dev:api` diz "Faltam no .env"

O `.env` não existe ou faltam `IDEWORKS_PUBLIC_SUPABASE_URL`, `IDEWORKS_SERVER_DB_USER` ou
`IDEWORKS_SERVER_DB_PASSWORD`. Veja o [tutorial 3, passo 4](03-rodar-no-computador.md#passo-4-o-arquivo-env).

### Porta 8080 ou 8787 ocupada

Já tem outra cópia rodando. Feche os outros terminais (ou, no Mac/Linux,
`lsof -i :8080` mostra quem está usando).

### Entro com e-mail e senha e a entrada é recusada

- A conta existe no Supabase, mas **não tem perfil no IdeWorks**. Rode o
  `primeiro-acesso.sql` com o e-mail certo.
- O `wrangler.toml` ainda está com `https://SEU-PROJETO.supabase.co`: a API lê a URL e a
  chave `anon` de lá ([tutorial 3, passo 6](03-rodar-no-computador.md#passo-6-o-wranglertoml)).

### Erro de conexão com o banco na API (`password authentication failed for user "ideworks_app..."`)

- A senha em `IDEWORKS_SERVER_DB_PASSWORD` tem que ser a do `alter role ideworks_app ...`
  do primeiro acesso.
- `IDEWORKS_SERVER_DB_HOST` tem que ser o host do **Transaction pooler** do **seu** projeto
  (a região muda o endereço: `aws-0-...` ou `aws-1-...`).

### A pessoa ativou a conta e não consegue entrar

Em **Authentication → Sign In / Providers**, o **Confirm email** precisa estar
**desligado** ([tutorial 2, passo 4](02-configurar-o-supabase.md#passo-4-ajustar-o-login)).

### Ativar conta diz "Não foi possível concluir por aqui"

**Allow new users to sign up** está desligado no Supabase. Ligue: a ativação cria a conta
por ali (quem não tem convite continua sem entrar).

## Publicado na Cloudflare

### `wrangler deploy` reclama do Hyperdrive ou do KV

Os `id` no `wrangler.toml` ainda são `00000000...`. Crie os dois
([tutorial 5, passos 2 e 3](05-publicar-na-cloudflare.md#passo-2-criar-o-kv-dos-agentes-de-ia))
e cole os `id`.

### Erro 500 ao entrar, mas o `/api/health` responde

Veja o registro do erro: painel da Cloudflare → **Workers & Pages** → `ideworks` →
**Logs**, ou no terminal `npx wrangler tail`. Os erros mais comuns:

- o Hyperdrive aponta para a senha antiga do `ideworks_app`
  (`npx wrangler hyperdrive update ID --origin-password=NOVA`);
- falta o segredo `IDEWORKS_SERVER_SUPABASE_SERVICE_KEY` (`npx wrangler secret list`).

### Conectar um agente de IA dá `Invalid client_id`

O KV `OAUTH_KV` não está configurado, ou o `binding` não se chama exatamente `OAUTH_KV`.

### O domínio próprio não abre

- O domínio precisa estar na **mesma conta** da Cloudflare do Worker.
- Espere alguns minutos pelo certificado.
- Até lá, o `*.workers.dev` continua funcionando (desde que `IDEWORKS_PUBLIC_ORIGIN` esteja
  vazio; preenchido, ele redireciona as páginas para o domínio).

### O projeto do Supabase "dormiu"

No plano Free, o Supabase pausa o projeto depois de uma semana sem uso. Entre no painel e
clique em **Restore**. Para uso diário, o plano Pro evita a pausa.

## Para quem vai mexer no código

- `npm test` precisa passar antes de publicar. Ele roda sem rede: um teste derruba qualquer
  chamada que tente sair da máquina.
- Migration nova: crie o par em `supabase/migrations/` e `supabase/rollback/` (mesmo nome),
  ligue RLS em toda tabela nova, aplique com `node scripts/instalar-banco.mjs` e regrave o
  retrato com `node scripts/conferir-schema.mjs --gravar`. Ver [`CONVENCOES.md`](../../CONVENCOES.md).
- Segredo nunca leva o prefixo `IDEWORKS_PUBLIC_`: esse prefixo vai para o navegador.

---

Anterior: [7. Integrações](07-integracoes.md) · [Voltar ao início](../../README.md)
