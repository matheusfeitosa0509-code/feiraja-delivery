const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

function makeBootstrap() {
  return [
    "<script>",
    "window.__testDb = (() => {",
    " const state={environment:'sandbox',user:{id:'admin-session-full-html',is_anonymous:false},calls:[],order:{id:'TEST-6259DB63',is_test_order:true,status:'Preparando',delivery_type:'delivery',delivery_address:{street:'Rua Japiassu',number:'140',neighborhood:'Lago Azul'},customer_address:'Rua Japiassu, 140, Lago Azul, Manaus',customer_name:'Cliente teste',customer_phone:'92999990000',payment_method:'Pix',delivery_vehicle:'MOTO',delivery_weight_kg:8.05,delivery_fee:16,subtotal:40,total:56,items:[],market_checklist:{}}};",
    " function dataFor(table,single){if(table==='admin_users')return single?{user_id:state.user.id}:[{user_id:state.user.id}];if(table==='delivery_settings')return {lalamove_ambiente:state.environment};if(table==='orders')return single?state.order:[state.order];if(['products','product_sales_rules','product_requests'].includes(table))return single?null:[];return single?null:[];}",
    " function from(table){let operation='select';const q={select(){return q;},update(values){operation='update';if(table==='delivery_settings')state.environment=values.lalamove_ambiente;if(table==='orders')Object.assign(state.order,values);return q;},eq(){return q;},in(){return q;},order(){return q;},limit(){return q;},range(){return q;},maybeSingle(){return Promise.resolve({data:dataFor(table,true),error:null});},then(ok,fail){return Promise.resolve({data:dataFor(table,false),error:null}).then(ok,fail);}};return q;}",
    " return {__state:state,resetOrder(){state.order.lalamove_status=null;state.order.lalamove_status_updated_at=null;state.order.lalamove_tracking_url=null;},auth:{getSession:async()=>({data:{session:{user:state.user}},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})},from,rpc:async name=>({data:name==='admin_get_cost_report'?{products:[],summary:{}}:null,error:null}),functions:{invoke:async(name,options)=>{const action=options.body.action;state.calls.push({name,action,environment:state.environment});if(action==='quote')return {error:null,data:{environment:state.environment,quote_session_id:'00000000-0000-4000-8000-000000000001',selected_vehicle:'MOTO',moto:{fee:12.05,difference:-3.95},car:{fee:14.40,difference:-1.60}}};if(action==='create'){state.order.lalamove_status='searching';state.order.lalamove_status_updated_at=new Date().toISOString();state.order.lalamove_tracking_url='https://track.example.test/mock';state.order.delivery_vehicle=options.body.vehicle;return {error:null,data:{created:true,vehicle:options.body.vehicle,tracking_url:state.order.lalamove_tracking_url}};}return {error:null,data:{}};}},storage:{from:()=>({upload:async()=>({data:{},error:null}),remove:async()=>({data:[],error:null})})}};",
    "})();",
    "window.FeiraTurnstile={create:()=>({init(){},getToken:()=>'',reset(){}})};",
    "window.FeiraLalamoveMap={mountAll(){}};",
    "</script>"
  ].join("\n");
}

function prepareHtml(source) {
  let html=source
    .replace(/<script>try\{if\(\"serviceWorker\"[\s\S]*?<\/script>/i,"")
    .replace(/<link rel=\"manifest\"[^>]*>/i,"")
    .replace(/<link rel=\"preconnect\"[^>]*>/gi,"")
    .replace(/<link href=\"https:\/\/fonts\.googleapis\.com[^>]*>/gi,"")
    .replace(/<script src=\"\.\/turnstile\.js\" defer><\/script>/i,"")
    .replace(/<script src=\"\.\/lalamove-map\.js\"><\/script>/i,"");
  html=html.replace(/<script type=\"module\">([\s\S]*?)<\/script>/i,(_all,code)=>{
    code=code.replace(/^\s*import\s*\{\s*createClient\s*\}\s*from\s*['\"]https:\/\/esm\.sh\/@supabase\/supabase-js@2\.117\.1['\"];\s*/m,"");
    code=code.replace(/const db=createClient\([\s\S]*?\);\s*/,"const db=window.__testDb;\n");
    return "<script>"+code+"</script>";
  });
  return html.replace("<body",makeBootstrap()+"<body");
}

(async()=>{
  const source=fs.readFileSync(path.join(process.cwd(),"painel.html"),"utf8");
  const browser=await chromium.launch({headless:true});
  try{
    for(const width of [360,412]){
      const page=await browser.newPage({viewport:{width,height:1000},deviceScaleFactor:1});
      const errors=[];
      page.on("pageerror",e=>errors.push("pageerror: "+e.message));
      page.on("console",m=>{if(m.type()==="error")errors.push("console.error: "+m.text());});
      await page.setContent(prepareHtml(source),{waitUntil:"domcontentloaded"});
      await page.waitForFunction(()=>document.getElementById("lalamoveSettingsMessage")?.textContent.includes("Ambiente atual"),{timeout:15000});
      await page.waitForSelector("[data-order-toggle]");
      await page.locator("[data-order-toggle]").click();
      await page.waitForSelector('[data-lalamove-quote="TEST-6259DB63"]');

      await page.locator("#lalamoveEnvironmentSelect").selectOption("producao");
      await page.getByRole("dialog").getByRole("button",{name:"Confirmar Produção"}).click();
      await page.waitForFunction(()=>document.getElementById("lalamoveSettingsBadge")?.textContent==="PRODUÇÃO");
      await page.locator('[data-lalamove-quote="TEST-6259DB63"]').click();
      await page.getByRole("dialog").getByRole("button",{name:"Continuar"}).click();
      const productionQuote=page.locator('[data-lalamove-quote-box="TEST-6259DB63"]');
      await productionQuote.waitFor({state:"visible"});
      const productionText=await productionQuote.textContent();
      if(!productionText.includes("Produção")||!productionText.includes("R$ 12,05")||!productionText.includes("R$ 14,40"))throw new Error("Cotação de Produção não exibiu ambiente e preços reais mockados.");
      await productionQuote.locator('[data-lalamove-vehicle="CAR"]').click();
      await productionQuote.locator("[data-lalamove-confirm]").click();
      await page.getByRole("dialog").getByRole("button",{name:"Criar corrida real"}).click();
      await page.waitForFunction(()=>document.querySelector("[data-lalamove-status-label]")?.textContent.includes("Procurando motorista"));
      if(await page.locator("[data-lalamove-map]").count()!==1)throw new Error("Status/rastreio não apareceu após criação mockada em Produção.");

      await page.evaluate(()=>window.__testDb.resetOrder());
      await page.locator("#refresh").click();
      await page.waitForSelector("[data-order-toggle]");
      await page.locator("[data-order-toggle]").click();
      await page.waitForSelector('[data-lalamove-quote="TEST-6259DB63"]');
      await page.locator("#lalamoveEnvironmentSelect").selectOption("sandbox");
      await page.waitForFunction(()=>document.getElementById("lalamoveSettingsBadge")?.textContent==="SANDBOX");
      await page.locator('[data-lalamove-quote="TEST-6259DB63"]').click();
      await page.getByRole("dialog").getByRole("button",{name:"Continuar"}).click();
      const sandboxQuote=page.locator('[data-lalamove-quote-box="TEST-6259DB63"]');
      await sandboxQuote.waitFor({state:"visible"});
      if(!(await sandboxQuote.textContent()).includes("Sandbox"))throw new Error("Cotação não identificou Sandbox.");
      await sandboxQuote.locator('[data-lalamove-vehicle="MOTO"]').click();
      await sandboxQuote.locator("[data-lalamove-confirm]").click();
      await page.waitForFunction(()=>document.querySelector("[data-lalamove-status-label]")?.textContent.includes("Procurando motorista"));
      if(await page.locator("[data-lalamove-map]").count()!==1)throw new Error("Status/rastreio não apareceu após criação mockada em Sandbox.");

      const calls=await page.evaluate(()=>window.__testDb.__state.calls);
      if(calls.filter(x=>x.action==="quote").length!==2||calls.filter(x=>x.action==="create").length!==2)throw new Error("Esperadas duas cotações e duas criações mockadas.");
      if(!calls.some(x=>x.action==="create"&&x.environment==="producao")||!calls.some(x=>x.action==="create"&&x.environment==="sandbox"))throw new Error("As criações não respeitaram o ambiente escolhido.");
      if(errors.length)throw new Error("Erros JS/console no painel "+width+"px:\n"+errors.join("\n"));
      if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error("Rolagem horizontal no painel "+width+"px.");
      await page.screenshot({path:"artifacts/painel-full-html-lalamove-"+width+".png",fullPage:true});
      await page.close();
    }
  }finally{await browser.close();}
  console.log("HTML integral do painel: sessão admin simulada, clique real, cotação/confirmação/criação/rastreio mockados em Produção e Sandbox; zero pageerror/console.error em 360/412px.");
})().catch(error=>{console.error(error);process.exit(1);});
