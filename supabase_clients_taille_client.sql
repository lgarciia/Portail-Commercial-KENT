-- KENT - Classement client S / M / L
-- Script non destructif : aucune table n'est supprimee, aucune ligne client n'est effacee.
-- Objectif : ajouter une taille client exploitable dans les fiches clients et la requete client.

begin;

alter table if exists public.clients
  add column if not exists taille_client text;

alter table if exists public.industrie_clients
  add column if not exists taille_client text;

update public.clients
set taille_client = 'S'
where taille_client is null
   or btrim(taille_client) = '';

update public.industrie_clients
set taille_client = 'S'
where taille_client is null
   or btrim(taille_client) = '';

update public.clients
set taille_client = upper(btrim(taille_client))
where upper(btrim(taille_client)) in ('S','M','L')
  and taille_client <> upper(btrim(taille_client));

update public.industrie_clients
set taille_client = upper(btrim(taille_client))
where upper(btrim(taille_client)) in ('S','M','L')
  and taille_client <> upper(btrim(taille_client));

update public.clients
set taille_client = 'S'
where upper(btrim(taille_client)) not in ('S','M','L');

update public.industrie_clients
set taille_client = 'S'
where upper(btrim(taille_client)) not in ('S','M','L');

alter table if exists public.clients
  alter column taille_client set default 'S';

alter table if exists public.industrie_clients
  alter column taille_client set default 'S';

alter table if exists public.clients
  alter column taille_client set not null;

alter table if exists public.industrie_clients
  alter column taille_client set not null;

do $$
begin
  if to_regclass('public.clients') is not null
     and not exists (
       select 1
       from pg_constraint
       where conname = 'clients_taille_client_check'
         and conrelid = 'public.clients'::regclass
     ) then
    alter table public.clients
      add constraint clients_taille_client_check
      check (taille_client in ('S','M','L'));
  end if;

  if to_regclass('public.industrie_clients') is not null
     and not exists (
       select 1
       from pg_constraint
       where conname = 'industrie_clients_taille_client_check'
         and conrelid = 'public.industrie_clients'::regclass
     ) then
    alter table public.industrie_clients
      add constraint industrie_clients_taille_client_check
      check (taille_client in ('S','M','L'));
  end if;
end $$;

create index if not exists idx_clients_commercial_taille_client
  on public.clients (commercial_user_id, taille_client);

create index if not exists idx_industrie_clients_commercial_taille_client
  on public.industrie_clients (commercial_user_id, taille_client);

commit;

select
  'clients_taille_client_ready' as status,
  (select count(*) from public.clients where taille_client is null) as clients_sans_taille,
  (select count(*) from public.industrie_clients where taille_client is null) as industrie_clients_sans_taille;
