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
  const calendar = fs.readFileSync(path.join(root, 'supabase/functions/_shared/commercial-calendar.js'), 'utf8').replace(/\bexport\s+/g, '');
  const schedule = fs.readFileSync(path.join(root, 'supabase/functions/_shared/store-schedule.js'), 'utf8').replace(/^import .*commercial-calendar\.js.*;\s*/m, '').replace(/\bexport\s+/g, '');
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
    code = code.replace(/^\s*import\s*\{\s*getCommercialSchedule\s*\}\s*from\s*['"]\.\/supabase\/functions\/_shared\/commercial-calendar\.js[^'"]*['"];\s*/m, '');
    code = code.replace(/const supabase=createClient\([\s\S]*?\);\s*/, 'const supabase=window.__testSupabase;\n');
    return '<script>' + code + '</script>';
  });
  html = html.replace('<body', bootstrap + '<script>' + calendar + '</script><script>' + schedule + '</script><script>' + helper + '</script><body');

  const browser = await chromium.launch({ headless:true });
  try {
    for (const width of [360, 412, 500]) {
      const page = await browser.newPage({ viewport:{width,height:1000}, deviceScaleFactor:1 });
      const errors = [];
      page.on('pageerror', e => errors.push('pageerror: '+e.message+' STACK '+e.stack));
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
          const badge=card.querySelector('.pct-badge');
          return {
            id:card.dataset.productId,card:rect(card),media:rect(media),img:rect(img),badge:badge?{...rect(badge),text:badge.textContent.trim()}:null,title:rect(title),old:rect(old),price:rect(price),wholesale:rect(wholesale),qty:rect(qty),value:rect(value),weight:rect(weight),
            objectFit:getComputedStyle(img).objectFit,mediaBg:getComputedStyle(media).backgroundColor,imgBg:getComputedStyle(img).backgroundColor,
            order:[media,title,old,price,wholesale,qty,value,weight].every((el,i,arr)=>i===0||!!(arr[i-1].compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING)),
            text:{name:title.textContent,old:old.textContent.trim().replace(/\u00a0/g,' '),wholesale:wholesale.textContent.trim().replace(/\u00a0/g,' '),value:value.textContent.trim().replace(/\u00a0/g,' '),weight:weight.textContent.trim()},
            emptyValueHidden:getComputedStyle(value).visibility==='hidden',
            emptyWeightHidden:getComputedStyle(weight).visibility==='hidden',
            rowHasValue:card.classList.contains('row-has-value'),rowHasWeight:card.classList.contains('row-has-weight'),rowHasWholesale:card.classList.contains('row-has-wholesale'),
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
          if(d.id==='p-02'){assert.equal(d.badge.text,'-33%',width+'px '+label+': selo de desconto');assert.ok(d.badge.top>=d.media.top&&d.badge.bottom<=d.media.bottom&&d.badge.right<=d.media.right,width+'px '+label+': selo sobre a foto');}else if(d.id==='p-01')assert.equal(d.badge,null,width+'px '+label+': sem selo quando não há promoção');
          assert.equal(d.order,true,width+'px '+label+' '+d.id+': ordem comum');
          assert.equal(d.noCardOverflow,true,width+'px '+label+' '+d.id+': sem overflow horizontal');
          assert.equal(d.inside,true,width+'px '+label+' '+d.id+': conteúdo dentro do card');
          const tail=d.weight.height>0?d.weight:d.value.height>0?d.value:d.qty;assert.ok(d.card.bottom-tail.bottom<=10,width+'px '+label+' '+d.id+': sem sobra branca após o último slot ativo');
          assert.equal(d.rowHasValue,true,width+'px '+label+' '+d.id+': linha de valor alinhada na fileira mista');
          assert.equal(d.rowHasWeight,true,width+'px '+label+' '+d.id+': linha de peso alinhada na fileira mista');
          assert.equal(d.rowHasWholesale,true,width+'px '+label+' '+d.id+': linha de atacado alinhada na fileira mista');
        }
        for(let i=0;i<data.length;i++){
          const sameRow=data.filter(d=>Math.abs(d.card.top-data[i].card.top)<2);
          if(sameRow.length>1)for(const d of sameRow)assert.ok(Math.abs(d.card.height-sameRow[0].card.height)<1.5,width+'px '+label+': cards da fileira com altura igual');
        }
        assert.equal(data[0].text.weight,'Peso aproximado',width+'px '+label+': kg mostra peso');
        assert.equal(data[1].text.weight,'',width+'px '+label+': unidade não mostra peso');
        assert.equal(data[0].text.wholesale,'',width+'px '+label+': sem atacado reserva espaço vazio');
        assert.match(data[1].text.wholesale,/Revenda a partir de 10 un: R\$ 10,00/,width+'px '+label+': revenda com unidade');
        assert.equal(data[0].text.old,'',width+'px '+label+': sem promoção reserva espaço vazio');
        assert.notEqual(data[1].text.old,'',width+'px '+label+': promoção exibe preço riscado');
        assert.ok(data[1].text.value.includes('Pedir por valor R$'),width+'px '+label+': botão de valor');
        assert.equal(data[0].emptyValueHidden,true,width+'px '+label+': sem compra por valor reserva espaço');
        assert.equal(data[0].emptyWeightHidden,false,width+'px '+label+': kg tem nota visível');
        assert.equal(data[1].emptyWeightHidden,true,width+'px '+label+': unidade reserva nota invisível');
        return data;
      };

      const rowChecks=await page.evaluate(()=>{
        const root=document.createElement('div');root.style.cssText='display:block;width:100%;position:relative';
        const makeCard=({value=false,weight=false,wholesale=false})=>{
          const card=document.createElement('article');card.className='product';card.innerHTML='<div class="resale-from-slot">'+(wholesale?'<span class="resale-from">A partir de 10 un</span>':'')+'</div><div class="product-controls"><div class="product-qty">− 0 +</div><div class="value-sale-row'+(value?'':' is-empty')+'">'+(value?'<button class="value-sale-open">Pedir por valor R$</button>':'')+'</div></div><small class="weight-note'+(weight?'':' is-empty')+'">'+(weight?'Peso aproximado':'')+'</small>';return card;
        };
        const addRow=(specs)=>{const row=document.createElement('div');row.className='catalog-row';row.style.cssText='display:flex;position:relative;width:100%;height:90px;margin-bottom:5px;gap:8px';specs.forEach(spec=>{const card=makeCard(spec);card.style.cssText='width:45%;height:90px';row.append(card);});root.append(row);return row;};
        const polpas=addRow([{},{ }]);
        const kg=addRow([{weight:true},{}]);
        const mixed=addRow([{weight:true,value:true},{wholesale:true}]);
        document.body.append(root);window.syncProductCardRowSlots(root);
        const read=row=>[...row.children].map(card=>({value:card.classList.contains('row-has-value'),weight:card.classList.contains('row-has-weight'),wholesale:card.classList.contains('row-has-wholesale'),valueDisplay:getComputedStyle(card.querySelector('.value-sale-row')).display,weightDisplay:getComputedStyle(card.querySelector('.weight-note')).display,wholesaleDisplay:getComputedStyle(card.querySelector('.resale-from-slot')).display}));
        const result={polpas:read(polpas),kg:read(kg),mixed:read(mixed)};root.remove();return result;
      });
      for(const card of rowChecks.polpas){assert.deepEqual([card.value,card.weight,card.wholesale],[false,false,false],width+'px: polpas sem slots opcionais');assert.deepEqual([card.valueDisplay,card.weightDisplay,card.wholesaleDisplay],['none','none','none'],width+'px: polpas sem espaço reservado');}
      for(const card of rowChecks.kg){assert.deepEqual([card.value,card.weight,card.wholesale],[false,true,false],width+'px: fileira só de kg reserva somente peso');}
      for(const card of rowChecks.mixed){assert.deepEqual([card.value,card.weight,card.wholesale],[true,true,true],width+'px: fileira mista alinha valor, peso e atacado');}
      await inspect('#homeProductSections .product','home');
      await page.locator('#homeProductSections [data-view-category]').first().click();
      await page.waitForFunction(()=>document.querySelector('#homeProductSections')?.classList.contains('category-detail'));
      await inspect('#homeProductSections .product','Ver todos');
      await page.locator('#homeSearch').fill('Produto');
      await page.waitForFunction(()=>document.querySelector('#homeProductSections')?.classList.contains('search-mode'));
      await inspect('#homeProductSections .product','busca home');
      fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
      await page.screenshot({path:path.join(root,'artifacts','product-cards-'+width+'.png'),fullPage:true});
      assert.deepEqual(errors,[],width+'px: zero erros de console');
      await page.close();
    }
  } finally { await browser.close(); }
  console.log('Cards da vitrine aprovados em 360px e 412px: home, Ver todos e busca; alturas alinhadas, foto 1:1/contain, espaços reservados e zero erros de console.');
})().catch(error=>{console.error(error);process.exit(1);});
