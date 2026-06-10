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
var _TYPE_LABEL = {
  vol:'✈️ Vol', train:'🚄 Train', bus:'🚌 Bus', bateau:'⛴️ Ferry',
  metro:'🚇 Métro', covoiturage:'🚗 Covoit.', taxi:'🚕 Taxi',
  hotel:'🏨 Hébergement', lieu:'📍 Lieu', pass:'🎫 Pass',
  checkin:'🏨 Arrivée', checkout:'🚪 Départ hôtel',
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
      html += '<div class="tl-day-header">'
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
  container.innerHTML = _renderEvents(events);
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
