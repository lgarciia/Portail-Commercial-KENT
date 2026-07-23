-- Statut BDC / Devis : "Transmis" + statut vide par defaut.
-- Safe : ne supprime aucun document, PDF, client, visite ou vente.
-- Objectif :
-- - les nouveaux documents peuvent commencer sans statut (NULL)
-- - l'action manuelle "Transmis" est acceptee
-- - les anciens statuts "en_cours" restent lisibles en compatibilite

alter table public.documents_commerciaux
  alter column statut_validation drop not null;

alter table public.documents_commerciaux
  alter column statut_validation drop default;

alter table public.documents_commerciaux
  drop constraint if exists documents_commerciaux_statut_validation_check;

alter table public.documents_commerciaux
  add constraint documents_commerciaux_statut_validation_check
  check (
    statut_validation is null
    or statut_validation in ('transmis', 'en_cours', 'valide', 'non_valide')
  );

select
  coalesce(statut_validation, 'sans_statut') as statut_validation,
  count(*) as documents
from public.documents_commerciaux
group by coalesce(statut_validation, 'sans_statut')
order by statut_validation;
