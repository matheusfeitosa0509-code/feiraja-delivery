-- Allow server-side Edge Functions authenticated with modern Supabase sb_secret_* keys
-- while preserving the legacy service_role JWT path. No application data is modified.
begin;

create or replace function feira_cost_private.is_lalamove_service_request()
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_role text;
  v_headers jsonb;
  v_apikey text;
begin
  v_role := current_setting('request.jwt.claim.role', true);
  if v_role = 'service_role' then
    return true;
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;

  v_apikey := coalesce(v_headers ->> 'apikey', v_headers ->> 'ApiKey', '');
  return left(v_apikey, 10) = 'sb_secret_';
end;
$function$;

revoke all on function feira_cost_private.is_lalamove_service_request() from public, anon, authenticated;

do $migration$
declare
  r record;
  v_definition text;
  v_updated text;
  v_guard text := E'\n  if not feira_cost_private.is_lalamove_service_request() then\n    raise exception ''service role required'' using errcode = ''42501'';\n  end if;\n';
  v_count integer := 0;
begin
  for r in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as definition
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
    v_definition := r.definition;

    -- Replace the previous JWT-only check with the shared legacy-JWT / secret-key check.
    v_updated := regexp_replace(
      v_definition,
      'if current_setting\(''request\.jwt\.claim\.role'',\s*true\) is distinct from ''service_role'' then',
      'if not feira_cost_private.is_lalamove_service_request() then',
      'gi'
    );

    -- Add the same guard to service RPCs that previously had no authorization check.
    if position('service role required' in v_updated) = 0 then
      if r.proname <> 'consume_lalamove_tracking_rate_limit' then
        v_updated := regexp_replace(
          v_updated,
          '(AS \$function\$.*?\mBEGIN\M)',
          E'\1' || v_guard,
          'is'
        );
      end if;
    end if;

    if v_updated = v_definition then
      raise exception 'Could not safely update authorization guard for %', r.proname;
    end if;

    execute v_updated;
    v_count := v_count + 1;
  end loop;

  if v_count <> 10 then
    raise exception 'Expected 10 Lalamove RPCs to be secured; updated %', v_count;
  end if;
end;
$migration$;

commit;
