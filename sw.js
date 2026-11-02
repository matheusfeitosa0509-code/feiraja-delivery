/* Service worker mínimo para habilitar instalação; sem cache nem interceptação. */
self.addEventListener('install', function (event) {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});
/* Intencionalmente não há handler fetch: tudo segue direto pela rede. */
