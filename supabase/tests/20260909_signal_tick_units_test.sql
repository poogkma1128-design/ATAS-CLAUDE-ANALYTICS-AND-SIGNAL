-- Run AFTER 20260909120000 on a disposable DB only. Rolls all fixtures back.
begin;

create function pg_temp.expect_tick_error(statement text, fragment text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when check_violation then
    if position(fragment in sqlerrm) > 0 then return; end if;
    raise;
  end;
  raise exception 'expected error: %', fragment;
end;
$$;

insert into public.instruments (id, symbol, exchange, tick_size, tick_value)
values ('a0260909-0000-0000-0000-000000000001', 'TICK_UNIT_TEST', 'TEST', 0.1, 10);

insert into public.rules (key, name) values ('tick_unit_test', 'Tick unit regression');

-- Before the first signal, a curated metadata correction remains possible.
update public.instruments set tick_size=0.2
where id='a0260909-0000-0000-0000-000000000001';
update public.instruments set tick_size=0.1
where id='a0260909-0000-0000-0000-000000000001';
-- Curation is explicit. Setting the verified tick and durable latch together is
-- the only path that enables signals for a newly discovered instrument.
select pg_temp.expect_tick_error($s$
  update public.instruments set signal_tick_locked=true
  where id='a0260909-0000-0000-0000-000000000001'
$s$, 'tick_lock_requires_reviewed_curation');
set local app.allow_instrument_metadata_change='on';
update public.instruments set tick_size=0.1, signal_tick_locked=true
where id='a0260909-0000-0000-0000-000000000001';

insert into public.bars (id, instrument_id, timeframe, opened_at, open, high, low, close)
values (909120000, 'a0260909-0000-0000-0000-000000000001', '5m', '2026-09-09T10:00:00Z', 4424, 4425, 4420, 4424);

insert into public.instruments (id, symbol, exchange, tick_size, tick_value)
values ('a0260909-0000-0000-0000-000000000003', 'UNVERIFIED_TICK_TEST', 'TEST', 0.4, 10);
insert into public.bars (id, instrument_id, timeframe, opened_at, open, high, low, close)
values (909120003, 'a0260909-0000-0000-0000-000000000003', '5m', '2026-09-09T10:00:00Z', 4424, 4425, 4420, 4424);
select pg_temp.expect_tick_error($s$
  insert into public.signals (bar_id,instrument_id,timeframe,rule_key,direction,price,payload)
  values (909120003,'a0260909-0000-0000-0000-000000000003','5m','tick_unit_test','long',4424,
    '{"executionUnits":{"version":"market-tick-v2","marketTickSize":0.4,"planTickSize":0.4}}')
$s$, 'signal_tick_unverified');

select pg_temp.expect_tick_error($s$
  insert into public.signals (bar_id,instrument_id,timeframe,rule_key,direction,price,payload)
  values (909120000,'a0260909-0000-0000-0000-000000000001','5m','tick_unit_test','short',4424,'{}')
$s$, 'signal_tick_units_required');

select pg_temp.expect_tick_error($s$
  insert into public.signals (bar_id,instrument_id,timeframe,rule_key,direction,price,payload)
  values (909120000,'a0260909-0000-0000-0000-000000000001','5m','tick_unit_test','short',4424,
    '{"executionUnits":{"version":"market-tick-v1","marketTickSize":0.1,"planTickSize":0.1}}')
$s$, 'signal_tick_units_required');

insert into public.signals (id, bar_id, instrument_id, timeframe, rule_key, direction, price, payload,
  entry_price, stop_price, target_price, risk_ticks, reward_ticks)
values ('a0260909-0000-0000-0000-000000000002', 909120000,
  'a0260909-0000-0000-0000-000000000001', '5m', 'tick_unit_test', 'long', 4424,
  '{"executionUnits":{"version":"market-tick-v2","marketTickSize":0.1,"planTickSize":0.1}}',
  4424, 4420.6, 4430.8, 34, 68);

select pg_temp.expect_tick_error($s$
  insert into public.signals (bar_id,instrument_id,timeframe,rule_key,direction,price,payload)
  values (909120000,'a0260909-0000-0000-0000-000000000001','5m','tick_unit_test','short',4424,
    '{"executionUnits":{"version":"market-tick-v2","marketTickSize":0.4,"planTickSize":0.4}}')
$s$, 'signal_tick_unit_mismatch');

select pg_temp.expect_tick_error($s$
  update public.instruments set tick_size=0.4
  where id='a0260909-0000-0000-0000-000000000001'
$s$, 'tick_size_locked_by_signals');

select pg_temp.expect_tick_error($s$
  update public.instruments set signal_tick_locked=false
  where id='a0260909-0000-0000-0000-000000000001'
$s$, 'tick_size_locked_by_signals');

-- Even a deliberate legacy override cannot silently corrupt old R.
set local app.allow_instrument_metadata_change='on';
select pg_temp.expect_tick_error($s$
  update public.instruments set tick_size=0.4
  where id='a0260909-0000-0000-0000-000000000001'
$s$, 'tick_size_locked_by_signals');

select pg_temp.expect_tick_error($s$
  update public.signals set payload='{"executionUnits":{"version":"market-tick-v2","marketTickSize":0.1,"planTickSize":0.4}}'
  where id='a0260909-0000-0000-0000-000000000002'
$s$, 'signal_tick_unit_mismatch');

select pg_temp.expect_tick_error($s$
  update public.signals set payload='{"executionUnits":{"version":"market-tick-v2","marketTickSize":0.1}}'
  where id='a0260909-0000-0000-0000-000000000002'
$s$, 'signal_tick_units_required');

select pg_temp.expect_tick_error($s$
  update public.signals set payload='{}'
  where id='a0260909-0000-0000-0000-000000000002'
$s$, 'signal_tick_units_required');

select pg_temp.expect_tick_error($s$
  update public.signals set payload='{"executionUnits":{"version":"legacy","marketTickSize":0.1,"planTickSize":0.1}}'
  where id='a0260909-0000-0000-0000-000000000002'
$s$, 'signal_tick_units_required');

select pg_temp.expect_tick_error($s$
  update public.signals set payload='{"executionUnits":{"version":"market-tick-v2","marketTickSize":"0.1","planTickSize":0.1}}'
  where id='a0260909-0000-0000-0000-000000000002'
$s$, 'signal_tick_units_required');

-- No-op tick assignment and cash-value correction remain possible.
update public.instruments set tick_size=0.1, tick_value=10
where id='a0260909-0000-0000-0000-000000000001';

insert into public.bars (id, instrument_id, timeframe, opened_at, open, high, low, close, is_closed)
values (909120001, 'a0260909-0000-0000-0000-000000000001', '5m', '2026-09-09T10:05:00Z',
  4424, 4431, 4423, 4430.8, true);
select public.evaluate_pending_outcomes();

do $$
declare observed_r numeric; stored_r numeric; view_r numeric;
begin
  select ((s.target_price-s.entry_price)/i.tick_size)/s.risk_ticks into observed_r
  from public.signals s join public.instruments i on i.id=s.instrument_id
  where s.id='a0260909-0000-0000-0000-000000000002';
  if observed_r <> 2 then raise exception 'expected 2R, got %', observed_r; end if;
  select o.pnl_ticks/s.risk_ticks into stored_r
  from public.signal_outcomes o join public.signals s on s.id=o.signal_id
  where s.id='a0260909-0000-0000-0000-000000000002';
  if stored_r is distinct from 2::numeric then
    raise exception 'existing scorer expected 2R, got %', stored_r;
  end if;
  select avg_r into view_r from public.setup_stats where rule_key='tick_unit_test' and direction='long';
  if view_r is distinct from 2::numeric then
    raise exception 'setup_stats expected 2R, got %', view_r;
  end if;
end;
$$;
rollback;
