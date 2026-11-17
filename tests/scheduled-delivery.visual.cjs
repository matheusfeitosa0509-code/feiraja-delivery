const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const storeHtml = fs.readFileSync(path.join(root, 'loja.html'), 'utf8');
const panelHtml = fs.readFileSync(path.join(root, 'painel.html'), 'utf8');
assert.ok(storeHtml.includes('Sua entrega será feita na '), 'checkout avisa a data da entrega agendada');
assert.ok(panelHtml.includes('Agendado para '), 'painel mostra o selo de agendamento');
assert.ok(panelHtml.includes('!scheduledPending'), 'painel impede cotação antes da abertura');
const scheduleSource = fs.readFileSync(path.join(root, 'supabase/functions/_shared/store-schedule.js'), 'utf8')
  .replaceAll('export async function ', 'async function ').replaceAll('export function ', 'function ').replaceAll('export const ', 'const ');
const uiSource = fs.readFileSync(path.join(root, 'loja-delivery-ui.js'), 'utf8')
  .replaceAll('export async function ', 'async function ').replaceAll('export function ', 'function ').replaceAll('export const ', 'const ');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [360, 412]) {
      const page = await browser.newPage({ viewport: { width, height: 780 } });
      await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:14px Arial;margin:0;padding:12px}.card{display:grid;grid-template-columns:22px 32px minmax(0,1fr) auto;gap:10px;align-items:center;padding:14px;border:1px solid #ddd;border-radius:14px}.copy{min-width:0}.copy span{display:block;overflow-wrap:anywhere}.price{font-size:11px;text-align:right;max-width:118px}</style></head><body><label id="deliveryHomeOption" class="card"><input id="deliveryHome" type="radio"><span>🏠</span><span class="copy"><b>Entrega Feira On</b><span id="deliveryHomeDescription"></span></span><span id="deliveryStartingPrice" class="price"></span></label></body></html>');
      const result = await page.evaluate(({ scheduleSource, uiSource }) => {
        const getStoreSchedule = new Function(scheduleSource + '\nreturn getStoreSchedule;')();
        const renderDeliveryOption = new Function(uiSource + '\nreturn renderDeliveryOption;')();
        const monday = getStoreSchedule(new Date('2026-11-16T22:00:00.000Z'));
        const saturday = getStoreSchedule(new Date('2026-11-14T18:00:00.000Z'));
        const sunday = getStoreSchedule(new Date('2026-11-15T12:00:00.000Z'));
        renderDeliveryOption({
          option: document.querySelector('#deliveryHomeOption'),
          radio: document.querySelector('#deliveryHome'),
          starting: document.querySelector('#deliveryStartingPrice'),
          description: document.querySelector('#deliveryHomeDescription'),
          isAdmin: false, adminCheckComplete: true, deliveryActive: true,
          withinHours: monday.within, scheduleLabel: monday.label,
        });
        return {
          monday, saturday, sunday,
          enabled: !document.querySelector('#deliveryHome').disabled,
          label: document.querySelector('#deliveryStartingPrice').textContent,
          description: document.querySelector('#deliveryHomeDescription').textContent,
          noOverflow: document.documentElement.scrollWidth <= innerWidth,
        };
      }, { scheduleSource, uiSource });
      assert.equal(result.monday.scheduledFor, '2026-11-17T10:00:00.000Z', 'segunda à noite → terça às 6h');
      assert.equal(result.saturday.scheduledFor, '2026-11-16T10:00:00.000Z', 'sábado 14h → segunda às 6h');
      assert.equal(result.sunday.scheduledFor, '2026-11-16T10:00:00.000Z', 'domingo → segunda às 6h');
      assert.equal(result.enabled, true);
      assert.equal(result.label, 'Entrega a partir de terça pela manhã');
      assert.equal(result.description, 'Taxa por distância, paga com Pix junto do pedido.');
      assert.equal(result.noOverflow, true, 'sem overflow horizontal em ' + width + 'px');
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
