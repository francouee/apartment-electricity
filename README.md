# Plan électrique

Application Astro + React + D3 pour relier les prises du tableau au plan de l'appartement.

## Démarrer

```sh
npm install
npm run dev
```

Ouvrir l'adresse affichée par Astro. Les 32 entrées de `src/data/prises.csv` viennent
de l'export fourni. Aucun emplacement n'est inventé : les colonnes X et Y sont vides.

Glisser la poignée à gauche d'une ligne vers le plan pour placer une prise. Les points
déjà placés peuvent être déplacés directement par glisser-déposer, à la souris ou au
toucher. Le zoom et le déplacement du fond restent indépendants de celui des points.
Sur un écran étroit, maintenir le geste près du bord supérieur ou inférieur fait
défiler la page pour rejoindre le plan.
Le placement est enregistré localement seulement au relâchement ; un dépôt hors du
plan, un geste interrompu ou **Échap** annule le déplacement et conserve l'ancienne
position. Le glisser-déposer ne déclenche aucune écriture Notion.

On peut aussi sélectionner une ligne, puis **Placer sur le plan** et cliquer à
l'emplacement voulu. Activer la poignée au clavier ouvre ce mode de placement.
Les champs X/Y permettent aussi un placement au clavier. Les coordonnées vont de
0 à 100 %, depuis le coin supérieur gauche de l'image complète de 2000 × 2000 pixels,
indépendamment du cadrage et du zoom. Le fond original se trouve dans `public/plan.jpeg`.

Les déplacements sont sauvegardés dans le navigateur (localStorage). Aucune écriture
Notion n'a lieu sans clic sur **Enregistrer dans Notion** et confirmation.
**Exporter les positions** télécharge toutes les entrées, même celles masquées par
les filtres. Pour les conserver avec la version CSV, remplacer `src/data/prises.csv`
par cet export. Une sauvegarde locale bloque les nouvelles coordonnées de la source
pour la même entrée ; effacer la clé `tonduti:positions:v1` dans le stockage du site
pour revenir aux coordonnées de la source. Les noms CSV doivent être uniques.

Le survol et le focus clavier synchronisent la ligne, le marqueur et les détails.
Le clic conserve la sélection. Une entrée non placée reste consultable dans la liste.

## Résumé des prix

**Prix par pièce** affiche les sous-totaux par zone et le total des prix connus, dans
le mode admin, la vue artisan et le fichier GitHub Pages. Le résumé inclut toutes les
entrées, indépendamment des filtres, y compris les équipements déjà présents.
Chaque ligne contribue une seule fois avec son prix : aucune quantité n'est déduite
des mots « double » ou « triple ». Les montants sont additionnés en centimes, hors
main-d'œuvre. Les prix manquants sont signalés et le total est marqué **partiel** ;
une pièce sans aucun prix affiche **Non renseigné**, pas un zéro supposé.
Les lignes sans zone sont regroupées dans **Sans pièce**. Une ligne avec plusieurs
zones reste dans un groupe combiné pour éviter de compter son prix plusieurs fois.

Sous les sous-totaux, chaque pièce possède un détail repliable avec une ligne par prise
ou interrupteur : visuel constructeur, nom, type, installation et prix. Cliquer sur
le nom ouvre sa fiche sur le plan. Les détails restent complets même si la liste
principale est filtrée.

## Visuels constructeur

Ajouter une colonne **image**, de type **URL**, dans le catalogue lié par **prises BOM**.
La fiche d'une prise et son détail dans le tableau des prix affichent le ou les visuels
des produits liés, avec leur nom constructeur. Une URL vide affiche **Visuel non
renseigné** ; un téléchargement impossible affiche **Image indisponible**.
Donner à l'intégration Notion accès au catalogue, en plus des prises et des zones.

Les images sont intégrées dans les exports artisan et la construction GitHub Pages,
sans requête externe chez le visiteur. Chaque URL distincte est téléchargée une seule
fois et stockée une seule fois dans l'instantané. Pour l'export, les URL doivent être
en HTTPS sur **assets.legrand.com**, sans redirection ni identifiants, et pointer vers
une image JPEG, PNG, WebP ou GIF de moins de 8 Mo. Un échec bloque l'export ou le
déploiement avec une erreur explicite, plutôt que publier un fichier incomplet.
Les URL d'autres fabricants nécessitent d'ajouter leur origine autorisée dans
`src/lib/catalogue-image.ts`. Les visuels restent des images du catalogue, pas des
photos des prises effectivement installées.

## Modes admin et artisan / GitHub Pages

Le serveur Astro conserve le **mode admin** : lecture de Notion, placement, export CSV
et sauvegarde explicite. **Aperçu du site** ouvre un aperçu en lecture seule, avec retour
au mode admin. Le mode artisan conserve le survol, la sélection, les détails, les
filtres, le zoom et le déplacement du fond, mais aucun outil d'édition ou de sauvegarde.

Pour partager :

1. Charger les données et vérifier les positions dans le mode admin.
2. Cliquer sur **Exporter pour GitHub Pages**, vérifier l'avertissement puis télécharger
   l'archive. Les 32 entrées (ou toutes les entrées actuellement chargées) sont incluses,
   indépendamment des filtres, avec les notes et prix. Les positions locales non encore
   enregistrées dans Notion sont incluses.
3. Décompresser `plan-electricite-artisan.zip`. Le fichier `index.html` contient tout :
   données, image, styles et JavaScript. Il fonctionne aussi directement dans un navigateur.
4. Dans un dépôt GitHub dédié au partage, publier **uniquement** `index.html` et `.nojekyll`
   à la racine. Ne jamais publier `.env` ni les fichiers serveur sur GitHub Pages.
   Le dépôt source peut contenir l'application pour la CI décrite ci-dessous.
5. Dans **Settings > Pages**, choisir **Deploy from a branch**, la branche de publication
   et **/ (root)**. Partager ensuite l'URL affichée par GitHub.

Aucun serveur, token, appel API, connexion Notion ni installation npm n'est nécessaire
sur GitHub Pages. La page autonome fonctionne sous un chemin de dépôt, sans configuration
de base URL ni assets externes. Les IDs et liens Notion sont retirés de l'instantané.
Les noms, notes, zones, prix et le plan restent visibles : GitHub Pages est généralement
public, même si le dépôt ne l'est pas. Ne publier que des informations partageables.

Le partage est **figé et daté**, pas une connexion en direct. Après modification,
refaire l'export et remplacer `index.html` dans le dépôt. Les modifications locales
d'un visiteur ou de l'administrateur ne peuvent pas modifier la copie publiée.

La visionneuse autonome est générée automatiquement avant `npm run dev` et
`npm run build` via `npm run build:viewer`, sans charger `.env` ou le SDK Notion.
Après modification des composants partagés pendant que le serveur tourne, relancer
`npm run build:viewer` pour que le prochain export utilise la dernière version.

## CI/CD artisan sur GitHub Pages

Le workflow `.github/workflows/deploy-artisan.yml` cible le dépôt
`francouee/apartment-electricity`. Chaque push sur `main`, ou lancement manuel dans
**Actions > Deploy artisan to GitHub Pages > Run workflow**, lit la base Notion,
construit un nouvel instantané puis le déploie avec les actions officielles Pages.
Les tests unitaires et navigateur, ainsi que la vérification/construction Astro,
doivent réussir avant publication.
Seul le dossier `.artisan/` est envoyé à Pages : `index.html` autonome et `.nojekyll`.
Le serveur admin, le SDK Notion et les secrets ne sont pas publiés sur Pages.

Configuration initiale :

1. Pousser les sources dans le dépôt, y compris `package-lock.json`, le workflow et
   `public/plan.jpeg`. Ne jamais ajouter `.env`, `node_modules/`, `dist/`, `.generated/`
   ou `.artisan/` ; ils sont ignorés.
2. Dans **Settings > Secrets and variables > Actions > Secrets**, créer
   **NOTION_TOKEN**, idéalement avec une intégration dédiée en lecture seule.
   Lui donner accès aux bases des prises, des zones et du catalogue constructeur.
3. Dans **Variables**, **NOTION_DATABASE_ID** est facultatif : par défaut, le workflow
   utilise `3f004b47b668805bb716e95849c52b71`. Définir **NOTION_DATA_SOURCE_ID** si la
   base possède plusieurs sources.
4. Dans **Settings > Pages > Build and deployment > Source**, choisir
   **GitHub Actions**, pas « Deploy from a branch ».
5. Lancer le workflow. L'URL de publication attendue est
   `https://francouee.github.io/apartment-electricity/` ; le déploiement affiche l'URL
   effective dans l'environnement **github-pages**.

**Avant de déployer, enregistrer explicitement les positions dans Notion.**
La CI lit uniquement les données sauvegardées dans Notion, jamais le localStorage du
navigateur. Une modification Notion seule ne déclenche pas le workflow : le relancer
manuellement pour actualiser la page. Aucun accès Notion n'est requis côté visiteur.
Si les secrets manquent ou la lecture échoue, le déploiement est bloqué ; il n'y a
aucun remplacement silencieux par le CSV et la dernière publication reste inchangée.

Le dépôt source et la page sont publics : le plan, les noms, les notes et les prix
doivent être partageables. Le workflow ne publie pas les identifiants/liens Notion.

Pour vérifier localement la même construction avec le fichier `.env` :

```sh
npm run build:viewer
node --env-file=.env --import tsx scripts/build-artisan.ts
```

Ouvrir `.artisan/index.html`. Ne pas versionner cet instantané.

## Sauvegarde explicite dans Notion

En mode Notion, **Enregistrer dans Notion** indique le nombre de positions différentes
de la source. La confirmation liste les prises et leurs coordonnées, même si un filtre
les masque. Seules les colonnes X et Y sont mises à jour ; aucune page n'est créée.
Activer **Mettre à jour le contenu** dans les permissions de l'intégration.

Le serveur valide les coordonnées, les identifiants et l'appartenance de toutes les
prises à la base configurée avant toute écriture. Il relit les positions Notion pour
détecter un changement depuis le chargement : en cas de conflit, actualiser et vérifier
les positions locales avant de confirmer à nouveau. Notion ne propose pas de transaction
atomique pour plusieurs pages ; une modification concurrente pendant les appels reste
possible. Une sauvegarde partielle indique combien de prises ont été confirmées :
seules ces positions quittent les modifications locales, les autres restent à réessayer.
Une requête interrompue peut avoir été appliquée dans Notion : actualiser avant de réessayer.
Le cache de lecture est invalidé après une tentative de sauvegarde.

**L'écriture est autorisée uniquement avec `npm run dev` sur une adresse de boucle
locale**, depuis la même origine, avec un corps JSON. En production, elle est désactivée
côté serveur, même si un visiteur appelle l'API directement. Une ouverture de l'écriture
en production nécessiterait une authentification et une autorisation côté serveur.
Les consultations et exports restent disponibles en production.

## Lecture directe de Notion

La publication Web ne dispense pas d'authentifier l'API. Le MCP n'est pas utilisé
par l'application. Créer une intégration Notion en **lecture seule**, puis donner
accès à la base et aux pages de la relation **🗺️ Zones**.

Copier `.env.example` vers `.env`, puis renseigner localement :

```dotenv
NOTION_TOKEN=le_token_de_l_integration
NOTION_DATABASE_ID=3f004b47b668805bb716e95849c52b71
NOTION_DATA_SOURCE_ID=
```

Ne pas partager ou versionner le token. Ne jamais ajouter de préfixe `PUBLIC_`.
Si la base possède plusieurs sources, renseigner `NOTION_DATA_SOURCE_ID`.
Redémarrer Astro après une modification de `.env`.

Colonnes attendues avec ces noms exacts :

| Colonne | Type Notion |
| --- | --- |
| Nom | Titre |
| Type | Sélection, multi-sélection ou texte |
| Prix | Nombre ou agrégation (rollup) numérique (vide autorisé) |
| Déjà présente ? | Case à cocher |
| 🗺️ Zones | Relation, sélection, multi-sélection ou texte |
| X, Y | Nombre, tous deux vides ou entre 0 et 100 |
| Notes | Texte |

Pour un prix lié au catalogue constructeur, l'agrégation **Prix** peut utiliser
**Afficher l'original** avec une seule référence et une colonne constructeur de type
Nombre, ou un calcul numérique tel que **Somme**. Une relation vide ou un prix vide
reste **Non renseigné**, jamais zéro par défaut. Si plusieurs références sont liées,
choisir explicitement le calcul d'agrégation dans Notion : l'application n'additionne
pas automatiquement les tarifs d'une liste. Donner aussi à l'intégration accès à la
base du catalogue constructeur. Les positions X et Y restent des colonnes Nombre.

L'API pagine toutes les entrées et résout les titres des zones. Les réponses réussies
sont mises en cache une minute. **Actualiser** recharge la dernière réponse disponible ;
une modification Notion peut donc prendre jusqu'à une minute à apparaître.
En cas d'échec Notion, une erreur est affichée : aucun retour silencieux au CSV.
Sans token, le mode CSV est clairement indiqué. Seules les colonnes ci-dessus sont
transmises au navigateur. Si le site est publié, ces données sont accessibles à ses
visiteurs : protéger le déploiement si elles ne doivent pas être publiques.

Les IDs Notion et les IDs CSV sont distincts : les placements CSV ne sont pas
automatiquement transférés à la connexion Notion. Les repositionner en mode Notion
ou reporter X/Y dans les entrées existantes de Notion. Réimporter un CSV dans Notion
peut créer des doublons ; la sauvegarde explicite utilise les IDs des pages existantes,
pas une fusion par nom.

## Production et contrôles

```sh
npm test
npx playwright install chromium
npm run test:e2e
npm run build
HOST=127.0.0.1 PORT=4321 npm start
```

Le déploiement utilise l'adaptateur Node d'Astro, pas un hébergement purement statique.
Configurer les secrets dans l'environnement du serveur. Le plan est un repérage de
projet, pas une validation de conformité électrique.
