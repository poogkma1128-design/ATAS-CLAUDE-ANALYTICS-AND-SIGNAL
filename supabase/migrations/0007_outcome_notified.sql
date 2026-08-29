-- Marks which resolved outcomes have already been reported back to Telegram,
-- so the result reply is sent exactly once per signal.

alter table public.signal_outcomes
  add column notified_at timestamptz;

create index signal_outcomes_unnotified_idx
  on public.signal_outcomes (status)
  where status = 'resolved' and notified_at is null;
