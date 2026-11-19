-- Server-only RPC authorization must use PostgreSQL EXECUTE privileges,
-- not JWT claims or request headers. Modern sb_secret_* keys do not expose
-- service_role claims to SQL functions.
begin;

do $migration$
declare
  r record;
  v_definition text;
  v_updated text;
  v_count integer := 0;
begin
  for r in
    select p.oid::regprocedure as signature,
           p.proname,
           pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'consume_lalamove_tracking_rate_limit',
        'service_apply_lalamove_webhook',
        'service_begin_lalamove_dispatch',
        'service_cancel_lalamove_dispatch',
        'service_fail_lalamove_dispatch',
        'service_finish_lalamove_dispatch',
        'service_get_lalamove_dispatch',
        'service_store_lalamove_quotes',
        'service_sync_lalamove_dispatch',
        'service_update_lalamove_tracking_status'
      )
    order by p.proname
  loop
    v_definition := r.definition;

    -- Remove only the obsolete in-function role/JWT guard. Authorization is
    -- enforced by the function ACL below; all business/admin checks remain.
    v_updated := regexp_replace(
      v_definition,
      E'\\s*if not feira_cost_private\\.is_lalamove_service_request\\(\\) then\\s*raise exception ''service role required'' using errcode\\s*=\\s*''42501'';\\s*end if;\\s*',
      E'\\n',
      'gi'
    );

    if v_updated = v_definition or position('is_lalamove_service_request' in v_updated) > 0 then
      raise exception 'Expected to remove exactly the obsolete service guard from %', r.signature;
    end if;

    execute v_updated;
    execute format('revoke all privileges on function %s from public, anon, authenticated', r.signature);
    execute format('grant execute on function %s to service_role', r.signature);
    v_count := v_count + 1;
  end loop;

  if v_count <> 10 then
    raise exception 'Expected 10 Lalamove server-only RPCs; updated %', v_count;
  end if;

  if to_regprocedure('feira_cost_private.is_lalamove_service_request()') is not null then
    drop function feira_cost_private.is_lalamove_service_request();
  end if;
end;
$migration$;

-- Fail the migration if any of the 10 RPCs remains callable by browser roles
-- or is not executable by the Edge Function's service_role database role.
do $verify$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'consume_lalamove_tracking_rate_limit',
        'service_apply_lalamove_webhook',
        'service_begin_lalamove_dispatch',
        'service_cancel_lalamove_dispatch',
        'service_fail_lalamove_dispatch',
        'service_finish_lalamove_dispatch',
        'service_get_lalamove_dispatch',
        'service_store_lalamove_quotes',
        'service_sync_lalamove_dispatch',
        'service_update_lalamove_tracking_status'
      )
  loop
    if not has_function_privilege('service_role', r.signature, 'EXECUTE')
       or has_function_privilege('anon', r.signature, 'EXECUTE')
       or has_function_privilege('authenticated', r.signature, 'EXECUTE') then
      raise exception 'Unexpected EXECUTE grants on %', r.signature;
    end if;
  end loop;
end;
$verify$;

commit;
