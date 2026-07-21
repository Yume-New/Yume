// ══════════════════════════════════════════════════════════════════════
// smart-alerts.js — Assistant intelligent Phase D
// Yume Travel Manager
//
// MODULES
//   D1. Alertes devises    : détecte variation > seuil depuis dernier accès
//   D2. Résumé budgétaire  : dépenses par ville / catégorie avec projection
//   D3. Alertes planning   : chevauchements, vols manqués, jours sans hébergement
//   D4. Badge notifications: pastille rouge sur l'onglet Profil si alertes actives
//
// DÉPENDANCES : state.js, finance-data.js (FALLBACK_RATES, CURRENCY_INFO)
// EXPOSE      : window.SmartAlerts (API publique)
// ABONNEMENTS : YumeState.on('trip:changed'), YumeState.on('trip:snapshot')
// ══════════════════════════════════════════════════════════════════════

(function () {
'use strict';

// ── §1 CONFIGURATION ──────────────────────────────────────────────────
var CFG = {
  // Variation de taux en % au-delà de laquelle on alerte
  RATE_ALERT_THRESHOLD_PCT: 3,
  // Clé localStorage pour les taux de référence
  LS_RATES_KEY: 'yume_ref_rates',
  // Clé localStorage pour horodatage du dernier fetch
  LS_RATES_TS:  'yume_ref_rates_ts',
  // Durée de fraîcheur des taux (ms) — 6h
  RATES_TTL_MS: 6 * 60 * 60 * 1000,
  // URL ExchangeRate API (même que fetchRate dans app.js)
  RATES_URL: 'https://api.exchangerate-api.com/v4/latest/EUR',
};

// ── §2 ÉTAT INTERNE ───────────────────────────────────────────────────
var _alerts       = [];    // [{ type, level, title, body, icon, tripId }]
var _liveRates    = null;  // taux frais depuis l'API
var _refRates     = null;  // taux de référence (au moment du dernier accès)
var _initialized  = false;

// ── §3 UTILITAIRES DEVISE ─────────────────────────────────────────────
function _getCurrencyInfo(code) {
  return (typeof CURRENCY_INFO !== 'undefined' && CURRENCY_INFO[code])
    || { name: code, sym: code };
}

function _getFallback(code) {
  return (typeof FALLBACK_RATES !== 'undefined' && FALLBACK_RATES[code]) || 1;
}

// Récupérer les devises actives dans tous les voyages
function _getActiveDevises() {
  var seen = {};
  Object.values(allTrips || {}).forEach(function (t) {
    var country = (t.meta || {}).primaryCountry || (t.meta || {}).country;
    if (country && typeof COUNTRY_CURRENCY !== 'undefined') {
      var code = COUNTRY_CURRENCY[country];
      if (code && code !== 'EUR') seen[code] = true;
    }
    // Aussi les devises des transactions
    (t.transactions || []).forEach(function (tx) {
      if (tx.devise && tx.devise !== 'EUR') seen[tx.devise] = true;
    });
  });
  return Object.keys(seen);
}


// ── §4 FETCH TAUX LIVE ────────────────────────────────────────────────
function _fetchLiveRates(cb) {
  // Utiliser les taux déjà chargés par app.js si disponibles et frais
  if (window._cachedRates) {
    _liveRates = window._cachedRates;
    cb(_liveRates);
    return;
  }
  fetch(CFG.RATES_URL)
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data && data.rates) {
        _liveRates = data.rates;
        window._cachedRates = data.rates; // partager avec app.js
        try { localStorage.setItem(CFG.LS_RATES_TS, String(Date.now())); } catch (e) {}
      }
      cb(_liveRates);
    })
    .catch(function () { cb(null); });
}

// Charger les taux de référence depuis localStorage
function _loadRefRates() {
  try {
    var raw = localStorage.getItem(CFG.LS_RATES_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

// Sauvegarder les taux actuels comme référence
function _saveRefRates(rates) {
  try {
    localStorage.setItem(CFG.LS_RATES_KEY, JSON.stringify(rates));
    localStorage.setItem(CFG.LS_RATES_TS,  String(Date.now()));
  } catch (e) {}
}


// ── §5 D1 — ALERTES DEVISES ───────────────────────────────────────────
function _checkCurrencyAlerts(liveRates) {
  if (!liveRates) return [];
  var alerts = [];
  var devises = _getActiveDevises();
  var refs    = _refRates || {};

  devises.forEach(function (code) {
    var live = liveRates[code];
    var ref  = refs[code] || _getFallback(code);
    if (!live || !ref) return;

    var pct = ((live - ref) / ref) * 100;
    if (Math.abs(pct) < CFG.RATE_ALERT_THRESHOLD_PCT) return;

    var info = _getCurrencyInfo(code);
    var dir  = pct > 0 ? '↑' : '↓';
    var good = pct > 0; // EUR monte → devise moins chère → bon pour le voyageur
    alerts.push({
      type:   'currency',
      level:  good ? 'info' : 'warning',
      icon:   good ? '📈' : '📉',
      title:  code + ' ' + dir + ' ' + Math.abs(pct).toFixed(1) + '%',
      body:   good
        ? '1 € achète maintenant ' + live.toFixed(good && live > 10 ? 0 : 2)
          + ' ' + info.sym + ' (était ' + ref.toFixed(ref > 10 ? 0 : 2) + '). Bon moment pour changer.'
        : '1 € vaut maintenant ' + live.toFixed(live > 10 ? 0 : 2)
          + ' ' + info.sym + ' (était ' + ref.toFixed(ref > 10 ? 0 : 2) + '). Moins favorable.',
      code: code,
    });
  });

  return alerts;
}


// ── §6 D2 — RÉSUMÉ BUDGÉTAIRE PAR VILLE ──────────────────────────────
function _buildBudgetSummary() {
  if (!currentTripId || !allTrips[currentTripId]) return null;
  var trip = allTrips[currentTripId];
  var txs  = (typeof transactions !== 'undefined') ? transactions : (trip.transactions || []);
  var bud  = (typeof budget !== 'undefined') ? budget : (trip.budget || 0);

  if (!txs.length) return null;

  // Total dépensé
  var spent = txs.reduce(function (s, t) { return s + (t.amount || 0); }, 0);
  var rem   = bud - spent;
  var pct   = bud > 0 ? Math.round((spent / bud) * 100) : 0;

  // Par catégorie
  var byCat = {};
  txs.forEach(function (t) {
    byCat[t.cat] = (byCat[t.cat] || 0) + (t.amount || 0);
  });
  var topCat = Object.entries(byCat)
    .sort(function (a, b) { return b[1] - a[1]; })
    .slice(0, 3);

  // Par devise (montants originaux)
  var byDev = {};
  txs.forEach(function (t) {
    if (t.devise && t.devise !== 'EUR') {
      byDev[t.devise] = (byDev[t.devise] || 0) + (t.raw || 0);
    }
  });

  // Projection : à ce rythme, combien reste-t-il ?
  var meta = trip.meta || {};
  var daysPast = 0, daysTotal = 0;
  var d1 = _parseDate(meta.dateDep), d2 = _parseDate(meta.dateRet);
  if (d1 && d2) {
    daysTotal = Math.max(1, Math.round((d2 - d1) / 86400000));
    daysPast  = Math.max(1, Math.min(daysTotal,
      Math.round((Date.now() - d1.getTime()) / 86400000)));
  }
  var dailyRate  = daysPast > 0 ? spent / daysPast : 0;
  var projection = daysTotal > 0 ? dailyRate * daysTotal : spent;
  var projOver   = bud > 0 && projection > bud;

  return {
    spent: spent, budget: bud, rem: rem, pct: pct,
    topCat: topCat, byDev: byDev,
    dailyRate: dailyRate, projection: projection,
    daysTotal: daysTotal, daysPast: daysPast,
    projOver: projOver,
  };
}

function _parseDate(str) {
  if (!str) return null;
  var fr = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (fr) return new Date(+fr[3], +fr[2]-1, +fr[1]);
  var iso = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(+iso[1], +iso[2]-1, +iso[3]);
  // Format "JJ mois" (ex: "09 août") → année tirée du voyage actif
  if (typeof MOIS_SHORT !== 'undefined' && /^\d{1,2}\s/.test(str)) {
    var day = parseInt(str, 10);
    for (var i = 0; i < MOIS_SHORT.length; i++) {
      if (str.toLowerCase().indexOf(MOIS_SHORT[i].toLowerCase()) !== -1) {
        return new Date(_saTripYear(), i, day);
      }
    }
  }
  return null;
}

function _saTripYear() {
  // Rapport « cloche » en cours : l'année des dates « JJ mois » est celle
  // du voyage CIBLE du rapport, pas du voyage actif.
  if (_bellYear) return _bellYear;
  var meta = (typeof currentTripId !== 'undefined' && allTrips[currentTripId] && allTrips[currentTripId].meta) || {};
  var m = (meta.dateDep || meta.dateRet || '').match(/\/(\d{4})$/);
  return m ? +m[1] : (new Date()).getFullYear();
}
var _bellYear = null;


// ── §7 D3 — ALERTES PLANNING ──────────────────────────────────────────
function _checkPlanningAlerts() {
  if (!currentTripId || !allTrips[currentTripId]) return [];
  var trip  = allTrips[currentTripId];
  var mobs  = (typeof mobilites !== 'undefined') ? mobilites : (trip.mobilites || []);
  var hots  = (typeof hotels    !== 'undefined') ? hotels    : (trip.hotels    || []);
  var alerts = [];

  // ── Nuits sans hébergement ──────────────────────────────────────
  var meta = trip.meta || {};
  var d1 = _parseDate(meta.dateDep), d2 = _parseDate(meta.dateRet);
  if (d1 && d2 && hots.length > 0) {
    // Construire l'ensemble des nuits couvertes
    var covered = {};
    hots.forEach(function (h) {
      var ci = _parseDate(h.checkin), co = _parseDate(h.checkout);
      if (!ci || !co) return;
      for (var d = new Date(ci); d < co; d.setDate(d.getDate() + 1)) {
        covered[d.toISOString().slice(0,10)] = true;
      }
    });
    // Chercher les nuits non couvertes dans la plage du voyage
    var uncovered = [];
    for (var d = new Date(d1); d < d2; d.setDate(d.getDate() + 1)) {
      var key = d.toISOString().slice(0,10);
      if (!covered[key]) uncovered.push(key);
    }
    if (uncovered.length > 0 && uncovered.length <= 5) {
      alerts.push({
        type:  'planning',
        level: 'warning',
        icon:  '🏨',
        title: uncovered.length + ' nuit' + (uncovered.length > 1 ? 's' : '') + ' sans hébergement',
        body:  'Aucun hébergement enregistré pour : '
          + uncovered.slice(0, 3).map(function (k) {
              var p = k.split('-');
              return p[2] + '/' + p[1];
            }).join(', ')
          + (uncovered.length > 3 ? ' et ' + (uncovered.length - 3) + ' autre(s)' : ''),
      });
    } else if (uncovered.length > 5) {
      alerts.push({
        type:  'planning',
        level: 'info',
        icon:  '🏨',
        title: uncovered.length + ' nuits sans hébergement',
        body:  'Pensez à compléter les hébergements pour toute la durée du voyage.',
      });
    }
  }

  // ── Délais serrés entre transports (< 45 min) ──────────────────
  var dated = mobs
    .filter(function (m) { return m.date && m.heureArr; })
    .map(function (m) {
      var d = _parseDate(m.date);
      var h = m.heureArr.match(/^(\d{1,2}):(\d{2})$/);
      var ts = d && h ? d.getTime() + (+h[1]*3600 + +h[2]*60)*1000 : null;
      return Object.assign({}, m, { _arrTS: ts });
    })
    .filter(function (m) { return m._arrTS; })
    .sort(function (a, b) { return a._arrTS - b._arrTS; });

  for (var i = 0; i < dated.length - 1; i++) {
    var curr = dated[i], next = dated[i+1];
    if (!next.heureDep) continue;
    var d = _parseDate(next.date);
    var h = next.heureDep.match(/^(\d{1,2}):(\d{2})$/);
    if (!d || !h) continue;
    var nextDepTS = d.getTime() + (+h[1]*3600 + +h[2]*60)*1000;
    var gap = (nextDepTS - curr._arrTS) / 60000; // minutes

    if (gap > 0 && gap < 45) {
      alerts.push({
        type:  'planning',
        level: 'warning',
        icon:  '⏱️',
        title: 'Correspondance serrée : ' + Math.round(gap) + ' min',
        body:  'Arrivée ' + curr.arr + ' à ' + curr.heureArr
          + ' · Départ ' + next.dep + ' à ' + next.heureDep
          + '. Prévoir un délai de sécurité.',
      });
    }
  }

  // ── Départ hôtel imminent (aujourd'hui / demain) ───────────────
  hots.forEach(function (h) {
    if (!h.heureDep) return;
    var co = _parseDate(h.checkout);
    if (!co) return;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var coMid = new Date(co.getFullYear(), co.getMonth(), co.getDate());
    var diff = Math.round((coMid - today) / 86400000);
    if (diff < 0 || diff > 1) return;
    var hd = ('' + h.heureDep).replace(':', 'h');
    var when = diff === 0 ? 'aujourd\'hui' : 'demain';
    alerts.push({
      type:  'planning',
      level: diff === 0 ? 'error' : 'warning',
      icon:  (typeof _lu === 'function') ? _lu('log-out', 15) : '',
      title: 'Départ ' + (h.nom || 'hôtel') + ' ' + when,
      body:  'Libère la chambre avant ' + hd + (h.checkout ? ' (' + h.checkout + ')' : '') + '.'
    });
  });

  return alerts;
}


// ── §8 RENDU UI ───────────────────────────────────────────────────────

function _fmt(n, decimals) {
  return n.toLocaleString('fr-FR', {
    minimumFractionDigits: decimals || 0,
    maximumFractionDigits: decimals || 0,
  });
}

function _renderAlertCard(a) {
  var colors = { warning: '#c9921a', info: '#2d8c6b', error: '#c0392b' };
  var bgs    = { warning: '#fdf3df', info: '#e8f5f0', error: '#fdf0f0' };
  var c = colors[a.level] || colors.info;
  var bg = bgs[a.level]  || bgs.info;

  return '<div class="sa-alert-card" style="border-color:' + c + '44;background:' + bg + '">'
    + '<div class="sa-alert-header">'
      + '<span class="sa-alert-icon">' + a.icon + '</span>'
      + '<span class="sa-alert-title" style="color:' + c + '">' + a.title + '</span>'
    + '</div>'
    + '<div class="sa-alert-body">' + a.body + '</div>'
  + '</div>';
}

function _renderBudgetCard(summary) {
  if (!summary) return '';
  var barColor = summary.pct > 90 ? '#c0392b' : summary.pct > 70 ? '#c9921a' : '#2d8c6b';
  var remClass = summary.rem < 0 ? 'style="color:#c0392b"' : 'style="color:#2d8c6b"';

  var catsHtml = summary.topCat.map(function (e) {
    var pct = summary.spent > 0 ? Math.round((e[1]/summary.spent)*100) : 0;
    return '<div class="sa-cat-row">'
      + '<span class="sa-cat-name">' + e[0] + '</span>'
      + '<div class="sa-cat-bar"><div class="sa-cat-fill" style="width:' + pct + '%;background:' + barColor + '"></div></div>'
      + '<span class="sa-cat-pct">' + pct + '%</span>'
    + '</div>';
  }).join('');

  var projHtml = summary.daysTotal > 0
    ? '<div class="sa-proj ' + (summary.projOver ? 'sa-proj--over' : '') + '">'
        + '<span class="sa-proj-icon">' + (summary.projOver ? '⚠️' : '✅') + '</span>'
        + '<span>'
          + (summary.projOver
            ? 'Projection : <strong>' + _fmt(summary.projection, 0) + ' €</strong> · Dépassement de '
              + _fmt(summary.projection - summary.budget, 0) + ' € prévu'
            : 'Projection fin de voyage : <strong>' + _fmt(summary.projection, 0) + ' €</strong> · '
              + _fmt(summary.budget - summary.projection, 0) + ' € de marge')
        + '</span>'
      + '</div>'
    : '';

  var devHtml = Object.keys(summary.byDev).length
    ? '<div class="sa-dev-row">'
        + Object.entries(summary.byDev).map(function (e) {
            var info = _getCurrencyInfo(e[0]);
            return '<span class="sa-dev-tag">'
              + info.sym + ' ' + _fmt(e[1], e[1] > 100 ? 0 : 2)
            + '</span>';
          }).join('')
      + '</div>'
    : '';

  return '<div class="sa-budget-card">'
    + '<div class="sa-budget-row">'
      + '<div class="sa-budget-metric">'
        + '<div class="sa-budget-val">' + _fmt(summary.spent, 2) + ' €</div>'
        + '<div class="sa-budget-lbl">Dépensé</div>'
      + '</div>'
      + '<div class="sa-budget-metric">'
        + '<div class="sa-budget-val" ' + remClass + '>' + _fmt(Math.abs(summary.rem), 2) + ' €</div>'
        + '<div class="sa-budget-lbl">' + (summary.rem < 0 ? 'Dépassement' : 'Restant') + '</div>'
      + '</div>'
      + '<div class="sa-budget-metric">'
        + '<div class="sa-budget-val">' + summary.pct + '%</div>'
        + '<div class="sa-budget-lbl">Utilisé</div>'
      + '</div>'
    + '</div>'
    + '<div class="sa-budget-bar"><div class="sa-budget-fill" style="width:' + Math.min(100, summary.pct) + '%;background:' + barColor + '"></div></div>'
    + (summary.dailyRate > 0
        ? '<div class="sa-daily">' + _fmt(summary.dailyRate, 0) + ' €/jour · Jour ' + summary.daysPast + '/' + summary.daysTotal + '</div>'
        : '')
    + devHtml
    + (catsHtml ? '<div class="sa-cats">' + catsHtml + '</div>' : '')
    + projHtml
  + '</div>';
}

function _renderPanel() {
  var el = document.getElementById('smart-alerts-panel');
  if (!el) return;

  var html = '';

  // Budget summary du voyage actif
  var summary = _buildBudgetSummary();
  if (summary) {
    html += '<div class="sa-section-title">Résumé budget</div>';
    html += _renderBudgetCard(summary);
  }

  // Alertes actives
  if (_alerts.length > 0) {
    html += '<div class="sa-section-title" style="margin-top:16px">'
      + _alerts.length + ' alerte' + (_alerts.length > 1 ? 's' : '')
    + '</div>';
    _alerts.forEach(function (a) { html += _renderAlertCard(a); });
  } else if (summary) {
    html += '<div class="sa-no-alerts">✅ Aucune alerte — tout est en ordre</div>';
  } else {
    html += '<div class="sa-no-alerts">Ouvre un voyage pour voir le résumé et les alertes.</div>';
  }

  el.innerHTML = html;
  _updateBadge();
}

function _updateBadge() {
  var badge = document.getElementById('sa-notif-badge');
  if (!badge) return;
  var n = _alerts.filter(function (a) { return a.level === 'warning' || a.level === 'error'; }).length;
  badge.textContent = n > 0 ? String(n > 9 ? '9+' : n) : '';
  badge.style.display = n > 0 ? '' : 'none';
}


// ── §9 STYLES ─────────────────────────────────────────────────────────
(function _injectStyles() {
  if (document.getElementById('yume-sa-styles')) return;
  var s = document.createElement('style');
  s.id = 'yume-sa-styles';
  s.textContent = [
    '#smart-alerts-panel{padding:0 0 80px;}',

    '.sa-section-title{font-size:11px;font-weight:600;color:var(--ink-hint);text-transform:uppercase;'
      + 'letter-spacing:.1em;margin:16px 0 8px;display:flex;align-items:center;gap:8px;}',
    '.sa-section-title::after{content:"";flex:1;height:1px;background:var(--border);}',

    /* Budget card */
    '.sa-budget-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);'
      + 'padding:14px 16px;box-shadow:var(--shadow-sm);}',
    '.sa-budget-row{display:flex;gap:8px;margin-bottom:10px;}',
    '.sa-budget-metric{flex:1;text-align:center;}',
    '.sa-budget-val{font-size:16px;font-weight:700;color:var(--ink);}',
    '.sa-budget-lbl{font-size:10px;color:var(--ink-hint);margin-top:2px;text-transform:uppercase;letter-spacing:.05em;}',
    '.sa-budget-bar{height:6px;background:var(--surface-3);border-radius:3px;overflow:hidden;margin-bottom:8px;}',
    '.sa-budget-fill{height:100%;border-radius:3px;transition:width .4s;}',
    '.sa-daily{font-size:11px;color:var(--ink-muted);text-align:center;margin-bottom:8px;}',
    '.sa-dev-row{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;}',
    '.sa-dev-tag{font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;'
      + 'background:var(--surface-2);color:var(--ink-muted);border:1px solid var(--border);}',
    '.sa-cats{margin-top:8px;}',
    '.sa-cat-row{display:flex;align-items:center;gap:8px;margin-bottom:4px;}',
    '.sa-cat-name{font-size:11px;color:var(--ink-muted);width:80px;flex-shrink:0;'
      + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.sa-cat-bar{flex:1;height:4px;background:var(--surface-3);border-radius:2px;overflow:hidden;}',
    '.sa-cat-fill{height:100%;border-radius:2px;transition:width .4s;}',
    '.sa-cat-pct{font-size:10px;color:var(--ink-hint);width:28px;text-align:right;flex-shrink:0;}',
    '.sa-proj{display:flex;align-items:flex-start;gap:6px;margin-top:10px;padding:8px 10px;'
      + 'border-radius:var(--r-sm);background:var(--surface-2);font-size:12px;color:var(--ink-muted);line-height:1.5;}',
    '.sa-proj--over{background:#fdf3df;}',
    '.sa-proj-icon{flex-shrink:0;}',

    /* Alert cards */
    '.sa-alert-card{border:1px solid;border-radius:var(--r-md);padding:10px 14px;margin-bottom:8px;}',
    '.sa-alert-header{display:flex;align-items:center;gap:8px;margin-bottom:4px;}',
    '.sa-alert-icon{font-size:18px;flex-shrink:0;}',
    '.sa-alert-title{font-size:13px;font-weight:600;}',
    '.sa-alert-body{font-size:12px;color:var(--ink-muted);line-height:1.5;margin-left:26px;}',

    /* Badge notification */
    '#sa-notif-badge{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;'
      + 'border-radius:8px;background:#c0392b;color:white;font-size:10px;font-weight:700;'
      + 'display:none;align-items:center;justify-content:center;padding:0 4px;'
      + 'border:2px solid var(--surface);}',

    '.sa-no-alerts{text-align:center;padding:24px 16px;font-size:13px;color:var(--ink-muted);}',
  ].join('\n');
  document.head.appendChild(s);
})();


// ── §10 INIT & CYCLE DE VIE ───────────────────────────────────────────

function _runChecks(rates) {
  _alerts = [];
  if (rates) {
    var currAlerts = _checkCurrencyAlerts(rates);
    _alerts = _alerts.concat(currAlerts);
  }
  var planAlerts = _checkPlanningAlerts();
  _alerts = _alerts.concat(planAlerts);
  _renderPanel();
}

function init() {
  if (_initialized) { refresh(); return; }
  _initialized = true;
  _refRates = _loadRefRates();

  _fetchLiveRates(function (rates) {
    if (rates && !_refRates) {
      // Premier lancement : sauvegarder comme référence
      _saveRefRates(rates);
      _refRates = rates;
    }
    _runChecks(rates);
    // Mettre à jour la référence pour la prochaine session
    if (rates) _saveRefRates(rates);
  });
}

function refresh() {
  _fetchLiveRates(function (rates) {
    _runChecks(rates);
    if (rates) _saveRefRates(rates);
  });
}

// ── §11 ABONNEMENTS YUMESTATE ─────────────────────────────────────────
YumeState.on('trip:changed', function () {
  setTimeout(_renderPanel, 100); // données fraîches après restoreTrip
});

YumeState.on('trip:snapshot', function () {
  // Recalculer les alertes planning et budget si le panel est visible
  var panel = document.getElementById('smart-alerts-panel');
  if (panel && panel.closest && panel.closest('.section.active')) {
    _runChecks(_liveRates);
  } else {
    // Màj silencieuse du badge seulement
    _alerts = _alerts.filter(function (a) { return a.type === 'currency'; });
    _alerts = _alerts.concat(_checkPlanningAlerts());
    _updateBadge();
  }
});

YumeState.on('map:refresh', function () {
  setTimeout(_renderPanel, 200);
});


// ── §11bis CLOCHE DE L'ACCUEIL — rapport dérivé pour UN voyage donné ──
// Entièrement calculé à la volée depuis allTrips[tid] (AUCUN stockage,
// aucune nouvelle clé). Deux groupes :
//   echeances : le PROCHAIN check-in, check-out, transport et lieu daté
//               (date >= aujourd'hui), triés par date croissante ;
//   alertes   : cohérence — plages de nuits sans hébergement (étiquetées
//               « rupture » si bornées par deux séjours), transport non
//               confirmé à <= 7 jours, hôtel/lieu sans coordonnées.
// Chaque entrée porte de quoi naviguer : {cat,id} ou {section}.
function bellReport(tid) {
  var t = (typeof allTrips !== 'undefined' && allTrips[tid]) || null;
  if (!t) return { echeances: [], alertes: [], past: false };
  var meta = t.meta || {};
  var ym = (meta.dateDep || meta.dateRet || '').match(/\/(\d{4})$/);
  _bellYear = ym ? +ym[1] : null;

  // Voyage actif → globals hydratées (non snapshotées) ; sinon snapshot.
  var act  = (typeof currentTripId !== 'undefined' && tid === currentTripId);
  var hots = (act && typeof hotels    !== 'undefined') ? hotels    : (t.hotels    || []);
  var mobs = (act && typeof mobilites !== 'undefined') ? mobilites : (t.mobilites || []);
  var lx   = (act && typeof lieux     !== 'undefined') ? lieux     : (t.lieux     || []);

  var DAY = 86400000;
  var today = new Date(); today.setHours(0, 0, 0, 0);
  function mid(d)  { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function days(d) { return Math.round((d - today) / DAY); }
  function dstr(d) {
    return (d.getDate() < 10 ? '0' : '') + d.getDate() + '/'
         + ((d.getMonth() + 1) < 10 ? '0' : '') + (d.getMonth() + 1);
  }

  // ── A. Échéances : le PROCHAIN élément de chaque type ──
  var ech = [];
  function nextOf(items, getDate, build) {
    var best = null, bestD = null;
    items.forEach(function (it) {
      var d = getDate(it);
      if (!d) return;
      var dd = mid(d);
      if (dd < today) return;
      if (!bestD || dd < bestD) { bestD = dd; best = it; }
    });
    if (best) ech.push(build(best, bestD));
  }
  nextOf(hots, function (h) { return _parseDate(h.checkin); }, function (h, d) {
    return { kind: 'checkin', title: 'Check-in · ' + (h.nom || 'Hébergement'),
      sub: (h.ville ? h.ville + ' · ' : '') + dstr(d) + (h.heureArr ? ' · ' + h.heureArr : ''),
      ts: d.getTime(), days: days(d), cat: 'hotel', id: String(h.id) };
  });
  nextOf(hots, function (h) { return _parseDate(h.checkout); }, function (h, d) {
    return { kind: 'checkout', title: 'Check-out · ' + (h.nom || 'Hébergement'),
      sub: (h.ville ? h.ville + ' · ' : '') + dstr(d) + (h.heureDep ? ' · avant ' + h.heureDep : ''),
      ts: d.getTime(), days: days(d), cat: 'hotel', id: String(h.id) };
  });
  nextOf(mobs, function (m) { return _parseDate(m.date); }, function (m, d) {
    var lbl = { vol: 'Vol', train: 'Train', bus: 'Bus', bateau: 'Ferry',
                covoiturage: 'Covoiturage', metro: 'Métro', taxi: 'Taxi' }[m.type] || 'Transport';
    return { kind: 'transport', mobType: m.type,
      title: lbl + ' · ' + (m.dep || '?') + ' → ' + (m.arr || '?'),
      sub: dstr(d) + (m.heureDep ? ' · départ ' + m.heureDep : ''),
      ts: d.getTime(), days: days(d), cat: 'transport', id: String(m.id) };
  });
  nextOf(lx, function (l) { return _parseDate(l.dateVisite); }, function (l, d) {
    return { kind: 'lieu', title: 'Activité · ' + (l.nom || 'Lieu'),
      sub: (l.ville ? l.ville + ' · ' : '') + dstr(d) + (l.ouverture ? ' · ' + l.ouverture : ''),
      ts: d.getTime(), days: days(d), cat: 'lieu', id: String(l.id) };
  });
  ech.sort(function (a, b) { return a.ts - b.ts; });

  // ── B. Alertes de cohérence ──
  var al = [];

  // B1 + B4 — nuits non couvertes, par plages contiguës. Une plage
  // bordée par un check-out (à gauche) ET un check-in (à droite) est une
  // « rupture de chaîne » ; sinon simple trou de couverture.
  var d1 = _parseDate(meta.dateDep), d2 = _parseDate(meta.dateRet);
  if (d1 && d2 && hots.length) {
    var covered = {}, coEnds = {}, ciStarts = {};
    hots.forEach(function (h) {
      var ci = _parseDate(h.checkin), co = _parseDate(h.checkout);
      if (!ci || !co) return;
      ciStarts[mid(ci).getTime()] = 1;
      coEnds[mid(co).getTime()]   = 1;
      for (var d = mid(ci); d < co; d.setDate(d.getDate() + 1)) covered[d.getTime()] = 1;
    });
    var pushRun = function (r) {
      var n = Math.round((r.end - r.start) / DAY) + 1;
      var after = new Date(r.end); after.setDate(after.getDate() + 1);
      var rupture = coEnds[r.start.getTime()] && ciStarts[after.getTime()];
      al.push({ kind: rupture ? 'rupture' : 'trou',
        title: (rupture ? 'Rupture d\'hébergement — ' : '')
          + n + ' nuit' + (n > 1 ? 's' : '') + ' sans hébergement',
        sub: 'Nuit' + (n > 1 ? 's du ' : ' du ') + dstr(r.start) + (n > 1 ? ' au ' + dstr(r.end) : ''),
        section: 'hotels' });
    };
    var run = null;
    for (var d = mid(d1); d < d2; d.setDate(d.getDate() + 1)) {
      if (!covered[d.getTime()]) {
        if (!run) run = { start: new Date(d) };
        run.end = new Date(d);
      } else if (run) { pushRun(run); run = null; }
    }
    if (run) pushRun(run);
  }

  // B2 — transport « à confirmer » dont la date approche (0 à 7 jours).
  mobs.forEach(function (m) {
    if (!m.statut || m.statut === 'Confirmé') return;
    var d = _parseDate(m.date);
    if (!d) return;
    var dd = days(mid(d));
    if (dd < 0 || dd > 7) return;
    al.push({ kind: 'confirmer',
      title: 'À confirmer · ' + (m.dep || '?') + ' → ' + (m.arr || '?'),
      sub: 'Départ le ' + dstr(d) + (dd === 0 ? ' (aujourd\'hui)' : dd === 1 ? ' (demain)' : ' (dans ' + dd + ' jours)'),
      cat: 'transport', id: String(m.id) });
  });

  // B3 — hébergement / lieu sans coordonnées (« Non situé » sur la carte).
  hots.forEach(function (h) {
    if (h.geoOff || (h.lat == null && h.lng == null)) {
      al.push({ kind: 'nonsitue', title: 'Non situé · ' + (h.nom || 'Hébergement'),
        sub: 'Aucune adresse géolocalisée', cat: 'hotel', id: String(h.id) });
    }
  });
  lx.forEach(function (l) {
    if (l.geoOff || (l.lat == null && l.lng == null)) {
      al.push({ kind: 'nonsitue', title: 'Non situé · ' + (l.nom || 'Lieu'),
        sub: 'Aucune adresse géolocalisée', cat: 'lieu', id: String(l.id) });
    }
  });

  var ret = _parseDate(meta.dateRet);
  var past = !!(ret && mid(ret) < today);
  _bellYear = null;
  return { echeances: ech, alertes: al, past: past };
}

// ── §12 API PUBLIQUE ──────────────────────────────────────────────────
window.SmartAlerts = {
  init:    init,
  refresh: refresh,
  bellReport: bellReport,
  get alerts() { return _alerts.slice(); },
};

// Auto-init après DOMContentLoaded
document.addEventListener('DOMContentLoaded', function () {
  setTimeout(init, 800); // laisser l'app charger ses données d'abord
  // Le héros de l'Accueil se rend AVANT le chargement de ce module
  // (dernier script) → poser le badge de la cloche une fois prêt.
  setTimeout(function () {
    if (typeof _refreshBellBadge === 'function') _refreshBellBadge();
  }, 300);
});

})(); // fin IIFE smart-alerts
