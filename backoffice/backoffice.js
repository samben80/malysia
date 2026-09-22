import {
  connecter,
  listerDocuments,
  corrigerDocument,
  lireDocument,
  estConfigure,
} from "../assets/firestore-rest.js";

const CLE_SESSION = "malysia_bo_session";
const ORDRE_STATUTS = ["À confirmer", "Confirmée", "Payée", "Prête à livrer"];

const ecranConnexion = document.getElementById("ecran-connexion");
const app = document.getElementById("app");
const formConnexion = document.getElementById("form-connexion");
const erreurConnexion = document.getElementById("erreur-connexion");
const quiConnecte = document.getElementById("qui-connecte");
const listeEl = document.getElementById("liste");
const ficheEl = document.getElementById("fiche");
const filtresEl = document.getElementById("filtres");

let session = null; // { idToken, email }
let reservations = [];
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
  session = s;
  try { sessionStorage.setItem(CLE_SESSION, JSON.stringify(s)); } catch {}
}
function effacerSession() {
  session = null;
  try { sessionStorage.removeItem(CLE_SESSION); } catch {}
}

function afficherApp() {
  ecranConnexion.style.display = "none";
  app.classList.add("actif");
  quiConnecte.textContent = session.email;
  chargerReservations();
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

// ---- chargement des réservations

async function chargerReservations() {
  listeEl.innerHTML = '<div class="vide">Chargement…</div>';
  try {
    reservations = await listerDocuments("reservations", { idToken: session.idToken, max: 200 });
    reservations.sort((a, b) => String(b.creeLe || "").localeCompare(String(a.creeLe || "")));
    render();
  } catch (e) {
    if (String(e.message).includes("401") || String(e.message).includes("403")) {
      afficherConnexion("Session expirée, reconnectez-vous.");
      return;
    }
    listeEl.innerHTML = '<div class="vide">Le chargement a échoué. Rechargez la page.</div>';
  }
}

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
}

function renderKpis() {
  const aConfirmer = reservations.filter((r) => r.statut === "À confirmer").length;
  const confirmees = reservations.filter((r) => r.statut === "Confirmée").length;
  document.getElementById("kpi-a-confirmer").textContent = aConfirmer;
  document.getElementById("kpi-confirmees").textContent = confirmees;
  document.getElementById("kpi-total").textContent = reservations.length;
  document.getElementById("nb-total").textContent = reservations.length;
}

function renderListe() {
  const visibles = filtreActuel ? reservations.filter((r) => r.statut === filtreActuel) : reservations;
  if (visibles.length === 0) {
    listeEl.innerHTML = '<div class="vide">Aucune demande pour ce filtre.</div>';
    return;
  }
  listeEl.innerHTML = "";
  for (const r of visibles) {
    const div = document.createElement("div");
    div.className = "ligne" + (r.id === selectionId ? " selectionnee" : "");
    div.innerHTML = `
      <div>
        <div class="ref">${r.id.slice(0, 8).toUpperCase()} · ${r.formule || "—"}</div>
        <div class="vehicule">${escHTML(r.vehiculeNom || "Véhicule non précisé")}</div>
        <div class="dates">${formateDate(r.depart)} → ${formateDate(r.retour)}</div>
      </div>
      <span class="statut" data-s="${r.statut}">${r.statut}</span>
    `;
    div.addEventListener("click", () => { selectionId = r.id; render(); });
    listeEl.appendChild(div);
  }
}

function renderFiche() {
  const r = reservations.find((x) => x.id === selectionId);
  if (!r) {
    ficheEl.innerHTML = '<div class="vide">Sélectionnez une demande dans la liste.</div>';
    return;
  }
  const { libelle, aide, prochain } = actionPour(r.statut);
  ficheEl.innerHTML = `
    <span class="statut" data-s="${r.statut}">${r.statut}</span>
    <h2>${escHTML(r.vehiculeNom || "Véhicule non précisé")}</h2>
    <div class="ref">${r.id}</div>
    <div class="champs">
      <div><span>Formule</span>${escHTML(r.formule || "—")}</div>
      <div><span>Téléphone</span><a class="tel" href="tel:${escAttr(r.telephone)}">${escHTML(r.telephone || "—")}</a></div>
      <div><span>Prise en charge</span>${escHTML(r.lieuPriseEnCharge || "—")}</div>
      <div><span>Restitution</span>${escHTML(r.lieuRestitution || "—")}</div>
      <div><span>Départ</span>${formateDate(r.depart)}</div>
      <div><span>Retour</span>${formateDate(r.retour)}</div>
    </div>
    ${prochain
      ? `<button class="action" id="bouton-action">${libelle}</button><p class="aide">${aide}</p>`
      : `<p class="aide">${aide}</p>`}
    <p id="etat-action"></p>
    ${r.statut !== "À confirmer" && r.telephone
      ? `<a class="whatsapp" target="_blank" rel="noopener" href="${escAttr(lienWhatsApp(r))}">Prévenir le client par WhatsApp</a>`
      : ""}
  `;
  if (prochain) {
    document.getElementById("bouton-action").addEventListener("click", () => appliquerAction(r, prochain));
  }
}

// ---- message client (WhatsApp) : le numéro suffit, pas besoin que le client ait un compte

function telWhatsApp(tel) {
  const chiffres = String(tel || "").replace(/[^\d+]/g, "");
  if (chiffres.startsWith("+")) return chiffres.slice(1);
  if (chiffres.startsWith("0")) return "212" + chiffres.slice(1);
  return chiffres;
}

function lienWhatsApp(r) {
  const message =
    `Bonjour, ici Excellence VIPs. Votre réservation` +
    (r.vehiculeNom ? ` pour ${r.vehiculeNom}` : "") +
    (r.depart && r.retour ? ` du ${formateDate(r.depart)} au ${formateDate(r.retour)}` : "") +
    ` est confirmée. À bientôt !`;
  return `https://wa.me/${telWhatsApp(r.telephone)}?text=${encodeURIComponent(message)}`;
}

function actionPour(statut) {
  switch (statut) {
    case "À confirmer":
      return { libelle: "Confirmer la réservation", prochain: "Confirmée",
        aide: "Bloque ces dates pour ce véhicule et passe la demande en confirmée. Pensez à rappeler le client." };
    case "Confirmée":
      return { libelle: "Marquer payée", prochain: "Payée",
        aide: "À utiliser une fois le paiement et la caution encaissés." };
    case "Payée":
      return { libelle: "Marquer prête à livrer", prochain: "Prête à livrer",
        aide: "Affecte la réservation à la livraison. L'état des lieux et le contrat sont à gérer à part pour l'instant." };
    default:
      return { libelle: "", prochain: null, aide: "Cette demande est arrivée au bout du parcours actuel." };
  }
}

async function appliquerAction(r, prochainStatut) {
  const bouton = document.getElementById("bouton-action");
  const etat = document.getElementById("etat-action");
  bouton.disabled = true;
  etat.className = "";
  etat.textContent = "Enregistrement…";
  try {
    if (prochainStatut === "Confirmée" && r.vehicule) {
      await bloquerDates(r.vehicule, r.depart, r.retour);
    }
    await corrigerDocument("reservations", r.id, { statut: prochainStatut }, { idToken: session.idToken });
    r.statut = prochainStatut;
    etat.className = "ok";
    etat.textContent = "Fait.";
    render();
  } catch (e) {
    etat.className = "erreur";
    etat.textContent = "Échec : " + e.message;
    bouton.disabled = false;
  }
}

async function bloquerDates(vehiculeId, debut, fin) {
  if (!debut || !fin) return; // pas de dates saisies : rien à bloquer
  const doc = await lireDocument("disponibilite", vehiculeId, { idToken: session.idToken });
  const occupations = (doc && doc.occupations) || [];
  occupations.push({ debut, fin });
  await corrigerDocument("disponibilite", vehiculeId, { occupations }, { idToken: session.idToken });
}

// ---- utilitaires

function formateDate(v) {
  if (!v) return "—";
  const [d, h] = String(v).split("T");
  if (!d) return v;
  const [an, mois, jour] = d.split("-");
  return `${jour}/${mois}/${an}${h ? " " + h : ""}`;
}
function escHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escAttr(s) { return escHTML(s); }

// ---- démarrage

if (!estConfigure()) {
  erreurConnexion.textContent = "Configuration Firebase manquante (firebase-config.js).";
} else {
  const s = chargerSession();
  if (s && s.expire > Date.now()) {
    session = s;
    afficherApp();
  }
}
