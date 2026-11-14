-- Reverte a conversão da banana para palma.
BEGIN;

UPDATE public.products
SET name = 'Banana prata (palma)', available = true
WHERE id = 'feiraja_banana_prata';

UPDATE public.product_sales_rules
SET sale_unit = 'kg',
    min_quantity = 1,
    quantity_step = 0.5,
    allow_value_sale = false,
    value_min_kg = 1
WHERE product_id = 'feiraja_banana_prata';

COMMIT;
