// ══════════════════════════════════════════════════════════════════════
// map-world.js — Carte monde interactive (GeoJSON + sélection pays)
// Yume Travel Manager · Phase A · Modularisation
//
// RESPONSABILITÉS
//   - Charger Leaflet (loader CDN unique — aucun autre module ne le fait)
//   - Afficher la carte monde avec frontières pays (GeoJSON)
//   - Gérer la sélection / visite / destination de pays par voyage
//   - Synchroniser les couleurs quand le voyage actif change
//
// DÉPENDANCES  : state.js (YumeState, allTrips, currentTripId, snapshotCurrentTrip)
// EXPOSE       : window.initLeafletMap, window.refreshAllCountryColors,
//                window.focusCountry, window.resetMapView, window.searchCountry,
//                window.setDestCountry, window.toggleVisited,
//                window.addSelected, window.removeSelected,
//                window.isoToFlag
//
// ABONNEMENTS  : YumeState.on('trip:changed') → refreshAllCountryColors()
// ══════════════════════════════════════════════════════════════════════

(function () {
'use strict';

// ── §1 ÉTAT PRIVÉ ─────────────────────────────────────────────────────
var _map         = null;   // instance L.map
var _geojson     = null;   // L.geoJSON layer
var _geojsonData = null;   // FeatureCollection brut
var _initDone    = false;  // créée une seule fois
var _clickedISO  = null;   // dernier pays cliqué
var _clickedName = null;

// ── §2 PALETTE DE COULEURS ────────────────────────────────────────────
var C_DEFAULT  = '#c8dff0';
var C_HOVER    = '#f4c842';
var C_DEST     = '#e8748a';
var C_VISITED  = '#2d8c6b';
var S_DEFAULT  = '#7aaac8';
var S_HOVER    = '#c9921a';
var S_SEL      = '#c4546e';


// ── §3 LOADER LEAFLET (authorité unique) ──────────────────────────────
// Un seul module charge Leaflet. map-trip.js attend que L soit défini.
// Trois CDN en cascade + message d'erreur gracieux si tous échouent.
// ─────────────────────────────────────────────────────────────────────
(function _loadLeaflet() {
  if (typeof L !== 'undefined') return; // déjà chargé

  var CDNS = [
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js'
  ];

  function tryNext(idx) {
    if (idx >= CDNS.length) {
      console.error('[map-world] Leaflet: tous les CDN ont échoué.');
      _showLeafletError('leaflet-map');
      _showLeafletError('tripmap-leaflet');
      return;
    }
    var s = document.createElement('script');
    s.src = CDNS[idx];
    s.onload  = function () {
      // Leaflet chargé — init déclenchée par showTab() dans app.js
    };
    s.onerror = function () { tryNext(idx + 1); };
    document.head.appendChild(s);
  }
  tryNext(0);
})();

function _showLeafletError(containerId) {
  var el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;'
    + 'height:100%;flex-direction:column;gap:10px;color:#5a5a72;padding:24px;text-align:center">'
    + '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">'
    + '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="1" fill="currentColor"/>'
    + '</svg>'
    + '<div style="font-size:14px;font-weight:500">Carte non disponible</div>'
    + '<div style="font-size:12px">Connexion internet requise pour charger les tuiles.</div>'
    + '</div>';
}


// ── §4 UTILITAIRE : emoji drapeau depuis ISO 3166-1 alpha-2 ──────────
// Exposé sur window car utilisé par app.js (badges de pays).
// ─────────────────────────────────────────────────────────────────────
function isoToFlag(iso) {
  if (!iso || iso.length !== 2) return '';
  try {
    return String.fromCodePoint(
      0x1F1E6 + (iso.toUpperCase().charCodeAt(0) - 65),
      0x1F1E6 + (iso.toUpperCase().charCodeAt(1) - 65)
    );
  } catch (e) { return ''; }
}
window.isoToFlag = isoToFlag;


// ── §5 DONNÉES MAPDATA PAR VOYAGE ─────────────────────────────────────
// Stockées dans allTrips[tid].mapData (persistées avec le voyage).
// ─────────────────────────────────────────────────────────────────────
function _getMapData() {
  if (!currentTripId || !allTrips[currentTripId]) return null;
  if (!allTrips[currentTripId].mapData) {
    allTrips[currentTripId].mapData = {
      selectedCountries: [],
      visitedCountries:  [],
      countryNames:      {},
      destCountry:       null
    };
  }
  return allTrips[currentTripId].mapData;
}


// ── §6 STYLES PAYS ────────────────────────────────────────────────────
function _getCountryStyle(iso) {
  var md = _getMapData();
  var isVisited  = md && (md.visitedCountries  || []).indexOf(iso) !== -1;
  var isDest     = md && md.destCountry === iso;
  var isSelected = md && (md.selectedCountries || []).indexOf(iso) !== -1;

  if (isDest)     return { fillColor: C_DEST,    fillOpacity: 0.75, color: S_SEL,     weight: 2   };
  if (isVisited)  return { fillColor: C_VISITED, fillOpacity: 0.65, color: '#1a6b50', weight: 1.5 };
  if (isSelected) return { fillColor: '#b5a8e0', fillOpacity: 0.65, color: '#7c5cbf', weight: 1.5 };
  return              { fillColor: C_DEFAULT, fillOpacity: 0.6,  color: S_DEFAULT, weight: 1   };
}

function refreshAllCountryColors() {
  if (!_geojson) return;
  _geojson.eachLayer(function (layer) {
    var iso = layer.feature.properties.iso_a2 || layer.feature.properties.name;
    layer.setStyle(_getCountryStyle(iso));
  });
}
window.refreshAllCountryColors = refreshAllCountryColors;


// ── §7 PANNEAU PAYS (info + actions) ─────────────────────────────────
function _updateCountryPanel(iso, name) {
  var el = document.getElementById('lmap-country-panel');
  if (!el) return;

  if (!iso) {
    el.innerHTML = '<span class="lmap-country-none">Clique sur un pays pour le sélectionner</span>';
    return;
  }

  var md        = _getMapData() || {};
  var isVisited = (md.visitedCountries  || []).indexOf(iso) !== -1;
  var isDest    = md.destCountry === iso;
  var isSelected = (md.selectedCountries || []).indexOf(iso) !== -1;
  var flag      = isoToFlag(iso);
  var safeIso   = iso.replace(/'/g, '');
  var safeName  = (name || '').replace(/'/g, '').replace(/"/g, '');

  el.innerHTML =
    '<div class="lmap-country-flag">' + flag + '</div>'
  + '<div class="lmap-country-name">' + (name || iso) + '</div>'
  + '<div class="lmap-country-actions">'
    + '<button class="lmap-country-badge add-dest" '
      + 'onclick="setDestCountry(\'' + safeIso + '\',\'' + safeName + '\')">'
      + (isDest ? '★ Destination' : 'Destination')
    + '</button>'
    + '<button class="lmap-country-badge visited" '
      + 'onclick="toggleVisited(\'' + safeIso + '\',\'' + safeName + '\')">'
      + (isVisited ? '✓ Visité' : 'Visité')
    + '</button>'
    + (isSelected
      ? '<button class="lmap-country-badge" '
          + 'style="background:var(--surface-3);color:var(--ink-muted);border-color:var(--border)" '
          + 'onclick="removeSelected(\'' + safeIso + '\')">✕ Retirer</button>'
      : '<button class="lmap-country-badge" '
          + 'style="background:#f0ecf8;color:#7c5cbf;border-color:#c5b8e8" '
          + 'onclick="addSelected(\'' + safeIso + '\',\'' + safeName + '\')">+ Ajouter</button>'
    )
  + '</div>';
}


// ── §8 LISTE DES PAYS SÉLECTIONNÉS ───────────────────────────────────
function _renderSelectedCountries() {
  var el = document.getElementById('lmap-selected-grid');
  if (!el) return;

  var md      = _getMapData();
  var list    = md ? (md.selectedCountries || []) : [];
  var names   = (md && md.countryNames) || {};
  var dest    = md ? md.destCountry : null;
  var visited = md ? (md.visitedCountries || []) : [];

  if (!list.length) {
    el.innerHTML = '<span style="font-size:13px;color:var(--ink-muted);font-style:italic">Aucun pays sélectionné</span>';
    return;
  }

  el.innerHTML = list.map(function (iso) {
    var name  = names[iso] || iso;
    var flag  = isoToFlag(iso);
    var isD   = dest === iso;
    var isV   = visited.indexOf(iso) !== -1;
    var extra = isD ? ' ★' : (isV ? ' ✓' : '');
    var style = isD
      ? 'border-color:var(--sakura);background:var(--sakura-light)'
      : (isV ? 'border-color:#2d8c6b;background:#e4f5ec' : '');

    return '<span class="lmap-selected-tag" style="' + style + '" data-iso="' + iso + '">'
      + flag + ' ' + name + extra
      + '<button class="tag-del" data-del-iso="' + iso + '">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">'
          + '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
        + '</svg>'
      + '</button>'
    + '</span>';
  }).join('');

  // Délégation d'événements (évite les pièges des onclick inline)
  el.querySelectorAll('.lmap-selected-tag').forEach(function (tag) {
    tag.addEventListener('click', function () {
      focusCountry(this.getAttribute('data-iso'));
    });
  });
  el.querySelectorAll('.tag-del').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      removeSelected(this.getAttribute('data-del-iso'));
    });
  });
}


// ── §9 ACTIONS SUR LES PAYS (exposées sur window) ────────────────────

function setDestCountry(iso, name) {
  var md = _getMapData(); if (!md) return;
  md.destCountry = (md.destCountry === iso) ? null : iso;
  if (md.destCountry && (md.selectedCountries || []).indexOf(iso) === -1) {
    md.selectedCountries = md.selectedCountries || [];
    md.selectedCountries.push(iso);
    md.countryNames = md.countryNames || {};
    md.countryNames[iso] = name;
  }
  refreshAllCountryColors();
  _updateCountryPanel(iso, name);
  _renderSelectedCountries();
  snapshotCurrentTrip();
}
window.setDestCountry = setDestCountry;

function toggleVisited(iso, name) {
  var md = _getMapData(); if (!md) return;
  md.visitedCountries = md.visitedCountries || [];
  var idx = md.visitedCountries.indexOf(iso);
  if (idx === -1) {
    md.visitedCountries.push(iso);
    md.countryNames = md.countryNames || {};
    md.countryNames[iso] = name;
    if ((md.selectedCountries || []).indexOf(iso) === -1) {
      md.selectedCountries = md.selectedCountries || [];
      md.selectedCountries.push(iso);
    }
  } else {
    md.visitedCountries.splice(idx, 1);
  }
  refreshAllCountryColors();
  _updateCountryPanel(iso, name);
  _renderSelectedCountries();
  snapshotCurrentTrip();
}
window.toggleVisited = toggleVisited;

function addSelected(iso, name) {
  var md = _getMapData(); if (!md) return;
  md.selectedCountries = md.selectedCountries || [];
  if (md.selectedCountries.indexOf(iso) === -1) {
    md.selectedCountries.push(iso);
    md.countryNames = md.countryNames || {};
    md.countryNames[iso] = name;
  }
  refreshAllCountryColors();
  _updateCountryPanel(iso, name);
  _renderSelectedCountries();
  snapshotCurrentTrip();
}
window.addSelected = addSelected;

function removeSelected(iso) {
  var md = _getMapData(); if (!md) return;
  md.selectedCountries = (md.selectedCountries || []).filter(function (c) { return c !== iso; });
  md.visitedCountries  = (md.visitedCountries  || []).filter(function (c) { return c !== iso; });
  if (md.destCountry === iso) md.destCountry = null;
  refreshAllCountryColors();
  _updateCountryPanel(_clickedISO, _clickedName);
  _renderSelectedCountries();
  snapshotCurrentTrip();
}
window.removeSelected = removeSelected;


// ── §10 NAVIGATION CARTE ──────────────────────────────────────────────

function focusCountry(iso) {
  if (!_geojson) return;
  _geojson.eachLayer(function (layer) {
    var layerIso = layer.feature.properties.iso_a2 || layer.feature.properties.name;
    if (layerIso === iso) {
      try { _map.fitBounds(layer.getBounds(), { padding: [30, 30], maxZoom: 6 }); } catch (e) {}
      var name = layer.feature.properties.name || iso;
      _updateCountryPanel(iso, name);
      _clickedISO  = iso;
      _clickedName = name;
    }
  });
}
window.focusCountry = focusCountry;

function resetMapView() {
  if (_map) _map.setView([20, 10], 2);
}
window.resetMapView = resetMapView;

function searchCountry(query) {
  if (!_geojson || !query.trim()) return;
  var q = query.trim().toLowerCase();
  _geojson.eachLayer(function (layer) {
    var name = (layer.feature.properties.name || '').toLowerCase();
    if (name.indexOf(q) === 0) {
      var iso = layer.feature.properties.iso_a2 || layer.feature.properties.name;
      focusCountry(iso);
    }
  });
}
window.searchCountry = searchCountry;


// ── §11 RENDU GEOJSON ─────────────────────────────────────────────────
function _renderGeoJSON() {
  if (!_geojsonData || !_map) return;

  _geojson = L.geoJSON(_geojsonData, {
    style: function (feature) {
      return _getCountryStyle(feature.properties.iso_a2 || feature.properties.name);
    },
    onEachFeature: function (feature, layer) {
      var name = feature.properties.name || '—';
      var iso  = feature.properties.iso_a2 || name;

      layer.bindTooltip(name, {
        sticky: true, direction: 'top', offset: [0, -4], className: 'lmap-tooltip'
      });

      layer.on('mouseover', function () {
        var md = _getMapData();
        var isSpecial = md && (
          md.destCountry === iso ||
          (md.visitedCountries || []).indexOf(iso) !== -1
        );
        if (!isSpecial) {
          layer.setStyle({ fillColor: C_HOVER, fillOpacity: 0.75, color: S_HOVER, weight: 1.5 });
        } else {
          layer.setStyle({ weight: 2.5, color: S_HOVER });
        }
        layer.bringToFront();
      });

      layer.on('mouseout', function () {
        _geojson.resetStyle(layer);
        layer.setStyle(_getCountryStyle(iso));
      });

      layer.on('click', function () {
        _clickedISO  = iso;
        _clickedName = name;
        _updateCountryPanel(iso, name);
        try { _map.fitBounds(layer.getBounds(), { padding: [30, 30], maxZoom: 6 }); } catch (e) {}
      });
    }
  }).addTo(_map);

  refreshAllCountryColors();
}


// ── §12 CHARGEMENT GEOJSON (CDN cascade + fallback intégré) ──────────
var _GEOJSON_URLS = [
  'https://cdn.jsdelivr.net/npm/geojson-world-map@1.0.1/countries.geo.json',
  'https://cdn.jsdelivr.net/gh/datasets/geo-countries@main/data/countries.geojson',
  'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson'
];

function _loadGeoJSON() {
  var urls = _GEOJSON_URLS.slice();

  function tryNext() {
    if (!urls.length) { _useFallbackGeoData(); return; }
    var url = urls.shift();
    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.features || !data.features.length) { tryNext(); return; }
        _geojsonData = data;
        _renderGeoJSON();
      })
      .catch(function () { tryNext(); });
  }
  tryNext();
}

// Données GeoJSON minimales (50 pays les plus voyagés) — mode hors-ligne
function _useFallbackGeoData() {
  var countries = [
    {n:'France',                   c:'FR', b:[[-5,41],[10,51]]},
    {n:'Japan',                    c:'JP', b:[[129,31],[146,46]]},
    {n:'United States of America', c:'US', b:[[-125,24],[-66,50]]},
    {n:'Italy',                    c:'IT', b:[[6,36],[19,47]]},
    {n:'Spain',                    c:'ES', b:[[-9,36],[3,44]]},
    {n:'Germany',                  c:'DE', b:[[6,47],[15,55]]},
    {n:'United Kingdom',           c:'GB', b:[[-8,49],[2,61]]},
    {n:'Australia',                c:'AU', b:[[113,-44],[154,-10]]},
    {n:'Canada',                   c:'CA', b:[[-141,42],[-52,84]]},
    {n:'Brazil',                   c:'BR', b:[[-74,-34],[-34,6]]},
    {n:'China',                    c:'CN', b:[[73,18],[135,54]]},
    {n:'India',                    c:'IN', b:[[68,8],[97,36]]},
    {n:'Mexico',                   c:'MX', b:[[-118,14],[-86,33]]},
    {n:'Argentina',                c:'AR', b:[[-74,-55],[-53,-21]]},
    {n:'Thailand',                 c:'TH', b:[[97,5],[106,20]]},
    {n:'Indonesia',                c:'ID', b:[[95,-10],[141,6]]},
    {n:'South Korea',              c:'KR', b:[[125,34],[130,38]]},
    {n:'Netherlands',              c:'NL', b:[[3,50],[7,54]]},
    {n:'Portugal',                 c:'PT', b:[[-9,37],[-6,42]]},
    {n:'Greece',                   c:'GR', b:[[19,35],[29,42]]},
    {n:'Turkey',                   c:'TR', b:[[26,36],[45,42]]},
    {n:'Egypt',                    c:'EG', b:[[24,22],[37,31]]},
    {n:'Morocco',                  c:'MA', b:[[-13,27],[0,36]]},
    {n:'South Africa',             c:'ZA', b:[[16,-35],[33,-22]]},
    {n:'New Zealand',              c:'NZ', b:[[166,-47],[178,-34]]},
    {n:'Sweden',                   c:'SE', b:[[11,55],[24,69]]},
    {n:'Norway',                   c:'NO', b:[[4,57],[31,71]]},
    {n:'Switzerland',              c:'CH', b:[[5,46],[10,48]]},
    {n:'Austria',                  c:'AT', b:[[9,47],[17,49]]},
    {n:'Belgium',                  c:'BE', b:[[2,49],[6,51]]},
    {n:'Poland',                   c:'PL', b:[[14,49],[24,55]]},
    {n:'Czech Republic',           c:'CZ', b:[[12,50],[19,51]]},
    {n:'Hungary',                  c:'HU', b:[[16,45],[23,48]]},
    {n:'Romania',                  c:'RO', b:[[21,43],[30,48]]},
    {n:'Croatia',                  c:'HR', b:[[13,42],[19,46]]},
    {n:'Denmark',                  c:'DK', b:[[8,54],[13,57]]},
    {n:'Finland',                  c:'FI', b:[[20,59],[32,70]]},
    {n:'Ireland',                  c:'IE', b:[[-10,51],[-6,55]]},
    {n:'Russia',                   c:'RU', b:[[27,41],[180,82]]},
    {n:'Vietnam',                  c:'VN', b:[[102,8],[110,23]]},
    {n:'Malaysia',                 c:'MY', b:[[100,1],[119,7]]},
    {n:'Singapore',                c:'SG', b:[[103,1],[104,2]]},
    {n:'Philippines',              c:'PH', b:[[117,5],[127,20]]},
    {n:'Colombia',                 c:'CO', b:[[-79,-4],[-66,13]]},
    {n:'Chile',                    c:'CL', b:[[-76,-56],[-66,-17]]},
    {n:'Peru',                     c:'PE', b:[[-82,-18],[-68,0]]},
    {n:'Kenya',                    c:'KE', b:[[33,-5],[42,5]]},
    {n:'Tanzania',                 c:'TZ', b:[[29,-12],[40,-1]]},
    {n:'Israel',                   c:'IL', b:[[34,29],[36,34]]},
    {n:'United Arab Emirates',     c:'AE', b:[[51,22],[56,26]]}
  ];

  _geojsonData = {
    type: 'FeatureCollection',
    features: countries.map(function (co) {
      var w = co.b[0][0], s = co.b[0][1], e = co.b[1][0], n = co.b[1][1];
      return {
        type: 'Feature',
        properties: { name: co.n, iso_a2: co.c },
        geometry: {
          type: 'Polygon',
          coordinates: [[[w,s],[e,s],[e,n],[w,n],[w,s]]]
        }
      };
    })
  };
  _renderGeoJSON();
}


// ── §13 INIT PRINCIPALE ───────────────────────────────────────────────
// Appelée par app.js → showTab('carte')
// Tolérante si Leaflet n'est pas encore chargé (retry 300ms).
// ─────────────────────────────────────────────────────────────────────
function initLeafletMap() {
  if (typeof L === 'undefined') {
    setTimeout(initLeafletMap, 300);
    return;
  }

  if (!_initDone) {
    // ── Créer la carte une seule fois ──────────────────────────────
    // FIX répétition : monde UNIQUE. Le pan est borné aux limites du
    // monde (maxBounds + viscosité maximale = butée ferme) et les
    // tuiles ne se répètent plus horizontalement (noWrap). Fini les
    // copies de carte vides à gauche/droite des tracés.
    _map = L.map('leaflet-map', {
      center: [20, 10],
      zoom: 2,
      minZoom: 2,
      maxZoom: 8,
      worldCopyJump: false,
      zoomControl: true,
      maxBounds: [[-85, -180], [85, 180]],
      maxBoundsViscosity: 1.0
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        + ' contributors © <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      noWrap: true,
      bounds: [[-85, -180], [85, 180]],
      maxZoom: 19
    }).addTo(_map);

    _initDone = true;
    _loadGeoJSON();

  } else {
    // ── Carte déjà créée : corriger la taille (tab était caché) ───
    setTimeout(function () { _map.invalidateSize(); }, 80);
    refreshAllCountryColors();
  }

  _updateCountryPanel(null);
  _renderSelectedCountries();
}
window.initLeafletMap = initLeafletMap;


// ── §14 ABONNEMENTS YUMESTATE ─────────────────────────────────────────
// Rafraîchir les couleurs pays quand le voyage actif change.
// Remplace l'ancien patch openTrip qui appelait initLeafletMap() complet.
// ─────────────────────────────────────────────────────────────────────
YumeState.on('trip:changed', function () {
  // Seulement si la carte monde est déjà initialisée
  if (_initDone && _geojson) {
    refreshAllCountryColors();
    _renderSelectedCountries();
    _updateCountryPanel(null);
  }
});

})(); // fin IIFE map-world
