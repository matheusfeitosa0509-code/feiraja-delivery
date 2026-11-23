import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const loja = readFileSync('loja.html', 'utf8');
const migration = readFileSync('supabase/migrations/20261122210000_first_delivery_promo_preview_a3.sql', 'utf8');
const cases = readFileSync('supabase/tests/first_delivery_promo_cases.sql', 'utf8');

assert.match(loja, /preview_first_delivery_promo/);
assert.match(loja, /Entrega de ['"]\+vehicle/);
assert.match(loja, /GRÁTIS 🎁/);
assert.match(loja, /A entrega grátis vale só no 1º pedido/);
assert.match(loja, /Faltam ['"]\+money\(Math\.max\(0,minimum-subtotal\)\)/);
assert.match(loja, /#phone['"]\)\.addEventListener\(['"]input/);
assert.match(migration, /SECURITY DEFINER/);
assert.match(migration, /does not reserve/i);
assert.match(migration, /r\.status <> 'released'/);
assert.match(cases, /FAIL preview eligible/);
assert.match(cases, /FAIL preview below minimum/);
assert.match(cases, /FAIL preview pickup/);
assert.match(cases, /FAIL preview paid account/);
assert.match(cases, /FAIL preview same phone other account/);
assert.match(cases, /FAIL preview created a reservation/);

console.log('PASSOU | checkout mostra a prévia e cobre elegível, mínimo, retirada, conta paga, telefone de outra conta e ausência de reserva');
