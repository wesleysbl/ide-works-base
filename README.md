<p align="center">
  <img src="docs/imagens/ideworks-banner.png" alt="IdeWorks" width="640">
</p>

<p align="center">
  <strong>O sistema de gestão de uma agência de marketing, num app só:</strong><br>
  o que foi vendido ao cliente e o que foi entregue, o quadro de tarefas da equipe,<br>
  os números do Instagram e dos anúncios, o chat interno e a aprovação do cliente.
</p>

<p align="center">
  React · TypeScript · Cloudflare Workers · Supabase (Postgres) · mais de 6.700 testes automatizados
</p>

---

![Painel do IdeWorks](docs/imagens/telas/02-painel.png)

> Todas as imagens desta documentação usam **dados fictícios**. Nenhum cliente, pessoa ou
> número real aparece aqui.

## O que ele faz

| Área | Para que serve |
|---|---|
| **Entrega** | Cada cliente tem um contrato do mês (tantos vídeos, artes, fotos, anúncios). O sistema mede o que foi entregue, mostra quem está atrasado e o nível de entrega da carteira inteira. |
| **Quadro** | Tarefas no estilo ClickUp: espaços, pastas, listas, etapas (esteiras), kanban, subtarefas, checklists, anexos, comentários com menções e automações por etapa. |
| **Planejamento** | O mês de cada cliente em visão de contrato, semana e calendário, e o **Controle da semana** para a gestão. |
| **Meta** | Coleta automática de Instagram e anúncios (alcance, impressões, investimento, resultados), relatório por conta e ranking. |
| **Chat** | Conversas da equipe ao vivo, em grupo ou diretas, com imagens, reações e menções. |
| **Aprovação do cliente** | Um link fixo por cliente, que funciona no celular, para ele aprovar ou pedir ajuste nos materiais. |
| **Agentes de IA** | Conexão por MCP, OAuth e API HTTP: o Claude, o ChatGPT ou uma automação (n8n) leem e escrevem no sistema, com permissões escolhidas uma a uma. |
| **Pessoas e acesso** | Ninguém se cadastra sozinho: a conta nasce de um convite com código. Papéis (super admin, admin, funcionário), áreas e alcance por cliente. |

<table>
  <tr>
    <td><img src="docs/imagens/telas/06-quadro-lista.png" alt="Quadro em kanban"></td>
    <td><img src="docs/imagens/telas/03-cliente.png" alt="Ficha do cliente"></td>
  </tr>
  <tr>
    <td align="center">Quadro em kanban</td>
    <td align="center">Ficha do cliente com o contrato do mês</td>
  </tr>
  <tr>
    <td><img src="docs/imagens/telas/04-planejamento.png" alt="Planejamento"></td>
    <td><img src="docs/imagens/telas/16-meta-relatorio.png" alt="Relatório da Meta"></td>
  </tr>
  <tr>
    <td align="center">Planejamento do mês</td>
    <td align="center">Relatório de anúncios da Meta</td>
  </tr>
  <tr>
    <td><img src="docs/imagens/telas/11-chat.png" alt="Chat da equipe"></td>
    <td><img src="docs/imagens/telas/19-painel-escuro.png" alt="Tema escuro"></td>
  </tr>
  <tr>
    <td align="center">Chat da equipe</td>
    <td align="center">Tema escuro</td>
  </tr>
</table>

<p align="center">
  <img src="docs/imagens/telas/20-celular-minhas-tarefas.png" alt="Minhas tarefas no celular" width="230">
  &nbsp;&nbsp;
  <img src="docs/imagens/telas/21-celular-chat.png" alt="Chat no celular" width="230">
  &nbsp;&nbsp;
  <img src="docs/imagens/telas/22-celular-aprovacao-do-cliente.png" alt="Aprovação do cliente no celular" width="230">
</p>

Todas as telas estão em [`docs/imagens/telas/`](docs/imagens/telas/).

## Como funciona por dentro

```
navegador ──► Cloudflare Worker (worker/index.ts)
                 ├── serve o site (React, construído pelo Vite em dist/)
                 ├── /api/*            a API da equipe
                 ├── /mcp, /oauth/*    agentes de IA
                 └── Hyperdrive ──► Supabase Postgres, schema `ideworks`
                                      (papel restrito `ideworks_app` + RLS em toda tabela)
              Supabase Auth (contas e senhas) · Supabase Storage (anexos, privados)
```

- **Uma implantação só:** o mesmo Worker serve o site e a API, sem CORS.
- **Segurança no banco:** o servidor entra com um papel que só alcança o schema `ideworks`, e
  cada tabela tem política de linha (RLS). Quem vê o quê é decidido pelo Postgres.
- **Testes sem rede:** `npm test` roda mais de 6.700 testes em poucos minutos, com o banco
  simulado pelo PGlite (Postgres em memória).

## Instalação, em 5 passos

O passo a passo completo, com cada clique, está nos tutoriais. O resumo:

```bash
# 1. baixar e instalar as dependências (Node 24)
git clone https://github.com/wesleysbl/ide-works-base.git
cd ide-works-base
npm install

# 2. criar o banco num projeto novo do Supabase
node scripts/instalar-banco.mjs "postgresql://postgres.SEU-PROJETO:SENHA@HOST:5432/postgres"
#    e rodar supabase/primeiro-acesso.sql no SQL Editor do Supabase

# 3. configurar
cp .env.example .env              # e preencher
cp .dev.vars.example .dev.vars    # e preencher

# 4. conferir e rodar no computador
npm test
npm run dev:api    # a API, na porta 8787 (um terminal)
npm run dev        # o site, na porta 8080 (outro terminal)
# abrir http://localhost:8080

# 5. publicar na Cloudflare
npm run build && npx wrangler deploy
```

## Tutoriais

| # | Tutorial | O que você vai fazer |
|---|---|---|
| 1 | [O que você precisa](docs/tutoriais/01-o-que-voce-precisa.md) | Contas, programas e quanto custa |
| 2 | [Configurar o Supabase](docs/tutoriais/02-configurar-o-supabase.md) | Criar o projeto, instalar o banco e virar super admin |
| 3 | [Rodar no computador](docs/tutoriais/03-rodar-no-computador.md) | Baixar, configurar o `.env` e abrir o sistema em `localhost` |
| 4 | [Primeiros passos no sistema](docs/tutoriais/04-primeiros-passos.md) | Empresa, planos, clientes, espaços, convidar a equipe |
| 5 | [Publicar na Cloudflare](docs/tutoriais/05-publicar-na-cloudflare.md) | Colocar no ar, com domínio próprio |
| 6 | [Personalizar com a sua marca](docs/tutoriais/06-personalizar.md) | Logo, cores, textos e endereços |
| 7 | [Integrações](docs/tutoriais/07-integracoes.md) | Meta (Instagram e anúncios), Dropbox e agentes de IA |
| 8 | [Problemas comuns](docs/tutoriais/08-problemas-comuns.md) | O que fazer quando algo não funciona |

Guias de uso, para a equipe:
[Aprovação do cliente](docs/tutoriais/aprovacao-do-cliente.md) ·
[Controle da semana](docs/tutoriais/controle-da-semana.md) ·
[Dropbox](docs/tutoriais/dropbox.md) ·
[Conectar a sua IA](docs/como-conectar-a-sua-ia.md) ·
[Menções e notificações](docs/mencoes-e-notificacoes.md)

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | O site em `http://localhost:8080` (repassa `/api` para a porta 8787) |
| `npm run dev:api` | A API em `http://localhost:8787`, ligada ao banco do `.env` |
| `npm run dev:tudo` | Os dois de uma vez |
| `npm test` | A suíte inteira, sem rede e sem banco |
| `npm run typecheck` | Verificação de tipos do app e dos testes |
| `npm run lint` | Análise do código |
| `npm run build` | Verifica os tipos e constrói o site em `dist/` |
| `npx wrangler deploy` | Publica o Worker e o site na Cloudflare |
| `node scripts/instalar-banco.mjs` | Aplica as migrations que faltam no banco |
| `node scripts/conferir-schema.mjs` | Compara o banco real com o retrato esperado |
| `node scripts/capturar-telas.mjs` | Regera as capturas de tela da documentação, com dados fictícios |

## Mapa do repositório

```
src/
  pages/        as telas
  board/        o quadro: espaços, listas, tarefas, esteiras, automações
  clients/      clientes, contrato do mês, semanal
  painel/       o painel e o controle da semana
  meta/         relatórios, ranking e contas da Meta
  chat/         o chat da equipe
  aprovacao/    a página pública de aprovação do cliente
  integrations/ MCP, OAuth e API HTTP para agentes de IA
  auth/         entrar, ativar conta, redefinir senha
  server/       a lógica que roda no Worker
  ui/           o design system OBSIDIAN (tokens, componentes, gráficos)
  config/       leitura de configuração e endereços da instalação
worker/         a borda: recorta /api, /mcp e /oauth, e serve o site
supabase/
  migrations/   125 migrations, nomeadas por fase
  rollback/     a reversão de cada uma
  primeiro-acesso.sql
scripts/        instalar o banco, subir a API local, conferir o schema, provas de tela (e2e)
test/           testes transversais (os outros moram ao lado do código)
docs/           tutoriais e imagens
```

Convenções de código e de banco: [`CONVENCOES.md`](CONVENCOES.md) e [`supabase/README.md`](supabase/README.md).

## Origem

O IdeWorks foi criado pela **Agência Ide** (Ibitinga, SP) para o próprio dia a dia, e esta é
a versão aberta para servir de base a outras equipes. O código nasceu dentro de um projeto que
já tinha outro sistema no mesmo banco, por isso muitos comentários falam em "legado" ou em não
tocar no schema `public`. Numa instalação nova isso não existe, e nada precisa ser feito a
respeito.

## Licença

[MIT](LICENSE): pode usar, modificar e distribuir, inclusive comercialmente, desde que o
aviso de autoria e a licença acompanhem o código.
