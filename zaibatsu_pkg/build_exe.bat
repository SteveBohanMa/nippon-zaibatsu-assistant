@echo off
setlocal
set "APPNAME=zaibatsu_assistant"

echo [1/3] Installing dependencies (pyinstaller, pywebview) ...
python -m pip install --upgrade pip >nul
python -m pip install pyinstaller pywebview
if errorlevel 1 (
    echo.
    echo [ERROR] Failed to install dependencies. Check Python and pip.
    pause
    exit /b 1
)

echo.
echo [2/3] Cleaning old build artifacts ...
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist

echo.
echo [3/3] Building ...
if exist app_icon.ico (
    pyinstaller --noconfirm --onefile --windowed --name "%APPNAME%" --icon app_icon.ico --add-data "app;app" --hidden-import webview main.py
) else (
    pyinstaller --noconfirm --onefile --windowed --name "%APPNAME%" --add-data "app;app" --hidden-import webview main.py
)

if errorlevel 1 (
    echo.
    echo [ERROR] Build failed. See log above.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  Done! Executable: dist\%APPNAME%.exe
echo  Double-click to run (offline, no network needed).
echo ============================================================
pause
endlocal
