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

    // Comptes de l'équipe autorisés à ouvrir le back-office. Un compte
    // Firebase créé par quelqu'un d'autre (l'inscription est possible avec la
    // seule clé publique du site) n'a accès à rien. Pour ajouter un
    // collaborateur : créer son compte, puis ajouter son e-mail ici.
    function equipe() {
      return request.auth != null
        && request.auth.token.email in ["bs@bgp.ma"];
    }

    // Demandes du site public : tout le monde peut en créer une, seule
    // l'équipe connectée peut les lire ou les modifier.
    match /reservations/{id} {
      allow create: if true;
      allow read, update, delete: if equipe();
    }

    // Messages du formulaire de contact : même logique.
    match /messages/{id} {
      allow create: if true;
      allow read, update, delete: if equipe();
    }

    // Disponibilité des véhicules : lecture publique, écriture par l'équipe.
    match /disponibilite/{vehiculeId} {
      allow read: if true;
      allow write: if equipe();
    }

    // Dossiers clients. L'équipe crée le dossier et envoie son lien par
    // WhatsApp ; l'identifiant du dossier, long et aléatoire, sert de clé.
    // Le client peut lire le résumé de SON dossier (jamais la liste), y
    // déposer ses informations et ses photos une seule fois, puis le
    // marquer "Reçu". Informations et photos ne sont lisibles que par l'équipe.
    match /dossiers/{jeton} {
      function enAttente() {
        return get(/databases/$(database)/documents/dossiers/$(jeton)).data.statut == "En attente";
      }

      allow get: if true;
      allow list, create, delete: if equipe();
      allow update: if equipe()
        || (resource.data.statut == "En attente"
            && request.resource.data.statut == "Reçu"
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(["statut", "recuLe"]));

      match /prive/{doc} {
        allow create: if doc == "fiche" && enAttente();
        allow read, update, delete: if equipe();
      }

      match /pieces/{nom} {
        allow create: if nom in ["permis_recto", "permis_verso", "identite_recto", "identite_verso"]
          && enAttente()
          && request.resource.data.image is string
          && request.resource.data.image.size() < 1000000;
        allow read, update, delete: if equipe();
      }
    }

    // Modèles (marques, caractéristiques, prix, photos) : publics, car ils
    // alimentent le site ; seule l'équipe les modifie.
    match /modeles/{id} {
      allow read: if true;
      allow write: if equipe();
      match /medias/{media} {
        allow read: if true;
        allow write: if equipe()
          && (request.resource == null || (request.resource.data.image is string && request.resource.data.image.size() < 1000000));
      }
    }

    // Gestion interne : flotte (véhicules et immatriculations), maintenance,
    // fiches clients. Réservé à l'équipe.
    match /vehicules/{id} {
      allow read, write: if equipe();
    }
    match /maintenance/{id} {
      allow read, write: if equipe();
    }
    match /clients/{id} {
      allow read, write: if equipe();
    }

    // Factures : numérotation continue, une facture émise ne se supprime
    // jamais (elle s'annule et garde son numéro).
    match /factures/{numero} {
      allow read, create, update: if equipe();
      allow delete: if false;
    }

    // Contrats : établis par l'équipe, consultables par le client via le
    // lien (identifiant long et aléatoire) envoyé par WhatsApp. Jamais listables.
    match /contrats/{jeton} {
      allow get: if true;
      allow list, create, update, delete: if equipe();
    }
  }
}
```

Ces règles ont été vérifiées sur l'émulateur Firestore local (61 cas : ce qu'un
visiteur anonyme peut et ne peut pas faire, ce qu'un compte inconnu ne peut pas
faire, ce que l'équipe peut faire).

Seuls les comptes dont l'e-mail figure dans `equipe()` ont accès au
back-office : n'importe qui peut créer un compte Firebase avec la clé publique
du site, donc « être connecté » ne suffit pas. Pour ajouter un collaborateur,
créer son compte puis ajouter son e-mail à la liste et republier les règles.

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
  régénérés à partir de ces fiches par `outils/catalogue.mjs`, lancé toutes
  les 15 minutes par `.github/workflows/catalogue.yml` : le site reste du HTML
  statique lisible sans JavaScript.
  Une photo trouvée sur internet doit porter son crédit (`photoCredit`,
  `photoSource`), affiché sur la carte du site et dans le JSON-LD.
- Démonstration (Flotte > « Démonstration », `backoffice/demo.js`) : crée
  50 véhicules fictifs et leur historique d'entretien (`source: "demo"`,
  supprimables d'un clic), plus les modèles Bentley Continental GTC,
  Bentayga, Flying Spur et Rolls-Royce Cullinan, masqués du site, avec une
  photo sous licence libre lue sur Wikimedia Commons par le navigateur.
- Maintenance (`maintenance`) : vidanges, pneus, réparations, avec coût,
  kilométrage et immobilisation. Alertes de vidange (tous les 10 000 km par
  défaut), de pneus (40 000 km), d'échéances à 30 jours.
- Clients (`clients/{téléphone}`) : fiche créée automatiquement depuis le
  dossier à la génération du contrat, historique des locations et factures,
  liste noire.
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
