-- Controle de coherence des vues rapides dashboard KENTIX.
-- Lecture seule : ne modifie aucune donnee.
-- A lancer apres supabase_dashboard_performance_views.sql.

with params as (
  select 2026::integer as annee
),
old_sales as (
  select
    coalesce(v.commercial_user_id, c.commercial_user_id) as commercial_user_id,
    extract(year from v.date_visite)::integer as annee,
    round(sum(coalesce(vc.quantite, 0)::numeric * coalesce(vc.prix_unitaire, 0)::numeric), 2)::numeric(14,2) as montant
  from public.visite_commandes vc
  join public.visites v on v.id = vc.visite_id
  left join public.clients c on c.id = v.client_id
  join params p on extract(year from v.date_visite)::integer = p.annee
  where coalesce(v.commercial_user_id, c.commercial_user_id) is not null
  group by coalesce(v.commercial_user_id, c.commercial_user_id), extract(year from v.date_visite)::integer
  union all
  select
    coalesce(v.commercial_user_id, c.commercial_user_id) as commercial_user_id,
    extract(year from v.date_visite)::integer as annee,
    round(sum(coalesce(vc.quantite, 0)::numeric * coalesce(vc.prix_unitaire, 0)::numeric), 2)::numeric(14,2) as montant
  from public.industrie_visite_commandes vc
  join public.industrie_visites v on v.id = vc.visite_id
  left join public.industrie_clients c on c.id = v.client_id
  join params p on extract(year from v.date_visite)::integer = p.annee
  where coalesce(v.commercial_user_id, c.commercial_user_id) is not null
  group by coalesce(v.commercial_user_id, c.commercial_user_id), extract(year from v.date_visite)::integer
),
old_sales_total as (
  select commercial_user_id, annee, sum(montant)::numeric(14,2) as montant
  from old_sales
  group by commercial_user_id, annee
),
fast_sales as (
  select d.commercial_user_id, d.annee, sum(d.montant)::numeric(14,2) as montant
  from public.v_kent_dashboard_sales_daily d
  join params p on p.annee = d.annee
  group by d.commercial_user_id, d.annee
),
sales_compare as (
  select
    coalesce(o.commercial_user_id, f.commercial_user_id) as commercial_user_id,
    coalesce(o.annee, f.annee) as annee,
    coalesce(o.montant, 0)::numeric(14,2) as ancien_total,
    coalesce(f.montant, 0)::numeric(14,2) as rapide_total,
    (coalesce(f.montant, 0) - coalesce(o.montant, 0))::numeric(14,2) as ecart
  from old_sales_total o
  full join fast_sales f on f.commercial_user_id = o.commercial_user_id and f.annee = o.annee
),
old_budget as (
  select
    b.commercial_user_id,
    b.annee,
    sum(
      coalesce(bl.jan, 0) + coalesce(bl.feb, 0) + coalesce(bl.mar, 0) +
      coalesce(bl.apr, 0) + coalesce(bl.may, 0) + coalesce(bl.jun, 0) +
      coalesce(bl.jul, 0) + coalesce(bl.aug, 0) + coalesce(bl.sep, 0) +
      coalesce(bl.oct, 0) + coalesce(bl.nov, 0) + coalesce(bl.dec, 0)
    )::numeric(14,2) as montant
  from public.budgets b
  left join public.budget_lignes bl on bl.budget_id = b.id
  join params p on p.annee = b.annee
  where b.statut = 'active'
    and b.commercial_user_id is not null
  group by b.commercial_user_id, b.annee
),
fast_budget as (
  select b.commercial_user_id, b.annee, sum(b.total)::numeric(14,2) as montant
  from public.v_kent_dashboard_budget_summary b
  join params p on p.annee = b.annee
  group by b.commercial_user_id, b.annee
),
budget_compare as (
  select
    coalesce(o.commercial_user_id, f.commercial_user_id) as commercial_user_id,
    coalesce(o.annee, f.annee) as annee,
    coalesce(o.montant, 0)::numeric(14,2) as ancien_total,
    coalesce(f.montant, 0)::numeric(14,2) as rapide_total,
    (coalesce(f.montant, 0) - coalesce(o.montant, 0))::numeric(14,2) as ecart
  from old_budget o
  full join fast_budget f on f.commercial_user_id = o.commercial_user_id and f.annee = o.annee
),
old_real as (
  select
    commercial_user_id,
    annee,
    sum(coalesce(montant, 0))::numeric(14,2) as montant
  from public.v_reel_lignes_actives r
  join params p on p.annee = r.annee
  where commercial_user_id is not null
  group by commercial_user_id, annee
),
fast_real as (
  select r.commercial_user_id, r.annee, sum(r.montant)::numeric(14,2) as montant
  from public.v_kent_dashboard_real_summary r
  join params p on p.annee = r.annee
  group by r.commercial_user_id, r.annee
),
real_compare as (
  select
    coalesce(o.commercial_user_id, f.commercial_user_id) as commercial_user_id,
    coalesce(o.annee, f.annee) as annee,
    coalesce(o.montant, 0)::numeric(14,2) as ancien_total,
    coalesce(f.montant, 0)::numeric(14,2) as rapide_total,
    (coalesce(f.montant, 0) - coalesce(o.montant, 0))::numeric(14,2) as ecart
  from old_real o
  full join fast_real f on f.commercial_user_id = o.commercial_user_id and f.annee = o.annee
)
select
  'ventes_saisies' as controle,
  count(*)::integer as commerciaux_controles,
  count(*) filter (where abs(ecart) > 0.009)::integer as ecarts_detectes,
  sum(ancien_total)::numeric(14,2) as ancien_total,
  sum(rapide_total)::numeric(14,2) as rapide_total,
  sum(ecart)::numeric(14,2) as ecart_total
from sales_compare
union all
select
  'budgets_actifs',
  count(*)::integer,
  count(*) filter (where abs(ecart) > 0.009)::integer,
  sum(ancien_total)::numeric(14,2),
  sum(rapide_total)::numeric(14,2),
  sum(ecart)::numeric(14,2)
from budget_compare
union all
select
  'reel_importe_actif',
  count(*)::integer,
  count(*) filter (where abs(ecart) > 0.009)::integer,
  sum(ancien_total)::numeric(14,2),
  sum(rapide_total)::numeric(14,2),
  sum(ecart)::numeric(14,2)
from real_compare;
