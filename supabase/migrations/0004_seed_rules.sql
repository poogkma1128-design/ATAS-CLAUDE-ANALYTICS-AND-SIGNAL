-- Seed the four v1 rules.
--
-- Each key must have a matching evaluator in
-- supabase/functions/_shared/rules/. Adding a rule later is: write the
-- evaluator, register it in rules/index.ts, insert a row here.
--
-- params is deliberately loose. Tune it from the dashboard; no redeploy needed.

insert into public.rules (key, name, description, horizon_bars, params) values
  (
    'stacked_imbalance',
    'Stacked Imbalance',
    'Diagonal bid/ask imbalance ต่อเนื่องหลายระดับราคา — จุดที่ฝั่งหนึ่งไล่ราคาอย่างชัดเจน',
    10,
    '{"ratio": 3, "minVolume": 10, "stack": 3}'::jsonb
  ),
  (
    'delta_divergence',
    'Delta Divergence',
    'ราคาทำ high/low ใหม่ แต่ delta สวนทาง — สัญญาณว่าแรงที่ดันราคาไม่มีจริง',
    10,
    '{"lookback": 5, "minDeltaMagnitude": 100}'::jsonb
  ),
  (
    'absorption',
    'Absorption at Level',
    'Volume สูงผิดปกติที่ปลายแท่ง แต่ราคาไปต่อไม่ได้แล้วถอยกลับ — มีคนรับของอยู่',
    10,
    '{"volumeMultiple": 3, "edgeTicks": 2, "rejectionTicks": 2}'::jsonb
  ),
  (
    'poc_shift',
    'POC Shift / HVN',
    'Point of Control ขยับไปทางเดียวต่อเนื่อง — โซนที่ตลาดยอมรับราคากำลังเลื่อน',
    10,
    '{"minTicks": 3, "consecutive": 2, "hvnShare": 0.25}'::jsonb
  )
on conflict (key) do nothing;
