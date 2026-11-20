-- A1: admin paid-order alerts. Isolated from customer notifications and payment processing.
CREATE TABLE IF NOT EXISTS public.admin_alerts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tipo text NOT NULL, order_id text NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE, mensagem text NOT NULL, lido boolean NOT NULL DEFAULT false, criado_em timestamptz NOT NULL DEFAULT now(), CONSTRAINT admin_alerts_tipo_order_id_key UNIQUE (tipo, order_id));
ALTER TABLE public.admin_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_alerts FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON TABLE public.admin_alerts TO authenticated;
DROP POLICY IF EXISTS admin_alerts_select_admin ON public.admin_alerts;
CREATE POLICY admin_alerts_select_admin ON public.admin_alerts FOR SELECT TO authenticated USING (public.is_current_user_admin());
DROP POLICY IF EXISTS admin_alerts_update_admin ON public.admin_alerts;
CREATE POLICY admin_alerts_update_admin ON public.admin_alerts FOR UPDATE TO authenticated USING (public.is_current_user_admin()) WITH CHECK (public.is_current_user_admin());
CREATE OR REPLACE FUNCTION public.admin_alert_paid_order() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_mode text; v_total text;
BEGIN
 IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'Pagamento Confirmado' AND NEW.is_test_order IS FALSE THEN
  v_mode := CASE WHEN NEW.delivery_type = 'delivery' THEN 'Entrega' ELSE 'Retirada' END;
  v_total := replace(pg_catalog.to_char(NEW.total, 'FM999999990.00'), '.', ',');
  INSERT INTO public.admin_alerts (tipo,order_id,mensagem) VALUES ('pedido_pago',NEW.id,'🛒 Novo pedido pago – R$ '||v_total||' ('||v_mode||')') ON CONFLICT (tipo,order_id) DO NOTHING;
 END IF;
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_alert_paid_order() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_admin_alert_paid_order ON public.orders;
CREATE TRIGGER trg_admin_alert_paid_order AFTER UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION public.admin_alert_paid_order();
COMMENT ON TABLE public.admin_alerts IS 'Alertas administrativos internos; um evento por tipo e pedido.';
