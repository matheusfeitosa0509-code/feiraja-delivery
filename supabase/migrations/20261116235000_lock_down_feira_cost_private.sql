-- Fecha completamente o acesso direto ao schema privado de custos.
-- Leitura e escrita ficam via service_role e RPCs SECURITY DEFINER com autorização.
begin;

do $$
declare
  t record;
  p record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='feira_cost_private' and c.relkind in ('r','p')
  loop
    execute format('alter table feira_cost_private.%I enable row level security',t.relname);
    for p in
      select policyname from pg_policies
      where schemaname='feira_cost_private' and tablename=t.relname
    loop
      execute format('drop policy %I on feira_cost_private.%I',p.policyname,t.relname);
    end loop;
  end loop;
end;
$$;

revoke all on schema feira_cost_private from public, anon, authenticated;
grant usage on schema feira_cost_private to service_role;

revoke all on all tables in schema feira_cost_private from public, anon, authenticated;
grant all on all tables in schema feira_cost_private to service_role;

revoke all on all sequences in schema feira_cost_private from public, anon, authenticated;
grant all on all sequences in schema feira_cost_private to service_role;

-- Keep future objects in this private schema closed by default.
alter default privileges for role postgres in schema feira_cost_private
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema feira_cost_private
  grant all on tables to service_role;
alter default privileges for role postgres in schema feira_cost_private
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema feira_cost_private
  grant all on sequences to service_role;

commit;
