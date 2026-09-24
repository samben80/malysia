import {
  connecter,
  creerDocument,
  corrigerDocument,
  lireDocument,
  estConfigure,
} from "../assets/firestore-rest.js";
import { SOCIETE, FRAIS, conditionsGenerales } from "../assets/contrat-modele.js";
import {
  etat, jeton, chargerTout, majDisponibilite, nomModele, MODELES, STATUTS_ACTIFS, chevauche, alertesVehicule,
  cleClient, lienWhatsApp, formateDate, nombre, escHTML, escAttr, badge, maintenantISO,
} from "./commun.js";
import { afficherFlotte } from "./flotte.js";
import { afficherModeles } from "./modeles.js";
import { afficherMaintenance } from "./maintenance.js";
import { afficherClients, ficheClient, nomClient, majClientDepuisDossier } from "./clients.js";
import { afficherFacturation } from "./facturation.js";

const CLE_SESSION = "malysia_bo_session";
const PIECES = [
  ["permis_recto", "Permis — recto"],
  ["permis_verso", "Permis — verso"],
  ["identite_recto", "Pièce d'identité — recto"],
  ["identite_verso", "Pièce d'identité — verso"],
];

const ecranConnexion = document.getElementById("ecran-connexion");
const app = document.getElementById("app");
const formConnexion = document.getElementById("form-connexion");
const erreurConnexion = document.getElementById("erreur-connexion");
const quiConnecte = document.getElementById("qui-connecte");
const listeEl = document.getElementById("liste");
const ficheEl = document.getElementById("fiche");
const filtresEl = document.getElementById("filtres");
const visionneuse = document.getElementById("visionneuse");

let filtreActuel = "";
let selectionId = null;

document.getElementById("date-du-jour").textContent = new Date().toLocaleDateString("fr-FR", {
  weekday: "long", day: "numeric", month: "long",
});

// ---- session

function chargerSession() {
  try {
    const brut = sessionStorage.getItem(CLE_SESSION);
    return brut ? JSON.parse(brut) : null;
  } catch { return null; }
}
function sauverSession(s) {
  etat.session = s;
  try { sessionStorage.setItem(CLE_SESSION, JSON.stringify(s)); } catch {}
}
function effacerSession() {
  etat.session = null;
  try { sessionStorage.removeItem(CLE_SESSION); } catch {}
}

async function afficherApp() {
  ecranConnexion.style.display = "none";
  app.classList.add("actif");
  quiConnecte.textContent = etat.session.email;
  listeEl.innerHTML = '<div class="vide">Chargement…</div>';
  try {
    etat.pret = false;
    const refusees = await chargerTout();
    etat.pret = true;
    document.getElementById("bandeau-regles").hidden = refusees.length === 0;
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      afficherConnexion("Session expirée, reconnectez-vous.");
      return;
    }
    listeEl.innerHTML = '<div class="vide">Le chargement a échoué. Rechargez la page.</div>';
    return;
  }
  router();
}
function afficherConnexion(message) {
  effacerSession();
  app.classList.remove("actif");
  ecranConnexion.style.display = "flex";
  erreurConnexion.textContent = message || "";
}

document.getElementById("deconnexion").addEventListener("click", () => afficherConnexion());

formConnexion.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!estConfigure()) {
    erreurConnexion.textContent = "Configuration Firebase manquante (firebase-config.js).";
    return;
  }
  const bouton = formConnexion.querySelector("button");
  const f = formConnexion.elements;
  bouton.disabled = true;
  erreurConnexion.textContent = "";
  try {
    const res = await connecter(f["email"].value, f["motdepasse"].value);
    sauverSession({ idToken: res.idToken, email: res.email, expire: Date.now() + Number(res.expiresIn) * 1000 });
    afficherApp();
  } catch (e) {
    erreurConnexion.textContent = e.message || "Connexion refusée.";
  } finally {
    bouton.disabled = false;
  }
});

// ---- navigation entre les écrans (#reservations, #flotte/<id>, #facturation/nouvelle/<réservation>…)

const ECRANS = {
  reservations: (el, param) => { if (param) selectionId = param; render(); },
  flotte: afficherFlotte,
  modeles: afficherModeles,
  maintenance: afficherMaintenance,
  clients: afficherClients,
  facturation: afficherFacturation,
};

function router() {
  if (!etat.session || !etat.pret) return; // données pas encore chargées : afficherApp rappellera router()
  const [nom, param, param2] = location.hash.replace(/^#/, "").split("/").map(decodeURIComponent);
  const ecran = ECRANS[nom] ? nom : "reservations";
  document.querySelectorAll("[data-vue]").forEach((s) => { s.hidden = s.dataset.vue !== ecran; });
  document.querySelectorAll("aside nav a").forEach((a) => a.classList.toggle("actif", a.getAttribute("href") === "#" + (ecran === "modeles" ? "flotte" : ecran)));
  ECRANS[ecran](document.querySelector(`[data-vue="${ecran}"]`), param, param2);
  majBadges();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", router);

// Sur téléphone, la fiche s'affiche sous la liste : on y descend après un choix.
document.addEventListener("click", (ev) => {
  if (window.innerWidth > 1000 || !ev.target.closest(".liste .ligne, .entete .bouton")) return;
  const fiche = document.querySelector("[data-vue]:not([hidden]) .fiche");
  if (fiche) setTimeout(() => fiche.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
});

function majBadges() {
  const d = etat.donnees;
  const poser = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n || ""; };
  poser("nb-total", d.reservations.filter((r) => r.statut === "À confirmer").length);
  poser("nb-flotte", d.vehicules.filter((v) => alertesVehicule(v).length).length);
  poser("nb-maintenance", d.maintenance.filter((m) => m.statut !== "Terminée").length);
  poser("nb-factures", d.factures.filter((f) => f.statut === "À encaisser" || f.statut === "Partiellement payée").length);
}

// ---- réservations

filtresEl.addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-statut]");
  if (!b) return;
  filtresEl.querySelectorAll("button").forEach((x) => x.classList.remove("actif"));
  b.classList.add("actif");
  filtreActuel = b.dataset.statut;
  render();
});

function render() {
  renderKpis();
  renderListe();
  renderFiche();
  majBadges();
}

function renderKpis() {
  const reservations = etat.donnees.reservations;
  const compte = (s) => reservations.filter((r) => r.statut === s).length;
  const aujourdhui = maintenantISO().slice(0, 10);
  document.getElementById("kpi-a-confirmer").textContent = compte("À confirmer");
  document.getElementById("kpi-confirmees").textContent = compte("Confirmée") + compte("Payée") + compte("Prête à livrer");
  document.getElementById("kpi-en-cours").textContent = compte("En cours");
  document.getElementById("kpi-departs").textContent = reservations.filter((r) =>
    ["Confirmée", "Payée", "Prête à livrer"].includes(r.statut) && String(r.depart || "").slice(0, 10) === aujourdhui).length;
}

function renderListe() {
  const reservations = etat.donnees.reservations;
  const visibles = filtreActuel ? reservations.filter((r) => r.statut === filtreActuel) : reservations;
  if (visibles.length === 0) {
    listeEl.innerHTML = '<div class="vide">Aucune demande pour ce filtre.</div>';
    return;
  }
  listeEl.innerHTML = "";
  for (const r of visibles) {
    const client = nomClient(ficheClient(r.telephone));
    const div = document.createElement("div");
    div.className = "ligne" + (r.id === selectionId ? " selectionnee" : "");
    div.innerHTML = `
      <div>
        <div class="ref">${r.id.slice(0, 8).toUpperCase()} · ${escHTML(r.formule || "—")}${r.immatriculation ? ` · <span class="immat">${escHTML(r.immatriculation)}</span>` : ""}</div>
        <div class="vehicule">${escHTML(r.vehiculeNom || "Véhicule non précisé")}${client ? ` <small>· ${escHTML(client)}</small>` : ""}</div>
        <div class="dates">${formateDate(r.depart)} → ${formateDate(r.retour)}</div>
      </div>
      ${badge(r.statut)}
    `;
    div.addEventListener("click", () => { selectionId = r.id; render(); });
    listeEl.appendChild(div);
  }
}

function renderFiche() {
  const r = etat.donnees.reservations.find((x) => x.id === selectionId);
  if (!r) {
    ficheEl.innerHTML = '<div class="vide">Sélectionnez une demande dans la liste.</div>';
    return;
  }
  const { libelle, aide, prochain } = actionPour(r.statut);
  const client = ficheClient(r.telephone);
  const cle = cleClient(r.telephone);
  const avantRemise = ["Confirmée", "Payée", "Prête à livrer"].includes(r.statut);
  const annulable = ["À confirmer", ...STATUTS_ACTIFS].includes(r.statut) && r.statut !== "En cours";
  ficheEl.innerHTML = `
    ${badge(r.statut)}
    ${client && client.listeNoire ? `<p class="alerte">Client en liste noire${client.motifListeNoire ? " : " + escHTML(client.motifListeNoire) : ""}</p>` : ""}
    <h2>${escHTML(r.vehiculeNom || "Véhicule non précisé")}</h2>
    <div class="ref">${r.id}</div>
    <div class="champs">
      <div><span>Client</span>${cle ? `<a href="#clients/${escAttr(cle)}">${escHTML(nomClient(client) || "Voir la fiche")}</a>` : "—"}</div>
      <div><span>Téléphone</span><a class="tel" href="tel:${escAttr(r.telephone)}">${escHTML(r.telephone || "—")}</a></div>
      <div><span>Formule</span>${escHTML(r.formule || "—")}</div>
      <div><span>Prise en charge</span>${escHTML(r.lieuPriseEnCharge || "—")}</div>
      <div><span>Départ</span>${formateDate(r.depart)}</div>
      <div><span>Retour</span>${formateDate(r.retour)}</div>
      <div><span>Restitution</span>${escHTML(r.lieuRestitution || "—")}</div>
      ${r.kmDepart !== undefined && r.kmDepart !== "" ? `<div><span>Km départ / retour</span>${nombre(r.kmDepart)}${r.kmRetour !== undefined && r.kmRetour !== "" ? " → " + nombre(r.kmRetour) + ` (${nombre(r.kmRetour - r.kmDepart)} km)` : ""}</div>` : ""}
    </div>
    ${STATUTS_ACTIFS.includes(r.statut) ? '<div class="bloc" id="bloc-attribution"></div>' : ""}
    ${prochain
      ? `<button class="action" id="bouton-action">${libelle}</button><p class="aide">${aide}</p>`
      : `<p class="aide">${aide}</p>`}
    <p id="etat-action"></p>
    ${avantRemise ? '<div class="bloc" id="bloc-remise"></div>' : ""}
    ${r.statut === "En cours" ? '<div class="bloc" id="bloc-retour"></div>' : ""}
    ${r.statut !== "À confirmer" && r.statut !== "Annulée" && r.telephone
      ? `<a class="whatsapp" target="_blank" rel="noopener" href="${escAttr(lienWhatsApp(r.telephone, messageConfirmation(r)))}">Prévenir le client par WhatsApp</a>`
      : ""}
    ${r.statut !== "À confirmer" && r.statut !== "Annulée" ? `<div class="bloc"><h3>Facture</h3>${r.facture
      ? `<a class="bouton secondaire bloc" href="#facturation/${escAttr(r.facture)}">Voir la facture ${escHTML(r.facture)}</a>`
      : `<a class="bouton secondaire bloc" href="#facturation/nouvelle/${escAttr(r.id)}">Créer la facture</a>`}</div>` : ""}
    ${r.statut !== "À confirmer" && r.statut !== "Annulée" ? '<div class="dossier" id="bloc-dossier"></div>' : ""}
    ${annulable ? '<button class="lien-danger" id="annuler-reservation">Annuler la réservation</button>' : ""}
  `;
  if (prochain) {
    document.getElementById("bouton-action").addEventListener("click", () => appliquerAction(r, prochain));
  }
  if (STATUTS_ACTIFS.includes(r.statut)) renderAttribution(r);
  if (avantRemise) renderRemise(r);
  if (r.statut === "En cours") renderRetour(r);
  if (annulable) document.getElementById("annuler-reservation").addEventListener("click", () => annuler(r));
  if (r.statut !== "À confirmer" && r.statut !== "Annulée") renderDossier(r);
}

// ---- attribution d'un véhicule précis (immatriculation) à la réservation

function conflits(r, v) {
  const motifs = [];
  if (v.statut === "Hors service") motifs.push("hors service");
  if (v.statut === "En réparation" && (!v.disponibleLe || v.disponibleLe + "T23:59" > String(r.depart))) {
    motifs.push(v.disponibleLe ? `en réparation jusqu'au ${formateDate(v.disponibleLe)}` : "en réparation");
  }
  const autre = etat.donnees.reservations.find((x) => x.id !== r.id && x.vehiculeAttribue === v.id && STATUTS_ACTIFS.includes(x.statut) && chevauche(x, r));
  if (autre) motifs.push(`déjà loué du ${formateDate(autre.depart)} au ${formateDate(autre.retour)}`);
  return motifs;
}

function renderAttribution(r) {
  const bloc = document.getElementById("bloc-attribution");
  const vehicules = etat.donnees.vehicules;
  const actuel = vehicules.find((v) => v.id === r.vehiculeAttribue);
  if (r.statut === "En cours") {
    bloc.innerHTML = `<h3>Véhicule</h3><p><a class="immat" href="#flotte/${escAttr(r.vehiculeAttribue)}">${escHTML(r.immatriculation || "—")}</a> chez le client depuis le ${formateDate(r.remiseLe)}</p>`;
    return;
  }
  const option = (v) => {
    const motifs = conflits(r, v);
    return `<option value="${escAttr(v.id)}"${v.id === r.vehiculeAttribue ? " selected" : ""}>${escHTML(v.immatriculation)}${v.modele !== r.vehicule ? " · " + escHTML(nomModele(v.modele)) : ""}${motifs.length ? " ⚠ " + escHTML(motifs.join(", ")) : ""}</option>`;
  };
  const memeModele = vehicules.filter((v) => v.modele === r.vehicule);
  const autres = vehicules.filter((v) => v.modele !== r.vehicule);
  const motifsActuel = actuel ? conflits(r, actuel) : [];
  bloc.innerHTML = `<h3>Véhicule attribué</h3>
    ${vehicules.length ? `<select id="choix-vehicule">
      <option value="">Non attribué</option>
      ${memeModele.length ? `<optgroup label="${escAttr(nomModele(r.vehicule))}">${memeModele.map(option).join("")}</optgroup>` : ""}
      ${autres.length ? `<optgroup label="Autres modèles (surclassement)">${autres.map(option).join("")}</optgroup>` : ""}
    </select>
    ${motifsActuel.length ? `<p class="alerte">Attention : ce véhicule est ${escHTML(motifsActuel.join(", "))}.</p>` : ""}
    <p class="aide">L'immatriculation choisie est reprise dans le contrat. Le client, lui, ne voit que le modèle.</p>`
    : '<p class="aide">Aucun véhicule dans la flotte. <a href="#flotte">Ajoutez vos véhicules</a> avec leur immatriculation pour pouvoir les attribuer.</p>'}
    <p class="etat" id="etat-attribution"></p>`;
  const select = document.getElementById("choix-vehicule");
  if (!select) return;
  select.addEventListener("change", async () => {
    const v = vehicules.find((x) => x.id === select.value);
    const etatEl = document.getElementById("etat-attribution");
    if (v && conflits(r, v).length && !confirm(`${v.immatriculation} est ${conflits(r, v).join(", ")}. L'attribuer quand même ?`)) {
      select.value = r.vehiculeAttribue || "";
      return;
    }
    select.disabled = true;
    etatEl.textContent = "Enregistrement…";
    try {
      const maj = { vehiculeAttribue: v ? v.id : "", immatriculation: v ? v.immatriculation : "" };
      await corrigerDocument("reservations", r.id, maj, jeton());
      Object.assign(r, maj);
      render();
    } catch (e) {
      select.disabled = false;
      etatEl.className = "etat erreur";
      etatEl.textContent = "Échec : " + e.message;
    }
  });
}

// ---- remise des clés et retour du véhicule

function renderRemise(r) {
  const bloc = document.getElementById("bloc-remise");
  const v = etat.donnees.vehicules.find((x) => x.id === r.vehiculeAttribue);
  if (!v) {
    bloc.innerHTML = '<h3>Remise du véhicule</h3><p class="aide">Attribuez d\'abord un véhicule (immatriculation) pour pouvoir le remettre au client.</p>';
    return;
  }
  bloc.innerHTML = `<h3>Remise du véhicule</h3>
    <form class="formulaire" id="form-remise">
      <label>Kilométrage au départ<input name="km" type="number" min="0" required value="${escAttr(r.kmDepart ?? v.kmActuel ?? "")}"></label>
      <button class="action" type="submit">Remettre ${escHTML(v.immatriculation)} au client</button>
      <p class="aide large">La location passe « En cours » et le véhicule « En circulation ».</p>
      <p class="etat large" id="etat-remise"></p>
    </form>`;
  document.getElementById("form-remise").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const km = Number(ev.target.elements.km.value);
    await ecrire("etat-remise", async () => {
      const maj = { statut: "En cours", kmDepart: km, remiseLe: new Date() };
      await corrigerDocument("reservations", r.id, maj, jeton());
      Object.assign(r, maj, { remiseLe: maj.remiseLe.toISOString() });
      await corrigerDocument("vehicules", v.id, { statut: "En circulation", kmActuel: km, disponibleLe: "" }, jeton());
      Object.assign(v, { statut: "En circulation", kmActuel: km, disponibleLe: "" });
      if (r.contrat) {
        // le contrat reprend le kilométrage réel s'il n'avait pas été saisi
        const contrat = await lireDocument("contrats", r.contrat, jeton()).catch(() => null);
        if (contrat && (contrat.kmDepart === "" || contrat.kmDepart == null)) await corrigerDocument("contrats", r.contrat, { kmDepart: km }, jeton());
      }
    });
  });
}

function renderRetour(r) {
  const bloc = document.getElementById("bloc-retour");
  const v = etat.donnees.vehicules.find((x) => x.id === r.vehiculeAttribue);
  const jours = joursLocation(r);
  const tarif = MODELES[r.vehicule] || {};
  bloc.innerHTML = `<h3>Retour du véhicule</h3>
    <form class="formulaire" id="form-retour">
      <label>Kilométrage au retour<input name="km" type="number" min="${escAttr(r.kmDepart || 0)}" required></label>
      <button class="action" type="submit">Enregistrer le retour</button>
      <p class="aide large" id="calcul-km">Inclus : ${nombre(FRAIS.kmInclusParJour * jours)} km (${jours} j × ${FRAIS.kmInclusParJour} km).</p>
      <p class="etat large" id="etat-retour"></p>
    </form>`;
  const form = document.getElementById("form-retour");
  form.elements.km.addEventListener("input", () => {
    const parcourus = Number(form.elements.km.value) - Number(r.kmDepart || 0);
    const exces = parcourus - FRAIS.kmInclusParJour * jours;
    document.getElementById("calcul-km").textContent = `${nombre(parcourus)} km parcourus, ${nombre(FRAIS.kmInclusParJour * jours)} inclus.` +
      (exces > 0 ? ` Supplément : ${nombre(exces)} km × ${tarif.kmSup || 3} MAD = ${nombre(exces * (tarif.kmSup || 3))} MAD (repris dans la facture).` : " Pas de supplément.");
  });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const km = Number(form.elements.km.value);
    await ecrire("etat-retour", async () => {
      const maj = { statut: "Terminée", kmRetour: km, retourLe: new Date() };
      await corrigerDocument("reservations", r.id, maj, jeton());
      Object.assign(r, maj, { retourLe: maj.retourLe.toISOString() });
      if (v) {
        const majV = { kmActuel: Math.max(km, Number(v.kmActuel) || 0) };
        if (v.statut === "En circulation") majV.statut = "Disponible";
        await corrigerDocument("vehicules", v.id, majV, jeton());
        Object.assign(v, majV);
      }
      await majDisponibilite(r.vehicule); // un retour anticipé libère le modèle sur le site
    });
  });
}

async function annuler(r) {
  if (!confirm("Annuler cette réservation ? Les dates seront libérées sur le site.")) return;
  await ecrire("etat-action", async () => {
    const maj = { statut: "Annulée", annuleeLe: new Date() };
    await corrigerDocument("reservations", r.id, maj, jeton());
    r.statut = "Annulée";
    await majDisponibilite(r.vehicule);
  });
}

async function ecrire(idEtat, action) {
  const etatEl = document.getElementById(idEtat);
  ficheEl.querySelectorAll("button, select").forEach((b) => { b.disabled = true; });
  etatEl.className = "etat";
  etatEl.textContent = "Enregistrement…";
  try {
    await action();
    render();
  } catch (e) {
    ficheEl.querySelectorAll("button, select").forEach((b) => { b.disabled = false; });
    etatEl.className = "etat erreur";
    etatEl.textContent = "Échec : " + e.message;
  }
}

// ---- dossier client : lien envoyé par WhatsApp, formulaire rempli par le client (dossier.html)

function nouveauJeton() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const octets = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(octets, (o) => alphabet[o % alphabet.length]).join("");
}

function lienDossier(jeton) {
  return new URL(`../dossier.html?d=${jeton}`, location.href).href;
}

function messageDossier(r, jeton) {
  return `Bonjour, ici Malysia Car Pro. Pour préparer votre contrat de location` +
    (r.vehiculeNom ? ` (${r.vehiculeNom}` + (r.depart && r.retour ? `, du ${formateDate(r.depart)} au ${formateDate(r.retour)}` : "") + ")" : "") +
    `, merci de compléter votre dossier et d'y ajouter une photo de votre permis et de votre pièce d'identité : ${lienDossier(jeton)}`;
}

async function renderDossier(r) {
  const bloc = document.getElementById("bloc-dossier");
  if (!r.dossier) {
    bloc.innerHTML = `<h3>Dossier client</h3>
      <p class="aide">Envoie au client un lien pour qu'il remplisse ses informations et photographie son permis et sa pièce d'identité.</p>
      ${r.telephone ? '<button class="action secondaire" id="demander-dossier">Demander le dossier par WhatsApp</button>' : '<p class="aide">Pas de numéro de téléphone sur cette demande.</p>'}
      <p id="etat-dossier"></p>`;
    const bouton = document.getElementById("demander-dossier");
    if (bouton) bouton.addEventListener("click", () => demanderDossier(r));
    return;
  }
  bloc.innerHTML = '<h3>Dossier client</h3><p class="aide">Chargement…</p>';
  let dossier, fiche, pieces;
  try {
    dossier = await lireDocument("dossiers", r.dossier, jeton());
    if (dossier && dossier.statut === "Reçu") {
      fiche = await lireDocument(`dossiers/${r.dossier}/prive`, "fiche", jeton());
      pieces = await Promise.all(PIECES.map(([nom]) =>
        lireDocument(`dossiers/${r.dossier}/pieces`, nom, jeton())));
    }
  } catch {
    if (selectionId === r.id) bloc.innerHTML = '<h3>Dossier client</h3><p class="aide">Le dossier n\'a pas pu être chargé. Rechargez la page.</p>';
    return;
  }
  if (selectionId !== r.id || !document.getElementById("bloc-dossier")) return; // une autre fiche a été ouverte entre-temps
  const renvoyer = `<a class="whatsapp" target="_blank" rel="noopener" href="${escAttr(lienWhatsApp(r.telephone, messageDossier(r, r.dossier)))}">Renvoyer le lien par WhatsApp</a>`;
  if (!dossier || dossier.statut !== "Reçu" || !fiche) {
    bloc.innerHTML = `<h3>Dossier client</h3>
      <p class="aide">Lien envoyé, en attente du client. Rechargez la page pour voir s'il a répondu.</p>${renvoyer}`;
    return;
  }
  const alertes = alertesDossier(fiche, r);
  bloc.innerHTML = `<h3>Dossier client ${badge("Reçu")}</h3>
    ${alertes.map((a) => `<p class="alerte">${escHTML(a)}</p>`).join("")}
    <div class="champs">
      <div><span>Nom</span>${escHTML(fiche.nom)} ${escHTML(fiche.prenom)}</div>
      <div><span>Naissance</span>${escHTML(formateDate(fiche.dateNaissance))} à ${escHTML(fiche.lieuNaissance)}</div>
      <div><span>Nationalité</span>${escHTML(fiche.nationalite)}</div>
      <div><span>E-mail</span>${escHTML(fiche.email)}</div>
      <div><span>Téléphone</span>${escHTML(fiche.telephone)}</div>
      <div><span>Adresse</span>${escHTML(fiche.adresse)}, ${escHTML(fiche.ville)}, ${escHTML(fiche.pays)}</div>
      <div><span>${escHTML(fiche.typePiece)}</span>${escHTML(fiche.numeroPiece)} (exp. ${escHTML(formateDate(fiche.expirationPiece))})</div>
      <div><span>Permis</span>${escHTML(fiche.numeroPermis)} (${escHTML(fiche.paysPermis)}, délivré le ${escHTML(formateDate(fiche.delivrancePermis))})</div>
    </div>
    <div class="pieces">
      ${PIECES.map(([, libelle], i) => pieces[i] && typeof pieces[i].image === "string" && pieces[i].image.startsWith("data:image/")
        ? `<figure><img src="${escAttr(pieces[i].image)}" alt="${escAttr(libelle)}" data-libelle="${escAttr(libelle)}"><figcaption>${escHTML(libelle)}</figcaption></figure>`
        : "").join("")}
    </div>`;
  bloc.querySelectorAll(".pieces img").forEach((img) => img.addEventListener("click", () => {
    visionneuse.querySelector("img").src = img.src;
    visionneuse.querySelector("figcaption").textContent = img.dataset.libelle;
    visionneuse.showModal();
  }));
  bloc.insertAdjacentHTML("beforeend", '<div id="bloc-contrat"></div>');
  renderContrat(r, fiche);
}

// ---- contrat : généré depuis la réservation et le dossier, partagé au client par lien (contrat.html)

function joursLocation(r) {
  const ms = new Date(r.retour) - new Date(r.depart);
  return Number.isFinite(ms) ? Math.max(1, Math.ceil(ms / 86400000)) : 1;
}

function lienContrat(jeton) {
  return new URL(`../contrat.html?c=${jeton}`, location.href).href;
}

function messageContrat(r, contrat, jeton) {
  return `Bonjour, ici Malysia Car Pro. Voici votre contrat de location n° ${contrat.numero}` +
    (r.vehiculeNom ? ` (${r.vehiculeNom}` + (r.depart && r.retour ? `, du ${formateDate(r.depart)} au ${formateDate(r.retour)}` : "") + ")" : "") +
    `. Vous pouvez le consulter et le télécharger ici : ${lienContrat(jeton)} . Il sera signé ensemble à la remise du véhicule.`;
}

async function renderContrat(r, fiche) {
  const bloc = document.getElementById("bloc-contrat");
  let existant = null;
  if (r.contrat) {
    try { existant = await lireDocument("contrats", r.contrat, jeton()); } catch {}
    if (selectionId !== r.id || !document.getElementById("bloc-contrat")) return;
  }
  const tarif = MODELES[r.vehicule] || {};
  const jours = joursLocation(r);
  const attribue = etat.donnees.vehicules.find((x) => x.id === r.vehiculeAttribue);
  const v = existant ? existant.vehicule || {} : {};
  const loc = existant ? existant.location || {} : {};
  const val = (x, defaut) => escAttr(x !== undefined && x !== null && x !== "" ? x : defaut ?? "");
  const paiement = loc.paiement || "Carte bancaire (CMI)";
  bloc.innerHTML = `<h3>Contrat ${existant ? badge("Généré") : ""}</h3>
    ${existant ? `<a class="whatsapp" target="_blank" rel="noopener" href="${escAttr(lienContrat(r.contrat))}">Voir le contrat</a>
      <a class="whatsapp" target="_blank" rel="noopener" href="${escAttr(lienWhatsApp(r.telephone, messageContrat(r, existant, r.contrat)))}">Envoyer le contrat par WhatsApp</a>` : ""}
    <form id="form-contrat" class="form-contrat formulaire">
      <label>Immatriculation<input name="immatriculation" required value="${val(r.immatriculation || v.immatriculation)}"></label>
      <label>Carburant<input name="carburant" value="${val(v.carburant, (attribue && attribue.carburant) || tarif.carburant)}"></label>
      <label>Kilométrage au départ<input name="kmDepart" type="number" min="0" value="${val(existant && existant.kmDepart, r.kmDepart ?? (attribue && attribue.kmActuel))}" placeholder="à la remise"></label>
      <label>Prix total TTC (MAD)<input name="prixTotal" type="number" min="0" required value="${val(loc.prixTotal, tarif.prixJour ? tarif.prixJour * jours : "")}"></label>
      <label>Caution (MAD)<input name="caution" type="number" min="0" required value="${val(loc.caution, tarif.caution)}"></label>
      <label>Paiement<select name="paiement">${["Carte bancaire (CMI)", "Virement", "Espèces"].map((p) => `<option${p === paiement ? " selected" : ""}>${p}</option>`).join("")}</select></label>
      <label class="large">Options<input name="options" value="${val(loc.options)}" placeholder="siège bébé, conducteur additionnel…"></label>
      <label class="large">Agent<input name="agent" value="${val(existant && existant.agent)}"></label>
      <p class="aide large">${tarif.prixJour ? `Prix proposé : ${jours} jour${jours > 1 ? "s" : ""} × ${tarif.prixJour} MAD. Ajustez en cas de remise (tarif dégressif dès 7 jours).` : "Véhicule hors grille : saisissez le prix."}</p>
      <button class="action large" type="submit">${existant ? "Mettre à jour le contrat" : "Générer le contrat"}</button>
      <p id="etat-contrat" class="large"></p>
    </form>`;
  document.getElementById("form-contrat").addEventListener("submit", (ev) => {
    ev.preventDefault();
    enregistrerContrat(r, fiche, existant, ev.target);
  });
}

async function enregistrerContrat(r, fiche, existant, form) {
  const etatEl = document.getElementById("etat-contrat");
  const bouton = form.querySelector("button");
  const f = form.elements;
  const tarif = MODELES[r.vehicule] || {};
  const kmSup = tarif.kmSup || 3;
  const nombreSaisi = (x) => (x.value === "" ? "" : Number(x.value));
  const locataire = {};
  for (const k of ["nom", "prenom", "dateNaissance", "lieuNaissance", "nationalite", "adresse", "ville", "pays", "telephone", "email",
    "typePiece", "numeroPiece", "expirationPiece", "numeroPermis", "delivrancePermis", "paysPermis"]) locataire[k] = fiche[k] || "";
  const contrat = {
    numero: existant ? existant.numero : `MCP-${new Date().getFullYear()}-${r.id.slice(0, 6).toUpperCase()}`,
    reservationId: r.id,
    societe: { ...SOCIETE },
    locataire,
    vehicule: { nom: r.vehiculeNom || tarif.nom || "", categorie: tarif.categorie || "", immatriculation: f.immatriculation.value.trim(), carburant: f.carburant.value.trim() },
    location: {
      formule: r.formule || "", depart: r.depart || "", lieuDepart: r.lieuPriseEnCharge || "", retour: r.retour || "", lieuRetour: r.lieuRestitution || "",
      jours: joursLocation(r), prixJour: tarif.prixJour || "", prixTotal: nombreSaisi(f.prixTotal), caution: nombreSaisi(f.caution),
      paiement: f.paiement.value, options: f.options.value.trim(), kmInclus: FRAIS.kmInclusParJour, kmSup,
    },
    agent: f.agent.value.trim(),
    kmDepart: nombreSaisi(f.kmDepart),
    conditions: conditionsGenerales(kmSup).map(([titre, texte]) => ({ titre, texte })),
    modifieLe: new Date(),
  };
  bouton.disabled = true;
  etatEl.className = "large";
  etatEl.textContent = "Enregistrement…";
  try {
    if (existant) {
      await corrigerDocument("contrats", r.contrat, contrat, jeton());
    } else {
      const nouveau = nouveauJeton();
      await creerDocument("contrats", { ...contrat, creeLe: new Date() }, { ...jeton(), id: nouveau });
      await corrigerDocument("reservations", r.id, { contrat: nouveau }, jeton());
      r.contrat = nouveau;
    }
    // la fiche client se complète avec le dossier (sans bloquer le contrat si elle échoue)
    await majClientDepuisDossier(r.telephone, fiche).catch(() => {});
    renderContrat(r, fiche);
  } catch (e) {
    bouton.disabled = false;
    etatEl.className = "large erreur";
    etatEl.textContent = "Échec : " + e.message;
  }
}

function anneesEntre(debut, fin) {
  const a = new Date(debut), b = new Date(fin);
  let n = b.getFullYear() - a.getFullYear();
  if (b.getMonth() < a.getMonth() || (b.getMonth() === a.getMonth() && b.getDate() < a.getDate())) n--;
  return n;
}

function alertesDossier(fiche, r) {
  const reference = (r.depart || "").split("T")[0] || new Date().toISOString().slice(0, 10);
  const alertes = [];
  if (fiche.dateNaissance && anneesEntre(fiche.dateNaissance, reference) < 21) alertes.push("Le conducteur aura moins de 21 ans au départ.");
  if (fiche.delivrancePermis && anneesEntre(fiche.delivrancePermis, reference) < 2) alertes.push("Le permis aura moins de 2 ans au départ.");
  const fin = (r.retour || "").split("T")[0];
  if (fiche.expirationPiece && fin && fiche.expirationPiece < fin) alertes.push("La pièce d'identité expire avant la fin de la location.");
  return alertes;
}

async function demanderDossier(r) {
  const bouton = document.getElementById("demander-dossier");
  const etatEl = document.getElementById("etat-dossier");
  // ouverte tout de suite, pendant le clic, sinon le navigateur bloque la fenêtre WhatsApp
  const fenetre = window.open("", "_blank");
  bouton.disabled = true;
  etatEl.textContent = "Préparation du lien…";
  try {
    const nouveau = nouveauJeton();
    await creerDocument("dossiers", {
      reservationId: r.id,
      vehiculeNom: r.vehiculeNom || "",
      depart: r.depart || "",
      retour: r.retour || "",
      telephone: r.telephone || "",
      statut: "En attente",
      creeLe: new Date(),
    }, { ...jeton(), id: nouveau });
    await corrigerDocument("reservations", r.id, { dossier: nouveau }, jeton());
    r.dossier = nouveau;
    const lien = lienWhatsApp(r.telephone, messageDossier(r, nouveau));
    if (fenetre) fenetre.location.href = lien; else window.open(lien, "_blank");
    render();
  } catch (e) {
    if (fenetre) fenetre.close();
    bouton.disabled = false;
    etatEl.className = "erreur";
    etatEl.textContent = "Échec : " + e.message;
  }
}

// ---- message client (WhatsApp) : le numéro suffit, pas besoin que le client ait un compte

function messageConfirmation(r) {
  return `Bonjour, ici Malysia Car Pro. Votre réservation` +
    (r.vehiculeNom ? ` pour ${r.vehiculeNom}` : "") +
    (r.depart && r.retour ? ` du ${formateDate(r.depart)} au ${formateDate(r.retour)}` : "") +
    ` est confirmée. À bientôt !`;
}

function actionPour(statut) {
  switch (statut) {
    case "À confirmer":
      return { libelle: "Confirmer la réservation", prochain: "Confirmée",
        aide: "Bloque ces dates sur le site quand tous les véhicules du modèle sont pris, et passe la demande en confirmée. Pensez à rappeler le client." };
    case "Confirmée":
      return { libelle: "Marquer payée", prochain: "Payée",
        aide: "À utiliser une fois le paiement et la caution encaissés." };
    case "Payée":
      return { libelle: "Marquer prête à livrer", prochain: "Prête à livrer",
        aide: "Le véhicule est préparé. Le contrat se signe à la remise du véhicule." };
    case "Prête à livrer":
      return { libelle: "", prochain: null, aide: "Remettez le véhicule au client ci-dessous le jour du départ." };
    case "En cours":
      return { libelle: "", prochain: null, aide: "Le véhicule est chez le client. Enregistrez son retour ci-dessous." };
    case "Terminée":
      return { libelle: "", prochain: null, aide: "Location terminée, véhicule restitué." };
    case "Annulée":
      return { libelle: "", prochain: null, aide: "Réservation annulée, dates libérées." };
    default:
      return { libelle: "", prochain: null, aide: "" };
  }
}

async function appliquerAction(r, prochainStatut) {
  await ecrire("etat-action", async () => {
    await corrigerDocument("reservations", r.id, { statut: prochainStatut }, jeton());
    r.statut = prochainStatut;
    if (prochainStatut === "Confirmée") await majDisponibilite(r.vehicule);
  });
}

// ---- démarrage

if (!estConfigure()) {
  erreurConnexion.textContent = "Configuration Firebase manquante (firebase-config.js).";
} else {
  const s = chargerSession();
  if (s && s.expire > Date.now()) {
    etat.session = s;
    afficherApp();
  }
}
