-- Three phones buzzing for one trade, because nobody claimed the work.
--
-- flushOutcomeNotifications() read the unnotified outcomes, sent them, and
-- only then stamped notified_at. It runs at the end of every ingest, and four
-- charts post independently, so several ingests overlap constantly: each one
-- read the same unstamped rows before any of them wrote, each one sent, and
-- the same result arrived two or three times. Nothing in the data was wrong --
-- the rows were correct and stamped exactly once. Only the sending doubled.
--
-- The announcement path never had this problem, and the difference is worth
-- naming: signals are inserted with ignoreDuplicates against a unique key, so
-- a concurrent ingest gets back an empty set and announces nothing. The claim
-- is made by the write itself. Here the write came last, so there was no claim
-- at all.
--
-- This makes the stamp the claim. The row is marked inside the same statement
-- that selects it, under FOR UPDATE SKIP LOCKED, so a second caller arriving
-- mid-flight takes the next unclaimed row or none -- never the same one.
--
-- The cost is the mirror risk: a claimed row whose send then fails would be
-- marked as told when nobody was told. The caller un-claims those (it knows
-- which sends returned null), which covers the ordinary failure. A hard crash
-- between claim and send would still lose that reply, and that is the trade
-- being made deliberately: one lost reply on a crash is recoverable from the
-- dashboard, whereas every result arriving three times trains you to stop
-- reading them, which loses all of them.
create or replace function public.claim_outcome_notifications(
  max_rows integer default 20
)
returns table (
  signal_id           uuid,
  pnl_ticks           numeric,
  mfe_ticks           numeric,
  mae_ticks           numeric,
  bars_used           integer,
  exit_reason         text,
  seq                 bigint,
  direction           text,
  symbol              text,
  timeframe           text,
  telegram_message_id bigint,
  entry_price         numeric,
  stop_price          numeric,
  risk_ticks          numeric
)
language sql
as $$
  with claimed as (
    select o.signal_id
      from public.signal_outcomes o
     where o.status = 'resolved'
       and o.notified_at is null
     order by o.signal_id
     for update skip locked
     limit greatest(1, max_rows)
  ),
  marked as (
    update public.signal_outcomes o
       set notified_at = now()
      from claimed c
     where o.signal_id = c.signal_id
    returning o.signal_id, o.pnl_ticks, o.mfe_ticks, o.mae_ticks,
              o.bars_used, o.exit_reason
  )
  select m.signal_id, m.pnl_ticks, m.mfe_ticks, m.mae_ticks,
         m.bars_used, m.exit_reason,
         s.seq, s.direction, i.symbol, s.timeframe,
         s.telegram_message_id, s.entry_price, s.stop_price, s.risk_ticks
    from marked m
    join public.signals s on s.id = m.signal_id
    left join public.instruments i on i.id = s.instrument_id;
$$;

comment on function public.claim_outcome_notifications(integer) is
  'Atomically marks up to max_rows resolved-but-unnotified outcomes as notified and returns them with everything the Telegram reply needs. The stamp is the claim: concurrent ingests cannot both take the same row, which is what stopped one result being announced three times. A caller whose send fails must set notified_at back to null for that row.';

-- This function both mutates and hands back the trade detail, and the anon key
-- is published inside the web bundle (rule 16). Only the service role, which
-- is what the edge functions carry, has any business calling it.
revoke execute on function public.claim_outcome_notifications(integer)
  from anon, authenticated, public;
