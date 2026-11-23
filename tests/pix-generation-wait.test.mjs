import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../loja.html', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20261123050000_store_funnel_pix_duration.sql', import.meta.url), 'utf8');

assert.match(html, /id="pixGenerationWait"/, 'checkout includes the non-dismissible Pix wait sheet');
assert.match(html, /Conferindo seus produtos[\s\S]*Calculando a entrega[\s\S]*Gerando seu Pix/);
assert.match(html, /Está demorando um pouco mais que o normal\. Não feche esta tela\./);
assert.match(html, /pixGenerationDelayTimer=setTimeout[\s\S]*15000/, 'slow-response hint appears after 15 seconds');
assert.match(html, /Math\.min\(92,/, 'progress never reaches 100% before the Pix is ready');
assert.match(html, /requestSubmit\(\)/, 'retry reuses the same form submission path');
assert.match(html, /checkout_idempotency_key:checkoutIdempotencyKey/, 'the existing idempotency key is sent to the worker');
assert.match(html, /p_duration_ms:durationMs/, 'Pix duration is sent to the funnel');
assert.match(migration, /duration_ms integer/, 'funnel stores elapsed milliseconds');
assert.match(migration, /p_duration_ms integer/, 'RPC accepts the measured duration');

const guard = html.match(/function lockPixSubmitButton\(button\)\{[^}]+\}/)?.[0];
assert.ok(guard, 'the real checkout submit guard exists');
const lock = vm.runInNewContext(guard + '; lockPixSubmitButton');
const button = { disabled: false };
let workerRequests = 0;
if (lock(button)) workerRequests++;
if (lock(button)) workerRequests++;
assert.equal(workerRequests, 1, 'two rapid taps are reduced to one checkout request');
assert.equal(button.disabled, true, 'the checkout button remains locked during the request');

const missingQr = html.indexOf('if(!qr)');
const keyRemoval = html.indexOf("localStorage.removeItem('feiraja_checkout_idempotency_v1')");
assert.ok(missingQr >= 0 && keyRemoval > missingQr, 'the key is retained until the Pix QR code is returned');
assert.match(html, /Seu pedido foi registrado, mas o código Pix ainda não ficou disponível[\s\S]*Tentar de novo/, 'a missing QR can be retried without discarding the order attempt');
console.log('Pix wait screen, funnel duration and double-tap guard tests passed.');
