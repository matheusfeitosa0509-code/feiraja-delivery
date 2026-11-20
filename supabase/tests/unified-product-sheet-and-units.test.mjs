import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel=fs.readFileSync(new URL('../../painel.html',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../migrations/20261115030000_unified_product_sheet_and_confirmed_units.sql',import.meta.url),'utf8');
const rollback=fs.readFileSync(new URL('../rollbacks/20261115030000_unified_product_sheet_and_confirmed_units_rollback.sql',import.meta.url),'utf8');
const priceMigration=fs.readFileSync(new URL('../migrations/20261120190000_product_counter_paid_prices.sql',import.meta.url),'utf8');

for(const id of ['unifiedProductSearch','unifiedCategoryFilter','unifiedProductList','productSheet','sheetName','sheetCategory','sheetImage','sheetPrice','sheetResalePrice','sheetBalconyCost','sheetPaidCost','sheetProfit','sheetSaleUnit','sheetMin','sheetStep','sheetValueEnabled','sheetValueMin','sheetAvailable']) {
 assert.match(panel,new RegExp('id="'+id+'"'),'unified product UI includes '+id);
}
assert.match(panel,/normalizeProductSearch\(\$\('unifiedProductSearch'\)\.value\)/,'search is accent/case insensitive');
assert.match(panel,/data-quick-availability/,'availability can be changed directly in the list');
assert.match(panel,/data-open-product/,'tapping a product opens its detail sheet');
assert.match(panel,/if\(mode==='edit'&&saleUnit!==product\.sale_unit&&!\(await appConfirm\('Isso muda como o cliente compra\.'/,'sale unit changes on existing products use the app confirmation modal');
assert.match(panel,/function fillNewProductSheet\(\)/,'new product opens the unified product sheet');
assert.match(panel,/\$\('openNewProduct'\)\.addEventListener\('click',fillNewProductSheet\)/,'add product button is bound to the unified sheet');
assert.match(panel,/admin_create_product_with_sales_rule/,'new product is created through the existing admin RPC');
assert.doesNotMatch(panel,/\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/,'panel must not use native browser dialogs');
assert.match(panel,/admin_update_product_sales_rule/,'sale unit and quantity rules use the admin RPC');
assert.match(panel,/admin_set_product_prices/,'private counter and paid prices use the admin RPC');
assert.doesNotMatch(panel,/id="sheetCost"/,'the old single cost field is replaced by two private price fields');
assert.match(panel,/db\.rpc\('admin_get_cost_report_with_delivery'/,'inline costs continue to come from the administrative report RPC');
assert.match(panel,/window\.__feiraCostProducts/,'inline product cost is sourced from the administrative RPC cache');
assert.match(panel,/unifiedCostFilter/,'products tab filters products without cost');
assert.match(panel,/Sem custo cadastrado \(/,'missing-cost filter shows its product count');
assert.match(panel,/Custo não cadastrado/,'missing costs are not presented as zero');
assert.match(panel,/Lucro real '\+money\(profit\)/,'product rows show actual profit');
assert.match(panel,/Sobre balcão '\+money\(counterProfit\)/,'product rows show profit over counter price');
assert.match(panel,/margin\.toLocaleString\('pt-BR'/,'product row shows margin percentage');
assert.match(panel,/unified-product-cost \'\+marginClass/,'low-margin and below-cost colors are applied to the inline cost summary');
assert.match(panel,/unified-availability\{align-self:start/,'active switch stays aligned to the top beside name and price');
assert.match(panel,/class="no-cost">Custo não cadastrado/,'products without cost retain the Sem custo badge');
assert.match(panel,/Object\.keys\(productChanges\)\.length/,'only changed public product fields are written');
assert.match(panel,/loadCostReport\(\)/,'cost information and report are refreshed after saving');
assert.match(panel,/@media\(max-width:412px\)/,'the product sheet has mobile layout rules');
assert.match(panel,/#priceEditor,#resaleEditor,#productEdit,#productAvailabilityCard\{display:none!important\}/,'legacy product editing tabs are hidden');
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

assert.match(priceMigration,/ADD COLUMN IF NOT EXISTS preco_balcao/,'private counter price column is added');
assert.match(priceMigration,/ADD COLUMN IF NOT EXISTS preco_pago/,'private paid price column is added');
assert.match(priceMigration,/UPDATE feira_cost_private\.product_costs\s+SET preco_balcao = unit_cost/,'legacy cost is copied into counter price');
assert.match(priceMigration,/CREATE TABLE IF NOT EXISTS feira_cost_private\.product_price_history/,'private price history is created');
assert.match(priceMigration,/public\.admin_set_product_prices/,'admin-only dual-price RPC is created');
assert.match(priceMigration,/public\.is_current_user_admin\(\)/,'RPC validates admin authorization');
console.log('OK: unified product sheet, private counter/paid price RPC and history, responsive styles, confirmed unit/minimum rules, unchanged prices and rollback.');
