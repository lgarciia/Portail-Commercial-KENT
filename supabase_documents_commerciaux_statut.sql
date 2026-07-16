-- Statut a 3 etats pour BDC / Devis.
-- Safe: ne supprime rien et ne modifie aucun PDF, client, vente ou visite.
-- Les anciens documents valides restent valides, les autres deviennent "en_cours".

alter table public.documents_commerciaux
  add column if not exists statut_validation text not null default 'en_cours';

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

create index if not exists idx_documents_commerciaux_statut_validation
  on public.documents_commerciaux (statut_validation);

select
  statut_validation,
  count(*) as documents
from public.documents_commerciaux
group by statut_validation
order by statut_validation;
