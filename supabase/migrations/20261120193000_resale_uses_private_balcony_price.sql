-- Parte 4c: resale price is the exact private counter price (preco_balcao).
-- Customer-facing resale_price is a synchronized display cache; checkout reads the
-- authoritative private value through a service-role-only RPC.

UPDATE public.products p
SET resale_enabled = (pc.preco_balcao < p.price),
    resale_price = pc.preco_balcao,
    resale_min_qty = 10,
    resale_unit = CASE WHEN r.sale_unit = 'kg' THEN 'kg' ELSE 'un' END
FROM feira_cost_private.product_costs pc
LEFT JOIN public.product_sales_rules r ON r.product_id = pc.product_id
WHERE pc.product_id = p.id
  AND pc.preco_balcao IS NOT NULL;

UPDATE public.products p
SET resale_enabled = false,
    resale_price = NULL,
    resale_min_qty = 10,
    resale_unit = CASE WHEN r.sale_unit = 'kg' THEN 'kg' ELSE 'un' END
FROM public.product_sales_rules r
WHERE r.product_id = p.id
  AND NOT EXISTS (
    SELECT 1 FROM feira_cost_private.product_costs pc
    WHERE pc.product_id = p.id AND pc.preco_balcao IS NOT NULL
  );

CREATE OR REPLACE FUNCTION feira_cost_private.sync_product_resale_from_balcony()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale_price numeric(12,2);
  v_was_enabled boolean;
  v_resale_unit text;
  v_enable boolean;
BEGIN
  SELECT p.price, p.resale_enabled,
         CASE WHEN r.sale_unit = 'kg' THEN 'kg' ELSE 'un' END
    INTO v_sale_price, v_was_enabled, v_resale_unit
  FROM public.products p
  LEFT JOIN public.product_sales_rules r ON r.product_id = p.id
  WHERE p.id = NEW.product_id
  FOR UPDATE OF p;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.preco_balcao IS NULL THEN
    UPDATE public.products
    SET resale_enabled = false,
        resale_price = NULL,
        resale_min_qty = 10,
        resale_unit = v_resale_unit
    WHERE id = NEW.product_id;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_enable := NEW.preco_balcao < v_sale_price;
  ELSIF OLD.preco_balcao IS NULL THEN
    v_enable := NEW.preco_balcao < v_sale_price;
  ELSE
    v_enable := COALESCE(v_was_enabled, false) AND NEW.preco_balcao < v_sale_price;
  END IF;

  UPDATE public.products
  SET resale_enabled = v_enable,
      resale_price = NEW.preco_balcao,
      resale_min_qty = 10,
      resale_unit = v_resale_unit
  WHERE id = NEW.product_id;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION feira_cost_private.sync_product_resale_from_balcony() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_product_resale_from_balcony ON feira_cost_private.product_costs;
DROP TRIGGER IF EXISTS sync_product_resale_from_balcony_insert ON feira_cost_private.product_costs;
DROP TRIGGER IF EXISTS sync_product_resale_from_balcony_update ON feira_cost_private.product_costs;
CREATE TRIGGER sync_product_resale_from_balcony_insert
AFTER INSERT ON feira_cost_private.product_costs
FOR EACH ROW
EXECUTE FUNCTION feira_cost_private.sync_product_resale_from_balcony();
CREATE TRIGGER sync_product_resale_from_balcony_update
AFTER UPDATE OF preco_balcao ON feira_cost_private.product_costs
FOR EACH ROW
WHEN (OLD.preco_balcao IS DISTINCT FROM NEW.preco_balcao)
EXECUTE FUNCTION feira_cost_private.sync_product_resale_from_balcony();

CREATE OR REPLACE FUNCTION public.service_get_product_resale_prices(p_product_ids text[])
RETURNS TABLE(product_id text, preco_balcao numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Acesso permitido somente ao serviço interno.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT pc.product_id, pc.preco_balcao
  FROM feira_cost_private.product_costs pc
  WHERE pc.product_id = ANY(COALESCE(p_product_ids, ARRAY[]::text[]))
    AND pc.preco_balcao IS NOT NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.service_get_product_resale_prices(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_get_product_resale_prices(text[]) TO service_role;
