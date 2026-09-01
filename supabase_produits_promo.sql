-- Produits promo manuels par commercial.
-- Safe: ajoute uniquement des colonnes et index sur public.produits.
-- Aucune ligne produit, aucun tarif, aucune visite et aucune commande existante ne sont supprimes.

begin;

alter table public.produits
  add column if not exists origine text not null default 'import_tarif',
  add column if not exists created_by_user_id uuid,
  add column if not exists promo_deleted_at timestamptz;

do $$
begin
  alter table public.produits
    add constraint fk_produits_created_by_user
    foreign key (created_by_user_id)
    references public.portal_users(id)
    on delete set null;
exception
  when duplicate_object then null;
end
$$;

create index if not exists idx_produits_promo_owner
  on public.produits (created_by_user_id, actif, reference_produit)
  where origine = 'promo_manuelle';

create index if not exists idx_produits_reference_lookup
  on public.produits (reference_produit);

grant select, insert, update, delete on table public.produits to anon, authenticated;

commit;

select
  'produits_promo_ready' as status,
  count(*) filter (where origine = 'promo_manuelle') as produits_promo,
  count(*) as produits_total
from public.produits;
