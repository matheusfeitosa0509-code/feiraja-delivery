DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.admin_alerts'::regclass AND relrowsecurity) THEN RAISE EXCEPTION 'admin_alerts RLS is disabled'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='admin_alerts' AND indexdef ILIKE '%UNIQUE%tipo%order_id%') THEN RAISE EXCEPTION 'unique(tipo, order_id) index missing'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_admin_alert_paid_order' AND NOT tgisinternal) THEN RAISE EXCEPTION 'paid-order trigger missing'; END IF;
END $$;
