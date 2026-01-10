@echo off
:: build-windows.bat
:: automated windows build script for mLRS Flasher
:: updated: 2026-01-10

setlocal enabledelayedexpansion

echo.
echo ============================================
echo   mLRS Flasher - Windows Build Script
echo ============================================
echo.

:: check for node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found. Please install Node.js 18+ and try again.
    exit /b 1
)

:: check for python (system python, used to verify version)
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo WARNING: System Python not found. This is needed for downloading embedded runtimes.
)

:: navigate to project root
cd /d "%~dp0.."
echo Working directory: %cd%
echo.

:: step 1: download windows python runtime
echo [1/4] Checking Python runtime for Windows...
set PYTHON_EXE=python\windows\python.exe
set "PYTHON_INSTALLED_MARKER=python\windows\.installed"

if exist "%PYTHON_INSTALLED_MARKER%" (
    echo       Python runtime valid [marker found]. Skipping download/install.
    echo.
    echo [2/4] Installing Python modules...
    echo       Skipping [bundled with runtime].
) else (
    echo       Runtime not found or incomplete. Starting fresh install...
    
    :: cleanup potential partial installs
    if exist "python\windows" rmdir /s /q "python\windows"
    
    echo       Running scripts/download-python.js...
    call node scripts/download-python.js windows
    if %errorlevel% neq 0 (
        echo ERROR: Failed to download Python runtime.
        exit /b 1
    )
    
    if not exist "%PYTHON_EXE%" (
        echo ERROR: Python binary not found at %PYTHON_EXE% after download step.
        exit /b 1
    )
    
    :: check if pip needs to be installed via get-pip
    %PYTHON_EXE% -m pip --version >nul 2>&1
    if %errorlevel% neq 0 (
        echo       pip not found. Downloading get-pip.py...
        powershell -Command "Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile 'get-pip.py'"
        %PYTHON_EXE% get-pip.py --no-warn-script-location
        if exist "get-pip.py" del get-pip.py
    )
    
    :: step 2: install python modules
    echo [2/4] Installing Python modules...
    echo       Installing requests, pyserial, pymavlink...
    %PYTHON_EXE% -m pip install requests pyserial pymavlink future lxml bitstring ecdsa reedsolo cryptography --no-warn-script-location
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install Python modules.
        exit /b 1
    )
    
    echo       Optimizing Python runtime...
    %PYTHON_EXE% scripts/optimize_python.py python/windows
    
    :: create marker file
    echo. > "%PYTHON_INSTALLED_MARKER%"
    echo       Python setup complete.
)
echo.

:: step 3: install npm dependencies
echo [3/4] Installing npm dependencies...
cd electron

set NEED_INSTALL=0
if not exist "node_modules\" set NEED_INSTALL=1
if exist "node_modules\" (
    powershell -Command "if ((Get-Item package.json).LastWriteTime -gt (Get-Item node_modules).LastWriteTime) { exit 1 } else { exit 0 }"
    if !errorlevel! equ 1 set NEED_INSTALL=1
)

if !NEED_INSTALL! equ 1 (
    echo       Dependencies outdated or missing. Running 'npm install' to ensure dependencies are up to date...
    call npm install
    if !errorlevel! neq 0 (
        echo ERROR: npm install failed.
        cd ..
        exit /b 1
    )
    :: Touch node_modules to update its timestamp to now
    powershell -Command "(Get-Item node_modules).LastWriteTime = Get-Date"
) else (
    echo       Dependencies appear up to date. Skipping 'npm install'.
)
echo.

:: step 4: build windows executable
echo [4/4] Building Windows executable...
call npm run build:win
if %errorlevel% neq 0 (
    echo ERROR: Build failed.
    cd ..
    exit /b 1
)

cd ..
echo.
echo ============================================
echo   Build Complete!
echo ============================================
echo.
echo Output located in: dist\
echo.
dir /b dist\*.exe 2>nul

endlocal

