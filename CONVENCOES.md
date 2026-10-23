# Convenções do IdeWorks

## Idioma

| Camada | Idioma | Exemplo |
|---|---|---|
| Schema do banco | **inglês** | `profiles.is_superadmin`, `invitations.expires_at` |
| Código (tipos, funções, variáveis) | **inglês**, com bastante português onde é regra de negócio | `deliveryLevel`, `quadroDaPasta` |
| Interface visível | **português** | "Nível de entrega", "Convidar pessoa" |
| Comentários e documentação | **português** | este arquivo |

A tradução mora só na camada de tela. Os nomes que chegam de fora (`reach`, `views`,
`spend`, da Meta) ficam como vêm.

## Banco

Tudo do IdeWorks vive no schema **`ideworks`**. O servidor fala com o banco pelo papel
restrito `ideworks_app`, que só alcança esse schema. O schema `auth` é do Supabase: o
IdeWorks nunca apaga usuário (convite mal dado se corrige tirando papel e alcance).

> **Uma nota de origem.** O IdeWorks nasceu dentro de um projeto do Supabase que já tinha
> outro sistema, no schema `public`. Por isso muitos comentários falam em "legado",
> "Sistema IDE" ou "não tocar em `public`". Numa instalação nova não existe legado, mas a
> regra continua boa: o sistema inteiro mora em `ideworks`.

## Migrations

- Ficam em `supabase/migrations/`, nomeadas por fase e intenção, com prefixo `ideworks_`:
  `AAAAMMDDHHMMSS_ideworks_f45_instalacao_limpa.sql`.
- Toda migration tem uma irmã em `supabase/rollback/`, com o mesmo nome, que a desfaz.
  Um teste falha se faltar o par.
- Toda migration que cria tabela liga segurança por linha (RLS) na mesma migration.
  Também há teste para isso.
- Depois de uma migration nova, regrave o retrato do schema:
  `node scripts/conferir-schema.mjs --gravar` (e confira o diff antes de commitar).

## Cor e tela

O design system se chama **OBSIDIAN** e mora em `src/ui/obsidian.css`. Nenhuma tela usa
cor literal: a paleta do Tailwind foi trocada por ponteiros para os tokens, e trocar o
espectro é editar um arquivo.

## Testes

`npm test` roda a suíte inteira (mais de 6.700 testes) sem rede e sem banco: os testes de
banco usam o PGlite, um Postgres que roda em memória. Um teste de rede (`test/setup`)
derruba qualquer chamada que tente sair da máquina.
