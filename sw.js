/* Service worker mínimo para habilitar instalação; sem cache nem interceptação. */
self.addEventListener('install', function (event) {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});
/* Intencionalmente não há handler fetch: tudo segue direto pela rede. */

self.addEventListener('push', function (event) {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { body: event.data ? event.data.text() : '' };
  }
  const requestedUrl = payload && payload.url;
  const targetUrl = requestedUrl === '/painel.html' ? '/painel.html' : '/loja.html';
  const body = typeof payload.body === 'string' && payload.body.trim()
    ? payload.body.trim()
    : 'Você tem uma atualização.';
  const tag = typeof payload.tag === 'string' ? payload.tag : 'feira-on-delivery';
  event.waitUntil(
    self.registration.showNotification('Feira On Delivery', {
      body: body,
      tag: tag,
      data: { url: targetUrl }
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const requestedUrl = event.notification && event.notification.data
    ? event.notification.data.url
    : '/loja.html';
  const targetUrl = requestedUrl === '/painel.html' ? '/painel.html' : '/loja.html';
  const absoluteTarget = new URL(targetUrl, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
      for (const client of windowClients) {
        if (client.url === absoluteTarget) {
          return client.focus();
        }
      }
      return self.clients.openWindow(absoluteTarget);
    })
  );
});
