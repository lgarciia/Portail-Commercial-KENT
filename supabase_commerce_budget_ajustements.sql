-- Table separee pour le CA partenaires utilise uniquement dans la vue Budget.
-- Elle ne modifie pas les ventes, les visites, les clients, ni les lignes produits.

create extension if not exists pgcrypto;

create table if not exists public.commerce_budget_ajustements (
  id uuid primary key default gen_random_uuid(),
  annee integer not null check (annee between 2000 and 2100),
  mois smallint not null check (mois between 1 and 12),
  secteur text not null default 'auto' check (secteur in ('auto', 'industrie', 'global')),
  source text not null default 'vendeurs_partenaires',
  montant numeric(14, 2) not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_budget_ajustements_unique unique (annee, mois, secteur, source)
);

create index if not exists idx_commerce_budget_ajustements_annee
  on public.commerce_budget_ajustements (annee);

create index if not exists idx_commerce_budget_ajustements_annee_mois
  on public.commerce_budget_ajustements (annee, mois);

grant select, insert, update, delete on table public.commerce_budget_ajustements to anon, authenticated;

alter table public.commerce_budget_ajustements enable row level security;

drop policy if exists commerce_budget_ajustements_select_all on public.commerce_budget_ajustements;
create policy commerce_budget_ajustements_select_all
on public.commerce_budget_ajustements
for select
to anon, authenticated
using (true);

drop policy if exists commerce_budget_ajustements_insert_all on public.commerce_budget_ajustements;
create policy commerce_budget_ajustements_insert_all
on public.commerce_budget_ajustements
for insert
to anon, authenticated
with check (true);

drop policy if exists commerce_budget_ajustements_update_all on public.commerce_budget_ajustements;
create policy commerce_budget_ajustements_update_all
on public.commerce_budget_ajustements
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists commerce_budget_ajustements_delete_all on public.commerce_budget_ajustements;
create policy commerce_budget_ajustements_delete_all
on public.commerce_budget_ajustements
for delete
to anon, authenticated
using (true);

create or replace function public.set_commerce_budget_ajustements_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_commerce_budget_ajustements_updated_at on public.commerce_budget_ajustements;
create trigger trg_commerce_budget_ajustements_updated_at
before update on public.commerce_budget_ajustements
for each row
execute function public.set_commerce_budget_ajustements_updated_at();

select
  'commerce_budget_ajustements' as table_name,
  count(*) as row_count
from public.commerce_budget_ajustements;
