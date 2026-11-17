const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const products = [
  { id:'p-01', name:'Produto Banana (kg)', price:8.99, old_price:null, category:'Produtos teste', image:'', available:true, resale_enabled:false, resale_price:null, resale_min_qty:null, resale_unit:'kg' },
  { id:'p-02', name:'Produto Cupuaçu (un)', price:12, old_price:18, category:'Produtos teste', image:'', available:true, resale_enabled:true, resale_price:10, resale_min_qty:10, resale_unit:'un' },
  { id:'p-03', name:'Produto Goiaba (kg)', price:9, old_price:12, category:'Produtos teste', image:'', available:true, resale_enabled:true, resale_price:7.5, resale_min_qty:10, resale_unit:'kg' },
  { id:'p-04', name:'Produto Manga (un)', price:10, old_price:null, category:'Produtos teste', image:'', available:true, resale_enabled:false, resale_price:null, resale_min_qty:null, resale_unit:'un' },
  { id:'p-05', name:'Produto Taperebá (kg)', price:11, old_price:null, category:'Produtos teste', image:'', available:true, resale_enabled:true, resale_price:9, resale_min_qty:10, resale_unit:'kg' },
  { id:'p-06', name:'Produto Uva (un)', price:15, old_price:20, category:'Produtos teste', image:'', available:true, resale_enabled:false, resale_price:null, resale_min_qty:null, resale_unit:'un' },
];
const rules = [{"product_id":"p-01","sale_unit":"kg","quantity_step":0.5,"min_quantity":0.5,"max_quantity":100,"allow_value_sale":false,"value_min_kg":0.5},{"product_id":"p-02","sale_unit":"un","quantity_step":1,"min_quantity":1,"max_quantity":100,"allow_value_sale":true,"value_min_kg":0.5},{"product_id":"p-03","sale_unit":"kg","quantity_step":0.5,"min_quantity":0.5,"max_quantity":100,"allow_value_sale":true,"value_min_kg":0.5},{"product_id":"p-04","sale_unit":"un","quantity_step":1,"min_quantity":1,"max_quantity":100,"allow_value_sale":false,"value_min_kg":0.5},{"product_id":"p-05","sale_unit":"kg","quantity_step":0.5,"min_quantity":0.5,"max_quantity":100,"allow_value_sale":false,"value_min_kg":0.5},{"product_id":"p-06","sale_unit":"un","quantity_step":1,"min_quantity":1,"max_quantity":100,"allow_value_sale":true,"value_min_kg":0.5}];

(async () => {
  const root = process.cwd();
  const source = fs.readFileSync(path.join(root, 'loja.html'), 'utf8');
  const helper = fs.readFileSync(path.join(root, 'loja-delivery-ui.js'), 'utf8').replace(/\bexport\s+/g, '');
  const schedule = fs.readFileSync(path.join(root, 'supabase/functions/_shared/store-schedule.js'), 'utf8').replace(/\bexport\s+/g, '');
  const bootstrap = '<script>' +
    'window.__testSupabase={' +
    'auth:{getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})},' +
    'from:table=>{const q={select(){return q},eq(){return q},neq(){return q},in(){return q},order(){return q},limit(){return q},range(){return q},gte(){return q},lte(){return q},or(){return q},not(){return q},is(){return q},insert(){return q},update(){return q},delete(){return q},upsert(){return q},maybeSingle:async()=>({data:null,error:null}),single:async()=>({data:null,error:null}),then(ok,fail){const data=table==="product_sales_rules"?[{"product_id":"p-01","sale_unit":"kg","quantity_step":0.5,"min_quantity":0.5,"max_quantity":100,"allow_value_sale":false,"value_min_kg":0.5},{"product_id":"p-02","sale_unit":"un","quantity_step":1,"min_quantity":1,"max_quantity":100,"allow_value_sale":true,"value_min_kg":0.5},{"product_id":"p-03","sale_unit":"kg","quantity_step":0.5,"min_quantity":0.5,"max_quantity":100,"allow_value_sale":true,"value_min_kg":0.5},{"product_id":"p-04","sale_unit":"un","quantity_step":1,"min_quantity":1,"max_quantity":100,"allow_value_sale":false,"value_min_kg":0.5},{"product_id":"p-05","sale_unit":"kg","quantity_step":0.5,"min_quantity":0.5,"max_quantity":100,"allow_value_sale":false,"value_min_kg":0.5},{"product_id":"p-06","sale_unit":"un","quantity_step":1,"min_quantity":1,"max_quantity":100,"allow_value_sale":true,"value_min_kg":0.5}]:[];return Promise.resolve({data,error:null}).then(ok,fail)}};return q;},' +
    'rpc:async()=>({data:false,error:null}),functions:{invoke:async()=>({data:{},error:null})},' +
    'storage:{from:()=>({upload:async()=>({data:{},error:null}),remove:async()=>({data:[],error:null}),getPublicUrl:()=>({data:{publicUrl:""}})})},' +
    'channel:()=>({on(){return this},subscribe(){return this}}),removeChannel:async()=>({})' +
    '};window.FeiraTurnstile={create:()=>({init(){},getToken:()=>"",reset(){},setRequired(){},isRequired:()=>false})};' +
    'window.FeiraLalamoveMap={mountAll(){}};' +
    '</script>';
  let html = source
    .replace(/<script>[\s\S]*?serviceWorker\.register[\s\S]*?<\/script>/i, '')
    .replace(/<link rel="manifest"[^>]*>/gi, '')
    .replace(/<link rel="preconnect"[^>]*>/gi, '')
    .replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/gi, '')
    .replace(/<script src="\.\/turnstile\.js" defer><\/script>/i, '')
    .replace(/<script src="\.\/lalamove-map\.js"><\/script>/i, '');
  html = html.replace(/<script type="module">([\s\S]*?)<\/script>/i, (_all, code) => {
    code = code.replace(/^\s*import\s*\{\s*createClient\s*\}\s*from\s*['"]https:\/\/esm\.sh\/@supabase\/supabase-js@2\.117\.1['"];\s*/m, '');
    code = code.replace(/^\s*import\s*\{[^}]+\}\s*from\s*['"]\.\/loja-delivery-ui\.js[^'"]*['"];\s*/m, '');
    code = code.replace(/^\s*import\s*\{\s*getStoreSchedule\s*\}\s*from\s*['"]\.\/supabase\/functions\/_shared\/store-schedule\.js[^'"]*['"];\s*/m, '');
    code = code.replace(/const supabase=createClient\([\s\S]*?\);\s*/, 'const supabase=window.__testSupabase;\n');
    return '<script>' + code + '</script>';
  });
  html = html.replace('<body', bootstrap + '<script>' + schedule + '</script><script>' + helper + '</script><body');

  const browser = await chromium.launch({ headless:true });
  try {
    for (const width of [360, 412]) {
      const page = await browser.newPage({ viewport:{width,height:1000}, deviceScaleFactor:1 });
      const errors = [];
      page.on('pageerror', e => errors.push('pageerror: '+e.message));
      page.on('console', m => { if(m.type()==='error') errors.push('console.error: '+m.text()); });
      await page.route('**/*', route => route.fulfill({status:200,body:''}));
      await page.route(url => url.hostname==='juhwdevvwstmyxyyagzh.supabase.co' && url.pathname==='/rest/v1/products',
        route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(products)}));
      await page.route('http://127.0.0.1/loja.html', route => route.fulfill({status:200,contentType:'text/html',body:html}));
      await page.goto('http://127.0.0.1/loja.html',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(() => document.querySelectorAll('#homeProductSections .product').length===6, null, {timeout:15000});

      const inspect = async (selector,label) => {
        const cards = page.locator(selector);
        assert.equal(await cards.count(),6,width+'px '+label+': seis cards');
        const data = await cards.evaluateAll(nodes => nodes.map(card => {
          const rect = el => {const r=el.getBoundingClientRect();return {x:r.x,y:r.y,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
          const media=card.querySelector('.product-media'),img=media.querySelector('img'),body=card.querySelector('.pbody');
          const title=body.querySelector('h3'),old=body.querySelector('.price-before-slot'),price=body.querySelector('.price'),wholesale=body.querySelector('.resale-from-slot'),qty=body.querySelector('.product-qty'),value=body.querySelector('.value-sale-row'),weight=body.querySelector('.weight-note');
          return {
            id:card.dataset.productId,card:rect(card),media:rect(media),img:rect(img),title:rect(title),old:rect(old),price:rect(price),wholesale:rect(wholesale),qty:rect(qty),value:rect(value),weight:rect(weight),
            objectFit:getComputedStyle(img).objectFit,mediaBg:getComputedStyle(media).backgroundColor,imgBg:getComputedStyle(img).backgroundColor,
            order:[media,title,old,price,wholesale,qty,value,weight].every((el,i,arr)=>i===0||!!(arr[i-1].compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING)),
            text:{name:title.textContent,old:old.textContent.trim(),wholesale:wholesale.textContent.trim(),value:value.textContent.trim(),weight:weight.textContent.trim()},
            emptyValueHidden:getComputedStyle(value).visibility==='hidden',
            emptyWeightHidden:getComputedStyle(weight).visibility==='hidden',
            noCardOverflow:card.scrollWidth<=card.clientWidth,
            inside:[media,title,old,price,wholesale,qty,value,weight].every(el=>{const a=el.getBoundingClientRect(),b=card.getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1&&a.top>=b.top-1&&a.bottom<=b.bottom+1;})
          };
        }));
        for(const d of data){
          assert.equal(d.objectFit,'contain',width+'px '+label+' '+d.id+': object-fit contain');
          assert.ok(Math.abs(d.media.width-d.media.height)<1.5,width+'px '+label+' '+d.id+': foto quadrada');
          assert.ok(Math.abs(d.img.width-d.media.width)<1.5,width+'px '+label+' '+d.id+': imagem ocupa largura da área');
          assert.ok(Math.abs(d.img.height-d.media.height)<1.5,width+'px '+label+' '+d.id+': imagem ocupa altura da área');
          assert.equal(d.mediaBg,'rgb(255, 255, 255)');
          assert.equal(d.imgBg,'rgb(255, 255, 255)');
          assert.equal(d.order,true,width+'px '+label+' '+d.id+': ordem comum');
          assert.equal(d.noCardOverflow,true,width+'px '+label+' '+d.id+': sem overflow horizontal');
          assert.equal(d.inside,true,width+'px '+label+' '+d.id+': conteúdo dentro do card');
          assert.ok(d.card.bottom-d.weight.bottom<=14,width+'px '+label+' '+d.id+': sem sobra branca após o conteúdo (padding interno)');
        }
        for(let i=0;i<data.length;i++){
          const sameRow=data.filter(d=>Math.abs(d.card.top-data[i].card.top)<2);
          if(sameRow.length>1)for(const d of sameRow)assert.ok(Math.abs(d.card.height-sameRow[0].card.height)<1.5,width+'px '+label+': cards da fileira com altura igual');
        }
        assert.equal(data[0].text.weight,'Peso aproximado',width+'px '+label+': kg mostra peso');
        assert.equal(data[1].text.weight,'',width+'px '+label+': unidade não mostra peso');
        assert.equal(data[0].text.wholesale,'',width+'px '+label+': sem atacado reserva espaço vazio');
        assert.match(data[1].text.wholesale,/A partir de 10 un: R\$ 10,00/,width+'px '+label+': atacado com unidade');
        assert.equal(data[0].text.old,'',width+'px '+label+': sem promoção reserva espaço vazio');
        assert.notEqual(data[1].text.old,'',width+'px '+label+': promoção exibe preço riscado');
        assert.ok(data[1].text.value.includes('Pedir por valor R$'),width+'px '+label+': botão de valor');
        assert.equal(data[0].emptyValueHidden,true,width+'px '+label+': sem compra por valor reserva espaço');
        assert.equal(data[0].emptyWeightHidden,false,width+'px '+label+': kg tem nota visível');
        assert.equal(data[1].emptyWeightHidden,true,width+'px '+label+': unidade reserva nota invisível');
        return data;
      };

      await inspect('#homeProductSections .product','home');
      await page.locator('#homeProductSections [data-view-category]').first().click();
      await page.waitForFunction(()=>document.querySelector('#homeProductSections')?.classList.contains('category-detail'));
      await inspect('#homeProductSections .product','Ver todos');
      await page.locator('#homeSearch').fill('Produto');
      await page.waitForFunction(()=>document.querySelector('#homeProductSections')?.classList.contains('search-mode'));
      await inspect('#homeProductSections .product','busca home');
      await inspect('#products .product','catálogo');
      await page.locator('#search').fill('Produto');
      await page.waitForFunction(()=>document.querySelectorAll('#products .product').length===6);
      await inspect('#products .product','busca catálogo');
      fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
      await page.screenshot({path:path.join(root,'artifacts','product-cards-'+width+'.png'),fullPage:true});
      assert.deepEqual(errors,[],width+'px: zero erros de console');
      await page.close();
    }
  } finally { await browser.close(); }
  console.log('Cards da vitrine aprovados em 360px e 412px: home, Ver todos, busca e catálogo; alturas alinhadas, foto 1:1/contain, espaços reservados e zero erros de console.');
})().catch(error=>{console.error(error);process.exit(1);});
