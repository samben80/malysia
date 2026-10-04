// Créneaux de départ et de retour proposés au client : Matin ou Après-midi.
//
// Une réservation garde ses dates au format "AAAA-MM-JJTHH:MM" : le créneau
// est enregistré comme une heure repère (Matin = 09:00, Après-midi = 14:00),
// ce qui laisse intacts le calcul des jours, les chevauchements et le tri.
// Les anciennes réservations saisies à l'heure près s'affichent toujours avec leur heure.

export const CRENEAUX = [
  { libelle: "Matin", heure: "09:00", fin: "13:00" },
  { libelle: "Après-midi", heure: "14:00", fin: "19:00" },
];

// "2026-10-12" + "Après-midi" → "2026-10-12T14:00"
export function dateCreneau(jour, libelle) {
  if (!jour) return "";
  const c = CRENEAUX.find((x) => x.libelle === libelle) || CRENEAUX[0];
  return `${jour}T${c.heure}`;
}

// "Matin", "Après-midi", l'heure d'une ancienne réservation ("10:30"), ou "" sans heure.
export function libelleCreneau(v) {
  const h = String(v || "").slice(11, 16);
  if (!/^\d\d:\d\d$/.test(h)) return "";
  const c = CRENEAUX.find((x) => x.heure === h);
  return c ? c.libelle : h;
}

// Heure limite d'un retour : fin du créneau (13:00 pour le matin, 19:00 l'après-midi),
// ou l'heure exacte pour une ancienne réservation.
export function finCreneau(v) {
  const s = String(v || "").slice(0, 16);
  const c = CRENEAUX.find((x) => x.heure === s.slice(11, 16));
  return c ? s.slice(0, 11) + c.fin : s;
}
