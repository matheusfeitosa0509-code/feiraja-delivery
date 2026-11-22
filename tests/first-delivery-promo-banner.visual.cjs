const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(process.cwd(), 'loja.html'), 'utf8');
assert.match(html, /id="storeBannersCarousel"/, 'dynamic storefront carousel missing');
assert.match(html, /id="storeBannersTrack"/, 'dynamic banner track missing');
assert.match(html, /function loadStoreBanners\(\)/, 'store_banners loader missing');
assert.match(html, /get_first_delivery_promo_offer/, 'promotion setting gate missing');
assert.match(html, /promo_code==='PRIMEIRA_ENTREGA'&&!offerEnabled/, 'promo banner must be hidden when the promotion is disabled');
assert.match(html, /function storeBannerCountdown\(endsAt\)/, 'banner countdown missing');
assert.doesNotMatch(html, /id="firstDeliveryPromoBanner"/, 'fixed first-delivery banner must be removed');
assert.doesNotMatch(html, /id="homeBanners"/, 'old highlights carousel must be removed');
assert.doesNotMatch(html, /function startHomeBanners\(\)/, 'old highlights carousel logic must be removed');
console.log('PASSOU | banner promocional fixo substituído pelo carrossel dinâmico de store_banners.');
