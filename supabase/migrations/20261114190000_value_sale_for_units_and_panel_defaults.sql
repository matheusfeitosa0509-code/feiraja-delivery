BEGIN;

-- The value helper is enabled for every currently configured sale unit.
-- Products whose names say "(kg)" but have no kg rule are intentionally excluded
-- until the owner confirms their real unit (see the audit list in the change report).
UPDATE public.product_sales_rules
SET allow_value_sale = true
WHERE sale_unit IN ('kg', 'maco', 'un', 'pacote', 'duzia');

-- Make the current implicit whole-unit behavior explicit for unambiguous products.
-- Keep the 15 kg-named/no-kg-rule products unchanged for owner review.
INSERT INTO public.product_sales_rules
  (product_id, sale_unit, quantity_step, min_quantity, max_quantity, allow_value_sale, value_min_kg)
SELECT p.id, 'un', 1, 1, 100, true, 1
FROM public.products AS p
WHERE p.id NOT IN (
  'feiraja_brocolis_unidade',
  'feiraja_cabeca_de_alho_1kg',
  'feiraja_camarao_10_gramas',
  'feiraja_camarao_12_grama',
  'feiraja_camarao_maranhao_gg',
  'feiraja_camarao_pelado',
  'feiraja_camarao_tutoia_1kg',
  'feiraja_caranguejo_1kg',
  'feiraja_couve_flor_unidade',
  'feiraja_farinha_branca_1kg',
  'feiraja_farinha_ova_caroco_1kg',
  'feiraja_farinha_ovinha_1kg',
  'feiraja_goma_tapioca_1kg',
  'feiraja_salsinha_maco',
  'feiraja_uva_500g',
  'teste_painel_nao_vender_20261114'
)
AND NOT EXISTS (
  SELECT 1
  FROM public.product_sales_rules AS existing
  WHERE existing.product_id = p.id
);

CREATE OR REPLACE FUNCTION public.admin_set_product_value_sale(
  p_product_id text,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_sale_unit text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Acesso permitido somente a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_product_id IS NULL OR length(trim(p_product_id)) = 0 OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'Produto ou estado inválido.' USING ERRCODE = '22023';
  END IF;
  SELECT r.sale_unit INTO v_sale_unit
  FROM public.product_sales_rules AS r
  WHERE r.product_id = p_product_id;
  IF v_sale_unit IS NULL OR v_sale_unit NOT IN ('kg', 'un', 'pacote', 'maco', 'duzia') THEN
    RAISE EXCEPTION 'A compra por valor não está configurada para este produto.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.product_sales_rules
  SET allow_value_sale = p_enabled
  WHERE product_id = p_product_id;
  RETURN jsonb_build_object('success', true, 'product_id', p_product_id, 'allow_value_sale', p_enabled);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_create_product_with_sales_rule(
  p_id text,
  p_name text,
  p_price numeric,
  p_category text,
  p_image text,
  p_sale_unit text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_id text;
  v_step numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Acesso permitido somente a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR length(btrim(p_id)) = 0
     OR p_name IS NULL OR length(btrim(p_name)) = 0
     OR p_price IS NULL OR p_price <= 0
     OR p_category IS NULL OR length(btrim(p_category)) = 0
     OR p_sale_unit IS NULL OR p_sale_unit NOT IN ('kg', 'un', 'pacote', 'maco', 'duzia') THEN
    RAISE EXCEPTION 'Dados do produto ou unidade de venda inválidos.' USING ERRCODE = '22023';
  END IF;

  v_id := btrim(p_id);
  v_step := CASE WHEN p_sale_unit = 'kg' THEN 0.5 ELSE 1 END;

  INSERT INTO public.products (id, name, price, category, image, available)
  VALUES (v_id, btrim(p_name), p_price, btrim(p_category), NULLIF(btrim(COALESCE(p_image, '')), ''), true);

  INSERT INTO public.product_sales_rules
    (product_id, sale_unit, quantity_step, min_quantity, max_quantity, allow_value_sale, value_min_kg)
  VALUES
    (v_id, p_sale_unit, v_step, 1, 100, true, 1);

  RETURN jsonb_build_object(
    'success', true,
    'product_id', v_id,
    'sale_unit', p_sale_unit,
    'allow_value_sale', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_create_product_with_sales_rule(text, text, numeric, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_product_with_sales_rule(text, text, numeric, text, text, text) TO authenticated;

COMMIT;
