-- Rollback dos mínimos em kg e do limite de alerta de margem.
BEGIN;
DROP FUNCTION IF EXISTS public.admin_set_low_margin_percent(numeric);
DROP FUNCTION IF EXISTS public.admin_set_product_value_minimum(text, numeric);
CREATE OR REPLACE FUNCTION public.get_sales_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_min_value_cents integer;
BEGIN
  SELECT s.min_value_cents INTO v_min_value_cents
  FROM feira_cost_private.sales_settings AS s
  WHERE s.setting_key = 'global';
  RETURN jsonb_build_object('min_value_cents', COALESCE(v_min_value_cents, 500));
END;
$function$;
ALTER FUNCTION public.get_sales_settings() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_sales_settings()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sales_settings() TO anon, authenticated, service_role;

ALTER TABLE feira_cost_private.sales_settings DROP COLUMN IF EXISTS low_margin_percent;
ALTER TABLE public.product_sales_rules DROP COLUMN IF EXISTS value_min_kg;
UPDATE public.product_sales_rules SET min_quantity = 0.5 WHERE sale_unit = 'kg';
COMMIT;
