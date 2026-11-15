-- Rollback da fundacao de dados Lalamove. Antes de uso real.
begin;
drop function if exists public.admin_get_cost_report_with_delivery(timestamptz,timestamptz);
drop function if exists public.admin_set_lalamove_actual_cost(text,numeric);
drop function if exists public.admin_update_delivery_settings(boolean,numeric);
drop function if exists public.admin_get_delivery_settings();
drop function if exists public.get_delivery_enabled();
drop table if exists feira_cost_private.order_delivery_costs;

drop table if exists public.delivery_settings;
alter table public.orders drop column if exists delivery_address,drop column if exists delivery_vehicle,
 drop column if exists delivery_weight_kg,drop column if exists lalamove_order_id,drop column if exists lalamove_status,
 drop column if exists lalamove_tracking_url,drop column if exists lalamove_driver,
 drop column if exists lalamove_status_updated_at,drop column if exists is_test_order;
alter table public.customer_profiles drop column if exists address_street,drop column if exists address_number,
 drop column if exists address_neighborhood,drop column if exists address_complement,drop column if exists address_reference;
alter table public.products drop column if exists delivery_unit_weight_kg,drop column if exists delivery_bulky;
commit;
