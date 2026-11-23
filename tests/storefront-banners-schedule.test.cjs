const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const store = fs.readFileSync(path.join(root, 'loja.html'), 'utf8');
const helper = fs.readFileSync(path.join(root, 'supabase/functions/_shared/store-banner-schedule.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261123230000_daily_banners_schedule.sql'), 'utf8');

assert.match(store, /isStoreBannerScheduleActive/);
assert.match(store, /weekdays,start_time,end_time/);
assert.match(store, /storeBannerScheduleRows\.filter\(banner=>isStoreBannerScheduleActive\(banner\)\)/);
assert.match(store, /case 'kit'/);
assert.match(store, /dataset\.productId==='kit:'\+value/);
assert.match(helper, /timeZone: "America\/Manaus"/);
assert.match(helper, /current >= start && current < end/);

const slugs = [
  'kit-suco-semana',
  'kit-salada-fresca',
  'kit-farinhas-tapioca',
  'kit-legumes-refogados',
  'kit-salada-frutas',
  'kit-camarao-alho-oleo'
];
for (const slug of slugs) assert.ok(migration.includes(slug), 'banner sem destino de kit: '+slug);
assert.equal((migration.match(/false, themed\.sort_order/g) || []).length, 1, 'todos os seeds devem ser inseridos desligados');
assert.match(migration, /'2026-11-30 06:00:00-04'::timestamptz/);
console.log('PASSOU | banners semanais | agenda Manaus, CTA de kit e seeds desligados');
