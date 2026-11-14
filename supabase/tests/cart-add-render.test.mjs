import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../../loja.html', import.meta.url), 'utf8');
function extractFunction(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'missing function ' + name);
  const open = html.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '{') depth++;
    if (html[i] === '}') {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error('Unclosed function ' + name);
}

const calls = { card: 0, summary: 0, fullRender: 0 };
const context = {
  products: [], cart: {}, cartModes: {}, cartValueCents: {},
  salesRulesById: new Map(),
  persistCart() {}, updateProductCard() { calls.card++; },
  updateCartSummary() { calls.summary++; },
  renderCart() { calls.fullRender++; },
  alert(message) { throw new Error(message); },
  $() { return undefined; }
};
vm.createContext(context);
vm.runInContext(['salesRuleFor','isValidCartQuantity','quantityStepFor','add','renderAfterCartChange','change'].map(extractFunction).join('\n'), context);

function runCase(label, product, rule, expectedQty) {
  context.products = [product];
  context.cart = {}; context.cartModes = {}; context.cartValueCents = {};
  context.salesRulesById = new Map(rule ? [[product.id, rule]] : []);
  calls.card = calls.summary = calls.fullRender = 0;
  context.add(product.id);
  assert.equal(context.cart[product.id], expectedQty, label + ': quantity');
  assert.equal(calls.card, 1, label + ': only affected card updated');
  assert.equal(calls.summary, 1, label + ': cart summary updated');
  assert.equal(calls.fullRender, 0, label + ': no catalog/cart reconstruction');
}

runCase('unit product without a sales rule', { id: 'unit', price: 5 }, null, 1);
runCase('kg product with value sale disabled', { id: 'kg-off', price: 10 },
  { sale_unit: 'kg', quantity_step: 0.5, min_quantity: 0.5, max_quantity: 20, allow_value_sale: false }, 0.5);
runCase('kg product with value sale enabled (default kg mode)', { id: 'kg-on', price: 10 },
  { sale_unit: 'kg', quantity_step: 0.5, min_quantity: 0.5, max_quantity: 20, allow_value_sale: true }, 0.5);

console.log('OK: unit, kg/value-off and kg/value-on update only one card and cart summary.');

const renderCart = extractFunction('renderCart');
const updateCartSummary = extractFunction('updateCartSummary');
const setCartEmptyState = extractFunction('setCartEmptyState');
const showAppPage = extractFunction('showAppPage');
assert.match(showAppPage, /if\(page==='Cart'\)renderCart\(\)/,
  'opening Cart through app navigation must rebuild cart items');
assert.match(showAppPage, /if\(page==='Home'\).*renderProducts\(\);safeRenderHomeProductSections\(\)/,
  'opening Products must refresh product, search and category views');
assert.match(showAppPage, /if\(page==='Orders'\)void loadMyOrders\(\)/,
  'opening Orders must refresh order history');
assert.match(setCartEmptyState, /#cartPanel \\.sum/);
assert.match(setCartEmptyState, /#pageCart \\.cart-footer/);
assert.match(updateCartSummary, /setCartEmptyState\(count\)/,
  'removing/clearing the last item must hide totals and Continue immediately');
assert.match(renderCart, /setCartEmptyState\(count\)/,
  'rendering an empty cart must hide totals and Continue');
assert.match(renderCart, /Sua sacola está vazia/,
  'empty cart must show the empty-state message');
console.log('OK: cart navigation refresh, empty-state visibility, Products/search/categories and Orders refresh.');
