-- Keep the existing JPEG support and allow the PNG/WebP formats used by the admin photo workflow.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'product-photos';
