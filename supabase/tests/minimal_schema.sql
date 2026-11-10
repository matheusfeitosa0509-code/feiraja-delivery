-- Ordem 197: esquema mínimo para PostgreSQL 17.
-- Tudo abaixo existe SOMENTE no banco efêmero do GitHub Actions.
-- STUB DE TESTE: papéis, auth, vault, net, HMAC e verificação de admin.
DO $roles$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END
$roles$;
CREATE SCHEMA auth;
CREATE SCHEMA vault;
CREATE SCHEMA net;
CREATE SCHEMA extensions;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE TABLE vault.decrypted_secrets(name text, decrypted_secret text);
CREATE OR REPLACE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer)
RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE OR REPLACE FUNCTION extensions.hmac(data bytea, key bytea, type text)
RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT decode(repeat('00',32),'hex') $$;
CREATE OR REPLACE FUNCTION public.is_current_user_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;

CREATE TABLE public.orders (
 id text PRIMARY KEY,
 customer_name text NOT NULL,
 customer_phone text NOT NULL,
 customer_cpf text,
 customer_address text NOT NULL,
 delivery_type text NOT NULL,
 payment_method text NOT NULL,
 items jsonb NOT NULL,
 subtotal numeric NOT NULL,
 delivery_fee numeric NOT NULL,
 total numeric NOT NULL,
 status text NOT NULL,
 market_checklist jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 customer_email text,
 payment_id text,
 pix_qr_code text,
 pix_qr_code_base64 text,
 user_id uuid,
 payment_provider text,
 CONSTRAINT orders_items_positive_quantity_check CHECK (
  jsonb_typeof(items)='array' AND NOT jsonb_path_exists(items,
  '$[*]?(((!(exists (@."qty")) && !(exists (@."quantity"))) || (exists (@."qty") && (@."qty".type() != "number" || @."qty" <= 0)) || (exists (@."quantity") && (@."quantity".type() != "number" || @."quantity" <= 0)))')
 ),
 CONSTRAINT orders_text_lengths_check CHECK (
  char_length(id)<=64 AND char_length(customer_name)<=120 AND char_length(customer_phone)<=30
  AND char_length(coalesce(customer_cpf,''))<=20 AND char_length(customer_address)<=500
  AND char_length(delivery_type)<=20 AND char_length(payment_method)<=30 AND char_length(status)<=60
  AND char_length(coalesce(customer_email,''))<=254 AND char_length(coalesce(payment_id,''))<=200
  AND char_length(coalesce(pix_qr_code,''))<=10000 AND char_length(coalesce(pix_qr_code_base64,''))<=500000
  AND char_length(coalesce(payment_provider,''))<=30
 )
);

-- Cópia literal de pg_get_functiondef da produção (consulta somente leitura).
CREATE OR REPLACE FUNCTION public.create_order_with_rate_limit(p_order jsonb)
 RETURNS TABLE(order_id text, order_status text, order_total numeric)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_recent_count bigint;
  v_order_id text;
  v_status text;
  v_total numeric;
BEGIN
  IF p_order IS NULL
     OR pg_catalog.jsonb_typeof(p_order)
        IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INVALID_ORDER_PAYLOAD'
      USING ERRCODE = '22023';
  END IF;

  v_user_id := NULLIF(p_order->>'user_id', '')::uuid;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_USER_ID'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  SELECT pg_catalog.count(*)
    INTO v_recent_count
  FROM public.orders AS o
  WHERE o.user_id = v_user_id
    AND o.created_at >=
        pg_catalog.now() - INTERVAL '10 minutes';

  IF v_recent_count >= 5 THEN
    RAISE EXCEPTION 'ORDER_RATE_LIMIT'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.orders (
    id,
    user_id,
    customer_name,
    customer_phone,
    customer_cpf,
    customer_email,
    customer_address,
    delivery_type,
    payment_method,
    payment_provider,
    items,
    subtotal,
    delivery_fee,
    total,
    status,
    market_checklist
  )
  VALUES (
    p_order->>'id',
    v_user_id,
    p_order->>'customer_name',
    p_order->>'customer_phone',
    p_order->>'customer_cpf',
    p_order->>'customer_email',
    p_order->>'customer_address',
    p_order->>'delivery_type',
    p_order->>'payment_method',
    p_order->>'payment_provider',
    p_order->'items',
    (p_order->>'subtotal')::numeric,
    (p_order->>'delivery_fee')::numeric,
    (p_order->>'total')::numeric,
    p_order->>'status',
    p_order->'market_checklist'
  )
  RETURNING id, status, total
  INTO v_order_id, v_status, v_total;

  RETURN QUERY
  SELECT v_order_id, v_status, v_total;
END;
$function$


-- Cópia literal de pg_get_functiondef da produção (consulta somente leitura).
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
$function$

CREATE TRIGGER trg_push_orders_notify AFTER INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.push_orders_notify();
