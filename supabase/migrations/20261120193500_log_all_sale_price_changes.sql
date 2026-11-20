-- Registra toda alteração do preço de venda, inclusive edições manuais existentes.
CREATE OR REPLACE FUNCTION feira_cost_private.log_product_sale_price_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF OLD.price IS DISTINCT FROM NEW.price THEN
    INSERT INTO feira_cost_private.product_sale_price_history(product_id,old_price,new_price,changed_by,changed_at)
    VALUES(OLD.id,OLD.price,NEW.price,auth.uid(),now());
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION feira_cost_private.log_product_sale_price_change() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS log_product_sale_price_change ON public.products;
CREATE TRIGGER log_product_sale_price_change
AFTER UPDATE OF price ON public.products
FOR EACH ROW
WHEN (OLD.price IS DISTINCT FROM NEW.price)
EXECUTE FUNCTION feira_cost_private.log_product_sale_price_change();

CREATE OR REPLACE FUNCTION public.admin_apply_automatic_price(p_product_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_product public.products%ROWTYPE; v_balcony numeric; v_tiers jsonb; v_suggested numeric; v_actor uuid:=auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Acesso permitido somente a administradores.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_product FROM public.products WHERE id=p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado.' USING ERRCODE='P0002'; END IF;
  IF v_product.old_price IS NOT NULL THEN
    RAISE EXCEPTION 'Produto em promoção: preço de venda preservado.' USING ERRCODE='22023';
  END IF;
  SELECT pc.preco_balcao INTO v_balcony FROM feira_cost_private.product_costs pc WHERE pc.product_id=p_product_id;
  IF v_balcony IS NULL THEN RAISE EXCEPTION 'Produto sem preço de balcão.' USING ERRCODE='22023'; END IF;
  SELECT tiers INTO v_tiers FROM feira_cost_private.automatic_margin_settings WHERE settings_key='default';
  v_suggested:=feira_cost_private.suggested_sale_price(v_balcony,v_tiers);
  IF v_product.price IS DISTINCT FROM v_suggested THEN
    UPDATE public.products SET price=v_suggested WHERE id=p_product_id;
  END IF;
  RETURN jsonb_build_object('success',true,'product_id',p_product_id,'old_price',v_product.price,'new_price',v_suggested);
END;
$function$;
