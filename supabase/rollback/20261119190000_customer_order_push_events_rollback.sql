-- Rollback: restore the previously deployed customer/admin push trigger.
CREATE OR REPLACE FUNCTION public.push_orders_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_secret text;
  v_timestamp text;
  v_kind text;
  v_kinds text[] := ARRAY[]::text[];
  v_message text;
  v_signature text;
  v_notification_status text;
BEGIN
  SELECT decrypted_secret
    INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'push_hmac_secret'
   LIMIT 1;

  IF v_secret IS NULL OR pg_catalog.btrim(v_secret) = '' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'Pedido Recebido'
       AND NEW.payment_method IN (
         'cash',
         'Dinheiro na retirada', 'Dinheiro na entrega',
         'Cartão na retirada', 'Cartão na entrega'
       ) THEN
      v_kinds := pg_catalog.array_append(v_kinds, 'admin');
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.user_id IS NOT NULL
         AND NEW.status NOT IN (
           'Pedido Recebido',
           'Recebido',
           'received',
           'Pagamento Pendente',
           'Aguardando Pagamento Pix',
           'Pagamento em análise'
         )
         AND NOT (
           OLD.status = 'Pagamento Pendente'
           AND NEW.status = 'Cancelada'
           AND auth.uid() IS NULL
         ) THEN
        v_kinds := pg_catalog.array_append(v_kinds, 'customer');
      END IF;

      IF NEW.status = 'Pagamento Confirmado'
         AND NEW.payment_method IN (
           'pix',
           'Pix Direto',
           'Asaas Pix',
           'Mercado Pago Pix'
         )
         AND NOT (
           auth.uid() IS NOT NULL
           AND public.is_current_user_admin()
         ) THEN
        v_kinds := pg_catalog.array_append(v_kinds, 'admin');
      END IF;
    END IF;

    IF NEW.refund_pending IS TRUE
       AND OLD.refund_pending IS DISTINCT FROM TRUE THEN
      v_notification_status := CASE
        WHEN NEW.cancelled_by = 'cliente'
          THEN 'Pedido pago cancelado pelo cliente — devolver Pix'
        ELSE 'Pix pago em pedido cancelado — devolver'
      END;
      v_timestamp := (EXTRACT(EPOCH FROM pg_catalog.clock_timestamp())::bigint)::text;
      v_kind := 'admin';
      v_message := v_timestamp || '.' || NEW.id || '.' || v_kind || '.' || v_notification_status;
      v_signature := pg_catalog.encode(
        extensions.hmac(
          pg_catalog.convert_to(v_message, 'UTF8'),
          pg_catalog.convert_to(v_secret, 'UTF8'),
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
            'order_id', NEW.id,
            'kind', v_kind,
            'new_status', v_notification_status,
            'signature', v_signature
          ),
          timeout_milliseconds := 3000
        );
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END IF;

  FOREACH v_kind IN ARRAY v_kinds LOOP
    v_timestamp := (EXTRACT(EPOCH FROM pg_catalog.clock_timestamp())::bigint)::text;
    v_message := v_timestamp || '.' || NEW.id || '.' || v_kind || '.' || NEW.status;
    v_signature := pg_catalog.encode(
      extensions.hmac(
        pg_catalog.convert_to(v_message, 'UTF8'),
        pg_catalog.convert_to(v_secret, 'UTF8'),
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
          'order_id', NEW.id,
          'kind', v_kind,
          'new_status', NEW.status,
          'signature', v_signature
        ),
        timeout_milliseconds := 3000
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;

DROP FUNCTION IF EXISTS public.push_orders_notify_send(text, text, text, text);
ALTER TABLE public.push_events
  DROP COLUMN IF EXISTS message,
  DROP COLUMN IF EXISTS sent_count;

REVOKE ALL ON FUNCTION public.push_orders_notify()
  FROM PUBLIC, anon, authenticated, service_role;
