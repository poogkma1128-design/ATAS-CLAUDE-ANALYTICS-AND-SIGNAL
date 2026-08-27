-- Score pending signals once a minute.
--
-- Wrapped in an exception handler because pg_cron availability differs between
-- Supabase plans and local stacks. If scheduling fails the rest of the system
-- still works; evaluate_pending_outcomes() can be invoked on demand instead.

create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('evaluate-outcomes');
exception
  when others then null;
end;
$$;

do $$
begin
  perform cron.schedule(
    'evaluate-outcomes',
    '* * * * *',
    $cron$select public.evaluate_pending_outcomes();$cron$
  );
exception
  when others then
    raise notice 'pg_cron scheduling unavailable: %', sqlerrm;
end;
$$;
