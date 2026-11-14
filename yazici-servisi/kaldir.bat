@echo off
chcp 65001 >nul
echo Atolye Yazici servisi kapatiliyor ve baslangictan kaldiriliyor...
node -e "require('http').get('http://127.0.0.1:47611/kapat').on('error',()=>{})" 2>nul
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\AtolyeYazici.vbs" 2>nul
echo Tamam. Yeniden kurmak icin kur.bat dosyasini ac.
pause
