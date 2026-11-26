@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing packages for first run...
  call npm install --no-fund --no-audit
)
start "" http://localhost:3000
node server.js
