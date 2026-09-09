// Isolated PostgreSQL/WASM replay, no production URL or persistent database.
// deno run --allow-read --allow-env scripts/test-signal-tick-guard.ts
// This is a focused schema replay, NOT full Supabase or concurrent-session QA.
// https://pglite.dev/docs/ documents the in-memory Deno runtime.
// deno-lint-ignore no-import-prefix
import { PGlite } from "npm:@electric-sql/pglite@0.5.8";

const read = (path: string) => Deno.readTextFile(new URL(`../${path}`, import.meta.url));
const db = new PGlite();
try {
  const core = await read("supabase/migrations/0001_schema.sql");
  // PGlite has built-in gen_random_uuid; no Supabase publication in this test.
  await db.exec(
    core.replace("create extension if not exists pgcrypto;", "")
      .replace("alter publication supabase_realtime add table public.signals;", ""),
  );
  await db.exec("create role anon; create role authenticated;");
  const outcome = await read("supabase/migrations/0003_outcomes.sql");
  await db.exec(outcome.slice(0, outcome.indexOf("-- Scores every pending signal")));
  const plan = await read("supabase/migrations/0008_trade_plan.sql");
  await db.exec(plan.slice(0, plan.indexOf("-- Plan sizing")));
  await db.exec("alter table public.signal_outcomes add column ambiguous_path boolean;");
  // The actual checked-in live scorer, not a reimplemented arithmetic mock.
  await db.exec(await read("supabase/migrations/0031_cross_asset_chart_annotations.sql"));
  await db.exec(plan.slice(plan.indexOf("drop view if exists public.setup_stats;")));
  // Pre-existing legacy evidence must lock its denominator at migration time.
  // Keep both a missing-unit row and a v1 row: neither may be rewritten to v2,
  // but ordinary annotations outside executionUnits must remain writable.
  await db.exec(`
    insert into public.instruments (id,symbol,tick_size) values
      ('a0260909-1000-0000-0000-000000000001','LEGACY_TEST',0.1);
    insert into public.rules (key,name) values ('legacy_test','Legacy fixture');
    insert into public.bars (id,instrument_id,timeframe,opened_at,open,high,low,close) values
      (909110000,'a0260909-1000-0000-0000-000000000001','5m',now(),10,11,9,10),
      (909110001,'a0260909-1000-0000-0000-000000000001','5m',now() + interval '5 minutes',10,11,9,10);
    insert into public.signals (id,bar_id,instrument_id,timeframe,rule_key,direction,price,payload) values
      ('a0260909-1100-0000-0000-000000000001',909110000,
       'a0260909-1000-0000-0000-000000000001','5m','legacy_test','long',10,
       '{"legacyNote":"missing-units"}'),
      ('a0260909-1100-0000-0000-000000000002',909110001,
       'a0260909-1000-0000-0000-000000000001','5m','legacy_test','short',10,
       '{"executionUnits":{"version":"market-tick-v1","marketTickSize":0.1,"planTickSize":0.1}}');
  `);
  await db.exec(
    await read("supabase/migrations/20260909120000_guard_signal_tick_units.sql"),
  );
  await db.exec(await read("supabase/tests/20260909_signal_tick_units_test.sql"));
  await db.exec(`do $$ begin
    if not (select signal_tick_locked from public.instruments where symbol='LEGACY_TEST') then
      raise exception 'legacy evidence did not lock tick metadata';
    end if;
    begin
      update public.instruments set tick_size=0.4 where symbol='LEGACY_TEST';
      raise exception 'legacy tick update was accepted';
    exception when check_violation then
      if position('tick_size_locked_by_signals' in sqlerrm)=0 then raise; end if;
    end;

    update public.signals
       set payload = payload || '{"reviewNote":"annotation remains writable"}'::jsonb
     where id in ('a0260909-1100-0000-0000-000000000001',
                  'a0260909-1100-0000-0000-000000000002');
    if (select count(*) from public.signals
        where id in ('a0260909-1100-0000-0000-000000000001',
                     'a0260909-1100-0000-0000-000000000002')
          and payload ->> 'reviewNote' = 'annotation remains writable') <> 2 then
      raise exception 'legacy annotation update was not preserved';
    end if;

    begin
      update public.signals
         set payload = payload ||
           '{"executionUnits":{"version":"market-tick-v2","chartTickSize":0.4,"marketTickSize":0.1,"planTickSize":0.1}}'::jsonb
       where id='a0260909-1100-0000-0000-000000000001';
      raise exception 'missing-unit historical evidence was rewritten to v2';
    exception when check_violation then
      if position('signal_execution_units_immutable' in sqlerrm)=0 then raise; end if;
    end;

    begin
      update public.signals
         set payload = payload - 'executionUnits'
       where id='a0260909-1100-0000-0000-000000000002';
      raise exception 'v1 historical units were removed';
    exception when check_violation then
      if position('signal_execution_units_immutable' in sqlerrm)=0 then raise; end if;
    end;
  end; $$;`);
  const version = await db.query("select version()");
  console.log(version.rows);
  console.log(
    "PASS: tick guard + existing scorer + setup_stats R; fixture transaction rolled back",
  );
} finally {
  await db.close();
}
