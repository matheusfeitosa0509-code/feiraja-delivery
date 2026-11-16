-- Lalamove production/sandbox switch, quote provenance and 12 kg motorcycle limit.
begin;

alter table public.delivery_settings
  add column if not exists lalamove_ambiente text not null default 'sandbox';
alter table public.delivery_settings
  drop constraint if exists delivery_settings_lalamove_ambiente_check;
alter table public.delivery_settings
  add constraint delivery_settings_lalamove_ambiente_check
  check (lalamove_ambiente in ('sandbox','producao'));

update public.delivery_settings
set lalamove_ambiente='sandbox', moto_limite_kg=12, updated_at=now()
where singleton=true;

alter table feira_cost_private.lalamove_dispatches
  add column if not exists ambiente text not null default 'sandbox';
alter table feira_cost_private.lalamove_dispatches
  drop constraint if exists lalamove_dispatches_ambiente_check;
alter table feira_cost_private.lalamove_dispatches
  add constraint lalamove_dispatches_ambiente_check
  check (ambiente in ('sandbox','producao'));

-- Keep the existing admin-only RLS policy. Replace the admin RPC so only an
-- authenticated admin can change the environment; old panel calls remain valid.
drop function if exists public.admin_update_delivery_settings(boolean,numeric);
create or replace function public.admin_get_delivery_settings()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
 if auth.uid() is null or not public.is_current_user_admin() then
  raise exception 'Acesso permitido somente a administradores.' using errcode='42501';
 end if;
 return (select jsonb_build_object(
   'delivery_ativa',ds.delivery_ativa,
   'moto_limite_kg',ds.moto_limite_kg,
   'lalamove_ambiente',ds.lalamove_ambiente
 ) from public.delivery_settings ds where ds.singleton=true);
end;
$$;
revoke all on function public.admin_get_delivery_settings() from public,anon;
grant execute on function public.admin_get_delivery_settings() to authenticated;

create function public.admin_update_delivery_settings(
 p_delivery_ativa boolean,
 p_moto_limite_kg numeric,
 p_lalamove_ambiente text default null
) returns jsonb language plpgsql security definer set search_path=''
as $$
begin
 if auth.uid() is null or not public.is_current_user_admin() then
  raise exception 'Acesso permitido somente a administradores.' using errcode='42501';
 end if;
 if p_delivery_ativa is null or p_moto_limite_kg is null
   or p_moto_limite_kg<=0 or p_moto_limite_kg>100
   or (p_lalamove_ambiente is not null and p_lalamove_ambiente not in ('sandbox','producao')) then
  raise exception 'Configuracao de entrega invalida.' using errcode='22023';
 end if;
 update public.delivery_settings
 set delivery_ativa=p_delivery_ativa,
     moto_limite_kg=p_moto_limite_kg,
     lalamove_ambiente=coalesce(p_lalamove_ambiente,lalamove_ambiente),
     updated_at=now(),updated_by=auth.uid()
 where singleton=true;
 return public.admin_get_delivery_settings();
end;
$$;
revoke all on function public.admin_update_delivery_settings(boolean,numeric,text) from public,anon;
grant execute on function public.admin_update_delivery_settings(boolean,numeric,text) to authenticated;

drop function if exists public.service_store_lalamove_quotes(text,uuid,jsonb,jsonb,numeric,numeric,timestamptz,timestamptz);
create function public.service_store_lalamove_quotes(
 p_order_id text,p_session_id uuid,p_moto_quote jsonb,p_car_quote jsonb,
 p_moto_fee numeric,p_car_fee numeric,p_moto_expires_at timestamptz,p_car_expires_at timestamptz,
 p_ambiente text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_state text;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
  raise exception 'service role required' using errcode='42501';
 end if;
 if p_ambiente is null or p_ambiente not in ('sandbox','producao') or p_order_id is null or p_session_id is null
  or p_moto_quote is null or p_car_quote is null or p_moto_fee is null or p_car_fee is null
  or p_moto_fee<0 or p_car_fee<0 or p_moto_expires_at<=now() or p_car_expires_at<=now() then
  raise exception 'invalid quote payload' using errcode='22023';
 end if;
 insert into feira_cost_private.lalamove_dispatches(
  order_id,state,quote_session_id,quote_moto,quote_car,quote_moto_fee,quote_car_fee,
  quote_moto_expires_at,quote_car_expires_at,ambiente,updated_at
 ) values(p_order_id,'quoted',p_session_id,p_moto_quote,p_car_quote,p_moto_fee,p_car_fee,
  p_moto_expires_at,p_car_expires_at,p_ambiente,now())
 on conflict(order_id) do update set
  state='quoted',quote_session_id=excluded.quote_session_id,
  quote_moto=excluded.quote_moto,quote_car=excluded.quote_car,
  quote_moto_fee=excluded.quote_moto_fee,quote_car_fee=excluded.quote_car_fee,
  quote_moto_expires_at=excluded.quote_moto_expires_at,
  quote_car_expires_at=excluded.quote_car_expires_at,
  ambiente=excluded.ambiente,updated_at=now(),last_error_code=null
 where feira_cost_private.lalamove_dispatches.state not in ('creating','created')
  and feira_cost_private.lalamove_dispatches.lalamove_order_id is null;
 select d.state into v_state from feira_cost_private.lalamove_dispatches d where d.order_id=p_order_id;
 if v_state is distinct from 'quoted' then raise exception 'dispatch already started' using errcode='55000'; end if;
 return jsonb_build_object('stored',true,'ambiente',p_ambiente);
end;
$$;
revoke all on function public.service_store_lalamove_quotes(text,uuid,jsonb,jsonb,numeric,numeric,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.service_store_lalamove_quotes(text,uuid,jsonb,jsonb,numeric,numeric,timestamptz,timestamptz,text) to service_role;

drop function if exists public.service_begin_lalamove_dispatch(text,uuid,text);
create function public.service_begin_lalamove_dispatch(p_order_id text,p_session_id uuid,p_vehicle text,p_ambiente text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_order record; v_dispatch record; v_quote jsonb; v_expiry timestamptz; v_current text;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
  raise exception 'service role required' using errcode='42501';
 end if;
 if p_ambiente is null or p_ambiente not in ('sandbox','producao') or p_vehicle not in ('MOTO','CAR') then
  raise exception 'invalid dispatch parameters' using errcode='22023';
 end if;
 select ds.lalamove_ambiente into v_current from public.delivery_settings ds where ds.singleton=true;
 if v_current is distinct from p_ambiente then raise exception 'environment changed; request a new quote' using errcode='55000'; end if;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(p_order_id,''),0));
 select o.id,o.status,o.payment_method,o.is_test_order,o.delivery_type,o.delivery_fee
 into v_order from public.orders o where o.id=p_order_id for update;
 if not found or v_order.delivery_type is distinct from 'delivery' then raise exception 'delivery order not found' using errcode='P0002'; end if;
 if lower(btrim(coalesce(v_order.status,''))) not in ('preparando','pronto','pronto para retirada') then
  raise exception 'order is not preparing or ready' using errcode='55000';
 end if;
 if coalesce(v_order.is_test_order,false)=false and lower(coalesce(v_order.payment_method,'')) not like '%pix%' then
  raise exception 'order is not paid by pix' using errcode='55000';
 end if;
 select d.* into v_dispatch from feira_cost_private.lalamove_dispatches d where d.order_id=p_order_id for update;
 if not found then raise exception 'quote session not found' using errcode='P0002'; end if;
 if v_dispatch.state in ('creating','created') or v_dispatch.lalamove_order_id is not null then
  return jsonb_build_object('started',false,'state',v_dispatch.state);
 end if;
 if v_dispatch.state<>'quoted' or v_dispatch.quote_session_id<>p_session_id then
  raise exception 'quote session expired or replaced' using errcode='55000';
 end if;
 if v_dispatch.ambiente is distinct from p_ambiente then
  raise exception 'quote environment mismatch; request a new quote' using errcode='55000';
 end if;
 if p_vehicle='MOTO' then v_quote:=v_dispatch.quote_moto; v_expiry:=v_dispatch.quote_moto_expires_at;
 else v_quote:=v_dispatch.quote_car; v_expiry:=v_dispatch.quote_car_expires_at; end if;
 if v_quote is null or v_expiry is null or v_expiry<=now() then raise exception 'selected quotation expired' using errcode='55000'; end if;
 update feira_cost_private.lalamove_dispatches set state='creating',selected_vehicle=p_vehicle,updated_at=now() where order_id=p_order_id;
 update public.orders set lalamove_status='pending',lalamove_status_updated_at=now() where id=p_order_id;
 return jsonb_build_object('started',true,'quote',v_quote,'vehicle',p_vehicle,'delivery_fee',v_order.delivery_fee,
  'test_order',coalesce(v_order.is_test_order,false),'ambiente',p_ambiente);
end;
$$;
revoke all on function public.service_begin_lalamove_dispatch(text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.service_begin_lalamove_dispatch(text,uuid,text,text) to service_role;

create or replace function public.service_get_lalamove_dispatch(p_order_id text)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
 return (select jsonb_build_object(
  'state',d.state,'lalamove_order_id',d.lalamove_order_id,'lalamove_status',d.lalamove_status,
  'tracking_url',d.tracking_url,'driver',d.driver,'event_updated_at',d.event_updated_at,'ambiente',d.ambiente
 ) from feira_cost_private.lalamove_dispatches d where d.order_id=p_order_id);
end;
$$;

drop function if exists public.service_apply_lalamove_webhook(text,text,timestamptz,text,text,text,jsonb);
create function public.service_apply_lalamove_webhook(
 p_event_id text,p_event_type text,p_event_at timestamptz,p_lalamove_order_id text,
 p_status text,p_tracking_url text,p_driver jsonb,p_ambiente text
) returns jsonb language plpgsql security definer set search_path=''
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
  update public.orders set lalamove_tracking_url=coalesce(nullif(p_tracking_url,''),lalamove_tracking_url),
   lalamove_driver=coalesce(p_driver,lalamove_driver,'{}'::jsonb) where id=v_order_id;
  return jsonb_build_object('applied',false,'out_of_order',true);
 end if;
 update feira_cost_private.lalamove_dispatches set lalamove_status=p_status,
  tracking_url=coalesce(nullif(p_tracking_url,''),tracking_url),driver=coalesce(p_driver,driver,'{}'::jsonb),
  event_updated_at=p_event_at,updated_at=now() where order_id=v_order_id;
 update public.orders set lalamove_status=p_status,
  lalamove_tracking_url=coalesce(nullif(p_tracking_url,''),lalamove_tracking_url),
  lalamove_driver=coalesce(p_driver,lalamove_driver,'{}'::jsonb),lalamove_status_updated_at=p_event_at,
  status=case when p_status='delivered' then 'Entregue'
   when p_status in ('assigned','enroute_pickup','picked_up') then 'Saiu para Entrega'
   when p_status='cancelled' and status='Saiu para Entrega' then 'Preparando' else status end
 where id=v_order_id;
 return jsonb_build_object('applied',true,'order_id',v_order_id,'ambiente',p_ambiente);
end;
$$;
revoke all on function public.service_apply_lalamove_webhook(text,text,timestamptz,text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.service_apply_lalamove_webhook(text,text,timestamptz,text,text,text,jsonb,text) to service_role;

commit;
