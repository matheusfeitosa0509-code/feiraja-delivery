-- Edição do custo efetivamente pago durante a separação.
-- Custos permanecem no schema privado; a única porta de escrita é a RPC admin.
BEGIN;

CREATE TABLE feira_cost_private.order_item_cost_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id text NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  item_index integer NOT NULL CHECK (item_index >= 0),
  product_id text,
  old_unit_cost numeric(12,2),
  new_unit_cost numeric(12,2) NOT NULL CHECK (new_unit_cost >= 0),
  product_default_updated boolean NOT NULL DEFAULT false,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE feira_cost_private.order_item_cost_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON feira_cost_private.order_item_cost_history FROM PUBLIC, anon, authenticated;
GRANT ALL ON feira_cost_private.order_item_cost_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE feira_cost_private.order_item_cost_history_id_seq TO service_role;

CREATE INDEX order_item_cost_history_order_idx
  ON feira_cost_private.order_item_cost_history(order_id, item_index, changed_at DESC);

CREATE OR REPLACE FUNCTION public.admin_update_order_item_cost(
  p_order_id text,
  p_item_index integer,
  p_unit_cost numeric,
  p_update_product_cost boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_snapshot feira_cost_private.order_item_snapshots%ROWTYPE;
  v_old_cost numeric(12,2);
  v_new_cost numeric(12,2);
  v_product_updated boolean := false;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Acesso permitido somente a administradores.' USING ERRCODE = '42501';
  END IF;
  IF p_order_id IS NULL OR btrim(p_order_id) = ''
     OR p_item_index IS NULL OR p_item_index < 0
     OR p_unit_cost IS NULL OR p_unit_cost < 0 THEN
    RAISE EXCEPTION 'Informe um custo válido (zero ou maior).' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_snapshot
  FROM feira_cost_private.order_item_snapshots
  WHERE order_id = p_order_id AND item_index = p_item_index
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item do pedido não encontrado no snapshot financeiro.' USING ERRCODE = 'P0002';
  END IF;

  v_old_cost := v_snapshot.unit_cost;
  v_new_cost := round(p_unit_cost, 2);

  IF p_update_product_cost AND v_snapshot.product_id IS NOT NULL THEN
    IF v_new_cost <= 0 THEN
      RAISE EXCEPTION 'Para atualizar o custo padrão do produto, informe um valor maior que zero.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO feira_cost_private.product_costs(product_id, unit_cost, updated_at, updated_by)
    VALUES (v_snapshot.product_id, v_new_cost, now(), auth.uid())
    ON CONFLICT (product_id) DO UPDATE
      SET unit_cost = EXCLUDED.unit_cost, updated_at = now(), updated_by = auth.uid();
    v_product_updated := true;
  ELSIF p_update_product_cost AND v_snapshot.product_id IS NULL THEN
    RAISE EXCEPTION 'Este item não está vinculado a um produto do catálogo; desmarque a atualização do custo padrão.' USING ERRCODE = '22023';
  END IF;

  UPDATE feira_cost_private.order_item_snapshots
  SET unit_cost = v_new_cost,
      cost_total = CASE WHEN quantity IS NOT NULL THEN round(quantity * v_new_cost, 2) END,
      profit = CASE WHEN sale_total IS NOT NULL AND quantity IS NOT NULL
        THEN round(sale_total - (quantity * v_new_cost), 2) END,
      cost_status = CASE WHEN sale_total IS NOT NULL AND quantity IS NOT NULL THEN 'ok' ELSE 'invalid_item' END,
      captured_at = now()
  WHERE order_id = p_order_id AND item_index = p_item_index;

  INSERT INTO feira_cost_private.order_item_cost_history(
    order_id, item_index, product_id, old_unit_cost, new_unit_cost,
    product_default_updated, changed_at, changed_by
  ) VALUES (
    p_order_id, p_item_index, v_snapshot.product_id, v_old_cost, v_new_cost,
    v_product_updated, now(), auth.uid()
  );

  RETURN jsonb_build_object(
    'success', true, 'order_id', p_order_id, 'item_index', p_item_index,
    'old_unit_cost', v_old_cost, 'new_unit_cost', v_new_cost,
    'product_default_updated', v_product_updated
  );
END;
$function$;

ALTER FUNCTION public.admin_update_order_item_cost(text, integer, numeric, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_update_order_item_cost(text, integer, numeric, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_order_item_cost(text, integer, numeric, boolean)
  TO authenticated;

COMMIT;
