-- Postgres grants EXECUTE on new functions to PUBLIC by default, which puts
-- both SECURITY DEFINER functions on the REST endpoint as callable RPCs.
--
-- create_pending_outcome is a trigger body and is never called directly.
-- evaluate_pending_outcomes is driven by pg_cron, which runs as postgres.
-- Neither should be reachable by anon or authenticated.

revoke all on function public.create_pending_outcome() from public, anon, authenticated;
revoke all on function public.evaluate_pending_outcomes(interval) from public, anon, authenticated;
