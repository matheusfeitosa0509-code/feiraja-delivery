-- ROLLBACK da compra por valor exato.
-- Restaura a funcao de snapshot anterior e remove somente os objetos desta migration.

BEGIN;

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
          SELECT pc.unit_cost INTO v_unit_cost
          FROM feira_cost_private.product_costs AS pc
          WHERE pc.product_id = v_product_id;
        END IF;

        INSERT INTO feira_cost_private.order_item_snapshots (
          order_id, item_index, product_id, product_name, quantity,
          sale_unit_price, unit_cost, sale_total, cost_total, profit,
          cost_status, captured_at
        ) VALUES (
          NEW.id, v_index, v_product_id, v_product_name, v_quantity,
          v_sale_unit_price, v_unit_cost,
          CASE WHEN v_quantity IS NOT NULL AND v_sale_unit_price IS NOT NULL
            THEN round(v_quantity * v_sale_unit_price, 2) END,
          CASE WHEN v_quantity IS NOT NULL AND v_unit_cost IS NOT NULL
            THEN round(v_quantity * v_unit_cost, 2) END,
          CASE WHEN v_quantity IS NOT NULL AND v_sale_unit_price IS NOT NULL AND v_unit_cost IS NOT NULL
            THEN round(v_quantity * (v_sale_unit_price - v_unit_cost), 2) END,
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
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      INSERT INTO feira_cost_private.snapshot_errors(order_id, error_message)
      VALUES (NEW.id, left(COALESCE(v_error, 'Falha desconhecida na captura de custo'), 500));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END;
  RETURN NEW;
END;
$function$;
ALTER FUNCTION feira_cost_private.capture_order_item_costs() OWNER TO postgres;
REVOKE ALL ON FUNCTION feira_cost_private.capture_order_item_costs()
  FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.admin_set_value_sale_minimum(integer);
DROP FUNCTION IF EXISTS public.get_sales_settings();
DROP TABLE IF EXISTS feira_cost_private.sales_settings;

COMMIT;
