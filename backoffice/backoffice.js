import {
  connecter,
  listerDocuments,
  creerDocument,
  corrigerDocument,
  lireDocument,
  estConfigure,
} from "../assets/firestore-rest.js";
import { SOCIETE, FRAIS, TARIFS, conditionsGenerales } from "../assets/contrat-modele.js";

const CLE_SESSION = "malysia_bo_session";
const ORDRE_STATUTS = ["À confirmer", "Confirmée", "Payée", "Prête à livrer"];
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
      ? `<a class="whatsapp" target="_blank" rel="noopener" href="${escAttr(lienWhatsApp(r.telephone, messageConfirmation(r)))}">Prévenir le client par WhatsApp</a>`
      : ""}
    ${r.statut !== "À confirmer" ? '<div class="dossier" id="bloc-dossier"></div>' : ""}
  `;
  if (prochain) {
    document.getElementById("bouton-action").addEventListener("click", () => appliquerAction(r, prochain));
  }
  if (r.statut !== "À confirmer") renderDossier(r);
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
    dossier = await lireDocument("dossiers", r.dossier, { idToken: session.idToken });
    if (dossier && dossier.statut === "Reçu") {
      fiche = await lireDocument(`dossiers/${r.dossier}/prive`, "fiche", { idToken: session.idToken });
      pieces = await Promise.all(PIECES.map(([nom]) =>
        lireDocument(`dossiers/${r.dossier}/pieces`, nom, { idToken: session.idToken })));
    }
  } catch {
    if (selectionId === r.id) bloc.innerHTML = '<h3>Dossier client</h3><p class="aide">Le dossier n\'a pas pu être chargé. Rechargez la page.</p>';
    return;
  }
  if (selectionId !== r.id) return; // une autre fiche a été ouverte entre-temps
  const renvoyer = `<a class="whatsapp" target="_blank" rel="noopener" href="${escAttr(lienWhatsApp(r.telephone, messageDossier(r, r.dossier)))}">Renvoyer le lien par WhatsApp</a>`;
  if (!dossier || dossier.statut !== "Reçu" || !fiche) {
    bloc.innerHTML = `<h3>Dossier client</h3>
      <p class="aide">Lien envoyé, en attente du client. Rechargez la page pour voir s'il a répondu.</p>${renvoyer}`;
    return;
  }
  const alertes = alertesDossier(fiche, r);
  bloc.innerHTML = `<h3>Dossier client <span class="statut" data-s="Confirmée">Reçu</span></h3>
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
    try { existant = await lireDocument("contrats", r.contrat, { idToken: session.idToken }); } catch {}
    if (selectionId !== r.id) return;
  }
  const tarif = TARIFS[r.vehicule] || {};
  const jours = joursLocation(r);
  const v = existant ? existant.vehicule || {} : {};
  const loc = existant ? existant.location || {} : {};
  const val = (x, defaut) => escAttr(x ?? defaut ?? "");
  const paiement = loc.paiement || "Carte bancaire (CMI)";
  bloc.innerHTML = `<h3>Contrat ${existant ? '<span class="statut" data-s="Confirmée">Généré</span>' : ""}</h3>
    ${existant ? `<a class="whatsapp" target="_blank" rel="noopener" href="${escAttr(lienContrat(r.contrat))}">Voir le contrat</a>
      <a class="whatsapp" target="_blank" rel="noopener" href="${escAttr(lienWhatsApp(r.telephone, messageContrat(r, existant, r.contrat)))}">Envoyer le contrat par WhatsApp</a>` : ""}
    <form id="form-contrat" class="form-contrat">
      <label>Immatriculation<input name="immatriculation" required value="${val(v.immatriculation)}"></label>
      <label>Carburant<input name="carburant" value="${val(v.carburant, tarif.carburant)}"></label>
      <label>Kilométrage au départ<input name="kmDepart" type="number" min="0" value="${val(existant && existant.kmDepart)}" placeholder="à la remise"></label>
      <label>Prix total TTC (MAD)<input name="prixTotal" type="number" min="0" required value="${val(loc.prixTotal, tarif.prixJour ? tarif.prixJour * jours : "")}"></label>
      <label>Caution (MAD)<input name="caution" type="number" min="0" required value="${val(loc.caution)}"></label>
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
  const etat = document.getElementById("etat-contrat");
  const bouton = form.querySelector("button");
  const f = form.elements;
  const tarif = TARIFS[r.vehicule] || {};
  const kmSup = tarif.kmSup || 3;
  const nombre = (x) => (x.value === "" ? "" : Number(x.value));
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
      jours: joursLocation(r), prixJour: tarif.prixJour || "", prixTotal: nombre(f.prixTotal), caution: nombre(f.caution),
      paiement: f.paiement.value, options: f.options.value.trim(), kmInclus: FRAIS.kmInclusParJour, kmSup,
    },
    agent: f.agent.value.trim(),
    kmDepart: nombre(f.kmDepart),
    conditions: conditionsGenerales(kmSup).map(([titre, texte]) => ({ titre, texte })),
    modifieLe: new Date(),
  };
  bouton.disabled = true;
  etat.className = "large";
  etat.textContent = "Enregistrement…";
  try {
    if (existant) {
      await corrigerDocument("contrats", r.contrat, contrat, { idToken: session.idToken });
    } else {
      const jeton = nouveauJeton();
      await creerDocument("contrats", { ...contrat, creeLe: new Date() }, { idToken: session.idToken, id: jeton });
      await corrigerDocument("reservations", r.id, { contrat: jeton }, { idToken: session.idToken });
      r.contrat = jeton;
    }
    renderContrat(r, fiche);
  } catch (e) {
    bouton.disabled = false;
    etat.className = "large erreur";
    etat.textContent = "Échec : " + e.message;
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
  const etat = document.getElementById("etat-dossier");
  // ouverte tout de suite, pendant le clic, sinon le navigateur bloque la fenêtre WhatsApp
  const fenetre = window.open("", "_blank");
  bouton.disabled = true;
  etat.textContent = "Préparation du lien…";
  try {
    const jeton = nouveauJeton();
    await creerDocument("dossiers", {
      reservationId: r.id,
      vehiculeNom: r.vehiculeNom || "",
      depart: r.depart || "",
      retour: r.retour || "",
      telephone: r.telephone || "",
      statut: "En attente",
      creeLe: new Date(),
    }, { idToken: session.idToken, id: jeton });
    await corrigerDocument("reservations", r.id, { dossier: jeton }, { idToken: session.idToken });
    r.dossier = jeton;
    const lien = lienWhatsApp(r.telephone, messageDossier(r, jeton));
    if (fenetre) fenetre.location.href = lien; else window.open(lien, "_blank");
    render();
  } catch (e) {
    if (fenetre) fenetre.close();
    bouton.disabled = false;
    etat.className = "erreur";
    etat.textContent = "Échec : " + e.message;
  }
}

// ---- message client (WhatsApp) : le numéro suffit, pas besoin que le client ait un compte

function telWhatsApp(tel) {
  const chiffres = String(tel || "").replace(/[^\d+]/g, "");
  if (chiffres.startsWith("+")) return chiffres.slice(1);
  if (chiffres.startsWith("0")) return "212" + chiffres.slice(1);
  return chiffres;
}

function messageConfirmation(r) {
  return `Bonjour, ici Malysia Car Pro. Votre réservation` +
    (r.vehiculeNom ? ` pour ${r.vehiculeNom}` : "") +
    (r.depart && r.retour ? ` du ${formateDate(r.depart)} au ${formateDate(r.retour)}` : "") +
    ` est confirmée. À bientôt !`;
}

function lienWhatsApp(tel, message) {
  return `https://wa.me/${telWhatsApp(tel)}?text=${encodeURIComponent(message)}`;
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
        aide: "Affecte la réservation à la livraison. Le contrat se signe à la remise du véhicule." };
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
