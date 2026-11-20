const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

function makeBootstrap() {
  return [
    "<script>",
    "window.__testDb = (() => {",
    " const state={environment:'sandbox',deliveryActive:false,user:{id:'admin-session-full-html',is_anonymous:false},calls:[],separationWrites:[],orderFetchCount:0,order:{id:'TEST-6259DB63',is_test_order:true,status:'Preparando',delivery_type:'delivery',delivery_address:{street:'Rua Japiassu',number:'140',neighborhood:'Lago Azul'},customer_address:'Rua Japiassu, 140, Lago Azul, Manaus',customer_name:'Cliente teste',customer_phone:'92999990000',customer_email:'teste@privado.example',payment_method:'Pix',delivery_vehicle:'MOTO',delivery_weight_kg:8.05,delivery_fee:16,subtotal:40,total:56,items:[{id:'test-hidden',name:'Produto de teste oculto',quantity:1,unit:'un',price:1}],market_checklist:{}},middleOrder:{id:'ORDER-MIDDLE-002',is_test_order:false,status:'Preparando',delivery_type:'pickup_store',payment_method:'Pix',customer_name:'Cliente do meio',customer_phone:'92911112222',customer_email:'meio@privado.example',customer_address:'Endereço privado do meio',subtotal:55,total:55,created_at:'2026-11-17T09:00:00Z',separation_started_at:'2026-11-17T09:01:00Z',separated_items:[],items:[{product_id:'banana-prata',name:'Banana Prata',quantity:1.5,unit:'kg',sale_unit:'kg',price:10,item_note:'Bem maduras'},{product_id:'tomate',name:'Tomate',quantity:2,unit:'un',sale_unit:'un',price:5,item_note:'Sem amassados'},{product_id:'cebola',name:'Cebola',quantity:1.5,unit:'kg',sale_unit:'kg',price:6,item_note:'Separar firme'}],market_checklist:{}},thirdOrder:{id:'ORDER-THIRD-003',is_test_order:false,status:'Pagamento Confirmado',delivery_type:'pickup_store',payment_method:'Pix',customer_name:'Outro cliente',customer_phone:'92933334444',customer_email:'outro@privado.example',customer_address:'Outro endereço privado',subtotal:50,total:50,created_at:'2026-11-17T08:00:00Z',separated_items:[],items:[{product_id:'banana-prata',name:'Banana Prata',quantity:2,unit:'kg',sale_unit:'kg',price:10,item_note:'Sem manchas'},{product_id:'coco',name:'Coco',quantity:1.5,unit:'kg',sale_unit:'kg',sale_mode:'value',price:20,line_total_cents:1500,item_note:'Maduro'}],market_checklist:{}}};state.orders=[state.order,state.middleOrder,state.thirdOrder];",
    " function dataFor(table,single,filters={}){if(table==='admin_users')return single?{user_id:state.user.id}:[{user_id:state.user.id}];if(table==='delivery_settings')return {lalamove_ambiente:state.environment,delivery_ativa:state.deliveryActive};if(table==='orders'){const selected=filters.id?state.orders.find(order=>String(order.id)===String(filters.id)):null;if(!single)state.orderFetchCount++;return single?(selected||state.order):state.orders;}if(['products','product_sales_rules','product_requests'].includes(table))return single?null:[];return single?null:[];}",
    " function from(table){let operation='select',filters={};const q={select(){return q;},update(values){operation='update';if(table==='delivery_settings'){if(values.lalamove_ambiente!==undefined)state.environment=values.lalamove_ambiente;if(values.delivery_ativa!==undefined)state.deliveryActive=values.delivery_ativa;}if(table==='orders')Object.assign(state.orders.find(order=>String(order.id)===String(filters.id))||state.order,values);return q;},eq(column,value){filters[column]=value;return q;},in(){return q;},order(){return q;},limit(){return q;},range(){return q;},maybeSingle(){return Promise.resolve({data:dataFor(table,true,filters),error:null});},then(ok,fail){return Promise.resolve({data:dataFor(table,false,filters),error:null}).then(ok,fail);}};return q;}",
    " return {__state:state,resetOrder(){state.order.lalamove_status=null;state.order.lalamove_status_updated_at=null;state.order.lalamove_tracking_url=null;},auth:{getSession:async()=>({data:{session:{user:state.user}},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})},from,rpc:async(name,args)=>{if(name==='set_order_separated_items'){const target=state.orders.find(order=>String(order.id)===String(args.p_order_id));if(target)target.separated_items=[...args.p_item_keys];state.separationWrites.push({order_id:args.p_order_id,item_keys:[...args.p_item_keys]});return {data:true,error:null};}return {data:name==='admin_get_cost_report_with_delivery'?{products:[{id:'feiraja_banana_prata',name:'Banana Prata',category:'Frutas',price:10,available:true,unit_cost:6,updated_at:'2026-11-16T12:00:00Z'}],summary:{orders:2,sales_total:100,known_revenue:100,known_cost:60,profit:40,profit_percent:40,missing_cost_items:0,calculated_items:1,total_items:1,invalid_items:0,delivery_fee_revenue:30,delivery_actual_cost:18,profit_after_delivery:52}}:name==='admin_get_low_margin_percent'?{low_margin_percent:20}:null,error:null};},functions:{invoke:async(name,options)=>{const action=options.body.action;state.calls.push({name,action,environment:state.environment,testProductionConfirmed:options.body.test_production_confirmed===true});if(action==='quote')return {error:null,data:{environment:state.environment,quote_session_id:'00000000-0000-4000-8000-000000000001',selected_vehicle:'MOTO',moto:{fee:12.05,difference:-3.95},car:{fee:14.40,difference:-1.60}}};if(action==='create'){state.order.lalamove_status='searching';state.order.lalamove_status_updated_at=new Date().toISOString();state.order.lalamove_tracking_url='https://track.example.test/mock';state.order.delivery_vehicle=options.body.vehicle;return {error:null,data:{created:true,vehicle:options.body.vehicle,tracking_url:state.order.lalamove_tracking_url}};}return {error:null,data:{}};}},storage:{from:()=>({upload:async()=>({data:{},error:null}),remove:async()=>({data:[],error:null})})}};",
    "})();",
    "window.FeiraTurnstile={create:()=>({init(){},getToken:()=>'',reset(){}})};",
    "window.FeiraLalamoveMap={mountAll(){}};",
    "</script>"
  ].join("\n");
}

function prepareHtml(source) {
  const calendar=fs.readFileSync(path.join(process.cwd(),"supabase/functions/_shared/commercial-calendar.js"),"utf8").replace(/\bexport\s+/g,"");
  let html=source
    .replace(/<script>try\{if\("serviceWorker"[\s\S]*?<\/script>/i,"")
    .replace(/<link rel=\"manifest\"[^>]*>/i,"")
    .replace(/<link rel=\"preconnect\"[^>]*>/gi,"")
    .replace(/<link href=\"https:\/\/fonts\.googleapis\.com[^>]*>/gi,"")
    .replace(/<script src=\"\.\/turnstile\.js\" defer><\/script>/i,"")
    .replace(/<script src=\"\.\/lalamove-map\.js\"><\/script>/i,"");
  html=html.replace(/<script type=\"module\">([\s\S]*?)<\/script>/gi,(_all,code)=>{
    code=code.replace(/^\s*import\s*\{\s*createClient\s*\}\s*from\s*['\"]https:\/\/esm\.sh\/@supabase\/supabase-js@2\.117\.1['\"];\s*/m,"");
    code=code.replace(/^\s*import\s*\{\s*upcomingHolidays\s*\}\s*from\s*['\"]\.\/supabase\/functions\/_shared\/commercial-calendar\.js[^'\"]*['\"];\s*/m,"");
    code=code.replace(/const db=createClient\([\s\S]*?\);\s*/,"const db=window.__testDb;\n");
    return "<script>"+code+"</script>";
  });
  return html.replace("<body",makeBootstrap()+"<script>"+calendar+"</script><body");
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
      await page.locator("#tabSettings").click();
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
      await page.locator("#tabProducts").click();
      const productSubtabs=[
        ["#productsMainTab",".unified-products"],
        ["#productsMissingBalconyTab","#missingBalconySection"],
        ["#productsReviewTab","#automaticPriceReview"],
        ["#productsRequestsTab","#productRequests"]
      ];
      await page.locator("#productsMainTab").click();
      await page.locator("#unifiedProductSearch").fill("banana");
      await page.locator("#clearUnifiedProductSearch").click();
      if(await page.locator("#unifiedProductSearch").inputValue()!=="")throw new Error("O botão Limpar não limpou a busca do catálogo.");
      for(const [tab,section] of productSubtabs){
        await page.locator(tab).click();
        if(await page.locator(section).isHidden())throw new Error("Sub-aba de Produtos não abriu: "+tab);
      }
      if(errors.length)throw new Error("Erros JS/console ao abrir as quatro sub-abas de Produtos: "+errors.join("\\n"));
      await page.locator("#productsMainTab").click();
      await page.locator("#tabOrders").click();
      await page.locator("#filter").selectOption("tests");
      await page.waitForSelector("[data-order-toggle]");
      await page.locator('[data-order-toggle="TEST-6259DB63"]').click();
      await page.waitForSelector('[data-lalamove-quote="TEST-6259DB63"]');

      await page.locator("#tabSettings").click();
      await page.locator("#lalamoveEnvironmentSelect").selectOption("producao");
      await page.getByRole("dialog").getByRole("button",{name:"Confirmar Produção"}).click();
      await page.waitForFunction(()=>document.getElementById("lalamoveSettingsBadge")?.textContent==="PRODUÇÃO");
      await page.locator("#tabOrders").click();
      if(await page.locator('[data-order-content="TEST-6259DB63"]').isHidden())await page.locator('[data-order-toggle="TEST-6259DB63"]').click();
      await page.locator('[data-lalamove-quote="TEST-6259DB63"]').click();
      await page.getByRole("dialog").getByRole("button",{name:"Continuar"}).click();
      const productionQuote=page.locator('[data-lalamove-quote-box="TEST-6259DB63"]');
      await productionQuote.waitFor({state:"visible"});
      const productionText=await productionQuote.textContent();
      if(!productionText.includes("Produção")||!productionText.includes("12,05")||!productionText.includes("14,40"))throw new Error("Cotação de Produção não exibiu ambiente e preços mockados: "+productionText);
      await productionQuote.locator('[data-lalamove-vehicle="CAR"]').click();
      await productionQuote.locator("[data-lalamove-confirm]").click();
      const productionWarning = await page.getByRole("dialog").locator("#appDialogMessage").textContent();
      const expectedTestWarning = "ATENÇÃO: este é um pedido de TESTE, mas a corrida será REAL e cobrada do saldo da Lalamove. Confirmar?";
      if(productionWarning!==expectedTestWarning)throw new Error("O painel não mostrou a confirmação obrigatória para pedido teste em Produção: "+productionWarning);
      await page.getByRole("dialog").getByRole("button",{name:"Confirmar?"}).click();
      const productionFlagSent=await page.evaluate(()=>window.__testDb.__state.calls.findLast(x=>x.action==="create"&&x.environment==="producao")?.testProductionConfirmed===true);
      if(!productionFlagSent)throw new Error("A flag de confirmação de corrida real não foi enviada.");
      await page.waitForFunction(()=>document.querySelector("[data-lalamove-status-label]")?.textContent.includes("Procurando entregador"));
      if(await page.locator("[data-lalamove-map]").count()!==1)throw new Error("Status/rastreio não apareceu após criação mockada em Produção.");

      await page.evaluate(()=>window.__testDb.resetOrder());
      await page.locator("#refresh").evaluate(button=>button.click());
      await page.waitForSelector("[data-order-toggle]");
      if(await page.locator('[data-order-content="TEST-6259DB63"]').isHidden())await page.locator('[data-order-toggle="TEST-6259DB63"]').click();
      await page.waitForSelector('[data-lalamove-quote="TEST-6259DB63"]');
      await page.locator("#tabSettings").click();
      await page.locator("#lalamoveEnvironmentSelect").selectOption("sandbox");
      await page.waitForFunction(()=>document.getElementById("lalamoveSettingsBadge")?.textContent==="SANDBOX");
      await page.locator("#tabOrders").click();
      if(await page.locator('[data-order-content="TEST-6259DB63"]').isHidden())await page.locator('[data-order-toggle="TEST-6259DB63"]').click();
      await page.locator('[data-lalamove-quote="TEST-6259DB63"]').click();
      await page.getByRole("dialog").getByRole("button",{name:"Continuar"}).click();
      const sandboxQuote=page.locator('[data-lalamove-quote-box="TEST-6259DB63"]');
      await sandboxQuote.waitFor({state:"visible"});
      if(!(await sandboxQuote.textContent()).includes("Sandbox"))throw new Error("Cotação não identificou Sandbox.");
      await sandboxQuote.locator('[data-lalamove-vehicle="MOTO"]').click();
      await sandboxQuote.locator("[data-lalamove-confirm]").click();
      await page.waitForFunction(()=>document.querySelector("[data-lalamove-status-label]")?.textContent.includes("Procurando entregador"));
      if(await page.locator("[data-lalamove-map]").count()!==1)throw new Error("Status/rastreio não apareceu após criação mockada em Sandbox.");

      // Retorna ao filtro padrão: pedidos reais ativos aparecem; o pedido de teste fica fora da lista.
      await page.locator("#filter").selectOption("active");
      // Três marcações consecutivas no pedido do meio: o card permanece aberto e a rolagem não salta.
      await page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:async payload=>{window.__sharedPayload=payload;}}));
      const middleToggle=page.locator('[data-order-toggle="ORDER-MIDDLE-002"]');
      await middleToggle.click();
      const middleContent=page.locator('[data-order-content="ORDER-MIDDLE-002"]');
      await middleContent.scrollIntoViewIfNeeded();
      const scrollBefore=await page.evaluate(()=>window.scrollY);
      const separationButtons=middleContent.locator('[data-separate-order="ORDER-MIDDLE-002"]');
      if(await separationButtons.count()!==3)throw new Error("O pedido do meio deveria ter exatamente três itens.");
      for(let index=0;index<3;index++){
        await separationButtons.nth(index).click();
        await page.waitForFunction(expected=>window.__testDb.__state.separationWrites.length===expected,index+1);
        if(await middleContent.isHidden())throw new Error("O card do pedido do meio fechou após marcar o item "+(index+1)+".");
        const countText=await middleContent.locator('[data-separated-count]').textContent();
        if(countText!==(index+1)+" de 3 separados")throw new Error("Contador incorreto após marcar item: "+countText);
        const currentScroll=await page.evaluate(()=>window.scrollY);
        if(Math.abs(currentScroll-scrollBefore)>1)throw new Error("A rolagem mudou após marcar o item "+(index+1)+".");
      }
      const savedSeparation=await page.evaluate(()=>window.__testDb.__state.middleOrder.separated_items);
      if(!Array.isArray(savedSeparation)||savedSeparation.length!==3)throw new Error("A marcação dos três itens não foi persistida no banco mockado.");
      // A mesma atualização usada pelo polling automático mantém o card aberto e o scroll.
      const fetchCountBefore=await page.evaluate(()=>window.__testDb.__state.orderFetchCount);
      await page.evaluate(()=>{const state=window.__testDb.__state;state.middleOrder={...state.middleOrder,status:'Pronto para Retirada'};state.orders=state.orders.map(order=>String(order.id)===state.middleOrder.id?state.middleOrder:order);document.querySelector('#refresh').click();});
      await page.waitForFunction(previous=>window.__testDb.__state.orderFetchCount>previous,fetchCountBefore);
      await page.waitForFunction(()=>document.querySelector('[data-order-content="ORDER-MIDDLE-002"]')?.hidden===false);
      await page.waitForFunction(expected=>Math.abs(window.scrollY-expected)<=1,scrollBefore);
      if(await page.locator('[data-order-content="ORDER-MIDDLE-002"]').isHidden())throw new Error("A atualização automática da lista fechou o card aberto.");
      if(await page.locator('#status-ORDER-MIDDLE-002').inputValue()!=="Pronto para Retirada")throw new Error("A atualização automática não refletiu o status novo.");
      if(Math.abs((await page.evaluate(()=>window.scrollY))-scrollBefore)>1)throw new Error("A atualização automática da lista alterou a rolagem.");
      if(await page.locator('[data-order-content="ORDER-MIDDLE-002"] [data-separated-count]').textContent()!=="3 de 3 separados")throw new Error("O contador foi perdido após atualização automática.");

      // Compartilhar pedido e lista consolidada: somente itens, quantidades/unidades e observações.
      await page.locator('[data-share-order-list="ORDER-MIDDLE-002"]').click();
      await page.waitForFunction(()=>window.__sharedPayload?.text?.includes("Banana Prata"));
      const orderShare=await page.evaluate(()=>window.__sharedPayload.text);
      if(!orderShare.includes("✅ Banana Prata — 1,5 kg")||!orderShare.includes("Observação: Bem maduras"))throw new Error("A lista do pedido não incluiu status/observação do item: "+orderShare);
      if(/92911112222|privado|@privado|Cliente do meio/i.test(orderShare))throw new Error("A lista individual incluiu dados pessoais do cliente.");
      await page.evaluate(()=>{window.__sharedPayload=null;});
      await page.locator("#shoppingListButton").click();
      await page.waitForFunction(()=>window.__sharedPayload?.text?.includes("Lista de compras"));
      const allShare=await page.evaluate(()=>window.__sharedPayload.text);
      const normalizedAllShare=allShare.replace(/\s+/g,' ');
      if(!normalizedAllShare.includes("Banana Prata — 3,5 kg")||!normalizedAllShare.includes("Coco — R$ 15,00 (~1,5 kg)")||!normalizedAllShare.includes("Tomate — 2 un"))throw new Error("A lista consolidada não somou produtos/unidades e compra por valor: "+allShare);
      if(!allShare.includes("Bem maduras | Sem manchas")||allShare.includes("Produto de teste oculto")||/92999990000|92911112222|92933334444|@privado|endereço privado|lucro|custo/i.test(allShare))throw new Error("A lista consolidada perdeu observações, incluiu pedido de teste ou expôs dados/custos: "+allShare);
      // Sem Web Share nativo, copia o texto e mostra o aviso do app.
      await page.evaluate(()=>{window.__copiedText='';Object.defineProperty(navigator,'share',{configurable:true,value:undefined});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copiedText=value;}}});});
      await page.locator('[data-share-order-list="ORDER-MIDDLE-002"]').click();
      await page.waitForFunction(()=>window.__copiedText.includes("Lista de compras"));
      if(!(await page.locator("#notice").textContent()).includes("Texto copiado"))throw new Error("Fallback de cópia não exibiu aviso do app.");

      const calls=await page.evaluate(()=>window.__testDb.__state.calls);
      if(calls.filter(x=>x.action==="quote").length!==2||calls.filter(x=>x.action==="create").length!==2)throw new Error("Esperadas duas cotações e duas criações mockadas.");
      if(!calls.some(x=>x.action==="create"&&x.environment==="producao")||!calls.some(x=>x.action==="create"&&x.environment==="sandbox"))throw new Error("As criações não respeitaram o ambiente escolhido.");
      if(!calls.find(x=>x.action==="create"&&x.environment==="producao")?.testProductionConfirmed)throw new Error("Flag de confirmação não foi enviada para Produção.");
      if(calls.find(x=>x.action==="create"&&x.environment==="sandbox")?.testProductionConfirmed)throw new Error("Sandbox recebeu flag de confirmação de corrida real indevidamente.");
      if(errors.length)throw new Error("Erros JS/console no painel "+width+"px:\n"+errors.join("\n"));
      if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error("Rolagem horizontal no painel "+width+"px.");
      await page.screenshot({path:"artifacts/painel-full-html-lalamove-"+width+".png",fullPage:true});
      await page.close();
    }
  }finally{await browser.close();}
  console.log("HTML integral do painel: sessão admin simulada, clique real, cotação/confirmação/criação/rastreio mockados em Produção e Sandbox; zero pageerror/console.error em 360/412px.");
})().catch(error=>{console.error(error);process.exit(1);});

// Parte 2b: cobertura de abertura das quatro sub-abas de Produtos e limpeza da busca.
