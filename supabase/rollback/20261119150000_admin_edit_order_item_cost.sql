-- Rollback da edição de custo por item.
BEGIN;
DO $
BEGIN
  IF EXISTS (SELECT 1 FROM feira_cost_private.product_costs WHERE unit_cost <= 0) THEN
    RAISE EXCEPTION 'Rollback interrompido: existem custos padrão zero. Revise esses produtos antes de restaurar a regra antiga (> 0).';
  END IF;
END $;
ALTER TABLE feira_cost_private.product_costs
  DROP CONSTRAINT IF EXISTS product_costs_unit_cost_nonnegative;
ALTER TABLE feira_cost_private.product_costs
  ADD CONSTRAINT product_costs_unit_cost_check CHECK (unit_cost > 0);
REVOKE ALL ON FUNCTION public.admin_update_order_item_cost(text, integer, numeric, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.admin_update_order_item_cost(text, integer, numeric, boolean);
DROP TABLE IF EXISTS feira_cost_private.order_item_cost_history;
COMMIT;
