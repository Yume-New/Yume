// ══════════════════════════════════════════════════════════════════════
// rail-router.js — Routing ferroviaire réel via API Overpass (OSM)
// Yume Travel Manager · Phase B
//
// STRATÉGIE : Corridor Network (Phase B)
//   On query Overpass pour tous les rails dans le bbox dep→arr,
//   on simplifie avec Douglas-Peucker, on dessine le réseau réel.
//   Résultat : les vraies voies ferrées apparaissent au lieu d'une
//   ligne droite pointillée.
//
// LIMITES CONNUES
//   - Affiche TOUT le réseau dans le corridor (voies parallèles incluses)
//   - Pas de routing exact (chemin précis = Phase C via graph traversal)
//   - Désactivé si distance > MAX_DIST_KM (trop de données Overpass)
//
// DÉPENDANCES : state.js, map-trip.js (L doit être chargé, _map exposé)
// EXPOSE      : window.RailRouter.fetchAndDraw(mobilite, mapInstance)
//               window.RailRouter.clearAll(mapInstance)
// ══════════════════════════════════════════════════════════════════════

(function () {
'use strict';

// ── §1 CONFIGURATION ──────────────────────────────────────────────────
var CFG = {
  // Distance max au-delà de laquelle on ne query pas Overpass (km)
  MAX_DIST_KM:    800,
  // Buffer autour du bbox (degrés) — adapté selon la distance
  BUFFER_SHORT:   0.4,   // < 150 km
  BUFFER_MEDIUM:  0.6,   // 150–600 km
  BUFFER_LONG:    0.9,   // 600–800 km
  // Douglas-Peucker : tolérance de simplification (degrés)
  DP_EPSILON:     0.004,
  // Timeout Overpass (secondes)
  OVERPASS_TIMEOUT: 25,
  // Endpoint Overpass — miroir de secours disponible
  OVERPASS_URLS: [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ],
  // Styles de tracé
  STYLE_NETWORK: {
    color:   '#8899aa',
    weight:  1.2,
    opacity: 0.45,
    // Pas de dashArray — les vraies voies sont des lignes continues
  },
  STYLE_ROUTE: {
    color:   '#2d5e8c',
    weight:  3.0,
    opacity: 0.80,
  },
};

// ── §2 CACHE ───────────────────────────────────────────────────────────
// Clé : "lat1,lng1,lat2,lng2" arrondi à 2 décimales
// Valeur : tableau de segments [[lat,lng], ...][]
var _memCache = {};

function _cacheKey(la1, lo1, la2, lo2) {
  return [la1, lo1, la2, lo2].map(function (v) {
    return Math.round(v * 100) / 100;
  }).join(',');
}

function _cachePut(key, segments) {
  _memCache[key] = segments;
  try {
    sessionStorage.setItem('yrail:' + key, JSON.stringify(segments));
  } catch (e) {}
}

function _cacheGet(key) {
  if (_memCache[key]) return _memCache[key];
  try {
    var raw = sessionStorage.getItem('yrail:' + key);
    if (raw) { _memCache[key] = JSON.parse(raw); return _memCache[key]; }
  } catch (e) {}
  return null;
}


// ── §3 GÉODÉSIE UTILITAIRE ────────────────────────────────────────────

// Distance Haversine en km entre deux points GPS
function _haversineKm(la1, lo1, la2, lo2) {
  var R  = 6371;
  var dLa = (la2 - la1) * Math.PI / 180;
  var dLo = (lo2 - lo1) * Math.PI / 180;
  var a   = Math.sin(dLa / 2) * Math.sin(dLa / 2)
    + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180)
    * Math.sin(dLo / 2) * Math.sin(dLo / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Calcule le bbox avec buffer adaptatif
function _buildBbox(la1, lo1, la2, lo2) {
  var distKm = _haversineKm(la1, lo1, la2, lo2);
  var buf = distKm < 150  ? CFG.BUFFER_SHORT
          : distKm < 600  ? CFG.BUFFER_MEDIUM
          :                 CFG.BUFFER_LONG;

  var south = Math.min(la1, la2) - buf;
  var north = Math.max(la1, la2) + buf;
  var west  = Math.min(lo1, lo2) - buf;
  var east  = Math.max(lo1, lo2) + buf;

  // Clamp valeurs géographiques
  south = Math.max(south, -85);
  north = Math.min(north,  85);
  west  = Math.max(west, -180);
  east  = Math.min(east,  180);

  return { south: south, north: north, west: west, east: east, distKm: distKm };
}


// ── §4 DOUGLAS-PEUCKER ────────────────────────────────────────────────
// Simplifie un tableau de points [lat, lng] avec une tolérance epsilon.
// Réduit drastiquement le nombre de segments affichés sans perte visuelle.
// ─────────────────────────────────────────────────────────────────────
function _dpSimplify(pts, eps) {
  if (pts.length <= 2) return pts;

  // Distance point P→segment AB (en coordonnées planes approx.)
  function _perpDist(p, a, b) {
    var dx = b[1] - a[1], dy = b[0] - a[0];
    var lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.sqrt(Math.pow(p[0]-a[0],2) + Math.pow(p[1]-a[1],2));
    var t = ((p[1]-a[1])*dx + (p[0]-a[0])*dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.sqrt(Math.pow(p[0]-(a[0]+t*dy),2) + Math.pow(p[1]-(a[1]+t*dx),2));
  }

  // Trouver le point le plus éloigné de la ligne start→end
  var maxDist = 0, maxIdx = 0;
  var first = pts[0], last = pts[pts.length - 1];
  for (var i = 1; i < pts.length - 1; i++) {
    var d = _perpDist(pts[i], first, last);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }

  if (maxDist > eps) {
    var left  = _dpSimplify(pts.slice(0, maxIdx + 1), eps);
    var right = _dpSimplify(pts.slice(maxIdx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}


// ── §5 REQUÊTE OVERPASS ───────────────────────────────────────────────
// Requête optimisée : `out geom qt` = géométrie + tri spatial rapide.
// On filtre les voies ferrées principales (pas les voies de garage).
// ─────────────────────────────────────────────────────────────────────
function _buildQuery(bbox) {
  // Tags ferroviaires pertinents — on exclut les voies de service
  // ("siding", "yard", "spur") qui pollueraient le visuel
  var railFilter = '"railway"~"^(rail|light_rail|narrow_gauge|subway)$"';
  var noService  = '["service"!~"siding|yard|spur|crossover"]';

  return '[out:json][timeout:' + CFG.OVERPASS_TIMEOUT + '];'
    + 'way[' + railFilter + ']' + noService + '('
    + bbox.south.toFixed(4) + ','
    + bbox.west.toFixed(4)  + ','
    + bbox.north.toFixed(4) + ','
    + bbox.east.toFixed(4)
    + ');out geom qt;';
}

function _fetchOverpass(query, cb) {
  var urls = CFG.OVERPASS_URLS.slice();

  function tryNext() {
    if (!urls.length) { cb(null); return; }
    var url = urls.shift();

    fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    'data=' + encodeURIComponent(query)
    })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      cb(data);
    })
    .catch(function () {
      tryNext();
    });
  }

  tryNext();
}


// ── §6 PARSEUR OVERPASS → SEGMENTS ───────────────────────────────────
// Convertit la réponse Overpass en tableau de polylines simplifiées.
// Chaque way devient un tableau de [lat, lng] simplifié par DP.
// ─────────────────────────────────────────────────────────────────────
function _parseWays(data) {
  if (!data || !data.elements) return [];
  var segments = [];

  data.elements.forEach(function (el) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) return;

    // Convertir geometry en [lat, lng][]
    var pts = el.geometry.map(function (g) { return [g.lat, g.lon]; });

    // Simplifier
    var simplified = _dpSimplify(pts, CFG.DP_EPSILON);
    if (simplified.length >= 2) segments.push(simplified);
  });

  return segments;
}


// ── §7 DESSIN SUR LA CARTE ────────────────────────────────────────────
// On garde une référence aux layers pour pouvoir les supprimer.
var _drawnLayers = []; // { mobiliteId, layers: L.polyline[] }

function _drawSegments(segments, mobiliteId, mapInstance) {
  if (!mapInstance || !segments.length) return;
  var layers = [];

  segments.forEach(function (seg) {
    // Découper à l'antiméridien (même logique que map-trip.js)
    var subsegments = _splitAntimeridianLocal(seg);
    subsegments.forEach(function (sub) {
      if (sub.length < 2) return;
      var poly = L.polyline(sub, CFG.STYLE_NETWORK);
      poly.addTo(mapInstance);
      layers.push(poly);
    });
  });

  _drawnLayers.push({ mobiliteId: mobiliteId, layers: layers });
}

// Split antimeridian local (dupliqué depuis map-trip.js pour autonomie)
function _splitAntimeridianLocal(pts) {
  if (!pts.length) return [pts];
  var segs = [[pts[0]]];
  for (var i = 1; i < pts.length; i++) {
    if (Math.abs(pts[i][1] - pts[i-1][1]) > 180) segs.push([]);
    segs[segs.length - 1].push(pts[i]);
  }
  return segs;
}

function _clearMobiliteRail(mobiliteId, mapInstance) {
  _drawnLayers = _drawnLayers.filter(function (entry) {
    if (entry.mobiliteId !== mobiliteId) return true;
    entry.layers.forEach(function (l) {
      if (mapInstance) { try { mapInstance.removeLayer(l); } catch(e) {} }
    });
    return false;
  });
}

function clearAll(mapInstance) {
  _drawnLayers.forEach(function (entry) {
    entry.layers.forEach(function (l) {
      if (mapInstance) { try { mapInstance.removeLayer(l); } catch(e) {} }
    });
  });
  _drawnLayers = [];
}


// ── §8 API PUBLIQUE ───────────────────────────────────────────────────

/**
 * fetchAndDraw(mobilite, mapInstance, options)
 * Récupère la géométrie ferroviaire pour un trajet train et la trace.
 *
 * @param {Object}   mobilite    Objet mobilite Yume (doit avoir depLat/depLng/arrLat/arrLng)
 * @param {Object}   mapInstance Instance Leaflet active
 * @param {Object}   [options]
 * @param {Function} [options.onStart]    Appelé au début de la requête
 * @param {Function} [options.onDone]     Appelé quand le tracé est terminé
 * @param {Function} [options.onFallback] Appelé si Overpass échoue (géocodage à la volée)
 */
function fetchAndDraw(mobilite, mapInstance, options) {
  options = options || {};

  // ── Guards ────────────────────────────────────────────────────────
  if (!mobilite || mobilite.type !== 'train') return;
  if (!mapInstance) return;

  var la1 = mobilite.depLat, lo1 = mobilite.depLng;
  var la2 = mobilite.arrLat, lo2 = mobilite.arrLng;

  if (!la1 || !lo1 || !la2 || !lo2) {
    // Pas de coordonnées → on ne peut pas faire de bbox
    if (options.onFallback) options.onFallback('no-coords');
    return;
  }

  var bbox = _buildBbox(la1, lo1, la2, lo2);

  // ── Distance trop grande → pas de requête ─────────────────────────
  if (bbox.distKm > CFG.MAX_DIST_KM) {
    if (options.onFallback) options.onFallback('distance-exceeded');
    return;
  }

  var cacheKey = _cacheKey(la1, lo1, la2, lo2);

  // ── Cache hit ─────────────────────────────────────────────────────
  var cached = _cacheGet(cacheKey);
  if (cached) {
    // Supprimer l'ancien tracé pour ce mobilite si existant
    _clearMobiliteRail(mobilite.id, mapInstance);
    _drawSegments(cached, mobilite.id, mapInstance);
    if (options.onDone) options.onDone({ fromCache: true, segments: cached.length });
    return;
  }

  // ── Requête Overpass ──────────────────────────────────────────────
  if (options.onStart) options.onStart();

  var query = _buildQuery(bbox);
  _fetchOverpass(query, function (data) {
    if (!data) {
      if (options.onFallback) options.onFallback('overpass-error');
      return;
    }

    var segments = _parseWays(data);
    if (!segments.length) {
      if (options.onFallback) options.onFallback('no-data');
      return;
    }

    _cachePut(cacheKey, segments);
    _clearMobiliteRail(mobilite.id, mapInstance);
    _drawSegments(segments, mobilite.id, mapInstance);

    if (options.onDone) options.onDone({ fromCache: false, segments: segments.length });
  });
}


// ── §9 INTÉGRATION AUTOMATIQUE ────────────────────────────────────────
// Quand map-trip.js charge les routes, on enrichit les trains avec les
// vraies voies. On s'abonne à 'trip:snapshot' et 'trip:restore'.
// ─────────────────────────────────────────────────────────────────────
function _enrichTrainsOnMap() {
  // Attendre que la carte voyage soit initialisée
  if (typeof window.initTripMap !== 'function') return;

  // Récupérer l'instance Leaflet de la carte voyage
  // (exposée via window._tripmapInstance définie ci-dessous)
  var mapInstance = window._tripmapInstance;
  if (!mapInstance) return;

  var mobs = (typeof mobilites !== 'undefined') ? mobilites : [];
  mobs.forEach(function (m) {
    if (m.type !== 'train') return;
    if (!m.depLat || !m.arrLat) return;

    fetchAndDraw(m, mapInstance, {
      onFallback: function (reason) {
        // Fallback silencieux — map-trip.js a déjà tracé la ligne droite
        if (typeof console !== 'undefined') {
          console.debug('[RailRouter] Fallback pour', m.dep, '→', m.arr, ':', reason);
        }
      }
    });
  });
}

// Abonnements — on enrichit après chaque restauration/snapshot si la
// carte voyage est active
YumeState.on('trip:restore', function () {
  setTimeout(_enrichTrainsOnMap, 500); // petit délai pour laisser la carte s'initialiser
});

YumeState.on('trip:snapshot', function () {
  var futur = document.getElementById('page-futur');
  if (futur && futur.classList.contains('active')) {
    setTimeout(_enrichTrainsOnMap, 200);
  }
});


// ── Exposer l'API publique ────────────────────────────────────────────
window.RailRouter = {
  fetchAndDraw: fetchAndDraw,
  clearAll:     clearAll,
  config:       CFG,   // permet de modifier les seuils sans toucher au code
};

})(); // fin IIFE rail-router
