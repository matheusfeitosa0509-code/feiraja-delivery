-- Lalamove terminal outcomes: retryable dispatch, admin-only push, and provider cancellation metadata.
begin;

alter table public.orders
  drop constraint if exists orders_cancelled_by_check;
alter table public.orders
  add constraint orders_cancelled_by_check
  check (
    cancelled_by is null
    or cancelled_by in ('cliente', 'admin', 'lalamove')
    or cancelled_by like 'lalamove: %'
  );

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

 select o.lalamove_status_updated_at into v_existing_at
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
         case when v_reason is null then 'lalamove' else 'lalamove: '||v_reason end
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
   'admin_alert',case when p_status in ('cancelled','rejected','expired')
     then 'Nenhum motorista aceitou o pedido – chame de novo' else null end,
   'cancellation_reason_recorded',case when p_status in ('cancelled','rejected','expired') then v_reason is not null else false end
 );
end;
$$;

revoke all on function public.service_apply_lalamove_webhook(text,text,timestamptz,text,text,text,jsonb,text,text)
 from public, anon, authenticated, service_role;
grant execute on function public.service_apply_lalamove_webhook(text,text,timestamptz,text,text,text,jsonb,text,text)
 to service_role;

create or replace function public.notify_lalamove_no_driver_admin()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
 v_secret text;
 v_timestamp text;
 v_status text;
 v_message text;
 v_signature text;
begin
 if new.lalamove_status is not distinct from old.lalamove_status
    or new.lalamove_status not in ('cancelled','rejected','expired') then
  return new;
 end if;

 select decrypted_secret into v_secret
 from vault.decrypted_secrets
 where name='push_hmac_secret'
 limit 1;
 if v_secret is null or pg_catalog.btrim(v_secret)='' then
  return new;
 end if;

 v_timestamp := (extract(epoch from pg_catalog.clock_timestamp())::bigint)::text;
 v_status := 'Lalamove sem motorista@'||v_timestamp;
 v_message := v_timestamp||'.'||new.id||'.admin.'||v_status;
 v_signature := pg_catalog.encode(
   extensions.hmac(
     pg_catalog.convert_to(v_message,'UTF8'),
     pg_catalog.convert_to(v_secret,'UTF8'),
     'sha256'
   ),
   'hex'
 );

 begin
  perform net.http_post(
    url := 'https://juhwdevvwstmyxyyagzh.supabase.co/functions/v1/push-notify',
    headers := pg_catalog.jsonb_build_object('Content-Type','application/json'),
    body := pg_catalog.jsonb_build_object(
      'timestamp',v_timestamp,
      'order_id',new.id,
      'kind','admin',
      'new_status',v_status,
      'signature',v_signature
    ),
    timeout_milliseconds := 3000
  );
 exception when others then
  null;
 end;
 return new;
exception when others then
 return new;
end;
$$;

revoke all on function public.notify_lalamove_no_driver_admin()
 from public, anon, authenticated, service_role;

drop trigger if exists trg_lalamove_no_driver_admin_push on public.orders;
create trigger trg_lalamove_no_driver_admin_push
after update of lalamove_status on public.orders
for each row execute function public.notify_lalamove_no_driver_admin();

commit;
