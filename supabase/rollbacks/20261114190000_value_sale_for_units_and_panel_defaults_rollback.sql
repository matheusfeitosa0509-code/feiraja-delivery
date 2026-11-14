BEGIN;

DROP FUNCTION IF EXISTS public.admin_create_product_with_sales_rule(text, text, numeric, text, text, text);

CREATE OR REPLACE FUNCTION public.admin_set_product_value_sale(p_product_id text, p_enabled boolean)
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
  IF v_sale_unit IS DISTINCT FROM 'kg' THEN
    RAISE EXCEPTION 'A compra por valor só pode ser liberada para produtos vendidos por kg.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.product_sales_rules
  SET allow_value_sale = p_enabled
  WHERE product_id = p_product_id;
  RETURN jsonb_build_object('success', true, 'product_id', p_product_id, 'allow_value_sale', p_enabled);
END;
$function$;

-- Restore the previous production state: only the three originally enabled kg products.
UPDATE public.product_sales_rules
SET allow_value_sale = false
WHERE sale_unit IN ('kg', 'maco', 'un', 'pacote', 'duzia');

UPDATE public.product_sales_rules
SET allow_value_sale = true
WHERE product_id IN ('feiraja_abacate', 'feiraja_abobora', 'feiraja_abobrinha');

-- Remove only the explicit whole-unit rules created by this migration.
DELETE FROM public.product_sales_rules
WHERE product_id IN (
  'feiraja_abacaxi',
  'feiraja_acafrao_pacote',
  'feiraja_acai_1_litro',
  'feiraja_agriao_maco',
  'feiraja_alface',
  'feiraja_cebolinha_maco',
  'feiraja_cheiro_verde_maco',
  'feiraja_chicoria_maco',
  'feiraja_agua_de_coco_unidade',
  'feiraja_coentro_maco',
  'feiraja_colorau_pacote',
  'feiraja_cominho_pacote',
  'feiraja_couve',
  'feiraja_espinafre_maco',
  'prod_1793063885330',
  'feiraja_farinha_tapioca_500g',
  'feiraja_farinha_tapioca_castanha_280g',
  'feiraja_goma_tapioca_500g',
  'feiraja_hortela_maco',
  'feiraja_louro_pacote',
  'feiraja_melancia_g',
  'feiraja_melancia_m',
  'feiraja_morango_250g',
  'feiraja_oregano_pacote',
  'feiraja_ovo',
  'feiraja_rucula_maco'
);

COMMIT;
