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

    // Demandes du site public : tout le monde peut en créer une, seule
    // l'équipe connectée peut les lire ou les modifier.
    match /reservations/{id} {
      allow create: if true;
      allow read, update, delete: if request.auth != null;
    }

    // Messages du formulaire de contact : même logique.
    match /messages/{id} {
      allow create: if true;
      allow read, update, delete: if request.auth != null;
    }

    // Disponibilité des véhicules : lecture publique, écriture par l'équipe.
    match /disponibilite/{vehiculeId} {
      allow read: if true;
      allow write: if request.auth != null;
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
      allow list, create, delete: if request.auth != null;
      allow update: if request.auth != null
        || (resource.data.statut == "En attente"
            && request.resource.data.statut == "Reçu"
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(["statut", "recuLe"]));

      match /prive/{doc} {
        allow create: if doc == "fiche" && enAttente();
        allow read, update, delete: if request.auth != null;
      }

      match /pieces/{nom} {
        allow create: if nom in ["permis_recto", "permis_verso", "identite_recto", "identite_verso"]
          && enAttente()
          && request.resource.data.image is string
          && request.resource.data.image.size() < 1000000;
        allow read, update, delete: if request.auth != null;
      }
    }

    // Contrats : établis par l'équipe, consultables par le client via le
    // lien (identifiant long et aléatoire) envoyé par WhatsApp. Jamais listables.
    match /contrats/{jeton} {
      allow get: if true;
      allow list, create, update, delete: if request.auth != null;
    }
  }
}
```

Ces règles ont été vérifiées sur l'émulateur Firestore local (28 cas : ce qu'un
visiteur anonyme peut et ne peut pas faire, ce que l'équipe connectée peut faire).

Ces règles sont volontairement simples : n'importe quel compte connecté a
accès à tout le back-office. Suffisant pour une petite équipe. Le jour où il
faudra distinguer les rôles (ex. un agent qui ne voit pas la facturation),
on affinera ces règles à ce moment-là, pas avant.

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
- `backoffice/` : connexion, liste des demandes, fiche détaillée, action de
  confirmation qui bloque les dates choisies pour ce véhicule, message
  WhatsApp au client, demande du dossier client.
- `dossier.html?d=…` : formulaire envoyé au client par WhatsApp (identité,
  adresse, permis, photos des documents). Données rangées dans
  `dossiers/{jeton}` (résumé), `dossiers/{jeton}/prive/fiche` (informations)
  et `dossiers/{jeton}/pieces/{nom}` (photos réduites, moins de 1 Mo chacune),
  lisibles seulement par l'équipe connectée.
- `contrat.html?c=…` : contrat de location généré depuis le back-office à
  partir de la réservation et du dossier (`contrats/{jeton}`), consultable et
  imprimable en PDF par le client. Textes, frais et infos société :
  `assets/contrat-modele.js`.
