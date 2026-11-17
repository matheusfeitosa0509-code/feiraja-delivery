const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

function makeBootstrap() {
  return [
    "<script>",
    "window.__testDb = (() => {",
    " const state={environment:'sandbox',deliveryActive:false,user:{id:'admin-session-full-html',is_anonymous:false},calls:[],separationWrites:[],order:{id:'TEST-6259DB63',is_test_order:true,status:'Preparando',delivery_type:'delivery',delivery_address:{street:'Rua Japiassu',number:'140',neighborhood:'Lago Azul'},customer_address:'Rua Japiassu, 140, Lago Azul, Manaus',customer_name:'Cliente teste',customer_phone:'92999990000',customer_email:'teste@privado.example',payment_method:'Pix',delivery_vehicle:'MOTO',delivery_weight_kg:8.05,delivery_fee:16,subtotal:40,total:56,items:[{id:'test-hidden',name:'Produto de teste oculto',quantity:1,unit:'un',price:1}],market_checklist:{}},middleOrder:{id:'ORDER-MIDDLE-002',is_test_order:false,status:'Preparando',delivery_type:'pickup_store',payment_method:'Pix',customer_name:'Cliente do meio',customer_phone:'92911112222',customer_email:'meio@privado.example',customer_address:'Endereço privado do meio',subtotal:55,total:55,created_at:'2026-11-17T09:00:00Z',separation_started_at:'2026-11-17T09:01:00Z',separated_items:[],items:[{product_id:'banana-prata',name:'Banana Prata',quantity:1.5,unit:'kg',sale_unit:'kg',price:10,item_note:'Bem maduras'},{product_id:'tomate',name:'Tomate',quantity:2,unit:'un',sale_unit:'un',price:5,item_note:'Sem amassados'},{product_id:'cebola',name:'Cebola',quantity:1.5,unit:'kg',sale_unit:'kg',price:6,item_note:'Separar firme'}],market_checklist:{}},thirdOrder:{id:'ORDER-THIRD-003',is_test_order:false,status:'Pagamento Confirmado',delivery_type:'pickup_store',payment_method:'Pix',customer_name:'Outro cliente',customer_phone:'92933334444',customer_email:'outro@privado.example',customer_address:'Outro endereço privado',subtotal:50,total:50,created_at:'2026-11-17T08:00:00Z',separated_items:[],items:[{product_id:'banana-prata',name:'Banana Prata',quantity:2,unit:'kg',sale_unit:'kg',price:10,item_note:'Sem manchas'},{product_id:'coco',name:'Coco',quantity:1.5,unit:'kg',sale_unit:'kg',sale_mode:'value',price:20,line_total_cents:1500,item_note:'Maduro'}],market_checklist:{}}};state.orders=[state.order,state.middleOrder,state.thirdOrder];",
    " function dataFor(table,single,filters={}){if(table==='admin_users')return single?{user_id:state.user.id}:[{user_id:state.user.id}];if(table==='delivery_settings')return {lalamove_ambiente:state.environment,delivery_ativa:state.deliveryActive};if(table==='orders'){const selected=filters.id?state.orders.find(order=>String(order.id)===String(filters.id)):null;return single?(selected||state.order):state.orders;}if(['products','product_sales_rules','product_requests'].includes(table))return single?null:[];return single?null:[];}",
    " function from(table){let operation='select',filters={};const q={select(){return q;},update(values){operation='update';if(table==='delivery_settings'){if(values.lalamove_ambiente!==undefined)state.environment=values.lalamove_ambiente;if(values.delivery_ativa!==undefined)state.deliveryActive=values.delivery_ativa;}if(table==='orders')Object.assign(state.orders.find(order=>String(order.id)===String(filters.id))||state.order,values);return q;},eq(column,value){filters[column]=value;return q;},in(){return q;},order(){return q;},limit(){return q;},range(){return q;},maybeSingle(){return Promise.resolve({data:dataFor(table,true,filters),error:null});},then(ok,fail){return Promise.resolve({data:dataFor(table,false,filters),error:null}).then(ok,fail);}};return q;}",
    " return {__state:state,resetOrder(){state.order.lalamove_status=null;state.order.lalamove_status_updated_at=null;state.order.lalamove_tracking_url=null;},auth:{getSession:async()=>({data:{session:{user:state.user}},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})},from,rpc:async(name,args)=>{if(name==='set_order_separated_items'){const target=state.orders.find(order=>String(order.id)===String(args.p_order_id));if(target)target.separated_items=[...args.p_item_keys];state.separationWrites.push({order_id:args.p_order_id,item_keys:[...args.p_item_keys]});return {data:true,error:null};}return {data:name==='admin_get_cost_report'?{products:[{id:'feiraja_banana_prata',name:'Banana Prata',category:'Frutas',price:10,available:true,unit_cost:6,updated_at:'2026-11-16T12:00:00Z'}],summary:{orders:2,sales_total:100,known_revenue:100,known_cost:60,profit:40,profit_percent:40,missing_cost_items:0,invalid_items:0}}:name==='admin_get_cost_report_with_delivery'?{summary:{delivery_fee_revenue:30,delivery_actual_cost:18,profit_after_delivery:52},products:[]}:name==='get_sales_settings'?{low_margin_percent:20}:null,error:null};},functions:{invoke:async(name,options)=>{const action=options.body.action;state.calls.push({name,action,environment:state.environment});if(action==='quote')return {error:null,data:{environment:state.environment,quote_session_id:'00000000-0000-4000-8000-000000000001',selected_vehicle:'MOTO',moto:{fee:12.05,difference:-3.95},car:{fee:14.40,difference:-1.60}}};if(action==='create'){state.order.lalamove_status='searching';state.order.lalamove_status_updated_at=new Date().toISOString();state.order.lalamove_tracking_url='https://track.example.test/mock';state.order.delivery_vehicle=options.body.vehicle;return {error:null,data:{created:true,vehicle:options.body.vehicle,tracking_url:state.order.lalamove_tracking_url}};}return {error:null,data:{}};}},storage:{from:()=>({upload:async()=>({data:{},error:null}),remove:async()=>({data:[],error:null})})}};",
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
      if(await page.locator("#deliveryActivationStatus").textContent()!=="DESLIGADA")throw new Error("A flag de entrega deveria iniciar desligada.");
      await page.locator("#deliveryActivationToggle").click();
      await page.getByRole("dialog").getByRole("button",{name:"Ligar entrega"}).click();
      await page.waitForFunction(()=>document.getElementById("deliveryActivationStatus")?.textContent==="LIGADA");
      await page.locator("#deliveryActivationToggle").click();
      await page.getByRole("dialog").getByRole("button",{name:"Desligar entrega"}).click();
      await page.waitForFunction(()=>document.getElementById("deliveryActivationStatus")?.textContent==="DESLIGADA");

      await page.waitForFunction(()=>document.getElementById("costReportStats")?.textContent.includes("Lucro estimado"),{timeout:15000});
      const costStats=await page.locator("#costReportStats").textContent();
      if(!costStats.includes("40,00"))throw new Error("O painel deixou de exibir o lucro estimado via RPC admin: "+costStats);
      const costProducts=await page.locator("#costProductStatusList").textContent();
      if(!costProducts.includes("Banana Prata"))throw new Error("O painel deixou de exibir os custos dos produtos via RPC admin: "+costProducts);
      await page.waitForSelector("[data-order-toggle]");
      await page.locator("[data-order-toggle]").click();
      await page.waitForSelector('[data-lalamove-quote="TEST-6259DB63"]');

      await page.locator("#lalamoveEnvironmentSelect").selectOption("producao");
      await page.getByRole("dialog").getByRole("button",{name:"Confirmar Produção"}).click();
      await page.waitForFunction(()=>document.getElementById("lalamoveSettingsBadge")?.textContent==="PRODUÇÃO");
      await page.locator("[data-order-toggle]").click();
      await page.locator('[data-lalamove-quote="TEST-6259DB63"]').click();
      await page.getByRole("dialog").getByRole("button",{name:"Continuar"}).click();
      const productionQuote=page.locator('[data-lalamove-quote-box="TEST-6259DB63"]');
      await productionQuote.waitFor({state:"visible"});
      const productionText=await productionQuote.textContent();
      if(!productionText.includes("Produção")||!productionText.includes("12,05")||!productionText.includes("14,40"))throw new Error("Cotação de Produção não exibiu ambiente e preços mockados: "+productionText);
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
      await page.locator("[data-order-toggle]").click();
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
