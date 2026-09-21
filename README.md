# malysiacar.ma — site Malysia Car Pro

Site vitrine de **Malysia Car Pro** (Groupe Yassmine), location de véhicules
avec et sans chauffeur au Maroc.

## Ce que c'est

Un site statique, en HTML réel. Aucun JavaScript, aucun serveur applicatif,
aucune base de données. Tout le contenu est dans `index.html` et s'affiche
même si le navigateur n'exécute rien — c'est ce qui le rend lisible par
Google et par les assistants IA.

## Contenu

| Chemin | Rôle |
| --- | --- |
| `index.html` | Le site complet, page unique |
| `merci.html` | Confirmation après envoi d'un formulaire |
| `404.html` | Page d'erreur |
| `assets/` | Photos des véhicules et logos, en WebP |
| `fonts/` | Polices auto-hébergées (Cinzel, Plus Jakarta Sans, IBM Plex Mono) |
| `robots.txt` | Autorise les moteurs de recherche et les robots des IA |
| `sitemap.xml` | Plan du site |
| `llms.txt` | Fiche de synthèse destinée aux assistants IA |
| `_headers` | Cache et en-têtes de sécurité (lu par Netlify) |
| `.nojekyll` | Désactive Jekyll sur GitHub Pages |

## Mise en ligne

Le site se déploie tel quel, sans étape de construction.

- **GitHub Pages** : Settings > Pages > Source « Deploy from a branch »,
  branche `main`, dossier `/ (root)`.
- **Netlify** : « Import an existing project », ce dépôt, aucune commande
  de build, dossier à publier `.` — les deux formulaires s'activent alors
  automatiquement (Netlify Forms).

## Points d'attention

- Les formulaires sont câblés pour **Netlify Forms**. Sur GitHub Pages ils
  ne reçoivent rien : les visiteurs passent par le téléphone et l'e-mail,
  affichés et cliquables sur la page.
- Pour brancher le domaine `malysiacar.ma`, ne recopier que les
  enregistrements A / CNAME. **Laisser les MX et le TXT SPF intacts**,
  sinon `contact@malysiacar.ma` cesse de recevoir du courrier.
- Tarifs de la flotte et pages légales du pied de page : à valider et à
  rédiger avant une communication large.
