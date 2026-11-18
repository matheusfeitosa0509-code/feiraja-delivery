BEGIN;

DROP TRIGGER IF EXISTS products_require_minimum_price_before_available ON public.products;
DROP FUNCTION IF EXISTS public.enforce_product_available_minimum_price();

UPDATE public.products
SET name = 'Brócolis (unidade)'
WHERE id = 'feiraja_brocolis_unidade';

DROP FUNCTION IF EXISTS public.admin_get_low_margin_percent();

CREATE OR REPLACE FUNCTION public.get_sales_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_min_value_cents integer;
  v_low_margin_percent numeric;
BEGIN
  SELECT s.min_value_cents, s.low_margin_percent
    INTO v_min_value_cents, v_low_margin_percent
  FROM feira_cost_private.sales_settings AS s
  WHERE s.setting_key = 'global';

  RETURN jsonb_build_object(
    'min_value_cents', COALESCE(v_min_value_cents, 500),
    'low_margin_percent', COALESCE(v_low_margin_percent, 20)
  );
END;
$function$;
ALTER FUNCTION public.get_sales_settings() OWNER TO postgres;

DO $$
DECLARE
  v_definition text;
  v_old text := 'LEFT JOIN public.customer_profiles AS cp
      ON cp.user_id = o.user_id' || E'\n    WHERE COALESCE(o.is_test_order, false) = false';
  v_new text := 'LEFT JOIN public.customer_profiles AS cp
      ON cp.user_id = o.user_id';
BEGIN
  SELECT pg_get_functiondef('public.admin_sales_dashboard(timestamptz,timestamptz)'::regprocedure)
    INTO v_definition;
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Filtro is_test_order esperado não encontrado em admin_sales_dashboard';
  END IF;
  EXECUTE replace(v_definition, v_old, v_new);
END;
$$;

DO $$
DECLARE
  v_definition text;
  v_old text := 'WHERE COALESCE(o.is_test_order,false)=false AND o.created_at>=p_start AND o.created_at<p_end';
  v_new text := 'WHERE o.created_at>=p_start AND o.created_at<p_end';
BEGIN
  SELECT pg_get_functiondef('public.admin_get_cost_report(timestamptz,timestamptz)'::regprocedure)
    INTO v_definition;
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Filtro is_test_order esperado não encontrado em admin_get_cost_report';
  END IF;
  EXECUTE replace(v_definition, v_old, v_new);
END;
$$;

DO $$
DECLARE
  v_definition text;
  v_old_count text := 'count(*) filter(where cost_status=''missing_cost'')::integer as missing_cost_items,' || E'\n    count(*) filter(where unit_cost is not null)::integer as calculated_items,\n    count(*)::integer as total_items,';
  v_new_count text := 'count(*) filter(where cost_status=''missing_cost'')::integer as missing_cost_items,';
  v_old_json text := '''missing_cost_items'',totals.missing_cost_items,''calculated_items'',totals.calculated_items,''total_items'',totals.total_items,';
  v_new_json text := '''missing_cost_items'',totals.missing_cost_items,';
BEGIN
  SELECT pg_get_functiondef('public.admin_get_cost_report_with_delivery(timestamptz,timestamptz)'::regprocedure)
    INTO v_definition;
  IF position(v_old_count IN v_definition) = 0 OR position(v_old_json IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Métricas de cobertura esperadas não encontradas no relatório financeiro';
  END IF;
  v_definition := replace(v_definition, v_old_count, v_new_count);
  v_definition := replace(v_definition, v_old_json, v_new_json);
  EXECUTE v_definition;
END;
$$;

COMMIT;
