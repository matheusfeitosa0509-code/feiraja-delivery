const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = process.cwd();
const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.woff2':'font/woff2' };

function startServer() {
 return new Promise(resolve => {
  const server = http.createServer((req,res) => {
   let pathname;
   try { pathname = decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname); } catch { res.writeHead(400).end(); return; }
   const file = path.resolve(root, '.' + pathname);
   if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
   fs.readFile(file,(error,data) => {
    if(error){res.writeHead(404).end();return;}
    res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(data);
   });
  });
  server.listen(0,'127.0.0.1',()=>resolve({server,url:'http://127.0.0.1:'+server.address().port+'/loja.html'}));
 });
}

(async()=>{
 const html=fs.readFileSync(path.join(root,'loja.html'),'utf8');
 assert.match(html,/id="firstDeliveryPromoBanner"[^>]*hidden/,'promo banner must start hidden');
 assert.match(html,/id="firstDeliveryPromoDetails"/,'dynamic settings line missing');
 assert.match(html,/id="firstDeliveryPromoCta"/,'CTA missing');
 assert.match(html,/Number\(offer\?\.min_subtotal\)/,'minimum must come from the server offer, without a hard-coded fallback');
 assert.match(html,/offer\?\.enabled===true/,'visibility must follow the server eligibility flag');
 assert.doesNotMatch(html,/1ª entrega grátis em pedidos a partir de/,'old text strip must be removed');
 const {server,url}=await startServer();
 const browser=await chromium.launch({headless:true});
 try{
  const screenshots=[];
  for(const width of [360,412]){
   const context=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:1});
   const page=await context.newPage();
   await page.addInitScript(()=>{try{localStorage.setItem('feira_cookie_consent_v1','accepted');}catch(_){}});
   await page.route('**/rest/v1/rpc/get_first_delivery_promo_offer',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({enabled:true,min_subtotal:75.5,ends_at:'2026-12-31T23:59:59-04:00'})}));
   await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
   await page.waitForFunction(()=>document.querySelector('#pageHome')?.classList.contains('promo-ready'),null,{timeout:30000});
   const banner=page.locator('#firstDeliveryPromoBanner');
   await banner.waitFor({state:'visible',timeout:10000});
   assert.equal(await page.locator('#firstDeliveryPromoTitle').innerText(),'🎁 Sua 1ª entrega é GRÁTIS');
   const details=await page.locator('#firstDeliveryPromoDetails').innerText();
   assert.match(details,/R\$\s?75,50/,'settings minimum must be rendered dynamically');
   assert.match(details,/31\/12/,'settings end date must be rendered dynamically');
   const layout=await banner.evaluate(el=>{const r=el.getBoundingClientRect();return {height:r.height,width:r.width,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,background:getComputedStyle(el).backgroundImage,buttonBackground:getComputedStyle(el.querySelector('button')).backgroundColor};});
   assert.ok(layout.height<=140,'banner too tall at '+width+'px: '+layout.height);
   assert.ok(layout.scrollWidth<=layout.clientWidth,'banner overflows horizontally at '+width+'px');
   assert.match(layout.background,/linear-gradient/,'brand green gradient missing');
   assert.equal(layout.buttonBackground,'rgb(255, 255, 255)','CTA must have a white background');
   fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
   await page.screenshot({path:path.join(root,'artifacts','first-delivery-promo-banner-'+width+'.png'),fullPage:false});
   await page.locator('#firstDeliveryPromoCta').click();
   await page.waitForFunction(()=>window.scrollY>0,null,{timeout:5000}).catch(()=>{});
   const scroll=await page.evaluate(()=>({y:window.scrollY,target:document.querySelector('#homeProductSections')?.getBoundingClientRect().top}));
   assert.ok(scroll.y>0||scroll.target===0,'CTA must scroll toward the product sections');
   screenshots.push({width:width,height:layout.height,scrollY:scroll.y});
   await context.close();
  }
  for(const scenario of [{name:'promo desligada',offer:{enabled:false}},{name:'cliente com pedido pago',offer:{enabled:false}}]){
   const context=await browser.newContext({viewport:{width:360,height:900}});
   const page=await context.newPage();
   await page.addInitScript(()=>{try{localStorage.setItem('feira_cookie_consent_v1','accepted');}catch(_){}});
   await page.route('**/rest/v1/rpc/get_first_delivery_promo_offer',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(scenario.offer)}));
   await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
   await page.waitForFunction(()=>document.querySelector('#pageHome')?.classList.contains('promo-ready'),null,{timeout:30000});
   assert.equal(await page.locator('#firstDeliveryPromoBanner').isVisible(),false,scenario.name+' must not display the banner');
   await context.close();
  }
  console.log(JSON.stringify({result:'PASS',screenshots,hiddenScenarios:['promo desligada','cliente com pedido pago']},null,2));
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
