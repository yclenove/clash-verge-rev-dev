@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

REM ============================================================
REM  clash-verge-rev one-shot full test runner (Windows)
REM  1 vitest  2 scripts  3 tsc  4 workspace crates  5 src-tauri --lib
REM
REM  Usage:
REM    scripts\run-all-tests.bat
REM    scripts\run-all-tests.bat --skip-tauri
REM    scripts\run-all-tests.bat --only frontend
REM    scripts\run-all-tests.bat --only typecheck
REM    scripts\run-all-tests.bat --only rust
REM ============================================================

set "ROOT=%~dp0.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"
set "LOGDIR=D:\nexus-wsl\test-logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set "STAMP=%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%%TIME:~9,2%"
set "STAMP=%STAMP: =0%"
set "STAMP=%RANDOM%_%RANDOM%_%STAMP%"
set "SUMMARY=%LOGDIR%\summary-%STAMP%.txt"
set /a FAIL=0
set "ONLY="
set "DO_VITEST=1"
set "DO_SCRIPTS=1"
set "DO_TSC=1"
set "DO_CRATES=1"
set "DO_TAURI=1"

:parse
if "%~1"=="" goto parsed
if /I "%~1"=="--skip-tauri" (
  set "DO_TAURI=0"
  shift
  goto parse
)
if /I "%~1"=="--only" (
  set "ONLY=%~2"
  shift
  shift
  goto parse
)
shift
goto parse
:parsed

if defined ONLY (
  set "DO_VITEST=0"
  set "DO_SCRIPTS=0"
  set "DO_TSC=0"
  set "DO_CRATES=0"
  set "DO_TAURI=0"
  if /I "%ONLY%"=="frontend" (
    set "DO_VITEST=1"
    set "DO_SCRIPTS=1"
    set "DO_TSC=1"
  )
  if /I "%ONLY%"=="vitest" set "DO_VITEST=1"
  if /I "%ONLY%"=="scripts" set "DO_SCRIPTS=1"
  if /I "%ONLY%"=="typecheck" set "DO_TSC=1"
  if /I "%ONLY%"=="crates" set "DO_CRATES=1"
  if /I "%ONLY%"=="tauri" set "DO_TAURI=1"
  if /I "%ONLY%"=="rust" (
    set "DO_CRATES=1"
    set "DO_TAURI=1"
  )
)

echo ==== clash-verge-rev full tests ====
echo ROOT=%ROOT%
echo LOGDIR=%LOGDIR%
echo STAMP=%STAMP%
echo ONLY=%ONLY%
echo FLAGS vitest=%DO_VITEST% scripts=%DO_SCRIPTS% tsc=%DO_TSC% crates=%DO_CRATES% tauri=%DO_TAURI%
echo.

> "%SUMMARY%" (
  echo clash-verge-rev full tests %STAMP%
  echo ROOT=%ROOT%
  echo ONLY=%ONLY%
  echo FLAGS vitest=%DO_VITEST% scripts=%DO_SCRIPTS% tsc=%DO_TSC% crates=%DO_CRATES% tauri=%DO_TAURI%
)

set "NODE=C:\nvm4w\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
set "CARGO_BIN=C:\Users\uzuma\.cargo\bin"
set "RUST_TC=C:\Users\uzuma\.rustup\toolchains\1.95.0-x86_64-pc-windows-msvc\bin"
set "PATH=%CARGO_BIN%;%RUST_TC%;C:\nvm4w\nodejs;%PATH%"

set "VCVARS="
if exist "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
  set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
)
if not defined VCVARS if exist "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
  set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
)

cd /d "%ROOT%" || (
  echo FAIL: cannot cd to %ROOT%
  exit /b 2
)

REM ========================= 1) Vitest =========================
if "%DO_VITEST%"=="0" (
  echo [1/5] Vitest ... SKIP
  >>"%SUMMARY%" echo VITEST=SKIP
  goto step2
)
echo.
echo [1/5] Vitest ...
set "LOG=%LOGDIR%\vitest-%STAMP%.txt"
"%NODE%" "%ROOT%\node_modules\vitest\vitest.mjs" run > "%LOG%" 2>&1
set "RC=!ERRORLEVEL!"
if not "!RC!"=="0" (
  echo   FAIL vitest RC=!RC!  log=%LOG%
  set /a FAIL+=1
  >>"%SUMMARY%" echo VITEST=FAIL rc=!RC! log=%LOG%
) else (
  echo   OK   vitest
  >>"%SUMMARY%" echo VITEST=OK log=%LOG%
)

:step2
REM ========================= 2) Scripts =========================
if "%DO_SCRIPTS%"=="0" (
  echo [2/5] Script tests ... SKIP
  >>"%SUMMARY%" echo SCRIPTS=SKIP
  goto step3
)
echo.
echo [2/5] Script tests ...
set "LOG=%LOGDIR%\scripts-%STAMP%.txt"
"%NODE%" --test scripts\dev-control.test.mjs scripts\service-release.test.mjs scripts\prebuild-resource-utils.test.mjs > "%LOG%" 2>&1
set "RC=!ERRORLEVEL!"
if not "!RC!"=="0" (
  echo   FAIL scripts RC=!RC!  log=%LOG%
  set /a FAIL+=1
  >>"%SUMMARY%" echo SCRIPTS=FAIL rc=!RC! log=%LOG%
) else (
  echo   OK   scripts
  >>"%SUMMARY%" echo SCRIPTS=OK log=%LOG%
)

:step3
REM ========================= 3) Typecheck =========================
if "%DO_TSC%"=="0" (
  echo [3/5] Typecheck ... SKIP
  >>"%SUMMARY%" echo TSC=SKIP
  goto step4
)
echo.
echo [3/5] Typecheck ...
set "LOG=%LOGDIR%\tsc-%STAMP%.txt"
"%NODE%" "%ROOT%\node_modules\typescript\bin\tsc" --noEmit > "%LOG%" 2>&1
set "RC=!ERRORLEVEL!"
if not "!RC!"=="0" (
  echo   FAIL tsc RC=!RC!  log=%LOG%
  set /a FAIL+=1
  >>"%SUMMARY%" echo TSC=FAIL rc=!RC! log=%LOG%
) else (
  echo   OK   tsc
  >>"%SUMMARY%" echo TSC=OK log=%LOG%
)

:step4
REM ========================= 4) Workspace crates =========================
if "%DO_CRATES%"=="0" (
  echo [4/5] Cargo workspace crates ... SKIP
  >>"%SUMMARY%" echo CRATES=SKIP
  goto step5
)
echo.
echo [4/5] Cargo workspace crates ...
set "LOG=%LOGDIR%\crates-%STAMP%.txt"
where cargo >nul 2>&1
if errorlevel 1 (
  echo   SKIP crates ^(cargo not on PATH^)
  >>"%SUMMARY%" echo CRATES=SKIP reason=no-cargo
  goto step5
)
cargo test -p clash-verge-draft -p clash-verge-limiter -p clash-verge-signal -p clash-verge-logging -p clash-verge-i18n > "%LOG%" 2>&1
set "RC=!ERRORLEVEL!"
if not "!RC!"=="0" (
  echo   FAIL crates RC=!RC!  log=%LOG%
  set /a FAIL+=1
  >>"%SUMMARY%" echo CRATES=FAIL rc=!RC! log=%LOG%
) else (
  echo   OK   crates
  >>"%SUMMARY%" echo CRATES=OK log=%LOG%
)

:step5
REM ========================= 5) src-tauri lib =========================
if "%DO_TAURI%"=="0" (
  echo [5/5] src-tauri ... SKIP
  >>"%SUMMARY%" echo TAURI=SKIP
  goto finish
)
echo.
echo [5/5] src-tauri cargo test --lib ...
set "LOG=%LOGDIR%\tauri-%STAMP%.txt"
where cargo >nul 2>&1
if errorlevel 1 (
  echo   SKIP tauri ^(cargo not on PATH^)
  >>"%SUMMARY%" echo TAURI=SKIP reason=no-cargo
  goto finish
)
if defined VCVARS (
  call "%VCVARS%" >nul
  set "PATH=%CARGO_BIN%;%RUST_TC%;!PATH!"
)
set "CV_EMBED_TEST_MANIFEST=1"
cargo test -p clash-verge --lib -- --test-threads=1 > "%LOG%" 2>&1
set "RC=!ERRORLEVEL!"
if not "!RC!"=="0" (
  echo   FAIL tauri RC=!RC!  log=%LOG%
  set /a FAIL+=1
  >>"%SUMMARY%" echo TAURI=FAIL rc=!RC! log=%LOG%
) else (
  echo   OK   tauri
  >>"%SUMMARY%" echo TAURI=OK log=%LOG%
)

:finish
echo.
echo ==== SUMMARY ====
type "%SUMMARY%"
echo.
if !FAIL! equ 0 (
  echo ALL GREEN  failures=0
  >>"%SUMMARY%" echo RESULT=ALL_GREEN
  echo summary: %SUMMARY%
  exit /b 0
) else (
  echo HAS FAILURES  count=!FAIL!
  >>"%SUMMARY%" echo RESULT=FAIL count=!FAIL!
  echo summary: %SUMMARY%
  exit /b 1
)
