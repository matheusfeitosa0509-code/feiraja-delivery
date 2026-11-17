const fs=require("node:fs");
const path=require("node:path");
const {chromium}=require("playwright");

function bootstrap(){
 return `<script>
 window.__testDb=(()=>{
  const state={products:[],rpcCalls:[]};
  function from(table){
   let op="select",values=null,filters={};
   const q={
    select(){return q;},update(v){op="update";values=v;return q;},
    eq(k,v){filters[k]=v;return q;},neq(){return q;},in(){return q;},order(){return q;},limit(){return q;},range(){return q;},
    maybeSingle(){let rows=table==="products"?state.products.filter(p=>Object.entries(filters).every(([k,v])=>p[k]===v)):[];if(op==="update"){rows.forEach(p=>Object.assign(p,values));}return Promise.resolve({data:rows[0]||null,error:null});},
    single(){return q.maybeSingle();},
    then(resolve,reject){let rows=table==="products"?state.products.slice():[];if(op==="update")rows=rows.filter(p=>Object.entries(filters).every(([k,v])=>p[k]===v)).map(p=>Object.assign(p,values));return Promise.resolve({data:rows,error:null}).then(resolve,reject);}
   };return q;
  }
  return {__state:state,auth:{getSession:async()=>({data:{session:{user:{id:"admin-test",is_anonymous:false}}},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})},
   from,rpc:async(name,args)=>{state.rpcCalls.push({name,args});if(name==="admin_create_product_with_sales_rule"){state.products.push({id:args.p_id,name:args.p_name,price:args.p_price,category:args.p_category,image:args.p_image,available:true,resale_enabled:false,resale_price:null,resale_min_qty:10,resale_unit:"un",old_price:null});return {data:true,error:null};}if(name==="admin_get_cost_report")return {data:{products:[],summary:{}},error:null};if(name==="get_sales_settings")return {data:{low_margin_percent:20},error:null};return {data:true,error:null};},
   functions:{invoke:async()=>({data:{},error:null})},
   storage:{from:()=>({upload:async()=>({data:{},error:null}),remove:async()=>({data:[],error:null}),getPublicUrl:()=>({data:{publicUrl:"https://mock.invalid/photo.jpg"}})})}
  };
 })();
 window.FeiraTurnstile={create:()=>({init(){},getToken:()=>"",reset(){}})};
 window.FeiraLalamoveMap={mountAll(){}};
 <\/script>`;
}
function prepare(source){
 let html=source.replace(/<script>try\\{if\\("serviceWorker"[\\s\\S]*?<\\/script>/i,"")
  .replace(/<link rel="manifest"[^>]*>/gi,"").replace(/<link rel="preconnect"[^>]*>/gi,"")
  .replace(/<link href="https:\\/\\/fonts\\.googleapis\\.com[^>]*>/gi,"")
  .replace(/<script src="\\.\\/turnstile\\.js" defer><\\/script>/i,"")
  .replace(/<script src="\\.\\/lalamove-map\\.js"><\\/script>/i,"");
 html=html.replace(/<script type="module">([\\s\\S]*?)<\\/script>/i,(_all,code)=>{
  code=code.replace(/^\\s*import\\s*\\{\\s*createClient\\s*\\}\\s*from\\s*['"]https:\\/\\/esm\\.sh\\/@supabase\\/supabase-js@2\\.117\\.1['"];\\s*/m,"")
   .replace(/const db=createClient\\([\\s\\S]*?\\);\\s*/,"const db=window.__testDb;\\n");
  return "<script>"+code+"</script>";
 });
 return html.replace("<body",bootstrap()+"<body");
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
   await page.locator("#openNewProduct").click();
   if(await page.locator("#productSheetBackdrop").isHidden())throw new Error(width+"px: Adicionar produto não abriu a ficha.");
   if((await page.locator("#sheetName").inputValue())!=="")throw new Error("A ficha de novo produto não abriu vazia.");
   await page.locator("#sheetName").fill("Produto Playwright");
   await page.locator("#sheetPrice").fill("12,50");
   await page.locator("#sheetCategory").selectOption("Frutas");
   await page.locator("#saveProductSheet").click();
   await page.waitForFunction(()=>window.__testDb.__state.products.length===1,{timeout:10000});
   if(await page.locator("#productSheetBackdrop").isVisible())throw new Error("A ficha não fechou após salvar.");
   await page.locator("#tabOrders").click();
   await page.locator("#tabProducts").click();
   await page.locator("#lalamoveSettingsCard").evaluate(el=>el.scrollIntoView());
   await page.waitForTimeout(150);
   if(errors.length)throw new Error(width+"px: erros de console: "+errors.join(" | "));
   await page.close();
  }
 }finally{await browser.close();}
 console.log("Painel produto novo: OK em 360px e 412px; ficha abre vazia, cadastro mockado salva e sem erros de console.");
})().catch(error=>{console.error(error);process.exit(1);});
