-- Ajout du suivi des demonstrations produit sur les lignes de visite.
-- Script non destructif : aucune ligne supprimee, aucune table videe.
begin;

alter table public.visite_commandes
  add column if not exists demo_effectuee boolean default false;

update public.visite_commandes
set demo_effectuee = false
where demo_effectuee is null;

alter table public.visite_commandes
  alter column demo_effectuee set default false,
  alter column demo_effectuee set not null;

alter table public.industrie_visite_commandes
  add column if not exists demo_effectuee boolean default false;

update public.industrie_visite_commandes
set demo_effectuee = false
where demo_effectuee is null;

alter table public.industrie_visite_commandes
  alter column demo_effectuee set default false,
  alter column demo_effectuee set not null;

create index if not exists idx_visite_commandes_demo_effectuee
  on public.visite_commandes (demo_effectuee)
  where demo_effectuee = true;

create index if not exists idx_industrie_visite_commandes_demo_effectuee
  on public.industrie_visite_commandes (demo_effectuee)
  where demo_effectuee = true;

commit;

select
  'visite_commandes' as table_name,
  count(*) as lignes_total,
  count(*) filter (where demo_effectuee) as lignes_demo
from public.visite_commandes
union all
select
  'industrie_visite_commandes' as table_name,
  count(*) as lignes_total,
  count(*) filter (where demo_effectuee) as lignes_demo
from public.industrie_visite_commandes;
