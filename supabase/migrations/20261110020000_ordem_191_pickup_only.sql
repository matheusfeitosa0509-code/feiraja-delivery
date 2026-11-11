-- Ordem 191: retirada exclusiva, código pessoal e pagamento na retirada.
-- Preparada para revisão. NÃO APLICAR sem autorização explícita.
BEGIN;
ALTER TABLE public.orders ADD COLUMN pickup_code text;
ALTER TABLE public.orders ADD CONSTRAINT orders_pickup_code_format_check
CHECK (
  (delivery_type = 'pickup_uber' AND pickup_code IS NOT NULL AND pickup_code ~ '^[0-9]{4}$')
  OR (delivery_type <> 'pickup_uber' AND pickup_code IS NULL)
);

DO $ordem193$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  v_definition := pg_get_functiondef(
    'public.create_order_with_rate_limit(jsonb)'::regprocedure
  );

  v_old := '    delivery_type,' || chr(10) || '    payment_method,';
  v_new := '    delivery_type,' || chr(10) ||
           '    pickup_code,' || chr(10) || '    payment_method,';
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Falha no replace 1/4: lista de colunas de create_order_with_rate_limit não encontrada';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  IF position(v_new IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Falha no replace 1/4: lista de colunas de create_order_with_rate_limit não foi inserida';
  END IF;

  v_old := '    p_order->>''delivery_type'',' || chr(10) ||
           '    p_order->>''payment_method'',';
  v_new := '    p_order->>''delivery_type'',' || chr(10) ||
           '    p_order->>''pickup_code'',' || chr(10) ||
           '    p_order->>''payment_method'',';
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Falha no replace 2/4: lista de valores de create_order_with_rate_limit não encontrada';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  IF position(v_new IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Falha no replace 2/4: lista de valores de create_order_with_rate_limit não foi inserida';
  END IF;

  EXECUTE v_definition;

  v_definition := pg_get_functiondef(
    'public.push_orders_notify()'::regprocedure
  );

  v_old := '''Dinheiro na entrega''';
  v_new := '''Dinheiro na retirada'', ''Dinheiro na entrega''';
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Falha no replace 3/4: rótulo Dinheiro na entrega não encontrado em push_orders_notify';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  IF position(v_new IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Falha no replace 3/4: rótulo Dinheiro na retirada não foi inserido em push_orders_notify';
  END IF;

  v_old := '''Cartão na entrega''';
  v_new := '''Cartão na retirada'', ''Cartão na entrega''';
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Falha no replace 4/4: rótulo Cartão na entrega não encontrado em push_orders_notify';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  IF position(v_new IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Falha no replace 4/4: rótulo Cartão na retirada não foi inserido em push_orders_notify';
  END IF;

  EXECUTE v_definition;
END
$ordem193$;
COMMIT;
