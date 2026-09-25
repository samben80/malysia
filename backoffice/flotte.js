// Gestion de flotte : chaque véhicule est suivi par son immatriculation.
// Le site public n'affiche que les modèles ; ici, on sait quelle voiture
// précise est chez quel client, au garage ou disponible.
import { creerDocument, corrigerDocument } from "../assets/firestore-rest.js";
import {
  etat, jeton, MODELES, nomModele, STATUTS_VEHICULE, INTERVALLE_VIDANGE_KM, INTERVALLE_PNEUS_KM,
  majDisponibilite, alertesVehicule, reservationsVehicule, formateDate, nombre, mad, escHTML, escAttr,
  champ, valeursFormulaire, badge, blocAlertes, normaliserImmat, cleImmat, aujourdhuiISO, executer,
  infosModele, barreFiltres, lierFiltres, contientTexte,
} from "./commun.js";
import { lireTableur, versDateISO } from "./lecteur-tableur.js";
import { sousOnglets } from "./modeles.js";
import { chargerDemo, supprimerDemo, demoSupprimable, estDemo } from "./demo.js";

let filtre = "";
const criteres = { texte: "", marque: "", modele: "", categorie: "", carburant: "" };
let selection = null; // id du véhicule ouvert, ou "nouveau"
let section = null;
let importation = null; // null, ou { lignes analysées, bilan } pendant un import Excel
let demo = null; // null, ou { message } quand le panneau de la flotte de démonstration est ouvert

export function afficherFlotte(el, param) {
  section = el;
  if (param) selection = param;
  rendre();
}

function rendre() {
  const { vehicules } = etat.donnees;
  const compte = (s) => vehicules.filter((v) => v.statut === s).length;
  const avecAlerte = vehicules.filter((v) => alertesVehicule(v).length).length;

  section.innerHTML = `
    <div class="entete"><h1>Flotte</h1><div class="actions-entete"><button class="bouton secondaire" id="ouvrir-demo">Démonstration</button><button class="bouton secondaire" id="importer-flotte">Importer depuis Excel</button><button class="bouton" id="ajouter-vehicule">+ Ajouter un véhicule</button></div></div>
    ${sousOnglets("flotte")}
    ${importation ? '<div class="panneau" id="zone-import"></div>' : ""}
    ${demo ? '<div class="panneau" id="zone-demo"></div>' : ""}
    <div class="kpis">
      <div class="kpi"><div class="valeur">${compte("Disponible")}</div><div class="libelle">Disponibles</div></div>
      <div class="kpi"><div class="valeur">${compte("En circulation")}</div><div class="libelle">En circulation</div></div>
      <div class="kpi"><div class="valeur">${compte("En réparation")}</div><div class="libelle">En réparation</div></div>
      <div class="kpi"><div class="valeur">${avecAlerte}</div><div class="libelle">À surveiller</div></div>
    </div>
    <div class="filtres">
      ${[["", `Tous (${vehicules.length})`], ...STATUTS_VEHICULE.map((s) => [s, `${s} (${compte(s)})`]), ["alertes", `Alertes (${avecAlerte})`]]
        .map(([v, l]) => `<button data-filtre="${escAttr(v)}" class="${v === filtre ? "actif" : ""}">${escHTML(l)}</button>`).join("")}
    </div>
    ${vehicules.length ? barreFiltres(criteres, menusFiltres()) : ""}
    <p class="compte-filtre" id="compte-flotte"></p>
    <div class="disposition">
      <div class="liste" id="liste-flotte"></div>
      <div class="fiche" id="fiche-vehicule"></div>
    </div>`;

  section.querySelector("#ajouter-vehicule").addEventListener("click", () => { selection = "nouveau"; rendre(); });
  section.querySelector("#importer-flotte").addEventListener("click", () => { importation = { lignes: null }; rendre(); });
  section.querySelector("#ouvrir-demo").addEventListener("click", () => { demo = demo ? null : { message: "" }; rendre(); });
  if (importation) rendreImport(section.querySelector("#zone-import"));
  if (demo) rendreDemo(section.querySelector("#zone-demo"));
  section.querySelectorAll("[data-filtre]").forEach((b) => b.addEventListener("click", () => { filtre = b.dataset.filtre; rendre(); }));
  const barre = section.querySelector(".barre-filtres");
  if (barre) lierFiltres(barre, criteres, rendreListe);
  rendreListe();
  rendreFiche();
}

function menusFiltres() {
  const presents = [...new Set(etat.donnees.vehicules.map((v) => v.modele))];
  const uniques = (f) => [...new Set(presents.map(f).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return {
    recherche: "Rechercher : immatriculation, modèle, couleur, châssis…",
    menus: [
      { nom: "marque", libelle: "Toutes les marques", options: uniques((id) => infosModele(id).marque) },
      { nom: "modele", libelle: "Tous les modèles", options: presents.filter((id) => !criteres.marque || infosModele(id).marque === criteres.marque)
        .map((id) => [id, nomModele(id)]).sort((a, b) => a[1].localeCompare(b[1])) },
      { nom: "categorie", libelle: "Toutes les catégories", options: uniques((id) => infosModele(id).type) },
      { nom: "carburant", libelle: "Tous carburants", options: [...new Set(etat.donnees.vehicules.map((v) => v.carburant).filter(Boolean))].sort() },
    ],
  };
}

function vehiculesFiltres() {
  return etat.donnees.vehicules.filter((v) => {
    const i = infosModele(v.modele);
    if (filtre === "alertes" ? !alertesVehicule(v).length : filtre && v.statut !== filtre) return false;
    if (criteres.marque && i.marque !== criteres.marque) return false;
    if (criteres.modele && v.modele !== criteres.modele) return false;
    if (criteres.categorie && i.type !== criteres.categorie) return false;
    if (criteres.carburant && v.carburant !== criteres.carburant) return false;
    return contientTexte(criteres.texte, v.immatriculation, nomModele(v.modele), v.couleur, v.chassis, v.notes, v.annee, i.gamme);
  }).sort((a, b) => nomModele(a.modele).localeCompare(nomModele(b.modele)) || String(a.immatriculation).localeCompare(String(b.immatriculation)));
}

// Ne redessine que la liste : la saisie dans la recherche garde le curseur.
function rendreListe() {
  const liste = section.querySelector("#liste-flotte");
  if (!liste) return;
  const total = etat.donnees.vehicules.length;
  const visibles = vehiculesFiltres();
  liste.innerHTML = visibles.length ? visibles.map(ligne).join("")
    : `<div class="vide">${total ? "Aucun véhicule ne correspond à ces filtres." : "Aucun véhicule saisi. Commencez par « Ajouter un véhicule » avec son immatriculation."}</div>`;
  liste.querySelectorAll(".ligne").forEach((l) => l.addEventListener("click", () => { selection = l.dataset.id; rendre(); }));
  const compte = section.querySelector("#compte-flotte");
  compte.textContent = total && visibles.length !== total ? `${visibles.length} véhicule${visibles.length > 1 ? "s" : ""} sur ${total}` : "";
  // la liste « Tous les modèles » suit la marque choisie
  const menuModele = section.querySelector('select[data-critere="modele"]');
  if (menuModele) {
    const options = menusFiltres().menus[1].options;
    if (criteres.modele && !options.some(([id]) => id === criteres.modele)) criteres.modele = "";
    menuModele.innerHTML = `<option value="">Tous les modèles</option>` + options.map(([id, nom]) => `<option value="${escAttr(id)}"${id === criteres.modele ? " selected" : ""}>${escHTML(nom)}</option>`).join("");
  }
}

function ligne(v) {
  const alertes = alertesVehicule(v);
  const prochaine = reservationsVehicule(v.id).find((r) => r.statut !== "En cours");
  let detail = `${nombre(v.kmActuel)} km`;
  if (v.statut === "En réparation") detail += v.disponibleLe ? ` · de retour le ${formateDate(v.disponibleLe)}` : " · date de retour inconnue";
  else if (prochaine) detail += ` · prochaine location le ${formateDate(prochaine.depart)}`;
  return `<div class="ligne${v.id === selection ? " selectionnee" : ""}" data-id="${escAttr(v.id)}">
      <div>
        <div class="ref immat">${escHTML(v.immatriculation)}</div>
        <div class="vehicule">${escHTML(nomModele(v.modele))}${v.couleur ? ` <small>· ${escHTML(v.couleur)}</small>` : ""}</div>
        <div class="dates">${escHTML(detail)}${alertes.length ? ` · <b class="txt-alerte">${alertes.length} alerte${alertes.length > 1 ? "s" : ""}</b>` : ""}</div>
      </div>
      ${badge(v.statut, "vehicule")}
    </div>`;
}

function rendreFiche() {
  const fiche = section.querySelector("#fiche-vehicule");
  if (selection === "nouveau") return formulaireVehicule(fiche, null);
  const v = etat.donnees.vehicules.find((x) => x.id === selection);
  if (!v) { fiche.innerHTML = '<div class="vide">Sélectionnez un véhicule dans la liste.</div>'; return; }

  const alertes = alertesVehicule(v);
  const locations = reservationsVehicule(v.id);
  const interventions = etat.donnees.maintenance
    .filter((m) => m.vehiculeId === v.id)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const coutAnnee = interventions.filter((m) => String(m.date).startsWith(aujourdhuiISO().slice(0, 4)))
    .reduce((s, m) => s + (Number(m.cout) || 0), 0);

  fiche.innerHTML = `
    ${badge(v.statut, "vehicule")}
    <h2 class="immat">${escHTML(v.immatriculation)}</h2>
    <div class="ref">${escHTML(nomModele(v.modele))} · ${escHTML(MODELES[v.modele]?.categorie || "")}</div>
    ${blocAlertes(alertes)}

    <form class="formulaire" id="form-statut">
      ${champ({ nom: "statut", libelle: "Statut", valeur: v.statut, options: STATUTS_VEHICULE })}
      ${champ({ nom: "disponibleLe", libelle: "Disponible prévu le", valeur: v.disponibleLe, type: "date" })}
      <button class="action large" type="submit">Changer le statut</button>
      <p class="aide large">« En réparation » avec une date : le modèle reste réservable sur le site à partir de cette date. Sans date, le véhicule est retiré du parc disponible jusqu'à nouvel ordre.</p>
      <p class="etat large" id="etat-statut"></p>
    </form>

    <div class="champs">
      <div><span>Kilométrage</span>${nombre(v.kmActuel)} km</div>
      <div><span>Carburant</span>${escHTML(v.carburant || "—")}</div>
      <div><span>Année</span>${escHTML(v.annee || "—")}</div>
      <div><span>N° de châssis</span>${escHTML(v.chassis || "—")}</div>
      <div><span>Assurance jusqu'au</span>${formateDate(v.assurance)}</div>
      <div><span>Visite technique jusqu'au</span>${formateDate(v.visiteTechnique)}</div>
      <div><span>Vignette jusqu'au</span>${formateDate(v.vignette)}</div>
      <div><span>Entretien cette année</span>${mad(coutAnnee)}</div>
    </div>
    ${v.notes ? `<p class="aide">${escHTML(v.notes)}</p>` : ""}

    <h3 class="sous-titre">Locations prévues</h3>
    ${locations.length ? `<ul class="mini-liste">${locations.map((r) => `<li><a href="#reservations/${escAttr(r.id)}">${formateDate(r.depart)} → ${formateDate(r.retour)}</a> ${badge(r.statut)}</li>`).join("")}</ul>`
      : '<p class="aide">Aucune location attribuée à ce véhicule.</p>'}

    <h3 class="sous-titre">Maintenance</h3>
    ${interventions.length ? `<ul class="mini-liste">${interventions.slice(0, 6).map((m) => `<li><a href="#maintenance/${escAttr(m.id)}">${formateDate(m.date)} · ${escHTML(m.type)}</a> ${m.km !== "" && m.km != null ? `<small>${nombre(m.km)} km</small>` : ""} ${m.statut !== "Terminée" ? badge(m.statut) : ""}</li>`).join("")}</ul>`
      : '<p class="aide">Aucune intervention enregistrée.</p>'}
    <a class="bouton secondaire bloc" href="#maintenance/nouvelle/${escAttr(v.id)}">Ajouter une intervention</a>

    <details class="modifier"><summary>Modifier la fiche du véhicule</summary><div id="form-vehicule-zone"></div></details>`;

  const formStatut = fiche.querySelector("#form-statut");
  formStatut.addEventListener("submit", (ev) => { ev.preventDefault(); changerStatut(v, formStatut); });
  formulaireVehicule(fiche.querySelector("#form-vehicule-zone"), v);
}

async function changerStatut(v, form) {
  const etatEl = form.querySelector("#etat-statut");
  const { statut, disponibleLe } = valeursFormulaire(form);
  const enCours = etat.donnees.reservations.find((r) => r.vehiculeAttribue === v.id && r.statut === "En cours");
  if (statut === "Disponible" && enCours && !confirm("Ce véhicule est encore chez un client (location en cours). Le passer quand même en « Disponible » ?")) return;
  const maj = { statut, disponibleLe: statut === "En réparation" ? disponibleLe : "" };
  await executer(etatEl, rendre, async () => {
    await corrigerDocument("vehicules", v.id, maj, jeton());
    Object.assign(v, maj);
    await majDisponibilite(v.modele);
  });
}

function formulaireVehicule(zone, v) {
  const nouveau = !v;
  const d = v || { statut: "Disponible", intervalleVidangeKm: INTERVALLE_VIDANGE_KM, intervallePneusKm: INTERVALLE_PNEUS_KM };
  zone.innerHTML = `
    ${nouveau ? '<h2>Nouveau véhicule</h2><p class="aide">Le modèle est celui affiché sur le site. Plusieurs véhicules peuvent partager le même modèle.</p>' : ""}
    <form class="formulaire" id="form-vehicule">
      ${champ({ nom: "immatriculation", libelle: "Immatriculation", valeur: d.immatriculation, attrs: 'required placeholder="12345-A-6"' })}
      ${champ({ nom: "modele", libelle: "Modèle (site)", valeur: d.modele, options: Object.entries(MODELES).map(([id, m]) => [id, m.nom]) })}
      ${champ({ nom: "couleur", libelle: "Couleur", valeur: d.couleur })}
      ${champ({ nom: "annee", libelle: "Année", valeur: d.annee, type: "number", attrs: 'min="1990" max="2100"' })}
      ${champ({ nom: "carburant", libelle: "Carburant", valeur: d.carburant ?? MODELES[d.modele]?.carburant, options: ["", "Diesel", "Essence", "Hybride", "Électrique"] })}
      ${champ({ nom: "kmActuel", libelle: "Kilométrage actuel", valeur: d.kmActuel, type: "number", attrs: 'min="0" required' })}
      ${champ({ nom: "chassis", libelle: "N° de châssis (VIN)", valeur: d.chassis })}
      ${nouveau ? champ({ nom: "statut", libelle: "Statut", valeur: d.statut, options: STATUTS_VEHICULE }) : ""}
      ${champ({ nom: "assurance", libelle: "Assurance valable jusqu'au", valeur: d.assurance, type: "date" })}
      ${champ({ nom: "visiteTechnique", libelle: "Visite technique jusqu'au", valeur: d.visiteTechnique, type: "date" })}
      ${champ({ nom: "vignette", libelle: "Vignette jusqu'au", valeur: d.vignette, type: "date" })}
      ${champ({ nom: "intervalleVidangeKm", libelle: "Vidange tous les (km)", valeur: d.intervalleVidangeKm, type: "number", attrs: 'min="1000" step="500"' })}
      ${champ({ nom: "intervallePneusKm", libelle: "Pneus tous les (km)", valeur: d.intervallePneusKm, type: "number", attrs: 'min="5000" step="1000"' })}
      ${champ({ nom: "notes", libelle: "Notes", valeur: d.notes, type: "textarea", large: true })}
      <button class="action large" type="submit">${nouveau ? "Ajouter à la flotte" : "Enregistrer"}</button>
      ${nouveau ? '<button class="action secondaire large" type="button" id="annuler-vehicule">Annuler</button>' : ""}
      <p class="etat large" id="etat-vehicule"></p>
    </form>`;
  const form = zone.querySelector("#form-vehicule");
  form.addEventListener("submit", (ev) => { ev.preventDefault(); enregistrerVehicule(v, form); });
  const annuler = zone.querySelector("#annuler-vehicule");
  if (annuler) annuler.addEventListener("click", () => { selection = null; rendre(); });
}

async function enregistrerVehicule(v, form) {
  const etatEl = form.querySelector("#etat-vehicule");
  const donnees = valeursFormulaire(form);
  donnees.immatriculation = normaliserImmat(donnees.immatriculation);
  if (!donnees.carburant) donnees.carburant = MODELES[donnees.modele]?.carburant || "";
  const doublon = etat.donnees.vehicules.find((x) => cleImmat(x.immatriculation) === cleImmat(donnees.immatriculation) && (!v || x.id !== v.id));
  if (doublon) {
    etatEl.className = "etat large erreur";
    etatEl.textContent = "Cette immatriculation existe déjà dans la flotte.";
    return;
  }
  await executer(etatEl, rendre, async () => {
    if (v) {
      const ancienModele = v.modele;
      await corrigerDocument("vehicules", v.id, donnees, jeton());
      Object.assign(v, donnees);
      if (ancienModele !== v.modele) await majDisponibilite(ancienModele);
      await majDisponibilite(v.modele);
    } else {
      const cree = await creerDocument("vehicules", { ...donnees, disponibleLe: "", creeLe: new Date() }, jeton());
      etat.donnees.vehicules.push(cree);
      selection = cree.id;
      await majDisponibilite(cree.modele);
    }
  });
}

// ---- import en masse depuis le modèle Excel (backoffice/modele-import-flotte.xlsx) ou un CSV

const sansAccents = (x) => String(x ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

// en-tête normalisé (début) → champ du véhicule
const COLONNES = [
  ["immatriculation", "immatriculation"], ["modele", "modele"], ["couleur", "couleur"], ["annee", "annee"],
  ["carburant", "carburant"], ["kilometrage", "kmActuel"], ["km", "kmActuel"], ["ndechassis", "chassis"], ["numerodechassis", "chassis"], ["chassis", "chassis"],
  ["vin", "chassis"], ["statut", "statut"], ["disponible", "disponibleLe"], ["assurance", "assurance"],
  ["visite", "visiteTechnique"], ["vignette", "vignette"], ["vidange", "intervalleVidangeKm"], ["pneus", "intervallePneusKm"], ["notes", "notes"],
];
const DATES = ["disponibleLe", "assurance", "visiteTechnique", "vignette"];
const ENTIERS = ["annee", "kmActuel", "intervalleVidangeKm", "intervallePneusKm"];

function trouverModele(valeur) {
  const v = sansAccents(valeur);
  if (!v) return null;
  const entrees = Object.entries(MODELES);
  const exact = entrees.find(([id, m]) => sansAccents(m.nom) === v || sansAccents(id) === v || sansAccents(id.replace(/^veh-/, "")) === v);
  if (exact) return exact[0];
  const partiels = entrees.filter(([, m]) => sansAccents(m.nom).includes(v) || v.includes(sansAccents(m.nom)));
  return partiels.length === 1 ? partiels[0][0] : null;
}

function analyser(tableau) {
  const entetes = (tableau[0] || []).map(sansAccents);
  const champs = entetes.map((e) => (COLONNES.find(([debut]) => e.startsWith(debut)) || [])[1] || null);
  if (!champs.includes("immatriculation") || !champs.includes("modele")) {
    throw new Error("les colonnes « Immatriculation » et « Modèle » sont introuvables. Utilisez le modèle Excel fourni.");
  }
  const existantes = new Set(etat.donnees.vehicules.map((v) => cleImmat(v.immatriculation)));
  const vues = new Set();
  const lignes = [];
  tableau.slice(1).forEach((cellules, i) => {
    if (!cellules.some((c) => String(c ?? "").trim() !== "")) return; // ligne vide
    const brut = {};
    champs.forEach((champ, k) => { if (champ && brut[champ] === undefined) brut[champ] = cellules[k] ?? ""; });
    const erreurs = [];
    const v = { statut: "Disponible", disponibleLe: "" };
    v.immatriculation = normaliserImmat(brut.immatriculation);
    if (!v.immatriculation) erreurs.push("immatriculation manquante");
    v.modele = trouverModele(brut.modele);
    if (!v.modele) erreurs.push(brut.modele ? `modèle « ${brut.modele} » inconnu` : "modèle manquant");
    for (const champ of ["couleur", "chassis", "notes"]) v[champ] = String(brut[champ] ?? "").trim();
    for (const champ of ENTIERS) {
      const t = String(brut[champ] ?? "").replace(/[\s\u202f\u00a0]/g, "").replace(/km$/i, "");
      if (t === "") { v[champ] = ""; continue; }
      const n = Number(t.replace(",", "."));
      if (!Number.isFinite(n) || n < 0) erreurs.push(`${champ === "kmActuel" ? "kilométrage" : champ === "annee" ? "année" : "intervalle"} « ${brut[champ]} » invalide`);
      else v[champ] = Math.round(n);
    }
    if (v.kmActuel === "") erreurs.push("kilométrage manquant");
    if (v.intervalleVidangeKm === "") v.intervalleVidangeKm = INTERVALLE_VIDANGE_KM;
    if (v.intervallePneusKm === "") v.intervallePneusKm = INTERVALLE_PNEUS_KM;
    for (const champ of DATES) {
      const d = versDateISO(brut[champ]);
      if (d === null) { erreurs.push(`date « ${brut[champ]} » illisible`); v[champ] = ""; } else v[champ] = d;
    }
    if (String(brut.statut ?? "").trim()) {
      const s = STATUTS_VEHICULE.find((x) => sansAccents(x) === sansAccents(brut.statut));
      if (s) v.statut = s; else erreurs.push(`statut « ${brut.statut} » inconnu`);
    }
    if (v.statut !== "En réparation") v.disponibleLe = "";
    const carburant = String(brut.carburant ?? "").trim();
    v.carburant = carburant || (v.modele && MODELES[v.modele].carburant) || "";
    let etatLigne = erreurs.length ? "erreur" : "ok";
    const cle = cleImmat(v.immatriculation);
    if (etatLigne === "ok" && existantes.has(cle)) { etatLigne = "ignoree"; erreurs.push("déjà dans la flotte, ignorée"); }
    else if (etatLigne === "ok" && vues.has(cle)) { etatLigne = "erreur"; erreurs.push("immatriculation en double dans le fichier"); }
    if (cle) vues.add(cle);
    lignes.push({ numero: i + 2, vehicule: v, etat: etatLigne, message: erreurs.join(", ") });
  });
  return lignes;
}

function rendreImport(zone) {
  const imp = importation;
  if (!imp.lignes) {
    zone.innerHTML = `
      <h2>Importer des véhicules</h2>
      <p class="aide">1. Téléchargez le <a href="modele-import-flotte.xlsx" download>modèle Excel</a> et remplissez une ligne par véhicule (immatriculation, modèle, kilométrage au minimum).<br>
      2. Choisissez le fichier rempli (.xlsx ou .csv). Rien n'est enregistré avant votre validation.</p>
      <label class="bouton secondaire">Choisir le fichier<input type="file" id="fichier-import" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden></label>
      <button class="bouton secondaire" id="fermer-import" type="button">Fermer</button>
      <p class="etat" id="etat-import"></p>`;
    zone.querySelector("#fermer-import").addEventListener("click", () => { importation = null; rendre(); });
    zone.querySelector("#fichier-import").addEventListener("change", async (ev) => {
      const etatEl = zone.querySelector("#etat-import");
      const fichier = ev.target.files[0];
      if (!fichier) return;
      etatEl.className = "etat";
      etatEl.textContent = "Lecture du fichier…";
      try {
        const tableau = await lireTableur(fichier, { feuillePreferee: "Véhicules", colonneRepere: "Immatriculation" });
        importation = { lignes: analyser(tableau), fichier: fichier.name };
        rendre();
      } catch (e) {
        etatEl.className = "etat erreur";
        etatEl.textContent = "Fichier refusé : " + e.message;
      }
    });
    return;
  }
  const aImporter = imp.lignes.filter((l) => l.etat === "ok");
  const libelleEtat = { ok: "À importer", erreur: "Erreur", ignoree: "Ignorée", importee: "Importée", echec: "Échec" };
  zone.innerHTML = `
    <h2>Aperçu de l'import</h2>
    <p class="aide">${escHTML(imp.fichier || "")} : ${imp.lignes.length} ligne${imp.lignes.length > 1 ? "s" : ""} lue${imp.lignes.length > 1 ? "s" : ""}.
      ${imp.termine ? "" : `${aImporter.length} prête${aImporter.length > 1 ? "s" : ""} à importer. Les lignes en erreur sont écartées : corrigez-les dans le fichier et réimportez-le, les véhicules déjà créés seront ignorés.`}</p>
    <div class="defilement"><table class="tableau">
      <thead><tr><th>Ligne</th><th>Immatriculation</th><th>Modèle</th><th>Km</th><th>Statut</th><th>Résultat</th></tr></thead>
      <tbody>${imp.lignes.map((l) => `<tr class="import-${l.etat}">
        <td>${l.numero}</td><td class="immat">${escHTML(l.vehicule.immatriculation || "—")}</td>
        <td>${escHTML(l.vehicule.modele ? nomModele(l.vehicule.modele) : "—")}</td><td>${l.vehicule.kmActuel === "" ? "—" : nombre(l.vehicule.kmActuel)}</td>
        <td>${escHTML(l.vehicule.statut)}${l.vehicule.disponibleLe ? " (" + formateDate(l.vehicule.disponibleLe) + ")" : ""}</td>
        <td>${badge(libelleEtat[l.etat])}${l.message ? ` <small>${escHTML(l.message)}</small>` : ""}</td></tr>`).join("")}</tbody>
    </table></div>
    ${imp.termine ? "" : `<button class="bouton" id="lancer-import" ${aImporter.length ? "" : "disabled"}>Importer ${aImporter.length} véhicule${aImporter.length > 1 ? "s" : ""}</button>`}
    <button class="bouton secondaire" id="fermer-import" type="button">${imp.termine ? "Fermer" : "Annuler"}</button>
    <p class="etat" id="etat-import">${imp.termine ? escHTML(imp.termine) : ""}</p>`;
  zone.querySelector("#fermer-import").addEventListener("click", () => { importation = null; rendre(); });
  const lancer = zone.querySelector("#lancer-import");
  if (lancer) lancer.addEventListener("click", () => importer(zone));
}

async function importer(zone) {
  const lignes = importation.lignes.filter((l) => l.etat === "ok");
  zone.querySelectorAll("button").forEach((b) => { b.disabled = true; });
  const etatEl = zone.querySelector("#etat-import");
  const modeles = new Set();
  let faits = 0, echecs = 0;
  for (const l of lignes) {
    etatEl.textContent = `Import en cours… ${faits + echecs + 1} / ${lignes.length}`;
    try {
      const cree = await creerDocument("vehicules", { ...l.vehicule, creeLe: new Date(), source: "import" }, jeton());
      etat.donnees.vehicules.push(cree);
      modeles.add(cree.modele);
      l.etat = "importee";
      faits++;
    } catch (e) {
      l.etat = "echec";
      l.message = e.message;
      echecs++;
    }
  }
  etatEl.textContent = "Mise à jour des disponibilités du site…";
  let dispo = "";
  try { for (const m of modeles) await majDisponibilite(m); } catch (e) { dispo = " La disponibilité du site n'a pas pu être recalculée : " + e.message; }
  importation.termine = `${faits} véhicule${faits > 1 ? "s" : ""} importé${faits > 1 ? "s" : ""}${echecs ? `, ${echecs} en échec` : ""}.${dispo}`;
  rendre();
}

// ---- flotte de démonstration (véhicules fictifs, supprimables d'un clic)

function rendreDemo(zone) {
  const fictifs = etat.donnees.vehicules.filter(estDemo).length;
  const supprimables = demoSupprimable().length;
  zone.innerHTML = `
    <h2>Flotte de démonstration</h2>
    <p class="aide">Ajoute une cinquantaine de véhicules fictifs répartis sur tous les modèles, avec leur historique d'entretien, pour essayer le back-office.
      Ajoute aussi les modèles Bentley Continental GTC, Bentayga, Flying Spur et Rolls-Royce Cullinan avec une photo libre de droits (Wikimedia Commons).
      Ces 4 modèles restent masqués sur le site tant que vous ne cochez pas « Afficher sur le site » dans l'onglet Modèles.</p>
    <p class="aide">Tant que les véhicules fictifs sont là, ils comptent dans les disponibilités affichées sur le site : supprimez-les une fois vos essais terminés.</p>
    ${fictifs ? `<p class="aide">${fictifs} véhicule${fictifs > 1 ? "s" : ""} fictif${fictifs > 1 ? "s" : ""} dans la flotte.</p>` : ""}
    ${fictifs ? "" : '<button class="bouton" id="charger-demo">Charger la flotte de démonstration</button>'}
    ${supprimables ? `<button class="bouton danger" id="supprimer-demo">Supprimer les ${supprimables} véhicules fictifs</button>` : ""}
    <button class="bouton secondaire" id="fermer-demo" type="button">Fermer</button>
    <p class="etat" id="etat-demo">${escHTML(demo.message)}</p>`;
  const etatEl = zone.querySelector("#etat-demo");
  const lancer = (action) => executer(etatEl, rendre, async () => { demo.message = ""; demo.message = await action(etatEl); });
  zone.querySelector("#fermer-demo").addEventListener("click", () => { demo = null; rendre(); });
  const charger = zone.querySelector("#charger-demo");
  if (charger) charger.addEventListener("click", () => lancer(chargerDemo));
  const supprimer = zone.querySelector("#supprimer-demo");
  if (supprimer) supprimer.addEventListener("click", () => {
    if (confirm(`Supprimer les ${supprimables} véhicules fictifs et leur historique d'entretien ?`)) lancer(supprimerDemo);
  });
}
