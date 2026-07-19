-- Acces serveur pour la console admin.
-- Safe: ajoute uniquement des droits pour la cle service_role sur les tables portal_*.
-- Aucune donnee metier n'est modifiee.

grant execute on function public.portal_hash_password(text) to service_role;
grant select, insert, update, delete on table public.portal_users to service_role;
grant select, insert, update, delete on table public.portal_user_relations to service_role;
