// ══════════════════════════════════════════════════════════════════════
// geo-defaults.js — Données géographiques statiques
// Yume Travel Manager · Phase A · Modularisation
//
// CONTENU : CITY_DATA · STATION_DATA · PAYS_SEED
// RÈGLE   : Ce fichier ne contient AUCUNE logique, AUCUNE fonction.
//           Les fonctions d'apprentissage (_acLearnCity, etc.) sont dans app.js.
//           Les fonctions de géocodage sont dans map-trip.js.
//
// DÉPENDANCES : aucune — chargé EN PREMIER dans index.html
// ══════════════════════════════════════════════════════════════════════

'use strict';

// ── §1 CITY_DATA ─────────────────────────────────────────────────────
// Dictionnaire ville → { pays, iata }
// Utilisé par : autocomplete vols, détection devise, carte monde
// Note : enrichi au runtime par _acLearnCity() via localStorage
// ─────────────────────────────────────────────────────────────────────
var CITY_DATA = {
  // France
  'Paris':      {pays:'France',     iata:'CDG'},
  'Lyon':       {pays:'France',     iata:'LYS'},
  'Marseille':  {pays:'France',     iata:'MRS'},
  'Nice':       {pays:'France',     iata:'NCE'},
  'Bordeaux':   {pays:'France',     iata:'BOD'},
  'Toulouse':   {pays:'France',     iata:'TLS'},
  'Strasbourg': {pays:'France',     iata:'SXB'},
  'Nantes':     {pays:'France',     iata:'NTE'},
  // Japon
  'Tokyo':          {pays:'Japon',iata:'NRT'},
  'Tokyo Haneda':   {pays:'Japon',iata:'HND'},
  'Tokyo Narita':   {pays:'Japon',iata:'NRT'},
  'Osaka':          {pays:'Japon',iata:'KIX'},
  'Osaka Itami':    {pays:'Japon',iata:'ITM'},
  'Kyoto':          {pays:'Japon',iata:'ITM'},
  'Nagoya':         {pays:'Japon',iata:'NGO'},
  'Sapporo':        {pays:'Japon',iata:'CTS'},
  'Sapporo Chitose':{pays:'Japon',iata:'CTS'},
  'Fukuoka':        {pays:'Japon',iata:'FUK'},
  'Hiroshima':      {pays:'Japon',iata:'HIJ'},
  'Naha (Okinawa)': {pays:'Japon',iata:'OKA'},
  'Sendai':         {pays:'Japon',iata:'SDJ'},
  'Kanazawa':       {pays:'Japon',iata:'KMQ'},
  'Nara':           {pays:'Japon',iata:'ITM'},
  'Kobe':           {pays:'Japon',iata:'ITM'},
  'Yokohama':       {pays:'Japon',iata:'HND'},
  'Kamakura':       {pays:'Japon',iata:'HND'},
  'Nagasaki':       {pays:'Japon',iata:'NGS'},
  'Hakodate':       {pays:'Japon',iata:'HKD'},
  'Ishigaki':       {pays:'Japon',iata:'ISG'},
  // USA
  'New York':   {pays:'États-Unis', iata:'JFK'},
  'Los Angeles':{pays:'États-Unis', iata:'LAX'},
  'Chicago':    {pays:'États-Unis', iata:'ORD'},
  'Miami':      {pays:'États-Unis', iata:'MIA'},
  'San Francisco':{pays:'États-Unis',iata:'SFO'},
  'Las Vegas':  {pays:'États-Unis', iata:'LAS'},
  'Boston':     {pays:'États-Unis', iata:'BOS'},
  'Seattle':    {pays:'États-Unis', iata:'SEA'},
  'Washington': {pays:'États-Unis', iata:'IAD'},
  'Dallas':     {pays:'États-Unis', iata:'DFW'},
  'Atlanta':    {pays:'États-Unis', iata:'ATL'},
  'Houston':    {pays:'États-Unis', iata:'IAH'},
  // UK
  'Londres':    {pays:'Royaume-Uni',iata:'LHR'},
  'Manchester': {pays:'Royaume-Uni',iata:'MAN'},
  'Édimbourg':  {pays:'Royaume-Uni',iata:'EDI'},
  // Espagne
  'Madrid':     {pays:'Espagne',    iata:'MAD'},
  'Barcelone':  {pays:'Espagne',    iata:'BCN'},
  'Séville':    {pays:'Espagne',    iata:'SVQ'},
  'Valence':    {pays:'Espagne',    iata:'VLC'},
  'Malaga':     {pays:'Espagne',    iata:'AGP'},
  'Palma':      {pays:'Espagne',    iata:'PMI'},
  // Italie
  'Rome':       {pays:'Italie',     iata:'FCO'},
  'Milan':      {pays:'Italie',     iata:'MXP'},
  'Venise':     {pays:'Italie',     iata:'VCE'},
  'Naples':     {pays:'Italie',     iata:'NAP'},
  'Florence':   {pays:'Italie',     iata:'FLR'},
  // Allemagne
  'Berlin':     {pays:'Allemagne',  iata:'BER'},
  'Munich':     {pays:'Allemagne',  iata:'MUC'},
  'Francfort':  {pays:'Allemagne',  iata:'FRA'},
  'Hambourg':   {pays:'Allemagne',  iata:'HAM'},
  'Düsseldorf': {pays:'Allemagne',  iata:'DUS'},
  // Pays-Bas
  'Amsterdam':  {pays:'Pays-Bas',   iata:'AMS'},
  // Belgique
  'Bruxelles':  {pays:'Belgique',   iata:'BRU'},
  // Suisse
  'Genève':     {pays:'Suisse',     iata:'GVA'},
  'Zurich':     {pays:'Suisse',     iata:'ZRH'},
  // Portugal
  'Lisbonne':   {pays:'Portugal',   iata:'LIS'},
  'Porto':      {pays:'Portugal',   iata:'OPO'},
  // Grèce
  'Athènes':    {pays:'Grèce',      iata:'ATH'},
  'Santorin':   {pays:'Grèce',      iata:'JTR'},
  // Turquie
  'Istanbul':   {pays:'Turquie',    iata:'IST'},
  'Ankara':     {pays:'Turquie',    iata:'ESB'},
  // Maroc
  'Marrakech':  {pays:'Maroc',      iata:'RAK'},
  'Casablanca': {pays:'Maroc',      iata:'CMN'},
  'Agadir':     {pays:'Maroc',      iata:'AGA'},
  'Fès':        {pays:'Maroc',      iata:'FEZ'},
  // Tunisie
  'Tunis':      {pays:'Tunisie',    iata:'TUN'},
  'Djerba':     {pays:'Tunisie',    iata:'DJE'},
  // Égypte
  'Le Caire':   {pays:'Égypte',     iata:'CAI'},
  'Hurghada':   {pays:'Égypte',     iata:'HRG'},
  'Charm el-Cheikh':{pays:'Égypte', iata:'SSH'},
  // Émirats
  'Dubaï':      {pays:'Émirats arabes unis',iata:'DXB'},
  'Abu Dhabi':  {pays:'Émirats arabes unis',iata:'AUH'},
  // Thaïlande
  'Bangkok':    {pays:'Thaïlande',  iata:'BKK'},
  'Phuket':     {pays:'Thaïlande',  iata:'HKT'},
  'Chiang Mai': {pays:'Thaïlande',  iata:'CNX'},
  // Singapour
  'Singapour':  {pays:'Singapour',  iata:'SIN'},
  // Malaisie
  'Kuala Lumpur':{pays:'Malaisie',  iata:'KUL'},
  // Indonésie
  'Bali':       {pays:'Indonésie',  iata:'DPS'},
  'Jakarta':    {pays:'Indonésie',  iata:'CGK'},
  // Vietnam
  'Hanoi':      {pays:'Vietnam',    iata:'HAN'},
  'Ho Chi Minh':{pays:'Vietnam',    iata:'SGN'},
  'Da Nang':    {pays:'Vietnam',    iata:'DAD'},
  // Cambodge
  'Phnom Penh': {pays:'Cambodge',   iata:'PNH'},
  'Siem Reap':  {pays:'Cambodge',   iata:'REP'},
  // Chine
  'Pékin':      {pays:'Chine',      iata:'PEK'},
  'Shanghai':   {pays:'Chine',      iata:'PVG'},
  'Guangzhou':  {pays:'Chine',      iata:'CAN'},
  'Hong Kong':  {pays:'Chine',      iata:'HKG'},
  // Corée du Sud
  'Séoul':      {pays:'Corée du Sud',iata:'ICN'},
  'Busan':      {pays:'Corée du Sud',iata:'PUS'},
  // Taïwan
  'Taipei':     {pays:'Taïwan',     iata:'TPE'},
  // Inde
  'Delhi':      {pays:'Inde',       iata:'DEL'},
  'Mumbai':     {pays:'Inde',       iata:'BOM'},
  'Bangalore':  {pays:'Inde',       iata:'BLR'},
  // Canada
  'Toronto':    {pays:'Canada',     iata:'YYZ'},
  'Vancouver':  {pays:'Canada',     iata:'YVR'},
  'Montréal':   {pays:'Canada',     iata:'YUL'},
  'Calgary':    {pays:'Canada',     iata:'YYC'},
  // Mexique
  'Mexico':     {pays:'Mexique',    iata:'MEX'},
  'Cancún':     {pays:'Mexique',    iata:'CUN'},
  // Brésil
  'São Paulo':  {pays:'Brésil',     iata:'GRU'},
  'Rio de Janeiro':{pays:'Brésil',  iata:'GIG'},
  // Argentine
  'Buenos Aires':{pays:'Argentine', iata:'EZE'},
  // Australie
  'Sydney':     {pays:'Australie',  iata:'SYD'},
  'Melbourne':  {pays:'Australie',  iata:'MEL'},
  'Brisbane':   {pays:'Australie',  iata:'BNE'},
  // Nouvelle-Zélande
  'Auckland':   {pays:'Nouvelle-Zélande',iata:'AKL'},
  // Scandinavie
  'Oslo':       {pays:'Norvège',    iata:'OSL'},
  'Stockholm':  {pays:'Suède',      iata:'ARN'},
  'Copenhague': {pays:'Danemark',   iata:'CPH'},
  'Helsinki':   {pays:'Finlande',   iata:'HEL'},
  'Reykjavik':  {pays:'Islande',    iata:'KEF'},
  // Europe Est
  'Varsovie':   {pays:'Pologne',    iata:'WAW'},
  'Prague':     {pays:'République Tchèque',iata:'PRG'},
  'Budapest':   {pays:'Hongrie',    iata:'BUD'},
  'Vienne':     {pays:'Autriche',   iata:'VIE'},
  'Bucarest':   {pays:'Roumanie',   iata:'OTP'},
  'Sofia':      {pays:'Bulgarie',   iata:'SOF'},
  'Zagreb':     {pays:'Croatie',    iata:'ZAG'},
  // Russie / CEI
  'Moscou':     {pays:'Russie',     iata:'SVO'},
  'Saint-Pétersbourg':{pays:'Russie',iata:'LED'},
  'Tbilissi':   {pays:'Géorgie',    iata:'TBS'},
  'Bakou':      {pays:'Azerbaïdjan',iata:'GYD'},
  'Erevan':     {pays:'Arménie',    iata:'EVN'},
  // Afrique
  'Nairobi':    {pays:'Kenya',      iata:'NBO'},
  'Le Cap':     {pays:'Afrique du Sud',iata:'CPT'},
  'Johannesburg':{pays:'Afrique du Sud',iata:'JNB'},
  'Lagos':      {pays:'Nigeria',    iata:'LOS'},
  'Accra':      {pays:'Ghana',      iata:'ACC'},
  'Dakar':      {pays:'Sénégal',    iata:'DSS'},
  'Addis-Abeba':{pays:'Éthiopie',   iata:'ADD'},
  'Kigali':     {pays:'Rwanda',     iata:'KGL'},
  // Moyen-Orient
  'Amman':      {pays:'Jordanie',   iata:'AMM'},
  'Beyrouth':   {pays:'Liban',      iata:'BEY'},
  'Tel Aviv':   {pays:'Israël',     iata:'TLV'},
  'Doha':       {pays:'Qatar',      iata:'DOH'},
  'Riyad':      {pays:'Arabie Saoudite',iata:'RUH'},
  'Mascate':    {pays:'Oman',       iata:'MCT'},
  // Népal / Sri Lanka
  'Katmandou':  {pays:'Népal',      iata:'KTM'},
  'Colombo':    {pays:'Sri Lanka',  iata:'CMB'},
};


// ── §2 STATION_DATA ───────────────────────────────────────────────────
// Dictionnaire gare → { pays, lat, lng }
// Utilisé par : autocomplete trains, tracé des routes ferroviaires
// Note : enrichi au runtime par _acLearnStation() via localStorage
// Résolution : ~90 grandes gares mondiales avec coordonnées GPS précises
// ─────────────────────────────────────────────────────────────────────
var STATION_DATA = {
  // ── France ──
  'Paris Gare du Nord':           {pays:'France',      lat:48.8809, lng:2.3553},
  'Paris Gare de Lyon':           {pays:'France',      lat:48.8448, lng:2.3735},
  'Paris Gare Montparnasse':      {pays:'France',      lat:48.8412, lng:2.3208},
  'Paris Gare de l\'Est':         {pays:'France',      lat:48.8768, lng:2.3590},
  'Paris Saint-Lazare':           {pays:'France',      lat:48.8760, lng:2.3250},
  'Paris Austerlitz':             {pays:'France',      lat:48.8420, lng:2.3649},
  'Lyon Part-Dieu':               {pays:'France',      lat:45.7604, lng:4.8597},
  'Lyon Perrache':                {pays:'France',      lat:45.7493, lng:4.8269},
  'Marseille Saint-Charles':      {pays:'France',      lat:43.3030, lng:5.3806},
  'Bordeaux Saint-Jean':          {pays:'France',      lat:44.8259, lng:-0.5563},
  'Lille-Flandres':               {pays:'France',      lat:50.6368, lng:3.0696},
  'Lille-Europe':                 {pays:'France',      lat:50.6389, lng:3.0756},
  'Strasbourg':                   {pays:'France',      lat:48.5852, lng:7.7346},
  'Nantes':                       {pays:'France',      lat:47.2175, lng:-1.5422},
  'Toulouse Matabiau':            {pays:'France',      lat:43.6115, lng:1.4537},
  'Nice Ville':                   {pays:'France',      lat:43.7043, lng:7.2619},
  'Montpellier Saint-Roch':       {pays:'France',      lat:43.6046, lng:3.8793},
  'Rennes':                       {pays:'France',      lat:48.1028, lng:-1.6722},
  'Grenoble':                     {pays:'France',      lat:45.1916, lng:5.7169},
  'Tours':                        {pays:'France',      lat:47.3879, lng:0.6909},
  'Dijon Ville':                  {pays:'France',      lat:47.3233, lng:5.0286},
  'Avignon TGV':                  {pays:'France',      lat:43.9213, lng:4.7806},
  'Aix-en-Provence TGV':          {pays:'France',      lat:43.4553, lng:5.3175},
  'Metz':                         {pays:'France',      lat:49.1096, lng:6.1763},
  'Nancy':                        {pays:'France',      lat:48.6894, lng:6.1734},
  'Reims':                        {pays:'France',      lat:49.2596, lng:4.0227},
  // ── Japon ──
  'Tokyo':                        {pays:'Japon',       lat:35.6812, lng:139.7671},
  'Tokyo Station':                {pays:'Japon',       lat:35.6812, lng:139.7671},
  'Shinjuku':                     {pays:'Japon',       lat:35.6896, lng:139.7006},
  'Shibuya':                      {pays:'Japon',       lat:35.6580, lng:139.7016},
  'Ueno':                         {pays:'Japon',       lat:35.7141, lng:139.7774},
  'Akihabara':                    {pays:'Japon',       lat:35.6982, lng:139.7731},
  'Shinagawa':                    {pays:'Japon',       lat:35.6284, lng:139.7387},
  'Osaka':                        {pays:'Japon',       lat:34.7024, lng:135.4959},
  'Osaka Station':                {pays:'Japon',       lat:34.7024, lng:135.4959},
  'Shin-Osaka':                   {pays:'Japon',       lat:34.7334, lng:135.4999},
  'Namba':                        {pays:'Japon',       lat:34.6631, lng:135.4997},
  'Tennoji':                      {pays:'Japon',       lat:34.6474, lng:135.5161},
  'Kyoto':                        {pays:'Japon',       lat:34.9858, lng:135.7588},
  'Kyoto Station':                {pays:'Japon',       lat:34.9858, lng:135.7588},
  'Nagoya':                       {pays:'Japon',       lat:35.1707, lng:136.8816},
  'Nagoya Station':               {pays:'Japon',       lat:35.1707, lng:136.8816},
  'Hiroshima':                    {pays:'Japon',       lat:34.3973, lng:132.4756},
  'Hiroshima Station':            {pays:'Japon',       lat:34.3973, lng:132.4756},
  'Hakata (Fukuoka)':             {pays:'Japon',       lat:33.5899, lng:130.4209},
  'Hakata':                       {pays:'Japon',       lat:33.5899, lng:130.4209},
  'Fukuoka':                      {pays:'Japon',       lat:33.5899, lng:130.4209},
  'Nagasaki':                     {pays:'Japon',       lat:32.9000, lng:129.8700},
  'Nagasaki Station':             {pays:'Japon',       lat:32.9000, lng:129.8700},
  'Kumamoto':                     {pays:'Japon',       lat:32.7898, lng:130.7418},
  'Kumamoto Station':             {pays:'Japon',       lat:32.7898, lng:130.7418},
  'Kagoshima-Chuo':               {pays:'Japon',       lat:31.5786, lng:130.5395},
  'Beppu':                        {pays:'Japon',       lat:33.2825, lng:131.4924},
  'Oita':                         {pays:'Japon',       lat:33.1965, lng:131.5997},
  'Miyazaki':                     {pays:'Japon',       lat:31.9130, lng:131.4209},
  'Okayama':                      {pays:'Japon',       lat:34.6668, lng:133.9168},
  'Okayama Station':              {pays:'Japon',       lat:34.6668, lng:133.9168},
  'Takamatsu':                    {pays:'Japon',       lat:34.3481, lng:134.0488},
  'Matsuyama':                    {pays:'Japon',       lat:33.8416, lng:132.7659},
  'Kochi':                        {pays:'Japon',       lat:33.5559, lng:133.5436},
  'Sapporo':                      {pays:'Japon',       lat:43.0686, lng:141.3507},
  'Sapporo Station':              {pays:'Japon',       lat:43.0686, lng:141.3507},
  'Hakodate':                     {pays:'Japon',       lat:41.7739, lng:140.7277},
  'Asahikawa':                    {pays:'Japon',       lat:43.7726, lng:142.3648},
  'Sendai':                       {pays:'Japon',       lat:38.2602, lng:140.8826},
  'Sendai Station':               {pays:'Japon',       lat:38.2602, lng:140.8826},
  'Morioka':                      {pays:'Japon',       lat:39.7017, lng:141.1527},
  'Aomori':                       {pays:'Japon',       lat:40.8225, lng:140.7483},
  'Kanazawa':                     {pays:'Japon',       lat:36.5784, lng:136.6480},
  'Kanazawa Station':             {pays:'Japon',       lat:36.5784, lng:136.6480},
  'Toyama':                       {pays:'Japon',       lat:36.7057, lng:137.2135},
  'Fukui':                        {pays:'Japon',       lat:36.0616, lng:136.2228},
  'Nara':                         {pays:'Japon',       lat:34.6851, lng:135.8048},
  'Nara Station':                 {pays:'Japon',       lat:34.6851, lng:135.8048},
  'Wakayama':                     {pays:'Japon',       lat:34.2261, lng:135.1675},
  'Kobe':                         {pays:'Japon',       lat:34.6939, lng:135.1956},
  'Kobe Sannomiya':               {pays:'Japon',       lat:34.6939, lng:135.1956},
  'Himeji':                       {pays:'Japon',       lat:34.8267, lng:134.6916},
  'Yokohama':                     {pays:'Japon',       lat:35.4660, lng:139.6229},
  'Yokohama Station':             {pays:'Japon',       lat:35.4660, lng:139.6229},
  'Kamakura':                     {pays:'Japon',       lat:35.3192, lng:139.5510},
  'Kamakura Station':             {pays:'Japon',       lat:35.3192, lng:139.5510},
  'Atami':                        {pays:'Japon',       lat:35.1020, lng:139.0736},
  'Mishima':                      {pays:'Japon',       lat:35.1211, lng:138.9102},
  'Shizuoka':                     {pays:'Japon',       lat:34.9757, lng:138.3826},
  'Hamamatsu':                    {pays:'Japon',       lat:34.7034, lng:137.7338},
  'Matsumoto':                    {pays:'Japon',       lat:36.2279, lng:137.9677},
  'Nagano':                       {pays:'Japon',       lat:36.6478, lng:138.1885},
  'Nagano Station':               {pays:'Japon',       lat:36.6478, lng:138.1885},
  'Niigata':                      {pays:'Japon',       lat:37.9160, lng:139.0592},
  'Niigata Station':              {pays:'Japon',       lat:37.9160, lng:139.0592},
  // ── Corée du Sud ──
  'Seoul Station':                {pays:'Corée',       lat:37.5547, lng:126.9707},
  'Seoul Yongsan':                {pays:'Corée',       lat:37.5297, lng:126.9647},
  'Seoul Suseo':                  {pays:'Corée',       lat:37.4849, lng:127.1151},
  'Busan Station':                {pays:'Corée',       lat:35.1150, lng:129.0422},
  'Daegu Station':                {pays:'Corée',       lat:35.8766, lng:128.6262},
  'Gyeongju':                     {pays:'Corée',       lat:35.8563, lng:129.2249},
  // ── Espagne ──
  'Madrid Atocha':                {pays:'Espagne',     lat:40.4068, lng:-3.6892},
  'Madrid Chamartín':             {pays:'Espagne',     lat:40.4724, lng:-3.6821},
  'Barcelona Sants':              {pays:'Espagne',     lat:41.3792, lng:2.1400},
  'Barcelona Passeig de Gràcia':  {pays:'Espagne',     lat:41.3916, lng:2.1700},
  'Sevilla Santa Justa':          {pays:'Espagne',     lat:37.3926, lng:-5.9762},
  'Valencia Joaquín Sorolla':     {pays:'Espagne',     lat:39.4658, lng:-0.3778},
  'Málaga María Zambrano':        {pays:'Espagne',     lat:36.7140, lng:-4.4290},
  // ── Italie ──
  'Roma Termini':                 {pays:'Italie',      lat:41.9006, lng:12.5006},
  'Roma Tiburtina':               {pays:'Italie',      lat:41.9100, lng:12.5370},
  'Milano Centrale':              {pays:'Italie',      lat:45.4860, lng:9.2045},
  'Milano Garibaldi':             {pays:'Italie',      lat:45.4849, lng:9.1871},
  'Venezia Santa Lucia':          {pays:'Italie',      lat:45.4413, lng:12.3211},
  'Firenze Santa Maria Novella':  {pays:'Italie',      lat:43.7763, lng:11.2480},
  'Napoli Centrale':              {pays:'Italie',      lat:40.8529, lng:14.2727},
  'Bologna Centrale':             {pays:'Italie',      lat:44.5058, lng:11.3431},
  'Torino Porta Nuova':           {pays:'Italie',      lat:45.0607, lng:7.6784},
  // ── Allemagne ──
  'Berlin Hauptbahnhof':          {pays:'Allemagne',   lat:52.5250, lng:13.3690},
  'Berlin Ostbahnhof':            {pays:'Allemagne',   lat:52.5106, lng:13.4340},
  'München Hauptbahnhof':         {pays:'Allemagne',   lat:48.1403, lng:11.5580},
  'Hamburg Hauptbahnhof':         {pays:'Allemagne',   lat:53.5530, lng:10.0062},
  'Frankfurt Hauptbahnhof':       {pays:'Allemagne',   lat:50.1069, lng:8.6632},
  'Köln Hauptbahnhof':            {pays:'Allemagne',   lat:50.9432, lng:6.9590},
  'Stuttgart Hauptbahnhof':       {pays:'Allemagne',   lat:48.7841, lng:9.1827},
  'Düsseldorf Hauptbahnhof':      {pays:'Allemagne',   lat:51.2198, lng:6.7940},
  // ── Royaume-Uni ──
  'London St Pancras':            {pays:'Royaume-Uni', lat:51.5308, lng:-0.1238},
  'London Euston':                {pays:'Royaume-Uni', lat:51.5281, lng:-0.1335},
  'London Waterloo':              {pays:'Royaume-Uni', lat:51.5036, lng:-0.1134},
  'London Victoria':              {pays:'Royaume-Uni', lat:51.4952, lng:-0.1439},
  'London King\'s Cross':         {pays:'Royaume-Uni', lat:51.5308, lng:-0.1238},
  'London Paddington':            {pays:'Royaume-Uni', lat:51.5154, lng:-0.1755},
  'Edinburgh Waverley':           {pays:'Royaume-Uni', lat:55.9521, lng:-3.1900},
  'Manchester Piccadilly':        {pays:'Royaume-Uni', lat:53.4774, lng:-2.2309},
  'Birmingham New Street':        {pays:'Royaume-Uni', lat:52.4778, lng:-1.9001},
  // ── Belgique / Pays-Bas / Suisse ──
  'Bruxelles-Midi':               {pays:'Belgique',    lat:50.8360, lng:4.3362},
  'Bruxelles-Central':            {pays:'Belgique',    lat:50.8452, lng:4.3569},
  'Amsterdam Centraal':           {pays:'Pays-Bas',    lat:52.3791, lng:4.9003},
  'Rotterdam Centraal':           {pays:'Pays-Bas',    lat:51.9249, lng:4.4694},
  'Zürich Hauptbahnhof':          {pays:'Suisse',      lat:47.3783, lng:8.5402},
  'Genève Cornavin':              {pays:'Suisse',      lat:46.2101, lng:6.1422},
  'Lausanne':                     {pays:'Suisse',      lat:46.5168, lng:6.6287},
  'Bern':                         {pays:'Suisse',      lat:46.9488, lng:7.4397},
  'Basel SBB':                    {pays:'Suisse',      lat:47.5477, lng:7.5894},
  // ── Autriche / République Tchèque ──
  'Wien Hauptbahnhof':            {pays:'Autriche',    lat:48.1851, lng:16.3760},
  'Wien Meidling':                {pays:'Autriche',    lat:48.1747, lng:16.3340},
  'Salzburg Hauptbahnhof':        {pays:'Autriche',    lat:47.8124, lng:13.0453},
  'Praha Hlavní Nádraží':         {pays:'Tchéquie',    lat:50.0831, lng:14.4353},
  // ── Portugal ──
  'Lisboa Santa Apolónia':        {pays:'Portugal',    lat:38.7133, lng:-9.1195},
  'Lisboa Oriente':               {pays:'Portugal',    lat:38.7684, lng:-9.0989},
  'Porto Campanhã':               {pays:'Portugal',    lat:41.1477, lng:-8.5860},
  // ── USA ──
  'New York Penn Station':        {pays:'USA',         lat:40.7506, lng:-73.9935},
  'New York Grand Central':       {pays:'USA',         lat:40.7527, lng:-73.9772},
  'Washington Union Station':     {pays:'USA',         lat:38.8975, lng:-77.0069},
  'Chicago Union Station':        {pays:'USA',         lat:41.8786, lng:-87.6398},
  'Los Angeles Union Station':    {pays:'USA',         lat:34.0561, lng:-118.2363},
  'Boston South Station':         {pays:'USA',         lat:42.3519, lng:-71.0552},
  // ── Canada ──
  'Toronto Union Station':        {pays:'Canada',      lat:43.6454, lng:-79.3806},
  'Montréal Central':             {pays:'Canada',      lat:45.4997, lng:-73.5688},
};


// ── §3 PAYS_SEED ──────────────────────────────────────────────────────
// Liste de référence pour l'autocomplete pays
// Utilisé par : formulaire nouveau voyage, filtres, détection devise
// Note : enrichi au runtime par addKnownCountry() via localStorage
// ─────────────────────────────────────────────────────────────────────
var PAYS_SEED = [
  'Afghanistan','Afrique du Sud','Albanie','Algérie','Allemagne','Angola','Arabie Saoudite',
  'Argentine','Arménie','Australie','Autriche','Azerbaïdjan','Bangladesh','Belgique','Bénin',
  'Birmanie','Bolivie','Bosnie-Herzégovine','Brésil','Bulgarie','Burkina Faso','Cambodge',
  'Cameroun','Canada','Chili','Chine','Colombie','Congo','Corée du Sud','Corée du Nord',
  'Costa Rica','Côte d\'Ivoire','Croatie','Cuba','Danemark','Égypte','Émirats arabes unis',
  'Équateur','Espagne','Estonie','États-Unis','Éthiopie','Finlande','France','Géorgie',
  'Ghana','Grèce','Guatemala','Haïti','Hongrie','Inde','Indonésie','Irak','Iran','Irlande',
  'Islande','Israël','Italie','Jamaïque','Japon','Jordanie','Kazakhstan','Kenya','Laos',
  'Lettonie','Liban','Lituanie','Luxembourg','Madagascar','Malaisie','Mali','Maroc','Mexique',
  'Moldavie','Mongolie','Monténégro','Mozambique','Namibie','Népal','Nigeria','Norvège',
  'Nouvelle-Zélande','Oman','Ouganda','Ouzbékistan','Pakistan','Panama','Paraguay','Pays-Bas',
  'Pérou','Philippines','Pologne','Portugal','Qatar','République Dominicaine','Roumanie',
  'Royaume-Uni','Russie','Rwanda','Sénégal','Serbie','Singapour','Slovaquie','Slovénie',
  'Somalie','Soudan','Sri Lanka','Suède','Suisse','Syrie','Taïwan','Tanzanie','Thaïlande',
  'Togo','Tunisie','Turquie','Ukraine','Uruguay','Venezuela','Vietnam','Yémen','Zimbabwe'
];
