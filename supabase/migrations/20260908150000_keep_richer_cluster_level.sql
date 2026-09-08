-- Finish the job 20260908085500 started: make the ladder as safe as the bar.
--
-- That migration stopped a thin re-send from replacing a richer *bar*, but the
-- Edge Function drops a superseded bar from `fresh` and so skips BOTH halves,
-- while the trigger only covered `public.bars`. In the race the guard exists to
-- close -- a live close landing between the read and the replay's upsert -- the
-- replay's bar is still in `fresh`, so `upsertLevels()` runs for it and
-- `on conflict (bar_id, price)` REPLACES each price row rather than accumulating
-- it. The result is a rich bar wearing a thin ladder: exactly the reconcile
-- mismatch of HANDOFF 0AE.5, reached from the other side.
--
-- Volume inside a bar only accumulates -- that is the assumption `upsertLevels()`
-- is already built on -- so a price row losing ticks is never a legitimate
-- revision. It only ever means the writer remembers less than the row does.
create or replace function public.keep_richer_cluster_level()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(new.ticks, 0) < coalesce(old.ticks, 0) then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.keep_richer_cluster_level() from public, anon, authenticated;

drop trigger if exists keep_richer_cluster_level_before_update on public.cluster_levels;
create trigger keep_richer_cluster_level_before_update
before update on public.cluster_levels
for each row execute function public.keep_richer_cluster_level();

comment on function public.keep_richer_cluster_level() is
  'Atomically prevents a thinner re-send from replacing a richer footprint row.';

-- ROLLBACK
-- drop trigger if exists keep_richer_cluster_level_before_update on public.cluster_levels;
-- drop function if exists public.keep_richer_cluster_level();
