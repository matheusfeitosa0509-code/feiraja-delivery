-- Rollback da edição de custo por item.
BEGIN;
REVOKE ALL ON FUNCTION public.admin_update_order_item_cost(text, integer, numeric, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.admin_update_order_item_cost(text, integer, numeric, boolean);
DROP TABLE IF EXISTS feira_cost_private.order_item_cost_history;
COMMIT;
