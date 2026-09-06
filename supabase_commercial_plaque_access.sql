-- Droits d'accès aux plaques tarifaires par commercial.
-- Safe : crée uniquement une nouvelle table de droits et initialise Guillaume Garcia.
-- Aucune table métier existante n'est supprimée ou vidée.

begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.commercial_plaque_access (
  id uuid primary key default gen_random_uuid(),
  commercial_user_id uuid not null references public.portal_users(id) on delete cascade,
  secteur text not null check (secteur in ('auto', 'industrie')),
  plaque_id uuid not null,
  created_at timestamptz not null default now(),
  created_by text,
  constraint commercial_plaque_access_unique unique (commercial_user_id, secteur, plaque_id)
);

create index if not exists idx_commercial_plaque_access_user_sector
  on public.commercial_plaque_access (commercial_user_id, secteur);

create index if not exists idx_commercial_plaque_access_sector_plaque
  on public.commercial_plaque_access (secteur, plaque_id);

alter table public.commercial_plaque_access enable row level security;

revoke all on table public.commercial_plaque_access from anon, authenticated;
grant select, insert, update, delete on table public.commercial_plaque_access to service_role;

-- Initialisation volontaire : Guillaume Garcia conserve toutes les plaques existantes.
-- Les autres commerciaux démarrent avec 0 plaque autorisée et seront configurés par l'admin.
with guillaume as (
  select id
  from public.portal_users
  where role = 'commercial'
    and (
      identifier_lookup = 'guillaume.garcia'
      or lower(btrim(identifier)) = 'guillaume.garcia'
      or lower(btrim(display_name)) = 'guillaume garcia'
    )
  limit 1
)
insert into public.commercial_plaque_access (commercial_user_id, secteur, plaque_id, created_by)
select guillaume.id, 'auto', p.id, 'migration_initiale_guillaume'
from guillaume
cross join public.plaques p
on conflict (commercial_user_id, secteur, plaque_id) do nothing;

with guillaume as (
  select id
  from public.portal_users
  where role = 'commercial'
    and (
      identifier_lookup = 'guillaume.garcia'
      or lower(btrim(identifier)) = 'guillaume.garcia'
      or lower(btrim(display_name)) = 'guillaume garcia'
    )
  limit 1
)
insert into public.commercial_plaque_access (commercial_user_id, secteur, plaque_id, created_by)
select guillaume.id, 'industrie', p.id, 'migration_initiale_guillaume'
from guillaume
cross join public.industrie_plaques p
on conflict (commercial_user_id, secteur, plaque_id) do nothing;

commit;

select
  coalesce(u.display_name, u.identifier) as commercial,
  coalesce(a.secteur, 'aucun_droit') as secteur,
  count(a.plaque_id) as plaques_autorisees
from public.portal_users u
left join public.commercial_plaque_access a on a.commercial_user_id = u.id
where u.role = 'commercial'
group by coalesce(u.display_name, u.identifier), coalesce(a.secteur, 'aucun_droit')
order by commercial, secteur;
