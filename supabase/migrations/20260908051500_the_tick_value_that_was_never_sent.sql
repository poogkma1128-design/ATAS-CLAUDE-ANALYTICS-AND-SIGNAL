-- Give MNQU6 and NQU6 the tick value the terminal never sends.
--
-- The bridge posts InstrumentInfo.TickSize and nothing else, so `tick_value`
-- has been null on every index instrument since the first row was written
-- (HANDOFF §0Y, §0Z). Ticks are therefore the only unit any result can be
-- stated in: MAE, MFE and pnl_ticks are all real, but no P&L in money and no
-- after-cost number can be computed at all, which is why "ยังไม่คำนวณผลหลัง
-- ต้นทุน" has stood open since §0AE.6.
--
-- These are contract facts, not measurements, and they are written the same
-- way GC's were in 20260907164016: an existing non-null value is never
-- overwritten, an unexpected one aborts the migration rather than being
-- corrected silently, and nothing already stored is rewritten. Ticks that were
-- recorded before this migration keep the number they were recorded with; only
-- what is computed after it can be stated in money.
--
--   MNQ  Micro E-mini Nasdaq-100: $2 per index point, 0.25 point tick  = $0.50
--   NQ   E-mini Nasdaq-100:      $20 per index point, 0.25 point tick  = $5.00
--
-- BTCUSDT is deliberately left null. Its feed is a Binance perpetual, not a
-- fixed-size futures contract (§0R, proven), so there is no per-contract tick
-- value to state — a number here would be an invention, and inventing one is
-- what put a wrong tick_size in this table in the first place.

do $$
declare
  spec record;
  current_size numeric;
  current_value numeric;
begin
  for spec in
    select *
      from (values
        ('MNQU6', 0.25, 0.50),
        ('NQU6', 0.25, 5.00)
      ) as t(symbol, expected_size, contract_value)
  loop
    select tick_size, tick_value
      into current_size, current_value
      from public.instruments
     where symbol = spec.symbol
     for update;

    -- A symbol that has never traded here is not an error: this migration
    -- states a fact about a contract, it does not require the row to exist.
    if not found then
      raise notice 'no % row yet; nothing to state', spec.symbol;
      continue;
    end if;

    if current_size <> spec.expected_size then
      raise exception 'refusing unexpected % tick_size % (expected %)',
        spec.symbol, current_size, spec.expected_size;
    end if;

    if current_value is not null then
      if current_value <> spec.contract_value then
        raise exception 'refusing to overwrite % tick_value % with %',
          spec.symbol, current_value, spec.contract_value;
      end if;
      continue;
    end if;

    update public.instruments
       set tick_value = spec.contract_value
     where symbol = spec.symbol;
  end loop;
end
$$;

-- Rollback, which restores the state this migration found rather than a guess:
-- update public.instruments set tick_value = null
--  where symbol in ('MNQU6', 'NQU6');
