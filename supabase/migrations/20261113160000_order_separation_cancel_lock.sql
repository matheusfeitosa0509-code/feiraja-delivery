-- Feira On Delivery: início irreversível da separação e trava atômica do cancelamento pelo cliente.
-- Aplicar manualmente após revisão e autorização do proprietário.
BEGIN;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS separation_started_at timestamptz NULL;
UPDATE public.orders SET separation_started_at=pg_catalog.clock_timestamp() WHERE separation_started_at IS NULL AND jsonb_typeof(separated_items)='array' AND jsonb_array_length(separated_items)>0;
COMMENT ON COLUMN public.orders.separation_started_at IS 'Momento em que o administrador marcou o primeiro item como separado; nunca é apagado ao desmarcar itens.';
GRANT SELECT (separation_started_at) ON TABLE public.orders TO authenticated;
REVOKE UPDATE (separation_started_at) ON TABLE public.orders FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_order_separated_items(p_order_id text,p_item_keys jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE v_status text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação necessária' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id=auth.uid()) THEN RAISE EXCEPTION 'Apenas administradores podem marcar itens separados' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_item_keys) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'A lista de itens separados deve ser um array JSON' USING ERRCODE='22023'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_item_keys) item(value) WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'Cada identificação de item deve ser texto' USING ERRCODE='22023'; END IF;
 UPDATE public.orders o SET separated_items=p_item_keys,separation_started_at=COALESCE(o.separation_started_at,CASE WHEN jsonb_array_length(p_item_keys)>0 THEN clock_timestamp() ELSE NULL END) WHERE o.id=p_order_id AND lower(pg_catalog.btrim(o.status)) NOT IN ('cancelada','cancelado','pagamento cancelado','pagamento recusado');
 IF NOT FOUND THEN
  SELECT o.status INTO v_status FROM public.orders o WHERE o.id=p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado' USING ERRCODE='P0002'; END IF;
  IF lower(pg_catalog.btrim(v_status)) IN ('cancelada','cancelado','pagamento cancelado','pagamento recusado') THEN RAISE EXCEPTION 'pedido_cancelado: não é possível marcar itens de um pedido cancelado' USING ERRCODE='P0001'; END IF;
 END IF;
 RETURN p_item_keys;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_order_separated_items(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_order_separated_items(text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_my_order(p_order_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user_id uuid; v_order_user_id uuid; v_order_status text; v_separation_started_at timestamptz; v_refund_pending boolean;
BEGIN
 v_user_id:=auth.uid();
 IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
 UPDATE public.orders o SET status='Cancelada',cancelled_by='cliente',cancelled_at=pg_catalog.clock_timestamp(),refund_pending=(o.status='Pagamento Confirmado')
 WHERE o.id=p_order_id AND o.user_id=v_user_id AND o.separation_started_at IS NULL AND o.status IN ('Pedido Recebido','Pagamento Pendente','Pagamento Confirmado')
 RETURNING o.refund_pending INTO v_refund_pending;
 IF FOUND THEN RETURN pg_catalog.jsonb_build_object('status','Cancelada','refund_pending',v_refund_pending); END IF;
 SELECT o.user_id,o.status,o.separation_started_at INTO v_order_user_id,v_order_status,v_separation_started_at FROM public.orders o WHERE o.id=p_order_id;
 IF NOT FOUND OR v_order_user_id IS DISTINCT FROM v_user_id THEN RAISE EXCEPTION 'ORDER_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE='P0002'; END IF;
 IF v_separation_started_at IS NOT NULL THEN RAISE EXCEPTION 'ja_em_separacao' USING ERRCODE='P0001'; END IF;
 RAISE EXCEPTION 'ORDER_CANNOT_BE_CANCELLED' USING ERRCODE='22023';
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_my_order(text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cancel_my_order(text) TO authenticated;
COMMIT;
