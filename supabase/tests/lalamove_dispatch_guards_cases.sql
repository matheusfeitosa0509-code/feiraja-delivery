\set ON_ERROR_STOP on
DO $tests$
DECLARE
 v_session uuid;
 v_result jsonb;
 v_yesterday timestamptz := (date_trunc('day',now() at time zone 'America/Manaus') - interval '1 day') at time zone 'America/Manaus';
BEGIN
 -- a) Pix method alone is insufficient: status remains unpaid.
 v_session:=pg_temp.seed_dispatch_case('guard-a','Aguardando Pagamento Pix');
 v_result:=public.service_begin_lalamove_dispatch('guard-a',v_session,'MOTO','sandbox',false);
 IF v_result->>'code'<>'PAYMENT_NOT_CONFIRMED' THEN RAISE EXCEPTION 'FAIL a: %',v_result; END IF;

 -- b) Cancelled order.
 v_session:=pg_temp.seed_dispatch_case('guard-b','Cancelada');
 v_result:=public.service_begin_lalamove_dispatch('guard-b',v_session,'MOTO','sandbox',false);
 IF v_result->>'code'<>'ORDER_CLOSED' THEN RAISE EXCEPTION 'FAIL b: %',v_result; END IF;

 -- c) Test order, even with a paid-looking Asaas record.
 v_session:=pg_temp.seed_dispatch_case('guard-c','Pagamento Confirmado','asaas','pay_test_123',true);
 v_result:=public.service_begin_lalamove_dispatch('guard-c',v_session,'MOTO','sandbox',false);
 IF v_result->>'code'<>'TEST_ORDER' THEN RAISE EXCEPTION 'FAIL c: %',v_result; END IF;

 -- d) Not today in America/Manaus.
 v_session:=pg_temp.seed_dispatch_case('guard-d','Pagamento Confirmado','asaas','pay_test_123',false,v_yesterday);
 v_result:=public.service_begin_lalamove_dispatch('guard-d',v_session,'MOTO','sandbox',false);
 IF v_result->>'code'<>'ORDER_NOT_TODAY' THEN RAISE EXCEPTION 'FAIL d: %',v_result; END IF;

 -- e) Existing creating reservation.
 v_session:=pg_temp.seed_dispatch_case('guard-e','Pagamento Confirmado','asaas','pay_test_123',false,now(),'creating');
 v_result:=public.service_begin_lalamove_dispatch('guard-e',v_session,'MOTO','sandbox',false);
 IF v_result->>'code'<>'DISPATCH_ALREADY_ACTIVE' THEN RAISE EXCEPTION 'FAIL e: %',v_result; END IF;

 -- Every rejection writes a visible admin alert.
 IF (SELECT count(*) FROM public.admin_alerts WHERE tipo='dispatch_blocked'
     AND order_id IN ('guard-a','guard-b','guard-c','guard-d','guard-e'))<>5 THEN
   RAISE EXCEPTION 'FAIL alerts: expected 5 dispatch_blocked alerts';
 END IF;

 -- Valid paid Asaas order reserves the dispatch.
 v_session:=pg_temp.seed_dispatch_case('guard-valid');
 v_result:=public.service_begin_lalamove_dispatch('guard-valid',v_session,'MOTO','sandbox',false);
 IF coalesce((v_result->>'started')::boolean,false) IS NOT TRUE THEN
   RAISE EXCEPTION 'FAIL valid: %',v_result;
 END IF;
END
$tests$;
SELECT 'PASSOU | bloqueios a-e, alertas e pedido válido' AS resultado;
