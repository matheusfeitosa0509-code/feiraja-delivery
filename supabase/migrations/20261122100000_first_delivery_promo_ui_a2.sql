-- A2: authenticated admin controls and safe public eligibility read for first-delivery promo.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_get_first_delivery_promo_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users a WHERE a.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'enabled', enabled,
    'min_subtotal', min_subtotal,
    'ends_at', ends_at,
    'discount_cap', discount_cap
  ) INTO v_result
  FROM promo_private.promo_settings WHERE singleton = true;
  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_save_first_delivery_promo_settings(
  p_enabled boolean,
  p_min_subtotal numeric,
  p_ends_at timestamptz,
  p_discount_cap numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users a WHERE a.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_min_subtotal IS NULL OR p_min_subtotal < 0 OR p_min_subtotal > 100000
     OR p_ends_at IS NULL OR p_ends_at <= pg_catalog.now()
     OR (p_discount_cap IS NOT NULL AND (p_discount_cap < 0 OR p_discount_cap > 100000)) THEN
    RAISE EXCEPTION 'invalid promotion settings' USING ERRCODE = '22023';
  END IF;
  UPDATE promo_private.promo_settings
  SET enabled = COALESCE(p_enabled, false),
      min_subtotal = p_min_subtotal,
      ends_at = p_ends_at,
      discount_cap = p_discount_cap,
      updated_at = pg_catalog.now()
  WHERE singleton = true;
  SELECT jsonb_build_object(
    'enabled', enabled,
    'min_subtotal', min_subtotal,
    'ends_at', ends_at,
    'discount_cap', discount_cap
  ) INTO v_result
  FROM promo_private.promo_settings WHERE singleton = true;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_first_delivery_promo_offer()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN s.enabled AND s.ends_at >= pg_catalog.now()
      AND (
        auth.uid() IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.orders o
          WHERE o.user_id = auth.uid()
            AND COALESCE(o.is_test_order, false) = false
            AND o.status IN (
              'Pagamento Confirmado', 'Preparando', 'Pronto para Retirada',
              'Saiu para Entrega', 'Entregue', 'Concluído', 'Concluido'
            )
        )
      )
    THEN jsonb_build_object(
      'enabled', true,
      'min_subtotal', s.min_subtotal,
      'ends_at', s.ends_at
    )
    ELSE jsonb_build_object('enabled', false)
  END
  FROM promo_private.promo_settings s
  WHERE s.singleton = true;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_first_delivery_promo_settings() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_save_first_delivery_promo_settings(boolean,numeric,timestamptz,numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_first_delivery_promo_offer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_first_delivery_promo_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_first_delivery_promo_settings(boolean,numeric,timestamptz,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_first_delivery_promo_offer() TO anon, authenticated;

COMMENT ON FUNCTION public.get_first_delivery_promo_offer() IS
  'Returns only public first-delivery offer details when enabled and the signed-in user has no paid order.';

COMMIT;
