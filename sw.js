// SERVICE WORKER: tiene una copia dell'app sul dispositivo, così si apre anche senza rete.
// Non tocca mai i dati delle mappe (quelli stanno nella Cassaforte).
// Per pubblicare una nuova versione: cambiare il numero qui sotto.

const CACHE = 'lavagna-v0.1.0';
const FILE = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/cassaforte.js',
  './js/tela.js',
  './manifest.webmanifest',
  './icone/icona-192.png',
  './icone/icona-512.png',
  './icone/icona-maschera-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomi) => Promise.all(nomi.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Risponde subito dalla copia locale e, se c'è rete, la aggiorna per la prossima apertura.
self.addEventListener('fetch', (e) => {
  const richiesta = e.request;
  if (richiesta.method !== 'GET' || new URL(richiesta.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const copia = await cache.match(richiesta, { ignoreSearch: true });
      const rete = fetch(richiesta)
        .then((risposta) => {
          if (risposta && risposta.ok) cache.put(richiesta, risposta.clone());
          return risposta;
        })
        .catch(() => null);
      if (copia) { e.waitUntil(rete); return copia; }
      return (await rete) || new Response('Non disponibile senza rete', { status: 503 });
    })
  );
});
