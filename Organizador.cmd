@echo off
rem Abre o organizador: liga o servidor local em segundo plano (se ainda nao estiver
rem ligado) e abre o app no Edge. Depois de instalado como app, este arquivo so e
rem necessario para receber atualizacoes do codigo.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao foi encontrado. Instale em https://nodejs.org e tente de novo.
  pause
  exit /b 1
)

powershell -NoProfile -WindowStyle Hidden -Command "Start-Process node -ArgumentList 'servidor.js' -WorkingDirectory '%~dp0.' -WindowStyle Hidden"
timeout /t 1 /nobreak >nul
start "" msedge "http://localhost:4321/"
