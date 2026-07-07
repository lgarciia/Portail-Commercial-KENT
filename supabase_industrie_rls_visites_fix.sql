-- Correctif RLS Industrie - visites et commandes.
-- A lancer dans Supabase SQL Editor si la fiche client Industrie affiche
-- "Impossible d'enregistrer la visite".
-- Important: ce script ne supprime aucune donnee et ne touche pas aux tables auto.

begin;

create table if not exists public.industrie_visites (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.industrie_clients(id) on delete cascade,
  date_visite date not null,
  type_visite text not null default 'vente',
  note text,
  total_commande numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint industrie_visites_type_visite_check
    check (type_visite in ('vente', 'passage_sans_vente', 'client_ferme', 'commande_telephone'))
);

create table if not exists public.industrie_visite_commandes (
  id uuid primary key default gen_random_uuid(),
  visite_id uuid not null references public.industrie_visites(id) on delete cascade,
  produit_id uuid references public.industrie_produits(id) on delete set null,
  quantite numeric not null default 0,
  stock_client numeric not null default 0,
  couleur text,
  prix_unitaire numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_industrie_visites_client_date
  on public.industrie_visites (client_id, date_visite desc);

create index if not exists idx_industrie_commandes_visite
  on public.industrie_visite_commandes (visite_id);

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on table
  public.industrie_clients,
  public.industrie_plaques,
  public.industrie_visites,
  public.industrie_visite_commandes
to anon, authenticated;

grant select on table
  public.industrie_produits,
  public.industrie_tarifs_plaques,
  public.industrie_conditionnements_produits
to anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'industrie_clients',
    'industrie_plaques',
    'industrie_visites',
    'industrie_visite_commandes',
    'industrie_produits',
    'industrie_tarifs_plaques',
    'industrie_conditionnements_produits'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);

    execute format('drop policy if exists %I on public.%I;', t || '_select_all', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true);', t || '_select_all', t);
  end loop;
end
$$;

drop policy if exists industrie_visites_insert_all on public.industrie_visites;
create policy industrie_visites_insert_all
on public.industrie_visites
for insert
to anon, authenticated
with check (true);

drop policy if exists industrie_visites_update_all on public.industrie_visites;
create policy industrie_visites_update_all
on public.industrie_visites
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists industrie_visites_delete_all on public.industrie_visites;
create policy industrie_visites_delete_all
on public.industrie_visites
for delete
to anon, authenticated
using (true);

drop policy if exists industrie_visite_commandes_insert_all on public.industrie_visite_commandes;
create policy industrie_visite_commandes_insert_all
on public.industrie_visite_commandes
for insert
to anon, authenticated
with check (true);

drop policy if exists industrie_visite_commandes_update_all on public.industrie_visite_commandes;
create policy industrie_visite_commandes_update_all
on public.industrie_visite_commandes
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists industrie_visite_commandes_delete_all on public.industrie_visite_commandes;
create policy industrie_visite_commandes_delete_all
on public.industrie_visite_commandes
for delete
to anon, authenticated
using (true);

commit;

select 'industrie_visites' as table_name, count(*) as row_count from public.industrie_visites
union all
select 'industrie_visite_commandes', count(*) from public.industrie_visite_commandes;
