const fs=require("node:fs");
const path=require("node:path");
const {chromium}=require("playwright");

function bootstrap(){
 return `<script>
 window.__testDb=(()=>{
  const state={products:[{id:"seed-frutas",name:"Banana teste",price:5,category:"Frutas",image:null,available:true,resale_enabled:false,resale_price:null,resale_min_qty:10,resale_unit:"un",old_price:null},{id:"seed-polpas",name:"Polpa teste",price:12,category:"Polpas e Congelados",image:null,available:true,resale_enabled:false,resale_price:null,resale_min_qty:10,resale_unit:"un",old_price:null},{id:"seed-low",name:"Margem baixa teste",price:10,category:"Frutas",image:null,available:true,resale_enabled:false,resale_price:null,resale_min_qty:10,resale_unit:"un",old_price:null},{id:"seed-cheap",name:"Preço pendente teste",price:0.01,category:"Frutas",image:null,available:false,resale_enabled:false,resale_price:null,resale_min_qty:10,resale_unit:"un",old_price:null}],rpcCalls:[]};
  const costs={"seed-frutas":4,"seed-low":9};
  function from(table){
   let op="select",values=null,filters={};
   const q={
    select(){return q;},update(v){op="update";values=v;return q;},
    eq(k,v){filters[k]=v;return q;},neq(){return q;},in(){return q;},order(){return q;},limit(){return q;},range(){return q;},
    maybeSingle(){let rows=table==="products"?state.products.filter(p=>Object.entries(filters).every(([k,v])=>p[k]===v)):[];if(table==="admin_users")return Promise.resolve({data:{user_id:"admin-test"},error:null});if(table==="delivery_settings")return Promise.resolve({data:{lalamove_ambiente:"sandbox",delivery_ativa:false},error:null});if(op==="update"){rows.forEach(p=>Object.assign(p,values));}return Promise.resolve({data:rows[0]||null,error:null});},
    single(){return q.maybeSingle();},
    then(resolve,reject){let rows=table==="products"?state.products.slice():[];if(op==="update")rows=rows.filter(p=>Object.entries(filters).every(([k,v])=>p[k]===v)).map(p=>Object.assign(p,values));return Promise.resolve({data:rows,error:null}).then(resolve,reject);}
   };return q;
  }
  return {__state:state,auth:{getSession:async()=>({data:{session:{user:{id:"admin-test",is_anonymous:false}}},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})},
   from,rpc:async(name,args)=>{state.rpcCalls.push({name,args});if(name==="admin_create_product_with_sales_rule"){state.products.push({id:args.p_id,name:args.p_name,price:args.p_price,category:args.p_category,image:args.p_image,available:true,resale_enabled:false,resale_price:null,resale_min_qty:10,resale_unit:"un",old_price:null});return {data:true,error:null};}if(name==="admin_get_cost_report_with_delivery"){const products=state.products.map(p=>({...p,unit_cost:Object.prototype.hasOwnProperty.call(costs,p.id)?costs[p.id]:null,updated_at:null}));const calculated=products.filter(p=>p.unit_cost!=null).length;return {data:{products,summary:{orders:1,sales_total:100,known_revenue:20,known_cost:13,profit:7,profit_percent:35,missing_cost_items:products.length-calculated,calculated_items:calculated,total_items:products.length,delivery_fee_revenue:0,delivery_actual_cost:0,profit_after_delivery:7}},error:null};}if(name==="admin_get_low_margin_percent")return {data:{low_margin_percent:20},error:null};return {data:true,error:null};},
   functions:{invoke:async()=>({data:{},error:null})},
   storage:{from:()=>({upload:async()=>({data:{},error:null}),remove:async()=>({data:[],error:null}),getPublicUrl:()=>({data:{publicUrl:"https://mock.invalid/photo.jpg"}})})}
  };
 })();
 window.FeiraTurnstile={create:()=>({init(){},getToken:()=>"",reset(){}})};
 window.FeiraLalamoveMap={mountAll(){}};
 <\/script>`;
}
function prepare(source){
 const calendar=fs.readFileSync(path.join(process.cwd(),"supabase/functions/_shared/commercial-calendar.js"),"utf8").replace(/\bexport\s+/g,"");
 let html=source.replace(/<script>try\{if\("serviceWorker"[\s\S]*?<\/script>/i,"")
  .replace(/<link rel="manifest"[^>]*>/gi,"").replace(/<link rel="preconnect"[^>]*>/gi,"")
  .replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/gi,"")
  .replace(/<script src="\.\/turnstile\.js" defer><\/script>/i,"")
  .replace(/<script src="\.\/lalamove-map\.js"><\/script>/i,"");
 html=html.replace(/<script type="module">([\s\S]*?)<\/script>/i,(_all,code)=>{
  code=code.replace(/^\s*import\s*\{\s*createClient\s*\}\s*from\s*['"]https:\/\/esm\.sh\/@supabase\/supabase-js@2\.117\.1['"];\s*/m,"")
   .replace(/^\s*import\s*\{\s*upcomingHolidays\s*\}\s*from\s*['"]\.\/supabase\/functions\/_shared\/commercial-calendar\.js[^'"]*['"];\s*/m,"")
   .replace(/const db=createClient\([\s\S]*?\);\s*/,"const db=window.__testDb;\n");
  return "<script>"+code+"</script>";
 });
 return html.replace("<body",bootstrap()+"<script>"+calendar+"</script><body");
}
(async()=>{
 const source=fs.readFileSync(path.join(process.cwd(),"painel.html"),"utf8");
 const browser=await chromium.launch({headless:true});
 try{
  for(const width of [360,412]){
   const page=await browser.newPage({viewport:{width,height:900},deviceScaleFactor:1});
   const errors=[];
   page.on("pageerror",e=>errors.push(e.message));
   page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
   await page.setContent(prepare(source),{waitUntil:"domcontentloaded"});
   await page.waitForFunction(()=>!document.getElementById("panel")?.classList.contains("hidden"),{timeout:15000});
   await page.locator("#tabProducts").click();
   await page.waitForFunction(()=>!document.querySelector("#openNewProduct")?.disabled,{timeout:10000});
   const categories=await page.locator("#sheetCategory option").allTextContents();
   if(!categories.includes("Frutas")||!categories.includes("Polpas e Congelados"))throw new Error("Categorias da vitrine não carregaram no seletor: "+categories.join(", "));
   await page.locator("#openNewProduct").click();
   if(await page.locator("#productSheetBackdrop").isHidden())throw new Error(width+"px: Adicionar produto não abriu a ficha.");
   if((await page.locator("#sheetName").inputValue())!=="")throw new Error("A ficha de novo produto não abriu vazia.");
   await page.locator("#sheetName").fill("Produto Playwright");
   await page.locator("#sheetPrice").fill("12,50");
   await page.locator("#sheetCategory").selectOption("Polpas e Congelados");
   await page.locator("#saveProductSheet").click();
   await page.waitForFunction(()=>window.__testDb.__state.products.length===5,{timeout:10000});
   if(await page.locator("#productSheetBackdrop").isVisible())throw new Error("A ficha não fechou após salvar.");
   await page.waitForFunction(()=>document.getElementById("costReportMessage")?.textContent.includes("Lucro calculado sobre 2 de 5 itens"),{timeout:10000});
   const missingOption=await page.locator("#unifiedCostFilter option[value=missing]").textContent();
   if(!missingOption.includes("(3)"))throw new Error("Contador de produtos sem custo incorreto: "+missingOption);
   await page.locator("#unifiedCostFilter").selectOption("missing");
   const missingRows=await page.locator("#unifiedProductList .unified-product-row").allTextContents();
   if(!missingRows.some(text=>text.includes("Polpa teste"))||!missingRows.some(text=>text.includes("Preço pendente teste")))throw new Error("Filtro sem custo não listou os produtos esperados.");
   if(!missingRows.some(text=>text.includes("Custo não cadastrado")))throw new Error("Produto sem custo não recebeu o rótulo correto.");
   await page.locator("#unifiedCostFilter").selectOption("");
   const lowMarginText=await page.locator('[data-open-product="seed-low"]').textContent();
   if(!lowMarginText.includes("Margem baixa"))throw new Error("Selo laranja de margem baixa ausente.");
   const cheapToggle=page.locator('[data-quick-availability="seed-cheap"]');
   await cheapToggle.click();
   if(await cheapToggle.isChecked())throw new Error("Produto a R$ 0,01 foi disponibilizado.");
   if(await page.evaluate(()=>window.__testDb.__state.products.find(p=>p.id==="seed-cheap").available))throw new Error("O estado do produto de R$ 0,01 foi alterado.");
   await page.locator('[data-open-product="seed-frutas"]').click();
   if(await page.locator("#productSheetBackdrop").isHidden())throw new Error("Editar produto não abriu a ficha.");
   if(await page.locator("#sheetCategory").inputValue()!=="Frutas")throw new Error("Editar produto não preservou a categoria existente.");
   const editCategories=await page.locator("#sheetCategory option").allTextContents();
   if(!editCategories.includes("Polpas e Congelados"))throw new Error("Editar produto não carregou a lista completa de categorias.");
   await page.locator("#closeProductSheet").click();
   await page.locator("#tabOrders").click();
   await page.locator("#tabProducts").click();
   await page.locator("#lalamoveSettingsCard").evaluate(el=>el.scrollIntoView());
   await page.waitForTimeout(150);
   if(errors.length)throw new Error(width+"px: erros de console: "+errors.join(" | "));
   await page.close();
  }
 }finally{await browser.close();}
 console.log("Painel financeiro/produtos: OK em 360px e 412px; filtro sem custo, contador, lucro X/Y, selo de margem, bloqueio R$ 0,01 e zero erros de console.");
})().catch(error=>{console.error(error);process.exit(1);});
