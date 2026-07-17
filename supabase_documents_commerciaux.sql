-- Archive BDC / Devis.
-- Cree un bucket Storage prive + une table d'index.
-- Ne modifie pas les ventes, visites, clients, produits, tarifs ou lignes de commande existantes.

create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents-commerciaux',
  'documents-commerciaux',
  false,
  52428800,
  array['application/pdf']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.documents_commerciaux (
  id uuid primary key default gen_random_uuid(),
  secteur text not null check (secteur in ('auto', 'industrie')),
  type_document text not null check (type_document in ('bdc', 'devis')),
  client_id text,
  visite_id text,
  client_nom text not null,
  numero_compte text,
  numero_compte_libelle text,
  compte_client_id uuid,
  date_document date not null,
  nom_fichier text not null,
  storage_bucket text not null default 'documents-commerciaux',
  storage_path text not null unique,
  montant_ht numeric(14, 2) not null default 0,
  numero_document text,
  type_visite text,
  nb_lignes integer not null default 0,
  taille_octets bigint not null default 0,
  valide boolean not null default false,
  statut_validation text not null default 'en_cours',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.documents_commerciaux
  add column if not exists valide boolean not null default false,
  add column if not exists statut_validation text not null default 'en_cours',
  add column if not exists numero_compte_libelle text,
  add column if not exists compte_client_id uuid,
  add column if not exists visite_id text;

update public.documents_commerciaux
set statut_validation = 'valide'
where valide is true
  and statut_validation = 'en_cours';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'documents_commerciaux_statut_validation_check'
      and conrelid = 'public.documents_commerciaux'::regclass
  ) then
    alter table public.documents_commerciaux
      add constraint documents_commerciaux_statut_validation_check
      check (statut_validation in ('en_cours', 'valide', 'non_valide'));
  end if;
end $$;

create index if not exists idx_documents_commerciaux_type
  on public.documents_commerciaux (type_document);

create index if not exists idx_documents_commerciaux_secteur
  on public.documents_commerciaux (secteur);

create index if not exists idx_documents_commerciaux_date
  on public.documents_commerciaux (date_document desc);

create index if not exists idx_documents_commerciaux_client
  on public.documents_commerciaux (client_nom);

create index if not exists idx_documents_commerciaux_valide
  on public.documents_commerciaux (valide);

create index if not exists idx_documents_commerciaux_statut_validation
  on public.documents_commerciaux (statut_validation);

create index if not exists idx_documents_commerciaux_compte_client_id
  on public.documents_commerciaux (compte_client_id);

create index if not exists idx_documents_commerciaux_visite_id
  on public.documents_commerciaux (visite_id);

create index if not exists idx_documents_commerciaux_visite_type
  on public.documents_commerciaux (visite_id, type_document);

grant select, insert, update, delete on table public.documents_commerciaux to anon, authenticated;

alter table public.documents_commerciaux enable row level security;

drop policy if exists documents_commerciaux_select_all on public.documents_commerciaux;
create policy documents_commerciaux_select_all
on public.documents_commerciaux
for select
to anon, authenticated
using (true);

drop policy if exists documents_commerciaux_insert_all on public.documents_commerciaux;
create policy documents_commerciaux_insert_all
on public.documents_commerciaux
for insert
to anon, authenticated
with check (true);

drop policy if exists documents_commerciaux_update_all on public.documents_commerciaux;
create policy documents_commerciaux_update_all
on public.documents_commerciaux
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists documents_commerciaux_delete_all on public.documents_commerciaux;
create policy documents_commerciaux_delete_all
on public.documents_commerciaux
for delete
to anon, authenticated
using (true);

create or replace function public.set_documents_commerciaux_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_documents_commerciaux_updated_at on public.documents_commerciaux;
create trigger trg_documents_commerciaux_updated_at
before update on public.documents_commerciaux
for each row
execute function public.set_documents_commerciaux_updated_at();

drop policy if exists documents_commerciaux_storage_select on storage.objects;
create policy documents_commerciaux_storage_select
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'documents-commerciaux');

drop policy if exists documents_commerciaux_storage_insert on storage.objects;
create policy documents_commerciaux_storage_insert
on storage.objects
for insert
to anon, authenticated
with check (
  bucket_id = 'documents-commerciaux'
  and lower((storage.foldername(name))[1]) in ('auto', 'industrie')
  and lower(right(name, 4)) = '.pdf'
);

drop policy if exists documents_commerciaux_storage_update on storage.objects;
create policy documents_commerciaux_storage_update
on storage.objects
for update
to anon, authenticated
using (bucket_id = 'documents-commerciaux')
with check (bucket_id = 'documents-commerciaux');

drop policy if exists documents_commerciaux_storage_delete on storage.objects;
create policy documents_commerciaux_storage_delete
on storage.objects
for delete
to anon, authenticated
using (bucket_id = 'documents-commerciaux');

select
  'documents_commerciaux' as table_name,
  count(*) as row_count
from public.documents_commerciaux;
