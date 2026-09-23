// Gestion de flotte : chaque véhicule est suivi par son immatriculation.
// Le site public n'affiche que les modèles ; ici, on sait quelle voiture
// précise est chez quel client, au garage ou disponible.
import { creerDocument, corrigerDocument } from "../assets/firestore-rest.js";
import {
  etat, jeton, MODELES, nomModele, STATUTS_VEHICULE, INTERVALLE_VIDANGE_KM, INTERVALLE_PNEUS_KM,
  majDisponibilite, alertesVehicule, reservationsVehicule, formateDate, nombre, mad, escHTML, escAttr,
  champ, valeursFormulaire, badge, blocAlertes, normaliserImmat, cleImmat, aujourdhuiISO, executer,
} from "./commun.js";

let filtre = "";
let selection = null; // id du véhicule ouvert, ou "nouveau"
let section = null;

export function afficherFlotte(el, param) {
  section = el;
  if (param) selection = param;
  rendre();
}

function rendre() {
  const { vehicules } = etat.donnees;
  const compte = (s) => vehicules.filter((v) => v.statut === s).length;
  const avecAlerte = vehicules.filter((v) => alertesVehicule(v).length).length;
  const tries = [...vehicules].sort((a, b) =>
    nomModele(a.modele).localeCompare(nomModele(b.modele)) || String(a.immatriculation).localeCompare(String(b.immatriculation)));
  const visibles = filtre === "alertes" ? tries.filter((v) => alertesVehicule(v).length)
    : filtre ? tries.filter((v) => v.statut === filtre) : tries;

  section.innerHTML = `
    <div class="entete"><h1>Flotte</h1><button class="bouton" id="ajouter-vehicule">+ Ajouter un véhicule</button></div>
    <div class="kpis">
      <div class="kpi"><div class="valeur">${compte("Disponible")}</div><div class="libelle">Disponibles</div></div>
      <div class="kpi"><div class="valeur">${compte("En circulation")}</div><div class="libelle">En circulation</div></div>
      <div class="kpi"><div class="valeur">${compte("En réparation")}</div><div class="libelle">En réparation</div></div>
      <div class="kpi"><div class="valeur">${avecAlerte}</div><div class="libelle">À surveiller</div></div>
    </div>
    <div class="filtres">
      ${[["", `Tous (${vehicules.length})`], ...STATUTS_VEHICULE.map((s) => [s, s]), ["alertes", "Alertes"]]
        .map(([v, l]) => `<button data-filtre="${escAttr(v)}" class="${v === filtre ? "actif" : ""}">${escHTML(l)}</button>`).join("")}
    </div>
    <div class="disposition">
      <div class="liste">${visibles.length ? visibles.map(ligne).join("") :
        `<div class="vide">${vehicules.length ? "Aucun véhicule pour ce filtre." : "Aucun véhicule saisi. Commencez par « Ajouter un véhicule » avec son immatriculation."}</div>`}</div>
      <div class="fiche" id="fiche-vehicule"></div>
    </div>`;

  section.querySelector("#ajouter-vehicule").addEventListener("click", () => { selection = "nouveau"; rendre(); });
  section.querySelectorAll("[data-filtre]").forEach((b) => b.addEventListener("click", () => { filtre = b.dataset.filtre; rendre(); }));
  section.querySelectorAll(".liste .ligne").forEach((l) => l.addEventListener("click", () => { selection = l.dataset.id; rendre(); }));
  rendreFiche();
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
