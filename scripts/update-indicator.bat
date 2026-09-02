@echo off
chcp 65001 >nul
set "DOTNET_CLI_UI_LANGUAGE=en"
REM Double-click entry point for update-indicator.ps1.
REM
REM PowerShell refuses to run .ps1 files at all by default, and the refusal
REM ("running scripts is disabled on this system") reads like the script is
REM broken rather than like a policy that has to be stepped around. Bypass
REM here applies to this one process and changes nothing on the machine.
REM -NoProfile keeps a slow or noisy profile out of the run. -NoLogo keeps the
REM updater output focused on actionable status.
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-indicator.ps1"
