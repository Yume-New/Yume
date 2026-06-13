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
    if(!Array.isArray(t.transactions))t.transactions= [];
    if(typeof t.budget !== 'number') t.budget = 0;
    if(typeof t.totalNuits !== 'number') t.totalNuits = 30;
    if(t.hotels) t.hotels.forEach(_migrateAddress);
    if(t.lieux)  t.lieux.forEach(_migrateAddress);
  });
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

  // 3. Checkbox escale
  var escChk=document.getElementById('mob-escale-check');
  if(escChk){ escChk.checked=false; escChk.dispatchEvent(new Event('change')); }

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
    // Si aucun voyage actif, montrer le placeholder
    if(!currentTripId){
      var ph = document.getElementById('voyage-placeholder');
      var vc = document.getElementById('voyage-content');
      if(ph) ph.style.display = '';
      if(vc) vc.style.display = 'none';
    }
    if(typeof updateStatsBar === 'function') updateStatsBar();
  } else if(pageId === 'futur'){
    // Page Carte du voyage
    if(typeof initTripMap === 'function') initTripMap();
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
var SECTION_ORDER = ['mobilite','locations','hotels','lieux','timeline','alertes','budget','convertir'];
// ── Lazy render : sections rendues uniquement au premier accès ──
var _sectionRendered = {};

function switchSection(id, btn){
  // Fermer tout formulaire modal ouvert avant de changer de section
  if(typeof _closeFormModal === 'function' && typeof _currentOpenForm !== 'undefined' && _currentOpenForm){
    _closeFormModal(_currentOpenForm, true);
  }
  _currentSection = id;

  // Update nav pills
  document.querySelectorAll('.vsn-item').forEach(function(b){
    b.classList.remove('active');
  });
  if(btn) btn.classList.add('active');
  else {
    var b2 = document.querySelector('.vsn-item[data-tab="'+id+'"]');
    if(b2) b2.classList.add('active');
  }
  // Repositionner le slider animé sous la section active
  if(typeof _moveSectionSlider === 'function') _moveSectionSlider();

  // Scroll the snap container using scrollLeft — avoids scrolling the body
  var container = document.getElementById('voyage-sections');
  var sec = document.getElementById('tab-' + id);
  if(container && sec){
    var idx2 = SECTION_ORDER.indexOf(id);
    var sectionWidth = container.clientWidth || window.innerWidth;
    container.scrollTo({left: idx2 * sectionWidth, behavior: 'smooth'});
  }

  // Keep legacy .section.active for render callbacks
  document.querySelectorAll('.section').forEach(function(s){ s.classList.remove('active'); });
  if(sec) sec.classList.add('active');

  // Section-specific callbacks — toujours render mobilite et locations (données dynamiques)
  if(id === 'mobilite' && typeof renderMobilite === 'function'){ renderMobilite(); }
  if(id === 'locations' && typeof renderLocations === 'function'){ renderLocations(); }

  // Lazy render pour les sections moins fréquentées
  if(!_sectionRendered[id]){
    _sectionRendered[id] = true;
    if(id === 'hotels' && typeof renderHotels === 'function'){ renderHotels(); }
    if(id === 'lieux'  && typeof renderLieux   === 'function'){ renderLieux(); }
  } else {
    // Déjà rendu mais on force quand même pour lieux (toggle visité en temps réel)
    if(id === 'lieux'  && typeof renderLieux   === 'function'){ renderLieux(); }
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
    ? ['mobilite','locations','hotels','lieux','timeline','alertes','budget']
    : ['mobilite','locations','hotels','lieux','timeline','alertes','budget','convertir'];

  // Si la section active est 'convertir' et qu'on passe en France, revenir à 'budget'
  if(isFrance && (_currentSection === 'convertir')){
    switchSection('budget', document.querySelector('.vsn-item[data-tab="budget"]'));
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
          // Sync nav pills without scrolling
          document.querySelectorAll('.vsn-item').forEach(function(b){
            b.classList.toggle('active', b.getAttribute('data-tab') === id);
          });
          // Update active section class
          document.querySelectorAll('.section').forEach(function(s){
            s.classList.toggle('active', s === entry.target);
          });
          // Section callbacks — respecte le lazy render
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
          } else if(id === 'lieux' && typeof renderLieux === 'function'){
            renderLieux(); // toujours re-rendre pour toggle visité
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
function onBgBrightnessFromProfil(val){
  var v = val / 100;
  _state.brightness = v;
  localStorage.setItem('yume_bg_brightness', v);
  onBgBrightnessInput(val); // use existing function
}
function onBgBlurFromProfil(val){
  var v = parseFloat(val);
  _state.blur = v;
  localStorage.setItem('yume_bg_blur', v);
  onBgBlurInput(val);
}



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
  });
  // Position initiale : après calcul du layout (fonts/CSS chargés)
  window.addEventListener('load', function(){
    setTimeout(function(){
      if(typeof _moveTabSlider === 'function') _moveTabSlider();
      if(typeof _moveSectionSlider === 'function') _moveSectionSlider();
    }, 80);
  });
}

// Slider animé sous la section active (Transports/Locations/…)
function _moveSectionSlider(){
  var slider = document.getElementById('vsn-slider');
  var active = document.querySelector('.vsn-item.active');
  var bar    = document.getElementById('voyage-section-nav');
  if(!slider || !active || !bar) return;
  var aRect = active.getBoundingClientRect();
  var bRect = bar.getBoundingClientRect();
  var left  = aRect.left - bRect.left;
  slider.style.width     = aRect.width + 'px';
  slider.style.transform = 'translateX(' + left + 'px)';
  slider.style.opacity   = '1';
}

// ══════════════════════════════════════════════════════
// PROFIL — chargement et sauvegarde
// ══════════════════════════════════════════════════════
function loadProfilPage(){
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
    voyageContent.setAttribute('style', 'display:flex;flex-direction:column');
  }
  // Update progress bar
  if(typeof updateVoyageProgressBar === 'function') updateVoyageProgressBar();
  // Reset section to vols
  switchSection('mobilite', document.querySelector('.vsn-item[data-tab="mobilite"]'));
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
// LONG-PRESS + MODE ÉDITION sur les cartes
// ══════════════════════════════════════════════════════════
var _editingCard   = null; // tid currently in edit mode
var _lpTimer       = null; // long-press timer

function _startLongPress(tid){
  _lpTimer = setTimeout(function(){
    _lpTimer = null;
    enterEditMode(tid);
  }, 800);
}
function _cancelLongPress(){
  if(_lpTimer){ clearTimeout(_lpTimer); _lpTimer = null; }
}

function enterEditMode(tid){
  // Close any open edit card first
  if(_editingCard && _editingCard !== tid) exitEditMode();

  _editingCard = tid;
  var card = document.getElementById('voy-edit-card-' + tid);
  if(card){
    card.classList.add('editing');
    // Activate backdrop
    var bd = document.getElementById('edit-mode-backdrop');
    if(bd){ bd.classList.add('active'); bd.onclick = exitEditMode; }
    // Haptic feedback if available
    if(navigator.vibrate) navigator.vibrate(40);
  }
}

function exitEditMode(){
  if(!_editingCard) return;
  var card = document.getElementById('voy-edit-card-' + _editingCard);
  if(card) card.classList.remove('editing');
  _editingCard = null;
  var bd = document.getElementById('edit-mode-backdrop');
  if(bd){ bd.classList.remove('active'); bd.onclick = null; }
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
  if(typeof buildDropdownMenu      === 'function') buildDropdownMenu();
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
  exitEditMode();
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

  var kicker='', sub='', pct=-1;
  if(bestState === 'ongoing'){
    var total = Math.max(1, Math.round((ret - dep)/DAY));
    var jour  = Math.min(total, Math.round((now - dep)/DAY) + 1);
    kicker = 'Voyage en cours';
    sub    = 'Jour ' + jour + ' / ' + total;
    pct    = Math.max(0, Math.min(100, Math.round((now - dep)/(ret - dep)*100)));
  } else if(bestState === 'upcoming'){
    var j = Math.round((dep - now)/DAY);
    kicker = 'Prochain départ';
    sub    = j === 0 ? "C'est aujourd'hui !" : 'Départ dans ' + j + ' jour' + (j>1?'s':'');
  } else if(bestState === 'past'){
    kicker = 'Dernier voyage';
    sub    = 'Terminé';
  } else {
    kicker = 'Voyage';
    sub    = 'Dates à définir';
  }

  var datesLine = (m.dateDep || '') + (m.dateRet ? ' → ' + m.dateRet : '');

  // Budget : dépensé (somme des transactions en €) vs budget défini
  var budgetLine = '';
  var spent = (trip.transactions || []).reduce(function(s2,t){
    return s2 + (parseFloat(t.amount) || 0);
  }, 0);
  if(trip.budget > 0){
    var rest = trip.budget - spent;
    budgetLine = Math.round(spent) + ' € dépensés · '
      + (rest >= 0 ? Math.round(rest) + ' € restants' : Math.round(-rest) + ' € de dépassement');
  } else if(spent > 0){
    budgetLine = Math.round(spent) + ' € dépensés';
  }

  el.innerHTML = ''
    + '<div class="hh-main">'
      + '<div class="hh-kicker">' + kicker + ' <span class="hh-sub">· ' + sub + '</span></div>'
      + '<div class="hh-name">'  + (m.name || 'Mon voyage') + '</div>'
      + '<div class="hh-meta">'  + datesLine
        + (m.pays ? ' · ' + m.pays : '')
        + (budgetLine ? ' · ' + budgetLine : '')
      + '</div>'
      + (pct >= 0 ? '<div class="hh-track"><div class="hh-fill" style="width:'+pct+'%"></div></div>' : '')
    + '</div>'
    + '<button class="hh-open" onclick="openTrip(\'' + best + '\')">'
      + 'Ouvrir'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
    + '</button>';
  el.style.display = '';
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
function renderHomeInspiration(){
  var el = document.getElementById('home-inspiration');
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

    // ── Données enrichies (Option 3, affichées en desktop via CSS) ──
    var _now = new Date(); _now.setHours(0,0,0,0);
    var _dep = parseDDMMYYYY(dateDep), _ret = parseDDMMYYYY(dateRet);
    var tState = 'nodate', tBadge = '', tBadgeCls = '';
    if(_dep && _ret && _now >= _dep && _now <= _ret){ tState='ongoing'; tBadge='En cours'; tBadgeCls='ongoing'; }
    else if(_dep && _dep > _now){ tState='upcoming'; tBadge='À venir'; tBadgeCls='upcoming'; }
    else if(_ret || _dep){ tState='past'; tBadge='Terminé'; tBadgeCls='past'; }

    var nbJours = (_dep && _ret) ? Math.max(1, Math.round((_ret-_dep)/86400000)+1) : null;
    var nbVilles = _tripCities(tid);
    var nbTrajets = _tripLegs(tid);
    var jCountdown = (tState==='upcoming' && _dep) ? Math.round((_dep-_now)/86400000) : null;

    var counters = [];
    if(nbJours)            counters.push('<div class="vc-kv"><b>'+nbJours+'</b> jours</div>');
    if(nbVilles)           counters.push('<div class="vc-kv"><b>'+nbVilles+'</b> villes</div>');
    if(nbTrajets)          counters.push('<div class="vc-kv"><b>'+nbTrajets+'</b> trajets</div>');
    if(jCountdown!==null && jCountdown>0) counters.push('<div class="vc-kv"><b>J-'+jCountdown+'</b> départ</div>');
    else if(t.budget>0)    counters.push('<div class="vc-kv"><b>'+Math.round(t.budget)+' €</b> budget</div>');

    // Dégradé de vignette dérivé du pays (stable, sans image requise)
    var _hash = 0; var _src = (country||m.name||'Y');
    for(var _i=0;_i<_src.length;_i++){ _hash = (_hash*31 + _src.charCodeAt(_i)) & 0xffff; }
    var _hue = _hash % 360;
    var thumbStyle = 'background:linear-gradient(135deg,hsl('+_hue+',42%,52%),hsl('+((_hue+40)%360)+',46%,38%));';

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
        '<div class="voy-thumb" style="'+thumbStyle+'">'
          + (tBadge ? '<span class="voy-thumb-badge vtb-'+tBadgeCls+'">'+tBadge+'</span>' : '')
        + '</div>'
      + '<div class="voy-col-name">'
          + '<span class="voy-col-name-text">'+(m.name||'Voyage')+'</span>'
          + '<span class="voy-col-name-country">'+subLabel+'</span>'
          + (counters.length ? '<div class="voy-counters">'+counters.join('')+'</div>' : '')
        + '</div>'
      + '<div class="voy-col-dates">'
          + '<span class="voy-col-dates-text">'+(dateLabel||'—')+'</span>'
        + '</div>'
      + '<div class="voy-col-status">'
          + statusHTML
        + '</div>';
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

  // Sync le menu déroulant des voyages
  if(typeof buildDropdownMenu === 'function') buildDropdownMenu();
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
  if(typeof buildDropdownMenu === 'function') buildDropdownMenu();
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

// Calcule la valeur HH:MM depuis H + D + U
function computeHMFromDU(idH, idD, idU){
  var hEl=document.getElementById(idH);
  var dEl=document.getElementById(idD);
  var uEl=document.getElementById(idU);
  if(!hEl||!dEl||!uEl) return '';
  var hv=hEl.value; var dv=dEl.value; var uv=uEl.value;
  if(hv===''||dv===''||uv==='') return '';
  var h=parseInt(hv,10);
  var m=parseInt(dv,10)*10+parseInt(uv,10);
  return (h<10?'0'+h:h)+'h'+(m<10?'0'+m:m);
}

// Parse valeur "12h46" → {h:12, d:4, u:6}
function parseHMtoDU(val){
  if(!val) return null;
  var mt=val.match(/^(\d{1,2})[h:](\d{2})$/);
  if(!mt) return null;
  var h=parseInt(mt[1],10);
  var m=parseInt(mt[2],10);
  return {h:h, d:Math.floor(m/10), u:m%10};
}

// Init un groupe H+D+U avec valeur optionnelle
function initHMGroup(idH, idD, idU, val){
  var hEl=document.getElementById(idH);
  var dEl=document.getElementById(idD);
  var uEl=document.getElementById(idU);
  var parsed=val?parseHMtoDU(val):null;
  initHMSelect(hEl,'H', parsed?parsed.h:undefined);
  initHMSelect(dEl,'D', parsed?parsed.d:undefined);
  initHMSelect(uEl,'U', parsed?parsed.u:undefined);
}

// Sync hidden input à partir des selects HH/MM
function syncHMVal(idH, idM, hiddenId){
  var hEl=document.getElementById(idH);
  var mEl=document.getElementById(idM);
  if(!hEl||!mEl) return;
  var h=hEl.value; var m=mEl.value;
  var val=(h!==''&&m!=='')?((parseInt(h)<10?'0'+parseInt(h):h)+'h'+(parseInt(m)<10?'0'+parseInt(m):m)):'';
  if(hiddenId){
    var hid=document.getElementById(hiddenId);
    if(hid){ hid.value=val; hid.dispatchEvent(new Event('input',{bubbles:true})); }
  }
  return val;
}

// Init tous les selects HH au chargement
function initAllHMSelects(){
  // input[type=time] — nothing to initialise, browser handles it natively
}

function syncHMVol(){
  // vol-dep-heure and vol-arr-heure ARE now the time inputs directly
  autoCalcDureeVol();
}

function syncHMTrain(){
  var dh = (document.getElementById('tr-dep')||{}).value || '';
  var ah = (document.getElementById('tr-arr')||{}).value || '';
  var dEl   = document.getElementById('tr-duree');
  var dDisp = document.getElementById('tr-duree-display');
  if(dh && ah){
    var dm = parseHM(dh), am = parseHM(ah);
    if(dm !== null && am !== null){
      var diff = am - dm; if(diff <= 0) diff += 1440;
      var dur = formatMinutes(diff);
      if(dEl)   dEl.value       = dur;
      if(dDisp) dDisp.textContent = dur;
      return;
    }
  }
  if(dEl)   dEl.value       = '';
  if(dDisp) dDisp.textContent = '—';
}

function syncEscaleDuree(idx){
  var hEl=document.getElementById('esc-h-'+idx);
  var dEl=document.getElementById('esc-d-'+idx);
  var uEl=document.getElementById('esc-u-'+idx);
  if(!hEl||!dEl||!uEl) return;
  var hv=parseInt(hEl.value)||0;
  var dv=parseInt(dEl.value)||0;
  var uv=parseInt(uEl.value)||0;
  var mv=dv*10+uv;
  if(escalesData[idx]){
    escalesData[idx].dureeH=hv;
    escalesData[idx].dureeM=mv;
    escalesData[idx].duree=(hv>0||mv>0)?(hv+'h'+(mv<10?'0'+mv:mv)):'';
  }
}

// ── Autocomplete escale ville ──
function onEscaleVilleInput(idx, val){
  var box=document.getElementById('ac-escale-'+idx);
  if(!box) return;
  if(escalesData[idx]) escalesData[idx].aeroport=val;
  if(!val.trim()){ box.classList.remove('open'); return; }
  var q=val.trim().toLowerCase();
  var hits=Object.keys(CITY_DATA).filter(function(c){ return c.toLowerCase().indexOf(q)!==-1; }).slice(0,6);
  if(!hits.length){ box.classList.remove('open'); return; }
  box.innerHTML=hits.map(function(city){
    var d=CITY_DATA[city];
    return '<div class="ac-item" data-city="'+city.replace(/"/g,'&quot;')+'" data-idx="'+idx+'">'
      +'<span>'+city+'</span><span class="ac-sub">'+d.pays+' · '+d.iata+'</span>'
    +'</div>';
  }).join('');
  box.classList.add('open');
  box.querySelectorAll('.ac-item').forEach(function(item){
    item.addEventListener('click',function(){
      var city=this.getAttribute('data-city');
      var i=parseInt(this.getAttribute('data-idx'));
      if(escalesData[i]) escalesData[i].aeroport=city;
      var inp=this.closest('.ac-wrap').querySelector('input[type=text]');
      if(inp) inp.value=city;
      box.classList.remove('open');
    });
  });
}

// ════════════════════════════════════════════════════════════════════
// TRAINS : bouton unifié + autocomplete villes + calendrier voyage
// ════════════════════════════════════════════════════════════════════
function toggleTrainsEmode(){
  var btn=document.getElementById('bedit-trains');
  var wasOn=emodes&&(emodes.trains||emodes.passes);
  // Désactiver tous les modes
  ['trains','passes'].forEach(function(t){
    emodes[t]=false;
    document.body.classList.remove('emode-'+t);
  });
  var banner=document.getElementById('ebanner-trains');
  if(banner) banner.classList.remove('visible');
  if(btn) btn.classList.remove('active');
  if(!wasOn){
    emodes.trains=true; emodes.passes=true;
    document.body.classList.add('emode-trains');
    document.body.classList.add('emode-passes');
    if(banner) banner.classList.add('visible');
    if(btn) btn.classList.add('active');
  }
}

// Autocomplete trains villes
function onTrainVilleInput(side, val){
  var boxId='ac-tr-'+(side==='dep'?'dep':'arr');
  var box=document.getElementById(boxId);
  if(!box) return;
  if(!val.trim()){ box.classList.remove('open'); return; }
  var q=val.trim().toLowerCase();
  var hits=Object.keys(CITY_DATA).filter(function(c){ return c.toLowerCase().indexOf(q)!==-1; }).slice(0,6);
  if(!hits.length){ box.classList.remove('open'); return; }
  box.innerHTML=hits.map(function(city){
    var d=CITY_DATA[city];
    return '<div class="ac-item" data-city="'+city.replace(/"/g,'&quot;')+'" data-side="'+side+'">'
      +'<span>'+city+'</span><span class="ac-sub">'+d.pays+' · '+d.iata+'</span>'
    +'</div>';
  }).join('');
  box.classList.add('open');
  box.querySelectorAll('.ac-item').forEach(function(item){
    item.addEventListener('click',function(){
      var city=this.getAttribute('data-city');
      var s=this.getAttribute('data-side');
      var inpId=s==='dep'?'tr-dep-ville':'tr-arr-ville';
      var inp=document.getElementById(inpId);
      if(inp) inp.value=city;
      box.classList.remove('open');
      updateTrRoute();
    });
  });
}

function updateTrRoute(){
  var dep=document.getElementById('tr-dep-ville')?document.getElementById('tr-dep-ville').value.trim():'';
  var arr=document.getElementById('tr-arr-ville')?document.getElementById('tr-arr-ville').value.trim():'';
  var hid=document.getElementById('tr-route');
  if(hid) hid.value=(dep||'?')+' → '+(arr||'?');
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
function getTripStartMonth(){
  if(!currentTripId||!allTrips[currentTripId]) return null;
  var meta=allTrips[currentTripId].meta||{};
  if(meta.dateDep){
    var d=parseDDMMYYYY(meta.dateDep);
    if(d) return {month:d.getMonth(), year:d.getFullYear()};
  }
  return null;
}

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
// EXPORT PDF — Dossier de voyage imprimable
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
    pdfStore: window.pdfStore || {}
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
      // ── Migration : garantir la présence de tous les arrays dans les données importées ──
      Object.keys(allTrips).forEach(function(tid){
        var t = allTrips[tid];
        if(!Array.isArray(t.mobilites))    t.mobilites    = [];
        if(!Array.isArray(t.locations))    t.locations    = [];
        if(!Array.isArray(t.vols))         t.vols         = [];
        if(!Array.isArray(t.passes))       t.passes       = [];
        if(!Array.isArray(t.trains))       t.trains       = [];
        if(!Array.isArray(t.hotels))       t.hotels       = [];
        if(!Array.isArray(t.lieux))        t.lieux        = [];
        if(!Array.isArray(t.transactions)) t.transactions = [];
        // Migration adresses structurées (imports anciens)
        (t.hotels||[]).forEach(_migrateAddress);
        (t.lieux||[]).forEach(_migrateAddress);
      });
      if(data.pdfStore) window.pdfStore = data.pdfStore;
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
      buildDropdownMenu();
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
    if(k.startsWith('mv_') || k === 'yume_theme' || k === 'yume_profile_name' || k === 'yume_profile_avatar'){
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
  buildDropdownMenu();
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
  applyTheme(isDark ? 'nuit' : 'standard');
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
function getCatColor(catName, index){
  if(typeof catColors !== 'undefined' && catColors[catName]) return catColors[catName];
  return DONUT_COLORS[index % DONUT_COLORS.length];
}

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
    var color = getCatColor(e[0], i);   // ← couleur unifiée via catColors
    var pct = e[1] / total;
    var arc = pct * circumference;
    var seg = '<circle cx="'+cx+'" cy="'+cy+'" r="'+R+'"'
      +' fill="none" stroke="'+color+'"'
      +' stroke-width="'+stroke+'"'
      +' stroke-dasharray="'+arc.toFixed(2)+' '+(circumference-arc).toFixed(2)+'"'
      +' stroke-dashoffset="'+(-offset).toFixed(2)+'">'
      +'<title>'+e[0]+' — '+Math.round(pct*100)+'%</title>'
      +'</circle>';
    offset += arc;
    return {seg:seg, name:e[0], pct:Math.round(pct*100), color:color};
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
// MÉTÉO — OpenWeatherMap (clé optionnelle, fallback statique)
// ════════════════════════════════════════════════════════════════
var _weatherCache = {};
var OWM_KEY = ''; // Optionnel : saisir ici une clé OpenWeatherMap

var WEATHER_ICONS = {
  Clear:'Dégagé', Clouds:'Nuageux', Rain:'Pluie', Drizzle:'Bruine',
  Thunderstorm:'Orage', Snow:'Neige', Mist:'Brume', Fog:'Brouillard',
  Haze:'Brumeux', Dust:'Poussière', default:'—'
};

function refreshWeather(force){
  if(!currentTripId || !allTrips[currentTripId]) return;
  var meta = allTrips[currentTripId].meta || {};
  var city = meta.country || meta.destination || '';
  if(!city) return;

  // weather-chip-wrap removed from HTML

  // Cache 15min
  var now = Date.now();
  if(!force && _weatherCache[city] && (now - _weatherCache[city].ts) < 900000){
    _applyWeatherUI(_weatherCache[city]);
    return;
  }

  if(!OWM_KEY){
    // Météo supprimée — éléments HTML retirés
    return;
  }

  fetch('https://api.openweathermap.org/data/2.5/weather?q='
    +encodeURIComponent(city)+'&appid='+OWM_KEY+'&units=metric&lang=fr')
    .then(function(r){ return r.json(); })
    .then(function(d){
      if(d && d.main){
        var cond = d.weather[0].main;
        var data = {
          icon: WEATHER_ICONS[cond] || WEATHER_ICONS.default,
          temp: Math.round(d.main.temp),
          loc:  d.name.slice(0,12),
          ts:   now
        };
        _weatherCache[city] = data;
        _applyWeatherUI(data);
      }
    })
    .catch(function(){ /* silencieux */ });
}

function _applyWeatherUI(data){
  var ic = document.getElementById('wc-icon');
  var tp = document.getElementById('wc-temp');
  var lo = document.getElementById('wc-loc');
  if(ic) ic.textContent = data.icon;
  if(tp) tp.textContent = (data.temp != null ? data.temp+'°' : '—°');
  if(lo) lo.textContent = data.loc;
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
    refreshWeather(false);
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
function onBgVeilInput(){}
function onBgOpacityInput(){}

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
  var MODAL_FORMS = ['form-mobilite','form-location','form-hotel','form-lieu','form-vol','form-train'];

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
function readDate(jourId,moisId,heureId){
  var j=document.getElementById(jourId)?document.getElementById(jourId).value:'';
  var m=document.getElementById(moisId)?document.getElementById(moisId).value:'';
  var h=heureId&&document.getElementById(heureId)?document.getElementById(heureId).value:'';
  if(!j&&!m) return '';
  return (j||'—')+' '+(m||'—')+(h?' · '+h:'');
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
function parseHeure(str){
  if(!str) return '';
  var m=str.match(/·\s*(\d{1,2}h\d{0,2})/);
  return m?m[1]:'';
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
  ['vols','trains','hotels','lieux','mobilite','locations'].forEach(function(t){
    var b=document.getElementById('ebanner-'+t);
    if(b) b.classList.remove('visible');
  });
  if(!wasOn){
    emodes[type]=true;
    document.body.classList.add('emode-'+type);
    // 'mobilite' active aussi vols, trains, passes (même section Transports)
    if(type==='mobilite'){
      ['vols','trains','passes'].forEach(function(t){
        emodes[t]=true;
        document.body.classList.add('emode-'+t);
      });
    }
    var btn=document.getElementById('bedit-'+type);
    if(btn) btn.classList.add('active');
    // passes → banner affiché dans locations maintenant
    var bk=(type==='passes')?'locations':type;
    var banner=document.getElementById('ebanner-'+bk);
    if(banner) banner.classList.add('visible');
  }
}
function exitEmode(type){
  emodes[type]=false;
  document.body.classList.remove('emode-'+type);
  var btn=document.getElementById('bedit-'+type);
  if(btn) btn.classList.remove('active');
  var bk=(type==='passes')?'locations':type;
  var banner=document.getElementById('ebanner-'+bk);
  if(banner) banner.classList.remove('visible');
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
  var h=heureId?'<input type="text" id="'+heureId+'" value="'+(heureVal||'')+'" placeholder="hh:mm" style="max-width:80px;flex:none;padding:9px 10px;font-size:13px;font-family:DM Sans,sans-serif;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface-2);color:var(--ink);outline:none"/>':'';
  return '<div class="modal-field w-full"><label>'+label+'</label><div style="display:flex;gap:6px;flex-wrap:wrap">'+mJour(jourId,jourVal)+mMois(moisId,moisVal)+h+'</div></div>';
}
function modalFooter(saveFn,delFn){
  return '<div class="modal-footer">'
    +'<button class="btn-danger" onclick="'+delFn+'">Supprimer</button>'
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
function updateVolTitrePreview(){
  var depEl = document.getElementById('vol-dep-ville');
  var arrEl = document.getElementById('vol-arr-ville');
  var dep = depEl ? depEl.value.trim() : '';
  var arr = arrEl ? arrEl.value.trim() : '';
  var prev = document.getElementById('vol-titre-preview');
  var hid  = document.getElementById('vol-titre');
  if(dep || arr){
    var titre = (dep||'?')+' → '+(arr||'?');
    if(prev){ prev.textContent = titre; prev.classList.add('visible'); }
    if(hid) hid.value = titre;
  } else {
    if(prev){ prev.classList.remove('visible'); }
    if(hid) hid.value = '';
  }
  updateVolsSummary();
}

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

// ── Masque de saisie heure __h__ ──
var hmState = {}; // { targetId: { phase:'H'|'M', digits:'' } }

function startHeureMask(targetId){
  if(!hmState[targetId]) hmState[targetId] = {phase:'H', digits:''};
  var state = hmState[targetId];
  // Si déjà une valeur, parser
  var el = document.getElementById(targetId);
  if(el && el.value){
    var m = el.value.match(/^(\d{1,2})[h:](\d{2})$/);
    if(m){
      // Pré-charger les valeurs existantes pour permettre modification
      state.hVal = parseInt(m[1],10);
      state.phase='H'; state.digits='';
    }
  } else {
    state.phase='H'; state.digits='';
  }
  // Focus sur l'input caché
  var inp = document.querySelector('#hmw-'+targetId+' .heure-mask-input');
  if(inp) inp.focus();
  updateHeureMaskDisplay(targetId);
  var disp = document.getElementById('hmd-'+targetId);
  if(disp) disp.classList.add('active');
}

function clearHeureMask(targetId){
  hmState[targetId] = {phase:'H', digits:''};
  var el = document.getElementById(targetId);
  if(el){ el.value=''; el.dispatchEvent(new Event('input',{bubbles:true})); }
  updateHeureMaskDisplay(targetId);
  var wrap = document.getElementById('hmw-'+targetId);
  if(wrap) wrap.classList.remove('has-value');
}

function updateHeureMaskDisplay(targetId){
  var state = hmState[targetId] || {phase:'H', digits:''};
  var hEl = document.getElementById('hs-'+targetId+'-H');
  var mEl = document.getElementById('hs-'+targetId+'-M');
  var disp = document.getElementById('hmd-'+targetId);
  if(!hEl||!mEl) return;

  var el = document.getElementById(targetId);
  var curVal = el ? el.value : '';
  var hStr='--', mStr='--';
  if(curVal){
    var m = curVal.match(/^(\d{1,2})[h:](\d{2})$/);
    if(m){ hStr=(parseInt(m[1])<10?'0':'')+m[1]; mStr=m[2]; }
  }
  // En cours de saisie
  if(state.digits.length > 0){
    if(state.phase==='H'){
      hStr = (state.digits+'__').slice(0,2).replace(/_/g,'_');
      hEl.textContent = state.digits.padEnd(2,'_');
      mEl.textContent = mStr==='--' ? '--' : mStr;
    } else {
      mEl.textContent = state.digits.padEnd(2,'_');
      hEl.textContent = hStr==='--' ? '--' : hStr;
    }
  } else {
    hEl.textContent = hStr; mEl.textContent = mStr;
  }

  // Souligner le segment actif
  if(disp && disp.classList.contains('active')){
    hEl.classList.toggle('editing', state.phase==='H');
    mEl.classList.toggle('editing', state.phase==='M');
  }
}

// Gestionnaire de touches pour le masque
document.addEventListener('keydown', function(e){
  // Trouver quel targetId est actif (le parent .heure-mask-wrap a focus)
  var activeInp = document.querySelector('.heure-mask-input:focus');
  if(!activeInp) return;

  var wrap = activeInp.closest('.heure-mask-wrap');
  if(!wrap) return;
  var targetId = wrap.id.replace('hmw-','');
  if(!targetId) return;
  if(!hmState[targetId]) hmState[targetId] = {phase:'H', digits:''};
  var state = hmState[targetId];

  if(e.key === 'Escape' || e.key === 'Tab'){
    var disp = document.getElementById('hmd-'+targetId);
    if(disp) disp.classList.remove('active');
    state.digits='';
    return;
  }
  if(e.key === 'Backspace'){
    if(state.digits.length > 0){
      state.digits = state.digits.slice(0,-1);
    } else if(state.phase === 'M'){
      state.phase = 'H'; state.digits = '';
    } else {
      clearHeureMask(targetId);
    }
    updateHeureMaskDisplay(targetId);
    e.preventDefault(); return;
  }
  if(!/^\d$/.test(e.key)) return;
  e.preventDefault();

  var digit = e.key;
  state.digits += digit;

  if(state.phase === 'H'){
    // Après 2 chiffres, ou si premier chiffre > 2, valider les heures
    var h = parseInt(state.digits, 10);
    if(state.digits.length === 2 || (state.digits.length === 1 && h > 2)){
      // Valider : 0-23
      h = Math.min(h, 23);
      state.hVal = h;
      state.phase = 'M';
      state.digits = '';
    }
  } else {
    // Minutes : après 2 chiffres, valider
    if(state.digits.length === 2){
      var m2 = parseInt(state.digits, 10);
      m2 = Math.min(m2, 59);
      var hh = state.hVal !== undefined ? state.hVal : 0;
      var val = (hh<10?'0'+hh:hh)+':'+(m2<10?'0'+m2:m2);
      var el = document.getElementById(targetId);
      if(el){ el.value=val; el.dispatchEvent(new Event('input',{bubbles:true})); }
      // Feedback
      var wrap2 = document.getElementById('hmw-'+targetId);
      if(wrap2) wrap2.classList.add('has-value');
      var disp2 = document.getElementById('hmd-'+targetId);
      if(disp2) disp2.classList.remove('active');
      state.phase='H'; state.digits='';
      autoCalcDureeVol();
    }
  }
  updateHeureMaskDisplay(targetId);
});

// Blur = fin de saisie
document.addEventListener('focusout', function(e){
  if(!e.target.classList.contains('heure-mask-input')) return;
  var wrap = e.target.closest('.heure-mask-wrap');
  if(!wrap) return;
  var targetId = wrap.id.replace('hmw-','');
  var disp = document.getElementById('hmd-'+targetId);
  if(disp) disp.classList.remove('active');
  if(hmState[targetId]) hmState[targetId].digits='';
  updateHeureMaskDisplay(targetId);
});

// ── Calendrier vols : minDate ──

// ── Escales ──
var escalesData = []; // [{aeroport:'', duree:'', numero:''}]

function toggleEscalesSection(){
  var chk = document.getElementById('vol-escales-check');
  var sec = document.getElementById('escales-section');
  if(!chk||!sec) return;
  if(chk.checked){
    sec.classList.add('open');
    if(!escalesData.length) addEscaleField();
    renderEscalesFields();
  } else {
    sec.classList.remove('open');
    escalesData = [];
    renderEscalesFields();
  }
}

function addEscaleField(){
  escalesData.push({aeroport:'', duree:'', numero:''});
  renderEscalesFields();
}

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
        +'<div class="meta-item"><div class="lbl">Réservation</div><div class="val">'+(v.resa||'—')+'</div></div>'
        +'<div class="meta-item"><div class="lbl">Siège</div><div class="val">'+(v.siege||'—')+'</div></div>'
      +'</div>'
      +(v.escales&&v.escales.length
        ? '<div style="margin-top:8px;padding:8px 10px;background:var(--surface-2);border-radius:var(--r-sm);font-size:12px">'
          +'<span style="font-weight:600;color:var(--ink-muted);text-transform:uppercase;font-size:10px;letter-spacing:.06em">Escale'+(v.escales.length>1?'s':'')+'</span>'
          +v.escales.map(function(esc,i){
            return '<div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid var(--border)">'
              +'<span style="font-weight:600">'+esc.aeroport+'</span>'
              +(esc.duree?'<span style="color:var(--ink-muted)">⏱ '+esc.duree+'</span>':'')
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
      +'<button class="edit-item-btn" onclick="event.stopPropagation();editVol('+v.id+')"></button>'
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
      +'<button class="pdf-del-btn" onclick="editVolDeletePdf('+id+')">🗑 Supprimer</button>'
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
    +modalFooter('saveVol('+id+')','deleteVol('+id+')')
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
  if(evPdf && evPdf.value) v.pdfId = evPdf.value;
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
    el.innerHTML='<div class="empty-state"><div class="es-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28"><rect x="2" y="7" width="20" height="10" rx="2"/><path d="M2 12h20"/><circle cx="7" cy="12" r="1.5"/></svg></div><div class="es-title">Aucun pass enregistré</div><div class="es-sub">Ajoute ton JR Pass ou autre pass ferroviaire ci-dessous.</div></div>';
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
    return '<div class="pass-card item-wrap epass" style="position:relative">'
      +'<div class="pass-title">'+p.nom+' <span class="badge '+sc+'">'+p.statut+'</span></div>'
      +(validite?'<div class="pass-info">'+validite+(p.numero?' · N° '+p.numero:'')+(p.prix?' · '+p.prix+' €':'')+'</div>':'')
      +(p.numero&&!validite?'<div class="pass-info">N° '+p.numero+(p.prix?' · '+p.prix+' €':'')+'</div>':'')
      +(!validite&&!p.numero&&p.prix?'<div class="pass-info">'+p.prix+' €</div>':'')
      +(p.zone?'<div class="pass-info" style="color:var(--teal)">'+p.zone+'</div>':'')
      +(p.note?'<div class="pass-note">'+p.note+'</div>':'')
      +'<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">'+avt+'</div>'
      +pdfHtml
      +'<button class="edit-item-btn" onclick="event.stopPropagation();editPass('+p.id+')"></button>'
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
    +modalFooter('savePass('+id+')','deletePass('+id+')')
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
  if(epPdf&&epPdf.value) p.pdfId=epPdf.value;
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
        +'<div class="train-detail">'+(t.train?t.train+' · ':'')+(t.dep?'Départ '+t.dep:'')+(t.arr?' · Arrivée '+t.arr:'')+(t.duree?' · ⏱ '+t.duree:'')+'</div>'
        +(t.siege?'<div class="train-detail">Siège '+t.siege+(t.voiture?' · Voiture '+t.voiture:'')+'</div>':'')
      +'</div>'
      +'<span class="badge '+bc+'">'+t.statut+'</span>'
      +'<button class="edit-item-btn" onclick="event.stopPropagation();editTrain('+t.id+')" style="right:4px"></button>'
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
    +modalFooter('saveTrain('+id+')','deleteTrain('+id+')')
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
  var etPdf=document.getElementById('et-pdf'); if(etPdf&&etPdf.value) t.pdfId=etPdf.value;
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
  vol:'<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" width="18" height="18"><path d="M21.5 15.5l-8-2.2V6.5a1.5 1.5 0 00-3 0v6.8l-8 2.2v1.8l8-1.6v3.4l-2.2 1.4v1.3l3.7-.9 3.7.9v-1.3L13.5 20v-3.4l8 1.6v-1.8z"/></svg>',
  train:'<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" width="18" height="18"><path d="M7 2.5h10a3 3 0 013 3V15a3 3 0 01-3 3h-.4l1.9 2.7a.7.7 0 01-1.1.8L14.6 18H9.4l-2.8 3.5a.7.7 0 01-1.1-.8L7.4 18H7a3 3 0 01-3-3V5.5a3 3 0 013-3zm-.5 4v4.5h11V6.5h-11zM8.5 15.4a1.3 1.3 0 100-2.6 1.3 1.3 0 000 2.6zm7 0a1.3 1.3 0 100-2.6 1.3 1.3 0 000 2.6z"/></svg>',
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
  vol:'#e8748a', train:'#2d5e8c', bus:'#2d8c6b', bateau:'#2d8c8c',
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

// ── Escale / Segment 2 ──
var _mobEscales=[];
window.toggleMobEscales=function(){
  var chk=document.getElementById('mob-escale-check');
  var wrap=document.getElementById('mob-escales-wrap');
  if(!wrap)return;
  wrap.style.display=(chk&&chk.checked)?'':'none';
};
// Conservé pour compatibilité mais inutilisé (plus de multi-escale via bouton)
window.addMobEscale=function(){};
window.removeMobEscale=function(idx,row){ if(row)row.remove(); };

// ── Calcul durée ──
function calcMobDuree(){
  // Chercher les champs dans le groupe actif
  var type=(document.getElementById('mob-type')||{}).value||'vol';
  var groupId=MOB_GROUPS[type]||'mob-group-vol';
  var group=document.getElementById(groupId);
  if(!group)return;
  var depInputs=group.querySelectorAll('[id="mob-heure-dep"]');
  var arrInputs=group.querySelectorAll('[id="mob-heure-arr"]');
  var dh=depInputs.length?depInputs[0].value:'';
  var ah=arrInputs.length?arrInputs[0].value:'';
  var dispEls=group.querySelectorAll('[id="mob-duree-display"]');
  var hidEls =group.querySelectorAll('[id="mob-duree"]');
  var disp=dispEls.length?dispEls[0]:null;
  var hidden=hidEls.length?hidEls[0]:null;
  if(!dh||!ah){if(disp)disp.textContent='—';return;}
  var dm=typeof parseHM==='function'?parseHM(dh):null;
  var am=typeof parseHM==='function'?parseHM(ah):null;
  if(dm===null||am===null){if(disp)disp.textContent='—';return;}
  var diff=am-dm;if(diff<=0)diff+=1440;
  var str=typeof formatMinutes==='function'?formatMinutes(diff):Math.floor(diff/60)+'h'+(diff%60?String(diff%60).padStart(2,'0'):'');
  if(disp)disp.textContent=str;
  if(hidden)hidden.value=str;
}

// ── Calcul durée vol 2 (escale) ──
function calcEscDuree(){
  var dh=(document.getElementById('mob-esc-heure-dep')||{}).value||'';
  var ah=(document.getElementById('mob-esc-heure-arr')||{}).value||'';
  var disp=document.getElementById('mob-esc-duree-display');
  var hid =document.getElementById('mob-esc-duree-vol');
  if(!dh||!ah){if(disp)disp.textContent='—';return;}
  var dm=typeof parseHM==='function'?parseHM(dh):null;
  var am=typeof parseHM==='function'?parseHM(ah):null;
  if(dm===null||am===null){if(disp)disp.textContent='—';return;}
  var diff=am-dm;if(diff<=0)diff+=1440;
  var str=typeof formatMinutes==='function'?formatMinutes(diff):Math.floor(diff/60)+'h'+(diff%60?String(diff%60).padStart(2,'0'):'');
  if(disp)disp.textContent=str;
  if(hid)hid.value=str;
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
      +'<div class="empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="6" y="8" width="12" height="13" rx="2"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/><line x1="12" y1="12" x2="12" y2="16"/></svg></div>'
      +'<div style="font-weight:500;margin-bottom:4px">Aucun trajet enregistré</div>'
      +'<div style="font-size:12px;color:var(--ink-hint)">Vols, trains, bus, ferries… tout ici.</div>'
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

    // Escales
    var escalesHtml='';
    if(m.type==='vol'&&m.escales&&m.escales.length){
      escalesHtml='<div class="mob-escales-inline">'
        +m.escales.map(function(e){
          return '<span class="mob-escale-tag">'+e.aeroport+(e.duree?' ('+e.duree+')':'')+'</span>';
        }).join('')
      +'</div>';
    }

    // ── Contenu body : 1 ou 2 segments ──
    var bodyHtml='';
    if(m.type==='vol'&&m.segment2){
      // Route seg1
      var r1dep=(m.codeDep||m.dep||'—');
      var r1arr=(m.segment2.codeDep||m.segment2.dep||'—');
      var r2dep=r1arr;
      var r2arr=(m.segment2.codeArr||m.segment2.arr||'—');
      // Détails seg1
      var d1=[];
      if(m.compagnie)d1.push(m.compagnie);
      if(m.numero)d1.push(m.numero);
      if(m.siege)d1.push('Siège '+m.siege);
      // Détails seg2
      var d2=[];
      if(m.segment2.compagnie)d2.push(m.segment2.compagnie);
      if(m.segment2.numero)d2.push(m.segment2.numero);
      if(m.segment2.siege)d2.push('Siège '+m.segment2.siege);

      bodyHtml='<div class="mob-segments">'
        // Segment 1
        +'<div class="mob-seg">'
          +'<span class="mob-seg-num">SEG 1</span>'
          +'<span class="mob-seg-route">'+r1dep+' → '+r1arr+'</span>'
          +(m.heureDep?'<span class="mob-seg-times">'+m.heureDep+(m.heureArr?' → '+m.heureArr:'')+'</span>':'')
        +'</div>'
        +(d1.length?'<div style="font-size:11px;color:var(--ink-hint);padding:0 0 3px 28px">'+d1.join(' · ')+'</div>':'')
        // Connecteur escale
        +'<div class="mob-layover-row">'
          +'<div class="mob-layover-dot"></div>'
          +'Escale '+(m.segment2.dep||r1arr)+(m.segment2.dureeEscale?' — '+m.segment2.dureeEscale:'')
        +'</div>'
        // Segment 2
        +'<div class="mob-seg">'
          +'<span class="mob-seg-num">SEG 2</span>'
          +'<span class="mob-seg-route">'+r2dep+' → '+r2arr+'</span>'
          +(m.segment2.heureDep?'<span class="mob-seg-times">'+m.segment2.heureDep+(m.segment2.heureArr?' → '+m.segment2.heureArr:'')+'</span>':'')
        +'</div>'
        +(d2.length?'<div style="font-size:11px;color:var(--ink-hint);padding:0 0 2px 28px">'+d2.join(' · ')+'</div>':'')
      +'</div>'
      +'<div class="mob-meta" style="margin-top:5px">'
        +'<span class="mob-tag '+(statutOk?'statut-ok':'statut-att')+'">'+m.statut+'</span>'
        +(m.note?'<span class="mob-tag">'+m.note+'</span>':'')
        +passCoverHtml
      +'</div>';
    } else {
      // Vol simple ou autre transport
      bodyHtml='<div class="mob-route">'+routeLabel+'</div>'
        +(details.length?'<div class="mob-detail">'+details.join(' · ')+'</div>':'')
        +escalesHtml
        +'<div class="mob-meta">'
          +'<span class="mob-tag '+(statutOk?'statut-ok':'statut-att')+'">'+m.statut+'</span>'
          +(m.note?'<span class="mob-tag">'+m.note+'</span>':'')
          +passCoverHtml
        +'</div>';
    }

    return '<div class="mob-item item-wrap emobilite">'
      +'<div class="mob-icon '+m.type+'" style="background:'+color+'18;border-color:'+color+'44" title="Transport">'+icon+'</div>'
      +'<div class="mob-body">'+bodyHtml+'</div>'
      +(m.type!=='vol'||!m.segment2
        ?'<div class="mob-right">'
          +(m.heureDep?'<div class="mob-time">'+m.heureDep+(m.heureArr?' → '+m.heureArr:'')+'</div>':'')
          +(m.date?'<div class="mob-date">'+m.date+'</div>':'')
          +(m.duree?'<div class="mob-duree">⏱ '+m.duree+'</div>':'')
        +'</div>'
        :'<div class="mob-right">'
          +(m.date?'<div class="mob-date">'+m.date+'</div>':'')
          +(m.duree?'<div class="mob-duree">⏱ '+m.duree+'</div>':'')
        +'</div>'
      )
      +'<button class="edit-item-btn" onclick="event.stopPropagation();editMobilite('+m.id+')"></button>'
    +'</div>';
  }).join('');
}

// ── Ajouter un trajet — lit les champs du groupe actif ──
function addMobilite(){
  var type=(document.getElementById('mob-type')||{}).value||'vol';

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
    // Segment 2 (escale riche)
    var escChk=document.getElementById('mob-escale-check');
    if(escChk&&escChk.checked){
      var s2dep =(document.getElementById('mob-esc-dep')||{}).value||'';
      var s2arr =(document.getElementById('mob-esc-arr')||{}).value||'';
      if(s2dep||s2arr){
        m.segment2={
          dep        :s2dep,
          arr        :s2arr,
          codeDep    :(document.getElementById('mob-esc-code-dep')||{}).value||'',
          codeArr    :(document.getElementById('mob-esc-code-arr')||{}).value||'',
          heureDep   :(document.getElementById('mob-esc-heure-dep')||{}).value||'',
          heureArr   :(document.getElementById('mob-esc-heure-arr')||{}).value||'',
          dureeVol   :(document.getElementById('mob-esc-duree-vol')||{}).value||'',
          compagnie  :(document.getElementById('mob-esc-compagnie')||{}).value||'',
          numero     :(document.getElementById('mob-esc-numero')||{}).value||'',
          siege      :(document.getElementById('mob-esc-siege')||{}).value||'',
          resa       :(document.getElementById('mob-esc-resa')||{}).value||'',
          bagages    :(document.getElementById('mob-esc-bagages')||{}).value||'',
          dureeEscale:(document.getElementById('mob-esc-duree')||{}).value||''
        };
      }
    }
    m.escales=m.segment2?[{aeroport:m.segment2.dep||'',duree:m.segment2.dureeEscale}]:[];
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
    var dispEls=group.querySelectorAll('[id="mob-duree-display"]');
    if(dispEls.length)dispEls[0].textContent='—';
  }
  ['mob-note','mob-pdf'].forEach(function(id){var e=document.getElementById(id);if(e)e.value='';});
  var badge=document.getElementById('mob-pdf-badge');if(badge)badge.innerHTML='';
  var prev=document.getElementById('mob-route-preview');if(prev)prev.classList.remove('visible');
  _mobEscales=[];
  var eChk=document.getElementById('mob-escale-check');if(eChk)eChk.checked=false;
  var eWrap=document.getElementById('mob-escales-wrap');if(eWrap)eWrap.style.display='none';
  // Reset segment 2
  ['mob-esc-dep','mob-esc-arr','mob-esc-code-dep','mob-esc-code-arr',
   'mob-esc-heure-dep','mob-esc-heure-arr','mob-esc-compagnie','mob-esc-numero',
   'mob-esc-siege','mob-esc-resa','mob-esc-bagages','mob-esc-duree','mob-esc-duree-vol'
  ].forEach(function(id){var e=document.getElementById(id);if(e)e.value='';});
  var escDisp=document.getElementById('mob-esc-duree-display');if(escDisp)escDisp.textContent='—';

  toggleForm('form-mobilite');
  _resetTransportForm();
  renderMobilite();
  snapshotCurrentTrip();
  showToast(MOB_LABELS[m.type]+' ajouté', 'success');
}

// ── Édition modale enrichie ──
function editMobilite(id){id=isNaN(+id)?id:+id;
  var m=mobilites.find(function(x){return x.id==id;});if(!m)return;
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
  } else if(m.type==='vol'){
    var s2=m.segment2||{};
    specificFields=
      '<div class="modal-row">'
        +modalField('Code départ',mInput('em-code-dep',m.codeDep||'','CDG'))
        +modalField('Code arrivée',mInput('em-code-arr',m.codeArr||'','NRT'))
        +modalField('N° résa.',mInput('em-resa',m.resa||'','PNR'))
      +'</div>'
      +'<div class="modal-row">'
        +modalField('Siège',mInput('em-siege',m.siege||'','24A'))
        +modalField('Terminal',mInput('em-terminal',m.terminal||'','T2E'))
        +modalField('Porte',mInput('em-porte',m.porte||'','K42'))
        +modalField('Bagages',mInput('em-bagages',m.bagages||'','23kg'))
      +'</div>'
      // Segment 2
      +(s2.dep||s2.arr
        ?'<div class="modal-section">Segment 2 — via '+(s2.codeDep||s2.dep||'escale')+'</div>'
        +'<div class="modal-row">'
          +modalField('Départ escale',mInput('em-s2-dep',s2.dep||'','Aéroport escale'))
          +modalField('Code',mInput('em-s2-code-dep',s2.codeDep||'','ICN','max-width:64px'))
          +modalField('Arrivée finale',mInput('em-s2-arr',s2.arr||'','Destination'))
          +modalField('Code',mInput('em-s2-code-arr',s2.codeArr||'','NRT','max-width:64px'))
        +'</div>'
        +'<div class="modal-row">'
          +modalField('H. départ vol 2',mInput('em-s2-hdep',s2.heureDep||'','09:00'))
          +modalField('H. arrivée vol 2',mInput('em-s2-harr',s2.heureArr||'','11:10'))
          +modalField('Durée escale',mInput('em-s2-esc-duree',s2.dureeEscale||'','2h30'))
        +'</div>'
        +'<div class="modal-row">'
          +modalField('Compagnie vol 2',mInput('em-s2-comp',s2.compagnie||'',''))
          +modalField('N° vol 2',mInput('em-s2-num',s2.numero||'',''))
          +modalField('Siège vol 2',mInput('em-s2-siege',s2.siege||'',''))
        +'</div>'
        +'<div class="modal-row">'
          +modalField('N° résa. vol 2',mInput('em-s2-resa',s2.resa||'','si différent'))
          +modalField('Bagages vol 2',mInput('em-s2-bagages',s2.bagages||'',''))
        +'</div>'
        :''
      );
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
      +modalField('H. départ',mInput('em-hdep',m.heureDep,'09:00'))
      +modalField('H. arrivée',mInput('em-harr',m.heureArr,'12:30'))
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
    +modalFooter('saveMobilite('+id+')','deleteMobilite('+id+')')
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
    m.codeDep =_gv('em-code-dep');
    m.codeArr =_gv('em-code-arr');
    m.resa    =_gv('em-resa');
    m.siege   =_gv('em-siege');
    m.terminal=_gv('em-terminal');
    m.porte   =_gv('em-porte');
    m.bagages =_gv('em-bagages');
    // Segment 2 uniquement pour les vols
    if(m.segment2&&document.getElementById('em-s2-dep')){
      m.segment2=JSON.parse(JSON.stringify(m.segment2));
      m.segment2.dep        =_gv('em-s2-dep');
      m.segment2.codeDep    =_gv('em-s2-code-dep');
      m.segment2.arr        =_gv('em-s2-arr');
      m.segment2.codeArr    =_gv('em-s2-code-arr');
      m.segment2.heureDep   =_gv('em-s2-hdep');
      m.segment2.heureArr   =_gv('em-s2-harr');
      m.segment2.dureeEscale=_gv('em-s2-esc-duree');
      m.segment2.compagnie  =_gv('em-s2-comp');
      m.segment2.numero     =_gv('em-s2-num');
      m.segment2.siege      =_gv('em-s2-siege');
      m.segment2.resa       =_gv('em-s2-resa');
      m.segment2.bagages    =_gv('em-s2-bagages');
    }
    // Champs train/bateau absents pour les vols — nettoyage défensif
    delete m.voiture; delete m.cabine; delete m.pont;
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
  // Recalc durée
  if(m.heureDep&&m.heureArr&&typeof parseHM==='function'){
    var dm=parseHM(m.heureDep),am=parseHM(m.heureArr);
    if(dm!==null&&am!==null){var df=am-dm;if(df<=0)df+=1440;m.duree=typeof formatMinutes==='function'?formatMinutes(df):'';}
  }
  // PDF — accepte nouveau fichier OU conserve l'ancien
  var emPdf=document.getElementById('em-pdf');
  if(emPdf&&emPdf.value) m.pdfId=emPdf.value;
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
      +'<div class="empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 17H3a2 2 0 0 1-2-2v-4l3-7h14l3 7v4a2 2 0 0 1-2 2h-2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><line x1="9" y1="17" x2="15" y2="17"/></svg></div>'
      +'<div style="font-weight:500;margin-bottom:4px">Aucune location</div>'
      +'<div style="font-size:12px;color:var(--ink-hint)">Voitures, scooters, vélos en location.</div>'
      +'</div>';
    return;
  }
  el.innerHTML=locations.map(function(l){
    var icon=LOC_ICONS[l.type]||'—';
    return '<div class="loc-card item-wrap elocations">'
      +'<div class="loc-card-header">'
        +'<div class="loc-icon" title="Location">'+icon+'<span class="loc-key-badge"></span></div>'
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
      +'<button class="edit-item-btn" onclick="event.stopPropagation();editLocation('+l.id+')"></button>'
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
  showToast(LOC_ICONS[loc.type]+' ajoutée', 'success');
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
    +modalFooter('saveLocation('+id+')','deleteLocation('+id+')')
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
  if(el2Pdf&&el2Pdf.value) l.pdfId=el2Pdf.value;
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

function renderHotels(){
  var el=document.getElementById('hotels-list');
  el.style.display='';
  if(!hotels.length){el.innerHTML='<div class="empty-state"><div class="es-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28"><rect x="2" y="6" width="20" height="16" rx="2"/><path d="M2 12h20"/><rect x="7" y="16" width="3" height="6"/><rect x="14" y="16" width="3" height="6"/></svg></div><div class="es-title">Aucun hébergement enregistré</div><div class="es-sub">Ajoute tes hôtels et Airbnb pour suivre ton planning.</div></div>';renderNightsSummary();return;}
  el.innerHTML=hotels.map(function(h){
    var c=getVilleColor(h.ville);
    // Ligne adresse élégante : rue + "Ville, Pays" avec badge pays
    var adresseLine = '';
    if(h.rue || h.cp || h.pays || h.ville){
      var rueDisplay = h.rue ? h.rue + (h.cp ? ', ' + h.cp : '') : '';
      var locDisplay = h.ville + (h.pays ? '<span class="pays-tag">'+h.pays+'</span>' : '');
      adresseLine = '<div class="hotel-adresse-structured">'
        +'<span>'+(rueDisplay ? rueDisplay+', ' : '')+locDisplay+'</span>'
        +'<button class="map-pin-link" onclick="event.stopPropagation();goToMapPin(\'hotel\','+h.id+')" title="Voir sur la carte" style="background:none;border:none;cursor:pointer;font-size:13px;padding:0;margin-left:4px"><svg viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'1.8\' width=\'13\' height=\'13\'><path d=\'M9 3L3 6.5v14L9 17l6 3.5 6-3.5V3l-6 3.5L9 3z\'/><line x1=\'9\' y1=\'3\' x2=\'9\' y2=\'17\'/><line x1=\'15\' y1=\'6.5\' x2=\'15\' y2=\'20.5\'/></svg></button>'
        +'</div>';
    } else if(h.adresse){
      // Fallback legacy
      adresseLine = '<div class="hotel-adresse">'+h.adresse
        +'<button class="map-pin-link" onclick="event.stopPropagation();goToMapPin(\'hotel\','+h.id+')" title="Voir sur la carte"><svg viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'1.8\' width=\'13\' height=\'13\'><path d=\'M9 3L3 6.5v14L9 17l6 3.5 6-3.5V3l-6 3.5L9 3z\'/><line x1=\'9\' y1=\'3\' x2=\'9\' y2=\'17\'/><line x1=\'15\' y1=\'6.5\' x2=\'15\' y2=\'20.5\'/></svg></button></div>';
    }
    return '<div class="hotel-item item-wrap ehotel">'
      +'<div class="hotel-stripe" style="background:'+c+'"></div>'
      +'<div style="flex:1">'
        +'<div class="hotel-name">'+h.nom+'</div>'
        +'<div class="hotel-info">'+(h.checkin?h.checkin+' → '+h.checkout+' · ':'')+(h.type?h.type+' · ':'')+h.ville+'</div>'
        +adresseLine
        +(h.resa?'<div class="hotel-ref" style="color:'+c+'">Résa : '+h.resa+'</div>':'')
      +'</div>'
      +'<div class="hotel-nights">'+(_hotelNights(h)?_hotelNights(h)+' nuits':'')+'</div>'
      +'<button class="edit-item-btn" onclick="event.stopPropagation();editHotel('+h.id+')"></button>'
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
    +modalFooter('saveHotel('+id+')','deleteHotel('+id+')')
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
  if(ehPdf&&ehPdf.value) h.pdfId=ehPdf.value;
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
    rue:addr.rue, cp:addr.cp, pays:addr.pays,
    fullAddress:fullAddress,
    adresse:fullAddress,
    lat:parseFloat((document.getElementById('ht-adresse-lat')||{}).value)||null,
    lng:parseFloat((document.getElementById('ht-adresse-lng')||{}).value)||null,
    pdfId:pdfId
  });
  // Reset tous les champs
  ['ht-nom','ht-ville','ht-ville-addr','ht-ci','ht-co','ht-nuits','ht-type','ht-resa',
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
var _lieuxGroupMode = 'none';   // 'none' | 'ville' | 'categorie'

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

  var horaires = '';
  if(l.ouverture || l.fermeture){
    horaires = '<div class="lieu-horaires">'
      + (l.ouverture ? '<span class="lieu-horaire-chip">' + l.ouverture + '</span>' : '')
      + (l.fermeture ? '<span class="lieu-horaire-chip">' + l.fermeture + '</span>' : '')
    + '</div>';
  }
  var mapBtn = '<button class="map-pin-link" style="margin-left:5px;background:none;border:none;cursor:pointer;font-size:13px;padding:0" onclick="event.stopPropagation();goToMapPin(\'lieu\',' + l.id + ')" title="Voir sur la carte"><svg viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'1.8\' width=\'13\' height=\'13\'><path d=\'M9 3L3 6.5v14L9 17l6 3.5 6-3.5V3l-6 3.5L9 3z\'/><line x1=\'9\' y1=\'3\' x2=\'9\' y2=\'17\'/><line x1=\'15\' y1=\'6.5\' x2=\'15\' y2=\'20.5\'/></svg></button>';
  var pdfHtml = '';
  if(l.pdfId && window.pdfStore && window.pdfStore[l.pdfId]){
    pdfHtml = '<span class="pdf-badge" style="cursor:pointer;font-size:11px;margin-top:4px;display:inline-block" onclick="event.stopPropagation();openPdf(\'' + l.pdfId + '\')">' + window.pdfStore[l.pdfId].name + '</span>';
  }
  var locLine = l.ville + (l.pays ? ', <span style="color:var(--ink-hint)">' + l.pays + '</span>' : '');
  var adresseDetail = '';
  if(l.rue){ adresseDetail = '<div class="place-adresse">' + l.rue + (l.cp ? ' ' + l.cp : '') + ', ' + l.ville + (l.pays ? ', ' + l.pays : '') + '</div>'; }
  var catBadge = l.categorie ? '<div class="lieu-cat-badge ' + _lieuCatClass(l.categorie) + '">' + l.categorie + '</div>' : '';

  card.innerHTML =
    '<div style="display:flex;align-items:flex-start;gap:10px">'
      + '<div class="place-emoji">' + (l.emoji || '') + '</div>'
      + '<div style="flex:1;min-width:0">'
        + '<div class="place-name">' + l.nom + '</div>'
        + '<div class="place-city">' + locLine + mapBtn + '</div>'
        + catBadge + horaires + adresseDetail
        + (l.note ? '<div class="place-note">' + l.note + '</div>' : '')
        + (l.visited ? '<div class="place-check">Visité</div>' : '')
        + pdfHtml
      + '</div>'
    + '</div>'
    + '<button class="edit-item-btn" onclick="event.stopPropagation();editLieu(' + l.id + ')"></button>';

  card.onclick = function(){
    if(emodes && emodes.lieux) return;
    var found = lieux.find(function(x){ return x.id === l.id; });
    if(found){ found.visited = !found.visited; snapshotCurrentTrip(); renderLieux(); }
  };
  return card;
}

function renderLieux(){
  var grid=document.getElementById('places-grid');
  var empty=document.getElementById('places-empty');
  if(!grid||!empty) return;

  // ── Mode regroupé : par ville ou par catégorie ──
  if(_lieuxGroupMode !== 'none'){
    grid.innerHTML='';
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
  var filtered=currentFilter==='Tous'?lieux:lieux.filter(function(l){return l.ville===currentFilter||l.categorie===currentFilter;});
  grid.innerHTML='';
  if(!filtered.length){ empty.style.display='block'; grid.style.display='none'; return; }
  empty.style.display='none'; grid.style.display='';
  filtered.forEach(function(l){ grid.appendChild(_renderLieuCard(l)); });
  _updateLieuxFilters();
}

function _lieuCatClass(cat){
  var m={'Temples':'Temples','Parcs':'Parcs','Randonn\u00e9es':'Randonnees',
    'Restaurants':'Restaurants','Mus\u00e9es':'Musees','Shopping':'Shopping','Onsen':'Onsen'};
  return m[cat]||'default';
}
function _lieuCatIcon(cat){
  // Charte Zéro Emoji : les catégories s'affichent en texte (le badge
  // coloré porte déjà l'identité visuelle via _lieuCatClass). Les
  // anciens littéraux \\U0001… (style Python) ne s'interprétaient pas
  // en JS et apparaissaient en brut (« U0001f4cd ») — supprimés.
  return '';
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
    +modalFooter('saveLieu('+id+')','deleteLieu('+id+')')
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
  if(elPdf&&elPdf.value) l.pdfId=elPdf.value;
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
  '📱 Divers'     :'#78909C'    // Gris bleuté
};

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

  transactions.push({id:uid(), desc:desc, raw:raw, devise:devise, amount:amountEur, cat:cat, date:date});
  document.getElementById('tx-desc').value   = '';
  document.getElementById('tx-amount').value = '';
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
}

function deleteTransaction(id){
  transactions=transactions.filter(function(t){return t.id!=id;});updateBudget();
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
        var cColor = (catColors[e[0]]||'var(--sakura)');
        return '<div class="cat-row"><div class="cat-name"><span class="tx-cat-dot" style="background:'+cColor+'"></span>'+e[0]+'</div><div class="cat-bar-track"><div class="cat-bar-fill" style="width:'+Math.round((e[1]/mx)*100)+'%;background:'+cColor+'"></div></div><div class="cat-amount" style="color:'+cColor+'">'+e[1].toLocaleString('fr-FR',{minimumFractionDigits:2})+' €</div></div>';
      }).join('')+'</div>';
    }
  }
  renderDonutChart(catTotals, spent);
  var txEl=document.getElementById('tx-list');
  if(!txEl)return;
  if(!transactions.length){txEl.innerHTML='<div class="empty-state"><div class="empty-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v2m0 8v2m-4-4h8"/></svg></div><div>Aucune transaction</div></div>';}
  else{
    txEl.innerHTML=transactions.slice().reverse().map(function(t){
      var tColor = (typeof catColors!=='undefined' && catColors[t.cat]) || '#888';
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
        +'<div class="tx-icon" style="background:'+tColor+'22;border-radius:10px">'+t.cat.split(' ')[0]+'</div>'
        +'<div class="tx-body">'
          +'<div class="tx-desc">'+t.desc+deviseBadge+'</div>'
          +'<div class="tx-cat"><span class="tx-cat-dot" style="background:'+tColor+'"></span> '+t.cat+'</div>'
        +'</div>'
        +'<div class="tx-right">'
          +'<div class="tx-amount" style="font-size:15px;font-weight:600;color:var(--ink)">-'+eurStr+'</div>'
          +rawLine
          +'<div class="tx-date">'+t.date+'</div>'
        +'</div>'
        +'<button class="tx-delete" onclick="deleteTransaction('+t.id+')" title="Supprimer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
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
// Stockage global des PDFs indexés par id unique
if(!window.pdfStore) window.pdfStore = {};

function attachPdfToForm(hiddenId, fileInput){
  var file = fileInput.files[0];
  if(!file) return;
  if(file.size > 15*1024*1024){ alert('PDF trop lourd (max 15 Mo)'); return; }
  var reader = new FileReader();
  reader.onload = function(e){
    var b64   = e.target.result;
    var pdfId = 'pdf_'+Date.now();
    window.pdfStore[pdfId] = { name: file.name, data: b64 };
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
  var entry = window.pdfStore[pdfId];
  if(!entry){ alert('PDF introuvable. Le document a peut-être été supprimé ou la page a été rechargée.'); return; }
  try {
    // Méthode 1 : Blob URL (la plus fiable, ouvre un vrai PDF viewer)
    var byteStr = atob(entry.data.split(',')[1]);
    var ab = new ArrayBuffer(byteStr.length);
    var ia = new Uint8Array(ab);
    for(var i=0;i<byteStr.length;i++) ia[i] = byteStr.charCodeAt(i);
    var blob = new Blob([ab], {type:'application/pdf'});
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
        +'<body style="margin:0;padding:0">'
        +'<embed src="'+entry.data+'" type="application/pdf" width="100%" height="100%" style="position:absolute;inset:0"/>'
        +'</body></html>');
    }
  }
}

function renderPdfBadge(pdfId, containerEl){
  if(!pdfId || !containerEl) return;
  var entry = window.pdfStore[pdfId];
  if(!entry) return;
  var badge = document.createElement('span');
  badge.className = 'pdf-badge';
  badge.style.cssText = 'display:inline-flex;margin-top:4px';
  badge.textContent = entry.name;
  badge.addEventListener('click', function(){ openPdf(pdfId); });
  containerEl.appendChild(badge);
}

// PDF vol intégré dans addVol (voir ci-dessus)

// pdfId intégré nativement dans addTrain() et addHotel() (voir ci-dessus)


// ── addLieu, renderLieux, editLieu, saveLieu — fonctions consolidées (voir ci-dessus) ──


// renderVols — gestion PDF intégrée directement dans la fonction originale (ci-dessus)


// editLieu et saveLieu — fonctions consolidées (voir ci-dessus)


loadAllTrips();
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
// DROPDOWN VOYAGES (page d'accueil)
// ══════════════════════════════════════════════════════════════
function toggleTripsDropdown(){
  var btn  = document.getElementById('trips-dropdown-btn');
  var menu = document.getElementById('trips-dropdown-menu');
  if(!btn||!menu) return;
  var isOpen = menu.classList.contains('open');
  if(isOpen){ menu.classList.remove('open'); btn.classList.remove('open'); }
  else { buildDropdownMenu(); menu.classList.add('open'); btn.classList.add('open'); }
}

function buildDropdownMenu(){
  var menu = document.getElementById('trips-dropdown-menu');
  if(!menu) return;
  var ids = Object.keys(allTrips);
  if(!ids.length){
    menu.innerHTML='<div class="trips-dd-empty">Aucun voyage — crée-en un !</div>';
    return;
  }
  menu.innerHTML = ids.slice().reverse().map(function(tid){
    var m=allTrips[tid].meta||{};
    var name=m.name||'Voyage sans titre';
    var emoji=m.emoji||'✈';
    var parts=[];
    var vCount=(allTrips[tid].vols||[]).length;
    var hCount=(allTrips[tid].hotels||[]).length;
    if(vCount) parts.push(vCount+' vol'+(vCount>1?'s':''));
    if(hCount) parts.push(hCount+' héb.');
    if(m.created) parts.push(m.created);
    return '<div class="trips-dd-item" onclick="selectTripFromDropdown(\''+tid+'\')">'+
      '<span class="ddi-emoji">'+emoji+'</span>'+
      '<div class="ddi-body">'+
        '<div class="ddi-name">'+name+'</div>'+
        '<div class="ddi-meta">'+(parts.join(' · ')||'Vide')+'</div>'+
      '</div>'+
      '<button class="ddi-del" onclick="event.stopPropagation();deleteTripFromDropdown(\''+tid+'\')" title="Supprimer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'+
    '</div>';
  }).join('');
}

function selectTripFromDropdown(tid){
  var menuEl=document.getElementById('trips-dropdown-menu');
  var btnEl=document.getElementById('trips-dropdown-btn');
  if(menuEl) menuEl.classList.remove('open');
  if(btnEl) btnEl.classList.remove('open');
  var m=(allTrips[tid]&&allTrips[tid].meta)||{};
  var emojiEl=document.getElementById('dd-selected-emoji');
  var labelEl=document.getElementById('dd-selected-label');
  if(emojiEl) emojiEl.textContent=m.emoji||'✈';
  if(labelEl) labelEl.textContent=m.name||'Voyage';
  openTrip(tid);
}

function deleteTripFromDropdown(tid){
  var name = (allTrips[tid] && allTrips[tid].meta && allTrips[tid].meta.name) || 'ce voyage';
  if(!confirm('Supprimer "' + name + '" ?')) return;
  supprimerVoyage(tid);
}

document.addEventListener('click',function(e){
  var wrap=document.getElementById('trips-dropdown-wrap');
  if(wrap&&!wrap.contains(e.target)){
    var menu=document.getElementById('trips-dropdown-menu');
    var btn=document.getElementById('trips-dropdown-btn');
    if(menu) menu.classList.remove('open');
    if(btn) btn.classList.remove('open');
  }
});

// renderTripsList — buildDropdownMenu() intégré directement (voir ci-dessus)


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
function autoCalcDuree(depId, arrId, dureeId){
  var dep=document.getElementById(depId)?document.getElementById(depId).value:'';
  var arr=document.getElementById(arrId)?document.getElementById(arrId).value:'';
  var dEl=document.getElementById(dureeId);
  if(!dEl) return;
  var dMin=parseHM(dep), aMin=parseHM(arr);
  if(dMin!==null&&aMin!==null){
    var diff=aMin-dMin;
    if(diff<=0) diff+=1440; // lendemain
    dEl.value=formatMinutes(diff);
    flashAuto(dEl,'hint-'+dureeId);
  } else { dEl.value=''; }
}

// ── Vol : heure départ + arrivée → durée (lit directement les input[type=time]) ──
function autoCalcDureeVol(){
  var depH = (document.getElementById('vol-dep-heure')||{}).value || '';
  var arrH = (document.getElementById('vol-arr-heure')||{}).value || '';
  var dEl  = document.getElementById('vol-duree');
  if(!dEl) return;
  var dMin = parseHM(depH), aMin = parseHM(arrH);
  if(dMin === null || aMin === null){ dEl.value = ''; return; }
  var total = aMin - dMin;
  if(total <= 0) total += 1440; // vol de nuit
  dEl.value = formatMinutes(Math.max(0, total));
  flashAuto(dEl, null);
}
document.addEventListener('change',function(e){
  if(e.target&&(e.target.id==='vol-dep-jour'||e.target.id==='vol-arr-jour')) autoCalcDureeVol();
});

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
  // Escales
  var escChk = document.getElementById('mob-escale-check');
  if(escChk) escChk.checked = false;
  var escWrap = document.getElementById('mob-escales-wrap');
  if(escWrap) escWrap.style.display = 'none';
  var escDisp = document.getElementById('mob-esc-duree-display');
  if(escDisp) escDisp.textContent = '—';
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
  function _learnOnBlur(inputId, side){
    var el = document.getElementById(inputId);
    if(!el) return;
    el.addEventListener('blur', function(){
      var v = this.value.trim();
      if(v && !STATION_DATA[v]){
        // Géocoder et mémoriser
        _geocodeStation(v, function(r){
          if(r) _acLearnStation(v, r.lat, r.lng);
        });
      }
    });
  }
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

