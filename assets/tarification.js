// Grille tarifaire d'un modèle (fiche modèle du back-office).
//
// Le prix par jour dépend de la durée totale de la location (tranche) :
//   1 à 7 jours   → prixJour (prix de la 1re semaine, celui affiché sur le site)
//   8 à 15 jours  → prix15j
//   16 à 30 jours → prixMois
//   plus de 30 j  → prixPlusMois
// Une tranche laissée vide reprend le prix de la tranche précédente.
// Chaque jour est ensuite multiplié par le coefficient de son mois
// (coefMois : 12 nombres, janvier en premier, 1 par défaut).
// Prix de la location = somme, jour par jour, de prix de la tranche × coefficient du mois du jour.

export const TRANCHES = [
  { champ: "prixJour", min: 1, max: 7, libelle: "1re semaine (1 à 7 jours)" },
  { champ: "prix15j", min: 8, max: 15, libelle: "15 jours (8 à 15 jours)" },
  { champ: "prixMois", min: 16, max: 30, libelle: "1 mois (16 à 30 jours)" },
  { champ: "prixPlusMois", min: 31, max: Infinity, libelle: "Au-delà d'1 mois (31 jours et plus)" },
];
export const MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

const positif = (x) => { const n = Number(x); return x !== "" && x != null && Number.isFinite(n) && n > 0 ? n : 0; };
const arrondi = (n) => Math.round(n * 100) / 100;

// Nombre de jours facturés : chaque tranche de 24 h entamée compte (1 jour au minimum).
export function nombreJours(depart, retour) {
  const ms = new Date(retour) - new Date(depart);
  return Number.isFinite(ms) ? Math.max(1, Math.ceil(ms / 86400000)) : 1;
}

// Prix par jour de la tranche correspondant à la durée totale.
export function prixTranche(modele, jours) {
  let prix = 0;
  for (const t of TRANCHES) {
    prix = positif(modele && modele[t.champ]) || prix;
    if (jours <= t.max) break;
  }
  return prix;
}

export function coefficient(modele, mois) {
  const c = modele && Array.isArray(modele.coefMois) ? positif(modele.coefMois[mois]) : 0;
  return c || 1;
}

// Prix d'une location : { total, jours, prixJour, lignes } où lignes regroupe les
// jours de même prix ({ jours, prix, coef, mois: [numéros des mois] }) pour le contrat et la facture.
// total = 0 si le modèle n'a pas de prix.
export function prixLocation(modele, depart, retour) {
  const jours = nombreJours(depart, retour);
  const prixJour = prixTranche(modele, jours);
  const debut = new Date(String(depart || "").slice(0, 10) + "T00:00:00Z");
  const lignes = [];
  let total = 0;
  for (let i = 0; i < jours; i++) {
    const mois = Number.isFinite(debut.getTime()) ? new Date(debut.getTime() + i * 86400000).getUTCMonth() : 0;
    const coef = Number.isFinite(debut.getTime()) ? coefficient(modele, mois) : 1;
    const prix = arrondi(prixJour * coef);
    total += prix;
    const ligne = lignes.find((l) => l.prix === prix && l.coef === coef);
    if (!ligne) lignes.push({ jours: 1, prix, coef, mois: [mois] });
    else { ligne.jours++; if (!ligne.mois.includes(mois)) ligne.mois.push(mois); }
  }
  return { total: arrondi(total), jours, prixJour, lignes };
}

// Texte court expliquant le calcul : « 5 j × 290 MAD + 2 j × 580 MAD (décembre ×2) ».
export function detailPrix({ lignes }) {
  return lignes.map((l) => `${l.jours} j × ${l.prix.toLocaleString("fr-FR")} MAD${l.coef !== 1 ? ` (${libelleCoef(l)})` : ""}`).join(" + ");
}
// « décembre ×2 », « juillet, août ×1,5 »
export const libelleCoef = (l) => `${l.mois.map((m) => MOIS[m].toLowerCase()).join(", ")} ×${String(l.coef).replace(".", ",")}`;

// Le modèle a-t-il une grille au-delà du simple prix par jour ?
export const grilleRenseignee = (m) => !!m && (TRANCHES.slice(1).some((t) => positif(m[t.champ])) || (Array.isArray(m.coefMois) && m.coefMois.some((c) => positif(c) && Number(c) !== 1)));
