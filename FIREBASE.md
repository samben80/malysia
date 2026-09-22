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

**Firestore Database** > onglet **Rules**, remplacer le contenu par
exactement ceci, puis **Publier** :

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Demandes envoyées depuis le site public : tout le monde peut en
    // créer une (le formulaire de réservation), personne ne peut la lire
    // ni la modifier sans être connecté — les coordonnées des clients ne
    // sont donc jamais publiques.
    match /reservations/{id} {
      allow create: if true;
      allow read, update, delete: if request.auth != null;
    }

    // Messages du formulaire de contact : même logique.
    match /messages/{id} {
      allow create: if true;
      allow read, update, delete: if request.auth != null;
    }

    // Disponibilité des véhicules : lecture publique (c'est ce qui permet
    // au site d'afficher "disponible" / "déjà réservé"), mais seule
    // l'équipe connectée peut la modifier — cela n'arrive qu'au moment où
    // elle confirme une réservation dans le back-office.
    match /disponibilite/{vehiculeId} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

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
- `backoffice/` (à venir dans un prochain envoi) : connexion, liste des
  demandes, fiche détaillée, action de confirmation qui bloque les dates
  choisies pour ce véhicule.
