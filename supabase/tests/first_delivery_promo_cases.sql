\set ON_ERROR_STOP on
DO $tests$
DECLARE
  v_count integer;
  v_row public.orders%ROWTYPE;
BEGIN
  UPDATE private.promo_settings
  SET enabled = true, min_subtotal = 50, ends_at = pg_catalog.now() + interval '1 day', discount_cap = NULL
  WHERE singleton = true;

  -- Elegível: frete integralmente descontado e total recalculado no trigger.
  INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,delivery_address,subtotal,delivery_fee,total,status)
  VALUES ('promo-eligible','00000000-0000-4000-8000-000000000001','(92) 99999-0001','delivery',
    '{"postal_code":"69000-001","number":"10"}',60,12,72,'Pagamento Pendente');
  SELECT * INTO v_row FROM public.orders WHERE id='promo-eligible';
  IF v_row.promo_code <> 'PRIMEIRA_ENTREGA' OR v_row.delivery_fee_original <> 12
     OR v_row.delivery_discount <> 12 OR v_row.total <> 60 THEN
    RAISE EXCEPTION 'FAIL eligible: %, %, %, %',v_row.promo_code,v_row.delivery_fee_original,v_row.delivery_discount,v_row.total;
  END IF;

  -- Abaixo do mínimo.
  INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,delivery_address,subtotal,delivery_fee,total,status)
  VALUES ('promo-below','00000000-0000-4000-8000-000000000002','92999990002','delivery',
    '{"postal_code":"69000-002","number":"11"}',49.99,12,61.99,'Pagamento Pendente');
  IF (SELECT delivery_discount FROM public.orders WHERE id='promo-below') <> 0 THEN RAISE EXCEPTION 'FAIL below minimum'; END IF;

  -- Retirada.
  INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,delivery_address,subtotal,delivery_fee,total,status)
  VALUES ('promo-pickup','00000000-0000-4000-8000-000000000003','92999990003','pickup_store',
    NULL,60,0,60,'Pagamento Pendente');
  IF (SELECT delivery_discount FROM public.orders WHERE id='promo-pickup') <> 0 THEN RAISE EXCEPTION 'FAIL pickup'; END IF;

  -- Promoção desligada.
  UPDATE private.promo_settings SET enabled=false WHERE singleton=true;
  INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,delivery_address,subtotal,delivery_fee,total,status)
  VALUES ('promo-disabled','00000000-0000-4000-8000-000000000004','92999990004','delivery',
    '{"postal_code":"69000-004","number":"14"}',60,12,72,'Pagamento Pendente');
  IF (SELECT delivery_discount FROM public.orders WHERE id='promo-disabled') <> 0 THEN RAISE EXCEPTION 'FAIL disabled'; END IF;

  -- Fora da data.
  UPDATE private.promo_settings SET enabled=true, ends_at=pg_catalog.now()-interval '1 second' WHERE singleton=true;
  INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,delivery_address,subtotal,delivery_fee,total,status)
  VALUES ('promo-expired-window','00000000-0000-4000-8000-000000000005','92999990005','delivery',
    '{"postal_code":"69000-005","number":"15"}',60,12,72,'Pagamento Pendente');
  IF (SELECT delivery_discount FROM public.orders WHERE id='promo-expired-window') <> 0 THEN RAISE EXCEPTION 'FAIL outside date'; END IF;

  UPDATE private.promo_settings SET ends_at=pg_catalog.now()+interval '1 day' WHERE singleton=true;

  -- Mesmo usuário em outra tentativa: só a primeira reserva recebe desconto.
  INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,delivery_address,subtotal,delivery_fee,total,status)
  VALUES ('promo-same-user-2','00000000-0000-4000-8000-000000000001','92999990006','delivery',
    '{"postal_code":"69000-006","number":"16"}',60,12,72,'Pagamento Pendente');
  IF (SELECT delivery_discount FROM public.orders WHERE id='promo-same-user-2') <> 0 THEN RAISE EXCEPTION 'FAIL same account'; END IF;

  -- Mesmo telefone em contas diferentes.
  INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,delivery_address,subtotal,delivery_fee,total,status)
  VALUES ('promo-phone-1','00000000-0000-4000-8000-000000000007','(92) 98888-0007','delivery',
    '{"postal_code":"69000-007","number":"17"}',60,12,72,'Pagamento Pendente');
  INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,delivery_address,subtotal,delivery_fee,total,status)
  VALUES ('promo-phone-2','00000000-0000-4000-8000-000000000008','92 98888-0007','delivery',
    '{"postal_code":"69000-008","number":"18"}',60,12,72,'Pagamento Pendente');
  IF (SELECT delivery_discount FROM public.orders WHERE id='promo-phone-2') <> 0 THEN RAISE EXCEPTION 'FAIL same phone'; END IF;

  -- Mesmo CEP+número em contas diferentes.
  INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,delivery_address,subtotal,delivery_fee,total,status)
  VALUES ('promo-address-1','00000000-0000-4000-8000-000000000009','92977770009','delivery',
    '{"postal_code":"69000-009","number":" 19 "}',60,12,72,'Pagamento Pendente');
  INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,delivery_address,subtotal,delivery_fee,total,status)
  VALUES ('promo-address-2','00000000-0000-4000-8000-000000000010','92977770010','delivery',
    '{"postal_code":"69000-009","number":"19"}',60,12,72,'Pagamento Pendente');
  IF (SELECT delivery_discount FROM public.orders WHERE id='promo-address-2') <> 0 THEN RAISE EXCEPTION 'FAIL same address'; END IF;

  -- Cancelamento libera a reserva; a tentativa seguinte ganha.
  INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,delivery_address,subtotal,delivery_fee,total,status)
  VALUES ('promo-release-1','00000000-0000-4000-8000-000000000011','92966660011','delivery',
    '{"postal_code":"69000-011","number":"21"}',60,12,72,'Pagamento Pendente');
  UPDATE public.orders SET status='Cancelada' WHERE id='promo-release-1';
  IF (SELECT status FROM public.promo_redemptions WHERE order_id='promo-release-1') <> 'released' THEN RAISE EXCEPTION 'FAIL release status'; END IF;
  INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,delivery_address,subtotal,delivery_fee,total,status)
  VALUES ('promo-release-2','00000000-0000-4000-8000-000000000011','92966660011','delivery',
    '{"postal_code":"69000-011","number":"21"}',60,12,72,'Pagamento Pendente');
  IF (SELECT delivery_discount FROM public.orders WHERE id='promo-release-2') <> 12 THEN RAISE EXCEPTION 'FAIL released reservation not reusable'; END IF;

  -- Pagamento converte reserva em usada; a mesma conta não recebe outra.
  UPDATE public.orders SET status='Pagamento Confirmado' WHERE id='promo-eligible';
  IF (SELECT status FROM public.promo_redemptions WHERE order_id='promo-eligible') <> 'used' THEN RAISE EXCEPTION 'FAIL used status'; END IF;

  -- Teto limita o desconto sem alterar a taxa de entrega original.
  UPDATE private.promo_settings SET discount_cap=5 WHERE singleton=true;
  INSERT INTO public.orders(id,user_id,customer_phone,delivery_type,delivery_address,subtotal,delivery_fee,total,status)
  VALUES ('promo-cap','00000000-0000-4000-8000-000000000012','92955550012','delivery',
    '{"postal_code":"69000-012","number":"22"}',60,12,72,'Pagamento Pendente');
  SELECT * INTO v_row FROM public.orders WHERE id='promo-cap';
  IF v_row.delivery_fee_original <> 12 OR v_row.delivery_discount <> 5 OR v_row.total <> 67 THEN
    RAISE EXCEPTION 'FAIL cap: %, %, %',v_row.delivery_fee_original,v_row.delivery_discount,v_row.total;
  END IF;

  -- RLS e grants: nenhum acesso de anon/authenticated à tabela de resgates.
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.promo_redemptions'::regclass) THEN
    RAISE EXCEPTION 'FAIL RLS disabled';
  END IF;
  IF has_table_privilege('anon','public.promo_redemptions','SELECT')
     OR has_table_privilege('authenticated','public.promo_redemptions','SELECT') THEN
    RAISE EXCEPTION 'FAIL client table access granted';
  END IF;
END
$tests$;

SELECT 'PASSOU | elegível, mínimo, retirada, desligada, data, conta, telefone, endereço, cancelamento/liberação, pagamento/uso, teto, RLS/grants' AS resultado;
