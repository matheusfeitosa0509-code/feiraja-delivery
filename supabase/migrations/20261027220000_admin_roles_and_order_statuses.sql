-- FeiraJá security and order workflow migration.
-- This migration creates a separate admin membership table; it does not modify existing users, orders, or products.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
drop policy if exists "Admins can read own admin membership" on public.admin_users;
create policy "Admins can read own admin membership"
  on public.admin_users for select to authenticated
  using (user_id = (select auth.uid()));
grant select on public.admin_users to authenticated;

-- Preserve the current store administrator by adding a membership row, without changing the auth.users account.
insert into public.admin_users(user_id)
select id from auth.users where lower(email) = lower('matheusfeitosa0509@gmail.com')
on conflict (user_id) do nothing;

drop policy if exists "Customers and admin can view permitted orders" on public.orders;
create policy "Customers and admin can view permitted orders"
  on public.orders for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()))
  );

drop policy if exists "Admin can update order status" on public.orders;
create policy "Admin can update order status"
  on public.orders for update to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())))
  with check (
    exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()))
    and status = any (array[
      'Pedido Recebido','Pagamento Pendente','Pagamento Confirmado',
      'Preparando','Pronto para Retirada','Saiu para Entrega','Entregue','Cancelada',
      'Recebido','Aguardando Pagamento Pix','Pago','Pagamento em análise',
      'Pagamento recusado','Pagamento cancelado','Pagamento reembolsado',
      'Pagamento contestado','Preparando pedido','Saiu para entrega',
      'Concluído','Concluido','Cancelado'
    ]::text[])
  );
revoke update on table public.orders from authenticated;
grant update (status) on table public.orders to authenticated;

drop policy if exists "Administrador deletes products" on public.products;
create policy "Administrador deletes products"
  on public.products for delete to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
drop policy if exists "Administrador inserts products" on public.products;
create policy "Administrador inserts products"
  on public.products for insert to authenticated
  with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
drop policy if exists "Administrador updates products" on public.products;
create policy "Administrador updates products"
  on public.products for update to authenticated
  using (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.admin_users a where a.user_id = (select auth.uid())));
