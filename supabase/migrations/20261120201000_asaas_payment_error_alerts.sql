-- Asaas payment error alerts: keep existing order FK/uniqueness and permit null order_id
-- only for product-request alerts or unmatched Asaas payment alerts.
ALTER TABLE public.admin_alerts
  ADD COLUMN IF NOT EXISTS asaas_payment_id text;

ALTER TABLE public.admin_alerts
  DROP CONSTRAINT IF EXISTS admin_alerts_order_or_product_or_asaas_payment_check;
ALTER TABLE public.admin_alerts
  ADD CONSTRAINT admin_alerts_order_or_product_or_asaas_payment_check
  CHECK (
    order_id IS NOT NULL
    OR product_request_id IS NOT NULL
    OR (tipo = 'asaas_pagamento_sem_pedido' AND asaas_payment_id IS NOT NULL AND pg_catalog.btrim(asaas_payment_id) <> '')
  );

-- The existing UNIQUE(tipo, order_id) constraint remains in place for all rows with an order.
-- PostgreSQL NULL semantics allow distinct unmatched-payment rows; this index deduplicates them by Asaas payment ID.
CREATE UNIQUE INDEX IF NOT EXISTS admin_alerts_tipo_asaas_payment_unmatched_key
  ON public.admin_alerts (tipo, asaas_payment_id)
  WHERE order_id IS NULL AND asaas_payment_id IS NOT NULL;

-- Route the two new payment-alert types through the existing signed admin push pipeline.
CREATE OR REPLACE FUNCTION public.admin_alerts_notify_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
  v_timestamp text;
  v_signature text;
BEGIN
  IF NEW.tipo NOT IN (
    'pedido_cancelado', 'pedido_produto', 'pix_pendente_15min',
    'pedido_pago_nao_separado', 'asaas_pagamento_erro',
    'asaas_pagamento_sem_pedido'
  ) THEN
    RETURN NEW;
  END IF;
  IF pg_catalog.current_setting('app.admin_alerts_test_mode', true) = 'on' THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'push_hmac_secret'
  LIMIT 1;
  IF v_secret IS NULL OR pg_catalog.btrim(v_secret) = '' THEN RETURN NEW; END IF;

  v_timestamp := (extract(epoch FROM pg_catalog.clock_timestamp())::bigint)::text;
  v_signature := pg_catalog.encode(
    extensions.hmac(
      pg_catalog.convert_to(v_timestamp || '.' || NEW.id::text || '.admin_alert.admin_alert', 'UTF8'),
      pg_catalog.convert_to(v_secret, 'UTF8'),
      'sha256'
    ), 'hex'
  );
  BEGIN
    PERFORM net.http_post(
      url := 'https://juhwdevvwstmyxyyagzh.supabase.co/functions/v1/admin-alert-push',
      headers := pg_catalog.jsonb_build_object('Content-Type', 'application/json'),
      body := pg_catalog.jsonb_build_object('timestamp', v_timestamp, 'alert_id', NEW.id, 'signature', v_signature),
      timeout_milliseconds := 3000
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END;
$$;
