-- Migration safe : rattachement des donnees commerciales aux utilisateurs portail.
-- Ce fichier ne supprime aucune table, aucune ligne et aucun fichier.

-- 1) Structure : colonnes proprietaire commercial.
alter table if exists public.clients
  add column if not exists commercial_user_id uuid,
  add column if not exists commercial_identifier text,
  add column if not exists commercial_name text;

alter table if exists public.visites
  add column if not exists commercial_user_id uuid,
  add column if not exists commercial_identifier text,
  add column if not exists commercial_name text;

alter table if exists public.industrie_clients
  add column if not exists commercial_user_id uuid,
  add column if not exists commercial_identifier text,
  add column if not exists commercial_name text;

alter table if exists public.industrie_visites
  add column if not exists commercial_user_id uuid,
  add column if not exists commercial_identifier text,
  add column if not exists commercial_name text;

alter table if exists public.documents_commerciaux
  add column if not exists commercial_user_id uuid,
  add column if not exists commercial_identifier text,
  add column if not exists commercial_name text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_commercial_user_id_fkey'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_commercial_user_id_fkey
      foreign key (commercial_user_id) references public.portal_users(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'visites_commercial_user_id_fkey'
      and conrelid = 'public.visites'::regclass
  ) then
    alter table public.visites
      add constraint visites_commercial_user_id_fkey
      foreign key (commercial_user_id) references public.portal_users(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'industrie_clients_commercial_user_id_fkey'
      and conrelid = 'public.industrie_clients'::regclass
  ) then
    alter table public.industrie_clients
      add constraint industrie_clients_commercial_user_id_fkey
      foreign key (commercial_user_id) references public.portal_users(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'industrie_visites_commercial_user_id_fkey'
      and conrelid = 'public.industrie_visites'::regclass
  ) then
    alter table public.industrie_visites
      add constraint industrie_visites_commercial_user_id_fkey
      foreign key (commercial_user_id) references public.portal_users(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'documents_commerciaux_commercial_user_id_fkey'
      and conrelid = 'public.documents_commerciaux'::regclass
  ) then
    alter table public.documents_commerciaux
      add constraint documents_commerciaux_commercial_user_id_fkey
      foreign key (commercial_user_id) references public.portal_users(id) on delete set null;
  end if;
end $$;

create index if not exists idx_clients_commercial_user_id
  on public.clients (commercial_user_id);

create index if not exists idx_visites_commercial_user_id
  on public.visites (commercial_user_id);

create index if not exists idx_industrie_clients_commercial_user_id
  on public.industrie_clients (commercial_user_id);

create index if not exists idx_industrie_visites_commercial_user_id
  on public.industrie_visites (commercial_user_id);

create index if not exists idx_documents_commerciaux_commercial_user_id
  on public.documents_commerciaux (commercial_user_id);

-- 2) Audit avant attribution historique.
-- Change 'guillaume.garcia' si ton identifiant exact est different.
with guillaume as (
  select id, identifier, display_name
  from public.portal_users
  where identifier_lookup = lower(btrim('guillaume.garcia'))
  limit 1
),
audit as (
  select
    'clients' as table_name,
    count(*) as total_lignes,
    count(*) filter (where commercial_user_id is null) as sans_commercial,
    count(*) filter (where commercial_user_id = (select id from guillaume)) as deja_guillaume,
    count(*) filter (where commercial_user_id is not null and commercial_user_id <> (select id from guillaume)) as autre_commercial
  from public.clients

  union all

  select
    'visites',
    count(*),
    count(*) filter (where commercial_user_id is null),
    count(*) filter (where commercial_user_id = (select id from guillaume)),
    count(*) filter (where commercial_user_id is not null and commercial_user_id <> (select id from guillaume))
  from public.visites

  union all

  select
    'industrie_clients',
    count(*),
    count(*) filter (where commercial_user_id is null),
    count(*) filter (where commercial_user_id = (select id from guillaume)),
    count(*) filter (where commercial_user_id is not null and commercial_user_id <> (select id from guillaume))
  from public.industrie_clients

  union all

  select
    'industrie_visites',
    count(*),
    count(*) filter (where commercial_user_id is null),
    count(*) filter (where commercial_user_id = (select id from guillaume)),
    count(*) filter (where commercial_user_id is not null and commercial_user_id <> (select id from guillaume))
  from public.industrie_visites

  union all

  select
    'documents_commerciaux',
    count(*),
    count(*) filter (where commercial_user_id is null),
    count(*) filter (where commercial_user_id = (select id from guillaume)),
    count(*) filter (where commercial_user_id is not null and commercial_user_id <> (select id from guillaume))
  from public.documents_commerciaux
)
select
  (select identifier from guillaume) as cible_identifier,
  (select display_name from guillaume) as cible_nom,
  audit.*
from audit
order by table_name;

-- 3) Attribution historique vers Guillaume Garcia.
-- A lancer seulement apres validation de l'audit ci-dessus.
do $$
declare
  target_identifier text := 'guillaume.garcia';
  guillaume_id uuid;
  guillaume_identifier text;
  guillaume_name text;
  updated_clients integer := 0;
  updated_visites integer := 0;
  updated_industrie_clients integer := 0;
  updated_industrie_visites integer := 0;
  updated_documents integer := 0;
begin
  select id, identifier, display_name
    into guillaume_id, guillaume_identifier, guillaume_name
  from public.portal_users
  where identifier_lookup = lower(btrim(target_identifier))
    and role = 'commercial'
  limit 1;

  if guillaume_id is null then
    raise exception 'Commercial cible introuvable dans portal_users pour identifier=%', target_identifier;
  end if;

  update public.clients
  set
    commercial_user_id = guillaume_id,
    commercial_identifier = guillaume_identifier,
    commercial_name = guillaume_name
  where commercial_user_id is null;
  get diagnostics updated_clients = row_count;

  update public.visites
  set
    commercial_user_id = guillaume_id,
    commercial_identifier = guillaume_identifier,
    commercial_name = guillaume_name
  where commercial_user_id is null;
  get diagnostics updated_visites = row_count;

  update public.industrie_clients
  set
    commercial_user_id = guillaume_id,
    commercial_identifier = guillaume_identifier,
    commercial_name = guillaume_name
  where commercial_user_id is null;
  get diagnostics updated_industrie_clients = row_count;

  update public.industrie_visites
  set
    commercial_user_id = guillaume_id,
    commercial_identifier = guillaume_identifier,
    commercial_name = guillaume_name
  where commercial_user_id is null;
  get diagnostics updated_industrie_visites = row_count;

  update public.documents_commerciaux
  set
    commercial_user_id = guillaume_id,
    commercial_identifier = guillaume_identifier,
    commercial_name = guillaume_name
  where commercial_user_id is null;
  get diagnostics updated_documents = row_count;

  raise notice 'Attribution terminee vers % (%). clients=%, visites=%, industrie_clients=%, industrie_visites=%, documents=%',
    guillaume_name,
    guillaume_identifier,
    updated_clients,
    updated_visites,
    updated_industrie_clients,
    updated_industrie_visites,
    updated_documents;
end $$;

-- 4) Verification apres attribution.
with owners as (
  select id, identifier, display_name
  from public.portal_users
)
select 'clients' as table_name, coalesce(o.identifier, 'SANS COMMERCIAL') as commercial, count(*) as lignes
from public.clients c
left join owners o on o.id = c.commercial_user_id
group by o.identifier

union all

select 'visites', coalesce(o.identifier, 'SANS COMMERCIAL'), count(*)
from public.visites v
left join owners o on o.id = v.commercial_user_id
group by o.identifier

union all

select 'industrie_clients', coalesce(o.identifier, 'SANS COMMERCIAL'), count(*)
from public.industrie_clients c
left join owners o on o.id = c.commercial_user_id
group by o.identifier

union all

select 'industrie_visites', coalesce(o.identifier, 'SANS COMMERCIAL'), count(*)
from public.industrie_visites v
left join owners o on o.id = v.commercial_user_id
group by o.identifier

union all

select 'documents_commerciaux', coalesce(o.identifier, 'SANS COMMERCIAL'), count(*)
from public.documents_commerciaux d
left join owners o on o.id = d.commercial_user_id
group by o.identifier
order by table_name, commercial;
