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
var _cluster      = null;   // L.markerClusterGroup (regroupement des pins) ; null si la lib n'est pas chargée
var _pins         = [];     // données enrichies pour la liste sous la carte
var _routes       = [];     // [{ layer: L.polyline[], type, label }]
var _userMark     = null;   // point GPS bleu
var _userCirc     = null;   // cercle de précision GPS

// ── Regroupement : les marqueurs hôtel/lieu passent par le groupe de cluster
// (Leaflet.markercluster vendoré) au lieu d'être ajoutés directement au _map.
// Si la lib n'a pas encore été chargée (_cluster null), repli TRANSPARENT sur
// l'ancien comportement (ajout direct) — la carte reste fonctionnelle, sans
// regroupement. _ensureCluster est rappelé à chaque chargement de points, donc
// le premier montage antérieur au chargement de la lib se rattrape au suivant.
function _ensureCluster() {
  if (_cluster || !_map || typeof L === 'undefined' || typeof L.markerClusterGroup !== 'function') return;
  _cluster = L.markerClusterGroup({
    maxClusterRadius:      44,     // px : agrégation tant que les pins sont proches
    showCoverageOnHover:   false,  // pas de polygone de survol (sobriété)
    zoomToBoundsOnClick:   true,   // clic pastille = éclatement natif (aucun effet carrousel)
    spiderfyOnMaxZoom:     true,   // coords quasi identiques → éventail au zoom max
    removeOutsideVisibleBounds: true,
    animate:               true,
    iconCreateFunction:    _clusterIcon
  });
  _cluster.addTo(_map);
}
// Ajoute/retire un marqueur via le cluster si dispo, sinon direct sur le map.
function _addMarker(marker)    { if (_cluster) _cluster.addLayer(marker);    else if (_map) marker.addTo(_map); }
function _removeMarker(marker) { if (_cluster) _cluster.removeLayer(marker); else if (_map) _map.removeLayer(marker); }

// Filtres multi-select : {} = tout voir ; { hotels:true } = hôtels seulement
var _activeFilters = {};
// Filtre par jour : '' = tous les jours ; 'AAAA-MM-JJ' = un jour précis.
var _activeDay = '';

// ── Résolution date/heure d'un élément (pour tri chronologique + filtre jour) ──
var _TMAP_JOURS = ['Dim.','Lun.','Mar.','Mer.','Jeu.','Ven.','Sam.'];
var _TMAP_MOIS  = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
function _tmapPad2(n){ return (n<10?'0':'')+n; }
function _tmapTimeMs(t){
  if(!t) return 0;
  var m = String(t).match(/^(\d{1,2})\s*[:hH]\s*(\d{2})/);
  if(m) return (+m[1]*3600 + +m[2]*60)*1000;
  var m2 = String(t).match(/^(\d{1,2})\s*[hH]\s*$/);
  if(m2) return (+m2[1]*3600)*1000;
  return 0;
}
// cat: 'transport' | 'hotel' | 'lieu'. Renvoie {sortKey, dayKey, dayLabel}.
// Sans date → sortKey Infinity (fin de liste), dayKey '' (hors filtre jour).
function _tmapWhen(cat, id){
  var arr = cat==='transport' ? ((typeof mobilites!=='undefined')?mobilites:[])
          : cat==='hotel'     ? ((typeof hotels!=='undefined')?hotels:[])
          :                     ((typeof lieux!=='undefined')?lieux:[]);
  var it=null, i;
  for(i=0;i<arr.length;i++){ if(String(arr[i].id)===String(id)){ it=arr[i]; break; } }
  if(!it) return { sortKey:Infinity, dayKey:'', dayLabel:'' };
  var dObj=null, t='';
  if(cat==='transport'){ dObj=(typeof parseDDMMYYYY==='function')?parseDDMMYYYY(it.date):null; t=it.heureDep||''; }
  else if(cat==='hotel'){ dObj=(typeof _hotelDateObj==='function')?_hotelDateObj(it.checkin):null; t='14:00'; }
  else { dObj=(typeof parseDDMMYYYY==='function')?parseDDMMYYYY(it.dateVisite):null; t=it.ouverture||''; }
  if(!dObj || isNaN(dObj.getTime())) return { sortKey:Infinity, dayKey:'', dayLabel:'' };
  var key   = dObj.getFullYear()+'-'+_tmapPad2(dObj.getMonth()+1)+'-'+_tmapPad2(dObj.getDate());
  var label = _TMAP_JOURS[dObj.getDay()]+' '+dObj.getDate()+' '+_TMAP_MOIS[dObj.getMonth()];
  return { sortKey: dObj.getTime()+_tmapTimeMs(t), dayKey:key, dayLabel:label };
}
function _tmapCatOf(pinType){ return pinType==='hotel' ? 'hotel' : (pinType==='transport' ? 'transport' : 'lieu'); }

// Couleurs par type de transport — SOURCE UNIQUE : MOB_COLORS (app.js),
// celle-là même qui colore l'ICÔNE du type. Cette table locale en
// divergeait (vol, train, métro et covoiturage étaient même permutés) :
// dans une fiche de trajet, le trait de légende n'avait donc pas la
// couleur de l'icône qu'il accompagne, et l'arc tracé sur la carte non
// plus. Conservée uniquement en REPLI défensif : map-trip.js se charge
// AVANT app.js, seul l'appel au runtime garantit MOB_COLORS disponible.
var _COLORS_FALLBACK = {
  vol:         '#c2607f',
  train:       '#4264d0',
  bus:         '#2d8c6b',
  bateau:      '#2d8c8c',
  covoiturage: '#7c5cbf',
  metro:       '#4f5bd5',
  taxi:        '#c9921a'
};
function _typeColor(type){
  if(typeof MOB_COLORS !== 'undefined' && MOB_COLORS[type]) return MOB_COLORS[type];
  return _COLORS_FALLBACK[type] || '#888';
}

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


// ── Base locale aéroports : code IATA → {lat,lng} (offline, instantané) ──
// Préféré AVANT le géocodage réseau : « Taipei TPE » se pose à l'aéroport
// TPE (Taoyuan) et non au centre-ville. Repli géocodage si code inconnu.
function _airportGps(code) {
  if (!code || typeof AIRPORTS_GPS === 'undefined') return null;
  var g = AIRPORTS_GPS[String(code).toUpperCase().trim()];
  return (g && g.length === 2) ? { lat: g[0], lng: g[1] } : null;
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
// Icône Lucide d'un pin (réutilise la lib d'app.js au runtime)
function _pinIcon(pin) {
  var bg = '#5C6BC0', svg = '';
  if (pin && pin.type === 'hotel') {
    bg = '#F08080';
    if (typeof _lu === 'function') svg = _lu('bed', 18);
  } else if (pin && pin.type === 'lieu') {
    if (typeof _lieuCatMeta === 'function') { var m = _lieuCatMeta(pin.cat || ''); bg = m.color; svg = m.svg; }
  }
  if (!svg) { svg = (typeof _lu === 'function') ? _lu('map-pin', 18) : ((pin && pin.emoji) || ''); }
  return { svg: svg, bg: bg };
}

// Pastille de groupe : anneau conic-gradient composé des couleurs de CATÉGORIE
// des pins agrégés (proportionnel), disque blanc central portant le compte.
// GARDE-FOU lisibilité (DA épurée, 34-40 px) : au-delà de 4 couleurs distinctes,
// on garde les 3 dominantes en segments et on agrège le reste en UN segment
// neutre — jamais 6+ tranches illisibles. Un seul type → anneau plein.
var _CLUSTER_REST = '#c8ccd4';   // gris neutre « autres »
function _clusterIcon(cluster) {
  var ms = cluster.getAllChildMarkers();
  var n  = ms.length, i;
  var counts = {};
  for (i = 0; i < ms.length; i++) {
    var c = ms[i]._catColor || '#8a93a3';
    counts[c] = (counts[c] || 0) + 1;
  }
  var entries = [];
  for (var k in counts) { if (counts.hasOwnProperty(k)) entries.push({ c: k, n: counts[k] }); }
  entries.sort(function (a, b) { return b.n - a.n; });

  var CAP = 4, segs;
  if (entries.length <= CAP) {
    segs = entries;
  } else {
    segs = entries.slice(0, CAP - 1);            // 3 dominantes
    var rest = 0;
    for (i = CAP - 1; i < entries.length; i++) rest += entries[i].n;
    segs.push({ c: _CLUSTER_REST, n: rest });     // + « autres » neutre
  }

  var deg = 0, stops = [];
  for (i = 0; i < segs.length; i++) {
    var d = deg + (segs[i].n / n) * 360;
    // léger arrondi pour éviter les sous-pixels ; le dernier ferme à 360.
    var end = (i === segs.length - 1) ? 360 : d;
    stops.push(segs[i].c + ' ' + deg.toFixed(2) + 'deg ' + end.toFixed(2) + 'deg');
    deg = d;
  }
  var grad  = (segs.length === 1) ? segs[0].c : 'conic-gradient(' + stops.join(',') + ')';
  var W     = n < 10 ? 36 : 42;
  var inner = W - 14;
  var html =
    '<div style="width:' + W + 'px;height:' + W + 'px;border-radius:50%;'
      + 'background:' + grad + ';border:2.5px solid #fff;'
      + 'box-shadow:0 2px 10px rgba(0,0,0,.28);'
      + 'display:flex;align-items:center;justify-content:center">'
      + '<div style="width:' + inner + 'px;height:' + inner + 'px;border-radius:50%;'
        + 'background:#fff;display:flex;align-items:center;justify-content:center;'
        + 'font-family:DM Sans,sans-serif;font-weight:600;font-size:13px;color:var(--ink)">'
        + n
      + '</div>'
    + '</div>';
  return L.divIcon({ className: '', html: html, iconSize: [W, W], iconAnchor: [W / 2, W / 2] });
}

function _makeIcon(type, label, pin) {
  var ic = (typeof _pinIcon === 'function')
    ? _pinIcon(pin || { type: type, emoji: label })
    : { svg: (label || ''), bg: (type === 'hotel' ? '#F08080' : '#5C6BC0') };
  return L.divIcon({
    className: '',
    html: '<div style="'
      + 'width:34px;height:34px;border-radius:50%;'
      + 'background:' + ic.bg + ';border:2.5px solid white;'
      + 'box-shadow:0 2px 10px rgba(0,0,0,.28);'
      + 'display:flex;align-items:center;justify-content:center;'
      + 'color:#fff;cursor:pointer'
      + '">' + ic.svg + '</div>',
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
      + pin.name
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
    icon: _makeIcon(pin.type, pin.emoji, pin)
  }).bindPopup(_popupHTML(pin), { maxWidth: 240 });

  // Couleur de catégorie mémorisée sur le marqueur → lue par _clusterIcon pour
  // composer l'anneau (sans régresser la coloration par catégorie du pin).
  marker._catColor = (typeof _pinIcon === 'function') ? _pinIcon(pin).bg : '#8a93a3';

  // Synchro pin → fiche (chantier A3) : tap sur le marqueur → le carrousel
  // défile jusqu'à la fiche correspondante (couple type/id). Mobile <768
  // uniquement (_carActive) ; le popup natif s'ouvre comme avant.
  marker.on('click', function () {
    if (typeof _carGoTo !== 'function' || !_carActive()) return;
    for (var i = 0; i < _carItems.length; i++) {
      if (_carItems[i].kind === 'pin' && _carItems[i].type === pin.type && _carItems[i].id === pin.id) {
        _carGoTo(i);
        break;
      }
    }
  });

  // Visibilité selon filtres actifs (via le groupe de cluster si dispo)
  if (_showHotels() && pin.type === 'hotel') _addMarker(marker);
  if (_showLieux()  && pin.type === 'lieu')  _addMarker(marker);

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
  var color    = _typeColor(type);
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
  var color = _typeColor(type);
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

    if (type === 'vol' && typeof _volChain === 'function') {
      // Tout vol (direct ou à escales) : chaîne origine → escale1 → … → destination.
      // N escales ⇒ N+1 arcs géodésiques chaînés (direct ⇒ 1 arc).
      // Résolution de chaque aéroport, par ordre de priorité :
      //   1. base locale AIRPORTS_GPS[code] (précis, instantané, corrige aussi
      //      les vols existants dont les coords étaient au centre-ville) ;
      //   2. lat/lng gelés sur l'aéroport (donnée figée à la sélection) ;
      //   3. géocodage réseau du nom (repli pour un code inconnu).
      (function () {
        var ch     = _volChain(m);
        var pts    = ch.airports;
        var coords = new Array(pts.length);
        var pending = pts.length;
        var done = function () {
          for (var k = 0; k < coords.length - 1; k++) {
            var a = coords[k], b = coords[k + 1];
            // Fallback : un aéroport sans coordonnées (donnée ancienne ou saisie
            // sans autocomplétion) → on SAUTE l'arc, jamais de tracé vers (0,0).
            if (!a || !b) continue;
            var lbl = 'Vol — ' + (pts[k].name || pts[k].code || '?') + ' → ' +
                      (pts[k + 1].name || pts[k + 1].code || '?') + ' (tronçon ' + (k + 1) + ')';
            _drawSingleRoute(a.lat, a.lng, b.lat, b.lng, 'vol', lbl, m.id);
          }
        };
        pts.forEach(function (ap, idx) {
          // 1. Base locale par code IATA (prioritaire : écrase un vieux centre-ville)
          var gps = _airportGps(ap.code);
          if (gps) {
            coords[idx] = gps;
            if (--pending === 0) done();
            return;
          }
          // 2. Coordonnées gelées valides sur l'aéroport
          if (typeof ap.lat === 'number' && typeof ap.lng === 'number' && !(ap.lat === 0 && ap.lng === 0)) {
            coords[idx] = { lat: ap.lat, lng: ap.lng };
            if (--pending === 0) done();
            return;
          }
          // 3. Repli : géocodage réseau du nom (ou du code si pas de nom)
          var q = ap.name || ap.code || '';
          if (!q) { coords[idx] = null; if (--pending === 0) done(); return; }
          _geocode(q, function (r) {
            coords[idx] = (r && typeof r.lat === 'number') ? { lat: r.lat, lng: r.lng } : null;
            if (--pending === 0) done();
          });
        });
      })();
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
  _ensureCluster();   // crée le groupe de cluster si la lib est chargée (idempotent)
  // Vider les marqueurs existants
  _markers.forEach(function (m) { _removeMarker(m.marker); });
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
    // Localisation explicitement retirée → présent dans la liste mais NON
    // localisé (« Introuvable »), jamais géocodé, aucun marqueur sur la carte.
    if (h.geoOff) {
      _pins.push({ id:String(h.id), type:'hotel', name:h.nom, sub:'', ville:(h.ville||''), emoji:'H',
                   label:'', lat:null, lng:null, geocoding:false, _idxRef:String(i) });
      return;
    }
    var query = _hotelQuery(h);
    if (!query) return;
    var pin = {
      id:       String(h.id),
      type:     'hotel',
      name:     h.nom,
      sub:      (h.ville || '') + (h.checkin ? ' · ' + h.checkin + (h.checkout ? ' → ' + h.checkout : '') : ''),
      // Ville isolée : le carrousel mobile l'affiche seule et met les dates
      // sur sa propre ligne (_carWhen). sub reste tel quel pour le desktop.
      ville:    (h.ville || ''),
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
    // Localisation explicitement retirée → présent dans la liste mais NON
    // localisé (« Introuvable »), jamais géocodé, aucun marqueur sur la carte.
    if (l.geoOff) {
      _pins.push({ id:String(l.id), type:'lieu', cat:l.categorie||'', name:l.nom, sub:'',
                   ville:(l.ville||''), visited:!!l.visited,
                   emoji:l.emoji||'', label:'', lat:null, lng:null, geocoding:false, _idxRef:String(i) });
      return;
    }
    var query = _lieuQuery(l);
    if (!query) return;
    var alreadyGeocoded = !!(l.lat && l.lng);
    var pin = {
      id:       String(l.id),
      type:     'lieu',
      cat:      l.categorie || '',
      name:     l.nom,
      sub:      (l.ville || '') + (l.visited ? ' · Visité' : ''),
      ville:    (l.ville || ''),
      visited:  !!l.visited,
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
    if (show && _activeDay) show = (_tmapWhen(_tmapCatOf(m.type), m.id).dayKey === _activeDay);
    if (show) _addMarker(m.marker);
    else      _removeMarker(m.marker);
  });

  _routes.forEach(function (r) {
    var showRoute = showR;
    if (showRoute && _activeDay) showRoute = (_tmapWhen('transport', r.id).dayKey === _activeDay);
    r.layers.forEach(function (layer) {
      if (showRoute) layer.addTo(_map);
      else           _map.removeLayer(layer);
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
  // Badge de la pastille « Filtres » : nombre de filtres actifs.
  // État « Tout » (aucun filtre) → pas de badge.
  var badge = document.getElementById('tmap-filter-count');
  if (badge) {
    var n = Object.keys(_activeFilters).filter(function (k) { return _activeFilters[k]; }).length;
    badge.style.display = n > 0 ? '' : 'none';
    badge.textContent = n > 0 ? String(n) : '';
  }
}

// ── Panneau des filtres (pastille « Filtres (n) » en overlay carte) ──
function _closeFilterPanel() {
  var p = document.getElementById('tmap-filter-panel');
  if (p) p.classList.remove('open');
  var b = document.getElementById('tmap-filters-btn');
  if (b) b.setAttribute('aria-expanded', 'false');
}

window.tripmapToggleFilterPanel = function () {
  var p = document.getElementById('tmap-filter-panel');
  if (!p) return;
  var open = p.classList.toggle('open');
  var b = document.getElementById('tmap-filters-btn');
  if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
};

// Fermeture au clic extérieur — phase CAPTURE : Leaflet coupe la
// propagation des clics sur la carte, un listener bubble ne verrait rien.
document.addEventListener('click', function (e) {
  var p = document.getElementById('tmap-filter-panel');
  if (!p || !p.classList.contains('open')) return;
  var t = e.target;
  while (t) {
    if (t === p || (t.id && t.id === 'tmap-filters-btn')) return; // clic interne
    t = t.parentNode;
  }
  _closeFilterPanel();
}, true);

// Fermeture à Échap.
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' || e.keyCode === 27) _closeFilterPanel();
});

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
var _TYPE_LABELS = { vol:'Vol', train:'Train', bus:'Bus', bateau:'Ferry',
                     covoiturage:'Covoit.', metro:'Métro', taxi:'Taxi' };

// Icône SVG colorée d'un type de trajet (réutilise MOB_ICONS/MOB_COLORS au runtime)
function _routeIcon(type){
  var col = (typeof MOB_COLORS!=='undefined' && MOB_COLORS[type]) || '#5C6BC0';
  var svg = (typeof MOB_ICONS!=='undefined' && MOB_ICONS[type]) || '';
  if(!svg && typeof _lu==='function') svg = _lu('map-pin',16);
  return '<span style="display:inline-flex;align-items:center;color:'+col+'">'+svg+'</span>';
}

function _routeCardHtml(r){
  var isVol  = r.type === 'vol';
  var sw     = 'height:2px;width:28px;border-radius:2px;';
  var swatch = isVol
    ? 'background:' + _typeColor(r.type) + ';' + sw
    : 'background:repeating-linear-gradient(90deg,'
      + _typeColor(r.type) + ' 0,'
      + _typeColor(r.type) + ' 8px,transparent 8px,transparent 14px);' + sw;
  var rid = (r.id != null) ? String(r.id).replace(/'/g, "\\'") : '';
  return '<div class="tmap-pin-card"'
    + (rid ? ' onclick="if(window.tripmapFocusRoute)tripmapFocusRoute(\'' + rid + '\')" style="cursor:pointer"' : ' style="cursor:default"')
    + '>'
    + '<div class="tmap-pin-icon" style="background:#f4f4f8;border:none;font-size:13px;font-weight:600">' + _routeIcon(r.type) + '</div>'
    + '<div class="tmap-pin-body">'
      + '<div class="tmap-pin-name">' + r.label + '</div>'
      + '<div class="tmap-pin-sub" style="display:flex;align-items:center;gap:6px;margin-top:3px">'
        + '<span style="' + swatch + '"></span>' + (isVol ? 'Arc géodésique' : 'Tracé pointillé')
      + '</div>'
    + '</div>'
    + (rid ? _infoBtn('transport', rid) : '')
    + '</div>';
}
// Fiche COMPACTE de la liste (tablette/desktop, ≥768px) — chantier 20 :
// « Localisé » et « Maps » ne sont plus affichés en permanence, ils sont
// servis par le bouton « i » (voir _pinGeoInfo / tripmapInfoDetail). La
// fiche du CARROUSEL MOBILE (_carCardHtml) les conserve, elle est distincte.
function _pinCardHtml(p){
  return '<div class="tmap-pin-card" onclick="tripmapFocusPin(\'' + p.id + '\',\'' + p.type + '\')">'
    + (function(){ var _ic=(typeof _pinIcon==="function")?_pinIcon(p):{svg:(p.emoji||""),bg:"#5C6BC0"}; return '<div class="tmap-pin-icon ' + p.type + '" style="background:'+_ic.bg+'1e;color:'+_ic.bg+'">' + _ic.svg + '</div>'; })()
    + '<div class="tmap-pin-body">'
      + '<div class="tmap-pin-name">' + p.name + '</div>'
      + '<div class="tmap-pin-sub">'  + p.sub  + '</div>'
    + '</div>'
    + _infoBtn(p.type === 'hotel' ? 'hotel' : 'lieu', p.id, true)
    + '</div>';
}

// État de localisation + lien Maps d'un point, pour la fenêtre info.
function _pinGeoInfo(p){
  return {
    statusClass: p.geocoding ? 'geocoding' : (p.lat ? 'located' : 'notfound'),
    statusLabel: p.geocoding ? 'Géocodage…' : (p.lat ? 'Localisé' : 'Introuvable'),
    mapsUrl: p.lat
      ? (_isIOS ? 'maps://?ll=' + p.lat + ',' + p.lng + '&q=' + encodeURIComponent(p.name)
                : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.label))
      : null,
    mapsLabel: _isIOS ? 'Ouvrir dans Plans' : 'Ouvrir dans Google Maps'
  };
}

// Ouvre la fiche détail (modale partagée) en y injectant l'état de
// localisation et le lien Maps retirés de la fiche compacte.
window.tripmapInfoDetail = function(cat, id){
  if (typeof openTimelineDetail !== 'function') return;
  var geo = null;
  for (var i = 0; i < _pins.length; i++){
    var p = _pins[i];
    var pcat = (p.type === 'hotel') ? 'hotel' : 'lieu';
    if (pcat === cat && String(p.id) === String(id)) { geo = _pinGeoInfo(p); break; }
  }
  openTimelineDetail(cat, id, geo);
};

// Liste unifiée triée CHRONOLOGIQUEMENT (le plus tôt en haut), filtrée par
// type (Logements/Activités/Itinéraire) et par jour (_activeDay). Les jours
// distincts rencontrés alimentent le sélecteur « par jour ».
function _renderList() {
  var el = document.getElementById('tripmap-list-inner');
  if (!el) return;

  var showH = _showHotels();
  var showL = _showLieux();
  var showR = _showItineraire();

  var entries = [];   // { sortKey, html }
  var days    = {};   // dayKey -> dayLabel (tous jours, indépendamment du filtre)

  if (showR) {
    _routes.forEach(function (r) {
      var w = _tmapWhen('transport', r.id);
      if (w.dayKey) days[w.dayKey] = w.dayLabel;
      if (_activeDay && w.dayKey !== _activeDay) return;
      entries.push({ sortKey: w.sortKey, html: _routeCardHtml(r), kind: 'route', ref: r });
    });
  }

  _pins.forEach(function (p) {
    if (!((p.type === 'hotel' && showH) || (p.type === 'lieu' && showL))) return;
    var w = _tmapWhen(_tmapCatOf(p.type), p.id);
    if (w.dayKey) days[w.dayKey] = w.dayLabel;
    if (_activeDay && w.dayKey !== _activeDay) return;
    entries.push({ sortKey: w.sortKey, html: _pinCardHtml(p), kind: 'pin', ref: p });
  });

  entries.sort(function (a, b) { return a.sortKey - b.sortKey; });

  var html = entries.map(function (e) { return e.html; }).join('');
  el.innerHTML = html || '<div style="text-align:center;padding:20px;color:var(--ink-muted);font-size:13px">'
    + 'Aucun élément dans cette sélection</div>';

  // Carrousel mobile (<768px) : mêmes entrées, même ordre chronologique.
  _renderCarousel(entries);

  _tmapBuildDayFilter(days);
}

// (Re)construit le sélecteur « par jour » à partir des jours rencontrés.
function _tmapBuildDayFilter(days){
  var sel = document.getElementById('tmap-day-filter');
  if (!sel) return;
  var keys = Object.keys(days).sort();
  // Si le jour actif n'existe plus (données modifiées), revenir à « Tous ».
  if (_activeDay && keys.indexOf(_activeDay) === -1) _activeDay = '';
  var html = '<option value="">Tous les jours</option>';
  keys.forEach(function (k) {
    html += '<option value="' + k + '"' + (_activeDay === k ? ' selected' : '') + '>' + days[k] + '</option>';
  });
  sel.innerHTML = html;
  sel.value = _activeDay;
  sel.style.display = keys.length ? '' : 'none';
}

// Changement de jour depuis le sélecteur.
window.tripmapSetDay = function (val) {
  _activeDay = val || '';
  _applyFilters();       // masque marqueurs/routes hors jour + reconstruit la liste
  if (typeof tripmapRecenter === 'function') { try { tripmapRecenter(); } catch (e) {} }
};

// Petit bouton « info » : ouvre la fiche détail de l'activité (modale),
// même comportement que le planning. stopPropagation pour ne pas
// déclencher le recentrage de la carte.
// withGeo=true (liste desktop) → passe par tripmapInfoDetail, qui ajoute
// l'état « Localisé » et le lien Maps dans la fenêtre.
function _infoBtn(cat, id, withGeo) {
  var sid = String(id).replace(/'/g, "\\'");
  var call = withGeo
    ? 'if(window.tripmapInfoDetail)tripmapInfoDetail(\'' + cat + '\',\'' + sid + '\')'
    : 'if(window.openTimelineDetail)openTimelineDetail(\'' + cat + '\',\'' + sid + '\')';
  return '<button class="tmap-info-btn" title="Voir les informations" '
    + 'onclick="event.stopPropagation();' + call + '">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" width="15" height="15">'
    + '<circle cx="12" cy="12" r="9"/><line x1="11.5" y1="11" x2="12.5" y2="11"/>'
    + '<line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="7.8" r="0.5" fill="currentColor"/></svg>'
    + '</button>';
}

// ── §9bis CARROUSEL MOBILE (<768px) — chantier A3 ─────────────────────
// Rangée horizontale de fiches scroll-snap en bas de la carte, alimentée
// par _renderList (mêmes entrées, même ordre chronologique, mêmes filtres).
// Synchro bidirectionnelle par couple (type, id) :
//   fiche centrée → pan animé, pin dans la moitié SUPÉRIEURE visible
//   (au-dessus du carrousel), marqueur agrandi (transform) + popup ;
//   tap sur un pin → le carrousel défile jusqu'à la fiche.
// Option A (arbitrage Kylian) : une fiche TRANSPORT cadre son TRACÉ
// (arc/pointillé, paddé au-dessus du carrousel) ; une fiche sans aucune
// géométrie (« Introuvable », geoOff) laisse la carte immobile.
var _carItems   = [];    // [{kind:'pin'|'route', type, id, name, sub, icon, status, statusClass}]
var _carIdx     = -1;    // index de la fiche actuellement centrée
var _carSquelch = false; // vrai pendant un rebuild → ignore le scroll induit
var _selMarker  = null;  // marqueur en état « sélectionné »

// Le carrousel n'existe visuellement qu'en mobile <768px (CSS).
function _carActive() {
  var el = document.getElementById('tmap-carousel');
  return !!(el && el.offsetParent !== null);
}
function _carHeight() {
  var el = document.getElementById('tmap-carousel');
  return (el && el.offsetParent !== null) ? el.offsetHeight : 0;
}
// Publie la hauteur réelle du carrousel (variable CSS) : les contrôles
// flottants et l'attribution Leaflet se placent AU-DESSUS via ce décalage.
// Posée sur le wrap ET l'hôte (ceinture-bretelles : tous les lecteurs
// de la variable sont couverts quel que soit leur point d'ancrage).
function _carMeasure() {
  var h = _carHeight() + 'px';
  var wrap = document.getElementById('tripmap-wrap');
  var host = document.getElementById('voyage-map-host');
  if (wrap && wrap.style && wrap.style.setProperty) wrap.style.setProperty('--tmap-car-h', h);
  if (host && host.style && host.style.setProperty) host.style.setProperty('--tmap-car-h', h);
}

function _carPinIconHtml(p) {
  var ic = (typeof _pinIcon === 'function') ? _pinIcon(p) : { svg: (p.emoji || ''), bg: '#5C6BC0' };
  return '<div class="tmap-pin-icon ' + p.type + '" style="background:' + ic.bg + '1e;color:' + ic.bg + '">' + ic.svg + '</div>';
}

// ── Libellé temporel des fiches du CARROUSEL (mobile <768px) ─────────
// Ces helpers ne servent QU'au carrousel : la fiche desktop (_pinCardHtml /
// _routeCardHtml) n'est pas touchée, et pin.sub — qu'elle affiche — reste
// tel quel.
// Le PARSING est délégué aux helpers existants : _hotelDateObj (le seul qui
// gère le legacy « JJ mois », piège §5.10) pour les hôtels, parseDDMMYYYY
// pour le reste. Le formatage réutilise _TMAP_JOURS/_TMAP_MOIS, déjà employés
// par le filtre « par jour » — mêmes libellés que MOIS_SHORT.
function _carDayObj(cat, raw) {
  if (!raw) return null;
  var d = (cat === 'hotel' && typeof _hotelDateObj === 'function') ? _hotelDateObj(raw)
        : (typeof parseDDMMYYYY === 'function') ? parseDDMMYYYY(raw)
        : null;
  return (d && !isNaN(d.getTime())) ? d : null;
}
function _carFmtDay(d, withWeekday) {
  if (!d) return '';
  return (withWeekday ? _TMAP_JOURS[d.getDay()] + ' ' : '') + d.getDate() + ' ' + _TMAP_MOIS[d.getMonth()];
}
// « 9:00 » / « 09h00 » → « 09:00 ». Format HH:MM, aligné sur le Planning.
function _carFmtHeure(h) {
  var s = String(h == null ? '' : h);
  var m = s.match(/^(\d{1,2})\s*[:hH]\s*(\d{2})/);
  if (m) return _tmapPad2(+m[1]) + ':' + m[2];
  var m2 = s.match(/^(\d{1,2})\s*[hH]\s*$/);
  if (m2) return _tmapPad2(+m2[1]) + ':00';
  return '';
}
// cat: 'transport' | 'hotel' | 'lieu'. '' si aucune date → aucune ligne rendue
// (jamais de ligne vide). Indépendant de la géoloc : un élément « Non situé »
// affiche son horaire comme les autres.
function _carWhen(cat, id) {
  var arr = cat === 'transport' ? ((typeof mobilites !== 'undefined') ? mobilites : [])
          : cat === 'hotel'     ? ((typeof hotels    !== 'undefined') ? hotels    : [])
          :                       ((typeof lieux     !== 'undefined') ? lieux     : []);
  var it = null, i;
  for (i = 0; i < arr.length; i++) { if (String(arr[i].id) === String(id)) { it = arr[i]; break; } }
  if (!it) return '';

  if (cat === 'transport') {
    var dt = _carDayObj('transport', it.date), ht = _carFmtHeure(it.heureDep);
    if (!dt) return ht;                       // heure seule si la date manque
    return _carFmtDay(dt, true) + (ht ? '  ·  ' + ht : '');
  }
  if (cat === 'hotel') {
    // Séjour = une PLAGE, pas un horaire : « 22 → 24 juil. » quand les deux
    // bornes sont dans le même mois, « 30 juil. → 2 août » sinon.
    var ci = _carDayObj('hotel', it.checkin), co = _carDayObj('hotel', it.checkout);
    if (!ci && !co) return '';
    if (ci && co) {
      return (ci.getMonth() === co.getMonth() && ci.getFullYear() === co.getFullYear())
        ? ci.getDate() + ' → ' + _carFmtDay(co, false)
        : _carFmtDay(ci, false) + ' → ' + _carFmtDay(co, false);
    }
    return _carFmtDay(ci || co, false);
  }
  // Lieu : date de visite seulement si renseignée, + heure d'ouverture si dispo.
  var dl = _carDayObj('lieu', it.dateVisite);
  if (!dl) return '';
  var hl = _carFmtHeure(it.ouverture);
  return _carFmtDay(dl, true) + (hl ? '  ·  ' + hl : '');
}
function _carWhenHtml(cat, id) {
  var w = _carWhen(cat, id);
  return w ? '<div class="tmap-car-when">' + w + '</div>' : '';
}
// Composition du sous-titre — SOURCE UNIQUE partagée par les fiches du
// carrousel ET les lignes de la liste de saut, pour qu'un même élément
// n'affiche jamais deux libellés différents selon l'entrée.
// Pin : la VILLE seule (les dates vont sur la ligne _carWhen).
function _carSubOfPin(p) {
  return (p.ville != null ? p.ville : p.sub) + (p.visited ? '  ·  Visité' : '');
}
function _carSubOfRoute(r) {
  return (r.type === 'vol') ? 'Arc géodésique' : 'Tracé pointillé';
}

function _carPinCard(p, i) {
  var statusClass = p.geocoding ? 'geocoding' : (p.lat ? 'located' : 'notfound');
  var statusLabel = p.geocoding ? 'Géocodage…' : (p.lat ? 'Localisé' : 'Introuvable');
  // Sous-titre du carrousel : la VILLE seule. Les dates du séjour, que
  // pin.sub concaténait en brut (« Kyoto · 22/07/2026 → 24/07/2026 »),
  // passent sur la ligne _carWhen au format de l'app. pin.sub reste intact
  // pour la fiche desktop, qui n'a pas cette ligne.
  var carSub = _carSubOfPin(p);
  var mapsUrl = p.lat
    ? (_isIOS ? 'maps://?ll=' + p.lat + ',' + p.lng + '&q=' + encodeURIComponent(p.name)
              : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.label))
    : null;
  return '<div class="tmap-car-card" data-idx="' + i + '" onclick="tripmapCarTap(' + i + ')">'
    + '<div class="tmap-car-top">'
    +   _carPinIconHtml(p)
    +   '<div class="tmap-car-body">'
    +     '<div class="tmap-car-name">' + p.name + '</div>'
    +     (carSub ? '<div class="tmap-car-sub">' + carSub + '</div>' : '')
    +     _carWhenHtml(_tmapCatOf(p.type), p.id)
    +   '</div>'
    +   _infoBtn(p.type === 'hotel' ? 'hotel' : 'lieu', p.id)
    + '</div>'
    + '<div class="tmap-car-foot">'
    +   '<span class="tmap-pin-status ' + statusClass + '">' + statusLabel + '</span>'
    +   (mapsUrl ? '<a class="tmap-pin-open-btn" href="' + mapsUrl + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">' + (_isIOS ? 'Plans' : 'Maps') + '</a>' : '')
    + '</div></div>';
}

function _carRouteCard(r, i) {
  var rid = (r.id != null) ? String(r.id).replace(/'/g, "\\'") : '';
  return '<div class="tmap-car-card" data-idx="' + i + '" onclick="tripmapCarTap(' + i + ')">'
    + '<div class="tmap-car-top">'
    +   '<div class="tmap-pin-icon" style="background:var(--surface-2)">' + _routeIcon(r.type) + '</div>'
    +   '<div class="tmap-car-body">'
    +     '<div class="tmap-car-name">' + r.label + '</div>'
    +     '<div class="tmap-car-sub">' + _carSubOfRoute(r) + '</div>'
    +     (rid ? _carWhenHtml('transport', r.id) : '')
    +   '</div>'
    +   (rid ? _infoBtn('transport', rid) : '')
    + '</div>'
    + '<div class="tmap-car-foot">'
    +   '<span class="tmap-pin-status route">Non situé</span>'
    + '</div></div>';
}

// (Re)construit le carrousel à partir des entrées TRIÉES de _renderList.
function _renderCarousel(entries) {
  var track = document.getElementById('tmap-carousel-track');
  if (!track) return;
  _carItems = [];
  var html = '';
  entries.forEach(function (e, i) {
    if (e.kind === 'route') {
      var r = e.ref;
      _carItems.push({ kind: 'route', type: 'transport', id: String(r.id), name: r.label,
                       sub: _carSubOfRoute(r), when: _carWhen('transport', r.id),
                       icon: _routeIcon(r.type), status: 'Non situé', statusClass: 'route' });
      html += _carRouteCard(r, i);
    } else {
      var p = e.ref;
      _carItems.push({ kind: 'pin', type: p.type, id: p.id, name: p.name,
                       sub: _carSubOfPin(p), when: _carWhen(_tmapCatOf(p.type), p.id),
                       icon: _carPinIconHtml(p),
                       status: p.geocoding ? 'Géocodage…' : (p.lat ? 'Localisé' : 'Introuvable'),
                       statusClass: p.geocoding ? 'geocoding' : (p.lat ? 'located' : 'notfound') });
      html += _carPinCard(p, i);
    }
  });
  _carSquelch = true;                 // le reset de scroll ne doit pas déclencher de pan
  track.innerHTML = html || '<div class="tmap-car-empty">Aucun élément dans cette sélection</div>';
  track.scrollLeft = 0;
  _carIdx = _carItems.length ? 0 : -1;
  _carHighlight(_carIdx);             // compteur + surbrillance, SANS bouger la carte
  _carMeasure();
  setTimeout(function () { _carSquelch = false; }, 260);
}

// Désélectionne le marqueur courant (échelle normale, popup fermé).
function _carDeselect() {
  if (!_selMarker) return;
  if (_selMarker._icon && _selMarker._icon.classList) _selMarker._icon.classList.remove('tmap-sel');
  if (_selMarker.setZIndexOffset) _selMarker.setZIndexOffset(0);
  if (_selMarker.closePopup) { try { _selMarker.closePopup(); } catch (e) {} }
  _selMarker = null;
}

// Surbrillance fiche + compteur « n / total » (aucun mouvement de carte).
function _carHighlight(idx) {
  _carDeselect();
  var track = document.getElementById('tmap-carousel-track');
  if (track) {
    var cards = track.querySelectorAll('.tmap-car-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].classList.toggle('active', i === idx);
    }
  }
  var cnt = document.getElementById('tmap-carousel-count');
  if (cnt) {
    var pill = cnt.querySelector('.tcc-pill');
    if (pill) pill.textContent = _carItems.length ? ((idx >= 0 ? idx + 1 : 1) + ' / ' + _carItems.length) : '';
    cnt.style.display = _carItems.length ? '' : 'none';
  }
}

// Applique la sélection : surbrillance + synchro carte (Option A).
function _carApply(idx, moveMap) {
  _carHighlight(idx);
  if (!moveMap || idx < 0 || !_map) return;
  var it = _carItems[idx];
  if (!it) return;
  var ch = _carHeight();

  if (it.kind === 'route') {
    // Option A : cadrer le TRACÉ du transport, paddé au-dessus du carrousel.
    var route = _routes.filter(function (r) { return String(r.id) === it.id; })[0];
    if (!route || !route.layers || !route.layers.length) return;
    var bounds = null;
    route.layers.forEach(function (ly) {
      if (ly && ly.getBounds) { bounds = bounds ? bounds.extend(ly.getBounds()) : ly.getBounds(); }
    });
    if (bounds && bounds.isValid()) {
      _map.fitBounds(bounds, { paddingTopLeft: [40, 70], paddingBottomRight: [40, ch + 30], maxZoom: 7, animate: true });
    }
    return;
  }

  var pin = _pins.filter(function (p) { return p.id === it.id && p.type === it.type; })[0];
  // Fiche sans géométrie (« Introuvable », geoOff) : pas de marqueur → la carte
  // reste en place. Les « Non situé » restent dans le carrousel (appariement par
  // couple type/id, jamais par index) et n'entrent pas dans le regroupement.
  if (!pin || !pin.marker || pin.lat == null) return;

  // Pin ABSORBÉ dans un cluster → le RÉVÉLER d'abord (zoomToShowLayer éclate le
  // groupe / éventaille), PUIS focaliser dans le callback. Sinon focus direct.
  var revealed = !_cluster ? true
    : (function () { var vp = _cluster.getVisibleParent(pin.marker); return (vp === pin.marker); })();
  if (revealed) {
    _carFocusPin(pin, ch);
  } else {
    _cluster.zoomToShowLayer(pin.marker, function () { _carFocusPin(pin, ch); });
  }
}

// Focalise un pin déjà VISIBLE (dé-clusterisé) : flyTo au niveau quartier avec
// décalage moitié-haute, marqueur sélectionné, popup ouvert à la FIN du vol
// (moveend — remplace le setTimeout fixe : robuste quel que soit l'itinéraire,
// y compris après une révélation de cluster).
function _carFocusPin(pin, ch) {
  if (!_map || !pin || !pin.marker) return;
  // Zoom RAPPROCHÉ animé (flyTo : pan+zoom doux) au niveau quartier (15), sans
  // redescendre si déjà plus zoomé ; pin décalé dans la moitié supérieure
  // visible (centre - ch/2, projeté au zoom CIBLE).
  var z  = Math.max(_map.getZoom(), 15);
  var pt = _map.project([pin.lat, pin.lng], z).add([0, ch / 2]);

  // État sélectionné : agrandi (transform sur le div INTERNE du divIcon —
  // Leaflet pose son propre transform inline sur _icon, ne pas y toucher).
  _selMarker = pin.marker;
  if (_selMarker._icon && _selMarker._icon.classList) _selMarker._icon.classList.add('tmap-sel');
  if (_selMarker.setZIndexOffset) _selMarker.setZIndexOffset(1000);
  var pop = pin.marker.getPopup ? pin.marker.getPopup() : null;
  if (pop) {
    pop.options.autoPanPaddingTopLeft    = L.point(12, 64);
    pop.options.autoPanPaddingBottomLeft = L.point(12, ch + 14);
  }
  // Popup à la fin du vol (son autoPan combattrait un vol en cours).
  _map.once('moveend', function () {
    if (_selMarker === pin.marker && _map && _map.hasLayer(pin.marker)) {
      try { pin.marker.openPopup(); } catch (e) {}
    }
  });
  _map.flyTo(_map.unproject(pt, z), z, { duration: 0.9 });
}

// Fiche la plus proche du centre du viewport du carrousel.
function _carNearest(track) {
  var cards = track.querySelectorAll('.tmap-car-card');
  if (!cards.length) return -1;
  var center = track.scrollLeft + track.clientWidth / 2;
  var best = -1, bestDist = Infinity;
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    var d = Math.abs((c.offsetLeft + c.offsetWidth / 2) - center);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

// Fait défiler le carrousel jusqu'à la fiche i (le listener scroll fera
// la synchro carte au settle) ; re-tap sur la fiche centrée → re-synchro.
function _carGoTo(i) {
  var track = document.getElementById('tmap-carousel-track');
  if (!track) return;
  var card = track.querySelector('.tmap-car-card[data-idx="' + i + '"]');
  if (!card) return;
  if (i === _carIdx) { _carApply(i, true); return; }
  var left = card.offsetLeft - (track.clientWidth - card.offsetWidth) / 2;
  if (track.scrollTo) track.scrollTo({ left: left, behavior: 'smooth' });
  else track.scrollLeft = left;
}

// Tap direct sur une fiche du carrousel.
window.tripmapCarTap = function (i) { _carGoTo(i); };

// Saut depuis la liste verticale (modale) — index numérique, pas d'id
// interpolé (piège §5.1 sans objet ici).
window.tripmapJumpTo = function (i) {
  if (typeof closeModal === 'function') closeModal();
  _carGoTo(i);
};

// Compteur « n / total » tappé → liste verticale complète (modale partagée
// openModal/closeModal d'app.js) pour sauter sans enchaîner les swipes.
window.tripmapOpenJumpList = function () {
  if (typeof openModal !== 'function' || !_carItems.length) return;
  var esc = (typeof _tlEsc === 'function') ? _tlEsc : function (s) { return String(s == null ? '' : s); };
  var rows = _carItems.map(function (it, i) {
    return '<button type="button" class="tmap-jump-row' + (i === _carIdx ? ' active' : '') + '" onclick="tripmapJumpTo(' + i + ')">'
      + '<span class="tjr-icon">' + it.icon + '</span>'
      + '<span class="tjr-body">'
      +   '<span class="tjr-name">' + esc(it.name) + '</span>'
      +   (it.sub  ? '<span class="tjr-sub">'  + esc(it.sub)  + '</span>' : '')
      +   (it.when ? '<span class="tjr-when">' + esc(it.when) + '</span>' : '')
      + '</span>'
      + '<span class="tmap-pin-status ' + it.statusClass + '">' + it.status + '</span>'
      + '</button>';
  }).join('');
  openModal('<div class="tmap-jump">'
    + '<div class="tmap-jump-title">Éléments de la carte (' + _carItems.length + ')</div>'
    + '<div class="tmap-jump-list">' + rows + '</div>'
    + '</div>');
};

// Scroll-snap settle → synchro carte. Debounce 150 ms après le dernier
// événement scroll (pas de scrollend : support trop récent).
(function _initCarouselSync() {
  function init() {
    var track = document.getElementById('tmap-carousel-track');
    if (!track) return;
    var timer = null;
    track.addEventListener('scroll', function () {
      if (_carSquelch) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        if (_carSquelch || !_carActive()) return;
        var idx = _carNearest(track);
        if (idx !== -1 && idx !== _carIdx) { _carIdx = idx; _carApply(idx, true); }
      }, 150);
    }, { passive: true });
    window.addEventListener('resize', _carMeasure);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

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

// Bascule carte vrai plein écran (overlay) <-> format normal
window.tripmapToggleFull = function () {
  var host = document.getElementById('voyage-map-host');
  if (!host) return;
  host.classList.toggle('is-fullscreen');
  setTimeout(function () {
    if (_map && _map.invalidateSize) _map.invalidateSize();
    if (typeof _applyMinZoom === 'function') _applyMinZoom();   // le conteneur a changé de taille
    if (typeof tripmapRecenter === 'function') { try { tripmapRecenter(); } catch(e){} }
  }, 240);
};


// ── §10 FOCUS, RECENTRAGE, GPS ────────────────────────────────────────

window.tripmapFocusPin = function (id, type) {
  var pin = _pins.find(function (p) { return p.id === id && p.type === type; });
  if (!pin || !pin.marker || !pin.lat) return;
  // Mobile <768 : converger vers le flux carrousel (défilement jusqu'à la
  // fiche → pan décalé + marqueur sélectionné), pour que pin et fiche
  // restent toujours synchrones quel que soit le point d'entrée.
  if (_carActive()) {
    for (var i = 0; i < _carItems.length; i++) {
      if (_carItems[i].kind === 'pin' && _carItems[i].type === type && _carItems[i].id === id) {
        _carGoTo(i);
        return;
      }
    }
  }
  // Desktop (ou mobile hors carrousel) : si le pin est absorbé dans un cluster,
  // le RÉVÉLER via l'API dédiée (évite la course setView→openPopup où le
  // marqueur n'est pas encore matérialisé), puis ouvrir le popup.
  if (_cluster && _cluster.getVisibleParent(pin.marker) !== pin.marker) {
    _cluster.zoomToShowLayer(pin.marker, function () {
      try { pin.marker.openPopup(); } catch (e) {}
    });
    return;
  }
  _map.setView([pin.lat, pin.lng], 15, { animate: true });
  pin.marker.openPopup();
};

var tripmapRecenter = function () {
  if (!_map) return;
  var allPts = [];

  // CADRAGE = uniquement les marqueurs d'HÉBERGEMENTS et de LIEUX. Les arcs de
  // vol et trajets de train (_routes) restent VISIBLES mais n'entrent JAMAIS
  // dans le calcul des bounds — sinon Paris→Tokyo étire la vue sur toute
  // l'Eurasie. On ignore aussi le filtre de type (Tout/Logements/Activités/
  // Itinéraire) : le cadrage porte toujours sur hôtels+lieux, même si le filtre
  // « Itinéraire » masque leurs marqueurs. Seul le filtre par JOUR restreint.
  _markers.forEach(function (m) {
    if (m.type !== 'hotel' && m.type !== 'lieu') return; // jamais une route
    if (m.lat == null) return;
    if (_activeDay && _tmapWhen(_tmapCatOf(m.type), m.id).dayKey !== _activeDay) return;
    allPts.push([m.lat, m.lng]);
  });

  // Fallback inchangé : zéro hôtel/lieu géolocalisé → centrer sur le pays.
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

  // Un seul point → zoom ville (maxZoom raisonnable, pas de zoom excessif).
  if (allPts.length === 1) { _map.setView(allPts[0], 13); return; }
  try {
    _map.fitBounds(L.latLngBounds(allPts), { padding: [40, 40], maxZoom: 13 });
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
      minZoom: 1,          // relevé dynamiquement par _applyMinZoom (taille conteneur)
      maxZoom: 19,
      zoomControl: true,
      attributionControl: true,
      // Bornes du monde : plus de pan hors zone cartographiée ni de bande
      // grise au-delà de ±85° (viscosity 1 = butée franche, pas d'élastique).
      maxBounds: [[-85, -180], [85, 180]],
      maxBoundsViscosity: 1.0,
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
    window.addEventListener('resize', _applyMinZoom);
  }

  setTimeout(function () {
    _map.invalidateSize();
    _applyMinZoom();
    _loadTripPoints();
    // Recentrage à CHAQUE montage (chaque arrivée sur la carte), pas seulement
    // au 1er chargement : _loadTripPoints ne recentre que s'il y a du géocodage
    // en attente, donc une carte déjà en cache ne bougeait plus.
    setTimeout(function () { if (typeof tripmapRecenter === 'function') { try { tripmapRecenter(); } catch (e) {} } }, 260);
  }, 120);
};

// Zoom minimum tel que le monde COUVRE toujours le conteneur (jamais de
// bande grise, quelle que soit la taille d'écran) : le monde fait
// 256·2^z px de côté → z ≥ log2(taille/256). Recalculé à chaque
// invalidateSize (montage, plein écran) et au resize. Les fitBounds
// (tripmapRecenter, arcs) sont automatiquement CLAMPÉS à ce minimum par
// Leaflet — le cadrage hôtels/lieux (§5.9) continue de fonctionner.
function _applyMinZoom() {
  if (!_map) return;
  var sz;
  try { sz = _map.getSize(); } catch (e) { return; }
  if (!sz || !sz.x || !sz.y) return;
  var need = Math.max(sz.x, sz.y);
  var mz = Math.max(1, Math.ceil(Math.log(need / 256) / Math.LN2));
  _map.setMinZoom(mz);
  if (_map.getZoom() < mz) _map.setZoom(mz);
}


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
  _markers.forEach(function (m) { _removeMarker(m.marker); });
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
  _markers.forEach(function (m) { _removeMarker(m.marker); });
  _markers = [];
  _pins    = [];
  _clearRoutes();
  setTimeout(function () {
    _map.invalidateSize();
    _loadTripPoints();
  }, 150);
});

// ── §14 VOLET REDIMENSIONNABLE (desktop) ──────────────────────────────
// Poignée verticale entre le volet infos (gauche) et la carte (droite).
// Pilote la variable CSS --tmap-panel-w sur #voyage-map-host, persistée.
(function initTripmapResizer(){
  function init(){
    var host = document.getElementById('voyage-map-host');
    var rez  = document.getElementById('tripmap-resizer');
    if(!host || !rez || rez._wired) return;
    rez._wired = true;
    try { var saved = localStorage.getItem('yume_tmap_panel_w');
      if(saved) host.style.setProperty('--tmap-panel-w', saved); } catch(e){}
    var dragging = false;
    function onMove(clientX){
      var rect = host.getBoundingClientRect();
      var w = clientX - rect.left;
      var maxW = Math.max(260, rect.width - 340); // laisse ≥340px à la carte
      w = Math.max(210, Math.min(w, Math.min(640, maxW)));
      host.style.setProperty('--tmap-panel-w', w + 'px');
    }
    function start(e){
      dragging = true; rez.classList.add('dragging');
      document.body.style.userSelect = 'none';
      if(e.preventDefault) e.preventDefault();
    }
    function end(){
      if(!dragging) return;
      dragging = false; rez.classList.remove('dragging');
      document.body.style.userSelect = '';
      try { localStorage.setItem('yume_tmap_panel_w', host.style.getPropertyValue('--tmap-panel-w')); } catch(e){}
      if (_map && _map.invalidateSize) _map.invalidateSize();
    }
    rez.addEventListener('mousedown', start);
    document.addEventListener('mousemove', function(e){ if(dragging) onMove(e.clientX); });
    document.addEventListener('mouseup', end);
    rez.addEventListener('touchstart', function(e){ start(e); }, { passive:false });
    document.addEventListener('touchmove', function(e){
      if(dragging && e.touches && e.touches[0]){ onMove(e.touches[0].clientX); if(e.preventDefault) e.preventDefault(); }
    }, { passive:false });
    document.addEventListener('touchend', end);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

})(); // fin IIFE map-trip
