-- VENDORED from the shared mvp-lab migration history — owned by the Oasis app.
-- Mirrored here (verbatim) only so this repo's local history is a superset of
-- the remote's; `supabase db push` refuses to run otherwise. Do not edit.
--
-- Oasis · close open self-onboarding (membership is now admin-granted only).
--
-- THE BUG THIS FIXES
-- `mvp-lab` shares ONE `auth.users` pool across every app in the fleet, so the
-- `authenticated` role means "any user of any demo app" — it is NOT an
-- authorization boundary. Oasis gated access on "has a row in oasis.profiles",
-- but `profiles_insert_self` let ANY authenticated caller create that row, and
-- `oasis.profiles.role` defaults to 'reception'. A user who signed up in another
-- mvp-lab app and opened Oasis therefore onboarded themselves as staff and got
-- read/write on rooms, guests, reservations and payments.
--
-- THE INVARIANT
-- Authentication is not membership. Membership in an app must be an explicit
-- fact created by an admin of THAT app — never something the user grants
-- themselves by showing up. Oasis is a private, single-property system: accounts
-- are created by an admin (see src/app/actions/staff.ts, which uses the
-- service_role key server-side), so no self-service path should exist at all.
--
-- Non-members are now invisible to Oasis: no INSERT path into oasis.profiles
-- means `oasis_private.user_role()` stays NULL, and every operational policy
-- already requires it to be non-NULL. They can still authenticate (shared pool)
-- but see zero rows; the app routes them to /sin-acceso.
--
-- Data cleanup for the profiles already leaked in, plus promoting the first
-- admin, is a one-off with a human decision in it (which email is the admin).
-- It lives in supabase/scripts/bootstrap-admin.sql, deliberately NOT here.

begin;

-- 1. No self-service membership. Profiles are created by an admin: either
--    through `profiles_admin_all`, or server-side with the service_role key
--    (which bypasses RLS) when the auth user has to be created too.
drop policy if exists profiles_insert_self on oasis.profiles;

-- 2. Only members read the staff directory. The previous policy also allowed
--    `id = auth.uid()`, which was there to let a self-onboarding user read the
--    row they had just inserted. That path is gone, so the branch only widened
--    the surface: it let every user of every mvp-lab app probe oasis.profiles.
drop policy if exists profiles_select on oasis.profiles;

create policy profiles_select on oasis.profiles
  for select to authenticated
  using (oasis_private.user_role() is not null);

commit;

-- Surviving policies on oasis.profiles, for the record:
--   profiles_update_self  -> a member edits their own name/email; the
--                            `guard_role_change` trigger blocks role changes.
--   profiles_admin_all    -> an oasis admin manages every profile.
