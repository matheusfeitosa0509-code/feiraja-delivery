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
  const syncStart=html.indexOf('function '+name+'('),asyncStart=html.indexOf('async function '+name+'(');
  const start=asyncStart>=0&&(syncStart<0||asyncStart<syncStart)?asyncStart:syncStart;
  assert.notEqual(start,-1,'missing function '+name);
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
  checkout:{setAttribute(){},classList:{toggle(){}},textContent:'',disabled:false},
  cartMinimumProgress:{classList:{toggle(){}}},cartMinimumProgressFill:{style:{}},
  cartbarCount:{},cartbarTotal:{},
  cartbar:{classList:{toggle(){},contains(){return false;}}},
  cartUndoToast:{hidden:true,style:{}},cartUndoMessage:{textContent:''},cartUndoAction:{hidden:true}
};
const calls = {card:0,fullCatalog:0};
let confirmAnswer=false;const confirmMessages=[];const timeoutCalls=[];
const makeCard=()=>{const qty={innerHTML:''},valueRow={innerHTML:''},note={textContent:'Peso aproximado'},controls={nodeType:1};return{dataset:{productId:'watermelon'},qty,valueRow,note,controls,noteCount:1,controlCount:1,querySelector(sel){if(sel==='.product-qty')return qty;if(sel==='.value-sale-row')return valueRow;if(sel==='.weight-note')return note;if(sel==='.product-controls')return controls;return null;}};};
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
  effectiveUnitPriceCents(p,q){const normal=Math.round(Number(p.price)*100),resale=Math.round(Number(p.resale_price)*100),min=Number(p.resale_min_qty);return p.resale_enabled===true&&Number.isInteger(min)&&min>=1&&q>=min&&Number.isSafeInteger(resale)&&resale>0&&resale<=normal?resale:normal;},
  persistCart(){},
  closeValueSaleSheet(){},
  showStoreConfirm:async(...args)=>{confirmMessages.push(args);return confirmAnswer;},
  setTimeout(fn,ms){timeoutCalls.push(ms);return timeoutCalls.length;},clearTimeout(){},
  syncCartbarVisibility(){},
  setCartEmptyState(){},
  renderCart(){calls.fullCatalog++;},
  safeRenderHomeProductSections(){calls.fullCatalog++;},
  renderProducts(){calls.fullCatalog++;},
  document:{querySelectorAll(selector){return selector==='[data-product-id]'?cards:[];}},
  $(id){return ui[id.replace('#','')];}
};
vm.createContext(context);
const names=[
  'salesRuleFor','isValidCartQuantity','quantityStepFor','formatCartQuantity','effectiveUnitPriceCents','hasVisiblePromotion','priceBlock',
  'valueSaleMinimumKg','valueSaleMinimumAmountCents','valueSaleCalculation',
  'unitSaleLabel','formatUnitSaleQuantity','unitValueSaleChoices','unitValueSalePreviewMarkup','unitValueSaleEditorForm','setUnitValueQuantity','convertValueSaleToKg',
  'formatCartProductLabel','valueSaleEnabled','valueSaleEditorMarkup','cartPriceMarkup','normalizeLegacyCartItem','positionCartToast','showStoreNotice','showCartUndo','undoCartAction','removeCartItem','confirmRemoveCartItem','clearCart',
  'valueSaleEditorForm','productQtyMarkup','productCardControlsMarkup','productWeightNoteMarkup','formatValueSaleWeight',
  'updateProductCard','parseValueSaleInput','setCardValueSale','updateCartSummary',
  'add','renderAfterCartChange','change','setSaleMode','cartSaleModeControl','totals','minimumOrderMessage'
];
vm.runInContext(names.map(extract).join('\n'),context);

assert.match(context.cartPriceMarkup({price:10,old_price:12}),/cart-price-old">R\$ 12,00/);
assert.match(context.cartPriceMarkup({price:10,old_price:12}),/cart-price-current promo">R\$ 10,00/);
assert.match(context.cartPriceMarkup({price:10,old_price:12}),/cart-discount-badge">-17%/);
assert.match(context.cartPriceMarkup({price:10}),/cart-price-current">R\$ 10,00/);
for(const p of [{price:9.99,old_price:10,name:'Farinha Branca'},{price:9.99,old_price:10,name:'Coco'},{price:44.99,old_price:45,name:'Couve-flor'}]){assert.equal(context.hasVisiblePromotion(p),false,p.name+' must not show a sub-5% promotion');assert.doesNotMatch(context.priceBlock(p),/pct-badge|price-old|price-promo/);assert.doesNotMatch(context.cartPriceMarkup(p),/cart-price-old|cart-discount-badge|promo/);}
assert.equal(context.hasVisiblePromotion({price:9.5,old_price:10}),true,'exactly 5% remains a promotion');
assert.match(context.priceBlock({price:9.5,old_price:10}),/pct-badge">-5%/);

// First kg tap is 1 kg; later taps add 0.5 kg. Rapid taps never rebuild rows.
for(let i=0;i<20;i++) context.add('watermelon');
assert.equal(context.cart.watermelon,10.5,'first tap adds 1 kg, then 0.5 kg per tap');
assert.equal(calls.fullCatalog,0,'no whole-catalog render during rapid taps');
assert.ok(cards.every(c=>c.qty.innerHTML.includes('data-card-change')),'all screen variants retain quantity controls');
assert.ok(cards.every(c=>c.note.textContent==='Peso aproximado'&&c.noteCount===1),'exactly one static note per kg card');
assert.ok(cards.every(c=>(c.valueRow.innerHTML.match(/Pedir por valor R\$/g)||[]).length===1),'one R$ button per kg card');
assert.ok(cards.every(c=>c.controls.nodeType===1&&c.controlCount===1),'exactly one controls container per card; it is not replaced');
assert.doesNotMatch(extract('updateProductCard'),/addEventListener|outerHTML|insertAdjacentHTML/,'updates do not add listeners or append new DOM elements');
assert.equal((html.match(/root\.addEventListener\('click'/g)||[]).length,1,'one delegated click listener handles all product cards');
assert.equal(context.isValidCartQuantity(product,0.5,'kg'),false,'0.5 kg is below the new minimum');
assert.equal(context.isValidCartQuantity(product,1,'kg'),true,'1 kg is valid');
assert.equal(context.quantityStepFor(product),0.5);

// Promotion prices use the requested colors in cards and in the cart.
assert.match(html,/function priceBlock\(p\)/,'initial, search and category cards share the price renderer');
assert.match(html,/\.product \.price:not\(\.price-promo\).*color:#202820!important/,'normal selling price is dark');
assert.match(html,/\.product \.price\.price-promo\{color:#28743b!important\}/,'promotion price is green');
assert.match(html,/\.pct-badge\{[^}]*background:#ed7d16;color:#fff/,'discount badge is orange with white text');
assert.match(html,/function cartPriceMarkup\(p\)/,'cart has a dedicated price renderer');
assert.match(html,/class="cart-price-line"[^>]*>\'\+cartPriceMarkup\(x\.p\)/,'cart renders the promotion price line');

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
assert.match(context.productCardControlsMarkup(product),/Pedir por kg/,'value mode keeps the bottom switch button visible');
assert.equal((context.productQtyMarkup(product).match(/data-value-open=/g)||[]).length,1);
for(let i=0;i<20;i++)context.change('watermelon',1);
assert.equal(context.cartValueCents.watermelon,22000,'20 taps add the price-rounded value equivalent to 10 kg');
assert.ok(cards.every(c=>c.note.textContent==='Peso aproximado'&&c.noteCount===1),'no duplicated note in value mode');
assert.ok(cards.every(c=>(c.qty.innerHTML.match(/data-value-open=/g)||[]).length===1),'exactly one value control per card');
assert.ok(cards.every(c=>c.valueRow.innerHTML.includes('Pedir por kg')&&c.controlCount===1&&c.noteCount===1),'exactly one kg switch button and no duplicate elements in value mode');
context.cartValueCents.watermelon=2000;
context.updateProductCard('watermelon');
assert.match(context.valueSaleEditorForm(product,2000),/data-value-remove="watermelon"/);

// In value mode +/- uses half a kilogram rounded up to the next whole real.
context.change('watermelon',1);
assert.equal(context.cartValueCents.watermelon,3000,'R$19/kg uses a R$10 step');
context.change('watermelon',-1);
assert.equal(context.cartValueCents.watermelon,2000);
context.change('watermelon',-1);
assert.equal(context.cart.watermelon,undefined,'value-mode decrement below minimum removes immediately');
assert.equal(ui.cartUndoMessage.textContent,'Melancia removido');assert.equal(ui.cartUndoAction.hidden,false);
assert.ok(timeoutCalls.includes(5000),'undo notice lasts five seconds');assert.match(ui.cartUndoToast.style.bottom,/72px/,'toast sits above visible cart bar');
context.undoCartAction();assert.equal(context.cartValueCents.watermelon,2000,'undo restores the exact value amount');assert.equal(context.cartModes.watermelon,'value');assert.equal(context.cart.watermelon,1.053);
const zucchini={id:'zucchini',name:'Abobrinha (kg)',price:3.99};
context.products.push(zucchini);
context.salesRulesById.set('zucchini',{sale_unit:'kg',quantity_step:0.5,min_quantity:1,max_quantity:100,value_min_kg:1,allow_value_sale:true});
context.cart.zucchini=1;context.cartModes.zucchini='value';context.cartValueCents.zucchini=399;
context.change('zucchini',1);
assert.equal(context.cartValueCents.zucchini,599,'R$3.99/kg rounds half-kilo step up to R$2');
const avocado={id:'avocado',name:'Abacate (kg)',price:11.99};
context.products.push(avocado);
context.salesRulesById.set('avocado',{sale_unit:'kg',quantity_step:0.5,min_quantity:1,max_quantity:100,value_min_kg:1,allow_value_sale:true});
context.cart.avocado=6.89;context.cartModes.avocado='value';context.cartValueCents.avocado=2750;
assert.match(context.valueSaleEditorMarkup(avocado),/data-value-to-kg="avocado"[^>]*>Pedir por kg/);
assert.ok(context.convertValueSaleToKg('avocado'));
assert.equal(context.cart.avocado,7,'switching to kg rounds 6.89 kg up to the next 0.5 kg step');
assert.equal(context.cartModes.avocado,undefined);
context.cart.avocado=1;context.cartModes.avocado=undefined;context.change('avocado',-1);
assert.equal(context.cart.avocado,undefined,'kg decrement at minimum removes immediately');
context.undoCartAction();assert.equal(context.cart.avocado,1,'undo restores kg quantity');

// Badge counts distinct products, not summed kg + units.
context.cart.watermelon=1;context.cart.avocado=1;
context.products.push({id:'banana',name:'Banana',price:5});
context.cart.banana=3;
context.cart.ghost=4;
context.updateCartSummary();
assert.equal(ui.tabCartCount.textContent,4);
assert.equal(ui.cartbarCount.textContent,'4 produtos');

// Value sale remains hidden unless explicitly enabled.
context.salesRulesById.set('watermelon',{sale_unit:'kg',quantity_step:0.5,min_quantity:1,max_quantity:100,value_min_kg:1,allow_value_sale:false});
assert.equal(context.valueSaleEditorMarkup(product),'');
// Palma products keep integer cart quantities but receive the value helper.
const banana={id:'banana',name:'Banana (palma)',price:6.99};
context.salesRulesById.set('banana',{sale_unit:'maco',quantity_step:1,min_quantity:1,max_quantity:100,allow_value_sale:true});
context.products.push(banana);
context.cart.banana=1;
assert.equal(context.formatCartQuantity(2,banana),'2 palma');
assert.match(context.productCardControlsMarkup(banana),/Pedir por valor R\$/);
assert.doesNotMatch(context.productWeightNoteMarkup(banana),/Peso aproximado/);
assert.match(context.productQtyMarkup(banana),/>1 palma<\/strong>/);

// Unit-value mode is only a calculator: choices are whole quantities and checkout remains normal unit pricing.
const pear={id:'pear',name:'Pera (un)',price:6.99};
context.products.push(pear);
context.salesRulesById.set('pear',{sale_unit:'un',quantity_step:1,min_quantity:1,max_quantity:100,allow_value_sale:true});
assert.equal(context.valueSaleEnabled(pear),true);
const choices=context.unitValueSaleChoices(pear,2000);
assert.equal(choices.lower.qty,2);
assert.equal(choices.lower.totalCents,1398);
assert.equal(choices.upper.qty,3);
assert.equal(choices.upper.totalCents,2097);
const unitSheet=context.unitValueSaleEditorForm(pear,2000);
assert.match(unitSheet,/R\$ 20,00 não fecha certinho\. Escolha:/);
assert.match(unitSheet,/2 un = R\$ 13,98/);
assert.match(unitSheet,/3 un = R\$ 20,97/);
assert.equal(context.unitValueSaleChoices(pear,1398).exact.qty,2,'exact unit amount resolves directly to an integer quantity');
assert.ok(context.setUnitValueQuantity('pear',3));
assert.equal(context.cart.pear,3);
assert.equal(context.cartModes.pear,undefined,'unit helper does not send a value-mode line to checkout');
const pearLine=context.totals().items.find(x=>x.p.id==='pear');
assert.equal(pearLine.saleMode,'kg','checkout line stays on the existing normal quantity path');
assert.equal(pearLine.lineTotalCents,2097,'server receives quantity × current unit price');
context.salesRulesById.set('pear',{sale_unit:'un',quantity_step:1,min_quantity:2,max_quantity:100,allow_value_sale:true});
context.cart.pear=2;context.change('pear',-1);
assert.equal(context.cart.pear,undefined,'unit decrement below minimum removes immediately');
context.undoCartAction();assert.equal(context.cart.pear,2,'undo restores unit quantity');
const resale={id:'resale',name:'Produto com revenda',price:6.99,resale_enabled:true,resale_price:5.99,resale_min_qty:10};
context.products.push(resale);
context.salesRulesById.set('resale',{sale_unit:'un',quantity_step:1,min_quantity:1,max_quantity:100,allow_value_sale:true});
assert.equal(context.unitValueSaleChoices(resale,5990).exact.qty,10,'10-unit resale price is used in exact selection');
assert.ok(context.setUnitValueQuantity('resale',10));
const resaleLine=context.totals().items.find(x=>x.p.id==='resale');
assert.equal(resaleLine.lineTotalCents,5990,'the 10-unit resale price is applied to the normal cart line');

// Trash removes immediately and undo restores value mode; clear-cart uses the in-app confirmation and is undoable.
context.cart.avocado=1;context.cartModes.avocado='value';context.cartValueCents.avocado=1200;
context.confirmRemoveCartItem('avocado');assert.equal(context.cart.avocado,undefined,'trash removes immediately');context.undoCartAction();assert.equal(context.cartModes.avocado,'value');assert.equal(context.cartValueCents.avocado,1200);
context.cart.watermelon=1;context.cartModes.watermelon='value';context.cartValueCents.watermelon=2000;context.cart.zucchini=1;
confirmAnswer=false;await context.clearCart();assert.equal(context.cart.watermelon,1,'cancelled in-app clear confirmation preserves items');
confirmAnswer=true;await context.clearCart();assert.equal(Object.keys(context.cart).length,0,'clear-cart empties the cart after in-app confirmation');
assert.equal(confirmMessages.at(-1)[0],'Limpar o carrinho? Todos os itens serão removidos.');assert.equal(confirmMessages.at(-1)[2],'Limpar');
assert.equal(ui.cartUndoMessage.textContent,'Carrinho limpo');context.undoCartAction();assert.equal(context.cart.watermelon,1);assert.equal(context.cartModes.watermelon,'value');assert.equal(context.cartValueCents.watermelon,2000);assert.equal(context.cart.zucchini,1);

// Saved carts below changed minimums are raised to the current valid minimum with a warning.
const oldKg={id:'old-kg',name:'Produto antigo kg',price:4};
context.products.push(oldKg);context.salesRulesById.set('old-kg',{sale_unit:'kg',quantity_step:0.5,min_quantity:1,max_quantity:100,value_min_kg:1,allow_value_sale:true});
context.cart['old-kg']=0.5;context.cartMinimumAdjustedWarning=false;context.normalizeLegacyCartItem('old-kg',oldKg);
assert.equal(context.cart['old-kg'],1);assert.equal(context.cartMinimumAdjustedWarning,true);
const oldUnit={id:'old-unit',name:'Produto antigo unidade',price:2};
context.products.push(oldUnit);context.salesRulesById.set('old-unit',{sale_unit:'un',quantity_step:1,min_quantity:2,max_quantity:100,allow_value_sale:false});
context.cart['old-unit']=1;context.normalizeLegacyCartItem('old-unit',oldUnit);assert.equal(context.cart['old-unit'],2);
context.cart['old-unit']=101;context.normalizeLegacyCartItem('old-unit',oldUnit);assert.equal(context.cart['old-unit'],undefined,'unrepairable saved quantities are removed, not trapped');

assert.doesNotMatch(html,/\b(?:confirm|alert)\s*\(/,'the store must not use native browser dialogs');
assert.match(html,/id="storeConfirmModal"/);assert.match(html,/Limpar o carrinho\? Todos os itens serão removidos\./);
assert.match(html,/id="cartUndoToast"/);assert.match(html,/DESFAZER/);assert.match(html,/function positionCartToast\(toast\)/);
assert.match(html,/function showCartUndo\(message,snapshot\)/);assert.match(html,/function undoCartAction\(\)/);

// Layout guards: compact quantity row, separate remove action and value-sale link.
assert.match(html,/class="cart-item-controls"/);
assert.match(html,/class="cart-qty-control"/);
assert.match(html,/data-cart-remove=/);
assert.match(html,/data-cart-clear/);
assert.match(html,/class="cart-remove" data-cart-remove=/);
assert.match(html,/class="cart-value-action"/);
assert.match(html,/\.cart-qty-control button\{width:36px!important;height:38px!important;min-width:36px!important;min-height:38px!important/);
assert.match(html,/\.cart-item-controls \.cart-remove\{flex:none!important;width:40px!important/);
assert.match(html,/\.cart-item\{display:flex;flex-direction:column/);
assert.match(html,/function cartSaleModeControl\(item\)\{return valueSaleEditorMarkup\(item\.p\);\}/);
assert.doesNotMatch(html,/data-sale-mode=/,'cart no longer uses the cramped purchase-mode select');

console.log('OK: mobile cart layout, undo for value/kg/unit and clear-cart, in-app confirmation, no native dialogs, and 5% promotion threshold.');
