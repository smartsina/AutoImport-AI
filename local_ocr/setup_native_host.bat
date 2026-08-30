@echo off
chcp 65001 > NUL
:: AutoImport AI - ثبت Native Messaging Host در ثبت‌نامه‌های ویندوز (Windows Registry)

set SCRIPT_DIR=%~dp0
set SCRIPT_DIR=%SCRIPT_DIR:~0,-1%
set HOST_NAME=com.autoimport.ocr_launcher
set MANIFEST_PATH=%SCRIPT_DIR%\com.autoimport.ocr_launcher.json

echo {> "%MANIFEST_PATH%"
echo   "name": "%HOST_NAME%",>> "%MANIFEST_PATH%"
echo   "description": "AutoImport AI Native OCR Server Launcher",>> "%MANIFEST_PATH%"
echo   "path": "%SCRIPT_DIR:\=\\%\\native_launcher.py",>> "%MANIFEST_PATH%"
echo   "type": "stdio",>> "%MANIFEST_PATH%"
echo   "allowed_origins": [>> "%MANIFEST_PATH%"
echo     "chrome-extension://*/">> "%MANIFEST_PATH%"
echo   ]>> "%MANIFEST_PATH%"
echo }>> "%MANIFEST_PATH%"

REG ADD "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f

echo ✅ ثبت Native Messaging Host در ویندوز با موفقیت انجام شد!
echo 🚀 اکنون می‌توانید از داخل افزونه مرورگر سرور OCR را روشن کنید.
pause
