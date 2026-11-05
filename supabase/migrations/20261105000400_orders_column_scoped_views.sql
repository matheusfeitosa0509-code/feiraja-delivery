-- Draft proposal only: do not apply until views, grants, and frontend are reviewed together.
-- Authenticated customers receive only their own order-history fields.
-- Admins receive the wider dashboard projection through a separate guarded view.

CREATE OR REPLACE VIEW public.customer_order_history
WITH (security_barrier = true)
AS
SELECT id, created_at, items, total, status, payment_method
FROM public.orders
WHERE user_id = (SELECT auth.uid());

CREATE OR REPLACE VIEW public.admin_order_dashboard
WITH (security_barrier = true)
AS
SELECT id, created_at, customer_name, customer_phone, customer_address,
       customer_email, delivery_type, payment_method, items, subtotal,
       delivery_fee, total, status, market_checklist
FROM public.orders
WHERE EXISTS (
  SELECT 1 FROM public.admin_users AS au
  WHERE au.user_id = (SELECT auth.uid())
);

-- Remove broad row-level SELECT paths; UPDATE(status) remains unchanged.
REVOKE SELECT ON TABLE public.orders FROM PUBLIC, anon, authenticated;
-- Admin status updates use UPDATE ... RETURNING id in admin.html.
GRANT SELECT (id) ON TABLE public.orders TO authenticated;
GRANT SELECT ON TABLE public.customer_order_history TO authenticated;
GRANT SELECT ON TABLE public.admin_order_dashboard TO authenticated;

-- The views are intentionally owner-executed (security_invoker defaults false).
-- Their WHERE clauses above are the row-security boundary and must not be removed.
