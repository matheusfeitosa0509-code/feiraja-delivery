BEGIN;

DROP FUNCTION IF EXISTS public.admin_update_product_sales_rule(text,text,numeric,numeric,boolean,numeric);

-- Restore only the product names and sales-rule values touched by this migration.
UPDATE public.products SET name='Brócolis (kg)' WHERE id='feiraja_brocolis_unidade';
UPDATE public.products SET name='Couve-flor (kg)' WHERE id='feiraja_couve_flor_unidade';
UPDATE public.products SET name='Salsinha (kg)' WHERE id='feiraja_salsinha_maco';
UPDATE public.products SET name='Farinha Branca (kg)' WHERE id='feiraja_farinha_branca_1kg';
UPDATE public.products SET name='Farinha Ova Caroço (kg)' WHERE id='feiraja_farinha_ova_caroco_1kg';
UPDATE public.products SET name='Farinha Ovinha (kg)' WHERE id='feiraja_farinha_ovinha_1kg';
UPDATE public.products SET name='Goma de Tapioca (kg)' WHERE id='feiraja_goma_tapioca_1kg';

DELETE FROM public.product_sales_rules
WHERE product_id IN (
 'feiraja_camarao_10_gramas','feiraja_camarao_12_grama','feiraja_camarao_maranhao_gg',
 'feiraja_camarao_pelado','feiraja_camarao_tutoia_1kg','feiraja_caranguejo_1kg',
 'feiraja_cabeca_de_alho_1kg','feiraja_brocolis_unidade','feiraja_couve_flor_unidade',
 'feiraja_salsinha_maco','feiraja_farinha_branca_1kg','feiraja_farinha_ova_caroco_1kg',
 'feiraja_farinha_ovinha_1kg','feiraja_goma_tapioca_1kg'
);

UPDATE public.product_sales_rules
SET min_quantity=1,quantity_step=0.5,value_min_kg=1
WHERE product_id='feiraja_pimenta_kg';

UPDATE public.products SET resale_unit='kg'
WHERE id IN ('feiraja_farinha_ova_caroco_1kg','feiraja_farinha_ovinha_1kg')
  AND resale_enabled=true;

COMMIT;
