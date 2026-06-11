@echo off
title Lab Tech Studio Hub - First Time Setup
color 0B

echo.
echo  =====================================================
echo   Lab Tech Studio Hub - SETUP (Phase 2 Production)
echo  =====================================================
echo.

:: -------------------------------------------------------
:: Step 1: Check Node.js
:: -------------------------------------------------------
echo [1/4] Checking for Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: Node.js is not installed or not on PATH.
    echo  Please download it from: https://nodejs.org/
    echo  Then run this setup script again.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo  Node.js %NODE_VER% found.
echo.

:: -------------------------------------------------------
:: Step 2: Install npm dependencies
:: -------------------------------------------------------
echo [2/4] Installing npm dependencies (pg, ioredis, dotenv, etc.)...
cd /d "%~dp0"
call npm install
if %errorlevel% neq 0 (
    echo  ERROR: npm install failed. Check your internet connection.
    pause
    exit /b 1
)
echo  npm install complete.
echo.

:: -------------------------------------------------------
:: Step 3: Install PM2 globally (optional but recommended)
:: -------------------------------------------------------
echo [3/4] Installing PM2 process manager globally (recommended)...
call npm install -g pm2
if %errorlevel% neq 0 (
    echo  WARNING: PM2 install failed (non-critical).
    echo  You can still run the server with node server.js
) else (
    echo  PM2 installed successfully.
)
echo.

:: -------------------------------------------------------
:: Step 4: Setup .env
:: -------------------------------------------------------
echo [4/4] Checking .env configuration...
if not exist "%~dp0.env" (
    echo  WARNING: .env file not found. Creating from defaults...
    echo PORT=7335 > "%~dp0.env"
    echo POSTGRES_URL= >> "%~dp0.env"
    echo REDIS_URL=redis://localhost:6379 >> "%~dp0.env"
    echo PM2_APP_NAME=lab-tech-studio-hub >> "%~dp0.env"
)
echo  .env is ready.
echo.

echo  =====================================================
echo   SETUP COMPLETE!
echo  =====================================================
echo.
echo   OPTIONAL (for full production features):
echo   - PostgreSQL: Set POSTGRES_URL in .env
echo     Download: https://www.postgresql.org/download/windows/
echo.
echo   - Redis: Set REDIS_URL in .env
echo     Windows: https://github.com/microsoftarchive/redis/releases
echo     OR use WSL2: wsl --install then: sudo apt install redis-server
echo.
echo   NOTE: Without Postgres/Redis the server uses SQLite + in-memory
echo   cache automatically. Nothing breaks either way.
echo.
echo   To start the server, double-click: START_SERVER.bat
echo.
pause
