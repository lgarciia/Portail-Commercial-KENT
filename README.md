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
- L'acces au portail passe par une porte d'entree protegee. Le mode historique `ACCESS_DAILY_CODE` reste compatible.
- Pour la phase utilisateurs/roles, definir aussi `PORTAL_USERS` sur Vercel avec un JSON du type :

```json
[
  {
    "id": "Guillaume.Garcia",
    "name": "Guillaume Garcia",
    "role": "commercial",
    "password": "CODE_COMMERCIAL"
  },
  {
    "id": "Lucas.Garcia",
    "name": "Lucas Garcia",
    "role": "admin",
    "password": "CODE_ADMIN"
  }
]
```

- Roles disponibles : `commercial`, `responsable`, `admin`.
- Variable conseillee en plus : `ACCESS_SESSION_SECRET`, une phrase secrete longue servant a signer la session.

## Verification rapide avant push

1. Verifier que `index.html` s'ouvre bien en local via un serveur HTTP.
2. Verifier que les fichiers Excel necessaires sont presents a la racine.
3. Verifier dans `git status` que les fichiers attendus sont bien suivis avant le commit.
4. Sur Vercel, definir `PORTAL_USERS` et `ACCESS_SESSION_SECRET`, puis redeployer.
5. Garder `ACCESS_DAILY_CODE` pendant la transition si on veut conserver l'ancien code de secours.
