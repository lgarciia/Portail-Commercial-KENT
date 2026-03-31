@echo off

cd /d "%~dp0"

start chrome http://localhost:8000/index.html

python -m http.server 8000