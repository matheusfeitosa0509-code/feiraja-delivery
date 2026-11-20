import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync(new URL('../painel.html', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261120193000_automatic_margin_price_review.sql', import.meta.url), 'utf8');

const tiers = [
  { max: 25, margin: 2 },
  { max: 50, margin: 4 },
  { max: 100, margin: 8 },
  { max: Infinity, margin: 12 },
];
function suggested(balcony) {
  const margin = tiers.find(t => balcony <= t.max).margin;
  return Math.round((Math.ceil((balcony + margin) - 0.99) + 0.99) * 100) / 100;
}

test('margem padrão respeita as quatro faixas e limites', () => {
  assert.equal(suggested(25), 27.99);
  assert.equal(suggested(25.01), 29.99);
  assert.equal(suggested(50), 54.99);
  assert.equal(suggested(50.01), 58.99);
  assert.equal(suggested(100), 108.99);
  assert.equal(suggested(100.01), 112.99);
});

test('preço sugerido arredonda para cima e termina em ,99', () => {
  for (const balcony of [0, 1.25, 5, 7.99, 25, 25.01, 50, 50.01, 100, 100.01, 999.9]) {
    const value = suggested(balcony);
    assert.equal(Math.round(value * 100) % 100, 99);
    assert.ok(value >= balcony + tiers.find(t => balcony <= t.max).margin);
  }
});

test('migration começa com aplicação automática desligada e não altera produtos ao instalar', () => {
  assert.match(migration, /auto_apply boolean NOT NULL DEFAULT false/i);
  assert.match(migration, /INSERT INTO feira_cost_private\.automatic_margin_settings\(settings_key\)[\s\S]*ON CONFLICT \(settings_key\) DO NOTHING/i);
  assert.match(migration, /IF v_product\.old_price IS NOT NULL THEN[\s\S]*Produto em promoção/i);
});

test('RPCs são administrativas e não concedem execução a anon', () => {
  assert.match(migration, /IF auth\.uid\(\) IS NULL OR NOT public\.is_current_user_admin\(\)/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_apply_automatic_price\(text\) FROM PUBLIC,anon/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_apply_all_automatic_prices\(\) FROM PUBLIC,anon/i);
});

test('painel oferece configurações, revisão, manter atual e aplicar em lote', () => {
  for (const text of [
    'Margem automática', 'Aplicar automaticamente sem perguntar', 'Revisar preços',
    'Sem preço de balcão', 'Aplicar a todos', 'Aplicar novo preço', 'Manter atual',
    'admin_get_automatic_price_review', 'admin_apply_all_automatic_prices',
    'afterBalconyPriceSaved'
  ]) assert.ok(panel.includes(text), `painel.html deve conter: ${text}`);
});

test('aplicação automática é chamada após salvar balcão nos editores de preço', () => {
  assert.match(panel, /btnSaveCost[\s\S]*afterBalconyPriceSaved\(productId\)/);
  assert.match(panel, /changedBalcony[\s\S]*afterBalconyPriceSaved\(id\)/);
  assert.match(panel, /orderCostUpdateProduct[\s\S]*afterBalconyPriceSaved\(snapshotProductId\(orderId,itemIndex\)\)/);
  assert.match(panel, /INITIAL_SESSION[\s\S]*loadAutomaticMarginSettings\(\);loadAutomaticPriceReview\(\)/);
});
