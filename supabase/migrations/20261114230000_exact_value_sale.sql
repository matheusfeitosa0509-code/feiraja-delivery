-- Configuracao do minimo por valor e snapshot com total exato em centavos.
-- Aplicar somente depois de revisar/mesclar a PR; nao aplicar durante esta etapa de rascunho.

BEGIN;

ALTER TABLE public.product_sales_rules
  ADD COLUMN allow_value_sale boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.admin_set_product_value_sale(
  p_product_id text,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale_unit text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Acesso permitido somente a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_product_id IS NULL OR length(trim(p_product_id)) = 0 OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'Produto ou estado inválido.' USING ERRCODE = '22023';
  END IF;
  SELECT r.sale_unit INTO v_sale_unit
  FROM public.product_sales_rules AS r
  WHERE r.product_id = p_product_id;
  IF v_sale_unit IS DISTINCT FROM 'kg' THEN
    RAISE EXCEPTION 'A compra por valor só pode ser liberada para produtos vendidos por kg.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.product_sales_rules
  SET allow_value_sale = p_enabled
  WHERE product_id = p_product_id;
  RETURN jsonb_build_object('success', true, 'product_id', p_product_id, 'allow_value_sale', p_enabled);
END;
$function$;
ALTER FUNCTION public.admin_set_product_value_sale(text, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_set_product_value_sale(text, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_product_value_sale(text, boolean) TO authenticated;

CREATE TABLE feira_cost_private.sales_settings (
  setting_key text PRIMARY KEY CHECK (setting_key = 'global'),
  min_value_cents integer NOT NULL DEFAULT 500 CHECK (min_value_cents >= 500 AND min_value_cents <= 100000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE feira_cost_private.sales_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins_manage_sales_settings"
  ON feira_cost_private.sales_settings
  FOR ALL TO authenticated
  USING ((SELECT public.is_current_user_admin()))
  WITH CHECK ((SELECT public.is_current_user_admin()));

INSERT INTO feira_cost_private.sales_settings(setting_key, min_value_cents)
VALUES ('global', 500)
ON CONFLICT (setting_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_sales_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_min_value_cents integer;
BEGIN
  SELECT s.min_value_cents INTO v_min_value_cents
  FROM feira_cost_private.sales_settings AS s
  WHERE s.setting_key = 'global';

  RETURN jsonb_build_object(
    'min_value_cents', COALESCE(v_min_value_cents, 500)
  );
END;
$function$;
ALTER FUNCTION public.get_sales_settings() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_sales_settings()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sales_settings() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_value_sale_minimum(p_min_value_cents integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Acesso permitido somente a administradores.'
      USING ERRCODE = '42501';
  END IF;

  IF p_min_value_cents IS NULL OR p_min_value_cents < 500 OR p_min_value_cents > 100000 THEN
    RAISE EXCEPTION 'O mínimo deve ficar entre R$ 5,00 e R$ 1.000,00.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO feira_cost_private.sales_settings(setting_key, min_value_cents, updated_at, updated_by)
  VALUES ('global', p_min_value_cents, now(), auth.uid())
  ON CONFLICT (setting_key) DO UPDATE
    SET min_value_cents = EXCLUDED.min_value_cents,
        updated_at = now(),
        updated_by = auth.uid();

  RETURN jsonb_build_object('success', true, 'min_value_cents', p_min_value_cents);
END;
$function$;
ALTER FUNCTION public.admin_set_value_sale_minimum(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_set_value_sale_minimum(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_value_sale_minimum(integer) TO authenticated;

CREATE OR REPLACE FUNCTION feira_cost_private.capture_order_item_costs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_item jsonb;
  v_index integer;
  v_product_id text;
  v_product_name text;
  v_quantity numeric;
  v_sale_unit_price numeric;
  v_unit_cost numeric;
  v_sale_total numeric;
  v_cost_total numeric;
  v_error text;
BEGIN
  BEGIN
    DELETE FROM feira_cost_private.order_item_snapshots
    WHERE order_id = NEW.id;

    IF jsonb_typeof(NEW.items) = 'array' THEN
      FOR v_item, v_index IN
        SELECT item.value, (item.ordinality - 1)::integer
        FROM jsonb_array_elements(NEW.items) WITH ORDINALITY AS item(value, ordinality)
      LOOP
        v_product_id := NULLIF(v_item->>'id', '');
        v_product_name := COALESCE(NULLIF(v_item->>'name', ''), 'Produto sem nome');
        v_quantity := COALESCE(NULLIF(v_item->>'qty', ''), NULLIF(v_item->>'quantity', ''))::numeric;
        v_sale_unit_price := NULLIF(v_item->>'price', '')::numeric;
        v_unit_cost := NULL;

        IF v_product_id IS NOT NULL THEN
          SELECT pc.unit_cost
            INTO v_unit_cost
          FROM feira_cost_private.product_costs AS pc
          WHERE pc.product_id = v_product_id;
        END IF;

        IF v_item->>'sale_mode' = 'value' THEN
          v_sale_total := round(NULLIF(v_item->>'line_total_cents', '')::numeric / 100, 2);
        ELSE
          v_sale_total := CASE
            WHEN v_quantity IS NOT NULL AND v_sale_unit_price IS NOT NULL
              THEN round(v_quantity * v_sale_unit_price, 2)
            ELSE NULL
          END;
        END IF;

        v_cost_total := CASE
          WHEN v_quantity IS NOT NULL AND v_unit_cost IS NOT NULL
            THEN round(v_quantity * v_unit_cost, 2)
          ELSE NULL
        END;

        INSERT INTO feira_cost_private.order_item_snapshots (
          order_id, item_index, product_id, product_name, quantity,
          sale_unit_price, unit_cost, sale_total, cost_total, profit,
          cost_status, captured_at
        ) VALUES (
          NEW.id, v_index, v_product_id, v_product_name, v_quantity,
          v_sale_unit_price, v_unit_cost, v_sale_total, v_cost_total,
          CASE WHEN v_sale_total IS NOT NULL AND v_cost_total IS NOT NULL
            THEN round(v_sale_total - v_cost_total, 2) END,
          CASE
            WHEN v_quantity IS NULL OR v_sale_unit_price IS NULL THEN 'invalid_item'
            WHEN v_unit_cost IS NULL THEN 'missing_cost'
            ELSE 'ok'
          END,
          now()
        );
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    BEGIN
      DELETE FROM feira_cost_private.order_item_snapshots WHERE order_id = NEW.id;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    BEGIN
      INSERT INTO feira_cost_private.snapshot_errors(order_id, error_message)
      VALUES (NEW.id, left(COALESCE(v_error, 'Falha desconhecida na captura de custo'), 500));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION feira_cost_private.capture_order_item_costs() OWNER TO postgres;
REVOKE ALL ON FUNCTION feira_cost_private.capture_order_item_costs()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
