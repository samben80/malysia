// Utilisateurs du back-office : comptes de connexion et droits module par module.
//
// Une fiche utilisateurs/{e-mail} par personne : actif ou non, administrateur
// ou non, et pour chaque module les droits accès / créer / modifier /
// supprimer. Les règles Firestore lisent cette fiche à chaque requête : un
// changement de droits s'applique tout de suite, sans reconnexion.
//
// Sans serveur, ce qui touche au compte de connexion d'un autre est limité
// (voir firestore-rest.js) : on crée le compte avec un mot de passe
// provisoire, on envoie un lien de réinitialisation par e-mail, et
// « supprimer » retire tout accès sans effacer le compte de connexion.
import {
  listerDocuments, creerDocument, corrigerDocument, supprimerDocument, creerCompte, envoyerLienMotDePasse,
} from "../assets/firestore-rest.js";
import {
  etat, jeton, PROPRIETAIRE, MODULES, ACTIONS, droitsTous, escHTML, escAttr, badge, formateDate, messageErreur,
  FORMULES, formule, moduleDansFormule,
} from "./commun.js";

// Comptes qui avaient accès par la liste d'e-mails de l'ancien firestore.rules :
// proposés à la reprise tant qu'ils n'ont pas de fiche.
const ANCIENNE_EQUIPE = ["anas@bgp.ma"];

let section = null;
let utilisateurs = null; // null : pas encore chargés
let refus = false;       // règles d'avant la gestion des utilisateurs
let selection = null;    // e-mail, « nouveau » ou null
let message = null;      // { texte, erreur } affiché en haut de la fiche

export function afficherUtilisateurs(el, param) {
  section = el;
  if (param) selection = param;
  if (utilisateurs === null) charger();
  else rendre();
}

async function charger() {
  section.innerHTML = '<div class="entete"><h1>Utilisateurs</h1></div><p class="aide-ecran">Chargement…</p>';
  try {
    utilisateurs = await listerDocuments("utilisateurs", jeton());
    refus = false;
  } catch (e) {
    if (e.status !== 403) {
      section.innerHTML = `<div class="entete"><h1>Utilisateurs</h1></div><p class="alerte">${escHTML(messageErreur(e))}</p>`;
      return;
    }
    utilisateurs = [];
    refus = true;
  }
  rendre();
}

const email = (u) => u.id;
const libelle = (u) => u.nom || email(u);

function lignes() {
  const autres = utilisateurs.filter((u) => email(u) !== PROPRIETAIRE)
    .sort((a, b) => libelle(a).localeCompare(libelle(b), "fr"));
  const aReprendre = ANCIENNE_EQUIPE.filter((m) => !utilisateurs.some((u) => email(u) === m))
    .map((m) => ({ id: m, aReprendre: true }));
  const proprio = utilisateurs.find((u) => email(u) === PROPRIETAIRE) || {};
  return [{ ...proprio, id: PROPRIETAIRE, proprietaire: true }, ...autres, ...aReprendre];
}

function etiquette(u) {
  if (u.proprietaire) return "Propriétaire";
  if (u.aReprendre) return "À reprendre";
  if (u.actif !== true) return "Désactivé";
  return u.admin ? "Administrateur" : "Actif";
}

function resumeDroits(u) {
  if (u.proprietaire || u.admin) return "tous les droits";
  if (u.aReprendre) return "accès complet avant ce changement";
  const ouverts = MODULES.filter(([id]) => u.droits && u.droits[id] && u.droits[id].acces).map(([, nom]) => nom);
  return ouverts.length ? ouverts.join(", ") : "aucun module";
}

function rendre() {
  if (refus) { rendreReglesAPublier(); return; }
  const liste = lignes();
  section.innerHTML = `
    <div class="entete"><h1>Utilisateurs</h1><button class="bouton" id="nouvel-utilisateur">+ Nouvel utilisateur</button></div>
    <p class="aide-ecran">Chaque personne de l'équipe a son propre compte. Les droits s'appliquent dès l'enregistrement, module par module.</p>
    ${blocFormule()}
    <div class="disposition">
      <div class="liste">${liste.map((u) => `
        <div class="ligne${selection === email(u) ? " selectionnee" : ""}" data-email="${escAttr(email(u))}">
          <div><div class="ref">${escHTML(email(u))}</div><div class="vehicule">${escHTML(u.nom || email(u))}</div><div class="dates">${escHTML(resumeDroits(u))}</div></div>
          ${badge(etiquette(u))}
        </div>`).join("")}
      </div>
      <div class="fiche" id="fiche-utilisateur"></div>
    </div>`;
  section.querySelector("#nouvel-utilisateur").addEventListener("click", () => { selection = "nouveau"; message = null; rendre(); });
  section.querySelectorAll(".ligne[data-email]").forEach((l) => l.addEventListener("click", () => {
    selection = l.dataset.email;
    message = null;
    rendre();
  }));
  lierFormule();
  rendreFiche(liste);
}

// ---- formule du back-office (parametres/societe)

const DESCRIPTION_FORMULE = {
  complete: "Tout le back-office : dossier client et contrat, maintenance, clients en compte, facturation, statistiques.",
  vente: "Vendre et encaisser, puis noter la sortie et le retour du véhicule (kilométrage, carburant, état). Sans dossier client ni contrat. Modules : tableau de bord, réservations, flotte, paiements, facturation.",
};
let messageFormule = null;

function blocFormule() {
  const actuelle = formule();
  return `<form class="panneau" id="form-formule">
    <h2>Formule du back-office</h2>
    ${Object.entries(FORMULES).map(([id, f]) => `<label class="choix-formule"><input type="radio" name="formule" value="${id}"${id === actuelle ? " checked" : ""}>
      <span><b>${escHTML(f.nom)}</b><br><small>${escHTML(DESCRIPTION_FORMULE[id])}</small></span></label>`).join("")}
    <p class="aide">Les modules hors formule sont masqués pour tout le monde, administrateurs compris. Rien n'est effacé : repasser en gestion complète retrouve toutes les données.</p>
    <button class="bouton" type="submit" hidden>Enregistrer la formule</button>
    ${messageFormule ? `<p class="etat ${messageFormule.erreur ? "erreur" : "ok"}">${escHTML(messageFormule.texte)}</p>` : ""}
  </form>`;
}

function lierFormule() {
  const form = section.querySelector("#form-formule");
  const bouton = form.querySelector("button");
  form.addEventListener("change", () => { bouton.hidden = form.elements.formule.value === formule(); });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const choix = form.elements.formule.value;
    bouton.disabled = true;
    try {
      await corrigerDocument("parametres", "societe", { formule: choix, modifieLe: new Date(), modifiePar: etat.session.email }, jeton());
      etat.formule = choix;
      messageFormule = { texte: `Formule « ${FORMULES[choix].nom} » enregistrée.` };
      window.dispatchEvent(new Event("formule-changee"));
    } catch (e) {
      messageFormule = { erreur: true, texte: e.status === 403
        ? "Enregistrement refusé : collez d'abord les nouvelles règles firestore.rules dans la console Firebase (Firestore > Règles), puis réessayez."
        : messageErreur(e) };
      rendre();
    }
  });
}

function rendreReglesAPublier() {
  section.innerHTML = `
    <div class="entete"><h1>Utilisateurs</h1></div>
    <div class="panneau">
      <h2>Une étape dans la console Firebase avant de commencer</h2>
      <p class="aide">Les règles de sécurité publiées dans Firebase datent d'avant la gestion des utilisateurs : elles donnent encore tous les droits à une liste d'e-mails fixe. Pour activer cet écran :</p>
      <ol class="aide">
        <li>Ouvrez <a href="https://console.firebase.google.com/project/malysia-car-pro/firestore/rules" target="_blank" rel="noopener">la console Firebase, page Firestore &gt; Règles</a> (connecté avec le compte Google propriétaire du projet).</li>
        <li>Effacez tout le texte de l'éditeur.</li>
        <li>Collez le contenu du fichier <a href="https://github.com/samben80/malysia/blob/main/firestore.rules" target="_blank" rel="noopener">firestore.rules</a> (bouton « Copy raw file » en haut à droite sur GitHub).</li>
        <li>Cliquez sur <b>Publier</b>, attendez une minute, puis rechargez cette page.</li>
      </ol>
      <p class="aide">Vous resterez administrateur avec tous les droits. Les autres comptes (dont ${escHTML(ANCIENNE_EQUIPE.join(", "))}) n'auront plus accès tant que vous ne les aurez pas repris ici.</p>
      <button class="bouton secondaire" id="recharger-utilisateurs">J'ai publié, vérifier</button>
    </div>`;
  section.querySelector("#recharger-utilisateurs").addEventListener("click", () => { utilisateurs = null; charger(); });
}

// ---- fiche

function rendreFiche(liste) {
  const zone = section.querySelector("#fiche-utilisateur");
  const bandeau = message ? `<p class="etat ${message.erreur ? "erreur" : "ok"}">${escHTML(message.texte)}</p>` : "";
  if (selection === "nouveau") { zone.innerHTML = bandeau; formulaire(zone, null); return; }
  const u = liste.find((x) => email(x) === selection);
  if (!u) { zone.innerHTML = '<div class="vide">Sélectionnez un utilisateur, ou créez-en un.</div>'; return; }

  if (u.proprietaire) {
    zone.innerHTML = `${bandeau}${badge("Propriétaire")}
      <h2>${escHTML(u.nom || "Propriétaire")}</h2><div class="ref">${escHTML(PROPRIETAIRE)}</div>
      <p class="aide">Le compte propriétaire a tous les droits, y compris la gestion des utilisateurs. Il est inscrit directement dans les règles de sécurité : personne ne peut le désactiver ni lui retirer de droits depuis le back-office.</p>
      <p class="aide">Pour changer votre mot de passe : bouton « Mot de passe » en bas du menu.</p>`;
    return;
  }
  if (u.aReprendre) {
    zone.innerHTML = `${bandeau}${badge("À reprendre")}
      <h2>${escHTML(email(u))}</h2>
      <p class="aide">Ce compte avait un accès complet avant la gestion des utilisateurs. Il existe toujours et garde son mot de passe : choisissez ses droits pour lui rendre l'accès.</p>`;
    formulaire(zone, u, { reprise: true });
    return;
  }
  zone.innerHTML = `${bandeau}${badge(etiquette(u))}
    <h2>${escHTML(libelle(u))}</h2><div class="ref">${escHTML(email(u))}${u.creeLe ? ` · créé le ${formateDate(String(u.creeLe).slice(0, 10))}` : ""}</div>`;
  formulaire(zone, u);
  const moi = email(u) === String(etat.session.email).toLowerCase();
  zone.insertAdjacentHTML("beforeend", `
    <div class="bloc">
      <h3>Mot de passe</h3>
      <p class="aide">Firebase ne permet pas de choisir le mot de passe d'un autre compte depuis le site. Envoyez-lui plutôt un lien : il recevra un e-mail pour choisir lui-même un nouveau mot de passe.</p>
      <button class="bouton secondaire" id="lien-mdp">Envoyer le lien à ${escHTML(email(u))}</button>
      <p class="etat" id="etat-mdp"></p>
    </div>
    ${moi ? "" : `<button class="lien-danger" id="supprimer-utilisateur">Supprimer cet utilisateur</button>
    <p class="aide">Supprimer retire immédiatement tout accès au back-office. Son compte de connexion reste dans Firebase mais n'ouvre plus rien ; pour l'effacer aussi : console Firebase &gt; Authentication &gt; Users.</p>
    <p class="etat" id="etat-suppression"></p>`}`);
  zone.querySelector("#lien-mdp").addEventListener("click", async (ev) => {
    const etatEl = zone.querySelector("#etat-mdp");
    ev.target.disabled = true;
    etatEl.className = "etat";
    etatEl.textContent = "Envoi…";
    try {
      await envoyerLienMotDePasse(email(u));
      etatEl.className = "etat ok";
      etatEl.textContent = `E-mail envoyé à ${email(u)}. Le lien est valable une heure ; s'il n'arrive pas, regarder dans les indésirables.`;
    } catch (e) {
      etatEl.className = "etat erreur";
      etatEl.textContent = e.message;
    }
    ev.target.disabled = false;
  });
  const sup = zone.querySelector("#supprimer-utilisateur");
  if (sup) sup.addEventListener("click", async () => {
    if (!confirm(`Supprimer ${libelle(u)} ? Il n'aura plus accès au back-office.`)) return;
    const etatEl = zone.querySelector("#etat-suppression");
    try {
      await supprimerDocument("utilisateurs", email(u), jeton());
      utilisateurs = utilisateurs.filter((x) => email(x) !== email(u));
      selection = null;
      rendre();
    } catch (e) {
      etatEl.className = "etat erreur";
      etatEl.textContent = messageErreur(e);
    }
  });
}

function tableDroits(droits, admin) {
  return `<table class="droits">
    <thead><tr><th>Module</th>${ACTIONS.map(([, l]) => `<th>${escHTML(l)}</th>`).join("")}</tr></thead>
    <tbody>${MODULES.map(([id, nom, actions]) => `<tr><td>${escHTML(nom)}${moduleDansFormule(id) ? "" : ' <small class="aide">(hors formule)</small>'}</td>${ACTIONS.map(([a, l]) => actions.includes(a)
      ? `<td><input type="checkbox" data-module="${id}" data-action="${a}" aria-label="${escAttr(`${nom} : ${l}`)}"${admin || (droits[id] && droits[id][a]) ? " checked" : ""}${admin ? " disabled" : ""}></td>`
      : '<td class="sans">—</td>').join("")}</tr>`).join("")}</tbody>
  </table>`;
}

function motDePasseProvisoire() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (o) => alphabet[o % alphabet.length]).join("");
}

function formulaire(zone, u, { reprise = false } = {}) {
  const nouveau = !u;
  const moi = u && email(u) === String(etat.session.email).toLowerCase();
  const d = u && !reprise ? u : { nom: "", actif: true, admin: false, droits: reprise ? droitsTous(true) : droitsTous(false) };
  zone.insertAdjacentHTML("beforeend", `
    ${nouveau ? "<h2>Nouvel utilisateur</h2>" : ""}
    <form class="formulaire" id="form-utilisateur">
      <label class="large">Nom<input name="nom" value="${escAttr(d.nom || "")}" placeholder="Prénom Nom"${nouveau ? " required" : ""}></label>
      ${nouveau ? `<label class="large">E-mail (identifiant de connexion)<input name="email" type="email" required autocomplete="off"></label>
      <label class="large">Mot de passe provisoire<input name="motdepasse" required minlength="6" autocomplete="off" value="${escAttr(motDePasseProvisoire())}"></label>
      <p class="aide large">Transmettez-le à la personne avec son e-mail ; elle pourra le changer elle-même avec le bouton « Mot de passe » en bas du menu.</p>` : ""}
      ${!nouveau && !reprise ? `<label class="case large"><input type="checkbox" name="actif"${d.actif === true ? " checked" : ""}${moi ? " disabled" : ""}> Compte actif (décocher pour suspendre l'accès sans supprimer)</label>` : ""}
      <label class="case large"><input type="checkbox" name="admin"${d.admin ? " checked" : ""}${moi ? " disabled" : ""}> Administrateur : tous les droits, et gère les utilisateurs</label>
      <div class="large" id="zone-droits">
        <div class="prereglages"><button type="button" data-prereglage="tout">Tout cocher</button><button type="button" data-prereglage="lecture">Consultation seule</button><button type="button" data-prereglage="rien">Tout décocher</button></div>
        ${tableDroits(d.droits || {}, !!d.admin)}
        <p class="aide">« Supprimer / annuler » couvre l'annulation des réservations et des factures (une facture ne s'efface jamais). Sans « Accès », le module disparaît du menu.</p>
      </div>
      <button class="action large" type="submit">${nouveau ? "Créer le compte" : reprise ? "Lui rendre l'accès" : "Enregistrer"}</button>
      ${moi ? '<p class="aide large">Vous ne pouvez pas retirer vos propres droits d\'administrateur ni désactiver votre compte.</p>' : ""}
      <p class="etat large" id="etat-utilisateur"></p>
    </form>`);
  const form = zone.querySelector("#form-utilisateur");
  const cases = () => [...form.querySelectorAll("input[data-module]")];
  const caseAdmin = form.elements["admin"];
  const majCases = () => {
    for (const c of cases()) {
      if (caseAdmin.checked) { c.checked = true; c.disabled = true; continue; }
      c.disabled = false;
    }
  };
  caseAdmin.addEventListener("change", () => {
    if (!caseAdmin.checked) cases().forEach((c) => { c.checked = false; });
    majCases();
  });
  // Cocher une action ouvre l'accès au module ; retirer l'accès retire tout.
  form.addEventListener("change", (ev) => {
    const c = ev.target;
    if (!c.dataset || !c.dataset.module) return;
    const duModule = cases().filter((x) => x.dataset.module === c.dataset.module);
    if (c.dataset.action === "acces" && !c.checked) duModule.forEach((x) => { x.checked = false; });
    if (c.dataset.action !== "acces" && c.checked) duModule.find((x) => x.dataset.action === "acces").checked = true;
  });
  form.querySelectorAll("[data-prereglage]").forEach((b) => b.addEventListener("click", () => {
    if (caseAdmin.checked) return;
    for (const c of cases()) c.checked = b.dataset.prereglage === "tout" || (b.dataset.prereglage === "lecture" && c.dataset.action === "acces");
  }));
  form.addEventListener("submit", (ev) => { ev.preventDefault(); enregistrer(u, form, { reprise }); });
}

function lireDroits(form) {
  const droits = droitsTous(false);
  for (const id of Object.keys(droits)) for (const a of ["acces", "creer", "modifier", "supprimer"]) droits[id][a] = false;
  for (const c of form.querySelectorAll("input[data-module]")) {
    droits[c.dataset.module][c.dataset.action] = c.checked;
  }
  for (const d of Object.values(droits)) if (!d.acces) for (const a of Object.keys(d)) d[a] = false;
  return droits;
}

async function enregistrer(u, form, { reprise }) {
  const f = form.elements;
  const etatEl = form.querySelector("#etat-utilisateur");
  const boutons = form.querySelectorAll("button");
  const admin = f["admin"].checked;
  const donnees = {
    nom: f["nom"].value.trim(),
    admin,
    droits: admin ? droitsTous(true) : lireDroits(form),
    modifieLe: new Date(),
    modifiePar: etat.session.email,
  };
  if (!u || reprise) donnees.actif = true;
  else if (f["actif"]) donnees.actif = f["actif"].checked || f["actif"].disabled;
  boutons.forEach((b) => { b.disabled = true; });
  etatEl.className = "etat large";
  etatEl.textContent = "Enregistrement…";
  try {
    if (u && !reprise) {
      await corrigerDocument("utilisateurs", email(u), donnees, jeton());
      Object.assign(u, donnees);
      message = { texte: "Droits enregistrés : ils s'appliquent dès maintenant." };
    } else {
      const mail = (u ? email(u) : f["email"].value).trim().toLowerCase();
      if (utilisateurs.some((x) => email(x) === mail) || mail === PROPRIETAIRE) throw new Error("cet e-mail a déjà une fiche dans la liste.");
      let texte;
      if (reprise) {
        texte = `Accès rendu à ${mail}, avec son mot de passe habituel.`;
      } else {
        try {
          await creerCompte(mail, f["motdepasse"].value);
          texte = `Compte créé. Transmettez à la personne son identifiant (${mail}) et son mot de passe provisoire : ${f["motdepasse"].value}`;
        } catch (e) {
          if (e.code !== "EMAIL_EXISTS") throw e;
          if (!confirm(`Un compte de connexion existe déjà pour ${mail} (par exemple un ancien utilisateur supprimé). Lui donner accès quand même ? Il gardera son ancien mot de passe ; vous pourrez lui envoyer un lien pour le changer.`)) {
            throw new Error("création annulée.");
          }
          texte = `Accès donné à ${mail}. Il garde son mot de passe existant : envoyez-lui le lien ci-dessous s'il ne le connaît plus.`;
        }
      }
      const cree = await creerDocument("utilisateurs", { ...donnees, email: mail, creeLe: new Date(), creePar: etat.session.email }, { ...jeton(), id: mail });
      utilisateurs.push(cree);
      selection = mail;
      message = { texte };
    }
    rendre();
  } catch (e) {
    boutons.forEach((b) => { b.disabled = false; });
    etatEl.className = "etat large erreur";
    etatEl.textContent = e.message && !/Firestore/.test(e.message) ? "Échec : " + e.message : messageErreur(e);
  }
}
