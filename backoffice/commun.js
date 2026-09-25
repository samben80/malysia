// Outils et données partagés par tous les écrans du back-office.
import { listerDocuments, corrigerDocument } from "../assets/firestore-rest.js";
import { TARIFS } from "../assets/contrat-modele.js";

// Session de l'équipe et données chargées à la connexion (tableaux de documents).
export const etat = {
  session: null,
  donnees: { reservations: [], vehicules: [], maintenance: [], clients: [], factures: [], modeles: [] },
};

export const jeton = () => ({ idToken: etat.session.idToken });

// Modèles présentés sur le site (catégories vues par le client). Les véhicules
// de la flotte, eux, sont suivis un par un avec leur immatriculation.
// Chargés depuis la collection « modeles » (onglet Flotte > Modèles) ; tant
// qu'elle est vide, on garde la grille d'origine de contrat-modele.js.
export const MODELES = { ...TARIFS };
// Sur le site, le client peut demander un modèle précis, ou seulement une
// marque (« marque:Bentley ») ou une catégorie (« cat:SUV ») : l'équipe
// choisit alors le modèle en attribuant un véhicule.
export const estDemandeGroupe = (id) => /^(cat|marque):/.test(String(id || ""));
export function nomModele(id) {
  if (MODELES[id] && MODELES[id].nom) return MODELES[id].nom;
  const m = String(id || "").match(/^(cat|marque):(.+)$/);
  if (m) return `${m[2]}, modèle au choix`;
  return id || "Modèle inconnu";
}
// Marque, catégorie du site (type) et gamme d'un modèle.
export function infosModele(id) {
  const m = MODELES[id] || {};
  return { marque: m.marque || String(m.nom || "").split(" ")[0] || "", type: m.type || "", gamme: m.categorie || "" };
}
// Le modèle correspond-il à la demande du client (modèle, marque ou catégorie) ?
export function correspondDemande(demande, modele) {
  if (!demande) return false;
  if (demande === modele) return true;
  const [, genre, valeur] = String(demande).match(/^(cat|marque):(.+)$/) || [];
  if (!genre) return false;
  const i = infosModele(modele);
  return genre === "cat" ? i.type === valeur : i.marque.toLowerCase() === valeur.toLowerCase();
}

// ---- filtres des listes (recherche + menus déroulants)

export const sansAccentsMinuscules = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Barre de filtres : une recherche libre et des menus. `criteres` garde les valeurs choisies.
export function barreFiltres(criteres, { recherche, menus }) {
  const actifs = Object.values(criteres).some(Boolean);
  return `<div class="barre-filtres">
    <input type="search" data-critere="texte" value="${escAttr(criteres.texte || "")}" placeholder="${escAttr(recherche)}" aria-label="${escAttr(recherche)}">
    ${menus.filter((m) => m.options.length > 1 || criteres[m.nom]).map((m) => `<select data-critere="${m.nom}" aria-label="${escAttr(m.libelle)}">
      <option value="">${escHTML(m.libelle)}</option>
      ${m.options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${escAttr(v)}"${String(v) === String(criteres[m.nom] || "") ? " selected" : ""}>${escHTML(l)}</option>`; }).join("")}
    </select>`).join("")}
    <button type="button" class="lien-reinit" data-reinit ${actifs ? "" : "hidden"}>Effacer les filtres</button>
  </div>`;
}

export function lierFiltres(zone, criteres, surChangement) {
  const reinit = zone.querySelector("[data-reinit]");
  const maj = () => { if (reinit) reinit.hidden = !Object.values(criteres).some(Boolean); surChangement(); };
  zone.querySelectorAll("[data-critere]").forEach((el) => {
    el.addEventListener(el.tagName === "INPUT" ? "input" : "change", () => { criteres[el.dataset.critere] = el.value.trim(); maj(); });
  });
  if (reinit) reinit.addEventListener("click", () => {
    for (const k of Object.keys(criteres)) criteres[k] = "";
    zone.querySelectorAll("[data-critere]").forEach((el) => { el.value = ""; });
    maj();
  });
}

// Tous les mots cherchés doivent apparaître dans l'un des textes.
export function contientTexte(recherche, ...textes) {
  const mots = sansAccentsMinuscules(recherche).split(/\s+/).filter(Boolean);
  if (!mots.length) return true;
  const botte = sansAccentsMinuscules(textes.filter((t) => t != null).join(" ")).replace(/[-\s]/g, " ");
  const compacte = botte.replace(/ /g, "");
  return mots.every((m) => botte.includes(m) || compacte.includes(m.replace(/-/g, "")));
}

export const STATUTS_VEHICULE = ["Disponible", "En circulation", "En réparation", "Hors service"];
// Réservations qui occupent un véhicule sur leurs dates.
export const STATUTS_ACTIFS = ["Confirmée", "Payée", "Prête à livrer", "En cours"];

// Charge toutes les collections du back-office. Renvoie la liste de celles
// que les règles de sécurité refusent encore (règles pas encore publiées).
export async function chargerTout() {
  const noms = Object.keys(etat.donnees);
  const refusees = [];
  const listes = await Promise.all(noms.map((n) => listerDocuments(n, jeton()).catch((e) => {
    if (n === "reservations" || e.status !== 403) throw e;
    refusees.push(n);
    return [];
  })));
  noms.forEach((n, i) => { etat.donnees[n] = listes[i]; });
  etat.donnees.reservations.sort((a, b) => String(b.creeLe || "").localeCompare(String(a.creeLe || "")));
  synchroniserModeles();
  return refusees;
}

// Recopie les modèles de Firestore dans MODELES (id → nom, prix, carburant…).
export function synchroniserModeles() {
  const liste = etat.donnees.modeles;
  if (!liste.length) return;
  for (const k of Object.keys(MODELES)) delete MODELES[k];
  for (const m of [...liste].sort((a, b) => (a.ordre ?? 999) - (b.ordre ?? 999) || String(a.nom).localeCompare(String(b.nom)))) {
    MODELES[m.id] = { ...m, nom: m.nom || [m.marque, m.modele].filter(Boolean).join(" ") };
  }
}

// ---- disponibilité publique d'un modèle
//
// Le site n'affiche que des modèles. Un modèle est indisponible sur une
// période seulement quand tous ses véhicules sont pris : réservations en
// cours ou à venir, véhicules en réparation jusqu'à leur date prévue. Tant
// qu'aucun véhicule du modèle n'est saisi dans la flotte, chaque réservation
// bloque le modèle, comme avant.

export function occupationsModele(modele, { reservations, vehicules }, maintenant = maintenantISO()) {
  const unites = vehicules.filter((v) => v.modele === modele && v.statut !== "Hors service");
  let capacite = unites.length || 1;
  const periodes = [];
  for (const v of unites) {
    if (v.statut !== "En réparation") continue;
    if (v.disponibleLe) periodes.push({ debut: maintenant, fin: v.disponibleLe + "T23:59" });
    else capacite--; // en réparation sans date de retour : hors du parc
  }
  for (const r of reservations) {
    if (r.vehicule !== modele || !STATUTS_ACTIFS.includes(r.statut) || !r.depart || !r.retour) continue;
    let fin = String(r.retour).slice(0, 16);
    if (r.statut === "En cours" && fin <= maintenant) fin = decalerJours(maintenant, 1) + maintenant.slice(10); // retour en retard : toujours dehors
    if (fin <= maintenant) continue;
    periodes.push({ debut: String(r.depart).slice(0, 16), fin });
  }
  if (capacite <= 0) return [{ debut: maintenant, fin: "9999-12-31T23:59" }];

  const evenements = [];
  for (const p of periodes) {
    if (p.fin <= p.debut) continue;
    evenements.push([p.debut, 1], [p.fin, -1]);
  }
  evenements.sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] < b[0] ? -1 : 1));
  const occupations = [];
  let pris = 0, debut = null;
  for (const [t, delta] of evenements) {
    pris += delta;
    if (pris >= capacite && debut === null) debut = t;
    else if (pris < capacite && debut !== null) {
      if (t > debut) occupations.push({ debut, fin: t });
      debut = null;
    }
  }
  return occupations;
}

export async function majDisponibilite(modele) {
  if (!modele || !MODELES[modele]) return;
  const occupations = occupationsModele(modele, etat.donnees);
  await corrigerDocument("disponibilite", modele, { occupations }, jeton());
}

// ---- alertes d'entretien et d'échéances d'un véhicule

export const INTERVALLE_VIDANGE_KM = 10000;
export const INTERVALLE_PNEUS_KM = 40000;

export function derniereIntervention(vehiculeId, type) {
  return etat.donnees.maintenance
    .filter((m) => m.vehiculeId === vehiculeId && m.type === type && m.statut === "Terminée")
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.km || 0) - (a.km || 0))[0] || null;
}

export function alertesVehicule(v) {
  const alertes = [];
  if (v.statut === "Hors service") return alertes;
  const aujourdhui = aujourdhuiISO();
  const dans30j = decalerJours(aujourdhui, 30);
  for (const [cle, libelle] of [["assurance", "Assurance"], ["visiteTechnique", "Visite technique"], ["vignette", "Vignette"]]) {
    const d = v[cle];
    if (!d) continue;
    if (d < aujourdhui) alertes.push({ niveau: "danger", texte: `${libelle} expirée depuis le ${formateDate(d)}` });
    else if (d <= dans30j) alertes.push({ niveau: "attention", texte: `${libelle} à renouveler avant le ${formateDate(d)}` });
  }
  const km = Number(v.kmActuel) || 0;
  const vidange = derniereIntervention(v.id, "Vidange");
  if (vidange && vidange.km !== "" && vidange.km != null) {
    const reste = Number(vidange.km) + (Number(v.intervalleVidangeKm) || INTERVALLE_VIDANGE_KM) - km;
    if (reste <= 0) alertes.push({ niveau: "danger", texte: `Vidange dépassée de ${nombre(-reste)} km` });
    else if (reste <= 1000) alertes.push({ niveau: "attention", texte: `Vidange à faire dans ${nombre(reste)} km` });
    else if (vidange.date && decalerJours(vidange.date, 365) < aujourdhui) alertes.push({ niveau: "attention", texte: "Dernière vidange il y a plus d'un an" });
  } else if (km > 0) {
    alertes.push({ niveau: "attention", texte: "Aucune vidange enregistrée" });
  }
  const pneus = derniereIntervention(v.id, "Pneus");
  if (pneus && pneus.km !== "" && pneus.km != null) {
    const reste = Number(pneus.km) + (Number(v.intervallePneusKm) || INTERVALLE_PNEUS_KM) - km;
    if (reste <= 0) alertes.push({ niveau: "danger", texte: `Pneus à changer (dépassé de ${nombre(-reste)} km)` });
    else if (reste <= 2000) alertes.push({ niveau: "attention", texte: `Pneus à contrôler, changement dans ${nombre(reste)} km` });
  }
  if (v.statut === "En réparation" && v.disponibleLe && v.disponibleLe < aujourdhui) {
    alertes.push({ niveau: "danger", texte: `Retour de réparation prévu le ${formateDate(v.disponibleLe)}, dépassé` });
  }
  return alertes;
}

// ---- réservations d'un véhicule

export function reservationsVehicule(vehiculeId) {
  return etat.donnees.reservations
    .filter((r) => r.vehiculeAttribue === vehiculeId && STATUTS_ACTIFS.includes(r.statut))
    .sort((a, b) => String(a.depart).localeCompare(String(b.depart)));
}

export function chevauche(a, b) {
  return a.depart && a.retour && b.depart && b.retour && a.depart < b.retour && a.retour > b.depart;
}

// ---- clients : un client est identifié par son numéro de téléphone

export function cleClient(tel) {
  const c = telWhatsApp(tel);
  return /^\d{8,15}$/.test(c) ? c : "";
}

export function telWhatsApp(tel) {
  const chiffres = String(tel || "").replace(/[^\d+]/g, "");
  if (chiffres.startsWith("+")) return chiffres.slice(1);
  if (chiffres.startsWith("00")) return chiffres.slice(2);
  if (chiffres.startsWith("0")) return "212" + chiffres.slice(1);
  return chiffres;
}

export function lienWhatsApp(tel, message) {
  return `https://wa.me/${telWhatsApp(tel)}?text=${encodeURIComponent(message)}`;
}

// ---- mise en forme

export function formateDate(v) {
  if (!v) return "—";
  const [d, h] = String(v).split("T");
  if (!d) return v;
  const [an, mois, jour] = d.split("-");
  if (!jour) return v;
  return `${jour.slice(0, 2)}/${mois}/${an}${h && /^\d\d:\d\d/.test(h) && v.length <= 16 ? " " + h.slice(0, 5) : ""}`;
}

export const nombre = (n) => Number(n || 0).toLocaleString("fr-FR");
export const mad = (n) => `${Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} MAD`;

export function escHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export const escAttr = escHTML;

export const aujourdhuiISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const maintenantISO = () => {
  const d = new Date();
  return `${aujourdhuiISO()}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
export function decalerJours(dateISO, jours) {
  const d = new Date(String(dateISO).slice(0, 10) + "T12:00:00");
  d.setDate(d.getDate() + jours);
  return d.toISOString().slice(0, 10);
}

// « 12345 a 6 », « 12345|A|6 » → « 12345-A-6 »
export function normaliserImmat(s) {
  return String(s || "").trim().toUpperCase().replace(/[\s|/_-]+/g, "-").replace(/^-|-$/g, "");
}
export const cleImmat = (s) => String(s || "").toUpperCase().replace(/[^0-9A-Z\u0600-\u06FF]/g, "");

// Petit rendu de formulaire : [nom, libellé, valeur, type, attributs, options]
export function champ({ nom, libelle, valeur = "", type = "text", attrs = "", options = null, large = false }) {
  const cls = large ? ' class="large"' : "";
  if (options) {
    return `<label${cls}>${escHTML(libelle)}<select name="${nom}" ${attrs}>${options.map((o) => {
      const [val, lib] = Array.isArray(o) ? o : [o, o];
      return `<option value="${escAttr(val)}"${String(val) === String(valeur ?? "") ? " selected" : ""}>${escHTML(lib)}</option>`;
    }).join("")}</select></label>`;
  }
  if (type === "textarea") return `<label${cls}>${escHTML(libelle)}<textarea name="${nom}" rows="3" ${attrs}>${escHTML(valeur)}</textarea></label>`;
  return `<label${cls}>${escHTML(libelle)}<input name="${nom}" type="${type}" value="${escAttr(valeur ?? "")}" ${attrs}></label>`;
}

export function valeursFormulaire(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") o[el.name] = el.checked;
    else if (el.type === "number") o[el.name] = el.value === "" ? "" : Number(el.value);
    else o[el.name] = el.value.trim();
  }
  return o;
}

// Exécute une écriture en affichant son état sous le formulaire, puis redessine l'écran.
// Message d'erreur lisible : un 403 de Firestore veut presque toujours dire que
// les règles du dépôt ne sont pas publiées, ou que le compte n'est pas dans equipe().
export function messageErreur(e) {
  const m = String((e && e.message) || e);
  if (/\b403\b|PERMISSION_DENIED/.test(m)) {
    return "Échec : Firebase refuse l'accès. Soit les règles de sécurité à jour (fichier firestore.rules) ne sont pas encore publiées dans la console Firebase (Firestore > Règles), soit ce compte ne fait pas partie de l'équipe autorisée.";
  }
  return "Échec : " + m;
}

export async function executer(etatEl, rendre, action) {
  const form = etatEl.closest("form") || etatEl.parentElement;
  const boutons = form.querySelectorAll("button");
  boutons.forEach((b) => { b.disabled = true; });
  etatEl.className = "etat large";
  etatEl.textContent = "Enregistrement…";
  try {
    await action();
    rendre();
  } catch (e) {
    boutons.forEach((b) => { b.disabled = false; });
    etatEl.className = "etat large erreur";
    etatEl.textContent = messageErreur(e);
  }
}

export function badge(texte, famille = "") {
  return `<span class="statut" data-s="${escAttr(texte)}"${famille ? ` data-f="${famille}"` : ""}>${escHTML(texte)}</span>`;
}

export function blocAlertes(alertes) {
  return alertes.map((a) => `<p class="alerte${a.niveau === "attention" ? " attention" : ""}">${escHTML(a.texte)}</p>`).join("");
}

// Montant en toutes lettres, pour les factures (« Arrêtée la présente facture à la somme de… »)
export function enLettres(montant) {
  const unites = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize"];
  const dizaines = ["", "dix", "vingt", "trente", "quarante", "cinquante", "soixante"];
  function sous100(n) {
    if (n <= 16) return unites[n];
    if (n < 20) return "dix-" + unites[n - 10];
    if (n < 70) {
      const d = Math.floor(n / 10), u = n % 10;
      return dizaines[d] + (u === 0 ? "" : u === 1 ? " et un" : "-" + unites[u]);
    }
    if (n < 80) return "soixante" + (n === 71 ? " et onze" : "-" + sous100(n - 60));
    if (n === 80) return "quatre-vingts";
    return "quatre-vingt-" + sous100(n - 80);
  }
  function sous1000(n) {
    const c = Math.floor(n / 100), r = n % 100;
    let s = c === 0 ? "" : c === 1 ? "cent" : unites[c] + " cent" + (r === 0 ? "s" : "");
    if (r) s += (s ? " " : "") + sous100(r);
    return s || "zéro";
  }
  function entier(n) {
    if (n === 0) return "zéro";
    const parts = [];
    const millions = Math.floor(n / 1e6), milliers = Math.floor((n % 1e6) / 1000), reste = n % 1000;
    if (millions) parts.push(millions === 1 ? "un million" : sous1000(millions) + " millions");
    if (milliers) parts.push(milliers === 1 ? "mille" : sous1000(milliers).replace(/cents$/, "cent") + " mille");
    if (reste) parts.push(sous1000(reste));
    return parts.join(" ");
  }
  const total = Math.round(Number(montant || 0) * 100);
  const dh = Math.floor(total / 100), cts = total % 100;
  let s = `${entier(dh)} dirham${dh > 1 ? "s" : ""}`;
  if (cts) s += ` et ${entier(cts)} centime${cts > 1 ? "s" : ""}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
