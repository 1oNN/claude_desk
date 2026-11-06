@echo off
rem Starts Claude Desk. The first run installs the dependencies, which needs Node 20 or newer.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js was not found. Install it from https://nodejs.org and run this again. & pause & exit /b 1)
if not exist "node_modules\electron\install.js" (
  echo Installing dependencies, this takes a minute...
  call npm ci --no-audit --no-fund || (echo npm ci failed. See the lines above. & pause & exit /b 1)
)
rem Electron fetches its own binary the first time, not at install
if not exist "node_modules\electron\dist\electron.exe" (
  node node_modules\electron\install.js || (echo Downloading Electron failed. See the lines above. & pause & exit /b 1)
)
start "" "node_modules\electron\dist\electron.exe" .
