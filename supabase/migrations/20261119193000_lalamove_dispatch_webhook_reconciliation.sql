-- Reconcile Lalamove order IDs on the public order row and apply the V3
-- delivery-status labels consistently for webhook-driven updates.
begin;

create or replace function public.service_finish_lalamove_dispatch(
 p_order_id text,p_lalamove_order_id text,p_actual_cost numeric,p_status text,p_tracking_url text,p_driver jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_updated integer;
begin
 if coalesce(p_order_id,'')='' or coalesce(p_lalamove_order_id,'')='' or p_actual_cost is null or p_actual_cost<0 then
  raise exception 'invalid dispatch result' using errcode='22023';
 end if;
 update feira_cost_private.lalamove_dispatches set state='created',lalamove_order_id=p_lalamove_order_id,
  lalamove_status=coalesce(p_status,'searching'),tracking_url=nullif(p_tracking_url,''),
  driver=coalesce(p_driver,'{}'::jsonb),event_updated_at=case when p_status='assigned' then now() else null end,
  updated_at=now(),last_error_code=null
 where order_id=p_order_id and state='creating' and lalamove_order_id is null;
 get diagnostics v_updated = row_count;
 if v_updated=0 then
  if exists(select 1 from feira_cost_private.lalamove_dispatches where order_id=p_order_id and lalamove_order_id=p_lalamove_order_id) then
   return jsonb_build_object('created',true,'duplicate',true);
  end if;
  raise exception 'dispatch state conflict' using errcode='55000';
 end if;
 insert into feira_cost_private.order_delivery_costs(order_id,actual_cost,updated_at)
 values(p_order_id,round(p_actual_cost,2),now())
 on conflict(order_id) do update set actual_cost=excluded.actual_cost,updated_at=now();
 update public.orders set lalamove_order_id=p_lalamove_order_id,
  lalamove_status=coalesce(p_status,'searching'),
  lalamove_tracking_url=nullif(p_tracking_url,''),lalamove_driver=coalesce(p_driver,'{}'::jsonb),
  delivery_vehicle=(select d.selected_vehicle from feira_cost_private.lalamove_dispatches d where d.order_id=p_order_id),
  lalamove_status_updated_at=case when p_status='assigned' then now() else null end,
  status=case when p_status='delivered' then 'Entregue'
   when p_status in ('assigned','enroute_pickup') then 'Entregador a caminho da feira'
   when p_status='picked_up' then 'Saiu para entrega'
   else status end
 where id=p_order_id;
 return jsonb_build_object('created',true,'duplicate',false,'lalamove_order_id',p_lalamove_order_id);
end;
$$;

create or replace function public.service_apply_lalamove_webhook(
 p_event_id text,p_event_type text,p_event_at timestamptz,p_lalamove_order_id text,
 p_status text,p_tracking_url text,p_driver jsonb,p_ambiente text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_order_id text; v_existing_at timestamptz; v_inserted integer;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
  raise exception 'service role required' using errcode='42501';
 end if;
 if p_ambiente is null or p_ambiente not in ('sandbox','producao') or coalesce(p_event_id,'')='' or
  coalesce(p_lalamove_order_id,'')='' or p_event_at is null then
  raise exception 'invalid webhook event' using errcode='22023';
 end if;
 select d.order_id into v_order_id from feira_cost_private.lalamove_dispatches d
 where d.lalamove_order_id=p_lalamove_order_id and d.ambiente=p_ambiente for update;
 if v_order_id is null then return jsonb_build_object('applied',false,'unknown_order',true); end if;
 insert into feira_cost_private.lalamove_webhook_events(event_id,order_id,event_type,event_at)
 values(p_event_id,v_order_id,left(coalesce(p_event_type,'UNKNOWN'),80),p_event_at)
 on conflict(event_id) do nothing;
 get diagnostics v_inserted=row_count;
 if v_inserted=0 then return jsonb_build_object('applied',false,'duplicate',true); end if;
 select o.lalamove_status_updated_at into v_existing_at from public.orders o where o.id=v_order_id for update;
 if v_existing_at is not null and p_event_at<v_existing_at then
  update feira_cost_private.lalamove_dispatches set tracking_url=coalesce(nullif(p_tracking_url,''),tracking_url),
   driver=coalesce(p_driver,driver,'{}'::jsonb),updated_at=now() where order_id=v_order_id;
  update public.orders set lalamove_order_id=p_lalamove_order_id,
   lalamove_tracking_url=coalesce(nullif(p_tracking_url,''),lalamove_tracking_url),
   lalamove_driver=coalesce(p_driver,lalamove_driver,'{}'::jsonb) where id=v_order_id;
  return jsonb_build_object('applied',false,'out_of_order',true);
 end if;
 update feira_cost_private.lalamove_dispatches set lalamove_status=p_status,
  tracking_url=coalesce(nullif(p_tracking_url,''),tracking_url),driver=coalesce(p_driver,driver,'{}'::jsonb),
  event_updated_at=p_event_at,updated_at=now() where order_id=v_order_id;
 update public.orders set lalamove_order_id=p_lalamove_order_id,lalamove_status=p_status,
  lalamove_tracking_url=coalesce(nullif(p_tracking_url,''),lalamove_tracking_url),
  lalamove_driver=coalesce(p_driver,lalamove_driver,'{}'::jsonb),lalamove_status_updated_at=p_event_at,
  status=case
   when p_status='delivered' then 'Entregue'
   when p_status in ('assigned','enroute_pickup') then 'Entregador a caminho da feira'
   when p_status='picked_up' then 'Saiu para entrega'
   when p_status in ('cancelled','rejected','expired')
     and status not in ('Entregue','Cancelada','Reembolsado','Contestado','Pagamento cancelado','Pagamento recusado')
     then 'Pronto para envio'
   else status end
 where id=v_order_id;
 return jsonb_build_object(
  'applied',true,'order_id',v_order_id,'ambiente',p_ambiente,
  'admin_alert',case when p_status in ('cancelled','rejected','expired')
    then 'Nenhum motorista aceitou – chamar de novo' else null end
 );
end;
$$;

commit;
