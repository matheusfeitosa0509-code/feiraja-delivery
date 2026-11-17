const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const storeHtml = fs.readFileSync(path.join(root, 'loja.html'), 'utf8');
const helperSource = fs.readFileSync(path.join(root, 'loja-delivery-ui.js'), 'utf8').replace(/^export\s+/gm, '');
const gpsStart = storeHtml.indexOf('async function useDeliveryGps(){');
const gpsEnd = storeHtml.indexOf('\nfunction setDeliveryQuoteStatus', gpsStart);
if (gpsStart < 0 || gpsEnd < 0) throw new Error('GPS implementation not found');
const gpsSource = storeHtml.slice(gpsStart, gpsEnd);

for (const required of [
  'deliveryQuoteCache=new Map()', 'expiresAt:Date.now()+300000',
  'setTimeout(()=>void requestDeliveryQuote(),1500)',
  'delivery-map-center-pin', 'locationBias: { circle:',
  'id="deliveryUseGps"', 'id="deliveryConfirmAddress"', "deliveryMap.on('moveend',()=>scheduleDeliveryMapReverse())",
  "deliveryQuoteCache.set(cacheKey",
]) assert.ok(storeHtml.includes(required), 'missing delivery behavior: ' + required);

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [360, 412]) {
      const page = await browser.newPage({ viewport: { width, height: 780 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:14px Arial;margin:0;padding:12px}.panel{max-width:520px;margin:auto}button{width:100%;min-height:46px}#deliveryQuoteStatus{overflow-wrap:anywhere}</style></head><body><main class="panel"><button id="deliveryUseGps">Usar minha localização</button><button id="deliveryConfirmAddress" hidden>Confirmar endereço e calcular entrega</button><div id="deliveryMapPanel" hidden></div><p id="deliveryQuoteStatus" aria-live="polite"></p></main></body></html>');
      await page.addScriptTag({ content: helperSource + '\nwindow.quoteError = deliveryQuoteErrorMessage;' });
      await page.addScriptTag({ content: `
        let deliveryMap=null;
        const $=selector=>document.querySelector(selector);
        function setDeliveryQuoteStatus(message){ $('#deliveryQuoteStatus').textContent=message; }
        async function openDeliveryMap(){ $('#deliveryMapPanel').hidden=false; deliveryMap={setView(point){window.lastGpsPoint=point;}}; }
        ${gpsSource}
        window.runGps=useDeliveryGps;
      `});
      const messages = await page.evaluate(() => ({
        notFound: window.quoteError(400, 'ADDRESS_NOT_FOUND'),
        outside: window.quoteError(422, 'LALAMOVE_OUT_OF_SERVICE_AREA'),
        rate: window.quoteError(429, 'QUOTE_RATE_LIMIT'),
        generic: window.quoteError(502, 'LALAMOVE_QUOTE_FAILED'),
      }));
      assert.equal(messages.notFound, 'Não encontramos esse endereço.');
      assert.equal(messages.outside, 'Endereço fora da área de entrega.');
      assert.equal(messages.rate, 'Muitas consultas agora, tente em alguns segundos.');
      assert.equal(messages.generic, 'Entrega indisponível no momento.');

      await page.evaluate(() => {
        Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
          getCurrentPosition(success, failure){ failure(new Error('permission denied')); }
        }});
        window.runGps();
      });
      await page.waitForFunction(() => document.querySelector('#deliveryQuoteStatus').textContent.includes('Permita a localização'));
      const denied = await page.locator('#deliveryQuoteStatus').textContent();
      assert.ok(denied.includes('Retirar na loja'));

      await page.evaluate(() => {
        Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
          getCurrentPosition(success){ window.acceptGps = success; }
        }});
        window.runGps();
      });
      await page.evaluate(async () => {
        await window.acceptGps({ coords: { latitude: -3.10, longitude: -60.02 } });
      });
      await page.waitForFunction(() => document.querySelector('#deliveryQuoteStatus').textContent.includes('Localização aproximada encontrada'));
      assert.deepEqual(await page.evaluate(() => window.lastGpsPoint), [-3.10, -60.02]);
      assert.equal(await page.locator('#deliveryMapPanel').isVisible(), true);\n      assert.equal(await page.locator('#deliveryConfirmAddress').isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, [], 'zero erros de console/page em ' + width + 'px');
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
