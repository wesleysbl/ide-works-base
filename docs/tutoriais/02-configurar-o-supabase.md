# 2. Configurar o Supabase

Aqui você cria o banco, instala o IdeWorks dentro dele e vira o primeiro super admin.

## Passo 1: criar o projeto

1. Entre em [supabase.com/dashboard](https://supabase.com/dashboard) e clique em **New project**.
2. Dê um nome (ex.: `ideworks`), escolha uma **senha do banco** forte e **guarde**: ela é a
   senha de administrador, usada só na instalação.
3. Em **Region**, escolha a mais perto da equipe (no Brasil: **South America (São Paulo)**).
4. Clique em **Create new project** e espere uns dois minutos até ele ficar pronto.

## Passo 2: instalar o banco do IdeWorks

O banco é criado por **125 migrations**, que rodam em ordem. O script do projeto faz isso e
anota o que já rodou (rodar de novo só aplica o que falta).

1. No projeto, clique no botão **Connect** (no topo).
2. Escolha a aba de string de conexão e o tipo **Session pooler** (funciona em qualquer
   internet). Copie a URI. Ela tem esta cara:

   ```
   postgresql://postgres.abcdefghijklmnopqrst:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
   ```

3. Troque `[YOUR-PASSWORD]` pela senha do banco do passo 1.
4. Na pasta do projeto (você baixa no [tutorial 3](03-rodar-no-computador.md), passos 1 e 2),
   rode:

   ```bash
   node scripts/instalar-banco.mjs "COLE-A-URI-AQUI"
   ```

   Você vai ver as migrations passando, uma por linha, e no fim:

   ```
   Banco pronto. Próximo passo: rodar supabase/primeiro-acesso.sql no SQL Editor.
   ```

> **Já usa o Supabase CLI?** `npx supabase link --project-ref SEU-PROJETO` e
> `npx supabase db push` também aplicam as migrations. O script acima é o caminho testado
> e grava o registro na mesma tabela do CLI, então os dois convivem.

## Passo 3: senha do papel restrito, empresa e super admin

O servidor nunca usa a senha de administrador. Ele entra com o papel **`ideworks_app`**,
que só alcança as tabelas do IdeWorks. Esse papel nasce **sem senha**; você define agora.

1. Primeiro, crie a sua conta: **Authentication → Users → Add user → Create new user**.
   Use o seu e-mail e uma senha, e deixe **Auto Confirm User** marcado.
2. Abra o **SQL Editor** (no menu da esquerda) e clique em **New query**.
3. Copie o conteúdo de [`supabase/primeiro-acesso.sql`](../../supabase/primeiro-acesso.sql)
   e cole no editor.
4. Troque os três valores marcados com `<<<`:
   - `TROQUE-POR-UMA-SENHA-LONGA`: a senha do papel `ideworks_app`. Invente uma longa, só
     com letras e números (evita problema na URL de conexão). **Guarde**: ela vai para o
     `.env` e para a Cloudflare.
   - `Minha Empresa`: o nome da sua empresa (no sistema ela aparece como "unidade de
     negócio"; dá para mudar depois em **Catálogos**).
   - `voce@suaempresa.com.br`: o mesmo e-mail da conta que você criou no item 1.
5. Clique em **Run**. O resultado deve mostrar uma linha com o seu e-mail e `super_admin`.

## Passo 4: ajustar o login

O IdeWorks não manda e-mail: a conta de cada pessoa nasce de um convite com código, e ela
mesma escolhe a senha. Para isso funcionar:

1. Vá em **Authentication → Sign In / Providers** (ou **Providers → Email**, conforme a
   versão do painel).
2. Deixe **Email** ligado.
3. **Desligue** **Confirm email**. (Se ficar ligado, a pessoa ativa a conta e não consegue
   entrar, porque o Supabase espera um e-mail de confirmação que nunca chega.)
4. Deixe **Allow new users to sign up** **ligado**: é por ali que a ativação cria a conta.
   Isso não abre a porta: quem cria conta sem convite não tem perfil no IdeWorks e é
   recusado na entrada.

## Passo 5: anotar as chaves

Você vai precisar destes valores no `.env` (tutorial 3) e na Cloudflare (tutorial 5):

| O quê | Onde fica no painel | Vai para |
|---|---|---|
| **URL do projeto** | Project Settings → Data API (ou API) → Project URL | `IDEWORKS_PUBLIC_SUPABASE_URL` |
| **Chave `anon`** | Project Settings → API Keys → aba **Legacy API Keys** → `anon` `public` | `IDEWORKS_PUBLIC_SUPABASE_ANON_KEY` |
| **Chave `service_role`** | mesma aba → `service_role` `secret` (clique em **Reveal**) | `IDEWORKS_SERVER_SUPABASE_SERVICE_KEY` |
| **Host do Transaction pooler** | botão **Connect** → **Transaction pooler** → o trecho entre `@` e `:6543` | `IDEWORKS_SERVER_DB_HOST` |
| **Senha do `ideworks_app`** | a que você inventou no passo 3 | `IDEWORKS_SERVER_DB_PASSWORD` |
| **Região** | Project Settings → General | `[placement]` no `wrangler.toml` |

> **Sobre as chaves "legacy".** O código usa as chaves do formato antigo (`anon` e
> `service_role`). O Supabase anunciou que vai desativar esse formato até o fim de 2026, em
> favor das novas `publishable` e `secret`
> ([guia de migração](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)).
> Se o seu projeto não tiver a aba **Legacy API Keys**, veja
> [Problemas comuns](08-problemas-comuns.md#o-projeto-não-tem-as-chaves-legacy).

## Conferir

No SQL Editor:

```sql
select count(*) as tabelas from information_schema.tables where table_schema = 'ideworks';
-- deve dar 75
select email, role from ideworks.profiles;
-- deve mostrar você, como super_admin
```

---

Anterior: [1. O que você precisa](01-o-que-voce-precisa.md) ·
Próximo: [3. Rodar no computador](03-rodar-no-computador.md)
