-- Restore the previous four-argument service_begin_lalamove_dispatch RPC.
begin;
drop function if exists public.service_begin_lalamove_dispatch(text,uuid,text,text,boolean);
create function public.service_begin_lalamove_dispatch(p_order_id text,p_session_id uuid,p_vehicle text,p_ambiente text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_order record; v_dispatch record; v_quote jsonb; v_expiry timestamptz; v_current text;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
 if p_ambiente is null or p_ambiente not in ('sandbox','producao') or p_vehicle not in ('MOTO','CAR') then raise exception 'invalid dispatch parameters' using errcode='22023'; end if;
 select ds.lalamove_ambiente into v_current from public.delivery_settings ds where ds.singleton=true;
 if v_current is distinct from p_ambiente then raise exception 'environment changed; request a new quote' using errcode='55000'; end if;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(p_order_id,''),0));
 select o.id,o.status,o.payment_method,o.is_test_order,o.delivery_type,o.delivery_fee into v_order from public.orders o where o.id=p_order_id for update;
 if not found or v_order.delivery_type is distinct from 'delivery' then raise exception 'delivery order not found' using errcode='P0002'; end if;
 if lower(btrim(coalesce(v_order.status,''))) not in ('preparando','pronto','pronto para retirada') then raise exception 'order is not preparing or ready' using errcode='55000'; end if;
 if coalesce(v_order.is_test_order,false)=false and lower(coalesce(v_order.payment_method,'')) not like '%pix%' then raise exception 'order is not paid by pix' using errcode='55000'; end if;
 select d.* into v_dispatch from feira_cost_private.lalamove_dispatches d where d.order_id=p_order_id for update;
 if not found then raise exception 'quote session not found' using errcode='P0002'; end if;
 if v_dispatch.state in ('creating','created') or v_dispatch.lalamove_order_id is not null then return jsonb_build_object('started',false,'state',v_dispatch.state); end if;
 if v_dispatch.state<>'quoted' or v_dispatch.quote_session_id<>p_session_id then raise exception 'quote session expired or replaced' using errcode='55000'; end if;
 if v_dispatch.ambiente is distinct from p_ambiente then raise exception 'quote environment mismatch; request a new quote' using errcode='55000'; end if;
 if p_vehicle='MOTO' then v_quote:=v_dispatch.quote_moto; v_expiry:=v_dispatch.quote_moto_expires_at; else v_quote:=v_dispatch.quote_car; v_expiry:=v_dispatch.quote_car_expires_at; end if;
 if v_quote is null or v_expiry is null or v_expiry<=now() then raise exception 'selected quotation expired' using errcode='55000'; end if;
 update feira_cost_private.lalamove_dispatches set state='creating',selected_vehicle=p_vehicle,updated_at=now() where order_id=p_order_id;
 update public.orders set lalamove_status='pending',lalamove_status_updated_at=now() where id=p_order_id;
 return jsonb_build_object('started',true,'quote',v_quote,'vehicle',p_vehicle,'delivery_fee',v_order.delivery_fee,'test_order',coalesce(v_order.is_test_order,false),'ambiente',p_ambiente);
end;
$$;
revoke all on function public.service_begin_lalamove_dispatch(text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.service_begin_lalamove_dispatch(text,uuid,text,text) to service_role;
commit;
