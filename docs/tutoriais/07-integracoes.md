# 7. Integrações

Todas são opcionais. O sistema funciona sem nenhuma delas.

## Agentes de IA (Claude, ChatGPT, automações)

Já vem ligado. Cada pessoa conecta o próprio agente pela tela **Agentes de IA** (menu da
conta), que mostra o passo a passo para cada programa:

![Agentes de IA](../imagens/telas/18-conexoes.png)

- **Claude Code / Codex** (terminal): um comando para colar.
- **Claude no site ou no aplicativo / ChatGPT**: adicionar um conector com o endereço
  `https://SEU-ENDERECO/mcp`.
- **Automação (n8n, scripts)**: API HTTP em `https://SEU-ENDERECO/api/integrations/v1`,
  com um segredo emitido na própria tela.

A autorização passa sempre pelo navegador (OAuth): a pessoa entra com a conta dela e marca
o que o agente pode fazer (ler, comentar, mover tarefas...). A conexão aparece na tela e
pode ser revogada a qualquer momento. O agente nunca vê mais do que a pessoa vê.

Guia de uso para a equipe: [Como conectar a sua IA](../como-conectar-a-sua-ia.md).

Pré-requisito: o KV `OAUTH_KV` configurado no `wrangler.toml`
([tutorial 5, passo 2](05-publicar-na-cloudflare.md#passo-2-criar-o-kv-dos-agentes-de-ia)).
Sem ele, conectar um agente dá `Invalid client_id`.

## Meta (Instagram e anúncios)

O IdeWorks coleta sozinho, a cada 15 minutos, as métricas das contas de Instagram e de
anúncios ligadas aos clientes: alcance, impressões, interações, seguidores, investimento,
cliques e resultados. A janela reprocessada é de 28 dias, então um dia que falhe se
recupera no seguinte.

![Relatório da Meta](../imagens/telas/16-meta-relatorio.png)

### O token

O caminho que não vence é o de um **Usuário do Sistema** (System User) no Gerenciador de
Negócios da Meta. Tudo isto fica em **Configurações do Negócio** (não no painel do app):

1. Ter um app da Meta, do tipo Empresa, com os produtos de Login do Facebook e Instagram.
2. Criar um **Usuário do Sistema**, tipo administrador.
3. Dar a ele acesso ao app.
4. Dar a ele acesso aos ativos: as contas de anúncio e as contas profissionais de Instagram
   (com a página do Facebook ligada).
5. **Gerar novo token**, com a validade mais longa oferecida, marcando as permissões:

   | Permissão | Para quê |
   |---|---|
   | `pages_show_list` | listar as páginas |
   | `pages_read_engagement` | ler a página ligada ao Instagram |
   | `instagram_basic` | ler perfil e publicações |
   | `instagram_manage_insights` | as métricas do orgânico |
   | `ads_read` | as métricas dos anúncios (só leitura) |

   Não precisa de `ads_management` (dá escrita) nem de `business_management`.

6. Guardar o token, **sem colar em lugar nenhum**:

   ```bash
   node scripts/guardar-token.mjs IDEWORKS_META_TOKEN   # grava no .dev.vars, sem mostrar
   node scripts/conferir-token-meta.mjs                 # diz de quem é, quando vence e o que lê
   npx wrangler secret put IDEWORKS_META_TOKEN          # para o sistema publicado
   ```

Token de **usuário** (o do Explorador da API do Graph) funciona, mas morre em horas.

**Mais de uma empresa no grupo, cada uma com a sua conta na Meta?** Cada unidade de negócio
pode usar um segredo próprio: grave o token com outro nome (ex.:
`IDEWORKS_META_TOKEN_EMPRESA2`) e informe esse nome na coluna `meta_secret_name` da unidade
(tabela `ideworks.client_categories`).

Depois, na tela **Meta**, importe as contas e ligue cada uma ao cliente.

## Dropbox (materiais na aprovação do cliente)

Quando a equipe cola links do Dropbox na tarefa, a página de aprovação mostra o vídeo ou a
imagem direto para o cliente. Para isso o sistema precisa de um app do Dropbox, só de
leitura. Passo a passo em [Dropbox](dropbox.md); o resumo:

```bash
# depois de criar o app e gravar IDEWORKS_DROPBOX_APP_KEY e _APP_SECRET no .dev.vars:
node scripts/dropbox-autorizar.mjs     # abre a autorização e devolve o refresh token
npx wrangler secret put IDEWORKS_DROPBOX_APP_KEY
npx wrangler secret put IDEWORKS_DROPBOX_APP_SECRET
npx wrangler secret put IDEWORKS_DROPBOX_REFRESH_TOKEN
```

---

Anterior: [6. Personalizar com a sua marca](06-personalizar.md) ·
Próximo: [8. Problemas comuns](08-problemas-comuns.md)
