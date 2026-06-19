// ══════════════════════════════════════════════════════════════════════
// map-trip.js — Carte voyage (marqueurs hôtels/lieux + routes transport)
// Yume Travel Manager · Phase A · Modularisation
//
// RESPONSABILITÉS
//   - Géocodage Nominatim (file d'attente 1 req/s, cache sessionStorage)
//   - Arcs géodésiques (great circle) pour les vols
//   - Lignes pointillées pour trains/bus/bateaux
//   - Marqueurs hôtels et lieux avec popups
//   - Géolocalisation GPS (point bleu)
//   - Filtres (hôtels / lieux / itinéraire)
//
// CORRECTIONS PHASE A intégrées
//   Fix 1 — Antimeridian : routes transpacifiques correctement découpées
//   Fix 2 — Lieux : coordonnées pré-existantes (l.lat/l.lng) respectées
//
// DÉPENDANCES  : state.js (YumeState, allTrips, currentTripId, mobilites,
//                hotels, lieux), map-world.js (Leaflet déjà chargé)
// EXPOSE       : window.initTripMap, window.tripmapFilter,
//                window.tripmapRecenter, window.tripmapFocusPin,
//                window.tripmapGeolocate, window.goToMapPin
//
// ABONNEMENTS  : YumeState.on('trip:snapshot') → refresh si onglet visible
// ══════════════════════════════════════════════════════════════════════

(function () {
'use strict';

// ── §1 ÉTAT PRIVÉ ─────────────────────────────────────────────────────
var _map          = null;   // instance L.map (propre à la carte voyage)
var _initDone     = false;
var _markers      = [];     // [{ marker, type, id, lat, lng }]
var _pins         = [];     // données enrichies pour la liste sous la carte
var _routes       = [];     // [{ layer: L.polyline[], type, label }]
var _userMark     = null;   // point GPS bleu
var _userCirc     = null;   // cercle de précision GPS

// Filtres multi-select : {} = tout voir ; { hotels:true } = hôtels seulement
var _activeFilters = {};

// Couleurs par type de transport
var _COLORS = {
  vol:         '#e8748a',
  train:       '#2d5e8c',
  bus:         '#2d8c6b',
  bateau:      '#2d8c8c',
  covoiturage: '#c9921a',
  metro:       '#7c5cbf',
  taxi:        '#c9921a'
};

// Détection iOS pour les liens Maps
var _isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;


// ── §2 GÉOCODAGE — Cascade Photon → Nominatim (Phase C) ─────────────
// Architecture :
//   1. Cache mémoire (instantané, durée de la session)
//   2. Cache localStorage (persistant entre rechargements)
//   3. Photon/Komoot (primaire — rapide, meilleure précision Asie)
//   4. Nominatim/OSM (fallback — rate limit 1 req/s respecté)
// ─────────────────────────────────────────────────────────────────────
var _geoCache   = {};   // cache mémoire { key: {lat,lng}|null }
var _geoQueue   = [];   // file d'attente Nominatim
var _geocoding  = false;
var _lastGeoReq = 0;

// ── Cache persistant localStorage ────────────────────────────────────
var _LS_PREFIX = 'ygeo_v2:';  // v2 = Photon era

function _cacheGet(key) {
  if (_geoCache[key] !== undefined) return _geoCache[key];
  try {
    // localStorage d'abord (persistant)
    var lv = localStorage.getItem(_LS_PREFIX + key);
    if (lv !== null) { _geoCache[key] = JSON.parse(lv); return _geoCache[key]; }
    // sessionStorage en fallback (ancienne version)
    var sv = sessionStorage.getItem('ygeo:' + key);
    if (sv !== null) { _geoCache[key] = JSON.parse(sv); return _geoCache[key]; }
  } catch (e) {}
  return undefined; // pas en cache
}

function _cacheSet(key, val) {
  _geoCache[key] = val;
  try { localStorage.setItem(_LS_PREFIX + key, JSON.stringify(val)); } catch (e) {
    try { sessionStorage.setItem('ygeo:' + key, JSON.stringify(val)); } catch (e2) {}
  }
}

// ── Photon (Komoot) — API rapide sans clé ────────────────────────────
// Endpoint officiel : https://photon.komoot.io/api/
// Pas de rate limit strict — on ajoute 200ms de politesse.
function _photon(query, cb) {
  var url = 'https://photon.komoot.io/api/?q='
    + encodeURIComponent(query) + '&limit=1&lang=fr';
  fetch(url, { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var f = data && data.features && data.features[0];
      if (f && f.geometry && f.geometry.coordinates) {
        cb({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] });
      } else {
        cb(null);
      }
    })
    .catch(function () { cb(null); });
}

// ── Nominatim (OSM) — fallback, 1 req/s ──────────────────────────────
function _nominatim(query, cb) {
  var wait = Math.max(0, 1100 - (Date.now() - _lastGeoReq));
  setTimeout(function () {
    _lastGeoReq = Date.now();
    fetch(
      'https://nominatim.openstreetmap.org/search?format=json&limit=1&q='
      + encodeURIComponent(query),
      { headers: { 'Accept-Language': 'fr,en' } }
    )
    .then(function (r) { return r.json(); })
    .then(function (data) {
      cb((data && data.length)
        ? { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
        : null);
    })
    .catch(function () { cb(null); });
  }, wait);
}

// ── Point d'entrée public : cascade Photon → Nominatim ───────────────
function _geocode(query, cb) {
  var key = query.toLowerCase().trim();
  var cached = _cacheGet(key);

  // Cache hit (y compris null = "introuvable")
  if (cached !== undefined) { cb(cached); return; }

  // Pas en cache → essayer Photon
  _photon(query, function (result) {
    if (result) {
      _cacheSet(key, result);
      cb(result);
      return;
    }
    // Photon a échoué → Nominatim en file d'attente
    _geoQueue.push({ query: query, key: key, cb: cb });
    _drainQueue();
  });
}

function _drainQueue() {
  if (_geocoding || !_geoQueue.length) return;
  _geocoding = true;
  var item = _geoQueue.shift();

  _nominatim(item.query, function (result) {
    _cacheSet(item.key, result); // null aussi — "introuvable" est mémorisé
    item.cb(result);
    _geocoding = false;
    _drainQueue();
  });
}


// ── §3 QUERIES DE GÉOCODAGE ───────────────────────────────────────────
function _hotelQuery(h) {
  if (h.fullAddress && h.fullAddress.trim()) return h.fullAddress;
  if (h.adresse && h.adresse.trim()) return h.adresse + (h.ville ? ', ' + h.ville : '');
  if (h.nom && h.ville) return h.nom + ', ' + h.ville;
  return h.ville || '';
}

function _lieuQuery(l) {
  if (l.fullAddress && l.fullAddress.trim()) return l.fullAddress;
  if (l.adresse && l.adresse.trim()) return l.adresse + (l.ville ? ', ' + l.ville : '');
  if (l.nom && l.ville) return l.nom + ', ' + l.ville;
  return l.ville || '';
}


// ── §4 MARQUEURS ─────────────────────────────────────────────────────
function _makeIcon(type, label) {
  var bg  = type === 'hotel' ? '#F08080' : '#5C6BC0';
  var lbl = label || (type === 'hotel' ? 'H' : '+');
  return L.divIcon({
    className: '',
    html: '<div style="'
      + 'width:34px;height:34px;border-radius:50%;'
      + 'background:' + bg + ';border:2.5px solid white;'
      + 'box-shadow:0 2px 10px rgba(0,0,0,.28);'
      + 'display:flex;align-items:center;justify-content:center;'
      + 'font-size:15px;cursor:pointer'
      + '">' + lbl + '</div>',
    iconSize:    [34, 34],
    iconAnchor:  [17, 17],
    popupAnchor: [0, -18]
  });
}

function _popupHTML(pin) {
  var mapsUrl = _isIOS
    ? 'maps://?q=' + encodeURIComponent(pin.label)
    : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(pin.label);
  return '<div style="font-family:DM Sans,sans-serif;min-width:160px;max-width:220px">'
    + '<div style="font-size:14px;font-weight:600;color:#1a1a2e;margin-bottom:3px">'
      + (pin.emoji || '') + ' ' + pin.name
    + '</div>'
    + '<div style="font-size:11px;color:#5a5a72;margin-bottom:8px">' + pin.sub + '</div>'
    + '<a href="' + mapsUrl + '" target="_blank" rel="noopener" '
    + 'style="display:inline-block;padding:5px 11px;background:#e8748a;color:white;'
    + 'border-radius:8px;font-size:11px;font-weight:500;text-decoration:none">'
    + (_isIOS ? 'Ouvrir dans Plans' : 'Google Maps')
    + '</a></div>';
}

function _placeMarker(pin) {
  if (!_map || pin.lat == null) return;
  var marker = L.marker([pin.lat, pin.lng], {
    icon: _makeIcon(pin.type, pin.emoji)
  }).bindPopup(_popupHTML(pin), { maxWidth: 240 });

  // Visibilité selon filtres actifs
  if (_showHotels() && pin.type === 'hotel') marker.addTo(_map);
  if (_showLieux()  && pin.type === 'lieu')  marker.addTo(_map);

  _markers.push({ marker: marker, type: pin.type, id: pin.id, lat: pin.lat, lng: pin.lng });
  pin.marker = marker;
}


// ── §5 ARCS GÉODÉSIQUES (great circle) ───────────────────────────────
// Calcul SLERP — même algorithme que Leaflet.Geodesic / arc.js.
// Pas de dépendance externe nécessaire.
// ─────────────────────────────────────────────────────────────────────
function _greatCirclePoints(lat1, lng1, lat2, lng2, n) {
  var D  = Math.PI / 180;
  var la1 = lat1 * D, lo1 = lng1 * D;
  var la2 = lat2 * D, lo2 = lng2 * D;
  var d = 2 * Math.asin(Math.sqrt(
    Math.pow(Math.sin((la2 - la1) / 2), 2)
    + Math.cos(la1) * Math.cos(la2) * Math.pow(Math.sin((lo2 - lo1) / 2), 2)
  ));

  n = n || 80;
  var pts = [];
  for (var i = 0; i <= n; i++) {
    var f = i / n;
    if (d < 0.0001) {
      pts.push([lat1 + f * (lat2 - lat1), lng1 + f * (lng2 - lng1)]);
      continue;
    }
    var A = Math.sin((1 - f) * d) / Math.sin(d);
    var B = Math.sin(f * d)       / Math.sin(d);
    var x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    var y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    var z = A * Math.sin(la1)                 + B * Math.sin(la2);
    pts.push([
      Math.atan2(z, Math.sqrt(x * x + y * y)) / D,
      Math.atan2(y, x) / D
    ]);
  }
  return pts;
}

// ── FIX 1 : Antimeridian ─────────────────────────────────────────────
// Découpe une route qui croise le méridien 180° en segments séparés.
// Sans ce fix, Paris→Tokyo trace une ligne qui traverse tout l'écran.
// Retourne un tableau de segments (chaque segment = tableau de [lat,lng]).
// ─────────────────────────────────────────────────────────────────────
function _splitAntimeridian(pts) {
  if (!pts.length) return [pts];
  var segments = [[pts[0]]];
  for (var i = 1; i < pts.length; i++) {
    var dLng = pts[i][1] - pts[i - 1][1];
    if (Math.abs(dLng) > 180) {
      // Coupure : démarrer un nouveau segment
      segments.push([]);
    }
    segments[segments.length - 1].push(pts[i]);
  }
  return segments;
}


// ── Arc quadratique pour les bateaux ─────────────────────────────────
// Crée une courbe en arc qui reste "au-dessus" de la ligne droite,
// visuellement plus cohérent avec un trajet maritime.
// N points interpolés sur la courbe de Bézier quadratique.
function _bezierArc(lat1, lng1, lat2, lng2, n) {
  // Point de contrôle : milieu + déviation perpendiculaire
  var midLat = (lat1 + lat2) / 2;
  var midLng = (lng1 + lng2) / 2;
  // Perpendiculaire au segment : décaler le point de contrôle vers le large
  var dlat = lat2 - lat1, dlng = lng2 - lng1;
  var len = Math.sqrt(dlat * dlat + dlng * dlng);
  // Déviation proportionnelle à la distance (max 8°)
  var dev = Math.min(len * 0.35, 8);
  // Direction perpendiculaire (vers le sud pour aller dans l'eau en général)
  var ctrlLat = midLat - (dlng / len) * dev * 0.5;
  var ctrlLng = midLng + (dlat / len) * dev * 0.5;

  var pts = [];
  for (var i = 0; i <= n; i++) {
    var t = i / n;
    var u = 1 - t;
    // Bézier quadratique : P = u²·P0 + 2u·t·P1 + t²·P2
    var lat = u*u*lat1 + 2*u*t*ctrlLat + t*t*lat2;
    var lng = u*u*lng1 + 2*u*t*ctrlLng + t*t*lng2;
    pts.push([lat, lng]);
  }
  return pts;
}

// ── §6 DESSIN DES ROUTES ──────────────────────────────────────────────
function _clearRoutes() {
  _routes.forEach(function (r) {
    r.layers.forEach(function (layer) {
      if (_map) _map.removeLayer(layer);
    });
  });
  _routes = [];
}

function _drawSingleRoute(lat1, lng1, lat2, lng2, type, label, id) {
  if (!_map) return;
  var isVol    = (type === 'vol');
  var isBoat   = (type === 'bateau');
  var color    = _COLORS[type] || '#e8748a';
  var opts     = isVol
    ? { color: color, weight: 2.4, opacity: 0.80, smoothFactor: 1 }
    : { color: color, weight: 2.2, opacity: 0.70, dashArray: '10 7', smoothFactor: 1 };

  var layers = [];

  if (isVol) {
    // Arc géodésique découpé à l'antimeridian
    var allPts   = _greatCirclePoints(lat1, lng1, lat2, lng2, 80);
    var segments = _splitAntimeridian(allPts);
    segments.forEach(function (seg) {
      if (seg.length < 2) return;
      var poly = L.polyline(seg, opts);
      poly.bindTooltip(label || '', { sticky: true, className: 'lmap-tooltip' });
      if (_showItineraire()) poly.addTo(_map);
      layers.push(poly);
    });
  } else if (isBoat) {
    // Arc de Bézier pour les bateaux — courbe élégante, évite les lignes droites sur terre
    var bPts = _bezierArc(lat1, lng1, lat2, lng2, 60);
    var poly = L.polyline(bPts, opts);
    poly.bindTooltip(label || '', { sticky: true, className: 'lmap-tooltip' });
    if (_showItineraire()) poly.addTo(_map);
    layers.push(poly);
  } else {
    // Ligne droite pointillée (train, bus…)
    var poly2 = L.polyline([[lat1, lng1], [lat2, lng2]], opts);
    poly2.bindTooltip(label || '', { sticky: true, className: 'lmap-tooltip' });
    if (_showItineraire()) poly2.addTo(_map);
    layers.push(poly2);
  }

  _routes.push({ layers: layers, type: type, label: label || '', id: (id != null ? id : null) });
  if (typeof _renderList === 'function') _renderList();
}

// ── §6b ROUTING OSRM — vraies routes pour voiture ────────────────────
// Utilise le serveur public OSRM (aucune clé requise).
// Cache mémoire pour ne pas requêter deux fois le même trajet.
var _osrmCache = {};

function _osrmRoute(lat1, lng1, lat2, lng2, type, label, id) {
  var key = [lat1,lng1,lat2,lng2].map(function(v){
    return Math.round(v * 1000) / 1000;
  }).join(',');

  // Cache hit
  if (_osrmCache[key]) {
    _drawOsrmPolyline(_osrmCache[key], type, label, id);
    return;
  }

  // Ligne droite immédiate pendant le chargement
  _drawSingleRoute(lat1, lng1, lat2, lng2, type, label, id);

  var url = 'https://router.project-osrm.org/route/v1/driving/'
    + lng1 + ',' + lat1 + ';' + lng2 + ',' + lat2
    + '?overview=full&geometries=geojson';

  fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var coords = data && data.routes && data.routes[0]
        && data.routes[0].geometry && data.routes[0].geometry.coordinates;
      if (!coords || !coords.length) return;
      var pts = coords.map(function(c) { return [c[1], c[0]]; });
      _osrmCache[key] = pts;
      _drawOsrmPolyline(pts, type, label, id);
    })
    .catch(function() {});
}

function _drawOsrmPolyline(pts, type, label, id) {
  if (!_map || !pts.length) return;
  var color = _COLORS[type] || '#c9921a';
  var poly  = L.polyline(pts, {
    color: color, weight: 2.5, opacity: 0.75, dashArray: '8 5', smoothFactor: 2
  });
  poly.bindTooltip(label || '', { sticky: true, className: 'lmap-tooltip' });
  if (_showItineraire()) poly.addTo(_map);
  _routes.push({ layers: [poly], type: type, label: label || '', id: (id != null ? id : null) });
  if (typeof _renderList === 'function') _renderList();
}


function _drawRoutes() {
  _clearRoutes();
  if (!_map) return;
  var mobs = (typeof mobilites !== 'undefined') ? mobilites : [];
  if (!mobs.length) return;

  mobs.forEach(function (m) {
    if (!m.dep || !m.arr) return;
    var type  = m.type;
    var icons = { vol:'Vol', train:'Train', bus:'Bus', bateau:'Bateau',
                  covoiturage:'Cov.', metro:'Métro', taxi:'Taxi' };
    var label = (icons[type] || '—') + ' — ' + m.dep + ' → ' + m.arr;

    if (type === 'vol' && m.segment2 && (m.segment2.dep || m.segment2.arr)) {
      // Vol avec escale : deux arcs
      var escale = m.segment2.dep || '';
      var final  = m.segment2.arr || m.arr;
      _geocode(m.dep, function (r1) {
        if (!r1) return;
        _geocode(escale, function (r2) {
          if (!r2) return;
          _drawSingleRoute(r1.lat, r1.lng, r2.lat, r2.lng, 'vol',
            'Vol — ' + m.dep + ' → ' + escale + ' (tronçon 1)', m.id);
          _geocode(final, function (r3) {
            if (!r3) return;
            _drawSingleRoute(r2.lat, r2.lng, r3.lat, r3.lng, 'vol',
              'Vol — ' + escale + ' → ' + final + ' (tronçon 2)', m.id);
          });
        });
      });
    } else if (type === 'train' && m.depLat && m.depLng && m.arrLat && m.arrLng) {
      // Trains avec coordonnées : tracer la ligne directe IMMÉDIATEMENT,
      // puis tenter de superposer le vrai tracé ferroviaire Overpass.
      // L'utilisateur voit quelque chose tout de suite, amélioré après ~2s.
      _drawSingleRoute(m.depLat, m.depLng, m.arrLat, m.arrLng, type, label, m.id);
      if (typeof RailRouter !== 'undefined' && _map) {
        RailRouter.fetchAndDraw(m, _map, { /* silencieux si Overpass échoue */ });
      }
    } else if (type === 'train' && !m.depLat) {
      // Train sans coordonnées : géocoder → tracer → tenter Overpass
      _geocode(m.dep, function (r1) {
        if (!r1) return;
        _geocode(m.arr, function (r2) {
          if (!r2) return;
          _drawSingleRoute(r1.lat, r1.lng, r2.lat, r2.lng, type, label, m.id);
          var enriched = Object.assign({}, m, {
            depLat: r1.lat, depLng: r1.lng,
            arrLat: r2.lat, arrLng: r2.lng
          });
          if (typeof RailRouter !== 'undefined' && _map) {
            RailRouter.fetchAndDraw(enriched, _map, { /* silencieux */ });
          }
        });
      });
    } else if (type === 'covoiturage' || type === 'taxi') {
      // Voiture → routing OSRM (vraies routes sur la carte)
      _geocode(m.dep, function (r1) {
        if (!r1) return;
        _geocode(m.arr, function (r2) {
          if (!r2) return;
          _osrmRoute(r1.lat, r1.lng, r2.lat, r2.lng, type, label, m.id);
        });
      });
    } else {
      // Géocodage à la volée pour les autres types (bus, metro…)
      _geocode(m.dep, function (r1) {
        if (!r1) return;
        _geocode(m.arr, function (r2) {
          if (!r2) return;
          _drawSingleRoute(r1.lat, r1.lng, r2.lat, r2.lng, type, label, m.id);
        });
      });
    }
  });
}


// ── §7 CHARGEMENT DES POINTS DU VOYAGE ───────────────────────────────
function _loadTripPoints() {
  // Vider les marqueurs existants
  _markers.forEach(function (m) { if (_map) _map.removeLayer(m.marker); });
  _markers = [];
  _pins    = [];

  var noTrip = !currentTripId || !allTrips[currentTripId];
  var ph     = document.getElementById('tripmap-placeholder');

  if (noTrip) {
    if (ph) ph.classList.add('visible');
    _renderList();
    return;
  }
  if (ph) ph.classList.remove('visible');

  var points = []; // points à géocoder

  // ── Hôtels ──────────────────────────────────────────────────────
  (hotels || []).forEach(function (h, i) {
    var query = _hotelQuery(h);
    if (!query) return;
    var pin = {
      id:       String(h.id),
      type:     'hotel',
      name:     h.nom,
      sub:      (h.ville || '') + (h.checkin ? ' · ' + h.checkin + (h.checkout ? ' → ' + h.checkout : '') : ''),
      emoji:    'H',
      label:    query,
      lat:      h.lat  || null,
      lng:      h.lng  || null,
      geocoding: !(h.lat && h.lng),
      _idxRef:  String(i)
    };
    _pins.push(pin);
    if (h.lat && h.lng) {
      _placeMarker(pin);
    } else {
      points.push({ pin: pin, query: query });
    }
  });

  // ── Lieux ────────────────────────────────────────────────────────
  // FIX 2 : utiliser l.lat/l.lng quand ils existent (bug : étaient forcés à null)
  (lieux || []).forEach(function (l, i) {
    var query = _lieuQuery(l);
    if (!query) return;
    var alreadyGeocoded = !!(l.lat && l.lng);
    var pin = {
      id:       String(l.id),
      type:     'lieu',
      name:     l.nom,
      sub:      (l.ville || '') + (l.visited ? ' · Visité' : ''),
      emoji:    l.emoji || '',
      label:    query,
      lat:      l.lat  || null,   // FIX : respecte les coords existantes
      lng:      l.lng  || null,   // FIX : idem
      geocoding: !alreadyGeocoded,
      _idxRef:  String(i)
    };
    _pins.push(pin);
    if (alreadyGeocoded) {
      _placeMarker(pin);
    } else {
      points.push({ pin: pin, query: query });
    }
  });

  // Dessiner les routes (arcs vols, pointillés trains/bus)
  _drawRoutes();
  _renderList();

  if (!points.length) {
    _showLoadingBar(false);
    if (!_markers.length && !_routes.length) {
      if (ph) {
        ph.innerHTML =
          '<div style="font-size:14px;font-weight:500;color:var(--ink);margin-bottom:5px">Aucun lieu enregistré</div>'
          + '<div style="font-size:12px;color:var(--ink-muted)">Ajoute des hébergements et lieux dans l\'onglet Voyage.</div>';
        ph.classList.add('visible');
      }
    }
    return;
  }

  _showLoadingBar(true);
  var pending = points.length;

  points.forEach(function (item) {
    _geocode(item.query, function (result) {
      item.pin.geocoding = false;
      if (result) {
        item.pin.lat = result.lat;
        item.pin.lng = result.lng;
        _placeMarker(item.pin);
      }
      pending--;
      _renderList();
      if (pending === 0) {
        _showLoadingBar(false);
        setTimeout(tripmapRecenter, 150);
      }
    });
  });
}


// ── §8 FILTRES ────────────────────────────────────────────────────────
function _isAllActive() {
  return !_activeFilters.hotels && !_activeFilters.lieux && !_activeFilters.itineraire;
}
function _showHotels()     { return _isAllActive() || !!_activeFilters.hotels; }
function _showLieux()      { return _isAllActive() || !!_activeFilters.lieux; }
function _showItineraire() { return _isAllActive() || !!_activeFilters.itineraire; }

function _applyFilters() {
  if (!_map) return;
  var showH = _showHotels();
  var showL = _showLieux();
  var showR = _showItineraire();

  _markers.forEach(function (m) {
    var show = (m.type === 'hotel' && showH) || (m.type === 'lieu' && showL);
    if (show) m.marker.addTo(_map);
    else      _map.removeLayer(m.marker);
  });

  _routes.forEach(function (r) {
    r.layers.forEach(function (layer) {
      if (showR) layer.addTo(_map);
      else       _map.removeLayer(layer);
    });
  });

  _updateFilterButtons();
  _renderList();
}

function _updateFilterButtons() {
  var allActive = _isAllActive();
  document.querySelectorAll('.tmap-filter').forEach(function (b) {
    var f = b.getAttribute('data-filter');
    b.classList.toggle('active', f === 'all' ? allActive : !!_activeFilters[f]);
  });
  var countEl = document.getElementById('tmap-active-count');
  if (countEl) {
    var n = Object.keys(_activeFilters).filter(function (k) { return _activeFilters[k]; }).length;
    countEl.style.display = (n > 0 && n < 3) ? '' : 'none';
    if (n > 0 && n < 3) countEl.textContent = n + ' filtre' + (n > 1 ? 's' : '') + ' actif' + (n > 1 ? 's' : '');
  }
}

window.tripmapFilter = function (filter) {
  if (filter === 'all') {
    _activeFilters = {};
  } else {
    _activeFilters[filter] = !_activeFilters[filter];
    var anyActive = Object.keys(_activeFilters).some(function (k) { return _activeFilters[k]; });
    if (!anyActive) _activeFilters = {};
  }
  _applyFilters();
  tripmapRecenter();
};


// ── §9 LISTE SOUS LA CARTE ────────────────────────────────────────────
var _TYPE_LABELS = { vol:'✈️', train:'🚄', bus:'🚌', bateau:'⛴️',
                     covoiturage:'🚗', metro:'🚇', taxi:'🚕' };

function _renderList() {
  var el = document.getElementById('tripmap-list-inner');
  if (!el) return;

  var showH = _showHotels();
  var showL = _showLieux();
  var showR = _showItineraire();
  var parts = [];

  // Routes
  if (showR && _routes.length) {
    parts.push(_routes.map(function (r) {
      var isVol  = r.type === 'vol';
      var sw     = 'height:2px;width:28px;border-radius:2px;';
      var swatch = isVol
        ? 'background:' + (_COLORS[r.type] || '#888') + ';' + sw
        : 'background:repeating-linear-gradient(90deg,'
          + (_COLORS[r.type] || '#888') + ' 0,'
          + (_COLORS[r.type] || '#888') + ' 8px,transparent 8px,transparent 14px);' + sw;
      var rid = (r.id != null) ? String(r.id).replace(/'/g, "\\'") : '';
      return '<div class="tmap-pin-card"'
        + (rid
            ? ' onclick="if(window.tripmapFocusRoute)tripmapFocusRoute(\'' + rid + '\')" style="cursor:pointer"'
            : ' style="cursor:default"')
        + '>'
        + '<div class="tmap-pin-icon" style="background:#f4f4f8;border:none;font-size:13px;font-weight:600">'
          + (_TYPE_LABELS[r.type] || '—')
        + '</div>'
        + '<div class="tmap-pin-body">'
          + '<div class="tmap-pin-name">' + r.label + '</div>'
          + '<div class="tmap-pin-sub" style="display:flex;align-items:center;gap:6px;margin-top:3px">'
            + '<span style="' + swatch + '"></span>'
            + (isVol ? 'Arc géodésique' : 'Tracé pointillé')
          + '</div>'
        + '</div>'
        + (rid ? _infoBtn('transport', rid) : '')
        + '</div>';
    }).join(''));
  }

  // Marqueurs filtrés
  var filtered = _pins.filter(function (p) {
    return (p.type === 'hotel' && showH) || (p.type === 'lieu' && showL);
  });

  if (filtered.length) {
    parts.push(filtered.map(function (p) {
      var statusClass = p.geocoding ? 'geocoding' : (p.lat ? 'located' : 'notfound');
      var statusLabel = p.geocoding ? 'Géocodage…' : (p.lat ? 'Localisé' : 'Introuvable');
      var mapsUrl = p.lat
        ? (_isIOS
            ? 'maps://?ll=' + p.lat + ',' + p.lng + '&q=' + encodeURIComponent(p.name)
            : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.label))
        : null;

      return '<div class="tmap-pin-card" '
        + 'onclick="tripmapFocusPin(\'' + p.id + '\',\'' + p.type + '\')">'
        + '<div class="tmap-pin-icon ' + p.type + '">' + (p.emoji || (p.type === 'hotel' ? 'H' : '+')) + '</div>'
        + '<div class="tmap-pin-body">'
          + '<div class="tmap-pin-name">' + p.name + '</div>'
          + '<div class="tmap-pin-sub">'  + p.sub  + '</div>'
        + '</div>'
        + '<span class="tmap-pin-status ' + statusClass + '">' + statusLabel + '</span>'
        + (mapsUrl
          ? '<a class="tmap-pin-open-btn" href="' + mapsUrl + '" target="_blank" rel="noopener" '
            + 'onclick="event.stopPropagation()">'
            + (_isIOS ? 'Plans' : 'Maps') + '</a>'
          : '')
        + _infoBtn(p.type === 'hotel' ? 'hotel' : 'lieu', p.id)
        + '</div>';
    }).join(''));
  }

  var html = parts.filter(Boolean).join('');
  el.innerHTML = html || '<div style="text-align:center;padding:20px;color:var(--ink-muted);font-size:13px">'
    + 'Aucun élément dans cette sélection</div>';
}

// Petit bouton « info » : ouvre la fiche détail de l'activité (modale),
// même comportement que le planning. stopPropagation pour ne pas
// déclencher le recentrage de la carte.
function _infoBtn(cat, id) {
  var sid = String(id).replace(/'/g, "\\'");
  return '<button class="tmap-info-btn" title="Voir les informations" '
    + 'onclick="event.stopPropagation();if(window.openTimelineDetail)openTimelineDetail(\'' + cat + '\',\'' + sid + '\')">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" width="15" height="15">'
    + '<circle cx="12" cy="12" r="9"/><line x1="11.5" y1="11" x2="12.5" y2="11"/>'
    + '<line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="7.8" r="0.5" fill="currentColor"/></svg>'
    + '</button>';
}

// Recentre la carte sur une route (ajuste aux limites de ses tracés)
window.tripmapFocusRoute = function (id) {
  if (!_map) return;
  var route = _routes.filter(function (r) { return String(r.id) === String(id); })[0];
  if (!route || !route.layers || !route.layers.length) return;
  var bounds = null;
  route.layers.forEach(function (ly) {
    if (ly && ly.getBounds) {
      bounds = bounds ? bounds.extend(ly.getBounds()) : ly.getBounds();
    }
  });
  if (bounds && bounds.isValid()) {
    _map.fitBounds(bounds, { padding: [60, 60], maxZoom: 7, animate: true });
  }
};

// Bascule carte plein écran <-> format réduit (carte + infos sous/à côté)
window.tripmapToggleFull = function () {
  var host = document.getElementById('voyage-map-host');
  if (!host) return;
  host.classList.toggle('is-full');
  setTimeout(function () {
    if (_map && _map.invalidateSize) _map.invalidateSize();
  }, 220);
};


// ── §10 FOCUS, RECENTRAGE, GPS ────────────────────────────────────────

window.tripmapFocusPin = function (id, type) {
  var pin = _pins.find(function (p) { return p.id === id && p.type === type; });
  if (!pin || !pin.marker || !pin.lat) return;
  _map.setView([pin.lat, pin.lng], 15, { animate: true });
  pin.marker.openPopup();
};

var tripmapRecenter = function () {
  if (!_map) return;
  var allPts = [];

  _markers.forEach(function (m) {
    var visible = (m.type === 'hotel' && _showHotels())
               || (m.type === 'lieu'  && _showLieux());
    if (visible && m.lat != null) allPts.push([m.lat, m.lng]);
  });

  if (_showItineraire()) {
    _routes.forEach(function (r) {
      r.layers.forEach(function (layer) {
        layer.getLatLngs().forEach(function (pt) {
          // getLatLngs peut retourner des tableaux imbriqués (multipolyline)
          if (Array.isArray(pt)) {
            pt.forEach(function (p) { if (p.lat != null) allPts.push([p.lat, p.lng]); });
          } else if (pt.lat != null) {
            allPts.push([pt.lat, pt.lng]);
          }
        });
      });
    });
  }

  if (!allPts.length) {
    var country = currentTripId && allTrips[currentTripId]
      ? (allTrips[currentTripId].meta || {}).country || '' : '';
    if (country) {
      _geocode(country, function (r) {
        if (r && _map) _map.setView([r.lat, r.lng], 6);
      });
    }
    return;
  }

  if (allPts.length === 1) { _map.setView(allPts[0], 13); return; }
  try {
    _map.fitBounds(L.latLngBounds(allPts), { padding: [40, 40], maxZoom: 14 });
  } catch (e) {}
};
window.tripmapRecenter = tripmapRecenter;

window.tripmapGeolocate = function () {
  if (!_map) return;
  var btn = document.getElementById('tripmap-geolocate-btn');
  if (!navigator.geolocation) {
    if (typeof showToast === 'function') showToast('GPS non disponible', 'error');
    return;
  }
  if (btn) btn.classList.add('loading');

  navigator.geolocation.getCurrentPosition(
    function (pos) {
      if (btn) btn.classList.remove('loading');
      var lat = pos.coords.latitude, lng = pos.coords.longitude;

      if (_userMark) { _map.removeLayer(_userMark); _userMark = null; }
      if (_userCirc) { _map.removeLayer(_userCirc); _userCirc = null; }

      _userMark = L.circleMarker([lat, lng], {
        radius: 9, color: '#ffffff', weight: 3,
        fillColor: '#4A90D9', fillOpacity: 1, zIndexOffset: 2000
      }).addTo(_map)
        .bindPopup('<div style="font-family:DM Sans,sans-serif;font-size:13px;font-weight:600;color:#1a1a2e">Ma position</div>');

      if (pos.coords.accuracy && pos.coords.accuracy < 50000) {
        _userCirc = L.circle([lat, lng], {
          radius: pos.coords.accuracy,
          color: '#4A90D9', weight: 1.5, opacity: 0.5,
          fillColor: '#4A90D9', fillOpacity: 0.08
        }).addTo(_map);
      }

      _map.flyTo([lat, lng], 13, { duration: 1.4, easeLinearity: 0.3 });
    },
    function (err) {
      if (btn) btn.classList.remove('loading');
      var msg = err.code === 1
        ? 'Permission GPS refusée — activez la localisation dans les réglages'
        : 'Impossible d\'obtenir la position GPS';
      if (typeof showToast === 'function') showToast(msg, 'error');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
};

// Navigation vers un marqueur depuis un autre onglet (lieux, hôtels)
window.goToMapPin = function (type, id) {
  var pin = _pins.find(function (p) { return p.id === String(id) && p.type === type; });
  if (!pin || !pin.lat) return;
  if (typeof showTab === 'function') showTab('carte-voyage');
  setTimeout(function () {
    if (_map) {
      _map.setView([pin.lat, pin.lng], 15, { animate: true });
      if (pin.marker) pin.marker.openPopup();
    }
  }, 350);
};


// ── §11 BARRE DE CHARGEMENT ───────────────────────────────────────────
function _showLoadingBar(show) {
  var wrap = document.getElementById('tripmap-wrap');
  if (!wrap) return;
  var bar = document.getElementById('tripmap-loading-bar');
  if (show) {
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'tripmap-loading-bar';
      bar.className = 'tripmap-loading-bar';
      wrap.appendChild(bar);
    }
  } else {
    if (bar) bar.remove();
  }
}


// ── §12 INIT PRINCIPALE ───────────────────────────────────────────────
// Appelée par app.js → showTab('carte-voyage').
// Attend que L soit chargé par map-world.js (retry 300ms).
// ─────────────────────────────────────────────────────────────────────
window.initTripMap = function (options) {
  if (typeof L === 'undefined') {
    setTimeout(function () { window.initTripMap(options); }, 300);
    return;
  }

  if (!_initDone) {
    _map = L.map('tripmap-leaflet', {
      center: [20, 10],
      zoom: 2,
      minZoom: 1,
      maxZoom: 19,
      zoomControl: true,
      attributionControl: true,
      // worldCopyJump:false — le globe peut défiler librement.
      // L'antimeridian est géré par _splitAntimeridian() sur les polylines.
      worldCopyJump: false
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        + ' contributors © <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(_map);

    // Exposer l'instance pour rail-router.js
    window._tripmapInstance = _map;
    _initDone = true;
  }

  setTimeout(function () {
    _map.invalidateSize();
    _loadTripPoints();
  }, 120);
};


// ── §13 ABONNEMENTS YUMESTATE ─────────────────────────────────────────
// Remplace le monkey-patch du Script4 (tripmap, l.14754 du monolithe).
// Quand snapshotCurrentTrip() est appelé, la carte se rafraîchit
// si et seulement si l'onglet voyage est actuellement visible.
// ─────────────────────────────────────────────────────────────────────
YumeState.on('trip:snapshot', function () {
  // Déjà géré dans state.js §6 — cet abonnement additionnel
  // est une sécurité si map-trip.js doit faire du travail propre.
  // Pour l'instant, state.js gère le refresh — pas de doublon ici.
});

// Vider les marqueurs/routes au changement de voyage
// (le nouvel appel à initTripMap() par app.js rechargera tout)
YumeState.on('trip:changed', function () {
  if (!_initDone) return;
  _markers.forEach(function (m) { if (_map) _map.removeLayer(m.marker); });
  _markers = [];
  _pins    = [];
  _clearRoutes();
  _renderList();
});

// Refresh après import de sauvegarde (Phase B Fix)
// importData() émet 'map:refresh' — on recharge les points du voyage actif
// si une carte est déjà initialisée. La carte monde se gère via son propre
// abonnement dans map-world.js.
YumeState.on('map:refresh', function () {
  if (!_initDone || !_map) return;
  _markers.forEach(function (m) { _map.removeLayer(m.marker); });
  _markers = [];
  _pins    = [];
  _clearRoutes();
  setTimeout(function () {
    _map.invalidateSize();
    _loadTripPoints();
  }, 150);
});

})(); // fin IIFE map-trip
