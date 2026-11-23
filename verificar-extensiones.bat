@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\verificar-extensiones.ps1"
echo.
pause
