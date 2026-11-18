// The stale-price probe is installed before navigation so the assertion observes the first cached paint, not the later network correction.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = process.cwd();
const productionUrl = process.env.STOREFRONT_BASELINE_URL || 'https://www.feiraondelivery.com.br/loja.html';
const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.woff2':'font/woff2' };

function startServer() {
 return new Promise(resolve => {
  const server = http.createServer((req,res) => {
   let pathname;
   try { pathname = decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname); } catch { res.writeHead(400).end(); return; }
   const file = path.resolve(root, '.' + pathname);
   if (!file.startsWith(root + path.sep) && file !== path.join(root,'index.html')) { res.writeHead(403).end(); return; }
   fs.readFile(file,(error,data) => {
    if(error){res.writeHead(404).end();return;}
    res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(data);
   });
  });
  server.listen(0,'127.0.0.1',()=>resolve({server,url:'http://127.0.0.1:'+server.address().port+'/loja.html'}));
 });
}
async function emulate4G(page) {
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Network.enable');
 await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:4*1024*1024/8,uploadThroughput:1024*1024/8,connectionType:'cellular4g'});
 return cdp;
}
async function measure(page,cdp,url) {
 let requests=0,bytes=0;
 const onRequest=()=>requests++;
 const onFinished=e=>{bytes+=Number(e.encodedDataLength)||0;};
 cdp.on('Network.requestWillBeSent',onRequest);
 cdp.on('Network.loadingFinished',onFinished);
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForFunction(()=>window.__storefrontPerf&&window.__storefrontPerf.firstProductAt!==null, {timeout:30000});
 const firstProductMs=await page.evaluate(()=>window.__storefrontPerf.firstProductAt);
 const count=await page.locator('#homeProductSections .product[data-product-id]').count();
 await page.waitForTimeout(700);
 cdp.off('Network.requestWillBeSent',onRequest);cdp.off('Network.loadingFinished',onFinished);
 return {firstProductMs:Number(firstProductMs.toFixed(1)),bytes,requests,products:count,skeletonSeen:await page.evaluate(()=>window.__storefrontPerf.skeletonSeen)};
}
(async()=>{
 const html=fs.readFileSync(path.join(root,'loja.html'),'utf8');
 const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
 const assistantRuntime=fs.readFileSync(path.join(root,'assistant-runtime.js'),'utf8');
 assert.match(sw,/const STATIC_CACHE='feira-static-v/,'versioned static cache missing');
 assert.match(sw,/return cached\|\|network/,'stale-while-revalidate missing');
 assert.match(sw,/request.mode==='navigate'\)return/,'HTML navigations must bypass the cache');
 assert.ok(html.includes('storefrontCacheBootstrap'),'early cache bootstrap missing');
 assert.ok(html.includes('feira_storefront_catalog_v1'),'persistent catalog cache missing');
 assert.ok(html.includes('updateProductCardPrice(product)'),'changed prices must patch only their cards');
 assert.ok(html.includes("import('./assistant-runtime.js?v=20261118-lazy-assistant-runtime')"),'assistant runtime must be imported on demand');
 assert.ok(assistantRuntime.includes("import('./assistant-speech.js?v=20261118-lazy-assistant')"),'assistant speech module must be imported on demand');
 assert.ok(html.includes('select=id,name,price,old_price,category,image,available,resale_enabled,resale_price,resale_min_qty,resale_unit'),'catalog select list missing');
 assert.ok(!/select=[^'"]*(?:cost|cost_price)/i.test(html),'cost fields must never be selected for storefront');
 const {server,url}=await startServer();
 const browser=await chromium.launch({headless:true});
 try {
  const report={network:'4G simulated: 100ms RTT, 4Mbps down / 1Mbps up',viewports:{}};
  for(const width of [360,412]){
   const context=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:1});
   const page=await context.newPage();
   const errors=[];
   page.on('pageerror',e=>errors.push('pageerror: '+e.message));
   page.on('console',m=>{if(m.type()==='error')errors.push('console.error: '+m.text());});
   await page.addInitScript(()=>{window.__storefrontPerf={firstProductAt:null,skeletonSeen:false};const mark=()=>{if(window.__storefrontPerf.firstProductAt===null&&document.querySelector('#homeProductSections .product[data-product-id]'))window.__storefrontPerf.firstProductAt=performance.now();if(document.querySelector('#homeProductSections .storefront-skeleton'))window.__storefrontPerf.skeletonSeen=true;};new MutationObserver(mark).observe(document,{childList:true,subtree:true});document.addEventListener('DOMContentLoaded',mark);});
   const cdp=await emulate4G(page);
   const baselineFirst=await measure(page,cdp,productionUrl);
   const baselineSecond=await measure(page,cdp,productionUrl);
   await context.close();

   const candidateContext=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:1});
   const candidate=await candidateContext.newPage();
   const candidateErrors=[];
   candidate.on('pageerror',e=>candidateErrors.push('pageerror: '+e.message));
   candidate.on('console',m=>{if(m.type()==='error')candidateErrors.push('console.error: '+m.text());});
   await candidate.addInitScript(()=>{window.__storefrontPerf={firstProductAt:null,skeletonSeen:false};const mark=()=>{if(window.__storefrontPerf.firstProductAt===null&&document.querySelector('#homeProductSections .product[data-product-id]'))window.__storefrontPerf.firstProductAt=performance.now();if(document.querySelector('#homeProductSections .storefront-skeleton'))window.__storefrontPerf.skeletonSeen=true;};new MutationObserver(mark).observe(document,{childList:true,subtree:true});document.addEventListener('DOMContentLoaded',mark);});
   const candidateCdp=await emulate4G(candidate);
   const candidateFirst=await measure(candidate,candidateCdp,url);
   await candidate.waitForFunction(()=>{const cache=JSON.parse(localStorage.getItem('feira_storefront_catalog_v1')||'null');return !!cache&&Array.isArray(cache.products)&&cache.products.length>0;},null,{timeout:30000});
   const saved=await candidate.evaluate(()=>JSON.parse(localStorage.getItem('feira_storefront_catalog_v1')||'null'));
   assert.ok(candidateFirst.firstProductMs<2500,'first visit did not meet <2.5s target: '+candidateFirst.firstProductMs+'ms');
   assert.ok(candidateFirst.skeletonSeen,'first visit without cache did not show skeleton');
   assert.ok(saved&&saved.products.length,'first visit did not persist catalog cache');
   const first=saved.products[0];
   const originalPrice=Number(first.price);
   const candidateSecond=await measure(candidate,candidateCdp,url);
   assert.ok(candidateStale.firstProductMs<1000,'cached stale-price visit did not meet <1s target: '+candidateStale.firstProductMs+'ms');
   const stalePrice=originalPrice+123.45;
   await candidate.evaluate(({id,price})=>{const cache=JSON.parse(localStorage.getItem('feira_storefront_catalog_v1'));const p=cache.products.find(x=>x.id===id);p.price=price;localStorage.setItem('feira_storefront_catalog_v1',JSON.stringify(cache));},{id:first.id,price:stalePrice});
   await candidate.evaluate(({id,price})=>localStorage.setItem('__storefront_stale_probe',JSON.stringify({id,price})),{id:first.id,price:stalePrice});
   await candidate.addInitScript(()=>{try{const probe=JSON.parse(localStorage.getItem('__storefront_stale_probe')||'null');if(!probe)return;window.__stalePriceSeen=false;const check=()=>{const card=document.querySelector('#homeProductSections [data-product-id="'+CSS.escape(probe.id)+'"]');if(card&&card.querySelector('.price')?.textContent.includes(Number(probe.price).toFixed(2).replace('.',',')))window.__stalePriceSeen=true;};new MutationObserver(check).observe(document,{childList:true,subtree:true,characterData:true});document.addEventListener('DOMContentLoaded',check);}catch(_){}});
   const candidateStale=await measure(candidate,candidateCdp,url);
   const staleWasPainted=await candidate.evaluate(()=>window.__stalePriceSeen===true);
   await candidate.waitForFunction(({id,price})=>{const cache=JSON.parse(localStorage.getItem('feira_storefront_catalog_v1')||'null');const item=cache?.products?.find(p=>p.id===id);return item&&Number(item.price)!==price;},{id:first.id,price:stalePrice},{timeout:30000});
   const correctedPrice=await candidate.evaluate(id=>Number(JSON.parse(localStorage.getItem('feira_storefront_catalog_v1')).products.find(p=>p.id===id).price),first.id);
   const noMapOnOpen=!(await candidate.evaluate(()=>performance.getEntriesByType('resource').some(x=>/maplibre-gl|lalamove-map\.js|assistant-runtime\.js|assistant-speech\.js/.test(x.name))));
   const firstImages=await candidate.locator('#homeProductSections .product[data-product-id] img[fetchpriority="high"][width="160"][height="160"]').count();
   assert.ok(staleWasPainted,'stale cached price was not painted before server refresh');
   assert.equal(correctedPrice,originalPrice,'server refresh did not correct stale cached price');
   assert.ok(candidateSecond.firstProductMs<1000,'cached second visit did not meet <1s target: '+candidateSecond.firstProductMs+'ms');
   assert.ok(firstImages>=4,'first product row images missing high priority/dimensions');
   assert.ok(noMapOnOpen,'MapLibre, tracking map or assistant loaded before use');
   await candidate.locator('#assistantNavButton').click();
   await candidate.waitForFunction(()=>performance.getEntriesByType('resource').some(x=>x.name.includes('assistant-runtime.js')),null,{timeout:10000});
   assert.ok(!(await candidate.evaluate(()=>performance.getEntriesByType('resource').some(x=>x.name.includes('assistant-speech.js')))),'voice module should remain lazy until a signed-in assistant opens');
   assert.deepEqual(candidateErrors,[],'console/page errors on candidate: '+candidateErrors.join('; '));
   report.viewports[width]={before:{first:baselineFirst,second:baselineSecond},after:{first:candidateFirst,second:candidateSecond,staleRefresh:candidateStale},stalePriceCorrected:true,noMapOnOpen,firstImagesHighPriority:firstImages,consoleErrors:candidateErrors.length};
   await candidateContext.close();
  }
  console.log('STOREFRONT_PERFORMANCE_REPORT '+JSON.stringify(report));
 } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exit(1);});
