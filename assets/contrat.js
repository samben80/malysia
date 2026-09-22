// Affiche un contrat généré depuis le back-office (collection "contrats").
// Le lien, envoyé au client par WhatsApp, porte l'identifiant aléatoire du contrat.
import { lireDocument, estConfigure } from "./firestore-rest.js";

const jeton = new URLSearchParams(location.search).get("c") || "";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function date(v, avecHeure = true) {
  if (!v) return "";
  const [d, h] = String(v).split("T");
  const [an, mois, jour] = d.split("-");
  return `${jour}/${mois}/${an}${avecHeure && h ? " à " + h.slice(0, 5) : ""}`;
}

const mad = (n) => (n || n === 0) && n !== "" ? `${Number(n).toLocaleString("fr-FR")} MAD` : "";

function ligne(libelle, valeur) {
  return valeur ? `<dt>${esc(libelle)}</dt><dd>${esc(valeur)}</dd>` : "";
}

function voiture(ox, oy) {
  return `<path d="M${ox + 5},${oy + 45} L${ox + 5},${oy + 32} Q${ox + 8},${oy + 25} ${ox + 32},${oy + 22} L${ox + 58},${oy + 8} Q${ox + 63},${oy + 5} ${ox + 72},${oy + 5} L${ox + 122},${oy + 5} Q${ox + 132},${oy + 5} ${ox + 141},${oy + 12} L${ox + 160},${oy + 24} Q${ox + 186},${oy + 27} ${ox + 188},${oy + 35} L${ox + 188},${oy + 45} Z"/>
    <path d="M${ox + 62},${oy + 11} L${ox + 96},${oy + 11} L${ox + 96},${oy + 22} L${ox + 44},${oy + 22} Z M${ox + 102},${oy + 11} L${ox + 128},${oy + 11} Q${ox + 134},${oy + 12} ${ox + 150},${oy + 22} L${ox + 102},${oy + 22} Z"/>
    <circle cx="${ox + 45}" cy="${oy + 46}" r="11" fill="#fff"/><circle cx="${ox + 150}" cy="${oy + 46}" r="11" fill="#fff"/>`;
}

function schema() {
  return `<svg viewBox="0 0 400 200" fill="none" stroke="#2C211A" stroke-width="1.3" aria-hidden="true">
    ${voiture(4, 12)}
    <g transform="translate(400,0) scale(-1,1)">${voiture(4, 12)}</g>
    <g><rect x="12" y="118" width="74" height="42" rx="8"/><path d="M24,118 L32,96 L66,96 L74,118"/><rect x="18" y="160" width="12" height="12" rx="2"/><rect x="68" y="160" width="12" height="12" rx="2"/><rect x="20" y="130" width="12" height="7" rx="2"/><rect x="66" y="130" width="12" height="7" rx="2"/></g>
    <g><rect x="106" y="118" width="74" height="42" rx="8"/><path d="M118,118 L126,98 L160,98 L168,118"/><rect x="112" y="160" width="12" height="12" rx="2"/><rect x="162" y="160" width="12" height="12" rx="2"/><rect x="128" y="138" width="30" height="9" rx="1"/></g>
    <g><rect x="206" y="104" width="186" height="72" rx="24"/><path d="M262,108 Q256,140 262,172 M322,108 Q330,140 322,172 M262,108 L322,108 M262,172 L322,172"/><rect x="228" y="96" width="24" height="9" rx="3"/><rect x="340" y="96" width="24" height="9" rx="3"/><rect x="228" y="175" width="24" height="9" rx="3"/><rect x="340" y="175" width="24" height="9" rx="3"/></g>
    <g font-family="sans-serif" font-size="9" fill="#6F5B4B" stroke="none"><text x="60" y="84">Côté gauche</text><text x="300" y="84">Côté droit</text><text x="36" y="190">Avant</text><text x="130" y="190">Arrière</text><text x="284" y="198">Dessus</text></g>
  </svg>`;
}

function entete(c, titre) {
  const s = c.societe || {};
  return `<div class="entete">
      <img src="assets/logo-full.webp" alt="${esc(s.nom)}">
      <div><h1>${esc(titre)}</h1></div>
      <div class="numero">Contrat n°<b>${esc(c.numero)}</b>du ${esc(date(c.creeLe, false))}</div>
    </div>
    <p class="coord">${esc([s.nom, s.groupe, s.adresse, s.telephone, s.email, s.site].filter(Boolean).join(" · "))}</p>`;
}

function rendre(c) {
  const l = c.locataire || {}, s = c.societe || {}, v = c.vehicule || {}, loc = c.location || {};
  const piece = l.numeroPiece ? `${l.numeroPiece}${l.expirationPiece ? " (exp. " + date(l.expirationPiece) + ")" : ""}` : "";
  const permis = l.numeroPermis ? `${l.numeroPermis}${l.delivrancePermis ? ", délivré le " + date(l.delivrancePermis) : ""}${l.paysPermis ? " (" + l.paysPermis + ")" : ""}` : "";
  const legales = [s.rc && `RC ${s.rc}`, s.ice && `ICE ${s.ice}`, s.identifiantFiscal && `IF ${s.identifiantFiscal}`, s.patente && `Patente ${s.patente}`].filter(Boolean).join(" · ");

  const page1 = `<section class="page">
    ${entete(c, "Contrat de location")}
    <div class="duo">
      <section><h2>Le locataire</h2><dl>
        ${ligne("Nom et prénom", [l.nom, l.prenom].filter(Boolean).join(" "))}
        ${ligne("Né(e) le", [date(l.dateNaissance), l.lieuNaissance].filter(Boolean).join(" à "))}
        ${ligne("Nationalité", l.nationalite)}
        ${ligne("Adresse", [l.adresse, l.ville, l.pays].filter(Boolean).join(", "))}
        ${ligne("Téléphone", l.telephone)}
        ${ligne("E-mail", l.email)}
        ${ligne(l.typePiece || "Pièce d'identité", piece)}
        ${ligne("Permis n°", permis)}
      </dl></section>
      <section><h2>Le loueur</h2><dl>
        ${ligne("Société", [s.nom, s.groupe].filter(Boolean).join(" — "))}
        ${ligne("Adresse", s.adresse)}
        ${ligne("Identifiants", legales)}
        ${ligne("Téléphone", s.telephone)}
        ${ligne("E-mail", s.email)}
        ${ligne("Agent", c.agent)}
      </dl></section>
    </div>
    <div class="duo">
      <section><h2>Le véhicule</h2><dl>
        ${ligne("Marque / modèle", v.nom)}
        ${ligne("Catégorie", v.categorie)}
        ${ligne("Immatriculation", v.immatriculation)}
        ${ligne("Carburant", v.carburant)}
        ${ligne("Kilométrage inclus", loc.kmInclus ? `${loc.kmInclus} km / jour` : "")}
      </dl></section>
      <section><h2>La location</h2><dl>
        ${ligne("Formule", loc.formule)}
        ${ligne("Début", [date(loc.depart), loc.lieuDepart].filter(Boolean).join(", "))}
        ${ligne("Fin", [date(loc.retour), loc.lieuRetour].filter(Boolean).join(", "))}
        ${ligne("Durée", loc.jours ? `${loc.jours} jour${loc.jours > 1 ? "s" : ""}` : "")}
        ${ligne("Prix total TTC", mad(loc.prixTotal))}
        ${ligne("Caution", mad(loc.caution))}
        ${ligne("Paiement", loc.paiement)}
        ${ligne("Options", loc.options)}
      </dl></section>
    </div>
    <div class="etat">
      <div class="schema"><p>État des lieux de départ : indiquer sur ce schéma les dommages visibles</p>${schema()}</div>
      <div class="mesures">
        <div>Kilométrage au départ${c.kmDepart ? ` : <b>${esc(Number(c.kmDepart).toLocaleString("fr-FR"))} km</b>` : '<div class="ligne-vide"></div>'}</div>
        <div>Carburant au départ<div class="jauge"><span><i></i>0</span><span><i></i>¼</span><span><i></i>½</span><span><i></i>¾</span><span><i></i>Plein</span></div></div>
        <div>Remarques :</div>
      </div>
    </div>
    <p class="attestation">Je soussigné(e) atteste avoir reçu le véhicule dans l'état indiqué ci-dessus et en prendre la responsabilité pendant toute la durée de la location. Je m'engage à le restituer dans son état initial, à l'heure et au lieu indiqués au présent contrat, à défaut de quoi les frais prévus aux conditions générales me seront facturés. J'autorise ${esc(s.nom)} à prélever sur ma caution toute somme due au titre de ce contrat. Je déclare avoir pris connaissance des conditions générales jointes et les accepter.</p>
    <div class="signatures"><div>Signature de l'agent</div><div>Signature du locataire<br><small>précédée de « lu et approuvé »</small></div></div>
  </section>`;

  const kmSup = loc.kmSup ? `${loc.kmSup} MAD` : "…… MAD";
  const page2 = `<section class="page fin">
    ${entete(c, "Fin de location")}
    <table>
      <tr><td>Date et heure de restitution</td><td class="montant"></td></tr>
      <tr><td>Lieu de restitution</td><td class="montant"></td></tr>
      <tr><td>Kilométrage au retour</td><td class="montant">km</td></tr>
      <tr><td>Carburant au retour : <span class="jauge" style="display:inline-flex"><span><i></i>0</span><span><i></i>¼</span><span><i></i>½</span><span><i></i>¾</span><span><i></i>Plein</span></span></td><td class="montant"></td></tr>
      <tr><td>Kilomètres supplémentaires : ……… km × ${esc(kmSup)}</td><td class="montant">MAD</td></tr>
      <tr><td>Carburant manquant (prix à la pompe + frais de service)</td><td class="montant">MAD</td></tr>
      <tr><td>Nettoyage exceptionnel</td><td class="montant">MAD</td></tr>
      <tr><td>Retard (au-delà de la tolérance, par période de 24 h entamée)</td><td class="montant">MAD</td></tr>
      <tr><td>Dommages constatés (dans la limite de la franchise) :<div class="ligne-vide"></div><div class="ligne-vide"></div></td><td class="montant">MAD</td></tr>
      <tr><td><b>Total retenu sur la caution</b></td><td class="montant"><b>MAD</b></td></tr>
    </table>
    <p class="attestation">Remarques :</p><div class="ligne-vide"></div><div class="ligne-vide"></div>
    <p class="attestation" style="margin-top:10px">Les parties reconnaissent l'exactitude du présent compte rendu de fin de location.</p>
    <div class="signatures"><div>Signature de l'agent</div><div>Signature du locataire</div></div>
  </section>`;

  const conditions = (c.conditions || []).map((x) => `<h3>${esc(x.titre)}</h3><p>${esc(x.texte)}</p>`).join("");
  const page3 = `<section class="page">
    ${entete(c, "Conditions générales")}
    <div class="conditions">${conditions}</div>
    <p class="pied">${esc([s.nom, s.groupe, legales].filter(Boolean).join(" · "))}</p>
  </section>`;

  return page1 + page2 + page3;
}

async function demarrer() {
  const afficher = (id) => ["chargement", "introuvable", "contrat"].forEach((x) => { document.getElementById(x).hidden = x !== id; });
  if (!estConfigure() || !/^[A-Za-z0-9]{20,64}$/.test(jeton)) return afficher("introuvable");
  let c;
  try { c = await lireDocument("contrats", jeton); } catch { c = null; }
  if (!c) return afficher("introuvable");
  document.getElementById("contrat").innerHTML = rendre(c);
  document.title = `Contrat ${c.numero} — Malysia Car Pro`;
  document.getElementById("barre-titre").textContent = `Contrat n° ${c.numero}`;
  document.getElementById("barre").hidden = false;
  document.getElementById("imprimer").addEventListener("click", () => window.print());
  afficher("contrat");
}

demarrer();
