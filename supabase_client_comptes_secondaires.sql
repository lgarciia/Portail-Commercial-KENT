-- Comptes clients secondaires pour BDC / Devis.
-- Safe: ne supprime aucune donnee existante et ne modifie pas les ventes/visites/lignes.
-- Le numero_compte actuel dans clients / industrie_clients reste le compte principal.

create extension if not exists pgcrypto;

create table if not exists public.client_comptes (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  numero_compte text not null,
  libelle text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_comptes_client_numero_unique unique (client_id, numero_compte)
);

create table if not exists public.industrie_client_comptes (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  numero_compte text not null,
  libelle text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint industrie_client_comptes_client_numero_unique unique (client_id, numero_compte)
);

alter table public.documents_commerciaux
  add column if not exists numero_compte_libelle text,
  add column if not exists compte_client_id uuid;

create index if not exists idx_client_comptes_client_id
  on public.client_comptes (client_id);

create index if not exists idx_client_comptes_default
  on public.client_comptes (client_id, is_default);

create index if not exists idx_industrie_client_comptes_client_id
  on public.industrie_client_comptes (client_id);

create index if not exists idx_industrie_client_comptes_default
  on public.industrie_client_comptes (client_id, is_default);

create index if not exists idx_documents_commerciaux_compte_client_id
  on public.documents_commerciaux (compte_client_id);

grant select, insert, update, delete on table public.client_comptes to anon, authenticated;
grant select, insert, update, delete on table public.industrie_client_comptes to anon, authenticated;

alter table public.client_comptes enable row level security;
alter table public.industrie_client_comptes enable row level security;

drop policy if exists client_comptes_select_all on public.client_comptes;
create policy client_comptes_select_all
on public.client_comptes
for select
to anon, authenticated
using (true);

drop policy if exists client_comptes_insert_all on public.client_comptes;
create policy client_comptes_insert_all
on public.client_comptes
for insert
to anon, authenticated
with check (true);

drop policy if exists client_comptes_update_all on public.client_comptes;
create policy client_comptes_update_all
on public.client_comptes
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists client_comptes_delete_all on public.client_comptes;
create policy client_comptes_delete_all
on public.client_comptes
for delete
to anon, authenticated
using (true);

drop policy if exists industrie_client_comptes_select_all on public.industrie_client_comptes;
create policy industrie_client_comptes_select_all
on public.industrie_client_comptes
for select
to anon, authenticated
using (true);

drop policy if exists industrie_client_comptes_insert_all on public.industrie_client_comptes;
create policy industrie_client_comptes_insert_all
on public.industrie_client_comptes
for insert
to anon, authenticated
with check (true);

drop policy if exists industrie_client_comptes_update_all on public.industrie_client_comptes;
create policy industrie_client_comptes_update_all
on public.industrie_client_comptes
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists industrie_client_comptes_delete_all on public.industrie_client_comptes;
create policy industrie_client_comptes_delete_all
on public.industrie_client_comptes
for delete
to anon, authenticated
using (true);

create or replace function public.set_client_comptes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_client_comptes_updated_at on public.client_comptes;
create trigger trg_client_comptes_updated_at
before update on public.client_comptes
for each row
execute function public.set_client_comptes_updated_at();

drop trigger if exists trg_industrie_client_comptes_updated_at on public.industrie_client_comptes;
create trigger trg_industrie_client_comptes_updated_at
before update on public.industrie_client_comptes
for each row
execute function public.set_client_comptes_updated_at();

select
  'client_comptes' as table_name,
  count(*) as row_count
from public.client_comptes
union all
select
  'industrie_client_comptes' as table_name,
  count(*) as row_count
from public.industrie_client_comptes;
