const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const html = fs.readFileSync(path.join(__dirname, '..', 'loja.html'), 'utf8');
const style = html.match(/<style>([\s\S]*?)<\/style>/);
assert.ok(style);
assert.match(html, /id="cartMinimumProgress"/);
assert.match(html, /Faltam '\+money\(missingCents\/100\)\+' para o mínimo/);
assert.match(html, /O pedido mínimo é R\$ 30,00 em produtos\. Faltam '\+missing\+' para continuar\./);
assert.doesNotMatch(html, /Com Uber, o pagamento é somente por Pix\./);
assert.doesNotMatch(html, /Receber com seu Uber|pedir Uber|app da Uber/i);
assert.match(html, /Pagamento somente por Pix\. Seu pedido é separado após a confirmação do pagamento\./);
const summaryStart = html.indexOf('function updateCartSummary(){');
const summaryEnd = html.indexOf('function setCartEmptyState', summaryStart);
assert.ok(summaryStart >= 0 && summaryEnd > summaryStart);
const summarySource = html.slice(summaryStart, summaryEnd);
const handlerStart = html.indexOf("let minimumNoticeAction=null;");
const handlerEnd = html.indexOf("$('#close').onclick", handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
const handlerSource = html.slice(handlerStart, handlerEnd);
const modalStart = html.indexOf('<div class="modal" id="storeConfirmModal"');
const modalEnd = html.indexOf('</div></div>', modalStart);
assert.ok(modalStart >= 0 && modalEnd > modalStart);
const modalMarkup = html.slice(modalStart, modalEnd + '</div></div>'.length);
(async () => {
 const browser = await chromium.launch({headless:true});
 try {
  for (const width of [360,412]) {
   const page = await browser.newPage({viewport:{width,height:780}});
   const errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
   await page.setContent('<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+style[1]+'</style></head><body><main style="max-width:520px;margin:auto;padding:12px"><section class="cart-footer"><div id="cartMinimumProgress" class="cart-minimum-progress hidden" aria-hidden="true"><span id="cartMinimumProgressFill"></span></div><button class="btn full" id="checkout" type="button">Continuar</button></section><span id="tabCartCount"></span><span id="minimumOrderNotice"></span><span id="minimumCheckoutNotice"></span><span id="subtotal"></span><span id="total"></span><span id="modalTotal"></span><span id="cartbarCount"></span><span id="cartbarTotal"></span><div id="cartbar"></div>'+modalMarkup+'<button id="addItem" type="button">Adicionar item de teste</button></main></body></html>');
   await page.addScriptTag({content: `
    const $=selector=>document.querySelector(selector);
    const MIN_ORDER_AMOUNT=30;
    let testSubtotal=28.95;
    const cart={item:1};
    const money=value=>'R$ '+Number(value).toFixed(2).replace('.',',');
    const totals=()=>({sub:testSubtotal,total:testSubtotal,items:[{id:'item'}]});
    const setCartEmptyState=()=>{};
    const syncCartbarVisibility=()=>{};
    const updateCheckoutSummary=()=>{};
    const openCheckoutModal=()=>{document.body.dataset.checkoutOpened='yes';};
    const openPreviewModal=id=>{const el=document.getElementById(id);el.classList.add('open');el.setAttribute('aria-hidden','false');};
    const closeStoreConfirm=()=>{const el=$('#storeConfirmModal');el.classList.remove('open');el.setAttribute('aria-hidden','true');};
    const showAppPage=page=>{document.body.dataset.page=page;};
    ${summarySource}
    ${handlerSource}
    $('#addItem').onclick=()=>{testSubtotal=30;updateCartSummary();};
    updateCartSummary();
   `});
   const initial=await page.evaluate(()=>({label:$('#checkout').textContent,disabled:$('#checkout').disabled,ariaDisabled:$('#checkout').getAttribute('aria-disabled'),grey:$('#checkout').classList.contains('is-below-minimum'),progressVisible:!$('#cartMinimumProgress').classList.contains('hidden'),progress:$('#cartMinimumProgressFill').style.width}));
   assert.equal(initial.label,'Faltam R$ 1,05 para o mínimo');
   assert.equal(initial.disabled,false);
   assert.equal(initial.ariaDisabled,'true');
   assert.equal(initial.grey,true);
   assert.equal(initial.progressVisible,true);
   assert.equal(initial.progress,'96.5%');
   await page.locator('#checkout').click();
   assert.equal(await page.locator('#storeConfirmTitle').textContent(),'Falta pouco!');
   assert.equal(await page.locator('#storeConfirmMessage').textContent(),'O pedido mínimo é R$ 30,00 em produtos. Faltam R$ 1,05 para continuar.');
   assert.equal(await page.locator('#storeConfirmCancel').textContent(),'Adicionar mais produtos');
   assert.equal(await page.locator('#storeConfirmAccept').textContent(),'Ok');
   await page.locator('#storeConfirmCancel').click();
   assert.equal(await page.evaluate(()=>document.body.dataset.page),'Home');
   await page.locator('#addItem').click();
   const reached=await page.evaluate(()=>({label:$('#checkout').textContent,disabled:$('#checkout').disabled,ariaDisabled:$('#checkout').getAttribute('aria-disabled'),grey:$('#checkout').classList.contains('is-below-minimum'),progressHidden:$('#cartMinimumProgress').classList.contains('hidden')}));
   assert.equal(reached.label,'Continuar · R$ 30,00');
   assert.equal(reached.disabled,false);
   assert.equal(reached.ariaDisabled,'false');
   assert.equal(reached.grey,false);
   assert.equal(reached.progressHidden,true);
   await page.locator('#checkout').click();
   assert.equal(await page.evaluate(()=>document.body.dataset.checkoutOpened),'yes');
   assert.deepEqual(errors,[]);
   await page.close();
  }
  console.log('PASS: minimum-order feedback at 360px and 412px.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
