// ══════════════════════════════════════════════════════════════════════
// timeline.js — Moteur de Timeline chronologique automatique
// Yume Travel Manager · Phase B
//
// RESPONSABILITÉS
//   - Agréger mobilités + hôtels + lieux + passes en une liste unifiée
//   - Trier chronologiquement (date + heure de départ)
//   - Rendre un fil chronologique dans #timeline-container
//   - Se mettre à jour automatiquement via YumeState.on('trip:snapshot')
//
// FORMAT DE DATE SUPPORTÉ : JJ/MM/AAAA (format natif Yume)
// DÉPENDANCES : state.js (YumeState, allTrips, currentTripId,
//               vols, mobilites, hotels, lieux, passes)
// EXPOSE      : window.initTimeline, window.renderTimeline
// ══════════════════════════════════════════════════════════════════════

(function () {
'use strict';

// ── §1 CONSTANTES ─────────────────────────────────────────────────────

// Icônes SVG par type d'événement (inline, zéro emoji)
var _ICONS = {
  vol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M21 16l-3-8-3 3-5-5-3 3 2 3-4 2 1 2 5-1 1 3 3-1 1 3 3-3z"/></svg>',
  train: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><rect x="2" y="7" width="20" height="10" rx="4"/><line x1="2" y1="12" x2="22" y2="12"/><circle cx="7" cy="17" r="1.5"/><circle cx="17" cy="17" r="1.5"/></svg>',
  bus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><rect x="2" y="6" width="20" height="14" rx="3"/><rect x="4" y="9" width="5" height="4" rx="1"/><rect x="10" y="9" width="5" height="4" rx="1"/><circle cx="6" cy="20" r="2"/><circle cx="18" cy="20" r="2"/></svg>',
  bateau: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M2 20h20M4 14l8-10 8 10"/><path d="M12 4v10"/><path d="M4 14h16l-2 6H6l-2-6z"/></svg>',
  metro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><rect x="3" y="8" width="18" height="11" rx="3"/><line x1="3" y1="13" x2="21" y2="13"/><circle cx="8" cy="19" r="1.5"/><circle cx="16" cy="19" r="1.5"/><line x1="8" y1="8" x2="8" y2="4"/><line x1="16" y1="8" x2="16" y2="4"/></svg>',
  covoiturage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M3 11l4-7h10l4 7"/><path d="M1 11h22v7a2 2 0 01-2 2H3a2 2 0 01-2-2v-7z"/><circle cx="7" cy="15" r="2"/><circle cx="17" cy="15" r="2"/></svg>',
  taxi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M3 11l4-7h10l4 7"/><path d="M1 11h22v7a2 2 0 01-2 2H3a2 2 0 01-2-2v-7z"/><circle cx="7" cy="15" r="2"/><circle cx="17" cy="15" r="2"/></svg>',
  hotel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><rect x="2" y="6" width="20" height="16" rx="2"/><path d="M2 12h20"/><rect x="7" y="16" width="3" height="6"/><rect x="14" y="16" width="3" height="6"/></svg>',
  lieu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>',
  pass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><rect x="2" y="7" width="20" height="10" rx="2"/><path d="M2 12h20"/><circle cx="7" cy="12" r="1.5"/></svg>',
  checkin:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M20 12V22H4V12"/><path d="M22 7H2v5h20V7z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></svg>',
  checkout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
};

// Couleurs de pastille par catégorie
var _COLORS = {
  vol:          '#e8748a',
  train:        '#2d5e8c',
  bus:          '#2d8c6b',
  bateau:       '#2d8c8c',
  metro:        '#7c5cbf',
  covoiturage:  '#c9921a',
  taxi:         '#c9921a',
  hotel:        '#F08080',
  lieu:         '#5C6BC0',
  pass:         '#c9921a',
  checkin:      '#F08080',
  checkout:     '#5a5a72',
};

// Libellés type pour les en-têtes de pastille
// Charte Yume : zéro emoji — libellés typographiques purs
var _TYPE_LABEL = {
  vol:'Vol', train:'Train', bus:'Bus', bateau:'Ferry',
  metro:'Métro', covoiturage:'Covoit.', taxi:'Taxi',
  hotel:'Hébergement', lieu:'Lieu', pass:'Pass',
  checkin:'Arrivée hôtel', checkout:'Départ hôtel',
};


// ── §2 PARSEUR DE DATE YUME (JJ/MM/AAAA) ─────────────────────────────
function _parseDate(str) {
  if (!str) return null;
  // Accepte JJ/MM/AAAA et AAAA-MM-JJ (ISO, utilisé par transactions)
  var iso = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  var fr = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (fr) return new Date(+fr[3], +fr[2] - 1, +fr[1]);
  return null;
}

// Convertit une date en timestamp de tri (+ heure si disponible)
function _sortKey(dateStr, heureStr) {
  var d = _parseDate(dateStr);
  if (!d) return Infinity;
  var ts = d.getTime();
  if (heureStr) {
    var m = heureStr.match(/^(\d{1,2}):(\d{2})$/);
    if (m) ts += (+m[1] * 3600 + +m[2] * 60) * 1000;
  }
  return ts;
}

// Formate un timestamp en "Lun. 14 juil. 2025"
var _JOURS = ['Dim.','Lun.','Mar.','Mer.','Jeu.','Ven.','Sam.'];
var _MOIS  = ['jan.','fév.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];

function _fmtDate(d) {
  if (!d) return '—';
  return _JOURS[d.getDay()] + ' ' + d.getDate() + ' ' + _MOIS[d.getMonth()] + ' ' + d.getFullYear();
}

function _fmtHeure(h) {
  return h || '';
}


// ── §3 AGRÉGATEUR D'ÉVÉNEMENTS ────────────────────────────────────────
// Produit un tableau plat d'événements triés par date + heure.
// Chaque événement : { sortKey, date, dateObj, category, type, title,
//                      sub, badge, icon, color, id, extra }
// ─────────────────────────────────────────────────────────────────────
function _buildEvents() {
  var events = [];

  var _mob  = (typeof mobilites  !== 'undefined') ? mobilites  : [];
  var _hot  = (typeof hotels     !== 'undefined') ? hotels     : [];
  var _lx   = (typeof lieux      !== 'undefined') ? lieux      : [];
  var _pas  = (typeof passes     !== 'undefined') ? passes     : [];

  // ── Mobilités ─────────────────────────────────────────────────────
  _mob.forEach(function (m) {
    var type  = m.type || 'vol';
    var date  = m.date || '';
    var sk    = _sortKey(date, m.heureDep);

    var title = m.dep && m.arr ? m.dep + ' → ' + m.arr : (m.dep || m.arr || '—');
    var sub   = [m.compagnie, m.numero].filter(Boolean).join(' · ');
    if (m.heureDep) sub = (m.heureDep + (m.heureArr ? ' → ' + m.heureArr : '')) + (sub ? '  ·  ' + sub : '');

    var badge = m.statut || '';

    // Escale rich → sous-événement
    var extra = null;
    if (type === 'vol' && m.segment2 && m.segment2.dep) {
      extra = {
        label: 'Escale : ' + (m.segment2.dep || '') + (m.segment2.dureeEscale ? ' (' + m.segment2.dureeEscale + ')' : ''),
        icon: _ICONS['vol']
      };
    }

    events.push({
      sortKey: sk,
      date: date,
      dateObj: _parseDate(date),
      category: 'transport',
      type: type,
      title: title,
      sub: sub,
      badge: badge,
      icon: _ICONS[type] || _ICONS.vol,
      color: _COLORS[type] || _COLORS.vol,
      id: m.id,
      extra: extra,
    });
  });

  // ── Hôtels : check-in et check-out comme événements séparés ──────
  _hot.forEach(function (h) {
    var ci = h.checkin  ? _sortKey(h.checkin,  '14:00') : Infinity;
    var co = h.checkout ? _sortKey(h.checkout, '11:00') : Infinity;
    var addr = h.ville || (h.fullAddress ? h.fullAddress.split(',')[0] : '');

    if (h.checkin) {
      events.push({
        sortKey: ci,
        date: h.checkin,
        dateObj: _parseDate(h.checkin),
        category: 'hotel',
        type: 'checkin',
        title: h.nom || '—',
        sub: addr + (h.resa ? '  ·  Résa : ' + h.resa : ''),
        badge: 'Arrivée 14h',
        icon: _ICONS.checkin,
        color: _COLORS.hotel,
        id: h.id,
        extra: null,
      });
    }
    if (h.checkout) {
      events.push({
        sortKey: co,
        date: h.checkout,
        dateObj: _parseDate(h.checkout),
        category: 'hotel',
        type: 'checkout',
        title: h.nom || '—',
        sub: addr,
        badge: 'Départ 11h',
        icon: _ICONS.checkout,
        color: _COLORS.checkout,
        id: h.id,
        extra: null,
      });
    }
  });

  // ── Lieux ─────────────────────────────────────────────────────────
  // Les lieux n'ont pas toujours de date — on les place à minuit
  // du jour de visite si disponible, sinon à la fin de la timeline.
  _lx.forEach(function (l) {
    var sk = Infinity; // sans date → fin de liste
    events.push({
      sortKey: sk,
      date: '',
      dateObj: null,
      category: 'lieu',
      type: 'lieu',
      title: l.nom || '—',
      sub: l.ville || '',
      badge: l.visited ? 'Visité' : '',
      icon: _ICONS.lieu,
      color: _COLORS.lieu,
      id: l.id,
      extra: null,
    });
  });

  // ── Passes ────────────────────────────────────────────────────────
  _pas.forEach(function (p) {
    var sk = _sortKey(p.debut, '');
    events.push({
      sortKey: sk,
      date: p.debut || '',
      dateObj: _parseDate(p.debut),
      category: 'pass',
      type: 'pass',
      title: p.nom || '—',
      sub: (p.zone ? p.zone + '  ·  ' : '') + (p.validite || ''),
      badge: p.statut || '',
      icon: _ICONS.pass,
      color: _COLORS.pass,
      id: p.id,
      extra: null,
    });
  });

  // ── Tri chronologique ─────────────────────────────────────────────
  events.sort(function (a, b) {
    if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
    // Même timestamp : transport avant hôtel avant lieu
    var cat = { transport:0, hotel:1, pass:2, lieu:3 };
    return (cat[a.category] || 9) - (cat[b.category] || 9);
  });

  return events;
}


// ── §4 RENDU HTML ─────────────────────────────────────────────────────
function _renderEvents(events) {
  if (!events.length) {
    return '<div class="tl-empty">'
      + '<div class="tl-empty-icon">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="36" height="36">'
          + '<rect x="3" y="4" width="18" height="18" rx="2"/>'
          + '<line x1="16" y1="2" x2="16" y2="6"/>'
          + '<line x1="8" y1="2" x2="8" y2="6"/>'
          + '<line x1="3" y1="10" x2="21" y2="10"/>'
        + '</svg>'
      + '</div>'
      + '<div class="tl-empty-title">Itinéraire vide</div>'
      + '<div class="tl-empty-sub">Ajoutez des transports, hébergements et activités dans l\'onglet Voyage.</div>'
    + '</div>';
  }

  var html = '';
  var lastDateStr = null;

  events.forEach(function (ev) {
    // ── Séparateur de jour ────────────────────────────────────────
    var dayLabel = ev.dateObj ? _fmtDate(ev.dateObj) : (ev.date || null);
    if (dayLabel !== lastDateStr) {
      lastDateStr = dayLabel;
      var anchorId = ev.dateObj ? ' id="tlday-' + _dayKey(ev.dateObj) + '"' : '';
      html += '<div class="tl-day-header"' + anchorId
        + (ev.dateObj ? ' data-ts="' + ev.dateObj.getTime() + '"' : '') + '>'
        + '<span class="tl-day-label">' + (dayLabel || 'Date non renseignée') + '</span>'
        + '<span class="tl-day-line"></span>'
      + '</div>';
    }

    // ── Carte événement ───────────────────────────────────────────
    var badgeHtml = ev.badge
      ? '<span class="tl-badge" style="background:' + ev.color + '22;color:' + ev.color + ';border-color:' + ev.color + '44">'
          + ev.badge
        + '</span>'
      : '';

    var extraHtml = ev.extra
      ? '<div class="tl-extra">'
          + '<span class="tl-extra-icon">' + ev.extra.icon + '</span>'
          + '<span class="tl-extra-label">' + ev.extra.label + '</span>'
        + '</div>'
      : '';

    var visitedClass = (ev.type === 'lieu' && ev.badge === 'Visité') ? ' tl-card--visited' : '';
    var checkoutClass = ev.type === 'checkout' ? ' tl-card--checkout' : '';

    // Navigation au clic selon le type d'événement
    var clickNav = '';
    if (ev.category === 'transport') {
      clickNav = ' onclick="if(typeof switchSection===\'function\')switchSection(\'mobilite\')" style="cursor:pointer"';
    } else if (ev.type === 'checkin' || ev.type === 'checkout') {
      clickNav = ' onclick="if(typeof switchSection===\'function\')switchSection(\'hotels\')" style="cursor:pointer"';
    } else if (ev.type === 'lieu') {
      clickNav = ' onclick="if(typeof switchSection===\'function\')switchSection(\'lieux\')" style="cursor:pointer"';
    } else if (ev.type === 'pass') {
      clickNav = ' onclick="if(typeof switchSection===\'function\')switchSection(\'mobilite\')" style="cursor:pointer"';
    }

    html += '<div class="tl-item">'
      // Ligne verticale + nœud
      + '<div class="tl-spine">'
        + '<div class="tl-node" style="background:' + ev.color + ';border-color:' + ev.color + '">'
          + ev.icon
        + '</div>'
        + '<div class="tl-line"></div>'
      + '</div>'
      // Contenu cliquable
      + '<div class="tl-card' + visitedClass + checkoutClass + '"' + clickNav + '>'
        + '<div class="tl-card-top">'
          + '<div class="tl-card-type" style="color:' + ev.color + '">'
            + (_TYPE_LABEL[ev.type] || ev.type)
          + '</div>'
          + badgeHtml
        + '</div>'
        + '<div class="tl-card-title">' + ev.title + '</div>'
        + (ev.sub ? '<div class="tl-card-sub">' + ev.sub + '</div>' : '')
        + extraHtml
      + '</div>'
    + '</div>';
  });

  return html;
}


// ── §4bis VUE CALENDRIER (desktop ≥ 1024px) ──────────────────────────
// Grille mensuelle type agenda : chaque jour cliquable ouvre le détail
// de la journée dans un panneau latéral. La vue liste reste la norme
// en mobile. État de navigation conservé entre re-rendus.

var _calY = null, _calM = null;        // mois affiché
var _calSelectedKey = null;            // jour sélectionné 'jj-mm-aaaa'
var _isDesktop = function(){
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(min-width:1024px)').matches;
};

function _dayKey(d){
  var p = function(n){ return n < 10 ? '0' + n : '' + n; };
  return p(d.getDate()) + '-' + p(d.getMonth() + 1) + '-' + d.getFullYear();
}
function _keyToDate(k){
  var m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(k || '');
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}

// Période du voyage : meta si dispo, sinon bornes des événements datés
function _tlPeriod(events){
  if (typeof getTripPeriod === 'function'){
    try{
      var p = getTripPeriod();
      if (p && p.start) return { start: p.start, end: p.end || null };
    }catch(e){}
  }
  var dated = events.filter(function(e){ return e.dateObj; });
  if (!dated.length) return null;
  return { start: dated[0].dateObj, end: dated[dated.length - 1].dateObj };
}

// Événements groupés par clé de jour
function _groupByDay(events){
  var g = {};
  events.forEach(function(ev){
    var k = ev.dateObj ? _dayKey(ev.dateObj) : 'nodate';
    (g[k] = g[k] || []).push(ev);
  });
  return g;
}

var _MOIS_TL = ['Janvier','Février','Mars','Avril','Mai','Juin',
  'Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
var _DOW_TL  = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];

function _renderCalendarView(events){
  var period = _tlPeriod(events);
  var byDay  = _groupByDay(events);
  var today  = new Date(); today.setHours(0,0,0,0);

  // Initialiser le curseur : aujourd'hui si dans la période, sinon début
  if (_calY === null){
    var anchor = today;
    if (period){
      if (period.start && today < _strip(period.start)) anchor = period.start;
      if (period.end   && today > _strip(period.end))   anchor = period.start;
    }
    _calY = anchor.getFullYear(); _calM = anchor.getMonth();
    if (_calSelectedKey === null && period
        && today >= _strip(period.start)
        && (!period.end || today <= _strip(period.end))){
      _calSelectedKey = _dayKey(today);
    }
  }

  function _strip(d){ var x = new Date(d); x.setHours(0,0,0,0); return x; }

  // CLAMP : si le curseur sort de la période (ex: clic « Aujourd'hui »
  // hors voyage), on le ramène dans les bornes — sinon l'utilisateur
  // se retrouve sur un mois vide avec la navigation grisée.
  if (period && period.start){
    var curM   = new Date(_calY, _calM, 1);
    var startM = new Date(period.start.getFullYear(), period.start.getMonth(), 1);
    if (curM < startM){ _calY = startM.getFullYear(); _calM = startM.getMonth(); }
    if (period.end){
      var endM = new Date(period.end.getFullYear(), period.end.getMonth(), 1);
      if (curM > endM){ _calY = endM.getFullYear(); _calM = endM.getMonth(); }
    }
  }

  // Bornes de navigation (mois)
  var canPrev = true, canNext = true;
  if (period && period.start){
    canPrev = new Date(_calY, _calM, 1) > new Date(period.start.getFullYear(), period.start.getMonth(), 1);
  }
  if (period && period.end){
    canNext = new Date(_calY, _calM, 1) < new Date(period.end.getFullYear(), period.end.getMonth(), 1);
  }

  // ── Grille du mois ──
  var first  = new Date(_calY, _calM, 1);
  var offset = (first.getDay() === 0) ? 6 : first.getDay() - 1; // Lun=0
  var nDays  = new Date(_calY, _calM + 1, 0).getDate();

  var grid = '';
  _DOW_TL.forEach(function(d){ grid += '<div class="tlc-dow">' + d + '</div>'; });
  for (var i = 0; i < offset; i++) grid += '<div class="tlc-day tlc-empty"></div>';

  for (var d = 1; d <= nDays; d++){
    var dt   = new Date(_calY, _calM, d);
    var key  = _dayKey(dt);
    var evs  = byDay[key] || [];
    var cls  = 'tlc-day';
    var inTrip = true;
    if (period){
      if (period.start && _strip(dt) < _strip(period.start)) inTrip = false;
      if (period.end   && _strip(dt) > _strip(period.end))   inTrip = false;
    }
    if (!inTrip)                      cls += ' tlc-out';
    if (_strip(dt).getTime() === today.getTime()) cls += ' tlc-today';
    if (key === _calSelectedKey)      cls += ' tlc-selected';
    if (evs.length)                   cls += ' tlc-has';

    var dots = evs.slice(0, 4).map(function(ev){
      return '<span class="tlc-dot" style="background:' + ev.color + '"></span>';
    }).join('');
    var more = evs.length > 4 ? '<span class="tlc-more">+' + (evs.length - 4) + '</span>' : '';

    grid += '<div class="' + cls + '"'
      + (inTrip ? ' onclick="tlSelectDay(\'' + key + '\')"' : '')
      + '><span class="tlc-num">' + d + '</span>'
      + '<span class="tlc-dots">' + dots + more + '</span></div>';
  }

  // ── Panneau du jour sélectionné ──
  var panel;
  var selDate = _keyToDate(_calSelectedKey);
  if (selDate){
    var selEvs = byDay[_calSelectedKey] || [];
    panel = '<div class="tlc-panel-date">' + _fmtDate(selDate) + '</div>'
      + (selEvs.length
          ? _renderEvents(selEvs)
          : '<div class="tlc-panel-empty">Journée libre — aucun événement planifié.</div>');
  } else {
    panel = '<div class="tlc-panel-empty">Sélectionnez un jour dans le calendrier.</div>';
  }

  return '<div class="tlc-toolbar">'
      + '<button class="tlc-nav" ' + (canPrev ? 'onclick="tlCalMove(-1)"' : 'disabled') + '>&#8249;</button>'
      + '<div class="tlc-month-label">' + _MOIS_TL[_calM] + ' ' + _calY + '</div>'
      + '<button class="tlc-nav" ' + (canNext ? 'onclick="tlCalMove(1)"' : 'disabled') + '>&#8250;</button>'
      + '<button class="tlc-today-btn" onclick="tlGoToday()">Aujourd\'hui</button>'
    + '</div>'
    + '<div class="tlc-layout">'
      + '<div class="tlc-grid-wrap"><div class="tlc-grid">' + grid + '</div></div>'
      + '<div class="tlc-panel">' + panel + '</div>'
    + '</div>';
}

// ── Interactions calendrier (exposées pour les onclick inline) ──
window.tlSelectDay = function(key){
  _calSelectedKey = key;
  renderTimeline();
};
window.tlCalMove = function(dir){
  _calM += dir;
  if (_calM > 11){ _calM = 0; _calY++; }
  if (_calM < 0){ _calM = 11; _calY--; }
  renderTimeline();
};
window.tlGoToday = function(){
  var today = new Date(); today.setHours(0,0,0,0);
  if (_isDesktop()){
    // Clamp à la période du voyage : hors période, viser le jour le
    // plus proche (début si voyage futur, fin si voyage passé).
    var target = today;
    var period = _tlPeriod(_buildEvents());
    if (period && period.start){
      var st = new Date(period.start); st.setHours(0,0,0,0);
      var en = period.end ? new Date(period.end) : null;
      if (en) en.setHours(0,0,0,0);
      if (today < st)            target = st;
      else if (en && today > en) target = en;
    }
    _calY = target.getFullYear(); _calM = target.getMonth();
    _calSelectedKey = _dayKey(target);
    renderTimeline();
    return;
  }
  // Mobile : scroller vers le jour courant (ou le prochain jour planifié)
  var headers = Array.prototype.slice.call(
    document.querySelectorAll('.tl-day-header[data-ts]'));
  if (!headers.length) return;
  var ts = today.getTime();
  var target = null;
  for (var i = 0; i < headers.length; i++){
    if (+headers[i].getAttribute('data-ts') >= ts){ target = headers[i]; break; }
  }
  if (!target) target = headers[headers.length - 1]; // voyage passé → fin
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// Re-rendre quand on traverse le breakpoint (liste ↔ calendrier)
if (typeof window.matchMedia === 'function'){
  var _mq = window.matchMedia('(min-width:1024px)');
  var _onMq = function(){
    var sec = document.getElementById('tab-timeline');
    if (sec && sec.classList.contains('active')) renderTimeline();
  };
  if (_mq.addEventListener) _mq.addEventListener('change', _onMq);
  else if (_mq.addListener) _mq.addListener(_onMq);
}


// ── §5 STYLES INJECTÉS ────────────────────────────────────────────────
(function _injectStyles() {
  if (document.getElementById('yume-timeline-styles')) return;
  var s = document.createElement('style');
  s.id = 'yume-timeline-styles';
  s.textContent = [

    /* Conteneur principal */
    '#timeline-container{padding:0 0 80px;}',

    /* Séparateur de jour */
    '.tl-day-header{display:flex;align-items:center;gap:10px;margin:20px 0 10px;padding:0 2px;}',
    '.tl-day-label{font-size:11px;font-weight:600;color:var(--ink-hint);text-transform:uppercase;letter-spacing:.1em;white-space:nowrap;}',
    '.tl-day-line{flex:1;height:1px;background:var(--border);}',

    /* Ligne temporelle */
    '.tl-item{display:flex;gap:0;margin-bottom:4px;align-items:stretch;}',

    /* Épine vertébrale (ligne + nœud) */
    '.tl-spine{display:flex;flex-direction:column;align-items:center;flex-shrink:0;width:40px;}',
    '.tl-node{width:32px;height:32px;border-radius:50%;border:2.5px solid;'
      + 'display:flex;align-items:center;justify-content:center;'
      + 'background:white;flex-shrink:0;color:white;z-index:1;}',
    '.tl-node svg{flex-shrink:0;}',
    '.tl-line{flex:1;width:2px;background:var(--border);margin:4px 0;min-height:8px;}',
    '.tl-item:last-child .tl-line{display:none;}',

    /* Carte événement */
    '.tl-card{flex:1;background:var(--surface);border:1px solid var(--border);'
      + 'border-radius:var(--r-md);padding:10px 14px;margin-left:10px;margin-bottom:4px;'
      + 'box-shadow:var(--shadow-sm);min-width:0;}',
    '.tl-card--checkout{opacity:.7;background:var(--surface-2);}',
    '.tl-card--visited{border-color:#2d8c6b22;background:#f0faf6;}',

    '.tl-card-top{display:flex;align-items:center;gap:8px;margin-bottom:3px;}',
    '.tl-card-type{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;}',
    '.tl-badge{font-size:10px;font-weight:600;padding:1px 7px;border-radius:10px;'
      + 'border:1px solid;letter-spacing:.01em;}',

    '.tl-card-title{font-size:14px;font-weight:600;color:var(--ink);'
      + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.tl-card-sub{font-size:11px;color:var(--ink-muted);margin-top:2px;'
      + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',

    /* Extra (escale) */
    '.tl-extra{display:flex;align-items:center;gap:6px;margin-top:6px;'
      + 'padding:5px 8px;background:var(--surface-2);border-radius:var(--r-sm);'
      + 'font-size:11px;color:var(--ink-muted);}',
    '.tl-extra-icon{flex-shrink:0;opacity:.6;}',

    /* État vide */
    '.tl-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;'
      + 'padding:48px 24px;text-align:center;color:var(--ink-muted);}',
    '.tl-empty-icon{margin-bottom:14px;opacity:.35;}',
    '.tl-empty-title{font-size:15px;font-weight:600;color:var(--ink);margin-bottom:6px;}',
    '.tl-empty-sub{font-size:12px;max-width:260px;line-height:1.6;}',

    /* ── Bouton Aujourd\'hui (vue liste mobile) ── */
    '.tl-list-toolbar{display:flex;justify-content:flex-end;position:sticky;top:6px;z-index:5;margin-bottom:4px;}',
    '.tl-today-chip{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;',
    '  border-radius:20px;border:1px solid var(--border);background:var(--surface);',
    '  color:var(--ink);font-size:12px;font-weight:600;cursor:pointer;',
    '  box-shadow:var(--shadow-sm);font-family:inherit;}',
    '.tl-today-chip:hover{border-color:var(--sakura);color:var(--sakura);}',

    /* ── Vue calendrier (desktop) ── */
    '.tlc-toolbar{display:flex;align-items:center;gap:12px;margin-bottom:14px;}',
    '.tlc-month-label{font-size:17px;font-weight:600;color:var(--ink);min-width:170px;text-align:center;}',
    '.tlc-nav{width:34px;height:34px;border-radius:8px;border:1px solid var(--border);',
    '  background:var(--surface);color:var(--ink);font-size:19px;line-height:1;cursor:pointer;}',
    '.tlc-nav:hover:not(:disabled){border-color:var(--sakura);color:var(--sakura);}',
    '.tlc-nav:disabled{opacity:.3;cursor:default;}',
    '.tlc-today-btn{margin-left:auto;padding:8px 16px;border-radius:8px;border:1px solid var(--border);',
    '  background:var(--surface);color:var(--ink);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;}',
    '.tlc-today-btn:hover{border-color:var(--sakura);color:var(--sakura);}',

    '.tlc-layout{display:grid;grid-template-columns:minmax(0,1fr) 420px;gap:24px;align-items:start;}',
    '.tlc-grid-wrap{background:var(--surface);border:1px solid var(--border);',
    '  border-radius:var(--r-lg);padding:14px;box-shadow:var(--shadow-sm);}',
    '.tlc-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;}',
    '.tlc-dow{font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;',
    '  color:var(--ink-hint);text-align:center;padding:6px 0;}',
    '.tlc-day{position:relative;min-height:100px;border:1px solid var(--border);border-radius:8px;',
    '  padding:6px 7px;background:var(--surface);cursor:pointer;',
    '  display:flex;flex-direction:column;justify-content:space-between;',
    '  transition:border-color .12s, box-shadow .12s;}',
    '.tlc-day:hover{border-color:var(--sakura);}',
    '.tlc-empty{border:none;background:transparent;cursor:default;}',
    '.tlc-out{opacity:.25;cursor:default;pointer-events:none;}',
    '.tlc-num{font-size:15px;font-weight:500;color:var(--ink);font-variant-numeric:tabular-nums;}',
    '.tlc-today .tlc-num{color:var(--sakura);font-weight:700;}',
    '.tlc-today{border-color:var(--sakura);}',
    '.tlc-selected{border-color:var(--sakura);box-shadow:0 0 0 2px var(--sakura-light);background:var(--sakura-light);}',
    '.tlc-dots{display:flex;gap:3px;flex-wrap:wrap;align-items:center;}',
    '.tlc-dot{width:9px;height:9px;border-radius:50%;display:inline-block;}',
    '.tlc-more{font-size:9px;font-weight:700;color:var(--ink-hint);}',

    '.tlc-panel{background:var(--surface);border:1px solid var(--border);',
    '  border-radius:var(--r-lg);padding:16px;box-shadow:var(--shadow-sm);',
    '  max-height:calc(100vh - 220px);overflow-y:auto;}',
    '.tlc-panel-date{font-size:14px;font-weight:600;color:var(--ink);margin-bottom:12px;',
    '  padding-bottom:10px;border-bottom:1px solid var(--border);}',
    '.tlc-panel-empty{font-size:12px;color:var(--ink-muted);padding:18px 4px;line-height:1.6;}',
    '.tlc-panel .tl-day-header{display:none;}', /* le panneau a déjà sa date */

    '@media(max-width:1279.98px){ .tlc-layout{grid-template-columns:1fr;} }',

  ].join('\n');
  document.head.appendChild(s);
})();


// ── §6 POINT D'ENTRÉE PUBLIC ──────────────────────────────────────────

/**
 * renderTimeline()
 * Reconstruit la timeline dans #timeline-container.
 * Appelé automatiquement par les abonnements YumeState.
 */
function renderTimeline() {
  var container = document.getElementById('timeline-container');
  if (!container) return;

  // Guard : pas de voyage actif
  if (!currentTripId || !allTrips[currentTripId]) {
    container.innerHTML = '<div class="tl-empty">'
      + '<div class="tl-empty-icon">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="36" height="36">'
          + '<rect x="3" y="4" width="18" height="18" rx="2"/>'
          + '<line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>'
          + '<line x1="3" y1="10" x2="21" y2="10"/>'
        + '</svg>'
      + '</div>'
      + '<div class="tl-empty-title">Aucun voyage sélectionné</div>'
      + '<div class="tl-empty-sub">Ouvre un voyage depuis l\'accueil pour voir son itinéraire.</div>'
    + '</div>';
    return;
  }

  var events = _buildEvents();

  if (_isDesktop()){
    // Desktop : vue calendrier mensuelle + panneau du jour
    container.innerHTML = events.length
      ? _renderCalendarView(events)
      : _renderEvents(events); // état vide commun
  } else {
    // Mobile : liste chronologique + raccourci « Aujourd'hui »
    var toolbar = events.some(function(e){ return e.dateObj; })
      ? '<div class="tl-list-toolbar">'
        + '<button class="tl-today-chip" onclick="tlGoToday()">'
          + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">'
          + '<rect x="3" y="4" width="18" height="18" rx="2"/>'
          + '<line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>'
          + '<line x1="3" y1="10" x2="21" y2="10"/><circle cx="12" cy="16" r="2.5"/></svg>'
          + 'Aujourd\'hui</button>'
        + '</div>'
      : '';
    container.innerHTML = toolbar + _renderEvents(events);
  }
}
window.renderTimeline = renderTimeline;

/**
 * initTimeline()
 * Appelée par app.js au premier accès à l'onglet Timeline.
 */
function initTimeline() {
  renderTimeline();
}
window.initTimeline = initTimeline;


// ── §7 ABONNEMENTS YUMESTATE ──────────────────────────────────────────

// Rafraîchir la timeline après chaque modification de données
YumeState.on('trip:snapshot', function () {
  // Seulement si la section timeline est visible (pas de rendu à vide)
  var tlSection = document.getElementById('tab-timeline');
  if (tlSection && tlSection.classList.contains('active')) {
    renderTimeline();
  }
});

// Reconstruire au changement de voyage
YumeState.on('trip:changed', function () {
  renderTimeline();
});

// Reconstruire après import
YumeState.on('map:refresh', function () {
  renderTimeline();
});

})(); // fin IIFE timeline
