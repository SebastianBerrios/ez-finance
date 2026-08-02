-- =============================================================================
-- Migration: scheduled transactions
--
-- A schedule is a TEMPLATE that produces real transactions on a cadence. It is not a
-- forecast and it is not a separate kind of movement: what it creates is an ordinary
-- row in ez_finance.transactions, indistinguishable from one typed by hand, so every
-- balance, bucket and report already knows what to do with it.
--
-- MONTHLY ONLY, deliberately. Rent, salary and subscriptions are the cases people
-- actually have, and every extra cadence multiplies the ways the due-date arithmetic
-- can be wrong. Weekly can be added when someone needs it; guessing now would mean
-- shipping three code paths and testing one.
--
-- THE HARD PART IS NOT THE TABLE, IT IS RUNNING IT TWICE. A worker that fires twice —
-- a retry, an overlapping cron, a manual poke — must not duplicate January's rent. The
-- watermark below is what makes the second run a no-op, and it is advanced inside the
-- same statement that inserts.
-- =============================================================================

begin;

create table ez_finance.scheduled_transactions (
  id            uuid        primary key default gen_random_uuid(),
  workspace_id  uuid        not null references ez_finance.workspaces(id) on delete cascade,
  account_id    uuid        not null references ez_finance.accounts(id)   on delete restrict,
  category_id   uuid        references ez_finance.categories(id)          on delete restrict,

  -- Transfers are excluded on purpose: a transfer is a tied PAIR written by
  -- record_transfer(), and a scheduler that wrote one leg would corrupt the invariant
  -- the whole transfers design exists to protect.
  kind          text        not null check (kind in ('income', 'expense')),

  base_amount   bigint      not null check (base_amount > 0),
  name          text        not null check (length(btrim(name)) between 1 and 80),
  note          text        check (note is null or length(note) <= 500),

  -- 1–31. Months that are shorter CLAMP to their last day, so "the 31st" means "the
  -- end of the month" in February rather than silently skipping it — see next_due().
  day_of_month  smallint    not null check (day_of_month between 1 and 31),

  -- THE WATERMARK. The date through which this schedule has already been materialised.
  -- NULL means "never run": the first run then starts from the creation date, so a
  -- schedule created today does not retroactively invent every month since the epoch.
  materialised_through date,

  paused_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index scheduled_workspace on ez_finance.scheduled_transactions (workspace_id)
  where paused_at is null;

alter table ez_finance.scheduled_transactions enable row level security;

create trigger scheduled_set_updated_at
  before update on ez_finance.scheduled_transactions
  for each row execute function ez_finance_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- The account and category must belong to the SAME workspace as the schedule.
--
-- RLS does not cover this, for the same reason it does not cover it for goals: the
-- policy checks the SCHEDULE's workspace, and someone with two spaces legitimately sees
-- both spaces' accounts. Without this, a schedule in one space could quietly write
-- transactions against an account in the other, every month, unattended.
-- ---------------------------------------------------------------------------
create or replace function ez_finance_private.scheduled_validate_refs()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
begin
  if not exists (
    select 1 from ez_finance.accounts a
    where a.id = new.account_id and a.workspace_id = new.workspace_id
  ) then
    raise exception 'account_not_in_workspace' using errcode = '23514';
  end if;

  if new.category_id is not null and not exists (
    select 1 from ez_finance.categories c
    where c.id = new.category_id and c.workspace_id = new.workspace_id
  ) then
    raise exception 'category_not_in_workspace' using errcode = '23514';
  end if;

  return new;
end;
$function$;

create trigger scheduled_validate_refs
  before insert or update of account_id, category_id, workspace_id
  on ez_finance.scheduled_transactions
  for each row execute function ez_finance_private.scheduled_validate_refs();

-- ---------------------------------------------------------------------------
-- RLS: read as a member, write as someone who may record movements.
--
-- transacting_ rather than managed_: a schedule produces transactions, so the right to
-- create one is the right to record them — not the narrower right to manage the
-- workspace's structure.
-- ---------------------------------------------------------------------------
create policy scheduled_select_member
  on ez_finance.scheduled_transactions
  for select
  to authenticated
  using (workspace_id in (select ez_finance_private.workspace_ids_for_current_user()));

create policy scheduled_insert_transactor
  on ez_finance.scheduled_transactions
  for insert
  to authenticated
  with check (workspace_id in (select ez_finance_private.transacting_workspace_ids_for_current_user()));

create policy scheduled_update_transactor
  on ez_finance.scheduled_transactions
  for update
  to authenticated
  using      (workspace_id in (select ez_finance_private.transacting_workspace_ids_for_current_user()))
  with check (workspace_id in (select ez_finance_private.transacting_workspace_ids_for_current_user()));

create policy scheduled_delete_transactor
  on ez_finance.scheduled_transactions
  for delete
  to authenticated
  using (workspace_id in (select ez_finance_private.transacting_workspace_ids_for_current_user()));

-- ---------------------------------------------------------------------------
-- The occurrence date in a given month, CLAMPED to that month's length.
--
-- "The 31st" in February means the 28th (or 29th). The alternative — skipping months
-- that are too short — silently drops a rent payment every February, which is the kind
-- of bug that is only noticed at tax time.
-- ---------------------------------------------------------------------------
create or replace function ez_finance_private.occurrence_in_month(
  p_month date,
  p_day   smallint
)
  returns date
  language sql
  immutable
  set search_path to ''
as $function$
  select (date_trunc('month', p_month)
          + (least(
               p_day,
               extract(day from (date_trunc('month', p_month) + interval '1 month - 1 day'))::smallint
             ) - 1) * interval '1 day')::date;
$function$;

-- ---------------------------------------------------------------------------
-- Materialise every occurrence that is due and not yet written.
--
-- CATCH-UP, NOT LATEST-ONLY. The cron runs daily, but a missed week must not silently
-- lose four schedules' worth of movements — so this walks every occurrence from the
-- watermark to today. That is the same lesson process_due_deletions() learned: a job
-- that only handles "now" turns one bad night into permanent lost work.
--
-- IDEMPOTENT BY WATERMARK. Each schedule advances materialised_through in the same
-- statement that inserts its rows, so a second run in the same day finds nothing due.
-- Two concurrent runs cannot double-write either: the row is locked FOR UPDATE SKIP
-- LOCKED, so the loser skips the schedule rather than waiting to duplicate it.
-- ---------------------------------------------------------------------------
create or replace function ez_finance.materialise_due_transactions(p_limit int default 500)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_claims   text;
  v_role     text;
  v_caller   text;
  v_schedule record;
  v_occurs   date;
  v_created  int := 0;
  v_touched  int := 0;
begin
  -- Same identity guard as process_due_deletions: a service_role JWT (the Vercel cron
  -- route), or a direct owner connection with no claims at all. It checks the
  -- CONNECTION, not the presence of a GUC.
  v_claims := pg_catalog.current_setting('request.jwt.claims', true);
  v_role   := case when v_claims is null or v_claims = '' then null
                   else (v_claims::jsonb) ->> 'role' end;

  v_caller := pg_catalog.current_setting('role', true);
  if v_caller is null or v_caller = '' or v_caller = 'none' then
    v_caller := session_user::text;
  end if;

  if not (
       v_role   is not distinct from 'service_role'
    or v_caller = 'service_role'
    or (v_role is null
        and session_user in ('postgres', 'supabase_admin')
        and v_caller     in ('postgres', 'supabase_admin'))
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_limit is null or p_limit <= 0 then
    p_limit := 500;
  end if;

  for v_schedule in
    select s.*
    from   ez_finance.scheduled_transactions s
    where  s.paused_at is null
    order  by s.created_at
    limit  p_limit
    for update of s skip locked
  loop
    -- Start the day AFTER the watermark, or on the creation date for a schedule that
    -- has never run. Without that floor a schedule created today would back-fill every
    -- month since the account existed.
    v_occurs := ez_finance_private.occurrence_in_month(
      coalesce(v_schedule.materialised_through, v_schedule.created_at::date),
      v_schedule.day_of_month
    );

    -- Walk forward month by month. The loop is bounded by current_date, and each
    -- iteration advances a whole month, so it cannot spin.
    while v_occurs <= current_date loop
      if v_occurs > coalesce(v_schedule.materialised_through, v_schedule.created_at::date - 1)
      then
        insert into ez_finance.transactions
          (workspace_id, account_id, category_id, kind, base_amount,
           entered_amount, entered_currency, exchange_rate, occurred_on, note)
        select v_schedule.workspace_id,
               v_schedule.account_id,
               v_schedule.category_id,
               v_schedule.kind,
               v_schedule.base_amount,
               v_schedule.base_amount,
               w.base_currency,
               1,
               v_occurs,
               v_schedule.note
        from   ez_finance.workspaces w
        where  w.id = v_schedule.workspace_id
        and    w.base_currency is not null;

        v_created := v_created + 1;
      end if;

      v_occurs := ez_finance_private.occurrence_in_month(
        (date_trunc('month', v_occurs) + interval '1 month')::date,
        v_schedule.day_of_month
      );
    end loop;

    -- Advance the watermark to TODAY, not to the last occurrence: otherwise a schedule
    -- whose day has not arrived this month would be re-examined from the same point
    -- forever, which is harmless but pointless work every night.
    update ez_finance.scheduled_transactions
    set    materialised_through = current_date
    where  id = v_schedule.id;

    v_touched := v_touched + 1;
  end loop;

  return jsonb_build_object('created', v_created, 'schedules', v_touched);
end;
$function$;

revoke execute on function ez_finance.materialise_due_transactions(int) from public, anon, authenticated;
grant  execute on function ez_finance.materialise_due_transactions(int) to   service_role;

commit;
