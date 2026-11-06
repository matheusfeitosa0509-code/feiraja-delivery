ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS resale_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resale_price numeric,
  ADD COLUMN IF NOT EXISTS resale_min_qty integer NOT NULL DEFAULT 10;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_resale_min_qty_check,
  ADD CONSTRAINT products_resale_min_qty_check
    CHECK (resale_min_qty >= 1),
  DROP CONSTRAINT IF EXISTS products_resale_price_check,
  ADD CONSTRAINT products_resale_price_check
    CHECK (
      NOT resale_enabled
      OR (resale_price IS NOT NULL AND resale_price > 0)
    );

CREATE OR REPLACE FUNCTION public.validate_product_resale_pricing()
RETURNS trigger
LANGUAGE plpgsql
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

DROP TRIGGER IF EXISTS products_validate_resale_pricing ON public.products;

CREATE TRIGGER products_validate_resale_pricing
BEFORE INSERT OR UPDATE OF resale_enabled, resale_price
ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.validate_product_resale_pricing();

COMMENT ON COLUMN public.products.resale_enabled IS
  'Indica se o produto oferece preço de revenda por quantidade.';
COMMENT ON COLUMN public.products.resale_price IS
  'Preço unitário de revenda; aplicado no backend ao atingir resale_min_qty.';
COMMENT ON COLUMN public.products.resale_min_qty IS
  'Quantidade mínima individual do produto para preço de revenda; padrão 10.';