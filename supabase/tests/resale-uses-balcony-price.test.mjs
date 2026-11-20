import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const loja=fs.readFileSync(new URL('../../loja.html',import.meta.url),'utf8');
const panel=fs.readFileSync(new URL('../../painel.html',import.meta.url),'utf8');
const worker=fs.readFileSync(new URL('../functions/super-worker/index.ts',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../migrations/20261120193000_resale_uses_private_balcony_price.sql',import.meta.url),'utf8');

assert.match(migration,/SET resale_price = pc\.preco_balcao/);
assert.match(migration,/resale_enabled = \(pc\.preco_balcao < p\.price\)/);
assert.match(migration,/resale_min_qty = 10/);
assert.match(migration,/service_get_product_resale_prices/);
assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.service_get_product_resale_prices\(text\[\]\) TO service_role/);
assert.match(migration,/REVOKE ALL ON FUNCTION public\.service_get_product_resale_prices\(text\[\]\) FROM PUBLIC, anon, authenticated/);

assert.match(loja,/Revenda a partir de 10/);
assert.match(loja,/Revenda aplicada:/);
assert.match(loja,/function effectiveUnitPriceCents\(p,q\)/);
const effectiveSource=loja.match(/function effectiveUnitPriceCents\(p,q\)\{[^}]+\}/)?.[0];
assert.ok(effectiveSource,'storefront effective price function exists');
const effectivePrice=vm.runInNewContext('('+effectiveSource+')');
const product={price:12.5,resale_enabled:true,resale_price:10};
assert.equal(effectivePrice(product,9),1250,'9 units/kg use normal price');
assert.equal(effectivePrice(product,10),1000,'10 units/kg use exact balcony price');
assert.equal(effectivePrice({...product,resale_enabled:false},10),1250,'disabled resale uses normal price');
assert.equal(effectivePrice({...product,resale_price:null},10),1250,'missing balcony price has no resale');
assert.equal(effectivePrice({...product,resale_price:13},10),1250,'resale above normal price is ignored');
assert.match(panel,/Revenda ativa/);
assert.match(panel,/Revenda indisponível/);
assert.doesNotMatch(panel,/Preço de revenda \(R\$\)/);
assert.doesNotMatch(panel,/Unidade da revenda/);

assert.match(worker,/service_get_product_resale_prices/);
assert.match(worker,/resaleBalconyById/);
assert.match(worker,/qty >= 10/);
assert.match(worker,/effectivePriceCents = selectEffectiveUnitPriceCents/);
assert.match(worker,/quoted\.unit_price_cents === Math\.round\(item\.price \* 100\)/);
assert.match(worker,/quoted\.line_total_cents === item\.line_total_cents/);
assert.match(worker,/price: effectivePriceCents \/ 100/);
assert.doesNotMatch(worker,/Number\(item\.unit_price_cents\)/);
assert.doesNotMatch(worker,/resale_price configurado incorretamente/);
assert.doesNotMatch(migration,/UPDATE public\.orders|UPDATE feira_cost_private\.order_item_snapshots/,'migration does not rewrite historical orders or snapshots');
console.log('PASS: revenda usa preço privado de balcão, limite 10, toggle administrativo e cálculo servidor.');
