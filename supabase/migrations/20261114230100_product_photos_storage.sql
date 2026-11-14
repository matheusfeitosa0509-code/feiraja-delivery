BEGIN;

-- Bucket público somente para servir as imagens; upload e exclusão continuam protegidos por RLS.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-photos', 'product-photos', true, 307200, ARRAY['image/jpeg']);

-- Upload: somente usuários autenticados presentes em public.admin_users.
CREATE POLICY "product_photos_admin_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'product-photos'
  AND public.is_current_user_admin()
);

-- Exclusão de foto antiga: somente administradores.
CREATE POLICY "product_photos_admin_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'product-photos'
  AND public.is_current_user_admin()
);

-- Não há política UPDATE: o painel sempre envia um objeto com nome único
-- (upsert=false), atualiza products.image e só então remove a foto antiga
-- se nenhum outro produto ainda a utilizar. Leitura é pública pelo bucket.

COMMIT;
