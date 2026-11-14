@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js bulunamadi, simdi kuruluyor...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  set "PATH=%PATH%;%ProgramFiles%\nodejs"
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js kurulamadi. https://nodejs.org adresinden LTS surumunu kurup bu dosyayi yeniden ac.
  pause
  exit /b 1
)
node kur.js
echo.
pause
