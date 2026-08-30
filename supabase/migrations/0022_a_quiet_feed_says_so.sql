-- Tell someone when the data stops, instead of waiting to be asked.
--
-- instrument_status already knows whether a chart is still posting, and the
-- dashboard already shows it. That only helps someone who thinks to look. On
-- 29 August ATAS stopped posting for about eight hours and nothing said so:
-- the signals simply stopped, which is exactly what a quiet market also looks
-- like. Silence is the one failure this system cannot distinguish from
-- success on its own.
--
-- The check cannot live in `ingest`, because ingest only runs when the bridge
-- is posting — the thing that would notice is the thing that stopped. So it
-- runs on pg_cron, which keeps its own clock.

create table public.feed_alerts (
  symbol      text not null,
  timeframe   text not null,
  -- The state the owner was last told about, not the state right now. The
  -- difference between the two is the only thing worth sending a message about.
  told_state  text not null check (told_state in ('live', 'quiet')),
  told_at     timestamptz not null default now(),
  primary key (symbol, timeframe)
);

comment on table public.feed_alerts is
  'What the owner was last told about each chart. A row differing from instrument_status.feed is an unsent notice; keeping it here is what stops the same outage being announced every five minutes.';

alter table public.feed_alerts enable row level security;

-- No policy: service role only, like runner_tokens. Nothing on the dashboard
-- reads this, and the state of the alerter is not the state of the feed.

-- ------------------------------------------------------------------ trigger

-- Fires the watcher. Same shape as run_backtest: the token lives in the vault
-- and never appears in the schedule, and pg_net makes the call so Postgres is
-- not holding a connection open while Telegram answers.
create or replace function public.notify_feed_health()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  base    text;
  token   text;
  request bigint;
begin
  select decrypted_secret into base
    from vault.decrypted_secrets where name = 'functions_base_url';
  select decrypted_secret into token
    from vault.decrypted_secrets where name = 'backtest_runner_token';

  if base is null or token is null then
    raise exception 'vault is missing functions_base_url or backtest_runner_token';
  end if;

  select net.http_post(
           url     := base || '/feed-watch',
           headers := jsonb_build_object(
                        'Content-Type',  'application/json',
                        'Authorization', 'Bearer ' || token
                      ),
           body    := '{}'::jsonb
         )
    into request;

  return request;
end;
$$;

revoke all on function public.notify_feed_health() from public, anon, authenticated;

comment on function public.notify_feed_health() is
  'Asks the feed-watch function to compare every chart against what was last announced, and to say so if it differs. Scheduled every five minutes.';

-- Five minutes is chosen against the shortest timeframe in use: a 5m chart that
-- has missed three bars is already fifteen minutes quiet, so this notices
-- within a bar of the state itself changing, and never sooner than the state.
select cron.schedule(
  'feed-health-watch',
  '*/5 * * * *',
  $cron$ select public.notify_feed_health(); $cron$
);
