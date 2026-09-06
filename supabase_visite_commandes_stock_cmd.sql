-- Ajout non destructif de l'information libre "ST / Cmd" sur les lignes de visite.
-- Aucune ligne existante n'est supprimée ni modifiée.

alter table public.visite_commandes
  add column if not exists stock_commande_info text;

alter table public.industrie_visite_commandes
  add column if not exists stock_commande_info text;

comment on column public.visite_commandes.stock_commande_info
  is 'Information libre courte ST / Cmd saisie sur une ligne de commande pour le BDC interne.';

comment on column public.industrie_visite_commandes.stock_commande_info
  is 'Information libre courte ST / Cmd saisie sur une ligne de commande industrie pour le BDC interne.';
