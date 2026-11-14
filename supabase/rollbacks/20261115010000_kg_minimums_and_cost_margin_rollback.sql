-- Rollback dos mínimos em kg e do limite de alerta de margem.
BEGIN;
DROP FUNCTION IF EXISTS public.admin_set_low_margin_percent(numeric);
DROP FUNCTION IF EXISTS public.admin_set_product_value_minimum(text, numeric);
ALTER TABLE feira_cost_private.sales_settings DROP COLUMN IF EXISTS low_margin_percent;
ALTER TABLE public.product_sales_rules DROP COLUMN IF EXISTS value_min_kg;
UPDATE public.product_sales_rules SET min_quantity = 0.5 WHERE sale_unit = 'kg';
COMMIT;
