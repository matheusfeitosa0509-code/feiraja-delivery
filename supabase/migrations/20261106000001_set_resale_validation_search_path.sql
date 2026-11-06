CREATE OR REPLACE FUNCTION public.validate_product_resale_pricing()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.resale_enabled THEN
    IF NEW.resale_price IS NULL OR NEW.resale_price <= 0 THEN
      RAISE EXCEPTION 'Preço de revenda deve ser maior que zero.'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.resale_price >= NEW.price THEN
      RAISE EXCEPTION 'Preço de revenda deve ser menor que o preço normal atual.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;