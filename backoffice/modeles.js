// Modèles de la flotte : ce que le client voit sur le site (marque, modèle,
// type, boîte, carburant, places, prix, photo). Les véhicules de l'onglet
// « Véhicules » sont rattachés à un modèle. La page d'accueil du site est
// régénérée à partir de ces fiches (outils/catalogue.mjs, lancé
// automatiquement sur GitHub toutes les 15 minutes).
import { creerDocument, corrigerDocument, lireDocument, supprimerDocument } from "../assets/firestore-rest.js";
import {
  etat, jeton, synchroniserModeles, nombre, escHTML, escAttr, champ, valeursFormulaire, badge, executer,
} from "./commun.js";

export const TYPES_SITE = ["Berline", "SUV", "Luxe & sport", "Van", "Utilitaire"];
const GAMMES = ["Économique", "Compacte", "Familial", "Affaires", "Premium", "Groupe", "Transport", "Exception"];

// Les 8 modèles présents sur le site avant la création de cet onglet.
const MODELES_INITIAUX = [
  { id: "veh-dacia-logan", marque: "Dacia", modele: "Logan", type: "Berline", categorie: "Économique", places: 5, carburant: "Diesel", boite: "Manuelle", prixJour: 290, kmSup: 2, description: "Berline économique 5 places, diesel, boîte manuelle." },
  { id: "veh-golf-8", marque: "Volkswagen", modele: "Golf 8", type: "Berline", categorie: "Compacte", places: 5, carburant: "Diesel", boite: "Automatique", prixJour: 480, kmSup: 2, description: "Compacte 5 places, diesel, boîte DSG." },
  { id: "veh-mercedes-classe-e", marque: "Mercedes", modele: "Classe E", type: "Berline", categorie: "Affaires", places: 5, carburant: "Diesel", boite: "Automatique", prixJour: 1450, kmSup: 3, description: "Berline d'affaires 5 places, diesel, boîte automatique." },
  { id: "veh-range-rover-sport", marque: "Range Rover", modele: "Sport", type: "SUV", categorie: "Premium", places: 5, carburant: "Essence", boite: "Automatique", prixJour: 2200, kmSup: 5, description: "SUV premium 5 places, essence, boîte automatique." },
  { id: "veh-porsche-911", marque: "Porsche", modele: "911 Carrera", type: "Luxe & sport", categorie: "Exception", places: 2, carburant: "Essence", boite: "Automatique", prixJour: 5900, kmSup: 10, description: "Sportive d'exception 2 places, essence, boîte PDK." },
  { id: "veh-mercedes-classe-v", marque: "Mercedes", modele: "Classe V", type: "Van", categorie: "Groupe", places: 7, carburant: "Diesel", boite: "Automatique", prixJour: 1900, kmSup: 3, description: "Van 7 places, diesel, boîte automatique." },
  { id: "veh-renault-master", marque: "Renault", modele: "Master 12 m³", type: "Utilitaire", categorie: "Transport", places: 3, carburant: "Diesel", boite: "Manuelle", prixJour: 550, kmSup: 3, description: "Utilitaire 12 m³ 3 places, diesel, boîte manuelle." },
  { id: "veh-hyundai-tucson", marque: "Hyundai", modele: "Tucson", type: "SUV", categorie: "Familial", places: 5, carburant: "Hybride", boite: "Automatique", prixJour: 750, kmSup: 3, description: "SUV familial 5 places, hybride, boîte automatique." },
];

let selection = null; // id du modèle, ou "nouveau"
let section = null;
let photoEnAttente = null; // { image, vignette } choisie mais pas encore enregistrée

export function afficherModeles(el, param) {
  section = el;
  if (param) selection = param;
  photoEnAttente = null;
  rendre();
}

export function sousOnglets(actif) {
  return `<nav class="sous-onglets"><a href="#flotte" class="${actif === "flotte" ? "actif" : ""}">Véhicules</a><a href="#modeles" class="${actif === "modeles" ? "actif" : ""}">Modèles et caractéristiques</a></nav>`;
}

const nomComplet = (m) => m.nom || [m.marque, m.modele].filter(Boolean).join(" ");
const photoParDefaut = (id) => `../assets/${id}.webp`;

function rendre() {
  const modeles = [...etat.donnees.modeles].sort((a, b) => (a.ordre ?? 999) - (b.ordre ?? 999) || nomComplet(a).localeCompare(nomComplet(b)));
  const nbVehicules = (id) => etat.donnees.vehicules.filter((v) => v.modele === id).length;
  section.innerHTML = `
    <div class="entete"><h1>Flotte</h1><div class="actions-entete"><button class="bouton" id="nouveau-modele">+ Nouveau modèle</button></div></div>
    ${sousOnglets("modeles")}
    ${modeles.length ? "" : `<div class="panneau">
      <h2>Reprendre les modèles du site</h2>
      <p class="aide">Aucun modèle n'est encore enregistré ici. Reprenez les 8 modèles affichés aujourd'hui sur le site (Dacia Logan, Golf 8, Classe E…) avec leurs prix et leurs photos, puis modifiez-les à votre guise.</p>
      <button class="bouton" id="reprendre-modeles">Reprendre les 8 modèles du site</button>
      <p class="etat" id="etat-reprise"></p>
    </div>`}
    <p class="aide-ecran">Ce que vous enregistrez ici s'affiche sur le site dans la section « Notre flotte », environ 15 à 30 minutes après l'enregistrement.</p>
    <div class="disposition">
      <div class="liste">${modeles.length ? modeles.map((m) => `
        <div class="ligne ligne-modele${m.id === selection ? " selectionnee" : ""}" data-id="${escAttr(m.id)}">
          <img src="${escAttr(m.vignette || photoParDefaut(m.id))}" alt="" loading="lazy">
          <div>
            <div class="ref">${escHTML(m.type || "")} · ${escHTML(m.categorie || "")}</div>
            <div class="vehicule">${escHTML(nomComplet(m))}</div>
            <div class="dates">${nombre(m.prixJour)} MAD / jour · ${escHTML([m.boite, m.carburant, m.places ? m.places + " places" : ""].filter(Boolean).join(" · "))} · ${nbVehicules(m.id)} véhicule${nbVehicules(m.id) > 1 ? "s" : ""}</div>
          </div>
          ${badge(m.visible === false ? "Masqué" : "Sur le site")}
        </div>`).join("") : '<div class="vide">Aucun modèle.</div>'}</div>
      <div class="fiche" id="fiche-modele"></div>
    </div>`;
  section.querySelector("#nouveau-modele").addEventListener("click", () => { selection = "nouveau"; photoEnAttente = null; rendre(); });
  section.querySelectorAll(".liste .ligne").forEach((l) => l.addEventListener("click", () => { selection = l.dataset.id; photoEnAttente = null; rendre(); }));
  const reprendre = section.querySelector("#reprendre-modeles");
  if (reprendre) reprendre.addEventListener("click", () => reprendreModeles(section.querySelector("#etat-reprise")));
  rendreFiche();
}

function rendreFiche() {
  const zone = section.querySelector("#fiche-modele");
  const m = selection === "nouveau" ? null : etat.donnees.modeles.find((x) => x.id === selection);
  if (!m && selection !== "nouveau") { zone.innerHTML = '<div class="vide">Sélectionnez un modèle, ou créez-en un.</div>'; return; }
  const d = m || { type: "Berline", boite: "Manuelle", carburant: "Diesel", places: 5, kmSup: 3, visible: true };
  const vehicules = m ? etat.donnees.vehicules.filter((v) => v.modele === m.id) : [];
  zone.innerHTML = `
    ${m ? badge(m.visible === false ? "Masqué" : "Sur le site") : ""}
    <h2>${m ? escHTML(nomComplet(m)) : "Nouveau modèle"}</h2>
    ${m ? `<div class="ref">${escHTML(m.id)} · ${vehicules.length} véhicule${vehicules.length > 1 ? "s" : ""} dans la flotte</div>` : ""}
    <figure class="photo-modele">
      <img id="apercu-photo" src="${escAttr(m ? (m.vignette || photoParDefaut(m.id)) : "")}" alt="" ${m ? "" : "hidden"}>
      <figcaption>Photo affichée sur le site (recadrée au format 16/10, 1200 × 750).</figcaption>
    </figure>
    <label class="bouton secondaire bloc">${m ? "Changer la photo" : "Choisir une photo"}<input type="file" id="fichier-photo" accept="image/*" hidden></label>
    <p class="etat" id="etat-photo"></p>
    <form class="formulaire" id="form-modele">
      ${champ({ nom: "marque", libelle: "Marque", valeur: d.marque, attrs: 'required placeholder="Dacia"' })}
      ${champ({ nom: "modele", libelle: "Modèle", valeur: d.modele, attrs: 'required placeholder="Logan"' })}
      ${champ({ nom: "type", libelle: "Type (filtre du site)", valeur: d.type, options: TYPES_SITE })}
      ${champ({ nom: "categorie", libelle: "Gamme", valeur: d.categorie, attrs: 'list="liste-gammes" placeholder="Économique"' })}
      ${champ({ nom: "boite", libelle: "Boîte de vitesses", valeur: d.boite, options: ["Manuelle", "Automatique"] })}
      ${champ({ nom: "carburant", libelle: "Carburant", valeur: d.carburant, options: ["Diesel", "Essence", "Hybride", "Électrique"] })}
      ${champ({ nom: "places", libelle: "Places", valeur: d.places, type: "number", attrs: 'min="1" max="60" required' })}
      ${champ({ nom: "portes", libelle: "Portes", valeur: d.portes, type: "number", attrs: 'min="1" max="6"' })}
      ${champ({ nom: "bagages", libelle: "Valises", valeur: d.bagages, type: "number", attrs: 'min="0" max="30"' })}
      ${champ({ nom: "prixJour", libelle: "Prix par jour TTC (MAD)", valeur: d.prixJour, type: "number", attrs: 'min="0" required' })}
      ${champ({ nom: "kmSup", libelle: "Km supplémentaire (MAD)", valeur: d.kmSup, type: "number", attrs: 'min="0" step="0.5"' })}
      ${champ({ nom: "caution", libelle: "Caution (MAD)", valeur: d.caution, type: "number", attrs: 'min="0"' })}
      ${champ({ nom: "description", libelle: "Description courte (lue par Google et les IA)", valeur: d.description, type: "textarea", large: true, attrs: 'maxlength="300"' })}
      ${champ({ nom: "ordre", libelle: "Ordre d'affichage", valeur: d.ordre, type: "number", attrs: 'min="0"' })}
      <label class="case"><input type="checkbox" name="visible" ${d.visible === false ? "" : "checked"}> Afficher sur le site</label>
      <datalist id="liste-gammes">${GAMMES.map((g) => `<option value="${escAttr(g)}">`).join("")}</datalist>
      <button class="action large" type="submit">${m ? "Enregistrer" : "Créer le modèle"}</button>
      ${m ? "" : '<button class="action secondaire large" type="button" id="annuler-modele">Annuler</button>'}
      <p class="etat large" id="etat-modele"></p>
    </form>
    ${m ? '<button class="lien-danger" id="supprimer-modele">Supprimer ce modèle</button><p class="etat" id="etat-suppression"></p>' : ""}`;

  const apercu = zone.querySelector("#apercu-photo");
  if (m) {
    // photo en pleine taille : celle enregistrée ici, sinon celle d'origine du site
    apercu.addEventListener("error", () => { if (m.vignette && apercu.src !== m.vignette) apercu.src = m.vignette; else apercu.hidden = true; }, { once: true });
    if (m.photoMaj) {
      lireDocument(`modeles/${m.id}/medias`, "photo", jeton())
        .then((p) => { if (p && p.image && !photoEnAttente && selection === m.id) apercu.src = p.image; })
        .catch(() => {});
    } else {
      apercu.src = photoParDefaut(m.id);
    }
  }
  zone.querySelector("#fichier-photo").addEventListener("change", async (ev) => {
    const etatPhoto = zone.querySelector("#etat-photo");
    const fichier = ev.target.files[0];
    if (!fichier) return;
    etatPhoto.className = "etat";
    etatPhoto.textContent = "Préparation de la photo…";
    try {
      photoEnAttente = await preparerPhoto(fichier);
      apercu.src = photoEnAttente.image;
      apercu.hidden = false;
      etatPhoto.textContent = m ? "Nouvelle photo prête : cliquez sur « Enregistrer »." : "Photo prête.";
    } catch (e) {
      etatPhoto.className = "etat erreur";
      etatPhoto.textContent = "Photo illisible : " + e.message;
    }
  });
  const form = zone.querySelector("#form-modele");
  form.addEventListener("submit", (ev) => { ev.preventDefault(); enregistrer(m, form); });
  const annuler = zone.querySelector("#annuler-modele");
  if (annuler) annuler.addEventListener("click", () => { selection = null; rendre(); });
  const supprimer = zone.querySelector("#supprimer-modele");
  if (supprimer) supprimer.addEventListener("click", () => supprimerModele(m, zone.querySelector("#etat-suppression")));
}

function slug(texte) {
  return String(texte).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/³/g, "3").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function enregistrer(m, form) {
  const etatEl = form.querySelector("#etat-modele");
  const donnees = valeursFormulaire(form);
  donnees.nom = [donnees.marque, donnees.modele].filter(Boolean).join(" ");
  donnees.modifieLe = new Date();
  const doublon = etat.donnees.modeles.find((x) => x.nom.toLowerCase() === donnees.nom.toLowerCase() && (!m || x.id !== m.id));
  if (doublon) { etatEl.className = "etat large erreur"; etatEl.textContent = "Ce modèle existe déjà."; return; }
  if (photoEnAttente) {
    donnees.vignette = photoEnAttente.vignette;
    donnees.photoMaj = new Date();
  }
  await executer(etatEl, rendre, async () => {
    // la photo en pleine taille est rangée à part : la liste des modèles reste légère
    const enregistrerPhoto = (id) => corrigerDocument(`modeles/${id}/medias`, "photo", { image: photoEnAttente.image, modifieLe: new Date() }, jeton());
    if (m) {
      if (photoEnAttente) await enregistrerPhoto(m.id);
      await corrigerDocument("modeles", m.id, donnees, jeton());
      Object.assign(m, donnees);
    } else {
      const base = "veh-" + slug(donnees.nom);
      let cree = null;
      for (let n = 1; !cree; n++) {
        try {
          cree = await creerDocument("modeles", { ...donnees, creeLe: new Date() }, { ...jeton(), id: n === 1 ? base : `${base}-${n}` });
        } catch (e) {
          if (e.status !== 409 || n > 20) throw e; // identifiant déjà pris : on essaie le suivant
        }
      }
      if (photoEnAttente) await enregistrerPhoto(cree.id);
      etat.donnees.modeles.push(cree);
      selection = cree.id;
    }
    photoEnAttente = null;
    synchroniserModeles();
  });
}

async function supprimerModele(m, etatEl) {
  const utilise = etat.donnees.vehicules.some((v) => v.modele === m.id) || etat.donnees.reservations.some((r) => r.vehicule === m.id);
  if (utilise) {
    etatEl.className = "etat erreur";
    etatEl.textContent = "Ce modèle a des véhicules ou des réservations : décochez plutôt « Afficher sur le site ».";
    return;
  }
  if (!confirm(`Supprimer définitivement le modèle ${nomComplet(m)} ?`)) return;
  await executer(etatEl, rendre, async () => {
    await supprimerDocument(`modeles/${m.id}/medias`, "photo", jeton()).catch(() => {});
    await supprimerDocument("modeles", m.id, jeton());
    etat.donnees.modeles = etat.donnees.modeles.filter((x) => x.id !== m.id);
    selection = null;
    synchroniserModeles();
  });
}

async function reprendreModeles(etatEl) {
  await executer(etatEl, rendre, async () => {
    for (const [i, base] of MODELES_INITIAUX.entries()) {
      etatEl.textContent = `Reprise de ${base.marque} ${base.modele}… (${i + 1}/${MODELES_INITIAUX.length})`;
      const { id, ...champs } = base;
      let vignette = "";
      try { vignette = (await preparerPhoto(await (await fetch(photoParDefaut(id))).blob())).vignette; } catch {}
      const donnees = { ...champs, nom: `${base.marque} ${base.modele}`, visible: true, ordre: i + 1, vignette, creeLe: new Date(), modifieLe: new Date() };
      try {
        etat.donnees.modeles.push(await creerDocument("modeles", donnees, { ...jeton(), id }));
      } catch (e) {
        if (e.status !== 409) throw e;
        const existant = await lireDocument("modeles", id, jeton());
        if (existant && !etat.donnees.modeles.some((x) => x.id === id)) etat.donnees.modeles.push(existant);
      }
    }
    synchroniserModeles();
  });
}

// Recadre la photo au format du site (16/10, 1200 × 750, WebP) et prépare une vignette.
async function preparerPhoto(fichier) {
  const bitmap = await createImageBitmap(fichier);
  const rendu = (largeur, hauteur, qualite) => {
    const canvas = document.createElement("canvas");
    canvas.width = largeur;
    canvas.height = hauteur;
    const ctx = canvas.getContext("2d");
    const echelle = Math.max(largeur / bitmap.width, hauteur / bitmap.height);
    const l = bitmap.width * echelle, h = bitmap.height * echelle;
    ctx.fillStyle = "#F6F0E6";
    ctx.fillRect(0, 0, largeur, hauteur);
    ctx.drawImage(bitmap, (largeur - l) / 2, (hauteur - h) / 2, l, h);
    let url = canvas.toDataURL("image/webp", qualite);
    if (!url.startsWith("data:image/webp")) url = canvas.toDataURL("image/jpeg", qualite);
    return url;
  };
  let image = rendu(1200, 750, 0.82);
  for (const q of [0.7, 0.6, 0.5]) { if (image.length < 900000) break; image = rendu(1200, 750, q); }
  if (image.length >= 1000000) throw new Error("image trop lourde même compressée.");
  return { image, vignette: rendu(240, 150, 0.7) };
}
