-- Test-only transactional bypass; production remains filtered by is_test_order.
CREATE OR REPLACE FUNCTION public.admin_alert_cancelled_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status IN ('Cancelada', 'Cancelado', 'Pagamento cancelado')
     AND (NEW.is_test_order IS FALSE OR pg_catalog.current_setting('app.admin_alerts_test_mode', true) = 'on') THEN
    INSERT INTO public.admin_alerts (tipo, order_id, mensagem)
    VALUES ('pedido_cancelado', NEW.id, '❌ Pedido ' || NEW.id || ' cancelado')
    ON CONFLICT (tipo, order_id) DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;
