-- ROLLBACK — snapshots privados de custo por item
-- Projeto: juhwdevvwstmyxyyagzh
-- Execute somente para desfazer a migration correspondente.
-- Não altera nem remove dados de products ou orders.

BEGIN;

DROP TRIGGER IF EXISTS trg_capture_order_item_costs ON public.orders;

DROP FUNCTION IF EXISTS public.admin_get_cost_report(timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.admin_set_product_cost(text, numeric);
DROP FUNCTION IF EXISTS feira_cost_private.capture_order_item_costs();

DROP TABLE IF EXISTS feira_cost_private.snapshot_errors;
DROP TABLE IF EXISTS feira_cost_private.order_item_snapshots;
DROP TABLE IF EXISTS feira_cost_private.product_costs;

DROP SCHEMA IF EXISTS feira_cost_private;

COMMIT;
