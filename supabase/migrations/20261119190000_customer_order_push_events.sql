-- Customer order push: exact customer events, immutable idempotency claim, and safe trigger.
ALTER TABLE public.push_events
  ADD COLUMN IF NOT EXISTS message text,
  ADD COLUMN IF NOT EXISTS sent_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.push_orders_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
  v_timestamp text;
  v_kind text;
  v_event_status text;
  v_events text[] := ARRAY[]::text[];
  v_message text;
  v_signature text;
BEGIN
  -- Test orders are never allowed to emit either customer or admin pushes.
  IF NEW.is_test_order IS TRUE THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret
    INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'push_hmac_secret'
   LIMIT 1;

  IF v_secret IS NULL OR pg_catalog.btrim(v_secret) = '' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Start-separation is driven by the existing timestamp, not a duplicate status.
    IF NEW.user_id IS NOT NULL
       AND NEW.separation_started_at IS NOT NULL
       AND OLD.separation_started_at IS NULL THEN
      v_events := pg_catalog.array_append(v_events, 'Separação iniciada');
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.user_id IS NOT NULL
         AND NEW.status IN (
           'Pagamento Confirmado',
           'Pronto para Retirada',
           'Saiu para Entrega',
           'Entregue',
           'Cancelada',
           'Cancelado',
           'Pagamento cancelado'
         )
         AND NOT (
           OLD.status = 'Pagamento Pendente'
           AND NEW.status IN ('Cancelada', 'Cancelado', 'Pagamento cancelado')
           AND auth.uid() IS NULL
         ) THEN
        v_events := pg_catalog.array_append(v_events,
          CASE WHEN NEW.status = 'Cancelado' THEN 'Cancelada' ELSE NEW.status END);
      END IF;

      -- Keep the existing admin alert for server-confirmed Pix payments.
      IF NEW.status = 'Pagamento Confirmado'
         AND NEW.payment_method IN ('pix', 'Pix Direto', 'Asaas Pix', 'Mercado Pago Pix')
         AND NOT (auth.uid() IS NOT NULL AND public.is_current_user_admin()) THEN
        v_event_status := 'Pagamento Confirmado';
        v_kind := 'admin';
        PERFORM public.push_orders_notify_send(
          NEW.id, v_kind, v_event_status, v_secret
        );
      END IF;
    END IF;

    -- Existing refund alerts remain admin-only and are not customer messages.
    IF NEW.refund_pending IS TRUE AND OLD.refund_pending IS DISTINCT FROM TRUE THEN
      v_event_status := CASE
        WHEN NEW.cancelled_by = 'cliente'
          THEN 'Pedido pago cancelado pelo cliente — devolver Pix'
        ELSE 'Pix pago em pedido cancelado — devolver'
      END;
      PERFORM public.push_orders_notify_send(NEW.id, 'admin', v_event_status, v_secret);
    END IF;
  END IF;

  FOREACH v_event_status IN ARRAY v_events LOOP
    PERFORM public.push_orders_notify_send(NEW.id, 'customer', v_event_status, v_secret);
  END LOOP;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Notification failures must never roll back the order or its status.
    RETURN NEW;
END;
$$;

-- Internal helper: signed HTTP delivery is isolated so every call is best-effort.
CREATE OR REPLACE FUNCTION public.push_orders_notify_send(
  p_order_id text,
  p_kind text,
  p_event_status text,
  p_secret text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $helper$
DECLARE
  v_timestamp text;
  v_message text;
  v_signature text;
BEGIN
  v_timestamp := (EXTRACT(EPOCH FROM pg_catalog.clock_timestamp())::bigint)::text;
  v_message := v_timestamp || '.' || p_order_id || '.' || p_kind || '.' || p_event_status;
  v_signature := pg_catalog.encode(
    extensions.hmac(
      pg_catalog.convert_to(v_message, 'UTF8'),
      pg_catalog.convert_to(p_secret, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  BEGIN
    PERFORM net.http_post(
      url := 'https://juhwdevvwstmyxyyagzh.supabase.co/functions/v1/push-notify',
      headers := pg_catalog.jsonb_build_object('Content-Type', 'application/json'),
      body := pg_catalog.jsonb_build_object(
        'timestamp', v_timestamp,
        'order_id', p_order_id,
        'kind', p_kind,
        'new_status', p_event_status,
        'signature', v_signature
      ),
      timeout_milliseconds := 3000
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$helper$;

DROP TRIGGER IF EXISTS trg_push_orders_notify ON public.orders;
CREATE TRIGGER trg_push_orders_notify
AFTER UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.push_orders_notify();

REVOKE ALL ON FUNCTION public.push_orders_notify() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.push_orders_notify_send(text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
