BEGIN;

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.products
  WHERE id = 'feiraja_uva_500g'
    AND name = 'Uva (kg)'
    AND price = 9.99;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Esperada exatamente uma Uva (kg), ID feiraja_uva_500g, preço 9.99; nenhuma alteração foi aplicada.';
  END IF;
END;
$$;

UPDATE public.products
SET available = false
WHERE id = 'feiraja_uva_500g'
  AND name = 'Uva (kg)'
  AND price = 9.99;

INSERT INTO public.product_sales_rules
  (product_id, sale_unit, quantity_step, min_quantity, max_quantity, allow_value_sale, value_min_kg)
VALUES
  ('feiraja_uva_500g', 'kg', 0.5, 0.5, 100, true, 0.5)
ON CONFLICT (product_id) DO UPDATE SET
  sale_unit = EXCLUDED.sale_unit,
  quantity_step = EXCLUDED.quantity_step,
  min_quantity = EXCLUDED.min_quantity,
  allow_value_sale = EXCLUDED.allow_value_sale,
  value_min_kg = EXCLUDED.value_min_kg;

COMMIT;
