// ══════════════════════════════════════════════════════════════════════
// transport-refs.js — Références compagnies de transport
// Yume Travel Manager · Phase A · Modularisation
//
// CONTENU : AIRLINES · RAIL_COMPANIES
// RÈGLE   : Ce fichier ne contient AUCUNE logique, AUCUNE fonction.
//           Les fonctions d'autocomplete et de détection sont dans app.js.
//
// DÉPENDANCES : aucune — chargé après geo-defaults.js dans index.html
// ══════════════════════════════════════════════════════════════════════

'use strict';

// ── §1 AIRLINES ───────────────────────────────────────────────────────
// Liste des compagnies aériennes pour l'autocomplete
// Note : enrichie au runtime par _acLearnAirline() via localStorage
// ─────────────────────────────────────────────────────────────────────
var AIRLINES = [
  // Europe
  'Air France','Air France Hop','Transavia','Corsair',
  'British Airways','EasyJet','Virgin Atlantic','Ryanair','Aer Lingus',
  'Lufthansa','Austrian Airlines','Swiss International Air Lines',
  'KLM','TUI fly',
  'Iberia','Vueling','Iberia Express',
  'Alitalia','ITA Airways',
  'Brussels Airlines','SN Brussels',
  'TAP Air Portugal',
  'Finnair','Scandinavian Airlines','Norwegian',
  'Turkish Airlines','Pegasus Airlines',
  'Wizz Air','LOT Polish Airlines','Czech Airlines',
  'Aegean Airlines','Olympic Air',
  // Moyen-Orient / Afrique
  'Emirates','Etihad Airways','Qatar Airways','flydubai',
  'Air Arabia','Royal Air Maroc','Tunisair','Air Algérie',
  'EgyptAir','Ethiopian Airlines','Kenya Airways',
  // Asie
  'Japan Airlines','ANA - All Nippon Airways','Peach Aviation','Jetstar Japan',
  'Korean Air','Asiana Airlines','Air Busan','Jin Air',
  'China Airlines','EVA Air','Starlux Airlines',
  'Air China','China Eastern','China Southern','Hainan Airlines','Xiamen Airlines',
  'Singapore Airlines','Scoot','SilkAir',
  'Malaysia Airlines','AirAsia','Firefly',
  'Thai Airways','Bangkok Airways','Thai Lion Air','Thai AirAsia',
  'Vietnam Airlines','VietJet Air','Bamboo Airways',
  'Garuda Indonesia','Citilink','Lion Air','Batik Air',
  'Philippine Airlines','Cebu Pacific','AirAsia Zest',
  'Cathay Pacific','HK Express',
  'IndiGo','Air India','SpiceJet','Vistara',
  // Amérique du Nord
  'American Airlines','Delta Air Lines','United Airlines',
  'Southwest Airlines','JetBlue Airways','Alaska Airlines','Spirit Airlines',
  'Air Canada','WestJet','Porter Airlines',
  'Aeromexico','Interjet','Volaris',
  // Amérique du Sud
  'LATAM Airlines','Avianca','Copa Airlines',
  'GOL Transportes Aéreos','Azul','TAM',
  // Australie / Océanie
  'Qantas','Jetstar','Virgin Australia','Air New Zealand',
  // Cargo / Mix
  'FedEx','UPS Airlines','DHL Air',
];


// ── §2 RAIL_COMPANIES ─────────────────────────────────────────────────
// Dictionnaire compagnies ferroviaires pour la reconnaissance automatique
// Clé : fragment du nom saisi (insensible à la casse, testé via indexOf)
// Valeur : { name, abbr, color, icon }
//
// IMPORTANT ARCHITECTURE — Les icônes sont en SVG inline (zéro emoji).
// Respecte la charte design "SVG uniquement" de Yume.
//
// Utilisé par : _detectRailCompany(), _updateTrainCompanyIcon()
// ─────────────────────────────────────────────────────────────────────
var RAIL_COMPANIES = {
  'sncf': {
    name:'SNCF', abbr:'TGV/INOUI', color:'#e2001a',
    icon:'<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="10" width="26" height="12" rx="6"/><line x1="3" y1="16" x2="29" y2="16"/><circle cx="9" cy="22" r="2"/><circle cx="23" cy="22" r="2"/></svg>'
  },
  'tgv': {
    name:'TGV', abbr:'SNCF', color:'#e2001a',
    icon:'<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 17 Q8 11 16 11 L28 11 Q30 11 30 13 L30 18 Q30 20 28 20 L3 20 Z"/><line x1="3" y1="20" x2="29" y2="20"/><circle cx="9" cy="23" r="2.2"/><circle cx="22" cy="23" r="2.2"/></svg>'
  },
  'eurostar': {
    name:'Eurostar', abbr:'e320', color:'#2a1566',
    icon:'<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 18 L10 12 L28 12 Q30 12 30 14 L30 19 Q30 21 28 21 L2 21 Z"/><circle cx="8" cy="24" r="2"/><circle cx="24" cy="24" r="2"/></svg>'
  },
  'thalys': {
    name:'Thalys', abbr:'THA', color:'#c00',
    icon:'<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 18 L9 12 L27 12 Q30 12 30 14 L30 19 Q30 21 27 21 L3 21 Z"/><circle cx="8" cy="24" r="2.2"/><circle cx="23" cy="24" r="2.2"/></svg>'
  },
  'renfe': {
    name:'Renfe', abbr:'AVE', color:'#c60b1e',
    icon:'<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="11" width="24" height="10" rx="5"/><line x1="4" y1="16" x2="28" y2="16"/><circle cx="9" cy="21" r="2"/><circle cx="23" cy="21" r="2"/></svg>'
  },
  'trenitalia': {
    name:'Trenitalia', abbr:'Frecciarossa', color:'#cc0000',
    icon:'<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 18 L8 12 L26 12 Q30 12 30 15 L30 19 Q30 22 26 22 L3 22 Z"/><circle cx="8" cy="25" r="2"/><circle cx="24" cy="25" r="2"/></svg>'
  },
  'db': {
    name:'Deutsche Bahn', abbr:'ICE', color:'#c0392b',
    icon:'<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="11" width="26" height="11" rx="4"/><line x1="3" y1="16.5" x2="29" y2="16.5"/><circle cx="8" cy="22" r="2"/><circle cx="24" cy="22" r="2"/></svg>'
  },
  'ice': {
    name:'ICE', abbr:'DB', color:'#c0392b',
    icon:'<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 18 L10 12 L28 12 Q31 12 31 15 L31 19 Q31 22 28 22 L2 22 Z"/><circle cx="8" cy="25" r="2"/><circle cx="24" cy="25" r="2"/></svg>'
  },
  'jr': {
    name:'JR', abbr:'Shinkansen', color:'#0064b0',
    icon:'<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 18 Q5 11 16 11 L29 11 Q31 12 31 14 L31 19 Q31 21 29 21 L1 21 Z"/><circle cx="10" cy="24" r="2"/><circle cx="24" cy="24" r="2"/></svg>'
  },
  'shinkansen': {
    name:'Shinkansen', abbr:'JR', color:'#0064b0',
    icon:'<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 18 Q5 11 16 11 L29 11 Q31 12 31 14 L31 19 Q31 21 29 21 L1 21 Z"/><circle cx="10" cy="24" r="2"/><circle cx="24" cy="24" r="2"/></svg>'
  },
  'italo': {
    name:'Italo NTV', abbr:'NTV', color:'#e84118',
    icon:'<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="16" cy="16" rx="13" ry="7"/><line x1="3" y1="16" x2="29" y2="16"/><circle cx="8" cy="23" r="2"/><circle cx="24" cy="23" r="2"/></svg>'
  },
  'ouigo': {
    name:'Ouigo', abbr:'SNCF', color:'#e91e8c',
    icon:'<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="10" width="26" height="12" rx="6"/><line x1="3" y1="16" x2="29" y2="16"/><circle cx="9" cy="22" r="2"/><circle cx="23" cy="22" r="2"/></svg>'
  },
  'flixbus': {
    name:'FlixBus', abbr:'Bus', color:'#6ab04c',
    icon:'<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="10" width="28" height="14" rx="4"/><rect x="4" y="13" width="7" height="5" rx="1"/><rect x="13" y="13" width="7" height="5" rx="1"/><circle cx="8" cy="24" r="2"/><circle cx="24" cy="24" r="2"/></svg>'
  },
  'flixtr': {
    name:'FlixTrain', abbr:'FLX', color:'#6ab04c',
    icon:'<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="11" width="26" height="11" rx="4"/><line x1="3" y1="16.5" x2="29" y2="16.5"/><circle cx="8" cy="22" r="2"/><circle cx="24" cy="22" r="2"/></svg>'
  },
  'amtrak': {
    name:'Amtrak', abbr:'AMT', color:'#0066cc',
    icon:'<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="11" width="24" height="11" rx="4"/><line x1="4" y1="16.5" x2="28" y2="16.5"/><circle cx="9" cy="22" r="2"/><circle cx="23" cy="22" r="2"/></svg>'
  },
  'sbb': {
    name:'SBB / CFF', abbr:'IC', color:'#e30613',
    icon:'<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="10" width="26" height="12" rx="5"/><line x1="3" y1="16" x2="29" y2="16"/><circle cx="9" cy="22" r="2"/><circle cx="23" cy="22" r="2"/></svg>'
  },
  'cff': {
    name:'CFF / SBB', abbr:'IC', color:'#e30613',
    icon:'<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="10" width="26" height="12" rx="5"/><line x1="3" y1="16" x2="29" y2="16"/><circle cx="9" cy="22" r="2"/><circle cx="23" cy="22" r="2"/></svg>'
  },
};
