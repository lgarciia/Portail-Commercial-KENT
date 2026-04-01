# Portail Commercial KENT

Portail statique en HTML/CSS/JS avec fichiers de donnees Excel servis directement depuis la racine du projet.

## Deploiement

- Point d'entree metier : `index.html`
- Point d'entree public protege : `acces.html` via `middleware.js`
- Type de projet : site statique, sans build Node obligatoire
- Hebergement cible : Vercel via import GitHub

## Points importants

- Les fichiers `.xlsx` utilises par l'application doivent rester dans le repo, sinon les vues qui font des `fetch()` locaux ne chargeront plus leurs donnees.
- Certaines routes non developpees publient volontairement une page "En cours de creation" pour eviter les erreurs 404.
- Les pages connectees a Supabase fonctionnent cote navigateur avec une cle anon publique. Avant ouverture publique large, verifier les policies/RLS dans Supabase.
- L'acces au portail passe maintenant par une porte d'entree protegee. Sur Vercel, il faut definir la variable d'environnement `ACCESS_DAILY_CODE` avec la valeur voulue avant de tester.

## Verification rapide avant push

1. Verifier que `index.html` s'ouvre bien en local via un serveur HTTP.
2. Verifier que les fichiers Excel necessaires sont presents a la racine.
3. Verifier dans `git status` que les fichiers attendus sont bien suivis avant le commit.
4. Sur Vercel, definir `ACCESS_DAILY_CODE` puis redeployer pour activer le code journalier.
