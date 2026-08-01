-- Validation admin des budgets commerciaux.
-- Safe data:
-- - ajoute uniquement des colonnes de suivi admin;
-- - ne supprime aucune donnee existante;
-- - ne modifie pas les montants ni les lignes budget;
-- - bloque les modifications commerciales sur un budget valide par admin.

begin;

alter table if exists public.budgets
  add column if not exists validation_admin text not null default 'non_valide',
  add column if not exists validation_admin_at timestamptz,
  add column if not exists validation_admin_by text,
  add column if not exists validation_admin_note text;

update public.budgets
set validation_admin = 'non_valide'
where validation_admin is null
   or trim(validation_admin) = '';

alter table if exists public.budgets
  drop constraint if exists budgets_validation_admin_check;

alter table if exists public.budgets
  add constraint budgets_validation_admin_check
  check (validation_admin in ('non_valide', 'valide', 'devalide'));

create index if not exists idx_budgets_admin_validation
  on public.budgets (commercial_user_id, annee, validation_admin, statut);

create or replace function public.prevent_admin_validated_budget_write()
returns trigger
language plpgsql
as $$
declare
  v_role text := coalesce(current_setting('request.jwt.claim.role', true), current_user);
begin
  if v_role = 'service_role' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and (
       new.validation_admin is distinct from old.validation_admin
       or new.validation_admin_at is distinct from old.validation_admin_at
       or new.validation_admin_by is distinct from old.validation_admin_by
       or new.validation_admin_note is distinct from old.validation_admin_note
     ) then
    raise exception 'Validation admin reservee au serveur admin.';
  end if;

  if old.validation_admin = 'valide' then
    raise exception 'Budget valide admin verrouille. Demande une devalidation admin avant modification.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_admin_validated_budget_write on public.budgets;
create trigger trg_prevent_admin_validated_budget_write
before update or delete on public.budgets
for each row execute function public.prevent_admin_validated_budget_write();

create or replace function public.prevent_admin_validated_budget_lines_write()
returns trigger
language plpgsql
as $$
declare
  v_role text := coalesce(current_setting('request.jwt.claim.role', true), current_user);
  v_budget_id uuid;
  v_locked boolean := false;
begin
  if tg_op = 'INSERT' then
    v_budget_id := new.budget_id;
  elsif tg_op = 'UPDATE' then
    v_budget_id := coalesce(new.budget_id, old.budget_id);
  else
    v_budget_id := old.budget_id;
  end if;

  if v_role = 'service_role' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  select exists (
    select 1
    from public.budgets b
    where b.id = v_budget_id
      and b.validation_admin = 'valide'
  )
  into v_locked;

  if v_locked then
    raise exception 'Lignes budget verrouillees par validation admin.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_admin_validated_budget_lines_write on public.budget_lignes;
create trigger trg_prevent_admin_validated_budget_lines_write
before insert or update or delete on public.budget_lignes
for each row execute function public.prevent_admin_validated_budget_lines_write();

commit;

select
  'budget_admin_validation_ready' as status,
  (select count(*) from public.budgets where validation_admin = 'non_valide') as budgets_a_valider,
  (select count(*) from public.budgets where validation_admin = 'valide') as budgets_valides_admin,
  (select count(*) from public.budgets where validation_admin = 'devalide') as budgets_devalides_admin;
