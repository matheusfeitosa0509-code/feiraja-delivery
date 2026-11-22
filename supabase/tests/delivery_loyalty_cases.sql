\set ON_ERROR_STOP on
DO $tests$
DECLARE v_order public.orders%ROWTYPE; v_stamps integer; v_count integer;
BEGIN
 IF (SELECT enabled FROM promo_private.delivery_loyalty_settings WHERE singleton=true) IS DISTINCT FROM false
    OR (SELECT stamps_required FROM promo_private.delivery_loyalty_settings WHERE singleton=true) <> 6
 THEN RAISE EXCEPTION 'FAIL: default must be disabled with six stamps'; END IF;
 INSERT INTO auth.users(id) VALUES
 ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002'),
 ('00000000-0000-4000-8000-000000000003'),('00000000-0000-4000-8000-000000000004');
 UPDATE promo_private.delivery_loyalty_settings SET enabled=true,stamps_required=6,discount_cap=NULL WHERE singleton=true;
 UPDATE promo_private.promo_settings SET enabled=false,min_subtotal=50,ends_at=now()+interval '1 day',discount_cap=NULL WHERE singleton=true;

 -- Cancelled orders never earn a stamp.
 INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,subtotal,delivery_fee,total,status,payment_method)
 VALUES('loyalty-cancelled','00000000-0000-4000-8000-000000000001','92911110001','delivery',40,10,50,'Pagamento Pendente','Asaas Pix');
 UPDATE public.orders SET status='Cancelada' WHERE id='loyalty-cancelled';
 IF EXISTS(SELECT 1 FROM promo_private.delivery_loyalty_stamp_orders WHERE order_id='loyalty-cancelled')
 THEN RAISE EXCEPTION 'FAIL: cancelled order earned a stamp'; END IF;

 -- Five paid completed orders, then an order below R$30 must not count.
 FOR i IN 1..5 LOOP
  INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,subtotal,delivery_fee,total,status,payment_method)
  VALUES('loyalty-stamp-'||i,'00000000-0000-4000-8000-000000000001','92911110001','pickup_store',35,0,35,'Pagamento Confirmado','Asaas Pix');
  UPDATE public.orders SET status='Pedido Concluído' WHERE id='loyalty-stamp-'||i;
 END LOOP;
 INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,subtotal,delivery_fee,total,status,payment_method)
 VALUES('loyalty-below-min','00000000-0000-4000-8000-000000000001','92911110001','pickup_store',29.99,0,29.99,'Pagamento Confirmado','Asaas Pix');
 UPDATE public.orders SET status='Entregue' WHERE id='loyalty-below-min';
 SELECT stamps INTO v_stamps FROM promo_private.delivery_loyalty_balances WHERE user_id='00000000-0000-4000-8000-000000000001';
 IF v_stamps<>5 THEN RAISE EXCEPTION 'FAIL: expected five stamps before sixth, got %',v_stamps; END IF;

 -- Sixth stamp makes reward available. Repeated status updates cannot award twice.
 INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,subtotal,delivery_fee,total,status,payment_method)
 VALUES('loyalty-stamp-6','00000000-0000-4000-8000-000000000001','92911110001','pickup_store',30,0,30,'Pagamento Confirmado','Asaas Pix');
 UPDATE public.orders SET status='Entregue' WHERE id='loyalty-stamp-6';
 UPDATE public.orders SET market_checklist='{}'::jsonb WHERE id='loyalty-stamp-6';
 SELECT stamps INTO v_stamps FROM promo_private.delivery_loyalty_balances WHERE user_id='00000000-0000-4000-8000-000000000001';
 IF v_stamps<>6 THEN RAISE EXCEPTION 'FAIL: sixth stamp/retry count expected 6, got %',v_stamps; END IF;

 -- Pickup never consumes the delivery reward.
 INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,subtotal,delivery_fee,total,status,payment_method)
 VALUES('loyalty-pickup','00000000-0000-4000-8000-000000000001','92911110001','pickup_store',40,0,40,'Pagamento Pendente','Asaas Pix');
 SELECT stamps INTO v_stamps FROM promo_private.delivery_loyalty_balances WHERE user_id='00000000-0000-4000-8000-000000000001';
 IF v_stamps<>6 OR EXISTS(SELECT 1 FROM promo_private.delivery_loyalty_redemptions WHERE order_id='loyalty-pickup')
 THEN RAISE EXCEPTION 'FAIL: pickup consumed a reward'; END IF;

 -- Next delivery is fully free for the customer; delivery_fee remains full for dispatch.
 INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,subtotal,delivery_fee,total,status,payment_method)
 VALUES('loyalty-redeem','00000000-0000-4000-8000-000000000001','92911110001','delivery',45,24.42,69.42,'Pagamento Pendente','Asaas Pix');
 SELECT * INTO v_order FROM public.orders WHERE id='loyalty-redeem';
 IF v_order.promo_code<>'FIDELIDADE' OR v_order.delivery_discount<>24.42
    OR v_order.delivery_fee<>24.42 OR v_order.total<>45
 THEN RAISE EXCEPTION 'FAIL: reward total/dispatch fee mismatch: %, %, %, %',v_order.promo_code,v_order.delivery_discount,v_order.delivery_fee,v_order.total; END IF;
 SELECT stamps INTO v_stamps FROM promo_private.delivery_loyalty_balances WHERE user_id='00000000-0000-4000-8000-000000000001';
 IF v_stamps<>0 THEN RAISE EXCEPTION 'FAIL: reward did not reset stamps'; END IF;
 UPDATE public.orders SET status='Pagamento Confirmado' WHERE id='loyalty-redeem';
 IF (SELECT status FROM promo_private.delivery_loyalty_redemptions WHERE order_id='loyalty-redeem')<>'used'
 THEN RAISE EXCEPTION 'FAIL: reward not marked used'; END IF;

 -- First-delivery promo has priority; a preloaded reward cannot stack on the same order.
 INSERT INTO promo_private.delivery_loyalty_balances(user_id,stamps) VALUES('00000000-0000-4000-8000-000000000002',6);
 UPDATE promo_private.promo_settings SET enabled=true,min_subtotal=50,ends_at=now()+interval '1 day',discount_cap=NULL WHERE singleton=true;
 INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,delivery_address,subtotal,delivery_fee,total,status,payment_method)
 VALUES('loyalty-no-stack','00000000-0000-4000-8000-000000000002','92922220002','delivery',
 '{"postal_code":"69000-002","number":"20"}',60,20,80,'Pagamento Pendente','Asaas Pix');
 SELECT * INTO v_order FROM public.orders WHERE id='loyalty-no-stack';
 IF v_order.promo_code<>'PRIMEIRA_ENTREGA' OR v_order.delivery_discount<>20
    OR EXISTS(SELECT 1 FROM promo_private.delivery_loyalty_redemptions WHERE order_id='loyalty-no-stack')
 THEN RAISE EXCEPTION 'FAIL: first-delivery and loyalty promotions stacked'; END IF;
 IF (SELECT stamps FROM promo_private.delivery_loyalty_balances WHERE user_id='00000000-0000-4000-8000-000000000002')<>6
 THEN RAISE EXCEPTION 'FAIL: non-stacked reward balance changed'; END IF;

 -- A canceled pending reward reservation is released and its stamps restored.
 INSERT INTO promo_private.delivery_loyalty_balances(user_id,stamps) VALUES('00000000-0000-4000-8000-000000000003',6);
 INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,subtotal,delivery_fee,total,status,payment_method)
 VALUES('loyalty-release','00000000-0000-4000-8000-000000000003','92933330003','delivery',40,10,50,'Pagamento Pendente','Asaas Pix');
 UPDATE public.orders SET status='Cancelada' WHERE id='loyalty-release';
 IF (SELECT status FROM promo_private.delivery_loyalty_redemptions WHERE order_id='loyalty-release')<>'released'
    OR (SELECT stamps FROM promo_private.delivery_loyalty_balances WHERE user_id='00000000-0000-4000-8000-000000000003')<>6
 THEN RAISE EXCEPTION 'FAIL: cancellation did not release reward and restore stamps'; END IF;

 -- Configured cap is respected; test orders never earn.
 INSERT INTO promo_private.delivery_loyalty_balances(user_id,stamps) VALUES('00000000-0000-4000-8000-000000000004',6);
 UPDATE promo_private.delivery_loyalty_settings SET discount_cap=7 WHERE singleton=true;
 INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,subtotal,delivery_fee,total,status,payment_method)
 VALUES('loyalty-cap','00000000-0000-4000-8000-000000000004','92944440004','delivery',40,20,60,'Pagamento Pendente','Asaas Pix');
 SELECT * INTO v_order FROM public.orders WHERE id='loyalty-cap';
 IF v_order.promo_code<>'FIDELIDADE' OR v_order.delivery_discount<>7 OR v_order.delivery_fee<>20 OR v_order.total<>53
 THEN RAISE EXCEPTION 'FAIL: discount cap or original delivery fee'; END IF;
 UPDATE promo_private.delivery_loyalty_settings SET discount_cap=NULL WHERE singleton=true;
 INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,subtotal,delivery_fee,total,status,payment_method,is_test_order)
 VALUES('loyalty-test-order','00000000-0000-4000-8000-000000000004','92944440004','pickup_store',40,0,40,'Pagamento Confirmado','Pix de teste (admin)',true);
 UPDATE public.orders SET status='Entregue' WHERE id='loyalty-test-order';
 IF EXISTS(SELECT 1 FROM promo_private.delivery_loyalty_stamp_orders WHERE order_id='loyalty-test-order')
 THEN RAISE EXCEPTION 'FAIL: test order earned a stamp'; END IF;

 -- Private ledgers are not readable by public client roles.
 IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='promo_private.delivery_loyalty_balances'::regclass)
    OR has_table_privilege('anon','promo_private.delivery_loyalty_balances','SELECT')
    OR has_table_privilege('authenticated','promo_private.delivery_loyalty_balances','SELECT')
 THEN RAISE EXCEPTION 'FAIL: loyalty ledger RLS/grants'; END IF;
END
$tests$;
SELECT 'PASSOU | selo, cancelado, mínimo, sexto selo, reset, primeira entrega sem acúmulo, retirada, teto, pedido teste, RLS' AS resultado;
