const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const store = fs.readFileSync(path.join(root, 'loja.html'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'painel.html'), 'utf8');
const consentScript = store.match(/<script id="cookieConsentAndClarity">([\s\S]*?)<\/script>/)?.[1];
const consentStyles = store.match(/<style id="cookieConsentStyles">([\s\S]*?)<\/style>/)?.[1];
assert.ok(consentStyles, 'estilos do consentimento não encontrados');
assert.ok(consentScript, 'script de consentimento não encontrado');
assert.ok(store.includes("increaseCart(b.dataset.cardChange)"), 'botão + do produto não rastreia AddToCart');
assert.ok(store.includes("increaseCart(b.dataset.homeCardChange)"), 'botão + da vitrine não rastreia AddToCart');
assert.ok(store.includes("window.__feiraMetaPixelTrack?.('InitiateCheckout')"), 'checkout não rastreia InitiateCheckout');
assert.ok(store.includes("window.__feiraMetaPixelPurchase?.(order)"), 'tela de pedidos não verifica Purchase');
assert.ok(!panel.includes('1082580581415480') && !panel.includes('connect.facebook.net'), 'Pixel não pode estar no painel');

const fixture = `<!doctype html><html><body>
<style>${consentStyles}
#cartbar{position:fixed;left:12px;right:12px;bottom:88px;height:52px;z-index:6}
.mobile-nav{position:fixed;left:0;right:0;bottom:0;height:76px;z-index:20;background:#fff}
</style>
<div id="cartbar">Ver carrinho</div><nav class="mobile-nav">Menu</nav>
<div id="cookieConsent" class="cookie-consent" role="dialog" aria-label="Preferências de cookies" aria-modal="true" hidden>
 <div class="cookie-consent-sheet"><p>Usamos cookies para melhorar a loja e medir anúncios. <a href="politica-privacidade.html">Política de privacidade</a></p>
 <div class="cookie-consent-actions"><button id="cookieAccept">Aceitar</button><button id="cookieReject">Recusar</button></div></div>
</div>
<div id="pageOrders" class="active"></div>
<script>window.__feiraMetaAdminCheckComplete=true;window.__feiraMetaIsAdmin=false;window.__feiraMetaPixelPageViewReady=true;</script>
<script>${consentScript}</script>
</body></html>`;

(async () => {
 fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
 const browser = await chromium.launch({headless:true});
 let checks=0;
 try {
  for(const width of [360,412,500]){
   const context=await browser.newContext({viewport:{width,height:850}});
   const page=await context.newPage();
   await page.route('**/fixture.html',route=>route.fulfill({status:200,contentType:'text/html',body:fixture}));
   await page.route('**/connect.facebook.net/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:'/* fbq mocked by Playwright */'}));
   await page.route('**/clarity.ms/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:'/* Clarity mocked by Playwright */'}));
   await page.goto('https://pixel-test.local/fixture.html');
   assert.equal(await page.locator('#cookieConsent').isVisible(),true,'bottom sheet deve aparecer sem escolha');
   assert.equal(await page.locator('#cartbar').evaluate(el=>getComputedStyle(el).visibility),'hidden','barra Ver carrinho fica escondida enquanto o aviso está aberto');
   const consentGeometry=await page.evaluate(()=>{const root=document.querySelector('#cookieConsent'),accept=document.querySelector('#cookieAccept'),reject=document.querySelector('#cookieReject'),r=el=>{const b=el.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height};};return {root:r(root),accept:r(accept),reject:r(reject),z:Number(getComputedStyle(root).zIndex),acceptHit:document.elementFromPoint(accept.getBoundingClientRect().left+accept.offsetWidth/2,accept.getBoundingClientRect().top+accept.offsetHeight/2)===accept,rejectHit:document.elementFromPoint(reject.getBoundingClientRect().left+reject.offsetWidth/2,reject.getBoundingClientRect().top+reject.offsetHeight/2)===reject};});
   assert.ok(consentGeometry.z>20,'aviso fica acima do menu inferior e da barra do carrinho');
   for(const button of [consentGeometry.accept,consentGeometry.reject])assert.ok(button.left>=0&&button.right<=width&&button.top>=0&&button.bottom<=850&&button.height>=44,'botão visível e dentro da viewport');
   assert.equal(consentGeometry.acceptHit,true,'Aceitar recebe o toque');
   assert.equal(consentGeometry.rejectHit,true,'Recusar recebe o toque');
   await page.screenshot({path:path.join(root,'artifacts','painel-cookie-consent-'+width+'.png'),fullPage:true}).catch(()=>{});
   assert.equal(await page.locator('script[src*="connect.facebook.net"]').count(),0,'Pixel não pode carregar antes do consentimento');
   checks++;
   await page.locator('#cookieAccept').click();
   assert.notEqual(await page.locator('#cartbar').evaluate(el=>getComputedStyle(el).visibility),'hidden','barra do carrinho volta após a escolha');
   await page.waitForSelector('script[src*="connect.facebook.net"]',{state:'attached'});
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
