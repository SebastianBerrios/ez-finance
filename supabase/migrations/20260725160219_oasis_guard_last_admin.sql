-- VENDORED from the shared mvp-lab migration history — owned by the Oasis app.
-- Mirrored here (verbatim) only so this repo's local history is a superset of
-- the remote's; `supabase db push` refuses to run otherwise. Do not edit.
--
-- Oasis · never allow the last admin to disappear.
--
-- Now that membership is admin-granted only, admins are the sole way anyone gets
-- into Oasis. Losing the last one is therefore a hard lockout: no account can be
-- created, no role can be changed, and recovery needs direct SQL access. Two
-- ordinary actions could cause it — an admin picking 'reception' for themselves in
-- the Equipo role select, or an admin revoking the other admin and then
-- themselves.
--
-- The invariant belongs in the database, not in the server action: it must hold
-- for every path (app, service_role, SQL editor, `auth.users` cascade), not just
-- the one the UI happens to use today.
--
-- Note the cascade case: `oasis.profiles.id references auth.users(id) on delete
-- cascade`, so deleting the last admin's auth user would cascade into this trigger
-- and fail. That is intended — promote someone else first. It also means another
-- app in the shared `mvp-lab` pool cannot delete an auth user who is Oasis's last
-- admin, which is the correct trade: a lockout is worse than a stuck deletion.

begin;

create or replace function oasis_private.guard_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from oasis.profiles where role = 'admin') then
    raise exception 'Oasis debe tener al menos un administrador';
  end if;
  return null;
end;
$$;

-- AFTER, so the check runs against the post-statement state. Raising here rolls
-- the whole statement back.
create trigger guard_last_admin
  after update or delete on oasis.profiles
  for each row execute function oasis_private.guard_last_admin();

commit;
