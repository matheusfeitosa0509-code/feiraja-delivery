-- A3: non-reserving, privacy-safe eligibility preview for first-delivery promotion.
BEGIN;

CREATE OR REPLACE FUNCTION public.preview_first_delivery_promo(
  p_delivery_type text,
  p_subtotal numeric,
  p_delivery_fee numeric,
  p_phone text,
  p_address jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_settings promo_private.promo_settings%ROWTYPE;
  v_phone_key text;
  v_address_key text;
  v_discount numeric(12,2);
  v_reason text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_settings
  FROM promo_private.promo_settings
  WHERE singleton = true;

  IF NOT FOUND OR NOT v_settings.enabled OR v_settings.ends_at < pg_catalog.now() THEN
    v_reason := 'unavailable';
  ELSIF p_delivery_type IS DISTINCT FROM 'delivery' THEN
    v_reason := 'pickup';
  ELSIF p_subtotal IS NULL OR p_subtotal < v_settings.min_subtotal THEN
    v_reason := 'minimum_not_met';
  ELSIF p_delivery_fee IS NULL OR p_delivery_fee <= 0 THEN
    v_reason := 'quote_pending';
  ELSE
    v_phone_key := pg_catalog.regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
    v_address_key :=
      pg_catalog.regexp_replace(COALESCE(p_address->>'postal_code', ''), '[^0-9]', '', 'g')
      || '-' ||
      pg_catalog.lower(pg_catalog.regexp_replace(COALESCE(p_address->>'number', ''), '[[:space:]]+', '', 'g'));

    IF v_phone_key = '' OR v_address_key !~ '^[0-9]+-.+$' THEN
      v_reason := 'missing_details';
    ELSIF EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE COALESCE(o.is_test_order, false) = false
        AND o.status IN (
          'Pagamento Confirmado', 'Preparando', 'Pronto para Retirada',
          'Saiu para Entrega', 'Entregue', 'Concluído', 'Concluido'
        )
        AND (
          o.user_id = v_user_id
          OR pg_catalog.regexp_replace(COALESCE(o.customer_phone, ''), '[^0-9]', '', 'g') = v_phone_key
          OR (
            pg_catalog.regexp_replace(COALESCE(o.delivery_address->>'postal_code', ''), '[^0-9]', '', 'g')
              || '-' ||
            pg_catalog.lower(pg_catalog.regexp_replace(COALESCE(o.delivery_address->>'number', ''), '[[:space:]]+', '', 'g'))
          ) = v_address_key
        )
    ) OR EXISTS (
      SELECT 1
      FROM public.promo_redemptions r
      WHERE r.promo_code = 'PRIMEIRA_ENTREGA'
        AND r.status <> 'released'
        AND (
          r.user_id = v_user_id
          OR r.phone_key = v_phone_key
          OR r.address_key = v_address_key
        )
    ) THEN
      v_reason := 'already_used';
    ELSE
      v_reason := 'eligible';
    END IF;
  END IF;

  v_discount := CASE
    WHEN v_reason = 'eligible' THEN LEAST(
      GREATEST(COALESCE(p_delivery_fee, 0), 0),
      COALESCE(v_settings.discount_cap, GREATEST(COALESCE(p_delivery_fee, 0), 0))
    )
    ELSE 0
  END;

  RETURN pg_catalog.jsonb_build_object(
    'eligible', v_reason = 'eligible',
    'discount_amount', v_discount,
    'min_subtotal', COALESCE(v_settings.min_subtotal, 50),
    'reason', v_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.preview_first_delivery_promo(text,numeric,numeric,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_first_delivery_promo(text,numeric,numeric,text,jsonb) TO authenticated;

COMMENT ON FUNCTION public.preview_first_delivery_promo(text,numeric,numeric,text,jsonb) IS
  'Read-only eligibility preview. Does not reserve or consume PRIMEIRA_ENTREGA; final reservation remains in the orders INSERT trigger.';

COMMIT;
