// Maintenance et réparations : vidanges, pneus, réparations, avec le coût,
// le kilométrage et l'immobilisation du véhicule au garage.
import { creerDocument, corrigerDocument, supprimerDocument } from "../assets/firestore-rest.js";
import {
  etat, jeton, nomModele, majDisponibilite, alertesVehicule, formateDate, nombre, mad, escHTML, escAttr,
  champ, valeursFormulaire, badge, blocAlertes, aujourdhuiISO, executer, messageErreur,
  infosModele, barreFiltres, lierFiltres, contientTexte, decalerJours,
} from "./commun.js";

export const TYPES_INTERVENTION = ["Vidange", "Pneus", "Freins", "Révision", "Réparation", "Carrosserie", "Batterie", "Autre"];
const STATUTS_INTERVENTION = ["Planifiée", "En cours", "Terminée"];

let filtre = "";
const criteres = { texte: "", marque: "", modele: "", garage: "", periode: "" };
const PERIODES = [["30j", "30 derniers jours"], ["mois", "Ce mois-ci"], ["3mois", "3 derniers mois"], ["annee", "Cette année"], ["an-1", "L'année dernière"], ["avenir", "À venir"]];
let selection = null; // id d'intervention, ou "nouvelle"
let vehiculePropose = "";
let section = null;

export function afficherMaintenance(el, param, param2) {
  section = el;
  if (param === "nouvelle") { selection = "nouvelle"; vehiculePropose = param2 || ""; }
  else if (param) selection = param;
  rendre();
}

const vehicule = (id) => etat.donnees.vehicules.find((v) => v.id === id);
const libelleVehicule = (v) => (v ? `${v.immatriculation} · ${nomModele(v.modele)}` : "Véhicule supprimé");

function rendre() {
  const { maintenance, vehicules } = etat.donnees;
  const annee = aujourdhuiISO().slice(0, 4), mois = aujourdhuiISO().slice(0, 7);
  const cout = (prefixe) => maintenance.filter((m) => String(m.date).startsWith(prefixe)).reduce((s, m) => s + (Number(m.cout) || 0), 0);
  const ouvertes = maintenance.filter((m) => m.statut !== "Terminée");
  const aPrevoir = vehicules.map((v) => ({ v, alertes: alertesVehicule(v) })).filter((x) => x.alertes.length);


  section.innerHTML = `
    <div class="entete"><h1>Maintenance</h1><button class="bouton" id="nouvelle-intervention">+ Nouvelle intervention</button></div>
    <div class="kpis">
      <div class="kpi"><div class="valeur">${ouvertes.length}</div><div class="libelle">Planifiées ou en cours</div></div>
      <div class="kpi"><div class="valeur">${aPrevoir.length}</div><div class="libelle">Véhicules à surveiller</div></div>
      <div class="kpi"><div class="valeur">${nombre(cout(mois))}</div><div class="libelle">Coût du mois (MAD)</div></div>
      <div class="kpi"><div class="valeur">${nombre(cout(annee))}</div><div class="libelle">Coût ${annee} (MAD)</div></div>
    </div>
    ${aPrevoir.length ? `<details class="a-prevoir"${aPrevoir.length <= 5 ? " open" : ""}><summary class="sous-titre">À prévoir : ${aPrevoir.length} véhicule${aPrevoir.length > 1 ? "s" : ""}</summary>${aPrevoir.map(({ v, alertes }) =>
      `<div class="ligne-alerte"><a href="#flotte/${escAttr(v.id)}" class="immat">${escHTML(v.immatriculation)}</a> <span>${escHTML(nomModele(v.modele))}</span>${blocAlertes(alertes)}</div>`).join("")}</details>` : ""}
    <div class="filtres">
      ${[["", "Toutes"], ["ouvertes", "Non terminées"], ["Vidange", "Vidanges"], ["Pneus", "Pneus"], ["Réparation", "Réparations"], ["autres", "Autres"]]
        .map(([v, l]) => `<button data-filtre="${v}" class="${v === filtre ? "actif" : ""}">${l}</button>`).join("")}
    </div>
    ${maintenance.length ? barreFiltres(criteres, menusFiltres()) : ""}
    <p class="compte-filtre" id="compte-maintenance"></p>
    <div class="disposition">
      <div class="liste" id="liste-maintenance"></div>
      <div class="fiche" id="fiche-intervention"></div>
    </div>`;

  section.querySelector("#nouvelle-intervention").addEventListener("click", () => { selection = "nouvelle"; vehiculePropose = ""; rendre(); });
  section.querySelectorAll("[data-filtre]").forEach((b) => b.addEventListener("click", () => { filtre = b.dataset.filtre; rendre(); }));
  const barre = section.querySelector(".barre-filtres");
  if (barre) lierFiltres(barre, criteres, rendreListe);
  rendreListe();
  rendreFiche();
}

function menusFiltres() {
  const modeles = [...new Set(etat.donnees.maintenance.map((m) => (vehicule(m.vehiculeId) || {}).modele).filter(Boolean))];
  const uniques = (liste) => [...new Set(liste.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return {
    recherche: "Rechercher : immatriculation, modèle, garage, pièces…",
    menus: [
      { nom: "marque", libelle: "Toutes les marques", options: uniques(modeles.map((id) => infosModele(id).marque)) },
      { nom: "modele", libelle: "Tous les modèles", options: modeles.map((id) => [id, nomModele(id)]).sort((a, b) => a[1].localeCompare(b[1])) },
      { nom: "garage", libelle: "Tous les garages", options: uniques(etat.donnees.maintenance.map((m) => m.garage)) },
      { nom: "periode", libelle: "Toutes les dates", options: PERIODES },
    ],
  };
}

function dansPeriode(date, periode) {
  const d = String(date || ""), auj = aujourdhuiISO(), an = Number(auj.slice(0, 4));
  switch (periode) {
    case "30j": return d >= decalerJours(auj, -30) && d <= auj;
    case "mois": return d.startsWith(auj.slice(0, 7));
    case "3mois": return d >= decalerJours(auj, -92) && d <= auj;
    case "annee": return d.startsWith(String(an));
    case "an-1": return d.startsWith(String(an - 1));
    case "avenir": return d > auj;
    default: return true;
  }
}

function interventionsFiltrees() {
  return etat.donnees.maintenance.filter((m) => {
    if (filtre === "ouvertes" ? m.statut === "Terminée" : filtre === "autres" ? ["Vidange", "Pneus", "Réparation"].includes(m.type) : filtre && m.type !== filtre) return false;
    const v = vehicule(m.vehiculeId) || {};
    if (criteres.marque && infosModele(v.modele).marque !== criteres.marque) return false;
    if (criteres.modele && v.modele !== criteres.modele) return false;
    if (criteres.garage && m.garage !== criteres.garage) return false;
    if (!dansPeriode(m.date, criteres.periode)) return false;
    return contientTexte(criteres.texte, v.immatriculation, nomModele(v.modele), m.type, m.garage, m.description, m.statut);
  }).sort((a, b) => (a.statut === "Terminée") - (b.statut === "Terminée") || String(b.date).localeCompare(String(a.date)));
}

// Ne redessine que la liste : la saisie dans la recherche garde le curseur.
function rendreListe() {
  const liste = section.querySelector("#liste-maintenance");
  if (!liste) return;
  const total = etat.donnees.maintenance.length;
  const visibles = interventionsFiltrees();
  liste.innerHTML = visibles.length ? visibles.map(ligne).join("")
    : `<div class="vide">${total ? "Aucune intervention ne correspond à ces filtres." : "Aucune intervention enregistrée."}</div>`;
  liste.querySelectorAll(".ligne").forEach((l) => l.addEventListener("click", () => { selection = l.dataset.id; rendre(); }));
  const cout = visibles.reduce((s, m) => s + (Number(m.cout) || 0), 0);
  section.querySelector("#compte-maintenance").textContent = visibles.length
    ? `${visibles.length} intervention${visibles.length > 1 ? "s" : ""}${visibles.length !== total ? ` sur ${total}` : ""} · ${mad(cout)}` : "";
}

function ligne(m) {
  return `<div class="ligne${m.id === selection ? " selectionnee" : ""}" data-id="${escAttr(m.id)}">
      <div>
        <div class="ref">${formateDate(m.date)} · ${escHTML(m.type)}</div>
        <div class="vehicule">${escHTML(libelleVehicule(vehicule(m.vehiculeId)))}</div>
        <div class="dates">${m.km !== "" && m.km != null ? nombre(m.km) + " km · " : ""}${m.cout ? mad(m.cout) : "coût non saisi"}${m.garage ? " · " + escHTML(m.garage) : ""}</div>
      </div>
      ${badge(m.statut)}
    </div>`;
}

function rendreFiche() {
  const fiche = section.querySelector("#fiche-intervention");
  if (selection === "nouvelle") return formulaire(fiche, null);
  const m = etat.donnees.maintenance.find((x) => x.id === selection);
  if (!m) { fiche.innerHTML = '<div class="vide">Sélectionnez une intervention, ou créez-en une.</div>'; return; }
  const v = vehicule(m.vehiculeId);
  fiche.innerHTML = `
    ${badge(m.statut)}
    <h2>${escHTML(m.type)}</h2>
    <div class="ref"><a href="#flotte/${escAttr(m.vehiculeId)}">${escHTML(libelleVehicule(v))}</a></div>
    ${m.statut !== "Terminée" ? `<button class="action" id="terminer">Marquer terminée</button>
      <p class="aide">${m.immobilise ? "Le véhicule repasse en « Disponible » et son kilométrage est mis à jour." : "Le kilométrage du véhicule est mis à jour si celui de l'intervention est plus récent."}</p>
      <p class="etat" id="etat-terminer"></p>` : ""}
    <div id="zone-form"></div>
    <button class="lien-danger" id="supprimer">Supprimer cette intervention</button>`;
  formulaire(fiche.querySelector("#zone-form"), m);
  const terminer = fiche.querySelector("#terminer");
  if (terminer) terminer.addEventListener("click", () => marquerTerminee(m, fiche.querySelector("#etat-terminer")));
  fiche.querySelector("#supprimer").addEventListener("click", async () => {
    if (!confirm("Supprimer définitivement cette intervention ?")) return;
    try {
      await supprimerDocument("maintenance", m.id, jeton());
      etat.donnees.maintenance = etat.donnees.maintenance.filter((x) => x.id !== m.id);
      selection = null;
      rendre();
    } catch (e) { alert(messageErreur(e)); }
  });
}

function formulaire(zone, m) {
  const nouvelle = !m;
  const vPropose = vehicule(vehiculePropose);
  const d = m || { date: aujourdhuiISO(), statut: "Terminée", vehiculeId: vehiculePropose, km: vPropose ? vPropose.kmActuel : "" };
  const options = [["", "Choisir…"], ...[...etat.donnees.vehicules]
    .sort((a, b) => String(a.immatriculation).localeCompare(String(b.immatriculation)))
    .map((v) => [v.id, libelleVehicule(v)])];
  zone.innerHTML = `
    ${nouvelle ? "<h2>Nouvelle intervention</h2>" : ""}
    <form class="formulaire" id="form-intervention">
      ${champ({ nom: "vehiculeId", libelle: "Véhicule", valeur: d.vehiculeId, options, attrs: "required", large: true })}
      ${champ({ nom: "type", libelle: "Type", valeur: d.type, options: TYPES_INTERVENTION })}
      ${champ({ nom: "statut", libelle: "Statut", valeur: d.statut, options: STATUTS_INTERVENTION })}
      ${champ({ nom: "date", libelle: "Date", valeur: d.date, type: "date", attrs: "required" })}
      ${champ({ nom: "km", libelle: "Kilométrage", valeur: d.km, type: "number", attrs: 'min="0"' })}
      ${champ({ nom: "garage", libelle: "Garage / prestataire", valeur: d.garage })}
      ${champ({ nom: "cout", libelle: "Coût TTC (MAD)", valeur: d.cout, type: "number", attrs: 'min="0" step="0.01"' })}
      ${champ({ nom: "description", libelle: "Détail (pièces, marque des pneus, travaux…)", valeur: d.description, type: "textarea", large: true })}
      <label class="case large"><input type="checkbox" name="immobilise" ${d.immobilise ? "checked" : ""}> Le véhicule est immobilisé au garage</label>
      ${champ({ nom: "disponibleLe", libelle: "Disponible prévu le", valeur: d.disponibleLe, type: "date" })}
      <p class="aide large">Immobilisé et non terminé : le véhicule passe « En réparation » jusqu'à la date prévue, et le site en tient compte.</p>
      <button class="action large" type="submit">${nouvelle ? "Enregistrer l'intervention" : "Enregistrer les modifications"}</button>
      ${nouvelle ? '<button class="action secondaire large" type="button" id="annuler">Annuler</button>' : ""}
      <p class="etat large" id="etat-intervention"></p>
    </form>`;
  const form = zone.querySelector("#form-intervention");
  if (nouvelle) {
    // le kilométrage se pré-remplit avec celui du véhicule choisi
    form.elements.vehiculeId.addEventListener("change", () => {
      const v = vehicule(form.elements.vehiculeId.value);
      if (v && form.elements.km.value === "") form.elements.km.value = v.kmActuel ?? "";
    });
    zone.querySelector("#annuler").addEventListener("click", () => { selection = null; rendre(); });
  }
  form.addEventListener("submit", (ev) => { ev.preventDefault(); enregistrer(m, form); });
}

async function enregistrer(m, form) {
  const etatEl = form.querySelector("#etat-intervention");
  const donnees = valeursFormulaire(form);
  const v = vehicule(donnees.vehiculeId);
  if (!v) { etatEl.className = "etat large erreur"; etatEl.textContent = "Choisissez un véhicule."; return; }
  donnees.immatriculation = v.immatriculation;
  if (!donnees.immobilise) donnees.disponibleLe = "";
  await executer(etatEl, rendre, async () => {
    if (m) {
      await corrigerDocument("maintenance", m.id, donnees, jeton());
      Object.assign(m, donnees);
    } else {
      const cree = await creerDocument("maintenance", { ...donnees, creeLe: new Date() }, jeton());
      etat.donnees.maintenance.push(cree);
      selection = cree.id;
      m = cree;
    }
    await repercuterSurVehicule(m, v);
  });
}

// Une intervention qui immobilise le véhicule le met « En réparation » ; une
// fois terminée, il redevient disponible. Le kilométrage suit le plus récent.
async function repercuterSurVehicule(m, v) {
  const maj = {};
  if (m.km !== "" && m.km != null && Number(m.km) > (Number(v.kmActuel) || 0)) maj.kmActuel = Number(m.km);
  if (m.immobilise && m.statut !== "Terminée" && v.statut !== "Hors service") {
    maj.statut = "En réparation";
    maj.disponibleLe = m.disponibleLe || "";
  } else if (m.immobilise && m.statut === "Terminée" && v.statut === "En réparation") {
    maj.statut = "Disponible";
    maj.disponibleLe = "";
  }
  if (!Object.keys(maj).length) return;
  await corrigerDocument("vehicules", v.id, maj, jeton());
  Object.assign(v, maj);
  if ("statut" in maj) await majDisponibilite(v.modele);
}

async function marquerTerminee(m, etatEl) {
  const v = vehicule(m.vehiculeId);
  await executer(etatEl, rendre, async () => {
    await corrigerDocument("maintenance", m.id, { statut: "Terminée" }, jeton());
    m.statut = "Terminée";
    if (v) await repercuterSurVehicule(m, v);
  });
}
