-- VENDORED from the shared mvp-lab migration history — owned by the Oasis app.
-- Mirrored here (verbatim) only so this repo's local history is a superset of
-- the remote's; `supabase db push` refuses to run otherwise. Do not edit.
--
-- Oasis · property settings (singleton row). Editable by admins from the UI.

begin;

create table oasis.settings (
  -- Boolean singleton guard: only one row (id = true) can ever exist.
  id boolean primary key default true,
  property_name text not null default 'Oasis',
  tagline text not null default 'Hospedaje boutique',
  currency text not null default 'USD',
  locale text not null default 'es',
  updated_at timestamptz not null default now(),
  constraint settings_singleton check (id)
);

insert into oasis.settings (id) values (true) on conflict do nothing;

alter table oasis.settings enable row level security;

-- Any onboarded oasis user can read settings; only admins can change them.
create policy settings_select on oasis.settings
  for select to authenticated using (oasis_private.user_role() is not null);

create policy settings_admin_write on oasis.settings
  for all to authenticated
  using (oasis_private.user_role() = 'admin')
  with check (oasis_private.user_role() = 'admin');

grant all on oasis.settings to anon, authenticated, service_role;

commit;
