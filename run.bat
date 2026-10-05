@echo off
chcp 65001 >nul
title Калькулятор портфеля
cd /d "%~dp0"

rem --- 1. Ищем Python
set PY=
python --version >nul 2>nul && set PY=python
if not defined PY py -3 --version >nul 2>nul && set PY=py -3
if not defined PY (
  echo.
  echo Python не найден.
  echo Установите его с сайта https://www.python.org/downloads/
  echo При установке поставьте галочку "Add python.exe to PATH" и запустите этот файл снова.
  echo.
  pause
  exit /b 1
)

rem --- Проверяем версию: нужен Python 3.11 или новее
%PY% -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)"
if errorlevel 1 (
  echo.
  echo Установленный Python слишком старый: нужен 3.11 или новее.
  echo Скачайте свежую версию с https://www.python.org/downloads/
  echo.
  pause
  exit /b 1
)

rem --- 2. При первом запуске создаём отдельную папку с библиотеками (.venv)
if not exist ".venv\Scripts\python.exe" (
  echo Первый запуск: создаю папку с библиотеками...
  %PY% -m venv .venv
)

rem --- 3. Устанавливаем библиотеки, если список изменился (нужен интернет)
fc /b requirements-local.txt ".venv\installed.txt" >nul 2>nul
if errorlevel 1 (
  echo Устанавливаю библиотеки, это займёт 1-3 минуты...
  ".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r requirements-local.txt
  if errorlevel 1 (
    echo.
    echo Не удалось установить библиотеки. Проверьте интернет и запустите файл снова.
    pause
    exit /b 1
  )
  copy /y requirements-local.txt ".venv\installed.txt" >nul
)

rem --- 4. Один раз скачиваем библиотеку графиков, чтобы сайт работал без интернета
if not exist "static\plotly.min.js" (
  echo Скачиваю библиотеку графиков...
  curl -L -s -f -o "static\plotly.min.js" https://cdn.plot.ly/plotly-2.35.2.min.js
  if errorlevel 1 if exist "static\plotly.min.js" del "static\plotly.min.js"
)

rem --- 5. Через 3 секунды открываем сайт в браузере и запускаем сервер
echo.
echo Сайт: http://127.0.0.1:5000
echo Чтобы остановить, закройте это окно.
echo.
start "" /b cmd /c "ping -n 4 127.0.0.1 >nul & start http://127.0.0.1:5000"
".venv\Scripts\python.exe" app.py

pause
