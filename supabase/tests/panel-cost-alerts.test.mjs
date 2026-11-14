import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel=fs.readFileSync(new URL('../../painel-novo.html',import.meta.url),'utf8');
const store=fs.readFileSync(new URL('../../loja.html',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../migrations/20261115010000_kg_minimums_and_cost_margin.sql',import.meta.url),'utf8');
const rollback=fs.readFileSync(new URL('../rollbacks/20261115010000_kg_minimums_and_cost_margin_rollback.sql',import.meta.url),'utf8');

assert.match(panel,/value_min_kg/,'admin panel loads each product value minimum');
assert.match(panel,/admin_set_product_value_minimum/,'admin panel saves each product minimum');
assert.match(panel,/id="costMarginThreshold"/,'cost margin alert percentage is adjustable');
assert.match(panel,/admin_set_low_margin_percent/,'cost margin threshold is persisted');
assert.match(panel,/updated_at/,'cost report reads the last cost update date');
assert.match(panel,/7\*24\*60\*60\*1000/,'costs older than seven days are highlighted');
assert.match(panel,/below-cost/,'selling below cost has a red state');
assert.match(panel,/low-margin/,'low margin has an orange state');
assert.match(panel,/stale/,'stale cost has a yellow state');
assert.match(panel,/Lucro estimado \(pelo custo cadastrado\)/,'profit summary is labeled as estimated');

assert.match(store,/aspect-ratio:1\/1/,'product image box is square');
assert.match(store,/@media\(max-width:412px\)/,'compact cards include phone-width rules');
assert.match(store,/id="valueSaleSheet"/,'value purchase is a bottom sheet');
assert.match(store,/Peso aproximado: pode variar um pouco na separação\./,'weight estimate disclaimer is shown');

assert.match(migration,/SET min_quantity = 1/,'all kg sales rules receive a 1 kg minimum');
assert.match(migration,/SET quantity_step = 0\.5/,'kg sales keep half-kilogram increments');
assert.match(migration,/value_min_kg numeric.*DEFAULT 1/s,'per-product value-sale minimum defaults to 1 kg');
assert.match(rollback,/DROP COLUMN IF EXISTS value_min_kg/,'rollback removes the new value minimum');
assert.match(rollback,/SET min_quantity = 0\.5/,'rollback restores the previous 0.5 kg minimum');

console.log('OK: cost freshness, margin alerts, estimated-profit label, compact phone cards, per-product kg minimums and rollback.');
