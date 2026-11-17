const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lalamove-map.js'), 'utf8');

async function runViewport(browser, width, height, vehicle) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', error => errors.push('pageerror: ' + error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push('console.error: ' + message.text()); });
  await page.addInitScript(() => {
    window.__pollMs = null;
    window.__cleared = false;
    window.setInterval = (fn, ms) => { window.__pollMs = ms; return 77; };
    window.clearInterval = id => { if (id === 77) window.__cleared = true; };
    class Bounds {
      constructor() { this.points = []; }
      extend(point) { this.points.push(point); return this; }
    }
    class MockMap {
      constructor(options) {
        this.options = options; this.handlers = {}; this.sources = {}; this.layers = [];
        this.container = typeof options.container === 'string' ? document.getElementById(options.container) : options.container;
        this.canvas = document.createElement('div'); this.canvas.className = 'maplibregl-canvas'; this.container.append(this.canvas);
      }
      loaded() { return true; }
      on(name, fn) { this.handlers[name] = fn; return this; }
      once(name, fn) { if (name === 'load') queueMicrotask(fn); return this; }
      addControl(control) { this.control = control; return this; }
      fitBounds(bounds, options) { this.bounds = bounds.points; this.fitOptions = options; return this; }
      addSource(id, source) { this.sources[id] = { ...source, setData(data) { this.data = data; } }; }
      getSource(id) { return this.sources[id]; }
      addLayer(layer) { this.layers.push(layer); }
      resize() {}
      remove() { this.removed = true; this.container.replaceChildren(); }
    }
    class MockMarker {
      constructor(options) { this.options = options; this.element = options.element; this.lngLat = null; this.rotation = 0; }
      setLngLat(point) { this.lngLat = { lng: point[0], lat: point[1] }; return this; }
      getLngLat() { return this.lngLat; }
      setRotation(value) { this.rotation = value; return this; }
      getRotation() { return this.rotation; }
      addTo(map) { this.map = map; map.container.append(this.element); return this; }
    }
    window.maplibregl = { Map: MockMap, Marker: MockMarker, LngLatBounds: Bounds, AttributionControl: class {} };
    window.IntersectionObserver = undefined;
  });
  await page.setContent(`<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;font:14px Arial"><main style="width:100%;max-width:520px;margin:auto;padding:12px;box-sizing:border-box"><h3>Pedido · Entrega Feira On</h3><div id="map" data-order-id="MOCK-TRACKING"></div><div id="searching" data-order-id="MOCK-SEARCHING"></div></main></body></html>`);
  await page.addStyleTag({ content: '*{box-sizing:border-box}.feira-lalamove-map-canvas{height:230px}.maplibregl-canvas{position:absolute;inset:0}.feira-map-pin{position:relative}' });
  await page.addScriptTag({ path: path.join(root, 'lalamove-map.js') });
  await page.evaluate(async vehicleType => {
    const route = [
      { lat: -3.1347, lng: -60.0237 },
      { lat: -3.1265, lng: -60.0181 },
      { lat: -3.1162, lng: -60.0124 },
    ];
    let index = 0;
    window.__tracking = window.FeiraLalamoveMap.mount(document.querySelector('#map'), async () => ({
      active: true, status: 'picked_up', provider: 'lalamove', driver_assigned: true, vehicle: vehicleType,
      store: { lat: -3.1347, lng: -60.0237 }, customer: { lat: -3.1050, lng: -60.0050 },
      driver: { name: 'Motorista simulado', plateNumber: '**ABC*', coordinates: route[Math.min(index++, route.length - 1)] },
      tracking_url: 'https://tracking.lalamove.com/mock',
    }), { animationDurationMs: 1100 });
    window.__search = window.FeiraLalamoveMap.mount(document.querySelector('#searching'), async () => ({
      active: true, status: 'searching', driver_assigned: false,
    }));
  }, vehicle);
  await page.waitForSelector('#map .feira-map-pin.driver');
  await page.waitForSelector('#searching .feira-lalamove-map-status');
  const initial = await page.evaluate(() => ({
    status: document.querySelector('#map .feira-lalamove-map-status').textContent,
    driver: document.querySelector('#map .feira-map-pin.driver').textContent,
    markers: document.querySelectorAll('#map .feira-map-pin').length,
    info: document.querySelector('#map .feira-lalamove-driver-info').innerText,
    fallback: document.querySelector('#map .feira-lalamove-tracking-fallback').href,
    searching: document.querySelector('#searching .feira-lalamove-map-status').textContent,
    searchingMapHidden: document.querySelector('#searching .feira-lalamove-map-canvas').hidden,
    pollMs: window.__pollMs,
    noHorizontalScroll: document.documentElement.scrollWidth <= window.innerWidth,
    cameraIncludesThreePoints: window.__tracking.map.bounds.length === 3,
  }));
  assert.match(initial.status, /Motorista a caminho/);
  assert.equal(initial.driver, vehicle === 'CAR' ? '🚗' : '🛵');
  assert.equal(initial.markers, 3, 'store, customer and driver markers must be present');
  assert.match(initial.info, /Motorista simulado/);
  assert.match(initial.info, /Placa \*\*ABC\*/);
  assert.match(initial.fallback, /tracking\.lalamove\.com/);
  assert.match(initial.searching, /Procurando entregador/);
  assert.equal(initial.searchingMapHidden, true, 'map stays hidden until a driver is assigned');
  assert.equal(initial.pollMs, 15000, 'tracking polls every 15 seconds');
  assert.equal(initial.noHorizontalScroll, true);
  assert.equal(initial.cameraIncludesThreePoints, true, 'initial camera fits driver, destination and store');
  await page.waitForFunction(() => window.__tracking && !window.__tracking.inFlight);
  const start = await page.evaluate(() => window.__tracking.driverMarker.getLngLat());
  await page.evaluate(() => window.__tracking.refresh());
  await page.waitForTimeout(400);
  const mid = await page.evaluate(() => window.__tracking.driverMarker.getLngLat());
  assert.notDeepEqual(mid, start, 'driver marker must interpolate between positions instead of jumping');
  assert.ok(mid.lat > start.lat && mid.lat < -3.1265, 'intermediate marker latitude should be between both mocked positions');
  await page.waitForTimeout(850);
  const end = await page.evaluate(() => ({
    point: window.__tracking.driverMarker.getLngLat(),
    rotation: window.__tracking.driverMarker.getRotation(),
  }));
  assert.ok(Math.abs(end.point.lat - (-3.1265)) < 0.00001, 'marker reaches the next mocked position');
  assert.ok(end.rotation > 0 && end.rotation < 360, 'vehicle rotates toward its direction of travel');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const paused = await page.evaluate(() => window.__cleared);
  assert.equal(paused, true, 'polling pauses when the app goes to the background');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, `content must not overflow at ${width}px`);
  assert.deepEqual(errors, [], `no browser or console errors at ${width}px: ${errors.join('; ')}`);
  await page.close();
}

async function runFailureMode(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => { window.IntersectionObserver = undefined; });
  await page.setContent('<main><div id="customer" data-order-id="MOCK-CUSTOMER"></div><div id="admin" data-order-id="MOCK-ADMIN"></div></main>');
  await page.addScriptTag({ path: path.join(root, 'lalamove-map.js') });
  await page.evaluate(() => {
    window.FeiraLalamoveMap.mount(document.querySelector('#customer'), async () => { throw new Error('tracking unavailable'); });
    window.FeiraLalamoveMap.mount(document.querySelector('#admin'), async () => { throw new Error('tracking unavailable'); }, { admin: true });
  });
  await page.waitForFunction(() => document.querySelector('#customer').hidden && document.querySelector('#admin .feira-lalamove-map-status')?.textContent.includes('Rastreio indisponível'));
  assert.equal(await page.locator('#admin .feira-lalamove-map-canvas').isHidden(), true);
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await runViewport(browser, 360, 800, 'MOTO');
    await runViewport(browser, 412, 915, 'CAR');
    await runFailureMode(browser);
  } finally {
    await browser.close();
  }
  process.stdout.write('MapLibre Lalamove tracking: MOTO/CAR, interpolation, rotation, 15s polling, visibility pause, searching state and 360/412px passed.\\n');
})().catch(error => {
  process.stderr.write(String(error && error.stack || error) + '\\n');
  process.exitCode = 1;
});
