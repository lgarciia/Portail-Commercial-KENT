-- Table utilisee par le module Import conditionnement et le futur BDC.
-- A lancer une seule fois dans l'editeur SQL Supabase.

create table if not exists public.conditionnements_produits (
  id uuid primary key default gen_random_uuid(),
  ref_5 text not null,
  code_produit text,
  categorie text,
  famille text,
  sous_famille text,
  description text,
  grains text,
  emballage text,
  tarif_revente numeric,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint conditionnements_produits_ref_5_unique unique (ref_5)
);

create index if not exists idx_conditionnements_produits_ref_5
  on public.conditionnements_produits (ref_5);

grant select, insert, update, delete on table public.conditionnements_produits to anon, authenticated;

alter table public.conditionnements_produits enable row level security;

drop policy if exists conditionnements_produits_select_all on public.conditionnements_produits;
create policy conditionnements_produits_select_all
on public.conditionnements_produits
for select
to anon, authenticated
using (true);

drop policy if exists conditionnements_produits_insert_all on public.conditionnements_produits;
create policy conditionnements_produits_insert_all
on public.conditionnements_produits
for insert
to anon, authenticated
with check (true);

drop policy if exists conditionnements_produits_update_all on public.conditionnements_produits;
create policy conditionnements_produits_update_all
on public.conditionnements_produits
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists conditionnements_produits_delete_all on public.conditionnements_produits;
create policy conditionnements_produits_delete_all
on public.conditionnements_produits
for delete
to anon, authenticated
using (true);
