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
  document:{querySelectorAll(){return [{dataset:{productId:'watermelon'},querySelector(){return {set innerHTML(value){calls.card++;}}}}];}},
  $(id){return ui[id.replace('#','')];}
};
vm.createContext(context);
const names=[
  'salesRuleFor','isValidCartQuantity','quantityStepFor','formatCartQuantity',
  'valueSaleMinimumKg','valueSaleMinimumAmountCents','valueSaleCalculation',
  'formatCartProductLabel','valueSaleEnabled','valueSaleEditorMarkup',
  'valueSaleEditorForm','productQtyMarkup','productCardControlsMarkup',
  'updateProductCard','parseValueSaleInput','setCardValueSale','updateCartSummary',
  'add','renderAfterCartChange','change','totals','minimumOrderMessage'
];
vm.runInContext(names.map(extract).join('\n'),context);

// First kg tap is 1 kg; later taps add 0.5 kg. Rapid taps never rebuild rows.
for(let i=0;i<20;i++) context.add('watermelon');
assert.equal(context.cart.watermelon,10.5,'first tap adds 1 kg, then 0.5 kg per tap');
assert.equal(calls.fullCatalog,0,'no whole-catalog render during rapid taps');
assert.ok(calls.card>=20,'only the affected product card is updated');
assert.equal(context.isValidCartQuantity(product,0.5,'kg'),false,'0.5 kg is below the new minimum');
assert.equal(context.isValidCartQuantity(product,1,'kg'),true,'1 kg is valid');
assert.equal(context.quantityStepFor(product),0.5);

// The product card contains only the small R$ button; the editor lives in the sheet.
assert.match(context.valueSaleEditorMarkup(product),/>R\$<\/button>/);
assert.doesNotMatch(context.productCardControlsMarkup(product),/data-value-input|data-value-preset|data-value-add/);
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
assert.match(context.productQtyMarkup(product),/R\$ 20,00 \(~1,053 kg\)/);
assert.match(context.productQtyMarkup(product),/data-value-open="watermelon"/);
assert.doesNotMatch(context.productQtyMarkup(product),/class="value-sale-open"/,'value-mode card should not repeat the R$ button');
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

console.log('OK: compact value-sale sheet, 1 kg minimum, 0.5 kg steps, R$5 adjustments, server validation and in-place cart updates.');
