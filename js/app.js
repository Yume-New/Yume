// ══════════════════════════════════════════════════════════════════════
// app.js — Logique principale Yume Travel Manager
// Phase A · Modularisation
//
// Extrait de Yume_v11.html avec suppressions chirurgicales :
//   - allTrips, currentTripId, snapshotCurrentTrip, restoreTrip → state.js
//   - _deepClone, _deepCloneObj, saveAllTrips, newTripId → state.js
//   - CITY_DATA, STATION_DATA, PAYS_SEED → geo-defaults.js
//   - AIRLINES, RAIL_COMPANIES → transport-refs.js
//   - COUNTRY_CURRENCY, CURRENCY_INFO, FALLBACK_RATES → finance-data.js
//   - isoToFlag, initLeafletMap, map world logic → map-world.js
//   - initTripMap, _geocode, _drawRoutes, map trip logic → map-trip.js
//   - Monkey-patches §1§2 → remplacés par YumeState events (state.js)
//
// DÉPENDANCES : geo-defaults.js, transport-refs.js, finance-data.js,
//               state.js, map-world.js, map-trip.js
// ══════════════════════════════════════════════════════════════════════

// ── Migration au démarrage ───────────────────────────────────────────
// Normalise les données des voyages chargés depuis localStorage.
// Appelé dans _initApp() après loadAllTrips().
function _migrateAllTrips(){
  Object.keys(allTrips||{}).forEach(function(tid){
    var t = allTrips[tid];
    if(!t) return;
    if(!Array.isArray(t.mobilites))   t.mobilites   = [];
    if(!Array.isArray(t.locations))   t.locations   = [];
    if(!Array.isArray(t.vols))        t.vols        = [];
    if(!Array.isArray(t.passes))      t.passes      = [];
    if(!Array.isArray(t.trains))      t.trains      = [];
    if(!Array.isArray(t.hotels))      t.hotels      = [];
    if(!Array.isArray(t.lieux))       t.lieux       = [];
    if(!Array.isArray(t.documents))   t.documents   = [];
    if(!Array.isArray(t.transactions))t.transactions= [];
    if(typeof t.budget !== 'number') t.budget = 0;
    if(typeof t.totalNuits !== 'number') t.totalNuits = 30;
    if(t.hotels) t.hotels.forEach(_migrateAddress);
    if(t.lieux)  t.lieux.forEach(_migrateAddress);
    if(t.mobilites) t.mobilites.forEach(_migrateVol);
    // Migration pièce jointe document : champ historique `file` → `pdfId`
    // (convention partagée avec hôtels/vols/pass/transactions/docs perso).
    // Idempotente + non-destructive : ne touche pas le blob dans pdfStore,
    // renomme seulement le pointeur. Une fois `pdfId` posé, no-op.
    if(t.documents) t.documents.forEach(function(d){
      if(d && d.file && !d.pdfId){ d.pdfId = d.file; delete d.file; }
    });
  });
}

// ── Migration vol : segment2 (escale unique) → escales[] riche (multi-segments) ──
// Idempotente via le drapeau _volV2. Rétro-compat : vol direct = escales:[].
//   Ancien : m.segment2 = {dep(=escale), arr(=destination finale), codeDep, codeArr,
//            heureDep, heureArr, dureeVol, compagnie, numero, siege, resa, bagages, dureeEscale}
//   Nouveau : m.escales = [{aeroport, code, lat, lng, dureeEscale, heureArrEscale,
//            heureDep, dureeVol, compagnie, numero, siege, terminal, porte, resa, bagages}]
function _migrateVol(m){
  if(!m || m.type !== 'vol') return m;
  // ── v2 : segment2 → escales[] (une seule fois, marqueur _volV2) ──
  if(!m._volV2){
    var s2 = m.segment2;
    if(s2 && (s2.dep || s2.arr)){
      m.escales = [{
        aeroport      : s2.dep || '',
        code          : s2.codeDep || '',
        lat           : (typeof s2.lat === 'number') ? s2.lat : null,
        lng           : (typeof s2.lng === 'number') ? s2.lng : null,
        dureeEscale   : s2.dureeEscale || '',
        heureArrEscale: m.heureArr || '',   // atterrissage à l'escale (arrivée du segment 1)
        heureDep      : s2.heureDep || '',   // départ du segment 2 (escale → destination)
        dureeVol      : s2.dureeVol || '',
        compagnie     : s2.compagnie || '',
        numero        : s2.numero || '',
        siege         : s2.siege || '',
        terminal      : '',
        porte         : '',
        resa          : s2.resa || '',
        bagages       : s2.bagages || ''
      }];
      // Destination finale = segment2.arr (sinon on garde m.arr)
      if(s2.arr){
        m.arr      = s2.arr;
        m.codeArr  = s2.codeArr || m.codeArr || '';
        m.heureArr = s2.heureArr || '';
      }
    } else {
      // Vol direct (ou segment2 vide) : aucune escale.
      m.escales = [];
    }
    m._volV2 = true;
  }
  // ── v3 : purge de segment2 ──
  // Tous les lecteurs utilisent escales[] via _volChain (qui privilégie escales[]).
  // Une fois escales[] en place, segment2 est de la donnée morte → on le supprime.
  // Idempotent (segment2 déjà absent = no-op). Le fallback segment2 de _volChain
  // ne subsiste que comme filet pour un éventuel vol non passé par cette migration.
  if(m.segment2) delete m.segment2;
  return m;
}



// ══════════════════════════════════════════
// MULTI-VOYAGES — Stockage & navigation
// ══════════════════════════════════════════
// [migrated to module — see header]

// Données de tous les voyages : { [tripId]: { meta, vols, passes, trains, hotels, lieux, budget, transactions, totalNuits, villeColorMap, paletteCursor } }
// [migrated to module — see header]

// ── Lecture / Écriture localStorage ──
// [migrated to module — see header]
// ═══════════════════════════════════════════════════════════════
// ADRESSE STRUCTURÉE — helper de concaténation
// Champs : rue (N° + voie), cp (code postal), ville, pays
// ═══════════════════════════════════════════════════════════════
function buildFullAddress(rue, cp, ville, pays){
  var parts = [];
  if(rue  && rue.trim())  parts.push(rue.trim());
  var loc = [cp&&cp.trim(), ville&&ville.trim()].filter(Boolean).join(' ');
  if(loc) parts.push(loc);
  if(pays && pays.trim()) parts.push(pays.trim());
  return parts.join(', ');
}

// ── Collecte les 4 champs adresse d'un formulaire via préfixe ──
// prefix = 'ht' → lit ht-pays, ht-ville-addr (ou ht-ville), ht-cp, ht-rue
// prefix = 'lieu' → lit lieu-pays, lieu-ville-addr, lieu-cp, lieu-rue
function _collectAddrFields(prefix){
  var g = function(id){ var e=document.getElementById(id); return e ? e.value.trim() : ''; };
  var ville = g(prefix+'-ville-addr') || g(prefix+'-ville');
  return {
    pays:  g(prefix+'-pays'),
    ville: ville,
    cp:    g(prefix+'-cp'),
    rue:   g(prefix+'-rue')
  };
}

// ── Sync champ ville du bloc adresse → champ legacy + filtre lieux ──
function syncLieuVille(val){
  var legacy = document.getElementById('lieu-ville');
  if(legacy) legacy.value = val;
}

// ── Autocomplete ville dans le bloc adresse hôtel ──
function onHotelVilleAddrInput(val){
  // Sync vers le champ legacy hidden
  var legacyVille = document.getElementById('ht-ville');
  if(legacyVille) legacyVille.value = val;
  // Réutiliser l'autocomplete existant si disponible
  if(typeof onHotelVilleInput === 'function') onHotelVilleInput(val);
}

// ═══════════════════════════════════════════════════════════════
// VÉRIFIER L'ADRESSE — Geocodage Nominatim avec feedback visuel
// context : 'hotel' | 'lieu' | 'hotel-edit' | 'lieu-edit'
//
// ── §A  SANITIZER : nettoie les champs avant envoi ──────────────
// Détecte un CP glissé dans le champ Ville (ex: "Tokyo 168-0073")
// → extrait le CP dans le bon champ, ne laisse que la ville pure.
// ── §B  CASCADE NOMINATIM ────────────────────────────────────────
// Tentative 1 : Rue + CP + Ville + Pays  (précision max)
// Tentative 2 : CP  + Ville + Pays       (fiable au Japon/Asie)
// Tentative 3 : Ville + Pays             (centre-ville fallback)
// ═══════════════════════════════════════════════════════════════

/**
 * §A — Sanitize les champs adresse d'un formulaire.
 * Si le champ Ville contient un code postal, on le transfère dans CP
 * et on ne laisse que le nom de ville dans le champ Ville.
 * @param {string} prefix  ex: 'ht', 'lieu', 'eh', 'el'
 * @returns {{rue,cp,ville,pays}}  valeurs nettoyées
 */
function _sanitizeAddrFields(prefix){
  var g=function(s){var e=document.getElementById(prefix+'-'+s);return e?e.value.trim():'';};
  var s=function(s,v){
    var e=document.getElementById(prefix+'-'+s);
    if(e&&e.value.trim()!==v){e.value=v;_flashField(prefix+'-'+s);}
  };

  var pays=g('pays');
  var cp=g('cp');
  var rue=g('rue');
  // Ville : peut être dans -ville-addr (visible) ou -ville (hidden legacy)
  var villeEl=document.getElementById(prefix+'-ville-addr')||document.getElementById(prefix+'-ville');
  var ville=villeEl?villeEl.value.trim():'';

  // Détecter un CP embarqué dans le champ ville, ex: "Tokyo 168-0073" ou "Paris 75001"
  var cpInVille=ville.match(/\b(\d{3,7}-\d{2,4})\b/)||ville.match(/\b(\d{5,7})\b/)||ville.match(/\b(\d{3,4})\b/);
  if(cpInVille){
    var cpFound=cpInVille[1];
    // Ne migrer que si le champ CP est vide ou identique
    if(!cp||cp===cpFound){
      // Écrire dans le champ CP
      s('cp',cpFound);
      cp=cpFound;
      // Retirer le CP + tirets/chiffres résiduels du champ Ville
      var villeClean=ville
        .replace(cpFound,'')
        .replace(/[-–]\s*\d+/g,'')
        .replace(/\b\d+\b/g,'')
        .replace(/^[-–\s,]+|[-–\s,]+$/g,'')
        .replace(/\s{2,}/g,' ')
        .trim();
      if(villeClean){
        // Mettre à jour le champ ville-addr et le hidden legacy
        if(villeEl) villeEl.value=villeClean;
        _flashField(villeEl?villeEl.id:(prefix+'-ville'));
        var legacyV=document.getElementById(prefix+'-ville');
        if(legacyV&&legacyV!==villeEl) legacyV.value=villeClean;
        ville=villeClean;
      }
    }
  }

  return {rue:rue, cp:cp, ville:ville, pays:pays};
}

/**
 * §B — Cascade de recherches Nominatim.
 * @param {string[]} queries  Liste ordonnée de requêtes à essayer
 * @param {function} onSuccess  callback(data[0]) quand une réussit
 * @param {function} onFail     callback() si toutes échouent
 * @param {number}   [idx=0]    index courant (récursion interne)
 */
function _nominatimCascade(queries,onSuccess,onFail,idx){
  idx=idx||0;
  if(idx>=queries.length){onFail();return;}
  var q=queries[idx].trim();
  if(!q){_nominatimCascade(queries,onSuccess,onFail,idx+1);return;}
  var ccParam = (window._nominatimCountryCodes) ? '&countrycodes='+encodeURIComponent(window._nominatimCountryCodes) : '';
  fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q='+encodeURIComponent(q)+ccParam,
    {headers:{'Accept-Language':'fr,en'}})
  .then(function(r){return r.json();})
  .then(function(data){
    if(data&&data.length){
      onSuccess(data[0],idx+1,queries.length); // succès
    } else {
      _nominatimCascade(queries,onSuccess,onFail,idx+1); // passer à la suivante
    }
  })
  .catch(function(){onFail(true);/* erreur réseau = stop immédiat */});
}
// ── Reset formulaire ──
function _resetFormFields(ctx){
  var ids={hotel:['ht-nom','ht-ville','ht-ville-addr','ht-ci','ht-co','ht-nuits','ht-type','ht-resa','ht-rue','ht-cp','ht-pays','ht-adresse-lat','ht-adresse-lng','hotel-pdf','ht-magic-input'],
    lieu:['lieu-nom','lieu-emoji','lieu-ville','lieu-ville-addr','lieu-categorie','lieu-ouverture','lieu-fermeture','lieu-rue','lieu-cp','lieu-pays','lieu-note','lieu-pdf','lieu-adresse-lat','lieu-adresse-lng','lieu-magic-input']}[ctx];
  if(!ids)return;
  // Reset natif du formulaire (vide selects, radios, checkboxes, hidden)
  var formId=ctx==='hotel'?'form-hotel':'form-lieu';
  var formEl=document.getElementById(formId);
  if(formEl&&typeof formEl.reset==='function') formEl.reset();
  // Reset champ par champ (couvre les champs hors <form> et les cas edge)
  ids.forEach(function(id){var el=document.getElementById(id);if(el){el.value='';el.classList.remove('addr-autofilled');}});
  var p=ctx==='hotel'?'ht':'lieu';
  var r=document.getElementById(p+'-addr-result');if(r){r.className='addr-result-badge';r.textContent='';}
  var b=document.getElementById(p+'-verify-btn');if(b)b.className='btn-verify-addr';
  var mr=document.getElementById(p+'-magic-result');if(mr){mr.className='magic-addr-result';mr.textContent='';}
  var pb=document.getElementById(ctx==='hotel'?'hotel-pdf-badge':'lieu-pdf-badge');if(pb)pb.innerHTML='';
  if(ctx==='hotel'){
    ['hint-ht-ci','hint-ht-co','hint-ht-nuits'].forEach(function(id){var e=document.getElementById(id);if(e)e.classList.remove('visible');});
    ['ht-ci','ht-co','ht-nuits'].forEach(function(id){var e=document.getElementById(id);if(e)e.classList.remove('auto-filled');});
    ['ht-ci-jour','ht-ci-mois','ht-co-jour','ht-co-mois'].forEach(function(id){var e=document.getElementById(id);if(e)e.selectedIndex=0;});
  }
}
// ── Parser Adresse Magique ──
function parseMagicAddress(ctx){
  var p=ctx==='hotel'?'ht':'lieu';
  var inp=document.getElementById(p+'-magic-input'),btn=document.getElementById(p+'-magic-btn'),res=document.getElementById(p+'-magic-result');
  if(!inp||!btn||!res)return;
  var raw=inp.value.trim();
  if(!raw){res.className='magic-addr-result ko';res.textContent='Colle une adresse à parser.';return;}
  btn.disabled=true;btn.textContent='⏳…';
  res.className='magic-addr-result';res.textContent='';
  fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q='+encodeURIComponent(raw),{headers:{'Accept-Language':'fr,en'}})
  .then(function(r){return r.json();})
  .then(function(data){
    btn.disabled=false;btn.innerHTML='Parser';
    var filled=[];
    if(data&&data.length){
      var d=data[0],addr=d.address||{};
      filled=_parseAndFill(p,addr);
      var nomId=p==='ht'?'ht-nom':'lieu-nom',nomEl=document.getElementById(nomId);
      if(nomEl&&!nomEl.value&&d.display_name){nomEl.value=d.display_name.split(',')[0].trim();_flashField(nomId);filled.push('nom');}
    }
    if(!filled.length)filled=_parseMagicBySplit(p,raw);
    res.className=filled.length?'magic-addr-result ok':'magic-addr-result ko';
    res.textContent=filled.length?filled.join(', ')+' remplis':'Adresse non reconnue.';
  })
  .catch(function(){
    btn.disabled=false;btn.innerHTML='Parser';
    var fb=_parseMagicBySplit(p,raw);
    res.className=fb.length?'magic-addr-result ok':'magic-addr-result ko';
    res.textContent=fb.length?+fb.join(', ')+' (mode hors-ligne)':'Erreur de connexion.';
  });
}
function _parseMagicBySplit(p,raw){
  var parts=raw.split(',').map(function(x){return x.trim();}).filter(Boolean);
  if(parts.length<2)return [];
  var filled=[],last=parts[parts.length-1],bef=parts[parts.length-2]||'';

  // ── Pays : dernier segment sans chiffres
  var pEl=document.getElementById(p+'-pays');
  if(pEl&&!pEl.value&&last.length>2&&!/\d/.test(last)){pEl.value=last;_flashField(p+'-pays');filled.push('pays');}

  // ── Code postal : supporte formats "168-0073", "75001", "604-8344"
  // On cherche d'abord un CP avec tiret (ex: 168-0073) puis sans tiret (ex: 75001)
  var cpM=bef.match(/\b(\d{3,7}-\d{2,4})\b/)||bef.match(/\b(\d{3,7})\b/);
  var cp=cpM?cpM[1]:'';

  // ── Ville : supprimer le CP complet (avec tiret) + nettoyer tirets/chiffres résiduels
  var vil=bef;
  if(cp){
    // Retirer le CP exact de la chaîne
    vil=vil.replace(cp,'');
    // Nettoyer les tirets et chiffres isolés résiduels (ex: " -0073" ou " 168 ")
    vil=vil.replace(/[-–]\s*\d+/g,'').replace(/\b\d+\b/g,'').trim();
    // Nettoyer les tirets de début/fin et espaces multiples
    vil=vil.replace(/^[-–\s]+|[-–\s]+$/g,'').replace(/\s{2,}/g,' ').trim();
  }

  var cpEl=document.getElementById(p+'-cp'),vaEl=document.getElementById(p+'-ville-addr'),vlEl=document.getElementById(p+'-ville');
  if(cp&&cpEl&&!cpEl.value){cpEl.value=cp;_flashField(p+'-cp');filled.push('CP');}
  if(vil&&vaEl&&!vaEl.value){vaEl.value=_normalizeLieuVille(vil);_flashField(p+'-ville-addr');filled.push('ville');}
  if(vil&&vlEl)vlEl.value=_normalizeLieuVille(vil);
  if(parts.length>=3){var rue=parts.slice(0,parts.length-2).join(', ');var rEl=document.getElementById(p+'-rue');if(rEl&&!rEl.value){rEl.value=rue;_flashField(p+'-rue');filled.push('rue');}}

  // ── Recherche carte : ville + pays (plus robuste que l'adresse complète)
  var vilFinal=vaEl?vaEl.value.trim():'';
  var paysFinal=pEl?pEl.value.trim():'';
  var searchQuery=([vilFinal,paysFinal].filter(Boolean).join(', '))||raw;
  // Stocker la requête optimisée pour verifierAdresse (réutilisée si besoin)
  var mInp=document.getElementById(p+'-magic-input');
  if(mInp&&searchQuery&&searchQuery!==raw) mInp.dataset.geocodeQuery=searchQuery;

  return filled;
}
// ── Flash champ auto-rempli ──
function _flashField(id){
  var el=document.getElementById(id);if(!el)return;
  el.classList.remove('addr-autofilled');void el.offsetWidth;
  el.classList.add('addr-autofilled');
  el.addEventListener('animationend',function(){el.classList.remove('addr-autofilled');},{once:true});
}
// ── Parsing Nominatim → champs formulaire ──
function _parseAndFill(prefix,addr){
  var ville=addr.city||addr.town||addr.village||addr.municipality||addr.county||'';
  var cp=addr.postcode||'',pays=addr.country||'';
  var rn=addr.house_number||'',rv=addr.road||addr.pedestrian||addr.footway||'';
  var rue=[rn,rv].filter(Boolean).join(' ');
  var filled=[];
  if(ville){
    var vaEl=document.getElementById(prefix+'-ville-addr');
    var vlEl=document.getElementById(prefix+'-ville');
    if(vaEl){vaEl.value=ville;_flashField(prefix+'-ville-addr');filled.push('ville');}
    if(vlEl)vlEl.value=ville;
  }
  if(cp){var cpEl=document.getElementById(prefix+'-cp');if(cpEl&&!cpEl.value){cpEl.value=cp;_flashField(prefix+'-cp');filled.push('CP');}}
  if(pays){var pEl=document.getElementById(prefix+'-pays');if(pEl&&!pEl.value){pEl.value=pays;_flashField(prefix+'-pays');filled.push('pays');}}
  if(rue){var rEl=document.getElementById(prefix+'-rue');if(rEl){rEl.value=rue;_flashField(prefix+'-rue');filled.push('rue');}}
  var catEl=document.getElementById(prefix+'-categorie')||document.getElementById('lieu-categorie');
  if(catEl&&!catEl.value){
    var det=_detectCatFromAddr(addr.amenity||'',addr.tourism||'',addr.name||'');
    if(det){catEl.value=det;_flashField(prefix+'-categorie');filled.push('cat\u00e9gorie');}
  }
  return filled;
}
function _detectCatFromAddr(amenity,tourism,raw){
  var a=amenity.toLowerCase(),t=tourism.toLowerCase(),r=raw.toLowerCase();
  if(a==='restaurant'||a==='cafe'||a==='food_court')return 'Restaurants';
  if(a==='place_of_worship'||t==='shrine'||r.indexOf('temple')!==-1)return 'Temples';
  if(t==='museum')return 'Mus\u00e9es';
  if(a==='marketplace'||r.indexOf('march\u00e9')!==-1||r.indexOf('market')!==-1)return 'March\u00e9s';
  if(t==='theme_park'||r.indexOf('parc')!==-1||r.indexOf('park')!==-1)return 'Parcs';
  if(r.indexOf('onsen')!==-1||r.indexOf('bain')!==-1)return 'Onsen';
  if(t==='castle'||r.indexOf('castle')!==-1||r.indexOf('ch\u00e2teau')!==-1)return 'Ch\u00e2teaux';
  if(r.indexOf('plage')!==-1||r.indexOf('beach')!==-1)return 'Plages';
  if(a==='clothes'||a==='mall'||r.indexOf('shopping')!==-1)return 'Shopping';
  return '';
}
function verifierAdresse(context){
  var cfg={
    'hotel':     {prefix:'ht',  btnId:'ht-verify-btn',   resId:'ht-addr-result',   latId:'ht-adresse-lat',  lngId:'ht-adresse-lng'},
    'lieu':      {prefix:'lieu',btnId:'lieu-verify-btn', resId:'lieu-addr-result', latId:'lieu-adresse-lat',lngId:'lieu-adresse-lng'},
    'hotel-edit':{prefix:'eh',  btnId:'eh-verify-btn',   resId:'eh-addr-result',   latId:null, lngId:null},
    'lieu-edit': {prefix:'el',  btnId:'el-verify-btn',   resId:'el-addr-result',   latId:null, lngId:null}
  }[context];
  if(!cfg)return;

  var btn=document.getElementById(cfg.btnId),res=document.getElementById(cfg.resId);
  if(!btn||!res)return;

  // §A — Sanitizer : nettoie les champs et retourne les valeurs propres
  var addr=_sanitizeAddrFields(cfg.prefix);
  var rue=addr.rue,cp=addr.cp,ville=addr.ville,pays=addr.pays;

  if(!ville&&!rue&&!pays){
    showToast('Remplis au moins la Ville ou le Pays pour vérifier', 'warn');
    return;
  }

  // §B — Construire la cascade de 3 requêtes (du plus précis au plus large)
  var q1=buildFullAddress(rue,cp,ville,pays);          // Rue+CP+Ville+Pays
  var q2=[cp,ville,pays].filter(Boolean).join(', ');   // CP+Ville+Pays
  var q3=[ville,pays].filter(Boolean).join(', ');      // Ville+Pays (fallback)

  // Dédupliquer (si rue vide, q1===q2 par ex.)
  var queries=[q1,q2,q3].filter(function(q,i,a){return q&&a.indexOf(q)===i;});

  // Paramètre countrycodes pour restreindre la recherche au pays sélectionné
  window._nominatimCountryCodes = window._activeAddrCountryISO || (typeof countryToISO==='function' ? (countryToISO(pays)||'').toLowerCase() : '');

  btn.className='btn-verify-addr';
  btn.innerHTML='<span class="verify-spin"></span> Vérification…';
  btn.disabled=true;
  res.className='addr-result-badge';res.textContent='';

  _nominatimCascade(
    queries,
    // ── Succès ──
    function(d,attemptNo,totalAttempts){
      btn.disabled=false;
      var lat=parseFloat(d.lat),lng=parseFloat(d.lon),addrObj=d.address||{};
      if(cfg.latId){var le=document.getElementById(cfg.latId);if(le)le.value=lat;}
      if(cfg.lngId){var le2=document.getElementById(cfg.lngId);if(le2)le2.value=lng;}
      var filled=_parseAndFill(cfg.prefix,addrObj);
      btn.className='btn-verify-addr verified';
      var attemptLabel=attemptNo>1?' (tentative '+attemptNo+'/'+totalAttempts+')':'';
      btn.innerHTML='<span class="verify-icon" style="color:#1e7a45">&#10003;</span> Adresse trouvée'+attemptLabel+(filled.length?' · '+filled.join(', ')+' ✨':'');
      res.className='addr-result-badge visible ok';
      var dn=d.display_name?d.display_name.split(',').slice(0,4).join(', '):queries[attemptNo-1];
      res.textContent=dn+' · '+lat.toFixed(5)+', '+lng.toFixed(5);
    },
    // ── Échec total ──
    function(networkErr){
      btn.disabled=false;
      if(networkErr){
        btn.className='btn-verify-addr error';
        btn.innerHTML='<span class="verify-icon" style="color:#c9921a">!</span> Erreur réseau';
        res.className='addr-result-badge visible ko';
        res.textContent="Connexion requise pour vérifier l'adresse.";
      } else {
        btn.className='btn-verify-addr error';
        btn.innerHTML='<span class="verify-icon" style="color:#c9921a">!</span> Introuvable';
        res.className='addr-result-badge visible ko';
        res.textContent='Adresse non reconnue — vérifie le nom de la ville et du pays.';
      }
    }
  );
}

// Migration rétrocompat : si un item a l'ancien champ 'adresse' mais pas les nouveaux,
// on tente de décomposer ou on le conserve dans 'rue' pour ne rien perdre.
function _migrateAddress(item){
  if(!item.rue && !item.cp && !item.pays && item.adresse){
    item.rue = item.adresse; // conserver l'ancienne valeur dans rue
  }
  if(!item.fullAddress){
    item.fullAddress = buildFullAddress(item.rue||'', item.cp||'', item.ville||'', item.pays||'');
    if(!item.fullAddress && item.adresse) item.fullAddress = item.adresse; // fallback legacy
  }
}

// ── Peupler les datalists pays (hébergements + lieux) ──
// ── Construire le <select> pays pour un formulaire ──
function _buildPaysSelect(selectId){
  var el = document.getElementById(selectId);
  if(!el) return;

  // Pays du voyage actif
  var tripCountries = [];
  if(currentTripId && allTrips[currentTripId]){
    var meta = allTrips[currentTripId].meta || {};
    tripCountries = (meta.countries && meta.countries.length) ? meta.countries : (meta.country ? [meta.country] : []);
  }

  // Tous les pays connus
  var seed = typeof PAYS_SEED !== 'undefined' ? PAYS_SEED : [];
  var extra = [];
  Object.keys(allTrips||{}).forEach(function(tid){
    var c = (allTrips[tid].meta||{}).country;
    if(c && extra.indexOf(c) === -1) extra.push(c);
    ((allTrips[tid].meta||{}).countries||[]).forEach(function(cc){
      if(cc && extra.indexOf(cc) === -1) extra.push(cc);
    });
  });
  var allCountries = seed.concat(extra.filter(function(c){ return seed.indexOf(c) === -1; }))
    .sort(function(a,b){ return a.localeCompare(b,'fr'); });

  var html = '<option value="">— Choisir un pays —</option>';

  // Optgroup voyage actif
  if(tripCountries.length){
    html += '<optgroup label="🌏 Pays du voyage">';
    tripCountries.forEach(function(c){
      var flag = isoToFlag(countryToISO(c));
      html += '<option value="'+c.replace(/"/g,'&quot;')+'">'+flag+' '+c+'</option>';
    });
    html += '</optgroup>';
    html += '<optgroup label="─── Autres pays ───">';
    allCountries.filter(function(c){ return tripCountries.indexOf(c) === -1; }).forEach(function(c){
      html += '<option value="'+c.replace(/"/g,'&quot;')+'">'+c+'</option>';
    });
    html += '</optgroup>';
  } else {
    allCountries.forEach(function(c){
      html += '<option value="'+c.replace(/"/g,'&quot;')+'">'+c+'</option>';
    });
  }

  el.innerHTML = html;
}

// ── Peupler les selects pays (hébergements + lieux) ──
function _populatePaysDatalists(){
  _buildPaysSelect('ht-pays');
  _buildPaysSelect('lieu-pays');
}

// Appel au chargement initial et à chaque ouverture de voyage
document.addEventListener('DOMContentLoaded', _populatePaysDatalists);

// ── Pré-remplir le pays à partir du voyage actif ──
function _prefillPaysFromTrip(fieldId){
  if(!currentTripId || !allTrips[currentTripId]) return;
  var meta = allTrips[currentTripId].meta || {};
  var countries = (meta.countries && meta.countries.length) ? meta.countries : (meta.country ? [meta.country] : []);
  if(!countries.length) return;
  _buildPaysSelect(fieldId);
  var el = document.getElementById(fieldId);
  if(el && !el.value) el.value = countries[0];
  // Déclencher la liaison devise/parser
  if(el && el.value){
    var prefix = fieldId === 'ht-pays' ? 'ht' : 'lieu';
    onPaysFormChange(prefix, el.value);
  }
}

// ── Liaison Pays → Devise + Parser ──
function onPaysFormChange(prefix, pays){
  if(!pays) return;
  // 1. Devise : suggérer la monnaie locale dans le budget
  var currency = (typeof COUNTRY_CURRENCY !== 'undefined') ? (COUNTRY_CURRENCY[pays] || '') : '';
  if(currency){
    var txSel = document.getElementById('tx-devise');
    if(txSel){
      var opt = txSel.querySelector('option[value="'+currency+'"]');
      if(opt) txSel.value = currency;
    }
  }
  // 2. Parser : mémoriser le pays pour Nominatim (countrycodes)
  var iso = (typeof countryToISO === 'function') ? countryToISO(pays) : '';
  window._activeAddrCountryISO = iso ? iso.toLowerCase() : '';
}

// [migrated to module — see header]

// ── Snapshots des données actives ──
// ── Ouvrir le formulaire mobilité avec un type pré-sélectionné ──
function openMobiliteAs(type){
  // Ouvrir la modal mobilité
  toggleForm('form-mobilite');
  // Après ouverture, sélectionner le bon type
  setTimeout(function(){
    var hidEl = document.getElementById('mob-type');
    if(hidEl) hidEl.value = type;
    var chip = document.querySelector('.mob-chip[data-type="'+type+'"]');
    if(typeof setMobType === 'function') setMobType(type, chip);
  }, 60);
}

// ── Picker Trajet / Pass — modal overlay ─────────────────────────
function showTransportPicker(){
  var overlay = document.getElementById('transport-choice-overlay');
  if(!overlay) return;
  overlay.classList.add('open');
}

function closeTransportChoiceModal(){
  var overlay = document.getElementById('transport-choice-overlay');
  if(overlay) overlay.classList.remove('open');
}

function closeTransportChoiceOnBg(e){
  if(e.target === document.getElementById('transport-choice-overlay')){
    closeTransportChoiceModal();
  }
}

function pickTransport(mode){
  // Fermer la modal de choix
  closeTransportChoiceModal();
  // Fermer aussi l'ancien picker inline (sécurité rétrocompat)
  var picker = document.getElementById('transport-picker');
  var btn    = document.getElementById('btn-transport-picker');
  if(picker) picker.style.display = 'none';
  if(btn)    btn.style.opacity = '1';

  if(mode === 'pass'){
    // Mode Pass : ouvrir le formulaire en mode pass
    openMobiliteAs('pass');
    setTimeout(function(){
      // Masquer les chips transport et afficher un header "Pass"
      var chips = document.getElementById('mob-type-chips');
      if(chips) chips.style.display = 'none';
      var title = document.getElementById('mob-form-title');
      if(title){
        title.innerHTML = '<span style="display:flex;align-items:center;gap:8px">'
          +'<span style="background:var(--gold-light);color:var(--gold);padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;border:1px solid rgba(201,146,26,.3)">Pass</span>'
          +'<span>Nouveau Pass</span>'
          +'</span>';
      }
      // Ajouter une note dans le pass group
      var noteRow = document.getElementById('mob-pass-note-row');
      if(noteRow) noteRow.style.display='';
    }, 80);
  } else {
    // Mode Trajet : ouvrir avec Vol par défaut, chip Pass masqué
    openMobiliteAs('vol');
    setTimeout(function(){
      var chips = document.getElementById('mob-type-chips');
      if(chips) chips.style.display = '';
      // Masquer le chip Pass dans le sélecteur de type
      var passChip = document.querySelector('#mob-type-chips .mob-chip[data-type="pass"]');
      if(passChip) passChip.style.display = 'none';
      var title = document.getElementById('mob-form-title');
      if(title){
        title.innerHTML = '<span style="display:flex;align-items:center;gap:8px">'
          +'<span style="background:#e8f0f8;color:#2d5e8c;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;border:1px solid rgba(45,94,140,.2)">Trajet</span>'
          +'<span>Nouveau Trajet</span>'
          +'</span>';
      }
    }, 80);
  }
}


// ══════════════════════════════════════════════════════════════════
// clearAllModals() — Reset intégral & hermétique de TOUS les formulaires
// Appelé à chaque Annuler / fermeture de modal pour garantir
// qu'aucune donnée résiduelle ne pollue un nouveau formulaire.
// ══════════════════════════════════════════════════════════════════
function clearAllModals(){
  // 1. Tous les inputs texte / number / date dans les formulaires
  var FORM_IDS = [
    'form-mobilite','form-hotel','form-lieu','form-location',
    'form-modal-overlay'
  ];
  FORM_IDS.forEach(function(fid){
    var f=document.getElementById(fid);
    if(!f) return;
    f.querySelectorAll('input[type=text],input[type=number],input[type=date],input[type=time],textarea').forEach(function(el){
      // Ne pas effacer les sélecteurs de type (mob-type, etc.)
      if(el.id === 'mob-type') return;
      el.value='';
    });
    f.querySelectorAll('input[type=hidden]').forEach(function(el){
      // Conserver les champs de type (mob-type etc.) — réinitialiser les autres
      if(el.id&&(el.id.indexOf('-lat')!==-1||el.id.indexOf('-lng')!==-1||el.id.indexOf('-pdf')!==-1||el.id.indexOf('vol-titre')!==-1)){
        el.value='';
      }
    });
    f.querySelectorAll('input[type=file]').forEach(function(el){
      try{ el.value=''; }catch(e){}
    });
    // Nettoyer les badges PDF
    f.querySelectorAll('[id$="-pdf-badge"],[id*="-pdf-badge"]').forEach(function(el){
      el.textContent='';
    });
    // Fermer les listes d'autocomplétion
    f.querySelectorAll('.ac-box,.autocomplete-box').forEach(function(el){
      el.classList.remove('open');
      el.innerHTML='';
    });
    // Réinitialiser les selects sur leur première option (sauf mob-type)
    f.querySelectorAll('select').forEach(function(el){
      if(el.id==='mob-type') return; // conservé par setMobType
      el.selectedIndex=0;
    });
  });

  // 2. Reset explicite des champs mob-date dans tous les groupes
  // (ids dupliqués intentionnels entre groupes — chaque groupe est distinct)
  document.querySelectorAll('[id="mob-date"]').forEach(function(el){ el.value=''; });

  // 3. Champs cachés lat/lng gares (train)
  ['mob-dep-lat','mob-dep-lng','mob-arr-lat','mob-arr-lng'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.value='';
  });

  // 3. Checkbox escale + compteur (auto-reset des blocs dynamiques)
  _mobEscCount = 1;
  var escChk=document.getElementById('mob-escale-check');
  if(escChk){ escChk.checked=false; escChk.dispatchEvent(new Event('change')); }
  var escDyn=document.getElementById('mob-escales-dyn'); if(escDyn) escDyn.innerHTML='';

  // 4. Preview route / titre
  var prev=document.getElementById('mob-route-preview');
  if(prev) prev.classList.remove('visible');
  var vtPrev=document.getElementById('vol-titre-preview');
  if(vtPrev) vtPrev.classList.remove('visible');

  // 5. Durée display
  ['mob-duree-display','mob-esc-duree-display','tr-duree-display'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.textContent='—';
  });

  // 6. Résultats adresse vérifiée
  ['ht-addr-result','lieu-addr-result','ht-verify-btn','lieu-verify-btn'].forEach(function(id){
    var el=document.getElementById(id);
    if(!el) return;
    if(el.tagName==='BUTTON'){ el.className='btn-verify-addr'; el.innerHTML='<span class="verify-icon">&#128269;</span> Vérifier l\'adresse'; el.disabled=false; }
    else{ el.className='addr-result-badge'; el.textContent=''; }
  });

  // 7. Réinitialiser les selects pays (vider puis re-builder si nécessaire)
  ['ht-pays','lieu-pays'].forEach(function(id){
    var el=document.getElementById(id);
    if(el){ el.selectedIndex=0; }
  });

  // 8. Magic address
  ['ht-magic-input','lieu-magic-input'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.value='';
  });
  ['ht-magic-result','lieu-magic-result'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.textContent='';
  });
}


// Restaurer l'état du formulaire transport (chips + titre) à la fermeture
function _resetTransportForm(){
  var chips = document.getElementById('mob-type-chips');
  if(chips) chips.style.display = '';
  var passChip = document.querySelector('#mob-type-chips .mob-chip[data-type="pass"]');
  if(passChip) passChip.style.display = '';
  var title = document.getElementById('mob-form-title');
  if(title) title.textContent = 'Ajouter un trajet';
  // Fermer la modal de choix et l'ancien picker inline
  closeTransportChoiceModal();
  var picker = document.getElementById('transport-picker');
  if(picker) picker.style.display = 'none';
  var btn = document.getElementById('btn-transport-picker');
  if(btn) btn.style.opacity = '1';
}


// ── Copie profonde hermétique — casse TOUS les liens de référence ──
// [migrated to module — see header]

// [migrated to module — see header]

// ── ISOLATION HERMÉTIQUE — Hard reset de toutes les variables d'état ──
// Appelé AVANT chaque restoreTrip pour garantir l'absence de pollution inter-voyages.
// [migrated to module — see header]

// [migrated to module — see header]

// ── Écran d'accueil ──
function showHomeScreen(){
  if(currentTripId && typeof snapshotCurrentTrip==='function'){
    snapshotCurrentTrip();
  }
  currentTripId = null;
  var homeBtn = document.querySelector('.tb-item[data-page="home"]');
  showPage('home', homeBtn);
}

// ══════════════════════════════════════════
// SPA — Navigation entre pages
// ══════════════════════════════════════════
function showPage(pageId, btn){
  // Hamburger (repli rail/panneau) : visible seulement sur la page voyage
  // AVEC un voyage ouvert — sinon rien à replier.
  document.body.classList.toggle('view-voyage', pageId === 'voyage' && !!currentTripId);
  // Nom du voyage dans la barre top : visible seulement sur la page Voyage
  var _tbName = document.getElementById('tb-trip-name');
  if(_tbName && pageId !== 'voyage' && pageId !== 'futur'){ _tbName.textContent = ''; }
  // Cacher toutes les pages SPA
  document.querySelectorAll('.spa-page').forEach(function(p){
    p.classList.remove('active');
  });
  // Désactiver tous les onglets
  document.querySelectorAll('.tb-item').forEach(function(b){
    b.classList.remove('active');
  });
  // Activer la page demandée
  var page = document.getElementById('page-' + pageId);
  if(page) page.classList.add('active');
  // Activer l'onglet correspondant
  if(btn){
    btn.classList.add('active');
  } else {
    var tbBtn = document.querySelector('.tb-item[data-page="' + pageId + '"]');
    if(tbBtn) tbBtn.classList.add('active');
  }
  // Repositionner le trait animé sous l'onglet actif
  if(typeof _moveTabSlider === 'function') _moveTabSlider();
  // Callbacks par page — SANS appeler showAppScreen (éviter boucle)
  if(pageId === 'home'){
    // Fermer toute modal de formulaire ouverte
    if(typeof _closeFormModal === 'function' && typeof _currentOpenForm !== 'undefined' && _currentOpenForm){
      _closeFormModal(_currentOpenForm, true);
    }
    updateHomeTopbarStats();
    if(typeof renderTripsList === 'function') renderTripsList();
  } else if(pageId === 'voyage'){
    // Si un voyage est actif, (ré)afficher son contenu proprement ;
    // sinon montrer le placeholder.
    if(!currentTripId){
      var ph = document.getElementById('voyage-placeholder');
      var vc = document.getElementById('voyage-content');
      if(ph) ph.style.display = '';
      if(vc) vc.style.display = 'none';
      document.body.classList.remove('trip-open');
    } else {
      if(typeof showAppScreen === 'function') showAppScreen();
    }
    if(typeof updateStatsBar === 'function') updateStatsBar();
  } else if(pageId === 'futur'){
    // « Carte » n'est plus une page globale : on redirige vers le voyage,
    // groupe Carte (si un voyage est ouvert), sinon vers l'accueil.
    if(currentTripId){
      showAppScreen();
      if(typeof goToSection === 'function') goToSection('carte', null);
      return;
    } else {
      showPage('home', document.querySelector('.tb-item[data-page="home"]'));
      return;
    }
  } else if(pageId === 'explorer'){
    if(typeof renderExplorer === 'function') renderExplorer();
  } else if(pageId === 'profil'){
    if(typeof loadProfilPage === 'function') loadProfilPage();
  }
}

// ══════════════════════════════════════════
// LIEN INTELLIGENT — Page 2 → Page 3 Carte
// ══════════════════════════════════════════
window.goToMapPin = function(type, id){
  // 1. Basculer vers la page Carte (onglet 3)
  var carteBtn = document.querySelector('.tb-item[data-page="futur"]');
  showPage('futur', carteBtn);

  // 2. Attendre que la carte soit initialisée, puis centrer sur le pin
  var attempts = 0;
  function tryFocus(){
    attempts++;
    if(typeof _tripmapPins !== 'undefined' && _tripmapPins.length){
      var pin = _tripmapPins.find(function(p){ return p.type===type && p.id===String(id); });
      if(pin && pin.lat && pin.marker){
        if(typeof _tripmapL !== 'undefined' && _tripmapL){
          _tripmapL.setView([pin.lat, pin.lng], 15, {animate:true});
          pin.marker.openPopup();
        }
        return;
      }
    }
    if(attempts < 20) setTimeout(tryFocus, 200);
  }
  setTimeout(tryFocus, 350);
};


var _currentSection = 'mobilite';
var SECTION_ORDER = ['pass','mobilite','locations','hotels','lieux','documents','timeline','budget','convertir'];

// Navigation À PLAT (Design C) : une seule barre verticale à gauche,
// toutes les destinations visibles, séparées en 3 blocs par usage —
// Préparer / Suivre / Argent. 'carte' n'est pas une section du belt
// (c'est #voyage-map-host), elle est gérée à part dans goToSection().
var NAV_BLOCKS = [
  { title:'Organiser le voyage', items:['deplacements','hotels','lieux','documents'] },
  { title:'Suivi du voyage',     items:['timeline','carte'] },
  { title:'Dépenses du voyage',  items:['budget','convertir'] }
];
// Sous-vues regroupées sous l'item unique « Déplacements »
var _DEPL = ['mobilite','pass','locations']; // ordre : Transport · Pass · Location
var _deplActive = 'mobilite';   // partie déplacement par défaut : Transport
var _lastNavId = null;      // dernière sous-section nav (optimisation rebuild)

// ══════════════════════════════════════════════════════════════════════
// NAVIGATION À DEUX NIVEAUX (refonte ergonomique)
// Niveau 1 : 4 groupes — Logistique / Activités / Finance / Carte
// Niveau 2 : sous-sections de chaque groupe (réutilise switchSection)
// La Carte (#page-futur) devient le 4e groupe, intégré au voyage.
// ══════════════════════════════════════════════════════════════════════
var SECTION_GROUPS = {
  logistique: { label:'Logistique', subs:['pass','mobilite','locations','hotels','documents'] },
  activites:  { label:'Activités',  subs:['lieux','timeline'] },
  finance:    { label:'Finance',    subs:['budget','convertir'] },
  carte:      { label:'Carte',      subs:[] }
};
var GROUP_ORDER = ['logistique','activites','finance','carte'];
var SECTION_TO_GROUP = {};
Object.keys(SECTION_GROUPS).forEach(function(g){
  SECTION_GROUPS[g].subs.forEach(function(s){ SECTION_TO_GROUP[s] = g; });
});
var _currentGroup = 'logistique';

// Sous-sections visibles d'un groupe (respecte France : pas de Convertir)
function _visibleSubs(groupId){
  return SECTION_GROUPS[groupId].subs.filter(function(s){
    return SECTION_ORDER.indexOf(s) !== -1;
  });
}

var SUB_META = {
  pass:'Pass', mobilite:'Transports', locations:'Locations', hotels:'Hébergements',
  lieux:'Lieux', documents:'Documents', timeline:'Planning', alertes:'Alertes',
  budget:'Budget', convertir:'Convertir',
  deplacements:'Déplacements'
};

// Icônes filaires (traits fins) par sous-section — affichées en desktop
// dans le panneau de niveau 2 (cf. DA « Zéro emoji », inline SVG only).
var SUB_ICONS = {
  pass:'<rect x="2" y="7" width="20" height="10" rx="2"/><path d="M2 12h20"/><circle cx="7" cy="12" r="1.4"/>',
  mobilite:'<path d="M3 20l4-16M17 20l4-16M3 10h18M3 14h18"/>',
  locations:'<path d="M5 17h14l-1.4-5.2A2 2 0 0 0 15.7 10H8.3a2 2 0 0 0-1.9 1.8L5 17z"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/>',
  hotels:'<path d="M3 18v-7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v7"/><path d="M3 14h18M7 10V8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2"/><path d="M3 18v2M21 18v2"/>',
  lieux:'<path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/>',
  timeline:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/>',
  alertes:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  budget:'<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.3"/>',
  convertir:'<path d="M4 9h13l-3-3M20 15H7l3 3"/>',
  carte:'<path d="M9 4 3 7v13l6-3 6 3 6-3V4l-6 3z"/><path d="M9 4v13M15 7v13"/>',
  deplacements:'<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8"/>',
  documents:'<path d="M14 3v5a1 1 0 0 0 1 1h5"/><path d="M9 4H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z"/><path d="M9 13h6M9 17h4"/>'
};
function _subIcon(s){
  var p = SUB_ICONS[s] || '<circle cx="12" cy="12" r="9"/>';
  return '<svg class="vsn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
       + 'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" '
       + 'width="17" height="17" aria-hidden="true">'+p+'</svg>';
}

// Construit la barre de navigation UNIQUE à plat (tous les items + séparateurs).
// Le paramètre groupId est ignoré (conservé pour compat. des appelants).
function _buildSubNav(groupId){
  var nav = document.getElementById('voyage-subsection-nav');
  if(!nav) return;
  var blocksHtml = [];
  NAV_BLOCKS.forEach(function(block){
    var items = block.items.filter(function(s){
      return s === 'carte' || s === 'deplacements' || SECTION_ORDER.indexOf(s) !== -1;
    });
    if(!items.length) return;
    var h = '<div class="vnav-title" aria-hidden="true">'+block.title+'</div>';
    items.forEach(function(s){
      var label  = SUB_META[s] || s;
      var isActive = (s === _currentSection) ||
                     (s === 'deplacements' && _DEPL.indexOf(_currentSection) !== -1);
      var active = isActive ? ' active' : '';
      h += '<button class="vsn-item'+active+'" data-tab="'+s+'" '
        + 'onclick="goToSection(\''+s+'\',this)">'
        + _subIcon(s)+'<span class="vsn-lbl">'+label+'</span></button>';
    });
    blocksHtml.push(h);
  });
  nav.innerHTML = '<span id="vsn-slider" aria-hidden="true"></span>'
    + blocksHtml.join('<div class="vnav-sep" aria-hidden="true"></div>');
  nav.style.display = '';
  if(window.SmartAlerts && SmartAlerts.refresh) SmartAlerts.refresh();
  _buildMobileNav();
}

// ── NAV MOBILE À 2 NIVEAUX ────────────────────────────────────────────
// Rangée 1 : 3 sections (Organiser / Suivi / Budget).
// Rangée 2 : sous-sections du bloc actif, design crème (segment actif
// blanc + texte rose), comme le sélecteur Pass/Transport/Location.
var NAV_BLOCK_SHORT = ['Organiser', 'Suivi', 'Budget'];
var MOBILE_SUB_LABEL = { deplacements:'Déplacements' };

function _navItems(block){
  return block.items.filter(function(s){
    return s === 'carte' || s === 'deplacements' || SECTION_ORDER.indexOf(s) !== -1;
  });
}
function _navCurrent(){
  return (_DEPL.indexOf(_currentSection) !== -1) ? 'deplacements' : _currentSection;
}
function _activeBlockIndex(){
  var cur = _navCurrent();
  for(var i = 0; i < NAV_BLOCKS.length; i++){
    if(_navItems(NAV_BLOCKS[i]).indexOf(cur) !== -1) return i;
  }
  return 0;
}

function _buildMobileNav(){
  var nav = document.getElementById('voyage-mobile-nav');
  if(!nav) return;
  var bi  = _activeBlockIndex();
  var cur = _navCurrent();

  // Rangée 1 — sections
  var r1 = '<div class="vmn-sections">';
  NAV_BLOCKS.forEach(function(block, i){
    if(!_navItems(block).length) return;
    r1 += '<button type="button" class="vmn-sec' + (i === bi ? ' active' : '') + '" '
        + 'onclick="mobileSelectBlock(' + i + ')">'
        + (NAV_BLOCK_SHORT[i] || block.title) + '</button>';
  });
  r1 += '</div>';

  // Rangée 2 — sous-sections du bloc actif (crème)
  var r2 = '<div class="vmn-subs">';
  _navItems(NAV_BLOCKS[bi]).forEach(function(s){
    var label = MOBILE_SUB_LABEL[s] || SUB_META[s] || s;
    r2 += '<button type="button" class="vmn-sub' + (s === cur ? ' active' : '') + '" '
        + 'data-tab="' + s + '" onclick="mobileGoSub(\'' + s + '\')">'
        + _subIcon(s) + '<span>' + label + '</span></button>';
  });
  r2 += '</div>';

  // Rangée 3 (optionnelle) — parties de « Déplacements » : Pass / Transport /
  // Location, soulignées selon la partie courante (swipe vertical).
  var r3 = '';
  if(cur === 'deplacements'){
    var partLbl = { pass:'Pass', mobilite:'Transport', locations:'Location' };
    r3 = '<div class="vmn-parts">';
    _DEPL.forEach(function(p){
      r3 += '<button type="button" class="vmn-part' + (p === _deplActive ? ' active' : '') + '" '
          + 'data-part="' + p + '" onclick="mobileGoPart(\'' + p + '\')">'
          + partLbl[p] + '</button>';
    });
    r3 += '</div>';
  }

  nav.innerHTML = r1 + r2 + r3;
}

// Tap sur une section (rangée 1) : bascule vers sa 1re sous-section
// si on n'y est pas déjà.
function mobileSelectBlock(i){
  var items = _navItems(NAV_BLOCKS[i]);
  if(!items.length) return;
  if(items.indexOf(_navCurrent()) === -1){ goToSection(items[0]); }
  _buildMobileNav();
}
// Tap sur une sous-section (rangée 2)
function mobileGoSub(s){
  goToSection(s);
  _buildMobileNav();
}

// ── INDICATEUR DE PARTIES (Pass / Transport / Location) ──────────────
// Le voyage se parcourt entièrement en swipe HORIZONTAL via le belt.
// L'indicateur sous la barre montre la partie déplacement courante et
// permet d'y sauter directement.

// Met à jour uniquement le soulignement des parties (sans reconstruire la nav)
function _syncDeplParts(){
  document.querySelectorAll('.vmn-part').forEach(function(b){
    b.classList.toggle('active', b.getAttribute('data-part') === _deplActive);
  });
}
// Tap sur une partie (Pass / Transport / Location) → navigation horizontale directe
function mobileGoPart(s){
  goToSection(s);
  _syncDeplParts();
}

// Affiche TOUTES les sections du belt (nav à plat). 'alertes' reste masquée.
function _exposeAllSections(){
  ['pass','mobilite','locations','hotels','lieux','documents','timeline','alertes','budget','convertir']
    .forEach(function(s){
      var el = document.getElementById('tab-' + s);
      if(!el) return;
      el.style.display = (SECTION_ORDER.indexOf(s) !== -1) ? '' : 'none';
    });
}

// Aiguillage d'un item de la barre à plat : 'carte' affiche le host carte,
// 'deplacements' résout vers la dernière sous-vue (pass/transport/location),
// sinon on montre le belt de sections et on bascule dessus.
function goToSection(id, btn){
  if(id === 'deplacements'){ id = 'mobilite'; _deplActive = 'mobilite'; }
  // L'item de nav surligné est « Déplacements » pour les 3 sous-vues
  var navId = (_DEPL.indexOf(id) !== -1) ? 'deplacements' : id;
  document.querySelectorAll('#voyage-subsection-nav .vsn-item').forEach(function(b){
    b.classList.toggle('active', b.getAttribute('data-tab') === navId);
  });
  var sections = document.getElementById('voyage-sections');
  var mapHost  = document.getElementById('voyage-map-host');

  if(id === 'carte'){
    _currentSection = 'carte';
    if(sections) sections.style.display = 'none';
    if(mapHost){
      mapHost.style.display = '';
      mapHost.classList.add('is-visible');
      // Vue normale : carte + liste des trajets en dessous.
      // Le bouton « agrandir » bascule en vrai plein écran (is-fullscreen).
      mapHost.classList.remove('is-full');
      if(typeof initTripMap === 'function') initTripMap();
      setTimeout(function(){
        if(window._tripmapInstance && window._tripmapInstance.invalidateSize) window._tripmapInstance.invalidateSize();
      }, 160);
    }
    if(typeof _buildMobileNav === 'function') _buildMobileNav();
    return;
  }

  if(mapHost){ mapHost.style.display = 'none'; mapHost.classList.remove('is-visible'); }
  if(sections) sections.style.display = '';
  switchSection(id, btn);
  if(typeof _buildMobileNav === 'function') _buildMobileNav();
}

// Sélecteur 3 icônes (Pass / Transport / Location) injecté en haut de
// chacun des 3 panneaux déplacement. Chaque panneau surligne sa propre vue.
function _buildDeplSwitch(){
  var labels = { pass:'Pass', mobilite:'Transport', locations:'Location' };
  _DEPL.forEach(function(sec){
    var host = document.getElementById('tab-' + sec);
    if(!host || host.querySelector('.depl-switch')) return;
    var sw = document.createElement('div');
    sw.className = 'depl-switch';
    sw.innerHTML = _DEPL.map(function(o){
      var act = (o === sec) ? ' active' : '';
      return '<button class="depl-seg'+act+'" type="button" onclick="goToSection(\''+o+'\',null)">'
        + _subIcon(o) + '<span>' + labels[o] + '</span></button>';
    }).join('');
    host.insertBefore(sw, host.firstChild);
  });
}

// Affiche uniquement les sections du groupe actif dans le belt
// (les sections des autres groupes sont retirées du flux → le swipe
//  horizontal ne cycle que sur les sous-sections du groupe courant).

// Bascule de groupe (niveau 1)
function switchGroup(groupId, btn){
  if(!SECTION_GROUPS[groupId]) return;
  _currentGroup = groupId;

  document.querySelectorAll('.vgrp-item').forEach(function(b){
    b.classList.toggle('active', b.getAttribute('data-group') === groupId);
  });
  if(typeof _moveGroupSlider === 'function') _moveGroupSlider();

  var subNav   = document.getElementById('voyage-subsection-nav');
  var sections = document.getElementById('voyage-sections');
  var mapHost  = document.getElementById('voyage-map-host');

  if(groupId === 'carte'){
    if(subNav)   subNav.style.display = 'none';
    if(sections) sections.style.display = 'none';
    if(mapHost){
      mapHost.style.display = '';            // laisse le CSS décider (grid desktop / flex mobile)
      mapHost.classList.add('is-visible');
      if(typeof initTripMap === 'function') initTripMap();
      setTimeout(function(){
        if(window._tripmapInstance && window._tripmapInstance.invalidateSize) window._tripmapInstance.invalidateSize();
      }, 160);
    }
    return;
  }

  if(mapHost){ mapHost.style.display = 'none'; mapHost.classList.remove('is-visible'); }
  if(subNav)   subNav.style.display = '';
  if(sections) sections.style.display = '';

  _buildSubNav(groupId);
  var subs = _visibleSubs(groupId);
  if(subs.length){ switchSection(subs[0], null); }
}
// ── Lazy render : sections rendues uniquement au premier accès ──
var _sectionRendered = {};

function switchSection(id, btn){
  // Fermer tout formulaire modal ouvert avant de changer de section
  if(typeof _closeFormModal === 'function' && typeof _currentOpenForm !== 'undefined' && _currentOpenForm){
    _closeFormModal(_currentOpenForm, true);
  }
  _currentSection = id;
  if(_DEPL.indexOf(id) !== -1){ _deplActive = id; }

  // Nav à plat : toutes les sections du belt sont exposées en permanence.
  if(typeof _exposeAllSections === 'function') _exposeAllSections();

  // Update nav pills — les 3 sous-vues déplacement surlignent « Déplacements »
  var navId = (_DEPL.indexOf(id) !== -1) ? 'deplacements' : id;
  document.querySelectorAll('.vsn-item').forEach(function(b){
    b.classList.remove('active');
  });
  if(btn && navId === id){ btn.classList.add('active'); }
  else {
    var b2 = document.querySelector('.vsn-item[data-tab="'+navId+'"]');
    if(b2) b2.classList.add('active');
  }
  // Repositionner le slider animé sous la section active
  if(typeof _moveSectionSlider === 'function') _moveSectionSlider();

  // Scroll the snap container — index dans la liste à plat des sections.
  var container = document.getElementById('voyage-sections');
  var sec = document.getElementById('tab-' + id);
  if(container && sec){
    var idx2 = SECTION_ORDER.indexOf(id);
    if(idx2 < 0) idx2 = 0;
    var sectionWidth = container.clientWidth || window.innerWidth;
    container.scrollTo({left: idx2 * sectionWidth, behavior: 'auto'});
  }

  // Keep legacy .section.active for render callbacks
  document.querySelectorAll('.section').forEach(function(s){ s.classList.remove('active'); });
  if(sec) sec.classList.add('active');

  // Section-specific callbacks — toujours render mobilite et locations (données dynamiques)
  if(id === 'pass' && typeof renderPasses === 'function'){ renderPasses(); }
  if(id === 'mobilite' && typeof renderMobilite === 'function'){ renderMobilite(); }
  if(id === 'locations' && typeof renderLocations === 'function'){ renderLocations(); }

  // Lazy render pour les sections moins fréquentées
  if(!_sectionRendered[id]){
    _sectionRendered[id] = true;
    if(id === 'hotels' && typeof renderHotels === 'function'){ renderHotels(); }
    if(id === 'lieux'  && typeof renderLieux   === 'function'){ renderLieux(); }
    if(id === 'documents' && typeof renderDocuments === 'function'){ renderDocuments(); }
  } else {
    // Déjà rendu mais on force quand même pour lieux (toggle visité en temps réel)
    if(id === 'lieux'  && typeof renderLieux   === 'function'){ renderLieux(); }
    if(id === 'documents' && typeof renderDocuments === 'function'){ renderDocuments(); }
  }

  if(id === 'budget' && typeof updateBudget   === 'function') updateBudget();
  if(id === 'convertir'){ if(typeof applyRateForCurrentTrip==='function') applyRateForCurrentTrip(); if(typeof updateRateDisplay==='function') updateRateDisplay(); }
  if(id === 'timeline' && typeof renderTimeline === 'function') renderTimeline();
  if(id === 'alertes'  && window.SmartAlerts) SmartAlerts.refresh();
}

// ══════════════════════════════════════════════════════
// FRANCE vs INTERNATIONAL — adaptation des sections
// ══════════════════════════════════════════════════════
function _adaptSectionsForTrip(tid){
  var t = allTrips[tid];
  if(!t) return;
  var destType = (t.meta && t.meta.destType) || 'international';
  var isFrance = (destType === 'france');

  // Masquer/afficher le bouton "Convertir" dans la nav
  var convertBtn = document.querySelector('.vsn-item[data-tab="convertir"]');
  var convertSec = document.getElementById('tab-convertir');
  if(convertBtn) convertBtn.style.display = isFrance ? 'none' : '';
  if(convertSec) convertSec.style.visibility = isFrance ? 'hidden' : '';

  // Masquer/afficher le sélecteur de devise dans le budget
  var deviseRow = document.getElementById('tx-devise');
  if(deviseRow){
    deviseRow.style.display = isFrance ? 'none' : '';
    if(isFrance) deviseRow.value = 'EUR';
  }

  // Mettre à jour SECTION_ORDER dynamiquement
  SECTION_ORDER = isFrance
    ? ['pass','mobilite','locations','hotels','lieux','documents','timeline','budget']
    : ['pass','mobilite','locations','hotels','lieux','documents','timeline','budget','convertir'];

  // Reconstruire les sous-onglets du groupe courant (le filtrage France
  // retire « Convertir » de Finance).
  if(typeof _buildSubNav === 'function' && typeof _currentGroup !== 'undefined'){
    _buildSubNav(_currentGroup);
  }
  // Si la sous-section active est 'convertir' et qu'on passe en France,
  // revenir à 'budget'.
  if(isFrance && (_currentSection === 'convertir')){
    switchSection('budget', null);
  }
}



// Sync nav pills when user swipes (IntersectionObserver)
(function(){
  function initSwipeSync(){
    var container = document.getElementById('voyage-sections');
    if(!container) return;

    // Use IntersectionObserver to detect which section is visible
    if (typeof IntersectionObserver === 'undefined') return; // SSR/Node guard
    var observer = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(entry.isIntersecting && entry.intersectionRatio >= 0.5){
          var id = entry.target.id.replace('tab-','');
          _currentSection = id;
          if(_DEPL.indexOf(id) !== -1){ _deplActive = id; }
          // Les 3 sous-vues déplacement surlignent « Déplacements » dans la barre
          var navId = (_DEPL.indexOf(id) !== -1) ? 'deplacements' : id;
          document.querySelectorAll('.vsn-item').forEach(function(b){
            b.classList.toggle('active', b.getAttribute('data-tab') === navId);
          });
          // Optimisation : en swipant pass→transport→location (toujours dans
          // « Déplacements »), on met juste à jour le soulignement des parties.
          if(navId === 'deplacements' && _lastNavId === 'deplacements'){
            if(typeof _syncDeplParts === 'function') _syncDeplParts();
          } else if(typeof _buildMobileNav === 'function'){
            _buildMobileNav();
          }
          _lastNavId = navId;
          // Update active section class
          document.querySelectorAll('.section').forEach(function(s){
            s.classList.toggle('active', s === entry.target);
          });
          // Section callbacks — respecte le lazy render
          if(id === 'pass'      && typeof renderPasses    === 'function') renderPasses();
          if(id === 'mobilite'  && typeof renderMobilite  === 'function') renderMobilite();
          if(id === 'locations' && typeof renderLocations === 'function') renderLocations();
          if(id === 'budget'    && typeof updateBudget    === 'function') updateBudget();
          if(id === 'timeline'  && typeof renderTimeline  === 'function') renderTimeline();
          if(id === 'alertes'   && window.SmartAlerts) SmartAlerts.refresh();
          // Lieux/Hotels : lazy render au premier accès uniquement
          if(!_sectionRendered[id]){
            _sectionRendered[id] = true;
            if(id === 'hotels' && typeof renderHotels === 'function') renderHotels();
            if(id === 'lieux'  && typeof renderLieux  === 'function') renderLieux();
            if(id === 'documents' && typeof renderDocuments === 'function') renderDocuments();
          } else if(id === 'lieux' && typeof renderLieux === 'function'){
            renderLieux(); // toujours re-rendre pour toggle visité
          } else if(id === 'documents' && typeof renderDocuments === 'function'){
            renderDocuments();
          }
        }
      });
    }, {
      root: document.getElementById('voyage-sections'),
      threshold: 0.5
    });

    document.querySelectorAll('.section').forEach(function(sec){
      observer.observe(sec);
    });
  }

  // Run after DOM ready
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initSwipeSync);
  } else {
    initSwipeSync();
  }
})();



// Update voyage progress bar in the voyage page
function updateVoyageProgressBar(){
  if(!currentTripId || !allTrips[currentTripId]) return;
  var m = allTrips[currentTripId].meta || {};

  var nameEl = document.getElementById('vpn-name');
  var daysEl = document.getElementById('vpn-days');
  var fillEl = document.getElementById('vpn-fill');
  if(nameEl) nameEl.textContent = m.name || 'Mon voyage';
  // Nom du voyage dans la barre supérieure (desktop)
  var tbName = document.getElementById('tb-trip-name');
  if(tbName) tbName.textContent = m.name || '';

  var pct = 0;
  var daysLabel = '';
  if(m.dateDep && m.dateRet){
    var dep = parseDDMMYYYY(m.dateDep);
    var ret = parseDDMMYYYY(m.dateRet);
    var now = new Date(); now.setHours(0,0,0,0);
    if(dep && ret){
      var total = ret - dep;
      var elapsed = now - dep;
      pct = Math.max(0, Math.min(100, Math.round(elapsed/total*100)));
      var daysLeft = Math.round((ret - now)/(1000*86400));
      if(daysLeft > 0) daysLabel = daysLeft+' j restants';
      else if(daysLeft === 0) daysLabel = 'Dernier jour !';
      else daysLabel = 'Voyage terminé';
    }
  } else if(m.dateDep){
    var dep2 = parseDDMMYYYY(m.dateDep);
    var now2 = new Date(); now2.setHours(0,0,0,0);
    if(dep2){
      var dToGo = Math.round((dep2-now2)/(1000*86400));
      daysLabel = dToGo > 0 ? 'Départ dans '+dToGo+' j' : dToGo === 0 ? "C'est aujourd'hui !" : 'En cours';
    }
  }

  if(daysEl) daysEl.textContent = daysLabel;
  if(fillEl) fillEl.style.width = pct + '%';

  // Also update header trip name
  var hn = document.getElementById('app-trip-name');
  if(hn) hn.textContent = (m.name || 'Mon voyage');
}

// ══════════════════════════════════════════════════════════
// PROFIL THÈMES — commit immédiat depuis le profil
// ══════════════════════════════════════════════════════════
// Wrapper qui commit directement sans passer par draft
function applyThemeFromProfil(theme){
  // Fermer draft si ouvert pour éviter conflit
  if(_draft){ _draft.theme = theme; }
  _state.theme = theme;
  _currentTheme = theme;
  localStorage.setItem('yume_theme', theme);
  _renderTheme(theme);
  _renderBackground(_state);

  // Sync chips dans le profil
  document.querySelectorAll('#psp-theme-grid .theme-chip').forEach(function(c){
    c.classList.toggle('active', c.getAttribute('data-theme') === theme);
  });
  // Sync chips dans l'overlay settings aussi
  document.querySelectorAll('.theme-grid .theme-chip').forEach(function(c){
    c.classList.toggle('active', c.getAttribute('data-theme') === theme);
  });
}

// Wrappers brightness/blur qui fonctionnent sans draft

// Met à jour les chips de stats dans le home topbar
function updateHomeTopbarStats(){
  var nbV = Object.keys(allTrips).length;
  var pays = {};
  Object.values(allTrips).forEach(function(t){
    // Comptabiliser uniquement les destinations internationales
    var meta = t.meta || {};
    var isIntl = !meta.destType || meta.destType === 'international';
    if(isIntl && meta.country) pays[meta.country] = 1;
  });
  var nbP = Object.keys(pays).length;
  var elV = document.getElementById('hts-voyages');
  var elP = document.getElementById('hts-pays');
  if(elV) elV.textContent = nbV;
  if(elP) elP.textContent = nbP;
  // Mini-stats accueil (mobile)
  var elVm = document.getElementById('hms-voyages');
  var elPm = document.getElementById('hms-pays');
  if(elVm) elVm.textContent = nbV;
  if(elPm) elPm.textContent = nbP;
  // Compteurs jumeaux dans la barre de navigation (desktop)
  var elV2 = document.getElementById('tbs-voyages');
  var elP2 = document.getElementById('tbs-pays');
  if(elV2) elV2.textContent = nbV;
  if(elP2) elP2.textContent = nbP;
}

// ── Trait animé sous l'onglet actif (desktop) ──────────────────────
// Un slider unique glisse vers l'onglet actif au lieu d'apparaître/
// disparaître. Positionné en pixels depuis le bord gauche de la barre.
function _moveTabSlider(){
  var slider = document.getElementById('tb-slider');
  var active = document.querySelector('.tb-item.active');
  var bar    = document.getElementById('tab-bar');
  if(!slider || !active || !bar) return;
  // Le slider n'est visible qu'en desktop (barre horizontale) ; en
  // mobile le repère reste le trait par bouton (CSS), slider masqué.
  var aRect = active.getBoundingClientRect();
  var bRect = bar.getBoundingClientRect();
  var left  = aRect.left - bRect.left;
  slider.style.width     = aRect.width + 'px';
  slider.style.transform = 'translateX(' + left + 'px)';
  slider.style.opacity   = '1';
}
// Repositionner au resize (la barre change de largeur)
if(typeof window !== 'undefined'){
  window.addEventListener('resize', function(){
    if(typeof _moveTabSlider === 'function') _moveTabSlider();
    if(typeof _moveSectionSlider === 'function') _moveSectionSlider();
    if(typeof _moveGroupSlider === 'function') _moveGroupSlider();
  });
  // Position initiale : après calcul du layout (fonts/CSS chargés)
  window.addEventListener('load', function(){
    setTimeout(function(){
      if(typeof _moveTabSlider === 'function') _moveTabSlider();
      if(typeof _moveSectionSlider === 'function') _moveSectionSlider();
      if(typeof _moveGroupSlider === 'function') _moveGroupSlider();
    }, 80);
  });
}

// Slider animé sous la section active (Transports/Locations/…)
function _moveSectionSlider(){
  var slider = document.getElementById('vsn-slider');
  var active = document.querySelector('#voyage-subsection-nav .vsn-item.active');
  var bar    = document.getElementById('voyage-subsection-nav');
  if(!slider || !active || !bar) return;
  var aRect = active.getBoundingClientRect();
  var bRect = bar.getBoundingClientRect();
  var left  = aRect.left - bRect.left;
  slider.style.width     = aRect.width + 'px';
  slider.style.transform = 'translateX(' + left + 'px)';
  slider.style.opacity   = '1';
}

// Slider du niveau 1 (groupes)
function _moveGroupSlider(){
  var slider = document.getElementById('vgrp-slider');
  var active = document.querySelector('#voyage-group-nav .vgrp-item.active');
  var bar    = document.getElementById('voyage-group-nav');
  if(!slider || !active || !bar) return;
  var aRect = active.getBoundingClientRect();
  var bRect = bar.getBoundingClientRect();
  var left  = aRect.left - bRect.left;
  slider.style.width     = aRect.width + 'px';
  slider.style.transform = 'translateX(' + left + 'px)';
  slider.style.opacity   = '1';
}

// Rendu de la page Explorer (recherche + carrousel d'inspiration réutilisé)
function renderExplorer(){
  var host = document.getElementById('explorer-inspiration');
  if(!host) return;
  var cfg = (window.YUME_INSPIRATION || []).filter(function(c){
    return c && c.images && c.images.length;
  });
  // Nettoyer d'anciens minuteurs Explorer
  if(window._explTimers){ Object.keys(window._explTimers).forEach(function(k){ clearInterval(window._explTimers[k]); }); }
  window._explTimers = {};
  window._explIdx = window._explIdx || {};

  if(!cfg.length){
    host.innerHTML = '<div class="expl-empty">Aucune destination pour le moment.</div>';
    return;
  }

  // Cadres par pays empilés verticalement, images qui défilent (10 s)
  host.innerHTML = '<div class="hi-label" style="margin-bottom:14px">Où partir ensuite ?</div>'
    + cfg.map(function(c){
        var label = c.label || c.country || '';
        var idx = (window._explIdx[label] || 0) % c.images.length;
        return '<div class="expl-card" data-label="'+label.replace(/"/g,'&quot;')+'">'
          + '<img src="'+c.images[idx].replace(/"/g,'&quot;')+'" alt="'+label+'" loading="lazy" onerror="this.style.opacity=0"/>'
          + '<div class="expl-grad"></div>'
          + '<span class="expl-name">'+label+'</span>'
          + (c.images.length>1 ? '<span class="expl-dots">'+c.images.map(function(_,di){
              return '<i class="'+(di===idx?'on':'')+'"></i>';
            }).join('')+'</span>' : '')
        + '</div>';
      }).join('')
    + '<div class="expl-empty" id="expl-noresult" style="display:none">Aucune destination ne correspond à votre recherche.</div>';

  // Défilement auto des images (10 s) + clic = image suivante (reset)
  function _advance(label, reset){
    var c = cfg.find(function(x){ return (x.label||x.country) === label; });
    if(!c) return;
    window._explIdx[label] = ((window._explIdx[label] || 0) + 1) % c.images.length;
    var card = host.querySelector('.expl-card[data-label="'+CSS.escape(label)+'"]');
    if(card){
      var i = window._explIdx[label];
      var img = card.querySelector('img');
      if(img){ img.style.opacity='0'; setTimeout(function(){ img.src=c.images[i]; img.style.opacity='1'; }, 180); }
      card.querySelectorAll('.expl-dots i').forEach(function(d,di){ d.classList.toggle('on', di===i); });
    }
    if(reset && window._explTimers[label]){
      clearInterval(window._explTimers[label]);
      window._explTimers[label] = setInterval(function(){ if(!host.isConnected){clearInterval(window._explTimers[label]);return;} _advance(label,false); }, 10000);
    }
  }
  cfg.forEach(function(c){
    var label = c.label || c.country || '';
    if(c.images.length < 2) return;
    window._explTimers[label] = setInterval(function(){ if(!host.isConnected){clearInterval(window._explTimers[label]);return;} _advance(label,false); }, 10000);
  });
  host.querySelectorAll('.expl-card').forEach(function(card){
    card.onclick = function(){ _advance(card.getAttribute('data-label'), true); };
  });

  // Recherche : filtre en direct les cadres pays par nom (insensible
  // à la casse et aux accents). Remplace l'ancien message « à venir ».
  var search = document.getElementById('explorer-search');
  if(search){
    if(!search._wired){
      search._wired = true;
      search._norm = function(s){
        return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      };
      search._filter = function(){
        var h = document.getElementById('explorer-inspiration');
        if(!h) return;
        var q = search._norm(search.value.trim());
        var shown = 0;
        h.querySelectorAll('.expl-card').forEach(function(card){
          var match = !q || search._norm(card.getAttribute('data-label')).indexOf(q) !== -1;
          card.style.display = match ? '' : 'none';
          if(match) shown++;
        });
        var nr = document.getElementById('expl-noresult');
        if(nr) nr.style.display = (q && shown === 0) ? '' : 'none';
        var lbl = h.querySelector('.hi-label');
        if(lbl) lbl.style.display = q ? 'none' : '';
      };
      search.addEventListener('input', search._filter);
      search.addEventListener('keydown', function(e){
        if(e.key === 'Enter'){ e.preventDefault(); search.blur(); }
      });
    }
    // Ré-appliquer un filtre éventuel après reconstruction des cartes
    if(search.value) search._filter();
  }
}

// ══════════════════════════════════════════════════════
// PROFIL — chargement et sauvegarde
// ══════════════════════════════════════════════════════
function loadProfilPage(){
  if(typeof renderGlobalDocs==='function') renderGlobalDocs();
  // Nom
  var name = localStorage.getItem('yume_profile_name') || '';
  var nameEl = document.getElementById('profil-display-name');
  if(nameEl) nameEl.textContent = name || 'Voyageur';
  var fnEl = document.getElementById('profil-fname');
  if(fnEl) fnEl.value = name;

  // Avatar
  var avatar = localStorage.getItem('yume_profile_avatar') || '';
  var avatarEl = document.getElementById('profil-avatar-display');
  if(avatarEl){
    if(avatar){
      avatarEl.innerHTML = '<img src="'+avatar+'" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>';
    } else {
      avatarEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>';
    }
  }

  // Stats
  var nbV = Object.keys(allTrips).length;
  var pays = {};
  Object.values(allTrips).forEach(function(t){
    if(t.meta && t.meta.country) pays[t.meta.country] = 1;
  });
  var nbP = Object.keys(pays).length;
  var pvEl = document.getElementById('profil-stat-voyages');
  var ppEl = document.getElementById('profil-stat-pays');
  if(pvEl) pvEl.textContent = nbV;
  if(ppEl) ppEl.textContent = nbP;

  // Carte « prochain voyage » (3e carte stats)
  (function(){
    var nextCard = document.getElementById('profil-next-card');
    var nnEl = document.getElementById('profil-next-name');
    var nsEl = document.getElementById('profil-next-state');
    var ids = Object.keys(allTrips || {});
    if(!ids.length){
      if(nnEl) nnEl.textContent = '—';
      if(nsEl) nsEl.textContent = 'aucun';
      if(nextCard) nextCard.onclick = null;
      return;
    }
    var now = new Date(); now.setHours(0,0,0,0);
    var best=null, bestScore=Infinity, bestState='nodate';
    ids.forEach(function(id){
      var mm = (allTrips[id] && allTrips[id].meta) || {};
      var dep = mm.dateDep ? parseDDMMYYYY(mm.dateDep) : null;
      var ret = mm.dateRet ? parseDDMMYYYY(mm.dateRet) : null;
      var st, sc;
      if(dep && ret && now >= dep && now <= ret){ st='ongoing';  sc=-1e15; }
      else if(dep && dep > now)                 { st='upcoming'; sc=dep-now; }
      else if(ret || dep)                       { st='past';     sc=1e15+(now-(ret||dep)); }
      else                                      { st='nodate';   sc=2e15; }
      if(sc < bestScore){ bestScore=sc; best=id; bestState=st; }
    });
    var bm = (allTrips[best] && allTrips[best].meta) || {};
    var title = bm.country || bm.name || 'Voyage';
    var state = bestState==='ongoing' ? 'en cours'
              : bestState==='upcoming' ? 'à venir'
              : bestState==='past' ? 'terminé' : 'à planifier';
    if(nnEl) nnEl.textContent = title;
    if(nsEl) nsEl.textContent = state;
    if(nextCard) nextCard.onclick = function(){ openTrip(best); };
  })();

  // Ancienneté (date d'installation en localStorage)
  var installed = localStorage.getItem('yume_installed_at');
  if(!installed){
    installed = new Date().toISOString().slice(0,10);
    localStorage.setItem('yume_installed_at', installed);
  }
  var since = '';
  try{
    var d0 = new Date(installed);
    var now = new Date();
    var months = (now.getFullYear()-d0.getFullYear())*12 + (now.getMonth()-d0.getMonth());
    if(months === 0) since = 'Membre depuis aujourd\'hui';
    else if(months === 1) since = 'Membre depuis 1 mois';
    else since = 'Membre depuis '+months+' mois';
  } catch(e){}
  var sinceEl = document.getElementById('profil-since');
  if(sinceEl) sinceEl.textContent = since;

  // Champs email / téléphone / langue
  var fields = ['email','phone','lang'];
  fields.forEach(function(f){
    var el = document.getElementById('profil-'+f);
    if(el) el.value = localStorage.getItem('yume_profil_'+f) || '';
  });

  // Sync sliders paramètres
  var br = parseFloat(localStorage.getItem('yume_bg_brightness') || '1');
  var bl = parseFloat(localStorage.getItem('yume_bg_blur') || '0');
  var brEl = document.getElementById('psp-brightness-range');
  var blEl = document.getElementById('psp-blur-range');
  var brLbl = document.getElementById('psp-brightness-val');
  var blLbl = document.getElementById('psp-blur-val');
  if(brEl){ brEl.value = Math.round(br*100); }
  if(blEl){ blEl.value = bl; }
  if(brLbl) brLbl.textContent = Math.round(br*100)+'%';
  if(blLbl) blLbl.textContent = bl+'px';

  // Sync theme chips
  var theme = localStorage.getItem('yume_theme') || 'standard';
  document.querySelectorAll('#psp-theme-grid .theme-chip').forEach(function(c){
    c.classList.toggle('active', c.getAttribute('data-theme')===theme);
  });
}

function saveProfileField(field, val){
  if(field === 'fname'){
    localStorage.setItem('yume_profile_name', val);
    var nameEl = document.getElementById('profil-display-name');
    if(nameEl) nameEl.textContent = val || 'Voyageur';
  } else {
    localStorage.setItem('yume_profil_'+field, val);
  }
}

function toggleProfilSettings(){
  openSettingsModal();
}

function openSettingsModal(){
  var overlay = document.getElementById('settings-modal-overlay');
  if(!overlay) return;
  // Sync sliders avec l'état actuel avant ouverture
  var br = parseFloat(localStorage.getItem('yume_bg_brightness') || '1');
  var bl = parseFloat(localStorage.getItem('yume_bg_blur') || '0');
  var brEl = document.getElementById('psp-brightness-range');
  var blEl = document.getElementById('psp-blur-range');
  var brLbl = document.getElementById('psp-brightness-val');
  var blLbl = document.getElementById('psp-blur-val');
  if(brEl){ brEl.value = Math.round(br*100); }
  if(blEl){ blEl.value = bl; }
  if(brLbl) brLbl.textContent = Math.round(br*100)+'%';
  if(blLbl) blLbl.textContent = bl+'px';
  // Sync thème actif
  var theme = localStorage.getItem('yume_theme') || 'standard';
  document.querySelectorAll('#psp-theme-grid .theme-chip').forEach(function(c){
    c.classList.toggle('active', c.getAttribute('data-theme') === theme);
  });
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  // Fermeture Escape
  document._settingsEscHandler = function(e){
    if(e.key === 'Escape') closeSettingsModal();
  };
  document.addEventListener('keydown', document._settingsEscHandler);
}

function closeSettingsModal(e){
  if(e && e.target !== document.getElementById('settings-modal-overlay')) return;
  var overlay = document.getElementById('settings-modal-overlay');
  if(!overlay) return;
  overlay.classList.remove('open');
  document.body.style.overflow = '';
  if(document._settingsEscHandler){
    document.removeEventListener('keydown', document._settingsEscHandler);
    document._settingsEscHandler = null;
  }
}

// ══════════════════════════════════════════════════════════
// RAIL RÉTRACTABLE (desktop) — masque/affiche rail + panneau
// L'utilisateur peut replier les deux colonnes de gauche pour
// que la sous-section active occupe toute la largeur. Choix
// mémorisé (localStorage) ; le bouton vit dans la topbar pour
// rester accessible même rail replié.
// ══════════════════════════════════════════════════════════
function _applyRailState(){
  var collapsed = localStorage.getItem('yume_rail_collapsed') === '1';
  document.body.classList.toggle('rail-collapsed', collapsed);
  var btn = document.getElementById('rail-toggle');
  if(btn){
    btn.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
    btn.title = collapsed ? 'Afficher les menus' : 'Masquer les menus';
  }
}

function toggleRail(){
  var collapsed = !(localStorage.getItem('yume_rail_collapsed') === '1');
  localStorage.setItem('yume_rail_collapsed', collapsed ? '1' : '0');
  _applyRailState();
  // La carte Leaflet doit recalculer sa taille après l'animation de repli
  setTimeout(function(){
    if(window._tripmapInstance && window._tripmapInstance.invalidateSize){
      window._tripmapInstance.invalidateSize();
    }
    if(typeof _moveSectionSlider === 'function') _moveSectionSlider();
  }, 320);
}





function showAppScreen(){
  // Active page-voyage sans passer par showPage() (éviter boucle infinie)
  document.querySelectorAll('.spa-page').forEach(function(p){
    p.classList.remove('active');
  });
  var pv = document.getElementById('page-voyage');
  if(pv) pv.classList.add('active');
  // Sync onglet tab-bar
  document.querySelectorAll('.tb-item').forEach(function(b){
    b.classList.remove('active');
  });
  var tbBtn = document.querySelector('.tb-item[data-page="voyage"]');
  if(tbBtn) tbBtn.classList.add('active');
  // Déplacer le trait animé de la nav sous « Voyage » (sinon il reste
  // visuellement sous « Accueil » alors que la page est bien Voyage).
  if(typeof _moveTabSlider === 'function') _moveTabSlider();
  // Afficher le contenu voyage, masquer le placeholder
  var placeholder = document.getElementById('voyage-placeholder');
  var voyageContent = document.getElementById('voyage-content');
  if(placeholder) placeholder.style.display = 'none';
  if(voyageContent){
    // On ne force que l'affichage flex ; la DIRECTION est laissée au CSS
    // (colonne en mobile, ligne en desktop A3 — sinon l'inline écraserait
    // le layout rail+panneau+contenu côte à côte).
    voyageContent.style.display = 'flex';
  }
  // Marqueur fiable « un voyage est ouvert » → pilote l'affichage du FAB
  // PDF sans dépendre du sélecteur :has() (compat navigateurs anciens).
  document.body.classList.add('trip-open');
  // La page voyage est affichée → activer le hamburger (repli rail/panneau)
  document.body.classList.add('view-voyage');
  // Restaurer le choix « rail replié / affiché » mémorisé (desktop)
  if(typeof _applyRailState === 'function') _applyRailState();
  // Update progress bar
  if(typeof updateVoyageProgressBar === 'function') updateVoyageProgressBar();
  // Construit la barre de navigation à plat (toutes les destinations),
  // injecte le sélecteur Pass/Transport/Location, et atterrit sur Déplacements.
  _currentSection = 'mobilite';
  if(typeof _buildSubNav === 'function') _buildSubNav();
  if(typeof _buildDeplSwitch === 'function') _buildDeplSwitch();
  goToSection('deplacements', null);
}


// ══════════════════════════════════════════════════════════
// EMOJI AUTO par type + destination
// ══════════════════════════════════════════════════════════
function getAutoEmoji(tripMeta){
  var type     = tripMeta.type     || 'V';
  var destType = tripMeta.destType || 'international';
  var country  = tripMeta.country  || '';

  if(type === 'VA'){
    return '💼'; // Affaires toujours valise (sauf override manuel)
  }
  // Voyage perso
  if(destType === 'france'){
    return '🚗'; // France → voiture
  }
  // International → drapeau si pays reconnu
  if(country){
    var iso = (typeof countryToISO === 'function') ? countryToISO(country) : '';
    if(iso && iso.length === 2){
      return (typeof isoToFlag === 'function') ? isoToFlag(iso) : '✈';
    }
  }
  return '✈';
}

// ══════════════════════════════════════════════════════════
// supprimerVoyage — UNIQUE fonction de suppression
// Appelée par tous les boutons (croix long-press, dropdown, etc.)
// ══════════════════════════════════════════════════════════
// supprimerVoyage : exécute la suppression SANS confirm()
// Le confirm() doit être appelé AVANT, dans le handler touch direct (pas dans un setTimeout)
function supprimerVoyage(tid){
  if(!allTrips[tid]) return;

  // Fermer le mode édition si actif
  var card = document.getElementById('voy-edit-card-' + tid);
  if(card) card.classList.remove('is-editing');
  var bd = document.getElementById('edit-mode-backdrop');
  if(bd) bd.classList.remove('active');

  // Couper le lien avec le voyage actif SANS snapshot
  if(tid === currentTripId){
    currentTripId = null;
    var homeBtn = document.querySelector('.tb-item[data-page="home"]');
    if(typeof showPage === 'function') showPage('home', homeBtn);
  }

  // Supprimer de la mémoire
  delete allTrips[tid];

  // Sauvegarder dans localStorage
  try{ localStorage.setItem('mv_trips', JSON.stringify(allTrips)); } catch(ex){}

  // Rafraîchir l'affichage
  if(typeof renderTripsList        === 'function') renderTripsList();
  if(typeof updateHomeTopbarStats  === 'function') updateHomeTopbarStats();
  if(typeof updateStatsBar         === 'function') updateStatsBar();
}

function deleteTrip(e, tid){
  if(typeof e === 'string'){ tid = e; }
  var name = (allTrips[tid] && allTrips[tid].meta && allTrips[tid].meta.name) || 'ce voyage';
  if(!confirm('Supprimer "' + name + '" ?')) return;
  supprimerVoyage(tid);
}

function editTrip(e, tid){
  // Compat: editTrip(null, tid) from handleEdit
  if(e === null || typeof e === 'string'){ if(typeof e === 'string') tid = e; e = null; }
  if(e && e.stopPropagation) e.stopPropagation();
  // Compat: appelé sans event
  if(typeof e === 'string'){ tid = e; e = null; }
  var t = allTrips[tid];
  if(!t) return;
  var m = t.meta || {};

  // Open the create modal pre-filled for editing
  openCreateModal();

  // Store tid being edited
  document.getElementById('create-modal').setAttribute('data-edit-tid', tid);

  // Pre-fill fields
  var nameEl = document.getElementById('new-trip-name');
  if(nameEl) nameEl.value = m.name || '';

  // Type
  selectTripType(m.type || 'V', document.getElementById(m.type === 'VA' ? 'tts-va' : 'tts-v'));

  // Destination
  var destType = m.destType || 'international';
  selectDestType(destType, document.getElementById(destType === 'france' ? 'dts-fr' : 'dts-intl'));

  if(destType === 'france'){
    var regEl = document.getElementById('new-trip-region');
    if(regEl) regEl.value = m.country || '';
  } else {
    // Charger les pays dans les chips (multi-pays)
    _tripCountries  = (m.countries && m.countries.length) ? m.countries.slice() : (m.country ? [m.country] : []);
    _primaryCountry = m.primaryCountry || _tripCountries[0] || '';
    var cntryEl = document.getElementById('new-trip-country');
    if(cntryEl) cntryEl.value = '';
    _renderSelectedCountries();
  }

  // Dates
  var depEl = document.getElementById('new-trip-date-dep');
  var retEl = document.getElementById('new-trip-date-ret');
  if(depEl) depEl.value = m.dateDep || '';
  if(retEl) retEl.value = m.dateRet || '';

  // Groupe — pré-remplir le toggle et les membres
  if(typeof _prefillGroupFields === 'function') _prefillGroupFields(m);

  // Update button label
  var createBtn = document.querySelector('#create-modal .btn-primary');
  if(createBtn) createBtn.textContent = 'Enregistrer →';
  var titleEl = document.querySelector('.create-modal-title');
  if(titleEl) titleEl.textContent = 'Modifier le voyage';
}

// Override createTrip to handle both create and edit
var _origCreateTrip = null;
(function(){
  // Wrap createTrip to support editing mode
  var orig = window.createTrip;
  window.createTrip = function(){
    var modal = document.getElementById('create-modal');
    var editTid = modal ? modal.getAttribute('data-edit-tid') : null;
    if(editTid && allTrips[editTid]){
      // ── EDIT MODE ──
      var type     = document.getElementById('new-trip-type').value || 'V';
      var destType = document.getElementById('new-trip-dest-type').value || 'international';
      var country  = '';
      if(destType === 'france'){
        var reg = document.getElementById('new-trip-region');
        country = (reg && reg.value) ? reg.value : 'France';
      } else {
        var ci = document.getElementById('new-trip-country');
        country = ci ? ci.value.trim() : '';
      }
      var dateDep = (document.getElementById('new-trip-date-dep') || {}).value || '';
      var dateRet = (document.getElementById('new-trip-date-ret') || {}).value || '';
      var name    = document.getElementById('new-trip-name').value.trim();
      if(!name){ document.getElementById('new-trip-name').focus(); return; }

      // Construire la liste finale des pays (edit mode)
      var finalCountries = _tripCountries.slice();
      if(destType === 'france'){
        var reg2 = document.getElementById('new-trip-region');
        finalCountries = [(reg2 && reg2.value) ? reg2.value : 'France'];
      } else {
        var ci2 = document.getElementById('new-trip-country');
        var iv2 = ci2 ? ci2.value.trim() : '';
        if(iv2 && finalCountries.indexOf(iv2) === -1) finalCountries.push(iv2);
      }
      var country = finalCountries[0] || '';

      var m = allTrips[editTid].meta;
      m.name         = name;
      m.type         = type;
      m.destType     = destType;
      m.country      = country;
      m.countries    = finalCountries;
      m.primaryCountry = _primaryCountry;
      m.dateDep      = dateDep;
      m.dateRet      = dateRet;
      var autoEmoji = getAutoEmoji(m);
      m.emoji = autoEmoji;

      saveAllTrips();
      modal.removeAttribute('data-edit-tid');
      closeCreateModal();
      _resetCreateModal();
      // Reset modal labels
      var cb = document.querySelector('#create-modal .btn-primary');
      if(cb) cb.textContent = 'Créer →';
      var tt = document.querySelector('.create-modal-title');
      if(tt) tt.textContent = 'Nouveau voyage';
      renderTripsList();
      updateHomeTopbarStats();
      if(typeof updateStatsBar === 'function') updateStatsBar();
      // Si le voyage modifié est celui en cours, adapter les sections
      if(editTid === currentTripId && typeof _adaptSectionsForTrip === 'function'){
        _adaptSectionsForTrip(editTid);
      }
    } else {
      // ── CREATE MODE ──
      modal && modal.removeAttribute('data-edit-tid');
      orig();
    }
  };
})();

// ── HÉRO ACCUEIL — le voyage qui compte maintenant ───────────────────
// Carte mise en avant : voyage EN COURS en priorité, sinon le prochain
// départ, sinon le dernier voyage terminé. Compte à rebours, progression,
// budget restant — toutes les données existent déjà dans allTrips.
function renderHomeHero(){
  var el = document.getElementById('home-hero');
  if(!el) return;
  var ids = Object.keys(allTrips || {});
  if(!ids.length){ el.style.display='none'; el.innerHTML=''; return; }

  var now = new Date(); now.setHours(0,0,0,0);
  var best=null, bestScore=Infinity, bestState='nodate';
  ids.forEach(function(id){
    var m = (allTrips[id] && allTrips[id].meta) || {};
    var dep = m.dateDep ? parseDDMMYYYY(m.dateDep) : null;
    var ret = m.dateRet ? parseDDMMYYYY(m.dateRet) : null;
    var state, score;
    if(dep && ret && now >= dep && now <= ret){ state='ongoing';  score=-1e15; }
    else if(dep && dep > now)                 { state='upcoming'; score=dep - now; }
    else if(ret || dep)                       { state='past';     score=1e15 + (now - (ret||dep)); }
    else                                      { state='nodate';   score=2e15; }
    if(score < bestScore){ bestScore=score; best=id; bestState=state; }
  });
  if(best === null){ el.style.display='none'; return; }

  var trip = allTrips[best], m = trip.meta || {};
  var dep = m.dateDep ? parseDDMMYYYY(m.dateDep) : null;
  var ret = m.dateRet ? parseDDMMYYYY(m.dateRet) : null;
  var DAY = 86400000;

  // ── Textes selon l'état ──
  var MOIS = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
  function _d(d){ return d ? (d.getDate()+' '+MOIS[d.getMonth()]) : ''; }
  var kicker = 'Prochaine aventure', pill = '', pillCls = 'upcoming';
  if(bestState === 'ongoing'){
    var total = Math.max(1, Math.round((ret - dep)/DAY));
    var jour  = Math.min(total, Math.round((now - dep)/DAY) + 1);
    kicker = 'Voyage en cours'; pillCls = 'ongoing'; pill = 'En cours · J'+jour;
  } else if(bestState === 'upcoming'){
    var j = Math.round((dep - now)/DAY);
    kicker = 'Prochaine aventure'; pillCls = 'upcoming';
    pill = (j===0) ? "Aujourd'hui" : (j===1 ? 'Demain' : 'Dans '+j+' jours');
  } else if(bestState === 'past'){
    kicker = 'Dernier voyage'; pillCls = 'past'; pill = 'Terminé';
  } else {
    kicker = 'Mon voyage'; pill = '';
  }

  var pname = (localStorage.getItem('yume_profile_name') || '').trim();
  var hello = pname ? ('Bonjour ' + pname) : 'Bonjour';
  var title = m.country || m.name || 'Mon voyage';
  var datesLine = (dep && ret) ? (_d(dep) + ' — ' + _d(ret)) : (dep ? _d(dep) : 'Dates à définir');
  var isGroup = !!(m.groupMode === true && Array.isArray(m.members) && m.members.length >= 2);
  var travel = isGroup ? ('Groupe · ' + m.members.length) : 'Solo';

  var ICO_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  var ICO_CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" width="14" height="14"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>';
  var ICO_USER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" width="14" height="14"><circle cx="12" cy="8" r="4"/><path d="M5 21c0-3.9 3.1-7 7-7s7 3.1 7 7"/></svg>';
  var ICO_BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="19" height="19"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';

  el.innerHTML = ''
    + '<div class="hh-bg" aria-hidden="true"></div>'
    + '<div class="hh-top">'
      + '<div class="hh-greet"><span class="hh-hi">' + hello + '</span>'
      + '<span class="hh-kicker">' + kicker + '</span></div>'
      + '<button class="hh-bell" onclick="event.stopPropagation();openSettings && openSettings()" aria-label="Notifications">' + ICO_BELL + '</button>'
    + '</div>'
    + '<div class="hh-body">'
      + (pill ? '<span class="hh-pill hh-pill-'+pillCls+'">' + ICO_CLOCK + ' ' + pill + '</span>' : '')
      + '<div class="hh-name">' + title + '</div>'
      + '<div class="hh-meta">'
        + '<span>' + ICO_CAL + ' ' + datesLine + '</span>'
        + '<span>' + ICO_USER + ' ' + travel + '</span>'
      + '</div>'
    + '</div>'
    + '<button class="hh-open" onclick="event.stopPropagation();openTrip(\'' + best + '\')">'
      + '<span>Ouvrir le voyage</span>'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
    + '</button>';
  el.style.display = '';
  el.style.cursor = 'pointer';
  el.onclick = function(){ openTrip(best); };
}

// ══════════════════════════════════════════════════════════════════════
// ACCUEIL — DASHBOARD (stats cumulées + cartes enrichies + inspiration)
// ══════════════════════════════════════════════════════════════════════

// Lit les tableaux d'un voyage. Pour le voyage ACTIF, les données vivent
// dans les variables globales (pas encore snapshotées) → on les utilise.
function _tripArrays(tid){
  if(tid === currentTripId){
    return {
      mobilites: (typeof mobilites!=='undefined' ? mobilites : []),
      hotels:    (typeof hotels!=='undefined' ? hotels : []),
      lieux:     (typeof lieux!=='undefined' ? lieux : []),
      locations: (typeof locations!=='undefined' ? locations : []),
      transactions:(typeof transactions!=='undefined' ? transactions : []),
      budget:    (typeof budget!=='undefined' ? budget : ((allTrips[tid]||{}).budget||0))
    };
  }
  var t = allTrips[tid] || {};
  return {
    mobilites: t.mobilites||[], hotels:t.hotels||[], lieux:t.lieux||[],
    locations:t.locations||[], transactions:t.transactions||[], budget:t.budget||0
  };
}

// Nombre de villes distinctes touchées par un voyage (hôtels + lieux)
function _tripCities(tid){
  var a = _tripArrays(tid);
  var set = {};
  (a.hotels||[]).forEach(function(h){ if(h.ville) set[h.ville.trim().toLowerCase()] = 1; });
  (a.lieux||[]).forEach(function(l){ if(l.ville) set[l.ville.trim().toLowerCase()] = 1; });
  return Object.keys(set).length;
}

// Nombre de trajets d'un voyage
function _tripLegs(tid){
  var a = _tripArrays(tid);
  return (a.mobilites||[]).filter(function(m){ return m.type !== 'pass'; }).length;
}

// ── Option 1 : bandeau de statistiques cumulées ──
function renderHomeStats(){
  var el = document.getElementById('home-stats-grid');
  if(!el) return;
  var ids = Object.keys(allTrips || {});
  if(!ids.length){ el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';

  var nbVoyages = ids.length;
  var pays = {}, villes = {}, nuits = 0;
  ids.forEach(function(tid){
    var m = (allTrips[tid].meta) || {};
    var isIntl = !m.destType || m.destType === 'international';
    if(isIntl && m.country) pays[m.country] = 1;
    var a = _tripArrays(tid);
    (a.hotels||[]).forEach(function(h){
      if(h.ville) villes[h.ville.trim().toLowerCase()] = 1;
      nuits += (typeof _hotelNights==='function' ? _hotelNights(h) : (parseInt(h.nuits)||0));
    });
    (a.lieux||[]).forEach(function(l){ if(l.ville) villes[l.ville.trim().toLowerCase()] = 1; });
  });

  var stats = [
    { v: nbVoyages,                value: nbVoyages, label: nbVoyages>1?'Voyages':'Voyage' },
    { v: Object.keys(pays).length, label: 'Pays' },
    { v: Object.keys(villes).length, label: 'Villes' },
    { v: nuits,                    label: 'Nuits' }
  ];
  el.innerHTML = stats.map(function(s){
    return '<div class="hsg-stat"><div class="hsg-v">' + s.v + '</div>'
      + '<div class="hsg-l">' + s.label + '</div></div>';
  }).join('');
}

// ── Option 4 : carrousel d'inspiration façon SNCF (v2) ──
// 3 cases visibles. Flèches ‹ › DE PART ET D'AUTRE (gauche de la 1re
// case, droite de la 3e), centrées verticalement. Décalage des pays
// avec animation de glissement. Dans chaque case, l'image change toutes
// les 10 s ; un clic passe à l'image suivante ET remet le minuteur à 0.
var _inspWindow = 0;
var _inspImgIdx = {};                // label → index image courante
var _inspTimers = {};                // label → timer 10s individuel
// Wrapper : rend l'inspiration dans un conteneur cible (Accueil ou Explorer)
window._renderInspirationInto = function(el){
  if(!el) return;
  renderHomeInspiration(el.id);
};

function renderHomeInspiration(targetId){
  var el = document.getElementById(targetId || 'home-inspiration');
  if(!el) return;
  var cfg = (window.YUME_INSPIRATION || []).filter(function(c){
    return c && c.images && c.images.length;
  });
  // Nettoyer les anciens minuteurs
  Object.keys(_inspTimers).forEach(function(k){ clearInterval(_inspTimers[k]); });
  _inspTimers = {};
  if(!cfg.length){ el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';

  var VISIBLE = Math.min(3, cfg.length);
  var hasNav  = cfg.length > VISIBLE;

  // Squelette (construit une fois) : flèches + fenêtre + piste
  el.innerHTML =
    '<div class="ic-head"><div class="hi-label">Où partir ensuite ?</div></div>'
    + '<div class="ic-stage">'
      + (hasNav ? '<button class="ic-arrow ic-arrow-l" id="ic-prev" aria-label="Précédent"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M15 18l-6-6 6-6"/></svg></button>' : '')
      + '<div class="ic-viewport"><div class="ic-track" id="ic-track"></div></div>'
      + (hasNav ? '<button class="ic-arrow ic-arrow-r" id="ic-next" aria-label="Suivant"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M9 18l6-6-6-6"/></svg></button>' : '')
    + '</div>';

  var track = document.getElementById('ic-track');

  // Construit le HTML d'une case pour un pays
  function _cardHTML(country){
    var label = country.label || country.country || '';
    var imgs  = country.images;
    var idx   = (_inspImgIdx[label] || 0) % imgs.length;
    var src   = imgs[idx];
    return '<div class="ic-card" data-label="'+label.replace(/"/g,'&quot;')+'">'
      + '<img src="'+src.replace(/"/g,'&quot;')+'" alt="'+label+'" loading="lazy" onerror="this.style.opacity=0"/>'
      + '<div class="ic-grad"></div>'
      + '<span class="ic-name">'+label+'</span>'
      + (imgs.length>1 ? '<span class="ic-dots">'+imgs.map(function(_,di){
          return '<i class="'+(di===idx?'on':'')+'"></i>';
        }).join('')+'</span>' : '')
    + '</div>';
  }

  // Affiche les VISIBLE pays à partir de _inspWindow
  function _renderWindow(){
    var html = '';
    for(var k=0;k<VISIBLE;k++){
      html += _cardHTML(cfg[(_inspWindow + k) % cfg.length]);
    }
    track.innerHTML = html;
    _bindCards();
    _startTimers();
  }

  // (Re)démarre les minuteurs 10s des cases visibles
  function _startTimers(){
    Object.keys(_inspTimers).forEach(function(k){ clearInterval(_inspTimers[k]); });
    _inspTimers = {};
    for(var k=0;k<VISIBLE;k++){
      (function(country){
        var label = country.label || country.country || '';
        if(country.images.length < 2) return;
        _inspTimers[label] = setInterval(function(){
          if(!track.isConnected) { clearInterval(_inspTimers[label]); return; }
          _advanceImage(label, false);
        }, 10000);
      })(cfg[(_inspWindow + k) % cfg.length]);
    }
  }

  // Passe à l'image suivante d'un pays ; reset=true remet le minuteur à 0
  function _advanceImage(label, reset){
    var country = cfg.find(function(c){ return (c.label||c.country) === label; });
    if(!country) return;
    _inspImgIdx[label] = ((_inspImgIdx[label] || 0) + 1) % country.images.length;
    // Mettre à jour uniquement la case concernée (transition douce d'image)
    var card = track.querySelector('.ic-card[data-label="'+CSS.escape(label)+'"]');
    if(card){
      var idx = _inspImgIdx[label];
      var img = card.querySelector('img');
      if(img){ img.style.opacity='0'; setTimeout(function(){ img.src=country.images[idx]; img.style.opacity='1'; }, 180); }
      var dots = card.querySelectorAll('.ic-dots i');
      dots.forEach(function(d,di){ d.classList.toggle('on', di===idx); });
    }
    if(reset && _inspTimers[label]){
      clearInterval(_inspTimers[label]);
      _inspTimers[label] = setInterval(function(){
        if(!track.isConnected){ clearInterval(_inspTimers[label]); return; }
        _advanceImage(label, false);
      }, 10000);
    }
  }

  // Clic sur une case → image suivante + reset du minuteur
  function _bindCards(){
    track.querySelectorAll('.ic-card').forEach(function(card){
      card.onclick = function(){ _advanceImage(card.getAttribute('data-label'), true); };
    });
  }

  // Décalage de la fenêtre de pays avec animation de glissement
  var sliding = false;
  function _shift(dir){
    if(sliding) return;
    sliding = true;
    track.classList.add(dir>0 ? 'slide-left' : 'slide-right');
    setTimeout(function(){
      _inspWindow = (_inspWindow + dir + cfg.length) % cfg.length;
      track.classList.remove('slide-left','slide-right');
      track.classList.add('slide-reset');
      _renderWindow();
      // Forcer un reflow puis retirer la classe pour l'entrée en fondu
      void track.offsetWidth;
      track.classList.remove('slide-reset');
      sliding = false;
    }, 300);
  }

  var prev = document.getElementById('ic-prev');
  var next = document.getElementById('ic-next');
  if(prev) prev.onclick = function(){ _shift(-1); };
  if(next) next.onclick = function(){ _shift(1); };

  _renderWindow();
}

// Accueil mobile : révèle/masque les boutons stylo/poubelle des voyages

function renderTripsList(){
  renderHomeHero();
  renderHomeStats();
  renderHomeInspiration();
  var container = document.getElementById('trips-list-container');
  if(!container) return;
  container.innerHTML = '';

  var ids = Object.keys(allTrips);
  if(!ids.length){
    var empty = document.createElement('div');
    empty.className = 'home-empty-state';
    empty.innerHTML =
        '<div class="home-empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M9 3L3 6.5v14L9 17l6 3.5 6-3.5V3l-6 3.5L9 3z"/><line x1="9" y1="3" x2="9" y2="17"/><line x1="15" y1="6.5" x2="15" y2="20.5"/></svg></div>'
      + '<div class="home-empty-title">Aucun voyage pour l\'instant</div>'
      + '<div class="home-empty-sub">Crée ton premier voyage pour commencer à planifier.</div>';
    container.appendChild(empty);
    return;
  }

  ids.sort(function(a,b){
    var da=(allTrips[a].meta||{}).created||'';
    var db=(allTrips[b].meta||{}).created||'';
    return db.localeCompare(da);
  });

  // ── Helper : "JJ/MM/AAAA" → "12 juin 2026" en français ──
  var MOIS_FR = ['janv.','févr.','mars','avr.','mai','juin',
                 'juil.','août','sept.','oct.','nov.','déc.'];
  function fmtCardDate(ddmmyyyy){
    if(!ddmmyyyy) return '';
    var d = parseDDMMYYYY(ddmmyyyy);
    if(!d) return ddmmyyyy;
    return d.getDate()+' '+MOIS_FR[d.getMonth()]+' '+d.getFullYear();
  }

  ids.forEach(function(tid){
    var t   = allTrips[tid];
    var m   = t.meta || {};
    var destType = m.destType || 'international';
    var country  = m.country  || '';
    var dateDep  = m.dateDep  || '';
    var dateRet  = m.dateRet  || '';
    var isActive = (tid === currentTripId);

    // ── Formatage date ──
    var dateLabel = '';
    if(dateDep && dateRet){
      var dObj = parseDDMMYYYY(dateDep), rObj = parseDDMMYYYY(dateRet);
      var depStr = (dObj && rObj && dObj.getFullYear()===rObj.getFullYear())
        ? (dObj.getDate()+' '+MOIS_FR[dObj.getMonth()])
        : fmtCardDate(dateDep);
      dateLabel = depStr + ' \u2014 ' + fmtCardDate(dateRet);
    } else if(dateDep){
      dateLabel = fmtCardDate(dateDep);
    } else {
      dateLabel = m.created ? m.created.slice(0,10) : '';
    }

    // ── Statut Solo / Groupe ──
    var isGroup = !!(m.groupMode === true && Array.isArray(m.members) && m.members.length >= 2);
    var statusHTML = isGroup
      ? '<span class="voy-status-group">Groupe \u2022 ' + m.members.length + '</span>'
      : '<span class="voy-status-solo">Solo</span>';

    // ── Pays + type de voyage (ligne secondaire) ──
    var tripTypeLabel = (m.type === 'VA') ? 'Affaires' : 'Voyage';
    var subParts = [];
    if(country) subParts.push(country);
    subParts.push(tripTypeLabel);
    var subLabel = subParts.join(' · ');

    // ── Statut vivant ──
    var _now = new Date(); _now.setHours(0,0,0,0);
    var _dep = parseDDMMYYYY(dateDep), _ret = parseDDMMYYYY(dateRet);
    var tState = 'nodate', tBadge = '', tBadgeCls = '';
    if(_dep && _ret && _now >= _dep && _now <= _ret){
      var _jour = Math.round((_now - _dep)/86400000) + 1;
      tState='ongoing'; tBadgeCls='ongoing'; tBadge='En cours · J'+_jour;
    } else if(_dep && _dep > _now){
      var _dd = Math.round((_dep - _now)/86400000);
      tState='upcoming'; tBadgeCls='upcoming';
      tBadge = (_dd===0) ? "Aujourd'hui" : (_dd===1 ? 'Demain' : 'Dans '+_dd+' jours');
    } else if(_ret || _dep){
      tState='past'; tBadge='Terminé'; tBadgeCls='past';
    }

    var nbJours = (_dep && _ret) ? Math.max(1, Math.round((_ret-_dep)/86400000)+1) : null;
    var nbVilles = _tripCities(tid);
    var nbTrajets = _tripLegs(tid);

    var counters = [];
    if(nbJours)            counters.push('<div class="vc-kv"><b>'+nbJours+'</b> jours</div>');
    if(nbVilles)           counters.push('<div class="vc-kv"><b>'+nbVilles+'</b> villes</div>');
    if(nbTrajets)          counters.push('<div class="vc-kv"><b>'+nbTrajets+'</b> trajets</div>');
    if(t.budget>0)         counters.push('<div class="vc-kv"><b>'+Math.round(t.budget)+' €</b> budget</div>');

    // Vignette : aplat teinté (theme-aware) — pâle en clair, sourd en sombre
    var thumbStyle = 'background:var(--sakura-light);';

    // ── Créer la carte ──
    var card = document.createElement('div');
    card.className = 'voy-card' + (isActive ? ' is-active' : '') + ' state-'+tState;
    card.id = 'voy-edit-card-'+tid;
    card.setAttribute('data-tid', tid);

    // ── Bouton SUPPRIMER (croix rouge) ──
    var delBtn = document.createElement('button');
    delBtn.className = 'delete-btn';
    delBtn.setAttribute('data-tid', tid);
    delBtn.setAttribute('title', 'Supprimer');
    delBtn.textContent = '\u2715';
    card.appendChild(delBtn);

    // ── Bouton MODIFIER (stylo bleu) ──
    var editBtn = document.createElement('button');
    editBtn.className = 'edit-btn';
    editBtn.setAttribute('data-tid', tid);
    editBtn.setAttribute('title', 'Modifier');
    editBtn.textContent = '\u270E';
    card.appendChild(editBtn);

    // ── Grille 3 colonnes ──
    var inner = document.createElement('div');
    inner.className = 'voy-card-inner';
    inner.innerHTML =
        '<div class="voy-thumb" style="'+thumbStyle+'"></div>'
      + '<div class="voy-col-name">'
          + '<span class="voy-col-name-text">'+(m.name||'Voyage')+'</span>'
          + '<span class="voy-col-name-country">'+subLabel+'</span>'
          + '<span class="voy-meta-line">'+(dateLabel||'')+(dateLabel?' \u00b7 ':'')+(isGroup?('Groupe \u00b7 '+m.members.length):'Solo')+'</span>'
          + (tBadge ? '<span class="voy-live-badge vlb-'+tBadgeCls+'">'+tBadge+'</span>' : '')
          + (counters.length ? '<div class="voy-counters">'+counters.join('')+'</div>' : '')
        + '</div>'
      + '<div class="voy-col-dates">'
          + '<span class="voy-col-dates-text">'+(dateLabel||'—')+'</span>'
        + '</div>'
      + '<div class="voy-col-status">'
          + statusHTML
          + '<div class="voy-actions">'
            + '<button class="voy-act-btn" title="Modifier" onclick="event.stopPropagation();editTrip(null,\''+tid+'\')">'
              + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" width="15" height="15"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>'
            + '</button>'
            + '<button class="voy-act-btn voy-act-del" title="Supprimer" onclick="event.stopPropagation();deleteTrip(null,\''+tid+'\')">'
              + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" width="15" height="15"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>'
            + '</button>'
          + '</div>'
        + '</div>'
      + '<div class="voy-chevron" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M9 6l6 6-6 6"/></svg></div>';
    card.appendChild(inner);

    // ══════════════════════════════════════════════════════
    // LONG PRESS → mode édition
    // ══════════════════════════════════════════════════════
    var lpTimer = null;
    var _editJustActivated = false;

    function _activateEditMode(){
      // Désactiver les autres cartes
      document.querySelectorAll('.voy-card.is-editing').forEach(function(c){
        if(c !== card) c.classList.remove('is-editing');
      });
      card.classList.add('is-editing');
      _editJustActivated = true;
      if(navigator.vibrate) navigator.vibrate(40);

      // Lever le verrou après 300ms (absorbe le clic fantôme iPhone)
      setTimeout(function(){
        _editJustActivated = false;

        // Fermeture en touchant AILLEURS que la carte ou ses boutons
        // On utilise document, pas le backdrop (qui bloquerait les boutons)
        function _closeOnOutside(ev){
          if(card.contains(ev.target)) return; // touche sur la carte → ignorer
          card.classList.remove('is-editing');
          var bd = document.getElementById('edit-mode-backdrop');
          if(bd) bd.classList.remove('active');
          document.removeEventListener('touchstart', _closeOnOutside, true);
          document.removeEventListener('click',      _closeOnOutside, true);
        }
        document.addEventListener('touchstart', _closeOnOutside, {capture:true, passive:true});
        document.addEventListener('click',      _closeOnOutside, {capture:true});
      }, 300);

      // Backdrop visuel seulement (pointer-events:none en CSS)
      var bd = document.getElementById('edit-mode-backdrop');
      if(bd) bd.classList.add('active');
    }

    function _startLP(e){
      // Ne pas déclencher si on touche déjà un bouton d'action
      if(e.target === delBtn || e.target === editBtn) return;
      lpTimer = setTimeout(_activateEditMode, 800);
    }
    function _cancelLP(){
      if(lpTimer){ clearTimeout(lpTimer); lpTimer = null; }
    }

    card.addEventListener('touchstart', _startLP, {passive:true});
    card.addEventListener('touchmove',  _cancelLP, {passive:true});
    card.addEventListener('touchend',   _cancelLP, {passive:true});
    card.addEventListener('mousedown',  _startLP);
    card.addEventListener('mouseup',    _cancelLP);
    card.addEventListener('mouseleave', _cancelLP);

    // Clic normal → ouvrir le voyage (sauf si en mode édition ou bouton)
    card.addEventListener('click', function(e){
      if(e.target === delBtn || e.target === editBtn) return;
      if(_editJustActivated) return;
      if(card.classList.contains('is-editing')){
        card.classList.remove('is-editing');
        var bd = document.getElementById('edit-mode-backdrop');
        if(bd){ bd.classList.remove('active'); bd.onclick = null; }
        return;
      }
      openTrip(tid);
    });

    // ══════════════════════════════════════════════════════
    // BOUTON SUPPRIMER — listeners directs, prioritaires
    // ══════════════════════════════════════════════════════
    // ── Helper : fermer le mode édition proprement ──
    function _closeEditMode(){
      card.classList.remove('is-editing');
      var bd = document.getElementById('edit-mode-backdrop');
      if(bd) bd.classList.remove('active');
    }

    // ══════════════════════════════════════════════════════
    // BOUTON SUPPRIMER (croix rouge)
    // ══════════════════════════════════════════════════════
    delBtn.addEventListener('touchstart', function(e){
      e.stopPropagation();
      _cancelLP();
    }, {passive:false});

    delBtn.addEventListener('touchend', function(e){
      e.stopPropagation();
      e.preventDefault();
      // Identique au stylo : setTimeout pour sortir du contexte touch (fix iOS Safari)
      setTimeout(function(){
        _closeEditMode();
        supprimerVoyage(tid);
      }, 50);
    }, {passive:false});

    delBtn.addEventListener('click', function(e){
      e.stopPropagation();
      _closeEditMode();
      supprimerVoyage(tid);
    });

    // ══════════════════════════════════════════════════════
    // BOUTON MODIFIER (stylo bleu)
    // ══════════════════════════════════════════════════════
    editBtn.addEventListener('touchstart', function(e){
      e.stopPropagation(); // empêche le long-press de la carte
      _cancelLP();
    }, {passive:false});

    editBtn.addEventListener('touchend', function(e){
      e.stopPropagation();
      e.preventDefault();
      // setTimeout : sort du contexte touch avant d'ouvrir la modale (fix iOS)
      setTimeout(function(){
        _closeEditMode();
        editTrip(null, tid);
      }, 50);
    }, {passive:false});

    editBtn.addEventListener('click', function(e){
      e.stopPropagation();
      _closeEditMode();
      editTrip(null, tid);
    });

    container.appendChild(card);
  });

  // ── 3 voyages les plus récents visibles ; le reste dans une modale ──
  var cards = Array.prototype.slice.call(container.querySelectorAll('.voy-card'));
  if(cards.length > 3){
    cards.forEach(function(c, i){ if(i >= 3) c.classList.add('voy-hidden'); });
    var btn = document.createElement('button');
    btn.id = 'voy-showmore';
    btn.innerHTML = 'Voir les voyages plus anciens'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M6 9l6 6 6-6"/></svg>';
    btn.onclick = function(){ openOlderTrips(); };
    container.appendChild(btn);
  }
}

// ── Modale « Tous mes voyages » (anciens inclus) ──
function openOlderTrips(){
  var modal = document.getElementById('older-trips-modal');
  var list  = document.getElementById('older-trips-list');
  if(!modal || !list) return;

  var ids = Object.keys(allTrips);
  ids.sort(function(a,b){
    var da=(allTrips[a].meta||{}).created||'';
    var db=(allTrips[b].meta||{}).created||'';
    return db.localeCompare(da);
  });

  var MOIS_FR = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
  function fmt(d){ if(!d) return ''; var o=parseDDMMYYYY(d); return o ? o.getDate()+' '+MOIS_FR[o.getMonth()]+' '+o.getFullYear() : d; }

  list.innerHTML = ids.map(function(tid){
    var m = allTrips[tid].meta || {};
    var dates = (m.dateDep||m.dateRet) ? (fmt(m.dateDep) + (m.dateRet ? ' — ' + fmt(m.dateRet) : '')) : 'Dates à définir';
    var sub = (m.country ? m.country : '') + (m.type==='VA'||m.type==='A' ? ' · Affaires' : ' · Voyage');
    var _src=(m.country||m.name||'Y'),_h=0; for(var i=0;i<_src.length;i++){_h=(_h*31+_src.charCodeAt(i))&0xffff;}
    var hue=_h%360;
    return '<div class="ot-row" onclick="openTrip(\''+tid+'\');closeOlderTrips();">'
      + '<span class="ot-thumb" style="background:linear-gradient(135deg,hsl('+hue+',42%,52%),hsl('+((hue+40)%360)+',46%,38%))"></span>'
      + '<span class="ot-body"><span class="ot-name">'+(m.name||'Voyage')+'</span>'
      + '<span class="ot-sub">'+sub+'</span></span>'
      + '<span class="ot-dates">'+dates+'</span>'
    + '</div>';
  }).join('');

  modal.classList.add('open');
}
function closeOlderTrips(){
  var modal = document.getElementById('older-trips-modal');
  if(modal) modal.classList.remove('open');
}






function openTrip(tid){
  // ── SILOTAGE : sauvegarder le voyage précédent avant de switcher ──
  if(currentTripId && currentTripId !== tid && typeof snapshotCurrentTrip === 'function'){
    snapshotCurrentTrip();
  }
  currentTripId = tid;
  restoreTrip(tid);
  var m = allTrips[tid].meta || {};
  // Update voyage header
  var tripNameEl = document.getElementById('app-trip-name');
  if(tripNameEl) tripNameEl.textContent = m.name || 'Mon voyage';
  // Reset sections (tab-belt)
  document.querySelectorAll('.section').forEach(function(s){s.classList.remove('active');});
  var tabMobilite = document.getElementById('tab-mobilite');
  if(tabMobilite) tabMobilite.classList.add('active');
  // Reset old nav-items
  document.querySelectorAll('.nav-item').forEach(function(b){b.classList.remove('active');});
  var firstNavItem = document.querySelector('.nav-item[data-tab="mobilite"]');
  if(firstNavItem) firstNavItem.classList.add('active');
  // Repositionner le belt sur la section mobilite
  var belt = document.getElementById('tab-belt');
  if(belt){
    belt.style.transition = 'none';
    belt.style.transform  = 'translate3d(0,0,0)';
  }
  // Fermer formulaires et modales — restaurer le DOM (fix formulaires orphelins)
  if(typeof _closeFormModal === 'function' && typeof _currentOpenForm !== 'undefined' && _currentOpenForm){
    _closeFormModal(_currentOpenForm, true);
  }
  document.querySelectorAll('.add-form.open').forEach(function(f){f.classList.remove('open');});
  var _fmOverlay = document.getElementById('form-modal-overlay');
  if(_fmOverlay) _fmOverlay.classList.remove('open');
  if(typeof closeModal==='function') closeModal();
  // Rendu des sections — mobilite seulement au démarrage (lazy render pour les autres)
  _sectionRendered = {}; // reset lazy render flags
  if(typeof initDropdowns==='function') initDropdowns();
  if(typeof renderMobilite==='function')  renderMobilite();
  if(typeof renderLocations==='function') renderLocations();
  if(typeof renderVols==='function')      renderVols();
  if(typeof renderPasses==='function')    renderPasses();
  // Reconstruire les selects pays avec les pays du voyage nouvellement ouvert
  if(typeof _populatePaysDatalists==='function') _populatePaysDatalists();
  // Hotels et Lieux chargés lazily au premier accès via switchSection()
  // Scroll section active vers le haut
  var voyageSec = document.getElementById('voyage-sections');
  if(voyageSec) voyageSec.scrollTo({left:0, behavior:'instant'});
  var tabMob = document.getElementById('tab-mobilite');
  if(tabMob) tabMob.scrollTop = 0;
  var txDate = document.getElementById('tx-date');
  if(txDate) txDate.valueAsDate = new Date();
  if(typeof updateBudget==='function') updateBudget();
  // Carte Leaflet
  if(typeof geojsonLayer !== 'undefined' && geojsonLayer && typeof leafletInitDone !== 'undefined' && leafletInitDone){
    if(typeof refreshAllCountryColors==='function') refreshAllCountryColors();
    if(typeof renderSelectedCountries==='function') renderSelectedCountries();
    if(typeof updateCountryPanel==='function') updateCountryPanel(null);
  }
  // Naviguer vers la page Voyage (sans boucle)
  showAppScreen();
  if(typeof updateStatsBar==='function') updateStatsBar();
  // Mettre à jour la barre de progression voyage
  if(typeof updateVoyageProgressBar==='function') updateVoyageProgressBar();
  // Adapter les sections selon France vs International
  _adaptSectionsForTrip(tid);
  if(typeof applyRateForCurrentTrip==='function') applyRateForCurrentTrip();
  if(typeof updateRateDisplay==='function') updateRateDisplay();
  if(typeof updateTripProgressBar==='function') updateTripProgressBar();
}

// deleteTrip — voir supprimerVoyage()

// ── Création d'un voyage ──
function openCreateModal(){
  document.getElementById('create-modal').classList.add('open');
  if(typeof renderCountryTags==='function') renderCountryTags();
  // Reset champs groupe (mode création) — en mode édition, _prefillGroupFields() sera
  // appelé juste après openCreateModal() et écrasera ce reset
  if(typeof _resetGroupModalFields === 'function') _resetGroupModalFields();
  setTimeout(function(){ document.getElementById('new-trip-name').focus(); }, 80);
}
function closeCreateModal(){
  document.getElementById('create-modal').classList.remove('open');
  ['new-trip-name','new-trip-emoji','new-trip-country','new-trip-date-dep','new-trip-date-ret'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.value='';
  });
  var sug=document.getElementById('country-suggestions');
  if(sug) sug.classList.remove('open');
}
function createTrip(){
  var name     = document.getElementById('new-trip-name').value.trim();
  var type     = document.getElementById('new-trip-type').value || 'V';
  var destType = document.getElementById('new-trip-dest-type').value || 'international';
  var dateDep  = (document.getElementById('new-trip-date-dep')  || {}).value || '';
  var dateRet  = (document.getElementById('new-trip-date-ret')  || {}).value || '';

  if(!name){ document.getElementById('new-trip-name').focus(); return; }

  // ── Garde-fous de saisie ──
  // 1. Nom : au moins 2 caractères et au moins une lettre (évite les
  //    saisies type « rgf°z'g » ou vides de sens).
  if(name.length < 2 || !/[a-zA-ZÀ-ÿ]/.test(name)){
    if(typeof showToast==='function') showToast('Donne un nom de voyage valide (lettres requises)', 'error');
    document.getElementById('new-trip-name').focus();
    return;
  }
  // 2. Cohérence des dates : le retour ne peut pas précéder le départ.
  if(dateDep && dateRet){
    var _d1 = parseDDMMYYYY(dateDep), _d2 = parseDDMMYYYY(dateRet);
    if(_d1 && _d2 && _d2 < _d1){
      if(typeof showToast==='function') showToast('La date de retour est avant le départ', 'error');
      return;
    }
  }

  // Construire la liste finale des pays
  var finalCountries = _tripCountries.slice();
  if(destType === 'france'){
    var reg = document.getElementById('new-trip-region');
    finalCountries = [(reg && reg.value) ? reg.value : 'France'];
  } else {
    // Absorber ce qui reste dans l'input texte
    var ci  = document.getElementById('new-trip-country');
    var inputVal = ci ? ci.value.trim() : '';
    if(inputVal && finalCountries.indexOf(inputVal) === -1) finalCountries.push(inputVal);
  }
  var country = finalCountries[0] || '';

  var tid = newTripId();
  var now = new Date();
  var created = now.getDate() + ' ' + ['jan.','fév.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'][now.getMonth()] + ' ' + now.getFullYear();
  var autoEmoji = getAutoEmoji({type:type, destType:destType, country:country});
  var finalEmoji = autoEmoji;
  allTrips[tid] = {
    meta: { name:name, emoji:finalEmoji, type:type, destType:destType,
            country:country, countries:finalCountries, primaryCountry:_primaryCountry,
            dateDep:dateDep, dateRet:dateRet, created:created },
    vols:[], passes:[], trains:[], mobilites:[], locations:[],
    hotels:[], lieux:[], budget:0, transactions:[], totalNuits:(function(){
      if(dateDep && dateRet){
        var d1=parseDDMMYYYY(dateDep), d2=parseDDMMYYYY(dateRet);
        if(d1&&d2){ var diff=Math.round((d2-d1)/86400000); if(diff>0) return diff; }
      }
      return 30;
    })(),
    villeColorMap:{}, paletteCursor:0
  };
  finalCountries.forEach(function(c){ if(typeof addKnownCountry==='function') addKnownCountry(c); });
  saveAllTrips();
  closeCreateModal();
  _resetCreateModal();
  if(typeof updateStatsBar === 'function') updateStatsBar();
  // Nullifier currentTripId pour éviter tout snapshot résiduel de l'ancien voyage
  currentTripId = null;
  openTrip(tid);
}

// ── Type / destination helpers ──────────────────────────
function selectTripType(type, btn){
  document.querySelectorAll('.tts-btn').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  document.getElementById('new-trip-type').value = type;
}

function selectDestType(dest, btn){
  document.querySelectorAll('.dts-btn').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  document.getElementById('new-trip-dest-type').value = dest;
  var intlWrap   = document.getElementById('dest-intl-wrap');
  var franceWrap = document.getElementById('dest-france-wrap');
  if(intlWrap)   intlWrap.style.display   = dest === 'international' ? '' : 'none';
  if(franceWrap) franceWrap.style.display = dest === 'france'        ? '' : 'none';
}

function _resetCreateModal(){
  // Reset type to V
  document.querySelectorAll('.tts-btn').forEach(function(b){ b.classList.remove('active'); });
  var btnV = document.getElementById('tts-v');
  if(btnV) btnV.classList.add('active');
  var typeInput = document.getElementById('new-trip-type');
  if(typeInput) typeInput.value = 'V';
  // Reset dest to international
  document.querySelectorAll('.dts-btn').forEach(function(b){ b.classList.remove('active'); });
  var btnIntl = document.getElementById('dts-intl');
  if(btnIntl) btnIntl.classList.add('active');
  var destInput = document.getElementById('new-trip-dest-type');
  if(destInput) destInput.value = 'international';
  var intlWrap   = document.getElementById('dest-intl-wrap');
  var franceWrap = document.getElementById('dest-france-wrap');
  if(intlWrap)   intlWrap.style.display   = '';
  if(franceWrap) franceWrap.style.display = 'none';
  // Clear fields
  var nameEl = document.getElementById('new-trip-name');
  var cntryEl= document.getElementById('new-trip-country');
  var regEl  = document.getElementById('new-trip-region');
  var depEl  = document.getElementById('new-trip-date-dep');
  var retEl  = document.getElementById('new-trip-date-ret');
  if(nameEl)  nameEl.value  = '';
  if(cntryEl) cntryEl.value = '';
  if(regEl)   regEl.value   = '';
  if(depEl)   depEl.value   = '';
  if(retEl)   retEl.value   = '';
  // Vider les chips multi-pays
  _tripCountries  = [];
  _primaryCountry = '';
  _renderSelectedCountries();
  // Reset groupe — appelé ici pour couvrir Annuler + fin de création
  if(typeof _resetGroupModalFields === 'function') _resetGroupModalFields();
}



// Enter key in modal
document.addEventListener('keydown', function(e){
  if(e.key === 'Enter' && document.getElementById('create-modal').classList.contains('open')){
    createTrip();
  }
});



// ── Barre de progression temporelle ──
function updateTripProgressBar(){
  var fillEl  = document.getElementById('tp-fill');
  var barEl   = document.getElementById('tp-bar');
  var daysEl  = document.getElementById('tp-days-label');
  if(!fillEl||!barEl) return;

  if(!currentTripId || !allTrips[currentTripId]){
    fillEl.style.width='0%';
    if(daysEl) daysEl.textContent='';
    return;
  }

  var meta = allTrips[currentTripId].meta || {};
  var tripName = meta.name || '';
  var nameEl = document.getElementById('app-trip-name');
  if(nameEl) nameEl.textContent = tripName;

  // Point B : date de départ du voyage (meta.dateDep = JJ/MM/AAAA)
  var depDate = meta.dateDep ? parseDDMMYYYY(meta.dateDep) : null;

  // Si pas de date de départ : afficher juste le nom sans barre
  if(!depDate){
    fillEl.style.width='0%';
    barEl.style.display='none';
    if(daysEl) daysEl.textContent='';
    return;
  }
  barEl.style.display='block';

  // Point A : date de création du voyage
  // meta.created = "15 mars 2026" → parser
  var createdDate = parseCreatedDate(meta.created);
  var today = new Date();
  today.setHours(0,0,0,0);
  depDate.setHours(0,0,0,0);

  var msDay = 1000*60*60*24;
  var daysUntilDep = Math.round((depDate - today) / msDay);

  if(daysUntilDep <= 0){
    // Déjà parti ou aujourd'hui
    fillEl.style.width = '100%';
    barEl.classList.add('departed');
    if(daysEl){
      if(daysUntilDep === 0) daysEl.innerHTML = '<span class="tp-bon-voyage">Bon voyage</span>';
      else daysEl.textContent = 'En cours';
    }
    return;
  }

  barEl.classList.remove('departed');

  // Calcul du pourcentage
  var totalDays = createdDate
    ? Math.round((depDate - createdDate) / msDay)
    : daysUntilDep; // fallback si pas de date de création

  if(totalDays <= 0) totalDays = 1;
  var elapsed = totalDays - daysUntilDep;
  var pct = Math.max(0, Math.min(100, Math.round((elapsed / totalDays) * 100)));

  fillEl.style.width = pct + '%';

  if(daysEl){
    if(daysUntilDep === 1) daysEl.textContent = 'Demain !';
    else if(daysUntilDep <= 7) daysEl.textContent = 'J-'+daysUntilDep;
    else if(daysUntilDep <= 30) daysEl.textContent = 'J-'+daysUntilDep;
    else daysEl.textContent = daysUntilDep+' jours';
  }
}

// Parser "15 mars 2026" → Date
function parseCreatedDate(str){
  if(!str) return null;
  var MOIS_MAP = {
    'jan':0,'fév':1,'mars':2,'avr':3,'mai':4,'juin':5,
    'juil':6,'juil.':6,'août':7,'sept':8,'oct':9,'nov':10,'déc':11
  };
  var m = str.match(/^(\d{1,2})\s+([a-zéû.]+)\s+(\d{4})$/i);
  if(!m) return null;
  var day   = parseInt(m[1],10);
  var month = MOIS_MAP[m[2].toLowerCase().replace('.','')];
  var year  = parseInt(m[3],10);
  if(month === undefined) return null;
  return new Date(year, month, day);
}


// ════════════════════════════════════════════════════════════════════
// UTILITAIRES HH/MM SELECT
// ════════════════════════════════════════════════════════════════════

// Remplir un select HH (0-23) ou MM (0,5,...,55)
function initHMSelect(el, type, selectedVal){
  if(!el) return;
  if(type==='H'){
    el.innerHTML='<option value="">--</option>'+
      Array.from({length:24},function(_,i){
        var v=(i<10?'0'+i:i);
        return '<option value="'+i+'"'+(i===selectedVal?' selected':'')+'>'+v+'</option>';
      }).join('');
  } else if(type==='D'){ // dizaine des minutes 0-5
    el.innerHTML='<option value="">-</option>'+
      [0,1,2,3,4,5].map(function(d){
        return '<option value="'+d+'"'+(d===selectedVal?' selected':'')+'>'+d+'</option>';
      }).join('');
  } else if(type==='U'){ // unité des minutes 0-9
    el.innerHTML='<option value="">-</option>'+
      [0,1,2,3,4,5,6,7,8,9].map(function(u){
        return '<option value="'+u+'"'+(u===selectedVal?' selected':'')+'>'+u+'</option>';
      }).join('');
  }
}

// Init tous les selects HH au chargement
function initAllHMSelects(){
  // input[type=time] — nothing to initialise, browser handles it natively
}


// Autocomplete hôtel ville
function onHotelVilleInput(val){
  var box=document.getElementById('ac-ht-ville');
  if(!box) return;
  if(!val.trim()){ box.classList.remove('open'); return; }
  var q=val.trim().toLowerCase();
  var hits=Object.keys(CITY_DATA).filter(function(c){ return c.toLowerCase().indexOf(q)!==-1; }).slice(0,6);
  if(!hits.length){ box.classList.remove('open'); return; }
  box.innerHTML=hits.map(function(city){
    var d=CITY_DATA[city];
    return '<div class="ac-item" data-city="'+city.replace(/"/g,'&quot;')+'">'
      +'<span>'+city+'</span><span class="ac-sub">'+d.pays+'</span>'
    +'</div>';
  }).join('');
  box.classList.add('open');
  box.querySelectorAll('.ac-item').forEach(function(item){
    item.addEventListener('click',function(){
      var city=this.getAttribute('data-city');
      var inp=document.getElementById('ht-ville');
      if(inp) inp.value=city;
      box.classList.remove('open');
    });
  });
}

// ── Calendrier trains : ouvrir sur le mois de début du voyage ──

// Retourne {start: Date, end: Date} de la période du voyage actif
function getTripPeriod(){
  if(!currentTripId||!allTrips[currentTripId]) return null;
  var meta=allTrips[currentTripId].meta||{};
  var start = meta.dateDep ? parseDDMMYYYY(meta.dateDep) : null;
  var end   = meta.dateRet ? parseDDMMYYYY(meta.dateRet) : null;
  if(!start) return null;
  return {start:start, end:end};
}

// renderPasses PDF intégré directement dans renderPasses()

// ════════════════════════════════════════════════════════════════════
// BUDGET : devise dynamique basée sur le pays du voyage
// ════════════════════════════════════════════════════════════════════
// ── Construction dynamique du select devise (budget) ──
function _buildTxDeviseSelect(defaultCode){
  var sel = document.getElementById('tx-devise');
  if(!sel) return;

  // Collecter les devises de tous les pays du voyage actif
  var tripCodes = [];
  if(currentTripId && allTrips[currentTripId]){
    var meta = allTrips[currentTripId].meta || {};
    var countries = (meta.countries && meta.countries.length) ? meta.countries : (meta.country ? [meta.country] : []);
    countries.forEach(function(c){
      var code = COUNTRY_CURRENCY[c];
      if(code && tripCodes.indexOf(code) === -1) tripCodes.push(code);
    });
  }
  // EUR toujours présent
  if(tripCodes.indexOf('EUR') === -1) tripCodes.unshift('EUR');
  else { tripCodes.splice(tripCodes.indexOf('EUR'),1); tripCodes.unshift('EUR'); }

  // Construire les options
  sel.innerHTML = tripCodes.map(function(code){
    var info = (typeof CURRENCY_INFO!=='undefined' && CURRENCY_INFO[code]) || {sym:code, name:code};
    return '<option value="'+code+'">'+info.sym+' '+info.name+'</option>';
  }).join('');

  // Valeur par défaut : code fourni, sinon devise du voyage, sinon EUR
  var def = defaultCode || getTripCurrency();
  sel.value = (sel.querySelector('option[value="'+def+'"]')) ? def : 'EUR';

  // Hint
  var hint = document.getElementById('tx-hint-text');
  if(hint){
    var nonEur = tripCodes.filter(function(c){ return c !== 'EUR'; });
    hint.textContent = nonEur.length
      ? 'Les montants en devise étrangère sont convertis en € au taux temps réel.'
      : 'Devise unique : Euro.';
  }
}

function updateBudgetDeviseSelect(){
  _buildTxDeviseSelect();
}

// ── Patch openTrip — init HM selects + devise budget ──
var _origOpenTripHM = openTrip;
openTrip = function(tid){
  _origOpenTripHM(tid);
  _convUserPicked = false;   // nouveau voyage → reset du choix utilisateur
  _buildConvDeviseSelect();
  _buildTxDeviseSelect();
  initAllHMSelects();
  updateBudgetDeviseSelect();
};

// ── Patch openCalendar — ancrage universel sur la période du voyage ──
// Ancrage calendrier voyage — intégré dans openCalendar() directement

// Init au démarrage (apres DOM ready)
document.addEventListener('DOMContentLoaded', function(){
  initAllHMSelects();
});



// ════════════════════════════════════════════════════════════════
// TOASTS
// ════════════════════════════════════════════════════════════════
function showToast(msg, type, duration){
  type     = type     || 'success';
  duration = duration || 3200;
  var icons = {success:'✓', error:'✗', info:'i', warn:'!'};
  var container = document.getElementById('toast-container');
  if(!container) return;
  var el = document.createElement('div');
  el.className = 'toast toast-'+type;
  el.innerHTML = '<span class="t-icon">'+icons[type]+'</span><span class="t-msg">'+msg+'</span>';
  el.addEventListener('click', function(){ hideToast(el); });
  container.appendChild(el);
  var timer = setTimeout(function(){ hideToast(el); }, duration);
  el._timer = timer;
}
function hideToast(el){
  if(!el || el._hiding) return;
  el._hiding = true;
  clearTimeout(el._timer);
  el.classList.add('hiding');
  setTimeout(function(){ if(el.parentNode) el.parentNode.removeChild(el); }, 320);
}

// ════════════════════════════════════════════════════════════════
// PROFIL VOYAGEUR
// ════════════════════════════════════════════════════════════════
var _profileName   = localStorage.getItem('yume_profile_name') || '';
var _profileAvatar = localStorage.getItem('yume_profile_avatar') || '';

function saveProfileName(val){
  _profileName = val.trim();
  localStorage.setItem('yume_profile_name', _profileName);
  updateGreeting();
}

function saveProfileAvatar(fileInput){
  var file = fileInput.files[0];
  if(!file) return;
  if(file.size > 2*1024*1024){ showToast('Image trop lourde (max 2 Mo)', 'warn'); return; }
  var reader = new FileReader();
  reader.onload = function(e){
    _profileAvatar = e.target.result;
    localStorage.setItem('yume_profile_avatar', _profileAvatar);
    renderProfileAvatar();
    showToast('Photo de profil mise à jour', 'success');
  };
  reader.readAsDataURL(file);
}

function renderProfileAvatar(){
  var img  = document.getElementById('profile-avatar-img');
  var ph   = document.getElementById('profile-avatar-placeholder');
  if(_profileAvatar && img){
    img.src = _profileAvatar;
    img.style.display = 'block';
    if(ph) ph.style.display = 'none';
  } else {
    if(img) img.style.display = 'none';
    if(ph) ph.style.display = 'flex';
  }
  var inp = document.getElementById('profile-name-input');
  if(inp) inp.value = _profileName;
}

function updateGreeting(){
  var el = document.getElementById('home-greeting');
  if(!el) return;
  var hour = new Date().getHours();
  var greeting = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';
  el.textContent = _profileName
    ? greeting+' '+_profileName+' — Où allons-nous ?'
    : '';
}

// ════════════════════════════════════════════════════════════════
// EXPORT / IMPORT / RESET
// ════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════
// TAP-TO-COPY — copie d'un numéro de réservation au clic
// Usage : <span class="copyable" data-copy="JRP-2025-7741-B">…</span>
// Délégation d'événement globale → fonctionne sur tout élément .copyable,
// y compris ceux générés dynamiquement.
// ══════════════════════════════════════════════════════════════════════
function _copyText(text, anchorEl){
  function _ok(){
    if(typeof showToast==='function') showToast('Copié : '+text, 'success');
    if(anchorEl){ anchorEl.classList.add('copied'); setTimeout(function(){ anchorEl.classList.remove('copied'); }, 1200); }
  }
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(_ok).catch(function(){ _fallbackCopy(text); _ok(); });
  } else { _fallbackCopy(text); _ok(); }
}
function _fallbackCopy(text){
  try{
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
  }catch(e){}
}
if(typeof document !== 'undefined'){
  document.addEventListener('click', function(e){
    var el = e.target.closest ? e.target.closest('.copyable') : null;
    if(!el) return;
    var val = el.getAttribute('data-copy');
    if(!val) return;
    e.stopPropagation();
    _copyText(val, el);
  }, true);
}

// ══════════════════════════════════════════════════════════════════════
// INDICATEUR HORS-LIGNE — l'app fonctionne sans réseau (Service Worker).
// Affiche une pastille discrète quand la connexion tombe, pour rassurer
// l'utilisateur (les données restent disponibles en local).
// ══════════════════════════════════════════════════════════════════════
function _updateOnlineStatus(){
  var ind = document.getElementById('offline-indicator');
  if(!ind) return;
  if(navigator.onLine){ ind.classList.remove('show'); }
  else { ind.classList.add('show'); }
}
if(typeof window !== 'undefined'){
  window.addEventListener('online',  _updateOnlineStatus);
  window.addEventListener('offline', _updateOnlineStatus);
  window.addEventListener('load', _updateOnlineStatus);
}


// Génère un document propre dans un conteneur dédié puis ouvre la boîte
// d'impression du navigateur (« Enregistrer en PDF »). 100% hors-ligne,
// sans bibliothèque externe — robuste même sans réseau.
// ══════════════════════════════════════════════════════════════════════
function exportTripPDF(){
  if(!currentTripId){ if(typeof showToast==='function') showToast('Ouvre un voyage d\'abord', 'error'); return; }
  snapshotCurrentTrip();
  var t = allTrips[currentTripId];
  if(!t){ return; }
  var m = t.meta || {};

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

  var MOIS = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
  function fmtD(d){ if(!d) return ''; var o=parseDDMMYYYY(d); return o ? o.getDate()+' '+MOIS[o.getMonth()]+' '+o.getFullYear() : esc(d); }

  var TLAB = (typeof MOB_LABELS!=='undefined') ? MOB_LABELS
           : {vol:'Vol',train:'Train',bus:'Bus',bateau:'Bateau',covoiturage:'Covoiturage',metro:'Métro',taxi:'Taxi',pass:'Pass'};

  function sectionBlock(title, rowsHTML){
    if(!rowsHTML) return '';
    return '<section class="pdf-sec"><h2>'+esc(title)+'</h2>'+rowsHTML+'</section>';
  }

  var mob = (t.mobilites||[]);
  var pass = (t.passes||[]);
  var transHTML = '';
  pass.forEach(function(p){
    transHTML += '<div class="pdf-row"><div class="pdf-row-main">'
      + '<b>'+esc(p.nom||'Pass')+'</b>'
      + (p.numero?'<span class="pdf-ref">N\u00b0 '+esc(p.numero)+'</span>':'')
      + '</div><div class="pdf-row-sub">'
      + [p.debut?fmtD(p.debut):'', p.fin?('\u2192 '+fmtD(p.fin)):'', p.prix?(esc(p.prix)+' \u20ac'):'', p.zone?esc(p.zone):'']
          .filter(Boolean).join(' \u00b7 ')
      + '</div></div>';
  });
  mob.slice().sort(function(a,b){
    var da=parseDDMMYYYY(a.date), db=parseDDMMYYYY(b.date);
    if(da&&db) return da-db; if(da) return -1; if(db) return 1; return 0;
  }).forEach(function(x){
    var label = TLAB[x.type]||'Trajet';
    var details = [];
    if(x.compagnie) details.push(esc(x.compagnie));
    if(x.numero)    details.push(esc(x.numero));
    if(x.siege)     details.push('Si\u00e8ge '+esc(x.siege));
    if(x.voiture)   details.push('Voiture '+esc(x.voiture));
    if(x.terminal)  details.push('Term. '+esc(x.terminal));
    if(x.porte)     details.push('Porte '+esc(x.porte));
    if(x.resa)      details.push('R\u00e9f. '+esc(x.resa));
    var heures = [x.heureDep, x.heureArr].filter(Boolean).join(' \u2192 ');
    transHTML += '<div class="pdf-row"><div class="pdf-row-main">'
      + '<span class="pdf-tag">'+esc(label)+'</span> <b>'+esc(x.dep||'')+' \u2192 '+esc(x.arr||'')+'</b>'
      + (x.statut?'<span class="pdf-ref">'+esc(x.statut)+'</span>':'')
      + '</div><div class="pdf-row-sub">'
      + [x.date?fmtD(x.date):'', heures].filter(Boolean).join(' \u00b7 ')
      + (details.length?('<br>'+details.join(' \u00b7 ')):'')
      + '</div></div>';
  });

  var hotelHTML = '';
  (t.hotels||[]).slice().sort(function(a,b){
    var da=parseDDMMYYYY(a.checkin), db=parseDDMMYYYY(b.checkin);
    if(da&&db) return da-db; return 0;
  }).forEach(function(h){
    var nights = (typeof _hotelNights==='function') ? _hotelNights(h) : (h.nuits||'');
    hotelHTML += '<div class="pdf-row"><div class="pdf-row-main">'
      + '<b>'+esc(h.nom||'H\u00e9bergement')+'</b>'
      + (h.resa?'<span class="pdf-ref">R\u00e9f. '+esc(h.resa)+'</span>':'')
      + '</div><div class="pdf-row-sub">'
      + [h.checkin?fmtD(h.checkin):'', h.checkout?('\u2192 '+fmtD(h.checkout)):'', nights?(nights+' nuit'+(nights>1?'s':'')):'', h.ville?esc(h.ville):'']
          .filter(Boolean).join(' \u00b7 ')
      + (h.fullAddress||h.adresse?('<br>'+esc(h.fullAddress||h.adresse)):'')
      + '</div></div>';
  });

  var locHTML = '';
  (t.locations||[]).forEach(function(l){
    locHTML += '<div class="pdf-row"><div class="pdf-row-main">'
      + '<b>'+esc(l.modele||l.nom||'Location')+'</b>'
      + (l.numero||l.resa?'<span class="pdf-ref">'+esc(l.numero||l.resa)+'</span>':'')
      + '</div><div class="pdf-row-sub">'
      + [(l.loueur?esc(l.loueur):''), (l.statut?esc(l.statut):'')].filter(Boolean).join(' \u00b7 ')
      + (l.note?('<br>'+esc(l.note)):'')
      + '</div></div>';
  });

  var lieuxHTML = '';
  (t.lieux||[]).forEach(function(l){
    lieuxHTML += '<div class="pdf-row"><div class="pdf-row-main">'
      + '<b>'+esc(l.nom||'Lieu')+'</b>'
      + (l.jour?'<span class="pdf-ref">'+fmtD(l.jour.split('-').reverse().join('/'))+'</span>':'')
      + '</div><div class="pdf-row-sub">'
      + [l.ville?esc(l.ville):'', l.categorie?esc(l.categorie):''].filter(Boolean).join(' \u00b7 ')
      + (l.fullAddress||l.adresse?('<br>'+esc(l.fullAddress||l.adresse)):'')
      + (l.note?('<br><i>'+esc(l.note)+'</i>'):'')
      + '</div></div>';
  });

  var dates = (m.dateDep||m.dateRet) ? (fmtD(m.dateDep)+(m.dateRet?(' \u2014 '+fmtD(m.dateRet)):'')) : '';
  var subline = [m.country, (m.type==='VA'||m.type==='A')?'Voyage d\'affaires':'Voyage'].filter(Boolean).join(' \u00b7 ');

  var docHTML =
    '<div class="pdf-head">'
      + '<div class="pdf-brand">\u5922 Yume</div>'
      + '<h1>'+esc(m.name||'Mon voyage')+'</h1>'
      + '<div class="pdf-meta">'+esc(subline)+(dates?(' \u00b7 '+dates):'')+'</div>'
    + '</div>'
    + sectionBlock('Transports & Pass', transHTML)
    + sectionBlock('H\u00e9bergements', hotelHTML)
    + sectionBlock('Locations', locHTML)
    + sectionBlock('Lieux \u00e0 visiter', lieuxHTML)
    + '<div class="pdf-foot">Document g\u00e9n\u00e9r\u00e9 par Yume</div>';

  var host = document.getElementById('pdf-print-area');
  if(!host){
    host = document.createElement('div');
    host.id = 'pdf-print-area';
    document.body.appendChild(host);
  }
  host.innerHTML = docHTML;

  document.body.classList.add('printing-pdf');
  function _after(){
    document.body.classList.remove('printing-pdf');
    window.removeEventListener('afterprint', _after);
  }
  window.addEventListener('afterprint', _after);
  setTimeout(function(){ window.print(); }, 60);
}

function exportData(){
  // Sauvegarder l'état actuel
  if(currentTripId) snapshotCurrentTrip();
  var payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    profile: { name: _profileName },
    trips: allTrips,
    pdfStore: window.pdfStore || {},
    globalDocs: (function(){ try{ return JSON.parse(localStorage.getItem('yume_global_docs')||'[]'); }catch(e){ return []; } })(),
    globalPdfs: window.globalPdfStore || {}
  };
  var json = JSON.stringify(payload, null, 2);
  var blob = new Blob([json], {type:'application/json'});
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href   = url;
  a.download = 'yume-backup-'+(new Date().toISOString().slice(0,10))+'.json';
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 5000);
  showToast('Sauvegarde téléchargée ', 'success');
}

function importData(fileInput){
  var file = fileInput.files[0];
  if(!file) return;
  if(!file.name.endsWith('.json')){
    showToast('Format invalide — choisissez un fichier .json', 'error');
    return;
  }
  var reader = new FileReader();
  reader.onload = function(e){
    try{
      var data = JSON.parse(e.target.result);
      // Validation basique
      if(!data.trips || typeof data.trips !== 'object'){
        throw new Error('Structure invalide');
      }
      if(!confirm('Importer cette sauvegarde ? Les données actuelles seront remplacées.')){
        fileInput.value = ''; return;
      }
      allTrips = data.trips;
      // ── Migration : garantir la présence de tous les arrays + adresses
      //    structurées (factorisé dans _migrateAllTrips). ──
      if(typeof _migrateAllTrips === 'function') _migrateAllTrips();
      if(data.pdfStore){ window.pdfStore = data.pdfStore; if(typeof savePdfStore === 'function') savePdfStore(); }
      if(data.globalDocs){ try{ localStorage.setItem('yume_global_docs', JSON.stringify(data.globalDocs)); }catch(e){} }
      if(data.globalPdfs){ window.globalPdfStore = data.globalPdfs; try{ localStorage.setItem('yume_global_pdfs', JSON.stringify(data.globalPdfs)); }catch(e){} }
      if(data.profile && data.profile.name){
        _profileName = data.profile.name;
        localStorage.setItem('yume_profile_name', _profileName);
      }
      saveAllTrips();
      currentTripId = null;
      // ── Phase B Fix : notifier les cartes immédiatement après import ──
      // Sans cet emit, les cartes ne se rafraîchissent qu'à l'ouverture
      // manuelle d'un voyage. Avec lui, map-world et map-trip se
      // reconstituent dès que les données sont en mémoire.
      if (typeof YumeState !== 'undefined') {
        YumeState.emit('map:refresh', { source: 'import' });
      }
      showHomeScreen();
      updateStatsBar();
      updateGreeting();
      showToast('Sauvegarde importée avec succès ', 'success');
    } catch(err){
      showToast('Fichier invalide ou corrompu', 'error');
    }
    fileInput.value = '';
  };
  reader.readAsText(file);
}

function resetApp(){
  if(!confirm('Réinitialiser Yume ?\n\nTous tes voyages, vols, trains et données seront définitivement supprimés.\n\nCette action est irréversible.')){
    return;
  }
  // Double confirmation pour une action aussi destructive
  if(!confirm('Dernière confirmation : supprimer TOUTES les données ?')) return;
  // Vider localStorage
  var keys = [];
  for(var i=0;i<localStorage.length;i++) keys.push(localStorage.key(i));
  keys.forEach(function(k){
    if(k.startsWith('mv_') || k === 'yume_theme' || k === 'yume_profile_name' || k === 'yume_profile_avatar' || k === 'yume_pdfstore'){
      localStorage.removeItem(k);
    }
  });
  // Vider les variables
  allTrips       = {};
  currentTripId  = null;
  window.pdfStore = {};
  _currentTheme  = 'standard';
  _profileName   = '';
  _profileAvatar = '';
  // Réappliquer thème standard
  document.documentElement.setAttribute('data-theme', 'standard');
  // Reset UI
  showHomeScreen();
  updateStatsBar();
  updateGreeting();
  closeSettings();
  showToast('Application réinitialisée', 'info');
}

// ════════════════════════════════════════════════════════════════
// THÈME AUTO (suit le système)
// ════════════════════════════════════════════════════════════════
var _autoTheme = localStorage.getItem('yume_auto_theme') === '1';

function toggleAutoTheme(enabled){
  _autoTheme = enabled;
  localStorage.setItem('yume_auto_theme', enabled ? '1' : '0');
  var grid = document.getElementById('theme-grid-manual');
  if(grid) grid.style.opacity = enabled ? '.4' : '1';
  if(grid) grid.style.pointerEvents = enabled ? 'none' : '';
  if(enabled){
    applyAutoTheme();
    showToast('Thème automatique activé', 'info');
  } else {
    showToast('Thème manuel', 'info');
  }
}

function applyAutoTheme(){
  if(!_autoTheme) return;
  var isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var isGreen = (_currentTheme === 'vert' || _currentTheme === 'vert-dark');
  if(isGreen){ applyTheme(isDark ? 'vert-dark' : 'vert'); }
  else       { applyTheme(isDark ? 'dark' : 'standard'); }
}

// Écouter les changements de thème système
if(window.matchMedia){
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(){
    if(_autoTheme) applyAutoTheme();
  });
}

// ════════════════════════════════════════════════════════════════
// PATCH openSettings — logique profil + rappels intégrée dans openSettings()
// ════════════════════════════════════════════════════════════════

// Initialisation au chargement
(function initProfile(){
  _profileName   = localStorage.getItem('yume_profile_name')   || '';
  _profileAvatar = localStorage.getItem('yume_profile_avatar') || '';
  _autoTheme     = localStorage.getItem('yume_auto_theme') === '1';
  updateGreeting();
  if(_autoTheme) applyAutoTheme();
  setTimeout(renderProfileAvatar, 50);
})();


// ════════════════════════════════════════════════════════════════
// DONUT CHART — répartition dépenses par catégorie
// ════════════════════════════════════════════════════════════════
var DONUT_COLORS = [
  '#4CAF50','#B08D3E','#F08080','#5C6BC0','#9575CD',
  '#FF7043','#78909C','#26A69A','#EF5350','#42A5F5'
];

// Résout la couleur d'une catégorie : catColors en priorité, sinon DONUT_COLORS positionnel

function renderDonutChart(catTotals, total){
  var wrap = document.getElementById('donut-chart-wrap');
  if(!wrap) return;

  var entries = Object.entries(catTotals).sort(function(a,b){return b[1]-a[1];});
  if(!entries.length){
    wrap.style.display = 'none'; return;
  }
  wrap.style.display = 'flex';

  // ── SVG donut ──
  var R = 40, cx = 55, cy = 55, stroke = 14;
  var circumference = 2 * Math.PI * R;
  var offset = 0;
  var segments = entries.map(function(e,i){
    var color = _catColor(e[0]);   // couleur coordonnée (même que barres/points)
    var pct = e[1] / total;
    var arc = pct * circumference;
    var seg = '<circle cx="'+cx+'" cy="'+cy+'" r="'+R+'"'
      +' fill="none" stroke="'+color+'"'
      +' stroke-width="'+stroke+'"'
      +' stroke-dasharray="'+arc.toFixed(2)+' '+(circumference-arc).toFixed(2)+'"'
      +' stroke-dashoffset="'+(-offset).toFixed(2)+'">'
      +'<title>'+_catClean(e[0])+' — '+Math.round(pct*100)+'%</title>'
      +'</circle>';
    offset += arc;
    return {seg:seg, name:_catClean(e[0]), pct:Math.round(pct*100), color:color};
  });

  var svgInner = segments.map(function(s){return s.seg;}).join('');
  var totalFmt = total.toLocaleString('fr-FR',{minimumFractionDigits:2});

  var legend = segments.slice(0,5).map(function(s){
    return '<div class="donut-leg-item">'
      +'<div class="donut-leg-dot" style="background:'+s.color+'"></div>'
      +'<span class="donut-leg-name">'+s.name+'</span>'
      +'<span class="donut-leg-pct">'+s.pct+'%</span>'
    +'</div>';
  }).join('');

  wrap.innerHTML =
    '<div class="donut-svg-wrap">'
    +'<svg class="donut-svg" viewBox="0 0 110 110" xmlns="http://www.w3.org/2000/svg">'
    +'<circle cx="'+cx+'" cy="'+cy+'" r="'+R+'" fill="none" stroke="var(--surface-3)" stroke-width="'+stroke+'"/>'
    +svgInner
    +'</svg>'
    +'<div class="donut-center">'
    +'<span class="donut-center-amt">'+totalFmt+'€</span>'
    +'<span class="donut-center-lbl">dépensé</span>'
    +'</div>'
    +'</div>'
    +'<div class="donut-legend">'+legend+'</div>';
}

// ════════════════════════════════════════════════════════════════
// HORS-LIGNE — indicateur réseau
// ════════════════════════════════════════════════════════════════
function updateOfflineBadge(){
  var badge = document.getElementById('offline-badge');
  var lbl   = document.getElementById('ob-label');
  if(!badge || !lbl) return;
  var online = navigator.onLine;
  badge.classList.toggle('is-offline', !online);
  lbl.textContent = online ? 'Local ✓' : 'Hors-ligne';
  badge.title = online
    ? 'Données sauvegardées localement — connexion active'
    : 'Hors-ligne — données accessibles localement';
}
if (typeof window.addEventListener === 'function') {
  window.addEventListener('online',  updateOfflineBadge);
  window.addEventListener('offline', updateOfflineBadge);
}
setTimeout(updateOfflineBadge, 200);

// ════════════════════════════════════════════════════════════════
// RAPPELS DE VOYAGE — système de toasts programmés
// ════════════════════════════════════════════════════════════════
var _reminders = {
  vol:   localStorage.getItem('yume_reminder_vol')   !== '0',
  hotel: localStorage.getItem('yume_reminder_hotel') !== '0'
};

function toggleReminder(type, enabled){
  _reminders[type] = enabled;
  localStorage.setItem('yume_reminder_'+type, enabled ? '1' : '0');
  showToast(
    (enabled ? 'Rappels actifs ' : 'Rappels désactivés ')
    +(type==='vol'?'vols':'hôtels')
    +(enabled?' activés':' désactivés'), 'info', 2500
  );
}

function checkReminders(){
  if(!currentTripId || !allTrips[currentTripId]) return;
  var today = new Date();
  today.setHours(0,0,0,0);
  var tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate()+1);

  if(_reminders.vol && vols && vols.length){
    vols.forEach(function(v){
      if(!v.dateDep) return;
      var d = parseDDMMYYYY(v.dateDep);
      if(!d) return;
      d.setHours(0,0,0,0);
      var diff = Math.round((d-today)/(1000*86400));
      if(diff === 1){
        showToast('Rappel — Vol '+(v.titre||v.code||'')+' part demain !', 'warn', 6000);
      } else if(diff === 0){
        showToast('Aujourd\'hui — Vol '+(v.titre||v.code||'')+' · Bon voyage !', 'success', 6000);
      }
    });
  }
  if(_reminders.hotel && hotels && hotels.length){
    hotels.forEach(function(ht){
      if(!ht.ci) return;
      var d = parseDDMMYYYY(ht.ci);
      if(!d) return;
      d.setHours(0,0,0,0);
      var diff = Math.round((d-today)/(1000*86400));
      if(diff === 0){
        showToast('Check-in aujourd\hui — '+(ht.nom||ht.ville||'')
          +' · Bon séjour !', 'info', 5000);
      }
    });
  }
}

// ════════════════════════════════════════════════════════════════
// PULSATION bouton "Créer un voyage" si liste vide
// ════════════════════════════════════════════════════════════════
function updatePulseBtnHint(){
  var btn = document.querySelector('.btn-new-trip');
  if(!btn) return;
  var hasTrips = Object.keys(allTrips||{}).length > 0;
  btn.classList.toggle('pulse-hint', !hasTrips);
}

// ════════════════════════════════════════════════════════════════
// PLURAL micro-stats home (logique intégrée dans updateStatsBar ci-dessous)

// ════════════════════════════════════════════════════════════════
// PATCH showTab — météo + donut : logique intégrée directement dans showTab
// (voir définition de showTab plus bas)
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
// PATCH showAppScreen — météo + rappels + donut init
// ════════════════════════════════════════════════════════════════
var _origShowAppScreen2 = showAppScreen;
showAppScreen = function(){
  _origShowAppScreen2();
  setTimeout(function(){
    checkReminders();
    updateOfflineBadge();
    updatePulseBtnHint();
    // Init donut wrap si onglet budget actif
    var catEl = document.getElementById('cat-breakdown');
    if(catEl && !document.getElementById('donut-chart-wrap')){
      var dw = document.createElement('div');
      dw.className = 'donut-wrap';
      dw.id = 'donut-chart-wrap';
      dw.style.display = 'none';
      catEl.parentNode.insertBefore(dw, catEl);
    }
  }, 300);
};

// ════════════════════════════════════════════════════════════════
// PARAMÈTRES & THÈMES
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
// PARAMÈTRES & THÈMES — système snapshot / preview / commit
// ════════════════════════════════════════════════════════════════

var _currentTheme = localStorage.getItem('yume_theme') || 'standard';

// ── Correspondance thème → image automatique ──
var THEME_BG_MAP = {
  standard: './japon.jpg',
  nature:   './nature.png',
  mer:      './mer.png',
  nuit:     './nuit.png'
};

// ── Overlay hints de lisibilité par image ──
var BG_OVERLAY = {
  './japon.jpg':  ['rgba(10,5,2,.5) 0%,rgba(10,5,2,.68) 55%,rgba(10,5,2,.85) 100%'],
  './nature.png': ['rgba(4,14,4,.42) 0%,rgba(4,14,4,.60) 55%,rgba(4,14,4,.80) 100%'],
  './mer.png':    ['rgba(2,8,18,.44) 0%,rgba(2,8,18,.62) 55%,rgba(2,8,18,.82) 100%'],
  './nuit.png':   ['rgba(2,2,10,.38) 0%,rgba(2,2,10,.55) 55%,rgba(2,2,10,.78) 100%']
};

// ── État validé (ce qui est réellement appliqué & sauvegardé) ──
var _state = {
  theme:      localStorage.getItem('yume_theme')          || 'standard',
  bgMode:     localStorage.getItem('yume_bg_mode')         || 'auto',
  bgImg:      localStorage.getItem('yume_bg_manual')       || './japon.jpg',
  brightness: parseFloat(localStorage.getItem('yume_bg_brightness') || '1'),
  blur:       parseFloat(localStorage.getItem('yume_bg_blur')       || '0')
};

// Alias pour compatibilité avec le reste du code
var _bgMode    = _state.bgMode;
var _bgManual  = _state.bgImg;

// ── Snapshot temporaire pendant l'édition des paramètres ──
var _draft = null;

// ── Capture un snapshot de l'état validé ──
function _snapshotState(){
  return {
    theme:      _state.theme,
    bgMode:     _state.bgMode,
    bgImg:      _state.bgImg,
    brightness: _state.brightness,
    blur:       _state.blur
  };
}

// ─────────────────────────────────────────
// Rendu du fond à partir d'un objet état
// ─────────────────────────────────────────
function _renderBackground(s){
  var theme      = s.theme;
  var bgMode     = s.bgMode;
  var bgImg      = s.bgImg;
  var brightness = (typeof s.brightness === 'number') ? s.brightness : 1;
  var blur       = (typeof s.blur       === 'number') ? s.blur       : 0;

  var img = null;
  if(bgMode !== 'none'){
    img = (bgMode === 'manual') ? bgImg : (THEME_BG_MAP[theme] || './japon.jpg');
  }

  var homeBg = document.getElementById('home-bg');
  var appBg  = document.getElementById('app-bg');
  var body   = document.body;

  ['standard','nature','mer','nuit'].forEach(function(t){ body.classList.remove('bg-color-'+t); });
  body.classList.add('bg-color-'+theme);

  // Construire le filtre CSS à partir des réglages utilisateur
  // brightness(1) = normal, brightness(0.2) = très sombre
  var filterVal = 'brightness('+brightness+')' + (blur > 0 ? ' blur('+blur+'px)' : '');

  if(img){
    body.classList.add('has-bg-image');
    var url = "url('"+img+"')";
    if(homeBg){
      homeBg.style.backgroundImage = url;
      homeBg.style.filter = filterVal;
      homeBg.classList.remove('no-image');
    }
    if(appBg){
      appBg.style.backgroundImage = url;
      appBg.style.filter = filterVal;
      appBg.classList.add('visible');
    }
  } else {
    body.classList.remove('has-bg-image');
    if(homeBg){ homeBg.style.backgroundImage='none'; homeBg.style.filter='none'; homeBg.classList.add('no-image'); }
    if(appBg){ appBg.style.backgroundImage='none'; appBg.style.filter='none'; appBg.classList.remove('visible'); }
  }
}

// ─────────────────────────────────────────
// Applique uniquement le thème CSS (data-theme)
// ─────────────────────────────────────────
function _renderTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('.theme-card').forEach(function(card){
    card.classList.toggle('active', card.getAttribute('data-theme') === theme);
  });
  document.querySelectorAll('.nav-item.active').forEach(function(el){ el.style.color = ''; });
}

// ─────────────────────────────────────────
// _applyBackground — wrapper sur l'état validé (appelé au chargement)
// ─────────────────────────────────────────
function _applyBackground(){
  _bgMode    = _state.bgMode;
  _bgManual  = _state.bgImg;
  _bgOpacity = _state.opacity;
  _bgBlur    = _state.blur;
  _currentTheme = _state.theme;
  _renderTheme(_state.theme);
  _renderBackground(_state);
}

// ─────────────────────────────────────────
// OUVERTURE des paramètres — prendre un snapshot + charger l'état UI
// ─────────────────────────────────────────
function openSettings(){
  _draft = _snapshotState();
  document.getElementById('settings-overlay').classList.add('open');
  _renderTheme(_draft.theme);
  _refreshBgUI(_draft);
  // Profil
  renderProfileAvatar();
  var toggle = document.getElementById('auto-theme-toggle');
  if(toggle){ toggle.checked = _autoTheme; }
  var grid = document.getElementById('theme-grid-manual');
  if(grid){ grid.style.opacity = _autoTheme ? '.4' : '1'; grid.style.pointerEvents = _autoTheme ? 'none' : ''; }
  // Rappels
  var rvt = document.getElementById('reminder-vol-toggle');
  var rht = document.getElementById('reminder-hotel-toggle');
  if(rvt) rvt.checked = _reminders.vol;
  if(rht) rht.checked = _reminders.hotel;
}

// ─────────────────────────────────────────
// VALIDER — écrire l'état draft dans _state + localStorage
// ─────────────────────────────────────────
function validateSettings(){
  _state = {
    theme:      _draft.theme,
    bgMode:     _draft.bgMode,
    bgImg:      _draft.bgImg,
    brightness: _draft.brightness,
    blur:       _draft.blur
  };
  // Sync aliases
  _currentTheme = _state.theme;
  _bgMode       = _state.bgMode;
  _bgManual     = _state.bgImg;
  // Persister
  localStorage.setItem('yume_theme',          _state.theme);
  localStorage.setItem('yume_bg_mode',        _state.bgMode);
  localStorage.setItem('yume_bg_manual',      _state.bgImg);
  localStorage.setItem('yume_bg_brightness',  _state.brightness);
  localStorage.setItem('yume_bg_blur',        _state.blur);
  // Appliquer
  _renderTheme(_state.theme);
  _renderBackground(_state);
  _draft = null;
  document.getElementById('settings-overlay').classList.remove('open');
  showToast('Paramètres sauvegardés ', 'success');
}

// ─────────────────────────────────────────
// ANNULER — remettre l'état validé
// ─────────────────────────────────────────
function cancelSettings(){
  if(_draft){
    _renderTheme(_state.theme);
    _renderBackground(_state);
    _draft = null;
  }
  document.getElementById('settings-overlay').classList.remove('open');
}

function closeSettings(){ cancelSettings(); }
function closeSettingsOnBg(e){
  if(e.target === document.getElementById('settings-overlay')) cancelSettings();
}

// ─────────────────────────────────────────
// Interactions dans le panneau — modifient le DRAFT seulement
// ─────────────────────────────────────────
function applyTheme(theme){
  if(_draft){
    // Panneau ouvert : modifier le draft seulement
    _draft.theme = theme;
    _renderTheme(theme);
    _renderBackground(_draft);
    _refreshBgUI(_draft);
  } else {
    // Appel direct (ex: applyAutoTheme) : commit immédiat
    _state.theme = theme;
    _currentTheme = theme;
    localStorage.setItem('yume_theme', theme);
    _renderTheme(theme);
    _renderBackground(_state);
  }
}

function setBgMode(mode){
  if(!_draft) return;
  _draft.bgMode = mode;
  _renderBackground(_draft);
  _refreshBgUI(_draft);
}

function setBgManual(img){
  if(!_draft) return;
  _draft.bgImg = img;
  _renderBackground(_draft);
  _refreshBgUI(_draft);
}

function onBgBrightnessInput(val){
  if(!_draft) return;
  _draft.brightness = val / 100;
  var lbl = document.getElementById('bg-brightness-val');
  if(lbl) lbl.textContent = val + '%';
  // Appliquer en temps réel sur les deux éléments de fond
  var filterVal = 'brightness('+_draft.brightness+')'+((_draft.blur||0)>0?' blur('+_draft.blur+'px)':'');
  var homeBg = document.getElementById('home-bg');
  var appBg  = document.getElementById('app-bg');
  if(homeBg) homeBg.style.filter = filterVal;
  if(appBg)  appBg.style.filter  = filterVal;
}

function onBgBlurInput(val){
  if(!_draft) return;
  _draft.blur = parseFloat(val);
  var lbl = document.getElementById('bg-blur-val');
  if(lbl) lbl.textContent = val + 'px';
  // Appliquer en temps réel
  var brightness = (typeof _draft.brightness === 'number') ? _draft.brightness : 1;
  var filterVal = 'brightness('+brightness+')'+(parseFloat(val)>0?' blur('+val+'px)':'');
  var homeBg = document.getElementById('home-bg');
  var appBg  = document.getElementById('app-bg');
  if(homeBg) homeBg.style.filter = filterVal;
  if(appBg)  appBg.style.filter  = filterVal;
}

// Legacy no-ops

// ─────────────────────────────────────────
// Rafraîchir l'UI du panneau depuis un état
// ─────────────────────────────────────────
function _refreshBgUI(s){
  s = s || _state;
  // Mode buttons
  ['auto','manual','none'].forEach(function(m){
    var btn = document.getElementById('bg-mode-'+m);
    if(btn) btn.classList.toggle('active', s.bgMode===m);
  });
  // Hint text
  var hints = {
    auto:   'Auto : le fond correspond au thème sélectionné',
    manual: 'Manuel : choisir une image indépendamment du thème',
    none:   'Couleur : fond uni, sans image de fond'
  };
  var hint = document.getElementById('bg-mode-hint');
  if(hint) hint.textContent = hints[s.bgMode] || '';
  // Grid images
  var grid = document.getElementById('bg-image-grid');
  if(grid) grid.classList.toggle('visible', s.bgMode==='manual');
  // Active card
  document.querySelectorAll('.bg-img-card').forEach(function(c){
    c.classList.toggle('active', s.bgMode==='manual' && c.getAttribute('data-img')===s.bgImg);
  });
  // Curseur luminosité
  var bPct   = Math.round((typeof s.brightness === 'number' ? s.brightness : 1) * 100);
  var bRange = document.getElementById('bg-brightness-range');
  var bLabel = document.getElementById('bg-brightness-val');
  if(bRange){ bRange.value = bPct; }
  if(bLabel){ bLabel.textContent = bPct + '%'; }
  // Curseur flou
  var blurVal   = typeof s.blur === 'number' ? s.blur : 0;
  var blurRange = document.getElementById('bg-blur-range');
  var blurLabel = document.getElementById('bg-blur-val');
  if(blurRange){ blurRange.value = blurVal; }
  if(blurLabel){ blurLabel.textContent = blurVal + 'px'; }
  // Afficher/masquer les curseurs selon mode
  var sw = document.getElementById('bg-sliders-wrap');
  if(sw) sw.style.display = (s.bgMode === 'none') ? 'none' : '';
}

// ─────────────────────────────────────────
// Init au chargement
// ─────────────────────────────────────────
(function(){
  _state.theme      = localStorage.getItem('yume_theme')          || 'standard';
  _state.bgMode     = localStorage.getItem('yume_bg_mode')         || 'auto';
  _state.bgImg      = localStorage.getItem('yume_bg_manual')       || './japon.jpg';
  _state.brightness = parseFloat(localStorage.getItem('yume_bg_brightness') || '1');
  _state.blur       = parseFloat(localStorage.getItem('yume_bg_blur')       || '0');
  _currentTheme = _state.theme;
  document.documentElement.setAttribute('data-theme', _currentTheme);
  setTimeout(function(){ _applyBackground(); }, 0);
})();

// ════════════════════════════════════════════════════════════════
// TRANSITIONS SLIDE entre onglets
// ════════════════════════════════════════════════════════════════

// Ordre des onglets pour déterminer la direction
// ════════════════════════════════════════════════════════════════
// TRANSITIONS SLIDE — belt scroll (toutes les sections côte à côte)
// Le "belt" translate en X pour révéler la section voulue.
// ════════════════════════════════════════════════════════════════

var TAB_ORDER = ['vols','trains','hotels','lieux','budget','convertir'];
var _currentTabIndex = 0;
var _beltTransitioning = false;

// Initialise le belt au chargement
(function initBelt(){
  // On attend que le DOM soit prêt
  function _init(){
    var belt = document.getElementById('tab-belt');
    if(!belt) return;
    // Placer le belt sur la section active initiale
    var activeIdx = TAB_ORDER.indexOf('vols');
    belt.style.transition = 'none';
    belt.style.transform  = 'translate3d(-' + (activeIdx * 100) + '%,0,0)';
    _currentTabIndex = activeIdx;
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }
})();

// ══ CODE ORIGINAL (logique métier) ══
// ══════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════
// Variables Leaflet — déclarées ici pour être globales
// (initialisées dans le second bloc <script> Leaflet)
// [migrated to module — see header]

// [migrated to module — see header]


var _uid=0;
function uid(){return ++_uid;}
function showTab(id,btn){
  var newIdx = TAB_ORDER.indexOf(id);
  var belt   = document.getElementById('tab-belt');

  // Mise à jour nav
  document.querySelectorAll('.nav-item').forEach(function(b){ b.classList.remove('active'); });
  if(btn) btn.classList.add('active');

  // Classe active pour compatibilité JS (renderVols etc. testent .active)
  document.querySelectorAll('.section').forEach(function(s){ s.classList.remove('active'); });
  var sec = document.getElementById('tab-'+id);
  if(sec) sec.classList.add('active');

  // Animation belt
  if(belt && newIdx !== -1){
    if(!(_beltTransitioning && newIdx === _currentTabIndex)){
      _beltTransitioning = true;
      belt.style.transform = 'translate3d(-'+(newIdx*100)+'%,0,0)';
      var onEnd = function(){
        belt.removeEventListener('transitionend', onEnd);
        _beltTransitioning = false;
      };
      belt.addEventListener('transitionend', onEnd);
      setTimeout(function(){ _beltTransitioning = false; }, 500);
      _currentTabIndex = newIdx;
    }
  }

  // Callbacks
  if(id==='convertir'){ applyRateForCurrentTrip(); updateRateDisplay(); if(!rateLoaded) fetchRate(); }
  if(id==='budget'){
    setTimeout(function(){
      if(typeof updateBudgetDeviseSelect==='function') updateBudgetDeviseSelect();
      var catEl = document.getElementById('cat-breakdown');
      if(catEl && !document.getElementById('donut-chart-wrap')){
        var dw = document.createElement('div');
        dw.className='donut-wrap'; dw.id='donut-chart-wrap'; dw.style.display='none';
        catEl.parentNode.insertBefore(dw, catEl);
      }
      if(typeof updateBudget==='function') updateBudget();
    }, 50);
  }
}
// ─────────────────────────────────────────────────────────────
// MODAL FORMULAIRES — overlay universel
// ─────────────────────────────────────────────────────────────
var _currentOpenForm = null;

function _openFormAsModal(formId){
  var form = document.getElementById(formId);
  if(!form) return;
  var overlay = document.getElementById('form-modal-overlay');
  if(!overlay) return;

  // Fermer tout formulaire déjà ouvert
  if(_currentOpenForm && _currentOpenForm !== formId){
    _closeFormModal(_currentOpenForm, true);
  }

  // ── Reset défensif : si le form était déjà dans l'overlay (ex: Annuler rapide),
  //    on force le reset pour garantir un formulaire vierge en mode ajout.
  //    Les éditions (editHotel/editLieu) passent par openModal(), jamais ici.
  if(formId === 'form-hotel' && typeof _resetFormFields === 'function') _resetFormFields('hotel');
  if(formId === 'form-lieu'  && typeof _resetFormFields === 'function') _resetFormFields('lieu');

  // Sauvegarder position originale via ancre
  if(!document.getElementById('_form_anchor_' + formId)){
    var anchor = document.createElement('div');
    anchor.id = '_form_anchor_' + formId;
    anchor.style.display = 'none';
    if(form.parentNode) form.parentNode.insertBefore(anchor, form);
  }

  // Déplacer le formulaire dans l'overlay
  overlay.appendChild(form);
  form.classList.add('open');
  overlay.classList.add('open');
  _currentOpenForm = formId;

  // Injecter le bouton ✕ si pas déjà présent
  if(!form.querySelector('.form-modal-close')){
    var closeBtn = document.createElement('button');
    closeBtn.className = 'form-modal-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Fermer');
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.onclick = function(e){ e.stopPropagation(); toggleForm(formId); };
    form.insertBefore(closeBtn, form.firstChild);
    // Padding-right sur le titre pour ne pas le cacher
    var title = form.querySelector('.add-form-title');
    if(title) title.style.paddingRight = '36px';
  }

  // Bloquer le scroll
  document.body.style.overflow = 'hidden';

  // Fermeture Escape
  document._formEscHandler = function(e){
    if(e.key === 'Escape' && _currentOpenForm) toggleForm(_currentOpenForm);
  };
  document.addEventListener('keydown', document._formEscHandler);

  // Focus sur le premier champ texte
  setTimeout(function(){
    var first = form.querySelector('input[type="text"],input[type="number"],textarea');
    if(first) first.focus();
  }, 80);
}

function _closeFormModal(formId, restoreAnchor){
  var form = document.getElementById(formId);
  if(!form) return;
  var overlay = document.getElementById('form-modal-overlay');

  form.classList.remove('open');

  // Remettre le formulaire à son emplacement d'origine
  var anchor = document.getElementById('_form_anchor_' + formId);
  if(anchor && restoreAnchor !== false){
    anchor.parentNode.insertBefore(form, anchor);
    anchor.remove();
  }

  if(overlay) overlay.classList.remove('open');
  _currentOpenForm = null;
  document.body.style.overflow = '';

  if(document._formEscHandler){
    document.removeEventListener('keydown', document._formEscHandler);
    document._formEscHandler = null;
  }
}

window.closeFormModalOnBg = function(e){
  if(e.target === document.getElementById('form-modal-overlay')){
    if(_currentOpenForm) toggleForm(_currentOpenForm);
  }
};

// ── Ajout depuis le haut de section ──────────────────────────────────
// Les formulaires d'ajout vivent en bas des listes ; ce helper les ouvre
// depuis le bouton « + Ajouter » de l'en-tête de section et y amène
// l'utilisateur — plus besoin de scroller jusqu'en bas au 15e lieu.
function openAddTop(formId){
  if(formId === 'picker'){
    // Le choix Trajet/Pass est une modale overlay : pas de scroll requis
    if(typeof showTransportPicker === 'function') showTransportPicker();
    return;
  }
  var form = document.getElementById(formId);
  if(!form) return;
  if(!form.classList.contains('open')) toggleForm(formId);
  setTimeout(function(){ form.scrollIntoView({behavior:'smooth', block:'start'}); }, 60);
}

function toggleForm(id){
  var form = document.getElementById(id);
  if(!form) return;
  var isOpening = !form.classList.contains('open');

  // Map form-id → empty-state management
  var sectionMap = {
    'form-vol':      {listId:'vols-list',     getData:function(){return typeof vols!=='undefined'?vols:[];}},
    'form-train':    {listId:'trains-list',   getData:function(){return typeof trains!=='undefined'?trains:[];}},
    'form-hotel':    {listId:'hotels-list',   getData:function(){return typeof hotels!=='undefined'?hotels:[];}},
    'form-lieu':     {listId:'places-grid',   getData:function(){return typeof lieux!=='undefined'?lieux:[];}},
    'form-mobilite': {listId:'mobilite-list', getData:function(){return typeof mobilites!=='undefined'?mobilites:[];}},
    'form-location': {listId:'locations-list',getData:function(){return typeof locations!=='undefined'?locations:[];}}
  };

  // Liste des formulaires qui passent en MODAL (les autres restent inline)
  var MODAL_FORMS = ['form-mobilite','form-location','form-hotel','form-lieu','form-vol','form-train','form-tx','form-doc'];

  if(isOpening){
    if(MODAL_FORMS.indexOf(id) !== -1){
      _openFormAsModal(id);
    } else {
      form.classList.add('open');
    }
    // Pré-remplir le pays depuis le voyage actif + peupler datalists
    // Le reset est TOUJOURS fait à l'ouverture (mode ajout uniquement —
    // les éditions passent par openModal/editHotel/editLieu, jamais ici)
    if(id === 'form-hotel'){
      _resetFormFields('hotel');
      if(typeof _populatePaysDatalists === 'function') _populatePaysDatalists();
      setTimeout(function(){ if(typeof _prefillPaysFromTrip === 'function') _prefillPaysFromTrip('ht-pays'); }, 60);
      // Pré-calculer les nuits depuis les dates du voyage actif
      setTimeout(function(){
        if(!currentTripId || !allTrips[currentTripId]) return;
        var meta = allTrips[currentTripId].meta || {};
        if(meta.dateDep && meta.dateRet){
          var dep = parseDDMMYYYY(meta.dateDep);
          var ret = parseDDMMYYYY(meta.dateRet);
          if(dep && ret){
            var diff = Math.round((ret - dep) / 86400000);
            if(diff > 0){
              var nEl = document.getElementById('ht-nuits');
              if(nEl && !nEl.value){ nEl.value = diff; flashAuto(nEl,'hint-ht-nuits'); }
            }
          }
        }
      }, 80);
    }
    if(id === 'form-lieu'){
      _resetFormFields('lieu');
      if(typeof _populatePaysDatalists === 'function') _populatePaysDatalists();
      setTimeout(function(){ if(typeof _prefillPaysFromTrip === 'function') _prefillPaysFromTrip('lieu-pays'); }, 60);
    }
    var info = sectionMap[id];
    if(info){
      var listEl = document.getElementById(info.listId);
      if(listEl && info.getData().length === 0) listEl.style.display = 'none';
      var pe = document.getElementById('places-empty');
      if(pe && id === 'form-lieu') pe.style.display = 'none';
    }
  } else {
    // Fermeture
    if(MODAL_FORMS.indexOf(id) !== -1){
      _closeFormModal(id, true);
    } else {
      form.classList.remove('open');
    }
    // Restaurer empty-state si toujours vide
    var info2 = sectionMap[id];
    if(info2){
      var listEl2 = document.getElementById(info2.listId);
      if(listEl2 && info2.getData().length === 0) listEl2.style.display = '';
      var pe2 = document.getElementById('places-empty');
      if(pe2 && id === 'form-lieu') pe2.style.display = '';
    }
  }
}


// ── Date helpers ──
var JOURS=[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31];
var MOIS=['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
var MOIS_SHORT=['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
// Patch toggleForm pour appeler clearAllModals() à la FERMETURE (Annuler)
(function(){
  var _origToggle = typeof window.toggleForm === 'function' ? window.toggleForm : null;
  if(!_origToggle) return;
  window.toggleForm = function(formId){
    var wasOpen = (document.getElementById(formId)||{}).classList&&document.getElementById(formId).classList.contains('open');
    _origToggle(formId);
    // Si le form était ouvert (= on le ferme), reset total
    if(wasOpen){ clearAllModals(); }
  };
})();


function buildJourSelect(id,val){
  var el=document.getElementById(id); if(!el) return;
  el.innerHTML='<option value="">Jour</option>'+JOURS.map(function(j){
    var v=j<10?'0'+j:''+j;
    return '<option value="'+v+'"'+(val&&(val===v||parseInt(val)===j)?'selected':'')+'>'+(j<10?'0'+j:j)+'</option>';
  }).join('');
}
function buildMoisSelect(id,val){
  var el=document.getElementById(id); if(!el) return;
  el.innerHTML='<option value="">Mois</option>'+MOIS.map(function(m,i){
    var short=MOIS_SHORT[i];
    return '<option value="'+short+'"'+(val&&val.toLowerCase()===short.toLowerCase()?'selected':'')+'>'+(i+1<10?'0'+(i+1):''+(i+1))+' – '+m+'</option>';
  }).join('');
}

function parseJour(str){
  if(!str) return '';
  var m=str.match(/^(\d{1,2})/);
  return m?m[1]:'';
}
function parseMois(str){
  if(!str) return '';
  for(var i=0;i<MOIS_SHORT.length;i++){
    if(str.toLowerCase().indexOf(MOIS_SHORT[i].toLowerCase())!==-1) return MOIS_SHORT[i];
  }
  return '';
}

// Init all dropdowns
function initDropdowns(){
  ['vol-dep-jour','vol-arr-jour','tr-jour','ht-ci-jour','ht-co-jour'].forEach(function(id){buildJourSelect(id,'');});
  ['vol-dep-mois','vol-arr-mois','tr-mois','ht-ci-mois','ht-co-mois'].forEach(function(id){buildMoisSelect(id,'');});
}

// ══════════════════════════════════════════
// EDIT MODE
// ══════════════════════════════════════════
// [migrated to module — see header]
function toggleEmode(type){
  var wasOn=emodes[type];
  // Reset tous les modes connus
  ['vols','trains','hotels','passes','lieux','mobilite','locations'].forEach(function(t){
    emodes[t]=false;
    document.body.classList.remove('emode-'+t);
    var btn=document.getElementById('bedit-'+t);
    if(btn) btn.classList.remove('active');
  });
  ['vols','trains','hotels','lieux','mobilite','locations','passes'].forEach(function(t){
    var b=document.getElementById('ebanner-'+t);
    if(b) b.classList.remove('visible');
  });
  if(!wasOn){
    emodes[type]=true;
    document.body.classList.add('emode-'+type);
    // 'mobilite' active aussi vols et trains (Pass est désormais une
    // section séparée avec son propre mode d'édition).
    if(type==='mobilite'){
      ['vols','trains'].forEach(function(t){
        emodes[t]=true;
        document.body.classList.add('emode-'+t);
      });
    }
    var btn=document.getElementById('bedit-'+type);
    if(btn) btn.classList.add('active');
    var bk=type;
    var banner=document.getElementById('ebanner-'+bk);
    if(banner) banner.classList.add('visible');
  }
}

// ══════════════════════════════════════════
// MODAL
// ══════════════════════════════════════════
function openModal(html){
  document.getElementById('editModalInner').innerHTML=html;
  document.getElementById('editModal').classList.add('open');
  // rebuild dropdowns inside modal
  document.querySelectorAll('[data-build-jour]').forEach(function(el){
    buildJourSelect(el.id, el.getAttribute('data-val')||'');
  });
  document.querySelectorAll('[data-build-mois]').forEach(function(el){
    buildMoisSelect(el.id, el.getAttribute('data-val')||'');
  });
}
function closeModal(){
  document.getElementById('editModal').classList.remove('open');
  document.getElementById('editModalInner').innerHTML='';
}
(function(){
  var em = document.getElementById('editModal');
  if(em) em.addEventListener('click',function(e){ if(e.target===this) closeModal(); });
})();

// ══════════════════════════════════════════════════════════════════
// DÉTAIL D'ACTIVITÉ DU PLANNING (lecture seule)
// Au clic sur un événement de la timeline, on ouvre une fiche dans la
// même fenêtre modale que l'édition (#editModal) montrant TOUTES les
// infos (horaires, billet, adresse, n° résa, PDF…), avec un bouton
// « Modifier » qui bascule vers le formulaire d'édition de la section.
// ══════════════════════════════════════════════════════════════════
function _tlEsc(s){
  return String(s==null?'':s).replace(/[&<>"]/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
  });
}
function _tlRow(label, value){
  if(value==null || value==='' ) return '';
  return '<div class="tld-row"><span class="tld-k">'+_tlEsc(label)+'</span>'
       + '<span class="tld-v">'+_tlEsc(value)+'</span></div>';
}
function _tlPdfBtn(pdfId){
  if(!pdfId || !window.pdfStore || !window.pdfStore[pdfId]) return '';
  var name = _tlEsc(window.pdfStore[pdfId].name || 'Document');
  return '<button type="button" class="tld-pdf" onclick="openPdf(\''+pdfId+'\')">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="15" height="15">'
    + '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/></svg> '
    + name + '</button>';
}
function openTimelineDetail(cat, id){
  id = isNaN(+id) ? id : +id;
  var byId = function(arr){ return (arr||[]).filter(function(o){ return o.id == id; })[0]; };
  var obj, kind, color, typeLabel, title, rows='', editFn, pdfId='';

  if(cat === 'transport'){
    obj = byId(typeof mobilites!=='undefined'?mobilites:[]); if(!obj) return _tlFallback('mobilite');
    kind='transport'; editFn='editMobilite';
    var T={vol:'Vol',train:'Train',bus:'Bus',bateau:'Ferry',voiture:'Voiture'};
    typeLabel = T[obj.type]||'Transport'; color='#c0392b';
    var dep=(obj.codeDep||obj.dep||'—'), arr=(obj.codeArr||obj.arr||'—');
    title = dep+' → '+arr;
    rows += _tlRow('Trajet', (obj.dep||'—')+'  →  '+(obj.arr||'—'));
    rows += _tlRow('Date', obj.date);
    rows += _tlRow('Horaires', obj.heureDep ? (obj.heureDep+(obj.heureArr?'  →  '+obj.heureArr:'')) : '');
    rows += _tlRow('Durée', obj.duree);
    rows += _tlRow('Compagnie', obj.compagnie);
    rows += _tlRow('N°', obj.numero);
    if(obj.type==='vol'){
      rows += _tlRow('Siège', obj.siege);
      rows += _tlRow('Terminal', obj.terminal);
      rows += _tlRow('Porte', obj.porte);
      rows += _tlRow('Bagages', obj.bagages);
    } else if(obj.type==='train'){
      rows += _tlRow('Siège', obj.siege);
      rows += _tlRow('Voiture', obj.voiture);
    } else if(obj.type==='bateau'){
      rows += _tlRow('Cabine', obj.cabine);
      rows += _tlRow('Pont', obj.pont);
    } else {
      rows += _tlRow('Siège', obj.siege);
    }
    if(obj.type==='vol' && typeof _isEscaleVol==='function' && _isEscaleVol(obj) && typeof _volChain==='function'){
      var dch=_volChain(obj);
      dch.escales.forEach(function(e,i){
        var nm=e.aeroport||(dch.airports[i+1]&&(dch.airports[i+1].name||dch.airports[i+1].code))||'';
        rows += _tlRow('Escale '+(i+1),
          nm + (e.dureeEscale?'  ·  '+e.dureeEscale:'') + (e.numero?'  ·  vol '+e.numero:''));
      });
    }
    rows += _tlRow('Statut', obj.statut);
    rows += _tlRow('Note', obj.note);
    pdfId = obj.pdfId;

  } else if(cat === 'hotel'){
    obj = byId(typeof hotels!=='undefined'?hotels:[]); if(!obj) return _tlFallback('hotels');
    kind='hotel'; editFn='editHotel'; typeLabel='Hébergement'; color='#8e44ad';
    title = obj.nom || '—';
    var hAddr = obj.rue ? (obj.rue+(obj.cp?' '+obj.cp:'')+', '+(obj.ville||'')+(obj.pays?', '+obj.pays:''))
                        : (obj.fullAddress||obj.ville||'');
    rows += _tlRow('Adresse', hAddr);
    rows += _tlRow('Check-in', obj.checkin);
    rows += _tlRow('Check-out', obj.checkout);
    rows += _tlRow('Nuits', obj.nuits);
    rows += _tlRow('Heure d\'arrivée', _fmtHeure(obj.heureArr));
    rows += _tlRow('Heure de départ', _fmtHeure(obj.heureDep));
    rows += _tlRow('Type de chambre', obj.type);
    rows += _tlRow('N° réservation', obj.resa);
    rows += _tlRow('Prix', obj.prix ? obj.prix+' €' : '');
    rows += _tlRow('Note', obj.note);
    pdfId = obj.pdfId;

  } else if(cat === 'lieu'){
    obj = byId(typeof lieux!=='undefined'?lieux:[]); if(!obj) return _tlFallback('lieux');
    kind='lieu'; editFn='editLieu'; typeLabel='Lieu à visiter'; color='#16a085';
    title = obj.nom || '—';
    var lAddr = obj.rue ? (obj.rue+(obj.cp?' '+obj.cp:'')+', '+(obj.ville||'')+(obj.pays?', '+obj.pays:''))
                        : (obj.fullAddress||obj.adresse||'');
    rows += _tlRow('Catégorie', obj.categorie);
    rows += _tlRow('Ville', obj.ville);
    rows += _tlRow('Adresse', lAddr);
    rows += _tlRow('Horaires', obj.horaires);
    rows += _tlRow('Prix', obj.prix);
    rows += _tlRow('Statut', obj.visited ? 'Visité' : '');
    rows += _tlRow('Note', obj.note);
    pdfId = obj.pdfId;

  } else if(cat === 'pass'){
    obj = byId(typeof passes!=='undefined'?passes:[]); if(!obj) return _tlFallback('mobilite');
    kind='pass'; editFn='editPass'; typeLabel='Pass / Abonnement'; color='#d68910';
    title = obj.nom || '—';
    rows += _tlRow('N°', obj.numero);
    rows += _tlRow('Validité', (obj.debut||'')+(obj.fin?'  →  '+obj.fin:''));
    rows += _tlRow('Prix', obj.prix ? obj.prix+' €' : '');
    rows += _tlRow('Zone', obj.zone);
    rows += _tlRow('Statut', obj.statut);
    rows += _tlRow('Note', obj.note);
    pdfId = obj.pdfId;

  } else if(cat === 'location'){
    obj = byId(typeof locations!=='undefined'?locations:[]); if(!obj) return _tlFallback('locations');
    kind='location'; editFn='editLocation'; typeLabel='Location'; color='#2980b9';
    var LL={voiture:'Voiture',scooter:'Scooter',moto:'Moto',velo:'Vélo',van:'Van'};
    var locLbl=(typeof LOC_LABELS!=='undefined'&&LOC_LABELS[obj.type])||LL[obj.type]||obj.type;
    title = obj.modele || locLbl || 'Location';
    rows += _tlRow('Type', locLbl);
    rows += _tlRow('Loueur', obj.loueur);
    rows += _tlRow('Prise en charge', (obj.dateDep||'')+(obj.heureDep?' à '+obj.heureDep:''));
    rows += _tlRow('Restitution', (obj.dateRet||'')+(obj.heureRet?' à '+obj.heureRet:''));
    rows += _tlRow('Lieu de prise', obj.lieuDep);
    rows += _tlRow('Lieu de restitution', obj.lieuRet);
    rows += _tlRow('N° réservation', obj.resa);
    rows += _tlRow('Caution', obj.caution);
    rows += _tlRow('Statut', obj.statut);
    rows += _tlRow('Note', obj.note);
    pdfId = obj.pdfId;

  } else { return; }

  var pdfHtml = _tlPdfBtn(pdfId);
  var html =
    '<div class="tld">'
    + '<div class="tld-head">'
      + '<span class="tld-dot" style="background:'+color+'"></span>'
      + '<div class="tld-head-txt">'
        + '<div class="tld-type">'+_tlEsc(typeLabel)+'</div>'
        + '<div class="tld-title">'+_tlEsc(title)+'</div>'
      + '</div>'
    + '</div>'
    + (rows ? '<div class="tld-rows">'+rows+'</div>'
            : '<div class="tld-empty">Aucune information complémentaire.</div>')
    + (pdfHtml ? '<div class="tld-pdf-wrap">'+pdfHtml+'</div>' : '')
    + '<div class="modal-footer">'
      + '<button class="btn-ghost" onclick="closeModal()">Fermer</button>'
      + '<div class="modal-actions">'
        + (kind==='lieu' ? '<button class="btn-ghost" onclick="toggleLieuVisitedFromModal('+(typeof id==='number'?id:('\''+id+'\''))+')">'+(obj.visited?'Marquer non visité':'Marquer visité')+'</button>' : '')
        + '<button class="btn-primary" onclick="closeModal();'+editFn+'('+(typeof id==='number'?id:('\''+id+'\''))+')">Modifier</button>'
      + '</div>'
    + '</div>'
    + '</div>';

  openModal(html);
}
// Repli si l'objet est introuvable : on renvoie vers la section concernée
function _tlFallback(section){
  if(typeof switchSection === 'function') switchSection(section);
}
// Clic sur une carte (pass/transport/location/hôtel/lieu) → modale détail.
// En mode édition (body.emode-*), on laisse les boutons d'édition agir.
function openCardDetail(cat, id){
  if(document.body.className.indexOf('emode-') !== -1) return;
  if(typeof openTimelineDetail === 'function') openTimelineDetail(cat, id);
}
// Garde-fou : un clic sur un élément interactif interne (bouton PDF, copier,
// carte, édition…) ne doit pas ouvrir la modale détail.
function _cardDetailClick(ev, cat, id){
  if(ev && ev.target && ev.target.closest &&
     ev.target.closest('.copyable,.pdf-view-btn,.pdf-del-btn,.pdf-badge,.edit-item-btn,.hotel-map-btn,.map-pin-link,.loc-key-badge,button,a,input,select,label')) return;
  openCardDetail(cat, id);
}
// ══════════════════════════════════════════════════════════════════
// DÉLÉGATION D'ÉVÉNEMENTS — cartes d'items (pass, vol, train, etc.)
// Élimine la classe de bug #5.1 (ids non quotés dans onclick inline) :
// les ids passent par des attributs DOM, plus aucune interpolation JS.
//   - Bouton d'action  : data-act="editPass" data-id="p1"
//   - Carte détail     : data-detail-cat="pass" data-detail-id="p1"
// Un seul listener délégué sur #spa-root gère tout (init une fois).
// L'allowlist _ITEM_ACTS empêche d'appeler une fonction arbitraire.
// ══════════════════════════════════════════════════════════════════
var _ITEM_ACTS = {
  editPass:1, deletePass:1, editVol:1, deleteVol:1, editTrain:1, deleteTrain:1,
  editMobilite:1, deleteMobilite:1, editLocation:1, deleteLocation:1,
  editHotel:1, deleteHotel:1, editLieu:1, deleteLieu:1,
  editTransaction:1, deleteTransaction:1, editDoc:1, deleteDoc:1,
  openPdf:1, openGlobalDocModal:1
};
function _initItemDelegation(){
  var root = document.getElementById('spa-root');
  if(!root || root._itemDelegated) return;
  root._itemDelegated = true;
  root.addEventListener('click', function(e){
    // 1) Bouton d'action (edit/delete) → dispatch via allowlist
    var actEl = e.target.closest && e.target.closest('[data-act]');
    if(actEl && root.contains(actEl)){
      var act = actEl.getAttribute('data-act');
      if(_ITEM_ACTS[act] && typeof window[act] === 'function'){
        e.stopPropagation();
        window[act](actEl.getAttribute('data-id'));
        return;
      }
    }
    // 2) Bouton « voir sur la carte » → goToMapPin(cat, id) [2 args]
    var pin = e.target.closest && e.target.closest('[data-mappin-cat]');
    if(pin && root.contains(pin)){
      e.stopPropagation();
      if(typeof goToMapPin === 'function') goToMapPin(pin.getAttribute('data-mappin-cat'), pin.getAttribute('data-mappin-id'));
      return;
    }
    // 3) Carte cliquable → modale détail (le garde-fou interne de
    //    _cardDetailClick ignore les clics sur boutons/liens internes).
    var card = e.target.closest && e.target.closest('[data-detail-cat]');
    if(card && root.contains(card)){
      _cardDetailClick(e, card.getAttribute('data-detail-cat'), card.getAttribute('data-detail-id'));
    }
  });
}
document.addEventListener('DOMContentLoaded', _initItemDelegation);

// Basculer « visité » depuis la modale détail d'un lieu, puis ré-afficher la modale à jour.
function toggleLieuVisitedFromModal(id){
  id = isNaN(+id) ? id : +id;
  var l = (typeof lieux!=='undefined'?lieux:[]).filter(function(o){ return o.id == id; })[0];
  if(!l) return;
  l.visited = !l.visited;
  if(typeof snapshotCurrentTrip==='function') snapshotCurrentTrip();
  if(typeof renderLieux==='function') renderLieux();
  openTimelineDetail('lieu', id);
}

function sel(id,val){
  return '<select id="'+id+'"'+
    (val&&val.match(/^(data-build-jour|data-build-mois)/)?'':'')+
    ' style="flex:1;min-width:0;padding:9px 12px;font-size:13px;font-family:DM Sans,sans-serif;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface-2);color:var(--ink);outline:none">';
}

function modalField(label,inputHtml){
  return '<div class="modal-field"><label>'+label+'</label>'+inputHtml+'</div>';
}
function mInput(id,val,placeholder,style){
  return '<input type="text" id="'+id+'" value="'+(val||'')+'" placeholder="'+(placeholder||'')+'" style="'+(style||'')+'" />';
}
function mSelect(id,options,val){
  var s='<select id="'+id+'" style="flex:1;min-width:0;padding:9px 12px;font-size:13px;font-family:DM Sans,sans-serif;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface-2);color:var(--ink);outline:none">';
  options.forEach(function(o){s+='<option'+(o===val?' selected':'')+'>'+o+'</option>';});
  s+='</select>';return s;
}
function mJour(id,val){
  return '<select id="'+id+'" data-build-jour="1" data-val="'+(val||'')+'" style="min-width:72px;flex:none;padding:9px 10px;font-size:13px;font-family:DM Sans,sans-serif;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface-2);color:var(--ink);outline:none"></select>';
}
function mMois(id,val){
  return '<select id="'+id+'" data-build-mois="1" data-val="'+(val||'')+'" style="flex:1;min-width:90px;padding:9px 10px;font-size:13px;font-family:DM Sans,sans-serif;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface-2);color:var(--ink);outline:none"></select>';
}
function mDateRow(label,jourId,moisId,jourVal,moisVal,heureId,heureVal){
  var h=heureId?'<input type="time" id="'+heureId+'" value="'+(heureVal||'')+'" style="max-width:110px;flex:none;padding:9px 10px;font-size:13px;font-family:DM Sans,sans-serif;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface-2);color:var(--ink);outline:none"/>':'';
  return '<div class="modal-field w-full"><label>'+label+'</label><div style="display:flex;gap:6px;flex-wrap:wrap">'+mJour(jourId,jourVal)+mMois(moisId,moisVal)+h+'</div></div>';
}
// ══════════════════════════════════════════════════════════════════
// CONFIRMATION DE SUPPRESSION — universelle, réutilisable
// Rendue dans la modale unique (#editModal) : remplace le formulaire.
// Aucune interpolation JS du libellé (piège #5.1) : les handlers sont
// posés via la propriété .onclick (fonctions), pas via des chaînes.
//   type        : 'la dépense', 'le vol', 'l'hébergement'…
//   libelle     : nom lisible de l'item (échappé HTML)
//   aUnDocument : true si une pièce jointe (facture) est rattachée
//   onConfirm   : fonction exécutée à la validation (fait la suppression)
//   onCancel    : fonction optionnelle (défaut : fermer la modale)
// ══════════════════════════════════════════════════════════════════
function confirmDelete(type, libelle, aUnDocument, onConfirm, onCancel){
  var msg = 'Supprimer ' + type + ' « ' + _tlEsc(libelle||'') + ' » ? Cette action est définitive.';
  var warn = aUnDocument
    ? '<div class="confirm-doc-warn">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="15" height="15"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
      + '<span>Un document (facture) y est rattaché et sera aussi supprimé.</span></div>'
    : '';
  openModal(
    '<div class="modal-header"><div class="modal-title">Confirmer la suppression</div>'
    +'<button class="modal-close" onclick="closeModal()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>'
    +'<div class="confirm-del-body"><p class="confirm-del-msg">'+msg+'</p>'+warn+'</div>'
    +'<div class="modal-footer"><div class="modal-actions" style="margin-left:auto">'
      +'<button class="btn-ghost" id="confirmDelCancel">Annuler</button>'
      +'<button class="btn-danger" id="confirmDelExec">Supprimer</button>'
    +'</div></div>'
  );
  var exec = document.getElementById('confirmDelExec');
  if(exec) exec.onclick = function(){ if(typeof onConfirm==='function') onConfirm(); };
  var cancel = document.getElementById('confirmDelCancel');
  if(cancel) cancel.onclick = function(){ if(typeof onCancel==='function') onCancel(); else closeModal(); };
}

// Métadonnées de la dernière modale d'édition ouverte (posées par modalFooter).
// Consommées par _askModalDelete au clic sur « Supprimer ».
var _modalDelMeta = null;
function _askModalDelete(){
  var m = _modalDelMeta;
  if(!m) return;
  var editFn = 'edit' + m.fn.substring(6); // deleteVol → editVol
  confirmDelete(m.type, m.libelle, !!m.hasDoc,
    function(){ if(_ITEM_ACTS[m.fn] && typeof window[m.fn]==='function') window[m.fn](m.id); },
    function(){ if(typeof window[editFn]==='function') window[editFn](m.id); else closeModal(); }
  );
}

// modalFooter(saveFn, delFn, delMeta)
//  - delMeta {type,libelle,hasDoc,fn,id} : route la suppression via confirmDelete.
//  - Sans delMeta : ancien comportement (delFn appelé directement) — rétro-compat.
function modalFooter(saveFn,delFn,delMeta){
  _modalDelMeta = delMeta || null;
  var delBtn = delMeta
    ? '<button class="btn-danger" id="modalDelBtn" onclick="_askModalDelete()">Supprimer</button>'
    : '<button class="btn-danger" onclick="'+delFn+'">Supprimer</button>';
  return '<div class="modal-footer">'
    +delBtn
    +'<div class="modal-actions">'
      +'<button class="btn-ghost" onclick="closeModal()">Annuler</button>'
      +'<button class="btn-primary" onclick="'+saveFn+'">Enregistrer</button>'
    +'</div>'
  +'</div>';
}

// ── Bloc PDF universel pour les modals d'édition ──────────────────────────
// pdfHiddenId : id du champ caché qui stocke le pdfId
// existingPdfId : pdfId déjà attaché à l'objet (peut être null/'')
// onChangeCall : chaîne JS appelée onChange, ex: "editVolAttachPdf(12,this)"
function mPdfBlock(pdfHiddenId, existingPdfId, onChangeCall){
  var existingHtml = '';
  if(existingPdfId && window.pdfStore && window.pdfStore[existingPdfId]){
    var pname = window.pdfStore[existingPdfId].name;
    existingHtml =
      '<div class="pdf-action-row" id="'+pdfHiddenId+'-badge" style="margin-bottom:6px">'
        +'<button type="button" class="pdf-view-btn" onclick="openPdf(\''+existingPdfId+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> '+pname+'</button>'
        +'<button type="button" class="pdf-del-btn" onclick="_modalPdfDel(\''+pdfHiddenId+'\',\''+existingPdfId+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>'
      +'</div>';
  } else {
    existingHtml = '<div class="pdf-action-row" id="'+pdfHiddenId+'-badge" style="margin-bottom:6px"></div>';
  }
  return '<div class="modal-section" style="margin-top:10px">Document / Billet</div>'
    +'<div class="modal-row" style="align-items:center;flex-wrap:wrap;gap:8px">'
      +existingHtml
      +'<label class="pdf-btn" style="cursor:pointer">'+(existingPdfId?'Remplacer':'Ajouter un document')
        +'<input type="file" accept=".pdf,image/*,application/pdf" style="display:none" onchange="'+(onChangeCall||'_modalPdfAttach(\''+pdfHiddenId+'\',this)')+'"/>'
      +'</label>'
      +'<input type="hidden" id="'+pdfHiddenId+'" value="'+(existingPdfId||'')+'"/>'
    +'</div>';
}

// Attachement PDF générique depuis une modal (stocke dans pdfStore + met à jour badge)
function _modalPdfAttach(hiddenId, fileInput){
  var file = fileInput.files[0];
  if(!file) return;
  if(file.size > 15*1024*1024){ alert('Fichier trop lourd (max 15 Mo)'); return; }
  var reader = new FileReader();
  reader.onload = function(e){
    var pdfId = 'pdf_'+Date.now();
    window.pdfStore[pdfId] = {name: file.name, data: e.target.result};
    savePdfStore();
    var hid = document.getElementById(hiddenId);
    if(hid) hid.value = pdfId;
    var badge = document.getElementById(hiddenId+'-badge');
    if(badge){
      badge.innerHTML =
        '<button type="button" class="pdf-view-btn" onclick="openPdf(\''+pdfId+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> '+file.name+'</button>'
        +'<button type="button" class="pdf-del-btn" onclick="_modalPdfDel(\''+hiddenId+'\',\''+pdfId+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>';
    }
  };
  reader.readAsDataURL(file);
}

// Suppression PDF depuis une modal
function _modalPdfDel(hiddenId, pdfId){
  if(window.pdfStore) delete window.pdfStore[pdfId];
  savePdfStore();
  var hid = document.getElementById(hiddenId);
  if(hid) hid.value = '';
  var badge = document.getElementById(hiddenId+'-badge');
  if(badge) badge.innerHTML = '';
}

// ══════════════════════════════════════════
// VOLS — Données & fonctions intelligentes
// ══════════════════════════════════════════

// ── Dictionnaire ville → {pays, code IATA} ──
// [migrated to module — see header]

// ── Compagnies aériennes ──
// [migrated to module — see header]
// ── Apprentissage villes & compagnies ──
(function _loadCustomAC(){
  try{
    var cv=JSON.parse(localStorage.getItem('yume_custom_cities')||'{}');
    Object.keys(cv).forEach(function(k){if(!CITY_DATA[k])CITY_DATA[k]=cv[k];});
    var ca=JSON.parse(localStorage.getItem('yume_custom_airlines')||'[]');
    ca.forEach(function(a){if(AIRLINES.indexOf(a)===-1)AIRLINES.push(a);});
  }catch(e){}
})();
function _acLearnCity(name,iata){
  if(!name||CITY_DATA[name])return;
  try{var cv=JSON.parse(localStorage.getItem('yume_custom_cities')||'{}');
    cv[name]={pays:'Personnalisé',iata:iata||'—'};
    localStorage.setItem('yume_custom_cities',JSON.stringify(cv));
    CITY_DATA[name]=cv[name];}catch(e){}
}
function _acLearnAirline(name){
  if(!name||AIRLINES.indexOf(name)!==-1)return;
  try{var ca=JSON.parse(localStorage.getItem('yume_custom_airlines')||'[]');
    ca.push(name);localStorage.setItem('yume_custom_airlines',JSON.stringify(ca));
    AIRLINES.push(name);}catch(e){}
}


// ── Autocomplete villes ──
function onVolVilleInput(side, val){
  var listId = 'ac-'+side+'-ville';
  var box = document.getElementById(listId);
  if(!box) return;
  if(!val.trim()){ box.classList.remove('open'); return; }
  var q = val.trim().toLowerCase();
  var hits = Object.keys(CITY_DATA).filter(function(c){
    return c.toLowerCase().indexOf(q) !== -1;
  }).slice(0,8);
  if(!hits.length){ box.classList.remove('open'); return; }
  box.innerHTML = hits.map(function(city){
    var d = CITY_DATA[city];
    return '<div class="ac-item" data-city="'+city.replace(/"/g,'&quot;')+'" data-side="'+side+'">'
      +'<span>'+city+'</span>'
      +'<span class="ac-sub">'+d.pays+' · '+d.iata+'</span>'
    +'</div>';
  }).join('');
  box.classList.add('open');
  box.querySelectorAll('.ac-item').forEach(function(item){
    item.addEventListener('click', function(){
      var city = this.getAttribute('data-city');
      var s    = this.getAttribute('data-side');
      var d    = CITY_DATA[city];
      var inp=this.closest('.ac-wrap').querySelector('input[type=text]');
      if(inp)inp.value=city;
      var codeId=s==='dep'?'mob-code-dep':'mob-code-arr';
      var cEl=document.getElementById(codeId);
      if(cEl&&d&&d.iata&&d.iata!=='—')cEl.value=d.iata;
      box.classList.remove('open');
      updateMobPreview();
    });
  });
}

// ── Autocomplete segment 2 (escale) : départ & arrivée finale ──
function onEscSegVilleInput(side, val){
  var boxId = 'ac-esc-' + side;
  var box = document.getElementById(boxId);
  if(!box) return;
  if(!val.trim()){ box.classList.remove('open'); return; }
  var q = val.trim().toLowerCase();
  var hits = Object.keys(CITY_DATA).filter(function(c){
    return c.toLowerCase().indexOf(q) !== -1;
  }).slice(0, 8);
  if(!hits.length){ box.classList.remove('open'); return; }
  box.innerHTML = hits.map(function(city){
    var d = CITY_DATA[city];
    return '<div class="ac-item" data-city="'+city.replace(/"/g,'&quot;')+'" data-side="'+side+'">'
      +'<span>'+city+'</span>'
      +'<span class="ac-sub">'+d.pays+' · '+d.iata+'</span>'
    +'</div>';
  }).join('');
  box.classList.add('open');
  box.querySelectorAll('.ac-item').forEach(function(item){
    item.addEventListener('click', function(){
      var city = this.getAttribute('data-city');
      var s    = this.getAttribute('data-side');
      var d    = CITY_DATA[city];
      var inp = this.closest('.ac-wrap').querySelector('input[type=text]');
      if(inp) inp.value = city;
      var codeId = s === 'dep' ? 'mob-esc-code-dep' : 'mob-esc-code-arr';
      var cEl = document.getElementById(codeId);
      if(cEl && d && d.iata && d.iata !== '—') cEl.value = d.iata;
      box.classList.remove('open');
      updateMobPreview();
    });
  });
}

// ── Fermer les listes ac au clic ailleurs ──
document.addEventListener('click', function(e){
  ['ac-dep-ville','ac-arr-ville','ac-compagnie','ac-tr-dep','ac-tr-arr','ac-esc-dep','ac-esc-arr'].forEach(function(id){
    var box=document.getElementById(id);
    if(box&&!box.closest('.ac-wrap').contains(e.target))box.classList.remove('open');
  });
});
document.addEventListener('DOMContentLoaded',function(){
  function _bc(id){var el=document.getElementById(id);if(!el)return;el.addEventListener('blur',function(){var v=this.value.trim();if(v&&!CITY_DATA[v])_acLearnCity(v,'');});}
  function _ba(id){var el=document.getElementById(id);if(!el)return;el.addEventListener('blur',function(){var v=this.value.trim();if(v&&AIRLINES.indexOf(v)===-1)_acLearnAirline(v);});}
  _bc('mob-dep');_bc('mob-arr');_bc('tr-dep-ville');_bc('tr-arr-ville');_ba('mob-compagnie');
});

// ── Titre auto depuis villes ──

// ── Autocomplete compagnies ──
function onCompagnieInput(val){
  var box = document.getElementById('ac-compagnie');
  if(!box) return;
  if(!val.trim()){ box.classList.remove('open'); return; }
  var q = val.trim().toLowerCase();
  var hits = AIRLINES.filter(function(a){ return a.toLowerCase().indexOf(q) !== -1; }).slice(0,8);
  if(!hits.length){ box.classList.remove('open'); return; }
  box.innerHTML = hits.map(function(a){
    return '<div class="ac-item" data-airline="'+a.replace(/"/g,'&quot;')+'">'+a+'</div>';
  }).join('');
  box.classList.add('open');
  box.querySelectorAll('.ac-item').forEach(function(item){
    item.addEventListener('click', function(){
      var airline=this.getAttribute('data-airline');
      var inp=this.closest('.ac-wrap').querySelector('input[type=text]');
      if(inp)inp.value=airline;
      box.classList.remove('open');
    });
  });
}

// ── Mini-carte destination ──

// Silhouettes SVG simplifiées des pays (paths dessinés à la main, proportionnés)
var COUNTRY_SVG_PATHS = {
  'Japon': 'M 180 15 C 185 12 190 14 192 18 C 194 22 191 26 187 25 C 183 24 179 21 180 15 Z M 168 28 C 172 22 178 20 182 24 C 186 28 184 36 178 40 C 172 44 164 42 162 36 C 160 30 164 24 168 28 Z M 155 50 C 160 42 170 40 174 46 C 178 52 174 64 166 68 C 158 72 150 68 148 60 C 146 52 150 44 155 50 Z M 148 72 C 152 66 160 66 162 72 C 164 78 158 84 152 82 C 146 80 144 74 148 72 Z',
  'France': 'M 110 25 C 125 20 155 22 165 30 C 175 38 172 50 168 58 C 164 66 158 72 148 74 C 138 76 125 73 116 67 C 107 61 102 52 104 42 C 106 32 110 25 110 25 Z',
  'Espagne': 'M 95 30 C 110 24 160 26 172 34 C 184 42 182 56 175 65 C 168 74 155 78 138 76 C 121 74 105 68 97 58 C 89 48 88 36 95 30 Z',
  'Italie': 'M 148 18 C 152 14 158 16 160 22 C 162 28 158 34 153 35 L 155 50 C 158 60 162 70 165 78 C 168 86 164 92 158 90 C 152 88 148 80 146 72 L 144 55 L 142 42 C 138 36 138 26 142 20 C 144 16 148 18 148 18 Z',
  'Allemagne': 'M 120 20 C 136 16 158 20 165 30 C 172 40 170 56 162 64 C 154 72 138 74 124 70 C 110 66 104 54 106 42 C 108 30 120 20 120 20 Z',
  'Royaume-Uni': 'M 118 16 C 122 12 128 14 130 20 L 128 32 C 134 28 138 30 136 36 C 134 42 128 44 124 40 L 122 52 C 120 60 114 62 110 56 C 106 50 108 42 114 40 L 116 28 C 112 24 114 18 118 16 Z',
  'États-Unis': 'M 55 30 C 90 22 190 24 215 32 C 230 38 228 52 220 60 C 205 72 175 76 145 74 C 115 72 85 68 65 60 C 45 52 42 40 55 30 Z',
  'Canada': 'M 50 20 C 85 14 200 16 225 26 C 240 34 238 48 228 56 C 210 68 180 70 150 68 C 120 66 85 62 62 54 C 42 46 38 30 50 20 Z',
  'Maroc': 'M 108 22 C 124 16 155 20 165 30 C 175 40 172 56 162 64 C 150 72 130 72 116 64 C 102 56 98 42 106 30 C 108 26 108 22 108 22 Z',
  'Thaïlande': 'M 148 20 C 155 16 162 20 162 28 C 162 36 156 44 152 52 C 156 60 158 70 154 76 C 150 82 144 80 142 74 C 140 66 142 56 146 48 C 142 42 138 34 140 26 C 141 22 145 20 148 20 Z',
  'Australie': 'M 85 28 C 125 18 195 22 220 38 C 240 52 235 70 218 80 C 195 92 155 90 120 82 C 88 74 70 60 72 46 C 74 34 85 28 85 28 Z',
  'Brésil': 'M 100 18 C 135 12 180 18 195 34 C 210 50 205 72 188 84 C 168 96 135 94 110 82 C 85 70 78 50 88 34 C 92 24 100 18 100 18 Z',
  'Turquie': 'M 90 28 C 130 18 195 22 215 34 C 228 44 224 58 210 64 C 188 72 148 70 118 62 C 92 54 84 40 90 28 Z',
  'Inde': 'M 142 14 C 155 10 170 16 172 28 C 174 40 168 54 162 66 C 168 76 170 86 164 90 C 158 94 152 88 150 80 C 148 70 148 58 146 46 C 136 40 130 30 134 20 C 136 16 142 14 142 14 Z',
  'Chine': 'M 75 22 C 120 14 195 18 220 32 C 238 44 235 62 218 72 C 192 84 148 82 115 72 C 82 62 68 46 74 32 C 75 26 75 22 75 22 Z',
  'Corée du Sud': 'M 135 22 C 148 16 165 20 168 30 C 171 40 163 52 152 56 C 141 60 128 56 124 46 C 120 36 126 24 135 22 Z',
  'Singapour': 'M 144 42 C 148 40 152 42 152 46 C 152 50 148 52 144 50 C 140 48 140 44 144 42 Z',
  'Vietnam': 'M 155 12 C 160 10 165 14 164 20 L 162 36 C 166 44 164 54 158 58 C 162 66 164 76 160 82 C 156 88 150 86 148 80 C 146 72 148 62 152 54 C 148 48 146 38 148 28 C 148 18 152 12 155 12 Z',
  'Indonésie': 'M 65 36 C 78 32 95 34 98 40 C 101 46 96 52 84 52 C 72 52 62 46 65 36 Z M 110 38 C 125 34 145 36 148 44 C 151 52 142 58 128 56 C 114 54 108 46 110 38 Z M 160 40 C 180 36 210 38 215 48 C 220 58 205 64 188 62 C 170 60 158 52 160 40 Z',
  'Malaisie': 'M 85 36 C 100 32 130 34 135 42 C 140 50 130 58 112 58 C 94 58 82 50 85 36 Z M 160 32 C 168 28 176 32 176 40 C 176 48 168 54 160 52 C 152 50 150 44 154 38 C 156 34 160 32 160 32 Z',
  'Philippines': 'M 180 18 C 184 14 188 18 187 24 C 186 30 181 32 178 28 C 175 24 177 18 180 18 Z M 170 32 C 175 28 180 32 179 38 C 178 44 172 46 168 42 C 164 38 166 32 170 32 Z M 183 38 C 188 34 193 38 192 44 C 191 50 185 52 181 48 C 177 44 179 38 183 38 Z',
  'Portugal': 'M 112 22 C 118 18 126 22 126 30 C 126 42 122 58 118 66 C 114 74 108 74 106 66 C 104 56 106 40 108 30 C 109 26 112 22 112 22 Z',
  'Grèce': 'M 148 28 C 155 24 162 28 161 36 C 160 44 153 48 147 46 C 141 44 139 36 143 30 C 145 28 148 28 148 28 Z M 138 52 C 142 48 148 50 148 56 C 148 62 143 65 138 63 C 133 61 132 56 135 52 C 136 50 138 52 138 52 Z M 155 54 C 159 50 165 52 165 58 C 165 64 159 67 154 65 C 149 63 149 56 153 52 C 154 50 155 54 155 54 Z',
  'Égypte': 'M 108 22 C 130 16 175 18 185 28 C 195 38 192 56 178 64 C 162 72 130 70 112 60 C 96 50 94 34 108 22 Z',
  'default': 'M 80 30 C 110 20 185 22 205 35 C 218 44 215 60 200 68 C 178 78 135 76 105 66 C 78 56 72 42 80 30 Z'
};

function renderVolsDestCard(){
  if(typeof COUNTRY_SVG_PATHS === 'undefined') return;
  var noneEl = document.getElementById('vols-dest-none');
  var mapEl  = document.getElementById('vols-dest-map');
  var infoEl = document.getElementById('vols-dest-info');
  if(!noneEl||!mapEl||!infoEl) return;

  var country = '';
  if(currentTripId && allTrips[currentTripId]){
    country = (allTrips[currentTripId].meta||{}).country || '';
  }
  if(!country){
    noneEl.style.display='flex'; mapEl.style.display='none'; infoEl.style.display='none';
    return;
  }
  noneEl.style.display='none'; mapEl.style.display='flex'; infoEl.style.display='flex';

  // SVG silhouette
  var svgEl = document.getElementById('vols-dest-svg');
  var path  = COUNTRY_SVG_PATHS[country] || COUNTRY_SVG_PATHS['default'];
  if(svgEl){
    svgEl.innerHTML = '<path d="'+path+'" fill="rgba(232,116,138,.7)" stroke="rgba(255,255,255,.3)" stroke-width="1.5"/>';
  }
  // Flag + nom
  var iso  = countryToISO(country);
  var flag = isoToFlag(iso);
  var flagEl    = document.getElementById('vols-dest-flag');
  var countryEl = document.getElementById('vols-dest-country');
  var currEl    = document.getElementById('vols-dest-currency');
  if(flagEl)    flagEl.textContent = flag;
  if(countryEl) countryEl.textContent = country;
  // Devise locale
  if(currEl){
    var currCode = (typeof COUNTRY_CURRENCY !== 'undefined' && COUNTRY_CURRENCY[country]) || '';
    var currInfo = (typeof CURRENCY_INFO    !== 'undefined' && currCode) ? CURRENCY_INFO[currCode] : null;
    currEl.textContent = currCode ? currCode + (currInfo ? ' · ' + currInfo.sym : '') : '';
  }
}

// ── Calendrier vols : minDate ──

// ── Escales ──
var escalesData = []; // [{aeroport:'', duree:'', numero:''}]


function removeEscaleField(idx){
  escalesData.splice(idx,1);
  if(!escalesData.length){
    document.getElementById('vol-escales-check').checked=false;
    document.getElementById('escales-section').classList.remove('open');
  }
  renderEscalesFields();
}

function renderEscalesFields(){
  var list = document.getElementById('escales-list');
  if(!list) return;
  list.innerHTML = escalesData.map(function(e,i){
    return '<div class="escale-item">'
      +'<input type="text" placeholder="Aéroport (ex: AMS)" style="max-width:110px;flex:none"'
        +' value="'+e.aeroport+'"'
        +' oninput="escalesData['+i+'].aeroport=this.value"/>'
      +'<input type="text" placeholder="Durée escale (ex: 2h30)" style="max-width:110px;flex:none"'
        +' value="'+e.duree+'"'
        +' oninput="escalesData['+i+'].duree=this.value"/>'
      +'<input type="text" placeholder="N° vol escale" style="flex:1"'
        +' value="'+e.numero+'"'
        +' oninput="escalesData['+i+'].numero=this.value"/>'
      +'<button class="escale-del" onclick="removeEscaleField('+i+')" title="Supprimer cette escale"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
    +'</div>';
  }).join('');
}

function getEscalesForSave(){
  return escalesData.filter(function(e){ return e.aeroport||e.duree; });
}

function resetEscalesForm(){
  escalesData=[];
  var chk=document.getElementById('vol-escales-check');
  if(chk) chk.checked=false;
  var sec=document.getElementById('escales-section');
  if(sec) sec.classList.remove('open');
  renderEscalesFields();
}

var calMinDate = null; // Date object — jours < calMinDate désactivés
var calMaxDate = null; // Date object — jours > calMaxDate désactivés (max 3j pour vols)

// ── Summary bar dynamique ──
function updateVolsSummary(){
  var nb = vols.length;
  var sel = document.getElementById('sum-nb');
  if(sel) sel.textContent = nb;

  // Aller = premier vol, Retour = dernier vol (si nb>=2)
  if(!nb){
    ['sum-aller','sum-retour','sum-duree'].forEach(function(id){
      var el = document.getElementById(id); if(el) el.textContent = '—';
    });
    return;
  }
  var v0 = vols[0];
  var vN = vols[vols.length-1];
  var allerEl = document.getElementById('sum-aller');
  if(allerEl) allerEl.textContent = (v0.depCode||v0.depVille||'?')+' → '+(v0.arrCode||v0.arrVille||'?');
  var retEl = document.getElementById('sum-retour');
  if(retEl) retEl.textContent = nb>=2
    ? (vN.depCode||vN.depVille||'?')+' → '+(vN.arrCode||vN.arrVille||'?')
    : '—';
  // Durée totale : nb jours entre premier départ et dernier retour
  var dureeEl = document.getElementById('sum-duree');
  if(dureeEl){
    var d0 = v0.depDate ? parseDDMMYYYY(v0.depDate) : null;
    var dN = vN.arrDate ? parseDDMMYYYY(vN.arrDate) : null;
    if(d0 && dN && dN > d0){
      var jours = Math.round((dN-d0)/(1000*60*60*24));
      dureeEl.textContent = jours+' jour'+(jours>1?'s':'');
    } else {
      dureeEl.textContent = nb+' vol'+(nb>1?'s':'');
    }
  }
}

// ══════════════════════════════════════════
// VOLS
// ══════════════════════════════════════════
// [migrated to module — see header]

function renderVols(){
  var el=document.getElementById('vols-list');
  if(!el) return; // tab-vols removed; legacy vols shown via mob-legacy-vols-wrap
  el.style.display='';
  if(!vols.length){
    // Hide the legacy wrap if no vols
    var legacyWrap = document.getElementById('mob-legacy-vols-wrap');
    if(legacyWrap) legacyWrap.style.display='none';
    el.innerHTML='';
    return;
  }
  // Show legacy wrap when there are existing vols (migration)
  var legacyWrap = document.getElementById('mob-legacy-vols-wrap');
  if(legacyWrap) legacyWrap.style.display='';
  el.innerHTML=vols.map(function(v){
    var dot=v.statut==='Confirmé'?'var(--teal)':'var(--gold)';
    var bc=v.statut==='Confirmé'?'badge-green':'badge-gold';
    var bt=v.statut==='Confirmé'?'Confirmé':v.statut;
    return '<div class="card item-wrap evol" style="position:relative">'
      +'<div class="card-title">'+v.titre+' <span class="badge '+bc+'">'+bt+'</span></div>'
      +'<div class="flight-block">'
        +'<div><div class="airport-code">'+(v.depCode||'—')+'</div><div class="airport-name">'+(v.depVille||'')+'</div></div>'
        +'<div class="flight-middle"><div class="flight-track">'
          +'<div class="ft-dot" style="background:'+dot+'"></div>'
          +'<div class="ft-line"></div><div class="ft-plane"></div><div class="ft-line"></div>'
          +'<div class="ft-dot" style="background:'+dot+'"></div>'
        +'</div><div class="ft-dur">'+(v.duree||'—')+'</div></div>'
        +'<div style="text-align:right"><div class="airport-code">'+(v.arrCode||'—')+'</div><div class="airport-name">'+(v.arrVille||'')+'</div></div>'
      +'</div>'
      +'<div class="flight-meta">'
        +'<div class="meta-item"><div class="lbl">Départ</div><div class="val">'+(v.dateDep||'—')+'</div></div>'
        +'<div class="meta-item"><div class="lbl">Arrivée</div><div class="val">'+(v.dateArr||'—')+'</div></div>'
        +'<div class="meta-item"><div class="lbl">Compagnie</div><div class="val">'+(v.compagnie||'—')+'</div></div>'
        +'<div class="meta-item"><div class="lbl">N° de vol</div><div class="val">'+(v.numero||'—')+'</div></div>'
        +'<div class="meta-item"><div class="lbl">Réservation</div><div class="val">'+(v.resa?'<span class="copyable" data-copy="'+(v.resa+'').replace(/"/g,'&quot;')+'">'+v.resa+'</span>':'—')+'</div></div>'
        +'<div class="meta-item"><div class="lbl">Siège</div><div class="val">'+(v.siege||'—')+'</div></div>'
      +'</div>'
      +(v.escales&&v.escales.length
        ? '<div style="margin-top:8px;padding:8px 10px;background:var(--surface-2);border-radius:var(--r-sm);font-size:12px">'
          +'<span style="font-weight:600;color:var(--ink-muted);text-transform:uppercase;font-size:10px;letter-spacing:.06em">Escale'+(v.escales.length>1?'s':'')+'</span>'
          +v.escales.map(function(esc,i){
            return '<div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid var(--border)">'
              +'<span style="font-weight:600">'+esc.aeroport+'</span>'
              +(esc.duree?'<span style="color:var(--ink-muted)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" width="10" height="10" style="vertical-align:-1px"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/></svg> '+esc.duree+'</span>':'')
              +(esc.numero?'<span style="color:var(--ink-hint)">'+esc.numero+'</span>':'')
            +'</div>';
          }).join('')
        +'</div>'
        : '')
      +(v.pdfId && window.pdfStore && window.pdfStore[v.pdfId]
        ? '<div class="pdf-action-row" style="margin-top:8px">'
          +'<button class="pdf-view-btn" data-pid="'+v.pdfId+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Voir le billet</button>'
          +(emodes&&emodes.vols
            ? '<button class="pdf-del-btn" data-pid="'+v.pdfId+'" data-vid="'+v.id+'">🗑 Supprimer</button>'
            : '')
        +'</div>'
        : '')
      +'<button class="edit-item-btn" data-act="editVol" data-id="'+v.id+'"></button>'
    +'</div>';
  }).join('');
  // Attacher les listeners PDF après rendu
  document.querySelectorAll('#vols-list .pdf-view-btn').forEach(function(btn){
    btn.addEventListener('click', function(){ openPdf(this.getAttribute('data-pid')); });
  });
  document.querySelectorAll('#vols-list .pdf-del-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      var vid = parseInt(this.getAttribute('data-vid'));
      var vol = vols.find(function(v){ return v.id===vid; });
      if(vol && confirm('Supprimer ce document PDF ?')){
        delete window.pdfStore[vol.pdfId];
        vol.pdfId = null;
        renderVols(); snapshotCurrentTrip();
        showToast('PDF supprimé', 'info');
      }
    });
  });
  updateVolsSummary();
  renderVolsDestCard();
}

function editVol(id){id=isNaN(+id)?id:+id;
  var v=vols.find(function(x){return x.id==id;});
  if(!v) return;
  // Badge PDF existant
  var pdfHtml='';
  if(v.pdfId && window.pdfStore && window.pdfStore[v.pdfId]){
    var pname=window.pdfStore[v.pdfId].name;
    pdfHtml='<div class="pdf-action-row" style="margin-bottom:6px">'
      +'<button class="pdf-view-btn" onclick="openPdf(\''+v.pdfId+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> '+pname+'</button>'
      +'<button class="pdf-del-btn" onclick="editVolDeletePdf(\''+id+'\')">🗑 Supprimer</button>'
    +'</div>';
  }
  openModal(
    '<div class="modal-header"><div class="modal-title">Modifier ce vol</div><button class="modal-close" onclick="closeModal()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>'
    +'<div class="modal-section">Informations générales</div>'
    +'<div class="modal-row">'
      +modalField('Titre',mInput('ev-titre',v.titre,'Paris ➔ Tokyo','width:100%'))
      +mSelect('ev-statut',['Confirmé','À confirmer'],v.statut)
    +'</div>'
    +'<div class="modal-section">Trajet</div>'
    +'<div class="modal-row">'
      +modalField('Code départ',mInput('ev-dep-code',v.depCode,'CDG','max-width:90px'))
      +modalField('Ville départ',mInput('ev-dep-ville',v.depVille,'Paris'))
      +modalField('Code arrivée',mInput('ev-arr-code',v.arrCode,'NRT','max-width:90px'))
      +modalField('Ville arrivée',mInput('ev-arr-ville',v.arrVille,'Tokyo'))
    +'</div>'
    +'<div class="modal-row">'
      +modalField('Date départ',mInput('ev-dep-date',v.depDate||'','JJ/MM/AAAA','cursor:pointer;background:var(--surface-2)','readonly onclick="openCalendar(\'ev-dep-date\')"'))
      +modalField('Heure départ',mInput('ev-dep-heure',v.dateDep?v.dateDep.replace(/.*\xb7\s*/,''):'','11h30','max-width:90px'))
      +modalField('Date arrivée',mInput('ev-arr-date',v.arrDate||'','JJ/MM/AAAA','cursor:pointer;background:var(--surface-2)','readonly onclick="openCalendar(\'ev-arr-date\')"'))
      +modalField('Heure arrivée',mInput('ev-arr-heure',v.dateArr?v.dateArr.replace(/.*\xb7\s*/,''):'','08h45','max-width:90px'))
    +'</div>'
    +'<div class="modal-section">Détails</div>'
    +'<div class="modal-row">'
      +modalField('Compagnie',mInput('ev-compagnie',v.compagnie,'Air France'))
      +modalField('N° vol',mInput('ev-numero',v.numero,'AF275'))
      +modalField('Durée',mInput('ev-duree',v.duree,'14h'))
    +'</div>'
    +'<div class="modal-row">'
      +modalField('N° réservation',mInput('ev-resa',v.resa,'ABC123'))
      +modalField('Siège',mInput('ev-siege',v.siege,'24A'))
    +'</div>'
    +'<div class="modal-section">Document PDF</div>'
    +'<div class="modal-row" style="align-items:center;flex-wrap:wrap;gap:8px">'
      +pdfHtml
      +'<label class="pdf-btn">'+(pdfHtml?'Remplacer':'Ajouter un billet')
      +'<input type="file" accept=".pdf,application/pdf" onchange="editVolAttachPdf('+id+',this)"/>'
      +'</label>'
    +'</div>'
    +'<input type="hidden" id="ev-pdf-id" value="'+(v.pdfId||'')+'"/>'
    +(v.escales&&v.escales.length
      ? '<div class="modal-section">Escales</div>'
        +'<div id="ev-escales-list">'+buildEditEscalesHTML(v.escales)+'</div>'
        +'<button class="btn-add-escale" onclick="addEditEscale()">+ Ajouter une escale</button>'
        +'<input type="hidden" id="ev-escales-json" value="'+encodeURIComponent(JSON.stringify(v.escales||[]))+'"/>'
      : '<div style="margin-top:8px">'
          +'<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">'
            +'<input type="checkbox" id="ev-escales-check" onchange="toggleEditEscales()"/> ✈ Ajouter des escales'
          +'</label>'
          +'<div class="escales-section" id="ev-escales-section">'
            +'<div id="ev-escales-list"></div>'
            +'<button class="btn-add-escale" onclick="addEditEscale()">+ Ajouter une escale</button>'
          +'</div>'
          +'<input type="hidden" id="ev-escales-json" value="[]"/>'
        +'</div>')
    +modalFooter('saveVol(\''+id+'\')','deleteVol(\''+id+'\')',{type:'le vol',libelle:v.titre||'',hasDoc:!!v.pdfId,fn:'deleteVol',id:id})
  );
}

var _editEscalesData = [];

function buildEditEscalesHTML(escales){
  _editEscalesData = escales ? escales.map(function(e){ return Object.assign({},e); }) : [];
  return renderEditEscalesHTML();
}

function renderEditEscalesHTML(){
  if(!_editEscalesData.length) return '<div style="font-size:12px;color:var(--ink-muted);padding:4px 0">Aucune escale.</div>';
  return _editEscalesData.map(function(e,i){
    return '<div class="escale-item" style="flex-wrap:wrap;gap:6px;align-items:center">'
      +'<div class="ac-wrap" style="min-width:130px;flex:1">'
        +'<input type="text" placeholder="Ville / Aéroport" autocomplete="off"'
          +' value="'+e.aeroport+'"'
          +' oninput="editEscaleSet('+i+',\'aeroport\',this.value);onEditEscaleVille('+i+',this.value)"'
          +' style="width:100%;padding:8px 10px;font-size:13px;font-family:DM Sans,sans-serif;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface-2);color:var(--ink);outline:none"/>'
        +'<div class="ac-list" id="ev-ac-'+i+'"></div>'
      +'</div>'
      +'<div style="display:flex;gap:3px;align-items:center;flex-shrink:0">'
        +'<div class="hm-group"><div class="hm-group-label">h</div>'
          +'<select class="hm-sel-h" id="ev-esc-h-'+i+'" onchange="syncEditEscaleDuree('+i+')"></select></div>'
        +'<span style="font-size:14px;font-weight:700;color:var(--ink-hint)">h</span>'
        +'<div class="hm-group"><div class="hm-group-label">×10</div>'
          +'<select class="hm-sel-d" id="ev-esc-d-'+i+'" onchange="syncEditEscaleDuree('+i+')"></select></div>'
        +'<div class="hm-group"><div class="hm-group-label">×1</div>'
          +'<select class="hm-sel-u" id="ev-esc-u-'+i+'" onchange="syncEditEscaleDuree('+i+')"></select></div>'
      +'</div>'
      +'<input type="text" placeholder="N° vol" value="'+e.numero+'"'
        +' oninput="editEscaleSet('+i+',\'numero\',this.value)"'
        +' style="max-width:100px;flex:none;padding:8px 10px;font-size:13px;font-family:DM Sans,sans-serif;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface-2);color:var(--ink);outline:none"/>'
      +'<button class="escale-del" onclick="removeEditEscale('+i+')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
    +'</div>';
  }).join('');
}

function refreshEditEscalesList(){
  var el=document.getElementById('ev-escales-list');
  if(el){ el.innerHTML=renderEditEscalesHTML(); initEditEscaleSelects(); }
  // Sauvegarder dans champ caché
  var hid=document.getElementById('ev-escales-json');
  if(hid) hid.value=encodeURIComponent(JSON.stringify(_editEscalesData));
}

function initEditEscaleSelects(){
  _editEscalesData.forEach(function(e,i){
    var h=e.dureeH||0, m=e.dureeM||0;
    var hEl=document.getElementById('ev-esc-h-'+i);
    var dEl=document.getElementById('ev-esc-d-'+i);
    var uEl=document.getElementById('ev-esc-u-'+i);
    if(hEl) initHMSelect(hEl,'H',h);
    if(dEl) initHMSelect(dEl,'D',Math.floor(m/10));
    if(uEl) initHMSelect(uEl,'U',m%10);
  });
}

function editEscaleSet(idx,key,val){
  if(_editEscalesData[idx]) _editEscalesData[idx][key]=val;
  var hid=document.getElementById('ev-escales-json');
  if(hid) hid.value=encodeURIComponent(JSON.stringify(_editEscalesData));
}

function syncEditEscaleDuree(idx){
  var hv=parseInt((document.getElementById('ev-esc-h-'+idx)||{}).value)||0;
  var dv=parseInt((document.getElementById('ev-esc-d-'+idx)||{}).value)||0;
  var uv=parseInt((document.getElementById('ev-esc-u-'+idx)||{}).value)||0;
  var mv=dv*10+uv;
  if(_editEscalesData[idx]){
    _editEscalesData[idx].dureeH=hv; _editEscalesData[idx].dureeM=mv;
    _editEscalesData[idx].duree=(hv>0||mv>0)?(hv+'h'+(mv<10?'0'+mv:mv)):'';
  }
  editEscaleSet(idx,'duree',_editEscalesData[idx]?_editEscalesData[idx].duree:'');
}

function onEditEscaleVille(idx,val){
  var box=document.getElementById('ev-ac-'+idx);
  if(!box) return;
  if(!val.trim()){ box.classList.remove('open'); return; }
  var q=val.trim().toLowerCase();
  var hits=Object.keys(CITY_DATA).filter(function(c){ return c.toLowerCase().indexOf(q)!==-1; }).slice(0,6);
  if(!hits.length){ box.classList.remove('open'); return; }
  box.innerHTML=hits.map(function(city){
    var d=CITY_DATA[city];
    return '<div class="ac-item" data-city="'+city.replace(/"/g,'&quot;')+'" data-idx="'+idx+'">'
      +'<span>'+city+'</span><span class="ac-sub">'+d.pays+' · '+d.iata+'</span></div>';
  }).join('');
  box.classList.add('open');
  box.querySelectorAll('.ac-item').forEach(function(item){
    item.addEventListener('click',function(){
      var city=this.getAttribute('data-city');
      var i=parseInt(this.getAttribute('data-idx'));
      editEscaleSet(i,'aeroport',city);
      var inp=this.closest('.ac-wrap').querySelector('input');
      if(inp) inp.value=city;
      box.classList.remove('open');
    });
  });
}

function addEditEscale(){
  _editEscalesData.push({aeroport:'',duree:'',dureeH:0,dureeM:0,numero:''});
  refreshEditEscalesList();
}

function removeEditEscale(idx){
  _editEscalesData.splice(idx,1);
  refreshEditEscalesList();
}

function toggleEditEscales(){
  var chk=document.getElementById('ev-escales-check');
  var sec=document.getElementById('ev-escales-section');
  if(!chk||!sec) return;
  if(chk.checked){ sec.classList.add('open'); if(!_editEscalesData.length) addEditEscale(); }
  else { sec.classList.remove('open'); _editEscalesData=[]; refreshEditEscalesList(); }
}

function editVolDeletePdf(volId){
  var v=vols.find(function(x){return x.id==volId;});
  if(!v) return;
  if(window.pdfStore && v.pdfId) delete window.pdfStore[v.pdfId];
  v.pdfId=null;
  snapshotCurrentTrip();
  editVol(volId); // re-ouvrir la modal rafraîchie
}

function editVolAttachPdf(volId, fileInput){
  var file=fileInput.files[0];
  if(!file) return;
  if(file.size>15*1024*1024){ alert('PDF trop lourd (max 15 Mo)'); return; }
  var reader=new FileReader();
  reader.onload=function(e){
    var pdfId='pdf_'+Date.now();
    window.pdfStore[pdfId]={name:file.name,data:e.target.result};
    var v=vols.find(function(x){return x.id==volId;});
    if(v){
      // Supprimer l'ancien
      if(v.pdfId && window.pdfStore[v.pdfId] && v.pdfId!==pdfId) delete window.pdfStore[v.pdfId];
      v.pdfId=pdfId;
    }
    snapshotCurrentTrip();
    editVol(volId); // re-ouvrir avec nouveau PDF affiché
  };
  reader.readAsDataURL(file);
}

function saveVol(id){id=isNaN(+id)?id:+id;
  var v=vols.find(function(x){return x.id==id;});
  if(!v) return;
  v.statut   = document.getElementById('ev-statut').value;
  v.depCode  = document.getElementById('ev-dep-code').value;
  v.depVille = document.getElementById('ev-dep-ville').value;
  v.arrCode  = document.getElementById('ev-arr-code').value;
  v.arrVille = document.getElementById('ev-arr-ville').value;
  // Titre auto si villes renseignées
  var newTitre = document.getElementById('ev-titre') ? document.getElementById('ev-titre').value.trim() : '';
  if(!newTitre && (v.depVille||v.arrVille)){
    newTitre = (v.depVille||v.depCode||'?')+' → '+(v.arrVille||v.arrCode||'?');
  }
  if(newTitre) v.titre = newTitre;
  // Dates nouvelles
  var depDate = document.getElementById('ev-dep-date') ? document.getElementById('ev-dep-date').value : '';
  var arrDate = document.getElementById('ev-arr-date') ? document.getElementById('ev-arr-date').value : '';
  var dh = document.getElementById('ev-dep-heure') ? document.getElementById('ev-dep-heure').value : '';
  var ah = document.getElementById('ev-arr-heure') ? document.getElementById('ev-arr-heure').value : '';
  if(depDate){ v.depDate=depDate; v.dateDep=depDate+(dh?' · '+dh:''); }
  if(arrDate){ v.arrDate=arrDate; v.dateArr=arrDate+(ah?' · '+ah:''); }
  v.compagnie = document.getElementById('ev-compagnie').value;
  v.numero    = document.getElementById('ev-numero').value;
  v.duree     = document.getElementById('ev-duree').value;
  v.resa      = document.getElementById('ev-resa').value;
  v.siege     = document.getElementById('ev-siege').value;
  // PDF
  var evPdf = document.getElementById('ev-pdf-id');
  if(evPdf) v.pdfId = evPdf.value;
  // Escales
  var evEsc = document.getElementById('ev-escales-json');
  if(evEsc && evEsc.value){
    try{ v.escales = JSON.parse(decodeURIComponent(evEsc.value)); }catch(e){}
  }
  closeModal();
  renderVols();
  snapshotCurrentTrip();
  showToast('Vol modifié ', 'success');
}

function addVol(){
  var _g = function(id){ var e=document.getElementById(id); return e ? e.value : ''; };
  var dep = _g('vol-dep-ville').trim();
  var arr = _g('vol-arr-ville').trim();
  var t   = _g('vol-titre').trim();
  if(!t){ t = (dep||_g('vol-dep-code')||'?')+' → '+(arr||_g('vol-arr-code')||'?'); }

  var depDate = _g('vol-dep-date');
  var arrDate = _g('vol-arr-date');
  var dh = _g('vol-dep-heure');
  var ah = _g('vol-arr-heure');

  var dateDep = depDate ? depDate+(dh?' · '+dh:'') : '';
  var dateArr = arrDate ? arrDate+(ah?' · '+ah:'') : '';

  var pdfId = _g('vol-pdf');

  var escales = typeof getEscalesForSave==='function' ? getEscalesForSave() : [];
  vols.push({id:uid(),titre:t,statut:_g('vol-statut')||'Confirmé',escales:escales,
    depCode:_g('vol-dep-code'),
    depVille:dep,
    arrCode:_g('vol-arr-code'),
    arrVille:arr,
    depDate:depDate, arrDate:arrDate,
    dateDep:dateDep, dateArr:dateArr,
    compagnie:_g('vol-compagnie'),
    numero:_g('vol-numero'),
    duree:_g('vol-duree'),
    resa:_g('vol-resa'),
    siege:_g('vol-siege'),
    pdfId:pdfId});

  ['vol-dep-code','vol-dep-ville','vol-arr-code','vol-arr-ville',
   'vol-compagnie','vol-numero','vol-duree','vol-resa','vol-siege',
   'vol-dep-heure','vol-arr-heure','vol-dep-date','vol-arr-date','vol-titre'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.value='';
  });
  ['vol-dep-jour','vol-arr-jour','vol-dep-mois','vol-arr-mois'].forEach(function(id){
    var el=document.getElementById(id);if(el)el.selectedIndex=0;
  });
  var prev = document.getElementById('vol-titre-preview');
  if(prev) prev.classList.remove('visible');
  if(typeof resetEscalesForm==='function') resetEscalesForm();
  var hid=document.getElementById('vol-pdf'); if(hid) hid.value='';
  var bEl=document.getElementById('vol-pdf-badge'); if(bEl) bEl.innerHTML='';

  if(document.getElementById('form-vol')) toggleForm('form-vol');
  renderVols();
  updateVolsSummary();
  snapshotCurrentTrip();
  showToast('Vol ajouté', 'success');
}
function deleteVol(id){id=isNaN(+id)?id:+id;
  vols=vols.filter(function(v){return v.id!=id;});
  closeModal();renderVols();snapshotCurrentTrip();
  showToast('Vol supprimé', 'info');
}

// ══════════════════════════════════════════
// PASSES
// ══════════════════════════════════════════
// [migrated to module — see header]
// ── Affiche/masque le bloc passes-pin-top selon qu'il y en a ──
function _updatePassesPinTop(){
  var pinTop=document.getElementById('passes-pin-top');
  if(!pinTop)return;
  var hasPasses = passes && passes.length > 0;
  pinTop.style.display = hasPasses ? '' : 'none';
  // Afficher/masquer le séparateur Trajets uniquement si des trajets existent aussi
  var trajetsSep = pinTop.querySelector('.trajets-section-header');
  if(trajetsSep) trajetsSep.style.display = (hasPasses && mobilites && mobilites.length) ? '' : 'none';
}

function renderPasses(){
  var el=document.getElementById('passes-list');
  if(!el) return;
  el.style.display='';
  if(!passes.length){
    el.innerHTML='<div class="empty-state"><div class="es-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28"><rect x="2" y="7" width="20" height="10" rx="2"/><path d="M2 12h20"/><circle cx="7" cy="12" r="1.5"/></svg></div><div class="es-title">Aucun pass enregistré</div><div class="es-sub">Ajoute ton JR Pass ou autre pass ferroviaire ci-dessous.</div><button class="es-cta" onclick="pickTransport(\'pass\')">+ Ajouter un pass</button></div>';
    return;
  }
  el.innerHTML=passes.map(function(p){
    var sc=p.statut==='Activé'?'badge-green':p.statut==='Non activé'?'badge-gold':'badge-muted';
    var avt=p.avantages?p.avantages.split(',').map(function(a){
      return '<span class="badge badge-sakura" style="margin-right:4px">'+a.trim()+'</span>';
    }).join(''):'';
    // Validité : utiliser le champ calculé ou reconstituer depuis debut/fin
    var validite = p.validite || (p.debut&&p.fin ? p.debut+' → '+p.fin : p.debut||'');
    // Badge PDF
    var pdfHtml = '';
    if(p.pdfId && window.pdfStore && window.pdfStore[p.pdfId]){
      var pname = window.pdfStore[p.pdfId].name;
      pdfHtml = '<div class="pass-pdf-row">'
        +'<button class="pdf-view-btn" data-pid="'+p.pdfId+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> '+pname+'</button>'
        +(emodes&&emodes.passes ? '<button class="pdf-del-btn" data-pid="'+p.pdfId+'" data-passid="'+p.id+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>' : '')
      +'</div>';
    }
    return '<div class="pass-card item-wrap epass" style="position:relative" data-detail-cat="pass" data-detail-id="'+p.id+'">'
      +'<div class="pass-title">'+p.nom+' <span class="badge '+sc+'">'+p.statut+'</span></div>'
      +(validite?'<div class="pass-info">'+validite+(p.numero?' · N° <span class="copyable" data-copy="'+(p.numero+'').replace(/"/g,'&quot;')+'">'+p.numero+'</span>':'')+(p.prix?' · '+p.prix+' €':'')+'</div>':'')
      +(p.numero&&!validite?'<div class="pass-info">N° <span class="copyable" data-copy="'+(p.numero+'').replace(/"/g,'&quot;')+'">'+p.numero+'</span>'+(p.prix?' · '+p.prix+' €':'')+'</div>':'')
      +(!validite&&!p.numero&&p.prix?'<div class="pass-info">'+p.prix+' €</div>':'')
      +(p.zone?'<div class="pass-info" style="color:var(--teal)">'+p.zone+'</div>':'')
      +(p.note?'<div class="pass-note">'+p.note+'</div>':'')
      +'<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">'+avt+'</div>'
      +pdfHtml
      +'<button class="edit-item-btn" data-act="editPass" data-id="'+p.id+'"></button>'
    +'</div>';
  }).join('');
  // Listeners PDF
  el.querySelectorAll('.pdf-view-btn[data-pid]').forEach(function(btn){
    btn.addEventListener('click',function(){ openPdf(this.getAttribute('data-pid')); });
  });
  el.querySelectorAll('.pdf-del-btn[data-passid]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var pid=this.getAttribute('data-pid');
      var passid=parseInt(this.getAttribute('data-passid'));
      var p=passes.find(function(x){return x.id==passid;});
      if(p&&confirm('Supprimer ce PDF ?')){
        if(window.pdfStore) delete window.pdfStore[pid];
        p.pdfId=null; renderPasses(); snapshotCurrentTrip();
      }
    });
  });
}
function editPass(id){id=isNaN(+id)?id:+id;
  var p=passes.find(function(x){return x.id==id;});if(!p)return;
  openModal(
    '<div class="modal-header"><div class="modal-title">Modifier ce pass</div><button class="modal-close" onclick="closeModal()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>'
    +'<div class="modal-row">'
      +modalField('Nom du pass',mInput('ep-nom',p.nom,'JR Pass 30 jours','width:100%'))
      +mSelect('ep-statut',['Activé','Non activé','En transit'],p.statut)
    +'</div>'
    +'<div class="modal-row">'
      +modalField('Date début',mInput('ep-debut',p.debut||'','JJ/MM/AAAA'))
      +modalField('Date fin',mInput('ep-fin',p.fin||'','JJ/MM/AAAA'))
      +modalField('Prix (€)',mInput('ep-prix',p.prix||'','ex: 350','max-width:90px'))
    +'</div>'
    +'<div class="modal-row">'
      +modalField('N° de pass',mInput('ep-numero',p.numero||'','JR-XXXXX'))
      +modalField('Zone de validité',mInput('ep-zone',p.zone||'','ex: Toute la Corée, Kansai…','flex:1.5'))
    +'</div>'
    +'<div class="modal-row"><div class="modal-field w-full"><label>Notes</label>'
      +'<textarea id="ep-note" rows="2" style="width:100%;resize:vertical;font-size:13px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--r-sm);font-family:DM Sans,sans-serif">'+((p.note)||'')+'</textarea>'
    +'</div></div>'
    +mPdfBlock('ep-pdf', p.pdfId||'')
    +modalFooter('savePass(\''+id+'\')','deletePass(\''+id+'\')',{type:'le pass',libelle:p.nom||'',hasDoc:!!p.pdfId,fn:'deletePass',id:id})
  );
}
function savePass(id){id=isNaN(+id)?id:+id;
  var p=passes.find(function(x){return x.id==id;});if(!p)return;
  p.nom    =document.getElementById('ep-nom').value||p.nom;
  p.statut =document.getElementById('ep-statut').value;
  p.debut  =document.getElementById('ep-debut').value;
  p.fin    =document.getElementById('ep-fin').value;
  p.prix   =document.getElementById('ep-prix').value;
  p.numero =document.getElementById('ep-numero').value;
  p.zone   =(document.getElementById('ep-zone')||{}).value||'';
  p.note   =(document.getElementById('ep-note')||{}).value||'';
  var epPdf=document.getElementById('ep-pdf');
  if(epPdf) p.pdfId=epPdf.value;
  p.validite=p.debut&&p.fin?p.debut+' → '+p.fin:(p.debut?p.debut+' →':'');
  closeModal();renderPasses();_updatePassesPinTop();snapshotCurrentTrip();
}
// addPass est maintenant géré directement dans addMobilite (type 'pass')
// Cette fonction est conservée pour compatibilité mais ne devrait plus être appelée directement
function addPass(){
  // Déléguer à addMobilite si le type est bien 'pass'
  var typeEl=document.getElementById('mob-type');
  if(typeEl&&typeEl.value==='pass'){
    addMobilite();
  }
}
function deletePass(id){id=isNaN(+id)?id:+id;
  passes=passes.filter(function(p){return p.id!=id;});
  closeModal();renderPasses();_updatePassesPinTop();snapshotCurrentTrip();
}

// ══════════════════════════════════════════
// TRAINS
// ══════════════════════════════════════════
// [migrated to module — see header]
function renderTrains(){
  var el=document.getElementById('trains-list');
  if(!el) return; // trains-list no longer in main HTML (legacy compat only)
  el.style.display='';
  if(!trains.length){el.innerHTML='<div class="empty-state"><div class="es-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 17 Q5 10 12 10 L21 10 Q22 11 22 13 L22 17 Q22 19 21 19 L2 19 Z"/><circle cx="7" cy="21" r="1.8"/><circle cx="17" cy="21" r="1.8"/></svg></div><div class="es-title">Aucun trajet enregistré</div><div class="es-sub">Planifie tes connexions en train, Shinkansen ou autre.</div><button class="es-cta" onclick="toggleForm(\'form-train\')">+ Ajouter un trajet</button></div>';return;}
  el.innerHTML=trains.map(function(t){
    var bc=t.statut==='Réservé'?'badge-sakura':'badge-gold';
    return '<div class="train-item item-wrap etrain">'
      +'<div class="tdate-badge"><div class="tdate-day">'+(t.jour||'—')+'</div><div class="tdate-month">'+(t.mois?t.mois.toUpperCase():'')+'</div></div>'
      +'<div class="train-info">'
        +'<div class="train-route">'+t.route+'</div>'
        +'<div class="train-detail">'+(t.train?t.train+' · ':'')+(t.dep?'Départ '+t.dep:'')+(t.arr?' · Arrivée '+t.arr:'')+(t.duree?' · <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" width="10" height="10" style="vertical-align:-1px"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/></svg> '+t.duree:'')+'</div>'
        +(t.siege?'<div class="train-detail">Siège '+t.siege+(t.voiture?' · Voiture '+t.voiture:'')+'</div>':'')
      +'</div>'
      +'<span class="badge '+bc+'">'+t.statut+'</span>'
      +'<button class="edit-item-btn" data-act="editTrain" data-id="'+t.id+'" style="right:4px"></button>'
    +'</div>';
  }).join('');
}
function editTrain(id){id=isNaN(+id)?id:+id;
  var t=trains.find(function(x){return x.id==id;});if(!t)return;
  // Détecter la compagnie pour afficher l'icône dans la modal
  var railComp = typeof _detectRailCompany==='function' ? _detectRailCompany(t.train||'') : null;
  var compBadge = railComp
    ? '<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;'
      +'color:'+railComp.color+';background:'+railComp.color+'18;border:1px solid '+railComp.color+'44;'
      +'border-radius:20px;padding:3px 10px;margin-left:6px">'
      +'<span style="width:16px;height:16px;display:inline-flex;align-items:center;color:'+railComp.color+'">'
      +railComp.icon+'</span>'+railComp.abbr+'</span>'
    : '';
  openModal(
    '<div class="modal-header"><div class="modal-title">Modifier ce trajet'+compBadge+'</div><button class="modal-close" onclick="closeModal()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>'
    +'<div class="modal-row">'
      +modalField('Trajet',mInput('et-route',t.route,'Tokyo → Kyoto'))
      +mSelect('et-statut',['Réservé','À réserver','En attente'],t.statut)
    +'</div>'
    +'<div class="modal-row">'
      +mDateRow('Date du trajet','et-jour','et-mois',t.jour,t.mois)
      +modalField('Train / Compagnie',mInput('et-train',t.train,'Nozomi 7, SNCF…'))
    +'</div>'
    +'<div class="modal-row">'
      +modalField('Heure départ',mInput('et-dep',t.dep,'09h30'))
      +modalField('Heure arrivée',mInput('et-arr',t.arr,'12h10'))
      +modalField('Siège',mInput('et-siege',t.siege,'15C'))
      +modalField('Voiture',mInput('et-voiture',t.voiture,'5'))
    +'</div>'
    // PDF — accessible en mode modification
    +mPdfBlock('et-pdf', t.pdfId||'')
    +modalFooter('saveTrain(\''+id+'\')','deleteTrain(\''+id+'\')',{type:'le trajet',libelle:t.route||(t.dep&&t.arr?t.dep+' → '+t.arr:''),hasDoc:!!t.pdfId,fn:'deleteTrain',id:id})
  );
}
function saveTrain(id){id=isNaN(+id)?id:+id;
  var idx=trains.findIndex(function(x){return x.id==id;});if(idx===-1)return;
  // Copie profonde — aucune référence partagée avec d'autres objets
  var t=JSON.parse(JSON.stringify(trains[idx]));
  var _gv=function(eid){var e=document.getElementById(eid);return e?e.value:'';};
  t.route  =_gv('et-route')||t.route;
  t.statut =_gv('et-statut');
  t.jour   =_gv('et-jour');
  t.mois   =_gv('et-mois');
  t.train  =_gv('et-train');
  t.dep    =_gv('et-dep');
  t.arr    =_gv('et-arr');
  t.siege  =_gv('et-siege');
  t.voiture=_gv('et-voiture');
  // Recalcul durée
  if(t.dep&&t.arr){var dm=parseHM(t.dep),am=parseHM(t.arr);if(dm!==null&&am!==null){var df=am-dm;if(df<=0)df+=1440;t.duree=formatMinutes(df);}}
  // PDF — accepte nouveau fichier OU conserve l'ancien
  var etPdf=document.getElementById('et-pdf'); if(etPdf) t.pdfId=etPdf.value;
  // Reconstruction date canonique JJ/MM/AAAA pour le tri chronologique
  if(t.jour&&t.mois){
    var MOIS_NUM={'jan':1,'fev':2,'fév':2,'mar':3,'avr':4,'mai':5,'juin':6,
      'juil':7,'aou':8,'aoû':8,'sep':9,'oct':10,'nov':11,'dec':12,'déc':12};
    var mn=MOIS_NUM[t.mois.toLowerCase().slice(0,3)];
    if(mn){
      var jj=parseInt(t.jour)||1;
      var yy=new Date().getFullYear();
      t.date=(jj<10?'0'+jj:jj)+'/'+(mn<10?'0'+mn:mn)+'/'+yy;
    }
  }
  // Remplacement atomique
  trains[idx]=t;
  closeModal();renderTrains();snapshotCurrentTrip();
}
function addTrain(){
  var _g=function(id){var e=document.getElementById(id);return e?e.value:'';};
  var r=_g('tr-route').trim();
  if(!r){
    var dv=document.getElementById('tr-dep-ville');
    var av=document.getElementById('tr-arr-ville');
    if(dv&&av&&(dv.value||av.value)) r=(dv.value||'?')+' → '+(av.value||'?');
  }
  if(!r)return;
  var pdfId = document.getElementById('train-pdf') ? document.getElementById('train-pdf').value : '';
  var _trJour=_g('tr-jour'), _trMois=_g('tr-mois');
  // Construire la date canonique JJ/MM/AAAA pour tri chronologique cohérent
  var _trDateCanon='';
  if(_trJour&&_trMois){
    var _MOIS_NUM={'jan':1,'fev':2,'fév':2,'mar':3,'avr':4,'mai':5,'juin':6,
      'juil':7,'aou':8,'aoû':8,'sep':9,'oct':10,'nov':11,'dec':12,'déc':12};
    var _mn=_MOIS_NUM[_trMois.toLowerCase().slice(0,3)];
    if(_mn){var _jj=parseInt(_trJour)||1;var _yy=new Date().getFullYear();
      _trDateCanon=(_jj<10?'0'+_jj:_jj)+'/'+(_mn<10?'0'+_mn:_mn)+'/'+_yy;}
  }
  // Aussi lire le champ date unifié (mob-date / tr-date) si présent
  var _trDateRaw=document.getElementById('tr-date')?document.getElementById('tr-date').value:'';
  if(_trDateRaw&&!_trDateCanon) _trDateCanon=_trDateRaw;
  trains.push({id:uid(),route:r,statut:_g('tr-statut')||'Réservé',
    jour:_trJour,mois:_trMois,date:_trDateCanon,
    train:_g('tr-train'),dep:_g('tr-dep'),
    arr:_g('tr-arr'),duree:_g('tr-duree'),
    siege:_g('tr-siege'),voiture:_g('tr-voiture'),
    pdfId:pdfId});
  ['tr-route','tr-train','tr-dep','tr-arr','tr-duree','tr-siege','tr-voiture'].forEach(function(id){
    var el=document.getElementById(id);if(el)el.value='';
  });
  var hid=document.getElementById('train-pdf'); if(hid) hid.value='';
  var bEl=document.getElementById('train-pdf-badge'); if(bEl) bEl.innerHTML='';
  ['tr-jour','tr-mois'].forEach(function(id){var el=document.getElementById(id);if(el)el.selectedIndex=0;});
  if(document.getElementById('form-train')) toggleForm('form-train');
  renderTrains();snapshotCurrentTrip();
  showToast('Train ajouté', 'success');
}
function deleteTrain(id){id=isNaN(+id)?id:+id;
  trains=trains.filter(function(t){return t.id!=id;});
  closeModal();renderTrains();snapshotCurrentTrip();
}

// ── Patch addTrain pour utiliser nouveaux champs (calendrier + villes) ──
(function(){
  var _orig = addTrain;
  addTrain = function(){
    var dep=document.getElementById('tr-dep-ville')?document.getElementById('tr-dep-ville').value.trim():'';
    var arr=document.getElementById('tr-arr-ville')?document.getElementById('tr-arr-ville').value.trim():'';
    var route=document.getElementById('tr-route')?document.getElementById('tr-route').value.trim():'';
    if(!route) route=(dep||'?')+' → '+(arr||'?');
    var dateRaw=document.getElementById('tr-date')?document.getElementById('tr-date').value:'';
    var trJour=document.getElementById('tr-jour');
    var trMois=document.getElementById('tr-mois');
    if(dateRaw&&trJour&&trMois){
      var dp=parseDDMMYYYY(dateRaw);
      if(dp){
        if(!trJour.options.length){ buildJourSelect('tr-jour',''); }
        if(!trMois.options.length){ buildMoisSelect('tr-mois',''); }
        trJour.value=dp.getDate();
        trMois.value=MOIS_SHORT[dp.getMonth()];
      }
    }
    var routeEl=document.getElementById('tr-route'); if(routeEl) routeEl.value=route;
    _orig();
    ['tr-dep-ville','tr-arr-ville'].forEach(function(id){
      var el=document.getElementById(id); if(el) el.value='';
    });
    var dateEl=document.getElementById('tr-date'); if(dateEl) dateEl.value='';
    var depEl=document.getElementById('tr-dep'); if(depEl) depEl.value='';
    var arrEl=document.getElementById('tr-arr'); if(arrEl) arrEl.value='';
    var dDisp=document.getElementById('tr-duree-display'); if(dDisp) dDisp.textContent='—';
  };
})();

// ══════════════════════════════════════════════════════════════════
// MOBILITÉ — Section unifiée (Vols, Trains, Bus, Bateau, Covoiturage)
// ══════════════════════════════════════════════════════════════════
// [migrated to module — see header]

// ── Icônes, labels et couleurs par type ──
// Set « silhouette pleine » (Phase I) — inspiré des pictogrammes de
// transport classiques fournis en référence : remplissage solide,
// formes reconnaissables d'un coup d'œil, grille 24px commune.
var MOB_ICONS = {
  vol:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="19" height="19"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>',
  train:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="19" height="19"><path d="M8 4v3a4 4 0 0 0 8 0V4"/><path d="M9 18.5A5 5 0 0 1 4 13.5v-3a8 8 0 0 1 16 0v3a5 5 0 0 1-5 5z"/><circle cx="9.2" cy="13.4" r="1" fill="currentColor" stroke="none"/><circle cx="14.8" cy="13.4" r="1" fill="currentColor" stroke="none"/><path d="m8 18.5-2 3"/><path d="m16 18.5 2 3"/></svg>',
  bus:'<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" width="18" height="18"><path d="M6 2.8h12a2.5 2.5 0 012.5 2.5V16a2 2 0 01-1.3 1.9l1.3 2.4a.65.65 0 01-1.15.6L18 18.2H6l-1.4 2.7a.65.65 0 01-1.15-.6l1.3-2.4A2 2 0 013.5 16V5.3A2.5 2.5 0 016 2.8zm-.5 4V11h13V6.8h-13zM7.5 15.5a1.2 1.2 0 100-2.4 1.2 1.2 0 000 2.4zm9 0a1.2 1.2 0 100-2.4 1.2 1.2 0 000 2.4z"/></svg>',
  bateau:'<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" width="18" height="18"><path d="M11 2.6h2v1.6h2.5a1 1 0 011 1V9l3 .9a1 1 0 01.68 1.23l-1.43 5A2 2 0 0117.83 17H6.17a2 2 0 01-1.92-1.45l-1.43-5A1 1 0 013.5 9.3L6.5 8.4V5.2a1 1 0 011-1H11V2.6zM8.5 6.2v1.6L12 6.8l3.5 1V6.2h-7z"/><path d="M2.5 19.2q2.3 1.8 4.75 0t4.75 0 4.75 0 4.75 0v1.9q-2.3 1.8-4.75 0t-4.75 0-4.75 0-4.75 0v-1.9z"/></svg>',
  covoiturage:'<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" width="18" height="18"><path d="M5 11l1.5-4.2A2 2 0 018.4 5.5h7.2a2 2 0 011.9 1.3L19 11h.5a1.5 1.5 0 011.5 1.5V16a1 1 0 01-1 1h-1v1.3a1.2 1.2 0 01-2.4 0V17H7.4v1.3a1.2 1.2 0 01-2.4 0V17H4a1 1 0 01-1-1v-3.5A1.5 1.5 0 014.5 11H5zm2.2-.4h9.6l-1-2.8a.6.6 0 00-.6-.4H8.8a.6.6 0 00-.6.4l-1 2.8zM6.5 14.5a1.1 1.1 0 100-2.2 1.1 1.1 0 000 2.2zm11 0a1.1 1.1 0 100-2.2 1.1 1.1 0 000 2.2z"/></svg>',
  metro:'<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" width="18" height="18"><path d="M12 2.5c-4 0-7 .8-7 4.2V15a3 3 0 003 3h.3l-1.8 2.8a.65.65 0 001.1.7L9 19h6l1.4 2.5a.65.65 0 001.1-.7L15.7 18h.3a3 3 0 003-3V6.7c0-3.4-3-4.2-7-4.2zM6.5 7h11v4h-11V7zm2 8.4a1.2 1.2 0 100-2.4 1.2 1.2 0 000 2.4zm7 0a1.2 1.2 0 100-2.4 1.2 1.2 0 000 2.4z"/><path d="M9.2 11.5L12 14l2.8-2.5h-1.9V7h-1.8v4.5H9.2z" fill="var(--surface,#fff)"/></svg>',
  taxi:'<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" width="18" height="18"><path d="M9.6 2.6h4.8a1 1 0 011 1v.9h.2a2 2 0 011.9 1.3L19 10h.5A1.5 1.5 0 0121 11.5V15a1 1 0 01-1 1h-1v1.3a1.2 1.2 0 01-2.4 0V16H7.4v1.3a1.2 1.2 0 01-2.4 0V16H4a1 1 0 01-1-1v-3.5A1.5 1.5 0 014.5 10H5l1.5-4.2a2 2 0 011.9-1.3h.2v-.9a1 1 0 011-1zm.4 2v.9h4v-.9h-4zM7.2 9.6h9.6l-1-2.8a.6.6 0 00-.6-.4H8.8a.6.6 0 00-.6.4l-1 2.8zM6.5 13.5a1.1 1.1 0 100-2.2 1.1 1.1 0 000 2.2zm11 0a1.1 1.1 0 100-2.2 1.1 1.1 0 000 2.2z"/></svg>',
  pass:'Pass'
};
var MOB_LABELS = {
  vol:'Vol', train:'Train', bus:'Bus / Car', bateau:'Bateau / Ferry',
  covoiturage:'Covoiturage', metro:'Métro / RER', taxi:'Taxi / VTC', pass:'Pass'
};
var MOB_COLORS = {
  vol:'#c2607f', train:'#4264d0', bus:'#2d8c6b', bateau:'#2d8c8c',
  covoiturage:'#c9921a', metro:'#7c5cbf', taxi:'#c9921a', pass:'#5c6bc0'
};
var MOB_STATUT_OK = ['Confirmé','Réservé','Activé'];

// ── Groupes de champs par type ──
var MOB_GROUPS = {
  vol:         'mob-group-vol',
  train:       'mob-group-train',
  bateau:      'mob-group-bateau',
  bus:         'mob-group-autre',
  covoiturage: 'mob-group-autre',
  metro:       'mob-group-autre',
  taxi:        'mob-group-autre',
  pass:        'mob-group-pass'
};
var MOB_AUTRE_SEPS = {
  bus:'Informations du trajet', covoiturage:'Informations du covoiturage',
  metro:'Informations du trajet', taxi:'Informations de la course'
};
var _allMobGroups = ['mob-group-vol','mob-group-train','mob-group-bateau','mob-group-autre','mob-group-pass'];

// ── Sélection de type via chips ──
window.setMobType = function(type, chipBtn){
  // Mettre à jour la valeur cachée
  var hidEl=document.getElementById('mob-type');
  if(hidEl) hidEl.value=type;

  // Chips : activer/désactiver
  document.querySelectorAll('.mob-chip').forEach(function(c){ c.classList.remove('active'); });
  if(chipBtn) chipBtn.classList.add('active');

  // Titre du formulaire
  var title=document.getElementById('mob-form-title');
  if(title) title.textContent='Ajouter — '+(MOB_LABELS[type]||'Trajet');

  // Masquer tous les groupes
  _allMobGroups.forEach(function(gid){
    var g=document.getElementById(gid);
    if(g) g.style.display='none';
  });

  // Afficher le bon groupe
  var targetGroup=MOB_GROUPS[type];
  if(targetGroup){
    var g=document.getElementById(targetGroup);
    if(g) g.style.display='';
    // Personnaliser le séparateur pour "autre"
    if(targetGroup==='mob-group-autre'){
      var sep=document.getElementById('mob-group-autre-sep');
      if(sep) sep.textContent=MOB_AUTRE_SEPS[type]||'Informations du trajet';
    }
  }

  // Escales : uniquement pour vol
  var escSection=document.querySelector('.mob-escale-section');
  if(escSection) escSection.style.display=(type==='vol')?'':'none';

  // Statut/preview : masqué pour pass (le pass a son propre statut)
  var statutRow=document.getElementById('mob-statut-row');
  if(statutRow) statutRow.style.display=(type==='pass')?'none':'';

  // Note : masquée pour pass (la row des boutons Ajouter/Annuler reste toujours visible)
  var noteRow=document.getElementById('mob-note-row');
  if(noteRow) noteRow.style.display=(type==='pass')?'none':'';

  updateMobPreview();
};

// Alias pour compatibilité avec l'ancienne fonction
function onMobTypeChange(){
  var typeEl=document.getElementById('mob-type');
  if(!typeEl)return;
  var chip=document.querySelector('.mob-chip[data-type="'+typeEl.value+'"]');
  setMobType(typeEl.value, chip);
}

// La durée totale du vol/trajet est désormais SAISIE MANUELLEMENT (champ #mob-duree) :
// elle ne peut pas être calculée depuis les horaires à cause du décalage horaire
// (ex. Paris 20h → Taipei affiché 8h = 16h réelles). Aucun auto-calc de durée.

// ══════════════════════════════════════════════════════════════════
// FORMULAIRE VOL — ESCALES DYNAMIQUES (N escales → N+1 segments)
// Case escale cochée : le bloc du haut devient « Segment 1 » (origine →
// 1re escale), puis pour chaque escale j : un bloc Escale j (aéroport +
// durée) et un bloc SEG. j+1. La destination finale est dans le dernier
// segment. Aéroport d'escale saisi une seule fois (pas de double saisie).
// ══════════════════════════════════════════════════════════════════
var _mobEscCount = 1;
var MOB_ESC_MAX = 3;
var _mobEditId = null; // id du vol en cours d'édition via le formulaire unifié (null = création)

function toggleMobEscales(){
  var on = !!((document.getElementById('mob-escale-check')||{}).checked);
  var wrap = document.getElementById('mob-escales-wrap');
  if(wrap) wrap.style.display = on ? '' : 'none';
  var title    = document.getElementById('mob-vol-seg1-title');
  var direct   = document.getElementById('mob-direct-details');
  var arrLabel = document.getElementById('mob-arr-label');
  var hdepLbl  = document.getElementById('mob-hdep-label');
  var harrLbl  = document.getElementById('mob-harr-label');
  if(on){
    // Origine + destination finale + horaires d'extrémité RESTENT en haut
    // (source unique). Les infos par vol se saisissent dans chaque segment.
    if(title)    title.textContent = 'Trajet global';
    if(direct)   direct.style.display = 'none';
    if(arrLabel) arrLabel.textContent = 'Destination finale';
    if(hdepLbl)  hdepLbl.textContent = 'Décollage initial';
    if(harrLbl)  harrLbl.textContent = 'Arrivée finale';
    if(_mobEscCount < 1) _mobEscCount = 1;
    _renderMobEscBlocks();
  } else {
    if(title)    title.textContent = 'Informations du vol';
    if(direct)   direct.style.display = '';
    if(arrLabel) arrLabel.textContent = 'Arrivée';
    if(hdepLbl)  hdepLbl.textContent = 'Décollage';
    if(harrLbl)  harrLbl.textContent = 'Atterrissage';
    var dyn = document.getElementById('mob-escales-dyn');
    if(dyn) dyn.innerHTML = '';
  }
}

function mobEscCount(d){
  var prev = _mobEscCount;
  _mobEscCount = Math.max(1, Math.min(MOB_ESC_MAX, _mobEscCount + d));
  if(_mobEscCount !== prev) _renderMobEscBlocks();
}

// Snapshot/restore des valeurs saisies (pour ne rien perdre au changement de compteur)
function _mobSnapshotDyn(){
  // On saute les champs en lecture seule (horaires d'extrémité propagés) : ils
  // seront re-reportés depuis le haut sur le bon segment après le re-render.
  var m = {}, dyn = document.getElementById('mob-escales-dyn');
  if(dyn) dyn.querySelectorAll('input').forEach(function(i){ if(i.id && !i.readOnly) m[i.id] = i.value; });
  return m;
}
function _mobRestoreDyn(m){
  Object.keys(m).forEach(function(id){ var e = document.getElementById(id); if(e) e.value = m[id]; });
}

function _renderMobEscBlocks(){
  var n = _mobEscCount;
  var cv = document.getElementById('mob-esc-count-val');
  if(cv) cv.textContent = n + ' escale' + (n>1?'s':'');
  var dyn = document.getElementById('mob-escales-dyn');
  if(!dyn) return;
  var snap = _mobSnapshotDyn();
  // Chaîne : SEG.1, puis pour chaque escale j : bloc Escale j + bloc SEG. j+1.
  // N escales → N+1 segments, tous symétriques et complets.
  var h = _mobSegBlockHTML(1);
  for(var j=1;j<=n;j++){
    h += _mobEscBlockHTML(j);
    h += _mobSegBlockHTML(j+1);
  }
  dyn.innerHTML = h;
  _mobRestoreDyn(snap);
  _mobWireEscAC();
  _mobUpdateSegRoutes();
  _mobPropagateEndTimes();
}

// Auto-remplissage des horaires d'EXTRÉMITÉ (source unique = bloc du haut) :
//  - décollage du SEG.1  ← heure de décollage initiale (haut)
//  - atterrissage du dernier SEG ← heure d'arrivée finale (haut)
// Ces deux champs sont en lecture seule dans les segments (pas de double
// saisie). Les horaires intermédiaires restent éditables. Se re-reporte
// automatiquement sur le nouveau dernier segment au changement de compteur.
function _mobPropagateEndTimes(){
  var n = _mobEscCount;
  var topDep = (document.getElementById('mob-heure-dep')||{}).value || '';
  var topArr = (document.getElementById('mob-heure-arr')||{}).value || '';
  // Réinitialiser l'état lecture seule de tous les horaires de segment
  for(var k=1;k<=n+1;k++){
    var hd = document.getElementById('mseg-'+k+'-hdep');
    var ha = document.getElementById('mseg-'+k+'-harr');
    if(hd){ hd.readOnly=false; hd.classList.remove('mob-seg-inherited'); hd.removeAttribute('title'); }
    if(ha){ ha.readOnly=false; ha.classList.remove('mob-seg-inherited'); ha.removeAttribute('title'); }
  }
  // SEG.1 décollage = décollage initial (haut)
  var s1 = document.getElementById('mseg-1-hdep');
  if(s1){ s1.value=topDep; s1.readOnly=true; s1.classList.add('mob-seg-inherited'); s1.title='Repris du décollage initial (en haut)'; }
  // Dernier segment atterrissage = arrivée finale (haut)
  var last = document.getElementById('mseg-'+(n+1)+'-harr');
  if(last){ last.value=topArr; last.readOnly=true; last.classList.add('mob-seg-inherited'); last.title='Repris de l\'arrivée finale (en haut)'; }
}

// ── CRUD vol : lecture du formulaire → modèle escales[] ──
// Remplit les champs vol de m (codes déjà posés en amont). En mode escale :
//   - SEG.1 (racine) : infos depuis le bloc dynamique SEG.1
//   - m.escales[j-1] : escale j (aéroport+durée) + segment j+1 (qui en part)
//   - heureDep/heureArr de m = horaires d'extrémité (déjà lus depuis le haut)
// En mode direct : escales:[] et les infos racine (déjà lues) sont conservées.
// Base locale aéroports (code IATA → {lat,lng}), offline. Sert à GELER les
// coordonnées d'un vol à l'enregistrement pour figer la position (pas de
// re-géocodage). AIRPORTS_GPS est chargé avant app.js ; garde défensive.
function _airportGpsApp(code){
  if(!code || typeof AIRPORTS_GPS==='undefined') return null;
  var g = AIRPORTS_GPS[String(code).toUpperCase().trim()];
  return (g && g.length===2) ? { lat:g[0], lng:g[1] } : null;
}
// Gèle origine + destination finale d'un vol depuis leurs codes IATA (codeDep/
// codeArr). Nettoie les champs si le code est inconnu (repli tracé = géocodage).
function _freezeVolRootGps(m){
  var d = _airportGpsApp(m.codeDep), a = _airportGpsApp(m.codeArr);
  if(d){ m.latDep=d.lat; m.lngDep=d.lng; } else { delete m.latDep; delete m.lngDep; }
  if(a){ m.latArr=a.lat; m.lngArr=a.lng; } else { delete m.latArr; delete m.lngArr; }
}

function _readVolEscalesInto(m){
  function segv(k,f){ return (document.getElementById('mseg-'+k+'-'+f)||{}).value || ''; }
  function escv(j,f){ return (document.getElementById('mesc-'+j+'-'+f)||{}).value || ''; }
  m._volV2 = true;
  if(m.segment2) delete m.segment2; // le modèle escales[] remplace segment2
  var on = !!((document.getElementById('mob-escale-check')||{}).checked);
  if(!on){
    m.escales = [];
    m.dureeVol = '';
    return;
  }
  var n = (typeof _mobEscCount==='number' && _mobEscCount>0) ? _mobEscCount : 1;
  // SEG.1 → racine (écrase les champs racine, vides en mode escale)
  m.compagnie = segv(1,'compagnie');
  m.numero    = segv(1,'numero');
  m.siege     = segv(1,'siege');
  m.terminal  = segv(1,'terminal');
  m.porte     = segv(1,'porte');
  m.resa      = segv(1,'resa');
  m.bagages   = segv(1,'bagages');
  m.dureeVol  = segv(1,'duree'); // durée du SEG.1 (optionnelle)
  m.escales = [];
  for(var j=1;j<=n;j++){
    // Gel des coordonnées de l'escale depuis son code IATA (base locale, offline).
    var _eg = _airportGpsApp(escv(j,'code'));
    m.escales.push({
      aeroport      : escv(j,'airport'),
      code          : escv(j,'code'),
      lat: (_eg?_eg.lat:null), lng: (_eg?_eg.lng:null),
      dureeEscale   : escv(j,'duree'),
      heureArrEscale: segv(j,'harr'),      // arrivée du SEG.j à l'escale j
      heureDep      : segv(j+1,'hdep'),    // départ du SEG.(j+1)
      dureeVol      : segv(j+1,'duree'),
      compagnie     : segv(j+1,'compagnie'),
      numero        : segv(j+1,'numero'),
      siege         : segv(j+1,'siege'),
      terminal      : segv(j+1,'terminal'),
      porte         : segv(j+1,'porte'),
      resa          : segv(j+1,'resa'),
      bagages       : segv(j+1,'bagages')
    });
  }
}

// ── CRUD vol : modèle escales[] → repeuplement du formulaire (édition) ──
function _fillVolEscalesForm(m){
  var chk = document.getElementById('mob-escale-check');
  var esc = (m && m.escales) ? m.escales : [];
  if(!esc.length){
    if(chk){ chk.checked = false; }
    _mobEscCount = 1;
    toggleMobEscales();
    return;
  }
  if(chk){ chk.checked = true; }
  _mobEscCount = Math.max(1, Math.min(MOB_ESC_MAX, esc.length));
  toggleMobEscales();           // rend les blocs (SEG.1 + escales/segments)
  // Horaires d'extrémité (haut) : déjà posés via mob-heure-dep/arr par l'appelant.
  function segset(k,f,val){ var e=document.getElementById('mseg-'+k+'-'+f); if(e) e.value = val||''; }
  function escset(j,f,val){ var e=document.getElementById('mesc-'+j+'-'+f); if(e) e.value = val||''; }
  // SEG.1 (racine)
  segset(1,'compagnie', m.compagnie); segset(1,'numero', m.numero);
  segset(1,'siege', m.siege); segset(1,'terminal', m.terminal);
  segset(1,'porte', m.porte); segset(1,'resa', m.resa);
  segset(1,'bagages', m.bagages); segset(1,'duree', m.dureeVol);
  for(var j=1;j<=_mobEscCount;j++){
    var e = esc[j-1] || {};
    escset(j,'airport', e.aeroport); escset(j,'code', e.code); escset(j,'duree', e.dureeEscale);
    segset(j,'harr', e.heureArrEscale);          // arrivée SEG.j à l'escale j
    segset(j+1,'hdep', e.heureDep);              // départ SEG.(j+1)
    segset(j+1,'duree', e.dureeVol);
    segset(j+1,'compagnie', e.compagnie); segset(j+1,'numero', e.numero);
    segset(j+1,'siege', e.siege); segset(j+1,'terminal', e.terminal);
    segset(j+1,'porte', e.porte); segset(j+1,'resa', e.resa); segset(j+1,'bagages', e.bagages);
  }
  _mobUpdateSegRoutes();
  _mobPropagateEndTimes();      // ré-applique décollage SEG.1 / atterrissage dernier depuis le haut
}

// ══════════════════════════════════════════════════════════════════
// LECTEURS — chaîne d'un vol (source unique pour carte-item, carte géo,
// timeline). Dérive du modèle escales[] la liste ordonnée des aéroports
// [origine, escale1..N, destination], des N+1 segments et des N escales.
// Rétro-compat : si escales[] vide mais segment2 présent (vol non migré),
// on reconstruit à la volée sans muter m.
// ══════════════════════════════════════════════════════════════════
function _volChain(m){
  var esc = (m && m.escales && m.escales.length) ? m.escales : null;
  var finalName=m.arr||'', finalCode=m.codeArr||'', finalHeureArr=m.heureArr||'';
  if(!esc && m && m.segment2 && (m.segment2.dep||m.segment2.arr)){
    var s2=m.segment2;
    esc=[{ aeroport:s2.dep||'', code:s2.codeDep||'', lat:(typeof s2.lat==='number'?s2.lat:null), lng:(typeof s2.lng==='number'?s2.lng:null),
           dureeEscale:s2.dureeEscale||'', heureArrEscale:m.heureArr||'', heureDep:s2.heureDep||'', dureeVol:s2.dureeVol||'',
           compagnie:s2.compagnie||'', numero:s2.numero||'', siege:s2.siege||'' }];
    finalName=s2.arr||m.arr||''; finalCode=s2.codeArr||m.codeArr||''; finalHeureArr=s2.heureArr||m.heureArr||'';
  }
  esc = esc || [];
  var n = esc.length;
  var airports=[{ name:m.dep||'', code:m.codeDep||'',
    lat:(typeof m.latDep==='number'?m.latDep:null), lng:(typeof m.lngDep==='number'?m.lngDep:null) }];
  for(var j=0;j<n;j++){
    airports.push({ name:esc[j].aeroport||'', code:esc[j].code||'',
      lat:(typeof esc[j].lat==='number'?esc[j].lat:null), lng:(typeof esc[j].lng==='number'?esc[j].lng:null) });
  }
  airports.push({ name:finalName, code:finalCode,
    lat:(typeof m.latArr==='number'?m.latArr:null), lng:(typeof m.lngArr==='number'?m.lngArr:null) });
  var segments=[];
  for(var k=0;k<=n;k++){
    var sg;
    if(k===0){
      sg={ compagnie:m.compagnie||'', numero:m.numero||'', siege:m.siege||'',
           heureDep:m.heureDep||'', heureArr:(n>0?(esc[0].heureArrEscale||''):finalHeureArr) };
    } else {
      var e=esc[k-1];
      sg={ compagnie:e.compagnie||'', numero:e.numero||'', siege:e.siege||'',
           heureDep:e.heureDep||'', heureArr:(k<n?(esc[k].heureArrEscale||''):finalHeureArr) };
    }
    sg.fromLabel=airports[k].code||airports[k].name||'—';
    sg.toLabel  =airports[k+1].code||airports[k+1].name||'—';
    segments.push(sg);
  }
  return { n:n, airports:airports, segments:segments, escales:esc, finalHeureArr:finalHeureArr };
}
function _isEscaleVol(m){
  return m && m.type==='vol' && ((m.escales&&m.escales.length) || (m.segment2&&(m.segment2.dep||m.segment2.arr)));
}

// Met à jour l'en-tête de route de chaque segment depuis la chaîne d'aéroports
// (origine en haut → escales → destination finale en haut). Chaînage auto.
function _mobUpdateSegRoutes(){
  var n = _mobEscCount;
  function lbl(codeId, nameId){
    var c = (document.getElementById(codeId)||{}).value || '';
    var nm= (document.getElementById(nameId)||{}).value || '';
    return (c || nm || '—');
  }
  var chain = [ lbl('mob-code-dep','mob-dep') ];
  for(var j=1;j<=n;j++){ chain.push(lbl('mesc-'+j+'-code','mesc-'+j+'-airport')); }
  chain.push(lbl('mob-code-arr','mob-arr'));
  for(var k=1;k<=n+1;k++){
    var r = document.getElementById('mseg-'+k+'-route');
    if(r) r.textContent = chain[k-1] + '  →  ' + chain[k];
  }
}

function _mobEscBlockHTML(j){
  var pin = (typeof _lu==='function') ? _lu('plane', 14) : '';
  return '<div class="mob-esc-block">'
    + '<div class="mob-esc-block-head">'+pin+'<span>Escale '+j+'</span></div>'
    + '<div class="form-row">'
      + '<div class="ac-wrap" style="flex:1;position:relative">'
        + '<input type="text" id="mesc-'+j+'-airport" placeholder="Aéroport d\'escale" autocomplete="off" data-esc-ac="'+j+'" style="width:100%"/>'
        + '<div class="ac-list" id="ac-mesc-'+j+'"></div>'
      + '</div>'
      + '<input type="text" id="mesc-'+j+'-code" placeholder="ICN" style="max-width:56px;text-transform:uppercase;font-weight:600;text-align:center" oninput="this.value=this.value.toUpperCase()"/>'
      + '<input type="text" id="mesc-'+j+'-duree" placeholder="Durée escale (2h30)" style="max-width:150px"/>'
    + '</div>'
  + '</div>';
}

// Bloc segment COMPLET et symétrique (identique pour SEG.1 … SEG.N+1).
// Les aéroports dep/arr ne sont pas re-saisis (chaînés depuis origine/escales/
// destination) : l'en-tête affiche la route. Chaque segment porte tous ses
// champs : décollage, atterrissage, durée (optionnelle), compagnie, n° vol,
// siège, terminal, porte, n° résa, bagages.
function _mobSegBlockHTML(k){
  return '<div class="mob-seg-block">'
    + '<div class="mob-seg-block-head"><span class="mob-seg-badge">SEG. '+k+'</span>'
      + '<span class="mob-seg-route" id="mseg-'+k+'-route">—</span></div>'
    + '<div class="form-row">'
      + '<div class="mob-seg-f"><label class="mob-lbl">Décollage</label><input type="time" id="mseg-'+k+'-hdep" class="vol-time-input"/></div>'
      + '<div class="mob-seg-f"><label class="mob-lbl">Atterrissage</label><input type="time" id="mseg-'+k+'-harr" class="vol-time-input"/></div>'
      + '<div class="mob-seg-f"><label class="mob-lbl">Durée segment</label><input type="text" id="mseg-'+k+'-duree" placeholder="option." style="max-width:96px"/></div>'
    + '</div>'
    + '<div class="form-row">'
      + '<input type="text" id="mseg-'+k+'-compagnie" placeholder="Compagnie" style="flex:2"/>'
      + '<input type="text" id="mseg-'+k+'-numero" placeholder="N° vol" style="flex:1;min-width:70px"/>'
      + '<input type="text" id="mseg-'+k+'-siege" placeholder="Siège" style="max-width:72px"/>'
    + '</div>'
    + '<div class="form-row">'
      + '<input type="text" id="mseg-'+k+'-terminal" placeholder="Terminal" style="max-width:96px"/>'
      + '<input type="text" id="mseg-'+k+'-porte" placeholder="Porte" style="max-width:82px"/>'
      + '<input type="text" id="mseg-'+k+'-resa" placeholder="N° résa" style="flex:1;min-width:80px"/>'
      + '<input type="text" id="mseg-'+k+'-bagages" placeholder="Bagages" style="flex:1.2"/>'
    + '</div>'
  + '</div>';
}

// Autocomplétion aéroport sur les blocs escale + destination finale (CITY_DATA)
function _mobWireEscAC(){
  var inputs = document.querySelectorAll('#mob-escales-dyn [data-esc-ac]');
  for(var i=0;i<inputs.length;i++){
    inputs[i].oninput = function(){ _mobEscACInput(this); };
  }
}
function _mobEscACInput(inp){
  var key   = inp.getAttribute('data-esc-ac');
  var boxId  = (key==='final') ? 'ac-mfinal'      : 'ac-mesc-'+key;
  var codeId = (key==='final') ? 'mfinal-code'    : 'mesc-'+key+'-code';
  var box = document.getElementById(boxId);
  if(!box) return;
  var val = inp.value.trim();
  if(!val){ box.classList.remove('open'); return; }
  var q = val.toLowerCase();
  var hits = Object.keys(CITY_DATA).filter(function(c){ return c.toLowerCase().indexOf(q)!==-1; }).slice(0,8);
  if(!hits.length){ box.classList.remove('open'); return; }
  box.innerHTML = hits.map(function(city){
    var d = CITY_DATA[city];
    return '<div class="ac-item" data-city="'+city.replace(/"/g,'&quot;')+'"><span>'+city+'</span><span class="ac-sub">'+d.pays+' · '+d.iata+'</span></div>';
  }).join('');
  box.classList.add('open');
  box.querySelectorAll('.ac-item').forEach(function(item){
    item.addEventListener('click', function(){
      var city = this.getAttribute('data-city'); var d = CITY_DATA[city];
      inp.value = city;
      var cEl = document.getElementById(codeId);
      if(cEl && d && d.iata && d.iata!=='—') cEl.value = d.iata;
      box.classList.remove('open');
      if(typeof _mobUpdateSegRoutes==='function') _mobUpdateSegRoutes();
    });
  });
  if(typeof _mobUpdateSegRoutes==='function') _mobUpdateSegRoutes();
}

// ── Prévisualisation route ──
function updateMobPreview(){
  var type=(document.getElementById('mob-type')||{}).value||'vol';
  var groupId=MOB_GROUPS[type]||'mob-group-vol';
  var group=document.getElementById(groupId);
  var dep='',arr='';
  if(group){
    var depI=group.querySelector('[id="mob-dep"]');
    var arrI=group.querySelector('[id="mob-arr"]');
    dep=depI?depI.value:'';
    arr=arrI?arrI.value:'';
  }
  var prev=document.getElementById('mob-route-preview');
  if(!prev)return;
  if(dep||arr){
    prev.textContent=(dep||'…')+' → '+(arr||'…');
    prev.classList.add('visible');
  } else {
    prev.classList.remove('visible');
  }
  if(typeof _mobUpdateSegRoutes==='function') _mobUpdateSegRoutes();
}

// ── Lire les champs du groupe actif ──
function _getMobGroupVal(group, id){
  if(!group)return'';
  var els=group.querySelectorAll('[id="'+id+'"]');
  return els.length?els[0].value:'';
}

// ── Rendu liste — avec champs spécifiques affichés ──
function renderMobilite(){
  var el=document.getElementById('mobilite-list');
  if(!el)return;
  el.style.display=''; // toujours réafficher — toggleForm peut avoir mis display:none

  // Toujours rafraîchir les pass (maintenant dans cette section)
  renderPasses();
  _updatePassesPinTop();

  var nb=mobilites.length;
  var sumNb=document.getElementById('mob-sum-nb');if(sumNb)sumNb.textContent=nb+(passes.length?' + '+passes.length+' pass':'');
  var vols_mob=mobilites.filter(function(m){return m.type==='vol';});
  if(vols_mob.length){
    var aller=vols_mob[0], retour=vols_mob[vols_mob.length-1];
    var sa=document.getElementById('mob-sum-aller');
    var sr=document.getElementById('mob-sum-retour');
    if(sa)sa.textContent=(aller.dep||'—')+' → '+(aller.arr||'—');
    if(sr)sr.textContent=(retour.dep||'—')+' → '+(retour.arr||'—');
  }

  if(!mobilites.length){
    el.innerHTML='<div class="empty-state">'
      +'<div class="es-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="6" y="8" width="12" height="13" rx="2"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/><line x1="12" y1="12" x2="12" y2="16"/></svg></div>'
      +'<div class="es-title">Aucun trajet enregistré</div>'
      +'<div class="es-sub">Vols, trains, bus, ferries… ajoute ton premier trajet.</div>'
      +'<button class="es-cta" onclick="pickTransport(\'trajet\')">+ Ajouter un trajet</button>'
      +'</div>';
    return;
  }

  var sorted=mobilites.slice().sort(function(a,b){
    var da=a.date||'',db=b.date||'';
    if(da<db)return -1;if(da>db)return 1;
    return(a.heureDep||'').localeCompare(b.heureDep||'');
  });

  el.innerHTML=sorted.map(function(m){
    var icon=MOB_ICONS[m.type]||'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 3"/></svg>';
    var statutOk=MOB_STATUT_OK.indexOf(m.statut)!==-1;
    var color=MOB_COLORS[m.type]||'var(--sakura)';

    // ── Badge "Couvert par Pass" ──
    // Cherche un pass actif dont la zone contient le départ ou l'arrivée du trajet
    var passCoverHtml='';
    var activePass=passes.filter(function(p){ return p.zone && p.statut==='Activé'; });
    if(activePass.length && (m.dep||m.arr)){
      var trajText=((m.dep||'')+' '+(m.arr||'')).toLowerCase();
      var matched=activePass.find(function(p){
        var zone=p.zone.toLowerCase();
        // Correspondance si la zone est mentionnée dans le trajet OU si le trajet est dans la zone
        return zone.split(/[,;\/]+/).some(function(part){
          part=part.trim();
          return part && (trajText.indexOf(part)!==-1 || (m.dep||'').toLowerCase().indexOf(part)!==-1 || (m.arr||'').toLowerCase().indexOf(part)!==-1);
        }) || trajText.indexOf(zone)!==-1;
      });
      if(matched){
        passCoverHtml='<span class="mob-pass-cover-badge">Couvert par '+matched.nom+'</span>';
      }
    }

    // Ligne de détail selon type
    var details=[];
    if(m.compagnie)details.push(m.compagnie);
    if(m.numero)details.push(m.numero);
    if(m.type==='vol'){
      if(m.siege)details.push('Siège '+m.siege);
      if(m.terminal)details.push('T.'+m.terminal);
      if(m.porte)details.push('Porte '+m.porte);
      if(m.bagages)details.push(m.bagages+' (bagages)');
    } else if(m.type==='train'){
      if(m.siege)details.push('Siège '+m.siege);
      if(m.voiture)details.push('Voit. '+m.voiture);
    } else if(m.type==='bateau'){
      if(m.cabine)details.push('Cabine '+m.cabine);
      if(m.pont)details.push('Pont '+m.pont);
    }

    // Codes IATA pour les vols
    var routeLabel=(m.type==='vol'&&(m.codeDep||m.codeArr))
      ?(m.codeDep||m.dep||'—')+' → '+(m.codeArr||m.arr||'—')
      :(m.dep||'—')+' → '+(m.arr||'—');

    // ── Contenu body : chaîne complète (N+1 segments) ou vol simple ──
    var escVol = _isEscaleVol(m);
    var bodyHtml='';
    if(escVol){
      var ch=_volChain(m);
      var segHtml='';
      for(var si=0; si<ch.segments.length; si++){
        var sg=ch.segments[si];
        var dts=[]; if(sg.compagnie)dts.push(sg.compagnie); if(sg.numero)dts.push(sg.numero); if(sg.siege)dts.push('Siège '+sg.siege);
        var times=(sg.heureDep||sg.heureArr)?'<span class="mob-seg-times">'+(sg.heureDep||'—')+(sg.heureArr?' → '+sg.heureArr:'')+'</span>':'';
        segHtml+='<div class="mob-seg"><span class="mob-seg-num">SEG '+(si+1)+'</span>'
          +'<span class="mob-seg-route">'+sg.fromLabel+' → '+sg.toLabel+'</span>'+times+'</div>'
          +(dts.length?'<div style="font-size:11px;color:var(--ink-hint);padding:0 0 3px 28px">'+dts.join(' · ')+'</div>':'');
        if(si < ch.n){
          var e=ch.escales[si];
          var escLbl=(e.aeroport||ch.airports[si+1].name||ch.airports[si+1].code||'');
          segHtml+='<div class="mob-layover-row"><div class="mob-layover-dot"></div>Escale '+escLbl+(e.dureeEscale?' — '+e.dureeEscale:'')+'</div>';
        }
      }
      bodyHtml='<div class="mob-segments">'+segHtml+'</div>'
        +'<div class="mob-meta" style="margin-top:5px">'
          +'<span class="mob-tag '+(statutOk?'statut-ok':'statut-att')+'">'+(statutOk?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" width="11" height="11"><polyline points="20 6 9 17 4 12"/></svg> ':'')+m.statut+'</span>'
          +(m.note?'<span class="mob-tag">'+m.note+'</span>':'')
          +passCoverHtml
        +'</div>';
    } else {
      // Vol direct ou autre transport
      bodyHtml='<div class="mob-route">'+routeLabel+'</div>'
        +(details.length?'<div class="mob-detail">'+details.join(' · ')+'</div>':'')
        +'<div class="mob-meta">'
          +'<span class="mob-tag '+(statutOk?'statut-ok':'statut-att')+'">'+(statutOk?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" width="11" height="11"><polyline points="20 6 9 17 4 12"/></svg> ':'')+m.statut+'</span>'
          +(m.note?'<span class="mob-tag">'+m.note+'</span>':'')
          +passCoverHtml
        +'</div>';
    }

    return '<div class="mob-item item-wrap emobilite'+(escVol?' has-seg2':'')+'" data-detail-cat="transport" data-detail-id="'+m.id+'">'
      +'<div class="mob-icon '+m.type+'" style="background:'+color+'18;border-color:'+color+'44;color:'+color+'" title="Transport">'+icon+'</div>'
      +'<div class="mob-body">'+bodyHtml+'</div>'
      +(!escVol
        ?'<div class="mob-right">'
          +(m.heureDep?'<div class="mob-time">'+m.heureDep+(m.heureArr?' → '+m.heureArr:'')+'</div>':'')
          +(m.date?'<div class="mob-date">'+m.date+'</div>':'')
          +(m.duree?'<div class="mob-duree"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" width="11" height="11"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/></svg> '+m.duree+'</div>':'')
        +'</div>'
        :'<div class="mob-right">'
          +(m.date?'<div class="mob-date">'+m.date+'</div>':'')
          +(m.duree?'<div class="mob-duree"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" width="11" height="11"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/></svg> '+m.duree+'</div>':'')
        +'</div>'
      )
      +'<button class="edit-item-btn" data-act="editMobilite" data-id="'+m.id+'"></button>'
    +'</div>';
  }).join('');
}

// ── Ajouter un trajet — lit les champs du groupe actif ──
function addMobilite(){
  var type=(document.getElementById('mob-type')||{}).value||'vol';

  // ── Mode ÉDITION (vol via formulaire unifié) : mise à jour, pas d'ajout ──
  if(_mobEditId && type==='vol'){ _saveMobiliteVolFromForm(_mobEditId); return; }

  // ── Cas spécial : Pass ─────────────────────────────────────
  if(type==='pass'){
    var nom=(document.getElementById('mob-pass-nom')||{}).value.trim();
    if(!nom){ showToast('Indique le nom du pass', 'error'); return; }
    var debut  =(document.getElementById('mob-pass-debut')||{}).value||'';
    var fin    =(document.getElementById('mob-pass-fin')||{}).value||'';
    var prix   =(document.getElementById('mob-pass-prix')||{}).value||'';
    var numero =(document.getElementById('mob-pass-numero')||{}).value||'';
    var statut =(document.getElementById('mob-pass-statut')||{}).value||'Activé';
    var cat    =(document.getElementById('mob-pass-categorie')||{}).value||'autre';
    var zone   =(document.getElementById('mob-pass-zone')||{}).value.trim()||'';
    var validite=debut&&fin?debut+' → '+fin:(debut?debut+' →':'');

    passes.push({
      id:uid(), nom:nom, statut:statut,
      validite:validite, debut:debut, fin:fin,
      numero:numero, avantages:'', prix:prix,
      categorie:cat, zone:zone, pdfId:null,
      note:(document.getElementById('mob-pass-note')||{}).value||''
    });

    // Reset champs pass
    ['mob-pass-nom','mob-pass-debut','mob-pass-fin','mob-pass-prix','mob-pass-numero','mob-pass-note','mob-pass-zone'].forEach(function(id){
      var el=document.getElementById(id); if(el) el.value='';
    });

    toggleForm('form-mobilite');
    _resetTransportForm();
    renderPasses();
    _updatePassesPinTop();
    snapshotCurrentTrip();
    showToast('Pass ajouté', 'success');
    return;
  }

  // ── Cas standard : trajet ──────────────────────────────────
  var groupId=MOB_GROUPS[type]||'mob-group-vol';
  var group=document.getElementById(groupId);
  var _v=function(id){return _getMobGroupVal(group,id);};

  var dep=_v('mob-dep').trim();
  var arr=_v('mob-arr').trim();
  if(!dep&&!arr)return;

  var m={
    id:uid(), type:type,
    dep:dep, arr:arr,
    statut:(document.getElementById('mob-statut')||{}).value||'Confirmé',
    date:_v('mob-date'),
    heureDep:_v('mob-heure-dep'),
    heureArr:_v('mob-heure-arr'),
    duree:_v('mob-duree'),
    compagnie:_v('mob-compagnie'),
    numero:_v('mob-numero'),
    note:(document.getElementById('mob-note')||{}).value||'',
    pdfId:(document.getElementById('mob-pdf')||{}).value||''
  };

  // Champs spécifiques par type
  if(type==='vol'){
    m.codeDep=_v('mob-code-dep');
    m.codeArr=_v('mob-code-arr');
    m.siege  =_v('mob-siege');
    m.terminal=_v('mob-terminal');
    m.porte  =_v('mob-porte');
    m.resa   =_v('mob-resa-vol');
    m.bagages=_v('mob-bagages');
    // Escales dynamiques → m.escales[] (ou [] si direct). Écrase les infos
    // racine par celles de SEG.1 en mode escale.
    _readVolEscalesInto(m);
    _freezeVolRootGps(m); // gel coords origine/destination depuis codes IATA
  } else if(type==='train'){
    m.siege  =_v('mob-siege');
    m.voiture=_v('mob-voiture');
    m.resa   =_v('mob-resa-vol');
  } else if(type==='bateau'){
    m.cabine =_v('mob-cabine');
    m.pont   =_v('mob-pont');
    m.resa   =_v('mob-resa-vol');
  }

  mobilites.push(m);

  // Reset champs du groupe actif
  if(group){
    group.querySelectorAll('input[type=text],input[type=time]').forEach(function(inp){ inp.value=''; });
  }
  ['mob-note','mob-pdf'].forEach(function(id){var e=document.getElementById(id);if(e)e.value='';});
  var badge=document.getElementById('mob-pdf-badge');if(badge)badge.innerHTML='';
  var prev=document.getElementById('mob-route-preview');if(prev)prev.classList.remove('visible');
  // Auto-reset escales : décocher + compteur=1 + toggleMobEscales (vide blocs,
  // restaure titre/labels/#mob-direct-details).
  _mobEscCount=1;
  var eChk=document.getElementById('mob-escale-check');if(eChk)eChk.checked=false;
  if(typeof toggleMobEscales==='function') toggleMobEscales();

  toggleForm('form-mobilite');
  _resetTransportForm();
  renderMobilite();
  snapshotCurrentTrip();
  showToast(MOB_LABELS[m.type]+' ajouté', 'success');
}

// ══════════════════════════════════════════════════════════════════
// ÉDITION VOL UNIFIÉE — réutilise le formulaire de création (form-mobilite)
// avec ses blocs escale dynamiques. Le bouton devient « Enregistrer » et la
// soumission cible l'id du vol édité (_mobEditId) au lieu d'un nouvel ajout.
// ══════════════════════════════════════════════════════════════════
function _editVolUnified(m){
  openMobiliteAs('vol'); // ouvre + reset le formulaire (peut effacer _mobEditId)
  setTimeout(function(){
    _mobEditId = m.id; // posé APRÈS l'ouverture/reset, sinon écrasé
    function set(id,v){ var e=document.getElementById(id); if(e) e.value = (v==null?'':v); }
    var hid=document.getElementById('mob-type'); if(hid) hid.value='vol';
    // Bloc global
    set('mob-dep', m.dep); set('mob-code-dep', m.codeDep);
    set('mob-arr', m.arr); set('mob-code-arr', m.codeArr);
    set('mob-heure-dep', m.heureDep); set('mob-heure-arr', m.heureArr);
    set('mob-duree', m.duree); set('mob-date', m.date); set('mob-note', m.note);
    var st=document.getElementById('mob-statut'); if(st) st.value=m.statut||'Confirmé';
    // Infos vol direct (racine = SEG.1)
    set('mob-compagnie', m.compagnie); set('mob-numero', m.numero);
    set('mob-siege', m.siege); set('mob-terminal', m.terminal);
    set('mob-porte', m.porte); set('mob-resa-vol', m.resa); set('mob-bagages', m.bagages);
    // Pièce jointe (billet)
    set('mob-pdf', m.pdfId);
    _mobRenderPdfBadge(m.pdfId);
    // Escales : coche la case + rend + remplit les blocs (ou reste direct)
    _fillVolEscalesForm(m);
    // Bouton + titre en mode édition
    var btn=document.getElementById('mob-submit-btn'); if(btn) btn.textContent='Enregistrer';
    var ttl=document.getElementById('mob-form-title'); if(ttl) ttl.textContent='Modifier le vol';
    var prev=document.getElementById('mob-route-preview'); if(prev){ updateMobPreview(); }
  }, 110);
}

// Rendu du badge PDF (billet) dans le formulaire de création — vue + retrait.
function _mobRenderPdfBadge(pdfId){
  var bEl=document.getElementById('mob-pdf-badge'); if(!bEl) return;
  bEl.innerHTML='';
  if(pdfId && window.pdfStore && window.pdfStore[pdfId]){
    var name=(window.pdfStore[pdfId].name||'Document');
    bEl.innerHTML=
      '<button type="button" class="pdf-view-btn" onclick="openPdf(\''+pdfId+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> '+name+'</button>'
      +'<button type="button" class="pdf-del-btn" onclick="_mobClearPdf()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>';
  }
}
function _mobClearPdf(){
  var h=document.getElementById('mob-pdf'); if(h) h.value='';
  var b=document.getElementById('mob-pdf-badge'); if(b) b.innerHTML='';
}

// Sortie du mode édition : réinitialise l'état + le libellé du bouton/titre.
function _mobCancelEdit(){
  _mobEditId = null;
  var btn=document.getElementById('mob-submit-btn'); if(btn) btn.textContent='+ Ajouter';
  var ttl=document.getElementById('mob-form-title'); if(ttl) ttl.textContent='Ajouter un trajet';
}

// Fermeture du formulaire trajet (Annuler) : AUTO-RESET complet — vide tous
// les champs, les blocs escale dynamiques et l'état d'édition, puis ferme.
function _mobCloseForm(){
  if(typeof window._resetFormMobilite==='function') window._resetFormMobilite();
  if(typeof _resetTransportForm==='function') _resetTransportForm();
  toggleForm('form-mobilite');
}

// Enregistrement d'un vol édité (via le formulaire unifié) → met à jour
// l'objet existant (même id), sans créer de doublon.
function _saveMobiliteVolFromForm(id){
  var m=mobilites.find(function(x){return x.id==id;});
  if(!m){ _mobCancelEdit(); return; }
  var groupId=MOB_GROUPS['vol']||'mob-group-vol';
  var group=document.getElementById(groupId);
  var _v=function(fid){return _getMobGroupVal(group,fid);};
  m.type='vol';
  m.dep=_v('mob-dep').trim(); m.arr=_v('mob-arr').trim();
  m.codeDep=_v('mob-code-dep'); m.codeArr=_v('mob-code-arr');
  m.statut=(document.getElementById('mob-statut')||{}).value||m.statut||'Confirmé';
  m.date=_v('mob-date'); m.heureDep=_v('mob-heure-dep'); m.heureArr=_v('mob-heure-arr');
  m.duree=_v('mob-duree'); m.note=(document.getElementById('mob-note')||{}).value||'';
  m.compagnie=_v('mob-compagnie'); m.numero=_v('mob-numero');
  m.siege=_v('mob-siege'); m.terminal=_v('mob-terminal'); m.porte=_v('mob-porte');
  m.resa=_v('mob-resa-vol'); m.bagages=_v('mob-bagages');
  m.pdfId=(document.getElementById('mob-pdf')||{}).value||'';
  _readVolEscalesInto(m); // escales[] + écrase infos racine par SEG.1 si escale
  _freezeVolRootGps(m);   // gel coords origine/destination depuis codes IATA
  _mobCancelEdit();
  toggleForm('form-mobilite');
  _resetTransportForm();
  if(typeof window._resetFormMobilite==='function') window._resetFormMobilite();
  renderMobilite();
  snapshotCurrentTrip();
  showToast('Vol modifié','success');
}

// ── Édition modale enrichie ──
function editMobilite(id){id=isNaN(+id)?id:+id;
  var m=mobilites.find(function(x){return x.id==id;});if(!m)return;
  // Les VOLS s'éditent via le formulaire de création unifié (mêmes blocs
  // escale dynamiques) — l'ancienne modale em-* ne gère qu'un segment unique.
  if(m.type==='vol'){ _editVolUnified(m); return; }
  var icon=MOB_ICONS[m.type]||'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 3"/></svg>';
  var typeLabel=MOB_LABELS[m.type]||'Trajet';

  // Champs communs + champs spécifiques selon type
  var specificFields='';
  if(m.type==='pass'){
    // Le pass est édité via editPass — on retrouve l'objet dans passes[]
    var matchPass=passes.find(function(p){ return String(p.id)===String(m.passRef); });
    if(matchPass){ editPass(matchPass.id); return; }
    // Fallback : champs inline
    specificFields=
      '<div class="modal-row">'
        +modalField('Date début',mInput('em-pass-debut',m.debut||'','JJ/MM/AAAA'))
        +modalField('Date fin',  mInput('em-pass-fin',  m.fin  ||'','JJ/MM/AAAA'))
        +modalField('Prix (€)',  mInput('em-pass-prix', m.prix ||'','ex: 350','max-width:90px'))
      +'</div>';
  // (vol : édité via le formulaire unifié _editVolUnified — editMobilite retourne
  //  avant ce point pour type==='vol', donc aucune branche vol ici.)
  } else if(m.type==='train'){
    specificFields=
      '<div class="modal-row">'
        +modalField('Siège',mInput('em-siege',m.siege||'','22A'))
        +modalField('Voiture',mInput('em-voiture',m.voiture||'','4'))
        +modalField('N° résa.',mInput('em-resa',m.resa||'',''))
      +'</div>'
      // Champs GPS gare cachés — conservés pour la carte
      +'<input type="hidden" id="em-dep-lat" value="'+(m.depLat||'')+'">'
      +'<input type="hidden" id="em-dep-lng" value="'+(m.depLng||'')+'">'
      +'<input type="hidden" id="em-arr-lat" value="'+(m.arrLat||'')+'">'
      +'<input type="hidden" id="em-arr-lng" value="'+(m.arrLng||'')+'">'; 
  } else if(m.type==='bateau'){
    specificFields=
      '<div class="modal-row">'
        +modalField('Cabine',mInput('em-cabine',m.cabine||'','C-214'))
        +modalField('Pont',mInput('em-pont',m.pont||'','Pont 7'))
        +modalField('N° résa.',mInput('em-resa',m.resa||'',''))
      +'</div>';
  }

  openModal(
    '<div class="modal-header">'
      +'<div class="modal-title">'+icon+' Modifier ce '+typeLabel+'</div>'
      +'<button class="modal-close" onclick="closeModal()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
    +'</div>'
    +'<div class="modal-row">'
      +modalField('Départ',mInput('em-dep',m.dep,'Ville / Gare'))
      +modalField('Arrivée',mInput('em-arr',m.arr,'Ville / Gare'))
    +'</div>'
    +'<div class="modal-row">'
      +modalField('Date',mInput('em-date',m.date,'JJ/MM/AAAA'))
      +modalField('H. départ','<input type="time" id="em-hdep" value="'+(m.heureDep||'')+'" style="padding:9px 10px;font-size:13px;font-family:DM Sans,sans-serif;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface-2);color:var(--ink);outline:none;width:100%"/>')
      +modalField('H. arrivée','<input type="time" id="em-harr" value="'+(m.heureArr||'')+'" style="padding:9px 10px;font-size:13px;font-family:DM Sans,sans-serif;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface-2);color:var(--ink);outline:none;width:100%"/>')
    +'</div>'
    +'<div class="modal-row">'
      +modalField('Compagnie / Opérateur',mInput('em-comp',m.compagnie,''))
      +modalField('N°',mInput('em-num',m.numero,''))
    +'</div>'
    +specificFields
    +'<div class="modal-row">'
      +mSelect('em-statut',['Confirmé','À confirmer','Réservé','À réserver'],m.statut)
      +modalField('Note',mInput('em-note',m.note||'',''))
    +'</div>'
    +mPdfBlock('em-pdf', m.pdfId||'')
    +modalFooter('saveMobilite(\''+id+'\')','deleteMobilite(\''+id+'\')',{type:'le transport',libelle:(typeof MOB_LABELS!=='undefined'&&MOB_LABELS[m.type])||m.titre||m.type||'',hasDoc:!!m.pdfId,fn:'deleteMobilite',id:id})
  );
}

function saveMobilite(id){id=isNaN(+id)?id:+id;
  var idx=mobilites.findIndex(function(x){return x.id==id;});if(idx===-1)return;
  // On travaille sur une COPIE profonde pour éviter toute mutation de référence partagée
  var m=JSON.parse(JSON.stringify(mobilites[idx]));
  var _gv=function(elId){var e=document.getElementById(elId);return e?e.value:'';};
  m.dep      =_gv('em-dep')||m.dep;
  m.arr      =_gv('em-arr')||m.arr;
  m.date     =_gv('em-date');
  m.heureDep =_gv('em-hdep');
  m.heureArr =_gv('em-harr');
  m.compagnie=_gv('em-comp');
  m.numero   =_gv('em-num');
  m.statut   =_gv('em-statut')||m.statut;
  m.note     =_gv('em-note');
  // Type-specific — champs strictement typés pour éviter la contamination croisée
  if(m.type==='vol'){
    // Les vols sont édités via le formulaire unifié (_editVolUnified / _saveMobiliteVolFromForm) :
    // editMobilite retourne avant d'ouvrir cette modale em-*, donc ce chemin n'est jamais atteint
    // pour un vol. Garde no-op défensif (ne rien écraser, surtout pas m.escales).
  } else if(m.type==='train'){
    m.siege  =_gv('em-siege');
    m.voiture=_gv('em-voiture');
    m.resa   =_gv('em-resa');
    // Champs vol/bateau absents pour les trains — nettoyage défensif
    delete m.codeDep; delete m.codeArr; delete m.terminal; delete m.porte;
    delete m.bagages; delete m.segment2; delete m.escales;
    delete m.cabine; delete m.pont;
    // Coordonnées GPS gare : conserver si déjà présentes
    var emDepLat=_gv('em-dep-lat'), emDepLng=_gv('em-dep-lng');
    var emArrLat=_gv('em-arr-lat'), emArrLng=_gv('em-arr-lng');
    if(emDepLat&&!isNaN(parseFloat(emDepLat))){ m.depLat=parseFloat(emDepLat); m.depLng=parseFloat(emDepLng||'0'); }
    if(emArrLat&&!isNaN(parseFloat(emArrLat))){ m.arrLat=parseFloat(emArrLat); m.arrLng=parseFloat(emArrLng||'0'); }
  } else if(m.type==='bateau'){
    m.cabine=_gv('em-cabine');
    m.pont  =_gv('em-pont');
    m.resa  =_gv('em-resa');
    delete m.codeDep; delete m.codeArr; delete m.siege; delete m.voiture;
    delete m.segment2; delete m.escales;
  } else {
    // Bus, ferry, autre : resa seulement
    m.resa=_gv('em-resa');
    delete m.codeDep; delete m.codeArr; delete m.siege; delete m.voiture;
    delete m.segment2; delete m.escales; delete m.cabine; delete m.pont;
  }
  // La durée totale est SAISIE MANUELLE (décalage horaire) : jamais recalculée
  // depuis les horaires. On conserve m.duree tel quel (ou édité via em-duree).
  var emDuree=document.getElementById('em-duree');
  if(emDuree) m.duree=emDuree.value;
  // PDF — accepte nouveau fichier OU conserve l'ancien
  var emPdf=document.getElementById('em-pdf');
  if(emPdf) m.pdfId=emPdf.value;
  // Remplacement atomique dans le tableau — aucun lien de référence subsistant
  mobilites[idx]=m;
  closeModal();renderMobilite();snapshotCurrentTrip();
}

function deleteMobilite(id){id=isNaN(+id)?id:+id;
  mobilites=mobilites.filter(function(m){return m.id!=id;});
  closeModal();renderMobilite();snapshotCurrentTrip();
}

// ── Init du formulaire au premier affichage ──
(function(){
  // Activer le groupe vol par défaut au chargement
  document.addEventListener('DOMContentLoaded',function(){
    if(document.getElementById('mob-type')){
      var chip=document.querySelector('.mob-chip[data-type="vol"]');
      setMobType('vol',chip);
    }
  });
  // Re-init à chaque ouverture du formulaire
  var _origToggleForm=typeof toggleForm==='function'?toggleForm:null;
  if(_origToggleForm){
    toggleForm=function(formId){
      _origToggleForm(formId);
      if(formId==='form-mobilite'){
        var form=document.getElementById('form-mobilite');
        if(form&&form.classList.contains('open')){
          var currentType=(document.getElementById('mob-type')||{}).value||'vol';
          var chip=document.querySelector('.mob-chip[data-type="'+currentType+'"]');
          setMobType(currentType,chip);
        }
      }
    };
  }
})();

// ── mobilites + locations : gérés directement dans snapshotCurrentTrip() et restoreTrip() (voir ci-dessus) ──



// ══════════════════════════════════════════════════════════════════
// LOCATIONS & PASS — Locations de véhicules
// ══════════════════════════════════════════════════════════════════
// [migrated to module — see header]

var LOC_ICONS={voiture:'🚗',scooter:'🛵',velo:'🚲',camping:'🚐',bateau:'⛵'};
var LOC_LABELS={voiture:'Voiture',scooter:'Scooter / Moto',velo:'Vélo',camping:'Camping-car',bateau:'Bateau de plaisance'};
var PASS_CAT_ICONS={rail:'Rail',urban:'Urbain',vignette:'Vignette',autre:'Autre'};

function renderLocations(){
  var el=document.getElementById('locations-list');
  if(!el)return;
  el.style.display=''; // toujours réafficher — toggleForm peut avoir mis display:none
  if(!locations.length){
    el.innerHTML='<div class="empty-state">'
      +'<div class="es-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 17H3a2 2 0 0 1-2-2v-4l3-7h14l3 7v4a2 2 0 0 1-2 2h-2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><line x1="9" y1="17" x2="15" y2="17"/></svg></div>'
      +'<div class="es-title">Aucune location</div>'
      +'<div class="es-sub">Voitures, scooters, vélos en location.</div>'
      +'<button class="es-cta" onclick="openAddTop(\'form-location\')">+ Ajouter une location</button>'
      +'</div>';
    return;
  }
  el.innerHTML=locations.map(function(l){
    var icon=LOC_ICONS[l.type]||'—';
    var lcolor=(typeof LOC_COLORS!=='undefined'&&LOC_COLORS[l.type])||'#7a8290';
    return '<div class="loc-card item-wrap elocations" data-detail-cat="location" data-detail-id="'+l.id+'">'
      +'<div class="loc-card-header">'
        +'<div class="loc-icon" style="background:'+lcolor+'18;color:'+lcolor+'" title="Location">'+icon+'<span class="loc-key-badge"></span></div>'
        +'<div style="flex:1;min-width:0">'
          +'<div class="loc-title">'+(l.modele||LOC_LABELS[l.type]||'Location')+'</div>'
          +'<div class="loc-sub">'+(l.loueur?l.loueur+' · ':'')+(l.statut||'Confirmée')+'</div>'
        +'</div>'
        +(l.resa?'<span class="badge badge-muted" style="font-size:10px">'+l.resa+'</span>':'')
      +'</div>'
      +'<div class="loc-grid">'
        +'<div class="loc-cell"><div class="lbl">Prise en charge</div><div class="val">'+(l.dateDep||'—')+'</div></div>'
        +'<div class="loc-cell"><div class="lbl">Restitution</div><div class="val">'+(l.dateRet||'—')+(l.heureRet?' à '+l.heureRet:'')+'</div></div>'
        +(l.lieuDep?'<div class="loc-cell"><div class="lbl">Lieu prise</div><div class="val">'+l.lieuDep+'</div></div>':'')
        +(l.lieuRet?'<div class="loc-cell"><div class="lbl">Lieu restitution</div><div class="val">'+l.lieuRet+'</div></div>':'')
      +'</div>'
      +(l.caution?'<div class="loc-caution">Caution : '+l.caution+'</div>':'')
      +(l.note?'<div style="font-size:11px;color:var(--ink-muted);margin-top:6px">'+l.note+'</div>':'')
      +'<button class="edit-item-btn" data-act="editLocation" data-id="'+l.id+'"></button>'
    +'</div>';
  }).join('');
}

function addLocation(){
  var modele=(document.getElementById('loc-modele')||{}).value||'';
  modele=modele.trim();
  var type=(document.getElementById('loc-type')||{}).value||'voiture';
  // On accepte même sans modèle si un type est sélectionné
  if(!type) return;
  var loc={
    id:uid(),
    type:type,
    modele:modele||LOC_LABELS[type]||'Location',
    statut:(document.getElementById('loc-statut')||{}).value||'Confirmée',
    loueur:(document.getElementById('loc-loueur')||{}).value||'',
    resa:(document.getElementById('loc-resa')||{}).value||'',
    dateDep:(document.getElementById('loc-date-dep')||{}).value||'',
    dateRet:(document.getElementById('loc-date-ret')||{}).value||'',
    heureRet:(document.getElementById('loc-heure-ret')||{}).value||'',
    lieuDep:(document.getElementById('loc-lieu-dep')||{}).value||'',
    lieuRet:(document.getElementById('loc-lieu-ret')||{}).value||'',
    caution:(document.getElementById('loc-caution')||{}).value||'',
    note:(document.getElementById('loc-note')||{}).value||'',
    pdfId:(document.getElementById('loc-pdf')||{}).value||''
  };
  locations.push(loc);
  ['loc-modele','loc-loueur','loc-resa','loc-date-dep','loc-date-ret',
   'loc-heure-ret','loc-lieu-dep','loc-lieu-ret','loc-caution','loc-note','loc-pdf'
  ].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  toggleForm('form-location');
  renderLocations();
  snapshotCurrentTrip();
  showToast((LOC_LABELS[loc.type]||'Location')+' ajoutée', 'success');
}

function editLocation(id){id=isNaN(+id)?id:+id;
  var l=locations.find(function(x){return x.id==id;});if(!l)return;
  openModal(
    '<div class="modal-header"><div class="modal-title">Modifier la location</div><button class="modal-close" onclick="closeModal()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>'
    +'<div class="modal-row">'
      +modalField('Modèle / Desc.',mInput('el2-modele',l.modele,'Toyota Yaris'))
      +modalField('Loueur',mInput('el2-loueur',l.loueur,'Hertz, Budget…'))
    +'</div>'
    +'<div class="modal-row">'
      +modalField('N° résa.',mInput('el2-resa',l.resa,''))
      +mSelect('el2-statut',['Confirmée','À confirmer','En attente'],l.statut)
    +'</div>'
    +'<div class="modal-row">'
      +modalField('Prise en charge',mInput('el2-dep',l.dateDep,'JJ/MM/AAAA'))
      +modalField('Restitution',mInput('el2-ret',l.dateRet,'JJ/MM/AAAA'))
      +modalField('Heure restit.',mInput('el2-hret',l.heureRet,'10:00'))
    +'</div>'
    +'<div class="modal-row">'
      +modalField('Lieu prise',mInput('el2-ldep',l.lieuDep,'Aéroport CDG T2'))
      +modalField('Lieu restit.',mInput('el2-lret',l.lieuRet,''))
    +'</div>'
    +'<div class="modal-row">'
      +modalField('Caution',mInput('el2-caution',l.caution,'ex: 800 €'))
      +modalField('Note',mInput('el2-note',l.note||'','assurance, plein…'))
    +'</div>'
    +mPdfBlock('el2-pdf', l.pdfId||'')
    +modalFooter('saveLocation(\''+id+'\')','deleteLocation(\''+id+'\')',{type:'la location',libelle:l.nom||(typeof LOC_LABELS!=='undefined'&&LOC_LABELS[l.type])||l.type||'',hasDoc:!!l.pdfId,fn:'deleteLocation',id:id})
  );
}
function saveLocation(id){id=isNaN(+id)?id:+id;
  var l=locations.find(function(x){return x.id==id;});if(!l)return;
  l.modele=document.getElementById('el2-modele').value||l.modele;
  l.loueur=document.getElementById('el2-loueur').value;
  l.resa=document.getElementById('el2-resa').value;
  l.statut=document.getElementById('el2-statut').value;
  l.dateDep=document.getElementById('el2-dep').value;
  l.dateRet=document.getElementById('el2-ret').value;
  l.heureRet=document.getElementById('el2-hret').value;
  l.lieuDep=document.getElementById('el2-ldep').value;
  l.lieuRet=document.getElementById('el2-lret').value;
  l.caution=document.getElementById('el2-caution').value;
  l.note=document.getElementById('el2-note').value;
  var el2Pdf=document.getElementById('el2-pdf');
  if(el2Pdf) l.pdfId=el2Pdf.value;
  closeModal();renderLocations();snapshotCurrentTrip();
}
function deleteLocation(id){id=isNaN(+id)?id:+id;
  locations=locations.filter(function(l){return l.id!=id;});
  closeModal();renderLocations();snapshotCurrentTrip();
}

// ── Patch renderPasses : ajouter badge catégorie ──
(function(){
  var _origRP=typeof renderPasses==='function'?renderPasses:null;
  if(!_origRP)return;
  renderPasses=function(){
    _origRP();
    // Injecter badge catégorie sur les pass cards si données disponibles
    // (renderPasses crée son HTML inline, on le laisse tel quel et on enrichit via catégorie)
  };
})();

// ── Init champs conditionnels (uniquement si le formulaire existe dans le DOM) ──
document.addEventListener('DOMContentLoaded',function(){
  if(document.getElementById('mob-type') && typeof onMobTypeChange==='function'){
    onMobTypeChange();
  }
});
var PALETTE=['#e8748a','#c9921a','#2d8c6b','#2d5e8c','#7c5cbf','#e05c5c','#5c8c7c','#b5832a'];
// [migrated to module — see header]
function getVilleColor(ville){
  var k=ville.toLowerCase().trim();
  if(!villeColors[k]){villeColors[k]=PALETTE[palIdx%PALETTE.length];palIdx++;}
  return villeColors[k];
}
// [migrated to module — see header]

// ── Auto-sync totalNuits depuis les nuits d'hébergement ──────────────
// Appelé après chaque ajout/modification/suppression d'hôtel.

// FIX nuitées : nombre de nuits d'un hôtel. Si h.nuits est absent/0
// (cas des hôtels saisis avant le correctif calendrier), il est calculé
// depuis les dates check-in/check-out. Utilisé par TOUTES les
// agrégations pour que la barre de répartition se remplisse toujours.
function _hotelNights(h){
  var n = parseInt(h && h.nuits, 10);
  if(!isNaN(n) && n > 0) return n;
  if(h && h.checkin && h.checkout && typeof parseDDMMYYYY === 'function'){
    var ci = parseDDMMYYYY(h.checkin), co = parseDDMMYYYY(h.checkout);
    if(ci && co && typeof daysBetween === 'function'){
      var d = daysBetween(ci, co);
      if(d > 0) return d;
    }
  }
  return 0;
}

// Met à jour totalNuits avec le max(somme hotels, durée du voyage).
function _syncTotalNuits(){
  // Somme des nuits de tous les hôtels
  var sumHotels = hotels.reduce(function(s, h){ return s + _hotelNights(h); }, 0);
  // Durée du voyage depuis les méta (si définie)
  var tripDays = 0;
  if(currentTripId && allTrips[currentTripId]){
    var meta = allTrips[currentTripId].meta || {};
    var d1 = parseDDMMYYYY(meta.dateDep), d2 = parseDDMMYYYY(meta.dateRet);
    if(d1 && d2) tripDays = Math.max(0, Math.round((d2-d1)/86400000));
  }
  // totalNuits = max des deux, au moins 1
  var newTotal = Math.max(sumHotels, tripDays, 1);
  if(newTotal !== totalNuits){ totalNuits = newTotal; }
}

function renderNightsSummary(){
  document.getElementById('nuits-total-input').value=totalNuits;
  var _ntn=document.getElementById('nights-total-num'); if(_ntn)_ntn.textContent=totalNuits;
  var vm={};
  hotels.forEach(function(h){var k=h.ville;vm[k]=(vm[k]||0)+_hotelNights(h);});
  var entries=Object.keys(vm).map(function(k){return [k,vm[k]];});
  var assigned=entries.reduce(function(s,e){return s+e[1];},0);
  var rem=Math.max(0,totalNuits-assigned);
  var tl=document.getElementById('nights-timeline');
  tl.innerHTML=entries.map(function(e){
    return '<div class="nt-seg" style="background:'+getVilleColor(e[0])+';flex:'+e[1]+'" title="'+e[0]+' · '+e[1]+' nuits"></div>';
  }).join('')+(rem>0?'<div class="nt-seg" style="background:var(--ink-hint);flex:'+rem+'" title="Non assigné · '+rem+' nuits"></div>':'');
  var lg=document.getElementById('nights-legend');
  lg.innerHTML=entries.map(function(e){
    return '<div class="legend-item"><div class="legend-dot" style="background:'+getVilleColor(e[0])+'"></div>'+e[0]+' · '+e[1]+' nuits</div>';
  }).join('')+(rem>0?'<div class="legend-item"><div class="legend-dot" style="background:var(--ink-hint)"></div>Non assigné · '+rem+' nuits</div>':'');
}
function setTotalNuits(){
  var v=parseInt(document.getElementById('nuits-total-input').value);
  if(!isNaN(v)&&v>0){totalNuits=v;renderNightsSummary();toggleForm('form-nuits');snapshotCurrentTrip();}
}

// ── Hébergement : heures, date réelle de check-out, rappel de départ ──
function _fmtHeure(t){ if(!t) return ''; return (''+t).replace(':','h'); }
function _hotelTripYear(){
  var meta=(typeof currentTripId!=='undefined' && allTrips[currentTripId] && allTrips[currentTripId].meta)||{};
  var m=(meta.dateDep||meta.dateRet||'').match(/\/(\d{4})$/);
  return m?+m[1]:(new Date()).getFullYear();
}
function _hotelDateObj(str){
  if(!str) return null;
  var fr=(''+str).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(fr) return new Date(+fr[3],+fr[2]-1,+fr[1]);
  var iso=(''+str).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(iso) return new Date(+iso[1],+iso[2]-1,+iso[3]);
  if(typeof MOIS_SHORT!=='undefined' && /^\d{1,2}\s/.test(''+str)){
    var d=parseInt((''+str),10);
    for(var i=0;i<MOIS_SHORT.length;i++){
      if((''+str).toLowerCase().indexOf(MOIS_SHORT[i].toLowerCase())!==-1)
        return new Date(_hotelTripYear(),i,d);
    }
  }
  return null;
}
function _hotelDepReminder(h){
  if(!h||!h.heureDep) return null;
  var co=_hotelDateObj(h.checkout); if(!co) return null;
  var today=new Date(); today.setHours(0,0,0,0);
  var coMid=new Date(co.getFullYear(),co.getMonth(),co.getDate());
  var diff=Math.round((coMid-today)/86400000);
  if(diff<0||diff>5) return null;
  var when=diff===0?'aujourd\'hui':(diff===1?'demain':'dans '+diff+' jours');
  return { text:'Départ '+when+' avant '+_fmtHeure(h.heureDep), urgent:diff<=1 };
}

function renderHotels(){
  var el=document.getElementById('hotels-list');
  el.style.display='';
  if(!hotels.length){el.innerHTML='<div class="empty-state"><div class="es-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28"><rect x="2" y="6" width="20" height="16" rx="2"/><path d="M2 12h20"/><rect x="7" y="16" width="3" height="6"/><rect x="14" y="16" width="3" height="6"/></svg></div><div class="es-title">Aucun hébergement enregistré</div><div class="es-sub">Ajoute tes hôtels et Airbnb pour suivre ton planning.</div><button class="es-cta" onclick="openAddTop(\'form-hotel\')">+ Ajouter un hébergement</button></div>';renderNightsSummary();return;}
  el.innerHTML=hotels.map(function(h){
    var c=getVilleColor(h.ville);
    // Ligne adresse élégante : rue + "Ville, Pays" avec badge pays
    var adresseLine = '';
    if(h.rue || h.cp || h.pays || h.ville){
      var rueDisplay = h.rue ? h.rue + (h.cp ? ', ' + h.cp : '') : '';
      var locDisplay = h.ville + (h.pays ? '<span class="pays-tag">'+h.pays+'</span>' : '');
      adresseLine = '<div class="hotel-adresse-structured">'
        +'<span>'+(rueDisplay ? rueDisplay+', ' : '')+locDisplay+'</span>'
        +'<button class="map-pin-link" data-mappin-cat="hotel" data-mappin-id="'+h.id+'" title="Voir sur la carte" style="background:none;border:none;cursor:pointer;font-size:13px;padding:0;margin-left:4px"><svg viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'1.8\' width=\'13\' height=\'13\'><path d=\'M9 3L3 6.5v14L9 17l6 3.5 6-3.5V3l-6 3.5L9 3z\'/><line x1=\'9\' y1=\'3\' x2=\'9\' y2=\'17\'/><line x1=\'15\' y1=\'6.5\' x2=\'15\' y2=\'20.5\'/></svg></button>'
        +'</div>';
    } else if(h.adresse){
      // Fallback legacy
      adresseLine = '<div class="hotel-adresse">'+h.adresse
        +'<button class="map-pin-link" data-mappin-cat="hotel" data-mappin-id="'+h.id+'" title="Voir sur la carte"><svg viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'1.8\' width=\'13\' height=\'13\'><path d=\'M9 3L3 6.5v14L9 17l6 3.5 6-3.5V3l-6 3.5L9 3z\'/><line x1=\'9\' y1=\'3\' x2=\'9\' y2=\'17\'/><line x1=\'15\' y1=\'6.5\' x2=\'15\' y2=\'20.5\'/></svg></button></div>';
    }
    var _nh=_hotelNights(h);
    var _bits=[];
    if(h.checkin && h.checkout) _bits.push(h.checkin+' → '+h.checkout);
    else if(h.checkin) _bits.push(h.checkin);
    if(_nh) _bits.push(_nh+' nuit'+(_nh>1?'s':''));
    if(h.ville || h.pays) _bits.push((h.ville||'')+(h.pays?'<span class="pays-tag">'+h.pays+'</span>':''));
    var _times=[];
    if(h.heureArr) _times.push('Arrivée '+_fmtHeure(h.heureArr));
    if(h.heureDep) _times.push('Départ '+_fmtHeure(h.heureDep));
    var _rem=_hotelDepReminder(h);
    var _luOut=(typeof _lu==='function')?_lu('log-out',13):'';
    return '<div class="hotel-item item-wrap ehotel" style="border-left-color:'+c+'" data-detail-cat="hotel" data-detail-id="'+h.id+'">'
      +'<div class="hotel-main">'
        +'<div class="hotel-top">'
          +'<div class="hotel-name">'+h.nom+'</div>'
          +'<button class="hotel-map-btn" data-mappin-cat="hotel" data-mappin-id="'+h.id+'" title="Voir sur la carte"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="16" height="16"><path d="M9 3L3 6.5v14L9 17l6 3.5 6-3.5V3l-6 3.5L9 3z"/><line x1="9" y1="3" x2="9" y2="17"/><line x1="15" y1="6.5" x2="15" y2="20.5"/></svg></button>'
        +'</div>'
        +(_rem?'<div class="hotel-reminder'+(_rem.urgent?' urgent':'')+'">'+_luOut+'<span>'+_rem.text+'</span></div>':'')
        +(_bits.length?'<div class="hotel-info">'+_bits.join(' · ')+'</div>':'')
        +(_times.length?'<div class="hotel-times">'+_times.join(' · ')+'</div>':'')
        +(h.note?'<div class="hotel-note">'+(h.note+'').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>':'')
        +(h.resa?'<div class="hotel-ref" style="color:'+c+'">Résa · <span class="copyable" data-copy="'+(h.resa+'').replace(/"/g,'&quot;')+'">'+h.resa+'</span></div>':'')
      +'</div>'
      +'<button class="edit-item-btn" data-act="editHotel" data-id="'+h.id+'"></button>'
    +'</div>';
  }).join('');
  renderNightsSummary();
}

function editHotel(id){id=isNaN(+id)?id:+id;
  var h=hotels.find(function(x){return x.id==id;});if(!h)return;
  var cij=parseJour(h.checkin),cim=parseMois(h.checkin);
  var coj=parseJour(h.checkout),com=parseMois(h.checkout);
  openModal(
    '<div class="modal-header"><div class="modal-title">Modifier cet hébergement</div><button class="modal-close" onclick="closeModal()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>'
    +'<div class="modal-row">'
      +modalField('Nom',mInput('eh-nom',h.nom,'Nom de l\'hôtel','width:100%'))
      +modalField('Ville',mInput('eh-ville',h.ville,'Tokyo / Kyoto / …'))
    +'</div>'
    +'<div class="modal-row">'
      +mDateRow('Check-in','eh-ci-jour','eh-ci-mois',cij,cim)
      +mDateRow('Check-out','eh-co-jour','eh-co-mois',coj,com)
      +'<div class="modal-field" style="flex:none"><label>Nuits</label><input type="number" id="eh-nuits" value="'+(h.nuits||'')+'" style="max-width:70px;min-width:60px;flex:none;padding:9px 10px;font-size:13px;font-family:DM Sans,sans-serif;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface-2);color:var(--ink);outline:none"/></div>'
    +'</div>'
    +'<div class="modal-row">'
      +modalField('Type de chambre',mInput('eh-type',h.type,'Chambre double'))
      +modalField('N° réservation',mInput('eh-resa',h.resa,'ABC-123'))
    +'</div>'
    +'<div class="modal-row">'
      +modalField('Heure d\'arrivée','<input type="time" id="eh-heure-arr" value="'+(h.heureArr||'')+'" style="padding:9px 10px;font-size:13px;font-family:DM Sans,sans-serif;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface-2);color:var(--ink);outline:none;width:100%"/>')
      +modalField('Heure de départ','<input type="time" id="eh-heure-dep" value="'+(h.heureDep||'')+'" style="padding:9px 10px;font-size:13px;font-family:DM Sans,sans-serif;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface-2);color:var(--ink);outline:none;width:100%"/>')
    +'</div>'
    +'<div class="modal-row">'
      +modalField('Note (petit-déj, wifi, étage…)','<textarea id="eh-note" rows="2" placeholder="Petit-déj inclus 7h-10h · code wifi…" style="padding:9px 10px;font-size:13px;font-family:DM Sans,sans-serif;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface-2);color:var(--ink);outline:none;width:100%;resize:vertical">'+((h.note||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'))+'</textarea>')
    +'</div>'
    +'<div class="addr-block" style="margin-top:4px">'
      +'<div class="addr-block-header"><span class="addr-block-label">Adresse</span></div>'
      +'<div class="addr-grid">'
        +'<div class="addr-field"><label>Pays <span class="required-star">*</span></label>'
          +'<input type="text" id="eh-pays" value="'+(h.pays||'')+'" placeholder="Japon, France…" list="eh-pays-datalist"/>'
          +'<datalist id="eh-pays-datalist"></datalist></div>'
        +'<div class="addr-field"><label>Ville</label>'
          +'<input type="text" id="eh-ville" value="'+(h.ville||'')+'" placeholder="Tokyo, Paris…"/></div>'
        +'<div class="addr-field"><label>Code Postal</label>'
          +'<input type="text" id="eh-cp" value="'+(h.cp||'')+'" placeholder="160-0022…"/></div>'
        +'<div class="addr-field"><label>Rue / N°</label>'
          +'<input type="text" id="eh-rue" value="'+(h.rue||'')+'" placeholder="1-2-3 Shinjuku…"/></div>'
      +'</div>'
      +'<button class="btn-verify-addr" id="eh-verify-btn" type="button" onclick="verifierAdresse(\'hotel-edit\')">'
        +'<span class="verify-icon"></span> Vérifier l\'adresse'
      +'</button>'
      +'<div class="addr-result-badge" id="eh-addr-result"></div>'
    +'</div>'
    +mPdfBlock('eh-pdf', h.pdfId||'')
    +modalFooter('saveHotel(\''+id+'\')','deleteHotel(\''+id+'\')',{type:"l'hébergement",libelle:h.nom||'',hasDoc:!!h.pdfId,fn:'deleteHotel',id:id})
  );
}
function saveHotel(id){id=isNaN(+id)?id:+id;
  var h=hotels.find(function(x){return x.id==id;});if(!h)return;
  h.nom=document.getElementById('eh-nom').value||h.nom;
  h.ville=document.getElementById('eh-ville').value||h.ville;
  var cij=document.getElementById('eh-ci-jour').value,cim=document.getElementById('eh-ci-mois').value;
  var coj=document.getElementById('eh-co-jour').value,com=document.getElementById('eh-co-mois').value;
  if(cij&&cim) h.checkin=cij+' '+cim;
  if(coj&&com) h.checkout=coj+' '+com;
  h.nuits=parseInt(document.getElementById('eh-nuits').value)||h.nuits;
  h.type=document.getElementById('eh-type').value;
  h.resa=document.getElementById('eh-resa').value;
  var _ehA=document.getElementById('eh-heure-arr'); if(_ehA) h.heureArr=_ehA.value;
  var _ehD=document.getElementById('eh-heure-dep'); if(_ehD) h.heureDep=_ehD.value;
  var _ehN=document.getElementById('eh-note'); if(_ehN) h.note=_ehN.value;
  // Adresse structurée
  var newRue =(document.getElementById('eh-rue')||{value:''}).value.trim();
  var newCp  =(document.getElementById('eh-cp')||{value:''}).value.trim();
  var newPays=(document.getElementById('eh-pays')||{value:''}).value.trim();
  var newFull= buildFullAddress(newRue, newCp, h.ville, newPays);
  // Si l'adresse a changé → reset coords pour forcer nouveau géocodage
  if(newFull !== h.fullAddress){ h.lat=null; h.lng=null; }
  h.rue=newRue; h.cp=newCp; h.pays=newPays;
  h.fullAddress=newFull;
  h.adresse=newFull; // compat legacy
  // PDF
  var ehPdf=document.getElementById('eh-pdf');
  if(ehPdf) h.pdfId=ehPdf.value;
  // Géocodage si nouvelle adresse sans coords
  if(h.fullAddress && (!h.lat || !h.lng)){
    fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(h.fullAddress),{headers:{'Accept-Language':'fr,en'}})
    .then(function(r){return r.json();})
    .then(function(data){
      if(data&&data.length){h.lat=parseFloat(data[0].lat);h.lng=parseFloat(data[0].lon);}
      snapshotCurrentTrip();
    }).catch(function(){snapshotCurrentTrip();});
  }
  closeModal(); _syncTotalNuits(); renderHotels();snapshotCurrentTrip();
  showToast('Hébergement mis à jour ','success');
}
function addHotel(){
  var n   = document.getElementById('ht-nom').value.trim();
  // Ville vient du bloc adresse (ht-ville-addr visible) — on sync dans ht-ville hidden
  var villeAddr = (document.getElementById('ht-ville-addr')||{}).value||'';
  var v   = villeAddr.trim() || (document.getElementById('ht-ville')||{}).value.trim();
  if(!n){ showToast('Nom de l\hébergement requis', 'error'); return; }
  if(!v){ showToast('Ville requise dans le bloc Adresse', 'error'); return; }
  var ciRaw = document.getElementById('ht-ci').value.trim();
  var coRaw = document.getElementById('ht-co').value.trim();
  var pdfId = (document.getElementById('hotel-pdf')||{}).value||'';
  // Collecte adresse structurée
  var addr = _collectAddrFields('ht');
  addr.ville = v; // assurer la cohérence
  var fullAddress = buildFullAddress(addr.rue, addr.cp, addr.ville, addr.pays);
  hotels.push({id:uid(), nom:n, ville:v,
    checkin:ciRaw, checkout:coRaw,
    nuits:parseInt(document.getElementById('ht-nuits').value)
          || _hotelNights({checkin:ciRaw, checkout:coRaw}),
    type:document.getElementById('ht-type').value,
    resa:document.getElementById('ht-resa').value,
    heureArr:(document.getElementById('ht-heure-arr')||{}).value||'',
    heureDep:(document.getElementById('ht-heure-dep')||{}).value||'',
    note:(document.getElementById('ht-note')||{}).value||'',
    rue:addr.rue, cp:addr.cp, pays:addr.pays,
    fullAddress:fullAddress,
    adresse:fullAddress,
    lat:parseFloat((document.getElementById('ht-adresse-lat')||{}).value)||null,
    lng:parseFloat((document.getElementById('ht-adresse-lng')||{}).value)||null,
    pdfId:pdfId
  });
  // Reset tous les champs
  ['ht-nom','ht-ville','ht-ville-addr','ht-ci','ht-co','ht-nuits','ht-type','ht-resa',
   'ht-heure-arr','ht-heure-dep','ht-note',
   'ht-rue','ht-cp','ht-pays','ht-adresse-lat','ht-adresse-lng','hotel-pdf','ht-magic-input'].forEach(function(id){
    var el=document.getElementById(id);if(el)el.value='';
  });
  ['ht-ci-jour','ht-ci-mois','ht-co-jour','ht-co-mois'].forEach(function(id){var el=document.getElementById(id);if(el)el.selectedIndex=0;});
  ['hint-ht-ci','hint-ht-co','hint-ht-nuits'].forEach(function(id){var el=document.getElementById(id);if(el)el.classList.remove('visible');});
  ['ht-ci','ht-co','ht-nuits'].forEach(function(id){var el=document.getElementById(id);if(el)el.classList.remove('auto-filled');});
  var hid=document.getElementById('hotel-pdf-badge'); if(hid) hid.innerHTML='';
  // Reset bloc adresse
  var res=document.getElementById('ht-addr-result'); if(res){res.className='addr-result-badge';res.textContent='';}
  var btn=document.getElementById('ht-verify-btn'); if(btn) btn.className='btn-verify-addr';
  toggleForm('form-hotel'); _syncTotalNuits(); renderHotels(); snapshotCurrentTrip();
  showToast('Hébergement ajouté', 'success');
}
function deleteHotel(id){id=isNaN(+id)?id:+id;
  hotels=hotels.filter(function(h){return h.id!=id;});
  closeModal(); _syncTotalNuits(); renderHotels();snapshotCurrentTrip();
}

// ══════════════════════════════════════════
// LIEUX
// ══════════════════════════════════════════
// [migrated to module — see header]
var _lieuxGroupMode = 'ville';   // 'none' | 'ville' | 'categorie' — défaut : par ville

function setLieuxGroup(mode, btn){
  _lieuxGroupMode = mode;
  document.querySelectorAll('.lgs-btn').forEach(function(b){ b.classList.remove('active'); });
  if(btn) btn.classList.add('active');
  // En mode regroupé, le filtre par ville/catégorie n'a plus de sens
  var fb = document.getElementById('places-filter-bar');
  if(fb) fb.style.display = (mode === 'none') ? '' : 'none';
  renderLieux();
}

// Construit le HTML d'UNE carte lieu (extrait pour réutilisation en mode groupé)
function _renderLieuCard(l){
  var card = document.createElement('div');
  card.className = 'place-card item-wrap elieu' + (l.visited ? ' visited' : '');
  card.setAttribute('data-lieu-id', String(l.id));

  var horaires = '';
  if(l.ouverture || l.fermeture){
    horaires = '<div class="lieu-horaires">'
      + (l.ouverture ? '<span class="lieu-horaire-chip">' + l.ouverture + '</span>' : '')
      + (l.fermeture ? '<span class="lieu-horaire-chip">' + l.fermeture + '</span>' : '')
    + '</div>';
  }
  var mapBtn = '<button class="map-pin-link" style="margin-left:5px;background:none;border:none;cursor:pointer;font-size:13px;padding:0" data-mappin-cat="lieu" data-mappin-id="' + l.id + '" title="Voir sur la carte"><svg viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'1.8\' width=\'13\' height=\'13\'><path d=\'M9 3L3 6.5v14L9 17l6 3.5 6-3.5V3l-6 3.5L9 3z\'/><line x1=\'9\' y1=\'3\' x2=\'9\' y2=\'17\'/><line x1=\'15\' y1=\'6.5\' x2=\'15\' y2=\'20.5\'/></svg></button>';
  var pdfHtml = '';
  if(l.pdfId && window.pdfStore && window.pdfStore[l.pdfId]){
    pdfHtml = '<span class="pdf-badge" style="cursor:pointer;font-size:11px;margin-top:4px;display:inline-block" data-act="openPdf" data-id="' + l.pdfId + '">' + window.pdfStore[l.pdfId].name + '</span>';
  }
  var locLine = l.ville + (l.pays ? ', <span style="color:var(--ink-hint)">' + l.pays + '</span>' : '');
  var adresseDetail = '';
  if(l.rue){ adresseDetail = '<div class="place-adresse">' + l.rue + (l.cp ? ' ' + l.cp : '') + ', ' + l.ville + (l.pays ? ', ' + l.pays : '') + '</div>'; }
  var meta = _lieuCatMeta(l.categorie);
  var catBadge = l.categorie ? '<span class="lieu-cat-badge" style="background:' + meta.tint + ';color:' + meta.color + '">' + l.categorie + '</span>' : '';
  var visBadge = l.visited ? '<span class="place-visited"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" width="10" height="10"><polyline points="20 6 9 17 4 12"/></svg> Visit\u00e9</span>' : '';

  card.innerHTML =
    '<div class="place-row">'
      + '<span class="drag-handle" onclick="event.stopPropagation()">'
      + '<svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="2.5" r="1.2"/><circle cx="7" cy="2.5" r="1.2"/><circle cx="3" cy="8" r="1.2"/><circle cx="7" cy="8" r="1.2"/><circle cx="3" cy="13.5" r="1.2"/><circle cx="7" cy="13.5" r="1.2"/></svg>'
      + '</span>'
      + '<div class="place-chip" style="background:' + meta.tint + ';color:' + meta.color + '">' + meta.svg + '</div>'
      + '<div class="place-body">'
        + '<div class="place-head"><span class="place-name">' + l.nom + '</span>' + visBadge + '</div>'
        + '<div class="place-sub"><span class="place-city">' + locLine + mapBtn + '</span>' + catBadge + '</div>'
        + horaires + adresseDetail
        + (l.note ? '<div class="place-note">' + l.note + '</div>' : '')
        + pdfHtml
      + '</div>'
    + '</div>'
    + '<button class="edit-item-btn" data-act="editLieu" data-id="' + l.id + '"></button>';

  card.onclick = function(e){
    if(emodes && emodes.lieux) return;
    _cardDetailClick(e, 'lieu', l.id);
  };
  return card;
}

function renderLieux(){
  var grid=document.getElementById('places-grid');
  var empty=document.getElementById('places-empty');
  if(!grid||!empty) return;

  // Synchroniser l'état des boutons de regroupement avec le mode courant
  // (utile au 1er rendu, où le défaut est « par ville »).
  document.querySelectorAll('.lgs-btn').forEach(function(b){
    b.classList.toggle('active', b.getAttribute('data-group') === _lieuxGroupMode);
  });
  var _fb = document.getElementById('places-filter-bar');
  if(_fb) _fb.style.display = (_lieuxGroupMode === 'none') ? '' : 'none';

  // ── Mode regroupé : par ville ou par catégorie ──
  if(_lieuxGroupMode !== 'none'){
    grid.innerHTML='';
    grid.classList.add('is-grouped');
    if(!lieux.length){ empty.style.display='block'; grid.style.display='none'; return; }
    empty.style.display='none'; grid.style.display='';

    var key = _lieuxGroupMode;            // 'ville' | 'categorie' | 'jour'
    var groups = {};
    var order = [];
    var NO_DATE = 'Sans date';
    lieux.forEach(function(l){
      var g;
      if(key === 'jour'){
        g = (l.jour && String(l.jour).trim()) || NO_DATE;
      } else {
        g = (l[key] && String(l[key]).trim()) || (key==='ville' ? 'Sans ville' : 'Sans catégorie');
      }
      if(!groups[g]){ groups[g] = []; order.push(g); }
      groups[g].push(l);
    });

    if(key === 'jour'){
      // Tri chronologique (AAAA-MM-JJ), « Sans date » en dernier
      order.sort(function(a,b){
        if(a === NO_DATE) return 1;
        if(b === NO_DATE) return -1;
        return a < b ? -1 : a > b ? 1 : 0;
      });
    } else {
      order.sort(function(a,b){ return a.localeCompare(b, 'fr'); });
    }

    // Formatage lisible d'une clé jour (AAAA-MM-JJ → « Lun. 21 juil. 2025 »)
    function _fmtJour(k){
      if(k === NO_DATE) return k;
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k);
      if(!m) return k;
      var d = new Date(+m[1], +m[2]-1, +m[3]);
      var jours = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
      var mois  = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
      return jours[d.getDay()] + '. ' + (+m[3]) + ' ' + mois[+m[2]-1] + ' ' + m[1];
    }

    order.forEach(function(g){
      var section = document.createElement('div');
      section.className = 'lieux-group';
      var head = document.createElement('div');
      head.className = 'lieux-group-head';
      var icon  = '';
      var label = (key==='jour') ? _fmtJour(g) : g;
      head.innerHTML = '<span class="lgh-title">' + icon + label + '</span>'
        + '<span class="lgh-count">' + groups[g].length + '</span>';
      section.appendChild(head);
      var inner = document.createElement('div');
      inner.className = 'lieux-group-grid';
      groups[g].forEach(function(l){ inner.appendChild(_renderLieuCard(l)); });
      section.appendChild(inner);
      grid.appendChild(section);
    });
    _updateLieuxFilters();
    return;
  }

  // ── Mode liste (filtre par ville/catégorie via les chips) ──
  grid.classList.remove('is-grouped');
  lieux.forEach(function(l, i){ if(typeof l.ordre !== 'number') l.ordre = i; });
  var filtered=currentFilter==='Tous'?lieux.slice():lieux.filter(function(l){return l.ville===currentFilter||l.categorie===currentFilter;});
  filtered.sort(function(a,b){ return (a.ordre||0)-(b.ordre||0); });
  grid.innerHTML='';
  if(!filtered.length){ empty.style.display='block'; grid.style.display='none'; return; }
  empty.style.display='none'; grid.style.display='';
  filtered.forEach(function(l){ grid.appendChild(_renderLieuCard(l)); });
  _updateLieuxFilters();
  _initLieuxDrag(grid);
}


function _normalizeLieuVille(v){
  if(!v)return v;
  var lower=v.trim().toLowerCase();
  var match=Object.keys(CITY_DATA).find(function(k){return k.toLowerCase()===lower;});
  return match||v.trim();
}
function onLieuVilleInput(val){
  var paysEl=document.getElementById('lieu-pays');
  var pays=paysEl?paysEl.value.trim().toLowerCase():'';
  var dl=document.getElementById('lieu-ville-datalist');
  if(!dl)return;
  var hits=Object.keys(CITY_DATA).filter(function(c){
    var d=CITY_DATA[c];
    var mp=!pays||(d.pays&&d.pays.toLowerCase().indexOf(pays)!==-1);
    var mv=!val||c.toLowerCase().indexOf(val.toLowerCase())!==-1;
    return mp&&mv;
  }).slice(0,12);
  dl.innerHTML=hits.map(function(c){return '<option value="'+c+'">';}).join('');
}
function _updateLieuxFilters(){
  var ctrl=document.getElementById('places-filter-bar');
  if(!ctrl)return;
  var villes=[],cats=[];
  lieux.forEach(function(l){
    if(l.ville&&villes.indexOf(l.ville)===-1)villes.push(l.ville);
    if(l.categorie&&cats.indexOf(l.categorie)===-1)cats.push(l.categorie);
  });
  ctrl.innerHTML=
    '<button class="filter-btn'+(currentFilter==='Tous'?' active':'')+'" onclick="filterPlaces(\'Tous\',this)">Tous ('+lieux.length+')</button>'
    +villes.map(function(v){
      var n=lieux.filter(function(l){return l.ville===v;}).length;
      return '<button class="filter-btn'+(currentFilter===v?' active':'')+'" onclick="filterPlaces(\''+v.replace(/\'/g,'')+'\',this)">'+v+' ('+n+')</button>';
    }).join('')
    +(cats.length?'<span style="margin:0 6px;color:var(--ink-hint);font-size:11px">|</span>':'')
    +cats.map(function(c){
      var n=lieux.filter(function(l){return l.categorie===c;}).length;
      return '<button class="filter-btn cat-btn'+(currentFilter===c?' active':'')+'" onclick="filterPlaces(\''+c.replace(/\'/g,'')+'\',this)">'+c+' ('+n+')</button>';
    }).join('');
}
function editLieu(id){id=isNaN(+id)?id:+id;
  var l=lieux.find(function(x){return x.id==id;});if(!l)return;
  // Peupler le datalist pays
  setTimeout(function(){ if(typeof _populatePaysDatalists==='function') _populatePaysDatalists(); },0);
  openModal(
    '<div class="modal-header"><div class="modal-title">Modifier ce lieu</div><button class="modal-close" onclick="closeModal()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>'
    +'<div class="modal-row">'
      +modalField('Emoji',mInput('el-emoji',l.emoji,'⛩','max-width:80px'))
      +modalField('Nom',mInput('el-nom',l.nom,'Nom du lieu'))
    +'</div>'
    +'<div class="modal-row">'
      +'<div class="modal-field"><label>Ouverture</label>'
        +'<input type="text" id="el-ouv" value="'+(l.ouverture||'')+'" placeholder="09h00" class="cal-trigger" readonly/></div>'
      +'<div class="modal-field"><label>Fermeture</label>'
        +'<input type="text" id="el-fer" value="'+(l.fermeture||'')+'" placeholder="18h00" class="cal-trigger" readonly/></div>'
    +'</div>'
    +'<div class="addr-block" style="margin:6px 0 4px">'
      +'<div class="addr-block-header"><span class="addr-block-label">Adresse</span></div>'
      +'<div class="addr-grid">'
        +'<div class="addr-field"><label>Pays</label>'
          +'<input type="text" id="el-pays" value="'+(l.pays||'')+'" placeholder="Japon, France…" list="el-pays-datalist"/>'
          +'<datalist id="el-pays-datalist"></datalist></div>'
        +'<div class="addr-field"><label>Ville</label>'
          +'<input type="text" id="el-ville" value="'+(l.ville||'')+'" placeholder="Tokyo, Kyoto…"/></div>'
        +'<div class="addr-field"><label>Code Postal</label>'
          +'<input type="text" id="el-cp" value="'+(l.cp||'')+'" placeholder="604-8344…"/></div>'
        +'<div class="addr-field"><label>Rue / N°</label>'
          +'<input type="text" id="el-rue" value="'+(l.rue||'')+'" placeholder="ex: 1 Gion-machi"/></div>'
      +'</div>'
      +'<button class="btn-verify-addr" id="el-verify-btn" type="button" onclick="verifierAdresse(\'lieu-edit\')">'
        +'<span class="verify-icon"></span> Vérifier l\'adresse'
      +'</button>'
      +'<div class="addr-result-badge" id="el-addr-result"></div>'
    +'</div>'
    +'<div class="modal-row">'
+modalField('Catégorie','<input type="text" id="el-categorie" value="'+(l.categorie||'')+
'" placeholder="Temples, Restaurants…" list="el-cat-dl" autocomplete="off"/>'
+'<datalist id="el-cat-dl"><option value="Temples"><option value="Parcs">'
+'<option value="Randonnées"><option value="Restaurants"><option value="Musées">'
+'<option value="Shopping"><option value="Onsen"><option value="Châteaux">'
+'<option value="Plages"><option value="Points de vue"></datalist>')
+'</div>'
+modalField('Note',mInput('el-note',l.note||'','Conseil, prix…'))
    +modalField('Jour de visite (optionnel)','<input type="date" id="el-jour" value="'+(l.jour||'')+'" style="width:100%"/>')
    +mPdfBlock('el-pdf', l.pdfId||'')
    +modalFooter('saveLieu(\''+id+'\')','deleteLieu(\''+id+'\')',{type:'le lieu',libelle:l.nom||'',hasDoc:!!l.pdfId,fn:'deleteLieu',id:id})
  );
  setTimeout(function(){
    var ouvEl=document.getElementById('el-ouv');
    var ferEl=document.getElementById('el-fer');
    if(ouvEl) ouvEl.onclick=function(){ openTimePicker('el-ouv','Heure d\'ouverture'); };
    if(ferEl) ferEl.onclick=function(){ openTimePicker('el-fer','Heure de fermeture'); };
    if(typeof _populatePaysDatalists==='function') _populatePaysDatalists();
  }, 0);
}
function saveLieu(id){id=isNaN(+id)?id:+id;
  var l=lieux.find(function(x){return x.id==id;});if(!l)return;
  var emoji=document.getElementById('el-emoji'); if(emoji) l.emoji=emoji.value||l.emoji;
  var nom  =document.getElementById('el-nom');   if(nom)   l.nom  =nom.value||l.nom;
  var ville=document.getElementById('el-ville'); if(ville) l.ville=ville.value||l.ville;
  var ouv  =document.getElementById('el-ouv');   if(ouv)   l.ouverture=ouv.value;
  var fer  =document.getElementById('el-fer');   if(fer)   l.fermeture=fer.value;
  var rue  =document.getElementById('el-rue');   if(rue)   l.rue  =rue.value.trim();
  var cp   =document.getElementById('el-cp');    if(cp)    l.cp   =cp.value.trim();
  var pays =document.getElementById('el-pays');  if(pays)  l.pays =pays.value.trim();
  var note =document.getElementById('el-note');  if(note)  l.note =note.value.trim();
  var jour =document.getElementById('el-jour');  if(jour)  l.jour =jour.value;
  var cat  =document.getElementById('el-categorie'); if(cat) l.categorie=cat.value.trim();
  // PDF
  var elPdf=document.getElementById('el-pdf');
  if(elPdf) l.pdfId=elPdf.value;
  if(l.ville) l.ville=_normalizeLieuVille(l.ville);
  var newFull = buildFullAddress(l.rue||'', l.cp||'', l.ville||'', l.pays||'');
  l.fullAddress = newFull;
  l.adresse     = newFull; // compat legacy
  closeModal(); renderLieux(); snapshotCurrentTrip();
  showToast('Lieu mis à jour ', 'success');
}
function filterPlaces(f,btn){
  currentFilter=f;
  document.querySelectorAll('.filter-btn').forEach(function(b){b.classList.remove('active');});
  btn.classList.add('active');
  renderLieux();
}
function addLieu(){
  var nom   = document.getElementById('lieu-nom').value.trim();
  // Ville vient du bloc adresse (lieu-ville-addr) OU du champ legacy lieu-ville
  var villeAddr = (document.getElementById('lieu-ville-addr')||{}).value||'';
  var ville = villeAddr.trim() || (document.getElementById('lieu-ville')||{}).value.trim();
  var emoji = document.getElementById('lieu-emoji').value.trim()||'📍';
  if(!nom){ showToast('Nom du lieu requis', 'error'); return; }
  if(!ville){ showToast('Ville requise dans le bloc Adresse', 'error'); return; }
  var ouv   = (document.getElementById('lieu-ouverture')||{}).value||'';
  var fer   = (document.getElementById('lieu-fermeture')||{}).value||'';
  var note  = (document.getElementById('lieu-note')||{}).value||'';
  var jour  = (document.getElementById('lieu-date')||{}).value||'';
  var pdfId = (document.getElementById('lieu-pdf')||{}).value||'';
  var addr  = _collectAddrFields('lieu');
  addr.ville = ville;
  var fullAddress = buildFullAddress(addr.rue, addr.cp, addr.ville, addr.pays);
  lieux.push({id:uid(), emoji:emoji, nom:nom, ville:ville, visited:false,
    rue:addr.rue, cp:addr.cp, pays:addr.pays,
    fullAddress:fullAddress, adresse:fullAddress,
    ouverture:ouv, fermeture:fer, note:note, jour:jour, pdfId:pdfId,
    ordre: lieux.length,
    lat:parseFloat((document.getElementById('lieu-adresse-lat')||{}).value)||null,
    lng:parseFloat((document.getElementById('lieu-adresse-lng')||{}).value)||null
  });
  ['lieu-nom','lieu-emoji','lieu-ville','lieu-ville-addr','lieu-categorie','lieu-ouverture','lieu-fermeture',
   'lieu-rue','lieu-cp','lieu-pays','lieu-note','lieu-date','lieu-pdf',
   'lieu-adresse-lat','lieu-adresse-lng','lieu-magic-input']
    .forEach(function(fid){var el=document.getElementById(fid);if(el)el.value='';});
  var badge=document.getElementById('lieu-pdf-badge'); if(badge) badge.innerHTML='';
  var res=document.getElementById('lieu-addr-result'); if(res){res.className='addr-result-badge';res.textContent='';}
  var btn=document.getElementById('lieu-verify-btn'); if(btn) btn.className='btn-verify-addr';
  toggleForm('form-lieu');
  renderLieux();
  snapshotCurrentTrip();
  showToast('Lieu ajouté', 'success');
}
function deleteLieu(id){id=isNaN(+id)?id:+id;
  lieux=lieux.filter(function(l){return l.id!=id;});
  closeModal();renderLieux();snapshotCurrentTrip();
}

function _initLieuxDrag(grid){
  var handles = grid.querySelectorAll('.drag-handle');
  if(!handles.length) return;

  var _dragId   = null;
  var _ghost    = null;
  var _dragEl   = null;
  var _insertIdx = -1;
  var _offsetY  = 0;

  var _line = document.createElement('div');
  _line.className = 'drag-insert-line';
  grid.appendChild(_line);

  function _getSorted(){
    var f = (currentFilter === 'Tous')
      ? lieux.slice()
      : lieux.filter(function(l){ return l.ville===currentFilter||l.categorie===currentFilter; });
    f.sort(function(a,b){ return (a.ordre||0)-(b.ordre||0); });
    return f;
  }

  function _startDrag(e){
    e.preventDefault();
    e.stopPropagation();
    var handle = this;
    var card = handle.parentNode;
    while(card && !card.classList.contains('place-card')) card = card.parentNode;
    if(!card) return;
    var touch = (e.touches && e.touches[0]) || e;
    var rect = card.getBoundingClientRect();
    _dragEl = card;
    _dragId = card.getAttribute('data-lieu-id');
    _offsetY = touch.clientY - rect.top;
    _ghost = card.cloneNode(true);
    _ghost.style.cssText = 'position:fixed;left:'+rect.left+'px;width:'+rect.width+'px;top:'+rect.top+'px;z-index:9000;pointer-events:none;opacity:.88;box-shadow:0 8px 24px rgba(0,0,0,.18);border-radius:14px';
    document.body.appendChild(_ghost);
    card.style.opacity = '0.25';
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';
    document.addEventListener('mousemove', _onMove);
    document.addEventListener('mouseup', _endDrag);
    document.addEventListener('touchmove', _onMove, {passive:false});
    document.addEventListener('touchend', _endDrag);
  }

  function _onMove(e){
    if(!_ghost) return;
    e.preventDefault();
    var touch = (e.touches && e.touches[0]) || e;
    var y = touch.clientY;
    _ghost.style.top = (y - _offsetY) + 'px';
    var cards = grid.querySelectorAll('.place-card');
    var newIdx = cards.length;
    for(var i = 0; i < cards.length; i++){
      if(cards[i] === _dragEl) continue;
      var cr = cards[i].getBoundingClientRect();
      if(y < cr.top + cr.height / 2){ newIdx = i; break; }
    }
    _insertIdx = newIdx;
    var gridRect = grid.getBoundingClientRect();
    if(newIdx < cards.length && cards[newIdx] !== _dragEl){
      var t = cards[newIdx].getBoundingClientRect().top - gridRect.top - 5;
      _line.style.cssText = 'display:block;top:'+Math.max(0,t)+'px';
    } else {
      var last = null;
      for(var j = cards.length-1; j >= 0; j--){ if(cards[j] !== _dragEl){ last = cards[j]; break; } }
      if(last){ _line.style.cssText = 'display:block;top:'+(last.getBoundingClientRect().bottom-gridRect.top+5)+'px'; }
    }
  }

  function _endDrag(){
    document.removeEventListener('mousemove', _onMove);
    document.removeEventListener('mouseup', _endDrag);
    document.removeEventListener('touchmove', _onMove);
    document.removeEventListener('touchend', _endDrag);
    if(_ghost){ document.body.removeChild(_ghost); _ghost = null; }
    if(_dragEl){ _dragEl.style.opacity = ''; _dragEl = null; }
    _line.style.display = 'none';
    document.body.style.userSelect = '';
    document.body.style.webkitUserSelect = '';
    if(!_dragId || _insertIdx === -1){ _dragId=null; _insertIdx=-1; return; }
    var sorted = _getSorted();
    var dragIdx = -1;
    for(var i = 0; i < sorted.length; i++){
      if(String(sorted[i].id) === String(_dragId)){ dragIdx = i; break; }
    }
    if(dragIdx === -1 || _insertIdx === dragIdx || _insertIdx === dragIdx+1){
      _dragId=null; _insertIdx=-1; return;
    }
    var moved = sorted.splice(dragIdx, 1)[0];
    var at = (_insertIdx > dragIdx) ? _insertIdx-1 : _insertIdx;
    sorted.splice(at, 0, moved);
    if(currentFilter === 'Tous'){
      for(var i = 0; i < sorted.length; i++) sorted[i].ordre = i;
    } else {
      var allSorted = lieux.slice().sort(function(a,b){ return (a.ordre||0)-(b.ordre||0); });
      var filtSet = {};
      for(var i = 0; i < sorted.length; i++) filtSet[sorted[i].id] = true;
      var positions = [];
      for(var i = 0; i < allSorted.length; i++){ if(filtSet[allSorted[i].id]) positions.push(i); }
      for(var i = 0; i < positions.length; i++) allSorted[positions[i]] = sorted[i];
      for(var i = 0; i < allSorted.length; i++) allSorted[i].ordre = i;
    }
    _dragId=null; _insertIdx=-1;
    snapshotCurrentTrip();
    renderLieux();
  }

  var hs = grid.querySelectorAll('.drag-handle');
  for(var i = 0; i < hs.length; i++){
    hs[i].addEventListener('mousedown', _startDrag);
    hs[i].addEventListener('touchstart', _startDrag, {passive:false});
  }
}

// ══════════════════════════════════════════════════════════════════
// CONVERTISSEUR — Multi-devises & contextuel au voyage
// ══════════════════════════════════════════════════════════════════

// ── Dictionnaire pays → devise ──
// [migrated to module — see header]

// ── Infos par code devise : nom, symbole, presets ──
// [migrated to module — see header]

// ── État du convertisseur ──
var convLocalCode = 'JPY';   // code devise destination (du voyage actif)
var convMode      = 'EUR_TO_LOCAL'; // 'EUR_TO_LOCAL' ou 'LOCAL_TO_EUR'
var convRate      = 160;     // taux : 1 EUR = convRate LOCAL
var rateLoaded    = false;
var eurJpyRate    = 160;     // alias gardé pour compatibilité budget

// Taux de repli par défaut (hors-ligne)
// [migrated to module — see header]

// ── Détecter la devise du voyage actif ──
function getTripCurrency(){
  if(!currentTripId || !allTrips[currentTripId]) return 'EUR';
  var meta = allTrips[currentTripId].meta || {};
  // Pays principal défini → sa devise
  if(meta.primaryCountry && COUNTRY_CURRENCY[meta.primaryCountry])
    return COUNTRY_CURRENCY[meta.primaryCountry];
  // Rétrocompat : meta.country seul (anciens voyages sans multi-pays)
  if(meta.country && COUNTRY_CURRENCY[meta.country] && !(meta.countries && meta.countries.length > 1))
    return COUNTRY_CURRENCY[meta.country];
  // Road-trip multi-pays sans principal → EUR
  return 'EUR';
}

function getCurrencyInfo(code){
  return CURRENCY_INFO[code] || {name:code, sym:code, presets:[1,5,10,50,100,500]};
}

// ── Fetch taux depuis l'API ExchangeRate-API ──
function fetchRate(){
  var info = document.getElementById('conv-rate-info');
  if(info) info.textContent = 'Chargement…';

  fetch('https://api.exchangerate-api.com/v4/latest/EUR')
    .then(function(r){ return r.json(); })
    .then(function(data){
      if(data && data.rates){
        // Stocker TOUS les taux reçus pour usage hors-ligne
        window._cachedRates = data.rates;
        rateLoaded = true;
        // Compatibilité budget
        if(data.rates.JPY) eurJpyRate = data.rates.JPY;
      }
      applyRateForCurrentTrip();
      updateRateDisplay();
    })
    .catch(function(){
      rateLoaded = false;
      applyRateForCurrentTrip();
      updateRateDisplay();
    });
}

// ── Appliquer le taux pour la devise du voyage actif ──
var _convUserPicked = false;  // true = l'utilisateur a changé la devise manuellement

function applyRateForCurrentTrip(){
  if(!_convUserPicked){
    convLocalCode = getTripCurrency();
    // Sync le select si visible
    var sel = document.getElementById('conv-devise-select');
    if(sel && sel.querySelector('option[value="'+convLocalCode+'"]')) sel.value = convLocalCode;
  }
  var cached = window._cachedRates;
  convRate = (cached && cached[convLocalCode]) ? cached[convLocalCode] : (FALLBACK_RATES[convLocalCode] || 1);
  if(convLocalCode === 'JPY') eurJpyRate = convRate;
}

// ── Construire le select devise du convertisseur ──
function _buildConvDeviseSelect(){
  var sel = document.getElementById('conv-devise-select');
  if(!sel) return;
  var tripCodes = [];
  if(currentTripId && allTrips[currentTripId]){
    var meta = allTrips[currentTripId].meta || {};
    var countries = (meta.countries && meta.countries.length) ? meta.countries : (meta.country ? [meta.country] : []);
    countries.forEach(function(c){
      var code = COUNTRY_CURRENCY[c];
      if(code && code !== 'EUR' && tripCodes.indexOf(code) === -1) tripCodes.push(code);
    });
  }
  if(!tripCodes.length) tripCodes = ['JPY','USD','GBP','CHF','KRW'];
  sel.innerHTML = tripCodes.map(function(code){
    var info = (typeof CURRENCY_INFO !== 'undefined' && CURRENCY_INFO[code]) || {sym:code, name:code};
    return '<option value="'+code+'">'+info.sym+' '+info.name+' ('+code+')</option>';
  }).join('');
  var def = getTripCurrency();
  if(def === 'EUR') def = tripCodes[0] || 'JPY';
  sel.value = sel.querySelector('option[value="'+def+'"]') ? def : (tripCodes[0] || 'JPY');
  if(!_convUserPicked) convLocalCode = sel.value;
}

// ── Handler changement devise convertisseur (mémorisé) ──
function onConvDeviseChange(code){
  if(!code) return;
  convLocalCode   = code;
  _convUserPicked = true;
  var cached = window._cachedRates;
  convRate  = (cached && cached[code]) ? cached[code] : (FALLBACK_RATES[code] || 1);
  rateLoaded = !!(cached && cached[code]);
  if(code === 'JPY') eurJpyRate = convRate;
  updateRateDisplay();
}

// ── Taux manuel (hors-ligne) ──
function applyManualRate(){
  var v = parseFloat(document.getElementById('conv-manual-input').value);
  if(!isNaN(v) && v > 0){
    convRate = v;
    if(!window._cachedRates) window._cachedRates = {};
    window._cachedRates[convLocalCode] = v;
    if(convLocalCode === 'JPY') eurJpyRate = v;
    rateLoaded = true;
    updateRateDisplay();
  }
}

// ── Mise à jour de l'affichage ──
function updateRateDisplay(){
  applyRateForCurrentTrip();
  var localInfo = getCurrencyInfo(convLocalCode);
  var rateStr  = convRate.toLocaleString('fr-FR',{maximumFractionDigits:convRate>=100?0:4});
  var rateInv  = (1/convRate).toLocaleString('fr-FR',{minimumFractionDigits:4,maximumFractionDigits:4});

  var rdEl = document.getElementById('conv-rate-display');
  if(rdEl) rdEl.textContent = '1 € = ' + rateStr + ' ' + localInfo.sym + ' (' + convLocalCode + ')';

  var riEl = document.getElementById('conv-rate-inv');
  if(riEl) riEl.textContent = '1 ' + localInfo.sym + ' = ' + rateInv + ' €';

  var infoEl = document.getElementById('conv-rate-info');
  if(infoEl) infoEl.textContent = rateLoaded
    ? 'Taux temps réel · ' + new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})
    : 'Taux approximatif · mise à jour manuelle possible';

  // Titre de section
  var titleEl = document.getElementById('conv-section-title');
  if(titleEl) titleEl.textContent = 'Convertisseur € ↔ ' + localInfo.sym;

  // Badge devise destination dans hero
  var badgeEl = document.getElementById('conv-dest-badge');
  if(badgeEl){
    var meta = (currentTripId && allTrips[currentTripId]) ? (allTrips[currentTripId].meta||{}) : {};
    var countries = (meta.countries && meta.countries.length) ? meta.countries : (meta.country ? [meta.country] : []);
    var primaryC  = meta.primaryCountry || countries[0] || '';
    if(countries.length > 1){
      // Multi-pays : afficher tous les drapeaux
      var flags = countries.map(function(c){ return isoToFlag(countryToISO(c)); }).join(' ');
      badgeEl.innerHTML = '<div class="conv-currency-badge"><span class="cb-flag">'+flags+'</span>'
        +(primaryC?primaryC+' (principal)':countries.join(', '))+' — '+localInfo.name+' ('+convLocalCode+')</div>';
    } else if(primaryC && convLocalCode !== 'EUR'){
      var flag = isoToFlag(countryToISO(primaryC));
      badgeEl.innerHTML = '<div class="conv-currency-badge"><span class="cb-flag">'+flag+'</span>'
        +primaryC+' — '+localInfo.name+' ('+convLocalCode+')</div>';
    } else {
      badgeEl.innerHTML = '<div class="conv-no-dest">Sélectionne une devise ou définis un pays principal.</div>';
    }
  }

  // Mode hors-ligne : afficher taux manuel
  var manualWrap = document.getElementById('conv-manual-wrap');
  if(manualWrap){
    manualWrap.style.display = rateLoaded ? 'none' : 'flex';
    var mi = document.getElementById('conv-manual-input');
    if(mi) mi.value = convRate;
    var mc = document.getElementById('conv-manual-cur');
    if(mc) mc.textContent = localInfo.sym;
  }

  buildRefTable();
  updateBudget();
  applyConvMode();
}

function applyConvMode(){
  var localInfo = getCurrencyInfo(convLocalCode);
  var leftLabel  = document.getElementById('conv-label-left');
  var rightLabel = document.getElementById('conv-label-right');
  var symLeft    = document.getElementById('conv-sym-left');
  var symRight   = document.getElementById('conv-sym-right');
  if(!leftLabel) return;

  if(convMode === 'EUR_TO_LOCAL'){
    leftLabel.textContent  = '€ Euro';
    rightLabel.textContent = localInfo.sym + ' ' + localInfo.name;
    if(symLeft)  symLeft.textContent  = '€';
    if(symRight) symRight.textContent = localInfo.sym;
  } else {
    leftLabel.textContent  = localInfo.sym + ' ' + localInfo.name;
    rightLabel.textContent = '€ Euro';
    if(symLeft)  symLeft.textContent  = localInfo.sym;
    if(symRight) symRight.textContent = '€';
  }
  buildPresets();
  convertLeft();
}

function buildPresets(){
  var wrap = document.getElementById('conv-presets');
  if(!wrap) return;
  var localInfo = getCurrencyInfo(convLocalCode);
  var isEurLeft = (convMode === 'EUR_TO_LOCAL');
  var presets   = isEurLeft ? [5,10,20,50,100,200] : localInfo.presets;
  var sym       = isEurLeft ? '€' : localInfo.sym;
  wrap.innerHTML = '<span style="font-size:11px;color:var(--ink-hint);width:100%;margin-bottom:2px">Montants rapides :</span>'
    + presets.map(function(v){
        var label = v >= 1000 ? (v/1000).toLocaleString('fr-FR')+'k' : v.toLocaleString('fr-FR');
        return '<button class="preset-btn-local" onclick="setPreset('+v+')">'+sym+' '+label+'</button>';
      }).join('');
}

function convertLeft(){
  var v  = parseFloat(document.getElementById('conv-left').value);
  var el = document.getElementById('conv-result');
  if(!el) return;
  if(isNaN(v) || v < 0){ el.textContent = '—'; return; }
  var result;
  var localInfo = getCurrencyInfo(convLocalCode);
  var isHighVal = convRate >= 100; // devises à forte valeur nominale (JPY, KRW, VND…)
  if(convMode === 'EUR_TO_LOCAL'){
    result = v * convRate;
    el.textContent = isHighVal
      ? Math.round(result).toLocaleString('fr-FR')
      : result.toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2});
  } else {
    result = v / convRate;
    el.textContent = result.toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2});
  }
}

function setPreset(val){
  document.getElementById('conv-left').value = val;
  convertLeft();
}

function swapConverter(){
  convMode = (convMode === 'EUR_TO_LOCAL') ? 'LOCAL_TO_EUR' : 'EUR_TO_LOCAL';
  document.getElementById('conv-left').value = '';
  document.getElementById('conv-result').textContent = '—';
  applyConvMode();
}

function buildRefTable(){
  var el = document.getElementById('conv-ref-table');
  if(!el) return;
  var localInfo = getCurrencyInfo(convLocalCode);
  var isHighVal = convRate >= 100;
  // Générer des valeurs EUR adaptées
  var eurVals = convRate >= 500
    ? [1,2,5,10,20,50,100,200,500]
    : [1,2,5,10,20,50,100,200,500];
  el.innerHTML = eurVals.map(function(eur){
    var local = eur * convRate;
    var localStr = isHighVal
      ? Math.round(local).toLocaleString('fr-FR')
      : local.toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2});
    return '<div class="ref-row">'
      +'<span class="ref-from">'+eur+' €</span>'
      +'<span style="color:var(--ink-hint);font-size:12px">→</span>'
      +'<span class="ref-to">'+localStr+' '+localInfo.sym+'</span>'
    +'</div>';
  }).join('');
}

// jpyToEur — wrapper multi-devises (voir localToEur + jpyToEur ci-dessous)


// ══════════════════════════════════════════
// BUDGET (avec multi-devises)
// ══════════════════════════════════════════
// [migrated to module — see header]
// ── Palette de couleurs unifiée — source de vérité pour TOUT le budget ──
var catColors={
  'Repas'      :'#4CAF50',   // Vert frais
  'Transport'  :'#B08D3E',   // Doré/marron élégant
  'Hébergement':'#F08080',   // Rose doux
  'Activités'  :'#5C6BC0',   // Bleu indigo
  'Shopping'   :'#9575CD',   // Violet doux
  'Santé'      :'#FF7043',   // Orange corail
  'Divers'     :'#78909C'    // Gris bleuté
};
// Nettoie une valeur de catégorie de son emoji de préfixe : "🍱 Repas" → "Repas"
function _catClean(cat){
  cat = String(cat==null?'':cat);
  var sp = cat.indexOf(' ');
  if(sp > 0){
    var first = cat.slice(0, sp);
    if(!/[a-zA-ZÀ-ÿ]/.test(first)) return cat.slice(sp+1).trim();
  }
  return cat.trim();
}
function _catColor(cat){
  return catColors[_catClean(cat)] || '#9aa3b0';
}

// ── Conversion universelle devise locale → EUR ──
// Utilise convRate (1 EUR = convRate LOCAL) en priorité,
// avec fallback sur FALLBACK_RATES pour les devises inactives.
function localToEur(amount, devCode){
  if(!devCode || devCode === 'EUR') return amount;
  // Taux live d'abord
  var cached = window._cachedRates;
  if(cached && cached[devCode]) return amount / cached[devCode];
  // Fallback statique
  if(typeof FALLBACK_RATES !== 'undefined' && FALLBACK_RATES[devCode]) return amount / FALLBACK_RATES[devCode];
  // Devise du voyage courant : utiliser convRate
  if(typeof convLocalCode !== 'undefined' && devCode === convLocalCode) return amount / convRate;
  return amount; // en dernier recours, on renvoie tel quel
}

function jpyToEur(jpy){ return localToEur(jpy, 'JPY'); }

function setBudget(){
  var v=parseFloat(document.getElementById('budget-input').value);
  if(!isNaN(v)&&v>=0){budget=v;document.getElementById('budget-input').value='';updateBudget();snapshotCurrentTrip();}
}

function addTransaction(){
  var desc   = document.getElementById('tx-desc').value.trim();
  var raw    = parseFloat(document.getElementById('tx-amount').value);
  var devise = document.getElementById('tx-devise').value;
  var cat    = document.getElementById('tx-cat').value;
  var date   = document.getElementById('tx-date').value || new Date().toISOString().slice(0,10);
  if(!desc || isNaN(raw) || raw <= 0) return;

  var amountEur = (devise === 'EUR') ? raw : localToEur(raw, devise);
  var pdfId = (document.getElementById('tx-pdf')||{}).value||'';

  transactions.push({id:uid(), desc:desc, raw:raw, devise:devise, amount:amountEur, cat:cat, date:date, pdfId:pdfId});
  document.getElementById('tx-desc').value   = '';
  document.getElementById('tx-amount').value = '';
  var _txPdf = document.getElementById('tx-pdf'); if(_txPdf) _txPdf.value = '';
  var _txPdfBadge = document.getElementById('tx-pdf-badge'); if(_txPdfBadge) _txPdfBadge.innerHTML = '';
  // Remettre la devise par défaut du voyage (pas forcer EUR, mais le choix du voyage)
  _buildTxDeviseSelect();

  if(typeof showToast === 'function'){
    var info = (typeof CURRENCY_INFO !== 'undefined' && CURRENCY_INFO[devise]) ? CURRENCY_INFO[devise] : null;
    var sym  = info ? info.sym : (devise === 'EUR' ? '€' : devise);
    var msg  = devise === 'EUR'
      ? desc + ' — ' + raw.toLocaleString('fr-FR',{minimumFractionDigits:2}) + ' € ajouté'
      : desc + ' — ' + raw.toLocaleString('fr-FR') + ' ' + sym + ' → ' + amountEur.toLocaleString('fr-FR',{minimumFractionDigits:2}) + ' € ajouté';
    showToast(msg, 'success', 2800);
  }
  updateBudget();
  snapshotCurrentTrip();
  if(typeof toggleForm === 'function'){ var _tf=document.getElementById('form-tx'); if(_tf && _tf.classList.contains('open')) toggleForm('form-tx'); }
}

function deleteTransaction(id){
  transactions=transactions.filter(function(t){return t.id!=id;});
  closeModal();updateBudget();snapshotCurrentTrip();
}

function editTransaction(id){
  var t=transactions.find(function(x){return x.id==id;});if(!t)return;
  // Mêmes devises que le formulaire de création, déjà construit pour le voyage actif
  var deviseOptionsHtml = (document.getElementById('tx-devise')||{}).innerHTML || '<option value="EUR">€ Euro</option>';
  var catOptions = ['🍱 Repas','🚉 Transport','🏯 Hébergement','🎌 Activités','🛍 Shopping','💊 Santé','📱 Divers'];
  openModal(
    '<div class="modal-header"><div class="modal-title">Modifier cette transaction</div><button class="modal-close" onclick="closeModal()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>'
    +'<div class="modal-row">'
      +modalField('Description',mInput('etx-desc',t.desc,'Ramen Ichiran','width:100%'))
    +'</div>'
    +'<div class="modal-row">'
      +modalField('Montant',mInput('etx-amount',t.raw,'ex: 12.50','max-width:120px'))
      +'<div class="modal-field"><label>Devise</label><select id="etx-devise" style="flex:1;min-width:0;padding:9px 12px;font-size:13px;font-family:DM Sans,sans-serif;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface-2);color:var(--ink);outline:none">'+deviseOptionsHtml+'</select></div>'
    +'</div>'
    +'<div class="modal-row">'
      +'<div class="modal-field"><label>Catégorie</label><select id="etx-cat" style="flex:1;min-width:0;padding:9px 12px;font-size:13px;font-family:DM Sans,sans-serif;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface-2);color:var(--ink);outline:none">'
        +catOptions.map(function(o){return '<option'+(o===t.cat?' selected':'')+'>'+o+'</option>';}).join('')
      +'</select></div>'
      +modalField('Date','<input type="date" id="etx-date" value="'+(t.date||'')+'" style="padding:9px 10px;font-size:13px;font-family:DM Sans,sans-serif;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface-2);color:var(--ink);outline:none;width:100%"/>')
    +'</div>'
    +mPdfBlock('etx-pdf', t.pdfId||'')
    +modalFooter('saveTransaction(\''+id+'\')','deleteTransaction(\''+id+'\')',{type:'la dépense',libelle:t.desc||'',hasDoc:!!t.pdfId,fn:'deleteTransaction',id:id})
  );
  var devSel=document.getElementById('etx-devise'); if(devSel) devSel.value=t.devise;
}

function saveTransaction(id){
  var t=transactions.find(function(x){return x.id==id;});if(!t)return;
  var desc = (document.getElementById('etx-desc')||{}).value||'';
  var raw  = parseFloat((document.getElementById('etx-amount')||{}).value);
  if(!desc.trim() || isNaN(raw) || raw<=0) return;
  t.desc   = desc.trim();
  t.raw    = raw;
  t.devise = (document.getElementById('etx-devise')||{}).value||t.devise;
  t.cat    = (document.getElementById('etx-cat')||{}).value||t.cat;
  t.date   = (document.getElementById('etx-date')||{}).value||t.date;
  t.amount = (t.devise==='EUR') ? raw : localToEur(raw, t.devise);
  var etxPdf=document.getElementById('etx-pdf');
  if(etxPdf) t.pdfId=etxPdf.value;
  closeModal();updateBudget();snapshotCurrentTrip();
  showToast('Transaction mise à jour','success');
}

// ══════════════════════════════════════════════════════════════════
// EXPORT MODULAIRE DES FACTURES → PDF unique (dossier de remboursement)
// Source : transactions du voyage actif ayant une pièce jointe (pdfId).
// Fusion PDF + images via pdf-lib (local, hors-ligne). Page de garde
// récapitulative en 1re page. Sélection hiérarchique catégorie → facture.
// ══════════════════════════════════════════════════════════════════

// Ordre d'affichage/tri des catégories (par libellé nettoyé). Inconnues → fin.
var _EXP_CAT_ORDER = ['Transport','Hébergement','Repas','Activités','Shopping','Santé','Divers'];
function _expCatRank(clean){
  var i = _EXP_CAT_ORDER.indexOf(clean);
  return i === -1 ? 99 : i;
}

// Factures exportables du voyage actif (pdfId présent ET entrée pdfStore valide)
function _expFactures(){
  if(typeof transactions === 'undefined' || !transactions) return [];
  return transactions.filter(function(t){
    return t.pdfId && window.pdfStore && window.pdfStore[t.pdfId] && window.pdfStore[t.pdfId].data;
  });
}

// Clé de tri date : "JJ/MM" ou "JJ/MM/AAAA" → nombre comparable
function _expDateKey(d){
  var m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.exec(String(d||''));
  if(!m) return 99999999;
  var y = m[3] ? (m[3].length===2 ? 2000+ +m[3] : +m[3]) : 2000;
  return y*10000 + (+m[2])*100 + (+m[1]);
}

// Comparateur : catégorie (rang) puis date puis libellé
function _expCmp(a, b){
  var ra=_expCatRank(_catClean(a.cat)), rb=_expCatRank(_catClean(b.cat));
  if(ra!==rb) return ra-rb;
  var na=_catClean(a.cat), nb=_catClean(b.cat);
  if(na!==nb) return na<nb?-1:1;
  var da=_expDateKey(a.date), db=_expDateKey(b.date);
  if(da!==db) return da-db;
  return 0;
}

// Ouvre la modale de sélection
function openExportFactures(){
  var facs = _expFactures();
  var tripName = (allTrips[currentTripId]&&allTrips[currentTripId].meta&&allTrips[currentTripId].meta.name)||'ce voyage';
  var head = '<div class="modal-header"><div class="modal-title">Exporter les factures</div>'
    +'<button class="modal-close" onclick="closeModal()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';

  if(!facs.length){
    openModal(head
      +'<div class="exp-empty">Aucune facture attachée dans ce voyage.<br>Ajoute un justificatif à une dépense (crayon d\'une transaction) pour l\'exporter ici.</div>');
    return;
  }

  // Regrouper par catégorie (clé = cat brute avec emoji ; libellé = _catClean)
  var groups = {}, order = [];
  facs.forEach(function(t){
    var k = t.cat || '';
    if(!groups[k]){ groups[k]=[]; order.push(k); }
    groups[k].push(t);
  });
  order.sort(function(a,b){
    var ra=_expCatRank(_catClean(a)), rb=_expCatRank(_catClean(b));
    if(ra!==rb) return ra-rb;
    var na=_catClean(a), nb=_catClean(b);
    return na<nb?-1:na>nb?1:0;
  });

  var html = head
    +'<div class="exp-presets">'
      +'<button type="button" class="exp-preset-btn" onclick="_expPreset(\'cse\')">CSE</button>'
      +'<button type="button" class="exp-preset-btn" onclick="_expPreset(\'opco\')">OPCO</button>'
    +'</div>'
    +'<div class="exp-preset-hint">CSE : Transport + Hébergement · OPCO : Transport + Hébergement + Repas. Ajuste ensuite facture par facture.</div>'
    +'<div class="exp-body">';

  order.forEach(function(k, ci){
    var clean = _catClean(k);
    var color = (typeof _catColor==='function') ? _catColor(k) : 'var(--sakura)';
    var arr = groups[k].slice().sort(function(a,b){ return _expDateKey(a.date)-_expDateKey(b.date); });
    var catTotal = arr.reduce(function(s,t){ return s+(+t.amount||0); },0);
    html += '<div class="exp-cat">'
      +'<label class="exp-cat-head">'
        +'<input type="checkbox" class="exp-chk exp-cat-chk" data-exp-cat="'+ci+'" data-exp-catclean="'+_tlEsc(clean)+'"/>'
        +'<span class="exp-cat-dot" style="background:'+color+'"></span>'
        +'<span class="exp-cat-name">'+_tlEsc(clean)+'</span>'
        +'<span class="exp-cat-total">'+arr.length+' · '+_expFmtEur(catTotal)+'</span>'
      +'</label>';
    arr.forEach(function(t){
      html += '<label class="exp-fac-row">'
        +'<input type="checkbox" class="exp-chk exp-fac-chk" data-exp-fac="'+_tlEsc(String(t.id))+'" data-exp-catkey="'+ci+'"/>'
        +'<span class="exp-fac-main">'
          +'<span class="exp-fac-desc">'+_tlEsc(t.desc||'(sans libellé)')+'</span>'
          +'<span class="exp-fac-meta">'+_tlEsc(t.date||'')+'</span>'
        +'</span>'
        +'<span class="exp-fac-amount">'+_expFmtEur(+t.amount||0)+'</span>'
      +'</label>';
    });
    html += '</div>';
  });

  html += '</div>'
    +'<div class="exp-footer">'
      +'<span class="exp-count" id="exp-count">0 facture sélectionnée</span>'
      +'<button class="btn-ghost" onclick="closeModal()">Annuler</button>'
      +'<button class="btn-primary" id="exp-run-btn" onclick="_exportFacturesRun()">Exporter</button>'
    +'</div>';

  openModal(html);
  _expWire();
  _expRefreshState();
}

// Câblage des cases (délégation locale sur le conteneur de la modale)
function _expWire(){
  var root = document.getElementById('editModalInner');
  if(!root) return;
  root.addEventListener('change', function(e){
    var el = e.target;
    if(!el || el.className.indexOf('exp-chk')===-1) return;
    if(el.getAttribute('data-exp-cat') != null){
      // Case catégorie → propager à ses factures
      var k = el.getAttribute('data-exp-cat');
      var facs = root.querySelectorAll('.exp-fac-chk[data-exp-catkey="'+k+'"]');
      for(var i=0;i<facs.length;i++){ facs[i].checked = el.checked; }
    } else if(el.getAttribute('data-exp-fac') != null){
      // Case facture → recalculer l'état de sa catégorie
      _expSyncCat(root, el.getAttribute('data-exp-catkey'));
    }
    _expRefreshState();
  });
}

// Met à jour la case catégorie (cochée / indéterminée / décochée)
function _expSyncCat(root, k){
  var catChk = root.querySelector('.exp-cat-chk[data-exp-cat="'+k+'"]');
  if(!catChk) return;
  var facs = root.querySelectorAll('.exp-fac-chk[data-exp-catkey="'+k+'"]');
  var total=facs.length, on=0;
  for(var i=0;i<facs.length;i++){ if(facs[i].checked) on++; }
  catChk.checked = (on===total && total>0);
  catChk.indeterminate = (on>0 && on<total);
}

// Recalcule le compteur + état du bouton Exporter
function _expRefreshState(){
  var root = document.getElementById('editModalInner');
  if(!root) return;
  var facs = root.querySelectorAll('.exp-fac-chk');
  var on=0;
  for(var i=0;i<facs.length;i++){ if(facs[i].checked) on++; }
  var cnt = document.getElementById('exp-count');
  if(cnt) cnt.textContent = on + ' facture' + (on>1?'s':'') + ' sélectionnée' + (on>1?'s':'');
  var btn = document.getElementById('exp-run-btn');
  if(btn){ btn.disabled = (on===0); btn.style.opacity = on===0 ? '.5' : ''; }
}

// Preset : coche les catégories dont le libellé nettoyé est dans la liste
function _expPreset(kind){
  var wanted = (kind==='opco') ? ['Transport','Hébergement','Repas'] : ['Transport','Hébergement'];
  var root = document.getElementById('editModalInner');
  if(!root) return;
  var cats = root.querySelectorAll('.exp-cat-chk');
  for(var i=0;i<cats.length;i++){
    var k = cats[i].getAttribute('data-exp-cat');
    var want = wanted.indexOf(cats[i].getAttribute('data-exp-catclean')) !== -1;
    cats[i].checked = want;
    cats[i].indeterminate = false;
    var facs = root.querySelectorAll('.exp-fac-chk[data-exp-catkey="'+k+'"]');
    for(var j=0;j<facs.length;j++){ facs[j].checked = want; }
  }
  _expRefreshState();
}

// Lance la génération du PDF fusionné
function _exportFacturesRun(){
  var root = document.getElementById('editModalInner');
  if(!root) return;
  if(typeof PDFLib === 'undefined'){ if(typeof showToast==='function') showToast('Librairie PDF indisponible (recharge la page)','error',4000); return; }
  var boxes = root.querySelectorAll('.exp-fac-chk');
  var chosen = [];
  for(var i=0;i<boxes.length;i++){
    if(boxes[i].checked){
      var id = boxes[i].getAttribute('data-exp-fac');
      var t = transactions.filter(function(x){ return String(x.id)===id; })[0];
      if(t) chosen.push(t);
    }
  }
  if(!chosen.length){ if(typeof showToast==='function') showToast('Sélectionne au moins une facture','error'); return; }
  chosen.sort(_expCmp);
  var tripName = (allTrips[currentTripId]&&allTrips[currentTripId].meta&&allTrips[currentTripId].meta.name)||'voyage';
  var btn = document.getElementById('exp-run-btn');
  if(btn){ btn.disabled=true; btn.textContent='Génération…'; }
  _expMergePDF(chosen, tripName).then(function(bytes){
    _expDownload(bytes, 'factures-'+_expSlug(tripName)+'.pdf');
    closeModal();
    if(typeof showToast==='function') showToast('PDF des factures généré','success');
  }).catch(function(e){
    if(typeof console!=='undefined') console.error('[Yume] export factures:', e);
    if(btn){ btn.disabled=false; btn.textContent='Exporter'; }
    if(typeof showToast==='function') showToast('Échec de la génération du PDF','error',4000);
  });
}

// dataURL base64 → Uint8Array
function _dataUrlToBytes(dataUrl){
  var base64 = String(dataUrl||'').split(',')[1] || '';
  var bin = atob(base64);
  var len = bin.length, bytes = new Uint8Array(len);
  for(var i=0;i<len;i++){ bytes[i] = bin.charCodeAt(i); }
  return bytes;
}
function _expMime(dataUrl){
  var m = /^data:([^;]+)/.exec(String(dataUrl||''));
  return m ? m[1].toLowerCase() : '';
}
function _expSlug(s){
  return String(s||'voyage').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40) || 'voyage';
}
function _expFmtEur(n){
  var s = (Math.round((+n||0)*100)/100).toFixed(2).replace('.',',');
  var parts = s.split(',');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return parts[0]+','+parts[1]+' €';
}

// Assainit un texte pour Helvetica/WinAnsi : garde ASCII + Latin-1 + €, sinon drop.
// Renvoie {text, lossy}.
function _pdfSafe(str){
  str = String(str==null?'':str);
  var out='', lossy=false;
  for(var i=0;i<str.length;i++){
    var c = str.charCodeAt(i);
    if((c>=32 && c<=126) || (c>=160 && c<=255) || c===0x20AC){ out += str.charAt(i); }
    else { lossy = true; }
  }
  return { text: out.replace(/\s+/g,' ').trim(), lossy: lossy };
}

// Fusion pdf-lib : PDF (toutes pages) + images (A4-fit). Corrompues → skipped.
function _expMergePDF(facs, tripName){
  return PDFLib.PDFDocument.create().then(function(doc){
    var included=[], skipped=[];
    var chain = Promise.resolve();
    facs.forEach(function(f){
      chain = chain.then(function(){
        var entry = window.pdfStore[f.pdfId];
        if(!entry || !entry.data) throw new Error('missing');
        var mime = _expMime(entry.data);
        var bytes = _dataUrlToBytes(entry.data);
        if(mime === 'application/pdf'){
          return PDFLib.PDFDocument.load(bytes, {ignoreEncryption:true}).then(function(src){
            return doc.copyPages(src, src.getPageIndices()).then(function(pages){
              pages.forEach(function(p){ doc.addPage(p); });
              included.push(f);
            });
          });
        } else if(mime.indexOf('image/png') === 0){
          return doc.embedPng(bytes).then(function(img){ _expDrawImagePage(doc, img); included.push(f); });
        } else if(mime.indexOf('image/jpeg') === 0 || mime.indexOf('image/jpg') === 0){
          return doc.embedJpg(bytes).then(function(img){ _expDrawImagePage(doc, img); included.push(f); });
        } else {
          throw new Error('unsupported '+mime);
        }
      }).catch(function(e){
        skipped.push(f);
      });
    });
    return chain.then(function(){
      return Promise.all([
        doc.embedFont(PDFLib.StandardFonts.Helvetica),
        doc.embedFont(PDFLib.StandardFonts.HelveticaBold)
      ]).then(function(fonts){
        _expBuildCover(doc, fonts[0], fonts[1], tripName, included, skipped);
        return doc.save();
      });
    });
  });
}

// Dessine une image sur une page A4 portrait, mise à l'échelle dans les marges.
function _expDrawImagePage(doc, img){
  var pw=595.28, ph=841.89, margin=36;
  var scale = Math.min((pw-2*margin)/img.width, (ph-2*margin)/img.height, 1);
  var w=img.width*scale, h=img.height*scale;
  var page = doc.addPage([pw,ph]);
  page.drawImage(img, { x:(pw-w)/2, y:(ph-h)/2, width:w, height:h });
}

// Construit la/les page(s) de garde et les insère en tête (2 passes : layout puis dessin).
function _expBuildCover(doc, font, fontBold, tripName, included, skipped){
  var pw=595.28, ph=841.89, mL=48, mR=48, mT=56, mB=56;
  var maxW = pw-mL-mR;
  var rgb = PDFLib.rgb;
  var ink = rgb(0.12,0.12,0.14), muted = rgb(0.42,0.42,0.46), red = rgb(0.75,0.22,0.17);

  // Nom du voyage assaini (fallback si illisible)
  var tn = _pdfSafe(tripName); var tripLabel = (tn.text && tn.text.length>=2) ? tn.text : 'Voyage';

  var total = 0;
  for(var ti=0; ti<included.length; ti++){ total += (+included[ti].amount||0); }

  // Libellé d'une facture pour la page de garde : desc si lisible, sinon fallback identifiable
  function facLabel(t){
    var s = _pdfSafe(t.desc);
    // Fallback seulement si le texte restant est inexploitable (ex. libellé 100% CJK).
    // La ligne conserve de toute façon catégorie + date + montant → reste identifiable.
    var kept = s.text.replace(/[^0-9A-Za-zÀ-ÿ]/g,'');
    if(kept.length < 2){ return '[libelle non affichable]'; }
    return s.text;
  }
  // Construit la liste des "lignes" à dessiner (2 passes utilisent la même liste)
  var lines = [];
  lines.push({ t:'Dossier de factures', s:20, b:true, c:ink, gap:10 });
  lines.push({ t:tripLabel, s:14, b:false, c:ink, gap:4 });
  lines.push({ t:included.length+' facture'+(included.length>1?'s':'')+' incluse'+(included.length>1?'s':''), s:10, b:false, c:muted, gap:16 });
  included.forEach(function(t){
    var lbl = facLabel(t);
    var line = '- ' + lbl + '  |  ' + _catClean(t.cat) + '  |  ' + (t.date||'') + '  |  ' + _expFmtEur(+t.amount||0);
    lines.push({ t:_expTrunc(font, line, 10, maxW), s:10, b:false, c:ink, gap:5 });
  });
  lines.push({ t:'', s:6, b:false, c:ink, gap:6 });
  lines.push({ t:'Total : '+_expFmtEur(total), s:13, b:true, c:ink, gap:6 });
  if(skipped.length){
    lines.push({ t:'', s:6, b:false, c:ink, gap:8 });
    lines.push({ t:skipped.length+' facture'+(skipped.length>1?'s':'')+' ignoree'+(skipped.length>1?'s':'')+' (illisible'+(skipped.length>1?'s':'')+') :', s:10, b:true, c:red, gap:5 });
    skipped.forEach(function(t){
      var line = '- ' + facLabel(t) + '  |  ' + _catClean(t.cat) + '  |  ' + (t.date||'') + '  |  ' + _expFmtEur(+t.amount||0);
      lines.push({ t:_expTrunc(font, line, 10, maxW), s:10, b:false, c:red, gap:5 });
    });
  }

  // Passe 1 : compter les pages nécessaires
  var y = ph-mT, pageCount = 1;
  for(var i=0;i<lines.length;i++){
    var ln = lines[i];
    if(y - ln.s < mB){ pageCount++; y = ph-mT; }
    y -= (ln.s + ln.gap);
  }
  // Créer les pages de garde en tête (index 0..pageCount-1)
  var pages = [];
  for(var p=0;p<pageCount;p++){ pages.push(doc.insertPage(p, [pw,ph])); }

  // Passe 2 : dessiner
  var pi=0, cy=ph-mT;
  for(var k=0;k<lines.length;k++){
    var l = lines[k];
    if(cy - l.s < mB){ pi++; cy = ph-mT; }
    if(l.t){
      try{
        pages[pi].drawText(l.t, { x:mL, y:cy-l.s, size:l.s, font:(l.b?fontBold:font), color:l.c });
      }catch(e){ /* ligne non dessinable : on la saute plutôt que planter */ }
    }
    cy -= (l.s + l.gap);
  }
}

// Tronque un texte pour tenir dans maxW (ajoute "..." ASCII)
function _expTrunc(font, text, size, maxW){
  var safe = _pdfSafe(text).text;
  try{
    if(font.widthOfTextAtSize(safe, size) <= maxW) return safe;
    var t = safe;
    while(t.length>1 && font.widthOfTextAtSize(t+'...', size) > maxW){ t = t.slice(0,-1); }
    return t + '...';
  }catch(e){ return safe.slice(0,80); }
}

// Téléchargement du PDF fusionné
function _expDownload(bytes, filename){
  var blob = new Blob([bytes], { type:'application/pdf' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 5000);
}

function updateBudget(){
  // ── Recalcul taux pour TOUTES les devises étrangères (live si dispo) ──
  transactions.forEach(function(t){
    if(t.devise !== 'EUR'){
      t.amount = localToEur(t.raw, t.devise);
    }
  });

  var spent=transactions.reduce(function(s,t){return s+t.amount;},0);
  var rem=budget-spent;
  var pct=budget>0?Math.min(100,(spent/budget)*100):0;
  var _el;
  _el=document.getElementById('m-budget');    if(_el) _el.textContent=budget.toLocaleString('fr-FR',{minimumFractionDigits:2})+' €';
  _el=document.getElementById('m-spent');     if(_el) _el.textContent=spent.toLocaleString('fr-FR',{minimumFractionDigits:2})+' €';
  _el=document.getElementById('m-remaining'); if(_el){ _el.textContent=rem.toLocaleString('fr-FR',{minimumFractionDigits:2})+' €'; _el.className='metric-value '+(rem<0?'expense':'safe'); }
  _el=document.getElementById('budget-pct-label'); if(_el) _el.textContent=Math.round(pct)+'% utilisé';
  _el=document.getElementById('budget-max-label'); if(_el) _el.textContent=budget.toLocaleString('fr-FR')+' €';
  var bar=document.getElementById('budget-bar');
  if(bar){ bar.style.width=pct+'%'; bar.style.background=pct>90?'#c0392b':pct>70?'#c9921a':'var(--sakura)'; }
  var catTotals={};
  transactions.forEach(function(t){catTotals[t.cat]=(catTotals[t.cat]||0)+t.amount;});
  var catEl=document.getElementById('cat-breakdown');
  if(catEl){
    if(!Object.keys(catTotals).length){catEl.innerHTML='<div class="empty-state" style="padding:16px 0"><div class="empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="12" width="4" height="9"/><rect x="10" y="7" width="4" height="14"/><rect x="17" y="3" width="4" height="18"/></svg></div><div>Aucune dépense enregistrée</div></div>';}
    else{
      var mx=Math.max.apply(null,Object.values(catTotals));
      catEl.innerHTML='<div>'+Object.entries(catTotals).sort(function(a,b){return b[1]-a[1];}).map(function(e){
        var cColor = _catColor(e[0]);
        return '<div class="cat-row"><div class="cat-name"><span class="tx-cat-dot" style="background:'+cColor+'"></span>'+_catClean(e[0])+'</div><div class="cat-bar-track"><div class="cat-bar-fill" style="width:'+Math.round((e[1]/mx)*100)+'%;background:'+cColor+'"></div></div><div class="cat-amount" style="color:'+cColor+'">'+e[1].toLocaleString('fr-FR',{minimumFractionDigits:2})+' €</div></div>';
      }).join('')+'</div>';
    }
  }
  renderDonutChart(catTotals, spent);
  var txEl=document.getElementById('tx-list');
  if(!txEl)return;
  if(!transactions.length){txEl.innerHTML='<div class="empty-state"><div class="empty-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v2m0 8v2m-4-4h8"/></svg></div><div>Aucune transaction</div></div>';}
  else{
    txEl.innerHTML=transactions.slice().reverse().map(function(t){
      var tColor = _catColor(t.cat);
      var isLocal = t.devise && t.devise !== 'EUR';
      // Infos devise pour le symbole correct
      var devInfo = (typeof CURRENCY_INFO!=='undefined' && CURRENCY_INFO[t.devise]) || null;
      var devSym  = devInfo ? devInfo.sym : (isLocal ? t.devise : '€');

      // ── Badge devise ──
      var deviseBadge = isLocal
        ? '<span class="tx-devise-tag yen">'+devSym+' '+t.devise+'</span>'
        : '<span class="tx-devise-tag eur">€ EUR</span>';

      // ── Montant principal affiché en € (EN GROS) ──
      var eurStr = t.amount.toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';

      // ── Ligne secondaire : montant original si devise étrangère ──
      var rawLine = '';
      if(isLocal){
        // Formatage du montant original selon la magnitude de la devise
        var rawFmt = t.raw >= 100
          ? t.raw.toLocaleString('fr-FR',{maximumFractionDigits:0})
          : t.raw.toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2});
        rawLine = '<div class="tx-raw">'+rawFmt+' '+devSym+' converti</div>';
      }

      return '<div class="tx-item">'
        +'<div class="tx-body">'
          +'<div class="tx-desc">'+t.desc+deviseBadge+'</div>'
          +'<div class="tx-cat"><span class="tx-cat-dot" style="background:'+tColor+'"></span>'+_catClean(t.cat)+'</div>'
        +'</div>'
        +'<div class="tx-right">'
          +'<div class="tx-amount" style="font-size:15px;font-weight:600;color:var(--ink)">-'+eurStr+'</div>'
          +rawLine
          +'<div class="tx-date">'+t.date+'</div>'
        +'</div>'
        +(t.pdfId && window.pdfStore && window.pdfStore[t.pdfId]
          ? '<button class="tx-doc" data-act="openPdf" data-id="'+t.pdfId+'" title="Voir le justificatif"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>'
          : '')
        +'<button class="tx-edit" data-act="editTransaction" data-id="'+t.id+'" title="Modifier"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" width="14" height="14"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>'
      +'</div>';
    }).join('');
  }
}

// ══════════════════════════════════════════
// INIT
// ══════════════════════════════════════════
// ── Multi-voyage init ──

// ── addTransaction gère nativement toutes les devises via localToEur ──

// ══════════════════════════════════════════════════════════════════
// SYSTÈME PAYS — mémorisation & auto-complétion
// ══════════════════════════════════════════════════════════════════
// Base de pays populaires (seed)
// [migrated to module — see header]

// Charge la liste mémorisée depuis localStorage
function loadKnownCountries(){
  try{
    var raw = localStorage.getItem('mv_countries');
    return raw ? JSON.parse(raw) : [];
  } catch(e){ return []; }
}
function saveKnownCountries(list){
  try{ localStorage.setItem('mv_countries', JSON.stringify(list)); }catch(e){}
}
function addKnownCountry(name){
  if(!name) return;
  var list = loadKnownCountries();
  if(list.indexOf(name) === -1){ list.push(name); saveKnownCountries(list); }
}
function getAllCountries(){
  var known = loadKnownCountries();
  var all = PAYS_SEED.slice();
  known.forEach(function(c){ if(all.indexOf(c)===-1) all.push(c); });
  return all.sort(function(a,b){ return a.localeCompare(b,'fr'); });
}

// Auto-complétion dans le modal
function onCountryInput(val){
  var box = document.getElementById('country-suggestions');
  if(!box) return;
  if(!val.trim()){ box.classList.remove('open'); return; }
  var q   = val.trim().toLowerCase();
  var all = getAllCountries();
  var hits = all.filter(function(c){ return c.toLowerCase().indexOf(q) !== -1; }).slice(0,8);
  if(!hits.length){ box.classList.remove('open'); return; }
  box.innerHTML = hits.map(function(c){
    var safe = c.replace(/"/g,'&quot;');
    return '<div class="country-sugg-item" data-country="'+safe+'">'
      + isoToFlag(countryToISO(c)) + ' ' + c + '</div>';
  }).join('');
  box.classList.add('open');
  // Attach click handlers
  box.querySelectorAll('.country-sugg-item').forEach(function(el){
    el.addEventListener('click', function(){ selectCountrySuggestion(this.getAttribute('data-country')); });
  });
}
// ── État multi-pays pour la création de voyage ──
var _tripCountries  = [];   // noms des pays sélectionnés pendant la saisie du formulaire
var _primaryCountry = '';   // nom du pays désigné comme principal ('' = aucun → EUR par défaut)

function selectCountrySuggestion(name){
  if(!name) return;
  if(_tripCountries.indexOf(name) === -1) _tripCountries.push(name);
  // Si c'est le premier pays ajouté, le mettre automatiquement comme principal
  if(_tripCountries.length === 1) _primaryCountry = name;
  var inp = document.getElementById('new-trip-country');
  if(inp) inp.value = '';
  document.getElementById('country-suggestions').classList.remove('open');
  _renderSelectedCountries();
  if(typeof addKnownCountry === 'function') addKnownCountry(name);
}

function _renderSelectedCountries(){
  var row = document.getElementById('selected-countries-row');
  if(!row) return;
  if(!_tripCountries.length){ row.innerHTML = ''; return; }
  row.innerHTML = _tripCountries.map(function(c){
    var safe  = c.replace(/'/g,"\\'").replace(/"/g,'&quot;');
    var flag  = isoToFlag(countryToISO(c));
    var isPrimary = (c === _primaryCountry);
    return '<span class="sel-country-chip'+(isPrimary?' is-primary':'')+'" data-country="'+c.replace(/"/g,'&quot;')+'">'
      + '<button class="chip-star" title="Définir comme pays principal" onclick="_togglePrimary(\''+safe+'\')">'+(isPrimary?'★':'☆')+'</button>'
      + flag + ' ' + c
      + '<button class="chip-x" onclick="_removeSelectedCountry(\''+safe+'\')">×</button>'
    + '</span>';
  }).join('');
}

function _togglePrimary(name){
  _primaryCountry = (_primaryCountry === name) ? '' : name;
  _renderSelectedCountries();
}

function _removeSelectedCountry(name){
  _tripCountries = _tripCountries.filter(function(c){ return c !== name; });
  if(_primaryCountry === name) _primaryCountry = _tripCountries[0] || '';
  _renderSelectedCountries();
}

// Mini dictionnaire pays → ISO2 pour le drapeau emoji
var COUNTRY_ISO = {
  'France':'FR','Japon':'JP','Italie':'IT','Espagne':'ES','Allemagne':'DE',
  'Royaume-Uni':'GB','États-Unis':'US','Canada':'CA','Australie':'AU','Chine':'CN',
  'Brésil':'BR','Mexique':'MX','Inde':'IN','Russie':'RU','Portugal':'PT',
  'Grèce':'GR','Thaïlande':'TH','Indonésie':'ID','Vietnam':'VN','Maroc':'MA',
  'Turquie':'TR','Égypte':'EG','Pays-Bas':'NL','Belgique':'BE','Suisse':'CH',
  'Autriche':'AT','Suède':'SE','Norvège':'NO','Danemark':'DK','Finlande':'FI',
  'Pologne':'PL','Roumanie':'RO','Hongrie':'HU','République Dominicaine':'DO',
  'Corée du Sud':'KR','Singapour':'SG','Malaisie':'MY','Philippines':'PH',
  'Nouvelle-Zélande':'NZ','Afrique du Sud':'ZA','Islande':'IS','Irlande':'IE',
  'Argentine':'AR','Chili':'CL','Pérou':'PE','Colombie':'CO','Cuba':'CU',
  'Israël':'IL','Émirats arabes unis':'AE','Qatar':'QA','Arabie Saoudite':'SA',
  'Kenya':'KE','Tanzanie':'TZ','Nigeria':'NG','Sénégal':'SN','Tunisie':'TN',
  'Cambodge':'KH','Laos':'LA','Népal':'NP','Sri Lanka':'LK','Myanmar':'MM',
  'Géorgie':'GE','Arménie':'AM','Azerbaïdjan':'AZ','Mongolie':'MN'
};
function countryToISO(name){ return COUNTRY_ISO[name] || ''; }

// Emoji drapeau depuis code ISO-2 (ex: 'JP' → '🇯🇵')
// [migrated to module — see header]

// Rendu des tags pays dans le modal
function renderCountryTags(){
  var list = loadKnownCountries();
  var el   = document.getElementById('country-tags-list');
  if(!el) return;
  if(!list.length){ el.innerHTML=''; return; }
  el.innerHTML = '<span style="font-size:11px;color:var(--ink-hint);margin-right:4px">Pays récents :</span>'
    + list.slice(-8).reverse().map(function(c){
        var safe = c.replace(/"/g,'&quot;');
        return '<span class="country-tag" data-country="'+safe+'">'
          + isoToFlag(countryToISO(c)) + ' ' + c
          + '<button class="tag-x" data-remove="'+safe+'">&times;</button>'
        + '</span>';
      }).join('');
  // Attach handlers
  el.querySelectorAll('.country-tag').forEach(function(tag){
    tag.addEventListener('click', function(e){
      if(e.target.classList.contains('tag-x')) return;
      selectCountrySuggestion(this.getAttribute('data-country'));
    });
  });
  el.querySelectorAll('.tag-x').forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      removeCountryTag(this.getAttribute('data-remove'));
    });
  });
}
function removeCountryTag(name){
  var list = loadKnownCountries().filter(function(c){ return c!==name; });
  saveKnownCountries(list);
  renderCountryTags();
}

// ══════════════════════════════════════════════════════════════════
// STATS HEADER — mise à jour temps réel
// ══════════════════════════════════════════════════════════════════
function updateStatsBar(){
  updateTripProgressBar();
  var nbVoyages = Object.keys(allTrips).length;
  // Pays uniques : regrouper tous les pays de tous les voyages
  var paysSet = {};
  Object.values(allTrips).forEach(function(t){
    var meta = t.meta || {};
    // Compatibilité : meta.countries (multi) ou meta.country (legacy)
    var countries = (meta.countries && meta.countries.length) ? meta.countries : (meta.country ? [meta.country] : []);
    countries.forEach(function(p){ if(p) paysSet[p] = 1; });
  });
  var nbPays = Object.keys(paysSet).length;

  // Home stats bar
  var sv = document.getElementById('stat-voyages');
  var sp = document.getElementById('stat-pays');
  if(sv) sv.textContent = nbVoyages;
  if(sp) sp.textContent = nbPays;

  // App header chips
  var ahv = document.getElementById('ah-voyages');
  var ahp = document.getElementById('ah-pays');
  if(ahv) ahv.textContent = nbVoyages;
  if(ahp) ahp.textContent = nbPays;

  // Pluriels micro-stats home
  var svs = document.getElementById('stat-voyages-s');
  var sps = document.getElementById('stat-pays-s');
  if(svs) svs.textContent = nbVoyages > 1 ? 's' : '';
  if(sps) sps.textContent = nbPays > 1 ? 's' : '';
  if(typeof updatePulseBtnHint === 'function') updatePulseBtnHint();

  // App header destination
  if(currentTripId && allTrips[currentTripId]){
    var m = allTrips[currentTripId].meta || {};
    var destEl   = document.getElementById('app-trip-dest');
    var flagEl   = document.getElementById('app-dest-flag');
    var nameEl   = document.getElementById('app-dest-name');
    if(m.country && destEl){
      var iso = countryToISO(m.country);
      if(flagEl) flagEl.textContent = isoToFlag(iso) + ' ';
      if(nameEl) nameEl.textContent = m.country;
      destEl.style.display = 'flex';
    } else if(destEl){
      destEl.style.display = 'none';
    }
  }

  updateHomeTopbarStats();
}

// [patch inlined above]

// [patch inlined above]

// [patch inlined above]

// [patch inlined above]

// ══════════════════════════════════════════════════════════════════
// TIME PICKER — roue heures / minutes
// ══════════════════════════════════════════════════════════════════
var tpTargetId = '';
var tpMode     = 'H';   // 'H' = heures, 'M' = minutes
var tpHour     = null;
var tpMin      = null;

function openTimePicker(targetId, title){
  tpTargetId = targetId;
  tpMode     = 'H';
  tpHour     = null;
  tpMin      = null;
  // Pré-remplir si valeur existante
  var el = document.getElementById(targetId);
  if(el && el.value){
    var m = el.value.match(/^(\d{1,2})[h:](\d{2})$/);
    if(m){ tpHour=parseInt(m[1]); tpMin=parseInt(m[2]); }
  }
  document.getElementById('tp-title').textContent = title || 'Heure';
  document.getElementById('tp-confirm').disabled = (tpHour===null || tpMin===null);
  renderTimePicker();
  document.getElementById('tp-overlay').classList.add('open');
}

function closeTimePicker(){
  document.getElementById('tp-overlay').classList.remove('open');
}

function confirmTimePicker(){
  if(tpHour===null||tpMin===null) return;
  var val = (tpHour<10?'0'+tpHour:tpHour)+'h'+(tpMin<10?'0'+tpMin:tpMin);
  var el  = document.getElementById(tpTargetId);
  if(el){ el.value = val; el.dispatchEvent(new Event('input',{bubbles:true})); }
  closeTimePicker();
}

function renderTimePicker(){
  var grid    = document.getElementById('tp-grid');
  var display = document.getElementById('tp-display');
  var hint    = document.getElementById('tp-mode-hint');
  if(!grid) return;

  // Display
  var hStr = tpHour!==null ? (tpHour<10?'0'+tpHour:tpHour) : '--';
  var mStr = tpMin!==null  ? (tpMin<10?'0'+tpMin:tpMin)   : '--';
  display.textContent = hStr + ':' + mStr;

  if(tpMode === 'H'){
    hint.textContent = "Sélectionne l'heure";
    // 0–23
    grid.innerHTML = Array.from({length:24},function(_,i){
      return '<div class="tp-cell'+(tpHour===i?' selected':'')+'" onclick="tpSelectHour('+i+')">'+(i<10?'0'+i:i)+'</div>';
    }).join('');
  } else {
    hint.textContent = "Sélectionne les minutes";
    // 0,5,10,...55
    var mins = [];
    for(var i=0;i<60;i+=5) mins.push(i);
    grid.innerHTML = mins.map(function(m){
      return '<div class="tp-cell'+(tpMin===m?' selected':'')+'" onclick="tpSelectMin('+m+')">'+(m<10?'0'+m:m)+'</div>';
    }).join('');
  }
}

function tpSelectHour(h){
  tpHour = h; tpMode = 'M';
  renderTimePicker();
}
function tpSelectMin(m){
  tpMin = m;
  document.getElementById('tp-confirm').disabled = false;
  renderTimePicker();
}

// ══════════════════════════════════════════════════════════════════
// CALENDAR PICKER
// ══════════════════════════════════════════════════════════════════
var calTargetId = '';
var calYear     = new Date().getFullYear();
var calMonth    = new Date().getMonth(); // 0-based
var calShowYear = false;
// Range: dates de départ et retour du voyage en cours de création
var calRangeStart = null; // Date object
var calRangeEnd   = null; // Date object
var CAL_RANGE_START_ID = 'new-trip-date-dep';
var CAL_RANGE_END_ID   = 'new-trip-date-ret';

function openCalendar(targetId){
  calTargetId  = targetId;
  calShowYear  = false;
  calMinDate   = null;
  calMaxDate   = null;

  var el     = document.getElementById(targetId);
  var curVal = el ? el.value : '';

  // ── IDs exclus de toute contrainte voyage ──
  var EXCLUDE_TRIP = ['new-trip-date-dep','new-trip-date-ret'];
  var isExcluded   = EXCLUDE_TRIP.indexOf(targetId) !== -1;

  // ── Range de création de voyage (highlight + enchaînement) ──
  var depEl = document.getElementById(CAL_RANGE_START_ID);
  var retEl = document.getElementById(CAL_RANGE_END_ID);
  calRangeStart = depEl && depEl.value ? parseDDMMYYYY(depEl.value) : null;
  calRangeEnd   = retEl && retEl.value ? parseDDMMYYYY(retEl.value) : null;

  // ── Récupérer la période du voyage actif ──
  var period = (!isExcluded) ? getTripPeriod() : null;

  // ── Cas spécial : date d'arrivée vol (minDate = date départ + max J+3) ──
  if(targetId === 'vol-arr-date'){
    var volDepEl = document.getElementById('vol-dep-date');
    if(volDepEl && volDepEl.value){
      calMinDate = parseDDMMYYYY(volDepEl.value);
      if(calMinDate){
        calMaxDate = new Date(calMinDate);
        calMaxDate.setDate(calMaxDate.getDate() + 3);
      }
    }
  }

  // ── Appliquer les contraintes de période voyage ──
  if(period && !calMinDate) calMinDate = period.start;
  if(period && !calMaxDate && period.end) calMaxDate = period.end;

  // ══════════════════════════════════════════════════════════
  // POSITIONNEMENT DU MOIS — PRIORITÉS DANS L'ORDRE :
  //   1. Le champ a déjà une valeur → ouvrir sur ce mois
  //   2. Date retour création voyage → même mois que le départ
  //   3. Date arrivée vol → même mois que départ vol
  //   4. Tout autre champ vide dans un voyage → mois de début du voyage
  //   5. Pas de voyage actif → mois actuel
  // ══════════════════════════════════════════════════════════
  if(curVal){
    // 1. Valeur existante
    var parsed = parseDDMMYYYY(curVal);
    if(parsed){
      calMonth = parsed.getMonth();
      calYear  = parsed.getFullYear();
    }
  } else if(targetId === CAL_RANGE_END_ID && calRangeStart){
    // 2. Date retour voyage → même mois que date départ
    calMonth = calRangeStart.getMonth();
    calYear  = calRangeStart.getFullYear();
  } else if(targetId === 'vol-arr-date' && calMinDate){
    // 3. Arrivée vol → mois du départ vol
    calMonth = calMinDate.getMonth();
    calYear  = calMinDate.getFullYear();
  } else if(period && period.start){
    // 4. Champ vide dans un voyage → mois de début du voyage ← FIX PRINCIPAL
    calMonth = period.start.getMonth();
    calYear  = period.start.getFullYear();
  } else {
    // 5. Aucun voyage actif → aujourd'hui
    calMonth = new Date().getMonth();
    calYear  = new Date().getFullYear();
  }

  renderCalendar();
  document.getElementById('cal-overlay').classList.add('open');

  // ── Indicateur visuel de la période du voyage ──
  if(period){
    setTimeout(function(){
      var body = document.getElementById('cal-body');
      if(!body) return;
      var existing = body.parentNode.querySelector('.cal-voyage-hint');
      if(existing) existing.remove();
      var hint = document.createElement('div');
      hint.className = 'cal-voyage-hint';
      hint.textContent = ''
        + (period.start.getDate()<10?'0'+period.start.getDate():period.start.getDate())
        + '/'+(period.start.getMonth()+1<10?'0'+(period.start.getMonth()+1):(period.start.getMonth()+1))
        + '/'+period.start.getFullYear()
        + (period.end
           ? ' → '
             + (period.end.getDate()<10?'0'+period.end.getDate():period.end.getDate())
             + '/'+(period.end.getMonth()+1<10?'0'+(period.end.getMonth()+1):(period.end.getMonth()+1))
             + '/'+period.end.getFullYear()
           : '');
      body.parentNode.insertBefore(hint, body);
    }, 0);
  }
}
function closeCalendar(){
  document.getElementById('cal-overlay').classList.remove('open');
}
function calMove(dir){
  if(calShowYear){ calYear+=dir*10; }
  else {
    calMonth += dir;
    if(calMonth > 11){ calMonth=0; calYear++; }
    else if(calMonth < 0){ calMonth=11; calYear--; }
    // Bloquer si on sort de la période voyage — SAUF pour les dates de
    // création de voyage (modal « Nouveau voyage »), qui doivent pouvoir
    // naviguer librement (le voyage actif n'est pas encore celui créé).
    var EXCLUDE_TRIP = ['new-trip-date-dep','new-trip-date-ret'];
    var isExcluded = EXCLUDE_TRIP.indexOf(calTargetId) !== -1;
    var period = isExcluded ? null : getTripPeriod();
    if(period && period.start){
      var viewDate = new Date(calYear, calMonth, 1);
      var minMonth = new Date(period.start.getFullYear(), period.start.getMonth(), 1);
      if(viewDate < minMonth){ calMonth=period.start.getMonth(); calYear=period.start.getFullYear(); }
    }
    if(period && period.end){
      var viewDate2 = new Date(calYear, calMonth, 1);
      var maxMonth = new Date(period.end.getFullYear(), period.end.getMonth(), 1);
      if(viewDate2 > maxMonth){ calMonth=period.end.getMonth(); calYear=period.end.getFullYear(); }
    }
  }
  renderCalendar();
}
function calToggleYearView(){
  calShowYear = !calShowYear;
  renderCalendar();
}

var MOIS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
var JOURS_FR = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];

function renderCalendar(){
  var label  = document.getElementById('cal-month-label');
  var body   = document.getElementById('cal-body');
  var el     = document.getElementById(calTargetId);
  var selStr = el ? el.value : '';

  if(calShowYear){
    // Grille décennie
    label.textContent = (calYear-4)+' – '+(calYear+5);
    var rows = '';
    for(var y=calYear-4;y<=calYear+5;y++){
      var isSel = selStr && selStr.indexOf('/'+y)!==-1;
      rows += '<div class="cal-year-btn'+(isSel?' selected':'')+'" onclick="calSelectYear('+y+')">'+y+'</div>';
    }
    body.innerHTML = '<div class="cal-year-grid">'+rows+'</div>';
  } else {
    label.textContent = MOIS_FR[calMonth] + ' ' + calYear;
    // DOW headers
    var html = '<div class="cal-grid">';
    JOURS_FR.forEach(function(d){ html+='<div class="cal-dow">'+d+'</div>'; });
    // 1st day of month (Mon=0)
    var first = new Date(calYear,calMonth,1).getDay();
    var offset = (first===0)?6:first-1;
    for(var i=0;i<offset;i++) html+='<div class="cal-day cal-empty"></div>';
    var days = new Date(calYear,calMonth+1,0).getDate();
    var today = new Date();
    for(var d=1;d<=days;d++){
      var dStr    = (d<10?'0'+d:d)+'/'+(calMonth+1<10?'0'+(calMonth+1):(calMonth+1))+'/'+calYear;
      var dayDate = new Date(calYear, calMonth, d);
      var isToday = (d===today.getDate()&&calMonth===today.getMonth()&&calYear===today.getFullYear());
      var isSel   = selStr===dStr;
      // Range highlight
      var isRangeStart = calRangeStart && dayDate.getTime()===calRangeStart.getTime();
      var isRangeEnd   = calRangeEnd   && dayDate.getTime()===calRangeEnd.getTime();
      var inRange = calRangeStart && calRangeEnd && dayDate > calRangeStart && dayDate < calRangeEnd;
      // Normaliser à minuit pour comparaison sans heure
      var _min = calMinDate ? new Date(calMinDate.getFullYear(),calMinDate.getMonth(),calMinDate.getDate()) : null;
      var _max = calMaxDate ? new Date(calMaxDate.getFullYear(),calMaxDate.getMonth(),calMaxDate.getDate()) : null;
      var _day = new Date(calYear, calMonth, d);
      var isDisabled = (_min && _day < _min) || (_max && _day > _max);
      var cls = 'cal-day';
      if(isToday)    cls += ' today';
      if(isSel)      cls += ' selected';
      if(isRangeStart) cls += ' range-start';
      if(isRangeEnd)   cls += ' range-end';
      if(inRange)    cls += ' in-range';
      if(isDisabled) cls += ' disabled';
      html+='<div class="'+cls+'"'+(isDisabled?'':' onclick="calSelectDay('+d+')"')+'>'+d+'</div>';
    }
    html+='</div>';
    body.innerHTML = html;
  }
}

function calSelectYear(y){
  calYear = y; calShowYear = false;
  renderCalendar();
}
function calSelectDay(d){
  var mo  = calMonth+1;
  var val = (d<10?'0'+d:d)+'/'+(mo<10?'0'+mo:mo)+'/'+calYear;
  var el  = document.getElementById(calTargetId);
  if(el){
    el.value = val;
    // FIX nuitées : une affectation programmatique ne déclenche PAS les
    // handlers oninput (autoHotel, autoLoc…). On émet l'événement
    // manuellement pour que les champs calculés (Nuits, durées) se
    // remplissent dès la sélection au calendrier.
    try{ el.dispatchEvent(new Event('input', {bubbles:true})); }catch(e){}
    // Bug 4 fix : si la cible est mob-date, synchroniser TOUS les mob-date
    // (il y en a 4 avec le même id — un par groupe de transport).
    // On ne remplit que celui du groupe actif (display !== none).
    if(calTargetId === 'mob-date'){
      var type = (document.getElementById('mob-type')||{}).value || 'vol';
      var MOB_GRP_MAP = {vol:'mob-group-vol',train:'mob-group-train',
        bus:'mob-group-bus',bateau:'mob-group-bateau',
        covoiturage:'mob-group-covoiturage',metro:'mob-group-metro',taxi:'mob-group-taxi'};
      var activeGrp = document.getElementById(MOB_GRP_MAP[type] || 'mob-group-vol');
      if(activeGrp){
        var datEl = activeGrp.querySelector('[id="mob-date"]');
        if(datEl){ datEl.value = val; }
      }
      updateMobPreview();
    }
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    if(calTargetId==='ht-ci') autoHotel('ci');
    if(calTargetId==='ht-co') autoHotel('co');
  }
  // Mise à jour du range
  var depEl = document.getElementById(CAL_RANGE_START_ID);
  var retEl = document.getElementById(CAL_RANGE_END_ID);
  calRangeStart = depEl && depEl.value ? parseDDMMYYYY(depEl.value) : null;
  calRangeEnd   = retEl && retEl.value ? parseDDMMYYYY(retEl.value) : null;

  // Après sélection de la date départ → enchaîner automatiquement sur la date retour
  if(calTargetId === CAL_RANGE_START_ID){
    var retVal = retEl ? retEl.value : '';
    var selectedDate = new Date(calYear, calMonth, d);
    if(!retVal || (calRangeEnd && calRangeEnd <= selectedDate)){
      if(retEl) retEl.value = '';
      closeCalendar();
      setTimeout(function(){ openCalendar(CAL_RANGE_END_ID); }, 120);
      return;
    }
  }
  // Vol départ date → pré-remplir date arrivée à J+1 par défaut, puis ouvrir
  if(calTargetId === 'vol-dep-date'){
    var volArrEl = document.getElementById('vol-arr-date');
    var selectedDate2 = new Date(calYear, calMonth, d);
    if(volArrEl){
      // Pré-remplir J+1 si pas de date arrivée ou date incohérente
      if(!volArrEl.value){
        var j1 = new Date(selectedDate2); j1.setDate(j1.getDate()+1);
        var j1d=j1.getDate(), j1m=j1.getMonth()+1, j1y=j1.getFullYear();
        volArrEl.value=(j1d<10?'0'+j1d:j1d)+'/'+(j1m<10?'0'+j1m:j1m)+'/'+j1y;
      } else {
        var arrParsed = parseDDMMYYYY(volArrEl.value);
        if(arrParsed && arrParsed < selectedDate2) volArrEl.value='';
      }
    }
    closeCalendar();
    setTimeout(function(){ openCalendar('vol-arr-date'); }, 120);
    return;
  }
  renderCalendar();
  closeCalendar();
}

// ══════════════════════════════════════════════════════════════════
// PDF ATTACHMENTS
// ══════════════════════════════════════════════════════════════════
// Stockage global des PDFs indexés par id unique — persisté dans
// localStorage (clé 'yume_pdfstore') pour survivre au rechargement
// de la page. Avant ce correctif, pdfStore vivait uniquement en
// mémoire et les pièces jointes disparaissaient à chaque F5.
function savePdfStore(){
  try{ localStorage.setItem('yume_pdfstore', JSON.stringify(window.pdfStore||{})); }
  catch(e){
    console.warn('[Yume] savePdfStore: échec localStorage (quota plein ?)', e);
    if(typeof showToast === 'function') showToast('Pièce jointe non sauvegardée — stockage local plein', 'error', 4000);
  }
}
function loadPdfStore(){
  try{
    var raw = localStorage.getItem('yume_pdfstore');
    return raw ? JSON.parse(raw) : {};
  } catch(e){ return {}; }
}
if(!window.pdfStore) window.pdfStore = loadPdfStore();

function attachPdfToForm(hiddenId, fileInput){
  var file = fileInput.files[0];
  if(!file) return;
  if(file.size > 15*1024*1024){ alert('PDF trop lourd (max 15 Mo)'); return; }
  var reader = new FileReader();
  reader.onload = function(e){
    var b64   = e.target.result;
    var pdfId = 'pdf_'+Date.now();
    window.pdfStore[pdfId] = { name: file.name, data: b64 };
    savePdfStore();
    var hid = document.getElementById(hiddenId);
    if(hid) hid.value = pdfId;
    // Badge avec boutons vue + suppression
    var bEl = document.getElementById(hiddenId+'-badge') ||
              document.getElementById(hiddenId.replace('-pdf','')+'-pdf-badge');
    if(bEl){
      bEl.innerHTML = '';
      var viewBtn = document.createElement('button');
      viewBtn.className = 'pdf-view-btn';
      viewBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> ' + file.name;
      viewBtn.addEventListener('click', function(){ openPdf(pdfId); });
      var delBtn = document.createElement('button');
      delBtn.className = 'pdf-del-btn';
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>';
      delBtn.title = 'Supprimer ce document';
      delBtn.addEventListener('click', function(){
        delete window.pdfStore[pdfId];
        savePdfStore();
        if(hid) hid.value = '';
        bEl.innerHTML = '';
        fileInput.value = '';
      });
      bEl.appendChild(viewBtn);
      bEl.appendChild(delBtn);
    }
  };
  reader.readAsDataURL(file);
}

function openPdf(pdfId){
  var entry = window.pdfStore[pdfId] || (window.globalPdfStore && window.globalPdfStore[pdfId]);
  if(!entry){ alert('PDF introuvable. Le document a peut-être été supprimé ou la page a été rechargée.'); return; }
  // Détecte le vrai type MIME depuis le data URL (ex: data:image/jpeg;base64,...)
  // — sans ça, une photo de ticket était forcée en Blob "application/pdf" et
  // ne s'affichait pas correctement.
  var mimeMatch = (''+entry.data).match(/^data:([^;]+);base64,/);
  var mime = mimeMatch ? mimeMatch[1] : 'application/pdf';
  var isImage = mime.indexOf('image/') === 0;
  try {
    // Méthode 1 : Blob URL (la plus fiable, ouvre un vrai viewer natif)
    var byteStr = atob(entry.data.split(',')[1]);
    var ab = new ArrayBuffer(byteStr.length);
    var ia = new Uint8Array(ab);
    for(var i=0;i<byteStr.length;i++) ia[i] = byteStr.charCodeAt(i);
    var blob = new Blob([ab], {type:mime});
    var url  = URL.createObjectURL(blob);
    var win  = window.open(url, '_blank');
    // Révoquer l'URL après ouverture
    if(win) setTimeout(function(){ URL.revokeObjectURL(url); }, 30000);
    if(!win){
      // Popup bloqué : créer un lien temporaire
      var a = document.createElement('a');
      a.href = url; a.download = entry.name; a.click();
      setTimeout(function(){ URL.revokeObjectURL(url); }, 5000);
    }
  } catch(e){
    // Fallback : data URI directe
    var win2 = window.open();
    if(win2){
      win2.document.write('<html><head><title>'+entry.name+'</title></head>'
        +'<body style="margin:0;padding:0;background:#1a1a2e">'
        +(isImage
          ? '<img src="'+entry.data+'" style="display:block;max-width:100%;margin:0 auto"/>'
          : '<embed src="'+entry.data+'" type="'+mime+'" width="100%" height="100%" style="position:absolute;inset:0"/>')
        +'</body></html>');
    }
  }
}


// PDF vol intégré dans addVol (voir ci-dessus)

// pdfId intégré nativement dans addTrain() et addHotel() (voir ci-dessus)


// ── addLieu, renderLieux, editLieu, saveLieu — fonctions consolidées (voir ci-dessus) ──


// renderVols — gestion PDF intégrée directement dans la fonction originale (ci-dessus)


// editLieu et saveLieu — fonctions consolidées (voir ci-dessus)


loadAllTrips();
// Filet de sécurité : normaliser les données au démarrage (garantir la
// présence de tous les tableaux, migrer les adresses anciennes). Protège
// contre les crashes sur d'anciennes données mal formées.
if(typeof _migrateAllTrips === 'function') _migrateAllTrips();
updateHomeTopbarStats();
showHomeScreen();

// ── Splash screen dismissal (runs once, not on tab changes) ──
(function(){
  var splash = document.getElementById('splash-screen');
  if(!splash) return;
  // Fade-out starts at 1500ms, CSS transition takes 500ms → gone at 2000ms
  setTimeout(function(){
    // Simple fade-out — no zoom
    splash.classList.add('fade-out');
    setTimeout(function(){
      try {
        splash.style.display = 'none';
        if(splash.parentNode) splash.parentNode.removeChild(splash);
      } catch(e){}
    }, 520);
  }, 2000); // 2s visible + 0.5s fondu = 2.5s total
})();
fetchRate();
updateStatsBar();
renderCountryTags();

// ══════════════════════════════════════════════════════════════
// AUTOMATION — Utilitaires temps & dates
// ══════════════════════════════════════════════════════════════

// Parse "09h30" ou "09:30" → minutes depuis minuit
function parseHM(str){
  if(!str) return null;
  var m=str.trim().match(/^(\d{1,2})[h:](\d{2})$/i);
  return m ? parseInt(m[1],10)*60+parseInt(m[2],10) : null;
}
// Minutes → "Xh YY"
function formatMinutes(mins){
  if(mins<0) mins+=1440;
  var h=Math.floor(mins/60), m=mins%60;
  return h+'h'+(m<10?'0'+m:m);
}
// Parse "JJ/MM/AAAA" ou "JJ/MM" → Date
function parseDDMMYYYY(str){
  if(!str) return null;
  var m=str.trim().match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if(!m) return null;
  var d=parseInt(m[1],10), mo=parseInt(m[2],10)-1;
  var yyyy=m[3]?(m[3].length===2?2000+parseInt(m[3],10):parseInt(m[3],10)):new Date().getFullYear();
  var dt=new Date(yyyy,mo,d);
  return isNaN(dt.getTime())?null:dt;
}
// Date → "JJ/MM/AAAA"
function formatDDMMYYYY(dt){
  if(!dt) return '';
  var d=dt.getDate(),mo=dt.getMonth()+1,y=dt.getFullYear();
  return (d<10?'0'+d:d)+'/'+(mo<10?'0'+mo:mo)+'/'+y;
}
function daysBetween(a,b){ return Math.round((b-a)/(1000*60*60*24)); }
function addDays(dt,n){ var r=new Date(dt); r.setDate(r.getDate()+n); return r; }

// Feedback visuel
function flashAuto(el, hintId){
  if(!el) return;
  el.classList.add('auto-filled');
  var hint=document.getElementById(hintId);
  if(hint) hint.classList.add('visible');
  setTimeout(function(){ el.classList.remove('auto-filled'); }, 1600);
}

// ── Train : départ + arrivée → durée ──


// ── Hôtel : logique 3 variables CI / CO / Nuits ──
function autoHotel(changed){
  var ciEl=document.getElementById('ht-ci');
  var coEl=document.getElementById('ht-co');
  var nEl=document.getElementById('ht-nuits');
  if(!ciEl||!coEl||!nEl) return;
  var ci=parseDDMMYYYY(ciEl.value);
  var co=parseDDMMYYYY(coEl.value);
  var nuits=parseInt(nEl.value,10);

  if(changed==='ci'||changed==='co'){
    if(ci&&co){ // CI + CO → Nuits
      var diff=daysBetween(ci,co);
      if(diff>0){ nEl.value=diff; flashAuto(nEl,'hint-ht-nuits'); }
    } else if(ci&&!coEl.value.trim()&&!isNaN(nuits)&&nuits>0){ // CI + Nuits → CO
      coEl.value=formatDDMMYYYY(addDays(ci,nuits)); flashAuto(coEl,'hint-ht-co');
    } else if(!ciEl.value.trim()&&co&&!isNaN(nuits)&&nuits>0){ // CO + Nuits → CI
      ciEl.value=formatDDMMYYYY(addDays(co,-nuits)); flashAuto(ciEl,'hint-ht-ci');
    }
  }
  if(changed==='nuits'&&!isNaN(nuits)&&nuits>0){
    if(ci&&!coEl.value.trim()){ coEl.value=formatDDMMYYYY(addDays(ci,nuits)); flashAuto(coEl,'hint-ht-co'); }
    else if(!ciEl.value.trim()&&co){ ciEl.value=formatDDMMYYYY(addDays(co,-nuits)); flashAuto(ciEl,'hint-ht-ci'); }
    else if(ci&&co){ var diff2=daysBetween(ci,co); if(diff2>0){ nEl.value=diff2; } }
  }
}


// ══════════════════════════════════════════════════════════
// confirmerSuppression — GLOBAL, accessible partout
// Utilise la vraie structure de données du fichier (allTrips/mv_trips)
// ══════════════════════════════════════════════════════════
window.confirmerSuppression = function(event, tid){
  if(event && event.stopPropagation) event.stopPropagation();
  var name = (allTrips[tid] && allTrips[tid].meta && allTrips[tid].meta.name) || 'ce voyage';
  if(!confirm('Supprimer "' + name + '" ?')) return;
  supprimerVoyage(tid);
};

// ── Event delegation sur le document pour data-delete-tid ──
// Fonctionne même si les cartes sont re-créées dynamiquement
// et même si onclick inline est bloqué par le moteur mobile
document.addEventListener('click', function(e) {
  var btn = e.target.closest('[data-delete-tid]');
  if(!btn) return;
  var tid = btn.getAttribute('data-delete-tid');
  if(!tid) return;
  e.stopPropagation();
  e.preventDefault();
  window.confirmerSuppression(e, tid);
}, true); // capture phase — priorité maximale


// ══════════════════════════════════════════════════════════════════
// AUTOCOMPLÉTION ADRESSE HÉBERGEMENT — Photon (OSM, sans clé API)
// ══════════════════════════════════════════════════════════════════
(function(){
  var _htDebounce = null;
  var _htSelected = false; // true quand l'user a cliqué sur une suggestion

  // CSS pour les suggestions
  var sty = document.createElement('style');
  sty.textContent = [
    '.ht-sug-item{padding:9px 12px;font-size:13px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:8px;color:var(--ink)}',
    '.ht-sug-item:last-child{border-bottom:none}',
    '.ht-sug-item:hover,.ht-sug-item.focused{background:var(--sakura-light)}',
    '.ht-sug-main{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ht-sug-sub{font-size:11px;color:var(--ink-muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ht-sug-icon{flex-shrink:0;font-size:14px;margin-top:1px}'
  ].join('\n');
  document.head.appendChild(sty);

  window.htAdresseInput = function(val){
    _htSelected = false;
    var box = document.getElementById('ht-adresse-suggestions');
    // Réinitialiser les coords stockées si l'user retape
    var latEl = document.getElementById('ht-adresse-lat');
    var lngEl = document.getElementById('ht-adresse-lng');
    if(latEl) latEl.value = '';
    if(lngEl) lngEl.value = '';

    clearTimeout(_htDebounce);
    if(!val || val.length < 3){ if(box) box.style.display='none'; return; }

    _htDebounce = setTimeout(function(){
      _htPhoton(val, function(results){
        _htShowSuggestions(results, box);
      });
    }, 320);
  };

  function _htPhoton(query, cb){
    // Photon : API gratuite basée sur OSM, pas de clé requise
    fetch('https://photon.komoot.io/api/?q=' + encodeURIComponent(query) + '&limit=5&lang=fr', {
      headers:{'Accept':'application/json'}
    })
    .then(function(r){ return r.json(); })
    .then(function(data){
      var items = (data && data.features) ? data.features : [];
      cb(items);
    })
    .catch(function(){ cb([]); });
  }

  function _htShowSuggestions(items, box){
    if(!box) return;
    if(!items.length){ box.style.display='none'; return; }

    box.innerHTML = items.map(function(f){
      var p = f.properties || {};
      var rue  = [p.housenumber, p.street].filter(Boolean).join(' ');
      var main = rue || p.name || '';
      var sub  = [p.city||p.town||p.village, p.postcode, p.country].filter(Boolean).join(' · ');
      var lat  = f.geometry && f.geometry.coordinates ? f.geometry.coordinates[1] : '';
      var lng  = f.geometry && f.geometry.coordinates ? f.geometry.coordinates[0] : '';
      // Sérialiser les props pour remplir les champs structurés au clic
      var props = _esc(JSON.stringify({
        rue:     rue,
        cp:      p.postcode  || '',
        ville:   p.city      || p.town || p.village || '',
        pays:    p.country   || ''
      }));
      return '<div class="ht-sug-item" data-props="'+props+'" data-lat="'+lat+'" data-lng="'+lng+'" onclick="_htPickSuggestion(this)">'
        +'<span class="ht-sug-icon"></span>'
        +'<div style="flex:1;min-width:0"><div class="ht-sug-main">'+_esc(main)+'</div><div class="ht-sug-sub">'+_esc(sub)+'</div></div>'
      +'</div>';
    }).join('');
    box.style.display = 'block';
  }

  window._htPickSuggestion = function(el){
    var lat   = el.getAttribute('data-lat');
    var lng   = el.getAttribute('data-lng');
    var box   = document.getElementById('ht-adresse-suggestions');
    var latEl = document.getElementById('ht-adresse-lat');
    var lngEl = document.getElementById('ht-adresse-lng');
    // Parser les données structurées
    var props = {};
    try{ props = JSON.parse(el.getAttribute('data-props')||'{}'); }catch(e){}
    // Remplir les champs structurés
    var rueEl  = document.getElementById('ht-rue');
    var cpEl   = document.getElementById('ht-cp');
    var villeEl= document.getElementById('ht-ville');
    var paysEl = document.getElementById('ht-pays');
    if(rueEl  && props.rue)   rueEl.value   = props.rue;
    if(cpEl   && props.cp)    cpEl.value    = props.cp;
    if(villeEl && props.ville && !villeEl.value) villeEl.value = props.ville;
    if(paysEl && props.pays)  paysEl.value  = props.pays;
    if(latEl) latEl.value = lat;
    if(lngEl) lngEl.value = lng;
    if(box) box.style.display = 'none';
    _htSelected = true;
  };

  function _esc(s){
    return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Fermer les suggestions si on clique ailleurs
  document.addEventListener('click', function(e){
    var box = document.getElementById('ht-adresse-suggestions');
    if(box && !box.contains(e.target) && e.target.id !== 'ht-rue'){
      box.style.display='none';
    }
  });

  // ── Géocodage à la création (champs structurés rue/cp/pays) ──
  var _origAddHotel = typeof addHotel === 'function' ? addHotel : null;
  if(_origAddHotel){
    addHotel = function(){
      var latEl  = document.getElementById('ht-adresse-lat');
      var lngEl  = document.getElementById('ht-adresse-lng');
      // Si coords déjà fournies (suggestion Nominatim sélectionnée), sauvegarder direct
      if(latEl && latEl.value && lngEl && lngEl.value){
        _origAddHotel(); return;
      }
      // Construire fullAddress depuis les champs structurés
      var rue   = (document.getElementById('ht-rue')  ||{}).value||'';
      var cp    = (document.getElementById('ht-cp')   ||{}).value||'';
      var ville = (document.getElementById('ht-ville')||{}).value||'';
      var pays  = (document.getElementById('ht-pays') ||{}).value||'';
      var nom   = (document.getElementById('ht-nom')  ||{}).value||'';
      var query = typeof buildFullAddress === 'function'
        ? buildFullAddress(rue, cp, ville, pays)
        : '';
      if(!query) query = (nom && ville) ? nom+', '+ville : ville;

      if(query){
        fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(query),{headers:{'Accept-Language':'fr,en'}})
        .then(function(r){ return r.json(); })
        .then(function(data){
          if(data&&data.length){
            if(latEl) latEl.value = data[0].lat;
            if(lngEl) lngEl.value = data[0].lon;
          }
          _origAddHotel();
        })
        .catch(function(){ _origAddHotel(); });
      } else {
        _origAddHotel();
      }
    };
  }
})();

(function(){
'use strict';

// ═══════════════════════════════════════════════════════
// §1 — SILOTAGE DÉFENSIF
//      Garantit qu'on ne peut jamais lire/écrire dans un
//      tableau sans être dans le contexte du bon voyage.
// ═══════════════════════════════════════════════════════

/**
 * Wrapper défensif autour de snapshotCurrentTrip.
 * Refuse silencieusement si currentTripId est null
 * (évite d'écraser allTrips[null]).
 */
// [migrated to module — see header]

// ═══════════════════════════════════════════════════════
// §2 — FORMULAIRES MODAL : PROTECTION CONTRE L'ORPHELIN
//      Si form-location (ou autre) se retrouve dans l'overlay
//      sans ancre valide, on le restitue proprement.
// ═══════════════════════════════════════════════════════

/**
 * Restitue tous les formulaires modal qui seraient orphelins
 * (dans l'overlay sans ancre dans le DOM).
 * Appelé au chargement + à chaque openTrip.
 */
// [migrated to module — see header]

// ═══════════════════════════════════════════════════════
// §3 — CSS UNIFICATION : classe .card-item sur toutes les fiches
//      Injecte la règle une seule fois sans toucher le CSS existant.
// ═══════════════════════════════════════════════════════
(function _injectCardItemClass(){
  var style = document.createElement('style');
  style.id = 'yume-master-styles';
  style.textContent = [
    /* Classe unifiée – fond blanc, border, ombre, rayon */
    '.card-item{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);box-shadow:var(--shadow-sm);position:relative;overflow:hidden}',
    /* Aligner toutes les fiches sémantiques sur la même base visuelle */
    '.hotel-item,.loc-card,.mob-item,.pass-card,.place-card,.train-item{background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow-sm)}',
    /* Bouton ✏ — toujours visible en mode édition, hidden sinon */
    '.edit-item-btn{visibility:hidden;opacity:0;pointer-events:none;position:absolute;top:8px;right:8px;width:28px;height:28px;border-radius:50%;background:var(--sakura);border:none;color:#fff;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:opacity .15s,transform .15s;z-index:5}',
    /* Settings modal — s'assurer qu'il est toujours par-dessus tout */
    '#settings-modal-overlay{z-index:3000}',
    /* Form modal overlay — au-dessus des sections mais sous settings */
    '#form-modal-overlay{z-index:2500}',
  ].join('\n');
  document.head.appendChild(style);
})();

// ═══════════════════════════════════════════════════════
// §4 — CRUD : VÉRIFICATION DES IDs AU SAVE/DELETE
//      Chaque fonction save/delete loggue un warning si
//      l'item cible est introuvable (détection régression).
// ═══════════════════════════════════════════════════════

/**
 * Wrapper générique : entoure une fonction save/delete
 * d'une vérification de cohérence ID + snapshot forcé.
 * @param {string} fnName   Nom de la fonction globale
 * @param {string} dataKey  Nom du tableau global (ex: 'hotels')
 */
function _wrapCRUD(fnName, dataKey){
  var orig = window[fnName];
  if(typeof orig !== 'function') return;
  window[fnName] = function(id){
    // Normalisation ID (int ou string)
    var nid = (typeof id === 'string' && isNaN(+id)) ? id : +id;
    var arr = window[dataKey];
    if(!Array.isArray(arr)){
      console.warn('[Yume] '+fnName+': tableau "'+dataKey+'" introuvable');
      return orig.apply(this, arguments);
    }
    var item = arr.find(function(x){ return x.id == nid; });
    if(!item){
      console.warn('[Yume] '+fnName+': item id='+nid+' introuvable dans '+dataKey);
      // Fermer la modal quand même pour ne pas bloquer l'UI
      if(typeof closeModal==='function') closeModal();
      return;
    }
    orig.apply(this, arguments);
    // Snapshot de sécurité après toute opération CRUD
    if(typeof snapshotCurrentTrip === 'function') snapshotCurrentTrip();
  };
}

// Appliquer après que toutes les fonctions soient définies
document.addEventListener('DOMContentLoaded', function(){
  _wrapCRUD('saveHotel',    'hotels');
  _wrapCRUD('deleteHotel',  'hotels');
  _wrapCRUD('saveLieu',     'lieux');
  _wrapCRUD('deleteLieu',   'lieux');
  _wrapCRUD('saveLocation', 'locations');
  _wrapCRUD('deleteLocation','locations');
  _wrapCRUD('savePass',     'passes');
  _wrapCRUD('deletePass',   'passes');
  _wrapCRUD('saveMobilite', 'mobilites');
  _wrapCRUD('deleteMobilite','mobilites');
});

// ═══════════════════════════════════════════════════════
// §5 — ERGONOMIE : SETTINGS MODAL
//      Assure que closeSettingsModal fonctionne aussi en
//      cliquant l'overlay (pas seulement le bouton ✕).
// ═══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function(){
  var settingsOverlay = document.getElementById('settings-modal-overlay');
  if(settingsOverlay && typeof closeSettingsModal === 'function'){
    // S'assurer que le click sur le fond ferme bien la modal
    settingsOverlay.addEventListener('click', function(e){
      if(e.target === settingsOverlay) closeSettingsModal(e);
    });
  }
});

// ═══════════════════════════════════════════════════════
// §6 — ERGONOMIE : BOUTON + PASS
//      Si openMobiliteAs('pass') échoue (form non disponible),
//      afficher un toast d'erreur plutôt que le silence.
// ═══════════════════════════════════════════════════════
var _masterOrigOpenMobAs = typeof openMobiliteAs === 'function' ? openMobiliteAs : null;
if(_masterOrigOpenMobAs){
  openMobiliteAs = function(type){
    var form = document.getElementById('form-mobilite');
    if(!form){
      if(typeof showToast === 'function') showToast('Formulaire mobilité introuvable', 'error');
      console.error('[Yume] openMobiliteAs: #form-mobilite absent du DOM');
      return;
    }
    _masterOrigOpenMobAs.apply(this, arguments);
  };
}

// ═══════════════════════════════════════════════════════
// §7 — AUTOTEST : rapport console au chargement
//      Vérifie les invariants critiques de l'app engine.
// ═══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function(){
  setTimeout(function(){
    var ok = [], ko = [];
    function check(label, cond){ cond ? ok.push(label) : ko.push(label); }

    check('snapshotCurrentTrip définie',   typeof snapshotCurrentTrip === 'function');
    check('restoreTrip définie',           typeof restoreTrip === 'function');
    check('openTrip définie',              typeof openTrip === 'function');
    check('toggleForm définie',            typeof toggleForm === 'function');
    check('openModal définie',             typeof openModal === 'function');
    check('closeModal définie',            typeof closeModal === 'function');
    check('openSettingsModal définie',     typeof openSettingsModal === 'function');
    check('renderHotels définie',          typeof renderHotels === 'function');
    check('renderLocations définie',       typeof renderLocations === 'function');
    check('renderLieux définie',           typeof renderLieux === 'function');
    check('renderPasses définie',          typeof renderPasses === 'function');
    check('renderMobilite définie',        typeof renderMobilite === 'function');
    check('#form-location présent',        !!document.getElementById('form-location'));
    check('#form-mobilite présent',        !!document.getElementById('form-mobilite'));
    check('#form-hotel présent',           !!document.getElementById('form-hotel'));
    check('#editModal présent',            !!document.getElementById('editModal'));
    check('#settings-modal-overlay présent',!!document.getElementById('settings-modal-overlay'));
    check('#form-modal-overlay présent',   !!document.getElementById('form-modal-overlay'));
    check('allTrips défini',               typeof allTrips !== 'undefined');

    console.log('[Yume] Autotest — '+(ko.length===0?'TOUT OK':ko.length+' problème(s)'));
    ok.forEach(function(m){console.log(m);});
    ko.forEach(function(m){console.warn(m);});

    if(ko.length > 0){
      console.error('[Yume] Problèmes détectés :', ko);
    }
  }, 500);
});

// ═══════════════════════════════════════════════════════
// §8 — PHASE 2 : GESTION DE GROUPE & BUDGET PARTAGÉ
// ═══════════════════════════════════════════════════════

// ── Variables globales groupe ──
var _tripMembers    = []; // Membres du voyage actif (chargés à openTrip)
var _newTripMembers = []; // Membres en saisie dans la modal create/edit

// ── Helpers ──
function _getCurrentTripMeta(){
  if(!currentTripId || !allTrips[currentTripId]) return null;
  return allTrips[currentTripId].meta;
}

function _isGroupTrip(){
  var m = _getCurrentTripMeta();
  return !!(m && m.groupMode === true && m.members && m.members.length >= 2);
}

// ════════════════════════════════════════════════
// A. TOGGLE SOLO / GROUPE dans la modal de création
// ════════════════════════════════════════════════

function selectGroupMode(mode, btn){
  // Active visuellement le bon bouton
  document.querySelectorAll('.gts-btn').forEach(function(b){ b.classList.remove('active'); });
  if(btn) btn.classList.add('active');
  // Mémorise le choix
  var inp = document.getElementById('new-trip-group-mode');
  if(inp) inp.value = mode;
  // Affiche/masque le bloc membres
  var wrap = document.getElementById('group-members-wrap');
  if(wrap) wrap.classList.toggle('visible', mode === 'groupe');
  // Focus sur l'input si on vient d'ouvrir le bloc
  if(mode === 'groupe'){
    setTimeout(function(){
      var mi = document.getElementById('new-member-input');
      if(mi) mi.focus();
    }, 100);
  }
}

// ── Chips membres ──
function addMemberChip(){
  var inp = document.getElementById('new-member-input');
  if(!inp) return;
  var name = inp.value.trim();
  if(!name) return;
  var already = _newTripMembers.some(function(m){
    return m.toLowerCase() === name.toLowerCase();
  });
  if(already){ inp.value = ''; inp.focus(); return; }
  _newTripMembers.push(name);
  inp.value = '';
  inp.focus();
  _renderMemberChips();
}

function removeMemberChip(idx){
  _newTripMembers.splice(idx, 1);
  _renderMemberChips();
}

function _renderMemberChips(){
  var container = document.getElementById('members-chips-list');
  if(!container) return;
  container.innerHTML = _newTripMembers.map(function(m, i){
    return '<span class="member-chip">'
      + m
      + '<button class="member-chip-del" onclick="removeMemberChip('+i+')" type="button">×</button>'
      + '</span>';
  }).join('');
}

// ── Reset complet des champs groupe dans la modal ──
function _resetGroupModalFields(){
  // Bouton Solo actif
  document.querySelectorAll('.gts-btn').forEach(function(b){ b.classList.remove('active'); });
  var btnSolo = document.getElementById('gts-solo');
  if(btnSolo) btnSolo.classList.add('active');
  var inp = document.getElementById('new-trip-group-mode');
  if(inp) inp.value = 'solo';
  var wrap = document.getElementById('group-members-wrap');
  if(wrap) wrap.classList.remove('visible');
  _newTripMembers = [];
  _renderMemberChips();
}

// ── Pre-fill groupe quand on édite un voyage existant ──
function _prefillGroupFields(meta){
  if(!meta) return;
  var mode = meta.groupMode ? 'groupe' : 'solo';
  var btn = document.getElementById(mode === 'groupe' ? 'gts-groupe' : 'gts-solo');
  selectGroupMode(mode, btn);
  _newTripMembers = (mode === 'groupe' && Array.isArray(meta.members))
    ? meta.members.slice() : [];
  _renderMemberChips();
}

// ════════════════════════════════════════════════
// B. HOOKS SUR createTrip / _resetCreateModal / edit
//    (un seul DOMContentLoaded, pas de chaîne)
// ════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', function(){

  // ── B1. Wrap createTrip ──
  var _origCT = window.createTrip;
  if(_origCT){
    window.createTrip = function(){
      var modal   = document.getElementById('create-modal');
      var editTid = modal ? modal.getAttribute('data-edit-tid') : null;
      var gMode   = (document.getElementById('new-trip-group-mode') || {}).value || 'solo';
      var members = (gMode === 'groupe') ? _newTripMembers.slice() : [];

      // Validation groupe
      if(gMode === 'groupe' && members.length < 2){
        if(typeof showToast === 'function')
          showToast('Ajoutez au moins 2 membres pour un voyage en groupe.', 'error');
        var mi = document.getElementById('new-member-input');
        if(mi) mi.focus();
        return;
      }

      if(editTid && allTrips[editTid]){
        // MODE ÉDITION : appel original, puis patch meta
        _origCT.apply(this, arguments);
        if(allTrips[editTid]){
          allTrips[editTid].meta.groupMode = (gMode === 'groupe');
          allTrips[editTid].meta.members   = members;
          if(typeof saveAllTrips === 'function') saveAllTrips();
          if(editTid === currentTripId) _loadTripMembers(editTid);
        }
      } else {
        // MODE CRÉATION : snapshot IDs avant/après pour trouver le nouveau
        var beforeIds = Object.keys(allTrips);
        _origCT.apply(this, arguments);
        var afterIds  = Object.keys(allTrips);
        var newId     = afterIds.filter(function(id){
          return beforeIds.indexOf(id) === -1;
        })[0];
        if(newId && allTrips[newId]){
          allTrips[newId].meta.groupMode = (gMode === 'groupe');
          allTrips[newId].meta.members   = members;
          if(typeof saveAllTrips === 'function') saveAllTrips();
        }
      }
      // Reset champs groupe dans tous les cas
      _resetGroupModalFields();
    };
  }

  // ── B2. _resetCreateModal — géré nativement (voir la fonction originale) ──
  // _resetGroupModalFields() est maintenant appelé directement dans _resetCreateModal().

  // ── B3. openCreateModal en mode création → reset groupe ──
  // Note : en mode édition, _prefillGroupFields() est appelé APRÈS openCreateModal()
  // directement dans le bloc éditeur (ligne ~6840). On ne wrape PAS openCreateModal
  // pour éviter d'écraser ce prefill.
  // Le reset se fait naturellement via _resetCreateModal() en fin de cycle.

});

// ════════════════════════════════════════════════
// C. CHARGEMENT DES MEMBRES AU openTrip
// ════════════════════════════════════════════════

function _loadTripMembers(tid){
  var meta = allTrips[tid] && allTrips[tid].meta;
  _tripMembers = (meta && meta.groupMode && Array.isArray(meta.members))
    ? meta.members.slice() : [];
  _updateBudgetGroupUI();
  _updateTxGroupFields();
}

// Patch openTrip — un seul wrap, direct
(function(){
  var _orig = typeof openTrip === 'function' ? openTrip : null;
  if(!_orig) return;
  openTrip = function(tid){
    _orig.apply(this, arguments);
    _loadTripMembers(tid);
  };
})();

// ════════════════════════════════════════════════
// D. UI BUDGET — bouton Équilibres
// ════════════════════════════════════════════════

function _updateBudgetGroupUI(){
  var wrap = document.getElementById('budget-groupe-btn-wrap');
  if(!wrap) return;
  wrap.style.display = _isGroupTrip() ? '' : 'none';
}

// ════════════════════════════════════════════════
// E. CHAMPS GROUPE DANS LE FORMULAIRE DÉPENSE
// ════════════════════════════════════════════════

function _updateTxGroupFields(){
  var fields = document.getElementById('tx-group-fields');
  if(!fields) return;
  var isGroup = _isGroupTrip();
  fields.classList.toggle('visible', isGroup);
  if(!isGroup) return;

  // "Payé par" — select
  var selPaidBy = document.getElementById('tx-paidby');
  if(selPaidBy){
    selPaidBy.innerHTML = _tripMembers.map(function(name){
      return '<option value="'+name+'">'+name+'</option>';
    }).join('');
  }

  // "Pour qui" — chips cliquables
  var grid = document.getElementById('tx-forwho-grid');
  if(grid){
    var html = '<span class="forwho-check all-check checked" data-who="__all__" onclick="_toggleForWho(this)">Tout le monde</span>';
    html += _tripMembers.map(function(name){
      return '<span class="forwho-check" data-who="'+name+'" onclick="_toggleForWho(this)">'+name+'</span>';
    }).join('');
    grid.innerHTML = html;
  }
}

function _toggleForWho(el){
  var grid = document.getElementById('tx-forwho-grid');
  if(!grid) return;
  var isAll = el.dataset.who === '__all__';
  if(isAll){
    var nowChecked = el.classList.contains('checked');
    grid.querySelectorAll('.forwho-check').forEach(function(c){ c.classList.remove('checked'); });
    if(!nowChecked) el.classList.add('checked');
  } else {
    var allBtn = grid.querySelector('.all-check');
    if(allBtn) allBtn.classList.remove('checked');
    el.classList.toggle('checked');
    // Si tous cochés → basculer vers "Tout le monde"
    var memberChecks = Array.from(grid.querySelectorAll('.forwho-check:not(.all-check)'));
    var allChecked   = memberChecks.every(function(c){ return c.classList.contains('checked'); });
    if(allChecked && allBtn){
      memberChecks.forEach(function(c){ c.classList.remove('checked'); });
      allBtn.classList.add('checked');
    }
  }
}

function _getForWhoList(){
  var grid = document.getElementById('tx-forwho-grid');
  if(!grid) return _tripMembers.slice();
  var allBtn = grid.querySelector('.all-check');
  if(allBtn && allBtn.classList.contains('checked')) return _tripMembers.slice();
  var checked = Array.from(grid.querySelectorAll('.forwho-check:not(.all-check).checked'));
  var names   = checked.map(function(c){ return c.dataset.who; });
  return names.length ? names : _tripMembers.slice();
}

function _resetForWho(){
  var grid = document.getElementById('tx-forwho-grid');
  if(!grid) return;
  grid.querySelectorAll('.forwho-check').forEach(function(c){ c.classList.remove('checked'); });
  var allBtn = grid.querySelector('.all-check');
  if(allBtn) allBtn.classList.add('checked');
}

// ════════════════════════════════════════════════
// F. PATCH addTransaction — stocke paidBy / forWho
// ════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', function(){
  var _origAddTx = window.addTransaction;
  if(!_origAddTx) return;
  window.addTransaction = function(){
    var isGroup = _isGroupTrip();
    var paidBy  = isGroup ? ((document.getElementById('tx-paidby')||{}).value||'') : '';
    var forWho  = isGroup ? _getForWhoList() : [];
    var lenBefore = transactions.length;
    _origAddTx.apply(this, arguments);
    if(transactions.length > lenBefore && isGroup && paidBy){
      transactions[transactions.length - 1].paidBy = paidBy;
      transactions[transactions.length - 1].forWho  = forWho;
      if(typeof snapshotCurrentTrip === 'function') snapshotCurrentTrip();
      if(typeof updateBudget        === 'function') updateBudget();
    }
    _resetForWho();
  };
});

// ════════════════════════════════════════════════
// G. PATCH updateBudget — badges paidBy dans historique
// ════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', function(){
  var _origUB = window.updateBudget;
  if(!_origUB) return;
  window.updateBudget = function(){
    _origUB.apply(this, arguments);
    if(!_isGroupTrip()) return;
    var txEl = document.getElementById('tx-list');
    if(!txEl) return;
    var items      = txEl.querySelectorAll('.tx-item');
    var txReversed = transactions.slice().reverse();
    items.forEach(function(item, idx){
      var tx = txReversed[idx];
      if(!tx || !tx.paidBy) return;
      // Badge "payé par"
      var descEl = item.querySelector('.tx-desc');
      if(descEl && !descEl.querySelector('.tx-paidby-badge')){
        var badge = document.createElement('span');
        badge.className   = 'tx-paidby-badge';
        badge.textContent = tx.paidBy;
        descEl.appendChild(badge);
      }
      // Ligne "Pour : ..."
      var catEl = item.querySelector('.tx-cat');
      if(catEl && tx.forWho && tx.forWho.length && !item.querySelector('.tx-forwho-line')){
        var fwLine = document.createElement('div');
        fwLine.className   = 'tx-forwho-line';
        fwLine.textContent = 'Pour : ' + tx.forWho.join(', ');
        catEl.parentNode.insertBefore(fwLine, catEl.nextSibling);
      }
    });
  };
});

// ════════════════════════════════════════════════
// H. ALGORITHME TRICOUNT — Calcul des balances
// ════════════════════════════════════════════════

function computeGroupBalances(txList, members){
  var paid  = {};
  var share = {};
  members.forEach(function(m){ paid[m]=0; share[m]=0; });

  txList.forEach(function(tx){
    if(!tx.paidBy || members.indexOf(tx.paidBy) === -1) return;
    var fw         = (tx.forWho && tx.forWho.length) ? tx.forWho : members;
    var recipients = fw.filter(function(p){ return members.indexOf(p) !== -1; });
    if(!recipients.length) recipients = members;
    var perHead = tx.amount / recipients.length;
    paid[tx.paidBy] += tx.amount;
    recipients.forEach(function(p){ share[p] += perHead; });
  });

  var net = {};
  members.forEach(function(m){
    net[m] = Math.round((paid[m] - share[m]) * 100) / 100;
  });

  // Greedy debt settlement
  var creditors = [], debtors = [];
  members.forEach(function(m){
    if(net[m] >  0.005) creditors.push({ name:m, amount:  net[m]  });
    if(net[m] < -0.005) debtors.push({   name:m, amount: -net[m]  });
  });
  creditors.sort(function(a,b){ return b.amount - a.amount; });
  debtors.sort(function(a,b)  { return b.amount - a.amount; });

  var transfers = [];
  var ci = 0, di = 0;
  while(ci < creditors.length && di < debtors.length){
    var c = creditors[ci], d = debtors[di];
    var amt = Math.round(Math.min(c.amount, d.amount) * 100) / 100;
    if(amt > 0.005) transfers.push({ from:d.name, to:c.name, amount:amt });
    c.amount -= amt; d.amount -= amt;
    if(c.amount < 0.005) ci++;
    if(d.amount < 0.005) di++;
  }
  return { paid:paid, share:share, net:net, transfers:transfers };
}

// ════════════════════════════════════════════════
// I. MODAL ÉQUILIBRES
// ════════════════════════════════════════════════

var _gbHideDetails = false;

function openGroupBalances(){
  if(!_isGroupTrip()) return;
  window._gbHideDetails = false;
  _renderGroupBalances();
  var sub = document.getElementById('gb-members-sub');
  if(sub) sub.textContent = _tripMembers.join(' · ');
  var overlay = document.getElementById('group-balances-overlay');
  if(overlay) overlay.classList.add('open');
}

function closeGroupBalances(){
  var overlay = document.getElementById('group-balances-overlay');
  if(overlay) overlay.classList.remove('open');
}

function closeGroupBalancesOnBg(e){
  if(e.target === document.getElementById('group-balances-overlay'))
    closeGroupBalances();
}

function _renderGroupBalances(){
  var body = document.getElementById('gb-body');
  if(!body) return;
  var bal   = computeGroupBalances(transactions, _tripMembers);
  var spent = transactions.reduce(function(s,t){ return s+t.amount; }, 0);
  var toggleChecked = window._gbHideDetails ? 'checked' : '';

  var html = '<div class="gb-toggle-row">'
    + '<span class="gb-toggle-label">Cacher les détails</span>'
    + '<label class="gb-switch">'
    + '<input type="checkbox" id="gb-hide-toggle" '+toggleChecked
    + ' onchange="window._gbHideDetails=this.checked;window._renderGroupBalances()">'
    + '<span class="gb-slider"></span>'
    + '</label></div>';

  if(window._gbHideDetails){
    html += '<div class="gb-hidden-view">'
      + '<div class="gb-hidden-total">'
      + spent.toLocaleString('fr-FR',{minimumFractionDigits:2})+' €</div>'
      + '<div class="gb-hidden-label">Total dépensé par le groupe</div>'
      + '</div>';
  } else {
    var avatarBg   = ['#e8f0f8','#fceef1','#e8f5f0','#fdf3df','#f0e8f8','#e8f5f8'];
    var avatarFg   = ['#2d5e8c','#c4546e','#2d8c6b','#c9921a','#7b5ea7','#2d7c8c'];

    html += '<div class="gb-summary"><div class="gb-summary-title">Soldes individuels</div>';
    _tripMembers.forEach(function(m, i){
      var n     = bal.net[m] || 0;
      var cls   = n >  0.005 ? 'positive' : n < -0.005 ? 'negative' : 'neutral';
      var sign  = n >  0.005 ? '+' : '';
      var label = n >  0.005 ? 'à recevoir' : n < -0.005 ? 'à rembourser' : 'équilibré';
      html += '<div class="gb-person-card">'
        + '<div class="gb-person-avatar" style="background:'+avatarBg[i%6]+';color:'+avatarFg[i%6]+'">'
        + m.charAt(0).toUpperCase()+'</div>'
        + '<div style="flex:1;min-width:0">'
          + '<div class="gb-person-name">'+m+'</div>'
          + '<div class="gb-person-detail">Payé '+(bal.paid[m]||0).toLocaleString('fr-FR',{minimumFractionDigits:2})
          + ' € · Part '+(bal.share[m]||0).toLocaleString('fr-FR',{minimumFractionDigits:2})+' €</div>'
        + '</div>'
        + '<div class="gb-person-balance">'
          + '<div class="gb-balance-amount '+cls+'">'+sign+n.toLocaleString('fr-FR',{minimumFractionDigits:2})+' €</div>'
          + '<div class="gb-balance-label">'+label+'</div>'
        + '</div></div>';
    });
    html += '</div>';

    if(bal.transfers.length){
      html += '<div class="gb-transfers"><div class="gb-summary-title">Remboursements suggérés</div>';
      bal.transfers.forEach(function(t){
        html += '<div class="gb-transfer-item">'
          + '<span class="gb-transfer-from">'+t.from+'</span>'
          + '<span class="gb-transfer-arrow">→</span>'
          + '<span class="gb-transfer-to">'+t.to+'</span>'
          + '<span class="gb-transfer-amount">'
          + t.amount.toLocaleString('fr-FR',{minimumFractionDigits:2})+' €</span>'
          + '</div>';
      });
      html += '</div>';
    } else {
      html += '<div style="text-align:center;padding:16px;color:var(--teal);font-size:13px;font-weight:500">'
        + 'Tout le monde est à l\'équilibre !</div>';
    }
  }
  body.innerHTML = html;
}

// Injection DOM de la modal Équilibres (une seule fois)
document.addEventListener('DOMContentLoaded', function(){
  if(document.getElementById('group-balances-overlay')) return; // déjà présente
  var el = document.createElement('div');
  el.id = 'group-balances-overlay';
  el.setAttribute('onclick', 'closeGroupBalancesOnBg(event)');
  el.innerHTML =
    '<div id="group-balances-box">'
    + '<div class="gb-header">'
      + '<div>'
        + '<div class="gb-title">Équilibres du groupe</div>'
        + '<div class="gb-sub" id="gb-members-sub"></div>'
      + '</div>'
      + '<button class="gb-close" onclick="closeGroupBalances()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
    + '</div>'
    + '<div class="gb-body" id="gb-body"></div>'
    + '</div>';
  document.body.appendChild(el);
});

// ════════════════════════════════════════════════
// J. PATCH switchSection — refresh UI groupe onglet Budget
// ════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', function(){
  var _origSS = window.switchSection;
  if(!_origSS) return;
  window.switchSection = function(id, btn){
    _origSS.apply(this, arguments);
    if(id === 'budget'){
      _updateBudgetGroupUI();
      _updateTxGroupFields();
    }
  };
});

// ════════════════════════════════════════════════
// K. EXPOSITION GLOBALE — fonctions appelées depuis onclick HTML
//    (toutes définies dans ce IIFE, donc privées sans ce bloc)
// ════════════════════════════════════════════════

window.selectGroupMode    = selectGroupMode;
window.addMemberChip      = addMemberChip;
window.removeMemberChip   = removeMemberChip;
window._toggleForWho      = _toggleForWho;
window.openGroupBalances  = openGroupBalances;
window.closeGroupBalances = closeGroupBalances;
window.closeGroupBalancesOnBg = closeGroupBalancesOnBg;
window._renderGroupBalances   = _renderGroupBalances;
window._gbHideDetails         = _gbHideDetails; // sera mis à jour via window.

})(); // fin BLOC MAÎTRE

// ════════════════════════════════════════════════════════════
// FIX 2 — Reset systématique des formulaires
// ════════════════════════════════════════════════════════════

// ── Reset form-location ──────────────────────────────────────
window._resetFormLocation = function(){
  var ids = ['loc-modele','loc-loueur','loc-resa','loc-date-dep','loc-date-ret',
             'loc-lieu-dep','loc-lieu-ret','loc-caution','loc-note','loc-pdf'];
  ids.forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.value = '';
  });
  var typeEl = document.getElementById('loc-type');
  if(typeEl) typeEl.selectedIndex = 0;
  var statutEl = document.getElementById('loc-statut');
  if(statutEl) statutEl.selectedIndex = 0;
  var heureEl = document.getElementById('loc-heure-ret');
  if(heureEl) heureEl.value = '';
  var badge = document.getElementById('loc-pdf-badge');
  if(badge) badge.innerHTML = '';
};

// ── Reset form-mobilite (complet, tous les groupes) ──────────
window._resetFormMobilite = function(){
  // Champs communs
  ['mob-note','mob-pdf'].forEach(function(id){
    var el = document.getElementById(id); if(el) el.value = '';
  });
  var badge = document.getElementById('mob-pdf-badge');
  if(badge) badge.innerHTML = '';
  // Statut
  var st = document.getElementById('mob-statut'); if(st) st.selectedIndex = 0;
  // Tous les groupes : vider inputs text + time
  ['mob-group-vol','mob-group-train','mob-group-bateau','mob-group-autre','mob-group-pass'].forEach(function(gid){
    var g = document.getElementById(gid); if(!g) return;
    g.querySelectorAll('input[type=text],input[type=time],input[type=number],textarea').forEach(function(inp){
      inp.value = '';
    });
    // Durée display
    var dd = g.querySelector('[id="mob-duree-display"]');
    if(dd) dd.textContent = '—';
    var hd = g.querySelector('[id="mob-duree"]');
    if(hd) hd.value = '';
  });
  // Sortie du mode édition (vol unifié) : le prochain « nouveau vol » ne doit
  // hériter d'aucune donnée ni escale du vol précédemment édité.
  if(typeof _mobCancelEdit === 'function') _mobCancelEdit();
  // Escales : décocher + réinitialiser le compteur, puis toggleMobEscales()
  // (branche décochée) restaure titre, labels, #mob-direct-details et vide
  // les blocs dynamiques (donc aussi les horaires d'extrémité propagés).
  var escChk = document.getElementById('mob-escale-check');
  if(escChk) escChk.checked = false;
  if(typeof _mobEscCount !== 'undefined') _mobEscCount = 1;
  if(typeof toggleMobEscales === 'function') toggleMobEscales();
  // Nettoyer le badge PDF du formulaire
  var mpb=document.getElementById('mob-pdf-badge'); if(mpb) mpb.innerHTML='';
  // Route preview
  var prev = document.getElementById('mob-route-preview');
  if(prev){ prev.textContent = ''; prev.classList.remove('visible'); }
  // Pass categorie reset
  var passCat = document.getElementById('mob-pass-categorie');
  if(passCat) passCat.selectedIndex = 0;
  var passStatut = document.getElementById('mob-pass-statut');
  if(passStatut) passStatut.selectedIndex = 0;
  // Coords gares
  ['mob-dep-lat','mob-dep-lng','mob-arr-lat','mob-arr-lng'].forEach(function(id){
    var el = document.getElementById(id); if(el) el.value = '';
  });
};

// ── Patch toggleForm : reset à l'ouverture pour form-mobilite et form-location ──
(function(){
  var _orig = window.toggleForm;
  if(typeof _orig !== 'function') return;
  window.toggleForm = function(id){
    var isOpening = !document.getElementById(id) ? false
                  : !document.getElementById(id).classList.contains('open');
    _orig.apply(this, arguments);
    if(isOpening){
      if(id === 'form-mobilite') window._resetFormMobilite();
      if(id === 'form-location') window._resetFormLocation();
    }
  };
})();

// ── Patch _closeFormModal : reset aussi à la fermeture (croix, Échap, backdrop) ──
(function(){
  var _origClose = window._closeFormModal;
  if(typeof _origClose !== 'function') return;
  window._closeFormModal = function(formId, restoreAnchor){
    if(formId === 'form-mobilite') window._resetFormMobilite();
    if(formId === 'form-location') window._resetFormLocation();
    if(formId === 'form-hotel' && typeof _resetFormFields === 'function') _resetFormFields('hotel');
    if(formId === 'form-lieu'  && typeof _resetFormFields === 'function') _resetFormFields('lieu');
    _origClose.apply(this, arguments);
  };
})();

// ════════════════════════════════════════════════════════════
// FIX 3 — AUTOCOMPLETE GARES AVEC COORDONNÉES LAT/LNG
// ════════════════════════════════════════════════════════════

// ── Base de données des grandes gares mondiales ──────────────
// Format : { 'Nom Gare': { pays:'…', lat: X, lng: Y, uic:'…' } }
// [migrated to module — see header]

// ── Cache Nominatim pour les gares non trouvées dans STATION_DATA ──
var _stationGeoCache = {};

// ── Recherche dans STATION_DATA (fuzzy match sur le nom) ──────
function _searchStations(query, maxResults) {
  var q = query.trim().toLowerCase();
  if(!q || q.length < 2) return [];
  var results = [];
  // 1. Nom commence par la query (ex: "Paris" → "Paris Gare du Nord")
  var starts = Object.keys(STATION_DATA).filter(function(n){
    return n.toLowerCase().indexOf(q) === 0;
  });
  // 2. Nom contient la query n'importe où (ex: "nord" → "Paris Gare du Nord")
  var contains = Object.keys(STATION_DATA).filter(function(n){
    var nl = n.toLowerCase();
    return nl.indexOf(q) > 0;
  });
  // 3. La query contient le nom de la gare
  //    (ex: "Tokyo Station" contient "Tokyo" → retourne 'Tokyo')
  var queryContains = Object.keys(STATION_DATA).filter(function(n){
    var nl = n.toLowerCase();
    return nl.length >= 3 && q.indexOf(nl) !== -1 && starts.indexOf(n) === -1 && contains.indexOf(n) === -1;
  });
  results = starts.concat(contains).concat(queryContains).slice(0, maxResults || 7);
  return results;
}

// ── Geocodage Nominatim avec cache ────────────────────────────
function _geocodeStation(query, callback) {
  if(_stationGeoCache[query]){
    callback(_stationGeoCache[query]); return;
  }
  fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='
    + encodeURIComponent(query + ' gare station train'),
    {headers:{'Accept-Language':'fr,en'}}
  ).then(function(r){ return r.json(); })
  .then(function(data){
    if(data && data.length){
      var res = {lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon)};
      _stationGeoCache[query] = res;
      callback(res);
    } else {
      callback(null);
    }
  }).catch(function(){ callback(null); });
}

// ── Remplace onTrainVilleInput avec gares + coordonnées ───────
window.onTrainVilleInput = function(side, val){
  var boxId = 'ac-tr-' + (side === 'dep' ? 'dep' : 'arr');
  var box = document.getElementById(boxId);
  if(!box) return;
  if(!val.trim()){ box.classList.remove('open'); return; }

  var hits = _searchStations(val, 7);

  if(!hits.length){ box.classList.remove('open'); return; }

  box.innerHTML = hits.map(function(name){
    var d = STATION_DATA[name];
    var _rc = typeof _detectRailCompany==='function' ? _detectRailCompany(name) : null;
    var _stIcon = _rc
      ? '<span style="width:14px;height:14px;display:inline-flex;align-items:center;color:'+_rc.color+'">'+_rc.icon+'</span>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="7" width="20" height="10" rx="4"/><line x1="2" y1="12" x2="22" y2="12"/><circle cx="7" cy="17" r="1.5"/><circle cx="17" cy="17" r="1.5"/></svg>';
    return '<div class="ac-item" data-name="' + name.replace(/"/g,'&quot;')
      + '" data-lat="' + d.lat + '" data-lng="' + d.lng
      + '" data-side="' + side + '">'
      + '<span style="display:flex;align-items:center;gap:5px">' + _stIcon + name + '</span>'
      + '<span class="ac-sub">' + d.pays + '</span>'
      + '</div>';
  }).join('');
  box.classList.add('open');

  box.querySelectorAll('.ac-item').forEach(function(item){
    item.addEventListener('click', function(){
      var name = this.getAttribute('data-name');
      var lat  = parseFloat(this.getAttribute('data-lat'));
      var lng  = parseFloat(this.getAttribute('data-lng'));
      var s    = this.getAttribute('data-side');

      // Remplir l'input visible (mob-dep ou mob-arr dans le groupe train actif)
      var groupEl = document.getElementById('mob-group-train');
      if(groupEl){
        var inputs = groupEl.querySelectorAll('[id="mob-' + (s==='dep'?'dep':'arr') + '"]');
        if(inputs.length) inputs[0].value = name;
      }
      // Stocker les coordonnées dans des champs cachés
      _setTrainCoords(s, lat, lng);
      box.classList.remove('open');
      updateMobPreview();
    });
  });
};

// ── Stocker les coordonnées gare dans champs cachés du form ──
function _setTrainCoords(side, lat, lng) {
  var latId = 'mob-' + (side==='dep'?'dep':'arr') + '-lat';
  var lngId = 'mob-' + (side==='dep'?'dep':'arr') + '-lng';
  var latEl = document.getElementById(latId);
  var lngEl = document.getElementById(lngId);
  if(latEl) latEl.value = lat || '';
  if(lngEl) lngEl.value = lng || '';
}

// ── Injecter les champs cachés lat/lng dans mob-group-train ──
document.addEventListener('DOMContentLoaded', function(){
  var trainGroup = document.getElementById('mob-group-train');
  if(!trainGroup) return;
  // Éviter la double injection
  if(trainGroup.querySelector('#mob-dep-lat')) return;
  var hiddens = document.createElement('div');
  hiddens.style.display = 'none';
  hiddens.innerHTML =
    '<input type="hidden" id="mob-dep-lat" value=""/>'
    + '<input type="hidden" id="mob-dep-lng" value=""/>'
    + '<input type="hidden" id="mob-arr-lat" value=""/>'
    + '<input type="hidden" id="mob-arr-lng" value=""/>';
  trainGroup.appendChild(hiddens);
});

// ── Lire les coordonnées au moment de la sauvegarde (addMobilite patch) ──
(function(){
  var _origAdd = window.addMobilite;
  if(typeof _origAdd !== 'function') return;
  window.addMobilite = function(){
    // Appel original d'abord — il crée l'objet et le push dans mobilites[]
    _origAdd.apply(this, arguments);
    // Récupérer le dernier trajet ajouté (le plus récent)
    var lastM = mobilites[mobilites.length - 1];
    if(!lastM || lastM.type === 'pass') return;
    if(lastM.type === 'train'){
      var depLat = parseFloat((document.getElementById('mob-dep-lat')||{}).value);
      var depLng = parseFloat((document.getElementById('mob-dep-lng')||{}).value);
      var arrLat = parseFloat((document.getElementById('mob-arr-lat')||{}).value);
      var arrLng = parseFloat((document.getElementById('mob-arr-lng')||{}).value);
      if(!isNaN(depLat) && !isNaN(depLng)){ lastM.depLat = depLat; lastM.depLng = depLng; }
      if(!isNaN(arrLat) && !isNaN(arrLng)){ lastM.arrLat = arrLat; lastM.arrLng = arrLng; }
      // Géocodage Nominatim en fallback si pas de coords
      if(!lastM.depLat && lastM.dep){
        _geocodeStation(lastM.dep, function(r){ if(r){ lastM.depLat=r.lat; lastM.depLng=r.lng; snapshotCurrentTrip(); }});
      }
      if(!lastM.arrLat && lastM.arr){
        _geocodeStation(lastM.arr, function(r){ if(r){ lastM.arrLat=r.lat; lastM.arrLng=r.lng; snapshotCurrentTrip(); }});
      }
    }
  };
})();

// ── Apprentissage gares personnalisées ────────────────────────
function _acLearnStation(name, lat, lng){
  if(!name || STATION_DATA[name]) return;
  STATION_DATA[name] = {pays:'Personnalisé', lat: lat||0, lng: lng||0};
  try{
    var cs = JSON.parse(localStorage.getItem('yume_custom_stations') || '{}');
    cs[name] = {pays:'Personnalisé', lat: lat||0, lng: lng||0};
    localStorage.setItem('yume_custom_stations', JSON.stringify(cs));
  }catch(e){}
}

// ══════════════════════════════════════════════════════════════════
// DICTIONNAIRE COMPAGNIES FERROVIAIRES
// Clé : fragment du nom saisi (insensible à la casse)
// Val : { name, abbr, color, icon (SVG inline) }
// ══════════════════════════════════════════════════════════════════
// [migrated to module — see header]

// Reconnaissance automatique de compagnie ferroviaire à la saisie
function _detectRailCompany(val){
  if(!val) return null;
  var q = val.toLowerCase().trim();
  if(q.length < 2) return null;
  // Priorité 1 : la query contient exactement la clé (ex: "tgv paris" contient "tgv")
  for(var key in RAIL_COMPANIES){
    if(q.indexOf(key) !== -1) return RAIL_COMPANIES[key];
  }
  // Priorité 2 : la clé commence par la query (ex: "shinka" → "shinkansen")
  for(var key2 in RAIL_COMPANIES){
    if(key2.indexOf(q) === 0 && q.length >= 3) return RAIL_COMPANIES[key2];
  }
  return null;
}

// Met à jour l'icône de compagnie dans le formulaire train
function _updateTrainCompanyIcon(val){
  var iconEl = document.getElementById('train-company-icon');
  var company = _detectRailCompany(val);
  if(!iconEl) return;
  if(company){
    iconEl.innerHTML = company.icon;
    iconEl.style.color = company.color;
    iconEl.title = company.name + ' · ' + company.abbr;
    iconEl.style.display = 'flex';
  } else {
    iconEl.style.display = 'none';
    iconEl.innerHTML = '';
  }
}

// Inject l'icône de compagnie dans le formulaire train au chargement
document.addEventListener('DOMContentLoaded', function(){
  var grp = document.getElementById('mob-group-train');
  if(!grp) return;
  // Chercher le champ compagnie dans le groupe train
  var compInput = grp.querySelector('[id="mob-compagnie"]');
  if(!compInput) return;
  // Créer le conteneur icône si absent
  if(!document.getElementById('train-company-icon')){
    var iconWrap = document.createElement('span');
    iconWrap.id = 'train-company-icon';
    iconWrap.style.cssText = 'display:none;align-items:center;justify-content:center;width:28px;height:28px;flex-shrink:0;margin-left:4px;';
    compInput.parentNode.style.display = 'flex';
    compInput.parentNode.style.alignItems = 'center';
    compInput.parentNode.appendChild(iconWrap);
  }
  // Écouter la saisie
  compInput.addEventListener('input', function(){ _updateTrainCompanyIcon(this.value); });
});

// Charger les gares personnalisées au démarrage
(function(){
  try{
    var cs = JSON.parse(localStorage.getItem('yume_custom_stations') || '{}');
    Object.keys(cs).forEach(function(k){ if(!STATION_DATA[k]) STATION_DATA[k] = cs[k]; });
  }catch(e){}
})();
// Sur blur : mémoriser la gare saisie manuellement si inconnue
document.addEventListener('DOMContentLoaded', function(){
  
  // Attacher après que le groupe train existe (peut être dans la modal)
  setTimeout(function(){
    var g = document.getElementById('mob-group-train');
    if(g){
      var deps = g.querySelectorAll('[id="mob-dep"]');
      var arrs = g.querySelectorAll('[id="mob-arr"]');
      if(deps.length) deps[0].addEventListener('blur', function(){
        var v = this.value.trim();
        if(v && !STATION_DATA[v]) _geocodeStation(v, function(r){ if(r){ _acLearnStation(v,r.lat,r.lng); _setTrainCoords('dep',r.lat,r.lng); }});
      });
      if(arrs.length) arrs[0].addEventListener('blur', function(){
        var v = this.value.trim();
        if(v && !STATION_DATA[v]) _geocodeStation(v, function(r){ if(r){ _acLearnStation(v,r.lat,r.lng); _setTrainCoords('arr',r.lat,r.lng); }});
      });
    }
  }, 500);
});



// ══════════════════════════════════════════════════════════════════════
// SOUS-SECTION DOCUMENTS — coffre-fort local (Liste / Catégories)
// Données : globale `documents` (siloée par voyage via state.js).
// ══════════════════════════════════════════════════════════════════════
var _docView = 'cat';   // 'liste' | 'cat' — défaut Catégories

// Catégories (ordre + libellé + icône filaire). 'passeport' est replié
// sous « Identité » pour le regroupement et la grille.
var DOC_CAT = {
  passeport:{ label:'Passeport',  group:'identite' },
  identite: { label:'Identité',   group:'identite' },
  visa:     { label:'Visa',       group:'visa' },
  assurance:{ label:'Assurance',  group:'assurance' },
  billets:  { label:'Billets',    group:'billets' },
  sante:    { label:'Santé',      group:'sante' },
  autre:    { label:'Autre',      group:'autre' }
};
var DOC_GROUP = {
  identite: { label:'Identité',  icon:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M13 9h5M13 13h5M5.5 16h6"/>' },
  visa:     { label:'Visa',      icon:'<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="10" r="2.4"/><path d="M9 15h6"/>' },
  assurance:{ label:'Assurance', icon:'<path d="M12 3l7 3v6c0 4.2-3 7.4-7 9-4-1.6-7-4.8-7-9V6z"/><path d="M9.5 12l1.8 1.8L15 10"/>' },
  billets:  { label:'Billets',   icon:'<path d="M4 9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 2 2 0 0 0 0-4z"/><path d="M14 7v10"/>' },
  sante:    { label:'Santé',     icon:'<path d="M12 20s-6-4.4-6-9a3.6 3.6 0 0 1 6-2.6A3.6 3.6 0 0 1 18 11c0 4.6-6 9-6 9z"/><path d="M9.5 11h5M12 8.5v5"/>' },
  autre:    { label:'Autre',     icon:'<path d="M14 3v5a1 1 0 0 0 1 1h5"/><path d="M9 4H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z"/><path d="M9 13h6M9 17h4"/>' }
};
var DOC_GROUP_ORDER = ['identite','visa','assurance','billets','sante','autre'];

function _docEsc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _docVal(id){ var e=document.getElementById(id); return e ? e.value : ''; }
function _docSet(id,v){ var e=document.getElementById(id); if(e) e.value = (v==null?'':v); }
function _docGroupKey(d){ var c=(d&&d.cat)||'autre'; return (DOC_CAT[c]&&DOC_CAT[c].group)||'autre'; }
// Pointeur de pièce jointe d'un document. `pdfId` = convention partagée ;
// `file` = fallback lecture pour un doc non encore migré (voir _migrateAllTrips).
function _docPdfId(d){ return (d && (d.pdfId || d.file)) || ''; }
// Injecte le bloc pièce jointe partagé (voir/remplacer/supprimer) dans le
// formulaire doc — même UX que hôtels/vols/pass (mPdfBlock + openPdf).
function _docFillPdfSlot(pdfId){
  var slot=document.getElementById('doc-pdf-slot');
  if(slot && typeof mPdfBlock==='function') slot.innerHTML = mPdfBlock('doc-pdf', pdfId||'');
}
// Supprime un blob de pdfStore + persiste (évite les orphelins de quota).
function _purgePdfBlob(pdfId){
  if(pdfId && window.pdfStore && window.pdfStore[pdfId]){
    delete window.pdfStore[pdfId];
    if(typeof savePdfStore==='function') savePdfStore();
  }
}

function _docFmtExpiry(ym){
  var m=/^(\d{4})-(\d{2})$/.exec(ym||''); if(!m) return ym||'';
  return m[2]+'/'+m[1];
}
function _docSpaced(n){ return String(n||'').replace(/\s+/g,'').replace(/(.{4})/g,'$1 ').trim(); }
function _docValidity(d){
  if(!d || !d.expiry) return { state:'none' };
  var m=/^(\d{4})-(\d{2})$/.exec(d.expiry); if(!m) return { state:'none' };
  var end=new Date(+m[1], +m[2], 0); end.setHours(23,59,59,999);
  var now=new Date(); now.setHours(0,0,0,0);
  var days=Math.round((end-now)/86400000);
  if(days < 0)  return { state:'expired', days:days };
  if(days <= 60) return { state:'warn', days:days };
  return { state:'valid', days:days };
}
function _docBadge(v){
  if(!v || v.state==='none') return '';
  if(v.state==='valid')   return '<span class="doc-badge doc-badge-valid"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" width="11" height="11"><polyline points="20 6 9 17 4 12"/></svg> Valide</span>';
  if(v.state==='warn')    return '<span class="doc-badge doc-badge-warn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg> '+v.days+'j</span>';
  return '<span class="doc-badge doc-badge-exp">Expiré</span>';
}

function setDocView(v, btn){
  _docView = (v==='cat') ? 'cat' : 'liste';
  document.querySelectorAll('#doc-view-switch .lgs-btn').forEach(function(b){
    b.classList.toggle('active', b.getAttribute('data-docview')===_docView);
  });
  renderDocuments();
}

function renderDocuments(){
  var host=document.getElementById('doc-render');
  if(!host) return;
  // Le formulaire d'ajout reste fermé tant qu'on n'appuie pas sur « Ajouter »
  var _f=document.getElementById('form-doc'); if(_f) _f.classList.remove('open');
  document.querySelectorAll('#doc-view-switch .lgs-btn').forEach(function(b){
    b.classList.toggle('active', b.getAttribute('data-docview')===_docView);
  });
  host.innerHTML = (_docView==='cat') ? _renderDocCats() : _renderDocList();
}

function _docSecure(foot){
  return '<div class="doc-secure'+(foot?' doc-secure-foot':'')+'">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" width="16" height="16"><path d="M12 3l7 3v6c0 4.2-3 7.4-7 9-4-1.6-7-4.8-7-9V6z"/><path d="M9.5 12l1.8 1.8L15 10"/></svg>'
    + '<span>Chiffrés et stockés sur votre appareil.'+(foot?'':' Jamais partagés sans votre accord.')+'</span></div>';
}

function _docRow(d){
  var v=_docValidity(d), sub=[];
  if(d.number) sub.push('N° '+_docEsc(d.number));
  if(d.expiry) sub.push('exp. '+_docFmtExpiry(d.expiry));
  var perso=!!d.__personal;
  var g=_docGroupKey(d), c=_docColor(g);
  var pid=_docPdfId(d);
  var pdfPill = pid ? '<button type="button" class="doc-row-pdf" data-act="openPdf" data-id="'+pid+'" title="Voir la pi\u00e8ce jointe"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>' : '';
  return '<div class="doc-row'+(perso?' doc-row-perso':'')+'" data-act="'+(perso?'openGlobalDocModal':'editDoc')+'" data-id="'+d.id+'">'
    + '<span class="doc-row-ico" data-cat="'+g+'" style="background:'+c+'1e;color:'+c+'">'+_docIcon(d.cat)+'</span>'
    + '<div class="doc-row-body"><div class="doc-row-name">'+_docEsc(d.name||'Document')
      + (perso?' <span class="doc-perso-badge">Personnel</span>':'')+'</div>'
    + (sub.length?'<div class="doc-row-sub">'+sub.join(' \u00b7 ')+'</div>':'')+'</div>'
    + pdfPill + _docBadge(v) + '</div>';
}
// Documents du voyage + documents personnels (transverses), ces derniers marqués __personal.
function _allDocs(){
  var arr=(typeof documents!=='undefined'&&documents?documents.slice():[]);
  var g=(typeof getGlobalDocs==='function')?getGlobalDocs():[];
  g.forEach(function(x){
    arr.push({ id:x.id, name:x.name, cat:x.cat, number:x.number, expiry:x.expiry, pdfId:x.pdfId, __personal:true });
  });
  return arr;
}

function _renderDocList(){
  var html = _docSecure(false);
  html += '<button class="doc-add-big" onclick="openDocAdd()">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" width="18" height="18"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/></svg>'
    + ' Ajouter un document</button>';
  var all=_allDocs();
  if(!all.length){
    html += '<div class="doc-empty">Aucun document pour l\'instant.</div>';
    return html;
  }
  var groups={}, present=[];
  all.forEach(function(d){ var k=_docGroupKey(d); if(!groups[k]){groups[k]=[];present.push(k);} groups[k].push(d); });
  DOC_GROUP_ORDER.forEach(function(k){
    if(!groups[k]) return;
    var arr=groups[k];
    html += '<div class="doc-group-title">'+(DOC_GROUP[k]?DOC_GROUP[k].label:k).toUpperCase()+' \u00b7 '+arr.length+'</div>';
    html += '<div class="doc-section">';
    arr.forEach(function(d){ html += _docRow(d); });
    html += '</div>';
  });
  return html;
}

function _renderDocCats(){
  var html='';
  var all=_allDocs();
  // Carte vedette : 1er passeport, sinon 1re pièce d'identité
  var hero=null, i;
  for(i=0;i<all.length;i++){ if(all[i].cat==='passeport'){ hero=all[i]; break; } }
  if(!hero){ for(i=0;i<all.length;i++){ if(_docGroupKey(all[i])==='identite'){ hero=all[i]; break; } } }
  if(hero){
    var hv=_docValidity(hero);
    html += '<div class="doc-hero" data-act="'+(hero.__personal?'openGlobalDocModal':'editDoc')+'" data-id="'+hero.id+'">'
      + '<span class="doc-hero-ico">'+_docIcon(hero.cat)+'</span>'
      + '<div class="doc-hero-kicker">'+_docEsc((DOC_CAT[hero.cat]?DOC_CAT[hero.cat].label:'Document')).toUpperCase()+'</div>'
      + '<div class="doc-hero-name">'+_docEsc(hero.name||'Document')+'</div>'
      + '<div class="doc-hero-foot">'
        + '<span class="doc-hero-num">'+(hero.number?_docEsc(_docSpaced(hero.number)):'')+'</span>'
        + (hero.expiry?'<span class="doc-hero-exp">Expire '+_docFmtExpiry(hero.expiry)+'</span>':'')
        + _docBadge(hv)
      + '</div></div>';
  }
  // Alerte expiration la plus urgente (expiré ou < 60 j)
  var urgent=null;
  all.forEach(function(d){
    var v=_docValidity(d);
    if(v.state==='warn' || v.state==='expired'){
      if(!urgent || v.days < urgent.v.days){ urgent={ d:d, v:v }; }
    }
  });
  if(urgent){
    var ud=urgent.d, uv=urgent.v;
    var msg = uv.state==='expired'
      ? (_docEsc(ud.name||'Un document')+' a expiré')
      : (_docEsc(ud.name||'Un document')+' expire dans '+uv.days+' jours');
    html += '<div class="doc-alert" onclick="setDocView(\'liste\')">'
      + '<span class="doc-alert-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/></svg></span>'
      + '<div class="doc-alert-body"><div class="doc-alert-title">'+msg+'</div>'
      + '<div class="doc-alert-sub">Pense à le renouveler avant le départ</div></div>'
      + '<span class="doc-alert-chev">\u203a</span></div>';
  }
  // Grille catégories
  var counts={};
  all.forEach(function(d){ var k=_docGroupKey(d); counts[k]=(counts[k]||0)+1; });
  html += '<div class="doc-cats-title">Catégories</div>';
  html += '<div class="doc-tiles">';
  DOC_GROUP_ORDER.forEach(function(k){
    var n=counts[k]||0; if(!n) return;
    var _tc=_docColor(k);
    html += '<div class="doc-tile" onclick="openDocCategory(\''+k+'\')">'
      + '<span class="doc-tile-ico" data-cat="'+k+'" style="background:'+_tc+'1e;color:'+_tc+'">'+_docIcon(k)+'</span>'
      + '<div class="doc-tile-name">'+(DOC_GROUP[k]?DOC_GROUP[k].label:k)+'</div>'
      + '<div class="doc-tile-count">'+n+' doc'+(n>1?'s':'')+'</div></div>';
  });
  html += '<div class="doc-tile doc-tile-add" onclick="openDocAdd()">'
    + '<span class="doc-tile-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></span>'
    + '<div class="doc-tile-name">Ajouter</div></div>';
  html += '</div>';
  html += _docSecure(true);
  return html;
}

function _resetDocForm(){
  _docSet('doc-name',''); _docSet('doc-cat','passeport'); _docSet('doc-number','');
  _docSet('doc-expiry',''); _docSet('doc-edit-id','');
  var del=document.getElementById('doc-del-btn'); if(del) del.style.display='none';
  _docFillPdfSlot('');   // bloc pièce jointe vide
}

// Catégorie représentative d'un groupe (pour pré-remplir depuis une tuile).
// Ex. groupe 'assurance' → cat 'assurance' ; groupe 'identite' → 'passeport'.
function _docDefaultCatForGroup(g){
  for(var k in DOC_CAT){ if(DOC_CAT.hasOwnProperty(k) && DOC_CAT[k].group===g) return k; }
  return 'autre';
}
// cat optionnel : pré-remplit la catégorie (ajout depuis une tuile de catégorie).
function openDocAdd(cat){
  _resetDocForm();
  if(cat){ _docSet('doc-cat', cat); }
  if(typeof openAddTop==='function') openAddTop('form-doc');
}

function editDoc(id){
  var d=null; for(var i=0;i<documents.length;i++){ if(documents[i].id===id){ d=documents[i]; break; } }
  if(!d) return;
  _docSet('doc-name',d.name); _docSet('doc-cat',d.cat||'autre'); _docSet('doc-number',d.number||'');
  _docSet('doc-expiry',d.expiry||''); _docSet('doc-edit-id',d.id);
  var del=document.getElementById('doc-del-btn'); if(del) del.style.display='';
  _docFillPdfSlot(_docPdfId(d));   // pièce jointe ouvrable/remplaçable/supprimable
  if(typeof openAddTop==='function') openAddTop('form-doc');
}

function saveDoc(){
  var name=_docVal('doc-name').trim();
  if(!name){ alert('Donne un nom au document.'); return; }
  var editId=_docVal('doc-edit-id');
  var rec={
    id: editId || ('doc_'+Date.now()+'_'+Math.floor(Math.random()*1000)),
    name: name,
    cat: _docVal('doc-cat')||'autre',
    number: _docVal('doc-number').trim(),
    expiry: _docVal('doc-expiry'),
    pdfId: _docVal('doc-pdf')
  };
  if(typeof documents==='undefined' || !documents) documents=[];
  if(editId){
    var idx=documents.findIndex(function(x){ return x.id===editId; });
    // Ré-attache : purge l'ancien blob si le pointeur a changé (évite les
    // orphelins dans pdfStore). Fait au SAVE (pas à la sélection) → « remplacer
    // puis annuler » ne casse pas la pièce existante.
    var prevPid = (idx!==-1) ? _docPdfId(documents[idx]) : '';
    if(prevPid && prevPid!==rec.pdfId) _purgePdfBlob(prevPid);
    if(idx!==-1) documents[idx]=rec; else documents.push(rec);
  } else {
    documents.push(rec);
  }
  try { if(typeof snapshotCurrentTrip==='function') snapshotCurrentTrip(); } catch(e){}
  _resetDocForm();
  try { if(typeof toggleForm==='function') toggleForm('form-doc'); } catch(e){}
  if(!editId){ _docView='liste'; }            // montrer le document ajouté
  try { renderDocuments(); } catch(e){}
  if(typeof showToast==='function') showToast(editId?'Document mis à jour':'Document ajouté','success');
}

function deleteDoc(){
  var id=_docVal('doc-edit-id'); if(!id) return;
  if(!confirm('Supprimer ce document ?')) return;
  // Purge le blob associé (aligné sur deletePass/deleteHotel) — plus d'orphelin.
  var d=null; for(var i=0;i<documents.length;i++){ if(documents[i].id===id){ d=documents[i]; break; } }
  _purgePdfBlob(_docPdfId(d));
  documents = documents.filter(function(x){ return x.id!==id; });
  if(typeof snapshotCurrentTrip==='function') snapshotCurrentTrip();
  _resetDocForm();
  if(typeof toggleForm==='function') toggleForm('form-doc');
  renderDocuments();
}

// ══════════════════════════════════════════════════════════════════════
//  DOCUMENTS PERSONNELS (globalDocs) — transverses à tous les voyages.
//  Stockés en localStorage (yume_global_docs), HORS silo voyage : aucune
//  fuite entre voyages, pas de snapshot/restore. Métadonnées seules (pas
//  de PDF en v1 : pdfStore est par-voyage, un PDF global nécessiterait un
//  store dédié — chantier de suivi).
// ══════════════════════════════════════════════════════════════════════
function _loadGlobalDocs(){
  try{ var raw=localStorage.getItem('yume_global_docs'); return raw?JSON.parse(raw):[]; }
  catch(e){ return []; }
}
function _saveGlobalDocs(arr){
  try{ localStorage.setItem('yume_global_docs', JSON.stringify(arr||[])); }catch(e){}
}
// Exposé pour le futur affichage en lecture seule dans les voyages
window.getGlobalDocs = _loadGlobalDocs;

function renderGlobalDocs(){
  var host=document.getElementById('global-docs-list');
  var docs=_loadGlobalDocs();
  var cnt=document.getElementById('gdoc-count'); if(cnt) cnt.textContent=docs.length;
  if(!host) return;
  if(!docs.length){
    host.innerHTML='<div class="gdoc-empty">Aucun document personnel pour l\'instant. Ajoute ta carte d\'identité, ton passeport… ils resteront disponibles dans tous tes voyages.</div>';
    return;
  }
  host.innerHTML=docs.map(function(d){
    var badge=_docBadge(_docValidity(d));
    var hasPdf=d.pdfId && window.globalPdfStore && window.globalPdfStore[d.pdfId];
    var sub=(DOC_CAT[d.cat]?DOC_CAT[d.cat].label:'Document')+(d.number?' \u00b7 '+d.number:'');
    var gc=_docColor(_docGroupKey(d));
    return '<div class="gdoc-row" data-act="openGlobalDocModal" data-id="'+d.id+'">'
      +'<span class="gdoc-ico" data-cat="'+_docGroupKey(d)+'" style="background:'+gc+'1e;color:'+gc+'">'+_docIcon(d.cat)+'</span>'
      +'<div class="gdoc-body">'
        +'<div class="gdoc-name">'+_docEsc(d.name)+'</div>'
        +'<div class="gdoc-sub">'+_docEsc(sub)+'</div>'
      +'</div>'
      +(hasPdf?'<span class="gdoc-clip" title="Fichier joint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14"><path d="M21 12.5 12.5 21a4 4 0 0 1-6-6l8-8a2.5 2.5 0 0 1 4 4l-8 8a1 1 0 0 1-1.5-1.5L16 11"/></svg></span>':'')
      +(badge?'<span class="gdoc-badge-wrap">'+badge+'</span>':'')
      +'<svg class="gdoc-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg>'
    +'</div>';
  }).join('');
}

function openGlobalDocModal(id){
  var docs=_loadGlobalDocs();
  var d = id ? docs.filter(function(x){ return x.id==id; })[0] : null;
  var selStyle='flex:1;min-width:0;padding:9px 12px;font-size:13px;font-family:DM Sans,sans-serif;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface-2);color:var(--ink);outline:none';
  var catOpts=Object.keys(DOC_CAT).map(function(k){
    return '<option value="'+k+'"'+((d&&d.cat===k)?' selected':'')+'>'+_docEsc(DOC_CAT[k].label)+'</option>';
  }).join('');
  var existingPdf='';
  if(d && d.pdfId && window.globalPdfStore && window.globalPdfStore[d.pdfId]){
    var _pn=_docEsc(window.globalPdfStore[d.pdfId].name||'Document');
    existingPdf='<button type="button" class="pdf-view-btn" onclick="openPdf(\''+d.pdfId+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> '+_pn+'</button>'
      +'<button type="button" class="pdf-del-btn" onclick="_gdocPdfRemove()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>';
  }
  var html='<div class="tld">'
    +'<div class="tld-head"><span class="tld-dot" style="background:var(--sakura)"></span>'
      +'<div class="tld-head-txt"><div class="tld-type">Document personnel</div>'
      +'<div class="tld-title">'+(d?_docEsc(d.name):'Nouveau document')+'</div></div></div>'
    +'<div class="modal-form">'
      + modalField('Nom', mInput('gdoc-name', d?d.name:'', 'ex : Passeport, Carte d\'identit\u00e9'))
      + modalField('Cat\u00e9gorie', '<select id="gdoc-cat" style="'+selStyle+'">'+catOpts+'</select>')
      + modalField('N\u00b0 / r\u00e9f\u00e9rence', mInput('gdoc-number', d?d.number:'', ''))
      + modalField('Expiration', '<input type="month" id="gdoc-expiry" value="'+(d?_docEsc(d.expiry||''):'')+'" style="'+selStyle+'"/>')
      + '<div class="modal-field w-full"><label>Fichier (PDF ou image)</label>'
        + '<div id="gdoc-pdf-badge" class="pdf-action-row" style="margin-bottom:6px">'+existingPdf+'</div>'
        + '<input type="hidden" id="gdoc-pdfid" value="'+(d&&d.pdfId?_docEsc(d.pdfId):'')+'"/>'
        + '<label class="pdf-btn">Choisir un fichier<input type="file" accept="image/*,.pdf,application/pdf" onchange="attachGlobalPdf(this)"/></label>'
      + '</div>'
    +'</div>'
    +'<div class="modal-footer">'
      +(d?'<button class="btn-danger" onclick="deleteGlobalDoc(\''+d.id+'\')">Supprimer</button>':'<span></span>')
      +'<div class="modal-actions">'
        +'<button class="btn-ghost" onclick="closeModal()">Annuler</button>'
        +'<button class="btn-primary" onclick="saveGlobalDoc('+(d?'\''+d.id+'\'':'null')+')">Enregistrer</button>'
      +'</div>'
    +'</div></div>';
  openModal(html);
}

function saveGlobalDoc(id){
  var name=(_docVal('gdoc-name')||'').trim();
  if(!name){ alert('Donne un nom au document.'); return; }
  var rec={
    id: id || ('g'+Date.now()),
    name: name,
    cat: _docVal('gdoc-cat')||'autre',
    number: (_docVal('gdoc-number')||'').trim(),
    expiry: _docVal('gdoc-expiry')||'',
    pdfId: _docVal('gdoc-pdfid')||''
  };
  var docs=_loadGlobalDocs();
  if(id){
    var i=docs.findIndex(function(x){ return x.id==id; });
    if(i>=0) docs[i]=rec; else docs.push(rec);
  } else { docs.push(rec); }
  _saveGlobalDocs(docs);
  closeModal();
  renderGlobalDocs();
  if(typeof renderDocuments==='function') renderDocuments();
}

function deleteGlobalDoc(id){
  if(!confirm('Supprimer ce document personnel ?')) return;
  var docs=_loadGlobalDocs();
  var d=docs.filter(function(x){ return x.id==id; })[0];
  if(d && d.pdfId && window.globalPdfStore && window.globalPdfStore[d.pdfId]){
    delete window.globalPdfStore[d.pdfId]; _saveGlobalPdfStore();
  }
  _saveGlobalDocs(docs.filter(function(x){ return x.id!=id; }));
  closeModal();
  renderGlobalDocs();
  if(typeof renderDocuments==='function') renderDocuments();
}

// ── Store PDF global pour les documents personnels (persistant, hors voyage) ──
window.globalPdfStore = (function(){
  try{ var r=localStorage.getItem('yume_global_pdfs'); return r?JSON.parse(r):{}; }
  catch(e){ return {}; }
})();
function _saveGlobalPdfStore(){
  try{ localStorage.setItem('yume_global_pdfs', JSON.stringify(window.globalPdfStore||{})); return true; }
  catch(e){ alert('Espace de stockage insuffisant pour enregistrer ce fichier. Essaie une image plus l\u00e9g\u00e8re (max ~3 Mo).'); return false; }
}
function attachGlobalPdf(fileInput){
  var file=fileInput.files[0]; if(!file) return;
  if(file.size > 3*1024*1024){ alert('Fichier trop lourd (max 3 Mo pour un document personnel).'); fileInput.value=''; return; }
  var reader=new FileReader();
  reader.onload=function(e){
    var id='gpdf_'+Date.now();
    window.globalPdfStore[id]={ name:file.name, data:e.target.result };
    if(!_saveGlobalPdfStore()){ delete window.globalPdfStore[id]; return; }
    var hid=document.getElementById('gdoc-pdfid'); if(hid) hid.value=id;
    _renderGdocPdfBadge(id);
  };
  reader.readAsDataURL(file);
}
function _renderGdocPdfBadge(pdfId){
  var b=document.getElementById('gdoc-pdf-badge'); if(!b) return;
  if(!pdfId || !window.globalPdfStore[pdfId]){ b.innerHTML=''; return; }
  var nm=_docEsc(window.globalPdfStore[pdfId].name||'Document');
  b.innerHTML='<button type="button" class="pdf-view-btn" onclick="openPdf(\''+pdfId+'\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> '+nm+'</button>'
    +'<button type="button" class="pdf-del-btn" onclick="_gdocPdfRemove()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>';
}
function _gdocPdfRemove(){
  var hid=document.getElementById('gdoc-pdfid'); if(hid) hid.value='';
  _renderGdocPdfBadge('');
}

// ── Lieux : icône + couleur par catégorie (chip et tag coordonnés) ──

// ── Couleur par catégorie de document (code couleur maquette) ──

// ── Profil : replier/déplier la liste des documents personnels ──
function toggleGlobalDocs(){
  var panel=document.getElementById('gdoc-panel');
  var btn=document.getElementById('gdoc-toggle');
  if(!panel||!btn) return;
  if(panel.hasAttribute('hidden')){ panel.removeAttribute('hidden'); btn.setAttribute('aria-expanded','true'); btn.classList.add('open'); }
  else { panel.setAttribute('hidden',''); btn.setAttribute('aria-expanded','false'); btn.classList.remove('open'); }
}

// ════════════════════════════════════════════════════════════════
//  BIBLIOTHÈQUE D'ICÔNES CENTRALE (style Lucide, trait fin)
//  Source unique pour : transport, locations, pass, lieux, documents,
//  pastilles timeline. Trait = currentColor (hérite de la puce).
// ════════════════════════════════════════════════════════════════
var LU = {
  // ── Transport ──
  'plane':'<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  'train-front':'<path d="M8 3.5V7a4 4 0 0 0 8 0V3.5"/><path d="M9 19a5 5 0 0 1-5-5v-3.5a8 8 0 0 1 16 0V14a5 5 0 0 1-5 5z"/><path d="m8 19-2 3"/><path d="m16 19 2 3"/><circle cx="9" cy="13.5" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="13.5" r="1" fill="currentColor" stroke="none"/>',
  'bus':'<rect x="3" y="5" width="18" height="12" rx="2.5"/><path d="M3 11h18"/><path d="M7 5V3M17 5V3"/><circle cx="7.5" cy="17" r="1.6"/><circle cx="16.5" cy="17" r="1.6"/>',
  'ship':'<path d="M12 10.2V14"/><path d="M12 2v3"/><path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/><path d="M19.4 20A11.6 11.6 0 0 0 21 14l-8.2-3.6a2 2 0 0 0-1.6 0L3 14a11.6 11.6 0 0 0 1.6 6"/><path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1s1.2 1 2.5 1c2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
  'car-front':'<path d="m21 8-2 2-1.5-3.7A2 2 0 0 0 15.65 5H8.35a2 2 0 0 0-1.9 1.3L5 10 3 8"/><rect x="3" y="10" width="18" height="8" rx="2"/><path d="M5 18v2M19 18v2"/><circle cx="7.5" cy="14" r="1" fill="currentColor" stroke="none"/><circle cx="16.5" cy="14" r="1" fill="currentColor" stroke="none"/>',
  'metro':'<path d="M2 22V12a10 10 0 1 1 20 0v10"/><path d="M15 6.8v1.4a3 3 0 0 1-6 0V6.8"/><path d="M10 19a4 4 0 0 1-4-4v-3a6 6 0 1 1 12 0v3a4 4 0 0 1-4 4Z"/><path d="m9 19-2 3"/><path d="m15 19 2 3"/><circle cx="10" cy="15" r=".9" fill="currentColor" stroke="none"/><circle cx="14" cy="15" r=".9" fill="currentColor" stroke="none"/>',
  'taxi':'<path d="m21 9-2 2-1.4-3.5A2 2 0 0 0 15.7 6H8.3a2 2 0 0 0-1.9 1.5L5 11 3 9"/><rect x="3" y="11" width="18" height="8" rx="2"/><path d="M5 19v2M19 19v2"/><rect x="9" y="2.5" width="6" height="3" rx=".6"/><circle cx="7.5" cy="15" r="1" fill="currentColor" stroke="none"/><circle cx="16.5" cy="15" r="1" fill="currentColor" stroke="none"/>',

  // ── Pass ──
  'ticket':'<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 11v2"/><path d="M13 17v2"/>',
  'credit-card':'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  'receipt':'<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
  'wallet':'<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',

  // ── Véhicules (location) ──
  'scooter':'<circle cx="5.5" cy="16.5" r="3"/><circle cx="18.5" cy="16.5" r="2.5"/><path d="M8.5 16.5h6l2.5-6"/><path d="M14 10.5h3.5"/><path d="M6 13l1.5-4H11l1.2 3.4"/>',
  'bike':'<circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>',
  'caravan':'<rect x="2" y="7" width="16" height="9" rx="2"/><rect x="4.5" y="9.5" width="4" height="3.5" rx=".6"/><path d="M11 16V9.5"/><path d="M18 16h2a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2h-2"/><circle cx="8" cy="17.5" r="1.8"/><path d="M2 16h4"/>',
  'sailboat':'<path d="M22 18H2a4 4 0 0 0 4 4h12a4 4 0 0 0 4-4Z"/><path d="M21 14 10 2 3 14h18Z"/><path d="M10 2v16"/>',
  'building-2':'<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/>',

  // ── Catégories de lieux ──
  'landmark':'<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
  'trees':'<path d="M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z"/><path d="M7 16v6"/><path d="M13 19v3"/><path d="M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5"/>',
  'footprints':'<path d="M4 16v-2.4C4 11.5 3 10.5 3 8c0-2.7 1.5-6 4.5-6C9.4 2 10 3.8 10 5.5c0 3.1-2 5.7-2 8.7V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.4c0-2.1 1-3.1 1-5.6 0-2.7-1.5-6-4.5-6C14.6 6 14 7.8 14 9.5c0 3.1 2 5.7 2 8.7V20a2 2 0 1 0 4 0Z"/><path d="M16 17h4"/><path d="M4 13h4"/>',
  'utensils':'<path d="M3 2v7c0 1.1.9 2 2 2s2-.9 2-2V2"/><path d="M5 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  'palette':'<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.3a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".9" fill="currentColor" stroke="none"/><circle cx="17.5" cy="10.5" r=".9" fill="currentColor" stroke="none"/><circle cx="6.5" cy="12.5" r=".9" fill="currentColor" stroke="none"/><circle cx="8.5" cy="7.5" r=".9" fill="currentColor" stroke="none"/>',
  'shopping-bag':'<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  'onsen':'<path d="M3 13h18"/><path d="M3.5 13a8.5 8.5 0 0 0 17 0"/><path d="M8.5 5c.7.8.7 1.6 0 2.4M12 4.5c.7.8.7 1.6 0 2.4M15.5 5c.7.8.7 1.6 0 2.4"/><circle cx="9.5" cy="15.5" r=".7" fill="currentColor" stroke="none"/><circle cx="14.5" cy="15.5" r=".7" fill="currentColor" stroke="none"/><path d="M10.3 17.5a2.4 2.4 0 0 0 3.4 0"/>',
  'castle':'<path d="M22 20v-9H2v9a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1Z"/><path d="M18 11V4H6v7"/><path d="M15 22v-4a3 3 0 0 0-6 0v4"/><path d="M22 11V9M2 11V9M6 4V2M10 4V2M14 4V2M18 4V2"/>',
  'umbrella':'<path d="M22 12a10 10 0 0 0-20 0Z"/><path d="M12 12v8a2 2 0 0 0 4 0"/><path d="M12 2v1"/>',
  'binoculars':'<path d="M10 10h4"/><path d="M9 7V4a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v3"/><path d="M19 7V4a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v3"/><path d="M9.5 7h5v8.5a2.5 2.5 0 0 1-5 0Z"/><path d="M9.5 11h-3A2.5 2.5 0 0 0 4 13.5v2a2.5 2.5 0 0 0 5 0"/><path d="M14.5 11h3a2.5 2.5 0 0 1 2.5 2.5v2a2.5 2.5 0 0 1-5 0"/>',
  'store':'<path d="m3 7 3-4h12l3 4"/><path d="M4 7v13a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V7"/><path d="M3 7h18"/><path d="M9 21v-6h6v6"/>',
  'image':'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',

  // ── Documents ──
  'book-user':'<path d="M15 13a3 3 0 1 0-6 0"/><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/><circle cx="12" cy="8" r="2"/>',
  'id-card':'<path d="M16 10h2M16 14h2"/><path d="M6.2 15a3 3 0 0 1 5.6 0"/><circle cx="9" cy="11" r="2"/><rect x="2" y="5" width="20" height="14" rx="2"/>',
  'stamp':'<path d="M5 22h14"/><path d="M19.3 13.7A2.5 2.5 0 0 0 17.5 13h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5c0-.7-.3-1.3-.7-1.8Z"/><path d="M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-6 0c0 2 1 2 1 3.5V13"/>',
  'shield':'<path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.7 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.5 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1Z"/>',
  'heart-pulse':'<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/><path d="M3.2 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.3"/>',
  'file-text':'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8M16 13H8M16 17H8"/>',

  // ── Timeline divers ──
  'bed':'<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>',
  'map-pin':'<path d="M20 10c0 4.4-5.4 9-8 11-2.6-2-8-6.6-8-11a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  'log-in':'<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>',
  'log-out':'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'
};

// Helper : renvoie un <svg> trait complet pour une icône nommée
function _lu(n, s, w){
  var p = LU[n] || LU['file-text'];
  s = s || 19; w = w || 1.7;
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="'+w+'" stroke-linecap="round" stroke-linejoin="round" width="'+s+'" height="'+s+'">'+p+'</svg>';
}

// ── Recâblage : transport ──
MOB_ICONS = {
  vol:_lu('plane'), train:_lu('train-front'), bus:_lu('bus'), bateau:_lu('ship'),
  covoiturage:_lu('car-front'), metro:_lu('metro'), taxi:_lu('taxi'), pass:_lu('ticket')
};
MOB_COLORS = {
  vol:'#c2607f', train:'#4264d0', bus:'#2d8c6b', bateau:'#2d8c8c',
  covoiturage:'#7c5cbf', metro:'#4f5bd5', taxi:'#c9921a', pass:'#c9a227'
};

// ── Recâblage : locations (véhicules) ──
LOC_ICONS = {
  voiture:_lu('car-front'), scooter:_lu('scooter'), velo:_lu('bike'),
  camping:_lu('caravan'), bateau:_lu('sailboat'), loueur:_lu('building-2')
};
var LOC_COLORS = {
  voiture:'#4264d0', scooter:'#4264d0', velo:'#4264d0',
  camping:'#4264d0', bateau:'#2d8c8c', loueur:'#7a8290'
};

// ── Recâblage : pass (catégories) ──
var PASS_ICONS = { rail:_lu('ticket'), urban:_lu('credit-card'), vignette:_lu('receipt'), autre:_lu('wallet') };
var PASS_COLORS = { rail:'#c9921a', urban:'#c9921a', vignette:'#c9921a', autre:'#c9921a' };

// ── Recâblage : documents (icône par catégorie + couleur par groupe) ──
var DOC_ICON = {
  passeport:'book-user', identite:'id-card', visa:'stamp',
  assurance:'shield', billets:'ticket', sante:'heart-pulse', autre:'file-text'
};
function _docIcon(cat){
  return _lu(DOC_ICON[cat] || 'file-text', 18);
}
function _docColor(g){
  var C={ identite:'#2a7fd4', visa:'#c08a1e', assurance:'#2e9c54', billets:'#d23a52', sante:'#7a52c4', autre:'#8a93a3' };
  return C[g] || '#8a93a3';
}

// ── Recâblage : catégories de lieux (icône + couleur coordonnées) ──
function _lieuCatMeta(cat){
  var M={
    'Temples':{c:'#cf4d6f',i:'landmark'},
    'Parcs':{c:'#2e9c54',i:'trees'},
    'Randonn\u00e9es':{c:'#2e9c54',i:'footprints'},
    'Restaurants':{c:'#c79a2e',i:'utensils'},
    'Mus\u00e9es':{c:'#8a52c4',i:'palette'},
    'Shopping':{c:'#d24a7a',i:'shopping-bag'},
    'Onsen':{c:'#169c93',i:'onsen'},
    'Ch\u00e2teaux':{c:'#c79a2e',i:'castle'},
    'Plages':{c:'#169c93',i:'umbrella'},
    'Points de vue':{c:'#2a7fd4',i:'binoculars'},
    'March\u00e9s':{c:'#2e9c54',i:'store'},
    'Galeries':{c:'#8a52c4',i:'image'}
  };
  var m=M[cat]||{c:'#8a93a3',i:'map-pin'};
  return { color:m.c, tint:m.c+'1e', svg:_lu(m.i, 19) };
}

// ── Modale d'une catégorie de documents : liste des docs du groupe,
//    chaque doc ouvre sa fiche/édition (voyage : editDoc ; perso : openGlobalDocModal). ──
function openDocCategory(g){
  var meta = (typeof DOC_GROUP!=='undefined' && DOC_GROUP[g]) || {label:g};
  var color = _docColor(g);
  var docs = _allDocs().filter(function(d){ return _docGroupKey(d)===g; });
  var rows = docs.map(function(d){
    var v=_docValidity(d), perso=!!d.__personal;
    var click = perso ? ("closeModal();openGlobalDocModal('"+d.id+"')") : ("closeModal();editDoc('"+d.id+"')");
    var sub=[]; if(d.number) sub.push('N\u00b0 '+_docEsc(d.number)); if(d.expiry) sub.push('exp. '+_docFmtExpiry(d.expiry));
    var pid=_docPdfId(d);
    var pdfPill = pid ? '<button type="button" class="doc-row-pdf" onclick="event.stopPropagation();openPdf(\''+pid+'\')" title="Voir la pi\u00e8ce jointe"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>' : '';
    return '<div class="doc-row'+(perso?' doc-row-perso':'')+'" onclick="'+click+'">'
      + '<span class="doc-row-ico" style="background:'+color+'1e;color:'+color+'">'+_docIcon(d.cat)+'</span>'
      + '<div class="doc-row-body"><div class="doc-row-name">'+_docEsc(d.name||'Document')
        + (perso?' <span class="doc-perso-badge">Personnel</span>':'')+'</div>'
        + (sub.length?'<div class="doc-row-sub">'+sub.join(' \u00b7 ')+'</div>':'')+'</div>'
      + pdfPill + _docBadge(v) + '</div>';
  }).join('');
  var html = '<div class="tld">'
    + '<div class="tld-head"><span class="tld-dot" style="background:'+color+'"></span>'
      + '<div class="tld-head-txt"><div class="tld-type">Cat\u00e9gorie</div><div class="tld-title">'+_docEsc(meta.label)+'</div></div></div>'
    + '<div class="doc-cat-list" style="display:flex;flex-direction:column;gap:8px;margin:6px 0 2px">'
      + (rows || '<div class="tld-empty">Aucun document dans cette cat\u00e9gorie.</div>')
    + '</div>'
    + '<div class="modal-footer"><button class="btn-ghost" onclick="closeModal()">Fermer</button>'
      + '<button class="btn-primary" onclick="closeModal();openDocAdd(\''+_docDefaultCatForGroup(g)+'\')">Ajouter</button></div>'
    + '</div>';
  openModal(html);
}
