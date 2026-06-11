@echo off
cd /d "%~dp0"
title Labtechshow Studio - Git & GitHub Setup
color 0A

echo ===================================================
echo   Labtechshow Studio - Push to GitHub Utility
echo ===================================================
echo   * IMPORTANT: Run this file by double-clicking it.
echo   * Do NOT use "Run as Administrator" as it blocks winget.
echo ===================================================
echo.

:: Check if git is installed
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Git was not found on your system.
    echo.
    echo We will attempt to install Git using Windows Package Manager (winget).
    echo This may open a User Account Control (UAC) prompt asking for admin permissions.
    echo Please click "Yes" when prompted to allow the installer to run.
    echo.
    pause
    echo Installing Git...
    winget install --id Git.Git -e --source winget
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] Git installation failed or was cancelled.
        echo Please install Git manually from https://git-scm.com/ and run this script again.
        pause
        exit /b
    )
    echo.
    echo [SUCCESS] Git installed successfully! 
    echo Please restart this command prompt window and run this script again to proceed.
    pause
    exit /b
)

:: If git is found, continue
echo [*] Git is installed.
echo.

:: Initialize git repository if needed
if not exist "%~dp0.git" (
    echo [*] Initializing Git repository...
    git init
) else (
    echo [*] Git repository is already initialized.
)

:: Configure local username/email if not set
echo [*] Configuring local git user settings...
git config --local user.name "iamtallboy-droid"
git config --local user.email "iamtallboy-droid@users.noreply.github.com"

:: Add files
echo [*] Staging files...
git add .

:: Commit
echo [*] Committing files...
git commit -m "Initial commit of Labtechshow Studio Control Panel and Overlays"

:: Add remote
echo [*] Setting remote origin...
git remote remove origin >nul 2>&1
git remote add origin https://github.com/iamtallboy-droid/lab-tech-studio.git
git branch -M main

echo.
echo ===================================================
echo   Ready to push to GitHub!
echo ===================================================
echo.
echo Before pressing a key to push, please make sure you have:
echo 1. Created a repository named "lab-tech-studio" on your GitHub (iamtallboy-droid)
echo 2. Kept it empty (no README.md or .gitignore, as we have them here)
echo.
echo Pressing any key will run "git push -u origin main".
echo This might open a web browser page or a prompt asking you to log into GitHub.
echo.
pause

git push -u origin main
if %errorlevel% equ 0 (
    echo.
    echo [SUCCESS] Project successfully pushed to:
    echo https://github.com/iamtallboy-droid/lab-tech-studio
) else (
    echo.
    echo [ERROR] Push failed. If it was an authentication issue,
    echo please verify your GitHub credentials and run this script again.
)
echo.
pause
