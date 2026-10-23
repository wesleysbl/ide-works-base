# 6. Personalizar com a sua marca

O IdeWorks vem com a marca e os textos da Agência Ide. Estes são os arquivos para trocar.
Depois de mexer, rode `npm test`: alguns testes conferem textos e tamanhos de arquivo, e
avisam se algo ficou pela metade (ajuste o teste junto quando a mudança for de propósito).

## Endereços da instalação

[`src/config/instalacao.ts`](../../src/config/instalacao.ts) junta o que muda de uma
empresa para outra:

| Campo | O que é |
|---|---|
| `enderecoPublicado` | O endereço do seu sistema (ex.: `https://works.suaempresa.com.br`). Usado nas instruções de conexão dos agentes de IA |
| `enderecoDoPonto` | O link "Já bateu seu ponto hoje?" do menu da conta, para um sistema de ponto que use as mesmas contas. `null` esconde o item |

## Logo

| Arquivo | Onde aparece | Regras |
|---|---|---|
| `public/ideworks-marca.png` | Barra lateral e tela de entrada | PNG com fundo **transparente**, até 32 KB. A cor vem do tema (ele é usado como máscara), então desenhe em preto |
| `public/favicon.svg` | Aba do navegador | SVG |
| `public/icone-192.png`, `public/icone-512.png` | Ícone ao instalar no celular | 192×192 e 512×512 |
| `public/apple-touch-icon.png` | Ícone no iPhone | 180×180 |
| `public/manifest.webmanifest` | Nome do app instalado | Troque `name`, `short_name` e `description` |
| `docs/imagens/ideworks-marca-original.png` | Arte original da marca, fora do pacote | Só referência |

Nada em `public/` pode passar de 300 KB (um teste confere): é tudo baixado pelo navegador.

## Cores

O design system se chama **OBSIDIAN** e todas as cores moram em variáveis em
[`src/ui/obsidian.css`](../../src/ui/obsidian.css). Nenhuma tela usa cor escrita direto:
trocar uma variável muda o sistema inteiro, nos temas claro e escuro. Um teste confere o
contraste mínimo de leitura.

## Nome e textos

| Onde | Arquivo |
|---|---|
| Nome na aba do navegador | `index.html` (`<title>`) e `src/ui/titulo-do-documento.ts` (`NOME_DO_SISTEMA`) |
| Rodapé da tela de entrada ("Grupo Ide · acesso exclusivo por convite") | `src/ui/primitivos.tsx` |
| Mensagem do convite que você copia para o WhatsApp | `src/auth/invitation-message.ts` |
| Página de aprovação do cliente (marca, assinatura, "fale com o atendimento") | `src/aprovacao/PaginaDoCliente.tsx` |

## Recursos que dá para ligar e desligar sem mexer no código

No `wrangler.toml`, em `[vars]`:

| Variável | Para quê |
|---|---|
| `IDEWORKS_CHAT` | `ligado`, `piloto` (só super admin) ou `desligado` |
| `IDEWORKS_INTEGRATIONS_ENABLED` | `false` desliga os agentes de IA |
| `IDEWORKS_INTEGRATION_WRITES_ENABLED` | `false` deixa os agentes só lerem |
| `IDEWORKS_EMPRESAS_OMITIDAS` | Esconde das telas tudo de uma unidade de negócio, sem apagar |
| `IDEWORKS_TRUSTED_IMAGE_HOSTS` | Servidores de imagem seus (ex.: um Nextcloud) que ganham miniatura nos links |

Depois de mudar o `wrangler.toml`: `npm run build && npx wrangler deploy`.

## Gerar as capturas de tela de novo

Mudou o visual e quer a documentação em dia? Com o site rodando (`npm run dev`):

```bash
npm i -g playwright-core
node scripts/capturar-telas.mjs
```

As imagens saem em `docs/imagens/telas/`, sempre com dados fictícios: o script abre o
sistema contra um servidor falso, sem tocar em banco nenhum. Fora do Mac, informe o Chrome:
`CHROME_EXECUTABLE=/caminho/do/chrome node scripts/capturar-telas.mjs`.

---

Anterior: [5. Publicar na Cloudflare](05-publicar-na-cloudflare.md) ·
Próximo: [7. Integrações](07-integracoes.md)
