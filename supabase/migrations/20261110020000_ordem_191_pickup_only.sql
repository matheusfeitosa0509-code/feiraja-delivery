-- Ordem 191: retirada exclusiva, código pessoal e pagamento na retirada.
-- Preparada para revisão. NÃO APLICAR sem autorização explícita.
BEGIN;
ALTER TABLE public.orders ADD COLUMN pickup_code text;
ALTER TABLE public.orders ADD CONSTRAINT orders_pickup_code_format_check
CHECK ((delivery_type = 'pickup_uber' AND pickup_code IS NOT NULL AND pickup_code ~ '^[0-9]{4}

DO $migration$
DECLARE
  v_definition text;
BEGIN
  v_definition := pg_get_functiondef('public.create_order_with_rate_limit(jsonb)'::regprocedure);
  v_definition := replace(v_definition,
    E'    delivery_type,\n    payment_method,',
    E'    delivery_type,\n    pickup_code,\n    payment_method,');
  v_definition := replace(v_definition,
    E'    p_order->>''delivery_type'',\n    p_order->>''payment_method'',',
    E'    p_order->>''delivery_type'',\n    p_order->>''pickup_code'',\n    p_order->>''payment_method'',');
  IF position('pickup_code' in v_definition) = 0 THEN
    RAISE EXCEPTION 'Não foi possível preparar create_order_with_rate_limit';
  END IF;
  EXECUTE v_definition;

  v_definition := pg_get_functiondef('public.push_orders_notify()'::regprocedure);
  v_definition := replace(v_definition, '''Dinheiro na entrega''', '''Dinheiro na retirada'', ''Dinheiro na entrega''');
  v_definition := replace(v_definition, '''Cartão na entrega''', '''Cartão na retirada'', ''Cartão na entrega''');
  IF position('Dinheiro na retirada' in v_definition) = 0 THEN
    RAISE EXCEPTION 'Não foi possível atualizar push_orders_notify';
  END IF;
  EXECUTE v_definition;
END
$migration$;
COMMIT;
)
 OR (delivery_type <> 'pickup_uber' AND pickup_code IS NULL));

DO $migration$
DECLARE
  v_definition text;
BEGIN
  v_definition := pg_get_functiondef('public.create_order_with_rate_limit(jsonb)'::regprocedure);
  v_definition := replace(v_definition,
    E'    delivery_type,\n    payment_method,',
    E'    delivery_type,\n    pickup_code,\n    payment_method,');
  v_definition := replace(v_definition,
    E'    p_order->>''delivery_type'',\n    p_order->>''payment_method'',',
    E'    p_order->>''delivery_type'',\n    p_order->>''pickup_code'',\n    p_order->>''payment_method'',');
  IF position('pickup_code' in v_definition) = 0 THEN
    RAISE EXCEPTION 'Não foi possível preparar create_order_with_rate_limit';
  END IF;
  EXECUTE v_definition;

  v_definition := pg_get_functiondef('public.push_orders_notify()'::regprocedure);
  v_definition := replace(v_definition, '''Dinheiro na entrega''', '''Dinheiro na retirada''');
  v_definition := replace(v_definition, '''Cartão na entrega''', '''Cartão na retirada''');
  IF position('Dinheiro na retirada' in v_definition) = 0 THEN
    RAISE EXCEPTION 'Não foi possível atualizar push_orders_notify';
  END IF;
  EXECUTE v_definition;
END
$migration$;
COMMIT;
