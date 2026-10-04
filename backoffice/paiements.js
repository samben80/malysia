// Paiements des locations. Le montant dû d'une réservation est celui du
// contrat (prix de la location), plus les suppléments constatés au retour
// (kilomètres, retard, frais). Une location qui roule est une location due.
//
// Règle de livraison : les clés ne sont remises que si la location est réglée
// d'avance. Seuls les clients « en compte » (fiche client) peuvent partir
// sans payer, dans la limite de leur plafond d'encours s'il est fixé.
import { corrigerDocument } from "../assets/firestore-rest.js";
import {
  etat, jeton, MODELES, cleClient, formateDate, mad, escHTML, escAttr, champ, valeursFormulaire, badge,
  aujourdhuiISO, decalerJours, barreFiltres, lierFiltres, contientTexte, executer,
} from "./commun.js";
import { ficheClient, nomClient } from "./clients.js";
import { nombreJours, prixLocation } from "../assets/tarification.js";

export const MODES_PAIEMENT = ["Espèces", "Carte bancaire (CMI)", "Virement", "Chèque"];
export const DELAI_PAIEMENT_JOURS = 30; // clients en compte, sauf délai propre à la fiche
const STATUTS_AVANT_DEPART = ["Confirmée", "Payée", "Prête à livrer"];
const STATUTS_DUS = ["En cours", "Terminée"]; // location partie : le montant est dû
const arrondi = (n) => Math.round(Number(n || 0) * 100) / 100;
const somme = (liste) => arrondi((liste || []).reduce((s, x) => s + (Number(x.montant) || 0), 0));

export const joursLocation = (r) => nombreJours(r.depart, r.retour);
// Prix calculé par la grille du modèle (tranche de durée × coefficient du mois de chaque jour).
export const prixGrille = (r) => prixLocation(MODELES[r.vehicule], r.depart, r.retour);

// ---- montants d'une réservation

const prixSaisi = (r) => r.prixTotal !== undefined && r.prixTotal !== null && r.prixTotal !== "";
export function montantLocation(r) {
  if (prixSaisi(r)) return arrondi(r.prixTotal);
  return prixGrille(r).total;
}
export const montantDu = (r) => arrondi(montantLocation(r) + somme(r.supplements));
export const montantPaye = (r) => somme(r.paiements);
export const solde = (r) => (r.statut === "Annulée" ? 0 : arrondi(montantDu(r) - montantPaye(r)));

export function clientEnCompte(telephone) {
  const c = ficheClient(telephone);
  return c && c.enCompte && !c.listeNoire ? c : null;
}

// Somme due par un client sur ses locations parties (en cours ou terminées).
export function encoursClient(telephone, saufId = "") {
  const cle = cleClient(telephone);
  if (!cle) return 0;
  return arrondi(etat.donnees.reservations
    .filter((r) => r.id !== saufId && cleClient(r.telephone) === cle && STATUTS_DUS.includes(r.statut))
    .reduce((s, r) => s + Math.max(0, solde(r)), 0));
}

// Date à laquelle le montant doit être réglé : avant le départ, ou à
// réception pour un client en compte (retour + délai de paiement).
export function echeance(r) {
  const c = clientEnCompte(r.telephone);
  if (c) return decalerJours(String(r.retourLe || r.retour || "").slice(0, 10) || aujourdhuiISO(), Number(c.delaiPaiement) || DELAI_PAIEMENT_JOURS);
  return String(r.depart || "").slice(0, 10);
}
export const enRetardDePaiement = (r) => solde(r) > 0.005 && STATUTS_DUS.includes(r.statut) && echeance(r) < aujourdhuiISO();

export function etatPaiement(r) {
  if (r.statut === "Annulée") return "";
  const du = montantDu(r), paye = montantPaye(r);
  if (du > 0 && paye >= du - 0.005) return paye > du + 0.005 ? "Trop-perçu" : "Réglée";
  if (paye > 0) return "Acompte versé";
  return clientEnCompte(r.telephone) ? "En compte" : "À encaisser";
}

// Peut-on remettre les clés ?
export function autorisationLivraison(r) {
  const reste = solde(r);
  const c = ficheClient(r.telephone);
  if (c && c.listeNoire) return { ok: false, motif: "Client en liste noire : pas de remise de véhicule." };
  if (montantDu(r) <= 0) return { ok: false, motif: "Le montant de la location n'est pas connu : saisissez-le dans le bloc Paiement ou dans le contrat." };
  if (reste <= 0.005) return { ok: true, motif: "Location réglée d'avance." };
  if (c && c.enCompte) {
    const plafond = Number(c.plafondEncours) || 0;
    const apres = arrondi(encoursClient(r.telephone, r.id) + reste);
    if (plafond && apres > plafond) {
      return { ok: false, motif: `Client en compte, mais son encours passerait à ${mad(apres)} pour un plafond de ${mad(plafond)}. Encaissez un acompte ou relevez le plafond dans sa fiche.` };
    }
    return { ok: true, compte: true, motif: `Client en compte : livraison autorisée sans paiement. ${mad(reste)} seront dus, à régler avant le ${formateDate(echeance(r))}.` };
  }
  return { ok: false, motif: `Paiement d'avance requis : il reste ${mad(reste)} à encaisser. Seuls les clients en compte peuvent partir sans avoir payé.` };
}

// « Confirmée » devient « Payée » quand tout est réglé, et inversement si le montant augmente.
function statutSelonPaiement(r) {
  if (r.statut === "Confirmée" && montantDu(r) > 0 && solde(r) <= 0.005) return "Payée";
  if (r.statut === "Payée" && solde(r) > 0.005) return "Confirmée";
  return null;
}

export async function majMontantLocation(r, prixTotal) {
  const maj = { prixTotal: prixTotal === "" ? "" : arrondi(prixTotal) };
  const statut = statutSelonPaiement({ ...r, ...maj });
  if (statut) maj.statut = statut;
  await corrigerDocument("reservations", r.id, maj, jeton());
  Object.assign(r, maj);
}

// Statut d'une facture d'après ses paiements (repris par la facturation).
export function statutFacture(f) {
  if (f.statut === "Annulée") return "Annulée";
  const p = somme(f.paiements);
  if (p >= Number(f.totalTTC) - 0.005) return "Payée";
  return p > 0 ? "Partiellement payée" : "À encaisser";
}

// Un paiement est noté sur la réservation et sur sa facture, s'il y en a une.
export async function enregistrerPaiement(r, paiement) {
  const p = { montant: arrondi(paiement.montant), date: paiement.date || aujourdhuiISO(), mode: paiement.mode || "", reference: paiement.reference || "" };
  const maj = { paiements: [...(r.paiements || []), p] };
  const statut = statutSelonPaiement({ ...r, ...maj });
  if (statut) maj.statut = statut;
  await corrigerDocument("reservations", r.id, maj, jeton());
  Object.assign(r, maj);
  const f = r.facture && etat.donnees.factures.find((x) => x.id === r.facture);
  if (f && f.statut !== "Annulée") {
    const paiements = [...(f.paiements || []), { montant: p.montant, date: p.date, mode: p.mode }];
    const majF = { paiements, statut: statutFacture({ ...f, paiements }) };
    await corrigerDocument("factures", f.id, majF, jeton());
    Object.assign(f, majF);
  }
}

// ---- bloc « Paiement » de la fiche réservation

export function renderBlocPaiement(bloc, r, rafraichir) {
  const du = montantDu(r), paye = montantPaye(r), reste = solde(r);
  const compte = clientEnCompte(r.telephone);
  const avantDepart = ["À confirmer", ...STATUTS_AVANT_DEPART].includes(r.statut);
  const estimation = !prixSaisi(r);
  const e = etatPaiement(r);
  bloc.innerHTML = `<h3>Paiement ${e ? badge(e) : ""}</h3>
    ${compte ? `<p class="aide">Client en compte${compte.plafondEncours ? `, plafond ${mad(compte.plafondEncours)}` : ""}, paiement à ${Number(compte.delaiPaiement) || DELAI_PAIEMENT_JOURS} jours. Encours actuel : ${mad(encoursClient(r.telephone, r.id))}.</p>` : ""}
    <table class="tableau montants">
      <tr><td>Location${estimation ? " <small>(estimation d'après la grille)</small>" : ""}</td><td>${mad(montantLocation(r))}</td></tr>
      ${(r.supplements || []).map((s) => `<tr><td>${escHTML(s.libelle)}</td><td>${mad(s.montant)}</td></tr>`).join("")}
      <tr><td><b>Total dû</b></td><td><b>${mad(du)}</b></td></tr>
      <tr><td>Déjà payé</td><td>${mad(paye)}</td></tr>
      <tr class="${reste > 0.005 ? "reste-du" : ""}"><td><b>${reste < -0.005 ? "Trop-perçu à rembourser" : "Reste à payer"}</b></td><td><b>${mad(Math.abs(reste))}</b></td></tr>
    </table>
    ${(r.paiements || []).length ? `<ul class="mini-liste">${r.paiements.map((p) => `<li>${formateDate(p.date)} · ${mad(p.montant)} <small>${escHTML([p.mode, p.reference].filter(Boolean).join(" · "))}</small></li>`).join("")}</ul>` : ""}
    ${r.statut !== "Annulée" && reste > 0.005 ? `<form class="formulaire" id="form-encaissement" data-droit="paiements:modifier">
      ${champ({ nom: "montant", libelle: "Montant encaissé (MAD)", valeur: reste, type: "number", attrs: 'min="0.01" step="0.01" required' })}
      ${champ({ nom: "date", libelle: "Date", valeur: aujourdhuiISO(), type: "date", attrs: "required" })}
      ${champ({ nom: "mode", libelle: "Mode", valeur: MODES_PAIEMENT[0], options: MODES_PAIEMENT })}
      ${champ({ nom: "reference", libelle: "Référence (n° de chèque, virement…)", valeur: "" })}
      <button class="action large" type="submit">Enregistrer le paiement</button>
      <p class="etat large" id="etat-encaissement"></p>
    </form>` : ""}
    ${avantDepart && !r.contrat ? `<details class="petit" data-droit="paiements:modifier"><summary>Modifier le montant de la location</summary>
      <form class="formulaire" id="form-montant">
        ${champ({ nom: "prixTotal", libelle: "Montant total TTC convenu (MAD)", valeur: prixSaisi(r) ? r.prixTotal : montantLocation(r) || "", type: "number", attrs: 'min="0" step="0.01" required' })}
        <button class="action secondaire" type="submit">Enregistrer le montant</button>
        <p class="etat large" id="etat-montant"></p>
      </form></details>` : r.contrat ? '<p class="aide">Le montant de la location est celui du contrat.</p>' : ""}`;
  const form = bloc.querySelector("#form-encaissement");
  if (form) form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const v = valeursFormulaire(form);
    executer(form.querySelector("#etat-encaissement"), rafraichir, () => enregistrerPaiement(r, v));
  });
  const formMontant = bloc.querySelector("#form-montant");
  if (formMontant) formMontant.addEventListener("submit", (ev) => {
    ev.preventDefault();
    executer(formMontant.querySelector("#etat-montant"), rafraichir, () => majMontantLocation(r, valeursFormulaire(formMontant).prixTotal));
  });
}

// ---- écran « Paiements » : ce qui est dû, location par location

let filtre = "dus";
const criteres = { texte: "" };
let section = null;

export function afficherPaiements(el, param, param2) {
  section = el;
  if (param === "filtre") filtre = param2 || "";
  rendre();
}

export function nombreImpayes() {
  return etat.donnees.reservations.filter((r) => STATUTS_DUS.includes(r.statut) && solde(r) > 0.005).length;
}

function rendre() {
  const resas = etat.donnees.reservations.filter((r) => r.statut !== "Annulée" && r.statut !== "À confirmer");
  const total = (liste) => arrondi(liste.reduce((s, r) => s + Math.max(0, solde(r)), 0));
  const enCours = resas.filter((r) => r.statut === "En cours" && solde(r) > 0.005);
  const terminees = resas.filter((r) => r.statut === "Terminée" && solde(r) > 0.005);
  const avant = resas.filter((r) => STATUTS_AVANT_DEPART.includes(r.statut) && solde(r) > 0.005);
  const mois = aujourdhuiISO().slice(0, 7);
  const encaisseMois = arrondi(resas.flatMap((r) => r.paiements || []).filter((p) => String(p.date).startsWith(mois)).reduce((s, p) => s + (Number(p.montant) || 0), 0)
    + etat.donnees.factures.filter((f) => !f.reservationId && f.statut !== "Annulée").flatMap((f) => f.paiements || [])
      .filter((p) => String(p.date).startsWith(mois)).reduce((s, p) => s + (Number(p.montant) || 0), 0));
  const enRetard = resas.filter(enRetardDePaiement);
  section.innerHTML = `
    <div class="entete"><h1>Paiements</h1></div>
    <p class="aide-ecran">Une location qui roule est due. Les clés ne sont remises qu'après paiement, sauf aux clients en compte.</p>
    <div class="kpis">
      <div class="kpi"><div class="valeur">${nombreFormat(total(enCours))}</div><div class="libelle">Dû sur locations en cours (MAD)</div></div>
      <div class="kpi"><div class="valeur">${nombreFormat(total(terminees))}</div><div class="libelle">Impayé après retour (MAD)</div></div>
      <div class="kpi"><div class="valeur">${nombreFormat(total(avant))}</div><div class="libelle">À encaisser avant départ (MAD)</div></div>
      <div class="kpi"><div class="valeur">${nombreFormat(encaisseMois)}</div><div class="libelle">Encaissé ce mois (MAD)</div></div>
    </div>
    <div class="filtres">
      ${[["dus", `Dus (${enCours.length + terminees.length})`], ["retard", `Échéance dépassée (${enRetard.length})`], ["avant", `Avant départ (${avant.length})`],
        ["compte", "Clients en compte"], ["regles", "Réglées"], ["", "Toutes"]]
        .map(([v, l]) => `<button data-filtre="${v}" class="${v === filtre ? "actif" : ""}">${escHTML(l)}</button>`).join("")}
    </div>
    ${barreFiltres(criteres, { recherche: "Rechercher : client, téléphone, véhicule, immatriculation…", menus: [] })}
    <p class="compte-filtre" id="compte-paiements"></p>
    <div class="disposition">
      <div class="liste" id="liste-paiements"></div>
      <div class="fiche">${panneauComptes()}</div>
    </div>`;
  section.querySelectorAll("[data-filtre]").forEach((b) => b.addEventListener("click", () => { filtre = b.dataset.filtre; rendre(); }));
  lierFiltres(section.querySelector(".barre-filtres"), criteres, rendreListe);
  rendreListe();
}

const nombreFormat = (n) => mad(n).replace(/\s*MAD$/, "");

function visibles() {
  return etat.donnees.reservations.filter((r) => {
    if (r.statut === "Annulée" || r.statut === "À confirmer") return false;
    const reste = solde(r);
    switch (filtre) {
      case "dus": if (!(STATUTS_DUS.includes(r.statut) && reste > 0.005)) return false; break;
      case "retard": if (!enRetardDePaiement(r)) return false; break;
      case "avant": if (!(STATUTS_AVANT_DEPART.includes(r.statut) && reste > 0.005)) return false; break;
      case "compte": if (!clientEnCompte(r.telephone)) return false; break;
      case "regles": if (reste > 0.005) return false; break;
      default: break;
    }
    const c = ficheClient(r.telephone);
    return contientTexte(criteres.texte, nomClient(c), c && c.entreprise, r.telephone, r.vehiculeNom, r.immatriculation, r.id);
  }).sort((a, b) => STATUTS_DUS.indexOf(b.statut) - STATUTS_DUS.indexOf(a.statut) || echeance(a).localeCompare(echeance(b)));
}

function rendreListe() {
  const liste = section.querySelector("#liste-paiements");
  const lignes = visibles();
  const du = arrondi(lignes.reduce((s, r) => s + Math.max(0, solde(r)), 0));
  section.querySelector("#compte-paiements").textContent = lignes.length ? `${lignes.length} location${lignes.length > 1 ? "s" : ""} · reste à payer ${mad(du)}` : "";
  liste.innerHTML = lignes.length ? lignes.map(ligne).join("") : '<div class="vide">Aucune location pour ce filtre.</div>';
  liste.querySelectorAll(".ligne").forEach((l) => l.addEventListener("click", () => { location.hash = `#reservations/${encodeURIComponent(l.dataset.id)}`; }));
}

function ligne(r) {
  const c = ficheClient(r.telephone);
  const reste = solde(r);
  const retard = enRetardDePaiement(r);
  return `<div class="ligne" data-id="${escAttr(r.id)}">
      <div>
        <div class="ref">${escHTML(r.statut)}${r.immatriculation ? ` · <span class="immat">${escHTML(r.immatriculation)}</span>` : ""}${clientEnCompte(r.telephone) ? " · en compte" : ""}</div>
        <div class="vehicule">${escHTML(nomClient(c) || (c && c.entreprise) || r.telephone || "Client")} <small>· ${escHTML(r.vehiculeNom || "")}</small></div>
        <div class="dates">${formateDate(r.depart)} → ${formateDate(r.retour)} · dû ${mad(montantDu(r))}, payé ${mad(montantPaye(r))}${reste > 0.005 ? ` · <b class="${retard ? "txt-alerte" : ""}">reste ${mad(reste)}${retard ? `, échu le ${formateDate(echeance(r))}` : ""}</b>` : ""}</div>
      </div>
      ${badge(etatPaiement(r) || r.statut)}
    </div>`;
}

function panneauComptes() {
  const comptes = etat.donnees.clients.filter((c) => c.enCompte);
  if (!comptes.length) {
    return '<h3 class="sous-titre">Clients en compte</h3><p class="aide">Aucun client en compte. Pour autoriser un client à partir sans payer d\'avance, cochez « Client en compte » dans sa fiche (menu Clients).</p>';
  }
  return `<h3 class="sous-titre">Clients en compte</h3>
    <table class="tableau">
      <thead><tr><th>Client</th><th>Encours</th><th>Plafond</th></tr></thead>
      <tbody>${comptes.map((c) => {
        const encours = encoursClient(c.telephone || c.id);
        const depasse = Number(c.plafondEncours) && encours > Number(c.plafondEncours);
        return `<tr><td><a href="#clients/${escAttr(c.id)}">${escHTML(c.entreprise || nomClient(c) || c.id)}</a></td><td class="${depasse ? "txt-alerte" : ""}">${mad(encours)}</td><td>${c.plafondEncours ? mad(c.plafondEncours) : "—"}</td></tr>`;
      }).join("")}</tbody>
    </table>`;
}
