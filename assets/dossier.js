// Formulaire "dossier client" ouvert depuis le lien WhatsApp envoyé par l'agence.
// Le jeton dans l'URL désigne le dossier ; les données saisies et les photos ne
// sont lisibles ensuite que par l'équipe connectée (voir les règles dans FIREBASE.md).
import { creerDocument, lireDocument, corrigerDocument, estConfigure } from "./firestore-rest.js";

const PIECES = ["permis_recto", "permis_verso", "identite_recto", "identite_verso"];
// Un document Firestore est limité à 1 Mo : chaque photo est réduite sous ce plafond.
const TAILLE_MAX = 700_000;

const jeton = new URLSearchParams(location.search).get("d") || "";
const form = document.getElementById("form-dossier");
const erreur = document.getElementById("erreur");
const photos = new Map();

function afficher(id) {
  for (const el of ["chargement", "introuvable", "deja-recu", "form-dossier"]) {
    document.getElementById(el).hidden = el !== id;
  }
}

function formateDate(v) {
  if (!v) return "";
  const [d, h] = String(v).split("T");
  const [an, mois, jour] = d.split("-");
  return `${jour}/${mois}/${an}${h ? " à " + h : ""}`;
}

async function demarrer() {
  if (!estConfigure() || !/^[A-Za-z0-9]{20,64}$/.test(jeton)) return afficher("introuvable");
  let dossier;
  try {
    dossier = await lireDocument("dossiers", jeton);
  } catch {
    return afficher("introuvable");
  }
  if (!dossier) return afficher("introuvable");
  if (dossier.statut !== "En attente") return afficher("deja-recu");

  const resume = document.getElementById("resume-resa");
  resume.innerHTML = "";
  const titre = document.createElement("b");
  titre.textContent = dossier.vehiculeNom || "Votre réservation";
  resume.append(titre);
  if (dossier.depart && dossier.retour) {
    resume.append(`Du ${formateDate(dossier.depart)} au ${formateDate(dossier.retour)}`);
  }
  if (dossier.telephone) form.elements["telephone"].value = dossier.telephone;
  afficher("form-dossier");
}

// ---- photos : réduites dans le navigateur avant envoi

function chargerImage(fichier) {
  return new Promise((ok, ko) => {
    const url = URL.createObjectURL(fichier);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); ko(new Error("image illisible")); };
    img.src = url;
  });
}

async function reduire(fichier) {
  const img = await chargerImage(fichier);
  for (const cote of [1600, 1200, 900]) {
    const echelle = Math.min(1, cote / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * echelle);
    canvas.height = Math.round(img.naturalHeight * echelle);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const qualite of [0.82, 0.7, 0.55]) {
      const data = canvas.toDataURL("image/jpeg", qualite);
      if (data.length < TAILLE_MAX) return data;
    }
  }
  throw new Error("image trop lourde");
}

form.querySelectorAll('input[type="file"]').forEach((input) => {
  input.addEventListener("change", async () => {
    const bloc = input.closest(".photo");
    const apercu = bloc.querySelector("img");
    const note = bloc.querySelector("small");
    photos.delete(input.dataset.piece);
    apercu.classList.remove("ok");
    const fichier = input.files[0];
    if (!fichier) return;
    note.textContent = "Préparation de la photo…";
    try {
      const data = await reduire(fichier);
      photos.set(input.dataset.piece, data);
      apercu.src = data;
      apercu.classList.add("ok");
      note.textContent = "Photo prête";
    } catch {
      input.value = "";
      note.textContent = "Cette photo n'a pas pu être lue. Réessayez avec une autre photo.";
    }
  });
});

// ---- envoi

async function creerSiAbsent(collection, donnees, id) {
  try {
    await creerDocument(collection, donnees, { id });
  } catch (e) {
    if (e.status !== 409) throw e; // 409 : déjà envoyé lors d'une tentative précédente
  }
}

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  erreur.textContent = "";
  if (!form.reportValidity()) return;

  const f = form.elements;
  const passeport = f["typePiece"].value === "Passeport";
  const manquantes = PIECES.filter((p) => !photos.has(p) && !(p === "identite_verso" && passeport));
  if (manquantes.length) {
    erreur.textContent = "Il manque une ou plusieurs photos de documents.";
    return;
  }

  const bouton = form.querySelector('button[type="submit"]');
  bouton.disabled = true;
  bouton.textContent = "Envoi en cours…";
  try {
    for (const [piece, image] of photos) {
      await creerSiAbsent(`dossiers/${jeton}/pieces`, { image, envoyeLe: new Date() }, piece);
    }
    const champs = ["nom", "prenom", "dateNaissance", "lieuNaissance", "nationalite", "telephone", "email",
      "adresse", "ville", "pays", "typePiece", "numeroPiece", "expirationPiece",
      "numeroPermis", "delivrancePermis", "paysPermis"];
    const fiche = Object.fromEntries(champs.map((c) => [c, f[c].value.trim()]));
    fiche.consentement = true;
    fiche.envoyeLe = new Date();
    await creerSiAbsent(`dossiers/${jeton}/prive`, fiche, "fiche");
    await corrigerDocument("dossiers", jeton, { statut: "Reçu", recuLe: new Date() });
    afficher("deja-recu");
    window.scrollTo(0, 0);
  } catch {
    bouton.disabled = false;
    bouton.textContent = "Envoyer mon dossier";
    erreur.textContent = "L'envoi n'a pas abouti. Vérifiez votre connexion et réessayez, ou appelez-nous au +212 661 99 79 88.";
  }
});

demarrer();
