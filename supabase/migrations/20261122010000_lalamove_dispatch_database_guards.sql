-- Server-side eligibility gate for Lalamove dispatch reservations.
-- Keep the existing RPC signature used by lalamove-dispatch (including the
-- explicit sandbox-to-production test confirmation argument).
begin;

create or replace function public.service_begin_lalamove_dispatch(
  p_order_id text,
  p_session_id uuid,
  p_vehicle text,
  p_ambiente text,
  p_test_production_confirmed boolean default false
) returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_order record;
  v_dispatch record;
  v_quote jsonb;
  v_expiry timestamptz;
  v_current text;
  v_block_code text;
  v_block_message text;
begin
  if p_ambiente is null or p_ambiente not in ('sandbox','producao')
     or p_vehicle not in ('MOTO','CAR') then
    raise exception 'invalid dispatch parameters' using errcode='22023';
  end if;

  select ds.lalamove_ambiente into v_current
  from public.delivery_settings ds where ds.singleton=true;
  if v_current is distinct from p_ambiente then
    raise exception 'environment changed; request a new quote' using errcode='55000';
  end if;

  -- Serialize every attempt for this order before reading eligibility/state.
  perform pg_advisory_xact_lock(hashtextextended(coalesce(p_order_id,''),0));

  select o.id,o.status,o.payment_method,o.payment_provider,o.payment_id,
         o.is_test_order,o.delivery_type,o.delivery_fee,o.created_at
    into v_order
  from public.orders o
  where o.id=p_order_id
  for update;

  if not found or v_order.delivery_type is distinct from 'delivery' then
    raise exception 'delivery order not found' using errcode='P0002';
  end if;

  -- Payment confirmation is represented by the Asaas webhook's persisted
  -- paid workflow status plus its exact Asaas payment ID (not by Pix method).
  if coalesce(v_order.payment_provider,'') <> 'asaas'
     or nullif(btrim(coalesce(v_order.payment_id,'')),'') is null
     or lower(btrim(coalesce(v_order.status,''))) not in
       ('pagamento confirmado','preparando','pronto','pronto para retirada',
        'saiu para entrega') then
    v_block_code := 'PAYMENT_NOT_CONFIRMED';
    v_block_message := 'Despacho bloqueado: pagamento Asaas não confirmado (status pago/recebido e payment_id obrigatório).';
  elsif lower(btrim(coalesce(v_order.status,''))) like '%cancel%'
     or lower(btrim(coalesce(v_order.status,''))) in
       ('entregue','concluído','concluido','finalizado','completed','delivered') then
    v_block_code := 'ORDER_CLOSED';
    v_block_message := 'Despacho bloqueado: pedido cancelado ou concluído/entregue.';
  elsif coalesce(v_order.is_test_order,false) then
    v_block_code := 'TEST_ORDER';
    v_block_message := 'Despacho bloqueado: pedidos de teste nunca podem gerar corrida.';
  elsif (v_order.created_at at time zone 'America/Manaus')::date
        <> (now() at time zone 'America/Manaus')::date then
    v_block_code := 'ORDER_NOT_TODAY';
    v_block_message := 'Despacho bloqueado: o pedido não foi criado hoje no fuso America/Manaus.';
  end if;

  if v_block_code is not null then
    insert into public.admin_alerts(tipo,order_id,mensagem)
    values ('dispatch_blocked',v_order.id,
            '🔴 ' || v_block_message || ' Código: ' || v_block_code)
    on conflict (tipo,order_id) do update
      set mensagem=excluded.mensagem,criado_em=now(),lido=false;
    return jsonb_build_object(
      'started',false,'blocked',true,'state','blocked',
      'code',v_block_code,'message',v_block_message
    );
  end if;

  select d.* into v_dispatch
  from feira_cost_private.lalamove_dispatches d
  where d.order_id=p_order_id
  for update;

  if not found then
    raise exception 'quote session not found' using errcode='P0002';
  end if;

  -- A quote alone is not a dispatch. Any non-terminal dispatch reservation
  -- or recorded partner ID blocks a second creation. The order/advisory locks
  -- make this decision atomic for simultaneous requests.
  if (v_dispatch.state not in ('quoted','cancelled','failed'))
     or (v_dispatch.lalamove_order_id is not null
         and v_dispatch.state not in ('cancelled','failed')) then
    insert into public.admin_alerts(tipo,order_id,mensagem)
    values ('dispatch_blocked',v_order.id,
            '🔴 Despacho bloqueado: já existe uma corrida ativa ou em criação. Código: DISPATCH_ALREADY_ACTIVE')
    on conflict (tipo,order_id) do update
      set mensagem=excluded.mensagem,criado_em=now(),lido=false;
    return jsonb_build_object(
      'started',false,'blocked',true,'state',v_dispatch.state,
      'code','DISPATCH_ALREADY_ACTIVE',
      'message','Despacho bloqueado: já existe uma corrida ativa ou em criação.'
    );
  end if;

  if v_dispatch.state<>'quoted' or v_dispatch.quote_session_id<>p_session_id then
    raise exception 'quote session expired or replaced' using errcode='55000';
  end if;
  if v_dispatch.ambiente is distinct from p_ambiente then
    raise exception 'quote environment mismatch; request a new quote' using errcode='55000';
  end if;

  if p_vehicle='MOTO' then
    v_quote:=v_dispatch.quote_moto;
    v_expiry:=v_dispatch.quote_moto_expires_at;
  else
    v_quote:=v_dispatch.quote_car;
    v_expiry:=v_dispatch.quote_car_expires_at;
  end if;
  if v_quote is null or v_expiry is null or v_expiry<=now() then
    raise exception 'selected quotation expired' using errcode='55000';
  end if;

  update feira_cost_private.lalamove_dispatches
    set state='creating',selected_vehicle=p_vehicle,updated_at=now()
  where order_id=p_order_id;
  update public.orders
    set lalamove_status='pending',lalamove_status_updated_at=now()
  where id=p_order_id;

  return jsonb_build_object(
    'started',true,'quote',v_quote,'vehicle',p_vehicle,
    'delivery_fee',v_order.delivery_fee,
    'test_order',coalesce(v_order.is_test_order,false),
    'ambiente',p_ambiente
  );
end;
$function$;

revoke all on function public.service_begin_lalamove_dispatch(text,uuid,text,text,boolean)
  from public,anon,authenticated;
grant execute on function public.service_begin_lalamove_dispatch(text,uuid,text,text,boolean)
  to service_role;

commit;
