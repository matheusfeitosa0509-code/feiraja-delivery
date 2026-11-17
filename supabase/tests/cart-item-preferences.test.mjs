import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const loja = readFileSync('loja.html', 'utf8');
const worker = readFileSync('supabase/functions/super-worker/index.ts', 'utf8');
const assistant = readFileSync('supabase/functions/assistente/index.ts', 'utf8');
const panel = readFileSync('painel.html', 'utf8');

test('carrinho persiste e apresenta observação e preferência por item', () => {
  assert.match(loja, /feiraja_cart_preferences_v1/);
  assert.match(loja, /function itemPreferenceMarkup\(product\)/);
  assert.match(loja, /maxlength="100"/);
  assert.match(loja, /data-pref-substitution/);
  assert.match(loja, /cart-substitution-chip/);
  assert.match(loja, /Substituir por similar/);
  assert.match(loja, /Não substituir/);
  assert.doesNotMatch(loja.slice(loja.indexOf('function itemPreferenceMarkup'), loja.indexOf('function setItemPreference')), /Me chamar no WhatsApp|<select/);
  assert.match(loja, /cartPreferencesMigrated/);
  assert.match(loja, /itemPreferenceMarkup\(x\.p\)/);
});

test('checkout envia preferências nos fluxos Pix e retirada na loja', () => {
  assert.equal((loja.match(/item_note:String\(cartPreferences\[x\.p\.id\]/g) || []).length, 3);
  assert.match(loja, /item_preferences:t\.items\.map/);
});

test('repetição da loja e Assistente preservam os dois campos', () => {
  assert.match(loja, /cartPreferences\[p\.id\]=\{note:String\(item\.item_note/);
  assert.match(loja, /cartPreferences\[item\.product_id\]=\{note:String\(item\.item_note/);
  assert.match(assistant, /preferencesById\.set\(id/);
  assert.match(assistant, /item_note: String\(oldItem\?\.item_note/);
  assert.match(assistant, /substitution_preference: preference === 'remove' \? 'remove' : 'replace'/);
  assert.doesNotMatch(assistant, /enum: \[\"replace\", \"remove\", \"call\"\]/);
});

test('servidor valida os campos e painel exibe por item', () => {
  assert.match(worker, /normalizeItemPreference\(item\?\.item_note, item\?\.substitution_preference\)/);
  assert.match(worker, /itemPreferencesById/);
  assert.match(panel, /Se faltar:/);
  assert.match(panel, /remove:'não substituir'/);
  assert.match(panel, /call:'me chamar'/);
});

test('correções de horário e código Uber da #246 permanecem', () => {
  assert.match(loja, /checkoutScheduleMessage/);
  assert.match(loja, /pickupForecast/);
  assert.match(loja, /o\.delivery_type==='pickup_uber'&&st==='Pronto para Retirada'&&o\.pickup_code/);
});
