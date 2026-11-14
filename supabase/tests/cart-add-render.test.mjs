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

const names = ['salesRuleFor', 'isValidCartQuantity', 'quantityStepFor',
  'add', 'renderAfterCartChange', 'change'];
const calls = { cart: 0, home: 0, products: 0 };
let activePage = 'pageHome';
const context = {
  products: [],
  cart: {},
  cartModes: {},
  cartValueCents: {},
  salesRulesById: new Map(),
  persistCart() {},
  renderCart() { calls.cart++; },
  safeRenderHomeProductSections() { calls.home++; },
  renderProducts() { calls.products++; },
  alert(message) { throw new Error(message); },
  $ (selector) {
    if (selector === '#pageHome') return { classList: { contains: name => name === 'active' && activePage === 'pageHome' } };
    if (selector === '#pageProducts') return { classList: { contains: name => name === 'active' && activePage === 'pageProducts' } };
    throw new Error('Unexpected selector: ' + selector);
  }
};
vm.createContext(context);
vm.runInContext(names.map(extractFunction).join('\n'), context);

function runCase(label, product, rule, expectedQty) {
  context.products = [product];
  context.cart = {};
  context.cartModes = {};
  context.cartValueCents = {};
  context.salesRulesById = new Map(rule ? [[product.id, rule]] : []);
  calls.cart = calls.home = calls.products = 0;
  activePage = 'pageHome';
  context.add(product.id);
  assert.equal(context.cart[product.id], expectedQty, label + ': quantity');
  assert.equal(calls.cart, 1, label + ': cart rendered once');
  assert.equal(calls.home, 1, label + ': active home catalog rendered once');
  assert.equal(calls.products, 0, label + ': hidden product page not rendered');
}

runCase('unit product without a sales rule', { id: 'unit', price: 5 }, null, 1);
runCase('kg product with value sale disabled', { id: 'kg-off', price: 10 },
  { sale_unit: 'kg', quantity_step: 0.5, min_quantity: 0.5, max_quantity: 20, allow_value_sale: false }, 0.5);
runCase('kg product with value sale enabled (default kg mode)', { id: 'kg-on', price: 10 },
  { sale_unit: 'kg', quantity_step: 0.5, min_quantity: 0.5, max_quantity: 20, allow_value_sale: true }, 0.5);

activePage = 'pageProducts';
context.products = [{ id: 'products-page', price: 5 }];
context.cart = {};
context.salesRulesById = new Map();
calls.cart = calls.home = calls.products = 0;
context.add('products-page');
assert.equal(context.cart['products-page'], 1);
assert.equal(calls.cart, 1);
assert.equal(calls.products, 1, 'active products page rendered once');
assert.equal(calls.home, 0, 'hidden home catalog not rendered');

console.log('OK: add-to-cart unit, kg/value-off, kg/value-on; only active catalog rerenders.');
