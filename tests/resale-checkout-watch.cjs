const fs = require('node:fs');
const assert = require('node:assert/strict');

const worker = fs.readFileSync('supabase/functions/super-worker/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20261121180000_robust_service_role_rpc_identity.sql', 'utf8');

const lookupStart = worker.indexOf('db.rpc("service_get_product_resale_prices"');
assert.notEqual(lookupStart, -1, 'checkout must query the private resale-price RPC');
const lookupEnd = worker.indexOf('const resaleBalconyById', lookupStart);
const lookupBlock = worker.slice(lookupStart, lookupEnd);
assert.match(lookupBlock, /RESALE_BALCONY_LOOKUP_FAILED/, 'failed resale lookup must be logged');
assert.match(lookupBlock, /admin_alerts.*insert|from\("admin_alerts"\)\.insert/s, 'failed resale lookup must create an admin alert');
assert.doesNotMatch(lookupBlock, /return json\(\{ error: .*503\)/, 'failed resale lookup must not block checkout');

const pricingStart = worker.indexOf('const resaleBalconyById');
const pricingEnd = worker.indexOf('const { data: salesRules', pricingStart);
assert.notEqual(pricingStart, -1);
assert.notEqual(pricingEnd, -1);
assert.match(worker.slice(pricingStart, pricingEnd), /resaleBalconyPrices \|\| \[\]/, 'missing verified balcony prices must produce an empty map and retail pricing');

assert.match(migration, /request\.jwt\.claims/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.service_get_product_resale_prices\(text\[\]\)[\s\S]*FROM PUBLIC, anon, authenticated/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.service_get_product_resale_prices\(text\[\]\)[\s\S]*TO service_role/);
console.log('PASSOU | vigia revenda | falha da consulta não bloqueia checkout; alerta administrativo e ACL restrita verificados.');
