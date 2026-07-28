-- Prospection Industrie KENT.
-- Safe : ce script ajoute uniquement des tables de prospection industrie.
-- Il ne supprime aucune table et ne modifie aucune ligne existante.

begin;

-- Necessaire pour la conversion future : email principal sur les clients industrie.
alter table if exists public.industrie_clients
  add column if not exists email text;

create table if not exists public.industrie_prospects (
  id uuid primary key default gen_random_uuid(),
  commercial_user_id uuid references public.portal_users(id) on delete set null,
  commercial_identifier text,
  commercial_name text,
  nom_entreprise text not null,
  contact_nom text,
  telephone text,
  email text,
  adresse text,
  secteur_activite text,
  source_prospect text,
  statut text not null default 'prospect_identifie',
  priorite text not null default 'normale',
  prochain_contact date,
  potentiel_ca numeric not null default 0,
  probabilite integer not null default 10,
  notes text,
  client_id uuid references public.industrie_clients(id) on delete set null,
  converted_at timestamptz,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint industrie_prospects_statut_chk check (statut in (
    'prospect_identifie',
    'documentation_envoyee',
    'relance_rdv',
    'rdv_planifie',
    'besoin_qualifie',
    'offre_envoyee',
    'converti_client',
    'perdu'
  )),
  constraint industrie_prospects_priorite_chk check (priorite in ('basse', 'normale', 'haute', 'urgente')),
  constraint industrie_prospects_probabilite_chk check (probabilite between 0 and 100),
  constraint industrie_prospects_email_chk check (
    email is null
    or btrim(email) = ''
    or email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
  )
);

create table if not exists public.industrie_prospect_actions (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.industrie_prospects(id) on delete cascade,
  commercial_user_id uuid references public.portal_users(id) on delete set null,
  commercial_identifier text,
  commercial_name text,
  type_action text not null default 'note',
  titre text,
  commentaire text,
  action_at timestamptz not null default now(),
  prochaine_action_date date,
  created_at timestamptz not null default now(),
  constraint industrie_prospect_actions_type_chk check (type_action in (
    'note',
    'appel',
    'email',
    'documentation',
    'relance',
    'rdv',
    'offre',
    'conversion',
    'perte'
  ))
);

create or replace function public.industrie_prospection_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_industrie_prospects_updated_at on public.industrie_prospects;
create trigger trg_industrie_prospects_updated_at
before update on public.industrie_prospects
for each row
execute function public.industrie_prospection_set_updated_at();

create index if not exists idx_industrie_prospects_commercial
  on public.industrie_prospects (commercial_user_id);

create index if not exists idx_industrie_prospects_statut
  on public.industrie_prospects (statut, hidden);

create index if not exists idx_industrie_prospects_prochain_contact
  on public.industrie_prospects (prochain_contact);

create index if not exists idx_industrie_prospects_client
  on public.industrie_prospects (client_id);

create index if not exists idx_industrie_prospect_actions_prospect
  on public.industrie_prospect_actions (prospect_id, action_at desc);

create index if not exists idx_industrie_prospect_actions_commercial
  on public.industrie_prospect_actions (commercial_user_id);

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on table
  public.industrie_prospects,
  public.industrie_prospect_actions
  to anon, authenticated;

alter table public.industrie_prospects enable row level security;
alter table public.industrie_prospect_actions enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'industrie_prospects',
    'industrie_prospect_actions'
  ]
  loop
    execute format('drop policy if exists %I on public.%I;', t || '_select_all', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true);', t || '_select_all', t);

    execute format('drop policy if exists %I on public.%I;', t || '_insert_all', t);
    execute format('create policy %I on public.%I for insert to anon, authenticated with check (true);', t || '_insert_all', t);

    execute format('drop policy if exists %I on public.%I;', t || '_update_all', t);
    execute format('create policy %I on public.%I for update to anon, authenticated using (true) with check (true);', t || '_update_all', t);

    execute format('drop policy if exists %I on public.%I;', t || '_delete_all', t);
    execute format('create policy %I on public.%I for delete to anon, authenticated using (true);', t || '_delete_all', t);
  end loop;
end
$$;

commit;

select 'industrie_prospects' as table_name, count(*) as row_count from public.industrie_prospects
union all
select 'industrie_prospect_actions', count(*) from public.industrie_prospect_actions;
