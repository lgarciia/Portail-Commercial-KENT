-- Correctif RLS Industrie - produits et tarifs.
-- A lancer dans Supabase SQL Editor si l'import tarifs Industrie ne peut pas
-- lire/ecrire les produits ou tarifs industrie.
-- Important: ce script ne supprime aucune donnee et ne touche pas aux tables auto.

begin;

create table if not exists public.industrie_plaques (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  created_at timestamptz not null default now(),
  constraint industrie_plaques_nom_unique unique (nom)
);

create table if not exists public.industrie_produits (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  reference_produit text,
  prix_vente numeric,
  actif boolean not null default true,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.industrie_tarifs_plaques (
  id uuid primary key default gen_random_uuid(),
  plaque_id uuid not null references public.industrie_plaques(id) on delete cascade,
  produit_id uuid not null references public.industrie_produits(id) on delete cascade,
  prix_vente numeric,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint industrie_tarifs_plaques_unique unique (plaque_id, produit_id)
);

create index if not exists idx_industrie_produits_reference
  on public.industrie_produits (reference_produit);

create index if not exists idx_industrie_tarifs_plaque
  on public.industrie_tarifs_plaques (plaque_id);

create index if not exists idx_industrie_tarifs_produit
  on public.industrie_tarifs_plaques (produit_id);

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on table
  public.industrie_produits,
  public.industrie_tarifs_plaques
to anon, authenticated;

grant select on table
  public.industrie_plaques
to anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'industrie_plaques',
    'industrie_produits',
    'industrie_tarifs_plaques'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);

    execute format('drop policy if exists %I on public.%I;', t || '_select_all', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true);', t || '_select_all', t);
  end loop;
end
$$;

drop policy if exists industrie_produits_insert_all on public.industrie_produits;
create policy industrie_produits_insert_all
on public.industrie_produits
for insert
to anon, authenticated
with check (true);

drop policy if exists industrie_produits_update_all on public.industrie_produits;
create policy industrie_produits_update_all
on public.industrie_produits
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists industrie_produits_delete_all on public.industrie_produits;
create policy industrie_produits_delete_all
on public.industrie_produits
for delete
to anon, authenticated
using (true);

drop policy if exists industrie_tarifs_plaques_insert_all on public.industrie_tarifs_plaques;
create policy industrie_tarifs_plaques_insert_all
on public.industrie_tarifs_plaques
for insert
to anon, authenticated
with check (true);

drop policy if exists industrie_tarifs_plaques_update_all on public.industrie_tarifs_plaques;
create policy industrie_tarifs_plaques_update_all
on public.industrie_tarifs_plaques
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists industrie_tarifs_plaques_delete_all on public.industrie_tarifs_plaques;
create policy industrie_tarifs_plaques_delete_all
on public.industrie_tarifs_plaques
for delete
to anon, authenticated
using (true);

commit;

select 'industrie_produits' as table_name, count(*) as row_count from public.industrie_produits
union all
select 'industrie_tarifs_plaques', count(*) from public.industrie_tarifs_plaques;
