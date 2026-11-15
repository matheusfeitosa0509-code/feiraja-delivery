-- Rate limit persistente e atomico por usuario para delivery-quote.
begin;
create table if not exists public.delivery_quote_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0)
);
alter table public.delivery_quote_rate_limits enable row level security;
revoke all on public.delivery_quote_rate_limits from public, anon, authenticated;
create or replace function public.consume_delivery_quote_rate_limit(
  p_user_id uuid, p_max_requests integer default 5, p_window_seconds integer default 60
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_allowed boolean;
begin
  if p_user_id is null or p_max_requests < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit arguments' using errcode='22023';
  end if;
  insert into public.delivery_quote_rate_limits(user_id,window_started_at,request_count)
  values(p_user_id,now(),1)
  on conflict(user_id) do update set
    window_started_at = case
      when public.delivery_quote_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
      then now() else public.delivery_quote_rate_limits.window_started_at end,
    request_count = case
      when public.delivery_quote_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
      then 1 else public.delivery_quote_rate_limits.request_count + 1 end;
  select request_count <= p_max_requests into v_allowed
  from public.delivery_quote_rate_limits where user_id=p_user_id;
  return coalesce(v_allowed,false);
end;
$$;
revoke all on function public.consume_delivery_quote_rate_limit(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_delivery_quote_rate_limit(uuid,integer,integer) to service_role;
commit;
