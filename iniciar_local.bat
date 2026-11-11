@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv (
  echo Criando ambiente Python...
  python -m venv .venv
  .venv\Scripts\python -m pip install --upgrade pip
  .venv\Scripts\pip install -r requirements.txt
)
echo.
echo Catalogo Zionne rodando em http://localhost:8000
echo Painel administrativo:     http://localhost:8000/admin
echo (feche esta janela para parar)
start "" http://localhost:8000
.venv\Scripts\uvicorn app.main:app --host 0.0.0.0 --port 8000
