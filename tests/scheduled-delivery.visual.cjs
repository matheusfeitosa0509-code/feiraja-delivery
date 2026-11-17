const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const storeHtml = fs.readFileSync(path.join(root, 'loja.html'), 'utf8');
const panelHtml = fs.readFileSync(path.join(root, 'painel.html'), 'utf8');

assert.ok(storeHtml.includes('Sua entrega sai na '), 'checkout avisa a data da entrega agendada');
assert.ok(storeHtml.includes('get_delivery_enabled'), 'consulta a flag pública também para visitantes sem login');
assert.ok(storeHtml.includes('homeDeliveryHeadline') && storeHtml.includes('homePickupBannerCopy') && storeHtml.includes('accountLoginSubtitle'), 'textos de entrega têm atualização dinâmica');
assert.ok(!storeHtml.includes('Retirada na loja</strong><small>ou com Uber</small>'), 'não deixa a cópia antiga fixa no topo');
assert.ok(panelHtml.includes('Agendado para '), 'painel mostra o selo de agendamento');
assert.ok(panelHtml.includes('!scheduledPending'), 'painel impede cotação antes da abertura');

const scheduleSource = fs.readFileSync(path.join(root, 'supabase/functions/_shared/store-schedule.js'), 'utf8')
  .replaceAll('export async function ', 'async function ').replaceAll('export function ', 'function ').replaceAll('export const ', 'const ');
const copyStart = storeHtml.indexOf('function syncDeliveryCustomerCopy(){');
const copyEnd = storeHtml.indexOf('\nfunction persistCart()', copyStart);
const copySource = copyStart >= 0 && copyEnd > copyStart ? storeHtml.slice(copyStart, copyEnd) : '';
if (!copySource) throw new Error('syncDeliveryCustomerCopy source missing');
const uiSource = fs.readFileSync(path.join(root, 'loja-delivery-ui.js'), 'utf8')
  .replaceAll('export async function ', 'async function ').replaceAll('export function ', 'function ').replaceAll('export const ', 'const ');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [360, 412]) {
      const page = await browser.newPage({ viewport: { width, height: 780 } });
      const consoleErrors = [];
      page.on('pageerror', error => consoleErrors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:14px Arial;margin:0;padding:12px}.copy{min-width:0;overflow-wrap:anywhere}</style></head><body><div id="homeDeliveryHeadline"></div><small id="homeDeliverySubline"></small><p id="homePickupBannerCopy"></p><div id="accountLoginSubtitle"></div><label id="deliveryHomeOption"><input id="deliveryHome" type="radio"><span id="deliveryHomeDescription"></span><span id="deliveryStartingPrice"></span></label></body></html>');

      const copyResult = await page.evaluate(({ copySource }) => {
        const $ = selector => document.querySelector(selector);
        const apply = active => new Function('deliveryActive', '$', copySource + '\nsyncDeliveryCustomerCopy();')(active, $);
        apply(true);
        const active = {
          headline: $('#homeDeliveryHeadline').textContent,
          sublineHidden: $('#homeDeliverySubline').hidden,
          banner: $('#homePickupBannerCopy').textContent,
          login: $('#accountLoginSubtitle').textContent,
          visibleUber: document.body.innerText.includes('Uber'),
        };
        apply(false);
        const inactive = {
          headline: $('#homeDeliveryHeadline').textContent,
          sublineHidden: $('#homeDeliverySubline').hidden,
          banner: $('#homePickupBannerCopy').textContent,
          login: $('#accountLoginSubtitle').textContent,
          visibleUber: document.body.innerText.includes('Uber'),
        };
        return { active, inactive, noOverflow: document.documentElement.scrollWidth <= innerWidth };
      }, { copySource });

      assert.deepEqual(copyResult.active, {
        headline: 'Retire na loja ou receba em casa',
        sublineHidden: true,
        banner: 'Av. Lourenço da Silva Braga, 700, Manaus. Retire na loja ou receba em casa com a Entrega Feira On.',
        login: 'Tudo da feira, retire ou receba em casa.',
        visibleUber: false,
      });
      assert.deepEqual(copyResult.inactive, {
        headline: 'Retirada na loja',
        sublineHidden: false,
        banner: 'Av. Lourenço da Silva Braga, 700, Manaus. Retire na loja ou chame seu Uber.',
        login: 'Tudo da feira, pronto para retirada.',
        visibleUber: true,
      });
      assert.equal(copyResult.noOverflow, true, 'sem overflow nos textos em ' + width + 'px');

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
          schedule: document.querySelector('#deliveryHomeDescription .checkout-delivery-schedule')?.textContent || null,
          noOverflow: document.documentElement.scrollWidth <= innerWidth,
        };
      }, { scheduleSource, uiSource });

      assert.equal(result.monday.scheduledFor, '2026-11-17T10:00:00.000Z', 'segunda à noite → terça às 6h');
      assert.equal(result.saturday.scheduledFor, '2026-11-16T10:00:00.000Z', 'sábado 14h → segunda às 6h');
      assert.equal(result.sunday.scheduledFor, '2026-11-16T10:00:00.000Z', 'domingo → segunda às 6h');
      assert.equal(result.enabled, true);
      assert.equal(result.label, 'Ter. de manhã');
      assert.equal(result.description.startsWith('Taxa por distância, paga com Pix junto do pedido.'), true);
      assert.equal(result.schedule, 'Entrega a partir de terça, 17/11 pela manhã.');
      assert.equal(result.noOverflow, true, 'sem overflow horizontal em ' + width + 'px');
      assert.deepEqual(consoleErrors, [], 'zero erros de console/pageerror em ' + width + 'px');
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
