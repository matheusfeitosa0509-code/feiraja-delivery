-- Etapa 3 Lalamove: cotacoes privadas, trava atomica, ID privado e eventos idempotentes.
-- A modalidade permanece desligada; somente Edge Functions autenticadas como service_role operam estas tabelas.
begin;

create table if not exists feira_cost_private.lalamove_dispatches (
  order_id text primary key references public.orders(id) on delete cascade,
  state text not null default 'quoted'
    check (state in ('quoted','creating','created','failed','cancelled')),
  quote_session_id uuid,
  quote_moto jsonb,
  quote_car jsonb,
  quote_moto_fee numeric(12,2),
  quote_car_fee numeric(12,2),
  quote_moto_expires_at timestamptz,
  quote_car_expires_at timestamptz,
  selected_vehicle text check (selected_vehicle is null or selected_vehicle in ('MOTO','CAR')),
  lalamove_order_id text unique,
  lalamove_status text,
  tracking_url text,
  driver jsonb,
  event_updated_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
revoke all on feira_cost_private.lalamove_dispatches from public, anon, authenticated;

create table if not exists feira_cost_private.lalamove_webhook_events (
  event_id text primary key,
  order_id text,
  event_type text not null,
  event_at timestamptz not null,
  received_at timestamptz not null default now()
);
revoke all on feira_cost_private.lalamove_webhook_events from public, anon, authenticated;

create or replace function public.service_store_lalamove_quotes(
  p_order_id text, p_session_id uuid, p_moto_quote jsonb, p_car_quote jsonb,
  p_moto_fee numeric, p_car_fee numeric, p_moto_expires_at timestamptz, p_car_expires_at timestamptz
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_state text;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
  raise exception 'service role required' using errcode='42501';
 end if;
 if p_order_id is null or p_session_id is null or p_moto_quote is null or p_car_quote is null
    or p_moto_fee is null or p_car_fee is null or p_moto_fee < 0 or p_car_fee < 0
    or p_moto_expires_at <= now() or p_car_expires_at <= now() then
  raise exception 'invalid quote payload' using errcode='22023';
 end if;
 insert into feira_cost_private.lalamove_dispatches(
  order_id,state,quote_session_id,quote_moto,quote_car,quote_moto_fee,quote_car_fee,
  quote_moto_expires_at,quote_car_expires_at,updated_at
 ) values(p_order_id,'quoted',p_session_id,p_moto_quote,p_car_quote,p_moto_fee,p_car_fee,
  p_moto_expires_at,p_car_expires_at,now())
 on conflict(order_id) do update set
  state='quoted',quote_session_id=excluded.quote_session_id,
  quote_moto=excluded.quote_moto,quote_car=excluded.quote_car,
  quote_moto_fee=excluded.quote_moto_fee,quote_car_fee=excluded.quote_car_fee,
  quote_moto_expires_at=excluded.quote_moto_expires_at,
  quote_car_expires_at=excluded.quote_car_expires_at,updated_at=now(),last_error_code=null
 where feira_cost_private.lalamove_dispatches.state not in ('creating','created')
   and feira_cost_private.lalamove_dispatches.lalamove_order_id is null;
 select d.state into v_state from feira_cost_private.lalamove_dispatches d where d.order_id=p_order_id;
 if v_state is distinct from 'quoted' then
  raise exception 'dispatch already started' using errcode='55000';
 end if;
 return jsonb_build_object('stored',true);
end;
$$;

create or replace function public.service_begin_lalamove_dispatch(
 p_order_id text,p_session_id uuid,p_vehicle text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_order record; v_dispatch record; v_quote jsonb; v_expiry timestamptz;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
  raise exception 'service role required' using errcode='42501';
 end if;
 if p_vehicle not in ('MOTO','CAR') then raise exception 'invalid vehicle' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(p_order_id,''),0));
 select o.id,o.status,o.payment_method,o.is_test_order,o.delivery_type,o.delivery_fee
 into v_order from public.orders o where o.id=p_order_id for update;
 if not found or v_order.delivery_type <> 'delivery' then
  raise exception 'delivery order not found' using errcode='P0002';
 end if;
 if lower(btrim(coalesce(v_order.status,''))) not in ('pronto','pronto para retirada') then
  raise exception 'order is not ready' using errcode='55000';
 end if;
 if coalesce(v_order.is_test_order,false)=false and lower(coalesce(v_order.payment_method,'')) not like '%pix%' then
  raise exception 'order is not paid by pix' using errcode='55000';
 end if;
 select d.* into v_dispatch from feira_cost_private.lalamove_dispatches d
 where d.order_id=p_order_id for update;
 if not found then raise exception 'quote session not found' using errcode='P0002'; end if;
 if v_dispatch.state in ('creating','created') or v_dispatch.lalamove_order_id is not null then
  return jsonb_build_object('started',false,'state',v_dispatch.state);
 end if;
 if v_dispatch.state <> 'quoted' or v_dispatch.quote_session_id <> p_session_id then
  raise exception 'quote session expired or replaced' using errcode='55000';
 end if;
 if p_vehicle='MOTO' then v_quote:=v_dispatch.quote_moto; v_expiry:=v_dispatch.quote_moto_expires_at;
 else v_quote:=v_dispatch.quote_car; v_expiry:=v_dispatch.quote_car_expires_at; end if;
 if v_quote is null or v_expiry is null or v_expiry <= now() then
  raise exception 'selected quotation expired' using errcode='55000';
 end if;
 update feira_cost_private.lalamove_dispatches set state='creating',selected_vehicle=p_vehicle,updated_at=now()
 where order_id=p_order_id;
 update public.orders set lalamove_status='pending',lalamove_status_updated_at=now() where id=p_order_id;
 return jsonb_build_object('started',true,'quote',v_quote,'vehicle',p_vehicle,
  'delivery_fee',v_order.delivery_fee,'test_order',coalesce(v_order.is_test_order,false));
end;
$$;

create or replace function public.service_finish_lalamove_dispatch(
 p_order_id text,p_lalamove_order_id text,p_actual_cost numeric,p_status text,p_tracking_url text,p_driver jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_updated integer;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
  raise exception 'service role required' using errcode='42501';
 end if;
 if coalesce(p_order_id,'')='' or coalesce(p_lalamove_order_id,'')='' or p_actual_cost is null or p_actual_cost<0 then
  raise exception 'invalid dispatch result' using errcode='22023';
 end if;
 update feira_cost_private.lalamove_dispatches set state='created',lalamove_order_id=p_lalamove_order_id,
  lalamove_status=coalesce(p_status,'searching'),tracking_url=nullif(p_tracking_url,''),
  driver=coalesce(p_driver,'{}'::jsonb),updated_at=now(),last_error_code=null
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
 update public.orders set lalamove_status=coalesce(p_status,'searching'),
  lalamove_tracking_url=nullif(p_tracking_url,''),lalamove_driver=coalesce(p_driver,'{}'::jsonb),
  delivery_vehicle=(select d.selected_vehicle from feira_cost_private.lalamove_dispatches d where d.order_id=p_order_id),
  lalamove_status_updated_at=null,
  status=case when p_status='delivered' then 'Entregue'
   when p_status in ('assigned','enroute_pickup','picked_up') then 'Saiu para Entrega'
   else status end
 where id=p_order_id;
 return jsonb_build_object('created',true,'duplicate',false);
end;
$$;

create or replace function public.service_fail_lalamove_dispatch(p_order_id text,p_error_code text)
returns void language plpgsql security definer set search_path=''
as $$
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
  raise exception 'service role required' using errcode='42501';
 end if;
 update feira_cost_private.lalamove_dispatches set state='failed',
  last_error_code=left(coalesce(p_error_code,'UPSTREAM_ERROR'),80),updated_at=now()
 where order_id=p_order_id and state='creating' and lalamove_order_id is null;
 update public.orders set lalamove_status=null,lalamove_status_updated_at=null where id=p_order_id
  and lalamove_status='pending';
end;
$;

create or replace function public.service_cancel_lalamove_dispatch(p_order_id text)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
  raise exception 'service role required' using errcode='42501';
 end if;
 update feira_cost_private.lalamove_dispatches set state='cancelled',lalamove_status='cancelled',
  updated_at=now(),event_updated_at=now()
 where order_id=p_order_id and state='created' and lalamove_order_id is not null;
 if not found then raise exception 'dispatch not cancellable' using errcode='55000'; end if;
 update public.orders set lalamove_status='cancelled',lalamove_status_updated_at=now(),
  status=case when status='Saiu para Entrega' then 'Pronto para Retirada' else status end
 where id=p_order_id;
 return jsonb_build_object('cancelled',true);
end;
$$;

create or replace function public.service_apply_lalamove_webhook(
 p_event_id text,p_event_type text,p_event_at timestamptz,p_lalamove_order_id text,
 p_status text,p_tracking_url text,p_driver jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_order_id text; v_existing_at timestamptz; v_inserted integer;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
  raise exception 'service role required' using errcode='42501';
 end if;
 if coalesce(p_event_id,'')='' or coalesce(p_lalamove_order_id,'')='' or p_event_at is null then
  raise exception 'invalid webhook event' using errcode='22023';
 end if;
 select d.order_id into v_order_id from feira_cost_private.lalamove_dispatches d
 where d.lalamove_order_id=p_lalamove_order_id for update;
 if v_order_id is null then return jsonb_build_object('applied',false,'unknown_order',true); end if;
 insert into feira_cost_private.lalamove_webhook_events(event_id,order_id,event_type,event_at)
 values(p_event_id,v_order_id,left(coalesce(p_event_type,'UNKNOWN'),80),p_event_at)
 on conflict(event_id) do nothing;
 get diagnostics v_inserted = row_count;
 if v_inserted=0 then return jsonb_build_object('applied',false,'duplicate',true); end if;
 select o.lalamove_status_updated_at into v_existing_at from public.orders o where o.id=v_order_id for update;
 if v_existing_at is not null and p_event_at < v_existing_at then
  return jsonb_build_object('applied',false,'out_of_order',true);
 end if;
 update feira_cost_private.lalamove_dispatches set lalamove_status=p_status,
  tracking_url=coalesce(nullif(p_tracking_url,''),tracking_url),
  driver=coalesce(p_driver,driver,'{}'::jsonb),event_updated_at=p_event_at,updated_at=now()
 where order_id=v_order_id;
 update public.orders set lalamove_status=p_status,
  lalamove_tracking_url=coalesce(nullif(p_tracking_url,''),lalamove_tracking_url),
  lalamove_driver=coalesce(p_driver,lalamove_driver,'{}'::jsonb),
  lalamove_status_updated_at=p_event_at,
  status=case when p_status='delivered' then 'Entregue'
   when p_status in ('assigned','enroute_pickup','picked_up') then 'Saiu para Entrega'
   when p_status='cancelled' and status='Saiu para Entrega' then 'Pronto para Retirada'
   else status end
 where id=v_order_id;
 update feira_cost_private.lalamove_webhook_events set order_id=v_order_id where event_id=p_event_id;
 return jsonb_build_object('applied',true,'order_id',v_order_id);
end;
$$;

create or replace function public.service_get_lalamove_dispatch(p_order_id text)
returns jsonb language plpgsql security definer set search_path=''
as $
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
  raise exception 'service role required' using errcode='42501';
 end if;
 return (select jsonb_build_object(
  'state',d.state,'lalamove_order_id',d.lalamove_order_id,'lalamove_status',d.lalamove_status,
  'tracking_url',d.tracking_url,'driver',d.driver
 ) from feira_cost_private.lalamove_dispatches d where d.order_id=p_order_id);
end;
$;

revoke all on function public.service_get_lalamove_dispatch(text) from public,anon,authenticated;
revoke all on function public.service_store_lalamove_quotes(text,uuid,jsonb,jsonb,numeric,numeric,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.service_begin_lalamove_dispatch(text,uuid,text) from public,anon,authenticated;
revoke all on function public.service_finish_lalamove_dispatch(text,text,numeric,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.service_fail_lalamove_dispatch(text,text) from public,anon,authenticated;
revoke all on function public.service_cancel_lalamove_dispatch(text) from public,anon,authenticated;
revoke all on function public.service_apply_lalamove_webhook(text,text,timestamptz,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.service_get_lalamove_dispatch(text) to service_role;
grant execute on function public.service_store_lalamove_quotes(text,uuid,jsonb,jsonb,numeric,numeric,timestamptz,timestamptz) to service_role;
grant execute on function public.service_begin_lalamove_dispatch(text,uuid,text) to service_role;
grant execute on function public.service_finish_lalamove_dispatch(text,text,numeric,text,text,jsonb) to service_role;
grant execute on function public.service_fail_lalamove_dispatch(text,text) to service_role;
grant execute on function public.service_cancel_lalamove_dispatch(text) to service_role;
grant execute on function public.service_apply_lalamove_webhook(text,text,timestamptz,text,text,text,jsonb) to service_role;

commit;
