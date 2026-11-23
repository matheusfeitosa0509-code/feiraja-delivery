BEGIN;

ALTER TABLE public.store_funnel_events
  ADD COLUMN IF NOT EXISTS duration_ms integer;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.store_funnel_events'::regclass
      AND conname = 'store_funnel_events_duration_ms_check'
  ) THEN
    ALTER TABLE public.store_funnel_events
      ADD CONSTRAINT store_funnel_events_duration_ms_check
      CHECK (duration_ms IS NULL OR (event = 'pix_generated' AND duration_ms BETWEEN 0 AND 3600000));
  END IF;
END;
$constraint$;

CREATE OR REPLACE FUNCTION public.record_store_funnel_event(
  p_event text,
  p_utm_source text,
  p_utm_medium text,
  p_utm_campaign text,
  p_device text,
  p_duration_ms integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_headers jsonb;
  v_user_agent text;
  v_count integer;
  v_minute bigint;
  v_source text;
BEGIN
  IF p_event IS NULL OR p_event NOT IN (
    'visit','product_view','add_to_cart','checkout_open',
    'login_screen','order_created','pix_generated','order_paid'
  ) THEN
    RAISE EXCEPTION 'Evento inválido.' USING ERRCODE = '22023';
  END IF;
  IF p_device IS NULL OR p_device NOT IN ('celular','computador') THEN
    RAISE EXCEPTION 'Tipo de aparelho inválido.' USING ERRCODE = '22023';
  END IF;
  IF p_duration_ms IS NOT NULL AND (
    p_event <> 'pix_generated' OR p_duration_ms < 0 OR p_duration_ms > 3600000
  ) THEN
    RAISE EXCEPTION 'Duração do Pix inválida.' USING ERRCODE = '22023';
  END IF;

  v_headers := COALESCE(NULLIF(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_user_agent := lower(COALESCE(v_headers ->> 'user-agent', ''));
  IF v_user_agent LIKE '%playwright%'
     OR v_user_agent LIKE '%headlesschrome%'
     OR v_user_agent LIKE '%github-actions%'
     OR v_user_agent LIKE '%ci-runner%' THEN
    RETURN false;
  END IF;

  IF v_uid IS NOT NULL THEN
    IF public.is_current_user_admin()
       OR EXISTS (
         SELECT 1 FROM feira_cost_private.customer_test_accounts AS t
         WHERE t.user_id = v_uid
       ) THEN
      RETURN false;
    END IF;
  END IF;

  v_minute := floor(extract(epoch FROM clock_timestamp()) / 60)::bigint;
  PERFORM pg_advisory_xact_lock(7712345, (v_minute % 2147483647)::integer);
  SELECT count(*)::integer INTO v_count
  FROM public.store_funnel_events
  WHERE created_at >= date_trunc('minute', clock_timestamp());
  IF v_count >= 240 THEN RETURN false; END IF;

  v_source := COALESCE(NULLIF(left(btrim(COALESCE(p_utm_source, '')), 100), ''), 'direto');
  INSERT INTO public.store_funnel_events(
    event, utm_source, utm_medium, utm_campaign, device, duration_ms
  )
  VALUES (
    p_event,
    v_source,
    NULLIF(left(btrim(COALESCE(p_utm_medium, '')), 100), ''),
    NULLIF(left(btrim(COALESCE(p_utm_campaign, '')), 100), ''),
    p_device,
    p_duration_ms
  );
  RETURN true;
END;
$function$;

ALTER FUNCTION public.record_store_funnel_event(text,text,text,text,text,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_store_funnel_event(text,text,text,text,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_store_funnel_event(text,text,text,text,text,integer) TO anon, authenticated;

COMMIT;
