-- Rollback da fundacao de dados Lalamove. Antes de uso real.
begin;
drop function if exists public.admin_set_lalamove_actual_cost(text,numeric);
drop function if exists public.admin_update_delivery_settings(boolean,numeric);
drop function if exists public.admin_get_delivery_settings();
drop function if exists public.get_delivery_enabled();
drop table if exists feira_cost_private.order_delivery_costs;

drop policy if exists "Customers and admin can view permitted orders" on public.orders;
create policy "Customers and admin can view permitted orders" on public.orders for select to authenticated
 using ((user_id=(select auth.uid())) or exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));

-- Restaurar funcao de relatorio anterior, sem pedidos de teste nem campos Lalamove.
create or replace function public.admin_get_cost_report(p_start timestamptz,p_end timestamptz)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_result jsonb;
begin
 if auth.uid() is null or not public.is_current_user_admin() then raise exception 'Acesso permitido somente a administradores.' using errcode='42501'; end if;
 if p_start is null or p_end is null or p_end<=p_start then raise exception 'Periodo invalido: a data final deve ser posterior a inicial.' using errcode='22023'; end if;
 with paid_orders as materialized (
  select o.id from public.orders o where o.created_at>=p_start and o.created_at<p_end
   and lower(btrim(coalesce(o.status,''))) not in ('cancelada','cancelado','pagamento cancelado','pagamento recusado','pagamento reembolsado','pagamento contestado')
   and ((lower(coalesce(o.payment_method,'')) like '%pix%' and lower(btrim(coalesce(o.status,''))) in ('pagamento confirmado','preparando','pronto para retirada','saiu para entrega','entregue','pago','concluido','concluído'))
     or (lower(coalesce(o.payment_method,'')) not like '%pix%' and lower(btrim(coalesce(o.status,''))) in ('entregue','concluido','concluído')))
 ), period_items as (select s.* from feira_cost_private.order_item_snapshots s join paid_orders o on o.id=s.order_id),
 totals as (
  select count(distinct order_id)::integer order_count,coalesce(sum(sale_total),0)::numeric sales_total,
   coalesce(sum(sale_total) filter(where unit_cost is not null),0)::numeric known_revenue,
   coalesce(sum(cost_total) filter(where unit_cost is not null),0)::numeric known_cost,
   coalesce(sum(profit) filter(where unit_cost is not null),0)::numeric profit,
   count(*) filter(where cost_status='missing_cost')::integer missing_cost_items,
   count(*) filter(where cost_status='invalid_item')::integer invalid_items from period_items
 )
 select jsonb_build_object('summary',jsonb_build_object('orders',totals.order_count,'sales_total',totals.sales_total,
  'known_revenue',totals.known_revenue,'known_cost',totals.known_cost,'profit',totals.profit,
  'profit_percent',case when totals.known_revenue>0 then round(100*totals.profit/totals.known_revenue,2) else null end,
  'missing_cost_items',totals.missing_cost_items,'invalid_items',totals.invalid_items),
  'products',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'category',p.category,'price',p.price,
   'available',p.available,'unit_cost',pc.unit_cost,'updated_at',pc.updated_at) order by p.name
   from public.products p left join feira_cost_private.product_costs pc on pc.product_id=p.id),'[]'::jsonb))
 into v_result from totals;
 return v_result;
end;
$function$;

drop table if exists public.delivery_settings;
alter table public.orders drop column if exists delivery_address,drop column if exists delivery_vehicle,
 drop column if exists delivery_weight_kg,drop column if exists lalamove_order_id,drop column if exists lalamove_status,
 drop column if exists lalamove_tracking_url,drop column if exists lalamove_driver,
 drop column if exists lalamove_status_updated_at,drop column if exists is_test_order;
alter table public.customer_profiles drop column if exists address_street,drop column if exists address_number,
 drop column if exists address_neighborhood,drop column if exists address_complement,drop column if exists address_reference;
alter table public.products drop column if exists delivery_unit_weight_kg,drop column if exists delivery_bulky;
commit;
