const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../escritorio');
const repoRoot = path.resolve(__dirname, '..');
const mockModule = `
export function createClient(){
 const agents=[
  {id:'a-ceo',slug:'ceo',name:'CEO',role:'Estratégia e decisões',color:'#d9a441',status:'livre'},
  {id:'a-exec',slug:'executora',name:'Executora',role:'Tecnologia e operação',color:'#3478c8',status:'trabalhando'},
  {id:'a-mark',slug:'marketing',name:'Marketing',role:'Campanhas e comunicação',color:'#e66b43',status:'livre'},
  {id:'a-art',slug:'artes',name:'Artes',role:'Identidade visual e fotografia',color:'#9a68c9',status:'livre'},
  {id:'a-sac',slug:'sac',name:'SAC',role:'Atendimento',color:'#269c91',status:'livre'}
 ];
 const tasks=[{id:'t-1',agent_id:'a-exec',title:'Revisar o funil Pago',details:'Validar contagem e transições.',priority:'urgente',status:'fazendo',created_at:new Date().toISOString()}];
 const approvals=[{id:'ap-1',task_id:'t-1',requested_by:'a-exec',question:'Aprovar a revisão do funil?',options:[],decision:null}];
 const messages=[{id:'m-1',from_agent:'a-mark',to_agent:null,task_id:null,body:'As artes da semana estão em preparação.',created_at:new Date().toISOString()}];
 const data={
  admin_users:[{user_id:'owner'}],agents,agent_tasks:tasks,agent_messages:messages,owner_approvals:approvals,
  orders:[{total:50.99,status:'Pedido Recebido',created_at:new Date().toISOString(),is_test_order:false}],
  admin_alerts:[],daily_recipe_kits:[{name:'Kit demonstração',fixed_price:50.99,weekday:3,is_active:true}]
 };
 return {
  auth:{getSession:async()=>({data:{session:window.__officeMockSession||null},error:null}),signInWithPassword:async()=>({error:null}),signOut:async()=>({error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
  from(table){
   const q={_filters:[],select(){return this},eq(k,v){this._filters.push([k,v]);return this},in(k,v){this._filters.push([k,v]);return this},not(){return this},gte(){return this},lt(){return this},or(){return this},is(){return this},order(){return this},limit(){return this},maybeSingle(){return Promise.resolve({data:data[table]?.[0]||null,error:null})},then(resolve,reject){let rows=data[table]||[];for(const [k,v] of this._filters)rows=rows.filter(x=>Array.isArray(v)?v.includes(x[k]):x[k]===v);return Promise.resolve({data:rows,count:table==='admin_alerts'?2:undefined,error:null}).then(resolve,reject)},update(){return {eq:async()=>({error:null})}},insert(){return Promise.resolve({error:null})}};
   return q;
  }
 };
}
`;
const server=http.createServer((req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const file=pathname.startsWith('/supabase/')?path.join(repoRoot,pathname.replace(/^\\//,'')):path.join(root,pathname==='/'?'index.html':pathname.replace(/^\\//,''));
 if(!file.startsWith(root)&&!file.startsWith(path.join(repoRoot,'supabase'))){res.writeHead(403);return res.end();}
 fs.readFile(file,(err,buf)=>{if(err){res.writeHead(404);return res.end('not found');}const ext=path.extname(file);const types={'.html':'text/html','.js':'text/javascript','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};res.writeHead(200,{'content-type':types[ext]||'application/octet-stream'});res.end(buf);});
});
(async()=>{
 await new Promise(resolve=>server.listen(4173,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:360,height:800},deviceScaleFactor:1,serviceWorkers:'block'});
  await context.route('https://esm.sh/@supabase/supabase-js@2.57.4',route=>route.fulfill({status:200,contentType:'application/javascript',body:mockModule}));
  const login=await context.newPage();
  await login.goto('http://127.0.0.1:4173/');
  await login.locator('#login').waitFor({state:'visible'});
  await login.screenshot({path:'artifacts/escritorio-login-360.png',fullPage:true});
  const page=await context.newPage();
  await page.addInitScript(()=>{window.__officeMockSession={user:{id:'owner',email:'owner@example.test'}};});
  await page.goto('http://127.0.0.1:4173/');
  await page.locator('#app:not(.hidden)').waitFor();
  await page.locator('#approvals .approval').waitFor();
  await page.locator('#officeMapSvg').waitFor();
  await page.locator('#officeMapSvg [data-agent]').first().waitFor();
  await page.screenshot({path:'artifacts/escritorio-mapa-360.png',fullPage:true});
  await page.screenshot({path:'artifacts/escritorio-esperando-dono-360.png',fullPage:true});
  await page.locator('#officeMapSvg [data-agent="a-exec"]').click();
  await page.locator('#agentDetail').waitFor({state:'visible'});
  await page.screenshot({path:'artifacts/escritorio-agente-360.png',fullPage:true});
  await page.locator('#closeAgent').click();
  await page.screenshot({path:'artifacts/escritorio-painel-360.png',fullPage:true});
  console.log('Screenshots 360px gerados com dados fictícios e mock local; nenhuma chamada ao banco real.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
