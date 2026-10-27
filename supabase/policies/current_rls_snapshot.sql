-- SNAPSHOT ONLY: policies verified in production on 2026-10-27.
-- This file documents the current RLS state; do not apply as a migration because the policies already exist.
alter table public.admin_users enable row level security;
alter table public.customer_profiles enable row level security;
alter table public.orders enable row level security;
alter table public.products enable row level security;

-- public.admin_users
-- SELECT, roles={authenticated}, qual=(user_id = (select auth.uid()))
-- CREATE POLICY "Admins can read own admin membership" ON public.admin_users
--   FOR SELECT TO authenticated USING (user_id = (select auth.uid()));

-- public.customer_profiles
-- CREATE POLICY "Customers insert own profile" ON public.customer_profiles
--   FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id);
-- CREATE POLICY "Customers read own profile" ON public.customer_profiles
--   FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
-- CREATE POLICY "Customers update own profile" ON public.customer_profiles
--   FOR UPDATE TO authenticated USING ((select auth.uid()) = user_id)
--   WITH CHECK ((select auth.uid()) = user_id);

-- public.orders
-- CREATE POLICY "Customers and admin can view permitted orders" ON public.orders
--   FOR SELECT TO authenticated USING (
--     user_id = (select auth.uid())
--     OR EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = (select auth.uid()))
--   );
-- CREATE POLICY "Admin can update order status" ON public.orders
--   FOR UPDATE TO authenticated
--   USING (EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = (select auth.uid())))
--   WITH CHECK (
--     EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = (select auth.uid()))
--     AND status = ANY (ARRAY[
--       'Pedido Recebido','Pagamento Pendente','Pagamento Confirmado','Preparando',
--       'Pronto para Retirada','Saiu para Entrega','Entregue','Cancelada','Recebido',
--       'Aguardando Pagamento Pix','Pago','Pagamento em análise','Pagamento recusado',
--       'Pagamento cancelado','Pagamento reembolsado','Pagamento contestado',
--       'Preparando pedido','Saiu para entrega','Concluído','Concluido','Cancelado'
--     ]::text[]);
--   );
-- UPDATE privilege is restricted to the status column:
-- REVOKE UPDATE ON TABLE public.orders FROM authenticated;
-- GRANT UPDATE (status) ON TABLE public.orders TO authenticated;

-- public.products
-- CREATE POLICY "Public can view available products" ON public.products
--   FOR SELECT TO anon, authenticated USING (available = true);
-- CREATE POLICY "Administrador deletes products" ON public.products
--   FOR DELETE TO authenticated USING (
--     EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = (select auth.uid()))
--   );
-- CREATE POLICY "Administrador inserts products" ON public.products
--   FOR INSERT TO authenticated WITH CHECK (
--     EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = (select auth.uid()))
--   );
-- CREATE POLICY "Administrador updates products" ON public.products
--   FOR UPDATE TO authenticated USING (
--     EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = (select auth.uid()))
--   ) WITH CHECK (
--     EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = (select auth.uid()))
--   );
