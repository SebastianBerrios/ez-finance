-- =============================================================================
-- Migration: ez_finance.account_balances(workspace_id)
--
-- The current balance of every account in a workspace: its opening balance plus
-- the signed sum of every movement it has ever carried (spec §5.3, "el saldo de
-- una cuenta se calcula, no se edita a mano"). There is no balance COLUMN anywhere
-- precisely so nothing can drift out of step with the movements.
--
-- WHY THIS LIVES IN SQL AND NOT IN THE DOMAIN.
-- The sign rule has to exist exactly once, and the earlier plan was to derive it
-- in TypeScript from the data the dashboard already loads. That was wrong: the
-- dashboard loads ONE MONTH, and a balance is the whole history. Deriving it there
-- would have meant loading every transaction a workspace has ever recorded to
-- render a list. So it is one aggregate here, covered by the psql behaviour suite,
-- and there is no second version in TypeScript to disagree with it.
--
-- THE SIGN RULE, stated once:
--   income          -> adds       (money arrived)
--   expense         -> subtracts  (money left)
--   transfer 'in'   -> adds       (this account received it)
--   transfer 'out'  -> subtracts  (this account sent it)
-- base_amount is always a POSITIVE magnitude — the sign belongs to the kind and
-- the leg, never to the number (see the CHECK on the column).
--
-- ARCHIVED ACCOUNTS ARE INCLUDED. Archiving hides an account from the pickers; it
-- does not erase what it holds, and a balance that vanished on archive would be a
-- lie about money that still exists.
-- =============================================================================

begin;

create or replace function ez_finance.account_balances(p_workspace_id uuid)
  returns table (
    account_id      uuid,
    balance         bigint,
    /** Movements counted, so a caller can tell "no movements" from "nets to zero". */
    movement_count  bigint
  )
  language sql
  security invoker
  stable
  set search_path to ''
as $$
  select a.id,
         a.initial_balance + coalesce(sum(
           case
             when t.kind = 'income'                             then  t.base_amount
             when t.kind = 'expense'                            then -t.base_amount
             when t.kind = 'transfer' and t.transfer_leg = 'in'  then  t.base_amount
             when t.kind = 'transfer' and t.transfer_leg = 'out' then -t.base_amount
             -- No ELSE on purpose: the kind CHECK and the shape CHECK make any
             -- other combination unstorable, so a NULL here would mean the schema
             -- changed and this function was not revisited. Better to surface that
             -- as a wrong number in a test than to silently treat it as zero.
           end
         ), 0),
         count(t.id)
  from   ez_finance.accounts a
  left   join ez_finance.transactions t on t.account_id = a.id
  where  a.workspace_id = p_workspace_id
  group  by a.id, a.initial_balance
$$;

-- SECURITY INVOKER, deliberately: the caller's own RLS decides which accounts and
-- transactions are visible, so this cannot become a way to read another
-- workspace's money. A DEFINER would have handed over the owner's rights.
grant execute on function ez_finance.account_balances(uuid) to authenticated;

commit;
