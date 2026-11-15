-- PostgreSQL 17 integration contract for the Lalamove tracking migration.
-- Runs only against the ephemeral database created by ordem-197-postgres17.yml.
select set_config('request.jwt.claim.role', 'service_role', false);

do $tracking$
declare allowed boolean; i integer; result jsonb;
begin
  allowed := public.consume_lalamove_tracking_rate_limit('11111111-1111-4111-8111-111111111111', 30, 60);
  if allowed is distinct from true then raise exception 'FAIL first tracking request should pass'; end if;
  for i in 2..30 loop
    allowed := public.consume_lalamove_tracking_rate_limit('11111111-1111-4111-8111-111111111111', 30, 60);
    if allowed is distinct from true then raise exception 'FAIL tracking request % should pass', i; end if;
  end loop;
  allowed := public.consume_lalamove_tracking_rate_limit('11111111-1111-4111-8111-111111111111', 30, 60);
  if allowed is distinct from false then raise exception 'FAIL 31st tracking request should be rate limited'; end if;
end
$tracking$;

insert into public.orders(
  id,user_id,customer_name,customer_phone,customer_address,delivery_type,payment_method,
  items,subtotal,delivery_fee,total,status,market_checklist
) values
  ('track-expired','11111111-1111-4111-8111-111111111111','Cliente teste','11999999999','Rua teste, 10','delivery','Asaas Pix','[{"qty":1}]',100,15,115,'Saiu para Entrega','{}'),
  ('track-delivered','22222222-2222-4222-8222-222222222222','Cliente teste','11999999999','Rua teste, 20','delivery','Asaas Pix','[{"qty":1}]',100,15,115,'Pronto para Retirada','{}'),
  ('track-cancelled','33333333-3333-4333-8333-333333333333','Cliente teste','11999999999','Rua teste, 30','delivery','Asaas Pix','[{"qty":1}]',100,15,115,'Saiu para Entrega','{}');

insert into feira_cost_private.lalamove_dispatches(order_id,lalamove_order_id,lalamove_status,state)
values
  ('track-expired','lalamove-expired','searching','created'),
  ('track-delivered','lalamove-delivered','searching','created'),
  ('track-cancelled','lalamove-cancelled','assigned','created');

do $tracking$
declare result jsonb;
begin
  result := public.service_update_lalamove_tracking_status('track-expired','lalamove-expired','assigned',null,'{"name":"Motorista teste","plateNumber":"ABC123"}');
  if result->>'updated' is distinct from 'true' then raise exception 'FAIL assigned status update'; end if;

  result := public.service_update_lalamove_tracking_status('track-expired','lalamove-expired','searching',null,null);
  if result->>'stale_status' is distinct from 'true' or result->>'status' is distinct from 'assigned' then
    raise exception 'FAIL stale searching status must not regress assigned';
  end if;

  result := public.service_update_lalamove_tracking_status('track-expired','lalamove-expired','expired','https://tracking.example.test',null);
  if result->>'updated' is distinct from 'true' then raise exception 'FAIL expired status update'; end if;

  result := public.service_update_lalamove_tracking_status('track-expired','lalamove-expired','assigned',null,null);
  if result->>'terminal_status' is distinct from 'expired' then raise exception 'FAIL expired must remain terminal and distinct'; end if;

  if not exists(select 1 from public.orders where id='track-expired' and lalamove_status='expired' and status='Preparando' and delivery_fee=15 and total=115) then
    raise exception 'FAIL expired order status or price invariants';
  end if;
  if not exists(select 1 from feira_cost_private.lalamove_dispatches where order_id='track-expired' and lalamove_status='expired' and state='cancelled') then
    raise exception 'FAIL expired dispatch state';
  end if;

  perform public.service_update_lalamove_tracking_status('track-delivered','lalamove-delivered','assigned',null,null);
  perform public.service_update_lalamove_tracking_status('track-delivered','lalamove-delivered','picked_up',null,null);
  perform public.service_update_lalamove_tracking_status('track-delivered','lalamove-delivered','delivered',null,null);
  if not exists(select 1 from public.orders where id='track-delivered' and lalamove_status='delivered' and status='Entregue' and delivery_fee=15 and total=115) then
    raise exception 'FAIL delivered status or price invariants';
  end if;

  perform public.service_update_lalamove_tracking_status('track-cancelled','lalamove-cancelled','cancelled',null,null);
  if not exists(select 1 from public.orders where id='track-cancelled' and lalamove_status='cancelled' and status='Preparando' and delivery_fee=15 and total=115) then
    raise exception 'FAIL cancelled status or price invariants';
  end if;
end
$tracking$;

select 'PASS: tracking rate limit is 30 requests per user per minute' as test;
select 'PASS: expired, cancelled and delivered statuses persist distinctly' as test;
select 'PASS: stale provider updates cannot regress terminal statuses' as test;
select 'PASS: order price and total remain unchanged' as test;
