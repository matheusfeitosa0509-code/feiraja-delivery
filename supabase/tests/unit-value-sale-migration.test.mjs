import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync(new URL('../migrations/20261114190000_value_sale_for_units_and_panel_defaults.sql',import.meta.url),'utf8');
const rollback=fs.readFileSync(new URL('../rollbacks/20261114190000_value_sale_for_units_and_panel_defaults_rollback.sql',import.meta.url),'utf8');
const panel=fs.readFileSync(new URL('../../painel.html',import.meta.url),'utf8');
const store=fs.readFileSync(new URL('../../loja.html',import.meta.url),'utf8');
const shared=fs.readFileSync(new URL('../functions/_shared/sales-rules.js',import.meta.url),'utf8');
const worker=fs.readFileSync(new URL('../functions/super-worker/index.ts',import.meta.url),'utf8');

assert.match(migration,/SET allow_value_sale = true/,'all currently configured units are enabled');
assert.match(migration,/INSERT INTO public\.product_sales_rules/,'products with implicit whole-unit rules receive explicit integer rules');
assert.match(migration,/p_sale_unit NOT IN \('kg', 'un', 'pacote', 'maco', 'duzia'\)/,'new products validate their sale unit');
assert.match(migration,/admin_create_product_with_sales_rule/,'new products are created with a sale rule atomically');
assert.match(migration,/CASE WHEN p_sale_unit = 'kg' THEN 0\.5 ELSE 1 END/,'new kg products use 0.5 kg steps and unit products use whole steps');
assert.match(panel,/admin_create_product_with_sales_rule/,'unified panel uses the atomic product creation RPC');
assert.match(panel,/id="saleUnit"/,'panel lets the administrator choose the real sale unit');
assert.match(panel,/p\.sale_unit==='kg'\?/,'panel shows kg minimum only for kg products');
assert.match(store,/function unitValueSaleChoices/,'store calculates whole-unit choices from entered value');
assert.match(store,/effectiveUnitPriceCents\(product,qty\)/,'unit value choices honor the resale price threshold');
assert.match(store,/data-unit-value-choice/,'unit value choices add integer quantities');
assert.match(store,/halfKgCents=Math\.ceil/,'kg value +/- is based on half a kilo rounded up to R$1');
assert.match(store,/function convertValueSaleToKg/,'kg switch converts approximate weight to the next valid half-kilo step');
assert.match(shared,/return !!rule && rule\.sale_unit === "kg" && rule\.allow_value_sale === true;/,'shared server validator remains kg-only');
assert.match(worker,/sale_mode: saleMode/,'normal unit orders keep the existing worker payload');
assert.match(rollback,/DROP FUNCTION IF EXISTS public\.admin_create_product_with_sales_rule/,'rollback removes the new product RPC');
assert.match(rollback,/feiraja_abacate.*feiraja_abobora.*feiraja_abobrinha/s,'rollback restores only the three previously enabled kg products');

console.log('OK: unit value helper, resale threshold, kg value steps, safe worker compatibility, new-product defaults and rollback.');
