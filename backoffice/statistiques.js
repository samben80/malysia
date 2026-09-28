// Statistiques des contrats : répartition par statut opérationnel (en attente,
// en préparation, livré, retourné, annulé) et par statut financier (payé,
// partiellement payé, non payé, en compte), puis une liste filtrable par
// client, période, véhicule ou modèle, regroupable, exportable vers Excel et
// imprimable.
import {
  etat, cleClient, nomModele, formateDate, mad, escHTML, escAttr, badge, aujourdhuiISO, contientTexte,
} from "./commun.js";
import { ficheClient, nomClient } from "./clients.js";
import { joursLocation, montantDu, montantPaye, solde, etatPaiement, enRetardDePaiement, echeance } from "./paiements.js";

export const OPERATIONNEL = [
  { id: "attente", libelle: "En attente de confirmation", statuts: ["À confirmer"] },
  { id: "preparation", libelle: "En préparation", detail: "confirmée, payée ou prête à livrer", statuts: ["Confirmée", "Payée", "Prête à livrer"] },
  { id: "livre", libelle: "Livrée, chez le client", statuts: ["En cours"] },
  { id: "retourne", libelle: "Retournée", statuts: ["Terminée"] },
  { id: "annule", libelle: "Annulée", statuts: ["Annulée"] },
];
export const FINANCIER = [
  { id: "regle", libelle: "Payé" },
  { id: "partiel", libelle: "Partiellement payé" },
  { id: "nonpaye", libelle: "Non payé" },
  { id: "compte", libelle: "En compte", detail: "paiement différé" },
];
const REGROUPEMENTS = [["client", "Client"], ["vehicule", "Véhicule"], ["modele", "Modèle"], ["mois", "Mois de départ"], ["operationnel", "Statut opérationnel"], ["financier", "Statut financier"]];
const PERIODES = [["", "Toute la période"], ["mois", "Ce mois-ci"], ["mois-1", "Mois dernier"], ["3mois", "3 derniers mois"], ["annee", "Cette année"], ["an-1", "Année dernière"], ["perso", "Dates choisies"]];

const criteres = { texte: "", client: "", vehicule: "", modele: "", operationnel: "", financier: "" };
let periode = "", du = "", au = "";
let regrouper = "client";
let tri = { cle: "depart", sens: -1 };
let section = null;

export function afficherStatistiques(el, param, param2) {
  section = el;
  // liens des fiches : #statistiques/client/<clé>, #statistiques/vehicule/<id>
  if (param && param in criteres && param !== "texte") {
    for (const k of Object.keys(criteres)) criteres[k] = "";
    criteres[param] = param2 || "";
    choisirPeriode("");
  }
  rendre();
}

// ---- qualification d'une réservation

export const groupeOperationnel = (r) => OPERATIONNEL.find((g) => g.statuts.includes(r.statut)) || OPERATIONNEL[0];
// Un contrat est une réservation acceptée : ni simple demande, ni annulée.
const estContrat = (r) => r.statut !== "À confirmer" && r.statut !== "Annulée";
export function groupeFinancier(r) {
  if (!estContrat(r)) return null;
  const id = { "Réglée": "regle", "Trop-perçu": "regle", "Acompte versé": "partiel", "En compte": "compte", "À encaisser": "nonpaye" }[etatPaiement(r)];
  return FINANCIER.find((g) => g.id === id) || null;
}
const nomDuClient = (r) => { const c = ficheClient(r.telephone); return nomClient(c) || (c && c.entreprise) || r.nom || r.telephone || "Client"; };
const nomVehicule = (r) => r.vehiculeNom || nomModele(r.vehicule);
const jour = (d) => String(d || "").slice(0, 10);

// ---- période

function choisirPeriode(p) {
  periode = p;
  if (p === "perso") return;
  const auj = aujourdhuiISO();
  const [a, m] = auj.split("-").map(Number);
  const debutMois = (an, mois) => { const d = new Date(an, mois - 1, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; };
  const finMois = (an, mois) => { const d = new Date(an, mois, 0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  [du, au] = {
    "": ["", ""],
    mois: [debutMois(a, m), finMois(a, m)],
    "mois-1": [debutMois(a, m - 1), finMois(a, m - 1)],
    "3mois": [debutMois(a, m - 2), finMois(a, m)],
    annee: [`${a}-01-01`, `${a}-12-31`],
    "an-1": [`${a - 1}-01-01`, `${a - 1}-12-31`],
  }[p] || ["", ""];
}

// ---- filtres : chaque répartition ignore son propre critère, pour rester lisible une fois cliquée

function filtrer(sauf = "") {
  return etat.donnees.reservations.filter((r) => {
    const d = jour(r.depart);
    if (du && d < du) return false;
    if (au && d > au) return false;
    if (criteres.client && cleClient(r.telephone) !== criteres.client) return false;
    if (criteres.vehicule && r.vehiculeAttribue !== criteres.vehicule) return false;
    if (criteres.modele && r.vehicule !== criteres.modele) return false;
    if (sauf !== "operationnel" && criteres.operationnel && groupeOperationnel(r).id !== criteres.operationnel) return false;
    if (sauf !== "financier" && criteres.financier) {
      if (criteres.financier === "echu" ? !enRetardDePaiement(r) : (groupeFinancier(r) || {}).id !== criteres.financier) return false;
    }
    return contientTexte(criteres.texte, nomDuClient(r), r.telephone, nomVehicule(r), r.immatriculation, r.id, r.statut);
  });
}

function totaux(liste) {
  const contrats = liste.filter(estContrat);
  const t = { lignes: liste.length, contrats: contrats.length, jours: 0, montant: 0, encaisse: 0, reste: 0 };
  for (const r of contrats) {
    t.jours += joursLocation(r);
    t.montant += montantDu(r);
    t.encaisse += montantPaye(r);
    t.reste += Math.max(0, solde(r));
  }
  return t;
}

// ---- rendu

function rendre() {
  const clients = new Map(), modeles = new Map();
  for (const r of etat.donnees.reservations) {
    const cle = cleClient(r.telephone);
    if (cle && !clients.has(cle)) clients.set(cle, nomDuClient(r));
    if (r.vehicule && !modeles.has(r.vehicule)) modeles.set(r.vehicule, nomVehicule(r));
  }
  const parNom = (m) => [...m].sort((a, b) => a[1].localeCompare(b[1], "fr"));
  const vehicules = etat.donnees.vehicules.map((v) => [v.id, `${v.immatriculation} · ${nomModele(v.modele)}`]).sort((a, b) => a[1].localeCompare(b[1], "fr"));
  const menu = (nom, libelle, options) => `<label><span>${escHTML(libelle)}</span><select data-critere="${nom}">
      <option value="">Tous</option>
      ${options.map(([v, l]) => `<option value="${escAttr(v)}"${v === criteres[nom] ? " selected" : ""}>${escHTML(l)}</option>`).join("")}
    </select></label>`;

  section.innerHTML = `
    <div class="entete"><h1>Statistiques</h1>
      <div class="actions-entete">
        <button class="bouton secondaire" id="export-liste">Exporter la liste (Excel)</button>
        <button class="bouton secondaire" id="export-groupes">Exporter le regroupement</button>
        <button class="bouton secondaire" id="imprimer-stats">Imprimer</button>
      </div></div>
    <p class="aide-ecran">Une location compte dans la période selon sa date de départ. Les montants ne portent que sur les contrats (réservations confirmées, hors demandes en attente et annulations).</p>
    <div class="filtres-stats">
      <label><span>Période</span><select id="stats-periode">${PERIODES.map(([v, l]) => `<option value="${v}"${v === periode ? " selected" : ""}>${escHTML(l)}</option>`).join("")}</select></label>
      <label><span>Du</span><input type="date" id="stats-du" value="${escAttr(du)}"></label>
      <label><span>Au</span><input type="date" id="stats-au" value="${escAttr(au)}"></label>
      ${menu("client", "Client", parNom(clients))}
      ${menu("vehicule", "Véhicule", vehicules)}
      ${menu("modele", "Modèle", parNom(modeles))}
      ${menu("operationnel", "Statut opérationnel", OPERATIONNEL.map((g) => [g.id, g.libelle]))}
      ${menu("financier", "Statut financier", [...FINANCIER.map((g) => [g.id, g.libelle]), ["echu", "Échéance dépassée"]])}
      <label class="large"><span>Recherche</span><input type="search" data-critere="texte" value="${escAttr(criteres.texte)}" placeholder="Nom, téléphone, immatriculation, référence…"></label>
      <button type="button" class="lien-reinit" id="stats-reinit">Effacer les filtres</button>
    </div>
    <div id="stats-resultats"></div>`;

  const maj = () => { section.querySelector("#stats-reinit").hidden = !periode && !Object.values(criteres).some(Boolean); rendreResultats(); };
  section.querySelectorAll("[data-critere]").forEach((el) => el.addEventListener(el.tagName === "INPUT" ? "input" : "change", () => { criteres[el.dataset.critere] = el.value.trim(); maj(); }));
  section.querySelector("#stats-periode").addEventListener("change", (ev) => {
    choisirPeriode(ev.target.value);
    section.querySelector("#stats-du").value = du;
    section.querySelector("#stats-au").value = au;
    maj();
  });
  for (const id of ["du", "au"]) {
    section.querySelector(`#stats-${id}`).addEventListener("change", (ev) => {
      if (id === "du") du = ev.target.value; else au = ev.target.value;
      periode = du || au ? "perso" : "";
      section.querySelector("#stats-periode").value = periode;
      maj();
    });
  }
  section.querySelector("#stats-reinit").addEventListener("click", () => {
    for (const k of Object.keys(criteres)) criteres[k] = "";
    choisirPeriode("");
    rendre();
  });
  section.querySelector("#export-liste").addEventListener("click", exporterListe);
  section.querySelector("#export-groupes").addEventListener("click", exporterGroupes);
  section.querySelector("#imprimer-stats").addEventListener("click", imprimer);
  maj();
}

const chiffre = (n) => mad(n).replace(/\s*MAD$/, "");
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;

function rendreResultats() {
  const liste = filtrer();
  const t = totaux(liste);
  const nonSoldes = liste.filter((r) => estContrat(r) && solde(r) > 0.005).length;
  const zone = section.querySelector("#stats-resultats");
  zone.innerHTML = `
    <div class="kpis">
      ${kpi(t.contrats, "Contrats", t.lignes > t.contrats ? `sur ${pluriel(t.lignes, "réservation")}` : "")}
      ${kpi(t.jours, "Jours loués")}
      ${kpi(chiffre(t.montant), "Montant des contrats (MAD)", t.jours ? `${chiffre(t.montant / t.jours)} MAD par jour en moyenne` : "")}
      ${kpi(chiffre(t.encaisse), "Encaissé (MAD)", t.montant ? `${Math.round((t.encaisse / t.montant) * 100)} % du montant` : "")}
      ${kpi(chiffre(t.reste), "Reste dû (MAD)", nonSoldes ? `${pluriel(nonSoldes, "contrat")} non soldé${nonSoldes > 1 ? "s" : ""}` : "", nonSoldes ? "t-alerte" : "")}
    </div>
    <div class="grille-stats">
      ${repartition("Statut opérationnel", "operationnel", OPERATIONNEL, filtrer("operationnel"), (r) => groupeOperationnel(r).id)}
      ${repartition("Statut financier", "financier", FINANCIER, filtrer("financier").filter(estContrat), (r) => (groupeFinancier(r) || {}).id,
        (l) => { const n = l.filter(enRetardDePaiement); return n.length ? `<button class="lien-echu" data-choix-financier="echu">dont ${pluriel(n.length, "contrat")} à échéance dépassée : ${mad(n.reduce((s, r) => s + solde(r), 0))}</button>` : ""; })}
    </div>
    <section class="panneau-stats">
      <header><h2>Regroupement</h2>
        <label><span class="vh">Regrouper par</span><select id="stats-regrouper">${REGROUPEMENTS.map(([v, l]) => `<option value="${v}"${v === regrouper ? " selected" : ""}>par ${escHTML(l.toLowerCase())}</option>`).join("")}</select></label>
      </header>
      ${tableauGroupes(liste)}
    </section>
    <section class="panneau-stats">
      <header><h2>Liste des réservations <span class="compteur">${liste.length}</span></h2></header>
      ${tableauListe(liste)}
    </section>`;

  zone.querySelectorAll("[data-choix-operationnel], [data-choix-financier]").forEach((b) => b.addEventListener("click", () => {
    const nom = "choixOperationnel" in b.dataset ? "operationnel" : "financier";
    const v = b.dataset[nom === "operationnel" ? "choixOperationnel" : "choixFinancier"];
    criteres[nom] = criteres[nom] === v ? "" : v;
    section.querySelector(`select[data-critere="${nom}"]`).value = criteres[nom];
    section.querySelector("#stats-reinit").hidden = !periode && !Object.values(criteres).some(Boolean);
    rendreResultats();
  }));
  zone.querySelector("#stats-regrouper").addEventListener("change", (ev) => { regrouper = ev.target.value; rendreResultats(); });
  zone.querySelectorAll("[data-groupe]").forEach((tr) => tr.addEventListener("click", () => {
    if (!["client", "vehicule", "modele", "operationnel", "financier"].includes(regrouper) || !tr.dataset.groupe) return;
    criteres[regrouper] = tr.dataset.groupe;
    rendre();
  }));
  zone.querySelectorAll("th[data-tri]").forEach((th) => th.addEventListener("click", () => {
    tri = { cle: th.dataset.tri, sens: tri.cle === th.dataset.tri ? -tri.sens : 1 };
    rendreResultats();
  }));
  zone.querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("click", () => { location.hash = `#reservations/${encodeURIComponent(tr.dataset.id)}`; }));
}

function kpi(valeur, libelle, detail = "", ton = "") {
  return `<div class="kpi${ton ? " " + ton : ""}"><div class="valeur">${escHTML(valeur)}</div><div class="libelle">${escHTML(libelle)}</div>${detail ? `<div class="detail">${escHTML(detail)}</div>` : ""}</div>`;
}

// Barres horizontales : une seule teinte, nombre et montant écrits à côté.
function repartition(titre, nom, groupes, liste, groupeDe, pied = () => "") {
  const lignes = groupes.map((g) => {
    const membres = liste.filter((r) => groupeDe(r) === g.id);
    return { g, n: membres.length, t: totaux(membres) };
  });
  const max = Math.max(1, ...lignes.map((l) => l.n));
  const actif = criteres[nom];
  return `<section class="panneau-stats">
      <header><h2>${escHTML(titre)}</h2>${actif ? `<button class="lien-reinit" data-choix-${nom}="${escAttr(actif)}">tout afficher</button>` : ""}</header>
      <div class="barres-stats">
        ${lignes.map(({ g, n, t }) => `<button class="barre-stat${actif === g.id ? " actif" : ""}${actif && actif !== g.id ? " estompe" : ""}" data-choix-${nom}="${g.id}"
            title="${escAttr(`${g.libelle} : ${pluriel(n, "réservation")}${t.contrats ? `, ${mad(t.montant)} dont ${mad(t.reste)} restant dû` : ""}`)}">
          <span class="lib">${escHTML(g.libelle)}${g.detail ? `<small>${escHTML(g.detail)}</small>` : ""}</span>
          <span class="piste"><i style="width:${(n / max) * 100}%"></i></span>
          <span class="val"><b>${n}</b>${t.contrats ? `<small>${mad(t.montant)}</small>` : ""}</span>
        </button>`).join("")}
      </div>
      ${pied(liste)}
    </section>`;
}

// ---- regroupement

function cleGroupe(r) {
  switch (regrouper) {
    case "client": return [cleClient(r.telephone) || "", nomDuClient(r)];
    case "vehicule": return [r.vehiculeAttribue || "", r.immatriculation ? `${r.immatriculation} · ${nomVehicule(r)}` : "Véhicule non attribué"];
    case "modele": return [r.vehicule || "", nomVehicule(r)];
    case "mois": {
      const m = jour(r.depart).slice(0, 7);
      return [m, m ? new Date(m + "-15T12:00:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) : "Sans date"];
    }
    case "operationnel": { const g = groupeOperationnel(r); return [g.id, g.libelle]; }
    case "financier": { const g = groupeFinancier(r); return g ? [g.id, g.libelle] : ["", r.statut === "Annulée" ? "Annulée" : "Demande non confirmée"]; }
    default: return ["", ""];
  }
}

function groupes(liste) {
  const map = new Map();
  for (const r of liste) {
    const [cle, libelle] = cleGroupe(r);
    const k = cle || "∅" + libelle;
    if (!map.has(k)) map.set(k, { cle, libelle, membres: [] });
    map.get(k).membres.push(r);
  }
  const res = [...map.values()].map((g) => ({ ...g, t: totaux(g.membres) }));
  if (regrouper === "mois") res.sort((a, b) => b.cle.localeCompare(a.cle));
  else res.sort((a, b) => b.t.montant - a.t.montant || b.t.lignes - a.t.lignes);
  return res;
}

function tableauGroupes(liste) {
  const g = groupes(liste);
  if (!g.length) return '<p class="rien">Aucune réservation pour ces filtres.</p>';
  const t = totaux(liste);
  const max = Math.max(1, ...g.map((x) => x.t.montant));
  const cliquable = regrouper !== "mois";
  return `<div class="defilement-x"><table class="tableau stats">
      <thead><tr><th>${escHTML(REGROUPEMENTS.find(([v]) => v === regrouper)[1])}</th><th>Réserv.</th><th>Contrats</th><th>Jours</th><th>Montant</th><th>Encaissé</th><th>Reste dû</th></tr></thead>
      <tbody>${g.map((x) => `<tr${cliquable && x.cle ? ` data-groupe="${escAttr(x.cle)}" class="cliquable" title="Filtrer sur ${escAttr(x.libelle)}"` : ""}>
          <td>${escHTML(x.libelle)}<span class="mini-barre"><i style="width:${(x.t.montant / max) * 100}%"></i></span></td>
          <td>${x.t.lignes}</td><td>${x.t.contrats}</td><td>${x.t.jours}</td><td>${mad(x.t.montant)}</td><td>${mad(x.t.encaisse)}</td>
          <td class="${x.t.reste > 0.005 ? "txt-alerte" : ""}">${mad(x.t.reste)}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td>Total</td><td>${t.lignes}</td><td>${t.contrats}</td><td>${t.jours}</td><td>${mad(t.montant)}</td><td>${mad(t.encaisse)}</td><td>${mad(t.reste)}</td></tr></tfoot>
    </table></div>`;
}

// ---- liste détaillée

const COLONNES = [
  ["ref", "Réf.", (r) => r.id.slice(0, 8).toUpperCase()],
  ["client", "Client", nomDuClient],
  ["vehicule", "Véhicule", (r) => `${nomVehicule(r)}${r.immatriculation ? " · " + r.immatriculation : ""}`],
  ["depart", "Départ", (r) => String(r.depart || "")],
  ["retour", "Retour", (r) => String(r.retour || "")],
  ["jours", "Jours", (r) => joursLocation(r)],
  ["statut", "Statut", (r) => OPERATIONNEL.indexOf(groupeOperationnel(r)) * 10 + groupeOperationnel(r).statuts.indexOf(r.statut)],
  ["paiement", "Paiement", (r) => etatPaiement(r)],
  ["montant", "Montant", (r) => (estContrat(r) ? montantDu(r) : 0)],
  ["paye", "Payé", montantPaye],
  ["reste", "Reste", (r) => (estContrat(r) ? Math.max(0, solde(r)) : 0)],
];

function trier(liste) {
  const col = COLONNES.find(([c]) => c === tri.cle) || COLONNES[3];
  return [...liste].sort((a, b) => {
    const x = col[2](a), y = col[2](b);
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "fr")) * tri.sens;
  });
}

function tableauListe(liste) {
  if (!liste.length) return '<p class="rien">Aucune réservation pour ces filtres.</p>';
  const fleche = (c) => (tri.cle === c ? (tri.sens > 0 ? " ▲" : " ▼") : "");
  return `<div class="defilement-x"><table class="tableau stats liste-stats">
      <thead><tr>${COLONNES.map(([c, l]) => `<th data-tri="${c}" aria-sort="${tri.cle === c ? (tri.sens > 0 ? "ascending" : "descending") : "none"}">${escHTML(l)}${fleche(c)}</th>`).join("")}</tr></thead>
      <tbody>${trier(liste).map((r) => {
        const reste = estContrat(r) ? Math.max(0, solde(r)) : 0;
        return `<tr data-id="${escAttr(r.id)}" class="cliquable">
          <td class="immat">${escHTML(r.id.slice(0, 8).toUpperCase())}</td>
          <td>${escHTML(nomDuClient(r))}</td>
          <td>${escHTML(nomVehicule(r))}${r.immatriculation ? `<br><small class="immat">${escHTML(r.immatriculation)}</small>` : ""}</td>
          <td>${formateDate(r.depart)}</td><td>${formateDate(r.retour)}</td><td>${joursLocation(r)}</td>
          <td>${badge(r.statut)}</td>
          <td>${estContrat(r) ? badge(enRetardDePaiement(r) ? "Échu" : etatPaiement(r), enRetardDePaiement(r) ? "alerte" : "") : ""}</td>
          <td>${estContrat(r) ? mad(montantDu(r)) : "—"}</td><td>${mad(montantPaye(r))}</td>
          <td class="${reste > 0.005 ? "txt-alerte" : ""}">${estContrat(r) ? mad(reste) : "—"}</td></tr>`;
      }).join("")}</tbody>
    </table></div>`;
}

// ---- export (CSV lisible par Excel en français : point-virgule, virgule décimale, BOM UTF-8)

const nombreCSV = (n) => String(Math.round(Number(n || 0) * 100) / 100).replace(".", ",");
const celluleCSV = (v) => { const s = String(v ?? ""); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function telecharger(nom, lignes) {
  const csv = "﻿" + lignes.map((l) => l.map(celluleCSV).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function suffixeFichier() {
  return [aujourdhuiISO(), du && au ? `${du}_${au}` : ""].filter(Boolean).join("_");
}

export function lignesExportListe(liste) {
  return [
    ["Référence", "Client", "Téléphone", "Modèle", "Immatriculation", "Départ", "Retour", "Jours", "Statut", "Statut opérationnel", "Statut financier", "Échéance", "Montant (MAD)", "Payé (MAD)", "Reste dû (MAD)"],
    ...trier(liste).map((r) => [
      r.id, nomDuClient(r), r.telephone || "", nomVehicule(r), r.immatriculation || "", formateDate(r.depart), formateDate(r.retour), joursLocation(r),
      r.statut, groupeOperationnel(r).libelle, estContrat(r) ? (enRetardDePaiement(r) ? "Échéance dépassée" : (groupeFinancier(r) || {}).libelle || "") : "",
      estContrat(r) ? formateDate(echeance(r)) : "", nombreCSV(estContrat(r) ? montantDu(r) : 0), nombreCSV(montantPaye(r)), nombreCSV(estContrat(r) ? Math.max(0, solde(r)) : 0),
    ]),
  ];
}

function exporterListe() {
  telecharger(`reservations_${suffixeFichier()}.csv`, lignesExportListe(filtrer()));
}

function exporterGroupes() {
  const libelle = REGROUPEMENTS.find(([v]) => v === regrouper)[1];
  telecharger(`statistiques-${regrouper}_${suffixeFichier()}.csv`, [
    [libelle, "Réservations", "Contrats", "Jours", "Montant (MAD)", "Encaissé (MAD)", "Reste dû (MAD)"],
    ...groupes(filtrer()).map((g) => [g.libelle, g.t.lignes, g.t.contrats, g.t.jours, nombreCSV(g.t.montant), nombreCSV(g.t.encaisse), nombreCSV(g.t.reste)]),
  ]);
}

// ---- impression

function resumeFiltres() {
  const morceaux = [];
  morceaux.push(du || au ? `Départs ${du ? "du " + formateDate(du) : ""} ${au ? "au " + formateDate(au) : ""}`.trim() : "Toute la période");
  for (const nom of ["client", "vehicule", "modele", "operationnel", "financier"]) {
    if (!criteres[nom]) continue;
    const opt = section.querySelector(`select[data-critere="${nom}"] option[value="${CSS.escape(criteres[nom])}"]`);
    morceaux.push(`${section.querySelector(`select[data-critere="${nom}"]`).closest("label").querySelector("span").textContent} : ${opt ? opt.textContent : criteres[nom]}`);
  }
  if (criteres.texte) morceaux.push(`Recherche : « ${criteres.texte} »`);
  return morceaux.join(" · ");
}

function imprimer() {
  const liste = filtrer();
  const t = totaux(liste);
  const zone = document.getElementById("impression");
  zone.innerHTML = `<div class="stats-imprimees">
      <h1>Statistiques des contrats</h1>
      <p>${escHTML(resumeFiltres())}<br>Édité le ${formateDate(aujourdhuiISO())}</p>
      <p><b>${pluriel(t.contrats, "contrat")}</b> · ${t.jours} jours · montant ${mad(t.montant)} · encaissé ${mad(t.encaisse)} · reste dû ${mad(t.reste)}</p>
      <h2>Regroupement par ${escHTML(REGROUPEMENTS.find(([v]) => v === regrouper)[1].toLowerCase())}</h2>
      ${tableauGroupes(liste)}
      <h2>Liste des réservations</h2>
      ${tableauListe(liste)}
    </div>`;
  window.print();
}
