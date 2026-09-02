# HANDOFF — สถานะโปรเจกต์ ณ 2026-09-02 (Evidence-first signal quality)

เอกสารนี้เขียนไว้ให้ **แชทใหม่อ่านแล้วทำงานต่อได้ทันที** โดยไม่ต้องไล่ย้อนบทสนทนาเดิม
สิ่งที่อยู่ในนี้คือข้อเท็จจริงที่ **ตรวจสอบกับระบบจริงแล้ว** ไม่ใช่การเดา

> **กติกาถาวรจากเจ้าของ (Definition of Done):** งานใดจะถือว่า “จบ” ได้ก็ต่อเมื่ออัปเดต
> `docs/HANDOFF.md` และเอกสารที่จำเป็นต่อการรับช่วงงานนั้นแล้วเสมอ. เอกสารต้องบอก
> สิ่งที่เปลี่ยน, สิ่งที่ deploy แล้ว/ยังไม่ deploy, หลักฐานตรวจสอบ, ความเสี่ยงหรือข้อห้าม,
> งานค้าง, owner/approval ที่ต้องมี และวิธี rollback เมื่อเกี่ยวข้อง. ห้ามข้ามขั้นนี้แม้งาน
> จะเล็ก, ถูก merge แล้ว หรือเป็นเพียงการทดลอง. ถ้าไม่มีเอกสารที่ต้องเพิ่ม ให้บันทึกใน
> Handoff ว่า “ไม่มีเอกสารเพิ่ม” พร้อมเหตุผล.

---

## 0H. รับรองนโยบายแบ่งงานและตรวจหลักฐาน หลัง PR #58 (ตรวจ: 2026-09-02)

> **สถานะ Git ปัจจุบันของเอกสาร:** PR #57 merge แล้วที่ `d52da91`; PR #58 merge แล้วที่
> `4d6a97e`. งานหัวข้อนี้เป็น follow-up จาก production commit `4d6a97e` และแก้เฉพาะเอกสาร/
> query อ่านอย่างเดียว — **ไม่แก้ signal logic, parameter, Telegram, database, Edge Function,
> web หรือ DLL และไม่มี deploy**.

GPT/Codex อ่านและท้าทายร่าง §5.21 ที่ Claude เสนอแล้ว ผลคือ **รับรองหลักการโดยแก้ 2 จุด**:

1. `SQL/DB` เป็นแหล่งหลักฐานตัวเลข ไม่ใช่ “ผู้ตรวจ”. ผู้ตรวจต้องเป็นคน/AI session ที่เป็นอิสระ
   และต้องรัน SQL/code ซ้ำกับ artifact ดิบด้วยตัวเอง.
2. ตาราง GPT/Claude เป็น **routing preference** ตามหลักฐานในโปรเจกต์ ไม่ใช่ใบอนุญาตให้รวมบทบาท.
   ทุก hypothesis ยังต้องแยก `Proposer → Executor/Recorder → Independent Reviewer → Owner`;
   ผู้เสนอหรือผู้รันห้ามอนุมัติผลตัวเอง แม้ชื่อโมเดลในตารางจะตรงกับงานนั้น.

หลังแก้สองจุดนี้ นโยบายถือว่าได้รับการตรวจจากคนละฝั่งแล้วและใช้เป็นกติกาของ repo ได้. รายละเอียด
ที่ใช้ลงมือจริงอยู่ใน `docs/EXPERIMENT_REVIEW_PROTOCOL.md`; `AGENTS.md` บังคับให้อ่าน protocol
ก่อนงานทดลอง/สัญญาณ. §5.21 เก็บตารางเจ้าภาพ จุดอ่อน ระดับ L1–L4 และตัวอย่างส่งงานผิดคน 9 กรณี.

**สิ่งที่ยังไม่รับรอง:** ตัวเลขใน §5.18a ยังเป็นผลที่ผู้เสนอรายงานและยังไม่มี independent raw re-run
ตาม evidence packet ใหม่. ดังนั้นคำตัดสินที่ปลอดภัยมีเพียง **คง runtime เดิม ไม่รับ threshold ใหม่**
เพราะหลักฐานไม่พอ; ห้ามยกระดับเป็นคำกล่าวว่า variant ต่างกันอย่างมีนัยสำคัญ หรือใช้เปิด/ปิด Telegram.

**Verification/rollback:** ตรวจ diff และ Markdown/SQL แบบ static ใน PR follow-up นี้. ไม่มี runtime test
เพราะไม่มี runtime change. Rollback คือ revert commit เอกสาร; ไม่ต้อง rollback schema/function/DLL.

---

## 0G. ป้ายราคา Entry / SL / TP / Exit และสีที่ปรับได้ — REV 1.4.0 (ตรวจ: 2026-09-02 03:54 UTC)

> **ให้อ่านหัวข้อนี้ก่อน §0F เมื่อติดตั้งหรือทดสอบ overlay.** Screenshot จาก ATAS จริงยืนยันว่า
> REV 1.3.2 ทำให้ marker สั้นและอ่านง่ายขึ้น แต่ป้าย `▲ L`, `▼ S`, `SL`, `TP`, `TR` ไม่มีตัวเลขราคา
> จึงยังไม่ครบข้อมูลสำหรับออกคำสั่ง. งานนี้เพิ่มเฉพาะ presentation ใน Indicator; **ไม่แก้** signal logic,
> การคำนวณ Entry/SL/TP, instrument policy, ingest, Telegram, database, web หรือ Edge Function.

| อะไร | สถานะปัจจุบัน |
|---|---|
| หลักฐานปัญหา | ภาพ ATAS วันที่ 2026-09-02 แสดง marker compact ชัดขึ้น แต่ต้องไล่อ่านตำแหน่งแกนราคาเองและไม่มีป้ายแผน SL/TP พร้อมตัวเลข |
| Source ใหม่ | branch `codex/configurable-plan-price-labels`; indicator commit `651d297`; **[PR #57](https://github.com/poogkma1128-design/ATAS-CLAUDE-ANALYTICS-AND-SIGNAL/pull/57) merge แล้ว** ที่ `d52da91`; indicator **REV 1.4.0** |
| ป้ายราคา | Entry แสดง `▲ L ราคา` หรือ `▼ S ราคา` เสมอ; ที่แท่งเข้าแสดง `SL ราคา` และ `TP ราคา` เป็นค่าเริ่มต้น; resolved exit แสดง `TP/SL/TR/TIME/EXIT ราคา` ตามผลจริง |
| ลดความรก | `Show SL / TP price labels` ปิดเฉพาะป้ายแผนได้; `Show signal IDs` ปิดเป็นค่าเริ่มต้นและใช้เติม `#S...` เพื่อ audit; plan lines ยังปิดเป็นค่าเริ่มต้น |
| ปรับหน้าตา | font 8–32px (default 14), opacity 80–255 (default 235), และสีแยก Long, Short, SL, TP, trailing, timeout, other exit, text, border ในกลุ่ม `Overlay Colors` |
| ความถูกต้อง | ตัวเลขใช้ `item.Entry/Stop/Target/ExitPrice` ที่ endpoint ส่งมาโดยตรงและ format ตาม tick size; Indicator ไม่คำนวณหรือขยับราคาใหม่ |
| Verification ก่อน push | `dotnet build -c Release` ผ่าน 0 warning / 0 error; assembly version `1.4.0`. Reflection ยืนยัน defaults `priceLabels=true`, `IDs=false`, `font=14`, `opacity=235`, พบ color properties 9 ช่อง และ text examples `▲ L 29069.75 / SL 29055.50 / TP 29112.50 / TR 29075.25` |
| Deploy | ไม่มี server/database/web deploy และไม่มี DLL track ใน Git. Updater ดึง source REV 1.4.0 ได้หลัง PR #57 merge; การติดตั้ง DLL ใน ATAS ยังเป็นขั้นของเจ้าของ |
| Visual acceptance หลัง merge | **ไม่ผ่านด้วยค่าเริ่มต้นที่แสดงป้ายทุกแผน:** screenshot จริงแสดง Entry/SL/TP/exit หลายชุดทับแท่งและทับกันจนรก. ตัวเลขราคาอ่านได้แต่พื้นที่ตัดสินใจถูกบัง; ห้ามเรียกว่า professional/ผ่านเพียงเพราะ build และ PR เขียว |
| เอกสาร | อัปเดต `docs/SETUP.md` และ Handoff นี้; ไม่เพิ่ม runbook แยกเพราะ SETUP และ §0G.1 ครบขั้นติดตั้ง/acceptance/rollback |

### 0G.1 ขั้นรับช่วง, acceptance และ rollback

1. หลัง PR merge ให้รัน `scripts\update-indicator.bat`; ต้อง build จาก production branch และเห็น
   REV 1.4.0. ปิด ATAS รวม system tray → Import DLL บน Desktop → ลบ/Add Signal Bridge ใหม่ →
   About ต้องเป็น REV 1.4.0.
2. ค่าใช้งานชั่วคราวหลัง screenshot ไม่ผ่าน: `Show trade overlay=true`,
   `Show SL / TP price labels=false`, plan lines=false, `Show signal IDs=false`, font 10–11 และ
   ลด lookback เหลือประมาณ 50–80 bars. เปิดป้าย SL/TP เฉพาะตอน audit. Acceptance รอบถัดไปต้องเห็น
   Entry/exit price ที่จำเป็นโดยไม่บังแท่งหลักและไม่มี lane ซ้อนจนอ่านไม่ได้; ต้องแนบ screenshot.
3. สุ่มเทียบตัวเลขหนึ่ง Long และหนึ่ง Short กับ dashboard/Telegram: Entry, SL, TP และ resolved exit
   ต้องตรงทุกหลักตาม tick size. ตรวจว่า feed/Telegram ไม่เปลี่ยนและ NQU6 shadow ยังไม่วาด.
4. ทดสอบ parameter: เปลี่ยน font, opacity และอย่างน้อยสี Long/SL/TP แล้วต้องเห็นผลหลัง recalculate;
   เปิด `Show signal IDs` แล้วต้องเห็น `#S...`; ปิด `Show SL / TP price labels` แล้วต้องเหลือ
   Entry/Exit price โดยไม่กระทบ signal.
5. Rollback เร็วสุดคือปิด `Show SL / TP price labels` หรือ `Show trade overlay`; หากต้องย้อน code
   ให้ Import REV 1.3.2. ไม่มี schema/function/server ให้ rollback.

---

## 0F. Professional compact ATAS markers — REV 1.3.2 (ตรวจ: 2026-09-02 03:29 UTC)

> **ให้อ่านหัวข้อนี้ก่อน §0E/§0C เมื่อติดตั้งหรือทดสอบ overlay.** Screenshot จาก ATAS จริง
> พิสูจน์ว่า REV 1.3.1 **ไม่ผ่าน visual acceptance**: ข้อความ audit ยาวทุก Entry/Exit ซ้อนกันมาก
> และต้อง zoom เข้าเพื่ออ่าน. งานนี้แก้เฉพาะการวาด marker; ไม่แก้ signal logic, ราคา Entry/SL/TP,
> instrument policy, ingest, Telegram, database หรือ Edge Function.

| อะไร | สถานะปัจจุบัน |
|---|---|
| หลักฐานปัญหา | ภาพ ATAS วันที่ 2026-09-02 มีป้าย `ENTRY LONG/SHORT #S... @ price` และ `EXIT ...` หลายสิบป้ายทับแท่ง/กันเอง; จึงยกเลิกคำอ้างเดิมว่า REV 1.3.1 อ่านได้เมื่อซูมออก |
| Root cause | `DrawingText.AutoSize=true` ทำให้ ATAS ปรับขนาดตาม scale และทุก marker ใส่ direction + sequence + exact price จึงกว้างโดยโครงสร้าง |
| Source ใหม่ | branch `codex/professional-overlay-markers`; indicator commit `6df20e8`; **PR #56 merge แล้ว** ที่ production merge commit `a6d74b8`; indicator **REV 1.3.2** |
| รูปแบบเริ่มต้น | Entry ใช้ `▲ L` สีเขียว / `▼ S` สีแดง; exit ใช้ `TP` เขียว, `SL` แดง, `TR` น้ำเงิน, `TIME` ส้ม หรือ `EXIT`. ขนาด 14px คงที่ (`AutoSize=false`) |
| ความสะอาด | ปิด `Show marker details` เป็นค่าเริ่มต้น, จุดยัง anchor ที่ exact price เดิม และ marker ที่อยู่ bar/ด้านเดียวกันแยก lane แนวตั้งอัตโนมัติ |
| Audit mode | เปิด `Show marker details` เพื่อเติม `#S... @ ราคา` ทุก marker ได้; เตือนชัดว่าอาจทำกราฟรก |
| Verification | `dotnet build -c Release` ผ่าน **0 warning / 0 error**; assembly version `1.3.2`. Reflection ยืนยัน defaults `lines=false`, `details=false`, `font=14` และ text contract `▲ L / ▼ S / TP / SL / TR`. Screenshot หลัง import ยืนยันขนาด/ความอ่านง่ายดีขึ้น แต่พบ requirement gap ว่าไม่มีราคาบนป้าย จึงรับช่วงต่อใน §0G |
| Deploy/server | **ไม่มี server/database/web deploy** และไม่มี binary track ใน Git; [PR #56](https://github.com/poogkma1128-design/ATAS-CLAUDE-ANALYTICS-AND-SIGNAL/pull/56) merge แล้ว. Screenshot จริงยืนยัน compact marker อ่านง่ายขึ้น แต่ข้อกำหนดขยายเป็นป้ายราคาตาม §0G |
| เอกสาร | อัปเดต `docs/SETUP.md` และ Handoff นี้; ไม่สร้าง runbook แยกเพราะ build/import/rollback อยู่ใน SETUP/§0F.2 แล้ว |

### 0F.1 เหตุผลเชิงมาตรฐานที่ใช้ตัดสินรูปแบบ

1. ATAS ระบุว่า `DrawingText.AutoSize` ปรับขนาดข้อความตาม chart scale และ overload `AddText`
   มี default `autoSize=false`; จึงใช้ fixed-size สำหรับ marker ที่ต้องอ่านได้สม่ำเสมอ:
   <https://docs.atas.net/en/classATAS_1_1Indicators_1_1Drawing_1_1DrawingText.html> และ
   <https://docs.atas.net/en/md_DataFeedsCore_2Docs_2en_20060__EmbeddedGraphicShapes.html>.
2. TradingView แนะนำ shape/arrow/label ที่ tether กับ bar สำหรับ event และเตือนให้ลด clutter;
   NinjaTrader ก็มี arrow/dot/diamond/square/triangle เป็น marker มาตรฐาน. งานนี้จึงใช้คำสั้นกับสี
   แทน audit sentence ทุกจุด: <https://www.tradingview.com/pine-script-docs/visuals/text-and-shapes/>
   และ <https://ninjatrader-devel.ninjatrader.com/support/helpguides/nt8/working_with_drawing_tools__ob.htm>.

### 0F.2 ขั้นรับช่วง, acceptance และ rollback

1. หลัง PR merge: ดับเบิลคลิก `scripts\update-indicator.bat`; ต้องเห็น production branch ถูกต้อง,
   build/version/hash ผ่าน และ REV 1.3.2. ปิด ATAS รวม system tray → Import DLL บน Desktop →
   ลบ/Add Signal Bridge ใหม่ → About ต้องเป็น REV 1.3.2.
2. ค่า acceptance: `Show trade overlay=true`, plan lines=false, details=false, font size=14. ที่ zoom
   ใช้งานปกติต้องแยก `▲ L`, `▼ S`, `TP`, `SL`, `TR` ได้, marker ไม่ย่อตาม zoom และ marker ใน
   bar/ด้านเดียวกันไม่ทับกัน. เก็บ screenshot จริงเพิ่มในหัวข้อนี้; build ผ่านอย่างเดียวห้ามสรุปว่า UI ผ่าน.
3. ตรวจ regression: ราคา anchor ของ marker ต้องตรง signal/outcome เดิม, feed/Telegram ต้องไม่เปลี่ยน,
   NQU6 shadow ต้องยังไม่วาด. เปิด details ชั่วคราวเพื่อเทียบ `#S... @ ราคา` กับ dashboard ได้.
4. Rollback เร็วสุดคือปิด `Show trade overlay`; หรือ Import DLL REV 1.3.1 กลับ. ไม่มี schema/function
   ให้ rollback. หากเพียงต้องการ audit text ไม่ต้อง downgrade—เปิด `Show marker details`.

---

## 0E. แก้ Indicator updater ดึง branch ผิด (ตรวจ: 2026-09-02 02:55 UTC)

> **ให้อ่านหัวข้อนี้ก่อนติดตั้ง DLL.** ภาพจากการรันจริงพบว่า updater เดิม checkout
> `origin/main` ที่ค้างอยู่ จึง build **REV 1.2.1 / commit `7b14ce3`** ทั้งที่ production
> มี REV 1.3.1 แล้ว. ปัญหาอยู่ที่ updater ไม่ใช่ signal logic หรือ source ของ indicator.

| อะไร | สถานะปัจจุบัน |
|---|---|
| Root cause | `scripts/update-indicator.ps1` hardcode `git checkout -B main origin/main`; แต่ production branch ของ repo นี้คือ `claude/form-signal-telegram-rz8am1` |
| Source ที่ยืนยัน | production HEAD `2581b9b`; indicator REV `1.3.1`; indicator commit `51e2b3e` (REV 1.3.2 อยู่ใน §0F และยังไม่ merge ณ snapshot นี้) |
| วิธีแก้ | fetch production ด้วย refspec ตรง, build จาก detached worktree ชั่วคราว, ไม่ checkout/reset working tree ของผู้ใช้, ตรวจ assembly version และ SHA-256 หลัง copy |
| UX/encoding | `.bat` ตั้ง UTF-8 และข้อความ updater ใช้ ASCII English จึงไม่ขึ้นตัวอักษรไทยเป็นสี่เหลี่ยมบน Windows PowerShell 5.1 |
| Verification | ทดสอบครบ fetch → restore/build → version check → copy/hash check ผ่าน; .NET SDK 10.0.400, build 0 warning / 0 error, DLL version 1.3.1, SHA-256 `5A6276375E58568985F9A5C97370A8CE7C51F9A4CCB417001F1975F92570AA93` |
| Deploy/server | ไม่มี Edge Function, database, web หรือ signal-logic change |
| Git | **PR #54 merge แล้ว** ที่ `cd43d46`; PR #55 อัปเดต current Handoff merge แล้วที่ `2581b9b`. updater ตัวแก้อยู่ production แล้ว |

### 0E.1 วิธีใช้, acceptance และ rollback

1. หลังงานนี้ merge ให้ดึง repo ล่าสุดหนึ่งครั้ง แล้วจากนั้นดับเบิลคลิก
   `scripts\update-indicator.bat` ได้ทุกครั้ง; updater จะดึง production ล่าสุดเองและวาง
   `AtasSignalBridge.dll` บน Desktop. ไม่ต้อง checkout `main` และไม่ต้องตอบให้ลบงานค้างอีก.
2. Acceptance ในหน้าต่าง updater: ต้องเห็น `Production branch: claude/form-signal-telegram-rz8am1`,
   `Build passed; DLL version verified`, `SHA-256 copy verification passed` และ ณ snapshot นี้ต้องเห็น
   `REV 1.3.1 | commit 51e2b3e`. ในอนาคตเลขเปลี่ยนได้เมื่อ source indicator บน production เปลี่ยน.
3. Acceptance ใน ATAS: ปิดโปรแกรมรวม system tray → Import DLL ใหม่ → ลบ/Add Signal Bridge →
   About ต้องตรงกับ REV/indicator commit ที่ updater พิมพ์. การ build ผ่านยังไม่ยืนยันว่า ATAS เลิก cache
   DLL เก่า จึงห้ามข้ามขั้น About.
4. Rollback code ทำได้โดย revert commit ของ updater แต่ **ห้ามกลับไปใช้ `origin/main` หรือ
   `reset --hard`**. หาก GitHub/fetch ล้ม updater จะหยุดโดยไม่แตะ DLL เดิมและไม่แก้ checkout.

---

## 0D. สถานะปัจจุบันเดียวที่ใช้รับช่วงงาน (ตรวจ: 2026-09-02 02:55 UTC)

> **เริ่มอ่านสถานะระบบจากหัวข้อนี้ และอ่าน §0E ก่อนติดตั้ง DLL.** §0C / §0B / §0A และส่วนถัดลงไปเป็น
> หลักฐานตามเวลาที่เขียน จึงยังเก็บเลข version เก่าไว้เพื่อ audit แต่ **ห้าม**นำคำว่า “รอ PR”,
> `ingest v15/v16`, REV 1.3.0 หรือสถานะ feed ในส่วนประวัติมาแทนสถานะปัจจุบันด้านล่าง.

| อะไร | สถานะปัจจุบันที่ตรวจแล้ว |
|---|---|
| Git / production branch | `claude/form-signal-telegram-rz8am1` อยู่ที่ merge commit `4d6a97e` หลัง PR #58 |
| PR ที่ปิดงานแล้ว | **#48** (`b86f2e8`, Evidence-first), **#50** (`c7e537c`, cross-asset overlay), **#51** (`bb6428f`, overlay visibility REV 1.3.1), **#53** (`f38267a`, Handoff gate), **#54** (`cd43d46`, updater), **#55** (`2581b9b`, current Handoff), **#56** (`a6d74b8`, compact marker REV 1.3.2), **#57** (`d52da91`, price labels REV 1.4.0) และ **#58** (`4d6a97e`, §5.18 audit/role policy) merge แล้ว |
| Database | migrations 0029, 0030 และ **0031 `cross_asset_chart_annotations`** อยู่ production แล้ว; migration ล่าสุดที่ Supabase แสดงคือ `20260901150144` |
| Edge Functions | Supabase แสดง `ingest` **v17 Active**, `chart-annotations` **v1 Active**, `backtest` v7, `outcome-notify` v5 และ `feed-watch` v1 |
| Rule switches | ทั้ง 8 rules `enabled=true` และ `announcement_mode=evidence_first`; Telegram เปิด 7 rules และปิดเฉพาะ `lvn`. Evidence gate ยังเป็นตัวตัดสินว่าจะประกาศจริง จึงห้ามตีความ `telegram_enabled=true` ว่าทุก signal จะส่ง |
| Instrument policy | BTCUSDT / GC / MNQU6 5m = `primary`; NQU6 5m = `shadow`. NQU6 ยังเก็บ signal/outcome แต่ไม่เป็นคำสั่งเทรดและไม่วาด marker |
| Confidence v2 | ยังเป็น **Shadow**, `score=null`, ห้ามใช้เป็น %/filter. View มี 436 captured, 431 resolved, 16 cohorts ณ เวลาตรวจ; ยังไม่ได้ทำ offline calibration, frozen model หรือ forward acceptance |
| ATAS overlay | Source REV **1.4.0** อยู่ production. Screenshot หลัง merge ยืนยันว่าป้ายมีราคาแต่ค่าเริ่มต้นที่แสดง Entry/SL/TP/exit หลายชุด **รกและไม่ผ่าน visual acceptance**; ใช้ค่าชั่วคราวใน §0G.1. Production ไม่มี DLL สำเร็จรูปที่ track ไว้ |
| Live feed | **ผิดปกติ/หยุดรับข้อมูล:** แถวล่าสุดของ BTCUSDT / GC / MNQU6 / NQU6 อยู่ราว `2026-09-01 23:40 UTC`; ตรวจ 01:55 UTC เงียบประมาณ 135 นาทีทั้งหมด. แถวล่าสุดทุกตัว `error=null` จึงยังชี้ได้เพียงว่า ATAS/bridge หยุดส่งหรือไปไม่ถึง endpoint ไม่ใช่ Edge Function ตอบ error |
| Web | Source ของ Confidence v2 / Evidence-first / overlay docs merge แล้ว. รอบนี้ไม่ได้เปิด production UI ตรวจภาพ จึงไม่อ้าง visual acceptance ใหม่ |
| Repo workflow | เพิ่ม `AGENTS.md` ที่ root เพื่อบังคับ agent ที่รองรับ repository instructions ให้อ่าน Handoff ทั้งไฟล์ก่อนแก้ code/config/schema/deploy และอัปเดต Handoff/เอกสารก่อนจบงาน. กฎนี้ไม่ครอบคลุม AI ที่ไม่ได้เปิด repo, checkout เก่า หรือผลิตภัณฑ์ที่ไม่รองรับ `AGENTS.md` |
| เอกสารเพิ่ม | เพิ่ม `AGENTS.md` เป็นกฎบังคับระดับ repo และแก้ Handoff ให้มี canonical current state; ไม่สร้าง runbook เพิ่ม เพราะ `docs/SETUP.md` มีขั้น build/import/rollback และรายการด้านล่างเป็นลำดับรับช่วงที่เพียงพอ |

### 0D.1 งานค้างจริง เรียงตามลำดับ

1. **P0 — ทำให้ feed กลับมาเดิน:** เปิด ATAS และกราฟ 5m ของทั้งสี่ตัว, ตรวจว่า Signal Bridge
   ยังถูก Add และ Endpoint/`INGEST_TOKEN` ถูกต้อง, แล้วรอให้ `ingest_log` มีเวลาใหม่ทุกตัว.
   Acceptance คือ POST ผ่าน v17, latest row `error=null` และ quiet time กลับมาต่ำกว่า 10 นาที.
2. **P1 — แก้ visual acceptance ของ indicator REV 1.4.0:** source merge แล้วและ screenshot จริง
   พิสูจน์ว่าราคาแสดงครบ แต่ป้ายหลายชุดบังแท่ง/ทับกันมาก. ใช้ค่าชั่วคราว §0G.1; งาน code ถัดไป
   ต้องออกแบบ declutter/visibility policy แล้วให้เจ้าของยืนยัน screenshot ใหม่. ห้ามอ้าง PR/build เขียว
   ว่า UI ผ่าน และยังต้องสุ่มเทียบ Entry/SL/TP/Exit กับ dashboard/Telegram.
3. **P1 — ปิดงาน Confidence v2 ด้วยหลักฐาน:** หลัง feed กลับมา ให้ export cohort แบบ time split,
   ทำ offline calibration และ forward shadow ตาม §5.20. จำนวน resolved ที่เพิ่มขึ้น **ไม่ใช่**สิทธิ์เปิด
   filter/Telegram จนกว่าจะมี frozen model version, metrics แยก rule/direction/instrument และ owner approval.
4. **P2 — งาน logic/runner ที่ยังเปิด:** ยืนยันความหมาย `bars.ticks`, ตัดสิน `speed_of_tape` จาก
   หลักฐาน (โดยเฉพาะ long ที่ติดลบทุกค่าที่วัด), ทำ backtest ให้ persist ทีละ variant, อธิบาย trail
   parameter equivalence และแก้ fixture typecheck `confidence_v2_test.ts`. ดู §7.2 รายข้อ.
5. **Owner/Security — ต้องยืนยันสถานะก่อนทำ:** ตรวจ Supabase Auth redirect/template/signup และยืนยันว่า
   Telegram bot token ที่เคยหลุดถูก revoke/rotate แล้ว. รายการ §7.1 เป็น checklist เดิมที่ยังไม่มี
   หลักฐานปิดงาน; ห้ามสรุปว่ายังเสียหรือแก้แล้วโดยไม่ตรวจ dashboard/account จริง.

### 0D.2 Rollback/ข้อห้ามที่ยังมีผล

- ปิดความเสี่ยงการแจ้งเตือนด้วย `telegram_enabled=false`; อย่าตั้ง `announcement_mode=manual`
  เพื่อแก้ feed หรือข้าม evidence gate.
- ปิดเฉพาะ overlay ด้วย `Show trade overlay=false`; ไม่ต้อง rollback database.
- Migration 0031 เป็น additive; **ห้าม drop schema เพื่อ rollback**. หาก ingest v17 มี regression จริง
  จึงค่อย redeploy v16 พร้อมเก็บ log/timestamp ก่อนเปลี่ยน.
- ห้ามเปลี่ยน NQU6 เป็น primary, เปิด Confidence v2 เป็นคะแนน หรือเปิดกฎจาก backtest อย่างเดียว
  โดยไม่มี forward evidence และ owner approval.

---

## 0C. ATAS overlay visibility hotfix — REV 1.3.1 (ตรวจ: 2026-09-01 16:58 UTC)

> **ให้อ่านหัวข้อนี้ก่อน §0B เมื่อติดตั้ง DLL:** แก้ปัญหาป้าย Entry/Exit เล็กจนต้องซูมและ
> เส้น Entry/SL/TP ของหลายสัญญาณพาดเต็มกราฟ. ไม่เปลี่ยน signal logic, ingest, Telegram,
> policy, outcome หรือ Edge Function ใด ๆ.

| อะไร | สถานะ |
|---|---|
| Source | **PR #51 merge แล้ว** เข้า production branch ที่ commit `bb6428f`; source hotfix อยู่ใน `51e2b3e` |
| ATAS DLL | Source REV **1.3.1** build Release สำเร็จ 0 warning / 0 error; file/product version `1.3.1`. Production branch ยังไม่มี DLL สำเร็จรูปที่ track ไว้ |
| ค่าเริ่มต้นใหม่ | `Show Entry / SL / TP lines = false`, `Overlay marker font size = 14` |
| Production/server | ไม่ต้อง deploy และไม่มี server/database change |
| การตรวจบนกราฟจริง | ยังต้อง Import DLL บน ATAS แล้วแนบภาพยืนยัน; session build ตรวจได้เฉพาะ compile และ runtime defaults |
| เอกสารเพิ่ม | อัปเดต `docs/SETUP.md`; ไม่ต้องมี runbook แยกเพราะขั้นติดตั้ง/rollback อยู่ในหัวข้อนี้ |

### 0C.1 สิ่งที่แก้และความหมายของเส้น

1. เส้นที่มาพร้อม REV 1.3.0 คือ plan levels ของทุก signal: Entry สีเทา, SL สีแดง และ TP สีเขียว.
   Signal ที่ยังไม่ปิดใช้ `TrendLine.IsRay = true` จึงยืดไปทางขวาและสะสมจนกราฟรก.
2. REV 1.3.1 ยังเก็บความสามารถเดิม แต่ปิดเส้นเป็นค่าเริ่มต้น. ผู้ใช้เปิดกลับได้ด้วย
   `Show Entry / SL / TP lines`; การเปิด/ปิดนี้เป็น presentation เท่านั้น.
3. ป้าย Entry/Exit เพิ่มจาก 9px โปร่งใสเป็น 14px, ตัวอักษรขาว, พื้นหลังเข้มทึบ, ขอบสีตาม
   direction/result, จัดกึ่งกลางและ offset 8px จากราคา. ข้อความระบุ `ENTRY LONG/SHORT` หรือ
   `EXIT TP/SL/TRAIL/TIME`, sequence และราคา จึงเห็นได้โดยไม่ต้องซูมเข้า.
4. เพิ่ม setting `Overlay marker font size` ช่วง 10–24px สำหรับจอ DPI/zoom ต่างกัน.

### 0C.2 หลักฐาน, ขั้นติดตั้ง และ rollback

- `dotnet build -c Release --no-restore` ผ่าน 0 warning / 0 error กับ ATAS Platform บนเครื่องนี้.
  Reflection จาก DLL ยืนยัน `ShowOverlayPlanLines=False`, `OverlayMarkerFontSize=14` และ Revision
  `REV 1.3.1`.
- ติดตั้ง: ปิด ATAS → Import DLL 1.3.1 → ลบ Signal Bridge เดิมออกจากกราฟ → Add ใหม่ → ตรวจ
  About/Revision เป็น 1.3.1. ตั้ง `Show trade overlay=true`, `Show Entry / SL / TP lines=false`,
  marker size 14 (เพิ่มเป็น 16–18 ได้ถ้าจอความละเอียดสูง) แล้วรอ refresh หนึ่งรอบ.
- Acceptance: ซูมออกระดับใช้งานปกติแล้วยังอ่าน ENTRY/EXIT ได้, ไม่มีเส้นแผนแนวนอนจาก indicator,
  และ feed/Telegram ยังเดินเหมือนเดิม. ต้องเก็บ screenshot และเวลาตรวจเพิ่มในหัวข้อนี้หลังใช้จริง.
- Rollback: ปิด `Show trade overlay` ได้ทันที หรือ Import DLL 1.3.0 กลับ. ไม่มี schema/function/web
  ให้ rollback. หากต้องการเส้นเดิมเพียงเปิด setting plan lines โดยไม่ต้องเปลี่ยน DLL.

---

## 0A. สถานะประวัติ — Evidence-first หลัง PR #48 (ตรวจ: 2026-09-01 13:45 UTC)

> **ให้อ่านหัวข้อนี้ก่อนส่วนประวัติทั้งหมดด้านล่าง** เพราะบางบรรทัดก่อน §0A อธิบายสถานะ
> ก่อน migration 0030 และไม่ใช่สถานะปัจจุบันแล้ว. ประวัติยังเก็บไว้เพื่อ audit ไม่ใช่คำสั่งทำงาน.

| อะไร | สถานะที่ตรวจแล้ว |
|---|---|
| Git / PR | **PR #48 merge แล้ว** เข้า `claude/form-signal-telegram-rz8am1` เวลา 11:47 UTC; merge commit `b86f2e8` มีทั้ง code, migration specification และ Handoff |
| migration production | `20260901104315 evidence_first_signal_quality` สำเร็จ |
| Edge Functions | `ingest` **v16 Active**, `backtest` **v7 Active**; `outcome-notify` v5 และ `feed-watch` v1 ไม่ถูกแก้ |
| policy ของ rules | ทั้ง **8 rules** เป็น `announcement_mode = evidence_first` |
| เว็บ Dashboard | Vercel check ของ merge commit **success** แล้ว ([deployment evidence](https://vercel.com/poogkma1128-5812s-projects/atas-signal-board/EAmsVbqEonyEoiToiLUxK5d9ZUdb)); UI production ได้ code ชุดเดียวกับ PR #48 |
| Live feed | ATAS กลับมาส่งครบ BTCUSDT / GC / MNQU6 / NQU6 ที่ 5m; `ingest v16` ตอบ 200 กับ POST ล่าสุดทุกตัว |
| เอกสารเพิ่ม | ไม่มี runbook แยก: migration comments + หัวข้อนี้เป็น specification และ runbook. การตรวจหลัง merge ถูกบันทึกเพิ่มใน §0A.4 |

### 0A.1 สิ่งที่เปลี่ยนจริง และสิ่งที่ตั้งใจไม่เปลี่ยน

1. `ingest v16` โหลด `setup_stability` หนึ่งครั้งต่อ batch แล้วประกาศ Telegram **เฉพาะ** cell
   ที่ตรงทุกมิติ `symbol + timeframe + rule_key + direction` และมี
   `verdict = 'proposable'` กับ `proposal = 'keep'`.
2. Cell ที่ไม่ผ่าน, ไม่มีแถว, หรือ query หลักฐานล้มเหลวจะถูกเขียนเป็น `signals.muted = true`.
   Signal **ยังถูกเก็บ, มี outcome, และอยู่ในสถิติ**; นี่คือ fail closed เฉพาะการส่งเสียง ไม่ใช่
   fail closed ของ ingest. จึงไม่ทำลายข้อมูลที่ต้องใช้พิสูจน์ให้กลับมาส่งได้ภายหลัง.
3. `telegram_enabled` ยังคงเป็น master switch ต่อ rule. `announcement_mode = 'manual'` เป็น
   owner override เท่านั้น; ถ้าคอลัมน์หาย/อ่านไม่ได้ code จะถือเป็น evidence-first ไม่ใช่ manual.
   การเปลี่ยนเป็น manual คือ **L3**: ข้ามหลักฐานและอาจ spam/ทำให้ตัดสินเงินจริงจาก cell ที่ยังไม่พิสูจน์
   ต้องมีคำสั่งเจ้าของชัดเจนพร้อมเหตุผลและบันทึกใน Handoff/PR.
4. Telegram ไม่แสดง `% confidence` เดิมอีกแล้ว; ข้อความบอกว่าเป็น “สัญญาณเชิงกฎ
   (ยังไม่สอบเทียบเป็นคะแนน)”. Dashboard feed/detail ก็ไม่ใช้ค่าดังกล่าวเป็นคะแนน. ค่า
   `signals.confidence` **ยังเก็บ** เป็น threshold-excess telemetry เพื่อ audit/สร้าง v2 ต่อไป,
   แต่ห้ามเรียกว่าความน่าจะเป็นหรือเอาไปกรอง.
5. outcome scorer และ backtest ยังนับ **stop-first** เหมือนเดิม (ไม่ทำให้ series ประวัติเปลี่ยน)
   แต่ผลลัพธ์ใหม่มี `signal_outcomes.ambiguous_path = true` เมื่อ OHLC แท่งเดียวแตะ active SL และ TP
   ทั้งคู่. แถวก่อน migration เป็น `null` อย่างซื่อสัตย์ ไม่อนุมานย้อนหลัง.
6. เพิ่ม `price_action_edge_by_setup` ซึ่งเทียบ price action ภายใน exact
   `rule + symbol + timeframe + direction` ก่อน; เป็น report เท่านั้น **ยังไม่มี filter ใหม่**.
   เพิ่ม `outcome_path_quality` สำหรับ coverage/สัดส่วน path ที่กำกวม.

### 0A.2 Cell ที่อนุญาตให้ประกาศ ณ เวลาตรวจ

จำนวนนี้เป็นผล query ณ 10:43 UTC และเปลี่ยนได้เองเมื่อ outcome ใหม่ปิดผล — อย่าคัดลอกเป็น
allow-list ถาวรใน code:

| symbol · TF | rule | direction | หลักฐาน |
|---|---|---|---|
| BTCUSDT · 5m | absorption | long / short | 97 / 87 ไม้, 3 sessions |
| BTCUSDT · 5m | poc_shift | short | 54 ไม้, 3 sessions |
| GC · 5m | poc_shift | long / short | 38 / 54 ไม้, 3 sessions |
| MNQU6 · 5m | poc_shift | long | 72 ไม้, 4 sessions |
| MNQU6 · 5m | stacked_imbalance | long / short | 109 / 114 ไม้, 4 sessions |
| NQU6 · 5m | poc_shift | short | 36 ไม้, 3 sessions |

รวม 9 cells. Cell อื่น รวมถึงทิศทางตรงข้ามของ rule/symbol ข้างต้น ยังคงเก็บและวัดผลแต่ไม่ส่ง Telegram.

### 0A.3 หลักฐานการปล่อยและการทดสอบ

- Migration อยู่ใน production แล้วและ `pg_get_functiondef(evaluate_pending_outcomes)` มี
  `ambiguous_path`. มี 235 cells ใน report price-action ใหม่; outcome เก่า 55 กลุ่มยังมี
  `audited_signals = 0` ตามที่ควรเป็น จนกว่าผลลัพธ์หลัง deployment จะปิด.
- **หลักฐาน live v16 ครบแล้ว:** ATAS ส่ง backfill 100 แท่งเริ่ม 13:24 UTC และแท่งสดต่อเนื่องถึง
  13:45 UTC. Edge logs ของ `ingest v16` บันทึก POST 200 สำหรับ BTCUSDT / GC / MNQU6 / NQU6;
  `ingest_log` ล่าสุดมี 1 bar ต่อ symbol, `error = null`. `feed-watch` เห็นทั้งสี่เป็น `live`
  (quiet 4 นาที) และ cron `feed-health-watch` ยัง active ทุก 5 นาที.
- เส้นทางประกาศผ่านจริง: GC · 5m · `poc_shift` long เวลา 13:40 UTC เป็น `muted = false` และ
  เก็บ Telegram message id `1235`; setup ที่ไม่ผ่านหลักฐานใน batch เดียวกันถูกเก็บเป็น
  `muted = true`. จึงยืนยันได้ทั้ง allow และ fail-closed โดยไม่อ้างจากค่าจำลอง.
- Typecheck + production build ของ `web` ผ่าน. Deno check ของ entrypoints `ingest`,
  `outcome-notify`, `backtest` ผ่าน. Deno runtime test ผ่าน **138 tests**.
- `deno test` แบบ typecheck ทั้ง suite ยังสะดุด fixture เดิม `confidence_v2_test.ts` ที่ใช้
  `sweep: 'bullish'`/`structure: 'BOS'` ไม่ตรง union ปัจจุบัน (ก่อนงานนี้); รันจริงด้วย
  `--no-check` ผ่าน 138/138. อย่าอ้างว่า suite typecheck ทั้งก้อนเขียวจนกว่าจะแก้ fixture นั้น
  ใน PR แยก.
- Supabase Advisor ก่อน deploy พบข้อเดิมนอกขอบเขต: RLS policy ของ `feed_alerts`/`runner_tokens`,
  mutable search path ของ `claim_outcome_notifications`, `pg_net` ใน `public`, และ index/policy
  warnings ของ `rule_overrides`/`rule_snapshots`. งานนี้ไม่สร้าง policy/table permissive ใหม่.

### 0A.4 การตรวจหลัง merge, ความเสี่ยงคงค้าง, และการรับช่วง

1. **ผลหลัง merge ที่พิสูจน์แล้ว:** PR #48 merge แล้ว, Vercel check success, migration 0030 อยู่
   production, `ingest v16` / `backtest v7` Active, และ feed สดเดินผ่าน v16 จริง. ตั้งแต่ deployment
   มี 234 signals: 167 ถูก mute ตามหลักฐาน, 67 ผ่าน evidence gate, และ 4 แถวบันทึกว่า Telegram ส่ง
   สำเร็จ. ห้ามเปรียบ 67 กับ 4 แล้วสรุปว่าส่งล้มเหลว: backfill 100 แท่งตั้งใจไม่ประกาศ; ใช้หลักฐาน
   live row พร้อม message id ข้างบนเป็นตัวพิสูจน์เส้นทาง announcement.
2. **ขอบเขตหลักฐาน UI:** ตรวจ Vercel deployment ผ่าน GitHub status ได้ แต่ session นี้เปิดหน้า
   production โดยตรงไม่ได้ (Vercel connector ไม่มีสิทธิ์อ่าน deployment และ browser CLI ไม่พร้อม).
   จึง **ยังไม่อ้างว่า visual UI ผ่าน**; เมื่อสิทธิ์กลับมาให้เปิด `/`, `/stats`, `/rules` และ signal detail
   จริงแล้วค่อยบันทึกผล. ข้อนี้ไม่ขัดกับหลักฐาน ingest/Telegram ที่ตรวจจาก production data แล้ว.
3. **Outcome audit เริ่มมีข้อมูลใหม่แล้ว:** 216 outcomes หลัง deploy resolve โดย audit path ครบ
   (208 ไม่กำกวม, 8 `ambiguous_path = true`) และ 18 ยัง pending. ก่อนใช้ผลมาปรับกฎ ให้ query
   `select * from public.outcome_path_quality order by audited_signals desc;` และแยก path ที่กำกวม;
   `ambiguous_path` ไม่ใช่เหตุให้เลือก TP.
4. **ข้อผิดพลาดที่ยังเปิดอยู่ (L2):** มี 1 POST ของ NQU6 เวลา 13:35 UTC ล้มเหลวด้วย
   `instrument upsert failed: JWT issued at future` (HTTP 500). นี่เป็นอาการเดิมของ service-role/
   clock path ไม่ใช่ evidence gate; NQU6 POST ถัดไปเวลา 13:40 UTC สำเร็จ. ห้ามแก้ด้วยการปิด auth
   หรือหมุน secret เดา ๆ. หากเกิดซ้ำมากกว่า 1% ของ POST หรือเกิดต่อเนื่อง 2 แท่ง ให้หยุดสรุปผล
   cohort นั้น, เก็บ timestamp/request log และตรวจ clock/secret กับ Supabase ก่อนแก้.
5. **Check-in ที่ตั้งแล้ว:** automation ใน Codex ชื่อ `ATAS evidence-first live verification` ตรวจ
   ทุก 15 นาทีใน thread งานนี้: PR merge, Vercel status, edge-function versions, feed freshness,
   live v16 POST, mute/Telegram path และ outcome audit. มันรายงานเฉพาะเมื่อมีการเปลี่ยนสาระสำคัญ
   หรือ feed เงียบเกิน 30 นาที และไม่มีสิทธิ์แก้ rule/deploy เอง.
6. **Rollback แบบปลอดภัย:** หากต้องหยุดความเสี่ยงทันที ตั้ง `telegram_enabled = false` (เฉพาะ rule
   หรือทั้งหมด) แล้ว signals ยังถูกเก็บ. หากต้องย้อน logic ให้ deploy source ก่อน v16 (v15) อีกครั้ง;
   migration 0030 เป็น additive จึงไม่ต้องและไม่ควร rollback schema. Dashboard ย้อนด้วย Vercel deployment
   ก่อนหน้าได้. ห้ามตั้ง `manual` เป็น rollback อัตโนมัติ เพราะทำให้ alert กว้างขึ้น.
7. Confidence v2 ยังเป็น shadow (`score: null`): evidence-first นี้เป็น **rule-cell gate**, ไม่ใช่
   model-confidence filter. ห้ามเปิด filter/model/Telegram จาก v2 ก่อน offline calibration + frozen
   model version + forward test + owner approval.

---

## 0B. หลักฐานการปล่อย Cross-asset ATAS overlay (snapshot: 2026-09-01 15:05 UTC)

> งานนี้ deploy และ merge แล้วตาม §0D. หัวข้อนี้เก็บหลักฐานตอนปล่อย REV 1.3.0; เมื่อติดตั้งจริง
> ให้ใช้ source/DLL **REV 1.3.1** และขั้นล่าสุดใน §0C/§0D ไม่ใช่สถานะ PR ใน snapshot นี้.

| อะไร | สถานะที่ตรวจแล้ว |
|---|---|
| Git source | **PR #50 merge แล้ว** เข้า production branch ที่ `c7e537c`; source หลักอยู่ใน `97e65a3` |
| Production schema | migration `0031_cross_asset_chart_annotations.sql` สำเร็จ: policy table, `signals.suppression_reason`, `signal_outcomes.exit_bar_id`, และ scorer ที่บันทึกแท่ง exit |
| Edge Functions | `ingest` **v17 Active** และ `chart-annotations` **v1 Active** (custom `INGEST_TOKEN`, ไม่ใช้ public endpoint) |
| Live path หลัง deploy | `ingest v17` ตอบ POST 200 จริงเวลา 15:05 UTC ทั้งชุด; BTCUSDT primary ยังได้ signal ใช้งาน และ NQU6 seq 2709 ถูกเก็บเป็น `muted=true`, `suppression_reason=shadow_instrument` ตาม policy |
| ATAS DLL | REV **1.3.0** build Release ผ่าน 0 warning ณ snapshot นี้; ถูกแทนด้วย source REV **1.3.1** จาก PR #51. ยังไม่มี visual acceptance บนกราฟจริง |

### 0B.1 พฤติกรรมที่เปลี่ยน

1. Telegram แสดง trailing เป็น `เมื่อราคาถึง <trigger> ให้เลื่อน SL เป็น <ราคาใหม่>` สำหรับ **ทุก
   instrument และทั้ง Long/Short**. เป็นการแสดงราคาให้วางคำสั่งได้ตรง; **ไม่เปลี่ยน** plan, trail
   calculation, scorer หรือ backtest.
2. ทุก asset ใช้กติกาเดียวกันเรื่อง overlay: แสดงเฉพาะ signal ที่ใช้งานได้จริง (`primary` +
   `muted=false`) พร้อม Entry / SL / TP / Exit. ค่าเริ่มต้นที่ production คือ BTCUSDT, GC และ MNQU6
   5m เป็น `primary`.
3. NQU6 เป็น `shadow` โดยเจตนา: ยังรับ bar, สร้าง signal, เก็บ outcome และเพิ่มหลักฐาน แต่ไม่ Telegram
   และไม่วาด trade marker. จึงไม่เกิดกรณี NQ/MNQ ออกคำสั่งสวนกันให้ตัดสินใจ. นี่ **ไม่ใช่การลบ NQ**;
   เปลี่ยน role ต้องมีผลวัดและ owner approval ก่อน เพราะอาจขยาย alert จริง.
4. ถ้า Long และ Short ต่างก็ผ่าน gate ใน instrument/timeframe/**bar เดียวกัน** pipeline จะ mute ทั้งคู่
   และตั้ง `suppression_reason=opposite_direction_same_bar`; ไม่เลือกด้านหนึ่งจากสถิติที่ยังไม่พอ.
   Unit test ครอบคลุมกติกานี้แล้ว; ณ เวลาตรวจยังไม่มี collision ใหม่หลัง v17 ให้ยืนยันจาก live data.
5. `exit_bar_id` ทำให้ marker Exit วางตรงแท่งจริงสำหรับ TP / SL / trail / timeout. Outcomes เก่าก่อน
   migration เป็น `null` อย่างซื่อสัตย์ จึงอาจมี Entry/SL/TP แต่ไม่มี Exit marker จนกว่าจะเป็น trade ใหม่.
6. `chart-annotations` แยกจาก ingest แบบ read-only; endpoint หรือ overlay ล้มเหลวต้องไม่หยุดรับ data
   และไม่เปลี่ยนการคำนวณสัญญาณ.

### 0B.2 หลักฐานการปล่อย

- C# Release build ของ `AtasSignalBridge` REV 1.3.0 ผ่าน 0 warning.
- Deno format check ของไฟล์ที่แก้, `deno check` ทั้ง `ingest` และ `chart-annotations`, และ targeted
  tests **38/38** ผ่าน รวมการ format Telegram Long/Short, policy, conflict suppression และ mapping
  overlay.
- Full Deno suite ยังติด fixture เดิม `confidence_v2_test.ts` (`sweep: bullish`/`structure: BOS` ไม่ตรง
  union ปัจจุบัน) ตาม §0A.3; ไม่ใช่ regression ของงานนี้.
- Edge logs ยืนยัน `ingest v17` POST 200 เวลา 15:05:06 และ 15:05:20 UTC. แถว NQU6 หลัง deploy
  ยืนยัน shadow จริง; ไม่ได้อ้างจาก unit test อย่างเดียว.
- ยังไม่มี ATAS GET หลัง Import จึงยังไม่อ้างว่า marker วาดผ่านจริง. ให้ตรวจข้อนี้หลังขั้นตอนด้านล่าง
  แล้วบันทึกต่อในหัวข้อนี้.

### 0B.3 ขั้นตอนที่เจ้าของต้องทำบน ATAS (อัปเดตหลัง merge)

1. Build/publish หรือรับ DLL Release **REV 1.3.1** จาก source บน production branch ตาม
   `docs/SETUP.md` (ตอนนี้ repo ไม่มี binary 1.3.1 ให้ดาวน์โหลดตรง): ปิด ATAS → Import → ลบ
   Signal Bridge เก่าออกจากกราฟ → Add ใหม่. **ไม่ต้องติดตั้ง dependency เพิ่มใน ATAS**.
2. เปิดกราฟ 5m ของ BTCUSDT, GC หรือ MNQU6 ที่ bridge ตั้ง symbol ตรงกับ ingest แล้วคงค่า
   `Show trade overlay=true`, refresh 30 วินาที, lookback 200 bars. Marker จะมีเฉพาะ signal ที่ผ่าน gate;
   การไม่มี marker ไม่ใช่ error หากช่วงนั้นไม่มี primary/unmuted signal.
3. เปิด NQU6 เพื่อยืนยันว่าไม่มี marker/alert แต่ feed ยังคงเก็บข้อมูล. จากนั้นตรวจ edge log ว่ามี GET
   `chart-annotations` 200 และแนบ screenshot/เวลาไว้ใน Handoff เมื่อเห็น marker อย่างน้อยหนึ่งรายการ.

### 0B.4 Rollback และข้อห้าม

- หยุดภาพบน ATAS ได้ทันทีด้วย `Show trade overlay=false`; ไม่กระทบ ingest, Telegram หรือข้อมูล.
- หยุด alert อย่างปลอดภัยด้วย `telegram_enabled=false`; signals/outcomes ยังคงเก็บ. อย่าเปลี่ยน NQU6
  เป็น primary เพียงเพื่อให้เห็น marker.
- หากต้องย้อน logic ให้ redeploy ingest v16 ก่อนหน้าได้; migration 0031 เป็น additive **ห้าม drop หรือ
  rollback schema**. `chart-annotations` ปิดหรือไม่ถูกเรียกก็ไม่กระทบ feed.
- ตาราง `instrument_signal_policies` เปิด RLS โดยตั้งใจและไม่มี public policy: เปลี่ยนผ่าน service role/
  migration ที่ review แล้วเท่านั้น. ห้ามเปิด anon write เพื่อแก้ role จากหน้าเว็บ.

---

## 0. ประวัติก่อน PR #48–#51 — ห้ามใช้เป็นสถานะปัจจุบัน

> ตารางและข้อความในหัวข้อนี้เป็น snapshot ก่อนงาน Evidence-first/cross-asset ถูก merge.
> ใช้เพื่อ audit เท่านั้น; เซสชันใหม่ต้องเริ่มที่ §0D.

### Snapshot ณ 2026-09-01 ก่อนงานชุดล่าสุด merge

| อะไร | ค่า |
|---|---|
| branch ที่ทำงานอยู่ ณ snapshot | `codex/confidence-v2-shadow` (ภายหลัง merge แล้วผ่าน PR #48) |
| แตกจาก / merge กลับเข้า | `claude/form-signal-telegram-rz8am1` (branch หลักของ repo นี้) |
| งานถัดไป ณ snapshot | รอ cohort v2 ปิดผลตาม §5.20; `ingest v15` เริ่มเก็บ snapshot แล้ว; **ห้าม**เปิดเป็นตัวกรองหรือเรียกคะแนนเป็น % |
| PR ล่าสุด ณ snapshot | #44; สถานะปัจจุบันดู §0D ซึ่งรวม #48/#50/#51 แล้ว |

**ของที่ deploy ก่อนงานนี้** ตรงกับ repo (`ingest` v14 · `backtest` **v6** · migration ถึง 0028)
และงานทั้งหมดถึง §8.6 ขั้น 3 merge เข้า branch หลักแล้ว ไม่มีอะไรค้างอยู่ใน PR

**อัปเดต Confidence v2 — อ่าน §5.20 ก่อนทำเรื่อง confidence ต่อ:** migration **0029**
(`confidence_v2_progress` view) และ `ingest` **v15** ขึ้น production แล้ว. Endpoint ผ่าน 405/401
และ feed จริงเวลา **09:10 UTC** สร้าง v2 snapshot 4 แถวโดย `error = null`. โค้ด/หน้า Dashboard v2
และเอกสารอยู่บน remote branch `codex/confidence-v2-shadow` ณ snapshot นั้น; ภายหลัง merge แล้ว
ผ่าน PR #48. การ merge นี้ **ไม่กระทบการสร้าง signal สด**. Telegram และค่า
`signals.confidence` เดิม **ยังไม่เปลี่ยน**.

**สิ่งที่ยังไม่ได้ทำคือการกวาดค่าเอง** (§8.6 ขั้น 4–5) อ่าน **§8.6** ก่อนอย่างอื่น
มันมีแผนครบทั้งหมด: ตัวติดที่แก้ไปแล้ว · เหตุผลที่ยังไม่กวาด `delta_flip` ·
ค่าที่จะกวาดทั้ง 3 รัน · และเกณฑ์ตัดสินที่ยืมมาจาก §5.11

⚠️ **ถ้าจะเขียนอะไรลงหัวข้อนี้ อย่าอ้างเลข PR ที่ยังเปิดอยู่** — มันจะกลายเป็นข้อมูลผิด
ทันทีที่ PR ถูก merge ซึ่งเกิดมาแล้วสองรอบ ให้เขียนสถานะที่ยังจริงหลัง merge แทน

**เปลี่ยนล่าสุด — กวาดค่ากฎใหม่จบแล้ว ไม่รับอะไรเลย (ข้อ 5.18) และ confidence ใช้ไม่ได้ (ข้อ 5.19):**
กวาด `lvn` · `naked_poc` · `speed_of_tape` ครบ **ไม่มีค่าไหนผ่านเกณฑ์ให้รับ**
· `naked_poc` เป็นข่าวดี — ทั้งสองพารามิเตอร์**วัดแล้วว่าค่าปัจจุบันถูกอยู่แล้ว**
· `lvn` ค่าที่ดูดีที่สุดคือค่าที่ทำให้กฎเลิกเป็นกฎเดิม และตกด่านราย instrument
· **`speed_of_tape` ฝั่ง long ติดลบทั้ง 9 ค่าที่วัด** — ควรปิดฝั่งนั้น รอเจ้าของกด

**และเรื่องที่ใหญ่กว่า: confidence ที่ส่งเข้า Telegram ทุกวันแทบไม่มีข้อมูลอยู่ในนั้น**
เทียบกับผลจริงเป็นครั้งแรก — corr กับ R ของสามกฎที่มีไม้มากสุด = **0.013 / 0.051 / 0.027**
คือศูนย์ **ห้ามใช้เป็นตัวกรอง** และตัวเลขที่แสดงอยู่กำลังทำให้คนอ่านเข้าใจผิด (ข้อ **5.19**)

**ข้อจำกัดใหม่ที่เจอระหว่างทาง:** `backtest` ชน **CPU limit** แล้ว — ข้อ 3.11 ที่เคยเขียนว่า
"CPU ไม่ใช่คอขวด" **ใช้ไม่ได้อีกต่อไป** แก้แล้วในข้อ **3.11** พร้อมเพดานที่วัดได้จริง

**ก่อนหน้านั้น — เตรียมกวาดค่า params ของกฎใหม่ (ข้อ 8.6 · `backtest` v6):**
กฎใหม่ 4 ตัวยังไม่เคยถูกกวาดค่าเลยสักตัว ระหว่างวางแผนเจอว่า `experiment_results`
**ไม่เคยเก็บแถวราย instrument × กฎ** เก็บแค่ราย instrument (รวมทุกกฎ) กับรายกฎ (รวมทุก instrument)
= **ข้อห้าม #18 ตอบไม่ได้ในระดับกฎ** ซึ่งเป็นด่านที่การกวาดค่าต้องผ่าน
`delta_flip` มี 24 ไม้จาก 2,398 ไม้ (1%) ขยับเกณฑ์มันแล้วไปดูตัวเลขรวมของ BTCUSDT
ก็เท่ากับมองหาความเปลี่ยนแปลง 1% ในตัวเลขที่อีก 99% ไม่ขยับ — แก้ด้วย loop ที่สี่ใน
`resultRows()` ไม่ต้อง migration ไม่แตะเว็บ · **แผนกวาดค่าทั้งหมดอยู่ในข้อ 8.6 แล้ว**

**ก่อนหน้านั้น — Speed of Tape ขึ้นแล้ว และคอลัมน์ในเอกสารนี้เคยเขียนผิด (ข้อ 5.16):**
`bars.trades` ที่ข้อ 8.5 เคยบอกว่า "มีอยู่แล้ว" จริง ๆ แล้วเป็น **0 ทุกแถวทั้ง 2,428 บาร์** —
indicator ประกาศฟิลด์ไว้แต่ไม่เคยเซ็ตค่า ตัวที่มีข้อมูลจริงคือ `bars.ticks` ซึ่ง `volume ÷ ticks`
ออกมา ~1.1 สัญญาต่อไม้บน futures = จำนวนไม้เทรดจริง เลยสร้าง `speed_of_tape` ได้
**โดยไม่ต้องแตะ indicator** (migration 0028 · `ingest` v14 · `backtest` v5)
**แต่ตัวเลขชุดแรกไม่ดี** — เป็นกฎเดียวใน 8 ตัวที่มีฝั่งติดลบ (long −6.61R บน 121 ไม้)
และขันเกลียวเป็น 3× แล้ว**แย่ลง** (−0.142 R/ไม้) มันจึงเงียบอยู่และเข้ามาโดยมีภาระพิสูจน์
มากกว่าอีกสามตัว · ของแถม: `volume / ticks` = proxy ตัวแรกของ **ข้อ 4 (Large Trades)**
บันทึกลง payload แล้วแต่ยังไม่กรองอะไร

**พร้อมกัน — ตารางเทียบสี่กฎที่ถูกสลับสวิตช์ในวันเดียว (ข้อ 5.17):**
`naked_poc` + `delta_flip` เปิดเสียง · `poc_shift` ปิด · `lvn` ปิด — การปิดเสียงทำงานถูกต้อง
ไม่มีบั๊ก **แต่สองในสี่สวนทางกับตัวเลข**: `poc_shift` เป็นกฎเดียวที่มีข้อมูลพอให้ `setup_stability`
ตัดสินราย instrument ได้ และ view เสนอให้ปิดแค่ **MNQU6 short + BTCUSDT long** ไม่ใช่ปิดทั้งกฎ ·
`delta_flip` มีประวัติบางที่สุดในระบบ (12 ไม้สด · 0 เซลล์ที่อ่านได้) แต่เปิดเสียง
**หัวข้อนั้นไม่เปลี่ยนค่าอะไร** — สวิตช์เป็นสิทธิ์ของเจ้าของ แค่เอาตัวเลขมาวางไว้ข้าง ๆ

**ก่อนหน้านั้น — กวาด trail จนสุดทาง 12 ค่า แล้ว *ไม่รับอะไรเลย* (ข้อ 5.4c):**
คำสั่งตั้งต้นคือ "ปิด trail ไปเน้นคุณภาพสัญญาณ" **วัดแล้วห้ามปิด** — ปิดแล้ว R/ไม้ ร่วง
0.416 → **0.110** และ drawdown พุ่ง 8.13 → **33.60** · แต่ค่าที่แน่นกว่าปัจจุบันก็รับไม่ได้เหมือนกัน
เพราะกวาด 12 ค่าแล้ว**ยังไม่เจอจุดกลับตัว** (ข้อห้าม #14) และเห็นกลไกชัดว่า trail ที่แน่น
**ต่ำกว่า 1 tick** กำลังวัดสมมติฐานของตัวจำลอง ไม่ใช่วัดตลาด · `trailAfterR 0.5 / 0.25` อยู่เหมือนเดิม

**ก่อนหน้านั้น (migration 0027 + `ingest` v13 + `backtest` v4 — deploy แล้ว 2026-08-31):**
**เพิ่มกฎ 3 ตัวจากลิสต์ prop trading ที่ต่อยอดจาก engine เดิมได้ทั้งหมด** —
`delta_flip` · `lvn` · `naked_poc` ทั้งสามอ่านข้อมูลที่มีอยู่แล้ว ไม่มี column ใหม่
ไม่แตะ indicator ไม่แตะ ingest **และทั้งสามตัวยิงเข้า `public.signals` แต่ไม่ส่ง Telegram**
(`telegram_enabled = false`) — เหตุผลที่ทำแบบนี้แทนที่จะปิดทั้งกฎอยู่ในข้อ **5.15**
เปิดเสียงทีละตัวได้ที่ `/rules` เมื่อ `signal_outcomes` บอกว่าคุ้ม ไม่ต้อง deploy

**ก่อนหน้านั้น (migration 0026, `ingest` v12, `outcome-notify` v5, web REV 1.3.0):**
**แก้สัญญาณส่งซ้ำ 3 ข้อความต่อไม้เดียว** — ไม่ใช่ข้อมูลผิด แต่เป็นการอ่านก่อนเขียนทีหลังที่ชน
กันเองเมื่อ 4 ชาร์ตยิงพร้อมกัน (ข้อ **3.16**) · **ป้าย Telegram บอกชื่อ instrument ตั้งแต่ต้นบรรทัด**
ทั้งฝั่งสัญญาณและฝั่งผลลัพธ์ ไม่ต้องเลื่อนขึ้นไปดูว่าเป็นของชาร์ตไหน · **เข้าเว็บด้วยรหัสผ่านได้แล้ว**
มีหน้า `/account` ไว้ตั้งรหัส (ข้อ **7.5**)

**ก่อนหน้านั้น (migration 0024 + 0025, `backtest` v3):** ตัวรัน backtest **บันทึก drawdown
ได้จริงแล้ว** (ก่อนหน้านี้โค้ดมีแต่ยังไม่ได้ deploy ค่าเลยเป็น null ทุกแถว — ซื่อสัตย์แต่ยังไม่ทำงาน) ·
เพิ่ม `missed_fills` + **`fill_rate`** = "ตั้งค่านี้แล้วได้เข้ากี่ % ของสัญญาณที่เจอ" ·
กวาด **pullback entry ครบ 8 แบบ → ผลคือ *ไม่รับ*** และตัวที่บอกว่าอย่ารับคือ `fill_rate` เอง
(R/ไม้ ดูดีขึ้นเพราะ**ไม่ได้เข้า 46% ของสัญญาณ** R รวมหล่น 43%) — ดูข้อ **5.13** ·
เจอและแก้บั๊กใน `fillIndex()` ที่เกือบทำ **baseline** เพี้ยนเงียบ ๆ — ดูข้อ **3.14**

**ก่อนหน้านั้น (migration 0022 + 0023):** วัด **drawdown** ได้แล้ว (ไม่เคยมีมาก่อนเลย) ·
มี **`forward_test`** วัดค่าที่รับไปแล้วเฉพาะบนไม้ที่ยิงหลังรับ — ข้อมูลที่ backtest ไม่เคยเห็น ·
**feed เงียบแล้วเตือน Telegram เอง** ไม่ต้องเปิดเว็บดู · วันเวลาบนเว็บเป็นภาษาไทยทั้งหมด ·
แก้บั๊ก `SL 0 · TP 0` — ดูข้อ **5.12** และ **3.13**

**ก่อนหน้านั้น (migration 0021 + ระบบ REV):** กวาด threshold ของกฎครบทุกตัวเป็นครั้งแรก
(6 การทดลอง) รับมาแค่ตัวเดียวคือ `minDeltaMagnitude` 100 → **200** ที่เหลือวัดแล้วไม่ขยับ
— ดูข้อ **5.11** · **ปิดงานค้าง 7.2 D** แล้ว (`minRiskRangeShare` อยู่ที่ 0.30 ถูกแล้ว) ·
มี **เลข REV แยกตามส่วน** พร้อมตัวเช็กที่ fail ถ้าลืมขยับ — ดูข้อ **3.8**

**ก่อนหน้านั้น (0019 + 0020):** `rewardRatio` 2.0 → 3.0 · `outcome-notify` เป็น version 4 ·
คิวรีที่เคยต้องจำกลายเป็น view (`settings_effect`, `price_action_edge`) บนหน้า `/stats`

**สถานะ feed ณ snapshot 2026-09-01 00:35 UTC — ไม่ใช่สถานะปัจจุบัน:**
**MNQU6 / NQU6 / GC = สด** ทั้งสามตัว (ส่งเข้าทุก 5 นาที ~50 ครั้งใน 6 ชม.ล่าสุด) ·
**BTCUSDT = เงียบ** ตั้งแต่ 31 ส.ค. 22:50 UTC

**นี่คือสิ่งที่รอมาตลอด** — ข้อ 5.8 (ชะตา MNQU6) และข้อ 7.1 #1 รอ futures เดินหลายเซสชัน
มาตั้งแต่ต้น ณ snapshot นั้นมันเดินแล้ว ข้อมูลที่ใช้ตัดสินกำลังสะสม **อย่าเพิ่งสรุปจนได้อีกสองเซสชัน**
และถ้าจะกวาดค่าตาม §8.6 ในช่วงนั้น ตัวอย่างฝั่ง futures จะหนากว่าตอนข้อ 5.11 ทำ ซึ่งดีขึ้น

ฝั่ง BTCUSDT ที่เงียบไปน่าจะเป็นชาร์ตที่ปิดไว้ ไม่ใช่ bridge พัง — เหตุผลอยู่ในข้อ 3.7
(ตลาดปิดกับ bridge พังหน้าตาเหมือนกันในหน้า feed) crypto ไม่มีเวลาปิด ฉะนั้นถ้าเงียบยาว
**ให้เปิดชาร์ต BTCUSDT ใน ATAS ค้างไว้**
ATAS เคยหยุดส่งไป ~8 ชม. (29 ส.ค. 19:15 → 30 ส.ค. 02:55 UTC) มาแล้วครั้งหนึ่ง

**ค่าใหม่ติดในของจริงแล้ว ไม่ใช่แค่ในตาราง:** ไม้ 03:35 และ 03:45 UTC ยิงที่ reward 3.0
ตัวอย่างไม้ 03:45 — เข้า 78154.80 · SL 78133.50 · TP 78218.70 = เสี่ยง 21.30 ได้ 63.90
พอดี 3 เท่า · `settings_effect` ขึ้นกลุ่มที่สามให้เอง (`is_live: true`) **โดยกลุ่มเดิม
275 ไม้ กับ 24 ไม้ ไม่ขยับเลยแม้แต่ตัวเดียว** ซึ่งคือทั้งหมดที่ view ตัวนั้นถูกสร้างมาเพื่อรับประกัน

| อยากรู้ว่า... | อ่านข้อ |
|---|---|
| ระบบทำงานยังไง | 1 |
| สั่ง backtest ยังไง | **3.10** |
| ผลการทดลองบอกอะไร | **5.6 / 5.7 / 5.8** |
| ทำไมไม่รับ pullback entry | **5.13** |
| กฎไหนควรเปิดเสียง | **5.17** |
| ค่าที่ใช้อยู่จริงตอนนี้ | 6 |
| อะไรค้างอยู่ | 7 |
| ผลการกวาดค่ากฎใหม่ | **5.18** |
| confidence เชื่อได้ไหม | **5.19** |
| ตัวรัน backtest ชน CPU | **3.11** |
| กติกาที่ห้ามละเมิด | 11 |

### สองเรื่องที่รอ "เจ้าของ" ไม่ใช่รอโค้ด

1. **เปิดชาร์ต BTCUSDT ค้างไว้** — ข้อนี้เป็นคำสั่ง ณ snapshot เท่านั้น; ปัจจุบันทั้งสี่ feed
   เงียบพร้อมกันและให้ทำตาม §0D.1
   ส่วน **BTCUSDT เงียบตั้งแต่ 31 ส.ค. 22:50 UTC** ซึ่ง crypto ไม่มีเวลาปิด
   จึงแปลว่าชาร์ตถูกปิด ไม่ใช่ตลาดปิด (ข้อ 3.7) · ยังต้องได้อีก ~2 เซสชันถึงตัดสิน MNQU6 ได้
2. **แก้ Supabase Auth ให้ล็อกอินเว็บได้** (ข้อ 7.1 #2 และ #3) — หน้า `/experiments`
   และ `/stats` **เจ้าของยังเปิดดูไม่ได้** เพราะติดล็อกอิน ณ snapshot นั้น; สถานะปัจจุบันต้องทดสอบใหม่

เรื่องที่สาม (`rewardRatio` 2.0 → 3.0) **เจ้าของสั่งแล้วและทำไปแล้ว** เมื่อ 2026-08-30 —
เหตุผลทั้งหมดอยู่ในข้อ 5.6 และในคอมเมนต์ของ migration 0019

### การทดลองที่รันไปแล้ว (ดูได้ที่ `/experiments` หรือตาราง `experiments`)

| ชื่อ | ถามอะไร | ผล |
|---|---|---|
| `smoke test` | ตัวรันทำงานไหม | ผ่าน |
| `liquidity gate sweep` | `minVolumeRatio` 1.2 ถูกที่แล้วไหม | ถูกแล้ว ไม่ขยับ (5.7) |
| `reward ratio sweep` | TP ควรอยู่ไหน | 2.0 แคบไป (5.6) |
| `target versus trail` | เป็นเพราะ trail หรือเปล่า | ไม่ใช่ ผลอยู่ทุกแบบของ trail |
| `where the target stops mattering` | เส้นมีจุดกลับตัวไหม | ไม่มี — ปลายเส้นพิงไม้ 2 ไม้ |
| `standing sweep <วันที่>` | รันเองทุกคืน 21:00 UTC | ยืนยันว่า trail 0.5/0.25 ดีกว่า 0.5/0.5 และ 0.75/0.25 |
| `reward ratio on 92 more bars` | ผลเรื่อง reward ทำซ้ำได้ไหมบนข้อมูลใหม่ | ได้ ทิศทางเดิมบน 198 ไม้ (5.10) |
| `after adopting reward 3` | baseline ขยับเป็น 3.0 จริงไหม | จริง — `reward 2` กลายเป็นตัวที่แย่กว่า baseline (5.6) |
| `poc_shift thresholds` | ค่าของ `poc_shift` ตั้งถูกไหม | `minTicks`/`hvnShare` **ไม่มีผลเลย** · `consecutive 2` ดีแต่ตกด่าน (5.11) |
| `stacked_imbalance thresholds` | `ratio`/`stack`/`minVolume` | เพื่อนบ้านไม่เห็นด้วย ไม่ขยับ (5.11) |
| `absorption thresholds` | `volumeMultiple`/`edgeTicks`/`rejectionTicks` | สองตัวแรกอยู่ที่ยอดแล้ว · `rejectionTicks` เส้นไม่กลับตัว (5.11) |
| `delta_divergence thresholds` | `lookback`/`minDeltaMagnitude` | **เจอจุดกลับตัว → รับ 200 มาใช้** (5.11) |
| `entry geometry` | `bufferTicks` · `minRiskRangeShare` 0.6 | ทั้งคู่ไม่ผ่าน — **ปิดงาน 7.2 D** (5.11) |
| `finding the turning points` | เส้นที่ยังไม่กลับตัวมีจุดกลับไหม | `minDelta` มี (ที่ 200–250) · `rejectionTicks` ไม่มี (5.11) |
| `after adopting minDelta 200` | baseline ขยับจริงไหม | จริง — 100 และ 300 ต่ำกว่า baseline ทั้งคู่ |
| `pullback entry sweep` | เข้าที่ราคาย่อดีกว่าเข้าที่ราคาปิดไหม | **ไม่ — ตกด่าน 4 ใน 5** ทุก variant ทำ R รวมได้น้อยกว่าไม่ทำอะไรเลย (5.13) |
| `trail sweep past the edge` + `bracket the collapse` | trail แน่นกว่านี้ดีกว่าไหม | **ไม่รับอะไรเลย** — ปิด trail แย่ชัด แต่ค่าแน่นก็ไม่มีจุดกลับตัว (5.4c) |
| `deploy check 0027` | กฎใหม่ 3 ตัวยิงจริงไหม และของเดิมกระเทือนไหม | ยิงจริง · ของเดิมนิ่งทุกแถว (5.15) |
| `deploy check 0028` | `speed_of_tape` บน `bars.ticks` ทำงานไหม | ทำงาน · ของเดิมนิ่งทุกแถว · **แต่ฝั่ง long ติดลบและขันเกลียวแล้วแย่ลง (5.16)** |

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
| Edge function `ingest` | **version 13, ACTIVE** (`verify_jwt: false` — auth ด้วย INGEST_TOKEN เอง) — v13 เพิ่ม evaluator ของกฎใหม่ 3 ตัว (ข้อ 5.15) · v12 แก้สัญญาณส่งซ้ำ ดูข้อ 3.16 |
| Edge function `backtest` | **version 4, ACTIVE** (`verify_jwt: false` — auth ด้วย INGEST_TOKEN หรือ runner token) — v4 เพิ่ม evaluator ชุดเดียวกัน · v3 เพิ่ม drawdown + นับไม้ที่ไม่ได้เข้า |
| Edge function `feed-watch` | **version 1, ACTIVE** (`verify_jwt: false`) — เตือนเมื่อชาร์ตหยุดส่ง/กลับมาส่ง เรียกโดย pg_cron ทุก 5 นาที |
| Edge function `outcome-notify` | **version 5, ACTIVE** — โค้ดตรงกับ repo แล้ว (ดูข้อ 7.3) |
| Dashboard | `https://atas-signal-board.vercel.app` |
| Vercel production branch | **`claude/form-signal-telegram-rz8am1`** (ไม่ใช่ `main` — ตั้งไว้แบบนี้) |
| Repo | `poogkma1128-design/ATAS-CLAUDE-ANALYTICS-AND-SIGNAL` |
| branch ที่ใช้พัฒนา (ฐาน / production ของ Vercel) | `claude/form-signal-telegram-rz8am1` |
| branch ที่งานล่าสุดใช้ | `claude/prop-trading-signals-priority-gtwenb` (merge เข้า branch ข้างบนแล้ว · ใช้ชื่อเดิมซ้ำได้ ให้แตกใหม่จาก branch หลักทุกครั้ง) |
| Instruments ที่มีข้อมูล | `BTCUSDT` 5m (สด) · `MNQU6` 5m · `NQU6` 5m · `GC` 5m (สามตัวหลังหยุดที่ 2026-08-28) |
| pg_cron | `evaluate-outcomes` ทุกนาที · `feed-health-watch` ทุก 5 นาที · `nightly-standing-experiment` 21:00 UTC (04:00 ไทย) |

Secrets ที่ตั้งบน Supabase แล้ว: `INGEST_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `DASHBOARD_URL`

ใน Postgres `vault` มีสองอย่าง (ใส่ไว้แล้ว ไม่ต้องทำซ้ำ): `functions_base_url` และ
`backtest_runner_token` — ใช้โดย `public.run_backtest()` ดูข้อ 3.10

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
Updater ดึง `claude/form-signal-telegram-rz8am1` โดยตรงและ build ใน temporary detached worktree;
ห้ามแก้กลับเป็น `origin/main`. มันไม่สลับ branch, ไม่ reset งานค้าง และตรวจทั้ง DLL version กับ
SHA-256 ก่อนส่งออก. รายละเอียดและหลักฐานล่าสุดดู §0E.

### 3.6 อื่น ๆ

- `NEXT_PUBLIC_*` ถูก inline ตอน build ไม่ใช่ตอน request — redeploy ที่ใช้ build cache จะได้ค่าเก่า
- Next.js ถือว่าโฟลเดอร์ขึ้นต้น `__` เป็น private route → 404
- `trailing` เป็น reserved word ของ Postgres ใช้เป็นชื่อตัวแปรใน plpgsql ไม่ได้
- supabase-js อนุมาน type จาก select string ที่เป็น **literal เดียว** — ถ้าต่อ string จะกลายเป็น error type

### 3.7 ตลาดปิด กับ bridge พัง หน้าตาเหมือนกันในหน้า feed

วันเสาร์ที่ 2026-08-29: BTCUSDT ส่งสดอยู่ ส่วน NQ/MNQ/GC เงียบสนิท **เพราะ CME/COMEX ปิดวันหยุด**
แต่ในหน้าสัญญาณมันดูเหมือนชาร์ต futures พัง 3 ตัว ข้าง ๆ คริปโตที่ยังทำงาน

วิธีแยกอยู่ในข้อมูลอยู่แล้ว ไม่ต้องเพิ่มอะไรใหม่ — indicator ส่ง **1 แท่ง** ตอนแท่งปิด และส่ง
**ทั้งประวัติเป็น batch เดียว** ตอนโหลดชาร์ต ดังนั้น:

| ที่เห็นใน `ingest_log` | แปลว่า |
|---|---|
| `bars_count = 1` เข้ามาเรื่อย ๆ | ชาร์ตสด |
| `bars_count > 1` แล้วเงียบ | เปิดชาร์ต ส่งประวัติ แล้วไม่มีแท่งใหม่ (ตลาดปิด) |
| ไม่มีแถวเลย | ยังไม่เคยส่ง — ยังไม่ได้ Add indicator หรือไม่ได้กรอก endpoint/token |

`instrument_status` (migration 0013) สรุปให้เป็น `live` / `history-only` / `silent` และหน้าเว็บแสดงไว้
บนสุดของหน้าสัญญาณ **รวมถึงบอกด้วยว่าชาร์ตที่ไม่ปรากฏชื่อ แปลว่าอะไร** — การหายไปคือคำตอบ ไม่ใช่ช่องว่าง

**กับดักที่เจอจริง:** MNQ ส่ง backfill 200 แท่งแล้วได้ 0 สัญญาณใหม่ ไม่ใช่บั๊ก —
`unique(bar_id, rule_key, direction)` ตัดซ้ำทิ้ง เพราะแท่งชุดนั้นเก็บไปแล้วเมื่อวาน
ส่วน GC/NQ เป็น instrument ใหม่ จึงได้ 18 และ 12 สัญญาณ

### 3.8 REV — เลขคนละตัวต่อส่วน และมีตัวเช็กบังคับให้ขยับ

**ทุกส่วนมีเลข REV ของตัวเอง ไม่ใช่เลขร่วม** และ**ไม่ต้องตรงกัน**:

| ส่วน | แหล่งความจริง | โผล่ที่ไหน |
|---|---|---|
| indicator | `AtasSignalBridge.csproj` → `<Version>` | แท็บ About ของ ATAS: `REV 1.2.0 \| commit <sha> \| built <time>` |
| web | `web/package.json` → `"version"` | มุมขวาบนทุกหน้า + หน้า login: `web REV 1.0.0 · <sha>` |

**ทำไมต้องแยก:** indicator ถูกแตะ 6 ครั้งจาก 52 commit ส่วนเว็บกับ server รวมกัน 25 ครั้ง
ถ้าใช้เลขร่วมกัน แท็บ About จะขยับทุกครั้งที่ deploy เว็บ แล้วเจ้าของจะไป build DLL ใหม่ฟรี ๆ
— **ปัญหาเดียวกับที่ข้อนี้แก้มาแล้วรอบหนึ่ง** (ดูย่อหน้าถัดไป)

**กติกาการขยับ:** MAJOR = สัญญา ingest เปลี่ยน · MINOR = มีของใหม่ที่เจ้าของเห็น ·
PATCH = แก้บั๊ก/ถ้อยคำ

**ตัวเช็ก — `deno task rev:check`** fail เมื่อโค้ดของส่วนไหนขยับแต่ REV ไม่ขยับ
เทียบด้วย `git merge-base --is-ancestor <commit ล่าสุดของส่วนนั้น> <commit ที่ตั้งเลขปัจจุบัน>`
(commit เป็น ancestor ของตัวเอง → ขยับ REV ใน commit เดียวกับที่แก้โค้ดก็ผ่าน)
และเช็ก working tree ด้วย จึงเตือนได้ตั้งแต่ก่อน commit

**ตัวเช็กนี้ไม่ได้มีไว้เผื่อ — มันจับของจริงได้ทันทีที่เพิ่มเข้าไป:** `<Version>` มีคอมเมนต์
"bump this by hand" กำกับอยู่แล้ว แต่ยังค้างที่ 1.1.0 ข้ามไป 1 commit ส่วน `package.json`
ค้างที่ 0.1.0 มาตั้งแต่ commit แรกสุด ข้ามไป 11 commit

**REV ของเว็บอ่านจากไฟล์ ไม่ใช่จาก git** — Vercel clone แบบตื้น `git rev-list --count`
จะให้เลขคนละค่ากับบนเครื่อง dev สำหรับ commit เดียวกัน ไฟล์ที่ commit ไว้ให้ค่าเท่ากันทุกที่

---

### 3.8b commit ของ indicator ก็ไม่ใช่ commit ของ repo

`atas-indicator/` แทบไม่เคยถูกแตะ งานเกือบทั้งหมดอยู่ฝั่ง server ดังนั้น **HEAD ของ repo ขยับตลอด
ทั้งที่ DLL ไม่ต้อง build ใหม่** ของเดิม stamp `git rev-parse HEAD` ลงไป พอเทียบกับ repo แล้วเลขไม่ตรง
เลยดูเหมือนใช้ตัวเก่าอยู่ ทั้งที่เป็นตัวล่าสุดจริง — เคยทำให้เข้าใจผิดมาแล้ว (About ขึ้น `a9d3da6`
แต่ main ไปถึง `fe0867d` โดยไม่มี commit ไหนแตะ C# เลยสักบรรทัด)

ตอนนี้ stamp เป็น `git log -1 --format=%h -- atas-indicator` = **commit ที่แตะตัว indicator ล่าสุด**
เลขนี้จะนิ่งจนกว่าจะมีการแก้ C# จริง `scripts/update-indicator.ps1` พิมพ์เลขเดียวกันให้เทียบตรง ๆ

**วิธีตอบคำถาม "ต้อง build ใหม่ไหม" ให้เด็ดขาด:**
```bash
git log -1 --abbrev=7 --format=%h -- atas-indicator
```
ตรงกับที่แท็บ About ขึ้น = ไม่ต้องทำอะไร

### 3.9 ข้อความ Telegram — สองอย่างที่เสียเวลาไปแล้วอย่าเสียซ้ำ

**Telegram ไม่ทำ hashtag ที่เป็นตัวเลขล้วนให้กดได้** `#218` เป็นข้อความเฉย ๆ แต่ `#S218` กดได้
และการกดคือการค้นหาในแชต → เจอทั้งสัญญาณและผลของไม้นั้นพร้อมกัน นี่คือเหตุผลที่ตั้งรูปแบบเป็น `#S<seq>`

**แปลงเวลาไทยด้วย offset คงที่ +7 ไม่ใช่ `Intl`** ไทยไม่มี DST ตั้งแต่ปี 2484 ค่า UTC+7 จึงจริงทุกวันที่
ส่วน edge runtime ไม่รับประกันว่ามี timezone database ครบ ถ้าขาด `Intl` จะคืนค่าเป็น UTC **เงียบ ๆ**
ทั้งที่ข้อความติดป้ายว่าเป็นเวลาไทย ซึ่งแย่กว่าการไม่แปลงเลย

---

### 3.13 select list สองชุดของ component เดียวกัน = ค่าที่หายไปกลายเป็น 0

หน้าสัญญาณเคยแสดง `SL 0 · TP 0` ทุกแถวตอนโหลดครั้งแรก ทั้งที่ DB มี SL/TP ครบทุกไม้
สาเหตุ: `SignalFeed.tsx` มี select ครบ (ใช้ตอน realtime) แต่ `app/page.tsx` (โหลดครั้งแรก)
มี select ที่**ขาดคอลัมน์แผนไปทั้งชุด** พอ `stop_price` เป็น `undefined` เงื่อนไข
`stop_price !== null` ก็**ผ่าน** (เพราะ `undefined !== null` เป็นจริง) แล้ว `num(undefined)` คืน `0`

แก้สองชั้น: export `SIGNAL_SELECT` ตัวเดียวให้ทั้งสองที่ใช้ (เลื่อนออกจากกันไม่ได้อีก)
และเปลี่ยนเงื่อนไขเป็น `!= null` ซึ่งดัก `undefined` ด้วย

**บทเรียน:** `!==` กับ `null` ไม่ได้กันคอลัมน์ที่ไม่ได้ select — มันกันแค่ค่าที่เป็น null จริง ๆ
และ `num()` ที่คืน 0 ให้ทุกอย่างที่แปลงไม่ได้ ทำให้ "ไม่มีข้อมูล" หน้าตาเหมือน "ศูนย์"

⚠️ ต้องคง select ไว้เป็น **literal เดียว** ห้ามต่อ string (ข้อ 3.6)

#### ภาคสอง — ที่แก้ครั้งแรกทำหน้าแรกพัง 500 ทุก request

การแก้รอบแรกเอา `SIGNAL_SELECT` ไปไว้ใน `SignalFeed.tsx` แล้วให้ `app/page.tsx` import มาใช้
**แต่ `SignalFeed.tsx` เป็น `"use client"`** — server component ที่ import จาก client module
จะไม่ได้ค่าจริง แต่ได้ **client-reference proxy** แทน

ผลคือ `.select(proxy)` แล้ว postgrest-js เรียก `.split(",")` บน object:

```
TypeError: (intermediate value).split is not a function
    at V.select (.next/server/chunks/501.js)
    at l (.next/server/app/page.js)     digest: 3299342594
```

**`next build` ผ่าน · typecheck ผ่าน · แล้วพังทุก request** — เพราะ TypeScript มองว่า type ของ
export จาก client module คือ type ของค่านั้น ไม่มีอะไรเตือนก่อน runtime เลย
และหน้าแรกคือหน้าเดียวที่ยิง query นี้ฝั่ง server จึงพังเฉพาะ `/` ส่วน `/login` ปกติ
ทำให้เช็กจากภายนอกแบบไม่ล็อกอินไม่เจอ (`/` → 307 → `/login` → 200 ดูปกติทุกอย่าง)

**ทางแก้:** ย้าย `SIGNAL_SELECT` ไป `lib/types.ts` ซึ่งเป็น module ธรรมดา ไม่ประกาศฝั่งไหนเลย
วางไว้ติดกับ `SignalRow` ที่มันผลิตออกมา — ได้ทั้ง "literal เดียว" และ "ข้ามเส้น client/server ได้"

**กฎที่ได้มา:** *อะไรก็ตามที่ทั้ง server component และ client component ต้องใช้ ต้องอยู่ใน module
ที่ไม่ประกาศ `"use client"`* — ตรวจแล้ว `SIGNAL_SELECT` เป็นตัวเดียวในโปรเจกต์ที่เคยข้ามเส้นแบบนี้
(ที่เหลือ import จาก client module เป็น component หรือ `type` ซึ่งปลอดภัยทั้งคู่)

**วิธีตรวจว่าแก้ติดจริง** (ไม่ต้องล็อกอิน): นับชื่อ export ใน server bundle —
proxy จะเก็บชื่อไว้เป็น string

```bash
grep -o "SIGNAL_SELECT" web/.next/server/app/page.js | wc -l
# ตอนพัง = 6 (คือ proxy registration) · ตอนแก้แล้ว = 0
```

---

### 3.15 หน้าเว็บพังแล้วไม่บอกอะไรเลย — ไม่มี error boundary มาตลอด

`Application error: a server-side exception has occurred ... Digest: 681497131`
บนหน้าขาวโล่ง คือหน้าจอ default ของ Next เมื่อ server component โยน error
และ **ไม่มี `app/error.tsx` ในโปรเจกต์นี้มาตั้งแต่ต้น**

น่าขันตรงที่ทั้งเว็บออกแบบมาให้ "ไม่มีข้อมูล" พูดออกมาเสมอ (ชาร์ตที่ไม่เคยส่ง · drawdown
ที่ยังไม่ได้วัด · SL ที่หายไปไม่ใช่ศูนย์) แต่ **ความพังที่หยุดคนใช้จริง ๆ กลับได้แค่เลขก้อนเดียว**

เพิ่ม `app/error.tsx` + `app/global-error.tsx` แล้ว:
- **แสดง digest ให้เห็น** เพราะมันคือที่จับเดียวที่โยงไปหา log ตัวจริง —
  Next ตั้งใจไม่ส่งข้อความ error มาที่เบราว์เซอร์ เพื่อไม่ให้ stack trace รั่ว
  เลขนี้ต้องเอาไปค้นที่ **Vercel → Deployment → Runtime Logs**
- บอกว่า **การรับสัญญาณและ Telegram ไม่ได้รับผลกระทบ** — สองอย่างนั้นอยู่ฝั่ง Supabase
  ไม่ได้ผ่านเว็บ คนอ่านจะได้ไม่เข้าใจผิดว่าระบบเทรดล่มไปด้วย
- มีปุ่ม **ออกจากระบบแล้วเข้าใหม่** ซึ่งแก้กับดักเฉพาะอย่าง: session ที่ middleware ยอมรับ
  แต่หน้าใช้ไม่ได้ จะทำให้**ทุกหน้าพังพร้อมกันและออกไม่ได้** เพราะ `/login` ก็จะถูก redirect
  กลับออกมาอีก (middleware เห็นว่า login อยู่) — ล้าง session จากหน้า error คือทางเดียวที่หลุด

**ที่ยังไม่รู้:** ข้อความจริงของ digest 681497131 — ต้องดูจาก Vercel runtime log
ซึ่ง **ผมเข้าไม่ถึง** (Vercel connection ที่มีเห็นเฉพาะโปรเจกต์ `rent-ease-saas` ตอบ 403
สำหรับ `atas-signal-board`) ตรวจจากภายนอกได้แค่ว่า **preview กับ production
ตอบเหมือนกันทุกเส้นทางเมื่อยังไม่ล็อกอิน** (`/` → 307 → `/login` → 200)
แปลว่าไม่ใช่ปัญหาเฉพาะ branch และ env var ครบ (ไม่งั้น middleware จะตอบ 503 พร้อมข้อความ)

---

### 3.16 อ่านก่อนแล้วค่อยเขียน = ส่งซ้ำ 3 ข้อความต่อไม้เดียว

ผลลัพธ์ของไม้เดียวเด้งเข้าโทรศัพท์ 2–3 ครั้ง ทั้งที่ในตารางถูกต้องหมดและ `notified_at`
ถูกประทับครั้งเดียว **ข้อมูลไม่ได้ผิด มีแต่การส่งที่ซ้ำ**

`flushOutcomeNotifications()` เดิมทำสามขั้นตามลำดับนี้:

1. `select` แถวที่ `notified_at is null`
2. ส่ง Telegram ทีละแถว
3. `update` ประทับ `notified_at`

มันถูกเรียกท้าย ingest ทุกครั้ง และ **ชาร์ต 4 ตัวยิงเข้ามาพร้อมกัน** — ดูจาก `ingest_log` จริง:
NQU6 กับ MNQU6 ห่างกัน **10 มิลลิวินาที** ทั้งคู่ทำขั้นที่ 1 ก่อนที่ใครจะไปถึงขั้นที่ 3
จึงเห็นแถวเดียวกัน ส่งเหมือนกัน แล้วค่อยประทับทับกัน

**ทำไมฝั่งประกาศสัญญาณไม่เคยเป็น:** `signals` ใช้ `upsert` + `ignoreDuplicates` บน unique key
ingest ที่มาทีหลังจึงได้ผลลัพธ์ว่างและไม่ประกาศอะไรเลย — **การเขียนเป็นตัวจอง** ส่วนฝั่งนี้เขียนทีหลัง
จึงไม่มีการจองเกิดขึ้นเลย

**ทางแก้ — ให้การประทับเป็นการจอง:** migration 0026 เพิ่ม `claim_outcome_notifications()`
ที่ `update ... returning` อยู่ในคำสั่งเดียวกับที่ `select` ภายใต้ **`for update skip locked`**
คนที่มาทีหลังได้แถวถัดไปหรือไม่ได้เลย แต่ไม่มีทางได้แถวเดียวกัน

พิสูจน์แล้วในทรานแซกชันที่ rollback ทิ้ง: ปล่อยแถวเดียวกลับเข้าคิว แล้วเรียกซ้อนกันสองครั้ง
→ **ครั้งแรกได้ 1 แถว ครั้งที่สองได้ 0**

**ราคาที่ต้องจ่ายและเหตุผลที่ยอมจ่าย:** จองก่อนส่ง แปลว่าถ้าส่งพลาด แถวจะถูกประทับว่าบอกแล้ว
ทั้งที่ยังไม่ได้บอก → ตัวเรียกจึง **คืนแถวที่ส่งไม่สำเร็จกลับเป็น null** (`sendOutcome` คืน null เมื่อพลาด)
เหลือกรณีเดียวที่ยังเสียคือ crash คาระหว่างจองกับส่ง ซึ่งยอมแลก เพราะ**ผลลัพธ์เด้งสามครั้งทุกไม้
ทำให้คนเลิกอ่านมันไปเลย ซึ่งเสียทั้งหมด** ส่วนไม้เดียวที่หายยังตามดูได้จากหน้าเว็บ

⚠️ ฟังก์ชันนี้ `revoke execute from anon, authenticated` เพราะมันทั้งแก้ข้อมูลและคืนรายละเอียดไม้
ส่วน anon key ฝังอยู่ใน bundle ของเว็บ (ข้อห้าม #16)

---

### 3.14 ตัวเช็กการ fill เกือบทำ baseline เพี้ยนเงียบ ๆ — ความผิดพลาดชนิดเดียวกับ 3.13

`fillIndex()` ตอนแรกเขียนไว้ว่า "ไล่ดูแท่งถัดไปว่าราคาแตะจุดเข้าไหม" แล้วคอมเมนต์กำกับว่า
"ถ้า `pullbackShare` = 0 จุดเข้าคือราคาปิด เลยได้ index 0 เสมอ" — **คอมเมนต์พูดถูก แต่โค้ดไม่ได้ทำอย่างนั้น**

`forward` คือแท่ง**หลัง**แท่งสัญญาณ ส่วนราคาปิดคือราคาของ**แท่งสัญญาณเอง** ถ้าแท่งถัดไป
gap หนีไป ไม่ย้อนกลับมาแตะราคาปิดเดิม โค้ดจะตอบ `null` = "ไม่ได้เข้า" **ทั้งที่ pullback ปิดอยู่**
ผลคือ baseline — ตัวที่ทุก variant ถูกอ่านเทียบด้วย — จะกลายเป็นการวัดคนละอย่างกับที่เคยวัด
โดยไม่มีอะไรฟ้อง ตัวเลขจะยังออกมาสวยงามและผิด

เทสต์ที่มีอยู่ผ่าน เพราะแท่งตัวอย่างในเทสต์บังเอิญคร่อมราคาเข้าพอดี — **ชื่อเทสต์ถูก
แต่ข้อมูลในเทสต์ไม่ได้ทดสอบเคสที่พัง**

แก้โดยตัดสิน market entry ก่อนจะไปดู `forward` เลย: long ที่จุดเข้า `>=` ราคาปิด (short กลับด้าน)
คือราคาที่ได้ทันทีอยู่แล้ว ไม่ต้องรอใครมาแตะ เผื่อครึ่ง tick ไว้เพราะ `buildPlan` ปัดจุดเข้าลงกริด
ส่วนราคาปิดไม่จำเป็นต้องอยู่บนกริดพอดี — **การปัดเศษต้องไม่ใช่สิ่งที่ตัดสินว่าไม้เกิดหรือไม่เกิด**

เพิ่มเทสต์ 2 ตัว (`fill: a gap away from the close is not a missed fill`,
`fill: rounding to the tick grid does not decide it`) และ**พิสูจน์แล้วว่ามันแดงถ้าเอาการแก้ออก**
เทสต์ที่แดงไม่ได้ไม่ใช่เทสต์

ยืนยันจากของจริง: รอบ `pullback entry sweep` แถว `baseline` ได้ `missed_fills = 0`
และ `fill_rate = 1.0000` พอดี — ถ้า baseline มี missed แม้แต่ไม้เดียวแปลว่า `fillIndex()` ยังผิด
**นี่คือค่าที่ต้องดูก่อนเชื่อผลการกวาดใด ๆ ที่แตะเรื่องจุดเข้า**

---

### 3.10 วิธีสั่ง backtest — ต้องผ่าน Postgres ไม่ใช่ curl

`INGEST_TOKEN` อยู่แค่ใน environment ของ edge function อ่านจาก SQL ไม่ได้ และ anon key
ก็ใช้ไม่ได้เพราะมันฝังอยู่ใน bundle ของเว็บ (ใครเปิดเว็บก็สั่งรันได้) ทางที่ใช้จริงคือ:

- `public.runner_tokens` เก็บ **hash** ของ key ที่ฟังก์ชันยอมรับ (RLS เปิด ไม่มี policy —
  service role เท่านั้นที่อ่านได้)
- `public.issue_runner_token(label)` ออก key ใหม่และคืน plaintext **ครั้งเดียว** อ่านย้อนไม่ได้
- plaintext ตัวที่ใช้อยู่ถูกเก็บใน `vault` ชื่อ `backtest_runner_token`
- `public.run_backtest(body jsonb)` อ่าน vault แล้วยิงผ่าน `pg_net` — token ไม่เคยโผล่ในคำสั่ง

สั่งรันจริง (จาก MCP `execute_sql` ได้เลย):

```sql
select public.run_backtest('{
  "name": "ชื่อการทดลอง",
  "note": "ทำไมถึงถามคำถามนี้",
  "maxBars": 400,
  "variants": [
    { "label": "reward 3", "params": { "rewardRatio": 3 } },
    { "label": "ratio 3.5", "ruleKey": "stacked_imbalance", "params": { "ratio": 3.5 } }
  ]
}'::jsonb) as request_id;

-- pg_net เป็น fire-and-forget ผลมาทีหลัง:
select status_code, left(content, 2000) from net._http_response where id = <request_id>;
```

`params` จะถูก **merge ทับ** ค่าที่ใช้อยู่จริง ไม่ได้แทนทั้งชุด · ไม่ใส่ `ruleKey` = ใช้กับทุกกฎ
· ทุกครั้งจะมี variant ชื่อ `baseline` (ค่าที่ใช้อยู่จริง) รันเทียบให้เสมอ
· `label` ห้ามชื่อ `baseline` · สูงสุด 8 variants ต่อครั้ง
· feed ที่มีแท่งน้อยกว่า 70 จะถูกข้าม

**สิ่งที่มันทำไม่ได้เลยคือส่ง Telegram** — ไม่ใช่เพราะมี flag ปิดไว้ แต่เพราะมันเขียนลง
`experiments` / `experiment_results` เท่านั้น ไม่แตะ `public.signals` ซึ่งเป็นทางเดียวที่ต่อกับ
Telegram อยู่ (ดู `supabase/functions/backtest/index.ts` — ไม่มี import ของ telegram.ts)

### 3.11 CPU ของ edge function **เคย**ไม่ใช่คอขวด — ตอนนี้เป็นแล้ว

**ของเดิม (ยังจริงในบริบทของมัน):** 6 variants × 812 แท่ง = 2.3 วินาที · 9 variants ไม่ถึง 3 วิ
ที่ต้องระวังคือขนาด response ของ PostgREST ตอนโหลดแท่ง จึงแบ่งดึงทีละ 100 แท่ง

⚠️ **อัปเดต 2026-09-01 — ประโยคข้างบนพาผมชนกำแพง** ตอนกวาดค่าตามข้อ 8.6
`backtest` ตอบ **546 `WORKER_RESOURCE_LIMIT`** และ log ขึ้น **`CPU Time exceeded`**

**สิ่งที่วัดได้จริงในวันนั้น** (บาร์รวม ~2,750 → 2,900 และเพิ่มขึ้นเรื่อย ๆ เพราะ futures เปิด):

| ตั้งค่า | ผล |
|---|---|
| 8 variants + baseline · 1000 แท่ง | ❌ ตาย |
| 3 variants + baseline · 1000 แท่ง | ✅ ผ่าน (2 วิ) — **สามครั้งแรก** |
| 3 variants + baseline · 1000 แท่ง · **ยิงพร้อมอีกรันหนึ่ง** | ❌ ตาย |
| 2 variants + baseline · 1000 แท่ง · รันเดี่ยว | ❌ ตาย (หลังบาร์เพิ่มอีก) |
| 3 variants + baseline · **600 แท่ง** | ✅ ผ่าน |

**บทเรียนสามข้อ:**

1. **ตัวคูณคือ (จำนวน variants × จำนวนแท่ง)** ไม่ใช่จำนวน variants อย่างเดียว
   ข้อ 5.11 กวาด 8 variants ได้เพราะตอนนั้นใช้ค่า default **400 แท่ง** ไม่ใช่ 1000
2. **ห้ามยิงสองรันพร้อมกัน** — ขนาดที่ผ่านตอนรันเดี่ยว ตายทันทีเมื่อรันคู่
3. **เพดานนี้เลื่อนลงเรื่อย ๆ** ทุกวันที่ feed เดิน บาร์เพิ่ม งานต่อ variant เพิ่ม
   ค่าที่ผ่านวันนี้อาจไม่ผ่านพรุ่งนี้ **ให้ลด `maxBars` ก่อนลดจำนวน variants**
   เพราะการลด variants ทำให้ต้องแตกหลายรันแล้วเทียบข้ามรันซึ่งอ่านยากกว่า

⚠️ **ผลข้างเคียงที่อันตรายกว่าตัว error:** worker ถูกฆ่า**ก่อน**โค้ดจะถึง `catch` ของตัวเอง
ฉะนั้น `finishExperiment(..., 'failed')` **ไม่เคยถูกเรียก** แถวใน `experiments` จึงค้างที่
`status = 'running'` ตลอดกาล และหน้า `/experiments` จะโชว์ว่า "กำลังรัน" ทั้งที่ตายไปแล้ว
**เจอแถวแบบนี้ให้เช็ก `net._http_response` ก่อนเสมอ** — `select status_code, content
from net._http_response where id = <req_id>` ถ้าได้ 546 คือตายด้วยเรื่องนี้ ให้ปิดแถวเอง

**ทางแก้ระยะยาวที่ยังไม่ได้ทำ:** ให้ตัวรันเขียนผลทีละ variant แทนที่จะสะสมทั้งหมดแล้ว
insert ทีเดียวตอนจบ — variant ที่รันเสร็จแล้วจะไม่หายไปพร้อม worker และแถว experiment
จะไม่ค้าง ดูข้อ 7.2

### 3.12 `JWT issued at future` ตอน ATAS เพิ่งเปิด — หายเอง อย่าไปแก้

โพสต์แรกหลังเปิด ATAS ใหม่บางครั้งได้ error นี้ใน `ingest_log`:

```
instrument upsert failed: JWT issued at future
```

เป็นนาฬิกาเหลื่อมกันระหว่าง edge runtime ที่เพิ่ง cold start กับ service-role JWT ของตัวเอง
โพสต์นั้นตกไปทั้งก้อน (bars_count = 0) แต่ **ATAS ส่งซ้ำเองภายในไม่กี่วินาทีแล้วผ่าน**
เห็นครั้งเดียวจาก 5 โพสต์ตอน 2026-08-30 02:55 UTC และแท่งไม่หายเพราะโพสต์ถัดมาส่งมาครบ

ไม่ต้องแก้อะไร ถ้าเห็นซ้ำ ๆ ติดกันหลายโพสต์ค่อยสงสัย — นั่นแปลว่าไม่ใช่ cold start แล้ว

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
| 14 | **สถานะ feed ในหน้าสัญญาณ** | ตลาดปิดกับ bridge พังหน้าตาเหมือนกัน — ดูข้อ 3.7 |
| 15 | **ตัวรัน backtest + หน้า `/experiments` + สำรอง/ย้อนค่า** | เปลี่ยน threshold ของกฎแล้วรู้ผลก่อนที่โทรศัพท์จะดัง — ดูข้อ 3.10 และ 5.6 |
| 16 | **`settings_effect` + `price_action_edge` บน `/stats`** | คำถามสองข้อที่เคยเป็น "จำไว้ว่าต้องกลับมารันคิวรีนี้" กลายเป็น view ที่ตอบเอง — ดูข้อ 5.9 และ 8.1 |
| 17 | **เลข REV แยกตามส่วน + `deno task rev:check`** | เลขเวอร์ชันที่ลืมขยับได้ ตอบคำถาม "ใช่ตัวล่าสุดไหม" ผิด ซึ่งแย่กว่าไม่มีเลข — ดูข้อ 3.8 |
| 18 | **กวาด threshold ของกฎครบทุกตัว** | ค่าที่ตัดสินว่าสัญญาณไหนเกิด ไม่เคยถูกวัดเลย — ดูข้อ 5.11 |

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

### 5.4b ทำไม trail ถึงเป็น 0.5 / 0.25 (ไม่ใช่ 1 / 0.5 แบบเดิม)

หลุมที่ใหญ่ที่สุดคือ **ไม้ที่โดน SL ตั้งแต่แท่งแรก: 73 ไม้ −72.99R** เฉลี่ยราคาสวนไป 3.84R
แท่งที่วิ่งสวน 4 เท่าของความเสี่ยงนั้นทำอะไรไม่ได้ แต่ทางออกที่ **ได้ผลคือ trail และได้ผลทุกกรณี**:

| ทางออก | ไม้ | รวม R |
|---|---|---|
| stop | 130 | −129.99 |
| target | 50 | +100.00 |
| **trail** | **72** | **+66.49** — บวกทุกช่วงเวลาถือ ตั้งแต่ 2 ถึง 8 แท่ง |
| timeout | 21 | +2.17 |

ไม่มีช่วงเวลาถือไหนที่ trail ขาดทุนเลย จึงทดสอบว่าไปถึง trail เร็วขึ้นจะเปลี่ยน stop เป็นกำไรเล็ก ๆ ได้ไหม
เดินแท่งใหม่ทั้ง 273 ไม้:

| trailAfterR | trailOffsetR | รวม R | Win rate |
|---|---|---|---|
| **0.50** | **0.25** | **+54.98** | **56.0%** |
| 0.75 | 0.25 | +49.37 | 52.4% |
| 1.00 | 0.25 | +45.63 | 48.7% |
| 0.50 | 0.50 | +40.79 | 55.7% |
| 1.00 | 0.50 | +34.84 | 48.7% ← ของเดิม |
| 1.50 | 0.50 | +16.79 | 42.9% |

**เป็นความชัน ไม่ใช่ยอดโดด** — เร็วขึ้นดีขึ้นทุกครั้ง แคบลงดีขึ้นทุกครั้ง จึงเป็นผลจริงไม่ใช่ fit
และดีขึ้น**ทั้ง R และ win rate พร้อมกัน** ซึ่งผิดปกติพอที่จะต้องบอก เพราะสองอย่างนี้ปกติแลกกัน

**นี่คือชนิดของการปรับที่ backtest เชื่อได้มากที่สุด** — ค่า trail ไม่ได้ตัดสินว่าสัญญาณไหนจะเกิด
ตัดสินแค่วิธีออกจากไม้ที่เจอแล้ว การจำลองจึงเดินบนไม้ที่เกิดขึ้นจริงเป๊ะ ไม่ใช่เดาว่าจะเจอไม้ชุดอื่น
(ต่างจากการปรับ threshold ของกฎ ซึ่งเปลี่ยนชุดสัญญาณทั้งหมด และยังทำแบบนี้ไม่ได้)

### 5.4c กวาด trail ต่อจนสุดทาง — **ไม่รับอะไรเลย** และเจอว่าทำไมถึงรับไม่ได้

**คำถามตั้งต้น:** "ยกเลิกการขยับ SL เพราะมันดัน win rate แลกกับคุณภาพสัญญาณ"
เหตุผลนี้ผิด — ข้อ 5.4b เลือก 0.5/0.25 จาก **R รวม** ไม่ใช่ win rate (และข้อห้าม #12
ห้ามเล็ง win rate อยู่แล้ว) **แต่คำถามไปโดนรูจริงรูหนึ่ง**: ตารางในข้อ 5.4b
**ไม่มีจุดกลับตัว** และ 0.5/0.25 คือ*ขอบของช่วงที่ทดสอบเอง* ซึ่งตรงกับข้อห้าม **#14** เป๊ะ
จึงกวาดต่อ 2 รอบ 12 ค่า รวมทั้ง **ปิด trail** ด้วย

#### รอบที่ 1 — `trail sweep past the edge` (744 ไม้ 7 กฎ / 367 ไม้ 4 กฎที่ส่งจริง)

อ่านที่ **R/ไม้ ของ 4 กฎที่ส่ง Telegram จริง** เป็นหลัก (`r4`) เพราะกฎใหม่ 3 ตัวยังปิดเสียงอยู่
ไม่ควรให้ไม้ที่ไม่มีใครได้เห็นเป็นตัวตัดสินค่าที่ใช้จริง

| trailAfterR / OffsetR | r4 | r7 | DD | แพ้ติด | WR |
|---|---|---|---|---|---|
| **ปิด trail** | **0.110** | 0.152 | **33.60** | **15** | 35.9% |
| 1.0 / 0.5 (ก่อน 0014) | 0.290 | 0.299 | 13.88 | 7 | 49.5% |
| 0.75 / 0.25 | 0.380 | 0.363 | 10.40 | 6 | 53.5% |
| **0.5 / 0.25 (ใช้อยู่)** | **0.416** | 0.403 | 8.13 | 6 | 59.1% |
| 0.25 / 0.25 | 0.423 | 0.425 | 6.52 | 6 | 64.8% |
| 0.5 / 0.125 | 0.463 | 0.451 | 7.26 | 6 | 59.1% |
| 0.25 / 0.125 | **0.475** | 0.482 | 6.33 | 6 | 65.3% |

#### รอบที่ 2 — `bracket the collapse` (ชุดบาร์กว้างกว่า baseline r4 = 0.411 — **ห้ามเทียบข้ามรอบ**)

| trailAfterR / OffsetR | r4 | DD | WR |
|---|---|---|---|
| 0.25 / 0.0625 | 0.456 | 6.28 | 64.6% |
| 0.25 / 0.03125 | 0.456 | 6.28 | 64.6% |
| 0.125 / 0.125 | 0.460 | 7.33 | 68.9% |
| 0.5 / 0.0625 | 0.461 | 8.25 | 59.1% |
| 0.125 / 0.0625 | 0.466 | 7.02 | 68.9% |
| **0.0625 / 0.03125** | **0.482** | **5.31** | 68.9% |

---

**ข้อสรุปที่ 1 — ห้ามปิด trail เด็ดขาด** นี่คือคำตอบตรง ๆ ของคำสั่งตั้งต้น
ปิดแล้ว R/ไม้ ร่วงจาก 0.416 เหลือ **0.110** · drawdown จาก 8.13 พุ่งเป็น **33.60 (4 เท่า)** ·
แพ้ติดกันจาก 6 ไม้เป็น **15 ไม้** ตามข้อห้าม #17b หลุมลึกขนาดนั้นคือหลุมที่คนเลิกใช้ก่อนได้กำไร
**และนี่เป็นตัวเลขที่น่าเชื่อที่สุดในตาราง** เพราะไม้ที่ไม่มี trail ออกที่ `plan.stop`/`plan.target`
ซึ่งเป็นระดับที่รู้ล่วงหน้า ไม่ต้องเดา path ในแท่ง — ต่างจากทุกแถวที่มี trail

**ข้อสรุปที่ 2 — แต่ก็ห้ามรับค่าที่แน่นกว่านี้เหมือนกัน** กวาด 12 ค่าแล้ว **ยังไม่เจอจุดกลับตัว**
แน่นขึ้นดีขึ้นทุกครั้ง เร็วขึ้นดีขึ้นทุกครั้ง จนถึง 0.0625/0.03125 ซึ่งก็ยังเป็นขอบอีก
ข้อห้าม #14 บอกว่าอาการนี้แปลว่า**กำลัง exploit โมเดล** และรอบนี้**เห็นกลไกชัด**:

> ตัวจำลองเห็นแค่ high/low ของแท่ง ไม่เห็นทางเดินในแท่ง trail ที่แน่นระดับ **ต่ำกว่า 1 tick**
> (offset 0.19–0.38 tick ที่ risk 4–6 ticks) จึงถูกสมมติว่าได้ออกที่ `best − offset` เป๊ะ ๆ
> ทั้งที่ของจริงราคาจะแกว่งข้ามมันตลอดเวลา **ยิ่ง trail แน่น ผลลัพธ์ยิ่งพิงกับสิ่งที่ตัวจำลองมองไม่เห็น**

ข้อ 5.4b เรียก trail ว่า "ชนิดของการปรับที่ backtest เชื่อได้มากที่สุด" ซึ่งถูก**เฉพาะที่ปลายหยาบ**
พอลงมาถึงระดับต่ำกว่า tick มันกลายเป็นการวัดสมมติฐานของตัวจำลอง ไม่ใช่การวัดตลาด

**ข้อสรุปที่ 3 — เจอความผิดปกติที่ยังอธิบายไม่ได้** `0.25/0.0625` กับ `0.25/0.03125`
ให้ผล **เหมือนกันทุกหลัก** (r4 0.456 · R รวม 409.96 · DD 6.28 · exit mix 98/292/460/19)
ทั้งที่ offset ต่างกัน 2 เท่า และตรวจแล้วว่าไม่ใช่ปัญหา rounding (risk 6 ticks → 0.38 vs 0.19 tick)
แต่ `0.125/0.125` กับ `0.125/0.0625` **ต่างกัน** (408.00 vs 416.11) ทั้งที่ exit mix เท่ากันเป๊ะ
**ยังไม่รู้ว่าทำไม** และลำพังข้อนี้ก็เป็นเหตุผลพอที่จะไม่รับค่า trail ละเอียดใด ๆ จนกว่าจะเข้าใจ

**ผลสุทธิ: `trailAfterR 0.5` / `trailOffsetR 0.25` อยู่เหมือนเดิม ไม่มี migration**
0.5/0.25 ไม่ใช่ค่าที่ดีที่สุดในตาราง แต่เป็นค่าที่ดีที่สุด**ที่ยังอ่านได้จากข้อมูลระดับแท่ง**

**ถ้าจะกลับมาทำต่อ ต้องมีอย่างใดอย่างหนึ่งก่อน:** (ก) ข้อมูลละเอียดกว่าแท่ง 5m
เพื่อให้ trail ต่ำกว่า tick มีความหมาย — ซึ่งคือเหตุผลข้อหนึ่งของ REV-RITHMIC-001 (ข้อ 8.4) ·
หรือ (ข) อธิบายความผิดปกติในข้อสรุปที่ 3 ให้ได้ก่อน

**เกร็ดที่ควรรู้ไว้ (ยังไม่พอตัดสิน):** ปิด trail แล้ว **ดีขึ้น** บน MNQU6 (0.235 vs 0.162)
และ NQU6 (0.346 vs 0.288) แต่พังบน BTCUSDT (0.147 vs 0.506) และ GC (−0.030 vs 0.308)
ประโยชน์ของ trail จึงกระจุกอยู่ที่ BTC/GC — แต่ MNQU6 มี 127 ไม้ NQU6 มี 56 ไม้ ยังไม่ผ่าน
ข้อห้าม #11 **อย่าเพิ่งเอาไปตั้ง `rule_overrides`** ถ้าวันหนึ่งฟิวเจอร์สเดินครบหลายเซสชัน
นี่คือช่องแรกที่ควรกลับมาวัดซ้ำ

---

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

### 5.6 `rewardRatio` — ข้อค้นพบที่ใหญ่ที่สุดจากตัวรัน backtest (✅ ปรับเป็น 3.0 แล้ว 2026-08-30)

รันจริง 4 การทดลอง บนแท่งทั้งหมดที่มี (BTCUSDT 375 · MNQU6 239 · NQU6 100 · GC 100 = 812 แท่ง
5m, 2026-08-28 ถึง 2026-08-29) ผลอยู่ในตาราง `experiments` / `experiment_results` และดูได้ที่
`/experiments`

**หลักฐานชั้นดี:** `rewardRatio` ไม่เปลี่ยนว่า *ไม้ไหนเกิด* มันเปลี่ยนแค่ว่า TP อยู่ตรงไหน
ทุก variant จึงเดินบน **174 ไม้ชุดเดียวกันเป๊ะ ๆ** (จำนวน SL เท่ากันหมดที่ 67) — ชั้นหลักฐาน
เดียวกับตอนปรับ trail ไม่ใช่การเทียบชุดสัญญาณคนละชุดกัน

| rewardRatio | ไม้ | ชนะ | R รวม | R/ไม้ | TP | SL | trail | หมดเวลา |
|---|---|---|---|---|---|---|---|---|
| 1.25 | 174 | 58% | +21.43 | 0.123 | 50 | 67 | 51 | 6 |
| 1.5  | 174 | 58% | +31.80 | 0.183 | 44 | 67 | 57 | 6 |
| 1.75 | 174 | 58% | +41.10 | 0.236 | 40 | 67 | 61 | 6 |
| **2.0 (ใช้อยู่)** | 174 | 58% | **+49.64** | **0.285** | 36 | 67 | 65 | 6 |
| 2.5  | 174 | 58% | +63.92 | 0.367 | 28 | 67 | 73 | 6 |
| 3.0  | 174 | 58% | +73.25 | 0.421 | 20 | 67 | 81 | 6 |
| 4.0  | 174 | 58% | +83.44 | 0.480 | 11 | 67 | 90 | 6 |
| 6.0  | 174 | 58% | +99.29 | 0.571 | 6  | 67 | 95 | 6 |
| 32   | 174 | 58% | +156.59 | 0.900 | 2 | 67 | 99 | 6 |

**อัตราชนะไม่ขยับเลยสักค่าเดียว** เพราะ trail 0.5/0.25 ตัดสินแพ้ชนะไปแล้ว: ไม้ที่วิ่งถึง 0.5R
จะได้ stop ที่ `best − 0.25R` แปลว่ามันชนะแน่นอนอย่างน้อย +0.25R ไม่ว่า TP จะอยู่ไหน
การขยับ TP จึงเปลี่ยนแค่ว่า "ชนะเท่าไร" ไม่ใช่ "ชนะหรือแพ้"

**เช็กว่าไม่ใช่ของแถมจาก trail:** รันไขว้ TP × trail (การทดลอง `target versus trail`)
TP กว้างขึ้นดีขึ้น**ทุกแบบของ trail รวมทั้งไม่มี trail เลย**

| ตั้งค่า | R รวม | R/ไม้ | ชนะ |
|---|---|---|---|
| ไม่มี trail, reward 2 | +28.85 | 0.166 | 43% |
| ไม่มี trail, reward 3 | +50.29 | 0.289 | 39% |
| trail 1/0.5 (แบบเก่า), reward 2 | +44.84 | 0.258 | 52% |
| trail 1/0.5, reward 3 | +68.85 | 0.396 | 52% |
| trail 0.5/0.25 (ปัจจุบัน), reward 2 | +49.64 | 0.285 | 58% |
| trail 0.5/0.25, reward 3 | +73.25 | 0.421 | 58% |

กลไกจริงคือ **TP ที่ 2R กำลังตัดขาไม้ที่ยังวิ่งต่อ** ส่วนขาแพ้ถูก SL ล็อกไว้อยู่แล้ว
การขยับ TP ออกจึงเพิ่มด้านบนโดยไม่เพิ่มด้านล่าง — และ trail คือตัวที่แปลง "วิ่งต่อ" เป็น "ชนะ"
(ไม่มี trail อัตราชนะร่วงเหลือ 39–43% ทันที)

**ทุก instrument ดีขึ้น ไม่มีตัวไหนแย่ลง** (R/ไม้ ที่ reward 3.0 เทียบ 2.0):

| instrument | ไม้ | 2.0 | 3.0 |
|---|---|---|---|
| BTCUSDT | 98 | 0.385 | **0.567** |
| GC | 18 | 0.579 | **0.597** |
| MNQU6 | 46 | −0.078 | **−0.008** |
| NQU6 | 12 | 0.427 | **0.605** |

**ทำไมยังไม่ปรับ:** เส้นมัน**ไม่มีจุดกลับตัว** — ไล่ไปถึง reward 32 ก็ยังขึ้น ซึ่งแปลว่าข้อมูลเท่านี้
บอกไม่ได้ว่าควรหยุดตรงไหน (และที่ reward 16→32 ส่วนต่าง +32.00R มาจากไม้ **2 ไม้** ที่ชน TP
ระดับนั้นพอดี — ปลายเส้นพิงอยู่บนไม้ไม่กี่ไม้) บวกกับข้อมูลแค่ ~2 วัน 174 ไม้ ยังไม่ครบ 3 เซสชัน
ตามด่านความนิ่งในข้อ 5.5

**สิ่งที่ทำไป:** ขยับ `rewardRatio` 2.0 → **3.0** ทุกกฎ (migration 0019, 2026-08-30)
เลือก 3.0 เพราะอยู่ในช่วงที่ข้อมูลหนา (ยังมี TP โดน 20 ไม้ ไม่ได้พิงหางแจก) ดีขึ้นทั้ง 4
instrument และเพื่อนบ้าน (2.5 / 4.0) เห็นตรงกัน — **ไม่ได้เลือกเพราะเป็นแถวที่สูงสุด**

**ถ้าจะย้อนกลับ:** `/experiments` → restore snapshot `trail 0.5/0.25 + risk floor 0.30`
(หรือ `Origin Parameter`) ทั้งคู่ยังเก็บ `rewardRatio: 2` ไว้ครบ ไม่ต้องประกอบค่าเองใหม่

**ยืนยันหลังปรับ** (การทดลอง `after adopting reward 3` บน 199 ไม้ — ไม้ชุดเดียวกัน
SL เท่ากันหมดที่ 79 อัตราชนะเท่ากันหมดที่ 57.3% เหมือนเดิมทุกประการ):

| variant | ไม้ | R รวม | R/ไม้ | TP | trail |
|---|---|---|---|---|---|
| `reward 2` (ค่าเดิม) | 199 | +50.99 | 0.256 | 38 | 76 |
| **baseline = 3.0 (ใช้อยู่)** | 199 | **+76.59** | **0.385** | 22 | 92 |
| `reward 4` | 199 | +87.47 | 0.440 | 11 | 103 |

`reward 2` กลายเป็นตัวที่**แย่กว่า** baseline แล้ว — กลับด้านกับตารางข้างบนพอดี
ซึ่งเป็นหลักฐานว่าค่าใหม่ติดจริงทั้งใน `rules.params` และในเส้นทางที่ ingest ใช้

และ `reward 4` ก็ยัง**สูงกว่า** อยู่ ตรงกับที่บอกไว้ว่าเส้นไม่มีจุดกลับตัว — นั่นคือเหตุผล
ที่หยุดที่ 3.0 ไม่ใช่เพราะเส้นบอกให้หยุด (ข้อห้าม #14)

**อะไรจะเป็นตัวบอกว่าผิด:** `nightly-standing-experiment` เปลี่ยน variants เป็น
`reward 2 / 2.5 / 4` แล้ว — ตัว `reward 2` คือค่าที่เพิ่งถอยจากมา ถ้ามันกลับมาชนะ baseline
เมื่อข้อมูลโตขึ้น จะเห็นในการรันประจำคืน ไม่ต้องมีใครนึกได้เอง
และเมื่อมีไม้ที่ยิงด้วย 3.0 ครบ 30 ไม้ บน 2 สินทรัพย์ `settings_effect` จะเทียบให้ (ข้อ 5.9)

### 5.7 `minVolumeRatio` — วัดแล้ว ไม่ต้องขยับ

การทดลอง `liquidity gate sweep` กวาด 0.8 → 2.0 ผล R รวมสูงขึ้นเมื่อ**ลด**ค่า แต่นั่นเป็นเพราะ
มันปล่อยให้เทรดถี่ขึ้น ไม่ใช่เทรดดีขึ้น — ดูที่ R/ไม้ จะเห็นว่าแบนราบ:

| gate | ไม้ | R รวม | R/ไม้ |
|---|---|---|---|
| 0.8 | 209 | +55.86 | 0.267 |
| 1.0 | 189 | +54.22 | 0.287 |
| **1.2 (ใช้อยู่)** | 174 | +49.64 | **0.285** |
| 1.4 | 155 | +42.86 | 0.277 |
| 1.6 | 137 | +37.45 | 0.273 |
| 2.0 | 118 | +29.85 | 0.253 |

และรายตัวไม่เห็นตรงกัน: GC บอกว่า 1.2 คือยอด (0.579 แล้วตกทั้งสองข้าง) BTCUSDT บอก 1.0
ดีกว่านิดเดียวในระดับ noise ส่วน MNQ/NQ ไม้น้อยเกินจะพูด — **ไม่ขยับ**

บทเรียนที่ต้องจำ: **R รวมโกหกได้ ถ้าตัวแปรนั้นเปลี่ยนจำนวนไม้** ต้องดู R/ไม้ ควบเสมอ
หน้า `/experiments` จึงแสดงสองคอลัมน์คู่กันตลอด

### 5.8 MNQU6 ติดลบทุกการตั้งค่า

ในทุก variant ที่รันมา MNQU6 อยู่ระหว่าง −0.086 ถึง +0.019 R/ไม้ (46–56 ไม้) ขณะที่อีกสามตัว
บวกหมด นี่ไม่ใช่ปัญหาของ threshold ตัวใดตัวหนึ่ง — ปรับอะไรก็ยังติดลบ
ยังไม่ปิดอะไรเพราะ `setup_stability` ยังไม่ผ่าน (ดูข้อ 5.5 — MNQ มีเซสชันเดียว)
**ต้องเปิดชาร์ต MNQ ให้ได้อีก 2 เซสชันก่อนถึงจะตัดสินได้** ถ้ายังติดลบค่อยใช้ `rule_overrides`
ปิดเฉพาะ instrument นี้

### 5.9 ตรวจ trail กับของจริง — exit mix ขยับตามที่ทำนาย R ยังตอบไม่ได้

**ไม่ต้องจำคิวรีนี้อีกแล้ว — `select * from public.settings_effect;` (หรือดูบนหน้า `/stats`)**

หลัง migration 0014 (trail 1/0.5 → 0.5/0.25) เทียบไม้ที่ resolved แล้ว:

| | trail 1/0.5 (275 ไม้) | trail 0.5/0.25 (24 ไม้) |
|---|---|---|
| SL | 130 (47%) | 12 (50%) |
| TP | 51 (19%) | 1 (4%) |
| **trail** | 73 (27%) | **11 (46%)** |
| หมดเวลา | 21 (8%) | 0 (0%) |
| R รวม | +42.00 | **+0.27** |
| R/ไม้ | 0.153 | 0.011 |

**สิ่งที่ทำนายไว้เกิดขึ้นจริง:** สัดส่วน trail ขึ้นจาก 27% เป็น 46% TP ร่วงจาก 19% เหลือ 4%
และ timeout หายไปหมด ตรงกับที่จำลองไว้ (70 trail / 132 stop → 106 trail / 113 stop)

**แต่ R ยังตามไม่ทัน** — ยังไม่ถึงเกณฑ์ 30 ไม้ และ 24 ไม้นี้เป็น BTCUSDT ตัวเดียวช่วงกลางคืน
ไม่ใช่สองสินทรัพย์แบบที่การจำลองครอบคลุม **ยังไม่สรุปและยังไม่ถอย** (พลิกจาก −0.60 เป็น +0.27
ระหว่างวัน ซึ่งบอกได้แค่ว่ามันแกว่ง ไม่ได้บอกว่าดีขึ้น)

**ทำไมคิวรีเดิมใช้ไม่ได้แล้ว:** ของเดิมแบ่ง before/after ด้วย timestamp ที่ hardcode ไว้
(`2026-08-29 18:50`) ซึ่งใช้ได้ครั้งเดียว พอ migration 0019 ขยับ `rewardRatio` วันเดียวกัน
ไม้หลังจากนั้นจะต่างจากไม้ก่อนหน้า **สองอย่างพร้อมกัน** ยุค "after" จึงกลายเป็นของผสม

`settings_effect` แก้ด้วยการ**จัดกลุ่มตามค่าที่บันทึกไว้บนตัวไม้เอง**
(`reward_ticks`/`risk_ticks`, `trail_trigger_ticks`/`risk_ticks`, `trail_offset_ticks`/`risk_ticks`)
ซึ่งเขียนตอนยิงและไม่เคยถูกแก้ย้อนหลัง — เปลี่ยนค่าเมื่อไรก็แตกกลุ่มใหม่เอง กลุ่มเดิมไม่ถูกปน
หลักการเดียวกับ `signals.muted` ในข้อ 5.5 · view ให้ 275/24 ตรงกับคิวรีเดิมเป๊ะ โดยไม่ต้องรู้วันที่

คอลัมน์ `verdict` บอกเองว่ายังตอบไม่ได้: `need more trades` (< 30 ไม้) ·
`need more symbols` (สินทรัพย์เดียว) · `comparable` = เทียบได้แล้ว
คอลัมน์ `is_live` บอกว่ากลุ่มไหนคือค่าที่ใช้อยู่ตอนนี้ — **ตอนนี้ไม่มีกลุ่มไหน `is_live`
เพราะยังไม่มีไม้ไหนยิงที่ reward 3.0** กลุ่มที่สามจะโผล่เองเมื่อ BTCUSDT ยิงไม้ถัดไป

ถ้า R ยังติดลบเมื่อ `verdict` ขึ้น `comparable` ให้กดย้อนกลับที่ `/experiments`
(snapshot `trail 0.5/0.25 + risk floor 0.30`) — อย่าถอยจากไม้ชุดเดียวกลางคืนของ BTC อย่างเดียว

### 5.10 ข้อค้นพบเรื่อง reward ทำซ้ำได้บนข้อมูลใหม่

BTCUSDT กลับมาส่งแล้วเพิ่ม 92 แท่ง รันซ้ำ (การทดลอง `reward ratio on 92 more bars`)
บน **198 ไม้** แทน 174 ไม้เดิม — ทิศทางเหมือนเดิมทุกประการ:

| rewardRatio | ไม้ | R รวม | R/ไม้ |
|---|---|---|---|
| **2.0 (ใช้อยู่)** | 198 | +51.99 | **0.263** |
| 2.5 | 198 | +67.27 | 0.340 |
| 3.0 | 198 | +77.59 | 0.392 |
| 4.0 | 198 | +88.47 | 0.447 |

อัตราชนะยังนิ่งที่ 57.6% ทุกค่าเหมือนเดิม · `gate 1.0` ก็ยังเป็นเรื่องเดิม: 216 ไม้ +58.00R
ดูเหมือนดีกว่า แต่ R/ไม้ 0.269 เทียบ 0.263 คือเท่ากันในระดับ noise (ข้อ 5.7)

**นี่คือการทำซ้ำครั้งแรกบนข้อมูลที่โตขึ้น** ยังไม่ใช่เซสชันที่ 3 แต่เป็นสัญญาณว่าข้อ 5.6
ไม่ได้เกิดจากไม้ชุดเดียว


### 5.11 กวาด threshold ของกฎครบทุกตัว — รับมาแค่ตัวเดียว

ก่อนหน้านี้การทดลองทุกชุดแตะแต่ค่าระดับแผน (`rewardRatio`, trail, `minVolumeRatio`)
**ค่าที่ตัดสินว่าสัญญาณไหนจะเกิด ไม่เคยถูกวัดเลยสักตัว** — 6 การทดลองปิดช่องนี้แล้ว

**ทำไมด่านต้องสูงกว่าเดิม:** `rewardRatio`/trail ให้คะแนน**ไม้ชุดเดิม**ใหม่ ทุก variant จึงเดินบน
ไม้ชุดเดียวกันเป๊ะ ส่วน threshold ของกฎ**เปลี่ยนว่าไม้ไหนเกิด** จำนวนไม้ขยับทุก variant
→ **R รวมอ่านไม่ได้เลย** variant หนึ่งทำ R รวมสูงขึ้นได้ด้วยการเทรดถี่ขึ้นเฉย ๆ
ทุกตัวเลขข้างล่างจึงอ่านที่ **R/ไม้** (baseline = 212 ไม้ · 0.375 R/ไม้)

#### รับมาใช้: `minDeltaMagnitude` 100 → 200

| minDelta | ไม้ | **R/ไม้** | R รวม |
|---|---|---|---|
| 50 | 220 | 0.368 | +81.05 |
| **100 (เดิม)** | 212 | 0.375 | +79.47 |
| 150 | 211 | 0.381 | +80.47 |
| 175 | 211 | 0.381 | +80.47 |
| **200 (ใช้อยู่)** | 210 | **0.388** | +81.46 |
| 225 | 210 | 0.388 | +81.46 |
| 250 | 210 | 0.388 | +81.46 |
| 300 | 207 | 0.379 | +78.55 |

**นี่คือชุดเดียวที่เส้นมี "ยอด" จริง ๆ** — ขึ้นไปแบนที่ 200–250 แล้วตกที่ 300
ที่ราบดีกว่ายอดแหลม เพราะเพื่อนบ้านไม่ได้แค่ไปทางเดียวกัน แต่**เท่ากันเป๊ะ**

รายสินทรัพย์ ไม่มีตัวไหนแย่ลง: BTCUSDT 0.460 → 0.471 · GC 0.597 → **0.691** ·
MNQU6 −0.008 → −0.008 (ไม่ขยับ) · NQU6 0.547 → 0.547 (ไม่ขยับ)

เลือก 200 ไม่ใช่ 225/250 เพราะสามค่านี้ได้คะแนนเท่ากัน จึงเอา**ตัวที่กรองน้อยที่สุด** —
ตัวกรองไม่ควรทิ้งไม้มากกว่าที่หลักฐานเรียกร้อง (เหตุผลเดียวกับที่เลือก 0.30 ในข้อ 5.4)

ยืนยันย้อนทางแล้ว (`after adopting minDelta 200`): baseline 0.388 · `minDelta 100` 0.375 ·
`minDelta 300` 0.379 — ทั้งสองข้างต่ำกว่า

#### วัดแล้ว ถูกอยู่แล้ว ไม่ขยับ

เพื่อนบ้านแย่ลงทั้งสองข้าง:

| ค่า | เส้น (R/ไม้) |
|---|---|
| `absorption.volumeMultiple` = 3 | 2 → 0.344 · **3 → 0.375** · 4 → 0.327 · 5 → 0.327 |
| `absorption.edgeTicks` = 2 | 1 → 0.331 · **2 → 0.375** · 3 → 0.345 |
| `bufferTicks` = 2 | 0 → 0.278 · 1 → 0.376 · **2 → 0.375** · 3 → 0.363 · 4 → 0.397 |
| `stacked_imbalance.ratio` = 3 | 2 → 0.386 · 2.5 → 0.400 · **3 → 0.375** · 4 → 0.377 · 5 → 0.404 |

สองตัวล่างมีแถวที่คะแนนสูงกว่า แต่**เพื่อนบ้านของแถวนั้นต่ำกว่า** → เป็นการ fit ข้อมูล ไม่ใช่การค้นพบ (ข้อห้าม #9)

#### ค่าที่ไม่มีผลอะไรเลย

**เปลี่ยนแล้วผลออกมาเหมือน baseline ทุกตัวเลข ไม่ขยับแม้แต่ไม้เดียว:**

- `poc_shift.minTicks` ตั้งแต่ 4 ถึง 12
- `poc_shift.hvnShare` ตั้งแต่ 0.15 ถึง 0.35
- `delta_divergence.lookback` ที่ 8 และ 10

`minTicks` ยืนยันสิ่งที่ข้อ 5.3 สงสัยไว้จากอีกทาง: POC ขยับระหว่างแท่งข้างเคียง**มัธยฐาน 45 ticks**
เกณฑ์ระดับเลขหลักเดียวจึงอยู่ใต้ noise และไม่ได้กรองอะไร **อย่าเสียเวลาจูนสามตัวนี้อีก**

#### ดีแต่ไม่รับ — และเข้าไปอยู่ใน standing sweep แทน

| ค่า | ผล | ทำไมไม่รับ |
|---|---|---|
| `absorption.rejectionTicks` 0 | 242 ไม้ · **0.473** · +114.51R | **ดีที่สุดที่วัดได้ทั้งแคมเปญ แต่เส้นไม่กลับตัว** 4→3→2→1→0.5→0 ดีขึ้นทุกก้าว และ 0 คือพื้น · 0 แปลว่า "ไม่ต้องมีการปฏิเสธราคาเลย" = คนละกฎ ไม่ใช่กฎเดิมที่หลวมลง · และผลทั้งหมดมาจาก BTCUSDT ตัวเดียว อีก 3 ตัวไม่ขยับ (ข้อห้าม #14) |
| `poc_shift.consecutive` 2 | 301 ไม้ · **0.404** · +121.58R | **เส้นกลับตัวจริง** (1 → 0.360 · 2 → 0.404 · 3 → 0.375 · 4 → 0.356) แต่ตกด่านรายสินทรัพย์: GC 0.597 → 0.474 และ NQU6 0.547 → 0.429 **แย่ลงทั้งคู่** ขณะที่ BTC/MNQ ดีขึ้น · R รวมบอก +42R แต่ 2 ใน 4 สินทรัพย์บอกตรงข้าม |
| `stack` 5 (0.407) · `minVolume` 40 (0.404) | ดีขึ้นเรื่อย ๆ | ไม่มีจุดกลับตัว และไม้ลดลงทุกก้าว (249→212→194→190) = ตัวกรองรัดเข้าหากลุ่มตัวอย่างที่เล็กลง ไม่ใช่เกณฑ์ที่หาที่ยืนเจอ |
| `minRiskRangeShare` 0.6 (0.408) | ดูดีที่สุดในภาพรวม | **ปิดงานค้าง 7.2 D: อยู่ที่ 0.30 ถูกแล้ว** ข้อ 5.4 เคยธงไว้ว่า 0.55–0.65 ได้คะแนนสูงกว่าและให้วัดซ้ำเมื่อมีข้อมูลมากขึ้น วัดแล้วได้คำตอบเดิม — **กำไรไม่ได้แบ่งกัน** GC ตก 0.597 → 0.494 ขณะที่ MNQU6 ขึ้น (คราวก่อนคนที่จ่ายคือ BTCUSDT) ตัวที่ออกเงินให้เปลี่ยนไปเรื่อย ๆ แปลว่าไม่ใช่ผลจริง |

`consecutive 2` คือตัวที่ใกล้ผ่านที่สุด และเป็นอย่างแรกที่ควรกลับมาดูเมื่อชาร์ต futures เดินครบหลายเซสชัน

⚠️ **ข้อจำกัดที่ต้องอ่านควบทุกตาราง (สภาพ ณ ตอนวัด 30–31 ส.ค.; ตลาดเปิดภายหลังในวันนั้น):** MNQ/NQ/GC ตลาดปิด แท่งค้างที่ 28 ส.ค.
ฝั่ง futures จึงมีไม้น้อย (GC 18 · NQU6 12) ด่าน "ทุก instrument ดีขึ้น" จึงตัดสินจากตัวอย่างบาง
ทั้งฝั่งที่ผ่านและฝั่งที่ตก



### 5.12 เพิ่มสามอย่างที่กันการหลอกตัวเอง — และ forward test ให้ผลทันที

**เดิมทุกตัวเลขในระบบเป็น total R กับ R/ไม้** ซึ่งบอกแค่ปลายทาง ไม่บอกเส้นทางเลย
และไม่มีคอลัมน์ drawdown อยู่ที่ไหนในฐานข้อมูลสักตัว

| เพิ่มอะไร | แก้ช่องว่างอะไร |
|---|---|
| `max_drawdown_r` + `worst_losing_streak` ใน `experiment_results` | ค่าสองชุดที่ R/ไม้ เท่ากันอาจต้องทนหลุมลึกไม่เท่ากัน หลุมที่ลึกกว่าคือตัวที่คนเลิกใช้ก่อนได้กำไร · โดน SL ~47% ความเสี่ยงนี้ไม่ไกลตัว |
| `experiment_readout` (verdict < 30 ไม้) | ด่าน 30 ไม้มีอยู่ทุกที่**ยกเว้นฝั่งที่ใช้ตัดสินจริง** |
| `forward_test` | ทุกการกวาดเลือกค่าจากแท่งที่ใช้เลือกเอง — view นี้นับเฉพาะไม้ที่ยิง**หลัง**ค่านั้นถูกใช้ |

**ตัวเลขที่ควรรู้:** จาก 1,325 แถวใน `experiment_results` มี **629 แถว (47%) ต่ำกว่า 30 ไม้** —
เกือบครึ่งของทุกอย่างที่การทดลองเคยรายงาน อ่านไม่ได้ตามมาตรฐานของระบบเอง และไม่เคยมีอะไรกำกับไว้

**ยอมรับตรง ๆ:** ตอนรับ `minDelta 200` (0021) ด่าน "ไม่มีสินทรัพย์ไหนแย่ลง" พิงอยู่บน GC 17 ไม้
และ NQU6 12 ไม้ — ต่ำกว่าเกณฑ์ที่ระบบบังคับใช้ ยอดรวม 210 ไม้ผ่าน แต่เซลล์ที่ตัดสินจริงไม่ผ่าน

#### ⚠️ forward test พูดทันทีที่เปิดใช้ และตัวเลขไม่สวย

| ตั้งค่า | ไม้ | สินทรัพย์ | R รวม | R/ไม้ | ขาดทุนลึกสุด | สรุปได้ไหม |
|---|---|---|---|---|---|---|
| TP 2R · trail 1/0.5 | 275 | 4 | +42.00 | 0.153 | −15.04R | เทียบได้แล้ว |
| TP 2R · trail 0.5/0.25 | 24 | 1 | +0.27 | 0.011 | −3.13R | ขาดไม้ |
| **TP 3R · trail 0.5/0.25 (ใช้อยู่)** | 32 | 1 | +2.77 | **0.087** | **−6.31R** | ขาดสินทรัพย์ |

**backtest บอกว่า reward 3.0 จะให้ 0.385 R/ไม้ · ของจริงบน 32 ไม้แรกได้ 0.087** — ไม่ถึงหนึ่งในสี่
และขาดทุนลึกสุด 6.31R มากกว่ากำไรสะสม 2.77R กว่าเท่าตัว

**ยังไม่ใช่หลักฐานว่ารับค่าผิด** — 32 ไม้ · สินทรัพย์เดียว · เซสชันเดียว ยังไม่ผ่านด่าน
และเทียบกับชุดที่มันแทนที่ (TP 2R บน trail เดียวกัน = 0.011 R/ไม้ บน 24 ไม้) ก็ยัง**ดีกว่า**
แต่นี่คือตัวเลขที่เมื่อวานไม่มีใครมองเห็น ตอนนี้มันอยู่บนหน้า `/stats` และจะโตขึ้นเอง

**ทำไมไม่แบ่ง train/test:** ข้อมูลมี ~2.5 วัน และ 3 ใน 4 ชาร์ตแท่งค้างตั้งแต่ 28 ส.ค.
แบ่งแล้วได้สองครึ่งที่อ่านไม่ได้ทั้งคู่ พร้อม "ความเข้มงวดปลอม" ซึ่งแย่กว่าปัญหาที่มันอ้างว่าแก้
forward test เป็นรูปที่ใช้ได้จริงวันนี้และแข็งขึ้นเองเมื่อแท่งเข้ามา

### 5.13 pullback entry — วัดครบแล้ว **ผลคือไม่รับ** และเหตุผลที่ไม่รับคือคอลัมน์ที่เพิ่งสร้าง

เพิ่ม `pullbackShare` ใน `plan.ts` (0 = ปิด, ค่าเริ่มต้น) — เข้าที่ราคาย่อกลับมาแทนที่จะเข้าที่ราคาปิด
คิดเป็นสัดส่วนของระยะจากราคาปิดถึงปลายแท่ง จึงสเกลตามแท่ง ไม่ใช่จำนวน tick คงที่ที่แปลว่าคนละเรื่องในแต่ละ instrument

**กับดักที่ต้องนับ:** ไม้ที่ราคาไม่ย่อกลับมา = **ไม่ได้เข้าเลย** และไม้พวกนั้นมักเป็นไม้ที่จะกำไร
ถ้านับแต่ไม้ที่เข้าได้ ค่าที่แย่กว่าจะดูดีกว่า → `simulate()` คืน `{ trades, missed }`,
`fillIndex()` เช็กว่าราคาแตะจริงในกี่แท่ง (`pullbackWithinBars`), migration 0025 เก็บลง
`experiment_results.missed_fills` และ `experiment_readout` คำนวณ **`fill_rate`** ให้

**ผลจริง — `pullback entry sweep` (backtest v3, 1029 แท่ง, 4 instruments, 2026-08-30):**

| variant | ไม้ | ไม่ได้เข้า | fill_rate | R รวม | **R/ไม้** | drawdown | R/DD | แพ้ติดกัน |
|---|---|---|---|---|---|---|---|---|
| **baseline** (ปิด) | **234** | **0** | **1.000** | **83.84** | **0.358** | 9.59 | 8.74 | 5 |
| 0.50 | 126 | 108 | 0.539 | 48.14 | 0.382 | 5.03 | 9.57 | 5 |
| 0.50 รอ 3 แท่ง | 174 | 60 | 0.744 | 65.43 | 0.376 | 6.22 | 10.52 | 6 |
| 0.35 | 144 | 90 | 0.615 | 44.17 | 0.307 | 9.49 | 4.65 | 5 |
| 0.35 รอ 2 แท่ง | 163 | 71 | 0.697 | 43.88 | 0.269 | 9.65 | 4.55 | 5 |
| 0.25 รอ 3 แท่ง | 188 | 46 | 0.803 | 45.10 | 0.240 | 11.80 | 3.82 | 7 |
| 0.25 | 158 | 76 | 0.675 | 37.46 | 0.237 | 9.99 | 3.75 | 7 |
| 0.15 | 181 | 53 | 0.774 | 41.65 | 0.230 | 11.95 | 3.49 | 7 |
| 0.25 รอ 2 แท่ง | 178 | 56 | 0.761 | 38.42 | 0.216 | 9.81 | 3.92 | 6 |

**ไม่มี variant ไหนทำ R รวมได้ใกล้ baseline เลยสักตัว** ตัวที่ดีที่สุด (0.50 รอ 3) ได้ 65.43
น้อยกว่าการไม่ทำอะไรเลย 18.4 R บนแท่งชุดเดียวกัน

**และนี่คือกรณีตัวอย่างของกับดักที่ `fill_rate` ถูกสร้างมาดักพอดี:** `pullback 0.50` มี R/ไม้
**0.382 สูงกว่า baseline 0.358** — ถ้าดูคอลัมน์นั้นคอลัมน์เดียวจะรับมาใช้ทันที แต่มันได้ตัวเลขนั้นมา
จากการ **ไม่เข้า 108 จาก 234 สัญญาณ** (fill_rate 0.539) ไม้ที่หายไปคือไม้ที่วิ่งไปเลยไม่ย่อกลับมา
ซึ่งเป็นไม้ที่กำไร ผลคือ R รวมหล่นจาก 83.84 เหลือ 48.14 — **ได้เงินน้อยลง 43% แลกกับตัวเลขต่อไม้ที่สวยขึ้น 7%**

**ด่านทั้งห้าที่ตั้งไว้ก่อนกวาด — ตก 4 ผ่าน 1:**

1. ❌ **R/ไม้ ดีขึ้นโดยไม่ใช่เพราะเข้าน้อยลง** — ขึ้นเพราะเข้าน้อยลงล้วน ๆ ตามข้างบน
2. ❌ **เพื่อนบ้านเห็นด้วย** — 0.50 (0.382) กับเพื่อนบ้าน 0.35 (0.307) ห่างกันมาก และ 0.15/0.25
   แย่กว่า baseline ทั้งคู่ ไม่ใช่ที่ราบ
3. ❌ **ไม่มี instrument ไหนแย่ลง** — เทียบ baseline กับ 0.50 รอ 3:

   | symbol | baseline | 0.50 รอ 3 |
   |---|---|---|
   | BTCUSDT (ก้อนใหญ่สุด) | 159 ไม้ · 0.414 · **65.90R** | 120 ไม้ · 0.397 · **47.67R** |
   | NQU6 | 12 ไม้ · 0.547 · 6.56R | 9 ไม้ · **0.030** · 0.27R |
   | GC | 17 ไม้ · 0.691 · 11.74R | 12 ไม้ · 0.948 · 11.37R |
   | MNQU6 | 46 ไม้ · −0.008 · −0.36R | 33 ไม้ · 0.185 · 6.12R |

   ตัวที่แบก R เกือบทั้งหมด (BTCUSDT) แย่ลงทั้งต่อไม้และรวม · MNQU6 ดีขึ้นตัวเดียว บน 33 ไม้
4. ✅ **drawdown ไม่ลึกขึ้น** — ผ่านเฉพาะฝั่ง 0.50 (5.03 และ 6.22 เทียบ 9.59)
   แต่ฝั่ง 0.15 / 0.25 / 0.25 รอ 3 **ลึกกว่า** baseline (11.95 / 9.99 / 11.80) จึงไม่ใช่ผลที่สม่ำเสมอ
5. ❌ **เส้นต้องมีจุดกลับตัว** — R/ไม้ ไต่ขึ้นเรื่อย ๆ ตาม share ไม่หยุด (0.230 → 0.237 → 0.307 → 0.382)
   ตามข้อห้าม #14 นั่นแปลว่ากำลังถูก exploit ไม่ใช่ดีขึ้น และรอบนี้**เห็นกลไกชัด**: ยิ่ง share ลึก
   ยิ่งเข้าน้อย ยิ่งเหลือแต่ไม้ที่ย่อแล้วไปต่อ ถ้าดัน share ไป 0.9 ตัวเลขต่อไม้จะยิ่งสวยและเงินจะยิ่งหาย

**ข้อเดียวที่ควรจำไว้:** `0.50 รอ 3 แท่ง` มี **R ต่อ drawdown = 10.52 สูงกว่า baseline 8.74**
ถ้าวันหนึ่งข้อจำกัดจริงกลายเป็น drawdown (ไม่ใช่ R รวม) นี่คือช่องที่ควรกลับมาวัดซ้ำ
ตอนนี้ยังไม่ใช่ — และการแลก 18 R เพื่อความนิ่มเป็นการตัดสินใจของเจ้าของ ไม่ใช่ของโค้ด

**`pullbackShare` จึงยังเป็น 0 และ `pullbackWithinBars` ไม่ถูกใช้** โค้ดยังอยู่ทั้งหมดเพราะมัน
คือเครื่องมือวัด ไม่ใช่ฟีเจอร์ที่รอเปิด — และเพราะไม่รับมาใช้ ข้อห้าม #19 จึงยังไม่ต้องแก้อะไร
(ถ้าวันหนึ่งจะเปิดจริง ต้องแก้ `evaluate_pending_outcomes()` ให้รู้จักการ fill ก่อน — มันสมมติว่า
ทุกแผนได้เข้าที่แท่งสัญญาณ ไม้ที่ไม่เคยได้เข้าจะถูกให้คะแนนเหมือนเข้าแล้ว)

### 5.14 แนวรับต้าน — ไม่เพิ่มกฎใหม่ เพราะมีอยู่แล้วและมันบอกว่ายังไม่ถึงเวลา

`price_action.ts` คำนวณ `swingHigh`, `swingLow`, `structure`, `bos`, `choch`, `sweep`,
`zone` (premium/discount/equilibrium) และเก็บมาตลอด — **นั่นคือแนวรับต้านที่สร้างไว้แล้ว**
แค่ยังไม่เคยถูกใช้กรอง ตามหลัก "วัดก่อน แล้วค่อยกรอง"

`price_action_edge` วัดคำถามนี้อยู่ ตอบว่า **ยังอ่านไม่ได้** — เซลล์ใหญ่สุด 45 ไม้ / 2 เซสชัน
เขียนตัวใหม่ตอนนี้จะขัดข้อห้าม #4 และ #5 และซ้ำกับของที่มี


### 5.15 กฎ prop trading 3 ตัวแรก — เพิ่มแล้ว และตั้งใจให้เงียบ

**ทำอะไรไป:** เพิ่ม `delta_flip`, `lvn`, `naked_poc` (migration 0027) ทั้งสามอยู่ใน
`enabled = true, telegram_enabled = false` คือ **ยิงจริง เก็บจริง ให้คะแนนจริง แต่ไม่ส่งเข้ามือถือ**

**ทำไมสามตัวนี้ก่อน:** ลิสต์ prop trading ถูกจัดลำดับด้วยคำถามเดียว — ต่อยอด engine เดิม
ได้แค่ไหน สามตัวนี้คือกลุ่มที่ต่อยอดได้ **ทั้งหมด** ไม่มีข้อมูลใหม่ที่ต้องเก็บเลย

| กฎ | ใช้ engine เดิมตัวไหน | อ่านอะไรที่ยังไม่เคยอ่าน |
|---|---|---|
| `delta_flip` | delta รายแท่ง (จาก `delta_divergence`) + `bars.poc_price` (จาก `poc_shift`) | ไม่มี |
| `lvn` | volume profile ของแท่ง (จาก `poc_shift` / HVN) | ไม่มี — แค่หาแถวที่บางสุดแทนหนาสุด |
| `naked_poc` | `bars.poc_price` ที่เขียนมาตั้งแต่ migration 0001 | ไม่มี |

ผลคือ **ไม่ต้อง deploy indicator ใหม่ ไม่ต้องแก้ `ingest.ts` ไม่มี migration ที่เพิ่ม column**
มีแค่ไฟล์กฎ 3 ไฟล์ + registry + ข้อความ Telegram + migration ที่ insert 3 แถว

**แต่ละตัวจับอะไร:**

- **`delta_flip`** — โดนกดมา `runBars` แท่งติด (delta ลบทุกแท่ง) แล้วแท่งนี้ delta พลิกเป็นบวก
  อย่างน้อย `minDeltaMagnitude` **และการพลิกเกิดที่ราคาที่เคยมีของ** คือ POC ของแท่งเก่าที่อยู่
  ใกล้ low ของแท่งนี้ ระยะที่นับว่า "ใกล้" คือ `levelShare` ของ range แท่งนั้นเอง ไม่ใช่จำนวน tick
  — เหตุผลเดียวกับข้อ 5.4 และข้อห้าม #8
  **จุดสำคัญ:** delta สลับเครื่องหมายเฉย ๆ ไม่ใช่สัญญาณ มันเกิดทั้งวัน ตัวที่ทำให้มันมีความหมาย
  คือ *ที่ไหน* ไม่ใช่ *ว่ามันเกิด*
- **`lvn`** — หาแถวที่ volume บางที่สุดใน profile ของแท่ง (ต้องบางกว่า `maxShare` ของค่าเฉลี่ย)
  **และ** POC อยู่ฝั่งหนึ่งของรูนั้น ส่วนราคาปิดอยู่อีกฝั่ง = ตลาดทิ้งราคาที่ยอมรับ ข้ามช่องที่
  ไม่มีใครเทรด แล้วไปหยุดอีกที่ ปลายบน/ปลายล่างของแท่งถูกตัดทิ้งก่อนหา (`interiorShare`)
  เพราะ **แถวที่บางที่สุดของทุกแท่งคือปลายแท่งมันเอง** ซึ่งไม่ใช่รูใน profile
- **`naked_poc`** — POC ของแท่งเก่าที่ยังไม่มีแท่งไหนหลังจากนั้นวิ่งผ่านเลย แท่งแรกที่กลับไปแตะ
  คือแท่งแรกที่ระดับนั้นโดนวัด ทิศทางคือ fade: แตะจากล่าง = แนวต้าน → short / จากบน = long
  ถ้าแท่งเดียวแตะหลายอัน อันที่ **ไกลที่สุด** ชนะ เพราะนั่นคือระยะที่ตลาดดันไปจริง

**ขอบเขตที่ต้องพูดตรง ๆ:** `naked_poc` เป็น naked POC ของ **หน้าต่างประวัติที่กฎได้รับ**
(`HISTORY_BARS = 50` แท่ง ≈ 4 ชั่วโมงกว่าบน 5m) **ไม่ใช่ของราย session/รายวัน**
POC รายวันจริงต้องรวม volume ต่อ session ซึ่งคือตาราง profile ที่ระบบนี้ยังไม่มี — ดูข้อ 8.5
**และห้ามแก้ด้วยการดัน `HISTORY_BARS` ขึ้นเฉย ๆ**: `liquidity.ts` คิด median volume จาก
`ctx.history` **ทั้งก้อน** ฉะนั้นการขยายหน้าต่างจะขยับ volume gate ของกฎเดิมทั้ง 4 ตัวไปด้วย
= เปลี่ยน baseline เงียบ ๆ ซึ่งเป็นความผิดพลาดชนิดเดียวกับข้อ 3.13 และ 3.14

**ทำไมถึงเปิดกฎแต่ปิดเสียง — และทำไมนี่ไม่ใช่การฝืนข้อห้าม #4:**

ข้อห้าม #4 บอกว่าอย่าเพิ่มกฎใหม่ก่อนกฎเดิมพิสูจน์ตัวเอง และมันถูก — 4 กฎ × 2 ทิศทาง
ยังตัดสินไม่ได้เลยด้วยข้อมูลเท่านี้ **แต่กฎที่ปิดอยู่ไม่ผลิตหลักฐาน** มันจึงพิสูจน์ตัวเองไม่ได้
ตลอดกาล — "ต้องพิสูจน์ตัวเองก่อน" กับ "ห้ามยิง" เป็นเงื่อนไขที่ทำพร้อมกันไม่ได้

ทางที่ระบบนี้ใช้มาตลอดเมื่อเจอสถานการณ์แบบนี้คือ **วัดโดยไม่ลงมือ** — `price_action.ts`
เก็บ structure / sweep / zone ลงทุกสัญญาณมาหลายสัปดาห์และไม่กรองอะไรเลยสักอย่าง
สามตัวนี้อยู่ในสถานะเดียวกัน: ยิง → ลงตาราง → `evaluate_pending_outcomes()` ให้คะแนน
เหมือนกฎอื่น → `/stats` เทียบได้ → **แต่ไม่มีเสียงเข้ามือถือ**

ราคาของการคิดผิดเรื่องนี้คือ "คอลัมน์เพิ่มมาในตารางสถิติ" ไม่ใช่ "สัญญาณที่มีคนเอาไปเทรด"
ซึ่งเป็นฝั่งที่ควรจะผิด

**ค่า default มาจากไหน:** ทุกตัวที่ยืมได้จากของที่วัดแล้ว ยืมมาหมด — `minDeltaMagnitude 200`
คือค่าที่ migration 0021 รับมาให้ `delta_divergence` บนปริมาณเดียวกัน · `runBars 3`
คือ `poc_shift.consecutive 3` บนคำถามเดียวกัน (กี่แท่งที่เห็นตรงกันถึงเรียกว่าลำดับ ไม่ใช่ noise) ·
`lvn.maxShare 0.25` คือกระจกของ `poc_shift.hvnShare 0.25` จากอีกปลายของ profile เดียวกัน ·
`minRunDelta 0` คือ **ไม่ตั้ง threshold ที่ยังไม่ได้วัด** ที่เหลืออยู่ในหัว migration 0027 ครบ
ทั้งหมดแก้ได้ที่ `/rules` — และทั้งหมดยัง **ไม่เคยถูกกวาดค่า** เหมือนที่ข้อ 5.11 ทำกับกฎเดิม

**เทสต์:** 21 เคสใหม่ใน `rules_test.ts` (รวมทั้งหมด 124 ผ่าน) ครอบทั้งเคสที่ต้องยิงและเคสที่
**ต้องไม่ยิง** — run ที่ถูกแท่ง delta 0 ตัดขาด · รูที่อยู่ปลายแท่ง · POC ที่เคยถูก retest แล้ว ·
POC ที่ยังใหม่เกินไป

#### ตัวเลขชุดแรก (experiment `deploy check 0027` · 2026-08-31 · **อ่านเป็นสัญญาณชีพ ไม่ใช่ผลตัดสิน**)

รันด้วยตัวรันจริงบนบาร์ 400 แท่งล่าสุดต่อ instrument (BTCUSDT · GC · MNQU6 · NQU6,
ช่วง 28–31 ส.ค.) จุดประสงค์คือ**พิสูจน์ว่า evaluator ที่ deploy ไปทำงาน** ไม่ใช่เพื่อตัดสินกฎ

| กฎ | ทิศ | ไม้ | WR | R รวม | R/ไม้ | DD |
|---|---|---|---|---|---|---|
| `delta_flip` | long | 8 | 75.0% | +2.37 | 0.296 | 1.00 |
| `delta_flip` | short | 7 | 71.4% | +2.36 | 0.337 | 2.00 |
| `lvn` | long | 54 | 59.3% | +12.84 | 0.238 | 3.12 |
| `lvn` | short | 71 | 59.2% | +5.82 | 0.082 | 8.40 |
| `naked_poc` | long | 43 | 48.8% | +12.85 | 0.299 | 5.00 |
| `naked_poc` | short | 31 | 54.8% | +12.66 | 0.408 | 5.99 |

**ห้ามใช้ตารางนี้ตัดสินใจอะไรทั้งสิ้น** เหตุผลตรง ๆ: เป็นเซสชันเดียว · `delta_flip` มี 15 ไม้
ทั้งกฎซึ่งไม่พอแม้แต่จะดูว่าเอียงข้างไหน (ข้อห้าม #11 — ยังไม่ผ่าน `setup_stability`) ·
ยังไม่ได้แยกดูราย instrument ว่ามีตัวไหนแย่ลงไหม (ข้อห้าม #18) · และตัวเลขพวกนี้มาจาก
**บาร์ที่กฎไม่เคยเห็นตอนออกแบบก็จริง แต่คนออกแบบเห็น** — forward test ตามข้อ 5.12
คือตัวที่จะตอบจริง เมื่อสัญญาณสดเริ่มสะสม

สิ่งที่ตารางนี้**ตอบได้จริงข้อเดียว**: ทั้งสามกฎยิง ไม่พัง ไม่ยิงรัวจนน่าตกใจ และไม่เงียบสนิท
`lvn` ยิงถี่สุด (125 ไม้) ซึ่งเป็นตัวที่ต้องจับตาว่าจะกลายเป็น noise หรือเปล่า

**อีกอย่างที่ run นี้พิสูจน์:** variant `naked_poc minAge 10` ขยับ**เฉพาะแถวของ `naked_poc`**
(long 43→28 · short 31→15) ส่วนกฎเดิมทั้งสี่ตัวเลขนิ่งสนิททุกแถว — แปลว่า params ของกฎใหม่
ต่อสายถูกจริง และของเดิมไม่ถูกกระทบ

**เกิดขึ้นภายในไม่กี่ชั่วโมงหลังจากนี้:** เจ้าของสลับสวิตช์เองที่ `/rules` — `naked_poc` และ
`delta_flip` เปิดเสียง · `poc_shift` ปิด · `lvn` ปล่อยปิดไว้ **การปิดเสียงทำงานถูกต้องทุกตัว
ไม่มีบั๊ก** แต่ตัวเลขที่ควรอยู่ข้างสวิตช์ตอนนั้นยังไม่มีใครวางไว้ให้ดู — วางแล้วที่ข้อ **5.17**
(สองในสี่การตัดสินใจสวนทางกับตัวเลขที่บันทึกไว้ · หัวข้อนั้น**ไม่เปลี่ยนค่าอะไร**)

---

### 5.16 Speed of Tape — และคอลัมน์ที่เอกสารนี้เขียนผิดมาตลอด

**สรุปก่อน: กฎนี้ถูกสร้าง deploy และวัดแล้ว — และตัวเลขชุดแรก "ไม่ดี" ไม่ใช่ "ยังไม่รู้"**
มันเป็นกฎเดียวใน 8 ตัวที่มีฝั่งติดลบ และการขันเกลียวให้เข้มขึ้นทำให้ฝั่งนั้น **แย่ลง**
รายละเอียดอยู่ท้ายหัวข้อ อ่านให้จบก่อนคิดจะเปิดเสียง

#### สิ่งที่ต้องแก้ก่อน: `bars.trades` ตายมาตั้งแต่ migration 0001

ข้อ 8.5 แถวที่ 6 (ที่ผมเขียนเอง) บอกว่า `bars.trades` "มีอยู่แล้ว" **ผิด**
`bars.trades` เป็น **0 ทุกแถว ทั้ง 2,428 บาร์ ทุก instrument** — `Dto.cs` ประกาศ
`[JsonPropertyName("trades")] public int Trades` ไว้จริง แต่ `SignalBridgeIndicator.cs`
**ไม่เคยเซ็ตค่าให้มัน** มันเซ็ตแค่ `Volume` / `AskVolume` / `BidVolume` / `Ticks`
คอลัมน์นี้จึงว่างเปล่ามาตั้งแต่วันแรก

**แต่ข้อมูลมีอยู่ใต้ชื่ออื่น** — `bars.ticks` (รวมจาก `info.Ticks` ของทุก level ใน footprint)
มีค่าทุกบาร์ และพฤติกรรมมันคือจำนวนไม้เทรด:

| symbol | บาร์ | ที่เป็น 0 | ticks เฉลี่ย | สูงสุด | sd | volume ÷ ticks |
|---|---|---|---|---|---|---|
| BTCUSDT | 1028 | 0 | 3,253 | 37,966 | 4,861 | **0.036** |
| MNQU6 | 649 | 0 | 4,687 | 58,454 | 8,740 | **1.251** |
| GC | 459 | 0 | 902 | 23,854 | 1,962 | **1.112** |
| NQU6 | 296 | 0 | 2,205 | 16,525 | 3,131 | **1.085** |

`volume ÷ ticks` ออกมา ~1.1–1.25 สัญญาบน futures ทั้งสามตัว และ 0.036 BTC บน crypto
= **ขนาดเฉลี่ยของไม้เดียว** ถ้า `ticks` นับ "จำนวนครั้งที่ราคาเปลี่ยน" อัตราส่วนนี้จะสูงกว่านี้มาก
ให้ถือว่ามันคือจำนวนไม้ (ควรยืนยันกับเอกสาร ATAS สักครั้ง แต่ข้อมูลชัดพอจะสร้างต่อได้แล้ว)

ผลตามมา: Speed of Tape **ไม่ต้องแก้ indicator ไม่ต้อง build DLL ไม่ต้องขยับ REV** —
ตรงข้ามกับที่ข้อ 8.5 เขียนไว้ (แก้แล้วในแถวที่ 6) และ sd ≥ ค่าเฉลี่ยทุก instrument
คือความแปรปรวนที่กฎ "จับ spike" ต้องมีถึงจะมีอะไรให้จับ

**ของแถมจากคอลัมน์เดียวกัน:** `volume / ticks` = ขนาดไม้เฉลี่ยต่อบาร์ คำนวณได้วันนี้เลย
เป็น proxy ตัวแรกที่วัดได้ของ **ข้อ 4 (Large / Block Trades)** ซึ่ง 8.5 ก็เขียนว่าติด indicator
เหมือนกัน — **ไม่ใช่ตัวแทนของ size รายไม้** (บาร์ที่ไม้กลาง ๆ เท่ากันหมด กับบาร์ที่มีไม้ยักษ์ 1 ไม้
ปนไม้จิ๋วเป็นร้อย ให้ค่าเฉลี่ยเท่ากันได้) แต่มันคือหลักจับแรกของคำถามนั้น และเก็บฟรี

#### กฎทำอะไร

`speed_of_tape` ยิงเมื่อ `bar.ticks >= median(ticks ของ rateHistory บาร์ก่อนหน้า) × minRateRatio`
โดยยืมรูป median-of-history มาจาก `hasEnoughLiquidity` ใน `liquidity.ts` ตรง ๆ — คำถามเดียวกัน
คนละคอลัมน์ ทุกชาร์ตในระบบนี้เป็น 5m ฉะนั้น "ไม้ต่อบาร์" **คือ** "ไม้ต่อนาที" คูณค่าคงที่
จึงไม่หารด้วยระยะเวลาที่ context ไม่ได้พามาด้วย (ถ้าวันหนึ่งเพิ่ม tick/range timeframe
ข้อนี้จะไม่จริงอีกต่อไป — มีคอมเมนต์เตือนไว้ในไฟล์แล้ว)

**ทิศทางอ่านจากตำแหน่งที่ปิดในแท่งตัวเอง** บนสุด `edgeShare` = long · ล่างสุด = short ·
**กลางแท่ง = ไม่ยิง** เพราะความเร่งที่ไปไม่ถึงไหนไม่ใช่ทิศทาง และถ้าอ่านทิศจาก delta แทน
ก็จะกลายเป็นการยิงซ้ำสิ่งที่ `delta_divergence` กับ `delta_flip` ทำอยู่แล้ว

**บันทึกแต่ไม่กรอง:** `avgTradeSize` (`volume / ticks`) · median ของค่านั้นในหน้าต่างเดียวกัน ·
และอัตราส่วนของสองตัว = proxy ข้อ 4 เก็บแบบเดียวกับที่ `price_action.ts` เก็บ structure/sweep
เป๊ะ ๆ เพื่อให้คำถาม "การเร่งด้วยไม้ **ใหญ่** ต่างจากการเร่งด้วยไม้เล็กไหม" ตอบได้จาก
`signal_outcomes` ทีหลัง แทนที่จะเดาวันนี้

| param | ค่า | มาจากไหน |
|---|---|---|
| `rateHistory` | 10 | `liquidity.minVolumeHistory` — คำถาม median window เดียวกัน |
| `minRateRatio` | 2.0 | **ไม่ได้วัด** — จุดตั้งต้น และประกาศตรง ๆ ว่ายังไม่ได้วัด |
| `edgeShare` | 0.3 | **ไม่ได้วัด** |

seed ที่ `enabled = true, telegram_enabled = false` (migration 0028) ด้วยเหตุผลเดียวกับข้อ 5.15
**นี่ทำให้มีกฎที่เงียบอยู่ 4 ตัว** — ตรรกะเดิมยังใช้ได้ แต่กองกฎที่ยังพิสูจน์ไม่ได้คือสิ่งที่ต้องจับตาแล้ว
**อย่าเพิ่มตัวที่ 5 ก่อนตัดสินตัวใดตัวหนึ่งในสี่ตัวนี้**

**ไฟล์ที่แตะ:** `types.ts` (เพิ่ม `ticks` ใน `HistoryBar` — **ไม่ใช่** `trades`) · `ingest.ts`
(select + mapping + `asHistoryBar`) · `backtest.ts` (`history.push`) · helper ของเทสต์ 4 ไฟล์ ·
กฎใหม่ + registry + ข้อความ Telegram · migration 0028 (seed + คอมเมนต์กำกับว่า `bars.trades`
เป็นคอลัมน์ตาย และ `bars.ticks` คือจำนวนไม้) รวม **132 เทสต์ผ่าน** · deploy `ingest` v14 และ
`backtest` v5 ตามข้อ 7.4

#### ตัวเลขชุดแรก — และทำไมมันไม่ดี

experiment `deploy check 0028` (`fc06b7bc`) · 1000 บาร์/instrument · 28–31 ส.ค.

| กฎ | ทิศ | ไม้ | WR | R รวม | **R/ไม้** | DD |
|---|---|---|---|---|---|---|
| `naked_poc` | short | 78 | 64.1% | +65.84 | **0.844** | 6.95 |
| `naked_poc` | long | 97 | 58.8% | +68.76 | **0.709** | 7.05 |
| `absorption` | long | 86 | 60.5% | +53.52 | **0.622** | 5.73 |
| `absorption` | short | 80 | 58.8% | +48.66 | **0.608** | 6.16 |
| `delta_flip` | short | 12 | 75.0% | +6.26 | **0.522** | 2.00 |
| `delta_divergence` | long | 16 | 81.3% | +7.31 | **0.457** | 2.44 |
| `poc_shift` | long | 119 | 52.9% | +38.77 | **0.326** | 8.40 |
| `delta_divergence` | short | 19 | 68.4% | +5.15 | **0.271** | 2.04 |
| `delta_flip` | long | 12 | 66.7% | +2.13 | **0.178** | 1.00 |
| `stacked_imbalance` | long | 27 | 63.0% | +3.91 | **0.145** | 4.00 |
| `stacked_imbalance` | short | 24 | 62.5% | +3.34 | **0.139** | 5.00 |
| `poc_shift` | short | 113 | 49.6% | +12.81 | **0.113** | 11.69 |
| `lvn` | long | 112 | 57.1% | +9.63 | **0.086** | 10.78 |
| `lvn` | short | 160 | 55.6% | +11.13 | **0.070** | 12.45 |
| **`speed_of_tape`** | **short** | 123 | 55.3% | +8.04 | **0.065** | 10.17 |
| **`speed_of_tape`** | **long** | 121 | 47.9% | **−6.61** | **−0.055** | **15.48** |

**สามอย่างที่ตารางนี้บอก และไม่ควรอ่านให้อ่อนลงกว่านี้:**

1. `speed_of_tape` long เป็น **แถวเดียวใน 16 แถวที่ติดลบ** และ DD 15.48 คือสูงสุดของทั้งตาราง
2. **ขันเกลียวแล้วแย่ลง** — variant `minRateRatio` 3× ตัดไม้ลงจาก 121 → 66 แต่ R/ไม้
   ตกจาก −0.055 → **−0.142** ถ้าสัญญาณมีสัญญาณจริงปนอยู่ การเข้มขึ้นควรกรอง noise ออก
   แล้วทำให้ดีขึ้น การที่มันแย่ลงคือทิศทางตรงข้ามกับกฎที่กำลังจะพิสูจน์ตัวเองได้
   (ฝั่ง short ขยับขึ้นเล็กน้อย 0.065 → 0.092 บน 73 ไม้ ซึ่งไม่พอจะกลบข้อ 1)
3. เทียบขนาด: `naked_poc` long ทำ +68.76R บน 97 ไม้ในรันเดียวกัน — ไม่ใช่ว่าตลาดช่วงนี้แย่

**สิ่งที่ยังไม่รู้ และห้ามเติมเอง:** รันนี้เป็นเซสชันเดียว · `experiment_results` เก็บแถวราย
instrument เฉพาะ**ระดับรวม** (rule_key null) ฉะนั้น **ข้อห้าม #18 ยังตอบไม่ได้จากรันนี้**
ต้องรอสัญญาณสดสะสมแล้วดูที่ `setup_stats_by_instrument` · · **อัปเดต 2026-09-01: มีสัญญาณสดแล้ว**
`speed_of_tape` ยิง **15 สัญญาณ ประกาศ 0** หลัง feed กลับมา — การปิดเสียงพิสูจน์แล้ว
ด้วยสัญญาณจริง (ตอนเขียนครั้งแรกยังไม่มีสัญญาณเลย เช็กจึงผ่านแบบว่างเปล่า)
**แต่ยังไม่พอตัดสินกฎ** ต้องรอ `signal_outcomes` ให้คะแนนก่อน

**ท่าทีที่ควรเป็น:** ปล่อยให้มันเก็บข้อมูลต่อไปแบบเงียบ ๆ ตามที่ตั้งไว้ **แต่ตัวนี้เข้ามาโดยมีภาระ
ต้องพิสูจน์มากกว่าอีกสามตัว** ไม่ใช่เท่ากัน ถ้าสัญญาณสดยืนยันว่าฝั่ง long ติดลบ ทางที่ถูก
คือปิดฝั่งเดียวด้วย `rule_overrides` หรือปิดทั้งกฎ — **ไม่ใช่** ไล่ปรับ `minRateRatio` ไปเรื่อย ๆ
จนกว่าจะเจอค่าที่ตัวเลขสวย นั่นคือข้อห้าม #14 เป๊ะ ๆ

**อีกอย่างที่รันนี้พิสูจน์ (และเป็นเหตุผลหลักที่รัน):** กฎเดิมทั้ง **7 ตัว × 2 ทิศ เลขตรงกันทุกหลัก**
ระหว่าง baseline กับ variant — การเพิ่ม `ticks` เข้า `HistoryBar` ไม่ได้ขยับพฤติกรรมของอะไรเลย
ซึ่งเป็นความผิดพลาดชนิดเดียวกับข้อ 3.13 / 3.14 ที่การเช็กนี้มีไว้ดัก

---

### 5.17 สี่กฎที่ถูกสลับสวิตช์ในวันเดียว — วางตัวเลขไว้ข้างสวิตช์

**หัวข้อนี้ไม่เปลี่ยนค่าอะไรทั้งสิ้น** กฎไหนจะพูดเป็นสิทธิ์ของเจ้าของ สิ่งที่ขาดคือ
ตัวเลขที่ควรอยู่ตรงหน้าตอนกด — นี่คือการเอามาวางไว้ที่เดียว ไม่ใช่การขอให้กดกลับ

**เกิดอะไรขึ้น** — 2026-08-31 ระหว่าง 13:26–13:33 มีการสลับ `telegram_enabled` ที่ `/rules`:

| เวลา (UTC) | กฎ | เปลี่ยนเป็น |
|---|---|---|
| 13:26:39 | `poc_shift` | **ปิดเสียง** |
| 13:26:47 | `naked_poc` | **เปิดเสียง** |
| 13:32:50 | `lvn` | ปิดเสียง (ยืนยันค่าเดิม) |
| 13:32:54 | `delta_flip` | **เปิดเสียง** |

**การปิดเสียงทำงานถูกต้อง ไม่มีบั๊ก** — `lvn` ส่งข้อความสุดท้าย 13:32:30 เทียบกับ toggle
13:32:50 · `poc_shift` ส่งสุดท้าย 13:26:17 เทียบกับ 13:26:39 · จำนวนที่ประกาศ**หลัง** toggle
เป็น **0** ทั้งคู่ (เคยสงสัยเพราะ `announced > 0` แต่นั่นคือของเก่าก่อน toggle — ไม่ต้องไปแก้อะไร)

#### ตารางเทียบ — ทุกช่องบอกที่มา

**ฝั่งสด** = รวมจาก `setup_stability` (ไม้ที่จบแล้ว ให้คะแนนแล้ว) · **ฝั่ง backtest** =
experiment `deploy check 0028` variant baseline 1000 บาร์/instrument · **ความถี่** =
`signals` ตั้งแต่ 12:33 ถึง 22:50 (10.3 ชม. ตัด batch แรกที่ backfill ทิ้ง)

| กฎ | เสียง | ทิศ | สด: ไม้ | สด: R/ไม้ | สด: R รวม | BT: ไม้ | BT: R/ไม้ | BT: DD | สัญญาณ/ชม. | ประกาศสะสม |
|---|---|---|---|---|---|---|---|---|---|---|
| `naked_poc` | 🔊 เปิด | long | 49 | **0.913** | +44.74 | 97 | **0.709** | 7.05 | 9.3 | 43 |
| | | short | 58 | **0.958** | +55.56 | 78 | **0.844** | 6.95 | | |
| `delta_flip` | 🔊 เปิด | long | 5 | 0.070 | +0.35 | 12 | 0.178 | 1.00 | 1.0 | 8 |
| | | short | 7 | 0.537 | +3.76 | 12 | 0.522 | 2.00 | | |
| `poc_shift` | 🔇 ปิด | long | **177** | 0.149 | +26.30 | 119 | 0.326 | 8.40 | 11.7 | **112** |
| | | short | **170** | 0.080 | +13.52 | 113 | 0.113 | 11.69 | | |
| `lvn` | 🔇 ปิด | long | 62 | **−0.007** | −0.46 | 112 | 0.086 | 10.78 | **13.8** | 28 |
| | | short | 95 | **0.005** | +0.46 | 160 | 0.070 | **12.45** | | |

#### สองข้อที่ตัวเลขหนุน และสองข้อที่ตัวเลขค้าน

**หนุน — `lvn` ปิดถูกแล้ว:** ยิงถี่ที่สุดในระบบ (13.8/ชม. มากกว่า `poc_shift`) แต่ R/ไม้
ฝั่งสดอยู่ที่ **−0.007 และ 0.005** คือศูนย์ในทางปฏิบัติ บน 157 ไม้ที่จบแล้ว
พร้อม drawdown สูงสุดในกลุ่ม backtest (12.45) = จ่ายความเสี่ยงและจ่ายความรำคาญ
โดยไม่ได้อะไรกลับมา นี่คือรูปร่างของ noise ตรงตามที่ข้อ 5.15 เขียนไว้ว่าให้จับตา

**หนุน — `naked_poc` เปิดมีเหตุผล:** R/ไม้ สูงสุดของทั้งตาราง ทั้งฝั่งสดและ backtest
ทั้งสองทิศ และไม่มีเซสชันไหนติดลบฝั่ง long (`sessions_up 4 / down 0`)
**แต่ต้องรู้ด้วยว่าเปิดบนอะไร:** ทุกเซลล์ของมันยัง verdict = `need more trades` /
`need more sessions` ไม่มีเซลล์ไหนถึง `proposable` เลย และ R ส่วนใหญ่มาจาก BTCUSDT
ตัวเดียว (long +37.38 จาก +44.74 · short +36.40 จาก +55.56) บน **เซสชันเดียว**
ถ้าตัว BTC ออก ที่เหลือคือ +7.36 บน 25 ไม้ และ +19.16 บน 27 ไม้ ยังบวก แต่คนละสเกล

**ค้าน — `delta_flip` มีประวัติบางที่สุดในระบบ แต่เปิดเสียง:** 12 ไม้สด · 24 ไม้ backtest
(12 ต่อทิศ) · **0 เซลล์ที่ `setup_stability` บอกว่าอ่านได้** และเซลล์ BTCUSDT long คือ
1 ไม้ −1.00 ที่ view เสนอ `mute` เอง ฝั่ง short ดูดี (0.537/0.522 ตรงกันทั้งสดและ backtest)
แต่มาจาก MNQU6 เซสชันเดียว 7 ไม้ **นี่ไม่ใช่ว่ากฎแย่ — คือยังไม่มีข้อมูลจะบอกว่าดีหรือแย่**
และมันคือสถานการณ์ที่ข้อห้าม #11 เขียนไว้เป๊ะ ๆ

**ค้าน — `poc_shift` เป็นกฎเดียวที่มีข้อมูลพอจะตัดสินราย instrument แต่ถูกปิดทั้งกฎ:**
มัน 347 ไม้สด 112 ประกาศ และเป็นกฎเดียวที่มีเซลล์ verdict `proposable` (4 เซลล์)
`setup_stability.proposal` เขียนคำตอบไว้แล้ว และคำตอบนั้น**ไม่ใช่ "ปิดทั้งกฎ"**:

| symbol | ทิศ | ไม้ | เซสชัน ขึ้น/ลง | R รวม | verdict | proposal ของ view |
|---|---|---|---|---|---|---|
| MNQU6 | short | 59 | 0 / **3** | **−17.77** | `proposable` | **mute** |
| BTCUSDT | long | 71 | 1 / 2 | **−5.29** | `proposable` | **mute** |
| BTCUSDT | short | 54 | **3** / 0 | +20.48 | `proposable` | keep |
| MNQU6 | long | 66 | 2 / 1 | +11.56 | `proposable` | keep |
| GC | short | 36 | 2 / 0 | +13.54 | need more sessions | keep |
| GC | long | 28 | 2 / 0 | +13.05 | need more trades | keep |
| NQU6 | long | 12 | 1 / 1 | +6.98 | need more trades | keep |
| NQU6 | short | 21 | 1 / 1 | −2.73 | need more trades | mute |

ตัวที่ทำให้ `poc_shift` ดูแย่คือ **MNQU6 short** (ลบ 3 เซสชันติด ไม่ใช่เซสชันเดียวโชคร้าย)
กับ **BTCUSDT long** ส่วน BTCUSDT short ขึ้นทั้ง 3 เซสชัน และ GC บวกทั้งสองทิศ
การปิดทั้งกฎจึงทิ้งเซลล์ที่ยืนยันตัวเองแล้วไปพร้อมกับเซลล์ที่ควรทิ้ง — ซึ่งเป็นเคสตรงตัวของ
**ข้อห้าม #18** และของ `rule_overrides` (ข้อ 5.5) ที่มีไว้เพื่อเรื่องนี้โดยเฉพาะ

#### ข้อควรระวังในการอ่านตารางนี้เอง

- **ฝั่งสดของกฎใหม่ทั้งสามมาจากเซสชันเดียว** (ยิงครั้งแรก 12:32 วันนี้) ส่วน `poc_shift`
  สะสมมา 3 เซสชัน ตัวเลขสองฝั่งนี้จึงไม่ได้อยู่บนฐานเวลาเดียวกัน
- **ไม่มีเซลล์ของกฎใหม่ตัวไหนผ่าน `setup_stability` เลยสักเซลล์** ทุกตัวเลขฝั่งสดของ
  `naked_poc` / `delta_flip` / `lvn` จึงเป็น "ยังอ่านไม่ได้" ตามนิยามของ view เอง —
  ที่ยกมาเพราะมันคือทั้งหมดที่มี ไม่ใช่เพราะมันพอ
- **`speed_of_tape` ไม่อยู่ในตารางนี้** เพราะยังไม่มีสัญญาณสดสักตัว (ข้อ 5.16)

#### สิ่งที่ควรทำต่อ (เป็นข้อเสนอ ไม่ใช่การเปลี่ยนค่า)

1. **`poc_shift`** — แทนที่จะปิดทั้งกฎ ใช้ `rule_overrides` ปิดเฉพาะ MNQU6 short และ
   BTCUSDT long แล้วเปิดเสียงที่เหลือ นั่นคือสิ่งที่ `setup_stability.proposal` บอกอยู่แล้ว
2. **`delta_flip`** — ถ้าจะให้เปิดต่อ ให้ยอมรับตรง ๆ ว่ากำลังเปิดสิ่งที่ยังไม่มีข้อมูล
   ทางที่ตรงกับกติกาเดิมกว่าคือปิดกลับจนกว่าจะมีสัก 30 ไม้ต่อทิศ
3. **`naked_poc`** — ปล่อยเปิดไว้ได้ แต่ต้องดูซ้ำเมื่อ CME/COMEX เปิด ว่ามันเก่งจริง
   หรือแค่เก่งกับ BTCUSDT ในวันที่ BTC วิ่ง
4. **`lvn`** — ปิดไว้ถูกแล้ว ถ้าจะรื้อ ให้ไปขันที่ `maxShare` / `minLevels` ก่อน
   ไม่ใช่เปิดเสียงตามเดิม

---

### 5.18 กวาดค่ากฎใหม่ครบแล้ว — **ไม่รับอะไรเลย** และหนึ่งกฎควรถูกปิดครึ่งหนึ่ง

ตามแผนข้อ 8.6 · กวาด `lvn` · `naked_poc` · `speed_of_tape` (ไม่กวาด `delta_flip` — 24 ไม้
น้อยเกินไป เหตุผลอยู่ใน 8.6) · **ไม่มีการเปลี่ยนค่าใด ๆ จากหัวข้อนี้**

⚠️ **อ่านตารางทั้งหมดโดยรู้ข้อนี้ก่อน:** การกวาด threshold **เปลี่ยนว่าไม้ไหนเกิด** จำนวนไม้
จึงขยับทุก variant → **R รวมอ่านไม่ได้** ทุกตัวเลขข้างล่างอ่านที่ **R/ไม้** (ข้อห้าม #13)
และรันที่ 1000 แท่งกับ 600 แท่งเป็นคนละกลุ่มตัวอย่าง **ห้ามเทียบตัวเลขข้ามกลุ่ม** —
แต่ละรันมี baseline ของตัวเอง ให้เทียบภายในรันเท่านั้น (เหตุผลของ 600 แท่งอยู่ในข้อ 3.11)

#### `lvn` — ไม่รับ และการกวาดยิ่งตอกย้ำว่ามันอ่อน

`maxShare` (ใช้อยู่ 0.25 · 1000 แท่ง) — R/ไม้:

| maxShare | long | short |
|---|---|---|
| 0.15 | 0.059 | 0.062 |
| 0.20 | 0.070 | 0.043 |
| **0.25 (ใช้อยู่)** | **0.089** | **0.048** |
| 0.35 | 0.111 | 0.071 |
| 0.45 | 0.118 | 0.067 |
| 0.55 | **0.143** | 0.069 |

ฝั่ง long ขึ้นเรื่อย ๆ จนสุดขอบที่วัด **ไม่มีจุดกลับตัว** (ข้อห้าม #14) และมีปัญหาที่หนักกว่านั้น:
`maxShare 0.55` แปลว่า "แถวที่บางที่สุดหนาได้ถึง 55% ของค่าเฉลี่ย" ซึ่ง**ไม่ใช่รูใน profile อีกต่อไป**
— รูปแบบเดียวกับ `absorption.rejectionTicks 0` ในข้อ 5.11: ค่าที่ดีที่สุดคือค่าที่ทำให้กฎเลิกเป็นกฎนั้น

**และด่านราย instrument ตกชัด ๆ** (ตรวจได้เป็นครั้งแรกเพราะแถวใหม่จากข้อ 8.6):

| symbol | ทิศ | baseline | 0.55 | ไม้ |
|---|---|---|---|---|
| BTCUSDT | long | −0.019 | **−0.019** | 56 → **56** |
| BTCUSDT | short | 0.066 | **0.066** | 108 → **108** |
| GC | long | 0.098 | 0.208 | 28 → 31 |
| MNQU6 | long | 0.249 | 0.277 | 23 → 36 |
| NQU6 | short | −0.203 | **−0.253** | 15 → 16 |

**BTCUSDT ไม่ขยับแม้แต่ไม้เดียว** ทั้งที่มันคือ 164 จาก 271 ไม้ — กำไรทั้งหมดมาจาก futures
บนตัวอย่างหลักสิบ และ **NQU6 short แย่ลง** = ตกข้อห้าม #18 ตรง ๆ **ไม่รับ**

`interiorShare` (ใช้อยู่ 0.8): 0.6 → long 0.072 / short 0.102 · 0.7 → **0.120** / 0.047 ·
**0.8 → 0.089 / 0.048** · 0.9 → 0.043 / **0.071**
**สองทิศชี้คนละค่า** long ดีสุดที่ 0.7 short ดีสุดที่ 0.6 เพื่อนบ้านไม่เห็นด้วยกันเอง = fit ข้อมูล (#9)

`minLevels` 8 → 12: **ตัวเลขเหมือน baseline ทุกหลัก ไม่ขยับแม้แต่ไม้เดียว**
เหมือน `poc_shift.minTicks` ในข้อ 5.11 — **อย่าเสียเวลาจูนอีก**

#### `naked_poc` — ไม่รับ แต่เป็นข่าวดี: ค่าที่ใช้อยู่ถูกแล้วทั้งสองตัว

`minAgeBars` (ใช้อยู่ 5 · 1000 แท่ง) — R/ไม้:

| minAgeBars | long | short | ไม้ (L+S) |
|---|---|---|---|
| 2 | 0.618 | 0.799 | 365 |
| 3 | 0.563 | 0.794 | 269 |
| **5 (ใช้อยู่)** | **0.690** | **0.855** | 186 |
| 10 | 0.395 | 0.832 | 114 |

**เป็นยอดจริงทั้งสองทิศ** เพื่อนบ้านต่ำกว่าทั้งซ้ายและขวา — นี่คือรูปทรงที่ข้อ 5.11 เรียกว่า
"เจอจุดกลับตัว" และมันชี้มาที่**ค่าที่ใช้อยู่แล้ว** = วัดแล้ว ถูกแล้ว ไม่ต้องขยับ

**ข้อยกเว้นที่ต้องพูดตรง ๆ:** `minAgeBars 2` ให้ **R รวม 258.5** เทียบกับ baseline **142.4**
บนไม้ที่เกือบสองเท่า โดย R/ไม้ ตกแค่เล็กน้อย (0.690→0.618 · 0.855→0.799) ข้อห้าม #13
บอกให้อ่าน R/ไม้ ซึ่งชี้ว่าอย่าขยับ **แต่ถ้าเป้าหมายคือ R รวมต่อเซสชัน ไม่ใช่คุณภาพต่อไม้
นี่คือทางเลือกจริงที่เจ้าของควรได้เห็น** ผมไม่กด เพราะกติกาที่ตกลงกันไว้คือ R/ไม้

`lookbackBars` (ใช้อยู่ 40 · 600 แท่ง) — R/ไม้:

| lookbackBars | long | short | ไม้ long |
|---|---|---|---|
| 10 | **1.077** | 1.089 | 40 |
| 15 | 1.036 | 1.028 | 58 |
| 20 | 0.964 | 1.056 | 65 |
| **40 (ใช้อยู่)** | **0.828** | 1.020 | 75 |

ฝั่ง long ขึ้นเรื่อย ๆ จนถึงค่าต่ำสุดที่วัด **ไม่มีจุดกลับตัว** และ **R รวมตกจาก 62.12 → 43.06**
คือซื้อคุณภาพต่อไม้ด้วยการทิ้งไม้ไปหนึ่งในสาม ฝั่ง short แบนสนิท (1.020–1.089) ไม่มีสัญญาณ
รูปแบบเดียวกับ `stack 5` / `minVolume 40` ในข้อ 5.11 — **ไม่รับ**

#### `speed_of_tape` — **ฝั่ง long ติดลบทุกค่าที่วัด ครบ 9 ค่า**

`minRateRatio` (ใช้อยู่ 2.0 · 1000 แท่ง) — R/ไม้:

| minRateRatio | long | short |
|---|---|---|
| 1.5 | **+0.008** | 0.020 |
| 1.75 | −0.033 | 0.039 |
| **2.0 (ใช้อยู่)** | **−0.071** | **0.075** |
| 2.5 | −0.065 | 0.075 |
| 3.0 (จากข้อ 5.16) | −0.142 | 0.092 |

`edgeShare` / `rateHistory` (600 แท่ง · baseline long −0.094 · short 0.078):

| variant | long | short |
|---|---|---|
| `edgeShare` 0.2 | −0.078 | 0.087 |
| `edgeShare` 0.4 | −0.088 | 0.088 |
| `rateHistory` 20 | **−0.019** | 0.099 |

**รวมทั้งหมด 9 ค่าจากสองรันที่เป็นอิสระต่อกัน ฝั่ง long ติดลบทุกค่า** ค่าที่ดีที่สุดคือ
`rateHistory 20` ที่ −0.019 ซึ่งก็ยังติดลบ · ฝั่ง short บวกอ่อน ๆ ทุกค่า (0.020–0.099)
และดีขึ้นเรื่อย ๆ เมื่อขันเกลียว **ไม่มีจุดกลับตัวเช่นกัน**

**ข้อสรุปที่วัดมาแล้ว ไม่ใช่การคาดเดา:** ปัญหาของ `speed_of_tape` ไม่ใช่ "ค่ายังไม่ถูก"
เพราะกวาดครบสามพารามิเตอร์แล้วไม่มีค่าไหนช่วยฝั่ง long ได้เลย
**ข้อเสนอ: ปิดฝั่ง long ด้วย `rule_overrides` แล้วเก็บ short ไว้ดูต่อ หรือปิดทั้งกฎ**
— รอเจ้าของตัดสิน ผมไม่กด (ปิดงาน 7.2 M ในเชิงหลักฐาน)

#### สรุปสามบรรทัด

| กฎ | ผล |
|---|---|
| `lvn` | ไม่รับอะไร · `minLevels` ไม่มีผลเลย · ค่าที่ "ดีที่สุด" ทำให้กฎเลิกเป็นกฎเดิม + ตกด่าน #18 |
| `naked_poc` | ไม่รับอะไร · **แต่ทั้งสองพารามิเตอร์ผ่านการวัดแล้วว่าค่าปัจจุบันเหมาะสม** |
| `speed_of_tape` | ไม่รับอะไร · **ฝั่ง long ติดลบ 9/9 ค่า — ควรปิดฝั่งนั้น** |

**สิ่งที่การกวาดครั้งนี้พิสูจน์เพิ่มเติม:** แถวราย instrument × กฎ ที่เพิ่มใน `backtest` v6
(ข้อ 8.6) ทำงานถูกต้อง — ตรวจแล้วผลรวมของ 64 กลุ่ม `(symbol, rule, dir)` เท่ากับแถว
`(rule, dir)` และแถว `(symbol)` **ไม่ตรงกัน 0 รายการ** และมันจับ "NQU6 short แย่ลง"
ของ `lvn` ได้ทันทีในการกวาดครั้งแรก ซึ่งเป็นสิ่งที่ก่อนหน้านี้มองไม่เห็นเลย

---

### 5.18a ตรวจย้อน §5.18 หาความลำเอียง — คง runtime เดิม แต่ถอนคำรับรองผลเดิม

**สถานะ:** ตรวจ 2026-09-02 · **ยังไม่มีการเปลี่ยนค่าใด ๆ และไม่มีอะไร deploy**
เพิ่ม query อ่านอย่างเดียวผ่าน **PR #58 ซึ่ง merge แล้วที่ `4d6a97e`**. ขั้นตอนรับรองใหม่อยู่ใน
`docs/EXPERIMENT_REVIEW_PROTOCOL.md` และ §0H.

**คำตัดสินที่ยังปลอดภัยคือ “ไม่รับ threshold ใหม่และคง runtime เดิม”** เพราะหลักฐานยังไม่พอให้
เปลี่ยน production — ไม่ใช่เพราะพิสูจน์แล้วว่าค่าปัจจุบันดีที่สุด. การตรวจ source รอบนี้ไม่พบ
look-ahead/leakage ที่ชัดเจน (`ctx.history`, `simulate()`, shared evaluator) แต่ **ไม่ใช่การพิสูจน์ว่า
ไม่มี leakage ทุกเส้นทาง** และยังขาด independent raw re-run. เหตุผล การเลือกแสดงผล และคำแนะนำเดิม
มีปัญหาตามข้อล่าง จึงถอนคำว่า “ข้อสรุปรอด” ในความหมายเชิงสถิติ.

#### สิ่งที่ผู้เสนอพบ (ตัวเลขทุกตัวมาจากไฟล์ query ข้างบน — **provisional จนกว่าผู้ตรวจอิสระจะรันซ้ำ**)

1. **`maxShare` ไม่ได้แปลว่าอย่างเดียวกันทุก instrument** สัดส่วนแถวบางสุด (หลัง trim ขอบ) ของ
   BTCUSDT อยู่ที่ **0.0040** เทียบกับ futures **0.18–0.21** ⇒ ด่านนี้ผ่าน **100% ของบาร์ BTCUSDT
   ที่ 0.25 และ 99.9% ที่ 0.15** = ไม่เคยกรองอะไรเลย · ไม้ `lvn` ของ BTCUSDT (164 จาก 271) จึงถูก
   สร้างโดยที่ด่านนิยามของกฎไม่ทำงาน ตัวเลขรวมของ `lvn` เป็นการเฉลี่ยของสองพฤติกรรมคนละแบบ
   นี่คือ **ข้อห้าม #8 ในรูปแบบใหม่** และทางแก้ที่เคยใช้ได้ผลคือแบบ §5.4 (normalize ต่อ instrument)
   **§5.18 เห็นอาการ ("BTCUSDT ไม่ขยับ") แต่ไม่ได้ระบุสาเหตุ**
2. **`minLevels` ผูกไม่ได้เลยโดยโครงสร้าง** แถวเฉลี่ยต่อบาร์คือ 52–272 ทุก instrument เกณฑ์ 8/12
   จึงไม่มีทางมีผล — ไม่ใช่ "วัดแล้วเป็นกลาง" แต่เป็นพารามิเตอร์ที่ตายตั้งแต่เกิด **ควรลบหรือเปลี่ยนหน่วย**
3. **มีรัน 1000 แท่งของ `lookbackBars` ที่ไม่ถูกรายงาน** — experiment `d2552763-c9f8-45b1-830a-c94ca884c90b`
   ทดสอบ 20/30/50 รวมเพดาน 50 ที่ §8.6 ระบุไว้ · §5.18 แสดงเฉพาะรัน 600 แท่ง (10/15/20/40)
   แล้วเขียนว่า "ขึ้นเรื่อย ๆ จนถึงค่าต่ำสุดที่วัด" ทั้งที่ครึ่งบนถูกวัดแล้ว
4. **`lookbackBars 20` ดีกว่าค่าปัจจุบันทั้ง 4 ช่อง (2 ทิศ × 2 รัน) และ drawdown ต่ำกว่า**
   (1000 แท่ง: long 0.690→0.790 dd 7.06→5.09 · short 0.855→0.899) · **ยังตก #14 และตก #18
   แบบเคร่งครัด** (BTC short −0.018 · NQU6 short −0.057) จึง **ไม่รับ** เหมือนเดิม
   แต่เหตุผลที่ §5.18 ใช้ ("R รวมตกจาก 62.12 → 43.06 ทิ้งไม้หนึ่งในสาม") เป็นจริงเฉพาะกับ
   `lookbackBars 10` เท่านั้น — เอาข้อโต้แย้งของค่าสุดขอบมาปฏิเสธทั้งพารามิเตอร์
5. **drawdown ถูกบันทึกครบทุกแถวและไม่ถูกรายงานสักแถว** `resultRows()` เก็บ `max_drawdown_r`
   ทุก breakdown รวม `(symbol, rule, dir)` · §8.6 ตั้งเกณฑ์ข้อ 3 (#17b) ไว้เอง · ตัวที่เสียหายสุดคือ
   **`rateHistory 20`** ที่ถูกปัดตกในหนึ่งบรรทัด ทั้งที่ลด dd ฝั่ง short จาก **11.33 → 6.37**
   พร้อม R/ไม้ ดีขึ้นทั้งสองทิศ และพลิก MNQU6 long จาก −0.103 เป็น +0.099
6. **"9 ค่าจากสองรันที่เป็นอิสระต่อกัน" — สองรันนั้นไม่อิสระ** `loadBars()` เรียง `opened_at desc`
   แล้วตัด ⇒ รัน 600 แท่งเป็นสับเซ็ตแท้ของรัน 1000 แท่ง · และภายในรันเดียวกัน การขยับ threshold
   ให้คะแนนไม้ชุดเดิมซ้ำ ⇒ เป็นประชากร long ~127 ไม้ที่ถูกมอง 9 มุม ไม่ใช่การทดสอบอิสระ 9 ครั้ง
7. **คำแนะนำ "ปิดฝั่ง long ของ `speed_of_tape`" ตกด่าน #18 ที่ §8.6 สร้างขึ้นมาเพื่อตรวจพอดี**
   รายตัวบน baseline 1000 แท่ง: BTCUSDT −0.137 (55) · MNQU6 −0.145 (36) · NQU6 −0.012 (14) ·
   **GC +0.181 (22)** · แต่บนรัน 600 แท่ง GC long = −0.085 (19) **พลิกเครื่องหมายบนไม้ ~20 ไม้
   ⇒ อ่านไม่ได้ (#11)** · ผลสดของกฎนี้คือ long **−0.025** บน 59 ไม้ ซึ่งแยกจากศูนย์ไม่ออก
   ⇒ หลักฐานรองรับได้แค่ **BTCUSDT long + MNQU6 long** (ติดลบทั้งสองรัน) ไม่ใช่ทั้งฝั่ง
8. **กริดถูกตัดเงียบ ๆ** `edgeShare 0.25` และ `rateHistory 5` ไม่เคยรัน · `minAgeBars 15` อยู่ใน
   แบตช์ที่ **failed** (`0414cea7-05e3-40f5-ba69-88e1935f5cc2`) · วันที่ 1 ก.ย. มี experiment
   สถานะ `failed` รวม **4 รายการ** · §5.18 ไม่พูดถึงสักแถว · และ `maxShare 0.55` เป็นค่าที่
   **เพิ่มหลังเห็นผล** ซึ่งใช้ไปในทางอนุรักษ์นิยม (เพื่อแสดงว่าไม่มีจุดกลับตัว) จึงรับได้ แต่ต้องติดป้ายว่า post-hoc

#### ถ้อยคำที่ต้องแก้ใน §5.18

"ทั้งสองพารามิเตอร์ผ่านการวัดแล้วว่าค่าปัจจุบันเหมาะสม" **แรงเกินหลักฐาน** เปลี่ยนเป็น:
> เป็นยอดที่สังเกตได้ในรันที่รายงาน จึงคงค่าไว้ชั่วคราว **แต่ยังไม่พิสูจน์ความแตกต่างทางสถิติ
> หรือความเหมาะสมสูงสุด**

#### ข้อที่การตรวจนี้เองผิด และถูกแก้แล้ว

การตรวจรอบแรกอ้างว่า SE แบบไม่จับคู่ (0.164 ที่ n=101) เป็น **"ขอบบน"** ของ SE จริง — **ผิด**
มันมองแรงเดียว (variants ใช้ไม้ซ้อนกัน ⇒ covariance บวก ⇒ SE ของผลต่างเล็กลง) โดยไม่นับแรงตรงข้าม
(ไม้สัมพันธ์กันภายในเซสชัน ⇒ effective n ต่ำกว่า n ⇒ SE ใหญ่ขึ้น) ทั้งสองยังไม่ได้วัด **จึงบอกทิศไม่ได้**
ถ้อยคำที่ถูกคือ: *SE ที่คำนวณแบบไม่จับคู่ใช้ทดสอบผลต่างนี้ไม่ได้ จึงยัง **พิสูจน์ไม่ได้** ว่ายอด
แตกต่างจาก noise* (ไม่ใช่ "พิสูจน์แล้วว่าไม่ต่าง")

และ estimand ที่ถูกไม่ใช่ paired treatment effect: ไม้ที่อยู่ทั้งสอง arm คือไม้ที่ไกลจากเส้นแบ่ง
ส่วนไม้ที่อยู่ arm เดียวคือไม้ที่การเปลี่ยนค่าพูดถึงพอดี — จับคู่เฉพาะ intersection จึงสร้าง
selection bias ใหม่ **สิ่งที่ต้องเทียบคือ policy contrast** (ชุดไม้ทั้งชุดที่ค่า A ผลิต เทียบชุดที่ค่า B ผลิต)
โดยหน่วยสุ่มคือ **เซสชัน** ⇒ ใช้ **block bootstrap ตาม session × instrument** ไม่ใช่ paired t-test

#### หลักฐานและการตรวจสอบ

ทุกตัวเลขในหัวข้อนี้มาจาก `docs/queries/gate0_parameter_binding.sql` ซึ่งผู้เสนอรายงานว่ารันกับ
production แล้ว แต่ **ยังไม่ผ่านการรันซ้ำโดยผู้ตรวจอิสระ**. จึงใช้เพื่อชี้ตำแหน่งที่ต้อง audit ได้
แต่ห้ามเรียกเป็น canonical fact, อ้างนัยสำคัญ หรือใช้เปลี่ยน runtime. การรันซ้ำต้องบันทึก exact
experiment IDs, data window, query commit, execution time และผลต่างจากเดิมตาม evidence packet.
ไม่มี unit test เพิ่ม เพราะ PR #58 ไม่เปลี่ยน runtime code.

#### ความเสี่ยง ระดับ และสิ่งที่เจ้าของต้องตัดสิน

- **ระดับปัจจุบัน L2** (ระเบียบการทดลอง) · **จะเป็น L3 ทันที** ถ้าเอาข้อสรุปเดิมของ §5.18
  ไปเปิด/ปิด Telegram, เปิด filter หรือใช้กับเงินจริง
- **รอเจ้าของ:** จะปิด `speed_of_tape` long เฉพาะ BTCUSDT + MNQU6 ด้วย `rule_overrides` หรือไม่
  **AI ไม่ตัดสินข้อนี้** · ความเสี่ยงถูกคุมชั้นหนึ่งอยู่แล้วโดย evidence gate ที่ mute cell ที่ไม่ผ่าน
- **Rollback ของงานนี้:** ลบไฟล์ query ทิ้ง ไม่มี schema/function/params/web ให้ย้อน

#### งานค้างที่หัวข้อนี้สร้างขึ้น

1. **ปิดแถว `standing sweep 2026-09-02` (`96de5127-e16f-40e1-b547-8a56775097eb`) ที่ค้าง
   `running`** ตั้งแต่ 2026-09-01 21:00 UTC โดยมี 0 แถว = อาการของ §3.11 / §7.2-O ตรง ๆ
   `/experiments` กำลังแสดงว่ากำลังรันทั้งที่ตายแล้ว และผลของคืนนั้นหายถาวร
2. **Gate 0 ก่อนกวาดค่าอะไรอีก** — รายงาน pass-rate ทั้งแบบ conditional และ marginal แยก
   instrument × direction × session พร้อม distribution, null rate, หน่วย และ sensitivity check
   ทำก่อนเสมอ เพราะการกวาดพารามิเตอร์ที่ผูกไม่ได้คือการเผา CPU quota ที่ §3.11 บอกว่าแพงแล้ว
3. **แตก §7.2-O เป็นสองส่วน** — **O1** persist ผลและสถานะทีละ variant · **O2** เก็บ per-opportunity
   artifact ที่มี stable candidate key, variant, included/excluded พร้อมเหตุผล, R, outcome,
   instrument และ data/evaluator version · **`signal_id` อย่างเดียวไม่พอ** · O2 เป็นเงื่อนไขก่อน
   ที่ใครจะอ้างความแตกต่างทางสถิติได้อีก
4. ✅ **กติกาแยกบทบาทเขียนแล้ว** — `Proposer → Executor/Recorder → Independent Reviewer →
   Owner` ใน §5.21 และ protocol. ตาราง GPT/Claude เป็น routing preference เท่านั้น; ห้ามใช้ข้าม
   การแยกบทบาท.
5. ✅ **กำหนด evidence packet แล้ว** — ทุกหัวข้อ §5.x ใหม่ต้องอ้าง exact `experiment_id` ครบ
   รวม failed / omitted / superseded พร้อม code/query commit และ data window. §5.18 เดิมยังเป็น
   historical report ที่ไม่ผ่านรูปแบบนี้ จึงคงป้าย provisional จนกว่าจะ audit ใหม่.

---

### 5.19 Confidence ที่ส่งเข้า Telegram ทุกวัน — วัดแล้วมันแทบไม่มีข้อมูลอยู่ในนั้น

**คำถาม:** "มั่นใจสูงควรจะ TP ไม่ใช่ SL" จริงไหม
**คำตอบ: ไม่จริง — และนี่คือครั้งแรกที่มีใครเอามาเทียบกัน**

`signals.confidence` ถูกเขียนลงทุกแถวมาตั้งแต่ migration 0001 และ `signal_outcomes` มีผลจริง
แต่**ไม่เคยมีการเทียบสองอย่างนี้เลยสักครั้ง** สูตร confidence ของทุกกฎ (`clamp01(0.35 + bonus...)`)
เป็นตัวเลขที่ผมตั้งเอง ไม่เคยผ่านการวัด — เหมือน `bars.trades` ในข้อ 5.16 คือของที่ทุกคน
คิดว่าใช้ได้เพราะมันมีอยู่

#### ขั้นแรกดูเหมือนความสัมพันธ์กลับทาง — **แต่มันคือกับดัก**

รวมทุกกฎ (1,205 ไม้ที่จบแล้ว):

| confidence | ไม้ | R/ไม้ | WR | TP% | SL% |
|---|---|---|---|---|---|
| 0.35–0.45 | 127 | **0.594** | 57.5% | 20.5 | 40.2 |
| 0.45–0.55 | 138 | 0.237 | 60.9% | 6.5 | 32.6 |
| 0.55–0.65 | 155 | 0.163 | 57.4% | 5.2 | 36.1 |
| 0.65–0.75 | 165 | 0.132 | 52.1% | 7.3 | 46.1 |
| 0.75–0.85 | 401 | 0.145 | **49.1%** | 11.2 | 46.1 |
| 0.855–1.00 | 219 | 0.516 | 61.2% | 16.9 | 34.2 |

WR ตกเป็นเส้นตรง 57.5% → 49.1% เมื่อ confidence สูงขึ้น ดูเหมือนยิ่งมั่นใจยิ่งแย่

**อย่าเชื่อตารางนี้** — แต่ละกฎมีการกระจาย confidence คนละแบบ และคุณภาพคนละชั้น
(`absorption` R/ไม้ ~0.6 · `poc_shift` ~0.05) ถ้ากฎที่แย่บังเอิญยิง confidence สูงเป็นประจำ
ตารางรวมจะโชว์ความสัมพันธ์กลับทางทั้งที่ในกฎเดียวกันไม่มีอะไรเลย
**นี่คือ Simpson's paradox และเป็นความผิดพลาดชนิดเดียวกับข้อห้าม #18**

#### พอคุมกฎแล้ว ความสัมพันธ์หายไปเฉย ๆ

| กฎ | ไม้ | **corr(confidence, R)** | R ครึ่งล่าง | R ครึ่งบน |
|---|---|---|---|---|
| `poc_shift` | 376 | **0.013** | −0.016 | 0.106 |
| `stacked_imbalance` | 243 | **0.051** | 0.177 | 0.185 |
| `absorption` | 197 | **0.027** | 0.526 | 0.714 |
| `lvn` | 176 | −0.100 | 0.035 | −0.057 |
| `naked_poc` | 123 | −0.114 | 0.982 | 0.746 |
| `delta_divergence` | 51 | **0.417** | −0.127 | 0.819 |
| `speed_of_tape` | 23 | −0.146 | — | — |
| `delta_flip` | 16 | 0.069 | — | — |

สามกฎที่มีไม้มากที่สุดได้ corr **0.013 / 0.051 / 0.027** = ศูนย์ในทางปฏิบัติ
สองกฎติดลบเล็กน้อย ไม่มีตัวไหนใกล้เคียงกับ "มั่นใจสูง = ผลดีกว่า"

**สรุปตรง ๆ: confidence ที่คำนวณอยู่ตอนนี้ไม่ได้บอกอะไรเลยเกี่ยวกับผลของไม้นั้น**

#### สิ่งที่ต้องทำ (และไม่ทำ)

1. **ห้ามใช้ confidence เป็นตัวกรอง** ไม่ว่ากรณีใด — ไม่มีหลักฐานรองรับแม้แต่นิดเดียว
2. **ตัวเลขในข้อความ Telegram กำลังทำให้เข้าใจผิด** คนอ่านเห็น 85% แล้วคิดว่าไม้นี้ดีกว่า
   ไม้ 40% ซึ่งไม่จริง → ควรถอดออก หรือเขียนกำกับว่ายังพิสูจน์ไม่ได้
3. **`delta_divergence` เป็นที่เดียวที่มีสัญญาณ** (corr 0.417 · ครึ่งบน 0.819 vs ครึ่งล่าง −0.127)
   แต่บน 51 ไม้ยังตัดสินไม่ได้ (ข้อห้าม #11) — **จับตาไว้ ยังไม่ต้องทำอะไร**
4. **อย่าเพิ่งไปแก้สูตร confidence** การเขียนสูตรใหม่โดยไม่รู้ว่าอะไรทำนายผลได้จริง
   คือการเดารอบสอง ถ้าจะทำให้มันมีความหมาย ต้องหาก่อนว่าฟีเจอร์ไหนสัมพันธ์กับ R
   แล้วค่อยประกอบเป็นคะแนน ไม่ใช่กลับกัน

**ราคาของการค้นพบนี้: คิวรี 2 อัน ไม่มีการแก้โค้ดเลย** และมันปิดคำถามที่ค้างมาตั้งแต่กฎแรก

---

### 5.20 Confidence v2 — เริ่มเก็บหลักฐานแบบ Shadow แล้ว (ยังไม่ใช่คะแนน)

#### สถานะที่ต้องรู้ก่อนทำต่อ

`signals.confidence` เดิมยังเป็น **ความแรงจากสูตรเขียนมือ** ไม่ใช่ probability และยังถูกส่ง
Telegram ตามพฤติกรรมเดิม. งานนี้จึงไม่สร้างสูตร 2.0 ที่เดาใหม่ แต่เพิ่ม snapshot ที่ตรึงข้อมูล
**ณ เวลาที่ signal เกิด** ไว้ใต้ `signals.payload.confidenceV2` เพื่อให้โมเดลรุ่นต่อไปตรวจสอบ
ย้อนกลับได้. ข้อมูลเก่า 1,313 แถวไม่มี snapshot นี้และ **ไม่ backfill** เพราะไม่มีทางพิสูจน์ได้
ว่าฟีเจอร์ทุกตัวเป็นค่าที่รู้ได้ก่อนผลลัพธ์จริง.

สถานะ deploy ตอนเริ่มเก็บ และสถานะปัจจุบันที่ยืนยันซ้ำ 2026-09-02:

| ส่วน | สถานะ | ความหมาย |
|---|---|---|
| migration 0029 `confidence_v2_progress` | ✅ production แล้ว | เป็น view อ่านอย่างเดียว; ไม่แตะข้อมูลเดิม/RLS/security policy |
| `ingest` ที่เขียน snapshot v2 | ✅ เริ่มใน `v15`; ปัจจุบันอยู่ใน **v17 Active** | View ปัจจุบันมี 436 captured / 431 resolved / 16 cohorts; feed หยุดอัปเดตหลังประมาณ 23:40 UTC ตาม §0D |
| Dashboard Confidence v2 | ✅ merge แล้วผ่าน PR #48 | Source แสดงสถานะ Shadow ใน `/signals/[id]` และ `/stats`; รอบ 2026-09-02 ยังไม่ได้ตรวจ visual production ซ้ำ |
| Telegram / rule params / filter | **ไม่เปลี่ยน** | นี่คือขอบเขตตั้งใจของ v2 ระยะนี้ |

#### contract ของ snapshot (ห้ามเปลี่ยนเงียบ ๆ)

ทุก signal ใหม่ที่ผ่าน `runRules()` หลัง deploy จะได้โครงสร้างนี้:

```json
{
  "modelVersion": "v2-shadow-1",
  "mode": "shadow",
  "target": "positive_r_after_horizon",
  "score": null,
  "scoreReason": "no_calibrated_model",
  "features": { "shared": { "...": "..." }, "rule": { "...": "..." } }
}
```

`score: null` เป็นข้อป้องกัน ไม่ใช่ค่าที่ขาดหาย: ไม่มีโมเดลที่สอบเทียบแล้วจึงห้าม UI,
Telegram หรือ downstream ใดตีความเป็นเปอร์เซ็นต์. `modelVersion` ระบุ **schema ของ feature**
ให้ผู้สร้างโมเดลในอนาคตอ้างอิงได้; หากเพิ่ม/ลบ/เปลี่ยนความหมาย feature ต้องสร้าง version ใหม่
เช่น `v2-shadow-2` ไม่ฝืนรวมกับ cohort เดิม.

`shared` เก็บเฉพาะข้อมูล ณ signal time: legacy score, range/body/ตำแหน่ง close, volume และ
อัตราเทียบ median ของ history, ticks และอัตราเทียบ median, delta/absolute delta, จำนวนแท่ง
history และ price-action context (sweep/zone/structure). `rule` ใช้ whitelist เท่านั้น:

| rule | features ของ rule |
|---|---|
| `absorption` | `observedMultiple`, `rejectionTicks`, `level.delta` |
| `stacked_imbalance` | `stackLength`, `avgRatio` |
| `delta_divergence` | `delta`, `minDelta`, `maxDelta` |
| `poc_shift` | `totalShiftTicks`, `pocVolumeShare`, `isHvn` |
| `delta_flip` | `delta`, `minDelta`, `maxDelta`, `level.ageBars`, `levelDistanceShare` |
| `lvn` | `observedShare`, `closeDistanceShare`, `levelsInProfile` |
| `naked_poc` | `level.ageBars`, `closedBackShare`, `nakedInWindow`, `reachedThisBar` |
| `speed_of_tape` | `observedRatio`, `closeShare`, `tradeSizeRatio`, `trades` |

`history` ที่ใช้ median เป็นแท่ง **ก่อน** signal bar และ `signal_outcomes` ไม่ถูกอ่านใน
`collectConfidenceV2()` จึงไม่มี look-ahead. ห้ามใส่ prose, outcome, announced state หรือ field
ใหม่จาก payload เข้าโมเดลโดยไม่แก้ contract และ version.

#### Dashboard และ view วัดอะไร

- `/signals/[id]` เปลี่ยนป้ายเลขเดิมเป็น **“ความแรงเดิม (ยังไม่สอบเทียบ)”** และแสดง card
  `Confidence v2 · Shadow` พร้อมจำนวน features; signal เก่าจะแจ้งตรง ๆ ว่าเกิดก่อน v2.
- `/stats` เพิ่มตาราง cohort ต่อ `model_version × rule × direction` จาก
  `public.confidence_v2_progress`: เก็บแล้ว, ปิดผลแล้ว, จำนวน symbol/session, R ต่อไม้, win rate
  และ verdict. View นับเฉพาะ signal ที่มี snapshot v2 และ outcome ที่ resolve แล้ว.
- verdict `ready for offline calibration` แปลเพียง **>=30 outcome, >=2 symbol, >=3 session**
  ใน cell นั้นพอให้ *เริ่มทดลอง offline*; ไม่ใช่เกณฑ์อนุมัติ filter. <30/2/3 จะแสดงว่าขาดอะไร.

#### Verification ณ จุดส่งต่อ

- `web` REV 1.3.1: `npm run typecheck` และ `npm run build` **ผ่าน**. Build เตือนว่าเครื่องมี
  lockfile นอก repo อีกตัว จึงเดา workspace root ได้ไม่ตรง; เป็น warning ของเครื่อง build ไม่ใช่
  TypeScript/Next error.
- source `confidence_v2.ts` และ `rules/index.ts` ผ่าน TypeScript compile check แบบ local.
  เพิ่ม test `supabase/functions/_shared/confidence_v2_test.ts` แล้ว แต่เครื่องที่ส่งต่องานนี้
  **ไม่มี Deno** จึงยังไม่ได้รัน `deno task test/check/rev:check`; ต้องรันสามคำสั่งนั้นใน CI
  หรือเครื่องที่ติดตั้ง Deno ก่อน merge/deploy.
- migration ปรากฏใน production เป็น `20260901082918 confidence_v2_shadow`; `ingest v15` Active,
  `verify_jwt: false` เท่าเดิม และ bundle ยืนยันว่ามี `_shared/confidence_v2.ts`. GET ได้ **405**;
  POST ที่ไม่มี token ได้ **401**. จากนั้น feed จริงเวลา **2026-09-01 09:10 UTC** เข้า GC/NQU6/MNQU6
  3 POST (`ingest_log.error = null`) สร้าง signal ใหม่ 4 แถวที่มี `modelVersion: v2-shadow-1`,
  `mode: shadow`, `score: null`; `confidence_v2_progress` ขึ้น 3 cohort (ยัง `resolved = 0` ตาม horizon).
- Supabase advisors หลัง DDL ไม่มี finding ที่ชี้มาที่ view ใหม่. Finding เดิมยังค้างอยู่:
  `feed_alerts`/`runner_tokens` มี RLS แต่ไม่มี policy, mutable search path ของ
  `claim_outcome_notifications`, `pg_net` อยู่ `public`, leaked-password protection ปิด, และ
  performance warnings ที่ `rule_overrides`/`rule_snapshots`. อย่าปิดหรือแก้ในงาน confidence
  แบบเดาสุ่ม — เป็นงาน security แยกที่ต้องตรวจผลกระทบ.

#### ลำดับที่ผู้รับงานต้องทำ — ห้ามข้ามด่าน

1. ✅ Deploy เริ่มตั้งแต่ `ingest v15` และยังอยู่ใน `ingest v17` ด้วยไฟล์ครบชุดรวม `_shared/confidence_v2.ts` และ registry ที่ import มัน
   (`verify_jwt: false` เหมือน ingest เดิม เพราะ handler ตรวจ `INGEST_TOKEN` เอง). MCP รายงาน 20
   source files เพราะ `types.ts` เป็น type-only import และ Deno bundler ตัดออก; ไม่ใช่ไฟล์ตกหล่น.
2. ✅ ตรวจครบ 3 ชั้นแล้ว: token มั่ว → 401, `GET` → 405, feed จริง 3 POST หลัง deploy ไม่มี error
   และสร้าง v2 snapshot 4 แถว. ตรวจซ้ำได้ด้วย
   `select * from public.confidence_v2_progress order by captured_signals desc;`.
3. ปล่อยให้ cohort v2 ปิดผลตาม horizon. **ไม่**เอา 1,313 แถวเก่าที่ไม่มี snapshot มารวม;
   **ไม่**ยก verdict ว่า `ready` ให้กลายเป็นคะแนนหรือ filter.
4. เมื่อ cohort พอ: export feature snapshot + R, split ตามเวลา (train ก่อน, holdout หลัง),
   ตรวจ rule×direction และ instrument แยก, report อย่างน้อย calibration curve, Brier/log loss,
   R/ไม้, drawdown และจำนวนไม้. รุ่นโมเดลต้องมี `model_version` ที่ immutable.
5. เก็บโมเดลที่เลือกใน **shadow อีกช่วงหนึ่ง**: บันทึก prediction ของมันแต่ยังไม่เปลี่ยน Telegram,
   แล้วเทียบเฉพาะ signal ที่เกิด *หลัง* model version นั้น. ผ่าน forward test และเจ้าของอนุมัติ
   ชัดเจนเท่านั้น จึงพิจารณา filter/ข้อความใหม่ได้.

#### ข้อห้ามเพิ่มสำหรับ confidence

- อย่าเรียก `legacyScore` หรือค่าใดใน snapshot ว่า confidence percentage.
- อย่า backfill v2 จาก payload เก่าแล้วผสมกับ data ใหม่โดยไม่ทำ reproducible replay ที่พิสูจน์
  signal time ได้.
- อย่าเปลี่ยน Telegram เพียงเพราะ Dashboard มีคำว่า “พร้อมสร้างโมเดล offline”.
- อย่าตรึง threshold จาก win rate อย่างเดียว: เป้าหมายคือ R หลัง horizon และต้องดู drawdown/
  sample size/instrument เสมอ.

### 5.21 ใครทำอะไร — แบ่งตามความถนัดที่พิสูจน์แล้วในโปรเจกต์นี้

**แก้ครั้งที่ 3 · 2026-09-02; GPT/Codex ตรวจร่างของ Claude แล้ว** — ตารางนี้ระบุว่า
*งานตรงหน้าควรส่งให้ใครก่อน* ตามหลักฐานที่มีจริง แต่แยกจากบทบาทวงจรชีวิต. GPT รับรองร่างโดยแก้ว่า
`SQL` เป็นแหล่งหลักฐาน ไม่ใช่ผู้ตรวจ และชื่อโมเดลไม่ลบกฎ independence; ดู §0H.

**หลักที่ไม่เปลี่ยนไม่ว่าจะแก้กี่รอบ:** ตัวเลข R, win rate, drawdown, fill rate, sample size และ
calibration ต้องมาจาก **SQL/TypeScript ที่รันซ้ำได้** เสมอ **ไม่มี AI ตัวไหนเป็นเจ้าภาพของตัวเลข**
AI อธิบาย query ได้ แต่ห้ามแทนที่มัน · คำตอบที่ไพเราะไม่ใช่หลักฐาน · ตอบ `ข้อมูลไม่พอ` ได้เสมอ

#### ตารางเจ้าภาพหลัก — ใช้เพื่อ routing; ห้ามใช้รวมบทบาท

| งาน | **เจ้าภาพหลัก** | **ผู้ตรวจ** | ทำไมถึงเป็นคนนี้ (หลักฐานในเอกสารนี้) |
|---|---|---|---|
| C# indicator, ATAS platform, DrawingText/overlay, build & REV | **GPT/Codex** | เจ้าของ (screenshot บนกราฟจริง) | REV 1.3.1 → 1.3.2 → 1.4.0 ทำครบทั้ง build 0 warning, reflection ตรวจ default, อ้าง ATAS docs และมาตรฐาน TradingView/NinjaTrader — §0C, §0F, §0G |
| Supabase: migration, edge function, deploy, verification 3 ชั้น | **GPT/Codex** | Claude (ตรวจว่าเคลมตรงกับ log จริงไหม) | migration 0029–0031 · ingest v15→v17 · จับ 401/405/ingest_log ครบทุกรอบ — §7.4, §0A.3, §0B.2 |
| Test suite, CI, typecheck, fixture | **GPT/Codex** | CI และผู้ตรวจอิสระเมื่อผล test รองรับการเปลี่ยน production | รัน 138 tests และ **รายงานตรง ๆ ว่า typecheck ทั้งก้อนยังไม่เขียวเพราะ fixture `confidence_v2_test.ts`** แทนที่จะเคลมว่าผ่าน — §0A.3 |
| โค้ดตัวรัน backtest, scorer, pipeline | **GPT/Codex** | Claude | `resultRows()` loop ที่สี่ · `ambiguous_path` · evidence gate ที่ fail closed เฉพาะการประกาศ ไม่ใช่ทั้ง ingest — §0A.1 |
| สคริปต์เครื่องมือ, updater, encoding บน Windows | **GPT/Codex** | เจ้าของ | เจอ root cause ว่า updater hardcode `origin/main` — §0E |
| **สถิติเชิงรูปนัย**: estimand, bootstrap, holdout, calibration | **GPT/Codex** | Claude | แย้งเรื่อง SE ของ Claude ได้ถูกและรอบคอบกว่า — เห็นทั้ง covariance และ serial/session dependence ขณะที่ Claude เห็นทางเดียว (§5.18a) |
| เขียน Handoff / §5.x / PR body / runbook | **GPT/Codex** | Claude (ตรวจว่าอะไร*ไม่ได้*ถูกเขียน) | โครงสร้าง acceptance/rollback/evidence สม่ำเสมอทุกหัวข้อ — §0C.2, §0F.2, §0G.1 |
| **ท้าทายผล หาความลำเอียง** (look-ahead, leakage, selection bias, data-snooping, regime dependence) | **Claude** | เจ้าของ | เจอ selective reporting ของ §5.18 ด้วยการ query ดิบ · เจอ 4 รัน `failed` และ variant ที่ไม่เคยรัน — §5.18a |
| **ตรวจว่าเกณฑ์ผูกจริงไหม / แปลเหมือนกันทุก instrument** (Gate 0) | **Claude** | GPT/Codex หรือผู้ตรวจอิสระรัน SQL ซ้ำ | Claude เจอ `maxShare` อิ่มตัวบน BTCUSDT และ `minLevels` ผูกไม่ได้ — §5.18a ข้อ 1–2. **ตัวเลขยัง provisional จนกว่าจะรันซ้ำ**; SQL เป็น evidence source ไม่ใช่ reviewer |
| ตั้ง hypothesis / หา feature / หากลไก | **Claude** | GPT/Codex หรือ Claude คนละ session ที่ไม่เคยเสนอ/รัน hypothesis นี้ | Claude เชื่อมอาการ `BTCUSDT ไม่ขยับ` ไปที่ parameter semantics ได้ใน §5.18a; แต่กฎผู้เสนอห้ามตัดสินผลยังอยู่เหนือความถนัดนี้ |
| อ่านเอกสารยาวแล้วหาสิ่งที่ขัดกันเอง / ที่หายไป | **Claude** | GPT/Codex ตรวจจุดที่นำไปแก้สถานะ | จับได้ว่า §2/§9/§10 ค้างเลขเวอร์ชันเก่าขณะที่ §0 อัปเดตแล้ว; เป็นหลักฐานเฉพาะ repo นี้ ไม่ใช่คำกล่าวว่า Claude ทุก version ดีกว่าเสมอ |
| เรียบเรียงภาษาไทยในเอกสารและ UI | **Claude** | เจ้าของ | เป็น routing preference ที่เจ้าของกำหนด; **ยังไม่มี benchmark เชิงปริมาณ** จึงห้ามอ้างว่าเป็นความสามารถที่พิสูจน์ทางสถิติ |
| **ตัวเลขทุกตัว** | **SQL/DB หรือ deterministic code เป็นแหล่งหลักฐาน** | ผู้ตรวจอิสระต้องรันซ้ำเอง | §5.18a พบข้อมูลที่ narrative ไม่ได้รายงาน; ห้าม AI คำนวณจากการอ่านตารางหรือ prompt แล้วใช้แทน query |
| เปิด/ปิด Telegram, filter, rule, `announcement_mode` | **เจ้าของ** | — | AI ไม่มีสิทธิ์อนุมัติ ทุกกรณี |
| ATAS GUI, ติดตั้ง DLL, Supabase Auth, revoke/rotate secret | **เจ้าของ** | — | AI ไม่มีสิทธิ์เข้าถึง — §7.1 |

#### กฎเหล็กสี่ข้อ ที่อยู่เหนือตารางข้างบน

1. **ผู้เสนอไม่ตัดสิน hypothesis ของตัวเอง** ถ้า Claude เสนอ ให้ GPT หรืออีกเซสชันเป็นคนวัดว่าได้ผลไหม
2. **ผู้รันและผู้เขียนสรุปไม่อนุมัติผลของตัวเอง** และ **ผู้ตรวจต้อง query artifact ดิบเอง**
   (`experiments`, `experiment_results`, `bars`, `cluster_levels`) ไม่ใช่อ่านหัวข้อ §5.x
3. ทุก hypothesis ต้องบันทึก `Proposer → Executor/Recorder → Independent Reviewer → Owner`.
   คน/AI เดียวรับหลายบทบาทในวงจรนั้นไม่ได้; CI/SQL เป็นเครื่องมือ ไม่ใช่ผู้ตรวจอิสระ.
4. ทุกข้อสรุปเชิงตัวเลขต้องมี evidence packet ตาม `docs/EXPERIMENT_REVIEW_PROTOCOL.md`.
   ถ้าไม่มี exact IDs, data window, variants ที่ fail/omit/supersede และ raw re-run ให้ติดป้าย `provisional`.

เหตุผลของข้อ 2 พิสูจน์แล้วใน §5.18a: มีรันที่ให้ผลดีกว่าค่าปัจจุบันอยู่ในฐานข้อมูลแต่ไม่ขึ้นรายงาน
**ผู้ตรวจที่อ่านได้แค่รายงานจับ selection bias ไม่ได้ตามนิยาม เพราะสิ่งที่ถูกคัดออกไม่อยู่ในรายงาน**
ไม่ใช่ความผิดของโมเดลไหน — เป็นการบีบอัดตามธรรมชาติของการเขียนสรุป ใครเขียนก็เป็น

#### จุดอ่อนที่รู้แล้วของแต่ละฝั่ง — เขียนไว้เพื่อให้ผู้ตรวจรู้ว่าต้องเพ่งตรงไหน

**GPT/Codex พลาดที่ชั้นการตีความ ไม่ใช่ชั้นวิศวกรรม** — §5.18 รายงานรันเดียวจากสองรัน ·
ไม่รายงาน drawdown ทั้งที่เก็บครบทุกแถวและตั้งเกณฑ์นั้นไว้เอง · นับ 9 ค่าจากตัวอย่างที่ซ้อนกัน
ว่าเป็นหลักฐานอิสระ · เสนอปิดฝั่ง long ทั้งกฎโดยข้ามด่าน #18 ที่ตัวเองสร้างขึ้นมาเพื่อตรวจ
⇒ **เวลารับงานจาก GPT ให้เพ่งที่ "อะไรไม่ได้ถูกเขียน" มากกว่า "ที่เขียนมาถูกไหม"**

**Claude พลาดที่ชั้นสถิติเชิงรูปนัย และมั่นใจเกินตัวเลขที่ตัวเองมี** — อ้างว่า SE แบบไม่จับคู่
เป็น "ขอบบน" ทั้งที่มองแรงเดียว (§5.18a) · และเสนอ action ที่แคบลง (ปิด BTCUSDT/MNQU6 long)
ซึ่งเป็นดินแดนของเจ้าของ ไม่ใช่ของผู้ตรวจ
⇒ **เวลารับงานจาก Claude ให้ขอ SQL ทุกตัวเลข และถามว่า "อะไรจะทำให้ข้อนี้ผิด"**

**ตารางนี้มาจากหลักฐาน ไม่ใช่จากศรัทธา** ความสามารถของโมเดลเปลี่ยนได้ ⇒ ทบทวนใหม่เมื่อมี
หลักฐานสวนทาง และอ้างหัวข้อที่เป็นหลักฐานทุกครั้งที่ย้ายเจ้าภาพ
*(provenance ถาวร: Claude ร่างฉบับตั้งต้น จึงไม่รับรองร่างตัวเอง. GPT/Codex ตรวจและรับรองเมื่อ
2026-09-02 โดยแก้ 2 จุดใน §0H; การรับรองนี้ครอบคลุมนโยบาย ไม่ได้ทำให้ตัวเลข provisional ใน
§5.18a ผ่าน independent raw re-run.)*

#### Gate ที่ใช้ตัดสินแทนความเห็นของ AI

1. hypothesis และเกณฑ์ผ่าน/แพ้บันทึก **ก่อน**เห็นผล · ห้ามปรับแล้ววัดชุดเดิมซ้ำจนดูดี
   (ต่อกริดหลังเห็นผลได้ถ้าใช้ไปในทางปฏิเสธ **แต่ต้องติดป้ายว่า post-hoc** — §5.18a ข้อ 8)
2. signal-time feature ต้องไม่มี outcome, future bar หรือ state ที่ประกาศภายหลังปนอยู่
3. แยกตามเวลา train → holdout → forward · ห้ามเลือก threshold จาก holdout แล้วเรียกผลนั้นว่า holdout
4. เทียบ baseline เสมอ: **R/ไม้ · drawdown · fill rate · จำนวนไม้ · rule × direction × instrument**
   และ calibration (Brier/log loss เมื่ออ้างว่าเป็น probability)
5. **ทดสอบความต่างด้วย block bootstrap ตาม session × instrument ไม่ใช่ paired t-test** —
   หน่วยสุ่มคือเซสชัน ไม่ใช่ไม้ · estimand คือ **policy contrast** (ชุดไม้ทั้งชุดที่ค่า A ผลิต
   เทียบชุดที่ค่า B ผลิต) การจับคู่เฉพาะ intersection ทิ้งไม้ที่การเปลี่ยนค่าพูดถึงพอดี
   **ยังทำไม่ได้จนกว่า §7.2-O2 เสร็จ ⇒ ระหว่างนี้ห้ามอ้างว่าความต่างมีนัยสำคัญ**
6. **Gate 0 ก่อนกวาดค่าเสมอ** — pass-rate ทั้ง conditional และ marginal แยก instrument × direction
   × session พร้อม distribution, null rate, หน่วย และ sensitivity check · การกวาดพารามิเตอร์ที่
   ผูกไม่ได้คือการเผา CPU quota ที่ §3.11 บอกว่าแพงแล้ว
7. `confidence_v2` อยู่ shadow จนกว่าโมเดลที่ตรึง version ชนะ baseline บนข้อมูล forward ที่ไม่เคยเห็น
   และเจ้าของอนุมัติเป็นลายลักษณ์อักษร

#### ระดับการแย้ง — AI ต้องแจ้งก่อนทำ ไม่ใช่ทำตามเงียบ ๆ

| ระดับ | เมื่อไร | AI ต้องทำอะไร | ผลเสียหากฝืนทำ |
|---|---|---|---|
| **L1 — แจ้งเตือน** | ขอให้สรุป/คำนวณจากข้อมูลที่ query ได้ แต่ไม่มี query แนบ | ทำได้เฉพาะหลังแนบ query/source และบอกข้อจำกัด | รายงานคลาดเคลื่อน ใช้ตัดสินใจผิดได้ แต่ยังไม่เปลี่ยนระบบ |
| **L2 — ต้องทบทวน** | ให้ผู้เสนอตรวจงานตัวเอง · เชื่อ backtest รอบเดียว · กวาดค่าโดยข้าม Gate 0 · ยืนยัน edge จาก narrative | หยุดที่ draft/experiment · ขอ hypothesis, baseline, Gate 0 และ holdout plan | overfitting, data-snooping, ความมั่นใจปลอม และการทดลองถัดไปตีความยาก |
| **L3 — ห้ามทำจนมีหลักฐาน** | เปิด rule/filter/Telegram จาก backtest หรือ confidence ที่ยังไม่ผ่าน forward · ปรับ threshold ระหว่างดูผล · deploy/migration โดยไม่มี verification owner | ปฏิเสธการเปลี่ยน production · เสนอขั้น shadow/peer review/rollback | ขาดทุนหรือพลาดโอกาสจริง · spam Telegram · ทำลาย baseline และปนเปื้อนข้อมูลทดลอง |
| **L4 — หยุดและขออนุมัติชัดเจน** | ให้ AI ยิงออเดอร์จริง · ปิด safety/telemetry · ลบหรือแก้ history · rotate secret ไม่มีแผน · ข้าม test/deploy verification | ไม่ทำ · สรุป impact, rollback และสิทธิ์ที่ต้องใช้ ให้เจ้าของตัดสิน | เสียหายเงินจริง · สูญเสียประวัติพิสูจน์ผล · credential exposure · ระบบรับสัญญาณหยุด |

**รูปแบบการแย้งที่ต้องตอบทุกครั้ง:** `คำสั่งที่ขอ` → `ระดับ L1–L4` → `อะไรที่พิสูจน์ไม่ได้`
→ `ผลเสียที่เป็นไปได้` → `ผู้รับผิดชอบที่ถูกต้อง` → `หลักฐาน/approval ที่ต้องมี`
ผู้ใช้ override ได้ แต่ **L3/L4 ต้องบันทึกเหตุผล, scope, owner, rollback และคำยืนยันใน PR/Handoff
ก่อนทำ** · ไม่มีคำว่า "user ขอแล้ว" ที่ทำให้ผลทดลองซึ่งเสียความน่าเชื่อถือกลับมาเชื่อถือได้

#### ถ้าส่งงานผิดคน — AI ต้องตอบกลับแบบนี้

| สั่งแบบนี้ | ผิดตรงไหน | ระดับ | ต้องตอบว่า |
|---|---|---|---|
| "Claude แก้ migration / deploy ให้ที" | ไม่ใช่ความถนัด และเสี่ยง verification ไม่ครบ | **L2** | ส่งให้ GPT · Claude ช่วยตรวจว่าเคลมตรง log ไหมได้ |
| "GPT ตรวจหน่อยว่า §5.18 ที่ GPT เขียนลำเอียงไหม" | ผู้เขียนตรวจตัวเอง | **L2** | ต้องเป็นผู้ตรวจอิสระ |
| "Claude คิด feature มา แล้วบอกเลยว่าอันไหนดีสุด" | ผู้เสนอตัดสินตัวเอง | **L2** | เสนอได้ ≤3 ข้อพร้อมเงื่อนไขแพ้ **แต่ให้คนอื่นตัดสิน** |
| "ดูตารางนี้แล้วบอกว่ากฎไหนกำไรดีสุด" | ให้ AI เป็นเครื่องคิดเลข | **L1** | ขอรัน query ก่อน แล้วตอบพร้อม SQL |
| "GPT กวาดค่าใหม่ให้" (ยังไม่ทำ Gate 0) | อาจกวาดพารามิเตอร์ที่ผูกไม่ได้ | **L2** | ขอ Gate 0 ก่อน มิฉะนั้นเผา CPU quota ฟรี |
| "ผลดูดี เปิด Telegram กฎนี้เลย" | เปิดจาก backtest ไม่มี forward | **L3** | ปฏิเสธ · เสนอ shadow + forward + approval ลายลักษณ์อักษร |
| "เอา confidence มากรองสัญญาณ" | v2 ยัง `score:null` · v1 วัดแล้วไม่มีข้อมูล | **L3** | ปฏิเสธ · อ้าง §5.19 corr 0.013–0.051 |
| "ตั้ง `announcement_mode = manual` ให้สัญญาณมาไว ๆ" | ข้าม evidence gate | **L3** | ปฏิเสธ · §0A.1 ข้อ 3 เป็น owner override ที่ต้องบันทึกเหตุผล |
| "AI ยิงออเดอร์ให้เลย" / "หมุน secret ให้ที" | เกินขอบเขต AI | **L4** | ไม่ทำ · สรุป impact + rollback + สิทธิ์ ให้เจ้าของทำเอง |

#### สรุปสั้นสุดสำหรับเวลาจะสั่งงาน

- **จะแตะโค้ด เครื่อง หรือเปลี่ยนฐานข้อมูล** → GPT; query อ่านอย่างเดียวให้ผู้ตรวจอิสระรันซ้ำได้
- **จะถามว่าเชื่อผลนี้ได้ไหม / มีอะไรหายไปหรือเปล่า** → Claude
- **จะถามว่าตัวเลขเท่าไร** → SQL/deterministic code แล้วให้อีกฝั่งรันซ้ำ; ห้ามอ่านตัวเลขด้วยตาแทน query
- **จะเปิด-ปิดอะไรที่ถึงมือถือหรือถึงเงิน** → เจ้าของเท่านั้น

### 5.22 อะไรต้อง push/deploy เพื่อให้สัญญาณทำงานจริง และอะไรทำทีหลังได้

**คำสำคัญ:** `git push` เก็บ source และเปิดทางให้ review/merge; มัน **ไม่**เปลี่ยน Supabase
Edge Function ที่รับ signal อยู่. การเปลี่ยน logic สัญญาณจริงต้อง deploy `ingest` แยกต่างหาก.
ส่วน merge เข้า `claude/form-signal-telegram-rz8am1` จะทำให้ Vercel สร้าง **หน้าเว็บ** ใหม่เท่านั้น
ไม่ใช่ตัวประมวลผล signal.

| ส่วน | ต้องมีเพื่อสร้าง/รับ signal สดไหม | ต้องทำเมื่อมีการเปลี่ยนส่วนนี้ | สถานะปัจจุบัน |
|---|---|---|---|
| ATAS indicator ที่ส่ง payload พร้อม `INGEST_TOKEN` | **ต้องมี** | build/install indicator และตั้ง endpoint/token ให้ตรง; ไม่ใช่ Git push อย่างเดียว | เคยใช้งานผ่าน v17 แล้ว แต่ feed ล่าสุดหยุดที่ ~23:40 UTC; ต้องตรวจ ATAS/bridge ตาม §0D.1 |
| Supabase `ingest` + shared rules ที่มัน import | **ต้องมี** สำหรับ logic, การเขียน `signals`, และ Telegram path | push เพื่อเก็บ source แล้ว deploy Edge Function **พร้อมไฟล์ dependency ครบชุด**; ตรวจ 405 → 401 → feed จริง | **v17 Active**; v2 snapshot และ Evidence-first อยู่ใน bundle ปัจจุบัน |
| `rule_overrides`, `telegram_enabled`, `announcement_mode`, params | **ต้องมี** ในการกำหนดว่าจะสร้าง/ประกาศ rule ไหน | ปรับผ่าน `/rules`/DB ได้; `manual` ต้องมี owner approval + Handoff/PR | ทั้ง 8 rules เป็น evidence_first; muted row ยังถูกวัดผล |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` และการเปิด `telegram_enabled` | ต้องมีเฉพาะเมื่ออยาก **รับข้อความ Telegram**; ไม่จำเป็นต่อการบันทึก signal | ตั้ง secret และเปิด rule ที่ผ่านหลักฐาน; ไม่ต้อง merge เว็บ | มีอยู่เดิม; `setup_stability` เป็น gate เพิ่มอีกชั้น ไม่ใช่ permission ให้ v2 model |
| migration schema ที่ code ใหม่จำเป็นต้องอ่าน/เขียน | ต้องมีเมื่อ logic ต้องพึ่ง table/column/view/function ใหม่นั้น | apply migration ก่อน/พร้อม deploy ที่อ้างถึงมัน และตรวจ query | ถึง **0031 production แล้ว**: เพิ่ม cross-asset policy, suppression reason, exit bar และ chart annotations contract |
| `outcome-notify`/outcome evaluator | ไม่จำเป็นต่อการ **ส่ง signal แรก** แต่จำเป็นต่อการปิดผลและวัดว่า signal ใช้ได้จริง | deploy Edge Function เฉพาะเมื่อแก้ notification; scorer SQL เปลี่ยนต้องผ่าน migration | `outcome-notify` v5 ไม่ถูกแก้; `evaluate_pending_outcomes()` ใหม่บันทึก path audit |
| `backtest` | ไม่จำเป็นต่อ signal สด | deploy เฉพาะเมื่อแก้ตัวรันการทดลอง; ห้ามมี Telegram import | **v7 production แล้ว**; mirror stop-first + ambiguous_path ของ scorer |
| Vercel `web`/Dashboard | **ไม่จำเป็น** ต่อ signal หรือ Telegram | merge branch เข้า production branch เพื่อให้ Vercel deploy หน้า UI; ตรวจเว็บหลัง deploy | Source UI งานถึง PR #51 merge แล้ว; visual production รอบล่าสุดยังไม่ตรวจซ้ำ |
| Confidence v2 model/filter | **ไม่จำเป็น และยังห้ามใช้** | cohort → offline model → shadow prediction → forward evidence → owner approval | 436 captured / 431 resolved / 16 cohorts, แต่ยัง `score:null` และยังไม่มี calibrated model |
| Handoff, PR, README/เอกสาร | ไม่จำเป็นต่อ runtime แต่ **บังคับสำหรับงานถือว่าจบ** | push/merge เพื่อ audit และส่งต่องาน | Canonical status อยู่ §0D; การแก้ Handoff รอบนี้ต้องเปิด PR/merge จึงจะเห็นข้ามเครื่อง |

#### สรุปการตัดสินใจแบบเร็ว

- **วันนี้ต้องการให้ signal เดิมเข้าระบบและ Telegram ต่อ:** `ingest v17` Active และ logic พร้อมแล้ว
  แต่ต้องทำให้ ATAS/bridge กลับมาส่ง feed ก่อน; Dashboard ไม่กระทบเส้นทางนี้.
- **ต้องการเพิ่มหรือแก้ logic ของ rule:** ต้องทำทั้ง Git commit/push **และ** deploy `ingest`
  ที่ bundle dependency ครบ; migration เพิ่มเฉพาะเมื่อ schema ใหม่จำเป็น. จากนั้นตรวจ 3 ชั้นก่อน
  เปิด Telegram.
- **ต้องการดู Dashboard v2:** source merge แล้ว; เปิด production ตรวจ visual ได้เลย. เปิด PR ใหม่
  เฉพาะเมื่อมี code/docs เปลี่ยนเพิ่ม; เป็นงาน visibility/audit ไม่ได้เปิดสัญญาณ.
- **ต้องการพิสูจน์คุณภาพหรือสร้าง confidence:** ยังไม่ deploy model/filter; รอ outcome ของ
  snapshot ที่กำลังเก็บ แล้วเดินตาม §5.20.

---

## 6. ค่า params ปัจจุบัน (แก้ได้ที่ `/rules` ไม่ต้อง deploy)

ทุกกฎมีชุดนี้เหมือนกัน:

```json
{
  "bufferTicks": 2, "minRiskTicks": 4, "rewardRatio": 3,
  "trailAfterR": 0.5, "trailOffsetR": 0.25,
  "minVolumeRatio": 1.2, "minVolumeHistory": 10,
  "minRiskRangeShare": 0.3, "minRiskRangeBars": 20
}
```

`pullbackShare: 0` = ปิดอยู่ **และเปิดจากหน้านี้เฉย ๆ ไม่ได้** — ดูข้อ 5.13

`rewardRatio: 3` ตั้งแต่ 2026-08-30 (migration 0019 — เดิม 2) เหตุผลอยู่ในข้อ 5.6
`minDeltaMagnitude: 200` ตั้งแต่ 2026-08-30 (migration 0021 — เดิม 100) เหตุผลอยู่ในข้อ 5.11

`minRiskRangeShare` คือพื้นความเสี่ยงขั้นต่ำ คิดเป็น**สัดส่วนของ median range 20 แท่งก่อนหน้า**
มันมาแทนบทบาทของ `minRiskTicks` ในทางปฏิบัติ (ตัวไหนกว้างกว่าใช้ตัวนั้น) — ดูข้อ 5.4

เฉพาะกฎ:

| กฎ | params เฉพาะตัว |
|---|---|
| `stacked_imbalance` | `ratio: 3`, `minVolume: 10`, `stack: 3` |
| `delta_divergence` | `lookback: 5`, `minDeltaMagnitude: **200**` |
| `absorption` | `volumeMultiple: 3`, `edgeTicks: 2`, `rejectionTicks: 2` |
| `poc_shift` 🔊 | `minTicks: 8`, `consecutive: 3`, `hvnShare: 0.25` |
| `delta_flip` 🔊 | `runBars: 3`, `minDeltaMagnitude: 200`, `minRunDelta: 0`, `levelShare: 0.25`, `levelLookback: 20` |
| `lvn` 🔇 | `maxShare: 0.25`, `interiorShare: 0.8`, `minLevels: 8` |
| `naked_poc` 🔊 | `lookbackBars: 40`, `minAgeBars: 5` |
| `speed_of_tape` 🔊 | `rateHistory: 10`, `minRateRatio: 2`, `edgeShare: 0.3` |

สถานะ query 2026-09-02 01:55 UTC: ทั้ง 8 rules `enabled=true` และเป็น `evidence_first`;
`telegram_enabled=true` ทุกกฎยกเว้น `lvn`. 🔊 จึงหมายถึง “ผ่าน master switch” เท่านั้น —
cell ที่หลักฐานไม่ผ่านยังถูก mute. กฎใหม่ถูกกวาดค่าแล้วตาม §5.18 และไม่มี threshold ใหม่ผ่านเกณฑ์;
อย่าใช้สถานะสวิตช์เป็นหลักฐานว่ากฎมี edge.

---

## 7. งานที่ค้างอยู่

### 7.1 ต้องให้เจ้าของทำเอง (ผมไม่มีสิทธิ์เข้าถึง ไม่ใช่เรื่องการอนุญาต)

> สถานะรายการนี้ยังไม่ได้ตรวจ dashboard/account ซ้ำในวันที่ 2026-09-02. ให้ถือเป็น
> **checklist ที่ต้องยืนยัน** ไม่ใช่ข้อสรุปว่าทุกข้อยังเสียหรือแก้เสร็จแล้ว.

| # | งาน | ทำไมผมทำไม่ได้ |
|---|---|---|
| 1 | กรอก Endpoint URL + Ingest token ในหน้า ATAS | GUI บนเครื่อง Windows |
| 2 | Supabase Auth → **Site URL** = `https://atas-signal-board.vercel.app` และเพิ่ม **Redirect URL** `https://atas-signal-board.vercel.app/**` | Supabase MCP ไม่มีเครื่องมือแก้ auth config (ตรวจแล้ว) |
| 3 | Email template (Magic Link + Confirm signup) เติม `<p>รหัส: <strong>{{ .Token }}</strong></p>` | เหตุผลเดียวกับข้อ 2 |
| 4 | Revoke Telegram bot token เก่า (`8549812393:...` หลุดในแชต) ที่ @BotFather แล้วใส่ตัวใหม่ใน Supabase | ต้องใช้บัญชี Telegram ของเจ้าของ |
| 5 | ปิด "Allow new users to sign up" หลังสร้างบัญชี dashboard | Supabase dashboard |

หลักฐานเดิมของข้อ 2–3 คือ redirect เคยกลับ `http://localhost:3000/` แทน
`.../auth/callback`; ต้องทดสอบ login ใหม่ก่อนใช้คำว่า “ยังเสียอยู่”.

### 7.2 งานโค้ดที่ค้าง

| # | งาน | สถานะ |
|---|---|---|
| A | **`minRiskTicks` ไม่ scale ตาม instrument** | ✅ **เสร็จแล้ว** (migration 0010 + ingest v9) — ดูข้อ 5.4 |
| B | วัดผล price action flags | รอข้อมูล 3–5 วัน — **ไม่ต้องจำแล้ว** `price_action_edge` วัดให้ตลอด (ข้อ 8.1) |
| C | ตัดสินชะตา `poc_shift` | รอข้อมูลเพิ่ม |
| D | วัดซ้ำว่า `minRiskRangeShare` ควรเป็น 0.30 หรือ 0.60 | ✅ **เสร็จแล้ว** — วัดด้วยตัวรันจริง คำตอบคือ **0.30** (ข้อ 5.11) |
| E | **ขยับ `rewardRatio` 2.0 → 3.0** | ✅ **เสร็จแล้ว** (migration 0019, 2026-08-30) — ดูข้อ 5.6 |
| F | ตัดสินชะตา MNQU6 | รอ MNQ อีก 2 เซสชัน (ข้อ 5.8) |
| G | **วัด pullback entry** | ✅ **เสร็จแล้ว** — วัดครบ 8 แบบ **ผลคือไม่รับ** (ข้อ 5.13) |
| H | **deploy `backtest` ให้ drawdown ทำงานจริง** | ✅ **เสร็จแล้ว** — v3, `max_drawdown_r` ไม่เป็น null แล้ว |
| I | **deploy `ingest` + `backtest` ให้กฎใหม่ 3 ตัวทำงาน** | ✅ **เสร็จแล้ว** 2026-08-31 — migration 0027 รันแล้ว · `ingest` v13 · `backtest` v4 · ตรวจครบ 3 ชั้นตามข้อ 7.4 |
| J | **ตัดสินว่ากฎใหม่ตัวไหนควรเปิดเสียง** | ค้างอยู่ — query ล่าสุดพบทุกกฎเปิด Telegram ยกเว้น `lvn`, แต่ Evidence-first ยัง mute cell ที่ไม่ผ่าน. ต้องตัดสินจาก §5.17/§5.18 ไม่ใช่จากสวิตช์ และบันทึก owner approval หากเปลี่ยน policy |
| K | **อธิบายว่าทำไม `0.25/0.0625` กับ `0.25/0.03125` ให้ผลเหมือนกันทุกหลัก** | ค้างอยู่ — ไม่ใช่ rounding (ตรวจแล้ว) ต้องรัน `simulate()` ในเครื่องบนบาร์ชุดเดียวกันแล้วไล่ดู `stop_level` ทีละแท่ง **ห้ามรับค่า trail ละเอียดใด ๆ ก่อนตอบข้อนี้** (ข้อ 5.4c) |
| L | **ตรวจ deploy ชั้น 3 ของ `ingest` v14** | ✅ **ผ่านแล้ว 2026-09-01** — feed กลับมา 23:54 · 31 แถวหลัง deploy · error 1 แถวเดียวคือ `JWT issued at future` (ข้อ 3.12 ไม่ใช่ของใหม่) และ NQU6 ส่งสำเร็จต่อทันที 10 แถวรวด · `speed_of_tape` ยิงจริง **15 สัญญาณ ประกาศ 0** = การปิดเสียงพิสูจน์แล้วด้วยสัญญาณจริง ไม่ใช่ผ่านแบบว่างเปล่า |
| M | **ตัดสินชะตา `speed_of_tape`** | **ยังค้าง** — กวาดครบสามพารามิเตอร์และฝั่ง long ติดลบทั้ง 9 ค่าที่วัด (ข้อ 5.18), แต่ query ล่าสุดพบ `telegram_enabled=true`. Evidence-first ลดความเสี่ยงการประกาศแต่ไม่ใช่คำตอบเรื่อง edge; ต้องมี owner decision ว่าปิด long/ทั้งกฎหรือเก็บ shadow |
| O1 | **ทำให้ `backtest` เขียนผลและสถานะทีละ variant** | ค้างอยู่ · **P1** — ตอนนี้สะสมทุกแถวแล้ว insert ทีเดียวตอนจบ พอ worker ถูกฆ่ากลางทาง **ผลที่รันเสร็จแล้วหายหมด และแถว `experiments` ค้างที่ `running` ตลอดกาล** (ข้อ 3.11) · **กำลังเกิดอยู่จริงตอนนี้:** `standing sweep 2026-09-02` (`96de5127-e16f-40e1-b547-8a56775097eb`) ค้าง `running` โดยมี 0 แถวตั้งแต่ 2026-09-01 21:00 UTC และ `/experiments` แสดงว่ากำลังรัน — ปิดแถวนั้นด้วยมือระหว่างรอ |
| O2 | **เก็บ per-opportunity artifact ต่อ variant** | ค้างอยู่ — ต้องมี stable candidate key, variant, included/excluded **พร้อมเหตุผล**, R, outcome, instrument และ data/evaluator version · **`signal_id` อย่างเดียวไม่พอ** และการจับคู่เฉพาะไม้ที่ซ้ำกันสร้าง selection bias ใหม่ (ข้อ 5.18a) · **เป็นเงื่อนไขก่อนที่ใครจะอ้างว่าความต่างระหว่าง variant มีนัยสำคัญได้อีก** — ดู §5.21 gate ข้อ 5 (block bootstrap ตาม session × instrument) |
| P | **ทำ Confidence v2 ให้มีความหมาย** | กำลังทำ — migration 0029 และ snapshot อยู่ production ตั้งแต่ v15, ปัจจุบัน `ingest v17`; มี 436 captured / 431 resolved / 16 cohorts. ยังต้อง offline calibration + frozen model + forward shadow + owner approval; `score:null` และห้ามใช้กรอง |
| N | **ยืนยันความหมายของ `bars.ticks` กับเอกสาร ATAS** | ค้างอยู่ — ข้อมูลชี้ชัดว่าเป็นจำนวนไม้ (`volume ÷ ticks` ≈ 1.1 สัญญา) แต่ยังไม่ได้ยืนยันกับ docs · ถ้าผิด `speed_of_tape` ทั้งกฎต้องรื้อ (ข้อ 5.16) |
| Q | **Independent raw re-run ของตัวเลข §5.18a** | ค้างอยู่ · **P1 ก่อนเปลี่ยน threshold/rule** — ผู้ตรวจที่ไม่ใช่ผู้เสนอ/ผู้รันต้องใช้ evidence packet, exact experiment IDs, frozen data window และ query commit รัน artifact ดิบซ้ำ. จนกว่าจะเสร็จ ตัวเลขและข้อเสนอทั้งหมดใน §5.18a เป็น `provisional`; คง runtime เดิมและห้ามนำไปเปิด/ปิด Telegram |

**ข้อ A ทำอะไรไป:** เพิ่ม param `minRiskRangeShare` (0.3) กับ `minRiskRangeBars` (20)
ใน `plan.ts` มี `volatilityFloorTicks()` คำนวณพื้นความเสี่ยงจาก median range ของแท่งก่อนหน้า
แล้ว `buildPlan()` เลือกค่ามากสุดระหว่าง (ระยะจากแท่ง + buffer) / `minRiskTicks` / พื้นจาก range
`ingest.ts` ส่ง `history` ชุดเดียวกับที่กฎใช้เข้าไปด้วย — เหตุผลและตัวเลขทั้งหมดอยู่ในข้อ 5.4

ถ้าประวัติสั้นกว่า `minRiskRangeBars` จะ**ไม่**ใช้พื้นนี้ (ตกกลับไปใช้ `minRiskTicks` เหมือนเดิม)
เพราะ median จาก 3 แท่งไม่ได้บอกว่า "ปกติ" ของ instrument นี้คืออะไร — วิธีเดียวกับ liquidity gate

**ข้อ D ทำยังไง:** รันสคริปต์จำลองใน §8.4 อีกครั้งเมื่อมีข้อมูลมากขึ้น ถ้า 0.55–0.65 ยังชนะ
*และชนะทั้งสอง instrument* ค่อยขยับ — แก้ที่ `/rules` ได้เลยไม่ต้อง deploy

### 7.3 กับดัก `outcome-notify` — ✅ แก้แล้ว 2026-08-30

เคยเป็น **version 3** ที่ bundle โค้ด `_shared/telegram.ts` และ `_shared/outcomes.ts` **ตัวเก่า**
ถ้าใครไปเรียกมันจะได้ฟอร์แมตเก่า (ticks ล้วน ไม่มี `#S<seq>` ไม่มีเวลาไทย) ซึ่งผิดข้อห้าม #10
ณ snapshot นั้น redeploy เป็น **version 4**; ปัจจุบัน Supabase แสดง `outcome-notify` **v5 Active**

ยังไม่มีอะไรเรียกมันเหมือนเดิม (`ingest` เรียก `flushOutcomeNotifications()` ในโปรเซสตัวเอง ·
pg_cron ไม่ได้ชี้มา) มันคือ endpoint สำรองสำหรับช่วงที่ชาร์ตปิด หรือสั่งมือ

**ไฟล์ที่ต้องอัปโหลดของ `outcome-notify` คือ 3 ไฟล์ ไม่ใช่ 12** — `telegram.ts` ไม่ import
อะไรเลย: `outcome-notify/index.ts`, `_shared/outcomes.ts`, `_shared/telegram.ts`
ตั้ง `verify_jwt: false` ให้เหมือนเดิมด้วย (มันเช็ก `INGEST_TOKEN` เอง)

ตรวจว่า deploy ติดจริงโดยยิง token มั่ว ๆ ต้องได้ `401 {"error":"unauthorized"}` —
ถ้า bundle พังจะได้ boot error แทน ไม่ใช่ 401

การ deploy edge function ผ่าน MCP ต้องอัปโหลด **ทุกไฟล์ที่ import ถึง** ทุกครั้ง (มันแทนที่ทั้งชุด
ไม่ใช่ patch) สำหรับ `backtest` คือ 12 ไฟล์ ~68KB — เผื่อ token ไว้ด้วย

---

### 7.4 ประวัติการ deploy `ingest` และวิธี deploy ครั้งหน้า (ปัจจุบัน v17)

เคยเลื่อนจาก repo อยู่พักหนึ่งโดยตั้งใจ (ตอนนั้นต่างกันแค่ `pullbackShare` ที่ค่าเริ่มต้น 0
ผลลัพธ์เหมือนเดิมทุกตัวอักษร จึงไม่คุ้มเสี่ยง) **รอบนี้ต้อง deploy จริง** เพราะ `outcomes.ts`
เปลี่ยนพฤติกรรมของเส้นทางสด — เป็นตัวแก้สัญญาณส่งซ้ำ (ข้อ 3.16)

**16 ไฟล์ของ `ingest`** (ต้องอัปโหลดครบทุกครั้ง MCP แทนที่ทั้งชุด ไม่ใช่ patch):

```
ingest/index.ts
_shared/{types,util,ingest,outcomes,telegram,evidence,plan,overrides,liquidity,price_action}.ts
_shared/rules/{index,stacked_imbalance,delta_divergence,absorption,poc_shift}.ts
```

**3 ไฟล์ของ `outcome-notify`:** `outcome-notify/index.ts`, `_shared/outcomes.ts`, `_shared/telegram.ts`

`verify_jwt: false` ทั้งคู่ (เช็ก `INGEST_TOKEN` เอง)

**อัปเดต 2026-08-31 — `ingest` v13 / `backtest` v4 (กฎใหม่ 3 ตัว):**

จำนวนไฟล์เปลี่ยนแล้ว **`ingest` เป็น 19 ไฟล์** (เพิ่ม `rules/{delta_flip,lvn,naked_poc}.ts`)
และ **`backtest` เป็น 15 ไฟล์** = `backtest/index.ts` · `_shared/{backtest,types,util,liquidity,plan,price_action}.ts` ·
`_shared/rules/` ครบ 7 กฎ + `index.ts`
**`backtest` ไม่มี `telegram.ts` / `evidence.ts` / `outcomes.ts` / `ingest.ts` และห้ามมี** —
นั่นคือรูปธรรมของข้อห้าม #15 ตัวรันการทดลองแยกจากทาง Telegram ด้วย*สิ่งที่มันโหลด* ไม่ใช่ด้วย flag

⚠️ **ข้อควรรู้: source ที่ deploy ไม่เท่ากับ repo แบบตัวต่อตัว** MCP รับไฟล์ทั้งชุดในคำสั่งเดียว
ซึ่งใหญ่เกินกว่าจะใส่คอมเมนต์ยาว ๆ ครบ **โค้ดที่รันเหมือนกันทุกบรรทัด แต่คอมเมนต์อธิบาย
ในไฟล์ `_shared/` ถูกย่อ** ตอน upload — เหตุผลเชิงลึก (ตาราง measurement ใน `plan.ts`,
`liquidity.ts`, ที่มาของ 0.30) อยู่ครบใน repo เท่านั้น **repo คือ source of truth เสมอ**
ถ้าจะให้ตรงกันเป๊ะต้อง upload ใหม่ด้วยไฟล์เต็มทีละ function

**บทเรียนจากรอบนี้:** upload ไฟล์ไม่ครบ → bundler ตอบ `Module not found` **และ deploy ไม่ติดเลย**
(v12 ยังอยู่เหมือนเดิม) การอัปโหลดเป็น atomic ดังนั้นความผิดพลาดแบบนี้ปลอดภัย ไม่ทำของพัง

**ตรวจว่า deploy ติดจริง 3 ชั้น:**

1. ยิง token มั่ว → ต้องได้ `401 {"error":"unauthorized"}` (bundle พังจะได้ boot error ไม่ใช่ 401)
2. ยิง `GET` → ต้องได้ `405` (พิสูจน์ว่า handler ทำงาน ไม่ได้ตายตอน import)
3. **ของจริง** — `select error, received_at from ingest_log order by received_at desc limit 5`
   ต้องเป็น `null` หมดหลังเวลาที่ deploy · **นี่คือชั้นเดียวที่พิสูจน์ว่าเส้นทางสดยังทำงาน**

**ผลตรวจรอบ 2026-08-31 (v13 ขึ้น 09:10:31Z · v4 ขึ้น 09:16:18Z):** ชั้น 1 ได้ 405 · ชั้น 2 ได้ 401 ·
ชั้น 3 GC/NQU6/MNQU6 ยิงเข้าที่ 09:15 และ 09:20 **`error` เป็น null ทุกแถว**
เพิ่มอีกชั้นที่ทำได้เพราะมีตัวรัน: สั่ง backtest จาก SQL แล้ว **กฎใหม่ทั้งสามมีไม้จริง**
(ดูตัวเลขในข้อ 5.15) — ชั้นนี้พิสูจน์ว่า evaluator ที่ deploy ไปทำงาน ไม่ใช่แค่ import ผ่าน

**อัปเดต 2026-08-31 — `ingest` v14 / `backtest` v5 (`speed_of_tape` + `ticks`):**
จำนวนไฟล์ขยับอีกครั้ง **`ingest` = 20 ไฟล์** · **`backtest` = 16 ไฟล์** (เพิ่ม
`rules/speed_of_tape.ts` ทั้งคู่) เงื่อนไข "backtest ต้องไม่มี `telegram.ts` / `evidence.ts` /
`outcomes.ts` / `ingest.ts`" ยังคงเดิมและยังจริง

⚠️ **แก้ตัวเลข (2026-09-01):** ชุดที่ **เก็บอยู่จริง** ของ `backtest` คือ **15 ไฟล์ ไม่ใช่ 16** —
`get_edge_function` คืนมา 15 และไม่มี `_shared/types.ts` เพราะทุกจุดที่ import มัน
ใช้ `import type` ล้วน TypeScript จึงลบทิ้งตอน compile และ bundler ไม่เคยต้องใช้ไฟล์นั้น
**ส่งขึ้นไปด้วยก็ไม่เสียหาย** (ทำแบบนั้นใน v6) แต่อย่าตกใจถ้านับได้ 15
`ingest` ไม่ได้ตรวจซ้ำ อาจเหลือ 19 ด้วยเหตุผลเดียวกัน

**อัปเดต 2026-09-01 — `backtest` v6 (แถวสรุปราย instrument × กฎ × ทิศ):**
`resultRows()` เพิ่ม breakdown ที่สี่ เพื่อให้กวาดค่าระดับกฎแล้วตอบข้อห้าม #18 ได้
(เหตุผลเต็มอยู่ในข้อ 8.6) ชั้น 1 ได้ **405** · ชั้น 2 ได้ **401**
**เทียบโค้ดที่ deploy กับ repo แล้ว** (ตัดคอมเมนต์ออกแล้ว diff) ต่างกัน**เฉพาะ loop ใหม่**
ไม่มีความต่างอื่น — ยืนยันว่าคำเตือน "source ที่ deploy ไม่เท่ากับ repo" ข้างบน
เป็นเรื่องคอมเมนต์ล้วน ไม่ใช่โค้ด

**ผลตรวจรอบนี้ (deploy 23:11:57Z):** ชั้น 1 ได้ 405 · ชั้น 2 ได้ 401 ·
ชั้นเสริมผ่าน — backtest `deploy check 0028` ยืนยันว่า `speed_of_tape` มีไม้จริงและ
**กฎเดิมทั้ง 7 ตัวเลขไม่ขยับสักหลัก** (ข้อ 5.16)
**ชั้น 3 — ✅ ผ่านแล้ว 2026-09-01** (ตอนแรกตรวจไม่ได้เพราะ feed หยุดที่ 22:50
ซึ่งอยู่**ก่อน** deploy 23:11:57 · feed กลับมา 23:54 แล้วจึงตรวจได้)
**31 แถวหลัง deploy · error แถวเดียว** คือ `JWT issued at future` ของ NQU6 ตอน 00:30
ซึ่งเป็นข้อ 3.12 ไม่ใช่ของใหม่ และ NQU6 ส่งสำเร็จต่อทันทีอีก 10 แถวรวด
`speed_of_tape` **ยิงจริง 15 สัญญาณ ประกาศ 0** — การปิดเสียงจึงพิสูจน์แล้วด้วยสัญญาณจริง
ไม่ใช่ผ่านเพราะไม่มีสัญญาณ

---

### 7.5 เข้าเว็บ — รหัสผ่านเป็นทางหลัก ลิงก์อีเมลถูกถอดออก

ลิงก์ในอีเมลเป็นทางเลือกที่ผิดสำหรับคนเดียวที่เปิดจากมือถือ: มันใช้ได้เฉพาะในเบราว์เซอร์ที่ขอลิงก์
และจะกลับมาที่เว็บได้ก็ต่อเมื่อ URL นั้นอยู่ใน Supabase redirect allow-list — ซึ่ง **preview URL
ไม่มีทางอยู่** เพราะเปลี่ยนทุก branch พังสองแบบนี้หน้าตาเหมือนกันหมดจากฝั่งคนใช้

ตอนนี้:
- **หลัก:** อีเมล + รหัสผ่าน (`autoComplete="current-password"` เพื่อให้ keychain มือถือกรอกให้)
- **สำรอง:** รหัส 6 หลักทางอีเมล — เก็บไว้เพราะต้องใช้เข้าครั้งแรกก่อนจะมีรหัสผ่าน และเผื่อลืมรหัส
- **ถอดออก:** ลิงก์ในอีเมล — ไม่เคยเป็นทางที่เชื่อถือได้ และการมีสามทางทำให้หาทางที่ใช้ได้จริงยากขึ้น

**ตั้งรหัสผ่านที่หน้า `/account`** — ต้องมี session ก่อนถึงตั้งได้ ลำดับจึงเป็น
รหัส 6 หลักครั้งเดียว → ตั้งรหัสผ่าน → จากนั้นใช้รหัสผ่านตลอด
หน้านี้มีปุ่มออกจากระบบด้วย ซึ่งเดิมไม่มีที่อยู่เลย

`signInWithOtp` ตั้ง `shouldCreateUser: false` — พิมพ์อีเมลผิดจะได้ error ตรง ๆ
แทนที่จะสร้างบัญชีที่สองเงียบ ๆ ที่มองไม่เห็นอะไรเลย แล้วอ่านว่า "รหัสไม่มา"

---

## 8. ขั้นตอนถัดไป

### 8.1 วัดผล price action flags — ✅ วัดให้ตลอดแล้ว ไม่ต้องรอใครมารัน

```sql
select * from public.price_action_edge order by trades desc;
```

หรือดูบนหน้า `/stats` · เดิมข้อนี้เป็นคิวรีดิบที่ต้องจำว่า "กลับมารันเมื่อมีข้อมูล 3–5 วัน"
ตอนนี้เป็น view แล้ว

**กติกา (อยู่ในคอลัมน์ `verdict` ของ view เอง):** ช่องไหนแยกตัวชัด *และ* มีจำนวนไม้พอ →
เลื่อนขึ้นเป็นตัวกรอง โดยย้ายเกณฑ์ไป `rules.params` ถ้าไม่ต่าง → ลบทิ้งได้โดยไม่เสียอะไร
**นี่คือวิธีเดียวกับที่ตัดสิน volume filter มา**

| verdict | แปลว่า |
|---|---|
| `need more trades` | < 30 ไม้ — **ยังตอบไม่ได้** ไม่ใช่ตอบแล้วว่าแย่ |
| `need more sessions` | < 3 เซสชัน — เซสชันเดียวพลิกกลับข้างได้ (ข้อ 5.5) |
| `separates` | ต่างจากค่าเฉลี่ยทุกช่อง ≥ 0.25 R/ไม้ → คุ้มจะเลื่อนเป็นตัวกรอง |
| `no different` | ไม่ต่าง → ลบ flag นี้ทิ้งได้ |

เกณฑ์ 0.25 R/ไม้ **เป็นเส้นที่ตั้งเอง ไม่ใช่เส้นที่ค้นพบ** — ตั้งเทียบกับค่าเฉลี่ยของไม้ที่มี
priceAction ทั้งหมด (`overall_r_per_trade`, ตอนนี้ 0.247) ช่องที่ผ่านเกณฑ์นี้คือช่องที่
**เกือบเท่าตัวหรือกลบค่าเฉลี่ยทิ้ง** ไม่ใช่แค่แกว่ง

สถานะตอนนี้: **ยังไม่มีช่องไหนอ่านผลได้** ช่องใหญ่สุดคือ `zone=discount` short 37 ไม้
(0.435 R/ไม้ เทียบค่าเฉลี่ย 0.247) แต่ยังมีแค่ 2 เซสชัน · หน้า `/stats` ซ่อนช่องที่มีไม้ < 5
แต่**บอกจำนวนที่ซ่อนไว้** — การหายไปต้องมีคำอธิบายเสมอ (เหตุผลเดียวกับข้อ 3.7)

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

**เหตุผลที่สองเพิ่งวัดได้จริง (2026-08-31, ข้อ 5.4c):** การกวาด trail ชนเพดานของ*ความละเอียด
ข้อมูล* ไม่ใช่เพดานของกลยุทธ์ — ค่า trail ที่ดีที่สุดในทุกการทดลองแน่นกว่า 1 tick ซึ่งตัวจำลอง
ระดับแท่งตอบไม่ได้ว่าจริงหรือเป็นภาพลวง **นี่คือคำถามที่ตอบได้ด้วยข้อมูลละเอียดกว่าเท่านั้น**
และเป็นครั้งแรกที่มีตัวเลขชี้ว่าข้อมูลระดับแท่ง 5m กำลังจำกัดการตัดสินใจอยู่จริง ๆ

### 8.5 กฎ prop trading ที่เหลือ — และเกณฑ์ที่ใช้ตัดสินสามตัวแรกก่อน

**ก่อนอื่น: หยุดเพิ่มกฎ — ตอนนี้มีกฎเงียบ 4 ตัวแล้ว** (`delta_flip` · `lvn` · `naked_poc` ·
`speed_of_tape`) ยังไม่มีตัวไหนมีสัญญาณสดพอจะตัดสิน ถ้าเขียนต่อไปเรื่อย ๆ จะได้กฎ 10 ตัว
ที่ไม่มีตัวไหนพิสูจน์ได้ ซึ่งแย่กว่ามี 4 ตัวที่รู้จัก **ตัวถัดไปรอจนกว่าจะตัดสินตัวใดตัวหนึ่งใน 4 นี้ได้**
(ตัวที่ 4 ในตารางล่าง — Speed of Tape — เขียนไปแล้วหลังบรรทัดนี้ถูกเขียน เหตุผลและตัวเลขอยู่ข้อ 5.16
และตัวเลขชุดแรกของมันคือเหตุผลที่ย่อหน้านี้เข้มขึ้นกว่าเดิม)

**เปิดเสียงตัวไหนเมื่อไร** — ดูจาก `/stats` หรือคิวรีตรงบน `signal_outcomes` แยกตาม
`rule_key` × `direction` (แยกทิศทางเสมอ เหตุผลอยู่ในข้อ 5.5 — `poc_shift` short กับ long
เกือบเป็นภาพสะท้อนกัน) เกณฑ์เดียวกับที่ใช้มาตลอด ไม่ใช่เกณฑ์ใหม่:

1. **ต้องมีไม้พอ** — ข้อห้าม #11 อยู่แล้ว เซลล์ที่ยังไม่ผ่าน `setup_stability` อ่านไม่ได้
2. **อ่าน R ต่อไม้ ไม่ใช่ R รวม** (ข้อห้าม #13) กฎใหม่ยิงถี่กว่าอาจได้ R รวมสูงทั้งที่ทุกไม้แย่ลง
3. **ดู drawdown ด้วย** (ข้อห้าม #17b)
4. **ต้องไม่มี instrument ไหนแย่ลง** (ข้อห้าม #18) — ถ้าดีเฉพาะ BTCUSDT ให้ใช้
   `rule_overrides` ปิดเฉพาะตัวที่แย่ แทนที่จะเปิดทั้งกฎ

เปิดแล้วแก้ที่ `/rules` → `telegram_enabled` ทีละตัว **ไม่ต้อง deploy** และถ้าเปิดแล้วไม่ดี
ปิดกลับได้ทันทีโดยแถวเดิมยังถูกเก็บและให้คะแนนต่อ

**ตัวถัดไปในลิสต์ และสิ่งที่แต่ละตัวติดอยู่จริง ๆ:**

| # | กฎ | data source | ติดอะไร |
|---|---|---|---|
| 4 | Large / Block Trades | Time & Sales | **มี proxy แล้ว ยังไม่มีของจริง** — `volume / ticks` = ขนาดไม้เฉลี่ยต่อบาร์ คำนวณได้วันนี้ และ `speed_of_tape` บันทึกลง payload ทุกสัญญาณแล้ว (ข้อ 5.16) แต่ค่าเฉลี่ยแยกไม้ยักษ์ 1 ไม้ออกจากไม้กลาง ๆ ทั้งบาร์ไม่ได้ ของจริงยังต้องแก้ indicator ให้ส่ง trade รายตัวหรือ histogram ของ size · **หมายเหตุ: `bars.trades` เป็น 0 ทุกแถว ใช้ไม่ได้** |
| 5 | CVD Divergence ข้าม session | delta เดิม | **column `bars.cum_delta` มี แต่ไม่มีใครเติม** — `Dto.cs` ไม่มีฟิลด์นี้เลย indicator จึงไม่เคยส่ง ค่าเป็น null ทุกแถว ต้องแก้ indicator = build DLL ใหม่ + ขยับ REV (ข้อ 3.8) |
| 6 | Speed of Tape | `bars.ticks` | ✅ **ทำแล้ว** (migration 0028 · ข้อ 5.16) — ข้อความเดิมตรงนี้ผิด: ใช้ `bars.trades` ไม่ได้เพราะเป็น 0 ทุกแถว ตัวที่มีข้อมูลจริงคือ `bars.ticks` **ตัวเลขชุดแรกไม่ดี** ฝั่ง long ติดลบและแย่ลงเมื่อขันเกลียว — อ่านข้อ 5.16 ก่อนคิดจะเปิดเสียง |
| 7 | Liquidity Sweep / Stop Run | bars เดิม | **มีอยู่แล้วครึ่งหนึ่ง** — `price_action.ts` คำนวณ `sweep` (wick ทะลุ swing แล้วปิดกลับ) และเก็บลงทุกสัญญาณมานานแล้ว ไม่ต้องเขียน swing detection ใหม่ ทำเป็นกฎคือหยิบ flag เดิมมาเป็นเงื่อนไข — ดูข้อ 5.14 |
| 8 | P-Shape / b-Shape | footprint เดิม | ต่อยอด `lvn` + `poc_shift` ได้ (รูปทรงคือ POC อยู่ปลายไหนของ profile) |
| 9 | Bid/Ask Imbalance ที่ DOM | **ต้องมี L2** | ตอบแล้วในข้อ 8.4: **ยังไม่ได้ต่อ Level 2 เลย** DxFeed ผ่าน ATAS ให้แต่ trade ที่เกิดแล้ว ต้องรอ REV-RITHMIC-001 |
| 10 | Iceberg / Reload | **ต้องมี L2** | เหมือนข้อ 9 — ต้องเห็น resting size ถึงจะรู้ว่ามีการเติม |

**ข้อ 9 กับ 10 ตอบได้เลยโดยไม่ต้องไปเช็ก:** ระบบนี้ไม่ได้ subscribe market depth ที่ไหนเลย
`ClusterLevel` มีแค่ ask/bid/between/volume/ticks ของ trade ที่เกิดแล้ว — ไม่มี resting order
สักตัวเดียวในฐานข้อมูล นั่นคือเหตุผลหลักของ 8.4 ไม่ใช่ของแถม

**POC รายวันจริง (ต่อยอด `naked_poc`):** ต้องมีตาราง profile ต่อ session —
รวม `cluster_levels` group by (instrument, วันเทรด, price) แล้วหา POC ของก้อนนั้น
ทำเป็น materialized view หรือ cron รายวันได้ แล้วส่งเข้า `RuleContext` เป็น field ใหม่
**อย่าแก้ด้วยการดัน `HISTORY_BARS`** — เหตุผลอยู่ในข้อ 5.15

---

### 8.6 กวาดค่า params ของกฎใหม่ — แผนที่กำลังทำอยู่ (อ่านหัวข้อนี้หัวข้อเดียวก็ทำต่อได้)

**สถานะ: เตรียมเสร็จแล้ว เหลือรันการทดลอง** เขียนหัวข้อนี้ก่อนลงมือ เพื่อให้เซสชันใหม่
ทำต่อได้โดยไม่ต้องไล่ประวัติเก่า

| ขั้น | งาน | สถานะ |
|---|---|---|
| 1 | เขียนหัวข้อนี้ | ✅ |
| 2 | loop ที่สี่ใน `resultRows()` | ✅ `deno task test` 132 ผ่าน · `check` · `rev:check` ✓ |
| 3 | deploy `backtest` | ✅ **v5 → v6** · ชั้น 1 ได้ 405 · ชั้น 2 ได้ 401 |
| 4 | รันการทดลอง | ✅ **เสร็จแล้ว** — แต่ต้องแตกเป็น 7 รันเพราะชน CPU limit (ข้อ **3.11**) |
| 5 | เขียนผล | ✅ **ข้อ 5.18** — ไม่รับค่าใดเลย · `speed_of_tape` ฝั่ง long ควรถูกปิด |

**หัวข้อนี้ปิดแล้ว** ผลอยู่ที่ **§5.18** · เรื่อง confidence ที่ทำคู่กันอยู่ที่ **§5.19** ·
ข้อจำกัดของตัวรันที่เจอระหว่างทางอยู่ที่ **§3.11**

**ทำไม:** ข้อ 5.11 กวาด threshold ของกฎเดิม 4 ตัวไปแล้ว (6 การทดลอง รับมาตัวเดียว)
**กฎใหม่ 4 ตัวยังไม่เคยถูกกวาดเลยสักค่า** — ค่าที่ใช้อยู่ทั้งหมดเป็นจุดตั้งต้น ไม่ใช่ค่าที่วัดมา
(§5.15 · §5.16 · §6 ประกาศไว้แบบนั้นเอง) ตรงกับคำสั่งเจ้าของ: *เน้นคุณภาพสัญญาณ
จากตัวกรองใหม่ที่ยังไม่ตัดสิน และเช็กว่าค่าของเดิมเหมาะสมไหม จาก backtest*

ผลลัพธ์ที่ยอมรับได้มีสามแบบ **และมีค่าเท่ากัน**: รับค่าใหม่ · วัดแล้วค่าเดิมถูก ·
ค่านี้ไม่มีผลอะไรเลย (บันทึกว่าอย่าจูนอีก เหมือน `poc_shift.minTicks` ในข้อ 5.11)

#### ตัวติดที่ต้องแก้ก่อน — `experiment_results` ไม่มีแถวราย instrument **รายกฎ**

`resultRows()` ใน `supabase/functions/backtest/index.ts` เขียนแถวสรุปสามแบบ:
`(null,null,null)` รวมทั้งหมด · `(symbol,null,null)` ราย instrument · `(null,rule,dir)` รายกฎ
**ไม่มี `(symbol,rule,dir)`** ฉะนั้น **ข้อห้าม #18 ตอบไม่ได้ในระดับกฎ**

ข้อ 5.11 เลี่ยงด้วยการอ่านตัวเลขรวมราย instrument ซึ่งใช้ได้ตอนนั้นเพราะกฎที่กวาดกิน
สัดส่วนใหญ่ แต่กับกฎใหม่มันเจือจางจนมองไม่เห็น — จาก `deploy check 0028` (2,398 ไม้):
`lvn` 272 ไม้ (11%) · `speed_of_tape` 244 (10%) · `naked_poc` 175 (7%) · `delta_flip` **24 (1%)**
ขยับ `delta_flip` แล้วดูตัวเลขรวมของ BTCUSDT = หาการเปลี่ยนแปลง 1% ในตัวเลขที่อีก 99% ไม่ขยับ

**วิธีแก้เล็กมาก (ทำแล้ว — commit `c7aab59`):** เพิ่ม loop ที่สี่ใน `resultRows()` ตามรูปแบบของสอง loop ที่มีอยู่แล้วเป๊ะ ๆ
(ใช้ helper `row()` / `unique()` ตัวเดิม) **ไม่ต้อง migration** — `symbol`/`rule_key`/`direction`
เป็น nullable อยู่แล้ว และ index เดียวคือ `(experiment_id, variant)` ไม่มี unique ให้ชน ·
**ไม่ต้องแก้เว็บ** — `ExperimentCard.tsx` กรอง `symbol === null && rule_key === null`
แถวใหม่ถูกมองข้ามเงียบ ๆ · แถวต่อ variant ~21 → ~85 · **deploy เฉพาะ `backtest`**

#### อย่ากวาด `delta_flip` — ยังไม่ถึงเวลา

24 ไม้ทั้งกฎ (12 ต่อทิศ) ฝั่งสด 12 ไม้ กวาดบนตัวอย่างขนาดนี้จะเห็นตัวเลขขยับจริง
**แต่ขยับเพราะไม้หายไป 2–3 ไม้ ไม่ใช่เพราะเกณฑ์ดีขึ้น** = ข้อห้าม #9 กับ #11 พร้อมกัน
รอจนถึง ~100 ไม้ในรัน (ตอนนี้ยิง ~1 สัญญาณ/ชม.)

#### สามรัน (`public.run_backtest` ตามข้อ 3.10 · `maxBars: 1000`)

| รัน | กฎ | ค่าที่กวาด (ค่าปัจจุบันในวงเล็บ) |
|---|---|---|
| 1 | `lvn` | `maxShare` 0.15 · 0.20 · 0.35 · 0.45 (0.25) · `interiorShare` 0.6 · 0.7 · 0.9 (0.8) · `minLevels` 12 (8) |
| 2 | `naked_poc` | `lookbackBars` 20 · 30 · 50 (40 · เพดานคือ `HISTORY_BARS` 50) · `minAgeBars` 2 · 3 · 10 · 15 (5) |
| 3 | `speed_of_tape` | `minRateRatio` 1.5 · 1.75 · 2.5 (2 · **3 วัดแล้ว = แย่ลง** ข้อ 5.16) · `edgeShare` 0.2 · 0.25 · 0.4 (0.3) · `rateHistory` 5 · 20 (10) |
| 4 | ตามผล | ยืนยันย้อนทางเฉพาะค่าที่ดูเหมือนมีจุดกลับตัว — แบบเดียวกับ `after adopting minDelta 200` |

#### เกณฑ์ตัดสิน — ยืมจากข้อ 5.11 ไม่คิดใหม่

1. **อ่าน R/ไม้ ไม่ใช่ R รวม** (#13) — threshold ของกฎเปลี่ยนว่า*ไม้ไหนเกิด* R รวมจึงอ่านไม่ได้
2. **ต้องมีจุดกลับตัว** (#14) · ที่ราบ (เพื่อนบ้านเท่ากันเป๊ะ) ดีกว่ายอดแหลม (เพื่อนบ้านต่ำกว่าทั้งคู่ = fit ข้อมูล #9)
3. **ดู drawdown ควบ** (#17b)
4. **ต้องไม่มี instrument ไหนแย่ลง** (#18) — **เหตุผลที่ต้องแก้โค้ดก่อน**
5. **เท่ากันให้เลือกตัวที่กรองน้อยที่สุด** (§5.4 · §5.11)

⚠️ **อัปเดต 2026-09-01 — ข้อจำกัดนี้ดีขึ้นแล้ว:** ตอนวางแผน MNQ/NQ/GC ตลาดปิด
แท่งค้างที่ 28 ส.ค. ด่าน #18 จึงจะตัดสินจากตัวอย่างบางฝั่ง futures **แต่ตลาดเปิดแล้ว**
ทั้งสามตัวส่งเข้าทุก 5 นาที ฉะนั้น**ยิ่งรันช้า ตัวอย่างฝั่ง futures ยิ่งหนา**
ตรงข้ามกับ BTCUSDT ที่เงียบตั้งแต่ 31 ส.ค. 22:50 — ถ้ารันตอนนี้ให้เช็กจำนวนแท่งต่อ
instrument จากผลลัพธ์ที่ตัวรันคืนมา (`feeds: [...]`) แล้วเขียนกำกับไว้ในตาราง §5.18

#### ตรวจอะไรบ้าง

- **แถวใหม่ถูก ไม่ใช่แค่มี** — ผลรวม `trades` / `total_r` ของแถว `(symbol,rule,dir)`
  ต้องเท่ากับแถว `(null,rule,dir)` เดิมทุกกฎ คิวรีเดียวจบ
- **ของเดิมไม่กระเทือน** — baseline ของรันใหม่ต้องเท่ากับ baseline ของ `deploy check 0028`
  ทุกแถว (ข้อมูลชุดเดิม โค้ดสรุปเปลี่ยน ผลต้องไม่เปลี่ยน)
- `/experiments` การ์ดต้องหน้าตาเดิม

**จบแล้วเขียนผลที่ §5.18** · แก้คำเตือนใน §5.16 ที่บอกว่า #18 ตอบไม่ได้ ·
อัปเดต §7.4 เวอร์ชัน · ปิดหรืออัปเดต §7.2 M ตามผลของ `speed_of_tape`

---

## 9. วิธีทำงานกับ repo นี้

```bash
# typecheck + test
# deno ไม่ได้ติดตั้งมากับคอนเทนเนอร์ ถ้า `deno: command not found` ให้ลงก่อน:
#   curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/opt/deno sh -s -- -y
export PATH=/opt/deno/bin:$PATH
deno task check
deno task test          # ก่อน change นี้ 124 ผ่าน; เพิ่ม confidence_v2_test.ts แล้ว ต้องรันใหม่ (คาด 125)
deno task rev:check     # fail ถ้าแก้โค้ดของส่วนไหนแล้วลืมขยับ REV (ดู 3.8)

# เว็บ
cd web && npm run build
```

**Deploy edge function:** ใช้ `mcp__Supabase__deploy_edge_function` ต้องส่ง **ทุกไฟล์**
ที่ `ingest/index.ts` import ถึง (โดย transitive) ไม่งั้นได้ 400 "Entrypoint path does not exist"

รายการไฟล์ของ `ingest` สำหรับ Confidence v2: `ingest/index.ts`, `_shared/{ingest,confidence_v2,plan,liquidity,price_action,telegram,outcomes,overrides,types,util,evidence}.ts`,
`_shared/rules/{index,stacked_imbalance,delta_divergence,absorption,poc_shift}.ts`

รายการไฟล์ของ `backtest`: `backtest/index.ts`, `_shared/{backtest,plan,liquidity,price_action,types,util}.ts`,
`_shared/rules/{index,stacked_imbalance,delta_divergence,absorption,poc_shift}.ts` (12 ไฟล์ ไม่มี telegram.ts — โดยตั้งใจ)

**สั่ง backtest:** ดูข้อ 3.10 — ยิงผ่าน `select public.run_backtest('{...}'::jsonb)` ไม่ใช่ curl

**อัปเดต DLL บนเครื่อง Windows:**
```
cd C:\atas
scripts\update-indicator.bat        (ดับเบิลคลิกก็ได้)
```
Updater จะ fetch production branch ล่าสุดเอง; **ไม่ต้อง checkout/pull `main`** และไม่กระทบไฟล์ที่
กำลังแก้ใน checkout. แล้วปิด ATAS → เปิดใหม่ → ลบ Signal Bridge ตัวเก่าออกจากชาร์ต → Import →
Custom → Add เช็คแท็บ **About** ว่า REV/indicator commit ตรงกับที่สคริปต์พิมพ์ออกมา.

---

## 10. โครงสร้างไฟล์

```
atas-indicator/AtasSignalBridge/    C# indicator (build บน Windows เท่านั้น)
supabase/migrations/                0001–0031
supabase/functions/
  ingest/index.ts       HTTP shell ของ pipeline สด
  chart-annotations/index.ts  read-only data สำหรับ marker บน ATAS (primary/unmuted เท่านั้น)
  outcome-notify/index.ts  endpoint สำรอง (v4 ตรงกับ repo แล้ว ดู 7.3)
  backtest/index.ts     ตัวรันการทดลอง — ไม่ import telegram.ts โดยตั้งใจ
  feed-watch/index.ts   เตือนเมื่อ feed เงียบ/กลับมา (pg_cron ทุก 5 นาที)
  _shared/
    ingest.ts        pipeline หลัก (batch write)
    confidence_v2.ts Shadow snapshot ที่ตรึง feature ณ signal time; score เป็น null โดยตั้งใจ (5.20)
    plan.ts          trade plan
    liquidity.ts     volume gate
    price_action.ts  structure/BOS/CHoCH/sweep/zone (เก็บอย่างเดียว)
    overrides.ts     ตั้งค่าแยกราย instrument (ดู 5.5)
    backtest.ts      simulate() + scorePlan() — เรียก runRules/buildPlan ตัวจริง
    testdata/scorer_cases.ts  20 ไม้จริงที่ DB ให้คะแนนเอง (5 ไม้ต่อ exit reason)
    rules/           8 กฎ + registry (`lvn` · `speed_of_tape` · `poc_shift` ปิดเสียงอยู่ — ข้อ 5.15 / 5.16 / 5.17)
    feed_health.ts   ข้อความเตือน feed + ตัวส่ง (แยกจาก telegram.ts โดยตั้งใจ — ดู 5.12)
    telegram.ts      ข้อความแจ้งเตือน
    outcomes.ts      reply ผลลัพธ์
web/app/experiments/                หน้าแสดงผลทดลอง + ปุ่มย้อนค่า
web/app/stats/                      สถิติ + settings_effect + price_action_edge (5.9, 8.1)
web/components/ConfidenceV2Status.tsx  card บอกสถานะ Shadow ของแต่ละ signal (5.20)
docs/queries/                       คิวรีวิเคราะห์ที่ใช้ซ้ำได้ (ดู 8.3)
scripts/update-indicator.{ps1,bat}  fetch production แบบ isolated, build/verify DLL (REV + commit + SHA-256)
scripts/rev-check.ts                ตัวเช็ก REV — deno task rev:check (ดู 3.8)
docs/SETUP.md                       คู่มือติดตั้งฉบับเต็ม
```

---

## 11. สิ่งที่ห้ามทำ

1. อย่าเชื่อว่า `TickSize` คือ tick ของตลาด
2. อย่าเปรียบเทียบ `bar` กับ `CurrentBar` ตรง ๆ ใน C#
3. อย่าบอกให้ก็อป DLL ไป `Documents\ATAS\Indicators\`
4. อย่าเพิ่มกฎใหม่ **ที่ส่งเสียง** ก่อนที่มันจะพิสูจน์ตัวเอง — กฎเดิม 4 ตัว × 2 ทิศทาง
   ยังตัดสินไม่ได้เลย การเพิ่มกฎที่ยิงเข้าตารางเพื่อ *วัด* ไม่ผิดข้อนี้ (`telegram_enabled = false`
   คือทางที่ระบบนี้ใช้ — ข้อ 5.15) แต่การเปิด `telegram_enabled` ให้กฎที่ยังไม่มีตัวเลขคือผิดเต็ม ๆ
5. อย่าเปิดใช้ตัวกรองใหม่โดยไม่วัดก่อน — วัดแล้วค่อยกรอง คือวิธีที่ใช้มาตลอด
6. อย่าแก้ migration เก่า
7. อย่าสร้างสัญญาณจากแท่งที่ยังไม่ปิด
8. อย่าตั้งเกณฑ์ที่นับเป็น "แถว footprint" แล้วคาดว่าจะใช้ได้ทุก instrument — 1 แถวคนละขนาดกัน (ข้อ 5.4)
9. อย่าเลือกค่าจากแถวที่ดีที่สุดแถวเดียว ถ้าเพื่อนบ้านไม่เห็นด้วย นั่นคือ fit ข้อมูล
10. อย่ารายงานผลเป็น ticks ในเมื่อข้อความสัญญาณรายงานเป็นราคา — ไม้เดียวกันต้องใช้หน่วยเดียวกัน ไม่งั้นอ่านแล้วนึกว่าคนละไม้
11. อย่าปรับค่าจาก cell ที่ยังไม่ผ่าน `setup_stability` — เซสชันเดียวพลิกกลับข้างได้ทั้งอัน (ข้อ 5.5)
12. อย่าเล็งเป้าที่ win rate ตรง ๆ — ขยาย TP/ถือนานขึ้นทำให้ win rate ขึ้นแต่เงินหาย ค่า share 1.00 เคยให้ WR สูงสุด 50.5% แต่ได้ R น้อยกว่า 0.30 ที่ WR 47.2%
13. **อย่าอ่าน R รวมโดยไม่ดู R ต่อไม้** ตัวแปรที่เปลี่ยนจำนวนไม้ (เช่น `minVolumeRatio`)
    ทำให้ R รวมสูงขึ้นได้ทั้งที่ทุกไม้แย่ลง — ดูข้อ 5.7
14. **อย่าเชื่อเส้นที่ไม่มีจุดกลับตัว** ถ้ากวาดค่าแล้วดีขึ้นเรื่อย ๆ ไม่หยุด แปลว่าโมเดลกำลังถูกใช้
    ประโยชน์ ไม่ใช่ตลาดกำลังบอกอะไร — ให้ไล่ต่อจนเห็นว่าปลายเส้นพิงอยู่บนกี่ไม้ (ข้อ 5.6)
15. **อย่าเขียนผลการทดลองลง `public.signals`** ตัวรัน backtest แยกจากทางที่ต่อกับ Telegram
    ด้วย *สิ่งที่มันเขียน* ไม่ใช่ด้วย flag — ถ้าเผลอเขียน signals เมื่อไร คุณสมบัตินี้หายทันที
16. **อย่าใส่ anon key เป็นทางเข้าของอะไรที่กินทรัพยากร** มันฝังอยู่ใน bundle ของเว็บ
    ใครเปิดเว็บก็มี — ใช้ `runner_tokens` แทน (ข้อ 3.10)
17. **อย่าทำ REV เป็นเลขร่วมกันทุกส่วน** indicator เปลี่ยนน้อยกว่าเว็บหลายเท่า เลขร่วมจะทำให้
    แท็บ About ขยับตอนที่ DLL ไม่ได้เปลี่ยน แล้วต้อง build ใหม่ฟรี ๆ (ข้อ 3.8)
17b. **อย่าอ่าน R โดยไม่ดู drawdown** ค่าสองชุดที่ R/ไม้ เท่ากันอาจต้องทนหลุมลึกไม่เท่ากัน
    และหลุมที่ลึกกว่าคือตัวที่คนเลิกใช้ก่อนจะได้กำไร (ข้อ 5.12)
18. **อย่าเชื่อ threshold ที่ดีขึ้นเพราะไม้ลดลง** ตัวกรองที่รัดขึ้นเรื่อย ๆ จะดูดีขึ้นเรื่อย ๆ
    จนกว่าจะไม่เหลือไม้ — ต้องเห็นจุดกลับตัว **และ** ไม่มี instrument ไหนแย่ลง (ข้อ 5.11)
19. **อย่าเปิด `pullbackShare` จาก `/rules` โดยยังไม่แก้ `evaluate_pending_outcomes()`**
    ตัวให้คะแนนสมมติว่าทุกแผนได้เข้าที่แท่งสัญญาณ ไม้ที่ราคาไม่ย่อกลับมาจะถูกนับเหมือนเข้าแล้ว
    (ตอนนี้วัดแล้วและ**ไม่รับ** ค่าจึงเป็น 0 อยู่ — ข้อห้ามนี้กันไว้เผื่อวันที่มีคนคิดจะเปิดใหม่ · ข้อ 5.13)
21. **อย่าอ่านแถวงานค้างแล้วค่อยไปประทับทีหลัง** ถ้าอ่านก่อนแล้วเขียนทีหลัง คนที่มาพร้อมกัน
    จะได้แถวเดียวกันและทำงานซ้ำ — ให้ **การเขียนเป็นตัวจอง** (`update ... returning` ใน
    คำสั่งเดียวกับที่ select ภายใต้ `for update skip locked`) แล้วคืนแถวที่ทำไม่สำเร็จกลับเข้าคิว
    ingest 4 ชาร์ตยิงห่างกัน 10 มิลลิวินาที ไม่ใช่กรณีหายาก มันคือกรณีปกติ (ข้อ 3.16)
20. **อย่าอ่าน R ต่อไม้ โดยไม่ดู `fill_rate`** ตัวแปรที่ทำให้บางสัญญาณ**ไม่ได้เข้าเลย**
    (pullback หรืออะไรก็ตามที่ต้องรอราคา) จะโชว์ R/ไม้ ที่สวยขึ้นเสมอ เพราะไม้ที่หายไปคือไม้ที่
    วิ่งไปเลยไม่ย้อนกลับมา ซึ่งเป็นไม้ที่กำไร — `pullback 0.50` ทำ R/ไม้ ดีกว่า baseline 7%
    ขณะที่ได้เงินน้อยลง 43% (ข้อ 5.13) · คู่กับข้อ 13 ที่เป็นด้านกลับของเหรียญเดียวกัน
21. **อย่าใช้ Confidence v2 เป็นคะแนนหรือ filter ก่อนผ่าน forward test** — `v2-shadow-1`
    เก็บ feature เพื่อสร้างหลักฐานเท่านั้น (`score: null`) และ verdict ของ view คือ permission
    ให้เริ่มทดลอง offline ไม่ใช่ permission ให้แตะ Telegram/กฎ (ข้อ 5.20)
