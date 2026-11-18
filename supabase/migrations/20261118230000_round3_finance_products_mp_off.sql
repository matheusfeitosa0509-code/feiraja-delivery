BEGIN;

-- Todos os indicadores do relatório de clientes/vendas ignoram pedidos de teste.
DO $$
DECLARE
  v_definition text;
  v_old text := 'LEFT JOIN public.customer_profiles AS cp
      ON cp.user_id = o.user_id';
  v_new text := v_old || E'\n    WHERE COALESCE(o.is_test_order, false) = false';
BEGIN
  SELECT pg_get_functiondef('public.admin_sales_dashboard(timestamptz,timestamptz)'::regprocedure)
    INTO v_definition;
  IF position('COALESCE(o.is_test_order' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'admin_sales_dashboard já contém filtro is_test_order; revise antes de aplicar';
  END IF;
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Trecho esperado de admin_sales_dashboard não encontrado';
  END IF;
  EXECUTE replace(v_definition, v_old, v_new);
END;
$$;

-- A RPC antiga também deixa de incluir pedidos de teste, mesmo sem ser mais usada pelo painel.
DO $$
DECLARE
  v_definition text;
  v_old text := 'WHERE o.created_at>=p_start AND o.created_at<p_end';
  v_new text := 'WHERE COALESCE(o.is_test_order,false)=false AND o.created_at>=p_start AND o.created_at<p_end';
BEGIN
  SELECT pg_get_functiondef('public.admin_get_cost_report(timestamptz,timestamptz)'::regprocedure)
    INTO v_definition;
  IF position('COALESCE(o.is_test_order' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'admin_get_cost_report já contém filtro is_test_order; revise antes de aplicar';
  END IF;
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Trecho esperado de admin_get_cost_report não encontrado';
  END IF;
  v_definition := replace(v_definition, v_old, v_new);
  v_definition := replace(v_definition, 'unit_cost IS NOT NULL', 'unit_cost > 0');
  EXECUTE v_definition;
END;
$$;

-- Expõe a cobertura real dos snapshots sem transformar custos ausentes em zero.
DO $$
DECLARE
  v_definition text;
  v_old_count text := 'count(*) filter(where cost_status=''missing_cost'')::integer as missing_cost_items,';
  v_new_count text := v_old_count || E'\n    count(*) filter(where unit_cost > 0)::integer as calculated_items,\n    count(*)::integer as total_items,';
  v_old_json text := '''missing_cost_items'',totals.missing_cost_items,';
  v_new_json text := v_old_json || '''calculated_items'',totals.calculated_items,''total_items'',totals.total_items,';
BEGIN
  SELECT pg_get_functiondef('public.admin_get_cost_report_with_delivery(timestamptz,timestamptz)'::regprocedure)
    INTO v_definition;
  IF position('calculated_items' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'admin_get_cost_report_with_delivery já contém métricas de cobertura; revise antes de aplicar';
  END IF;
  IF position(v_old_count IN v_definition) = 0 OR position(v_old_json IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Trechos esperados do relatório financeiro não encontrados';
  END IF;
  v_definition := replace(v_definition, v_old_count, v_new_count);
  v_definition := replace(v_definition, 'unit_cost is not null', 'unit_cost > 0');
  v_definition := replace(v_definition, v_old_json, v_new_json);
  EXECUTE v_definition;
END;
$$;

-- A RPC pública continua entregando o mínimo de compra, mas não revela mais o limite de margem.
CREATE OR REPLACE FUNCTION public.get_sales_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_min_value_cents integer;
BEGIN
  SELECT s.min_value_cents
    INTO v_min_value_cents
  FROM feira_cost_private.sales_settings AS s
  WHERE s.setting_key = 'global';

  RETURN jsonb_build_object(
    'min_value_cents', COALESCE(v_min_value_cents, 500)
  );
END;
$function$;
ALTER FUNCTION public.get_sales_settings() OWNER TO postgres;

-- Leitura do limite de margem somente por administrador autenticado.
CREATE OR REPLACE FUNCTION public.admin_get_low_margin_percent()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_low_margin_percent numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Acesso permitido somente a administradores.'
      USING ERRCODE = '42501';
  END IF;

  SELECT s.low_margin_percent
    INTO v_low_margin_percent
  FROM feira_cost_private.sales_settings AS s
  WHERE s.setting_key = 'global';

  RETURN jsonb_build_object(
    'low_margin_percent', COALESCE(v_low_margin_percent, 20)
  );
END;
$function$;
ALTER FUNCTION public.admin_get_low_margin_percent() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_get_low_margin_percent() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_low_margin_percent() TO authenticated;

-- Defesa no banco: nenhum produto com preço menor que R$ 0,50 pode ser disponibilizado.
CREATE OR REPLACE FUNCTION public.enforce_product_available_minimum_price()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.available IS TRUE AND (NEW.price IS NULL OR NEW.price < 0.50) THEN
    RAISE EXCEPTION 'Defina o preço de venda antes de disponibilizar'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
ALTER FUNCTION public.enforce_product_available_minimum_price() OWNER TO postgres;

DROP TRIGGER IF EXISTS products_require_minimum_price_before_available ON public.products;
CREATE TRIGGER products_require_minimum_price_before_available
BEFORE INSERT OR UPDATE OF available, price ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.enforce_product_available_minimum_price();

-- Somente o nome muda; preço, disponibilidade, unidade e peso permanecem intocados.
DO $$
BEGIN
  UPDATE public.products
  SET name = 'Brócolis (kg)'
  WHERE id = 'feiraja_brocolis_unidade';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto feiraja_brocolis_unidade não encontrado';
  END IF;
END;
$$;

COMMIT;
