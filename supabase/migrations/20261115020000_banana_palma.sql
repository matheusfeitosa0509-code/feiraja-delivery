-- Converte Banana prata para unidade comercial palma sem alterar o preço cadastrado.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = 'feiraja_banana_prata') THEN
    RAISE EXCEPTION 'Produto feiraja_banana_prata não encontrado; migração cancelada.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.product_sales_rules WHERE product_id = 'feiraja_banana_prata') THEN
    RAISE EXCEPTION 'Regra de venda da banana não encontrada; migração cancelada.';
  END IF;
END;
$$;

UPDATE public.products
SET name = 'Banana (palma)', available = false
WHERE id = 'feiraja_banana_prata';

UPDATE public.product_sales_rules
SET sale_unit = 'maco',
    min_quantity = 1,
    quantity_step = 1,
    allow_value_sale = false,
    value_min_kg = 1
WHERE product_id = 'feiraja_banana_prata';

COMMIT;
