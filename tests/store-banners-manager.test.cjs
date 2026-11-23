const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const panel = fs.readFileSync(path.join(root, 'painel.html'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'supabase/migrations/20261122155333_store_banners_manager.sql'), 'utf8');
const imageMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261123130000_store_banners_image.sql'), 'utf8');
const policies = fs.readFileSync(path.join(root, 'supabase/migrations/20261122155432_store_banners_rls_tightening.sql'), 'utf8');
const scheduleMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261123230000_daily_banners_schedule.sql'), 'utf8');

for (const id of [
  'storeBannersManager','storeBannerList','storeBannerForm','storeBannerTitle',
  'storeBannerSubtitle','storeBannerButtonText','storeBannerActionType',
  'storeBannerActionValue','storeBannerTheme','storeBannerAudience',
  'storeBannerStartsAt','storeBannerEndsAt','storeBannerRulesText',
  'storeBannerActive','storeBannerSortOrder','storeBannerPromoCode','storeBannerPreview',
  'storeBannerImageFile','storeBannerImageUpload','storeBannerImageRemove','storeBannerImagePreview',
  'storeBannerScheduleEnabled','storeBannerScheduleFields','storeBannerStartTime','storeBannerEndTime'
]) assert.ok(panel.includes('id="'+id+'"'), 'campo ausente no painel: '+id);

const managerScript = panel.split('<script type="module">')
  .map(part => part.split('</script>')[0])
  .find(part => part.includes('storeBannerNew') && part.includes('storeBannerForm'));
assert.ok(managerScript, 'script do gerenciador não encontrado');
new vm.Script(managerScript, { filename: 'painel.html#store-banners' });

for (const action of ['products','category','product','whatsapp','assistant','request_product','maps']) {
  assert.ok(schema.includes("'"+action+"'"), 'ação ausente no schema: '+action);
}
for (const seed of ['Sua 1ª entrega é GRÁTIS','Fale com o Assistente','Não achou o produto?','Retire na feira']) {
  assert.ok(schema.includes(seed), 'banner inicial ausente: '+seed);
}
assert.match(schema, /alter table public\.store_banners enable row level security/i);
assert.match(imageMigration, /add column if not exists image_url text/i);
assert.match(managerScript, /image\/webp/);
assert.match(managerScript, /80\*1024/);
assert.match(managerScript, /dimensions=\[\[1200,400\],\[1080,360\],\[960,320\],\[900,300\]\]/);
assert.match(schema, /grant select on public\.store_banners to anon, authenticated/i);
assert.match(schema, /grant insert, update, delete on public\.store_banners to authenticated/i);
assert.match(policies, /for select to anon/i);
assert.match(policies, /for select to authenticated/i);
assert.match(policies, /for insert to authenticated[\s\S]*is_current_user_admin/i);
assert.match(policies, /for update to authenticated[\s\S]*is_current_user_admin/i);
assert.match(policies, /for delete to authenticated[\s\S]*is_current_user_admin/i);
for (const action of ['kit']) assert.ok(scheduleMigration.includes("'"+action+"'"), 'ação semanal ausente no schema: '+action);
for (const field of ['weekdays','start_time','end_time']) assert.match(scheduleMigration, new RegExp('add column if not exists '+field, 'i'));
for (const title of ['Segunda da Polpa','Terça Verde','Bateu vontade de farofa e tapioca?','Quinta dos Legumes','Sexta das Frutas','Sábado dos Frutos do Mar']) assert.ok(scheduleMigration.includes(title), 'banner semanal ausente: '+title);
assert.match(scheduleMigration, /'06:00'::time, '13:00'::time, false/i);
assert.match(scheduleMigration, /false, themed\\.sort_order/i);
assert.match(managerScript, /storeBannerScheduleEnabled/);
assert.match(managerScript, /daily_recipe_kits/);
console.log('PASSOU | gerenciador de banners | markup, JavaScript, schema, seeds, agenda e políticas RLS');
