-- Parametrage global de la source CA finance par mois.
-- Safe : cree une nouvelle table dediee. Aucune donnee existante n'est modifiee ou supprimee.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.finance_source_settings (
  id uuid primary key default extensions.gen_random_uuid(),
  annee integer not null check (annee between 2020 and 2100),
  mois integer not null check (mois between 1 and 12),
  source text not null default 'sales' check (source in ('sales', 'real')),
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_source_settings_unique unique (annee, mois)
);

create index if not exists idx_finance_source_settings_year
  on public.finance_source_settings (annee, mois);

alter table public.finance_source_settings enable row level security;

revoke all on table public.finance_source_settings from anon, authenticated;
grant select, insert, update, delete on table public.finance_source_settings to service_role;
