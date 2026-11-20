import assert from 'node:assert/strict';
import fs from 'node:fs';

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
console.log('PASS: revenda usa preço privado de balcão, limite 10, toggle administrativo e cálculo servidor.');
