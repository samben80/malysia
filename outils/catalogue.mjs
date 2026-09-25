// Régénère la section « Notre flotte » de index.html, les données structurées
// (JSON-LD) et llms.txt à partir des modèles saisis dans le back-office
// (collection Firestore « modeles », en lecture publique).
//
// Le site reste du HTML statique, lisible sans JavaScript par Google et les
// moteurs IA : ce script tourne sur GitHub (.github/workflows/catalogue.yml)
// et commite le résultat. Il ne touche à rien si Firestore ne répond pas ou si
// aucun modèle n'est publié.
//
//   node outils/catalogue.mjs            (lit la vraie base)
//   FIRESTORE_URL=http://127.0.0.1:8080/v1/projects/malysia-car-pro/databases/(default)/documents node outils/catalogue.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = readFileSync(join(RACINE, "firebase-config.js"), "utf8");
const projet = (config.match(/projectId:\s*"([^"]+)"/) || [])[1];
const cle = (config.match(/apiKey:\s*"([^"]+)"/) || [])[1];
const BASE = process.env.FIRESTORE_URL || `https://firestore.googleapis.com/v1/projects/${projet}/databases/(default)/documents`;
const DOSSIER_PHOTOS = "assets/modeles";

// ---- lecture Firestore (format typé → objets simples)

function valeur(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(valeur);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, valeur(x)]));
  return null;
}
const doc = (d) => ({ id: d.name.split("/").pop(), ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, valeur(v)])) });

async function lire(chemin) {
  const url = `${BASE}/${chemin}${chemin.includes("?") ? "&" : "?"}key=${cle}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore ${res.status} sur ${chemin} : ${await res.text()}`);
  return res.json();
}

// ---- rendu

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const prix = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const CLASSES = { "Berline": "c-berline", "SUV": "c-suv", "Luxe & sport": "c-luxe-sport", "Van": "c-van", "Utilitaire": "c-utilitaire" };
const nomDe = (m) => m.nom || [m.marque, m.modele].filter(Boolean).join(" ");

function caracteristiques(m) {
  return [
    m.places && `${m.places} places`,
    m.portes && `${m.portes} portes`,
    m.bagages && `${m.bagages} valise${m.bagages > 1 ? "s" : ""}`,
    m.carburant,
    m.boite,
  ].filter(Boolean);
}

function carte(m) {
  const nom = nomDe(m);
  const type = CLASSES[m.type] ? m.type : "Berline";
  const puce = (t) => `\n                <span style="font-size: 11.5px; letter-spacing: 0.05em; color: rgb(122, 102, 86); border: 1px solid rgba(138, 82, 54, 0.12); padding: 4px 9px;">${esc(t)}</span>\n              `;
  const image = m.photoSite
    ? `<img src="${esc(m.photoSite)}" width="1200" height="750" loading="lazy" decoding="async" alt="${esc(nom)} en location chez Malysia Car Pro au Maroc" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block">`
    : "";
  // crédit exigé par la licence des photos trouvées sur internet (Wikimedia Commons…)
  const credit = m.photoSite && m.photoCredit
    ? `\n            <small style="position: absolute; right: 8px; bottom: 6px; max-width: 80%; font-size: 9.5px; line-height: 1.3; text-align: right; color: rgba(255, 255, 255, 0.9); text-shadow: rgba(0, 0, 0, 0.7) 0px 1px 2px;">${m.photoSource ? `<a href="${esc(m.photoSource)}" rel="nofollow noopener" target="_blank" style="color: inherit;">${esc(m.photoCredit)}</a>` : esc(m.photoCredit)}</small>`
    : "";
  return `<article class="scp4 veh ${CLASSES[type]}" style="background: rgb(253, 250, 244); border: 1px solid rgba(138, 82, 54, 0.1); display: flex; flex-direction: column; transition: transform 0.25s, border-color 0.25s;">
          <div style="position: relative; aspect-ratio: 16 / 10; background: rgb(246, 240, 230);">
            ${image}
            <span style="position: absolute; top: 14px; left: 14px; pointer-events: none; background: rgba(251, 247, 240, 0.92); border: 1px solid rgba(138, 82, 54, 0.2); color: rgb(138, 82, 54); font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; padding: 5px 9px;">${esc(type)}</span>${credit}
          </div>
          <div style="padding: 22px; display: flex; flex-direction: column; gap: 14px; flex: 1 1 0%;">
            <div style="display: flex; gap: 14px; align-items: baseline; justify-content: space-between;">
              <h3 style="font-family: Cinzel, serif; font-weight: 400; font-size: 19px; letter-spacing: 0.1em; text-transform: uppercase; color: rgb(44, 33, 26); margin: 0px;">${esc(nom)}</h3>
              <span style="font-size: 12px; color: rgb(122, 102, 86); white-space: nowrap;">${esc(m.categorie || "")}</span>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 8px;">
              ${caracteristiques(m).map(puce).join("")}
            </div>
            <div style="margin-top: auto; padding-top: 16px; border-top: 1px solid rgba(138, 82, 54, 0.1); display: flex; gap: 14px; align-items: center; justify-content: space-between;">
              <span style="display: flex; align-items: baseline; gap: 5px;">
                <span style="font-family: Cinzel, serif; font-weight: 500; font-size: 25px; color: rgb(138, 82, 54);">${prix(m.prixJour)}</span>
                <span style="font-size: 12.5px; color: rgb(122, 102, 86);">MAD / jour</span>
              </span>
              <a href="#reservation" class="scp5" data-vehicule-id="${esc(m.id)}" data-vehicule-nom="${esc(nom)}" style="border: 1px solid rgb(122, 102, 86); color: rgb(138, 82, 54); padding: 10px 16px; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;">Réserver</a>
            </div>
          </div>
        </article>`;
}

// Menu « Véhicule souhaité » du formulaire de réservation : le client choisit
// un modèle précis, une marque ou une catégorie (le back-office attribue
// ensuite un véhicule précis, que le client ne voit jamais).
function choixVehicule(modeles) {
  const option = (valeur, libelle, extra = "") => `\n              <option value="${esc(valeur)}"${extra}>${esc(libelle)}</option>`;
  const des = (liste) => `dès ${prix(Math.min(...liste.map((m) => m.prixJour)))} MAD / jour`;
  const grouper = (cle) => {
    const groupes = new Map();
    for (const m of modeles) if (m[cle]) groupes.set(m[cle], [...(groupes.get(m[cle]) || []), m]);
    return groupes;
  };
  const marques = [...grouper("marque")].filter(([, l]) => l.length > 1).sort(([a], [b]) => a.localeCompare(b));
  const categories = [...grouper("type")].sort(([a], [b]) => Object.keys(CLASSES).indexOf(a) - Object.keys(CLASSES).indexOf(b));
  const ids = (l) => ` data-modeles="${esc(l.map((m) => m.id).join(" "))}"`;
  return `<label style="grid-column: 1 / -1; background: rgb(242, 234, 220); padding: 14px 16px; display: flex; flex-direction: column; gap: 8px;">
          <span style="font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: rgb(122, 102, 86);">Véhicule souhaité</span>
          <select name="vehicule" id="champ-vehicule" style="border: 0px; outline: 0px; background: transparent; font-size: 14.5px; color: rgb(44, 33, 26); font-family: inherit; width: 100%;">${option("", "Pas de préférence, conseillez-moi")}
            <optgroup label="Un modèle précis">${modeles.map((m) => option(m.id, `${nomDe(m)} · ${prix(m.prixJour)} MAD / jour`)).join("")}
            </optgroup>${marques.length ? `
            <optgroup label="Une marque, modèle au choix">${marques.map(([marque, l]) => option(`marque:${marque}`, `${marque}, ${l.map((m) => m.modele || nomDe(m)).join(" ou ")} · ${des(l)}`, ids(l))).join("")}
            </optgroup>` : ""}
            <optgroup label="Une catégorie, modèle au choix">${categories.map(([type, l]) => option(`cat:${type}`, `${type} · ${des(l)}`, ids(l))).join("")}
            </optgroup>
          </select>
        </label>`;
}

function offre(m) {
  const description = m.description || `${m.categorie || m.type} ${caracteristiques(m).join(", ").toLowerCase()}.`;
  return {
    "@type": "Offer",
    itemOffered: { "@type": "Car", name: nomDe(m), description, vehicleConfiguration: m.type || "Berline",
      ...(m.photoSite ? { image: m.photoCredit
        ? { "@type": "ImageObject", url: `https://malysiacar.ma/${m.photoSite}`, creditText: m.photoCredit, ...(m.photoSource ? { acquireLicensePage: m.photoSource } : {}) }
        : `https://malysiacar.ma/${m.photoSite}` } : {}) },
    priceSpecification: { "@type": "UnitPriceSpecification", price: Math.round(Number(m.prixJour) || 0), priceCurrency: "MAD", unitCode: "DAY",
      referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "DAY" } },
    availability: "https://schema.org/InStock",
  };
}

// ---- programme

let liste;
try {
  liste = await lire("modeles?pageSize=300");
} catch (e) {
  // 403 : règles de sécurité pas encore publiées dans la console Firebase.
  // On ne fait pas échouer la tâche (GitHub enverrait un e-mail toutes les 15 minutes).
  if (/Firestore 403/.test(e.message)) {
    console.log("Lecture des modèles refusée (règles Firebase pas encore publiées) : le site n'est pas modifié.");
    process.exit(0);
  }
  throw e;
}
const modeles = ((liste && liste.documents) || []).map(doc)
  .filter((m) => m.visible !== false && m.prixJour > 0 && /^[a-z0-9-]+$/.test(m.id))
  .sort((a, b) => (a.ordre ?? 999) - (b.ordre ?? 999) || nomDe(a).localeCompare(nomDe(b)));
if (!modeles.length) {
  console.log("Aucun modèle publié dans le back-office : le site n'est pas modifié.");
  process.exit(0);
}

// photos : celle envoyée depuis le back-office, sinon la photo d'origine du site
mkdirSync(join(RACINE, DOSSIER_PHOTOS), { recursive: true });
const photosUtilisees = new Set();
for (const m of modeles) {
  if (m.photoMaj) {
    const media = await lire(`modeles/${m.id}/medias/photo`);
    const image = media && doc(media).image;
    const decoupe = typeof image === "string" && image.match(/^data:image\/(webp|jpeg|png);base64,(.+)$/);
    if (decoupe) {
      const octets = Buffer.from(decoupe[2], "base64");
      const nom = `${m.id}-${createHash("sha1").update(octets).digest("hex").slice(0, 8)}.${decoupe[1] === "jpeg" ? "jpg" : decoupe[1]}`;
      writeFileSync(join(RACINE, DOSSIER_PHOTOS, nom), octets);
      photosUtilisees.add(nom);
      m.photoSite = `${DOSSIER_PHOTOS}/${nom}`;
      continue;
    }
  }
  if (existsSync(join(RACINE, "assets", `${m.id}.webp`))) m.photoSite = `assets/${m.id}.webp`;
}
for (const f of readdirSync(join(RACINE, DOSSIER_PHOTOS))) {
  if (!photosUtilisees.has(f)) unlinkSync(join(RACINE, DOSSIER_PHOTOS, f)); // photo remplacée ou modèle supprimé
}

const minimum = Math.min(...modeles.map((m) => Math.round(m.prixJour)));
const maximum = Math.max(...modeles.map((m) => Math.round(m.prixJour)));

// index.html : cartes, JSON-LD, prix « à partir de »
let html = readFileSync(join(RACINE, "index.html"), "utf8");
const bloc = /(<!-- catalogue:debut[^>]*-->\n\s*)[\s\S]*?(\n\s*<!-- catalogue:fin -->)/;
if (!bloc.test(html)) throw new Error("repères catalogue:debut / catalogue:fin introuvables dans index.html");
html = html.replace(bloc, (_, debut, fin) => debut + modeles.map(carte).join("\n      \n        ") + fin);
const repereChoix = /(<!-- choix-vehicule:debut[^>]*-->\n\s*)[\s\S]*?(\n?\s*<!-- choix-vehicule:fin -->)/;
if (!repereChoix.test(html)) throw new Error("repères choix-vehicule:debut / choix-vehicule:fin introuvables dans index.html");
html = html.replace(repereChoix, (_, debut, fin) => debut + choixVehicule(modeles) + fin);
html = html.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/, (_, a, json, b) => {
  const donnees = JSON.parse(json);
  const entreprise = donnees["@graph"].find((x) => x["@type"] === "AutoRental");
  entreprise.makesOffer = modeles.map(offre);
  entreprise.priceRange = `${minimum}–${maximum} MAD / jour`;
  return a + JSON.stringify(donnees).replace(/</g, "\\u003c") + b;
});
html = html.replace(/à partir de \d[\d  ]* MAD par jour/g, `à partir de ${minimum} MAD par jour`);
writeFileSync(join(RACINE, "index.html"), html);

// llms.txt : la liste des modèles et des prix
const llmsChemin = join(RACINE, "llms.txt");
let llms = readFileSync(llmsChemin, "utf8");
const lignes = modeles.map((m) => `- ${nomDe(m).replace("³", "3")} — ${[m.type && m.type.toLowerCase().replace("suv", "SUV"), m.categorie && "gamme " + m.categorie.toLowerCase(), ...caracteristiques(m).map((c) => c.toLowerCase())].filter(Boolean).join(", ")} — ${Math.round(m.prixJour)}`);
llms = llms.replace(/(## Flotte et tarifs[^\n]*\n)(?:- [^\n]*\n)+/, (_, titre) => titre + lignes.join("\n") + "\n");
llms = llms.replace(/à partir de \d[\d  ]* MAD par jour/g, `à partir de ${minimum} MAD par jour`);
writeFileSync(llmsChemin, llms);

console.log(`${modeles.length} modèles publiés (${minimum} à ${maximum} MAD / jour).`);
