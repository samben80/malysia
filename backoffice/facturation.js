// Facturation : factures numérotées sans trou (F-2026-0001…), créées depuis
// une réservation ou à la main, avec le suivi des paiements et l'impression
// en PDF. Une facture émise ne se supprime pas : elle s'annule.
import { creerDocument, corrigerDocument, lireDocument } from "../assets/firestore-rest.js";
import { SOCIETE, FRAIS } from "../assets/contrat-modele.js";
import {
  etat, jeton, MODELES, cleClient, formateDate, mad, nombre, escHTML, escAttr, champ, valeursFormulaire,
  badge, executer, aujourdhuiISO, enLettres,
} from "./commun.js";
import { ficheClient, nomClient } from "./clients.js";

const TAUX_TVA = 20;
const MODES_PAIEMENT = ["Carte bancaire (CMI)", "Virement", "Espèces", "Chèque"];
const arrondi = (n) => Math.round(Number(n || 0) * 100) / 100;

let filtre = "";
let selection = null; // id de facture, ou "nouvelle"
let reservationSource = null;
let section = null;

export function afficherFacturation(el, param, param2) {
  section = el;
  if (param === "nouvelle") { selection = "nouvelle"; reservationSource = param2 || null; }
  else if (param) selection = param;
  rendre();
}

const paye = (f) => (f.paiements || []).reduce((s, p) => s + (Number(p.montant) || 0), 0);
const reste = (f) => (f.statut === "Annulée" ? 0 : arrondi(Number(f.totalTTC) - paye(f)));

function statutPaiement(f) {
  if (f.statut === "Annulée") return "Annulée";
  const p = paye(f);
  if (p >= Number(f.totalTTC) - 0.005) return "Payée";
  return p > 0 ? "Partiellement payée" : "À encaisser";
}

function rendre() {
  const { factures } = etat.donnees;
  const mois = aujourdhuiISO().slice(0, 7);
  const valides = factures.filter((f) => f.statut !== "Annulée");
  const caMois = valides.filter((f) => String(f.date).startsWith(mois)).reduce((s, f) => s + Number(f.totalTTC || 0), 0);
  const encaisseMois = valides.flatMap((f) => f.paiements || []).filter((p) => String(p.date).startsWith(mois)).reduce((s, p) => s + Number(p.montant || 0), 0);
  const aEncaisser = valides.reduce((s, f) => s + reste(f), 0);
  const tries = [...factures].sort((a, b) => String(b.numero).localeCompare(String(a.numero)));
  const visibles = filtre === "impayees" ? tries.filter((f) => reste(f) > 0)
    : filtre ? tries.filter((f) => f.statut === filtre) : tries;

  section.innerHTML = `
    <div class="entete"><h1>Facturation</h1><button class="bouton" id="nouvelle-facture">+ Nouvelle facture</button></div>
    <div class="kpis">
      <div class="kpi"><div class="valeur">${nombre(caMois)}</div><div class="libelle">Facturé ce mois (MAD TTC)</div></div>
      <div class="kpi"><div class="valeur">${nombre(encaisseMois)}</div><div class="libelle">Encaissé ce mois (MAD)</div></div>
      <div class="kpi"><div class="valeur">${nombre(aEncaisser)}</div><div class="libelle">Reste à encaisser (MAD)</div></div>
      <div class="kpi"><div class="valeur">${valides.filter((f) => reste(f) > 0).length}</div><div class="libelle">Factures impayées</div></div>
    </div>
    <div class="filtres">
      ${[["", "Toutes"], ["impayees", "À encaisser"], ["Payée", "Payées"], ["Annulée", "Annulées"]]
        .map(([v, l]) => `<button data-filtre="${v}" class="${v === filtre ? "actif" : ""}">${l}</button>`).join("")}
    </div>
    <div class="disposition">
      <div class="liste">${visibles.length ? visibles.map(ligne).join("") : `<div class="vide">${factures.length ? "Aucune facture pour ce filtre." : "Aucune facture. Créez-la depuis la fiche d'une réservation, ou avec « Nouvelle facture »."}</div>`}</div>
      <div class="fiche" id="fiche-facture"></div>
    </div>`;
  section.querySelector("#nouvelle-facture").addEventListener("click", () => { selection = "nouvelle"; reservationSource = null; rendre(); });
  section.querySelectorAll("[data-filtre]").forEach((b) => b.addEventListener("click", () => { filtre = b.dataset.filtre; rendre(); }));
  section.querySelectorAll(".liste .ligne").forEach((l) => l.addEventListener("click", () => { selection = l.dataset.id; rendre(); }));
  rendreFiche();
}

function ligne(f) {
  return `<div class="ligne${f.id === selection ? " selectionnee" : ""}" data-id="${escAttr(f.id)}">
      <div>
        <div class="ref">${escHTML(f.numero)} · ${formateDate(f.date)}</div>
        <div class="vehicule">${escHTML((f.client && f.client.nom) || "Client")}</div>
        <div class="dates">${mad(f.totalTTC)}${reste(f) > 0 && paye(f) > 0 ? " · reste " + mad(reste(f)) : ""}</div>
      </div>
      ${badge(f.statut)}
    </div>`;
}

function rendreFiche() {
  const zone = section.querySelector("#fiche-facture");
  if (selection === "nouvelle") return nouvelleFacture(zone);
  const f = etat.donnees.factures.find((x) => x.id === selection);
  if (!f) { zone.innerHTML = '<div class="vide">Sélectionnez une facture dans la liste.</div>'; return; }
  const c = f.client || {};
  zone.innerHTML = `
    ${badge(f.statut)}
    <h2>Facture ${escHTML(f.numero)}</h2>
    <div class="ref">du ${formateDate(f.date)}${f.reservationId ? ` · <a href="#reservations/${escAttr(f.reservationId)}">voir la réservation</a>` : ""}</div>
    <div class="champs">
      <div><span>Client</span>${escHTML(c.nom)}${c.ice ? "<br>ICE " + escHTML(c.ice) : ""}</div>
      <div><span>Téléphone</span>${escHTML(c.telephone || "—")}</div>
      <div><span>Total TTC</span>${mad(f.totalTTC)}</div>
      <div><span>Reste à payer</span>${mad(reste(f))}</div>
    </div>
    <table class="tableau">
      <thead><tr><th>Désignation</th><th>Qté</th><th>Montant TTC</th></tr></thead>
      <tbody>${(f.lignes || []).map((l) => `<tr><td>${escHTML(l.designation)}</td><td>${nombre(l.quantite)}</td><td>${mad(l.quantite * l.prixUnitaire)}</td></tr>`).join("")}</tbody>
    </table>
    <button class="action" id="imprimer">Imprimer / PDF</button>
    ${f.statut === "Annulée" ? `<p class="alerte">Annulée${f.motifAnnulation ? " : " + escHTML(f.motifAnnulation) : ""}</p>` : ""}
    <h3 class="sous-titre">Paiements</h3>
    ${(f.paiements || []).length ? `<ul class="mini-liste">${f.paiements.map((p) => `<li>${formateDate(p.date)} · ${mad(p.montant)} <small>${escHTML(p.mode)}</small></li>`).join("")}</ul>` : '<p class="aide">Aucun paiement enregistré.</p>'}
    ${f.statut !== "Annulée" && reste(f) > 0 ? `<form class="formulaire" id="form-paiement">
      ${champ({ nom: "montant", libelle: "Montant (MAD)", valeur: reste(f), type: "number", attrs: 'min="0.01" step="0.01" required' })}
      ${champ({ nom: "date", libelle: "Date", valeur: aujourdhuiISO(), type: "date", attrs: "required" })}
      ${champ({ nom: "mode", libelle: "Mode", valeur: MODES_PAIEMENT[0], options: MODES_PAIEMENT, large: true })}
      <button class="action secondaire large" type="submit">Enregistrer le paiement</button>
      <p class="etat large" id="etat-paiement"></p>
    </form>` : ""}
    ${f.statut !== "Annulée" ? '<button class="lien-danger" id="annuler-facture">Annuler cette facture</button><p class="etat" id="etat-annulation"></p>' : ""}`;
  zone.querySelector("#imprimer").addEventListener("click", () => imprimer(f));
  const formPaiement = zone.querySelector("#form-paiement");
  if (formPaiement) formPaiement.addEventListener("submit", (ev) => { ev.preventDefault(); ajouterPaiement(f, formPaiement); });
  const annuler = zone.querySelector("#annuler-facture");
  if (annuler) annuler.addEventListener("click", () => annulerFacture(f, zone.querySelector("#etat-annulation")));
}

async function ajouterPaiement(f, form) {
  const { montant, date, mode } = valeursFormulaire(form);
  const paiements = [...(f.paiements || []), { montant: arrondi(montant), date, mode }];
  const suivant = { ...f, paiements };
  const maj = { paiements, statut: statutPaiement(suivant) };
  await executer(form.querySelector("#etat-paiement"), rendre, async () => {
    await corrigerDocument("factures", f.id, maj, jeton());
    Object.assign(f, maj);
  });
}

async function annulerFacture(f, etatEl) {
  const motif = prompt("Motif de l'annulation (la facture garde son numéro et reste consultable) :");
  if (motif === null) return;
  const maj = { statut: "Annulée", motifAnnulation: motif.trim(), annuleeLe: new Date() };
  await executer(etatEl, rendre, async () => {
    await corrigerDocument("factures", f.id, maj, jeton());
    Object.assign(f, maj);
    if (f.reservationId) {
      const r = etat.donnees.reservations.find((x) => x.id === f.reservationId);
      if (r && r.facture === f.id) {
        await corrigerDocument("reservations", r.id, { facture: "" }, jeton());
        r.facture = "";
      }
    }
  });
}

// ---- nouvelle facture

async function propositionDepuisReservation(r) {
  const tarif = MODELES[r.vehicule] || {};
  const jours = Math.max(1, Math.ceil((new Date(r.retour) - new Date(r.depart)) / 86400000) || 1);
  let prixTotal = tarif.prixJour ? tarif.prixJour * jours : 0;
  let immat = r.immatriculation || "";
  let options = "";
  if (r.contrat) {
    try {
      const contrat = await lireDocument("contrats", r.contrat, jeton());
      if (contrat) {
        if (contrat.location && contrat.location.prixTotal !== "" && contrat.location.prixTotal != null) prixTotal = Number(contrat.location.prixTotal);
        if (contrat.vehicule && contrat.vehicule.immatriculation) immat = immat || contrat.vehicule.immatriculation;
        options = (contrat.location && contrat.location.options) || "";
      }
    } catch {}
  }
  const libelle = `Location ${r.vehiculeNom || tarif.nom || ""}${immat ? " (" + immat + ")" : ""} du ${formateDate(String(r.depart).slice(0, 10))} au ${formateDate(String(r.retour).slice(0, 10))}${options ? " — " + options : ""}`;
  const lignes = tarif.prixJour && prixTotal === tarif.prixJour * jours
    ? [{ designation: libelle, quantite: jours, prixUnitaire: tarif.prixJour }]
    : [{ designation: `${libelle} (${jours} jour${jours > 1 ? "s" : ""})`, quantite: 1, prixUnitaire: prixTotal }];
  if (r.kmDepart !== undefined && r.kmRetour !== undefined && r.kmDepart !== "" && r.kmRetour !== "") {
    const exces = Number(r.kmRetour) - Number(r.kmDepart) - FRAIS.kmInclusParJour * jours;
    if (exces > 0) lignes.push({ designation: `Kilomètres supplémentaires (au-delà de ${FRAIS.kmInclusParJour} km/jour)`, quantite: exces, prixUnitaire: tarif.kmSup || 3 });
  }
  const c = ficheClient(r.telephone) || {};
  return {
    client: { nom: c.entreprise || nomClient(c), adresse: [c.adresse, c.ville, c.pays].filter(Boolean).join(", "), ice: c.ice || "", telephone: r.telephone || "" },
    lignes,
  };
}

async function nouvelleFacture(zone) {
  const r = reservationSource && etat.donnees.reservations.find((x) => x.id === reservationSource);
  zone.innerHTML = '<p class="aide">Préparation…</p>';
  const proposition = r ? await propositionDepuisReservation(r)
    : { client: { nom: "", adresse: "", ice: "", telephone: "" }, lignes: [{ designation: "", quantite: 1, prixUnitaire: 0 }] };
  if (selection !== "nouvelle") return;
  zone.innerHTML = `
    <h2>Nouvelle facture</h2>
    ${r ? `<p class="aide">Pré-remplie depuis la réservation ${escHTML(r.id.slice(0, 8).toUpperCase())}. Vérifiez les lignes avant d'émettre : une facture émise ne se modifie plus, elle s'annule.</p>` : ""}
    <form class="formulaire" id="form-facture">
      ${champ({ nom: "nom", libelle: "Client (nom ou société)", valeur: proposition.client.nom, attrs: "required", large: true })}
      ${champ({ nom: "adresse", libelle: "Adresse", valeur: proposition.client.adresse, large: true })}
      ${champ({ nom: "telephone", libelle: "Téléphone", valeur: proposition.client.telephone, type: "tel" })}
      ${champ({ nom: "ice", libelle: "ICE (client pro)", valeur: proposition.client.ice })}
      ${champ({ nom: "date", libelle: "Date de facture", valeur: aujourdhuiISO(), type: "date", attrs: "required" })}
      <div class="large">
        <table class="tableau lignes-facture">
          <thead><tr><th>Désignation</th><th>Qté</th><th>P.U. TTC</th><th></th></tr></thead>
          <tbody></tbody>
        </table>
        <button type="button" class="bouton secondaire" id="ajouter-ligne">+ Ajouter une ligne</button>
      </div>
      <p class="large total-facture" id="total-facture"></p>
      <button class="action large" type="submit">Émettre la facture</button>
      <button class="action secondaire large" type="button" id="annuler">Annuler</button>
      <p class="etat large" id="etat-facture"></p>
    </form>`;
  const corps = zone.querySelector(".lignes-facture tbody");
  const ajouterLigne = (l) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><input name="designation" value="${escAttr(l.designation)}" required></td>
      <td><input name="quantite" type="number" min="0" step="any" value="${escAttr(l.quantite)}" required></td>
      <td><input name="prixUnitaire" type="number" min="0" step="0.01" value="${escAttr(l.prixUnitaire)}" required></td>
      <td><button type="button" class="retirer" title="Retirer la ligne">✕</button></td>`;
    tr.querySelector(".retirer").addEventListener("click", () => { tr.remove(); total(); });
    corps.appendChild(tr);
  };
  const lire = () => [...corps.querySelectorAll("tr")].map((tr) => ({
    designation: tr.querySelector('[name="designation"]').value.trim(),
    quantite: Number(tr.querySelector('[name="quantite"]').value || 0),
    prixUnitaire: arrondi(tr.querySelector('[name="prixUnitaire"]').value),
  }));
  const total = () => {
    const t = totaux(lire());
    zone.querySelector("#total-facture").innerHTML = `Total HT ${mad(t.totalHT)} · TVA ${TAUX_TVA} % ${mad(t.tva)} · <b>Total TTC ${mad(t.totalTTC)}</b>`;
  };
  proposition.lignes.forEach(ajouterLigne);
  total();
  corps.addEventListener("input", total);
  zone.querySelector("#ajouter-ligne").addEventListener("click", () => { ajouterLigne({ designation: "", quantite: 1, prixUnitaire: 0 }); total(); });
  zone.querySelector("#annuler").addEventListener("click", () => { selection = null; rendre(); });
  const form = zone.querySelector("#form-facture");
  form.addEventListener("submit", (ev) => { ev.preventDefault(); emettre(form, lire(), r); });
}

function totaux(lignes) {
  const totalTTC = arrondi(lignes.reduce((s, l) => s + l.quantite * l.prixUnitaire, 0));
  const totalHT = arrondi(totalTTC / (1 + TAUX_TVA / 100));
  return { totalTTC, totalHT, tva: arrondi(totalTTC - totalHT) };
}

async function emettre(form, lignes, r) {
  const etatEl = form.querySelector("#etat-facture");
  const lignesValides = lignes.filter((l) => l.designation && l.quantite > 0);
  if (!lignesValides.length) { etatEl.className = "etat large erreur"; etatEl.textContent = "Ajoutez au moins une ligne."; return; }
  const v = valeursFormulaire(form);
  const t = totaux(lignesValides);
  const donnees = {
    date: v.date,
    reservationId: r ? r.id : "",
    clientCle: cleClient(v.telephone),
    client: { nom: v.nom, adresse: v.adresse, ice: v.ice, telephone: v.telephone },
    lignes: lignesValides,
    tauxTVA: TAUX_TVA,
    ...t,
    paiements: [],
    statut: "À encaisser",
    societe: { ...SOCIETE },
    creeLe: new Date(),
  };
  await executer(etatEl, rendre, async () => {
    // Numérotation continue par année : on prend le numéro suivant et, si un
    // autre poste l'a pris entre-temps (409), on passe au suivant.
    const annee = v.date.slice(0, 4);
    const prefixe = `F-${annee}-`;
    let n = etat.donnees.factures.filter((f) => String(f.id).startsWith(prefixe))
      .reduce((max, f) => Math.max(max, Number(String(f.id).slice(prefixe.length)) || 0), 0);
    let cree = null;
    for (let essai = 0; essai < 10 && !cree; essai++) {
      n++;
      const numero = prefixe + String(n).padStart(4, "0");
      try {
        cree = await creerDocument("factures", { ...donnees, numero }, { ...jeton(), id: numero });
      } catch (e) { if (e.status !== 409) throw e; }
    }
    if (!cree) throw new Error("numérotation impossible, rechargez la page.");
    etat.donnees.factures.push(cree);
    if (r) {
      await corrigerDocument("reservations", r.id, { facture: cree.id }, jeton());
      r.facture = cree.id;
    }
    selection = cree.id;
    reservationSource = null;
  });
}

// ---- impression (PDF via la boîte d'impression du navigateur)

function imprimer(f) {
  const s = f.societe || SOCIETE;
  const c = f.client || {};
  const legales = [s.rc && `RC ${s.rc}`, s.ice && `ICE ${s.ice}`, s.identifiantFiscal && `IF ${s.identifiantFiscal}`, s.patente && `Patente ${s.patente}`].filter(Boolean).join(" · ");
  const zone = document.getElementById("impression");
  zone.innerHTML = `<div class="facture-imprimee">
    <div class="fi-entete">
      <div><img src="../assets/logo-full.webp" alt="" style="height:46px"><p>${escHTML([s.nom, s.groupe].filter(Boolean).join(" — "))}<br>${escHTML(s.adresse || "")}<br>${escHTML([s.telephone, s.email].filter(Boolean).join(" · "))}</p></div>
      <div class="fi-titre"><h1>Facture</h1><p>N° <b>${escHTML(f.numero)}</b><br>du ${formateDate(f.date)}</p>${f.statut === "Annulée" ? '<p class="fi-annulee">ANNULÉE</p>' : ""}</div>
    </div>
    <div class="fi-client"><span>Facturé à</span><b>${escHTML(c.nom)}</b>${c.adresse ? "<br>" + escHTML(c.adresse) : ""}${c.ice ? "<br>ICE : " + escHTML(c.ice) : ""}${c.telephone ? "<br>Tél. : " + escHTML(c.telephone) : ""}</div>
    <table>
      <thead><tr><th>Désignation</th><th>Qté</th><th>P.U. TTC</th><th>Montant TTC</th></tr></thead>
      <tbody>${(f.lignes || []).map((l) => `<tr><td>${escHTML(l.designation)}</td><td>${nombre(l.quantite)}</td><td>${mad(l.prixUnitaire)}</td><td>${mad(l.quantite * l.prixUnitaire)}</td></tr>`).join("")}</tbody>
    </table>
    <table class="fi-totaux">
      <tr><td>Total HT</td><td>${mad(f.totalHT)}</td></tr>
      <tr><td>TVA ${nombre(f.tauxTVA)} %</td><td>${mad(f.tva)}</td></tr>
      <tr><td><b>Total TTC</b></td><td><b>${mad(f.totalTTC)}</b></td></tr>
      ${paye(f) ? `<tr><td>Déjà réglé</td><td>${mad(paye(f))}</td></tr><tr><td><b>Reste à payer</b></td><td><b>${mad(reste(f))}</b></td></tr>` : ""}
    </table>
    <p class="fi-lettres">Arrêtée la présente facture à la somme de : <b>${escHTML(enLettres(f.totalTTC))} TTC</b>.</p>
    <p class="fi-pied">${escHTML([s.nom, legales].filter(Boolean).join(" · "))}</p>
  </div>`;
  const img = zone.querySelector("img");
  const lancer = () => window.print();
  if (img.complete) lancer(); else { img.onload = lancer; img.onerror = lancer; }
}
