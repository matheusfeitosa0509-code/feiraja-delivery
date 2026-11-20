-- Store the customer-confirmed delivery pin and preserve the true Lalamove cancellation origin.
-- CREATE OR REPLACE keeps the existing EXECUTE ACLs; no grants or revokes are changed.
begin;

alter table public.orders
  add column if not exists delivery_coordinates jsonb;

create or replace function public.service_cancel_lalamove_dispatch(p_order_id text)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
 update feira_cost_private.lalamove_dispatches set state='cancelled',lalamove_status='cancelled',
  updated_at=now(),event_updated_at=now()
 where order_id=p_order_id and state='created' and lalamove_order_id is not null;
 if not found then raise exception 'dispatch not cancellable' using errcode='55000'; end if;
 update public.orders set lalamove_status='cancelled',lalamove_status_updated_at=now(),
  cancelled_by='admin',cancelled_at=coalesce(cancelled_at,now()),
  status=case when status='Saiu para Entrega' then 'Pronto para Retirada' else status end
 where id=p_order_id;
 return jsonb_build_object('cancelled',true);
end;
$$;

create or replace function public.service_apply_lalamove_webhook(
 p_event_id text,
 p_event_type text,
 p_event_at timestamptz,
 p_lalamove_order_id text,
 p_status text,
 p_tracking_url text,
 p_driver jsonb,
 p_ambiente text,
 p_cancel_reason text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
 v_order_id text;
 v_existing_at timestamptz;
 v_existing_cancelled_by text;
 v_inserted integer;
 v_reason text;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
  raise exception 'service role required' using errcode='42501';
 end if;
 if p_ambiente is null or p_ambiente not in ('sandbox','producao')
    or coalesce(p_event_id,'')='' or coalesce(p_lalamove_order_id,'')=''
    or p_event_at is null then
  raise exception 'invalid webhook event' using errcode='22023';
 end if;

 select d.order_id into v_order_id
 from feira_cost_private.lalamove_dispatches d
 where d.lalamove_order_id=p_lalamove_order_id and d.ambiente=p_ambiente
 for update;
 if v_order_id is null then
  return jsonb_build_object('applied',false,'unknown_order',true);
 end if;

 insert into feira_cost_private.lalamove_webhook_events(event_id,order_id,event_type,event_at)
 values(p_event_id,v_order_id,left(coalesce(p_event_type,'UNKNOWN'),80),p_event_at)
 on conflict(event_id) do nothing;
 get diagnostics v_inserted=row_count;
 if v_inserted=0 then
  return jsonb_build_object('applied',false,'duplicate',true);
 end if;

 select o.lalamove_status_updated_at,o.cancelled_by into v_existing_at,v_existing_cancelled_by
 from public.orders o where o.id=v_order_id for update;
 if v_existing_at is not null and p_event_at<v_existing_at then
  update feira_cost_private.lalamove_dispatches
   set tracking_url=coalesce(nullif(p_tracking_url,''),tracking_url),
       driver=coalesce(p_driver,driver,'{}'::jsonb),updated_at=now()
   where order_id=v_order_id;
  update public.orders
   set lalamove_order_id=p_lalamove_order_id,
       lalamove_tracking_url=coalesce(nullif(p_tracking_url,''),lalamove_tracking_url),
       lalamove_driver=coalesce(p_driver,lalamove_driver,'{}'::jsonb)
   where id=v_order_id;
  return jsonb_build_object('applied',false,'out_of_order',true);
 end if;

 v_reason := nullif(left(regexp_replace(coalesce(p_cancel_reason,''),'[[:cntrl:]]+',' ','g'),180),'');
 update feira_cost_private.lalamove_dispatches
 set state=case when p_status in ('cancelled','rejected','expired') then 'failed' else state end,
     lalamove_order_id=case when p_status in ('cancelled','rejected','expired') then null else lalamove_order_id end,
     lalamove_status=p_status,
     tracking_url=coalesce(nullif(p_tracking_url,''),tracking_url),
     driver=coalesce(p_driver,driver,'{}'::jsonb),
     event_updated_at=p_event_at,
     updated_at=now()
 where order_id=v_order_id;

 update public.orders
 set lalamove_order_id=p_lalamove_order_id,
     lalamove_status=p_status,
     lalamove_tracking_url=coalesce(nullif(p_tracking_url,''),lalamove_tracking_url),
     lalamove_driver=coalesce(p_driver,lalamove_driver,'{}'::jsonb),
     lalamove_status_updated_at=p_event_at,
     cancelled_at=case
       when p_status in ('cancelled','rejected','expired') then coalesce(cancelled_at,p_event_at)
       else cancelled_at end,
     cancelled_by=case
       when p_status in ('cancelled','rejected','expired') then
         case
           when v_existing_cancelled_by='admin' then 'admin'
           when p_status in ('rejected','expired') then 'lalamove: no_driver'
           else 'lalamove: driver_cancelled'
         end
       else cancelled_by end,
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
   'applied',true,
   'order_id',v_order_id,
   'ambiente',p_ambiente,
   'admin_alert',case
     when p_status in ('rejected','expired') then 'Nenhum motorista aceitou. Chame outro entregador.'
     when p_status='cancelled' and v_existing_cancelled_by='admin' then null
     when p_status='cancelled' then 'O entregador cancelou. Chame outro entregador.'
     else null end,
   'cancellation_reason_recorded',p_status in ('cancelled','rejected','expired')
 );
end;
$$;

commit;
