import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const loja = fs.readFileSync(new URL('../../loja.html', import.meta.url), 'utf8');
const painel = fs.readFileSync(new URL('../../painel.html', import.meta.url), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'missing function ' + name);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('Unclosed function ' + name);
}

const money = value => 'R$ ' + Number(value).toFixed(2).replace('.', ',');
function formatter(source, panel = false) {
  const context = { money };
  if (panel) context.orderItemTotal = (price, quantity, item) =>
    item?.sale_mode === 'value' ? money(Number(item.line_total_cents || item.amount_cents || 0) / 100) :
      money(Number(price || 0) * Number(quantity || 1));
  vm.createContext(context);
  const functions = ['formatOrderQuantity', 'formatOrderItemDescription'].map(name => extractFunction(source, name));
  vm.runInContext(functions.join('\n'), context);
  return context.formatOrderItemDescription;
}

const samples = [
  [{ name: 'Abóbora (kg)', qty: 4, sale_mode: 'kg', price: 3.99 }, 'Abóbora — 4 kg'],
  [{ name: 'Abacate (kg)', qty: 1.251, sale_mode: 'value', amount_cents: 1500, line_total_cents: 1500 }, 'Abacate — R$ 15,00 (~1,25 kg)'],
  [{ name: 'Coco (unidade)', qty: 2 }, 'Coco — 2 un'],
];

for (const [source, label] of [[loja, 'loja'], [painel, 'painel']]) {
  const format = formatter(source, label === 'painel');
  for (const [item, expected] of samples) {
    assert.equal(format(item), expected, label + ': ' + item.name);
  }
}

assert.match(loja, /const cashAtPickup=!String\(paymentMethod\|\|''\)\.toLowerCase\(\)\.includes\('pix'\)/,
  'non-Pix pickup timeline must not include advance-payment steps');
assert.match(loja, /\['Pedido Recebido','Pedido registrado'\],\['Preparando','Separando seus itens'\],\['Pronto para Retirada','Aguardando retirada'\],\['Pedido Concluído','Pago e retirado'\]/,
  'cash timeline must end with paid and picked up');
assert.match(loja, /const refundHelp=isPixPayment\?/,
  'refund explanation must be shown only for Pix orders');
assert.match(loja, /cancelMyOrder\(b\.dataset\.cancelOrder,b,b\.dataset\.cancelPayment==='pix'\)/,
  'cancellation confirmation must receive the payment type');

console.log('OK: kg, value and unit item labels match in store history/repeat and separation panel; cash/Pix timeline and refund copy rules verified.');
