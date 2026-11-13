-- Feira On Delivery: marcação de itens separados no painel administrativo.
-- Aplicar manualmente somente após revisar esta migration e aprovar a PR.
BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS separated_items jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND conname = 'orders_separated_items_is_array'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_separated_items_is_array
      CHECK (jsonb_typeof(separated_items) = 'array');
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.set_order_separated_items(
  p_order_id text,
  p_item_keys jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users AS a
    WHERE a.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Apenas administradores podem marcar itens separados'
      USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_item_keys) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'A lista de itens separados deve ser um array JSON'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_item_keys) AS item(value)
    WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'string'
  ) THEN
    RAISE EXCEPTION 'Cada identificação de item deve ser texto'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders SET separated_items = p_item_keys WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido não encontrado' USING ERRCODE = 'P0002';
  END IF;
  RETURN p_item_keys;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_order_separated_items(text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_order_separated_items(text, jsonb)
  TO authenticated;

COMMENT ON COLUMN public.orders.separated_items IS
  'Identificadores estáveis das linhas de itens marcadas como separadas no painel administrativo.';

COMMIT;
