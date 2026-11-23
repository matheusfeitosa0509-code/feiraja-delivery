-- Index the product foreign key for efficient product checks and deletes.
CREATE INDEX IF NOT EXISTS daily_recipe_kit_items_product_id_idx
  ON public.daily_recipe_kit_items (product_id);
