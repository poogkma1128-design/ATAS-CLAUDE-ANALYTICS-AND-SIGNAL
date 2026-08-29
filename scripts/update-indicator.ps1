#Requires -Version 5.1
<#
    อัปเดต indicator เป็นเวอร์ชันล่าสุด แล้ว build DLL ให้พร้อม Import เข้า ATAS

    วิธีใช้: ดับเบิลคลิก update-indicator.bat ที่อยู่ข้าง ๆ ไฟล์นี้

    เรียกไฟล์นี้ตรง ๆ ไม่ได้ ถ้าเครื่องยังไม่ได้เปิด execution policy ไว้
    (จะขึ้น "running scripts is disabled on this system") ไฟล์ .bat มีไว้
    ข้ามข้อจำกัดนั้นเฉพาะตอนรัน โดยไม่แก้ค่าอะไรค้างไว้ในเครื่อง

    สคริปต์นี้ไม่แตะโฟลเดอร์ ATAS เลย มันแค่ build DLL แล้ววางไว้บน Desktop
    ให้หาเจอง่าย ๆ ตอนกดปุ่ม Import ในหน้า Indicators ของ ATAS
#>

# git writes progress to stderr, which "Stop" can mistake for a failure, so
# every step checks its own exit code instead.
$ErrorActionPreference = "Continue"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Project  = Join-Path $RepoRoot "atas-indicator\AtasSignalBridge\AtasSignalBridge.csproj"
$BuiltDll = Join-Path $RepoRoot "atas-indicator\AtasSignalBridge\bin\Release\AtasSignalBridge.dll"
$Desktop  = [Environment]::GetFolderPath("Desktop")

function Step([int]$n, [string]$text) {
    Write-Host ""
    Write-Host "[$n/4] $text" -ForegroundColor Cyan
}
function Ok([string]$text)   { Write-Host "      $([char]0x2713) $text" -ForegroundColor Green }
function Note([string]$text) { Write-Host "      $text" -ForegroundColor DarkGray }

function Stop-Here([string]$problem, [string]$fix) {
    Write-Host ""
    Write-Host "หยุดตรงนี้: $problem" -ForegroundColor Red
    Write-Host "วิธีแก้:    $fix" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "กด Enter เพื่อปิดหน้าต่าง" | Out-Null
    exit 1
}

Write-Host "อัปเดต ATAS Signal Bridge" -ForegroundColor White
Note $RepoRoot

# --- 1. เครื่องมือ -----------------------------------------------------------
Step 1 "ตรวจว่ามีเครื่องมือครบ"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Stop-Here "ไม่พบ git" "ติดตั้งจาก https://git-scm.com/download/win แล้วเปิด PowerShell ใหม่"
}
Ok "git"

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    Stop-Here ".NET SDK" "ติดตั้ง .NET 10 SDK จาก https://dotnet.microsoft.com/download/dotnet/10.0 แล้วเปิด PowerShell ใหม่"
}
Ok ".NET SDK $(dotnet --version)"

if (-not (Test-Path $Project)) {
    Stop-Here "หาไฟล์โปรเจกต์ไม่เจอ ($Project)" "ตรวจว่าสคริปต์นี้อยู่ในโฟลเดอร์ scripts\ ของ repo ที่ clone มา"
}

# --- 2. ดึงโค้ดล่าสุด --------------------------------------------------------
Step 2 "ดึงโค้ดล่าสุดจาก GitHub"

Set-Location $RepoRoot

# งานที่แก้ค้างไว้จะถูก checkout ทับหายไป จึงเตือนก่อนแทนที่จะเงียบ ๆ ทำเลย
$dirty = git status --porcelain
if ($dirty) {
    Write-Host "      มีไฟล์ที่แก้ค้างไว้ในเครื่อง:" -ForegroundColor Yellow
    $dirty | ForEach-Object { Write-Host "        $_" -ForegroundColor Yellow }
    $answer = Read-Host "      ทับด้วยเวอร์ชันจาก GitHub เลยไหม (พิมพ์ y แล้ว Enter)"
    if ($answer -ne "y") { Stop-Here "ยกเลิกตามที่สั่ง" "เก็บงานที่แก้ไว้ก่อน แล้วรันสคริปต์นี้อีกครั้ง" }
    git reset --hard | Out-Null
}

git fetch origin --prune
if ($LASTEXITCODE -ne 0) {
    Stop-Here "ดึงข้อมูลจาก GitHub ไม่ได้" "ตรวจอินเทอร์เน็ต แล้วรันใหม่"
}

# main คือสาขาหลักที่งานทุกอย่างถูก merge เข้าไป
git checkout --quiet -B main origin/main
if ($LASTEXITCODE -ne 0) { Stop-Here "สลับไปสาขา main ไม่ได้" "ส่ง error ข้างบนมาให้ดู" }

$Commit = (git rev-parse --short=7 HEAD)
Ok "อัปเดตแล้ว — $(git log -1 --format=%s)"
Note "commit $Commit"

# --- 3. Build ----------------------------------------------------------------
Step 3 "Build DLL (ครั้งแรกอาจนานสัก 1-2 นาที)"

dotnet build $Project -c Release --nologo
if ($LASTEXITCODE -ne 0) {
    Stop-Here "build ไม่ผ่าน" "อ่านบรรทัด error สีแดงข้างบน ถ้าเป็น ATAS.Indicators.dll แปลว่าหา ATAS ไม่เจอ — ดู docs/SETUP.md หัวข้อ Build"
}
if (-not (Test-Path $BuiltDll)) {
    Stop-Here "build ผ่านแต่ไม่เจอไฟล์ DLL" "ส่งข้อความทั้งหน้านี้มาให้ดู"
}
Ok "build ผ่าน"

# --- 4. วางไว้บน Desktop -----------------------------------------------------
Step 4 "วางไฟล์ไว้บน Desktop"

$target = Join-Path $Desktop "AtasSignalBridge.dll"
Copy-Item $BuiltDll $target -Force
Ok $target
Note "วันที่ไฟล์: $((Get-Item $target).LastWriteTime)"

Write-Host ""
Write-Host "เสร็จแล้ว ต่อไปทำใน ATAS:" -ForegroundColor White
Write-Host "  1. ปิด ATAS ให้สนิท (ออกจาก system tray ด้วย) แล้วเปิดใหม่"
Write-Host "  2. ลบ Signal Bridge ตัวเก่าออกจากชาร์ตก่อน"
Write-Host "  3. คลิกขวาบนชาร์ต -> Indicators -> ปุ่ม Import (ลูกศรขึ้น) มุมขวาบน"
Write-Host "  4. เลือก AtasSignalBridge.dll บน Desktop"
Write-Host "  5. หา Signal Bridge ในหมวด Custom -> Add"
Write-Host ""
Write-Host "ตรวจว่าได้ตัวใหม่จริง:" -ForegroundColor White
Write-Host "  คลิก Signal Bridge ในหน้า Indicators แล้วดูแท็บ About"
Write-Host "  ต้องขึ้น: " -NoNewline
Write-Host "commit $Commit" -ForegroundColor Green
Write-Host "  ถ้าขึ้น commit อื่น แปลว่า ATAS ยังใช้ตัวเก่า - ปิด ATAS แล้ว Import ใหม่"
Write-Host ""
Read-Host "กด Enter เพื่อปิดหน้าต่าง" | Out-Null
