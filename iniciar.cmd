@echo off
cd /d "%~dp0"
echo Cardapio (pagina inicial): http://127.0.0.1:3200/   Painel do dono: http://127.0.0.1:3200/painel
start "" /min cmd /c "timeout /t 2 /nobreak >/dev/null & start http://127.0.0.1:3200/"
node servidor.mjs
