-- ORDEM F: idempotência atômica do checkout e recuperação da mesma cobrança Pix.
-- Preparada para revisão. NÃO APLICAR sem autorização explícita do proprietário.
BEGIN;

CREATE TABLE public.checkout_idempotency (
  idempotency_key uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  order_id text NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  payment_lock_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

ALTER TABLE public.checkout_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.checkout_idempotency FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.checkout_idempotency TO service_role;

CREATE OR REPLACE FUNCTION public.create_order_with_rate_limit(p_order jsonb)
RETURNS TABLE (order_id text, order_status text, order_total numeric)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid;
  v_idempotency_key uuid;
  v_request_hash text;
  v_existing_order_id text;
  v_existing_user_id uuid;
  v_existing_request_hash text;
  v_recent_count bigint;
  v_order_id text;
  v_status text;
  v_total numeric;
BEGIN
  IF p_order IS NULL OR pg_catalog.jsonb_typeof(p_order) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INVALID_ORDER_PAYLOAD' USING ERRCODE = '22023';
  END IF;

  v_user_id := NULLIF(p_order->>'user_id', '')::uuid;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_USER_ID' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_order->>'checkout_idempotency_key', '') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR COALESCE(p_order->>'checkout_request_hash', '') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_CHECKOUT_IDEMPOTENCY' USING ERRCODE = '22023';
  END IF;

  v_idempotency_key := (p_order->>'checkout_idempotency_key')::uuid;
  v_request_hash := p_order->>'checkout_request_hash';

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_idempotency_key::text, 0)
  );

  SELECT i.order_id, i.user_id, i.request_hash
    INTO v_existing_order_id, v_existing_user_id, v_existing_request_hash
    FROM public.checkout_idempotency AS i
   WHERE i.idempotency_key = v_idempotency_key;

  IF FOUND THEN
    IF v_existing_user_id IS DISTINCT FROM v_user_id
       OR v_existing_request_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'CHECKOUT_IDEMPOTENCY_CONFLICT' USING ERRCODE = '23505';
    END IF;

    SELECT o.id, o.status, o.total
      INTO v_order_id, v_status, v_total
      FROM public.orders AS o
     WHERE o.id = v_existing_order_id
       AND o.user_id = v_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CHECKOUT_ORDER_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    RETURN QUERY SELECT v_order_id, v_status, v_total;
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  SELECT pg_catalog.count(*)
    INTO v_recent_count
    FROM public.orders AS o
   WHERE o.user_id = v_user_id
     AND o.created_at >= pg_catalog.now() - INTERVAL '10 minutes';

  IF v_recent_count >= 5 THEN
    RAISE EXCEPTION 'ORDER_RATE_LIMIT' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.orders (
    id, user_id, customer_name, customer_phone, customer_cpf, customer_email,
    customer_address, delivery_type, pickup_code, payment_method, payment_provider,
    items, subtotal, delivery_fee, total, status, market_checklist
  )
  VALUES (
    p_order->>'id', v_user_id, p_order->>'customer_name', p_order->>'customer_phone',
    p_order->>'customer_cpf', p_order->>'customer_email', p_order->>'customer_address',
    p_order->>'delivery_type', p_order->>'pickup_code', p_order->>'payment_method',
    p_order->>'payment_provider', p_order->'items', (p_order->>'subtotal')::numeric,
    (p_order->>'delivery_fee')::numeric, (p_order->>'total')::numeric,
    p_order->>'status', p_order->'market_checklist'
  )
  RETURNING id, status, total INTO v_order_id, v_status, v_total;

  INSERT INTO public.checkout_idempotency (
    idempotency_key, user_id, request_hash, order_id
  )
  VALUES (v_idempotency_key, v_user_id, v_request_hash, v_order_id);

  RETURN QUERY SELECT v_order_id, v_status, v_total;
END;
$$;

ALTER FUNCTION public.create_order_with_rate_limit(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_order_with_rate_limit(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_order_with_rate_limit(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_checkout_payment(p_idempotency_key uuid, p_user_id uuid)
RETURNS TABLE (order_id text, claimed boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order_id text;
BEGIN
  UPDATE public.checkout_idempotency AS i
     SET payment_lock_until = pg_catalog.clock_timestamp() + INTERVAL '10 minutes'
   WHERE i.idempotency_key = p_idempotency_key
     AND i.user_id = p_user_id
     AND (i.payment_lock_until IS NULL OR i.payment_lock_until < pg_catalog.clock_timestamp())
  RETURNING i.order_id INTO v_order_id;

  IF FOUND THEN
    RETURN QUERY SELECT v_order_id, true;
    RETURN;
  END IF;

  SELECT i.order_id INTO v_order_id
    FROM public.checkout_idempotency AS i
   WHERE i.idempotency_key = p_idempotency_key
     AND i.user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHECKOUT_ATTEMPT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY SELECT v_order_id, false;
END;
$$;

ALTER FUNCTION public.claim_checkout_payment(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_checkout_payment(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_checkout_payment(uuid, uuid) TO service_role;

COMMIT;
