const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts');
const videos = path.join(artifacts, 'order-tracking-videos');
fs.mkdirSync(videos, { recursive: true });

const storeHtml = fs.readFileSync(path.join(root, 'loja.html'), 'utf8');
const styleStart = storeHtml.indexOf('<style id="orderTrackingLayout">');
const styleEnd = storeHtml.indexOf('</style>', styleStart);
if (styleStart < 0 || styleEnd < 0) throw new Error('orderTrackingLayout CSS missing from loja.html');
const trackingCss = storeHtml.slice(styleStart + '<style id="orderTrackingLayout">'.length, styleEnd);
const timelineCss = `:root{--mut:#607467;--ink:#203b27;--g:#2f8a4c}
*{box-sizing:border-box}body{margin:0;background:#f4f7f2;font-family:Arial,sans-serif;color:#203b27}
.frame{width:100%;max-width:520px;margin:0 auto;padding:14px;background:#fff}
${trackingCss}
#map{width:100%;min-width:0}
`;

async function runViewport(browser, width, height) {
  const context = await browser.newContext({
    viewport: { width, height },
    recordVideo: { dir: videos, size: { width, height } },
  });
  const page = await context.newPage();
  await page.route('https://mock-driver-photo.test/avatar.svg', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="32" fill="#2f8a4c"/><text x="32" y="42" text-anchor="middle" font-size="30" fill="white">M</text></svg>',
  }));
  await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
    <main class="frame">
      <h3>Pedido de teste · Entrega Feira On</h3>
      <div class="order-timeline"><ol>
        <li class="done"><span class="timeline-dot">💳</span><span class="timeline-label">Pago</span></li>
        <li class="done"><span class="timeline-dot">📦</span><span class="timeline-label">Preparando</span></li>
        <li class="now"><span class="timeline-dot">🛵</span><span class="timeline-label">Caminho</span></li>
        <li><span class="timeline-dot">✓</span><span class="timeline-label">Entregue</span></li>
      </ol><p class="order-timeline-detail">Motorista simulado está levando seu pedido.</p></div>
      <div id="map" data-order-id="MOCK-TRACKING"></div>
    </main>
  </body></html>`);
  await page.addStyleTag({ content: timelineCss });
  await page.addStyleTag({ url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css' });
  await page.evaluate(() => {
    window.IntersectionObserver = class { observe() {} disconnect() {} };
  });
  await page.addScriptTag({ url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js' });
  await page.addScriptTag({ path: path.join(root, 'lalamove-map.js') });

  await page.evaluate(async () => {
    const route = [
      { lat: -3.1347, lng: -60.0237 },
      { lat: -3.1265, lng: -60.0181 },
      { lat: -3.1162, lng: -60.0124 },
      { lat: -3.1050, lng: -60.0050 },
    ];
    let index = 0;
    window.__tracking = window.FeiraLalamoveMap.mount(
      document.querySelector('#map'),
      async () => ({
        active: true,
        status: 'assigned',
        provider: 'lalamove',
        driver_assigned: true,
        vehicle: 'MOTO',
        store: { lat: -3.1347, lng: -60.0237 },
        customer: { lat: -3.1050, lng: -60.0050 },
        driver: {
          name: 'Motorista simulado',
          plateNumber: '**ABC*',
          photo: 'https://mock-driver-photo.test/avatar.svg',
          coordinates: route[Math.min(index++, route.length - 1)],
        },
      }),
      { animationDurationMs: 550, pollIntervalMs: 60000 },
    );
    await window.__tracking.refresh();
  });
  for (let step = 0; step < 3; step++) {
    await page.waitForTimeout(80);
    await page.evaluate(() => window.__tracking.refresh());
    await page.waitForTimeout(650);
  }

  const layout = await page.evaluate(() => {
    const dots = [...document.querySelectorAll('.timeline-dot')];
    const labels = [...document.querySelectorAll('.timeline-label')];
    const tops = dots.map(dot => Math.round(dot.getBoundingClientRect().top));
    return {
      count: dots.length,
      tops,
      centers: dots.map(dot => Math.round(dot.getBoundingClientRect().left + dot.getBoundingClientRect().width / 2)),
      labelsNoWrap: labels.every(label => getComputedStyle(label).whiteSpace === 'nowrap'),
      noHorizontalScroll: document.documentElement.scrollWidth <= window.innerWidth,
      driver: window.__tracking.driverMarker?.getLatLng()
        ? { lat: window.__tracking.driverMarker.getLatLng().lat, lng: window.__tracking.driverMarker.getLatLng().lng }
        : null,
      mapVisible: !document.querySelector('.feira-lalamove-map-canvas').hidden,
      driverPhoto: !!document.querySelector('.feira-lalamove-driver-info img'),
    };
  });
  assert.equal(layout.count, 4, `expected four timeline stages at ${width}px`);
  assert.equal(new Set(layout.tops).size, 1, `timeline circles wrapped vertically at ${width}px: ${layout.tops}`);
  const gaps = layout.centers.slice(1).map((x, i) => x - layout.centers[i]);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 2, `timeline columns are not equal at ${width}px: ${gaps}`);
  assert.equal(layout.labelsNoWrap, true);
  assert.equal(layout.noHorizontalScroll, true);
  assert.equal(layout.mapVisible, true);
  assert.equal(layout.driverPhoto, true, 'driver photo should appear when supplied by the API');
  assert.ok(layout.driver && Math.abs(layout.driver.lat - (-3.1050)) < 0.001, 'mock motorcycle should finish near the customer pin');

  await page.screenshot({ path: path.join(artifacts, `order-tracking-${width}.png`), fullPage: true });
  const video = page.video();
  await context.close();
  if (video) {
    const source = await video.path();
    fs.copyFileSync(source, path.join(artifacts, `order-tracking-${width}.webm`));
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await runViewport(browser, 360, 800);
    await runViewport(browser, 412, 915);
  } finally {
    await browser.close();
  }
  process.stdout.write('Order tracking mock map: 360px and 412px passed; screenshots and videos saved in artifacts/.\\n');
})().catch(error => {
  process.stderr.write(String(error && error.stack || error) + '\\n');
  process.exitCode = 1;
});
