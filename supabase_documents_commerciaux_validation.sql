-- Ajoute le statut Valide / Non valide sur les BDC et devis archives.
-- Ne supprime aucune donnee et ne modifie pas les ventes, clients ou documents PDF.

alter table public.documents_commerciaux
  add column if not exists valide boolean not null default false;

create index if not exists idx_documents_commerciaux_valide
  on public.documents_commerciaux (valide);

select
  'documents_commerciaux.valide' as mise_a_jour,
  count(*) as documents_existants
from public.documents_commerciaux;
