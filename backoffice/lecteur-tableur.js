// Lecture d'un fichier Excel (.xlsx) ou CSV directement dans le navigateur,
// sans bibliothèque externe : un .xlsx est une archive zip de fichiers XML,
// que l'on décompresse avec DecompressionStream et lit avec DOMParser.
// Renvoie un tableau de lignes, chaque ligne étant un tableau de cellules
// (texte ou nombre), la première ligne contenant les en-têtes.

export async function lireTableur(fichier, { feuillePreferee = "", colonneRepere = "" } = {}) {
  const octets = new Uint8Array(await fichier.arrayBuffer());
  const estZip = octets[0] === 0x50 && octets[1] === 0x4b;
  if (!estZip) return lireCSV(new TextDecoder("utf-8").decode(octets).replace(/^﻿/, ""));
  return lireXLSX(octets, feuillePreferee, colonneRepere);
}

// ---- zip

async function lireZip(octets) {
  const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  let fin = -1;
  for (let i = octets.length - 22; i >= Math.max(0, octets.length - 65557); i--) {
    if (vue.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error("fichier Excel illisible (archive incomplète).");
  const nombre = vue.getUint16(fin + 10, true);
  let pos = vue.getUint32(fin + 16, true);
  const fichiers = new Map();
  const texte = new TextDecoder("utf-8");
  for (let n = 0; n < nombre; n++) {
    if (vue.getUint32(pos, true) !== 0x02014b50) throw new Error("fichier Excel illisible (répertoire).");
    const methode = vue.getUint16(pos + 10, true);
    const tailleCompressee = vue.getUint32(pos + 20, true);
    const longueurNom = vue.getUint16(pos + 28, true);
    const longueurExtra = vue.getUint16(pos + 30, true);
    const longueurCommentaire = vue.getUint16(pos + 32, true);
    const decalage = vue.getUint32(pos + 42, true);
    const nom = texte.decode(octets.subarray(pos + 46, pos + 46 + longueurNom));
    fichiers.set(nom, { methode, tailleCompressee, decalage });
    pos += 46 + longueurNom + longueurExtra + longueurCommentaire;
  }
  return async (nom) => {
    const f = fichiers.get(nom);
    if (!f) return null;
    const debut = f.decalage + 30 + vue.getUint16(f.decalage + 26, true) + vue.getUint16(f.decalage + 28, true);
    const donnees = octets.subarray(debut, debut + f.tailleCompressee);
    if (f.methode === 0) return texte.decode(donnees);
    if (f.methode !== 8) throw new Error("compression non prise en charge.");
    const flux = new Blob([donnees]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return await new Response(flux).text();
  };
}

// ---- xlsx

const xml = (s) => new DOMParser().parseFromString(s, "application/xml");
const enfants = (el, nom) => Array.from(el.getElementsByTagNameNS("*", nom));

function colonneIndex(ref) {
  const lettres = String(ref).replace(/[0-9]/g, "");
  let n = 0;
  for (const c of lettres) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

async function lireXLSX(octets, feuillePreferee, colonneRepere) {
  const lire = await lireZip(octets);
  const classeur = await lire("xl/workbook.xml");
  if (!classeur) throw new Error("ce fichier n'est pas un classeur Excel.");
  const liens = xml(await lire("xl/_rels/workbook.xml.rels") || "<Relationships/>");
  const cibles = new Map(enfants(liens, "Relationship").map((r) => [r.getAttribute("Id"), r.getAttribute("Target")]));
  const feuilles = enfants(xml(classeur), "sheet").map((s) => {
    const id = s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    let cible = cibles.get(id) || "";
    cible = cible.startsWith("/") ? cible.slice(1) : "xl/" + cible.replace(/^\.\//, "");
    return { nom: s.getAttribute("name"), chemin: cible };
  });
  const partages = [];
  const ss = await lire("xl/sharedStrings.xml");
  if (ss) for (const si of enfants(xml(ss), "si")) partages.push(enfants(si, "t").map((t) => t.textContent).join(""));

  const lireFeuille = async (f) => {
    const doc = xml(await lire(f.chemin) || "<worksheet/>");
    const lignes = [];
    for (const row of enfants(doc, "row")) {
      const r = Number(row.getAttribute("r")) - 1;
      const cellules = [];
      for (const c of enfants(row, "c")) {
        const type = c.getAttribute("t");
        const v = enfants(c, "v")[0];
        let valeur = "";
        if (type === "s") valeur = partages[Number(v && v.textContent)] ?? "";
        else if (type === "inlineStr") valeur = enfants(c, "t").map((t) => t.textContent).join("");
        else if (type === "str" || type === "e") valeur = v ? v.textContent : "";
        else if (type === "b") valeur = v ? v.textContent === "1" : "";
        else if (v) valeur = Number(v.textContent);
        cellules[colonneIndex(c.getAttribute("r"))] = valeur;
      }
      lignes[r] = Array.from(cellules, (x) => (x === undefined ? "" : x));
    }
    return Array.from(lignes, (x) => x || []);
  };

  // la feuille voulue par son nom, sinon la première dont l'en-tête contient la colonne repère
  const normaliser = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const choisie = feuilles.find((f) => normaliser(f.nom) === normaliser(feuillePreferee));
  if (choisie) return lireFeuille(choisie);
  for (const f of feuilles) {
    const lignes = await lireFeuille(f);
    if (!colonneRepere || (lignes[0] || []).some((x) => normaliser(x).includes(normaliser(colonneRepere)))) return lignes;
  }
  throw new Error(`aucune feuille ne contient de colonne « ${colonneRepere} ».`);
}

// ---- csv (séparateur ; ou , détecté sur la ligne d'en-tête)

function lireCSV(texte) {
  const premiere = texte.split(/\r?\n/)[0] || "";
  const sep = (premiere.match(/;/g) || []).length >= (premiere.match(/,/g) || []).length ? ";" : ",";
  const lignes = [];
  let ligne = [], champ = "", guillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (guillemets) {
      if (c === '"' && texte[i + 1] === '"') { champ += '"'; i++; }
      else if (c === '"') guillemets = false;
      else champ += c;
    } else if (c === '"') guillemets = true;
    else if (c === sep) { ligne.push(champ); champ = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texte[i + 1] === "\n") i++;
      ligne.push(champ); lignes.push(ligne); ligne = []; champ = "";
    } else champ += c;
  }
  if (champ || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  return lignes;
}

// Date Excel (numéro de série) ou texte jj/mm/aaaa, aaaa-mm-jj → « aaaa-mm-jj ». null si illisible.
export function versDateISO(v) {
  if (v === "" || v == null) return "";
  if (typeof v === "number") {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    const an = m[3].length === 2 ? "20" + m[3] : m[3];
    const d = new Date(Date.UTC(Number(an), Number(m[2]) - 1, Number(m[1])));
    if (d.getUTCDate() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1) return null; // 31/02, 13/05…
    return d.toISOString().slice(0, 10);
  }
  return null;
}
