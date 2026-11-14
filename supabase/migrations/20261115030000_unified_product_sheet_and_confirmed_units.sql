BEGIN;

-- Administrative, validated entry point for changing the commercial sale rule.
CREATE OR REPLACE FUNCTION public.admin_update_product_sales_rule(
  p_product_id text,
  p_sale_unit text,
  p_min_quantity numeric,
  p_quantity_step numeric,
  p_allow_value_sale boolean,
  p_value_min_kg numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_max_quantity numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Acesso permitido somente a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_product_id IS NULL OR btrim(p_product_id) = ''
     OR p_sale_unit IS NULL OR p_sale_unit NOT IN ('kg', 'un', 'maco', 'pacote', 'duzia')
     OR p_min_quantity IS NULL OR p_min_quantity <= 0
     OR p_quantity_step IS NULL OR p_quantity_step <= 0
     OR p_allow_value_sale IS NULL THEN
    RAISE EXCEPTION 'Dados da regra de venda inválidos.' USING ERRCODE = '22023';
  END IF;
  IF p_sale_unit <> 'kg' AND
     (p_min_quantity <> trunc(p_min_quantity) OR p_quantity_step <> trunc(p_quantity_step)) THEN
    RAISE EXCEPTION 'Unidade, maço e pacote usam quantidades inteiras.' USING ERRCODE = '22023';
  END IF;
  IF mod(p_min_quantity, p_quantity_step) <> 0 THEN
    RAISE EXCEPTION 'O mínimo precisa respeitar o passo de venda.' USING ERRCODE = '22023';
  END IF;
  IF p_sale_unit = 'kg' AND
     (p_value_min_kg IS NULL OR p_value_min_kg <= 0 OR p_value_min_kg > 100
      OR p_value_min_kg <> p_min_quantity) THEN
    RAISE EXCEPTION 'O mínimo do pedido por valor deve ser igual ao mínimo do produto.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
    RAISE EXCEPTION 'Produto não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  SELECT max_quantity INTO v_max_quantity
  FROM public.product_sales_rules
  WHERE product_id = p_product_id;
  v_max_quantity := COALESCE(v_max_quantity, 100);
  IF p_min_quantity > v_max_quantity THEN
    RAISE EXCEPTION 'O mínimo não pode ultrapassar o máximo permitido.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.product_sales_rules
    (product_id, sale_unit, quantity_step, min_quantity, max_quantity, allow_value_sale, value_min_kg)
  VALUES
    (p_product_id, p_sale_unit, p_quantity_step, p_min_quantity, v_max_quantity,
     p_allow_value_sale, CASE WHEN p_sale_unit = 'kg' THEN p_value_min_kg ELSE 1 END)
  ON CONFLICT (product_id) DO UPDATE SET
    sale_unit = EXCLUDED.sale_unit,
    quantity_step = EXCLUDED.quantity_step,
    min_quantity = EXCLUDED.min_quantity,
    allow_value_sale = EXCLUDED.allow_value_sale,
    value_min_kg = EXCLUDED.value_min_kg;

  RETURN jsonb_build_object('success', true, 'product_id', p_product_id,
    'sale_unit', p_sale_unit, 'min_quantity', p_min_quantity,
    'quantity_step', p_quantity_step, 'allow_value_sale', p_allow_value_sale,
    'value_min_kg', CASE WHEN p_sale_unit = 'kg' THEN p_value_min_kg ELSE 1 END);
END;
$function$;
ALTER FUNCTION public.admin_update_product_sales_rule(text,text,numeric,numeric,boolean,numeric) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_update_product_sales_rule(text,text,numeric,numeric,boolean,numeric)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_product_sales_rule(text,text,numeric,numeric,boolean,numeric)
  TO authenticated;

-- Exact name corrections and commercial units; product prices are deliberately untouched.
UPDATE public.products SET name = 'Brócolis (unidade)' WHERE id = 'feiraja_brocolis_unidade';
UPDATE public.products SET name = 'Couve-flor (unidade)' WHERE id = 'feiraja_couve_flor_unidade';
UPDATE public.products SET name = 'Salsinha (maço)' WHERE id = 'feiraja_salsinha_maco';
UPDATE public.products SET name = 'Farinha Branca (1 kg)' WHERE id = 'feiraja_farinha_branca_1kg';
UPDATE public.products SET name = 'Farinha Ova Caroço (1 kg)' WHERE id = 'feiraja_farinha_ova_caroco_1kg';
UPDATE public.products SET name = 'Farinha Ovinha (1 kg)' WHERE id = 'feiraja_farinha_ovinha_1kg';
UPDATE public.products SET name = 'Goma de Tapioca (1 kg)' WHERE id = 'feiraja_goma_tapioca_1kg';

-- Confirmed kg prices: preserve products.price and resale_price values.
INSERT INTO public.product_sales_rules
  (product_id,sale_unit,quantity_step,min_quantity,max_quantity,allow_value_sale,value_min_kg)
VALUES
  ('feiraja_camarao_10_gramas','kg',0.5,0.5,100,true,0.5),
  ('feiraja_camarao_12_grama','kg',0.5,0.5,100,true,0.5),
  ('feiraja_camarao_maranhao_gg','kg',0.5,0.5,100,true,0.5),
  ('feiraja_camarao_pelado','kg',0.5,0.5,100,true,0.5),
  ('feiraja_camarao_tutoia_1kg','kg',0.5,0.5,100,true,0.5),
  ('feiraja_caranguejo_1kg','kg',0.5,0.5,100,true,0.5),
  ('feiraja_cabeca_de_alho_1kg','kg',0.25,0.25,100,true,0.25),
  ('feiraja_brocolis_unidade','un',1,1,100,false,1),
  ('feiraja_couve_flor_unidade','un',1,1,100,false,1),
  ('feiraja_salsinha_maco','maco',1,1,100,false,1),
  ('feiraja_farinha_branca_1kg','pacote',1,1,100,false,1),
  ('feiraja_farinha_ova_caroco_1kg','pacote',1,1,100,false,1),
  ('feiraja_farinha_ovinha_1kg','pacote',1,1,100,false,1),
  ('feiraja_goma_tapioca_1kg','pacote',1,1,100,false,1)
ON CONFLICT (product_id) DO UPDATE SET
  sale_unit=EXCLUDED.sale_unit,
  quantity_step=EXCLUDED.quantity_step,
  min_quantity=EXCLUDED.min_quantity,
  allow_value_sale=EXCLUDED.allow_value_sale,
  value_min_kg=EXCLUDED.value_min_kg;

UPDATE public.product_sales_rules
SET min_quantity=0.25, quantity_step=0.25, allow_value_sale=true, value_min_kg=0.25
WHERE product_id='feiraja_pimenta_kg' AND sale_unit='kg';

-- The reseller threshold remains 10 packages, not 10 kg, for these package products.
UPDATE public.products SET resale_unit='un'
WHERE id IN ('feiraja_farinha_ova_caroco_1kg','feiraja_farinha_ovinha_1kg','feiraja_goma_tapioca_1kg')
  AND resale_enabled=true;

COMMIT;
