-- Autorise le nouveau type de saisie "commande_telephone" dans public.visites.
-- A lancer dans Supabase SQL Editor uniquement si l'enregistrement d'une commande telephone est refuse par une contrainte type_visite.

do $$
declare
  check_name text;
begin
  select con.conname
  into check_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'visites'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%type_visite%'
  limit 1;

  if check_name is not null then
    execute format('alter table public.visites drop constraint %I', check_name);
  end if;
end $$;

alter table public.visites
  drop constraint if exists visites_type_visite_check;

alter table public.visites
  add constraint visites_type_visite_check
  check (type_visite in ('vente', 'passage_sans_vente', 'client_ferme', 'commande_telephone'));
