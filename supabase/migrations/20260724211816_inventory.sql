-- VENDORED from the shared mvp-lab migration history — owned by the Oasis app.
-- Mirrored here (verbatim) only so this repo's local history is a superset of
-- the remote's; `supabase db push` refuses to run otherwise. Do not edit.
--
-- Oasis · inventory module (simple stock with low-stock alerts).
-- Lives in the oasis schema; RLS on; any onboarded oasis user can manage stock.

begin;

create type oasis.inventory_category as enum ('linens', 'amenities', 'cleaning', 'kitchen', 'other');

create table oasis.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category oasis.inventory_category not null default 'other',
  quantity int not null default 0,
  min_quantity int not null default 0,
  unit text not null default 'unidades',
  notes text,
  created_at timestamptz not null default now()
);

alter table oasis.inventory_items enable row level security;

-- Any onboarded oasis user (has a profile) can read and manage stock.
create policy inventory_all on oasis.inventory_items
  for all to authenticated
  using (oasis_private.user_role() is not null)
  with check (oasis_private.user_role() is not null);

-- Grants (mirror the schema pattern; default privileges already cover this, but
-- we grant explicitly for safety on the shared remote).
grant all on oasis.inventory_items to anon, authenticated, service_role;

commit;
