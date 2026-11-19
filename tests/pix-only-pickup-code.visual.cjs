const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'loja.html'), 'utf8');
const start = html.indexOf('<section class="checkout-card checkout-payment"');
const end = html.indexOf('</section>', start);
assert.ok(start >= 0 && end > start, 'seção de pagamento do checkout deve existir');
const paymentMarkup = html.slice(start, end + '</section>'.length);
assert.match(paymentMarkup, /Pagamento somente por Pix\. Seu pedido é separado após a confirmação do pagamento\./);
assert.match(paymentMarkup, /id="payPix"/);
assert.doesNotMatch(paymentMarkup, /payCash|payCard|Dinheiro na retirada|Cartão na retirada|value="cash"|value="card_on_delivery"/);
assert.match(html, /checkoutPaymentChoices/);
assert.match(html, /checkoutPaymentChoices/);
assert.match(html, /o\.delivery_type==='pickup_store'[^?]*o\.pickup_code/);

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [360, 412]) {
      const page = await browser.newPage({ viewport: { width, height: 780 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.setContent('<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:12px;font:14px Arial}.checkout-payment{width:100%;max-width:520px;margin:auto}.checkout-choice-list{display:grid;gap:8px}.checkout-choice-card{display:flex;align-items:center;gap:10px;min-height:58px;padding:12px;border:1px solid #d9e2d6;border-radius:12px}.checkout-choice-copy{min-width:0}.sm{font-size:12px;line-height:1.45}</style></head><body>' + paymentMarkup + '</body></html>');
      for (const deliveryType of ['delivery', 'pickup_store']) {
        await page.evaluate(type => {
          let delivery = document.querySelector('#testDeliveryType');
          if (!delivery) {
            delivery = document.createElement('input');
            delivery.type = 'hidden';
            delivery.id = 'testDeliveryType';
            document.body.append(delivery);
          }
          delivery.value = type;
        }, deliveryType);
        const result = await page.evaluate(() => {
          const section = document.querySelector('.checkout-payment');
          const radios = [...section.querySelectorAll('input[type="radio"]')].filter(el => !el.disabled);
          const labels = radios.map(el => section.querySelector('label[for="' + el.id + '"]')?.innerText || '');
          const rect = section.getBoundingClientRect();
          return {
            radioIds: radios.map(el => el.id),
            labels,
            text: section.innerText,
            width: rect.width,
            right: rect.right,
            viewport: document.documentElement.clientWidth
          };
        });
        assert.deepEqual(result.radioIds, ['payPix'], deliveryType + ' deve oferecer somente Pix');
        assert.match(result.text, /Pagamento somente por Pix/);
        assert.ok(result.width <= width && result.right <= width, deliveryType + ' não pode transbordar em ' + width + 'px');
      }
      assert.deepEqual(errors, [], 'zero erros de console/pageerror em ' + width + 'px');
      await page.close();
    }
    console.log('PASS: Pix-only checkout at 360px and 412px; delivery and pickup; no console errors.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
