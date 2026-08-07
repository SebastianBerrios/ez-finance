-- ===========================================================================
-- Transfer legs are not updatable.
--
-- WHY THIS EXISTS. 20260728174500 gave transactions three write policies. The
-- INSERT one refuses kind = 'transfer', because a single leg is a broken pair and
-- no row-level policy can require its sibling — record_transfer() writes both in
-- one statement instead. The UPDATE policy was written without that clause, and
-- that is the hole: the author of a transfer could raise base_amount on the 'out'
-- leg alone, and the 'in' leg would keep its old figure. Money would leave an
-- account at one amount and arrive at another, with every CHECK on the table still
-- satisfied — transactions_kind_shape constrains the SHAPE of a leg, never the
-- agreement between the two.
--
-- Nothing in the app could reach it: no code path issued an UPDATE at all. The
-- movement edit screen is the first one, which is why this lands with it rather
-- than after it.
--
-- WHY A POLICY AND NOT A TRIGGER. The rule is "who may change which rows", which
-- is what a policy is for. Adding kind <> 'transfer' to USING excludes a leg from
-- the rows an UPDATE can even match, so the statement affects zero rows and raises
-- nothing — the same shape every other refusal here has, and the count is what the
-- adapter already reads to tell "saved" from "not yours".
--
-- The clause is repeated in WITH CHECK for the other direction: without it, an
-- expense could be UPDATEd into kind = 'transfer'. That particular attempt would
-- fail on transactions_kind_shape today (a transfer needs transfer_id,
-- transfer_leg and counter_account_id, and an expense has none of them), so this
-- half is defence in depth rather than a live hole — but relying on a CHECK
-- constraint to enforce an authorisation rule is how the first hole happened.
--
-- Editing a transfer coherently means changing BOTH legs in one statement, which
-- belongs in an RPC beside record_transfer/delete_transfer. Until that exists the
-- app answers "delete the pair and record it again", and this policy is what makes
-- that answer true instead of merely advisory.
-- ===========================================================================

drop policy if exists transactions_update_author on ez_finance.transactions;

create policy transactions_update_author
  on ez_finance.transactions
  for update
  to authenticated
  using      (
    workspace_id in (select ez_finance_private.transacting_workspace_ids_for_current_user())
    and created_by = (select auth.uid())
    and kind <> 'transfer'
  )
  with check (
    workspace_id in (select ez_finance_private.transacting_workspace_ids_for_current_user())
    and created_by = (select auth.uid())
    and kind <> 'transfer'
  );
