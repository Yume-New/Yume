// ══════════════════════════════════════════════════════════════════════
// state.js — Store centralisé & EventBus
// Yume Travel Manager · Phase A · Modularisation
//
// RESPONSABILITÉS
//   1. YumeState : EventBus pub/sub (remplace les 4 monkey-patches)
//   2. Store     : allTrips + currentTripId (source de vérité unique)
//   3. Silo      : snapshotCurrentTrip / restoreTrip / openTrip (guards intégrés)
//   4. Utilitaires partagés : _deepClone, saveAllTrips, _hardResetGlobals
//
// DÉPENDANCES : aucune — chargé en 3e position (après les data/*.js)
//
// ÉVÉNEMENTS DÉFINIS
//   trip:snapshot → émis après chaque sauvegarde dans allTrips
//   trip:restore  → émis après chaque restauration d'un voyage
//   trip:changed  → émis quand currentTripId change (pour les cartes)
//   map:refresh   → émis pour forcer le refresh des deux cartes Leaflet
//   form:rescue   → émis pour réparer les formulaires orphelins
//
// REMPLACEMENT DES PATCHES
//   Ancien : snapshotCurrentTrip wrappé 2× (tripmap + master)
//   Nouveau: 1 fonction native + YumeState.on('trip:snapshot', …)
//
//   Ancien : restoreTrip wrappé 1× (master §1 normalisation clés)
//   Nouveau: normalisation intégrée dans restoreTrip()
//
//   Ancien : openTrip wrappé 1× (master §2 rescue forms)
//   Nouveau: YumeState.emit('form:rescue') dans openTrip()
// ══════════════════════════════════════════════════════════════════════

'use strict';

// ── §1 EVENTBUS ───────────────────────────────────────────────────────
// Interface publique exposée sur window.YumeState
// Pattern pub/sub simple, synchrone, sans dépendance externe
// ─────────────────────────────────────────────────────────────────────
var YumeState = (function () {

  // Registre des abonnements { eventName: [fn, fn, …] }
  var _listeners = Object.create(null);

  // Registre de debug (actif uniquement si ?yume-debug dans l'URL)
  var _debug = typeof window !== 'undefined'
    && window.location
    && window.location.search.indexOf('yume-debug') !== -1;

  function _log(action, event, payload) {
    if (!_debug) return;
    console.groupCollapsed('[YumeState] ' + action + ' · ' + event);
    if (payload !== undefined) console.log('payload:', payload);
    console.groupEnd();
  }

  return {

    /**
     * S'abonner à un événement.
     * @param  {string}   event  Nom de l'événement
     * @param  {Function} fn     Callback(payload)
     * @returns {Function}       Fonction de désabonnement (off)
     */
    on: function (event, fn) {
      if (typeof fn !== 'function') {
        console.warn('[YumeState] on(' + event + '): le listener doit être une Function');
        return function () {};
      }
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(fn);
      _log('SUBSCRIBE', event);

      // Retourner une fonction de désabonnement (cleanup)
      return function off() {
        _listeners[event] = (_listeners[event] || []).filter(function (f) {
          return f !== fn;
        });
        _log('UNSUBSCRIBE', event);
      };
    },

    /**
     * Émettre un événement de façon synchrone.
     * Tous les listeners enregistrés sont appelés dans l'ordre d'abonnement.
     * Une erreur dans un listener n'interrompt pas les suivants.
     * @param {string} event    Nom de l'événement
     * @param {*}      payload  Données passées aux listeners (optionnel)
     */
    emit: function (event, payload) {
      _log('EMIT', event, payload);
      var fns = _listeners[event];
      if (!fns || !fns.length) return;
      // Copie défensive : un listener peut se désabonner pendant l'itération
      fns.slice().forEach(function (fn) {
        try {
          fn(payload);
        } catch (err) {
          console.error('[YumeState] Erreur dans le listener de "' + event + '":', err);
        }
      });
    },

    /**
     * Désabonner tous les listeners d'un événement donné.
     * Utile pour les tests ou la réinitialisation complète.
     * @param {string} event
     */
    off: function (event) {
      delete _listeners[event];
      _log('OFF ALL', event);
    },

    /**
     * Lister les événements actuellement abonnés (debug).
     * @returns {string[]}
     */
    events: function () {
      return Object.keys(_listeners);
    }

  };

})();


// ── §2 STORE : SOURCE DE VÉRITÉ ───────────────────────────────────────
// allTrips       : { [tripId]: TripData }
// currentTripId  : string | null
//
// TripData = {
//   meta         : { name, country, countries, dateDep, dateRet, … },
//   vols         : Vol[],
//   trains       : Train[],
//   mobilites    : Mobilite[],
//   passes       : Pass[],
//   locations    : Location[],
//   hotels       : Hotel[],
//   lieux        : Lieu[],
//   budget       : number,
//   transactions : Transaction[],
//   totalNuits   : number,
//   villeColorMap: { [ville]: colorHex },
//   paletteCursor: number,
//   mapData      : { selectedCountries, visitedCountries, destCountry }
// }
// ─────────────────────────────────────────────────────────────────────
var allTrips      = {};
var currentTripId = null;


// ── §3 ÉTAT LOCAL DU VOYAGE ACTIF ─────────────────────────────────────
// Ces variables sont les "buffers de travail" du voyage courant.
// Elles sont chargées par restoreTrip() et sauvegardées par snapshot.
// Déclarées ici pour être accessibles à snapshotCurrentTrip et restoreTrip.
// app.js peut les lire/modifier directement (elles sont globales).
// ─────────────────────────────────────────────────────────────────────
var vols         = [];
var passes       = [];
var trains       = [];
var mobilites    = [];
var locations    = [];
var hotels       = [];
var lieux        = [];
var budget       = 0;
var transactions = [];
var totalNuits   = 30;
var villeColors  = {
  tokyo:'#e8748a', kyoto:'#c9921a', hiroshima:'#2d8c6b', osaka:'#2d5e8c'
};
var palIdx       = 4;
var currentFilter = 'Tous';
var emodes       = {};


// ── §4 UTILITAIRES PARTAGÉS ───────────────────────────────────────────

/**
 * Copie profonde via JSON.parse/stringify.
 * Garantit l'isolation inter-voyages (aucun objet imbriqué ne partage
 * de référence entre deux trajets différents).
 * @param  {Array} arr
 * @returns {Array}
 */
function _deepClone(arr) {
  if (!arr || !arr.length) return [];
  try { return JSON.parse(JSON.stringify(arr)); }
  catch (e) { return arr.slice(); }
}

/**
 * Copie profonde d'un objet (non-tableau).
 * @param  {Object} obj
 * @returns {Object}
 */
function _deepCloneObj(obj) {
  if (!obj || typeof obj !== 'object') return {};
  try { return JSON.parse(JSON.stringify(obj)); }
  catch (e) { return Object.assign({}, obj); }
}

/**
 * Persistance localStorage.
 * Appelé automatiquement par snapshotCurrentTrip().
 */
function saveAllTrips() {
  try {
    localStorage.setItem('mv_trips', JSON.stringify(allTrips));
  } catch (e) {
    console.warn('[YumeState] saveAllTrips: échec localStorage', e);
  }
}

/**
 * Lecture initiale depuis localStorage.
 * Appelé une seule fois au démarrage de l'app (dans app.js → init).
 * @returns {boolean} true si des données ont été trouvées
 */
function loadAllTrips() {
  try {
    var raw = localStorage.getItem('mv_trips');
    if (!raw) return false;
    var parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      allTrips = parsed;
      return true;
    }
    return false;
  } catch (e) {
    console.warn('[YumeState] loadAllTrips: données corrompues, reset', e);
    allTrips = {};
    return false;
  }
}

/**
 * Générateur d'identifiants de voyage uniques.
 * Format : "t" + timestamp + compteur incrémental
 */
var _tripIdCounter = 0;
function newTripId() {
  return 't' + Date.now() + (++_tripIdCounter);
}

/**
 * Hard reset de toutes les variables d'état local.
 * DOIT être appelé avant chaque restoreTrip() pour garantir
 * l'absence de pollution de données entre voyages.
 *
 * RÈGLE D'ISOLATION : un Vol ne partage jamais de référence
 * avec un Train. Cette fonction matérialise cette garantie.
 */
function _hardResetGlobals() {
  vols          = [];
  passes        = [];
  trains        = [];
  mobilites     = [];
  locations     = [];
  hotels        = [];
  lieux         = [];
  budget        = 0;
  transactions  = [];
  totalNuits    = 30;
  villeColors   = {};
  palIdx        = 4;
  currentFilter = 'Tous';
  emodes        = {};
}

/**
 * Normalise les clés manquantes d'un TripData (rétrocompatibilité).
 * Corrige les voyages créés avant l'introduction de certaines clés.
 * Anciennement : monkey-patch dans Script5 §1.
 * @param {TripData} d
 */
function _normalizeTripData(d) {
  if (!d) return;
  if (!Array.isArray(d.mobilites))    d.mobilites    = [];
  if (!Array.isArray(d.locations))    d.locations    = [];
  if (!Array.isArray(d.passes))       d.passes       = [];
  if (!Array.isArray(d.hotels))       d.hotels       = [];
  if (!Array.isArray(d.lieux))        d.lieux        = [];
  if (!Array.isArray(d.vols))         d.vols         = [];
  if (!Array.isArray(d.trains))       d.trains       = [];
  if (!Array.isArray(d.transactions)) d.transactions = [];
  if (typeof d.budget !== 'number')   d.budget       = 0;
}

/**
 * Parse une date au format DD/MM/YYYY.
 * Dupliqué ici pour que state.js soit autonome (sans dépendance sur app.js).
 * @param {string} s
 * @returns {Date|null}
 */
function _parseDDMMYYYY(s) {
  if (!s) return null;
  var p = s.split('/');
  if (p.length !== 3) return null;
  var d = new Date(+p[2], +p[1] - 1, +p[0]);
  return isNaN(d.getTime()) ? null : d;
}


// ── §5 SILOTAGE — FONCTIONS NATIVES (sans monkey-patching) ───────────

/**
 * snapshotCurrentTrip()
 * Sauvegarde l'état courant dans allTrips[currentTripId] + localStorage.
 * Émet 'trip:snapshot' pour notifier les abonnés (ex : cartes).
 *
 * GUARD INTÉGRÉ : refuse silencieusement si currentTripId est null.
 * Anciennement géré par deux wrappers successifs (tripmap + master).
 */
function snapshotCurrentTrip() {
  // ── Guard P0 : pas de voyage actif ──────────────────────────────
  if (!currentTripId) return;
  if (!allTrips[currentTripId]) {
    console.warn('[YumeState] snapshotCurrentTrip: voyage introuvable pour', currentTripId);
    return;
  }

  var trip = allTrips[currentTripId];

  // ── Copie profonde hermétique de chaque tableau ──────────────────
  // _deepClone brise tout lien de référence entre voyages.
  // Un Vol ne peut jamais affecter un Train par partage d'objet.
  trip.vols         = _deepClone(vols);
  trip.passes       = _deepClone(passes);
  trip.trains       = _deepClone(trains);
  trip.mobilites    = _deepClone(mobilites);
  trip.locations    = _deepClone(locations);
  trip.hotels       = _deepClone(hotels);
  trip.lieux        = _deepClone(lieux);
  trip.budget       = budget;
  trip.transactions = _deepClone(transactions);
  trip.totalNuits   = totalNuits;
  trip.villeColorMap  = _deepCloneObj(villeColors);
  trip.paletteCursor  = palIdx;

  // ── Persistance ──────────────────────────────────────────────────
  saveAllTrips();

  // ── Notification des abonnés ─────────────────────────────────────
  // map-trip.js s'abonne à cet événement pour rafraîchir la carte
  // si l'onglet voyage est visible.
  // Plus de monkey-patching — abonnement déclaré dans map-trip.js.
  YumeState.emit('trip:snapshot', { tripId: currentTripId });
}


/**
 * restoreTrip(tid)
 * Charge un voyage depuis allTrips[tid] dans les variables d'état local.
 * Émet 'trip:restore' après chargement.
 *
 * NORMALISATION INTÉGRÉE : corrige les clés manquantes des anciens voyages.
 * Anciennement géré par un wrapper dans master §1.
 *
 * @param {string} tid  Identifiant du voyage à restaurer
 */
function restoreTrip(tid) {
  // ── Guard : tid valide ───────────────────────────────────────────
  if (!tid || !allTrips[tid]) {
    console.warn('[YumeState] restoreTrip: tid invalide ou voyage introuvable:', tid);
    return;
  }

  // ── Normalisation rétrocompat ────────────────────────────────────
  // Anciennement : monkey-patch Script5 §1
  _normalizeTripData(allTrips[tid]);

  var d = allTrips[tid];

  // ── Hard reset préventif ─────────────────────────────────────────
  // Garantit qu'aucune donnée résiduelle du voyage précédent
  // ne subsiste dans les variables globales.
  _hardResetGlobals();

  // ── Chargement avec copie profonde ───────────────────────────────
  vols         = _deepClone(d.vols);
  passes       = _deepClone(d.passes);
  trains       = _deepClone(d.trains);
  mobilites    = _deepClone(d.mobilites);
  locations    = _deepClone(d.locations);
  hotels       = _deepClone(d.hotels);
  lieux        = _deepClone(d.lieux);
  budget       = d.budget || 0;
  transactions = _deepClone(d.transactions);
  villeColors  = _deepCloneObj(d.villeColorMap || {});
  palIdx       = d.paletteCursor != null ? d.paletteCursor : 4;
  currentFilter = 'Tous';
  emodes        = {};

  // ── Calcul totalNuits ─────────────────────────────────────────────
  // Priorité 1 : valeur stockée explicitement
  // Priorité 2 : calcul depuis les dates meta
  // Priorité 3 : défaut 30
  totalNuits = (function () {
    var stored = d.totalNuits;
    if (typeof stored === 'number' && stored !== 30) return stored;
    var meta = d.meta || {};
    if (meta.dateDep && meta.dateRet) {
      var d1 = _parseDDMMYYYY(meta.dateDep);
      var d2 = _parseDDMMYYYY(meta.dateRet);
      if (d1 && d2) {
        var diff = Math.round((d2 - d1) / 86400000);
        if (diff > 0) return diff;
      }
    }
    return stored || 30;
  })();

  // ── Notification ─────────────────────────────────────────────────
  YumeState.emit('trip:restore', { tripId: tid });
}


/**
 * openTrip(tid)
 * Commute vers un voyage : sauvegarde l'actuel, charge le nouveau.
 * Émet 'form:rescue' pour réparer les formulaires orphelins AVANT
 * le changement de voyage (ordre crucial pour la cohérence DOM).
 * Émet 'trip:changed' après le changement.
 *
 * Anciennement : monkey-patch dans master §2 pour _rescueOrphanForms.
 *
 * @param {string} tid  Identifiant du voyage à ouvrir
 */
function openTrip(tid) {
  if (!allTrips[tid]) {
    console.warn('[YumeState] openTrip: voyage introuvable:', tid);
    return;
  }

  // ── 1. Rescue des formulaires orphelins ──────────────────────────
  // Anciennement : appel direct à _rescueOrphanForms() dans le patch.
  // Maintenant : l'abonné dans app.js fait ce travail proprement.
  YumeState.emit('form:rescue');

  // ── 2. Sauvegarder le voyage précédent ───────────────────────────
  if (currentTripId && currentTripId !== tid) {
    snapshotCurrentTrip();
  }

  // ── 3. Charger le nouveau voyage ──────────────────────────────────
  currentTripId = tid;
  restoreTrip(tid);

  // ── 4. Notification du changement ─────────────────────────────────
  // La carte monde, la carte voyage et le header s'abonnent à cet
  // événement pour se mettre à jour sans couplage direct.
  YumeState.emit('trip:changed', { tripId: tid, meta: allTrips[tid].meta || {} });
}


// ── §6 ABONNEMENTS PAR DÉFAUT ─────────────────────────────────────────
// Ces abonnements remplacent les comportements codés dans les patches.
// Ils sont déclarés ici pour garantir leur priorité d'exécution.
// Des abonnements supplémentaires sont ajoutés dans map-world.js,
// map-trip.js et app.js.
// ─────────────────────────────────────────────────────────────────────

// Rafraîchissement de la carte voyage après snapshot
// Anciennement : monkey-patch Script4 (tripmap, l.14754)
YumeState.on('trip:snapshot', function () {
  // La carte ne se rafraîchit que si l'onglet voyage est visible
  var futurPage = document.getElementById('page-futur');
  if (futurPage && futurPage.classList.contains('active')) {
    setTimeout(function () {
      if (typeof initTripMap === 'function') initTripMap();
    }, 300);
  }
});

// Rescue des formulaires orphelins au changement de voyage
// Anciennement : monkey-patch Script5 §2 (master, l.14862)
YumeState.on('form:rescue', function () {
  var overlay = document.getElementById('form-modal-overlay');
  if (!overlay) return;
  var FORM_IDS = [
    'form-mobilite', 'form-location', 'form-hotel',
    'form-lieu', 'form-vol', 'form-train'
  ];
  FORM_IDS.forEach(function (fid) {
    var form = document.getElementById(fid);
    if (!form) return;
    var anchor = document.getElementById('_form_anchor_' + fid);
    if (form.parentNode === overlay) {
      form.classList.remove('open');
      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(form, anchor);
        anchor.remove();
      }
    }
  });
  overlay.classList.remove('open');
  // Nettoyer la référence au formulaire ouvert (var dans app.js)
  if (typeof _currentOpenForm !== 'undefined') {
    _currentOpenForm = null;
  }
  document.body.style.overflow = '';
});

// Rescue au chargement initial (protection après reload brutal)
// Anciennement : DOMContentLoaded dans master §2 (l.14871)
document.addEventListener('DOMContentLoaded', function () {
  setTimeout(function () {
    YumeState.emit('form:rescue');
  }, 200);
});


// ── §7 COMPATIBILITÉ TRANSITION ───────────────────────────────────────
// Pendant la Phase A, le monolithe Yume_v11.html déclare encore
// ses propres var allTrips / currentTripId et ses propres fonctions.
// Pour que state.js coexiste sans conflit :
//
// 1. Les var redéclarées dans app.js sont des no-ops (même scope global).
// 2. Les fonctions snapshotCurrentTrip / restoreTrip / openTrip définies
//    ici prennent le pas sur celles du monolithe SI state.js est chargé
//    AVANT le monolithe dans index.html (ordre respecté par le plan).
// 3. Les monkey-patches du Script4 et Script5 deviennent des no-ops
//    (ils wrappent une fonction déjà sécurisée) → inoffensifs pendant
//    la transition, retirés à l'Étape 4 (migration app.js).
//
// VÉRIFICATION : ouvrir la console avec ?yume-debug pour voir les émissions
// ─────────────────────────────────────────────────────────────────────
