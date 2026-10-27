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
