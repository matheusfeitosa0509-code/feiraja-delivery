#!/usr/bin/env bash
set -euo pipefail

MIG="supabase/migrations/20261110020000_ordem_191_pickup_only.sql"
SCHEMA="supabase/tests/minimal_schema.sql"
TMP="$(mktemp -d)"
DB_A="rollback_191_empty"
DB_B="rollback_191_preserve"
DB_D="rollback_191_atomic"
cleanup() {
  for db in "$DB_A" "$DB_B" "$DB_D"; do
    dropdb --if-exists "$db" >/dev/null 2>&1 || true
  done
  rm -rf "$TMP"
}
trap cleanup EXIT

cat >"$TMP/rollback.sql" <<'SQL'
BEGIN;
LOCK TABLE public.orders IN ACCESS EXCLUSIVE MODE;

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
     OR pg_catalog.jsonb_typeof(p_order) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INVALID_ORDER_PAYLOAD' USING ERRCODE = '22023';
  END IF;
  v_user_id := NULLIF(p_order->>'user_id', '')::uuid;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_USER_ID' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));
  SELECT pg_catalog.count(*) INTO v_recent_count
  FROM public.orders AS o
  WHERE o.user_id = v_user_id
    AND o.created_at >= pg_catalog.now() - INTERVAL '10 minutes';
  IF v_recent_count >= 5 THEN
    RAISE EXCEPTION 'ORDER_RATE_LIMIT' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.orders (
    id, user_id, customer_name, customer_phone, customer_cpf,
    customer_email, customer_address, delivery_type, payment_method,
    payment_provider, items, subtotal, delivery_fee, total, status,
    market_checklist
  )
  VALUES (
    p_order->>'id', v_user_id, p_order->>'customer_name',
    p_order->>'customer_phone', p_order->>'customer_cpf',
    p_order->>'customer_email', p_order->>'customer_address',
    p_order->>'delivery_type', p_order->>'payment_method',
    p_order->>'payment_provider', p_order->'items',
    (p_order->>'subtotal')::numeric, (p_order->>'delivery_fee')::numeric,
    (p_order->>'total')::numeric, p_order->>'status',
    p_order->'market_checklist'
  )
  RETURNING id, status, total INTO v_order_id, v_status, v_total;
  RETURN QUERY SELECT v_order_id, v_status, v_total;
END;
$function$;

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
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'push_hmac_secret'
  LIMIT 1;
  IF v_secret IS NULL OR pg_catalog.btrim(v_secret) = '' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'Pedido Recebido'
       AND NEW.payment_method IN ('cash', 'Dinheiro na entrega', 'Cartão na entrega') THEN
      v_kinds := pg_catalog.array_append(v_kinds, 'admin');
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.user_id IS NOT NULL
       AND NEW.status NOT IN (
         'Pedido Recebido', 'Recebido', 'received',
         'Pagamento Pendente', 'Aguardando Pagamento Pix',
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
       AND NEW.payment_method IN ('pix', 'Pix Direto', 'Asaas Pix', 'Mercado Pago Pix')
       AND NOT (auth.uid() IS NOT NULL AND public.is_current_user_admin()) THEN
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
      ), 'hex'
    );
    PERFORM net.http_post(
      url := 'https://juhwdevvwstmyxyyagzh.supabase.co/functions/v1/push-notify',
      headers := pg_catalog.jsonb_build_object('Content-Type', 'application/json'),
      body := pg_catalog.jsonb_build_object(
        'timestamp', v_timestamp, 'order_id', NEW.id, 'kind', v_kind,
        'new_status', NEW.status, 'signature', v_signature
      ),
      timeout_milliseconds := 3000
    );
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_pickup_code_format_check;

DO $rollback$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.orders WHERE pickup_code IS NOT NULL
  ) THEN
    ALTER TABLE public.orders DROP COLUMN pickup_code;
  ELSE
    RAISE NOTICE 'pickup_code contém valores; coluna mantida para preservar dados.';
  END IF;
END
$rollback$;

COMMIT;
SQL

function setup_db() {
  local db="$1"
  dropdb --if-exists "$db" >/dev/null 2>&1 || true
  createdb "$db"
  export PGDATABASE="$db"
  psql -v ON_ERROR_STOP=1 -f "$SCHEMA" >"$TMP/\${db}_schema.log" 2>&1
  psql -v ON_ERROR_STOP=1 -f "$MIG" >"$TMP/\${db}_migration.log" 2>&1
}
function original_hashes() {
  psql -Atqc "SELECT md5(pg_get_functiondef('public.create_order_with_rate_limit(jsonb)'::regprocedure)) || ':' || md5(pg_get_functiondef('public.push_orders_notify()'::regprocedure))"
}
function assert_functions_original() {
  local expected="$1" actual
  actual="$(original_hashes)"
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL: definições restauradas diferem das originais"
    echo "expected=$expected"
    echo "actual=$actual"
    exit 1
  fi
  echo "PASS: hashes das duas funções idênticos às definições originais"
}

echo "CENÁRIO A: reversão com pickup_code vazio"
setup_db "$DB_A"
ORIGINAL_A="$(original_hashes)"
psql -v ON_ERROR_STOP=1 -f "$TMP/rollback.sql" >"$TMP/a_rollback.log" 2>&1
if psql -Atqc "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='pickup_code'" | grep -qx '0'; then
  echo "PASS: coluna pickup_code removida"
else
  cat "$TMP/a_rollback.log"; echo "FAIL: coluna pickup_code permaneceu"; exit 1
fi
if psql -Atqc "SELECT count(*) FROM pg_constraint WHERE conrelid='public.orders'::regclass AND conname='orders_pickup_code_format_check'" | grep -qx '0'; then
  echo "PASS: constraint removida"
else
  cat "$TMP/a_rollback.log"; echo "FAIL: constraint permaneceu"; exit 1
fi
assert_functions_original "$ORIGINAL_A"

echo "CENÁRIO B: preservar código Uber existente"
setup_db "$DB_B"
ORIGINAL_B="$(original_hashes)"
psql -v ON_ERROR_STOP=1 <<'SQL' >"$TMP/b_insert.log" 2>&1
INSERT INTO public.orders(
 id,customer_name,customer_phone,customer_address,delivery_type,
 payment_method,items,subtotal,delivery_fee,total,status,
 market_checklist,pickup_code
) VALUES (
 'temporary-uber-test','Teste temporário','11999999999',
 'Retirada','pickup_uber','Dinheiro na retirada',
 '[{"qty":1}]',30,0,30,'Pedido Recebido','{}','0042'
);
SQL
psql -v ON_ERROR_STOP=1 -f "$TMP/rollback.sql" >"$TMP/b_rollback.log" 2>&1
if ! grep -Fq 'pickup_code contém valores; coluna mantida para preservar dados.' "$TMP/b_rollback.log"; then
  cat "$TMP/b_rollback.log"; echo "FAIL: aviso de preservação não foi emitido"; exit 1
fi
echo "PASS: aviso emitido para preservar pickup_code"
if ! psql -Atqc "SELECT pickup_code FROM public.orders WHERE id='temporary-uber-test'" | grep -qx '0042'; then
  echo "FAIL: código 0042 não foi preservado"; exit 1
fi
echo "PASS: código 0042 preservado"
if psql -Atqc "SELECT count(*) FROM pg_constraint WHERE conrelid='public.orders'::regclass AND conname='orders_pickup_code_format_check'" | grep -qx '0'; then
  echo "PASS: constraint removida com código preservado"
else
  cat "$TMP/b_rollback.log"; echo "FAIL: constraint permaneceu"; exit 1
fi
assert_functions_original "$ORIGINAL_B"

echo "CENÁRIO D: erro intencional dentro da transação de reversão"
setup_db "$DB_D"
ORIGINAL_D="$(original_hashes)"
sed '/^COMMIT;$/i SELECT 1 / 0;' "$TMP/rollback.sql" >"$TMP/rollback_forced_error.sql"
set +e
psql -v ON_ERROR_STOP=1 -f "$TMP/rollback_forced_error.sql" >"$TMP/d_forced_error.log" 2>&1
RC=$?
set -e
if [[ "$RC" -eq 0 ]]; then
  cat "$TMP/d_forced_error.log"; echo "FAIL: erro intencional não interrompeu a transação"; exit 1
fi
if ! grep -Eiq 'division by zero' "$TMP/d_forced_error.log"; then
  cat "$TMP/d_forced_error.log"; echo "FAIL: log não contém o erro intencional esperado"; exit 1
fi
echo "PASS: falha intencional (division by zero) ocorreu"
if ! psql -Atqc "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='pickup_code'" | grep -qx '1'; then
  echo "FAIL: rollback transacional não restaurou pickup_code"; exit 1
fi
if ! psql -Atqc "SELECT count(*) FROM pg_constraint WHERE conrelid='public.orders'::regclass AND conname='orders_pickup_code_format_check'" | grep -qx '1'; then
  echo "FAIL: rollback transacional não restaurou a constraint"; exit 1
fi
assert_functions_original "$ORIGINAL_D"
echo "PASS: erro reverteu integralmente a transação; coluna, constraint e funções da migration permaneceram"
echo "RESULTADO: PASS todos os cenários A, B e D"
