// Branche les deux formulaires du site (moteur de réservation + contact)
// sur Firestore, et affiche un indicateur de disponibilité indicatif sur
// le véhicule choisi.
//
// Se désactive proprement si aucune configuration Firebase n'est posée
// (firebase-config.js absent ou non rempli) : les formulaires continuent
// alors leur comportement d'origine sans erreur visible.
import {
  creerDocument,
  lireDocument,
  estConfigure,
} from "./firestore-rest.js";

const formReservation = document.querySelector('form[name="reservation"]');
const formContact = document.querySelector('form[name="contact"]');
const champVehicule = document.getElementById("champ-vehicule");
const infoVehicule = document.getElementById("vehicule-choisi-info");
const infoDispo = document.getElementById("dispo-info");

// ---- sélection d'un véhicule depuis une fiche de la flotte
// Le menu « Véhicule souhaité » propose un modèle, une marque ou une
// catégorie. Le bouton « Réserver » d'une fiche le règle sur ce modèle.

document.querySelectorAll("[data-vehicule-id]").forEach((lien) => {
  lien.addEventListener("click", () => {
    if (!champVehicule) return;
    champVehicule.value = lien.dataset.vehiculeId;
    if (champVehicule.value !== lien.dataset.vehiculeId && infoVehicule) {
      // modèle absent du menu (page ancienne en cache) : on l'indique à part
      infoVehicule.hidden = false;
      infoVehicule.textContent = `Véhicule choisi : ${lien.dataset.vehiculeNom}`;
    }
    verifierDisponibilite();
  });
});
if (champVehicule) champVehicule.addEventListener("change", () => {
  if (infoVehicule) infoVehicule.hidden = true;
  verifierDisponibilite();
});

// ---- disponibilité indicative (l'équipe vérifie toujours par téléphone)

function optionChoisie() {
  return champVehicule && champVehicule.options ? champVehicule.options[champVehicule.selectedIndex] : null;
}

async function verifierDisponibilite() {
  if (!infoDispo || !champVehicule || !estConfigure()) return;
  const depart = formReservation.elements["depart"].value;
  const retour = formReservation.elements["retour"].value;
  if (!champVehicule.value || !depart || !retour) {
    infoDispo.hidden = true;
    return;
  }
  // une marque ou une catégorie : disponible si l'un de ses modèles l'est
  const option = optionChoisie();
  const groupe = option && option.dataset.modeles ? option.dataset.modeles.split(" ") : null;
  try {
    const libres = await Promise.all((groupe || [champVehicule.value]).map(async (id) => {
      const doc = await lireDocument("disponibilite", id);
      return !((doc && doc.occupations) || []).some((o) => depart < o.fin && retour > o.debut);
    }));
    const libre = libres.some(Boolean);
    infoDispo.hidden = false;
    infoDispo.textContent = groupe
      ? (libre ? "Au moins un véhicule de ce choix est disponible sur ces dates, sous réserve de confirmation."
        : "Tous les véhicules de ce choix sont déjà réservés sur une partie de ces dates. Envoyez votre demande, nous vous proposons une alternative si besoin.")
      : (libre ? "Ce véhicule est disponible sur ces dates, sous réserve de confirmation."
        : "Ce véhicule est déjà réservé sur une partie de ces dates. Envoyez votre demande, nous vous proposons une alternative si besoin.");
  } catch {
    infoDispo.hidden = true; // en cas de souci réseau, on n'affiche rien plutôt qu'une fausse alerte
  }
}

if (formReservation) {
  ["depart", "retour"].forEach((nom) => {
    const el = formReservation.elements[nom];
    if (el) el.addEventListener("change", verifierDisponibilite);
  });
}

// ---- anti-spam partagé : le champ "societe" doit rester vide (piège à robots)

function estSpam(form) {
  const piege = form.elements["societe"];
  return !!(piege && piege.value);
}

function vehiculeChoisi() {
  const id = champVehicule && champVehicule.value;
  if (!id) return { id: "", nom: "" };
  const lien = document.querySelector(`[data-vehicule-id="${CSS.escape(id)}"]`);
  const option = optionChoisie();
  const nom = (lien && lien.dataset.vehiculeNom) || (option && option.textContent.split(" · ")[0].trim()) || id;
  return { id, nom: id.startsWith("cat:") ? `${nom}, modèle au choix` : nom };
}

// ---- envoi du moteur de réservation

if (formReservation) {
  formReservation.addEventListener("submit", async (ev) => {
    if (!estConfigure() || estSpam(formReservation)) return; // repli : soumission d'origine
    ev.preventDefault();
    const f = formReservation.elements;
    const { id: vehiculeId, nom: vehiculeNom } = vehiculeChoisi();
    const bouton = formReservation.querySelector('button[type="submit"]');
    const libelleInitial = bouton.textContent;
    bouton.textContent = "Envoi en cours…";
    bouton.disabled = true;
    try {
      await creerDocument("reservations", {
        vehicule: vehiculeId,
        vehiculeNom,
        // les radios "mode" sont hors du <form> (chips au-dessus de la carte) : lues à part
        formule: document.querySelector('input[name="mode"]:checked').value,
        lieuPriseEnCharge: f["lieu_prise_en_charge"].value,
        depart: f["depart"].value,
        lieuRestitution: f["lieu_restitution"].value,
        retour: f["retour"].value,
        telephone: f["telephone"].value,
        statut: "À confirmer",
        source: "site",
        creeLe: new Date(),
      });
      window.location.href = "merci.html";
    } catch (e) {
      bouton.textContent = libelleInitial;
      bouton.disabled = false;
      alert(
        "L'envoi n'a pas abouti. Vous pouvez nous appeler directement, le numéro est en haut de la page."
      );
    }
  });
}

// ---- envoi du formulaire de contact

if (formContact) {
  formContact.addEventListener("submit", async (ev) => {
    if (!estConfigure() || estSpam(formContact)) return;
    ev.preventDefault();
    const f = formContact.elements;
    const bouton = formContact.querySelector('button[type="submit"]');
    const libelleInitial = bouton.textContent;
    bouton.textContent = "Envoi en cours…";
    bouton.disabled = true;
    try {
      await creerDocument("messages", {
        nom: f["nom"].value,
        telephone: f["telephone"].value,
        email: f["email"].value,
        message: f["message"].value,
        statut: "Nouveau",
        creeLe: new Date(),
      });
      window.location.href = "merci.html";
    } catch (e) {
      bouton.textContent = libelleInitial;
      bouton.disabled = false;
      alert(
        "L'envoi n'a pas abouti. Vous pouvez nous écrire directement, l'adresse est en bas de la page."
      );
    }
  });
}
