-- Historique des campagnes Action Promo.
-- Safe: cree uniquement deux nouvelles tables.
-- Ne modifie pas les clients, ventes, visites, tarifs, BDC, devis, budgets ou reels existants.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.action_promo_campagnes (
  id uuid primary key default gen_random_uuid(),
  commercial_user_id uuid not null references public.portal_users(id) on delete restrict,
  produit_recherche text not null,
  source_mode text not null default 'validated',
  activity_scope text not null default 'all',
  plaque_filter_key text not null default 'all',
  plaque_filter_label text not null default 'Toutes les plaques',
  period_value text not null default '12',
  min_ca numeric(14, 2) not null default 0,
  nb_clients integer not null default 0,
  total_ca_cible numeric(14, 2) not null default 0,
  statut text not null default 'envoyee' check (statut in ('envoyee')),
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.action_promo_campagne_clients (
  id uuid primary key default gen_random_uuid(),
  campagne_id uuid not null references public.action_promo_campagnes(id) on delete cascade,
  commercial_user_id uuid not null references public.portal_users(id) on delete restrict,
  client_id uuid,
  secteur text not null default 'auto' check (secteur in ('auto', 'industrie')),
  client_nom text not null,
  numero_compte text,
  plaque_id uuid,
  plaque_nom text,
  email text,
  ca_cible numeric(14, 2) not null default 0,
  quantite numeric(14, 2) not null default 0,
  dernier_achat date,
  statut_email text,
  created_at timestamptz not null default now()
);

create index if not exists idx_action_promo_campagnes_commercial
  on public.action_promo_campagnes (commercial_user_id, sent_at desc);

create index if not exists idx_action_promo_campagnes_plaque
  on public.action_promo_campagnes (plaque_filter_key);

create index if not exists idx_action_promo_campagnes_produit
  on public.action_promo_campagnes (produit_recherche);

create index if not exists idx_action_promo_campagne_clients_campagne
  on public.action_promo_campagne_clients (campagne_id);

create index if not exists idx_action_promo_campagne_clients_commercial
  on public.action_promo_campagne_clients (commercial_user_id);

create index if not exists idx_action_promo_campagne_clients_client
  on public.action_promo_campagne_clients (client_nom, numero_compte);

create or replace function public.set_action_promo_campagnes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_action_promo_campagnes_updated_at on public.action_promo_campagnes;
create trigger trg_action_promo_campagnes_updated_at
before update on public.action_promo_campagnes
for each row
execute function public.set_action_promo_campagnes_updated_at();

alter table public.action_promo_campagnes enable row level security;
alter table public.action_promo_campagne_clients enable row level security;

revoke all on table public.action_promo_campagnes from anon, authenticated;
revoke all on table public.action_promo_campagne_clients from anon, authenticated;

grant select, insert, update, delete on table public.action_promo_campagnes to service_role;
grant select, insert, update, delete on table public.action_promo_campagne_clients to service_role;

select
  'action_promo_campagnes' as table_name,
  count(*) as row_count
from public.action_promo_campagnes
union all
select
  'action_promo_campagne_clients',
  count(*)
from public.action_promo_campagne_clients;
