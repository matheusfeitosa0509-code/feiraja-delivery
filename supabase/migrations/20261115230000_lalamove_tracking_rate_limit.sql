-- Private, per-user rate limit for customer/admin driver tracking polls.
begin;

create table if not exists feira_cost_private.lalamove_tracking_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0)
);
revoke all on feira_cost_private.lalamove_tracking_rate_limits from public, anon, authenticated;

create or replace function public.consume_lalamove_tracking_rate_limit(
  p_user_id uuid, p_max_requests integer default 30, p_window_seconds integer default 60
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_count integer;
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;
  if p_user_id is null or p_max_requests < 1 or p_max_requests > 120
     or p_window_seconds < 1 or p_window_seconds > 3600 then
    raise exception 'invalid tracking rate limit' using errcode='22023';
  end if;
  insert into feira_cost_private.lalamove_tracking_rate_limits(user_id, window_started_at, request_count)
  values (p_user_id, now(), 1)
  on conflict (user_id) do update set
    window_started_at = case
      when feira_cost_private.lalamove_tracking_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
      then now() else feira_cost_private.lalamove_tracking_rate_limits.window_started_at end,
    request_count = case
      when feira_cost_private.lalamove_tracking_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
      then 1 else feira_cost_private.lalamove_tracking_rate_limits.request_count + 1 end
  returning request_count into v_count;
  return v_count <= p_max_requests;
end;
$$;

revoke all on function public.consume_lalamove_tracking_rate_limit(uuid,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_lalamove_tracking_rate_limit(uuid,integer,integer) to service_role;

commit;
