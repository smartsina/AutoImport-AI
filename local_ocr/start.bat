@echo off
echo AutoImport AI - Local OCR Server for Windows
echo Starting server on port 5151...

python server.py
if errorlevel 1 (
    echo.
    echo Server crashed or could not start. Make sure Python is installed.
    echo Please install requirements by running: pip install -r requirements.txt
    pause
)
