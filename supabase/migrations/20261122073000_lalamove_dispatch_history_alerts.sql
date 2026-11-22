-- Histórico imutável por corrida + alertas de falha de persistência e corrida ativa antiga.
begin;

create table if not exists feira_cost_private.lalamove_dispatch_history (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders(id) on delete cascade,
  lalamove_order_id text not null unique,
  actual_cost numeric(12,2),
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
revoke all on feira_cost_private.lalamove_dispatch_history from public, anon, authenticated;

insert into feira_cost_private.lalamove_dispatch_history(order_id,lalamove_order_id,actual_cost,status,created_at,updated_at)
select d.order_id,d.lalamove_order_id,c.actual_cost,coalesce(d.lalamove_status,d.state),d.created_at,d.updated_at
from feira_cost_private.lalamove_dispatches d
left join feira_cost_private.order_delivery_costs c on c.order_id=d.order_id
where d.lalamove_order_id is not null
on conflict(lalamove_order_id) do nothing;

create or replace function feira_cost_private.capture_lalamove_dispatch_history()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_cost numeric(12,2);
begin
 if new.lalamove_order_id is null then return new; end if;
 select c.actual_cost into v_cost from feira_cost_private.order_delivery_costs c where c.order_id=new.order_id;
 insert into feira_cost_private.lalamove_dispatch_history(order_id,lalamove_order_id,actual_cost,status)
 values(new.order_id,new.lalamove_order_id,v_cost,coalesce(new.lalamove_status,new.state))
 on conflict(lalamove_order_id) do update
 set actual_cost=coalesce(excluded.actual_cost,feira_cost_private.lalamove_dispatch_history.actual_cost),
     status=excluded.status,updated_at=now();
 return new;
end;
$$;
drop trigger if exists trg_capture_lalamove_dispatch_history on feira_cost_private.lalamove_dispatches;
create trigger trg_capture_lalamove_dispatch_history
after insert or update of lalamove_order_id,lalamove_status,state
on feira_cost_private.lalamove_dispatches
for each row execute function feira_cost_private.capture_lalamove_dispatch_history();
revoke all on function feira_cost_private.capture_lalamove_dispatch_history() from public,anon,authenticated;

create or replace function feira_cost_private.sync_lalamove_history_cost()
returns trigger language plpgsql security definer set search_path=''
as $sync$
begin
 update feira_cost_private.lalamove_dispatch_history
 set actual_cost=new.actual_cost,updated_at=now()
 where order_id=new.order_id;
 return new;
end;
$sync$;
drop trigger if exists trg_sync_lalamove_history_cost on feira_cost_private.order_delivery_costs;
create trigger trg_sync_lalamove_history_cost
after insert or update of actual_cost on feira_cost_private.order_delivery_costs
for each row execute function feira_cost_private.sync_lalamove_history_cost();
revoke all on function feira_cost_private.sync_lalamove_history_cost() from public,anon,authenticated;

create index if not exists lalamove_dispatch_history_order_created_idx
on feira_cost_private.lalamove_dispatch_history(order_id,created_at desc);

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

 -- Corrida ativa por mais de duas horas, sem conclusão ou cancelamento.
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
end;
$$;
revoke all on function public.process_admin_alert_jobs(timestamptz) from public,anon,authenticated;
grant execute on function public.process_admin_alert_jobs(timestamptz) to service_role;
commit;
