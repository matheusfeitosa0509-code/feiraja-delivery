begin;

create table if not exists feira_cost_private.order_stale_clock (
  order_id text primary key references public.orders(id) on delete cascade,
  paid_at timestamptz,
  ready_for_dispatch_at timestamptz,
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);
revoke all on feira_cost_private.order_stale_clock from public, anon, authenticated;

-- Preserve the original payment timestamp across fulfillment status changes and
-- track when a delivery first enters the ready-to-dispatch state.
insert into feira_cost_private.order_stale_clock(order_id, paid_at, ready_for_dispatch_at)
select
  o.id,
  case
    when o.status not in ('Cancelada','Cancelado','Pagamento cancelado','Entregue','Concluído','Concluido','Concluída','Concluida')
      then coalesce(paid_alert.criado_em, pg_catalog.clock_timestamp())
    else null
  end,
  case
    when o.delivery_type='delivery' and o.status in ('Pronto para Retirada','Pronto')
      then pg_catalog.clock_timestamp()
    else null
  end
from public.orders o
left join lateral (
  select a.criado_em
  from public.admin_alerts a
  where a.tipo='pedido_pago' and a.order_id=o.id
  order by a.criado_em asc
  limit 1
) paid_alert on true
where o.status in ('Pagamento Confirmado','Preparando','Pronto para Retirada','Pronto','Saiu para Entrega')
   or (o.delivery_type='delivery' and o.status in ('Pronto para Retirada','Pronto'))
on conflict(order_id) do nothing;

create or replace function feira_cost_private.capture_order_stale_clock()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_paid_at timestamptz;
  v_ready_at timestamptz;
begin
  select c.paid_at, c.ready_for_dispatch_at
    into v_paid_at, v_ready_at
  from feira_cost_private.order_stale_clock c
  where c.order_id=new.id;

  if tg_op='INSERT' then
    if new.status='Pagamento Confirmado' then v_paid_at:=v_now; end if;
    if new.delivery_type='delivery' and new.status in ('Pronto para Retirada','Pronto') then v_ready_at:=v_now; end if;
  elsif old.status is distinct from new.status or old.delivery_type is distinct from new.delivery_type then
    if new.status in ('Cancelada','Cancelado','Pagamento cancelado','Entregue','Concluído','Concluido','Concluída','Concluida') then
      v_paid_at:=null;
      v_ready_at:=null;
    else
      if new.status='Pagamento Confirmado' and old.status is distinct from new.status then
        v_paid_at:=v_now;
      end if;
      if new.delivery_type='delivery' and new.status in ('Pronto para Retirada','Pronto')
         and (old.status is distinct from new.status or old.delivery_type is distinct from new.delivery_type) then
        v_ready_at:=v_now;
      elsif new.delivery_type<>'delivery' or new.status not in ('Pronto para Retirada','Pronto') then
        v_ready_at:=null;
      end if;
    end if;
  end if;

  insert into feira_cost_private.order_stale_clock(order_id,paid_at,ready_for_dispatch_at,updated_at)
  values(new.id,v_paid_at,v_ready_at,v_now)
  on conflict(order_id) do update
    set paid_at=excluded.paid_at,
        ready_for_dispatch_at=excluded.ready_for_dispatch_at,
        updated_at=excluded.updated_at;
  return new;
end;
$$;
revoke all on function feira_cost_private.capture_order_stale_clock() from public, anon, authenticated;

drop trigger if exists trg_capture_order_stale_clock on public.orders;
create trigger trg_capture_order_stale_clock
after insert or update of status, delivery_type on public.orders
for each row execute function feira_cost_private.capture_order_stale_clock();

create index if not exists order_stale_clock_paid_at_idx
  on feira_cost_private.order_stale_clock(paid_at)
  where paid_at is not null;
create index if not exists order_stale_clock_ready_at_idx
  on feira_cost_private.order_stale_clock(ready_for_dispatch_at)
  where ready_for_dispatch_at is not null;

create or replace function public.process_admin_alert_jobs(p_now timestamptz default pg_catalog.clock_timestamp())
returns void
language plpgsql
security definer
set search_path=''
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
    where o.status='Pagamento Confirmado'
      and o.separation_started_at is null
      and o.separation_started_legacy is false
      and (v_test_mode or o.is_test_order is false)
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

  -- Orphaned partner races remain visible through immutable dispatch history.
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

  -- Remove only resolved stale-order alerts; active alerts keep their original
  -- row (and read/unread state), so the five-minute job never duplicates them.
  delete from public.admin_alerts a
  where a.tipo='order_stale'
    and not exists (
      select 1
      from public.orders o
      join feira_cost_private.order_stale_clock c on c.order_id=o.id
      where o.id=a.order_id
        and coalesce(o.is_test_order,false)=false
        and (
          (
            c.paid_at is not null
            and c.paid_at<p_now-interval '24 hours'
            and o.status not in ('Entregue','Cancelada','Cancelado','Pagamento cancelado','Concluído','Concluido','Concluída','Concluida')
          )
          or
          (
            o.delivery_type='delivery'
            and o.status in ('Pronto para Retirada','Pronto')
            and c.ready_for_dispatch_at is not null
            and c.ready_for_dispatch_at<p_now-interval '3 hours'
            and not exists (
              select 1
              from feira_cost_private.lalamove_dispatches d
              where d.order_id=o.id
                and d.lalamove_order_id is not null
                and (
                  coalesce(d.lalamove_status,'') in ('searching','assigned','enroute_pickup','picked_up')
                  or (d.state='created' and coalesce(d.lalamove_status,'') not in ('cancelled','canceled','failed','expired','completed','delivered'))
                )
            )
          )
        )
    );

  insert into public.admin_alerts(tipo,order_id,mensagem)
  select 'order_stale',o.id,
    '🟠 Pedido parado – '||o.id||case
      when c.paid_at<p_now-interval '24 hours' then ' (pago há mais de 24h)'
      else ' (pronto para envio há mais de 3h, sem corrida ativa)'
    end
  from public.orders o
  join feira_cost_private.order_stale_clock c on c.order_id=o.id
  where coalesce(o.is_test_order,false)=false
    and (
      (
        c.paid_at is not null
        and c.paid_at<p_now-interval '24 hours'
        and o.status not in ('Entregue','Cancelada','Cancelado','Pagamento cancelado','Concluído','Concluido','Concluída','Concluida')
      )
      or
      (
        o.delivery_type='delivery'
        and o.status in ('Pronto para Retirada','Pronto')
        and c.ready_for_dispatch_at is not null
        and c.ready_for_dispatch_at<p_now-interval '3 hours'
        and not exists (
          select 1
          from feira_cost_private.lalamove_dispatches d
          where d.order_id=o.id
            and d.lalamove_order_id is not null
            and (
              coalesce(d.lalamove_status,'') in ('searching','assigned','enroute_pickup','picked_up')
              or (d.state='created' and coalesce(d.lalamove_status,'') not in ('cancelled','canceled','failed','expired','completed','delivered'))
            )
        )
      )
    )
  on conflict(tipo,order_id) do nothing;
end;
$$;
revoke all on function public.process_admin_alert_jobs(timestamptz) from public,anon,authenticated;
grant execute on function public.process_admin_alert_jobs(timestamptz) to service_role;

commit;
