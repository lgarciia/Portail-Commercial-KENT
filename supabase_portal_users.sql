-- Portail utilisateurs / roles / rattachements.
-- Safe: cree uniquement de nouvelles tables public.portal_* et des fonctions associees.
-- Aucune table metier existante n'est modifiee ou supprimee.

create extension if not exists pgcrypto;

create table if not exists public.portal_users (
  id uuid primary key default gen_random_uuid(),
  identifier text not null unique,
  identifier_lookup text generated always as (lower(btrim(identifier))) stored,
  display_name text not null,
  role text not null check (role in ('commercial', 'responsable', 'admin')),
  password_hash text not null,
  home_path text,
  active boolean not null default true,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create unique index if not exists uq_portal_users_identifier_lookup
  on public.portal_users (identifier_lookup);

create index if not exists idx_portal_users_role_active
  on public.portal_users (role, active, hidden);

create table if not exists public.portal_user_relations (
  id uuid primary key default gen_random_uuid(),
  responsable_user_id uuid not null references public.portal_users(id) on delete restrict,
  commercial_user_id uuid not null references public.portal_users(id) on delete restrict,
  relation_type text not null default 'principal' check (relation_type in ('principal', 'exceptionnel')),
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (responsable_user_id <> commercial_user_id)
);

create index if not exists idx_portal_user_relations_responsable
  on public.portal_user_relations (responsable_user_id, active);

create index if not exists idx_portal_user_relations_commercial
  on public.portal_user_relations (commercial_user_id, active);

create unique index if not exists uq_portal_user_relations_active_pair
  on public.portal_user_relations (responsable_user_id, commercial_user_id, relation_type)
  where active = true;

create unique index if not exists uq_portal_user_relations_primary_commercial
  on public.portal_user_relations (commercial_user_id)
  where active = true and relation_type = 'principal';

create or replace function public.portal_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_portal_users_updated_at on public.portal_users;
create trigger trg_portal_users_updated_at
before update on public.portal_users
for each row
execute function public.portal_set_updated_at();

drop trigger if exists trg_portal_user_relations_updated_at on public.portal_user_relations;
create trigger trg_portal_user_relations_updated_at
before update on public.portal_user_relations
for each row
execute function public.portal_set_updated_at();

create or replace function public.portal_hash_password(p_password text)
returns text
language sql
security definer
set search_path = public, pg_temp
as $$
  select crypt(coalesce(p_password, ''), gen_salt('bf', 10));
$$;

create or replace function public.portal_authenticate_user(
  p_identifier text,
  p_password text
)
returns table (
  user_id uuid,
  identifier text,
  display_name text,
  role text,
  home_path text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  select
    u.id as user_id,
    u.identifier,
    u.display_name,
    u.role,
    coalesce(
      nullif(u.home_path, ''),
      case
        when u.role = 'admin' then '/admin.html'
        when u.role = 'responsable' then '/responsable.html'
        else '/'
      end
    ) as home_path
  from public.portal_users u
  where u.identifier_lookup = lower(btrim(coalesce(p_identifier, '')))
    and u.active = true
    and u.hidden = false
    and u.password_hash = crypt(coalesce(p_password, ''), u.password_hash)
  limit 1;

  update public.portal_users u
  set last_login_at = now()
  where u.identifier_lookup = lower(btrim(coalesce(p_identifier, '')))
    and u.active = true
    and u.hidden = false
    and u.password_hash = crypt(coalesce(p_password, ''), u.password_hash);
end;
$$;

alter table public.portal_users enable row level security;
alter table public.portal_user_relations enable row level security;

revoke all on table public.portal_users from anon, authenticated;
revoke all on table public.portal_user_relations from anon, authenticated;

revoke all on function public.portal_hash_password(text) from public;
grant execute on function public.portal_authenticate_user(text, text) to anon, authenticated;

-- Exemples a adapter dans le SQL Editor si tu veux migrer les comptes Vercel vers Supabase.
-- Remplace les mots de passe avant execution.
--
-- insert into public.portal_users (identifier, display_name, role, password_hash, home_path)
-- values
--   ('Lucas.Garcia', 'Lucas Garcia', 'admin', public.portal_hash_password('REMPLACER_CODE_LUCAS'), '/admin.html'),
--   ('Guillaume.Garcia', 'Guillaume Garcia', 'commercial', public.portal_hash_password('REMPLACER_CODE_GUILLAUME'), '/')
-- on conflict (identifier) do update
-- set
--   display_name = excluded.display_name,
--   role = excluded.role,
--   password_hash = excluded.password_hash,
--   home_path = excluded.home_path,
--   active = true,
--   hidden = false,
--   updated_at = now();
