# HANDOFF — สถานะโปรเจกต์ ณ 2026-08-29 (อัปเดตหลังทำข้อ 7.2 A)

เอกสารนี้เขียนไว้ให้ **แชทใหม่อ่านแล้วทำงานต่อได้ทันที** โดยไม่ต้องไล่ย้อนบทสนทนาเดิม
สิ่งที่อยู่ในนี้คือข้อเท็จจริงที่ **ตรวจสอบกับระบบจริงแล้ว** ไม่ใช่การเดา

---

## 1. ระบบนี้คืออะไร

เปลี่ยนการอ่าน orderflow จาก "เดาจากภาพหน้าจอ" เป็นระบบที่วัดผลได้

```
ATAS (Windows)
  └─ SignalBridge.dll ──HTTPS──> Supabase Edge Function `ingest`
                                    ├─ เก็บ bars + cluster_levels
                                    ├─ liquidity gate
                                    ├─ rule engine (4 กฎ)
                                    ├─ trade plan (เข้า/SL/TP/trail/ถือกี่แท่ง + พื้นความเสี่ยงตาม range)
                                    ├─ price action context (เก็บอย่างเดียว)
                                    └─ Telegram
                                          │
                              Postgres + pg_cron
                                    └─ evaluate_pending_outcomes() → R / win rate
                                          │
                              Next.js บน Vercel (feed / stats / rules)
```

**หลักการที่ห้ามละเมิด:** indicator โง่ที่สุดเท่าที่จะทำได้ (ส่งแต่ตัวเลขดิบ)
ความฉลาดทั้งหมดอยู่บน server แก้ threshold = แก้แถวใน `rules.params` ไม่ต้อง build C# ใหม่

---

## 2. ทรัพยากรจริงที่ใช้งานอยู่

| อย่าง | ค่า |
|---|---|
| Supabase project ref | `sckdriuwfyittcybnbhz` |
| Ingest endpoint | `https://sckdriuwfyittcybnbhz.supabase.co/functions/v1/ingest` |
| Edge function `ingest` | **version 11, ACTIVE** (`verify_jwt: false` — auth ด้วย INGEST_TOKEN เอง) |
| Dashboard | `https://atas-signal-board.vercel.app` |
| Vercel production branch | **`claude/form-signal-telegram-rz8am1`** (ไม่ใช่ `main` — ตั้งไว้แบบนี้) |
| Repo | `poogkma1128-design/ATAS-CLAUDE-ANALYTICS-AND-SIGNAL` |
| branch ที่ใช้พัฒนา | `claude/form-signal-telegram-rz8am1` |
| Instruments ที่มีข้อมูล | `MNQU6` (5m), `BTCUSDT` (5m — เดิมเขียนว่า 1m ตอนนี้ยิง 5m อยู่) |

Secrets ที่ตั้งบน Supabase แล้ว: `INGEST_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `DASHBOARD_URL`

---

## 3. ข้อเท็จจริงที่แลกมาด้วยการดีบัก — อย่าค้นซ้ำ

### 3.1 `TickSize` ของ ATAS ไม่ใช่ tick ของตลาด

ATAS รายงาน `InstrumentInfo.TickSize` เป็น **ความห่างของแถว footprint บนชาร์ต** ไม่ใช่ minimum tick
ตรวจกับข้อมูลจริงในตาราง `cluster_levels`:

| symbol | tick_size ที่รายงาน | ช่องว่างแถวแคบสุด | ที่พบบ่อยสุด | แคบกว่า tick_size |
|---|---|---|---|---|
| MNQU6 | 0.75 | 0.75 | 0.75 | 0 |
| BTCUSDT | 0.30 | 0.30 | 0.30 | 0 |

MNQ tick จริง = 0.25 → ชาร์ตรวม **3 ticks ต่อ 1 แถว**

**ผลที่ตามมา:**
- ข้อความ Telegram และหน้าเว็บบอกระยะเป็น**ราคา** ไม่ใช่จำนวน tick (ไม่งั้นอ่านแล้วเข้าใจผิด 3 เท่า)
- `stacked_imbalance` ไม่กระทบ เพราะมันเทียบ *แถวที่ติดกัน* ซึ่งถูกต้องอยู่แล้ว
- **ถ้าจะย้ายไป Rithmic ต้อง aggregate footprint ให้ได้ step เท่าเดิม** ไม่งั้นเกณฑ์ทุกกฎเพี้ยนเงียบ ๆ

### 3.2 `CurrentBar` ของ ATAS เป็นจำนวนนับ ไม่ใช่ index

แท่งที่กำลังก่อตัวคือ `CurrentBar - 1` การเขียน `if (bar != CurrentBar) return;`
จะเป็นจริงตลอดและ **ไม่ส่งอะไรเลยโดยไม่มี error** — เคยเจอมาแล้ว

### 3.3 ATAS ไม่อ่านโฟลเดอร์ `Documents\ATAS\Indicators\`

ต้องใช้ปุ่ม **Import ⬆️** ในหน้า Indicators เท่านั้น และ indicator จะไปโผล่ในหมวด
**Custom** (ไม่ใช่ Order Flow)

DLL ที่ build ได้อยู่ที่ `atas-indicator\AtasSignalBridge\bin\Release\AtasSignalBridge.dll`
(**ไม่มี** โฟลเดอร์ย่อยชื่อ .NET เพราะตั้ง `AppendTargetFrameworkToOutputPath=false`)

### 3.4 .NET ที่ ATAS ใช้คือ **net10.0-windows**

ATAS SDK **ไม่มีบน NuGet** → C# build ได้เฉพาะบนเครื่อง Windows ที่ลง ATAS
csproj อ้าง DLL ตรงจาก `C:\Program Files (x86)\ATAS Platform\`

ในคอนเทนเนอร์นี้ตรวจ C# ได้โดย **เขียน stub ของ ATAS API** แล้ว compile — เคยทำแล้วได้ผล
(0 error 0 warning) ดูวิธีใน commit "Stamp each build so ATAS can say which one is loaded"

### 3.5 Windows บล็อกการรัน `.ps1` โดย default

`scripts\update-indicator.bat` มีไว้แก้เรื่องนี้ (ดับเบิลคลิกได้เลย)
เรียก `.ps1` ตรง ๆ จะขึ้น *"running scripts is disabled on this system"* ซึ่งอ่านแล้วเหมือนสคริปต์พัง

### 3.6 อื่น ๆ

- `NEXT_PUBLIC_*` ถูก inline ตอน build ไม่ใช่ตอน request — redeploy ที่ใช้ build cache จะได้ค่าเก่า
- Next.js ถือว่าโฟลเดอร์ขึ้นต้น `__` เป็น private route → 404
- `trailing` เป็น reserved word ของ Postgres ใช้เป็นชื่อตัวแปรใน plpgsql ไม่ได้
- supabase-js อนุมาน type จาก select string ที่เป็น **literal เดียว** — ถ้าต่อ string จะกลายเป็น error type

### 3.7 ข้อความ Telegram — สองอย่างที่เสียเวลาไปแล้วอย่าเสียซ้ำ

**Telegram ไม่ทำ hashtag ที่เป็นตัวเลขล้วนให้กดได้** `#218` เป็นข้อความเฉย ๆ แต่ `#S218` กดได้
และการกดคือการค้นหาในแชต → เจอทั้งสัญญาณและผลของไม้นั้นพร้อมกัน นี่คือเหตุผลที่ตั้งรูปแบบเป็น `#S<seq>`

**แปลงเวลาไทยด้วย offset คงที่ +7 ไม่ใช่ `Intl`** ไทยไม่มี DST ตั้งแต่ปี 2484 ค่า UTC+7 จึงจริงทุกวันที่
ส่วน edge runtime ไม่รับประกันว่ามี timezone database ครบ ถ้าขาด `Intl` จะคืนค่าเป็น UTC **เงียบ ๆ**
ทั้งที่ข้อความติดป้ายว่าเป็นเวลาไทย ซึ่งแย่กว่าการไม่แปลงเลย

---

## 4. สิ่งที่สร้างไปแล้ว (ตามลำดับ พร้อมเหตุผล)

| # | อะไร | ทำไม |
|---|---|---|
| 1 | Schema + RLS + outcome tracking + pg_cron | ตอบคำถาม "setup ไหนได้เงินจริง" |
| 2 | Rule engine 4 กฎ | stacked_imbalance / delta_divergence / absorption / poc_shift |
| 3 | ATAS indicator + Telegram + Next.js dashboard | ครบวงจร |
| 4 | ไม่แจ้งเตือนแท่งย้อนหลัง | backfill เคยยิง Telegram 71 ข้อความรวด |
| 5 | Batch ingest | backfill 100 แท่งเคยใช้ 25–51 วิ (≈400 round trip) เหลือ ~9 |
| 6 | จูน `poc_shift` | เคยยิง 45 จาก 71 สัญญาณ |
| 7 | Revision stamp ใน About ของ ATAS | รู้ว่า DLL ที่โหลดอยู่เป็นตัวไหน |
| 8 | **Trade plan** ทุกสัญญาณ + ให้คะแนนตามแผนจริง | สัญญาณที่บอกแค่ทิศทาง วัดผลไม่ได้ |
| 9 | **Liquidity gate** | ตัดแท่ง volume บาง |
| 10 | **Price action context** | เก็บไว้รอวัด ยังไม่กรอง |
| 11 | **พื้นความเสี่ยงตามความผันผวนของ instrument** | `minRiskTicks` นับ "แถว footprint" ซึ่งคนละขนาดกันในแต่ละ instrument — ดูข้อ 5.4 |
| 13 | **ตั้งค่าแยกราย instrument + ด่านความนิ่ง** | กฎเดียวกันให้ผลตรงข้ามกันคนละ instrument — ดูข้อ 5.5 |
| 12 | **เลขลำดับไม้ `#S<seq>` + เวลาไทย + ผลรายงานเป็นราคา/R** | ผลมาเป็น reply แต่ preview ถูกตัดบนมือถือ ผลของไม้ 12:15 จึงไปแสดงใต้ไม้ 12:25 ที่ยังไม่จบ · และผลเคยรายงานเป็น ticks ทั้งที่สัญญาณรายงานเป็นราคา |

---

## 5. ตัวเลขที่วัดจริง — ฐานของทุกการตัดสินใจ

> ⚠️ **ข้อ 5.1–5.3 มาจากข้อมูลเซสชันเดียว (2026-08-28, MNQ 5m, 157 สัญญาณ)**
> เป็นจุดตั้งต้น **ไม่ใช่ข้อสรุป** ต้องวัดซ้ำเมื่อมีข้อมูลมากขึ้น
> ข้อ 5.4 ใหม่กว่า — วัดจาก 2 instrument / 216 ไม้ที่ resolved แล้ว (MNQ 2026-08-28 + BTCUSDT 2026-08-29)

### 5.1 ผลต่อ setup (หลังให้คะแนนตาม TP/SL จริง)

| Setup | ไม้ | Win rate | รวม R | TP/SL/Trail/หมดเวลา |
|---|---|---|---|---|
| absorption long | 9 | 78% | **+7.75** | 4/2/3/0 |
| stacked_imbalance short | 19 | 58% | +5.95 | 3/7/7/2 |
| stacked_imbalance long | 21 | 52% | +2.45 | 2/8/7/4 |
| delta_divergence long | 3 | 67% | +1.81 | 1/1/1/0 |
| delta_divergence short | 9 | 56% | +1.78 | 0/3/5/1 |
| absorption short | 7 | 29% | −1.00 | 2/5/0/0 |
| poc_shift short | 39 | 33% | −6.77 | 6/26/6/1 |
| poc_shift long | 50 | 40% | **−7.45** | 5/28/11/6 |

**`poc_shift` โดน SL 54 จาก 89 ไม้** — ถ้าข้อมูลชุดใหม่ยังเป็นแบบนี้ ควรปิดกฎนี้

### 5.2 ทำไมถึงเลือก volume filter แทน session filter

| วิธี | ผลบนข้อมูลเดียวกัน | ใช้กับ BTCUSDT ได้ |
|---|---|---|
| Clock filter (RTH 13–19 UTC) | +8.46R | ❌ คริปโตไม่มี RTH |
| **Volume ≥ 1.2× median 50 แท่ง** | **+11.88R** | ✅ |

การกระจายเต็ม (bar volume เทียบ median ของ 50 แท่งก่อนหน้า):

| ratio | ไม้ | Win rate | รวม R |
|---|---|---|---|
| < 0.4× | 10 | 60% | +2.58 |
| 0.4–0.7× | 23 | 35% | **−7.13** |
| 0.7–1.2× | 35 | 46% | −1.83 |
| 1.2–2.0× | 28 | 50% | +3.04 |
| ≥ 2.0× | 60 | 45% | **+8.84** |

ตัดที่ 1.2× → เหนือเส้น **+11.88R / 88 ไม้** ใต้เส้น **−6.38R / 68 ไม้**

### 5.3 ทำไม `poc_shift` ตั้ง `consecutive: 3`

POC ขยับระหว่างแท่งข้างเคียง **มัธยฐาน 45 ticks** → `minTicks: 3` เดิมไม่ได้กรองอะไรเลย
สิ่งที่แยกเทรนด์จาก chop คือ *จำนวนก้าวที่ไปทางเดียวกัน* ไม่ใช่ระยะทาง:

| ตั้งค่า | แท่งที่เข้าเงื่อนไข (จาก 132) |
|---|---|
| `consecutive: 2` | 57 |
| `consecutive: 3` | 23 |
| `consecutive: 3` + เพิ่มเกณฑ์ระยะทาง | 22 |

### 5.4 ทำไมพื้นความเสี่ยงต้องผูกกับ range ไม่ใช่จำนวนแถว

`minRiskTicks: 4` นับเป็น "แถว footprint" และ 1 แถวของแต่ละ instrument ไม่ใช่ปริมาณตลาดเท่ากัน:

| symbol | 1 แถว | median range ของแท่ง | 4 แถวคิดเป็น |
|---|---|---|---|
| MNQU6 5m | 0.75 | 15.00 | 20% ของแท่ง |
| BTCUSDT 5m | 0.30 | 22.20 | **5.4% ของแท่ง** |

ค่าเดียวจึงเหมาะกับทั้งคู่ไม่ได้ ของจริงที่เคยออกมาคือ `เข้า 77576.40 · SL 77575.20 · TP 77578.80`
— เสี่ยง 0.0015% ของราคา ไม้แบบนี้จบที่ spread ไม่ได้จบที่ setup ผิด

**ผลจริงยืนยันว่าปลายแคบคือฝั่งที่ขาดทุน** (จัดกลุ่มทุกไม้ตามความเสี่ยงเทียบ median range 20 แท่ง):

| ความเสี่ยง / range | MNQU6 | BTCUSDT |
|---|---|---|
| < 0.30× | 12 ไม้ · 17% · **−6.00R** | 17 ไม้ · 29% · **−2.00R** |
| 0.30–0.60× | 30 ไม้ · 37% · −3.08R | 15 ไม้ · 53% · +4.75R |
| 0.60–1.00× | 28 ไม้ · 46% · −0.02R | 20 ไม้ · 45% · −0.67R |
| ≥ 1.00× | 58 ไม้ · 55% · **+10.86R** | 36 ไม้ · 61% · **+13.15R** |

ต่างจาก volume gate ตรงที่ **ไม่ตัดไม้ทิ้ง** — setup เจอถูกแล้ว ผิดแค่ที่ให้ที่ยืนน้อยไป จึงขยายแทนที่จะปิด

เลือกค่า 0.30 จากการ **จำลองเดินแท่งใหม่ทั้ง 216 ไม้** (ตัวจำลองให้ผลตรงกับที่ระบบบันทึกไว้ 213/216
จึงเชื่อได้ว่าให้คะแนนไม้ชุดเดียวกัน):

| share | ไม้ที่ถูกขยาย | รวม R | MNQU6 | BTCUSDT |
|---|---|---|---|---|
| 0.00 (เดิม) | 0 | +13.17 | +1.77 | +11.41 |
| 0.20 | 18 | +19.24 | +4.82 | +14.41 |
| 0.25 | 24 | +19.22 | +4.88 | +14.34 |
| **0.30** | **29** | **+19.27** | **+4.81** | **+14.46** |
| 0.40 | 47 | +16.56 | +3.68 | +12.88 |
| 0.60 | 74 | +24.28 | +13.57 | +10.71 |

เหตุผลที่เอา 0.30 ไม่ใช่ 0.60: **ค่าข้างเคียงต้องเห็นด้วยกัน** 0.20/0.25/0.30 ต่างกันไม่ถึง 0.05R
= เป็นผลจริง ส่วน 0.60 ดีขึ้นเพราะ MNQU6 ล้วน ๆ (BTCUSDT แย่ลง) และไปขยายไม้ 1 ใน 3 ของทั้งหมด
จากข้อมูลเซสชันเดียว = fit ข้อมูล 0.30 ยังเป็น *พื้น* ของเคสที่เพี้ยน ไม่ได้กลายเป็นตัวกำหนดขนาดไม้

**ช่วง 0.55–0.65 ให้ R สูงกว่าจริง — ควรวัดซ้ำเมื่อมีข้อมูล MNQ มากกว่า 1 เซสชัน**

### 5.5 ทำไมต้องตั้งค่าแยกราย instrument และทำไมยังไม่ปิดอะไร

กฎเดียวกัน ทิศทางเดียวกัน ช่วงวันเดียวกัน แต่ผลตรงข้าม:

| กฎ + ทิศทาง | BTCUSDT | MNQU6 |
|---|---|---|
| `poc_shift` short | 18 ไม้ · 67% · **+9.41R** | 36 ไม้ · 31% · **−9.09R** |
| `absorption` long | 34 ไม้ · 68% · **+26.10R** | (1 ไม้) |
| `absorption` short | 30 ไม้ · 27% · **−9.57R** | (1 ไม้) |

สวิตช์ตัวเดียวที่ใช้ร่วมกันจึงผิดกับตัวใดตัวหนึ่งเสมอ **และ `setup_stats` มองไม่เห็นเรื่องนี้เลย**
เพราะมัน group แค่ (กฎ, ทิศทาง) — สอง instrument ถูกเฉลี่ยกลบกันหมด
view ที่อธิบายปัญหาไม่ได้ ใช้หาปัญหาไม่ได้ จึงมี `setup_stats_by_instrument` เพิ่มมา

**แต่ยังไม่ปิดอะไรทั้งนั้น** เพราะตัวเลขรายวันบอกว่าเชื่อไม่ได้:

| cell | 28 ส.ค. | 29 ส.ค. |
|---|---|---|
| MNQ `stacked_imbalance` long | 12 ไม้ · 25% · **−5.37R** | 9 ไม้ · 89% · **+7.82R** |
| MNQ `poc_shift` long | 24 ไม้ · 33% · −4.15R | 14 ไม้ · 57% · +0.40R |
| BTC ทุก cell | — | **มีวันเดียว ไม่มี out-of-sample** |

ถ้าจูนจากวันที่ 28 จะปิด `stacked_imbalance long` ทิ้ง แล้วเสีย +7.82R ของวันถัดมา

**วินัยข้อนี้จึงกลายเป็น view ไม่ใช่สิ่งที่ต้องจำ** — `setup_stability` จะไม่เสนอให้เปลี่ยนอะไร
จนกว่า cell นั้นจะมี **ไม้ ≥ 30 · เซสชัน ≥ 3 · มีเซสชันค้านได้ไม่เกิน 1** วันนี้ยัง**ไม่ผ่านสักตัว**
ทั้ง 13 cell ขึ้นว่า `need more trades` หรือ `need more sessions`
ตัวที่ใกล้ที่สุดคือ MNQ `poc_shift short` (36 ไม้ ติดลบทั้ง 2 เซสชัน) ขาดอีกเซสชันเดียว

**สำคัญ: mute ไม่ใช่ disable** — setup ที่ถูก mute ยังถูกประเมิน เก็บ และให้คะแนนตามปกติ
แค่ไม่แจ้งเตือน สถิติจึงเดินต่อขณะปิดอยู่ และมันมีโอกาส "พิสูจน์ตัวเองกลับมา" ได้
`signals.muted` บันทึกไว้ตอนยิง การเปลี่ยนค่าทีหลังจึงไม่ไปแก้ประวัติไม้ที่เทรดจริงไปแล้ว

---

## 6. ค่า params ปัจจุบัน (แก้ได้ที่ `/rules` ไม่ต้อง deploy)

ทุกกฎมีชุดนี้เหมือนกัน:

```json
{
  "bufferTicks": 2, "minRiskTicks": 4, "rewardRatio": 2,
  "trailAfterR": 1, "trailOffsetR": 0.5,
  "minVolumeRatio": 1.2, "minVolumeHistory": 10,
  "minRiskRangeShare": 0.3, "minRiskRangeBars": 20
}
```

`minRiskRangeShare` คือพื้นความเสี่ยงขั้นต่ำ คิดเป็น**สัดส่วนของ median range 20 แท่งก่อนหน้า**
มันมาแทนบทบาทของ `minRiskTicks` ในทางปฏิบัติ (ตัวไหนกว้างกว่าใช้ตัวนั้น) — ดูข้อ 5.4

เฉพาะกฎ:

| กฎ | params เฉพาะตัว |
|---|---|
| `stacked_imbalance` | `ratio: 3`, `minVolume: 10`, `stack: 3` |
| `delta_divergence` | `lookback: 5`, `minDeltaMagnitude: 100` |
| `absorption` | `volumeMultiple: 3`, `edgeTicks: 2`, `rejectionTicks: 2` |
| `poc_shift` | `minTicks: 8`, `consecutive: 3`, `hvnShare: 0.25` |

---

## 7. งานที่ค้างอยู่

### 7.1 ต้องให้เจ้าของทำเอง (ผมไม่มีสิทธิ์เข้าถึง ไม่ใช่เรื่องการอนุญาต)

| # | งาน | ทำไมผมทำไม่ได้ |
|---|---|---|
| 1 | กรอก Endpoint URL + Ingest token ในหน้า ATAS | GUI บนเครื่อง Windows |
| 2 | Supabase Auth → **Site URL** = `https://atas-signal-board.vercel.app` และเพิ่ม **Redirect URL** `https://atas-signal-board.vercel.app/**` | Supabase MCP ไม่มีเครื่องมือแก้ auth config (ตรวจแล้ว) |
| 3 | Email template (Magic Link + Confirm signup) เติม `<p>รหัส: <strong>{{ .Token }}</strong></p>` | เหตุผลเดียวกับข้อ 2 |
| 4 | Revoke Telegram bot token เก่า (`8549812393:...` หลุดในแชต) ที่ @BotFather แล้วใส่ตัวใหม่ใน Supabase | ต้องใช้บัญชี Telegram ของเจ้าของ |
| 5 | ปิด "Allow new users to sign up" หลังสร้างบัญชี dashboard | Supabase dashboard |

**ข้อ 2 กับ 3 คือสาเหตุที่ล็อกอินเว็บไม่ได้ตอนนี้** — ยืนยันด้วยการยิงจริง:
ขอ redirect ไป `.../auth/callback` แต่ Supabase ตอบกลับเป็น `http://localhost:3000/`

### 7.2 งานโค้ดที่ค้าง

| # | งาน | สถานะ |
|---|---|---|
| A | **`minRiskTicks` ไม่ scale ตาม instrument** | ✅ **เสร็จแล้ว** (migration 0010 + ingest v9) — ดูข้อ 5.4 |
| B | วัดผล price action flags | รอข้อมูล 3–5 วัน |
| C | ตัดสินชะตา `poc_shift` | รอข้อมูลเพิ่ม |
| D | วัดซ้ำว่า `minRiskRangeShare` ควรเป็น 0.30 หรือ 0.60 | รอข้อมูล MNQ เซสชันที่ 2 |

**ข้อ A ทำอะไรไป:** เพิ่ม param `minRiskRangeShare` (0.3) กับ `minRiskRangeBars` (20)
ใน `plan.ts` มี `volatilityFloorTicks()` คำนวณพื้นความเสี่ยงจาก median range ของแท่งก่อนหน้า
แล้ว `buildPlan()` เลือกค่ามากสุดระหว่าง (ระยะจากแท่ง + buffer) / `minRiskTicks` / พื้นจาก range
`ingest.ts` ส่ง `history` ชุดเดียวกับที่กฎใช้เข้าไปด้วย — เหตุผลและตัวเลขทั้งหมดอยู่ในข้อ 5.4

ถ้าประวัติสั้นกว่า `minRiskRangeBars` จะ**ไม่**ใช้พื้นนี้ (ตกกลับไปใช้ `minRiskTicks` เหมือนเดิม)
เพราะ median จาก 3 แท่งไม่ได้บอกว่า "ปกติ" ของ instrument นี้คืออะไร — วิธีเดียวกับ liquidity gate

**ข้อ D ทำยังไง:** รันสคริปต์จำลองใน §8.4 อีกครั้งเมื่อมีข้อมูลมากขึ้น ถ้า 0.55–0.65 ยังชนะ
*และชนะทั้งสอง instrument* ค่อยขยับ — แก้ที่ `/rules` ได้เลยไม่ต้อง deploy

## 8. ขั้นตอนถัดไป

### 8.1 วัดผล price action flags (เมื่อมีข้อมูล 3–5 วัน)

```sql
select s.payload->'priceAction'->>'sweep'  as sweep,
       s.payload->'priceAction'->>'zone'   as zone,
       s.direction,
       count(*)                                                   as trades,
       round(avg(case when o.pnl_ticks > 0 then 1 else 0 end), 3) as win_rate,
       round(sum(o.pnl_ticks / nullif(s.risk_ticks, 0)), 2)       as total_r
  from public.signals s
  join public.signal_outcomes o on o.signal_id = s.id
 where o.status = 'resolved'
   and s.payload ? 'priceAction'
 group by 1, 2, 3
 order by total_r desc nulls last;
```

**กติกา:** ช่องไหนแยกตัวชัด *และ* มีจำนวนไม้พอ → เลื่อนขึ้นเป็นตัวกรอง โดยย้ายเกณฑ์ไป `rules.params`
ถ้าไม่ต่าง → ลบทิ้งได้โดยไม่เสียอะไร **นี่คือวิธีเดียวกับที่ตัดสิน volume filter มา**

### 8.2 วัดผลรวม

```sql
select * from public.setup_stats order by total_r desc nulls last;
```

### 8.3 วัดซ้ำว่าพื้นความเสี่ยงควรตั้งเท่าไร (งานข้อ 7.2 D)

`docs/queries/risk_floor_sweep.sql` — รันไฟล์นี้ทั้งไฟล์ผ่าน `mcp__Supabase__execute_sql`

มันไม่ได้อ่านค่าที่ตั้งอยู่ แต่**สร้างแผนใหม่ทุกค่า share แล้วเดินแท่งจริงซ้ำ**
แถว `share = 0` คือของเดิมที่ระบบบันทึกไว้ ใช้เป็นตัวตรวจว่าตัวจำลองยังตรงกับ
`evaluate_pending_outcomes()` อยู่ — **ถ้าแถวนั้นไม่ตรงกับ `setup_stats` แถวอื่นก็เชื่อไม่ได้**

**กติกาการอ่านผล (ตามลำดับ):**
1. ค่าข้างเคียงของตัวที่ชนะ เห็นด้วยกันไหม → ถ้าเห็นด้วย = เป็นผลจริง
2. ตัวที่ชนะ ดีขึ้น**ทุก instrument** ไหม → ถ้าดีแค่ตัวเดียว = fit ข้อมูลเซสชันเดียว

แถวเดียวที่สูงโดดโดยเพื่อนบ้านต่ำ คือการ fit ข้อมูล ไม่ใช่การค้นพบ

### 8.4 REV-RITHMIC-001 (ย้าย data source ไป Rithmic L2)

**บทวิเคราะห์ที่ให้ไว้: ทำ — แต่ทำแค่ STEP 1–6 (market-data + Mock/Replay provider)
ยังไม่ต้องต่อ Rithmic จริง**

เหตุผล: REV ซื้อ *ความต่อเนื่อง 24/7* ไม่ได้ซื้อ *คุณภาพสัญญาณ* และข้อมูลบอกว่า
ตอนนี้ยังไม่มีกฎไหนคุ้มที่จะรันนอกช่วง volume สูง

3 เรื่องที่ REV ไม่ได้พูดถึงและจะพังถ้าไม่แก้:
1. **price step ไม่ตรงกัน** (ดูข้อ 3.1) → ต้องมี `PRICE_STEP` ต่อ instrument
2. **`unique (instrument_id, timeframe, opened_at)` ไม่มี `source`** → Phase B รันคู่กันแล้วข้อมูลปน
   → ใช้ `timeframe` คนละค่า (`5m` vs `5m-rithmic`) หรือใส่ `source` ใน unique key
3. **queue ต้อง durable (disk-backed)** ไม่ใช่แค่ในหน่วยความจำ

จุดเล็กที่ต้องแก้ใน REV: §5 ขาดฟิลด์ `between` · §17 minDelta/maxDelta ต้องสะสมตามลำดับ trade
ไม่ใช่คำนวณจาก footprint สุดท้าย · §15 ต้องจับคู่ BBO ตาม timestamp ของ trade

**เหตุผลที่ดีที่สุดสำหรับ Rithmic ซึ่ง REV พูดน้อยเกินไป:** L2 depth เปิดกฎใหม่ที่ทำไม่ได้เลยตอนนี้
(absorption เทียบ resting size จริง, iceberg, book pulling) — กฎปัจจุบันเห็นแค่ trade ที่เกิดแล้ว

---

## 9. วิธีทำงานกับ repo นี้

```bash
# typecheck + test
# deno ไม่ได้ติดตั้งมากับคอนเทนเนอร์ ถ้า `deno: command not found` ให้ลงก่อน:
#   curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/opt/deno sh -s -- -y
export PATH=/opt/deno/bin:$PATH
deno task check
deno task test          # ปัจจุบัน 84 tests ผ่านหมด

# เว็บ
cd web && npm run build
```

**Deploy edge function:** ใช้ `mcp__Supabase__deploy_edge_function` ต้องส่ง **ทุกไฟล์**
ที่ `ingest/index.ts` import ถึง (โดย transitive) ไม่งั้นได้ 400 "Entrypoint path does not exist"

รายการไฟล์: `ingest/index.ts`, `_shared/{ingest,plan,liquidity,price_action,telegram,outcomes,types,util,evidence}.ts`,
`_shared/rules/{index,stacked_imbalance,delta_divergence,absorption,poc_shift}.ts`

**อัปเดต DLL บนเครื่อง Windows:**
```
cd C:\atas
git checkout main && git pull
scripts\update-indicator.bat        (ดับเบิลคลิกก็ได้)
```
แล้วปิด ATAS → เปิดใหม่ → ลบ Signal Bridge ตัวเก่าออกจากชาร์ต → Import → Custom → Add
เช็คแท็บ **About** ว่า commit ตรงกับที่สคริปต์พิมพ์ออกมา

---

## 10. โครงสร้างไฟล์

```
atas-indicator/AtasSignalBridge/    C# indicator (build บน Windows เท่านั้น)
supabase/migrations/                0001–0012
supabase/functions/_shared/
  ingest.ts        pipeline หลัก (batch write)
  plan.ts          trade plan
  liquidity.ts     volume gate
  price_action.ts  structure/BOS/CHoCH/sweep/zone (เก็บอย่างเดียว)
  overrides.ts     ตั้งค่าแยกราย instrument (ดู 5.5)
  rules/           4 กฎ + registry
  telegram.ts      ข้อความแจ้งเตือน
  outcomes.ts      reply ผลลัพธ์
web/                                Next.js dashboard
docs/queries/                       คิวรีวิเคราะห์ที่ใช้ซ้ำได้ (ดู 8.3)
scripts/update-indicator.{ps1,bat}  อัปเดต DLL
docs/SETUP.md                       คู่มือติดตั้งฉบับเต็ม
```

---

## 11. สิ่งที่ห้ามทำ

1. อย่าเชื่อว่า `TickSize` คือ tick ของตลาด
2. อย่าเปรียบเทียบ `bar` กับ `CurrentBar` ตรง ๆ ใน C#
3. อย่าบอกให้ก็อป DLL ไป `Documents\ATAS\Indicators\`
4. อย่าเพิ่มกฎใหม่ก่อนที่กฎเดิมจะพิสูจน์ตัวเอง — 4 กฎ × 2 ทิศทางยังตัดสินไม่ได้เลย
5. อย่าเปิดใช้ตัวกรองใหม่โดยไม่วัดก่อน — วัดแล้วค่อยกรอง คือวิธีที่ใช้มาตลอด
6. อย่าแก้ migration เก่า
7. อย่าสร้างสัญญาณจากแท่งที่ยังไม่ปิด
8. อย่าตั้งเกณฑ์ที่นับเป็น "แถว footprint" แล้วคาดว่าจะใช้ได้ทุก instrument — 1 แถวคนละขนาดกัน (ข้อ 5.4)
9. อย่าเลือกค่าจากแถวที่ดีที่สุดแถวเดียว ถ้าเพื่อนบ้านไม่เห็นด้วย นั่นคือ fit ข้อมูล
10. อย่ารายงานผลเป็น ticks ในเมื่อข้อความสัญญาณรายงานเป็นราคา — ไม้เดียวกันต้องใช้หน่วยเดียวกัน ไม่งั้นอ่านแล้วนึกว่าคนละไม้
11. อย่าปรับค่าจาก cell ที่ยังไม่ผ่าน `setup_stability` — เซสชันเดียวพลิกกลับข้างได้ทั้งอัน (ข้อ 5.5)
12. อย่าเล็งเป้าที่ win rate ตรง ๆ — ขยาย TP/ถือนานขึ้นทำให้ win rate ขึ้นแต่เงินหาย ค่า share 1.00 เคยให้ WR สูงสุด 50.5% แต่ได้ R น้อยกว่า 0.30 ที่ WR 47.2%
