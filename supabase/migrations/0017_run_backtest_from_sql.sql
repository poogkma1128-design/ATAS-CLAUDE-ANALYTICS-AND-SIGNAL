-- Starting a backtest from inside the database.
--
-- The runner has to be startable by a scheduled job, so experiments keep going
-- while the market is closed. That job cannot present the ingest token: it lives
-- only in the edge function's environment and is not readable from SQL.
--
-- So the key lives in vault and pg_net does the call. The token never appears in
-- a job definition, a query, or a log line — only the name of the secret does.
--
-- Two vault secrets have to exist before this works. They are created once, by
-- hand, and deliberately not in this migration, because one of them is generated
-- and a migration file is a place secrets must never end up:
--
--   select vault.create_secret(
--            'https://<project-ref>.supabase.co/functions/v1', 'functions_base_url');
--   select vault.create_secret(
--            public.issue_runner_token('scheduled backtest runner'),
--            'backtest_runner_token');

create extension if not exists pg_net;

create or replace function public.run_backtest(body jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  base   text;
  token  text;
  req_id bigint;
begin
  select decrypted_secret into base
    from vault.decrypted_secrets where name = 'functions_base_url';
  select decrypted_secret into token
    from vault.decrypted_secrets where name = 'backtest_runner_token';

  if base is null or token is null then
    raise exception 'run_backtest is not configured: vault needs functions_base_url and backtest_runner_token';
  end if;

  -- pg_net is fire-and-forget: this returns as soon as the request is queued,
  -- and the reply lands in net._http_response. A timeout here therefore loses
  -- the reply, never the experiment -- the function still finishes and still
  -- writes its results.
  select net.http_post(
    url := base || '/backtest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || token
    ),
    body := body,
    timeout_milliseconds := 120000
  ) into req_id;

  return req_id;
end;
$$;

comment on function public.run_backtest(jsonb) is
  'Starts a backtest from SQL. The key lives in vault, so a scheduled job can run experiments without the token ever appearing in a job definition or a query.';

revoke all on function public.run_backtest(jsonb) from public, anon, authenticated;
