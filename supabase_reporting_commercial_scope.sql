-- Scope commercial pour budgets, projections, entites, reels mensuels et ajustements budget.
-- Safe data: aucune ligne metier n'est supprimee.
-- Effet attendu:
-- - tout l'existant est rattache a Guillaume Garcia;
-- - chaque nouveau commercial aura son propre univers budget/reel/projection/entites;
-- - produits, tarifs, plaques et conditionnements restent des referentiels communs.

begin;

alter table if exists public.budget_entites
  add column if not exists commercial_user_id uuid references public.portal_users(id) on delete restrict,
  add column if not exists commercial_identifier text,
  add column if not exists commercial_name text;

alter table if exists public.budget_projections
  add column if not exists commercial_user_id uuid references public.portal_users(id) on delete restrict,
  add column if not exists commercial_identifier text,
  add column if not exists commercial_name text;

alter table if exists public.budget_projection_lignes
  add column if not exists commercial_user_id uuid references public.portal_users(id) on delete restrict,
  add column if not exists commercial_identifier text,
  add column if not exists commercial_name text;

alter table if exists public.budgets
  add column if not exists commercial_user_id uuid references public.portal_users(id) on delete restrict,
  add column if not exists commercial_identifier text,
  add column if not exists commercial_name text;

alter table if exists public.budget_lignes
  add column if not exists commercial_user_id uuid references public.portal_users(id) on delete restrict,
  add column if not exists commercial_identifier text,
  add column if not exists commercial_name text;

alter table if exists public.reel_imports
  add column if not exists commercial_user_id uuid references public.portal_users(id) on delete restrict,
  add column if not exists commercial_identifier text,
  add column if not exists commercial_name text;

alter table if exists public.reel_lignes
  add column if not exists commercial_user_id uuid references public.portal_users(id) on delete restrict,
  add column if not exists commercial_identifier text,
  add column if not exists commercial_name text;

alter table if exists public.commerce_budget_ajustements
  add column if not exists commercial_user_id uuid references public.portal_users(id) on delete restrict,
  add column if not exists commercial_identifier text,
  add column if not exists commercial_name text;

do $$
declare
  v_commercial_id uuid;
  v_commercial_identifier text;
  v_commercial_name text;
begin
  select id, identifier, display_name
  into v_commercial_id, v_commercial_identifier, v_commercial_name
  from public.portal_users
  where identifier_lookup = lower('Guillaume.Garcia')
  limit 1;

  if v_commercial_id is null then
    raise exception 'Utilisateur Guillaume.Garcia introuvable dans public.portal_users. Cree-le avant de lancer cette migration.';
  end if;

  update public.budget_entites
  set
    commercial_user_id = coalesce(commercial_user_id, v_commercial_id),
    commercial_identifier = coalesce(nullif(commercial_identifier, ''), v_commercial_identifier),
    commercial_name = coalesce(nullif(commercial_name, ''), v_commercial_name)
  where commercial_user_id is null
     or commercial_identifier is null
     or commercial_name is null;

  update public.budget_projections
  set
    commercial_user_id = coalesce(commercial_user_id, v_commercial_id),
    commercial_identifier = coalesce(nullif(commercial_identifier, ''), v_commercial_identifier),
    commercial_name = coalesce(nullif(commercial_name, ''), v_commercial_name)
  where commercial_user_id is null
     or commercial_identifier is null
     or commercial_name is null;

  update public.budget_projection_lignes l
  set
    commercial_user_id = coalesce(l.commercial_user_id, p.commercial_user_id, v_commercial_id),
    commercial_identifier = coalesce(nullif(l.commercial_identifier, ''), p.commercial_identifier, v_commercial_identifier),
    commercial_name = coalesce(nullif(l.commercial_name, ''), p.commercial_name, v_commercial_name)
  from public.budget_projections p
  where l.projection_id = p.id
    and (l.commercial_user_id is null or l.commercial_identifier is null or l.commercial_name is null);

  update public.budgets b
  set
    commercial_user_id = coalesce(b.commercial_user_id, e.commercial_user_id, v_commercial_id),
    commercial_identifier = coalesce(nullif(b.commercial_identifier, ''), e.commercial_identifier, v_commercial_identifier),
    commercial_name = coalesce(nullif(b.commercial_name, ''), e.commercial_name, v_commercial_name)
  from public.budget_entites e
  where b.entite_id = e.id
    and (b.commercial_user_id is null or b.commercial_identifier is null or b.commercial_name is null);

  update public.budget_lignes l
  set
    commercial_user_id = coalesce(l.commercial_user_id, b.commercial_user_id, v_commercial_id),
    commercial_identifier = coalesce(nullif(l.commercial_identifier, ''), b.commercial_identifier, v_commercial_identifier),
    commercial_name = coalesce(nullif(l.commercial_name, ''), b.commercial_name, v_commercial_name)
  from public.budgets b
  where l.budget_id = b.id
    and (l.commercial_user_id is null or l.commercial_identifier is null or l.commercial_name is null);

  update public.reel_imports r
  set
    commercial_user_id = coalesce(r.commercial_user_id, e.commercial_user_id, v_commercial_id),
    commercial_identifier = coalesce(nullif(r.commercial_identifier, ''), e.commercial_identifier, v_commercial_identifier),
    commercial_name = coalesce(nullif(r.commercial_name, ''), e.commercial_name, v_commercial_name)
  from public.budget_entites e
  where r.entite_id = e.id
    and (r.commercial_user_id is null or r.commercial_identifier is null or r.commercial_name is null);

  update public.reel_lignes l
  set
    commercial_user_id = coalesce(l.commercial_user_id, r.commercial_user_id, v_commercial_id),
    commercial_identifier = coalesce(nullif(l.commercial_identifier, ''), r.commercial_identifier, v_commercial_identifier),
    commercial_name = coalesce(nullif(l.commercial_name, ''), r.commercial_name, v_commercial_name)
  from public.reel_imports r
  where l.import_id = r.id
    and (l.commercial_user_id is null or l.commercial_identifier is null or l.commercial_name is null);

  update public.commerce_budget_ajustements
  set
    commercial_user_id = coalesce(commercial_user_id, v_commercial_id),
    commercial_identifier = coalesce(nullif(commercial_identifier, ''), v_commercial_identifier),
    commercial_name = coalesce(nullif(commercial_name, ''), v_commercial_name)
  where commercial_user_id is null
     or commercial_identifier is null
     or commercial_name is null;
end $$;

-- L'ancienne unicite globale sur budget_entites.key bloquerait deux commerciaux
-- qui ont chacun une entite "psa". On la remplace par une unicite par commercial.
do $$
declare
  v_constraint_name text;
begin
  select c.conname
  into v_constraint_name
  from pg_constraint c
  join pg_attribute a
    on a.attrelid = c.conrelid
   and a.attnum = any(c.conkey)
  where c.conrelid = 'public.budget_entites'::regclass
    and c.contype = 'u'
    and a.attname = 'key'
    and array_length(c.conkey, 1) = 1
  limit 1;

  if v_constraint_name is not null then
    execute format('alter table public.budget_entites drop constraint %I', v_constraint_name);
  end if;
end $$;

drop index if exists public.uq_budget_entites_commercial_key;
create unique index uq_budget_entites_commercial_key
  on public.budget_entites (commercial_user_id, key);

create index if not exists idx_budget_entites_commercial
  on public.budget_entites (commercial_user_id, actif, ordre);

create index if not exists idx_budget_projections_commercial_year
  on public.budget_projections (commercial_user_id, annee, created_at desc);

create index if not exists idx_budgets_commercial_year
  on public.budgets (commercial_user_id, annee, statut);

create index if not exists idx_reel_imports_commercial_month
  on public.reel_imports (commercial_user_id, entite_id, annee, mois, statut);

create index if not exists idx_reel_lignes_commercial_import
  on public.reel_lignes (commercial_user_id, import_id);

-- L'ancien upsert global d'ajustements bloquerait les montants par commercial.
alter table if exists public.commerce_budget_ajustements
  drop constraint if exists commerce_budget_ajustements_unique;

drop index if exists public.uq_commerce_budget_ajustements_commercial;
create unique index uq_commerce_budget_ajustements_commercial
  on public.commerce_budget_ajustements (commercial_user_id, annee, mois, secteur, source);

create index if not exists idx_commerce_budget_ajustements_commercial_year
  on public.commerce_budget_ajustements (commercial_user_id, annee, mois);

-- Reconstruit les vues du reel actif avec les colonnes commercial_*.
-- Les vues mensuelles/annuelles dependent de v_reel_lignes_actives: on les
-- supprime puis on les recree pour eviter un DROP CASCADE incomplet.
drop view if exists public.v_reel_annuel_clients;
drop view if exists public.v_reel_annuel_entites;
drop view if exists public.v_reel_mensuel_clients;
drop view if exists public.v_reel_mensuel_entites;
drop view if exists public.v_reel_lignes_actives;

create view public.v_reel_lignes_actives as
select
  l.id,
  l.import_id,
  l.ordre,
  l.client_code,
  l.client_nom,
  l.montant,
  l.mois_source,
  l.date_piece,
  l.reference,
  l.designation,
  l.quantite,
  l.raw_data,
  l.created_at,
  coalesce(l.commercial_user_id, i.commercial_user_id) as commercial_user_id,
  coalesce(l.commercial_identifier, i.commercial_identifier) as commercial_identifier,
  coalesce(l.commercial_name, i.commercial_name) as commercial_name,
  i.entite_id,
  e.key as entite_key,
  e.libelle as entite_libelle,
  i.annee,
  i.mois,
  i.statut as import_statut,
  i.nom as import_nom,
  i.source_file,
  i.sheet_name,
  i.total_mois,
  i.nb_lignes
from public.reel_lignes l
join public.reel_imports i on i.id = l.import_id
left join public.budget_entites e on e.id = i.entite_id
where i.statut = 'active';

create view public.v_reel_annuel_clients as
select
  coalesce(l.commercial_user_id, i.commercial_user_id) as commercial_user_id,
  coalesce(l.commercial_identifier, i.commercial_identifier) as commercial_identifier,
  coalesce(l.commercial_name, i.commercial_name) as commercial_name,
  i.entite_id,
  e.key as entite_key,
  e.libelle as entite_libelle,
  i.annee,
  l.client_code,
  l.client_nom,
  sum(case when i.mois = 1 then l.montant else 0 end)::numeric(14,2) as jan,
  sum(case when i.mois = 2 then l.montant else 0 end)::numeric(14,2) as feb,
  sum(case when i.mois = 3 then l.montant else 0 end)::numeric(14,2) as mar,
  sum(case when i.mois = 4 then l.montant else 0 end)::numeric(14,2) as apr,
  sum(case when i.mois = 5 then l.montant else 0 end)::numeric(14,2) as may,
  sum(case when i.mois = 6 then l.montant else 0 end)::numeric(14,2) as jun,
  sum(case when i.mois = 7 then l.montant else 0 end)::numeric(14,2) as jul,
  sum(case when i.mois = 8 then l.montant else 0 end)::numeric(14,2) as aug,
  sum(case when i.mois = 9 then l.montant else 0 end)::numeric(14,2) as sep,
  sum(case when i.mois = 10 then l.montant else 0 end)::numeric(14,2) as oct,
  sum(case when i.mois = 11 then l.montant else 0 end)::numeric(14,2) as nov,
  sum(case when i.mois = 12 then l.montant else 0 end)::numeric(14,2) as dec,
  sum(l.montant)::numeric(14,2) as total
from public.reel_lignes l
join public.reel_imports i on i.id = l.import_id
left join public.budget_entites e on e.id = i.entite_id
where i.statut = 'active'
group by
  coalesce(l.commercial_user_id, i.commercial_user_id),
  coalesce(l.commercial_identifier, i.commercial_identifier),
  coalesce(l.commercial_name, i.commercial_name),
  i.entite_id,
  e.key,
  e.libelle,
  i.annee,
  l.client_code,
  l.client_nom;

create view public.v_reel_mensuel_clients as
select
  commercial_user_id,
  commercial_identifier,
  commercial_name,
  entite_id,
  entite_key,
  entite_libelle,
  annee,
  mois,
  client_code,
  client_nom,
  sum(montant)::numeric(14,2) as total_mois,
  sum(coalesce(quantite, 0))::numeric(14,2) as quantite_totale,
  count(*)::integer as nb_lignes
from public.v_reel_lignes_actives
group by
  commercial_user_id,
  commercial_identifier,
  commercial_name,
  entite_id,
  entite_key,
  entite_libelle,
  annee,
  mois,
  client_code,
  client_nom;

create view public.v_reel_mensuel_entites as
select
  commercial_user_id,
  commercial_identifier,
  commercial_name,
  entite_id,
  entite_key,
  entite_libelle,
  annee,
  mois,
  sum(montant)::numeric(14,2) as total_mois,
  sum(coalesce(quantite, 0))::numeric(14,2) as quantite_totale,
  count(*)::integer as nb_lignes,
  count(distinct coalesce(nullif(client_code, ''), client_nom))::integer as nb_clients
from public.v_reel_lignes_actives
group by
  commercial_user_id,
  commercial_identifier,
  commercial_name,
  entite_id,
  entite_key,
  entite_libelle,
  annee,
  mois;

create view public.v_reel_annuel_entites as
select
  commercial_user_id,
  commercial_identifier,
  commercial_name,
  entite_id,
  entite_key,
  entite_libelle,
  annee,
  sum(case when mois = 1 then total_mois else 0 end)::numeric(14,2) as jan,
  sum(case when mois = 2 then total_mois else 0 end)::numeric(14,2) as feb,
  sum(case when mois = 3 then total_mois else 0 end)::numeric(14,2) as mar,
  sum(case when mois = 4 then total_mois else 0 end)::numeric(14,2) as apr,
  sum(case when mois = 5 then total_mois else 0 end)::numeric(14,2) as may,
  sum(case when mois = 6 then total_mois else 0 end)::numeric(14,2) as jun,
  sum(case when mois = 7 then total_mois else 0 end)::numeric(14,2) as jul,
  sum(case when mois = 8 then total_mois else 0 end)::numeric(14,2) as aug,
  sum(case when mois = 9 then total_mois else 0 end)::numeric(14,2) as sep,
  sum(case when mois = 10 then total_mois else 0 end)::numeric(14,2) as oct,
  sum(case when mois = 11 then total_mois else 0 end)::numeric(14,2) as nov,
  sum(case when mois = 12 then total_mois else 0 end)::numeric(14,2) as dec,
  sum(total_mois)::numeric(14,2) as total,
  sum(nb_lignes)::integer as nb_lignes,
  sum(nb_clients)::integer as nb_clients_mois_cumules
from public.v_reel_mensuel_entites
group by
  commercial_user_id,
  commercial_identifier,
  commercial_name,
  entite_id,
  entite_key,
  entite_libelle,
  annee;

grant select on public.v_reel_lignes_actives to anon, authenticated;
grant select on public.v_reel_annuel_clients to anon, authenticated;
grant select on public.v_reel_mensuel_clients to anon, authenticated;
grant select on public.v_reel_mensuel_entites to anon, authenticated;
grant select on public.v_reel_annuel_entites to anon, authenticated;

commit;

select
  'reporting_commercial_scope_ready' as status,
  (select count(*) from public.budget_entites where commercial_user_id is not null) as entites_scopees,
  (select count(*) from public.budgets where commercial_user_id is not null) as budgets_scopes,
  (select count(*) from public.reel_imports where commercial_user_id is not null) as imports_reels_scopes,
  (select count(*) from public.reel_lignes where commercial_user_id is not null) as lignes_reelles_scopees;
