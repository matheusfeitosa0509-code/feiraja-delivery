-- ORDEM 165 — Etapa 4 do Push Notifications.
-- Cria o trigger de avisos sem alterar pedidos existentes.
-- NÃO APLICAR em produção sem aprovação explícita e cadastro do segredo no Vault.

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
  v_kinds text[] := ARRAY[]::text[];
  v_message text;
  v_signature text;
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
         'Dinheiro na entrega',
         'Cartão na entrega'
       ) THEN
      v_kinds := pg_catalog.array_append(v_kinds, 'admin');
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    -- Aviso ao cliente: somente atualização de status e pedido vinculado a usuário.
    -- Exclui cancelamento automático de checkout Pix que falhou antes da cobrança.
    IF NEW.user_id IS NOT NULL
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
$$;

DROP TRIGGER IF EXISTS trg_push_orders_notify ON public.orders;

CREATE TRIGGER trg_push_orders_notify
AFTER INSERT OR UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.push_orders_notify();

-- A função é executada pelo trigger; não é uma RPC pública.
REVOKE ALL ON FUNCTION public.push_orders_notify()
  FROM PUBLIC, anon, authenticated, service_role;
