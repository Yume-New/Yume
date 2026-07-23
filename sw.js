// ══════════════════════════════════════════════════════════════════════
// sw.js — Service Worker Yume Travel Manager
// Phase E — Mode hors-ligne partiel
//
// STRATÉGIE
//   - Cache First  : tuiles Leaflet (CartoDB) → immédiat même hors-ligne
//   - Network First: APIs (Nominatim, Photon, Overpass, OSRM, ExchangeRate)
//   - Cache First  : shell statique (index.html, JS, CSS, données)
//
// ACTIVATION   : auto-update silencieux à chaque ouverture
// PÉREMPTION   : tuiles conservées 7 jours, shell indéfini
// ══════════════════════════════════════════════════════════════════════

var CACHE_SHELL   = 'yume-shell-v151';
var CACHE_TILES   = 'yume-tiles-v1';
var CACHE_API     = 'yume-api-v1';

// Fichiers du shell applicatif — mis en cache à l'installation
var SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-32.png',
  './css/style.css',
  './js/state.js',
  './js/map-world.js',
  './js/map-trip.js',
  './js/rail-router.js',
  './js/timeline.js',
  './js/smart-alerts.js',
  './js/vendor/pdf-lib.min.js',
  './js/vendor/leaflet.markercluster.js',
  './css/vendor/MarkerCluster.css',
  './js/app.js',
  './data/geo-defaults.js',
  './data/airports-gps.js',
  './data/transport-refs.js',
  './data/finance-data.js',
  'https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;600&family=DM+Sans:wght@300;400;500&display=swap',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
];

// Domaines des tuiles cartographiques
var TILE_HOSTS = [
  'basemaps.cartocdn.com',
];

// Domaines des APIs — network first, cache fallback
var API_HOSTS = [
  'nominatim.openstreetmap.org',
  'photon.komoot.io',
  'overpass-api.de',
  'overpass.kumi.systems',
  'router.project-osrm.org',
  'api.exchangerate-api.com',
];


// ── INSTALL ───────────────────────────────────────────────────────────
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_SHELL).then(function(cache) {
      // Pré-cacher le shell (erreurs silencieuses sur les ressources optionnelles)
      return Promise.allSettled(
        SHELL_FILES.map(function(url) {
          return cache.add(url).catch(function(e) {
            console.warn('[SW] Impossible de pré-cacher:', url, e.message);
          });
        })
      );
    }).then(function() {
      return self.skipWaiting(); // activer immédiatement sans attendre fermeture des onglets
    })
  );
});


// ── ACTIVATE ──────────────────────────────────────────────────────────
self.addEventListener('activate', function(event) {
  var validCaches = [CACHE_SHELL, CACHE_TILES, CACHE_API];
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return validCaches.indexOf(k) === -1; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim(); // prendre le contrôle immédiatement
    })
  );
});


// ── FETCH ─────────────────────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
  var url;
  try { url = new URL(event.request.url); } catch(e) { return; }

  // Ne pas intercepter les requêtes non-GET
  if (event.request.method !== 'GET') return;

  var host = url.hostname;

  // ── Stratégie 1 : Tuiles cartographiques → Cache First (7 jours) ──
  if (TILE_HOSTS.some(function(h) { return host.indexOf(h) !== -1; })) {
    event.respondWith(tileStrategy(event.request));
    return;
  }

  // ── Stratégie 2 : APIs → Network First avec cache fallback ──────
  if (API_HOSTS.some(function(h) { return host.indexOf(h) !== -1; })) {
    event.respondWith(networkFirstStrategy(event.request));
    return;
  }

  // ── Stratégie 3 : Shell → Cache First ───────────────────────────
  event.respondWith(shellStrategy(event.request));
});


// ── STRATÉGIES ────────────────────────────────────────────────────────

function tileStrategy(request) {
  return caches.open(CACHE_TILES).then(function(cache) {
    return cache.match(request).then(function(cached) {
      if (cached) {
        // Vérifier l'âge (7 jours)
        var dateHeader = cached.headers.get('sw-cached-at');
        if (dateHeader) {
          var age = Date.now() - parseInt(dateHeader, 10);
          if (age < 7 * 24 * 60 * 60 * 1000) return cached;
        } else {
          return cached; // pas de date = conserver
        }
      }
      // Réseau
      return fetch(request).then(function(response) {
        if (response.ok) {
          // Cloner la réponse et ajouter timestamp
          var headers = new Headers(response.headers);
          headers.set('sw-cached-at', String(Date.now()));
          return response.blob().then(function(blob) {
            var stamped = new Response(blob, {
              status: response.status,
              statusText: response.statusText,
              headers: headers
            });
            cache.put(request, stamped.clone());
            return stamped;
          });
        }
        return response;
      }).catch(function() {
        // Hors-ligne → retourner le cache même périmé
        return cached || new Response('', { status: 503 });
      });
    });
  });
}

function networkFirstStrategy(request) {
  return caches.open(CACHE_API).then(function(cache) {
    return fetch(request).then(function(response) {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    }).catch(function() {
      // Hors-ligne → cache
      return cache.match(request).then(function(cached) {
        return cached || new Response(
          JSON.stringify({ error: 'offline', message: 'Hors-ligne — données non disponibles' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      });
    });
  });
}

function shellStrategy(request) {
  return caches.open(CACHE_SHELL).then(function(cache) {
    return cache.match(request).then(function(cached) {
      if (cached) return cached;
      return fetch(request).then(function(response) {
        if (response.ok) cache.put(request, response.clone());
        return response;
      }).catch(function() {
        // Hors-ligne → retourner index.html (SPA fallback)
        return cache.match('./index.html') || cache.match('./');
      });
    });
  });
}


// ── MESSAGE : forcer mise à jour depuis l'app ─────────────────────────
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_TILES') {
    caches.delete(CACHE_TILES).then(function() {
      event.ports[0].postMessage({ done: true });
    });
  }
});
