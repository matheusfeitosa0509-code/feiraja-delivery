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


create or replace function public.service_update_lalamove_tracking_status(
  p_order_id text,
  p_lalamove_order_id text,
  p_status text,
  p_tracking_url text default null,
  p_driver jsonb default null
) returns jsonb
language plpgsql security definer set search_path=''
as $
declare v_order_id text;
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;
  if p_order_id is null or p_lalamove_order_id is null or p_status is null
     or p_status not in ('searching','assigned','enroute_pickup','picked_up','delivered','cancelled','rejected','expired') then
    raise exception 'invalid Lalamove tracking update' using errcode='22023';
  end if;

  update feira_cost_private.lalamove_dispatches
  set lalamove_status = p_status,
      state = case
        when p_status in ('cancelled','rejected','expired') then 'cancelled'
        else state
      end,
      tracking_url = coalesce(nullif(p_tracking_url,''), tracking_url),
      driver = coalesce(p_driver, driver),
      updated_at = now()
  where order_id = p_order_id
    and lalamove_order_id = p_lalamove_order_id
  returning order_id into v_order_id;

  if v_order_id is null then
    return jsonb_build_object('ignored', true, 'stale_attempt', true);
  end if;

  update public.orders
  set lalamove_status = p_status,
      lalamove_tracking_url = coalesce(nullif(p_tracking_url,''), lalamove_tracking_url),
      lalamove_driver = coalesce(p_driver, lalamove_driver),
      lalamove_status_updated_at = now(),
      status = case
        when p_status = 'delivered' then 'Entregue'
        when p_status in ('assigned','enroute_pickup','picked_up') then 'Saiu para Entrega'
        when p_status in ('cancelled','rejected','expired') and status = 'Saiu para Entrega' then 'Pronto para Retirada'
        else status
      end
  where id = p_order_id
    and status not in ('Cancelada','Reembolsado','Contestado','Pagamento cancelado','Pagamento recusado');

  return jsonb_build_object('updated', true, 'status', p_status);
end;
$;

revoke all on function public.service_update_lalamove_tracking_status(text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.service_update_lalamove_tracking_status(text,text,text,text,jsonb) to service_role;

commit;
