BEGIN;
CREATE TABLE IF NOT EXISTS public.store_funnel_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event text NOT NULL CHECK (event IN ('visit','add_to_cart','checkout_open','login_screen','order_created','order_paid')),
  created_at timestamptz NOT NULL DEFAULT now(),
  utm_source text NOT NULL DEFAULT 'direto' CHECK (char_length(utm_source) <= 100),
  utm_medium text CHECK (utm_medium IS NULL OR char_length(utm_medium) <= 100),
  utm_campaign text CHECK (utm_campaign IS NULL OR char_length(utm_campaign) <= 100),
  device text NOT NULL CHECK (device IN ('celular','computador'))
);
CREATE INDEX IF NOT EXISTS store_funnel_events_created_at_idx ON public.store_funnel_events (created_at DESC);
CREATE INDEX IF NOT EXISTS store_funnel_events_origin_created_at_idx ON public.store_funnel_events (utm_source, utm_medium, utm_campaign, created_at DESC);
ALTER TABLE public.store_funnel_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.store_funnel_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_store_funnel_event(
  p_event text, p_utm_source text DEFAULT 'direto', p_utm_medium text DEFAULT NULL,
  p_utm_campaign text DEFAULT NULL, p_device text DEFAULT 'celular'
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_headers jsonb;
  v_user_agent text;
  v_count integer;
  v_minute bigint;
  v_source text;
BEGIN
  IF p_event IS NULL OR p_event NOT IN ('visit','add_to_cart','checkout_open','login_screen','order_created','order_paid') THEN
    RAISE EXCEPTION 'Evento inválido.' USING ERRCODE = '22023';
  END IF;
  IF p_device IS NULL OR p_device NOT IN ('celular','computador') THEN
    RAISE EXCEPTION 'Tipo de aparelho inválido.' USING ERRCODE = '22023';
  END IF;
  v_headers := COALESCE(NULLIF(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_user_agent := lower(COALESCE(v_headers ->> 'user-agent', ''));
  IF v_user_agent LIKE '%playwright%' OR v_user_agent LIKE '%headlesschrome%'
     OR v_user_agent LIKE '%github-actions%' OR v_user_agent LIKE '%ci-runner%' THEN
    RETURN false;
  END IF;
  IF v_uid IS NOT NULL THEN
    IF public.is_current_user_admin() OR EXISTS (
      SELECT 1 FROM feira_cost_private.customer_test_accounts AS t WHERE t.user_id = v_uid
    ) THEN RETURN false; END IF;
  END IF;
  v_minute := floor(extract(epoch FROM clock_timestamp()) / 60)::bigint;
  PERFORM pg_advisory_xact_lock(7712345, (v_minute % 2147483647)::integer);
  SELECT count(*)::integer INTO v_count FROM public.store_funnel_events
  WHERE created_at >= date_trunc('minute', clock_timestamp());
  IF v_count >= 240 THEN RETURN false; END IF;
  v_source := COALESCE(NULLIF(left(btrim(COALESCE(p_utm_source, '')), 100), ''), 'direto');
  INSERT INTO public.store_funnel_events(event, utm_source, utm_medium, utm_campaign, device)
  VALUES (p_event, v_source,
    NULLIF(left(btrim(COALESCE(p_utm_medium, '')), 100), ''),
    NULLIF(left(btrim(COALESCE(p_utm_campaign, '')), 100), ''), p_device);
  RETURN true;
END;
$function$;
ALTER FUNCTION public.record_store_funnel_event(text,text,text,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_store_funnel_event(text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_store_funnel_event(text,text,text,text,text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_store_funnel(p_start timestamptz, p_end timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Acesso permitido somente a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RAISE EXCEPTION 'Período inválido.' USING ERRCODE = '22023';
  END IF;
  SELECT jsonb_build_object(
    'counts', COALESCE((
      SELECT jsonb_object_agg(e.event, e.total) FROM (
        SELECT event, count(*)::integer AS total FROM public.store_funnel_events
        WHERE created_at >= p_start AND created_at < p_end GROUP BY event
      ) AS e
    ), '{}'::jsonb),
    'origins', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'utm_source', g.utm_source, 'utm_medium', g.utm_medium, 'utm_campaign', g.utm_campaign,
        'visits', g.visits, 'add_to_cart', g.add_to_cart, 'checkout_open', g.checkout_open,
        'login_screen', g.login_screen, 'order_created', g.order_created, 'order_paid', g.order_paid
      ) ORDER BY g.visits DESC, g.utm_source)
      FROM (
        SELECT utm_source, utm_medium, utm_campaign,
          count(*) FILTER (WHERE event='visit')::integer AS visits,
          count(*) FILTER (WHERE event='add_to_cart')::integer AS add_to_cart,
          count(*) FILTER (WHERE event='checkout_open')::integer AS checkout_open,
          count(*) FILTER (WHERE event='login_screen')::integer AS login_screen,
          count(*) FILTER (WHERE event='order_created')::integer AS order_created,
          count(*) FILTER (WHERE event='order_paid')::integer AS order_paid
        FROM public.store_funnel_events
        WHERE created_at >= p_start AND created_at < p_end
        GROUP BY utm_source, utm_medium, utm_campaign
      ) AS g
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
ALTER FUNCTION public.admin_get_store_funnel(timestamptz,timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_get_store_funnel(timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_store_funnel(timestamptz,timestamptz) TO authenticated;
COMMIT;