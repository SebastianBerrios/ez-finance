-- VENDORED from the shared mvp-lab migration history — owned by the Oasis app.
-- Mirrored here (verbatim) only so this repo's local history is a superset of
-- the remote's; `supabase db push` refuses to run otherwise. Do not edit.
--
-- Oasis · finances are admin-only.
-- Two-role model (admin + reception): reception must NOT see expenses/finances.
-- Dropping expenses_select leaves only expenses_admin_write (for all to admin),
-- so admins keep full access and reception loses read access at the API level.

begin;

drop policy if exists expenses_select on oasis.expenses;

commit;
