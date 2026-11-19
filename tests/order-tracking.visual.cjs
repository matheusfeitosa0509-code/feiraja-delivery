const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const mapSource = fs.readFileSync(path.join(root, 'lalamove-map.js'), 'utf8');
const endpoint = fs.readFileSync(path.join(root, 'supabase/functions/lalamove-tracking/index.ts'), 'utf8');

async function runCustomer(browser, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setContent(`<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
    <article class="order-card" style="max-width:520px;margin:auto;padding:12px">
      <div class="order-status-top"><b>Pedido confirmado</b><div class="order-subtitle">Pagamento confirmado.</div></div>
      <ol class="order-timeline">${['Pago','Separando','Procurando entregador','Entregador a caminho da feira','Saiu para entrega','Entregue'].map(x=>'<li>'+x+'</li>').join('')}</ol>
      <section class="customer-lalamove-tracking"><div id="map" data-lalamove-map data-order-id="TEST-ORDER"></div></section>
    </article></body></html>`);
  await page.evaluate(() => {
    window.__pollMs = 0; window.__cleared = false;
    window.setInterval = (fn, ms) => { window.__pollMs = ms; return 11; };
    window.clearInterval = id => { if (id === 11) window.__cleared = true; };
    class MockMap {
      constructor(el) { this.el = el; this.markers = []; }
      setView() { return this; } fitBounds(points) { this.bounds = points; }
      invalidateSize() {} remove() { this.removed = true; }
    }
    class MockMarker {
      constructor(point) { this.point = point; this.element = document.createElement('span'); this.element.innerHTML = point.icon.options.html; this.latlng = point.point; }
      addTo(map) { this.map = map; map.markers.push(this); map.el.append(this.element); return this; }
      setLatLng(point) { this.latlng = point; return this; }
    }
    window.L = {
      map: (el) => new MockMap(el),
      tileLayer: () => ({ addTo() {} }),
      divIcon: options => ({ options }),
      marker: (point) => new MockMarker(point),
    };
    delete window.IntersectionObserver;
  });
  await page.addScriptTag({ path: path.join(root, 'lalamove-map.js') });
  await page.evaluate(() => {
    const points = [{lat:-3.1347,lng:-60.0237},{lat:-3.1265,lng:-60.0181},{lat:-3.1162,lng:-60.0124}];
    let index = 0;
    window.__state = window.FeiraLalamoveMap.mount(document.querySelector('#map'), async () => ({
      active:true,status:'picked_up',driver_assigned:true,vehicle:'MOTO',
      store:{lat:-3.1347,lng:-60.0237},customer:{lat:-3.105,lng:-60.005},
      driver:{name:'Ana Souza',phone:'+5592999999999',plateNumber:'ABC1D23',photo:'https://example.com/driver.jpg',coordinates:points[Math.min(index++,2)]},
      tracking_url:'https://share.lalamove.com/private-test',
    }), {whatsappUrl:'https://wa.me/559294444989',pollIntervalMs:30000});
  });
  await page.waitForSelector('#map .feira-map-marker');
  await page.waitForFunction(() => window.__state?.map?.markers?.length === 3);
  const first = await page.evaluate(() => ({
    driverName:document.querySelector('.feira-driver-card strong')?.textContent,
    driverInfo:document.querySelector('.feira-driver-card').innerText,
    mapMarkers:document.querySelectorAll('.feira-map-marker').length,
    contact:document.querySelector('.feira-delivery-actions a')?.textContent,
    contactHref:document.querySelector('.feira-delivery-actions a')?.href,
    text:document.querySelector('.order-card').innerText,
    pollMs:window.__pollMs,
    timeline:document.querySelector('.order-timeline').innerText,
    driverPoint:window.__state.driver.latlng,
  }));
  assert.equal(first.driverName, 'Ana');
  assert.match(first.driverInfo, /Moto/);
  assert.match(first.driverInfo, /Placa ABC1D23/);
  assert.doesNotMatch(first.driverInfo, /9999999999/);
  assert.equal(first.mapMarkers, 3, 'store, customer and driver pins');
  assert.equal(first.contact, 'Falar com a Feira On');
  assert.match(first.contactHref, /wa\.me/);
  assert.doesNotMatch(first.text, /Lalamove|share\.lalamove|ABC1D23|9999999999/i, 'customer must not see provider, driver phone or plate');
  assert.equal(first.pollMs, 30000);
  assert.match(first.timeline, /Saiu para entrega/);
  await page.evaluate(() => window.__state.refresh());
  await page.waitForTimeout(1200);
  const moved = await page.evaluate(() => window.__state.driver.latlng);
  assert.notDeepEqual(moved, first.driverPoint, 'motorcycle marker moves when simulated coordinates change');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow');
  assert.deepEqual(errors, []);
  await page.close();
}

async function runAdmin(browser) {
  const page = await browser.newPage({viewport:{width:412,height:915}});
  await page.setContent('<main><div id="admin" data-order-id="TEST-ADMIN"></div></main>');
  await page.evaluate(() => {
    window.L={map:el=>({el,markers:[],setView(){return this;},fitBounds(){},invalidateSize(){},remove(){}}),tileLayer:()=>({addTo(){}}),divIcon:options=>({options}),marker:p=>({element:Object.assign(document.createElement('span'),{innerHTML:p.icon.options.html}),addTo(map){map.el.append(this.element);return this;},setLatLng(){return this;}})};
    window.IntersectionObserver=undefined;
  });
  await page.addScriptTag({path:path.join(root,'lalamove-map.js')});
  await page.evaluate(()=>window.FeiraLalamoveMap.mount(document.querySelector('#admin'),async()=>({active:true,status:'assigned',driver_assigned:true,vehicle:'MOTO',store:{lat:-3.13,lng:-60.02},customer:{lat:-3.10,lng:-60.01},tracking_url:'https://share.lalamove.com/admin-test',driver:{name:'Carlos Silva',phone:'+5592888888888',plateNumber:'XYZ1234',coordinates:{lat:-3.12,lng:-60.015}}}),{admin:true}));
  await page.waitForSelector('#admin .feira-delivery-actions a.admin:not([hidden])');
  const text=await page.locator('#admin').innerText();
  assert.match(text,/Abrir na Lalamove/);
  assert.match(text,/Telefone: \+5592888888888/);
  await page.close();
}

(async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    await runCustomer(browser,360,800);
    await runCustomer(browser,412,915);
    await runAdmin(browser);
    assert.match(endpoint,/\.eq\("user_id", authData\.user\.id\)/,'tracking endpoint must bind access to the authenticated owner');
    assert.match(endpoint,/if \(!isOwner && !admin\) return json\(\{ error: "Pedido não encontrado\." \}, 404\)/,'another customer must receive not-found');
    assert.match(mapSource,/tile\.openstreetmap\.org/);
    process.stdout.write('In-app delivery tracking: 360/412px, private customer view, admin-only provider link, simulated driver movement and owner isolation passed.\\n');
  } finally { await browser.close(); }
})().catch(error=>{process.stderr.write(String(error&&error.stack||error)+'\\n');process.exitCode=1;});
