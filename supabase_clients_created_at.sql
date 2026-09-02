-- Migration safe : date d'ajout des fiches clients pour la popup "Derniers comptes".
-- Ce script ne supprime aucune table, aucune ligne et aucune donnee.

begin;

alter table if exists public.clients
  add column if not exists created_at timestamptz default now();

alter table if exists public.industrie_clients
  add column if not exists created_at timestamptz default now();

do $$
begin
  if to_regclass('public.clients') is not null then
    create index if not exists idx_clients_created_at_desc
      on public.clients (created_at desc);
  end if;

  if to_regclass('public.industrie_clients') is not null then
    create index if not exists idx_industrie_clients_created_at_desc
      on public.industrie_clients (created_at desc);
  end if;
end $$;

commit;

select
  'clients_created_at_ready' as status,
  'colonnes_created_at_et_index_ok' as detail;
