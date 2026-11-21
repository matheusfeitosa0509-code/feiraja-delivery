-- A1: server-side first-delivery promotion with transactional reservation.
BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_fee_original numeric(12,2),
  ADD COLUMN IF NOT EXISTS delivery_discount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS promo_code text;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

CREATE TABLE IF NOT EXISTS private.promo_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  min_subtotal numeric(12,2) NOT NULL DEFAULT 50.00 CHECK (min_subtotal >= 0),
  ends_at timestamptz NOT NULL DEFAULT TIMESTAMPTZ '2026-12-31 23:59:59 America/Manaus',
  discount_cap numeric(12,2) NULL CHECK (discount_cap IS NULL OR discount_cap >= 0),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE private.promo_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.promo_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.promo_settings TO service_role;
INSERT INTO private.promo_settings(singleton, enabled, min_subtotal, ends_at, discount_cap)
VALUES (true, false, 50.00, TIMESTAMPTZ '2026-12-31 23:59:59 America/Manaus', NULL)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.promo_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code text NOT NULL,
  order_id text NOT NULL,
  user_id uuid NOT NULL,
  phone_key text NOT NULL,
  address_key text NOT NULL,
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'used', 'released')),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE UNIQUE INDEX IF NOT EXISTS promo_redemptions_user_active_uidx
  ON public.promo_redemptions (promo_code, user_id) WHERE status <> 'released';
CREATE UNIQUE INDEX IF NOT EXISTS promo_redemptions_phone_active_uidx
  ON public.promo_redemptions (promo_code, phone_key) WHERE status <> 'released';
CREATE UNIQUE INDEX IF NOT EXISTS promo_redemptions_address_active_uidx
  ON public.promo_redemptions (promo_code, address_key) WHERE status <> 'released';
CREATE INDEX IF NOT EXISTS promo_redemptions_order_status_idx
  ON public.promo_redemptions (order_id, status);

ALTER TABLE public.promo_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.promo_redemptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.promo_redemptions TO service_role;

CREATE OR REPLACE FUNCTION private.reserve_first_delivery_promo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_settings private.promo_settings%ROWTYPE;
  v_phone_key text;
  v_address_key text;
  v_discount numeric(12,2);
  v_inserted integer;
BEGIN
  NEW.delivery_fee_original := COALESCE(NEW.delivery_fee, 0);
  NEW.delivery_discount := 0;
  NEW.promo_code := NULL;

  IF NEW.delivery_type IS DISTINCT FROM 'delivery'
     OR NEW.user_id IS NULL
     OR COALESCE(NEW.is_test_order, false)
     OR COALESCE(NEW.subtotal, 0) < 0
     OR COALESCE(NEW.delivery_fee, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_settings
  FROM private.promo_settings
  WHERE singleton = true;

  IF NOT FOUND OR NOT v_settings.enabled
     OR pg_catalog.now() > v_settings.ends_at
     OR NEW.subtotal < v_settings.min_subtotal THEN
    RETURN NEW;
  END IF;

  v_phone_key := pg_catalog.regexp_replace(COALESCE(NEW.customer_phone, ''), '[^0-9]', '', 'g');
  v_address_key :=
    pg_catalog.regexp_replace(COALESCE(NEW.delivery_address->>'postal_code', ''), '[^0-9]', '', 'g')
    || '-' ||
    pg_catalog.lower(pg_catalog.regexp_replace(COALESCE(NEW.delivery_address->>'number', ''), '[[:space:]]+', '', 'g'));

  IF v_phone_key = '' OR v_address_key !~ '^[0-9]+-.+$' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE COALESCE(o.is_test_order, false) = false
      AND o.status IN (
        'Pagamento Confirmado', 'Preparando', 'Pronto para Retirada',
        'Saiu para Entrega', 'Entregue', 'Concluído', 'Concluido'
      )
      AND (
        o.user_id = NEW.user_id
        OR pg_catalog.regexp_replace(COALESCE(o.customer_phone, ''), '[^0-9]', '', 'g') = v_phone_key
        OR (
          pg_catalog.regexp_replace(COALESCE(o.delivery_address->>'postal_code', ''), '[^0-9]', '', 'g')
            || '-' ||
          pg_catalog.lower(pg_catalog.regexp_replace(COALESCE(o.delivery_address->>'number', ''), '[[:space:]]+', '', 'g'))
        ) = v_address_key
      )
  ) THEN
    RETURN NEW;
  END IF;

  v_discount := LEAST(
    COALESCE(NEW.delivery_fee, 0),
    COALESCE(v_settings.discount_cap, COALESCE(NEW.delivery_fee, 0))
  );

  INSERT INTO public.promo_redemptions (
    promo_code, order_id, user_id, phone_key, address_key, status
  ) VALUES (
    'PRIMEIRA_ENTREGA', NEW.id, NEW.user_id, v_phone_key, v_address_key, 'reserved'
  )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 1 THEN
    NEW.delivery_discount := v_discount;
    NEW.promo_code := 'PRIMEIRA_ENTREGA';
    NEW.total := GREATEST(0, COALESCE(NEW.subtotal, 0) + COALESCE(NEW.delivery_fee, 0) - v_discount);
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.reserve_first_delivery_promo() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_reserve_first_delivery_promo ON public.orders;
CREATE TRIGGER trg_reserve_first_delivery_promo
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION private.reserve_first_delivery_promo();

CREATE OR REPLACE FUNCTION private.sync_first_delivery_promo_redemption()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.status IN (
    'Pagamento Confirmado', 'Preparando', 'Pronto para Retirada',
    'Saiu para Entrega', 'Entregue', 'Concluído', 'Concluido'
  ) THEN
    UPDATE public.promo_redemptions
    SET status = 'used'
    WHERE order_id = NEW.id AND status = 'reserved';
  ELSIF NEW.status = 'Cancelada' THEN
    UPDATE public.promo_redemptions
    SET status = 'released'
    WHERE order_id = NEW.id AND status = 'reserved';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.sync_first_delivery_promo_redemption() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_sync_first_delivery_promo_redemption ON public.orders;
CREATE TRIGGER trg_sync_first_delivery_promo_redemption
AFTER UPDATE OF status ON public.orders
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION private.sync_first_delivery_promo_redemption();

COMMENT ON TABLE public.promo_redemptions IS
  'Reservas e usos atômicos da promoção PRIMEIRA_ENTREGA; acesso restrito ao servidor.';
COMMENT ON TABLE private.promo_settings IS
  'Configuração privada da promoção de primeira entrega; desligada por padrão.';

COMMIT;
