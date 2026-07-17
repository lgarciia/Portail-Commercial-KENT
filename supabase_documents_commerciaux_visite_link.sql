-- Lien BDC / devis -> visite pour afficher le statut dans "Synthese produits".
-- Safe: ajoute uniquement une colonne nullable + index. Aucune donnee existante n'est modifiee.
-- Les anciens documents restent sans lien, volontairement, pour eviter tout rattachement approximatif.

alter table public.documents_commerciaux
  add column if not exists visite_id text;

create index if not exists idx_documents_commerciaux_visite_id
  on public.documents_commerciaux (visite_id);

create index if not exists idx_documents_commerciaux_visite_type
  on public.documents_commerciaux (visite_id, type_document);

select
  'documents_commerciaux_visite_link_ready' as status,
  count(*) filter (where visite_id is not null) as documents_deja_lies
from public.documents_commerciaux;
