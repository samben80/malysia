// Tableau de bord : la journée d'une agence de location en un écran.
// Départs et retours du jour, demandes à confirmer, livraisons en attente,
// contrats en cours, sommes dues, véhicules indisponibles, documents
// administratifs à renouveler et entretiens à prévoir. Chaque ligne mène à la
// fiche concernée, chaque carte à la liste complète déjà filtrée.
import {
  etat, chargerTout, MODELES, nomModele, alertesVehicule, DOCUMENTS_VEHICULE, formateDate, mad, escHTML, escAttr, badge,
  aujourdhuiISO, maintenantISO, decalerJours, peut,
} from "./commun.js";
import { ficheClient, nomClient } from "./clients.js";
import { libelleCreneau, finCreneau } from "../assets/creneaux.js";
import { solde, etatPaiement, autorisationLivraison, enRetardDePaiement, montantPaye } from "./paiements.js";

const AVANT_LIVRAISON = ["Confirmée", "Payée", "Prête à livrer"];
const MAX_LIGNES = 6;
let section = null;

export function afficherTableau(el) {
  section = el;
  rendre();
}

const lien = (hash, ...parties) => "#" + [hash, ...parties.map(encodeURIComponent)].join("/");
const client = (r) => { const c = ficheClient(r.telephone); return nomClient(c) || (c && c.entreprise) || r.telephone || "Client"; };
const jour = (d) => String(d || "").slice(0, 10);
const heure = (d) => { const c = libelleCreneau(d); return /^\d/.test(c) ? c : c.toLowerCase(); };

function donnees() {
  const { reservations, vehicules } = etat.donnees;
  const auj = aujourdhuiISO(), maintenant = maintenantISO(), dans30 = decalerJours(auj, 30);
  const actives = vehicules.filter((v) => v.statut !== "Hors service");
  const conformite = [];
  for (const v of actives) {
    for (const [cle, libelle] of DOCUMENTS_VEHICULE) {
      if (v[cle] && v[cle] <= dans30) conformite.push({ v, libelle, date: v[cle], expire: v[cle] < auj });
    }
  }
  conformite.sort((a, b) => a.date.localeCompare(b.date));
  const entretien = actives
    .map((v) => ({ v, alertes: alertesVehicule(v).filter((a) => /Vidange|vidange|Pneus/.test(a.texte) && !/^Aucune vidange/.test(a.texte)) }))
    .filter((x) => x.alertes.length);
  const parDepart = (a, b) => String(a.depart).localeCompare(String(b.depart));
  return {
    auj, maintenant,
    departs: reservations.filter((r) => AVANT_LIVRAISON.includes(r.statut) && jour(r.depart) === auj).sort(parDepart),
    retours: reservations.filter((r) => r.statut === "En cours" && jour(r.retour) === auj).sort((a, b) => String(a.retour).localeCompare(String(b.retour))),
    aConfirmer: reservations.filter((r) => r.statut === "À confirmer").sort(parDepart),
    aLivrer: reservations.filter((r) => AVANT_LIVRAISON.includes(r.statut)).sort(parDepart),
    enCours: reservations.filter((r) => r.statut === "En cours").sort((a, b) => String(a.retour).localeCompare(String(b.retour))),
    impayes: reservations.filter((r) => ["En cours", "Terminée"].includes(r.statut) && solde(r) > 0.005)
      .sort((a, b) => enRetardDePaiement(b) - enRetardDePaiement(a) || solde(b) - solde(a)),
    indisponibles: vehicules.filter((v) => v.statut === "En réparation" || v.statut === "Hors service")
      .sort((a, b) => (a.statut === "Hors service") - (b.statut === "Hors service") || String(a.disponibleLe || "9").localeCompare(String(b.disponibleLe || "9"))),
    conformite, entretien, vehicules, actives,
  };
}

function rendre() {
  const d = donnees();
  const compte = (s) => d.vehicules.filter((v) => v.statut === s).length;
  const occupation = d.actives.length ? Math.round((compte("En circulation") / d.actives.length) * 100) : 0;
  const resteDu = d.impayes.reduce((s, r) => s + solde(r), 0);
  const retardsRetour = d.enCours.filter((r) => finCreneau(r.retour) < d.maintenant).length;
  const livraisonsBloquees = d.aLivrer.filter((r) => !autorisationLivraison(r).ok).length;
  const expires = d.conformite.filter((c) => c.expire).length;
  const resa = peut("reservations"), flotte = peut("flotte");

  section.innerHTML = `
    <div class="entete"><h1>Tableau de bord</h1>
      <div class="actions-entete"><span class="date">${escHTML(new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }))}</span>
      <button class="bouton secondaire" id="actualiser-tableau">Actualiser</button></div></div>
    <p class="etat" id="etat-tableau"></p>
    <div class="kpis kpis-tableau">
      ${!resa ? "" : tuile(d.aConfirmer.length, "Demandes à confirmer", lien("reservations", "statut", "À confirmer"), d.aConfirmer.length ? "attention" : "")}
      ${!resa ? "" : tuile(d.aLivrer.length, "Confirmées à livrer", lien("reservations", "statut", "À livrer"), livraisonsBloquees ? "attention" : "", livraisonsBloquees ? `${livraisonsBloquees} en attente de paiement` : "")}
      ${!resa ? "" : tuile(d.enCours.length, "Contrats en cours", lien("reservations", "statut", "En cours"), retardsRetour ? "alerte" : "", retardsRetour ? `${retardsRetour} retour${retardsRetour > 1 ? "s" : ""} en retard` : "")}
      ${!peut("paiements") ? "" : tuile(mad(resteDu).replace(/\s*MAD$/, ""), "Non réglé (MAD)", lien("paiements", "filtre", "dus"), resteDu > 0 ? "alerte" : "", `${d.impayes.length} contrat${d.impayes.length > 1 ? "s" : ""}`)}
      ${!flotte ? "" : tuile(`${compte("Disponible")}/${d.actives.length}`, "Véhicules disponibles", lien("flotte", "filtre", "Disponible"), "", `${occupation} % en location`)}
      ${!flotte ? "" : tuile(d.conformite.length, "Documents à renouveler", "#tb-conformite", expires ? "alerte" : d.conformite.length ? "attention" : "", expires ? `${expires} expiré${expires > 1 ? "s" : ""}` : "sous 30 jours")}
    </div>
    ${flotte ? barreFlotte(d) : ""}
    <div class="grille-tableau">
      ${!resa ? "" : carte("Aujourd'hui", d.departs.length + d.retours.length, "", [
        ...d.departs.map((r) => ligneResa(r, `Départ ${heure(r.depart)}`, !autorisationLivraison(r).ok ? ["Non payée", "attention"] : "")),
        ...d.retours.map((r) => ligneResa(r, `Retour ${heure(r.retour)}`, "")),
      ], "Aucun départ ni retour prévu aujourd'hui.")}
      ${!resa ? "" : carte("Réservations à confirmer", d.aConfirmer.length, lien("reservations", "statut", "À confirmer"),
        d.aConfirmer.map((r) => ligneResa(r, `${formateDate(r.depart)} → ${formateDate(r.retour)}`, finCreneau(r.depart) < d.maintenant ? ["Date passée", "alerte"] : "")),
        "Aucune demande en attente.")}
      ${!resa ? "" : carte("Confirmées, en attente de livraison", d.aLivrer.length, lien("reservations", "statut", "À livrer"),
        d.aLivrer.map((r) => ligneResa(r, `départ ${formateDate(r.depart)}${r.immatriculation ? " · " + r.immatriculation : " · véhicule non attribué"}`,
          finCreneau(r.depart) < d.maintenant ? ["Livraison en retard", "alerte"] : !autorisationLivraison(r).ok ? etatPaiement(r) : "", r.statut)),
        "Aucune livraison en attente.", "tb-livrer")}
      ${!resa ? "" : carte("Contrats en cours", d.enCours.length, lien("reservations", "statut", "En cours"),
        d.enCours.map((r) => ligneResa(r, `retour ${formateDate(r.retour)}${r.immatriculation ? " · " + r.immatriculation : ""}`,
          finCreneau(r.retour) < d.maintenant ? ["Retour en retard", "alerte"] : solde(r) > 0.005 ? [`Reste ${mad(solde(r))}`, "attention"] : "")),
        "Aucun véhicule chez un client.")}
      ${!peut("paiements") ? "" : carte("Contrats non réglés", d.impayes.length, lien("paiements", "filtre", "dus"),
        d.impayes.map((r) => ligneResa(r, `${r.statut === "En cours" ? "en cours" : "rendu le " + formateDate(jour(r.retourLe || r.retour))} · payé ${mad(montantPaye(r))}`,
          enRetardDePaiement(r) ? [`Échu · ${mad(solde(r))}`, "alerte"] : [mad(solde(r)), "attention"])),
        "Tous les contrats sont réglés.", "", d.impayes.length ? `Total ${mad(resteDu)}` : "")}
      ${!flotte ? "" : carte("Véhicules indisponibles", d.indisponibles.length, lien("flotte", "filtre", "En réparation"),
        d.indisponibles.map((v) => ligneVehicule(v, v.statut === "Hors service" ? "Hors service"
          : v.disponibleLe ? `retour prévu le ${formateDate(v.disponibleLe)}` : "date de retour inconnue",
          v.statut === "Hors service" ? "Hors service" : v.disponibleLe && v.disponibleLe < d.auj ? ["Retour dépassé", "alerte"] : "En réparation")),
        "Toute la flotte est disponible.")}
      ${!flotte ? "" : carte("Conformité administrative", d.conformite.length, lien("flotte", "filtre", "alertes"),
        d.conformite.map((c) => ligneVehicule(c.v, `${c.libelle} ${c.expire ? "expirée le" : "jusqu'au"} ${formateDate(c.date)}`, c.expire ? ["Expiré", "alerte"] : ["À renouveler", "attention"])),
        "Assurances, visites techniques, vignettes et autorisations de circulation à jour pour 30 jours.", "tb-conformite")}
      ${!peut("maintenance") ? "" : carte("Entretien à prévoir", d.entretien.length, "#maintenance",
        d.entretien.map(({ v, alertes }) => ligneVehicule(v, alertes.map((a) => a.texte).join(" · "), alertes.some((a) => a.niveau === "danger") ? ["Dépassé", "alerte"] : ["Bientôt", "attention"])),
        "Aucune vidange ni changement de pneus à prévoir.")}
    </div>`;
  section.querySelector("#actualiser-tableau").addEventListener("click", actualiser);
}

async function actualiser() {
  const etatEl = section.querySelector("#etat-tableau");
  etatEl.className = "etat";
  etatEl.textContent = "Actualisation…";
  try {
    await chargerTout();
    rendre();
  } catch (e) {
    etatEl.className = "etat erreur";
    etatEl.textContent = "Actualisation impossible : " + e.message;
  }
}

function tuile(valeur, libelle, href, ton = "", detail = "") {
  return `<a class="kpi tuile${ton ? " t-" + ton : ""}" href="${escAttr(href)}">
      <div class="valeur">${escHTML(valeur)}</div><div class="libelle">${escHTML(libelle)}</div>
      ${detail ? `<div class="detail">${escHTML(detail)}</div>` : ""}</a>`;
}

// Répartition de la flotte par statut : une barre, chaque segment porte son nombre.
function barreFlotte(d) {
  const segments = [["Disponible", "dispo"], ["En circulation", "circulation"], ["En réparation", "reparation"], ["Hors service", "hors"]]
    .map(([statut, cls]) => ({ statut, cls, n: d.vehicules.filter((v) => v.statut === statut).length }));
  const total = d.vehicules.length;
  if (!total) return "";
  return `<div class="flotte-barre" role="img" aria-label="${escAttr(segments.map((s) => `${s.statut} : ${s.n}`).join(", "))}">
      <div class="barre">${segments.filter((s) => s.n).map((s) => `<a class="seg ${s.cls}" href="${escAttr(lien("flotte", "filtre", s.statut))}" style="flex:${s.n}" title="${escAttr(`${s.statut} : ${s.n} véhicule${s.n > 1 ? "s" : ""}`)}"></a>`).join("")}</div>
      <div class="legende">${segments.map((s) => `<a href="${escAttr(lien("flotte", "filtre", s.statut))}"><i class="${s.cls}"></i>${escHTML(s.statut)} <b>${s.n}</b></a>`).join("")}<span>${total} véhicules</span></div>
    </div>`;
}

function carte(titre, nombre, href, lignes, vide, id = "", pied = "") {
  return `<section class="carte-tableau"${id ? ` id="${id}"` : ""}>
      <header><h2>${escHTML(titre)} <span class="compteur${nombre ? "" : " zero"}">${nombre}</span></h2>${href && nombre ? `<a href="${escAttr(href)}">Tout voir</a>` : ""}</header>
      ${lignes.length ? `<div class="lignes">${lignes.slice(0, MAX_LIGNES).join("")}</div>` : `<p class="rien">${escHTML(vide)}</p>`}
      ${lignes.length > MAX_LIGNES ? `<p class="plus">et ${lignes.length - MAX_LIGNES} autre${lignes.length - MAX_LIGNES > 1 ? "s" : ""}${href ? ` · <a href="${escAttr(href)}">tout voir</a>` : ""}</p>` : ""}
      ${pied ? `<p class="pied">${escHTML(pied)}</p>` : ""}
    </section>`;
}

// Un signal est un texte (couleur du statut) ou [texte, "alerte" | "attention"].
const pastille = (s) => (Array.isArray(s) ? badge(s[0], s[1]) : badge(s));

function ligneResa(r, detail, signal, statut = "") {
  return `<a class="ligne-tb" href="${escAttr(lien("reservations", r.id))}">
      <span><b>${escHTML(client(r))}</b> <small>${escHTML(r.vehiculeNom || nomModele(r.vehicule))}</small><br><small>${escHTML(detail)}</small></span>
      ${signal ? pastille(signal) : statut ? badge(statut) : ""}
    </a>`;
}

function ligneVehicule(v, detail, signal) {
  return `<a class="ligne-tb" href="${escAttr(lien("flotte", v.id))}">
      <span><b class="immat">${escHTML(v.immatriculation)}</b> <small>${escHTML((MODELES[v.modele] && MODELES[v.modele].nom) || nomModele(v.modele))}</small><br><small>${escHTML(detail)}</small></span>
      ${signal ? pastille(signal) : ""}
    </a>`;
}
