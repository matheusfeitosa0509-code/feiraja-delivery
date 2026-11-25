begin;
alter table feira_cost_private.lalamove_dispatch_history
  add column if not exists observation text;

create or replace function public.process_admin_alert_jobs(p_now timestamptz default pg_catalog.clock_timestamp())
returns void language plpgsql security definer set search_path=''
as $$
declare
 v_date date := (p_now at time zone 'America/Manaus')::date;
 v_time time without time zone := (p_now at time zone 'America/Manaus')::time;
 v_test_mode boolean := pg_catalog.current_setting('app.admin_alerts_test_mode',true)='on';
begin
 insert into public.admin_alerts(tipo,order_id,mensagem)
 select 'pix_pendente_15min',o.id,
  '⏳ Pix pendente – pedido '||o.id||' (R$ '||replace(pg_catalog.to_char(o.total,'FM999999990.00'),'.',',')||')'
 from public.orders o
 where o.status in ('Aguardando Pagamento Pix','Pagamento Pendente')
 and o.payment_method in ('pix','Pix Direto','Asaas Pix','Mercado Pago Pix')
 and o.created_at<=p_now-interval '15 minutes'
 and (v_test_mode or o.is_test_order is false)
 on conflict(tipo,order_id) do nothing;

 if public.admin_alerts_is_open_day(v_date) and (
  (public.admin_alerts_is_special_day(v_date) and v_time>=time '10:30' and v_time<time '10:35')
  or (not public.admin_alerts_is_special_day(v_date) and v_time>=time '12:30' and v_time<time '12:35')
 ) then
  insert into public.admin_alerts(tipo,order_id,mensagem)
  select 'pedido_pago_nao_separado',o.id,'⚠️ Pedido '||o.id||' ainda não separado'
  from public.orders o
  where o.status='Pagamento Confirmado' and o.separation_started_at is null
  and o.separation_started_legacy is false and (v_test_mode or o.is_test_order is false)
  on conflict(tipo,order_id) do nothing;
 end if;

 insert into public.admin_alerts(tipo,order_id,mensagem)
 select 'dispatch_stale',d.order_id,
  '🟠 Corrida Lalamove aberta há mais de 2h – pedido '||d.order_id||
  ' (corrida '||d.lalamove_order_id||', status '||coalesce(d.lalamove_status,d.state)||')'
 from feira_cost_private.lalamove_dispatches d
 join public.orders o on o.id=d.order_id
 where d.lalamove_order_id is not null
 and d.state='created'
 and coalesce(d.lalamove_status,'') in ('searching','assigned','enroute_pickup','picked_up')
 and coalesce(d.event_updated_at,d.updated_at,d.created_at)<=p_now-interval '2 hours'
 and (v_test_mode or o.is_test_order is false)
 on conflict(tipo,order_id) do nothing;

 insert into public.admin_alerts(tipo,order_id,mensagem)
 select 'dispatch_stale',h.order_id,
  '🟠 Corrida Lalamove aberta há mais de 2h – pedido '||h.order_id||
  ' (corrida '||h.lalamove_order_id||', status '||h.status||')'
 from feira_cost_private.lalamove_dispatch_history h
 join public.orders o on o.id=h.order_id
 where h.status in ('searching','assigned','enroute_pickup','picked_up')
 and h.created_at<=p_now-interval '2 hours'
 and (v_test_mode or o.is_test_order is false)
 on conflict(tipo,order_id) do nothing;
end;
$$;
revoke all on function public.process_admin_alert_jobs(timestamptz) from public,anon,authenticated;
grant execute on function public.process_admin_alert_jobs(timestamptz) to service_role;
commit;