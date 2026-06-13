// ══════════════════════════════════════════════════════════════════════
// inspiration-images.js — Configuration des images d'inspiration (ADMIN)
// Yume Travel Manager
//
// ░░ CE FICHIER EST RÉSERVÉ À L'ADMINISTRATEUR (toi) ░░
// L'utilisateur final n'a aucun moyen de modifier ces images depuis
// l'interface : elles sont définies ici, dans le code, une fois pour
// toutes. Pour ajouter / changer une destination, édite ce fichier.
//
// ── COMMENT AJOUTER DES IMAGES ────────────────────────────────────────
//   1. Dépose tes fichiers dans :  images/<Pays>/<nom-image>.jpg
//        ex :  images/Japon/tokyo.jpg
//              images/Japon/fuji.jpg
//              images/Corée du Sud/seoul.jpg
//      (formats conseillés : .jpg ou .webp, ~1200×800 px, < 300 Ko)
//
//   2. Déclare-les ci-dessous dans YUME_INSPIRATION. Chaque entrée :
//        { country:'Japon',  label:'Japon',
//          images:['images/Japon/tokyo.jpg','images/Japon/fuji.jpg'] }
//
//   3. C'est tout. Le carrousel défile automatiquement en bas de
//      l'accueil. Si une image est introuvable, elle est simplement
//      ignorée (aucune image cassée affichée).
//
// ── NOTE ──────────────────────────────────────────────────────────────
//   Les chemins sont relatifs à index.html. Les espaces dans les noms
//   de pays sont autorisés (« Corée du Sud »), le navigateur les gère.
//   Tu peux aussi pointer vers des URL distantes (https://…) si tu
//   préfères héberger les images ailleurs.
// ══════════════════════════════════════════════════════════════════════

window.YUME_INSPIRATION = [

  // ░░ EXEMPLES — remplace les chemins par tes vraies images ░░
  {
    country: 'Japon',
    label:   'Japon',
    images: [
      'images/Japon/1.jpg',
      'images/Japon/2.jpg',
      'images/Japon/3.jpg',
      'images/Japon/4.jpg',
      'images/Japon/5.jpg',
      'images/Japon/6.jpg',
      'images/Japon/7.jpg',
      'images/Japon/8.jpg',
      'images/Japon/9.jpg',
      'images/Japon/10.jpg'
    ]
  },
  {
    country: 'Corée du Sud',
    label:   'Corée du Sud',
    images: [
      'images/Corée du Sud/1.jpg',
      'images/Corée du Sud/2.jpg',
      'images/Corée du Sud/3.jpg',
      'images/Corée du Sud/4.jpg',
      'images/Corée du Sud/5.jpg',
      'images/Corée du Sud/6.jpg',
      'images/Corée du Sud/7.jpg',
      'images/Corée du Sud/8.jpg',
      'images/Corée du Sud/9.jpg',
      'images/Corée du Sud/10.jpg'
    ]
  },
  {
    country: 'Taïwan',
    label:   'Taïwan',
    images: [
      'images/Taïwan/1.jpg',
      'images/Taïwan/2.jpg',
      'images/Taïwan/3.jpg',
      'images/Taïwan/4.jpg',
      'images/Taïwan/5.jpg',
      'images/Taïwan/6.jpg',
      'images/Taïwan/7.jpg',
      'images/Taïwan/8.jpg',
      'images/Taïwan/9.jpg',
      'images/Taïwan/10.jpg'
    ]
  },
  {
    country: 'Vietnam',
    label:   'Vietnam',
    images: [
      'images/Vietnam/1.jpg',
      'images/Vietnam/2.jpg',
      'images/Vietnam/3.jpg',
      'images/Vietnam/4.jpg',
      'images/Vietnam/5.jpg',
      'images/Vietnam/6.jpg',
      'images/Vietnam/7.jpg',
      'images/Vietnam/8.jpg',
      'images/Vietnam/9.jpg',
      'images/Vietnam/10.jpg'
    ]
  },
  {
    country: 'France',
    label:   'France',
    images: [
      'images/France/1.jpg',
      'images/France/2.jpg',
      'images/France/3.jpg',
      'images/France/4.jpg',
      'images/France/5.jpg',
      'images/France/6.jpg',
      'images/France/7.jpg',
      'images/France/8.jpg',
      'images/France/9.jpg',
      'images/France/10.jpg'
    ]
  }

  // Ajoute autant de pays que tu veux sur ce modèle, séparés par des virgules.
  // ,{ country:'Thaïlande', label:'Thaïlande', images:['images/Thaïlande/1.jpg'] }

];
