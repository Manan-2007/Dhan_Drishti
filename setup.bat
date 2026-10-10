@echo off
REM Dhan Drishti - first-time setup for a fresh Windows PC.
REM Installs Node.js and pnpm (whatever is missing), then installs project
REM dependencies. Safe to re-run. Afterwards, launch with start.bat.
setlocal
cd /d "%~dp0"

echo Dhan Drishti - setup

REM Make freshly installed tools visible in this window (PATH isn't refreshed after installs).
set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\pnpm;%PATH%"

REM 1. Node.js >= 20
set NEED_NODE=0
where node >nul 2>&1
if errorlevel 1 (
  set NEED_NODE=1
) else (
  node -e "process.exit(+process.versions.node.split('.')[0] < 20 ? 1 : 0)"
  if errorlevel 1 set NEED_NODE=1
)
if "%NEED_NODE%"=="1" (
  where winget >nul 2>&1
  if errorlevel 1 (
    echo winget not found. Install Node.js 20+ from https://nodejs.org then re-run this script.
    pause
    exit /b 1
  )
  echo Installing Node.js LTS - accept the admin prompt if one appears...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  where node >nul 2>&1
  if errorlevel 1 (
    echo Node.js installed, but this window can't see it yet. Close it, open a new terminal, and run setup.bat again.
    pause
    exit /b 1
  )
)
for /f "delims=" %%v in ('node -v') do echo [ok] Node.js %%v

REM 2. pnpm
where pnpm >nul 2>&1
if errorlevel 1 (
  echo Installing pnpm...
  call npm install -g pnpm
  if errorlevel 1 (
    echo Failed to install pnpm.
    pause
    exit /b 1
  )
)
for /f "delims=" %%v in ('pnpm -v') do echo [ok] pnpm %%v

REM 3. Project dependencies
echo Installing project dependencies...
call pnpm install
if errorlevel 1 (
  echo pnpm install failed.
  pause
  exit /b 1
)

REM 4. Optional env file for the News page
if not exist "apps\server\.env" if exist "apps\server\.env.example" (
  copy /y "apps\server\.env.example" "apps\server\.env" >nul
  echo Created apps\server\.env - add your Azure OpenAI key for News, optional.
)

echo.
echo Setup complete. Run: start.bat
pause
