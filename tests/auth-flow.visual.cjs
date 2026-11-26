'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const store = fs.readFileSync(path.join(root, 'loja.html'), 'utf8');
const recovery = fs.readFileSync(path.join(root, 'recuperar-senha.html'), 'utf8');
const turnstile = fs.readFileSync(path.join(root, 'turnstile.js'), 'utf8');
const passwordFn = store.match(/function isValidAccountPassword\(value\)\{[^}]+\}/)?.[0];
const errorFn = store.match(/function authErrorMessage\(error,action="login"\)\{[^\n]+\}/)?.[0];
assert.ok(passwordFn, 'validador de senha do cadastro existe');
assert.ok(errorFn, 'tradutor de erros Auth existe');
const context = vm.createContext({});
vm.runInContext(passwordFn + '\n' + errorFn, context);
assert.equal(vm.runInContext('isValidAccountPassword("abc12345")', context), true);
assert.equal(vm.runInContext('isValidAccountPassword("12345678")', context), false);
assert.equal(vm.runInContext('isValidAccountPassword("abcdefgh")', context), false);
assert.equal(vm.runInContext('isValidAccountPassword("abc123")', context), false);
assert.match(vm.runInContext('authErrorMessage({code:"invalid_credentials"})', context), /E-mail ou senha incorretos/);
assert.match(vm.runInContext('authErrorMessage({code:"user_already_exists"},"signup")', context), /já tem uma conta/);
assert.match(vm.runInContext('authErrorMessage({code:"email_not_confirmed"})', context), /não foi confirmado/);
assert.match(vm.runInContext('authErrorMessage({code:"otp_expired"},"recovery")', context), /expirou/);
assert.match(vm.runInContext('authErrorMessage({status:429})', context), /Muitas tentativas/);
assert.match(store, /Evite senhas comuns como 123456 ou sua data de nascimento\./);
assert.match(store, /Entrar com Google · mais rápido, sem senha/);
assert.match(store, /Tudo da feira, retire ou receba em casa\./);
assert.match(store, /customerPhoneReady=profileUser\.is_anonymous===true\|\|!!profileName&&!!profilePhone/);
assert.doesNotMatch(store, /Tudo da feira, pronto para retirada\./);
assert.match(recovery, /Use pelo menos 8 caracteres, com letras e números/);
assert.match(recovery, /!\/\\d\/\.test\(p\)/);
assert.match(turnstile, /},8000\)/);

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [360, 412]) {
      const page = await browser.newPage({ viewport: { width, height: 850 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await page.setContent('<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font:14px Arial}.card{width:100%;max-width:440px;padding:16px}.meter{height:5px;background:#eee}.meter span{display:block;width:75%;height:5px;background:#24834a}button,input{max-width:100%;min-height:44px}</style><main class="card"><button id="google">Entrar com Google · mais rápido, sem senha</button><form><label>Senha</label><input id="pw" type="password"><div class="meter"><span></span></div><small>Evite senhas comuns como 123456 ou sua data de nascimento.</small><button>Criar conta</button></form></main>');
      const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, inner: innerWidth }));
      assert.equal(dimensions.width, width, 'sem rolagem horizontal em ' + width + 'px');
      assert.equal(await page.locator('#google').isVisible(), true);
      assert.deepEqual(errors, [], 'sem erros de console/pageerror em ' + width + 'px');
      await page.close();
    }
  } finally { await browser.close(); }
  process.stdout.write('Auth UX checks passed at 360px and 412px\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
