// Contenu du contrat de location Malysia Car Pro : informations société,
// frais, tarifs de la flotte et conditions générales. Tout ce qui se règle
// sans toucher au code est ici. Chaque contrat généré garde une copie de ces
// textes au moment de sa création : les modifier n'altère pas les contrats
// déjà envoyés.

export const SOCIETE = {
  nom: "Malysia Car Pro",
  groupe: "Groupe Yassmine",
  adresse: "Casablanca, Maroc",
  telephone: "+212 661 99 79 88",
  email: "contact@malysiacar.ma",
  site: "malysiacar.ma",
  // Mentions légales obligatoires sur les documents commerciaux au Maroc.
  rc: "",
  ice: "",
  identifiantFiscal: "",
  patente: "",
};

export const FRAIS = {
  kmInclusParJour: 250,
  carburantFraisService: 150,
  nettoyageExceptionnel: 300,
  annulationMoinsDe24h: 30, // % du montant de la location
  toleranceRetardHeures: 1,
};

// Même flotte et mêmes tarifs que la page d'accueil (index.html).
export const TARIFS = {
  "veh-dacia-logan": { nom: "Dacia Logan", categorie: "Économique", prixJour: 290, carburant: "Diesel", kmSup: 2 },
  "veh-golf-8": { nom: "Volkswagen Golf 8", categorie: "Compacte", prixJour: 480, carburant: "Diesel", kmSup: 2 },
  "veh-hyundai-tucson": { nom: "Hyundai Tucson", categorie: "Familial", prixJour: 750, carburant: "Hybride", kmSup: 3 },
  "veh-mercedes-classe-e": { nom: "Mercedes Classe E", categorie: "Affaires", prixJour: 1450, carburant: "Diesel", kmSup: 3 },
  "veh-mercedes-classe-v": { nom: "Mercedes Classe V", categorie: "Groupe", prixJour: 1900, carburant: "Diesel", kmSup: 3 },
  "veh-renault-master": { nom: "Renault Master 12 m³", categorie: "Transport", prixJour: 550, carburant: "Diesel", kmSup: 3 },
  "veh-range-rover-sport": { nom: "Range Rover Sport", categorie: "Premium", prixJour: 2200, carburant: "Essence", kmSup: 5 },
  "veh-porsche-911": { nom: "Porsche 911 Carrera", categorie: "Exception", prixJour: 5900, carburant: "Essence", kmSup: 10 },
};

export function conditionsGenerales(kmSup) {
  const f = FRAIS;
  return [
    ["Conducteurs",
      "Le conducteur doit avoir au moins 21 ans et être titulaire d'un permis de conduire valide depuis au moins 2 ans. Seuls les conducteurs mentionnés au contrat sont autorisés à conduire le véhicule et bénéficient de l'assurance. Tout conducteur supplémentaire doit être déclaré et accepté par le loueur avant le départ. Le prêt et la sous-location du véhicule sont strictement interdits."],
    ["Documents",
      "Le locataire présente à la livraison l'original de son permis de conduire et de sa pièce d'identité (CIN, passeport ou carte de séjour), dont les copies ont été transmises lors de la réservation."],
    ["Livraison et motifs de refus",
      "Le véhicule est livré à l'heure et au lieu indiqués au contrat (aéroport, hôtel, adresse). Le locataire ne peut refuser le véhicule que s'il ne réunit pas les conditions de sécurité (pneumatiques, direction, freinage, éclairage). Un refus pour des raisons esthétiques est traité comme une annulation de dernière minute."],
    ["État des lieux",
      "Un état des lieux contradictoire, avec photos horodatées, est réalisé au départ et au retour. Les dommages visibles au départ sont reportés sur le schéma du contrat. Tout dommage constaté au retour et absent de l'état des lieux de départ est à la charge du locataire, dans la limite de la franchise."],
    ["Caution",
      "Une caution dont le montant figure au contrat, fonction de la catégorie du véhicule, est pré-autorisée sur carte bancaire (ou versée en espèces) à la livraison. Elle n'est jamais débitée sans dommage ou frais constaté, et elle est levée ou restituée après restitution du véhicule conforme au contrat. Le locataire autorise le loueur à prélever sur la caution toute somme due au titre du présent contrat."],
    ["Assurance et franchise",
      "Le prix de la location comprend l'assurance obligatoire et l'assistance au Maroc. En cas de dommage, de vol ou d'incendie, une franchise égale au maximum au montant de la caution reste à la charge du locataire. L'assurance ne couvre pas, et le locataire supporte l'intégralité des dommages causés : par un conducteur non déclaré, sous l'emprise de l'alcool ou de stupéfiants, lors d'une sous-location, hors des voies carrossables, ou par négligence (clés laissées dans le véhicule, véhicule non verrouillé)."],
    ["Kilométrage",
      `${f.kmInclusParJour} km par jour de location sont inclus. Chaque kilomètre supplémentaire est facturé ${kmSup} MAD pour ce véhicule.`],
    ["Carburant",
      `Le véhicule doit être restitué avec le même niveau de carburant qu'au départ. À défaut, le carburant manquant est facturé au prix à la pompe, majoré de ${f.carburantFraisService} MAD de frais de service. Une erreur de carburant et ses conséquences sont à la charge du locataire.`],
    ["Propreté",
      `Le véhicule est livré propre et doit être restitué dans un état de propreté normal. Un nettoyage exceptionnel (sable, taches, odeur de tabac, poils d'animaux) est facturé ${f.nettoyageExceptionnel} MAD. Il est interdit de fumer dans le véhicule.`],
    ["Horaires, retard et prolongation",
      `Un retard de ${f.toleranceRetardHeures} h est toléré de part et d'autre. Au-delà, chaque période de 24 h entamée est facturée au tarif journalier du contrat. Toute prolongation doit être demandée au moins 24 h à l'avance et acceptée par le loueur. Chaque jour de non-restitution non autorisée est facturé au double du tarif journalier, sans préjudice des poursuites prévues par la loi.`],
    ["Annulation",
      `L'annulation est gratuite jusqu'à 24 h avant l'heure de départ. En deçà, ${f.annulationMoinsDe24h} % du montant de la location sont retenus. Si le locataire restitue le véhicule avant la date prévue, les jours non utilisés ne sont pas remboursés.`],
    ["Panne et accident",
      "Le locataire prévient le loueur sans délai au +212 661 99 79 88. En cas d'accident, il établit un constat amiable ou fait constater les faits par la police ou la gendarmerie, et ne reconnaît aucune responsabilité sans l'accord du loueur. En cas de panne non imputable au locataire, le loueur fournit un véhicule de remplacement selon ses disponibilités. Une panne due à une faute du locataire (choc, erreur de carburant, négligence) est à sa charge."],
    ["Territoire",
      "Le véhicule ne peut pas quitter le territoire marocain, sauf accord écrit préalable du loueur."],
    ["Infractions",
      "Le locataire est seul responsable des infractions commises pendant la location (amendes, contraventions, fourrière, péages). Les sommes réclamées au loueur lui sont refacturées."],
    ["Perte des clés ou des papiers",
      "La perte ou le vol des clés ou des papiers du véhicule est facturé au coût réel de leur remplacement, ainsi que l'immobilisation du véhicule qui en résulte."],
    ["Location avec chauffeur",
      "Pour une location avec chauffeur, les frais d'hébergement et de restauration du chauffeur lors des déplacements hors de la ville de départ sont à la charge du client."],
    ["Données personnelles",
      "Les informations et copies de documents du locataire sont conservées par le loueur pour établir et exécuter le contrat, conformément à la loi 09-08. Le locataire peut y accéder, les rectifier ou s'opposer à leur traitement en écrivant à contact@malysiacar.ma."],
    ["Litiges",
      "Le présent contrat est soumis au droit marocain. À défaut d'accord amiable, tout litige relève des tribunaux compétents de Casablanca. Le locataire déclare avoir pris connaissance des présentes conditions et les accepter."],
  ];
}
