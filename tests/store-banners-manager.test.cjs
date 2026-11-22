const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const panel = fs.readFileSync(path.join(root, 'painel.html'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'supabase/migrations/20261122155000_store_banners_manager.sql'), 'utf8');
const policies = fs.readFileSync(path.join(root, 'supabase/migrations/20261122160000_store_banners_rls_tightening.sql'), 'utf8');

for (const id of [
  'storeBannersManager','storeBannerList','storeBannerForm','storeBannerTitle',
  'storeBannerSubtitle','storeBannerButtonText','storeBannerActionType',
  'storeBannerActionValue','storeBannerTheme','storeBannerAudience',
  'storeBannerStartsAt','storeBannerEndsAt','storeBannerRulesText',
  'storeBannerActive','storeBannerSortOrder','storeBannerPromoCode','storeBannerPreview'
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
assert.match(schema, /grant select on public\.store_banners to anon, authenticated/i);
assert.match(schema, /grant insert, update, delete on public\.store_banners to authenticated/i);
assert.match(policies, /for select to anon/i);
assert.match(policies, /for select to authenticated/i);
assert.match(policies, /for insert to authenticated[\s\S]*is_current_user_admin/i);
assert.match(policies, /for update to authenticated[\s\S]*is_current_user_admin/i);
assert.match(policies, /for delete to authenticated[\s\S]*is_current_user_admin/i);
console.log('PASSOU | gerenciador de banners | markup, JavaScript, schema, seeds e políticas RLS');
