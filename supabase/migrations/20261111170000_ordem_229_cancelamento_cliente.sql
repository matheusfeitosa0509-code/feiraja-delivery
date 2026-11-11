-- ORDEM 229-B — cancelamento do cliente e controle de devolução Pix.
-- Arquivo de proposta: não aplicar sem autorização explícita do proprietário.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS refund_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancelled_by text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.orders'::regclass
       AND conname = 'orders_cancelled_by_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_cancelled_by_check
      CHECK (cancelled_by IS NULL OR cancelled_by IN ('cliente', 'admin'));
  END IF;
END;
$constraint$;

CREATE OR REPLACE FUNCTION public.cancel_my_order(p_order_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_order_user_id uuid;
  v_order_status text;
  v_refund_pending boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT o.user_id, o.status
    INTO v_order_user_id, v_order_status
    FROM public.orders AS o
   WHERE o.id = p_order_id
   FOR UPDATE;

  IF NOT FOUND OR v_order_user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = 'P0002';
  END IF;

  IF v_order_status NOT IN (
    'Pedido Recebido',
    'Pagamento Pendente',
    'Pagamento Confirmado'
  ) THEN
    RAISE EXCEPTION 'ORDER_CANNOT_BE_CANCELLED' USING ERRCODE = '22023';
  END IF;

  v_refund_pending := v_order_status = 'Pagamento Confirmado';

  UPDATE public.orders
     SET status = 'Cancelada',
         cancelled_by = 'cliente',
         cancelled_at = pg_catalog.clock_timestamp(),
         refund_pending = v_refund_pending
   WHERE id = p_order_id
     AND user_id = v_user_id;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'Cancelada',
    'refund_pending', v_refund_pending
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_my_order(text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_my_order(text) TO authenticated;

-- Marca cancelamentos pagos feitos pelo painel, sem depender do navegador.
CREATE OR REPLACE FUNCTION public.set_order_cancel_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'Cancelada'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.cancelled_by IS NULL
     AND auth.uid() IS NOT NULL
     AND public.is_current_user_admin() THEN
    NEW.cancelled_by := 'admin';
    NEW.cancelled_at := pg_catalog.clock_timestamp();

    IF OLD.status IN (
      'Pagamento Confirmado',
      'Preparando',
      'Preparando pedido',
      'Pronto para Retirada',
      'Saiu para Entrega',
      'Entregue'
    ) THEN
      NEW.refund_pending := true;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_cancel_metadata ON public.orders;
CREATE TRIGGER trg_orders_cancel_metadata
BEFORE UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.set_order_cancel_metadata();

REVOKE ALL ON FUNCTION public.set_order_cancel_metadata()
  FROM PUBLIC, anon, authenticated, service_role;

-- Preserva integralmente os avisos antigos e acrescenta apenas os dois eventos
-- administrativos de devolução, disparados na transição refund_pending false -> true.
CREATE OR REPLACE FUNCTION public.push_orders_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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

  -- Sem segredo, não envia nada. A Edge Function também recusa chamadas sem segredo.
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
      -- Aviso ao cliente: somente atualização de status e pedido vinculado a usuário.
      -- Exclui cancelamento automático de checkout Pix que falhou antes da cobrança.
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

      -- Aviso ao dono quando Pix é confirmado por webhook/servidor.
      -- Qualquer alteração feita por administrador autenticado fica excluída.
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

    -- Evento novo somente na transição de refund_pending para true.
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
          headers := pg_catalog.jsonb_build_object(
            'Content-Type', 'application/json'
          ),
          body := pg_catalog.jsonb_build_object(
            'timestamp', v_timestamp,
            'order_id', NEW.id,
            'kind', v_kind,
            'new_status', v_notification_status,
            'signature', v_signature
          ),
          timeout_milliseconds := 3000
        );
      EXCEPTION
        WHEN OTHERS THEN
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

    PERFORM net.http_post(
      url := 'https://juhwdevvwstmyxyyagzh.supabase.co/functions/v1/push-notify',
      headers := pg_catalog.jsonb_build_object(
        'Content-Type', 'application/json'
      ),
      body := pg_catalog.jsonb_build_object(
        'timestamp', v_timestamp,
        'order_id', NEW.id,
        'kind', v_kind,
        'new_status', NEW.status,
        'signature', v_signature
      ),
      timeout_milliseconds := 3000
    );
  END LOOP;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Push nunca pode impedir a gravação do pedido/status.
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_push_orders_notify ON public.orders;
CREATE TRIGGER trg_push_orders_notify AFTER INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.push_orders_notify();

REVOKE ALL ON FUNCTION public.push_orders_notify()
  FROM PUBLIC, anon, authenticated, service_role;
