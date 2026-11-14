-- Snapshots privados de custo por item do pedido.
-- Não adiciona colunas nem altera dados existentes de public.products/public.orders.
-- Única alteração em tabela existente: trigger AFTER INSERT OR UPDATE OF items em public.orders.

BEGIN;

CREATE SCHEMA feira_cost_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA feira_cost_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE feira_cost_private.product_costs (
  product_id text PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  unit_cost numeric(12,2) NOT NULL CHECK (unit_cost > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE feira_cost_private.order_item_snapshots (
  order_id text NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  item_index integer NOT NULL CHECK (item_index >= 0),
  product_id text,
  product_name text NOT NULL,
  quantity numeric,
  sale_unit_price numeric(12,2),
  unit_cost numeric(12,2),
  sale_total numeric(14,2),
  cost_total numeric(14,2),
  profit numeric(14,2),
  cost_status text NOT NULL CHECK (cost_status IN ('ok', 'missing_cost', 'invalid_item')),
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, item_index)
);

CREATE TABLE feira_cost_private.snapshot_errors (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id text,
  error_message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE feira_cost_private.product_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE feira_cost_private.order_item_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE feira_cost_private.snapshot_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_manage_product_costs"
  ON feira_cost_private.product_costs
  FOR ALL TO authenticated
  USING ((SELECT public.is_current_user_admin()))
  WITH CHECK ((SELECT public.is_current_user_admin()));

CREATE POLICY "admins_read_order_item_cost_snapshots"
  ON feira_cost_private.order_item_snapshots
  FOR SELECT TO authenticated
  USING ((SELECT public.is_current_user_admin()));

CREATE POLICY "admins_read_snapshot_errors"
  ON feira_cost_private.snapshot_errors
  FOR SELECT TO authenticated
  USING ((SELECT public.is_current_user_admin()));

-- Não há grants diretos nas tabelas privadas. O painel usa somente RPCs
-- que verificam explicitamente a associação em admin_users.

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
  -- A captura é isolada em subtransação: qualquer falha não impede o pedido.
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

        INSERT INTO feira_cost_private.order_item_snapshots (
          order_id, item_index, product_id, product_name, quantity,
          sale_unit_price, unit_cost, sale_total, cost_total, profit,
          cost_status, captured_at
        ) VALUES (
          NEW.id,
          v_index,
          v_product_id,
          v_product_name,
          v_quantity,
          v_sale_unit_price,
          v_unit_cost,
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

    -- O bloco interno falhou e suas gravações foram revertidas.
    -- Remover snapshots antigos evita exibir dados obsoletos como atuais.
    BEGIN
      DELETE FROM feira_cost_private.order_item_snapshots
      WHERE order_id = NEW.id;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    -- A própria auditoria também nunca pode bloquear a criação/alteração do pedido.
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

CREATE TRIGGER trg_capture_order_item_costs
AFTER INSERT OR UPDATE OF items ON public.orders
FOR EACH ROW
EXECUTE FUNCTION feira_cost_private.capture_order_item_costs();

CREATE OR REPLACE FUNCTION public.admin_set_product_cost(
  p_product_id text,
  p_unit_cost numeric
)
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

  IF p_product_id IS NULL OR btrim(p_product_id) = ''
     OR p_unit_cost IS NULL OR p_unit_cost <= 0 THEN
    RAISE EXCEPTION 'Produto e custo unitário maior que zero são obrigatórios.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = p_product_id) THEN
    RAISE EXCEPTION 'Produto não encontrado.'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO feira_cost_private.product_costs(product_id, unit_cost, updated_at, updated_by)
  VALUES (p_product_id, round(p_unit_cost, 2), now(), auth.uid())
  ON CONFLICT (product_id) DO UPDATE
    SET unit_cost = EXCLUDED.unit_cost,
        updated_at = now(),
        updated_by = auth.uid();

  RETURN jsonb_build_object('success', true, 'product_id', p_product_id);
END;
$function$;

ALTER FUNCTION public.admin_set_product_cost(text, numeric) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_set_product_cost(text, numeric)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_product_cost(text, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_cost_report(
  p_start timestamptz,
  p_end timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Acesso permitido somente a administradores.'
      USING ERRCODE = '42501';
  END IF;

  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RAISE EXCEPTION 'Período inválido: a data final deve ser posterior à inicial.'
      USING ERRCODE = '22023';
  END IF;

  WITH paid_orders AS MATERIALIZED (
    SELECT o.id, o.created_at
    FROM public.orders AS o
    WHERE o.created_at >= p_start
      AND o.created_at < p_end
      AND lower(btrim(COALESCE(o.status, ''))) NOT IN (
        'cancelada', 'cancelado', 'pagamento cancelado',
        'pagamento recusado', 'pagamento reembolsado', 'pagamento contestado'
      )
      AND (
        (
          lower(COALESCE(o.payment_method, '')) LIKE '%pix%'
          AND lower(btrim(COALESCE(o.status, ''))) IN (
            'pagamento confirmado', 'preparando', 'pronto para retirada',
            'saiu para entrega', 'entregue', 'pago', 'concluído', 'concluido'
          )
        )
        OR
        (
          lower(COALESCE(o.payment_method, '')) NOT LIKE '%pix%'
          AND lower(btrim(COALESCE(o.status, ''))) IN ('entregue', 'concluído', 'concluido')
        )
      )
  ),
  period_items AS (
    SELECT s.*
    FROM feira_cost_private.order_item_snapshots AS s
    JOIN paid_orders AS o ON o.id = s.order_id
  ),
  totals AS (
    SELECT
      count(DISTINCT order_id)::integer AS order_count,
      COALESCE(sum(sale_total), 0)::numeric AS sales_total,
      COALESCE(sum(sale_total) FILTER (WHERE unit_cost IS NOT NULL), 0)::numeric AS known_revenue,
      COALESCE(sum(cost_total) FILTER (WHERE unit_cost IS NOT NULL), 0)::numeric AS known_cost,
      COALESCE(sum(profit) FILTER (WHERE unit_cost IS NOT NULL), 0)::numeric AS profit,
      count(*) FILTER (WHERE cost_status = 'missing_cost')::integer AS missing_cost_items,
      count(*) FILTER (WHERE cost_status = 'invalid_item')::integer AS invalid_items
    FROM period_items
  )
  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'orders', totals.order_count,
      'sales_total', totals.sales_total,
      'known_revenue', totals.known_revenue,
      'known_cost', totals.known_cost,
      'profit', totals.profit,
      'profit_percent', CASE WHEN totals.known_revenue > 0
        THEN round(100 * totals.profit / totals.known_revenue, 2) ELSE NULL END,
      'missing_cost_items', totals.missing_cost_items,
      'invalid_items', totals.invalid_items
    ),
    'products', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'category', p.category,
          'price', p.price,
          'available', p.available,
          'unit_cost', pc.unit_cost,
          'updated_at', pc.updated_at
        ) ORDER BY p.name
      )
      FROM public.products AS p
      LEFT JOIN feira_cost_private.product_costs AS pc ON pc.product_id = p.id
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM totals;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.admin_get_cost_report(timestamptz, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_get_cost_report(timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_cost_report(timestamptz, timestamptz) TO authenticated;

COMMIT;
