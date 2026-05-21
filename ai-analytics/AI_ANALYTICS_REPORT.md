# AI Analytics - Rapport d'analyse (Etape 1)

## 1) Architecture detectee
- Projet actuel: portail **statique HTML/CSS/JS** (pas de structure Next.js `app/` ou `pages/`).
- Runtime Vercel detecte via `middleware.js` (porte d'acces par cookie signe journalier).
- Connexion Supabase majoritairement cote navigateur (cle anon en frontend sur plusieurs pages).
- Nouveau module ajoute pour IA:
  - route serveur `api/ai-query.js` (lecture seule),
  - page client `ai-analytics.html`,
  - schema et types dans `ai-analytics/`.

## 2) Tables detectees
- `clients`
- `plaques`
- `produits`
- `tarifs_plaques`
- `visites`
- `visite_commandes`

Voir le mapping complet: `ai-analytics/supabase-schema.generated.json`.

## 3) Relations detectees (inference code)
- `clients.plaque_id -> plaques.id`
- `visites.client_id -> clients.id`
- `visite_commandes.visite_id -> visites.id`
- `visite_commandes.produit_id -> produits.id`
- `tarifs_plaques.plaque_id -> plaques.id`
- `tarifs_plaques.produit_id -> produits.id`

## 4) Risques securite identifies
- Cle anon exposee en frontend sur plusieurs pages (attendu techniquement, mais sensible si RLS permissive).
- Script SQL present (`supabase_fix_commerce_rls.sql`) applique des policies tres permissives (`using (true)`).
- Pas de filtrage utilisateur metier fin (pas de table users/roles metier dans ce repo).
- Plusieurs pages font insert/update/delete directement cote client.

## 5) Protections ajoutees pour l'IA
- Route `POST /api/ai-query` uniquement.
- Auth session obligatoire (verification cookie signe compatible middleware).
- Lecture seule stricte:
  - aucune operation `insert/update/delete/drop` dans le moteur,
  - intents mappes vers requetes predefinies.
- Validation stricte payload:
  - `question` obligatoire,
  - `limit` borne a `<= 1000`,
  - `filters` sanitises.
- Blocage mots-cle SQL dangereux dans la question.
- Parsing IA via Mistral en JSON mode (`response_format: json_object`) avec validation serveur.
- Reponses `Cache-Control: no-store`.

## 6) Optimisations possibles
- Ajouter des index si besoin perf:
  - `visites(date_visite, client_id)`
  - `visite_commandes(visite_id, produit_id, couleur)`
  - `clients(plaque_id, numero_compte)`
- Ajouter un vrai modele d'auth utilisateur (table profils + liaison clients autorises).
- Durcir RLS pour enlever les policies permissives.
- Centraliser URL/cle Supabase via variables d'environnement uniquement.

## 7) Prochaines etapes recommandees
1. Valider les variables env Vercel pour l'API (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ACCESS_DAILY_CODE`).
2. Tester `ai-analytics.html` avec des questions:
   - "Quel est mon top 10 produit sur ce mois ?"
   - "Donne-moi mon CA du mois"
   - "Liste les visites sans vente ce mois"
3. Mistral deja integre:
   - classification de l'intent + extraction filtres en JSON,
   - execution via moteur read-only uniquement.
4. Ajouter un scope utilisateur metier des que la table utilisateurs est definie.
