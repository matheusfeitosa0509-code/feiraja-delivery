import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel = fs.readFileSync('painel.html', 'utf8');
const worker = fs.readFileSync('supabase/functions/super-worker/index.ts', 'utf8');
const assistant = fs.readFileSync('supabase/functions/assistente/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20261118230000_round3_finance_products_mp_off.sql', 'utf8');
const rollback = fs.readFileSync('supabase/rollbacks/20261118230000_round3_finance_products_mp_off_rollback.sql', 'utf8');

assert.match(panel, /admin_get_cost_report_with_delivery/, 'panel uses the delivery-inclusive cost report');
assert.match(panel, /admin_get_low_margin_percent/, 'panel reads margin threshold through admin-only RPC');
assert.match(panel, /calculated_items[\s\S]*total_items/, 'panel shows profit coverage X/Y');
assert.match(panel, /Custo não cadastrado/, 'missing product cost is explicitly labeled');
assert.match(panel, /unifiedCostFilter/, 'products tab has a missing-cost filter');
assert.match(panel, /Sem custo cadastrado \(/, 'missing-cost filter shows a live counter');
assert.match(panel, /Margem baixa/, 'admin product cards show the low-margin badge');
assert.match(panel, /price<0\.50/, 'panel blocks availability below R$ 0.50');
assert.doesNotMatch(panel, /Mercado Pago/i, 'panel has no Mercado Pago option or label');

assert.match(worker, /isLegacyMercadoPagoWebhookNotice/, 'legacy payment notices are detected before processing');
assert.match(worker, /}, 410\)/, 'legacy Mercado Pago webhook responds HTTP 410');
assert.match(worker, /isAsaasPixEnabled/, 'Pix is accepted only when Asaas is enabled');
assert.doesNotMatch(worker, /api\.mercadopago\.com|MERCADO_PAGO_ACCESS_TOKEN|resolveMercadoPagoOrderStatus/i, 'super-worker has no Mercado Pago payment or webhook processing');
assert.match(worker, /payment_provider: "asaas"/, 'new Pix orders are stored as Asaas payments');

assert.match(assistant, /\.from\("products"\)/, 'assistant product names come from the live products table');
assert.match(migration, /COALESCE\(o\.is_test_order, false\) = false/, 'sales dashboard excludes test orders');
assert.match(migration, /admin_get_cost_report_with_delivery/, 'migration extends the delivery-inclusive report');
assert.match(migration, /calculated_items/, 'migration adds calculated item coverage');
assert.match(migration, /NEW\.price < 0\.50/, 'database rejects availability below R$ 0.50');
assert.match(migration, /Defina o preço de venda antes de disponibilizar/, 'database returns the required price message');
assert.match(migration, /Brócolis \(kg\)/, 'migration renames broccoli only');
assert.match(rollback, /Brócolis \(unidade\)/, 'rollback restores the original broccoli name');
assert.match(rollback, /DROP TRIGGER IF EXISTS products_require_minimum_price_before_available/, 'rollback removes the price guard');
assert.match(rollback, /DROP FUNCTION IF EXISTS public\.admin_get_low_margin_percent/, 'rollback removes the admin-only margin RPC');

console.log('Round 3 static checks: financial reports, cost coverage, product safeguards, broccoli label and Mercado Pago shutdown OK.');
