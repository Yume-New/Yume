// ══════════════════════════════════════════════════════════════════════
// finance-data.js — Données financières statiques
// Yume Travel Manager · Phase A · Modularisation
//
// CONTENU : COUNTRY_CURRENCY · CURRENCY_INFO · FALLBACK_RATES
// RÈGLE   : Ce fichier ne contient AUCUNE logique, AUCUNE fonction.
//           Les variables de runtime (convRate, convMode, etc.) restent
//           dans app.js et migreront vers state.js à l'Étape 3.
//           Les fonctions (fetchRate, getTripCurrency, etc.) → app.js.
//
// DÉPENDANCES : aucune — chargé après transport-refs.js dans index.html
// ══════════════════════════════════════════════════════════════════════

'use strict';

// ── §1 COUNTRY_CURRENCY ───────────────────────────────────────────────
// Dictionnaire pays → code ISO 4217 de la devise
// Utilisé par : getTripCurrency(), convertisseur, budget multi-devises
// ─────────────────────────────────────────────────────────────────────
var COUNTRY_CURRENCY = {
  // Europe — Zone Euro
  'France':'EUR','Allemagne':'EUR','Italie':'EUR','Espagne':'EUR',
  'Portugal':'EUR','Grèce':'EUR','Autriche':'EUR','Belgique':'EUR',
  'Pays-Bas':'EUR','Finlande':'EUR','Irlande':'EUR','Luxembourg':'EUR',
  'Slovaquie':'EUR','Slovénie':'EUR','Estonie':'EUR','Lettonie':'EUR',
  'Lituanie':'EUR','Malte':'EUR','Chypre':'EUR',
  // Europe — Hors zone Euro
  'Suisse':'CHF','Norvège':'NOK','Suède':'SEK','Danemark':'DKK',
  'Islande':'ISK','Pologne':'PLN','Hongrie':'HUF','Roumanie':'RON',
  'Bulgarie':'BGN','Croatie':'EUR','Serbie':'RSD','Albanie':'ALL',
  'Monténégro':'EUR','Bosnie-Herzégovine':'BAM','Moldavie':'MDL',
  'Ukraine':'UAH','Royaume-Uni':'GBP',
  // Amériques
  'États-Unis':'USD','Canada':'CAD','Mexique':'MXN','Brésil':'BRL',
  'Argentine':'ARS','Chili':'CLP','Colombie':'COP','Pérou':'PEN',
  'Uruguay':'UYU','Bolivie':'BOB','Paraguay':'PYG','Équateur':'USD',
  'Venezuela':'VES','Cuba':'CUP','République Dominicaine':'DOP',
  'Costa Rica':'CRC','Panama':'USD','Guatemala':'GTQ',
  'Honduras':'HNL','Salvador':'USD','Nicaragua':'NIO',
  'Jamaïque':'JMD','Haïti':'HTG',
  // Asie
  'Japon':'JPY','Chine':'CNY','Corée du Sud':'KRW',
  'Inde':'INR','Thaïlande':'THB','Vietnam':'VND',
  'Indonésie':'IDR','Malaisie':'MYR','Philippines':'PHP',
  'Singapour':'SGD','Taïwan':'TWD','Hong Kong':'HKD',
  'Cambodge':'KHR','Laos':'LAK','Birmanie':'MMK',
  'Bangladesh':'BDT','Pakistan':'PKR','Sri Lanka':'LKR',
  'Népal':'NPR','Mongolie':'MNT','Kazakhstan':'KZT',
  'Ouzbékistan':'UZS','Azerbaïdjan':'AZN','Géorgie':'GEL',
  'Arménie':'AMD','Turquie':'TRY',
  // Moyen-Orient
  'Émirats arabes unis':'AED','Arabie Saoudite':'SAR',
  'Qatar':'QAR','Israël':'ILS','Jordanie':'JOD',
  'Liban':'LBP','Irak':'IQD','Iran':'IRR','Oman':'OMR',
  // Afrique
  'Maroc':'MAD','Tunisie':'TND','Algérie':'DZD','Égypte':'EGP',
  'Afrique du Sud':'ZAR','Kenya':'KES','Tanzanie':'TZS',
  'Nigeria':'NGN','Ghana':'GHS','Sénégal':'XOF',
  'Côte d\'Ivoire':'XOF','Cameroun':'XAF','Éthiopie':'ETB',
  'Rwanda':'RWF','Ouganda':'UGX','Madagascar':'MGA',
  // Océanie
  'Australie':'AUD','Nouvelle-Zélande':'NZD',
};


// ── §2 CURRENCY_INFO ─────────────────────────────────────────────────
// Métadonnées d'affichage et presets de saisie par code devise
// Utilisé par : convertisseur, saisie transactions, badges devises
// ─────────────────────────────────────────────────────────────────────
var CURRENCY_INFO = {
  'EUR':{name:'Euro',           sym:'€',   presets:[10,20,50,100,200,500]},
  'JPY':{name:'Yen',            sym:'¥',   presets:[500,1000,3000,5000,10000,50000]},
  'USD':{name:'Dollar US',      sym:'$',   presets:[5,10,20,50,100,200]},
  'GBP':{name:'Livre sterling', sym:'£',   presets:[5,10,20,50,100,200]},
  'CHF':{name:'Franc suisse',   sym:'CHF', presets:[5,10,20,50,100,200]},
  'CAD':{name:'Dollar CA',      sym:'C$',  presets:[5,10,20,50,100,200]},
  'AUD':{name:'Dollar AUS',     sym:'A$',  presets:[5,10,20,50,100,200]},
  'CNY':{name:'Yuan',           sym:'¥',   presets:[50,100,200,500,1000,2000]},
  'KRW':{name:'Won',            sym:'₩',   presets:[1000,5000,10000,50000,100000,200000]},
  'TWD':{name:'Dollar TW',      sym:'NT$', presets:[50,100,200,500,1000,2000]},
  'THB':{name:'Baht',           sym:'฿',   presets:[50,100,200,500,1000,2000]},
  'VND':{name:'Dong',           sym:'₫',   presets:[10000,50000,100000,200000,500000,1000000]},
  'IDR':{name:'Roupie ID',      sym:'Rp',  presets:[10000,50000,100000,200000,500000,1000000]},
  'MYR':{name:'Ringgit',        sym:'RM',  presets:[5,10,20,50,100,200]},
  'PHP':{name:'Peso PH',        sym:'₱',   presets:[50,100,200,500,1000,2000]},
  'SGD':{name:'Dollar SG',      sym:'S$',  presets:[2,5,10,20,50,100]},
  'INR':{name:'Roupie',         sym:'₹',   presets:[100,200,500,1000,2000,5000]},
  'MXN':{name:'Peso MX',        sym:'$',   presets:[20,50,100,200,500,1000]},
  'BRL':{name:'Réal',           sym:'R$',  presets:[5,10,20,50,100,200]},
  'TRY':{name:'Livre TK',       sym:'₺',   presets:[10,20,50,100,200,500]},
  'MAD':{name:'Dirham',         sym:'د.م.',presets:[10,20,50,100,200,500]},
  'ZAR':{name:'Rand',           sym:'R',   presets:[20,50,100,200,500,1000]},
  'AED':{name:'Dirham AE',      sym:'د.إ', presets:[5,10,20,50,100,200]},
  'SAR':{name:'Riyal',          sym:'﷼',   presets:[5,10,20,50,100,200]},
  'PLN':{name:'Zloty',          sym:'zł',  presets:[5,10,20,50,100,200]},
  'SEK':{name:'Couronne SE',    sym:'kr',  presets:[20,50,100,200,500,1000]},
  'NOK':{name:'Couronne NO',    sym:'kr',  presets:[20,50,100,200,500,1000]},
  'DKK':{name:'Couronne DK',    sym:'kr',  presets:[20,50,100,200,500,1000]},
  'HUF':{name:'Forint',         sym:'Ft',  presets:[500,1000,2000,5000,10000,20000]},
  'CZK':{name:'Couronne CZ',    sym:'Kč',  presets:[50,100,200,500,1000,2000]},
  'HKD':{name:'Dollar HK',      sym:'HK$', presets:[10,20,50,100,200,500]},
  'NZD':{name:'Dollar NZ',      sym:'NZ$', presets:[5,10,20,50,100,200]},
  'EGP':{name:'Livre EG',       sym:'E£',  presets:[20,50,100,200,500,1000]},
  'NGN':{name:'Naira',          sym:'₦',   presets:[500,1000,2000,5000,10000,20000]},
  'KES':{name:'Shilling KE',    sym:'KSh', presets:[100,200,500,1000,2000,5000]},
  'GEL':{name:'Lari',           sym:'₾',   presets:[5,10,20,50,100,200]},
  'ILS':{name:'Shekel',         sym:'₪',   presets:[5,10,20,50,100,200]},
  'QAR':{name:'Riyal QA',       sym:'ر.ق', presets:[5,10,20,50,100,200]},
};


// ── §3 FALLBACK_RATES ─────────────────────────────────────────────────
// Taux de change EUR → devise de repli (mode hors-ligne)
// Mis à jour manuellement · Valeurs indicatives Q4 2024
// Utilisé par : localToEur() quand l'API ExchangeRate est inaccessible
// ─────────────────────────────────────────────────────────────────────
var FALLBACK_RATES = {
  'JPY':160,   'USD':1.08,  'GBP':0.86,  'CHF':0.96,  'CAD':1.47,
  'AUD':1.63,  'CNY':7.82,  'KRW':1430,  'TWD':34.5,  'THB':38.5,
  'VND':26500, 'IDR':17000, 'MYR':5.1,   'PHP':62,    'SGD':1.45,
  'INR':89,    'MXN':19.8,  'BRL':5.3,   'TRY':35,    'MAD':10.8,
  'ZAR':19.8,  'AED':3.97,  'SAR':4.05,  'PLN':4.28,  'SEK':11.4,
  'NOK':11.7,  'DKK':7.46,  'HUF':400,   'HKD':8.42,  'NZD':1.78,
  'EGP':52,    'NGN':1680,  'KES':140,   'GEL':2.93,  'ILS':3.95,
  'QAR':3.93,  'IQD':1412,  'CZK':25.2,  'CLP':1010,  'COP':4400,
  'PEN':4.1,   'ARS':1020,
};
