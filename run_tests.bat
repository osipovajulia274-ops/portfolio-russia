@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Сначала один раз запустите run.bat: он установит библиотеки.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" -m unittest -v
echo.
pause
