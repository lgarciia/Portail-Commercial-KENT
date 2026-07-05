-- Socle Industrie KENT.
-- A lancer dans Supabase SQL Editor pour creer les tables industrie separees.
-- Important: ce script ne touche pas aux tables auto existantes.

begin;

create table if not exists public.industrie_plaques (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  created_at timestamptz not null default now(),
  constraint industrie_plaques_nom_unique unique (nom)
);

create table if not exists public.industrie_clients (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  numero_compte text,
  adresse text,
  telephone text,
  plaque_id uuid references public.industrie_plaques(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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

create table if not exists public.industrie_conditionnements_produits (
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
  constraint industrie_conditionnements_ref_5_unique unique (ref_5)
);

create index if not exists idx_industrie_clients_nom
  on public.industrie_clients (nom);

create index if not exists idx_industrie_clients_plaque
  on public.industrie_clients (plaque_id);

create index if not exists idx_industrie_produits_reference
  on public.industrie_produits (reference_produit);

create index if not exists idx_industrie_tarifs_plaque
  on public.industrie_tarifs_plaques (plaque_id);

create index if not exists idx_industrie_tarifs_produit
  on public.industrie_tarifs_plaques (produit_id);

create index if not exists idx_industrie_visites_client_date
  on public.industrie_visites (client_id, date_visite desc);

create index if not exists idx_industrie_commandes_visite
  on public.industrie_visite_commandes (visite_id);

create index if not exists idx_industrie_conditionnements_ref_5
  on public.industrie_conditionnements_produits (ref_5);

insert into public.industrie_plaques (nom)
values ('Tarif Industrie Standard')
on conflict (nom) do nothing;

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on table
  public.industrie_plaques,
  public.industrie_clients,
  public.industrie_produits,
  public.industrie_tarifs_plaques,
  public.industrie_visites,
  public.industrie_visite_commandes,
  public.industrie_conditionnements_produits
to anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'industrie_plaques',
    'industrie_clients',
    'industrie_produits',
    'industrie_tarifs_plaques',
    'industrie_visites',
    'industrie_visite_commandes',
    'industrie_conditionnements_produits'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);

    execute format('drop policy if exists %I on public.%I;', t || '_select_all', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true);', t || '_select_all', t);

    execute format('drop policy if exists %I on public.%I;', t || '_insert_all', t);
    execute format('create policy %I on public.%I for insert to anon, authenticated with check (true);', t || '_insert_all', t);

    execute format('drop policy if exists %I on public.%I;', t || '_update_all', t);
    execute format('create policy %I on public.%I for update to anon, authenticated using (true) with check (true);', t || '_update_all', t);

    execute format('drop policy if exists %I on public.%I;', t || '_delete_all', t);
    execute format('create policy %I on public.%I for delete to anon, authenticated using (true);', t || '_delete_all', t);
  end loop;
end
$$;

commit;

select 'industrie_plaques' as table_name, count(*) as row_count from public.industrie_plaques
union all
select 'industrie_clients', count(*) from public.industrie_clients
union all
select 'industrie_produits', count(*) from public.industrie_produits
union all
select 'industrie_tarifs_plaques', count(*) from public.industrie_tarifs_plaques
union all
select 'industrie_visites', count(*) from public.industrie_visites
union all
select 'industrie_visite_commandes', count(*) from public.industrie_visite_commandes
union all
select 'industrie_conditionnements_produits', count(*) from public.industrie_conditionnements_produits;
