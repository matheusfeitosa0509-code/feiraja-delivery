-- Persist a manual Lalamove status refresh without fabricating a webhook event.
begin;
create or replace function public.service_sync_lalamove_dispatch(
 p_order_id text,p_status text,p_actual_cost numeric,p_tracking_url text,p_driver jsonb,p_event_at timestamptz
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_order_id text;
begin
 if coalesce(p_order_id,'')='' or p_status not in ('searching','assigned','enroute_pickup','picked_up','delivered','cancelled','rejected','expired')
   or p_actual_cost is null or p_actual_cost<0 or p_event_at is null then
  raise exception 'invalid dispatch refresh' using errcode='22023';
 end if;
 update feira_cost_private.lalamove_dispatches
 set lalamove_status=p_status,
     tracking_url=coalesce(nullif(p_tracking_url,''),tracking_url),
     driver=coalesce(p_driver,driver,'{}'::jsonb),
     event_updated_at=p_event_at,
     state=case when p_status in ('cancelled','rejected','expired') then 'cancelled' else state end,
     updated_at=now()
 where order_id=p_order_id and lalamove_order_id is not null
 returning order_id into v_order_id;
 if v_order_id is null then raise exception 'dispatch not found' using errcode='P0002'; end if;
 insert into feira_cost_private.order_delivery_costs(order_id,provider,actual_cost,currency,recorded_at,updated_at)
 values(p_order_id,'lalamove',round(p_actual_cost,2),'BRL',now(),now())
 on conflict(order_id) do update set provider='lalamove',actual_cost=excluded.actual_cost,currency='BRL',updated_at=now();
 update public.orders set
  lalamove_status=p_status,
  lalamove_tracking_url=coalesce(nullif(p_tracking_url,''),lalamove_tracking_url),
  lalamove_driver=coalesce(p_driver,lalamove_driver,'{}'::jsonb),
  lalamove_status_updated_at=p_event_at,
  status=case when p_status='delivered' then 'Entregue'
   when p_status in ('assigned','enroute_pickup','picked_up') then 'Saiu para Entrega'
   when p_status in ('cancelled','rejected','expired') and status='Saiu para Entrega' then 'Pronto para Retirada'
   else status end
 where id=p_order_id;
 return jsonb_build_object('refreshed',true,'status',p_status);
end;
$$;
revoke all on function public.service_sync_lalamove_dispatch(text,text,numeric,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.service_sync_lalamove_dispatch(text,text,numeric,text,jsonb,timestamptz) to service_role;
commit;
