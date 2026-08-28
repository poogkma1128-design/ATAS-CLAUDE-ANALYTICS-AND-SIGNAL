# ติดตั้งระบบ

สิ่งที่ deploy ไว้ให้แล้ว และสิ่งที่คุณต้องทำเอง แยกไว้ชัดเจนด้านล่าง

## สถานะปัจจุบัน

| ส่วน | สถานะ |
|---|---|
| Supabase project `atas-signal` | ✅ สร้างแล้ว |
| Migrations 0001–0007 | ✅ apply แล้ว |
| Edge Functions `ingest`, `outcome-notify` | ✅ deploy แล้ว (ACTIVE) |
| pg_cron ให้คะแนนผลลัพธ์ทุกนาที | ✅ ทำงานอยู่ |
| กฎเริ่มต้น 4 ข้อ | ✅ seed แล้ว |
| Secrets (token ต่าง ๆ) | ⬜ **คุณต้องตั้งเอง** — ขั้นตอนที่ 1 |
| Dashboard บน Vercel | ⚠️ project ผูกกับ repo แล้ว แต่ build ไม่ผ่าน — ขั้นตอนที่ 2 |
| ATAS indicator (.dll) | ⬜ **คุณต้อง build เอง** — ขั้นตอนที่ 3 |

Project URL: `https://sckdriuwfyittcybnbhz.supabase.co`

---

## 1. ตั้ง secrets บน Supabase

ไปที่ **Project Settings → Edge Functions → Secrets** แล้วเพิ่ม:

| ชื่อ | ค่า |
|---|---|
| `INGEST_TOKEN` | สุ่มขึ้นมาเอง เช่นด้วย `openssl rand -hex 32` — ค่านี้ต้องใส่ใน indicator ด้วย |
| `TELEGRAM_BOT_TOKEN` | ได้จาก [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | id ของแชตหรือกลุ่มที่จะให้ยิงเข้า |
| `DASHBOARD_URL` | URL ของ dashboard บน Vercel (ใส่ทีหลังได้) |

**ถ้ายังไม่ตั้ง `TELEGRAM_*`** ระบบยังทำงานปกติ เก็บสัญญาณครบทุกอย่าง เพียงแต่ไม่ส่งแจ้งเตือน
**ถ้ายังไม่ตั้ง `INGEST_TOKEN`** endpoint จะปฏิเสธทุก request (ตั้งใจให้เป็นแบบนั้น)

### หา chat id ยังไง

ส่งข้อความอะไรก็ได้หาบอทของคุณ แล้วเปิด:

```
https://api.telegram.org/bot<TOKEN>/getUpdates
```

ดูที่ `result[0].message.chat.id` (กลุ่มจะเป็นเลขติดลบ)

### ทดสอบว่า endpoint ใช้ได้

```bash
curl -i -X POST "https://sckdriuwfyittcybnbhz.supabase.co/functions/v1/ingest" \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "TEST", "tickSize": 0.25, "timeframe": "5m",
    "bars": [{
      "openedAt": "2026-08-27T10:00:00.000Z",
      "open": 100, "high": 101, "low": 100, "close": 100.75,
      "volume": 126, "askVolume": 110, "bidVolume": 16,
      "delta": 94, "minDelta": -5, "maxDelta": 100,
      "ticks": 40, "trades": 30, "isClosed": true,
      "levels": [
        {"price":100.00,"ask":2, "bid":5,"between":0,"volume":7, "ticks":2},
        {"price":100.25,"ask":30,"bid":4,"between":0,"volume":34,"ticks":9},
        {"price":100.50,"ask":40,"bid":3,"between":0,"volume":43,"ticks":11},
        {"price":100.75,"ask":35,"bid":2,"between":0,"volume":37,"ticks":10}
      ]
    }]
  }'
```

ควรได้ `{"ok":true,"barsWritten":1,"levelsWritten":4,"signalsCreated":1,...}`
และมีข้อความ Long / Stacked Imbalance เข้า Telegram

ลบข้อมูลทดสอบทิ้งด้วย SQL: `delete from public.instruments where symbol = 'TEST';`

---

## 2. Dashboard (Vercel)

> **แก้ข้อมูลเดิม:** ตอนแรกผมเข้าใจผิดว่าสร้าง project ไม่สำเร็จ เพราะ Vercel API
> ตอบ 404 ทุกครั้งที่อ่านกลับ **ความจริงคือสร้างสำเร็จและผูกกับ repo นี้เรียบร้อยแล้ว**
> ตอนเปิด PR ทั้งสอง project เริ่ม build ทันที — ขออภัยที่บอกให้ลบทิ้งทั้งคู่

### สถานะจริงตอนนี้

มี project ผูกกับ repo นี้อยู่ **2 ตัว** ซึ่งจะ build ทุกครั้งที่ push:

| Project | สถานะ |
|---|---|
| `atas-signal-board` | กำลัง build |
| `atas-signal-dashboard` | ❌ build ไม่ผ่าน |

**เลือกเก็บไว้ตัวเดียว แล้วลบอีกตัวทิ้ง** ไม่งั้นจะ build ซ้ำซ้อนทุก push

### build ไม่ผ่าน — ยังหาสาเหตุไม่เจอ

> **แก้ที่ผมวินิจฉัยผิด:** ตอนแรกผมบอกว่าสาเหตุคือไม่ได้ตั้ง Root Directory
> **ผิดครับ** — metadata ที่ Vercel bot ส่งมาใน PR ระบุว่า `"rootDirectory":"web"`
> ตั้งไว้ถูกต้องแล้วทั้งสอง project

สิ่งที่**ตัดออกไปได้แล้ว**:

| สมมติฐาน | ผลตรวจ |
|---|---|
| Root Directory ไม่ได้ตั้ง | ❌ ไม่ใช่ — ตั้งเป็น `web` แล้วทั้งคู่ |
| ไม่มี env var | ❌ ไม่ใช่ — build โดยไม่มี env var เลยก็ผ่าน (Supabase ถูกเรียกตอน request ไม่ใช่ตอน build) |
| lockfile ไม่ตรงกับ package.json | ❌ ไม่ใช่ — `npm ci` สะอาด |

ผมดึง build log มาดูไม่ได้ เพราะเครื่องมือที่ใช้อ่าน Vercel ตอบ 404 ทุกครั้ง
(ลองแล้วทั้ง deployment ID, hostname, team ID และ team slug)

**ถ้า build ยังไม่ผ่าน** เปิด log จากลิงก์ในหน้า project แล้วดูบรรทัด error
โดยตรง — สาเหตุน่าจะอยู่บรรทัดท้ายๆ ของ build log

หมายเหตุ: `next` ถูกอัปจาก 15.1.6 เป็น 15.5.24 แล้ว เพราะ 15.1.6 ถูก deprecate
บน npm จากช่องโหว่ security ถ้าสาเหตุที่ build ไม่ผ่านคือ Vercel บล็อกเวอร์ชัน
ที่มี CVE การอัปรอบนี้ก็จะแก้ไปด้วยในตัว

### Environment variables

ใส่ทั้งสองตัวก่อนกด Deploy:

```
NEXT_PUBLIC_SUPABASE_URL=https://sckdriuwfyittcybnbhz.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_WgRuqIaGzhXVWtk-ZGdCuQ_BVQhFktL
```

ทั้งคู่เป็นคีย์ฝั่ง client ที่ตั้งใจให้เปิดเผยได้อยู่แล้ว ข้อมูลถูกกันด้วย RLS ไม่ใช่ด้วยการซ่อนคีย์

### หลัง deploy เสร็จ

เอา URL ที่ได้ไปใส่เป็น `DASHBOARD_URL` ใน Supabase secrets
เพื่อให้ปุ่ม "ดูรายละเอียด" ในข้อความ Telegram ลิงก์กลับมาถูกที่

### สร้างบัญชีเข้าใช้งาน

Dashboard ล็อกด้วย Supabase Auth (ส่งลิงก์เข้าอีเมล) — สัญญาณของคุณไม่เปิดสาธารณะ

1. เปิด `/login` แล้วใส่อีเมลของคุณ กดรับลิงก์
2. เปิดอีเมล กดลิงก์ → เข้าใช้งานได้

เมื่อสร้างบัญชีตัวเองเสร็จแล้ว ให้ไปปิดการสมัครใหม่ที่
**Authentication → Sign In / Providers → ปิด "Allow new users to sign up"**
เพื่อไม่ให้คนอื่นสมัครเข้ามาได้

---

## 3. Build ATAS indicator

> โปรเจกต์ C# **build ได้บนเครื่อง Windows ที่ลง ATAS เท่านั้น** เพราะ ATAS SDK
> ไม่ได้เผยแพร่บน NuGet — csproj อ้าง DLL ตรงจากโฟลเดอร์ที่ติดตั้ง ATAS ไว้

### เวอร์ชัน .NET

ATAS รันบน **.NET 10** (`Microsoft.WindowsDesktop.App 10.0.0`) ซึ่งเป็นค่า default
ของโปรเจกต์อยู่แล้ว ปกติจึงสั่ง build เฉยๆ ได้เลย

ถ้าอยากยืนยันกับเครื่องตัวเอง: เปิด `C:\Program Files (x86)\ATAS Platform\`
หาไฟล์ `*.runtimeconfig.json` แล้วดูค่า `version`

ต้องลง **.NET 10 SDK** ก่อน → https://dotnet.microsoft.com/download/dotnet/10.0

```powershell
cd atas-indicator
dotnet build -c Release
```

ถ้าเครื่องคุณใช้เวอร์ชันอื่น สั่งทับได้โดยไม่ต้องแก้ไฟล์:

```powershell
dotnet build -c Release -p:AtasTargetFramework=net8.0-windows
```

ถ้าลง ATAS ไว้คนละที่:

```powershell
dotnet build -c Release "-p:AtasPath=D:\ATAS Platform\"
```

### ติดตั้ง

1. copy `AtasSignalBridge.dll` ที่ได้ ไปวางที่
   `%USERPROFILE%\Documents\ATAS\Indicators\`
2. เปิด ATAS ใหม่
3. บนชาร์ต → Indicators → หมวด **Order Flow** → **Signal Bridge**

### ตั้งค่าใน indicator

| ช่อง | ใส่อะไร |
|---|---|
| Endpoint URL | `https://sckdriuwfyittcybnbhz.supabase.co/functions/v1/ingest` |
| Ingest token | ค่าเดียวกับ `INGEST_TOKEN` |
| Timeframe label | ป้ายกำกับชาร์ตนี้ เช่น `5m`, `1h`, `2000t` — **ใช้คนละค่าต่อหนึ่งชาร์ต** |
| Backfill bars on start | 100 (ส่งแท่งเก่าครั้งเดียวตอนโหลด เพื่อให้กฎมีประวัติใช้ทันที) |
| Send live bar updates | ปิดไว้ก่อนก็ได้ — กฎไม่เคยตัดสินแท่งที่ยังไม่ปิดอยู่แล้ว |

ถ้ายังไม่ใส่ URL หรือ token indicator จะไม่ทำอะไรและขึ้นข้อความเตือนใน log ของ ATAS

---

## 4. จูนกฎ

หน้า `/rules` บน dashboard แก้ค่าได้ทุกตัวแล้วกดบันทึก **มีผลกับแท่งถัดไปทันที
ไม่ต้อง deploy ใหม่ ไม่ต้อง build indicator ใหม่**

| กฎ | ค่าที่ปรับได้ |
|---|---|
| `stacked_imbalance` | `ratio` (เท่าตัวที่ถือว่า imbalance), `minVolume`, `stack` (กี่ระดับติดกัน) |
| `delta_divergence` | `lookback` (เทียบย้อนกี่แท่ง), `minDeltaMagnitude` |
| `absorption` | `volumeMultiple`, `edgeTicks`, `rejectionTicks` |
| `poc_shift` | `minTicks`, `consecutive`, `hvnShare` |

`horizon_bars` คือจำนวนแท่งหลังสัญญาณที่ใช้วัดผล — เปลี่ยนแล้วมีผลกับสัญญาณใหม่เท่านั้น

---

## 5. สถิติเริ่มมาเมื่อไหร่

ทุกสัญญาณจะถูกตั้งเป็น `pending` ทันทีที่เกิด แล้ว `pg_cron` จะเช็คทุกนาทีว่ามีแท่ง
ครบตาม `horizon_bars` หรือยัง ถ้าครบก็คำนวณ MFE / MAE / กำไรขาดทุนเป็น tick แล้วเปลี่ยนเป็น `resolved`

- ตัวเลขทั้งหมดมาจากแท่งที่ ATAS ส่งเข้ามาเอง **ไม่ต้องพึ่งข้อมูลราคาจากที่อื่น**
- ถ้าปิดชาร์ตไปนานจนไม่มีแท่งเข้ามาเกิน 24 ชม. สัญญาณนั้นจะกลายเป็น `expired`
  และไม่ถูกนับรวมในสถิติ (กันไม่ให้ win rate เพี้ยน)
- ผลลัพธ์จะถูก reply กลับไปที่ข้อความ Telegram เดิมของสัญญาณนั้นด้วย

---

## แก้ปัญหา

| อาการ | สาเหตุที่พบบ่อย |
|---|---|
| `401 unauthorized` | `INGEST_TOKEN` ใน Supabase ไม่ตรงกับใน indicator |
| `400 tickSize must be a positive number` | indicator อ่าน `InstrumentInfo` ไม่ได้ — รอให้ชาร์ตโหลดข้อมูลเสร็จก่อน |
| ไม่มีสัญญาณเลย | ปกติในช่วงแรก — กฎอย่าง `delta_divergence` ต้องมีประวัติ 5 แท่งก่อน ลองลด `stack` หรือ `ratio` ที่หน้า `/rules` |
| ไม่มีข้อความเข้า Telegram | ยังไม่ตั้ง `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` หรือยังไม่ได้กด Start คุยกับบอท |
| ชาร์ตหน่วง | ปิด "Send live bar updates" — การส่งทุกแท่งที่ปิดแล้วก็เพียงพอ |
| Dashboard ว่างเปล่าทั้งที่มีข้อมูล | ยังไม่ได้ล็อกอิน — RLS ให้เห็นข้อมูลเฉพาะผู้ที่ล็อกอินแล้ว |

ดู log ของ ingest ได้ที่ตาราง `public.ingest_log` (เก็บจำนวนแท่ง/level/signal และ error ของทุก request)
