# 1. O que você precisa

Antes de começar, separe estas contas e programas. Tudo aqui tem plano gratuito que serve
para instalar, testar e rodar com uma equipe pequena.

## Contas

| Conta | Para quê | Plano |
|---|---|---|
| [GitHub](https://github.com) | Baixar o código (e guardar a sua versão dele) | Gratuito |
| [Supabase](https://supabase.com) | O banco de dados (Postgres), o login das pessoas e os arquivos anexados | Free serve para começar. No Free, o projeto **pausa depois de uma semana sem uso** e tem 500 MB de banco; para uso diário da equipe, o Pro evita a pausa |
| [Cloudflare](https://dash.cloudflare.com/sign-up) | Onde o sistema roda (Workers), a ponte com o banco (Hyperdrive) e o domínio | Workers Free: 100 mil requisições por dia, e o Hyperdrive dá 100 mil consultas por dia |

Opcionais, só se for usar as integrações (tutorial 7):
**Meta for Developers** (Instagram e anúncios) e **Dropbox** (materiais na aprovação do cliente).

## Programas no computador

| Programa | Versão | Como conferir | Onde baixar |
|---|---|---|---|
| **Node.js** | **24** | `node -v` deve mostrar `v24...` | [nodejs.org](https://nodejs.org) (versão LTS 24) ou, melhor, pelo [nvm](https://github.com/nvm-sh/nvm): `nvm install 24` |
| **Git** | qualquer recente | `git --version` | [git-scm.com](https://git-scm.com) |
| Um editor | | | [VS Code](https://code.visualstudio.com) é o mais comum |

O repositório tem um arquivo `.nvmrc` com a versão 24: dentro da pasta do projeto, `nvm use`
já escolhe a versão certa.

Não precisa instalar o Supabase CLI nem o Wrangler (o programa da Cloudflare): os comandos
deste guia usam `npx`, que baixa e roda na hora.

## Quanto tempo leva

| Etapa | Tempo |
|---|---|
| Configurar o Supabase (tutorial 2) | 20 minutos |
| Rodar no computador (tutorial 3) | 15 minutos |
| Publicar na Cloudflare (tutorial 5) | 20 minutos |

## Um aviso sobre segredos

Ao longo da instalação você vai lidar com **três coisas que são senha**:

1. a senha do banco do Supabase (a de administrador, criada junto com o projeto);
2. a senha do papel `ideworks_app` (que você mesmo inventa no tutorial 2);
3. a chave `service_role` do Supabase.

Elas vão para os arquivos `.env` e `.dev.vars` (que **nunca** vão para o git, o
`.gitignore` já cuida disso) e para os segredos da Cloudflare. Nunca cole nenhuma delas no
código, em print, em conversa ou em issue. Se vazou, troque no painel do Supabase.

---

Próximo: [2. Configurar o Supabase](02-configurar-o-supabase.md)
