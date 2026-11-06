@echo off
rem Starts Claude Desk from this folder; start-desk.cmd also installs what is missing
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (call "%~dp0start-desk.cmd" & exit /b)
start "" "node_modules\electron\dist\electron.exe" .
