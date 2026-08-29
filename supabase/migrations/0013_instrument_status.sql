-- Whether each chart is actually feeding, and if not, what it is doing instead.
--
-- The dashboard showed signals without ever saying where they came from or
-- whether anything was still arriving, so a quiet feed looked identical to a
-- market with nothing to say. On a Saturday that is exactly wrong: BTCUSDT
-- trades around the clock and keeps posting, while NQ, MNQ and GC are closed
-- and post nothing at all. Reading the feed alone, the futures look broken.
--
-- The distinction is already in the data and needs no new plumbing. The
-- indicator posts one bar as it closes, and its whole visible history in one
-- batch when it loads. So a recent single-bar request means a live chart, and
-- a multi-bar request with nothing since means a chart that loaded, sent its
-- history, and then had nothing further to send.
--
-- Nothing here judges whether that is a problem. It reports what arrived and
-- when, and leaves the reading to whoever knows what day it is.
drop view if exists public.instrument_status;

create view public.instrument_status
with (security_invoker = true) as
  with feed as (
    select symbol,
           timeframe,
           max(received_at)                                        as last_ingest_at,
           max(received_at) filter (where bars_count = 1)          as last_live_at,
           max(received_at) filter (where bars_count > 1)          as last_backfill_at,
           count(*) filter (where received_at > now() - interval '1 hour')     as requests_1h,
           count(*) filter (where error is not null
                              and received_at > now() - interval '24 hours')   as errors_24h,
           max(error) filter (where error is not null)             as last_error
      from public.ingest_log
     where symbol is not null and timeframe is not null
     group by 1, 2
  ),
  charted as (
    select i.symbol,
           b.timeframe,
           max(b.opened_at)                       as last_bar_at,
           count(*)::integer                      as bars,
           -- '5m' -> 5, '15m' -> 15, '1h' -> 60. An unrecognised label falls
           -- back to five minutes rather than guessing something wilder.
           case
             when b.timeframe ~ '^[0-9]+m$' then substring(b.timeframe from '^[0-9]+')::integer
             when b.timeframe ~ '^[0-9]+h$' then substring(b.timeframe from '^[0-9]+')::integer * 60
             else 5
           end                                    as tf_minutes
      from public.bars b
      join public.instruments i on i.id = b.instrument_id
     group by 1, 2, b.timeframe
  ),
  tallied as (
    select i.symbol,
           s.timeframe,
           count(*)::integer                                      as signals,
           count(*) filter (where s.telegram_message_id is not null)::integer as announced,
           count(*) filter (where s.muted)::integer               as muted,
           max(s.fired_at)                                        as last_signal_at
      from public.signals s
      join public.instruments i on i.id = s.instrument_id
     group by 1, 2
  )
  select coalesce(c.symbol, f.symbol)       as symbol,
         coalesce(c.timeframe, f.timeframe) as timeframe,
         c.bars,
         c.last_bar_at,
         f.last_ingest_at,
         f.last_live_at,
         f.last_backfill_at,
         f.requests_1h,
         f.errors_24h,
         f.last_error,
         coalesce(t.signals, 0)   as signals,
         coalesce(t.announced, 0) as announced,
         coalesce(t.muted, 0)     as muted,
         t.last_signal_at,
         -- How far behind the chart's own clock the newest stored bar is. Small
         -- means the chart is keeping up; hours mean it is showing an old
         -- session, which is what a closed market looks like.
         round(extract(epoch from (now() - c.last_bar_at)) / 60)::integer as bar_age_minutes,
         round(extract(epoch from (now() - f.last_ingest_at)) / 60)::integer as quiet_minutes,
         case
           -- Live is judged against the timeframe rather than a fixed clock:
           -- three bars of silence is late on a 5m chart and nothing on 1h.
           when f.last_live_at is not null
            and f.last_live_at > now() - make_interval(mins => coalesce(c.tf_minutes, 5) * 3)
             then 'live'
           when f.last_ingest_at is not null
            and f.last_ingest_at > now() - interval '24 hours'
             then 'history-only'
           else 'silent'
         end as feed
    from charted c
    full join feed f on f.symbol = c.symbol and f.timeframe = c.timeframe
    left join tallied t on t.symbol = coalesce(c.symbol, f.symbol)
                       and t.timeframe = coalesce(c.timeframe, f.timeframe);

comment on view public.instrument_status is
  'Per chart: what arrived, when, and whether it is still arriving. feed is live (a single closed bar within three bar-periods), history-only (a startup batch and nothing since), or silent (nothing for a day). A chart that has never posted has no row at all.';
