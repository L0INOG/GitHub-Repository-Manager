@echo off
setlocal
cd /d "%~dp0"

set "EXE=%~dp0node_modules\electron\dist\electron.exe"
if not exist "%EXE%" (
  echo Electron is not installed. Running npm start...
  call npm start
  exit /b
)

start "" "%EXE%" .
endlocal
