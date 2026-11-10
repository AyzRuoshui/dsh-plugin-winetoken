@echo off
chcp 65001 >nul
cd /d G:\
node "%~dp0migrate-rename.cjs"
echo.
pause
