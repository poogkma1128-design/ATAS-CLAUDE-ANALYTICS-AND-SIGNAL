# ATAS Orderflow Signal System

> **เริ่มงานต่อจากที่ค้างไว้:** อ่าน [`docs/HANDOFF.md`](docs/HANDOFF.md) ก่อน
> — สถานะปัจจุบัน ตัวเลขที่วัดจริง งานที่ค้าง และกับดักที่แลกมาด้วยการดีบักแล้ว

ดึงตัวเลข **cluster / delta / imbalance** จริงออกจาก ATAS → ให้ server ตัดสินสัญญาณ →
ยิงเข้า Telegram → ดูและวัดผลได้จาก dashboard ทุกที่

แทนที่จะเดาจากภาพหน้าจอ ระบบนี้เก็บตัวเลขจริงทุกแท่ง แล้วตอบคำถามเดียวที่สำคัญ:
**setup ไหนได้เงินจริง**

```
ATAS Platform (Windows)
  └── SignalBridge.dll ── background queue ──> HTTPS POST
                                                    │
                            Supabase Edge Function `ingest`
                              ├── เก็บ bars + footprint
                              ├── รันกฎ (อ่าน threshold จากตาราง rules)
                              ├── บันทึก signals (กันซ้ำด้วย unique constraint)
                              └── ส่ง Telegram
                                                    │
                              Postgres + Realtime
                                                    │
                    pg_cron ── evaluate_pending_outcomes() ──> MFE / MAE / win rate
                                                    │
                              Next.js dashboard (Vercel)
```

## หลักคิดของดีไซน์

**Indicator โง่ที่สุดเท่าที่จะทำได้ ความฉลาดอยู่บน server ทั้งหมด**

ATAS indicator เขียนด้วย C# ซึ่งต้อง compile และ restart ทุกครั้งที่แก้ ถ้าเอาตรรกะตัดสิน
สัญญาณไปไว้ในนั้น การจูน threshold ทีนึงจะกินเวลาเป็นสิบนาที และ backtest กับข้อมูลเก่าไม่ได้เลย

ระบบนี้จึงให้ indicator ทำแค่อ่าน footprint แล้วยิงตัวเลขดิบออกมา ส่วนกฎทั้งหมดอยู่ใน
Edge Function โดย threshold เก็บเป็นแถวในตาราง `rules` → **แก้ค่าจากหน้าเว็บแล้วมีผลกับแท่งถัดไปทันที**

## โครงสร้าง

| โฟลเดอร์ | คืออะไร |
|---|---|
| `atas-indicator/` | C# indicator ที่รันใน ATAS (build บน Windows เท่านั้น) |
| `supabase/migrations/` | schema, RLS, outcome tracking, seed กฎ |
| `supabase/functions/` | `ingest`, `outcome-notify` และ rule engine |
| `web/` | Next.js dashboard (Vercel root directory = `web`) |
| `docs/SETUP.md` | ขั้นตอนติดตั้งทีละขั้น |

## กฎที่มีให้ v1

| กฎ | จับอะไร |
|---|---|
| `stacked_imbalance` | Diagonal imbalance ต่อเนื่องหลายระดับราคา |
| `delta_divergence` | ราคาทำ high/low ใหม่ แต่ delta สวนทาง |
| `absorption` | Volume หนักผิดปกติที่ปลายแท่ง แล้วราคาถอยกลับ |
| `poc_shift` | Point of Control ขยับทางเดียวต่อเนื่อง |

เพิ่มกฎใหม่ = เขียนไฟล์ใน `supabase/functions/_shared/rules/` → ลงทะเบียนใน `rules/index.ts`
→ insert หนึ่งแถวใน `public.rules`

## รันเทสต์

```bash
deno task test     # rule engine + ingest orchestration (34 tests)
deno task check    # type check ทั้ง edge functions
cd web && npm run build
```

## ติดตั้ง

ดู [`docs/SETUP.md`](docs/SETUP.md)
