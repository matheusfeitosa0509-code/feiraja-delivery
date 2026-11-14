BEGIN;

DROP POLICY IF EXISTS "product_photos_admin_insert" ON storage.objects;
DROP POLICY IF EXISTS "product_photos_admin_delete" ON storage.objects;

-- O bucket só deve ser removido depois de conferir que está vazio.
-- Esta reversão falha de propósito se ainda houver arquivos, evitando perda de fotos.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'product-photos') THEN
    RAISE EXCEPTION 'Bucket product-photos contém arquivos; remova-os pela Storage API antes de reverter.';
  END IF;
END;
$$;

DELETE FROM storage.buckets WHERE id = 'product-photos';

COMMIT;
