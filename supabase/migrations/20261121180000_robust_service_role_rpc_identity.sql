-- Robust service-role identity for RPCs invoked with modern sb_secret keys.
-- Keep the resale price RPC executable only by service_role.
BEGIN;

DO $migration$
DECLARE
  v_fn record;
  v_definition text;
  v_old_spaced text := 'current_setting(''request.jwt.claim.role'', true)';
  v_old_compact text := 'current_setting(''request.jwt.claim.role'',true)';
  v_new text := 'COALESCE(NULLIF(current_setting(''request.jwt.claims'', true), '''')::jsonb ->> ''role'', NULLIF(current_setting(''request.jwt.claim.role'', true), ''''), NULLIF(current_setting(''role'', true), ''''))';
BEGIN
  FOR v_fn IN
    SELECT p.oid, n.nspname, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosrc ILIKE '%current_setting%request.jwt.claim.role%'
      AND p.proname IN (
        'service_get_product_resale_prices',
        'service_apply_lalamove_webhook',
        'admin_set_product_prices'
      )
  LOOP
    v_definition := pg_get_functiondef(v_fn.oid);
    v_definition := replace(v_definition, v_old_spaced, v_new);
    v_definition := replace(v_definition, v_old_compact, v_new);
    IF v_definition = pg_get_functiondef(v_fn.oid) THEN
      RAISE EXCEPTION 'Role check replacement did not match for %.%', v_fn.nspname, v_fn.proname;
    END IF;
    EXECUTE v_definition;
  END LOOP;
END;
$migration$;

REVOKE ALL ON FUNCTION public.service_get_product_resale_prices(text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_get_product_resale_prices(text[])
  TO service_role;

DO $verify$
DECLARE
  v_oid oid := 'public.service_get_product_resale_prices(text[])'::regprocedure;
BEGIN
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_proc p,
            LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
       WHERE p.oid = v_oid
         AND a.grantee = 0
         AND a.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Security regression: anon/authenticated/PUBLIC can execute resale RPC';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role lost EXECUTE on resale RPC';
  END IF;
END;
$verify$;

COMMIT;
