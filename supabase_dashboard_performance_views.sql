-- Optimisation des dashboards admin/responsable KENTIX.
-- Script additif : ne supprime aucune donnee metier et ne modifie aucun montant.
-- Objectif : pre-agreger les lectures lourdes pour que les pages admin/responsable chargent vite.

begin;

-- Index de lecture. Ils accelerent les filtres utilises par les dashboards.
do $$
begin
  if to_regclass('public.clients') is not null then
    create index if not exists idx_kent_clients_commercial_dashboard
      on public.clients (commercial_user_id);
  end if;

  if to_regclass('public.industrie_clients') is not null then
    create index if not exists idx_kent_industrie_clients_commercial_dashboard
      on public.industrie_clients (commercial_user_id);
  end if;

  if to_regclass('public.visites') is not null then
    create index if not exists idx_kent_visites_commercial_date_dashboard
      on public.visites (commercial_user_id, date_visite);
    create index if not exists idx_kent_visites_client_date_dashboard
      on public.visites (client_id, date_visite);
  end if;

  if to_regclass('public.industrie_visites') is not null then
    create index if not exists idx_kent_industrie_visites_commercial_date_dashboard
      on public.industrie_visites (commercial_user_id, date_visite);
    create index if not exists idx_kent_industrie_visites_client_date_dashboard
      on public.industrie_visites (client_id, date_visite);
  end if;

  if to_regclass('public.visite_commandes') is not null then
    create index if not exists idx_kent_visite_commandes_visite_dashboard
      on public.visite_commandes (visite_id);
  end if;

  if to_regclass('public.industrie_visite_commandes') is not null then
    create index if not exists idx_kent_industrie_visite_commandes_visite_dashboard
      on public.industrie_visite_commandes (visite_id);
  end if;

  if to_regclass('public.budgets') is not null then
    create index if not exists idx_kent_budgets_dashboard
      on public.budgets (commercial_user_id, annee, statut, entite_id);
  end if;

  if to_regclass('public.budget_lignes') is not null then
    create index if not exists idx_kent_budget_lignes_dashboard
      on public.budget_lignes (budget_id, commercial_user_id);
  end if;

  if to_regclass('public.reel_imports') is not null then
    create index if not exists idx_kent_reel_imports_dashboard
      on public.reel_imports (commercial_user_id, annee, mois, statut, entite_id);
  end if;

  if to_regclass('public.reel_lignes') is not null then
    create index if not exists idx_kent_reel_lignes_dashboard
      on public.reel_lignes (import_id, commercial_user_id);
  end if;

  if to_regclass('public.documents_commerciaux') is not null then
    create index if not exists idx_kent_documents_commercial_date_dashboard
      on public.documents_commerciaux (commercial_user_id, date_document);
  end if;

  if to_regclass('public.action_promo_campagnes') is not null then
    create index if not exists idx_kent_campaigns_commercial_sent_dashboard
      on public.action_promo_campagnes (commercial_user_id, sent_at, created_at);
  end if;

  if to_regclass('public.action_promo_campagne_clients') is not null then
    create index if not exists idx_kent_campaign_clients_campaign_dashboard
      on public.action_promo_campagne_clients (campagne_id, commercial_user_id);
  end if;

  if to_regclass('public.portal_user_relations') is not null then
    create index if not exists idx_kent_relations_responsable_dashboard
      on public.portal_user_relations (responsable_user_id, active, relation_type);
    create index if not exists idx_kent_relations_commercial_dashboard
      on public.portal_user_relations (commercial_user_id, active, relation_type);
  end if;
end $$;

-- Clients par commercial, separes auto/industrie pour garder le meme perimetre qu'avant.
create or replace view public.v_kent_dashboard_clients_total as
select
  c.commercial_user_id,
  'auto'::text as secteur,
  count(*)::integer as clients_total
from public.clients c
where c.commercial_user_id is not null
group by c.commercial_user_id
union all
select
  c.commercial_user_id,
  'industrie'::text as secteur,
  count(*)::integer as clients_total
from public.industrie_clients c
where c.commercial_user_id is not null
group by c.commercial_user_id;

-- Visites mensuelles. Le telephone reste separe et n'est pas compte comme visite terrain.
create or replace view public.v_kent_dashboard_visits_monthly as
with visites_base as (
  select
    'auto'::text as secteur,
    v.id,
    v.client_id,
    coalesce(v.commercial_user_id, c.commercial_user_id) as commercial_user_id,
    v.date_visite::date as date_visite,
    extract(year from v.date_visite)::integer as annee,
    extract(month from v.date_visite)::integer as mois,
    lower(coalesce(v.type_visite, 'vente')) as type_visite,
    upper(coalesce(v.note, '')) as note
  from public.visites v
  left join public.clients c on c.id = v.client_id
  where coalesce(v.commercial_user_id, c.commercial_user_id) is not null
    and v.date_visite is not null
  union all
  select
    'industrie'::text as secteur,
    v.id,
    v.client_id,
    coalesce(v.commercial_user_id, c.commercial_user_id) as commercial_user_id,
    v.date_visite::date as date_visite,
    extract(year from v.date_visite)::integer as annee,
    extract(month from v.date_visite)::integer as mois,
    lower(coalesce(v.type_visite, 'vente')) as type_visite,
    upper(coalesce(v.note, '')) as note
  from public.industrie_visites v
  left join public.industrie_clients c on c.id = v.client_id
  where coalesce(v.commercial_user_id, c.commercial_user_id) is not null
    and v.date_visite is not null
), visites_marquees as (
  select
    *,
    (type_visite = 'commande_telephone' or position('[COMMANDE_TELEPHONE]' in note) > 0) as is_phone_order
  from visites_base
)
select
  commercial_user_id,
  secteur,
  annee,
  mois,
  count(*)::integer as visites_total,
  count(*) filter (where not is_phone_order)::integer as visites_terrain,
  count(*) filter (where is_phone_order)::integer as commandes_telephone,
  count(distinct client_id) filter (where not is_phone_order)::integer as clients_terrain
from visites_marquees
group by commercial_user_id, secteur, annee, mois;

-- Lignes de ventes normalisees auto + industrie.
create or replace view public.v_kent_dashboard_sales_lines as
select
  vc.id,
  v.id as visit_id,
  'auto'::text as source,
  'auto'::text as secteur,
  'Automobile'::text as secteur_label,
  coalesce(v.commercial_user_id, c.commercial_user_id) as commercial_user_id,
  c.id as client_id,
  coalesce(c.nom, 'Client sans nom') as client_nom,
  coalesce(c.numero_compte, '') as numero_compte,
  v.date_visite::date as date,
  extract(year from v.date_visite)::integer as annee,
  extract(month from v.date_visite)::integer as mois,
  lower(coalesce(v.type_visite, 'vente')) as type_visite,
  coalesce(v.note, '') as note,
  coalesce(p.reference_produit, '') as reference,
  coalesce(p.nom, 'Produit sans designation') as designation,
  coalesce(vc.quantite, 0)::numeric as quantite,
  coalesce(vc.prix_unitaire, 0)::numeric as prix_unitaire,
  round((coalesce(vc.quantite, 0)::numeric * coalesce(vc.prix_unitaire, 0)::numeric), 2)::numeric(14,2) as montant
from public.visite_commandes vc
join public.visites v on v.id = vc.visite_id
left join public.clients c on c.id = v.client_id
left join public.produits p on p.id = vc.produit_id
where coalesce(v.commercial_user_id, c.commercial_user_id) is not null
  and v.date_visite is not null
union all
select
  vc.id,
  v.id as visit_id,
  'industrie'::text as source,
  'industrie'::text as secteur,
  'Industrie'::text as secteur_label,
  coalesce(v.commercial_user_id, c.commercial_user_id) as commercial_user_id,
  c.id as client_id,
  coalesce(c.nom, 'Client sans nom') as client_nom,
  coalesce(c.numero_compte, '') as numero_compte,
  v.date_visite::date as date,
  extract(year from v.date_visite)::integer as annee,
  extract(month from v.date_visite)::integer as mois,
  lower(coalesce(v.type_visite, 'vente')) as type_visite,
  coalesce(v.note, '') as note,
  coalesce(p.reference_produit, '') as reference,
  coalesce(p.nom, 'Produit sans designation') as designation,
  coalesce(vc.quantite, 0)::numeric as quantite,
  coalesce(vc.prix_unitaire, 0)::numeric as prix_unitaire,
  round((coalesce(vc.quantite, 0)::numeric * coalesce(vc.prix_unitaire, 0)::numeric), 2)::numeric(14,2) as montant
from public.industrie_visite_commandes vc
join public.industrie_visites v on v.id = vc.visite_id
left join public.industrie_clients c on c.id = v.client_id
left join public.industrie_produits p on p.id = vc.produit_id
where coalesce(v.commercial_user_id, c.commercial_user_id) is not null
  and v.date_visite is not null;

-- Agregat quotidien : le dashboard lit quelques lignes au lieu de toutes les lignes produits.
create or replace view public.v_kent_dashboard_sales_daily as
select
  commercial_user_id,
  secteur,
  date,
  annee,
  mois,
  sum(montant)::numeric(14,2) as montant,
  count(*)::integer as lignes,
  count(distinct visit_id)::integer as ventes
from public.v_kent_dashboard_sales_lines
group by commercial_user_id, secteur, date, annee, mois;

-- Budgets actifs consolides par commercial / entite / annee.
create or replace view public.v_kent_dashboard_budget_summary as
select
  b.commercial_user_id,
  max(coalesce(b.commercial_identifier, '')) as commercial_identifier,
  max(coalesce(b.commercial_name, '')) as commercial_name,
  b.entite_id,
  max(coalesce(e.key, '')) as entite_key,
  max(coalesce(e.libelle, 'Entite')) as entite_libelle,
  b.annee,
  count(distinct b.id)::integer as active_budgets,
  count(bl.id)::integer as lignes,
  sum(coalesce(bl.jan, 0))::numeric(14,2) as jan,
  sum(coalesce(bl.feb, 0))::numeric(14,2) as feb,
  sum(coalesce(bl.mar, 0))::numeric(14,2) as mar,
  sum(coalesce(bl.apr, 0))::numeric(14,2) as apr,
  sum(coalesce(bl.may, 0))::numeric(14,2) as may,
  sum(coalesce(bl.jun, 0))::numeric(14,2) as jun,
  sum(coalesce(bl.jul, 0))::numeric(14,2) as jul,
  sum(coalesce(bl.aug, 0))::numeric(14,2) as aug,
  sum(coalesce(bl.sep, 0))::numeric(14,2) as sep,
  sum(coalesce(bl.oct, 0))::numeric(14,2) as oct,
  sum(coalesce(bl.nov, 0))::numeric(14,2) as nov,
  sum(coalesce(bl.dec, 0))::numeric(14,2) as dec,
  sum(
    coalesce(bl.jan, 0) + coalesce(bl.feb, 0) + coalesce(bl.mar, 0) +
    coalesce(bl.apr, 0) + coalesce(bl.may, 0) + coalesce(bl.jun, 0) +
    coalesce(bl.jul, 0) + coalesce(bl.aug, 0) + coalesce(bl.sep, 0) +
    coalesce(bl.oct, 0) + coalesce(bl.nov, 0) + coalesce(bl.dec, 0)
  )::numeric(14,2) as total
from public.budgets b
left join public.budget_lignes bl on bl.budget_id = b.id
left join public.budget_entites e on e.id = b.entite_id
where b.statut = 'active'
  and b.commercial_user_id is not null
group by b.commercial_user_id, b.entite_id, b.annee;

-- Reel importe consolide par commercial / entite / mois.
create or replace view public.v_kent_dashboard_real_summary as
select
  commercial_user_id,
  max(coalesce(commercial_identifier, '')) as commercial_identifier,
  max(coalesce(commercial_name, '')) as commercial_name,
  entite_id,
  max(coalesce(entite_key, '')) as entite_key,
  max(coalesce(entite_libelle, 'Entite')) as entite_libelle,
  annee,
  mois,
  sum(coalesce(montant, 0))::numeric(14,2) as montant,
  sum(coalesce(quantite, 0))::numeric(14,2) as quantite,
  count(*)::integer as lignes
from public.v_reel_lignes_actives
where commercial_user_id is not null
group by commercial_user_id, entite_id, annee, mois;

grant select on public.v_kent_dashboard_clients_total to anon, authenticated;
grant select on public.v_kent_dashboard_visits_monthly to anon, authenticated;
grant select on public.v_kent_dashboard_sales_lines to anon, authenticated;
grant select on public.v_kent_dashboard_sales_daily to anon, authenticated;
grant select on public.v_kent_dashboard_budget_summary to anon, authenticated;
grant select on public.v_kent_dashboard_real_summary to anon, authenticated;

commit;

select 'dashboard_performance_views_ready' as status;
