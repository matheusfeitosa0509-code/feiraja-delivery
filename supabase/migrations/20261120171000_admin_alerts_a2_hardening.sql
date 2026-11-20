CREATE INDEX IF NOT EXISTS admin_alerts_order_id_idx
  ON public.admin_alerts (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS admin_alerts_product_request_id_idx
  ON public.admin_alerts (product_request_id) WHERE product_request_id IS NOT NULL;

REVOKE ALL ON FUNCTION public.admin_alerts_notify_push() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_alert_cancelled_order() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_alert_product_request() FROM PUBLIC, anon, authenticated;
