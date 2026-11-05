# Histórico de migrations aplicadas

A lista abaixo foi consultada no projeto Supabase em 2026-10-27. As migrations anteriores já estavam aplicadas antes desta auditoria, mas seus arquivos SQL originais não estavam no repositório, então não foram recriados por suposição.

- `20261027054936 secure_products_orders_feiraja`
- `20261027082017 enable_feiraja_storefront_and_orders`
- `20261027170005 harden_rls_policies_and_optimize_auth_checks`
- `20261027172518 harden_feiraja_rls_policies_oct2026`
- `20261027183845 restrict_direct_order_writes_oct2026`
- `20261027210843 restrict_order_status_updates`
- `20261027212711 admin_roles_and_order_statuses` — migration criada nesta auditoria e aplicada em produção.
- `20261027224500 restrict_admin_users_privileges` — migration criada e aplicada em produção para revogar privilégios diretos de `anon` e `authenticated` em `public.admin_users` e conceder somente `SELECT` a `authenticated`.
- `20261027230000 customer_profiles_cpf_nullable` — migration criada e aplicada em produção para permitir `NULL` na coluna `public.customer_profiles.cpf`.

O estado atual das políticas RLS está documentado em `../policies/current_rls_snapshot.sql`. O snapshot é documentação, não uma migration executável.

## Convenção obrigatória para novas funções PostgreSQL

O PostgreSQL concede `EXECUTE` a `PUBLIC` por padrão em funções novas. Como `anon` e `authenticated` herdam esse privilégio por meio de `PUBLIC`, revogar somente esses dois papéis nos privilégios padrão do schema não elimina o acesso implícito.

Por isso, toda migration futura que criar uma função deve, na própria migration e logo após o `CREATE FUNCTION`, executar uma revogação explícita e conceder execução somente aos papéis que realmente precisam chamar a função:

```sql
REVOKE EXECUTE ON FUNCTION public.nome_da_funcao(tipo_arg1, tipo_arg2)
FROM PUBLIC, anon, authenticated;

-- Exemplo: conceder somente ao papel realmente autorizado.
GRANT EXECUTE ON FUNCTION public.nome_da_funcao(tipo_arg1, tipo_arg2)
TO service_role;
```

Substitua o nome, a assinatura e o papel do exemplo pelos valores reais. Se nenhum papel adicional precisar executar a função, não inclua um `GRANT` amplo. Não use `GRANT EXECUTE` para `PUBLIC`, `anon` ou `authenticated` sem uma justificativa explícita e revisão de segurança. A revogação deve citar a assinatura completa para atingir a função correta, inclusive em caso de sobrecarga.

A migration `20261105000300_restrict_public_default_privileges.sql` limita os privilégios padrão de tabelas, funções e sequências futuras criadas por `postgres` e `supabase_admin` em `public`, retirando concessões padrão de `anon` e `authenticated`. Ela deliberadamente não tenta remover o `EXECUTE` implícito de `PUBLIC`; a convenção acima trata esse caso função por função. Os privilégios de `service_role` e do proprietário não são revogados.
