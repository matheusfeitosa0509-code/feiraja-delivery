const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const products = [
  { id:'f-01', name:'Banana prata (palma)', price:7.99, old_price:null, category:'Frutas', image:'', available:true, resale_enabled:false, resale_price:null, resale_min_qty:null, resale_unit:'un' },
  { id:'f-02', name:'Mamão (kg)', price:11.99, old_price:null, category:'Frutas', image:'', available:true, resale_enabled:false, resale_price:null, resale_min_qty:null, resale_unit:'kg' },
  { id:'f-03', name:'Uva (500g)', price:11.99, old_price:null, category:'Frutas', image:'', available:true, resale_enabled:false, resale_price:null, resale_min_qty:null, resale_unit:'un' },
  { id:'v-01', name:'Cebola (kg)', price:13.99, old_price:null, category:'Verduras e legumes', image:'', available:true, resale_enabled:false, resale_price:null, resale_min_qty:null, resale_unit:'kg' },
  { id:'v-02', name:'Cheiro-verde (maço)', price:2.99, old_price:null, category:'Verduras e legumes', image:'', available:true, resale_enabled:false, resale_price:null, resale_min_qty:null, resale_unit:'un' },
  { id:'p-01', name:'Camarão 10g (kg)', price:59.99, old_price:null, category:'Pescados e frutos do mar', image:'', available:true, resale_enabled:false, resale_price:null, resale_min_qty:null, resale_unit:'kg' },
];
const rules = [];

(async () => {
  const root = process.cwd();
  const source = fs.readFileSync(path.join(root, 'loja.html'), 'utf8');
  const helper = fs.readFileSync(path.join(root, 'loja-delivery-ui.js'), 'utf8').replace(/\bexport\s+/g, '');
  const calendar = fs.readFileSync(path.join(root, 'supabase/functions/_shared/commercial-calendar.js'), 'utf8').replace(/\bexport\s+/g, '');
  const schedule = fs.readFileSync(path.join(root, 'supabase/functions/_shared/store-schedule.js'), 'utf8').replace(/^import .*commercial-calendar\.js.*;\s*/m, '').replace(/\bexport\s+/g, '');
  const bannerSchedule = fs.readFileSync(path.join(root, 'supabase/functions/_shared/store-banner-schedule.js'), 'utf8').replace(/\bexport\s+/g, '');
  const bootstrap = '<script>' +
    'window.__testSupabase={' +
    'auth:{getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})},' +
    'from:table=>{const q={select(){return q},eq(){return q},neq(){return q},in(){return q},order(){return q},limit(){return q},range(){return q},gte(){return q},lte(){return q},or(){return q},not(){return q},is(){return q},insert(){return q},update(){return q},delete(){return q},upsert(){return q},maybeSingle:async()=>({data:null,error:null}),single:async()=>({data:null,error:null}),then(ok,fail){const data=table==="product_sales_rules"?[{"product_id":"f-02","sale_unit":"kg","quantity_step":0.5,"min_quantity":0.5,"max_quantity":100,"allow_value_sale":true,"value_min_kg":0.5},{"product_id":"v-01","sale_unit":"kg","quantity_step":0.5,"min_quantity":0.5,"max_quantity":100,"allow_value_sale":false,"value_min_kg":0.5},{"product_id":"p-01","sale_unit":"kg","quantity_step":0.5,"min_quantity":0.5,"max_quantity":100,"allow_value_sale":false,"value_min_kg":0.5}]:[];return Promise.resolve({data,error:null}).then(ok,fail)}};return q;},' +
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
    code = code.replace(/^\s*import\s*\{\s*isStoreBannerScheduleActive\s*\}\s*from\s*['"]\.\/supabase\/functions\/_shared\/store-banner-schedule\.js[^'"]*['"];\s*/m, '');
    code = code.replace(/const supabase=createClient\([\s\S]*?\);\s*/, 'const supabase=window.__testSupabase;\n');
    return '<script>' + code + '</script>';
  });
  html = html.replace('<body', bootstrap + '<script>' + calendar + '</script><script>' + schedule + '</script><script>' + helper + '</script><script>' + bannerSchedule + '</script><body');

  const browser = await chromium.launch({ headless:true });
  try {
    const open = async (url) => {
      const page = await browser.newPage({ viewport:{width:390,height:844}, deviceScaleFactor:1 });
      const errors = [];
      await page.addInitScript(() => { try { localStorage.setItem('feira_cookie_consent_v1','accepted'); } catch (_) {} });
      page.on('pageerror', e => errors.push('pageerror: '+e.message));
      page.on('console', m => { if(m.type()==='error') errors.push('console.error: '+m.text()); });
      await page.route('**/*', route => route.fulfill({status:200,body:''}));
      await page.route(u => u.hostname==='juhwdevvwstmyxyyagzh.supabase.co' && u.pathname==='/rest/v1/products',
        route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(products)}));
      await page.route(u => u.hostname==='127.0.0.1' && u.pathname==='/loja.html', route => route.fulfill({status:200,contentType:'text/html',body:html}));
      await page.goto(url,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(() => document.querySelectorAll('#homeProductSections .product').length===6, null, {timeout:15000});
      return {page,errors};
    };
    // sem a flag: loja de sempre
    { const {page,errors} = await open('http://127.0.0.1/loja.html');
      assert.equal(await page.locator('#bancaHome').isVisible(), false, 'modo feira escondido sem flag');
      assert.equal(await page.locator('#homeProductSections').isVisible(), true, 'loja de sempre visível');
      assert.deepEqual(errors, [], errors.join('\n')); await page.close(); }
    // com a flag: a loja vira a feira por setores
    const {page,errors} = await open('http://127.0.0.1/loja.html?banca=1');
    await page.waitForSelector('#bancaHome .banca-crate');
    assert.equal(await page.locator('#homeProductSections').isVisible(), false, 'lista antiga escondida');
    assert.equal(await page.locator('.mobile-nav').isVisible(), true, 'menu de baixo continua');
    assert.deepEqual(await page.locator('.banca-tabs button').allTextContents(), ['Frutas','Verduras','Pescados']);
    assert.match(await page.locator('.banca-sign').textContent(), /Setor das Frutas/);
    assert.equal(await page.locator('#bancaBasket').isVisible(), true, 'balcão visível');
    assert.equal(await page.locator('[data-banca-note]').isDisabled(), true, 'nota desabilitada com cesta vazia');
    // pedir por valor
    const vbtn = page.locator('[data-banca-id="f-02"] .banca-rs[data-value-open]');
    assert.equal(await vbtn.count(), 1, 'botão pedir por valor no caixote');
    await vbtn.click();
    await page.waitForSelector('#valueSaleSheet.open');
    await page.locator('#valueSaleClose').click();
    await page.locator('[data-banca-add="f-01"]').click();
    await page.locator('[data-banca-add="f-01"]').click();
    await page.locator('[data-banca-add="f-02"]').click();
    await page.waitForTimeout(700);
    const cart = await page.evaluate(() => JSON.parse(localStorage.getItem('feiraja_cart_v1')||'{}'));
    assert.deepEqual(cart, {'f-01':2,'f-02':0.5}, 'carrinho real atualizado: '+JSON.stringify(cart));
    assert.equal((await page.locator('[data-banca-count]').textContent()).trim(), '2 itens');
    assert.match((await page.locator('[data-banca-total]').textContent()).replace(/\u00a0/g,' '), /R\$ 21,98/);
    assert.equal(await page.locator('[data-banca-id="f-01"] .banca-badge').isVisible(), true);
    assert.equal(await page.locator('.legal-footer').isVisible(), false, 'rodapé escondido na feira');
    await page.screenshot({path:'/tmp/banca-1.png'});
    await page.locator('[data-banca-minus="f-01"]').click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('feiraja_cart_v1'))['f-01']), 1);
    // trocar de setor pela aba
    await page.locator('[data-banca-tab="2"]').click();
    assert.match(await page.locator('.banca-sign').textContent(), /Setor dos Pescados/);
    assert.match(await page.locator('.banca-tabs button.on').textContent(), /Pescados/);
    // busca
    await page.locator('#bancaSearch').fill('cebo');
    assert.equal(await page.locator('#bancaPanel .banca-crate').count(), 1);
    await page.locator('#bancaSearch').fill('');
    await page.screenshot({path:'/tmp/banca-2.png'});
    // nota e sacola
    await page.locator('[data-banca-note]').click();
    await page.waitForSelector('#bancaNote:not([hidden])');
    assert.equal(await page.locator('.banca-note-lines > div').count(), 2);
    assert.match((await page.locator('[data-banca-note-total]').textContent()).replace(/\u00a0/g,' '), /R\$ 13,99/);
    await page.screenshot({path:'/tmp/banca-3.png'});
    await page.locator('[data-banca-checkout]').click();
    await page.waitForFunction(() => document.querySelector('#pageCart')?.classList.contains('active'), null, {timeout:5000});
    assert.equal(await page.locator('#bancaBasket').isVisible(), false, 'balcão some fora da loja');
    assert.equal(await page.locator('#cartItems .cart-item').count(), 2, 'sacola com os 2 itens');
    assert.deepEqual(errors, [], errors.join('\n'));
    console.log('modo-feira ok');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
