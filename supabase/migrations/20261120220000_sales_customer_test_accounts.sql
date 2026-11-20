BEGIN;
CREATE TABLE IF NOT EXISTS feira_cost_private.customer_test_accounts (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 marked_at timestamptz NOT NULL DEFAULT now(),
 marked_by uuid REFERENCES auth.users(id)
);
ALTER TABLE feira_cost_private.customer_test_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE feira_cost_private.customer_test_accounts FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE feira_cost_private.customer_test_accounts TO service_role;
INSERT INTO feira_cost_private.customer_test_accounts(user_id)
SELECT id FROM auth.users WHERE lower(email) IN ('intellectcopytrading@gmail.com','matheusfeitosa0509@gmail.com')
ON CONFLICT(user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_set_customer_test_account(p_user_id uuid,p_is_test boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_current_user_admin() THEN RAISE EXCEPTION 'Acesso permitido somente a administradores.' USING ERRCODE='42501'; END IF;
 IF p_user_id IS NULL THEN RAISE EXCEPTION 'Cliente inválido.' USING ERRCODE='22023'; END IF;
 IF p_is_test THEN
  INSERT INTO feira_cost_private.customer_test_accounts(user_id,marked_at,marked_by) VALUES(p_user_id,now(),auth.uid())
  ON CONFLICT(user_id) DO UPDATE SET marked_at=now(),marked_by=auth.uid();
 ELSE DELETE FROM feira_cost_private.customer_test_accounts WHERE user_id=p_user_id;
 END IF;
 RETURN true;
END;
$function$;
ALTER FUNCTION public.admin_set_customer_test_account(uuid,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_set_customer_test_account(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_customer_test_account(uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_sales_customers()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_current_user_admin() THEN RAISE EXCEPTION 'Acesso permitido somente a administradores.' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.last_order_at DESC NULLS LAST),'[]'::jsonb) INTO v_result
 FROM (
  SELECT DISTINCT ON (COALESCE(o.user_id::text,NULLIF(lower(btrim(o.customer_email)),''),NULLIF(regexp_replace(COALESCE(o.customer_phone,''),'[^0-9]','','g'),''),o.id))
   o.user_id,
   COALESCE(NULLIF(btrim(cp.full_name),''),NULLIF(btrim(o.customer_name),''),'Cliente sem nome') AS customer_name,
   COALESCE(NULLIF(lower(btrim(u.email)),''),NULLIF(lower(btrim(o.customer_email)),'')) AS customer_email,
   COALESCE(NULLIF(btrim(cp.phone),''),NULLIF(btrim(o.customer_phone),'')) AS customer_phone,
   o.created_at AS last_order_at,(t.user_id IS NOT NULL) AS is_test_account
  FROM public.orders o
  LEFT JOIN public.customer_profiles cp ON cp.user_id=o.user_id
  LEFT JOIN auth.users u ON u.id=o.user_id
  LEFT JOIN feira_cost_private.customer_test_accounts t ON t.user_id=o.user_id
  WHERE NOT EXISTS(SELECT 1 FROM public.admin_users au WHERE au.user_id=o.user_id)
  ORDER BY COALESCE(o.user_id::text,NULLIF(lower(btrim(o.customer_email)),''),NULLIF(regexp_replace(COALESCE(o.customer_phone,''),'[^0-9]','','g'),''),o.id),o.created_at DESC NULLS LAST
 ) c;
 RETURN v_result;
END;
$function$;
ALTER FUNCTION public.admin_list_sales_customers() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_list_sales_customers() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_sales_customers() TO authenticated;

DO $$
DECLARE v_definition text;
v_old text := 'WHERE COALESCE(o.is_test_order, false) = false';
v_new text := v_old || E'
      AND NOT EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = o.user_id)
      AND NOT EXISTS (SELECT 1 FROM feira_cost_private.customer_test_accounts ta WHERE ta.user_id = o.user_id)';
BEGIN
 SELECT pg_get_functiondef('public.admin_sales_dashboard(timestamptz,timestamptz)'::regprocedure) INTO v_definition;
 IF position('customer_test_accounts' IN v_definition)>0 THEN RAISE EXCEPTION 'Filtro de contas de teste já existe.'; END IF;
 IF position(v_old IN v_definition)=0 THEN RAISE EXCEPTION 'Filtro is_test_order esperado não encontrado.'; END IF;
 v_definition:=replace(v_definition,v_old,v_new);
 v_definition:=replace(v_definition,
  '''active_customers'', (SELECT count(*)::integer FROM customer_rollup WHERE last_order_at >= now() - interval ''30 days'')',
  '''active_customers'', (SELECT count(*)::integer FROM customer_rollup WHERE last_order_at >= p_start AND last_order_at < p_end)');
 v_definition:=replace(v_definition,
  '''inactive_customers'', (SELECT count(*)::integer FROM customer_rollup WHERE last_order_at < now() - interval ''30 days'')',
  '''inactive_customers'', (SELECT count(*)::integer FROM customer_rollup WHERE last_order_at < p_start)');
 v_definition:=replace(v_definition,
  '''new_customers_month'', (SELECT count(*)::integer FROM customer_rollup WHERE first_order_at >= v_month_start AND first_order_at < v_next_month_start)',
  '''new_customers_month'', (SELECT count(*)::integer FROM customer_rollup WHERE first_order_at >= p_start AND first_order_at < p_end)');
 v_definition:=replace(v_definition,
  'FROM base_orders'||E'\n    WHERE is_paid'||E'\n    GROUP BY customer_key',
  'FROM base_orders'||E'\n    WHERE is_paid AND created_at >= p_start AND created_at < p_end'||E'\n    GROUP BY customer_key');
 v_definition:=replace(v_definition,'WHERE last_order_at < now() - interval ''30 days''','WHERE last_order_at < p_start');
 v_definition:=replace(v_definition,
  'SELECT'||E'\n          customer_name,'||E'\n          customer_email,',
  'SELECT'||E'\n          customer_key,'||E'\n          customer_name,'||E'\n          customer_email,');
 v_definition:=replace(v_definition,
  '''orders_by_weekday'', COALESCE((',
  '''paid_order_ids'', COALESCE((SELECT jsonb_agg(id) FROM filtered_paid), ''[]''::jsonb),
  ''paid_order_customers'', COALESCE((SELECT jsonb_agg(jsonb_build_object(''order_id'',id,''customer_key'',customer_key)) FROM filtered_paid), ''[]''::jsonb),
  ''orders_by_weekday'', COALESCE((');
 IF position('paid_order_customers' IN v_definition)=0 THEN RAISE EXCEPTION 'Mapa de pedidos pagos não adicionado.'; END IF;
 EXECUTE v_definition;
END;
$$;
COMMIT;
