BEGIN;

DELETE FROM public.product_sales_rules
WHERE product_id = 'feiraja_uva_500g'
  AND sale_unit = 'kg'
  AND quantity_step = 0.5
  AND min_quantity = 0.5
  AND allow_value_sale = true
  AND value_min_kg = 0.5;

-- Reversão da indisponibilidade aplicada por esta migration.
UPDATE public.products
SET available = true
WHERE id = 'feiraja_uva_500g'
  AND name = 'Uva (kg)'
  AND price = 9.99
  AND available = false;

COMMIT;
