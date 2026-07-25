-- VENDORED from the shared mvp-lab migration history — owned by the Oasis app.
-- Mirrored here (verbatim) only so this repo's local history is a superset of
-- the remote's; `supabase db push` refuses to run otherwise. Do not edit.
--
-- Oasis · prevent privilege escalation via profile self-update.
-- profiles_update_self lets a user edit their own row (name/email during lazy
-- onboarding), but that also allowed changing `role`. This trigger blocks role
-- changes unless the caller is an oasis admin. Updates with no auth context
-- (service_role / SQL editor / postgres) are allowed, so the initial admin can
-- still be set via SQL.

begin;

create or replace function oasis_private.guard_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role
     and (select auth.uid()) is not null
     and coalesce(oasis_private.user_role(), 'reception'::oasis.user_role) <> 'admin' then
    raise exception 'Solo un administrador puede cambiar roles';
  end if;
  return new;
end;
$$;

create trigger guard_role_change
  before update on oasis.profiles
  for each row execute function oasis_private.guard_role_change();

commit;
