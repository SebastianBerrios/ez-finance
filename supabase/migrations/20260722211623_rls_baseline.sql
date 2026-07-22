-- Baseline RLS posture for ez-finance. NO feature tables yet.
-- Establishes the deny-by-default convention every future migration MUST follow:
--   1) ALTER TABLE <t> ENABLE ROW LEVEL SECURITY on every table in exposed schemas.
--   2) No policy = deny all. Add explicit workspace-scoped policies per feature.
--   3) Authorization data lives in raw_app_meta_data (NEVER raw_user_meta_data / user_metadata).
--   4) Views MUST use WITH (security_invoker = true).
--   5) security definer functions live in a private (unexposed) schema, never public.
-- Enforce that the public schema is not blanket-exposed by accident:
revoke all on schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;
-- Default privileges: new tables in public grant NOTHING implicitly to anon/authenticated;
-- each feature migration grants the minimum needed AND enables RLS.
alter default privileges in schema public revoke all on tables from anon, authenticated;
