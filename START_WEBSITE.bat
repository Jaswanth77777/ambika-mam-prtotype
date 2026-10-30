@echo off
setlocal
cd /d "%~dp0"
echo ======================================================
echo JOY UNIVERSITY BUS TRACKING - STARTUP
 echo If this is your first run, dependencies will install.
echo ======================================================
where py >nul 2>nul
if %errorlevel%==0 (set "PY=py") else (set "PY=python")
%PY% --version >nul 2>nul
if errorlevel 1 (
  echo Python 3 is not installed or not on PATH.
  echo Install Python 3 from https://www.python.org/downloads/ and enable Add Python to PATH.
  pause
  exit /b 1
)
%PY% -m pip install -r requirements.txt
if errorlevel 1 (
  echo Dependency installation failed. Check your internet connection.
  pause
  exit /b 1
)
start "JOY Bus Tracking" http://127.0.0.1:5000
%PY% app.py
pause
