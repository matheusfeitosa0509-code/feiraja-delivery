-- Minimumos de venda por kg e margem de custo configuravel.
BEGIN;

ALTER TABLE public.product_sales_rules
  ADD COLUMN value_min_kg numeric(8,3) NOT NULL DEFAULT 1
  CHECK (value_min_kg > 0 AND value_min_kg <= 100);

UPDATE public.product_sales_rules
SET min_quantity = 1
WHERE sale_unit = 'kg';

UPDATE public.product_sales_rules
SET quantity_step = 0.5
WHERE sale_unit = 'kg';

ALTER TABLE feira_cost_private.sales_settings
  ADD COLUMN low_margin_percent numeric(5,2) NOT NULL DEFAULT 20
  CHECK (low_margin_percent >= 0 AND low_margin_percent <= 100);

CREATE OR REPLACE FUNCTION public.admin_set_product_value_minimum(
  p_product_id text,
  p_min_kg numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_max_quantity numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Acesso permitido somente a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_product_id IS NULL OR btrim(p_product_id) = ''
     OR p_min_kg IS NULL OR p_min_kg <= 0 OR p_min_kg > 100 THEN
    RAISE EXCEPTION 'Informe um produto e um mínimo em kg maior que zero, até 100 kg.' USING ERRCODE = '22023';
  END IF;
  SELECT r.max_quantity INTO v_max_quantity
  FROM public.product_sales_rules AS r
  WHERE r.product_id = p_product_id AND r.sale_unit = 'kg';
  IF v_max_quantity IS NULL THEN
    RAISE EXCEPTION 'O mínimo por valor só pode ser ajustado para produtos vendidos por kg.' USING ERRCODE = '22023';
  END IF;
  IF p_min_kg > v_max_quantity THEN
    RAISE EXCEPTION 'O mínimo não pode ultrapassar o limite máximo de peso do produto.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.product_sales_rules
  SET value_min_kg = p_min_kg
  WHERE product_id = p_product_id;
  RETURN jsonb_build_object('success', true, 'product_id', p_product_id, 'value_min_kg', p_min_kg);
END;
$function$;
ALTER FUNCTION public.admin_set_product_value_minimum(text, numeric) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_set_product_value_minimum(text, numeric)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_product_value_minimum(text, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_sales_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_min_value_cents integer;
  v_low_margin_percent numeric;
BEGIN
  SELECT s.min_value_cents, s.low_margin_percent
  INTO v_min_value_cents, v_low_margin_percent
  FROM feira_cost_private.sales_settings AS s
  WHERE s.setting_key = 'global';

  RETURN jsonb_build_object(
    'min_value_cents', COALESCE(v_min_value_cents, 500),
    'low_margin_percent', COALESCE(v_low_margin_percent, 20)
  );
END;
$function$;
ALTER FUNCTION public.get_sales_settings() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_sales_settings()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sales_settings() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_low_margin_percent(p_percent numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Acesso permitido somente a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_percent IS NULL OR p_percent < 0 OR p_percent > 100 THEN
    RAISE EXCEPTION 'A margem de alerta deve ficar entre 0%% e 100%%.' USING ERRCODE = '22023';
  END IF;
  UPDATE feira_cost_private.sales_settings
  SET low_margin_percent = p_percent, updated_at = now(), updated_by = auth.uid()
  WHERE setting_key = 'global';
  RETURN jsonb_build_object('success', true, 'low_margin_percent', p_percent);
END;
$function$;
ALTER FUNCTION public.admin_set_low_margin_percent(numeric) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_set_low_margin_percent(numeric)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_low_margin_percent(numeric) TO authenticated;

COMMIT;
