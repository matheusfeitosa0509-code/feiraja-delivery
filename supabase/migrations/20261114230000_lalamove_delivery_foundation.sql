-- Fundacao de dados Lalamove Sandbox. Nao aplicar automaticamente.
begin;

alter table public.products
  add column if not exists delivery_unit_weight_kg numeric(8,3)
    check (delivery_unit_weight_kg is null or delivery_unit_weight_kg >= 0),
  add column if not exists delivery_bulky boolean not null default false;

update public.products p
set delivery_unit_weight_kg=v.weight_kg, delivery_bulky=v.is_bulky
from (values
('feiraja_abacaxi',1.500::numeric,false),('feiraja_acafrao_pacote',0.050::numeric,false),
('feiraja_acai_1_litro',1.200::numeric,false),('feiraja_agriao_maco',0.250::numeric,false),
('feiraja_alface',0.350::numeric,false),('feiraja_banana_prata',1.500::numeric,false),
('feiraja_brocolis_unidade',0.600::numeric,false),('feiraja_cebolinha_maco',0.150::numeric,false),
('feiraja_cheiro_verde_maco',0.150::numeric,false),('feiraja_chicoria_maco',0.250::numeric,false),
('feiraja_agua_de_coco_unidade',1.500::numeric,false),('feiraja_coentro_maco',0.150::numeric,false),
('feiraja_colorau_pacote',0.050::numeric,false),('feiraja_cominho_pacote',0.050::numeric,false),
('feiraja_couve',0.200::numeric,false),('feiraja_couve_flor_unidade',1.000::numeric,false),
('feiraja_espinafre_maco',0.250::numeric,false),('feiraja_farinha_branca_1kg',1.050::numeric,false),
('feiraja_farinha_tapioca_500g',0.550::numeric,false),('feiraja_farinha_tapioca_castanha_280g',0.320::numeric,false),
('feiraja_farinha_ova_caroco_1kg',1.050::numeric,false),('feiraja_farinha_ovinha_1kg',1.050::numeric,false),
('feiraja_goma_tapioca_1kg',1.050::numeric,false),('feiraja_goma_tapioca_500g',0.550::numeric,false),
('feiraja_hortela_maco',0.100::numeric,false),('feiraja_louro_pacote',0.020::numeric,false),
('feiraja_melancia_g',8.000::numeric,true),('feiraja_melancia_m',5.000::numeric,true),
('feiraja_morango_250g',0.300::numeric,false),('feiraja_oregano_pacote',0.020::numeric,false),
('feiraja_ovo',1.800::numeric,false),('feiraja_rucula_maco',0.150::numeric,false),
('feiraja_salsinha_maco',0.150::numeric,false)
) v(product_id,weight_kg,is_bulky)
where p.id=v.product_id;

alter table public.customer_profiles
 add column if not exists address_street text,
 add column if not exists address_number text,
 add column if not exists address_neighborhood text,
 add column if not exists address_complement text,
 add column if not exists address_reference text;

alter table public.orders
 add column if not exists delivery_address jsonb,
 add column if not exists delivery_vehicle text check (delivery_vehicle is null or delivery_vehicle in ('MOTO','CAR')),
 add column if not exists delivery_weight_kg numeric(8,3) check (delivery_weight_kg is null or delivery_weight_kg >= 0),
 add column if not exists lalamove_order_id text,
 add column if not exists lalamove_status text check (lalamove_status is null or lalamove_status in ('pending','searching','assigned','enroute_pickup','picked_up','delivered','cancelled','rejected','expired')),
 add column if not exists lalamove_tracking_url text,
 add column if not exists lalamove_driver jsonb,
 add column if not exists lalamove_status_updated_at timestamptz,
 add column if not exists is_test_order boolean not null default false;

comment on column public.orders.is_test_order is 'Pedido administrativo de sandbox, invisivel para clientes e excluido de relatorios.';

create table if not exists public.delivery_settings (
 singleton boolean primary key default true check(singleton=true),
 delivery_ativa boolean not null default false,
 moto_limite_kg numeric(6,2) not null default 8 check(moto_limite_kg>0),
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id)
);
insert into public.delivery_settings(singleton,delivery_ativa,moto_limite_kg)
values(true,false,8) on conflict(singleton) do nothing;
alter table public.delivery_settings enable row level security;
revoke all on public.delivery_settings from anon,authenticated;
create policy delivery_settings_admin_only on public.delivery_settings for all to authenticated
 using(public.is_current_user_admin()) with check(public.is_current_user_admin());

create or replace function public.get_delivery_enabled()
returns boolean language sql stable security definer set search_path=''
as $$
 select coalesce((select ds.delivery_ativa from public.delivery_settings ds where ds.singleton=true),false);
$$;
revoke all on function public.get_delivery_enabled() from public,authenticated;
grant execute on function public.get_delivery_enabled() to anon,authenticated;

create or replace function public.admin_get_delivery_settings()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
 if auth.uid() is null or not public.is_current_user_admin() then
  raise exception 'Acesso permitido somente a administradores.' using errcode='42501';
 end if;
 return (select jsonb_build_object('delivery_ativa',ds.delivery_ativa,'moto_limite_kg',ds.moto_limite_kg)
         from public.delivery_settings ds where ds.singleton=true);
end;
$$;
revoke all on function public.admin_get_delivery_settings() from public,anon;
grant execute on function public.admin_get_delivery_settings() to authenticated;

create or replace function public.admin_update_delivery_settings(p_delivery_ativa boolean,p_moto_limite_kg numeric)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
 if auth.uid() is null or not public.is_current_user_admin() then
  raise exception 'Acesso permitido somente a administradores.' using errcode='42501';
 end if;
 if p_delivery_ativa is null or p_moto_limite_kg is null or p_moto_limite_kg<=0 or p_moto_limite_kg>100 then
  raise exception 'Configuracao de entrega invalida.' using errcode='22023';
 end if;
 update public.delivery_settings set delivery_ativa=p_delivery_ativa,moto_limite_kg=p_moto_limite_kg,
  updated_at=now(),updated_by=auth.uid() where singleton=true;
 return public.admin_get_delivery_settings();
end;
$$;
revoke all on function public.admin_update_delivery_settings(boolean,numeric) from public,anon;
grant execute on function public.admin_update_delivery_settings(boolean,numeric) to authenticated;

create table if not exists feira_cost_private.order_delivery_costs (
 order_id text primary key references public.orders(id) on delete cascade,
 provider text not null default 'lalamove' check(provider='lalamove'),
 actual_cost numeric(12,2) not null check(actual_cost>=0),
 currency text not null default 'BRL' check(currency='BRL'),
 recorded_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id)
);
revoke all on feira_cost_private.order_delivery_costs from public,anon,authenticated;

create or replace function public.admin_set_lalamove_actual_cost(p_order_id text,p_actual_cost numeric)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
 if auth.uid() is null or not public.is_current_user_admin() then
  raise exception 'Acesso permitido somente a administradores.' using errcode='42501';
 end if;
 if p_order_id is null or btrim(p_order_id)='' or p_actual_cost is null or p_actual_cost<0 then
  raise exception 'Pedido e custo real validos sao obrigatorios.' using errcode='22023';
 end if;
 if not exists(select 1 from public.orders o where o.id=p_order_id and o.delivery_type='lalamove' and o.lalamove_order_id is not null) then
  raise exception 'Pedido Lalamove nao encontrado ou ainda nao despachado.' using errcode='P0002';
 end if;
 insert into feira_cost_private.order_delivery_costs(order_id,actual_cost,updated_at,updated_by)
 values(p_order_id,round(p_actual_cost,2),now(),auth.uid())
 on conflict(order_id) do update set actual_cost=excluded.actual_cost,updated_at=now(),updated_by=auth.uid();
 return jsonb_build_object('success',true,'order_id',p_order_id);
end;
$$;
revoke all on function public.admin_set_lalamove_actual_cost(text,numeric) from public,anon;
grant execute on function public.admin_set_lalamove_actual_cost(text,numeric) to authenticated;

create function public.admin_get_cost_report_with_delivery(p_start timestamptz,p_end timestamptz)
returns jsonb language plpgsql security definer set search_path=''
as $
declare v_result jsonb;
begin
 if auth.uid() is null or not public.is_current_user_admin() then
  raise exception 'Acesso permitido somente a administradores.' using errcode='42501';
 end if;
 if p_start is null or p_end is null or p_end<=p_start then
  raise exception 'Periodo invalido: a data final deve ser posterior a inicial.' using errcode='22023';
 end if;
 with paid_orders as materialized (
  select o.id,o.delivery_type,o.delivery_fee from public.orders o
  where o.created_at>=p_start and o.created_at<p_end and coalesce(o.is_test_order,false)=false
   and lower(btrim(coalesce(o.status,''))) not in ('cancelada','cancelado','pagamento cancelado','pagamento recusado','pagamento reembolsado','pagamento contestado')
   and ((lower(coalesce(o.payment_method,'')) like '%pix%' and lower(btrim(coalesce(o.status,''))) in ('pagamento confirmado','preparando','pronto para retirada','saiu para entrega','entregue','pago','concluido','concluído'))
     or (lower(coalesce(o.payment_method,'')) not like '%pix%' and lower(btrim(coalesce(o.status,''))) in ('entregue','concluido','concluído')))
 ), period_items as (
  select s.* from feira_cost_private.order_item_snapshots s join paid_orders o on o.id=s.order_id
 ), totals as (
  select count(distinct order_id)::integer order_count,coalesce(sum(sale_total),0)::numeric sales_total,
   coalesce(sum(sale_total) filter(where unit_cost is not null),0)::numeric known_revenue,
   coalesce(sum(cost_total) filter(where unit_cost is not null),0)::numeric known_cost,
   coalesce(sum(profit) filter(where unit_cost is not null),0)::numeric profit,
   count(*) filter(where cost_status='missing_cost')::integer missing_cost_items,
   count(*) filter(where cost_status='invalid_item')::integer invalid_items from period_items
 ), delivery_totals as (
  select coalesce(sum(o.delivery_fee) filter(where o.delivery_type='lalamove'),0)::numeric delivery_fee_revenue,
   coalesce(sum(c.actual_cost),0)::numeric delivery_actual_cost
  from paid_orders o left join feira_cost_private.order_delivery_costs c on c.order_id=o.id
 )
 select jsonb_build_object('summary',jsonb_build_object(
  'orders',totals.order_count,'sales_total',totals.sales_total,'known_revenue',totals.known_revenue,
  'known_cost',totals.known_cost,'profit',totals.profit,'delivery_fee_revenue',delivery_totals.delivery_fee_revenue,
  'delivery_actual_cost',delivery_totals.delivery_actual_cost,
  'profit_after_delivery',totals.profit+delivery_totals.delivery_fee_revenue-delivery_totals.delivery_actual_cost,
  'profit_percent',case when totals.known_revenue>0 then round(100*totals.profit/totals.known_revenue,2) else null end,
  'missing_cost_items',totals.missing_cost_items,'invalid_items',totals.invalid_items),
  'products',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'category',p.category,'price',p.price,
   'available',p.available,'unit_cost',pc.unit_cost,'updated_at',pc.updated_at) order by p.name
   from public.products p left join feira_cost_private.product_costs pc on pc.product_id=p.id),'[]'::jsonb))
 into v_result from totals cross join delivery_totals;
 return v_result;
end;
$;

revoke all on function public.admin_get_cost_report_with_delivery(timestamptz,timestamptz) from public,anon;
grant execute on function public.admin_get_cost_report_with_delivery(timestamptz,timestamptz) to authenticated;

commit;
