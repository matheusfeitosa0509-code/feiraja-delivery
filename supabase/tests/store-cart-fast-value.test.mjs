import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../../loja.html', import.meta.url), 'utf8');
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

const ui = { tabCartCount:{classList:{toggle(){}}}, minimumOrderNotice:{classList:{toggle(){}}}, minimumCheckoutNotice:{classList:{toggle(){}}}, submitOrder:{classList:{toggle(){}}}, subtotal:{}, total:{}, modalTotal:{}, checkout:{setAttribute(){}}, cartbarCount:{}, cartbarTotal:{}, cartbar:{classList:{toggle(){}}} };
const calls = { card:0, summary:0, fullCatalog:0 };
const product = {id:'watermelon',name:'Melancia',price:19,category:'Frutas'};
const context = {
  products:[product], cart:{}, cartModes:{}, cartValueCents:{}, salesRulesById:new Map([['watermelon',{sale_unit:'kg',quantity_step:0.5,min_quantity:0.5,max_quantity:100,allow_value_sale:true}]]),
  salesSettingsReady:true,minValueSaleCents:500,cartStorageWriteWarning:false,cartStorageWriteWarningShown:false,cartRulesWarning:false,cartCatalogRemovedWarning:false,
  MIN_ORDER_AMOUNT:30, category:'Todos',
  money:v=>'R$ '+Number(v).toFixed(2).replace('.',','),esc:v=>String(v),
  effectiveUnitPriceCents:()=>1900,persistCart(){},alert(message){throw new Error(message);},
  syncCartbarVisibility(){},renderCart(){calls.fullCatalog++;},safeRenderHomeProductSections(){calls.fullCatalog++;},renderProducts(){calls.fullCatalog++;},
  document:{querySelectorAll(){return [{dataset:{productId:'watermelon'},querySelector(sel){return {set innerHTML(v){calls.card++;}}} }];}},
  $(id){return ui[id.replace('#','')];}
};
vm.createContext(context);
const names=['salesRuleFor','isValidCartQuantity','quantityStepFor','formatCartQuantity','valueSaleCalculation','formatCartProductLabel','valueSaleEnabled','valueSaleEditorMarkup','valueSaleEditorForm','productQtyMarkup','productCardControlsMarkup','updateProductCard','parseValueSaleInput','setCardValueSale','updateCartSummary','add','renderAfterCartChange','change','totals','minimumOrderMessage'];
vm.runInContext(names.map(extract).join('\n'),context);

// Rapid taps: 20 increments must update only the product card and summary,
// never reconstruct home rows, the catalog grid, or any category scroller.
for(let i=0;i<20;i++) context.add('watermelon');
assert.equal(context.cart.watermelon,10,'20 taps at 0.5 kg must total 10 kg');
assert.equal(calls.fullCatalog,0,'no whole-catalog render during rapid taps');
assert.ok(calls.card>=20,'the affected card is updated');
assert.equal(Object.keys(context.cart).length,1);

// The inline card must expose the value-buy UI only when explicitly enabled.
const cardMarkup=context.valueSaleEditorMarkup(product);
assert.match(cardMarkup,/Quero R\$ ___/);
assert.match(cardMarkup,/data-value-preset/);
assert.match(cardMarkup,/R\$ 5/);
assert.equal(context.parseValueSaleInput('R$ 10,00'),1000);
const calc=context.valueSaleCalculation(product,1000);
assert.equal(calc.qty,0.526,'R$10 at R$19/kg should preview about 0.526 kg');
assert.ok(context.setCardValueSale('watermelon',1000));
assert.equal(context.cartModes.watermelon,'value');
assert.equal(context.cart.watermelon,0.526);
assert.match(context.valueSaleEditorMarkup(product),/Alterar valor/);
assert.match(context.valueSaleEditorMarkup(product),/Remover/);

// In value mode cart +/- changes money in R$5 steps, not kilograms.
context.change('watermelon',1);
assert.equal(context.cartValueCents.watermelon,1500);
assert.equal(context.cart.watermelon,0.789);
context.change('watermelon',-1);
assert.equal(context.cartValueCents.watermelon,1000);
context.change('watermelon',-1);
assert.equal(context.cartValueCents.watermelon,500,'minus reduces R$5 to the minimum');
context.change('watermelon',-1);
assert.equal(context.cartValueCents.watermelon,500,'minus cannot go below R$5');

// Badge counts distinct products, not summed kg + units.
context.products.push({id:'banana',name:'Banana',price:5});
context.cart.banana=3;
context.updateCartSummary();
assert.equal(ui.tabCartCount.textContent,2);
assert.equal(ui.cartbarCount.textContent,'2 produtos');

// Disabled value sale is never shown.
context.salesRulesById.set('watermelon',{sale_unit:'kg',quantity_step:0.5,min_quantity:0.5,max_quantity:100,allow_value_sale:false});
assert.equal(context.valueSaleEditorMarkup(product),'');

console.log('OK: 20 rapid taps; no catalog rebuild; value sale card, R$5 steps/minimum; distinct-product badge.');
