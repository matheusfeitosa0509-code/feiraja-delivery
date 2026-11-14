import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel=fs.readFileSync(new URL('../../painel.html',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../migrations/20261115030000_unified_product_sheet_and_confirmed_units.sql',import.meta.url),'utf8');
const rollback=fs.readFileSync(new URL('../rollbacks/20261115030000_unified_product_sheet_and_confirmed_units_rollback.sql',import.meta.url),'utf8');

for(const id of ['unifiedProductSearch','unifiedCategoryFilter','unifiedProductList','productSheet','sheetName','sheetCategory','sheetImage','sheetPrice','sheetResalePrice','sheetCost','sheetProfit','sheetSaleUnit','sheetMin','sheetStep','sheetValueEnabled','sheetValueMin','sheetAvailable']) {
 assert.match(panel,new RegExp('id="'+id+'"'),'unified product UI includes '+id);
}
assert.match(panel,/normalizeProductSearch\(\$\('unifiedProductSearch'\)\.value\)/,'search is accent/case insensitive');
assert.match(panel,/data-quick-availability/,'availability can be changed directly in the list');
assert.match(panel,/data-open-product/,'tapping a product opens its detail sheet');
assert.match(panel,/if\(saleUnit!==product\.sale_unit&&!window\.confirm\('Isso muda como o cliente compra\. Confirmar\?'\)\)/,'sale unit changes require explicit confirmation');
assert.match(panel,/admin_update_product_sales_rule/,'sale unit and quantity rules use the admin RPC');
assert.match(panel,/admin_set_product_cost/,'private product cost uses the existing admin RPC');
assert.match(panel,/Object\.keys\(productChanges\)\.length/,'only changed public product fields are written');
assert.match(panel,/loadCostReport\(\)/,'cost information and report are refreshed after saving');
assert.match(panel,/@media\(max-width:412px\)/,'the product sheet has mobile layout rules');
assert.match(panel,/legacy-product-editor\{display:none!important\}/,'legacy product editing tabs are hidden');
assert.match(panel,/class="card product-section active" id="productRequests"/,'product requests remain a separate report');
assert.match(panel,/class="card product-section active" id="costEditor"/,'profit by period remains a separate report');

for(const id of ['feiraja_camarao_10_gramas','feiraja_camarao_12_grama','feiraja_camarao_maranhao_gg','feiraja_camarao_pelado','feiraja_camarao_tutoia_1kg','feiraja_caranguejo_1kg']) {
 assert.match(migration,new RegExp(id+"','kg',0\\.5,0\\.5,100,true,0\\.5"),'confirmed shrimp/crab kg rule '+id);
}
assert.match(migration,/feiraja_cabeca_de_alho_1kg','kg',0\.25,0\.25,100,true,0\.25/,'garlic minimum and step are 0.25 kg');
assert.match(migration,/feiraja_pimenta_kg/,'pepper minimum is adjusted');
assert.match(migration,/Farinha Branca \(1 kg\)/,'flour names are explicit 1 kg packages');
assert.match(migration,/SET resale_unit='un'/,'package resale thresholds count packages');
assert.match(migration,/CREATE OR REPLACE FUNCTION public\.admin_update_product_sales_rule/,'admin-only sales rule RPC exists');
assert.match(rollback,/DROP FUNCTION IF EXISTS public\.admin_update_product_sales_rule/,'rollback drops the RPC');
assert.doesNotMatch(migration,/UPDATE public\.products SET price\s*=/i,'no product price is modified');
assert.doesNotMatch(migration,/DELETE FROM public\.products/i,'no product is deleted, including unresolved Uva rows');

console.log('OK: unified product sheet, private cost RPC, responsive styles, confirmed unit/minimum rules, unchanged prices and rollback.');
