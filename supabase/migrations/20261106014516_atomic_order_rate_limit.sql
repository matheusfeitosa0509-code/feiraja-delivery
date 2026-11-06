CREATE OR REPLACE FUNCTION public.create_order_with_rate_limit(
  p_order jsonb
)
RETURNS TABLE (
  order_id text,
  order_status text,
  order_total numeric
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid;
  v_recent_count bigint;
  v_order_id text;
  v_status text;
  v_total numeric;
BEGIN
  IF p_order IS NULL
     OR pg_catalog.jsonb_typeof(p_order)
        IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INVALID_ORDER_PAYLOAD'
      USING ERRCODE = '22023';
  END IF;

  v_user_id := NULLIF(p_order->>'user_id', '')::uuid;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_USER_ID'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  SELECT pg_catalog.count(*)
    INTO v_recent_count
  FROM public.orders AS o
  WHERE o.user_id = v_user_id
    AND o.created_at >=
        pg_catalog.now() - INTERVAL '10 minutes';

  IF v_recent_count >= 5 THEN
    RAISE EXCEPTION 'ORDER_RATE_LIMIT'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.orders (
    id,
    user_id,
    customer_name,
    customer_phone,
    customer_cpf,
    customer_email,
    customer_address,
    delivery_type,
    payment_method,
    payment_provider,
    items,
    subtotal,
    delivery_fee,
    total,
    status,
    market_checklist
  )
  VALUES (
    p_order->>'id',
    v_user_id,
    p_order->>'customer_name',
    p_order->>'customer_phone',
    p_order->>'customer_cpf',
    p_order->>'customer_email',
    p_order->>'customer_address',
    p_order->>'delivery_type',
    p_order->>'payment_method',
    p_order->>'payment_provider',
    p_order->'items',
    (p_order->>'subtotal')::numeric,
    (p_order->>'delivery_fee')::numeric,
    (p_order->>'total')::numeric,
    p_order->>'status',
    p_order->'market_checklist'
  )
  RETURNING id, status, total
  INTO v_order_id, v_status, v_total;

  RETURN QUERY
  SELECT v_order_id, v_status, v_total;
END;
$$;

ALTER FUNCTION public.create_order_with_rate_limit(jsonb)
OWNER TO postgres;

REVOKE ALL ON FUNCTION
  public.create_order_with_rate_limit(jsonb)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.create_order_with_rate_limit(jsonb)
TO service_role;
