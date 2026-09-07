-- Confidence v2 starts by collecting its inputs, not by inventing a new
-- percentage. The snapshots themselves live in signals.payload so they remain
-- attached to the exact signal and preserve the existing audit trail. This
-- view only reports whether enough *new, feature-complete* outcomes exist to
-- begin calibration; it does not score, filter, or change Telegram behaviour.

create view public.confidence_v2_progress
with (security_invoker = true) as
  with captured as (
    select s.rule_key,
           s.direction,
           i.symbol,
           s.fired_at,
           s.payload->'confidenceV2'->>'modelVersion' as model_version,
           o.status,
           o.pnl_ticks / nullif(s.risk_ticks, 0) as r
      from public.signals s
      join public.instruments i on i.id = s.instrument_id
      join public.signal_outcomes o on o.signal_id = s.id
     where s.payload ? 'confidenceV2'
       and s.payload->'confidenceV2'->>'mode' = 'shadow'
       and s.payload->'confidenceV2'->>'target' = 'positive_r_after_horizon'
  ),
  rolled as (
    select model_version,
           rule_key,
           direction,
           count(*)::integer as captured_signals,
           count(*) filter (where status = 'resolved')::integer as resolved_signals,
           count(distinct symbol) filter (where status = 'resolved')::integer as symbols,
           count(distinct (fired_at at time zone 'UTC')::date)
             filter (where status = 'resolved')::integer as sessions,
           count(*) filter (where status = 'resolved' and r > 0)::integer as wins,
           round(avg(r) filter (where status = 'resolved'), 3) as r_per_trade,
           min(fired_at) as first_captured_at,
           max(fired_at) as last_captured_at
      from captured
     group by 1, 2, 3
  )
  select r.*,
         round(r.wins::numeric / nullif(r.resolved_signals, 0), 4) as win_rate,
         case
           when r.resolved_signals < 30 then 'collecting: need more trades'
           when r.symbols < 2 then 'collecting: need more symbols'
           when r.sessions < 3 then 'collecting: need more sessions'
           else 'ready for offline calibration'
         end as verdict
    from rolled r;

comment on view public.confidence_v2_progress is
  'Readiness of confidence v2 shadow data. It counts only signals whose input features were frozen at signal time. ready for offline calibration is not permission to filter or alter Telegram; a separately versioned model must pass a forward test first.';
