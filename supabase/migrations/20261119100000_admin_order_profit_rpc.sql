BEGIN;

CREATE OR REPLACE FUNCTION public.admin_get_order_profit(
  p_order_ids text[],
  p_start timestamptz,
  p_end timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
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
    RAISE EXCEPTION 'Período inválido.'
      USING ERRCODE = '22023';
  END IF;

  WITH target_orders AS MATERIALIZED (
    SELECT o.*
    FROM public.orders AS o
    WHERE o.id = ANY(COALESCE(p_order_ids, ARRAY[]::text[]))
       OR (o.created_at >= p_start AND o.created_at < p_end)
  ),
  order_finance AS (
    SELECT
      o.id,
      o.created_at,
      o.status,
      o.payment_method,
      o.total,
      COALESCE(o.is_test_order, false) AS is_test_order,
      COALESCE(i.items, '[]'::jsonb) AS items,
      COALESCE(i.calculated_items, 0)::integer AS calculated_items,
      COALESCE(i.total_items, 0)::integer AS total_items,
      COALESCE(i.missing_cost_items, 0)::integer AS missing_cost_items,
      COALESCE(i.known_revenue, 0)::numeric AS known_revenue,
      COALESCE(i.item_profit, 0)::numeric AS item_profit,
      GREATEST(COALESCE(dc.actual_cost, 0) - COALESCE(o.delivery_fee, 0), 0)::numeric AS delivery_covered,
      (COALESCE(i.item_profit, 0) -
        GREATEST(COALESCE(dc.actual_cost, 0) - COALESCE(o.delivery_fee, 0), 0))::numeric AS profit
    FROM target_orders AS o
    LEFT JOIN feira_cost_private.order_delivery_costs AS dc
      ON dc.order_id = o.id
    LEFT JOIN LATERAL (
      SELECT
        jsonb_agg(
          jsonb_build_object(
            'item_index', (item.ordinality - 1)::integer,
            'product_id', COALESCE(s.product_id, NULLIF(item.value->>'id', '')),
            'product_name', COALESCE(s.product_name, NULLIF(item.value->>'name', ''), 'Produto sem nome'),
            'quantity', COALESCE(s.quantity, NULLIF(item.value->>'qty', '')::numeric, NULLIF(item.value->>'quantity', '')::numeric, 1),
            'sale_unit_price', COALESCE(s.sale_unit_price, NULLIF(item.value->>'price', '')::numeric),
            'unit_cost', s.unit_cost,
            'sale_total', COALESCE(s.sale_total,
              round(COALESCE(NULLIF(item.value->>'price', '')::numeric, 0) *
                COALESCE(NULLIF(item.value->>'qty', '')::numeric, NULLIF(item.value->>'quantity', '')::numeric, 1), 2)),
            'cost_total', s.cost_total,
            'profit', s.profit,
            'cost_status', COALESCE(s.cost_status, 'missing_cost')
          ) ORDER BY item.ordinality
        ) AS items,
        count(*) FILTER (WHERE s.cost_status = 'ok')::integer AS calculated_items,
        count(*)::integer AS total_items,
        count(*) FILTER (WHERE s.cost_status IS DISTINCT FROM 'ok')::integer AS missing_cost_items,
        COALESCE(sum(s.sale_total) FILTER (WHERE s.cost_status = 'ok'), 0)::numeric AS known_revenue,
        COALESCE(sum(s.profit) FILTER (WHERE s.cost_status = 'ok'), 0)::numeric AS item_profit
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(COALESCE(o.items, '[]'::jsonb)) = 'array'
          THEN COALESCE(o.items, '[]'::jsonb) ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS item(value, ordinality)
      LEFT JOIN feira_cost_private.order_item_snapshots AS s
        ON s.order_id = o.id AND s.item_index = (item.ordinality - 1)::integer
    ) AS i ON true
  ),
  day_orders AS (
    SELECT *
    FROM order_finance
    WHERE created_at >= p_start AND created_at < p_end
      AND is_test_order = false
      AND lower(btrim(COALESCE(status, ''))) NOT IN (
        'cancelada', 'cancelado', 'pagamento cancelado',
        'pagamento recusado', 'pagamento reembolsado', 'pagamento contestado'
      )
  ),
  paid_day_orders AS (
    SELECT *
    FROM day_orders
    WHERE
      (
        lower(COALESCE(payment_method, '')) LIKE '%pix%'
        AND lower(btrim(COALESCE(status, ''))) IN (
          'pagamento confirmado', 'preparando', 'pronto para retirada',
          'saiu para entrega', 'entregue', 'pago', 'concluído', 'concluido'
        )
      )
      OR
      (
        lower(COALESCE(payment_method, '')) NOT LIKE '%pix%'
        AND lower(btrim(COALESCE(status, ''))) IN ('entregue', 'concluído', 'concluido')
      )
  )
  SELECT jsonb_build_object(
    'orders', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'order_id', f.id,
          'items', f.items,
          'calculated_items', f.calculated_items,
          'total_items', f.total_items,
          'missing_cost_items', f.missing_cost_items,
          'known_revenue', f.known_revenue,
          'item_profit', f.item_profit,
          'delivery_covered', f.delivery_covered,
          'profit', f.profit
        ) ORDER BY f.created_at DESC
      )
      FROM order_finance AS f
    ), '[]'::jsonb),
    'summary', jsonb_build_object(
      'orders_today', (SELECT count(*)::integer FROM day_orders),
      'to_separate', (
        SELECT count(*)::integer FROM day_orders
        WHERE lower(btrim(COALESCE(status, ''))) IN ('pagamento confirmado', 'preparando')
      ),
      'in_delivery', (
        SELECT count(*)::integer FROM day_orders
        WHERE lower(btrim(COALESCE(status, ''))) = 'saiu para entrega'
      ),
      'paid_sales', (SELECT COALESCE(sum(total), 0)::numeric FROM paid_day_orders),
      'profit', (SELECT COALESCE(sum(profit), 0)::numeric FROM paid_day_orders),
      'missing_cost_items', (SELECT COALESCE(sum(missing_cost_items), 0)::integer FROM paid_day_orders),
      'calculated_items', (SELECT COALESCE(sum(calculated_items), 0)::integer FROM paid_day_orders),
      'total_items', (SELECT COALESCE(sum(total_items), 0)::integer FROM paid_day_orders)
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.admin_get_order_profit(text[], timestamptz, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_get_order_profit(text[], timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_order_profit(text[], timestamptz, timestamptz)
  TO authenticated;

COMMIT;
