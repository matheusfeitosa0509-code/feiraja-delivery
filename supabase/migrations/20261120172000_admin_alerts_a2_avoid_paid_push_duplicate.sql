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
  -- A1's paid-order push is already sent by push_orders_notify(); do not duplicate it.
  IF NEW.tipo NOT IN ('pedido_cancelado', 'pedido_produto', 'pix_pendente_15min', 'pedido_pago_nao_separado') THEN
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
