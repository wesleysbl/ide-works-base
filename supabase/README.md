# Banco do IdeWorks

## Como fica um projeto do Supabase com o IdeWorks

```
ideworks.*   ->  IdeWorks (tabelas, funções, políticas de linha)
auth.*       ->  Supabase Auth (contas e senhas)
storage.*    ->  Supabase Storage (baldes `ideworks-anexos` e `client-history-documents`, privados)
```

O servidor nunca usa a conta de administração do banco. Ele entra como **`ideworks_app`**,
um papel criado pela migration `f0_2b_restricted_role` que só alcança o schema `ideworks`.
Quem vê o quê é decidido pelas políticas de linha (RLS), a partir de variáveis de sessão
que o servidor declara a cada pedido (`app.user_id`, `app.is_superadmin`...).

## Instalar num projeto novo

O passo a passo está em [`docs/tutoriais/02-configurar-o-supabase.md`](../docs/tutoriais/02-configurar-o-supabase.md).
Em resumo:

1. `npx supabase link --project-ref SEU-PROJETO`
2. `npx supabase db push`: aplica as migrations de `migrations/`, em ordem.
3. Rodar [`primeiro-acesso.sql`](primeiro-acesso.sql) no SQL Editor (senha do papel
   restrito, primeira empresa, você como super admin).

As 125 migrations foram testadas aplicando do zero num Postgres limpo. As que copiavam
dados de um sistema anterior conferem se as tabelas dele existem e, numa instalação
nova, não fazem nada.

## Convenção de nomes

```
supabase/migrations/<versao>_ideworks_<fase>_<intencao>.sql
supabase/rollback/<versao>_ideworks_<fase>_<intencao>.sql
```

- **Prefixo `ideworks_` obrigatório**, e o nome diz a fase e a intenção.
- **Versão = carimbo de tempo UTC** no formato `AAAAMMDDHHMMSS`.
- Toda migration tem irmã em `rollback/`, com o mesmo nome, que a desfaz de forma
  cirúrgica (nomeando o schema em cada linha).

## Conferência de schema

```
node scripts/conferir-schema.mjs            # compara o banco real com o retrato
node scripts/conferir-schema.mjs --gravar   # regrava o retrato depois de migration nova
```

Compara o estado real de `ideworks` com `schema-esperado.json`: colunas, tipos,
restrições, índices, **expressões** das políticas, funções (com o corpo), gatilhos e
views. Comparar só nomes não basta: trocar o corpo de uma política mantém o nome.
O `--gravar` aceita qualquer estado, então **confira o diff antes de commitar**.
