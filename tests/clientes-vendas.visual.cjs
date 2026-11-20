const fs=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");
const {chromium}=require("playwright");
(async()=>{
 const source=fs.readFileSync(path.join(process.cwd(),"clientes-vendas.html"),"utf8");
 const html=source
  .replace('<script src="./turnstile.js" defer></script>','')
  .replace("await import('https://esm.sh/@supabase/supabase-js@2.117.1')","Promise.resolve({createClient:()=>window.__mockDb})")
  .replace('<script>\nfunction showPageError', '<script>\nwindow.FeiraTurnstile={create:()=>({init(){},getToken(){return null},reset(){}})};\nwindow.__mockDb={auth:{onAuthStateChange(){},getSession:async()=>({data:{session:null},error:null})}};\nfunction showPageError');
 assert.match(html,/data-period="today"/);
 assert.match(html,/id="realProfit"/);
 assert.match(html,/id="customerManagementCard"/);
 const browser=await chromium.launch({headless:true});
 try{
  for(const width of [360,412,1280]){
   const page=await browser.newPage({viewport:{width,height:900}});
   const errors=[];
   page.on("pageerror",e=>errors.push("pageerror: "+e.message));
   page.on("console",m=>{if(m.type()==="error")errors.push("console.error: "+m.text());});
   await page.setContent(html,{waitUntil:"domcontentloaded"});
   await page.locator("#login").waitFor({state:"visible",timeout:10000});
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
   if(overflow)errors.push("rolagem horizontal em "+width+"px");
   if(errors.length)throw new Error("Clientes e vendas em "+width+"px: "+errors.join(" | "));
   await page.close();
  }
 }finally{await browser.close();}
 console.log("Clientes e vendas Playwright: página abre sem erros de console em 360/412/1280px.");
})().catch(e=>{console.error(e);process.exit(1);});
