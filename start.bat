@echo off
REM Dhan Drishti - one-command local launcher (Windows).
REM Builds the web app, starts the single-service server (API + UI on one port),
REM and opens your browser once it's ready. Re-run any time; data persists in .\data.
setlocal
cd /d "%~dp0"

if "%PORT%"=="" set PORT=4000
set URL=http://localhost:%PORT%

where pnpm >nul 2>&1
if errorlevel 1 (
  echo pnpm is required but not found. Install Node.js + pnpm first: https://pnpm.io/installation
  exit /b 1
)

echo Dhan Drishti - starting...

REM Sync dependencies to the lockfile every run - a no-op when already up to date,
REM but it picks up new packages after a `git pull` (stale node_modules otherwise).
echo Syncing dependencies...
call pnpm install || exit /b 1

echo Building the web app...
call pnpm --filter @dhan-drishti/web build || exit /b 1

REM Open the browser shortly after the server starts binding (background task).
start "" cmd /c "timeout /t 5 >nul & start "" %URL%"

echo Starting Dhan Drishti on %URL% - press Ctrl+C to stop.
call pnpm --filter @dhan-drishti/server serve
