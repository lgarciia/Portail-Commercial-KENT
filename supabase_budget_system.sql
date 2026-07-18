-- Systeme Projections / Budgets valides.
-- Safe: cree uniquement de nouvelles tables budget_* et insere les entites par defaut.
-- Aucune table existante n'est modifiee ou supprimee.

create extension if not exists pgcrypto;

create table if not exists public.budget_entites (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  libelle text not null,
  actif boolean not null default true,
  ordre integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.budget_entites (key, libelle, ordre)
values
  ('psa', 'PSA', 10),
  ('gueudet', 'Gueudet', 20),
  ('ford', 'Ford', 30),
  ('direct', 'Direct', 40)
on conflict (key) do update
set
  libelle = excluded.libelle,
  ordre = excluded.ordre,
  actif = true,
  updated_at = now();

create table if not exists public.budget_projections (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  annee integer not null,
  source_label text,
  source_entite_key text,
  total_annuel numeric(14, 2) not null default 0,
  nb_lignes integer not null default 0,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.budget_projection_lignes (
  id uuid primary key default gen_random_uuid(),
  projection_id uuid not null references public.budget_projections(id) on delete cascade,
  ordre integer not null default 0,
  client_nom text not null,
  numero_client text,
  jan numeric(14, 2) not null default 0,
  feb numeric(14, 2) not null default 0,
  mar numeric(14, 2) not null default 0,
  apr numeric(14, 2) not null default 0,
  may numeric(14, 2) not null default 0,
  jun numeric(14, 2) not null default 0,
  jul numeric(14, 2) not null default 0,
  aug numeric(14, 2) not null default 0,
  sep numeric(14, 2) not null default 0,
  oct numeric(14, 2) not null default 0,
  nov numeric(14, 2) not null default 0,
  dec numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  commentaire text,
  created_at timestamptz not null default now()
);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  projection_id uuid references public.budget_projections(id) on delete set null,
  entite_id uuid not null references public.budget_entites(id),
  nom text not null,
  annee integer not null,
  statut text not null default 'inactive' check (statut in ('active', 'inactive')),
  total_annuel numeric(14, 2) not null default 0,
  nb_lignes integer not null default 0,
  meta jsonb not null default '{}'::jsonb,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.budget_lignes (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.budgets(id) on delete cascade,
  ordre integer not null default 0,
  client_nom text not null,
  numero_client text,
  jan numeric(14, 2) not null default 0,
  feb numeric(14, 2) not null default 0,
  mar numeric(14, 2) not null default 0,
  apr numeric(14, 2) not null default 0,
  may numeric(14, 2) not null default 0,
  jun numeric(14, 2) not null default 0,
  jul numeric(14, 2) not null default 0,
  aug numeric(14, 2) not null default 0,
  sep numeric(14, 2) not null default 0,
  oct numeric(14, 2) not null default 0,
  nov numeric(14, 2) not null default 0,
  dec numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  commentaire text,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_budgets_active_entite_annee
  on public.budgets (entite_id, annee)
  where statut = 'active';

create index if not exists idx_budget_entites_key
  on public.budget_entites (key);

create index if not exists idx_budget_projections_annee
  on public.budget_projections (annee, created_at desc);

create index if not exists idx_budget_projection_lignes_projection
  on public.budget_projection_lignes (projection_id, ordre);

create index if not exists idx_budgets_entite_annee
  on public.budgets (entite_id, annee, statut);

create index if not exists idx_budget_lignes_budget
  on public.budget_lignes (budget_id, ordre);

create or replace function public.set_budget_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_budget_entites_updated_at on public.budget_entites;
create trigger trg_budget_entites_updated_at
before update on public.budget_entites
for each row execute function public.set_budget_updated_at();

drop trigger if exists trg_budget_projections_updated_at on public.budget_projections;
create trigger trg_budget_projections_updated_at
before update on public.budget_projections
for each row execute function public.set_budget_updated_at();

drop trigger if exists trg_budgets_updated_at on public.budgets;
create trigger trg_budgets_updated_at
before update on public.budgets
for each row execute function public.set_budget_updated_at();

grant select, insert, update, delete on table public.budget_entites to anon, authenticated;
grant select, insert, update, delete on table public.budget_projections to anon, authenticated;
grant select, insert, update, delete on table public.budget_projection_lignes to anon, authenticated;
grant select, insert, update, delete on table public.budgets to anon, authenticated;
grant select, insert, update, delete on table public.budget_lignes to anon, authenticated;

alter table public.budget_entites enable row level security;
alter table public.budget_projections enable row level security;
alter table public.budget_projection_lignes enable row level security;
alter table public.budgets enable row level security;
alter table public.budget_lignes enable row level security;

drop policy if exists budget_entites_all on public.budget_entites;
create policy budget_entites_all on public.budget_entites
for all to anon, authenticated using (true) with check (true);

drop policy if exists budget_projections_all on public.budget_projections;
create policy budget_projections_all on public.budget_projections
for all to anon, authenticated using (true) with check (true);

drop policy if exists budget_projection_lignes_all on public.budget_projection_lignes;
create policy budget_projection_lignes_all on public.budget_projection_lignes
for all to anon, authenticated using (true) with check (true);

drop policy if exists budgets_all on public.budgets;
create policy budgets_all on public.budgets
for all to anon, authenticated using (true) with check (true);

drop policy if exists budget_lignes_all on public.budget_lignes;
create policy budget_lignes_all on public.budget_lignes
for all to anon, authenticated using (true) with check (true);

select
  'budget_system_ready' as status,
  (select count(*) from public.budget_entites) as entites;
