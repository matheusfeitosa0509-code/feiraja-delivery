-- Painel administrativo de clientes e vendas.
-- A função é chamada apenas por usuários autenticados e autorizados em admin_users.
-- Não altera tabelas, pedidos, produtos, perfis nem políticas RLS existentes.

CREATE OR REPLACE FUNCTION public.admin_sales_dashboard(
  p_start timestamptz DEFAULT (now() - interval '30 days'),
  p_end   timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now_manaus timestamp without time zone;
  v_month_start timestamptz;
  v_next_month_start timestamptz;
  v_result jsonb;
BEGIN
  -- A autorização ocorre antes de qualquer leitura de dados de clientes ou pedidos.
  IF auth.uid() IS NULL OR NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Acesso permitido somente a administradores.'
      USING ERRCODE = '42501';
  END IF;

  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RAISE EXCEPTION 'Período inválido: a data final deve ser posterior à inicial.'
      USING ERRCODE = '22023';
  END IF;

  v_now_manaus := now() AT TIME ZONE 'America/Manaus';
  v_month_start := date_trunc('month', v_now_manaus) AT TIME ZONE 'America/Manaus';
  v_next_month_start := (date_trunc('month', v_now_manaus) + interval '1 month')
    AT TIME ZONE 'America/Manaus';

  WITH base_orders AS MATERIALIZED (
    SELECT
      o.id,
      o.created_at,
      COALESCE(NULLIF(btrim(cp.full_name), ''), NULLIF(btrim(o.customer_name), ''), 'Cliente sem nome') AS customer_name,
      NULLIF(lower(btrim(o.customer_email)), '') AS customer_email,
      COALESCE(NULLIF(btrim(cp.phone), ''), NULLIF(btrim(o.customer_phone), '')) AS customer_phone,
      COALESCE(
        CASE WHEN o.user_id IS NOT NULL THEN 'user:' || o.user_id::text END,
        CASE WHEN NULLIF(lower(btrim(o.customer_email)), '') IS NOT NULL
          THEN 'email:' || lower(btrim(o.customer_email)) END,
        CASE WHEN COALESCE(NULLIF(btrim(cp.phone), ''), NULLIF(btrim(o.customer_phone), '')) IS NOT NULL
          THEN 'phone:' || regexp_replace(COALESCE(NULLIF(btrim(cp.phone), ''), NULLIF(btrim(o.customer_phone), '')), '[^0-9]', '', 'g') END,
        'order:' || o.id
      ) AS customer_key,
      COALESCE(o.total, 0)::numeric AS total,
      lower(btrim(COALESCE(o.status, ''))) AS status_norm,
      lower(COALESCE(o.payment_method, '')) AS payment_method_norm,
      CASE
        WHEN lower(btrim(COALESCE(o.status, ''))) IN
          ('cancelada', 'cancelado', 'pagamento cancelado', 'pagamento recusado')
          THEN true
        ELSE false
      END AS is_canceled,
      CASE
        WHEN lower(COALESCE(o.payment_method, '')) LIKE '%pix%'
          AND lower(btrim(COALESCE(o.status, ''))) IN
            ('pagamento confirmado', 'preparando', 'pronto para retirada', 'saiu para entrega', 'entregue',
             'pago', 'concluído', 'concluido')
          THEN true
        WHEN lower(COALESCE(o.payment_method, '')) NOT LIKE '%pix%'
          AND lower(btrim(COALESCE(o.status, ''))) IN ('entregue', 'concluído', 'concluido')
          THEN true
        ELSE false
      END AS is_paid,
      CASE
        WHEN jsonb_typeof(o.items) = 'array' THEN o.items
        ELSE '[]'::jsonb
      END AS items_safe
    FROM public.orders AS o
    LEFT JOIN public.customer_profiles AS cp
      ON cp.user_id = o.user_id
  ),
  customer_rollup AS (
    SELECT
      customer_key,
      (array_agg(customer_name ORDER BY created_at DESC NULLS LAST))[1] AS customer_name,
      (array_agg(customer_email ORDER BY created_at DESC NULLS LAST))[1] AS customer_email,
      (array_agg(customer_phone ORDER BY created_at DESC NULLS LAST))[1] AS customer_phone,
      min(created_at) AS first_order_at,
      max(created_at) AS last_order_at
    FROM base_orders
    WHERE NOT is_canceled
    GROUP BY customer_key
  ),
  paid_customer_rollup AS (
    SELECT
      customer_key,
      (array_agg(customer_name ORDER BY created_at DESC NULLS LAST))[1] AS customer_name,
      (array_agg(customer_email ORDER BY created_at DESC NULLS LAST))[1] AS customer_email,
      (array_agg(customer_phone ORDER BY created_at DESC NULLS LAST))[1] AS customer_phone,
      count(*)::integer AS order_count,
      COALESCE(sum(total), 0)::numeric AS total_spent,
      max(created_at) AS last_order_at
    FROM base_orders
    WHERE is_paid
    GROUP BY customer_key
  ),
  filtered_orders AS (
    SELECT * FROM base_orders
    WHERE NOT is_canceled AND created_at >= p_start AND created_at < p_end
  ),
  filtered_paid AS (
    SELECT * FROM base_orders
    WHERE is_paid AND created_at >= p_start AND created_at < p_end
  ),
  filtered_paid_customer_rollup AS (
    SELECT customer_key, count(*)::integer AS order_count
    FROM filtered_paid
    GROUP BY customer_key
  ),
  product_rows AS (
    SELECT
      NULLIF(btrim(item.value->>'name'), '') AS product_name,
      CASE
        WHEN COALESCE(item.value->>'quantity', item.value->>'qty', '') ~ '^[0-9]+([.][0-9]+)?$'
          THEN (COALESCE(item.value->>'quantity', item.value->>'qty'))::numeric
        ELSE 1::numeric
      END AS quantity
    FROM filtered_paid AS o
    CROSS JOIN LATERAL jsonb_array_elements(o.items_safe) AS item(value)
  ),
  weekday_counts AS (
    SELECT
      day_number,
      day_name,
      count(o.id)::integer AS order_count
    FROM (VALUES
      (1, 'Segunda-feira'), (2, 'Terça-feira'), (3, 'Quarta-feira'),
      (4, 'Quinta-feira'), (5, 'Sexta-feira'), (6, 'Sábado'), (7, 'Domingo')
    ) AS days(day_number, day_name)
    LEFT JOIN filtered_orders AS o
      ON extract(isodow FROM o.created_at AT TIME ZONE 'America/Manaus')::integer = days.day_number
    GROUP BY day_number, day_name
  ),
  hour_counts AS (
    SELECT
      bucket_order,
      bucket_name,
      count(o.id)::integer AS order_count
    FROM (VALUES
      (1, 'Madrugada (00h–05h)', 0, 6),
      (2, 'Manhã (06h–11h)', 6, 12),
      (3, 'Tarde (12h–17h)', 12, 18),
      (4, 'Noite (18h–23h)', 18, 24)
    ) AS buckets(bucket_order, bucket_name, hour_start, hour_end)
    LEFT JOIN filtered_orders AS o
      ON extract(hour FROM o.created_at AT TIME ZONE 'America/Manaus') >= buckets.hour_start
     AND extract(hour FROM o.created_at AT TIME ZONE 'America/Manaus') < buckets.hour_end
    GROUP BY bucket_order, bucket_name
  )
  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'active_customers', (SELECT count(*)::integer FROM customer_rollup WHERE last_order_at >= now() - interval '30 days'),
      'inactive_customers', (SELECT count(*)::integer FROM customer_rollup WHERE last_order_at < now() - interval '30 days'),
      'new_customers_month', (SELECT count(*)::integer FROM customer_rollup WHERE first_order_at >= v_month_start AND first_order_at < v_next_month_start),
      'current_month_revenue', (SELECT COALESCE(sum(total), 0)::numeric FROM base_orders WHERE is_paid AND created_at >= v_month_start AND created_at < v_next_month_start),
      'previous_month_revenue', (
        SELECT COALESCE(sum(total), 0)::numeric
        FROM base_orders
        WHERE is_paid
          AND created_at >= (v_month_start - interval '1 month')
          AND created_at < v_month_start
      ),
      'paid_revenue', (SELECT COALESCE(sum(total), 0)::numeric FROM filtered_paid),
      'paid_order_count', (SELECT count(*)::integer FROM filtered_paid),
      'average_ticket', (
        SELECT CASE WHEN count(*) = 0 THEN NULL
          ELSE round(sum(total) / NULLIF(count(*), 0), 2) END
        FROM filtered_paid
      ),
      'repurchase_rate', (
        SELECT CASE WHEN count(*) = 0 THEN NULL
          ELSE round(
            100.0 * count(*) FILTER (WHERE order_count > 1) / NULLIF(count(*), 0),
            2
          ) END
        FROM filtered_paid_customer_rollup
      )
    ),
    'rank_by_spend', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.total_spent DESC, r.order_count DESC)
      FROM (
        SELECT
          customer_name,
          customer_email,
          customer_phone,
          order_count,
          total_spent,
          last_order_at
        FROM (
          SELECT
            customer_key,
            (array_agg(customer_name ORDER BY created_at DESC NULLS LAST))[1] AS customer_name,
            (array_agg(customer_email ORDER BY created_at DESC NULLS LAST))[1] AS customer_email,
            (array_agg(customer_phone ORDER BY created_at DESC NULLS LAST))[1] AS customer_phone,
            count(*)::integer AS order_count,
            COALESCE(sum(total), 0)::numeric AS total_spent,
            max(created_at) AS last_order_at
          FROM filtered_paid
          GROUP BY customer_key
        ) AS customers
        ORDER BY total_spent DESC, order_count DESC
        LIMIT 100
      ) AS r
    ), '[]'::jsonb),
    'rank_by_orders', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.order_count DESC, r.total_spent DESC)
      FROM (
        SELECT
          customer_name,
          customer_email,
          customer_phone,
          order_count,
          total_spent,
          last_order_at
        FROM (
          SELECT
            customer_key,
            (array_agg(customer_name ORDER BY created_at DESC NULLS LAST))[1] AS customer_name,
            (array_agg(customer_email ORDER BY created_at DESC NULLS LAST))[1] AS customer_email,
            (array_agg(customer_phone ORDER BY created_at DESC NULLS LAST))[1] AS customer_phone,
            count(*)::integer AS order_count,
            COALESCE(sum(total), 0)::numeric AS total_spent,
            max(created_at) AS last_order_at
          FROM filtered_paid
          GROUP BY customer_key
        ) AS customers
        ORDER BY order_count DESC, total_spent DESC
        LIMIT 100
      ) AS r
    ), '[]'::jsonb),
    'inactive_customers', COALESCE((
      SELECT jsonb_agg(to_jsonb(i) ORDER BY i.last_order_at ASC)
      FROM (
        SELECT customer_name, customer_email, customer_phone, last_order_at
        FROM customer_rollup
        WHERE last_order_at < now() - interval '30 days'
        ORDER BY last_order_at ASC
        LIMIT 500
      ) AS i
    ), '[]'::jsonb),
    'top_products', COALESCE((
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.quantity_sold DESC, p.product_name ASC)
      FROM (
        SELECT product_name, sum(quantity)::numeric AS quantity_sold
        FROM product_rows
        WHERE product_name IS NOT NULL
        GROUP BY product_name
        ORDER BY quantity_sold DESC, product_name ASC
        LIMIT 10
      ) AS p
    ), '[]'::jsonb),
    'orders_by_weekday', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('day', day_name, 'order_count', order_count) ORDER BY day_number)
      FROM weekday_counts
    ), '[]'::jsonb),
    'orders_by_hour', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('period', bucket_name, 'order_count', order_count) ORDER BY bucket_order)
      FROM hour_counts
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

-- A função lê dados de clientes e pedidos com privilégio do proprietário;
-- por isso, EXECUTE fica restrito ao papel authenticated e a função valida
-- auth.uid() + is_current_user_admin() antes de qualquer SELECT.
REVOKE ALL ON FUNCTION public.admin_sales_dashboard(timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_sales_dashboard(timestamptz, timestamptz)
  TO authenticated;
