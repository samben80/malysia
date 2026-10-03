# Firebase — mise en service

Ce site et le back-office partagent un seul projet Firebase : **`malysia-car-pro`**.
Aucun serveur à faire tourner : le site (statique) et le back-office (statique aussi)
parlent directement à Firestore et à Firebase Auth depuis le navigateur, par de
simples requêtes HTTPS (pas le SDK officiel — voir `assets/firestore-rest.js`
pour pourquoi).

## Ce qui reste à activer dans la console Firebase

Ces trois étapes se font une seule fois, dans [console.firebase.google.com](https://console.firebase.google.com),
projet `malysia-car-pro`. Rien de tout cela n'est fait automatiquement par du
code : ce sont des actions de compte, seul le propriétaire du projet peut les
faire.

### 1. Créer la base Firestore

**Firestore Database** (menu de gauche) > **Créer une base de données**.
Mode **production**. Région conseillée : `eur3 (europe-west)`, la plus proche
du Maroc parmi les régions proposées.

### 2. Activer la connexion par e-mail / mot de passe

**Authentication** > **Get started** > onglet **Sign-in method** >
**E-mail/Mot de passe** > activer.

### 3. Créer le premier compte du back-office

**Authentication** > **Users** > **Add user**. C'est l'identifiant que vous
utiliserez pour vous connecter sur `backoffice/`. Vous pourrez en ajouter
d'autres plus tard, un par personne de l'équipe.

### 4. Poser les règles de sécurité

**Firestore Database** > onglet **Règles**, remplacer tout le contenu par
celui du fichier `firestore.rules` du dépôt (recopié ci-dessous), puis **Publier**.
À refaire à chaque modification de ce fichier.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ---- Qui fait partie de l'équipe, et avec quels droits
    //
    // Chaque membre de l'équipe a une fiche utilisateurs/{e-mail} créée
    // depuis l'écran Utilisateurs du back-office : actif ou non,
    // administrateur ou non, et ses droits module par module :
    //   droits.reservations = { acces, creer, modifier, supprimer }, etc.
    // Un compte Firebase sans fiche (l'inscription est possible avec la seule
    // clé publique du site) n'a accès à rien.
    //
    // Le propriétaire est écrit ici en dur : il garde tous les droits quoi
    // qu'il arrive aux fiches, et ne peut pas être bloqué par erreur.

    function proprietaire() {
      return request.auth != null && request.auth.token.email == "bs@bgp.ma";
    }
    function fiche() {
      return get(/databases/$(database)/documents/utilisateurs/$(request.auth.token.email)).data;
    }
    function equipe() {
      return proprietaire()
        || (request.auth != null
            && request.auth.token.email is string
            && exists(/databases/$(database)/documents/utilisateurs/$(request.auth.token.email))
            && fiche().get("actif", false) == true);
    }
    function admin() {
      return proprietaire() || (equipe() && fiche().get("admin", false) == true);
    }
    // peut("flotte", "creer") : droit d'un module (acces, creer, modifier, supprimer).
    function peut(module, action) {
      return admin() || (equipe() && fiche().get("droits", {}).get(module, {}).get(action, false) == true);
    }

    // Comptes du back-office : chacun lit sa propre fiche (pour connaître ses
    // droits), seuls les administrateurs voient et modifient la liste.
    match /utilisateurs/{email} {
      allow get: if admin() || (request.auth != null && request.auth.token.email == email);
      allow list, create, update, delete: if admin();
    }

    // Demandes du site public : tout le monde peut en créer une. L'équipe
    // les lit ; les faire avancer demande le droit « modifier » (ou de noter
    // un paiement, ou de lier une facture) ; les annuler ou les supprimer
    // demande le droit « supprimer ».
    function annule() {
      return request.resource.data.get("statut", "") == "Annulée" && resource.data.get("statut", "") != "Annulée";
    }
    match /reservations/{id} {
      allow create: if true;
      allow read: if equipe();
      allow update: if annule()
        ? peut("reservations", "supprimer")
        : (peut("reservations", "modifier") || peut("paiements", "modifier")
           || peut("facturation", "creer") || peut("facturation", "supprimer"));
      allow delete: if peut("reservations", "supprimer");
    }

    // Messages du formulaire de contact : même logique.
    match /messages/{id} {
      allow create: if true;
      allow read: if equipe();
      allow update: if peut("reservations", "modifier");
      allow delete: if peut("reservations", "supprimer");
    }

    // Disponibilité publique des modèles : lecture publique, recalculée par
    // le back-office après chaque changement de réservation ou de véhicule.
    match /disponibilite/{vehiculeId} {
      allow read: if true;
      allow write: if equipe();
    }

    // Dossiers clients. L'équipe crée le dossier et envoie son lien par
    // WhatsApp ; l'identifiant du dossier, long et aléatoire, sert de clé.
    // Le client peut lire le résumé de SON dossier (jamais la liste), y
    // déposer ses informations et ses photos une seule fois, puis le
    // marquer "Reçu". Informations et photos (pièces d'identité) ne sont
    // lisibles que par qui a accès aux réservations ou aux clients.
    match /dossiers/{jeton} {
      function enAttente() {
        return get(/databases/$(database)/documents/dossiers/$(jeton)).data.statut == "En attente";
      }
      function voitPieces() {
        return peut("reservations", "acces") || peut("clients", "acces");
      }

      allow get: if true;
      allow list: if equipe();
      allow create: if peut("reservations", "modifier");
      allow delete: if peut("reservations", "supprimer");
      allow update: if peut("reservations", "modifier")
        || (resource.data.statut == "En attente"
            && request.resource.data.statut == "Reçu"
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(["statut", "recuLe"]));

      match /prive/{doc} {
        allow create: if doc == "fiche" && enAttente();
        allow read: if voitPieces();
        allow update: if peut("reservations", "modifier");
        allow delete: if peut("reservations", "supprimer");
      }

      match /pieces/{nom} {
        allow create: if nom in ["permis_recto", "permis_verso", "identite_recto", "identite_verso"]
          && enAttente()
          && request.resource.data.image is string
          && request.resource.data.image.size() < 1000000;
        allow read: if voitPieces();
        allow update: if peut("reservations", "modifier");
        allow delete: if peut("reservations", "supprimer");
      }
    }

    // Modèles (marques, caractéristiques, prix, photos) : publics, car ils
    // alimentent le site ; gérés depuis Flotte > Modèles.
    match /modeles/{id} {
      allow read: if true;
      allow create: if peut("flotte", "creer");
      allow update: if peut("flotte", "modifier");
      allow delete: if peut("flotte", "supprimer");
      match /medias/{media} {
        allow read: if true;
        allow create, update: if (peut("flotte", "creer") || peut("flotte", "modifier"))
          && request.resource.data.image is string && request.resource.data.image.size() < 1000000;
        allow delete: if peut("flotte", "supprimer") || peut("flotte", "modifier");
      }
    }

    // Gestion interne. Toute l'équipe lit ces données (le tableau de bord et
    // les statistiques s'en servent) ; les écritures suivent les droits.
    // Un véhicule change aussi d'état quand on le remet au client, qu'il
    // revient ou qu'il part en réparation : ces écrans peuvent le modifier.
    match /vehicules/{id} {
      allow read: if equipe();
      allow create: if peut("flotte", "creer");
      allow update: if peut("flotte", "modifier") || peut("reservations", "modifier")
        || peut("maintenance", "creer") || peut("maintenance", "modifier");
      allow delete: if peut("flotte", "supprimer");
    }
    match /maintenance/{id} {
      allow read: if equipe();
      allow create: if peut("maintenance", "creer");
      allow update: if peut("maintenance", "modifier");
      allow delete: if peut("maintenance", "supprimer");
    }
    // Fiches clients : aussi complétées depuis une réservation (dossier reçu).
    match /clients/{id} {
      allow read: if equipe();
      allow create: if peut("clients", "creer") || peut("reservations", "modifier");
      allow update: if peut("clients", "modifier") || peut("reservations", "modifier");
      allow delete: if peut("clients", "supprimer");
    }

    // Factures : numérotation continue, une facture émise ne se supprime
    // jamais (elle s'annule et garde son numéro). L'annuler demande le
    // droit « supprimer » de la facturation.
    match /factures/{numero} {
      allow read: if equipe();
      allow create: if peut("facturation", "creer");
      allow update: if annule()
        ? peut("facturation", "supprimer")
        : (peut("facturation", "modifier") || peut("paiements", "modifier"));
      allow delete: if false;
    }

    // Contrats : établis par l'équipe, consultables par le client via le
    // lien (identifiant long et aléatoire) envoyé par WhatsApp. Jamais listables.
    match /contrats/{jeton} {
      allow get: if true;
      allow list: if equipe();
      allow create, update: if peut("reservations", "modifier");
      allow delete: if peut("reservations", "supprimer");
    }
  }
}
```

Ces règles ont été vérifiées sur l'émulateur Firestore local (droits par
module, compte désactivé, compte sans fiche, visiteur anonyme, tentative d'un
employé de se donner les droits d'administrateur).

### Comptes et droits de l'équipe

Chaque personne de l'équipe a une fiche `utilisateurs/{e-mail}`, gérée depuis
l'écran **Utilisateurs** du back-office (réservé aux administrateurs) : actif
ou non, administrateur ou non, et pour chaque module (tableau de bord,
réservations, flotte et modèles, maintenance, clients, paiements, facturation,
statistiques) les droits accès / créer / modifier / supprimer-annuler. Les
règles relisent cette fiche à chaque requête : un changement de droits
s'applique tout de suite. Un compte Firebase sans fiche n'a accès à rien
(n'importe qui peut créer un compte avec la clé publique du site).

Le propriétaire (`bs@bgp.ma`) est inscrit en dur dans `proprietaire()` : il a
toujours tous les droits et ne peut pas être bloqué depuis le back-office.

Limites, faute de serveur (l'API d'administration de Firebase exige un
serveur, donc le forfait payant) :
- on ne peut pas choisir le mot de passe d'un autre compte : l'écran envoie un
  lien de réinitialisation par e-mail, chacun change le sien avec le bouton
  « Mot de passe » du menu, et l'écran de connexion a « Mot de passe oublié ? » ;
- « Supprimer » un utilisateur retire sa fiche, donc tout accès, mais son
  compte de connexion reste dans **Authentication > Users** (à effacer à la
  main si on le souhaite) ;
- « Accès » masque un module ; les données de gestion (réservations, flotte,
  clients, factures) restent lisibles par tout compte actif de l'équipe, car le
  tableau de bord et les statistiques les croisent. Les pièces d'identité des
  dossiers ne sont lisibles qu'avec l'accès aux réservations ou aux clients.

## Une fois ces 4 étapes faites

Rien d'autre à faire côté Firebase : le site et `backoffice/` sont déjà
câblés dessus (`firebase-config.js` contient déjà les identifiants du
projet). Dites-le-moi et je fais un essai réel — créer une fausse demande
depuis le site, la voir apparaître dans le back-office, la confirmer — avant
de considérer que c'est en service.

## Ce que ces identifiants ne sont pas

`firebase-config.js`, déjà dans le dépôt, n'est **pas un secret** : Firebase
est conçu pour que ce bloc soit visible dans le code d'un site public. Ce qui
protège vraiment les données, ce sont les règles ci-dessus. Le seul élément
réellement sensible serait une **clé de compte de service** (fichier JSON
"service account") — on n'en a pas besoin ici, et il ne faut jamais en
publier une dans ce dépôt s'il en apparaît une plus tard pour un usage futur.

## Ce que fait déjà le site avec ça

- Le moteur de réservation écrit une demande dans `reservations`, avec le
  statut `À confirmer` — exactement les statuts déjà prévus dans la maquette
  du back-office (`design_handoff_malysia_car_pro/`).
- Le formulaire de contact écrit dans `messages`.
- Un indicateur de disponibilité (lecture de `disponibilite/{vehicule}`)
  s'affiche sous les dates dès qu'un véhicule est choisi — indicatif, jamais
  bloquant : la confirmation reste toujours humaine.
- `backoffice/` : connexion, liste des demandes, fiche détaillée,
  confirmation, message WhatsApp au client, demande du dossier client,
  attribution d'un véhicule précis (immatriculation), remise et retour du
  véhicule avec le kilométrage, annulation.
- Flotte (`vehicules`) : chaque véhicule avec son immatriculation, son modèle
  (celui affiché sur le site), son kilométrage, ses échéances (assurance,
  visite technique, vignette) et son statut : Disponible, En circulation,
  En réparation (avec date de retour prévue) ou Hors service.
- Disponibilité sur le site (`disponibilite/{modèle}`) : recalculée à chaque
  confirmation, annulation, retour ou changement de statut d'un véhicule. Un
  modèle n'apparaît complet que lorsque tous ses véhicules sont pris.
- Modèles (`modeles/{id}`, photo dans `modeles/{id}/medias/photo`) : marque,
  modèle, type, gamme, boîte, carburant, places, prix, photo. Lecture publique.
  La section « Notre flotte » de `index.html`, le JSON-LD et `llms.txt` sont
  régénérés à partir de ces fiches par `outils/catalogue.mjs`, programmé
  toutes les 15 minutes par `.github/workflows/catalogue.yml` : le site reste
  du HTML statique lisible sans JavaScript. GitHub retarde souvent ces tâches
  programmées (constaté : une exécution toutes les 3 à 9 heures) ; le
  back-office affiche « Publication en attente » tant qu'un modèle visible
  n'est pas dans la page en ligne. Pour publier tout de suite : GitHub >
  Actions > « Catalogue du site » > « Run workflow ».
  Le menu « Véhicule souhaité » du formulaire de réservation est généré au
  même endroit : un modèle précis, une marque (`marque:Bentley`) ou une
  catégorie (`cat:SUV`). Pour une marque, une catégorie ou « pas de
  préférence », l'équipe attribue un véhicule avant de confirmer ; son modèle
  devient celui de la réservation (demande d'origine gardée dans
  `vehiculeDemande` / `vehiculeNomDemande`).
  Une photo trouvée sur internet doit porter son crédit (`photoCredit`,
  `photoSource`), affiché sur la carte du site et dans le JSON-LD.
- Démonstration (Flotte > « Démonstration », `backoffice/demo.js`) : crée
  50 véhicules fictifs et leur historique d'entretien (`source: "demo"`,
  supprimables d'un clic), plus les modèles Bentley Continental GTC,
  Bentayga, Flying Spur et Rolls-Royce Cullinan, masqués du site, avec une
  photo sous licence libre lue sur Wikimedia Commons par le navigateur.
- Tableau de bord (écran d'accueil du back-office, `backoffice/tableau.js`) :
  départs et retours du jour, demandes à confirmer, confirmées à livrer
  (dont celles bloquées faute de paiement), contrats en cours et retours en
  retard, contrats non réglés, répartition de la flotte par statut, véhicules
  indisponibles, documents administratifs (assurance, visite technique,
  vignette, autorisation de circulation) qui expirent sous 30 jours, vidanges
  et pneus à prévoir. Chaque chiffre ouvre la liste déjà filtrée
  (`#reservations/statut/À livrer`, `#flotte/filtre/En réparation`,
  `#paiements/filtre/dus`…). Rien de nouveau dans la base, pas de changement
  des règles.
- Statistiques (`backoffice/statistiques.js`) : contrats par statut
  opérationnel (en attente, en préparation, livrée, retournée, annulée) et
  financier (payé, partiellement payé, non payé, en compte, échéance
  dépassée), filtres par période de départ, client, véhicule, modèle,
  regroupement par client, véhicule, modèle, mois ou statut, export CSV pour
  Excel et impression. Accessible aussi depuis les fiches client et véhicule
  (`#statistiques/client/<clé>`, `#statistiques/vehicule/<id>`). Calculé à
  partir des données déjà chargées, sans nouvelle collection.
- Maintenance (`maintenance`) : vidanges, pneus, réparations, avec coût,
  kilométrage et immobilisation. Alertes de vidange (tous les 10 000 km par
  défaut), de pneus (40 000 km), d'échéances à 30 jours.
- Clients (`clients/{téléphone}`) : fiche créée automatiquement depuis le
  dossier à la génération du contrat, historique des locations et factures,
  liste noire.
- Paiements (`reservations/{id}.paiements`, `prixTotal`, `supplements`) : le
  montant dû est celui du contrat, plus les suppléments saisis au retour
  (kilomètres, retard, frais). Une location en cours ou terminée non soldée
  est due (écran « Paiements »). Les clés ne se remettent qu'une fois la
  location réglée, sauf pour un client en compte (`clients/{tél}.enCompte`,
  `plafondEncours`, `delaiPaiement`). Un paiement saisi sur la réservation ou
  sur sa facture est noté des deux côtés.
- Facturation (`factures/F-AAAA-NNNN`) : numérotation continue, TVA 20 %,
  paiements partiels, impression PDF. Une facture ne se supprime pas, elle
  s'annule.
- `dossier.html?d=…` : formulaire envoyé au client par WhatsApp (identité,
  adresse, permis, photos des documents). Données rangées dans
  `dossiers/{jeton}` (résumé), `dossiers/{jeton}/prive/fiche` (informations)
  et `dossiers/{jeton}/pieces/{nom}` (photos réduites, moins de 1 Mo chacune),
  lisibles seulement par l'équipe connectée.
- `contrat.html?c=…` : contrat de location généré depuis le back-office à
  partir de la réservation et du dossier (`contrats/{jeton}`), consultable et
  imprimable en PDF par le client. Textes, frais et infos société :
  `assets/contrat-modele.js`.
