const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const store = fs.readFileSync(path.join(root, 'loja.html'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'painel.html'), 'utf8');
const consentScript = store.match(/<script id="cookieConsentAndClarity">([\s\S]*?)<\/script>/)?.[1];
assert.ok(consentScript, 'script de consentimento não encontrado');
assert.ok(store.includes("increaseCart(b.dataset.cardChange)"), 'botão + do produto não rastreia AddToCart');
assert.ok(store.includes("increaseCart(b.dataset.homeCardChange)"), 'botão + da vitrine não rastreia AddToCart');
assert.ok(store.includes("window.__feiraMetaPixelTrack?.('InitiateCheckout')"), 'checkout não rastreia InitiateCheckout');
assert.ok(store.includes("window.__feiraMetaPixelPurchase?.(order)"), 'tela de pedidos não verifica Purchase');
assert.ok(!panel.includes('1082580581415480') && !panel.includes('connect.facebook.net'), 'Pixel não pode estar no painel');

const fixture = `<!doctype html><html><body>
<div id="cookieConsent" hidden><button id="cookieAccept">Aceitar</button><button id="cookieReject">Recusar</button></div>
<div id="pageOrders" class="active"></div>
<script>window.__feiraMetaAdminCheckComplete=true;window.__feiraMetaIsAdmin=false;window.__feiraMetaPixelPageViewReady=true;</script>
<script>${consentScript}</script>
</body></html>`;

(async () => {
 const browser = await chromium.launch({headless:true});
 let checks=0;
 try {
  for(const width of [360,412]){
   const context=await browser.newContext({viewport:{width,height:850}});
   const page=await context.newPage();
   await page.route('**/fixture.html',route=>route.fulfill({status:200,contentType:'text/html',body:fixture}));
   await page.route('**/connect.facebook.net/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:'/* fbq mocked by Playwright */'}));
   await page.route('**/clarity.ms/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:'/* Clarity mocked by Playwright */'}));
   await page.goto('https://pixel-test.local/fixture.html');
   assert.equal(await page.locator('#cookieConsent').isVisible(),true,'banner deve aparecer sem escolha');
   assert.equal(await page.locator('script[src*="connect.facebook.net"]').count(),0,'Pixel não pode carregar antes do consentimento');
   checks++;
   await page.locator('#cookieAccept').click();
   await page.waitForSelector('script[src*="connect.facebook.net"]');
   await page.waitForFunction(()=>typeof window.fbq==='function'&&window.fbq.queue?.some(x=>x[0]==='track'&&x[1]==='PageView'));
   await page.evaluate(()=>{
    window.__feiraMetaPixelTrack('AddToCart',{value:12.5,currency:'BRL'});
    window.__feiraMetaPixelTrack('InitiateCheckout');
   });
   const firstPurchase=await page.evaluate(()=>window.__feiraMetaPixelPurchase({id:'PEDIDO-PIX-1',status:'Pagamento Confirmado',payment_method:'pix',total:49.9,is_test_order:false}));
   assert.equal(firstPurchase,true,'Purchase válido deve ser enviado');
   const testPurchase=await page.evaluate(()=>window.__feiraMetaPixelPurchase({id:'PEDIDO-TESTE',status:'Pagamento Confirmado',payment_method:'pix',total:12,is_test_order:true}));
   assert.equal(testPurchase,false,'pedido de teste não pode gerar Purchase');
   const secondPurchase=await page.evaluate(()=>window.__feiraMetaPixelPurchase({id:'PEDIDO-PIX-1',status:'Pagamento Confirmado',payment_method:'pix',total:49.9,is_test_order:false}));
   assert.equal(secondPurchase,false,'Purchase não pode repetir no mesmo carregamento');
   const events=await page.evaluate(()=>window.fbq.queue.filter(x=>x[0]==='track').map(x=>({name:x[1],params:x[2],options:x[3]})));
   assert.deepEqual(events.map(x=>x.name),['PageView','AddToCart','InitiateCheckout','Purchase']);
   assert.equal(events[1].params.value,12.5);
   assert.equal(events[1].params.currency,'BRL');
   assert.equal(events[3].params.value,49.9);
   assert.equal(events[3].params.currency,'BRL');
   assert.equal(events[3].options.eventID,'PEDIDO-PIX-1');
   assert.equal(JSON.stringify(events).includes('cliente@example.com'),false);
   checks++;
   await page.reload();
   await page.waitForFunction(()=>typeof window.fbq==='function'&&window.fbq.queue?.some(x=>x[0]==='track'&&x[1]==='PageView'));
   const afterReload=await page.evaluate(()=>window.__feiraMetaPixelPurchase({id:'PEDIDO-PIX-1',status:'Pagamento Confirmado',payment_method:'pix',total:49.9,is_test_order:false}));
   assert.equal(afterReload,false,'localStorage deve impedir Purchase após reload');
   const reloadPurchases=await page.evaluate(()=>window.fbq.queue.filter(x=>x[0]==='track'&&x[1]==='Purchase').length);
   assert.equal(reloadPurchases,0);
   checks++;
   await context.close();

   const rejected=await browser.newContext({viewport:{width,height:850}});
   const rejectPage=await rejected.newPage();
   await rejectPage.route('**/fixture.html',route=>route.fulfill({status:200,contentType:'text/html',body:fixture}));
   await rejectPage.route('**/connect.facebook.net/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:''}));
   await rejectPage.route('**/clarity.ms/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:''}));
   await rejectPage.goto('https://pixel-test.local/fixture.html');
   await rejectPage.locator('#cookieReject').click();
   assert.equal(await rejectPage.locator('script[src*="connect.facebook.net"]').count(),0);
   await rejectPage.reload();
   assert.equal(await rejectPage.locator('#cookieConsent').isVisible(),false,'recusa deve ficar salva e não perguntar de novo');
   assert.equal(await rejectPage.locator('script[src*="connect.facebook.net"]').count(),0);
   checks++;
   await rejected.close();

   const blocked=await browser.newContext({viewport:{width,height:850}});
   await blocked.addInitScript(()=>{localStorage.setItem('feira_cookie_consent_v1','accepted');window.__feiraMetaAdminCheckComplete=true;window.__feiraMetaIsAdmin=true;window.__feiraMetaPixelPageViewReady=true;});
   const blockedPage=await blocked.newPage();
   await blockedPage.route('**/fixture.html',route=>route.fulfill({status:200,contentType:'text/html',body:fixture.replace('window.__feiraMetaIsAdmin=false','window.__feiraMetaIsAdmin=window.__forceAdmin===true||window.__feiraMetaIsAdmin')}));
   await blockedPage.route('**/connect.facebook.net/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:''}));
   await blockedPage.route('**/clarity.ms/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:''}));
   await blockedPage.goto('https://pixel-test.local/fixture.html');
   const blockedEvents=await blockedPage.evaluate(()=>{
    window.__feiraMetaPixelTrack('AddToCart',{value:10,currency:'BRL'});
    const test=window.__feiraMetaPixelPurchase({id:'TESTE-1',status:'Pagamento Confirmado',payment_method:'pix',total:10,is_test_order:true});
    const admin=window.__feiraMetaPixelPurchase({id:'ADMIN-1',status:'Pagamento Confirmado',payment_method:'pix',total:10,is_test_order:false});
    return {test,admin,tracks:window.fbq.queue.filter(x=>x[0]==='track')};
   });
   assert.equal(blockedEvents.test,false);
   assert.equal(blockedEvents.admin,false);
   assert.equal(blockedEvents.tracks.length,0,'admin não deve gerar PageView/AddToCart/Purchase');
   checks++;
   await blocked.close();
  }
  console.log('Meta Pixel Playwright: '+checks+'/10 checks passed at 360px and 412px; consent, events, purchase dedupe, test/admin suppression, panel isolation.');
 } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exit(1);});
