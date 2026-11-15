import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const panel=fs.readFileSync(new URL('../../painel.html',import.meta.url),'utf8');
const store=fs.readFileSync(new URL('../../loja.html',import.meta.url),'utf8');
const worker=fs.readFileSync(new URL('../functions/super-worker/index.ts',import.meta.url),'utf8');
const manifest=fs.readFileSync(new URL('../../manifest-painel.json',import.meta.url),'utf8');
const serviceWorker=fs.readFileSync(new URL('../../sw.js',import.meta.url),'utf8');
const pages=fs.readFileSync(new URL('../../.github/workflows/pages.yml',import.meta.url),'utf8');
const cadastro=fs.readFileSync(new URL('../../cadastro-produto.html',import.meta.url),'utf8');
const trackingMigration=fs.readFileSync(new URL('../migrations/20261115230000_lalamove_tracking_rate_limit.sql',import.meta.url),'utf8');

function extractFrom(source,name){
  const start=source.indexOf('function '+name+'(');
  assert.notEqual(start,-1,'missing function '+name);
  const open=source.indexOf('{',start);
  let depth=0;
  for(let i=open;i<source.length;i++){
    if(source[i]==='{')depth++;
    if(source[i]==='}'){
      depth--;
      if(depth===0)return source.slice(start,i+1);
    }
  }
  throw new Error('Unclosed function '+name);
}

function extract(name){
  const start=panel.indexOf('function '+name+'(');
  assert.notEqual(start,-1,'missing function '+name);
  const open=panel.indexOf('{',start);
  let depth=0;
  for(let i=open;i<panel.length;i++){
    if(panel[i]==='{')depth++;
    if(panel[i]==='}'){
      depth--;
      if(depth===0)return panel.slice(start,i+1);
    }
  }
  throw new Error('Unclosed function '+name);
}
const context={
  money:value=>'R$ '+Number(value).toFixed(2).replace('.',','),
  formatOrderQuantity:value=>Number(value).toLocaleString('pt-BR',{maximumFractionDigits:2})
};
vm.createContext(context);
vm.runInContext(['formatOrderQuantity','orderItemTotal','formatOrderItemDescription'].map(extract).join('\n'),context);

const valueItem={name:'Abóbora',price:3.99,qty:6.89,sale_mode:'value',amount_cents:2750,line_total_cents:2750};
assert.equal(context.formatOrderItemDescription(valueItem),'Abóbora — R$ 27,50 (~6,89 kg)');
assert.equal(context.orderItemTotal(valueItem.price,valueItem.qty,valueItem),'R$ 27,50');
const normalItem={name:'Banana (palma)',price:6.99,qty:2};
assert.equal(context.formatOrderItemDescription(normalItem),'Banana (palma) × 2');
assert.equal(context.orderItemTotal(normalItem.price,normalItem.qty,normalItem),'R$ 13,98');
assert.match(panel,/formatOrderItemDescription\(i\)/,'separation checklist uses the value-aware item label');
assert.match(worker,/sale_mode: saleMode/,'worker keeps the existing sale mode snapshot');
assert.match(worker,/line_total_cents: lineTotalCents/,'worker already saves the exact line total');
assert.match(worker,/amount_cents: amountCents/,'worker already saves the entered value for kg purchases');

assert.match(manifest,/"start_url": "\/painel.html"/,'installed admin PWA opens painel.html');
assert.match(serviceWorker,/requestedUrl === '\/painel.html'/,'service worker routes installed admin requests to painel.html');
assert.doesNotMatch(pages,/painel-novo\.html/,'Pages no longer publishes a second panel file');
assert.match(cadastro,/url=https:\/\/www\.feiraondelivery\.com\.br\/painel\.html/,'legacy product-registration URL redirects to the unified panel');

const storeContext={money:context.money};
vm.createContext(storeContext);
vm.runInContext(['formatOrderQuantity','formatOrderItemDescription'].map(name=>extractFrom(store,name)).join('\n'),storeContext);
const displayCases=[
  [{name:'Abóbora (kg)',price:3.99,qty:4,sale_mode:'kg'},'Abóbora — 4 kg'],
  [{name:'Abacate (kg)',price:11.99,qty:1.251,sale_mode:'value',amount_cents:1500,line_total_cents:1500},'Abacate — R$ 15,00 (~1,25 kg)'],
  [{name:'Coco (un)',price:8,qty:2},'Coco — 2 un'],
  [{name:'Coco (un)',price:8,qty:4,unit:'kg'},'Coco — 4 un'],
  [{name:'Cheiro-verde (maço)',price:3,qty:2},'Cheiro-verde — 2 maço'],
  [{name:'Farinha (pacote)',price:7,qty:3},'Farinha — 3 pacote'],
  [{name:'Laranja',price:2,qty:4,sale_mode:'unit',unit:'kg'},'Laranja — 4 un']
];
for(const [item,expected] of displayCases){
  assert.equal(context.formatOrderItemDescription(item),expected,'panel label: '+item.name);
  assert.equal(storeContext.formatOrderItemDescription(item),expected,'store label: '+item.name);
}
assert.match(store,/const cashAtPickup=method\.includes\('dinheiro'\)\|\|method\.includes\('cart'\)/,'cash/card at pickup uses the cash timeline');
assert.match(store,/steps=delivery\?\[\['Pago','💳'\],\['Preparando','📦'\],\['Caminho','🛵'\],\['Entregue','✓'\]\]:\[\['Pago','💳'\],\['Preparando','📦'\],\['Pronto','✓'\],\['Retirado','✓'\]\]/,'pickup and delivery use the exact four requested timeline stages');
assert.match(store,/const paid=cashAtPickup\?\['Pedido Concluído','Entregue'\]\.includes\(status\):/,'cash pickup only marks Pago complete after pickup');
assert.match(store,/const refundHelp=isPixPayment\?/,'refund explanation is limited to Pix orders');
assert.match(store,/cancelMyOrder\(b\.dataset\.cancelOrder,b,b\.dataset\.cancelPayment==='pix'\)/,'cancellation confirmation receives the payment type');

console.log('OK: value-mode order line, kg/unit labels, cash/Pix timeline and unified panel display verified.');
