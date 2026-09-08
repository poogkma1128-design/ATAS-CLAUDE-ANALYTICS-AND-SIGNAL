-- Make a replay of the same strategy touch a no-op instead of a new evidence row.
--
-- Production currently contains duplicate touch identities. The owner explicitly
-- reserved the decision to remove or preserve those rows, so this migration fails
-- closed until that decision has been carried out; it never deletes evidence.
do $$
begin
  if exists (
    select 1
    from public.strategy_setups
    group by strategy_key, instrument_id, timeframe, anchor_touch_id
    having count(*) > 1
  ) then
    raise exception using
      message = 'strategy_setups still contains duplicate anchor_touch_id rows',
      hint = 'Owner must resolve the documented duplicate evidence before applying this migration.';
  end if;
end
$$;

create unique index strategy_setups_one_row_per_touch
  on public.strategy_setups (
    strategy_key,
    instrument_id,
    timeframe,
    anchor_touch_id
  );

comment on index public.strategy_setups_one_row_per_touch is
  'One durable evidence row per strategy touch; makes ingest replay idempotent.';

-- ROLLBACK
-- drop index if exists public.strategy_setups_one_row_per_touch;
