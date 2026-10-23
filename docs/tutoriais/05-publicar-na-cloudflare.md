# 5. Publicar na Cloudflare

Aqui o IdeWorks vai para a internet. No fim, ele responde em
`https://ideworks.SUA-CONTA.workers.dev` e, se quiser, num domínio seu.

Antes: termine os tutoriais [2](02-configurar-o-supabase.md) e
[3](03-rodar-no-computador.md). Tudo abaixo roda na pasta do projeto.

## Passo 1: entrar na Cloudflare pelo terminal

```bash
npx wrangler login
```

Abre o navegador para você autorizar. Depois, `npx wrangler whoami` mostra a sua conta.

## Passo 2: criar o KV dos agentes de IA

```bash
npx wrangler kv namespace create OAUTH_KV
```

A resposta traz um `id` (32 letras e números). Cole no `wrangler.toml`, no bloco
`[[kv_namespaces]]`:

```toml
[[kv_namespaces]]
binding = "OAUTH_KV"
id = "o-id-que-apareceu"
```

## Passo 3: criar o Hyperdrive (a ponte com o banco)

O Worker não conecta direto no Postgres; quem faz isso é o Hyperdrive. Ele guarda a senha
do papel `ideworks_app`, e é o **único** lugar da Cloudflare onde ela fica.

A Cloudflare recomenda a **conexão direta** do Supabase
([documentação](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/)).
No painel do Supabase: botão **Connect** → **Direct connection**. Monte a string com o
usuário `ideworks_app` e a senha que você inventou no tutorial 2:

```bash
npx wrangler hyperdrive create ideworks \
  --connection-string="postgres://ideworks_app:SENHA-DO-IDEWORKS-APP@db.SEU-PROJETO.supabase.co:5432/postgres"
```

> **Se der erro de conexão**, use o **Session pooler** (porta 5432). Repare que no pooler o
> usuário leva o código do projeto junto:
> `postgres://ideworks_app.SEU-PROJETO:SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`

A Cloudflare testa a conexão antes de criar. A resposta traz um `id`; cole no
`wrangler.toml`:

```toml
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "o-id-que-apareceu"
```

## Passo 4: revisar o `wrangler.toml`

| Campo | O que pôr |
|---|---|
| `name` | O nome do Worker (vira parte do endereço). `ideworks` serve. |
| `[placement] region` | A região do seu projeto do Supabase. São Paulo: `aws:sa-east-1` |
| `IDEWORKS_PUBLIC_SUPABASE_URL` e `..._ANON_KEY` | Já preenchidos no tutorial 3 |
| `IDEWORKS_CHAT` | `ligado`, `piloto` (só super admin) ou `desligado` |

Os outros campos estão explicados no próprio arquivo e podem ficar como vieram.

## Passo 5: publicar

```bash
npm run build
npx wrangler deploy
```

No fim aparece o endereço, algo como `https://ideworks.sua-conta.workers.dev`.

## Passo 6: os segredos

Cada comando pede o valor (cole e dê Enter). O valor não aparece na tela nem fica em
arquivo.

```bash
npx wrangler secret put IDEWORKS_SERVER_SUPABASE_SERVICE_KEY   # a chave service_role
npx wrangler secret put IDEWORKS_APPROVAL_LINK_KEY             # a mesma do .dev.vars
```

> **Não troque a `IDEWORKS_APPROVAL_LINK_KEY` depois de criar links de aprovação.** Ela
> cifra a cópia de cada link que fica guardada para a equipe reenviar ao cliente. Com outra
> chave, o link do cliente continua abrindo, mas a equipe não consegue mais copiá-lo da
> ficha e precisa gerar um novo.

Opcionais (tutorial 7): `IDEWORKS_META_TOKEN`, `IDEWORKS_DROPBOX_APP_KEY`,
`IDEWORKS_DROPBOX_APP_SECRET`, `IDEWORKS_DROPBOX_REFRESH_TOKEN`.

Os segredos valem na hora, sem publicar de novo.

## Passo 7: testar

1. Abra `https://ideworks.sua-conta.workers.dev/api/health`: deve responder
   `{"ok":true,"schema":"ideworks",...}`.
2. Abra o endereço sem o `/api/health` e entre com a sua conta.
3. Convide uma pessoa (Pessoas → Convidar alguém) e peça para ela ativar. Se a ativação
   funcionar, a chave `service_role` e o login estão certos.

## Passo 8 (opcional): domínio próprio

O domínio precisa estar **na mesma conta da Cloudflare** (com o DNS gerenciado por ela).

1. No `wrangler.toml`, tire o `#` do bloco `[[routes]]` e troque o domínio:

   ```toml
   [[routes]]
   pattern = "works.suaempresa.com.br"
   zone_name = "suaempresa.com.br"
   custom_domain = true
   ```

2. Ainda no `wrangler.toml`, preencha:

   ```toml
   IDEWORKS_PUBLIC_ORIGIN = "https://works.suaempresa.com.br"
   ```

   Com isso, quem abrir uma página pelo `*.workers.dev` é levado para o domínio próprio.

3. Em `src/config/instalacao.ts`, troque `enderecoPublicado` pelo mesmo endereço (ele
   aparece nas instruções de conexão dos agentes de IA).
4. Publique de novo: `npm run build && npx wrangler deploy`.

A Cloudflare cria o registro de DNS e o certificado sozinha. Pode levar alguns minutos.

## Atualizar depois

Quando puxar código novo:

```bash
git pull
npm install
node scripts/instalar-banco.mjs "URI-DO-SESSION-POOLER"   # aplica só as migrations novas
npm test
npm run build && npx wrangler deploy
```

O instalador do banco anota o que já rodou; rodar de novo nunca repete uma migration.

## Quanto custa

Para uma equipe pequena, o plano gratuito da Cloudflare dá conta: 100 mil requisições por
dia nos Workers e 100 mil consultas por dia no Hyperdrive
([preços do Hyperdrive](https://developers.cloudflare.com/hyperdrive/platform/pricing/)).
O gatilho periódico roda a cada 15 minutos (coleta da Meta, limpezas e avisos).

---

Anterior: [4. Primeiros passos no sistema](04-primeiros-passos.md) ·
Próximo: [6. Personalizar com a sua marca](06-personalizar.md)
