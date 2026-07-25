@echo off
echo Installing OCR Server requirements for Windows...
echo.

python -m pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo Failed to install dependencies. Make sure Python and PIP are installed and added to PATH.
    pause
    exit /b 1
)

echo.
echo Installation successful! You can now run start.bat
pause
