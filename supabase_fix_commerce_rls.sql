-- Fix lecture/ecriture API pour le module commerce (cle anon cote navigateur)
-- Objectif: restaurer l'acces aux tables produits/tarifs/visites/commandes
-- puis verifier si les details de vente existent bien en base.

begin;

-- 1) Permissions SQL de base pour anon/authenticated
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on table
  public.clients,
  public.plaques,
  public.produits,
  public.tarifs_plaques,
  public.visites,
  public.visite_commandes
to anon, authenticated;

grant usage, select on all sequences in schema public to anon, authenticated;

-- 2) Nettoie les policies existantes sur ces tables (evite conflits RLS)
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('clients', 'plaques', 'produits', 'tarifs_plaques', 'visites', 'visite_commandes')
  loop
    execute format('drop policy if exists %I on %I.%I;', p.policyname, p.schemaname, p.tablename);
  end loop;
end
$$;

-- 3) Recree des policies permissives pour l'app web (lecture/ecriture)
do $$
declare
  t text;
begin
  foreach t in array array['clients', 'plaques', 'produits', 'tarifs_plaques', 'visites', 'visite_commandes']
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (true);',
      t || '_select_all',
      t
    );
    execute format(
      'create policy %I on public.%I for insert to anon, authenticated with check (true);',
      t || '_insert_all',
      t
    );
    execute format(
      'create policy %I on public.%I for update to anon, authenticated using (true) with check (true);',
      t || '_update_all',
      t
    );
    execute format(
      'create policy %I on public.%I for delete to anon, authenticated using (true);',
      t || '_delete_all',
      t
    );
  end loop;
end
$$;

commit;

-- 4) Verification rapide apres execution
select 'clients' as table_name, count(*) as row_count from public.clients
union all
select 'plaques', count(*) from public.plaques
union all
select 'produits', count(*) from public.produits
union all
select 'tarifs_plaques', count(*) from public.tarifs_plaques
union all
select 'visites', count(*) from public.visites
union all
select 'visite_commandes', count(*) from public.visite_commandes;

-- 5) Controle des ventes sans lignes detail (doit idealement revenir vide)
select
  v.id as visite_id,
  v.client_id,
  v.date_visite,
  v.total_commande,
  v.note,
  v.type_visite
from public.visites v
left join public.visite_commandes c on c.visite_id = v.id
group by v.id, v.client_id, v.date_visite, v.total_commande, v.note, v.type_visite
having coalesce(v.total_commande, 0) > 0 and count(c.id) = 0
order by v.date_visite desc
limit 200;
