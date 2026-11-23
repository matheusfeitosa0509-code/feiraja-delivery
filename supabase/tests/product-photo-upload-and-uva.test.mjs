import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel=fs.readFileSync(new URL('../../painel.html',import.meta.url),'utf8');
const uva=fs.readFileSync(new URL('../migrations/20261114184851_uva_kg_sale_rule.sql',import.meta.url),'utf8');
const storage=fs.readFileSync(new URL('../migrations/20261114185150_product_photos_storage.sql',import.meta.url),'utf8');
const rollback=fs.readFileSync(new URL('../rollbacks/20261114185150_product_photos_storage_rollback.sql',import.meta.url),'utf8');
const webpMigration=fs.readFileSync(new URL('../migrations/20261123113000_product_photos_allow_webp_png.sql',import.meta.url),'utf8');

for(const id of ['btnPickSheetPhoto','sheetPhotoInput','sheetImagePreview','btnPickNewProductPhoto','newProductPhotoInput','newProductPhotoPreview']) {
 assert.match(panel,new RegExp('id="'+id+'"'),'photo upload UI includes '+id);
}
assert.match(panel,/function compressProductPhoto\(file\)/,'images are compressed in browser');
assert.match(panel,/800\/Math\.max\(width,height\)/,'longest image dimension is capped at 800 px');
assert.match(panel,/PRODUCT_PHOTO_MAX_BYTES=300\*1024/,'compressed image size is capped at 300 KB');
assert.match(panel,/canvas\.toBlob\(resolve,'image\/jpeg',quality\)/,'uploads are converted to JPEG');
assert.match(panel,/upsert:false/,'every photo gets a unique object and is never overwritten');
assert.match(panel,/db\.storage\.from\(PRODUCT_PHOTO_BUCKET\)\.upload/,'photos upload through Supabase Storage');
assert.match(panel,/if\(thumbUpload\.error\)\{console\.warn\([\s\S]*?savedThumbPath=null;\}/,'thumbnail failure preserves the original upload');
assert.match(panel,/return \{path,thumbPath:savedThumbPath,url:data\.publicUrl\}/,'saved product receives original public URL even without thumbnail');
assert.match(webpMigration,/ARRAY\['image\/jpeg',\s*'image\/png',\s*'image\/webp'\]/,'bucket accepts JPEG, PNG, and WebP');
assert.match(panel,/deleteOldProductPhotoIfUnused\(product\.image,id\)/,'old photo deletion is guarded by usage check');
assert.match(panel,/eq\('image',oldImage\)\.neq\('id',productId\)/,'old image is retained while another product references it');
assert.match(panel,/preparePhotoInput\('sheetPhotoInput','btnPickSheetPhoto','sheet'\)/,'sheet photo picker is wired');
assert.match(panel,/preparePhotoInput\('newProductPhotoInput','btnPickNewProductPhoto','create'\)/,'new product photo picker is wired');
assert.match(panel,/if\(createPendingPhoto\).*uploadProductPhoto/s,'new product uploads photo with product save');
assert.match(panel,/if\(sheetPendingPhoto\).*uploadProductPhoto/s,'product sheet uploads photo with save');

assert.match(uva,/id = 'feiraja_uva_500g'/,'Uva migration targets only confirmed product id');
assert.match(uva,/SET available = false/,'Uva is made unavailable');
assert.match(uva,/\('feiraja_uva_500g', 'kg', 0\.5, 0\.5, 100, true, 0\.5\)/,'Uva uses kg, min/step 0.5 and value sale');
assert.doesNotMatch(uva,/SET price\s*=/i,'Uva price is not modified');
assert.doesNotMatch(uva,/INSERT INTO public\.products|DELETE FROM public\.products/i,'Uva row is not created or deleted');

assert.match(storage,/VALUES \('product-photos', 'product-photos', true, 307200, ARRAY\['image\/jpeg'\]\)/,'original bucket migration remains unchanged and limited to JPEG');
assert.match(storage,/FOR INSERT\s+TO authenticated\s+WITH CHECK \([\s\S]*public\.is_current_user_admin\(\)/,'only admins can upload');
assert.match(storage,/FOR DELETE\s+TO authenticated\s+USING \([\s\S]*public\.is_current_user_admin\(\)/,'only admins can delete');
const selectPolicy=storage.split('CREATE POLICY "product_photos_admin_select"')[1]?.split(';')[0]||'';
assert.ok(selectPolicy.includes('FOR SELECT')&&selectPolicy.includes('TO authenticated')&&selectPolicy.includes("bucket_id = 'product-photos'")&&selectPolicy.includes('public.is_current_user_admin()'),'only admins can SELECT/list object metadata');
assert.ok(!selectPolicy.includes('TO anon'),'anonymous users have no SELECT/list policy');
assert.doesNotMatch(storage,/FOR UPDATE/i,'no overwrite policy is needed for unique upload paths');
assert.match(rollback,/contém arquivos/,'storage rollback protects existing uploaded photos');

console.log('OK: mobile photo upload, compression, admin-only Storage policies, safe old-photo cleanup, and Uva kg rule.');
