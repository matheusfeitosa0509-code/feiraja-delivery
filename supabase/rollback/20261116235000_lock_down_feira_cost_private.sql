-- Rollback do bloqueio do schema feira_cost_private.
-- Restaura o estado anterior observado em produção antes desta migração.
begin;

revoke all on all tables in schema feira_cost_private from service_role;
revoke all on all sequences in schema feira_cost_private from service_role;
revoke all on schema feira_cost_private from service_role;

alter default privileges for role postgres in schema feira_cost_private
  revoke all on tables from service_role;
alter default privileges for role postgres in schema feira_cost_private
  revoke all on sequences from service_role;

create policy admins_manage_product_costs
  on feira_cost_private.product_costs
  for all to authenticated
  using ((select public.is_current_user_admin()))
  with check ((select public.is_current_user_admin()));

create policy admins_read_order_item_cost_snapshots
  on feira_cost_private.order_item_snapshots
  for select to authenticated
  using ((select public.is_current_user_admin()));

create policy admins_read_snapshot_errors
  on feira_cost_private.snapshot_errors
  for select to authenticated
  using ((select public.is_current_user_admin()));

create policy admins_manage_sales_settings
  on feira_cost_private.sales_settings
  for all to authenticated
  using ((select public.is_current_user_admin()))
  with check ((select public.is_current_user_admin()));

alter table feira_cost_private.order_delivery_costs disable row level security;
alter table feira_cost_private.lalamove_dispatches disable row level security;
alter table feira_cost_private.lalamove_tracking_rate_limits disable row level security;
alter table feira_cost_private.lalamove_webhook_events disable row level security;

commit;
