-- Row level security.
--
-- The ingest Edge Function connects with the service_role key, which bypasses
-- RLS entirely. Everything below is about the dashboard: a signed-in user gets
-- read access, plus the ability to tune rule thresholds. Anonymous visitors get
-- nothing, so the signal feed is never public.

alter table public.instruments     enable row level security;
alter table public.bars            enable row level security;
alter table public.cluster_levels  enable row level security;
alter table public.rules           enable row level security;
alter table public.signals         enable row level security;
alter table public.signal_outcomes enable row level security;
alter table public.ingest_log      enable row level security;

create policy "authenticated read instruments"
  on public.instruments for select to authenticated using (true);

create policy "authenticated read bars"
  on public.bars for select to authenticated using (true);

create policy "authenticated read cluster_levels"
  on public.cluster_levels for select to authenticated using (true);

create policy "authenticated read signals"
  on public.signals for select to authenticated using (true);

create policy "authenticated read signal_outcomes"
  on public.signal_outcomes for select to authenticated using (true);

create policy "authenticated read ingest_log"
  on public.ingest_log for select to authenticated using (true);

create policy "authenticated read rules"
  on public.rules for select to authenticated using (true);

-- Tuning thresholds from the dashboard is the whole point of storing them in a
-- table, so signed-in users may update rules. They may not create or drop them:
-- a rule key only means something if a matching evaluator file is deployed.
create policy "authenticated update rules"
  on public.rules for update to authenticated using (true) with check (true);
