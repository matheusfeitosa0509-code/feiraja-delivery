-- Testes de segurança para feira_cost_private. Executar após a migração.
do $$
declare
  t record;
  seq record;
  v_count integer;
  v_def text;
  v_body text;
begin
  select count(*) into v_count
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='feira_cost_private' and c.relkind in ('r','p');
  if v_count <> 8 then
    raise exception 'Esperadas 8 tabelas em feira_cost_private; encontradas %',v_count;
  end if;

  if not has_schema_privilege('service_role','feira_cost_private','USAGE') then
    raise exception 'service_role sem USAGE no schema privado';
  end if;
  if has_schema_privilege('anon','feira_cost_private','USAGE')
     or has_schema_privilege('authenticated','feira_cost_private','USAGE') then
    raise exception 'anon/authenticated ainda possuem USAGE no schema privado';
  end if;

  for t in
    select c.oid,c.relname,c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='feira_cost_private' and c.relkind in ('r','p')
  loop
    if not t.relrowsecurity then
      raise exception 'RLS desativado em %',t.relname;
    end if;
    if exists(select 1 from pg_policies p where p.schemaname='feira_cost_private' and p.tablename=t.relname) then
      raise exception 'Política residual em %',t.relname;
    end if;
    if has_table_privilege('anon',t.oid,'SELECT')
       or has_table_privilege('authenticated',t.oid,'SELECT') then
      raise exception 'Leitura direta ainda concedida a anon/authenticated em %',t.relname;
    end if;
    if has_table_privilege('service_role',t.oid,'SELECT') is false
       or has_table_privilege('service_role',t.oid,'INSERT') is false
       or has_table_privilege('service_role',t.oid,'UPDATE') is false
       or has_table_privilege('service_role',t.oid,'DELETE') is false then
      raise exception 'service_role sem acesso completo em %',t.relname;
    end if;
  end loop;

  for seq in
    select c.oid,c.relname
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='feira_cost_private' and c.relkind='S'
  loop
    if has_sequence_privilege('anon',seq.oid,'USAGE')
       or has_sequence_privilege('authenticated',seq.oid,'USAGE') then
      raise exception 'anon/authenticated ainda possuem acesso à sequence %',seq.relname;
    end if;
    if not has_sequence_privilege('service_role',seq.oid,'USAGE') then
      raise exception 'service_role sem USAGE na sequence %',seq.relname;
    end if;
  end loop;

  -- As RPCs administrativas continuam executáveis por authenticated, mas exigem admin.
  foreach v_def in array array[
    'public.admin_get_cost_report(timestamptz,timestamptz)',
    'public.admin_get_cost_report_with_delivery(timestamptz,timestamptz)',
    'public.admin_set_lalamove_actual_cost(text,numeric)'
  ] loop
    if not has_function_privilege('authenticated',v_def,'EXECUTE') then
      raise exception 'RPC administrativa indisponível para o painel: %',v_def;
    end if;
    if has_function_privilege('anon',v_def,'EXECUTE') then
      raise exception 'RPC administrativa executável por anon: %',v_def;
    end if;
    select pg_get_functiondef(v_def::regprocedure) into v_body;
    if position('is_current_user_admin' in lower(v_body))=0 then
      raise exception 'RPC sem verificação de administrador: %',v_def;
    end if;
  end loop;

  -- RPCs internas Lalamove seguem restritas a service_role.
  foreach v_def in array array[
    'public.service_store_lalamove_quotes(text,uuid,jsonb,jsonb,numeric,numeric,timestamptz,timestamptz,text)',
    'public.service_begin_lalamove_dispatch(text,uuid,text,text)',
    'public.service_finish_lalamove_dispatch(text,text,numeric,text,text,jsonb)',
    'public.service_apply_lalamove_webhook(text,text,timestamptz,text,text,text,jsonb,text)'
  ] loop
    if not has_function_privilege('service_role',v_def,'EXECUTE') then
      raise exception 'RPC interna sem EXECUTE para service_role: %',v_def;
    end if;
    if has_function_privilege('anon',v_def,'EXECUTE')
       or has_function_privilege('authenticated',v_def,'EXECUTE') then
      raise exception 'RPC interna acessível a anon/authenticated: %',v_def;
    end if;
  end loop;
end;
$$;
