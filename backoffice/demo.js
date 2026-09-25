// Flotte de démonstration : une cinquantaine de véhicules fictifs (avec leur
// historique d'entretien) pour essayer le back-office, et quatre modèles de
// prestige (Bentley, Rolls-Royce) dont la photo vient de Wikimedia Commons,
// sous licence libre, avec son crédit.
//
// Les véhicules et interventions créés ici portent source: "demo" et se
// suppriment d'un clic. Les modèles, eux, restent (masqués du site tant que
// « Afficher sur le site » n'est pas coché).
import { creerDocument, corrigerDocument, supprimerDocument } from "../assets/firestore-rest.js";
import {
  etat, jeton, MODELES, synchroniserModeles, majDisponibilite, cleImmat, aujourdhuiISO, decalerJours,
} from "./commun.js";
import { preparerPhoto } from "./modeles.js";

const MODELES_PRESTIGE = [
  {
    id: "veh-bentley-continental-gtc", marque: "Bentley", modele: "Continental GTC", type: "Luxe & sport", categorie: "Exception",
    places: 4, portes: 2, bagages: 2, carburant: "Essence", boite: "Automatique", prixJour: 8500, kmSup: 15, caution: 100000,
    description: "Cabriolet grand tourisme 4 places, essence, boîte automatique.",
    photos: ["Bentley_Continental_GTC_(3rd_gen.)_1X7A0302.jpg", "Bentley_Continental_GTC_(3rd_gen.)_IMG_2923.jpg", "Bentley_Continental_GTC_Genf_2019_1Y7A5017.jpg"],
  },
  {
    id: "veh-bentley-bentayga", marque: "Bentley", modele: "Bentayga", type: "SUV", categorie: "Exception",
    places: 5, portes: 5, bagages: 4, carburant: "Essence", boite: "Automatique", prixJour: 9000, kmSup: 15, caution: 100000,
    description: "SUV de prestige 5 places, essence, boîte automatique.",
    photos: ["Bentley_Bentayga_V8_(FL)_IMG_0005.jpg", "Bentley_Bentayga_(FL)_IMG_4168.jpg", "Bentley_Bentayga_(51169720748).jpg"],
  },
  {
    id: "veh-bentley-flying-spur", marque: "Bentley", modele: "Flying Spur", type: "Berline", categorie: "Exception",
    places: 5, portes: 4, bagages: 3, carburant: "Essence", boite: "Automatique", prixJour: 9500, kmSup: 15, caution: 100000,
    description: "Grande berline de prestige 5 places, essence, boîte automatique.",
    photos: ["Bentley_Flying_Spur_Hybrid_(2019)_1X7A0300.jpg", "Bentley_Flying_Spur_V8_(2019)_IMG_0020.jpg", "2019_Bentley_Flying_Spur_W12_Front.jpg"],
  },
  {
    id: "veh-rolls-royce-cullinan", marque: "Rolls-Royce", modele: "Cullinan", type: "SUV", categorie: "Exception",
    places: 5, portes: 5, bagages: 4, carburant: "Essence", boite: "Automatique", prixJour: 18000, kmSup: 25, caution: 200000,
    description: "SUV d'exception 5 places, V12 essence, boîte automatique.",
    photos: ["Rolls-Royce_Cullinan_Top_Marques_2019_IMG_1058.jpg", "2019_Rolls-Royce_Cullinan_V12_Automatic_6.75_Front.jpg", "Rolls-Royce_Cullinan_Blue_(1).jpg"],
  },
];

// Nombre de véhicules fictifs par modèle (50 au total) et couleurs possibles.
const REPARTITION = [
  ["veh-dacia-logan", 8, ["Blanc", "Gris platine", "Noir"]],
  ["veh-golf-8", 6, ["Blanc", "Gris", "Bleu"]],
  ["veh-hyundai-tucson", 6, ["Blanc", "Noir", "Gris"]],
  ["veh-mercedes-classe-e", 5, ["Noir", "Gris sélénite", "Blanc"]],
  ["veh-range-rover-sport", 4, ["Noir", "Blanc", "Gris Carpathian"]],
  ["veh-mercedes-classe-v", 4, ["Noir", "Gris"]],
  ["veh-renault-master", 4, ["Blanc"]],
  ["veh-porsche-911", 2, ["Rouge Carmin", "Gris craie"]],
  ["veh-bentley-continental-gtc", 3, ["Blanc Glacier", "Bleu Portofino", "Noir Onyx"]],
  ["veh-bentley-bentayga", 3, ["Noir Beluga", "Blanc Glacier", "Vert Verdant"]],
  ["veh-bentley-flying-spur", 3, ["Gris Moonbeam", "Noir Onyx", "Bleu Marlin"]],
  ["veh-rolls-royce-cullinan", 2, ["Noir Diamant", "Blanc Arctique"]],
];
const GARAGES = ["Garage Atlas Auto, Casablanca", "Pneus Service Maârif", "Centre Auto Ain Sebaâ", "Garage Prestige Bouskoura"];
const LETTRES = ["A", "B", "D", "H", "W"];
const REGIONS = [1, 6, 6, 6, 26, 33, 40, 48];

export const estDemo = (x) => x.source === "demo";

// Tirages pseudo-aléatoires reproductibles : même flotte à chaque chargement.
function hasard(graine) {
  let a = graine;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Photo libre de droits depuis Wikimedia Commons (appel fait par le navigateur).
async function photoCommons(fichiers) {
  const texte = (html) => new DOMParser().parseFromString(String(html || ""), "text/html").body.textContent.trim().replace(/\s+/g, " ");
  for (const f of fichiers) {
    try {
      const api = "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&prop=imageinfo"
        + "&iiprop=url|extmetadata&iiurlwidth=1280&iiextmetadatafilter=Artist|LicenseShortName&titles=" + encodeURIComponent("File:" + f);
      const page = Object.values((await (await fetch(api)).json()).query.pages)[0];
      const info = page.imageinfo && page.imageinfo[0];
      if (!info) continue;
      const licence = texte(info.extmetadata?.LicenseShortName?.value);
      if (!/^(CC[ -]?BY|CC0|Public domain)/i.test(licence)) continue; // uniquement des photos réutilisables
      const auteur = texte(info.extmetadata?.Artist?.value).slice(0, 80);
      const reponse = await fetch(info.thumburl || info.url);
      if (!reponse.ok) continue;
      const photo = await preparerPhoto(await reponse.blob());
      return { ...photo, credit: `Photo ${auteur || "Wikimedia Commons"}, ${licence}`, source: info.descriptionurl || "" };
    } catch {
      // photo suivante
    }
  }
  return null;
}

async function creerModelesPrestige(etatEl) {
  const sansPhoto = [];
  for (const [i, base] of MODELES_PRESTIGE.entries()) {
    if (etat.donnees.modeles.some((m) => m.id === base.id)) continue;
    etatEl.textContent = `Création du modèle ${base.marque} ${base.modele} et recherche de sa photo…`;
    const { id, photos, ...champs } = base;
    const photo = await photoCommons(photos);
    if (!photo) sansPhoto.push(`${base.marque} ${base.modele}`);
    const maintenant = new Date();
    const donnees = {
      ...champs, nom: `${base.marque} ${base.modele}`, visible: false, ordre: 9 + i, creeLe: maintenant, modifieLe: maintenant,
      ...(photo ? { vignette: photo.vignette, photoMaj: maintenant, photoCredit: photo.credit, photoSource: photo.source } : {}),
    };
    let cree;
    try {
      cree = await creerDocument("modeles", donnees, { ...jeton(), id });
    } catch (e) {
      if (e.status !== 409) throw e;
      continue; // créé entre-temps depuis un autre poste
    }
    if (photo) await corrigerDocument(`modeles/${id}/medias`, "photo", { image: photo.image, modifieLe: maintenant }, jeton());
    etat.donnees.modeles.push(cree);
  }
  synchroniserModeles();
  return sansPhoto;
}

function genererVehicules() {
  const alea = hasard(2026);
  const choisir = (liste) => liste[Math.floor(alea() * liste.length)];
  const entre = (min, max) => min + Math.floor(alea() * (max - min + 1));
  const aujourdhui = aujourdhuiISO();
  const prises = new Set(etat.donnees.vehicules.map((v) => cleImmat(v.immatriculation)));
  const vehicules = [];
  let n = 0;
  for (const [modele, nombre, couleurs] of REPARTITION) {
    if (!MODELES[modele]) continue;
    const prestige = MODELES[modele].categorie === "Exception";
    for (let k = 0; k < nombre; k++, n++) {
      let immatriculation;
      do immatriculation = `${entre(10000, 99999)}-${choisir(LETTRES)}-${choisir(REGIONS)}`;
      while (prises.has(cleImmat(immatriculation)));
      prises.add(cleImmat(immatriculation));
      const annee = entre(2021, 2025);
      const kmActuel = prestige ? entre(3000, 35000) : entre(8000, 140000);
      // quelques échéances proches ou dépassées pour voir les alertes
      const assurance = n % 13 === 4 ? decalerJours(aujourdhui, -6) : n % 9 === 2 ? decalerJours(aujourdhui, 18) : decalerJours(aujourdhui, entre(40, 330));
      const visiteTechnique = n % 11 === 7 ? decalerJours(aujourdhui, 12) : decalerJours(aujourdhui, entre(60, 700));
      let statut = "Disponible", disponibleLe = "";
      if (n % 5 === 1) statut = "En circulation";
      if ([6, 23, 38].includes(n)) { statut = "En réparation"; disponibleLe = decalerJours(aujourdhui, entre(2, 12)); }
      if (n === 31) { statut = "En réparation"; disponibleLe = decalerJours(aujourdhui, -2); } // retour dépassé
      if (n === 44) statut = "Hors service";
      vehicules.push({
        immatriculation, modele, couleur: choisir(couleurs), annee, carburant: MODELES[modele].carburant || "", kmActuel,
        chassis: `DEMO${String(annee).slice(2)}${String(n + 1).padStart(3, "0")}${Math.floor(alea() * 1e8).toString().padStart(8, "0")}`.slice(0, 17),
        statut, disponibleLe, assurance, visiteTechnique, vignette: `${new Date().getFullYear() + (alea() < 0.95 ? 1 : 0)}-01-31`,
        intervalleVidangeKm: prestige ? 15000 : 10000, intervallePneusKm: prestige ? 30000 : 40000,
        notes: "Véhicule fictif (flotte de démonstration).",
        _entretien: {
          vidangeKm: Math.max(Math.round(kmActuel * 0.3), kmActuel - (n % 7 === 3 ? entre(10200, 12500) : n % 6 === 0 ? entre(9100, 9900) : entre(800, 8000))),
          pneusKm: kmActuel > 30000 && n % 4 === 0 ? kmActuel - entre(5000, 38000) : null,
          garage: choisir(GARAGES),
          cout: prestige ? entre(4500, 9000) : entre(450, 1400),
          jours: entre(15, 200),
        },
      });
    }
  }
  return vehicules;
}

// Crée les modèles de prestige manquants puis les véhicules fictifs et leur
// historique d'entretien. Renvoie le message à afficher.
export async function chargerDemo(etatEl) {
  const sansPhoto = await creerModelesPrestige(etatEl);
  const aujourdhui = aujourdhuiISO();
  const liste = genererVehicules();
  let faits = 0;
  for (const { _entretien: e, ...vehicule } of liste) {
    etatEl.textContent = `Création des véhicules fictifs… ${faits + 1} / ${liste.length}`;
    const cree = await creerDocument("vehicules", { ...vehicule, source: "demo", creeLe: new Date() }, jeton());
    etat.donnees.vehicules.push(cree);
    const interventions = [{
      type: "Vidange", statut: "Terminée", date: decalerJours(aujourdhui, -e.jours), km: e.vidangeKm, garage: e.garage, cout: e.cout,
      description: "Vidange moteur, filtres à huile et à air.",
    }];
    if (e.pneusKm) interventions.push({
      type: "Pneus", statut: "Terminée", date: decalerJours(aujourdhui, -e.jours - 90), km: e.pneusKm, garage: "Pneus Service Maârif",
      cout: MODELES[vehicule.modele].categorie === "Exception" ? 14000 : 2400, description: "4 pneus neufs, équilibrage et parallélisme.",
    });
    if (vehicule.statut === "En réparation") interventions.push({
      type: "Réparation", statut: "En cours", date: decalerJours(aujourdhui, -3), km: vehicule.kmActuel, garage: e.garage, cout: 3500,
      description: "Remplacement des plaquettes et disques avant, contrôle du train avant.", immobilise: true, disponibleLe: vehicule.disponibleLe,
    });
    for (const i of interventions) {
      etat.donnees.maintenance.push(await creerDocument("maintenance", { ...i, vehiculeId: cree.id, source: "demo", creeLe: new Date() }, jeton()));
    }
    faits++;
  }
  etatEl.textContent = "Mise à jour des disponibilités du site…";
  for (const modele of new Set(liste.map((v) => v.modele))) await majDisponibilite(modele);
  return `${faits} véhicules fictifs créés avec leur historique d'entretien.`
    + (sansPhoto.length ? ` Photo introuvable pour ${sansPhoto.join(", ")} : ajoutez-la dans l'onglet Modèles.` : "");
}

// Véhicules fictifs supprimables : ceux qu'aucune réservation n'utilise.
export function demoSupprimable() {
  const utilises = new Set(etat.donnees.reservations.map((r) => r.vehiculeAttribue).filter(Boolean));
  return etat.donnees.vehicules.filter((v) => estDemo(v) && !utilises.has(v.id));
}

export async function supprimerDemo(etatEl) {
  const aSupprimer = demoSupprimable();
  const gardes = etat.donnees.vehicules.filter(estDemo).length - aSupprimer.length;
  const ids = new Set(aSupprimer.map((v) => v.id));
  const interventions = etat.donnees.maintenance.filter((m) => estDemo(m) && ids.has(m.vehiculeId));
  let n = 0;
  for (const m of interventions) {
    etatEl.textContent = `Suppression de l'historique d'entretien… ${++n} / ${interventions.length}`;
    await supprimerDocument("maintenance", m.id, jeton());
    etat.donnees.maintenance = etat.donnees.maintenance.filter((x) => x.id !== m.id);
  }
  n = 0;
  for (const v of aSupprimer) {
    etatEl.textContent = `Suppression des véhicules fictifs… ${++n} / ${aSupprimer.length}`;
    await supprimerDocument("vehicules", v.id, jeton());
    etat.donnees.vehicules = etat.donnees.vehicules.filter((x) => x.id !== v.id);
  }
  etatEl.textContent = "Mise à jour des disponibilités du site…";
  for (const modele of new Set(aSupprimer.map((v) => v.modele))) await majDisponibilite(modele);
  return `${aSupprimer.length} véhicules fictifs supprimés.`
    + (gardes ? ` ${gardes} gardé(s) car attribué(s) à une réservation.` : "");
}
