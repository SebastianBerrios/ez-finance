-- Oasis · initial schema.
--
-- Oasis is one app inside the shared `mvp-lab` project. It owns two schemas and
-- never touches `public` (except registering itself in the shared auto-RLS
-- registry). See D:\Programming\Frontend\CLAUDE.md and
-- fast-route/supabase/OPERATIONS.md.
--
--   oasis          -> exposed to the Data API (tables, enums)
--   oasis_private  -> NOT exposed (helper functions only)
--
-- Access model note: mvp-lab shares ONE auth.users pool across all apps, so
-- "authenticated" alone is every user of every demo app. Oasis therefore scopes
-- access to users who have an `oasis.profiles` row (via oasis_private.user_role()).
-- Role authz lives in oasis.profiles — NOT in the shared JWT app_metadata, which
-- would collide with other apps' `role` key. There is deliberately NO
-- on_auth_user_created trigger (it would fire for every app's signups); the oasis
-- profile is created lazily by the app on first login. Open self-onboarding as
-- 'reception' is a demo-stage choice — tighten with invites before production.

begin;

-- ---------------------------------------------------------------------------
-- 1. Schemas
-- ---------------------------------------------------------------------------
create schema if not exists oasis;
create schema if not exists oasis_private;

-- ---------------------------------------------------------------------------
-- 2. Register with the shared auto-RLS safety net.
--    The registry table + event trigger already exist on the mvp-lab remote
--    (created by fast-route). `create table if not exists` bridges a clean local
--    DB (`db reset`) where they do not exist yet; on remote it is a no-op. The
--    insert is idempotent. RLS is still enabled explicitly on every table below.
-- ---------------------------------------------------------------------------
create table if not exists public.rls_managed_schemas (
  schema_name text primary key
);
insert into public.rls_managed_schemas (schema_name) values ('oasis')
  on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Enums (mirror src/lib/domain/types.ts)
-- ---------------------------------------------------------------------------
create type oasis.room_status as enum ('available','occupied','reserved','cleaning','maintenance');
create type oasis.room_type as enum ('individual','doble','twin','suite','familiar');
create type oasis.reservation_channel as enum ('airbnb','booking','direct');
create type oasis.reservation_status as enum ('confirmed','pending','checked_in','checked_out','cancelled');
create type oasis.payment_method as enum ('cash','card','transfer','platform');
create type oasis.payment_type as enum ('charge','deposit','refund');
create type oasis.expense_category as enum ('utilities','supplies','maintenance','staff','platform_fees','other');
create type oasis.user_role as enum ('admin','reception','housekeeping');
create type oasis.housekeeping_issue as enum ('towels','sheets','toiletries','cleaning','lightbulb','minibar','other');

-- ---------------------------------------------------------------------------
-- 4. Tables
-- ---------------------------------------------------------------------------
create table oasis.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text,
  role oasis.user_role not null default 'reception',
  created_at timestamptz not null default now()
);

create table oasis.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  floor int not null default 1,
  type oasis.room_type not null default 'doble',
  capacity int not null default 2,
  base_price numeric(10,2) not null default 0,
  status oasis.room_status not null default 'available',
  amenities text[] not null default '{}',
  missing_items oasis.housekeeping_issue[] not null default '{}',
  notes text,
  created_at timestamptz not null default now()
);

create table oasis.guests (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  document_id text,
  country text,
  notes text,
  created_at timestamptz not null default now()
);

create table oasis.reservations (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references oasis.rooms(id) on delete restrict,
  guest_id uuid not null references oasis.guests(id) on delete restrict,
  check_in date not null,
  check_out date not null,
  channel oasis.reservation_channel not null default 'direct',
  status oasis.reservation_status not null default 'confirmed',
  guests_count int not null default 1,
  total_amount numeric(10,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  constraint reservations_dates_check check (check_out > check_in)
);
create index reservations_room_idx on oasis.reservations (room_id);
create index reservations_guest_idx on oasis.reservations (guest_id);
create index reservations_dates_idx on oasis.reservations (check_in, check_out);

-- amount_paid is derived from payments (summed in the app layer), not stored.
create table oasis.payments (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references oasis.reservations(id) on delete cascade,
  amount numeric(10,2) not null,
  method oasis.payment_method not null default 'cash',
  type oasis.payment_type not null default 'charge',
  paid_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);
create index payments_reservation_idx on oasis.payments (reservation_id);

create table oasis.expenses (
  id uuid primary key default gen_random_uuid(),
  category oasis.expense_category not null default 'other',
  amount numeric(10,2) not null,
  spent_on date not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. Role helper (oasis_private, SECURITY DEFINER to avoid RLS recursion when
--    read from policies). Returns the caller's oasis role, or NULL if the caller
--    has no oasis profile (i.e. is not an oasis user).
-- ---------------------------------------------------------------------------
create or replace function oasis_private.user_role()
returns oasis.user_role
language sql
security definer
set search_path to ''
stable
as $$
  select role from oasis.profiles where id = (select auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- 6. Row Level Security
-- ---------------------------------------------------------------------------
alter table oasis.profiles enable row level security;
alter table oasis.rooms enable row level security;
alter table oasis.guests enable row level security;
alter table oasis.reservations enable row level security;
alter table oasis.payments enable row level security;
alter table oasis.expenses enable row level security;

-- Profiles: oasis staff can read the directory; users create/edit their own row
-- (lazy onboarding); admins manage everyone.
create policy profiles_select on oasis.profiles
  for select to authenticated using (oasis_private.user_role() is not null or id = (select auth.uid()));
create policy profiles_insert_self on oasis.profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update_self on oasis.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy profiles_admin_all on oasis.profiles
  for all to authenticated
  using (oasis_private.user_role() = 'admin')
  with check (oasis_private.user_role() = 'admin');

-- Operational tables: any onboarded oasis user (has a profile) has full access.
create policy rooms_all on oasis.rooms
  for all to authenticated
  using (oasis_private.user_role() is not null)
  with check (oasis_private.user_role() is not null);
create policy guests_all on oasis.guests
  for all to authenticated
  using (oasis_private.user_role() is not null)
  with check (oasis_private.user_role() is not null);
create policy reservations_all on oasis.reservations
  for all to authenticated
  using (oasis_private.user_role() is not null)
  with check (oasis_private.user_role() is not null);
create policy payments_all on oasis.payments
  for all to authenticated
  using (oasis_private.user_role() is not null)
  with check (oasis_private.user_role() is not null);

-- Expenses / finances: admin + reception read; only admin writes.
create policy expenses_select on oasis.expenses
  for select to authenticated
  using (oasis_private.user_role() in ('admin','reception'));
create policy expenses_admin_write on oasis.expenses
  for all to authenticated
  using (oasis_private.user_role() = 'admin')
  with check (oasis_private.user_role() = 'admin');

-- ---------------------------------------------------------------------------
-- 7. Grants
--
-- oasis is EXPOSED to the Data API: mirror the Supabase custom-schema pattern
-- used by fast_route. RLS above is what actually gates rows; these grants only
-- make the schema reachable through PostgREST.
-- ---------------------------------------------------------------------------
grant usage on schema oasis to anon, authenticated, service_role;
grant all on all tables    in schema oasis to anon, authenticated, service_role;
grant all on all routines  in schema oasis to anon, authenticated, service_role;
grant all on all sequences in schema oasis to anon, authenticated, service_role;

alter default privileges for role postgres in schema oasis
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema oasis
  grant all on routines to anon, authenticated, service_role;
alter default privileges for role postgres in schema oasis
  grant all on sequences to anon, authenticated, service_role;

-- oasis_private is NOT exposed to the Data API. authenticated needs USAGE +
-- EXECUTE only so the SECURITY DEFINER user_role() can be resolved when RLS
-- policies evaluate it; it is unreachable via PostgREST (not in db_schemas).
grant usage on schema oasis_private to authenticated, service_role;
grant execute on function oasis_private.user_role() to authenticated, service_role;

commit;
