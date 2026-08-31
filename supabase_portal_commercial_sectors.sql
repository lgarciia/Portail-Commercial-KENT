-- Secteurs commerciaux pour la console admin.
-- Safe: ajoute uniquement une table de secteurs et un lien optionnel sur portal_users.
-- Aucune vente, aucun budget, aucun import et aucun rattachement responsable ne sont supprimes.

begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.portal_commercial_sectors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_lookup text generated always as (lower(btrim(name))) stored,
  departments text[] not null default '{}',
  color text not null default '#0F766E',
  description text,
  active boolean not null default true,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portal_commercial_sectors_name_not_empty check (length(btrim(name)) >= 2),
  constraint portal_commercial_sectors_color_hex check (color ~ '^#[0-9A-Fa-f]{6}$')
);

create unique index if not exists uq_portal_commercial_sectors_name_lookup
  on public.portal_commercial_sectors (name_lookup);

create index if not exists idx_portal_commercial_sectors_active
  on public.portal_commercial_sectors (active, hidden, name);

alter table public.portal_users
  add column if not exists sector_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fk_portal_users_sector'
      and conrelid = 'public.portal_users'::regclass
  ) then
    alter table public.portal_users
      add constraint fk_portal_users_sector
      foreign key (sector_id)
      references public.portal_commercial_sectors(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists idx_portal_users_sector
  on public.portal_users (sector_id)
  where sector_id is not null;

create or replace function public.portal_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_portal_commercial_sectors_updated_at on public.portal_commercial_sectors;
create trigger trg_portal_commercial_sectors_updated_at
before update on public.portal_commercial_sectors
for each row
execute function public.portal_set_updated_at();

alter table public.portal_commercial_sectors enable row level security;

revoke all on table public.portal_commercial_sectors from anon, authenticated;
grant select, insert, update, delete on table public.portal_commercial_sectors to service_role;

commit;

select
  'portal_commercial_sectors_ready' as status,
  (select count(*) from public.portal_commercial_sectors) as secteurs,
  (select count(*) from public.portal_users where sector_id is not null) as commerciaux_rattaches_secteur;
