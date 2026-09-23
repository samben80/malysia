// Clients : une fiche par numéro de téléphone, avec l'historique des
// locations et des factures. La fiche se remplit automatiquement à partir du
// dossier client à la génération du contrat, et se complète à la main.
import { creerDocument, corrigerDocument, lireDocument } from "../assets/firestore-rest.js";
import {
  etat, jeton, cleClient, lienWhatsApp, formateDate, mad, escHTML, escAttr, champ, valeursFormulaire,
  badge, executer, nomModele,
} from "./commun.js";

const CHAMPS_IDENTITE = ["nom", "prenom", "telephone", "email", "adresse", "ville", "pays", "nationalite", "dateNaissance",
  "typePiece", "numeroPiece", "expirationPiece", "numeroPermis", "delivrancePermis"];

let recherche = "";
let filtre = "";
let selection = null; // clé client (téléphone normalisé) ou "nouveau"
let section = null;

export function afficherClients(el, param) {
  section = el;
  if (param) selection = param;
  rendre();
}

export const nomClient = (c) => (c ? [c.prenom, c.nom].filter(Boolean).join(" ") : "");
export const ficheClient = (tel) => etat.donnees.clients.find((c) => c.id === cleClient(tel)) || null;

// Crée ou complète la fiche client à partir d'un dossier reçu (identité, pièces).
// Les notes et la liste noire saisies par l'équipe ne sont jamais écrasées.
export async function majClientDepuisDossier(telephone, dossier) {
  const cle = cleClient(telephone || dossier.telephone);
  if (!cle) return;
  const donnees = {};
  for (const k of CHAMPS_IDENTITE) if (dossier[k]) donnees[k] = dossier[k];
  donnees.modifieLe = new Date();
  const existant = etat.donnees.clients.find((c) => c.id === cle);
  if (existant) {
    await corrigerDocument("clients", cle, donnees, jeton());
    Object.assign(existant, donnees);
  } else {
    try {
      const cree = await creerDocument("clients", { ...donnees, creeLe: new Date() }, { ...jeton(), id: cle });
      etat.donnees.clients.push(cree);
    } catch (e) {
      if (e.status !== 409) throw e;
      await corrigerDocument("clients", cle, donnees, jeton());
    }
  }
}

function regrouper() {
  const { clients, reservations, factures } = etat.donnees;
  const parCle = new Map();
  const entree = (cle) => {
    if (!parCle.has(cle)) parCle.set(cle, { cle, fiche: null, reservations: [], factures: [] });
    return parCle.get(cle);
  };
  for (const c of clients) entree(c.id).fiche = c;
  for (const r of reservations) { const k = cleClient(r.telephone); if (k) entree(k).reservations.push(r); }
  for (const f of factures) { const k = f.clientCle || cleClient(f.client && f.client.telephone); if (k) entree(k).factures.push(f); }
  for (const e of parCle.values()) {
    e.derniere = e.reservations.map((r) => r.depart || "").sort().pop() || "";
    e.ca = e.factures.filter((f) => f.statut !== "Annulée").reduce((s, f) => s + (Number(f.totalTTC) || 0), 0);
    e.telephone = (e.fiche && e.fiche.telephone) || (e.reservations[0] && e.reservations[0].telephone) || "+" + e.cle;
    e.nom = nomClient(e.fiche);
  }
  return [...parCle.values()].sort((a, b) => b.derniere.localeCompare(a.derniere) || a.nom.localeCompare(b.nom));
}

function rendre() {
  const tous = regrouper();
  const q = recherche.toLowerCase().replace(/\s+/g, "");
  let visibles = tous;
  if (filtre === "fiche") visibles = visibles.filter((e) => !e.fiche);
  if (filtre === "noire") visibles = visibles.filter((e) => e.fiche && e.fiche.listeNoire);
  if (q) visibles = visibles.filter((e) => (e.nom + e.telephone + e.cle + (e.fiche?.email || "") + (e.fiche?.numeroPiece || "")).toLowerCase().replace(/\s+/g, "").includes(q));
  const mois = new Date().toISOString().slice(0, 7);
  section.innerHTML = `
    <div class="entete"><h1>Clients</h1><button class="bouton" id="nouveau-client">+ Nouveau client</button></div>
    <div class="kpis">
      <div class="kpi"><div class="valeur">${tous.length}</div><div class="libelle">Clients</div></div>
      <div class="kpi"><div class="valeur">${tous.filter((e) => e.reservations.length > 1).length}</div><div class="libelle">Clients fidèles (2+ locations)</div></div>
      <div class="kpi"><div class="valeur">${tous.filter((e) => e.reservations.some((r) => String(r.creeLe || "").startsWith(mois))).length}</div><div class="libelle">Actifs ce mois</div></div>
      <div class="kpi"><div class="valeur">${tous.filter((e) => !e.fiche).length}</div><div class="libelle">Sans fiche complète</div></div>
    </div>
    <div class="filtres">
      <input type="search" id="recherche" placeholder="Nom, téléphone, CIN…" value="${escAttr(recherche)}">
      ${[["", "Tous"], ["fiche", "Sans fiche"], ["noire", "Liste noire"]].map(([v, l]) => `<button data-filtre="${v}" class="${v === filtre ? "actif" : ""}">${l}</button>`).join("")}
    </div>
    <div class="disposition">
      <div class="liste">${visibles.length ? visibles.map((e) => ligne(e)).join("") : '<div class="vide">Aucun client.</div>'}</div>
      <div class="fiche" id="fiche-client"></div>
    </div>`;
  const champRecherche = section.querySelector("#recherche");
  champRecherche.addEventListener("input", () => {
    recherche = champRecherche.value;
    const pos = champRecherche.selectionStart;
    rendre();
    const nouveau = section.querySelector("#recherche");
    nouveau.focus();
    nouveau.setSelectionRange(pos, pos);
  });
  section.querySelector("#nouveau-client").addEventListener("click", () => { selection = "nouveau"; rendre(); });
  section.querySelectorAll("[data-filtre]").forEach((b) => b.addEventListener("click", () => { filtre = b.dataset.filtre; rendre(); }));
  section.querySelectorAll(".liste .ligne").forEach((l) => l.addEventListener("click", () => { selection = l.dataset.id; rendre(); }));
  rendreFiche(tous);
}

function ligne(e) {
  return `<div class="ligne${e.cle === selection ? " selectionnee" : ""}" data-id="${escAttr(e.cle)}">
      <div>
        <div class="ref">${escHTML(e.telephone)}</div>
        <div class="vehicule">${escHTML(e.nom || "Nom inconnu")}</div>
        <div class="dates">${e.reservations.length} location${e.reservations.length > 1 ? "s" : ""}${e.derniere ? " · dernière le " + formateDate(e.derniere.slice(0, 10)) : ""}${e.ca ? " · " + mad(e.ca) : ""}</div>
      </div>
      ${e.fiche && e.fiche.listeNoire ? badge("Liste noire") : !e.fiche ? badge("Sans fiche") : ""}
    </div>`;
}

async function rendreFiche(tous) {
  const zone = section.querySelector("#fiche-client");
  if (selection === "nouveau") return formulaire(zone, null, {});
  const e = tous.find((x) => x.cle === selection);
  if (!e) { zone.innerHTML = '<div class="vide">Sélectionnez un client dans la liste.</div>'; return; }
  const c = e.fiche;
  zone.innerHTML = `
    ${c && c.listeNoire ? `<p class="alerte">Liste noire${c.motifListeNoire ? " : " + escHTML(c.motifListeNoire) : ""}</p>` : ""}
    <h2>${escHTML(e.nom || "Nom inconnu")}</h2>
    <div class="ref">${escHTML(e.telephone)}${c && c.email ? " · " + escHTML(c.email) : ""}</div>
    <a class="whatsapp" target="_blank" rel="noopener" href="${escAttr(lienWhatsApp(e.telephone, "Bonjour, ici Malysia Car Pro. "))}">Écrire sur WhatsApp</a>
    <h3 class="sous-titre">Locations</h3>
    ${e.reservations.length ? `<ul class="mini-liste">${e.reservations.map((r) => `<li><a href="#reservations/${escAttr(r.id)}">${escHTML(r.vehiculeNom || nomModele(r.vehicule))} · ${formateDate(r.depart)}</a> ${badge(r.statut)}</li>`).join("")}</ul>` : '<p class="aide">Aucune location.</p>'}
    <h3 class="sous-titre">Factures</h3>
    ${e.factures.length ? `<ul class="mini-liste">${e.factures.map((f) => `<li><a href="#facturation/${escAttr(f.id)}">${escHTML(f.numero)} · ${mad(f.totalTTC)}</a> ${badge(f.statut)}</li>`).join("")}</ul>` : '<p class="aide">Aucune facture.</p>'}
    <h3 class="sous-titre">${c ? "Fiche client" : "Créer la fiche client"}</h3>
    <div id="zone-form"><p class="aide">Chargement…</p></div>`;
  let proposition = { telephone: e.telephone };
  if (!c) {
    // pas encore de fiche : on propose les informations du dernier dossier reçu
    const avecDossier = e.reservations.filter((r) => r.dossier).sort((a, b) => String(b.creeLe).localeCompare(String(a.creeLe)))[0];
    if (avecDossier) {
      try {
        const d = await lireDocument(`dossiers/${avecDossier.dossier}/prive`, "fiche", jeton());
        if (d) proposition = { ...d, telephone: e.telephone };
      } catch {}
      if (selection !== e.cle) return;
    }
  }
  formulaire(zone.querySelector("#zone-form"), c, proposition);
}

function formulaire(zone, c, proposition) {
  const d = c || proposition;
  zone.innerHTML = `
    ${!c && selection === "nouveau" ? "<h2>Nouveau client</h2>" : ""}
    ${!c && proposition.numeroPiece ? '<p class="aide">Pré-rempli avec le dernier dossier envoyé par le client.</p>' : ""}
    <form class="formulaire" id="form-client">
      ${champ({ nom: "prenom", libelle: "Prénom", valeur: d.prenom })}
      ${champ({ nom: "nom", libelle: "Nom", valeur: d.nom, attrs: "required" })}
      ${champ({ nom: "telephone", libelle: "Téléphone", valeur: d.telephone, type: "tel", attrs: `required ${c ? "readonly" : ""}` })}
      ${champ({ nom: "email", libelle: "E-mail", valeur: d.email, type: "email" })}
      ${champ({ nom: "adresse", libelle: "Adresse", valeur: d.adresse, large: true })}
      ${champ({ nom: "ville", libelle: "Ville", valeur: d.ville })}
      ${champ({ nom: "pays", libelle: "Pays", valeur: d.pays })}
      ${champ({ nom: "typePiece", libelle: "Pièce d'identité", valeur: d.typePiece, options: ["", "CIN", "Passeport", "Carte de séjour"] })}
      ${champ({ nom: "numeroPiece", libelle: "N° de pièce", valeur: d.numeroPiece })}
      ${champ({ nom: "numeroPermis", libelle: "N° de permis", valeur: d.numeroPermis })}
      ${champ({ nom: "dateNaissance", libelle: "Date de naissance", valeur: d.dateNaissance, type: "date" })}
      ${champ({ nom: "entreprise", libelle: "Société (client pro)", valeur: d.entreprise })}
      ${champ({ nom: "ice", libelle: "ICE de la société", valeur: d.ice })}
      ${champ({ nom: "notes", libelle: "Notes internes", valeur: d.notes, type: "textarea", large: true })}
      <label class="case large"><input type="checkbox" name="listeNoire" ${d.listeNoire ? "checked" : ""}> Liste noire (ne plus louer à ce client)</label>
      ${champ({ nom: "motifListeNoire", libelle: "Motif", valeur: d.motifListeNoire, large: true })}
      <button class="action large" type="submit">${c ? "Enregistrer" : "Créer la fiche"}</button>
      <p class="etat large" id="etat-client"></p>
    </form>`;
  const form = zone.querySelector("#form-client");
  form.addEventListener("submit", (ev) => { ev.preventDefault(); enregistrer(c, form); });
}

async function enregistrer(c, form) {
  const etatEl = form.querySelector("#etat-client");
  const donnees = { ...valeursFormulaire(form), modifieLe: new Date() };
  const cle = c ? c.id : cleClient(donnees.telephone);
  if (!cle) { etatEl.className = "etat large erreur"; etatEl.textContent = "Numéro de téléphone invalide."; return; }
  if (!c && etat.donnees.clients.some((x) => x.id === cle)) {
    etatEl.className = "etat large erreur"; etatEl.textContent = "Un client existe déjà avec ce numéro."; return;
  }
  await executer(etatEl, rendre, async () => {
    if (c) {
      await corrigerDocument("clients", c.id, donnees, jeton());
      Object.assign(c, donnees);
    } else {
      const cree = await creerDocument("clients", { ...donnees, creeLe: new Date() }, { ...jeton(), id: cle });
      etat.donnees.clients.push(cree);
      selection = cle;
    }
  });
}
