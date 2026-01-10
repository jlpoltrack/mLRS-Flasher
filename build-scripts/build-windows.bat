@echo off
:: build-windows.bat
:: automated windows build script for mLRS Flasher
:: updated: 2026-01-09

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
echo [1/4] Downloading Windows Python runtime...
set PYTHON_VER=3.12.8
if exist "python\windows\python.exe" (
    echo       Python runtime already exists.
) else (
    if not exist "python\windows" mkdir "python\windows"
    
    echo       Downloading Python %PYTHON_VER% embeddable package...
    powershell -Command "Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/%PYTHON_VER%/python-%PYTHON_VER%-embed-amd64.zip' -OutFile 'python\windows\python-embed.zip'"
    if %errorlevel% neq 0 (
        echo ERROR: Failed to download Python runtime.
        exit /b 1
    )
    
    echo       Extracting Python...
    powershell -Command "Expand-Archive -Path 'python\windows\python-embed.zip' -DestinationPath 'python\windows' -Force"
    del "python\windows\python-embed.zip"
    
    echo       Enabling pip support...
    :: find the .pth file (e.g., python312._pth)
    for %%f in (python\windows\python*._pth) do (
        echo       Configuring %%f...
        powershell -Command "(Get-Content %%f) -replace '#import site', 'import site' | Set-Content %%f"
        :: ensure Lib/site-packages is in the .pth file
        findstr /C:"Lib/site-packages" %%f >nul
        if %errorlevel% neq 0 (
            echo Lib/site-packages >> %%f
        )
    )
)
echo.

:: step 2: install pip and python modules
echo [2/4] Installing Python modules...
set PYTHON_EXE=python\windows\python.exe

:: check if modules are already installed
%PYTHON_EXE% -c "import requests; import serial; import pymavlink" >nul 2>&1
if %errorlevel% neq 0 (
    echo       Some modules are missing, checking for pip...
    
    :: check if pip itself is working
    %PYTHON_EXE% -m pip --version >nul 2>&1
    if %errorlevel% neq 0 (
        echo       pip not found, downloading get-pip.py...
        if not exist "get-pip.py" (
            powershell -Command "Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile 'get-pip.py'"
        )

        echo       Installing pip into local runtime...
        %PYTHON_EXE% get-pip.py --no-warn-script-location
        if %errorlevel% neq 0 (
            echo WARNING: get-pip.py reported an error, but we will try to continue.
        )
        if exist "get-pip.py" del get-pip.py
    )

    echo       Installing requests, pyserial, and pymavlink into project local: %cd%\python\windows
    %PYTHON_EXE% -m pip install requests pyserial pymavlink future lxml bitstring ecdsa reedsolo cryptography --no-warn-script-location
    
    :: verify installation by trying to import them
    %PYTHON_EXE% -c "import requests; import serial; import pymavlink" >nul 2>&1
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install Python modules. The import check failed.
        exit /b 1
    )
    
    echo       Optimizing Python runtime...
    %PYTHON_EXE% scripts/optimize_python.py python/windows
) else (
    echo       All Python modules already installed in project local directory.
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

