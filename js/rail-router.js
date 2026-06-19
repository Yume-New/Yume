// ══════════════════════════════════════════════════════════════════════
// rail-router.js — Routage ferroviaire réel via Overpass (OSM) + A*
// Yume Travel Manager · Phase C
//
// STRATÉGIE : Corridor étroit + Graphe + A* (Phase C)
//   1. Requête Overpass dans un POLYGONE étroit (~±13 km) le long de
//      l'axe dep→arr — 10 à 50× moins de données qu'un bbox (fini les
//      timeouts de la Phase B).
//   2. `out body; >; out skel qt;` → topologie réelle (IDs de nœuds),
//      indispensable pour la connectivité du graphe.
//   3. Construction du graphe nœud→nœud, snap des gares sur les nœuds
//      les plus proches, calcul du chemin par A* (heuristique haversine).
//   4. AUCUN dessin ici : le chemin est renvoyé via options.onRoute(pts).
//      map-trip.js est l'unique propriétaire du rendu Leaflet (filtres,
//      nettoyage inter-voyages, tooltips).
//
// RETRY : si le corridor étroit échoue (réseau OSM incomplet, détour
//   important), une 2e tentative est faite avec un corridor élargi.
//
// DÉPENDANCES : aucune dépendance Leaflet — module de données pur.
// EXPOSE      : window.RailRouter.fetchRoute(mobilite, options)
//               window.RailRouter.config
//
// COMPAT      : fetchAndDraw/clearAll de la Phase B sont supprimés.
//               map-trip.js (Phase C) est le seul appelant.
// ══════════════════════════════════════════════════════════════════════

(function () {
'use strict';

// ── §1 CONFIGURATION ──────────────────────────────────────────────────
var CFG = {
  // Distance max dep→arr au-delà de laquelle on ne tente pas (km).
  // Le corridor étroit rend les longues distances viables.
  MAX_DIST_KM:      1500,
  // Demi-largeur du corridor (degrés ≈ 111 km/°) — 1re tentative
  CORRIDOR_HALF:    0.12,
  // Demi-largeur élargie — 2e tentative (retry)
  CORRIDOR_HALF_2:  0.28,
  // Échantillonnage de l'axe du corridor (km entre points)
  CORRIDOR_STEP_KM: 25,
  // Timeout Overpass (secondes)
  OVERPASS_TIMEOUT: 30,
  // Endpoints Overpass — miroir de secours
  OVERPASS_URLS: [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ],
  // Distance max gare→nœud du graphe pour le snap (km)
  SNAP_MAX_KM:      25,
  // Douglas-Peucker : tolérance fine (le chemin est précis, on ne
  // simplifie que pour alléger le polyline)
  DP_EPSILON:       0.0008,
  // Cache localStorage : nombre max d'itinéraires conservés
  CACHE_MAX:        40
};

var CACHE_PREFIX = 'yrail2:';
var CACHE_INDEX  = 'yrail2:index';


// ── §2 GÉODÉSIE UTILITAIRE ────────────────────────────────────────────

function _haversineKm(la1, lo1, la2, lo2) {
  var R   = 6371;
  var dLa = (la2 - la1) * Math.PI / 180;
  var dLo = (lo2 - lo1) * Math.PI / 180;
  var a   = Math.sin(dLa / 2) * Math.sin(dLa / 2)
    + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180)
    * Math.sin(dLo / 2) * Math.sin(dLo / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}


// ── §3 CACHE — mémoire + localStorage (persistant) ───────────────────
var _memCache = {};

function _cacheKey(la1, lo1, la2, lo2) {
  return [la1, lo1, la2, lo2].map(function (v) {
    return Math.round(v * 1000) / 1000;
  }).join(',');
}

function _cacheGet(key) {
  if (_memCache[key]) return _memCache[key];
  try {
    var raw = localStorage.getItem(CACHE_PREFIX + key);
    if (raw) { _memCache[key] = JSON.parse(raw); return _memCache[key]; }
  } catch (e) {}
  return null;
}

function _cachePut(key, pts) {
  _memCache[key] = pts;
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(pts));
    // Index LRU : prune au-delà de CACHE_MAX entrées
    var idx = [];
    try { idx = JSON.parse(localStorage.getItem(CACHE_INDEX) || '[]'); } catch (e2) {}
    idx = idx.filter(function (k) { return k !== key; });
    idx.push(key);
    while (idx.length > CFG.CACHE_MAX) {
      var old = idx.shift();
      try { localStorage.removeItem(CACHE_PREFIX + old); } catch (e3) {}
    }
    localStorage.setItem(CACHE_INDEX, JSON.stringify(idx));
  } catch (e) {
    // Quota plein → on purge tout le cache rail et on réessaie une fois
    try {
      var i, keys = [];
      for (i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(CACHE_PREFIX) === 0) keys.push(k);
      }
      keys.forEach(function (k) { localStorage.removeItem(k); });
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(pts));
    } catch (e4) {}
  }
}


// ── §4 CORRIDOR POLYGONAL ─────────────────────────────────────────────
// Construit un polygone fermé suivant l'axe dep→arr, de demi-largeur
// `half` degrés. Format Overpass : "lat lon lat lon ..." (espace-séparé).
// ─────────────────────────────────────────────────────────────────────
function _buildCorridorPoly(la1, lo1, la2, lo2, half) {
  var distKm = _haversineKm(la1, lo1, la2, lo2);
  var steps  = Math.max(2, Math.ceil(distKm / CFG.CORRIDOR_STEP_KM));

  // Vecteur directeur en "degrés-plan" (lng corrigé par cos(latMoy))
  var latMid = (la1 + la2) / 2;
  var cosLat = Math.max(0.2, Math.cos(latMid * Math.PI / 180));
  var dLat   = la2 - la1;
  var dLng   = (lo2 - lo1) * cosLat;
  var len    = Math.sqrt(dLat * dLat + dLng * dLng) || 1e-9;

  // Normale unitaire (perpendiculaire à l'axe)
  var nLat = -dLng / len;
  var nLng =  dLat / len / cosLat;   // re-déprojeter la composante lng
  var uLat =  dLat / len;            // unitaire le long de l'axe (lat)
  var uLng = (lo2 - lo1) / len;      // approx. le long de l'axe (lng brut)

  // Étendre légèrement l'axe aux deux extrémités (gares en bordure)
  var ext = half * 0.8;

  var sideA = [], sideB = [];
  for (var i = 0; i <= steps; i++) {
    var t   = i / steps;
    var cla = la1 + (la2 - la1) * t;
    var clo = lo1 + (lo2 - lo1) * t;
    if (i === 0)     { cla -= uLat * ext; clo -= uLng * ext; }
    if (i === steps) { cla += uLat * ext; clo += uLng * ext; }
    sideA.push([cla + nLat * half, clo + nLng * half]);
    sideB.push([cla - nLat * half, clo - nLng * half]);
  }
  sideB.reverse();

  var ring = sideA.concat(sideB);
  ring.push(ring[0]); // fermer le polygone

  return ring.map(function (p) {
    return p[0].toFixed(4) + ' ' + p[1].toFixed(4);
  }).join(' ');
}


// ── §5 REQUÊTE OVERPASS ───────────────────────────────────────────────
// `out body; >; out skel qt;` : ways avec refs de nœuds + nœuds avec
// coordonnées → permet de reconstruire la TOPOLOGIE (connectivité).
// ─────────────────────────────────────────────────────────────────────
function _buildQuery(poly) {
  var railFilter = '"railway"~"^(rail|light_rail|narrow_gauge)$"';
  var noService  = '["service"!~"siding|yard|spur|crossover"]';
  return '[out:json][timeout:' + CFG.OVERPASS_TIMEOUT + '];'
    + 'way[' + railFilter + ']' + noService
    + '(poly:"' + poly + '");'
    + 'out body;>;out skel qt;';
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
    .then(function (data) { cb(data); })
    .catch(function () { tryNext(); });
  }

  tryNext();
}


// ── §6 GRAPHE FERROVIAIRE ─────────────────────────────────────────────
// nodes : { id → [lat, lng] }
// adj   : { id → [{ to: id, w: km }] }
// ─────────────────────────────────────────────────────────────────────
function _buildGraph(data) {
  if (!data || !data.elements) return null;

  var nodes = Object.create(null);
  var ways  = [];

  data.elements.forEach(function (el) {
    if (el.type === 'node') {
      nodes[el.id] = [el.lat, el.lon];
    } else if (el.type === 'way' && el.nodes && el.nodes.length >= 2) {
      ways.push(el.nodes);
    }
  });

  if (!ways.length) return null;

  var adj = Object.create(null);

  // IMPORTANT : IDs normalisés en STRING. Les clés d'objet JS sont des
  // strings (for…in), alors que les refs Overpass sont numériques —
  // sans normalisation, la comparaison stricte de l'A* échouerait.
  function _addEdge(a, b, w) {
    a = String(a); b = String(b);
    (adj[a] = adj[a] || []).push({ to: b, w: w });
    (adj[b] = adj[b] || []).push({ to: a, w: w });
  }

  ways.forEach(function (refs) {
    for (var i = 1; i < refs.length; i++) {
      var a = refs[i - 1], b = refs[i];
      var pa = nodes[a], pb = nodes[b];
      if (!pa || !pb) continue;
      _addEdge(a, b, _haversineKm(pa[0], pa[1], pb[0], pb[1]));
    }
  });

  return { nodes: nodes, adj: adj };
}

// Nœud du graphe le plus proche d'un point (scan linéaire — suffisant)
function _nearestNode(graph, lat, lng) {
  var bestId = null, bestD = Infinity;
  for (var id in graph.adj) {            // uniquement les nœuds connectés
    var p = graph.nodes[id];
    if (!p) continue;
    var d = _haversineKm(lat, lng, p[0], p[1]);
    if (d < bestD) { bestD = d; bestId = id; }
  }
  return { id: bestId, distKm: bestD };
}


// ── §7 A* — file de priorité (tas binaire min) ───────────────────────
function _Heap() {
  this.a = [];
}
_Heap.prototype.push = function (item) {
  var a = this.a;
  a.push(item);
  var i = a.length - 1;
  while (i > 0) {
    var p = (i - 1) >> 1;
    if (a[p].f <= a[i].f) break;
    var tmp = a[p]; a[p] = a[i]; a[i] = tmp;
    i = p;
  }
};
_Heap.prototype.pop = function () {
  var a = this.a;
  if (!a.length) return null;
  var top = a[0];
  var last = a.pop();
  if (a.length) {
    a[0] = last;
    var i = 0, n = a.length;
    for (;;) {
      var l = 2 * i + 1, r = l + 1, m = i;
      if (l < n && a[l].f < a[m].f) m = l;
      if (r < n && a[r].f < a[m].f) m = r;
      if (m === i) break;
      var tmp = a[m]; a[m] = a[i]; a[i] = tmp;
      i = m;
    }
  }
  return top;
};

function _astar(graph, startId, goalId) {
  var nodes = graph.nodes, adj = graph.adj;
  var goal  = nodes[goalId];
  if (!goal || !nodes[startId]) return null;

  var gScore   = Object.create(null);
  var cameFrom = Object.create(null);
  var closed   = Object.create(null);

  gScore[startId] = 0;
  var open = new _Heap();
  var s = nodes[startId];
  open.push({ id: startId, f: _haversineKm(s[0], s[1], goal[0], goal[1]) });

  while (true) {
    var cur = open.pop();
    if (!cur) return null;               // file vide → pas de chemin
    var cid = cur.id;
    if (cid === goalId) break;           // chemin trouvé
    if (closed[cid]) continue;           // entrée périmée du tas
    closed[cid] = true;

    var edges = adj[cid] || [];
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      if (closed[e.to]) continue;
      var tentative = gScore[cid] + e.w;
      if (gScore[e.to] === undefined || tentative < gScore[e.to]) {
        gScore[e.to]   = tentative;
        cameFrom[e.to] = cid;
        var p = nodes[e.to];
        open.push({ id: e.to, f: tentative + _haversineKm(p[0], p[1], goal[0], goal[1]) });
      }
    }
  }

  // Reconstruction du chemin
  var path = [goalId];
  var c = goalId;
  while (cameFrom[c] !== undefined) {
    c = cameFrom[c];
    path.push(c);
  }
  path.reverse();
  return path.map(function (id) { return nodes[id]; });
}


// ── §8 DOUGLAS-PEUCKER (simplification du chemin final) ──────────────
function _dpSimplify(pts, eps) {
  if (pts.length <= 2) return pts;

  function _perpDist(p, a, b) {
    var dx = b[1] - a[1], dy = b[0] - a[0];
    var lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.sqrt(Math.pow(p[0]-a[0],2) + Math.pow(p[1]-a[1],2));
    var t = ((p[1]-a[1])*dx + (p[0]-a[0])*dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.sqrt(Math.pow(p[0]-(a[0]+t*dy),2) + Math.pow(p[1]-(a[1]+t*dx),2));
  }

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


// ── §9 API PUBLIQUE ───────────────────────────────────────────────────

/**
 * fetchRoute(mobilite, options)
 * Calcule l'itinéraire ferroviaire réel dep→arr. Module de données pur :
 * aucun dessin — le rendu appartient à map-trip.js.
 *
 * @param {Object}   mobilite    Doit avoir type:'train' + depLat/depLng/arrLat/arrLng
 * @param {Object}   [options]
 * @param {Function} [options.onRoute(pts)]      pts = [[lat,lng], …] du trajet réel
 * @param {Function} [options.onFallback(reason)] échec → l'appelant garde son fallback
 * @param {Function} [options.onStart]           début de la requête réseau
 */
function fetchRoute(mobilite, options) {
  options = options || {};
  var fail = function (reason) {
    if (typeof console !== 'undefined') {
      console.debug('[RailRouter]', (mobilite && mobilite.dep) || '?', '→',
        (mobilite && mobilite.arr) || '?', ':', reason);
    }
    if (options.onFallback) options.onFallback(reason);
  };

  // ── Guards ────────────────────────────────────────────────────────
  if (!mobilite || mobilite.type !== 'train') { fail('not-train'); return; }

  var la1 = parseFloat(mobilite.depLat), lo1 = parseFloat(mobilite.depLng);
  var la2 = parseFloat(mobilite.arrLat), lo2 = parseFloat(mobilite.arrLng);

  if (isNaN(la1) || isNaN(lo1) || isNaN(la2) || isNaN(lo2)) {
    fail('no-coords'); return;
  }

  var distKm = _haversineKm(la1, lo1, la2, lo2);
  if (distKm > CFG.MAX_DIST_KM) { fail('distance-exceeded'); return; }
  if (distKm < 0.5)             { fail('too-short');         return; }

  // ── Cache hit ─────────────────────────────────────────────────────
  var key    = _cacheKey(la1, lo1, la2, lo2);
  var cached = _cacheGet(key);
  if (cached && cached.length >= 2) {
    if (options.onRoute) options.onRoute(cached);
    return;
  }

  if (options.onStart) options.onStart();

  // ── Tentative 1 (corridor étroit) puis 2 (corridor élargi) ───────
  _attempt(CFG.CORRIDOR_HALF, function (pts1, reason1) {
    if (pts1) { _deliver(pts1); return; }
    // Erreur réseau pure → inutile de réessayer plus large
    if (reason1 === 'overpass-error') { fail(reason1); return; }
    _attempt(CFG.CORRIDOR_HALF_2, function (pts2, reason2) {
      if (pts2) { _deliver(pts2); return; }
      fail(reason2);
    });
  });

  function _attempt(half, done) {
    var poly  = _buildCorridorPoly(la1, lo1, la2, lo2, half);
    var query = _buildQuery(poly);

    _fetchOverpass(query, function (data) {
      if (!data)            { done(null, 'overpass-error'); return; }

      var graph = _buildGraph(data);
      if (!graph)           { done(null, 'no-data'); return; }

      var nDep = _nearestNode(graph, la1, lo1);
      var nArr = _nearestNode(graph, la2, lo2);
      if (!nDep.id || !nArr.id)        { done(null, 'no-data');      return; }
      if (nDep.distKm > CFG.SNAP_MAX_KM
       || nArr.distKm > CFG.SNAP_MAX_KM) { done(null, 'snap-too-far'); return; }

      var path = _astar(graph, nDep.id, nArr.id);
      if (!path || path.length < 2)    { done(null, 'no-path'); return; }

      done(_dpSimplify(path, CFG.DP_EPSILON), null);
    });
  }

  function _deliver(pts) {
    _cachePut(key, pts);
    if (options.onRoute) options.onRoute(pts);
  }
}


// ── Exposer l'API publique ────────────────────────────────────────────
window.RailRouter = {
  fetchRoute: fetchRoute,
  config:     CFG   // permet d'ajuster les seuils sans toucher au code
};

})(); // fin IIFE rail-router
