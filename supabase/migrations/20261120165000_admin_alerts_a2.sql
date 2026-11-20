-- A2: alertas administrativos de cancelamento, pedidos de produto e filas perto do prazo.
-- Os envios são exclusivamente para administradores. Falhas de push nunca afetam o evento principal.

ALTER TABLE public.admin_alerts
  ALTER COLUMN order_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS product_request_id uuid
    REFERENCES public.product_requests(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS admin_alerts_tipo_product_request_key
  ON public.admin_alerts (tipo, product_request_id)
  WHERE product_request_id IS NOT NULL;

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
  IF pg_catalog.current_setting('app.admin_alerts_test_mode', true) = 'on' THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'push_hmac_secret'
  LIMIT 1;

  IF v_secret IS NULL OR pg_catalog.btrim(v_secret) = '' THEN
    RETURN NEW;
  END IF;

  v_timestamp := (extract(epoch FROM pg_catalog.clock_timestamp())::bigint)::text;
  v_signature := pg_catalog.encode(
    extensions.hmac(
      pg_catalog.convert_to(v_timestamp || '.' || NEW.id::text || '.admin_alert.admin_alert', 'UTF8'),
      pg_catalog.convert_to(v_secret, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  BEGIN
    PERFORM net.http_post(
      url := 'https://juhwdevvwstmyxyyagzh.supabase.co/functions/v1/admin-alert-push',
      headers := pg_catalog.jsonb_build_object('Content-Type', 'application/json'),
      body := pg_catalog.jsonb_build_object(
        'timestamp', v_timestamp,
        'alert_id', NEW.id,
        'signature', v_signature
      ),
      timeout_milliseconds := 3000
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_alerts_notify_push ON public.admin_alerts;
CREATE TRIGGER trg_admin_alerts_notify_push
AFTER INSERT ON public.admin_alerts
FOR EACH ROW EXECUTE FUNCTION public.admin_alerts_notify_push();

CREATE OR REPLACE FUNCTION public.admin_alert_cancelled_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status IN ('Cancelada', 'Cancelado', 'Pagamento cancelado')
     AND NEW.is_test_order IS FALSE THEN
    INSERT INTO public.admin_alerts (tipo, order_id, mensagem)
    VALUES ('pedido_cancelado', NEW.id, '❌ Pedido ' || NEW.id || ' cancelado')
    ON CONFLICT (tipo, order_id) DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_alert_cancelled_order ON public.orders;
CREATE TRIGGER trg_admin_alert_cancelled_order
AFTER UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.admin_alert_cancelled_order();

CREATE OR REPLACE FUNCTION public.admin_alert_product_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.admin_alerts (tipo, product_request_id, mensagem)
  VALUES ('pedido_produto', NEW.id, '📝 Pedido de produto: ' || NEW.product_name)
  ON CONFLICT (tipo, product_request_id) WHERE product_request_id IS NOT NULL DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_alert_product_request ON public.product_requests;
CREATE TRIGGER trg_admin_alert_product_request
AFTER INSERT ON public.product_requests
FOR EACH ROW EXECUTE FUNCTION public.admin_alert_product_request();

CREATE OR REPLACE FUNCTION public.admin_alerts_is_special_day(p_date date)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT
    (extract(month FROM p_date) = 12 AND extract(day FROM p_date) IN (24, 31))
    OR p_date IN (
      DATE '2026-01-01', DATE '2026-02-16', DATE '2026-02-17', DATE '2026-04-03',
      DATE '2026-04-21', DATE '2026-05-01', DATE '2026-06-04', DATE '2026-09-05',
      DATE '2026-09-07', DATE '2026-10-12', DATE '2026-10-24', DATE '2026-11-02',
      DATE '2026-11-15', DATE '2026-11-20', DATE '2026-12-08', DATE '2026-12-25',
      DATE '2027-01-01', DATE '2027-02-08', DATE '2027-02-09', DATE '2027-03-26',
      DATE '2027-04-21', DATE '2027-05-01', DATE '2027-05-27', DATE '2027-09-05',
      DATE '2027-09-07', DATE '2027-10-12', DATE '2027-10-24', DATE '2027-11-02',
      DATE '2027-11-15', DATE '2027-11-20', DATE '2027-12-08', DATE '2027-12-25'
    );
$$;

CREATE OR REPLACE FUNCTION public.admin_alerts_is_open_day(p_date date)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT extract(isodow FROM p_date) <> 7
    AND p_date NOT IN (DATE '2026-01-01', DATE '2026-12-25', DATE '2027-01-01', DATE '2027-12-25');
$$;

CREATE OR REPLACE FUNCTION public.process_admin_alert_jobs(p_now timestamptz DEFAULT pg_catalog.clock_timestamp())
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_local timestamp without time zone := p_now AT TIME ZONE 'America/Manaus';
  v_date date := (p_now AT TIME ZONE 'America/Manaus')::date;
  v_time time without time zone := (p_now AT TIME ZONE 'America/Manaus')::time;
  v_test_mode boolean := pg_catalog.current_setting('app.admin_alerts_test_mode', true) = 'on';
BEGIN
  -- Pix que permaneceu pendente por mais de 15 minutos.
  INSERT INTO public.admin_alerts (tipo, order_id, mensagem)
  SELECT 'pix_pendente_15min', o.id,
         '⏳ Pix pendente – pedido ' || o.id || ' (R$ ' ||
         replace(pg_catalog.to_char(o.total, 'FM999999990.00'), '.', ',') || ')'
  FROM public.orders o
  WHERE o.status IN ('Aguardando Pagamento Pix', 'Pagamento Pendente')
    AND o.payment_method IN ('pix', 'Pix Direto', 'Asaas Pix', 'Mercado Pago Pix')
    AND o.created_at <= p_now - interval '15 minutes'
    AND (v_test_mode OR o.is_test_order IS FALSE)
  ON CONFLICT (tipo, order_id) DO NOTHING;

  -- Lembrete de separação somente no horário de fechamento comercial do calendário atual.
  IF public.admin_alerts_is_open_day(v_date)
     AND (
       (public.admin_alerts_is_special_day(v_date) AND v_time >= TIME '10:30' AND v_time < TIME '10:35')
       OR
       (NOT public.admin_alerts_is_special_day(v_date) AND v_time >= TIME '12:30' AND v_time < TIME '12:35')
     ) THEN
    INSERT INTO public.admin_alerts (tipo, order_id, mensagem)
    SELECT 'pedido_pago_nao_separado', o.id,
           '⚠️ Pedido ' || o.id || ' ainda não separado'
    FROM public.orders o
    WHERE o.status = 'Pagamento Confirmado'
      AND o.separation_started_at IS NULL
      AND o.separation_started_legacy IS FALSE
      AND (v_test_mode OR o.is_test_order IS FALSE)
    ON CONFLICT (tipo, order_id) DO NOTHING;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.process_admin_alert_jobs(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_admin_alert_jobs(timestamptz) TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

DO $$
DECLARE v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'admin-alerts-a2-every-five-minutes';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
  PERFORM cron.schedule(
    'admin-alerts-a2-every-five-minutes',
    '*/5 * * * *',
    'SELECT public.process_admin_alert_jobs();'
  );
END;
$$;

-- Asserções estruturais da migration (não cria pedidos reais nem envia push).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_admin_alert_cancelled_order' AND NOT tgisinternal
  ) THEN RAISE EXCEPTION 'A2_ASSERT_CANCEL_TRIGGER_MISSING'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_admin_alert_product_request' AND NOT tgisinternal
  ) THEN RAISE EXCEPTION 'A2_ASSERT_PRODUCT_REQUEST_TRIGGER_MISSING'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'admin-alerts-a2-every-five-minutes' AND active
  ) THEN RAISE EXCEPTION 'A2_ASSERT_CRON_JOB_MISSING'; END IF;
END;
$$;
