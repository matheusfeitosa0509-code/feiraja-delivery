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

A migration `20261105000300_restrict_public_default_privileges.sql` limita os privilégios padrão de tabelas, funções e sequências futuras criadas por `postgres` e `supabase_admin` em `public`, retirando concessões padrão explícitas de `anon` e `authenticated`. Ela deliberadamente não remove o `EXECUTE` implícito de `PUBLIC`; a convenção acima trata esse caso função por função. Os privilégios de `service_role` e do proprietário não são revogados.

## Roteiro SQL de validação — NÃO EXECUTADO

**Objetivo:** validar os privilégios padrão para objetos novos criados por `postgres` e `supabase_admin`, sem alterar as quatro tabelas atuais. Execute preferencialmente em um projeto Supabase descartável. Se não houver projeto descartável, o roteiro inteiro pode ser executado em uma única sessão/transação, desde que termine obrigatoriamente com `ROLLBACK`.

**Pré-condições e cuidados:**
- Conectar como `postgres` (ou uma sessão com permissão para executar `SET ROLE` para `postgres` e `supabase_admin`).
- Se qualquer `SET LOCAL ROLE` falhar, interromper o roteiro; não tentar contornar permissões.
- Não executar `COMMIT`. Não dividir o roteiro entre sessões.
- Os nomes `__acl_probe_*` são temporários e devem estar livres. Se já existirem, escolher outros nomes em todas as instruções.
- O teste cria objetos somente dentro da transação. O `ROLLBACK` final desfaz objetos e alterações temporárias de default privileges.
- O roteiro não chama funções de negócio, não acessa checkout e não cria pedidos ou pagamentos.

### 1. Iniciar a transação e aplicar os seis REVOKEs em escopo de teste

```sql
BEGIN;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
```

### 2. Criar tabela, sequência e duas funções como postgres

A primeira função fica com o EXECUTE padrão de `PUBLIC`, para demonstrar o comportamento que permanece. A segunda recebe a revogação por função e concede EXECUTE somente a `service_role`.

```sql
SET LOCAL ROLE postgres;

CREATE TABLE public.__acl_probe_postgres_table (id integer);
CREATE SEQUENCE public.__acl_probe_postgres_seq;

CREATE FUNCTION public.__acl_probe_postgres_fn_public()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 101 $$;

CREATE FUNCTION public.__acl_probe_postgres_fn_restricted()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 102 $$;

REVOKE EXECUTE ON FUNCTION public.__acl_probe_postgres_fn_restricted()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.__acl_probe_postgres_fn_restricted()
  TO service_role;

RESET ROLE;
```

### 3. Criar tabela, sequência e duas funções como supabase_admin

```sql
SET LOCAL ROLE supabase_admin;

CREATE TABLE public.__acl_probe_supabase_admin_table (id integer);
CREATE SEQUENCE public.__acl_probe_supabase_admin_seq;

CREATE FUNCTION public.__acl_probe_supabase_admin_fn_public()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 201 $$;

CREATE FUNCTION public.__acl_probe_supabase_admin_fn_restricted()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 202 $$;

REVOKE EXECUTE ON FUNCTION public.__acl_probe_supabase_admin_fn_restricted()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.__acl_probe_supabase_admin_fn_restricted()
  TO service_role;

RESET ROLE;
```

### 4. Conferir privilégios de tabelas e sequências

Resultado esperado para cada uma das duas tabelas e duas sequências:
- `anon` e `authenticated`: sem privilégios diretos de tabela/sequence provenientes dos defaults testados.
- `service_role`: mantém os privilégios padrão que já estavam concedidos.
- Proprietário (`postgres` ou `supabase_admin`): mantém os privilégios inerentes ao proprietário.

```sql
SELECT
  object_name,
  object_type,
  has_table_privilege('anon', object_name, 'SELECT') AS anon_select,
  has_table_privilege('authenticated', object_name, 'SELECT') AS authenticated_select,
  has_table_privilege('service_role', object_name, 'SELECT') AS service_role_select,
  has_table_privilege(owner_name, object_name, 'SELECT') AS owner_select,
  owner_name
FROM (
  SELECT 'public.__acl_probe_postgres_table'::text AS object_name,
         'table'::text AS object_type, 'postgres'::text AS owner_name
  UNION ALL
  SELECT 'public.__acl_probe_supabase_admin_table',
         'table', 'supabase_admin'
) t;

SELECT
  object_name,
  has_sequence_privilege('anon', object_name, 'USAGE') AS anon_usage,
  has_sequence_privilege('authenticated', object_name, 'USAGE') AS authenticated_usage,
  has_sequence_privilege('service_role', object_name, 'USAGE') AS service_role_usage,
  has_sequence_privilege(owner_name, object_name, 'USAGE') AS owner_usage,
  owner_name
FROM (
  SELECT 'public.__acl_probe_postgres_seq'::text AS object_name,
         'postgres'::text AS owner_name
  UNION ALL
  SELECT 'public.__acl_probe_supabase_admin_seq',
         'supabase_admin'
) s;
```

### 5. Conferir funções: PUBLIC padrão versus revogação por função

Esperado nas funções `*_fn_public`: `anon` e `authenticated` ainda terão EXECUTE herdado de `PUBLIC`. Nas funções `*_fn_restricted`, ambos devem ficar sem EXECUTE; `service_role` e o proprietário devem manter EXECUTE.

```sql
SELECT
  function_name,
  has_function_privilege('anon', function_name, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', function_name, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', function_name, 'EXECUTE') AS service_role_execute,
  has_function_privilege(owner_name, function_name, 'EXECUTE') AS owner_execute,
  owner_name
FROM (
  SELECT 'public.__acl_probe_postgres_fn_public()'::text AS function_name,
         'postgres'::text AS owner_name
  UNION ALL
  SELECT 'public.__acl_probe_postgres_fn_restricted()', 'postgres'
  UNION ALL
  SELECT 'public.__acl_probe_supabase_admin_fn_public()', 'supabase_admin'
  UNION ALL
  SELECT 'public.__acl_probe_supabase_admin_fn_restricted()', 'supabase_admin'
) f
ORDER BY function_name;
```

### 6. Conferir que as quatro tabelas atuais preservam grants, RLS e políticas

Esta etapa é somente leitura. A migration de default privileges não deve modificar grants nem políticas de objetos já existentes.

```sql
-- Grants atuais de anon, authenticated, service_role e proprietários.
SELECT table_name, grantee, privilege_type, is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('admin_users', 'customer_profiles', 'orders', 'products')
  AND grantee IN ('anon', 'authenticated', 'service_role', 'postgres', 'supabase_admin')
ORDER BY table_name, grantee, privilege_type;

-- Estado de RLS e quantidade de políticas por tabela.
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  count(p.policyname) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policies p
  ON p.schemaname = n.nspname AND p.tablename = c.relname
WHERE n.nspname = 'public'
  AND c.relname IN ('admin_users', 'customer_profiles', 'orders', 'products')
GROUP BY c.relname, c.relrowsecurity
ORDER BY c.relname;

-- Definição das políticas atuais.
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('admin_users', 'customer_profiles', 'orders', 'products')
ORDER BY tablename, policyname;
```

Na consulta de referência realizada durante esta revisão, as contagens eram: `admin_users` = 1 política; `customer_profiles` = 3; `orders` = 2; `products` = 5. RLS estava habilitada nas quatro. Os grants observados incluíam `authenticated SELECT` em `admin_users`, `customer_profiles` e `orders`; `anon SELECT` em `products`; grants de leitura/alteração para `authenticated` em `products`; e privilégios para `service_role` nas quatro tabelas. Compare os resultados do seu ambiente com o snapshot atual antes de concluir.

### 7. Encerrar obrigatoriamente com ROLLBACK

```sql
ROLLBACK;
```

Depois do `ROLLBACK`, os objetos `__acl_probe_*` e as alterações de default privileges desta transação não devem existir. Este roteiro é uma proposta de validação e **não foi executado** nesta PR.
