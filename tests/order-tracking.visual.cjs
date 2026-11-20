const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const mapSource = fs.readFileSync(path.join(root, 'lalamove-map.js'), 'utf8');
const endpoint = fs.readFileSync(path.join(root, 'supabase/functions/lalamove-tracking/index.ts'), 'utf8');
const storefront = fs.readFileSync(path.join(root, 'loja.html'), 'utf8');
const adminPage = fs.readFileSync(path.join(root, 'painel.html'), 'utf8');

async function installMapMock(page) {
  await page.evaluate(() => {
    window.__mapOptions = null; window.__tileUrl = ''; window.__pollMs = 0;
    class MockMap {
      constructor(el, options) { this.el=el; this.options=options; this.markers=[]; this.polylines=[]; window.__mapOptions=options; }
      setView() { return this; } fitBounds(points, options) { this.bounds=points; this.fitOptions=options; }
      invalidateSize() {} remove() { this.removed=true; }
      removeLayer(layer) { this.markers=this.markers.filter(x=>x!==layer); }
    }
    class MockMarker {
      constructor(point, options) { this.latlng=point; this.options=options; this.element=document.createElement('span'); this.element.innerHTML=options.icon.options.html; }
      addTo(map) { this.map=map; map.markers.push(this); map.el.append(this.element); return this; }
      setLatLng(point) { this.latlng=point; return this; }
      setIcon(icon) { this.options.icon=icon; this.element.innerHTML=icon.options.html; return this; }
    }
    class MockLine {
      constructor(points, options) { this.points=points; this.options=options; }
      addTo(map) { this.map=map; map.polylines.push(this); return this; }
      setLatLngs(points) { this.points=points; return this; }
    }
    window.L = {
      map:(el,options)=>new MockMap(el,options),
      tileLayer:(url)=>{window.__tileUrl=url;return {addTo(){}};},
      polyline:(points,options)=>new MockLine(points,options),
      divIcon:options=>({options}),
      marker:(point,options)=>new MockMarker(point,options),
    };
    delete window.IntersectionObserver;
  });
  await page.addScriptTag({path:path.join(root,'lalamove-map.js')});
}

async function customer(browser,width,height) {
  const page=await browser.newPage({viewport:{width,height}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent(`<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
   <article class="order-card" style="max-width:520px;margin:auto;padding:12px"><div class="order-status-top"><b>Pedido confirmado</b><div class="order-subtitle">Pagamento confirmado.</div></div>
   <ol class="order-timeline">${['Pago','Separando','Procurando entregador','Entregador a caminho da feira','Saiu para entrega','Entregue'].map(x=>'<li>'+x+'</li>').join('')}</ol>
   <div id="map" data-lalamove-map data-order-id="TEST-CUSTOMER"></div></article></body></html>`);
  await installMapMock(page);
  let current={active:true,status:'searching',driver_assigned:false,store:{lat:-3.1347,lng:-60.0237},customer:{lat:-3.105,lng:-60.005}};
  await page.evaluate(data=>{window.__trackingData=data;window.__state=window.FeiraLalamoveMap.mount(document.querySelector('#map'),async()=>window.__trackingData,{pollIntervalMs:30000});},current);
  await page.evaluate(()=>window.__state.refresh());
  await page.waitForSelector('#map .feira-delivery-map:not([hidden])');
  await page.waitForFunction(()=>window.__state?.map?.polylines?.length===2);
  const searching=await page.evaluate(()=>({markers:window.__state.map.markers.length,zoom:window.__mapOptions.zoomControl,tile:window.__tileUrl,fit:window.__state.map.fitOptions,bounds:window.__state.map.bounds,html:document.querySelector('#map').innerText,height:getComputedStyle(document.querySelector('.feira-delivery-map')).height,attribution:document.querySelector('.feira-delivery-map')?.getAttribute('aria-label')}));
  assert.equal(searching.markers,2,'without driver, show only store and customer');
  assert.match(mapSource,/\.feira-delivery-map\\{height:45vh/,'customer map uses about 45 percent of viewport height');
  assert.equal(searching.zoom,false,'customer map hides zoom controls');
  assert.match(searching.tile,/basemaps\.cartocdn\.com\/light_all/,'light CARTO tiles replace standard OSM');
  assert.equal(searching.bounds.length,2,'fit bounds only store and customer when driver is absent');
  assert.equal(searching.fit.maxZoom,16,'zoom stays local instead of showing the whole city');
  assert.match(searching.height,/\d+px/);
  assert.doesNotMatch(searching.html,/📍|🏠|🏪|🛵|🚗/,'customer map card uses no emoji');
  assert.equal(await page.locator('.leaflet-control-zoom').count(),0);
  const svgPins=await page.locator('.feira-map-marker').evaluateAll(nodes=>nodes.map(node=>node.innerHTML).join(' '));
  assert.match(svgPins,/<svg/,'custom markers are SVG artwork');
  assert.doesNotMatch(svgPins,/📍|🏠|🏪|🛵|🚗/,'custom map pins contain no emoji');
  await page.screenshot({path:path.join(root,'artifacts','order-tracking-map-customer-'+width+'-searching.png'),fullPage:true});

  current={active:true,status:'assigned',driver_assigned:true,store:current.store,customer:current.customer,driver:{name:'Ana Souza',plateNumber:'ABC1D23'}};
  await page.evaluate(data=>{window.__trackingData=data;},current);await page.evaluate(()=>window.__state.refresh());
  assert.equal(await page.evaluate(()=>window.__state.map.markers.length),2,'assigned but no GPS fix still fits store and home');
  assert.match(await page.locator('.feira-delivery-status').innerText(),/a caminho da feira/i);

  const start={lat:-3.13,lng:-60.02},finish={lat:-3.125,lng:-60.018};
  current={active:true,status:'picked_up',driver_assigned:true,vehicle:'MOTO',store:current.store,customer:current.customer,eta:12,driver:{name:'Ana Souza',phone:'+5592999999999',plateNumber:'ABC1D23',coordinates:start}};
  await page.evaluate(data=>{window.__trackingData=data;},current);await page.evaluate(()=>window.__state.refresh());
  assert.equal(await page.evaluate(()=>window.__state.map.markers.length),3,'motorcycle appears once GPS coordinates arrive');
  assert.equal(await page.evaluate(()=>window.__state.map.bounds.length),3,'first motorcycle fix is included in automatic zoom bounds');
  assert.match(await page.locator('.feira-delivery-status').innerText(),/Previsão de chegada: 12 min/);
  const before=await page.evaluate(()=>window.__state.driver.latlng);
  current={...current,driver:{...current.driver,coordinates:finish}};
  await page.evaluate(data=>{window.__trackingData=data;},current);await page.evaluate(()=>window.__state.refresh());
  await page.waitForTimeout(2600);
  const after=await page.evaluate(()=>window.__state.driver.latlng);
  assert.notDeepEqual(after,before,'motorcycle animates between tracking updates');
  assert.match(await page.locator('.feira-driver-card').innerText(),/Ana/);
  assert.match(await page.locator('.feira-driver-card').innerText(),/Placa ABC1D23/);
  assert.doesNotMatch(await page.locator('.feira-driver-card').innerText(),/9999999999/,'customer never sees driver phone');
  assert.equal(await page.evaluate(()=>window.__state.route.options.color),'#1E6B3A','full route uses app green');
  assert.equal(await page.evaluate(()=>window.__state.progress.options.color),'#14532D','traveled segment uses darker green');
  await page.screenshot({path:path.join(root,'artifacts','order-tracking-map-customer-'+width+'-picked-up.png'),fullPage:true});

  current={active:false,status:'delivered',driver_assigned:true,store:current.store,customer:current.customer};
  await page.evaluate(data=>{window.__trackingData=data;},current);await page.evaluate(()=>window.__state.refresh());
  assert.equal(await page.locator('#map .feira-delivery-map:not([hidden])').count(),0,'completed order hides map');
  assert.equal(await page.locator('#map').evaluate(el=>el.hidden),true,'delivered tracking card is hidden');
  await page.evaluate(()=>{const card=document.createElement('article');card.className='order-card';card.innerHTML='<div class="order-status-top"><b>Pedido cancelado</b></div><div id="cancelled-map" data-lalamove-map data-order-id="TEST-CANCELLED"></div>';document.body.append(card);window.__cancelledState=window.FeiraLalamoveMap.mount(document.querySelector('#cancelled-map'),async()=>({active:false,status:'cancelled'}));});
  await page.waitForFunction(()=>window.__cancelledState?.container?.hidden===true);
  assert.equal(await page.locator('#cancelled-map').evaluate(el=>el.hidden),true,'cancelled tracking card is hidden');
  assert.deepEqual(errors,[]);
  await page.close();
}

async function admin(browser) {
  const page=await browser.newPage({viewport:{width:412,height:915}});
  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="admin" data-order-id="TEST-ADMIN"></div></body></html>');
  await installMapMock(page);
  await page.evaluate(()=>{window.__state=window.FeiraLalamoveMap.mount(document.querySelector('#admin'),async()=>({active:true,status:'assigned',driver_assigned:true,vehicle:'MOTO',store:{lat:-3.13,lng:-60.02},customer:{lat:-3.10,lng:-60.01},tracking_url:'https://share.lalamove.com/admin-test',driver:{name:'Carlos Silva',phone:'+5592888888888',plateNumber:'XYZ1234',coordinates:{lat:-3.12,lng:-60.015}}}),{admin:true});});
  await page.waitForSelector('#admin .feira-delivery-actions a.admin:not([hidden])');
  assert.equal(await page.evaluate(()=>window.__mapOptions.zoomControl),true,'admin keeps zoom controls');
  assert.equal(await page.evaluate(()=>window.__state.map.markers.length),3);
  assert.match(await page.locator('#admin').innerText(),/Abrir na Lalamove/);
  assert.match(await page.locator('#admin').innerText(),/Telefone: \+5592888888888/);
  await page.screenshot({path:path.join(root,'artifacts','order-tracking-map-admin-412.png'),fullPage:true});
  await page.close();
}

(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
  await customer(browser,360,800);await customer(browser,412,915);await admin(browser);
  assert.equal(storefront.includes('<span aria-hidden="true">📍</span><div><b>Entrega Feira On</b>'),false,'delivery address in customer order card has no emoji pin');
  assert.match(storefront,/lalamove-map\.js\?v=20261120-carto-light/,'storefront loads the versioned map asset');
  assert.match(adminPage,/lalamove-map\.js\?v=20261120-carto-light/,'admin panel loads the same versioned map asset');
  assert.equal(storefront.includes('Estamos chamando um novo entregador 🛵'),false,'customer order card has no emoji motorcycle');
  assert.match(mapSource,/basemaps\.cartocdn\.com\/light_all/);
  assert.match(endpoint,/\.eq\("user_id", authData\.user\.id\)/,'tracking endpoint remains owner-scoped');
  assert.match(endpoint,/if \(!isOwner && !admin\) return json\(\{ error: "Pedido não encontrado\." \}, 404\)/,'another customer receives not-found');
  process.stdout.write('Delivery map: CARTO light, custom SVG pins, route progress, no-driver/assigned/picked-up/completed states, 2.5s animation, 360/412px screenshots and admin zoom passed.\\n');
 }finally{await browser.close();}
})().catch(error=>{process.stderr.write(String(error&&error.stack||error)+'\\n');process.exitCode=1;});
