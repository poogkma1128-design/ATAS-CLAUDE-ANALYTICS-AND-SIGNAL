-- Close the read-then-write race left by the ingest re-send guard.
--
-- The Edge Function normally compares first, but a live close can land after
-- that read and before the replay upsert. The database is the only place that
-- can make "never replace a closed bar with fewer ticks" atomic.
create or replace function public.keep_richer_closed_bar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_closed and coalesce(new.ticks, 0) < coalesce(old.ticks, 0) then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.keep_richer_closed_bar() from public, anon, authenticated;

drop trigger if exists keep_richer_closed_bar_before_update on public.bars;
create trigger keep_richer_closed_bar_before_update
before update on public.bars
for each row execute function public.keep_richer_closed_bar();

comment on function public.keep_richer_closed_bar() is
  'Atomically prevents a thinner re-send from replacing a richer closed bar.';

-- ROLLBACK
-- drop trigger if exists keep_richer_closed_bar_before_update on public.bars;
-- drop function if exists public.keep_richer_closed_bar();
