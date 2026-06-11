@echo off
title Lab Tech Studio Hub - Production Server v2.0
color 0B

cd /d "%~dp0"

echo.
echo  =====================================================
echo   Lab Tech Studio Hub - Production Server v2.0
echo  =====================================================
echo.

:: -------------------------------------------------------
:: Check if Node.js is available
:: -------------------------------------------------------
where node >nul 2>&1
if %errorlevel% neq 0 (
    :: Try known install paths
    if exist "C:\Program Files\nodejs\node.exe" (
        set PATH=%PATH%;C:\Program Files\nodejs
    ) else (
        echo  ERROR: Node.js not found.
        echo  Please run SETUP.bat first, or install Node.js from nodejs.org
        echo.
        pause
        exit /b 1
    )
)

:: -------------------------------------------------------
:: Check if node_modules exists
:: -------------------------------------------------------
if not exist "%~dp0node_modules" (
    echo  node_modules not found. Running npm install first...
    call npm install
    echo.
)

:: -------------------------------------------------------
:: Try PM2 first (production process manager)
:: -------------------------------------------------------
where pm2 >nul 2>&1
if %errorlevel% equ 0 (
    echo  PM2 found - starting with process manager...
    echo.
    pm2 start ecosystem.config.js --env production
    echo.
    echo  Server is running under PM2.
    echo  View logs:    pm2 logs lab-tech-studio-hub
    echo  Stop server:  pm2 stop lab-tech-studio-hub
    echo  Restart:      pm2 restart lab-tech-studio-hub
    echo.
    echo  Control Dashboard:
    echo    http://localhost:7335/dashboard.html
    echo.
    echo  vMix Overlay Input URL:
    echo    http://localhost:7335/overlay.html
    echo.
    echo  Community Hub API:
    echo    http://localhost:7335/api/community/status
    echo.
    pause
) else (
    :: Fallback: run with node directly
    echo  PM2 not found - starting with node server.js directly.
    echo  TIP: Run SETUP.bat to install PM2 for auto-restart support.
    echo.
    echo  Press Ctrl+C or close this window to stop the server.
    echo.
    node server.js
    echo.
    echo  Server stopped.
    pause
)
