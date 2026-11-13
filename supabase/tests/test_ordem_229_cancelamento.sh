#!/usr/bin/env bash
set -euo pipefail

MIG="supabase/migrations/20261111170000_ordem_229_cancelamento_cliente.sql"
ROLLBACK="supabase/rollback/ordem_229_cancelamento_cliente_rollback.sql"
SCHEMA="supabase/tests/minimal_schema.sql"
ORIGINAL="supabase/tests/ordem_229_original_push.sql"
TMP="$(mktemp -d)"
cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

echo "ORDEM 229-C — PostgreSQL 17 temporário"
psql -v ON_ERROR_STOP=1 -f "$SCHEMA" >"$TMP/schema.log" 2>&1
psql -v ON_ERROR_STOP=1 -f "$ORIGINAL" >"$TMP/original.log" 2>&1

# Stubs exclusivos do banco efêmero; não usam Supabase nem segredos reais.
psql -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE public.admin_users (user_id uuid PRIMARY KEY);
CREATE TABLE public.push_log (
  id bigserial PRIMARY KEY,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(pg_catalog.current_setting('test.uid', true), '')::uuid
$$;
CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean LANGUAGE sql STABLE
AS $$
  SELECT coalesce(NULLIF(pg_catalog.current_setting('test.admin', true), '')::boolean, false)
$$;
CREATE OR REPLACE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer)
RETURNS bigint LANGUAGE plpgsql
AS $$
DECLARE v_id bigint;
BEGIN
  IF coalesce(NULLIF(pg_catalog.current_setting('test.push_fail', true), '')::boolean, false) THEN
    RAISE EXCEPTION 'PUSH_STUB_FAILURE';
  END IF;
  INSERT INTO public.push_log(payload) VALUES (body) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
INSERT INTO vault.decrypted_secrets(name,decrypted_secret)
VALUES ('push_hmac_secret','test-only-secret');
SQL

ORIGINAL_FUNCTION_HASH="$(psql -Atqc "SELECT md5(pg_get_functiondef('public.push_orders_notify()'::regprocedure))")"
ORIGINAL_TRIGGER_DEF="$(psql -Atqc "SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.orders'::regclass AND tgname='trg_push_orders_notify' AND NOT tgisinternal")"
echo "PASS: baseline da função e do gatilho originais capturado no PostgreSQL 17"

psql -v ON_ERROR_STOP=1 -f "$MIG" >"$TMP/migration.log" 2>&1
echo "PASS: migration aplicada no PostgreSQL 17 temporário"
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261113140000_admin_order_item_separation.sql >"$TMP/separation-base.log" 2>&1
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261113160000_order_separation_cancel_lock.sql >"$TMP/separation-lock.log" 2>&1
echo "PASS: migration de trava da separação aplicada no PostgreSQL 17 temporário"

psql -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO public.admin_users(user_id) VALUES ('33333333-3333-3333-3333-333333333333');
INSERT INTO public.orders(id,customer_name,customer_phone,customer_address,delivery_type,payment_method,items,subtotal,delivery_fee,total,status,market_checklist,user_id)
VALUES
 ('cancel-before-separation','T','1','A','pickup_store','pix','[{"qty":1}]',30,0,30,'Pagamento Confirmado','{}','11111111-1111-1111-1111-111111111111'),
 ('cancel-after-separation','T','1','A','pickup_store','pix','[{"qty":1}]',30,0,30,'Pagamento Confirmado','{}','11111111-1111-1111-1111-111111111111'),
 ('unmark-keeps-lock','T','1','A','pickup_store','pix','[{"qty":1}]',30,0,30,'Pagamento Confirmado','{}','11111111-1111-1111-1111-111111111111'),
 ('cannot-mark-cancelled','T','1','A','pickup_store','pix','[{"qty":1}]',30,0,30,'Cancelada','{}','11111111-1111-1111-1111-111111111111');
SELECT pg_catalog.set_config('test.uid','33333333-3333-3333-3333-333333333333',false);
SELECT public.set_order_separated_items('cancel-after-separation','["line-a"]'::jsonb);
SELECT public.set_order_separated_items('unmark-keeps-lock','["line-a"]'::jsonb);
DO $ DECLARE v_started timestamptz; BEGIN
 SELECT separation_started_at INTO v_started FROM public.orders WHERE id='unmark-keeps-lock';
 IF v_started IS NULL THEN RAISE EXCEPTION 'FAIL: primeiro item não gravou separation_started_at'; END IF;
 PERFORM public.set_order_separated_items('unmark-keeps-lock','[]'::jsonb);
 IF (SELECT separation_started_at FROM public.orders WHERE id='unmark-keeps-lock') IS DISTINCT FROM v_started THEN RAISE EXCEPTION 'FAIL: desmarcar apagou separation_started_at'; END IF;
 RAISE NOTICE 'PASS: marcar e desmarcar preserva separation_started_at';
END $;
DO $ BEGIN
 BEGIN PERFORM public.set_order_separated_items('cannot-mark-cancelled','["line-a"]'::jsonb); RAISE EXCEPTION 'FAIL: marcou pedido cancelado';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM NOT LIKE 'pedido_cancelado:%' THEN RAISE; END IF; RAISE NOTICE 'PASS: pedido cancelado não aceita marcação'; END;
END $;
SELECT pg_catalog.set_config('test.uid','11111111-1111-1111-1111-111111111111',false);
SELECT public.cancel_my_order('cancel-before-separation');
DO $ BEGIN
 IF (SELECT status FROM public.orders WHERE id='cancel-before-separation') IS DISTINCT FROM 'Cancelada' THEN RAISE EXCEPTION 'FAIL: cancelamento antes da separação não funcionou'; END IF;
 BEGIN PERFORM public.cancel_my_order('cancel-after-separation'); RAISE EXCEPTION 'FAIL: cancelou depois da separação';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'ja_em_separacao' THEN RAISE; END IF; RAISE NOTICE 'PASS: cancelamento após separação recusado'; END;
 BEGIN PERFORM public.cancel_my_order('unmark-keeps-lock'); RAISE EXCEPTION 'FAIL: cancelou após desmarcar todos os itens';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'ja_em_separacao' THEN RAISE; END IF; RAISE NOTICE 'PASS: trava continua após desmarcar todos os itens'; END;
END $;
INSERT INTO public.orders(id,customer_name,customer_phone,customer_address,delivery_type,payment_method,items,subtotal,delivery_fee,total,status,market_checklist,user_id)
VALUES
 ('ok-received','T','1','A','delivery','pix','[{"qty":1}]',30,0,30,'Pedido Recebido','{}','11111111-1111-1111-1111-111111111111'),
 ('ok-pending','T','1','A','delivery','pix','[{"qty":1}]',30,0,30,'Pagamento Pendente','{}','11111111-1111-1111-1111-111111111111'),
 ('ok-paid','T','1','A','delivery','pix','[{"qty":1}]',30,0,30,'Pagamento Confirmado','{}','11111111-1111-1111-1111-111111111111'),
 ('no-preparing','T','1','A','delivery','pix','[{"qty":1}]',30,0,30,'Preparando','{}','11111111-1111-1111-1111-111111111111'),
 ('no-ready','T','1','A','delivery','pix','[{"qty":1}]',30,0,30,'Pronto para Retirada','{}','11111111-1111-1111-1111-111111111111'),
 ('no-delivered','T','1','A','delivery','pix','[{"qty":1}]',30,0,30,'Entregue','{}','11111111-1111-1111-1111-111111111111'),
 ('no-cancelled','T','1','A','delivery','pix','[{"qty":1}]',30,0,30,'Cancelada','{}','11111111-1111-1111-1111-111111111111'),
 ('wrong-owner','T','1','A','delivery','pix','[{"qty":1}]',30,0,30,'Pedido Recebido','{}','22222222-2222-2222-2222-222222222222'),
 ('admin-paid','T','1','A','delivery','pix','[{"qty":1}]',30,0,30,'Pagamento Confirmado','{}','22222222-2222-2222-2222-222222222222'),
 ('push-fail-paid','T','1','A','delivery','pix','[{"qty":1}]',30,0,30,'Pagamento Confirmado','{}','11111111-1111-1111-1111-111111111111');
SELECT pg_catalog.set_config('test.uid','11111111-1111-1111-1111-111111111111',false);
SELECT pg_catalog.set_config('test.admin','false',false);
SELECT public.cancel_my_order('ok-received');
SELECT public.cancel_my_order('ok-pending');
SELECT public.cancel_my_order('ok-paid');
DO $$
DECLARE v_id text;
BEGIN
  FOREACH v_id IN ARRAY ARRAY['no-preparing','no-ready','no-delivered','no-cancelled'] LOOP
    BEGIN
      PERFORM public.cancel_my_order(v_id);
      RAISE EXCEPTION 'FAIL: status % deveria ser recusado',v_id;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      RAISE NOTICE 'PASS: status % recusado',v_id;
    END;
  END LOOP;
  BEGIN
    PERFORM public.cancel_my_order('wrong-owner');
    RAISE EXCEPTION 'FAIL: pedido de outro usuário deveria ser recusado';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    RAISE NOTICE 'PASS: pedido de outro usuário recusado';
  END;
END $$;
SELECT pg_catalog.set_config('test.uid','',false);
DO $$
BEGIN
  BEGIN
    PERFORM public.cancel_my_order('ok-received');
    RAISE EXCEPTION 'FAIL: usuário sem login deveria ser recusado';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    RAISE NOTICE 'PASS: usuário sem login recusado';
  END;
END $$;
SELECT pg_catalog.set_config('test.uid','11111111-1111-1111-1111-111111111111',false);
DO $$
BEGIN
  IF (SELECT refund_pending FROM public.orders WHERE id='ok-received') IS DISTINCT FROM false THEN RAISE EXCEPTION 'FAIL: não pago Pedido Recebido com refund_pending'; END IF;
  IF (SELECT refund_pending FROM public.orders WHERE id='ok-pending') IS DISTINCT FROM false THEN RAISE EXCEPTION 'FAIL: não pago Pagamento Pendente com refund_pending'; END IF;
  IF (SELECT refund_pending FROM public.orders WHERE id='ok-paid') IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: pedido pago sem refund_pending'; END IF;
  IF (SELECT cancelled_by FROM public.orders WHERE id='ok-paid') IS DISTINCT FROM 'cliente' THEN RAISE EXCEPTION 'FAIL: cancelled_by do cliente incorreto'; END IF;
  RAISE NOTICE 'PASS: refund_pending false nos não pagos e true no pago';
END $$;

-- Avisos de pedido recebido: preserva todos os meios existentes, incluindo retirada.
INSERT INTO public.orders(id,customer_name,customer_phone,customer_address,delivery_type,payment_method,items,subtotal,delivery_fee,total,status,market_checklist,user_id)
SELECT 'legacy-'||md5(pm), 'T','1','A','pickup_store',pm,'[{"qty":1}]',30,0,30,'Pedido Recebido','{}','11111111-1111-1111-1111-111111111111'
FROM unnest(ARRAY['cash','Dinheiro na retirada','Dinheiro na entrega','Cartão na retirada','Cartão na entrega']) AS pm;
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.push_log
   WHERE payload->>'kind'='admin'
     AND payload->>'new_status'='Pedido Recebido';
  IF n<>5 THEN RAISE EXCEPTION 'FAIL: esperados 5 avisos antigos de pedido recebido, encontrados %',n; END IF;
  RAISE NOTICE 'PASS: 5 avisos antigos de pedido recebido, incluindo Dinheiro e Cartão na retirada';
END $$;

-- Aviso Pix confirmado preservado.
INSERT INTO public.orders(id,customer_name,customer_phone,customer_address,delivery_type,payment_method,items,subtotal,delivery_fee,total,status,market_checklist,user_id)
VALUES ('legacy-pix','T','1','A','delivery','Asaas Pix','[{"qty":1}]',30,0,30,'Pagamento Pendente','{}','11111111-1111-1111-1111-111111111111');
UPDATE public.orders SET status='Pagamento Confirmado' WHERE id='legacy-pix';
DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.push_log WHERE payload->>'order_id'='legacy-pix' AND payload->>'kind'='admin' AND payload->>'new_status'='Pagamento Confirmado') THEN RAISE EXCEPTION 'FAIL: aviso antigo de Pix confirmado ausente'; END IF;
  RAISE NOTICE 'PASS: aviso antigo Pagamento Pix confirmado preservado';
END $$;

-- Aviso ao cliente de cancelamento preservado.
DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.push_log WHERE payload->>'order_id'='ok-received' AND payload->>'kind'='customer' AND payload->>'new_status'='Cancelada') THEN RAISE EXCEPTION 'FAIL: aviso de cancelamento ao cliente ausente'; END IF;
  RAISE NOTICE 'PASS: evento de cancelamento ao cliente preservado';
END $$;

-- Avisos novos: só na transição refund_pending -> true.
DO $$
DECLARE n_before integer; n_after integer;
BEGIN
  SELECT count(*) INTO n_before FROM public.push_log WHERE payload->>'order_id'='ok-paid' AND payload->>'new_status'='Pedido pago cancelado pelo cliente — devolver Pix';
  UPDATE public.orders SET refund_pending=true WHERE id='ok-paid';
  SELECT count(*) INTO n_after FROM public.push_log WHERE payload->>'order_id'='ok-paid' AND payload->>'new_status'='Pedido pago cancelado pelo cliente — devolver Pix';
  IF n_after<>n_before THEN RAISE EXCEPTION 'FAIL: aviso duplicado sem transição false->true'; END IF;
  IF n_after<>1 THEN RAISE EXCEPTION 'FAIL: esperado exatamente 1 aviso de devolução do cliente, recebido %',n_after; END IF;
  RAISE NOTICE 'PASS: aviso de devolução do cliente somente na transição para true';
END $$;

-- Cancelamento administrativo pago.
SELECT pg_catalog.set_config('test.uid','33333333-3333-3333-3333-333333333333',false);
SELECT pg_catalog.set_config('test.admin','true',false);
UPDATE public.orders SET status='Cancelada' WHERE id='admin-paid';
DO $$
BEGIN
  IF (SELECT refund_pending FROM public.orders WHERE id='admin-paid') IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: cancelamento admin pago sem refund_pending'; END IF;
  IF (SELECT cancelled_by FROM public.orders WHERE id='admin-paid') IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'FAIL: cancelled_by admin incorreto'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.push_log WHERE payload->>'order_id'='admin-paid' AND payload->>'new_status'='Pix pago em pedido cancelado — devolver' AND payload->>'kind'='admin') THEN RAISE EXCEPTION 'FAIL: aviso de devolução admin ausente'; END IF;
  RAISE NOTICE 'PASS: cancelamento admin pago marca refund_pending e envia aviso administrativo';
END $$;

-- Falha no push não pode impedir o cancelamento.
SELECT pg_catalog.set_config('test.uid','11111111-1111-1111-1111-111111111111',false);
SELECT pg_catalog.set_config('test.admin','false',false);
SELECT pg_catalog.set_config('test.push_fail','true',false);
SELECT public.cancel_my_order('push-fail-paid');
DO $$
BEGIN
  IF (SELECT status FROM public.orders WHERE id='push-fail-paid') IS DISTINCT FROM 'Cancelada'
     OR (SELECT refund_pending FROM public.orders WHERE id='push-fail-paid') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: falha de push impediu cancelamento';
  END IF;
  RAISE NOTICE 'PASS: falha simulada do push não bloqueia cancelamento';
END $$;
SELECT pg_catalog.set_config('test.push_fail','false',false);
SQL

echo "PASS: cenários de cancelamento, autorização, refund_pending e notificações concluídos"
psql -v ON_ERROR_STOP=1 -f "$ROLLBACK" >"$TMP/rollback.log" 2>&1
RESTORED_FUNCTION_HASH="$(psql -Atqc "SELECT md5(pg_get_functiondef('public.push_orders_notify()'::regprocedure))")"
RESTORED_TRIGGER_DEF="$(psql -Atqc "SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.orders'::regclass AND tgname='trg_push_orders_notify' AND NOT tgisinternal")"
if [[ "$RESTORED_FUNCTION_HASH" != "$ORIGINAL_FUNCTION_HASH" ]]; then
  echo "FAIL: rollback não restaurou hash exato da função"
  echo "expected=$ORIGINAL_FUNCTION_HASH"
  echo "actual=$RESTORED_FUNCTION_HASH"
  exit 1
fi
echo "PASS: rollback restaurou exatamente o hash original de push_orders_notify()"
if [[ "$RESTORED_TRIGGER_DEF" != "$ORIGINAL_TRIGGER_DEF" ]]; then
  echo "FAIL: rollback não restaurou definição exata do gatilho"
  echo "expected=$ORIGINAL_TRIGGER_DEF"
  echo "actual=$RESTORED_TRIGGER_DEF"
  exit 1
fi
echo "PASS: rollback restaurou exatamente trg_push_orders_notify"
if [[ "$(psql -Atqc "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name IN ('refund_pending','cancelled_by','cancelled_at')")" != "0" ]]; then
  echo "FAIL: rollback deixou colunas da Ordem 229"
  exit 1
fi
echo "PASS: rollback removeu as três colunas da Ordem 229"
echo "RESULTADO FINAL: PASS — todos os testes da Ordem 229-C"
