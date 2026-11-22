-- Cartão fidelidade de entrega: reservas atômicas no banco; desligado por padrão.
BEGIN;
CREATE TABLE IF NOT EXISTS promo_private.delivery_loyalty_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 enabled boolean NOT NULL DEFAULT false,
 stamps_required integer NOT NULL DEFAULT 6 CHECK (stamps_required BETWEEN 1 AND 30),
 discount_cap numeric(12,2) NULL CHECK (discount_cap IS NULL OR discount_cap >= 0),
 updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE promo_private.delivery_loyalty_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE promo_private.delivery_loyalty_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE promo_private.delivery_loyalty_settings TO service_role;
INSERT INTO promo_private.delivery_loyalty_settings(singleton,enabled,stamps_required,discount_cap)
VALUES (true,false,6,NULL) ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS promo_private.delivery_loyalty_balances (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 stamps integer NOT NULL DEFAULT 0 CHECK (stamps >= 0 AND stamps <= 30),
 updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE promo_private.delivery_loyalty_balances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE promo_private.delivery_loyalty_balances FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE promo_private.delivery_loyalty_balances TO service_role;

CREATE TABLE IF NOT EXISTS promo_private.delivery_loyalty_stamp_orders (
 order_id text PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 stamps_after integer NOT NULL CHECK (stamps_after >= 1),
 stamps_required integer NOT NULL CHECK (stamps_required BETWEEN 1 AND 30),
 awarded_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE promo_private.delivery_loyalty_stamp_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE promo_private.delivery_loyalty_stamp_orders FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE promo_private.delivery_loyalty_stamp_orders TO service_role;
CREATE INDEX IF NOT EXISTS delivery_loyalty_stamp_orders_user_idx ON promo_private.delivery_loyalty_stamp_orders(user_id,awarded_at DESC);

CREATE TABLE IF NOT EXISTS promo_private.delivery_loyalty_redemptions (
 order_id text PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 discount numeric(12,2) NOT NULL CHECK (discount >= 0),
 stamps_reserved integer NOT NULL DEFAULT 6 CHECK (stamps_reserved BETWEEN 1 AND 30),
 status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','used','released')),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
 updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE promo_private.delivery_loyalty_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE promo_private.delivery_loyalty_redemptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE promo_private.delivery_loyalty_redemptions TO service_role;
CREATE INDEX IF NOT EXISTS delivery_loyalty_redemptions_user_status_idx ON promo_private.delivery_loyalty_redemptions(user_id,status);

-- Executes after the first-delivery reservation trigger; never stacks discounts.
CREATE OR REPLACE FUNCTION promo_private.reserve_delivery_loyalty_reward()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_settings promo_private.delivery_loyalty_settings%ROWTYPE; v_discount numeric(12,2); v_stamps_reserved integer;
BEGIN
 IF NEW.delivery_type IS DISTINCT FROM 'delivery' OR NEW.user_id IS NULL
    OR COALESCE(NEW.is_test_order,false) OR NEW.promo_code IS NOT NULL
    OR COALESCE(NEW.delivery_fee,0) <= 0 THEN RETURN NEW; END IF;
 SELECT * INTO v_settings FROM promo_private.delivery_loyalty_settings
 WHERE singleton=true AND enabled=true FOR SHARE;
 IF NOT FOUND OR v_settings.discount_cap=0 THEN RETURN NEW; END IF;
 UPDATE promo_private.delivery_loyalty_balances
 SET stamps=0,updated_at=pg_catalog.now()
 WHERE user_id=NEW.user_id AND stamps>=v_settings.stamps_required
 RETURNING stamps+v_settings.stamps_required INTO v_stamps_reserved;
 IF NOT FOUND THEN RETURN NEW; END IF;
 v_discount:=LEAST(COALESCE(NEW.delivery_fee,0),COALESCE(v_settings.discount_cap,COALESCE(NEW.delivery_fee,0)));
 INSERT INTO promo_private.delivery_loyalty_redemptions(order_id,user_id,discount,stamps_reserved,status)
 VALUES(NEW.id,NEW.user_id,v_discount,v_stamps_reserved,'reserved');
 NEW.delivery_discount:=COALESCE(NEW.delivery_discount,0)+v_discount;
 NEW.promo_code:='FIDELIDADE';
 NEW.total:=GREATEST(0,COALESCE(NEW.subtotal,0)+COALESCE(NEW.delivery_fee,0)-COALESCE(NEW.delivery_discount,0));
 RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION promo_private.reserve_delivery_loyalty_reward() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_z_reserve_delivery_loyalty_reward ON public.orders;
CREATE TRIGGER trg_z_reserve_delivery_loyalty_reward BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION promo_private.reserve_delivery_loyalty_reward();

-- One stamp per paid-and-completed order; the unique order key makes retries idempotent.
CREATE OR REPLACE FUNCTION promo_private.award_delivery_loyalty_stamp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_settings promo_private.delivery_loyalty_settings%ROWTYPE; v_stamps integer; v_inserted integer;
BEGIN
 IF NEW.status IS NOT DISTINCT FROM OLD.status
    OR NEW.status NOT IN ('Entregue','Pedido Concluído','Concluído','Concluido')
    OR NEW.user_id IS NULL OR COALESCE(NEW.is_test_order,false)
    OR COALESCE(NEW.subtotal,0)<30
    OR COALESCE(NEW.payment_method,'')='Pix de teste (admin)' THEN RETURN NEW; END IF;
 SELECT * INTO v_settings FROM promo_private.delivery_loyalty_settings
 WHERE singleton=true AND enabled=true FOR SHARE;
 IF NOT FOUND THEN RETURN NEW; END IF;
 INSERT INTO promo_private.delivery_loyalty_stamp_orders(order_id,user_id,stamps_after,stamps_required)
 VALUES(NEW.id,NEW.user_id,1,v_settings.stamps_required) ON CONFLICT(order_id) DO NOTHING;
 GET DIAGNOSTICS v_inserted=ROW_COUNT;
 IF v_inserted<>1 THEN RETURN NEW; END IF;
 INSERT INTO promo_private.delivery_loyalty_balances(user_id,stamps) VALUES(NEW.user_id,1)
 ON CONFLICT(user_id) DO UPDATE SET
 stamps=LEAST(v_settings.stamps_required,promo_private.delivery_loyalty_balances.stamps+1),
 updated_at=pg_catalog.now()
 RETURNING stamps INTO v_stamps;
 UPDATE promo_private.delivery_loyalty_stamp_orders SET stamps_after=v_stamps WHERE order_id=NEW.id;
 RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION promo_private.award_delivery_loyalty_stamp() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_aaa_award_delivery_loyalty_stamp ON public.orders;
CREATE TRIGGER trg_aaa_award_delivery_loyalty_stamp AFTER UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION promo_private.award_delivery_loyalty_stamp();

-- A canceled, unpaid checkout releases its reserved prize and restores the stamps.
CREATE OR REPLACE FUNCTION promo_private.sync_delivery_loyalty_redemption()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_redemption promo_private.delivery_loyalty_redemptions%ROWTYPE;
BEGIN
 IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
 IF NEW.status IN ('Pagamento Confirmado','Preparando','Pronto para Retirada','Saiu para Entrega','Entregue','Pedido Concluído','Concluído','Concluido') THEN
  UPDATE promo_private.delivery_loyalty_redemptions SET status='used',updated_at=pg_catalog.now()
  WHERE order_id=NEW.id AND status='reserved';
 ELSIF NEW.status IN ('Cancelada','Cancelado','Pagamento cancelado') THEN
  SELECT * INTO v_redemption FROM promo_private.delivery_loyalty_redemptions
  WHERE order_id=NEW.id AND status='reserved' FOR UPDATE;
  IF FOUND THEN
    
   UPDATE promo_private.delivery_loyalty_redemptions SET status='released',updated_at=pg_catalog.now()
   WHERE order_id=NEW.id AND status='reserved';
   INSERT INTO promo_private.delivery_loyalty_balances(user_id,stamps)
   VALUES(v_redemption.user_id,v_redemption.stamps_reserved)
   ON CONFLICT(user_id) DO UPDATE SET
    stamps=LEAST(30,promo_private.delivery_loyalty_balances.stamps+v_redemption.stamps_reserved),
    updated_at=pg_catalog.now();
  END IF;
 END IF;
 RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION promo_private.sync_delivery_loyalty_redemption() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_sync_delivery_loyalty_redemption ON public.orders;
CREATE TRIGGER trg_sync_delivery_loyalty_redemption AFTER UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION promo_private.sync_delivery_loyalty_redemption();

CREATE OR REPLACE FUNCTION public.admin_get_delivery_loyalty_settings()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.admin_users a WHERE a.user_id=auth.uid())
 THEN RAISE EXCEPTION 'admin access required' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('enabled',enabled,'stamps_required',stamps_required,'discount_cap',discount_cap)
 INTO v_result FROM promo_private.delivery_loyalty_settings WHERE singleton=true;
 RETURN COALESCE(v_result,'{}'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_save_delivery_loyalty_settings(
 p_enabled boolean,p_stamps_required integer,p_discount_cap numeric DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.admin_users a WHERE a.user_id=auth.uid())
 THEN RAISE EXCEPTION 'admin access required' USING ERRCODE='42501'; END IF;
 IF p_stamps_required IS NULL OR p_stamps_required<1 OR p_stamps_required>30
    OR (p_discount_cap IS NOT NULL AND (p_discount_cap<0 OR p_discount_cap>100000))
 THEN RAISE EXCEPTION 'invalid loyalty settings' USING ERRCODE='22023'; END IF;
 UPDATE promo_private.delivery_loyalty_settings SET enabled=COALESCE(p_enabled,false),
 stamps_required=p_stamps_required,discount_cap=p_discount_cap,updated_at=pg_catalog.now()
 WHERE singleton=true;
 SELECT jsonb_build_object('enabled',enabled,'stamps_required',stamps_required,'discount_cap',discount_cap)
 INTO v_result FROM promo_private.delivery_loyalty_settings WHERE singleton=true;
 RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_customer_delivery_loyalty_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_settings promo_private.delivery_loyalty_settings%ROWTYPE; v_stamps integer;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_settings FROM promo_private.delivery_loyalty_settings WHERE singleton=true;
 SELECT COALESCE((SELECT stamps FROM promo_private.delivery_loyalty_balances WHERE user_id=auth.uid()),0)
 INTO v_stamps;
 RETURN jsonb_build_object('enabled',COALESCE(v_settings.enabled,false),'stamps',v_stamps,
 'stamps_required',COALESCE(v_settings.stamps_required,6),
 'reward_available',COALESCE(v_settings.enabled,false) AND v_stamps>=COALESCE(v_settings.stamps_required,6),
 'discount_cap',v_settings.discount_cap);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_customer_delivery_loyalty()
RETURNS TABLE(user_id uuid,stamps integer,stamps_required integer,reward_available boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.admin_users a WHERE a.user_id=auth.uid())
 THEN RAISE EXCEPTION 'admin access required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT b.user_id,b.stamps,s.stamps_required,(s.enabled AND b.stamps>=s.stamps_required)
 FROM promo_private.delivery_loyalty_balances b CROSS JOIN promo_private.delivery_loyalty_settings s
 WHERE s.singleton=true ORDER BY b.updated_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_delivery_loyalty_stamp_push_message(p_order_id text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
 SELECT pg_catalog.format('Você ganhou mais 1 selo! (%s/%s)',e.stamps_after,e.stamps_required)
 FROM promo_private.delivery_loyalty_stamp_orders e
 JOIN promo_private.delivery_loyalty_settings s ON s.singleton=true AND s.enabled=true
 WHERE e.order_id=p_order_id LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_delivery_loyalty_settings() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_save_delivery_loyalty_settings(boolean,integer,numeric) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_customer_delivery_loyalty_status() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_list_customer_delivery_loyalty() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_delivery_loyalty_stamp_push_message(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_delivery_loyalty_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_delivery_loyalty_settings(boolean,integer,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_delivery_loyalty_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_customer_delivery_loyalty() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_delivery_loyalty_stamp_push_message(text) TO service_role;
-- Pick-up completion uses the same signed push pipeline. The award trigger above
-- runs first; send only when this order actually earned a stamp.
CREATE OR REPLACE FUNCTION promo_private.push_delivery_loyalty_completion_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_secret text;
BEGIN
 IF NEW.status IS NOT DISTINCT FROM OLD.status
    OR NEW.status NOT IN ('Pedido Concluído','Concluído','Concluido')
    OR NEW.user_id IS NULL OR COALESCE(NEW.is_test_order,false)
    OR NOT EXISTS(SELECT 1 FROM promo_private.delivery_loyalty_stamp_orders e WHERE e.order_id=NEW.id)
 THEN RETURN NEW; END IF;
 SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets
 WHERE name='push_hmac_secret' LIMIT 1;
 IF v_secret IS NOT NULL AND pg_catalog.btrim(v_secret)<>'' THEN
  PERFORM public.push_orders_notify_send(NEW.id,'customer',NEW.status,v_secret);
 END IF;
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN
 RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION promo_private.push_delivery_loyalty_completion_notice() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_zzz_push_delivery_loyalty_completion_notice ON public.orders;
CREATE TRIGGER trg_zzz_push_delivery_loyalty_completion_notice AFTER UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION promo_private.push_delivery_loyalty_completion_notice();

COMMENT ON TABLE promo_private.delivery_loyalty_settings IS 'Cartão fidelidade de entrega; desligado por padrão.';
COMMENT ON TABLE promo_private.delivery_loyalty_balances IS 'Saldo privado de selos de entrega por cliente.';
COMMENT ON TABLE promo_private.delivery_loyalty_redemptions IS 'Reservas atômicas de prêmios FIDELIDADE; taxa original preservada para despacho.';
COMMIT;
