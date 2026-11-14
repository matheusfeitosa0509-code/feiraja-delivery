import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../../loja.html', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../functions/super-worker/index.ts', import.meta.url), 'utf8');
assert.match(html, /id="valueSaleSheet"/, 'value purchase must use a bottom sheet');
assert.match(html, /Mínimo: '\+money\(minimum\/100\)/, 'sheet must display the minimum in reais and kilograms');
assert.match(html, /cartMinimumAdjustedWarning/, 'legacy cart quantities must be adjusted with a warning');
assert.match(html, /select\('product_id,sale_unit,quantity_step,min_quantity,max_quantity,allow_value_sale,value_min_kg'\)/, 'store must load the per-product minimum weight');
assert.match(worker, /value_min_kg/, 'server must read each product minimum weight');
assert.match(worker, /qty \+ 1e-9 < minimumValueSaleKg/, 'server must reject value purchases below the configured weight');

function extract(name) {
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

const ui = {
  tabCartCount:{classList:{toggle(){}}},
  minimumOrderNotice:{classList:{toggle(){}}},
  minimumCheckoutNotice:{classList:{toggle(){}}},
  submitOrder:{classList:{toggle(){}}},
  subtotal:{},total:{},modalTotal:{},
  checkout:{setAttribute(){}},
  cartbarCount:{},cartbarTotal:{},
  cartbar:{classList:{toggle(){}}}
};
const calls = {card:0,fullCatalog:0};
const makeCard=()=>{const qty={innerHTML:''},valueRow={innerHTML:''},note={textContent:'Peso aproximado'},controls={nodeType:1};return{dataset:{productId:'watermelon'},qty,valueRow,note,controls,querySelector(sel){if(sel==='.product-qty')return qty;if(sel==='.value-sale-row')return valueRow;if(sel==='.weight-note')return note;if(sel==='.product-controls')return controls;return null;}};};
const cards=['initial','search','category','home'].map(makeCard);
const product = {id:'watermelon',name:'Melancia',price:19,category:'Frutas'};
const context = {
  products:[product],cart:{},cartModes:{},cartValueCents:{},
  salesRulesById:new Map([['watermelon',{sale_unit:'kg',quantity_step:0.5,min_quantity:1,max_quantity:100,value_min_kg:1,allow_value_sale:true}]]),
  salesSettingsReady:true,minValueSaleCents:0,
  cartStorageWriteWarning:false,cartStorageWriteWarningShown:false,cartRulesWarning:false,cartCatalogRemovedWarning:false,
  MIN_ORDER_AMOUNT:30,category:'Todos',
  money:v=>'R$ '+Number(v).toFixed(2).replace('.',','),
  esc:v=>String(v),
  effectiveUnitPriceCents:()=>1900,
  persistCart(){},
  alert(message){throw new Error(message);},
  syncCartbarVisibility(){},
  renderCart(){calls.fullCatalog++;},
  safeRenderHomeProductSections(){calls.fullCatalog++;},
  renderProducts(){calls.fullCatalog++;},
  document:{querySelectorAll(selector){return selector==='[data-product-id]'?cards:[];}},
  $(id){return ui[id.replace('#','')];}
};
vm.createContext(context);
const names=[
  'salesRuleFor','isValidCartQuantity','quantityStepFor','formatCartQuantity',
  'valueSaleMinimumKg','valueSaleMinimumAmountCents','valueSaleCalculation',
  'formatCartProductLabel','valueSaleEnabled','valueSaleEditorMarkup',
  'valueSaleEditorForm','productQtyMarkup','productCardControlsMarkup','productWeightNoteMarkup','formatValueSaleWeight',
  'updateProductCard','parseValueSaleInput','setCardValueSale','updateCartSummary',
  'add','renderAfterCartChange','change','totals','minimumOrderMessage'
];
vm.runInContext(names.map(extract).join('\n'),context);

// First kg tap is 1 kg; later taps add 0.5 kg. Rapid taps never rebuild rows.
for(let i=0;i<20;i++) context.add('watermelon');
assert.equal(context.cart.watermelon,10.5,'first tap adds 1 kg, then 0.5 kg per tap');
assert.equal(calls.fullCatalog,0,'no whole-catalog render during rapid taps');
assert.ok(cards.every(c=>c.qty.innerHTML.includes('data-card-change')),'all screen variants retain quantity controls');
assert.ok(cards.every(c=>c.note.textContent==='Peso aproximado'),'one static note per kg card');
assert.ok(cards.every(c=>(c.valueRow.innerHTML.match(/Pedir por valor R\$/g)||[]).length===1),'one R$ button per kg card');
assert.ok(cards.every(c=>c.controls.nodeType===1),'controls container is not replaced');
assert.equal(context.isValidCartQuantity(product,0.5,'kg'),false,'0.5 kg is below the new minimum');
assert.equal(context.isValidCartQuantity(product,1,'kg'),true,'1 kg is valid');
assert.equal(context.quantityStepFor(product),0.5);

// The product card contains only the small R$ button; the editor lives in the sheet.
assert.match(context.valueSaleEditorMarkup(product),/>Pedir por valor R\$<\/button>/);
assert.doesNotMatch(context.productQtyMarkup(product),/value-sale-open/,'value button must not squeeze the quantity row');
assert.match(context.productCardControlsMarkup(product),/Pedir por valor R\$/,'value button sits on its own row');
assert.doesNotMatch(context.productCardControlsMarkup(product),/data-value-input|data-value-preset|data-value-add/);
assert.match(context.productCardControlsMarkup(product),/class="value-sale-row"/);
assert.match(context.productWeightNoteMarkup(product),/Peso aproximado/);
assert.equal((context.productCardControlsMarkup(product).match(/Pedir por valor R\$/g)||[]).length,1);
assert.equal(context.formatValueSaleWeight(1.253), '1,25 kg');
const sheet=context.valueSaleEditorForm(product,500);
assert.match(sheet,/Mínimo: R\$ 19,00 \(= 1 kg\)/);
assert.match(sheet,/data-value-preset="watermelon" data-cents="500" disabled/);
assert.match(sheet,/data-cents="1000" disabled/);
assert.match(sheet,/data-cents="2000"/);
assert.equal(context.parseValueSaleInput('R$ 20,00'),2000);
assert.equal(context.valueSaleCalculation(product,1800),null,'less than 1 kg is rejected');
const minCalc=context.valueSaleCalculation(product,1900);
assert.equal(minCalc.qty,1,'R$19 at R$19/kg is exactly 1 kg');
assert.ok(context.setCardValueSale('watermelon',2000));
assert.equal(context.cartModes.watermelon,'value');
assert.equal(context.cart.watermelon,1.053);
assert.match(context.productQtyMarkup(product),/value-amount">R\$ 20,00/);
assert.match(context.productQtyMarkup(product),/value-weight">~1,05 kg/);
assert.match(context.productQtyMarkup(product),/value-qty-label/);
assert.match(context.productQtyMarkup(product),/data-value-open="watermelon"/);
assert.doesNotMatch(context.productCardControlsMarkup(product),/Pedir por valor R\$/,'value mode removes separate R$ button');
assert.equal((context.productQtyMarkup(product).match(/data-value-open=/g)||[]).length,1);
for(let i=0;i<20;i++)context.change('watermelon',1);
assert.equal(context.cartValueCents.watermelon,12000,'20 taps add R$100');
assert.ok(cards.every(c=>c.note.textContent==='Peso aproximado'),'no duplicated note in value mode');
assert.ok(cards.every(c=>(c.qty.innerHTML.match(/data-value-open=/g)||[]).length===1),'exactly one value control per card');
assert.ok(cards.every(c=>c.valueRow.innerHTML===''),'no separate R$ button in value mode');
assert.match(context.valueSaleEditorForm(product,2000),/data-value-remove="watermelon"/);

// In value mode +/- changes by R$5 and cannot fall below the 1 kg minimum.
context.change('watermelon',1);
assert.equal(context.cartValueCents.watermelon,2500);
context.change('watermelon',-1);
assert.equal(context.cartValueCents.watermelon,2000);
context.change('watermelon',-1);
assert.equal(context.cartValueCents.watermelon,2000,'minus cannot go below the per-product minimum');

// Badge counts distinct products, not summed kg + units.
context.products.push({id:'banana',name:'Banana',price:5});
context.cart.banana=3;
context.cart.ghost=4;
context.updateCartSummary();
assert.equal(ui.tabCartCount.textContent,2);
assert.equal(ui.cartbarCount.textContent,'2 produtos');

// Value sale remains hidden unless explicitly enabled.
context.salesRulesById.set('watermelon',{sale_unit:'kg',quantity_step:0.5,min_quantity:1,max_quantity:100,value_min_kg:1,allow_value_sale:false});
assert.equal(context.valueSaleEditorMarkup(product),'');
// Palma products display the commercial unit and never get a kg note or value-sale button.
const banana={id:'banana',name:'Banana (palma)',price:6.99};
context.salesRulesById.set('banana',{sale_unit:'maco',quantity_step:1,min_quantity:1,max_quantity:100,allow_value_sale:false});
context.products.push(banana);
context.cart.banana=1;
assert.equal(context.formatCartQuantity(2,banana),'2 palma');
assert.doesNotMatch(context.productCardControlsMarkup(banana),/Pedir por valor|Peso aproximado/);
assert.match(context.productQtyMarkup(banana),/>1 palma<\/strong>/);

console.log('OK: compact value-sale sheet, 1 kg minimum, 0.5 kg steps, R$5 adjustments, server validation and in-place cart updates.');
